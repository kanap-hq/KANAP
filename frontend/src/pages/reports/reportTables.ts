/**
 * The key tables of the budget reports, built from the aggregate answers that `reportAggregates.ts`
 * reads: the columns (key, header, kind), the rows and the footer rows. The screens build their grid
 * from them and the API writes the same tables into its exports (`GET reports/budget/<report>/export`).
 *
 * Pure and self-contained: the only import is `./reportAggregates`. The backend holds a byte-identical
 * copy of both files (`backend/src/spend/reports/shared/`), checked by a spec: change this file, then
 * copy it there. Headers and fixed words come in already translated (`labels`), never through `t`.
 * Values are values, never display strings: amounts in currency units, FTE as numbers, percentages
 * as fractions (`0.125` for 12.5 %); the screen formats them, the export writes them as cells.
 */

import {
  METRIC_SUFFIX,
  MONTHS,
  readAnalytics,
  readColumnsCompare,
  readConsolidation,
  readCostPerFte,
  readDailyRate,
  readDelta,
  readStaffing,
  readTopItems,
  readTrend,
  type AggregateResult,
  type ColumnYear,
  type DeltaMode,
  type FteYearGroups,
  type MetricKey,
  type ReportMeasure,
  type StaffingLabels,
} from './reportAggregates';

/** `amount`: currency units; `number`: FTE and years; `count`: a number of lines (a whole number); `percent`: a fraction. */
export type ReportTableColumnKind = 'text' | 'number' | 'count' | 'amount' | 'percent';

export interface ReportTableColumn {
  /** The row field the column reads (the grid's `field`). */
  key: string;
  header: string;
  kind: ReportTableColumnKind;
}

export type ReportTableCell = string | number | null;

/** A row by column key; it may hold more fields than the columns read (a line's id for its link). */
export type ReportTableRow = Record<string, ReportTableCell | undefined>;

export interface ReportTableData {
  columns: ReportTableColumn[];
  rows: ReportTableRow[];
  /** Total rows, after the data rows. */
  footer: ReportTableRow[];
}

/**
 * The words of the tables, already translated: the screens take them from their locale files, the API
 * from its label tables (checked against the same files).
 */
export interface ReportTableLabels {
  /** The five budget columns as the screens name them: the tenant's names, else the product names. */
  columnNames: Record<MetricKey, string>;
  /** A column read as FTE (`reports.measure.columnFte`: `Budget FTE`). */
  columnFte: (column: string) => string;
  /** `reports.filters.metric` */
  metric: string;
  /** `reports.filters.year` */
  year: string;
  /** `reports.filters.column` */
  column: string;
  /** `reports.columns.selection` */
  selection: string;
  /** `reports.columns.total` */
  total: string;
  /** `reports.measure.totalFte` */
  totalFte: string;
  /** `reports.columns.item` */
  item: string;
  /** `opex.columns.reference`: the business reference of a budget line (`BL-12`). */
  reference: string;
  /** `reports.columns.shareOfTotal` */
  shareOfTotal: string;
  /** `reports.columns.delta` */
  delta: string;
  /** `reports.columns.pctIncrease` */
  pctIncrease: string;
  /** `reports.columns.consolidationAccount` */
  consolidationAccount: string;
  /** `reports.consolidation.unassigned` */
  consolidationUnassigned: string;
  /** `reports.consolidation.totalMetric`: `Total Budget`. */
  consolidationTotal: (metric: string) => string;
  /** `reports.analyticsCategory.unassigned` */
  analyticsUnassigned: string;
  /** `reports.analyticsCategory.unnamed` */
  analyticsUnnamed: string;
  /** `reports.analyticsCategory.totalMetric`: `Total Budget`. */
  analyticsTotal: (metric: string) => string;
  /** `reports.analyticsCategory.lines`: the number of lines of a value. */
  analyticsLines: string;
  /** The twelve short month names, January first, in the table's language (`shortMonthNames`). */
  monthNames: readonly string[];
  /** `reports.staffing.average` */
  average: string;
  /** `reports.staffing.peak` */
  peak: string;
  /** `reports.measure.fte` */
  fte: string;
  /** `reports.costPerFte.staffCost` */
  staffCost: string;
  /** `reports.costPerFte.costPerFte` */
  costPerFte: string;
  /** `reports.costPerFte.days` */
  days: string;
  /** `reports.costPerFte.dayCost` */
  dayCost: string;
  /** `reports.costPerFte.dailyRate` */
  dailyRate: string;
}

