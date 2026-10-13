import { EntityManager } from 'typeorm';
import { parsePagination } from '../../../common/pagination';
import { extractStatusFilterFromAgModel } from '../../../common/status-filter';
import { applyDisabledAtWhere, LifecycleScope, StatusState } from '../../../common/status';
import { normalizeAgFilterModel } from '../../../common/ag-grid-filtering';
import { formatCents } from '../../../common/amount';
import { Decimal } from '../../../common/decimal';
import { analyticsFieldKey, parseAnalyticsFieldKey } from '../../../analytics/analytics-axes.util';
import {
  buildBudgetSummaryRows,
  BudgetSummaryRow,
  FIXED_SLOTS,
  loadVersionTotals,
  parseSummaryYears,
  PROJECT_LIST_FIELDS,
  resolveAmountField,
  resolveFteField,
  SUMMARY_COLUMNS,
  SummaryDeps,
  SummaryScopeConfig,
  versionFte,
  versionWithinValidity,
  yearsNamedByFields,
} from '../../spend-summary.builder';
import { getSummaryFieldValue, summaryFieldValues } from './summary-field-value.oracle';

/**
 * THE ORACLE of the SQL list engine (lot 2B, PRs A and C): the in-memory list
 * engine of `budget-summary.ts` + `spend-summary.builder.ts` as it was before
 * the engine (both gone from the runtime since PR C), uncapped, with every
 * column filter evaluated in memory (no SQL fast path), the items read newest
 * first (`created_at DESC, id DESC`), every row built by the unchanged
 * builder, then filtered, searched and sorted. One oracle for OPEX and CAPEX,
 * like the engine (the scope config).
 *
 * The functions below are copies of the former `rowPassesFilter`,
 * `quickSearchSummaryRows`, `sortSummaryRows` (with the former
 * `FIXED_SORT_ORDERS`), `summaryFilterValues` and `summaryTotals`. They differ
 * from them ONLY by these adapters, each marked `ADAPTER` where it applies;
 * every other line is the former behaviour:
 *
 *  A1 (design 2.13-4) every condition of a combined model applies, joined
 *     by its operator (today: the first condition only).
 *  A2 (Q1) text sorts in the natural ICU order (root collation, then code
 *     points), one rule for every field (today: lowercase, UTF-16 order);
 *     filter values in the same order.
 *  A3 (Q2) the quick search and the six text operators fold accents and
 *     case (`unaccent`, then lowercase); the raw status code leaves the
 *     quick search bag.
 *  A4 (Q3) a set model in exclude mode keeps every value but the listed
 *     ones.
 *  A5 (engine decision) a number model only applies to number fields and a
 *     date model to date fields; elsewhere it matches no line (today: a
 *     number model parsed text with `Number()`, a date model parsed any
 *     string with `Date`).
 *  A6 (design 2.13-5) no cap.
 *  A7 (lot C1, decision 2) a dimension's values (`analytics_<axis id>`, and
 *     the default dimension's `analytics_category_name`) sort by their
 *     position in the dimension, then by name (before: by name); their filter
 *     values follow the same order (D3). The CAPEX priority, investment type
 *     and PP&E type, enums ranked in their business order until lot C1, are
 *     dimensions since.
 *
 * The 10,000-line cap, the `capped` flag and the SQL fast path are gone (A6);
 * the deterministic tie-breaks of the latest task and contract (2.13-3) live
 * in the builder, shared by both engines.
 */

export type OracleFold = (text: string) => string;

/**
 * The fields of a CAPEX line as the CAPEX list showed them before lot Z1: the former `CapexItem`
 * entity, in its order, without the PP&E type, investment type and priority (dimensions since lot C1).
 */
const CAPEX_LINE_FIELDS = [
  'id', 'tenant_id', 'item_number', 'paying_company_id', 'account_id', 'supplier_id', 'description',
  'currency', 'effective_start', 'status', 'disabled_at', 'project_id', 'owner_it_id', 'owner_business_id',
  'cost_center_id', 'run_build', 'notes', 'created_at', 'updated_at', 'row_version',
];

