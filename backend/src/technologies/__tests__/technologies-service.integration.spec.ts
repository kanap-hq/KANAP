// @database-spec
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import dataSource from '../../data-source';
import { assert, inRolledBackTransaction, runSpecs, seedTenant, setTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { resolveVersionLabel } from '../technology-rows';
import type { TechnologyRelationsContext } from '../technologies-relations.service';
import { asset, one, services, technology, type AuditEntry } from './technologies.fixtures';

// The technologies service (lot S) against a real database: create and validation, the version
// label resolved without case, the delete of a version, a link written twice, the catalog
// adoption (idempotent), the single links of the Relations tab, and two of them at once on one
// technology (committed, on two connections).

const ctxOf = (manager: any, tenantId: string, access = true): TechnologyRelationsContext => ({
  manager,
  tenantId,
  userId: null,
  access: { budget_lines: access, contracts: access, projects: access, incidents: access },
  incidentViewer: { userId: null, isAdmin: true },
});

async function testCreateAndValidate() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'tec-create');
    const audit: AuditEntry[] = [];
    const { technologies } = services(audit);
    const opts = { manager: runner.manager, tenantId };
    const created = await technologies.create({ name: 'SQL Server', editor: 'Microsoft', family: 'database', cpe_products: ['A:Microsoft:SQL_Server', 'a:microsoft:sql_server'] }, opts);
    assert.equal(created.reference, 'TEC-1');
    assert.deepEqual(created.cpe_products, ['a:microsoft:sql_server'], 'CPE lower-cased and deduplicated');
    assert.equal(audit.at(-1)?.table, 'technologies');
    await assert.rejects(technologies.create({ name: 'sql server' }, opts), /already exists/);
    await assert.rejects(technologies.create({ name: 'X', family: 'nope' }, opts), BadRequestException);
    await assert.rejects(technologies.create({ name: 'Y', cpe_products: ['microsoft sql'] }, opts), BadRequestException);
    const byRef = await technologies.get('TEC-1', opts);
    assert.equal(byRef.id, created.id);
    await assert.rejects(technologies.update(created.id, { replaced_by_id: created.id }, opts), /cannot replace itself/);
  });
}

async function testVersionLabels() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'tec-labels');
    const sql = await technology(runner, tenantId, 1, 'SQL Server', 'database');
    const first = await resolveVersionLabel(runner.manager, tenantId, sql, ' 2019 ', { create: true });
    assert.equal(first?.created, true);
    const again = await resolveVersionLabel(runner.manager, tenantId, sql, '2019', { create: true });
    assert.deepEqual(again, { id: first!.id, created: false });
    const upper = await resolveVersionLabel(runner.manager, tenantId, sql, 'Sp1 Test', { create: true });
    assert.deepEqual(await resolveVersionLabel(runner.manager, tenantId, sql, 'SP1 TEST', { create: false }), { id: upper!.id, created: false }, 'compared without case');
    assert.equal(await resolveVersionLabel(runner.manager, tenantId, sql, '2022', { create: false }), null);
  });
}

