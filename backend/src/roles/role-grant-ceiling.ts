import { ConflictException } from '@nestjs/common';
import { EntityManager, In } from 'typeorm';
import { Role } from './role.entity';
import { User } from '../users/user.entity';
import { UserRole } from '../users/user-role.entity';
import {
  normalizePermissionLevel,
  normalizeResource,
  PermissionLevel,
  readRolePermissions,
  readRolesPermissions,
} from '../permissions/permissions.service';
import { codedForbidden, moduleRightRequired } from '../auth/module-right-required';
import { isAdministratorRole } from './system-roles';

/**
 * A person gives only the rights they hold. Every write that gives a role to a person (their roles,
 * their main role, a new person, the CSV import of people) or raises the rights of a role goes
 * through this file: a role the person does not hold yet, or a right raised on a role, carries no
 * level above the giver's own level on the same module, and only an administrator gives the
 * Administrator role. An administrator gives every role. Taking a role or a right away is not
 * checked by that rule.
 *
 * A person does not change a person who has more rights than they do either
 * (`personAboveActorRights`): the writes on another person check the target too.
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

/** The roles each of `userIds` holds (main and additional), in two queries. */
async function heldRoleIdsOf(manager: EntityManager, userIds: string[]): Promise<Map<string, Set<string>>> {
  const held = new Map<string, Set<string>>(userIds.map((id) => [id, new Set<string>()]));
  if (userIds.length === 0) return held;
  const users = await manager.getRepository(User).find({ where: { id: In(userIds) }, select: { id: true, role_id: true } });
  for (const user of users) if (user.role_id) held.get(user.id)?.add(user.role_id);
  for (const row of await manager.getRepository(UserRole).find({ where: { user_id: In(userIds) } })) held.get(row.user_id)?.add(row.role_id);
  return held;
}

/** Whether `rights` hold a level above the actor's own on a module (the Administrator role counts as above). */
function rightsAboveActor(actor: RoleGrantActor, rights: RoleGrantActor): boolean {
  if (actor.isAdmin) return false;
  if (rights.isAdmin) return true;
  return Object.entries(rights.permissions).some(([resource, level]) => (RANK[level] ?? 0) > (RANK[actor.permissions[resource]] ?? 0));
}

/** The rights each role gives (the Administrator role as `isAdmin`), in two queries. */
async function rolesRights(manager: EntityManager, roleIds: string[]): Promise<Map<string, RoleGrantActor>> {
  const out = new Map<string, RoleGrantActor>();
  if (roleIds.length === 0) return out;
  const roles = await manager.getRepository(Role).find({ where: { id: In(roleIds) } });
  const permissions = await readRolesPermissions(manager, roles.map((role) => role.id));
  for (const role of roles) {
    out.set(role.id, isAdministratorRole(role)
      ? { isAdmin: true, permissions: {} }
      : { isAdmin: false, permissions: Object.fromEntries(permissions.get(role.id) ?? []) });
  }
  return out;
}

/**
 * A person does not change a person who has more rights than they do: one who holds the
 * Administrator role, or a level above theirs on a module (all their roles count). An administrator
 * changes everyone. Every write on another person or on their account goes through here: their
 * administration fields, their roles, their invitation, their data access, their deletion, the
 * rows of an import about them. The users screen reads the same answer for a page of people.
 */
export async function peopleAboveActorRights(manager: EntityManager, actor: RoleGrantActor, userIds: string[]): Promise<Set<string>> {
  const above = new Set<string>();
  if (actor.isAdmin || userIds.length === 0) return above;
  const held = await heldRoleIdsOf(manager, userIds);
  const rights = await rolesRights(manager, [...new Set([...held.values()].flatMap((ids) => [...ids]))]);
  for (const [userId, roleIds] of held) {
    // Their rights, read as `PermissionGuard` reads them: the union of their roles.
    const union: RoleGrantActor = { isAdmin: false, permissions: {} };
    for (const roleId of roleIds) {
      const role = rights.get(roleId);
      if (!role) continue;
      if (role.isAdmin) union.isAdmin = true;
      for (const [resource, level] of Object.entries(role.permissions)) {
        if ((RANK[level] ?? 0) > (RANK[union.permissions[resource]] ?? 0)) union.permissions[resource] = level;
      }
    }
    if (rightsAboveActor(actor, union)) above.add(userId);
  }
  return above;
}

export async function personAboveActorRights(manager: EntityManager, actor: RoleGrantActor, targetUserId: string): Promise<boolean> {
  return (await peopleAboveActorRights(manager, actor, [targetUserId])).has(targetUserId);
}

/**
 * The roles among `roleIds` the actor may not give to a person who does not hold them yet (see
 * `assertRoleGrantWithinActorRights`): the Administrator role, and a role with a level above the
 * actor's own on a module. Empty for an administrator. The role pickers of the users screen read it.
 */