/**
 * A dimension value's position in its dimension (ADAPTER A7), for the dimension fields of a list:
 * `applies(field)` says whether the field reads a dimension, `of(field, value)` the position of a
 * value of it. Read once per oracle from the tenant's values, apart from the engine.
 */
export interface ValuePositions {
  applies(field: string): boolean;
  of(field: string, value: string): number | null;
}

export async function loadValuePositions(manager: EntityManager, tenantId: string): Promise<ValuePositions> {
  const rows: Array<{ axis: string; name: string; sort_order: number }> = await manager.query(
    `SELECT axis_id::text AS axis, name, sort_order FROM analytics_categories WHERE tenant_id = $1`,
    [tenantId],
  );
  const [defaultAxis]: Array<{ id: string }> = await manager.query(
    `SELECT id::text AS id FROM analytics_axes WHERE tenant_id = $1 AND is_default`,
    [tenantId],
  );
  const positions = new Map(rows.map((row) => [`${row.axis}\u0000${row.name}`, Number(row.sort_order)]));
  const axisOf = (field: string) => parseAnalyticsFieldKey(field) ?? (field === 'analytics_category_name' ? defaultAxis?.id ?? null : null);
  return {
    applies: (field) => axisOf(field) != null,
    of: (field, value) => {
      const axis = axisOf(field);
      return axis == null ? null : positions.get(`${axis}\u0000${value}`) ?? null;
    },
  };
}

/**
 * A line of `spend_items` (both natures since lot Z1) as its list shows it, written here apart
 * from the engine's presentation: an OPEX line as read; a CAPEX line in the former `CapexItem`
 * shape, its title (`product_name`) as `description` and its CPX number (`legacy_number`) as
 * `item_number`. Both get `reference`, `BL-` and the line's own number.
 */
function oracleLine(nature: 'opex' | 'capex', item: Record<string, any>): Record<string, any> {
  const reference = `BL-${item.item_number}`;
  if (nature === 'opex') return { ...item, reference };
  const cpx = /^CPX-(\d+)$/.exec(item.legacy_number ?? '');
  const shown: Record<string, any> = { ...item, item_number: cpx ? Number(cpx[1]) : item.item_number, description: item.product_name };
  return { ...Object.fromEntries(CAPEX_LINE_FIELDS.map((field) => [field, shown[field]])), reference };
}

/** The oracle's own declaration of number and date fields (A5); the engine has its own in its config. */
function isNumberField(field: string): boolean {
  return !!resolveAmountField(field) || !!resolveFteField(field) || field === 'item_number' || field === 'account_number';
}
function isDateField(field: string): boolean {
  return ['effective_start', 'created_at', 'updated_at', 'disabled_at'].includes(field);
}

// ADAPTER A2: the natural order, written independently of the engine's helper.
const collator = new Intl.Collator('en-US');
function codePoints(text: string): number[] {
  return Array.from(text, (char) => char.codePointAt(0)!);
}
export function oracleTextCompare(a: string, b: string): number {
  const byCollation = collator.compare(a, b);
  if (byCollation !== 0 || a === b) return byCollation;
  const ca = codePoints(a);
  const cb = codePoints(b);
  for (let i = 0; i < Math.min(ca.length, cb.length); i += 1) if (ca[i] !== cb[i]) return ca[i] < cb[i] ? -1 : 1;
  return ca.length === cb.length ? 0 : ca.length < cb.length ? -1 : 1;
}

interface OracleContext {
  tenantId: string;
  currentYear: number;
  requestedYears: number[];
  years: number[];
  page: number;
  limit: number;
  skip: number;
  sort: { field: string; direction: 'ASC' | 'DESC' };
  q?: string;
  filters: Record<string, any>;
  explicitStatus?: StatusState;
  matchNone: boolean;
  includeDisabled: boolean;
  memoryFilters: Record<string, any>;
}

export class BudgetSummaryOracle {
  private readonly rowsCache = new Map<string, Promise<BudgetSummaryRow[]>>();
  private positions: Promise<ValuePositions> | null = null;

  /** ADAPTER A7: the positions of the tenant's dimension values, read once. */
  private valuePositions(): Promise<ValuePositions> {
    this.positions ??= loadValuePositions(this.manager, this.tenantId);
    return this.positions;
  }

