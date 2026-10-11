export type BudgetNatureScope = 'all' | 'opex' | 'capex';

export function natureScopeOf(filter: unknown): BudgetNatureScope {
  const model = filter as { filterType?: string; values?: unknown[]; mode?: string } | null | undefined;
  if (model?.filterType !== 'set' || !Array.isArray(model.values)) return 'all';
  const values = model.mode === 'exclude' ? ['opex', 'capex'].filter((nature) => !model.values!.includes(nature)) : model.values;
  return values.length === 1 && (values[0] === 'opex' || values[0] === 'capex') ? values[0] : 'all';
}

export function readBudgetNature(key: string): BudgetNatureScope {
  try {
    const value = localStorage.getItem(key);
    if (value === 'opex' || value === 'capex') return value;
  } catch { /* unavailable storage */ }
  return 'all';
}

/** Preserve the user's OPEX layout the first time the unified grid mounts. */
export function migrateBudgetGridLayout(tenant: string | null | undefined, user: string | undefined): void {
  if (!tenant || !user) return;
  try {
    const prefix = `grid-columns:${tenant}:${user}:`;
    if (localStorage.getItem(`${prefix}budget-summary`) !== null) return;
    const previous = localStorage.getItem(`${prefix}opex-summary`);
    if (previous !== null) localStorage.setItem(`${prefix}budget-summary`, previous);
  } catch { /* unavailable storage */ }
}
