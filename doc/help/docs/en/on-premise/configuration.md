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

On first boot, KANAP automatically creates a tenant using these values. The defaults work fine for most deployments — you only need to change them if you want a specific organization name to appear in the application. A new installation also receives the default IFRS chart of accounts, set as its default and consolidation chart (upgrading an existing installation does not add it).

## Required: Admin Credentials

| Variable | Description | Example |
|----------|-------------|---------|
| `ADMIN_EMAIL` | Initial admin user email | `admin@company.com` |
| `ADMIN_PASSWORD` | Initial admin password (**change after first login!**) | `ChangeMe123!` |
| `JWT_SECRET` | JWT signing key (generate: `openssl rand -hex 32`) | 64 hex chars |
| `APP_BASE_URL` | The exact address users open KANAP at: scheme, host and port when it is not standard (used in every link KANAP sends) | `https://kanap.company.com` |
| `CORS_ORIGINS` | The exact address users open KANAP at, comma-separated if there are several (browser origins allowed to call the API) | `https://kanap.company.com` |

**Application address (`APP_BASE_URL`):** Password reset and invitation emails, notification emails, the Microsoft Entra sign-in redirect and the links in exports all start from `APP_BASE_URL`. Write the address exactly as users type it, with the port when it is not 443 for HTTPS or 80 for HTTP (for example `https://kanap.company.com:8443`). KANAP does not read the `Host` or `X-Forwarded-Host` headers of a request to build these links, except on a local development machine (`APP_ENV=development`). Without `APP_BASE_URL`:

- password reset, invitation and Microsoft Entra sign-in answer "application URL is not configured: set APP_BASE_URL";
- the scheduled reminders are skipped, with one line in the API log.

**Allowed browser origins (`CORS_ORIGINS`):** `CORS_ORIGINS` controls which web addresses may call the API from a browser. Enter the exact address: scheme, host and port when it is not standard.

```bash
# Same address as APP_BASE_URL
CORS_ORIGINS=https://kanap.company.com
```

KANAP also accepts, without any entry in `CORS_ORIGINS`:

- the application address (`APP_BASE_URL`);
- the address of the request itself: the host and port of the browser's address equal the `Host` header that reaches KANAP. When your reverse proxy forwards `Host` without the port, the same host name on any port counts, unless `APP_ENV=production`. In production, add the exact address with its port to `CORS_ORIGINS`.

A request from any other address receives a 403 answer and the API logs one `[CORS] Rejected origin` line per address and per minute. Session refresh and sign-out requests follow the same rule: a refresh or sign-out sent from an address that is not allowed is refused with 403.

A pattern such as `https://*.company.com` still works on a single-tenant installation. The API prints a warning at start, and a later version will accept exact addresses only. Replace patterns with the exact address now.

If `CORS_ORIGINS` and the application address (`APP_BASE_URL`) are both missing and `APP_ENV` is not set, every origin is still allowed in this version, and the API prints a start-up warning. A later version will require them.

## Optional: Run Mode (`APP_ENV`)

| Variable | Description | Default |
|----------|-------------|---------|
| `APP_ENV` | Run mode of the API: `production`, `development` or unset | *unset* |

`APP_ENV` has three states:

| State | Values | What changes |
|-------|--------|--------------|
| Production | `production`, `prod` | The API refuses to start without `APP_BASE_URL` and `CORS_ORIGINS`. The session cookie is always marked Secure, so it only works over HTTPS. |
| Development | `development`, `dev`, `local`, `test` | Workstation conveniences: links can follow a local development host, every origin is allowed when `CORS_ORIGINS` is empty, and `PLATFORM_ADMIN_EMAILS=*` is accepted. Do not use it on a server. |
| Unspecified | any other value, or no `APP_ENV` | The same link and origin rules as production. A missing `APP_BASE_URL` or `CORS_ORIGINS` produces a start-up warning and the API still starts. The session cookie follows the request: Secure when the request arrives over HTTPS. |

