# On-Premise Configuration

This guide covers required and optional environment variables for on-prem deployments.
A full template is available at `infra/.env.onprem.example`.

## Required: Deployment Mode

| Variable | Description | Example |
|----------|-------------|---------|
| `DEPLOYMENT_MODE` | **Must be `single-tenant`** for on-prem deployments | `single-tenant` |

## Optional: Tenant Identity

| Variable              | Required | Default           | Description                                                     |
| --------------------- | -------- | ----------------- | --------------------------------------------------------------- |
| `DEFAULT_TENANT_SLUG` | No       | `default`         | Internal identifier for the tenant (URL-safe, lowercase)        |
| `DEFAULT_TENANT_NAME` | No       | `My Organization` | Your organization's name, displayed in the UI header and reports |

On first boot, KANAP automatically creates a tenant using these values. The defaults work fine for most deployments — you only need to change them if you want a specific organization name to appear in the application.

## Required: Admin Credentials

| Variable | Description | Example |
|----------|-------------|---------|
| `ADMIN_EMAIL` | Initial admin user email | `admin@company.com` |
| `ADMIN_PASSWORD` | Initial admin password (**change after first login!**) | `ChangeMe123!` |
| `JWT_SECRET` | JWT signing key (generate: `openssl rand -hex 32`) | 64 hex chars |
| `APP_BASE_URL` | Public URL (used in email links) | `https://kanap.company.com` |
| `CORS_ORIGINS` | Comma-separated allowed browser origins (**required in production**) | `https://*.company.com` |

**Email links:** Password reset/invite URLs use `APP_BASE_URL` (or forwarded host/proto). On-prem should set `APP_BASE_URL` to the externally reachable URL and configure the reverse proxy to pass `Host` / `X-Forwarded-Proto`.

**CORS:** Configure `CORS_ORIGINS` to control which browser origins can access the API. The application **will fail to start in production** if `CORS_ORIGINS` is not set. Set it to the exact URL users access KANAP from.

```bash
# Match your APP_BASE_URL
CORS_ORIGINS=https://kanap.company.com
```

**Startup validation:** The application will refuse to start if `JWT_SECRET`, `DATABASE_URL`, or `APP_BASE_URL` are missing or empty. It also refuses to run if the PostgreSQL role from `DATABASE_URL` is still `SUPERUSER` or `BYPASSRLS`.

## Required: Database

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgres://user:pass@host:5432/kanap?sslmode=require` |

**Database requirements:**
- PostgreSQL 16 or higher (tested minimum; older versions may work but are unsupported)
- Extensions: `citext`, `pgcrypto`, `uuid-ossp`
- User needs CREATE TABLE / ALTER TABLE permissions for migrations
- Recommended: dedicated database
- `DATABASE_URL` must use a dedicated application role, not `postgres` or another cluster-admin role
- Recommended: create the app role as `NOSUPERUSER NOBYPASSRLS` from the start

**Database setup (example):**

```sql
-- 1. Create database and dedicated app role
CREATE DATABASE kanap;
CREATE USER kanap WITH PASSWORD 'secure-password' NOSUPERUSER NOBYPASSRLS;
GRANT ALL PRIVILEGES ON DATABASE kanap TO kanap;

-- 2. Connect to kanap database and enable extensions
\c kanap
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 3. Grant schema permissions (for migrations)
GRANT ALL ON SCHEMA public TO kanap;
```

If a dedicated application role was initially created with too many privileges, KANAP's first migration will harden it automatically to `NOSUPERUSER NOBYPASSRLS`. If `DATABASE_URL` points to a protected cluster-admin role such as `postgres`, startup fails and you must switch to a dedicated app role.

## Required: Storage

| Variable | Description | Example |
|----------|-------------|---------|
| `S3_ENDPOINT` | S3-compatible endpoint | `https://s3.amazonaws.com` |
| `S3_BUCKET` | Bucket name (must exist) | `kanap-files` |
| `S3_REGION` | Region | `us-east-1` |
| `AWS_ACCESS_KEY_ID` | Access key | `AKIA...` |
| `AWS_SECRET_ACCESS_KEY` | Secret key | `secret` |
| `S3_FORCE_PATH_STYLE` | `true` for MinIO, `false` for AWS/R2 | `false` |

**Bucket requirements:**
- Create the bucket before starting KANAP (not auto-created)
- Permissions: `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`, `s3:ListBucket`

KANAP uses the AWS SDK v3 S3 client for object storage access; any provider with S3-compatible API behavior is supported.

