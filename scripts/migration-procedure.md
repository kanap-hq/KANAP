# Cloud-to-On-Prem Tenant Migration Procedure

Step-by-step procedure for migrating a single tenant from the multi-tenant cloud
(SaaS) environment to a single-tenant on-premise installation.

## Prerequisites

- SSH access to the cloud production server
- A working on-prem KANAP installation (docker compose up, migrations applied,
  default tenant provisioned)
- The `mc` (MinIO Client) CLI installed on the on-prem server
- `psql` available on the cloud server
- `sudo` access to the `postgres` OS user on the on-prem server

## Variables

Adjust these for your environment before starting.

```bash
# Cloud (source)
CLOUD_SSH="ssh -i <cloud-ssh-key> <user>@<cloud-server-ip>"
CLOUD_SCRIPTS="/opt/kanap/scripts"
CLOUD_DB_URL="postgres://<db_user>:<db_password>@<db_host>:5432/<cloud_db_name>"
CLOUD_S3_ENDPOINT="https://<cloud-s3-endpoint>"
CLOUD_S3_BUCKET="<cloud-s3-bucket>"
CLOUD_S3_ACCESS_KEY="<cloud-s3-access-key>"
CLOUD_S3_SECRET_KEY="<cloud-s3-secret-key>"

# Tenant to migrate
TENANT_SLUG="<tenant-slug>"

# On-prem (destination)
ONPREM_DB_NAME="kanap"
ONPREM_KANAP_DIR="/opt/kanap"
ONPREM_S3_ENDPOINT="http://localhost:9000"
ONPREM_S3_BUCKET="kanap-files"
ONPREM_S3_ACCESS_KEY="<onprem-s3-access-key>"
ONPREM_S3_SECRET_KEY="<onprem-s3-secret-key>"

# Working directories
CLOUD_EXPORT_DIR="/tmp/export-${TENANT_SLUG}"
LOCAL_EXPORT_DIR="/tmp/export-${TENANT_SLUG}"
```

---

## Phase 1 — Pre-flight checks

Before starting, verify that both environments are on the same KANAP version.
The import script enforces this, but catching a mismatch early avoids wasted work.

### 1a. Check cloud schema version

```bash
$CLOUD_SSH "psql '$CLOUD_DB_URL' --no-psqlrc -t -A \
  -c \"SELECT name FROM migrations ORDER BY id DESC LIMIT 1\""
```

### 1b. Check on-prem schema version

```bash
sudo -u postgres psql -d "$ONPREM_DB_NAME" --no-psqlrc -t -A \
  -c "SELECT name FROM migrations ORDER BY id DESC LIMIT 1"
```

Both must print the same migration name. If they differ, update the on-prem
instance first:

```bash
cd $ONPREM_KANAP_DIR
git pull
docker compose -f infra/compose.onprem.yml build
docker compose -f infra/compose.onprem.yml up -d
# The API container runs migrations automatically on startup.
```

### 1c. Verify the tenant exists on cloud

```bash
$CLOUD_SSH "psql '$CLOUD_DB_URL' --no-psqlrc -t -A \
  -c \"SELECT slug, name, id FROM tenants WHERE deleted_at IS NULL ORDER BY created_at\""
```

---

## Phase 2 — Export tenant data from cloud

The export script is **read-only**. It reads every table with `\copy` in one
read-only transaction against the cloud database, so all the files describe the
same point in time. It does not modify any data.

It uses the application database role (not superuser) and sets the
`app.current_tenant` GUC to pass RLS policies.

It exports every tenant table (`TENANT_SCOPED_TABLES` in
`backend/src/common/tenant-isolation.inventory.ts`) except the ones in its
`EXCLUDED_TABLES` list, each with its reason (see "What is NOT migrated" below).
A CI spec (`tenant-export-coverage.spec.ts`) fails when a new tenant table is
neither exported nor excluded.

Output:
- one CSV file per table, plus `tenants.csv` (the tenant row) and the global
  reference tables `account_classifications.csv` and `spread_profiles.csv`;
- `storage-keys.csv`: the storage key of every stored file the tenant's rows
  point to (attachments of every kind and the branding logo), with the table
  and row it belongs to and its size;
- `export-metadata.json`: schema version, options, excluded tables, number of
  storage keys and the exact row count of each table.

