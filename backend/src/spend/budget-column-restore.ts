import { BadRequestException } from '@nestjs/common';
import { toCents } from '../common/amount';
import { DecimalLimitError, parseLimitedDecimal } from '../common/decimal';
import { loadWorkingDayProfiles } from '../working-day-profiles/working-day-profiles.util';
import {
  AMOUNT_MEASURES,
  AmountMeasure,
  AmountsWriteContext,
  AmountsWriteResult,
  assertMeasuresEditable,
  assertYearMatchesVersion,
  isAmountMeasure,
  replaceAmounts,
  validateAmountValue,
  yearPeriods,
} from './amounts-write.util';
import { CostingInputError, CostLine, parseCostLines } from './costing.util';
import {
  centsToDecimal,
  deleteRoundInput,
  LastCalculation,
  RoundInputFields,
  RoundInputsContext,
  RoundMethod,
  upsertRoundInput,
} from './round-inputs.util';
import { activeMonths, SpreadInputError } from './spread.util';

/**
 * "Back to the opening values" of the budget tab (plan budget-tab-redesign,
 * lot B2): `bulk-upsert` with `kind: 'restore'` puts one column back as the
 * screen read it when the line was opened: its twelve months and its record
 * (how it was built: method, period, profile, calculation, FTE and lines), or
 * no record. One column per request: a column refused (frozen, changed by
 * someone else) never stops the others, which the screen sends apart.
 *
 * The request is checked like any write of the tab, in this order: the
 * payload and the record (400), the freeze of the column (403), the calendars
 * of the lines (400), the column against its `base` (409 `edit_conflict`, the
 * body of `budget-edit-conflicts.ts`; a restore needs a base). Then the months
 * and the record are written as sent, nothing computed again: the months of
 * the column through the one amounts writer (the version's totals follow), the
 * record and its lines replaced, or the record deleted. The audit rows are
 * those of any column write (the months by the version, the record by its
 * id), with the action `restored`.
 *
 * A record is refused when it does not hold together (see `parseRecord`): a
 * restore stores the explanation as sent, so it must at least explain the
 * months it comes with.
 */

export type RestoreAmountsPayload = {
  kind: 'restore';
  year: number;
  measure: AmountMeasure;
  /** The twelve months of the column, January first (numbers or decimal strings). */
  months: Array<number | string>;
  /** The column's record as read (`RoundInput`), or null: the column has none. */
  record: null | {
    measure?: AmountMeasure;
    period_start: string;
    period_end: string;
    method: RoundMethod;
    spread_profile_name?: string | null;
    last_calculation?: LastCalculation | null;
    fte?: string | number | null;
    lines?: unknown[];
  };
  base: { columns: Partial<Record<AmountMeasure, { months: unknown[]; lines?: unknown[] }>> };
};

export function isRestorePayload(payload: unknown): payload is RestoreAmountsPayload {
  return typeof payload === 'object' && payload !== null && (payload as { kind?: unknown }).kind === 'restore';
}

/** What a restore still writes once its months are: the record and its lines, or none. */
export type ColumnRestore = { measure: AmountMeasure; record: { fields: RoundInputFields; lines: CostLine[] } | null };

export type RestorePayloadResult = AmountsWriteResult & { spread: null; restore: ColumnRestore };

export function isRestoreResult(result: object): result is RestorePayloadResult {
  return 'restore' in result;
}

const METHODS: readonly RoundMethod[] = ['spread', 'copied', 'manual', 'computed'];
/** The calculation each method stores; a `manual` record keeps whatever it had, or none. */
const CALCULATIONS: Record<Exclude<RoundMethod, 'manual'>, readonly string[]> = {
  spread: ['annual', 'quarterly'],
  copied: ['copy'],
  computed: ['computed'],
};
const CALCULATION_KINDS = ['annual', 'quarterly', 'copy', 'computed'];
// The round's fte column is numeric(9,2), never negative.
const FTE_LIMITS = { label: 'The FTE of the record', decimals: 2, min: '0', maxAbs: '10000000' };

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const refused = (text: string) => new BadRequestException(text);