  constructor(
    private readonly config: SummaryScopeConfig,
    private readonly deps: SummaryDeps,
    private readonly manager: EntityManager,
    private readonly tenantId: string,
    private readonly fold: OracleFold,
    private readonly rowOptions: { includeRecipientDetails?: boolean; includeNextYearAllocation?: boolean } = {},
  ) {}

  private context(query: any): OracleContext {
    const currentYear = new Date().getFullYear();
    const { page, limit, skip, sort, status, q, filters } = parsePagination(query ?? {});
    const { status: statusFromAg, matchNone, sanitizedFilters } = extractStatusFilterFromAgModel(filters);
    const cleanFilters: Record<string, any> = (sanitizedFilters ?? filters ?? {}) as Record<string, any>;
    const requestedYears = parseSummaryYears(query?.years);
    const namedYears = yearsNamedByFields([sort.field, ...Object.keys(cleanFilters)]);
    // Own properties whatever the key (`memoryFilters['__proto__'] = model` would set the prototype instead).
    const memoryFilters: Record<string, any> = Object.fromEntries(Object.entries(cleanFilters).filter(([field]) => field !== 'disabled_at'));
    return {
      tenantId: this.tenantId,
      currentYear,
      requestedYears,
      years: Array.from(new Set([...FIXED_SLOTS.map((slot) => currentYear + slot.offset), ...requestedYears, ...namedYears])),
      page,
      limit,
      skip,
      sort,
      q: q?.trim() || undefined,
      filters: cleanFilters,
      explicitStatus: status ?? statusFromAg,
      matchNone: matchNone === true,
      includeDisabled: ['1', 'true'].includes(String(query?.includeDisabled ?? '').toLowerCase()),
      memoryFilters,
    };
  }

  /** Enabled: no end of validity or one on or after January 1 of the current year (UTC); Disabled: one before it. */
  private lifecycleScope(ctx: OracleContext, fallback: LifecycleScope): LifecycleScope {
    const yearStart = new Date(`${ctx.currentYear}-01-01T00:00:00.000Z`);
    if (ctx.matchNone) return 'none';
    if (ctx.explicitStatus === StatusState.DISABLED) return { endedBefore: yearStart };
    if (ctx.explicitStatus === StatusState.ENABLED) return { activeSince: yearStart };
    if (ctx.includeDisabled) return null;
    return fallback === 'active' ? { activeSince: yearStart } : fallback;
  }

  private windowScope(ctx: OracleContext): LifecycleScope {
    const first = ctx.requestedYears.length ? Math.min(...ctx.requestedYears) : ctx.currentYear - 1;
    return { activeSince: new Date(`${first}-01-01T00:00:00.000Z`) };
  }

  /** Every row the scope selects (no cap, A6), built once per scope and years. */
  private rows(ctx: OracleContext, scope: LifecycleScope): Promise<BudgetSummaryRow[]> {
    const key = JSON.stringify({ scope, eov: ctx.filters.disabled_at ?? null, years: [...ctx.years].sort() });
    let rows = this.rowsCache.get(key);
    if (!rows) {
      rows = (async () => {
        // Lot Z1: the scope's own nature of `spend_items`; a CAPEX line also reads the columns the entity never selects.
        const nature = this.config.scope;
        const where: Record<string, any> = { tenant_id: ctx.tenantId, nature };
        applyDisabledAtWhere(where, scope, ctx.filters);
        const repository = this.manager.getRepository<any>(this.config.itemEntity as any);
        const select = nature === 'capex' ? repository.metadata.columns.map((column) => column.propertyName) : undefined;
        const found = await repository.find({ where, select, order: { created_at: 'DESC', id: 'DESC' } });
        const items = found.map((item: Record<string, any>) => oracleLine(nature, item));
        return buildBudgetSummaryRows(this.config, this.deps, this.manager, ctx.tenantId, items, {
          years: ctx.years,
          currentYear: ctx.currentYear,
          includeLatestTask: true,
          ...this.rowOptions,
        });
      })();
      this.rowsCache.set(key, rows);
    }
    return rows;
  }

