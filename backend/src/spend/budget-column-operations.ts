import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { FreezeService } from '../freeze/freeze.service';
import { formatCents } from '../common/amount';
import { Decimal, DECIMAL_SCALE_DIGITS, DecimalLimitError, divRoundHalfAway, parseLimitedDecimal } from '../common/decimal';
import {
  calendarDaysFor,
  isProfileActive,
  loadWorkingDayProfiles,
  WorkingDayProfileInfo,
} from '../working-day-profiles/working-day-profiles.util';
import {
  AmountMeasure,
  AmountScope,
  AmountVersion,
  BUDGET_COLUMN_MEASURE,
  BudgetColumn,
  MEASURE_FREEZE_COLUMN,
  lockStoredMonths,
  lockYearMonths,
  readVersionMonths,
  replaceAmounts,
  yearPeriods,
} from './amounts-write.util';
import {
  centsToDecimal,
  costLine,
  deleteRoundInput,
  lineCalendarDays,
  linesResult,
  linesRound,
  listRoundInputs,
  RoundInput,
  RoundInputsContext,
  upsertRoundInput,
  wholeYear,
} from './round-inputs.util';
import { ColumnResult, computeColumn, CostingInputError, CostLine, UNIT_PRICE_LIMITS } from './costing.util';
import { activeMonths } from './spread.util';
import { ensureBudgetVersion } from './budget-version-ensure';
import { lockBudgetLines, lockBudgetVersions, lockTenantBudgetOperations } from './budget-locks';
import { assertScopeNatures, auditTableOf, natureAnd, type BudgetNature } from './budget-nature';

/**
 * Budget column operations (copy a column to another year or column, clear a
 * column), for OPEX and CAPEX alike.
 *
 * Both run inside the request transaction and are all or nothing: an error on
 * any item fails the request, and the request transaction rolls every item
 * back. Items without a source, with an all-zero source, or with a
 * destination that already has amounts (without overwrite) are skipped.
 *
 * A copy writes only the items valid in the destination year, like the grid
 * shows them: an item counts for the months whose 15th lies between its
 * effective start and its end of validity (see `validityInYear`). An item
 * without such a month is left out; an item valid for part of the year gets
 * only those months. A clear runs on every item, ended or not.
 */

// Table and column names come only from here: never from the caller. `nature`: the scope's lines in
// `spend_items` (`budget-nature.ts`); the versions are read through the lines read here.
const SCOPES: Record<AmountScope, { items: string; itemFk: string; versions: string; itemName: string; nature?: BudgetNature }> = {
  opex: { items: 'spend_items', itemFk: 'spend_item_id', versions: 'spend_versions', itemName: 'product_name', nature: 'opex' },
  capex: { items: 'spend_items', itemFk: 'spend_item_id', versions: 'spend_versions', itemName: 'product_name', nature: 'capex' },
};
assertScopeNatures('budget-column-operations', SCOPES, (t) => t.items);

export type BudgetOperationDeps = {
  manager: EntityManager;
  audit: Pick<AuditService, 'log'>;
  freeze: Pick<FreezeService, 'assertNotFrozen'>;
};

/** An item with its dates as `YYYY-MM-DD` text: the effective start and the UTC calendar date of the end of validity. */
export type ItemRow = { id: string; tenant_id: string; name: string; effective_start: string | null; end_of_validity: string | null };
export type BudgetVersionRow = AmountVersion & { item_id: string; input_grain: 'annual' | 'quarterly' | 'monthly' };

export async function currentTenantId(manager: EntityManager): Promise<string> {
  const [row] = await manager.query(`SELECT app_current_tenant() AS tenant_id`);
  const tenantId = row?.tenant_id as string | null;
  if (!tenantId) throw new InternalServerErrorException('Budget operations need a tenant context.');
  return tenantId;
}

function budgetColumn(value: unknown, label: string): BudgetColumn {
  if (typeof value !== 'string' || !Object.prototype.hasOwnProperty.call(BUDGET_COLUMN_MEASURE, value)) {
    throw new BadRequestException(`${label} must be one of ${Object.keys(BUDGET_COLUMN_MEASURE).join(', ')}.`);
  }
  return value as BudgetColumn;
}

function budgetYear(value: unknown, label: string): number {
  const year = typeof value === 'string' && /^\d{4}$/.test(value.trim()) ? Number(value) : value;
  if (typeof year !== 'number' || !Number.isInteger(year) || year < 1000 || year > 9999) {
    throw new BadRequestException(`${label} must be a year.`);
  }
  return year;
}

/**
 * The uplift percentage, parsed exactly (a number or a decimal string); blank
 * is 0. It must stay above −100 %: −100 % would copy zeros and below it every
 * month would change sign.
 */
function upliftPct(value: unknown): Decimal {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) return Decimal.ZERO;
  if (typeof value !== 'number' && typeof value !== 'string') throw new BadRequestException('percentageIncrease must be a number.');
  let pct: Decimal;
  try {
    pct = Decimal.from(value);
  } catch {
    throw new BadRequestException('percentageIncrease must be a number.');
  }
  if (pct.cmp(-100) <= 0) throw new BadRequestException('The percentage must be above -100 %, or the copied amounts would be zero or change sign.');
  return pct;
}