/** An amount of the calculation, in cents. */
function calculationCents(value: unknown, field: string): bigint {
  if (!(typeof value === 'number' && Number.isFinite(value)) && !(typeof value === 'string' && value.trim() !== '')) {
    throw refused(`The record's calculation has no ${field}.`);
  }
  try {
    return toCents(value);
  } catch {
    throw refused(`The record's calculation has no ${field}.`);
  }
}

/** The total a calculation explains: its `total`, or its four quarters. */
function calculationTotal(calculation: Record<string, unknown>): bigint {
  if (calculation.kind !== 'quarterly') return calculationCents(calculation.total, 'total');
  const quarters = isObject(calculation.quarters) ? calculation.quarters : {};
  return (['Q1', 'Q2', 'Q3', 'Q4'] as const).reduce((sum, q) => sum + calculationCents(quarters[q], `amount for ${q}`), 0n);
}

/**
 * The record of a restore, checked (a 400 names what does not hold); null:
 * the column has no record. Rules:
 * - it is the record of this column (`measure`, when sent);
 * - `method` is spread, copied, manual or computed;
 * - `period_start` and `period_end` are dates of the year, start not after end;
 * - `spread_profile_name` is a name or null;
 * - `fte` is null or a number of at most 2 decimals, 0 or more, below 10^7;
 * - `lines` (absent: none) pass `parseCostLines`, as in a lines write;
 * - `last_calculation` is null or an object of kind annual, quarterly, copy or
 *   computed;
 * - the method matches the calculation: spread with annual or quarterly,
 *   copied with copy, computed with computed; manual with any or none;
 * - a computed record has lines; a record with lines has an FTE, a record
 *   without lines has none;
 * - except for manual, the twelve months add up to what the calculation
 *   explains (its `total`, its four quarters for quarterly).
 */
function parseRecord(raw: unknown, measure: AmountMeasure, year: number, months: readonly bigint[]): ColumnRestore['record'] {
  if (raw === null) return null;
  if (!isObject(raw)) throw refused('record must be the record of the column as read, or null for a column without one.');
  if (raw.measure !== undefined && raw.measure !== measure) {
    throw refused(`The record sent is the record of ${String(raw.measure)}, not of ${measure}.`);
  }
  const method = raw.method as RoundMethod;
  if (!METHODS.includes(method)) throw refused(`Unknown method '${String(raw.method ?? '')}'. Use ${METHODS.join(', ')}.`);
  if (typeof raw.period_start !== 'string' || typeof raw.period_end !== 'string') {
    throw refused('The record needs its period: period_start and period_end (YYYY-MM-DD).');
  }
  const period_start = raw.period_start.trim();
  const period_end = raw.period_end.trim();
  try {
    activeMonths(year, period_start, period_end);
  } catch (err) {
    if (err instanceof SpreadInputError) throw refused(err.message);
    throw err;
  }
  const profile = raw.spread_profile_name ?? null;
  if (profile !== null && (typeof profile !== 'string' || profile.trim() === '')) throw refused('spread_profile_name must be a name or null.');
  let fte: string | null = null;
  if (raw.fte !== null && raw.fte !== undefined) {
    try {
      fte = parseLimitedDecimal(raw.fte, FTE_LIMITS).toString();
    } catch (err) {
      if (err instanceof DecimalLimitError) throw refused(err.message);
      throw err;
    }
  }
  let lines: CostLine[] = [];
  if (raw.lines !== null && raw.lines !== undefined) {
    try {
      lines = parseCostLines(raw.lines, year);
    } catch (err) {
      if (err instanceof CostingInputError) throw refused(err.message);
      throw err;
    }
  }
  const calculation = raw.last_calculation ?? null;
  if (calculation !== null && (!isObject(calculation) || !CALCULATION_KINDS.includes(calculation.kind as string))) {
    throw refused(`last_calculation must be null or a calculation of kind ${CALCULATION_KINDS.join(', ')}.`);
  }
  if (method !== 'manual') {
    const kinds = CALCULATIONS[method];
    if (!calculation || !kinds.includes(calculation.kind as string)) {
      throw refused(`A ${method} record needs a calculation of kind ${kinds.join(' or ')}.`);
    }
  }
  if (method === 'computed' && lines.length === 0) throw refused('A computed record needs the lines it is computed from.');
  if (lines.length > 0 && fte === null) throw refused('A record with lines needs their FTE.');
  if (lines.length === 0 && fte !== null) throw refused('A record without lines has no FTE.');
  if (method !== 'manual') {
    const explained = calculationTotal(calculation as Record<string, unknown>);
    const total = months.reduce((sum, cents) => sum + cents, 0n);
    if (total !== explained) {
      throw refused(`The months add up to ${centsToDecimal(total)}, but the record's calculation gives ${centsToDecimal(explained)}.`);
    }
  }
  return {
    fields: {
      period_start,
      period_end,
      method,
      spread_profile_name: profile as string | null,
      last_calculation: calculation as LastCalculation | null,
      fte,
    },
    lines,
  };
}

