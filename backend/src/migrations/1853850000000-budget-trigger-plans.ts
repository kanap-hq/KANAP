import { MigrationInterface, QueryRunner } from 'typeorm';
import { BudgetFreshnessCounters1853740000000 } from './1853740000000-budget-freshness-counters';

/** The five budget columns of an amounts row (as in 1853720000000 and 1853740000000). */
const MEASURES = ['planned', 'committed', 'forecast', 'actual', 'expected_landing'] as const;

const SCOPES = [
  {
    label: 'OPEX',
    items: 'spend_items',
    versions: 'spend_versions',
    amounts: 'spend_amounts',
    totals: 'spend_version_totals',
    analytics: 'spend_item_analytics_values',
    rounds: 'spend_round_inputs',
    roundLines: 'spend_round_input_lines',
    allocations: 'spend_allocations',
  },
  {
    label: 'CAPEX',
    items: 'capex_items',
    versions: 'capex_versions',
    amounts: 'capex_amounts',
    totals: 'capex_version_totals',
    analytics: 'capex_item_analytics_values',
    rounds: 'capex_round_inputs',
    roundLines: 'capex_round_input_lines',
    allocations: 'capex_allocations',
  },
] as const;

type Scope = (typeof SCOPES)[number];

/**
 * Pinned on every function below. The search path as in 1853720000000. The plan cache mode
 * makes PostgreSQL plan each statement that reads a variable of the function again on every
 * call, with the variable's value: the arrays of keys are then constants of the plan (their
 * length is known, and `= ANY` over them is hashed), and a plan made while a table was small
 * (a new tenant, before an import in one transaction) never serves it once large. Statements
 * that read only the transition tables keep the plan of their first call: they join nothing.
 * Planning reuses the parsed statement; `EXECUTE ... USING` gives the same plans but parses,
 * analyses and applies row level security again on every call: 17 % slower on the perf
 * tenant's budget rows import (review of 2026-10-03). The one statement that does not need it
 * is exempted (step 4 of the amounts function, AUTO_PLANS).
 */
const FUNCTION_SETTINGS = 'SET search_path = public, pg_temp SET plan_cache_mode = force_custom_plan';

/**
 * The function-level mode, set back to the server's default around step 4 of the amounts
 * function (`set_config(..., true)` inside a function with a SET clause lasts until the function
 * returns, or until set again). Step 4 reads no table: it unnests the function's arrays and finds
 * the totals rows through the conflict index, so any plan of it is linear. It is the one
 * statement that creates rows (the totals of versions that gained months), and the foreign key
 * checks of each created row run inside it: in the function's mode PostgreSQL would plan them
 * again for every row.
 */
const AUTO_PLANS = `PERFORM set_config('plan_cache_mode', 'auto', true);`;
const CUSTOM_PLANS = `PERFORM set_config('plan_cache_mode', 'force_custom_plan', true);`;

type ChildTable = 'rounds' | 'roundLines' | 'allocations';

/** The children of a version that bump its budget_rev, with the columns a change of which is no change (as in 1853740000000). */
const CHILDREN: Array<{ key: ChildTable; ignored: string[] }> = [
  { key: 'rounds', ignored: ['created_at', 'updated_at', 'updated_by'] },
  { key: 'roundLines', ignored: ['created_at', 'updated_at'] },
  { key: 'allocations', ignored: ['created_at', 'updated_at'] },
];

const EVENTS = ['insert', 'update', 'delete'] as const;
type Event = (typeof EVENTS)[number];

const textArray = (values: readonly string[]) => `'{${values.join(',')}}'::text[]`;

/* ---- Building blocks: no join anywhere ---- */

/**
 * Distinct (tenant, key) pairs of the rows given, into two arrays (NULL when there is none).
 * `rows` yields `tenant_id` and `key`. It reads the transition tables only.
 */
const intoArrays = (tenants: string, keys: string, rows: string) =>
  `SELECT array_agg(c.tenant_id), array_agg(c.key) INTO ${tenants}, ${keys}
         FROM (SELECT DISTINCT x.tenant_id, x.key FROM (${rows}) x) c;`;

/**
 * The rows of an UPDATE statement that really changed, both sides (the old row names the
 * version or line it left), as `tenant_id` and `key`. The old and new rows are paired by
 * grouping them on their identity and the compared columns, never by a join of the two
 * transition tables: a pair whose compared columns are equal makes a group of two, a changed
 * row (or one without its pair) a group of one. `columns` is the select list of each side,
 * `compared` the grouping, `out` the result columns.
 */
