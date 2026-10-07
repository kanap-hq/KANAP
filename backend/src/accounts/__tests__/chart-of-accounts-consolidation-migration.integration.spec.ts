import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { ChartOfAccountsConsolidation1853860000000 as Migration } from '../../migrations/1853860000000-chart-of-accounts-consolidation';

// Migration 1853860000000 (the consolidation chart), against a real database,
// each test in a transaction that is rolled back. The database is put back in
// the state before the migration (down), then the column is added by hand so
// tenants can already hold consolidation charts, duplicates included (what a
// database where the column existed without its index could hold):
// - a tenant with a global default chart and no consolidation chart: its
//   global default becomes the consolidation chart;
// - a tenant without a global default chart: nothing;
// - a tenant whose consolidation chart is not its global default: kept as is;
// - a tenant with two consolidation charts: the global default keeps the
//   role; without a global default among them, the earliest keeps it;
// - row level security is left as found on both tables written, the unique
//   index exists and refuses a second consolidation chart;
// - a second run changes nothing and logs zero counts.
// The assertions read this test's own tenants, never table-wide counts: the
// database may hold other tenants' charts.

const migration = new Migration();
const LOG_PREFIX = '[Migration] ChartOfAccountsConsolidation:';
const INDEX = 'uq_coa_tenant_consolidation';

async function inRolledBackTransaction(fn: (runner: QueryRunner) => Promise<void>) {
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

async function captureLog<T>(fn: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: any[]) => { lines.push(args.map(String).join(' ')); };
  try {
    return { result: await fn(), lines };
  } finally {
    console.log = original;
  }
}

async function asTenant(runner: QueryRunner, tenantId: string) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

async function seedTenant(runner: QueryRunner, tag: string) {
  const tenantId = randomUUID();
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `coa-cons-${tag}-${tenantId.slice(0, 8)}`, `CoA consolidation ${tag}`],
  );
  return tenantId;
}

type ChartSeed = { code: string; global?: boolean; globalDefault?: boolean; consolidation?: boolean; createdAt?: string };

