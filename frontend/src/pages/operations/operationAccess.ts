type Level = 'reader' | 'admin';
type HasLevel = (resource: string, level: Level) => boolean;

/** Budget administration belongs to the budget module: OPEX, CAPEX or budget readers. */
const hasBudgetAccess = (hasLevel: HasLevel) => ['opex', 'capex', 'budget_ops'].some((resource) => hasLevel(resource, 'reader'));
const budgetAdmin = (hasLevel: HasLevel) => hasLevel('budget_ops', 'admin');
/** Column copy, allocation copy and reset run per item type, like their API. */
const itemsAdmin = (hasLevel: HasLevel) => hasLevel('opex', 'admin') || hasLevel('capex', 'admin');
const masterDataAdmin = (hasLevel: HasLevel) =>
  hasBudgetAccess(hasLevel)
  && (hasLevel('budget_ops', 'admin') || hasLevel('companies', 'admin') || hasLevel('departments', 'admin'));

/**
 * Who can use each `/ops/operations/*` page, mirroring the rights its API needs to act.
 * A page the user cannot use is hidden from the landing and closed by the route guard.
 */
const OPERATION_ACCESS: Record<string, (hasLevel: HasLevel) => boolean> = {
  currency: budgetAdmin,
  columns: budgetAdmin,
  'allocation-default': budgetAdmin,
  freeze: budgetAdmin,
  'copy-budget-columns': itemsAdmin,
  'column-init': itemsAdmin,
  'copy-allocations': itemsAdmin,
  'column-reset': itemsAdmin,
  'master-data-freeze': masterDataAdmin,
  'metrics-copy': masterDataAdmin,
};

/** Whether the user can use the administration page at `/ops/operations/<page>`. */
export function canUseOperation(page: string, hasLevel: HasLevel): boolean {
  return OPERATION_ACCESS[page]?.(hasLevel) ?? false;
}

/** Whether the administration landing has at least one page for the user. */
export function canUseAnyOperation(hasLevel: HasLevel): boolean {
  return Object.values(OPERATION_ACCESS).some((canUse) => canUse(hasLevel));
}
