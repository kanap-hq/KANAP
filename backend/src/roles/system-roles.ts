/**
 * The two system roles, Administrator and Contact. Their names are reserved: a system role cannot be
 * renamed, and no other role takes the name of one of them, whatever its case or surrounding spaces.
 */
export const SYSTEM_ROLE_KEYS = ['administrator', 'contact'] as const;

/** A role name as the reserved names compare it: trimmed, in lower case. */
export function roleNameKey(name: string | null | undefined): string {
  return String(name ?? '').trim().toLowerCase();
}

/** Whether `name` is, whatever its case or surrounding spaces, the name of a system role. */
export function isSystemRoleName(name: string | null | undefined): boolean {
  return (SYSTEM_ROLE_KEYS as readonly string[]).includes(roleNameKey(name));
}

/**
 * The Administrator role, recognised by its name as `PermissionGuard` and the other checks
 * recognise it: the name is reserved (see above), so only the system role carries it.
 */
export function isAdministratorRole(role: { role_name?: string | null } | null | undefined): boolean {
  return roleNameKey(role?.role_name) === 'administrator';
}