const sum = (values: readonly bigint[]) => values.reduce((acc, v) => acc + v, 0n);
const toNumber = (cents: bigint) => Number(formatCents(cents));

/**
 * The twelve copied months. Without an uplift they are the source months to
 * the cent. With one, they are whole units of the item's currency:
 * - the yearly total is the uplifted source total rounded half away from zero;
 * - each month is its uplifted source value truncated toward zero;
 * - the units still missing go one by one to the months with the largest
 *   dropped fraction, the latest month first on a tie.
 * A year that mixes signs (a credit month among positive months) is shared
 * per sign group: the positive months share their own uplifted total rounded
 * half away from zero, the negative months theirs. The two group totals are
 * at most one unit away from the yearly total; when they are, the group whose
 * total was rounded away from zero gives that unit back. A unit only ever
 * goes to a month with a dropped fraction of its own sign, so no month
 * changes sign (the uplift is above −100 %, so each month keeps the sign of
 * its source month) and a zero month stays zero. Exact integer arithmetic
 * throughout.
 */
export function copiedMonths(source: readonly bigint[], pct: Decimal): bigint[] {
  if (pct.units === 0n) return [...source];
  const scale = 10n ** BigInt(DECIMAL_SCALE_DIGITS);
  // A month in whole units is cents × (100 + pct) / 100 / 100: `exact[i]` over `unit`.
  const factor = 100n * scale + pct.units;
  const unit = 100n * scale * 100n;
  const exact = source.map((cents) => cents * factor);
  // Bigint division truncates toward zero; `dropped` keeps the sign of its month.
  const months = exact.map((value) => value / unit);
  const dropped = exact.map((value, i) => value - months[i] * unit);
  const indexes = exact.map((_, i) => i);
  const positive = indexes.filter((i) => exact[i] > 0n);
  const negative = indexes.filter((i) => exact[i] < 0n);
  const groupTotal = (group: number[]) => divRoundHalfAway(sum(group.map((i) => exact[i])), unit);
  let positiveTotal = groupTotal(positive);
  let negativeTotal = groupTotal(negative);
  const gap = divRoundHalfAway(sum(exact), unit) - positiveTotal - negativeTotal;
  if (gap < 0n) positiveTotal -= 1n;
  if (gap > 0n) negativeTotal += 1n;
  const share = (group: number[], total: bigint, step: 1n | -1n) => {
    const missing = (total - sum(group.map((i) => months[i]))) * step;
    const order = group
      .filter((i) => dropped[i] !== 0n)
      .sort((a, b) => {
        const larger = (dropped[b] - dropped[a]) * step;
        return larger > 0n ? 1 : larger < 0n ? -1 : b - a;
      });
    if (missing < 0n || missing > BigInt(order.length)) {
      throw new InternalServerErrorException('A copied column could not be rounded to whole units.');
    }
    order.slice(0, Number(missing)).forEach((i) => { months[i] += step; });
  };
  share(positive, positiveTotal, 1n);
  share(negative, negativeTotal, -1n);
  return months.map((units) => units * 100n);
}

/** The same calendar dates `delta` years later; 29 February becomes 28 February outside leap years. */
export function shiftPeriod(record: Pick<RoundInput, 'period_start' | 'period_end'>, delta: number) {
  const shift = (date: string) => {
    const year = Number(date.slice(0, 4)) + delta;
    const monthDay = date.slice(5);
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return `${year}-${monthDay === '02-29' && !leap ? '02-28' : monthDay}`;
  };
  return { period_start: shift(record.period_start), period_end: shift(record.period_end) };
}

/**
 * A column's lines copied to `year`: each period shifted like the record's
 * (29 February becomes 28 February) and kept within that year; calendar,
 * quantity, price, how often and days per month as they are (a one-date line
 * stays on one date).
 */
export function shiftLines(record: Pick<RoundInput, 'lines'> | undefined, year: number): CostLine[] {
  return (record?.lines ?? []).map((line) => {
    const shifted = shiftPeriod(line, year - Number(line.period_start.slice(0, 4)));
    return {
      ...costLine(line),
      period_start: shifted.period_start < `${year}-01-01` ? `${year}-01-01` : shifted.period_start,
      period_end: shifted.period_end > `${year}-12-31` ? `${year}-12-31` : shifted.period_end,
    };
  });
}

/** The window of `year` in which an item is valid, and its months (1..12). */
export type YearValidity = { start: string; end: string; months: number[] };

/**
 * Where an item is valid within `year`: from its effective start (or January 1)
 * to its end of validity (or December 31), both clamped to the year. Its
 * months are those whose 15th lies in that window, the rule of
 * `activeMonths`. Null when no month counts: the item is not valid in the year.
 */
export function validityInYear(year: number, item: Pick<ItemRow, 'effective_start' | 'end_of_validity'>): YearValidity | null {
  const first = `${year}-01-01`;
  const last = `${year}-12-31`;
  const start = item.effective_start && item.effective_start > first ? item.effective_start : first;
  const end = item.end_of_validity && item.end_of_validity < last ? item.end_of_validity : last;
  const months = start <= end ? activeMonths(year, start, end) : [];
  return months.length > 0 ? { start, end, months } : null;
}

