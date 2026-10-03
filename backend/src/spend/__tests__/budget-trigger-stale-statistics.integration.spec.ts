import 'dotenv/config';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { BudgetFreshnessCounters1853740000000 } from '../../migrations/1853740000000-budget-freshness-counters';
import { BudgetTriggerPlans1853850000000 } from '../../migrations/1853850000000-budget-trigger-plans';
import { assert, inRolledBackTransaction, Kind, repeat, runSpecs, seedLine, seedTenant } from './round-inputs.fixtures';

// The budget statement triggers with stale statistics (plan planning/perf-scale, item 4C bis;
// migration 1853850000000), against the database: a tenant with 25,000 versions, the planner
// statistics of the versions, round inputs and totals tables taken while they were empty
// (reltuples 0 over their real pages, so every scan reads as one row), then one statement
// each: 16,000 round inputs inserted, 24,000 months inserted, updated, half of them deleted.
// Each must finish in seconds, and give the counters and totals the rows hold. With the bodies
// of 1853740000000 the first statement alone ran past the 30 s request timeout: run the spec
// with STALE_STATS_PREVIOUS_FUNCTIONS=1 to install them (inside the rolled-back transaction)
// and see the statements time out instead. The migration itself: a rerun repairs a missing,
// disabled or replica-only trigger, leaves the others, rebuilds totals that drifted while an
// amounts trigger did not fire; down() puts the previous bodies back.
// Each test runs in a transaction rolled back at the end; the tables' statistics are taken
// again afterwards (ANALYZE), whatever the outcome.
// @database-spec: run-ci-tests.js runs this file in its serial database lane.

const PREVIOUS = process.env.STALE_STATS_PREVIOUS_FUNCTIONS === '1';
const ITEMS = 5000;
const FIRST_YEAR = 2041;
const YEARS = 5;
const ROUND_INPUTS = 16000;
const VERSIONS_WITH_MONTHS = 2000;
/** One statement over thousands of rows; the previous bodies took minutes. */
const LIMIT_MS = 10000;
const STATEMENT_TIMEOUT = '20s';

const T = {
  opex: { items: 'spend_items', itemFk: 'spend_item_id', versions: 'spend_versions', amounts: 'spend_amounts', rounds: 'spend_round_inputs', totals: 'spend_version_totals' },
  capex: { items: 'capex_items', itemFk: 'capex_item_id', versions: 'capex_versions', amounts: 'capex_amounts', rounds: 'capex_round_inputs', totals: 'capex_version_totals' },
} as const;

const staleTables = (kind: Kind) => [T[kind].versions, T[kind].rounds, T[kind].totals];

/** 5,000 lines and their 25,000 versions, in two statements (the lines' own triggers are off: the search index is not the subject). */
async function seedVersions(runner: QueryRunner, kind: Kind, tenantId: string) {
  const t = T[kind];
  await runner.query(`ALTER TABLE ${t.items} DISABLE TRIGGER USER`);
  if (kind === 'opex') {
    await runner.query(
      `INSERT INTO spend_items (tenant_id, product_name, currency, effective_start, item_number)
       SELECT $1, 'Stale statistics line ' || g, 'EUR', '2020-01-01', g FROM generate_series(1, $2::int) g`,
      [tenantId, ITEMS],
    );
  } else {
    await runner.query(
      `INSERT INTO capex_items (tenant_id, description, ppe_type, investment_type, priority, currency, effective_start, item_number)
       SELECT $1, 'Stale statistics line ' || g, 'hardware', 'replacement', 'medium', 'EUR', '2020-01-01', g FROM generate_series(1, $2::int) g`,
      [tenantId, ITEMS],
    );
  }
  await runner.query(`ALTER TABLE ${t.items} ENABLE TRIGGER USER`);
  await runner.query(
    `INSERT INTO ${t.versions} (tenant_id, ${t.itemFk}, version_name, input_grain, as_of_date, budget_year${kind === 'capex' ? ', allocation_method' : ''})
     SELECT i.tenant_id, i.id, 'Y' || y, 'monthly', make_date(y, 1, 1), y${kind === 'capex' ? `, 'default'` : ''}
       FROM ${t.items} i, generate_series($2::int, $3::int) y
      WHERE i.tenant_id = $1`,
    [tenantId, FIRST_YEAR, FIRST_YEAR + YEARS - 1],
  );
}