function changedRows(columns: string, compared: string, out: string): string {
  return `SELECT ${out}
            FROM (SELECT ${columns} FROM new_rows r UNION ALL SELECT ${columns} FROM old_rows r) s
           GROUP BY ${compared}
          HAVING count(*) = 1`;
}

/**
 * One more `counter` on each row of `table` named by the (tenant, id) pairs of `tenants` and
 * `keys` (distinct pairs, NULL when there is none), as 1853740000000 did: a row of another tenant
 * than its pair's is left alone. One row: one update through the primary key. Several rows:
 * locked first in id order, each through its primary key (a LATERAL subquery, run for each key
 * in turn), then updated together. The writer already holds them (lock order of
 * `spend/budget-locks.ts`), so this waits for nobody.
 */
function bumpSql(table: string, counter: string, tenants: string, keys: string, locked: string): string {
  return `
      IF ${keys} IS NOT NULL THEN
        IF cardinality(${keys}) = 1 THEN
          UPDATE ${table} x SET ${counter} = x.${counter} + 1 WHERE x.id = ${keys}[1] AND x.tenant_id = ${tenants}[1];
        ELSE
          SELECT array_agg(l.id) INTO ${locked}
            FROM (SELECT c.tenant_id, c.id FROM unnest(${tenants}, ${keys}) AS c(tenant_id, id) ORDER BY c.id) c,
                 LATERAL (SELECT x.id FROM ${table} x WHERE x.id = c.id AND x.tenant_id = c.tenant_id FOR NO KEY UPDATE OF x) l;
          IF ${locked} IS NOT NULL THEN
            UPDATE ${table} x SET ${counter} = x.${counter} + 1 WHERE x.id = ANY (${locked});
          END IF;
        END IF;
      END IF;`;
}

/** Row `r` without the given columns, for an "anything else changed" comparison (as in 1853740000000). */
const withoutColumns = (r: string, ignored: readonly string[]) => `(to_jsonb(${r}) - ${textArray(ignored)})`;

/* ---- Statement triggers of the children ---- */

/**
 * The statement trigger function of a version's child table (round inputs, their costed lines,
 * allocations): one more `budget_rev` on each version with a row inserted, deleted, or updated in
 * a column that counts, as in 1853740000000. A costed line names its version through its round
 * input, found through the round input's primary key; a line deleted with its round input
 * (cascade) finds none, and the round input's own delete counts.
 */
function childFunctionSql(scope: Scope, key: ChildTable, ignored: string[]): string {
  const table = scope[key];
  const viaRound = key === 'roundLines';
  const keyColumn = viaRound ? 'round_input_id' : 'version_id';
  const rows = {
    insert: `SELECT r.tenant_id, r.${keyColumn} AS key FROM new_rows r`,
    delete: `SELECT r.tenant_id, r.${keyColumn} AS key FROM old_rows r`,
    update: changedRows(
      `r.id, r.tenant_id, r.${keyColumn} AS key, ${withoutColumns('r', ignored)} AS compared`,
      's.id, s.compared, s.tenant_id, s.key',
      's.tenant_id, s.key',
    ),
  };
  const firstKeys = viaRound ? ['k_tenant_line', 'k_round'] : ['k_tenant', 'k_version'];
  const toVersions = viaRound
    ? `
      IF k_round IS NOT NULL THEN
        SELECT array_agg(c.tenant_id), array_agg(c.version_id) INTO k_tenant, k_version
          FROM (SELECT DISTINCT l.tenant_id,
                       (SELECT ri.version_id FROM ${scope.rounds} ri WHERE ri.id = l.round_input_id AND ri.tenant_id = l.tenant_id) AS version_id
                  FROM unnest(k_tenant_line, k_round) AS l(tenant_id, round_input_id)) c
         WHERE c.version_id IS NOT NULL;
      END IF;`
    : '';
  return `
    CREATE OR REPLACE FUNCTION ${table}_budget_rev() RETURNS trigger
    LANGUAGE plpgsql ${FUNCTION_SETTINGS} AS $fn$
    DECLARE
      k_tenant uuid[];
      k_version uuid[];
      k_locked uuid[];${viaRound ? `
      k_tenant_line uuid[];
      k_round uuid[];` : ''}
    BEGIN
      IF TG_OP = 'INSERT' THEN
        ${intoArrays(firstKeys[0], firstKeys[1], rows.insert)}
      ELSIF TG_OP = 'DELETE' THEN
        ${intoArrays(firstKeys[0], firstKeys[1], rows.delete)}
      ELSE
        ${intoArrays(firstKeys[0], firstKeys[1], rows.update)}
      END IF;${toVersions}
      ${bumpSql(scope.versions, 'budget_rev', 'k_tenant', 'k_version', 'k_locked')}
      RETURN NULL;
    END
    $fn$
  `;
}

