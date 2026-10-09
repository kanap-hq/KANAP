# On-premise configuration

This guide covers the environment variables of an on-premise installation.
A full template is available at `infra/.env.onprem.example`. Copy it to `.env` in the repository root and make it readable by its owner only (`chmod 600 .env`): it holds every secret of the installation.

A change to `.env` takes effect when the API container is created again. Run this after every change:

```bash
cd /opt/kanap
docker compose -f infra/compose.onprem.yml up -d api
```

`docker compose -f infra/compose.onprem.yml restart api` keeps the old values.

## Required: deployment mode

| Variable | Description | Example |
|----------|-------------|---------|
| `DEPLOYMENT_MODE` | **Must be `single-tenant`** for on-premise deployments | `single-tenant` |

Write the value exactly. A misspelled value (`single_tenant`) starts KANAP in cloud mode without any warning.

## Optional: tenant identity

| Variable              | Required | Default           | Description                                                     |
| --------------------- | -------- | ----------------- | --------------------------------------------------------------- |
| `DEFAULT_TENANT_SLUG` | No       | `default`         | Internal identifier for the tenant (URL-safe, lowercase)        |
| `DEFAULT_TENANT_NAME` | No       | `My Organization` | Your organization's name: the text alternative of the logo, and the name the AI assistant uses |

On first boot, KANAP creates a tenant using these values. The defaults work for most deployments. A new installation also receives the default IFRS chart of accounts, set as its default and consolidation chart (upgrading an existing installation does not add it).

Set both before the first start:

- Changing `DEFAULT_TENANT_SLUG` later makes KANAP create a second, empty workspace and serve that one. The first workspace stays in the database, out of reach.
- Changing `DEFAULT_TENANT_NAME` later has no effect, and the application has no page to rename the organization. Set the name before the first start.

To give KANAP the look of your organization, add your logo and colors in **Admin → Branding**.

## Required: admin credentials

| Variable | Description | Example |
|----------|-------------|---------|
| `ADMIN_EMAIL` | Email of the first administrator account | `admin@company.com` |
| `ADMIN_PASSWORD` | Password of the first administrator account. Use a value of your own, 12 characters or more (see below) | `ChangeMe123!` |
| `JWT_SECRET` | Signing key for sign-in tokens. Generate it with `openssl rand -hex 32` (32 characters or more) | 64 hex chars |
| `APP_BASE_URL` | The exact address users open KANAP at: scheme, host and port when it is not standard (used in every link KANAP sends) | `https://kanap.company.com` |
| `CORS_ORIGINS` | The exact address users open KANAP at, comma-separated if there are several (browser origins allowed to call the API) | `https://kanap.company.com` |

**Choose the administrator password.** The example value in the table is a published one. Replace it with a value of your own, 12 characters or more, for example the output of `openssl rand -base64 18`. An example value or a shorter one makes the API print a `[SECURITY]` warning at each start until the account's password is changed. A `JWT_SECRET` shorter than 32 characters prints a `[SECURITY]` warning too.

**The administrator account is created once.** KANAP reads `ADMIN_EMAIL` and `ADMIN_PASSWORD` at the first start and creates the account. Afterwards:

- Changing either variable changes nothing while an active administrator exists. Change the password in the application (profile page, or **Forgot password** on the sign-in page).
- If no active administrator remains (all disabled, or none holds the Administrator role), the next start restores the `ADMIN_EMAIL` account as an enabled administrator. Its existing password stays as it is. If the account does not exist, it is created with `ADMIN_PASSWORD`.
- If `ADMIN_EMAIL` or `ADMIN_PASSWORD` is empty, no account is created and the log says nothing about it.

**Application address (`APP_BASE_URL`).** Password reset and invitation emails, notification emails, the Microsoft Entra sign-in redirect and the links in exports all start from `APP_BASE_URL`. Write the address exactly as users type it, with the port when it is not 443 for HTTPS or 80 for HTTP (for example `https://kanap.company.com:8443`). KANAP does not read the `Host` or `X-Forwarded-Host` headers of a request to build these links, except on a local development machine (`APP_ENV=development`). Without `APP_BASE_URL`:

- password reset, invitation and Microsoft Entra sign-in answer "application URL is not configured: set APP_BASE_URL";
- the scheduled reminders are skipped, with one line in the API log.

**Allowed browser origins (`CORS_ORIGINS`).** `CORS_ORIGINS` controls which web addresses may call the API from a browser. Enter the exact address: scheme, host and port when it is not standard.

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

## Optional: run mode (`APP_ENV`)

| Variable | Description | Default |
|----------|-------------|---------|
| `APP_ENV` | Run mode of the API: `production`, `development` or unset | *unset* |

`APP_ENV` has three states:

