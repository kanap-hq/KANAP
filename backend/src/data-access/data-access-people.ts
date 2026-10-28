import { AccessNodeRow, loadAccessTree, nodeCoversCenter } from './data-access-tree';

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
 * The ids of the enabled people who read this cost centre and may open a budget line there. The
 * tree is loaded once and the limited persons arrive with all their nodes in one statement; the
 * coverage test is `nodeCoversCenter`, the tested mirror of the data-access policies. The unscoped
 * people come from one more statement. Both groups need the `budget` right; an Administrator has
 * it by role.
 */
export async function peopleWithCostCenterAccess(
  manager: Queryable,
  tenantId: string,
  costCenterId: string,
): Promise<string[]> {
  const tree = await loadAccessTree(manager, tenantId);
  const center = tree.centers.get(costCenterId);
  if (!center) return [];

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

  const ids = new Set<string>();
  for (const row of limitedRows) {
    if (!row.node_type) continue;
    const node: AccessNodeRow = {
      id: '',
      node_type: row.node_type === 'company' || row.node_type === 'cost_center' ? row.node_type : 'all',
      access: row.access === 'edit' ? 'edit' : 'read',
      company_id: row.company_id,
      cost_center_id: row.cost_center_id,
    };
    if (nodeCoversCenter(node, center, tree).covered) ids.add(row.id);
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
  for (const row of unscopedRows) ids.add(row.id);

  return [...ids].sort();
}
