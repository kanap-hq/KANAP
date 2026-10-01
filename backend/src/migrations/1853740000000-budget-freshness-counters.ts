import { MigrationInterface, QueryRunner } from 'typeorm';
import { VersionTotals1853720000000 } from './1853720000000-version-totals';

/** The five budget columns of an amounts row (as in 1853720000000). */
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

/** Pinned on every function below, as in 1853720000000: public first, pg_temp last. */
const SEARCH_PATH = 'SET search_path = public, pg_temp';

const LINE_FUNCTION = 'budget_line_row_version';
const VERSION_FUNCTION = 'budget_version_budget_rev';
/** Columns that never bump a line's row_version: the hourly lifecycle sync rewrites `status`. */
const LINE_IGNORED = ['updated_at', 'status', 'row_version'];
/** Columns that never bump a version's budget_rev: `input_grain` is a display preference. */
const VERSION_IGNORED = ['input_grain', 'updated_at', 'budget_rev'];

const COUNTERS = [
  { column: 'row_version', table: (scope: Scope) => scope.items },
  { column: 'budget_rev', table: (scope: Scope) => scope.versions },
] as const;

type ChildTable = 'rounds' | 'roundLines' | 'allocations';

/** The children of a version that bump its budget_rev, with the columns a change of which is no change. */
const CHILDREN: Array<{ key: ChildTable; ignored: string[] }> = [
  { key: 'rounds', ignored: ['created_at', 'updated_at', 'updated_by'] },
  { key: 'roundLines', ignored: ['created_at', 'updated_at'] },
  { key: 'allocations', ignored: ['created_at', 'updated_at'] },
];

const EVENTS = ['insert', 'update', 'delete'] as const;
type Event = (typeof EVENTS)[number];

const transition = (event: Event) => (event === 'insert' ? 'NEW TABLE AS new_rows'
  : event === 'delete' ? 'OLD TABLE AS old_rows'
    : 'OLD TABLE AS old_rows NEW TABLE AS new_rows');

const textArray = (values: readonly string[]) => `'{${values.join(',')}}'::text[]`;

/** Row `r` without the given columns, for an "anything else changed" comparison. */
const withoutColumns = (r: string, ignored: readonly string[]) => `(to_jsonb(${r}) - ${textArray(ignored)})`;

/* ---- Row triggers: the line and the version themselves ---- */

/**
 * BEFORE UPDATE of a line: one more `row_version` when a column other than
 * updated_at, status and row_version changes. A statement that only sets
 * row_version (the analytics values trigger below) keeps the value it sets.
 * Status is derived from the end of validity and rewritten hourly by
 * `cleanup/lifecycle-status-sync.service.ts`: it never counts.
 */
function lineFunctionSql(): string {
  return `
    CREATE OR REPLACE FUNCTION ${LINE_FUNCTION}() RETURNS trigger
    LANGUAGE plpgsql ${SEARCH_PATH} AS $fn$
    BEGIN
      IF ${withoutColumns('NEW', LINE_IGNORED)} IS DISTINCT FROM ${withoutColumns('OLD', LINE_IGNORED)} THEN
        NEW.row_version := OLD.row_version + 1;
      END IF;
      RETURN NEW;
    END
    $fn$
  `;
}

/** BEFORE UPDATE of a version: one more `budget_rev` when a column other than input_grain, updated_at and budget_rev changes. */
function versionFunctionSql(): string {
  return `
    CREATE OR REPLACE FUNCTION ${VERSION_FUNCTION}() RETURNS trigger
    LANGUAGE plpgsql ${SEARCH_PATH} AS $fn$
    BEGIN
      IF ${withoutColumns('NEW', VERSION_IGNORED)} IS DISTINCT FROM ${withoutColumns('OLD', VERSION_IGNORED)} THEN
        NEW.budget_rev := OLD.budget_rev + 1;
      END IF;
      RETURN NEW;
    END
    $fn$
  `;
}

/* ---- Statement triggers: the children ---- */

/**
 * One more `budget_rev` on each version of `k_tenant` / `k_version`. Several
 * versions are locked in id order first. The writer already holds them (lock
 * order: line, version, then the children, `spend/budget-locks.ts`), so this
 * waits for nobody; a raw writer that does not follow the order queues here
 * after its children, like the totals row of 1853720000000.
 */
