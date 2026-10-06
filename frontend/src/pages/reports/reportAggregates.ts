/**
 * The budget reports, the dashboard tiles and the budget operations pages on
 * the server's aggregates (perf plan, lot 2D): what each one asks
 * `POST /spend-items/summary/aggregate` (or `/capex-items/…`) and how it reads
 * the answer. Each page used to download every line (pages of 500 full rows)
 * and compute in the browser; the server now groups and sums, exactly in
 * cents.
 *
 * Pure functions and self-contained types, without a single import: the
 * backend parity spec (`backend/src/spend/__tests__/report-aggregates-parity.integration.spec.ts`)
 * runs these very functions against the former browser computation.
 */

export type BudgetScope = 'opex' | 'capex';
export type MetricKey = 'budget' | 'revision' | 'forecast' | 'follow_up' | 'landing';

/** The suffix of a budget column in the list's field keys (`y2026Budget`), as `AMOUNT_COLUMNS` names it. */
export const METRIC_SUFFIX: Record<MetricKey, string> = {
  budget: 'Budget',
  revision: 'Revision',
  forecast: 'Forecast',
  follow_up: 'FollowUp',
  landing: 'Landing',
};

/** The field naming a line: OPEX lines by their product name, CAPEX lines by their description. */
export const NAME_FIELD: Record<BudgetScope, 'product_name' | 'description'> = { opex: 'product_name', capex: 'description' };

/** The most groups one answer holds (the server's limit). */
export const MAX_GROUPS = 10_000;

// ----- the request and the answer (backend `list-aggregate.ts`, `budget-list.service.ts`) -----

export type FilterModel = Record<string, unknown>;
export type ColumnFilters = Record<string, FilterModel>;

/** The list state: the list's column filters and, for the window of lines, the years read. */
export interface AggregateQuery {
  filters?: ColumnFilters;
  /** `2025,2026`: the lines still active on 1 January of the earliest one (the year before this one by default). */
  years?: string;
  /** `enabled`: the lines enabled today, as the list shows by default (instead of the window of `years`). */
  status?: 'enabled' | 'disabled';
}

export interface AggregateMeasure {
  id: string;
  fn: 'sum' | 'min' | 'max' | 'avg';
  field: string;
  minus?: string;
  part?: 'positive' | 'negative';
}

export interface AggregateOrder {
  by: 'count' | 'measure' | 'key';
  id?: string;
  index?: number;
  dir: 'ASC' | 'DESC';
  nulls?: 'FIRST' | 'LAST';
}

export interface AggregateSpec {
  groupBy: string[];
  measures: AggregateMeasure[];
  having?: Array<{ measure: string; op: 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'ne'; value: number }>;
  order?: AggregateOrder[];
  limit?: number;
  others?: boolean;
}

export interface AggregateRequest {
  query: AggregateQuery;
  spec: AggregateSpec;
}

export interface AggregateRow {
  keys: Array<string | null>;
  count: number;
  values: Record<string, number | null>;
  unknown: Record<string, number>;
}

export interface AggregateResult {
  groups: AggregateRow[];
  others: AggregateRow | null;
  total: AggregateRow;
  groupCount: number;
  reportingCurrency: string | null;
}

// ----- fields and filters -----

/** The amount of a year and budget column in the reporting currency (`y2026Budget`). */
export function amountField(year: number, metric: MetricKey): string {
  return `y${year}${METRIC_SUFFIX[metric]}`;
}

/** The same amount in the line's own currency, not converted (`local_y2026Budget`): the operations pages show it. */
export function localAmountField(year: number, metric: MetricKey): string {
  return `local_${amountField(year, metric)}`;
}

/** The line's value id on a dimension; without a dimension, the default one's. */
export function analyticsIdField(axisId: string | null): string {
  return axisId ? `analytics_id_${axisId}` : 'analytics_category_id';
}

/** The line's value name on a dimension; without a dimension, the default one's. */
export function analyticsNameField(axisId: string | null): string {
  return axisId ? `analytics_${axisId}` : 'analytics_category_name';
}

/** A set filter keeping the listed values; `null` keeps the lines without a value. */
export function keepValues(values: Array<string | null>): FilterModel {
  return { filterType: 'set', values };
}