/**
 * The statement trigger function of a line's analytics values: one more `row_version` on each
 * line with a value set, cleared or changed, as in 1853740000000. A line deleted with its values
 * (cascade) finds no row to update.
 */
function analyticsFunctionSql(scope: Scope): string {
  const rows = {
    insert: 'SELECT r.tenant_id, r.item_id AS key FROM new_rows r',
    delete: 'SELECT r.tenant_id, r.item_id AS key FROM old_rows r',
    update: changedRows(
      'r.tenant_id, r.item_id, r.axis_id, r.category_id',
      's.tenant_id, s.item_id, s.axis_id, s.category_id',
      's.tenant_id, s.item_id AS key',
    ),
  };
  return `
    CREATE OR REPLACE FUNCTION ${scope.analytics}_row_version() RETURNS trigger
    LANGUAGE plpgsql ${FUNCTION_SETTINGS} AS $fn$
    DECLARE
      k_tenant uuid[];
      k_item uuid[];
      k_locked uuid[];
    BEGIN
      IF TG_OP = 'INSERT' THEN
        ${intoArrays('k_tenant', 'k_item', rows.insert)}
      ELSIF TG_OP = 'DELETE' THEN
        ${intoArrays('k_tenant', 'k_item', rows.delete)}
      ELSE
        ${intoArrays('k_tenant', 'k_item', rows.update)}
      END IF;
      ${bumpSql(scope.items, 'row_version', 'k_tenant', 'k_item', 'k_locked')}
      RETURN NULL;
    END
    $fn$
  `;
}

/* ---- The amounts: totals per version (lot 2A) and budget_rev (lot 3B) ---- */

const changedDelta = MEASURES.map((m) => `c.${m} <> 0`).join(' OR ');
const measureList = (prefix: string) => MEASURES.map((m) => `${prefix}${m}`).join(', ');
/** The statement's change set, one entry per version: unnested from the function's arrays. */
const CHANGES = `unnest(k_tenant, k_version, ${measureList('d_')}, k_gained)
      AS c(tenant_id, version_id, ${MEASURES.join(', ')}, gained)`;

/** A month holding a value: NULL and 0 are the same empty month (as in 1853740000000). */
const holdsValue = (r: string) => MEASURES.map((m) => `coalesce(${r}.${m}, 0) <> 0`).join(' OR ');

/** The months of a transition table with the sign of their side (+ after the statement, - before it), NULL as 0. */
function signedRows(table: 'new_rows' | 'old_rows'): string {
  const sign = table === 'new_rows' ? '' : '-';
  return `SELECT r.tenant_id, r.version_id, r.period, ${sign}1 AS side,
                 ${MEASURES.map((m) => `${sign}coalesce(r.${m}, 0) AS ${m}`).join(', ')}
            FROM ${table} r`;
}

/** Step 1a: the statement's net change per tenant, version and year of the month, from the transition tables only. */
function groupedSql(rows: string): string {
  return `SELECT array_agg(g.tenant_id), array_agg(g.version_id), array_agg(g.year),
               ${MEASURES.map((m) => `array_agg(g.${m})`).join(', ')}, array_agg(g.gained)
          INTO g_tenant, g_version, g_year, ${measureList('g_')}, g_gained
          FROM (SELECT s.tenant_id, s.version_id, EXTRACT(YEAR FROM s.period) AS year,
                       ${MEASURES.map((m) => `sum(s.${m}) AS ${m}`).join(', ')},
                       NOT bool_or(s.side < 0) AS gained
                  FROM (${rows}) s
                 GROUP BY s.tenant_id, s.version_id, EXTRACT(YEAR FROM s.period)) g;`;
}

