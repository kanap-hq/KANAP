import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { toCents } from '../common/amount';
import {
  AMOUNT_MEASURES,
  AmountMeasure,
  AmountRowInput,
  AmountScope,
  AmountsPayloadResult,
  AmountsWriteContext,
  AmountsWriteResult,
  AmountVersion,
  assertMeasuresEditable,
  assertYearMatchesVersion,
  FLAT_PROFILE,
  isAmountMeasure,
  lockYearMonths,
  PayloadSpread,
  replaceAmounts,
  spreadAnnualRows,
  yearPeriods,
} from './amounts-write.util';
import { Decimal } from '../common/decimal';
import {
  ColumnResult,
  computeColumn,
  CostingInputError,
  CostLine,
  Frequency,
  LineCalendar,
  parseCostLines,
  PriceBasis,
  QuantityUnit,
  sameLines,
} from './costing.util';
import {
  calendarDaysFor,
  isProfileActive,
  loadWorkingDayProfiles,
  WorkingDayProfileInfo,
} from '../working-day-profiles/working-day-profiles.util';

/**
 * Round inputs: for each budget column of a version, the period its last
 * spread used, how the column was produced and, when it has some, the
 * quantity × price lines it is computed from. Shared by OPEX
 * (`spend_round_inputs`, `spend_round_input_lines`) and CAPEX
 * (`capex_round_inputs`, `capex_round_input_lines`); written in the caller's
 * transaction, next to the amounts, with one audit row per record change.
 *
 * The five columns are equal slots: a measure name is a storage key, never a
 * behaviour. What a column means comes from the tenant's settings.
 */

/** The measures that get a record: all five columns, in this order (also the lock order). */
export const ROUND_MEASURES: readonly AmountMeasure[] = AMOUNT_MEASURES;

export type RoundMethod = 'spread' | 'copied' | 'manual' | 'computed';

/** One line of a computation, as it was computed: what it used and what it gave. */
export type LineCalculation = CostLine & {
  working_day_profile_code: string | null;
  working_day_profile_name: string | null;
  active_months: number[];
  day_counts: string[] | null;
  total_days: string | null;
  month_amounts: string[];
  fte_months: string[];
  /** The line's full-year average FTE (its twelve FTE months ÷ 12). */
  fte: string;
  /** The line's FTE over its own active months (their FTE ÷ their number). */
  fte_period: string;
  total: string;
};

export type LastCalculation =
  | { kind: 'annual'; total: string; profile: string; active_months: number[]; weights: string[]; source?: 'item_csv' }
  | { kind: 'quarterly'; quarters: { Q1: string; Q2: string; Q3: string; Q4: string }; distribution: 'equal' | '445'; active_months: number[] }
  | {
    kind: 'copy';
    source_year: number;
    source_measure: AmountMeasure;
    uplift_pct: string;
    source_total: string;
    total: string;
    source_method: RoundMethod | null;
  }
  | {
    // What the lines gave, frozen at compute time: a later calendar edit never changes it.
    kind: 'computed';
    total: string;
    /** The full-year average, as stored on the round. */
    fte: string;
    /** The average over the months where a people or days line is active (pieces do not count). */
    fte_period: string;
    month_amounts: string[];
    fte_months: string[];
    active_months: number[];
    lines: LineCalculation[];
  };

/** A stored line as the API returns it; decimals are plain strings without trailing zeros. */
export type RoundLine = {
  id: string;
  sort: number;
  label: string;
  quantity_unit: QuantityUnit;
  quantity: string;
  unit_price: string;
  price_basis: PriceBasis;
  frequency: Frequency;
  /** People priced per day: the days worked each month; null is full time. */
  days_per_month: string | null;
  period_start: string;
  period_end: string;
  working_day_profile_id: string | null;
  working_day_profile_code: string | null;
  working_day_profile_name: string | null;
};

/** A record as the API returns it, with the column's lines in order (none: `[]`, `fte` null). */
export type RoundInput = {
  measure: AmountMeasure;
  period_start: string;
  period_end: string;
  method: RoundMethod;
  spread_profile_name: string | null;
  last_calculation: LastCalculation | null;
  fte: string | null;
  lines: RoundLine[];
  updated_at: string;
  updated_by: string | null;
};

/**
 * The fields a write sets. `fte` is required so every writer says what
 * happens to it: most keep the stored one; only a lines write, a copy and the
 * removal of the lines change it.
 */
