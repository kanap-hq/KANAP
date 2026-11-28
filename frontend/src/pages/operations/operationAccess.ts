type Level = 'reader' | 'admin';
type HasLevel = (resource: string, level: Level) => boolean;

/** Budget administration belongs to the budget module: budget line or budget administration readers. */
const hasBudgetAccess = (hasLevel: HasLevel) => ['budget', 'budget_ops'].some((resource) => hasLevel(resource, 'reader'));
const budgetAdmin = (hasLevel: HasLevel) => hasLevel('budget_ops', 'admin');
/**
 * A settings page of the budget: it opens to every reader of budget
 * administration (Budget Reader, Budget Member), read-only. Changing it stays `budget_ops:admin`,
 * read in the page itself.
 */
const budgetSettingsReader = (hasLevel: HasLevel) => hasLevel('budget_ops', 'reader');
/** Copy budget columns and clear a column: the Admin level on the budget lines, both types alike. */
const itemsAdmin = (hasLevel: HasLevel) => hasLevel('budget', 'admin');
const masterDataAdmin = (hasLevel: HasLevel) =>
  hasBudgetAccess(hasLevel)
  && (hasLevel('budget_ops', 'admin') || hasLevel('companies', 'admin') || hasLevel('departments', 'admin'));

/**
 * Who can open each `/ops/operations/*` page. A settings page opens to its readers, read-only
 * (`budgetSettingsReader`); an operation opens only to the users whose rights its API needs to act.
 * A page the user cannot open is hidden from the landing and closed by the route guard.
 */
const OPERATION_ACCESS: Record<string, (hasLevel: HasLevel) => boolean> = {
  currency: budgetAdmin,
  columns: budgetSettingsReader,
  'allocation-default': budgetSettingsReader,
  freeze: budgetAdmin,
  'copy-budget': itemsAdmin,
  'column-reset': itemsAdmin,
  'master-data-freeze': masterDataAdmin,
  'metrics-copy': masterDataAdmin,
};

/**
 * Whether the user can open the administration page at `/ops/operations/<page>`. Every one of them
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
