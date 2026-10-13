import { BadRequestException } from '@nestjs/common';
import { toCents } from '../common/amount';
import { Decimal, DecimalLimitError, DecimalLimits, parseLimitedDecimal } from '../common/decimal';
import { loadWorkingDayProfiles, WorkingDayProfileInfo } from '../working-day-profiles/working-day-profiles.util';
import {
  AMOUNT_MEASURES,
  AmountMeasure,
  AmountsWriteContext,
  AmountsWriteResult,
  assertMeasuresEditable,
  assertYearMatchesVersion,
  FLAT_PROFILE,
  isAmountMeasure,
  replaceAmounts,
  validateAmountValue,
  yearPeriods,
} from './amounts-write.util';
import { assertColumnBase } from './budget-edit-conflicts';
import { copiedColumnRecord } from './budget-column-operations';
import {
  ColumnResult,
  computeColumn,
  CostingInputError,
  CostLine,
  MAX_LINES,
  parseCostLine,
  parseCostLines,
} from './costing.util';
import {
  annualSpreadFields,
  carryLinesResult,
  centsToDecimal,
  deleteRoundInput,
  LastCalculation,
  lineCalendarDays,
  linesCalculation,
  linesResult,
  quarterlySpreadFields,
  RoundInputFields,
  RoundInputsContext,
  RoundMethod,
  upsertRoundInput,
  wholeYear,
} from './round-inputs.util';
import { activeMonths, periodMonths, SpreadInputError } from './spread.util';

/**
 * "Back to the opening values" of the budget tab (plan budget-tab-redesign,
 * lot B2): `bulk-upsert` with `kind: 'restore'` puts one column back as the
 * screen read it when the line was opened: its twelve months and its record
 * (how it was built: method, period, profile, calculation, FTE and lines), or
 * no record. One column per request: a column refused (frozen, changed by
 * someone else) never stops the others, which the screen sends apart.
 *
 * The request is checked like any write of the tab, in this order: the
 * payload and the record (400), the base of the column, months and lines
 * (400 when missing), the freeze (403), the calendars of the lines (400), the
 * figures the lines give (400), the base against what is stored (409
 * `edit_conflict`, the body of `budget-edit-conflicts.ts`). Then the months
 * and the record are written: the months of the column through the one
 * amounts writer (the version's totals follow), the record and its lines
 * replaced, or the record deleted. The audit rows are those of any column
 * write (the months by the version, the record by its id), with the action
 * `restored`.
 *
 * The record is not trusted: the reports read its calculation (FTE months,
 * line totals), so a restore stores only what the app itself could have
 * written (`parseRecord`), and what the lines give is computed again from the
 * lines (`rebuildFromLines`), never taken from the request.
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
  /** The column as the screen last knew it: its twelve months and its lines (`[]` without any). */
  base: { columns: Partial<Record<AmountMeasure, { months: unknown[]; lines: unknown[] }>> };
};

export function isRestorePayload(payload: unknown): payload is RestoreAmountsPayload {
  return typeof payload === 'object' && payload !== null && (payload as { kind?: unknown }).kind === 'restore';
}

/** A record of a restore, checked: its fields as they will be stored and its lines. */
type RestoredRecord = { fields: RoundInputFields; lines: CostLine[] };

/** What a restore still writes once its months are: the record and its lines, or none. */
export type ColumnRestore = { measure: AmountMeasure; record: RestoredRecord | null };

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
// The round's fte column is numeric(9,2), never negative.
const FTE_LIMITS = { label: 'The FTE of the record', decimals: 2, min: '0', maxAbs: '10000000' };

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const refused = (text: string) => new BadRequestException(text);

/* ── What a calculation may hold ───────────────────────────────────────────── */

/** The keys a calculation (or one of its lines) may hold, and those it must. */
type Shape = { allowed: ReadonlySet<string>; required: ReadonlySet<string> };
type Shapes = Record<'annual' | 'quarterly' | 'copy' | 'computed' | 'lines_result' | 'line', Shape>;

