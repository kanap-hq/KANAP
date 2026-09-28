import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { toCents } from '../common/amount';
import {
  AMOUNT_MEASURES,
  AmountMeasure,
  AmountScope,
  AmountsPayloadResult,
  AmountsWriteContext,
  AmountsWriteResult,
  AmountVersion,
  assertYearMatchesVersion,
  FLAT_PROFILE,
  isAmountMeasure,
  PayloadPeriod,
  parsePayloadPeriod,
  PayloadSpread,
  readVersionMonths,
  replaceAmounts,
  spreadAnnualRows,
  yearPeriods,
} from './amounts-write.util';
import { Decimal } from '../common/decimal';
import {
  computeCosting,
  CostingInputError,
  CostingRecipe,
  CostingResult,
  parseCostingRecipe,
  PricingBasis,
  sameRecipe,
} from './costing.util';
import {
  isProfileActive,
  loadWorkingDayProfiles,
  WorkingDayProfileInfo,
} from '../working-day-profiles/working-day-profiles.util';

/**
 * Round inputs: for each budget column of a version, the period its last
 * spread used and how the column was produced. Shared by OPEX
 * (`spend_round_inputs`) and CAPEX (`capex_round_inputs`); written in the
 * caller's transaction, next to the amounts, with one audit row per record
 * change.
 *
 * The five columns are equal slots: a measure name is a storage key, never a
 * behaviour. What a column means comes from the tenant's settings.
 */

/** The measures that get a record: all five columns, in this order (also the lock order). */
export const ROUND_MEASURES: readonly AmountMeasure[] = AMOUNT_MEASURES;

export type RoundMethod = 'spread' | 'copied' | 'manual' | 'computed';

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
    // What a computation used, frozen at compute time: a later calendar edit never changes it.
    kind: 'computed';
    pricing_basis: PricingBasis;
    quantity: string;
    unit_price: string;
    price_index_pct: string;
    working_day_profile_code: string | null;
    working_day_profile_name: string | null;
    active_months: number[];
    day_counts: string[] | null;
    total_days: string | null;
    month_amounts: string[];
    total: string;
    counts_as_fte: boolean;
  };

/** A record as the API returns it; recipe decimals are plain strings without trailing zeros. */
export type RoundInput = {
  measure: AmountMeasure;
  period_start: string;
  period_end: string;
  method: RoundMethod;
  spread_profile_name: string | null;
  last_calculation: LastCalculation | null;
  pricing_basis: PricingBasis | null;
  quantity: string | null;
  unit_price: string | null;
  price_index_pct: string | null;
  working_day_profile_id: string | null;
  working_day_profile_code: string | null;
  working_day_profile_name: string | null;
  counts_as_fte: boolean;
  updated_at: string;
  updated_by: string | null;
};

/**
 * The fields a write sets. `recipe` is required so every writer says what
 * happens to it: most keep the stored one (`roundRecipe(stored)`).
 */
export type RoundInputFields = Pick<RoundInput, 'period_start' | 'period_end' | 'method' | 'spread_profile_name' | 'last_calculation'> & {
  recipe: CostingRecipe | null;
};

type StoredRoundInput = Omit<RoundInput, 'updated_at'> & {
  id: string;
  tenant_id: string;
  version_id: string;
  created_at: Date;
  updated_at: Date;
};

// Table names come only from here: never from the caller.
const ROUND_TABLE: Record<AmountScope, 'spend_round_inputs' | 'capex_round_inputs'> = {
  opex: 'spend_round_inputs',
  capex: 'capex_round_inputs',
};

// The calendar's code and name come with the record (scalar subqueries, so the
// same list serves SELECT … FOR UPDATE and INSERT … RETURNING); the composite
// key keeps the calendar in the record's tenant.
function columns(table: string): string {
  const calendar = (field: 'code' | 'name') => `(SELECT w.${field} FROM working_day_profiles w
     WHERE w.tenant_id = ${table}.tenant_id AND w.id = ${table}.working_day_profile_id) AS working_day_profile_${field}`;
  return `id, tenant_id, version_id, measure,
  to_char(period_start, 'YYYY-MM-DD') AS period_start, to_char(period_end, 'YYYY-MM-DD') AS period_end,
  method, spread_profile_name, last_calculation,
  pricing_basis, quantity, unit_price, price_index_pct, working_day_profile_id, ${calendar('code')}, ${calendar('name')}, counts_as_fte,
  created_at, updated_at, updated_by`;
}

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

