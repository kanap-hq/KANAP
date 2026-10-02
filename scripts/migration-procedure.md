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

The export script is **read-only**. It runs `SELECT` queries and `\COPY TO STDOUT`
against the cloud database. It does not modify any data.

It uses the application database role (not superuser) and sets the
`app.current_tenant` GUC to pass RLS policies.

Output: a directory of CSV files (one per table) + `export-metadata.json`.

### 2a. Run the export on the cloud server

```bash
$CLOUD_SSH "$CLOUD_SCRIPTS/tenant-export.sh \
  '$CLOUD_DB_URL' \
  $TENANT_SLUG \
  $CLOUD_EXPORT_DIR"
```

Optional flags:
- `--include-audit` — include the `audit_log` table (can be large)
- `--exclude-ai` — exclude AI conversations, messages, keys, settings

The script prints a summary at the end with tenant name, table count, total
rows, and output directory.

### 2b. Transfer the export directory to the on-prem server

```bash
mkdir -p "$LOCAL_EXPORT_DIR"
scp -r "<user>@<cloud-server-ip>:${CLOUD_EXPORT_DIR}/*" "$LOCAL_EXPORT_DIR/"
```

### 2c. Verify the transfer

```bash
ls "$LOCAL_EXPORT_DIR/" | wc -l        # Should match the number of tables + 1 (metadata)
cat "$LOCAL_EXPORT_DIR/export-metadata.json"
```

---

## Phase 3 — Transfer S3 files

Attachments, documents, branding assets, and other uploaded files are stored
in S3 under the path: `files/<tenant_id>/`.

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
```

---

## Phase 4 — Import tenant data on-prem

The import script **must be run as the postgres superuser**. The application
database role (kanap) has Row Level Security and cannot bulk-import data.

The import performs three phases internally:
1. Purges the existing default tenant data
2. Imports all CSV data (with FK triggers disabled)
3. Post-import fixes (subscription, sequences, budget totals, seat count)

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

The script will prompt: `"Is the application stopped? [y/N]"` — answer `y`.

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
| `AI_SETTINGS_ENCRYPTION_SECRET` | Any new value | The cloud encryption secret is not transferred. The AI API key is cleared during import. Re-enter it in Admin > AI Settings after first login. |
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

### 6c. Attachments (S3 files)

Download an attachment from any entity (application, project, task). If it
downloads correctly, the S3 mirror worked. If it fails, verify the mc mirror
completed and the bucket path matches.

### 6d. Sequences

- Create a new task — it should get the next `item_number` in sequence.
- Create a new project request — same check.

### 6e. AI (if enabled)

Go to Admin > AI Settings and enter a new API key. Test the AI chat.

### 6f. Row count verification (optional)

Compare row counts between the export metadata and the local database:

```bash
TENANT_ID=$(grep '"tenant_id"' "$LOCAL_EXPORT_DIR/export-metadata.json" \
  | sed 's/.*: *"\([^"]*\)".*/\1/')
sudo -u postgres psql -d "$ONPREM_DB_NAME" --no-psqlrc -t -A -c "
  SELECT 'applications', count(*) FROM applications WHERE tenant_id = '$TENANT_ID'
  UNION ALL
  SELECT 'users', count(*) FROM users WHERE tenant_id = '$TENANT_ID'
  UNION ALL
  SELECT 'assets', count(*) FROM assets WHERE tenant_id = '$TENANT_ID'
  UNION ALL
  SELECT 'documents', count(*) FROM documents WHERE tenant_id = '$TENANT_ID'
  UNION ALL
  SELECT 'portfolio_projects', count(*) FROM portfolio_projects WHERE tenant_id = '$TENANT_ID'
  UNION ALL
  SELECT 'spend_items', count(*) FROM spend_items WHERE tenant_id = '$TENANT_ID'
  ORDER BY 1
"
```

> **Note:** Row counts from the export metadata may be slightly higher than the
> actual COPY row counts. The metadata uses `wc -l` on CSV files, and text fields
> with embedded newlines (e.g. rich-text descriptions) inflate the line count.
> This is expected and not a data loss issue.

---

## Notes

### Re-running the migration

The import script is idempotent: it purges the destination tenant before
importing. You can safely re-run Phases 2–5 to pick up newer data from cloud.

### SSO / Entra ID

If the cloud tenant used Entra ID (Azure AD) for SSO, the on-prem installation
will need its own Entra app registration with the correct redirect URI pointing
to the on-prem URL. Configure `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET`, and
`ENTRA_REDIRECT_URI` in `.env`.

### What is NOT migrated

| Data | Reason |
|---|---|
| `refresh_tokens` | Session tokens are not portable. Users must log in again. |
| `audit_log` | Excluded by default (use `--include-audit` on export to include). |
| Stripe billing data | Subscription is reset to On-Prem with no Stripe link. |
| AI encrypted API key | Cleared during import (tied to source encryption secret). Must be re-entered in Admin > AI Settings. |
| Email configuration | Cloud email API key is not transferred. Configure separately in `.env` if email is needed on-prem. |