/**
 * The statement trigger function of an amounts table: 1853740000000's (step 0, budget_rev) and
 * 1853720000000's (steps 1 to 4, the totals per version), same results, same locks, same order,
 * with plans that stay linear whatever the statistics:
 *
 * 0. `budget_rev` of the versions whose months really changed: an inserted or deleted month
 *    that holds a value, an updated month moved or changed in a value (NULL as 0).
 * 1. The statement's net change per version over the months of the version's own budget year:
 *    grouped per tenant, version and year from the transition tables (+ after, - before), then
 *    kept when the version, read through its primary key with the months' tenant, has that
 *    budget year. A version "gained" months when the statement brought it own-year rows and
 *    took none away.
 * 2. The totals rows of the versions whose amounts changed: read through the primary key, in
 *    version_id order, and locked (several versions, or an update or delete that adds to them).
 * 3. Versions that had months before the statement, with a totals row: the change added to the
 *    row, through `INSERT ... ON CONFLICT DO UPDATE` on rows known to exist, like step 4.
 * 4. Versions that gained months, in version_id order: the change upserted when an amount
 *    changed, then the row created even for months holding only zeros. Never deleted here.
 *    Planned in the server's plan cache mode (AUTO_PLANS).
 *
 * Every change of a totals row is still an increment computed from the statement's own
 * transition rows, so concurrent writers keep the guarantees 1853720000000 describes. The
 * versions are updated before their totals rows, both after the months (lock order of
 * `spend/budget-locks.ts`).
 */
function amountsFunctionSql(scope: Scope): string {
  const revRows = {
    insert: `SELECT r.tenant_id, r.version_id AS key FROM new_rows r WHERE ${holdsValue('r')}`,
    delete: `SELECT r.tenant_id, r.version_id AS key FROM old_rows r WHERE ${holdsValue('r')}`,
    update: changedRows(
      `r.id, r.tenant_id, r.version_id, r.period, ${MEASURES.map((m) => `coalesce(r.${m}, 0) AS ${m}`).join(', ')}`,
      `s.id, s.version_id, s.period, ${measureList('s.')}`,
      '(array_agg(s.tenant_id))[1] AS tenant_id, s.version_id AS key',
    ),
  };
  const groupVars = MEASURES.map((m) => `g_${m} numeric[];`).join('\n      ');
  const deltaVars = MEASURES.map((m) => `d_${m} numeric[];`).join('\n      ');
  return `
    CREATE OR REPLACE FUNCTION ${scope.amounts}_version_totals() RETURNS trigger
    LANGUAGE plpgsql ${FUNCTION_SETTINGS} AS $fn$
    DECLARE
      r_tenant uuid[];
      r_version uuid[];
      r_locked uuid[];
      g_tenant uuid[];
      g_version uuid[];
      g_year numeric[];
      ${groupVars}
      g_gained boolean[];
      k_tenant uuid[];
      k_version uuid[];
      ${deltaVars}
      k_gained boolean[];
      n_changed bigint;
      k_existing uuid[];
    BEGIN
      -- 0. budget_rev of the versions whose months really changed (lot 3B).
      IF TG_OP = 'INSERT' THEN
        ${intoArrays('r_tenant', 'r_version', revRows.insert)}
      ELSIF TG_OP = 'DELETE' THEN
        ${intoArrays('r_tenant', 'r_version', revRows.delete)}
      ELSE
        ${intoArrays('r_tenant', 'r_version', revRows.update)}
      END IF;
      ${bumpSql(scope.versions, 'budget_rev', 'r_tenant', 'r_version', 'r_locked')}

      -- 1. Net change of the statement per version, own-year months only.
      IF TG_OP = 'INSERT' THEN
        ${groupedSql(signedRows('new_rows'))}
      ELSIF TG_OP = 'DELETE' THEN
        ${groupedSql(signedRows('old_rows'))}
      ELSE
        ${groupedSql(`${signedRows('new_rows')} UNION ALL ${signedRows('old_rows')}`)}
      END IF;
      IF g_version IS NULL THEN
        RETURN NULL; -- no month was touched
      END IF;
      SELECT array_agg(c.tenant_id), array_agg(c.version_id), ${MEASURES.map((m) => `array_agg(c.${m})`).join(', ')},
             array_agg(c.gained), count(*) FILTER (WHERE ${changedDelta})
        INTO k_tenant, k_version, ${measureList('d_')}, k_gained, n_changed
        FROM unnest(g_tenant, g_version, g_year, ${measureList('g_')}, g_gained)
             AS c(tenant_id, version_id, year, ${MEASURES.join(', ')}, gained)
       WHERE c.year = (SELECT v.budget_year FROM ${scope.versions} v WHERE v.id = c.version_id AND v.tenant_id = c.tenant_id);
      IF k_version IS NULL THEN
        RETURN NULL; -- no own-year month of an existing version was touched
      END IF;

      -- 2. The totals rows of the versions whose amounts changed, locked in version_id order.
      IF n_changed > 1 OR (n_changed = 1 AND TG_OP <> 'INSERT') THEN
        SELECT array_agg(l.version_id) INTO k_existing
          FROM (SELECT c.tenant_id, c.version_id FROM ${CHANGES} WHERE ${changedDelta} ORDER BY c.version_id) c,
               LATERAL (SELECT t.version_id FROM ${scope.totals} t
                         WHERE t.version_id = c.version_id AND t.tenant_id = c.tenant_id
                           FOR NO KEY UPDATE OF t) l;
      END IF;

      -- 3. Versions that had months before the statement: add the change to their row.
      IF TG_OP <> 'INSERT' AND k_existing IS NOT NULL THEN
        INSERT INTO ${scope.totals} AS t (tenant_id, version_id, ${MEASURES.join(', ')})
        SELECT c.tenant_id, c.version_id, ${measureList('c.')}
          FROM ${CHANGES}
         WHERE NOT c.gained AND (${changedDelta}) AND c.version_id = ANY (k_existing)
         ORDER BY c.version_id
        ON CONFLICT (version_id) DO UPDATE
           SET ${MEASURES.map((m) => `${m} = t.${m} + excluded.${m}`).join(', ')}, updated_at = now();
      END IF;

      -- 4. Versions that gained months: their row, created when missing. Never deleted here.
      IF true = ANY (k_gained) THEN
        ${AUTO_PLANS}
        INSERT INTO ${scope.totals} AS t (tenant_id, version_id, ${MEASURES.join(', ')})
        SELECT c.tenant_id, c.version_id, ${measureList('c.')}
          FROM ${CHANGES}
         WHERE c.gained AND (${changedDelta})
         ORDER BY c.version_id
        ON CONFLICT (version_id) DO UPDATE
           SET ${MEASURES.map((m) => `${m} = t.${m} + excluded.${m}`).join(', ')}, updated_at = now();
        INSERT INTO ${scope.totals} (tenant_id, version_id)
        SELECT c.tenant_id, c.version_id
          FROM ${CHANGES}
         WHERE c.gained
         ORDER BY c.version_id
        ON CONFLICT (version_id) DO NOTHING;
        ${CUSTOM_PLANS}
      END IF;
      RETURN NULL;
    END
    $fn$
  `;
}

