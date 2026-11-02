// @database-spec
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import dataSource from '../../data-source';
import { assert, inRolledBackTransaction, runSpecs, seedTenant, setTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { linkProvenance } from '../../common/link-provenance';
import { onPremHostingTypes, resolveHostingType } from '../hosting-type';
import { resolveVersionLabel } from '../technology-rows';
import type { TechnologyRelationsContext } from '../technologies-relations.service';
import { DEFAULT_HOSTING_TYPES, DEFAULT_TECHNOLOGY_FAMILIES } from '../../it-ops-settings/it-ops-settings.service';
import { TechnologyCatalogService } from '../catalog/technology-catalog.service';
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
    // The screen passes nothing: its audit row has no source. Plaid names the preview and the
    // source, and the same creation route writes them.
    assert.equal(audit.at(-1)?.source, undefined, 'the screen audit keeps its shape');
    assert.equal(audit.at(-1)?.sourceRef, undefined, 'the screen audit names no preview');
    await technologies.create({ name: 'SQL Server 2025', family: 'database' }, { ...opts, audit: { source: 'ai_chat', sourceRef: 'preview-1' } });
    assert.deepEqual({ source: audit.at(-1)?.source, sourceRef: audit.at(-1)?.sourceRef }, { source: 'ai_chat', sourceRef: 'preview-1' });
    await assert.rejects(technologies.create({ name: 'sql server' }, opts), /already exists/);
    await assert.rejects(technologies.create({ name: 'X', family: 'nope' }, opts), BadRequestException);
    await assert.rejects(technologies.create({ name: 'Y', cpe_products: ['microsoft sql'] }, opts), BadRequestException);
    // The NVD escapes punctuation in its names: `veeam_backup_\&_replication` is kept as written.
    const escaped = await technologies.create({ name: 'Veeam', cpe_products: ['a:veeam:veeam_backup_\\&_replication'] }, opts);
    assert.deepEqual(escaped.cpe_products, ['a:veeam:veeam_backup_\\&_replication']);
    await assert.rejects(technologies.create({ name: 'Z', cpe_products: ['a:veeam:backup_&_replication'] }, opts), BadRequestException);
    const byRef = await technologies.get('TEC-1', opts);
    assert.equal(byRef.id, created.id);
    await assert.rejects(technologies.update(created.id, { replaced_by_id: created.id }, opts), /cannot replace itself/);
  });
}

/** CVE.org names (lot 1d): stored sorted, refused when they repeat or run past the limit, and a change emits the rematch. */
async function testCveNames() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'tec-cve-names');
    const audit: AuditEntry[] = [];
    const emitted: Array<{ technologyId: string; products: string[] }> = [];
    const { technologies } = services(audit);
    (technologies as unknown as { cpeEvents: { emit: (event: { technologyId: string; products: string[] }) => Promise<void> } }).cpeEvents = {
      emit: async (event) => { emitted.push({ technologyId: event.technologyId, products: event.products }); },
    };
    const opts = { manager: runner.manager, tenantId };
    const created = await technologies.create({
      name: 'S/4HANA',
      cve_names: [
        { vendor: 'zebra', product: 'Box' },
        { vendor: 'SAP_SE', product: 'SAP S/4HANA', version: '2023' },
        { vendor: 'sap se', product: 'NetWeaver' },
      ],
    }, opts);
    assert.deepEqual(created.cve_names, [
      { vendor: 'sap se', product: 'NetWeaver', version: null },
      { vendor: 'SAP_SE', product: 'SAP S/4HANA', version: '2023' },
      { vendor: 'zebra', product: 'Box', version: null },
    ], 'stored by vendor, product and version, without regard to case');
    assert.deepEqual((audit.at(-1)?.after as { cve_names?: unknown } | undefined)?.cve_names, created.cve_names, 'the audit carries the names');
    const listed = await technologies.list({}, opts);
    assert.deepEqual(listed.items.find((item) => item.id === created.id)?.cve_names, created.cve_names, 'the list returns the names');
    emitted.length = 0;
    const updated = await technologies.update(created.id, {
      cve_names: [{ vendor: 'Apache', product: 'Tomcat' }, { vendor: 'apache', product: 'HTTP Server' }],
    }, opts);
    assert.deepEqual(updated.cve_names, [
      { vendor: 'apache', product: 'HTTP Server', version: null },
      { vendor: 'Apache', product: 'Tomcat', version: null },
    ]);
    assert.deepEqual(emitted, [{ technologyId: created.id, products: [] }], 'a name change emits the rematch, with no new CPE product');
    const updateAudit = audit.filter((entry) => entry.action === 'update' && entry.recordId === created.id);
    assert.deepEqual((updateAudit.at(-1)?.before as { cve_names?: unknown } | undefined)?.cve_names, created.cve_names);
    assert.deepEqual((updateAudit.at(-1)?.after as { cve_names?: unknown } | undefined)?.cve_names, updated.cve_names);
    await assert.rejects(
      technologies.update(created.id, { cve_names: Array.from({ length: 51 }, (_, index) => ({ vendor: 'A', product: `B${index}` })) }, opts),
      (error: unknown) => error instanceof BadRequestException && /at most 50/.test(error.message),
    );
    await assert.rejects(
      technologies.update(created.id, { cve_names: [{ vendor: 'SAP_SE', product: 'X' }, { vendor: 'SAP SE', product: 'X' }] }, opts),
      (error: unknown) => error instanceof BadRequestException && /repeats/.test(error.message),
    );
    await assert.rejects(
      technologies.update(created.id, { cve_names: [{ vendor: '  ', product: 'X' }] }, opts),
      (error: unknown) => error instanceof BadRequestException && /vendor/.test(error.message),
    );
    const [kept] = await runner.query(`SELECT cve_names FROM technologies WHERE tenant_id = $1 AND id = $2`, [tenantId, created.id]);
    assert.deepEqual(kept.cve_names, updated.cve_names, 'a refused update leaves the names');
  });
}

