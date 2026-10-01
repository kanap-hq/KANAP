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
# Output: a directory of CSV files (one per table) + export-metadata.json
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
  psql "$DB_URL" --no-psqlrc --tuples-only --no-align "$@"
}

psql_copy() {
  psql "$DB_URL" --no-psqlrc "$@"
}

# RLS-aware copy: sets app.current_tenant in the same session as \COPY
# so that RLS policies pass for non-superuser roles.
psql_copy_tenant() {
  local copy_cmd="$1"
  local outfile="$2"
  psql "$DB_URL" --no-psqlrc <<SQL | grep -v '^SET$' > "$outfile"
SET app.current_tenant = '$TENANT_ID';
$copy_cmd
SQL
}

# ---------------------------------------------------------------------------
# Resolve tenant
# ---------------------------------------------------------------------------
TENANT_ID=$(psql_cmd -c "SELECT id FROM tenants WHERE slug = '$TENANT_SLUG' AND deleted_at IS NULL LIMIT 1" | tr -d '[:space:]')

if [[ -z "$TENANT_ID" ]]; then
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
# Tenant-scoped tables (derived from TENANT_SCOPED_TABLES inventory)
# ---------------------------------------------------------------------------
TENANT_TABLES=(
  accounts
  ai_api_keys
  ai_conversations
  ai_messages
  ai_settings
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
  capex_allocations
  capex_amounts
  capex_attachments
  capex_item_analytics_values
  capex_item_contacts
  capex_items
  capex_links
  capex_round_inputs
  capex_round_input_lines
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
  document_contributors
  document_edit_locks
  document_folders
  document_libraries
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
  interface_middleware_applications
  interface_owners
  interfaces
  item_sequences
  location_contacts
  location_links
  location_user_contacts
  locations
  portfolio_activities
  portfolio_categories
  portfolio_criteria
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
  refresh_tokens
  role_permissions
  roles
  spend_allocations
  spend_amounts
  spend_attachments
  spend_item_analytics_values
  spend_item_contacts
  spend_items
  spend_links
  spend_round_inputs
  spend_round_input_lines
  spend_tasks
  spend_versions
  subscriptions
  supplier_contacts
  suppliers
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

# Tables to skip
SKIP_TABLES=( refresh_tokens )
if [[ "$INCLUDE_AUDIT" != "true" ]]; then
  SKIP_TABLES+=( audit_log )
fi
if [[ "$EXCLUDE_AI" == "true" ]]; then
  SKIP_TABLES+=( ai_conversations ai_messages ai_api_keys ai_settings )
fi

should_skip() {
  local table="$1"
  for skip in "${SKIP_TABLES[@]}"; do
    if [[ "$table" == "$skip" ]]; then
      return 0
    fi
  done
  return 1
}

# ---------------------------------------------------------------------------
# Export tenant row
# ---------------------------------------------------------------------------
echo "Exporting tenant row..."
psql_copy_tenant "\\COPY (SELECT * FROM tenants WHERE id = '$TENANT_ID') TO STDOUT WITH (FORMAT csv, HEADER true, FORCE_QUOTE *)" "$OUTPUT_DIR/tenants.csv"

# ---------------------------------------------------------------------------
# Export tenant-scoped tables
# ---------------------------------------------------------------------------
declare -A ROW_COUNTS
EXPORTED_TABLES=()

for table in "${TENANT_TABLES[@]}"; do
  if should_skip "$table"; then
    echo "  skip: $table"
    continue
  fi

  csv_file="$OUTPUT_DIR/${table}.csv"
  psql_copy_tenant "\\COPY (SELECT * FROM ${table} WHERE tenant_id = '$TENANT_ID') TO STDOUT WITH (FORMAT csv, HEADER true, FORCE_QUOTE *)" "$csv_file"

  # Count rows (subtract 1 for header)
  row_count=$(( $(wc -l < "$csv_file") - 1 ))
  if [[ $row_count -lt 0 ]]; then row_count=0; fi
  ROW_COUNTS[$table]=$row_count
  EXPORTED_TABLES+=("$table")

  if [[ $row_count -gt 0 ]]; then
    echo "  $table: $row_count rows"
  fi
done

# ---------------------------------------------------------------------------
# Export exempt table: allocation_rules (nullable tenant_id)
# ---------------------------------------------------------------------------
echo "Exporting allocation_rules..."
csv_file="$OUTPUT_DIR/allocation_rules.csv"
psql_copy_tenant "\\COPY (SELECT * FROM allocation_rules WHERE tenant_id = '$TENANT_ID') TO STDOUT WITH (FORMAT csv, HEADER true, FORCE_QUOTE *)" "$csv_file"
row_count=$(( $(wc -l < "$csv_file") - 1 ))
if [[ $row_count -lt 0 ]]; then row_count=0; fi
ROW_COUNTS[allocation_rules]=$row_count
EXPORTED_TABLES+=("allocation_rules")
echo "  allocation_rules: $row_count rows"

# ---------------------------------------------------------------------------
# Export portfolio_criterion_values through the parent criterion so exports made
# before tenant_id was re-added (migration 1853560000000) and after share one shape
# ---------------------------------------------------------------------------
echo "Exporting portfolio_criterion_values..."
csv_file="$OUTPUT_DIR/portfolio_criterion_values.csv"
psql_copy_tenant "\\COPY (SELECT pcv.* FROM portfolio_criterion_values pcv JOIN portfolio_criteria pc ON pcv.criterion_id = pc.id WHERE pc.tenant_id = '$TENANT_ID') TO STDOUT WITH (FORMAT csv, HEADER true, FORCE_QUOTE *)" "$csv_file"
row_count=$(( $(wc -l < "$csv_file") - 1 ))
if [[ $row_count -lt 0 ]]; then row_count=0; fi
ROW_COUNTS[portfolio_criterion_values]=$row_count
EXPORTED_TABLES+=("portfolio_criterion_values")
echo "  portfolio_criterion_values: $row_count rows"

# ---------------------------------------------------------------------------
# Export global reference tables
# ---------------------------------------------------------------------------
echo "Exporting global reference tables..."
for table in account_classifications spread_profiles; do
  csv_file="$OUTPUT_DIR/${table}.csv"
  psql_copy_tenant "\\COPY (SELECT * FROM ${table}) TO STDOUT WITH (FORMAT csv, HEADER true, FORCE_QUOTE *)" "$csv_file"
  row_count=$(( $(wc -l < "$csv_file") - 1 ))
  if [[ $row_count -lt 0 ]]; then row_count=0; fi
  ROW_COUNTS[$table]=$row_count
  EXPORTED_TABLES+=("$table")
  echo "  $table: $row_count rows"
done

# ---------------------------------------------------------------------------
# Write metadata
# ---------------------------------------------------------------------------
echo "Writing metadata..."

# Build JSON row counts object
counts_json="{"
first=true
for table in "${EXPORTED_TABLES[@]}"; do
  if [[ "$first" != "true" ]]; then counts_json+=","; fi
  counts_json+="\"$table\":${ROW_COUNTS[$table]}"
  first=false
done
counts_json+="}"

cat > "$OUTPUT_DIR/export-metadata.json" <<EOF
{
  "tenant_id": "$TENANT_ID",
  "tenant_slug": "$TENANT_SLUG",
  "exported_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "latest_migration": "$LATEST_MIGRATION",
  "include_audit": $INCLUDE_AUDIT,
  "exclude_ai": $EXCLUDE_AI,
  "row_counts": $counts_json
}
EOF

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
total_rows=0
for table in "${EXPORTED_TABLES[@]}"; do
  total_rows=$(( total_rows + ROW_COUNTS[$table] ))
done

echo ""
echo "=========================================="
echo "Export complete"
echo "=========================================="
echo "Tenant:       $TENANT_SLUG ($TENANT_ID)"
echo "Schema:       $LATEST_MIGRATION"
echo "Tables:       ${#EXPORTED_TABLES[@]}"
echo "Total rows:   $total_rows"
echo "Output:       $OUTPUT_DIR"
echo ""
echo "Next steps:"
echo "  1. Transfer $OUTPUT_DIR to the on-prem server"
echo "  2. Transfer S3 files:"
echo "     # Download from cloud:"
echo "     aws s3 sync s3://cio-prod/files/$TENANT_ID/ ./s3-export/files/$TENANT_ID/"
echo "     # Upload to on-prem MinIO:"
echo "     mc alias set onprem http://<minio-host>:9000 <access-key> <secret-key>"
echo "     mc cp --recursive ./s3-export/files/$TENANT_ID/ onprem/kanap-files/files/$TENANT_ID/"
echo "  3. Run tenant-import.sh on the on-prem server"