/** The five budget columns in their fixed order (column 1 to 5). */
export const COLUMN_ORDER = Object.keys(METRIC_SUFFIX) as MetricKey[];

/** The kind of a measured value: amounts, or FTE as numbers. */
export function measureKind(measure: ReportMeasure): ReportTableColumnKind {
  return measure === 'fte' ? 'number' : 'amount';
}

/** A budget column's name for the measure: `Budget`, or `Budget FTE`. */
export function measureColumnName(labels: Pick<ReportTableLabels, 'columnNames' | 'columnFte'>, metric: MetricKey, measure: ReportMeasure): string {
  const name = labels.columnNames[metric];
  return measure === 'fte' ? labels.columnFte(name) : name;
}

/** A measured total as a cell: FTE nobody declares stays blank (null), a missing amount is 0. */
export function measureCell(value: number | null | undefined, measure: ReportMeasure): number | null {
  return measure === 'fte' ? value ?? null : value || 0;
}

// ----- Comparison (ComparisonReport): one row per column, one column per year -----

export interface ComparisonTableParams {
  /** The years of the range, in order. */
  years: readonly number[];
  /** The columns, in the order picked. */
  metrics: readonly MetricKey[];
  measure: ReportMeasure;
}

export function comparisonTable(
  p: ComparisonTableParams,
  result: AggregateResult | undefined,
  labels: Pick<ReportTableLabels, 'columnNames' | 'columnFte' | 'metric'>,
): ReportTableData {
  const totals = readTrend(p, result, p.measure);
  const kind = measureKind(p.measure);
  return {
    columns: [
      { key: 'metric', header: labels.metric, kind: 'text' },
      ...p.years.map((year): ReportTableColumn => ({ key: String(year), header: String(year), kind })),
    ],
    rows: p.metrics.map((metric) => {
      const row: ReportTableRow = { _key: metric, metric: measureColumnName(labels, metric, p.measure) };
      for (const year of p.years) row[String(year)] = measureCell(totals[metric]?.[year], p.measure);
      return row;
    }),
    footer: [],
  };
}

// ----- Columns compare (BudgetColumnsCompareReport): one total per year and column picked -----

export type ColumnSelection = { year: number; metric: MetricKey };

/** The selections as the report shows and asks them: by year, then in column order. */
export function sortColumnSelections(selections: readonly ColumnSelection[]): ColumnSelection[] {
  return [...selections].sort((a, b) => (a.year !== b.year ? a.year - b.year : COLUMN_ORDER.indexOf(a.metric) - COLUMN_ORDER.indexOf(b.metric)));
}

/** The columns the selections use, in the order they first appear. */
export function columnsInUse(selections: readonly ColumnSelection[]): MetricKey[] {
  return Array.from(new Set(selections.map((selection) => selection.metric)));
}

/** Year grouping applies when asked and every column in use is picked for two years or more. */
export function columnsCompareGrouped(selections: readonly ColumnSelection[], yearGrouping: boolean): boolean {
  if (!yearGrouping) return false;
  const metrics = columnsInUse(selections);
  if (metrics.length === 0) return false;
  return metrics.every((metric) => new Set(selections.filter((s) => s.metric === metric).map((s) => s.year)).size >= 2);
}

export interface ColumnsCompareTableParams {
  /** Sorted (`sortColumnSelections`), as the request was built. */
  selections: readonly ColumnSelection[];
  measure: ReportMeasure;
  /** The "group by year" box: the year-grouped table when it applies (`columnsCompareGrouped`). */
  yearGrouping: boolean;
}