| State | Values | What changes |
|-------|--------|--------------|
| Production | `production`, `prod` | The API refuses to start without `APP_BASE_URL` and `CORS_ORIGINS`. The session cookie is always marked Secure, so it only works over HTTPS. |
| Development | `development`, `dev`, `local`, `test` | Workstation conveniences: links can follow a local development host, every origin is allowed when `CORS_ORIGINS` is empty, and `PLATFORM_ADMIN_EMAILS=*` is accepted. Do not use it on a server. |
| Unspecified | any other value, or no `APP_ENV` | The same link and origin rules as production. A missing `APP_BASE_URL` or `CORS_ORIGINS` produces a start-up warning and the API still starts. The session cookie follows the request: Secure when the request arrives over HTTPS. |

Set `APP_ENV=production` when users reach KANAP over HTTPS, which is the documented setup. If `NODE_ENV` is set and `APP_ENV` is not, KANAP reads `NODE_ENV` instead.

**Start-up checks.** The API refuses to start if `JWT_SECRET` or `DATABASE_URL` is missing or empty, and, with `APP_ENV=production`, if `APP_BASE_URL` or `CORS_ORIGINS` is missing. It also refuses to run if the PostgreSQL role from `DATABASE_URL` is `SUPERUSER` or `BYPASSRLS`. That last check runs after the migrations, so the migrations have already run with that role when the message appears.

## What the API log shows at start

Read the API log after every start and after every change to `.env`:

```bash
cd /opt/kanap
docker compose -f infra/compose.onprem.yml logs --no-log-prefix api | grep -E '^\[|^Admin seeding|WARN|ERROR|successfully started|Email transport'
```

The filter keeps the lines below and leaves out the framework details. Without it, `docker compose -f infra/compose.onprem.yml logs api` shows everything.

**Order.** The lines that KANAP writes itself (`[entrypoint]`, `[ENV]`, `[SECRETS]`, `[RATE-LIMIT]`, `[CORS]`, `[DB]`, `[on-prem]`, `[SECURITY]`) come first. The framework lines (`Starting Nest application...`, email, scheduled jobs, `Nest application successfully started`) follow.

