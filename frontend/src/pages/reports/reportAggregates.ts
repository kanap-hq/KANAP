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

/**
 * What a budget report sums: the amounts of a column, or its declared FTE (the yearly average FTE a
 * column computed from quantity × price lines keeps on its record; a column without lines has none).
 * Every builder below takes it as an optional `measure` and, without it, asks exactly what it always
 * asked (the amounts).
 */
export type ReportMeasure = 'amount' | 'fte';

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

/** The declared FTE of a year and budget column (`fte_y2026Budget`): null for a line without one. */
export function fteField(year: number, metric: MetricKey): string {
  return `fte_${amountField(year, metric)}`;
}

/**
 * The declared FTE of a year and budget column when the column's amount no longer follows its lines
 * (spread or edited by hand since): null otherwise (`fte_detached_y2026Budget`).
 */
export function detachedFteField(year: number, metric: MetricKey): string {
  return `fte_detached_${amountField(year, metric)}`;
}

/**
 * The FTE of one month (1 to 12) of a year and budget column, from the monthly detail its lines
 * computed (`fte_month_03_y2026Budget`): null without a declared FTE or without monthly detail.
 */
export function monthlyFteField(year: number, metric: MetricKey, month: number): string {
  return `fte_month_${String(month).padStart(2, '0')}_${amountField(year, metric)}`;
}

/** The declared FTE of a year and budget column that has no monthly detail, null otherwise (`fte_nodetail_y2026Budget`). */
export function noDetailFteField(year: number, metric: MetricKey): string {
  return `fte_nodetail_${amountField(year, metric)}`;
}

/** The field a report sums for a year and column: the amount, or the declared FTE. */
export function measureField(year: number, metric: MetricKey, measure: ReportMeasure = 'amount'): string {
  return measure === 'fte' ? fteField(year, metric) : amountField(year, metric);
}

/** `yes` for a line that declares FTE in some year and column, null otherwise (the "Items with FTE" filter). */
export const HAS_FTE_FIELD = 'has_fte';

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