/**
 * Every item of the tenant, ended or not. Dates are read as text so no time
 * zone shifts them. The id breaks ties: the lines of one import share their
 * created_at, and the order must not change from one run to the next.
 */
async function loadItems(manager: EntityManager, scope: AmountScope, tenantId: string): Promise<ItemRow[]> {
  const t = SCOPES[scope];
  return manager.query(
    `SELECT id, tenant_id, ${t.itemName} AS name,
            to_char(effective_start, 'YYYY-MM-DD') AS effective_start,
            to_char(disabled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS end_of_validity
     FROM ${t.items}
     WHERE tenant_id = $1${natureAnd(null, t.nature)}
     ORDER BY created_at DESC, id DESC`,
    [tenantId],
  );
}

/** Items valid in `year` (see `validityInYear`), each with its window. */
export async function loadItemsValidIn(manager: EntityManager, scope: AmountScope, tenantId: string, year: number) {
  const items = await loadItems(manager, scope, tenantId);
  return items.flatMap((item) => {
    const validity = validityInYear(year, item);
    return validity ? [{ ...item, validity }] : [];
  });
}

/**
 * The copied period within the item's validity. When they share no month
 * (no 15th), the validity window itself.
 */
export function periodWithinValidity(period: { period_start: string; period_end: string }, validity: YearValidity) {
  const start = period.period_start > validity.start ? period.period_start : validity.start;
  const end = period.period_end < validity.end ? period.period_end : validity.end;
  const year = Number(validity.start.slice(0, 4));
  return start <= end && activeMonths(year, start, end).length > 0
    ? { period_start: start, period_end: end }
    : { period_start: validity.start, period_end: validity.end };
}

/** Versions of the items for the years given, one per item and year (both version tables are unique per item and year). */
export async function loadVersions(
  manager: EntityManager,
  scope: AmountScope,
  tenantId: string,
  itemIds: string[],
  years?: number[],
): Promise<Map<string, BudgetVersionRow>> {
  const byItemYear = new Map<string, BudgetVersionRow>();
  if (itemIds.length === 0) return byItemYear;
  const t = SCOPES[scope];
  const rows: BudgetVersionRow[] = await manager.query(
    `SELECT id, tenant_id, ${t.itemFk} AS item_id, budget_year, input_grain
     FROM ${t.versions}
     WHERE tenant_id = $1 AND ${t.itemFk} = ANY($2::uuid[])${years ? ' AND budget_year = ANY($3::int[])' : ''}
     ORDER BY created_at DESC, id DESC`,
    years ? [tenantId, itemIds, years] : [tenantId, itemIds],
  );
  // The versions are unique per (item, year); keeping the first, the newest, is only a guard.
  for (const row of rows) {
    const key = `${row.item_id}:${Number(row.budget_year)}`;
    if (!byItemYear.has(key)) byItemYear.set(key, { ...row, budget_year: Number(row.budget_year) });
  }
  return byItemYear;
}

/**
 * The version of an item's year, created (and audited) when it has none, with
 * the item's tenant_id. Get-or-create: a version a concurrent request created
 * meanwhile is used as it is (see `budget-version-ensure.ts`); `created` says
 * which, so a caller that decided on a snapshot without that version can
 * check it again (a budget tab may have typed months into it).
 */
export async function createBudgetVersion(
  deps: Pick<BudgetOperationDeps, 'manager' | 'audit'>,
  scope: AmountScope,
  params: { itemId: string; tenantId: string; year: number; name: string; inputGrain: 'annual' | 'quarterly' | 'monthly' },
  userId: string | null,
): Promise<{ version: BudgetVersionRow; created: boolean }> {
  const ensured = await ensureBudgetVersion(deps.manager, scope, {
    tenantId: params.tenantId,
    itemId: params.itemId,
    year: params.year,
    versionName: params.name,
    inputGrain: params.inputGrain,
    asOfDate: `${params.year}-01-01`,
    allocationMethod: 'default',
  });
  if (!ensured) {
    throw new BadRequestException(`Another year of a line already has a version named "${params.name}": rename it, then try again.`);
  }
  const { version, created } = ensured;
  if (created) {
    await deps.audit.log(
      { table: auditTableOf(scope, SCOPES[scope].versions), recordId: version.id, action: 'create', before: null, after: version, userId },
      { manager: deps.manager },
    );
  }
  return {
    version: { id: version.id, tenant_id: params.tenantId, budget_year: params.year, item_id: params.itemId, input_grain: version.input_grain },
    created,
  };
}

/* ── Copy of a column that follows its quantity × price lines ─────────────── */

/**
 * What a copy did with the calendar of one per-day line (of a column that
 * follows its lines, or of lines that are only a reference):
 * - `disabled`: the calendar is disabled; the copy still uses it;
 * - `fallback`: it has no working days for the destination year; the copy
 *   uses the paying company's standard calendar (`fallback`) instead;
 * - `missing`: neither has days; the item is copied the old way (months ×
 *   uplift, lines unchanged as a reference, their FTE as the source's, no
 *   result of the lines).
 */