function bumpVersionsSql(scope: Scope, tenants: string, versions: string): string {
  return `
      IF ${versions} IS NOT NULL THEN
        IF cardinality(${versions}) > 1 THEN
          PERFORM 1
             FROM ${scope.versions} v, unnest(${tenants}, ${versions}) AS c(tenant_id, version_id)
            WHERE v.id = c.version_id AND v.tenant_id = c.tenant_id
            ORDER BY v.id
              FOR NO KEY UPDATE OF v;
        END IF;
        UPDATE ${scope.versions} v
           SET budget_rev = v.budget_rev + 1
          FROM unnest(${tenants}, ${versions}) AS c(tenant_id, version_id)
         WHERE v.id = c.version_id AND v.tenant_id = c.tenant_id;
      END IF;`;
}

/** The (tenant, key) pairs of a statement's changed rows into two arrays, distinct. */
const intoArrays = (tenants: string, keys: string, keyColumn: string, rows: string) =>
  `SELECT array_agg(c.tenant_id), array_agg(c.${keyColumn}) INTO ${tenants}, ${keys}
         FROM (SELECT DISTINCT x.tenant_id, x.${keyColumn} FROM (${rows}) x) c;`;

/**
 * Rows of an UPDATE statement that really changed, both sides (the old row
 * names the version it left): paired on `on`, compared on `differs`. A row
 * without its pair counts.
 */
function changedPairs(select: (r: string) => string, on: string, differs: string): string {
  return `SELECT ${select('n')} FROM new_rows n LEFT JOIN old_rows o ON ${on} WHERE o.tenant_id IS NULL OR ${differs}
          UNION ALL
          SELECT ${select('o')} FROM old_rows o LEFT JOIN new_rows n ON ${on} WHERE n.tenant_id IS NULL OR ${differs}`;
}

/**
 * The statement trigger function of a version's child table (round inputs,
 * their costed lines, allocations): one more `budget_rev` on each version
 * with a row inserted, deleted, or updated in a column that counts. A costed
 * line names its version through its round input; a line deleted with its
 * round input (cascade) finds none, and the round input's own delete counts.
 */
function childFunctionSql(scope: Scope, key: ChildTable, ignored: string[]): string {
  const table = scope[key];
  const viaRound = key === 'roundLines';
  const keyColumn = viaRound ? 'round_input_id' : 'version_id';
  const pick = (r: string) => `${r}.tenant_id, ${r}.${keyColumn}`;
  const differs = `${withoutColumns('n', ignored)} IS DISTINCT FROM ${withoutColumns('o', ignored)}`;
  const rows = {
    insert: `SELECT ${pick('r')} FROM new_rows r`,
    delete: `SELECT ${pick('r')} FROM old_rows r`,
    update: changedPairs(pick, 'o.id = n.id', differs),
  };
  // Costed lines: from their round inputs to the versions.
  const toVersions = (inner: string) => (viaRound
    ? `SELECT ri.tenant_id, ri.version_id FROM (${inner}) l JOIN ${scope.rounds} ri ON ri.id = l.round_input_id AND ri.tenant_id = l.tenant_id`
    : inner);
  return `
    CREATE OR REPLACE FUNCTION ${table}_budget_rev() RETURNS trigger
    LANGUAGE plpgsql ${SEARCH_PATH} AS $fn$
    DECLARE
      k_tenant uuid[];
      k_version uuid[];
    BEGIN
      IF TG_OP = 'INSERT' THEN
        ${intoArrays('k_tenant', 'k_version', 'version_id', toVersions(rows.insert))}
      ELSIF TG_OP = 'DELETE' THEN
        ${intoArrays('k_tenant', 'k_version', 'version_id', toVersions(rows.delete))}
      ELSE
        ${intoArrays('k_tenant', 'k_version', 'version_id', toVersions(rows.update))}
      END IF;
      ${bumpVersionsSql(scope, 'k_tenant', 'k_version')}
      RETURN NULL;
    END
    $fn$
  `;
}

/**
 * The statement trigger function of a line's analytics values: one more
 * `row_version` on each line with a value set, cleared or changed (the line
 * file exports them with the line's columns). Several lines are locked in id
 * order first; the writer (`item-analytics.util.ts`, after the line's own
 * update) already holds its line. A line deleted with its values (cascade)
 * finds no row to update.
 */