The import loads only the tables listed in `export-metadata.json` and refuses
exports made by an earlier version of `tenant-export.sh` (they leave out part of
the data and carry no exact row counts): export again with the current script.

### 2a. Run the export on the cloud server

```bash
$CLOUD_SSH "$CLOUD_SCRIPTS/tenant-export.sh \
  '$CLOUD_DB_URL' \
  $TENANT_SLUG \
  $CLOUD_EXPORT_DIR"
```

Optional flags:
- `--include-audit` — include the `audit_log` table (can be large)
- `--exclude-ai`: exclude every AI table (`ai_*`: conversations, messages,
  keys, settings, agents and their runs, approvals and history)

The script prints a summary at the end with tenant name, table count, total
rows, number of stored files, and output directory.

### 2b. Transfer the export directory to the on-prem server

```bash
mkdir -p "$LOCAL_EXPORT_DIR"
scp -r "<user>@<cloud-server-ip>:${CLOUD_EXPORT_DIR}/*" "$LOCAL_EXPORT_DIR/"
```

### 2c. Verify the transfer

```bash
ls "$LOCAL_EXPORT_DIR/" | wc -l        # Tables in row_counts + 3 (tenants.csv, storage-keys.csv, metadata)
cat "$LOCAL_EXPORT_DIR/export-metadata.json"
```

---

## Phase 3 — Transfer S3 files

Attachments, documents, branding assets, and other uploaded files are stored
in S3 under the path: `files/<tenant_id>/`. The scripts do not copy them:
`storage-keys.csv` in the export lists every key the tenant's rows point to,
so you know what to copy and can check the copy. The commands below are
indicative; adapt them to your storage.

The `tenant_id` UUID is preserved during import (no remapping), so S3 paths
remain valid as-is.

### 3a. Read the tenant_id from the export metadata

```bash
TENANT_ID=$(grep '"tenant_id"' "$LOCAL_EXPORT_DIR/export-metadata.json" \
  | sed 's/.*: *"\([^"]*\)".*/\1/')
echo "Tenant ID: $TENANT_ID"
```

### 3b. Configure mc aliases

```bash
mc alias set cloudsrc "$CLOUD_S3_ENDPOINT" "$CLOUD_S3_ACCESS_KEY" "$CLOUD_S3_SECRET_KEY"
mc alias set onprem   "$ONPREM_S3_ENDPOINT" "$ONPREM_S3_ACCESS_KEY" "$ONPREM_S3_SECRET_KEY"
```

### 3c. Check the size of files to transfer

```bash
mc du "cloudsrc/${CLOUD_S3_BUCKET}/files/${TENANT_ID}/"
```

### 3d. Mirror files from cloud S3 to on-prem MinIO

`mc mirror` downloads from cloud and uploads to on-prem in a single pass.
This goes through the on-prem server's network — no intermediate storage is needed.

```bash
mc mirror \
  "cloudsrc/${CLOUD_S3_BUCKET}/files/${TENANT_ID}/" \
  "onprem/${ONPREM_S3_BUCKET}/files/${TENANT_ID}/"
```

### 3e. Verify the transfer

```bash
mc du "onprem/${ONPREM_S3_BUCKET}/files/${TENANT_ID}/"
# Object count and total size should match the cloud source.

# Every key the export lists must exist on-prem (third column of storage-keys.csv):
grep '"storage_key_count"' "$LOCAL_EXPORT_DIR/export-metadata.json"
tail -n +2 "$LOCAL_EXPORT_DIR/storage-keys.csv" | cut -d'"' -f6 | while read -r key; do
  mc stat "onprem/${ONPREM_S3_BUCKET}/${key}" > /dev/null 2>&1 || echo "missing: $key"
done
```

The bucket may also hold objects no row points to any more (files of deleted
items not cleaned yet): copying them is harmless.

---

## Phase 4 — Import tenant data on-prem

The import script **must be run as the postgres superuser**. The application
database role (kanap) has Row Level Security and cannot bulk-import data.

Everything runs in **one transaction**. If any step fails, the transaction is
rolled back and the database stays exactly as it was: the destination tenant
is still in place and you can fix the cause and run the import again.

1. Removes the destination tenant (`default`) and all its data, with foreign key
   checks and triggers off.
2. Loads the CSV files of the tables listed in `export-metadata.json`. Any
   other CSV file in the directory is left aside, with a line in the output.