**A clean first start** of the [installation example](installation-example.md#7-build-and-start) shows these lines, in this order (the first `[SECRETS]` line is shortened here):

```
[entrypoint] Initializing DB (attempt 1/30) ...
[entrypoint] DB initialized. Running migrations...
[entrypoint] Migrations complete (330 executed).
[ENV] run mode: production
[SECRETS] token families: password-reset=derived-key provisioning=jwt-secret entra-state=derived-key (...)
[SECRETS] Access tokens must carry purpose="access" (legacy untyped access tokens: refused)
[RATE-LIMIT] Client address: taken from X-Forwarded-For behind 1 trusted proxy (RATE_LIMIT_TRUST_PROXY=true)
[CORS] Configured 1 origin pattern(s)
[DB] Connected as PostgreSQL role "kanap" with native RLS enforcement
Admin seeding disabled (set SEED_ADMIN=true to enable)
[on-prem] Default chart of accounts created
[on-prem] Created tenant 'default'
[on-prem] Created administrator account admin@example.internal: the workspace had no active administrator
[on-prem] Created default subscription (On-Prem)
... WARN [EmailService] No outbound email transport configured; email sending is disabled.
... Nest application successfully started
[DB] pool budget: 1 process × 20 connections = 20 of 87 usable (...)
```

The block leaves out the migration lines: about 40 lines that start with `[Migration]` or `[migration:` follow `Running migrations...`. They are informational. On a new database some of them report changes to built-in reference data or name a tenant id that is not yours: KANAP keeps a system tenant for platform features. They need no action. `...` stands for the `[Nest]` prefix with the process id and the time, and for the source in brackets (for example `LOG [NestApplication]`). Some of these lines end with a duration such as `+0ms`. The last line of the filtered output is `[DB] pool budget ...`. Log output saved to a file can contain colour codes such as `[33m`.

The number of migrations changes from version to version. On later starts it is `0 executed` (or the number of new migrations after an upgrade), and the four `[on-prem]` creation lines give way to `Administrator account ... left unchanged`. The email line depends on your settings: with an email transport it reads `LOG [EmailService] Email transport selected: ...` instead of the warning.

**Lines to know.**

| Line | Meaning |
|------|---------|
| `[entrypoint] Migrations complete (N executed).` | The database is up to date. N is the number of migrations that ran at this start. |
| `[entrypoint] DB not ready or migration failed (attempt N): ... Retrying` | The API cannot reach or use the database. It tries 30 times, 2 seconds apart, then stops. Check `DATABASE_URL`, the PostgreSQL rules and `sslmode` (see [Required: database](#required-database)). |
| `[ENV] run mode: ...` | Always printed. Shows the mode the API runs in: `development`, `production` or `unspecified`. |
| `[ENV] APP_ENV is not set: production rules apply to links, browser origins and platform administration. Set APP_ENV=production (or development on a workstation).` | Printed in unspecified mode (the message shows the value when `APP_ENV` is set to something else). Set `APP_ENV=production` if users reach KANAP over HTTPS. |
| `[CONFIG] APP_BASE_URL is not set: ...` | Password reset and invitation emails, notification links and sign-in redirects are refused. Set `APP_BASE_URL`. |
| `[CONFIG] APP_BASE_URL is not a valid http(s) address: ...` | The value is not a web address. Write it with `https://` or `http://`. |
| `[SECRETS] token families: ...` and `[SECRETS] Access tokens must carry purpose="access" ...` | Informational. They say where each signing key comes from (never its value). Nothing to do. |
| `[RATE-LIMIT] Client address: ... (RATE_LIMIT_TRUST_PROXY=true)` | Informational. Shows how KANAP finds the client address. |
| `[RATE-LIMIT] Client address: ... (RATE_LIMIT_TRUST_PROXY not set, single-tenant default; ...)` | A warning. `RATE_LIMIT_TRUST_PROXY` is not set. Set it (see [Optional: advanced](#optional-advanced)). |
| `[CORS] Configured N origin pattern(s)` | Informational. N is the number of entries in `CORS_ORIGINS`. |
| `[CORS] CORS_ORIGINS is not set: browsers are allowed only from APP_BASE_URL and from the address of each request. ...` | Set `CORS_ORIGINS` to the exact address users open. |
| `[CORS] CORS_ORIGINS and APP_BASE_URL are not set: browsers are still allowed from every origin in this version; ...` | Set both. A later version allows only the configured addresses. |
| `[CORS] CORS_ORIGINS entry ... is a pattern: it is still accepted in this version. ...` | Replace the pattern with the exact address. |
| `[DB] Connected as PostgreSQL role "kanap" with native RLS enforcement` | Informational. The API uses the application role. |
| `Admin seeding disabled (set SEED_ADMIN=true to enable)` | Expected on-premise. Nothing to do: the administrator is created from `ADMIN_EMAIL` and `ADMIN_PASSWORD`, not by this option. |
| `[on-prem] Default chart of accounts created`, `[on-prem] Created tenant '...'`, `[on-prem] Created administrator account ...`, `[on-prem] Created default subscription (On-Prem)` | First start only. |
| `[on-prem] Administrator account ... left unchanged: the workspace has an active administrator` | Later starts. Nothing to do. |
| `[on-prem] Restored ... as an enabled administrator: the workspace had no active administrator (password unchanged)` | A warning. No active administrator was left, so KANAP restored the `ADMIN_EMAIL` account. |
| `[SECURITY] JWT_SECRET is shorter than 32 characters. ...` | Set a longer random value (`openssl rand -hex 32`) and recreate the API: everyone signs in again and pending password reset links stop working. |
| `[SECURITY] The account of ADMIN_EMAIL still has the password from ADMIN_PASSWORD, which is an example value from the documentation or shorter than 12 characters. ...` | Change the administrator's password in the application, or follow [Password reset](operations.md#password-reset). The line stops once the password is changed. |
| `LOG [EmailService] Email transport selected: smtp (<host>:<port>, secure=false)` | Email is on, through the SMTP relay shown. `secure=true` means implicit TLS (`SMTP_SECURE`). With Resend the line ends with `selected: resend`. To test it, see [Test the email](#test-the-email). |
| `WARN [EmailService] No outbound email transport configured; email sending is disabled.` | No email transport is set. Invitations, password reset and notifications send nothing. See [Optional: email via SMTP](#optional-email-via-smtp-single-tenant-on-premise-only). |
| `[DB] pool budget: ...` | Informational. A `pool budget exceeded` warning means `API_WORKERS` × `DB_POOL_MAX` is too high for PostgreSQL's `max_connections`. |

## Upgrading an installation from before version 26.10.1

The first official version, 26.10.1, changes how KANAP builds links and which browser origins it accepts. Before you upgrade an older installation, check your `.env` file:

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

## Required: database

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgres://kanap:<password>@host.docker.internal:5432/kanap?sslmode=disable` |

**Database requirements:**

- PostgreSQL 16 or higher (16 and 18 are tested)
- Extensions: `citext`, `pgcrypto`, `uuid-ossp`
- User needs CREATE TABLE / ALTER TABLE permissions for migrations
- Recommended: dedicated database
- `DATABASE_URL` must use a dedicated application role, not `postgres` or another cluster-admin role
- Recommended: create the app role as `NOSUPERUSER NOBYPASSRLS` from the start

**Database setup (example):**

```sql
-- 1. Create database and dedicated app role
CREATE DATABASE kanap;
CREATE USER kanap WITH PASSWORD '<password>' NOSUPERUSER NOBYPASSRLS;
GRANT ALL PRIVILEGES ON DATABASE kanap TO kanap;

-- 2. Connect to kanap database and enable extensions
\c kanap
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 3. Grant schema permissions (for migrations)
GRANT ALL ON SCHEMA public TO kanap;
```

If a dedicated application role was initially created with too many privileges, KANAP's first migration hardens it to `NOSUPERUSER NOBYPASSRLS`. If `DATABASE_URL` points to a protected cluster-admin role such as `postgres`, start-up fails and you must switch to a dedicated app role.

**The password in the URL.** The password is part of the URL. A password that contains `@ : / # ?` or `%` breaks the URL unless you percent-encode those characters. Generate the password with `openssl rand -hex 24` instead: letters and digits need no encoding. The same applies to every secret you place in a URL.

**Encryption of the connection (`sslmode`).** The end of the URL says how the API talks to PostgreSQL:

| Value | Use it when |
|-------|-------------|
| `sslmode=disable` | PostgreSQL runs on the same server as KANAP (the installation example). The traffic stays on the server. |
| `sslmode=require` | PostgreSQL is a separate server or a managed service whose certificate comes from a public authority. The API checks the certificate. |
| `sslmode=no-verify` | The connection is encrypted but the API does not check the certificate. Use it for a private or self-signed certificate. |

`require` checks the certificate completely. A server with a private or self-signed certificate then makes the API fail to start: it tries 30 times and stops. When your company's authority signed that certificate, make the API trust the authority (see [Certificates from an internal authority](#optional-certificates-from-an-internal-authority)) and keep `require`. Otherwise use `no-verify`. Without any `sslmode` the connection is not encrypted.

## Required: storage

| Variable | Description | Example |
|----------|-------------|---------|
| `S3_ENDPOINT` | S3-compatible endpoint | `https://s3.amazonaws.com` |
| `S3_BUCKET` | Bucket name (must exist) | `kanap-files` |
| `S3_REGION` | Region | `us-east-1` |
| `AWS_ACCESS_KEY_ID` | Access key | `AKIA...` |
| `AWS_SECRET_ACCESS_KEY` | Secret key | `secret` |
| `S3_FORCE_PATH_STYLE` | `true` for RustFS, MinIO, Garage and most self-hosted stores; `false` for AWS S3 and Cloudflare R2 | `false` |

**Region.** Use `us-east-1` with RustFS. A provider can require its own region (the one it shows in its console). With Garage the region must be the one set in its configuration. A wrong region produces errors such as "Authorization header malformed".

**Bucket requirements:**

- Create the bucket before starting KANAP (it is not created automatically). KANAP does not check it at start: a missing bucket shows at the first upload or download.
- KANAP calls `PutObject`, `GetObject`, `HeadObject`, `DeleteObject` and `ListObjectsV2`, and builds presigned `GET` links, all on that one bucket. The matching permissions are `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject` and `s3:ListBucket`.

**Encryption at rest.** KANAP asks the store to encrypt every upload (server-side encryption `AES256`). A store that does not support it makes the API write the warning `PutObject fallback used: provider rejected explicit SSE header; upload retried without SSE request header` and keep the file as sent. RustFS accepts the request when `RUSTFS_SSE_S3_MASTER_KEY` is set, which the [installation example](installation-example.md#5-object-storage-rustfs) does. Keep that key with your configuration backup: files encrypted with it cannot be read without it.

KANAP uses the AWS SDK v3 S3 client; any provider with S3-compatible behavior is supported.

**Compatible stores:**

- RustFS (`S3_ENDPOINT=http://host.docker.internal:9000`, `S3_FORCE_PATH_STYLE=true`), used in the installation example
- AWS S3 (`S3_ENDPOINT=https://s3.amazonaws.com`, `S3_FORCE_PATH_STYLE=false`)
- Cloudflare R2 (`https://<account>.r2.cloudflarestorage.com`)
- Hetzner Object Storage (`https://<region>.your-objectstorage.com`)
- Garage (`S3_FORCE_PATH_STYLE=true`, region as set in its configuration)
- An existing MinIO (`S3_FORCE_PATH_STYLE=true`). MinIO no longer publishes new downloads or images, so new installations use another store. An installation that already runs MinIO keeps working with KANAP: nothing to change.

## Optional: email via Resend

| Variable | Description | Example |
|----------|-------------|---------|
| `RESEND_API_KEY` | Resend API key | `re_xxxxx` |
| `RESEND_FROM_EMAIL` | From address. Set it to an address your Resend account may send as: without it, mail is sent from a KANAP address. | `KANAP <noreply@company.com>` |

If not configured, KANAP can still send email through SMTP in single-tenant deployments. If neither Resend nor SMTP is configured, email features are disabled, including user invitations and password reset. See [Password reset](operations.md#password-reset) for the fallback.

## Optional: email via SMTP (single-tenant / on-premise only)

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

- `SMTP_HOST` and `SMTP_FROM` are both required. With only one of them, SMTP stays off.
- `SMTP_USER` and `SMTP_PASSWORD` go together: set both, or leave both unset for relays that trust the source host/IP. Setting only one stops the API from starting.
- If `SMTP_SECURE` is unset, KANAP defaults to `true` for port `465` and `false` otherwise.
- If both SMTP and Resend are configured in single-tenant mode, SMTP takes precedence.
- `SMTP_FROM` should be an address your SMTP server is allowed to send as.
- A relay on the KANAP server itself: set `SMTP_HOST=host.docker.internal`, which is how the API container reaches the server. The relay must listen on the Docker bridge address (`172.17.0.1` by default), and the firewall must allow its port from the Docker networks (see the command below).
- The address `172.17.0.1` exists only once Docker runs. A relay installed on the server that listens on it must start after Docker, as the storage does in the [installation example](installation-example.md#5-object-storage-rustfs). With systemd, create the file `/etc/systemd/system/<relay service>.service.d/override.conf` (the name of the relay's service in place of `<relay service>`) with two lines, `[Unit]` then `After=docker.service`, and run `sudo systemctl daemon-reload`.
- A relay whose TLS certificate comes from your company's authority needs that authority: see [Certificates from an internal authority](#optional-certificates-from-an-internal-authority).
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

**A relay on the KANAP server.** Allow the API container to reach it. Set the port of your relay in the first line:

```bash
SMTP_PORT=25   # the SMTP_PORT of .env
sudo ufw allow from 172.16.0.0/12 to any port "$SMTP_PORT" proto tcp
```

This rule is for a relay installed on the server. A relay that runs in a Docker container with a published port needs no rule: Docker publishes its ports outside of `ufw`.

### Test the email

After a change to the email settings, recreate the API (`docker compose -f infra/compose.onprem.yml up -d api`). The API log then shows `Email transport selected` (see [What the API log shows at start](#what-the-api-log-shows-at-start)). To send a test message, open the sign-in page, choose **Forgot password** and enter the email of an existing account that signs in with a password. The message arrives with a link that starts with your `APP_BASE_URL`. Accounts that sign in with Microsoft Entra receive no reset message.

When sending fails, **Forgot password** shows an error and the API log has an `ERROR [ExceptionsHandler]` line with the reason. For a relay whose certificate the API does not trust, the line reads `Error: unable to verify the first certificate; ...` (or `self-signed certificate`), followed by `code: 'ESOCKET'` a few lines below. The API does not trust the authority that signed the relay's certificate: see [Certificates from an internal authority](#optional-certificates-from-an-internal-authority). Installing the authority on the server itself does not change the container.

## Optional: certificates from an internal authority

The API checks the certificate of every server it reaches over TLS. Your SMTP relay, a PostgreSQL server with `sslmode=require` or an S3 store over HTTPS may use a certificate signed by your company's own authority. The API then refuses the connection until it trusts that authority. Give it the certificate of the authority, as a PEM file:

```bash
cd /opt/kanap
cp /path/to/company-ca.pem infra/certs/company-ca.pem
chmod 644 infra/certs/company-ca.pem
echo 'NODE_EXTRA_CA_CERTS=/etc/kanap/certs/company-ca.pem' >> .env
docker compose -f infra/compose.onprem.yml up -d api
```

- The file holds the root authority, followed by the intermediate authorities when your servers do not send them. Put certificates only, no private key.
- Mode `644` lets the API read the file. The certificate of an authority is public.
- Git ignores the files of `infra/certs/`, so an upgrade leaves them in place.
- Your authority is added to the public ones: connections to public services keep working.

Check that the API reads the file:

```bash
cd /opt/kanap
docker compose -f infra/compose.onprem.yml exec -T api node -e 'require("tls").createSecureContext()' </dev/null
```

The command prints nothing when all is well. A line that starts with `Warning: Ignoring extra certs from` means the API cannot read the file: check the path in `.env`, the file name and its mode. The API log shows the same line after its first TLS connection.

## Optional: Entra SSO

See the dedicated guide: [Microsoft Entra SSO](sso-entra.md).

It covers the app registration, the delegated and application permissions, and the daily directory sync that refreshes user attributes and disables accounts removed from the directory. The variables are `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET`, `ENTRA_AUTHORITY` and `ENTRA_REDIRECT_URI`; all four are needed. The API needs outbound access to `login.microsoftonline.com` and `graph.microsoft.com`.

## Optional: AI features

All AI features are off by default on an on-premise installation. Three switches turn them on, and one secret lets KANAP store the keys of your AI provider.

| Variable | Description | Default |
|----------|-------------|---------|
| `AI_CHAT_ENABLED` | Turns on the [Plaid chat assistant](../ai-assistant.md) for the installation. | `false` |
| `AI_MCP_ENABLED` | Turns on MCP access and AI API keys. | `false` |
| `AI_SETTINGS_ENABLED` | Opens **Admin → Artificial intelligence** (AI models, Plaid settings) and the [agents](../agents-overview.md) to administrators. Without it nobody can set up a provider. | `false` |
| `AI_SETTINGS_ENCRYPTION_SECRET` | Secret that encrypts the provider keys you enter in KANAP. Generate it with `openssl rand -hex 32`. | *unset* |

Notes:

- Without `AI_SETTINGS_ENCRYPTION_SECRET`, KANAP refuses to store a provider key ("AI secret storage is not configured on this instance").
- Changing `AI_SETTINGS_ENCRYPTION_SECRET` later makes the stored keys unreadable. Back it up with `.env`, and enter the keys again if you lose it.
- An on-premise installation has no model included: you add your own provider or model server under **Admin → Artificial intelligence → AI models**. See [AI models](../ai-models.md) and [Plaid settings](../ai-settings.md). Each tenant also has its own switches there.
- The API needs outbound access to the provider you choose (see [Firewall rules](#firewall-rules)).

## Optional: advanced

| Variable | Description | Default |
|----------|-------------|---------|
| `RATE_LIMIT_TRUST_PROXY` | How KANAP finds the client address for its sign-in and request limits. `true`: one reverse proxy sits in front of the API and sends `X-Forwarded-For` (the nginx of this guide). `false`: nothing sits in front, the address of the connection is used. `1` to `3`: that many proxies in a row. | Unset on single-tenant means one trusted proxy, with a `[RATE-LIMIT]` warning at each start. Set it explicitly. |
| `RATE_LIMIT_ENABLED` | App-level rate limiting toggle | `true` |
| `JWT_ACCESS_TOKEN_TTL` | Access token lifetime: a number followed by `s`, `m`, `h` or `d`. Another format becomes 15 minutes. | `15m` |
| `JWT_REFRESH_TOKEN_TTL` | Refresh token lifetime, same format. Another format becomes 15 minutes. | `4h` |
| `PASSWORD_RESET_TTL` | Lifetime of a password reset link: a number of seconds or a duration such as `30m` or `2h`. | `1h` |
| `LOG_LEVEL` | `debug` or `verbose` adds the details of each scheduled job run to the log. Any other value changes nothing. | *unset* |
| `INTEGRATED_DOCS_AUTO_ROLLOUT` | Repairs, at start, the documents linked to requests and projects. Off on-premise unless you set it: `if-needed` runs the repair only when the counts differ, `always` at every start. | *off* |
| `APP_URL` | Multi-tenant (cloud) only. **Not needed on-premise**: `APP_BASE_URL` is used. | *unset* |
| `EMAIL_OVERRIDE` | Redirect all emails to this address (dev/QA only, **never in production**) | *unset* |

**Client address.** With the documented setup (nginx on the same server, API port bound to `127.0.0.1`), set `RATE_LIMIT_TRUST_PROXY=true`. The proxy must send `X-Forwarded-For`; the nginx example does. Set `false` when nothing sits in front of the API. A wrong value gives every user the same address, so the 5 sign-in attempts per minute are shared by everyone.

## Optional: capacity and performance

The defaults suit a few dozen users. For more users at once, run several API processes and size the database connections.

| Variable | Description | Default |
|----------|-------------|---------|
| `API_WORKERS` | Number of API processes in the API container (1 to 16). With more than one, a request that computes no longer makes everyone else wait. | `1` |
| `DB_POOL_MAX` | Database connections per API process (2 at least: a lower value is raised to 2) | `20` |
| `SHUTDOWN_DRAIN_TIMEOUT_MS` | On stop or upgrade, how long the API lets requests in progress, the notifications they started, running background jobs and queued emails finish (milliseconds, at most 120000). The container is stopped after 30 s whatever happens. | `20000` |
| `OPS_METRICS_TOKEN` | Enables `GET /api/ops/metrics` for your monitoring tool (24 characters or more, for example `openssl rand -hex 32`; a shorter value leaves it disabled and the API says so at start). See [Operations](operations.md#api-metrics-for-a-monitoring-tool). | *unset (disabled)* |

**What each costs.** Every API process uses about 200 MB of memory at start and up to 300 MB under load (measured with 50 users on 5,000 budget lines); with several, a small supervising process adds about 100 MB. Every API process can open up to `DB_POOL_MAX` connections to PostgreSQL. Count:

- memory: `API_WORKERS` × 0.4 GB for the API, plus what PostgreSQL uses if it runs on the same server, plus room for the image build at each upgrade. 6 GB is the minimum for any server. On a new installation with PostgreSQL and the storage running, building both images at once took about 3.8 GB in total at its peak (about 3.2 GB for the build itself), so 6 GB keeps about 2 GB free;
- connections: `API_WORKERS` × `DB_POOL_MAX` must stay under PostgreSQL's `max_connections` (100 by default) minus about 15. The API checks this at start and writes a warning in its log when it does not fit, with a value that would.

**Suggested values.**

| Users working at the same time | `API_WORKERS` | `DB_POOL_MAX` | Server memory (API + PostgreSQL) |
|---|---|---|---|
| Up to 20 | 1 | 20 | 6 GB |
| 20 to 50 | 2 | 15 | 8 GB |
| 50 and more | 4 | 10 | 8 to 16 GB |

Measured on 5,000 budget lines: at 10 users one process answers as fast as four. At 50 users, opening a line took 237 ms (95th percentile) with one process, 142 ms with two and 82 ms with four, and one process kept all its database connections busy.

Keep `API_WORKERS` at or below the number of CPU cores the server gives KANAP. Changes take effect when the API container is created again (`docker compose -f infra/compose.onprem.yml up -d api`).

## Full example (.env)

```bash
# =============================================================================
# KANAP On-Premise Configuration
# =============================================================================

# DEPLOYMENT MODE (required)
DEPLOYMENT_MODE=single-tenant

# TENANT CONFIGURATION (optional - defaults shown; set before the first start)
DEFAULT_TENANT_SLUG=default
DEFAULT_TENANT_NAME=My Organization

# ADMIN CREDENTIALS (required - read at the first start only)
# Replace the example password with a value of your own, 12 characters or more.
ADMIN_EMAIL=admin@company.com
ADMIN_PASSWORD=ChangeThisPassword123!

# SECURITY (required)
JWT_SECRET=

# RUN MODE (set production when users reach KANAP over HTTPS)
APP_ENV=production

# APPLICATION URL (required - the exact address users open)
APP_BASE_URL=https://kanap.company.com

# ALLOWED BROWSER ORIGINS (required - the exact address users open)
CORS_ORIGINS=https://kanap.company.com

# CLIENT ADDRESS (one reverse proxy in front of the API)
RATE_LIMIT_TRUST_PROXY=true

# DATABASE (required - a dedicated application role, not postgres)
# sslmode: disable (same server), require (public certificate), no-verify (private certificate)
DATABASE_URL=postgres://kanap:password@your-postgres:5432/kanap?sslmode=require

# STORAGE (required)
S3_ENDPOINT=https://s3.amazonaws.com
S3_BUCKET=kanap-files
S3_REGION=us-east-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
# true for RustFS, MinIO, Garage; false for AWS S3 and R2
S3_FORCE_PATH_STYLE=false

# EMAIL (optional - Resend)
# RESEND_API_KEY=re_xxxxx
# RESEND_FROM_EMAIL=KANAP <noreply@company.com>

# EMAIL (optional - SMTP, single-tenant only)
# SMTP_HOST=smtp.company.com
# SMTP_PORT=587
# SMTP_SECURE=false
# SMTP_USER=
# SMTP_PASSWORD=
# SMTP_FROM=KANAP <noreply@company.com>

# SSO (optional - Microsoft Entra ID, all four together)
# ENTRA_CLIENT_ID=
# ENTRA_CLIENT_SECRET=
# ENTRA_AUTHORITY=https://login.microsoftonline.com/<tenant-id>
# ENTRA_REDIRECT_URI=https://kanap.company.com/api/auth/entra/callback

# AI (optional - off by default)
# AI_CHAT_ENABLED=false
# AI_MCP_ENABLED=false
# AI_SETTINGS_ENABLED=false
# AI_SETTINGS_ENCRYPTION_SECRET=

# ADVANCED (optional - defaults are fine)
# JWT_ACCESS_TOKEN_TTL=15m
# JWT_REFRESH_TOKEN_TTL=4h
# PASSWORD_RESET_TTL=1h
# RATE_LIMIT_ENABLED=true

# CAPACITY (optional - see "Capacity and performance")
# API_WORKERS=1
# DB_POOL_MAX=20
# SHUTDOWN_DRAIN_TIMEOUT_MS=20000
# OPS_METRICS_TOKEN=
```

## Firewall rules

After the initial build, KANAP can run fully air-gapped if email, SSO, AI and FX rate features are all disabled.

### Inbound

| Port | Protocol | Purpose |
|------|----------|---------|
| 443 | TCP | HTTPS: nginx reverse proxy serving the application |
| 80 | TCP | HTTP: redirects to HTTPS (and answers certificate renewals when you use Let's Encrypt) |
| 22 | TCP | SSH, for administration. Allow it before you enable a firewall |

Nothing else needs to be reachable from the network. In particular, PostgreSQL (5432) and the object storage (9000) are for the Docker networks of the server only.

### Outbound: initial setup and build

These destinations are needed during installation, at each upgrade (`docker build`) and the first time the smoke test runs. They can be closed between upgrades.

| Destination | Port | Purpose |
|-------------|------|---------|
| `github.com`, `*.githubusercontent.com` | 443 | Clone KANAP source code; download the RustFS release files (the installation example) |
| `download.docker.com` | 443 | Docker APT repository |
| `registry.npmjs.org` | 443 | npm dependencies during `docker build` |
| `registry-1.docker.io`, `auth.docker.io` | 443 | Pull base Docker images (`node:24-alpine`, `nginx:alpine`), and the smoke test image (`node:24-alpine`) the first time the test runs. Each pull first gets a token from `auth.docker.io` |
| `production.cloudflare.docker.com`, `production.cloudfront.docker.com` | 443 | Download the image layers: Docker Hub redirects each pull to these hosts |
| `dl-cdn.alpinelinux.org` | 80/443 | Alpine packages during `docker build` (both images install packages with `apk add`) |
| Ubuntu APT mirrors | 80/443 | System packages (PostgreSQL, nginx, etc.) |
| `acme-v02.api.letsencrypt.org` | 443 | Certificates, only with Let's Encrypt (also at each renewal) |

Docker can change the download hosts of Docker Hub. Docker keeps the current list in its [allowlist](https://docs.docker.com/desktop/setup/allow-list/): the Docker Hub rows of that page also apply to a server with Docker Engine.

### Outbound: runtime (conditional)

Only required if the corresponding feature is enabled.

| Destination | Port | Purpose | When |
|-------------|------|---------|------|
| `api.resend.com` | 443 | Transactional email | If `RESEND_API_KEY` is set |
| Your SMTP relay or provider | 25 / 465 / 587 | Transactional email via SMTP | If `SMTP_HOST` is set |
| `login.microsoftonline.com` | 443 | Entra ID SSO metadata & tokens | If Entra SSO is configured |
| `graph.microsoft.com` | 443 | Profile enrichment at sign-in and the daily directory sync | If Entra SSO is configured |
| The AI provider you configure (or your own model server) | 443 or your server's port | Chat, agents | If AI features are enabled and a model is set up |
| `api.worldbank.org` | 443 | Annual FX rates | Optional |
| `open.er-api.com` | 443 | Spot FX rates | Optional |

### Internal (no firewall rule needed from outside)

These connections stay on the server: loopback or the Docker networks.

| Connection | Port | Notes |
|------------|------|-------|
| nginx → API container | 8080 | Bound to `127.0.0.1` |
| nginx → web container | 8081 | Bound to `127.0.0.1` |
| API container → PostgreSQL | 5432 | Via `host.docker.internal`, which is the Docker bridge address of the server (`172.17.0.1` by default). Allow it from the Docker networks only (`172.16.0.0/12`). |
| API container → object storage | 9000 | Same path. In the installation example the storage listens on `172.17.0.1` only. |
| API container → mail relay on the server | Its `SMTP_PORT` | Only when the relay runs on the KANAP server. Same path: the relay listens on `172.17.0.1`, and the rule allows its port from `172.16.0.0/12`. |

`172.16.0.0/12` covers every network Docker creates by default. A narrower rule uses the network of the KANAP containers: after the first start, `docker network inspect infra_default` shows its subnet.

## Background jobs

The API runs 15 scheduled jobs. The times below are the defaults, in UTC (the clock of the API container). Administrators see the jobs under **Admin → Scheduled Tasks** (see [Scheduled Tasks](../scheduled-tasks.md)), where each one can be switched off, rescheduled or run on demand.

| Job | When | What it does |
|-----|------|--------------|
| `check-expirations` | Daily 08:00 | Emails the owners of contracts and OPEX items 30, 14, 7 and 1 day(s) before a cancellation deadline, an end date or the end of validity. Only users who switched these notifications on receive them, once per day. |
| `send-weekly-reviews` | Hourly | Sends the weekly review digest to users who opted in, at their own day and time zone. |
| `lifecycle-status-sync` | Hourly, and once at start | Switches master data, contracts, OPEX and CAPEX items to disabled once their end of validity has passed. |
| `entra-directory-sync` | Daily 03:00 | Refreshes user attributes and disables accounts removed or deactivated in the directory. Works only when Entra SSO is connected and approved. See [Microsoft Entra SSO](sso-entra.md). |
| `attachment-orphan-cleanup` | Daily 03:00 | Removes the attachment records of inline images that no text uses any more. |
| `storage-ghost-cleanup` | Sunday 04:00 | Removes stored files that have no attachment record and are older than 7 days. |
| `list-context-purge` | Daily 03:30 | Deletes saved list filters nobody used for 90 days. |
| `auth-event-retention` | Daily 03:40 | Deletes sign-in events older than 365 days from the audit log. |
| `ai-conversation-retention` | Daily 02:00 | Archives and purges AI conversations according to the retention settings. |
| `ai-search-index-reindex` | Daily 03:00 | Rebuilds the search index used by the AI features. |
| `ai-agent-activity-retention-purge` | Daily 03:25 | Deletes agent activity older than each agent's retention. |
| `ai-mutation-preview-expiration` | Every 5 minutes | Expires AI change previews that nobody approved in time. |
| `ai-helpdesk-glpi-new-ticket-ingestion` | Every 5 minutes | Reads new GLPI tickets for the helpdesk agent. |
| `ai-sre-monitoring-alert-ingestion` | Every 5 minutes | Reads new alerts of the connected monitoring tool for the SRE agent. |
| `netbox-inventory-sync` | Hourly | Keeps assets in step with the connected Netbox inventory. |

The jobs of the Entra, Netbox, GLPI, monitoring and AI features find nothing to do until that feature is set up.

With several API processes (`API_WORKERS`), each job still runs once per scheduled time: the processes agree through the database on which one runs it. When the API stops (an upgrade), a job in progress gets the drain time to finish; one still running then is shown as failed ("interrupted") in the scheduled tasks list and runs again at its next time.

The jobs need the API to run as a long-running process, which the containers do. `check-expirations` and `send-weekly-reviews` build their email links from `APP_BASE_URL`. If it is not set, they skip their work and the API writes one log line ("application URL is not configured"). If no outbound email transport is configured, they skip sending.