export type RoundInputFields = Pick<RoundInput, 'period_start' | 'period_end' | 'method' | 'spread_profile_name' | 'last_calculation' | 'fte'>;

type StoredRoundInput = Omit<RoundInput, 'updated_at' | 'lines'> & {
  id: string;
  tenant_id: string;
  version_id: string;
  created_at: Date;
  updated_at: Date;
};

type StoredLine = Omit<RoundLine, 'sort'> & { round_input_id: string; sort: number | string };

// Table names come only from here: never from the caller.
const ROUND_TABLE: Record<AmountScope, 'spend_round_inputs' | 'capex_round_inputs'> = {
  opex: 'spend_round_inputs',
  capex: 'capex_round_inputs',
};
const LINE_TABLE: Record<AmountScope, 'spend_round_input_lines' | 'capex_round_input_lines'> = {
  opex: 'spend_round_input_lines',
  capex: 'capex_round_input_lines',
};

const COLUMNS = `id, tenant_id, version_id, measure,
  to_char(period_start, 'YYYY-MM-DD') AS period_start, to_char(period_end, 'YYYY-MM-DD') AS period_end,
  method, spread_profile_name, last_calculation, fte, created_at, updated_at, updated_by`;

export type RoundInputsContext = {
  manager: EntityManager;
  scope: AmountScope;
  /** Loaded by the caller under the tenant's RLS; its tenant_id scopes every statement. */
  version: AmountVersion;
  userId: string | null;
  audit: Pick<AuditService, 'log'>;
};

export function isRoundMeasure(value: unknown): value is AmountMeasure {
  return typeof value === 'string' && (ROUND_MEASURES as readonly string[]).includes(value);
}

function assertRoundMeasure(measure: string): AmountMeasure {
  if (!isRoundMeasure(measure)) throw new InternalServerErrorException(`Unknown budget column '${measure}'.`);
  return measure;
}

function assertTenant(version: { id: string | null; tenant_id: string }) {
  if (typeof version.tenant_id !== 'string' || version.tenant_id.trim() === '') {
    throw new InternalServerErrorException(`Round inputs refused: version ${version.id} carries no tenant_id.`);
  }
}

