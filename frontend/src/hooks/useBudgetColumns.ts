import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { AMOUNT_COLUMNS } from '../components/finance/amountColumns';
import { DEFAULT_BUDGET_COLUMNS, getBudgetColumns, type BudgetColumnsSettings } from '../services/budgetColumns';

export const BUDGET_COLUMNS_QUERY_KEY = ['budget-columns'] as const;

export type BudgetColumnView = (typeof AMOUNT_COLUMNS)[number] & {
  position: 1 | 2 | 3 | 4 | 5;
  /** Tenant name, else the translated product name. */
  label: string;
  customLabel: string | null;
  enabled: boolean;
  groupSpread: boolean;
  isDefault: boolean;
};

export type BudgetColumns = {
  /** False until the setting is loaded; every field holds the product defaults meanwhile. */
  ready: boolean;
  /**
   * Set when the setting could not be loaded (then `ready` is true and every field holds the product
   * defaults, so lists and reports still work). A screen that edits the setting must not offer these values.
   */
  error: Error | null;
  settings: BudgetColumnsSettings;
  /** The five columns, fixed order. */
  all: BudgetColumnView[];
  /** Shown columns, fixed order. */
  shown: BudgetColumnView[];
  defaultColumn: BudgetColumnView;
  /** Shown columns that follow the spread and the lines applied to all columns, fixed order. */
  group: BudgetColumnView[];
  /** Amount columns a list shows until the user picks others: the default column, then the last shown one. */
  displayDefaults: BudgetColumnView[];
  /** Accepts a storage, summary or freeze key; throws on anything else. */
  get(key: string): BudgetColumnView;
  label(key: string): string;
  /** List sort on the default column of the current year, e.g. `yBudget:DESC`. */
  defaultSort: string;
};

/** Pure core of the hook, exported for components that already hold the settings. */
export function resolveBudgetColumns(
  settings: BudgetColumnsSettings,
  t: TFunction,
  ready = true,
  error: Error | null = null,
): BudgetColumns {
  const all: BudgetColumnView[] = AMOUNT_COLUMNS.map((column, index) => {
    const customLabel = settings.labels?.[column.measure]?.trim() || null;
    return {
      ...column,
      position: (index + 1) as BudgetColumnView['position'],
      label: customLabel ?? t(column.labelKey),
      customLabel,
      enabled: settings.enabled?.[column.measure] === true,
      groupSpread: settings.group_spread?.[column.measure] === true,
      isDefault: column.measure === settings.default_column,
    };
  });
  // The server never sends an empty or inconsistent setting; the fallbacks keep a screen usable if it did.
  const shown = all.filter((c) => c.enabled);
  const visible = shown.length > 0 ? shown : all;
  const defaultColumn = visible.find((c) => c.isDefault) ?? visible[0];
  const group = shown.filter((c) => c.groupSpread);
  const last = visible[visible.length - 1];
  const displayDefaults = last.measure === defaultColumn.measure ? [defaultColumn] : [defaultColumn, last];

  const byKey = new Map<string, BudgetColumnView>();
  for (const column of all) {
    byKey.set(column.measure, column);
    byKey.set(column.key, column);
    byKey.set(column.freezeKey, column);
  }
  const get = (key: string): BudgetColumnView => {
    const column = byKey.get(key);
    if (!column) throw new Error(`Unknown budget column key: ${key}`);
    return column;
  };

  return {
    ready,
    error,
    settings,
    all,
    shown: visible,
    defaultColumn,
    group,
    displayDefaults,
    get,
    label: (key: string) => get(key).label,
    defaultSort: `y${defaultColumn.suffix}:DESC`,
  };
}

/** The tenant's budget columns: names, shown columns, the group that follows the spread and the lines, and default column. */
export function useBudgetColumns(): BudgetColumns {
  const { t } = useTranslation(['ops']);
  const query = useQuery({
    queryKey: BUDGET_COLUMNS_QUERY_KEY,
    queryFn: getBudgetColumns,
    staleTime: 5 * 60 * 1000,
    // Lists wait for the setting: a failing read gives up quickly and falls back to the defaults.
    retry: 1,
  });
  const settings = query.data ?? DEFAULT_BUDGET_COLUMNS;
  const ready = query.isSuccess || query.isError;
  // A failed refetch keeps the loaded setting: only a setting never loaded counts as an error.
  const error = query.data ? null : (query.error ?? null);
  return useMemo(() => resolveBudgetColumns(settings, t, ready, error), [settings, ready, error, t]);
}

export default useBudgetColumns;