  private async listed(ctx: OracleContext, scope: LifecycleScope): Promise<BudgetSummaryRow[]> {
    let rows = [...(await this.rows(ctx, scope))];
    rows = this.applyFilters(rows, ctx.memoryFilters);
    if (ctx.q) rows = this.quickSearch(rows, ctx.q);
    return sortRows(rows, ctx.sort.field, ctx.sort.direction, await this.valuePositions());
  }

  async summary(query: any): Promise<{ items: BudgetSummaryRow[]; total: number; page: number; limit: number; ids: string[] }> {
    const ctx = this.context(query);
    const rows = await this.listed(ctx, this.lifecycleScope(ctx, this.windowScope(ctx)));
    return { items: rows.slice(ctx.skip, ctx.skip + ctx.limit), total: rows.length, page: ctx.page, limit: ctx.limit, ids: rows.map((row) => row.id) };
  }

  async summaryIds(query: any): Promise<{ ids: string[]; item_numbers: number[]; total: number }> {
    const ctx = this.context(query);
    const rows = await this.listed(ctx, this.lifecycleScope(ctx, 'active'));
    return { ids: rows.map((row) => row.id), item_numbers: rows.map((row) => row.item_number), total: rows.length };
  }

  async summaryFilterValues(query: any, allowedFields: string[]): Promise<Record<string, Array<string | null>>> {
    const allowed = new Set([...allowedFields, ...this.config.extraFields]);
    const requested: string[] = typeof query?.fields === 'string'
      ? query.fields.split(',').map((field: string) => field.trim()).filter(Boolean)
      : [];
    const fields = requested.filter((field) => allowed.has(field) || parseAnalyticsFieldKey(field) != null);
    if (fields.length === 0) return {};
    const ctx = this.context(query);
    let rows = [...(await this.rows(ctx, this.lifecycleScope(ctx, this.windowScope(ctx))))];
    if (ctx.q) rows = this.quickSearch(rows, ctx.q);
    const result: Record<string, Array<string | null>> = {};
    const positions = await this.valuePositions();
    for (const field of fields) {
      const others = { ...ctx.memoryFilters };
      delete others[field];
      const values = new Set<string | null>();
      for (const row of this.applyFilters(rows, others)) {
        const rowValues = summaryFieldValues(row, field);
        if (rowValues.length === 0) values.add(null);
        for (const value of rowValues) values.add(value == null || value === '' ? null : String(value));
      }
      result[field] = Array.from(values).sort((a, b) => {
        if (a === b) return 0;
        if (a == null) return 1;
        if (b == null) return -1;
        // ADAPTER A7: a dimension's values in its order first.
        const pa = positions.of(field, a);
        const pb = positions.of(field, b);
        if (pa != null && pb != null && pa !== pb) return pa - pb;
        return oracleTextCompare(a, b); // ADAPTER A2
      });
    }
    return result;
  }