Set `APP_ENV=production` only when users reach KANAP over HTTPS. If `NODE_ENV` is set and `APP_ENV` is not, KANAP reads `NODE_ENV` instead.

**Startup validation:** The application refuses to start if `JWT_SECRET` or `DATABASE_URL` is missing or empty, and, with `APP_ENV=production`, if `APP_BASE_URL` or `CORS_ORIGINS` is missing. It also refuses to run if the PostgreSQL role from `DATABASE_URL` is still `SUPERUSER` or `BYPASSRLS`.

**Startup messages:** The API log shows these lines when it starts. Read them after every change to the `.env` file.

| Line | Meaning |
|------|---------|
| `[ENV] run mode: ...` | Always printed. Shows the mode the API runs in: `development`, `production` or `unspecified`. |
| `[ENV] APP_ENV is not set: production rules apply to links, browser origins and platform administration. Set APP_ENV=production (or development on a workstation).` | Printed in unspecified mode (the message shows the value when `APP_ENV` is set to something else). Set `APP_ENV=production` if users reach KANAP over HTTPS. |
| `[CONFIG] APP_BASE_URL is not set: ...` | Password reset and invitation emails, notification links and sign-in redirects are refused. Set `APP_BASE_URL`. |
| `[CONFIG] APP_BASE_URL is not a valid http(s) address: ...` | The value is not a web address. Write it with `https://` or `http://`. |
| `[CORS] CORS_ORIGINS is not set: browsers are allowed only from APP_BASE_URL and from the address of each request. ...` | Set `CORS_ORIGINS` to the exact address users open. |
| `[CORS] CORS_ORIGINS and APP_BASE_URL are not set: browsers are still allowed from every origin in this version; ...` | Set both. A later version allows only the configured addresses. |
| `[CORS] CORS_ORIGINS entry ... is a pattern: it is still accepted in this version. ...` | Replace the pattern with the exact address. |

## Upgrading: Application Address and Allowed Origins

This version changes how KANAP builds links and which browser origins it accepts. Before you upgrade, check your `.env` file:

1. Set `APP_BASE_URL` to the exact address users open (scheme, host and port when it is not standard). It is the only source of the links in emails, sign-in redirects and exports. The request headers no longer change them. Without it, password reset, invitation and Microsoft Entra sign-in stop working, and scheduled reminders are skipped.
2. Put that exact address in `CORS_ORIGINS`, in place of any pattern. If your proxy does not keep the `Host` header, or if the address uses a non-standard port, the exact origin with its port is required.
3. Set `APP_ENV=production` only if users reach KANAP over HTTPS. The session cookie then always carries the Secure attribute and the API refuses to start without `APP_BASE_URL` and `CORS_ORIGINS`.
4. After the upgrade, read the `[ENV]`, `[CONFIG]` and `[CORS]` lines in the API log and fix each warning.
5. Session refresh and sign-out requests from an address that is not allowed now receive 403, and `PLATFORM_ADMIN_EMAILS=*` is only accepted when `APP_ENV` is a development value.

Other visible changes:

- If `APP_BASE_URL` starts with `app.`, Microsoft Entra sign-in and knowledge links use the address exactly as configured.
- With neither `CORS_ORIGINS` nor an application address, and `APP_ENV` unset, nothing changes yet: every origin stays allowed and the API prints a warning.
- Without `CORS_ORIGINS` but with an application address, outside development, only the application address and the address of the request are allowed (before: every origin).
- The test weekly review email returns an error when no application address is configured.

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
| `APP_URL` | Multi-tenant (cloud) only: third source of the application address, after `APP_BASE_URL` and `PUBLIC_APP_URL` (the tenant slug replaces `app`). **Not needed for on-prem**: `APP_BASE_URL` is used. | *unset* |
| `EMAIL_OVERRIDE` | Redirect all emails to this address (dev/QA only, **never in production**) | *unset* |

