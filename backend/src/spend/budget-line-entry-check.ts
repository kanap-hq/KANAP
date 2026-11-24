import type { EntityManager } from 'typeorm';
import { readBudgetColumns } from '../budget-columns/budget-columns.util';
import { SqlStatement } from '../common/list-engine/sql-statement';
import { AMOUNT_MEASURES, MEASURE_FREEZE_COLUMN, type AmountMeasure } from './amounts-write.util';
import { BUDGET_NATURES, naturesAnd, type BudgetNature } from './budget-nature';
import { isLimitedTransaction } from '../data-access/line-write-checks';

/**
 * "Quantity and price expected" read on the budget lines (lot B12a): an account
 * (`accounts.quantity_price_expected`) expects its lines' amounts to be built as quantity × price.
 * Nothing is stored on the line and nothing is refused: the rule is computed when it is read,
 * starting from the accounts that set it, so a tenant without such an account pays nothing.
 *
 * The level: the line's account when it sets it (`account`), else the account of the tenant's
 * consolidation chart (`chart_of_accounts.is_consolidation`, at most one) whose number is the
 * account's `consolidation_account_number` (`consolidation`). Setting a consolidation account
 * applies to every account mapped to it, as a block.
 *
 * A column of an expected line is looked at when it is shown in the tenant's settings
 * (`readBudgetColumns`), its net total for the year is not zero, and `nature:year:column` is not
 * frozen; every year the line has a version, after the end of validity cut as the list cuts it.
 * Such a column is to check unless it conforms (`columnConformsSql`). A line is `to_check` when
 * at least one of its columns is.
 *
 * Both readers build their SQL here: the list's check `quantity_price` of the field `to_check`
 * (`budget-line-checks.ts`, `budget-list.config.ts`) and the per-line reader (`readEntryChecks`,
 * the line's route, the list rows, Kad's detail).
 */

export type EntryCheckLevel = 'account' | 'consolidation';

/** The tenant's settings the rule reads, loaded once before a statement and bound to it. */
export type EntryCheckSettings = {
  /** The columns shown in the tenant's settings. */
  measures: AmountMeasure[];
  /** The frozen columns: `nature:year:measure`. */
  frozen: string[];
  /**
   * The statement runs under data-scoped access (`isLimitedTransaction`): the columns are probed
   * line by line (`lineColumnsToCheckSql`). Same answer either way, only the cost differs.
   */
  lineByLine: boolean;
};

/** A column to check: its year and its column (the storage key of the budget tab, `planned` …). */
export type EntryCheckColumn = { year: number; measure: AmountMeasure };

/** What the rule says of one line. */
export type LineEntryCheck = {
  /** The line's account, or its consolidation account, expects quantity and price. */
  expected: boolean;
  level: EntryCheckLevel | null;
  /**
   * The consolidation account that sets it (`level` `consolidation`), for a caller who reads the
   * accounts; null otherwise, as the list's consolidation fields.
   */
  consolidation_account: { number: number; name: string } | null;
  /** The columns to check, by year then in the columns' order. */
  columns: EntryCheckColumn[];
  to_check: boolean;
};

/**
 * A column conforms when it is built as quantity × price: its round (`spend_round_inputs`, one per
 * version and column) is `computed` from lines it still has (`spend_round_input_lines`), the
 * `followsLines` of the budget tab (`budget-column-operations.ts`). A copy of such a column
 * conforms too: the copy takes its lines, shifts them to the destination year, raises their prices
 * and computes them again (`copiedColumnRecord`, stored `computed`). Every other column is to
 * check: spread from a yearly amount or quarters (`spread`), entered by month (`manual`), without
 * a round (an import, an older line), and a copy of a column that was not built so, or of lines
 * whose calendar has no working days in the destination year, where the copy keeps the amounts
 * without computing them (`copied`, its lines only a reference).
 *
 * `round` is the alias of the column's `spend_round_inputs` row. The one place this rule lives.
 */
export function columnConformsSql(round: string): string {
  return `(${round}.method = 'computed' AND EXISTS (SELECT 1 FROM spend_round_input_lines ecl
    WHERE ecl.tenant_id = ${round}.tenant_id AND ecl.round_input_id = ${round}.id))`;
}

/** What a statement binds its values with (`SqlStatement`). */
type Binder = Pick<SqlStatement, 'tenant' | 'bind'>;

/**
 * The accounts whose lines are expected, from the accounts that set it: `account_id`, `level`, and
 * for `consolidation` the consolidation account's number and name (`cons_number`, `cons_name`).
 * One row per account: a local account maps to one consolidation account at most (one
 * consolidation chart, one account per number in it).
 */