/** A set filter leaving out the listed values: lines without a value are kept. */
export function dropValues(values: string[]): FilterModel {
  return { filterType: 'set', mode: 'exclude', values };
}

/** The filters with one more model on a key; a key already filtered keeps both (every condition applies). */
export function withFilter(filters: ColumnFilters, key: string, model: FilterModel): ColumnFilters {
  const previous = filters[key];
  if (!previous) return { ...filters, [key]: model };
  const conditions = previous.operator === 'AND' && Array.isArray(previous.conditions) ? [...(previous.conditions as FilterModel[]), model] : [previous, model];
  return { ...filters, [key]: { operator: 'AND', conditions } };
}

/** A filter state that keeps no line (an address naming a cost center or values that cannot be read). */
export const NO_LINE: ColumnFilters = { id: keepValues([]) };

function yearsQuery(years?: readonly number[]): AggregateQuery {
  return years && years.length ? { years: years.join(',') } : {};
}

function withYears(query: AggregateQuery, years?: readonly number[]): AggregateQuery {
  return years && years.length ? { ...query, years: years.join(',') } : query;
}

/** Sums two-decimal amounts exactly (in cents), as the server sums. */
export function sumAmounts(values: Iterable<number>): number {
  let cents = 0;
  for (const value of values) cents += Math.round(value * 100);
  return cents / 100;
}

const valueOf = (row: AggregateRow | null | undefined, id: string): number => row?.values[id] ?? 0;
const textKey = (row: AggregateRow, index: number): string => row.keys[index] ?? '';

// ----- the filter bar (cost center, run or build, dimension values) -----

export type RunBuildPick = 'run' | 'build' | 'none';
/** The pick that keeps the lines holding no value on a dimension. */
export const NO_ANALYTICS_VALUE = 'none';

export interface ReportFilterPicks {
  /** The picked node and every node below it, or null for every line. */
  costCenterIds: readonly string[] | null;
  runBuild: RunBuildPick | null;
  /** Per dimension id, a value id or `none`. */
  analytics: ReadonlyArray<readonly [string, string]>;
}

/**
 * The bar's picks as column filters, keeping what the browser used to keep:
 * the lines under the node (lines without a cost center drop out), of the
 * kind of spend (`none`: neither run nor build), holding the value on each
 * dimension (`none`: holding none).
 */
export function reportFilterModels(picks: ReportFilterPicks): ColumnFilters {
  const filters: ColumnFilters = {};
  if (picks.costCenterIds) filters.cost_center_id = keepValues([...picks.costCenterIds]);
  if (picks.runBuild) filters.run_build = keepValues([picks.runBuild === 'none' ? null : picks.runBuild]);
  for (const [axisId, value] of picks.analytics) {
    filters[analyticsIdField(axisId)] = keepValues([value === NO_ANALYTICS_VALUE ? null : value]);
  }
  return filters;
}

/** Whether a line says run or build, and how many lines the report's window holds. */
export function runBuildPresenceRequest(years?: readonly number[]): AggregateRequest {
  return { query: yearsQuery(years), spec: { groupBy: ['run_build'], measures: [] } };
}

export function readRunBuildPresence(result: AggregateResult | undefined): { lineCount: number; hasRunBuild: boolean } {
  return {
    lineCount: result?.total.count ?? 0,
    hasRunBuild: (result?.groups ?? []).some((group) => group.keys[0] != null),
  };
}

/** The values the lines hold on a dimension (id and name), every line of the window. */
export function axisValuesRequest(axisId: string | null, years?: readonly number[]): AggregateRequest {
  return {
    query: yearsQuery(years),
    spec: { groupBy: [analyticsIdField(axisId), analyticsNameField(axisId)], measures: [], order: [{ by: 'key', index: 1, dir: 'ASC' }] },
  };
}

export type LabelledOption = { id: string; label: string };

/** The values held, named (`unnamed` for a blank name), by name as `compare` orders. */
export function readAxisValues(result: AggregateResult | undefined, unnamed: string, compare: (a: string, b: string) => number): LabelledOption[] {
  const options: LabelledOption[] = [];
  for (const group of result?.groups ?? []) {
    const id = group.keys[0];
    if (!id) continue;
    options.push({ id, label: (group.keys[1] ?? '').trim() || unnamed });
  }
  return options.sort((a, b) => compare(a.label, b.label));
}

