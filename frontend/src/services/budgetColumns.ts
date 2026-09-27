import api from '../api';
import type { AmountMeasure } from '../components/finance/roundPeriod';

/**
 * Per-tenant names and settings of the five budget columns (`GET|PATCH /budget-columns`). Both
 * directions use storage keys; a null label means the product name.
 */
export type BudgetColumnMeasure = AmountMeasure;

export type BudgetColumnsSettings = {
  labels: Record<AmountMeasure, string | null>;
  enabled: Record<AmountMeasure, boolean>;
  group_spread: Record<AmountMeasure, boolean>;
  default_column: AmountMeasure;
};

export type BudgetColumnsPatch = Partial<{
  labels: Partial<Record<AmountMeasure, string | null>>;
  enabled: Partial<Record<AmountMeasure, boolean>>;
  group_spread: Partial<Record<AmountMeasure, boolean>>;
  default_column: AmountMeasure;
}>;

/** Product defaults, the same as the server's for a tenant that never saved the setting. */
export const DEFAULT_BUDGET_COLUMNS: BudgetColumnsSettings = {
  labels: { planned: null, committed: null, forecast: null, actual: null, expected_landing: null },
  enabled: { planned: true, committed: true, forecast: false, actual: true, expected_landing: true },
  group_spread: { planned: true, committed: true, forecast: true, actual: true, expected_landing: true },
  default_column: 'planned',
};

export async function getBudgetColumns(): Promise<BudgetColumnsSettings> {
  const res = await api.get<BudgetColumnsSettings>('/budget-columns');
  return res.data;
}

export async function updateBudgetColumns(patch: BudgetColumnsPatch): Promise<BudgetColumnsSettings> {
  const res = await api.patch<BudgetColumnsSettings>('/budget-columns', patch);
  return res.data;
}
