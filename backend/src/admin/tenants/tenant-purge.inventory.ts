import { TENANT_SCOPED_TABLES } from '../../common/tenant-isolation.inventory';

export const TENANT_PURGE_TABLES = [
  // Denormalized AI search index first: row triggers on the source tables
  // below would otherwise delete these rows one by one.
  'search_index',
  // Saved list states: no reference in or out besides the tenant
  'list_contexts',
  // Notification dedupe window: no reference in or out besides the tenant
  'notification_dedupe',
  // Incident register: children first; before documents, assets, applications and users
  'incident_entries',
  'incident_assets',
  'incident_applications',
  'document_incidents',
  'incident_attachments',
  'incidents',
  // Portfolio: purge in FK order (children before parents)
  'portfolio_project_time_entries',
  'portfolio_project_milestones',
  'portfolio_project_phases',
  'portfolio_project_opex',
  'portfolio_project_capex',
  'portfolio_project_attachments',
  'portfolio_project_urls',
  'portfolio_project_dependencies',
  'portfolio_project_contacts',
  'portfolio_project_effort_allocations',
  'portfolio_project_team',
  'application_projects',
  'asset_projects',
  'portfolio_request_projects',
  'portfolio_request_opex',
  'portfolio_request_capex',
  'portfolio_request_business_processes',
  'portfolio_request_applications',
  'portfolio_request_assets',
  'portfolio_request_attachments',
  'portfolio_request_urls',
  'portfolio_request_dependencies',
  'portfolio_request_contacts',
  'portfolio_request_team',
  'portfolio_activities',
  'portfolio_projects',
  'portfolio_requests',
  'portfolio_criterion_values',
  'portfolio_criteria',
  'portfolio_team_member_configs',
  'portfolio_teams',
  'portfolio_employment_types',
  'portfolio_phase_template_items',
  'portfolio_phase_templates',
  'portfolio_streams',
  'portfolio_categories',
  'portfolio_sources',
  'portfolio_skills',
  'portfolio_settings',
  // Knowledge
  'integrated_document_bindings',
  'integrated_document_slot_settings',
  'document_references',
  'document_applications',
  'document_assets',
  'document_projects',
  'document_requests',
  'document_tasks',
  'document_classifications',
  'document_connections',
  'document_interfaces',
  'document_contributors',
  'document_workflow_participants',
  'document_workflows',
  'document_activities',
  'document_attachments',
  'document_edit_locks',
  'document_versions',
  'document_locations',
  'documents',
  'document_types',
  'document_folders',
  'document_library_members',
  'document_libraries',
  // AI
  'ai_builtin_usage',
  'ai_agent_audit_events',
  'ai_agent_target_states',
  'ai_agent_work_items',
  'ai_agent_triggers',
  'ai_agent_definitions',
  'ai_shared_context_profiles',
  'ai_evaluations',
  'ai_decisions',
  'ai_recommendations',
  'ai_observations',
  'ai_approvals',
  'ai_approval_policies',
  'ai_evidence',
  'ai_tool_executions',
  'ai_action_requests',
  'ai_run_steps',
  'ai_runs',
  'ai_emergency_pauses',
  'ai_autonomy_routines',
  'ai_autonomy_ceilings',
  'ai_automation_job_catalog',
  'ai_live_test_targets',
  'ai_external_mcp_tool_snapshots',
  'ai_external_mcp_servers',
  'ai_adapter_configs',
  'ai_mutation_plan_steps',
  'ai_mutation_plans',
  'ai_mutation_previews',
  'ai_message_attachments',
  'ai_messages',
  'ai_conversations',
  'ai_api_keys',
  'ai_settings',
  // After ai_settings and ai_agent_definitions: both hold FKs to the model registry.
  'ai_model_configs',
  // Applications: purge attachments and links first
  'application_attachments',
  'application_links',
  'application_contracts',
  'application_capex_items',
  'application_spend_items',
  'application_departments',
  'application_companies',
  'application_owners',
  'application_data_residency',
  'application_support_contacts',
  'application_suites',
  // Interfaces: purge interface-level tables before base interfaces
  'interface_attachments',
  'interface_links',
  'interface_data_residency',
  'interface_key_identifiers',
  'interface_dependencies',
  'interface_companies',
  'interface_owners',
  'interface_mapping_rules',
  'interface_mapping_groups',
  'interface_mapping_sets',
  'interface_middleware_applications',
  'interface_legs',
  'interface_connection_links',
  'interface_bindings',
  'connection_legs',
  'connection_protocols',
  'connection_servers',
  'connections',
  'app_asset_assignments',
  'interfaces',
  'app_instances',
  // Asset extension tables must be purged before assets
  'asset_attachments',
  'asset_external_links',
  'asset_links',
  'asset_support_contacts',
  'asset_hardware_info',
  'asset_support_info',
  'asset_relations',
  'asset_spend_items',
  'asset_capex_items',
  'asset_contracts',
  'asset_cluster_members',
  'assets',
  'location_sub_items',
  'location_links',
  'location_contacts',
  'location_user_contacts',
  'locations',
  'applications',
  'contract_attachments',
  'contract_tasks',
  'contract_links',
  'contract_spend_items',
  'contract_capex_items',
  'contract_contacts',
  'contracts',
  // unified tasks table (link tables, attachments, and time entries before tasks due to FK)
  'task_applications',
  'task_assets',
  'task_attachments',
  'task_time_entries',
  'user_time_monthly_aggregates',
  'tasks',
  'portfolio_task_types',
  // Per-tenant item numbering for tasks, requests, projects, and documents
  'item_sequences',
  // Derived totals before their amounts: the amounts' delete trigger would otherwise update them first
  'spend_version_totals',
  'spend_amounts',
  'spend_allocations',
  // A line references its round (ON DELETE CASCADE) and its calendar (RESTRICT): before both
  'spend_round_input_lines',
  'spend_round_inputs',
  'spend_versions',
  'spend_tasks',
  'spend_links',
  'spend_attachments',
  'spend_item_contacts',
  // Each line table before its analytics values: deleting the lines deletes their values (ON
  // DELETE CASCADE) with no line left to refresh. Deleting the values first would make their
  // search index trigger (migration 1853940000000) rewrite the entry of every line about to go.
  'spend_items',
  'spend_item_analytics_values',
  'capex_version_totals',
  'capex_amounts',
  'capex_allocations',
  'capex_round_input_lines',
  'capex_round_inputs',
  // After both line tables (a line references its calendar ON DELETE RESTRICT)
  'working_day_profiles',
  'capex_versions',
  'capex_links',
  'capex_attachments',
  'capex_item_contacts',
  // currency rate snapshots per-tenant
  'currency_rate_sets',
  'capex_items',
  'capex_item_analytics_values',
  'business_process_category_links',
  'business_processes',
  'business_process_categories',
  // After the line values (a line value references a value by (tenant, value, dimension) ON DELETE RESTRICT)
  'analytics_categories',
  // After the values (a value references its dimension ON DELETE RESTRICT)
  'analytics_axes',
  // After both item tables (lines reference a node), before companies and users (a node references them)
  'cost_centers',
  'freeze_states',
  'department_metrics',
  'company_metrics',
  'departments',
  'companies',
  'user_page_roles',
  'user_roles',
  'role_permissions',
  'user_dashboard_config',
  'user_notification_preferences',
  'refresh_tokens',
  'password_reset_tokens',
  'users',
  'roles',
  // Contacts must be purged before suppliers (supplier_contacts has FKs to both)
  'supplier_contacts',
  'contacts',
  'suppliers',
  'accounts',
  // Chart of Accounts introduced recently; ensure CoAs are purged per-tenant
  'chart_of_accounts',
  'allocation_rules',
  'audit_log',
  'subscriptions',
] as const;