// ----- exclusion pickers -----

export type NamedOption = { id: string; name: string };

/** Every line of the window, by id and name (the item exclusion picker). */
export function itemOptionsRequest(scope: BudgetScope, years?: readonly number[]): AggregateRequest {
  return {
    query: yearsQuery(years),
    spec: { groupBy: ['id', NAME_FIELD[scope]], measures: [], order: [{ by: 'key', index: 1, dir: 'ASC', nulls: 'FIRST' }] },
  };
}

export function readItemOptions(result: AggregateResult | undefined, compare: (a: string, b: string) => number): NamedOption[] {
  return (result?.groups ?? [])
    .map((group) => ({ id: group.keys[0] as string, name: group.keys[1] ?? '' }))
    .sort((a, b) => compare(a.name, b.name));
}

/** An account label of the exclusion picker, and the labels as the lines hold them (with outer spaces). */
export type AccountLabelOption = NamedOption & { values: string[] };

/** The account labels of the lines (`/summary/filter-values?fields=account_display`), one per trimmed label. */
export function accountLabelOptions(values: ReadonlyArray<string | null>, compare: (a: string, b: string) => number): AccountLabelOption[] {
  const byName = new Map<string, AccountLabelOption>();
  for (const value of values) {
    const name = value?.trim();
    if (!value || !name) continue;
    const option = byName.get(name);
    if (option) {
      if (!option.values.includes(value)) option.values.push(value);
    } else {
      byName.set(name, { id: name, name, values: [value] });
    }
  }
  return Array.from(byName.values()).sort((a, b) => compare(a.name, b.name));
}

/** The labels the lines hold for the picked account options (a label is picked by its trimmed text). */
export function excludedAccountValues(picked: readonly string[], options: readonly AccountLabelOption[]): string[] {
  const byId = new Map(options.map((option) => [option.id, option]));
  return picked.flatMap((id) => byId.get(id)?.values ?? [id]);
}

/** The accounts of the lines, by id, number and name (the Consolidation exclusion picker). */
export function accountIdOptionsRequest(years?: readonly number[]): AggregateRequest {
  return { query: yearsQuery(years), spec: { groupBy: ['account_id', 'account_number', 'account_name'], measures: [] } };
}

/** `[number] name`, `[number]`, the name, else `unnamed`; by label as `compare` orders. */
export function readAccountIdOptions(result: AggregateResult | undefined, unnamed: string, compare: (a: string, b: string) => number): LabelledOption[] {
  const options: LabelledOption[] = [];
  for (const group of result?.groups ?? []) {
    const id = group.keys[0];
    if (!id) continue;
    const parts: string[] = [];
    if (group.keys[1] != null) parts.push(`[${group.keys[1]}]`);
    if (group.keys[2]) parts.push(group.keys[2].trim());
    options.push({ id, label: parts.join(' ').trim() || unnamed });
  }
  return options.sort((a, b) => compare(a.label, b.label));
}

/** An account as `/accounts` lists it. */
export type AccountRow = { id: string; account_number: number | string | null; account_name: string | null };

/**
 * The Consolidation exclusion options: the tenant's accounts (`/accounts`, the 1,000 newest active
 * ones) and the accounts the lines use, inactive ones included (their lines count in their
 * consolidation line); `[number] name`, by label.
 */
export function mergeAccountOptions(
  accounts: readonly AccountRow[],
  used: AggregateResult | undefined,
  unnamed: string,
  compare: (a: string, b: string) => number,
): LabelledOption[] {
  const byId = new Map<string, LabelledOption>();
  for (const account of accounts) {
    const parts: string[] = [];
    if (account.account_number != null) parts.push(`[${account.account_number}]`);
    if (account.account_name) parts.push(account.account_name.trim());
    byId.set(account.id, { id: account.id, label: parts.join(' ').trim() || unnamed });
  }
  for (const option of readAccountIdOptions(used, unnamed, compare)) if (!byId.has(option.id)) byId.set(option.id, option);
  return Array.from(byId.values()).sort((a, b) => compare(a.label, b.label));
}

