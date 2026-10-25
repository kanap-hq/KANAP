import { useAuth } from './AuthContext';

/** A node of the person's data access, as `GET /auth/me` returns it (backend `data-access-profile.ts`). */
export type DataAccessNode = {
  type: 'all' | 'company' | 'cost_center';
  id: string | null;
  name: string | null;
  access: 'read' | 'edit';
  /** Cost centre nodes only. */
  code?: string | null;
  kind?: 'group' | 'cost_center' | null;
};
/** The person's data access (`GET /auth/me`): `limited` scopes the budget and contracts to `nodes`. */
export type DataAccessProfile = {
  available: boolean;
  mode: 'all' | 'limited';
  nodes: DataAccessNode[];
  modules: string[];
};

/** A person whose access is limited (mode `limited`): reserved actions are hidden, totals are calculated on their access. */
export function isDataAccessLimited(dataAccess: DataAccessProfile | null | undefined): boolean {
  return dataAccess?.mode === 'limited';
}

/**
 * The companies whose chargeback report a person opens (spec §5.2): null for everyone when the
 * access is not limited or holds an "all" node; else the companies of the company nodes (a
 * cost-centre node opens none).
 */
export function chargebackCompanyIds(dataAccess: DataAccessProfile | null | undefined): ReadonlySet<string> | null {
  if (!isDataAccessLimited(dataAccess)) return null;
  const nodes = dataAccess?.nodes ?? [];
  if (nodes.some((node) => node.type === 'all')) return null;
  return new Set(nodes.filter((node) => node.type === 'company' && node.id).map((node) => node.id as string));
}

/**
 * Reserved to people with access to all data (spec §2.7, `backend/src/data-access/data-access-reserved.inventory.ts`):
 * for a limited person these modules read as reader at most, so their edit commands are hidden and
 * their reads stay. Organisation data (companies, departments, cost centers, accounts and charts,
 * processes, dimensions), the budget settings (`budget_ops`: currencies, columns, freeze, default
 * allocation rule), persons and the tenant administration behind `users` (users, roles, audit log,
 * branding, scheduled tasks) and the AI administration.
 */
const DATA_ACCESS_RESERVED_WRITES = new Set([
  'companies', 'departments', 'cost_centers', 'accounts', 'business_processes', 'analytics',
  'budget_ops', 'users', 'ai_settings',
]);
/** Closed to a limited person entirely: the agent screens (spec §2.7). */
const DATA_ACCESS_RESERVED_MODULES = new Set(['ai_agents']);

/** A level of a module a limited person does not get, whatever their roles (`hasLevel` answers false). */
export function isReservedInLimitedAccess(resource: string, level: string): boolean {
  return DATA_ACCESS_RESERVED_MODULES.has(resource) || (DATA_ACCESS_RESERVED_WRITES.has(resource) && level !== 'reader');
}

/**
 * The signed-in person's access is limited. Components read it here rather than from a value of
 * the auth context, so a test that mocks `useAuth` without `dataAccess` reads an unscoped person.
 */
export function useDataAccessLimited(): boolean {
  return isDataAccessLimited(useAuth().dataAccess);
}

/**
 * The administration of other people's data access (spec §7.1 to §7.3): unscoped persons who
 * administer users. A limited person sees none of these screens, whatever their roles.
 */
export function useDataAccessAdmin(): boolean {
  const { hasLevel } = useAuth();
  return hasLevel('users', 'admin') && !useDataAccessLimited();
}