**Tested providers:**
- AWS S3 (`S3_ENDPOINT=https://s3.amazonaws.com`, `S3_FORCE_PATH_STYLE=false`)
- MinIO (`S3_ENDPOINT=http://minio:9000`, `S3_FORCE_PATH_STYLE=true`)
- Cloudflare R2 (`https://<account>.r2.cloudflarestorage.com`)
- Hetzner (`https://<region>.your-objectstorage.com`)

## Optional: Email via Resend

| Variable | Description | Example |
|----------|-------------|---------|
| `RESEND_API_KEY` | Resend API key | `re_xxxxx` |
| `RESEND_FROM_EMAIL` | From address | `KANAP <noreply@yourdomain.com>` |

If not configured, KANAP can still send email through SMTP in single-tenant deployments. If neither Resend nor SMTP is configured, email features are disabled, including user invitations and password reset. See Operations for SQL password reset fallback.

## Optional: Email via SMTP (single-tenant / on-prem only)

SMTP is supported only in `DEPLOYMENT_MODE=single-tenant`. Multi-tenant/cloud deployments continue to use Resend.

| Variable        | Description                          | Example                       |
| --------------- | ------------------------------------ | ----------------------------- |
| `SMTP_HOST`     | SMTP server hostname                 | `smtp.company.com`            |
| `SMTP_PORT`     | SMTP port                            | `587`                         |
| `SMTP_USER`     | SMTP username                        | `kanap`                       |
| `SMTP_PASSWORD` | SMTP password                        | `secret`                      |
| `SMTP_FROM`     | From address                         | `KANAP <noreply@company.com>` |
| `SMTP_SECURE`   | `true` for implicit TLS (465), `false` for STARTTLS/plain connect (587/25) | `false` |

Notes:
- `SMTP_USER` and `SMTP_PASSWORD` are optional. Leave both unset for relays that trust the source host/IP.
- If `SMTP_SECURE` is unset, KANAP defaults to `true` for port `465` and `false` otherwise.
- If both SMTP and Resend are configured in single-tenant mode, SMTP takes precedence.
- `SMTP_FROM` should be an address your SMTP server is allowed to send as.
- If mail is sent outside your network, configure SPF, DKIM, and DMARC on the sender domain through your mail administrator or provider.

**Common SMTP profiles**

Internal relay without authentication:

```env
SMTP_HOST=mail.company.local
SMTP_PORT=25
SMTP_SECURE=false
SMTP_FROM=KANAP <noreply@company.com>
```

Authenticated relay or provider:

```env
SMTP_HOST=smtp.company.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=noreply@company.com
SMTP_PASSWORD=secret
SMTP_FROM=KANAP <noreply@company.com>
```

Microsoft 365 SMTP submission:

```env
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=noreply@company.com
SMTP_PASSWORD=secret
SMTP_FROM=KANAP <noreply@company.com>
```

Use the Microsoft 365 profile only if SMTP AUTH is allowed for the mailbox and tenant.

## Optional: Entra SSO

See the dedicated guide: [Microsoft Entra SSO](sso-entra.md).

It covers the app registration, the delegated and application permissions, and the daily directory sync that refreshes user attributes and disables accounts removed from the directory. The API needs outbound access to `login.microsoftonline.com` and `graph.microsoft.com`.

## Optional: Advanced

| Variable | Description | Default |
|----------|-------------|---------|
| `LOG_LEVEL` | Logging verbosity (`debug`, `info`, `warn`, `error`) | `info` |
| `JWT_ACCESS_TOKEN_TTL` | Access token lifetime | `15m` |
| `JWT_REFRESH_TOKEN_TTL` | Refresh token lifetime | `4h` |
| `RATE_LIMIT_ENABLED` | App-level rate limiting toggle | `true` |
| `RATE_LIMIT_TRUST_PROXY` | Trust proxy headers for client IP detection | `false` |
| `APP_URL` | Base URL for notification email links in multi-tenant mode (tenant slug replaces `app`). **Not needed for on-prem** — `APP_BASE_URL` is used instead. | `https://app.kanap.net` |
| `EMAIL_OVERRIDE` | Redirect all emails to this address (dev/QA only, **never in production**) | *unset* |

## Full Example (.env)

