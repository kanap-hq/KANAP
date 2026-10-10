import { BadRequestException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { FreezeColumn, FreezeService } from '../freeze/freeze.service';
import { CENTS_LIMIT, formatCents, toCents } from '../common/amount';
import { budgetColumnName, DEFAULT_BUDGET_COLUMNS, readBudgetColumns } from '../budget-columns/budget-columns.util';
import {
  activeMonths,
  FLAT_WEIGHTS,
  NO_ACTIVE_MONTH_MESSAGE,
  profileWeights,
  SpreadInputError,
  SpreadWindow,
  spreadAnnualToMonths,
  spreadQuarterlyToMonths,
} from './spread.util';
import { lockBudgetVersions } from './budget-locks';
import type { CostLine } from './costing.util';

/**
 * The one way amounts are written, for OPEX and CAPEX lines alike
 * (`spend_amounts`, lot Z1): the amounts services, the item CSV importers and the
 * budget column operations all go through here.
 *
 * A write names its target measures and leaves every other measure as stored.
 * It updates only those columns with `INSERT … ON CONFLICT DO UPDATE SET
 * <target measures>`, never a read-merge-write of whole rows, so two people
 * editing different measures of the same month cannot overwrite each other.
 * Year, periods and values are validated and every target measure is checked
 * against the freeze inside the caller's transaction. Locks: the caller holds
 * the line; a write locks the version, then the months in period order (the
 * one lock order of the budget, `budget-locks.ts`).
 */

export type AmountMeasure = 'planned' | 'committed' | 'forecast' | 'actual' | 'expected_landing';
export const AMOUNT_MEASURES: readonly AmountMeasure[] = ['planned', 'committed', 'forecast', 'actual', 'expected_landing'];

export const MEASURE_FREEZE_COLUMN: Record<AmountMeasure, FreezeColumn> = {
  planned: 'budget',
  committed: 'revision',
  forecast: 'forecast',
  actual: 'actual',
  expected_landing: 'landing',
};

/** Columns by their API names (copy, clear, reports), in the fixed order. */
export type BudgetColumn = 'budget' | 'revision' | 'forecast' | 'follow_up' | 'landing';
export const BUDGET_COLUMN_MEASURE: Record<BudgetColumn, AmountMeasure> = {
  budget: 'planned',
  revision: 'committed',
  forecast: 'forecast',
  follow_up: 'actual',
  landing: 'expected_landing',
};

export type AmountScope = 'opex' | 'capex';
// Table names come only from here: never from the caller. The months of both natures (lot Z1); the
// scope still decides the freeze and the audit label, the version was read for the scope's nature.
const AMOUNT_TABLE: Record<AmountScope, string> = { opex: 'spend_amounts', capex: 'spend_amounts' };

export type AmountVersion = { id: string; tenant_id: string; budget_year: number | string };

/**
 * What a write from the budget tab is about to store, handed to the edit
 * conflict check (`budget-edit-conflicts.ts`, plan planning/perf-scale lot 3D)
 * once the line is locked and before anything is written:
 * - `cells`: a monthly entry, the cells it writes;
 * - `columns`: a yearly total, quarters or costed lines, the twelve months
 *   (January first) each column will hold (`null`: left as stored, the removal
 *   of costed lines) and, for costed lines, the lines it will hold.
 */
export type PlannedAmounts =
  | { kind: 'cells'; rows: AmountRowInput[] }
  | { kind: 'columns'; columns: Array<{ measure: AmountMeasure; months: readonly bigint[] | null; lines?: readonly CostLine[] }> };

export type AmountsWriteContext = {
  manager: EntityManager;
  freeze: Pick<FreezeService, 'assertNotFrozen'>;
  scope: AmountScope;
  /** Fetched by the caller under the tenant's RLS; its tenant_id scopes every statement. */
  version: AmountVersion;
  /** Freeze checks already passed in this operation (one per column and year, filled here). */
  checkedFreeze?: Set<string>;
  /**
   * Called by `writeAmountsPayload` and `writeLinesPayload` with what they are
   * about to store, after validation and before the first write; throws to
   * refuse the request (a 409 when someone else changed a cell or a column
   * since the user's screen read it). Only the budget tab's requests that
   * carry a base set it: the other writers compare nothing.
   */
  beforeWrite?: (plan: PlannedAmounts) => Promise<void>;
};

/** Amounts of one month, in cents, for the measures being written. */
export type AmountRowInput = { period: string } & Partial<Record<AmountMeasure, bigint>>;

export type StoredAmountRow = {
  id: string;
  tenant_id: string;
  version_id: string;
  period: string;
  planned: string | null;
  forecast: string | null;
  committed: string | null;
  actual: string | null;
  expected_landing: string | null;
  created_at: Date;
  updated_at: Date;
};

/** Rows around the write, for the audit log, and the measures written. */
export type AmountsWriteResult = { periods: string[]; measures: AmountMeasure[]; before: StoredAmountRow[]; after: StoredAmountRow[] };

export function isAmountMeasure(value: unknown): value is AmountMeasure {
  return typeof value === 'string' && (AMOUNT_MEASURES as readonly string[]).includes(value);
}

/**
 * A 400 that names a column. It is thrown bare where the tenant is not at
 * hand and becomes a BadRequestException with the tenant's column name in
 * `withColumnNames`, so the names are read only when a message is built.
 */
class ColumnMessageError extends Error {
  constructor(readonly measure: AmountMeasure, readonly rest: string) {
    super(`${measure}${rest}`);
  }
}

/** Where a value sits: free text (a file column), or a column and a place (' for 2026-03'). */
export type ValueLabel = string | { measure: AmountMeasure; where: string };

function badValue(label: ValueLabel, text: string): Error {
  return typeof label === 'string'
    ? new BadRequestException(`${label} ${text}`)
    : new ColumnMessageError(label.measure, `${label.where} ${text}`);
}

async function withColumnNames<T>(ctx: Pick<AmountsWriteContext, 'manager' | 'version'>, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!(err instanceof ColumnMessageError)) throw err;
    const tenantId = ctx.version?.tenant_id;
    const settings = tenantId ? await readBudgetColumns(ctx.manager, tenantId) : DEFAULT_BUDGET_COLUMNS;
    throw new BadRequestException(`${budgetColumnName(settings, err.measure)}${err.rest}`);
  }
}

