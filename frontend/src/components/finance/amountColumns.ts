import type { ColDef } from 'ag-grid-community';
import type { TFunction } from 'i18next';
import { formatAmount } from '../../i18n/formatters';
import type { FreezeColumn } from '../../services/freeze';
import type { AmountMeasure } from './roundPeriod';

type AmountColumnEntry = {
  readonly measure: AmountMeasure;
  readonly key: 'budget' | 'revision' | 'forecast' | 'follow_up' | 'landing';
  readonly suffix: 'Budget' | 'Revision' | 'Forecast' | 'FollowUp' | 'Landing';
  readonly freezeKey: FreezeColumn;
  readonly labelKey: string;
};

/**
 * The five budget columns in their fixed order (column 1 to 5), with every name each one has:
 * storage key (`measure`), summary API key (totals key in a year slot), suffix of the summary
 * field keys (`yBudget`, `yPlus1Forecast`…), freeze key and product label. Every screen iterates
 * this one table, so no behaviour depends on a column name.
 */
export const AMOUNT_COLUMNS = [
  { measure: 'planned', key: 'budget', suffix: 'Budget', freezeKey: 'budget', labelKey: 'ops:operations.budgetColumns.budget' },
  { measure: 'committed', key: 'revision', suffix: 'Revision', freezeKey: 'revision', labelKey: 'ops:operations.budgetColumns.revision' },
  { measure: 'forecast', key: 'forecast', suffix: 'Forecast', freezeKey: 'forecast', labelKey: 'ops:operations.budgetColumns.forecast' },
  { measure: 'actual', key: 'follow_up', suffix: 'FollowUp', freezeKey: 'actual', labelKey: 'ops:operations.budgetColumns.followUp' },
  { measure: 'expected_landing', key: 'landing', suffix: 'Landing', freezeKey: 'landing', labelKey: 'ops:operations.budgetColumns.landing' },
] as const satisfies readonly AmountColumnEntry[];

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

/** Year slot and column of an amount field key (`yPlus1Forecast`), null for any other column. */
export function parseAmountField(colId: string | null | undefined): { slot: YearSlot; column: AmountColumn } | null {
  if (!colId) return null;
  for (const { slot } of YEAR_SLOTS) {
    for (const column of AMOUNT_COLUMNS) {
      if (amountFieldKey(slot, column) === colId) return { slot, column };
    }
  }
  return null;
}

/** Calendar year of an amount column (`yPlus1Forecast` gives Y+1), null for any other column. */
export function amountColumnYear(colId: string | undefined, currentYear: number): number | null {
  const field = parseAmountField(colId);
  return field ? slotYear(field.slot, currentYear) : null;
}

/** The columns a list builds: the shown ones, and the ones it shows until the user picks others. */
export type ListAmountColumns = {
  shown: ReadonlyArray<AmountColumn & { label: string }>;
  displayDefaults: ReadonlyArray<AmountColumn>;
};

/** True when a list column id names an amount column that is not shown (so the list does not build it). */
function isHiddenAmountField(colId: string | null | undefined, shown: ListAmountColumns['shown']): boolean {
  const field = parseAmountField(colId);
  return !!field && !shown.some((c) => c.measure === field.column.measure);
}

/** A saved or linked sort on a column that is not shown falls back to the default sort. */
export function sortOnShownColumn(sort: string | null | undefined, shown: ListAmountColumns['shown'], fallback: string): string {
  if (!sort) return fallback;
  return isHiddenAmountField(sort.split(':')[0], shown) ? fallback : sort;
}

/**
 * The sort to keep in the URL and the list context: '' when it is the default sort, so that an
 * absent sort always means "the current default" and follows a change of the default column.
 */
export function explicitSort(sort: string | null | undefined, shown: ListAmountColumns['shown'], defaultSort: string): string {
  const usable = sortOnShownColumn(sort, shown, defaultSort);
  return usable === defaultSort ? '' : usable;
}

/** A saved or linked filter model without the filters on columns that are not shown. */
export function filtersOnShownColumns<M extends Record<string, unknown>>(model: M, shown: ListAmountColumns['shown']): M {
  const kept = Object.entries(model).filter(([colId]) => !isHiddenAmountField(colId, shown));
  return (kept.length === Object.keys(model).length ? model : Object.fromEntries(kept)) as M;
}

/** Same as `filtersOnShownColumns` for a serialised model (URL or stored list context); '' when nothing is left. */
export function filtersStringOnShownColumns(raw: string | null | undefined, shown: ListAmountColumns['shown']): string {
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return raw;
    const kept = filtersOnShownColumns(parsed as Record<string, unknown>, shown);
    if (kept === parsed) return raw;
    return Object.keys(kept).length > 0 ? JSON.stringify(kept) : '';
  } catch {
    return raw;
  }
}

/**
 * The list URL once the stored list context has filled what the URL leaves out (sort, search,
 * filters) and a sort or filter on a column that is not shown has fallen back to the defaults.
 * The default sort is left out, so the grid applies whatever the default is now.
 */
export function settleListSearch(
  search: string,
  stored: { sort?: string; q?: string; filters?: string } | null | undefined,
  shown: ListAmountColumns['shown'],
  defaultSort: string,
): string {
  const params = new URLSearchParams(search);
  const sort = explicitSort(params.get('sort') || stored?.sort, shown, defaultSort);
  if (sort) params.set('sort', sort); else params.delete('sort');
  if (!params.get('q') && stored?.q) params.set('q', stored.q);
  const filters = filtersStringOnShownColumns(params.get('filters') || stored?.filters || '', shown);
  if (filters) params.set('filters', filters); else params.delete('filters');
  return params.toString();
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

/** Header of an amount column from the column name and the year, e.g. "Budget Y (2026)". */
export function amountColumnHeader(t: TFunction, slot: YearSlot, columnName: string, currentYear: number): string {
  return t('ops:shared.amountColumnHeader', {
    column: columnName,
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
 * Every shown column of every list year, year by year in the fixed column order, named with the
 * tenant's names. Hidden columns are not built, so they are not in the chooser, sort or filters.
 * Visible by default: the display defaults of Y. Cells show the reporting amount, the server
 * filters them with number models and sorts them by the same key.
 */
export function buildAmountColumnDefs<T>({
  t,
  currentYear,
  cellRenderer,
  columns,
}: {
  t: TFunction;
  currentYear: number;
  cellRenderer: (colId: string) => ColDef<T>['cellRenderer'];
  columns: ListAmountColumns;
}): AmountColDef<T>[] {
  const visibleByDefault = new Set(columns.displayDefaults.map((column) => amountFieldKey('y', column)));
  return LIST_YEAR_SLOTS.flatMap((slot) => columns.shown.map((column): AmountColDef<T> => {
    const colId = amountFieldKey(slot, column);
    return {
      colId,
      headerName: amountColumnHeader(t, slot, column.label, currentYear),
      valueGetter: (p) => slotAmount((p.data as { versions?: SummaryVersions } | undefined)?.versions?.[slot], column.key),
      valueFormatter: (p) => formatAmount(p.value),
      type: 'rightAligned',
      width: 180,
      filter: 'agNumberColumnFilter',
      filterParams: AMOUNT_FILTER_PARAMS,
      // The grid's default floating filter writes text models; amounts need number models.
      floatingFilterComponent: 'agNumberColumnFloatingFilter',
      defaultHidden: !visibleByDefault.has(colId),
      cellRenderer: cellRenderer(colId),
    };
  }));
}
