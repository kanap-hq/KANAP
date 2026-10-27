import type { TFunction } from 'i18next';

/**
 * System and built-in roles are seeded in English (`tenants.service.ts`, `ensureSystemRoles`
 * and `BUILT_IN_ROLES`). The stored name is the functional key, so it stays English. A role
 * that still carries that shipped name and description is shown from `roles.builtIn.<slug>`
 * in the reader's language. A custom role, or a locked role whose stored text is no longer
 * the shipped one, is shown as stored.
 */
const SHIPPED_BY_NAME: Record<string, { slug: string; description: string }> = {
  Administrator: { slug: 'administrator', description: 'Full system administrator with access to all features' },
  'Agent Admin': { slug: 'agentAdmin', description: 'Configure AI agents, grant autonomy, and manage the agent lifecycle' },
  'Agent Contributor': { slug: 'agentContributor', description: 'Review and approve or reject AI agent proposals, run checks, and pause agents' },
  'Agent Reader': { slug: 'agentReader', description: 'View AI agents, their activity, and performance (read-only)' },
  'AI Administrator': { slug: 'aiAdministrator', description: 'Can manage tenant AI settings and use both native chat and MCP read tools' },
  'AI Chat Operator': { slug: 'aiChatOperator', description: 'Can use AI chat features that prepare future confirmed AI actions' },
  'AI Chat User': { slug: 'aiChatUser', description: 'Can use read-only AI chat tools that respect existing business permissions' },
  'AI MCP User': { slug: 'aiMcpUser', description: 'Can use personal MCP API keys for read-only AI tools' },
  'Budget Administrator': { slug: 'budgetAdministrator', description: 'Full control over budget management including budget lines, contracts, and reporting' },
  'Budget Member': { slug: 'budgetMember', description: 'Can manage budget items, contracts, and view reports' },
  'Budget Reader': { slug: 'budgetReader', description: 'Read-only access to budget data and reports' },
  'Business Contributor': { slug: 'businessContributor', description: 'Can submit requests, contribute to projects and tasks, and read assigned applications' },
  Contact: { slug: 'contact', description: 'Directory contact without app access by default' },
  'IT Landscape Administrator': { slug: 'itLandscapeAdministrator', description: 'Full control over IT landscape including applications, infrastructure, and settings' },
  'IT Landscape Member': { slug: 'itLandscapeMember', description: 'Can manage applications and infrastructure' },
  'IT Landscape Reader': { slug: 'itLandscapeReader', description: 'Read-only access to IT landscape data' },
  'Knowledge Administrator': { slug: 'knowledgeAdministrator', description: 'Full control over knowledge documents, libraries, types, and folders' },
  'Knowledge Member': { slug: 'knowledgeMember', description: 'Can create, edit, and relate knowledge documents' },
  'Knowledge Reader': { slug: 'knowledgeReader', description: 'Read-only access to knowledge documents' },
  'Master Data Administrator': { slug: 'masterDataAdministrator', description: 'Full control over master data including companies, departments, suppliers, and locations' },
  'Master Data Member': { slug: 'masterDataMember', description: 'Can manage master data entries' },
  'Master Data Reader': { slug: 'masterDataReader', description: 'Read-only access to master data' },
  'Portfolio Administrator': { slug: 'portfolioAdministrator', description: 'Full control over portfolio management including requests, projects, and planning' },
  'Portfolio Member': { slug: 'portfolioMember', description: 'Can manage portfolio requests, projects, and planning' },
  'Portfolio Reader': { slug: 'portfolioReader', description: 'Read-only access to portfolio data' },
  'Tasks Administrator': { slug: 'tasksAdministrator', description: 'Full control over task management' },
  'Tasks Member': { slug: 'tasksMember', description: 'Can manage and complete tasks' },
  'Tasks Reader': { slug: 'tasksReader', description: 'Read-only access to tasks' },
};

export type RoleLabelSource = {
  role_name?: string | null;
  /** User lists return the role under `name` (the same stored English key). */
  name?: string | null;
  role_description?: string | null;
  is_system?: boolean | null;
  is_built_in?: boolean | null;
};

function storedName(role: RoleLabelSource): string {
  const name = role.role_name ?? role.name;
  return typeof name === 'string' ? name : '';
}

/** The shipped copy when this row is still that role. A custom role keeps its own text. */
function shippedRole(role: RoleLabelSource): { slug: string; description: string } | undefined {
  const shipped = SHIPPED_BY_NAME[storedName(role)];
  if (!shipped) return undefined;
  // Flags absent (a user's role is only `{ id, name }`): the stored name is the key.
  const flagsKnown = role.is_system != null || role.is_built_in != null;
  if (flagsKnown && role.is_system !== true && role.is_built_in !== true) return undefined;
  return shipped;
}

function translated(t: TFunction, key: string, fallback: string): string {
  const value = t(key, { defaultValue: fallback });
  return typeof value === 'string' && value.trim() && value !== key ? value : fallback;
}

/** The role name as shown. Locked roles keep their stored name when it is no longer the shipped one. */
export function roleLabel(role: RoleLabelSource, t: TFunction): string {
  const name = storedName(role);
  const shipped = shippedRole(role);
  if (!shipped) return name;
  return translated(t, `admin:roles.builtIn.${shipped.slug}.name`, name);
}

/** The role description as shown. Translated only while it is still the shipped English text. */
export function roleDescription(role: RoleLabelSource, t: TFunction): string {
  const stored = role.role_description ?? '';
  const shipped = shippedRole(role);
  if (!shipped || stored !== shipped.description) return stored;
  return translated(t, `admin:roles.builtIn.${shipped.slug}.description`, stored);
}