function unknownMeasure(key: string): BadRequestException {
  return new BadRequestException(`Unknown amount '${key}'. Use ${AMOUNT_MEASURES.join(', ')}.`);
}

// Amount columns are numeric(18,2); the limit lives in common/amount so pure utils can read it.
export { CENTS_LIMIT };

function assertInRange(cents: bigint, label: ValueLabel): bigint {
  if ((cents < 0n ? -cents : cents) >= CENTS_LIMIT) throw badValue(label, 'is too large.');
  return cents;
}

/** A finite number or a numeric string, in cents. Null is refused: zero is how a value is cleared. */
export function validateAmountValue(value: unknown, label: ValueLabel): bigint {
  if (value === null || value === undefined) {
    throw badValue(label, 'cannot be empty; send 0 to clear it.');
  }
  if (typeof value === 'number' ? !Number.isFinite(value) : typeof value !== 'string' || value.trim() === '') {
    throw badValue(label, 'must be a number.');
  }
  let cents: bigint;
  try {
    cents = toCents(value as number | string);
  } catch {
    throw badValue(label, 'must be a number.');
  }
  return assertInRange(cents, label);
}

export function assertYearMatchesVersion(year: unknown, version: Pick<AmountVersion, 'budget_year'>): number {
  const parsed = typeof year === 'string' && /^\d{4}$/.test(year.trim()) ? Number(year) : year;
  if (typeof parsed !== 'number' || !Number.isInteger(parsed)) {
    throw new BadRequestException('A budget year is required.');
  }
  const versionYear = Number(version.budget_year);
  if (parsed !== versionYear) {
    throw new BadRequestException(`The year ${parsed} does not match this version's year ${versionYear}.`);
  }
  return parsed;
}