```bash
# =============================================================================
# KANAP On-Premise Configuration
# =============================================================================

# DEPLOYMENT MODE (required)
DEPLOYMENT_MODE=single-tenant

# TENANT CONFIGURATION (optional - defaults shown)
DEFAULT_TENANT_SLUG=default
DEFAULT_TENANT_NAME=My Organization

# ADMIN CREDENTIALS (required)
ADMIN_EMAIL=admin@company.com
ADMIN_PASSWORD=ChangeThisPassword123!

# SECURITY (required)
JWT_SECRET=

# APPLICATION URL (required)
APP_BASE_URL=https://kanap.your-domain.com

# DATABASE (required - use a dedicated app role, never postgres)
DATABASE_URL=postgres://kanap:password@your-postgres:5432/kanap?sslmode=require

# STORAGE (required)
S3_ENDPOINT=https://s3.amazonaws.com
S3_BUCKET=kanap-files
S3_REGION=us-east-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
S3_FORCE_PATH_STYLE=false   # true for MinIO

# EMAIL (optional - Resend)
# RESEND_API_KEY=re_xxxxx
# RESEND_FROM_EMAIL=KANAP <noreply@yourdomain.com>

# EMAIL (optional - SMTP, single-tenant only)
# SMTP_HOST=smtp.company.com
# SMTP_PORT=587
# SMTP_SECURE=false
# SMTP_USER=
# SMTP_PASSWORD=
# SMTP_FROM=KANAP <noreply@company.com>

# ADVANCED (optional - defaults are fine)
# LOG_LEVEL=info
# JWT_ACCESS_TOKEN_TTL=15m
# JWT_REFRESH_TOKEN_TTL=4h
# RATE_LIMIT_ENABLED=true
# RATE_LIMIT_TRUST_PROXY=false
```

## Firewall Rules

After initial build, KANAP can run fully air-gapped if email, SSO, and FX rate features are all disabled.

### Inbound

| Port | Protocol | Purpose |
|------|----------|---------|
| 443 | TCP | HTTPS — nginx reverse proxy serving the application |
| 80 | TCP | HTTP — redirects to HTTPS |

### Outbound — Initial Setup & Build

These destinations are only needed during installation and `docker build`. They can be closed once the application is running.

| Destination | Port | Purpose |
|-------------|------|---------|
| `github.com` | 443 | Clone KANAP source code |
| `download.docker.com` | 443 | Docker APT repository |
| `dl.min.io` | 443 | MinIO binary download |
| `registry.npmjs.org` | 443 | npm dependencies during `docker build` |
| `registry-1.docker.io`, `production.cloudflare.docker.com` | 443 | Pull base Docker images (`node:20-alpine`, `nginx:alpine`) |
| Ubuntu APT mirrors | 80/443 | System packages (PostgreSQL, nginx, etc.) |

### Outbound — Runtime (Conditional)

Only required if the corresponding feature is enabled.

| Destination | Port | Purpose | When |
|-------------|------|---------|------|
| `api.resend.com` | 443 | Transactional email | If `RESEND_API_KEY` is set |
| Your SMTP relay or provider | 25 / 465 / 587 | Transactional email via SMTP | If `SMTP_HOST` is set |
| `login.microsoftonline.com` | 443 | Entra ID SSO metadata & tokens | If Entra SSO is configured |
| `graph.microsoft.com` | 443 | Profile enrichment at sign-in and the daily directory sync | If Entra SSO is configured |
| `api.worldbank.org` | 443 | Annual FX rates | Optional |
| `v6.exchangerate-api.com` | 443 | Spot FX rates | Optional |

### Internal (No Firewall Rule Needed)

These connections stay on the server — loopback or Docker bridge network only.

| Connection | Port | Notes |
|------------|------|-------|
| nginx → API container | 8080 | Bound to `127.0.0.1` |
| nginx → Web container | 8081 | Bound to `127.0.0.1` |
| API container → PostgreSQL | 5432 | Via `host.docker.internal` (Docker bridge `172.16.0.0/12`) |
| API container → MinIO | 9000 | Via `host.docker.internal` |
| MinIO console | 9001 | Local administration only, not exposed externally |

## Background Jobs

The backend runs scheduled background jobs for email notifications:
- **Expiration warnings**: daily at 08:00 UTC. Emails the owners of contracts and OPEX items 30, 14, 7 and 1 day(s) before a contract's cancellation deadline, a contract's end date or an OPEX item's end of validity. Only users who switched on budget notifications and expiration warnings in their notification settings receive them. Each reminder is sent once per day to each recipient, even if the job runs again that day, for example after a restart.
- **Weekly review digest**: hourly check — sends timezone-aware weekly summaries to users who have opted in.

One more scheduled job runs when Entra SSO is configured:

- **Microsoft Entra directory sync**: daily at 03:00 server time — refreshes user attributes and disables accounts removed or deactivated in the directory. It stays inactive until a Microsoft Entra administrator approves it. See [Microsoft Entra SSO](sso-entra.md).

Another job keeps statuses up to date:

- **`lifecycle-status-sync`**: every hour, and once when the API starts. Switches master data, contracts, OPEX and CAPEX items to disabled once their end of validity has passed.

These jobs require the API to run as a **long-running process** (not a serverless function). In on-premise mode, `APP_BASE_URL` is used for notification email links (no subdomain derivation). If no outbound email transport is configured, these jobs skip sending gracefully.