export async function rolesAboveActorRights(manager: EntityManager, actor: RoleGrantActor, roleIds: string[]): Promise<Set<string>> {
  const above = new Set<string>();
  if (actor.isAdmin) return above;
  for (const [roleId, rights] of await rolesRights(manager, roleIds)) {
    if (rightsAboveActor(actor, rights)) above.add(roleId);
  }
  return above;
}

export const PERSON_ABOVE_OWN_RIGHTS_MESSAGE = 'This person has more rights than you.';

/** 403 `PERSON_ABOVE_OWN_RIGHTS` when the target has more rights than the actor (see above). */
export async function assertPersonWithinActorRights(manager: EntityManager, actor: RoleGrantActor, targetUserId: string): Promise<void> {
  if (await personAboveActorRights(manager, actor, targetUserId)) {
    throw codedForbidden('PERSON_ABOVE_OWN_RIGHTS', PERSON_ABOVE_OWN_RIGHTS_MESSAGE);
  }
}

/**
 * A write on a person, as the last-administrator check reads it: the person deleted, or their
 * status, their main role (`users.role_id`, the other roles kept) or all their roles set.
 */
export type PersonChange = {
  userId: string;
  deleted?: boolean;
  status?: string | null;
  mainRoleId?: string | null;
  roleIds?: string[];
};

/**
 * A workspace keeps at least one enabled Administrator. When `changes` take the last enabled
 * Administrators out of that set (their role taken away, disabled, deleted), the ids of those
 * Administrators; an empty list otherwise. The Administrator role
 * rows are locked first, until the end of the transaction: two writes that each take one of the two
 * last Administrators away run one after the other, and the second reads the first one's result.
 */
export async function lastActiveAdministratorsLeaving(manager: EntityManager, changes: PersonChange[]): Promise<string[]> {
  if (changes.length === 0) return [];
  const adminRoles: Array<{ id: string }> = await manager.query(
    `SELECT id FROM roles
      WHERE tenant_id = app_current_tenant() AND lower(trim(role_name)) = 'administrator'
      ORDER BY id FOR UPDATE`,
  );
  const adminRoleIds = adminRoles.map((row) => row.id);
  if (adminRoleIds.length === 0) return [];
  const active: Array<{ id: string }> = await manager.query(
    `SELECT u.id FROM users u
      WHERE u.tenant_id = app_current_tenant() AND u.status = 'enabled'
        AND (u.role_id = ANY($1::uuid[])
          OR EXISTS (SELECT 1 FROM user_roles ur
                      WHERE ur.tenant_id = u.tenant_id AND ur.user_id = u.id AND ur.role_id = ANY($1::uuid[])))`,
    [adminRoleIds],
  );
  const activeIds = new Set(active.map((row) => row.id));
  const changed = new Map(changes.map((change) => [change.userId, change]));
  if (![...changed.keys()].some((id) => activeIds.has(id))) return [];
  if ([...activeIds].some((id) => !changed.has(id))) return [];
  // Every enabled Administrator is changed: one of them must stay an enabled Administrator.
  const ids = [...changed.keys()];
  const users: Array<{ id: string; status: string; role_id: string | null }> = await manager.query(
    `SELECT id, status, role_id FROM users WHERE tenant_id = app_current_tenant() AND id = ANY($1::uuid[])`,
    [ids],
  );
  const others: Array<{ user_id: string; role_id: string }> = await manager.query(
    `SELECT user_id, role_id FROM user_roles WHERE tenant_id = app_current_tenant() AND user_id = ANY($1::uuid[])`,
    [ids],
  );
  const admin = new Set(adminRoleIds);
  const staying = users.some((user) => {
    const change = changed.get(user.id)!;
    if (change.deleted) return false;
    const status = change.status !== undefined ? change.status : user.status;
    if (status !== 'enabled') return false;
    const roles = change.roleIds ?? [
      change.mainRoleId !== undefined ? change.mainRoleId : user.role_id,
      ...others.filter((row) => row.user_id === user.id).map((row) => row.role_id),
    ];
    return roles.some((roleId) => !!roleId && admin.has(roleId));
  });
  return staying ? [] : [...activeIds];
}

export const LAST_ADMINISTRATOR_MESSAGE = 'The workspace needs at least one active administrator.';

/** 409 `LAST_ADMINISTRATOR` when `changes` leave the workspace without an enabled Administrator. */
export async function assertKeepsAnActiveAdministrator(manager: EntityManager, changes: PersonChange[]): Promise<void> {
  if ((await lastActiveAdministratorsLeaving(manager, changes)).length > 0) {
    throw new ConflictException({ statusCode: 409, error: 'Conflict', code: 'LAST_ADMINISTRATOR', message: LAST_ADMINISTRATOR_MESSAGE });
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
