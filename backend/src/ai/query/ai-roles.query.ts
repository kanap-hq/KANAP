import type { EntityManager } from 'typeorm';
import { PermissionLevel, PermissionsService } from '../../permissions/permissions.service';
import { AI_SCREEN_RESOURCES, type AiScreenResource } from '../ai-role-labels';
import type { Role } from '../../roles/role.entity';
import type { RolesService } from '../../roles/roles.service';
import { compareText, numberMatch, paged, setMatch, textMatch } from './ai-support.query';

/**
 * The roles and their rights as Admin › Roles shows them, for the assistant and the MCP server:
 * `roles` (one row per role, with the people it is given to counted) and `role_permissions` (one
 * row per role and right it gives). Both are read through the screen's services, never a second
 * formula: `RolesService.list` and `userCounts` (`GET /roles`), and
 * `PermissionsService.getRolePermissionMatrix` (`GET /roles/:id/permissions`: aliases folded, the
 * derived contacts right included). A tenant holds a few dozen roles: filtering, grouping, sorting
 * and paging happen in memory, here. The policy reads both families with users at admin level and
 * for people whose access is not limited only (`ai-policy.service.ts`), as the screen.
 *
 * A right is read by its resource code; the executors add the screen's words (`ai-role-labels.ts`).
 * No person is named: a role carries the count of the people it is given to, as the screen.
 */

export type AiRolesEntityType = 'roles' | 'role_permissions';
export type AiRoleType = 'system' | 'built_in' | 'custom';

/** The three kinds of role of the Roles screen (`RolesPage.tsx`, its badges). */
export const AI_ROLE_TYPES: readonly AiRoleType[] = ['system', 'built_in', 'custom'];
/** The levels of a right, lowest first, as the Roles screen orders them. */
export const AI_PERMISSION_LEVELS: readonly PermissionLevel[] = ['reader', 'contributor', 'member', 'admin'];

export type AiRoleRow = {
  id: string;
  name: string;
  description: string | null;
  type: AiRoleType;
  user_count: number;
  created_at: Date | string | null;
  updated_at: Date | string | null;
};

export type AiRolePermissionRow = {
  key: string;
  role_id: string;
  role: string;
  role_type: AiRoleType;
  resource: AiScreenResource;
  level: PermissionLevel;
};

export type AiRolesServices = {
  roles: Pick<RolesService, 'list' | 'userCounts'>;
  permissions: Pick<PermissionsService, 'getRolePermissionMatrix'>;
};

/** The sorts the in-memory lists apply. */
export const ROLE_SORTS = new Set(['name', 'type', 'user_count']);
export const ROLE_PERMISSION_SORTS = new Set(['role', 'role_type', 'resource', 'level']);

/** System (Administrator, Contact), built in (shipped, locked) or custom, as the screen's badge. */
export function aiRoleType(role: Pick<Role, 'role_name' | 'is_system' | 'is_built_in'>): AiRoleType {
  const key = String(role.role_name ?? '').toLowerCase();
  if (role.is_system && (key === 'administrator' || key === 'contact')) return 'system';
  if (role.is_built_in) return 'built_in';
  return 'custom';
}

/** Every role of the tenant, in the screen's order (by name), with its count of people. */
async function readRoles(services: AiRolesServices, manager: EntityManager): Promise<AiRoleRow[]> {
  const roles = await services.roles.list({ manager });
  const counts = await services.roles.userCounts(roles.map((role) => role.id), { manager });
  return roles.map((role) => ({
    id: role.id,
    name: role.role_name,
    description: role.role_description ?? null,
    type: aiRoleType(role),
    user_count: counts.get(role.id) ?? 0,
    created_at: role.created_at ?? null,
    updated_at: role.updated_at ?? null,
  }));
}

function rolesFiltered(rows: AiRoleRow[], query: Record<string, any>): AiRoleRow[] {
  const filters = query.filters;
  const needle = String(query.q ?? '').trim().toLowerCase();
  return rows.filter((row) => setMatch(row.type, filters?.type)
    && textMatch(row.name, filters?.name)
    && textMatch(row.description, filters?.description)
    && numberMatch(row.user_count, filters?.user_count)
    && (!needle || [row.name, row.description].some((value) => value != null && value.toLowerCase().includes(needle))));
}

/** The row's value on a sort field: a rank for the ordered sets, null last. */
function sortValue(row: AiRoleRow | AiRolePermissionRow, field: string): string | number | null {
  if ('resource' in row) {
    switch (field) {
      case 'role': return row.role;
      case 'role_type': return AI_ROLE_TYPES.indexOf(row.role_type);
      case 'resource': return AI_SCREEN_RESOURCES.indexOf(row.resource);
      case 'level': return AI_PERMISSION_LEVELS.indexOf(row.level);
      default: return null;
    }
  }
  switch (field) {
    case 'name': return row.name;
    case 'type': return AI_ROLE_TYPES.indexOf(row.type);
    case 'user_count': return row.user_count;
    default: return null;
  }
}

