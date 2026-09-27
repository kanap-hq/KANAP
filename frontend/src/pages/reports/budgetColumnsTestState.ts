import type { TFunction } from 'i18next';
import type { BudgetColumns, resolveBudgetColumns } from '../../hooks/useBudgetColumns';
import { DEFAULT_BUDGET_COLUMNS, type BudgetColumnsSettings } from '../../services/budgetColumns';

/**
 * Test double of `useBudgetColumns()` for the report and dashboard specs:
 *
 *   vi.mock('../../hooks/useBudgetColumns', async (importOriginal) => {
 *     const actual = await importOriginal<typeof import('../../hooks/useBudgetColumns')>();
 *     const state = await import('./budgetColumnsTestState');
 *     return { ...actual, useBudgetColumns: () => state.mockedBudgetColumns(actual.resolveBudgetColumns) };
 *   });
 *
 * Labels are the product label keys (the specs' `t` returns keys) unless the settings name them.
 */
const state: { settings: BudgetColumnsSettings; ready: boolean; cached: BudgetColumns | null } = {
  settings: DEFAULT_BUDGET_COLUMNS,
  ready: true,
  cached: null,
};

const keyAsLabel = ((key: string) => key) as unknown as TFunction;

/**
 * Sets the tenant setting the mocked hook returns. `ready: false` mimics the first load: like the
 * real hook, it then holds the product defaults, whatever the patch says.
 */
export function setBudgetColumns(patch: Partial<BudgetColumnsSettings> = {}, ready = true): void {
  state.settings = ready ? { ...DEFAULT_BUDGET_COLUMNS, ...patch } : DEFAULT_BUDGET_COLUMNS;
  state.ready = ready;
  state.cached = null;
}

/** Same object while the setting is unchanged, like the real hook's memo. */
export function mockedBudgetColumns(resolve: typeof resolveBudgetColumns): BudgetColumns {
  if (!state.cached) state.cached = resolve(state.settings, keyAsLabel, state.ready);
  return state.cached;
}
