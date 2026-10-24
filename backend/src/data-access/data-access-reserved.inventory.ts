/**
 * Data-scoped access: the routes of the controllers that hold an operation reserved to unscoped
 * persons (planning/data-scoped-access/spec.md §2.7, §6.7). Every route of these controllers is
 * either reserved (`@ReservedToUnscopedDataAccess()` on the handler, or on the controller with
 * `reservedClass`) or allowed with a reason. `data-access/__tests__/data-access-reserved-inventory.spec.ts`
 * reads the route metadata of each controller: a new route, a decorator added or removed, or a
 * controller that uses the decorator without being listed here, fails until it is classified.
 *
 * Reserved families (spec §2.7): tenant settings (freeze, budget columns, currencies, default
 * allocation rule, master-data year copy, company and department metrics); operations on a set of
 * lines (column copy and reset, allocation copy, bulk delete); delete of a line or a contract;
 * persons (users, roles, audit log); organisation data (companies, departments, cost centres,
 * accounts and charts of accounts, business processes, dimensions and the values of closed-list
 * dimensions); updates and deletes of suppliers and shared contacts; agent screens; the AI
 * administration sites classified `reserved` in `data-access-paths.inventory.ts`. A delete check
 * or an impact preview asked before a reserved operation is reserved with it.
 *
 * The budget file routes (`budget-file/export`, `preflight`, `import`) are not reserved (spec §2.7,
 * amended): the run that scopes them follows the line rules.
 */

export type DataAccessReservedEntry = {
  /** Relative to `backend/src`. */
  file: string;
  /** The controller class. */
  controller: string;
  /** The controller carries the decorator: every route is reserved, for this reason. */
  reservedClass?: string;
  /** The route methods that are reserved (all of them with `reservedClass`). */
  reserved: string[];
  /** The route methods left to every person, with the reason. */
  allowed: Record<string, string>;
};

const READ = 'a read: the reservation covers the writes; budget data is filtered by the data-access policies';
const LOOKUP = 'a picker or reference lookup (read)';
const EXPORT = 'a list export: the same data as the list (spec §5.6)';
const LINE_WRITE = 'a write on one line or its children: the line policies apply, and the pre-checks of lot 3';
const CONTRACT_WRITE = 'a write on one contract or its links: follows the person\'s access (lots 3 and 5)';
const BUDGET_FILE = 'budget file: not reserved (spec §2.7, amended); line by line, scoped by the line rules';
const SHARE = 'sends a link to a visible record (notifications, lot 4)';
const CREATE_SHARED = 'creating a supplier or a contact stays allowed (spec §2.7)';
const OWN_PROFILE = 'the person\'s own profile';
const OWN_MCP_KEY = 'the person\'s own MCP key';
const MODEL_CONFIGS_LIST = 'the model configurations (no budget data); their writes are reserved';
const AI_SETTINGS = 'AI settings screen: reserved to unscoped persons (data-access-paths.inventory.ts)';
const AGENT_SCREENS = 'agent screens (control, observations, work items): reserved to unscoped persons (spec §2.7)';