/**
 * Validates the restore, checks the freeze, the calendars and the base, then
 * writes the column's twelve months. The line and the version are locked by
 * the caller (`bulk-upsert`). `recordRestore` then writes the record.
 */
export async function writeRestorePayload(ctx: AmountsWriteContext, rawPayload: unknown): Promise<RestorePayloadResult> {
  if (!isObject(rawPayload)) throw refused('The amounts must be an object.');
  const payload = rawPayload;
  const year = assertYearMatchesVersion(payload.year, ctx.version);
  const measure = payload.measure;
  if (!isAmountMeasure(measure)) throw refused(`Unknown amount '${String(measure ?? '')}'. Use ${AMOUNT_MEASURES.join(', ')}.`);
  if (!Array.isArray(payload.months) || payload.months.length !== 12) {
    throw refused('months must hold the twelve months of the column, January first.');
  }
  const months = payload.months.map((value, index) => validateAmountValue(value, `Month ${index + 1}`));
  if (!Object.prototype.hasOwnProperty.call(payload, 'record')) {
    throw refused('record must be the record of the column as read, or null for a column without one.');
  }
  const record = parseRecord(payload.record, measure, year, months);
  const base = isObject(payload.base) && isObject(payload.base.columns) ? payload.base.columns[measure] : undefined;
  if (!isObject(base) || !ctx.beforeWrite) {
    throw refused(`A restore needs the base of its column: base.columns.${measure}.months, the twelve months the screen last read.`);
  }

  // A frozen column refuses the restore before anything is locked or written.
  await assertMeasuresEditable(ctx, year, [measure]);
  // The calendars of the lines, in the tenant, held FOR KEY SHARE until the end (as a lines write):
  // a disabled one is restored as it was, a deleted one is refused.
  const lines = record?.lines ?? [];
  const ids = lines.flatMap((line) => (line.working_day_profile_id ? [line.working_day_profile_id] : []));
  const calendars = await loadWorkingDayProfiles(ctx.manager, ctx.version.tenant_id, ids, { lock: 'key share' });
  lines.forEach((line, index) => {
    if (line.working_day_profile_id && !calendars.has(line.working_day_profile_id)) throw refused(`Line ${index + 1}: the calendar was not found.`);
  });

  await ctx.beforeWrite({ kind: 'columns', columns: [{ measure, months, lines }] });
  const written = await replaceAmounts(ctx, year, yearPeriods(year).map((period, i) => ({ period, [measure]: months[i] })));
  return { ...written, spread: null, restore: { measure, record } };
}

/** The record and its lines as sent, or no record; their audit rows say `restored`. */
export async function recordRestore(ctx: RoundInputsContext, restore: ColumnRestore): Promise<void> {
  const restoring: RoundInputsContext = { ...ctx, auditAction: 'restored' };
  if (restore.record) await upsertRoundInput(restoring, restore.measure, restore.record.fields, restore.record.lines);
  else await deleteRoundInput(restoring, restore.measure);
}
