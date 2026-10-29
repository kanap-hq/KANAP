import { AccessNodeRow, loadAccessTree, nodeCoversCenter, TreeCenter } from './data-access-tree';

/**
 * Data-scoped access: the people a cost centre proposes, for the owner pickers of a budget line
 * (lot 4). A person belongs when they are enabled, hold at least the reader right on `budget`, and
 * either:
 * - are limited with one access node that covers the centre (the centre itself, a parent group,
 *   the centre's company, or `all`), read or edit;
 * - are not limited (`data_access_mode = 'all'`, or an Administrator).
 *
 * The answer is ids only: the caller reads the names through `USER_LOOKUP`, so no node, level or
 * path ever leaves this module. Every statement carries `tenant_id`; an unknown centre answers
 * nothing.
 */

type Queryable = { query(sql: string, params?: unknown[]): Promise<any[]> };

/** The suggestions route caps its response here; `has_more` says when the set is wider. */
export const OWNER_SUGGESTIONS_MAX = 500;

export type CostCenterSuggestionScope = {
  /**
   * Enforce the caller's own access: a limited caller only asks about a centre it reads, may place
   * a line on, or names the readable line of.
   */
  enforceCallerScope?: boolean;
  /** The centre of the line named by `line=`, resolved under RLS before the call. */
  lineCostCenterId?: string | null;
};

/** An Administrator (primary role or another role) is never data-scoped. */
function administratorSql(alias: string): string {
  return `(
    EXISTS (
      SELECT 1
        FROM roles r
       WHERE r.tenant_id = ${alias}.tenant_id
         AND r.id = ${alias}.role_id
         AND lower(btrim(r.role_name)) = 'administrator'
    )
    OR EXISTS (
      SELECT 1
        FROM user_roles ur
        JOIN roles r ON r.tenant_id = ur.tenant_id AND r.id = ur.role_id
       WHERE ur.tenant_id = ${alias}.tenant_id
         AND ur.user_id = ${alias}.id
         AND lower(btrim(r.role_name)) = 'administrator'
    )
  )`;
}

/**
 * At least the reader right on `budget`: any row of the resource means so, levels being ranked
 * reader < contributor < member < admin. The legacy names (`opex`, `capex`) still grant what the
 * permissions service reads as `budget`.
 */
function budgetRightSql(alias: string): string {
  return `EXISTS (
    SELECT 1
      FROM role_permissions rp
     WHERE rp.tenant_id = ${alias}.tenant_id
       AND rp.resource IN ('budget', 'opex', 'capex')
       AND (
         rp.role_id = ${alias}.role_id
         OR rp.role_id IN (
           SELECT ur.role_id
             FROM user_roles ur
            WHERE ur.tenant_id = ${alias}.tenant_id
              AND ur.user_id = ${alias}.id
         )
       )
  )`;
}

/**
 * Whether the caller may ask for this centre's suggestions. An unscoped caller asks for any
 * centre. A limited caller asks when it reads the centre (`read_all`, or the unfolded read nodes
 * hold it), can place a line there (`data_access_placable_line`), or names a readable line placed
 * on it (the owner of a line outside its nodes). Anything else looks like an unknown centre: no
 * names, no 403 that would confirm the centre exists.
 */
async function callerMayAskCostCenter(
  manager: Queryable,
  center: TreeCenter,
  lineCostCenterId: string | null,
): Promise<boolean> {
  if (lineCostCenterId && lineCostCenterId === center.id) return true;
  const [row] = await manager.query(
    `SELECT current_setting('app.da_mode', true) = 'limited' AS limited,
            coalesce(NULLIF(current_setting('app.da_read_all', true), '')::boolean, false) AS read_all,
            coalesce(NULLIF(current_setting('app.da_read_nodes', true), '')::uuid[], '{}'::uuid[]) AS read_nodes,
            data_access_placable_line($1::uuid, $2::uuid) AS placable`,
    [center.company_id, center.id],
  );
  if (row?.limited !== true) return true;
  if (row.read_all === true) return true;
  if (Array.isArray(row.read_nodes) && row.read_nodes.includes(center.id)) return true;
  return row.placable === true;
}

/**
 * The ids of the enabled people who read this cost centre and may open a budget line there. The
 * tree is loaded once and the limited persons arrive with all their nodes in one statement; the
 * coverage test is `nodeCoversCenter`, the tested mirror of the data-access policies. The unscoped
 * people come from one more statement. Both groups need the `budget` right; an Administrator has
 * it by role.
 *
 * The group is only useful when it leaves out at least one enabled person with the budget right.
 * When every such person is covered (a tenant without scoped access, or every limited person
 * covered), the answer is empty and the pickers keep their plain lookup.
 */
export async function peopleWithCostCenterAccess(
  manager: Queryable,
  tenantId: string,
  costCenterId: string,
  scope: CostCenterSuggestionScope = {},
): Promise<string[]> {
  const tree = await loadAccessTree(manager, tenantId);
  const center = tree.centers.get(costCenterId);
  if (!center) return [];
  if (scope.enforceCallerScope && !(await callerMayAskCostCenter(manager, center, scope.lineCostCenterId ?? null))) {
    return [];
  }

  const limitedRows: Array<{
    id: string;
    node_type: string | null;
    access: string | null;
    company_id: string | null;
    cost_center_id: string | null;
  }> = await manager.query(
    `SELECT u.id, n.node_type, n.access, n.company_id, n.cost_center_id
       FROM users u
       LEFT JOIN user_data_access_nodes n
         ON n.tenant_id = u.tenant_id AND n.user_id = u.id
      WHERE u.tenant_id = $1
        AND u.status = 'enabled'
        AND u.data_access_mode = 'limited'
        AND NOT ${administratorSql('u')}
        AND ${budgetRightSql('u')}
      ORDER BY u.id, n.id`,
    [tenantId],
  );

  const limitedEligibleIds = new Set<string>();
  const coveredLimitedIds = new Set<string>();
  for (const row of limitedRows) {
    limitedEligibleIds.add(row.id);
    // A node type outside the three known ones covers nothing. The CHECK makes it unreachable
    // today; a corrupted row must not fail open as `all`.
    if (row.node_type !== 'all' && row.node_type !== 'company' && row.node_type !== 'cost_center') continue;
    const node: AccessNodeRow = {
      id: '',
      node_type: row.node_type,
      access: row.access === 'edit' ? 'edit' : 'read',
      company_id: row.company_id,
      cost_center_id: row.cost_center_id,
    };
    if (nodeCoversCenter(node, center, tree).covered) coveredLimitedIds.add(row.id);
  }

  const unscopedRows: Array<{ id: string }> = await manager.query(
    `SELECT u.id
       FROM users u
      WHERE u.tenant_id = $1
        AND u.status = 'enabled'
        AND (
          ${administratorSql('u')}
          OR (u.data_access_mode = 'all' AND ${budgetRightSql('u')})
        )
      ORDER BY u.id`,
    [tenantId],
  );

  // The group must leave out at least one enabled person with the budget right: otherwise the
  // pickers would get nearly the whole list under a header that suggests nothing.
  if (coveredLimitedIds.size === limitedEligibleIds.size) return [];

  const ids = new Set<string>(coveredLimitedIds);
  for (const row of unscopedRows) ids.add(row.id);
  return [...ids].sort();
}
