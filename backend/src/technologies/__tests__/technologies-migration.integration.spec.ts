// @database-spec
import 'dotenv/config';
import { QueryRunner } from 'typeorm';
import { Technologies1854190000000 as Migration } from '../../migrations/1854190000000-technologies';
import { assert, inRolledBackTransaction, runSpecs, seedTenant, setTenant } from '../../spend/__tests__/round-inputs.fixtures';

// Migration 1854190000000 (the technology layer), against a real database, in transactions rolled
// back at the end:
// - as migrated: every new table has RLS enabled and forced and one policy `<table>_tenant_isolation`
//   with USING and WITH CHECK; the unique keys (tenant_id, id) it needs exist;
// - a second up() changes nothing;
// - the link keys: one row per (asset, technology, version) with an unknown version counted once
//   (NULLS NOT DISTINCT), a version of another technology refused, and the delete of a version
//   makes the link "version unknown" without clearing its tenant.

const migration = new Migration();

const NEW_TABLES = [
  'technologies', 'technology_versions', 'asset_technologies', 'application_technologies', 'technology_owners',
  'technology_contracts', 'technology_spend_items', 'technology_projects', 'technology_attachments', 'technology_links',
  'incident_technologies', 'application_business_processes',
];

async function shape(runner: QueryRunner) {
  const tables: Array<{ relname: string; rls: boolean; forced: boolean }> = await runner.query(
    `SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced FROM pg_class c
      WHERE c.relname = ANY($1::text[]) AND c.relnamespace = current_schema()::regnamespace ORDER BY c.relname`,
    [NEW_TABLES],
  );
  const policies: Array<{ table: string; polname: string; using: string; check: string; cmd: string }> = await runner.query(
    `SELECT c.relname AS table, p.polname, pg_get_expr(p.polqual, p.polrelid) AS using,
            pg_get_expr(p.polwithcheck, p.polrelid) AS check, p.polcmd AS cmd
       FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
      WHERE c.relname = ANY($1::text[]) ORDER BY c.relname, p.polname`,
    [NEW_TABLES],
  );
  const constraints: Array<{ table: string; conname: string; def: string }> = await runner.query(
    `SELECT c.relname AS table, k.conname, pg_get_constraintdef(k.oid) AS def
       FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
      WHERE c.relname = ANY($1::text[]) ORDER BY c.relname, k.conname`,
    [NEW_TABLES],
  );
  const indexes: Array<{ indexname: string }> = await runner.query(
    `SELECT indexname FROM pg_indexes WHERE tablename = ANY($1::text[]) ORDER BY indexname`,
    [NEW_TABLES],
  );
  const tenantKeys: Array<{ table: string }> = await runner.query(
    `SELECT DISTINCT c.relname AS table FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid
      WHERE c.relname IN ('assets', 'business_processes', 'portfolio_projects', 'incidents') AND i.indisunique
        AND pg_get_indexdef(i.indexrelid) LIKE '%(tenant_id, id)' ORDER BY 1`,
  );
  const sequenceCheck: Array<{ def: string }> = await runner.query(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'item_sequences_entity_type_check'`,
  );
  return { tables, policies, constraints, indexes, tenantKeys, sequenceCheck };
}

async function testMigratedAndRerun() {
  await inRolledBackTransaction(async (runner) => {
    const before = await shape(runner);
    assert.deepEqual(before.tables.map((t) => t.relname), [...NEW_TABLES].sort());
    for (const table of before.tables) assert.deepEqual({ rls: table.rls, forced: table.forced }, { rls: true, forced: true }, table.relname);
    assert.deepEqual(
      before.policies,
      [...NEW_TABLES].sort().map((table) => ({
        table,
        polname: `${table}_tenant_isolation`,
        using: '(tenant_id = app_current_tenant())',
        check: '(tenant_id = app_current_tenant())',
        cmd: '*',
      })),
    );
    assert.deepEqual(before.tenantKeys.map((k) => k.table), ['assets', 'business_processes', 'incidents', 'portfolio_projects']);
    assert.match(before.sequenceCheck[0].def, /'technology'/);
    const defs = new Map(before.constraints.map((c) => [c.conname, c.def]));
    assert.equal(
      defs.get('asset_technologies_version_fk'),
      'FOREIGN KEY (tenant_id, technology_id, technology_version_id) REFERENCES technology_versions(tenant_id, technology_id, id) ON DELETE SET NULL (technology_version_id)',
    );
    assert.equal(defs.get('asset_technologies_key'), 'UNIQUE NULLS NOT DISTINCT (tenant_id, asset_id, technology_id, technology_version_id)');
    assert.equal(defs.get('application_technologies_key'), 'UNIQUE NULLS NOT DISTINCT (tenant_id, application_id, technology_id, technology_version_id)');

    await migration.up(runner);
    assert.deepEqual(await shape(runner), before, 'a second up() changes nothing');
  });
}

async function seed(runner: QueryRunner, tag: string) {
  const tenantId = await seedTenant(runner, tag);
  const one = async (sql: string, params: unknown[]) => (await runner.query(sql, params))[0].id as string;
  const assetId = await one(`INSERT INTO assets (tenant_id, name, kind, environment) VALUES ($1, $2, 'vm', 'prod') RETURNING id`, [tenantId, `SRV ${tag}`]);
  const sql = await one(`INSERT INTO technologies (tenant_id, item_number, name, family) VALUES ($1, 1, 'SQL Server', 'database') RETURNING id`, [tenantId]);
  const pg = await one(`INSERT INTO technologies (tenant_id, item_number, name, family) VALUES ($1, 2, 'PostgreSQL', 'database') RETURNING id`, [tenantId]);
  const sql2019 = await one(`INSERT INTO technology_versions (tenant_id, technology_id, label) VALUES ($1, $2, '2019') RETURNING id`, [tenantId, sql]);
  const pg15 = await one(`INSERT INTO technology_versions (tenant_id, technology_id, label) VALUES ($1, $2, '15') RETURNING id`, [tenantId, pg]);
  return { tenantId, assetId, sql, pg, sql2019, pg15 };
}

async function rejectsWith(runner: QueryRunner, code: string, fn: () => Promise<unknown>, label: string) {
  await runner.query('SAVEPOINT expect_failure');
  let error: any = null;
  try {
    await fn();
  } catch (e) {
    error = e;
  }
  await runner.query('ROLLBACK TO SAVEPOINT expect_failure');
  assert.ok(error, `${label}: expected an error`);
  assert.equal(error.code ?? error.driverError?.code, code, `${label}: ${error?.message}`);
}

async function testLinkKeys() {
  await inRolledBackTransaction(async (runner) => {
    const s = await seed(runner, 'tecmig');
    const link = (version: string | null, technology = s.sql) => runner.query(
      `INSERT INTO asset_technologies (tenant_id, asset_id, technology_id, technology_version_id) VALUES ($1, $2, $3, $4)`,
      [s.tenantId, s.assetId, technology, version],
    );
    await link(null);
    await rejectsWith(runner, '23505', () => link(null), 'two "SQL Server, version unknown" on one server');
    await link(s.sql2019);
    await rejectsWith(runner, '23503', () => link(s.pg15), 'a PostgreSQL version on a SQL Server link');
    await rejectsWith(
      runner, '23514',
      () => runner.query(`UPDATE technologies SET replaced_by_id = id WHERE id = $1`, [s.sql]),
      'a technology replaced by itself',
    );

    // The delete of a version clears the version only: the link stays, of its tenant.
    await link(s.pg15, s.pg);
    await runner.query(`DELETE FROM technology_versions WHERE id = $1`, [s.pg15]);
    const rows: Array<{ tenant_id: string; technology_version_id: string | null }> = await runner.query(
      `SELECT tenant_id, technology_version_id FROM asset_technologies WHERE technology_id = $1`,
      [s.pg],
    );
    assert.deepEqual(rows, [{ tenant_id: s.tenantId, technology_version_id: null }]);

    // Another tenant sees none of it, and cannot name this tenant's technology.
    const other = await seed(runner, 'tecmig-other');
    assert.deepEqual(await runner.query(`SELECT id FROM technologies WHERE id = $1`, [s.sql]), []);
    await rejectsWith(
      runner, '23503',
      () => runner.query(
        `INSERT INTO asset_technologies (tenant_id, asset_id, technology_id) VALUES ($1, $2, $3)`,
        [other.tenantId, other.assetId, s.sql],
      ),
      'a link to the technology of another tenant',
    );
    await setTenant(runner, s.tenantId);
  });
}

runSpecs('technologies-migration.integration.spec', [['migrated and rerun', testMigratedAndRerun], ['link keys', testLinkKeys]]).catch((err) => {
  console.error(err);
  process.exit(1);
});
