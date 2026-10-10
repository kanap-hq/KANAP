#!/usr/bin/env bash
#
# tenant-export.sh — Export a single tenant's data from a KANAP database.
#
# Usage:
#   ./scripts/tenant-export.sh <database_url> <tenant_slug> <output_dir> [--include-audit] [--exclude-ai]
#
# Example:
#   ./scripts/tenant-export.sh "postgres://kanap:pass@localhost:5432/kanap" acme ./export-acme
#   ./scripts/tenant-export.sh "$DATABASE_URL" acme ./export-acme --include-audit
#
# Output: a directory of CSV files (one per table), storage-keys.csv (the stored
# files the tenant's rows point to) and export-metadata.json.
#
# Every table is read in one read-only transaction, so the files describe a
# single point in time even while the application keeps running.
#
# The export preserves the original tenant_id UUID so that the import script
# can load data without remapping foreign keys or S3 storage paths.
#
set -euo pipefail

# ---------------------------------------------------------------------------
# Args
# ---------------------------------------------------------------------------
if [[ $# -lt 3 ]]; then
  echo "Usage: $0 <database_url> <tenant_slug> <output_dir> [--include-audit] [--exclude-ai]"
  exit 1
fi

DB_URL="$1"
TENANT_SLUG="$2"
OUTPUT_DIR="$3"
shift 3

INCLUDE_AUDIT=false
EXCLUDE_AI=false
for arg in "$@"; do
  case "$arg" in
    --include-audit) INCLUDE_AUDIT=true ;;
    --exclude-ai)    EXCLUDE_AI=true ;;
    *) echo "Unknown flag: $arg"; exit 1 ;;
  esac
done

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
psql_cmd() {
  psql "$DB_URL" --no-psqlrc --tuples-only --no-align -v ON_ERROR_STOP=1 "$@"
}

# ---------------------------------------------------------------------------
# Resolve tenant
# ---------------------------------------------------------------------------
# The slug travels as a psql variable (:'slug' quotes it), never inside the SQL text.
TENANT_ID=$(psql_cmd -v slug="$TENANT_SLUG" <<'SQL' | tr -d '[:space:]'
SELECT id FROM tenants WHERE slug = :'slug' AND deleted_at IS NULL LIMIT 1
SQL
)