/**
 * Statistics of the scope's versions, round inputs and totals as ANALYZE takes them on empty
 * tables: inside a savepoint every row of every tenant is deleted (the foreign keys to those
 * tables dropped there, so nothing cascades) and the tables analysed, then the savepoint goes
 * back. The rows and the constraints return; pg_class keeps reltuples 0 over the tables' pages
 * (ANALYZE writes it in place), so the planner reads each table as one row.
 */
async function makeStatisticsStale(runner: QueryRunner, kind: Kind, tenantId: string) {
  const tables = staleTables(kind);
  await runner.query('SAVEPOINT stale_statistics');
  const foreignKeys: Array<{ table: string; name: string }> = await runner.query(
    `SELECT conrelid::regclass::text AS table, conname::text AS name FROM pg_constraint
      WHERE contype = 'f' AND confrelid = ANY ($1::regclass[]) ORDER BY 1, 2`,
    [tables],
  );
  for (const fk of foreignKeys) await runner.query(`ALTER TABLE ${fk.table} DROP CONSTRAINT ${fk.name}`);
  const tenants: Array<{ id: string }> = await runner.query('SELECT id FROM tenants');
  for (const tenant of tenants) {
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenant.id]);
    for (const table of tables) await runner.query(`DELETE FROM ${table}`);
  }
  await runner.query(`ANALYZE ${tables.join(', ')}`);
  await runner.query('ROLLBACK TO SAVEPOINT stale_statistics');
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const stats: Array<{ name: string; reltuples: number; relpages: number }> = await runner.query(
    `SELECT relname::text AS name, reltuples::float8 AS reltuples, relpages FROM pg_class WHERE oid = ANY ($1::regclass[]) ORDER BY 1`,
    [tables],
  );
  const versions = stats.find((s) => s.name === T[kind].versions);
  assert.ok(stats.every((s) => s.reltuples === 0), `${kind}: statistics taken on empty tables: ${JSON.stringify(stats)}`);
  assert.ok(versions && versions.relpages > 0, `${kind}: the versions table keeps its pages, so it reads as one row`);
}

type Statement = { label: string; sql: string; params: unknown[]; rows: number };

/** The statements timed, in order: each acts on what the ones before it wrote. */
function statements(kind: Kind, tenantId: string): Statement[] {
  const t = T[kind];
  const firstVersions = (limit: number) => `SELECT * FROM ${t.versions} WHERE tenant_id = $1 ORDER BY id LIMIT ${limit}`;
  return [
    {
      label: `one INSERT of ${ROUND_INPUTS} round inputs`,
      sql: `INSERT INTO ${t.rounds} (tenant_id, version_id, measure, period_start, period_end, method)
            SELECT v.tenant_id, v.id, 'planned', make_date(v.budget_year, 1, 1), make_date(v.budget_year, 12, 31), 'manual'
              FROM (${firstVersions(ROUND_INPUTS)}) v`,
      params: [tenantId],
      rows: ROUND_INPUTS,
    },
    {
      label: `one INSERT of ${VERSIONS_WITH_MONTHS * 12} months`,
      sql: `INSERT INTO ${t.amounts} (tenant_id, version_id, period, planned)
            SELECT v.tenant_id, v.id, make_date(v.budget_year, m, 1), 100
              FROM (${firstVersions(VERSIONS_WITH_MONTHS)}) v, generate_series(1, 12) m`,
      params: [tenantId],
      rows: VERSIONS_WITH_MONTHS * 12,
    },
    {
      label: `one UPDATE of ${VERSIONS_WITH_MONTHS * 12} months`,
      sql: `UPDATE ${t.amounts} SET planned = planned + 1 WHERE tenant_id = $1`,
      params: [tenantId],
      rows: VERSIONS_WITH_MONTHS * 12,
    },
    {
      label: `one DELETE of ${VERSIONS_WITH_MONTHS * 6} months`,
      sql: `DELETE FROM ${t.amounts} WHERE tenant_id = $1 AND EXTRACT(MONTH FROM period) > 6`,
      params: [tenantId],
      rows: VERSIONS_WITH_MONTHS * 6,
    },
  ];
}

