import { BadRequestException, ConflictException, HttpStatus } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { toCents } from '../common/amount';
import { EDIT_CONFLICT_CODE, EditConflictAuthor, authorAt, userNames } from '../common/edit-conflicts';
import {
  AMOUNT_MEASURES,
  BUDGET_COLUMN_MEASURE,
  BudgetColumn,
  AmountMeasure,
  AmountScope,
  AmountVersion,
  PlannedAmounts,
  isAmountMeasure,
  readVersionMonths,
  validateAmountValue,
  yearPeriods,
} from './amounts-write.util';
import { CostingInputError, CostLine, parseCostLines, sameLines } from './costing.util';
import { RoundInput, centsToDecimal, costLine, versionRoundInputs } from './round-inputs.util';

/**
 * Edit conflicts of the budget tab (plan planning/perf-scale, lot 3D,
 * decisions D2, D3 and D5), the budget's side of the contract in
 * `common/edit-conflicts.ts` (lot 3C).
 *
 * A `bulk-upsert` body may carry `base`, what the user's edit started from:
 * - a monthly entry (`kind: 'monthly'`): `base.months`, rows shaped like
 *   `months` (`{ period, <column>: value }`), per changed cell the value the
 *   screen showed when the edit began;
 * - a yearly total, quarters or costed lines (`annual`, `quarterly`,
 *   `lines`): `base.columns.<column>.months`, the column's twelve months as
 *   the screen read them (January first), and for costed lines
 *   `base.columns.<column>.lines`, the lines the drafts started from.
 * The base is the values themselves, not a hash: the screen holds them, and
 * the answer can say which months moved. `amountRowsSignature` of the AI
 * preview signs every column of the year at once, which a column edit must
 * not compare (D2).
 *
 * Without `base` nothing is compared (the AI, the CSV imports, the column
 * operations, older clients). With it, once the line is locked (every writer
 * of a line's budget holds it first, `budget-locks.ts`, so the months and
 * lines read here are the ones the write replaces) and before anything is
 * written, the cells or columns the request writes AND names in its base are
 * compared with what is stored (cents; a missing month is zero):
 * - a cell conflicts when its stored value is neither its base nor the value
 *   the request writes: two people on different months, or on different
 *   columns of a month, never conflict;
 * - a column conflicts when one of its months is not its base, or (costed
 *   lines) its lines are not the base's, unless the column already holds
 *   what the request writes: a yearly total typed over a month someone else
 *   just changed in that column conflicts; a column of "apply to all
 *   columns" is spread from its stored total and carries no base;
 * - any conflict refuses the whole request (D5, one request is one action of
 *   the user): 409 `edit_conflict`, one entry per column (`field` is the
 *   column's storage name), with the months that moved, the twelve months
 *   now (`current`, what « Overwrite » sends again as the base), the twelve
 *   the request would leave (`mine`), the stored lines when the request
 *   compared lines, and who wrote the current value and when.
 * `budget_rev` (lot 3B) is not a base: it counts every column of the version,
 * so comparing it would make two people on two columns conflict. It is
 * returned with the answer for information.
 *
 * Who and when come from the audit trail, as in lot 3C: the latest amounts
 * audit row of the version (record id = the version, since lot 3D) that
 * changed the column in one of the months that moved and wrote their current
 * values; for lines alone, the latest audit row of the column's record that
 * changed its lines and wrote the current ones. A value no audit row explains
 * (a column copy or clear, an item CSV total, a write older than lot 3D, a
 * script) names nobody; the time is then the moment those months were last
 * written.
 */

