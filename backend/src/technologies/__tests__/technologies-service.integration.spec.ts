// @database-spec
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import dataSource from '../../data-source';
import { assert, inRolledBackTransaction, runSpecs, seedTenant, setTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { linkProvenance } from '../../common/link-provenance';
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
  writeIncidents: access,
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
    await links.addAssetLink(sql, other, { version_label: '2019' }, opts, linkProvenance('agent', 'agent-7'));
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


async function incident(runner: any, tenantId: string, number: number, extra: { confidential?: boolean; status?: string } = {}) {
  return one(runner,
    `INSERT INTO incidents (tenant_id, item_number, title, severity, confidential, status) VALUES ($1, $2, $3, 'low', $4, $5) RETURNING id`,
    [tenantId, number, `Incident ${number}`, extra.confidential ?? false, extra.status ?? 'open']);
}

/** Removing what is not linked answers "no change" and writes no audit row (the DELETE ... RETURNING trap). */
async function testUnlinkWhatIsNotLinked() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'tec-unlink');
    const audit: AuditEntry[] = [];
    const { links, relations } = services(audit);
    const opts = { manager: runner.manager, tenantId };
    const server = await asset(runner, tenantId, 'SRV-1');
    const tech = await technology(runner, tenantId, 1, 'Tomcat', 'application_server');
    const app = await one(runner, `INSERT INTO applications (tenant_id, name) VALUES ($1, 'App') RETURNING id`, [tenantId]);
    const processId = await one(runner, `INSERT INTO business_processes (tenant_id, name) VALUES ($1, 'Order to cash') RETURNING id`, [tenantId]);

    assert.deepEqual(await links.removeApplication(tech, app, opts, {}), { ok: true, removed: 0 });
    assert.deepEqual(await links.setApplicationTechnology(app, tech, false, {}, opts), { ok: true, changed: false });
    assert.deepEqual(await links.setProcessApplication(processId, app, false, opts, {}), { ok: true, changed: false });
    const created = await links.addAssetLink(tech, server, {}, opts);
    assert.deepEqual(await links.removeAssetLink(tech, created.link_id!, opts), { ok: true, changed: true });
    const deleteRow = audit.at(-1)!;
    assert.equal(deleteRow.action, 'delete');
    assert.ok(deleteRow.before && !Array.isArray(deleteRow.before), 'the audit holds the removed row');
    assert.equal((deleteRow.before as any).asset_id, server);
    const count = audit.length;
    assert.deepEqual(await links.removeAssetLink(tech, created.link_id!, opts), { ok: true, changed: false });
    assert.equal(audit.length, count, 'no audit row for nothing removed');
    assert.ok(audit.every((entry) => entry.table !== 'application_technologies' && entry.table !== 'application_business_processes'));
    const unknown = randomUUID();
    assert.deepEqual(await relations.setLink('projects', tech, unknown, false, ctxOf(runner.manager, tenantId)).catch((e) => e.constructor.name), 'BadRequestException');
  });
}