/* ---- The triggers that call them ---- */

/** What a trigger keeps: the totals per version (and budget_rev) for the amounts, a counter for the others. */
type Keeps = 'totals' | 'budget_rev' | 'row_version';

type ExpectedTrigger = { table: string; name: string; event: Event; fn: string; keeps: Keeps };

/** The statement triggers of 1853720000000 and 1853740000000 that call the functions replaced here. */
function expectedTriggers(): ExpectedTrigger[] {
  return SCOPES.flatMap((scope) => [
    ...EVENTS.map((event) => ({
      table: scope.amounts, name: `${scope.amounts}_version_totals_${event}`, event, fn: `${scope.amounts}_version_totals`, keeps: 'totals' as const,
    })),
    ...EVENTS.map((event) => ({
      table: scope.analytics, name: `${scope.analytics}_row_version_${event}`, event, fn: `${scope.analytics}_row_version`, keeps: 'row_version' as const,
    })),
    ...CHILDREN.flatMap((child) => EVENTS.map((event) => ({
      table: scope[child.key], name: `${scope[child.key]}_budget_rev_${event}`, event, fn: `${scope[child.key]}_budget_rev`, keeps: 'budget_rev' as const,
    }))),
  ]);
}

/** pg_trigger.tgtype of an AFTER ... FOR EACH STATEMENT trigger on one event. */
const STATEMENT_TYPE: Record<Event, number> = { insert: 4, delete: 8, update: 16 };

const transition = (event: Event) => (event === 'insert' ? 'NEW TABLE AS new_rows'
  : event === 'delete' ? 'OLD TABLE AS old_rows'
    : 'OLD TABLE AS old_rows NEW TABLE AS new_rows');

type TriggerState = { table: string; name: string; fn: string; type: number; old_table: string | null; new_table: string | null; enabled: string };