if [[ ! "$TENANT_ID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
  echo "ERROR: Tenant with slug '$TENANT_SLUG' not found (or deleted)."
  exit 1
fi

echo "Tenant: $TENANT_SLUG (id: $TENANT_ID)"

# ---------------------------------------------------------------------------
# Schema version
# ---------------------------------------------------------------------------
LATEST_MIGRATION=$(psql_cmd -c "SELECT name FROM migrations ORDER BY id DESC LIMIT 1" | tr -d '[:space:]')
echo "Schema version: $LATEST_MIGRATION"

# ---------------------------------------------------------------------------
# Prepare output directory
# ---------------------------------------------------------------------------
mkdir -p "$OUTPUT_DIR"

# ---------------------------------------------------------------------------
# Tenant tables
#
# Every table of TENANT_SCOPED_TABLES (backend/src/common/tenant-isolation.inventory.ts)
# is either exported (TENANT_TABLES) or excluded with its reason (EXCLUDED_TABLES).
# backend/src/admin/tenants/__tests__/tenant-export-coverage.spec.ts compares both
# lists with the inventory: a new tenant table fails CI until it is placed on one side.
# Keep one table name per line.
# ---------------------------------------------------------------------------
TENANT_TABLES=(
  accounts
  ai_action_requests
  ai_adapter_configs
  ai_agent_audit_events
  ai_agent_definitions
  ai_agent_target_states
  ai_agent_triggers
  ai_agent_work_items
  ai_api_keys
  ai_approval_policies
  ai_approvals
  ai_automation_job_catalog
  ai_autonomy_ceilings
  ai_autonomy_routines
  ai_builtin_usage
  ai_conversations
  ai_decisions
  ai_emergency_pauses
  ai_evaluations
  ai_evidence
  ai_external_mcp_servers
  ai_external_mcp_tool_snapshots
  ai_live_test_targets
  ai_message_attachments
  ai_messages
  ai_model_configs
  ai_mutation_plan_steps
  ai_mutation_plans
  ai_mutation_previews
  ai_observations
  ai_recommendations
  ai_run_steps
  ai_runs
  ai_settings
  ai_shared_context_profiles
  ai_tool_executions
  allocation_rules
  analytics_axes
  analytics_categories
  app_asset_assignments
  app_instances
  application_attachments
  application_capex_items
  application_companies
  application_contracts
  application_data_residency
  application_departments
  application_links
  application_owners
  application_projects
  application_spend_items
  application_suites
  application_support_contacts
  applications
  asset_attachments
  asset_capex_items
  asset_cluster_members
  asset_contracts
  asset_external_links
  asset_hardware_info
  asset_links
  asset_projects
  asset_relations
  asset_spend_items
  asset_support_contacts
  asset_support_info
  assets
  audit_log
  business_process_categories
  business_process_category_links
  business_processes
  # The capex_* tables (and application_capex_items, asset_capex_items, contract_capex_items,
  # portfolio_project_capex, portfolio_request_capex) are dormant since lot Z1: the CAPEX lines are in
  # spend_* with nature = 'capex'. They are still exported, for the down() of migration
  # 1853970000000, until lot Z2 drops them; their rows are the lines as they were at the move.
  capex_allocations
  capex_amounts
  capex_attachments
  capex_item_analytics_values
  capex_item_contacts
  capex_items
  capex_links
  capex_round_input_lines
  capex_round_inputs
  capex_versions
  chart_of_accounts
  companies
  company_metrics
  connection_legs
  connection_protocols
  connection_servers
  connections
  contacts
  contract_attachments
  contract_capex_items
  contract_contacts
  contract_links
  contract_spend_items
  contract_tasks
  contracts
  cost_centers
  currency_rate_sets
  department_metrics
  departments
  document_activities
  document_applications
  document_assets
  document_attachments
  document_classifications
  document_connections
  document_contributors
  document_edit_locks
  document_folders
  document_incidents
  document_interfaces
  document_libraries
  document_library_members
  document_locations
  document_projects
  document_references
  document_requests
  document_tasks
  document_types
  document_versions
  document_workflow_participants
  document_workflows
  documents
  freeze_states
  incident_applications
  incident_assets
  incident_attachments
  incident_entries
  incidents
  integrated_document_bindings
  integrated_document_slot_settings
  interface_attachments
  interface_bindings
  interface_companies
  interface_connection_links
  interface_data_residency
  interface_dependencies
  interface_key_identifiers
  interface_legs
  interface_links
  interface_mapping_groups
  interface_mapping_rules
  interface_mapping_sets
  interface_middleware_applications
  interface_owners
  interfaces
  item_sequences
  location_contacts
  location_links
  location_sub_items
  location_user_contacts
  locations
  portfolio_activities
  portfolio_categories
  portfolio_criteria
  portfolio_criterion_values
  portfolio_employment_types
  portfolio_phase_template_items
  portfolio_phase_templates
  portfolio_project_attachments
  portfolio_project_capex
  portfolio_project_contacts
  portfolio_project_dependencies
  portfolio_project_effort_allocations
  portfolio_project_milestones
  portfolio_project_opex
  portfolio_project_phases
  portfolio_project_team
  portfolio_project_time_entries
  portfolio_project_urls
  portfolio_projects
  portfolio_request_applications
  portfolio_request_assets
  portfolio_request_attachments
  portfolio_request_business_processes
  portfolio_request_capex
  portfolio_request_contacts
  portfolio_request_dependencies
  portfolio_request_opex
  portfolio_request_projects
  portfolio_request_team
  portfolio_request_urls
  portfolio_requests
  portfolio_settings
  portfolio_skills
  portfolio_sources
  portfolio_streams
  portfolio_task_types
  portfolio_team_member_configs
  portfolio_teams
  role_permissions
  roles
  spend_allocations
  spend_amounts
  spend_attachments
  spend_item_analytics_values
  spend_item_contacts
  spend_items
  spend_links
  spend_round_input_lines
  spend_round_inputs
  spend_tasks
  spend_versions
  subscriptions
  supplier_contacts
  suppliers
  task_applications
  task_assets
  task_attachments
  task_time_entries
  tasks
  user_dashboard_config
  user_notification_preferences
  user_page_roles
  user_roles
  user_time_monthly_aggregates
  users
  working_day_profiles
)

declare -A EXCLUDED_TABLES=(
  [refresh_tokens]="Open sessions: they are tied to the source installation, users sign in again after the move."
  [password_reset_tokens]="Pending password links expire within hours and point to the source installation."
  [search_index]="Derived from the business tables: tenant-import.sh rebuilds it (search_index_refresh_* functions)."
  [spend_version_totals]="Sums of the spend amounts: tenant-import.sh rebuilds them (budget_version_totals_rebuild)."
  [capex_version_totals]="Sums of the CAPEX amounts: tenant-import.sh rebuilds them (budget_version_totals_rebuild)."
  [list_contexts]="Short-lived list states behind list links, purged after 90 days without use."
  [notification_dedupe]="One-day window that stops a notification from being sent twice, rebuilt as notifications go out."
)

# Tables whose rows point to stored files (TENANT_PURGE_ATTACHMENT_TABLES in
# backend/src/admin/tenants/tenant-purge.inventory.ts): their storage_path values
# go to storage-keys.csv, with the branding logo of the tenant.
ATTACHMENT_TABLES=(
  portfolio_project_attachments
  portfolio_request_attachments
  task_attachments
  contract_attachments
  # Dormant since lot Z1 (see TENANT_TABLES): a path may name a file deleted since the move.
  capex_attachments
  spend_attachments
  application_attachments
  interface_attachments
  document_attachments
  asset_attachments
  incident_attachments
  ai_message_attachments
)

# Global reference tables (no tenant_id), exported whole.
GLOBAL_TABLES=( account_classifications spread_profiles )

should_skip() {
  local table="$1"
  if [[ "$table" == "audit_log" && "$INCLUDE_AUDIT" != "true" ]]; then
    return 0
  fi
  if [[ "$table" == ai_* && "$EXCLUDE_AI" == "true" ]]; then
    return 0
  fi
  return 1
}

# The rows of one tenant table.
tenant_select() {
  local table="$1"
  case "$table" in
    # Through the parent criterion, so exports made before tenant_id was re-added
    # (migration 1853560000000) and after share one shape.
    portfolio_criterion_values)
      echo "SELECT pcv.* FROM portfolio_criterion_values pcv JOIN portfolio_criteria pc ON pcv.criterion_id = pc.id WHERE pc.tenant_id = '$TENANT_ID'" ;;
    *)
      echo "SELECT * FROM ${table} WHERE tenant_id = '$TENANT_ID'" ;;
  esac
}

