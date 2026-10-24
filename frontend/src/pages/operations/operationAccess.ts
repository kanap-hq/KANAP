type Level = 'reader' | 'admin';
type HasLevel = (resource: string, level: Level) => boolean;

/** Budget administration belongs to the budget module: budget line or budget administration readers. */
const hasBudgetAccess = (hasLevel: HasLevel) => ['budget', 'budget_ops'].some((resource) => hasLevel(resource, 'reader'));
const budgetAdmin = (hasLevel: HasLevel) => hasLevel('budget_ops', 'admin');
/** Copy budget columns and reset a column: the Admin level on the budget lines, both types alike. */
const itemsAdmin = (hasLevel: HasLevel) => hasLevel('budget', 'admin');
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
  'copy-budget': itemsAdmin,
  'column-reset': itemsAdmin,
  'master-data-freeze': masterDataAdmin,
  'metrics-copy': masterDataAdmin,
};

/**
 * Whether the user can use the administration page at `/ops/operations/<page>`. Every one of them
 * is reserved to people with access to all data (spec §2.7): none for a limited person.
 */
export function canUseOperation(page: string, hasLevel: HasLevel, dataAccessLimited = false): boolean {
  if (dataAccessLimited) return false;
  return OPERATION_ACCESS[page]?.(hasLevel) ?? false;
}

/** Whether the administration landing has at least one page for the user. */
export function canUseAnyOperation(hasLevel: HasLevel, dataAccessLimited = false): boolean {
  if (dataAccessLimited) return false;
  return Object.values(OPERATION_ACCESS).some((canUse) => canUse(hasLevel));
}