const SAMPLE_YEAR = 2000;
const SAMPLE_LINE: CostLine = {
  label: '', quantity_unit: 'pieces', quantity: '1', unit_price: '1', price_basis: 'per_piece', frequency: 'per_month',
  days_per_month: null, period_start: `${SAMPLE_YEAR}-01-01`, period_end: `${SAMPLE_YEAR}-12-31`, working_day_profile_id: null,
};

let shapes: Shapes | null = null;

/**
 * The shapes of the calculations, read from their writers on a sample, never
 * written out here: `annualSpreadFields` (an item CSV total adds `source`),
 * `quarterlySpreadFields`, `copiedColumnRecord`, `linesCalculation` and
 * `linesResult`, and the `lines_result` that a spread over lines
 * (`carryLinesResult`) or a copy of reference lines adds. A key is required
 * when the writer always writes it, allowed when it writes it in some case.
 * A key a writer gains is accepted at once (and must get a check in `FIELDS`,
 * the restore spec says so); a key no writer writes is refused.
 */
export function calculationShapes(): Shapes {
  if (shapes) return shapes;
  const result = computeColumn([SAMPLE_LINE], SAMPLE_YEAR, new Map());
  const computed = linesCalculation([SAMPLE_LINE], new Map(), result);
  const withLines = { fte: computed.fte, last_calculation: computed };
  const period = { ...wholeYear(SAMPLE_YEAR), active_months: [1] };
  const keys = (fields: RoundInputFields) => Object.keys(fields.last_calculation ?? {});
  const shape = (minimal: RoundInputFields, maximal: RoundInputFields): Shape => ({
    required: new Set(keys(minimal)),
    allowed: new Set(keys(maximal)),
  });
  const quarters = { Q1: 0n, Q2: 0n, Q3: 0n, Q4: 0n };
  const copy = (reference: boolean) => copiedColumnRecord(
    {
      lines: null,
      reference: reference ? { kind: 'lines', lines: [SAMPLE_LINE], calendars: new Map(), result, issues: [] } : null,
      sourceTotal: 0n,
      targetTotal: 0n,
    },
    undefined,
    {
      sourceYear: SAMPLE_YEAR, sourceMeasure: 'planned', destinationYear: SAMPLE_YEAR, upliftPct: '0',
      validity: { start: `${SAMPLE_YEAR}-01-01`, end: `${SAMPLE_YEAR}-12-31`, months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
    },
  ).fields;
  const fixed = (object: object): Shape => ({ required: new Set(Object.keys(object)), allowed: new Set(Object.keys(object)) });
  shapes = {
    annual: shape(
      annualSpreadFields(0n, FLAT_PROFILE, period, null),
      carryLinesResult(annualSpreadFields(0n, FLAT_PROFILE, period, null, 'item_csv'), withLines),
    ),
    quarterly: shape(
      quarterlySpreadFields(quarters, 'equal', period, null),
      carryLinesResult(quarterlySpreadFields(quarters, 'equal', period, null), withLines),
    ),
    copy: shape(copy(false), copy(true)),
    computed: fixed(computed),
    lines_result: fixed(linesResult([SAMPLE_LINE], new Map(), result)),
    line: fixed(computed.lines[0]),
  };
  return shapes;
}

/* ── The scalars of a calculation ──────────────────────────────────────────── */

// The amounts columns are numeric(18,2); the round's fte numeric(9,2); a month's FTE has 6 decimals.
const AMOUNT: Omit<DecimalLimits, 'label'> = { decimals: 2, maxAbs: '10000000000000000' };
const FTE: Omit<DecimalLimits, 'label'> = { decimals: 2, min: '0', maxAbs: '10000000' };
const FTE_MONTH: Omit<DecimalLimits, 'label'> = { decimals: 6, min: '0', maxAbs: '1000000000' };
const DAYS: Omit<DecimalLimits, 'label'> = { decimals: 6, min: '0', maxAbs: '32' };
const TOTAL_DAYS: Omit<DecimalLimits, 'label'> = { decimals: 6, min: '0', maxAbs: '1000' };
const WEIGHT: Omit<DecimalLimits, 'label'> = { decimals: 20, min: '0', maxAbs: '1000000000000' };
const PERCENT: Omit<DecimalLimits, 'label'> = { decimals: 20, maxAbs: '1000000000000' };
const TEXT_MAX = 255;

const calculationError = (text: string) => refused(`The record's calculation: ${text}`);

/** A decimal string within `limits` (`path` names it in the refusal). */
function decimal(value: unknown, path: string, limits: Omit<DecimalLimits, 'label'>): Decimal {
  if (typeof value !== 'string') throw calculationError(`${path} must be a number written as text.`);
  try {
    return parseLimitedDecimal(value, { ...limits, label: path });
  } catch (err) {
    if (err instanceof DecimalLimitError) throw calculationError(err.message);
    throw err;
  }
}

function twelve(value: unknown, path: string, check: (entry: unknown, path: string) => unknown): void {
  if (!Array.isArray(value) || value.length !== 12) throw calculationError(`${path} must hold twelve months.`);
  value.forEach((entry, i) => check(entry, `${path}[${i}]`));
}

function monthList(value: unknown, path: string): number[] {
  const ordered = Array.isArray(value)
    && value.every((m, i) => Number.isInteger(m) && m >= 1 && m <= 12 && (i === 0 || m > value[i - 1]));
  if (!ordered) throw calculationError(`${path} must list months from 1 to 12, in order.`);
  return value as number[];
}

function text(value: unknown, path: string, nullable: boolean): void {
  if (value === null && nullable) return;
  if (typeof value !== 'string' || value.length > TEXT_MAX) throw calculationError(`${path} must be a text of at most ${TEXT_MAX} characters.`);
}

const amount = (value: unknown, path: string) => decimal(value, path, AMOUNT);
const fte = (value: unknown, path: string) => decimal(value, path, FTE);
const fteMonth = (value: unknown, path: string) => decimal(value, path, FTE_MONTH);

type Checks = { year: number };

/**
 * The check of each key a writer writes, by its name (the same name means the
 * same thing in every kind). Every scalar the reports cast is a decimal within
 * the limits of what it stands for.
 */
const FIELDS: Record<string, (value: unknown, path: string, checks: Checks) => void> = {
  kind: () => undefined,
  total: amount,
  source_total: amount,
  profile: (value, path) => text(value, path, false),
  source: (value, path) => {
    if (value !== 'item_csv') throw calculationError(`${path} must be item_csv.`);
  },
  active_months: (value, path) => monthList(value, path),
  weights: (value, path) => {
    if (!Array.isArray(value)) throw calculationError(`${path} must be a list.`);
    value.forEach((weight, i) => decimal(weight, `${path}[${i}]`, WEIGHT));
  },
  quarters: (value, path) => {
    const keys = ['Q1', 'Q2', 'Q3', 'Q4'];
    if (!isObject(value) || Object.keys(value).length !== 4 || !keys.every((q) => q in value)) {
      throw calculationError(`${path} must hold Q1, Q2, Q3 and Q4.`);
    }
    keys.forEach((q) => amount(value[q], `${path}.${q}`));
  },
  distribution: (value, path) => {
    if (value !== 'equal' && value !== '445') throw calculationError(`${path} must be equal or 445.`);
  },
  source_year: (value, path) => {
    if (!Number.isInteger(value) || (value as number) < 1000 || (value as number) > 9999) throw calculationError(`${path} must be a year.`);
  },
  source_measure: (value, path) => {
    if (!isAmountMeasure(value)) throw calculationError(`${path} must be one of ${AMOUNT_MEASURES.join(', ')}.`);
  },
  uplift_pct: (value, path) => {
    if (decimal(value, path, PERCENT).cmp(-100) <= 0) throw calculationError(`${path} must be above -100.`);
  },
  source_method: (value, path) => {
    if (value !== null && !METHODS.includes(value as RoundMethod)) throw calculationError(`${path} must be a method or null.`);
  },
  lines_result: (value, path, checks) => checkShape(value, 'lines_result', path, checks),
  fte,
  fte_period: fte,
  month_amounts: (value, path) => twelve(value, path, amount),
  fte_months: (value, path) => twelve(value, path, fteMonth),
  lines: (value, path, checks) => {
    if (!Array.isArray(value) || value.length > MAX_LINES) throw calculationError(`${path} must be a list of at most ${MAX_LINES} lines.`);
    value.forEach((line, i) => checkShape(line, 'line', `${path}[${i}]`, checks));
  },
};

/** The keys of a line of a calculation beyond those of the line itself (`parseCostLine` checks those). */
const LINE_FIELDS: Record<string, (value: unknown, path: string, checks: Checks) => void> = {
  working_day_profile_code: (value, path) => text(value, path, true),
  working_day_profile_name: (value, path) => text(value, path, true),
  active_months: (value, path) => monthList(value, path),
  day_counts: (value, path) => {
    if (value === null) return;
    twelve(value, path, (days, at) => {
      if (decimal(days, at, DAYS).cmp(31) > 0) throw calculationError(`${at} must be at most 31.`);
    });
  },
  total_days: (value, path) => {
    if (value !== null) decimal(value, path, TOTAL_DAYS);
  },
  month_amounts: (value, path) => twelve(value, path, amount),
  fte_months: (value, path) => twelve(value, path, fteMonth),
  fte,
  fte_period: fte,
  total: amount,
};

const COST_LINE_KEYS = new Set(Object.keys(SAMPLE_LINE));

/** Every key a writer may write has a check (the restore spec asserts it). */
export function uncheckedCalculationKeys(): string[] {
  const all = calculationShapes();
  const outer = [...all.annual.allowed, ...all.quarterly.allowed, ...all.copy.allowed, ...all.computed.allowed, ...all.lines_result.allowed];
  const line = [...all.line.allowed].filter((key) => !COST_LINE_KEYS.has(key));
  return [...outer.filter((key) => !FIELDS[key]), ...line.filter((key) => !LINE_FIELDS[key])];
}

/** `value` has the shape of `kind`: only the keys its writer writes, those it always writes, each checked. */
function checkShape(value: unknown, kind: keyof Shapes, path: string, checks: Checks): void {
  const where = path ? `${path} ` : '';
  if (!isObject(value)) throw calculationError(`${where}must be an object.`);
  const shape = calculationShapes()[kind];
  const unknown = Object.keys(value).find((key) => !shape.allowed.has(key));
  if (unknown !== undefined) throw calculationError(`${where}holds '${unknown.slice(0, 40)}', which no calculation holds.`);
  const missing = [...shape.required].find((key) => !(key in value));
  if (missing !== undefined) throw calculationError(`${where}has no ${missing}.`);
  const prefix = path ? `${path}.` : '';
  if (kind === 'line') {
    try {
      parseCostLine(value, checks.year, 1);
    } catch (err) {
      if (err instanceof CostingInputError) throw calculationError(`${path}: ${err.message.replace(/^Line 1: /, '')}`);
      throw err;
    }
    for (const [key, entry] of Object.entries(value)) {
      if (!COST_LINE_KEYS.has(key)) LINE_FIELDS[key](entry, `${prefix}${key}`, checks);
    }
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    const check = FIELDS[key];
    if (!check) throw calculationError(`${where}holds '${key}', which nothing checks.`);
    check(entry, `${prefix}${key}`, checks);
  }
}

/* ── The record ────────────────────────────────────────────────────────────── */

const cents = (value: unknown) => toCents(value as string);
const monthsSum = (months: readonly bigint[]) => months.reduce((sum, value) => sum + value, 0n);

/**
 * How a spread's months follow its calculation: they lie in the months its
 * period counts (`periodMonths`, which its `active_months` must be), and a
 * quarterly spread gives each quarter its amount. A flat yearly spread
 * weighs every month 1.
 */
function checkSpread(calculation: Record<string, unknown>, months: readonly bigint[], period: { start: string; end: string }, year: number): void {
  const counted = periodMonths(year, period.start, period.end);
  const active = calculation.active_months as number[];
  if (active.length !== counted.length || active.some((m, i) => m !== counted[i])) {
    throw calculationError(`active_months must be the months its period counts (${counted.join(', ') || 'none'}).`);
  }
  const outside = months.findIndex((value, i) => value !== 0n && !active.includes(i + 1));
  if (outside >= 0) throw refused(`Month ${outside + 1} holds an amount outside the months of the record's period.`);
  if (calculation.kind === 'quarterly') {
    const quarters = calculation.quarters as Record<string, string>;
    (['Q1', 'Q2', 'Q3', 'Q4'] as const).forEach((q, index) => {
      const sum = monthsSum(months.slice(index * 3, index * 3 + 3));
      if (sum !== cents(quarters[q])) throw refused(`The months of ${q} add up to ${centsToDecimal(sum)}, but the record's calculation gives ${quarters[q]}.`);
    });
  }
}

/** The weights of a yearly spread: one per active month, adding up to more than zero; 1 each for flat. */
function checkWeights(calculation: Record<string, unknown>): void {
  const weights = calculation.weights as string[];
  if (weights.length !== (calculation.active_months as number[]).length) throw calculationError('weights must hold one weight per active month.');
  const values = weights.map((w) => Decimal.from(w));
  if (values.every((w) => w.cmp(0) === 0)) throw calculationError('weights must add up to more than zero.');
  if (calculation.profile === 'flat' && values.some((w) => w.cmp(1) !== 0)) throw calculationError('a flat spread weighs every month 1.');
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
 * - `last_calculation` is null or has the shape its writer gives it
 *   (`calculationShapes`: no other key, every key it always writes), each
 *   value checked (`FIELDS`: decimals within their limits, months, lists);
 * - the method matches the calculation: spread with annual or quarterly,
 *   copied with copy, computed with computed; manual with any or none;
 * - a computed calculation needs the record's lines, a `lines_result` too; a
 *   record with lines has an FTE, a record without lines has none;
 * - except for manual, the twelve months add up to what the calculation
 *   explains (its `total`, its four quarters for quarterly);
 * - a spread: its `active_months` are the months its period counts, its months
 *   outside them are zero, each quarter adds up to its amount, its weights are
 *   one per active month (1 each when flat).
 * What the lines give (the computed calculation, `lines_result`, `fte`) is
 * checked here for its shape only: `rebuildFromLines` computes it again.
 */
function parseRecord(raw: unknown, measure: AmountMeasure, year: number, months: readonly bigint[]): RestoredRecord | null {
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
  if (profile !== null && (typeof profile !== 'string' || profile.trim() === '' || profile.length > TEXT_MAX)) {
    throw refused('spread_profile_name must be a name or null.');
  }
  let fteValue: string | null = null;
  if (raw.fte !== null && raw.fte !== undefined) {
    try {
      fteValue = parseLimitedDecimal(raw.fte, FTE_LIMITS).toString();
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
  if (calculation !== null) {
    const kind = isObject(calculation) ? calculation.kind : undefined;
    if (kind !== 'annual' && kind !== 'quarterly' && kind !== 'copy' && kind !== 'computed') {
      throw refused('last_calculation must be null or a calculation of kind annual, quarterly, copy or computed.');
    }
    if (isObject(calculation) && 'lines_result' in calculation && lines.length === 0) throw refused('A record without lines has no lines_result.');
    checkShape(calculation, kind, '', { year });
  }
  const calc = calculation as Record<string, unknown> | null;
  if (method !== 'manual') {
    const kinds = CALCULATIONS[method];
    if (!calc || !kinds.includes(calc.kind as string)) {
      throw refused(`A ${method} record needs a calculation of kind ${kinds.join(' or ')}.`);
    }
  }
  if (calc?.kind === 'computed' && lines.length === 0) throw refused('A computed calculation needs the lines it is computed from.');
  if (lines.length > 0 && fteValue === null) throw refused('A record with lines needs their FTE.');
  if (lines.length === 0 && fteValue !== null) throw refused('A record without lines has no FTE.');
  if (calc && method !== 'manual') {
    const explained = calc.kind === 'quarterly'
      ? Object.values(calc.quarters as Record<string, string>).reduce((sum, q) => sum + cents(q), 0n)
      : cents(calc.total);
    const total = monthsSum(months);
    if (total !== explained) {
      throw refused(`The months add up to ${centsToDecimal(total)}, but the record's calculation gives ${centsToDecimal(explained)}.`);
    }
  }
  if (calc && (calc.kind === 'annual' || calc.kind === 'quarterly')) {
    if (method === 'spread') checkSpread(calc, months, { start: period_start, end: period_end }, year);
    if (calc.kind === 'annual') checkWeights(calc);
  }
  return {
    fields: {
      period_start,
      period_end,
      method,
      spread_profile_name: profile as string | null,
      last_calculation: calc as LastCalculation | null,
      fte: fteValue,
    },
    lines,
  };
}

/* ── What the lines give, computed again ───────────────────────────────────── */

const sameMonths = (a: readonly bigint[], b: readonly bigint[]) => a.length === b.length && a.every((value, i) => value === b[i]);

/**
 * What a record's lines give, computed again from its lines with the
 * calendars as they are, never taken from the request: the whole calculation
 * of a computed one (or of a manual one that keeps it), the `lines_result` of
 * any other, and the record's FTE. A computed record's months must be what its
 * lines give; lines that cannot be computed (a calendar without days for the
 * year) are refused with the sentence a lines write gives.
 */
function rebuildFromLines(
  restored: RestoredRecord,
  months: readonly bigint[],
  year: number,
  calendars: ReadonlyMap<string, WorkingDayProfileInfo>,
): RestoredRecord {
  const { fields, lines } = restored;
  if (lines.length === 0) return restored;
  let result: ColumnResult;
  try {
    result = computeColumn(lines, year, lineCalendarDays(calendars, year));
  } catch (err) {
    if (err instanceof CostingInputError) throw refused(err.message);
    throw err;
  }
  if (fields.method === 'computed' && !sameMonths(result.month_cents, months)) {
    throw refused('The months are not what the record\'s lines give: the column follows its lines.');
  }
  const calculation = fields.last_calculation;
  let rebuilt: LastCalculation | null = calculation;
  if (calculation?.kind === 'computed') rebuilt = linesCalculation(lines, calendars, result);
  else if (calculation) rebuilt = { ...calculation, lines_result: linesResult(lines, calendars, result) };
  return { fields: { ...fields, last_calculation: rebuilt, fte: result.fte }, lines };
}

/**
 * Validates the restore, checks its base, the freeze, the calendars and what
 * the lines give, then the base against what is stored, then writes the
 * column's twelve months. The line and the version are locked by the caller
 * (`bulk-upsert`). `recordRestore` then writes the record.
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
  const parsed = parseRecord(payload.record, measure, year, months);
  assertColumnBase(payload.base, measure, 'restore');
  if (!ctx.beforeWrite) throw new Error('A restore is compared with its base.');

  // A frozen column refuses the restore before anything is locked or written.
  await assertMeasuresEditable(ctx, year, [measure]);
  // The calendars of the lines, in the tenant, held FOR KEY SHARE until the end (as a lines write):
  // a disabled one is restored as it was, a deleted one is refused.
  const lines = parsed?.lines ?? [];
  const ids = lines.flatMap((line) => (line.working_day_profile_id ? [line.working_day_profile_id] : []));
  const calendars = await loadWorkingDayProfiles(ctx.manager, ctx.version.tenant_id, ids, { lock: 'key share' });
  lines.forEach((line, index) => {
    if (line.working_day_profile_id && !calendars.has(line.working_day_profile_id)) throw refused(`Line ${index + 1}: the calendar was not found.`);
  });
  const record = parsed ? rebuildFromLines(parsed, months, year, calendars) : null;

  await ctx.beforeWrite({ kind: 'columns', columns: [{ measure, months, lines }] });
  const written = await replaceAmounts(ctx, year, yearPeriods(year).map((period, i) => ({ period, [measure]: months[i] })));
  return { ...written, spread: null, restore: { measure, record } };
}

/** The record and its lines, or no record; their audit rows say `restored`. */
export async function recordRestore(ctx: RoundInputsContext, restore: ColumnRestore): Promise<void> {
  const restoring: RoundInputsContext = { ...ctx, auditAction: 'restored' };
  if (restore.record) await upsertRoundInput(restoring, restore.measure, restore.record.fields, restore.record.lines);
  else await deleteRoundInput(restoring, restore.measure);
}
