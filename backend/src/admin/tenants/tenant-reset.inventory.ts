import { TENANT_SCOPED_TABLES } from '../../common/tenant-isolation.inventory';
import { TENANT_PURGE_TABLES } from './tenant-purge.inventory';

/**
 * Tenant tables the reset to the post-activation state (TenantResetService) keeps, each with the
 * reason. Every other tenant table is purged. Accounts whose e-mail ends with `.example` (sample
 * data users) are removed from `users` and from the user tables below all the same, except the
 * user who runs the reset.
 */
export const TENANT_RESET_KEEP_TABLES: Readonly<Record<string, string>> = {
  subscriptions: 'The subscription and its billing state belong to the customer, not to the workspace content.',
  roles: 'Roles, built-in and custom, are access settings the administrators chose and real users are assigned to.',
  role_permissions: 'The permissions of the kept roles go with them.',
  users: 'Real user accounts stay so nobody loses access; sample data accounts are removed separately.',
  user_roles: 'The role assignments of the kept users.',
  user_page_roles: 'The per-page access grants of the kept users.',
  refresh_tokens: 'Open sessions of the kept users, so the reset signs nobody out.',
  password_reset_tokens: 'Pending password links of the kept users stay usable.',
  user_notification_preferences: 'Personal notification settings of the kept users.',
  user_dashboard_config: 'Personal home page layout of the kept users.',
  ai_settings: 'The AI configuration is a tenant setting an administrator made.',
  ai_api_keys: 'Personal MCP keys of the kept users stay valid.',
  ai_model_configs: 'Model connections are tenant settings an administrator made.',
  ai_external_mcp_servers: 'External tool servers are tenant settings an administrator made.',
  ai_external_mcp_tool_snapshots: 'The tool lists of the kept external tool servers go with them.',
  audit_log: 'The history is never erased: the reset adds its own entry to it.',
};

/** Tables the reset purges: the tenant purge order without the kept tables, in the same order. */
export const TENANT_RESET_PURGE_TABLES: readonly string[] = TENANT_PURGE_TABLES.filter(
  (table) => !Object.prototype.hasOwnProperty.call(TENANT_RESET_KEEP_TABLES, table),
);

/**
 * Kept tables that reference the users, cleared of the sample data users' rows before their
 * accounts go (the foreign keys cascade for most of them; the reset does not rely on it).
 */
export const TENANT_RESET_USER_TABLES = [
  'user_roles',
  'user_page_roles',
  'refresh_tokens',
  'password_reset_tokens',
  'user_notification_preferences',
  'user_dashboard_config',
  'ai_api_keys',
] as const;

export function validateTenantResetConfiguration(): string[] {
  const failures: string[] = [];
  const scoped = new Set<string>(TENANT_SCOPED_TABLES);
  const purgeOrder = new Set<string>(TENANT_PURGE_TABLES);
  const keep = Object.keys(TENANT_RESET_KEEP_TABLES);
  const keepSet = new Set<string>(keep);

  for (const table of keep) {
    if (!scoped.has(table)) failures.push(`tenant reset keeps ${table}, which is not a tenant-scoped table`);
    if (!purgeOrder.has(table)) failures.push(`tenant reset keeps ${table}, which is missing from the tenant purge order`);
    if (!String(TENANT_RESET_KEEP_TABLES[table] ?? '').trim()) failures.push(`tenant reset keeps ${table} without a reason`);
  }

  const purged = new Set<string>();
  for (const table of TENANT_RESET_PURGE_TABLES) {
    if (purged.has(table)) failures.push(`tenant reset purges ${table} twice`);
    purged.add(table);
    if (keepSet.has(table)) failures.push(`tenant reset both keeps and purges ${table}`);
    if (!scoped.has(table)) failures.push(`tenant reset purges ${table}, which is not a tenant-scoped table`);
  }

  for (const table of scoped) {
    if (!keepSet.has(table) && !purged.has(table)) {
      failures.push(`tenant reset neither keeps nor purges tenant-scoped table ${table}`);
    }
  }

  for (const table of TENANT_RESET_USER_TABLES) {
    if (!keepSet.has(table)) failures.push(`tenant reset clears sample users from ${table}, which it does not keep`);
  }

  return failures;
}

export function assertTenantResetConfiguration(): void {
  const failures = validateTenantResetConfiguration();
  if (failures.length > 0) {
    throw new Error(failures.join('; '));
  }
}
