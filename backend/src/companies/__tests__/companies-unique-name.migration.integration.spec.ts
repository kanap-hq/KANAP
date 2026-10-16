import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { CompaniesUniqueNameCi1854110000000 } from '../../migrations/1854110000000-companies-unique-name-ci';

// Company names are unique in a tenant whatever their case (migration 1854110000000), against a
// real database, each test in one transaction rolled back at the end:
// - the database refuses "sap" when "SAP" exists, and accepts it in another tenant;
// - from the state before the migration (its down()), names equal but for case are renamed
//   deterministically: the earliest keeps its name, the later ones get the first free "(n)"
//   whatever its case; renames are logged, the other tenant is untouched, RLS is put back, and a
//   rerun changes nothing.

async function inRollback(fn: (runner: QueryRunner) => Promise<void>) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await fn(runner);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function seedTenant(runner: QueryRunner, tag: string) {
  const tenantId = randomUUID();
  const slug = `${tag}-${tenantId.slice(0, 8)}`;
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, 'Company names', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, slug],
  );
  return { tenantId, slug };
}

async function insertCompany(runner: QueryRunner, tenantId: string, name: string, createdAt = '2026-01-01T00:00:00Z') {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const [row] = await runner.query(
    `INSERT INTO companies (tenant_id, name, country_iso, city, status, created_at) VALUES ($1, $2, 'FR', 'Lyon', 'enabled', $3) RETURNING id::text AS id`,
    [tenantId, name, createdAt],
  );
  return row.id as string;
}

async function namesOf(runner: QueryRunner, tenantId: string): Promise<Record<string, string>> {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const rows: Array<{ id: string; name: string }> = await runner.query(
    `SELECT id::text AS id, name FROM companies WHERE tenant_id = $1`,
    [tenantId],
  );
  return Object.fromEntries(rows.map((row) => [row.id, row.name]));
}

async function rlsStates(runner: QueryRunner) {
  return runner.query(
    `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
      WHERE relnamespace = 'public'::regnamespace AND relrowsecurity ORDER BY relname`,
  );
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

const isDuplicate = (err: any) => err?.code === '23505';

/** The database refuses a name another company of the tenant has in another case. */
async function testDatabaseRefusesCaseVariant() {
  await inRollback(async (runner) => {
    const a = await seedTenant(runner, 'comp-ci-a');
    const b = await seedTenant(runner, 'comp-ci-b');
    await insertCompany(runner, a.tenantId, 'SAP');
    await insertCompany(runner, b.tenantId, 'sap');
    await runner.query('SAVEPOINT variant');
    await assert.rejects(insertCompany(runner, a.tenantId, 'sap'), isDuplicate, '"sap" is refused next to "SAP"');
    await runner.query('ROLLBACK TO SAVEPOINT variant');
  });
}

/** From the state before it ran, the migration renames the later case duplicates and creates the index. */
async function testMigrationRenamesLaterDuplicates() {
  await inRollback(async (runner) => {
    const migration = new CompaniesUniqueNameCi1854110000000();
    await migration.down(runner);
    const rlsBefore = await rlsStates(runner);
    const a = await seedTenant(runner, 'comp-ci-a');
    const b = await seedTenant(runner, 'comp-ci-b');
    const earliest = await insertCompany(runner, a.tenantId, 'SAP', '2026-01-01T00:00:00Z');
    const second = await insertCompany(runner, a.tenantId, 'sap', '2026-02-01T00:00:00Z');
    const third = await insertCompany(runner, a.tenantId, 'Sap', '2026-03-01T00:00:00Z');
    const taken = await insertCompany(runner, a.tenantId, 'SAP (2)', '2026-04-01T00:00:00Z');
    const other = await insertCompany(runner, a.tenantId, 'Oracle', '2026-01-01T00:00:00Z');
    const exact = await insertCompany(runner, a.tenantId, 'Oracle', '2026-06-01T00:00:00Z');
    const elsewhere = await insertCompany(runner, b.tenantId, 'sap', '2026-01-01T00:00:00Z');
    const elsewhereUpper = await insertCompany(runner, b.tenantId, 'SAP', '2026-05-01T00:00:00Z');
    await runner.query(`SELECT set_config('app.current_tenant', '', true)`);

    const log = await logged(() => migration.up(runner));

    assert.deepEqual(await namesOf(runner, a.tenantId), {
      [earliest]: 'SAP',
      [second]: 'sap (3)',
      [third]: 'Sap (4)',
      [taken]: 'SAP (2)',
      [other]: 'Oracle',
      [exact]: 'Oracle (2)',
    });
    assert.deepEqual(await namesOf(runner, b.tenantId), { [elsewhere]: 'sap', [elsewhereUpper]: 'SAP (2)' });
    assert.match(log, new RegExp(`tenant ${a.slug} \\(${a.tenantId}\\): company ${second} renamed "sap" to "sap \\(3\\)"`));
    assert.match(log, new RegExp(`tenant ${b.slug} .*renamed "SAP" to "SAP \\(2\\)"`));
    assert.deepEqual(await rlsStates(runner), rlsBefore, 'RLS is put back as found');
    const [index] = await runner.query(`SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_companies_tenant_name_ci'`);
    assert.match(String(index?.indexdef), /UNIQUE INDEX .* \(tenant_id, lower\(name\)\)/);

    await runner.query('SAVEPOINT variant');
    await assert.rejects(insertCompany(runner, a.tenantId, 'oracle'), isDuplicate);
    await runner.query('ROLLBACK TO SAVEPOINT variant');

    const rerun = await logged(() => migration.up(runner));
    assert.match(rerun, /nothing renamed/, 'a second run changes nothing');
  });
}

async function main() {
  await dataSource.initialize();
  const failures: string[] = [];
  try {
    for (const test of [testDatabaseRefusesCaseVariant, testMigrationRenamesLaterDuplicates]) {
      try {
        await test();
        console.log(`  ok ${test.name}`);
      } catch (err) {
        failures.push(`${test.name}: ${(err as Error).message.split('\n').slice(0, 8).join(' | ')}`);
      }
    }
  } finally {
    await dataSource.destroy();
  }
  if (failures.length) {
    throw new Error(`companies-unique-name.migration.integration.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
  }
  console.log('companies-unique-name.migration.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