/** The Analytics exclusion options: the dimension's own values (the catalogue) and the ones the lines hold, by label. */
export function mergeAxisValueOptions(
  catalogue: ReadonlyArray<{ id: string; name: string | null }>,
  held: AggregateResult | undefined,
  unnamed: string,
  compare: (a: string, b: string) => number,
): LabelledOption[] {
  const byId = new Map<string, LabelledOption>();
  for (const value of catalogue) byId.set(value.id, { id: value.id, label: (value.name ?? '').trim() || unnamed });
  for (const value of readAxisValues(held, unnamed, compare)) if (!byId.has(value.id)) byId.set(value.id, value);
  return Array.from(byId.values()).sort((a, b) => compare(a.label, b.label));
}

// ----- top items (TopOpexReport) -----

export interface TopItemsParams {
  scope: BudgetScope;
  year: number;
  metric: MetricKey;
  topCount: number;
  excludedIds: readonly string[];
  /** The account labels to leave out, as the lines hold them. */
  excludedAccounts: readonly string[];
  filters: ColumnFilters;
  years?: readonly number[];
}

/** The number of lines a top shows: at least one, at most `MAX_GROUPS`. */
export function topLimit(topCount: number): number {
  return Math.min(MAX_GROUPS, Number.isFinite(topCount) && topCount > 0 ? Math.floor(topCount) : 1);
}

function exclusions(filters: ColumnFilters, excludedIds: readonly string[], accountKey: string, excludedAccounts: readonly string[]): ColumnFilters {
  let out = filters;
  if (excludedIds.length) out = withFilter(out, 'id', dropValues([...excludedIds]));
  if (excludedAccounts.length) out = withFilter(out, accountKey, dropValues([...excludedAccounts]));
  return out;
}

export function topItemsRequest(p: TopItemsParams): AggregateRequest {
  return {
    query: withYears({ filters: exclusions(p.filters, p.excludedIds, 'account_display', p.excludedAccounts) }, p.years),
    spec: {
      groupBy: ['id', NAME_FIELD[p.scope]],
      measures: [{ id: 'value', fn: 'sum', field: amountField(p.year, p.metric) }],
      order: [{ by: 'measure', id: 'value', dir: 'DESC' }],
      limit: topLimit(p.topCount),
    },
  };
}

export type TopItemRow = { id: string; name: string; value: number; pct_of_total: number };

export function readTopItems(result: AggregateResult | undefined): { processed: TopItemRow[]; totalMetric: number; topSelectionTotal: number } {
  const totalMetric = valueOf(result?.total, 'value');
  const processed = (result?.groups ?? []).map((group) => {
    const value = valueOf(group, 'value');
    return { id: textKey(group, 0), name: textKey(group, 1), value, pct_of_total: totalMetric > 0 ? Math.round((value / totalMetric) * 100) : 0 };
  });
  return { processed, totalMetric, topSelectionTotal: sumAmounts(processed.map((row) => row.value)) };
}

// ----- increases and decreases (OpexDeltaReport) -----

export type DeltaMode = 'increase' | 'decrease';

export interface DeltaParams {
  scope: BudgetScope;
  source: { year: number; metric: MetricKey };
  destination: { year: number; metric: MetricKey };
  modes: readonly DeltaMode[];
  topCount: number;
  excludedIds: readonly string[];
  excludedAccounts: readonly string[];
  filters: ColumnFilters;
}

/** One request per mode: the lines whose destination minus source is above (or below) zero, largest change first. */
export function deltaRequests(p: DeltaParams): AggregateRequest[] {
  const src = amountField(p.source.year, p.source.metric);
  const dst = amountField(p.destination.year, p.destination.metric);
  const filters = exclusions(p.filters, p.excludedIds, 'account_display', p.excludedAccounts);
  return p.modes.map((mode) => ({
    query: { filters },
    spec: {
      groupBy: ['id', NAME_FIELD[p.scope]],
      measures: [
        { id: 'prev', fn: 'sum', field: src },
        { id: 'curr', fn: 'sum', field: dst },
        { id: 'delta', fn: 'sum', field: dst, minus: src },
        { id: 'up', fn: 'sum', field: dst, minus: src, part: 'positive' },
        { id: 'down', fn: 'sum', field: dst, minus: src, part: 'negative' },
      ],
      having: [{ measure: 'delta', op: mode === 'increase' ? 'gt' : 'lt', value: 0 }],
      order: [{ by: 'measure', id: 'delta', dir: mode === 'increase' ? 'DESC' : 'ASC' }],
      limit: topLimit(p.topCount),
    },
  }));
}