export const DATA_ACCESS_RESERVED_ROUTES: DataAccessReservedEntry[] = [
  {
    file: 'freeze/freeze.controller.ts',
    controller: 'FreezeController',
    reserved: ['freezeAction', 'unfreezeAction'],
    allowed: {
      list: READ, // GET (root)
    },
  },
  {
    file: 'budget-columns/budget-columns.controller.ts',
    controller: 'BudgetColumnsController',
    reserved: ['update'],
    allowed: {
      get: READ, // GET (root)
    },
  },
  {
    file: 'currency/currency.controller.ts',
    controller: 'CurrencyController',
    reserved: ['refreshRates', 'removeManualRate', 'reportingChangeImpact', 'setManualRate', 'updateSettings'],
    allowed: {
      getSettings: READ, // GET settings
      listMissingRates: READ, // GET rates/missing
      listRates: READ, // GET rates
    },
  },
  {
    file: 'spend/allocation-rules.controller.ts',
    controller: 'AllocationRulesController',
    reserved: ['clearActive', 'setActive'],
    allowed: {
      getActive: READ, // GET active
    },
  },
  {
    file: 'master-data/master-data-operations.controller.ts',
    controller: 'MasterDataOperationsController',
    reserved: ['copy'],
    allowed: {},
  },
  {
    file: 'companies/companies.controller.ts',
    controller: 'CompaniesController',
    reserved: ['bulkDelete', 'create', 'delete', 'deleteCheck', 'import', 'update'],
    allowed: {
      export: EXPORT, // GET export
      get: READ, // GET :id
      list: READ, // GET (root)
      listIds: READ, // GET ids
      lookup: LOOKUP, // GET lookup
      lookupById: LOOKUP, // GET lookup/:id
      totals: READ, // GET totals
    },
  },
  {
    file: 'companies/company-metrics.controller.ts',
    controller: 'CompanyMetricsController',
    reserved: ['upsert'],
    allowed: {
      get: READ, // GET :companyId
      list: READ, // GET (root)
    },
  },
  {
    file: 'departments/departments.controller.ts',
    controller: 'DepartmentsController',
    reserved: ['bulkDelete', 'create', 'delete', 'deleteCheck', 'import', 'update'],
    allowed: {
      export: EXPORT, // GET export
      get: READ, // GET :id
      list: READ, // GET (root)
      listIds: READ, // GET ids
      lookup: LOOKUP, // GET lookup
      lookupById: LOOKUP, // GET lookup/:id
    },
  },
  {
    file: 'departments/department-metrics.controller.ts',
    controller: 'DepartmentMetricsController',
    reserved: ['upsert'],
    allowed: {
      get: READ, // GET :departmentId
    },
  },
  {
    file: 'cost-centers/cost-centers.controller.ts',
    controller: 'CostCentersController',
    reserved: ['bulkDelete', 'create', 'delete', 'deleteCheck', 'import', 'update'],
    allowed: {
      export: EXPORT, // GET export
      get: READ, // GET :id
      list: READ, // GET (root)
      listIds: READ, // GET ids
      tree: READ, // GET tree
      treeCount: READ, // GET tree/count
    },
  },
  {
    file: 'accounts/accounts.controller.ts',
    controller: 'AccountsController',
    reserved: ['bulkDelete', 'create', 'delete', 'deleteCheck', 'import', 'update'],
    allowed: {
      export: EXPORT, // GET export
      get: READ, // GET :id
      list: READ, // GET (root)
      listIds: READ, // GET ids
      lookup: LOOKUP, // GET lookup
    },
  },
  {
    file: 'accounts/chart-of-accounts.controller.ts',
    controller: 'ChartOfAccountsController',
    reserved: [
        'bulkDelete', 'clearConsolidation', 'clearGlobalDefault', 'consolidationImpact', 'create', 'delete',
        'deleteCheck', 'importAccounts', 'loadTemplate', 'preflightImportFromTemplate', 'setConsolidation',
        'setGlobalDefault', 'update',
    ],
    allowed: {
      exportAccounts: EXPORT, // GET :id/accounts/export
      get: READ, // GET :id
      list: READ, // GET (root)
      listTemplates: READ, // GET templates
    },
  },
  {
    file: 'business-processes/business-processes.controller.ts',
    controller: 'BusinessProcessesController',
    reserved: ['bulkDelete', 'create', 'delete', 'deleteCheck', 'import', 'update'],
    allowed: {
      export: EXPORT, // GET export
      get: READ, // GET :id
      list: READ, // GET (root)
      listIds: READ, // GET ids
      lookup: LOOKUP, // GET lookup
    },
  },
  {
    file: 'business-processes/business-processes.controller.ts',
    controller: 'BusinessProcessCategoriesController',
    reserved: ['create', 'delete', 'update'],
    allowed: {
      list: READ, // GET (root)
    },
  },
  {
    file: 'business-processes/business-process-applications.controller.ts',
    controller: 'BusinessProcessApplicationsController',
    reserved: ['add', 'remove'],
    allowed: {
      list: READ, // GET :id/applications
    },
  },
  {
    file: 'analytics/analytics-axes.controller.ts',
    controller: 'AnalyticsAxesController',
    reserved: ['addRecommended', 'create', 'delete', 'reorder', 'update'],
    allowed: {
      get: READ, // GET :id
      list: READ, // GET (root)
      recommended: READ, // GET recommended
    },
  },
  {
    file: 'analytics/analytics-categories.controller.ts',
    controller: 'AnalyticsCategoriesController',
    reserved: ['bulkDelete', 'create', 'delete', 'deleteCheck', 'import', 'reorder', 'update'],
    allowed: {
      export: EXPORT, // GET export
      get: READ, // GET :id
      list: READ, // GET (root)
      listIds: READ, // GET ids
      lookup: LOOKUP, // GET lookup
    },
  },
  {
    file: 'suppliers/suppliers.controller.ts',
    controller: 'SuppliersController',
    reserved: ['attachContact', 'bulkDelete', 'delete', 'deleteCheck', 'detachContact', 'import', 'update'],
    allowed: {
      create: CREATE_SHARED, // POST (root)
      export: EXPORT, // GET export
      get: READ, // GET :id
      list: READ, // GET (root)
      listContacts: READ, // GET :id/contacts
      listIds: READ, // GET ids
      lookup: LOOKUP, // GET lookup
      usages: READ, // GET :id/usages
    },
  },
  {
    file: 'contacts/contacts.controller.ts',
    controller: 'ContactsController',
    reserved: ['bulkDelete', 'import', 'remove', 'update'],
    allowed: {
      create: CREATE_SHARED, // POST (root)
      export: EXPORT, // GET export
      get: READ, // GET :id
      list: READ, // GET (root)
      usages: READ, // GET :id/usages
    },
  },
  {
    file: 'users/users.controller.ts',
    controller: 'UsersController',
    reserved: [
        'bulkDelete', 'create', 'delete', 'deleteCheck', 'disable', 'enable', 'import', 'invite', 'setUserRoles',
        'update',
    ],
    allowed: {
      export: EXPORT, // GET export
      getById: READ, // GET :id
      getUserRoles: READ, // GET :id/roles
      list: READ, // GET (root)
      lookup: LOOKUP, // GET lookup
      updateMe: OWN_PROFILE, // PATCH me
    },
  },
  {
    file: 'roles/roles.controller.ts',
    controller: 'RolesController',
    reserved: ['createRole', 'deleteRole', 'duplicateRole', 'setRolePermissions', 'updateRole'],
    allowed: {
      getRolePermissions: READ, // GET :id/permissions
      getRoles: READ, // GET (root)
    },
  },
  {
    file: 'audit/audit-logs.controller.ts',
    controller: 'AuditLogsController',
    reservedClass: 'audit log: reserved to unscoped persons, reads included (it shows the before and after of every table)',
    reserved: [
        'export', 'getById', 'list', 'listFilterValues',
    ],
    allowed: {},
  },
  {
    file: 'spend/spend-items.controller.ts',
    controller: 'SpendItemsController',
    reserved: ['bulkDelete', 'clearBudgetColumn', 'copyAllocations', 'copyBudgetColumn', 'delete'],
    allowed: {
      attachContact: LINE_WRITE, // POST :id/contacts
      bulkReplaceApplications: LINE_WRITE, // POST :id/applications/bulk-replace
      bulkReplaceProjects: LINE_WRITE, // POST :id/projects/bulk-replace
      bulkReplaceTechnologies: LINE_WRITE, // POST :id/technologies/bulk-replace
      changeType: LINE_WRITE, // POST :id/change-type
      changeTypeCheck: READ, // GET :id/change-type/check
      create: LINE_WRITE, // POST (root)
      createLink: LINE_WRITE, // POST :id/links
      deleteAttachment: LINE_WRITE, // PATCH attachments/:attachmentId/delete
      deleteLink: LINE_WRITE, // DELETE :id/links/:linkId
      detachContact: LINE_WRITE, // DELETE :id/contacts/:linkId
      downloadAttachment: READ, // GET attachments/:attachmentId
      exportBudgetFile: BUDGET_FILE, // GET budget-file/export
      get: READ, // GET :id
      importBudgetFile: BUDGET_FILE, // POST budget-file/import
      list: READ, // GET (root)
      listApplications: READ, // GET :id/applications
      listAttachments: READ, // GET :id/attachments
      listContacts: READ, // GET :id/contacts
      listLinks: READ, // GET :id/links
      listProjects: READ, // GET :id/projects
      listTechnologies: READ, // GET :id/technologies
      meta: READ, // GET :id/meta
      preflightBudgetFile: BUDGET_FILE, // POST budget-file/preflight
      relationCounts: READ, // GET :id/relation-counts
      share: SHARE, // POST :id/share
      summary: READ, // GET summary
      summaryAggregate: READ, // POST summary/aggregate
      summaryFilterValues: READ, // GET summary/filter-values
      summaryIds: READ, // GET summary/ids
      summaryNeighbors: READ, // GET summary/neighbors
      summaryTotals: READ, // GET summary/totals
      syncContactsFromSupplier: LINE_WRITE, // POST :id/contacts/sync-from-supplier
      update: LINE_WRITE, // PATCH :id
      updateLink: LINE_WRITE, // PATCH :id/links/:linkId
      uploadAttachment: LINE_WRITE, // POST :id/attachments
      yearlyTotals: READ, // GET :id/yearly-totals
    },
  },
  {
    file: 'spend/capex-items.controller.ts',
    controller: 'CapexItemsController',
    reserved: ['bulkDelete', 'clearBudgetColumn', 'copyAllocations', 'copyBudgetColumn', 'delete'],
    allowed: {
      attachContact: LINE_WRITE, // POST :id/contacts
      bulkReplaceApplications: LINE_WRITE, // POST :id/applications/bulk-replace
      bulkReplaceProjects: LINE_WRITE, // POST :id/projects/bulk-replace
      bulkReplaceTechnologies: LINE_WRITE, // POST :id/technologies/bulk-replace
      changeType: LINE_WRITE, // POST :id/change-type
      changeTypeCheck: READ, // GET :id/change-type/check
      create: LINE_WRITE, // POST (root)
      createLink: LINE_WRITE, // POST :id/links
      deleteAttachment: LINE_WRITE, // PATCH attachments/:attachmentId/delete
      deleteLink: LINE_WRITE, // DELETE :id/links/:linkId
      detachContact: LINE_WRITE, // DELETE :id/contacts/:linkId
      downloadAttachment: READ, // GET attachments/:attachmentId
      exportBudgetFile: BUDGET_FILE, // GET budget-file/export
      get: READ, // GET :id
      importBudgetFile: BUDGET_FILE, // POST budget-file/import
      list: READ, // GET (root)
      listApplications: READ, // GET :id/applications
      listAttachments: READ, // GET :id/attachments
      listContacts: READ, // GET :id/contacts
      listLinks: READ, // GET :id/links
      listProjects: READ, // GET :id/projects
      listTechnologies: READ, // GET :id/technologies
      meta: READ, // GET :id/meta
      preflightBudgetFile: BUDGET_FILE, // POST budget-file/preflight
      relationCounts: READ, // GET :id/relation-counts
      share: SHARE, // POST :id/share
      summary: READ, // GET summary
      summaryAggregate: READ, // POST summary/aggregate
      summaryFilterValues: READ, // GET summary/filter-values
      summaryIds: READ, // GET summary/ids
      summaryNeighbors: READ, // GET summary/neighbors
      summaryTotals: READ, // GET summary/totals
      syncContactsFromSupplier: LINE_WRITE, // POST :id/contacts/sync-from-supplier
      update: LINE_WRITE, // PATCH :id
      updateLink: LINE_WRITE, // PATCH :id/links/:linkId
      uploadAttachment: LINE_WRITE, // POST :id/attachments
      yearlyTotals: READ, // GET :id/yearly-totals
    },
  },
  {
    file: 'spend/budget-lines.controller.ts',
    controller: 'BudgetLinesController',
    reserved: ['bulkDelete', 'clearBudgetColumn', 'copyBudget', 'deleteCheck'],
    allowed: {
      create: LINE_WRITE, // POST (root)
      exportBudgetFile: BUDGET_FILE, // GET budget-file/export
      get: READ, // GET :ref
      linkRelation: LINE_WRITE, // POST :id/relations/:kind
      relations: READ, // GET :id/relations
      resolve: LOOKUP, // GET resolve/:ref
      summary: READ, // GET summary
      summaryAggregate: READ, // POST summary/aggregate
      summaryFilterValues: READ, // GET summary/filter-values
      summaryIds: READ, // GET summary/ids
      summaryNeighbors: READ, // GET summary/neighbors
      summaryTotals: READ, // GET summary/totals
      unlinkRelation: LINE_WRITE, // DELETE :id/relations/:kind/:targetId
      update: LINE_WRITE, // PATCH :id
    },
  },
  {
    file: 'contracts/contracts.controller.ts',
    controller: 'ContractsController',
    reserved: ['bulkDelete', 'delete', 'deleteImpact'],
    allowed: {
      attachContact: CONTRACT_WRITE, // POST :id/contacts
      budgetCoverage: READ, // GET :id/budget
      bulkReplace: CONTRACT_WRITE, // POST :id/spend-items/bulk-replace
      bulkReplaceApplications: CONTRACT_WRITE, // POST :id/applications/bulk-replace
      bulkReplaceAssets: CONTRACT_WRITE, // POST :id/assets/bulk-replace
      bulkReplaceBudgetLines: CONTRACT_WRITE, // POST :id/budget-lines/bulk-replace
      bulkReplaceCapex: CONTRACT_WRITE, // POST :id/capex-items/bulk-replace
      bulkReplaceTechnologies: CONTRACT_WRITE, // POST :id/technologies/bulk-replace
      compliance: READ, // GET :id/compliance
      create: CONTRACT_WRITE, // POST (root)
      createTask: CONTRACT_WRITE, // POST :id/tasks
      createUrl: CONTRACT_WRITE, // POST :id/links
      deleteAttachment: CONTRACT_WRITE, // PATCH attachments/:attachmentId/delete
      deleteUrl: CONTRACT_WRITE, // DELETE :id/links/:linkId
      detachContact: CONTRACT_WRITE, // DELETE :id/contacts/:linkId
      downloadAttachment: READ, // GET attachments/:attachmentId
      export: EXPORT, // GET export
      exportComplianceRegister: EXPORT, // GET compliance-register/export
      get: READ, // GET :id
      import: CONTRACT_WRITE, // POST import
      linkRelation: CONTRACT_WRITE, // POST :id/relations/:kind
      list: READ, // GET (root)
      listApplications: READ, // GET :id/applications
      listAssets: READ, // GET :id/assets
      listAttachments: READ, // GET :id/attachments
      listBudgetLines: READ, // GET :id/budget-lines
      listContacts: READ, // GET :id/contacts
      listIds: READ, // GET ids
      listLinked: READ, // GET :id/spend-items
      listLinkedCapex: READ, // GET :id/capex-items
      listTasks: READ, // GET :id/tasks
      listTechnologies: READ, // GET :id/technologies
      listUrls: READ, // GET :id/links
      lookup: LOOKUP, // GET lookup
      relationCounts: READ, // GET :id/relation-counts
      relations: READ, // GET :id/relations
      share: SHARE, // POST :id/share
      syncContactsFromSupplier: CONTRACT_WRITE, // POST :id/contacts/sync-from-supplier
      totals: READ, // GET totals
      unlinkRelation: CONTRACT_WRITE, // DELETE :id/relations/:kind/:targetId
      update: CONTRACT_WRITE, // PATCH :id
      updateCompliance: CONTRACT_WRITE, // PATCH :id/compliance/:requirement
      updateTask: CONTRACT_WRITE, // PATCH :id/tasks
      updateUrl: CONTRACT_WRITE, // PATCH :id/links/:linkId
      uploadAttachment: CONTRACT_WRITE, // POST :id/attachments
    },
  },
  {
    file: 'ai/ai-settings.controller.ts',
    controller: 'AiSettingsController',
    reservedClass: AI_SETTINGS,
    reserved: [
        'getBuiltinUsage', 'getSettings', 'testGlpi', 'testProvider', 'testWebSearch', 'updateSettings',
    ],
    allowed: {},
  },
  {
    file: 'ai/ai-integrations.controller.ts',
    controller: 'AiIntegrationsController',
    reservedClass: AI_SETTINGS,
    reserved: [
        'listMonitoring', 'savePrtg', 'testPrtg',
    ],
    allowed: {},
  },
  {
    file: 'ai/ai-admin-overview.controller.ts',
    controller: 'AiAdminOverviewController',
    reservedClass: AI_SETTINGS,
    reserved: [
        'getOverview',
    ],
    allowed: {},
  },
  {
    file: 'ai/search-index/ai-admin-search-index.controller.ts',
    controller: 'AiAdminSearchIndexController',
    reservedClass: `${AI_SETTINGS}; rebuilds the search index of the whole tenant`,
    reserved: [
        'reindex',
    ],
    allowed: {},
  },
  {
    file: 'ai/control-plane/agent-control/ai-agent-control.controller.ts',
    controller: 'AiAgentControlController',
    reservedClass: AGENT_SCREENS,
    reserved: [
        'acknowledgeAllAttention', 'acknowledgeAttention', 'approveAction', 'approveActionsBulk',
        'archiveSharedContextProfile', 'createAgent', 'createEmergencyPause', 'createHelpdeskEmergencyPause',
        'createSharedContextProfile', 'deleteAgentDefinition', 'dismissAction', 'getAgent', 'getAgentAutonomy',
        'getAgentEffectivePrompt', 'getAgentTargetingOptions', 'getAttentionSummary', 'getBadges',
        'getHelpdeskEvaluationDaily', 'getHelpdeskWorkItemContext', 'getQueueOverview', 'getRun', 'listActions',
        'listActivity', 'listAgentMonitoringAlertDiagnoses', 'listAgents', 'listGlpiReadTargets', 'listRuns',
        'listSharedContextProfiles', 'listTicketingReadTargets', 'pollHelpdeskGlpiIngestion',
        'pollHelpdeskTicketingIngestion', 'pollSreMonitoringIngestion', 'previewAgentTargeting', 'rejectAction',
        'revokeEmergencyPause', 'revokeHelpdeskEmergencyPause', 'runGlpiRead', 'runMockTriage',
        'runTicketingRead', 'runTicketingTriage', 'setAgentAutonomy', 'testAgentMonitoringDiagnosis',
        'updateAgent', 'updateAgentStatus', 'updateSharedContextProfile',
    ],
    allowed: {},
  },
  {
    file: 'ai/ai-model-configs.controller.ts',
    controller: 'AiModelConfigsController',
    reserved: ['archive', 'clearDefault', 'create', 'restore', 'setDefault', 'test', 'update'],
    allowed: {
      list: MODEL_CONFIGS_LIST, // GET (root)
    },
  },
  {
    file: 'ai/ai-api-keys.controller.ts',
    controller: 'AiApiKeysController',
    reserved: ['adminList', 'adminMcpAudit', 'adminRevoke'],
    allowed: {
      create: OWN_MCP_KEY, // POST keys
      list: READ, // GET keys
      revoke: OWN_MCP_KEY, // DELETE keys/:id
    },
  },
  {
    file: 'demo-data/demo-data.controller.ts',
    controller: 'DemoDataController',
    reservedClass: 'sample data and workspace reset (Administrator only): writes the whole tenant',
    reserved: [
        'dismiss', 'load', 'overview', 'reset',
    ],
    allowed: {},
  },
];