export function expectedAccountsSql(stmt: Binder): string {
  const t = stmt.tenant;
  return `SELECT a.id AS account_id, 'account'::text AS level, NULL::bigint AS cons_number, NULL::text AS cons_name
      FROM accounts a
      WHERE a.tenant_id = ${t} AND a.quantity_price_expected
    UNION ALL
    SELECT a.id, 'consolidation', ca.account_number, ca.account_name
      FROM chart_of_accounts cc
      JOIN accounts ca ON ca.tenant_id = ${t} AND ca.coa_id = cc.id AND ca.quantity_price_expected
      JOIN accounts a ON a.tenant_id = ${t} AND a.consolidation_account_number = ca.account_number
        AND a.quantity_price_expected IS NOT TRUE
      WHERE cc.tenant_id = ${t} AND cc.is_consolidation`;
}

/**
 * The columns to check of one line: the `FROM` and `WHERE` that select its versions and columns
 * (`v`, `m`). `line` is the alias of the line's `spend_items` row in the enclosing statement, whose
 * account the caller already knows to expect quantity and price.
 *
 * Two shapes of the same test, after `settings.lineByLine`:
 * - all data (`false`): `NOT EXISTS`, which the planner turns into one anti-join against the
 *   conforming columns of the whole tenant, the cheapest when every row is readable;
 * - data-scoped access (`true`): each column's round is probed by the unique (tenant, version,
 *   column) index through a scalar subquery, which the planner cannot turn into a join. Under that
 *   access every row these tables return is checked against the person's scope, at a cost per row:
 *   probing reads only the rows of the lines the person sees, and stops at the first column to
 *   check when the caller asks whether there is one (the list's field), where the join checked
 *   every round and every round line of the tenant.
 */
function lineColumnsParts(stmt: Binder, line: string, settings: EntryCheckSettings): { from: string; where: string } {
  const t = stmt.tenant;
  // Each measure is one of the five column names (`AMOUNT_MEASURES`): never request text.
  const values = AMOUNT_MEASURES.map((measure) => `('${measure}', vt.${measure})`).join(', ');
  const conforming = `SELECT 1 FROM spend_round_inputs er
        WHERE er.tenant_id = ${t} AND er.version_id = v.id AND er.measure = m.measure AND ${columnConformsSql('er')}`;
  return {
    from: `spend_versions v
    JOIN spend_version_totals vt ON vt.tenant_id = ${t} AND vt.version_id = v.id
    CROSS JOIN LATERAL (VALUES ${values}) m(measure, total)`,
    where: `v.tenant_id = ${t} AND v.spend_item_id = ${line}.id
      AND (${line}.disabled_at IS NULL OR v.budget_year <= extract(year FROM ${line}.disabled_at AT TIME ZONE 'UTC'))
      AND m.measure = ANY(${stmt.bind(settings.measures, 'text[]')}) AND m.total <> 0
      AND NOT ((${line}.nature || ':' || v.budget_year || ':' || m.measure) = ANY(${stmt.bind(settings.frozen, 'text[]')}))
      AND ${settings.lineByLine ? `(${conforming}) IS NULL` : `NOT EXISTS (${conforming})`}`,
  };
}

/** The columns to check of one line (`year`, `measure`), as a subquery on `line` (`lineColumnsParts`). */
export function lineColumnsToCheckSql(stmt: Binder, line: string, settings: EntryCheckSettings): string {
  const { from, where } = lineColumnsParts(stmt, line, settings);
  return `SELECT v.budget_year AS year, m.measure FROM ${from} WHERE ${where}`;
}

/**
 * The columns to check of the expected lines (`item_id`, `year`, `measure`), from the CTE of
 * `expectedAccountsSql` named `accounts`. `natures`: the lines read; `itemIds`: only these lines
 * (a bound uuid array), else every line of the tenant. With every row readable, one flat join the
 * planner may hash; line by line, a subquery kept apart (`OFFSET 0`) that runs for each line.
 */
export function columnsToCheckSql(
  stmt: Binder,
  accounts: string,
  settings: EntryCheckSettings,
  natures: readonly BudgetNature[],
  itemIds?: string,
): string {
  const t = stmt.tenant;
  const lines = `${accounts} ea
    JOIN spend_items li ON li.tenant_id = ${t} AND li.account_id = ea.account_id${naturesAnd('li', natures)}${itemIds ? ` AND li.id = ANY(${itemIds})` : ''}`;
  if (settings.lineByLine) {
    return `SELECT li.id AS item_id, c.year, c.measure
    FROM ${lines}
    CROSS JOIN LATERAL (${lineColumnsToCheckSql(stmt, 'li', settings)} OFFSET 0) c`;
  }
  const { from, where } = lineColumnsParts(stmt, 'li', settings);
  return `SELECT li.id AS item_id, v.budget_year AS year, m.measure
    FROM ${lines}, ${from}
    WHERE ${where}`;
}

