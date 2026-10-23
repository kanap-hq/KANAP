/**
 * Data-scoped access: the paths that run outside the tenant interceptor's transaction
 * (planning/data-scoped-access/spec.md §6.3, §10.3). The interceptor applies the person's access to
 * every request it wraps; these paths open their own runner, or skip the request transaction, so
 * each one is classified here. `data-access/__tests__/data-access-inventory.spec.ts` fails when a
 * site appears in the code and not here, or the reverse.
 *
 * A site is one (file, member, kind): the member is the method or function around it, or the
 * class a `@SkipTenantTransaction()` decorates. Kinds: `skip_tenant_transaction`,
 * `transaction_false` (`{ transaction: false }`), `tenant_executor_run` (`tenantExecutor.run(`),
 * `with_tenant_execution` (`withTenantExecution(`).
 *
 * Classes:
 * - `applies`: goes through `AiTenantExecutionService.runWithContext` with the person, or another
 *   call point of `applyDataAccess`;
 * - `no_scoped_table`: reads and writes no table of the budget block (`spend_*`, `contracts`,
 *   `contract_*`, `tasks`, `task_*`, `search_index`, the link tables to lines and contracts);
 * - `reserved`: to be reserved to unscoped persons by lot 3 (AI settings, agent screens,
 *   administration);
 * - `system`: no person (scheduled jobs, startup).
 */

export type DataAccessPathSite = 'skip_tenant_transaction' | 'transaction_false' | 'tenant_executor_run' | 'with_tenant_execution';

export type DataAccessPathClass = 'applies' | 'no_scoped_table' | 'reserved' | 'system';

export type DataAccessPathEntry = {
  /** Relative to `backend/src`. */
  file: string;
  member: string;
  site: DataAccessPathSite;
  class: DataAccessPathClass;
  reason: string;
};

/** Files the scan skips: they define the executors, or only name a site in a message. */
export const DATA_ACCESS_PATHS_IGNORED_FILES: Record<string, string> = {
  'common/tenant-runner.ts': 'defines withTenantExecution and withTenant; their callers are listed',
  'ai/execution/ai-tenant-execution.service.ts': 'defines run and runWithContext (a call point of applyDataAccess); their callers are listed',
  'data-access/data-access.ts': 'names the option without a transaction in the text of its refusal',
};

const AI_SETTINGS = 'AI settings screen (assertSettingsAccess): reserved to unscoped persons';
const AGENT_SCREENS = 'agent screens: reserved to unscoped persons (spec §2.7)';
const RUN_WITH_CONTEXT = 'every route runs through runWithContext with the person, which applies the access';