/**
 * The flat table (one row per selection: `2026 Budget`, year, column, total) or, when year grouping
 * applies, one row per year and one column per column in use; a year and column picked twice adds up.
 */
export function columnsCompareTable(
  p: ColumnsCompareTableParams,
  result: AggregateResult | undefined,
  labels: Pick<ReportTableLabels, 'columnNames' | 'columnFte' | 'year' | 'column' | 'selection' | 'total' | 'totalFte'>,
): ReportTableData & { grouped: boolean } {
  const fte = p.measure === 'fte';
  const kind = measureKind(p.measure);
  const totals = readColumnsCompare(p.selections, result, p.measure);
  if (!columnsCompareGrouped(p.selections, p.yearGrouping)) {
    return {
      grouped: false,
      columns: [
        { key: 'selection', header: labels.selection, kind: 'text' },
        { key: 'year', header: labels.year, kind: 'number' },
        { key: 'column', header: labels.column, kind: 'text' },
        { key: 'total', header: fte ? labels.totalFte : labels.total, kind },
      ],
      rows: p.selections.map((selection, index) => ({
        key: `${selection.year}-${selection.metric}-${index}`,
        selection: `${selection.year} ${labels.columnNames[selection.metric]}`,
        year: selection.year,
        column: labels.columnNames[selection.metric],
        total: fte ? totals[index] ?? null : totals[index] ?? 0,
      })),
      footer: [],
    };
  }
  // A year and column picked twice adds up twice, as the flat table lists it twice. FTE nobody declares stays null.
  const byYearAndColumn = new Map<string, number | null>();
  p.selections.forEach((selection, index) => {
    const key = `${selection.year}:${selection.metric}`;
    const value = totals[index] ?? null;
    if (value == null) {
      if (!byYearAndColumn.has(key)) byYearAndColumn.set(key, fte ? null : 0);
      return;
    }
    byYearAndColumn.set(key, (byYearAndColumn.get(key) || 0) + value);
  });
  const years = Array.from(new Set(p.selections.map((selection) => selection.year))).sort((a, b) => a - b);
  const metrics = columnsInUse(p.selections);
  return {
    grouped: true,
    columns: [
      { key: 'year', header: labels.year, kind: 'number' },
      ...metrics.map((metric): ReportTableColumn => ({ key: metric, header: measureColumnName(labels, metric, p.measure), kind })),
    ],
    rows: years.map((year) => {
      const row: ReportTableRow = { year };
      for (const metric of metrics) {
        const key = `${year}:${metric}`;
        row[metric] = byYearAndColumn.has(key) ? byYearAndColumn.get(key) ?? null : null;
      }
      return row;
    }),
    footer: [],
  };
}

// ----- Top lines (TopOpexReport) -----

export interface TopLinesTableParams {
  year: number;
  metric: MetricKey;
  measure: ReportMeasure;
}

/** A budget line's business reference (`BL-12`), from the number the aggregate groups it on. */
export function budgetLineReference(itemNumber: number | null | undefined): string | null {
  return itemNumber == null ? null : `BL-${itemNumber}`;
}

/**
 * The top lines (server order, largest first), each named by its business reference and its name, with
 * their share of the total of every kept line, as a fraction. The total and the top's sum stay outside
 * the table (`readTopItems`).
 */
export function topLinesTable(
  p: TopLinesTableParams,
  result: AggregateResult | undefined,
  labels: Pick<ReportTableLabels, 'columnNames' | 'columnFte' | 'item' | 'reference' | 'shareOfTotal'>,
): ReportTableData {
  const { processed, totalMetric } = readTopItems(result, p.measure);
  const total = totalMetric ?? 0;
  return {
    columns: [
      { key: 'reference', header: labels.reference, kind: 'text' },
      { key: 'name', header: labels.item, kind: 'text' },
      { key: 'value', header: `${measureColumnName(labels, p.metric, p.measure)} (${p.year})`, kind: measureKind(p.measure) },
      { key: 'pct_of_total', header: labels.shareOfTotal, kind: 'percent' },
    ],
    rows: processed.map((row) => ({
      id: row.id,
      itemNumber: row.itemNumber,
      reference: budgetLineReference(row.itemNumber),
      name: row.name,
      value: row.value,
      pct_of_total: total > 0 ? row.value / total : 0,
    })),
    footer: [],
  };
}

