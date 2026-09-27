import { EntityManager, Raw } from 'typeorm';
import { parsePagination, Sort } from '../common/pagination';
import { extractStatusFilterFromAgModel } from '../common/status-filter';
import { applyDisabledAtWhere, LifecycleScope, StatusState } from '../common/status';
import { compileAgFilterCondition, createParamNameGenerator, normalizeAgFilterModel } from '../common/ag-grid-filtering';
import { formatCents } from '../common/amount';
import { parseAnalyticsFieldKey } from '../analytics/analytics-axes.util';
import {
  applyAgFiltersInMemory,
  buildBudgetSummaryRows,
  BudgetSummaryRow,
  FIXED_SLOTS,
  FIXED_SORT_ORDERS,
  loadVersionTotals,
  parseSummaryYears,
  quickSearchSummaryRows,
  sortSummaryRows,
  SUMMARY_COLUMNS,
  SummaryDeps,
  summaryFieldValues,
  SummaryScopeConfig,
  summaryTenantId,
  versionWithinValidity,
  yearsNamedByFields,
} from './spend-summary.builder';

/**
 * The list endpoints of OPEX and CAPEX (summary, ids, totals, filter values,
 * rows by ids), once for both: the service methods delegate here with their
 * scope config. Ids and totals select exactly what the summary shows (same
 * years, filters, quick search and sort), so the grid, its totals footer and
 * the workspace navigation always agree.
 */

/**
 * Rows the list page and the filter values build at most when a filter, the
 * quick search or the sort needs every row (`deps.memoryRowCap` overrides it).
 * The ids, and so the totals and the AI aggregates, read every row.
 */
export const MEMORY_ROW_CAP = 10_000;

/**
 * Fields the column filters can list values for, on both item types (plus each
 * type's own fields and every `analytics_<axis id>` dimension key).
 */
const FILTER_VALUE_FIELDS = [
  'supplier_name', 'paying_company_name', 'company_name', 'account_display', 'allocation_label', 'allocation_method_label',
  'contract_name', 'currency', 'owner_it_name', 'owner_business_name', 'analytics_category_name', 'project_name',
  'project_stream_name', 'project_category_name', 'cost_center_label', 'cost_center_code', 'cost_center_name', 'cost_center_path',
  'budget_holder_name', 'run_build',
];

const TEXT_FILTER_TYPES = new Set(['contains', 'notContains', 'equals', 'notEqual', 'startsWith', 'endsWith']);

export type SummaryRowOptions = {
  includeRecipientDetails?: boolean;
  includeNextYearAllocation?: boolean;
};

export type SummaryRowsByIdsQuery = SummaryRowOptions & {
  ids: string[];
  /** Years added to the fixed window. */
  years?: unknown;
  includeLatestTask?: boolean;
};

interface SummaryContext {
  tenantId: string;
  currentYear: number;
  requestedYears: number[];
  years: number[];
  page: number;
  limit: number;
  skip: number;
  sort: Sort;
  q?: string;
  filters: Record<string, any>;
  explicitStatus?: StatusState;
  includeDisabled: boolean;
  sqlFilters: Record<string, any>;
  memoryFilters: Record<string, any>;
}

function fixedYears(currentYear: number): number[] {
  return FIXED_SLOTS.map((slot) => currentYear + slot.offset);
}

/**
 * Whether a column filter runs in SQL: a blank or not-blank model on any
 * column of the item table (compiled as `NULLIF(col::text, '') IS NULL`, safe
 * for every type), and a set or text model on a text or enum column (compared
 * as text). Everything else runs in memory: amounts, dates, ids and the item
 * number with other operators, so no filter a grid can send reaches SQL with
 * an operator its column type refuses.
 */
function runsInSql(config: SummaryScopeConfig, field: string, rawModel: any): boolean {
  if (!config.columns.includes(field)) return false;
  const model = normalizeAgFilterModel(rawModel);
  if (!model || typeof model !== 'object') return false;
  const type = model.type ?? (model.filterType === 'set' ? 'set' : 'contains');
  if (type === 'blank' || type === 'notBlank') return true;
  if (!config.textColumns.includes(field) && !config.enumColumns.includes(field)) return false;
  if (model.filterType === 'set') return Array.isArray(model.values);
  return (model.filterType === undefined || model.filterType === 'text') && TEXT_FILTER_TYPES.has(type);
}

