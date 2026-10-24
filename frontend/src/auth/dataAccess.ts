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
 * The signed-in person's access is limited. Components read it here rather than from a value of
 * the auth context, so a test that mocks `useAuth` without `dataAccess` reads an unscoped person.
 */
export function useDataAccessLimited(): boolean {
  return isDataAccessLimited(useAuth().dataAccess);
}
