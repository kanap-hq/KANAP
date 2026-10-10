import { BadRequestException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { centsToNumber, formatCents } from '../../common/amount';
import { aggregateSql, AggregateSpec, validateAggregateSpec } from '../../common/list-engine/list-aggregate';
import { mergeListContextQuery } from '../../common/list-context/list-context';
import { ListContextsService } from '../../common/list-context/list-contexts.service';
import { assertListEngineSupport } from '../../common/list-engine/list-engine-support';
import type { ListState } from '../../common/list-engine/list-engine.types';
import { fieldOf, filterValuesSql, idsSql, neighborsSql, pageSql, countSql, buildCore } from '../../common/list-engine/list-sql-builder';
import { parseListRequest, ParsedListRequest, resolveLifecycleScope } from '../../common/list-engine/list-state';
import { compareNullableText, decimal2ToFloat, jsRound, sumJsCents } from '../../common/list-engine/sql-fragments';
import { SqlStatement } from '../../common/list-engine/sql-statement';
import type { LifecycleScope } from '../../common/status';
import { ANALYTICS_VALUE_ORDER_SQL, parseAnalyticsFieldKey } from '../../analytics/analytics-axes.util';
import {
  buildBudgetSummaryRows,
  BudgetSummaryRow,
  FIXED_SLOTS,
  parseSummaryYears,
  resolveAmountField,
  resolveFteField,
  resolveLocalAmountField,
  SUMMARY_COLUMNS,
  SummaryDeps,
  SummaryScopeConfig,
  summaryTenantId,
  yearsNamedByFields,
} from '../spend-summary.builder';
import { BudgetListConfig, budgetRuntimeNeeds } from './budget-list.config';
import { natureAnd } from '../budget-nature';
import { presentLine, selectLineColumns } from '../budget-line-presentation';
import { fxKeyCurrency, fxSetKeySql, fxTableSql, RequestFxRates } from './budget-fx-table';
import { BudgetListRuntime, loadBudgetRuntime, mergeNeeds, RuntimeNeeds } from './budget-list.runtime';

/**
 * The OPEX and CAPEX list endpoints on the SQL list engine
 * (`common/list-engine`), one scope config each: one statement decides the
 * page, the count, the ordered ids, a line's neighbours, the filter values or
 * the footer totals; the row builder then draws the page's lines only. Same
 * signatures and response shapes as the in-memory functions they replaced
 * (kept as the test oracle, `__tests__/oracle/`), without their 10,000-line
 * cap.
 */

/** Fields the column filters can list values for, on both item types (plus each type's own fields and every dimension key). */
export const FILTER_VALUE_FIELDS = [
  'supplier_name', 'paying_company_name', 'company_name', 'account_display', 'allocation_label', 'allocation_method_label',
  'contract_name', 'currency', 'owner_it_name', 'owner_business_name', 'analytics_category_name', 'project_name',
  'project_stream_name', 'project_category_name', 'cost_center_label', 'cost_center_code', 'cost_center_name', 'cost_center_path',
  'budget_holder_name', 'run_build', 'has_fte',
];

export type BudgetListRowOptions = {
  includeRecipientDetails?: boolean;
  includeNextYearAllocation?: boolean;
};

export type BudgetListRowsByIdsQuery = BudgetListRowOptions & {
  ids: string[];
  /** Years added to the fixed window. */
  years?: unknown;
  includeLatestTask?: boolean;
};

interface BudgetRequest {
  tenantId: string;
  currentYear: number;
  request: ParsedListRequest;
  /** `years=`: years added to the fixed window. */
  requestedYears: number[];
  /** Fixed window, requested years and years named by the sort or a filter. */
  years: number[];
}

function fixedYears(currentYear: number): number[] {
  return FIXED_SLOTS.map((slot) => currentYear + slot.offset);
}

/**
 * The budget years one request may read: within ten years of the current one,
 * at most twelve distinct years with the fixed window (Y-2 to Y+2) included.
 * Each year a statement reads costs it a few milliseconds (versions, totals
 * and FX of that year), and `years=`, a `y<YYYY>…` sort or filter key or an
 * FTE key can name any year: without a bound, one request naming 150 years
 * held a connection for 93 s. Every screen stays well inside: the grid asks
 * for Y-1 to Y+2, the reports for years of the fixed window, the AI for the
 * fixed window; twelve years leave room for a decade of history.
 */
export const BUDGET_YEAR_REACH = 10;
export const MAX_BUDGET_YEARS_PER_REQUEST = 12;

export function assertBudgetYearsWithinBounds(years: number[], currentYear: number): void {
  const outside = years.filter((year) => Math.abs(year - currentYear) > BUDGET_YEAR_REACH);
  if (outside.length) {
    throw new BadRequestException(
      `Budget years must be within ${BUDGET_YEAR_REACH} years of ${currentYear} (${currentYear - BUDGET_YEAR_REACH} to ${currentYear + BUDGET_YEAR_REACH}): ${Array.from(new Set(outside)).sort((a, b) => a - b).join(', ')}.`,
    );
  }
  const distinct = new Set(years).size;
  if (distinct > MAX_BUDGET_YEARS_PER_REQUEST) {
    throw new BadRequestException(`A request reads at most ${MAX_BUDGET_YEARS_PER_REQUEST} budget years, fixed window included (${distinct} asked).`);
  }
}

async function readRequest(query: any, manager: EntityManager): Promise<BudgetRequest> {
  const tenantId = await summaryTenantId(manager);
  await assertListEngineSupport(manager);
  const currentYear = new Date().getFullYear();
  const request = parseListRequest(query);
  const requestedYears = parseSummaryYears(query?.years);
  const namedYears = yearsNamedByFields([request.sort.field, ...Object.keys(request.filters)]);
  const years = Array.from(new Set([...fixedYears(currentYear), ...requestedYears, ...namedYears]));
  assertBudgetYearsWithinBounds([
    ...years,
    ...parseFteKeys(query?.fte, currentYear).map((fte) => fte.year),
    ...(parseAmountKeys(query?.amounts, currentYear) ?? []).map((amount) => amount.year),
  ], currentYear);
  return { tenantId, currentYear, request, requestedYears, years };
}

/** The items still active on January 1 of the earliest requested year (the year before this one by default). */
function windowScope(req: BudgetRequest): LifecycleScope {
  const first = req.requestedYears.length ? Math.min(...req.requestedYears) : req.currentYear - 1;
  return { activeSince: new Date(`${first}-01-01T00:00:00.000Z`) };
}

/**
 * The budget lists' Enabled and Disabled, by the current year: Enabled is a
 * line with no end of validity or one on or after January 1 (UTC), so a line
 * that ends during the year stays listed until December 31; Disabled is a
 * line that ended before January 1. The other lists keep "ended as of now".
 */
export function budgetLifecycleScope(scope: LifecycleScope, currentYear: number): LifecycleScope {
  const yearStart = new Date(`${currentYear}-01-01T00:00:00.000Z`);
  if (scope === 'active') return { activeSince: yearStart };
  if (scope === 'inactive') return { endedBefore: yearStart };
  return scope;
}

function stateOf(req: BudgetRequest, fallback: LifecycleScope): ListState {
  const r = req.request;
  const scope = budgetLifecycleScope(resolveLifecycleScope(r, fallback), req.currentYear);
  return { page: r.page, limit: r.limit, skip: r.skip, sort: r.sort, q: r.q, filters: r.filters, scope };
}

/** Keys the statement reads for the request's own sort and filters. */
function requestKeys(req: BudgetRequest, withSort: boolean): string[] {
  return [...(withSort ? [req.request.sort.field] : []), ...Object.keys(req.request.filters)];
}

async function runtimeFor(
  scope: SummaryScopeConfig,
  deps: Pick<SummaryDeps, 'access'>,
  fxRates: RequestFxRates,
  manager: EntityManager,
  req: BudgetRequest,
  needs: RuntimeNeeds,
): Promise<BudgetListRuntime> {
  return loadBudgetRuntime(scope, { fxRates }, manager, req.tenantId, req.currentYear, needs, deps.access);
}

async function run(manager: EntityManager, stmt: SqlStatement, sql: string): Promise<any[]> {
  const final = stmt.finalize(sql);
  return manager.query(final.sql, final.params);
}

/** The lines of the page in their order, as their nature's API shows them (`budget-line-presentation.ts`). */
async function itemsInOrder(scope: SummaryScopeConfig, manager: EntityManager, tenantId: string, ids: string[]): Promise<any[]> {
  if (!ids.length) return [];
  const nature = scope.nature ?? scope.scope;
  const qb = manager.getRepository(scope.itemEntity)
    .createQueryBuilder('i')
    .where(`i.tenant_id = :tenantId${natureAnd('i', scope.nature)}`, { tenantId })
    .andWhere('i.id = ANY(:ids)', { ids })
    .orderBy('i.created_at', 'DESC')
    .addOrderBy('i.id', 'DESC');
  const items = await selectLineColumns(qb, 'i', nature).getMany();
  const byId = new Map(items.map((item) => [item.id, presentLine(nature, item)]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

/** `fte=fte_yBudget,fte_y2028Revision` (or an array): the valid FTE keys, each with its year and column. */
export function parseFteKeys(raw: unknown, currentYear: number): Array<{ key: string; year: number; measure: string }> {
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
 * `amounts=yBudget,y2028Revision` (or an array): the footer totals keys asked
 * for, each with its year and budget column; unknown keys are left out. Null
 * without the parameter: every key of the fixed slots and of `years=`.
 */
export function parseAmountKeys(raw: unknown, currentYear: number): Array<{ key: string; year: number; measure: string }> | null {
  if (raw === undefined || raw === null) return null;
  const parts = Array.isArray(raw) ? raw.flatMap((part) => String(part).split(',')) : String(raw).split(',');
  const keys = new Map<string, { key: string; year: number; measure: string }>();
  for (const key of parts.map((part) => part.trim()).filter(Boolean)) {
    const resolved = resolveAmountField(key);
    if (!resolved) continue;
    const year = resolved.year ?? currentYear + FIXED_SLOTS.find((slot) => slot.key === resolved.slot)!.offset;
    keys.set(key, { key, year, measure: resolved.column.measure });
  }
  return Array.from(keys.values());
}

/**
 * The ids of one page and the list's count: the statement every page and
 * scroll block runs. A page past the end counts the list apart.
 */
export async function budgetListPageIds(
  scope: SummaryScopeConfig,
  deps: SummaryDeps,
  query: any,
  manager: EntityManager,
  opts: { allocationLabels?: boolean; fxRates?: RequestFxRates; rowsFollow?: boolean } = {},
): Promise<{ ids: string[]; total: number; labels: Map<string, string>; req: BudgetRequest; fxRates: RequestFxRates }> {
  const req = await readRequest(query, manager);
  const fxRates = opts.fxRates ?? new RequestFxRates(deps.fxRates);
  const state = stateOf(req, windowScope(req));
  const needs = budgetRuntimeNeeds(req.currentYear, requestKeys(req, true), !!state.q);
  if (opts.allocationLabels) needs.ruleYears = [...(needs.ruleYears ?? []), req.currentYear];
  // The row builder converts every year it reads: resolve those rates once, here, for both.
  if (opts.rowsFollow) needs.fxYears = Array.from(new Set([...(needs.fxYears ?? []), ...req.years]));
  const rt = await runtimeFor(scope, deps, fxRates, manager, req, needs);
  const config = new BudgetListConfig(rt);
  const stmt = new SqlStatement(req.tenantId);
  const extra = opts.allocationLabels ? [{ name: 'allocation_label', field: fieldOf(stmt, config, 'allocation_method_label') }] : [];
  const rows = await run(manager, stmt, pageSql(stmt, config, state, extra));
  let total = rows.length ? Number(rows[0].total) : 0;
  if (!rows.length && state.skip > 0) {
    const countStmt = new SqlStatement(req.tenantId);
    const [count] = await run(manager, countStmt, countSql(countStmt, new BudgetListConfig(rt), state));
    total = Number(count?.total ?? 0);
  }
  const labels = new Map<string, string>(rows.map((row: any) => [row.id, row.allocation_label ?? '']));
  return { ids: rows.map((row: any) => row.id), total, labels, req, fxRates };
}

/** One page of the list: the statement picks the lines, the builder draws them. */
export async function budgetListSummary(
  scope: SummaryScopeConfig,
  deps: SummaryDeps,
  query: any,
  manager: EntityManager,
  options: BudgetListRowOptions = {},
): Promise<{ items: BudgetSummaryRow[]; total: number; page: number; limit: number }> {
  const grid = String(query?.shape ?? '') === 'grid';
  const page = await budgetListPageIds(scope, deps, query, manager, { allocationLabels: grid, rowsFollow: true });
  const { req } = page;
  const items = await itemsInOrder(scope, manager, req.tenantId, page.ids);
  const rows = await buildBudgetSummaryRows(scope, { ...deps, fxRates: page.fxRates }, manager, req.tenantId, items, {
    years: req.years,
    currentYear: req.currentYear,
    includeLatestTask: true,
    ...options,
    ...(grid
      ? { shape: 'grid' as const, fteKeys: parseFteKeys(query?.fte, req.currentYear).map((fte) => fte.key), allocationLabels: page.labels }
      : {}),
  });
  return { items: rows, total: page.total, page: req.request.page, limit: req.request.limit };
}

/** The ordered ids of every line of the list (workspace navigation). Without a status: the Enabled lines. */
export async function budgetListIds(
  scope: SummaryScopeConfig,
  deps: SummaryDeps,
  query: any,
  manager: EntityManager,
): Promise<{ ids: string[]; item_numbers: number[]; total: number }> {
  const req = await readRequest(query, manager);
  const state = stateOf(req, 'active');
  const rt = await runtimeFor(scope, deps, new RequestFxRates(deps.fxRates), manager, req, budgetRuntimeNeeds(req.currentYear, requestKeys(req, true), !!state.q));
  const config = new BudgetListConfig(rt);
  const stmt = new SqlStatement(req.tenantId);
  const rows = await run(manager, stmt, idsSql(stmt, config, state, ['id', 'item_number']));
  return { ids: rows.map((row) => row.id), item_numbers: rows.map((row) => Number(row.item_number)), total: rows.length };
}

export type BudgetListNeighbor = { id: string; item_number: number } | null;

/**
 * Where one line stands in the list (0-based `index`, null when the list does
 * not hold it) and its previous and next lines: the workspace navigation
 * without downloading every id. Without a status: the Enabled lines, like the ids.
 */
export async function budgetListNeighbors(
  scope: SummaryScopeConfig,
  deps: SummaryDeps,
  query: any,
  id: string,
  manager: EntityManager,
): Promise<{ index: number | null; total: number; prev: BudgetListNeighbor; next: BudgetListNeighbor }> {
  const req = await readRequest(query, manager);
  const state = stateOf(req, 'active');
  const rt = await runtimeFor(scope, deps, new RequestFxRates(deps.fxRates), manager, req, budgetRuntimeNeeds(req.currentYear, requestKeys(req, true), !!state.q));
  const config = new BudgetListConfig(rt);
  const stmt = new SqlStatement(req.tenantId);
  const rows = await run(manager, stmt, neighborsSql(stmt, config, state, id, ['id', 'item_number']));
  const total = rows.length ? Number(rows[0].total) : 0;
  const me = rows.length && rows[0].me != null ? Number(rows[0].me) : null;
  const at = (n: number): BudgetListNeighbor => {
    const row = rows.find((r) => Number(r.n) === n);
    return row ? { id: row.id, item_number: Number(row.item_number) } : null;
  };
  return me == null
    ? { index: null, total, prev: null, next: null }
    : { index: me - 1, total, prev: at(me - 1), next: at(me + 1) };
}

/**
 * The distinct values of each requested field under every other filter of the
 * query (a column's own filter never narrows its own list), nulls last, in
 * the engine's text order.
 */
export async function budgetListFilterValues(
  scope: SummaryScopeConfig,
  deps: SummaryDeps,
  query: any,
  manager: EntityManager,
): Promise<Record<string, Array<string | null>>> {
  const allowed = new Set([...FILTER_VALUE_FIELDS, ...scope.extraFields]);
  const requested: string[] = typeof query?.fields === 'string'
    ? query.fields.split(',').map((field: string) => field.trim()).filter(Boolean)
    : [];
  const fields = Array.from(new Set(requested.filter((field) => allowed.has(field) || parseAnalyticsFieldKey(field) != null)));
  if (fields.length === 0) return {};

  const req = await readRequest(query, manager);
  const state = stateOf(req, windowScope(req));
  const needs = mergeNeeds(
    budgetRuntimeNeeds(req.currentYear, requestKeys(req, false), !!state.q),
    budgetRuntimeNeeds(req.currentYear, fields, false),
  );
  const rt = await runtimeFor(scope, deps, new RequestFxRates(deps.fxRates), manager, req, needs);
  const config = new BudgetListConfig(rt);
  const stmt = new SqlStatement(req.tenantId);
  const rows = await run(manager, stmt, filterValuesSql(stmt, config, state, fields));
  const result: Record<string, Array<string | null>> = {};
  fields.forEach((field) => { result[field] = []; });
  for (const row of rows) result[fields[Number(row.f)]].push(row.v ?? null);
  for (const field of fields) result[field].sort(compareNullableText);
  await orderAnalyticsFilterValues(manager, req.tenantId, rt.axes?.defaultAxisId ?? null, result);
  return result;
}

/**
 * The values of an analytics column (`analytics_<axis id>`, and the default dimension's
 * `analytics_category_name`) in the dimension's order (`ANALYTICS_VALUE_ORDER_SQL`), with the
 * positions of every requested dimension read in one statement. A name the dimension does not
 * hold (none expected) follows them in text order; null stays last. Sorts `result` in place.
 */
async function orderAnalyticsFilterValues(
  manager: EntityManager,
  tenantId: string,
  defaultAxisId: string | null,
  result: Record<string, Array<string | null>>,
): Promise<void> {
  const axisOfField = new Map<string, string>();
  for (const field of Object.keys(result)) {
    const axisId = parseAnalyticsFieldKey(field) ?? (field === 'analytics_category_name' ? defaultAxisId : null);
    if (axisId) axisOfField.set(field, axisId);
  }
  if (axisOfField.size === 0) return;
  const rows: Array<{ axis_id: string; name: string; position: string | number }> = await manager.query(
    `SELECT c.axis_id::text AS axis_id, c.name,
            row_number() OVER (PARTITION BY c.axis_id ORDER BY ${ANALYTICS_VALUE_ORDER_SQL}) AS position
       FROM analytics_categories c
      WHERE c.tenant_id = $1 AND c.axis_id = ANY($2::uuid[])`,
    [tenantId, Array.from(new Set(axisOfField.values()))],
  );
  const positions = new Map(rows.map((row) => [`${row.axis_id}|${row.name}`, Number(row.position)]));
  for (const [field, axisId] of axisOfField) {
    const position = (value: string | null) => (value == null ? undefined : positions.get(`${axisId}|${value}`));
    result[field].sort((a, b) => {
      const pa = position(a);
      const pb = position(b);
      if (pa !== undefined && pb !== undefined) return pa - pb;
      if (pa !== undefined) return -1;
      if (pb !== undefined) return 1;
      return compareNullableText(a, b);
    });
  }
}

/**
 * The FTE sum of one key over the listed lines, and how many lines have no FTE
 * (unknown). `total` is null when no line has an FTE: unknown is never 0.
 */
export type FteTotal = { total: number | null; unknown: number };

export type SummaryTotals = Record<string, number | string> & { fte?: Record<string, FteTotal> };

/**
 * The footer totals of what the list shows: every `<slot><Suffix>` of the
 * fixed slots and of the requested years, in the reporting currency, masked
 * after each line's end of validity. With `amounts=<keys>`, only those keys
 * (the amount columns the grid shows; their years and columns alone are
 * read). Each version is converted to the cent
 * once and the sums are exact (numeric cents). With `fte=<keys>`, `fte` sums
 * each FTE key over the lines and counts the lines whose FTE is unknown.
 * Without a status: the Enabled lines.
 */
export async function budgetListTotals(
  scope: SummaryScopeConfig,
  deps: SummaryDeps,
  query: any,
  manager: EntityManager,
): Promise<SummaryTotals> {
  const req = await readRequest(query, manager);
  const state = stateOf(req, 'active');
  const Y = req.currentYear;
  // The keys answered: `amounts=` when given (the columns the grid shows), else every column of the
  // fixed slots and of the requested years.
  const wanted = parseAmountKeys(query?.amounts, Y) ?? [
    ...FIXED_SLOTS.map((slot) => ({ key: slot.key as string, year: Y + slot.offset })),
    ...req.requestedYears.map((year) => ({ key: `y${year}`, year })),
  ].flatMap((slot) => SUMMARY_COLUMNS.map((column) => ({ key: `${slot.key}${column.suffix}`, year: slot.year, measure: column.measure as string })));
  const slotYears = Array.from(new Set(wanted.map((amount) => amount.year)));
  const columns = SUMMARY_COLUMNS.filter((column) => wanted.some((amount) => amount.measure === column.measure));
  const fteKeys = parseFteKeys(query?.fte, Y);
  // The FX pre-read also gives the reporting currency: one year at least, even without an amount.
  const needs = mergeNeeds(budgetRuntimeNeeds(Y, requestKeys(req, false), !!state.q), { fxYears: slotYears.length ? slotYears : [Y] });
  const rt = await runtimeFor(scope, deps, new RequestFxRates(deps.fxRates), manager, req, needs);
  const config = new BudgetListConfig(rt);
  const stmt = new SqlStatement(req.tenantId);
  const core = buildCore(stmt, config, state);
  const s = scope;
  const fx = rt.fx!;
  // A version shows only up to the UTC year of its line's end of validity.
  const validity = `(c.disabled_at IS NULL OR v.budget_year <= extract(year FROM c.disabled_at AT TIME ZONE 'UTC'))`;
  // Each version converted once (the builder's chain, `Math.round(Number(formatCents(local)) * rate * 100)`),
  // the products computed once per row (OFFSET 0 keeps the subquery from being flattened into the sums).
  const products = columns.map((column) => `${decimal2ToFloat(`t.${column.measure}`)} * coalesce(fx.rate, 1::float8) * 100 AS ${column.measure}`).join(',\n          ');
  const rounded = columns.map((column) => `${jsRound(`p.${column.measure}`)} AS ${column.measure}`).join(', ');
  const sums = columns.map((column) => `${sumJsCents(`x.${column.measure}`)}::text AS ${column.measure}`).join(',\n        ');
  const amounts = columns.length === 0 ? null : `SELECT x.yr,
        ${sums}
      FROM (SELECT p.yr, ${rounded} FROM (
        SELECT v.budget_year AS yr,
          ${products}
        FROM core c
        JOIN ${s.versionTable} v ON v.tenant_id = ${stmt.tenant} AND v.${s.versionItemFk} = c.id
          AND v.budget_year = ANY(${stmt.bind(slotYears, 'int[]')}) AND ${validity}
        JOIN ${s.totalsTable} t ON t.tenant_id = ${stmt.tenant} AND t.version_id = v.id
        LEFT JOIN ${fxTableSql(stmt, fx)} ON fx.yr = v.budget_year AND fx.cur = ${fxKeyCurrency('c')} AND fx.set_key = ${fxSetKeySql(stmt, fx, 'v.fx_rate_set_id')}
        OFFSET 0
      ) p OFFSET 0) x
      GROUP BY x.yr`;
  const fte = fteKeys.length
    ? `SELECT k.key, sum(ri.fte)::text AS total, (count(*) FILTER (WHERE ri.fte IS NULL))::int AS unknown, count(*)::int AS lines
      FROM core c
      CROSS JOIN unnest(${stmt.bind(fteKeys.map((f) => f.key), 'text[]')}, ${stmt.bind(fteKeys.map((f) => f.year), 'int[]')}, ${stmt.bind(fteKeys.map((f) => f.measure), 'text[]')}) AS k(key, yr, measure)
      LEFT JOIN ${s.versionTable} v ON v.tenant_id = ${stmt.tenant} AND v.${s.versionItemFk} = c.id AND v.budget_year = k.yr AND ${validity}
      LEFT JOIN ${s.roundTable} ri ON ri.tenant_id = ${stmt.tenant} AND ri.version_id = v.id AND ri.measure = k.measure AND ri.fte IS NOT NULL
      GROUP BY k.key`
    : null;
  const sql = `${stmt.withClause([['core', `SELECT i.id, i.currency, i.disabled_at\n${core.from}\n${core.where}`]])}SELECT
  ${amounts ? `(SELECT coalesce(json_agg(a), '[]'::json) FROM (${amounts}) a)` : `'[]'::json`} AS amounts,
  ${fte ? `(SELECT coalesce(json_agg(f), '[]'::json) FROM (${fte}) f)` : `'[]'::json`} AS fte`;
  const [row] = await run(manager, stmt, sql);

  const centsByYear = new Map<number, Record<string, bigint>>();
  for (const entry of row.amounts as Array<Record<string, any>>) {
    centsByYear.set(Number(entry.yr), Object.fromEntries(columns.map((c) => [c.measure, BigInt(entry[c.measure] ?? '0')])));
  }
  const result: Record<string, number | string> = {};
  for (const amount of wanted) {
    result[amount.key] = Number(formatCents(centsByYear.get(amount.year)?.[amount.measure] ?? 0n));
  }
  result.reportingCurrency = fx.reportingCurrency;
  if (!fteKeys.length) return result;

  const fteByKey = new Map((row.fte as Array<{ key: string; total: string | null; unknown: number; lines: number }>).map((entry) => [entry.key, entry]));
  const fteTotals: Record<string, FteTotal> = {};
  for (const { key } of fteKeys) {
    const entry = fteByKey.get(key);
    const unknown = entry ? Number(entry.unknown) : 0;
    const lines = entry ? Number(entry.lines) : 0;
    fteTotals[key] = { total: unknown < lines && entry?.total != null ? Number(entry.total) : null, unknown };
  }
  return Object.assign(result, { fte: fteTotals });
}

/** One row of an aggregate: a group, the others or the total. */
export interface BudgetListAggregateRow {
  /** The group's keys, one per `groupBy` field (null for a blank value); none for the others and the total. */
  keys: Array<string | null>;
  /** Lines in the row. */
  count: number;
  /** Per measure id: an amount in the reporting currency (exact to the cent) or an FTE; null when there is no value. */
  values: Record<string, number | null>;
  /** Per FTE measure id: the lines without an FTE (left out of the value). */
  unknown: Record<string, number>;
}

export interface BudgetListAggregate {
  /** The groups in the spec's order (the first `limit` ones with a limit). */
  groups: BudgetListAggregateRow[];
  /** With `limit` and `others`: the groups past the limit as one row, null when there are none. */
  others: BudgetListAggregateRow | null;
  /** Every line of the list state (`having` aside). */
  total: BudgetListAggregateRow;
  /** Groups kept (by `having`), before the limit. */
  groupCount: number;
  /** The currency of the amounts (null when the spec reads none). */
  reportingCurrency: string | null;
}

/**
 * The lines of a list state (same query as the page: filters, quick search,
 * status scope, `years`; without a status, the page's default window)
 * grouped by fields of the list, with sums, means, lowest and highest of
 * amounts (exact cents, each line converted to the cent first, as the
 * footer totals) and of FTE, ordered, optionally a top N with the others
 * as one row, and the list's total: one statement (`common/list-engine/list-aggregate.ts`).
 */
export async function budgetListAggregate(
  scope: SummaryScopeConfig,
  deps: SummaryDeps,
  query: any,
  spec: AggregateSpec,
  manager: EntityManager,
): Promise<BudgetListAggregate> {
  validateAggregateSpec(spec);
  const req = await readRequest(query, manager);
  const specKeys = [...spec.groupBy, ...spec.measures.flatMap((measure) => [measure.field, ...(measure.minus ? [measure.minus] : [])])];
  assertBudgetYearsWithinBounds([...req.years, ...yearsNamedByFields(specKeys)], req.currentYear);
  const state = stateOf(req, windowScope(req));
  const needs = budgetRuntimeNeeds(req.currentYear, [...requestKeys(req, false), ...specKeys], !!state.q);
  const rt = await runtimeFor(scope, deps, new RequestFxRates(deps.fxRates), manager, req, needs);
  const config = new BudgetListConfig(rt);
  const stmt = new SqlStatement(req.tenantId);
  const rows = await run(manager, stmt, aggregateSql(stmt, config, state, spec));

  const money = spec.measures.map((measure) => stmt.fieldCache.get(measure.field)?.kind === 'money');
  const shape = (row: any): BudgetListAggregateRow => ({
    keys: row.part === 'g' ? spec.groupBy.map((_, i) => row[`k${i}`] ?? null) : [],
    count: Number(row.n),
    values: Object.fromEntries(spec.measures.map((measure, i) => {
      const text = row[`m${i}`];
      return [measure.id, text == null ? null : money[i] ? centsToNumber(BigInt(text)) : Number(text)];
    })),
    unknown: Object.fromEntries(spec.measures.flatMap((measure, i) => (money[i] ? [] : [[measure.id, Number(row[`u${i}`])]]))),
  });
  const total = rows.find((row: any) => row.part === 't');
  const others = rows.find((row: any) => row.part === 'o');
  return {
    groups: rows.filter((row: any) => row.part === 'g').map(shape),
    others: others ? shape(others) : null,
    total: shape(total),
    groupCount: Number(total.gc),
    // Amounts in the lines' own currencies (`local_…`) are in no one currency.
    reportingCurrency: money.some((isMoney, i) => isMoney && !resolveLocalAmountField(spec.measures[i].field)) ? rt.fx?.reportingCurrency ?? null : null,
  };
}

/**
 * The body of `POST /spend-items/summary/aggregate` (and CAPEX):
 * `{ query, spec }`. `query` is what the list's GET takes (`filters` as an
 * object or as JSON, `q`, `status`, `includeDisabled`, `years`; a POST
 * because exclusion lists and cost centre subtrees can be long), and `ctx`, a
 * saved list context, merged as the GET routes merge it (its filters, unless
 * the query has its own). The answer is `budgetListAggregate`'s.
 */
export async function budgetListAggregateRequest(
  scope: SummaryScopeConfig,
  deps: SummaryDeps,
  body: unknown,
  manager: EntityManager,
): Promise<BudgetListAggregate> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('Aggregate: the body is { query, spec }.');
  const { query: rawQuery, spec } = body as { query?: unknown; spec?: unknown };
  if (rawQuery != null && (typeof rawQuery !== 'object' || Array.isArray(rawQuery))) throw new BadRequestException('Aggregate: query must be an object.');
  let query = (rawQuery ?? {}) as Record<string, unknown>;
  validateAggregateSpec(spec as AggregateSpec);
  if (query.ctx !== undefined && query.ctx !== '') {
    const stored = await new ListContextsService().require(manager, await summaryTenantId(manager), query.ctx);
    query = mergeListContextQuery(stored.state, query);
  }
  return budgetListAggregate(scope, deps, query, spec as AggregateSpec, manager);
}

/**
 * Rows of the given lines, in the order given (no lifecycle scope, no list
 * statement): the AI detail, which names its line by id.
 */
export async function budgetListRowsByIds(
  scope: SummaryScopeConfig,
  deps: SummaryDeps,
  query: BudgetListRowsByIdsQuery,
  manager: EntityManager,
): Promise<BudgetSummaryRow[]> {
  const requested = (query.ids ?? []).filter(Boolean);
  const ids = Array.from(new Set(requested));
  if (!ids.length) return [];
  const tenantId = await summaryTenantId(manager);
  const currentYear = new Date().getFullYear();
  const items = await itemsInOrder(scope, manager, tenantId, ids);
  const rows = await buildBudgetSummaryRows(scope, deps, manager, tenantId, items, {
    years: Array.from(new Set([...fixedYears(currentYear), ...parseSummaryYears(query.years)])),
    currentYear,
    includeLatestTask: query.includeLatestTask ?? false,
    includeRecipientDetails: query.includeRecipientDetails ?? false,
    includeNextYearAllocation: query.includeNextYearAllocation ?? false,
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  return requested.map((id) => byId.get(id)).filter((row): row is BudgetSummaryRow => !!row);
}