async function summaryContext(config: SummaryScopeConfig, query: any, manager: EntityManager): Promise<SummaryContext> {
  const tenantId = await summaryTenantId(manager);
  const currentYear = new Date().getFullYear();
  const { page, limit, skip, sort, status, q, filters } = parsePagination(query ?? {});
  const { status: statusFromAg, sanitizedFilters } = extractStatusFilterFromAgModel(filters);
  const cleanFilters: Record<string, any> = (sanitizedFilters ?? filters ?? {}) as Record<string, any>;
  const requestedYears = parseSummaryYears(query?.years);
  const namedYears = yearsNamedByFields([sort.field, ...Object.keys(cleanFilters)]);
  const sqlFilters: Record<string, any> = {};
  const memoryFilters: Record<string, any> = {};
  for (const [field, model] of Object.entries(cleanFilters)) {
    // The end of validity keeps its SQL date path, combined with the lifecycle scope.
    if (field === 'disabled_at') continue;
    if (runsInSql(config, field, model)) sqlFilters[field] = model;
    else memoryFilters[field] = model;
  }
  return {
    tenantId,
    currentYear,
    requestedYears,
    years: Array.from(new Set([...fixedYears(currentYear), ...requestedYears, ...namedYears])),
    page,
    limit,
    skip,
    sort,
    q: q?.trim() || undefined,
    filters: cleanFilters,
    explicitStatus: status ?? statusFromAg,
    includeDisabled: ['1', 'true'].includes(String(query?.includeDisabled ?? '').toLowerCase()),
    sqlFilters,
    memoryFilters,
  };
}

/** An explicit status (query or status filter) wins over "all"; otherwise "all" or the endpoint's default. */
function lifecycleScope(ctx: SummaryContext, fallback: LifecycleScope): LifecycleScope {
  if (ctx.explicitStatus === StatusState.DISABLED) return 'inactive';
  if (ctx.explicitStatus === StatusState.ENABLED) return 'active';
  return ctx.includeDisabled ? null : fallback;
}

/** The items still active on January 1 of the earliest requested year (the year before this one by default). */
function windowScope(ctx: SummaryContext): LifecycleScope {
  const first = ctx.requestedYears.length ? Math.min(...ctx.requestedYears) : ctx.currentYear - 1;
  return { activeSince: new Date(`${first}-01-01T00:00:00.000Z`) };
}

const COLUMN_TOKEN = '__summary_column__';

function itemWhere(ctx: SummaryContext, scope: LifecycleScope, sqlFilters: Record<string, any>): Record<string, any> {
  const where: Record<string, any> = { tenant_id: ctx.tenantId };
  const nextParam = createParamNameGenerator('summary_filter_');
  for (const [field, model] of Object.entries(sqlFilters)) {
    // Compared as text: an enum column refuses ILIKE and any value outside its type.
    const compiled = compileAgFilterCondition(model, { expression: `CAST(${COLUMN_TOKEN} AS text)` }, nextParam);
    if (compiled) where[field] = Raw((alias) => compiled.sql.split(COLUMN_TOKEN).join(alias), compiled.params);
  }
  applyDisabledAtWhere(where, scope, ctx.filters);
  return where;
}

/**
 * The SQL fast path: a sort on an item column with nothing to evaluate in
 * memory. Enum columns sort in memory (SQL would use their declaration order),
 * except those whose order the in-memory sort reproduces (status).
 */
function sortsInSql(config: SummaryScopeConfig, ctx: SummaryContext): boolean {
  const field = ctx.sort.field;
  return !ctx.q
    && Object.keys(ctx.memoryFilters).length === 0
    && config.columns.includes(field)
    && (!config.enumColumns.includes(field) || field in FIXED_SORT_ORDERS);
}

function sqlOrder(sort: Sort): Record<string, 'ASC' | 'DESC'> {
  return sort.field === 'id' ? { id: sort.direction } : { [sort.field]: sort.direction, id: 'ASC' };
}

function itemRepository(config: SummaryScopeConfig, manager: EntityManager) {
  return manager.getRepository<any>(config.itemEntity as any);
}

async function itemsByIds(config: SummaryScopeConfig, manager: EntityManager, tenantId: string, ids: string[]): Promise<any[]> {
  if (!ids.length) return [];
  return itemRepository(config, manager)
    .createQueryBuilder('i')
    .where('i.tenant_id = :tenantId', { tenantId })
    .andWhere('i.id = ANY(:ids)', { ids })
    .orderBy('i.created_at', 'DESC')
    .addOrderBy('i.id', 'DESC')
    .getMany();
}