async function testLinksAndVersionDelete() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'tec-links');
    const { links, technologies } = services();
    const opts = { manager: runner.manager, tenantId };
    const server = await asset(runner, tenantId, 'PAR-DB-01');
    const other = await asset(runner, tenantId, 'PAR-DB-02');
    const sql = await technology(runner, tenantId, 1, 'SQL Server', 'database');
    const pg = await technology(runner, tenantId, 2, 'PostgreSQL', 'database');
    const pg15 = await one(runner, `INSERT INTO technology_versions (tenant_id, technology_id, label) VALUES ($1, $2, '15') RETURNING id`, [tenantId, pg]);

    // Unknown version twice: one link (NULLS NOT DISTINCT), the second write changes nothing.
    const first = await links.addAssetLink(sql, server, {}, opts);
    const second = await links.addAssetLink(sql, server, {}, opts);
    assert.equal(first.created, true);
    assert.deepEqual({ created: second.created, link: second.link_id }, { created: false, link: first.link_id });
    // A version of another technology is refused; a label is resolved and created.
    await assert.rejects(links.addAssetLink(sql, server, { technology_version_id: pg15 }, opts), /Version not found/);
    const labelled = await links.addAssetLink(sql, server, { version_label: '2019' }, opts);
    assert.equal(labelled.created, true);
    // An automatic source keeps its provenance; a manual edit resets it.
    await links.addAssetLink(sql, other, { version_label: '2019', source: 'agent', source_ref: 'agent-7' }, opts);
    const [auto] = await runner.query(`SELECT id, source, source_ref, observed_at FROM asset_technologies WHERE asset_id = $1`, [other]);
    assert.equal(auto.source, 'agent');
    assert.ok(auto.observed_at instanceof Date);
    await links.updateAssetLink(sql, auto.id, { notes: 'checked' }, opts);
    const [manual] = await runner.query(`SELECT source, source_ref, observed_at, notes FROM asset_technologies WHERE id = $1`, [auto.id]);
    assert.deepEqual(manual, { source: 'manual', source_ref: null, observed_at: null, notes: 'checked' });

    // Deleting 2019: the link of PAR-DB-02 becomes "version unknown" of its tenant; the one of
    // PAR-DB-01, which already names SQL Server without a version, is merged into it.
    const v2019 = (await technologies.listVersions(sql, opts)).items.find((v) => v.label === '2019')!;
    const res = await technologies.deleteVersion(sql, v2019.id, opts);
    assert.deepEqual(res, { ok: true, merged_links: 1 });
    const rows: Array<{ asset_id: string; tenant_id: string; technology_version_id: string | null }> = await runner.query(
      `SELECT asset_id, tenant_id, technology_version_id FROM asset_technologies WHERE technology_id = $1 ORDER BY asset_id`,
      [sql],
    );
    assert.deepEqual(rows, [server, other].sort().map((assetId) => ({ asset_id: assetId, tenant_id: tenantId, technology_version_id: null })));
  });
}

async function testAdoption() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'tec-adopt');
    const { catalog } = services();
    const opts = { manager: runner.manager, tenantId };
    const before = await catalog.notAdopted({ q: 'sql server' }, opts);
    assert.ok(before.items.some((item) => item.key === 'mssqlserver'));
    const first = await catalog.adopt('mssqlserver', opts);
    assert.equal(first.created, true);
    assert.ok(first.versions_added > 0);
    const again = await catalog.adopt('mssqlserver', opts);
    assert.deepEqual({ created: again.created, added: again.versions_added, id: again.technology.id }, { created: false, added: 0, id: first.technology.id });
    const [row] = await runner.query(`SELECT catalog_key, cpe_products, family FROM technologies WHERE id = $1`, [first.technology.id]);
    assert.deepEqual(row, { catalog_key: 'mssqlserver', cpe_products: ['a:microsoft:sql_server'], family: 'database' });
    const after = await catalog.notAdopted({ q: 'sql server' }, opts);
    assert.ok(!after.items.some((item) => item.key === 'mssqlserver'), 'an adopted entry is no longer offered');
    // A technology typed before under the same name receives the key instead of a duplicate.
    await technology(runner, tenantId, 50, 'PostgreSQL', 'database');
    const merged = await catalog.adopt('postgresql', opts);
    assert.equal(merged.created, false);
    assert.equal(merged.technology.reference, 'TEC-50');
    assert.ok(merged.versions_added > 0);
  });
}