/** Cents as a decimal string with two decimals ('12000.00', '-0.05'). */
export function centsToDecimal(cents: bigint): string {
  const negative = cents < 0n;
  const digits = (negative ? -cents : cents).toString().padStart(3, '0');
  return `${negative ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

export function wholeYear(year: number): { period_start: string; period_end: string } {
  return { period_start: `${year}-01-01`, period_end: `${year}-12-31` };
}

/** A numeric column as a plain decimal string without trailing zeros ('1.000' → '1'). */
const plain = (value: string | null) => (value == null ? null : Decimal.from(value).toString());

function toLine(row: StoredLine): RoundLine {
  return {
    id: row.id,
    sort: Number(row.sort),
    label: row.label,
    quantity_unit: row.quantity_unit,
    quantity: plain(row.quantity)!,
    unit_price: plain(row.unit_price)!,
    price_basis: row.price_basis,
    frequency: row.frequency,
    days_per_month: plain(row.days_per_month),
    period_start: row.period_start,
    period_end: row.period_end,
    working_day_profile_id: row.working_day_profile_id ?? null,
    working_day_profile_code: row.working_day_profile_code ?? null,
    working_day_profile_name: row.working_day_profile_name ?? null,
  };
}

function toApi(row: StoredRoundInput, lines: RoundLine[]): RoundInput {
  return {
    measure: row.measure,
    period_start: row.period_start,
    period_end: row.period_end,
    method: row.method,
    spread_profile_name: row.spread_profile_name,
    last_calculation: row.last_calculation,
    fte: plain(row.fte),
    lines,
    updated_at: new Date(row.updated_at).toISOString(),
    updated_by: row.updated_by,
  };
}

/** A stored line as a line to write (what a copy or a comparison needs). */
export function costLine(line: RoundLine): CostLine {
  return {
    label: line.label,
    quantity_unit: line.quantity_unit,
    quantity: line.quantity,
    unit_price: line.unit_price,
    price_basis: line.price_basis,
    frequency: line.frequency,
    days_per_month: line.days_per_month,
    period_start: line.period_start,
    period_end: line.period_end,
    working_day_profile_id: line.working_day_profile_id,
  };
}

/** A record's fields as a write would set them. */
export function roundFields(record: RoundInput): RoundInputFields {
  return {
    period_start: record.period_start,
    period_end: record.period_end,
    method: record.method,
    spread_profile_name: record.spread_profile_name,
    last_calculation: record.last_calculation,
    fte: record.fte,
  };
}

const MEASURE_ORDER = new Map(ROUND_MEASURES.map((m, i) => [m as string, i]));

/**
 * The lines of several records in one query, keyed by record id, in `sort`
 * order; each with its calendar's code and name (the composite key keeps the
 * calendar in the line's tenant).
 */
async function readLines(manager: EntityManager, scope: AmountScope, tenantId: string, roundIds: string[]): Promise<Map<string, RoundLine[]>> {
  const result = new Map<string, RoundLine[]>(roundIds.map((id) => [id, []]));
  if (roundIds.length === 0) return result;
  const rows: StoredLine[] = await manager.query(
    `SELECT l.id, l.round_input_id, l.sort, l.label, l.quantity_unit::text AS quantity_unit,
            l.quantity::text AS quantity, l.unit_price::text AS unit_price, l.price_basis::text AS price_basis,
            l.frequency::text AS frequency, l.days_per_month::text AS days_per_month,
            to_char(l.period_start, 'YYYY-MM-DD') AS period_start, to_char(l.period_end, 'YYYY-MM-DD') AS period_end,
            l.working_day_profile_id, w.code AS working_day_profile_code, w.name AS working_day_profile_name
     FROM ${LINE_TABLE[scope]} l
     LEFT JOIN working_day_profiles w ON w.tenant_id = $1 AND w.id = l.working_day_profile_id
     WHERE l.tenant_id = $1 AND l.round_input_id = ANY($2::uuid[])
     ORDER BY l.round_input_id, l.sort`,
    [tenantId, roundIds],
  );
  for (const row of rows) result.get(row.round_input_id)?.push(toLine(row));
  return result;
}

/** The records of several versions with their lines (two queries), keyed by version id, in column order. */
export async function listRoundInputs(
  manager: EntityManager,
  scope: AmountScope,
  tenantId: string,
  versionIds: string[],
): Promise<Map<string, RoundInput[]>> {
  const result = new Map<string, RoundInput[]>(versionIds.map((id) => [id, []]));
  if (versionIds.length === 0) return result;
  const rows: StoredRoundInput[] = await manager.query(
    `SELECT ${COLUMNS} FROM ${ROUND_TABLE[scope]} WHERE tenant_id = $1 AND version_id = ANY($2::uuid[])`,
    [tenantId, versionIds],
  );
  rows.sort((a, b) => (MEASURE_ORDER.get(a.measure) ?? 9) - (MEASURE_ORDER.get(b.measure) ?? 9));
  const lines = await readLines(manager, scope, tenantId, rows.map((row) => row.id));
  for (const row of rows) result.get(row.version_id)?.push(toApi(row, lines.get(row.id) ?? []));
  return result;
}

/** Every record of one version, in column order. */
export async function versionRoundInputs(manager: EntityManager, scope: AmountScope, version: AmountVersion): Promise<RoundInput[]> {
  assertTenant(version);
  return (await listRoundInputs(manager, scope, version.tenant_id, [version.id])).get(version.id) ?? [];
}

async function readRecord(ctx: RoundInputsContext, measure: AmountMeasure): Promise<StoredRoundInput | null> {
  const rows: StoredRoundInput[] = await ctx.manager.query(
    `SELECT ${COLUMNS} FROM ${ROUND_TABLE[ctx.scope]}
     WHERE tenant_id = $1 AND version_id = $2 AND measure = $3
     FOR UPDATE`,
    [ctx.version.tenant_id, ctx.version.id, measure],
  );
  return rows[0] ?? null;
}

/** JSON with sorted keys, so a stored jsonb and a new value compare equal when they are. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((value as any)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

const sameDecimal = (a: string | null, b: string | null) => (a == null || b == null ? a == null && b == null : Decimal.from(a).cmp(b) === 0);

function sameFields(stored: RoundInput, next: RoundInputFields): boolean {
  return stored.period_start === next.period_start
    && stored.period_end === next.period_end
    && stored.method === next.method
    && (stored.spread_profile_name ?? null) === (next.spread_profile_name ?? null)
    && canonical(stored.last_calculation) === canonical(next.last_calculation)
    && sameDecimal(stored.fte, next.fte);
}

/** A 400 for an input the user must correct. */
function asBadRequest<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof CostingInputError) throw new BadRequestException(err.message);
    throw err;
  }
}

function assertPeriodInVersionYear(version: AmountVersion, fields: RoundInputFields) {
  const year = String(Number(version.budget_year));
  const inYear = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && date.slice(0, 4) === year;
  if (!inYear(fields.period_start) || !inYear(fields.period_end) || fields.period_start > fields.period_end) {
    throw new BadRequestException(`The period ${fields.period_start} to ${fields.period_end} must lie within ${year}.`);
  }
}

/** Replace a record's lines wholesale: delete them, insert the new ones in order (`sort` from 1). */
async function replaceLines(ctx: RoundInputsContext, roundId: string, lines: readonly CostLine[]) {
  const table = LINE_TABLE[ctx.scope];
  await ctx.manager.query(`DELETE FROM ${table} WHERE tenant_id = $1 AND round_input_id = $2`, [ctx.version.tenant_id, roundId]);
  if (lines.length === 0) return;
  const params: unknown[] = [ctx.version.tenant_id, roundId];
  const value = (v: unknown, cast: string) => `$${params.push(v)}::${cast}`;
  const rows = lines.map((line, index) => `($1::uuid, $2::uuid, ${[
    value(index + 1, 'int'),
    value(line.label, 'text'),
    value(line.quantity_unit, 'line_quantity_unit'),
    value(line.quantity, 'numeric'),
    value(line.unit_price, 'numeric'),
    value(line.price_basis, 'line_price_basis'),
    value(line.frequency, 'line_frequency'),
    value(line.days_per_month, 'numeric'),
    value(line.working_day_profile_id, 'uuid'),
    value(line.period_start, 'date'),
    value(line.period_end, 'date'),
  ].join(', ')})`);
  await ctx.manager.query(
    `INSERT INTO ${table}
       (tenant_id, round_input_id, sort, label, quantity_unit, quantity, unit_price, price_basis, frequency, days_per_month, working_day_profile_id, period_start, period_end)
     VALUES ${rows.join(', ')}`,
    params,
  );
}

/**
 * Create, change or leave one record. `next` receives the stored record (or
 * null) and returns the fields to store, or null to leave it as it is. With
 * `lines`, the record's lines are replaced by them (`[]` removes them);
 * without, they are left as stored. An identical result writes nothing, so a
 * no-op keeps the provenance and its author. Returns the record as stored
 * afterwards.
 */
export async function saveRoundInput(
  ctx: RoundInputsContext,
  rawMeasure: string,
  next: (stored: RoundInput | null) => RoundInputFields | null,
  lines?: readonly CostLine[],
): Promise<RoundInput | null> {
  const measure = assertRoundMeasure(rawMeasure);
  assertTenant(ctx.version);
  const stored = await readRecord(ctx, measure);
  const storedLines = stored ? (await readLines(ctx.manager, ctx.scope, ctx.version.tenant_id, [stored.id])).get(stored.id) ?? [] : [];
  const current = stored ? toApi(stored, storedLines) : null;
  const fields = next(current);
  // Checked against the column limits again, whoever built them: numeric columns would round an excess decimal silently.
  const newLines = lines === undefined ? undefined : asBadRequest(() => parseCostLines(lines, Number(ctx.version.budget_year)));
  const linesChanged = newLines !== undefined && !sameLines(storedLines.map(costLine), newLines);
  if (!fields) {
    if (linesChanged) throw new InternalServerErrorException('Round lines are written with their record.');
    return current;
  }
  if (current && sameFields(current, fields) && !linesChanged) return current;
  assertPeriodInVersionYear(ctx.version, fields);
  const table = ROUND_TABLE[ctx.scope];
  const [saved]: StoredRoundInput[] = await ctx.manager.query(
    `INSERT INTO ${table}
       (tenant_id, version_id, measure, period_start, period_end, method, spread_profile_name, last_calculation, fte, updated_by)
     VALUES ($1, $2, $3, $4::date, $5::date, $6, $7, $8::jsonb, $9::numeric, $10::uuid)
     ON CONFLICT (tenant_id, version_id, measure) DO UPDATE
     SET period_start = EXCLUDED.period_start,
         period_end = EXCLUDED.period_end,
         method = EXCLUDED.method,
         spread_profile_name = EXCLUDED.spread_profile_name,
         last_calculation = EXCLUDED.last_calculation,
         fte = EXCLUDED.fte,
         updated_at = now(),
         updated_by = EXCLUDED.updated_by
     RETURNING ${COLUMNS}`,
    [
      ctx.version.tenant_id,
      ctx.version.id,
      measure,
      fields.period_start,
      fields.period_end,
      fields.method,
      fields.spread_profile_name ?? null,
      fields.last_calculation == null ? null : JSON.stringify(fields.last_calculation),
      fields.fte ?? null,
      ctx.userId || null,
    ],
  );
  let savedLines = storedLines;
  if (linesChanged) {
    await replaceLines(ctx, saved.id, newLines!);
    savedLines = (await readLines(ctx.manager, ctx.scope, ctx.version.tenant_id, [saved.id])).get(saved.id) ?? [];
  }
  await ctx.audit.log(
    {
      table: ROUND_TABLE[ctx.scope],
      recordId: saved.id,
      action: stored ? 'update' : 'create',
      // The lines ride along when they change: one audit row per column write.
      before: stored && linesChanged ? { ...stored, lines: storedLines } : stored,
      after: linesChanged ? { ...saved, lines: savedLines } : saved,
      userId: ctx.userId,
    },
    { manager: ctx.manager },
  );
  return toApi(saved, savedLines);
}

/** Store `fields` as the record of `measure`, whatever was there; with `lines`, they replace the record's lines. */
export function upsertRoundInput(ctx: RoundInputsContext, measure: string, fields: RoundInputFields, lines?: readonly CostLine[]) {
  return saveRoundInput(ctx, measure, () => fields, lines);
}

/**
 * A hand edit of amounts: the record keeps its period, profile, last
 * calculation, lines and FTE and becomes `manual` (the lines stay as the
 * reference the budget tab shows); a column without a record gets a
 * whole-year `manual` one. Already manual: nothing is written.
 */
export async function markRoundsManual(ctx: RoundInputsContext, measures: readonly string[]) {
  const year = Number(ctx.version.budget_year);
  for (const measure of measures) {
    await saveRoundInput(ctx, measure, (stored) => {
      if (stored?.method === 'manual') return null;
      return stored
        ? { ...roundFields(stored), method: 'manual' }
        : { ...wholeYear(year), method: 'manual', spread_profile_name: null, last_calculation: null, fte: null };
    });
  }
}

/** Delete the record of one column, if any; its lines go with it (ON DELETE CASCADE). */
export async function deleteRoundInput(ctx: RoundInputsContext, rawMeasure: string) {
  const measure = assertRoundMeasure(rawMeasure);
  assertTenant(ctx.version);
  // Read (and lock) first: the audit needs the row, and a DELETE … RETURNING
  // comes back from TypeORM as [rows, count] rather than rows.
  const stored = await readRecord(ctx, measure);
  if (!stored) return;
  const lines = (await readLines(ctx.manager, ctx.scope, ctx.version.tenant_id, [stored.id])).get(stored.id) ?? [];
  await ctx.manager.query(
    `DELETE FROM ${ROUND_TABLE[ctx.scope]} WHERE tenant_id = $1 AND id = $2`,
    [ctx.version.tenant_id, stored.id],
  );
  await ctx.audit.log(
    {
      table: ROUND_TABLE[ctx.scope],
      recordId: stored.id,
      action: 'delete',
      before: lines.length ? { ...stored, lines } : stored,
      after: null,
      userId: ctx.userId,
    },
    { manager: ctx.manager },
  );
}

/**
 * The records a spread writes: one `spread` record per measure it replaced,
 * with the period, the profile and what was computed. The lines and the FTE
 * of a column stay as they were: the budget tab keeps them as a reference.
 */
export async function recordSpread(ctx: RoundInputsContext, spread: PayloadSpread, source?: 'item_csv') {
  const { period_start, period_end, active_months } = spread.period;
  if (spread.kind === 'annual') {
    const activeWeights = active_months.map((m) => spread.profile.labels[m - 1]);
    for (const measure of ROUND_MEASURES) {
      const total = spread.totals[measure];
      if (total === undefined) continue;
      await saveRoundInput(ctx, measure, (stored) => ({
        period_start,
        period_end,
        method: 'spread',
        spread_profile_name: spread.profile.name,
        last_calculation: {
          kind: 'annual',
          total: centsToDecimal(total),
          profile: spread.profile.name,
          active_months,
          weights: activeWeights,
          ...(source ? { source } : {}),
        },
        fte: stored?.fte ?? null,
      }));
    }
    return;
  }
  const q = spread.quarters;
  await saveRoundInput(ctx, spread.measure, (stored) => ({
    period_start,
    period_end,
    method: 'spread',
    spread_profile_name: spread.distribution === '445' ? '4-4-5' : 'flat',
    last_calculation: {
      kind: 'quarterly',
      quarters: { Q1: centsToDecimal(q.Q1), Q2: centsToDecimal(q.Q2), Q3: centsToDecimal(q.Q3), Q4: centsToDecimal(q.Q4) },
      distribution: spread.distribution,
      active_months,
    },
    fte: stored?.fte ?? null,
  }));
}

/**
 * Round inputs after an amounts payload: lines store their records and
 * lines; a spread records its period and profile; a monthly patch marks
 * `manual` each measure whose stored cents actually changed (a month the
 * patch created was zero before), so a no-op resubmit leaves the provenance
 * alone.
 */
export async function recordPayloadRoundInputs(ctx: RoundInputsContext, result: AmountsPayloadResult | LinesPayloadResult) {
  if (isLinesResult(result)) {
    await recordLines(ctx, result.lines);
    return;
  }
  if (result.spread) {
    await recordSpread(ctx, result.spread);
    return;
  }
  const beforeByPeriod = new Map(result.before.map((row) => [row.period, row]));
  const changed = result.measures.filter((measure: AmountMeasure) => result.after.some((row) => {
    const before = beforeByPeriod.get(row.period);
    return toCents(before ? before[measure] : 0) !== toCents(row[measure]);
  }));
  if (changed.length > 0) await markRoundsManual(ctx, changed);
}

/**
 * Yearly totals of the legacy item CSV: each measure given is spread flat
 * over the whole year and replaces its twelve months; each measure gets a
 * whole-year `spread` record marked as coming from the item file.
 * A measure left out (blank cell) is not written and keeps its record.
 */
export async function writeItemCsvTotals(
  ctx: AmountsWriteContext,
  rounds: Pick<RoundInputsContext, 'userId' | 'audit'>,
  year: number,
  totals: Partial<Record<AmountMeasure, bigint>>,
) {
  if (Object.keys(totals).length === 0) return;
  await replaceAmounts(ctx, year, spreadAnnualRows(year, totals));
  await recordSpread(
    { manager: ctx.manager, scope: ctx.scope, version: ctx.version, ...rounds },
    {
      kind: 'annual',
      totals,
      profile: FLAT_PROFILE,
      period: { ...wholeYear(year), active_months: Array.from({ length: 12 }, (_, i) => i + 1) },
    },
    'item_csv',
  );
}

/* ── Columns computed from quantity × price lines ─────────────────────────── */

/** `bulk-upsert` body that computes a column (and, with `also_measures`, others) from its lines. */
export type LinesAmountsPayload = {
  kind: 'lines';
  year: number;
  measure: AmountMeasure;
  /** The same lines written to these columns too. */
  also_measures?: AmountMeasure[];
  /** 0 to 50; `[]` removes the lines. */
  lines: Array<{
    label?: string;
    quantity_unit: QuantityUnit;
    quantity: string | number;
    unit_price: string | number;
    price_basis: PriceBasis;
    /** People: per_month; days: once; pieces: either (a unit with one choice takes it when none is sent). */
    frequency?: Frequency;
    /** People priced per day: the days worked each month; null or absent is full time. Refused on any other line. */
    days_per_month?: string | number | null;
    period_start: string;
    period_end: string;
    working_day_profile_id?: string | null;
  }>;
};

export function isLinesPayload(payload: unknown): payload is LinesAmountsPayload {
  return typeof payload === 'object' && payload !== null && (payload as { kind?: unknown }).kind === 'lines';
}

export const DISABLED_CALENDAR_WARNING = 'This calendar is disabled. The computation still uses it.';

/** A lines write, validated and computed. Nothing written yet. */
export type LinesPlan = {
  year: number;
  /** The columns written, in column order. */
  measures: AmountMeasure[];
  lines: CostLine[];
  calendars: Map<string, WorkingDayProfileInfo>;
  /** Null when the lines are removed (`[]`). */
  result: ColumnResult | null;
  warnings: string[];
};

export type LinesPayloadResult = AmountsWriteResult & { spread: null; lines: LinesPlan };

export function isLinesResult(result: AmountsPayloadResult | LinesPayloadResult): result is LinesPayloadResult {
  return 'lines' in result;
}

function unknownMeasure(value: unknown): BadRequestException {
  return new BadRequestException(`Unknown amount '${String(value ?? '')}'. Use ${AMOUNT_MEASURES.join(', ')}.`);
}

/** `measure` and `also_measures`, once each, in column order. */
function linesMeasures(payload: Record<string, unknown>): AmountMeasure[] {
  if (!isAmountMeasure(payload.measure)) throw unknownMeasure(payload.measure);
  const also = payload.also_measures ?? [];
  if (!Array.isArray(also)) throw new BadRequestException('also_measures must be a list of columns.');
  const unknown = also.find((m) => !isAmountMeasure(m));
  if (unknown !== undefined) throw unknownMeasure(unknown);
  const named = new Set<unknown>([payload.measure, ...also]);
  return AMOUNT_MEASURES.filter((m) => named.has(m));
}

/**
 * The calendars the lines name, resolved under the version's tenant (another
 * tenant's id is not found) and held FOR KEY SHARE until the transaction
 * ends, so a concurrent delete waits and then counts these lines. A disabled
 * calendar is refused unless the stored lines of every column written
 * already use it; then the write goes through with a warning.
 */
async function resolveLineCalendars(
  ctx: AmountsWriteContext,
  lines: CostLine[],
  measures: AmountMeasure[],
  stored: RoundInput[],
): Promise<{ calendars: Map<string, WorkingDayProfileInfo>; warnings: string[] }> {
  const ids = [...new Set(lines.flatMap((line) => (line.working_day_profile_id ? [line.working_day_profile_id] : [])))];
  const calendars = await loadWorkingDayProfiles(ctx.manager, ctx.version.tenant_id, ids, { lock: 'key share' });
  const warnings: string[] = [];
  lines.forEach((line, index) => {
    const id = line.working_day_profile_id;
    if (!id) return;
    const calendar = calendars.get(id);
    if (!calendar) throw new BadRequestException(`Line ${index + 1}: the calendar was not found.`);
    if (isProfileActive(calendar)) return;
    const usedBy = (measure: AmountMeasure) => stored.find((r) => r.measure === measure)?.lines.some((l) => l.working_day_profile_id === id) ?? false;
    if (!measures.every(usedBy)) throw new BadRequestException(`Line ${index + 1}: ${calendar.name} is disabled. Pick an enabled calendar.`);
    if (!warnings.includes(DISABLED_CALENDAR_WARNING)) warnings.push(DISABLED_CALENDAR_WARNING);
  });
  return { calendars, warnings };
}

/**
 * `kind: 'lines'` of bulk-upsert: validates the lines (sentences naming the
 * line), checks the freeze of every column written, resolves the calendars,
 * computes, then replaces the twelve months of those columns (the others are
 * untouched). `[]` writes no amount: the months stay, the lines go.
 * `recordPayloadRoundInputs` then stores each column's record and lines.
 */
export async function writeLinesPayload(ctx: AmountsWriteContext, rawPayload: unknown): Promise<LinesPayloadResult> {
  if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) {
    throw new BadRequestException('The amounts must be an object.');
  }
  assertTenant(ctx.version);
  const payload = rawPayload as Record<string, unknown>;
  const year = assertYearMatchesVersion(payload.year, ctx.version);
  const measures = linesMeasures(payload);
  const lines = asBadRequest(() => parseCostLines(payload.lines, year));
  // A frozen column refuses the whole write before anything is locked or written.
  await assertMeasuresEditable(ctx, year, measures);
  const stored = await versionRoundInputs(ctx.manager, ctx.scope, ctx.version);
  const { calendars, warnings } = await resolveLineCalendars(ctx, lines, measures, stored);
  const days = new Map<string, LineCalendar>(
    [...calendars.values()].map((calendar) => [calendar.id, { name: calendar.name, days: calendarDaysFor(calendar, year) }]),
  );
  const result = lines.length > 0 ? asBadRequest(() => computeColumn(lines, year, days)) : null;
  // Each column written: the months the lines give (left as stored when they are removed) and the lines.
  await ctx.beforeWrite?.({
    kind: 'columns',
    columns: measures.map((measure) => ({ measure, months: result ? result.month_cents : null, lines })),
  });

  let written: AmountsWriteResult = { periods: [], measures, before: [], after: [] };
  if (result) {
    const rows: AmountRowInput[] = yearPeriods(year).map((period, i) => {
      const row: AmountRowInput = { period };
      for (const measure of measures) row[measure] = result.month_cents[i];
      return row;
    });
    written = await replaceAmounts(ctx, year, rows);
  } else if (measures.some((measure) => changedByRemoval(stored.find((r) => r.measure === measure)))) {
    // Records only: the months' lock first, as every writer takes it.
    await lockYearMonths(ctx, year);
  }
  return { ...written, spread: null, lines: { year, measures, lines, calendars, result, warnings } };
}

/**
 * The whole months a computed column covers: from the first day of its
 * earliest active month to the last day of its latest, so the 15th rule
 * (`activeMonths`) finds every one of them again. A one-date line keeps its
 * date; the record covers its month.
 */
function activeMonthsPeriod(year: number, activeMonths: readonly number[]): { period_start: string; period_end: string } {
  if (activeMonths.length === 0) throw new InternalServerErrorException('A computed column has no active month.');
  const first = Math.min(...activeMonths);
  const last = Math.max(...activeMonths);
  const mm = (month: number) => String(month).padStart(2, '0');
  const lastDay = new Date(Date.UTC(year, last, 0)).getUTCDate();
  return { period_start: `${year}-${mm(first)}-01`, period_end: `${year}-${mm(last)}-${lastDay}` };
}

/** The record of a column computed from its lines: the whole months they cover, the FTE and what each line gave. */
export function linesRound(
  lines: readonly CostLine[],
  calendars: ReadonlyMap<string, Pick<WorkingDayProfileInfo, 'code' | 'name'>>,
  result: ColumnResult,
): RoundInputFields {
  return {
    ...activeMonthsPeriod(Number(lines[0].period_start.slice(0, 4)), result.active_months),
    method: 'computed',
    spread_profile_name: null,
    fte: result.fte,
    last_calculation: {
      kind: 'computed',
      total: centsToDecimal(result.total_cents),
      fte: result.fte,
      fte_period: result.fte_period,
      month_amounts: result.month_cents.map(centsToDecimal),
      fte_months: result.fte_months,
      active_months: result.active_months,
      lines: lines.map((line, index) => {
        const computed = result.lines[index];
        const calendar = line.working_day_profile_id ? calendars.get(line.working_day_profile_id) : undefined;
        return {
          ...line,
          working_day_profile_code: calendar?.code ?? null,
          working_day_profile_name: calendar?.name ?? null,
          active_months: computed.active_months,
          day_counts: computed.day_counts,
          total_days: computed.total_days,
          month_amounts: computed.month_cents.map(centsToDecimal),
          fte_months: computed.fte_months,
          fte: computed.fte,
          fte_period: computed.fte_period,
          total: centsToDecimal(computed.total_cents),
        };
      }),
    },
  };
}

/**
 * The record of a column whose lines are removed: amounts kept, FTE unknown.
 * A column computed from them reads as edited by hand and loses their
 * explanation; any other keeps how it was produced. No record: nothing.
 */
function withoutLines(stored: RoundInput | null): RoundInputFields | null {
  if (!stored) return null;
  return {
    ...roundFields(stored),
    method: stored.method === 'computed' ? 'manual' : stored.method,
    last_calculation: stored.last_calculation?.kind === 'computed' ? null : stored.last_calculation,
    fte: null,
  };
}

/** Whether removing the lines changes this record at all (else `[]` writes nothing, not even the months' lock). */
function changedByRemoval(stored: RoundInput | undefined): boolean {
  return !!stored && (stored.lines.length > 0 || !sameFields(stored, withoutLines(stored)!));
}

/** Each column's record and lines, in column order (the records' lock order). */
async function recordLines(ctx: RoundInputsContext, plan: LinesPlan) {
  const { result, lines, calendars } = plan;
  for (const measure of plan.measures) {
    await saveRoundInput(ctx, measure, (stored) => (result ? linesRound(lines, calendars, result) : withoutLines(stored)), lines);
  }
}