/**
 * The items a query reads, newest first. With a cap, one more is read to tell
 * whether the cap was hit (`capped`); the extra one is dropped.
 */
async function readItems(
  config: SummaryScopeConfig,
  manager: EntityManager,
  where: Record<string, any>,
  cap: number | null,
): Promise<{ items: any[]; capped: boolean }> {
  const items = await itemRepository(config, manager).find({
    where,
    order: { created_at: 'DESC', id: 'DESC' },
    ...(cap != null ? { take: cap + 1 } : {}),
  });
  const capped = cap != null && items.length > cap;
  return { items: capped ? items.slice(0, cap) : items, capped };
}

/** Every row the query selects (up to `cap` items read), built, filtered, searched and sorted in memory. */
async function rowsInMemory(
  config: SummaryScopeConfig,
  deps: SummaryDeps,
  ctx: SummaryContext,
  manager: EntityManager,
  where: Record<string, any>,
  options: SummaryRowOptions,
  cap: number | null,
): Promise<{ rows: BudgetSummaryRow[]; capped: boolean }> {
  const { items, capped } = await readItems(config, manager, where, cap);
  let rows = await buildBudgetSummaryRows(config, deps, manager, ctx.tenantId, items, {
    years: ctx.years,
    currentYear: ctx.currentYear,
    includeLatestTask: true,
    ...options,
  });
  rows = applyAgFiltersInMemory(rows, ctx.memoryFilters, config);
  if (ctx.q) rows = quickSearchSummaryRows(rows, ctx.q, config);
  return { rows: sortSummaryRows(rows, ctx.sort.field, ctx.sort.direction), capped };
}

/**
 * One page of the list. When the rows to build exceed the cap, the page comes
 * from the newest ones, `total` is the SQL count of every item the query
 * selects before the in-memory filters, and `capped` says so.
 */
export async function summary(
  config: SummaryScopeConfig,
  deps: SummaryDeps,
  query: any,
  manager: EntityManager,
  options: SummaryRowOptions = {},
): Promise<{ items: BudgetSummaryRow[]; total: number; page: number; limit: number; capped?: true }> {
  const ctx = await summaryContext(config, query, manager);
  const where = itemWhere(ctx, lifecycleScope(ctx, windowScope(ctx)), ctx.sqlFilters);
  const buildOptions = { years: ctx.years, currentYear: ctx.currentYear, includeLatestTask: true, ...options };
  if (sortsInSql(config, ctx)) {
    const [items, total] = await itemRepository(config, manager).findAndCount({
      where,
      order: sqlOrder(ctx.sort),
      skip: ctx.skip,
      take: ctx.limit,
    });
    const rows = await buildBudgetSummaryRows(config, deps, manager, ctx.tenantId, items, buildOptions);
    return { items: rows, total, page: ctx.page, limit: ctx.limit };
  }
  const { rows, capped } = await rowsInMemory(config, deps, ctx, manager, where, options, deps.memoryRowCap ?? MEMORY_ROW_CAP);
  const page = { items: rows.slice(ctx.skip, ctx.skip + ctx.limit), page: ctx.page, limit: ctx.limit };
  if (!capped) return { ...page, total: rows.length };
  return { ...page, total: await itemRepository(config, manager).count({ where }), capped: true };
}

/**
 * The ordered ids of every row the summary would list (workspace navigation,
 * totals, AI aggregates), without a cap. Without a status: active items.
 */
export async function summaryIds(
  config: SummaryScopeConfig,
  deps: SummaryDeps,
  query: any,
  manager: EntityManager,
): Promise<{ ids: string[]; item_numbers: number[]; total: number }> {
  const ctx = await summaryContext(config, query, manager);
  const where = itemWhere(ctx, lifecycleScope(ctx, 'active'), ctx.sqlFilters);
  const rows: Array<{ id: string; item_number: number }> = sortsInSql(config, ctx)
    ? await itemRepository(config, manager).find({ where, order: sqlOrder(ctx.sort) })
    : (await rowsInMemory(config, deps, ctx, manager, where, {}, null)).rows;
  const ids = rows.map((row) => row.id);
  return { ids, item_numbers: rows.map((row) => row.item_number), total: ids.length };
}

/**
 * The distinct values of each requested field under every other filter of the
 * query (a column's own filter never narrows its own list). Rows are read and
 * built once; the column filters then run in memory per field.
 */
