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
// - the accounts mapped to an account of their tenant's consolidation chart
//   take its name and description (typed by hand until then); those already
//   in line, those outside it and those of a tenant without a consolidation
//   chart are left alone;
// - row level security is left as found on the three tables written, the
//   unique index exists and refuses a second consolidation chart;
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

type AccountSeed = { number: number; name: string; description?: string | null; cons?: number | null; consName?: string | null; consDescription?: string | null };

async function seedAccount(runner: QueryRunner, tenantId: string, coaId: string, account: AccountSeed): Promise<string> {
  await asTenant(runner, tenantId);
  const [row] = await runner.query(
    `INSERT INTO accounts (tenant_id, coa_id, account_number, account_name, description,
                           consolidation_account_number, consolidation_account_name, consolidation_account_description, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '2026-01-01T00:00:00Z') RETURNING id`,
    [tenantId, coaId, account.number, account.name, account.description ?? null, account.cons ?? null, account.consName ?? null, account.consDescription ?? null],
  );
  return row.id;
}

/** The consolidation name and description of an account, and whether it was written. */
async function consolidationOf(runner: QueryRunner, tenantId: string, accountId: string) {
  await asTenant(runner, tenantId);
  const [row] = await runner.query(
    `SELECT consolidation_account_number AS number, consolidation_account_name AS name,
            consolidation_account_description AS description, updated_at > '2026-01-01T00:00:00Z' AS touched
     FROM accounts WHERE id = $1`,
    [accountId],
  );
  return row;
}

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

/** The accounts whose consolidation name the resync reads or writes, by role. */
type SeededAccounts = Record<'stale' | 'inLine' | 'outside' | 'noChart' | 'otherChart', string>;

/** The database before the migration, plus the column, then the five tenants and their accounts. */
async function seedBeforeMigration(runner: QueryRunner): Promise<Seeded & { accounts: SeededAccounts }> {
  await migration.down(runner);
  await runner.query(`ALTER TABLE chart_of_accounts ADD COLUMN is_consolidation boolean NOT NULL DEFAULT false`);
  const seeded = {} as Seeded;
  const accounts = {} as SeededAccounts;

  seeded.withDefault = await seedTenant(runner, 'default');
  const ifrs = await seedChart(runner, seeded.withDefault, { code: 'IFRS', global: true, globalDefault: true });
  const fr = await seedChart(runner, seeded.withDefault, { code: 'FR-PCG' });
  await seedAccount(runner, seeded.withDefault, ifrs, { number: 1000, name: 'Tangible', description: 'Physical equipment', cons: 1000, consName: 'Tangible', consDescription: 'Physical equipment' });
  accounts.stale = await seedAccount(runner, seeded.withDefault, fr, { number: 600, name: 'Matériel', cons: 1000, consName: 'Typed by hand', consDescription: 'Old text' });
  accounts.inLine = await seedAccount(runner, seeded.withDefault, fr, { number: 601, name: 'Outillage', cons: 1000, consName: 'Tangible', consDescription: 'Physical equipment' });
  accounts.outside = await seedAccount(runner, seeded.withDefault, fr, { number: 602, name: 'Divers', cons: 9999, consName: 'Legacy group', consDescription: 'Legacy text' });

  seeded.withoutDefault = await seedTenant(runner, 'none');
  const frNone = await seedChart(runner, seeded.withoutDefault, { code: 'FR-PCG' });
  const groupNone = await seedChart(runner, seeded.withoutDefault, { code: 'GROUP', global: true });
  await seedAccount(runner, seeded.withoutDefault, groupNone, { number: 1000, name: 'Group tangible', cons: 1000, consName: 'Group tangible' });
  accounts.noChart = await seedAccount(runner, seeded.withoutDefault, frNone, { number: 600, name: 'Matériel', cons: 1000, consName: 'Typed by hand' });

  seeded.alreadySet = await seedTenant(runner, 'set');
  const ifrsSet = await seedChart(runner, seeded.alreadySet, { code: 'IFRS', global: true, globalDefault: true });
  const groupSet = await seedChart(runner, seeded.alreadySet, { code: 'GROUP', global: true, consolidation: true });
  await seedAccount(runner, seeded.alreadySet, groupSet, { number: 1000, name: 'Group tangible', description: 'Group text', cons: 1000, consName: 'Group tangible', consDescription: 'Group text' });
  // The global default's own account follows the consolidation chart, not itself.
  accounts.otherChart = await seedAccount(runner, seeded.alreadySet, ifrsSet, { number: 1000, name: 'IFRS tangible', cons: 1000, consName: 'IFRS tangible' });

  seeded.duplicates = await seedTenant(runner, 'dup');
  await seedChart(runner, seeded.duplicates, { code: 'OLD', global: true, consolidation: true, createdAt: '2025-01-01T00:00:00Z' });
  await seedChart(runner, seeded.duplicates, { code: 'IFRS', global: true, globalDefault: true, consolidation: true, createdAt: '2026-01-01T00:00:00Z' });

  seeded.duplicatesNoDefault = await seedTenant(runner, 'dup2');
  await seedChart(runner, seeded.duplicatesNoDefault, { code: 'LATER', consolidation: true, createdAt: '2026-02-01T00:00:00Z' });
  await seedChart(runner, seeded.duplicatesNoDefault, { code: 'EARLIER', consolidation: true, createdAt: '2026-01-01T00:00:00Z' });

  // Migrations run without a tenant.
  await runner.query(`SELECT set_config('app.current_tenant', '', true)`);
  return { ...seeded, accounts };
}