// ----- Increases and decreases (OpexDeltaReport) -----

export interface DeltaTableParams {
  source: { year: number; metric: MetricKey };
  destination: { year: number; metric: MetricKey };
  /** One answer per mode, in this order (`deltaRequests`): increases first, then decreases. */
  modes: readonly DeltaMode[];
  measure: ReportMeasure;
}

/**
 * The kept lines of each mode in the server's order (largest change first), each with both columns,
 * the change and the change as a fraction of the source (blank when the source is blank or not
 * above 0, as `readDelta`). The totals stay outside the table.
 */
export function deltaTable(
  p: DeltaTableParams,
  results: ReadonlyArray<AggregateResult | undefined>,
  labels: Pick<ReportTableLabels, 'columnNames' | 'columnFte' | 'item' | 'delta' | 'pctIncrease'>,
): ReportTableData {
  const kind = measureKind(p.measure);
  const { processed } = readDelta(p.modes, results, p.measure);
  const side = (picked: { year: number; metric: MetricKey }) => `${measureColumnName(labels, picked.metric, p.measure)} (${picked.year})`;
  return {
    columns: [
      { key: 'name', header: labels.item, kind: 'text' },
      { key: 'previous', header: side(p.source), kind },
      { key: 'current', header: side(p.destination), kind },
      { key: 'delta', header: labels.delta, kind },
      { key: 'pct_increase', header: labels.pctIncrease, kind: 'percent' },
    ],
    rows: processed.map((row) => ({
      id: row.id,
      itemNumber: row.itemNumber,
      name: row.name,
      previous: row.previous,
      current: row.current,
      delta: row.delta,
      pct_increase: row.pct_increase == null || row.previous == null ? null : row.delta / row.previous,
      direction: row.direction,
    })),
    footer: [],
  };
}

// ----- Per year groups (ConsolidationReport, AnalyticsCategoryReport) -----

export interface YearGroupsTableParams {
  /** The years of the range, in order. */
  years: readonly number[];
  metric: MetricKey;
  measure: ReportMeasure;
}

/** One row per group (`groupKey`, `groupName` kept for the screen's links), one column per year, the total as footer. */
function yearGroupsTable(
  p: YearGroupsTableParams,
  read: FteYearGroups,
  group: { header: string; total: string },
  options: { countHeader?: string } = {},
): ReportTableData {
  const kind = measureKind(p.measure);
  const footer: ReportTableRow = { group: group.total };
  if (options.countHeader) footer.count = read.lineCount ?? null;
  for (const year of p.years) footer[String(year)] = measureCell(read.totals[year], p.measure);
  return {
    columns: [
      { key: 'group', header: group.header, kind: 'text' },
      ...(options.countHeader ? [{ key: 'count', header: options.countHeader, kind: 'count' as const }] : []),
      ...p.years.map((year): ReportTableColumn => ({ key: String(year), header: String(year), kind })),
    ],
    rows: read.groups.map((g) => {
      const row: ReportTableRow = { group: g.label, groupKey: g.key, groupName: g.name ?? null };
      if (options.countHeader) row.count = g.count ?? null;
      for (const year of p.years) row[String(year)] = measureCell(g.values[year], p.measure);
      return row;
    }),
    footer: [footer],
  };
}

/** By consolidation account (server order: the first year's largest first), the total as footer. */
export function consolidationTable(
  p: YearGroupsTableParams,
  result: AggregateResult | undefined,
  labels: Pick<ReportTableLabels, 'columnNames' | 'columnFte' | 'consolidationAccount' | 'consolidationUnassigned' | 'consolidationTotal'>,
): ReportTableData {
  return yearGroupsTable(p, readConsolidation(p.years, result, labels.consolidationUnassigned, p.measure), {
    header: labels.consolidationAccount,
    total: labels.consolidationTotal(measureColumnName(labels, p.metric, p.measure)),
  });
}