export type DeltaRow = {
  id: string;
  name: string;
  current: number;
  previous: number;
  delta: number;
  pct_increase: number | null;
  direction: DeltaMode;
};

export type DeltaTotals = { grossIncrease: number; grossDecrease: number; net: number };

/** The kept lines of each mode (in `modes` order) and the totals over every line of the state. */
export function readDelta(modes: readonly DeltaMode[], results: ReadonlyArray<AggregateResult | undefined>): { processed: DeltaRow[]; allTotals: DeltaTotals } {
  const processed: DeltaRow[] = [];
  modes.forEach((direction, i) => {
    for (const group of results[i]?.groups ?? []) {
      const previous = valueOf(group, 'prev');
      const delta = valueOf(group, 'delta');
      processed.push({
        id: textKey(group, 0),
        name: textKey(group, 1),
        current: valueOf(group, 'curr'),
        previous,
        delta,
        pct_increase: previous > 0 ? (delta / previous) * 100 : null,
        direction,
      });
    }
  });
  const total = results.find(Boolean)?.total;
  const down = valueOf(total, 'down');
  return { processed, allTotals: { grossIncrease: valueOf(total, 'up'), grossDecrease: down === 0 ? 0 : -down, net: valueOf(total, 'delta') } };
}

/** Whether a line of the window shows a version in Y-2 and in Y+2: the year pickers offer those years only then. */
export function deltaYearsRequest(currentYear: number): AggregateRequest {
  return { query: {}, spec: { groupBy: [`has_version_y${currentYear - 2}`, `has_version_y${currentYear + 2}`], measures: [] } };
}

/** Y-1, Y and Y+1 once the window holds a line, and Y-2 and Y+2 when a line holds a version that year. */
export function readDeltaYears(result: AggregateResult | undefined, currentYear: number): number[] {
  if (!result || result.total.count === 0) return [];
  const groups = result.groups;
  const years = [currentYear - 1, currentYear, currentYear + 1];
  if (groups.some((group) => group.keys[0] != null)) years.unshift(currentYear - 2);
  if (groups.some((group) => group.keys[1] != null)) years.push(currentYear + 2);
  return years;
}

// ----- per year groups (ConsolidationReport, AnalyticsCategoryReport) -----

export type YearGroup = { key: string; label: string; values: Record<number, number> };
export type YearGroups = { groups: YearGroup[]; totals: Record<number, number> };

function yearMeasures(years: readonly number[], metric: MetricKey): AggregateMeasure[] {
  return years.map((year) => ({ id: `y${year}`, fn: 'sum', field: amountField(year, metric) }));
}

function yearValues(row: AggregateRow | null | undefined, years: readonly number[]): Record<number, number> {
  return Object.fromEntries(years.map((year) => [year, valueOf(row, `y${year}`)]));
}

export interface ConsolidationParams {
  years: readonly number[];
  metric: MetricKey;
  excludedAccountIds: readonly string[];
  filters: ColumnFilters;
}

/**
 * By consolidation line of the line's account (`c_<number>`, else `c_<name>`;
 * none: unassigned), one sum per year, the first year's largest first. The
 * server keys and labels the lines (`account_consolidation_key`, one label
 * per key).
 */
export function consolidationRequest(p: ConsolidationParams): AggregateRequest {
  return {
    query: { filters: exclusions(p.filters, [], 'account_id', p.excludedAccountIds) },
    spec: {
      groupBy: ['account_consolidation_key', 'account_consolidation_label'],
      measures: yearMeasures(p.years, p.metric),
      order: [{ by: 'measure', id: `y${p.years[0]}`, dir: 'DESC' }],
    },
  };
}