// Table names come only from here: never from the caller.
const AMOUNT_TABLE: Record<AmountScope, string> = { opex: 'spend_amounts', capex: 'capex_amounts' };
const ROUND_TABLE: Record<AmountScope, string> = { opex: 'spend_round_inputs', capex: 'capex_round_inputs' };
const VERSION_TABLE: Record<AmountScope, string> = { opex: 'spend_versions', capex: 'capex_versions' };
const ITEM_TABLE: Record<AmountScope, { items: string; itemFk: string }> = {
  opex: { items: 'spend_items', itemFk: 'spend_item_id' },
  capex: { items: 'capex_items', itemFk: 'capex_item_id' },
};
/** The API name of each column, as the column copy and clear audit it (`budget-column-operations.ts`). */
const MEASURE_COLUMN = Object.fromEntries(
  (Object.entries(BUDGET_COLUMN_MEASURE) as Array<[BudgetColumn, AmountMeasure]>).map(([column, measure]) => [measure, column]),
) as Record<AmountMeasure, BudgetColumn>;

/** A column's base: its twelve months and, for costed lines, its lines (null: lines that could not be read, compared as different). */
type ColumnBase = { months: bigint[]; lines?: CostLine[] | null };

export type BudgetBase = {
  /** Per period (`YYYY-MM-01`), the cells the edit started from. */
  cells: Map<string, Partial<Record<AmountMeasure, bigint>>>;
  columns: Map<AmountMeasure, ColumnBase>;
};

/** A refused column, as the 409 answers it. */
export type BudgetEditConflict = {
  /** The column, by its storage name (`planned`, `forecast`…). */
  field: AmountMeasure;
  /** The months that moved (`YYYY-MM-01`): for cells, the refused ones. */
  periods: string[];
  /** The twelve months the edit started from (columns), null for cells. */
  base: string[] | null;
  /** The column's twelve months now, January first. */
  current: string[];
  /** The twelve months the request would have left. */
  mine: string[];
  /** The column's stored lines, when the request compared lines. */
  current_lines?: CostLine[];
  labels: { base: null; current: null; mine: null };
  changed_by: EditConflictAuthor | null;
  changed_at: string | null;
};

export const BUDGET_CONFLICT_MESSAGE =
  'Someone else changed this column while you were editing it. Reload the column, or overwrite it with your values.';

export class BudgetEditConflictException extends ConflictException {
  constructor(readonly conflicts: BudgetEditConflict[], readonly budgetRev: number | null) {
    super({
      statusCode: HttpStatus.CONFLICT,
      error: 'Conflict',
      code: EDIT_CONFLICT_CODE,
      message: BUDGET_CONFLICT_MESSAGE,
      conflicts,
      budget_rev: budgetRev,
    });
  }
}

const MONTH = /^(\d{4})-(\d{2})-01$/;

/** The month's index (0 for January) of a `YYYY-MM-01` period of `year`, else null. */
function monthIndex(period: string, year: number): number | null {
  const match = MONTH.exec(period.trim());
  if (!match || Number(match[1]) !== year) return null;
  const index = Number(match[2]) - 1;
  return index >= 0 && index < 12 ? index : null;
}

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** A base value in cents; empty is zero (a month the screen showed empty). */
function baseCents(value: unknown, where: string): bigint {
  return value === null || value === undefined || value === '' ? 0n : validateAmountValue(value, `The base of ${where}`);
}