export interface AnalyticsTableParams extends YearGroupsTableParams {
  /** The header of the group column: the dimension's name, or the product name of the default one. */
  dimension: string;
}

/** By value on the dimension (server order: the first year's largest first), the total as footer. */
export function analyticsTable(
  p: AnalyticsTableParams,
  result: AggregateResult | undefined,
  labels: Pick<ReportTableLabels, 'columnNames' | 'columnFte' | 'analyticsUnassigned' | 'analyticsUnnamed' | 'analyticsTotal' | 'analyticsLines'>,
): ReportTableData {
  const read = readAnalytics(p.years, result, { unassigned: labels.analyticsUnassigned, unnamed: labels.analyticsUnnamed }, p.measure);
  return yearGroupsTable(p, read, {
    header: p.dimension,
    total: labels.analyticsTotal(measureColumnName(labels, p.metric, p.measure)),
  }, { countHeader: labels.analyticsLines });
}

// ----- By group (StaffingByMonthReport, CostPerFteReport): grouped on a cost center, a line, a supplier or a dimension -----

export interface GroupTableParams {
  /** The header of the group column: the group kind (`reports.staffing.groups.<kind>`) or the dimension's name. */
  groupHeader: string;
  /** The rows without a key (`reports.staffing.none.<kind>`) and the dimension values without a name. */
  groupLabels: StaffingLabels;
  /** Orders the rows of equal value by label: a collator of the table's language (`new Intl.Collator(language).compare`). */
  compare: (a: string, b: string) => number;
}

/**
 * The twelve short month names of a language (`Jan` to `Dec`), January first: the month headers of the
 * staffing table. The language is explicit, so a server writes the names of the export's language
 * whatever its own default locale.
 */
export function shortMonthNames(language: string): string[] {
  const format = new Intl.DateTimeFormat(language, { month: 'short', timeZone: 'UTC' });
  return MONTHS.map((month) => format.format(new Date(Date.UTC(2000, month - 1, 1))));
}

/** The row field of a month (1 to 12) in the staffing table. */
export const staffingMonthKey = (month: number): string => `m${month}`;

/**
 * Staffing by month: one row per group with a monthly FTE (largest average first, then by label), the
 * twelve months, the average (sum ÷ 12) and the peak, all FTE; the total as footer. The notices under
 * the screen's table stay outside it (`readStaffing`).
 */
export function staffingTable(
  p: GroupTableParams,
  result: AggregateResult | undefined,
  labels: Pick<ReportTableLabels, 'monthNames' | 'average' | 'peak' | 'total'>,
): ReportTableData {
  const read = readStaffing(result, p.groupLabels, p.compare);
  const values = (row: { months: Array<number | null>; average: number | null; peak: number | null }): ReportTableRow => ({
    ...Object.fromEntries(MONTHS.map((month, i) => [staffingMonthKey(month), row.months[i]])),
    average: row.average,
    peak: row.peak,
  });
  return {
    columns: [
      { key: 'group', header: p.groupHeader, kind: 'text' },
      ...MONTHS.map((month, i): ReportTableColumn => ({ key: staffingMonthKey(month), header: labels.monthNames[i] ?? String(month), kind: 'number' })),
      { key: 'average', header: labels.average, kind: 'number' },
      { key: 'peak', header: labels.peak, kind: 'number' },
    ],
    rows: read.rows.map((row) => ({ group: row.label, groupKey: row.key, groupName: row.name, ...values(row) })),
    footer: [{ group: labels.total, ...values(read.total) }],
  };
}

// ----- Cost per FTE and daily rate (CostPerFteReport, `?view=rate`): three values per year and column compared -----

/** The cost per FTE, or the average daily rate (`?view=rate`). */
export type CostPerFteView = 'fte' | 'rate';