  async summaryTotals(query: any): Promise<Record<string, any>> {
    const { ids } = await this.summaryIds(query);
    const currentYear = new Date().getFullYear();
    const slots = [
      ...FIXED_SLOTS.map((slot) => ({ key: slot.key as string, year: currentYear + slot.offset })),
      ...parseSummaryYears(query?.years).map((year) => ({ key: `y${year}`, year })),
    ];
    const fteKeys = parseFteKeys(query?.fte, currentYear);
    const sums = new Map<string, bigint>();
    for (const slot of slots) for (const column of SUMMARY_COLUMNS) sums.set(`${slot.key}${column.suffix}`, 0n);
    const items = ids.length
      ? await this.manager.getRepository<any>(this.config.itemEntity as any)
        .createQueryBuilder('i')
        .where('i.tenant_id = :tenantId AND i.nature = :nature', { tenantId: this.tenantId, nature: this.config.scope })
        .andWhere('i.id = ANY(:ids)', { ids })
        .getMany()
      : [];
    const years = Array.from(new Set([...slots.map((slot) => slot.year), ...fteKeys.map((fte) => fte.year)]));
    const totals = await loadVersionTotals(this.config, this.deps, this.manager, this.tenantId, items, years, { reporting: true, fte: fteKeys.length > 0 });
    for (const item of items) {
      const perYear = totals.versionsByItemYear.get(item.id);
      for (const slot of slots) {
        const version = versionWithinValidity(perYear, slot.year, item.disabled_at);
        const cents = version ? totals.reporting.get(version.id)?.cents : undefined;
        if (!cents) continue;
        for (const column of SUMMARY_COLUMNS) {
          const key = `${slot.key}${column.suffix}`;
          sums.set(key, sums.get(key)! + cents[column.key]);
        }
      }
    }
    const amounts: Record<string, any> = {
      ...Object.fromEntries(Array.from(sums.entries()).map(([key, cents]) => [key, Number(formatCents(cents))])),
      reportingCurrency: totals.reportingCurrency,
    };
    if (!fteKeys.length) return amounts;
    const fte: Record<string, { total: number | null; unknown: number }> = {};
    for (const { key, year, measure } of fteKeys) {
      let sum = Decimal.ZERO;
      let unknown = 0;
      for (const item of items) {
        const value = versionFte(totals, versionWithinValidity(totals.versionsByItemYear.get(item.id), year, item.disabled_at), measure);
        if (value == null) unknown += 1;
        else sum = sum.add(value);
      }
      fte[key] = { total: unknown < items.length ? Number(sum.toString()) : null, unknown };
    }
    return Object.assign(amounts, { fte });
  }

  // ----- in-memory filters (the former `applyAgFiltersInMemory` / `rowPassesFilter`) -----

  applyFilters<T extends Record<string, any>>(rows: T[], filterModel: Record<string, any>): T[] {
    const entries = Object.entries(filterModel ?? {});
    if (!entries.length) return rows;
    return rows.filter((row) => entries.every(([field, model]) => this.rowPasses(row, field, model)));
  }

  private rowPasses(row: any, field: string, rawModel: any): boolean {
    // ADAPTER A1: every condition of a combined model.
    if (rawModel && typeof rawModel === 'object' && rawModel.operator && Array.isArray(rawModel.conditions) && rawModel.conditions.length > 0) {
      const results = rawModel.conditions.map((condition: any) => this.rowPassesOne(row, field, condition));
      return rawModel.operator === 'OR' ? results.some(Boolean) : results.every(Boolean);
    }
    return this.rowPassesOne(row, field, rawModel);
  }

  private rowPassesOne(row: any, field: string, rawModel: any): boolean {
    const model = normalizeAgFilterModel(rawModel);
    if (!model || typeof model !== 'object') return true;
    const type = String(model.type ?? model.filterType ?? 'contains');
    const rowVal = getSummaryFieldValue(row, field);
    const blank = rowVal == null || String(rowVal) === '';

    if (type === 'set' && Array.isArray(model.values)) {
      const rawValues: any[] = model.values;
      const values = rawValues.filter((v) => v !== null && v !== undefined && v !== '').map((v) => String(v));
      const hasNull = values.length < rawValues.length;
      // ADAPTER A4: exclude mode.
      if (model.mode === 'exclude') {
        if (blank) return !hasNull;
        if (PROJECT_LIST_FIELDS.includes(field)) return (summaryFieldValues(row, field) as string[]).some((name) => !values.includes(String(name)));
        return !values.includes(String(rowVal ?? ''));
      }
      if (rawValues.length === 0) return false;
      if (hasNull && blank) return true;
      const candidates = PROJECT_LIST_FIELDS.includes(field)
        ? [...(summaryFieldValues(row, field) as string[]).map(String), String(rowVal ?? '')]
        : [String(rowVal ?? '')];
      return candidates.some((candidate) => values.includes(candidate));
    }
    if (type === 'blank') return blank;
    if (type === 'notBlank') return !blank;

    if ((model.filterType === 'date' || model.dateFrom || model.dateTo) && COMPARISON_TYPES.has(type)) {
      if (!isDateField(field)) return false; // ADAPTER A5
      const day = parseDay(rowVal);
      const from = parseDay(model.dateFrom ?? model.filter ?? model.value);
      const to = parseDay(model.dateTo ?? model.filterTo ?? model.valueTo);
      if (day == null || from == null) return false;
      return compare(type, day, from, to ?? undefined);
    }

    const valRaw = model.filter ?? model.value ?? (Array.isArray(model.values) ? model.values[0] : undefined);
    if (valRaw == null || valRaw === '') return true;
    const needle = String(valRaw);

    const numericModel = model.filterType === 'number' || (typeof rowVal === 'number' && !Number.isNaN(Number(needle)));
    if (numericModel && COMPARISON_TYPES.has(type)) {
      if (!isNumberField(field)) return false; // ADAPTER A5
      if (blank || !Number.isFinite(Number(rowVal)) || !Number.isFinite(Number(needle))) return false;
      return compare(type, Number(rowVal), Number(needle), Number(model.filterTo ?? model.valueTo));
    }

    // ADAPTER A3: fold accents and case on both sides (today: `toLowerCase()` of `valueToString`).
    const lowerNeedle = this.fold(needle);
    if (field === 'item_number' && !blank) {
      const candidates = [this.fold(valueText(rowVal)), this.fold(`${this.config.refPrefix}-${valueText(rowVal)}`)];
      return NEGATIVE_TEXT_TYPES.has(type)
        ? candidates.every((candidate) => textMatches(type, candidate, lowerNeedle))
        : candidates.some((candidate) => textMatches(type, candidate, lowerNeedle));
    }
    return textMatches(type, this.fold(valueText(rowVal)), lowerNeedle);
  }