function analyticsFunctionSql(scope: Scope): string {
  const pick = (r: string) => `${r}.tenant_id, ${r}.item_id`;
  const on = 'o.tenant_id = n.tenant_id AND o.item_id = n.item_id AND o.axis_id = n.axis_id';
  const rows = {
    insert: `SELECT ${pick('r')} FROM new_rows r`,
    delete: `SELECT ${pick('r')} FROM old_rows r`,
    update: changedPairs(pick, on, 'o.category_id IS DISTINCT FROM n.category_id'),
  };
  return `
    CREATE OR REPLACE FUNCTION ${scope.analytics}_row_version() RETURNS trigger
    LANGUAGE plpgsql ${SEARCH_PATH} AS $fn$
    DECLARE
      k_tenant uuid[];
      k_item uuid[];
    BEGIN
      IF TG_OP = 'INSERT' THEN
        ${intoArrays('k_tenant', 'k_item', 'item_id', rows.insert)}
      ELSIF TG_OP = 'DELETE' THEN
        ${intoArrays('k_tenant', 'k_item', 'item_id', rows.delete)}
      ELSE
        ${intoArrays('k_tenant', 'k_item', 'item_id', rows.update)}
      END IF;
      IF k_item IS NULL THEN
        RETURN NULL;
      END IF;
      IF cardinality(k_item) > 1 THEN
        PERFORM 1
           FROM ${scope.items} i, unnest(k_tenant, k_item) AS c(tenant_id, item_id)
          WHERE i.id = c.item_id AND i.tenant_id = c.tenant_id
          ORDER BY i.id
            FOR NO KEY UPDATE OF i;
      END IF;
      UPDATE ${scope.items} i
         SET row_version = i.row_version + 1
        FROM unnest(k_tenant, k_item) AS c(tenant_id, item_id)
       WHERE i.id = c.item_id AND i.tenant_id = c.tenant_id;
      RETURN NULL;
    END
    $fn$
  `;
}

/* ---- The amounts: 1853720000000's function, plus budget_rev ---- */

const ownYear = (a: string, v: string) => `EXTRACT(YEAR FROM ${a}.period) = ${v}.budget_year`;
const changedDelta = MEASURES.map((m) => `c.${m} <> 0`).join(' OR ');
const CHANGES = `unnest(k_tenant, k_version, ${MEASURES.map((m) => `d_${m}`).join(', ')}, k_gained)
      AS c(tenant_id, version_id, ${MEASURES.join(', ')}, gained)`;
const INTO_ARRAYS = `SELECT array_agg(c.tenant_id), array_agg(c.version_id),
           ${MEASURES.map((m) => `array_agg(c.${m})`).join(', ')}, array_agg(c.gained),
           count(*) FILTER (WHERE ${changedDelta})
      INTO k_tenant, k_version, ${MEASURES.map((m) => `d_${m}`).join(', ')}, k_gained, n_changed`;

function signedRows(scope: Scope, table: 'new_rows' | 'old_rows'): string {
  const sign = table === 'new_rows' ? '' : '-';
  return `SELECT r.tenant_id, r.version_id, ${sign}1 AS side,
                 ${MEASURES.map((m) => `${sign}coalesce(r.${m}, 0) AS ${m}`).join(', ')}
            FROM ${table} r
            JOIN ${scope.versions} v ON v.id = r.version_id AND v.tenant_id = r.tenant_id
           WHERE ${ownYear('r', 'v')}`;
}

function grouped(rows: string): string {
  return `(SELECT s.tenant_id, s.version_id,
                 ${MEASURES.map((m) => `sum(s.${m}) AS ${m}`).join(', ')},
                 NOT bool_or(s.side < 0) AS gained
            FROM (${rows}) s
           GROUP BY s.tenant_id, s.version_id) c`;
}

/** A month holding a value: NULL and 0 are the same empty month. */
const holdsValue = (r: string) => MEASURES.map((m) => `coalesce(${r}.${m}, 0) <> 0`).join(' OR ');
/** A month moved or changed in a value (NULL as 0). */
const monthDiffers = `(n.version_id, n.period, ${MEASURES.map((m) => `coalesce(n.${m}, 0)`).join(', ')})
             IS DISTINCT FROM (o.version_id, o.period, ${MEASURES.map((m) => `coalesce(o.${m}, 0)`).join(', ')})`;