async function testSingleLinks() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'tec-rel');
    const audit: AuditEntry[] = [];
    const { relations } = services(audit);
    const tech = await technology(runner, tenantId, 1, 'Entra ID', 'directory');
    const company = await one(runner, `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'Co', 'FR', 'Lyon') RETURNING id`, [tenantId]);
    const supplier = await one(runner, `INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Microsoft') RETURNING id`, [tenantId]);
    const contract = await one(runner, `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date) VALUES ($1, 'M365', $2, $3, DATE '2026-01-01') RETURNING id`, [tenantId, company, supplier]);
    const ctx = ctxOf(runner.manager, tenantId);
    assert.deepEqual(await relations.setLink('contracts', tech, contract, true, ctx), { ok: true, changed: true });
    assert.deepEqual(await relations.setLink('contracts', tech, contract, true, ctx), { ok: true, changed: false });
    assert.equal(audit.filter((e) => e.table === 'technology_contracts').length, 1, 'one audit row for one change');
    const read = await relations.getRelations(tech, ctx);
    assert.deepEqual(read.contracts?.map((c) => c.id), [contract]);
    assert.deepEqual(read.links, []);
    const hidden = await relations.getRelations(tech, ctxOf(runner.manager, tenantId, false));
    assert.deepEqual([hidden.budget_lines, hidden.contracts, hidden.projects, hidden.incidents], [null, null, null, null]);
    await assert.rejects(relations.setLink('contracts', tech, contract, false, ctxOf(runner.manager, tenantId, false)), ForbiddenException);
    await assert.rejects(relations.setLink('budget_lines', tech, randomUUID(), true, ctx), BadRequestException);
    assert.deepEqual(await relations.setLink('contracts', tech, contract, false, ctx), { ok: true, changed: true });
  });
}

/** Two single links on one technology at once, on two connections: both stay (the second waits for the row lock). */
async function testConcurrentSingleLinks() {
  const setup = dataSource.createQueryRunner();
  const first = dataSource.createQueryRunner();
  const second = dataSource.createQueryRunner();
  for (const runner of [setup, first, second]) await runner.connect();
  let tenantId = '';
  try {
    await setup.startTransaction();
    tenantId = await seedTenant(setup, 'tec-race');
    const tech = await technology(setup, tenantId, 1, 'SQL Server', 'database');
    const company = await one(setup, `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'Co', 'FR', 'Lyon') RETURNING id`, [tenantId]);
    const supplier = await one(setup, `INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Microsoft') RETURNING id`, [tenantId]);
    const contractA = await one(setup, `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date) VALUES ($1, 'A', $2, $3, DATE '2026-01-01') RETURNING id`, [tenantId, company, supplier]);
    const contractB = await one(setup, `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date) VALUES ($1, 'B', $2, $3, DATE '2026-01-01') RETURNING id`, [tenantId, company, supplier]);
    await setup.commitTransaction();

    const { relations } = services();
    await first.startTransaction();
    await second.startTransaction();
    await setTenant(first, tenantId);
    await setTenant(second, tenantId);
    await relations.setLink('contracts', tech, contractA, true, ctxOf(first.manager, tenantId));
    let secondDone = false;
    const pending = relations.setLink('contracts', tech, contractB, true, ctxOf(second.manager, tenantId)).then((res) => {
      secondDone = true;
      return res;
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(secondDone, false, 'the second link waits for the technology row');
    await first.commitTransaction();
    assert.deepEqual(await pending, { ok: true, changed: true });
    await second.commitTransaction();

    await setup.startTransaction();
    await setTenant(setup, tenantId);
    const rows: Array<{ contract_id: string }> = await setup.query(
      `SELECT contract_id FROM technology_contracts WHERE tenant_id = $1 AND technology_id = $2 ORDER BY contract_id`,
      [tenantId, tech],
    );
    await setup.commitTransaction();
    assert.deepEqual(rows.map((r) => r.contract_id), [contractA, contractB].sort(), 'both links stay');
  } finally {
    for (const runner of [setup, first, second]) {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
    }
    if (tenantId) {
      await setup.startTransaction();
      await setTenant(setup, tenantId);
      for (const table of ['technology_contracts', 'technologies', 'contracts', 'suppliers', 'companies']) {
        await setup.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
      }
      await setup.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
      await setup.commitTransaction();
    }
    for (const runner of [setup, first, second]) await runner.release();
  }
}

runSpecs('technologies-service.integration.spec', [
  ['create and validate', testCreateAndValidate],
  ['version labels', testVersionLabels],
  ['links and version delete', testLinksAndVersionDelete],
  ['catalog adoption', testAdoption],
  ['single links', testSingleLinks],
  ['concurrent single links', testConcurrentSingleLinks],
]).catch((err) => {
  console.error(err);
  process.exit(1);
});
