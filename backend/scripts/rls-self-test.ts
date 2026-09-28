/*
 RLS Self-Test Script
 - Connects to DATABASE_URL
 - Creates two temporary tenants inside one transaction
 - Verifies critical tables are RLS-enabled and forced
 - Verifies real cross-tenant reads and writes are blocked on the Phase 1 AI graph
 - Prints a summary and exits non-zero on failure
*/
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { DataSource, QueryRunner } from 'typeorm';
import { assertSafeDatabaseRole } from '../src/common/database-role-safety';

type TestResult = { name: string; ok: boolean; info?: string };

const TABLES_TO_CHECK_RLS = Array.from(new Set([
  'users', 'companies', 'departments', 'cost_centers', 'working_day_profiles', 'suppliers', 'accounts',
  'analytics_axes', 'analytics_categories', 'spend_item_analytics_values', 'capex_item_analytics_values',
  'spend_items', 'spend_versions', 'spend_amounts', 'spend_allocations', 'spend_round_inputs', 'spend_tasks',
  'contracts', 'contract_tasks', 'contract_spend_items', 'contract_attachments', 'contract_links',
  'capex_items', 'capex_versions', 'capex_amounts', 'capex_round_inputs',
  'tasks', 'currency_rate_sets', 'item_sequences',
  'document_libraries', 'document_folders', 'document_types', 'documents', 'document_versions',
  'document_edit_locks', 'document_attachments', 'document_activities', 'document_contributors',
  'document_classifications', 'document_references', 'document_applications', 'document_assets',
  'document_connections', 'document_interfaces', 'document_locations', 'document_projects', 'document_requests', 'document_tasks',
  'integrated_document_bindings', 'integrated_document_slot_settings',
  'roles', 'role_permissions', 'subscriptions',
  'audit_log', 'company_metrics', 'department_metrics', 'user_page_roles',
  'applications', 'assets', 'app_instances', 'app_asset_assignments',
  'application_suites', 'asset_relations',
  'portfolio_projects', 'portfolio_requests', 'portfolio_criteria', 'portfolio_criterion_values',
  'portfolio_request_projects', 'portfolio_request_dependencies', 'portfolio_project_dependencies',
  'application_projects', 'asset_projects',
  'portfolio_request_applications', 'portfolio_request_assets',
  'ai_settings', 'ai_model_configs', 'ai_api_keys', 'ai_conversations', 'ai_message_attachments', 'ai_messages',
  'ai_mutation_plan_steps', 'ai_mutation_plans', 'ai_mutation_previews',
  'ai_runs', 'ai_run_steps', 'ai_tool_executions', 'ai_evidence',
  'ai_action_requests', 'ai_approvals', 'ai_emergency_pauses',
  'ai_agent_definitions', 'ai_agent_triggers', 'ai_agent_work_items', 'ai_agent_target_states', 'ai_agent_audit_events', 'ai_shared_context_profiles',
  'ai_adapter_configs', 'ai_approval_policies', 'ai_autonomy_ceilings', 'ai_autonomy_routines',
  'ai_external_mcp_servers', 'ai_external_mcp_tool_snapshots',
  'ai_automation_job_catalog', 'ai_live_test_targets', 'ai_observations', 'ai_recommendations', 'ai_decisions', 'ai_evaluations',
]));

const TABLES_TO_CHECK_POLICY = new Set([
  'applications',
  'assets',
  'app_instances',
  'app_asset_assignments',
  'application_suites',
  'asset_relations',
  'portfolio_projects',
  'portfolio_requests',
  'portfolio_request_projects',
  'portfolio_request_dependencies',
  'portfolio_project_dependencies',
  'application_projects',
  'asset_projects',
  'portfolio_request_applications',
  'portfolio_request_assets',
  'ai_settings',
  'ai_model_configs',
  'ai_api_keys',
  'ai_conversations',
  'ai_message_attachments',
  'ai_messages',
  'ai_mutation_plan_steps',
  'ai_mutation_plans',
  'ai_mutation_previews',
  'ai_runs',
  'ai_run_steps',
  'ai_tool_executions',
  'ai_evidence',
  'ai_action_requests',
  'ai_approvals',
  'ai_emergency_pauses',
  'ai_agent_definitions',
  'ai_agent_triggers',
  'ai_agent_work_items',
  'ai_agent_target_states',
  'ai_agent_audit_events',
  'ai_shared_context_profiles',
  'ai_adapter_configs',
  'ai_approval_policies',
  'ai_autonomy_ceilings',
  'ai_autonomy_routines',
  'ai_external_mcp_servers',
  'ai_external_mcp_tool_snapshots',
  'ai_automation_job_catalog',
  'ai_live_test_targets',
  'ai_observations',
  'ai_recommendations',
  'ai_decisions',
  'ai_evaluations',
  'search_index',
  'portfolio_criteria',
  'portfolio_criterion_values',
  'cost_centers',
  'analytics_axes',
  'analytics_categories',
  'spend_item_analytics_values',
  'capex_item_analytics_values',
  'spend_round_inputs',
  'capex_round_inputs',
  'working_day_profiles',
]);

const TABLES_TO_CHECK_FORCE = new Set([
  'companies',
  'spend_items',
  'contracts',
  'roles',
  'capex_items',
  'document_libraries',
  'documents',
  'item_sequences',
  ...TABLES_TO_CHECK_POLICY,
]);

type RlsState = {
  enabled: boolean;
  forced: boolean;
};

type AiGraphSeed = {
  applicationId: string;
  suiteApplicationId: string;
  assetId: string;
  relatedAssetId: string;
  appInstanceId: string;
  appAssetAssignmentId: string;
  projectId: string;
  dependencyProjectId: string;
  requestId: string;
  applicationProjectId: string;
  assetProjectId: string;
  requestApplicationId: string;
  requestAssetId: string;
  requestProjectId: string;
  requestDependencyId: string;
  projectDependencyId: string;
  applicationSuiteId: string;
  assetRelationId: string;
};

function randTag() {
  return Math.random().toString(36).slice(2, 8);
}

async function setTenant(r: QueryRunner, tenantId: string) {
  await r.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

async function getRlsState(r: QueryRunner, table: string): Promise<RlsState> {
  const rows = await r.query(
    `SELECT c.relrowsecurity AS enabled,
            c.relforcerowsecurity AS forced
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = $1`,
    [table],
  );

  return {
    enabled: !!rows?.[0]?.enabled,
    forced: !!rows?.[0]?.forced,
  };
}

async function hasTenantIsolationPolicy(r: QueryRunner, table: string): Promise<boolean> {
  const rows = await r.query(
    `SELECT 1
     FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = $1
       AND policyname = $2`,
    [table, `${table}_tenant_isolation`],
  );
  return rows.length > 0;
}

async function expectCrossTenantReadBlocked(
  r: QueryRunner,
  results: TestResult[],
  name: string,
  sql: string,
  params: unknown[],
) {
  const rows = await r.query(sql, params);
  results.push({ name, ok: rows.length === 0, info: rows.length > 0 ? `returned ${rows.length} row(s)` : undefined });
}

async function expectCrossTenantInsertBlocked(
  r: QueryRunner,
  results: TestResult[],
  name: string,
  sql: string,
  params: unknown[],
) {
  let blocked = false;
  await r.query('SAVEPOINT rls_cross_tenant_write');
  try {
    await r.query(sql, params);
  } catch {
    blocked = true;
  } finally {
    await r.query('ROLLBACK TO SAVEPOINT rls_cross_tenant_write');
  }
  results.push({ name, ok: blocked });
}

async function insertMinimalAgentDefinition(
  r: QueryRunner,
  id: string,
  tenantId: string,
  agentKey: string,
) {
  await r.query(
    `INSERT INTO ai_agent_definitions (
       id, tenant_id, agent_key, name, agent_type, status, environment,
       max_autonomy_level, default_approval_requirement
     )
     VALUES ($1, $2, $3, 'Delete-guard agent', 'helpdesk', 'enabled', 'sandbox', 'A3', 'human_for_writes')`,
    [id, tenantId, agentKey],
  );
}

async function insertMinimalWorkItem(
  r: QueryRunner,
  input: {
    id: string;
    tenantId: string;
    definitionId: string;
    triggerId?: string | null;
    dedupKey: string;
    objectRef?: string;
  },
) {
  await r.query(
    `INSERT INTO ai_agent_work_items (
       id, tenant_id, agent_definition_id, trigger_id, source_provider_kind, source_provider_key,
       source_object_type, source_object_ref, work_kind, status, dedup_key
     )
     VALUES ($1, $2, $3, $4, 'ticketing', 'mock', 'ticket', $5, 'ticket_triage', 'queued', $6)`,
    [
      input.id,
      input.tenantId,
      input.definitionId,
      input.triggerId ?? null,
      input.objectRef ?? 'delete-guard-ticket',
      input.dedupKey,
    ],
  );
}

async function withSavepoint(
  r: QueryRunner,
  results: TestResult[],
  name: string,
  fn: () => Promise<void>,
) {
  const savepoint = `rls_${name.replace(/[^a-z0-9]/gi, '').slice(0, 20)}_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
  await r.query(`SAVEPOINT ${savepoint}`);
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, info: error instanceof Error ? error.message : String(error) });
  } finally {
    await r.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
  }
}

async function seedTenant(runner: QueryRunner, tenantId: string, slug: string, name: string) {
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, slug, name],
  );
}

async function seedAiGraph(r: QueryRunner, tenantId: string, tag: string): Promise<AiGraphSeed> {
  await setTenant(r, tenantId);

  const ids: AiGraphSeed = {
    applicationId: randomUUID(),
    suiteApplicationId: randomUUID(),
    assetId: randomUUID(),
    relatedAssetId: randomUUID(),
    appInstanceId: randomUUID(),
    appAssetAssignmentId: randomUUID(),
    projectId: randomUUID(),
    dependencyProjectId: randomUUID(),
    requestId: randomUUID(),
    applicationProjectId: randomUUID(),
    assetProjectId: randomUUID(),
    requestApplicationId: randomUUID(),
    requestAssetId: randomUUID(),
    requestProjectId: randomUUID(),
    requestDependencyId: randomUUID(),
    projectDependencyId: randomUUID(),
    applicationSuiteId: randomUUID(),
    assetRelationId: randomUUID(),
  };

  await r.query(
    `INSERT INTO applications (
       id, tenant_id, name, category, description, criticality, data_class,
       hosting_model, users_mode, users_year, environment, lifecycle, status,
       created_at, updated_at
     )
     VALUES
       ($1, $2, $3, 'line_of_business', $4, 'high', 'internal', 'saas', 'manual', 250, 'prod', 'active', 'enabled', now(), now()),
       ($5, $2, $6, 'line_of_business', $7, 'medium', 'internal', 'saas', 'manual', 120, 'prod', 'active', 'enabled', now(), now())`,
    [
      ids.applicationId,
      tenantId,
      `RLS App ${tag}`,
      `Primary application ${tag}`,
      ids.suiteApplicationId,
      `RLS Suite ${tag}`,
      `Suite application ${tag}`,
    ],
  );

  await r.query(
    `INSERT INTO assets (
       id, tenant_id, name, kind, provider, environment, hostname, fqdn, status, notes, created_at, updated_at
     )
     VALUES
       ($1, $2, $3, 'vm', 'aws', 'prod', $4, $5, 'active', $6, now(), now()),
       ($7, $2, $8, 'vm', 'aws', 'prod', $9, $10, 'active', $11, now(), now())`,
    [
      ids.assetId,
      tenantId,
      `RLS Asset ${tag}`,
      `asset-${tag}`,
      `asset-${tag}.example.com`,
      `Primary asset ${tag}`,
      ids.relatedAssetId,
      `RLS Related Asset ${tag}`,
      `asset-related-${tag}`,
      `asset-related-${tag}.example.com`,
      `Related asset ${tag}`,
    ],
  );

  await r.query(
    `INSERT INTO app_instances (
       id, tenant_id, application_id, environment, lifecycle, sso_enabled, mfa_supported,
       status, base_url, notes, created_at, updated_at
     )
     VALUES ($1, $2, $3, 'prod', 'active', true, true, 'enabled', $4, $5, now(), now())`,
    [
      ids.appInstanceId,
      tenantId,
      ids.applicationId,
      `https://app-${tag}.example.com`,
      `Primary instance ${tag}`,
    ],
  );

  await r.query(
    `INSERT INTO app_asset_assignments (
       id, tenant_id, app_instance_id, asset_id, role, notes, created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, 'primary', $5, now(), now())`,
    [ids.appAssetAssignmentId, tenantId, ids.appInstanceId, ids.assetId, `Primary assignment ${tag}`],
  );

  await r.query(
    `INSERT INTO portfolio_projects (
       id, tenant_id, item_number, name, origin, status, execution_progress, planned_end, created_at, updated_at
     )
     VALUES
       ($1, $2, 9301, $3, 'fast_track', 'planned', 25, DATE '2026-12-31', now(), now()),
       ($4, $2, 9302, $5, 'legacy', 'in_progress', 75, DATE '2026-11-30', now(), now())`,
    [
      ids.projectId,
      tenantId,
      `RLS Project ${tag}`,
      ids.dependencyProjectId,
      `RLS Dependency Project ${tag}`,
    ],
  );

  await r.query(
    `INSERT INTO portfolio_requests (
       id, tenant_id, item_number, name, status, current_situation, expected_benefits,
       criteria_values, feasibility_review, priority_override, created_at, updated_at
     )
     VALUES (
       $1, $2, 9201, $3, 'pending_review', $4, $5,
       '{}'::jsonb, '{}'::jsonb, false, now(), now()
     )`,
    [
      ids.requestId,
      tenantId,
      `RLS Request ${tag}`,
      `Current situation ${tag}`,
      `Expected benefits ${tag}`,
    ],
  );

  await r.query(
    `INSERT INTO application_projects (id, tenant_id, application_id, project_id, created_at)
     VALUES ($1, $2, $3, $4, now())`,
    [ids.applicationProjectId, tenantId, ids.applicationId, ids.projectId],
  );
  await r.query(
    `INSERT INTO asset_projects (id, tenant_id, asset_id, project_id, created_at)
     VALUES ($1, $2, $3, $4, now())`,
    [ids.assetProjectId, tenantId, ids.assetId, ids.projectId],
  );
  await r.query(
    `INSERT INTO portfolio_request_applications (id, tenant_id, request_id, application_id, created_at)
     VALUES ($1, $2, $3, $4, now())`,
    [ids.requestApplicationId, tenantId, ids.requestId, ids.applicationId],
  );
  await r.query(
    `INSERT INTO portfolio_request_assets (id, tenant_id, request_id, asset_id, created_at)
     VALUES ($1, $2, $3, $4, now())`,
    [ids.requestAssetId, tenantId, ids.requestId, ids.assetId],
  );
  await r.query(
    `INSERT INTO portfolio_request_projects (id, tenant_id, request_id, project_id, created_at)
     VALUES ($1, $2, $3, $4, now())`,
    [ids.requestProjectId, tenantId, ids.requestId, ids.projectId],
  );
  await r.query(
    `INSERT INTO portfolio_request_dependencies (
       id, tenant_id, request_id, depends_on_project_id, dependency_type, created_at
     )
     VALUES ($1, $2, $3, $4, 'blocks', now())`,
    [ids.requestDependencyId, tenantId, ids.requestId, ids.dependencyProjectId],
  );
  await r.query(
    `INSERT INTO portfolio_project_dependencies (
       id, tenant_id, project_id, depends_on_project_id, dependency_type, created_at
     )
     VALUES ($1, $2, $3, $4, 'blocks', now())`,
    [ids.projectDependencyId, tenantId, ids.projectId, ids.dependencyProjectId],
  );
  await r.query(
    `INSERT INTO application_suites (id, tenant_id, application_id, suite_id, created_at)
     VALUES ($1, $2, $3, $4, now())`,
    [ids.applicationSuiteId, tenantId, ids.applicationId, ids.suiteApplicationId],
  );
  await r.query(
    `INSERT INTO asset_relations (id, tenant_id, asset_id, related_asset_id, relation_type, notes, created_at)
     VALUES ($1, $2, $3, $4, 'depends_on', $5, now())`,
    [ids.assetRelationId, tenantId, ids.assetId, ids.relatedAssetId, `Asset relation ${tag}`],
  );

  return ids;
}