export type CalendarIssue = {
  /** The line's description, or "Line n" when it has none. */
  line: string;
  /** The line's place in the source column, from 1. */
  lineNumber: number;
  calendar: string;
  kind: 'disabled' | 'fallback' | 'missing';
  fallback?: string;
};

/** A column follows its lines when it has some and its months are computed from them (the frontend's `followsLines`). */
export function followsLines(record: Pick<RoundInput, 'lines' | 'method'> | undefined): boolean {
  return !!record && record.lines.length > 0 && record.method === 'computed';
}

/**
 * A unit price raised by `pct` percent: `price × (1 + pct / 100)`, exact,
 * rounded once, half away from zero, to the 4 decimals of the column.
 */
export function upliftedPrice(price: string, pct: Decimal): string {
  const scale = 10n ** BigInt(DECIMAL_SCALE_DIGITS);
  // price.units × (100 × scale + pct.units) is the raised price in 10^-20 units, × 100 × scale.
  const fourDecimals = divRoundHalfAway(
    Decimal.from(price).units * (100n * scale + pct.units),
    100n * scale * 10n ** BigInt(DECIMAL_SCALE_DIGITS - 4),
  );
  return Decimal.from(`${fourDecimals}e-4`).toString();
}

/**
 * A shifted line's period within the item's validity; null when the line no
 * longer covers an active month (its 15th, or the month of a one-date line
 * bought once: the rule of `computeLine`).
 */
export function lineWithinValidity(line: CostLine, validity: YearValidity): CostLine | null {
  const start = line.period_start > validity.start ? line.period_start : validity.start;
  const end = line.period_end < validity.end ? line.period_end : validity.end;
  if (start > end) return null;
  const year = Number(validity.start.slice(0, 4));
  const oneDate = line.frequency === 'once' && start === end;
  return activeMonths(year, start, end).length > 0 || oneDate ? { ...line, period_start: start, period_end: end } : null;
}

/** The calendars a copy of lines reads, keyed by id, and the country of each item's paying company. */
type CopyCalendars = { calendars: Map<string, WorkingDayProfileInfo>; countryOf: Map<string, string> };

/**
 * The calendars the per-day lines name, and the company standard calendars
 * (country, no region) of the items' paying companies, which replace a
 * calendar without days for the destination year. A real copy reads them in
 * one statement FOR KEY SHARE, after the version locks (`budget-locks.ts`):
 * it may write lines that name them.
 */
async function loadCopyCalendars(
  manager: EntityManager,
  scope: AmountScope,
  tenantId: string,
  itemIds: string[],
  calendarIds: string[],
  lock: boolean,
): Promise<CopyCalendars> {
  if (itemIds.length === 0) return { calendars: new Map(), countryOf: new Map() };
  const countries: Array<{ id: string; country_iso: string | null }> = await manager.query(
    `SELECT i.id, upper(c.country_iso) AS country_iso
     FROM ${SCOPES[scope].items} i
     JOIN companies c ON c.tenant_id = i.tenant_id AND c.id = i.paying_company_id
     WHERE i.tenant_id = $1 AND i.id = ANY($2::uuid[])${natureAnd('i', SCOPES[scope].nature)}`,
    [tenantId, itemIds],
  );
  const countryOf = new Map(countries.filter((row) => row.country_iso).map((row) => [row.id, row.country_iso as string]));
  const standard: Array<{ id: string }> = countryOf.size === 0 ? [] : await manager.query(
    `SELECT id FROM working_day_profiles WHERE tenant_id = $1 AND country_iso = ANY($2::text[]) AND region_code IS NULL`,
    [tenantId, [...new Set(countryOf.values())]],
  );
  const calendars = await loadWorkingDayProfiles(
    manager,
    tenantId,
    [...calendarIds, ...standard.map((row) => row.id)],
    lock ? { lock: 'key share' } : {},
  );
  return { calendars, countryOf };
}

/** The company standard calendar of `country` that has days for `year`, other than `exclude`; the code then the id decide between several. */
function standardCalendar(calendars: Map<string, WorkingDayProfileInfo>, country: string | undefined, year: number, exclude: string) {
  if (!country) return null;
  return [...calendars.values()]
    .filter((c) => c.id !== exclude && c.country_iso === country && !c.region_code && isProfileActive(c) && calendarDaysFor(c, year))
    .sort((a, b) => a.code.localeCompare(b.code) || a.id.localeCompare(b.id))[0] ?? null;
}

/** The copy of a column's lines, decided: computed for the destination year, the old way, or nothing left. */
type LinesCopy =
  | { kind: 'lines'; lines: CostLine[]; calendars: Map<string, WorkingDayProfileInfo>; result: ColumnResult; issues: CalendarIssue[] }
  | { kind: 'reference'; issues: CalendarIssue[] }
  | { kind: 'empty' };

/**
 * The lines of a source column copied to the destination year: shifted, cut
 * to the item's validity (a line left without an active month is dropped),
 * their unit prices raised by `pct` (0 for lines that are only a
 * reference), their per-day calendars read for the destination year (see
 * `CalendarIssue`), then computed. A calendar no line can do without sends
 * the whole item back to the old copy.
 */