/** The request's `base`, validated (400 when malformed); null without one. */
export function parseBudgetBase(raw: unknown, year: number): BudgetBase | null {
  if (raw === undefined || raw === null) return null;
  if (!isObject(raw)) {
    throw new BadRequestException('base must say what the edit started from: months for cells, columns for yearly totals and costed lines.');
  }
  const cells = new Map<string, Partial<Record<AmountMeasure, bigint>>>();
  const columns = new Map<AmountMeasure, ColumnBase>();
  if (raw.months !== undefined && raw.months !== null) {
    if (!Array.isArray(raw.months)) throw new BadRequestException('base.months must be a list of months.');
    for (const entry of raw.months) {
      if (!isObject(entry)) throw new BadRequestException('Each month of base.months must be an object.');
      const period = typeof entry.period === 'string' ? entry.period.trim() : '';
      if (monthIndex(period, year) === null) throw new BadRequestException(`base.months: '${period}' is not a month of ${year} (YYYY-MM-01).`);
      const cell = cells.get(period) ?? {};
      for (const [key, value] of Object.entries(entry)) {
        if (key === 'period') continue;
        if (!isAmountMeasure(key)) throw new BadRequestException(`Unknown amount '${key}' in base.months. Use ${AMOUNT_MEASURES.join(', ')}.`);
        cell[key] = baseCents(value, `${key} for ${period}`);
      }
      cells.set(period, cell);
    }
  }
  if (raw.columns !== undefined && raw.columns !== null) {
    if (!isObject(raw.columns)) throw new BadRequestException('base.columns must map each column to what the edit started from.');
    for (const [key, value] of Object.entries(raw.columns)) {
      if (!isAmountMeasure(key)) throw new BadRequestException(`Unknown amount '${key}' in base.columns. Use ${AMOUNT_MEASURES.join(', ')}.`);
      if (!isObject(value) || !Array.isArray(value.months) || value.months.length !== 12) {
        throw new BadRequestException(`base.columns.${key}.months must hold the twelve months of the year, January first.`);
      }
      const months = value.months.map((cents, index) => baseCents(cents, `${key}, month ${index + 1}`));
      if (value.lines === undefined || value.lines === null) {
        columns.set(key, { months });
        continue;
      }
      let lines: CostLine[] | null;
      try {
        lines = parseCostLines(value.lines, year);
      } catch (error) {
        if (!(error instanceof CostingInputError)) throw error;
        lines = null;
      }
      columns.set(key, { months, lines });
    }
  }
  return cells.size > 0 || columns.size > 0 ? { cells, columns } : null;
}

/** A column that conflicts, before the answer is built. */
type ColumnConflict = {
  measure: AmountMeasure;
  /** Indexes of the months that moved. */
  moved: number[];
  base: bigint[] | null;
  current: bigint[];
  mine: bigint[];
  /** The stored lines, when the request compared lines. */
  currentLines?: CostLine[];
};

const sameMonths = (a: readonly bigint[], b: readonly bigint[]) => a.length === b.length && a.every((cents, i) => cents === b[i]);

/**
 * The columns of `plan` that someone else changed since the base (see the
 * file header). Reads the version's months, and its records when lines are
 * compared, under the line's lock held by the caller.
 */
export async function findBudgetConflicts(
  manager: EntityManager,
  scope: AmountScope,
  version: AmountVersion,
  base: BudgetBase,
  plan: PlannedAmounts,
): Promise<ColumnConflict[]> {
  const year = Number(version.budget_year);
  const periods = yearPeriods(year);
  const stored = (await readVersionMonths(manager, scope, version.tenant_id, [version])).get(version.id)!.months;
  const conflicts: ColumnConflict[] = [];

  if (plan.kind === 'cells') {
    const refused = new Map<AmountMeasure, Set<number>>();
    const mine = new Map<AmountMeasure, bigint[]>();
    for (const row of plan.rows) {
      // A month that is not one of the year is refused by the write itself (400), after this.
      const index = monthIndex(String(row.period ?? ''), year);
      if (index === null) continue;
      const cellBase = base.cells.get(periods[index]);
      for (const measure of AMOUNT_MEASURES) {
        const value = row[measure];
        if (value === undefined) continue;
        const months = mine.get(measure) ?? [...stored[measure]];
        months[index] = value;
        mine.set(measure, months);
        const startedFrom = cellBase?.[measure];
        if (startedFrom === undefined) continue;
        const current = stored[measure][index];
        // Unchanged since the edit began, or already the value being written (the same change twice).
        if (current === startedFrom || current === value) continue;
        refused.set(measure, (refused.get(measure) ?? new Set<number>()).add(index));
      }
    }
    for (const measure of AMOUNT_MEASURES) {
      const indexes = refused.get(measure);
      if (!indexes) continue;
      conflicts.push({ measure, moved: [...indexes].sort((a, b) => a - b), base: null, current: stored[measure], mine: mine.get(measure)! });
    }
    return conflicts;
  }

  let records: RoundInput[] | null = null;
  for (const column of plan.columns) {
    const startedFrom = base.columns.get(column.measure);
    if (!startedFrom) continue;
    const current = stored[column.measure];
    const mine = column.months ? [...column.months] : current;
    // Removing costed lines leaves the months as stored: a month changed meanwhile is not overwritten,
    // so only the lines are compared.
    const moved = column.months === null ? [] : current.flatMap((cents, i) => (cents === startedFrom.months[i] ? [] : [i]));
    let currentLines: CostLine[] | undefined;
    if (startedFrom.lines !== undefined || column.lines !== undefined) {
      records ??= await versionRoundInputs(manager, scope, version);
      currentLines = (records.find((r) => r.measure === column.measure)?.lines ?? []).map(costLine);
    }
    const linesMoved = startedFrom.lines !== undefined && (startedFrom.lines === null || !sameLines(currentLines!, startedFrom.lines));
    if (moved.length === 0 && !linesMoved) continue;
    // The column already holds what the request writes: the same change made twice.
    if (sameMonths(current, mine) && (column.lines === undefined || sameLines(currentLines!, column.lines))) continue;
    conflicts.push({
      measure: column.measure,
      moved,
      base: startedFrom.months,
      current,
      mine,
      ...(startedFrom.lines !== undefined ? { currentLines } : {}),
    });
  }
  return conflicts;
}