  // ----- quick search (the former `quickSearchSummaryRows`) -----

  quickSearch<T extends Record<string, any>>(rows: T[], q: string): T[] {
    if (!q) return rows;
    const config = this.config;
    const needle = this.fold(String(q)); // ADAPTER A3
    const take = (value: any) => this.fold(value == null ? '' : String(value)); // ADAPTER A3
    return rows.filter((row: any) => {
      const bag: string[] = [];
      if (row.item_number != null) {
        bag.push(take(row.item_number), take(`${config.refPrefix}-${row.item_number}`));
      }
      for (const value of [
        row[config.nameField], row.description, row.supplier_name ?? row.supplier?.name, row.paying_company_name ?? row.company_name,
        row.account_display, row.account_name, row.account_number, row.project_name, row.project_stream_name, row.project_category_name,
        row.latest_contract_name, row.allocation_method_label, row.owner_it_name, row.owner_business_name, row.analytics_category_name,
        row.cost_center_code, row.cost_center_name, row.cost_center_path, row.budget_holder_name, row.notes, row.currency,
        // ADAPTER A3: `row.status` left the bag.
        ...config.extraFields.map((field) => row[field]),
      ]) {
        bag.push(take(value));
      }
      for (const axisId of Object.keys(row.analytics_value_ids ?? {})) bag.push(take(row[analyticsFieldKey(axisId)]));
      return bag.some((entry) => entry.includes(needle));
    });
  }
}

// ----- today's helpers, unchanged -----

const COMPARISON_TYPES = new Set(['equals', 'notEqual', 'lessThan', 'lessThanOrEqual', 'greaterThan', 'greaterThanOrEqual', 'inRange']);
const NEGATIVE_TEXT_TYPES = new Set(['notEqual', 'notContains']);

/** Today's `valueToString` without its lowercasing, which the fold of A3 replaces. */
function valueText(val: any): string {
  if (val == null) return '';
  if (val instanceof Date) return Number.isNaN(val.getTime()) ? '' : val.toISOString();
  return String(val);
}

function parseDay(value: any): number | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
  }
  const text = String(value);
  const day = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (day) return Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3]));
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function compare(type: string, value: number, from: number, to?: number): boolean {
  switch (type) {
    case 'equals': return value === from;
    case 'notEqual': return value !== from;
    case 'lessThan': return value < from;
    case 'lessThanOrEqual': return value <= from;
    case 'greaterThan': return value > from;
    case 'greaterThanOrEqual': return value >= from;
    case 'inRange': return to != null && Number.isFinite(to) && value >= from && value <= to;
    default: return true;
  }
}