export async function summaryFilterValues(
  config: SummaryScopeConfig,
  deps: SummaryDeps,
  query: any,
  manager: EntityManager,
): Promise<Record<string, Array<string | null>>> {
  const allowed = new Set([...FILTER_VALUE_FIELDS, ...config.extraFields]);
  const requested: string[] = typeof query?.fields === 'string'
    ? query.fields.split(',').map((field: string) => field.trim()).filter(Boolean)
    : [];
  const fields = requested.filter((field) => allowed.has(field) || parseAnalyticsFieldKey(field) != null);
  if (fields.length === 0) return {};

  const ctx = await summaryContext(config, query, manager);
  const { items } = await readItems(
    config,
    manager,
    itemWhere(ctx, lifecycleScope(ctx, windowScope(ctx)), {}),
    deps.memoryRowCap ?? MEMORY_ROW_CAP,
  );
  let rows = await buildBudgetSummaryRows(config, deps, manager, ctx.tenantId, items, {
    years: ctx.years,
    currentYear: ctx.currentYear,
    includeLatestTask: true,
  });
  if (ctx.q) rows = quickSearchSummaryRows(rows, ctx.q, config);

  const columnFilters = { ...ctx.sqlFilters, ...ctx.memoryFilters };
  const result: Record<string, Array<string | null>> = {};
  for (const field of fields) {
    const others = { ...columnFilters };
    delete others[field];
    const values = new Set<string | null>();
    for (const row of applyAgFiltersInMemory(rows, others, config)) {
      // A line linked to several projects offers each name, not their combination.
      const rowValues = summaryFieldValues(row, field);
      if (rowValues.length === 0) values.add(null);
      for (const value of rowValues) values.add(value == null || value === '' ? null : String(value));
    }
    result[field] = Array.from(values).sort((a, b) => {
      if (a === b) return 0;
      if (a == null) return 1;
      if (b == null) return -1;
      return a.localeCompare(b);
    });
  }
  return result;
}

/**
 * The footer totals of what the summary lists: every `<slot><Suffix>` of the
 * fixed slots and of the requested years, in the reporting currency, masked
 * after each item's end of validity. Each version is converted once and the
 * sums are kept in cents.
 */
export async function summaryTotals(
  config: SummaryScopeConfig,
  deps: SummaryDeps,
  query: any,
  manager: EntityManager,
): Promise<Record<string, number | string>> {
  const { ids } = await summaryIds(config, deps, query, manager);
  const tenantId = await summaryTenantId(manager);
  const currentYear = new Date().getFullYear();
  const slots = [
    ...FIXED_SLOTS.map((slot) => ({ key: slot.key as string, year: currentYear + slot.offset })),
    ...parseSummaryYears(query?.years).map((year) => ({ key: `y${year}`, year })),
  ];
  const sums = new Map<string, bigint>();
  for (const slot of slots) for (const column of SUMMARY_COLUMNS) sums.set(`${slot.key}${column.suffix}`, 0n);

  const items = await itemsByIds(config, manager, tenantId, ids);
  const totals = await loadVersionTotals(config, deps, manager, tenantId, items, slots.map((slot) => slot.year), { reporting: true });
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
  return {
    ...Object.fromEntries(Array.from(sums.entries()).map(([key, cents]) => [key, Number(formatCents(cents))])),
    reportingCurrency: totals.reportingCurrency,
  };
}

/** Summary rows of the given items, in the order given (no lifecycle scope, no cap). */
export async function summaryRowsByIds(
  config: SummaryScopeConfig,
  deps: SummaryDeps,
  query: SummaryRowsByIdsQuery,
  manager: EntityManager,
): Promise<BudgetSummaryRow[]> {
  const requested = (query.ids ?? []).filter(Boolean);
  const ids = Array.from(new Set(requested));
  if (!ids.length) return [];
  const tenantId = await summaryTenantId(manager);
  const currentYear = new Date().getFullYear();
  const items = await itemsByIds(config, manager, tenantId, ids);
  const rows = await buildBudgetSummaryRows(config, deps, manager, tenantId, items, {
    years: Array.from(new Set([...fixedYears(currentYear), ...parseSummaryYears(query.years)])),
    currentYear,
    includeLatestTask: query.includeLatestTask ?? false,
    includeRecipientDetails: query.includeRecipientDetails ?? false,
    includeNextYearAllocation: query.includeNextYearAllocation ?? false,
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  return requested.map((id) => byId.get(id)).filter((row): row is BudgetSummaryRow => !!row);
}