/**
 * 1853720000000's statement trigger function of an amounts table (steps 1 to
 * 4, unchanged), with a step 0 on the same transition tables: one more
 * `budget_rev` on each version whose months really changed. An inserted or
 * deleted month counts when it holds a value; an updated month when it moved
 * or a value changed, NULL reading as 0. So the empty months a budget write
 * creates first, an upsert writing the values already stored and a 0 written
 * over NULL change nothing. Any month of the version counts, in its year or
 * not. The version is updated before its totals row, both after the months:
 * the writer already holds the version (lock order, `spend/budget-locks.ts`).
 */
function amountsFunctionSql(scope: Scope): string {
  const revRows = {
    insert: `SELECT r.tenant_id, r.version_id FROM new_rows r WHERE ${holdsValue('r')}`,
    delete: `SELECT r.tenant_id, r.version_id FROM old_rows r WHERE ${holdsValue('r')}`,
    update: changedPairs((r) => `${r}.tenant_id, ${r}.version_id`, 'o.id = n.id', monthDiffers),
  };
  return `
    CREATE OR REPLACE FUNCTION ${scope.amounts}_version_totals() RETURNS trigger
    LANGUAGE plpgsql ${SEARCH_PATH} AS $fn$
    DECLARE
      k_tenant uuid[];
      k_version uuid[];
      ${MEASURES.map((m) => `d_${m} numeric[];`).join('\n      ')}
      k_gained boolean[];
      n_changed bigint;
      r_tenant uuid[];
      r_version uuid[];
    BEGIN
      -- 0. budget_rev of the versions whose months really changed (lot 3B).
      IF TG_OP = 'INSERT' THEN
        ${intoArrays('r_tenant', 'r_version', 'version_id', revRows.insert)}
      ELSIF TG_OP = 'DELETE' THEN
        ${intoArrays('r_tenant', 'r_version', 'version_id', revRows.delete)}
      ELSE
        ${intoArrays('r_tenant', 'r_version', 'version_id', revRows.update)}
      END IF;
      ${bumpVersionsSql(scope, 'r_tenant', 'r_version')}

      -- 1. Net change of the statement per version, own-year months only.
      IF TG_OP = 'INSERT' THEN
        ${INTO_ARRAYS}
          FROM ${grouped(signedRows(scope, 'new_rows'))};
      ELSIF TG_OP = 'DELETE' THEN
        ${INTO_ARRAYS}
          FROM ${grouped(signedRows(scope, 'old_rows'))};
      ELSE
        ${INTO_ARRAYS}
          FROM ${grouped(`${signedRows(scope, 'new_rows')} UNION ALL ${signedRows(scope, 'old_rows')}`)};
      END IF;
      IF k_version IS NULL THEN
        RETURN NULL; -- no own-year month of an existing version was touched
      END IF;

      -- 2. Several versions changed: lock their rows in version_id order first.
      IF n_changed > 1 THEN
        PERFORM 1
           FROM ${scope.totals} t, ${CHANGES}
          WHERE t.version_id = c.version_id AND t.tenant_id = c.tenant_id AND (${changedDelta})
          ORDER BY t.version_id
            FOR NO KEY UPDATE OF t;
      END IF;

      -- 3. Versions that had months before the statement: add the change.
      IF TG_OP <> 'INSERT' THEN
        UPDATE ${scope.totals} t
           SET ${MEASURES.map((m) => `${m} = t.${m} + c.${m}`).join(', ')}, updated_at = now()
          FROM ${CHANGES}
         WHERE NOT c.gained AND t.version_id = c.version_id AND t.tenant_id = c.tenant_id
           AND (${changedDelta});
      END IF;

      -- 4. Versions that gained months: their row, created when missing. Never deleted here.
      IF true = ANY (k_gained) THEN
        INSERT INTO ${scope.totals} AS t (tenant_id, version_id, ${MEASURES.join(', ')})
        SELECT c.tenant_id, c.version_id, ${MEASURES.map((m) => `c.${m}`).join(', ')}
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
      END IF;
      RETURN NULL;
    END
    $fn$
  `;
}

/* ---- Migration ---- */

type ColumnState = { table: string; column: string; not_null: boolean; has_default: boolean };
type RlsState = { name: string; enabled: boolean; forced: boolean };

