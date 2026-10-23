import { DataAccessAvailability } from './data-access-availability';
import { DataAccessMode } from './data-access';

/**
 * The `dataAccess` part of `GET /auth/me` (planning/data-scoped-access/spec.md §6.7, §8): whether the
 * function is available, the person's mode, their nodes with names and access, and the modules the
 * access covers. Read by SQL in the request's manager, under its tenant.
 */

/** The modules a limited access covers. */
export const DATA_ACCESS_MODULES = ['budget', 'contracts'] as const;

export type DataAccessNodeView =
  | { type: 'all'; id: null; name: null; access: 'read' | 'edit' }
  | { type: 'company'; id: string; name: string | null; access: 'read' | 'edit' }
  | {
    type: 'cost_center';
    id: string;
    code: string | null;
    name: string | null;
    kind: 'group' | 'cost_center' | null;
    access: 'read' | 'edit';
  };

export type DataAccessProfile = {
  available: boolean;
  mode: DataAccessMode;
  nodes: DataAccessNodeView[];
  modules: Array<(typeof DATA_ACCESS_MODULES)[number]>;
};

type Queryable = { query(sql: string, params?: unknown[]): Promise<any[]> };

/**
 * The person's access as `data_access_apply` sees it: `all` for mode `all` and for an Administrator
 * (by role name, as `data_access_apply`), whatever the column says; the nodes only in mode
 * `limited`. An unknown person reads as `all` with no node (the request was refused before).
 */
export async function readDataAccessProfile(
  manager: Queryable,
  userId: string,
  availability: DataAccessAvailability,
): Promise<DataAccessProfile> {
  const [person] = await manager.query(
    `SELECT u.data_access_mode = 'limited'
            AND NOT EXISTS (
              SELECT 1
              FROM (
                SELECT u.role_id
                UNION
                SELECT ur.role_id FROM user_roles ur WHERE ur.user_id = u.id AND ur.tenant_id = u.tenant_id
              ) assigned
              JOIN roles r ON r.id = assigned.role_id AND r.tenant_id = u.tenant_id
              WHERE lower(trim(r.role_name)) = 'administrator'
            ) AS limited
     FROM users u
     WHERE u.id = $1 AND u.tenant_id = app_current_tenant()`,
    [userId],
  );
  const base = { available: availability.available, modules: [...DATA_ACCESS_MODULES] };
  if (person?.limited !== true) return { ...base, mode: 'all', nodes: [] };

  const rows = await manager.query(
    `SELECT n.node_type, n.access, n.company_id, n.cost_center_id,
            co.name AS company_name, cc.code AS cost_center_code, cc.name AS cost_center_name,
            cc.kind AS cost_center_kind
     FROM user_data_access_nodes n
     LEFT JOIN companies co ON co.tenant_id = n.tenant_id AND co.id = n.company_id
     LEFT JOIN cost_centers cc ON cc.tenant_id = n.tenant_id AND cc.id = n.cost_center_id
     WHERE n.tenant_id = app_current_tenant() AND n.user_id = $1
     ORDER BY CASE n.node_type WHEN 'all' THEN 0 WHEN 'company' THEN 1 ELSE 2 END,
              lower(co.name), lower(cc.code), n.id`,
    [userId],
  );
  const nodes: DataAccessNodeView[] = rows.map((row: any) => {
    const access = row.access === 'edit' ? 'edit' : 'read';
    if (row.node_type === 'company') {
      return { type: 'company', id: String(row.company_id), name: row.company_name ?? null, access };
    }
    if (row.node_type === 'cost_center') {
      return {
        type: 'cost_center',
        id: String(row.cost_center_id),
        code: row.cost_center_code ?? null,
        name: row.cost_center_name ?? null,
        kind: row.cost_center_kind === 'group' || row.cost_center_kind === 'cost_center' ? row.cost_center_kind : null,
        access,
      };
    }
    return { type: 'all', id: null, name: null, access };
  });
  return { ...base, mode: 'limited', nodes };
}