function toApi(row: StoredRoundInput): RoundInput {
  return {
    measure: row.measure,
    period_start: row.period_start,
    period_end: row.period_end,
    method: row.method,
    spread_profile_name: row.spread_profile_name,
    last_calculation: row.last_calculation,
    pricing_basis: row.pricing_basis ?? null,
    quantity: plain(row.quantity),
    unit_price: plain(row.unit_price),
    price_index_pct: plain(row.price_index_pct),
    working_day_profile_id: row.working_day_profile_id ?? null,
    working_day_profile_code: row.working_day_profile_code ?? null,
    working_day_profile_name: row.working_day_profile_name ?? null,
    counts_as_fte: row.counts_as_fte === true,
    updated_at: new Date(row.updated_at).toISOString(),
    updated_by: row.updated_by,
  };
}

/** The recipe a record carries, or null. */
export function roundRecipe(record: RoundInput | null | undefined): CostingRecipe | null {
  if (!record?.pricing_basis || record.quantity == null || record.unit_price == null) return null;
  return {
    pricing_basis: record.pricing_basis,
    quantity: record.quantity,
    unit_price: record.unit_price,
    price_index_pct: record.price_index_pct ?? '0',
    working_day_profile_id: record.working_day_profile_id ?? null,
    counts_as_fte: record.counts_as_fte === true,
  };
}

/** A record's fields as a write would set them, recipe included. */
export function roundFields(record: RoundInput): RoundInputFields {
  return {
    period_start: record.period_start,
    period_end: record.period_end,
    method: record.method,
    spread_profile_name: record.spread_profile_name,
    last_calculation: record.last_calculation,
    recipe: roundRecipe(record),
  };
}

const MEASURE_ORDER = new Map(ROUND_MEASURES.map((m, i) => [m as string, i]));

/** The records of several versions in one query, keyed by version id, in column order. */
export async function listRoundInputs(
  manager: EntityManager,
  scope: AmountScope,
  tenantId: string,
  versionIds: string[],
): Promise<Map<string, RoundInput[]>> {
  const result = new Map<string, RoundInput[]>(versionIds.map((id) => [id, []]));
  if (versionIds.length === 0) return result;
  const rows: StoredRoundInput[] = await manager.query(
    `SELECT ${columns(ROUND_TABLE[scope])} FROM ${ROUND_TABLE[scope]} WHERE tenant_id = $1 AND version_id = ANY($2::uuid[])`,
    [tenantId, versionIds],
  );
  rows.sort((a, b) => (MEASURE_ORDER.get(a.measure) ?? 9) - (MEASURE_ORDER.get(b.measure) ?? 9));
  for (const row of rows) result.get(row.version_id)?.push(toApi(row));
  return result;
}

/** Every record of one version, in column order. */
export async function versionRoundInputs(manager: EntityManager, scope: AmountScope, version: AmountVersion): Promise<RoundInput[]> {
  assertTenant(version);
  return (await listRoundInputs(manager, scope, version.tenant_id, [version.id])).get(version.id) ?? [];
}

