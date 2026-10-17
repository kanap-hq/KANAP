// @database-spec
import 'dotenv/config';
import type { QueryRunner } from 'typeorm';
import { assert, inRolledBackTransaction, runSpecs, seedTenant, setTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { ADDED_CPE, CPE_VERSIONS, TechnologyCatalogCpe1854300000000 } from '../../migrations/1854300000000-technology-catalog-cpe';
import { CPE_PRODUCT_RE } from '../technology-rows';
import { one } from './technologies.fixtures';

// The migration that gives the technologies already adopted the CPE identifiers and CPE versions
// the catalog gained in lot C3 (1854300000000), against a real database, in one transaction rolled
// back at the end: identifiers added without removing any, an identifier removed by hand that is
// not one of the added ones stays removed, a CPE version set by the tenant is kept, a technology
// without catalog key and the other tenant's rows are handled apart, counts are logged, a rerun
// changes nothing.

async function adopted(runner: QueryRunner, tenantId: string, number: number, name: string, key: string | null, cpe: string[]) {
  await setTenant(runner, tenantId);
  return one(
    runner,
    `INSERT INTO technologies (tenant_id, item_number, name, catalog_key, cpe_products) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [tenantId, number, name, key, cpe],
  );
}

async function version(runner: QueryRunner, tenantId: string, technologyId: string, label: string, cpeVersion: string | null = null) {
  await setTenant(runner, tenantId);
  return one(
    runner,
    `INSERT INTO technology_versions (tenant_id, technology_id, label, cpe_version) VALUES ($1, $2, $3, $4) RETURNING id`,
    [tenantId, technologyId, label, cpeVersion],
  );
}

async function cpeOf(runner: QueryRunner, tenantId: string, technologyId: string): Promise<string[]> {
  await setTenant(runner, tenantId);
  const [row] = await runner.query(`SELECT cpe_products FROM technologies WHERE tenant_id = $1 AND id = $2`, [tenantId, technologyId]);
  return row.cpe_products;
}

async function cpeVersionOf(runner: QueryRunner, tenantId: string, versionId: string): Promise<string | null> {
  await setTenant(runner, tenantId);
  const [row] = await runner.query(`SELECT cpe_version FROM technology_versions WHERE tenant_id = $1 AND id = $2`, [tenantId, versionId]);
  return row.cpe_version;
}

async function slugOf(runner: QueryRunner, tenantId: string): Promise<string> {
  const [row] = await runner.query(`SELECT slug FROM tenants WHERE id = $1`, [tenantId]);
  return row.slug;
}

async function logged(fn: () => Promise<void>): Promise<string> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return lines.join('\n');
}

const SQL_SERVER_ADDED = ADDED_CPE.mssqlserver;

async function testCompletesAdoptedTechnologies() {
  await inRolledBackTransaction(async (runner) => {
    const a = await seedTenant(runner, 'c3-cpe-a');
    const b = await seedTenant(runner, 'c3-cpe-b');
    // Tenant A: SQL Server adopted before lot C3; its versions keep their years.
    const sql = await adopted(runner, a, 1, 'Microsoft SQL Server', 'mssqlserver', ['a:microsoft:sql_server']);
    const v2022 = await version(runner, a, sql, '2022');
    const v2016 = await version(runner, a, sql, '2016 SP3', '2016');
    // Exchange whose Subscription Edition has a CPE version set by the tenant.
    const exchangeA = await adopted(runner, a, 6, 'Microsoft Exchange Server', 'msexchange', ['a:microsoft:exchange_server']);
    const seTyped = await version(runner, a, exchangeA, 'subscription edition su11', '15.2.2562.17');
    // Docker Engine whose `a:docker:engine` the tenant removed by hand: it is not an added identifier.
    const docker = await adopted(runner, a, 2, 'Docker Engine', 'docker-engine', ['a:example:custom']);
    // MongoDB whose identifier the tenant removed: lot C3 added nothing to it.
    const mongo = await adopted(runner, a, 3, 'MongoDB', 'mongodb', []);
    // Samba already holding the added identifier, in a list of its own.
    const samba = await adopted(runner, a, 4, 'Samba', 'samba', ['a:samba:samba', 'a:example:samba']);
    // A technology typed by hand, without catalog key.
    const typed = await adopted(runner, a, 5, 'Microsoft SQL Server (lab)', null, ['a:microsoft:sql_server']);
    const typedVersion = await version(runner, a, typed, '2022');
    // Tenant B: Exchange adopted, its Subscription Edition without CPE version.
    const exchange = await adopted(runner, b, 1, 'Microsoft Exchange Server', 'msexchange', ['a:microsoft:exchange_server']);
    const se = await version(runner, b, exchange, 'Subscription Edition SU11');
    await runner.query(`SELECT set_config('app.current_tenant', '', true)`);

    // Under FORCE RLS, the search index trigger on `technologies` writes only with the tenant set:
    // the migration would fail here otherwise.
    const migration = new TechnologyCatalogCpe1854300000000();
    const log = await logged(() => migration.up(runner));

    assert.deepEqual(await cpeOf(runner, a, sql), ['a:microsoft:sql_server', ...SQL_SERVER_ADDED].sort());
    assert.equal(await cpeVersionOf(runner, a, v2022), null, 'SQL Server keeps its years');
    assert.equal(await cpeVersionOf(runner, a, v2016), '2016');
    assert.equal(await cpeVersionOf(runner, a, seTyped), '15.2.2562.17', 'a CPE version set by the tenant is kept');
    assert.deepEqual(await cpeOf(runner, a, docker), ['a:docker:docker', 'a:example:custom', 'a:mobyproject:moby'], 'a:docker:engine stays removed');
    assert.deepEqual(await cpeOf(runner, a, mongo), [], 'nothing comes back to an entry lot C3 did not complete');
    assert.deepEqual(await cpeOf(runner, a, samba), ['a:samba:samba', 'a:example:samba'], 'a technology holding every added identifier is untouched');
    assert.deepEqual(await cpeOf(runner, a, typed), ['a:microsoft:sql_server'], 'a technology without catalog key is untouched');
    assert.equal(await cpeVersionOf(runner, a, typedVersion), null);
    assert.deepEqual(await cpeOf(runner, b, exchange), ['a:microsoft:exchange_server', 'a:microsoft:exchange_server_subscription_edition']);
    assert.equal(await cpeVersionOf(runner, b, se), '15.2');

    assert.match(log, new RegExp(`tenant ${await slugOf(runner, a)} \\(${a}\\): 3 technologies completed, 0 CPE versions set`));
    assert.match(log, new RegExp(`tenant ${await slugOf(runner, b)} \\(${b}\\): 1 technologies completed, 1 CPE versions set`));

    // A rerun adds nothing.
    const again = await logged(() => migration.up(runner));
    assert.doesNotMatch(again, new RegExp(`\\(${a}\\)|\\(${b}\\)`));
    assert.deepEqual(await cpeOf(runner, a, docker), ['a:docker:docker', 'a:example:custom', 'a:mobyproject:moby']);
  });
}

/** The frozen lists stay in the form the technologies store. */
async function testFrozenLists() {
  for (const [key, ids] of Object.entries(ADDED_CPE)) {
    for (const id of ids) assert.ok(CPE_PRODUCT_RE.test(id), `${key}: ${id}`);
  }
  assert.ok(CPE_VERSIONS.every(([key]) => ADDED_CPE[key]), 'a version list names an entry the migration completes');
}

void runSpecs('technology-catalog-cpe.migration', [
  ['adopted technologies completed', testCompletesAdoptedTechnologies],
  ['frozen lists', testFrozenLists],
]);