function textMatches(type: string, value: string, needle: string): boolean {
  switch (type) {
    case 'equals': return value === needle;
    case 'notEqual': return value !== needle;
    case 'startsWith': return value.startsWith(needle);
    case 'endsWith': return value.endsWith(needle);
    case 'notContains': return !value.includes(needle);
    case 'contains':
    default:
      return value.includes(needle);
  }
}

/**
 * The former `FIXED_SORT_ORDERS` (status, run or build). Written here, not read from the builder's
 * list the engine uses, so a wrong order on either side shows as a difference.
 */
export const SORT_ORDERS: Record<string, readonly string[]> = {
  status: ['enabled', 'disabled'],
  run_build: ['run', 'build'],
};

/**
 * The former `sortSummaryRows`, text compared in the natural order (A2), status and run or build
 * ranked, a dimension's values by their position first (A7).
 */
export function sortRows<T extends Record<string, any>>(rows: T[], field: string, direction: 'ASC' | 'DESC', positions?: ValuePositions): T[] {
  const dir = direction === 'ASC' ? 1 : -1;
  const order = Object.prototype.hasOwnProperty.call(SORT_ORDERS, field) ? SORT_ORDERS[field] : undefined;
  const positioned = positions?.applies(field) ? positions : null;
  const valueOf = (row: T) => {
    const value = getSummaryFieldValue(row, field);
    if (!order) return value;
    const rank = order.indexOf(String(value));
    return rank < 0 ? null : rank;
  };
  const values = new Map(rows.map((row) => [row, valueOf(row)]));
  rows.sort((a, b) => {
    const av = values.get(a);
    const bv = values.get(b);
    const aBlank = av == null || av === '';
    const bBlank = bv == null || bv === '';
    if (aBlank && bBlank) return 0;
    if (aBlank) return dir;
    if (bBlank) return -dir;
    if (typeof av === 'number' && typeof bv === 'number') return av === bv ? 0 : (av < bv ? -1 : 1) * dir;
    if (av instanceof Date && bv instanceof Date) {
      const diff = av.getTime() - bv.getTime();
      return diff === 0 ? 0 : (diff < 0 ? -1 : 1) * dir;
    }
    if (positioned) {
      // ADAPTER A7: the position in the dimension first.
      const pa = positioned.of(field, String(av));
      const pb = positioned.of(field, String(bv));
      if (pa != null && pb != null && pa !== pb) return (pa < pb ? -1 : 1) * dir;
    }
    // ADAPTER A2: the natural order (today: `String(v).toLowerCase()` compared with `<`).
    return oracleTextCompare(String(av), String(bv)) * dir;
  });
  return rows;
}

function parseFteKeys(raw: unknown, currentYear: number): Array<{ key: string; year: number; measure: string }> {
  const parts = Array.isArray(raw) ? raw.flatMap((part) => String(part).split(',')) : typeof raw === 'string' ? raw.split(',') : [];
  const keys = new Map<string, { key: string; year: number; measure: string }>();
  for (const key of parts.map((part) => String(part).trim())) {
    const resolved = resolveFteField(key);
    if (!resolved) continue;
    const year = resolved.year ?? currentYear + FIXED_SLOTS.find((slot) => slot.key === resolved.slot)!.offset;
    keys.set(key, { key, year, measure: resolved.column.measure });
  }
  return Array.from(keys.values());
}

/**
 * The fold of A3 on the JavaScript side: each character mapped by the
 * database's own `unaccent` rules (read once, every code point it changes),
 * then `toLowerCase()`. The rules map single characters, so mapping one
 * character at a time equals `unaccent` on the whole string; the SQL fragment
 * spec checks it.
 */
export async function loadOracleFold(manager: EntityManager): Promise<OracleFold> {
  const rows: Array<{ cp: number; mapped: string }> = await manager.query(
    `SELECT cp, public.unaccent(chr(cp)) AS mapped
       FROM generate_series(1, 196607) AS cp
      WHERE (cp < 55296 OR cp > 57343) AND public.unaccent(chr(cp)) <> chr(cp)`,
  );
  const map = new Map(rows.map((row) => [String.fromCodePoint(Number(row.cp)), row.mapped]));
  return (text: string) => Array.from(text, (char) => map.get(char) ?? char).join('').toLowerCase();
}