async function counterColumns(queryRunner: QueryRunner): Promise<ColumnState[]> {
  return queryRunner.query(
    `SELECT c.relname::text AS table, a.attname::text AS column, a.attnotnull AS not_null, a.atthasdef AS has_default
       FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
      WHERE c.relnamespace = 'public'::regnamespace AND NOT a.attisdropped
        AND (c.relname, a.attname) IN (${SCOPES.flatMap((scope) => COUNTERS.map((k) => `('${k.table(scope)}', '${k.column}')`)).join(', ')})`,
  );
}

/**
 * Freshness counters of the budget (plan planning/perf-scale, lot 3B; the CSV
 * `kanap_token` of decision D6 carries them):
 *
 * - `row_version` on spend_items and capex_items: one more each time a column
 *   of the line other than updated_at, status and row_version changes (BEFORE
 *   UPDATE row trigger), and each time its analytics values change (statement
 *   triggers on *_item_analytics_values): what the line file exports besides
 *   the amounts.
 * - `budget_rev` on spend_versions and capex_versions: one more each time a
 *   column of the version other than input_grain, updated_at and budget_rev
 *   changes (BEFORE UPDATE row trigger), and each time its amounts, round
 *   inputs, costed lines or allocations really change (statement triggers on
 *   the transition tables; for the amounts, a step 0 in 1853720000000's
 *   function rather than a second trigger on those tables).
 *
 * A write that changes no value (the same value written back, an identical
 * copy, an unchanged CSV row) bumps nothing; a request running several
 * statements may bump more than once (the token compares by equality). A
 * created line or version starts at 1; a deleted one has nothing to bump.
 * The triggers run as the caller, under RLS (a session without a tenant
 * bumps nothing), and update the line or the version after their children:
 * deadlock-free because every writer locks the line, then the version, first
 * (`spend/budget-locks.ts`).
 *
 * Idempotent and self-healing: the columns are added when missing (a
 * constant default: no table rewrite), given back their default and NOT NULL
 * when they lost them (a NULL becomes 1, RLS disabled around that update and
 * put back as it was), every function is replaced and every trigger dropped
 * and created again. The amounts tables keep the triggers of 1853720000000
 * (same names, same function names, replaced bodies).
 *
 * down() drops the counter triggers and functions, puts back
 * 1853720000000's amounts function (by running that migration again, which
 * also recomputes the totals) and drops the columns.
 */
export class BudgetFreshnessCounters1853740000000 implements MigrationInterface {
  name = 'BudgetFreshnessCounters1853740000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. The columns.
    for (const scope of SCOPES) {
      for (const counter of COUNTERS) {
        await queryRunner.query(
          `ALTER TABLE ${counter.table(scope)} ADD COLUMN IF NOT EXISTS ${counter.column} integer NOT NULL DEFAULT 1`,
        );
      }
    }
    const broken = (await counterColumns(queryRunner)).filter((state) => !state.not_null || !state.has_default);
    for (const state of broken) await repairColumn(queryRunner, state);