async function readRecord(ctx: RoundInputsContext, measure: AmountMeasure): Promise<StoredRoundInput | null> {
  const rows: StoredRoundInput[] = await ctx.manager.query(
    `SELECT ${columns(ROUND_TABLE[ctx.scope])} FROM ${ROUND_TABLE[ctx.scope]}
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

function sameFields(stored: RoundInput, next: RoundInputFields): boolean {
  return stored.period_start === next.period_start
    && stored.period_end === next.period_end
    && stored.method === next.method
    && (stored.spread_profile_name ?? null) === (next.spread_profile_name ?? null)
    && canonical(stored.last_calculation) === canonical(next.last_calculation)
    && sameRecipe(roundRecipe(stored), next.recipe);
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

/**
 * Create, change or leave one record. `next` receives the stored record (or
 * null) and returns the fields to store, or null to leave it as it is. An
 * identical result writes nothing, so a no-op keeps the provenance and its
 * author. Returns the record as stored afterwards.
 */
export async function saveRoundInput(
  ctx: RoundInputsContext,
  rawMeasure: string,
  next: (stored: RoundInput | null) => RoundInputFields | null,
): Promise<RoundInput | null> {
  const measure = assertRoundMeasure(rawMeasure);
  assertTenant(ctx.version);
  const stored = await readRecord(ctx, measure);
  const current = stored ? toApi(stored) : null;
  const fields = next(current);
  if (!fields) return current;
  if (current && sameFields(current, fields)) return current;
  assertPeriodInVersionYear(ctx.version, fields);
  // Checked against the column limits again: numeric columns would round an excess decimal silently.
  const recipe = fields.recipe ? asBadRequest(() => parseCostingRecipe(fields.recipe as Record<string, unknown>)) : null;
  const table = ROUND_TABLE[ctx.scope];
  const [saved]: StoredRoundInput[] = await ctx.manager.query(
    `INSERT INTO ${table}
       (tenant_id, version_id, measure, period_start, period_end, method, spread_profile_name, last_calculation,
        pricing_basis, quantity, unit_price, price_index_pct, working_day_profile_id, counts_as_fte, updated_by)
     VALUES ($1, $2, $3, $4::date, $5::date, $6, $7, $8::jsonb,
             $9::pricing_basis, $10::numeric, $11::numeric, $12::numeric, $13::uuid, $14::boolean, $15::uuid)
     ON CONFLICT (tenant_id, version_id, measure) DO UPDATE
     SET period_start = EXCLUDED.period_start,
         period_end = EXCLUDED.period_end,
         method = EXCLUDED.method,
         spread_profile_name = EXCLUDED.spread_profile_name,
         last_calculation = EXCLUDED.last_calculation,
         pricing_basis = EXCLUDED.pricing_basis,
         quantity = EXCLUDED.quantity,
         unit_price = EXCLUDED.unit_price,
         price_index_pct = EXCLUDED.price_index_pct,
         working_day_profile_id = EXCLUDED.working_day_profile_id,
         counts_as_fte = EXCLUDED.counts_as_fte,
         updated_at = now(),
         updated_by = EXCLUDED.updated_by
     RETURNING ${columns(table)}`,
    [
      ctx.version.tenant_id,
      ctx.version.id,
      measure,
      fields.period_start,
      fields.period_end,
      fields.method,
      fields.spread_profile_name ?? null,
      fields.last_calculation == null ? null : JSON.stringify(fields.last_calculation),
      recipe?.pricing_basis ?? null,
      recipe?.quantity ?? null,
      recipe?.unit_price ?? null,
      recipe?.price_index_pct ?? null,
      recipe?.working_day_profile_id ?? null,
      recipe?.counts_as_fte ?? false,
      ctx.userId || null,
    ],
  );
  await ctx.audit.log(
    {
      table: ROUND_TABLE[ctx.scope],
      recordId: saved.id,
      action: stored ? 'update' : 'create',
      before: stored,
      after: saved,
      userId: ctx.userId,
    },
    { manager: ctx.manager },
  );
  return toApi(saved);
}

/** Store `fields` as the record of `measure`, whatever was there. */
export function upsertRoundInput(ctx: RoundInputsContext, measure: string, fields: RoundInputFields) {
  return saveRoundInput(ctx, measure, () => fields);
}

/**
 * A hand edit of amounts: the record keeps its period, profile, last
 * calculation and recipe and becomes `manual`; a column without a record gets
 * a whole-year `manual` one. Already manual: nothing is written.
 */
export async function markRoundsManual(ctx: RoundInputsContext, measures: readonly string[]) {
  const year = Number(ctx.version.budget_year);
  for (const measure of measures) {
    await saveRoundInput(ctx, measure, (stored) => {
      if (stored?.method === 'manual') return null;
      return stored
        ? { ...roundFields(stored), method: 'manual' }
        : { ...wholeYear(year), method: 'manual', spread_profile_name: null, last_calculation: null, recipe: null };
    });
  }
}

/** Delete the record of one column, if any. */
export async function deleteRoundInput(ctx: RoundInputsContext, rawMeasure: string) {
  const measure = assertRoundMeasure(rawMeasure);
  assertTenant(ctx.version);
  // Read (and lock) first: the audit needs the row, and a DELETE … RETURNING
  // comes back from TypeORM as [rows, count] rather than rows.
  const stored = await readRecord(ctx, measure);
  if (!stored) return;
  await ctx.manager.query(
    `DELETE FROM ${ROUND_TABLE[ctx.scope]} WHERE tenant_id = $1 AND id = $2`,
    [ctx.version.tenant_id, stored.id],
  );
  await ctx.audit.log(
    { table: ROUND_TABLE[ctx.scope], recordId: stored.id, action: 'delete', before: stored, after: null, userId: ctx.userId },
    { manager: ctx.manager },
  );
}

/**
 * The records a spread writes: one `spread` record per measure it replaced,
 * with the period, the profile and what was computed. A stored recipe is
 * kept: Recompute stays available and FTE follows the months that hold an
 * amount.
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
        recipe: roundRecipe(stored),
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
    recipe: roundRecipe(stored),
  }));
}

/**
 * Round inputs after an amounts payload: a spread records its period and
 * profile; a monthly patch marks `manual` each measure whose stored cents
 * actually changed (a month the patch created was zero before), so a no-op
 * resubmit leaves the provenance alone.
 */
export async function recordPayloadRoundInputs(ctx: RoundInputsContext, result: AmountsPayloadResult | ComputedPayloadResult) {
  if ('computed' in result) {
    const plan = result.computed;
    await upsertRoundInput(ctx, plan.measure, computedRound(plan.period, plan.recipe, plan.calendar, plan.result));
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

/* ── Computed rounds (quantity × price) ─────────────────────────────────── */

/** `bulk-upsert` and `compute-preview` body of a computed round (one column). */
export type ComputedAmountsPayload = {
  kind: 'computed';
  year: number;
  measure: AmountMeasure;
  period_start?: string; // with period_end, 'YYYY-MM-DD' in the year; both omitted = the whole year
  period_end?: string;
  pricing_basis: PricingBasis;
  quantity: string | number;
  unit_price: string | number;
  price_index_pct?: string | number; // blank = 0
  working_day_profile_id?: string | null; // per day only
  counts_as_fte?: boolean;
};

export function isComputedPayload(payload: unknown): payload is ComputedAmountsPayload {
  return typeof payload === 'object' && payload !== null && (payload as { kind?: unknown }).kind === 'computed';
}

/** The record of a computed round: the recipe, and what the computation used and gave. */
export function computedRound(
  period: { period_start: string; period_end: string },
  recipe: CostingRecipe,
  calendar: { code: string; name: string } | null,
  result: CostingResult,
): RoundInputFields {
  return {
    period_start: period.period_start,
    period_end: period.period_end,
    method: 'computed',
    spread_profile_name: null,
    recipe,
    last_calculation: {
      kind: 'computed',
      pricing_basis: recipe.pricing_basis,
      quantity: recipe.quantity,
      unit_price: recipe.unit_price,
      price_index_pct: recipe.price_index_pct,
      working_day_profile_code: calendar?.code ?? null,
      working_day_profile_name: calendar?.name ?? null,
      active_months: result.active_months,
      day_counts: result.day_counts,
      total_days: result.total_days,
      month_amounts: result.month_cents.map(centsToDecimal),
      total: centsToDecimal(result.total_cents),
      counts_as_fte: recipe.counts_as_fte,
    },
  };
}

export const DISABLED_CALENDAR_WARNING = 'This calendar is disabled. The computation still uses it.';

/**
 * The version a computation reads: a stored one, or, for a preview of a year
 * the item has no version for yet, none (`id: null`: nothing stored).
 */
export type ComputeVersion = Omit<AmountVersion, 'id'> & { id: string | null };

/** A computed round as requested: validated, calendar resolved, months computed. Nothing written. */
export type ComputedRoundPlan = {
  year: number;
  measure: AmountMeasure;
  period: PayloadPeriod;
  recipe: CostingRecipe;
  calendar: WorkingDayProfileInfo | null;
  result: CostingResult;
  /** The column's record before the computation. */
  stored: RoundInput | null;
  warnings: string[];
};

/**
 * Validate a computed payload and compute it: the version's year, one column,
 * the period (both bounds or neither), the recipe, and the calendar resolved
 * under the version's tenant (another tenant's id is not found). A disabled
 * calendar is refused unless it is the one the round already uses; then the
 * computation runs with a warning. `lockCalendar` (a caller about to write the
 * round) reads the calendar FOR KEY SHARE, so a concurrent delete waits and
 * then sees the round (its 409), or this computation finds no calendar.
 */
export async function planComputedRound(
  ctx: Pick<RoundInputsContext, 'manager' | 'scope'> & { version: ComputeVersion },
  rawPayload: unknown,
  opts: { lockCalendar?: boolean } = {},
): Promise<ComputedRoundPlan> {
  if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) {
    throw new BadRequestException('The amounts must be an object.');
  }
  assertTenant(ctx.version);
  const payload = rawPayload as Record<string, unknown>;
  const year = assertYearMatchesVersion(payload.year, ctx.version);
  const measure = payload.measure;
  if (!isAmountMeasure(measure)) {
    throw new BadRequestException(`Unknown amount '${String(measure ?? '')}'. Use ${AMOUNT_MEASURES.join(', ')}.`);
  }
  const period = parsePayloadPeriod(payload, year);
  const recipe = asBadRequest(() => parseCostingRecipe(payload));
  const versionId = ctx.version.id;
  const stored = versionId
    ? (await listRoundInputs(ctx.manager, ctx.scope, ctx.version.tenant_id, [versionId])).get(versionId)?.find((r) => r.measure === measure) ?? null
    : null;

  const warnings: string[] = [];
  let calendar: WorkingDayProfileInfo | null = null;
  if (recipe.working_day_profile_id) {
    const id = recipe.working_day_profile_id;
    const lock = opts.lockCalendar ? { lock: 'key share' as const } : {};
    calendar = (await loadWorkingDayProfiles(ctx.manager, ctx.version.tenant_id, [id], lock)).get(id) ?? null;
    if (!calendar) throw new BadRequestException('The calendar was not found.');
    if (!isProfileActive(calendar)) {
      if (stored?.working_day_profile_id !== calendar.id) {
        throw new BadRequestException(`${calendar.name} is disabled. Pick an enabled calendar.`);
      }
      warnings.push(DISABLED_CALENDAR_WARNING);
    }
  }
  const chosen = calendar;
  const result = asBadRequest(() => computeCosting({
    year,
    period_start: period.period_start,
    period_end: period.period_end,
    recipe,
    calendar: chosen && { code: chosen.code, name: chosen.name, days: chosen.days_by_year[String(year)] ?? null },
  }));
  return { year, measure, period, recipe, calendar, result, stored, warnings };
}

export type ComputedPayloadResult = AmountsWriteResult & { spread: null; computed: ComputedRoundPlan };

/**
 * `kind: 'computed'` of bulk-upsert: computes, then replaces the twelve months
 * of that one column (freeze checked in the transaction, other columns
 * untouched). `recordPayloadRoundInputs` then stores the record.
 */
export async function writeComputedPayload(ctx: AmountsWriteContext, rawPayload: unknown): Promise<ComputedPayloadResult> {
  const plan = await planComputedRound(ctx, rawPayload, { lockCalendar: true });
  const rows = yearPeriods(plan.year).map((period, i) => ({ period, [plan.measure]: plan.result.month_cents[i] }));
  const written = await replaceAmounts(ctx, plan.year, rows);
  return { ...written, spread: null, computed: plan };
}

export type ComputePreview = {
  active_months: number[];
  day_counts: string[] | null;
  total_days: string | null;
  month_amounts: string[];
  total: string;
  fte: string | null;
  calendar: { id: string; code: string; name: string; disabled: boolean } | null;
  stored: { month_amounts: string[]; method: RoundMethod | null; last_calculation: LastCalculation | null };
  /** Months (1..12) whose amount would change. */
  changed_months: number[];
  /** Active months whose calendar days differ from those of the last computation. */
  calendar_changed_months: number[];
  warnings: string[];
};

/**
 * What a computation would write and how it differs from what is stored.
 * Writes nothing, checks no freeze; without a version, nothing is stored.
 */
export async function previewComputedRound(
  ctx: Pick<RoundInputsContext, 'manager' | 'scope'> & { version: ComputeVersion },
  rawPayload: unknown,
): Promise<ComputePreview> {
  const plan = await planComputedRound(ctx, rawPayload);
  const { result, stored, calendar } = plan;
  const versionId = ctx.version.id;
  const months = versionId
    ? (await readVersionMonths(ctx.manager, ctx.scope, ctx.version.tenant_id, [{ id: versionId, budget_year: ctx.version.budget_year }]))
      .get(versionId)!.months[plan.measure]
    : Array.from({ length: 12 }, () => 0n);
  const last = stored?.last_calculation ?? null;
  const previousDays = last?.kind === 'computed' ? last.day_counts : null;
  const newDays = result.day_counts;
  return {
    active_months: result.active_months,
    day_counts: result.day_counts,
    total_days: result.total_days,
    month_amounts: result.month_cents.map(centsToDecimal),
    total: centsToDecimal(result.total_cents),
    fte: result.fte,
    calendar: calendar && { id: calendar.id, code: calendar.code, name: calendar.name, disabled: !isProfileActive(calendar) },
    stored: { month_amounts: months.map(centsToDecimal), method: stored?.method ?? null, last_calculation: last },
    changed_months: result.month_cents.flatMap((cents, i) => (cents !== months[i] ? [i + 1] : [])),
    calendar_changed_months: previousDays && newDays
      ? result.active_months.filter((m) => Decimal.from(previousDays[m - 1] ?? '0').cmp(newDays[m - 1]) !== 0)
      : [],
    warnings: plan.warnings,
  };
}