/**
 * Whether a trigger found in the catalog is the one 1853720000000 / 1853740000000 create, firing
 * on the app's writes: `tgenabled` O (origin) or A (always), as verify-version-totals.ts checks.
 * D is disabled, R fires in replica sessions only.
 */
function isExpected(found: TriggerState | undefined, expected: ExpectedTrigger): boolean {
  return !!found
    && found.fn === expected.fn
    && found.type === STATEMENT_TYPE[expected.event]
    && found.old_table === (expected.event === 'insert' ? null : 'old_rows')
    && found.new_table === (expected.event === 'delete' ? null : 'new_rows')
    && (found.enabled === 'O' || found.enabled === 'A');
}

type RlsState = { name: string; enabled: boolean; forced: boolean };
type RebuildRow = { scope: string; tenant_id: string; slug: string | null; inserted: string; corrected: string };

/** The tables 1853720000000's backfill reads and writes with row level security off. */
const REBUILD_TABLES = SCOPES.flatMap((scope) => [scope.amounts, scope.versions, scope.totals]);

async function restoreRls(queryRunner: QueryRunner, states: RlsState[]) {
  for (const state of states) {
    await queryRunner.query(`ALTER TABLE ${state.name} ${state.enabled ? 'ENABLE' : 'DISABLE'} ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE ${state.name} ${state.forced ? 'FORCE' : 'NO FORCE'} ROW LEVEL SECURITY`);
  }
}

/**
 * The totals of every tenant recomputed from the months, as 1853720000000's backfill does: the
 * months written while an amounts trigger was missing or disabled are not in the totals. The
 * migration runs without a tenant and these tables FORCE row level security, so RLS is turned
 * off around the rebuild and put back as it was found; a failure inside the migration
 * transaction is rethrown as it is (the rollback puts RLS back). The rebuild holds a SHARE lock
 * on both amounts tables until the migration commits.
 */
