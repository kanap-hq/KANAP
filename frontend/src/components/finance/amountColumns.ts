import type { ColDef } from 'ag-grid-community';
import type { TFunction } from 'i18next';
import { formatAmount } from '../../i18n/formatters';

/**
 * The five budget columns as the summary API names them: totals key in a year slot, suffix of the
 * field keys (`yBudget`, `yPlus1Forecast`…) and label. Every amount list iterates this one table,
 * so no behaviour depends on a column name.
 */
export const AMOUNT_COLUMNS = [
  { key: 'budget', suffix: 'Budget', labelKey: 'ops:operations.budgetColumns.budget' },
  { key: 'revision', suffix: 'Revision', labelKey: 'ops:operations.budgetColumns.revision' },
  { key: 'forecast', suffix: 'Forecast', labelKey: 'ops:operations.budgetColumns.forecast' },
  { key: 'follow_up', suffix: 'FollowUp', labelKey: 'ops:operations.budgetColumns.followUp' },
  { key: 'landing', suffix: 'Landing', labelKey: 'ops:operations.budgetColumns.landing' },
] as const;

export type AmountColumn = (typeof AMOUNT_COLUMNS)[number];
export type AmountColumnKey = AmountColumn['key'];

/** Fixed year slots of the summary API, relative to the current year. */
export const YEAR_SLOTS = [
  { slot: 'yMinus2', offset: -2 },
  { slot: 'yMinus1', offset: -1 },
  { slot: 'y', offset: 0 },
  { slot: 'yPlus1', offset: 1 },
  { slot: 'yPlus2', offset: 2 },
] as const;

export type YearSlot = (typeof YEAR_SLOTS)[number]['slot'];

/** Years the OPEX and CAPEX lists show (Y-1 to Y+2); Y-2 stays in the API and the AI. */
export const LIST_YEAR_SLOTS: readonly YearSlot[] = ['yMinus1', 'y', 'yPlus1', 'yPlus2'];

/** Amount columns shown until the user picks others in the column chooser (display defaults only). */
export const LIST_DEFAULT_VISIBLE_AMOUNTS: readonly string[] = ['yBudget', 'yLanding'];

export type SlotAmounts = Partial<Record<AmountColumnKey, number>>;
export type SummarySlot = {
  year?: number;
  version_id?: string;
  totals?: SlotAmounts;
  reporting?: SlotAmounts & { currency?: string; reporting_currency?: string };
};
export type SummaryVersions = Partial<Record<string, SummarySlot>>;

export const amountFieldKey = (slot: string, column: AmountColumn): string => `${slot}${column.suffix}`;

export const slotYear = (slot: YearSlot, currentYear: number): number =>
  currentYear + (YEAR_SLOTS.find((s) => s.slot === slot)?.offset ?? 0);

/** Amount in the reporting currency when the server converted it, else in the item currency. */
export function slotAmount(slot: SummarySlot | undefined, key: AmountColumnKey): number {
  const value = Number(slot?.reporting?.[key] ?? slot?.totals?.[key] ?? 0);
  return Number.isFinite(value) ? value : 0;
}

/** Calendar year of an amount column (`yPlus1Forecast` gives Y+1), null for any other column. */
export function amountColumnYear(colId: string | undefined, currentYear: number): number | null {
  if (!colId) return null;
  for (const { slot } of YEAR_SLOTS) {
    for (const column of AMOUNT_COLUMNS) {
      if (amountFieldKey(slot, column) === colId) return slotYear(slot, currentYear);
    }
  }
  return null;
}

/** Year slots for a totals row: every cell reads the totals key of the same name. */
export function totalsToVersions(
  totals: Record<string, unknown> | null | undefined,
  slots: readonly YearSlot[] = LIST_YEAR_SLOTS,
): SummaryVersions {
  const versions: SummaryVersions = {};
  for (const slot of slots) {
    const amounts: SlotAmounts = {};
    for (const column of AMOUNT_COLUMNS) {
      const value = Number(totals?.[amountFieldKey(slot, column)] ?? 0);
      amounts[column.key] = Number.isFinite(value) ? value : 0;
    }
    versions[slot] = { totals: amounts, reporting: amounts };
  }
  return versions;
}

/** Year label of a slot with its calendar year, e.g. "Y-1 (2025)". */
export function yearSlotLabel(t: TFunction, slot: YearSlot, currentYear: number): string {
  return t('ops:shared.yearSlotWithYear', { slot: t(`ops:shared.yearSlots.${slot}`), year: slotYear(slot, currentYear) });
}

/** Header of an amount column from the column label and the year, e.g. "Budget Y (2026)". */
export function amountColumnHeader(t: TFunction, slot: YearSlot, column: AmountColumn, currentYear: number): string {
  return t('ops:shared.amountColumnHeader', {
    column: t(column.labelKey),
    slot: t(`ops:shared.yearSlots.${slot}`),
    year: slotYear(slot, currentYear),
  });
}

export type AmountColDef<T> = ColDef<T> & { defaultHidden?: boolean };

/**
 * Comparisons only: cells show whole units of a converted amount, so an exact match rarely hits,
 * and a missing amount reads as zero, so blank / not blank would keep all or nothing. The box
 * under the header means "at least".
 */
export const AMOUNT_FILTER_PARAMS = {
  suppressAndOrCondition: true,
  maxNumConditions: 1,
  buttons: ['clear'],
  filterOptions: ['greaterThanOrEqual', 'greaterThan', 'lessThanOrEqual', 'lessThan', 'equals', 'notEqual', 'inRange'],
  defaultOption: 'greaterThanOrEqual',
};

/**
 * Every column of every list year, year by year in the order of AMOUNT_COLUMNS. Cells show the
 * reporting amount, the server filters them with number models and sorts them by the same key.
 */
export function buildAmountColumnDefs<T>({
  t,
  currentYear,
  cellRenderer,
}: {
  t: TFunction;
  currentYear: number;
  cellRenderer: (colId: string) => ColDef<T>['cellRenderer'];
}): AmountColDef<T>[] {
  return LIST_YEAR_SLOTS.flatMap((slot) => AMOUNT_COLUMNS.map((column): AmountColDef<T> => {
    const colId = amountFieldKey(slot, column);
    return {
      colId,
      headerName: amountColumnHeader(t, slot, column, currentYear),
      valueGetter: (p) => slotAmount((p.data as { versions?: SummaryVersions } | undefined)?.versions?.[slot], column.key),
      valueFormatter: (p) => formatAmount(p.value),
      type: 'rightAligned',
      width: 180,
      filter: 'agNumberColumnFilter',
      filterParams: AMOUNT_FILTER_PARAMS,
      // The grid's default floating filter writes text models; amounts need number models.
      floatingFilterComponent: 'agNumberColumnFloatingFilter',
      defaultHidden: !LIST_DEFAULT_VISIBLE_AMOUNTS.includes(colId),
      cellRenderer: cellRenderer(colId),
    };
  }));
}
