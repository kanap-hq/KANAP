import { EntityManager } from 'typeorm';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * True when `userId` is an enabled user of the tenant with the Administrator role, as their main
 * role or as an additional one (`user_roles`). A module level (`users: admin`, for instance) does
 * not count. Same rule as the sample data routes (DemoDataService.requireAdministrator).
 */
export async function isTenantAdministrator(
  manager: Pick<EntityManager, 'query'>,
  tenantId: string,
  userId: string,
): Promise<boolean> {
  if (!UUID.test(String(userId ?? ''))) return false;
  const [row]: Array<{ is_administrator: boolean }> = await manager.query(
    `SELECT EXISTS (
       SELECT 1 FROM users u
         JOIN roles r ON r.tenant_id = u.tenant_id
        WHERE u.id = $1 AND u.tenant_id = $2 AND u.status = 'enabled'
          AND lower(coalesce(r.role_name, '')) = 'administrator'
          AND (r.id = u.role_id OR EXISTS (
                SELECT 1 FROM user_roles ur WHERE ur.tenant_id = $2 AND ur.user_id = u.id AND ur.role_id = r.id))
     ) AS is_administrator`,
    [userId, tenantId],
  );
  return !!row?.is_administrator;
}
