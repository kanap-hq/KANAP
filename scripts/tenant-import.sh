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
# Everything runs in one transaction: removing the destination tenant, loading
# the files, the checks and the post-import fixes. If any step fails, nothing
# is changed and the destination tenant stays as it was.
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

UUID_PATTERN='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
psql_cmd() {
  psql -d "$DB_NAME" --no-psqlrc --tuples-only --no-align -v ON_ERROR_STOP=1 "$@"
}

psql_exec() {
  psql -d "$DB_NAME" --no-psqlrc "$@"
}

# Read the CSV header and return it as a comma-separated list of quoted column
# names, e.g. "id","name","tenant_id", for use in \copy table(...) FROM ...
csv_columns() {
  head -1 "$1" | sed 's/"//g; s/[^,][^,]*/"&"/g'
}

# Tables with a tenant_id column, parents before children: each table comes
# after every table its foreign keys point to. The order is read from the
# destination schema (pg_constraint), so a new table needs no edit here.
# Tables on a foreign key cycle (no order satisfies every key) come last.
# The load runs with foreign key checks off and checks every key once at the
# end, so the order keeps the load readable; it is not needed for correctness.
tenant_tables_in_fk_order() {
  psql_cmd <<'SQL'
WITH RECURSIVE
tbl AS (
  SELECT c.oid, c.relname FROM pg_class c
  WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
),
edge AS (
  SELECT DISTINCT k.conrelid AS child, k.confrelid AS parent
  FROM pg_constraint k
  JOIN tbl ch ON ch.oid = k.conrelid
  JOIN tbl pa ON pa.oid = k.confrelid
  WHERE k.contype = 'f' AND k.conrelid <> k.confrelid
),
-- Longest foreign key path from a table to a root, bounded by the table count
-- so a cycle ends.
lvl(oid, depth) AS (
  SELECT oid, 0 FROM tbl
  UNION
  SELECT e.child, l.depth + 1 FROM lvl l JOIN edge e ON e.parent = l.oid
  WHERE l.depth < (SELECT count(*) FROM tbl)
)
SELECT t.relname
FROM lvl l
JOIN tbl t ON t.oid = l.oid
WHERE EXISTS (
  SELECT 1 FROM pg_attribute a
  WHERE a.attrelid = t.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
)
GROUP BY t.relname
ORDER BY max(l.depth), t.relname
SQL
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
if [[ ! "$SOURCE_TENANT_ID" =~ $UUID_PATTERN ]]; then
  echo "ERROR: tenant_id in $METADATA_FILE is not a UUID."
  exit 1
fi
SOURCE_SLUG=$(grep '"tenant_slug"' "$METADATA_FILE" | sed 's/.*: *"\([^"]*\)".*/\1/')
EXPORT_MIGRATION=$(grep '"latest_migration"' "$METADATA_FILE" | sed 's/.*: *"\([^"]*\)".*/\1/')

echo "Source tenant: $SOURCE_SLUG ($SOURCE_TENANT_ID)"
echo "Export schema: $EXPORT_MIGRATION"
echo "Destination slug: $DEST_SLUG"

# Exports made by the current tenant-export.sh list their stored files
# (storage_key_count) and carry the exact row count of every table. Earlier
# exports leave out tables (incidents, interface mappings and more) and cannot
# be checked, so they are refused.
if ! grep -q '"storage_key_count"' "$METADATA_FILE"; then
  echo ""
  echo "ERROR: this export was made by an earlier version of tenant-export.sh."
  echo "  It leaves out part of the tenant's data and carries no exact row counts."
  echo "  Export the tenant again with the current tenant-export.sh, then import that export."
  exit 1
fi

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
# Validate: the files to load
#
# Only the tables listed in row_counts of the metadata are loaded, each from
# its CSV file. Any other CSV file in the directory is left aside.
# ---------------------------------------------------------------------------
GLOBAL_TABLES=( account_classifications spread_profiles )

mapfile -t TABLE_ORDER < <(tenant_tables_in_fk_order)
if [[ ${#TABLE_ORDER[@]} -eq 0 ]]; then
  echo "ERROR: no tenant table found in database $DB_NAME."
  exit 1
fi
declare -A IS_TENANT_TABLE=()
for table in "${TABLE_ORDER[@]}"; do
  IS_TENANT_TABLE[$table]=1
done

declare -A EXPECTED=()
while IFS=: read -r table expected; do
  [[ -n "$table" ]] || continue
  if [[ ! "$table" =~ ^[a-z][a-z0-9_]*$ || ! "$expected" =~ ^[0-9]+$ ]]; then
    echo "ERROR: unreadable row count in $METADATA_FILE: $table:$expected"
    exit 1
  fi
  EXPECTED[$table]=$expected
done < <(grep -o '"row_counts": {.*}' "$METADATA_FILE" | sed 's/^"row_counts": {//; s/}$//' | tr ',' '\n' | tr -d '" ')

if [[ ${#EXPECTED[@]} -eq 0 ]]; then
  echo "ERROR: $METADATA_FILE lists no table (row_counts)."
  exit 1
fi

errors=()
for table in "${!EXPECTED[@]}"; do
  case " ${GLOBAL_TABLES[*]} " in *" $table "*) continue ;; esac
  if [[ -z "${IS_TENANT_TABLE[$table]:-}" ]]; then
    errors+=("$table is listed in the export but is not a tenant table of database $DB_NAME")
  fi
done
for table in tenants "${!EXPECTED[@]}"; do
  if [[ ! -f "$EXPORT_DIR/${table}.csv" ]]; then
    errors+=("${table}.csv is missing from $EXPORT_DIR")
  fi
done
if [[ ${#errors[@]} -gt 0 ]]; then
  echo ""
  echo "ERROR: the export directory does not match its metadata. Nothing was changed."
  printf '  %s\n' "${errors[@]}"
  exit 1
fi

for csv_file in "$EXPORT_DIR"/*.csv; do
  name=$(basename "$csv_file" .csv)
  case "$name" in tenants|storage-keys) continue ;; esac
  if [[ -z "${EXPECTED[$name]:-}" ]]; then
    echo "  ignored: ${name}.csv (not listed in export-metadata.json)"
  fi
done

# ---------------------------------------------------------------------------
# Confirm: application stopped, tenant to replace
# ---------------------------------------------------------------------------
DEST_TENANT_ID=$(psql_cmd -v slug="$DEST_SLUG" <<'SQL' | tr -d '[:space:]'
SELECT id FROM tenants WHERE slug = :'slug' AND deleted_at IS NULL LIMIT 1
SQL
)
if [[ -n "$DEST_TENANT_ID" && ! "$DEST_TENANT_ID" =~ $UUID_PATTERN ]]; then
  echo "ERROR: unexpected id for tenant '$DEST_SLUG': $DEST_TENANT_ID"
  exit 1
fi

echo ""
echo "IMPORTANT: The KANAP application must be stopped before importing."
echo "  docker compose -f infra/compose.onprem.yml down"
echo ""
read -r -p "Is the application stopped? [y/N] " confirm
if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
  echo "Aborted. Stop the application first."
  exit 1
fi

if [[ -n "$DEST_TENANT_ID" ]]; then
  DEST_TENANT_NAME=$(psql_cmd -c "SELECT name FROM tenants WHERE id = '$DEST_TENANT_ID'")
  DEST_USER_COUNT=$(psql_cmd -c "SELECT count(*) FROM users WHERE tenant_id = '$DEST_TENANT_ID'")
  echo ""
  echo "The import replaces this tenant of database $DB_NAME, with all its data:"
  echo "  slug:  $DEST_SLUG"
  echo "  name:  $DEST_TENANT_NAME"
  echo "  id:    $DEST_TENANT_ID"
  echo "  users: $DEST_USER_COUNT"
  echo ""
  read -r -p "Type the slug '$DEST_SLUG' to replace it: " typed_slug
  if [[ "$typed_slug" != "$DEST_SLUG" ]]; then
    echo "Aborted. Nothing was changed."
    exit 1
  fi
else
  echo "  No existing tenant '$DEST_SLUG': the tenant is added."
fi

# ---------------------------------------------------------------------------
# Build the import: one transaction
#
# 1. Remove the destination tenant, with foreign key checks and triggers off
#    (session_replication_role = replica).
# 2. Load the files listed in the metadata.
# 3. Check: each table gained exactly the exported number of rows, every
#    loaded row belongs to the exported tenant, and no row points to a missing
#    row (every foreign key that touches a tenant table).
# 4. Back to normal mode, post-import fixes: subscription, values encrypted
#    with the source secret, item counters, budget totals, search index, seats.
# 5. Commit. Any error before the commit rolls everything back.
#
# \copy reads relative to the current directory, so psql runs from the export
# directory.
# ---------------------------------------------------------------------------
import_sql="\\set ON_ERROR_STOP on
BEGIN;
SET LOCAL session_replication_role = 'replica';
"

# -- 1. Remove the destination tenant -----------------------------------------
if [[ -n "$DEST_TENANT_ID" ]]; then
  for (( i=${#TABLE_ORDER[@]}-1; i>=0; i-- )); do
    import_sql+="DELETE FROM ${TABLE_ORDER[$i]} WHERE tenant_id = '$DEST_TENANT_ID';
"
  done
  import_sql+="DELETE FROM tenants WHERE id = '$DEST_TENANT_ID';
"
fi

# -- Rows per table before the load -------------------------------------------
expected_values=""
for table in "${!EXPECTED[@]}"; do
  case " ${GLOBAL_TABLES[*]} " in *" $table "*) continue ;; esac
  expected_values+="${expected_values:+,}('${table}', ${EXPECTED[$table]})"
done
if [[ -z "$expected_values" ]]; then
  echo "ERROR: $METADATA_FILE lists no tenant table (row_counts). Nothing was changed."
  exit 1
fi
import_sql+="CREATE TEMP TABLE _import_counts (tbl text PRIMARY KEY, expected bigint NOT NULL, before bigint) ON COMMIT DROP;
INSERT INTO _import_counts (tbl, expected) VALUES ${expected_values};
DO \$\$
DECLARE
  r record;
  n bigint;
BEGIN
  FOR r IN SELECT tbl FROM _import_counts LOOP
    EXECUTE format('SELECT count(*) FROM %I', r.tbl) INTO n;
    UPDATE _import_counts SET before = n WHERE tbl = r.tbl;
  END LOOP;
END
\$\$;
"

COPY_LABELS=()   # one per \copy, in order: psql prints "COPY <rows>" for each

# -- 2a. Global reference tables (ON CONFLICT DO NOTHING) ---------------------
for table in "${GLOBAL_TABLES[@]}"; do
  if [[ -z "${EXPECTED[$table]:-}" ]]; then
    continue
  fi
  cols=$(csv_columns "$EXPORT_DIR/${table}.csv")
  import_sql+="CREATE TEMP TABLE _tmp_${table} (LIKE ${table} INCLUDING ALL) ON COMMIT DROP;
\\copy _tmp_${table}($cols) FROM '${table}.csv' WITH (FORMAT csv, HEADER true)
INSERT INTO ${table}($cols) SELECT $cols FROM _tmp_${table} ON CONFLICT DO NOTHING;
"
  COPY_LABELS+=("global:$table")
done

# -- 2b. Tenant row (with transformations) ------------------------------------
tenant_cols=$(csv_columns "$EXPORT_DIR/tenants.csv")
import_sql+="CREATE TEMP TABLE _tmp_tenant (LIKE tenants INCLUDING ALL) ON COMMIT DROP;
\\copy _tmp_tenant($tenant_cols) FROM 'tenants.csv' WITH (FORMAT csv, HEADER true)
DO \$\$
BEGIN
  IF (SELECT count(*) FROM _tmp_tenant) <> 1
     OR NOT EXISTS (SELECT 1 FROM _tmp_tenant WHERE id = '${SOURCE_TENANT_ID}'::uuid) THEN
    RAISE EXCEPTION 'tenants.csv must hold exactly one row, the tenant ${SOURCE_TENANT_ID} named in export-metadata.json';
  END IF;
END
\$\$;
UPDATE _tmp_tenant SET
  slug = :'dest_slug',
  stripe_customer_id = NULL,
  billing_email = NULL,
  billing_company_name = NULL,
  billing_phone = NULL,
  billing_tax_id = NULL,
  billing_address = NULL,
  billing_customer_info = NULL,
  billing_invoice_info = NULL;
INSERT INTO tenants($tenant_cols) SELECT $tenant_cols FROM _tmp_tenant;
"
COPY_LABELS+=("tenants")

# -- 2c. Tenant tables listed in the metadata, parents first ------------------
for table in "${TABLE_ORDER[@]}"; do
  if [[ -z "${EXPECTED[$table]:-}" ]]; then
    continue  # Not in the export (excluded tables, audit_log without --include-audit, ...)
  fi
  cols=$(csv_columns "$EXPORT_DIR/${table}.csv")
  import_sql+="\\copy ${table}($cols) FROM '${table}.csv' WITH (FORMAT csv, HEADER true)
"
  COPY_LABELS+=("$table")
done

# -- 3a. Row counts and tenant of the loaded rows -----------------------------
# Each table must have gained exactly the exported number of rows, and every
# row of the exported tenant in it must be one of them: a row carrying another
# tenant_id (or none) makes the counts differ. The global reference tables are
# merged with the rows already here and are not compared.
import_sql+="DO \$\$
DECLARE
  r record;
  total bigint;
  own bigint;
  loaded bigint;
  differences text := '';
BEGIN
  FOR r IN SELECT * FROM _import_counts ORDER BY tbl LOOP
    EXECUTE format('SELECT count(*), count(*) FILTER (WHERE tenant_id = \$1) FROM %I', r.tbl)
      INTO total, own USING '${SOURCE_TENANT_ID}'::uuid;
    loaded := total - r.before;
    IF loaded <> r.expected THEN
      differences := differences || format(E'\\n  %s: exported %s rows, loaded %s', r.tbl, r.expected, loaded);
    END IF;
    IF own < loaded THEN
      differences := differences || format(E'\\n  %s: %s of the %s loaded rows do not carry tenant_id ${SOURCE_TENANT_ID}', r.tbl, loaded - own, loaded);
    ELSIF own > loaded THEN
      differences := differences || format(E'\\n  %s: %s rows of tenant ${SOURCE_TENANT_ID} were already in this database', r.tbl, own - loaded);
    END IF;
  END LOOP;
  IF differences <> '' THEN
    RAISE EXCEPTION 'The loaded rows do not match the export metadata (every row must belong to the exported tenant):%', differences;
  END IF;
END
\$\$;
"

# -- 3b. Foreign keys ---------------------------------------------------------
# Checks were off during the load, so every foreign key that starts or ends at
# a tenant table (or at tenants and the global reference tables) is checked
# here, on the whole child table: a row whose key points to no row fails the
# import. A loaded row whose parent belongs to another tenant fails it too.
import_sql+="DO \$\$
DECLARE
  k record;
  join_cond text;
  not_null text;
  n bigint;
  problems text := '';
BEGIN
  FOR k IN
    WITH touched AS (
      SELECT a.attrelid AS oid FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
        AND a.attname = 'tenant_id' AND NOT a.attisdropped
      UNION SELECT 'tenants'::regclass::oid
      UNION SELECT 'account_classifications'::regclass::oid
      UNION SELECT 'spread_profiles'::regclass::oid
    )
    SELECT con.conname, con.conrelid, con.confrelid, con.conkey, con.confkey,
           EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = con.conrelid AND a.attname = 'tenant_id' AND NOT a.attisdropped)
             AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = con.confrelid AND a.attname = 'tenant_id' AND NOT a.attisdropped)
             AS both_tenant
    FROM pg_constraint con
    WHERE con.contype = 'f' AND con.conparentid = 0
      AND (con.conrelid IN (SELECT oid FROM touched) OR con.confrelid IN (SELECT oid FROM touched))
    ORDER BY con.conname
  LOOP
    SELECT string_agg(format('p.%I = ch.%I', pa.attname, ca.attname), ' AND ' ORDER BY u.i),
           string_agg(format('ch.%I IS NOT NULL', ca.attname), ' AND ' ORDER BY u.i)
      INTO join_cond, not_null
    FROM unnest(k.conkey, k.confkey) WITH ORDINALITY AS u(child_col, parent_col, i)
    JOIN pg_attribute ca ON ca.attrelid = k.conrelid AND ca.attnum = u.child_col
    JOIN pg_attribute pa ON pa.attrelid = k.confrelid AND pa.attnum = u.parent_col;

    EXECUTE format('SELECT count(*) FROM %s ch WHERE %s AND NOT EXISTS (SELECT 1 FROM %s p WHERE %s)',
                   k.conrelid::regclass, not_null, k.confrelid::regclass, join_cond) INTO n;
    IF n > 0 THEN
      problems := problems || format(E'\\n  %s: %s rows of %s point to no row of %s',
                                     k.conname, n, k.conrelid::regclass, k.confrelid::regclass);
    END IF;

    IF k.both_tenant THEN
      EXECUTE format('SELECT count(*) FROM %s ch JOIN %s p ON %s WHERE ch.tenant_id = \$1 AND p.tenant_id IS NOT NULL AND p.tenant_id <> ch.tenant_id',
                     k.conrelid::regclass, k.confrelid::regclass, join_cond)
        INTO n USING '${SOURCE_TENANT_ID}'::uuid;
      IF n > 0 THEN
        problems := problems || format(E'\\n  %s: %s rows of %s point to a row of %s of another tenant',
                                       k.conname, n, k.conrelid::regclass, k.confrelid::regclass);
      END IF;
    END IF;
  END LOOP;
  IF problems <> '' THEN
    RAISE EXCEPTION 'Rows point to missing rows or to rows of another tenant:%', problems;
  END IF;
END
\$\$;
"

# -- 4. Post-import fixes, back in normal mode --------------------------------
import_sql+="SET LOCAL session_replication_role = 'origin';
"

# Reset subscription for on-prem
import_sql+="UPDATE subscriptions SET
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
WHERE tenant_id = '$SOURCE_TENANT_ID';
"

# Clear the values encrypted with the source installation's secret
# (AI_SETTINGS_ENCRYPTION_SECRET is not transferred): an administrator enters
# them again after the first login. These are every value AiSecretCipherService
# writes to a tenant table (platform_ai_config is a platform table, not exported).
# ai_external_mcp_servers takes the same credential references; its check
# constraint refuses the encrypted kind today, and the update keeps it covered
# if that changes.
import_sql+="UPDATE ai_settings SET
  llm_api_key_encrypted = NULL,
  glpi_user_token_encrypted = NULL,
  glpi_app_token_encrypted = NULL
WHERE tenant_id = '$SOURCE_TENANT_ID';
UPDATE ai_model_configs SET api_key_encrypted = NULL
WHERE tenant_id = '$SOURCE_TENANT_ID' AND api_key_encrypted IS NOT NULL;
UPDATE ai_adapter_configs SET credential_ref_json = NULL
WHERE tenant_id = '$SOURCE_TENANT_ID' AND credential_ref_json->>'kind' = 'encrypted';
UPDATE ai_external_mcp_servers SET credential_ref_json = NULL
WHERE tenant_id = '$SOURCE_TENANT_ID' AND credential_ref_json->>'kind' = 'encrypted';
"

# Item counters: the exported item_sequences rows are kept (they come from the
# same snapshot as the data). As a guard, a counter lower than the highest
# number in use is raised past it, for each of the 13 kinds the
# item_sequences_entity_type_check constraint allows: 8 item numbers
# (ItemNumberService) and 5 text references filled by the assign_*_reference
# and assign_application_sequential_id triggers (APP-n, AST-n, LOC-n, CONN-n,
# INT-n). A reference edited by hand that does not end in its prefix and a
# number is left aside.
import_sql+="INSERT INTO item_sequences (tenant_id, entity_type, next_val)
SELECT '$SOURCE_TENANT_ID', s.entity_type, s.next_val FROM (
  SELECT 'task' AS entity_type, MAX(item_number) + 1 AS next_val FROM tasks WHERE tenant_id = '$SOURCE_TENANT_ID'
  UNION ALL SELECT 'project', MAX(item_number) + 1 FROM portfolio_projects WHERE tenant_id = '$SOURCE_TENANT_ID'
  UNION ALL SELECT 'request', MAX(item_number) + 1 FROM portfolio_requests WHERE tenant_id = '$SOURCE_TENANT_ID'
  UNION ALL SELECT 'document', MAX(item_number) + 1 FROM documents WHERE tenant_id = '$SOURCE_TENANT_ID'
  UNION ALL SELECT 'incident', MAX(item_number) + 1 FROM incidents WHERE tenant_id = '$SOURCE_TENANT_ID'
  UNION ALL SELECT 'spend', MAX(item_number) + 1 FROM spend_items WHERE tenant_id = '$SOURCE_TENANT_ID'
  UNION ALL SELECT 'capex', MAX(item_number) + 1 FROM capex_items WHERE tenant_id = '$SOURCE_TENANT_ID'
  UNION ALL SELECT 'contributor', MAX(item_number) + 1 FROM portfolio_team_member_configs WHERE tenant_id = '$SOURCE_TENANT_ID'
  UNION ALL SELECT 'application', MAX(substring(sequential_id FROM '^APP-([0-9]{1,9})\$')::int) + 1 FROM applications WHERE tenant_id = '$SOURCE_TENANT_ID'
  UNION ALL SELECT 'asset', MAX(substring(asset_reference FROM '^AST-([0-9]{1,9})\$')::int) + 1 FROM assets WHERE tenant_id = '$SOURCE_TENANT_ID'
  UNION ALL SELECT 'location', MAX(substring(location_reference FROM '^LOC-([0-9]{1,9})\$')::int) + 1 FROM locations WHERE tenant_id = '$SOURCE_TENANT_ID'
  UNION ALL SELECT 'connection', MAX(substring(connection_reference FROM '^CONN-([0-9]{1,9})\$')::int) + 1 FROM connections WHERE tenant_id = '$SOURCE_TENANT_ID'
  UNION ALL SELECT 'interface', MAX(substring(interface_reference FROM '^INT-([0-9]{1,9})\$')::int) + 1 FROM interfaces WHERE tenant_id = '$SOURCE_TENANT_ID'
) s
WHERE s.next_val IS NOT NULL
ON CONFLICT (tenant_id, entity_type)
DO UPDATE SET next_val = GREATEST(item_sequences.next_val, EXCLUDED.next_val);
"

# Rebuild the derived budget totals: they are not exported, and the triggers
# that keep them were off while the amounts were loaded (replica mode).
# ANALYZE first: the rebuild plans from these tables, and a load with the
# triggers off leaves their statistics stale (budget-import-statistics.ts).
# ANALYZE inside the transaction counts the rows it has loaded.
import_sql+="ANALYZE spend_items, spend_versions, spend_amounts, spend_round_inputs, spend_version_totals, capex_items, capex_versions, capex_amounts, capex_round_inputs, capex_version_totals;
SELECT count(*) AS budget_versions_rebuilt FROM budget_version_totals_rebuild('$SOURCE_TENANT_ID');
"

# Recount active seats
import_sql+="UPDATE subscriptions SET active_seats = (
  SELECT COUNT(*) FROM users WHERE tenant_id = '$SOURCE_TENANT_ID' AND status = 'enabled'
) WHERE tenant_id = '$SOURCE_TENANT_ID';
"

# Rebuild the search index: it is not exported, and the triggers that keep it
# were off while the rows were loaded (replica mode). Same functions as the
# daily reindex (search_index_refresh_<type>). Last, because it sets the
# tenant context until the commit.
import_sql+="DO \$\$
DECLARE
  f text;
BEGIN
  PERFORM set_config('app.current_tenant', '$SOURCE_TENANT_ID', true);
  FOR f IN
    SELECT p.proname FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'search\\_index\\_refresh\\_%'
    ORDER BY 1
  LOOP
    EXECUTE format('SELECT %I(\$1, NULL)', f) USING '$SOURCE_TENANT_ID'::uuid;
  END LOOP;
END
\$\$;
COMMIT;
"

# ---------------------------------------------------------------------------
# Run the import
# ---------------------------------------------------------------------------
echo ""
echo "Importing (one transaction: replace, load, check, post-import fixes)..."

if ! import_output=$(cd "$EXPORT_DIR" && psql_exec -v dest_slug="$DEST_SLUG" <<<"$import_sql"); then
  echo ""
  echo "ERROR: the import stopped on the error above and was rolled back."
  echo "  Nothing was changed: database $DB_NAME is exactly as it was before the import."
  if [[ -n "$DEST_TENANT_ID" ]]; then
    echo "  The tenant '$DEST_SLUG' ($DEST_TENANT_ID) is still in place."
  fi
  exit 1
fi

mapfile -t COPY_COUNTS < <(sed -n 's/^COPY \([0-9][0-9]*\)$/\1/p' <<<"$import_output")
if [[ ${#COPY_COUNTS[@]} -ne ${#COPY_LABELS[@]} ]]; then
  echo "ERROR: expected ${#COPY_LABELS[@]} COPY results, got ${#COPY_COUNTS[@]}."
  exit 1
fi
if ! grep -qx 'COMMIT' <<<"$import_output"; then
  echo "ERROR: the import transaction did not commit."
  exit 1
fi

if [[ -n "$DEST_TENANT_ID" ]]; then
  echo "  Replaced tenant '$DEST_SLUG' ($DEST_TENANT_ID)."
fi
imported_count=0
imported_rows=0
for i in "${!COPY_LABELS[@]}"; do
  label="${COPY_LABELS[$i]}"
  rows="${COPY_COUNTS[$i]}"
  table="${label#global:}"
  if [[ "$label" == "tenants" || "$label" == global:* ]]; then
    echo "    $table: done"
    continue
  fi
  imported_count=$(( imported_count + 1 ))
  imported_rows=$(( imported_rows + rows ))
  if [[ $rows -gt 0 ]]; then
    echo "    $table: $rows rows"
  fi
done
echo "    tenant '$SOURCE_SLUG' imported as '$DEST_SLUG'"
echo "  Row counts match the export metadata and every row belongs to the tenant."
echo "  Every foreign key holds."
echo "  Post-import fixes done: subscription reset to On-Prem, encrypted values"
echo "  cleared, item counters checked, budget totals and search index rebuilt,"
echo "  active seats recounted."

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
echo "     - AI_SETTINGS_ENCRYPTION_SECRET: set a new value (AI API keys, model"
echo "       keys, GLPI tokens and PRTG/Netbox credentials were cleared: enter"
echo "       them again in the admin UI after first login)"
echo ""
echo "  2. Transfer the stored files (if not done already): storage-keys.csv in"
echo "     the export lists every key, all under files/$SOURCE_TENANT_ID/. Indicative commands:"
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
echo "     - Check applications, projects, documents, incidents, interface mappings"
echo "     - Download an attachment (verifies S3 sync)"
echo "     - Create a new task and a new incident (verifies item_number sequences)"
echo "     - Re-enter AI API key in Admin > AI Settings (if used)"