/** Runs one statement in a savepoint; returns its duration, or 'timeout' when the statement timeout cancelled it. */
async function timed(runner: QueryRunner, statement: Statement): Promise<number | 'timeout'> {
  await runner.query('SAVEPOINT stale_statement');
  const started = Date.now();
  try {
    await runner.query(statement.sql, statement.params);
  } catch (error: any) {
    await runner.query('ROLLBACK TO SAVEPOINT stale_statement');
    if ((error?.driverError?.code ?? error?.code) === '57014') return 'timeout';
    throw error;
  }
  const ms = Date.now() - started;
  await runner.query('RELEASE SAVEPOINT stale_statement');
  return ms;
}

/** budget_rev of the tenant's versions, by value: what each statement bumped once. */
async function revisions(runner: QueryRunner, kind: Kind, tenantId: string) {
  const rows: Array<{ rev: number; n: number }> = await runner.query(
    `SELECT budget_rev AS rev, count(*)::int AS n FROM ${T[kind].versions} WHERE tenant_id = $1 GROUP BY 1 ORDER BY 1`,
    [tenantId],
  );
  return Object.fromEntries(rows.map((r) => [r.rev, r.n]));
}

/** The totals rows against the months of each version's year, recomputed (the 2A invariant). */
async function assertTotals(runner: QueryRunner, kind: Kind, tenantId: string) {
  const t = T[kind];
  const [summary] = await runner.query(
    `SELECT count(*)::int AS rows, count(*) FILTER (WHERE planned = 606 AND committed = 0 AND forecast = 0 AND actual = 0 AND expected_landing = 0)::int AS expected
       FROM ${t.totals} WHERE tenant_id = $1`,
    [tenantId],
  );
  assert.deepEqual(summary, { rows: VERSIONS_WITH_MONTHS, expected: VERSIONS_WITH_MONTHS }, `${kind}: one totals row per version with months, six months of 101`);
  const [{ differ }] = await runner.query(
    `SELECT count(*)::int AS differ
       FROM ${t.totals} x
       FULL JOIN (SELECT a.version_id, sum(coalesce(a.planned, 0)) AS planned
                    FROM ${t.amounts} a JOIN ${t.versions} v ON v.id = a.version_id
                   WHERE a.tenant_id = $1 AND EXTRACT(YEAR FROM a.period) = v.budget_year
                   GROUP BY a.version_id) s ON s.version_id = x.version_id
      WHERE (x.tenant_id = $1 OR x.version_id IS NULL) AND x.planned IS DISTINCT FROM s.planned`,
    [tenantId],
  );
  assert.equal(differ, 0, `${kind}: the totals equal the sums of the months`);
}

async function testStaleStatistics(kind: Kind) {
  try {
    await inRolledBackTransaction(async (runner) => {
      if (PREVIOUS) {
        const log = console.log;
        console.log = () => undefined;
        try {
          await new BudgetFreshnessCounters1853740000000().up(runner);
        } finally {
          console.log = log;
        }
      }
      const tenantId = await seedTenant(runner, `stale-stats-${kind}`);
      await seedVersions(runner, kind, tenantId);
      await makeStatisticsStale(runner, kind, tenantId);
      await runner.query(`SELECT set_config('statement_timeout', $1, true)`, [STATEMENT_TIMEOUT]);

      // A session mode other than the two step 4 switches between: a leak would show.
      const sessionMode = 'force_generic_plan';
      await runner.query(`SELECT set_config('plan_cache_mode', $1, true)`, [sessionMode]);
      const timings: string[] = [];
      for (const statement of statements(kind, tenantId)) {
        const ms = await timed(runner, statement);
        timings.push(`${statement.label}: ${ms === 'timeout' ? `cancelled at ${STATEMENT_TIMEOUT}` : `${ms} ms`}`);
        if (PREVIOUS) {
          // The previous bodies: the cliff. The first two statements are enough to show it.
          assert.ok(ms === 'timeout' || ms > LIMIT_MS, `${kind}: ${statement.label} with the previous functions: ${ms} ms`);
          if (timings.length === 2) break;
          continue;
        }
        assert.ok(ms !== 'timeout' && ms < LIMIT_MS, `${kind}: ${statement.label} took ${ms === 'timeout' ? `more than ${STATEMENT_TIMEOUT}` : `${ms} ms`} (limit ${LIMIT_MS} ms)`);
      }
      console.log(`  ${kind}${PREVIOUS ? ' (previous functions)' : ''}: ${timings.join('; ')}`);
      if (PREVIOUS) return;

      // Step 4 sets the plan cache mode inside the function only: the session keeps its own.
      assert.equal((await runner.query('SHOW plan_cache_mode'))[0].plan_cache_mode, sessionMode, `${kind}: the session's plan cache mode is untouched`);
      // The checks below read with the statistics as they now are (ANALYZE sees this
      // transaction's rows), without the statements' timeout.
      await runner.query(`SELECT set_config('statement_timeout', '0', true)`);
      await runner.query(`ANALYZE ${staleTables(kind).join(', ')}, ${T[kind].amounts}`);
      // Same results as the rows hold: each statement bumped each version it touched once.
      assert.deepEqual(await revisions(runner, kind, tenantId), {
        1: ITEMS * YEARS - ROUND_INPUTS,
        2: ROUND_INPUTS - VERSIONS_WITH_MONTHS,
        5: VERSIONS_WITH_MONTHS,
      }, `${kind}: budget_rev +1 per round input, +1 per months statement`);
      await assertTotals(runner, kind, tenantId);
    });
  } finally {
    // The statistics as they really are again, for whatever runs next on this database.
    await dataSource.query(`ANALYZE ${staleTables(kind).join(', ')}, ${T[kind].amounts}`);
  }
}