export function readConsolidation(years: readonly number[], result: AggregateResult | undefined, unassigned: string): YearGroups {
  const groups = (result?.groups ?? []).map((group) => ({
    key: group.keys[0] ?? 'unassigned',
    label: group.keys[0] == null ? unassigned : group.keys[1] ?? '',
    values: yearValues(group, years),
  }));
  return { groups, totals: yearValues(result?.total, years) };
}

export interface AnalyticsParams {
  /** The dimension grouped on; null: the default one. */
  axisId: string | null;
  years: readonly number[];
  metric: MetricKey;
  excludedIds: readonly string[];
  filters: ColumnFilters;
}

/** By the line's value on the dimension (none: unassigned), one sum per year, the first year's largest first. */
export function analyticsRequest(p: AnalyticsParams): AggregateRequest {
  return {
    query: { filters: exclusions(p.filters, [], analyticsIdField(p.axisId), p.excludedIds) },
    spec: {
      groupBy: [analyticsIdField(p.axisId), analyticsNameField(p.axisId)],
      measures: yearMeasures(p.years, p.metric),
      order: [{ by: 'measure', id: `y${p.years[0]}`, dir: 'DESC' }],
    },
  };
}

export function readAnalytics(years: readonly number[], result: AggregateResult | undefined, labels: { unassigned: string; unnamed: string }): YearGroups {
  const groups = (result?.groups ?? []).map((group) => {
    const id = group.keys[0];
    return {
      key: id ? `cat_${id}` : 'uncategorized',
      label: id ? (group.keys[1] ?? '').trim() || labels.unnamed : labels.unassigned,
      values: yearValues(group, years),
    };
  });
  return { groups, totals: yearValues(result?.total, years) };
}

// ----- sums per year and column (ComparisonReport, CapexBudgetTrendReport, BudgetColumnsCompareReport) -----

const columnMeasureId = (metric: MetricKey, year: number) => `${metric}_${year}`;

export interface TrendParams {
  /** The years of the range shown. */
  years: readonly number[];
  metrics: readonly MetricKey[];
  /** The years the report reads: the window starts on the earliest. */
  windowYears: readonly number[];
  filters: ColumnFilters;
}

/** One total per column and year of the range, over every line of the state. */
export function trendRequest(p: TrendParams): AggregateRequest {
  return {
    query: withYears({ filters: p.filters }, p.windowYears),
    spec: { groupBy: [], measures: p.metrics.flatMap((metric) => p.years.map((year) => ({ id: columnMeasureId(metric, year), fn: 'sum' as const, field: amountField(year, metric) }))) },
  };
}

export function readTrend(p: Pick<TrendParams, 'years' | 'metrics'>, result: AggregateResult | undefined): Record<string, Record<number, number>> {
  const out: Record<string, Record<number, number>> = {};
  for (const metric of p.metrics) {
    out[metric] = Object.fromEntries(p.years.map((year) => [year, valueOf(result?.total, columnMeasureId(metric, year))]));
  }
  return out;
}

export interface ColumnsCompareParams {
  selections: ReadonlyArray<{ year: number; metric: MetricKey }>;
  filters: ColumnFilters;
}

/** One total per distinct year and column picked; the window starts on the earliest year picked. */
export function columnsCompareRequest(p: ColumnsCompareParams): AggregateRequest {
  const years = Array.from(new Set(p.selections.map((s) => s.year))).sort((a, b) => a - b);
  const measures = new Map<string, AggregateMeasure>();
  for (const s of p.selections) measures.set(columnMeasureId(s.metric, s.year), { id: columnMeasureId(s.metric, s.year), fn: 'sum', field: amountField(s.year, s.metric) });
  return { query: withYears({ filters: p.filters }, years), spec: { groupBy: [], measures: Array.from(measures.values()) } };
}

/** The total of each selection, in the order given. */
export function readColumnsCompare(selections: ReadonlyArray<{ year: number; metric: MetricKey }>, result: AggregateResult | undefined): number[] {
  return selections.map((s) => valueOf(result?.total, columnMeasureId(s.metric, s.year)));
}

// ----- dashboard -----

