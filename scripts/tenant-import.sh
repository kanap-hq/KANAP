#!/usr/bin/env bash
#
# tenant-import.sh — Import a tenant export into a fresh on-prem KANAP instance.
#
# MUST be run as the postgres superuser (bypasses RLS).
# The app role (kanap) is NOSUPERUSER NOBYPASSRLS and cannot COPY into
# RLS-protected tables without a tenant context set.
#
# Usage:
#   sudo -u postgres ./scripts/tenant-import.sh <database_name> <export_dir> [destination_slug]
#
# Example:
#   sudo -u postgres ./scripts/tenant-import.sh kanap ./export-acme default
#
# Prerequisites:
#   - Fresh on-prem install (migrations applied, default tenant provisioned)
#   - Application stopped: docker compose -f infra/compose.onprem.yml down
#   - S3 files already transferred (see export script output for instructions)
#
set -euo pipefail

# ---------------------------------------------------------------------------
# Args
# ---------------------------------------------------------------------------
if [[ $# -lt 2 ]]; then
  echo "Usage: sudo -u postgres $0 <database_name> <export_dir> [destination_slug]"
  echo ""
  echo "Must be run as the postgres superuser."
  exit 1
fi

DB_NAME="$1"
EXPORT_DIR="$2"
DEST_SLUG="${3:-default}"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
psql_cmd() {
  psql -d "$DB_NAME" --no-psqlrc --tuples-only --no-align "$@"
}

psql_exec() {
  psql -d "$DB_NAME" --no-psqlrc "$@"
}

# Read the CSV header and return it as a comma-separated column list
# e.g. "id,name,tenant_id" — for use in \COPY table(...) FROM ...
csv_columns() {
  head -1 "$1" | sed 's/"//g'
}

# ---------------------------------------------------------------------------
# Validate: check we're superuser
# ---------------------------------------------------------------------------
IS_SUPER=$(psql_cmd -c "SELECT rolsuper FROM pg_roles WHERE rolname = current_user")
if [[ "$IS_SUPER" != "t" ]]; then
  echo "ERROR: This script must be run as a PostgreSQL superuser."
  echo "Current user is not superuser. Try: sudo -u postgres $0 $*"
  exit 1
fi

# ---------------------------------------------------------------------------
# Validate: metadata file
# ---------------------------------------------------------------------------
METADATA_FILE="$EXPORT_DIR/export-metadata.json"
if [[ ! -f "$METADATA_FILE" ]]; then
  echo "ERROR: $METADATA_FILE not found. Is $EXPORT_DIR a valid export directory?"
  exit 1
fi

# Parse metadata (using simple grep/sed — no jq dependency)
SOURCE_TENANT_ID=$(grep '"tenant_id"' "$METADATA_FILE" | sed 's/.*: *"\([^"]*\)".*/\1/')
SOURCE_SLUG=$(grep '"tenant_slug"' "$METADATA_FILE" | sed 's/.*: *"\([^"]*\)".*/\1/')
EXPORT_MIGRATION=$(grep '"latest_migration"' "$METADATA_FILE" | sed 's/.*: *"\([^"]*\)".*/\1/')

echo "Source tenant: $SOURCE_SLUG ($SOURCE_TENANT_ID)"
echo "Export schema: $EXPORT_MIGRATION"
echo "Destination slug: $DEST_SLUG"

# ---------------------------------------------------------------------------
# Validate: schema version match
# ---------------------------------------------------------------------------
DEST_MIGRATION=$(psql_cmd -c "SELECT name FROM migrations ORDER BY id DESC LIMIT 1" | tr -d '[:space:]')

if [[ "$EXPORT_MIGRATION" != "$DEST_MIGRATION" ]]; then
  echo ""
  echo "ERROR: Schema version mismatch!"
  echo "  Export:      $EXPORT_MIGRATION"
  echo "  Destination: $DEST_MIGRATION"
  echo ""
  echo "Both source and destination must be on the same KANAP version."
  echo "Update the on-prem instance to match, then re-run this script."
  exit 1
fi

echo "Schema version match: $DEST_MIGRATION"

# ---------------------------------------------------------------------------
# Warn about application state
# ---------------------------------------------------------------------------
echo ""
echo "IMPORTANT: The KANAP application must be stopped before importing."
echo "  docker compose -f infra/compose.onprem.yml down"
echo ""
read -r -p "Is the application stopped? [y/N] " confirm
if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
  echo "Aborted. Stop the application first."
  exit 1
fi

# ---------------------------------------------------------------------------
# Phase 1: Wipe fresh install data
# ---------------------------------------------------------------------------
echo ""
echo "Phase 1: Wiping fresh install data..."

# Find the existing default tenant
DEFAULT_TENANT_ID=$(psql_cmd -c "SELECT id FROM tenants WHERE slug = '$DEST_SLUG' AND deleted_at IS NULL LIMIT 1" | tr -d '[:space:]')

if [[ -n "$DEFAULT_TENANT_ID" ]]; then
  echo "  Found existing tenant '$DEST_SLUG' ($DEFAULT_TENANT_ID) — purging..."

  # Purge in FK-safe order (children before parents) — from TENANT_PURGE_TABLES
  PURGE_ORDER=(
    portfolio_project_time_entries
    portfolio_project_milestones
    portfolio_project_phases
    portfolio_project_opex
    portfolio_project_capex
    portfolio_project_attachments
    portfolio_project_urls
    portfolio_project_dependencies
    portfolio_project_contacts
    portfolio_project_effort_allocations
    portfolio_project_team
    application_projects
    asset_projects
    portfolio_request_projects
    portfolio_request_opex
    portfolio_request_capex
    portfolio_request_business_processes
    portfolio_request_applications
    portfolio_request_assets
    portfolio_request_attachments
    portfolio_request_urls
    portfolio_request_dependencies
    portfolio_request_contacts
    portfolio_request_team
    portfolio_activities
    portfolio_projects
    portfolio_requests
    portfolio_criteria
    portfolio_team_member_configs
    portfolio_teams
    portfolio_phase_template_items
    portfolio_phase_templates
    portfolio_streams
    portfolio_categories
    portfolio_sources
    portfolio_skills
    portfolio_settings
    integrated_document_bindings
    integrated_document_slot_settings
    document_references
    document_applications
    document_assets
    document_projects
    document_requests
    document_tasks
    document_classifications
    document_contributors
    document_workflow_participants
    document_workflows
    document_activities
    document_attachments
    document_edit_locks
    document_versions
    documents
    document_types
    document_folders
    document_libraries
    ai_messages
    ai_conversations
    ai_api_keys
    ai_settings
    application_attachments
    application_links
    application_contracts
    application_capex_items
    application_spend_items
    application_departments
    application_companies
    application_owners
    application_data_residency
    application_support_contacts
    application_suites
    interface_attachments
    interface_links
    interface_data_residency
    interface_key_identifiers
    interface_dependencies
    interface_companies
    interface_owners
    interface_middleware_applications
    interface_legs
    interface_connection_links
    interface_bindings
    connection_legs
    connection_protocols
    connection_servers
    connections
    app_asset_assignments
    interfaces
    app_instances
    asset_attachments
    asset_links
    asset_support_contacts
    asset_hardware_info
    asset_support_info
    asset_relations
    asset_spend_items
    asset_capex_items
    asset_contracts
    asset_cluster_members
    assets
    location_links
    location_contacts
    location_user_contacts
    locations
    applications
    contract_attachments
    contract_tasks
    contract_links
    contract_spend_items
    contract_capex_items
    contract_contacts
    contracts
    task_attachments
    task_time_entries
    user_time_monthly_aggregates
    tasks
    portfolio_task_types
    item_sequences
    spend_amounts
    spend_allocations
    spend_round_input_lines
    spend_round_inputs
    spend_versions
    spend_tasks
    spend_links
    spend_attachments
    spend_item_contacts
    spend_item_analytics_values
    capex_item_analytics_values
    spend_items
    business_process_category_links
    business_processes
    business_process_categories
    analytics_categories
    analytics_axes
    capex_amounts
    capex_allocations
    capex_round_input_lines
    capex_round_inputs
    working_day_profiles
    capex_versions
    capex_links
    capex_attachments
    capex_item_contacts
    currency_rate_sets
    capex_items
    cost_centers
    freeze_states
    department_metrics
    company_metrics
    departments
    companies
    user_page_roles
    user_roles
    role_permissions
    user_dashboard_config
    user_notification_preferences
    refresh_tokens
    users
    roles
    supplier_contacts
    contacts
    suppliers
    accounts
    chart_of_accounts
    allocation_rules
    audit_log
    subscriptions
  )

  for table in "${PURGE_ORDER[@]}"; do
    psql_cmd -c "DELETE FROM ${table} WHERE tenant_id = '$DEFAULT_TENANT_ID'" 2>/dev/null || true
  done

  # portfolio_criterion_values: no tenant_id, cascades from portfolio_criteria (already deleted)

  # Delete the tenant row itself
  psql_cmd -c "DELETE FROM tenants WHERE id = '$DEFAULT_TENANT_ID'"
  echo "  Purge complete."
else
  echo "  No existing tenant '$DEST_SLUG' found — clean slate."
fi

# ---------------------------------------------------------------------------
# Phase 2: Import data
# ---------------------------------------------------------------------------
echo ""
echo "Phase 2: Importing data..."

# Disable FK constraint triggers for the import session
psql_cmd -c "SET session_replication_role = 'replica'"

# -- Import global reference tables (ON CONFLICT DO NOTHING) ----------------
echo "  Importing global reference tables..."
for table in account_classifications spread_profiles; do
  csv_file="$EXPORT_DIR/${table}.csv"
  if [[ -f "$csv_file" ]]; then
    cols=$(csv_columns "$csv_file")
    psql_exec <<SQL
SET session_replication_role = 'replica';
CREATE TEMP TABLE _tmp_import (LIKE ${table} INCLUDING ALL);
\\COPY _tmp_import($cols) FROM '$(realpath "$csv_file")' WITH (FORMAT csv, HEADER true);
INSERT INTO ${table}($cols) SELECT $cols FROM _tmp_import ON CONFLICT DO NOTHING;
DROP TABLE _tmp_import;
SQL
    echo "    $table: done"
  fi
done

# -- Import tenant row (with transformations) --------------------------------
echo "  Importing tenant row..."
tenant_cols=$(csv_columns "$EXPORT_DIR/tenants.csv")
psql_exec <<SQL
SET session_replication_role = 'replica';
CREATE TEMP TABLE _tmp_tenant (LIKE tenants INCLUDING ALL);
\\COPY _tmp_tenant($tenant_cols) FROM '$(realpath "$EXPORT_DIR/tenants.csv")' WITH (FORMAT csv, HEADER true);
UPDATE _tmp_tenant SET
  slug = '$DEST_SLUG',
  stripe_customer_id = NULL,
  billing_email = NULL,
  billing_company_name = NULL,
  billing_phone = NULL,
  billing_tax_id = NULL,
  billing_address = NULL,
  billing_customer_info = NULL,
  billing_invoice_info = NULL;
INSERT INTO tenants($tenant_cols) SELECT $tenant_cols FROM _tmp_tenant;
DROP TABLE _tmp_tenant;
SQL
echo "    tenant '$SOURCE_SLUG' imported as '$DEST_SLUG'"

# -- Import tenant-scoped tables (reverse of PURGE_ORDER = parents first) ----
echo "  Importing tenant-scoped tables..."

# Reverse the purge order for import (parents before children)
IMPORT_ORDER=()
for (( i=${#PURGE_ORDER[@]}-1; i>=0; i-- )); do
  IMPORT_ORDER+=("${PURGE_ORDER[$i]}")
done

imported_count=0
imported_rows=0

for table in "${IMPORT_ORDER[@]}"; do
  csv_file="$EXPORT_DIR/${table}.csv"
  if [[ ! -f "$csv_file" ]]; then
    continue  # Skip tables not in export (refresh_tokens, audit_log, etc.)
  fi

  row_count=$(( $(wc -l < "$csv_file") - 1 ))
  if [[ $row_count -le 0 ]]; then
    continue  # Skip empty tables
  fi

  cols=$(csv_columns "$csv_file")
  psql_exec <<SQL
SET session_replication_role = 'replica';
\\COPY ${table}($cols) FROM '$(realpath "$csv_file")' WITH (FORMAT csv, HEADER true);
SQL

  imported_count=$(( imported_count + 1 ))
  imported_rows=$(( imported_rows + row_count ))

  if [[ $row_count -gt 0 ]]; then
    echo "    $table: $row_count rows"
  fi
done

# -- Import portfolio_criterion_values ----------------------------------------
# tenant_id is NOT NULL since migration 1853560000000. Exports made before that
# migration have no tenant_id column, and 'replica' mode disables the trigger
# that would fill it, so stage the rows and resolve the tenant from the parent.
pcv_file="$EXPORT_DIR/portfolio_criterion_values.csv"
if [[ -f "$pcv_file" ]]; then
  row_count=$(( $(wc -l < "$pcv_file") - 1 ))
  if [[ $row_count -gt 0 ]]; then
    pcv_cols=$(csv_columns "$pcv_file")
    if [[ ",$pcv_cols," == *",tenant_id,"* ]]; then
      pcv_insert_cols="$pcv_cols"
    else
      pcv_insert_cols="$pcv_cols,tenant_id"
    fi
    psql_exec <<SQL
SET session_replication_role = 'replica';
CREATE TEMP TABLE _tmp_pcv AS SELECT * FROM portfolio_criterion_values WITH NO DATA;
ALTER TABLE _tmp_pcv ALTER COLUMN tenant_id DROP NOT NULL;
\\COPY _tmp_pcv($pcv_cols) FROM '$(realpath "$pcv_file")' WITH (FORMAT csv, HEADER true);
UPDATE _tmp_pcv t SET tenant_id = c.tenant_id
  FROM portfolio_criteria c WHERE c.id = t.criterion_id AND t.tenant_id IS NULL;
INSERT INTO portfolio_criterion_values($pcv_insert_cols) SELECT $pcv_insert_cols FROM _tmp_pcv;
DROP TABLE _tmp_pcv;
SQL
    imported_count=$(( imported_count + 1 ))
    imported_rows=$(( imported_rows + row_count ))
    echo "    portfolio_criterion_values: $row_count rows"
  fi
fi

# -- Re-enable FK triggers ---------------------------------------------------
psql_cmd -c "SET session_replication_role = 'origin'"

# ---------------------------------------------------------------------------
# Phase 3: Post-import fixes
# ---------------------------------------------------------------------------
echo ""
echo "Phase 3: Post-import fixes..."

# Reset subscription for on-prem
echo "  Resetting subscription to On-Prem..."
psql_cmd -c "
  UPDATE subscriptions SET
    plan_name = 'On-Prem',
    seat_limit = 1000,
    status = 'active',
    subscription_type = 'annual',
    payment_mode = 'card',
    stripe_customer_id = NULL,
    stripe_subscription_id = NULL,
    stripe_product_id = NULL,
    stripe_price_id = NULL,
    default_payment_method_id = NULL,
    default_payment_method_brand = NULL,
    default_payment_method_last4 = NULL
  WHERE tenant_id = '$SOURCE_TENANT_ID'
"

# Clear AI encrypted API key (bound to source encryption secret)
echo "  Clearing AI encrypted API key..."
psql_cmd -c "
  UPDATE ai_settings SET llm_api_key_encrypted = NULL
  WHERE tenant_id = '$SOURCE_TENANT_ID'
" 2>/dev/null || true

# Recalculate item_sequences
echo "  Recalculating item sequences..."
psql_cmd -c "
  DELETE FROM item_sequences WHERE tenant_id = '$SOURCE_TENANT_ID';
  INSERT INTO item_sequences (tenant_id, entity_type, next_val) VALUES
    ('$SOURCE_TENANT_ID', 'task',     (SELECT COALESCE(MAX(item_number), 0) + 1 FROM tasks WHERE tenant_id = '$SOURCE_TENANT_ID')),
    ('$SOURCE_TENANT_ID', 'project',  (SELECT COALESCE(MAX(item_number), 0) + 1 FROM portfolio_projects WHERE tenant_id = '$SOURCE_TENANT_ID')),
    ('$SOURCE_TENANT_ID', 'request',  (SELECT COALESCE(MAX(item_number), 0) + 1 FROM portfolio_requests WHERE tenant_id = '$SOURCE_TENANT_ID')),
    ('$SOURCE_TENANT_ID', 'document', (SELECT COALESCE(MAX(item_number), 0) + 1 FROM documents WHERE tenant_id = '$SOURCE_TENANT_ID'));
"

# Recount active seats
echo "  Recounting active seats..."
psql_cmd -c "
  UPDATE subscriptions SET active_seats = (
    SELECT COUNT(*) FROM users WHERE tenant_id = '$SOURCE_TENANT_ID' AND status = 'enabled'
  ) WHERE tenant_id = '$SOURCE_TENANT_ID'
"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "=========================================="
echo "Import complete"
echo "=========================================="
echo "Tenant:        $SOURCE_SLUG -> $DEST_SLUG ($SOURCE_TENANT_ID)"
echo "Tables:        $imported_count"
echo "Total rows:    $imported_rows"
echo ""
echo "Post-import checklist:"
echo "  1. Update .env BEFORE starting the application:"
echo "     - DEFAULT_TENANT_SLUG=$DEST_SLUG"
echo "     - ADMIN_EMAIL: unset or set to an existing imported user's email"
echo "     - ADMIN_PASSWORD: remove or leave empty"
echo "     - AI_SETTINGS_ENCRYPTION_SECRET: set a new value (AI API key"
echo "       must be re-entered in admin UI after first login)"
echo ""
echo "  2. Transfer S3 files (if not done already):"
echo "     # Download from cloud:"
echo "     aws s3 sync s3://cio-prod/files/$SOURCE_TENANT_ID/ ./s3-export/files/$SOURCE_TENANT_ID/"
echo "     # Upload to on-prem MinIO:"
echo "     mc alias set onprem http://<minio-host>:9000 <access-key> <secret-key>"
echo "     mc cp --recursive ./s3-export/files/$SOURCE_TENANT_ID/ onprem/kanap-files/files/$SOURCE_TENANT_ID/"
echo ""
echo "  3. Start the application:"
echo "     docker compose -f infra/compose.onprem.yml up -d"
echo ""
echo "  4. Verify:"
echo "     - Login with an existing user's credentials"
echo "     - Check applications, projects, documents"
echo "     - Download an attachment (verifies S3 sync)"
echo "     - Create a new task (verifies item_number sequence)"
echo "     - Re-enter AI API key in Admin > AI Settings (if used)"
