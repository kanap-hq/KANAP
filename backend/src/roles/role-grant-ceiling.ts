import { EntityManager, In } from 'typeorm';
import { Role } from './role.entity';
import { User } from '../users/user.entity';
import { UserRole } from '../users/user-role.entity';
import {
  normalizePermissionLevel,
  normalizeResource,
  PermissionLevel,
  readRolePermissions,
} from '../permissions/permissions.service';
import { codedForbidden, moduleRightRequired } from '../auth/module-right-required';
import { isAdministratorRole } from './system-roles';

/**
 * A person gives only the rights they hold. Every write that gives a role to a person (their roles,
 * their main role, a new person, the CSV import of people) or raises the rights of a role goes
 * through this file: a role the person does not hold yet, or a right raised on a role, carries no
 * level above the giver's own level on the same module, and only an administrator gives the
 * Administrator role. An administrator gives every role. Taking a role or a right away is not
 * checked here.
 */

const RANK: Record<string, number> = { reader: 1, contributor: 2, member: 3, admin: 4 };

export type RoleGrantActor = { isAdmin: boolean; permissions: Record<string, string> };

/** The giver as `PermissionGuard` read them on the request. */
export function roleGrantActorOf(req: any): RoleGrantActor {
  return { isAdmin: req?.isAdmin === true, permissions: { ...(req?.permissions ?? {}) } };
}

const ABOVE_OWN_RIGHTS = 'You can only give the rights you hold yourself.';

function assertLevelWithin(actor: RoleGrantActor, resource: string, level: string) {
  if ((RANK[level] ?? 0) > (RANK[actor.permissions[resource]] ?? 0)) {
    throw moduleRightRequired(resource, level, ABOVE_OWN_RIGHTS);
  }
}

/** The roles `userId` holds: the main role and the additional ones. */
async function heldRoleIds(manager: EntityManager, userId: string): Promise<Set<string>> {
  const held = new Set<string>();
  const user = await manager.getRepository(User).findOne({ where: { id: userId }, select: { id: true, role_id: true } });
  if (user?.role_id) held.add(user.role_id);
  for (const row of await manager.getRepository(UserRole).find({ where: { user_id: userId } })) held.add(row.role_id);
  return held;
}

/**
 * Giving `roleIds` to `userId` (null for a person not created yet): every role they do not hold yet
 * stays within the giver's rights. 403 `administrator_required` for the Administrator role, 403
 * `MODULE_RIGHT_REQUIRED` naming the first module and level above the giver's own.
 */
export async function assertRoleGrantWithinActorRights(
  manager: EntityManager,
  actor: RoleGrantActor,
  userId: string | null,
  roleIds: Array<string | null | undefined>,
): Promise<void> {
  if (actor.isAdmin) return;
  const held = userId ? await heldRoleIds(manager, userId) : new Set<string>();
  const given = [...new Set(roleIds.filter((id): id is string => !!id))].filter((id) => !held.has(id));
  if (given.length === 0) return;
  const roles = await manager.getRepository(Role).find({ where: { id: In(given) } });
  for (const role of roles) {
    if (isAdministratorRole(role)) {
      throw codedForbidden('administrator_required', 'Only an administrator can give the Administrator role.');
    }
    for (const [resource, level] of await readRolePermissions(manager, role.id)) assertLevelWithin(actor, resource, level);
  }
}

/**
 * Setting the rights of a role (`PUT /roles/:id/permissions`): a right raised above what the role
 * gives today stays within the giver's rights. Rights kept or lowered are not checked.
 */
export function assertRolePermissionsWithinActorRights(
  actor: RoleGrantActor,
  current: Record<string, string>,
  requested: Record<string, PermissionLevel | null>,
): void {
  if (actor.isAdmin) return;
  for (const [key, raw] of Object.entries(requested ?? {})) {
    if (raw == null) continue;
    const resource = normalizeResource(key);
    const level = normalizePermissionLevel(resource, raw);
    if ((RANK[level] ?? 0) <= (RANK[current[resource]] ?? 0)) continue;
    assertLevelWithin(actor, resource, level);
  }
}