# ---------------------------------------------------------------------------
# Build the export: one psql session, one read-only snapshot
# ---------------------------------------------------------------------------
COPY_OPTS="WITH (FORMAT csv, HEADER true, FORCE_QUOTE *)"
EXPORT_FILES=()     # file names, in the order of the \copy commands
COUNTED_TABLES=()   # tables reported in export-metadata.json row_counts
SKIPPED_TABLES=()

copy_sql="BEGIN ISOLATION LEVEL REPEATABLE READ, READ ONLY;
SET LOCAL app.current_tenant = '$TENANT_ID';
"
add_copy() {
  local file="$1" query="$2"
  copy_sql+="\\copy (${query}) TO '${file}' ${COPY_OPTS}
"
  EXPORT_FILES+=("$file")
}

add_copy tenants.csv "SELECT * FROM tenants WHERE id = '$TENANT_ID'"

for table in "${GLOBAL_TABLES[@]}"; do
  add_copy "${table}.csv" "SELECT * FROM ${table}"
  COUNTED_TABLES+=("$table")
done

for table in "${TENANT_TABLES[@]}"; do
  if should_skip "$table"; then
    SKIPPED_TABLES+=("$table")
    continue
  fi
  add_copy "${table}.csv" "$(tenant_select "$table")"
  COUNTED_TABLES+=("$table")
done

# Storage keys of the stored files (the files themselves are not copied).
keys_query=""
for table in "${ATTACHMENT_TABLES[@]}"; do
  if should_skip "$table"; then
    continue
  fi
  keys_query+="SELECT '${table}'::text AS source_table, id::text AS source_id, storage_path, size::bigint AS size FROM ${table} WHERE tenant_id = '$TENANT_ID' AND storage_path IS NOT NULL UNION ALL "
done
keys_query+="SELECT 'tenants'::text, id::text, branding->>'logo_storage_path', NULL::bigint FROM tenants WHERE id = '$TENANT_ID' AND branding->>'logo_storage_path' IS NOT NULL"
add_copy storage-keys.csv "SELECT * FROM (${keys_query}) k ORDER BY source_table, storage_path"

