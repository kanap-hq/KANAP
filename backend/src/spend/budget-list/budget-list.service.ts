import type { EntityManager } from 'typeorm';
import { formatCents } from '../../common/amount';
import { assertListEngineSupport } from '../../common/list-engine/list-engine-support';
import type { ListState } from '../../common/list-engine/list-engine.types';
import { fieldOf, filterValuesSql, idsSql, neighborsSql, pageSql, countSql, buildCore } from '../../common/list-engine/list-sql-builder';
import { parseListRequest, ParsedListRequest, resolveLifecycleScope } from '../../common/list-engine/list-state';
import { compareNullableText, decimal2ToFloat, jsRound } from '../../common/list-engine/sql-fragments';
import { SqlStatement } from '../../common/list-engine/sql-statement';
import type { LifecycleScope } from '../../common/status';
import { parseAnalyticsFieldKey } from '../../analytics/analytics-axes.util';
import {
  buildBudgetSummaryRows,
  BudgetSummaryRow,
  FIXED_SLOTS,
  parseSummaryYears,
  resolveFteField,
  SUMMARY_COLUMNS,
  SummaryDeps,
  SummaryScopeConfig,
  summaryTenantId,
  yearsNamedByFields,
} from '../spend-summary.builder';
import { BudgetListConfig, budgetRuntimeNeeds } from './budget-list.config';
import { fxJoinCurrency, fxTableSql, RequestFxRates } from './budget-fx-table';
import { BudgetListRuntime, loadBudgetRuntime, mergeNeeds, RuntimeNeeds } from './budget-list.runtime';

/**
 * The OPEX list endpoints on the SQL list engine (`common/list-engine`):
 * one statement decides the page, the count, the ordered ids, the filter
 * values or the footer totals; the row builder then draws the page's lines
 * only. Same signatures and response shapes as the in-memory functions of
 * `budget-summary.ts` (which CAPEX still uses), without their 10,000-line cap.
 */

/** Fields the column filters can list values for, on both item types (plus each type's own fields and every dimension key). */
export const FILTER_VALUE_FIELDS = [
  'supplier_name', 'paying_company_name', 'company_name', 'account_display', 'allocation_label', 'allocation_method_label',
  'contract_name', 'currency', 'owner_it_name', 'owner_business_name', 'analytics_category_name', 'project_name',
  'project_stream_name', 'project_category_name', 'cost_center_label', 'cost_center_code', 'cost_center_name', 'cost_center_path',
  'budget_holder_name', 'run_build',
];