async function rebuildTotals(queryRunner: QueryRunner): Promise<RebuildRow[]> {
  const found: RlsState[] = await queryRunner.query(
    `SELECT c.relname::text AS name, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced
       FROM pg_class c WHERE c.oid = ANY ($1::regclass[]) ORDER BY c.relname`,
    [REBUILD_TABLES],
  );
  for (const table of REBUILD_TABLES) await queryRunner.query(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`);
  let rows: RebuildRow[];
  try {
    rows = await queryRunner.query(`
      SELECT r.scope, r.tenant_id::text AS tenant_id, t.slug, r.inserted::text AS inserted, r.corrected::text AS corrected
        FROM budget_version_totals_rebuild(NULL) r
        LEFT JOIN tenants t ON t.id = r.tenant_id
       ORDER BY t.slug NULLS LAST, r.tenant_id, r.scope DESC
    `);
  } catch (error) {
    if (!queryRunner.isTransactionActive) {
      await restoreRls(queryRunner, found).catch((restoreError) => {
        console.error('[Migration] BudgetTriggerPlans: RLS could not be restored after the failed totals rebuild', restoreError);
      });
    }
    throw error;
  }
  await restoreRls(queryRunner, found);
  return rows;
}

/**
 * Plans of the budget statement triggers that stay linear whatever the statistics (plan
 * planning/perf-scale, item 4C bis; inventory in doc/architecture.md, "Budget statement
 * triggers and stale statistics").
 *
 * The functions of 1853720000000 (totals per version) and 1853740000000 (budget_rev and
 * row_version) joined the statement's keys (an `unnest` of arrays, or a transition table) to the
 * versions, lines and totals tables. With statistics that read those tables as one row (taken
 * while their pages held no live row: after a purge, after a large first import that failed and
 * rolled back, an ANALYZE of an empty table), and the tenant's row level security filter on top,
 * PostgreSQL put the table on the outer side of a nested loop and scanned the keys once per row
 * of the tenant: one statement inserting 1,000 round inputs over 25,000 versions took 53 s, and
 * every single-version statement scanned the tenant's whole table (about 72 ms each instead of
 * 0.2 ms). The replaced bodies give the same results under the same locks, in the same order,
 * and join nothing:
 * - the transition tables are only grouped; an UPDATE's old and new rows are paired by grouping
 *   them, not by a join;
 * - the versions, lines, round inputs and totals are reached one key at a time through their
 *   primary key (a scalar or LATERAL subquery run for each key, locking where 1853740000000
 *   locked), or several rows with `id = ANY` over a constant array;
 * - a totals row is changed through `INSERT ... ON CONFLICT`, which finds it through the primary
 *   key, instead of an `UPDATE ... FROM` join;
 * - every function plans the statements that read its variables on each call (plan cache mode),
 *   except the totals rows it creates and their foreign key checks.
 *
 * Idempotent and self-healing: every function is replaced. A trigger that calls one of them is
 * left as it is when the catalog shows it as created by 1853720000000 / 1853740000000 (same
 * function, event, transition tables, firing on the app's writes); one missing, disabled, set
 * to fire in replica sessions only or different is created again, and logged. Nothing else is
 * read or written, except when an amounts trigger had to be created again: the months written
 * meanwhile are missing from the totals, so every tenant's totals are rebuilt from the months
 * (1853720000000's backfill, `budget_version_totals_rebuild`, RLS off around it). The
 * `budget_rev` and `row_version` bumps those writes missed cannot be rebuilt: the log says so.
 *
 * down() runs 1853740000000 again: it puts back its bodies (and 1853720000000's steps inside the
 * amounts function) and creates its triggers again.
 */
export class BudgetTriggerPlans1853850000000 implements MigrationInterface {
  name = 'BudgetTriggerPlans1853850000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const scope of SCOPES) {
      await queryRunner.query(amountsFunctionSql(scope));
      await queryRunner.query(analyticsFunctionSql(scope));
      for (const child of CHILDREN) await queryRunner.query(childFunctionSql(scope, child.key, child.ignored));
    }

    const expected = expectedTriggers();
    const found: TriggerState[] = await queryRunner.query(
      `SELECT c.relname::text AS table, t.tgname::text AS name, p.proname::text AS fn, t.tgtype::int AS type,
              t.tgoldtable::text AS old_table, t.tgnewtable::text AS new_table, t.tgenabled::text AS enabled
         FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_proc p ON p.oid = t.tgfoid
        WHERE NOT t.tgisinternal AND c.relnamespace = 'public'::regnamespace
          AND (c.relname, t.tgname) IN (${expected.map((e) => `('${e.table}', '${e.name}')`).join(', ')})`,
    );
    const byName = new Map(found.map((state) => [`${state.table}.${state.name}`, state]));
    const repaired: ExpectedTrigger[] = [];
    for (const trigger of expected) {
      if (isExpected(byName.get(`${trigger.table}.${trigger.name}`), trigger)) continue;
      await queryRunner.query(`DROP TRIGGER IF EXISTS ${trigger.name} ON ${trigger.table}`);
      await queryRunner.query(`
        CREATE TRIGGER ${trigger.name}
        AFTER ${trigger.event.toUpperCase()} ON ${trigger.table}
        REFERENCING ${transition(trigger.event)}
        FOR EACH STATEMENT EXECUTE FUNCTION ${trigger.fn}()
      `);
      repaired.push(trigger);
    }
    const prefix = '[Migration] BudgetTriggerPlans:';
    console.log(`${prefix} budget statement trigger functions replaced${repaired.length ? `; triggers created again: ${repaired.map((t) => `${t.table}.${t.name}`).join(', ')}` : ''}`);
    if (repaired.length === 0) return;

    if (repaired.some((t) => t.keeps === 'totals')) {
      const rows = await rebuildTotals(queryRunner);
      if (rows.length === 0) console.log(`${prefix} totals rebuilt from the months: every version total already matched`);
      for (const row of rows) {
        console.log(`${prefix} totals rebuilt from the months: tenant ${row.slug ?? '(unknown)'} (${row.tenant_id}) ${row.scope}: ${row.inserted} row(s) inserted, ${row.corrected} corrected`);
      }
    }
    const missed = [
      ...(repaired.some((t) => t.keeps !== 'row_version') ? ['budget_rev (versions)'] : []),
      ...(repaired.some((t) => t.keeps === 'row_version') ? ['row_version (lines)'] : []),
    ];
    console.log(`${prefix} writes made while those triggers did not fire bumped no ${missed.join(' or ')}: this cannot be rebuilt, and a CSV file exported before such a write can still read as current`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 1853740000000 is idempotent: its functions (and 1853720000000's steps in the amounts
    // function) come back as they were, its triggers are created again.
    await new BudgetFreshnessCounters1853740000000().up(queryRunner);
  }
}

