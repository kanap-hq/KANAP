/**
 * The rights the Roles screen shows, by group, in the order of its matrix. Plaid and the MCP server
 * read the same rights and no other (`backend/src/ai/ai-role-labels.ts`, `AI_SCREEN_RESOURCES`,
 * compared by `ai-role-labels.spec.ts`).
 */
export const PERMISSION_GROUPS = {
  'AI': ['ai_chat', 'ai_mcp', 'ai_agents', 'ai_settings'],
  'Budget & Finance': ['budget', 'budget_ops', 'contracts', 'analytics', 'reporting'],
  'Portfolio Management': ['portfolio_requests', 'portfolio_projects', 'portfolio_planning', 'portfolio_reports', 'portfolio_settings'],
  'IT Landscape': ['applications', 'infrastructure', 'locations', 'incidents', 'settings'],
  'Master Data': ['companies', 'departments', 'cost_centers', 'working_day_profiles', 'suppliers', 'contacts', 'accounts', 'business_processes'],
  'Tasks': ['tasks'],
  'Knowledge': ['knowledge'],
  'Administration': ['users', 'billing'],
} as const;