copy_sql+="COMMIT;
"

# ---------------------------------------------------------------------------
# Run the export
# ---------------------------------------------------------------------------
echo "Exporting ${#EXPORT_FILES[@]} files..."
for table in "${SKIPPED_TABLES[@]}"; do
  echo "  skip: $table"
done

# \copy writes relative to the current directory: run psql from the output directory.
copy_output=$(cd "$OUTPUT_DIR" && psql "$DB_URL" --no-psqlrc -v ON_ERROR_STOP=1 <<<"$copy_sql")

# psql prints "COPY <rows>" once per \copy, in order: the exact row counts.
mapfile -t COPY_COUNTS < <(sed -n 's/^COPY \([0-9][0-9]*\)$/\1/p' <<<"$copy_output")
if [[ ${#COPY_COUNTS[@]} -ne ${#EXPORT_FILES[@]} ]]; then
  echo "ERROR: expected ${#EXPORT_FILES[@]} COPY results, got ${#COPY_COUNTS[@]}."
  exit 1
fi

declare -A ROW_COUNTS
for i in "${!EXPORT_FILES[@]}"; do
  ROW_COUNTS[${EXPORT_FILES[$i]%.csv}]=${COPY_COUNTS[$i]}
done

for table in "${COUNTED_TABLES[@]}"; do
  if [[ ${ROW_COUNTS[$table]} -gt 0 ]]; then
    echo "  $table: ${ROW_COUNTS[$table]} rows"
  fi
done
STORAGE_KEY_COUNT=${ROW_COUNTS[storage-keys]}
echo "  storage keys: $STORAGE_KEY_COUNT"

# ---------------------------------------------------------------------------
# Write metadata
# ---------------------------------------------------------------------------
echo "Writing metadata..."

# Build JSON row counts object
counts_json="{"
first=true
for table in "${COUNTED_TABLES[@]}"; do
  if [[ "$first" != "true" ]]; then counts_json+=","; fi
  counts_json+="\"$table\":${ROW_COUNTS[$table]}"
  first=false
done
counts_json+="}"

excluded_json="["
first=true
for table in "${!EXCLUDED_TABLES[@]}"; do
  if [[ "$first" != "true" ]]; then excluded_json+=","; fi
  excluded_json+="\"$table\""
  first=false
done
excluded_json+="]"

cat > "$OUTPUT_DIR/export-metadata.json" <<EOF
{
  "tenant_id": "$TENANT_ID",
  "tenant_slug": "$TENANT_SLUG",
  "exported_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "latest_migration": "$LATEST_MIGRATION",
  "include_audit": $INCLUDE_AUDIT,
  "exclude_ai": $EXCLUDE_AI,
  "excluded_tables": $excluded_json,
  "storage_keys_file": "storage-keys.csv",
  "storage_key_count": $STORAGE_KEY_COUNT,
  "row_counts": $counts_json
}
EOF

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
total_rows=0
for table in "${COUNTED_TABLES[@]}"; do
  total_rows=$(( total_rows + ROW_COUNTS[$table] ))
done

echo ""
echo "=========================================="
echo "Export complete"
echo "=========================================="
echo "Tenant:       $TENANT_SLUG ($TENANT_ID)"
echo "Schema:       $LATEST_MIGRATION"
echo "Tables:       ${#COUNTED_TABLES[@]}"
echo "Total rows:   $total_rows"
echo "Stored files: $STORAGE_KEY_COUNT (keys in $OUTPUT_DIR/storage-keys.csv)"
echo "Output:       $OUTPUT_DIR"
echo ""
echo "Next steps:"
echo "  1. Transfer $OUTPUT_DIR to the on-prem server"
echo "  2. Copy the stored files listed in storage-keys.csv (storage_path column)."
echo "     They all sit under files/$TENANT_ID/. Indicative commands:"
echo "     # Download from cloud:"
echo "     aws s3 sync s3://cio-prod/files/$TENANT_ID/ ./s3-export/files/$TENANT_ID/"
echo "     # Upload to on-prem MinIO:"
echo "     mc alias set onprem http://<minio-host>:9000 <access-key> <secret-key>"
echo "     mc cp --recursive ./s3-export/files/$TENANT_ID/ onprem/kanap-files/files/$TENANT_ID/"
echo "  3. Run tenant-import.sh on the on-prem server"
