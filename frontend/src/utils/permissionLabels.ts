import type { TFunction } from 'i18next';

type Translate = TFunction;

// Friendly display names for resources, the English fallback of the roles screen.
export const RESOURCE_LABELS: Record<string, string> = {
  ai_chat: 'AI Chat',
  ai_mcp: 'AI MCP',
  ai_agents: 'AI Agents',
  ai_settings: 'AI Settings',
  budget: 'Budget',
  budget_ops: 'Budget Administration',
  contracts: 'Contracts',
  analytics: 'Analytics Dimensions',
  billing: 'Billing',
  portfolio_requests: 'Requests',
  portfolio_projects: 'Projects',
  portfolio_planning: 'Planning',
  portfolio_reports: 'Reports',
  portfolio_settings: 'Settings',
  applications: 'Applications',
  infrastructure: 'Infrastructure',
  settings: 'Settings',
  companies: 'Companies',
  departments: 'Departments',
  cost_centers: 'Cost Centers',
  working_day_profiles: 'Working-day calendars',
  suppliers: 'Suppliers',
  contacts: 'Contacts',
  accounts: 'Accounts',
  business_processes: 'Business Processes',
  locations: 'Locations',
  incidents: 'Incidents',
  tasks: 'Tasks',
  knowledge: 'Knowledge',
  reporting: 'Reporting',
  users: 'Users',
};

/** The name of a module right as the roles screen shows it (`admin:roles.resources.*`). */
export function moduleRightLabel(t: Translate, resource: string): string {
  return t(`admin:roles.resources.${resource}`, { defaultValue: RESOURCE_LABELS[resource] || resource });
}

/** The name of a right level as the roles screen shows it (`admin:roles.levels.*`). */
export function rightLevelLabel(t: Translate, level: string): string {
  return t(`admin:roles.levels.${level}`, { defaultValue: level });
}