/** Business processes and the asset's side, with the applications reach of the caller. */
async function testProcessAndAssetSides() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'tec-sides');
    const audit: AuditEntry[] = [];
    const { links } = services(audit);
    const opts = { manager: runner.manager, tenantId };
    const app = await one(runner, `INSERT INTO applications (tenant_id, name) VALUES ($1, 'ERP') RETURNING id`, [tenantId]);
    const processId = await one(runner, `INSERT INTO business_processes (tenant_id, name) VALUES ($1, 'Procure to pay') RETURNING id`, [tenantId]);
    assert.deepEqual(await links.setProcessApplication(processId, app, true, opts, {}), { ok: true, changed: true });
    assert.deepEqual(await links.setProcessApplication(processId, app, true, opts, {}), { ok: true, changed: false });
    assert.equal(audit.filter((e) => e.table === 'application_business_processes').length, 1);
    assert.deepEqual((await links.applicationsOfProcess(processId, opts, {})).items?.map((a: any) => a.id), [app]);
    assert.equal((await links.applicationsOfProcess(processId, opts, null)).items, null, 'no applications read right: no rows');
    const scope = { userId: randomUUID() } as any;
    assert.deepEqual((await links.applicationsOfProcess(processId, opts, { scope })).items, [], 'out of the scope: hidden');
    await assert.rejects(links.setProcessApplication(processId, app, false, opts, { scope }), /Application not found/);
    assert.deepEqual((await links.processesOfApplication(app, opts)).items.map((p: any) => p.id), [processId]);
    assert.deepEqual(await links.setProcessApplication(processId, app, false, opts, {}), { ok: true, changed: true });

    // The asset's side: installed (removable), then removed through the asset.
    const server = await asset(runner, tenantId, 'SRV-2');
    const tech = await technology(runner, tenantId, 1, 'PostgreSQL', 'database');
    const link = await links.addAssetLink(tech, server, { version_label: '16' }, opts);
    const ofAsset = await links.technologiesOfAsset(server, opts);
    assert.deepEqual(ofAsset.items.map((i) => [i.technology_id, i.kind, i.removable, i.version_label]), [[tech, 'installed', true, '16']]);
    const other = await asset(runner, tenantId, 'SRV-3');
    assert.deepEqual(await links.removeAssetLinkOfAsset(other, link.link_id!, opts), { ok: true, changed: false }, 'a link of another asset');
    assert.deepEqual(await links.removeAssetLinkOfAsset(server, link.link_id!, opts), { ok: true, changed: true });
    assert.deepEqual((await links.technologiesOfAsset(server, opts)).items, []);

    // Writing an existing link again: a changed note is audited as an update, the same one is not.
    await links.addAssetLink(tech, server, {}, opts);
    const before = audit.length;
    await links.addAssetLink(tech, server, {}, opts);
    assert.equal(audit.length, before, 'nothing changed, no audit row');
    await links.addAssetLink(tech, server, { notes: 'primary' }, opts);
    assert.equal(audit.at(-1)?.action, 'update');
  });
}

/** The technologies service under another tenant: nothing of tenant A is read or written. */
async function testServiceTenantIsolation() {
  await inRolledBackTransaction(async (runner) => {
    const a = await seedTenant(runner, 'tec-iso-a');
    const techA = await technology(runner, a, 1, 'SQL Server', 'database');
    const versionA = await one(runner, `INSERT INTO technology_versions (tenant_id, technology_id, label) VALUES ($1, $2, '2019') RETURNING id`, [a, techA]);
    const roleA = await one(runner, `INSERT INTO roles (tenant_id, role_name) VALUES ($1, 'Iso role') RETURNING id`, [a]);
    const userA = await one(runner, `INSERT INTO users (tenant_id, email, role_id) VALUES ($1, $2, $3) RETURNING id`, [a, `iso-${randomUUID()}@example.invalid`, roleA]);
    const b = await seedTenant(runner, 'tec-iso-b');
    const techB = await technology(runner, b, 901, 'PostgreSQL', 'database');
    const { technologies, catalog } = services();
    const opts = { manager: runner.manager, tenantId: b };
    await assert.rejects(technologies.update(techA, { name: 'Taken over' }, opts), /Technology not found/);
    await assert.rejects(technologies.listVersions(techA, opts), /Technology not found/);
    await assert.rejects(technologies.createVersion(techA, { label: '2022' }, opts), /Technology not found/);
    await assert.rejects(technologies.deleteVersion(techB, versionA, opts), /Version not found/);
    await assert.rejects(technologies.bulkReplaceOwners(techB, [{ user_id: userA, owner_type: 'it' }], opts), /owners not found/);
    await assert.rejects(technologies.update(techB, { replaced_by_id: techA }, opts), /Replacement technology not found/);
    const adopted = await catalog.adopt('mssqlserver', opts);
    assert.equal(adopted.created, true, 'each tenant adopts on its own');
    assert.equal((await technologies.list({}, opts)).total, 2);
  });
}