async function seedChart(runner: QueryRunner, tenantId: string, chart: ChartSeed): Promise<string> {
  await asTenant(runner, tenantId);
  const [row] = await runner.query(
    `INSERT INTO chart_of_accounts (tenant_id, code, name, scope, country_iso, is_global_default, is_consolidation, created_at)
     VALUES ($1, $2, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      tenantId,
      chart.code,
      chart.global ? 'GLOBAL' : 'COUNTRY',
      chart.global ? null : 'FR',
      !!chart.globalDefault,
      !!chart.consolidation,
      chart.createdAt ?? '2026-01-01T00:00:00Z',
    ],
  );
  return row.id;
}

/** The consolidation flag of each chart of a tenant, by code. */
async function flags(runner: QueryRunner, tenantId: string): Promise<Record<string, boolean>> {
  await asTenant(runner, tenantId);
  const rows = await runner.query(`SELECT code, is_consolidation FROM chart_of_accounts WHERE tenant_id = $1 ORDER BY code`, [tenantId]);
  return Object.fromEntries(rows.map((r: any) => [r.code, r.is_consolidation]));
}

async function rowSecurity(runner: QueryRunner, table: string) {
  const [row] = await runner.query(
    `SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced FROM pg_class WHERE oid = $1::regclass`,
    [table],
  );
  return row;
}

async function indexDef(runner: QueryRunner): Promise<string | undefined> {
  const [row] = await runner.query(`SELECT indexdef FROM pg_indexes WHERE indexname = $1`, [INDEX]);
  return row?.indexdef;
}

type Seeded = Record<'withDefault' | 'withoutDefault' | 'alreadySet' | 'duplicates' | 'duplicatesNoDefault', string>;

/** The database before the migration, plus the column, then the five tenants. */
async function seedBeforeMigration(runner: QueryRunner): Promise<Seeded> {
  await migration.down(runner);
  await runner.query(`ALTER TABLE chart_of_accounts ADD COLUMN is_consolidation boolean NOT NULL DEFAULT false`);
  const seeded = {} as Seeded;

  seeded.withDefault = await seedTenant(runner, 'default');
  await seedChart(runner, seeded.withDefault, { code: 'IFRS', global: true, globalDefault: true });
  await seedChart(runner, seeded.withDefault, { code: 'FR-PCG' });

  seeded.withoutDefault = await seedTenant(runner, 'none');
  await seedChart(runner, seeded.withoutDefault, { code: 'FR-PCG' });
  await seedChart(runner, seeded.withoutDefault, { code: 'GROUP', global: true });

  seeded.alreadySet = await seedTenant(runner, 'set');
  await seedChart(runner, seeded.alreadySet, { code: 'IFRS', global: true, globalDefault: true });
  await seedChart(runner, seeded.alreadySet, { code: 'GROUP', global: true, consolidation: true });

  seeded.duplicates = await seedTenant(runner, 'dup');
  await seedChart(runner, seeded.duplicates, { code: 'OLD', global: true, consolidation: true, createdAt: '2025-01-01T00:00:00Z' });
  await seedChart(runner, seeded.duplicates, { code: 'IFRS', global: true, globalDefault: true, consolidation: true, createdAt: '2026-01-01T00:00:00Z' });

  seeded.duplicatesNoDefault = await seedTenant(runner, 'dup2');
  await seedChart(runner, seeded.duplicatesNoDefault, { code: 'LATER', consolidation: true, createdAt: '2026-02-01T00:00:00Z' });
  await seedChart(runner, seeded.duplicatesNoDefault, { code: 'EARLIER', consolidation: true, createdAt: '2026-01-01T00:00:00Z' });

  // Migrations run without a tenant.
  await runner.query(`SELECT set_config('app.current_tenant', '', true)`);
  return seeded;
}

/** Backfill and repair per tenant, the index, row level security as found, the log. */
async function testBackfillAndRepair() {
  await inRolledBackTransaction(async (runner) => {
    const security = {
      chart_of_accounts: await rowSecurity(runner, 'chart_of_accounts'),
      search_index: await rowSecurity(runner, 'search_index'),
    };
    const seeded = await seedBeforeMigration(runner);
    const { lines } = await captureLog(() => migration.up(runner));

    assert.deepEqual(await flags(runner, seeded.withDefault), { 'FR-PCG': false, IFRS: true }, 'the global default becomes the consolidation chart');
    assert.deepEqual(await flags(runner, seeded.withoutDefault), { 'FR-PCG': false, GROUP: false }, 'no global default: no consolidation chart');
    assert.deepEqual(await flags(runner, seeded.alreadySet), { GROUP: true, IFRS: false }, 'an existing consolidation chart is kept');
    assert.deepEqual(await flags(runner, seeded.duplicates), { IFRS: true, OLD: false }, 'duplicates: the global default keeps the role');
    assert.deepEqual(await flags(runner, seeded.duplicatesNoDefault), { EARLIER: true, LATER: false }, 'duplicates: the earliest keeps the role');

    assert.match(String(await indexDef(runner)), /CREATE UNIQUE INDEX .* \(tenant_id\) WHERE is_consolidation/, 'the partial unique index');
    assert.deepEqual(await rowSecurity(runner, 'chart_of_accounts'), security.chart_of_accounts, 'chart_of_accounts: row level security as found');
    assert.deepEqual(await rowSecurity(runner, 'search_index'), security.search_index, 'search_index: row level security as found');

    const summary = lines.find((line) => line.startsWith(LOG_PREFIX));
    assert.ok(summary, 'the counts are logged');
    const backfilled = Number(/: (\d+) tenant\(s\) got/.exec(summary ?? '')?.[1] ?? -1);
    const repaired = Number(/, (\d+) duplicate/.exec(summary ?? '')?.[1] ?? -1);
    // Other tenants of the database count too: at least this test's ones.
    assert.ok(backfilled >= 1, `the backfill is counted (${summary})`);
    assert.ok(repaired >= 2, `the repairs are counted (${summary})`);
    const named = (tenantId: string) => lines.filter((line) => line.includes(`(${tenantId})`));
    assert.deepEqual(named(seeded.withDefault).length, 1, 'the backfilled chart is named');
    assert.match(named(seeded.duplicates)[0] ?? '', /OLD, consolidation role cleared/, 'the repaired chart is named');
    assert.match(named(seeded.duplicatesNoDefault)[0] ?? '', /LATER, consolidation role cleared/, 'the repaired chart is named');
    assert.deepEqual(named(seeded.withoutDefault), [], 'a tenant left alone is not named');
    assert.deepEqual(named(seeded.alreadySet), [], 'a tenant left alone is not named');

    // The index refuses a second consolidation chart in a tenant.
    await asTenant(runner, seeded.withDefault);
    await runner.query('SAVEPOINT dup');
    await assert.rejects(
      runner.query(`UPDATE chart_of_accounts SET is_consolidation = true WHERE tenant_id = $1 AND code = 'FR-PCG'`, [seeded.withDefault]),
      (err: any) => err?.code === '23505' && err?.constraint === INDEX,
    );
    await runner.query('ROLLBACK TO SAVEPOINT dup');
  });
}

/** A second run: nothing changed, zero counts, the index kept. */
async function testRerun() {
  await inRolledBackTransaction(async (runner) => {
    const seeded = await seedBeforeMigration(runner);
    await captureLog(() => migration.up(runner));
    const before = await Promise.all(Object.values(seeded).map((id) => flags(runner, id)));
    const def = await indexDef(runner);

    await runner.query(`SELECT set_config('app.current_tenant', '', true)`);
    const second = await captureLog(() => migration.up(runner));
    assert.deepEqual(
      second.lines,
      [`${LOG_PREFIX} 0 tenant(s) got their global default chart as consolidation chart, 0 duplicate consolidation chart(s) cleared`],
      'a second run changes nothing',
    );
    assert.deepEqual(await Promise.all(Object.values(seeded).map((id) => flags(runner, id))), before, 'the flags are kept');
    assert.equal(await indexDef(runner), def, 'the index is kept');
  });
}

async function main() {
  await dataSource.initialize();
  const failures: string[] = [];
  try {
    for (const test of [testBackfillAndRepair, testRerun]) {
      try {
        await test();
      } catch (err) {
        failures.push(`${test.name}: ${(err as Error).message.split('\n')[0]}`);
      }
    }
  } finally {
    await dataSource.destroy();
  }
  if (failures.length) {
    throw new Error(`chart-of-accounts-consolidation-migration.integration.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
  }
  console.log('chart-of-accounts-consolidation-migration.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