export const TENANT_PURGE_ATTACHMENT_TABLES = [
  'portfolio_project_attachments',
  'portfolio_request_attachments',
  'task_attachments',
  'contract_attachments',
  'capex_attachments',
  'spend_attachments',
  'application_attachments',
  'interface_attachments',
  'document_attachments',
  'asset_attachments',
  'incident_attachments',
  'ai_message_attachments',
] as const;

export function validateTenantPurgeConfiguration(): string[] {
  const failures: string[] = [];
  const purgeTables = new Set<string>();
  for (const table of TENANT_PURGE_TABLES) {
    if (purgeTables.has(table)) {
      failures.push(`tenant purge defines duplicate table ${table}`);
      continue;
    }
    purgeTables.add(table);
  }

  const attachmentTables = new Set<string>();
  for (const table of TENANT_PURGE_ATTACHMENT_TABLES) {
    if (attachmentTables.has(table)) {
      failures.push(`tenant purge defines duplicate attachment cleanup table ${table}`);
      continue;
    }
    attachmentTables.add(table);
    if (!purgeTables.has(table)) {
      failures.push(`tenant purge attachment cleanup table ${table} is missing from purge order`);
    }
  }

  for (const table of TENANT_SCOPED_TABLES) {
    if (!purgeTables.has(table)) {
      failures.push(`tenant purge is missing tenant-scoped table ${table}`);
    }
  }

  return failures;
}

export function assertTenantPurgeConfiguration(): void {
  const failures = validateTenantPurgeConfiguration();
  if (failures.length > 0) {
    throw new Error(failures.join('; '));
  }
}
