/**
 * The roles and the effective data-access mode of a user, in SQL, for the statements that filter
 * or group users by them (the assistant's users family). The users list computes the same in
 * memory for its page (`UsersService.list`, `readUsersRoles`, `readDataAccessModes`): a user holds
 * their primary role and their additional roles; a user holding the Administrator role, primary or
 * additional, sees all data whatever the stored mode (`data-access/data-access-admin.service.ts`).
 * `alias` names the `users` row of the statement.
 */

/** The ids of the roles a user holds, primary and additional, one row each (`role_id`). */
export function userAssignedRolesSql(alias: string): string {
  return `(SELECT ${alias}.role_id AS role_id
           UNION
           SELECT ur.role_id FROM user_roles ur WHERE ur.user_id = ${alias}.id AND ur.tenant_id = ${alias}.tenant_id)`;
}

/** `all` or `limited`, as the users list's access column and Admin › Data access read the mode. */
export function userDataAccessModeSql(alias: string): string {
  return `CASE WHEN ${alias}.data_access_mode = 'limited' AND NOT EXISTS (
            SELECT 1
              FROM ${userAssignedRolesSql(alias)} assigned
              JOIN roles assigned_role ON assigned_role.id = assigned.role_id AND assigned_role.tenant_id = ${alias}.tenant_id
             WHERE lower(trim(assigned_role.role_name)) = 'administrator'
          ) THEN 'limited' ELSE 'all' END`;
}

/**
 * A join giving one row per role name the user holds (`<rolesAlias>.role_name`), for a group by
 * role: a user counts in each of their roles.
 */
export function userRoleNamesJoinSql(alias: string, rolesAlias: string): string {
  return `LEFT JOIN LATERAL (
            SELECT DISTINCT held.role_name
              FROM ${userAssignedRolesSql(alias)} assigned
              JOIN roles held ON held.id = assigned.role_id AND held.tenant_id = ${alias}.tenant_id
          ) ${rolesAlias} ON true`;
}

/** A join giving the user's effective mode (`<modeAlias>.mode`), for a group by mode. */
export function userDataAccessModeJoinSql(alias: string, modeAlias: string): string {
  return `LEFT JOIN LATERAL (SELECT ${userDataAccessModeSql(alias)} AS mode) ${modeAlias} ON true`;
}