async function runAiGraphChecks(
  r: QueryRunner,
  results: TestResult[],
  tenantOneId: string,
  tenantTwoId: string,
  seed: AiGraphSeed,
  tag: string,
) {
  await setTenant(r, tenantOneId);
  const selfApplication = await r.query(`SELECT 1 FROM applications WHERE id = $1`, [seed.applicationId]);
  results.push({ name: 'applications: self-tenant read', ok: selfApplication.length === 1 });

  await setTenant(r, tenantTwoId);

  await expectCrossTenantReadBlocked(r, results, 'applications: cross-tenant read blocked', `SELECT 1 FROM applications WHERE id = $1`, [seed.applicationId]);
  await expectCrossTenantReadBlocked(r, results, 'assets: cross-tenant read blocked', `SELECT 1 FROM assets WHERE id = $1`, [seed.assetId]);
  await expectCrossTenantReadBlocked(r, results, 'app_instances: cross-tenant read blocked', `SELECT 1 FROM app_instances WHERE id = $1`, [seed.appInstanceId]);
  await expectCrossTenantReadBlocked(r, results, 'app_asset_assignments: cross-tenant read blocked', `SELECT 1 FROM app_asset_assignments WHERE id = $1`, [seed.appAssetAssignmentId]);
  await expectCrossTenantReadBlocked(r, results, 'application_suites: cross-tenant read blocked', `SELECT 1 FROM application_suites WHERE id = $1`, [seed.applicationSuiteId]);
  await expectCrossTenantReadBlocked(r, results, 'asset_relations: cross-tenant read blocked', `SELECT 1 FROM asset_relations WHERE id = $1`, [seed.assetRelationId]);
  await expectCrossTenantReadBlocked(r, results, 'portfolio_request_projects: cross-tenant read blocked', `SELECT 1 FROM portfolio_request_projects WHERE id = $1`, [seed.requestProjectId]);
  await expectCrossTenantReadBlocked(r, results, 'portfolio_request_dependencies: cross-tenant read blocked', `SELECT 1 FROM portfolio_request_dependencies WHERE id = $1`, [seed.requestDependencyId]);
  await expectCrossTenantReadBlocked(r, results, 'portfolio_project_dependencies: cross-tenant read blocked', `SELECT 1 FROM portfolio_project_dependencies WHERE id = $1`, [seed.projectDependencyId]);
  await expectCrossTenantReadBlocked(r, results, 'application_projects: cross-tenant read blocked', `SELECT 1 FROM application_projects WHERE id = $1`, [seed.applicationProjectId]);
  await expectCrossTenantReadBlocked(r, results, 'asset_projects: cross-tenant read blocked', `SELECT 1 FROM asset_projects WHERE id = $1`, [seed.assetProjectId]);
  await expectCrossTenantReadBlocked(r, results, 'portfolio_request_applications: cross-tenant read blocked', `SELECT 1 FROM portfolio_request_applications WHERE id = $1`, [seed.requestApplicationId]);
  await expectCrossTenantReadBlocked(r, results, 'portfolio_request_assets: cross-tenant read blocked', `SELECT 1 FROM portfolio_request_assets WHERE id = $1`, [seed.requestAssetId]);

  await expectCrossTenantInsertBlocked(
    r,
    results,
    'applications: cross-tenant insert blocked',
    `INSERT INTO applications (
       tenant_id, name, category, description, criticality, data_class,
       hosting_model, users_mode, users_year, environment, lifecycle, status
     )
     VALUES ($1, $2, 'line_of_business', 'cross tenant application', 'high', 'internal', 'saas', 'manual', 10, 'prod', 'active', 'enabled')`,
    [tenantOneId, `Cross App ${tag}`],
  );
  await expectCrossTenantInsertBlocked(
    r,
    results,
    'assets: cross-tenant insert blocked',
    `INSERT INTO assets (
       tenant_id, name, kind, provider, environment, hostname, fqdn, status, notes
     )
     VALUES ($1, $2, 'vm', 'aws', 'prod', $3, $4, 'active', 'cross tenant asset')`,
    [tenantOneId, `Cross Asset ${tag}`, `cross-${tag}`, `cross-${tag}.example.com`],
  );
  await expectCrossTenantInsertBlocked(
    r,
    results,
    'app_instances: cross-tenant insert blocked',
    `INSERT INTO app_instances (
       tenant_id, application_id, environment, lifecycle, sso_enabled, mfa_supported, status, base_url
     )
     VALUES ($1, $2, 'qa', 'active', false, false, 'enabled', $3)`,
    [tenantOneId, seed.applicationId, `https://cross-instance-${tag}.example.com`],
  );
  await expectCrossTenantInsertBlocked(
    r,
    results,
    'app_asset_assignments: cross-tenant insert blocked',
    `INSERT INTO app_asset_assignments (
       tenant_id, app_instance_id, asset_id, role, notes
     )
     VALUES ($1, $2, $3, 'secondary', 'cross tenant assignment')`,
    [tenantOneId, seed.appInstanceId, seed.assetId],
  );
  await expectCrossTenantInsertBlocked(
    r,
    results,
    'application_projects: cross-tenant insert blocked',
    `INSERT INTO application_projects (tenant_id, application_id, project_id, created_at)
     VALUES ($1, $2, $3, now())`,
    [tenantOneId, seed.applicationId, seed.dependencyProjectId],
  );
  await expectCrossTenantInsertBlocked(
    r,
    results,
    'asset_projects: cross-tenant insert blocked',
    `INSERT INTO asset_projects (tenant_id, asset_id, project_id, created_at)
     VALUES ($1, $2, $3, now())`,
    [tenantOneId, seed.assetId, seed.dependencyProjectId],
  );
  await expectCrossTenantInsertBlocked(
    r,
    results,
    'portfolio_request_applications: cross-tenant insert blocked',
    `INSERT INTO portfolio_request_applications (tenant_id, request_id, application_id, created_at)
     VALUES ($1, $2, $3, now())`,
    [tenantOneId, seed.requestId, seed.suiteApplicationId],
  );
  await expectCrossTenantInsertBlocked(
    r,
    results,
    'portfolio_request_assets: cross-tenant insert blocked',
    `INSERT INTO portfolio_request_assets (tenant_id, request_id, asset_id, created_at)
     VALUES ($1, $2, $3, now())`,
    [tenantOneId, seed.requestId, seed.relatedAssetId],
  );
}