const FUNCTIONS = [
  ...['spend', 'capex'].flatMap((p) => [`${p}_amounts_version_totals`, `${p}_item_analytics_values_row_version`,
    `${p}_round_inputs_budget_rev`, `${p}_round_input_lines_budget_rev`, `${p}_allocations_budget_rev`]),
];

type TriggerRow = { name: string; oid: string; enabled: string };

async function triggers(runner: QueryRunner): Promise<Map<string, TriggerRow>> {
  const rows: TriggerRow[] = await runner.query(
    `SELECT t.tgname::text AS name, t.oid::text AS oid, t.tgenabled::text AS enabled
       FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE NOT t.tgisinternal AND p.proname = ANY ($1::text[])`,
    [FUNCTIONS],
  );
  return new Map(rows.map((row) => [row.name, row]));
}

/** Which bodies the functions run: those of 1853850000000 are set to plan each call (plan cache mode). */
async function bodies(runner: QueryRunner): Promise<string[]> {
  const rows: Array<{ body: string }> = await runner.query(
    `SELECT CASE WHEN 'plan_cache_mode=force_custom_plan' = ANY (proconfig) THEN '1853850000000' ELSE '1853740000000' END AS body
       FROM pg_proc WHERE proname = ANY ($1::text[]) AND pronamespace = 'public'::regnamespace`,
    [FUNCTIONS],
  );
  assert.equal(rows.length, FUNCTIONS.length, 'every function exists');
  return [...new Set(rows.map((row) => row.body))];
}

const RLS_TABLES = ['spend_amounts', 'spend_versions', 'spend_version_totals', 'capex_amounts', 'capex_versions', 'capex_version_totals'];

async function rlsState(runner: QueryRunner): Promise<Record<string, string>> {
  const rows: Array<{ name: string; enabled: boolean; forced: boolean }> = await runner.query(
    `SELECT relname::text AS name, relrowsecurity AS enabled, relforcerowsecurity AS forced FROM pg_class
      WHERE oid = ANY ($1::regclass[]) ORDER BY relname`,
    [RLS_TABLES],
  );
  return Object.fromEntries(rows.map((row) => [row.name, `${row.enabled ? 'enabled' : 'disabled'}${row.forced ? '+forced' : ''}`]));
}

/**
 * The migration again on a migrated database: the functions are replaced; a trigger found
 * missing, disabled or firing in replica sessions only is created again (and named in the log),
 * the others are left as they are. Months written while an amounts trigger did not fire are
 * missing from the totals: the rerun rebuilds them, with row level security put back as found,
 * and says that the counters those writes missed cannot be rebuilt. down() puts back the bodies
 * of 1853740000000, up() the new ones.
 */