/** Free inputs: no catalog key by hand, no replacement cycle, a re-adoption that adds nothing. */
async function testInputsAndReadoption() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'tec-inputs');
    const { technologies, catalog } = services();
    const opts = { manager: runner.manager, tenantId };
    const typed = await technologies.create({ name: 'My Postgres', catalog_key: 'postgresql' } as any, opts);
    assert.equal(typed.catalog_key, null, 'the catalog key is not written by hand');
    const a = await technologies.create({ name: 'A' }, opts);
    const b = await technologies.create({ name: 'B' }, opts);
    const c = await technologies.create({ name: 'C' }, opts);
    await technologies.update(a.id, { replaced_by_id: b.id }, opts);
    await technologies.update(b.id, { replaced_by_id: c.id }, opts);
    await assert.rejects(technologies.update(c.id, { replaced_by_id: a.id }, opts), /cycle/);
    await assert.rejects(technologies.update(b.id, { replaced_by_id: a.id }, opts), /cycle/);
    const first = await catalog.adopt('mssqlserver', opts);
    const versions = (await technologies.listVersions(first.technology.id, opts)).items;
    await technologies.deleteVersion(first.technology.id, versions[0].id, opts);
    const again = await catalog.adopt('mssqlserver', opts);
    assert.equal(again.versions_added, 0);
    assert.equal((await technologies.listVersions(first.technology.id, opts)).items.length, versions.length - 1, 'a deleted version does not come back');
  });
}

/** Linking incidents from a technology: the incident edit right, visibility first, the open state, the journal. */
async function testIncidentLinks() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'tec-incidents');
    const { relations } = services();
    const tech = await technology(runner, tenantId, 1, 'Active Directory', 'directory');
    const open = await incident(runner, tenantId, 1);
    const hidden = await incident(runner, tenantId, 2, { confidential: true });
    const closed = await incident(runner, tenantId, 3, { status: 'closed' });
    const ctx = ctxOf(runner.manager, tenantId);
    await assert.rejects(relations.setLink('incidents', tech, open, true, { ...ctx, writeIncidents: false }), ForbiddenException);
    assert.deepEqual(await relations.setLink('incidents', tech, open, true, ctx), { ok: true, changed: true });
    assert.deepEqual(await relations.setLink('incidents', tech, open, true, ctx), { ok: true, changed: false });
    const entries = await runner.query(`SELECT kind FROM incident_entries WHERE incident_id = $1`, [open]);
    assert.deepEqual(entries.map((e: any) => e.kind), ['link_change'], 'one journal entry');
    // A confidential incident the viewer cannot see: the same 404 as an unknown one, linked or not.
    const viewer = { ...ctx, incidentViewer: { userId: randomUUID(), isAdmin: false } };
    await assert.rejects(relations.setLink('incidents', tech, hidden, true, viewer), /Incident not found/);
    await assert.rejects(relations.setLink('incidents', tech, randomUUID(), true, viewer), /Incident not found/);
    await assert.rejects(relations.setLink('incidents', tech, closed, true, ctx), /closed/);
    const read = await relations.getRelations(tech, viewer);
    assert.deepEqual(read.incidents?.map((i) => i.id), [open]);
  });
}

/** Two technologies link the same incident at once: both links stay (the incident row is locked). */
async function testConcurrentIncidentLinks() {
  const setup = dataSource.createQueryRunner();
  const first = dataSource.createQueryRunner();
  const second = dataSource.createQueryRunner();
  for (const runner of [setup, first, second]) await runner.connect();
  let tenantId = '';
  try {
    await setup.startTransaction();
    tenantId = await seedTenant(setup, 'tec-inc-race');
    const techA = await technology(setup, tenantId, 1, 'Entra ID', 'directory');
    const techB = await technology(setup, tenantId, 2, 'Active Directory', 'directory');
    const inc = await incident(setup, tenantId, 1);
    await setup.commitTransaction();
    const { relations } = services();
    await first.startTransaction();
    await second.startTransaction();
    await setTenant(first, tenantId);
    await setTenant(second, tenantId);
    await relations.setLink('incidents', techA, inc, true, ctxOf(first.manager, tenantId));
    let secondDone = false;
    const pending = relations.setLink('incidents', techB, inc, true, ctxOf(second.manager, tenantId)).then((res) => { secondDone = true; return res; });
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(secondDone, false, 'the second link waits for the incident row');
    await first.commitTransaction();
    assert.deepEqual(await pending, { ok: true, changed: true });
    await second.commitTransaction();
    await setup.startTransaction();
    await setTenant(setup, tenantId);
    const rows: Array<{ technology_id: string }> = await setup.query(
      `SELECT technology_id FROM incident_technologies WHERE tenant_id = $1 AND incident_id = $2 ORDER BY technology_id`, [tenantId, inc]);
    await setup.commitTransaction();
    assert.deepEqual(rows.map((r) => r.technology_id), [techA, techB].sort(), 'both links stay');
  } finally {
    await cleanupTenant(setup, [first, second], tenantId, ['incident_entries', 'incident_technologies', 'incidents', 'technologies']);
  }
}