export const DATA_ACCESS_PATHS: DataAccessPathEntry[] = [
  // Plaid and MCP: runWithContext applies the person's access.
  { file: 'ai/ai-chat.controller.ts', member: 'AiChatController', site: 'skip_tenant_transaction', class: 'applies', reason: `${RUN_WITH_CONTEXT} (the orchestrator too)` },
  { file: 'ai/ai-conversations.controller.ts', member: 'AiConversationsController', site: 'skip_tenant_transaction', class: 'applies', reason: RUN_WITH_CONTEXT },
  { file: 'ai/ai-mcp.controller.ts', member: 'AiMcpController', site: 'skip_tenant_transaction', class: 'applies', reason: `${RUN_WITH_CONTEXT}; GET and DELETE answer 405 without the database` },
  { file: 'ai/ai-search.controller.ts', member: 'AiSearchController', site: 'skip_tenant_transaction', class: 'applies', reason: RUN_WITH_CONTEXT },

  // Capabilities, MCP keys and connections: no table of the budget block.
  { file: 'ai/ai-capabilities.controller.ts', member: 'AiCapabilitiesController', site: 'skip_tenant_transaction', class: 'no_scoped_table', reason: 'reads the AI settings and the person\'s permissions' },
  { file: 'ai/ai-capabilities.controller.ts', member: 'getCapabilities', site: 'tenant_executor_run', class: 'no_scoped_table', reason: 'reads the AI settings and the person\'s permissions' },
  { file: 'ai/ai-api-keys.controller.ts', member: 'AiApiKeysController', site: 'skip_tenant_transaction', class: 'no_scoped_table', reason: 'MCP keys (ai_api_keys) and their audit only; the admin routes are listed as reserved' },
  { file: 'ai/ai-api-keys.controller.ts', member: 'create', site: 'tenant_executor_run', class: 'no_scoped_table', reason: 'the person\'s own MCP key (ai_api_keys)' },
  { file: 'ai/ai-api-keys.controller.ts', member: 'list', site: 'tenant_executor_run', class: 'no_scoped_table', reason: 'the person\'s own MCP keys (ai_api_keys)' },
  { file: 'ai/ai-api-keys.controller.ts', member: 'revoke', site: 'tenant_executor_run', class: 'no_scoped_table', reason: 'the person\'s own MCP key (ai_api_keys)' },
  { file: 'ai/ai-api-keys.controller.ts', member: 'adminList', site: 'tenant_executor_run', class: 'reserved', reason: AI_SETTINGS },
  { file: 'ai/ai-api-keys.controller.ts', member: 'adminRevoke', site: 'tenant_executor_run', class: 'reserved', reason: AI_SETTINGS },
  { file: 'ai/ai-api-keys.service.ts', member: 'logAudit', site: 'tenant_executor_run', class: 'no_scoped_table', reason: 'writes an MCP key event to audit_log' },
  { file: 'ai/ai-api-keys.service.ts', member: 'logAudit', site: 'transaction_false', class: 'no_scoped_table', reason: 'writes an MCP key event to audit_log' },
  { file: 'ai/auth/mcp-api-key-auth.guard.ts', member: 'authenticate', site: 'tenant_executor_run', class: 'no_scoped_table', reason: 'guard: reads the MCP key and its person (ai_api_keys, users)' },
  { file: 'ai/oauth/mcp-oauth.controller.ts', member: 'McpOAuthController', site: 'skip_tenant_transaction', class: 'no_scoped_table', reason: 'MCP OAuth flow: clients, codes, grants and the person' },
  { file: 'ai/oauth/mcp-oauth.controller.ts', member: 'McpOAuthMetadataController', site: 'skip_tenant_transaction', class: 'no_scoped_table', reason: 'OAuth metadata documents, no tenant table' },
  { file: 'ai/oauth/mcp-oauth.service.ts', member: 'authenticateAccessToken', site: 'tenant_executor_run', class: 'no_scoped_table', reason: 'MCP OAuth grants and the person' },
  { file: 'ai/oauth/mcp-oauth.service.ts', member: 'decide', site: 'tenant_executor_run', class: 'no_scoped_table', reason: 'MCP OAuth consent: grants and the person' },
  { file: 'ai/oauth/mcp-oauth.service.ts', member: 'describeRequest', site: 'tenant_executor_run', class: 'no_scoped_table', reason: 'MCP OAuth consent screen: client and the person' },
  { file: 'ai/oauth/mcp-oauth.service.ts', member: 'exchangeCode', site: 'tenant_executor_run', class: 'no_scoped_table', reason: 'MCP OAuth code exchange: codes and grants' },
  { file: 'ai/oauth/mcp-oauth.service.ts', member: 'refresh', site: 'tenant_executor_run', class: 'no_scoped_table', reason: 'MCP OAuth refresh: grants' },
  { file: 'ai/oauth/mcp-oauth.service.ts', member: 'revoke', site: 'tenant_executor_run', class: 'no_scoped_table', reason: 'MCP OAuth revocation: grants' },

  // Model configurations: the list serves every chat user, the rest is AI settings.
  { file: 'ai/ai-model-configs.controller.ts', member: 'AiModelConfigsController', site: 'skip_tenant_transaction', class: 'no_scoped_table', reason: 'model configurations only (ai_model_configs); the settings routes are listed as reserved' },
  { file: 'ai/ai-model-configs.controller.ts', member: 'list', site: 'tenant_executor_run', class: 'no_scoped_table', reason: 'lists the model configurations a person may pick' },
  { file: 'ai/ai-model-configs.controller.ts', member: 'create', site: 'tenant_executor_run', class: 'reserved', reason: AI_SETTINGS },
  { file: 'ai/ai-model-configs.controller.ts', member: 'update', site: 'tenant_executor_run', class: 'reserved', reason: AI_SETTINGS },
  { file: 'ai/ai-model-configs.controller.ts', member: 'archive', site: 'tenant_executor_run', class: 'reserved', reason: AI_SETTINGS },
  { file: 'ai/ai-model-configs.controller.ts', member: 'restore', site: 'tenant_executor_run', class: 'reserved', reason: AI_SETTINGS },
  { file: 'ai/ai-model-configs.controller.ts', member: 'setDefault', site: 'tenant_executor_run', class: 'reserved', reason: AI_SETTINGS },
  { file: 'ai/ai-model-configs.controller.ts', member: 'clearDefault', site: 'tenant_executor_run', class: 'reserved', reason: AI_SETTINGS },
  { file: 'ai/ai-model-configs.controller.ts', member: 'test', site: 'tenant_executor_run', class: 'reserved', reason: AI_SETTINGS },
  { file: 'ai/ai-model-configs.controller.ts', member: 'test', site: 'transaction_false', class: 'reserved', reason: AI_SETTINGS },

  // AI settings and administration.
  { file: 'ai/ai-settings.controller.ts', member: 'AiSettingsController', site: 'skip_tenant_transaction', class: 'reserved', reason: AI_SETTINGS },
  { file: 'ai/ai-settings.controller.ts', member: 'getSettings', site: 'tenant_executor_run', class: 'reserved', reason: AI_SETTINGS },
  { file: 'ai/ai-settings.controller.ts', member: 'updateSettings', site: 'tenant_executor_run', class: 'reserved', reason: AI_SETTINGS },
  { file: 'ai/ai-settings.controller.ts', member: 'getBuiltinUsage', site: 'tenant_executor_run', class: 'reserved', reason: AI_SETTINGS },
  { file: 'ai/ai-settings.controller.ts', member: 'getBuiltinUsage', site: 'transaction_false', class: 'reserved', reason: AI_SETTINGS },
  { file: 'ai/ai-settings.controller.ts', member: 'testProvider', site: 'tenant_executor_run', class: 'reserved', reason: AI_SETTINGS },
  { file: 'ai/ai-settings.controller.ts', member: 'testProvider', site: 'transaction_false', class: 'reserved', reason: AI_SETTINGS },
  { file: 'ai/ai-settings.controller.ts', member: 'testWebSearch', site: 'tenant_executor_run', class: 'reserved', reason: AI_SETTINGS },
  { file: 'ai/ai-settings.controller.ts', member: 'testWebSearch', site: 'transaction_false', class: 'reserved', reason: AI_SETTINGS },
  { file: 'ai/ai-settings.controller.ts', member: 'testGlpi', site: 'tenant_executor_run', class: 'reserved', reason: AI_SETTINGS },
  { file: 'ai/ai-settings.controller.ts', member: 'testGlpi', site: 'transaction_false', class: 'reserved', reason: AI_SETTINGS },
  { file: 'ai/ai-integrations.controller.ts', member: 'AiIntegrationsController', site: 'skip_tenant_transaction', class: 'reserved', reason: AI_SETTINGS },
  { file: 'ai/ai-integrations.controller.ts', member: 'listMonitoring', site: 'tenant_executor_run', class: 'reserved', reason: AI_SETTINGS },
  { file: 'ai/ai-integrations.controller.ts', member: 'listMonitoring', site: 'transaction_false', class: 'reserved', reason: AI_SETTINGS },
  { file: 'ai/ai-integrations.controller.ts', member: 'savePrtg', site: 'tenant_executor_run', class: 'reserved', reason: AI_SETTINGS },
  { file: 'ai/ai-integrations.controller.ts', member: 'testPrtg', site: 'tenant_executor_run', class: 'reserved', reason: AI_SETTINGS },
  { file: 'ai/ai-integrations.controller.ts', member: 'testPrtg', site: 'transaction_false', class: 'reserved', reason: AI_SETTINGS },
  { file: 'ai/ai-admin-overview.controller.ts', member: 'AiAdminOverviewController', site: 'skip_tenant_transaction', class: 'reserved', reason: AI_SETTINGS },
  { file: 'ai/ai-admin-overview.controller.ts', member: 'getOverview', site: 'tenant_executor_run', class: 'reserved', reason: AI_SETTINGS },
  { file: 'ai/ai-admin-overview.controller.ts', member: 'getOverview', site: 'transaction_false', class: 'reserved', reason: AI_SETTINGS },
  { file: 'ai/search-index/ai-admin-search-index.controller.ts', member: 'AiAdminSearchIndexController', site: 'skip_tenant_transaction', class: 'reserved', reason: `${AI_SETTINGS}; rebuilds search_index for the whole tenant` },
  { file: 'ai/search-index/ai-admin-search-index.controller.ts', member: 'reindex', site: 'tenant_executor_run', class: 'reserved', reason: `${AI_SETTINGS}; rebuilds search_index for the whole tenant` },
  { file: 'ai/search-index/ai-admin-search-index.controller.ts', member: 'reindex', site: 'transaction_false', class: 'reserved', reason: `${AI_SETTINGS}; rebuilds search_index for the whole tenant` },
  { file: 'demo-data/demo-data.controller.ts', member: 'DemoDataController', site: 'skip_tenant_transaction', class: 'reserved', reason: 'sample data load and reset (administration): writes the budget block for the whole tenant' },

  // Agent screens: the person's context runs without applyDataAccess (runRead, runTransaction) or
  // without a transaction (runWithContext refuses a limited person).
  { file: 'ai/control-plane/agent-control/ai-agent-control.controller.ts', member: 'AiAgentControlController', site: 'skip_tenant_transaction', class: 'reserved', reason: AGENT_SCREENS },
  { file: 'ai/control-plane/agent-control/ai-agent-control.controller.ts', member: 'runRead', site: 'tenant_executor_run', class: 'reserved', reason: `${AGENT_SCREENS}; runs with the person's context outside runWithContext` },
  { file: 'ai/control-plane/agent-control/ai-agent-control.controller.ts', member: 'runRead', site: 'transaction_false', class: 'reserved', reason: `${AGENT_SCREENS}; runs with the person's context outside runWithContext` },
  { file: 'ai/control-plane/agent-control/ai-agent-control.controller.ts', member: 'runTransaction', site: 'tenant_executor_run', class: 'reserved', reason: `${AGENT_SCREENS}; runs with the person's context outside runWithContext` },
  { file: 'ai/control-plane/agent-control/ai-agent-control.service.ts', member: 'getAgentTargetingOptions', site: 'transaction_false', class: 'reserved', reason: `${AGENT_SCREENS}; background refresh through runWithContext, which refuses a limited person without a transaction` },

  // Exchange rates and Netbox: no table of the budget block.
  { file: 'currency/fx-ingestion.service.ts', member: 'withTenantManager', site: 'with_tenant_execution', class: 'no_scoped_table', reason: 'exchange rates (currency rate sets), from a login, a currency screen or the schedule' },
  { file: 'netbox/netbox-sync.service.ts', member: 'executeRun', site: 'with_tenant_execution', class: 'no_scoped_table', reason: 'Netbox sync: assets, locations and the Netbox state' },
  { file: 'netbox/netbox-sync.service.ts', member: 'executeRun', site: 'transaction_false', class: 'no_scoped_table', reason: 'Netbox sync: assets, locations and the Netbox state' },
  { file: 'netbox/netbox-sync.service.ts', member: 'applyRow', site: 'with_tenant_execution', class: 'no_scoped_table', reason: 'Netbox sync: assets, locations and the Netbox state' },
  { file: 'netbox/netbox-sync.service.ts', member: 'ignoreByDecision', site: 'with_tenant_execution', class: 'no_scoped_table', reason: 'Netbox sync: the Netbox state' },
  { file: 'netbox/netbox-sync.service.ts', member: 'markMissing', site: 'with_tenant_execution', class: 'no_scoped_table', reason: 'Netbox sync: the Netbox state' },
  { file: 'netbox/netbox-sync.service.ts', member: 'persistState', site: 'with_tenant_execution', class: 'no_scoped_table', reason: 'Netbox sync: the Netbox state' },
  { file: 'netbox/netbox-sync.service.ts', member: 'reconcileSubLocation', site: 'with_tenant_execution', class: 'no_scoped_table', reason: 'Netbox sync: locations' },
  { file: 'netbox/netbox-sync.service.ts', member: 'touchIgnored', site: 'with_tenant_execution', class: 'no_scoped_table', reason: 'Netbox sync: the Netbox state' },
  { file: 'netbox/netbox-sync.service.ts', member: 'upsertLink', site: 'with_tenant_execution', class: 'no_scoped_table', reason: 'Netbox sync: links between Netbox objects and assets' },

  // Scheduled jobs: no person, one run per tenant.
  { file: 'netbox/netbox-scheduled-sync.service.ts', member: 'run', site: 'with_tenant_execution', class: 'system', reason: 'scheduled Netbox sync, per tenant' },
  { file: 'netbox/netbox-scheduled-sync.service.ts', member: 'run', site: 'transaction_false', class: 'system', reason: 'scheduled Netbox sync, per tenant' },
  { file: 'ai/search-index/ai-search-index.service.ts', member: 'reindexAllTenants', site: 'with_tenant_execution', class: 'system', reason: 'scheduled search index rebuild, per tenant' },
  { file: 'ai/control-plane/agent/ai-agent-activity-retention.service.ts', member: 'run', site: 'with_tenant_execution', class: 'system', reason: 'scheduled purge of agent activity, per tenant' },
  { file: 'ai/control-plane/agent/ai-agent-approval-lifecycle-sweeper.service.ts', member: 'run', site: 'with_tenant_execution', class: 'system', reason: 'scheduled sweep of agent approvals, per tenant' },
  { file: 'ai/control-plane/agent/ai-agent-helpdesk-ticketing-ingestion.service.ts', member: 'run', site: 'with_tenant_execution', class: 'system', reason: 'scheduled helpdesk ticket ingestion, per tenant' },
  { file: 'ai/control-plane/agent/ai-agent-monitoring-alert-ingestion.service.ts', member: 'run', site: 'with_tenant_execution', class: 'system', reason: 'scheduled monitoring alert ingestion, per tenant' },
  { file: 'cleanup/ai-conversation-retention.service.ts', member: 'run', site: 'with_tenant_execution', class: 'system', reason: 'scheduled purge of old Plaid conversations, per tenant' },
  { file: 'cleanup/ai-mutation-preview-expiration.service.ts', member: 'run', site: 'with_tenant_execution', class: 'system', reason: 'scheduled expiry of Plaid action previews, per tenant' },
];