type Pick_ = { userId: string | null; at: Date | string | null };

/** The latest amounts audit row of the version that changed each column in its moved months (one query). */
async function monthsAuthors(manager: EntityManager, scope: AmountScope, version: AmountVersion, conflicts: ColumnConflict[]): Promise<Map<AmountMeasure, Pick_>> {
  const result = new Map<AmountMeasure, Pick_>();
  if (conflicts.length === 0) return result;
  const periods = yearPeriods(Number(version.budget_year));
  const rows: Array<{ measure: AmountMeasure; user_id: string | null; created_at: Date | null; after_json: unknown }> = await manager.query(
    `SELECT f.measure, a.user_id::text AS user_id, a.created_at, a.after_json
       FROM unnest($4::text[], $5::text[]) AS f(measure, periods)
       LEFT JOIN LATERAL (
         SELECT l.user_id, l.created_at, l.after_json
           FROM audit_log l
          WHERE l.tenant_id = $1 AND l.record_id = $2 AND l.table_name = $3
            AND jsonb_typeof(l.after_json) = 'array'
            AND EXISTS (
              SELECT 1
                FROM jsonb_array_elements(l.after_json) AS aft(month)
               WHERE aft.month->>'period' = ANY(string_to_array(f.periods, ','))
                 AND COALESCE((aft.month->>f.measure)::numeric, 0) IS DISTINCT FROM COALESCE((
                       SELECT (bef.month->>f.measure)::numeric
                         FROM jsonb_array_elements(CASE WHEN jsonb_typeof(l.before_json) = 'array' THEN l.before_json ELSE '[]'::jsonb END) AS bef(month)
                        WHERE bef.month->>'period' = aft.month->>'period'
                        LIMIT 1), 0))
          ORDER BY l.created_at DESC
          LIMIT 1
       ) a ON true`,
    [
      version.tenant_id,
      version.id,
      AMOUNT_TABLE[scope],
      conflicts.map((c) => c.measure),
      conflicts.map((c) => c.moved.map((i) => periods[i]).join(',')),
    ],
  );
  // When nobody is named: the moment the moved months were last written.
  const written: Array<{ period: string; updated_at: Date }> = await manager.query(
    `SELECT to_char(period, 'YYYY-MM-DD') AS period, updated_at FROM ${AMOUNT_TABLE[scope]}
      WHERE tenant_id = $1 AND version_id = $2 AND period = ANY($3::date[])`,
    [version.tenant_id, version.id, Array.from(new Set(conflicts.flatMap((c) => c.moved.map((i) => periods[i]))))],
  );
  const writtenAt = new Map(written.map((row) => [row.period, new Date(row.updated_at)]));
  const operations = await columnOperations(manager, scope, version, conflicts);
  for (const conflict of conflicts) {
    const row = rows.find((r) => r.measure === conflict.measure);
    const after = Array.isArray(row?.after_json) ? (row!.after_json as Array<Record<string, unknown>>) : [];
    // The row explains the column only if it wrote the current value of every moved month it holds.
    const explains = !!row?.created_at && conflict.moved.every((i) => {
      const month = after.find((m) => m.period === periods[i]);
      return !month || toCents(month[conflict.measure] as string | null) === conflict.current[i];
    });
    // A column copy or clear writes no amounts audit row: its row on the line names who ran it, when it
    // is the column's latest change and left the column's current total.
    const operation = operations.get(conflict.measure);
    const operationLater = !!operation && (!row?.created_at || new Date(operation.created_at).getTime() > new Date(row.created_at).getTime());
    if (operationLater && operation!.explains(sumOf(conflict.current))) {
      result.set(conflict.measure, { userId: operation!.user_id, at: operation!.created_at });
    } else if (explains) {
      result.set(conflict.measure, { userId: row!.user_id, at: row!.created_at });
    } else {
      const times = conflict.moved.map((i) => writtenAt.get(periods[i])?.getTime() ?? 0);
      const latest = Math.max(0, ...times);
      result.set(conflict.measure, { userId: null, at: latest > 0 ? new Date(latest) : null });
    }
  }
  return result;
}