/** Two adoptions of one entry and two creations of one version label at once: one row each. */
async function testConcurrentAdoptionAndLabels() {
  const setup = dataSource.createQueryRunner();
  const first = dataSource.createQueryRunner();
  const second = dataSource.createQueryRunner();
  for (const runner of [setup, first, second]) await runner.connect();
  let tenantId = '';
  try {
    await setup.startTransaction();
    tenantId = await seedTenant(setup, 'tec-adopt-race');
    const tech = await technology(setup, tenantId, 901, 'Tomcat', 'application_server');
    await setup.commitTransaction();
    const { catalog } = services();
    await first.startTransaction();
    await second.startTransaction();
    await setTenant(first, tenantId);
    await setTenant(second, tenantId);
    const a = await catalog.adopt('postgresql', { manager: first.manager, tenantId });
    const labelA = await resolveVersionLabel(first.manager, tenantId, tech, '9.0', { create: true });
    const pendingAdopt = catalog.adopt('postgresql', { manager: second.manager, tenantId });
    const pendingLabel = pendingAdopt.then(() => resolveVersionLabel(second.manager, tenantId, tech, '9.0', { create: true }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    await first.commitTransaction();
    const b = await pendingAdopt;
    const labelB = await pendingLabel;
    await second.commitTransaction();
    assert.deepEqual({ created: b.created, id: b.technology.id, added: b.versions_added }, { created: false, id: a.technology.id, added: 0 });
    assert.deepEqual(labelB, { id: labelA!.id, created: false });
    await setup.startTransaction();
    await setTenant(setup, tenantId);
    const [{ n }] = await setup.query(`SELECT count(*)::int AS n FROM technologies WHERE tenant_id = $1 AND catalog_key = 'postgresql'`, [tenantId]);
    await setup.commitTransaction();
    assert.equal(n, 1);
  } finally {
    await cleanupTenant(setup, [first, second], tenantId, ['technology_versions', 'technologies', 'item_sequences']);
  }
}

async function cleanupTenant(setup: any, others: any[], tenantId: string, tables: string[]) {
  for (const runner of [setup, ...others]) {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
  }
  if (tenantId) {
    await setup.startTransaction();
    await setTenant(setup, tenantId);
    for (const table of tables) await setup.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
    await setup.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
    await setup.commitTransaction();
  }
  for (const runner of [setup, ...others]) await runner.release();
}

runSpecs('technologies-service.integration.spec', [
  ['create and validate', testCreateAndValidate],
  ['version labels', testVersionLabels],
  ['links and version delete', testLinksAndVersionDelete],
  ['catalog adoption', testAdoption],
  ['single links', testSingleLinks],
  ['concurrent single links', testConcurrentSingleLinks],
  ['unlink what is not linked', testUnlinkWhatIsNotLinked],
  ['process and asset sides', testProcessAndAssetSides],
  ['service tenant isolation', testServiceTenantIsolation],
  ['inputs and re-adoption', testInputsAndReadoption],
  ['incident links', testIncidentLinks],
  ['concurrent incident links', testConcurrentIncidentLinks],
  ['concurrent adoption and labels', testConcurrentAdoptionAndLabels],
]).catch((err) => {
  console.error(err);
  process.exit(1);
});