/**
 * The tenant's shown columns and frozen columns, read once (two small reads: the tenant's settings
 * and its freezes), and whether the transaction runs under data-scoped access.
 */
export async function loadEntryCheckSettings(manager: EntityManager, tenantId: string): Promise<EntryCheckSettings> {
  const columns = await readBudgetColumns(manager, tenantId);
  const measureOf = new Map<string, AmountMeasure>(AMOUNT_MEASURES.map((measure) => [MEASURE_FREEZE_COLUMN[measure], measure]));
  const rows: Array<{ scope: string; budget_year: number; column_key: string }> = await manager.query(
    `SELECT scope, budget_year, column_key FROM freeze_states
      WHERE tenant_id = $1 AND is_frozen AND scope = ANY($2::text[])`,
    [tenantId, BUDGET_NATURES],
  );
  const frozen = rows.flatMap((row) => {
    const measure = measureOf.get(row.column_key);
    return measure ? [`${row.scope}:${Number(row.budget_year)}:${measure}`] : [];
  });
  return {
    measures: AMOUNT_MEASURES.filter((measure) => columns.enabled[measure]),
    frozen,
    lineByLine: await isLimitedTransaction(manager),
  };
}

const NOT_EXPECTED: LineEntryCheck = { expected: false, level: null, consolidation_account: null, columns: [], to_check: false };

/**
 * The rule for a batch of lines of either nature, in two statements whatever their number: the
 * lines whose account expects quantity and price (and nothing more when there is none), then their
 * columns to check, after the tenant's settings (two small reads, unless `settings` gives them). Every line asked comes back; a line that is
 * not expected, or that the caller cannot read (data-scoped access), reads as not expected.
 * `accounts`: the caller reads the accounts page, so the consolidation account is named.
 */
export async function readEntryChecks(
  manager: EntityManager,
  tenantId: string,
  itemIds: readonly string[],
  opts: { accounts?: boolean; settings?: EntryCheckSettings } = {},
): Promise<Map<string, LineEntryCheck>> {
  const result = new Map<string, LineEntryCheck>(itemIds.map((id) => [id, NOT_EXPECTED]));
  const ids = Array.from(new Set(itemIds));
  if (ids.length === 0) return result;

  const first = new SqlStatement(tenantId);
  const expected = first.finalize(`WITH ea AS (${expectedAccountsSql(first)})
    SELECT li.id, ea.level, ea.cons_number::text AS cons_number, ea.cons_name
      FROM spend_items li JOIN ea ON ea.account_id = li.account_id
      WHERE li.tenant_id = ${first.tenant}${naturesAnd('li', BUDGET_NATURES)} AND li.id = ANY(${first.bind(ids, 'uuid[]')})`);
  const lines: Array<{ id: string; level: EntryCheckLevel; cons_number: string | null; cons_name: string | null }> =
    await manager.query(expected.sql, expected.params);
  if (lines.length === 0) return result;

  const settings = opts.settings ?? await loadEntryCheckSettings(manager, tenantId);
  const second = new SqlStatement(tenantId);
  const columns = second.finalize(`WITH ea AS (${expectedAccountsSql(second)})
    ${columnsToCheckSql(second, 'ea', settings, BUDGET_NATURES, second.bind(lines.map((line) => line.id), 'uuid[]'))}`);
  const rows: Array<{ item_id: string; year: number; measure: AmountMeasure }> = await manager.query(columns.sql, columns.params);
  const byLine = new Map<string, EntryCheckColumn[]>();
  for (const row of rows) {
    const list = byLine.get(row.item_id) ?? [];
    list.push({ year: Number(row.year), measure: row.measure });
    byLine.set(row.item_id, list);
  }
  for (const line of lines) {
    const toCheck = (byLine.get(line.id) ?? [])
      .sort((a, b) => a.year - b.year || AMOUNT_MEASURES.indexOf(a.measure) - AMOUNT_MEASURES.indexOf(b.measure));
    result.set(line.id, {
      expected: true,
      level: line.level,
      consolidation_account: line.level === 'consolidation' && opts.accounts && line.cons_number != null
        ? { number: Number(line.cons_number), name: line.cons_name ?? '' }
        : null,
      columns: toCheck,
      to_check: toCheck.length > 0,
    });
  }
  return result;
}
