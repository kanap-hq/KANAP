import { useAuth } from './AuthContext';

/** The person's data access (`GET /auth/me`): `limited` scopes the budget and contracts to `nodes`. */
export type DataAccessNode = {
  node_type: string;
  access: 'read' | 'edit' | string;
  company_id?: string | null;
  cost_center_id?: string | null;
  company_name?: string | null;
  cost_center_code?: string | null;
  cost_center_name?: string | null;
};
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
