import type { RequireAnyLevelMeta } from '../../auth/require-level.decorator';

/**
 * Who may read a reference lookup: the readers of the reference's own page,
 * plus the readers of every page whose forms pick it. A lookup row holds the
 * fields a picker shows (a name, a code), never the record itself.
 */
const reader = (resource: string) => ({ resource, level: 'reader' as const });

/** Companies and departments: picked on most forms (owners, allocations, assets, projects...). */
export const ORGANISATION_LOOKUP_READERS: RequireAnyLevelMeta = [
  reader('companies'),
  reader('departments'),
  { resource: 'users', level: 'admin' },
  reader('opex'),
  reader('capex'),
  reader('contracts'),
  reader('reporting'),
  reader('tasks'),
  reader('portfolio_requests'),
  reader('portfolio_projects'),
  reader('applications'),
  reader('locations'),
  reader('infrastructure'),
];

/** People: every page with an owner, an assignee, a requestor or a share dialog. */
export const USER_LOOKUP_READERS: RequireAnyLevelMeta = [
  reader('users'),
  reader('opex'),
  reader('capex'),
  reader('contracts'),
  reader('tasks'),
  reader('portfolio_requests'),
  reader('portfolio_projects'),
  reader('portfolio_planning'),
  reader('applications'),
  reader('infrastructure'),
  reader('locations'),
  reader('incidents'),
  reader('business_processes'),
  reader('knowledge'),
  reader('cost_centers'),
  reader('companies'),
  reader('departments'),
  reader('suppliers'),
];

export const SUPPLIER_LOOKUP_READERS: RequireAnyLevelMeta = [
  reader('suppliers'),
  reader('opex'),
  reader('capex'),
  reader('contracts'),
  reader('applications'),
  reader('infrastructure'),
  reader('contacts'),
];

export const ACCOUNT_LOOKUP_READERS: RequireAnyLevelMeta = [
  reader('accounts'),
  reader('opex'),
  reader('capex'),
  reader('reporting'),
];

export const BUSINESS_PROCESS_LOOKUP_READERS: RequireAnyLevelMeta = [
  reader('business_processes'),
  reader('portfolio_requests'),
  reader('portfolio_projects'),
];

/** Pages that link a budget line to contracts, applications or projects (the Relations tab). */
export const budgetRelationLookupReaders = (own: string): RequireAnyLevelMeta => [
  reader(own),
  reader('opex'),
  reader('capex'),
];