export function yearPeriods(year: number): string[] {
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}-01`);
}

function validatePeriod(value: unknown, year: number): string {
  const period = typeof value === 'string' ? value.trim() : '';
  const match = /^(\d{4})-(\d{2})-01$/.exec(period);
  const month = match ? Number(match[2]) : 0;
  if (!match || month < 1 || month > 12) {
    throw new BadRequestException(`'${String(value ?? '')}' is not a month; use the first day of the month (YYYY-MM-01).`);
  }
  if (Number(match[1]) !== year) {
    throw new BadRequestException(`Month ${period} is not in ${year}.`);
  }
  return period;
}

/** Validated periods and target measures of a set of rows. */
function inspectRows(year: number, rows: AmountRowInput[]) {
  const periods: string[] = [];
  const seen = new Set<string>();
  const measures = new Set<AmountMeasure>();
  for (const row of rows) {
    const period = validatePeriod(row.period, year);
    if (seen.has(period)) throw new BadRequestException(`Month ${period} appears more than once.`);
    seen.add(period);
    periods.push(period);
    let count = 0;
    for (const key of Object.keys(row)) {
      if (key === 'period') continue;
      if (!isAmountMeasure(key)) throw unknownMeasure(key);
      const cents = row[key];
      if (typeof cents !== 'bigint') {
        throw badValue({ measure: key, where: ` for ${period}` }, 'cannot be empty; send 0 to clear it.');
      }
      assertInRange(cents, { measure: key, where: ` for ${period}` });
      measures.add(key);
      count += 1;
    }
    if (count === 0) throw new BadRequestException(`Month ${period} carries no amount.`);
  }
  return { periods, measures: AMOUNT_MEASURES.filter((m) => measures.has(m)) };
}

/** The freeze check of every amounts write, once per column and year in an operation (`checkedFreeze`). */
export async function assertMeasuresEditable(ctx: AmountsWriteContext, year: number, measures: readonly AmountMeasure[]) {
  ctx.checkedFreeze ??= new Set<string>();
  for (const measure of measures) {
    const column = MEASURE_FREEZE_COLUMN[measure];
    const key = `${ctx.scope}:${column}:${year}`;
    if (ctx.checkedFreeze.has(key)) continue;
    await ctx.freeze.assertNotFrozen({ scope: ctx.scope, column, year }, { manager: ctx.manager });
    ctx.checkedFreeze.add(key);
  }
}

/** What reading or locking a version's months needs. */
type MonthsContext = Pick<AmountsWriteContext, 'manager' | 'scope' | 'version'>;

async function readRows(ctx: MonthsContext, periods: string[], lock = false): Promise<StoredAmountRow[]> {
  return ctx.manager.query(
    `SELECT id, tenant_id, version_id, to_char(period, 'YYYY-MM-DD') AS period,
            planned, forecast, committed, actual, expected_landing, created_at, updated_at
     FROM ${AMOUNT_TABLE[ctx.scope]}
     WHERE tenant_id = $1 AND version_id = $2 AND period = ANY($3::date[])
     ORDER BY period${lock ? ' FOR UPDATE' : ''}`,
    [ctx.version.tenant_id, ctx.version.id, periods],
  );
}

/** One statement for rows that carry the same measures: only those columns are written. */
async function upsertColumns(ctx: AmountsWriteContext, measures: AmountMeasure[], rows: AmountRowInput[]) {
  const params: unknown[] = [ctx.version.tenant_id, ctx.version.id];
  const values = rows.map((row) => {
    const cells = [`$${params.push(row.period)}::date`];
    for (const measure of measures) cells.push(`$${params.push(formatCents(row[measure] as bigint))}::numeric`);
    return `($1::uuid, $2::uuid, ${cells.join(', ')})`;
  });
  await ctx.manager.query(
    `INSERT INTO ${AMOUNT_TABLE[ctx.scope]} (tenant_id, version_id, period, ${measures.join(', ')})
     VALUES ${values.join(', ')}
     ON CONFLICT (version_id, period) DO UPDATE
     SET ${measures.map((m) => `${m} = EXCLUDED.${m}`).join(', ')}, updated_at = now()`,
    params,
  );
}

/** Create the months that do not exist yet, in period order; returns the periods created. */
async function createMissingMonths(ctx: MonthsContext, periods: string[]): Promise<Set<string>> {
  const created: Array<{ period: string }> = await ctx.manager.query(
    `INSERT INTO ${AMOUNT_TABLE[ctx.scope]} (tenant_id, version_id, period)
     SELECT $1::uuid, $2::uuid, p FROM unnest($3::date[]) AS p ORDER BY p
     ON CONFLICT (version_id, period) DO NOTHING
     RETURNING to_char(period, 'YYYY-MM-DD') AS period`,
    [ctx.version.tenant_id, ctx.version.id, periods],
  );
  return new Set(created.map((row) => row.period));
}

/**
 * Every statement writes the version's tenant_id explicitly. A version built in
 * memory without it (an entity whose column default was never read back) would
 * insert NULL and fail as a row-level security violation: refuse it by name.
 */
function assertVersionTenant(version: AmountVersion) {
  if (typeof version.tenant_id !== 'string' || version.tenant_id.trim() === '') {
    throw new InternalServerErrorException(
      `Amounts write refused: version ${version.id} carries no tenant_id. Load the version from the database or set tenant_id when creating it.`,
    );
  }
}

/** Whether every value the rows carry is already stored, to the cent (a NULL cell is not a zero here). */
function sameAsStored(stored: StoredAmountRow[], rows: AmountRowInput[], periods: string[]): boolean {
  const byPeriod = new Map(stored.map((row) => [row.period, row]));
  return rows.every((row, index) => {
    const current = byPeriod.get(periods[index]);
    return !!current && AMOUNT_MEASURES.every((m) => row[m] === undefined || (current[m] !== null && toCents(current[m]) === row[m]));
  });
}

/**
 * The version, locked before its months (lock order, `budget-locks.ts`: the
 * caller holds the line already). Its `budget_rev` is bumped by the amounts
 * trigger after the months: the lock is held by then, so that update waits
 * for nobody. A version gone meanwhile is a 404.
 */
async function lockVersion(ctx: MonthsContext): Promise<void> {
  const locked = await lockBudgetVersions(ctx.manager, ctx.scope, ctx.version.tenant_id, [ctx.version.id]);
  if (!locked.has(ctx.version.id)) throw new NotFoundException('Version not found');
}

async function write(ctx: AmountsWriteContext, year: number, rows: AmountRowInput[], periods: string[], measures: AmountMeasure[]) {
  assertVersionTenant(ctx.version);
  await assertMeasuresEditable(ctx, year, measures);
  await lockVersion(ctx);
  // Concurrent writes on the same line must queue up, never deadlock: every
  // month is first created and then locked in period order, whatever order
  // or measure sets the rows come in. The rows read here feed the no-op
  // check and the audit log; months this write created had no "before".
  const created = await createMissingMonths(ctx, periods);
  const before = (await readRows(ctx, periods, true)).filter((row) => !created.has(row.period));
  // A write that changes no stored value (a spread or a recompute giving the
  // months already there) writes nothing and returns no rows, so its caller
  // audits nothing. The freeze check above still applies; the comparison runs
  // under the months' lock.
  if (created.size === 0 && sameAsStored(before, rows, periods)) return { periods, measures, before: [], after: [] };
  // Rows of a patch may name different measures; group them so each
  // statement lists its own target columns (at most one per measure set).
  const groups = new Map<string, { measures: AmountMeasure[]; rows: AmountRowInput[] }>();
  rows.forEach((row, index) => {
    const rowMeasures = AMOUNT_MEASURES.filter((m) => row[m] !== undefined);
    const key = rowMeasures.join(',');
    const group = groups.get(key) ?? { measures: rowMeasures, rows: [] };
    group.rows.push({ ...row, period: periods[index] });
    groups.set(key, group);
  });
  for (const group of groups.values()) await upsertColumns(ctx, group.measures, group.rows);
  const after = await readRows(ctx, periods);
  return { periods, measures, before, after };
}

/**
 * Take the lock every amounts write takes, without writing amounts: create the
 * missing months of `year`, then lock the twelve in period order. A caller
 * that changes only round inputs takes it first, so a record is never locked
 * before the months (no deadlock with a concurrent spread of the same line).
 */
export async function lockYearMonths(ctx: MonthsContext, year: number): Promise<void> {
  assertVersionTenant(ctx.version);
  assertYearMatchesVersion(year, ctx.version);
  await lockVersion(ctx);
  const periods = yearPeriods(year);
  await createMissingMonths(ctx, periods);
  await readRows(ctx, periods, true);
}

/**
 * The same lock without creating a month: the version, then the months of
 * `year` already stored, in period order. For a caller that changes only a
 * record and holds the line (no concurrent writer can add a month meanwhile),
 * so a version without months gets none.
 */
export async function lockStoredMonths(ctx: MonthsContext, year: number): Promise<void> {
  assertVersionTenant(ctx.version);
  assertYearMatchesVersion(year, ctx.version);
  await lockVersion(ctx);
  await readRows(ctx, yearPeriods(year), true);
}

/**
 * Replace the twelve months of `year` for every measure the rows carry. Each
 * row must carry the same measures, and the rows must be the twelve
 * first-of-month dates of the year.
 */
export async function replaceAmounts(ctx: AmountsWriteContext, year: number, rows: AmountRowInput[]): Promise<AmountsWriteResult> {
  return withColumnNames(ctx, async () => {
    assertYearMatchesVersion(year, ctx.version);
    const { periods, measures } = inspectRows(year, rows);
    if (rows.length !== 12) {
      throw new BadRequestException(`Replacing a year needs its twelve months; ${rows.length} given.`);
    }
    for (const row of rows) {
      const missing = measures.find((m) => row[m] === undefined);
      if (missing) throw badValue({ measure: missing, where: ` for ${row.period}` }, 'is missing.');
    }
    return write(ctx, year, rows, periods, measures);
  });
}

/** Write only the cells supplied; everything else stays as stored. */
export async function patchAmounts(ctx: AmountsWriteContext, year: number, rows: AmountRowInput[]): Promise<AmountsWriteResult> {
  return withColumnNames(ctx, async () => {
    assertYearMatchesVersion(year, ctx.version);
    if (rows.length === 0) throw new BadRequestException('Send at least one month.');
    const { periods, measures } = inspectRows(year, rows);
    return write(ctx, year, rows, periods, measures);
  });
}

/** Spread yearly totals over the twelve months (flat unless weights are given); rows carry only the measures named. */
export function spreadAnnualRows(
  year: number,
  totals: Partial<Record<AmountMeasure, bigint>>,
  weights: readonly bigint[] = FLAT_WEIGHTS,
  window?: SpreadWindow,
): AmountRowInput[] {
  return spreadAnnualToMonths(year, totals, weights, window);
}

/** A spread input error becomes a 400 with its readable message. */
function asBadRequest<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof SpreadInputError) throw new BadRequestException(err.message);
    throw err;
  }
}

/** A spread profile as used: its name, integer weights and the stored weights as written. */
export type ResolvedProfile = { name: string; weights: readonly bigint[]; labels: string[] };

export const FLAT_PROFILE: ResolvedProfile = { name: 'flat', weights: FLAT_WEIGHTS, labels: FLAT_WEIGHTS.map(() => '1') };

/**
 * The profile a yearly spread uses, shared by OPEX and CAPEX: unset or
 * 'flat' is equal twelfths; any other name must be a row of the global
 * `spread_profiles` table with usable weights. Anything else is refused,
 * never replaced by flat.
 */
export async function resolveSpreadProfile(manager: EntityManager, raw: unknown): Promise<ResolvedProfile> {
  if (raw === undefined || raw === null || raw === '' || raw === 'flat') return FLAT_PROFILE;
  // spread_profiles is global (no tenant_id): every tenant reads the same rows.
  const rows: Array<{ name: string; weights_json: unknown }> = typeof raw === 'string'
    ? await manager.query(`SELECT name, weights_json FROM spread_profiles WHERE name = $1`, [raw])
    : [];
  const weights = rows.length ? asBadRequest(() => profileWeights(rows[0].weights_json)) : null;
  if (!weights) {
    const names: Array<{ name: string }> = await manager.query(`SELECT name FROM spread_profiles ORDER BY name`);
    const accepted = Array.from(new Set(['flat', ...names.map((n) => n.name)]));
    throw new BadRequestException(`Unknown spread profile '${String(raw)}'. Use ${accepted.join(', ')}.`);
  }
  return { name: rows[0].name, weights, labels: (rows[0].weights_json as unknown[]).map((w) => String(w)) };
}

const QUARTERLY_DISTRIBUTIONS = new Map<unknown, 'equal' | '445'>([['equal', 'equal'], ['flat', 'equal'], ['4-4-5', '445']]);

/** How a quarter is spread over its months: unset, 'equal' or 'flat' is equal thirds, '4-4-5' is 4-4-5; anything else is refused. */
function quarterlyDistribution(raw: unknown): 'equal' | '445' {
  const distribution = raw === undefined || raw === null || raw === '' ? 'equal' : QUARTERLY_DISTRIBUTIONS.get(raw);
  if (!distribution) {
    throw new BadRequestException(`Unknown spread profile '${String(raw)}' for quarters. Use equal, flat or 4-4-5.`);
  }
  return distribution;
}

/**
 * Refuse a spread profile that an amounts payload of `kind` could not use,
 * with the message the write itself gives: a yearly spread takes flat or a
 * stored profile, a quarterly one equal, flat or 4-4-5. Monthly amounts take
 * no profile, so nothing is checked. Lets a preview refuse what the write
 * would refuse.
 */
export async function assertSpreadProfile(manager: EntityManager, kind: unknown, name: unknown): Promise<void> {
  if (kind === 'annual') await resolveSpreadProfile(manager, name);
  if (kind === 'quarterly') quarterlyDistribution(name);
}

/** Period of a spread payload: both bounds or neither (the whole year), at least one active month. */
export type PayloadPeriod = { period_start: string; period_end: string; active_months: number[] };

export function parsePayloadPeriod(payload: Record<string, unknown>, year: number): PayloadPeriod {
  const given = (value: unknown) => value !== undefined && value !== null && !(typeof value === 'string' && value.trim() === '');
  const hasStart = given(payload.period_start);
  const hasEnd = given(payload.period_end);
  if (hasStart !== hasEnd) {
    throw new BadRequestException('Send both period_start and period_end, or neither for the whole year.');
  }
  const period_start = hasStart ? String(payload.period_start).trim() : `${year}-01-01`;
  const period_end = hasEnd ? String(payload.period_end).trim() : `${year}-12-31`;
  const months = asBadRequest(() => activeMonths(year, period_start, period_end));
  if (months.length === 0) throw new BadRequestException(NO_ACTIVE_MONTH_MESSAGE);
  return { period_start, period_end, active_months: months };
}

/** What a spread payload did, so its round inputs can be recorded. */
export type PayloadSpread =
  | { kind: 'annual'; totals: Partial<Record<AmountMeasure, bigint>>; profile: ResolvedProfile; period: PayloadPeriod }
  | {
    kind: 'quarterly';
    measure: AmountMeasure;
    quarters: Record<'Q1' | 'Q2' | 'Q3' | 'Q4', bigint>;
    distribution: 'equal' | '445';
    period: PayloadPeriod;
  };

export type AmountsPayloadResult = AmountsWriteResult & { spread: PayloadSpread | null };

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

/** The months of a spread, per column it replaces (what `beforeWrite` compares). */
function plannedColumns(rows: AmountRowInput[], measures: readonly AmountMeasure[]): PlannedAmounts {
  return { kind: 'columns', columns: measures.map((measure) => ({ measure, months: rows.map((row) => row[measure] ?? 0n) })) };
}

/** `also_measures` of a yearly spread: known columns, once each, not already in `totals`. */
function alsoMeasures(raw: unknown, totals: Partial<Record<AmountMeasure, bigint>>): AmountMeasure[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new BadRequestException('also_measures must be a list of columns.');
  const unknown = raw.find((m) => !isAmountMeasure(m));
  if (unknown !== undefined) throw unknownMeasure(String(unknown ?? ''));
  const named = new Set<unknown>(raw);
  return AMOUNT_MEASURES.filter((m) => named.has(m) && totals[m] === undefined);
}

/**
 * Apply an amounts payload from the budget tab, the API or the AI:
 * - `annual`: `totals` names one or more measures; each is spread over the
 *   period (flat, or the named spread profile) and replaces the twelve
 *   months of that measure only. `also_measures` ("apply the distribution to
 *   all columns", plan planning/perf-scale lot 3D) names more columns spread
 *   the same way from their own stored total, read under the months' lock: the
 *   screen sends no total for them, so a column someone else changed meanwhile
 *   keeps its total and only takes the period and distribution.
 * - `quarterly`: one `measure`; `Q1`..`Q4` are spread inside their quarter
 *   over the active months of the period and replace that measure's year, an
 *   omitted quarter being zero.
 * - `monthly`: `months` rows patch only the cells they carry.
 * `period_start` / `period_end` (annual and quarterly) default to the whole
 * year. Everything is validated before the first write.
 */
export async function writeAmountsPayload(ctx: AmountsWriteContext, rawPayload: unknown): Promise<AmountsPayloadResult> {
  return withColumnNames(ctx, () => writePayload(ctx, rawPayload));
}

async function writePayload(ctx: AmountsWriteContext, rawPayload: unknown): Promise<AmountsPayloadResult> {
  const payload = asObject(rawPayload, 'The amounts');
  const year = assertYearMatchesVersion(payload.year, ctx.version);
  const profileName = payload.spread_profile_name;

  if (payload.kind === 'annual') {
    const input = asObject(payload.totals ?? {}, 'totals');
    const totals: Partial<Record<AmountMeasure, bigint>> = {};
    for (const [key, value] of Object.entries(input)) {
      if (!isAmountMeasure(key)) throw unknownMeasure(key);
      totals[key] = validateAmountValue(value, { measure: key, where: ' total' });
    }
    if (Object.keys(totals).length === 0) {
      throw new BadRequestException('The yearly totals must name at least one amount.');
    }
    const also = alsoMeasures(payload.also_measures, totals);
    const period = parsePayloadPeriod(payload, year);
    const profile = await resolveSpreadProfile(ctx.manager, profileName);
    if (also.length > 0) {
      // A frozen column refuses the whole spread before any month is created or locked.
      assertVersionTenant(ctx.version);
      await assertMeasuresEditable(ctx, year, AMOUNT_MEASURES.filter((m) => totals[m] !== undefined || also.includes(m)));
      // The months' lock first (the lock order of every amounts write), so the totals read
      // below are the ones the spread replaces: no write of the line can land in between.
      await lockYearMonths(ctx, year);
      const stored = (await readVersionMonths(ctx.manager, ctx.scope, ctx.version.tenant_id, [ctx.version])).get(ctx.version.id)!;
      for (const measure of also) totals[measure] = stored.months[measure].reduce((sum, cents) => sum + cents, 0n);
    }
    const window = { start: period.period_start, end: period.period_end };
    const rows = asBadRequest(() => spreadAnnualRows(year, totals, profile.weights, window));
    await ctx.beforeWrite?.(plannedColumns(rows, AMOUNT_MEASURES.filter((m) => totals[m] !== undefined)));
    const result = await replaceAmounts(ctx, year, rows);
    return { ...result, spread: { kind: 'annual', totals, profile, period } };
  }

  if (payload.kind === 'quarterly') {
    const measure = payload.measure;
    if (!isAmountMeasure(measure)) throw unknownMeasure(String(measure ?? ''));
    const quarters: Record<'Q1' | 'Q2' | 'Q3' | 'Q4', bigint> = { Q1: 0n, Q2: 0n, Q3: 0n, Q4: 0n };
    for (const quarter of ['Q1', 'Q2', 'Q3', 'Q4'] as const) {
      if (!Object.prototype.hasOwnProperty.call(payload, quarter)) continue;
      quarters[quarter] = validateAmountValue(payload[quarter], { measure, where: ` ${quarter}` });
    }
    const distribution = quarterlyDistribution(profileName);
    const period = parsePayloadPeriod(payload, year);
    const window = { start: period.period_start, end: period.period_end };
    const rows = asBadRequest(() => spreadQuarterlyToMonths(year, measure, quarters, distribution, window));
    await ctx.beforeWrite?.(plannedColumns(rows, [measure]));
    const result = await replaceAmounts(ctx, year, rows);
    return { ...result, spread: { kind: 'quarterly', measure, quarters, distribution, period } };
  }

  if (payload.kind === 'monthly') {
    if (!Array.isArray(payload.months) || payload.months.length === 0) {
      throw new BadRequestException('Send at least one month.');
    }
    const rows = payload.months.map((entry, index) => {
      const input = asObject(entry, `Month ${index + 1}`);
      const period = typeof input.period === 'string' ? input.period : '';
      const row: AmountRowInput = { period };
      for (const [key, value] of Object.entries(input)) {
        if (key === 'period') continue;
        if (!isAmountMeasure(key)) throw unknownMeasure(key);
        row[key] = validateAmountValue(value, { measure: key, where: ` for ${period || `month ${index + 1}`}` });
      }
      return row;
    });
    await ctx.beforeWrite?.({ kind: 'cells', rows });
    return { ...(await patchAmounts(ctx, year, rows)), spread: null };
  }

  throw new BadRequestException('Unsupported amounts payload: kind must be annual, quarterly or monthly.');
}

/** The twelve months (cents) of every measure of a version's own year; a missing month or NULL is zero. */
export type VersionMonths = { stored: boolean; months: Record<AmountMeasure, bigint[]> };

export function emptyMonths(): Record<AmountMeasure, bigint[]> {
  return Object.fromEntries(AMOUNT_MEASURES.map((m) => [m, Array.from({ length: 12 }, () => 0n)])) as Record<AmountMeasure, bigint[]>;
}

/**
 * Stored months of several versions in one query, keyed by version id.
 * `stored` says whether the version has at least one month in its year.
 */
export async function readVersionMonths(
  manager: EntityManager,
  scope: AmountScope,
  tenantId: string,
  versions: ReadonlyArray<{ id: string; budget_year: number | string }>,
): Promise<Map<string, VersionMonths>> {
  const result = new Map<string, VersionMonths>();
  for (const version of versions) result.set(version.id, { stored: false, months: emptyMonths() });
  if (versions.length === 0) return result;
  const yearOf = new Map(versions.map((v) => [v.id, Number(v.budget_year)]));
  const rows: Array<Record<string, string | null>> = await manager.query(
    `SELECT version_id, to_char(period, 'YYYY-MM-DD') AS period, planned, forecast, committed, actual, expected_landing
     FROM ${AMOUNT_TABLE[scope]}
     WHERE tenant_id = $1 AND version_id = ANY($2::uuid[])`,
    [tenantId, versions.map((v) => v.id)],
  );
  for (const row of rows) {
    const entry = result.get(String(row.version_id));
    const period = String(row.period);
    if (!entry || Number(period.slice(0, 4)) !== yearOf.get(String(row.version_id))) continue;
    const index = Number(period.slice(5, 7)) - 1;
    entry.stored = true;
    for (const measure of AMOUNT_MEASURES) entry.months[measure][index] += toCents(row[measure]);
  }
  return result;
}

/**
 * The stored months of a version's own year, in period order, as a write
 * answers them to the budget tab (the cells it now holds): the screen takes
 * the columns it wrote from here as the base of the user's next edit.
 */
export async function readYearAmounts(manager: EntityManager, scope: AmountScope, version: AmountVersion): Promise<StoredAmountRow[]> {
  return readRows({ manager, scope, version }, yearPeriods(Number(version.budget_year)));
}

/**
 * The yearly totals of a version (its own budget year), as the stored totals of lot 2A keep them:
 * one row, zeros when the version has no month yet. The Allocations tab shows them (lot 3G: read
 * after the version's counter, in the answer that carries it, so what the tab knows is never newer
 * than what it shows).
 */
export async function readVersionYearTotals(manager: EntityManager, scope: AmountScope, tenantId: string, versionId: string): Promise<Record<AmountMeasure, number>> {
  const [row]: Array<Partial<Record<AmountMeasure, string | number>>> = await manager.query(
    `SELECT ${AMOUNT_MEASURES.join(', ')} FROM spend_version_totals WHERE tenant_id = $1 AND version_id = $2`,
    [tenantId, versionId],
  );
  return Object.fromEntries(AMOUNT_MEASURES.map((measure) => [measure, Number(row?.[measure] ?? 0)])) as Record<AmountMeasure, number>;
}

/**
 * The version's `budget_rev` once a write is done (plan planning/perf-scale, lot 3G): the budget
 * tab keeps it as the counter it knows, so its own saves never read as someone else's change.
 */
export async function readVersionBudgetRev(manager: EntityManager, scope: AmountScope, version: AmountVersion): Promise<number | null> {
  const [row]: Array<{ budget_rev: number | string }> = await manager.query(
    `SELECT budget_rev FROM spend_versions WHERE tenant_id = $1 AND id = $2`,
    [version.tenant_id, version.id],
  );
  return row ? Number(row.budget_rev) : null;
}