const sumOf = (months: readonly bigint[]) => months.reduce((sum, cents) => sum + cents, 0n);

type ColumnOperation = { user_id: string | null; created_at: Date; explains: (total: bigint) => boolean };

/**
 * The latest column copy or clear of each conflicting column of the version's year: the audit row
 * the operation writes on the line (`budget-column-operations.ts`: `operation`, the column by its API
 * name, the year, the column's total after it). One query.
 */
async function columnOperations(manager: EntityManager, scope: AmountScope, version: AmountVersion, conflicts: ColumnConflict[]): Promise<Map<AmountMeasure, ColumnOperation>> {
  const result = new Map<AmountMeasure, ColumnOperation>();
  const t = ITEM_TABLE[scope];
  const rows: Array<{ measure: AmountMeasure; user_id: string | null; created_at: Date | null; after_json: Record<string, unknown> | null }> = await manager.query(
    `SELECT f.measure, a.user_id::text AS user_id, a.created_at, a.after_json
       FROM unnest($4::text[], $5::text[]) AS f(measure, api_column)
       LEFT JOIN LATERAL (
         SELECT l.user_id, l.created_at, l.after_json
           FROM audit_log l
          WHERE l.tenant_id = $1 AND l.table_name = $3
            AND l.record_id = (SELECT v.${t.itemFk} FROM ${VERSION_TABLE[scope]} v WHERE v.tenant_id = $1 AND v.id = $2)
            AND (
              (l.after_json->>'operation' = 'budget_column_copy' AND l.after_json->>'destinationColumn' = f.api_column
                 AND l.after_json->>'destinationYear' = $6)
              OR (l.after_json->>'operation' = 'budget_column_clear' AND l.after_json->>'column' = f.api_column
                 AND l.after_json->>'year' = $6))
          ORDER BY l.created_at DESC
          LIMIT 1
       ) a ON true`,
    [
      version.tenant_id,
      version.id,
      t.items,
      conflicts.map((c) => c.measure),
      conflicts.map((c) => MEASURE_COLUMN[c.measure]),
      String(Number(version.budget_year)),
    ],
  );
  for (const row of rows) {
    if (!row.created_at || !row.after_json) continue;
    const column = MEASURE_COLUMN[row.measure];
    const written = row.after_json[column];
    // The total the operation left; a clear leaves zero.
    const total = toCents(written as number | string | null);
    result.set(row.measure, { user_id: row.user_id, created_at: row.created_at, explains: (current) => current === total });
  }
  return result;
}