/** The lines whose column grew from Y-1 to Y, largest growth first. */
export function topIncreasesRequest(scope: BudgetScope, metric: MetricKey, limit: number): AggregateRequest {
  const suffix = METRIC_SUFFIX[metric];
  return {
    query: {},
    spec: {
      groupBy: ['id', NAME_FIELD[scope], 'item_number'],
      measures: [{ id: 'delta', fn: 'sum', field: `y${suffix}`, minus: `yMinus1${suffix}` }],
      having: [{ measure: 'delta', op: 'gt', value: 0 }],
      order: [{ by: 'measure', id: 'delta', dir: 'DESC' }],
      limit,
    },
  };
}

export function readTopIncreases(result: AggregateResult | undefined): Array<{ id: string; name: string; itemNumber: number | null; delta: number }> {
  return (result?.groups ?? []).map((group) => {
    const itemNumber = group.keys[2] != null && group.keys[2] !== '' ? Number(group.keys[2]) : null;
    return { id: textKey(group, 0), name: textKey(group, 1), itemNumber: Number.isFinite(itemNumber) ? itemNumber : null, delta: valueOf(group, 'delta') };
  });
}

/** How many lines pass the filters: of the window, or of the lines enabled today with `status: 'enabled'`. */
export function countRequest(filters: ColumnFilters, status?: AggregateQuery['status']): AggregateRequest {
  return { query: status ? { filters, status } : { filters }, spec: { groupBy: [], measures: [] } };
}

/** This year's amount of a column in the reporting currency, as the list's column id (`yBudget`). */
export function currentYearField(metric: MetricKey): string {
  return `y${METRIC_SUFFIX[metric]}`;
}

/** Next year's amount of a column in the reporting currency, as the list's column id (`yPlus1Budget`). */
export function nextYearField(metric: MetricKey): string {
  return `yPlus1${METRIC_SUFFIX[metric]}`;
}

/** How many lines enabled today (the list's default) pass the filters, and their sum of this year's column. */
export function lineTotalRequest(filters: ColumnFilters, metric: MetricKey): AggregateRequest {
  return {
    query: { filters, status: 'enabled' },
    spec: { groupBy: [], measures: [{ id: 'value', fn: 'sum', field: currentYearField(metric) }] },
  };
}

export function readLineTotal(result: AggregateResult | undefined): { count: number; value: number } {
  return { count: result?.total.count ?? 0, value: valueOf(result?.total, 'value') };
}

/**
 * This year's column by cost center label (`code · name`; lines without one: a null key), over the
 * lines enabled today, the largest sums above zero first.
 */
export function costCenterTotalsRequest(metric: MetricKey, limit: number): AggregateRequest {
  return {
    query: { status: 'enabled' },
    spec: {
      groupBy: ['cost_center_label'],
      measures: [{ id: 'value', fn: 'sum', field: currentYearField(metric) }],
      having: [{ measure: 'value', op: 'gt', value: 0 }],
      order: [{ by: 'measure', id: 'value', dir: 'DESC' }],
      limit,
    },
  };
}

export function readCostCenterTotals(result: AggregateResult | undefined): Array<{ label: string | null; value: number }> {
  return (result?.groups ?? []).map((group) => ({ label: group.keys[0] ?? null, value: valueOf(group, 'value') }));
}

// ----- budget operations pages -----

/** Every line of the window from the earliest year, with amounts in the lines' own currency. */
export function operationLinesRequest(
  scope: BudgetScope,
  years: readonly number[],
  amounts: ReadonlyArray<{ id: string; year: number; metric: MetricKey }>,
): AggregateRequest {
  return {
    query: yearsQuery(Array.from(new Set(years)).sort((a, b) => a - b)),
    spec: { groupBy: ['id', NAME_FIELD[scope]], measures: amounts.map((a) => ({ id: a.id, fn: 'sum' as const, field: localAmountField(a.year, a.metric) })) },
  };
}

export function readOperationLines(result: AggregateResult | undefined): Array<{ id: string; name: string; values: Record<string, number> }> {
  return (result?.groups ?? []).map((group) => ({
    id: textKey(group, 0),
    name: textKey(group, 1),
    values: Object.fromEntries(Object.entries(group.values).map(([id, value]) => [id, value ?? 0])),
  }));
}