3. Checks the result before anything is kept:
   - each table gained exactly the number of rows the export counted;
   - every loaded row belongs to the exported tenant (a row carrying another
     `tenant_id` fails the import);
   - every foreign key that touches a tenant table holds: a row pointing to a
     missing row, or to a row of another tenant, fails the import.
   On failure the script lists the tables or constraints concerned.
4. Post-import fixes, with triggers back on: subscription reset to On-Prem,
   encrypted keys cleared, item counters checked, budget totals and search
   index rebuilt, active seats recounted.
5. Commits.

The script reads the tenant tables from the destination schema (`pg_constraint`)
and loads each table after the tables it points to, so a new table needs no
change to the script. Four AI tables come last: `ai_action_requests`,
`ai_approvals` and `ai_tool_executions` point to each other, and `ai_evidence`
points into that cycle. Foreign key checks are off during the load and every key
is checked once at the end, so this order is not needed for correctness.

### 4a. Stop the application

```bash
cd "$ONPREM_KANAP_DIR"
docker compose -f infra/compose.onprem.yml down
```

### 4b. Ensure the export directory is readable by the postgres OS user

The import script runs as `postgres`, which may not have access to your home
directory.

```bash
sudo cp -r "$LOCAL_EXPORT_DIR" /tmp/export-import
sudo chown -R postgres:postgres /tmp/export-import
```

### 4c. Run the import

The third argument is the destination slug. Use `default` to match the on-prem
`DEFAULT_TENANT_SLUG`.

```bash
sudo -u postgres "$ONPREM_KANAP_DIR/scripts/tenant-import.sh" \
  "$ONPREM_DB_NAME" \
  /tmp/export-import \
  default
```

The script first checks the export directory against its metadata, then asks
two questions:
- `Is the application stopped? [y/N]`: answer `y`.
- It shows the tenant that will be replaced (slug, name, id, number of users)
  and asks you to type its slug (`default`) to confirm. Any other answer stops
  the script without changing anything.

### 4d. Clean up the temporary copy

```bash
sudo rm -rf /tmp/export-import
```

---

## Phase 5 — Configure and restart the application

After import, the `.env` file must be updated before the application starts.
The app's boot sequence provisions a tenant and admin user from `.env` — if the
values don't match an imported user, it may create duplicates or fail.

### 5a. Update .env

Required changes:

| Variable | Value | Reason |
|---|---|---|
| `ADMIN_EMAIL` | Email of an existing imported **local** user | This user is treated as the admin. Must be a user who can log in with email + password (not SSO-only). If the tenant uses Entra ID, domain users won't be able to authenticate until the on-prem Entra app registration is configured (see SSO / Entra ID section below). Pick a local account (e.g. a platform admin or service account) to ensure you can log in immediately after migration and complete the setup. |
| `ADMIN_PASSWORD` | *(empty)* | If set, the app resets the admin password on every boot, overwriting the imported hash. |
| `AI_SETTINGS_ENCRYPTION_SECRET` | Any new value | The cloud encryption secret is not transferred. The values encrypted with it are cleared during import: AI API key, model connection keys, GLPI tokens, PRTG and Netbox credentials. Re-enter them in the admin pages after first login. |
| `DEFAULT_TENANT_SLUG` | `default` | Should already be set. Must match the `destination_slug` used in Phase 4. |

> **Tip:** Run this query against the export to list candidate admin accounts — look
> for users whose email domain is *not* the tenant's SSO domain:
> ```bash
> grep -m5 '' "$LOCAL_EXPORT_DIR/users.csv" | head -1  # show columns
> # Then in the on-prem database after import:
> sudo -u postgres psql -d "$ONPREM_DB_NAME" --no-psqlrc -c "
>   SELECT email, first_name, last_name FROM users
>   WHERE tenant_id = '$TENANT_ID' AND status = 'enabled'
>     AND email NOT LIKE '%@<tenant-sso-domain>'
>   ORDER BY email
> "
> ```

### 5b. Start the application

```bash
docker compose -f infra/compose.onprem.yml up -d
```

### 5c. Wait for startup and check logs

```bash
docker logs infra-api-1 --tail 20
# Look for: "Nest application successfully started"
# No errors should appear.
```

### 5d. Health check

```bash
curl -s http://127.0.0.1:8080/health
# Expected: {"status":"ok"}
```

