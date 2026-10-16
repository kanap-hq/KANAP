import type { CustomDateProps } from 'ag-grid-react';
import DateEUField from './fields/DateEUField';

/**
 * The date input of every grid date filter: the app's date field, in the app's language, in place
 * of the browser's picker, which follows the browser's language. ServerDataGrid and ReportGrid
 * register it in place of the grid's own (`agDateInput`, GRID_DATE_COMPONENTS). It hands the grid
 * a local midnight, which the grid writes into the filter model as before (`2026-10-15 00:00:00`).
 */

/** AG Grid keeps a filter menu open on clicks inside an element of this class (the calendar). */
export const GRID_POPUP_CLASS = 'ag-custom-component-popup';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** The local day of a date as YYYY-MM-DD, or '' without one. */
export function dateToYmd(date: Date | null | undefined): string {
  if (!date || Number.isNaN(date.getTime())) return '';
  return `${String(date.getFullYear()).padStart(4, '0')}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** YYYY-MM-DD as a local midnight, or null when it is not a date. */
export function ymdToDate(ymd: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
  const date = new Date(y, m, d);
  date.setFullYear(y, m, d);
  return Number.isNaN(date.getTime()) ? null : date;
}

export default function GridDateField({ date, onDateChange }: CustomDateProps) {
  return (
    <DateEUField
      label=""
      hideLabel
      valueYmd={dateToYmd(date)}
      onChangeYmd={(ymd) => onDateChange(ymd ? ymdToDate(ymd) : null)}
      popoverClassName={GRID_POPUP_CLASS}
    />
  );
}

/**
 * The grid components that replace the grid's date input with GridDateField, for the
 * `components` option. AG Grid 32 takes a date component by this name only (`dateComponent` is no
 * longer a grid option).
 */
export const GRID_DATE_COMPONENTS = { agDateInput: GridDateField } as const;