/** A set filter leaving out the listed values; `null` leaves out the lines without a value. */
export function dropValues(values: Array<string | null>): FilterModel {
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

/**
 * Sums the declared values exactly (in cents), as `sumAmounts`; null when none is declared: a sum
 * of FTE nobody declares is blank, like the server's totals.
 */
export function sumDeclared(values: Iterable<number | null | undefined>): number | null {
  let cents = 0;
  let declared = false;
  for (const value of values) {
    if (value == null) continue;
    declared = true;
    cents += Math.round(value * 100);
  }
  return declared ? cents / 100 : null;
}

const valueOf = (row: AggregateRow | null | undefined, id: string): number => row?.values[id] ?? 0;
/** A measure's value, null when no line holds one (an FTE nobody declared). */
const knownValueOf = (row: AggregateRow | null | undefined, id: string): number | null => row?.values[id] ?? null;
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
  /** Only the lines that declare FTE (in some year and column). */
  withFte?: boolean;
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
  if (picks.withFte) filters[HAS_FTE_FIELD] = keepValues(['yes']);
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

/** Whether a line of the window declares FTE (the bar's "Items with FTE" filter shows then). */
export function ftePresenceRequest(years?: readonly number[]): AggregateRequest {
  return { query: yearsQuery(years), spec: { groupBy: [HAS_FTE_FIELD], measures: [] } };
}

export function readFtePresence(result: AggregateResult | undefined): boolean {
  return (result?.groups ?? []).some((group) => group.keys[0] === 'yes');
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

// ----- the FTE notice: declared FTE whose column amount no longer follows its lines -----

/** A year and budget column a report shows. */
export type ColumnYear = { year: number; metric: MetricKey };

/** The most measures a spec with group keys may hold (the server's `groupedMeasures`), and without keys. */
export const GROUPED_MEASURE_CAP = 8;
export const MEASURE_CAP = 60;

const METRIC_OF_SUFFIX = Object.fromEntries(Object.entries(METRIC_SUFFIX).map(([metric, suffix]) => [suffix, metric])) as Record<string, MetricKey>;
const FTE_FIELD = /^fte_y(\d{4})([A-Za-z]+)$/;

function fteColumn(field: string | undefined): ColumnYear | null {
  const match = field ? FTE_FIELD.exec(field) : null;
  const metric = match ? METRIC_OF_SUFFIX[match[2]] : undefined;
  return match && metric ? { year: Number(match[1]), metric } : null;
}

/** The year and column pairs an FTE spec sums, once each, in the order its measures name them; none for amounts. */
function specFteColumns(spec: AggregateSpec): ColumnYear[] {
  const out = new Map<string, ColumnYear>();
  for (const measure of spec.measures) {
    for (const field of [measure.minus, measure.field]) {
      const column = fteColumn(field);
      if (column) out.set(`${column.metric}_${column.year}`, column);
    }
  }
  return Array.from(out.values());
}

const noticeMeasureId = (column: ColumnYear) => `detached_${column.metric}_${column.year}`;

function noticeMeasures(columns: readonly ColumnYear[]): AggregateMeasure[] {
  return columns.map((column) => ({ id: noticeMeasureId(column), fn: 'sum', field: detachedFteField(column.year, column.metric) }));
}

/**
 * An FTE spec with, for each column it sums, the FTE whose amount no longer follows the lines,
 * when they fit under the measure cap (read on the total row). An amount spec, or one they do not
 * fit in, comes back as it is: `fteNoticeRequest` then asks them apart.
 */
function withFteNotice(spec: AggregateSpec): AggregateSpec {
  const columns = specFteColumns(spec);
  if (!columns.length) return spec;
  const cap = spec.groupBy.length ? GROUPED_MEASURE_CAP : MEASURE_CAP;
  if (spec.measures.length + columns.length > cap) return spec;
  return { ...spec, measures: [...spec.measures, ...noticeMeasures(columns)] };
}

/** The columns of a report request the notice reads: the FTE columns it sums, none for amounts. */
export function fteNoticeColumns(request: AggregateRequest | null | undefined): ColumnYear[] {
  return request ? specFteColumns(request.spec) : [];
}

/**
 * The notice's own request when the report's request could not carry its measures (one total, same
 * lines); null for an amount request or when the report's answer already holds them.
 */
export function fteNoticeRequest(request: AggregateRequest | null | undefined): AggregateRequest | null {
  const columns = fteNoticeColumns(request);
  if (!request || !columns.length) return null;
  const measures = noticeMeasures(columns);
  if (measures.every((measure) => request.spec.measures.some((m) => m.id === measure.id))) return null;
  const capped = measures.slice(0, MEASURE_CAP);
  return { query: request.query, spec: { groupBy: [], measures: capped } };
}

export type FteNoticeEntry = ColumnYear & { fte: number; items: number };

/**
 * Per column of the request, in its order, the FTE declared by lines whose amount no longer follows
 * their lines and how many lines that is (the total row's count minus the lines without that value);
 * only the columns where it is not zero. `result` is the answer holding the notice measures.
 */
export function readFteNotice(request: AggregateRequest | null | undefined, result: AggregateResult | undefined): FteNoticeEntry[] {
  const total = result?.total;
  if (!total) return [];
  const entries: FteNoticeEntry[] = [];
  for (const column of fteNoticeColumns(request)) {
    const id = noticeMeasureId(column);
    const fte = knownValueOf(total, id);
    if (fte == null || fte === 0) continue;
    entries.push({ ...column, fte, items: total.count - (total.unknown[id] ?? 0) });
  }
  return entries;
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
  measure?: ReportMeasure;
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
    spec: withFteNotice({
      groupBy: ['id', NAME_FIELD[p.scope]],
      measures: [{ id: 'value', fn: 'sum', field: measureField(p.year, p.metric, p.measure) }],
      order: [{ by: 'measure', id: 'value', dir: 'DESC' }],
      limit: topLimit(p.topCount),
    }),
  };
}

export type TopItemRow = { id: string; name: string; value: number; pct_of_total: number };

/**
 * The top lines, their share of the total and the top's sum. FTE: the lines without a declared FTE
 * are left out, and the total and the top's sum are null when no line declares one.
 */
export function readTopItems(result: AggregateResult | undefined): { processed: TopItemRow[]; totalMetric: number; topSelectionTotal: number };
export function readTopItems(result: AggregateResult | undefined, measure: ReportMeasure): { processed: TopItemRow[]; totalMetric: number | null; topSelectionTotal: number | null };
export function readTopItems(result: AggregateResult | undefined, measure: ReportMeasure = 'amount') {
  const fte = measure === 'fte';
  const known = fte ? knownValueOf(result?.total, 'value') : valueOf(result?.total, 'value');
  const totalMetric = known ?? 0;
  const groups = (result?.groups ?? []).filter((group) => !fte || knownValueOf(group, 'value') != null);
  const processed = groups.map((group) => {
    const value = valueOf(group, 'value');
    return { id: textKey(group, 0), name: textKey(group, 1), value, pct_of_total: totalMetric > 0 ? Math.round((value / totalMetric) * 100) : 0 };
  });
  const values = processed.map((row) => row.value);
  return { processed, totalMetric: fte ? known : totalMetric, topSelectionTotal: fte ? sumDeclared(values) : sumAmounts(values) };
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
  measure?: ReportMeasure;
}

/** One request per mode: the lines whose destination minus source is above (or below) zero, largest change first. */
export function deltaRequests(p: DeltaParams): AggregateRequest[] {
  const src = measureField(p.source.year, p.source.metric, p.measure);
  const dst = measureField(p.destination.year, p.destination.metric, p.measure);
  const filters = exclusions(p.filters, p.excludedIds, 'account_display', p.excludedAccounts);
  return p.modes.map((mode) => ({
    query: { filters },
    spec: withFteNotice({
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
    }),
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

/** FTE: a side without a declared FTE is null (the change counts it as 0), and so are totals no line declares. */
export type FteDeltaRow = Omit<DeltaRow, 'previous' | 'current'> & { previous: number | null; current: number | null };
export type FteDeltaTotals = { grossIncrease: number | null; grossDecrease: number | null; net: number | null };

/** The kept lines of each mode (in `modes` order) and the totals over every line of the state. */
export function readDelta(modes: readonly DeltaMode[], results: ReadonlyArray<AggregateResult | undefined>): { processed: DeltaRow[]; allTotals: DeltaTotals };
export function readDelta(modes: readonly DeltaMode[], results: ReadonlyArray<AggregateResult | undefined>, measure: ReportMeasure): { processed: FteDeltaRow[]; allTotals: FteDeltaTotals };
export function readDelta(modes: readonly DeltaMode[], results: ReadonlyArray<AggregateResult | undefined>, measure: ReportMeasure = 'amount') {
  const read = measure === 'fte' ? knownValueOf : valueOf;
  const processed: FteDeltaRow[] = [];
  modes.forEach((direction, i) => {
    for (const group of results[i]?.groups ?? []) {
      const previous = read(group, 'prev');
      const delta = valueOf(group, 'delta');
      processed.push({
        id: textKey(group, 0),
        name: textKey(group, 1),
        current: read(group, 'curr'),
        previous,
        delta,
        pct_increase: previous != null && previous > 0 ? (delta / previous) * 100 : null,
        direction,
      });
    }
  });
  const total = results.find(Boolean)?.total;
  const down = read(total, 'down');
  return { processed, allTotals: { grossIncrease: read(total, 'up'), grossDecrease: down == null ? null : down === 0 ? 0 : -down, net: read(total, 'delta') } };
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
/** FTE: a year no line of the group declares is null. */
export type FteYearGroup = { key: string; label: string; values: Record<number, number | null> };
export type FteYearGroups = { groups: FteYearGroup[]; totals: Record<number, number | null> };

function yearMeasures(years: readonly number[], metric: MetricKey, measure?: ReportMeasure): AggregateMeasure[] {
  return years.map((year) => ({ id: `y${year}`, fn: 'sum', field: measureField(year, metric, measure) }));
}

function yearValues(row: AggregateRow | null | undefined, years: readonly number[]): Record<number, number>;
function yearValues(row: AggregateRow | null | undefined, years: readonly number[], measure: ReportMeasure): Record<number, number | null>;
function yearValues(row: AggregateRow | null | undefined, years: readonly number[], measure: ReportMeasure = 'amount') {
  const read = measure === 'fte' ? knownValueOf : valueOf;
  return Object.fromEntries(years.map((year) => [year, read(row, `y${year}`)]));
}

/** FTE: only the groups that declare FTE in one of the years (a sum of nobody's FTE is no group). */
function declaredGroups(result: AggregateResult | undefined, years: readonly number[], measure: ReportMeasure): AggregateRow[] {
  const groups = result?.groups ?? [];
  return measure === 'fte' ? groups.filter((group) => years.some((year) => knownValueOf(group, `y${year}`) != null)) : groups;
}

/** The Consolidation exclusion option for the lines without a consolidation line (unassigned). */
export const NO_CONSOLIDATION_LINE = 'none';

export interface ConsolidationParams {
  years: readonly number[];
  metric: MetricKey;
  excludedAccountIds: readonly string[];
  filters: ColumnFilters;
  measure?: ReportMeasure;
}

/**
 * By consolidation line of the line's account (`c_<number>`, else `c_<name>`;
 * none: unassigned), one sum per year, the first year's largest first. The
 * server keys and labels the lines (`account_consolidation_key`, one label
 * per key).
 */
export function consolidationRequest(p: ConsolidationParams): AggregateRequest {
  const accountIds = p.excludedAccountIds.filter((id) => id !== NO_CONSOLIDATION_LINE);
  let filters = exclusions(p.filters, [], 'account_id', accountIds);
  if (accountIds.length < p.excludedAccountIds.length) filters = withFilter(filters, 'account_consolidation_key', dropValues([null]));
  return {
    query: { filters },
    spec: withFteNotice({
      groupBy: ['account_consolidation_key', 'account_consolidation_label'],
      measures: yearMeasures(p.years, p.metric, p.measure),
      order: [{ by: 'measure', id: `y${p.years[0]}`, dir: 'DESC' }],
    }),
  };
}

export function readConsolidation(years: readonly number[], result: AggregateResult | undefined, unassigned: string): YearGroups;
export function readConsolidation(years: readonly number[], result: AggregateResult | undefined, unassigned: string, measure: ReportMeasure): FteYearGroups;
export function readConsolidation(years: readonly number[], result: AggregateResult | undefined, unassigned: string, measure: ReportMeasure = 'amount') {
  const groups = declaredGroups(result, years, measure).map((group) => ({
    key: group.keys[0] ?? 'unassigned',
    label: group.keys[0] == null ? unassigned : group.keys[1] ?? '',
    values: yearValues(group, years, measure),
  }));
  return { groups, totals: yearValues(result?.total, years, measure) };
}

export interface AnalyticsParams {
  /** The dimension grouped on; null: the default one. */
  axisId: string | null;
  years: readonly number[];
  metric: MetricKey;
  excludedIds: readonly string[];
  filters: ColumnFilters;
  measure?: ReportMeasure;
}

/**
 * By the line's value on the dimension (none: unassigned), one sum per year, the first year's largest first.
 * An excluded `NO_ANALYTICS_VALUE` leaves out the lines without a value.
 */
export function analyticsRequest(p: AnalyticsParams): AggregateRequest {
  const excluded = p.excludedIds.map((id) => (id === NO_ANALYTICS_VALUE ? null : id));
  const filters = excluded.length ? withFilter(p.filters, analyticsIdField(p.axisId), dropValues(excluded)) : p.filters;
  return {
    query: { filters },
    spec: withFteNotice({
      groupBy: [analyticsIdField(p.axisId), analyticsNameField(p.axisId)],
      measures: yearMeasures(p.years, p.metric, p.measure),
      order: [{ by: 'measure', id: `y${p.years[0]}`, dir: 'DESC' }],
    }),
  };
}

type AnalyticsLabels = { unassigned: string; unnamed: string };
export function readAnalytics(years: readonly number[], result: AggregateResult | undefined, labels: AnalyticsLabels): YearGroups;
export function readAnalytics(years: readonly number[], result: AggregateResult | undefined, labels: AnalyticsLabels, measure: ReportMeasure): FteYearGroups;
export function readAnalytics(years: readonly number[], result: AggregateResult | undefined, labels: AnalyticsLabels, measure: ReportMeasure = 'amount') {
  const groups = declaredGroups(result, years, measure).map((group) => {
    const id = group.keys[0];
    return {
      key: id ? `cat_${id}` : 'uncategorized',
      label: id ? (group.keys[1] ?? '').trim() || labels.unnamed : labels.unassigned,
      values: yearValues(group, years, measure),
    };
  });
  return { groups, totals: yearValues(result?.total, years, measure) };
}

// ----- staffing by month (StaffingByMonthReport) -----

/** What the staffing report groups on: a cost center, an item, a supplier or the value on a dimension. */
export type StaffingGroup = { kind: 'costCenter' | 'item' | 'supplier' } | { kind: 'axis'; axisId: string };

/** The months of a year, 1 to 12. */
export const MONTHS: readonly number[] = Array.from({ length: 12 }, (_, i) => i + 1);

const monthMeasureId = (month: number) => `m${String(month).padStart(2, '0')}`;
const DETACHED_MEASURE = 'detached';
const NO_DETAIL_MEASURE = 'nodetail';

/** The group keys of a grouping: an id, then its name. */
export function staffingGroupKeys(scope: BudgetScope, group: StaffingGroup): [string, string] {
  switch (group.kind) {
    case 'item': return ['id', NAME_FIELD[scope]];
    case 'supplier': return ['supplier_id', 'supplier_name'];
    case 'axis': return [analyticsIdField(group.axisId), analyticsNameField(group.axisId)];
    default: return ['cost_center_id', 'cost_center_label'];
  }
}

export interface StaffingParams {
  scope: BudgetScope;
  year: number;
  metric: MetricKey;
  group: StaffingGroup;
  filters: ColumnFilters;
}

/**
 * Per group, the FTE of each month of the column (`m01` to `m12`), with, read on the total row, the
 * FTE whose amount no longer follows the lines and the FTE declared without monthly detail. Every
 * group comes back: the reader drops the ones without any monthly FTE.
 */
export function staffingRequest(p: StaffingParams): AggregateRequest {
  return {
    query: { filters: p.filters },
    spec: {
      groupBy: staffingGroupKeys(p.scope, p.group),
      measures: [
        ...MONTHS.map((month) => ({ id: monthMeasureId(month), fn: 'sum' as const, field: monthlyFteField(p.year, p.metric, month) })),
        { id: DETACHED_MEASURE, fn: 'sum', field: detachedFteField(p.year, p.metric) },
        { id: NO_DETAIL_MEASURE, fn: 'sum', field: noDetailFteField(p.year, p.metric) },
      ],
    },
  };
}

/** Twelve monthly FTE (null: nobody's monthly FTE), their full-year average (sum ÷ 12) and the highest month. */
export type StaffingMonths = { months: Array<number | null>; average: number | null; peak: number | null };
export type StaffingRow = StaffingMonths & { key: string; label: string };
/** FTE declared by some lines (and how many lines): the notices under the table. */
export type StaffingNotice = { fte: number; items: number };
export type Staffing = {
  rows: StaffingRow[];
  total: StaffingMonths;
  /** FTE whose column amount no longer follows its lines. */
  detached: StaffingNotice | null;
  /** FTE declared without monthly detail: not in the months. */
  noDetail: StaffingNotice | null;
};

function staffingMonths(row: AggregateRow | null | undefined): StaffingMonths {
  const months = MONTHS.map((month) => knownValueOf(row, monthMeasureId(month)));
  const known = months.filter((value): value is number => value != null);
  if (!known.length) return { months, average: null, peak: null };
  return { months, average: known.reduce((sum, value) => sum + value, 0) / 12, peak: Math.max(...known) };
}

function staffingNotice(total: AggregateRow | undefined, id: string): StaffingNotice | null {
  const fte = knownValueOf(total, id);
  if (fte == null || fte === 0 || !total) return null;
  return { fte, items: total.count - (total.unknown[id] ?? 0) };
}

/** The labels of the rows without a key (`none`) and of a dimension value without a name (`unnamed`). */
export type StaffingLabels = { none: string; unnamed: string };

/**
 * The groups with a monthly FTE, largest average first (then by label), the total row and the two
 * notices. A group without a key reads `none`.
 */
export function readStaffing(result: AggregateResult | undefined, labels: StaffingLabels, compare: (a: string, b: string) => number): Staffing {
  const rows: StaffingRow[] = [];
  for (const group of result?.groups ?? []) {
    const months = staffingMonths(group);
    if (months.average == null) continue;
    const id = group.keys[0];
    rows.push({ key: id ?? '', label: id == null ? labels.none : (group.keys[1] ?? '').trim() || labels.unnamed, ...months });
  }
  rows.sort((a, b) => (b.average ?? 0) - (a.average ?? 0) || compare(a.label, b.label));
  return {
    rows,
    total: staffingMonths(result?.total),
    detached: staffingNotice(result?.total, DETACHED_MEASURE),
    noDetail: staffingNotice(result?.total, NO_DETAIL_MEASURE),
  };
}

/** The most groups the staffing chart draws on their own; the rest stack as one "Others" area. */
export const STAFFING_CHART_GROUPS = 8;

/**
 * The chart's areas: the largest groups by average (the rows come sorted), then the rest summed
 * month by month as `others` (null when there is no rest).
 */
export function staffingChartSeries(rows: readonly StaffingRow[], limit = STAFFING_CHART_GROUPS): { series: StaffingRow[]; others: Array<number | null> | null } {
  const series = rows.slice(0, limit);
  const rest = rows.slice(limit);
  if (!rest.length) return { series, others: null };
  const others = MONTHS.map((_, i) => {
    const values = rest.map((row) => row.months[i]).filter((value): value is number => value != null);
    return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
  });
  return { series, others };
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
  measure?: ReportMeasure;
}

/** One total per column and year of the range, over every line of the state. */
export function trendRequest(p: TrendParams): AggregateRequest {
  return {
    query: withYears({ filters: p.filters }, p.windowYears),
    spec: withFteNotice({ groupBy: [], measures: p.metrics.flatMap((metric) => p.years.map((year) => ({ id: columnMeasureId(metric, year), fn: 'sum' as const, field: measureField(year, metric, p.measure) }))) }),
  };
}

/** Per column, per year, the total; FTE: null for a year and column no line declares. */
export function readTrend(p: Pick<TrendParams, 'years' | 'metrics'>, result: AggregateResult | undefined): Record<string, Record<number, number>>;
export function readTrend(p: Pick<TrendParams, 'years' | 'metrics'>, result: AggregateResult | undefined, measure: ReportMeasure): Record<string, Record<number, number | null>>;
export function readTrend(p: Pick<TrendParams, 'years' | 'metrics'>, result: AggregateResult | undefined, measure: ReportMeasure = 'amount') {
  const read = measure === 'fte' ? knownValueOf : valueOf;
  const out: Record<string, Record<number, number | null>> = {};
  for (const metric of p.metrics) {
    out[metric] = Object.fromEntries(p.years.map((year) => [year, read(result?.total, columnMeasureId(metric, year))]));
  }
  return out;
}

export interface ColumnsCompareParams {
  selections: ReadonlyArray<{ year: number; metric: MetricKey }>;
  filters: ColumnFilters;
  measure?: ReportMeasure;
}

/** One total per distinct year and column picked; the window starts on the earliest year picked. */
export function columnsCompareRequest(p: ColumnsCompareParams): AggregateRequest {
  const years = Array.from(new Set(p.selections.map((s) => s.year))).sort((a, b) => a - b);
  const measures = new Map<string, AggregateMeasure>();
  for (const s of p.selections) measures.set(columnMeasureId(s.metric, s.year), { id: columnMeasureId(s.metric, s.year), fn: 'sum', field: measureField(s.year, s.metric, p.measure) });
  return { query: withYears({ filters: p.filters }, years), spec: withFteNotice({ groupBy: [], measures: Array.from(measures.values()) }) };
}

/** The total of each selection, in the order given; FTE: null for a selection no line declares. */
export function readColumnsCompare(selections: ReadonlyArray<{ year: number; metric: MetricKey }>, result: AggregateResult | undefined): number[];
export function readColumnsCompare(selections: ReadonlyArray<{ year: number; metric: MetricKey }>, result: AggregateResult | undefined, measure: ReportMeasure): Array<number | null>;
export function readColumnsCompare(selections: ReadonlyArray<{ year: number; metric: MetricKey }>, result: AggregateResult | undefined, measure: ReportMeasure = 'amount') {
  const read = measure === 'fte' ? knownValueOf : valueOf;
  return selections.map((s) => read(result?.total, columnMeasureId(s.metric, s.year)));
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