function planLinesCopy(
  item: { id: string; name: string; validity: YearValidity },
  source: RoundInput,
  year: number,
  pct: Decimal,
  context: CopyCalendars,
): LinesCopy {
  const kept: Array<{ line: CostLine; name: string; calendar?: WorkingDayProfileInfo }> = [];
  const issues: CalendarIssue[] = [];
  const missing: CalendarIssue[] = [];
  shiftLines(source, year).forEach((shifted, index) => {
    const line = lineWithinValidity(shifted, item.validity);
    if (!line) return;
    const n = index + 1;
    const name = source.lines[index].label || `Line ${n}`;
    const id = line.working_day_profile_id;
    if (!id) {
      kept.push({ line, name });
      return;
    }
    const own = context.calendars.get(id);
    const calendarName = own?.name ?? source.lines[index].working_day_profile_name ?? '';
    if (own && calendarDaysFor(own, year)) {
      if (!isProfileActive(own)) issues.push({ line: name, lineNumber: n, calendar: calendarName, kind: 'disabled' });
      kept.push({ line, name, calendar: own });
      return;
    }
    const fallback = standardCalendar(context.calendars, context.countryOf.get(item.id), year, id);
    if (!fallback) {
      missing.push({ line: name, lineNumber: n, calendar: calendarName, kind: 'missing' });
      return;
    }
    issues.push({ line: name, lineNumber: n, calendar: calendarName, kind: 'fallback', fallback: fallback.name });
    kept.push({ line: { ...line, working_day_profile_id: fallback.id }, name, calendar: fallback });
  });
  if (missing.length > 0) return { kind: 'reference', issues: missing };
  if (kept.length === 0) return { kind: 'empty' };

  const lines = kept.map(({ line, name }) => {
    const unit_price = upliftedPrice(line.unit_price, pct);
    try {
      parseLimitedDecimal(unit_price, UNIT_PRICE_LIMITS);
    } catch (err) {
      if (err instanceof DecimalLimitError) {
        throw new BadRequestException(`${item.name}, ${name}: the unit price after the increase is too large.`);
      }
      throw err;
    }
    return { ...line, unit_price };
  });
  const calendars = new Map(kept.flatMap(({ calendar }) => (calendar ? [[calendar.id, calendar] as const] : [])));
  let result: ColumnResult;
  try {
    result = computeColumn(lines, year, lineCalendarDays(calendars, year));
  } catch (err) {
    if (err instanceof CostingInputError) throw new BadRequestException(`${item.name}: ${err.message}`);
    throw err;
  }
  return { kind: 'lines', lines, calendars, result, issues };
}

export type CopyColumnOperation = {
  sourceYear: number;
  sourceColumn: BudgetColumn;
  destinationYear: number;
  destinationColumn: BudgetColumn;
  percentageIncrease: number | string;
  overwrite: boolean;
  dryRun: boolean;
  /** A real copy whose lines change calendar (`fallback`) or cannot be recomputed (`missing`) needs this, after the preview. */
  acceptCalendarChanges?: boolean;
};

export const CALENDAR_CHANGES_MESSAGE = (year: number) =>
  `Some lines use a calendar with no working days for ${year}. Run the preview, then confirm.`;

/**
 * Copy one column of a year to a column of a year for every item valid in
 * the destination year: the twelve months keep their shape (see
 * `copiedMonths`), the destination column's record takes the source period
 * shifted to the destination year (whole year when the source has none) and
 * says where the column was copied from. Every column is treated alike.
 *
 * An item valid for part of the destination year is prorated: the source
 * months outside its validity become zero before the uplift, so they stay
 * zero and the rounding only moves the months kept. The other months keep
 * their amount (an annual fee billed in January stays whole), and the period
 * is cut to the validity window.
 *
 * A source column that follows its quantity × price lines (`followsLines`) is
 * copied from them instead (`planLinesCopy`): the unit prices take the
 * uplift, the months are computed again with the destination year's
 * calendars, and the column is stored like a lines write (`computed`). Lines
 * that are only a reference travel with the months × uplift, their prices
 * untouched, through the same plan: shifted, cut to the validity, computed
 * with the destination year's calendars; the record keeps what they give
 * (`lines_result`) and its FTE comes from them. A real copy where a line
 * changes calendar or cannot be computed (`CalendarIssue`) is refused unless
 * `acceptCalendarChanges` is set; every item is decided first, then written.
 */