/**
 * The hosting type (lot H1): on premises by default, a code of the tenant's hosting types
 * (trimmed, without case) or a 400, a list filter (plain and grid) and its values, and the
 * adoption that writes the type a catalog mode stands for.
 */
async function testHostingType() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'tec-hosting');
    const { technologies, catalog } = services();
    const opts = { manager: runner.manager, tenantId };
    const plain = await technologies.create({ name: 'Tomcat', family: 'application_server' }, opts);
    assert.equal(plain.hosting_type, 'on_prem', 'on premises by default');
    const saas = await technologies.create({ name: 'Okta', family: 'directory', hosting_type: ' SaaS ' }, opts);
    assert.equal(saas.hosting_type, 'saas');
    await assert.rejects(technologies.create({ name: 'Nowhere', hosting_type: 'mainframe' }, opts), /Unknown hosting type/);
    await assert.rejects(technologies.update(plain.id, { hosting_type: null }, opts), /Unknown hosting type/);
    // The former mode is refused, on a create as on a PATCH.
    await assert.rejects(technologies.create({ name: 'Old client', mode: 'subscribed' }, opts), /mode is replaced by hosting_type/);
    await assert.rejects(technologies.update(plain.id, { mode: 'subscribed' }, opts), /mode is replaced by hosting_type/);
    const moved = await technologies.update(plain.id, { hosting_type: 'public_cloud' }, opts);
    assert.equal(moved.hosting_type, 'public_cloud');

    const byParam = await technologies.list({ hosting_type: 'saas' }, opts);
    assert.deepEqual(byParam.items.map((item) => item.name), ['Okta']);
    const byGrid = await technologies.list({ filters: JSON.stringify({ hosting_type: { filterType: 'set', values: ['public_cloud'] } }) }, opts);
    assert.deepEqual(byGrid.items.map((item) => item.name), ['Tomcat']);
    assert.deepEqual((await technologies.filterValues('hosting_type', opts)).hosting_type, ['public_cloud', 'saas']);

    // The catalog keeps its mode: subscribed is SaaS, installed on premises.
    const offered = await catalog.notAdopted({ q: 'entra' }, opts);
    assert.equal(offered.items.find((item) => item.key === 'entra-id')?.hosting_type, 'saas');
    const entra = await catalog.adopt('entra-id', opts);
    const sql = await catalog.adopt('mssqlserver', opts);
    const rows: Array<{ id: string; hosting_type: string }> = await runner.query(
      `SELECT id, hosting_type FROM technologies WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [tenantId, [entra.technology.id, sql.technology.id]],
    );
    const typeOf = new Map(rows.map((row) => [row.id, row.hosting_type]));
    assert.deepEqual([typeOf.get(entra.technology.id), typeOf.get(sql.technology.id)], ['saas', 'on_prem']);
    // An entry that names its type keeps it: a managed Kubernetes is in the public cloud.
    assert.equal((await catalog.notAdopted({ q: 'eks' }, opts)).items.find((item) => item.key === 'amazon-eks')?.hosting_type, 'public_cloud');
    const eks = await catalog.adopt('amazon-eks', opts);
    assert.equal((await technologies.get(eks.technology.id, opts)).hosting_type, 'public_cloud');
  });
  // A tenant whose catalog lost a code gets its first type in use of the same category.
  const custom = [
    { code: 'datacenter', label: 'Datacenter', category: 'on_prem' },
    { code: 'old_cloud', label: 'Old cloud', category: 'cloud', deprecated: true },
    { code: 'azure', label: 'Azure', category: 'cloud' },
  ];
  assert.equal(resolveHostingType(custom, 'saas'), 'azure');
  assert.equal(resolveHostingType(custom, 'on_prem'), 'datacenter');
  assert.equal(resolveHostingType(custom, 'azure'), 'azure');
  assert.equal(resolveHostingType([], 'saas'), 'saas', 'no type in use: the default code, listed in the missing data');
  // A retired type is never given: the first type in use of its category, else the first in use.
  const retired = [
    { code: 'on_prem', label: 'On-prem', category: 'on_prem', deprecated: true },
    { code: 'saas', label: 'SaaS', category: 'cloud' },
    { code: 'colocation', label: 'Colocation', category: 'on_prem' },
  ];
  assert.equal(resolveHostingType(retired, 'on_prem'), 'colocation');
  assert.equal(resolveHostingType(retired.slice(0, 2), 'on_prem'), 'saas');
  assert.equal(resolveHostingType([retired[0]], 'on_prem'), 'on_prem', 'every type retired: the default code');
  // On premises: the catalog's, retired included, and the inferred codes it lacks.
  assert.deepEqual(onPremHostingTypes(retired).sort(), ['colocation', 'on_prem']);
  assert.deepEqual(onPremHostingTypes([{ code: 'dc', label: 'DC', category: 'on_prem' }]).sort(), ['colocation', 'dc', 'on_prem']);
  assert.deepEqual(onPremHostingTypes([]).sort(), ['colocation', 'on_prem']);
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

/** The record and the version list give the versions newest number first, labels without a number last. */
async function testVersionOrder() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'tec-order');
    const { technologies } = services([]);
    const opts = { manager: runner.manager, tenantId };
    const tomcat = await technology(runner, tenantId, 1, 'Tomcat', 'middleware');
    for (const label of ['9.0', 'LTS', '10.1', '8.5', '11.0', '10.0', 'beta']) {
      await technologies.createVersion(tomcat, { label, standard_support_end: label === '8.5' ? '2030-01-01' : null }, opts);
    }
    const expected = ['11.0', '10.1', '10.0', '9.0', '8.5', 'beta', 'LTS'];
    assert.deepEqual((await technologies.get(tomcat, opts)).versions.map((v) => v.label), expected);
    assert.deepEqual((await technologies.listVersions(tomcat, opts)).items.map((v) => v.label), expected);
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
    assert.deepEqual(row, {
      catalog_key: 'mssqlserver',
      // The NVD names SQL Server once for all releases (until 2024), then once per release.
      cpe_products: ['a:microsoft:sql_server', 'a:microsoft:sql_server_2016', 'a:microsoft:sql_server_2017', 'a:microsoft:sql_server_2019', 'a:microsoft:sql_server_2022', 'a:microsoft:sql_server_2025'],
      family: 'database',
    });
    const after = await catalog.notAdopted({ q: 'sql server' }, opts);
    assert.ok(!after.items.some((item) => item.key === 'mssqlserver'), 'an adopted entry is no longer offered');
    assert.equal(after.adopted.find((item) => item.key === 'mssqlserver')?.reference, first.technology.reference);
    // A technology typed before under the same name receives the key instead of a duplicate.
    await technology(runner, tenantId, 50, 'PostgreSQL', 'database');
    const offered = await catalog.notAdopted({ q: 'postgres' }, opts);
    const pg = offered.items.find((item) => item.key === 'postgresql');
    assert.ok(pg, 'a technology typed by hand keeps its catalog entry on offer');
    assert.equal(pg.completes, 'TEC-50');
    assert.deepEqual(offered.adopted, [], 'a hand-typed namesake stays on offer');
    const other = offered.items.find((item) => item.key !== 'postgresql');
    assert.ok(other, 'the search also offers an entry with no hand-typed namesake');
    assert.equal(other.completes, null);
    const merged = await catalog.adopt('postgresql', opts);
    assert.equal(merged.created, false);
    assert.equal(merged.technology.reference, 'TEC-50');
    assert.ok(merged.versions_added > 0);
    // PostgreSQL is adopted: the three cloud entries stay in items, and PostgreSQL moves to adopted.
    const listed = await catalog.notAdopted({ q: 'postgres' }, opts);
    assert.deepEqual(listed.items.map((item) => item.key), [
      'amazon-aurora-postgresql',
      'amazon-rds-postgresql',
      'azure-database-for-postgresql',
    ]);
    assert.ok(listed.items.every((item) => item.completes == null && item.hosting_type === 'public_cloud'));
    assert.deepEqual(listed.adopted.map((item) => ({
      key: item.key, name: item.name, editor: item.editor, family_label: item.family_label, reference: item.reference, id: item.id,
    })), [{
      key: 'postgresql',
      name: 'PostgreSQL',
      editor: 'PostgreSQL Global Development Group',
      family_label: 'Database',
      reference: 'TEC-50',
      id: merged.technology.id,
    }]);
    assert.deepEqual((await catalog.notAdopted({ q: '  ' }, opts)).adopted, [], 'a blank search lists no adopted entry');
    const byFamily = await catalog.notAdopted({ q: 'postgres', family: 'directory' }, opts);
    assert.deepEqual(byFamily.items, []);
    assert.deepEqual(byFamily.adopted, []);
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
    await runner.query(
      `UPDATE technology_versions SET standard_support_end = '2028-11-09', extended_support_end = '2030-11-09'
        WHERE tenant_id = $1 AND technology_id = $2 AND lower(label) = '16'`,
      [tenantId, tech],
    );
    const ofAsset = await links.technologiesOfAsset(server, opts);
    assert.deepEqual(ofAsset.items.map((i) => [i.technology_id, i.kind, i.removable, i.version_label, i.standard_support_end, i.extended_support_end]),
      [[tech, 'installed', true, '16', '2028-11-09', '2030-11-09']]);
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

/**
 * The short description an adoption gives: in the language asked, in English when that one is
 * missing, kept when a technology of the same name already has one; every entry has one in the
 * four languages, without dash.
 */
async function testAdoptionDescription() {
  const { catalog } = services();
  for (const product of catalog.all()) {
    for (const language of ['en', 'fr', 'de', 'es'] as const) {
      const text = (catalog as any).descriptions[product.key]?.[language] as string | undefined;
      assert.ok(text && text.trim().length > 20, `${product.key}: ${language} description`);
      assert.ok(!/[\u2013\u2014]/.test(text), `${product.key}: ${language} without dash`);
    }
  }
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'tec-adopt-desc');
    const opts = { manager: runner.manager, tenantId };
    const descriptionOf = async (id: string) =>
      (await runner.query(`SELECT description FROM technologies WHERE id = $1`, [id]))[0].description as string | null;
    const fr = await catalog.adopt('postgresql', { ...opts, language: 'fr' });
    assert.match(String(await descriptionOf(fr.technology.id)), /^Base de données relationnelle open source/);
    const en = await catalog.adopt('mysql', opts);
    assert.match(String(await descriptionOf(en.technology.id)), /^Open-source relational database/, 'no language, no user: English');
    await assert.rejects(catalog.adopt('redis', { ...opts, language: 'it' }), BadRequestException);
    // A technology of the same name keeps its own description.
    await technology(runner, tenantId, 60, 'Apache Tomcat', 'application_server');
    await runner.query(`UPDATE technologies SET description = 'Our Tomcat' WHERE tenant_id = $1 AND item_number = 60`, [tenantId]);
    const merged = await catalog.adopt('tomcat', { ...opts, language: 'de' });
    assert.equal(await descriptionOf(merged.technology.id), 'Our Tomcat');
    // An empty one receives the catalog's.
    await technology(runner, tenantId, 61, 'Grafana', 'monitoring');
    await runner.query(`UPDATE technologies SET description = '  ' WHERE tenant_id = $1 AND item_number = 61`, [tenantId]);
    const filled = await catalog.adopt('grafana', { ...opts, language: 'es' });
    assert.match(String(await descriptionOf(filled.technology.id)), /^Herramienta de paneles/);
    // The list offers the description in the language asked.
    const listed = await catalog.notAdopted({ q: 'redis', language: 'de' }, opts);
    assert.match(String(listed.items.find((item) => item.key === 'redis')?.description), /^Datenspeicher im Arbeitsspeicher/);
  });
  // A language missing from the file falls back to English.
  const original = (catalog as any).descriptions;
  (catalog as any).descriptions = { x: { en: 'English text' } };
  try {
    assert.equal(catalog.description('x', 'fr'), 'English text');
    assert.equal(catalog.description('y', 'fr'), null);
  } finally {
    (catalog as any).descriptions = original;
  }
}

/**
 * A tenant whose saved family list has no `network` (it predates that code) is offered a catalog
 * product of family `network` under `network_security`, and the family filter uses that code.
 * A tenant that lists `network` keeps the catalog family.
 */
async function testCatalogFamilyForTenant() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'tec-family');
    const saved = DEFAULT_TECHNOLOGY_FAMILIES
      .filter((item) => item.code !== 'network')
      .map((item) => (item.code === 'network_security' ? { code: item.code, label: 'Network and security' } : { code: item.code, label: item.label }));
    const catalogFor = (families: typeof DEFAULT_TECHNOLOGY_FAMILIES) => new TechnologyCatalogService(
      { log: async () => undefined } as any,
      { getSettings: async () => ({ technologyFamilies: families, hostingTypes: DEFAULT_HOSTING_TYPES }) } as any,
    );
    const opts = { manager: runner.manager, tenantId };
    const closed = catalogFor(saved);
    const listed = await closed.notAdopted({ q: 'arista' }, opts);
    assert.equal(listed.items.find((item) => item.key === 'arista-eos')?.family, 'network_security');
    const bySecurity = await closed.notAdopted({ q: 'arista', family: 'network_security' }, opts);
    assert.equal(bySecurity.items.some((item) => item.key === 'arista-eos'), true);
    const byNetwork = await closed.notAdopted({ q: 'arista', family: 'network' }, opts);
    assert.equal(byNetwork.items.some((item) => item.key === 'arista-eos'), false);
    const open = await catalogFor(DEFAULT_TECHNOLOGY_FAMILIES).notAdopted({ q: 'arista' }, opts);
    assert.equal(open.items.find((item) => item.key === 'arista-eos')?.family, 'network');
  });
}

/**
 * The id list of the previous / next band (`listIds`): the rows and the order of the list, with its
 * sort, search and grid filters, every row and not one page.
 */
async function testListIds() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'tec-ids');
    const { technologies } = services();
    const opts = { manager: runner.manager, tenantId };
    await technologies.create({ name: 'PostgreSQL', editor: 'PGDG', family: 'database' }, opts);
    await technologies.create({ name: 'Oracle Database', editor: 'Oracle', family: 'database' }, opts);
    await technologies.create({ name: 'MySQL', editor: 'Oracle', family: 'database' }, opts);
    await technologies.create({ name: 'Tomcat', editor: 'Apache', family: 'application_server' }, opts);

    const same = async (query: Record<string, any>) => {
      const page = await technologies.list({ ...query, limit: 500 }, opts);
      const ids = await technologies.listIds(query, opts);
      assert.deepEqual(ids.ids, page.items.map((item) => item.id), `same order as the list for ${JSON.stringify(query)}`);
      assert.deepEqual(ids.refs, page.items.map((item) => item.reference));
      assert.equal(ids.total, page.total);
      return page.items.map((item) => item.name);
    };
    assert.deepEqual(await same({}), ['MySQL', 'Oracle Database', 'PostgreSQL', 'Tomcat'], 'by name by default');
    assert.deepEqual(await same({ sort: 'name:DESC' }), ['Tomcat', 'PostgreSQL', 'Oracle Database', 'MySQL']);
    const filters = JSON.stringify({ family: { filterType: 'set', values: ['database'] } });
    // Two Oracle rows: the id breaks the tie, the same way in both.
    const byEditor = await same({ sort: 'editor:DESC', filters });
    assert.equal(byEditor.length, 3, 'filtered on the family');
    assert.equal(byEditor[0], 'PostgreSQL', 'then by editor');
    assert.deepEqual(await same({ sort: 'name:DESC', q: 'oracle' }), ['Oracle Database', 'MySQL']);
    assert.deepEqual(await same({ filters: JSON.stringify({ family: { filterType: 'set', values: [] } }) }), []);
    // Beyond one page of the grid: every row.
    assert.equal((await technologies.listIds({ limit: 1 }, opts)).ids.length, 4);
  });
}

runSpecs('technologies-service.integration.spec', [
  ['create and validate', testCreateAndValidate],
  ['CVE.org names', testCveNames],
  ['hosting type', testHostingType],
  ['id list of the record band', testListIds],
  ['catalog family for the tenant', testCatalogFamilyForTenant],
  ['version labels', testVersionLabels],
  ['version order', testVersionOrder],
  ['links and version delete', testLinksAndVersionDelete],
  ['catalog adoption', testAdoption],
  ['catalog adoption: description', testAdoptionDescription],
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