---

## Phase 6 — Verification

Log in to the application and verify the following.

### 6a. Authentication

Log in with an imported user's cloud credentials (email + password). The
password is the same as on the cloud — hashes are preserved.

### 6b. Data integrity spot checks

- Browse applications, assets, interfaces — counts should match cloud.
- Open a project with phases and milestones.
- Check spend items and capex items — verify amounts.
- Open a document — verify content renders.
- Open an incident and an interface mapping set.

### 6c. Attachments (S3 files)

Download an attachment from any entity (application, project, task). If it
downloads correctly, the S3 mirror worked. If it fails, verify the mc mirror
completed and the bucket path matches.

### 6d. Sequences

- Create a new task — it should get the next `item_number` in sequence.
- Create a new project request — same check.
- Create a new incident: same check.

### 6e. AI (if enabled)

Go to Admin > AI Settings and enter a new API key. Test the AI chat. Enter the
model connection keys and the GLPI, PRTG and Netbox credentials again where the
tenant used them.

### 6f. Row count verification (optional)

The import already stops when a table loads a different number of rows than the
export counted. To check again table by table, compare every count of the export
metadata with the on-prem database. Run it right after Phase 4, before the
application starts: once it runs, the application adds rows of its own (sessions,
audit entries, new item counters).

```bash
TENANT_ID=$(grep '"tenant_id"' "$LOCAL_EXPORT_DIR/export-metadata.json" \
  | sed 's/.*: *"\([^"]*\)".*/\1/')
grep -o '"row_counts": {.*}' "$LOCAL_EXPORT_DIR/export-metadata.json" \
  | grep -o '"[a-z0-9_]*":[0-9][0-9]*' | tr -d '"' \
  | while IFS=: read -r table expected; do
      case "$table" in account_classifications|spread_profiles) continue ;; esac
      actual=$(sudo -u postgres psql -d "$ONPREM_DB_NAME" --no-psqlrc -t -A \
        -c "SELECT count(*) FROM ${table} WHERE tenant_id = '$TENANT_ID'")
      [ "$actual" = "$expected" ] || echo "$table: exported $expected, on-prem $actual"
    done
# No output: every table matches.
```

The global reference tables (`account_classifications`, `spread_profiles`) are
merged with the rows the on-prem installation already has, so their counts are
not compared.

---

## Notes

### Re-running the migration

Each import replaces the destination tenant as a whole, so you can re-run
Phases 2 to 5 to pick up newer data from cloud. A failed import changes nothing:
fix the cause shown in the output and run it again.

### MCP API keys

The tenant's MCP API keys (`ai_api_keys`) are stored as hashes and keep working
on the on-prem installation. They also keep working on the cloud as long as the
tenant exists there: revoke them on the cloud after the move, or create new keys
on-prem.

### SSO / Entra ID

If the cloud tenant used Entra ID (Azure AD) for SSO, the on-prem installation
will need its own Entra app registration with the correct redirect URI pointing
to the on-prem URL. Configure `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET`, and
`ENTRA_REDIRECT_URI` in `.env`.

### What is NOT migrated

| Data | Reason |
|---|---|
| `refresh_tokens` | Session tokens are not portable. Users must log in again. |
| `password_reset_tokens` | Pending password links expire within hours and point to the cloud address. |
| `search_index` | Derived from the business tables: rebuilt by the import. |
| `spend_version_totals`, `capex_version_totals` | Sums of the budget amounts: rebuilt by the import. |
| `list_contexts` | Short-lived list states behind list links (purged after 90 days without use). An old list link opens the default list. |
| `notification_dedupe` | One-day window that stops a notification from being sent twice. |
| `audit_log` | Excluded by default (use `--include-audit` on export to include). |
| AI tables | Exported by default; `--exclude-ai` leaves out every `ai_*` table. |
| Stripe billing data | Subscription is reset to On-Prem with no Stripe link. |
| Encrypted keys and credentials | Cleared during import (tied to the source encryption secret): AI API key, model connection keys, GLPI tokens, PRTG and Netbox credentials. Must be re-entered in the admin pages. |
| Stored files | Not copied by the scripts: copy them as in Phase 3, using `storage-keys.csv`. |
| Email configuration | Cloud email API key is not transferred. Configure separately in `.env` if email is needed on-prem. |