    // 2. The line and the version themselves.
    await queryRunner.query(lineFunctionSql());
    await queryRunner.query(versionFunctionSql());
    for (const scope of SCOPES) {
      await queryRunner.query(`DROP TRIGGER IF EXISTS ${scope.items}_row_version ON ${scope.items}`);
      await queryRunner.query(`
        CREATE TRIGGER ${scope.items}_row_version
        BEFORE UPDATE ON ${scope.items}
        FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*)
        EXECUTE FUNCTION ${LINE_FUNCTION}()
      `);
      await queryRunner.query(`DROP TRIGGER IF EXISTS ${scope.versions}_budget_rev ON ${scope.versions}`);
      await queryRunner.query(`
        CREATE TRIGGER ${scope.versions}_budget_rev
        BEFORE UPDATE ON ${scope.versions}
        FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*)
        EXECUTE FUNCTION ${VERSION_FUNCTION}()
      `);

      // 3. The children: analytics values of the line, round inputs, costed lines and allocations of the version.
      await queryRunner.query(analyticsFunctionSql(scope));
      await createStatementTriggers(queryRunner, scope.analytics, `${scope.analytics}_row_version`, `${scope.analytics}_row_version`);
      for (const child of CHILDREN) {
        const table = scope[child.key];
        await queryRunner.query(childFunctionSql(scope, child.key, child.ignored));
        await createStatementTriggers(queryRunner, table, `${table}_budget_rev`, `${table}_budget_rev`);
      }

      // 4. The amounts: the totals function of 1853720000000, with its budget_rev step.
      await queryRunner.query(amountsFunctionSql(scope));
    }
    console.log(`[Migration] BudgetFreshnessCounters: row_version and budget_rev kept by triggers${broken.length ? `; repaired ${broken.map((s) => `${s.table}.${s.column}`).join(', ')}` : ''}`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const scope of [...SCOPES].reverse()) {
      for (const child of CHILDREN) {
        const table = scope[child.key];
        await dropStatementTriggers(queryRunner, table, `${table}_budget_rev`);
        await queryRunner.query(`DROP FUNCTION IF EXISTS ${table}_budget_rev()`);
      }
      await dropStatementTriggers(queryRunner, scope.analytics, `${scope.analytics}_row_version`);
      await queryRunner.query(`DROP FUNCTION IF EXISTS ${scope.analytics}_row_version()`);
      await queryRunner.query(`DROP TRIGGER IF EXISTS ${scope.versions}_budget_rev ON ${scope.versions}`);
      await queryRunner.query(`DROP TRIGGER IF EXISTS ${scope.items}_row_version ON ${scope.items}`);
    }
    await queryRunner.query(`DROP FUNCTION IF EXISTS ${VERSION_FUNCTION}()`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS ${LINE_FUNCTION}()`);
    // The amounts functions as 1853720000000 wrote them (it is idempotent; it also checks the totals).
    await new VersionTotals1853720000000().up(queryRunner);
    for (const scope of SCOPES) {
      for (const counter of COUNTERS) {
        await queryRunner.query(`ALTER TABLE ${counter.table(scope)} DROP COLUMN IF EXISTS ${counter.column}`);
      }
    }
  }
}

async function createStatementTriggers(queryRunner: QueryRunner, table: string, prefix: string, fn: string) {
  for (const event of EVENTS) {
    await queryRunner.query(`DROP TRIGGER IF EXISTS ${prefix}_${event} ON ${table}`);
    await queryRunner.query(`
      CREATE TRIGGER ${prefix}_${event}
      AFTER ${event.toUpperCase()} ON ${table}
      REFERENCING ${transition(event)}
      FOR EACH STATEMENT EXECUTE FUNCTION ${fn}()
    `);
  }
}

async function dropStatementTriggers(queryRunner: QueryRunner, table: string, prefix: string) {
  for (const event of EVENTS) await queryRunner.query(`DROP TRIGGER IF EXISTS ${prefix}_${event} ON ${table}`);
}

/**
 * A counter column found without its default or nullable (a partial earlier
 * run, a hand edit): default 1, NULL set to 1, NOT NULL. Migrations run
 * without a tenant and these tables FORCE row level security, so RLS is
 * disabled around the update and put back as it was found.
 */
async function repairColumn(queryRunner: QueryRunner, state: ColumnState) {
  await queryRunner.query(`ALTER TABLE ${state.table} ALTER COLUMN ${state.column} SET DEFAULT 1`);
  if (state.not_null) return;
  const [rls]: RlsState[] = await queryRunner.query(
    `SELECT relname::text AS name, relrowsecurity AS enabled, relforcerowsecurity AS forced FROM pg_class WHERE oid = $1::regclass`,
    [state.table],
  );
  await queryRunner.query(`ALTER TABLE ${state.table} DISABLE ROW LEVEL SECURITY`);
  try {
    const result = await queryRunner.query(`UPDATE ${state.table} SET ${state.column} = 1 WHERE ${state.column} IS NULL`);
    const count = Array.isArray(result) ? Number(result[1] ?? 0) : 0;
    console.log(`[Migration] BudgetFreshnessCounters: ${state.table}.${state.column}: ${count} NULL set to 1`);
  } finally {
    // After a failed update inside the migration transaction these fail too (and are ignored): the rollback puts RLS back.
    await queryRunner.query(`ALTER TABLE ${state.table} ${rls?.enabled ? 'ENABLE' : 'DISABLE'} ROW LEVEL SECURITY`).catch(() => undefined);
    await queryRunner.query(`ALTER TABLE ${state.table} ${rls?.forced ? 'FORCE' : 'NO FORCE'} ROW LEVEL SECURITY`).catch(() => undefined);
  }
  await queryRunner.query(`ALTER TABLE ${state.table} ALTER COLUMN ${state.column} SET NOT NULL`);
}