function sortRows<T extends AiRoleRow | AiRolePermissionRow>(rows: T[], sort: string | undefined, entityType: AiRolesEntityType): T[] {
  const [requested, requestedDirection] = String(sort ?? '').split(':');
  const field = entityType === 'roles'
    ? (ROLE_SORTS.has(requested) ? requested : 'name')
    : (ROLE_PERMISSION_SORTS.has(requested) ? requested : 'role');
  const descending = String(requestedDirection ?? 'asc').toLowerCase() === 'desc';
  return rows
    .map((row, index) => ({ row, index, value: sortValue(row, field) }))
    .sort((a, b) => {
      const order = typeof a.value === 'number' && typeof b.value === 'number'
        ? a.value - b.value
        : compareText(a.value == null ? null : String(a.value), b.value == null ? null : String(b.value));
      // Ties keep the screen's order: roles by name, then each role's rights in `RESOURCES` order.
      if (order === 0) return a.index - b.index;
      return descending ? -order : order;
    })
    .map((entry) => entry.row);
}

export async function listAiRoles(
  services: AiRolesServices,
  manager: EntityManager,
  query: Record<string, any>,
  readAll = false,
): Promise<{ items: AiRoleRow[]; total: number; page: number; limit: number }> {
  const rows = rolesFiltered(await readRoles(services, manager), query);
  return paged(sortRows(rows, query.sort, 'roles'), query, readAll);
}

/**
 * One row per role and right it gives, at the level the screen shows, for the rights the screen
 * shows (`AI_SCREEN_RESOURCES`). The role filters apply first, so the rights of the roles left out
 * are not read.
 */
export async function listAiRolePermissions(
  services: AiRolesServices,
  manager: EntityManager,
  query: Record<string, any>,
  readAll = false,
): Promise<{ items: AiRolePermissionRow[]; total: number; page: number; limit: number }> {
  const filters = query.filters;
  const roles = (await readRoles(services, manager))
    .filter((role) => textMatch(role.name, filters?.role) && setMatch(role.type, filters?.role_type));
  const rows: AiRolePermissionRow[] = [];
  // One role after the other: the reads share the caller's connection.
  for (const role of roles) {
    const matrix = await services.permissions.getRolePermissionMatrix(role.id, { manager });
    for (const resource of AI_SCREEN_RESOURCES) {
      const level = matrix[resource];
      if (!level) continue;
      rows.push({ key: `${role.id}:${resource}`, role_id: role.id, role: role.name, role_type: role.type, resource, level });
    }
  }
  const needle = String(query.q ?? '').trim().toLowerCase();
  const filtered = rows.filter((row) => setMatch(row.resource, filters?.resource)
    && setMatch(row.level, filters?.level)
    && (!needle || row.role.toLowerCase().includes(needle) || row.resource.includes(needle)));
  return paged(sortRows(filtered, query.sort, 'role_permissions'), query, readAll);
}

/**
 * A role by its id or its name (without case), as `get_entity_detail` names it; a part of a name
 * that only one role holds finds it too. Null when none, or several, match.
 */
export async function findAiRole(services: AiRolesServices, manager: EntityManager, value: string): Promise<AiRoleRow | null> {
  const needle = String(value ?? '').trim().toLowerCase();
  if (!needle) return null;
  const roles = await readRoles(services, manager);
  const exact = roles.find((role) => role.id.toLowerCase() === needle || role.name.toLowerCase() === needle);
  if (exact) return exact;
  const partial = roles.filter((role) => role.name.toLowerCase().includes(needle));
  return partial.length === 1 ? partial[0] : null;
}

/** The group key of a row, for the in-memory aggregate. */
export function rolesGroupValue(row: AiRoleRow | AiRolePermissionRow, groupBy: string): string | null {
  if ('resource' in row) {
    if (groupBy === 'level') return row.level;
    if (groupBy === 'resource') return row.resource;
    if (groupBy === 'role') return row.role;
    if (groupBy === 'role_type') return row.role_type;
    return null;
  }
  if (groupBy === 'type') return row.type;
  return null;
}

/** The count of each group of the filtered rows, largest first. */
export function aggregateRolesRows(rows: Array<AiRoleRow | AiRolePermissionRow>, groupBy: string): Array<{ key: string | null; count: number }> {
  const counts = new Map<string | null, number>();
  for (const row of rows) {
    const key = rolesGroupValue(row, groupBy);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || compareText(a.key, b.key));
}
