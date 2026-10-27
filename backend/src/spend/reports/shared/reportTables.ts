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
  readColumnsCompare,
  readTopItems,
  readTrend,
  type AggregateResult,
  type MetricKey,
  type ReportMeasure,
} from './reportAggregates';

/** `amount`: currency units; `number`: FTE, years, counts; `percent`: a fraction. */
export type ReportTableColumnKind = 'text' | 'number' | 'amount' | 'percent';

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
  /** `reports.columns.shareOfTotal` */
  shareOfTotal: string;
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

/**
 * The top lines (server order, largest first) with their share of the total of every kept line, as a
 * fraction. The total and the top's sum stay outside the table (`readTopItems`).
 */
export function topLinesTable(
  p: TopLinesTableParams,
  result: AggregateResult | undefined,
  labels: Pick<ReportTableLabels, 'columnNames' | 'columnFte' | 'item' | 'shareOfTotal'>,
): ReportTableData {
  const { processed, totalMetric } = readTopItems(result, p.measure);
  const total = totalMetric ?? 0;
  return {
    columns: [
      { key: 'name', header: labels.item, kind: 'text' },
      { key: 'value', header: `${measureColumnName(labels, p.metric, p.measure)} (${p.year})`, kind: measureKind(p.measure) },
      { key: 'pct_of_total', header: labels.shareOfTotal, kind: 'percent' },
    ],
    rows: processed.map((row) => ({
      id: row.id,
      itemNumber: row.itemNumber,
      name: row.name,
      value: row.value,
      pct_of_total: total > 0 ? row.value / total : 0,
    })),
    footer: [],
  };
}