export async function copyBudgetColumn(
  deps: BudgetOperationDeps,
  scope: AmountScope,
  operation: CopyColumnOperation,
  userId: string | null,
) {
  const mg = deps.manager;
  const sourceYear = budgetYear(operation?.sourceYear, 'sourceYear');
  const destinationYear = budgetYear(operation?.destinationYear, 'destinationYear');
  const sourceColumn = budgetColumn(operation?.sourceColumn, 'sourceColumn');
  const destinationColumn = budgetColumn(operation?.destinationColumn, 'destinationColumn');
  const pct = upliftPct(operation?.percentageIncrease);
  const overwrite = Boolean(operation?.overwrite);
  const dryRun = Boolean(operation?.dryRun);
  if (sourceYear === destinationYear && sourceColumn === destinationColumn) {
    throw new BadRequestException('A column cannot be copied onto itself: choose another year or column.');
  }
  const sourceMeasure = BUDGET_COLUMN_MEASURE[sourceColumn];
  const destinationMeasure = BUDGET_COLUMN_MEASURE[destinationColumn];

  await deps.freeze.assertNotFrozen(
    { scope, column: MEASURE_FREEZE_COLUMN[destinationMeasure], year: destinationYear, action: 'Copy' },
    { manager: mg },
  );
  // Freeze is checked once for the whole operation, not once per item.
  const checkedFreeze = new Set<string>();

  const tenantId = await currentTenantId(mg);
  // One bulk budget operation at a time per tenant: a second one gets a 409 (`budget-locks.ts`).
  if (!dryRun) await lockTenantBudgetOperations(mg, tenantId);
  let items = await loadItemsValidIn(mg, scope, tenantId, destinationYear);
  let versions = await loadVersions(mg, scope, tenantId, items.map((i) => i.id), [sourceYear, destinationYear]);
  if (!dryRun) {
    // Lock order: the lines with a source version, in id order, then their destination versions,
    // before anything is decided. Lines, validity, versions, months and records are read again
    // under the locks; a line without a source version in the first read stays skipped.
    const locked = await lockBudgetLines(mg, scope, tenantId, items.filter((i) => versions.has(`${i.id}:${sourceYear}`)).map((i) => i.id));
    items = await loadItemsValidIn(mg, scope, tenantId, destinationYear);
    versions = await loadVersions(mg, scope, tenantId, items.filter((i) => locked.has(i.id)).map((i) => i.id), [sourceYear, destinationYear]);
    await lockBudgetVersions(mg, scope, tenantId, Array.from(versions.values()).filter((v) => v.budget_year === destinationYear).map((v) => v.id));
  }
  const allVersions = Array.from(versions.values());
  const months = await readVersionMonths(mg, scope, tenantId, allVersions);
  const records = await listRoundInputs(mg, scope, tenantId, allVersions.map((v) => v.id));
  const pctText = pct.toString();
  const sourceRecordOf = (version: BudgetVersionRow) => records.get(version.id)?.find((r) => r.measure === sourceMeasure);

  // Sources with lines (followed or a reference): their calendars and the company standard
  // calendars, read once, after the version locks and before any months (`budget-locks.ts`).
  const linesSources = items.flatMap((item) => {
    const version = versions.get(`${item.id}:${sourceYear}`);
    const record = version ? sourceRecordOf(version) : undefined;
    return record && record.lines.length > 0 ? [{ itemId: item.id, record }] : [];
  });
  const copyCalendars = await loadCopyCalendars(
    mg,
    scope,
    tenantId,
    linesSources.map((s) => s.itemId),
    linesSources.flatMap((s) => s.record.lines.flatMap((l) => (l.working_day_profile_id ? [l.working_day_profile_id] : []))),
    !dryRun,
  );

  // Plan: every item is decided before anything is written, so a refusal writes nothing.
  type Planned = {
    item: (typeof items)[number];
    sourceVersion: BudgetVersionRow;
    sourceRecord: RoundInput | undefined;
    sourceTotal: bigint;
    currentTotal: bigint;
    target: bigint[];
    targetTotal: bigint;
    prorated: boolean;
    lines: Extract<LinesCopy, { kind: 'lines' }> | null;
    /** Lines that are only a reference, planned for the destination year; null: none, or copied the old way. */
    reference: Exclude<LinesCopy, { kind: 'reference' }> | null;
    issues: CalendarIssue[];
  };
  const plans: Planned[] = [];
  const results = [];
  let processed = 0;
  let skipped = 0;

  for (const item of items) {
    const sourceVersion = versions.get(`${item.id}:${sourceYear}`);
    if (!sourceVersion) {
      skipped++;
      continue;
    }
    const fullSource = months.get(sourceVersion.id)!.months[sourceMeasure];
    // Months outside the item's validity in the destination year are not copied.
    const valid = (index: number) => item.validity.months.includes(index + 1);
    const source = fullSource.map((v, i) => (valid(i) ? v : 0n));
    const prorated = fullSource.some((v, i) => v !== 0n && !valid(i));
    const destinationVersion = versions.get(`${item.id}:${destinationYear}`);
    const current = destinationVersion ? months.get(destinationVersion.id)!.months[destinationMeasure] : [];
    const sourceTotal = sum(fullSource);
    const currentTotal = sum(current);
    const sourceRecord = sourceRecordOf(sourceVersion);
    let skip = source.every((v) => v === 0n) || (!overwrite && current.some((v) => v !== 0n));
    // A source that follows its lines is copied from them, its prices raised; else its months are,
    // and lines that are only a reference are planned the same way, their prices as they are.
    const follows = followsLines(sourceRecord);
    const linesCopy = !skip && sourceRecord && sourceRecord.lines.length > 0
      ? planLinesCopy(item, sourceRecord, destinationYear, follows ? pct : Decimal.ZERO, copyCalendars)
      : null;
    if (follows && linesCopy?.kind === 'empty') skip = true;
    const fromLines = follows && linesCopy?.kind === 'lines' ? linesCopy : null;
    const reference = !follows && linesCopy && linesCopy.kind !== 'reference' ? linesCopy : null;
    const issues = linesCopy && linesCopy.kind !== 'empty' ? linesCopy.issues : [];
    const target = fromLines ? fromLines.result.month_cents : copiedMonths(source, pct);
    const targetTotal = sum(target);

    results.push({
      itemId: item.id,
      itemName: item.name,
      sourceValue: toNumber(sourceTotal),
      currentDestinationValue: toNumber(currentTotal),
      newValue: toNumber(skip ? currentTotal : targetTotal),
      skipped: skip,
      prorated,
      fromLines: !skip && !!fromLines,
      calendarIssues: skip ? [] : issues,
    });
    if (skip) {
      skipped++;
      continue;
    }
    plans.push({ item, sourceVersion, sourceRecord, sourceTotal, currentTotal, target, targetTotal, prorated, lines: fromLines, reference, issues });
  }

  if (dryRun) {
    return {
      success: true,
      dryRun,
      summary: { totalItems: items.length, processed: plans.length, skipped, errors: 0 },
      results,
    };
  }
  // A calendar replaced or missing changes what the lines give: the user confirms it after the preview.
  const calendarChanges = plans.some((p) => p.issues.some((issue) => issue.kind !== 'disabled'));
  if (calendarChanges && operation?.acceptCalendarChanges !== true) {
    throw new BadRequestException(CALENDAR_CHANGES_MESSAGE(destinationYear));
  }

  for (const plan of plans) {
    const { item, sourceVersion, sourceRecord, sourceTotal, currentTotal, target, targetTotal, prorated, lines, reference, issues } = plan;
    let destinationVersion = versions.get(`${item.id}:${destinationYear}`);
    if (!destinationVersion) {
      const ensured = await createBudgetVersion(
        deps,
        scope,
        { itemId: item.id, tenantId: item.tenant_id, year: destinationYear, name: `Y${destinationYear}`, inputGrain: sourceVersion.input_grain ?? 'annual' },
        userId,
      );
      destinationVersion = ensured.version;
      if (!ensured.created && !overwrite) {
        // Defensive, kept on purpose (lot 3A; 3B review). The versions were read
        // again under this line's lock, held since then, and every app path that
        // creates a version takes that lock first (`budget-locks.ts`), so none can
        // have created this one meanwhile. A writer outside the lock order still
        // can: an INSERT of a version takes only FOR KEY SHARE on its line (the
        // foreign key), which our FOR NO KEY UPDATE does not block (a raw SQL
        // write, a tenant import, a future path). If one did, decide again on its
        // months, read under the lock every amounts write takes: a column with
        // amounts is kept, as for a destination that had them from the start.
        await lockYearMonths({ manager: mg, scope, version: destinationVersion }, destinationYear);
        const locked = (await readVersionMonths(mg, scope, tenantId, [destinationVersion])).get(destinationVersion.id)!;
        if (locked.months[destinationMeasure].some((v) => v !== 0n)) {
          skipped++;
          continue;
        }
      }
    }

    // Replace the destination measure only; the other measures keep their months.
    await replaceAmounts(
      { manager: mg, freeze: deps.freeze, scope, version: destinationVersion, checkedFreeze },
      destinationYear,
      yearPeriods(destinationYear).map((period, i) => ({ period, [destinationMeasure]: target[i] })),
    );

    const rctx: RoundInputsContext = { manager: mg, scope, version: destinationVersion, userId, audit: deps.audit };
    if (lines) {
      // Stored like a lines write: the record follows the new lines (computed, FTE from them).
      await upsertRoundInput(rctx, destinationMeasure, linesRound(lines.lines, lines.calendars, lines.result), lines.lines);
    } else {
      const copiedPeriod = sourceRecord ? shiftPeriod(sourceRecord, destinationYear - sourceYear) : wholeYear(destinationYear);
      // A copy replaces the whole destination column, lines included. Lines
      // that are only a reference travel as planned for the destination year
      // (the uplift applies to the months only), with what they give there
      // and their FTE from it; none left within the validity, none. Copied
      // the old way (a calendar without days and no replacement), they travel
      // as they are with the source's FTE. A source without lines leaves none.
      const planned = reference?.kind === 'lines' ? reference : null;
      await upsertRoundInput(
        rctx,
        destinationMeasure,
        {
          ...periodWithinValidity(copiedPeriod, item.validity),
          method: 'copied',
          spread_profile_name: sourceRecord?.spread_profile_name ?? null,
          last_calculation: {
            kind: 'copy',
            source_year: sourceYear,
            source_measure: sourceMeasure,
            uplift_pct: pctText,
            source_total: centsToDecimal(sourceTotal),
            total: centsToDecimal(targetTotal),
            source_method: sourceRecord?.method ?? null,
            ...(planned ? { lines_result: linesResult(planned.lines, planned.calendars, planned.result) } : {}),
          },
          fte: planned ? planned.result.fte : reference ? null : sourceRecord?.lines.length ? sourceRecord.fte : null,
        },
        planned ? planned.lines : reference ? [] : shiftLines(sourceRecord, destinationYear),
      );
    }

    await deps.audit.log(
      {
        table: auditTableOf(scope, SCOPES[scope].items),
        recordId: item.id,
        action: 'update',
        before: { [destinationColumn]: toNumber(currentTotal) },
        after: {
          [destinationColumn]: toNumber(targetTotal),
          operation: 'budget_column_copy',
          sourceYear,
          sourceColumn,
          destinationYear,
          destinationColumn,
          percentageIncrease: pctText,
          ...(prorated ? { prorated: true } : {}),
          // The record now reads as computed from lines: the copy origin stays here.
          ...(lines ? { from_lines: true } : {}),
          ...(issues.length > 0 ? { calendar_issues: issues } : {}),
        },
        userId,
      },
      { manager: mg },
    );
    processed++;
  }

  return {
    success: true,
    dryRun,
    summary: { totalItems: items.length, processed, skipped, errors: 0 },
    results: [],
  };
}