/** Backfill and repair per tenant, the index, row level security as found, the log. */
async function testBackfillAndRepair() {
  await inRolledBackTransaction(async (runner) => {
    const security = {
      chart_of_accounts: await rowSecurity(runner, 'chart_of_accounts'),
      accounts: await rowSecurity(runner, 'accounts'),
      search_index: await rowSecurity(runner, 'search_index'),
    };
    const seeded = await seedBeforeMigration(runner);
    const { lines } = await captureLog(() => migration.up(runner));

    assert.deepEqual(await flags(runner, seeded.withDefault), { 'FR-PCG': false, IFRS: true }, 'the global default becomes the consolidation chart');
    assert.deepEqual(await flags(runner, seeded.withoutDefault), { 'FR-PCG': false, GROUP: false }, 'no global default: no consolidation chart');
    assert.deepEqual(await flags(runner, seeded.alreadySet), { GROUP: true, IFRS: false }, 'an existing consolidation chart is kept');
    assert.deepEqual(await flags(runner, seeded.duplicates), { IFRS: true, OLD: false }, 'duplicates: the global default keeps the role');
    assert.deepEqual(await flags(runner, seeded.duplicatesNoDefault), { EARLIER: true, LATER: false }, 'duplicates: the earliest keeps the role');

    // The resync: the consolidation chart's name and description, where they differed.
    const { accounts } = seeded;
    assert.deepEqual(
      await consolidationOf(runner, seeded.withDefault, accounts.stale),
      { number: 1000, name: 'Tangible', description: 'Physical equipment', touched: true },
      'a name typed by hand takes the consolidation chart\'s',
    );
    assert.deepEqual(
      await consolidationOf(runner, seeded.withDefault, accounts.inLine),
      { number: 1000, name: 'Tangible', description: 'Physical equipment', touched: false },
      'an account in line is left alone',
    );
    assert.deepEqual(
      await consolidationOf(runner, seeded.withDefault, accounts.outside),
      { number: 9999, name: 'Legacy group', description: 'Legacy text', touched: false },
      'an account outside the consolidation chart keeps its name',
    );
    assert.deepEqual(
      await consolidationOf(runner, seeded.withoutDefault, accounts.noChart),
      { number: 1000, name: 'Typed by hand', description: null, touched: false },
      'a tenant without a consolidation chart is left alone',
    );
    assert.deepEqual(
      await consolidationOf(runner, seeded.alreadySet, accounts.otherChart),
      { number: 1000, name: 'Group tangible', description: 'Group text', touched: true },
      'the consolidation chart of the tenant, not another chart of the same number',
    );
    await asTenant(runner, seeded.withDefault);
    const [indexed] = await runner.query(
      `SELECT search_vector @@ plainto_tsquery('kanap_en', 'Tangible') AS found FROM search_index WHERE entity_type = 'accounts' AND entity_id = $1`,
      [accounts.stale],
    );
    assert.equal(indexed?.found, true, 'the search index follows the resynced name');
    await runner.query(`SELECT set_config('app.current_tenant', '', true)`);

    assert.match(String(await indexDef(runner)), /CREATE UNIQUE INDEX .* \(tenant_id\) WHERE is_consolidation/, 'the partial unique index');
    assert.deepEqual(await rowSecurity(runner, 'chart_of_accounts'), security.chart_of_accounts, 'chart_of_accounts: row level security as found');
    assert.deepEqual(await rowSecurity(runner, 'accounts'), security.accounts, 'accounts: row level security as found');
    assert.deepEqual(await rowSecurity(runner, 'search_index'), security.search_index, 'search_index: row level security as found');

    const summary = lines.find((line) => line.startsWith(LOG_PREFIX));
    assert.ok(summary, 'the counts are logged');
    const backfilled = Number(/: (\d+) tenant\(s\) got/.exec(summary ?? '')?.[1] ?? -1);
    const repaired = Number(/, (\d+) duplicate/.exec(summary ?? '')?.[1] ?? -1);
    const resynced = Number(/, (\d+) account\(s\) resynced/.exec(summary ?? '')?.[1] ?? -1);
    // Other tenants of the database count too: at least this test's ones.
    assert.ok(backfilled >= 1, `the backfill is counted (${summary})`);
    assert.ok(repaired >= 2, `the repairs are counted (${summary})`);
    assert.ok(resynced >= 2, `the resync is counted (${summary})`);
    const named = (tenantId: string) => lines.filter((line) => line.includes(`(${tenantId})`));
    assert.deepEqual(
      named(seeded.withDefault).map((line) => line.replace(/^.*\): /, '')),
      ['IFRS, global default made the consolidation chart', '1 account(s) resynced from the consolidation chart'],
      'the backfilled chart and the resynced accounts are named',
    );
    assert.match(named(seeded.duplicates)[0] ?? '', /OLD, consolidation role cleared/, 'the repaired chart is named');
    assert.match(named(seeded.duplicatesNoDefault)[0] ?? '', /LATER, consolidation role cleared/, 'the repaired chart is named');
    assert.deepEqual(named(seeded.withoutDefault), [], 'a tenant left alone is not named');
    assert.deepEqual(
      named(seeded.alreadySet).map((line) => line.replace(/^.*\): /, '')),
      ['1 account(s) resynced from the consolidation chart'],
      'a tenant whose chart is kept is named for its resynced accounts only',
    );

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
    const { accounts, ...seeded } = await seedBeforeMigration(runner);
    await captureLog(() => migration.up(runner));
    // One after the other: each read sets its tenant on the shared connection.
    const allFlags = async () => {
      const rows = [];
      for (const id of Object.values(seeded)) rows.push(await flags(runner, id));
      return rows;
    };
    const before = await allFlags();
    assert.equal(before.filter((row) => Object.keys(row).length === 2).length, 5, 'each tenant reads its two charts');
    const tenantOf: Record<keyof SeededAccounts, string> = {
      stale: seeded.withDefault, inLine: seeded.withDefault, outside: seeded.withDefault, noChart: seeded.withoutDefault, otherChart: seeded.alreadySet,
    };
    const names = async () => {
      const rows = [];
      for (const key of Object.keys(accounts) as Array<keyof SeededAccounts>) {
        const { touched: _touched, ...rest } = await consolidationOf(runner, tenantOf[key], accounts[key]);
        rows.push(rest);
      }
      return rows;
    };
    const namesBefore = await names();
    const def = await indexDef(runner);

    await runner.query(`SELECT set_config('app.current_tenant', '', true)`);
    const second = await captureLog(() => migration.up(runner));
    assert.deepEqual(
      second.lines,
      [`${LOG_PREFIX} 0 tenant(s) got their global default chart as consolidation chart, 0 duplicate consolidation chart(s) cleared, 0 account(s) resynced from the consolidation chart`],
      'a second run changes nothing',
    );
    assert.deepEqual(await allFlags(), before, 'the flags are kept');
    assert.deepEqual(await names(), namesBefore, 'the consolidation names are kept');
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
