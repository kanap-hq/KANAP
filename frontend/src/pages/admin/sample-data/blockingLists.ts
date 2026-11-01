/**
 * Where each table that blocks a sample data load is listed, and the label the page shows.
 * Labels already used by the audit log or the navigation stay those, so the name matches the
 * list the link opens. `spend_items` is the budget of both natures, so it uses the budget list's
 * name. Instances have no list of their own: they open with their applications.
 */

export type SampleDataBlockingList = { labelKey: string; to: string };

export const SAMPLE_DATA_BLOCKING_LISTS: Readonly<Record<string, SampleDataBlockingList>> = {
  accounts: { labelKey: 'auditLogs.tableNames.accounts', to: '/master-data/coa' },
  ai_adapter_configs: { labelKey: 'nav:sidebar.admin.integrations', to: '/admin/integrations' },
  ai_agent_definitions: { labelKey: 'nav:workspaces.agents', to: '/agents' },
  analytics_categories: { labelKey: 'auditLogs.tableNames.analytics_categories', to: '/master-data/analytics' },
  app_instances: { labelKey: 'auditLogs.tableNames.app_instances', to: '/it/applications' },
  applications: { labelKey: 'auditLogs.tableNames.applications', to: '/it/applications' },
  assets: { labelKey: 'auditLogs.tableNames.assets', to: '/it/assets' },
  business_processes: { labelKey: 'auditLogs.tableNames.business_processes', to: '/master-data/business-processes' },
  chart_of_accounts: { labelKey: 'auditLogs.tableNames.chart_of_accounts', to: '/master-data/coa' },
  companies: { labelKey: 'auditLogs.tableNames.companies', to: '/master-data/companies' },
  connections: { labelKey: 'auditLogs.tableNames.connections', to: '/it/connections' },
  contacts: { labelKey: 'auditLogs.tableNames.contacts', to: '/master-data/contacts' },
  contracts: { labelKey: 'auditLogs.tableNames.contracts', to: '/ops/contracts' },
  cost_centers: { labelKey: 'auditLogs.tableNames.cost_centers', to: '/master-data/cost-centers' },
  departments: { labelKey: 'auditLogs.tableNames.departments', to: '/master-data/departments' },
  documents: { labelKey: 'auditLogs.tableNames.documents', to: '/knowledge?allLibraries=1' },
  incidents: { labelKey: 'auditLogs.tableNames.incidents', to: '/it/incidents' },
  interfaces: { labelKey: 'auditLogs.tableNames.interfaces', to: '/it/interfaces' },
  locations: { labelKey: 'auditLogs.tableNames.locations', to: '/it/locations' },
  portfolio_categories: { labelKey: 'auditLogs.tableNames.portfolio_categories', to: '/portfolio/settings' },
  portfolio_projects: { labelKey: 'auditLogs.tableNames.portfolio_projects', to: '/portfolio/projects' },
  portfolio_requests: { labelKey: 'auditLogs.tableNames.portfolio_requests', to: '/portfolio/requests' },
  portfolio_sources: { labelKey: 'auditLogs.tableNames.portfolio_sources', to: '/portfolio/settings' },
  portfolio_streams: { labelKey: 'auditLogs.tableNames.portfolio_streams', to: '/portfolio/settings' },
  spend_items: { labelKey: 'nav:sidebar.ops.budgetLines', to: '/ops/budget' },
  suppliers: { labelKey: 'auditLogs.tableNames.suppliers', to: '/master-data/suppliers' },
  tasks: { labelKey: 'auditLogs.tableNames.tasks', to: '/portfolio/tasks' },
  users: { labelKey: 'auditLogs.tableNames.users', to: '/admin/users' },
  working_day_profiles: { labelKey: 'auditLogs.tableNames.working_day_profiles', to: '/master-data/working-day-calendars' },
};
