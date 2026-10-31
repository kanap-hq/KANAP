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
 * `with_tenant_execution` (`withTenantExecution(`), `with_tenant` (`withTenant(`, a tenant
 * transaction of its own that never applies a person's access). `count` is the number of call
 * sites of that kind in the member (1 when absent); a class-level `@SkipTenantTransaction()` lists
 * the route methods of its class in `routes`. A second call, or a new route, fails the spec until
 * it is looked at.
 *
 * Classes:
 * - `applies`: goes through `AiTenantExecutionService.runWithContext` with the person, or another
 *   call point of `applyDataAccess`;
 * - `no_scoped_table`: reads and writes no table of the budget block (`spend_*`, `contracts`,
 *   `contract_*`, `tasks`, `task_*`, `search_index`, the link tables to lines and contracts);
 * - `reserved`: to be reserved to unscoped persons by lot 3 (AI settings, agent screens,
 *   administration);
 * - `system`: no person of the tenant (scheduled jobs, detached work, startup, command-line
 *   scripts, platform administration, webhooks). A site that serves a person and reads the budget
 *   block is `system` only when it sends nothing to anyone but the persons it names (notification
 *   recipients): scheduled jobs and notifications run as today (spec §5.6), lot 4 adds
 *   `data_access_can_read`.
 */

export type DataAccessPathSite =
  | 'skip_tenant_transaction'
  | 'transaction_false'
  | 'tenant_executor_run'
  | 'with_tenant_execution'
  | 'with_tenant';

export type DataAccessPathClass = 'applies' | 'no_scoped_table' | 'reserved' | 'system';

export type DataAccessPathEntry = {
  /** Relative to `backend/src`. */
  file: string;
  member: string;
  site: DataAccessPathSite;
  class: DataAccessPathClass;
  reason: string;
  /** Call sites of this kind in the member, when more than one. */
  count?: number;
  /** Class-level `@SkipTenantTransaction()`: the route methods of the class it covers. */
  routes?: string[];
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
  // The tenant interceptor: a reserved route without the request transaction reads the person's mode.
  { file: 'common/tenant.interceptor.ts', member: 'intercept', site: 'with_tenant_execution', class: 'no_scoped_table', reason: 'a route reserved to unscoped persons that skips the request transaction: reads the person\'s mode (users, roles) before the handler, refuses a limited person (reserved-operations.ts)' },

  // Plaid and MCP: runWithContext applies the person's access.
  { file: 'ai/ai-chat.controller.ts', member: 'AiChatController', site: 'skip_tenant_transaction', class: 'applies', reason: `${RUN_WITH_CONTEXT} (the orchestrator too)` , routes: ['stream'] },
  { file: 'ai/ai-conversations.controller.ts', member: 'AiConversationsController', site: 'skip_tenant_transaction', class: 'applies', reason: RUN_WITH_CONTEXT , routes: ['archive', 'create', 'getMessages', 'getPreviews', 'list', 'rename', 'uploadInlineAttachment', 'viewInlineAttachment'] },
  { file: 'ai/ai-mcp.controller.ts', member: 'AiMcpController', site: 'skip_tenant_transaction', class: 'applies', reason: `${RUN_WITH_CONTEXT}; GET and DELETE answer 405 without the database` , routes: ['handleDelete', 'handleGet', 'handlePost', 'listAudit'] },
  { file: 'ai/ai-search.controller.ts', member: 'AiSearchController', site: 'skip_tenant_transaction', class: 'applies', reason: RUN_WITH_CONTEXT , routes: ['searchEntities'] },

  // Capabilities, MCP keys and connections: no table of the budget block.
  { file: 'ai/ai-capabilities.controller.ts', member: 'AiCapabilitiesController', site: 'skip_tenant_transaction', class: 'no_scoped_table', reason: 'reads the AI settings and the person\'s permissions' , routes: ['getCapabilities'] },
  { file: 'ai/ai-capabilities.controller.ts', member: 'getCapabilities', site: 'tenant_executor_run', class: 'no_scoped_table', reason: 'reads the AI settings and the person\'s permissions' },
  { file: 'ai/ai-api-keys.controller.ts', member: 'AiApiKeysController', site: 'skip_tenant_transaction', class: 'no_scoped_table', reason: 'MCP keys (ai_api_keys) and their audit only; the admin routes are listed as reserved' , routes: ['adminList', 'adminMcpAudit', 'adminRevoke', 'create', 'list', 'revoke'] },
  { file: 'ai/ai-api-keys.controller.ts', member: 'create', site: 'tenant_executor_run', class: 'no_scoped_table', reason: 'the person\'s own MCP key (ai_api_keys)' },
  { file: 'ai/ai-api-keys.controller.ts', member: 'list', site: 'tenant_executor_run', class: 'no_scoped_table', reason: 'the person\'s own MCP keys (ai_api_keys)' },
  { file: 'ai/ai-api-keys.controller.ts', member: 'revoke', site: 'tenant_executor_run', class: 'no_scoped_table', reason: 'the person\'s own MCP key (ai_api_keys)' },
  { file: 'ai/ai-api-keys.controller.ts', member: 'adminList', site: 'tenant_executor_run', class: 'reserved', reason: AI_SETTINGS },
  { file: 'ai/ai-api-keys.controller.ts', member: 'adminRevoke', site: 'tenant_executor_run', class: 'reserved', reason: AI_SETTINGS },
  { file: 'ai/ai-api-keys.service.ts', member: 'logAudit', site: 'tenant_executor_run', class: 'no_scoped_table', reason: 'writes an MCP key event to audit_log' },
  { file: 'ai/ai-api-keys.service.ts', member: 'logAudit', site: 'transaction_false', class: 'no_scoped_table', reason: 'writes an MCP key event to audit_log' },
  { file: 'ai/auth/mcp-api-key-auth.guard.ts', member: 'authenticate', site: 'tenant_executor_run', class: 'no_scoped_table', reason: 'guard: reads the MCP key and its person (ai_api_keys, users)' },
  { file: 'ai/auth/mcp-api-key-auth.guard.ts', member: 'recordRefusedKey', site: 'tenant_executor_run', class: 'no_scoped_table', reason: 'guard: writes a refused key to the MCP journal (ai_runs, ai_tool_executions)' },
  { file: 'ai/oauth/mcp-oauth.controller.ts', member: 'McpOAuthController', site: 'skip_tenant_transaction', class: 'no_scoped_table', reason: 'MCP OAuth flow: clients, codes, grants and the person' , routes: ['authorize', 'decide', 'describe', 'revoke', 'token'] },
  { file: 'ai/oauth/mcp-oauth.controller.ts', member: 'McpOAuthMetadataController', site: 'skip_tenant_transaction', class: 'no_scoped_table', reason: 'OAuth metadata documents, no tenant table' , routes: ['authorizationServer', 'protectedResourceAtRoot', 'protectedResourceForPath'] },
  { file: 'ai/oauth/mcp-oauth.service.ts', member: 'authenticateAccessToken', site: 'tenant_executor_run', class: 'no_scoped_table', reason: 'MCP OAuth grants and the person' },
  { file: 'ai/oauth/mcp-oauth.service.ts', member: 'decide', site: 'tenant_executor_run', class: 'no_scoped_table', reason: 'MCP OAuth consent: grants and the person' },
  { file: 'ai/oauth/mcp-oauth.service.ts', member: 'describeRequest', site: 'tenant_executor_run', class: 'no_scoped_table', reason: 'MCP OAuth consent screen: client and the person' },
  { file: 'ai/oauth/mcp-oauth.service.ts', member: 'exchangeCode', site: 'tenant_executor_run', class: 'no_scoped_table', reason: 'MCP OAuth code exchange: codes and grants', count: 2 },
  { file: 'ai/oauth/mcp-oauth.service.ts', member: 'refresh', site: 'tenant_executor_run', class: 'no_scoped_table', reason: 'MCP OAuth refresh: grants' },
  { file: 'ai/oauth/mcp-oauth.service.ts', member: 'revoke', site: 'tenant_executor_run', class: 'no_scoped_table', reason: 'MCP OAuth revocation: grants' },

  // Model configurations: the list serves every chat user, the rest is AI settings.
  { file: 'ai/ai-model-configs.controller.ts', member: 'AiModelConfigsController', site: 'skip_tenant_transaction', class: 'no_scoped_table', reason: 'model configurations only (ai_model_configs); the settings routes are listed as reserved' , routes: ['archive', 'clearDefault', 'create', 'list', 'restore', 'setDefault', 'test', 'update'] },
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
  { file: 'ai/ai-settings.controller.ts', member: 'AiSettingsController', site: 'skip_tenant_transaction', class: 'reserved', reason: AI_SETTINGS , routes: ['getBuiltinUsage', 'getSettings', 'testGlpi', 'testProvider', 'testWebSearch', 'updateSettings'] },
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
  { file: 'ai/ai-integrations.controller.ts', member: 'AiIntegrationsController', site: 'skip_tenant_transaction', class: 'reserved', reason: AI_SETTINGS , routes: ['listMonitoring', 'savePrtg', 'testPrtg'] },
  { file: 'ai/ai-integrations.controller.ts', member: 'listMonitoring', site: 'tenant_executor_run', class: 'reserved', reason: AI_SETTINGS },
  { file: 'ai/ai-integrations.controller.ts', member: 'listMonitoring', site: 'transaction_false', class: 'reserved', reason: AI_SETTINGS },
  { file: 'ai/ai-integrations.controller.ts', member: 'savePrtg', site: 'tenant_executor_run', class: 'reserved', reason: AI_SETTINGS },
  { file: 'ai/ai-integrations.controller.ts', member: 'testPrtg', site: 'tenant_executor_run', class: 'reserved', reason: AI_SETTINGS },
  { file: 'ai/ai-integrations.controller.ts', member: 'testPrtg', site: 'transaction_false', class: 'reserved', reason: AI_SETTINGS },
  { file: 'ai/ai-admin-overview.controller.ts', member: 'AiAdminOverviewController', site: 'skip_tenant_transaction', class: 'reserved', reason: AI_SETTINGS , routes: ['getOverview'] },
  { file: 'ai/ai-admin-overview.controller.ts', member: 'getOverview', site: 'tenant_executor_run', class: 'reserved', reason: AI_SETTINGS },
  { file: 'ai/ai-admin-overview.controller.ts', member: 'getOverview', site: 'transaction_false', class: 'reserved', reason: AI_SETTINGS },
  { file: 'ai/search-index/ai-admin-search-index.controller.ts', member: 'AiAdminSearchIndexController', site: 'skip_tenant_transaction', class: 'reserved', reason: `${AI_SETTINGS}; rebuilds search_index for the whole tenant` , routes: ['reindex'] },
  { file: 'ai/search-index/ai-admin-search-index.controller.ts', member: 'reindex', site: 'tenant_executor_run', class: 'reserved', reason: `${AI_SETTINGS}; rebuilds search_index for the whole tenant` },
  { file: 'ai/search-index/ai-admin-search-index.controller.ts', member: 'reindex', site: 'transaction_false', class: 'reserved', reason: `${AI_SETTINGS}; rebuilds search_index for the whole tenant` },
  { file: 'demo-data/demo-data.controller.ts', member: 'DemoDataController', site: 'skip_tenant_transaction', class: 'reserved', reason: 'sample data load and reset (administration): writes the budget block for the whole tenant' , routes: ['dismiss', 'load', 'overview', 'reset'] },

  // Agent screens: the person's context runs without applyDataAccess (runRead, runTransaction) or
  // without a transaction (runWithContext refuses a limited person).
  { file: 'ai/control-plane/agent-control/ai-agent-control.controller.ts', member: 'AiAgentControlController', site: 'skip_tenant_transaction', class: 'reserved', reason: AGENT_SCREENS , routes: [
      'acknowledgeAllAttention',
      'acknowledgeAttention',
      'approveAction',
      'approveActionsBulk',
      'archiveSharedContextProfile',
      'createAgent',
      'createEmergencyPause',
      'createHelpdeskEmergencyPause',
      'createSharedContextProfile',
      'deleteAgentDefinition',
      'dismissAction',
      'getAgent',
      'getAgentAutonomy',
      'getAgentEffectivePrompt',
      'getAgentTargetingOptions',
      'getAttentionSummary',
      'getBadges',
      'getHelpdeskEvaluationDaily',
      'getHelpdeskWorkItemContext',
      'getQueueOverview',
      'getRun',
      'listActions',
      'listActivity',
      'listAgentMonitoringAlertDiagnoses',
      'listAgents',
      'listGlpiReadTargets',
      'listRuns',
      'listSharedContextProfiles',
      'listTicketingReadTargets',
      'pollHelpdeskGlpiIngestion',
      'pollHelpdeskTicketingIngestion',
      'pollSreMonitoringIngestion',
      'previewAgentTargeting',
      'rejectAction',
      'revokeEmergencyPause',
      'revokeHelpdeskEmergencyPause',
      'runGlpiRead',
      'runMockTriage',
      'runTicketingRead',
      'runTicketingTriage',
      'setAgentAutonomy',
      'testAgentMonitoringDiagnosis',
      'updateAgent',
      'updateAgentStatus',
      'updateSharedContextProfile',
    ] },
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

  // withTenant: a tenant transaction of its own, never with a person's access.
  // Sign-in, sessions, SSO and accounts: users, tokens, auth events, tenant SSO settings.
  { file: 'auth/auth.controller.ts', member: 'runInRequestTenant', site: 'with_tenant', class: 'no_scoped_table', reason: 'sign-in, refresh, sign-out and password reset routes: users, sessions and tokens' },
  { file: 'auth/auth.controller.ts', member: 'exchangeProvisioningToken', site: 'with_tenant', class: 'no_scoped_table', reason: 'provisioning sign-in: finds the person by email (users)' },
  { file: 'auth/auth.controller.ts', member: 'deliverPasswordReset', site: 'with_tenant', class: 'no_scoped_table', reason: 'password reset token (users, password reset tokens)' },
  { file: 'auth/entra.controller.ts', member: 'handleLoginCallback', site: 'with_tenant', class: 'no_scoped_table', reason: 'Entra sign-in callback: users and sessions' },
  { file: 'auth/entra.controller.ts', member: 'handleConsentCallback', site: 'with_tenant', class: 'no_scoped_table', reason: 'Entra consent callback: audit_log entry on the tenant' },
  { file: 'auth/entra.controller.ts', member: 'handleSetupCallback', site: 'with_tenant', class: 'no_scoped_table', reason: 'Entra setup callback: audit_log entry on the tenant' },
  { file: 'auth/entra.controller.ts', member: 'issueLoginSession', site: 'with_tenant', class: 'no_scoped_table', reason: 'Entra sign-in: the person and their session' },
  { file: 'auth/entra-directory-sync.service.ts', member: 'syncTenant', site: 'with_tenant', class: 'no_scoped_table', reason: 'Entra directory sync (schedule, setup, admin route): users and their managers', count: 2 },
  { file: 'audit/security-events.service.ts', member: 'recordAuthEvent', site: 'with_tenant', class: 'no_scoped_table', reason: 'writes a sign-in event to audit_log' },
  { file: 'public/public.controller.ts', member: 'activateTrial', site: 'with_tenant', class: 'no_scoped_table', reason: 'trial activation: password reset token of the new administrator (users)' },

  // Billing and AI usage counters.
  { file: 'billing/billing.service.ts', member: 'updateSubscriptionCustomer', site: 'with_tenant', class: 'no_scoped_table', reason: 'invoicing details of the subscription (subscriptions)' },
  { file: 'billing/stripe-webhook.service.ts', member: 'lookupTenant', site: 'with_tenant', class: 'system', reason: 'Stripe webhook: finds the tenant of a subscription (subscriptions)' },
  { file: 'billing/stripe-webhook.service.ts', member: 'applyEventToTenant', site: 'with_tenant', class: 'system', reason: 'Stripe webhook: updates the subscription (subscriptions)' },
  { file: 'ai/platform/ai-builtin-usage.service.ts', member: 'reserveMessageDetached', site: 'with_tenant', class: 'no_scoped_table', reason: 'Plaid built-in model message counter (AI usage tables)' },
  { file: 'ai/platform/ai-builtin-usage.service.ts', member: 'getUsageForAllTenants', site: 'with_tenant', class: 'system', reason: 'platform administration: built-in model usage per tenant (AI usage tables)' },

  // Notifications: recipients, preferences and deduplication.
  { file: 'notifications/notifications.service.ts', member: 'buildItemUrl', site: 'with_tenant', class: 'system', reason: 'notification link: reads the reference of a budget line (spend_items) for the recipients of its notification: the named owners (status change, expiry reminder), or the persons the sender chose in "Send the link" (sent whatever their access, the sender is warned through data_access_can_read); spec §5.6' },
  { file: 'notifications/notifications.service.ts', member: 'notifyItLeadOfTeamChange', site: 'with_tenant', class: 'no_scoped_table', reason: 'the IT lead (users) and the reference of a project or request' },
  { file: 'notifications/notifications.service.ts', member: 'notifySsoUserProvisioned', site: 'with_tenant', class: 'no_scoped_table', reason: 'the administrators to tell (users)' },
  { file: 'notifications/notifications.service.ts', member: 'notifyWorkspaceReset', site: 'with_tenant', class: 'no_scoped_table', reason: 'the administrators to tell (users)' },
  { file: 'notifications/notifications.service.ts', member: 'claimExpiryReminders', site: 'with_tenant', class: 'no_scoped_table', reason: 'expiry reminders already sent (audit_log keys)' },
  { file: 'notifications/notification-dedupe.ts', member: 'claimNotificationKeys', site: 'with_tenant', class: 'no_scoped_table', reason: 'notification deduplication keys (notification_dedupe)' },
  { file: 'notifications/notification-preferences.service.ts', member: 'getForUser', site: 'with_tenant', class: 'no_scoped_table', reason: 'the person\'s notification preferences' },
  { file: 'notifications/notification-preferences.service.ts', member: 'updateForUser', site: 'with_tenant', class: 'no_scoped_table', reason: 'the person\'s notification preferences' },

  // Sample data and workspace reset: Administrator only (always unscoped).
  { file: 'demo-data/demo-data.service.ts', member: 'getOverview', site: 'with_tenant', class: 'reserved', reason: 'sample data overview (Administrator only): checks whether the workspace holds data, budget block included', count: 2 },
  { file: 'demo-data/demo-data.service.ts', member: 'dismissBanner', site: 'with_tenant', class: 'reserved', reason: 'sample data banner (Administrator only)' },
  { file: 'demo-data/demo-data.service.ts', member: 'startLoad', site: 'with_tenant', class: 'reserved', reason: 'sample data load (Administrator from the screen, the trial owner at activation): checks the workspace is empty, budget block included', count: 2 },
  { file: 'demo-data/demo-data.service.ts', member: 'startReset', site: 'with_tenant', class: 'reserved', reason: 'workspace reset (Administrator only)' },
  { file: 'admin/tenants/tenant-reset.service.ts', member: 'reset', site: 'with_tenant', class: 'reserved', reason: 'workspace reset started by an Administrator (sample data): erases the whole tenant, budget block included' },

  // Platform administration (PlatformAdminGuard): no person of the tenant.
  { file: 'admin/tenants/admin-tenants.service.ts', member: 'updatePlan', site: 'with_tenant', class: 'system', reason: 'platform administration: the tenant\'s plan (subscriptions)' },
  { file: 'admin/tenants/admin-tenants.service.ts', member: 'markInternal', site: 'with_tenant', class: 'system', reason: 'platform administration: internal tenant (subscriptions)' },
  { file: 'admin/tenants/admin-tenants.service.ts', member: 'buildTenantSummary', site: 'with_tenant', class: 'system', reason: 'platform administration: subscription summary of a tenant' },
  { file: 'admin/tenants/admin-tenants.service.ts', member: 'logTenantAction', site: 'with_tenant', class: 'system', reason: 'platform administration: audit_log entry on the tenant' },
  { file: 'admin/tenants/admin-tenants.service.ts', member: 'purgeTenantData', site: 'with_tenant', class: 'system', reason: 'platform administration: tenant deletion purges every table, budget block included' },
  { file: 'admin/tenants/tenant-stats.service.ts', member: 'compute', site: 'with_tenant', class: 'system', reason: 'platform administration: row counts of a tenant, budget lines included' },

  // Scheduled and detached jobs, command-line scripts: no person.
  { file: 'cleanup/auth-event-retention.service.ts', member: 'run', site: 'with_tenant', class: 'system', reason: 'scheduled purge of old sign-in events, per tenant' },
  { file: 'cleanup/list-context-purge.service.ts', member: 'run', site: 'with_tenant', class: 'system', reason: 'scheduled purge of old list contexts, per tenant' },
  { file: 'cleanup/lifecycle-status-sync.service.ts', member: 'syncTenant', site: 'with_tenant', class: 'system', reason: 'hourly status sync from end dates (contracts, spend_items, cost_centers, ...), per tenant; sends nothing' },
  { file: 'contracts/contract-renewal.service.ts', member: 'run', site: 'with_tenant', class: 'system', reason: 'scheduled contract renewal tasks (contracts), assigned to the named contract owners; their notifications go to the persons named on the task (getTaskRecipients checks the others with data_access_can_read); spec §5.6' },
  { file: 'technologies/catalog/technology-catalog-sync.service.ts', member: 'adoptedKeys', site: 'with_tenant', class: 'system', reason: 'scheduled technology catalog sync, per tenant (technologies)' },
  { file: 'technologies/catalog/technology-catalog-sync.service.ts', member: 'run', site: 'with_tenant', class: 'system', reason: 'scheduled technology catalog sync, per tenant (technologies)' },
  { file: 'vulnerabilities/nvd-feed.service.ts', member: 'followedProducts', site: 'with_tenant', class: 'system', reason: 'vulnerability feed: followed products (technologies)' },
  { file: 'vulnerabilities/nvd-feed.service.ts', member: 'runOnce', site: 'with_tenant', class: 'system', reason: 'scheduled vulnerability feed: matching and digests to the people who follow the technologies', count: 2 },
  { file: 'vulnerabilities/nvd-feed.service.ts', member: 'drain', site: 'with_tenant', class: 'system', reason: 'detached rematch queued after a technology change (vulnerability and technology tables)' },
  { file: 'vulnerabilities/nvd-feed.service.ts', member: 'flushRematch', site: 'with_tenant', class: 'system', reason: 'detached rematch of the tenants carrying changed products (vulnerability and technology tables)' },
  { file: 'vulnerabilities/nvd-feed.service.ts', member: 'tenantsCarrying', site: 'with_tenant', class: 'system', reason: 'vulnerability feed: which tenants carry a product (technologies)' },
  { file: 'vulnerabilities/nvd-feed.service.ts', member: 'announceExploited', site: 'with_tenant', class: 'system', reason: 'vulnerability feed: digests of newly exploited CVEs to the people who follow the technologies' },
  { file: 'knowledge/scripts/backfill-integrated-docs.ts', member: 'seedTenantAssets', site: 'with_tenant', class: 'system', reason: 'command-line script: integrated documents backfill' },
  { file: 'knowledge/scripts/backfill-integrated-docs.ts', member: 'processBatch', site: 'with_tenant', class: 'system', reason: 'command-line script: integrated documents backfill', count: 2 },
  { file: 'knowledge/scripts/verify-integrated-docs.ts', member: 'main', site: 'with_tenant', class: 'system', reason: 'command-line script: integrated documents check' },
  { file: 'knowledge/scripts/verify-integrated-docs.ts', member: 'verifyEntityBatch', site: 'with_tenant', class: 'system', reason: 'command-line script: integrated documents check', count: 2 },
];