async function runAiControlPlaneChecks(
  r: QueryRunner,
  results: TestResult[],
  tenantOneId: string,
  tenantTwoId: string,
  tag: string,
) {
  await setTenant(r, tenantOneId);
  const runId = randomUUID();
  const stepId = randomUUID();
  const actionRequestId = randomUUID();
  const toolExecutionId = randomUUID();
  const evidenceId = randomUUID();
  const approvalId = randomUUID();
  const userId = randomUUID();
  const roleId = randomUUID();
  const apiKeyId = randomUUID();
  const previewId = randomUUID();
  const pauseId = randomUUID();
  const agentDefinitionId = randomUUID();
  const agentTriggerId = randomUUID();
  const agentWorkItemId = randomUUID();
  const agentTargetStateId = randomUUID();
  const agentAuditEventId = randomUUID();
  const adapterConfigId = randomUUID();
  const approvalPolicyId = randomUUID();
  const autonomyCeilingTenantId = randomUUID();
  const autonomyCeilingEnvironmentId = randomUUID();
  const autonomyCeilingCapabilityId = randomUUID();
  const autonomyRoutineId = randomUUID();
  const automationJobCatalogId = randomUUID();
  const liveTestTargetId = randomUUID();
  const externalMcpServerId = randomUUID();
  const externalMcpToolSnapshotId = randomUUID();
  const observationId = randomUUID();
  const recommendationId = randomUUID();
  const decisionId = randomUUID();
  const evaluationId = randomUUID();

  await r.query(
    `INSERT INTO ai_runs (
       id, tenant_id, invocation_channel, trigger_kind, status, input_summary, created_at, updated_at
     )
     VALUES ($1, $2, 'chat', 'human_user', 'running', '{}'::jsonb, now(), now())`,
    [runId, tenantOneId],
  );
  await r.query(
    `INSERT INTO ai_run_steps (
       id, tenant_id, run_id, step_index, kind, status, capability_name, capability_version
     )
     VALUES ($1, $2, $3, 1, 'tool', 'running', 'search_all', '1.0.0')`,
    [stepId, tenantOneId, runId],
  );
  await r.query(
    `INSERT INTO roles (id, tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
     VALUES ($1, $2, $3, 'AI graph test role', false, false, now(), now())`,
    [roleId, tenantOneId, `AI Graph ${tag}`],
  );
  await r.query(
    `INSERT INTO users (id, tenant_id, email, role_id, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'enabled', now(), now())`,
    [userId, tenantOneId, `${tag}@example.invalid`, roleId],
  );
  await r.query(
    `INSERT INTO ai_api_keys (
       id, tenant_id, user_id, key_hash, key_prefix, label, created_by_user_id,
       mcp_scopes_json, mcp_capability_allowlist_json, mcp_capability_denylist_json,
       mcp_max_effect, mcp_rate_limit_per_minute
     )
     VALUES (
       $1, $2, $3, $4, $5, 'RLS MCP key', $3,
       '["mcp:tools:list","mcp:tools:execute"]'::jsonb,
       '["kanap.read.core"]'::jsonb,
       '[]'::jsonb,
       'read',
       60
     )`,
    [apiKeyId, tenantOneId, userId, `hash-${tag}`, tag.slice(0, 12).padEnd(12, '0')],
  );
  await r.query(
    `INSERT INTO ai_mutation_previews (
       id, tenant_id, user_id, tool_name, target_entity_type, mutation_input, status, expires_at
     )
     VALUES ($1, $2, $3, 'import_ticket', 'task', '{}'::jsonb, 'pending', now() + interval '10 minutes')`,
    [previewId, tenantOneId, userId],
  );
  await r.query(
    `INSERT INTO ai_action_requests (
       id, tenant_id, run_id, capability_name, capability_version, effect, status,
       target_type, target_ref, idempotency_key, action_payload_json, provider_kind,
       provider_key, input_hash, metadata_json
     )
     VALUES (
       $1, $2, $3, 'ticketing.ticket.internal_note.add_approved', '1.0.0', 'write', 'pending',
       'ticket', 'mock-ticket-rls', $4, '{"ticketId":"mock-ticket-rls","visibility":"internal","body":"RLS test note","bodyFormat":"plain_text"}'::jsonb,
       'ticketing', 'mock', $5, '{"rls":"test"}'::jsonb
     )`,
    [actionRequestId, tenantOneId, runId, `idempotency-${tag}`, `hash-${tag}`],
  );
  await r.query(
    `INSERT INTO ai_tool_executions (
       id, tenant_id, run_id, step_id, action_request_id, capability_name, capability_version,
       surface, effect, status, input_hash
     )
     VALUES ($1, $2, $3, $4, $5, 'search_all', '1.0.0', 'chat', 'read', 'completed', $6)`,
    [toolExecutionId, tenantOneId, runId, stepId, actionRequestId, `hash-${tag}`],
  );
  await r.query(
    `INSERT INTO ai_evidence (
       id, tenant_id, run_id, tool_execution_id, action_request_id, source_provider, source_object_type,
       trust_level, redaction_status, content_hash, summary, retention_class, collected_at
     )
     VALUES ($1, $2, $3, $4, $5, 'kanap_domain', 'search_all', 'system', 'redacted', $6, 'summary', 'standard', now())`,
    [evidenceId, tenantOneId, runId, toolExecutionId, actionRequestId, `content-${tag}`],
  );
  await r.query(
    `INSERT INTO ai_approvals (
       id, tenant_id, action_request_id, capability_name, capability_version, source, status,
       input_hash, expires_at, decided_at
     )
     VALUES ($1, $2, $3, 'ticketing.ticket.internal_note.add_approved', '1.0.0', 'human_chat', 'approved', $4, now() + interval '10 minutes', now())`,
    [approvalId, tenantOneId, actionRequestId, `hash-${tag}`],
  );
  await r.query(
    `INSERT INTO ai_emergency_pauses (
       id, tenant_id, scope, capability_name, effect, active, reason
     )
     VALUES ($1, $2, 'tenant', 'kanap.mutation_preview.execute_approved', 'write', true, 'rls test')`,
    [pauseId, tenantOneId],
  );
  await r.query(
    `INSERT INTO ai_agent_definitions (
       id, tenant_id, agent_key, name, description, agent_type, status, environment,
       provider_bindings_json, allowed_capabilities_json, forbidden_capabilities_json,
       max_autonomy_level, default_approval_requirement, trigger_policy_json,
       scope_policy_json, queue_policy_json
     )
     VALUES (
       $1, $2, 'helpdesk.ticketing.triage.rls', 'RLS Helpdesk agent',
       'RLS agent definition', 'helpdesk', 'enabled', 'sandbox',
       '{"ticketing":{"provider_kind":"ticketing","provider_key":"mock"}}'::jsonb,
       '[{"name":"ticketing.ticket.get"},{"name":"search_knowledge"},{"name":"get_document"},{"name":"ticketing.ticket.internal_note.prepare"},{"name":"ticketing.ticket.public_reply.prepare"}]'::jsonb,
       '["ticketing.ticket.status.update"]'::jsonb,
       'A3', 'human_for_writes',
       '{"manual_safe_target":{"enabled":true},"scheduled_poll":{"enabled":false}}'::jsonb,
       '{"mode":"manual_safe_target","provider_kind":"ticketing","provider_key":"mock","target_kind":"ticket","all_matching":{"enabled":false}}'::jsonb,
       '{"enabled":true,"lease_ttl_seconds":300,"max_attempts":3,"cooldown_seconds":60}'::jsonb
     )`,
    [agentDefinitionId, tenantOneId],
  );
  await r.query(
    `INSERT INTO ai_agent_triggers (
       id, tenant_id, agent_definition_id, trigger_key, trigger_kind,
       status, enabled, trigger_policy_json, scope_policy_json
     )
     VALUES (
       $1, $2, $3, 'manual.safe_target', 'manual', 'enabled', true,
       '{"safe_target_required":true}'::jsonb,
       '{"mode":"manual_safe_target","provider_kind":"ticketing","provider_key":"mock","target_kind":"ticket","allowed_effect":"read"}'::jsonb
     )`,
    [agentTriggerId, tenantOneId, agentDefinitionId],
  );
  await r.query(
    `INSERT INTO ai_agent_work_items (
       id, tenant_id, agent_definition_id, trigger_id, source_provider_kind,
       source_provider_key, source_object_type, source_object_ref, work_kind,
       status, priority, dedup_key, attempt_count, max_attempts, next_attempt_at,
       last_run_id, last_action_request_ids, metadata_json
     )
     VALUES (
       $1, $2, $3, $4, 'ticketing', 'mock', 'ticket', 'rls-ticket-1',
       'ticket_triage', 'waiting_approval', 100, $5, 1, 3, now(),
       $6, $7::jsonb, '{"rls":"test"}'::jsonb
     )`,
    [agentWorkItemId, tenantOneId, agentDefinitionId, agentTriggerId, `agent-dedup-${tag}`, runId, JSON.stringify([actionRequestId])],
  );
  await r.query(
    `INSERT INTO ai_agent_target_states (
       id, tenant_id, agent_definition_id, provider_kind, provider_key, target_type,
       target_ref, last_run_id, last_public_reply_hash, last_internal_note_hash,
       agent_touched, needs_followup, state_json
     )
     VALUES (
       $1, $2, $3, 'ticketing', 'mock', 'ticket', 'rls-ticket-1',
       $4, 'public-hash', 'internal-hash', true, true, '{"rls":"test"}'::jsonb
    )`,
    [agentTargetStateId, tenantOneId, agentDefinitionId, runId],
  );
  await r.query(
    `INSERT INTO ai_agent_audit_events (
       id, tenant_id, agent_definition_id, work_item_id, event_type, severity,
       message, metadata_json
     )
     VALUES (
       $1, $2, $3, $4, 'rls_test_event', 'info',
       'RLS audit event', '{"rls":"test"}'::jsonb
     )`,
    [agentAuditEventId, tenantOneId, agentDefinitionId, agentWorkItemId],
  );
  await r.query(
    `INSERT INTO ai_adapter_configs (
       id, tenant_id, provider_kind, provider_key, implementation, environment, enabled,
       credential_ref_json, live_test_safety
     )
     VALUES ($1, $2, 'monitoring', 'rls', 'mock', 'mock', true, '{"kind":"none"}'::jsonb, 'mock_only')`,
    [adapterConfigId, tenantOneId],
  );
  await r.query(
    `INSERT INTO ai_approval_policies (
       id, tenant_id, policy_key, policy_version, name, status, enabled,
       capability_name, capability_version, effect, provider_kind, provider_key,
       environment, trigger_surface, trigger_kind, max_autonomy_level, target_type,
       target_constraints_json, evidence_requirements_json, evaluation_requirements_json,
       min_confidence, cooldown_seconds, budget_constraints_json, live_test_safety
     )
     VALUES (
       $1, $2, 'rls-policy', 1, 'RLS policy', 'enabled', true,
       'ticketing.ticket.internal_note.add_approved', '1.0.0', 'write',
       'ticketing', 'mock', 'mock', 'scheduler', 'scheduled_trigger', 'A3', 'ticket',
       '{"allowed_refs":["mock-ticket-rls"]}'::jsonb,
       '{"min_count":1,"trust_levels":["system"],"source_providers":["kanap_domain"]}'::jsonb,
       '{"required_status":"completed"}'::jsonb,
       0.75, 300, '{"max_recent_cost":100}'::jsonb, 'mock_only'
     )`,
    [approvalPolicyId, tenantOneId],
  );
  await r.query(
    `INSERT INTO ai_autonomy_ceilings (
       id, tenant_id, scope, max_autonomy_level, enabled, reason
     )
     VALUES ($1, $2, 'tenant', 'A3', true, 'rls tenant ceiling')`,
    [autonomyCeilingTenantId, tenantOneId],
  );
  await r.query(
    `INSERT INTO ai_autonomy_ceilings (
       id, tenant_id, scope, environment, max_autonomy_level, enabled, reason
     )
     VALUES ($1, $2, 'environment', 'mock', 'A3', true, 'rls environment ceiling')`,
    [autonomyCeilingEnvironmentId, tenantOneId],
  );
  await r.query(
    `INSERT INTO ai_autonomy_ceilings (
       id, tenant_id, scope, capability_name, capability_version, provider_kind,
       provider_key, max_autonomy_level, enabled, reason
     )
     VALUES (
       $1, $2, 'capability', 'ticketing.ticket.internal_note.add_approved',
       '1.0.0', 'ticketing', 'mock', 'A3', true, 'rls capability ceiling'
     )`,
    [autonomyCeilingCapabilityId, tenantOneId],
  );
  await r.query(
    `INSERT INTO ai_autonomy_routines (
       id, tenant_id, routine_key, name, trigger_kind, workflow_type, enabled,
       provider_key, schedule_json, input_json, max_runs_per_window, cooldown_seconds
     )
     VALUES (
       $1, $2, 'rls-scheduled-diagnostic', 'RLS scheduled diagnostic',
       'scheduled', 'readonly_diagnostic', false, 'mock',
       '{"kind":"manual-test"}'::jsonb, '{"alert_id":"mock-alert-001"}'::jsonb, 1, 300
     )`,
    [autonomyRoutineId, tenantOneId],
  );
  await r.query(
    `INSERT INTO ai_automation_job_catalog (
       id, tenant_id, provider_key, job_key, catalog_version, display_name, environment,
       external_job_template_ref, enabled, launch_allowed, dry_run_supported, dry_run_required,
       variable_schema_json, target_policy_json, blast_radius_limit, cooldown_seconds,
       timeout_seconds, redaction_policy_json, live_test_safety
     )
     VALUES (
       $1, $2, 'mock', 'rls-safe-remediation', '1.0.0', 'RLS safe remediation', 'mock',
       'awx-template-rls', true, true, true, true,
       '{"type":"object","properties":{"service":{"type":"string"}},"required":["service"],"additionalProperties":false}'::jsonb,
       '{"allowed_types":["host"],"allowed_values":["rls-host"],"max_targets":1}'::jsonb,
       1, 300, 600, '{"fields":[]}'::jsonb, 'mock_only'
    )`,
    [automationJobCatalogId, tenantOneId],
  );
  await r.query(
    `INSERT INTO ai_live_test_targets (
       id, tenant_id, provider_kind, provider_key, environment, target_kind,
       target_key, external_ref, allowed_effect, safety_label, enabled,
       metadata_json, redaction_policy_json
     )
     VALUES (
       $1, $2, 'ticketing', 'mock-sandbox', 'sandbox', 'ticket',
       'rls-sandbox-ticket', 'TICKET-12345', 'read', 'read_only', false,
       '{"purpose":"rls"}'::jsonb, '{"fields":[]}'::jsonb
     )`,
    [liveTestTargetId, tenantOneId],
  );
  await r.query(
    `INSERT INTO ai_external_mcp_servers (
       id, tenant_id, server_key, display_name, transport_kind, endpoint_config_json,
       credential_ref_json, enabled, max_effect, redaction_policy_json, metadata_json
     )
     VALUES (
       $1, $2, 'rls-mcp', 'RLS MCP server', 'mock', '{"mode":"mock"}'::jsonb,
       '{"kind":"none"}'::jsonb, true, 'read', '{"fields":["api_token"]}'::jsonb,
       '{"rls":"test"}'::jsonb
     )`,
    [externalMcpServerId, tenantOneId],
  );
  await r.query(
    `INSERT INTO ai_external_mcp_tool_snapshots (
       id, tenant_id, server_id, server_key, external_tool_name, capability_name,
       capability_version, tool_description, input_schema_json, input_schema_hash,
       schema_version, effect, enabled, mcp_exposure_enabled, redaction_policy_json, metadata_json
     )
     VALUES (
       $1, $2, $3, 'rls-mcp', 'read_resource',
       'external_mcp.rls-mcp.read_resource', '1.0.0', 'RLS external MCP read',
       '{"type":"object","properties":{"resource_id":{"type":"string"}},"required":["resource_id"],"additionalProperties":false}'::jsonb,
       'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
       '1.0.0', 'read', true, false, '{"fields":["api_token"]}'::jsonb,
       '{"rls":"test"}'::jsonb
     )`,
    [externalMcpToolSnapshotId, tenantOneId, externalMcpServerId],
  );
  await r.query(
    `INSERT INTO ai_observations (
       id, tenant_id, run_id, observation_type, status, source_provider, source_object_type,
       source_object_id, severity, summary, evidence_ids, observed_at
     )
     VALUES ($1, $2, $3, 'monitoring_alert', 'observed', 'monitoring', 'alert',
       'mock-alert-001', 'warning', 'Mock observation', $4::jsonb, now())`,
    [observationId, tenantOneId, runId, JSON.stringify([evidenceId])],
  );
  await r.query(
    `INSERT INTO ai_recommendations (
       id, tenant_id, run_id, observation_id, recommendation_type, status, summary, rationale,
       confidence, proposed_action_class, max_autonomy_level, evidence_ids
     )
     VALUES ($1, $2, $3, $4, 'read_only_diagnostic', 'proposed', 'Mock recommendation',
       'Mock rationale', 0.82, 'operator_review', 'A1', $5::jsonb)`,
    [recommendationId, tenantOneId, runId, observationId, JSON.stringify([evidenceId])],
  );
  await r.query(
    `INSERT INTO ai_decisions (
       id, tenant_id, run_id, recommendation_id, decision, status, reason, evidence_ids, policy_result_json
     )
     VALUES ($1, $2, $3, $4, 'recommend_only', 'recorded', 'Read-only test', $5::jsonb, '{"approval_required":false}'::jsonb)`,
    [decisionId, tenantOneId, runId, recommendationId, JSON.stringify([evidenceId])],
  );
  await r.query(
    `INSERT INTO ai_evaluations (
       id, tenant_id, run_id, recommendation_id, decision_id, status, metadata_json
     )
     VALUES ($1, $2, $3, $4, $5, 'pending', '{"rls":"test"}'::jsonb)`,
    [evaluationId, tenantOneId, runId, recommendationId, decisionId],
  );

  const selfRun = await r.query(`SELECT 1 FROM ai_runs WHERE id = $1`, [runId]);
  results.push({ name: 'ai_runs: self-tenant read', ok: selfRun.length === 1 });
  const selfApiKey = await r.query(`SELECT 1 FROM ai_api_keys WHERE id = $1`, [apiKeyId]);
  results.push({ name: 'ai_api_keys: self-tenant read', ok: selfApiKey.length === 1 });

  await expectCrossTenantInsertBlocked(
    r,
    results,
    'ai_external_mcp_servers: enabled non-mock transport blocked',
    `INSERT INTO ai_external_mcp_servers (
       tenant_id, server_key, display_name, transport_kind, endpoint_config_json,
       credential_ref_json, enabled, max_effect
     )
     VALUES (
       $1, 'enabled-live-mcp', 'Enabled live MCP', 'stdio', '{"command_ref":"not-executed"}'::jsonb,
       '{"kind":"secret_ref","ref":"secret/live-mcp"}'::jsonb, true, 'read'
     )`,
    [tenantOneId],
  );

  await expectCrossTenantInsertBlocked(
    r,
    results,
    'ai_live_test_targets: broad target blocked',
    `INSERT INTO ai_live_test_targets (
       tenant_id, provider_kind, provider_key, environment, target_kind,
       target_key, external_ref, allowed_effect, safety_label, enabled
     )
     VALUES ($1, 'monitoring', '*', 'sandbox', 'alert', 'all', '*', 'read', 'read_only', true)`,
    [tenantOneId],
  );
  await expectCrossTenantInsertBlocked(
    r,
    results,
    'ai_live_test_targets: AWX broad metadata target blocked',
    `INSERT INTO ai_live_test_targets (
       tenant_id, provider_kind, provider_key, environment, target_kind,
       target_key, external_ref, allowed_effect, safety_label, enabled, metadata_json
     )
     VALUES (
       $1, 'automation', 'awx-sandbox', 'sandbox', 'awx_job',
       'dry-run-all', 'awx-template-1', 'dry_run', 'dry_run_only', true,
       '{"target":{"type":"host","values":["all"]}}'::jsonb
     )`,
    [tenantOneId],
  );
  await expectCrossTenantInsertBlocked(
    r,
    results,
    'ai_live_test_targets: AWX wildcard metadata target blocked',
    `INSERT INTO ai_live_test_targets (
       tenant_id, provider_kind, provider_key, environment, target_kind,
       target_key, external_ref, allowed_effect, safety_label, enabled, metadata_json
     )
     VALUES (
       $1, 'automation', 'awx-sandbox', 'sandbox', 'awx_job',
       'dry-run-wildcard', 'awx-template-1', 'dry_run', 'dry_run_only', true,
       '{"target":{"type":"host","values":["host-*"]}}'::jsonb
     )`,
    [tenantOneId],
  );
  await expectCrossTenantInsertBlocked(
    r,
    results,
    'ai_live_test_targets: AWX secret-looking metadata target blocked',
    `INSERT INTO ai_live_test_targets (
       tenant_id, provider_kind, provider_key, environment, target_kind,
       target_key, external_ref, allowed_effect, safety_label, enabled, metadata_json
     )
     VALUES (
       $1, 'automation', 'awx-sandbox', 'sandbox', 'awx_job',
       'dry-run-secret', 'awx-template-1', 'dry_run', 'dry_run_only', true,
       '{"target":{"type":"host","values":["password=plain-secret"]}}'::jsonb
     )`,
    [tenantOneId],
  );

  await expectCrossTenantInsertBlocked(
    r,
    results,
    'ai_action_requests: duplicate provider idempotency blocked',
    `INSERT INTO ai_action_requests (
       tenant_id, run_id, capability_name, capability_version, effect, status,
       target_type, target_ref, idempotency_key, action_payload_json, provider_kind,
       provider_key, input_hash
     )
     VALUES (
       $1, $2, 'ticketing.ticket.internal_note.add_approved', '1.0.0', 'write', 'pending',
       'ticket', 'mock-ticket-rls', $3, '{"ticketId":"mock-ticket-rls","visibility":"internal","body":"RLS duplicate","bodyFormat":"plain_text"}'::jsonb,
       'ticketing', 'mock', $4
     )`,
    [tenantOneId, runId, `idempotency-${tag}`, `duplicate-hash-${tag}`],
  );
  await expectCrossTenantInsertBlocked(
    r,
    results,
    'ai_agent_work_items: active deduplication blocked',
    `INSERT INTO ai_agent_work_items (
       tenant_id, agent_definition_id, source_provider_kind, source_provider_key,
       source_object_type, source_object_ref, work_kind, status, dedup_key
     )
     VALUES ($1, $2, 'ticketing', 'mock', 'ticket', 'rls-ticket-1', 'ticket_triage', 'queued', $3)`,
    [tenantOneId, agentDefinitionId, `agent-dedup-${tag}`],
  );

  await setTenant(r, tenantTwoId);
  const tenantTwoRunId = randomUUID();
  const tenantTwoStepId = randomUUID();
  const tenantTwoActionRequestId = randomUUID();
  await r.query(
    `INSERT INTO ai_runs (
       id, tenant_id, invocation_channel, trigger_kind, status, input_summary, created_at, updated_at
     )
     VALUES ($1, $2, 'internal', 'internal', 'running', '{}'::jsonb, now(), now())`,
    [tenantTwoRunId, tenantTwoId],
  );
  await r.query(
    `INSERT INTO ai_run_steps (
       id, tenant_id, run_id, step_index, kind, status, capability_name, capability_version
     )
     VALUES ($1, $2, $3, 1, 'tool', 'running', 'search_all', '1.0.0')`,
    [tenantTwoStepId, tenantTwoId, tenantTwoRunId],
  );
  await r.query(
    `INSERT INTO ai_action_requests (
       id, tenant_id, run_id, capability_name, capability_version, effect, status,
       target_type, target_ref, idempotency_key, action_payload_json, provider_kind,
       provider_key, input_hash
     )
     VALUES (
       $1, $2, $3, 'ticketing.ticket.internal_note.add_approved', '1.0.0', 'write', 'pending',
       'ticket', 'tenant-two-ticket', $4,
       '{"ticketId":"tenant-two-ticket","visibility":"internal","body":"Tenant two","bodyFormat":"plain_text"}'::jsonb,
       'ticketing', 'mock', $5
     )`,
    [tenantTwoActionRequestId, tenantTwoId, tenantTwoRunId, `tenant-two-action-${tag}`, `tenant-two-hash-${tag}`],
  );
  await expectCrossTenantReadBlocked(r, results, 'ai_runs: cross-tenant read blocked', `SELECT 1 FROM ai_runs WHERE id = $1`, [runId]);
  await expectCrossTenantReadBlocked(r, results, 'ai_api_keys: cross-tenant read blocked', `SELECT 1 FROM ai_api_keys WHERE id = $1`, [apiKeyId]);
  await expectCrossTenantReadBlocked(r, results, 'ai_run_steps: cross-tenant read blocked', `SELECT 1 FROM ai_run_steps WHERE id = $1`, [stepId]);
  await expectCrossTenantReadBlocked(r, results, 'ai_tool_executions: cross-tenant read blocked', `SELECT 1 FROM ai_tool_executions WHERE id = $1`, [toolExecutionId]);
  await expectCrossTenantReadBlocked(r, results, 'ai_evidence: cross-tenant read blocked', `SELECT 1 FROM ai_evidence WHERE id = $1`, [evidenceId]);
  await expectCrossTenantReadBlocked(r, results, 'ai_action_requests: cross-tenant read blocked', `SELECT 1 FROM ai_action_requests WHERE id = $1`, [actionRequestId]);
  await expectCrossTenantReadBlocked(r, results, 'ai_approvals: cross-tenant read blocked', `SELECT 1 FROM ai_approvals WHERE id = $1`, [approvalId]);
  await expectCrossTenantReadBlocked(r, results, 'ai_emergency_pauses: cross-tenant read blocked', `SELECT 1 FROM ai_emergency_pauses WHERE id = $1`, [pauseId]);
  await expectCrossTenantReadBlocked(r, results, 'ai_agent_definitions: cross-tenant read blocked', `SELECT 1 FROM ai_agent_definitions WHERE id = $1`, [agentDefinitionId]);
  await expectCrossTenantReadBlocked(r, results, 'ai_agent_triggers: cross-tenant read blocked', `SELECT 1 FROM ai_agent_triggers WHERE id = $1`, [agentTriggerId]);
  await expectCrossTenantReadBlocked(r, results, 'ai_agent_work_items: cross-tenant read blocked', `SELECT 1 FROM ai_agent_work_items WHERE id = $1`, [agentWorkItemId]);
  await expectCrossTenantReadBlocked(r, results, 'ai_agent_target_states: cross-tenant read blocked', `SELECT 1 FROM ai_agent_target_states WHERE id = $1`, [agentTargetStateId]);
  await expectCrossTenantReadBlocked(r, results, 'ai_agent_audit_events: cross-tenant read blocked', `SELECT 1 FROM ai_agent_audit_events WHERE id = $1`, [agentAuditEventId]);
  await expectCrossTenantReadBlocked(r, results, 'ai_adapter_configs: cross-tenant read blocked', `SELECT 1 FROM ai_adapter_configs WHERE id = $1`, [adapterConfigId]);
  await expectCrossTenantReadBlocked(r, results, 'ai_approval_policies: cross-tenant read blocked', `SELECT 1 FROM ai_approval_policies WHERE id = $1`, [approvalPolicyId]);
  await expectCrossTenantReadBlocked(r, results, 'ai_autonomy_ceilings: cross-tenant read blocked', `SELECT 1 FROM ai_autonomy_ceilings WHERE id = $1`, [autonomyCeilingTenantId]);
  await expectCrossTenantReadBlocked(r, results, 'ai_autonomy_routines: cross-tenant read blocked', `SELECT 1 FROM ai_autonomy_routines WHERE id = $1`, [autonomyRoutineId]);
  await expectCrossTenantReadBlocked(r, results, 'ai_automation_job_catalog: cross-tenant read blocked', `SELECT 1 FROM ai_automation_job_catalog WHERE id = $1`, [automationJobCatalogId]);
  await expectCrossTenantReadBlocked(r, results, 'ai_live_test_targets: cross-tenant read blocked', `SELECT 1 FROM ai_live_test_targets WHERE id = $1`, [liveTestTargetId]);
  await expectCrossTenantReadBlocked(r, results, 'ai_external_mcp_servers: cross-tenant read blocked', `SELECT 1 FROM ai_external_mcp_servers WHERE id = $1`, [externalMcpServerId]);
  await expectCrossTenantReadBlocked(r, results, 'ai_external_mcp_tool_snapshots: cross-tenant read blocked', `SELECT 1 FROM ai_external_mcp_tool_snapshots WHERE id = $1`, [externalMcpToolSnapshotId]);
  await expectCrossTenantReadBlocked(r, results, 'ai_observations: cross-tenant read blocked', `SELECT 1 FROM ai_observations WHERE id = $1`, [observationId]);
  await expectCrossTenantReadBlocked(r, results, 'ai_recommendations: cross-tenant read blocked', `SELECT 1 FROM ai_recommendations WHERE id = $1`, [recommendationId]);
  await expectCrossTenantReadBlocked(r, results, 'ai_decisions: cross-tenant read blocked', `SELECT 1 FROM ai_decisions WHERE id = $1`, [decisionId]);
  await expectCrossTenantReadBlocked(r, results, 'ai_evaluations: cross-tenant read blocked', `SELECT 1 FROM ai_evaluations WHERE id = $1`, [evaluationId]);

  await expectCrossTenantInsertBlocked(
    r,
    results,
    'ai_runs: cross-tenant insert blocked',
    `INSERT INTO ai_runs (tenant_id, invocation_channel, trigger_kind, status)
     VALUES ($1, 'chat', 'human_user', 'running')`,
    [tenantOneId],
  );
  await expectCrossTenantInsertBlocked(
    r,
    results,
    'ai_runs: cross-tenant api key link blocked',
    `INSERT INTO ai_runs (tenant_id, ai_api_key_id, invocation_channel, trigger_kind, status)
     VALUES ($1, $2, 'mcp', 'mcp_client', 'running')`,
    [tenantTwoId, apiKeyId],
  );
  await expectCrossTenantInsertBlocked(
    r,
    results,
    'ai_run_steps: cross-tenant run link blocked',
    `INSERT INTO ai_run_steps (
       tenant_id, run_id, step_index, kind, status, capability_name, capability_version
     )
     VALUES ($1, $2, 99, 'tool', 'running', 'search_all', '1.0.0')`,
    [tenantTwoId, runId],
  );
  await expectCrossTenantInsertBlocked(
    r,
    results,
    'ai_action_requests: cross-tenant run link blocked',
    `INSERT INTO ai_action_requests (
       tenant_id, run_id, capability_name, capability_version, effect, status, input_hash, idempotency_key
     )
     VALUES ($1, $2, 'ticketing.ticket.internal_note.add_approved', '1.0.0', 'write', 'pending', $3, $4)`,
    [tenantTwoId, runId, `cross-action-run-${tag}`, `cross-action-run-${tag}`],
  );
  await expectCrossTenantInsertBlocked(
    r,
    results,
    'ai_action_requests: cross-tenant tool execution link blocked',
    `INSERT INTO ai_action_requests (
       tenant_id, run_id, tool_execution_id, capability_name, capability_version, effect, status, input_hash, idempotency_key
     )
     VALUES ($1, $2, $3, 'ticketing.ticket.internal_note.add_approved', '1.0.0', 'write', 'pending', $4, $5)`,
    [tenantTwoId, tenantTwoRunId, toolExecutionId, `cross-action-tool-${tag}`, `cross-action-tool-${tag}`],
  );
  await expectCrossTenantInsertBlocked(
    r,
    results,
    'ai_action_requests: cross-tenant preview link blocked',
    `INSERT INTO ai_action_requests (
       tenant_id, run_id, preview_id, capability_name, capability_version, effect, status, input_hash, idempotency_key
     )
     VALUES ($1, $2, $3, 'ticketing.ticket.internal_note.add_approved', '1.0.0', 'write', 'pending', $4, $5)`,
    [tenantTwoId, tenantTwoRunId, previewId, `cross-action-preview-${tag}`, `cross-action-preview-${tag}`],
  );
  await expectCrossTenantInsertBlocked(
    r,
    results,
    'ai_tool_executions: cross-tenant run link blocked',
    `INSERT INTO ai_tool_executions (
       tenant_id, run_id, capability_name, capability_version, surface, effect, status
     )
     VALUES ($1, $2, 'search_all', '1.0.0', 'internal', 'read', 'running')`,
    [tenantTwoId, runId],
  );
  await expectCrossTenantInsertBlocked(
    r,
    results,
    'ai_tool_executions: cross-tenant step link blocked',
    `INSERT INTO ai_tool_executions (
       tenant_id, run_id, step_id, capability_name, capability_version, surface, effect, status
     )
     VALUES ($1, $2, $3, 'search_all', '1.0.0', 'internal', 'read', 'running')`,
    [tenantTwoId, tenantTwoRunId, stepId],
  );
  await expectCrossTenantInsertBlocked(
    r,
    results,
    'ai_tool_executions: cross-tenant action request link blocked',
    `INSERT INTO ai_tool_executions (
       tenant_id, run_id, step_id, action_request_id, capability_name, capability_version, surface, effect, status
     )
     VALUES ($1, $2, $3, $4, 'search_all', '1.0.0', 'internal', 'read', 'running')`,
    [tenantTwoId, tenantTwoRunId, tenantTwoStepId, actionRequestId],
  );
  await expectCrossTenantInsertBlocked(
    r,
    results,
    'ai_tool_executions: cross-tenant approval link blocked',
    `INSERT INTO ai_tool_executions (
       tenant_id, run_id, step_id, approval_id, capability_name, capability_version, surface, effect, status
     )
     VALUES ($1, $2, $3, $4, 'search_all', '1.0.0', 'internal', 'read', 'running')`,
    [tenantTwoId, tenantTwoRunId, tenantTwoStepId, approvalId],
  );
  await expectCrossTenantInsertBlocked(
    r,
    results,
    'ai_evidence: cross-tenant run link blocked',
    `INSERT INTO ai_evidence (
       tenant_id, run_id, source_provider, source_object_type, trust_level, redaction_status,
       content_hash, summary, retention_class, collected_at
     )
     VALUES ($1, $2, 'kanap_domain', 'search_all', 'system', 'redacted', $3, 'cross', 'standard', now())`,
    [tenantTwoId, runId, `cross-evidence-run-${tag}`],
  );
  await expectCrossTenantInsertBlocked(
    r,
    results,
    'ai_evidence: cross-tenant tool execution link blocked',
    `INSERT INTO ai_evidence (
       tenant_id, run_id, tool_execution_id, source_provider, source_object_type, trust_level,
       redaction_status, content_hash, summary, retention_class, collected_at
     )
     VALUES ($1, $2, $3, 'kanap_domain', 'search_all', 'system', 'redacted', $4, 'cross', 'standard', now())`,
    [tenantTwoId, tenantTwoRunId, toolExecutionId, `cross-evidence-tool-${tag}`],
  );
  await expectCrossTenantInsertBlocked(
    r,
    results,
    'ai_evidence: cross-tenant action request link blocked',
    `INSERT INTO ai_evidence (
       tenant_id, run_id, action_request_id, source_provider, source_object_type, trust_level,
       redaction_status, content_hash, summary, retention_class, collected_at
     )
     VALUES ($1, $2, $3, 'kanap_domain', 'search_all', 'system', 'redacted', $4, 'cross', 'standard', now())`,
    [tenantTwoId, tenantTwoRunId, actionRequestId, `cross-evidence-action-${tag}`],
  );
  await expectCrossTenantInsertBlocked(
    r,
    results,
    'ai_approvals: cross-tenant action request link blocked',
    `INSERT INTO ai_approvals (
       tenant_id, action_request_id, capability_name, capability_version, source, status, input_hash, expires_at
     )
     VALUES ($1, $2, 'ticketing.ticket.internal_note.add_approved', '1.0.0', 'human_ui', 'approved', $3, now() + interval '10 minutes')`,
    [tenantTwoId, actionRequestId, `cross-approval-action-${tag}`],
  );
  await expectCrossTenantInsertBlocked(
    r,
    results,
    'ai_approvals: cross-tenant approval blocked',
    `INSERT INTO ai_approvals (
       tenant_id, action_request_id, capability_name, capability_version, source, status, input_hash, expires_at
     )
     VALUES ($1, $2, 'kanap.mutation_preview.execute_approved', '1.0.0', 'human_chat', 'approved', $3, now() + interval '10 minutes')`,
    [tenantOneId, actionRequestId, `hash-${tag}`],
  );
  await expectCrossTenantInsertBlocked(
    r,
    results,
    'ai_approvals: cross-tenant matched policy link blocked',
    `INSERT INTO ai_approvals (
       tenant_id, action_request_id, capability_name, capability_version, source, status,
       input_hash, matched_policy_id, matched_policy_version, decision_json, expires_at
     )
     VALUES (
       $1, $2, 'ticketing.ticket.internal_note.add_approved', '1.0.0', 'policy',
       'approved', $3, $4, 1, '{"outcome":"policy_approved"}'::jsonb,
       now() + interval '10 minutes'
     )`,
    [tenantTwoId, tenantTwoActionRequestId, `tenant-two-hash-${tag}`, approvalPolicyId],
  );
  await expectCrossTenantInsertBlocked(
    r,
    results,
    'ai_agent_definitions: cross-tenant insert blocked',
    `INSERT INTO ai_agent_definitions (
       tenant_id, agent_key, name, agent_type, status, environment,
       max_autonomy_level, default_approval_requirement
     )
     VALUES ($1, 'cross.agent', 'Cross agent', 'helpdesk', 'enabled', 'sandbox', 'A3', 'human_for_writes')`,
    [tenantOneId],
  );
  await expectCrossTenantInsertBlocked(
    r,
    results,
    'ai_agent_triggers: cross-tenant definition link blocked',
    `INSERT INTO ai_agent_triggers (
       tenant_id, agent_definition_id, trigger_key, trigger_kind, status, enabled
     )
     VALUES ($1, $2, 'cross-trigger', 'manual', 'enabled', true)`,
    [tenantTwoId, agentDefinitionId],
  );
  await expectCrossTenantInsertBlocked(
    r,
    results,
    'ai_agent_work_items: cross-tenant definition link blocked',
    `INSERT INTO ai_agent_work_items (
       tenant_id, agent_definition_id, source_provider_kind, source_provider_key,
       source_object_type, source_object_ref, work_kind, status, dedup_key
     )
     VALUES ($1, $2, 'ticketing', 'mock', 'ticket', 'cross-ticket', 'ticket_triage', 'queued', 'cross-work-definition')`,
    [tenantTwoId, agentDefinitionId],
  );
  await expectCrossTenantInsertBlocked(
    r,
    results,
    'ai_agent_work_items: cross-tenant trigger link blocked',
    `INSERT INTO ai_agent_work_items (
       tenant_id, agent_definition_id, trigger_id, source_provider_kind, source_provider_key,
       source_object_type, source_object_ref, work_kind, status, dedup_key
     )
     VALUES ($1, $2, $3, 'ticketing', 'mock', 'ticket', 'cross-ticket', 'ticket_triage', 'queued', 'cross-work-trigger')`,
    [tenantTwoId, agentDefinitionId, agentTriggerId],
  );
  await expectCrossTenantInsertBlocked(
    r,
    results,
    'ai_agent_work_items: cross-tenant run link blocked',
    `INSERT INTO ai_agent_work_items (
       tenant_id, agent_definition_id, source_provider_kind, source_provider_key,
       source_object_type, source_object_ref, work_kind, status, dedup_key, last_run_id
     )
     VALUES ($1, $2, 'ticketing', 'mock', 'ticket', 'cross-ticket', 'ticket_triage', 'queued', 'cross-work-run', $3)`,
    [tenantTwoId, agentDefinitionId, runId],
  );
  await expectCrossTenantInsertBlocked(
    r,
    results,
    'ai_agent_target_states: cross-tenant definition link blocked',
    `INSERT INTO ai_agent_target_states (
       tenant_id, agent_definition_id, provider_kind, provider_key, target_type, target_ref
     )
     VALUES ($1, $2, 'ticketing', 'mock', 'ticket', 'cross-ticket')`,
    [tenantTwoId, agentDefinitionId],
  );
  await expectCrossTenantInsertBlocked(
    r,
    results,
    'ai_agent_target_states: cross-tenant run link blocked',
    `INSERT INTO ai_agent_target_states (
       tenant_id, agent_definition_id, provider_kind, provider_key, target_type, target_ref, last_run_id
     )
     VALUES ($1, $2, 'ticketing', 'mock', 'ticket', 'cross-ticket-run', $3)`,
    [tenantTwoId, agentDefinitionId, runId],
  );
  await expectCrossTenantInsertBlocked(
    r,
    results,
    'ai_agent_audit_events: cross-tenant definition link blocked',
    `INSERT INTO ai_agent_audit_events (
       tenant_id, agent_definition_id, event_type, severity, message
     )
     VALUES ($1, $2, 'cross-definition', 'warning', 'cross tenant definition link')`,
    [tenantTwoId, agentDefinitionId],
  );
  await expectCrossTenantInsertBlocked(
    r,
    results,
    'ai_agent_audit_events: cross-tenant work item link blocked',
    `INSERT INTO ai_agent_audit_events (
       tenant_id, agent_definition_id, work_item_id, event_type, severity, message
     )
     VALUES ($1, $2, $3, 'cross-work-item', 'warning', 'cross tenant work item link')`,
    [tenantTwoId, agentDefinitionId, agentWorkItemId],
  );

  const tenantTwoDefinitionId = randomUUID();
  const tenantTwoTriggerId = randomUUID();
  const tenantTwoWorkItemId = randomUUID();
  const tenantTwoAuditEventId = randomUUID();
  await insertMinimalAgentDefinition(r, tenantTwoDefinitionId, tenantTwoId, `t2.delete.guard.${tag}`);
  await r.query(
    `INSERT INTO ai_agent_triggers (
       id, tenant_id, agent_definition_id, trigger_key, trigger_kind, status, enabled
     )
     VALUES ($1, $2, $3, 'manual.safe_target', 'manual', 'enabled', true)`,
    [tenantTwoTriggerId, tenantTwoId, tenantTwoDefinitionId],
  );
  await insertMinimalWorkItem(r, {
    id: tenantTwoWorkItemId,
    tenantId: tenantTwoId,
    definitionId: tenantTwoDefinitionId,
    triggerId: tenantTwoTriggerId,
    dedupKey: `t2-delete-guard-${tag}`,
  });
  await r.query(
    `INSERT INTO ai_agent_audit_events (
       id, tenant_id, agent_definition_id, work_item_id, event_type, severity, message
     )
     VALUES ($1, $2, $3, $4, 'delete_guard', 'info', 'tenant two audit')`,
    [tenantTwoAuditEventId, tenantTwoId, tenantTwoDefinitionId, tenantTwoWorkItemId],
  );

  await expectCrossTenantInsertBlocked(
    r,
    results,
    'ai_agent_audit_events: cross-tenant work item assignment update blocked',
    `UPDATE ai_agent_audit_events SET work_item_id = $1 WHERE id = $2`,
    [agentWorkItemId, tenantTwoAuditEventId],
  );
  await expectCrossTenantInsertBlocked(
    r,
    results,
    'ai_agent_audit_events: cross-tenant definition assignment update blocked',
    `UPDATE ai_agent_audit_events SET agent_definition_id = $1 WHERE id = $2`,
    [agentDefinitionId, tenantTwoAuditEventId],
  );
  await expectCrossTenantInsertBlocked(
    r,
    results,
    'ai_agent_work_items: cross-tenant trigger assignment update blocked',
    `UPDATE ai_agent_work_items SET trigger_id = $1 WHERE id = $2`,
    [agentTriggerId, tenantTwoWorkItemId],
  );
  await expectCrossTenantInsertBlocked(
    r,
    results,
    'ai_agent_work_items: cross-tenant definition assignment update blocked',
    `UPDATE ai_agent_work_items SET agent_definition_id = $1 WHERE id = $2`,
    [agentDefinitionId, tenantTwoWorkItemId],
  );
  await expectCrossTenantInsertBlocked(
    r,
    results,
    'ai_agent_work_items: cross-tenant run assignment update blocked',
    `UPDATE ai_agent_work_items SET last_run_id = $1 WHERE id = $2`,
    [runId, tenantTwoWorkItemId],
  );

  await withSavepoint(r, results, 'ai_agent_definitions: same-tenant used-agent delete succeeds', async () => {
    await setTenant(r, tenantOneId);
    const definitionId = randomUUID();
    const workItemId = randomUUID();
    const auditEventId = randomUUID();
    await insertMinimalAgentDefinition(r, definitionId, tenantOneId, `t1.used.delete.${tag}`);
    await insertMinimalWorkItem(r, {
      id: workItemId,
      tenantId: tenantOneId,
      definitionId,
      dedupKey: `t1-used-delete-${tag}`,
    });
    await r.query(
      `INSERT INTO ai_agent_audit_events (
         id, tenant_id, agent_definition_id, work_item_id, event_type, severity, message
       )
       VALUES ($1, $2, $3, $4, 'work_item_processing_failed', 'error', 'used agent delete guard')`,
      [auditEventId, tenantOneId, definitionId, workItemId],
    );
    await r.query(`DELETE FROM ai_agent_definitions WHERE id = $1`, [definitionId]);
    const leftover = await r.query(
      `SELECT agent_definition_id, work_item_id FROM ai_agent_audit_events WHERE id = $1`,
      [auditEventId],
    );
    if (leftover.length !== 1) {
      throw new Error(`expected 1 audit row, got ${leftover.length}`);
    }
    if (leftover[0].agent_definition_id != null) {
      throw new Error('audit agent_definition_id should be SET NULL after agent delete');
    }
  });
  await setTenant(r, tenantTwoId);

  await withSavepoint(r, results, 'ai_agent_definitions: same-tenant delete with trigger_id set succeeds', async () => {
    await setTenant(r, tenantOneId);
    const definitionId = randomUUID();
    const triggerId = randomUUID();
    const workItemId = randomUUID();
    await insertMinimalAgentDefinition(r, definitionId, tenantOneId, `t1.trigger.delete.${tag}`);
    await r.query(
      `INSERT INTO ai_agent_triggers (
         id, tenant_id, agent_definition_id, trigger_key, trigger_kind, status, enabled
       )
       VALUES ($1, $2, $3, 'manual.safe_target', 'manual', 'enabled', true)`,
      [triggerId, tenantOneId, definitionId],
    );
    await insertMinimalWorkItem(r, {
      id: workItemId,
      tenantId: tenantOneId,
      definitionId,
      triggerId,
      dedupKey: `t1-trigger-delete-${tag}`,
    });
    await r.query(`DELETE FROM ai_agent_definitions WHERE id = $1`, [definitionId]);
    const leftover = await r.query(`SELECT 1 FROM ai_agent_definitions WHERE id = $1`, [definitionId]);
    if (leftover.length !== 0) {
      throw new Error('definition should be deleted');
    }
  });
  await setTenant(r, tenantTwoId);

  await expectCrossTenantInsertBlocked(
    r,
    results,
    'ai_adapter_configs: cross-tenant insert blocked',
    `INSERT INTO ai_adapter_configs (
       tenant_id, provider_kind, provider_key, implementation, environment, enabled, live_test_safety
     )
     VALUES ($1, 'monitoring', 'cross', 'mock', 'mock', true, 'mock_only')`,
    [tenantOneId],
  );
  await expectCrossTenantInsertBlocked(
    r,
    results,
    'ai_approval_policies: cross-tenant insert blocked',
    `INSERT INTO ai_approval_policies (
       tenant_id, policy_key, policy_version, name, status, enabled,
       capability_name, capability_version, effect, provider_kind, provider_key,
       environment, trigger_surface, trigger_kind, max_autonomy_level, target_type,
       target_constraints_json, evidence_requirements_json, live_test_safety
     )
     VALUES (
       $1, 'cross-policy', 1, 'Cross policy', 'enabled', true,
       'ticketing.ticket.internal_note.add_approved', '1.0.0', 'write',
       'ticketing', 'mock', 'mock', 'scheduler', 'scheduled_trigger', 'A3', 'ticket',
       '{"allowed_refs":["cross-ticket"]}'::jsonb,
       '{"min_count":1}'::jsonb, 'mock_only'
     )`,
    [tenantOneId],
  );
  await expectCrossTenantInsertBlocked(
    r,
    results,
    'ai_autonomy_ceilings: cross-tenant insert blocked',
    `INSERT INTO ai_autonomy_ceilings (
       tenant_id, scope, max_autonomy_level, enabled
     )
     VALUES ($1, 'tenant', 'A3', true)`,
    [tenantOneId],
  );
  await expectCrossTenantInsertBlocked(
    r,
    results,
    'ai_autonomy_routines: cross-tenant insert blocked',
    `INSERT INTO ai_autonomy_routines (
       tenant_id, routine_key, name, trigger_kind, workflow_type, enabled,
       provider_key, max_runs_per_window, cooldown_seconds
     )
     VALUES (
       $1, 'cross-routine', 'Cross routine', 'scheduled', 'readonly_diagnostic',
       false, 'mock', 1, 300
     )`,
    [tenantOneId],
  );
  await expectCrossTenantInsertBlocked(
    r,
    results,
    'ai_automation_job_catalog: cross-tenant insert blocked',
    `INSERT INTO ai_automation_job_catalog (
       tenant_id, provider_key, job_key, catalog_version, display_name, environment,
       external_job_template_ref, enabled, launch_allowed, dry_run_supported, dry_run_required,
       variable_schema_json, target_policy_json, blast_radius_limit, cooldown_seconds,
       timeout_seconds, live_test_safety
     )
     VALUES (
       $1, 'mock', 'cross', '1.0.0', 'Cross tenant job', 'mock', 'awx-cross',
       true, true, true, true,
       '{"type":"object","additionalProperties":false}'::jsonb,
       '{"allowed_types":["host"],"allowed_values":["cross-host"],"max_targets":1}'::jsonb,
       1, 300, 600, 'mock_only'
    )`,
    [tenantOneId],
  );
  await expectCrossTenantInsertBlocked(
    r,
    results,
    'ai_live_test_targets: cross-tenant insert blocked',
    `INSERT INTO ai_live_test_targets (
       tenant_id, provider_kind, provider_key, environment, target_kind,
       target_key, external_ref, allowed_effect, safety_label, enabled
     )
     VALUES (
       $1, 'ticketing', 'mock-cross', 'sandbox', 'ticket',
       'cross-ticket', 'TICKET-CROSS', 'read', 'read_only', false
     )`,
    [tenantOneId],
  );
  await expectCrossTenantInsertBlocked(
    r,
    results,
    'ai_external_mcp_servers: cross-tenant insert blocked',
    `INSERT INTO ai_external_mcp_servers (
       tenant_id, server_key, display_name, transport_kind, endpoint_config_json,
       credential_ref_json, enabled, max_effect, redaction_policy_json
     )
     VALUES (
       $1, 'cross-mcp', 'Cross MCP', 'mock', '{"mode":"mock"}'::jsonb,
       '{"kind":"none"}'::jsonb, false, 'read', '{"fields":[]}'::jsonb
     )`,
    [tenantOneId],
  );
  await expectCrossTenantInsertBlocked(
    r,
    results,
    'ai_external_mcp_tool_snapshots: cross-tenant server link blocked',
    `INSERT INTO ai_external_mcp_tool_snapshots (
       tenant_id, server_id, server_key, external_tool_name, capability_name,
       capability_version, input_schema_json, input_schema_hash, schema_version,
       effect, enabled, mcp_exposure_enabled
     )
     VALUES (
       $1, $2, 'rls-mcp', 'read_resource', 'external_mcp.rls-mcp.cross',
       '1.0.0', '{"type":"object"}'::jsonb,
       'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
       '1.0.0', 'read', true, false
     )`,
    [tenantTwoId, externalMcpServerId],
  );
  await expectCrossTenantInsertBlocked(
    r,
    results,
    'ai_observations: cross-tenant insert blocked',
    `INSERT INTO ai_observations (
       tenant_id, run_id, observation_type, status, source_provider, source_object_type, summary
     )
     VALUES ($1, $2, 'monitoring_alert', 'observed', 'monitoring', 'alert', 'cross')`,
    [tenantOneId, runId],
  );
  await expectCrossTenantInsertBlocked(
    r,
    results,
    'ai_recommendations: cross-tenant insert blocked',
    `INSERT INTO ai_recommendations (
       tenant_id, run_id, recommendation_type, status, summary, max_autonomy_level
     )
     VALUES ($1, $2, 'read_only_diagnostic', 'proposed', 'cross', 'A1')`,
    [tenantOneId, runId],
  );
  await expectCrossTenantInsertBlocked(
    r,
    results,
    'ai_decisions: cross-tenant insert blocked',
    `INSERT INTO ai_decisions (
       tenant_id, run_id, decision, status, reason
     )
     VALUES ($1, $2, 'recommend_only', 'recorded', 'cross')`,
    [tenantOneId, runId],
  );
  await expectCrossTenantInsertBlocked(
    r,
    results,
    'ai_evaluations: cross-tenant insert blocked',
    `INSERT INTO ai_evaluations (
       tenant_id, run_id, status
     )
     VALUES ($1, $2, 'pending')`,
    [tenantOneId, runId],
  );

  await expectCrossTenantInsertBlocked(
    r,
    results,
    'ai_observations: cross-tenant run link blocked',
    `INSERT INTO ai_observations (
       tenant_id, run_id, observation_type, status, source_provider, source_object_type, summary
     )
     VALUES ($1, $2, 'monitoring_alert', 'observed', 'monitoring', 'alert', 'cross run link')`,
    [tenantTwoId, runId],
  );
  await expectCrossTenantInsertBlocked(
    r,
    results,
    'ai_recommendations: cross-tenant observation link blocked',
    `INSERT INTO ai_recommendations (
       tenant_id, run_id, observation_id, recommendation_type, status, summary, max_autonomy_level
     )
     VALUES ($1, $2, $3, 'read_only_diagnostic', 'proposed', 'cross observation link', 'A1')`,
    [tenantTwoId, tenantTwoRunId, observationId],
  );
  await expectCrossTenantInsertBlocked(
    r,
    results,
    'ai_decisions: cross-tenant recommendation link blocked',
    `INSERT INTO ai_decisions (
       tenant_id, run_id, recommendation_id, decision, status, reason
     )
     VALUES ($1, $2, $3, 'recommend_only', 'recorded', 'cross recommendation link')`,
    [tenantTwoId, tenantTwoRunId, recommendationId],
  );
  await expectCrossTenantInsertBlocked(
    r,
    results,
    'ai_evaluations: cross-tenant decision link blocked',
    `INSERT INTO ai_evaluations (
       tenant_id, run_id, recommendation_id, decision_id, status
     )
     VALUES ($1, $2, NULL, $3, 'pending')`,
    [tenantTwoId, tenantTwoRunId, decisionId],
  );
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL not set');
    process.exit(2);
  }

  const ds = new DataSource({ type: 'postgres', url, ssl: false } as any);
  await ds.initialize();
  const roleState = await assertSafeDatabaseRole(ds, 'RLS self-test');
  console.log(`[RLS Self-Test] Connected as PostgreSQL role "${roleState.currentUser}" with native RLS enforcement`);

  const r = ds.createQueryRunner();
  await r.connect();
  await r.startTransaction();

  const results: TestResult[] = [];

  try {
    const tag = `rls_${Date.now()}_${randTag()}`;
    const tenantOneId = randomUUID();
    const tenantTwoId = randomUUID();

    await seedTenant(r, tenantOneId, `${tag}_a`, `${tag} A`);
    await seedTenant(r, tenantTwoId, `${tag}_b`, `${tag} B`);

    for (const table of TABLES_TO_CHECK_RLS) {
      const state = await getRlsState(r, table);
      results.push({ name: `RLS enabled: ${table}`, ok: state.enabled });
      if (TABLES_TO_CHECK_FORCE.has(table)) {
        results.push({ name: `RLS forced: ${table}`, ok: state.forced });
      }
      if (TABLES_TO_CHECK_POLICY.has(table)) {
        results.push({
          name: `Tenant policy present: ${table}`,
          ok: await hasTenantIsolationPolicy(r, table),
        });
      }
    }

    await setTenant(r, tenantOneId);
    const companyRows = await r.query(
      `INSERT INTO companies(name, country_iso, city, status) VALUES ($1, $2, $3, 'enabled') RETURNING id`,
      [`TestCo ${tag}`, 'US', 'New York'],
    );
    const companyId = companyRows[0].id as string;
    const companySelf = await r.query(`SELECT 1 FROM companies WHERE id = $1`, [companyId]);
    results.push({ name: 'companies: self-tenant read', ok: companySelf.length === 1 });

    await setTenant(r, tenantTwoId);
    await expectCrossTenantReadBlocked(r, results, 'companies: cross-tenant read blocked', `SELECT 1 FROM companies WHERE id = $1`, [companyId]);
    await expectCrossTenantInsertBlocked(
      r,
      results,
      'companies: cross-tenant insert blocked',
      `INSERT INTO companies(tenant_id, name, country_iso, city, status) VALUES ($1, $2, $3, $4, 'enabled')`,
      [tenantOneId, `X ${tag}`, 'US', 'Boston'],
    );

    // portfolio_criterion_values: tenant_id re-added by migration 1853560000000.
    // The trigger must fill tenant_id from the parent criterion, and a criterion
    // from another tenant must be rejected even though FK checks bypass RLS.
    await setTenant(r, tenantOneId);
    const criterionRows = await r.query(
      `INSERT INTO portfolio_criteria(tenant_id, name, weight, display_order) VALUES ($1, $2, 1, 0) RETURNING id`,
      [tenantOneId, `CRIT ${tag}`],
    );
    const criterionId = criterionRows[0].id as string;
    const criterionValueRows = await r.query(
      `INSERT INTO portfolio_criterion_values(criterion_id, label, position) VALUES ($1, 'Low', 0) RETURNING id, tenant_id`,
      [criterionId],
    );
    const criterionValueId = criterionValueRows[0].id as string;
    results.push({
      name: 'portfolio_criterion_values: trigger fills tenant_id from the criterion',
      ok: criterionValueRows[0].tenant_id === tenantOneId,
      info: criterionValueRows[0].tenant_id !== tenantOneId ? `got ${criterionValueRows[0].tenant_id}` : undefined,
    });
    const criterionValueSelf = await r.query(`SELECT 1 FROM portfolio_criterion_values WHERE id = $1`, [criterionValueId]);
    results.push({ name: 'portfolio_criterion_values: self-tenant read', ok: criterionValueSelf.length === 1 });
    await expectCrossTenantInsertBlocked(
      r,
      results,
      'portfolio_criterion_values: mismatched tenant_id rejected by trigger',
      `INSERT INTO portfolio_criterion_values(tenant_id, criterion_id, label, position) VALUES ($1, $2, 'Wrong', 9)`,
      [tenantTwoId, criterionId],
    );

    await setTenant(r, tenantTwoId);
    await expectCrossTenantReadBlocked(r, results, 'portfolio_criterion_values: cross-tenant read by id blocked', `SELECT 1 FROM portfolio_criterion_values WHERE id = $1`, [criterionValueId]);
    await expectCrossTenantReadBlocked(r, results, 'portfolio_criterion_values: cross-tenant read by criterion blocked', `SELECT 1 FROM portfolio_criterion_values WHERE criterion_id = $1`, [criterionId]);
    await expectCrossTenantInsertBlocked(
      r,
      results,
      'portfolio_criterion_values: cross-tenant insert with foreign tenant_id blocked',
      `INSERT INTO portfolio_criterion_values(tenant_id, criterion_id, label, position) VALUES ($1, $2, 'X', 1)`,
      [tenantOneId, criterionId],
    );
    await expectCrossTenantInsertBlocked(
      r,
      results,
      'portfolio_criterion_values: own tenant_id on a foreign criterion blocked',
      `INSERT INTO portfolio_criterion_values(tenant_id, criterion_id, label, position) VALUES ($1, $2, 'X', 2)`,
      [tenantTwoId, criterionId],
    );
    await expectCrossTenantInsertBlocked(
      r,
      results,
      'portfolio_criterion_values: omitted tenant_id on a foreign criterion blocked',
      `INSERT INTO portfolio_criterion_values(criterion_id, label, position) VALUES ($1, 'X', 3)`,
      [criterionId],
    );

    await setTenant(r, tenantOneId);
    const spendRows = await r.query(
      `INSERT INTO spend_items(product_name, currency, effective_start, status, item_number) VALUES ($1, 'EUR', '2025-01-01', 'enabled', (SELECT COALESCE(MAX(item_number), 0) + 1 FROM spend_items)) RETURNING id`,
      [`S ${tag}`],
    );
    const spendId = spendRows[0].id as string;
    await setTenant(r, tenantTwoId);
    await expectCrossTenantReadBlocked(r, results, 'spend_items: cross-tenant read blocked', `SELECT 1 FROM spend_items WHERE id = $1`, [spendId]);

    await setTenant(r, tenantOneId);
    const supplierRows = await r.query(
      `INSERT INTO suppliers(name, status) VALUES ($1, 'enabled') RETURNING id`,
      [`SUP ${tag}`],
    );
    const contractCompanyRows = await r.query(
      `INSERT INTO companies(name, country_iso, city, status) VALUES ($1, $2, $3, 'enabled') RETURNING id`,
      [`CO2 ${tag}`, 'US', 'Chicago'],
    );
    const contractRows = await r.query(
      `INSERT INTO contracts(name, company_id, supplier_id, start_date) VALUES ($1, $2, $3, '2025-01-01') RETURNING id`,
      [`CON ${tag}`, contractCompanyRows[0].id, supplierRows[0].id],
    );
    const contractId = contractRows[0].id as string;
    await setTenant(r, tenantTwoId);
    await expectCrossTenantReadBlocked(r, results, 'contracts: cross-tenant read blocked', `SELECT 1 FROM contracts WHERE id = $1`, [contractId]);

    await setTenant(r, tenantOneId);
    const roleRows = await r.query(
      `INSERT INTO roles(role_name, role_description) VALUES ($1, $2) RETURNING id`,
      [`RLS_${tag}`, 'Test role'],
    );
    const roleId = roleRows[0].id as string;
    await setTenant(r, tenantTwoId);
    await expectCrossTenantReadBlocked(r, results, 'roles: cross-tenant read blocked', `SELECT 1 FROM roles WHERE id = $1`, [roleId]);

    await setTenant(r, tenantOneId);
    const capexRows = await r.query(
      `INSERT INTO capex_items(description, ppe_type, investment_type, priority, currency, effective_start, status, item_number)
       VALUES ($1, 'hardware', 'replacement', 'medium', 'EUR', '2025-01-01', 'enabled', (SELECT COALESCE(MAX(item_number), 0) + 1 FROM capex_items))
       RETURNING id`,
      [`CAPEX ${tag}`],
    );
    const capexId = capexRows[0].id as string;
    await setTenant(r, tenantTwoId);
    await expectCrossTenantReadBlocked(r, results, 'capex_items: cross-tenant read blocked', `SELECT 1 FROM capex_items WHERE id = $1`, [capexId]);

    await setTenant(r, tenantOneId);
    const libraryRows = await r.query(
      `INSERT INTO document_libraries(name, slug, is_system, display_order)
       VALUES ($1, $2, false, 0)
       RETURNING id`,
      [`Knowledge ${tag}`, `knowledge-${tag}`],
    );
    const libraryId = libraryRows[0].id as string;
    const documentRows = await r.query(
      `INSERT INTO documents(item_number, title, content_markdown, content_plain, library_id)
       VALUES (999001, $1, 'Body', 'Body', $2)
       RETURNING id`,
      [`DOC ${tag}`, libraryId],
    );
    const documentId = documentRows[0].id as string;
    await r.query(
      `INSERT INTO item_sequences(tenant_id, entity_type, next_val)
       VALUES ($1, 'document', 42)
       ON CONFLICT (tenant_id, entity_type)
       DO UPDATE SET next_val = EXCLUDED.next_val`,
      [tenantOneId],
    );

    await setTenant(r, tenantTwoId);
    await expectCrossTenantReadBlocked(r, results, 'document_libraries: cross-tenant read blocked', `SELECT 1 FROM document_libraries WHERE id = $1`, [libraryId]);
    await expectCrossTenantReadBlocked(r, results, 'documents: cross-tenant read blocked', `SELECT 1 FROM documents WHERE id = $1`, [documentId]);
    await expectCrossTenantReadBlocked(
      r,
      results,
      'item_sequences(document): cross-tenant read blocked',
      `SELECT 1 FROM item_sequences WHERE tenant_id = $1 AND entity_type = 'document'`,
      [tenantOneId],
    );
    await expectCrossTenantInsertBlocked(
      r,
      results,
      'document_libraries: cross-tenant insert blocked',
      `INSERT INTO document_libraries(tenant_id, name, slug, is_system, display_order)
       VALUES ($1, $2, $3, false, 1)`,
      [tenantOneId, `Cross ${tag}`, `cross-${tag}`],
    );

    const aiGraphSeed = await seedAiGraph(r, tenantOneId, tag);
    await runAiGraphChecks(r, results, tenantOneId, tenantTwoId, aiGraphSeed, tag);
    await runAiControlPlaneChecks(r, results, tenantOneId, tenantTwoId, tag);

    const failed = results.filter((result) => !result.ok);
    for (const result of results) {
      console.log(`${result.ok ? 'PASS' : 'FAIL'} - ${result.name}${result.info ? ` (${result.info})` : ''}`);
    }

    if (failed.length > 0) {
      throw new Error(`${failed.length} RLS checks failed.`);
    }

    await r.rollbackTransaction();
  } catch (error) {
    try {
      if (r.isTransactionActive) {
        await r.rollbackTransaction();
      }
    } catch {
      // ignore rollback errors
    }
    console.error('RLS self-test failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  } finally {
    try {
      await r.release();
    } catch {
      // ignore release errors
    }
    try {
      await ds.destroy();
    } catch {
      // ignore destroy errors
    }
  }
}

main();