/**
 * The latest audit row of the column's record that changed its lines (a record
 * write audits its lines only when they change), when the lines alone moved.
 * No record (the column was cleared): nobody, no time.
 */
async function linesAuthor(manager: EntityManager, scope: AmountScope, version: AmountVersion, conflict: ColumnConflict): Promise<Pick_> {
  const [row]: Array<{ user_id: string | null; created_at: Date | null; after_json: Record<string, unknown> | null; record_updated_at: Date }> = await manager.query(
    `SELECT a.user_id::text AS user_id, a.created_at, a.after_json, r.updated_at AS record_updated_at
       FROM ${ROUND_TABLE[scope]} r
       LEFT JOIN LATERAL (
         SELECT l.user_id, l.created_at, l.after_json
           FROM audit_log l
          WHERE l.tenant_id = r.tenant_id AND l.record_id = r.id AND l.table_name = $4
            AND l.after_json ? 'lines'
          ORDER BY l.created_at DESC
          LIMIT 1
       ) a ON true
      WHERE r.tenant_id = $1 AND r.version_id = $2 AND r.measure = $3`,
    [version.tenant_id, version.id, conflict.measure, ROUND_TABLE[scope]],
  );
  if (!row) return { userId: null, at: null };
  const written = row.after_json?.lines;
  const explains = !!row.created_at && Array.isArray(written)
    && sameLines((written as Parameters<typeof costLine>[0][]).map(costLine), conflict.currentLines ?? []);
  return explains ? { userId: row.user_id, at: row.created_at } : { userId: null, at: row.record_updated_at };
}

/** Who wrote each refused column's current value, and when. */
async function conflictAuthors(manager: EntityManager, scope: AmountScope, version: AmountVersion, conflicts: ColumnConflict[]) {
  const picks = await monthsAuthors(manager, scope, version, conflicts.filter((c) => c.moved.length > 0));
  for (const conflict of conflicts) {
    if (conflict.moved.length === 0) picks.set(conflict.measure, await linesAuthor(manager, scope, version, conflict));
  }
  const names = await userNames(manager, version.tenant_id, Array.from(picks.values()).map((p) => p.userId));
  return new Map(Array.from(picks, ([measure, pick]) => [measure, authorAt(names, pick.userId, pick.at)]));
}

/**
 * The check a `bulk-upsert` with a base runs before it writes (see the file
 * header), as `AmountsWriteContext.beforeWrite`; undefined without a base.
 * The base is validated at once (a malformed one is a 400).
 */
export function budgetBaseCheck(
  manager: EntityManager,
  scope: AmountScope,
  version: AmountVersion,
  rawBase: unknown,
): ((plan: PlannedAmounts) => Promise<void>) | undefined {
  const base = parseBudgetBase(rawBase, Number(version.budget_year));
  if (!base) return undefined;
  return async (plan) => {
    const conflicts = await findBudgetConflicts(manager, scope, version, base, plan);
    if (conflicts.length === 0) return;
    const authors = await conflictAuthors(manager, scope, version, conflicts);
    const [row]: Array<{ budget_rev: number | string }> = await manager.query(
      `SELECT budget_rev FROM ${VERSION_TABLE[scope]} WHERE tenant_id = $1 AND id = $2`,
      [version.tenant_id, version.id],
    );
    const periods = yearPeriods(Number(version.budget_year));
    throw new BudgetEditConflictException(
      conflicts.map((conflict) => ({
        field: conflict.measure,
        periods: conflict.moved.map((i) => periods[i]),
        base: conflict.base ? conflict.base.map(centsToDecimal) : null,
        current: conflict.current.map(centsToDecimal),
        mine: conflict.mine.map(centsToDecimal),
        ...(conflict.currentLines ? { current_lines: conflict.currentLines } : {}),
        labels: { base: null, current: null, mine: null },
        ...(authors.get(conflict.measure) ?? { changed_by: null, changed_at: null }),
      })),
      row ? Number(row.budget_rev) : null,
    );
  };
}
