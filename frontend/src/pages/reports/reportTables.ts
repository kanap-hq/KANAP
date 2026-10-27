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

import type { AggregateResult } from './reportAggregates';

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

/** An answer of the aggregate route, as the builders read it. */
export type ReportTableAnswer = AggregateResult | undefined;