/**
 * Clear one column of a year for every item, ended or not (amounts hidden
 * behind an end of validity are cleared too): its twelve months become zero
 * and its record (period, provenance, lines) is deleted. A version whose
 * column is already all zero is skipped, but its record is deleted too.
 */
export async function clearBudgetColumn(
  deps: BudgetOperationDeps,
  scope: AmountScope,
  operation: { year: number; column: BudgetColumn },
  userId: string | null,
) {
  const mg = deps.manager;
  const year = budgetYear(operation?.year, 'year');
  const column = budgetColumn(operation?.column, 'column');
  const measure: AmountMeasure = BUDGET_COLUMN_MEASURE[column];

  await deps.freeze.assertNotFrozen(
    { scope, column: MEASURE_FREEZE_COLUMN[measure], year, action: 'Clear' },
    { manager: mg },
  );
  // Freeze is checked once for the whole operation, not once per item.
  const checkedFreeze = new Set<string>();

  const tenantId = await currentTenantId(mg);
  // One bulk budget operation at a time per tenant: a second one gets a 409 (`budget-locks.ts`).
  await lockTenantBudgetOperations(mg, tenantId);
  const items = await loadItems(mg, scope, tenantId);
  // Lock order: the lines with a version of the year, in id order, then those versions, before
  // anything is decided; versions, months and records are read again under the locks.
  const first = await loadVersions(mg, scope, tenantId, items.map((i) => i.id), [year]);
  const locked = await lockBudgetLines(mg, scope, tenantId, items.filter((i) => first.has(`${i.id}:${year}`)).map((i) => i.id));
  const versions = await loadVersions(mg, scope, tenantId, items.filter((i) => locked.has(i.id)).map((i) => i.id), [year]);
  await lockBudgetVersions(mg, scope, tenantId, Array.from(versions.values()).map((v) => v.id));
  const allVersions = Array.from(versions.values());
  const months = await readVersionMonths(mg, scope, tenantId, allVersions);
  const records = await listRoundInputs(mg, scope, tenantId, allVersions.map((v) => v.id));

  let cleared = 0;
  let skipped = 0;

  for (const item of items) {
    const version = versions.get(`${item.id}:${year}`);
    if (!version) {
      skipped++;
      continue;
    }
    const rctx: RoundInputsContext = { manager: mg, scope, version, userId, audit: deps.audit };
    const hasRecord = records.get(version.id)?.some((r) => r.measure === measure) ?? false;
    const current = months.get(version.id)!.months[measure];
    if (!current.some((v) => v !== 0n)) {
      // Months before records (lock order, `budget-locks.ts`), even when only the record goes.
      if (hasRecord) {
        await lockStoredMonths({ manager: mg, scope, version }, year);
        await deleteRoundInput(rctx, measure);
        // The record and its lines went: the line says who cleared the column, as below (lot 3G:
        // the line's meta names who changed its budget from this row).
        await deps.audit.log(
          {
            table: auditTableOf(scope, SCOPES[scope].items),
            recordId: item.id,
            action: 'update',
            before: { [column]: 0 },
            after: { [column]: 0, operation: 'budget_column_clear', year, column },
            userId,
          },
          { manager: mg },
        );
      }
      skipped++;
      continue;
    }

    // Zero, not NULL: the twelve months of this measure only.
    await replaceAmounts(
      { manager: mg, freeze: deps.freeze, scope, version, checkedFreeze },
      year,
      yearPeriods(year).map((period) => ({ period, [measure]: 0n })),
    );
    if (hasRecord) await deleteRoundInput(rctx, measure);

    await deps.audit.log(
      {
        table: auditTableOf(scope, SCOPES[scope].items),
        recordId: item.id,
        action: 'update',
        before: { [column]: toNumber(sum(current)) },
        after: { [column]: 0, operation: 'budget_column_clear', year, column },
        userId,
      },
      { manager: mg },
    );
    cleared++;
  }

  return {
    success: true,
    summary: { totalItems: items.length, cleared, skipped, errors: 0 },
  };
}