export type BudgetListRowOptions = {
  includeRecipientDetails?: boolean;
  includeNextYearAllocation?: boolean;
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

async function readRequest(query: any, manager: EntityManager): Promise<BudgetRequest> {
  const tenantId = await summaryTenantId(manager);
  await assertListEngineSupport(manager);
  const currentYear = new Date().getFullYear();
  const request = parseListRequest(query);
  const requestedYears = parseSummaryYears(query?.years);
  const namedYears = yearsNamedByFields([request.sort.field, ...Object.keys(request.filters)]);
  return {
    tenantId,
    currentYear,
    request,
    requestedYears,
    years: Array.from(new Set([...fixedYears(currentYear), ...requestedYears, ...namedYears])),
  };
}

/** The items still active on January 1 of the earliest requested year (the year before this one by default). */
function windowScope(req: BudgetRequest): LifecycleScope {
  const first = req.requestedYears.length ? Math.min(...req.requestedYears) : req.currentYear - 1;
  return { activeSince: new Date(`${first}-01-01T00:00:00.000Z`) };
}

function stateOf(req: BudgetRequest, fallback: LifecycleScope): ListState {
  const r = req.request;
  return { page: r.page, limit: r.limit, skip: r.skip, sort: r.sort, q: r.q, filters: r.filters, scope: resolveLifecycleScope(r, fallback) };
}

/** Keys the statement reads for the request's own sort and filters. */
function requestKeys(req: BudgetRequest, withSort: boolean): string[] {
  return [...(withSort ? [req.request.sort.field] : []), ...Object.keys(req.request.filters)];
}

async function runtimeFor(
  scope: SummaryScopeConfig,
  fxRates: RequestFxRates,
  manager: EntityManager,
  req: BudgetRequest,
  needs: RuntimeNeeds,
): Promise<BudgetListRuntime> {
  return loadBudgetRuntime(scope, { fxRates }, manager, req.tenantId, req.currentYear, needs);
}

async function run(manager: EntityManager, stmt: SqlStatement, sql: string): Promise<any[]> {
  const final = stmt.finalize(sql);
  return manager.query(final.sql, final.params);
}

async function itemsInOrder(scope: SummaryScopeConfig, manager: EntityManager, tenantId: string, ids: string[]): Promise<any[]> {
  if (!ids.length) return [];
  const items: any[] = await manager.getRepository<any>(scope.itemEntity as any)
    .createQueryBuilder('i')
    .where('i.tenant_id = :tenantId', { tenantId })
    .andWhere('i.id = ANY(:ids)', { ids })
    .orderBy('i.created_at', 'DESC')
    .addOrderBy('i.id', 'DESC')
    .getMany();
  const byId = new Map(items.map((item) => [item.id, item]));
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
 * The ids of one page and the list's count: the statement every page and
 * scroll block runs. A page past the end counts the list apart.
 */
export async function budgetListPageIds(
  scope: SummaryScopeConfig,
  deps: SummaryDeps,
  query: any,
  manager: EntityManager,
  opts: { allocationLabels?: boolean; fxRates?: RequestFxRates } = {},
): Promise<{ ids: string[]; total: number; labels: Map<string, string>; req: BudgetRequest; fxRates: RequestFxRates }> {
  const req = await readRequest(query, manager);
  const fxRates = opts.fxRates ?? new RequestFxRates(deps.fxRates);
  const state = stateOf(req, windowScope(req));
  const needs = budgetRuntimeNeeds(req.currentYear, requestKeys(req, true), !!state.q);
  if (opts.allocationLabels) needs.ruleYears = [...(needs.ruleYears ?? []), req.currentYear];
  const rt = await runtimeFor(scope, fxRates, manager, req, needs);
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
  const page = await budgetListPageIds(scope, deps, query, manager, { allocationLabels: grid });
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

/** The ordered ids of every line of the list (navigation, totals, AI aggregates). Without a status: active lines. */
export async function budgetListIds(
  scope: SummaryScopeConfig,
  deps: SummaryDeps,
  query: any,
  manager: EntityManager,
): Promise<{ ids: string[]; item_numbers: number[]; total: number }> {
  const req = await readRequest(query, manager);
  const state = stateOf(req, 'active');
  const rt = await runtimeFor(scope, new RequestFxRates(deps.fxRates), manager, req, budgetRuntimeNeeds(req.currentYear, requestKeys(req, true), !!state.q));
  const config = new BudgetListConfig(rt);
  const stmt = new SqlStatement(req.tenantId);
  const rows = await run(manager, stmt, idsSql(stmt, config, state, ['id', 'item_number']));
  return { ids: rows.map((row) => row.id), item_numbers: rows.map((row) => Number(row.item_number)), total: rows.length };
}

export type BudgetListNeighbor = { id: string; item_number: number } | null;

/**
 * Where one line stands in the list (0-based `index`, null when the list does
 * not hold it) and its previous and next lines: the workspace navigation
 * without downloading every id. Without a status: active lines, like the ids.
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
  const rt = await runtimeFor(scope, new RequestFxRates(deps.fxRates), manager, req, budgetRuntimeNeeds(req.currentYear, requestKeys(req, true), !!state.q));
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
  const rt = await runtimeFor(scope, new RequestFxRates(deps.fxRates), manager, req, needs);
  const config = new BudgetListConfig(rt);
  const stmt = new SqlStatement(req.tenantId);
  const rows = await run(manager, stmt, filterValuesSql(stmt, config, state, fields));
  const result: Record<string, Array<string | null>> = {};
  fields.forEach((field) => { result[field] = []; });
  for (const row of rows) result[fields[Number(row.f)]].push(row.v ?? null);
  for (const field of fields) result[field].sort(compareNullableText);
  return result;
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
 * after each line's end of validity. Each version is converted to the cent
 * once and the sums are exact (bigint cents). With `fte=<keys>`, `fte` sums
 * each FTE key over the lines and counts the lines whose FTE is unknown.
 * Without a status: active lines.
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
  const slots = [
    ...FIXED_SLOTS.map((slot) => ({ key: slot.key as string, year: Y + slot.offset })),
    ...req.requestedYears.map((year) => ({ key: `y${year}`, year })),
  ];
  const slotYears = Array.from(new Set(slots.map((slot) => slot.year)));
  const fteKeys = parseFteKeys(query?.fte, Y);
  const needs = mergeNeeds(budgetRuntimeNeeds(Y, requestKeys(req, false), !!state.q), { fxYears: slotYears });
  const rt = await runtimeFor(scope, new RequestFxRates(deps.fxRates), manager, req, needs);
  const config = new BudgetListConfig(rt);
  const stmt = new SqlStatement(req.tenantId);
  const core = buildCore(stmt, config, state);
  const s = scope;
  const fx = rt.fx!;
  stmt.cte('fx', () => fxTableSql((value, cast) => stmt.bind(value, cast), fx));
  // A version shows only up to the UTC year of its line's end of validity.
  const validity = `(c.disabled_at IS NULL OR v.budget_year <= extract(year FROM c.disabled_at AT TIME ZONE 'UTC'))`;
  // Each version converted once (the builder's chain, `Math.round(Number(formatCents(local)) * rate * 100)`),
  // the products computed once per row (OFFSET 0 keeps the subquery from being flattened into the sums).
  const products = SUMMARY_COLUMNS.map((column) => `${decimal2ToFloat(`t.${column.measure}`)} * coalesce(fx.rate, 1::float8) * 100 AS ${column.measure}`).join(',\n          ');
  const sums = SUMMARY_COLUMNS.map((column) => `sum(${jsRound(`x.${column.measure}`)}::bigint)::text AS ${column.measure}`).join(',\n        ');
  const amounts = `SELECT x.yr,
        ${sums}
      FROM (
        SELECT v.budget_year AS yr,
          ${products}
        FROM core c
        JOIN ${s.versionTable} v ON v.tenant_id = ${stmt.tenant} AND v.${s.versionItemFk} = c.id
          AND v.budget_year = ANY(${stmt.bind(slotYears, 'int[]')}) AND ${validity}
        JOIN ${s.totalsTable} t ON t.tenant_id = ${stmt.tenant} AND t.version_id = v.id
        LEFT JOIN fx ON fx.yr = v.budget_year AND fx.cur = ${fxJoinCurrency('c')}
          AND fx.set_key = CASE WHEN v.fx_rate_set_id = ANY(${stmt.bind(fx.knownSets, 'uuid[]')}) THEN v.fx_rate_set_id::text ELSE 'live' END
        OFFSET 0
      ) x
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
  (SELECT coalesce(json_agg(a), '[]'::json) FROM (${amounts}) a) AS amounts,
  ${fte ? `(SELECT coalesce(json_agg(f), '[]'::json) FROM (${fte}) f)` : `'[]'::json`} AS fte`;
  const [row] = await run(manager, stmt, sql);

  const centsByYear = new Map<number, Record<string, bigint>>();
  for (const entry of row.amounts as Array<Record<string, any>>) {
    centsByYear.set(Number(entry.yr), Object.fromEntries(SUMMARY_COLUMNS.map((c) => [c.measure, BigInt(entry[c.measure] ?? '0')])));
  }
  const result: Record<string, number | string> = {};
  for (const slot of slots) {
    for (const column of SUMMARY_COLUMNS) {
      result[`${slot.key}${column.suffix}`] = Number(formatCents(centsByYear.get(slot.year)?.[column.measure] ?? 0n));
    }
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