async function testMigrationRerunAndDown() {
  await inRolledBackTransaction(async (runner) => {
    assert.deepEqual(await bodies(runner), ['1853850000000'], 'the database runs the bodies of 1853850000000');
    const before = await triggers(runner);
    assert.equal(before.size, FUNCTIONS.length * 3, 'three statement triggers per function');
    const rls = await rlsState(runner);

    // A CAPEX line whose months change while its update trigger is off: its totals drift.
    const tenantId = await seedTenant(runner, 'stale-stats-rerun');
    const { versionId } = await seedLine(runner, 'capex', tenantId, FIRST_YEAR, { planned: repeat('10', 12) });
    await runner.query('ALTER TABLE capex_amounts DISABLE TRIGGER capex_amounts_version_totals_update');
    await runner.query(`UPDATE capex_amounts SET planned = planned + 5 WHERE version_id = $1`, [versionId]);
    const planned = async () => (await runner.query(`SELECT planned::text AS planned FROM capex_version_totals WHERE version_id = $1`, [versionId]))[0]?.planned;
    assert.equal(await planned(), '120.00', 'the totals missed the update');

    await runner.query('DROP TRIGGER spend_round_inputs_budget_rev_insert ON spend_round_inputs');
    await runner.query('ALTER TABLE spend_allocations ENABLE REPLICA TRIGGER spend_allocations_budget_rev_delete');
    const repairedNames = ['spend_round_inputs_budget_rev_insert', 'spend_allocations_budget_rev_delete', 'capex_amounts_version_totals_update'];
    const logged: string[] = [];
    const log = console.log;
    console.log = (...args: unknown[]) => { logged.push(args.join(' ')); };
    try {
      await new BudgetTriggerPlans1853850000000().up(runner);
    } finally {
      console.log = log;
    }
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    const after = await triggers(runner);
    assert.equal(after.size, before.size, 'every trigger is there again');
    for (const [name, row] of after) {
      assert.equal(row.enabled, 'O', `${name} fires on the app's writes`);
      if (!repairedNames.includes(name)) assert.equal(row.oid, before.get(name)!.oid, `${name} left as it was`);
    }
    assert.equal(await planned(), '180.00', 'the totals rebuilt from the months');
    assert.deepEqual(await rlsState(runner), rls, 'RLS back as found after the rebuild');
    const [{ slug }] = await runner.query(`SELECT slug FROM tenants WHERE id = $1`, [tenantId]);
    const prefix = '[Migration] BudgetTriggerPlans:';
    assert.deepEqual(logged.filter((line) => !line.includes('totals rebuilt') || line.includes(tenantId)), [
      `${prefix} budget statement trigger functions replaced; triggers created again: `
      + 'spend_round_inputs.spend_round_inputs_budget_rev_insert, spend_allocations.spend_allocations_budget_rev_delete, '
      + 'capex_amounts.capex_amounts_version_totals_update',
      `${prefix} totals rebuilt from the months: tenant ${slug} (${tenantId}) CAPEX: 0 row(s) inserted, 1 corrected`,
      `${prefix} writes made while those triggers did not fire bumped no budget_rev (versions): this cannot be rebuilt, `
      + 'and a CSV file exported before such a write can still read as current',
    ], 'the repaired triggers, the rebuild and the missed counters are logged');

    // Nothing to repair: no rebuild, one line.
    logged.length = 0;
    console.log = (...args: unknown[]) => { logged.push(args.join(' ')); };
    try {
      await new BudgetTriggerPlans1853850000000().up(runner);
    } finally {
      console.log = log;
    }
    assert.deepEqual(logged, [`${prefix} budget statement trigger functions replaced`], 'a clean rerun changes no trigger and rebuilds nothing');

    console.log = () => undefined;
    try {
      await new BudgetTriggerPlans1853850000000().down(runner);
      assert.deepEqual(await bodies(runner), ['1853740000000'], 'down(): the bodies of 1853740000000');
      assert.equal((await triggers(runner)).size, before.size, 'down(): every trigger is there');
      await new BudgetTriggerPlans1853850000000().up(runner);
    } finally {
      console.log = log;
    }
    assert.deepEqual(await bodies(runner), ['1853850000000'], 'up() again: the new bodies');
  });
}

void runSpecs('budget-trigger-stale-statistics.integration.spec', [
  ['opex: one statement over thousands of rows with stale statistics', () => testStaleStatistics('opex')],
  ['capex: one statement over thousands of rows with stale statistics', () => testStaleStatistics('capex')],
  ...(PREVIOUS ? [] : [['migration rerun: triggers repaired, totals rebuilt; down()', testMigrationRerunAndDown] as [string, () => Promise<void>]]),
]);