/** What a pair's three values are: what the rows count (FTE, days), its cost, and the cost of one unit. */
export type PairValueKind = 'fte' | 'days' | 'cost' | 'ratio' | 'rate';
export const PAIR_VALUES: Record<CostPerFteView, readonly [PairValueKind, PairValueKind, PairValueKind]> = {
  fte: ['fte', 'cost', 'ratio'],
  rate: ['days', 'cost', 'rate'],
};

/** The row field of a pair's value (`c0_fte`, `c1_rate`). */
export const pairValueKey = (index: number, kind: PairValueKind): string => `c${index}_${kind}`;

/** The pairs compared as the report shows and asks them: by year, then in column order, each once. */
export function distinctColumns(columns: readonly ColumnYear[]): ColumnYear[] {
  const byKey = new Map<string, ColumnYear>();
  for (const column of columns) byKey.set(`${column.year}:${column.metric}`, column);
  return Array.from(byKey.values()).sort((a, b) => a.year - b.year || COLUMN_ORDER.indexOf(a.metric) - COLUMN_ORDER.indexOf(b.metric));
}

/** A pair as the report names it: `Budget 2026`. */
export function pairLabel(labels: Pick<ReportTableLabels, 'columnNames'>, column: ColumnYear): string {
  return `${labels.columnNames[column.metric]} ${column.year}`;
}

/** The names of a view's three values: FTE, staff cost, cost per FTE; or days, day cost, daily rate. */
export function pairValueHeaders(view: CostPerFteView, labels: Pick<ReportTableLabels, 'fte' | 'days' | 'staffCost' | 'dayCost' | 'costPerFte' | 'dailyRate'>): Record<PairValueKind, string> {
  return {
    fte: labels.fte,
    days: labels.days,
    cost: view === 'rate' ? labels.dayCost : labels.staffCost,
    ratio: labels.costPerFte,
    rate: labels.dailyRate,
  };
}

const PAIR_VALUE_KIND: Record<PairValueKind, ReportTableColumnKind> = { fte: 'number', days: 'number', cost: 'amount', ratio: 'amount', rate: 'amount' };

export interface CostPerFteTableParams extends GroupTableParams {
  view: CostPerFteView;
  /** The pairs compared, as asked (`distinctColumns`). */
  columns: readonly ColumnYear[];
}

/**
 * Cost per FTE, or the daily rate: one row per group with FTE (or days) in some pair, by the earliest
 * pair that has them, largest first (then by label); per pair, in the screen's order, three columns with
 * flat headers, `<value> (<column> <year>)`: FTE, staff cost and cost per FTE, or days, day cost and
 * daily rate. The total as footer (ratio of the totals). `results` holds one answer per pair, in order.
 */
export function costPerFteTable(
  p: CostPerFteTableParams,
  results: ReadonlyArray<AggregateResult | undefined> | undefined,
  labels: Pick<ReportTableLabels, 'columnNames' | 'total' | 'fte' | 'days' | 'staffCost' | 'dayCost' | 'costPerFte' | 'dailyRate'>,
): ReportTableData {
  const kinds = PAIR_VALUES[p.view];
  const headers = pairValueHeaders(p.view, labels);
  const read = p.view === 'rate'
    ? readDailyRate(p.columns, results, p.groupLabels, p.compare)
    : readCostPerFte(p.columns, results, p.groupLabels, p.compare);
  const values = (cells: ReadonlyArray<Partial<Record<PairValueKind, number | null>> | undefined>): ReportTableRow => Object.fromEntries(
    p.columns.flatMap((_, index) => kinds.map((kind) => [pairValueKey(index, kind), cells[index]?.[kind] ?? null])),
  );
  return {
    columns: [
      { key: 'group', header: p.groupHeader, kind: 'text' },
      ...p.columns.flatMap((column, index) => kinds.map((kind): ReportTableColumn => ({
        key: pairValueKey(index, kind),
        header: `${headers[kind]} (${pairLabel(labels, column)})`,
        kind: PAIR_VALUE_KIND[kind],
      }))),
    ],
    rows: read.rows.map((row) => ({ group: row.label, groupKey: row.key, groupName: row.name, ...values(row.cells) })),
    footer: [{ group: labels.total, ...values(read.total) }],
  };
}