## Optional: Capacity and Performance

The defaults suit a few dozen users. For more users at once, run several API processes and size the database connections.

| Variable | Description | Default |
|----------|-------------|---------|
| `API_WORKERS` | Number of API processes in the API container (1 to 16). With more than one, a request that computes no longer makes everyone else wait. | `1` |
| `DB_POOL_MAX` | Database connections per API process (2 at least: a lower value is raised to 2) | `20` |
| `SHUTDOWN_DRAIN_TIMEOUT_MS` | On stop or upgrade, how long the API lets requests in progress, the notifications they started, running background jobs and queued emails finish (milliseconds, at most 120000). The container is stopped after 30 s whatever happens. | `20000` |
| `OPS_METRICS_TOKEN` | Enables `GET /api/ops/metrics` for your monitoring tool (24 characters or more, for example `openssl rand -hex 32`; a shorter value leaves it disabled and the API says so at start). See [Operations](operations.md#api-metrics-for-a-monitoring-tool). | *unset (disabled)* |

**What each costs.** Every API process uses about 200 MB of memory at start and up to 300 MB under load (measured with 50 users on 5,000 budget lines); with several, a small supervising process adds about 100 MB. Every API process can open up to `DB_POOL_MAX` connections to PostgreSQL. Count:

- memory: `API_WORKERS` × 0.4 GB for the API, plus what PostgreSQL uses if it runs on the same server, plus about 1 GB of headroom (image builds need it during upgrades);
- connections: `API_WORKERS` × `DB_POOL_MAX` must stay under PostgreSQL's `max_connections` (100 by default) minus about 15. The API checks this at start and writes a warning in its log when it does not fit, with a value that would.

**Suggested values.**

| Users working at the same time | `API_WORKERS` | `DB_POOL_MAX` | Server memory (API + PostgreSQL) |
|---|---|---|---|
| Up to 20 | 1 | 20 | 4 GB |
| 20 to 50 | 2 | 15 | 8 GB |
| 50 and more | 4 | 10 | 8 to 16 GB |

Measured on 5,000 budget lines: at 10 users one process answers as fast as four. At 50 users, opening a line took 237 ms (95th percentile) with one process, 142 ms with two and 82 ms with four, and one process kept all its database connections busy.

Keep `API_WORKERS` at or below the number of CPU cores the server gives KANAP. Changes take effect when the API container restarts (`docker compose -f infra/compose.onprem.yml up -d api`).

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

# RUN MODE (optional - set production when users reach KANAP over HTTPS)
# APP_ENV=production

# APPLICATION URL (required - the exact address users open)
APP_BASE_URL=https://kanap.your-domain.com

# ALLOWED BROWSER ORIGINS (required - the exact address users open)
CORS_ORIGINS=https://kanap.your-domain.com

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

# CAPACITY (optional - see "Capacity and Performance")
# API_WORKERS=1
# DB_POOL_MAX=20
# SHUTDOWN_DRAIN_TIMEOUT_MS=20000
# OPS_METRICS_TOKEN=
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
| `registry-1.docker.io`, `production.cloudflare.docker.com` | 443 | Pull base Docker images (`node:24-alpine`, `nginx:alpine`) |
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
| `open.er-api.com` | 443 | Spot FX rates | Optional |

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

With several API processes (`API_WORKERS`), each job still runs once per scheduled time: the processes agree through the database on which one runs it. When the API stops (an upgrade), a job in progress gets the drain time to finish; one still running then is shown as failed ("interrupted") in the scheduled tasks list and runs again at its next time.

These jobs require the API to run as a **long-running process** (not a serverless function). In on-premise mode, `APP_BASE_URL` is used for notification email links (no subdomain derivation). If `APP_BASE_URL` is not set, the expiration warnings and weekly review digests are skipped and the API writes one log line ("application URL is not configured"). If no outbound email transport is configured, these jobs skip sending gracefully.
