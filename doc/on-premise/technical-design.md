# On-Premise Technical Design

This document describes the technical design for on-premise deployments. User-facing steps are in `doc/help/docs/en/on-premise/`.

**Status:** Implemented (Phase 1 MVP, 2026-02-15)

## Architecture Decisions (v1)

- **Single repo, feature flags** (no branches)
- **Single-tenant mode only** for on-prem v1
- **Customer-provided infrastructure** (PostgreSQL, S3-compatible storage, TLS/reverse proxy)
- **Build from source** (no registry management)
- **Email:** Resend API by default; single-tenant SMTP support available for on-prem

## Works Out of the Box

- **Database & RLS:** PostgreSQL 15 and later (16 in CI, 16 and 18 tested on-premise) work with Row-Level Security unchanged when `DATABASE_URL` uses a dedicated application role; startup fails instead of running with a role that can bypass RLS
- **Database requirement, list engine:** PostgreSQL must provide the ICU collation `und-x-icu` (a build with ICU: the official, PGDG and Alpine images are) and the function `public.unaccent(text)` (the `unaccent` extension in schema `public`; the migrations create it when the extension files are installed). The OPEX and CAPEX lists sort, filter and search in SQL with them. Check before deploying, as the application role: `SELECT EXISTS (SELECT 1 FROM pg_collation WHERE collname = 'und-x-icu' AND collprovider = 'i') AS icu, to_regprocedure('public.unaccent(text)') IS NOT NULL AS unaccent;` must return `true, true`. Without either, the API still starts, logs `List engine disabled: missing …` once at startup, and the OPEX and CAPEX list endpoints answer 503 with the same requirement. The database sorts with its own ICU library and the API joins the project names of a line with Node's: both use the root collation, so they agree except on characters one ICU version knows and the other does not
- **Database requirement, analytics values:** the values of a dimension sort by their position, then by name with the same ICU collation: the values list, its CSV export, the reorder and the value pickers need it like the OPEX and CAPEX lists. Without it the migration that numbers the existing values still runs (it falls back to `lower(name), name`) and the API starts, but those endpoints fail
- **Storage:** S3-compatible storage via AWS SDK v3 S3 client (`S3_ENDPOINT`). Any S3-compatible store works; tested with RustFS (the store of the on-premise installation example, since MinIO stopped publishing binaries and images), Garage, MinIO, AWS S3, Cloudflare R2 and Hetzner Object Storage
- **Billing:** Disabled when `STRIPE_SECRET_KEY` is not set (backend returns `FEATURE_DISABLED`, UI hides billing features)
- **Migrations:** Run automatically on container startup (`migrate-and-start.js`)
- **Local Auth:** Username/password works without external dependencies
- **SSO:** Entra ID is optional; local auth is fallback
- **FX Rates:** Gracefully degrades if API keys are not configured
- **Email links:** Built from `APP_BASE_URL` in single-tenant mode (no subdomain derivation); request headers are not read outside local development

## Deployment Modes

`DEPLOYMENT_MODE` is the differentiator between cloud and on-prem.

| Value | Description | Use Case |
|-------|-------------|----------|
| `multi-tenant` (or unset) | Cloud mode: subdomain-based tenant resolution | SaaS |
| `single-tenant` | On-prem mode: fixed tenant, no subdomain parsing | Customer self-hosted |
| any other value | The API refuses to start. The message names the accepted values. | |

**Effects:**
- Tenant resolution (routing)
- First-boot initialization (auto-create tenant/admin/subscription)
- Platform-admin access (fully disabled in single-tenant)
- SaaS-only endpoints (return 404 in single-tenant)
- UI elements (billing, platform admin, SSO hidden when features disabled)

## Feature Flags

Single source of truth: `backend/src/config/features.ts`. `parseDeploymentMode` (`backend/src/common/deployment-mode.ts`) accepts `single-tenant`, `multi-tenant` and unset, and throws on any other value when the module loads. `validateStartupEnv` repeats that check.

```typescript
const deploymentMode = parseDeploymentMode(process.env.DEPLOYMENT_MODE);
const isSingleTenant = deploymentMode === 'single-tenant';

export const Features = {
  DEPLOYMENT_MODE: deploymentMode,
  SINGLE_TENANT: isSingleTenant,
  STRIPE_BILLING: !isSingleTenant && !!process.env.STRIPE_SECRET_KEY,
  ENTRA_SSO: !!process.env.ENTRA_CLIENT_ID,
  EMAIL_ENABLED: isSingleTenant
    ? !!(process.env.SMTP_HOST && process.env.SMTP_FROM) || !!process.env.RESEND_API_KEY
    : !!process.env.RESEND_API_KEY,
};
```

Discipline:
- Keep flags minimal and centralized in this file
- Every PR must work in both modes (CI matrix enforces this)

## Error Contract

Disabled features return structured HTTP responses via `backend/src/common/feature-gates.ts`:

- **`throwNotAvailableInMode()`** — `404 Not Found` for SaaS-only endpoints (trial, support invoice)
- **`throwFeatureDisabled(feature)`** — `403 Forbidden` with body `{ code: "FEATURE_DISABLED", feature, message }`
- **`FeatureDisabledError`** — custom Error class with stable `.code` property for internal service use (e.g., `email.service.ts`)
- **`MultiTenantOnlyGuard`** — NestJS guard returning `404` for platform-admin controllers

Frontend recognizes `FEATURE_DISABLED` in the API client and does not redirect on these errors.

## Tenant Resolution

**Cloud (multi-tenant)** — `backend/src/main.ts` inline tenancy middleware:
- Extracts subdomain from `Host`
- Recognizes: `*.kanap.net`, `*.dev.kanap.net`, `*.qa.kanap.net`, `*.lvh.me`
- Looks up tenant by slug
- Returns 404 if tenant not found

**On-Prem (single-tenant)** — early return at top of same middleware:
- Ignores `Host` for tenant routing
- Always resolves to `DEFAULT_TENANT_SLUG`
- Any domain/IP works (no wildcard DNS)
- If tenant not yet provisioned (first-boot race), returns `503 TENANT_NOT_READY`

**Important:** `Host` does not build any link. Password reset, invitation, Entra sign-in and export links come from the configured address (`APP_BASE_URL`; see URL Resolution). Without it those endpoints answer 400 `application URL is not configured: set APP_BASE_URL`. `Host` and `X-Forwarded-Proto` still matter for the request's own address in the origin policy and for the `Secure` cookie attribute when `APP_ENV` is unspecified. Only in development mode and on a local development host (`lvh.me`, `localhost`, `*.localhost`, `dev.kanap.net`) do links follow the request host.

## Database Role Safety

- `DATABASE_URL` must point to a dedicated application role, not `postgres` or another cluster-admin role.
- KANAP never intentionally runs application traffic as a PostgreSQL role with `SUPERUSER` or `BYPASSRLS`.
- On first migration, a dedicated but over-privileged app role is hardened to `NOSUPERUSER NOBYPASSRLS`.
- Protected cluster-admin roles are rejected during migration/startup so tenant isolation cannot silently degrade.
- Startup performs a runtime safety check before seeding/admin bootstrap work begins.

## Platform-Admin Handling

- `isPlatformAdmin()` returns `false` unconditionally in single-tenant mode (top of function, before any allowlist/role check)
- `PLATFORM_ADMIN_HOST` is effectively ignored since tenant resolution skips host parsing
- Platform admin controllers (`/admin/tenants`, `/admin/coa-templates`) are guarded by `MultiTenantOnlyGuard` — return 404 in single-tenant
- Platform-admin tenant row remains in the DB (same migrations everywhere) but is never routed to

## First-Boot Initialization

On first startup in single-tenant mode (`backend/src/main.ts`, before tenancy middleware):

1. Migrations run (same as cloud)
2. If `DEFAULT_TENANT_SLUG` does not exist, create tenant via `TenantsService.createTenant()` (idempotent)
3. On every start, when `ADMIN_EMAIL` and `ADMIN_PASSWORD` are both set, `ensureBootstrapAdministrator` keeps the Administrator and Contact system roles in place, with full permissions on Administrator. The `ADMIN_EMAIL` account is created when the workspace has no active administrator. If that account already exists, it is restored as an enabled administrator and keeps its password: `ADMIN_PASSWORD` is stored only for a local account that has none. While an active administrator exists, the account stays as it is. If either variable is empty, this step is skipped and the log says nothing about it.
4. Bootstrap subscription row: `plan_name = 'On-Prem'`, `seat_limit = NULL` (no user limit), `status = 'active'`

**Safety net:** `billing.service.ts` `ensureSubscription()` also defaults to On-Prem with no user limit when `Features.SINGLE_TENANT` is true, and to Trial with no user limit otherwise. At startup, a single-tenant install clears any user limit left on its subscription.

Existing `SEED_ADMIN=true` path remains available for cloud/QA bootstrapping and is independent.

## SaaS-Only Endpoints (Disabled in Single-Tenant)

These return 404:
- `POST /public/start-trial`
- `POST /public/activate-trial`
- `POST /public/request-support-invoice`
- All `/admin/tenants/*` endpoints
- All `/admin/coa-templates/*` endpoints

## Feature-Gated Endpoints

These return `403 FEATURE_DISABLED` when the relevant feature is off:

| Feature | Endpoints |
|---------|-----------|
| `billing` (Stripe off) | All `/billing/*` endpoints |
| `email` (no valid transport configured) | `POST /auth/password-reset/request`, `POST /users/:id/invite`, `POST /users/me/notification-preferences/test-weekly-review` |

## URL Resolution (Notifications & Exports)

`resolveConfiguredAppBaseUrl()` in `backend/src/common/url.ts` is the single source of the application address. It reads configuration only; request headers are ignored outside development mode on a local development host.
- **Single-tenant:** `APP_BASE_URL`, then `PUBLIC_APP_URL`, as configured (no subdomain logic)
- **Multi-tenant:** the first of `APP_BASE_URL`, `PUBLIC_APP_URL`, `APP_URL` whose host is on a known tenant domain, turned into the tenant's address (slug substitution, `//app.` → `//{slug}.`, scheme and port kept); when none is, the first one as configured
- **Nothing configured:** `resolveAppBaseUrl()` and `resolveTenantAppBaseUrl()` (password reset, invitation, Entra, knowledge links) throw 400 `application URL is not configured: set APP_BASE_URL`; `resolveNotificationBaseUrl()` throws; the scheduled expiration and weekly review runs are skipped with one log line; the XLSX export of the portfolio weekly report falls back to relative links. There is no default address.

Used by: `scheduled-notifications.service.ts`, `notifications.service.ts`, `portfolio-status-change-report.controller.ts`, `portfolio-weekly-report.controller.ts`, `users.service.ts` and `auth.controller.ts` (password reset, invitation), `entra.controller.ts`, `knowledge.controller.ts`

## Run Mode and Browser Origins

`getRuntimeMode()` in `backend/src/common/env.ts` reads `APP_ENV`, or `NODE_ENV` when `APP_ENV` is absent:

| Mode | Values | Effect |
|------|--------|--------|
| `development` | `development`, `dev`, `local`, `test` | Links follow a local development host; `CORS_ORIGINS` entries match as written and an empty value allows every origin; `PLATFORM_ADMIN_EMAILS=*`; unsigned Stripe webhooks |
| `production` | `production`, `prod` | Start-up requires `APP_BASE_URL` and `CORS_ORIGINS`; `Secure` cookie always |
| `unspecified` | anything else or absent | Production rules for links, origins and platform administration; missing values are start-up warnings; the cookie follows the request |

`validateStartupEnv()` throws only for `DATABASE_URL`, `JWT_SECRET` and, in production mode, `APP_BASE_URL` and `CORS_ORIGINS`. It returns warnings printed as `[ENV] run mode: ...`, `[ENV]`, `[CONFIG]` and `[CORS]` lines.

`backend/src/common/cors-policy.ts` holds the origin policy shared by the CORS middleware and the cookie-based session routes. A request without `Origin` passes. Otherwise the origin is accepted when it is:
- an exact entry of `CORS_ORIGINS`;
- the application address (`APP_BASE_URL`, or the tenant's address in multi-tenant mode);
- the address of the request (host and port equal to `Host`; outside production mode, the host name only when `Host` has no port);
- multi-tenant: a pattern entry (`https://*.kanap.net`), for the tenant the request targets only;
- single-tenant: a pattern entry as written, with a start-up warning (a later version accepts exact entries only);
- development mode: entries as written, and every origin when `CORS_ORIGINS` is empty.

In unspecified mode with `CORS_ORIGINS` empty and no application address, every origin stays allowed in this version (start-up warning). A refused origin gets a 403 JSON answer without CORS headers, logged once per origin and per minute (`[CORS] Rejected origin`). `POST /auth/refresh` and `POST /auth/logout` apply the same policy to `Origin` (or `Referer` when `Origin` is missing) and answer 403 when it is refused.

## Frontend Configuration

Frontend reads public configuration at startup via `FeaturesContext.tsx`:

```
GET /api/config/public
→ {
    "deploymentMode": "single-tenant",
    "features": { "billing": false, "sso": false, "email": true },
    "version": "0.1.0"
  }
```

- **Fail-open:** On fetch error or 5s timeout, defaults to cloud mode (all features enabled)
- **No auth required:** Works before login, no tenant context needed
- **Route gating:** Disabled feature routes are removed from the router (not just hidden)
- **Nav filtering:** Layout hides billing/auth/platform-admin nav items based on features

## Behavioral Differences Summary

| Aspect | Cloud (multi-tenant) | On-Prem (single-tenant) |
|--------|----------------------|-------------------------|
| Tenant resolution | Subdomain from `Host` | Fixed `DEFAULT_TENANT_SLUG` |
| Valid domains | `*.kanap.net` only | Any domain |
| DNS requirements | Wildcard DNS | Simple A record |
| Platform-admin | Active (allowlist or role) | Fully disabled (`isPlatformAdmin()` → false) |
| Platform admin endpoints | Accessible | Return 404 (MultiTenantOnlyGuard) |
| Tenant creation | Platform-admin UI or trial | Auto-created on first boot, with the default global chart of accounts |
| Multiple tenants | Yes | No (single tenant only) |
| Platform-admin nav | Visible (if user has access) | Hidden |
| Trial / support endpoints | Active | Return 404 |
| Billing | Stripe-based | Disabled (`FEATURE_DISABLED`) |
| Subscription defaults | Trial, no user limit | On-Prem, no user limit |
| Application address (links, redirects, exports) | `APP_BASE_URL`, `PUBLIC_APP_URL`, `APP_URL` + slug substitution | `APP_BASE_URL` directly |

## CI Matrix

`.github/workflows/ci.yml` runs `npm ci && npm run build` for both backend and frontend in two modes:

| Matrix entry | `DEPLOYMENT_MODE` |
|-------------|-------------------|
| `cloud` | *(unset)* |
| `onprem` | `single-tenant` |

Both modes must build clean. This catches import/type errors from feature flag usage.

## Env Validation (Startup)

Required at startup (enforced by `validateStartupEnv()`):
- `JWT_SECRET`
- `DATABASE_URL`
- `APP_BASE_URL` and `CORS_ORIGINS` (in production mode, `APP_ENV=production`)

Fail fast with a clear error if missing. Outside production mode a missing `APP_BASE_URL` or `CORS_ORIGINS` is a start-up warning (see Run Mode and Browser Origins).

## Token Family Secrets and Purpose Typing

Every token this application signs is typed and signed per family. The policy is identical in both
deployment modes, and applies to agents that build external integrations (the cloud provisioning
service reads the same rules).

| Family | Marker | Key | Verifier |
|--------|--------|-----|----------|
| Access token | `purpose: 'access'` | `JWT_SECRET` | `JwtAuthGuard` |
| Password-reset link | `purpose: 'kanap:v1:password-reset'` | `PASSWORD_RESET_SECRET`, else derived | `AuthService.resetPasswordWithToken` |
| Provisioning exchange | `purpose: 'provision'` | `PROVISIONING_TOKEN_SECRET`, else `JWT_SECRET` | `AuthController.exchangeProvisioningToken` |
| Entra SSO state | `purpose: 'kanap:v1:entra-state'` | `ENTRA_STATE_SECRET`, else derived | `EntraAuthService.verifyState` |
| Entra login handoff | `type: 'entra_login_handoff'` | idem SSO state | `EntraAuthService.verifyLoginHandoff` |
| MCP OAuth authorization code | `purpose: 'kanap:v1:mcp-oauth-code'` | `MCP_OAUTH_CODE_SECRET`, else derived | `McpOAuthService` (token endpoint) |
| MCP OAuth access token | `purpose: 'kanap:v1:mcp-access'` | `MCP_ACCESS_TOKEN_SECRET`, else derived | `McpApiKeyAuthGuard` (MCP endpoint only) |
| Creation token (HMAC, not a JWT) | label `kanap:v1:creation`, signs tenant, family, record, creator, issue time | `CREATION_TOKEN_SECRET`, else derived | `verifyCreationToken` (`DELETE /applications/:id/creation`) |

Rules:

- A family with a configured key uses **only** that key — never a retry with `JWT_SECRET` after a
  failure. Without its own variable, password-reset, SSO state, the two MCP OAuth families and the creation token derive a key from `JWT_SECRET`
  through HMAC-SHA256 with a stable, versioned label (`kanap:v1:<family>`, `token-secret.util.ts`).
  The label version is a contract: bumping it rotates that family's key material.
- **Provisioning is the deliberate exception.** Its tokens are minted by a service outside this
  repository, which cannot compute a derived key, so the marker stays `provision` and the key stays
  `JWT_SECRET` until `PROVISIONING_TOKEN_SECRET` is set — and then that key is the only accepted one
  (lockstep deploy with the issuer). Sharing `JWT_SECRET` here is safe because the guard refuses the
  marker; what made it dangerous was the missing purpose control.
- Each family is accepted only in the algorithm it is issued with (`auth/jwt-algorithms.ts`):
  HS256 for access, password-reset, SSO state and SSO handoff tokens, which the API signs with
  HS256; any HMAC algorithm (HS256, HS384, HS512) for provisioning, whose issuer is outside this
  repository; RS256 for the Entra ID token.
- `JwtAuthGuard` accepts only access tokens (RFC 8725 §3.12, "Use Explicit Typing"). Signature and
  tenant checks alone would accept any family, since all of them carry a valid `sub`/`tenant_id`.
  `purpose` is tested explicitly: `null`, `''`, a number, an object, another family's marker and the
  handoff's `type` are all rejected. Shape is checked on **every** acceptance path — a non-empty
  `sub` and no `type` claim — so a marked token cannot also be something else. A marker-less payload
  is accepted **only** before `JWT_LEGACY_ACCESS_TOKEN_DEADLINE`, when the operator sets one, and
  only with that shape; without that variable it is refused at all times, including right after a
  start. An SSO state from an older build (`mode`/`nonce`, no `sub`) is therefore refused from day
  one.
- Start-up reports where each family key comes from, plus how access tokens without the marker are
  handled (`[SECRETS]` lines in `main.ts`). The line is informational when they are refused (the
  default) or accepted until a future deadline, and a warning when the deadline is unparseable or
  already past (both refuse them).
- **Upgrade impact (both modes, once):**
  - Password-reset links and Entra SSO states minted before the upgrade stop verifying, because
    their family key changes even when no dedicated variable is configured.
  - Provisioning keeps working untouched, until an operator sets `PROVISIONING_TOKEN_SECRET`; from
    that moment the issuer must sign with the same key.
  - Untyped access tokens are refused, unless `JWT_LEGACY_ACCESS_TOKEN_DEADLINE` sets an explicit
    future instant until which they stay accepted. In the web UI this costs one extra round trip (a
    401 triggers `/auth/refresh`, and refresh tokens are unaffected); only clients holding a stale
    `Bearer` token of their own break. Builds that have the marker issue only marked access tokens,
    so an upgrade from one of them changes nothing for signed-in users. Announce both effects before
    deploying.

---

## Feature Gate Inventory

**This is the definitive reference for every location in the codebase where behavior differs between cloud and on-prem.** Update this section whenever you add, move, or remove a feature gate.

### Key Files

| File | Role |
|------|------|
| `backend/src/config/features.ts` | Feature flag definitions (single source of truth) |
| `backend/src/common/feature-gates.ts` | Gate utilities: `throwNotAvailableInMode()`, `throwFeatureDisabled()`, `FeatureDisabledError`, `MultiTenantOnlyGuard` |
| `backend/src/config/config.controller.ts` | `GET /config/public` — exposes flags to frontend |
| `frontend/src/config/FeaturesContext.tsx` | React context: fetches `/api/config/public`, provides `useFeatures()` hook |
| `backend/src/ai/ai-policy.service.ts` | Central AI surface/capability gating for chat, MCP, settings, and readable AI tools |
| `backend/src/ai/ai-tool.registry.ts` | Runtime AI tool availability checks, including web search gating |

### Backend Gates

#### Deployment mode (`Features.SINGLE_TENANT`)

| File | Line | What | Behavior |
|------|------|------|----------|
| `main.ts` | 360 | First-boot provisioning | Creates tenant, admin user, subscription (On-Prem, no user limit) |
| `main.ts` | 324 | Tenancy middleware | Skips Host parsing, resolves to `DEFAULT_TENANT_SLUG`; returns 503 if tenant not ready |
| `platform-admin.util.ts` | 18 | `isPlatformAdmin()` | Returns `false` unconditionally |
| `public.controller.ts` | 157 | `POST /public/start-trial` | 404 |
| `public.controller.ts` | 277 | `POST /public/request-support-invoice` | 404 |
| `public.controller.ts` | 373 | `POST /public/activate-trial` | 404 |
| `admin-tenants.controller.ts` | 10 | All `/admin/tenants/*` | 404 via `MultiTenantOnlyGuard` |
| `admin-coa-templates.controller.ts` | 11 | All `/admin/coa-templates/*` | 404 via `MultiTenantOnlyGuard` |
| `admin-ops.controller.ts` | 11 | All `/admin/ops/*` | 404 via `MultiTenantOnlyGuard` |
| `billing.service.ts` | 1280 | `ensureSubscription()` fallback | Defaults to On-Prem, no user limit (single-tenant) or Trial, no user limit (cloud) |
| `url.ts` | 164 | `resolveConfiguredAppBaseUrl()` | Single-tenant: `APP_BASE_URL` (then `PUBLIC_APP_URL`) as configured, no subdomain substitution; nothing configured returns null and callers answer 400 or skip |
| `portfolio-status-change-report.controller.ts` | 134 | Export base URL | Delegates to `resolveNotificationBaseUrl()` |
| `feature-gates.ts` | 34 | `MultiTenantOnlyGuard` | Throws 404 when `SINGLE_TENANT` is true |
| `ai/ai-help-manual.service.ts` | 310 | User manual of the assistant (`list_help_topics`, `read_help_section`) | The on-premise installation pages (`on-premise/*`) are listed and read in single-tenant mode only |

#### Sample data (cloud only, `!Features.SINGLE_TENANT`)

Administration > Sample data loads the Fromage & Co set into an empty workspace and erases a workspace back to its starting state. On-premise there is no navigation entry and no home banner, every API route answers 404, and the page refuses itself. The flag is `sampleData` in `GET /config/public`.

| File | Line | What | Behavior |
|------|------|------|----------|
| `demo-data/demo-data.controller.ts` | 29, 89 | All `/admin/sample-data/*` routes | 404 via `MultiTenantOnlyGuard`; also 404 on the platform host and for system tenants. Administrator role checked by the service on every route (403 `administrator_required`) |
| `demo-data/demo-data.service.ts` | 749 | `readTenant()` | `throwNotAvailableInMode()` when `SINGLE_TENANT`: the service refuses by itself, whoever calls it |
| `demo-data/demo-data.service.ts` | 687 | `reconcileOnStartup()` | No-op when `SINGLE_TENANT` (no sweep of orphaned loads or resets) |
| `config/config.controller.ts` | 23 | `sampleData` | `!Features.SINGLE_TENANT` in `GET /config/public` |
| `frontend/src/config/FeaturesContext.tsx` | 15, 37 | `sampleData` | Type key; default `false`, so the feature stays hidden if `/config/public` cannot be read |

#### Microsoft Entra (`Features.ENTRA_SSO`)

Optional in both modes: true when `ENTRA_CLIENT_ID` is configured. Per-tenant activation lives on `tenants.sso_provider` / `sso_enabled`; everything below is inert for tenants without Entra.

| File | Line | What | Behavior |
|------|------|------|----------|
| `entra-directory-sync.service.ts` | 68 | `entra-directory-sync` scheduled task (default daily 03:00) | Registered in both modes; handler (line 79) returns `skipped` when `ENTRA_SSO` is false, otherwise iterates active tenants with `sso_provider='entra'` under RLS. Tenants whose Entra admin has not granted application consent are reported `consent_required` and keep login-time enrichment only. The contributor reporting line imported from the directory rides on the same gate (`syncDirectoryManagers`, same file) |
| `admin-auth.controller.ts` | 58 | `POST /admin/auth/directory-sync` | 400 `SSO_NOT_CONFIGURED` when `ENTRA_SSO` is false |
| `admin-auth.controller.ts` | 42 | `GET /admin/auth/settings` → `directory_sync` | `null` unless the tenant is connected to Entra and `ENTRA_SSO` is true |

#### Billing (`Features.STRIPE_BILLING`)

| File | Line | What | Behavior |
|------|------|------|----------|
| `billing.controller.ts` | 142 | `GET /billing/plans` | 403 `FEATURE_DISABLED` |
| `billing.controller.ts` | 148 | `GET /billing/subscription` | 403 `FEATURE_DISABLED` |
| `billing.controller.ts` | 156 | `POST /billing/change-plan` | 403 `FEATURE_DISABLED` |
| `billing.controller.ts` | 201 | `POST /billing/scheduled-change/cancel` | 403 `FEATURE_DISABLED` |
| `billing.controller.ts` | 169 | `POST /billing/request-invoice` | 403 `FEATURE_DISABLED` |
| `billing.controller.ts` | 182 | `GET /billing/profile` | 403 `FEATURE_DISABLED` |
| `billing.controller.ts` | 197 | `POST /billing/portal` | 403 `FEATURE_DISABLED` |
| `billing.controller.ts` | 211 | `POST /billing/checkout` | 403 `FEATURE_DISABLED` |
| `billing.controller.ts` | 236 | `PATCH /billing/profile` | 403 `FEATURE_DISABLED` |

#### Email (`Features.EMAIL_ENABLED`)

| File | Line | What | Behavior |
|------|------|------|----------|
| `auth.controller.ts` | 206 | `POST /auth/password-reset/request` | 403 `FEATURE_DISABLED` |
| `users.controller.ts` | 106 | `POST /users/:id/invite` | 403 `FEATURE_DISABLED` |
| `notification-preferences.controller.ts` | 46 | `POST /users/me/notification-preferences/test-weekly-review` | 403 `FEATURE_DISABLED` |
| `email.service.ts` | 183 | `ensureClient()` internal | Throws `FeatureDisabledError('email')` — caught by callers via `error.code` |
| `public.controller.ts` | 221, 356, 467 | Trial/activation catch blocks | Checks `error.code === 'FEATURE_DISABLED'` — suppresses, returns graceful fallback |

#### AI Chat / MCP / Settings / Web Search (`Features.AI_CHAT_ENABLED`, `Features.AI_MCP_ENABLED`, `Features.AI_SETTINGS_ENABLED`, `Features.AI_WEB_SEARCH_READY`)

| File | Line | What | Behavior |
|------|------|------|----------|
| `backend/src/config/config.controller.ts` | 10 | `GET /config/public` feature payload | Exposes `aiChat`, `aiMcp`, `aiSettings`, `aiWebSearch`, and `builtinAiProvider` to the frontend |
| `backend/src/config/config.controller.ts` | 24 | `builtinAiProvider` gate | Returns `true` for cloud deployments and `false` in single-tenant mode |
| `backend/src/ai/ai-capabilities.controller.ts` | 1 | `GET /ai/capabilities` | Returns per-surface AI availability derived from feature flags, tenant settings, permissions, and provider readiness |
| `backend/src/ai/ai-policy.service.ts` | 1 | Surface and permission checks | `assertSurfaceAccess()`, `assertSettingsAccess()`, `assertKeyManagementAccess()`, and readable-entity/knowledge probes enforce AI gates |
| `backend/src/ai/ai-chat.controller.ts` | 1 | `POST /ai/chat/stream` | Chat surface is unavailable when native AI chat is disabled by feature flag or tenant settings |
| `backend/src/ai/ai-mcp.controller.ts` | 1 | MCP endpoints | MCP surface is unavailable when MCP is disabled by feature flag or tenant settings |
| `backend/src/ai/ai-settings.controller.ts` | 1 | AI settings endpoints | AI settings surface is unavailable when the AI settings feature is disabled |
| `backend/src/ai/ai-tool.registry.ts` | 1 | Chat `web_search` tool registration and execution | The Plaid **chat** web search tool is only listed and executable when `AI_WEB_SEARCH_READY` is true and the tenant chat web search toggle is enabled |
| `backend/src/ai/control-plane/capability/ai-capability.registry.ts` | 1 | Control-plane `web_search` capability | A separate governed internal capability used by agents (e.g. Helpdesk triage). Shares the same `AI_WEB_SEARCH_READY` readiness gate (`BRAVE_SEARCH_API_KEY`) but is independent of the tenant chat toggle and is gated per-agent by that agent's own "Search the web" setting. Not exposed over MCP. Mode-agnostic — no cloud/on-prem branch. |
| `backend/src/ai/control-plane/agent-control/ai-ticket-evidence-extraction.service.ts` | 1 | Agent screenshot evidence extraction | **Not a feature gate.** Vision is best-effort on the tenant's default LLM (the one shared with Plaid chat); whether to attempt it is the per-tenant admin-GUI setting `ai_settings.llm_supports_vision` (default ON). When the model is text-only the vision call errors or is ignored and GLPI triage silently degrades to text. No `AI_AGENT_VISION_*` runtime config. |
| `backend/src/ai/control-plane/agent-control/ai-agent-control.controller.ts` | 83 | `ai/admin/control-plane` agent surface (all agent overview/approvals/activity/settings/shared-context APIs) | The entire AI Agents control-plane API is gated by `AiPolicyService` access checks on the `ai_agents` resource; unavailable when the AI settings surface is disabled. This is the top-level gate behind every `/agents` page. |
| `frontend/src/components/Layout.tsx` + `frontend/src/App.tsx` | 1 | AI Agents nav group + `/agents/*` routes | The whole **AI Agents** section (Overview, Approvals, Activity, Shared context, and the per-agent workspace) is hidden unless `features.aiSettings` is true, the instance AI-settings capability is on, and the user has `ai_agents:reader`; the Shared context item additionally requires `ai_agents:admin`. |
| `frontend/src/config/FeaturesContext.tsx` | 1 | Frontend feature bootstrap | Normalizes AI feature flags from `/config/public` for route and UI gating |
| `frontend/src/pages/ai/AiWorkspacePage.tsx` | 1 | Plaid workspace route | Hides native AI chat UI when `aiChat` is false |
| `frontend/src/pages/admin/AdminAiPage.tsx` | 1 | Admin AI settings page | Hides AI settings and web search controls when the corresponding flags are false |

#### Living catalog of technologies (`Features.TECHNOLOGY_CATALOG_SYNC_ENABLED`)

The living catalog reads the release cycles of endoflife.date (`https://endoflife.date/api/v1`, or a mirror in `ENDOFLIFE_API_BASE_URL`) for the catalog entries the technologies were adopted from. `TECHNOLOGY_CATALOG_SYNC_ENABLED` is true by default in the cloud and false by default on-premise; set either way, it wins. Off, nothing leaves for endoflife.date: the scheduled task `technology-catalog` still runs at each start and daily (while it is enabled in the scheduled tasks), the cache is not read, and the task brings the catalog shipped with the installed version to the adopted technologies (new versions, dates and CPE identifiers, the withdrawal of an identifier `shipped_cpe` listed, that `cpe_written` records as written by the catalog, and that the shipped file no longer lists (a file that lists no identifier without `noCpe` withdraws nothing, a cache identifier stays while the cache omits it, and an identifier the tenant typed is kept), and a description the catalog wrote in `description_language` when that language's text changes and the technology still holds the same characters (a change of the tenant's language rewrites nothing, and a state without `description_language` takes the language whose catalog text equals the remembered description or is left unchanged when none does)). CVE.org names follow the same pass: a name the catalog gains is added, a name the tenant removed stays removed, and a name is removed only when `cve_names_written` lists it, `shipped_cve_names` listed it and the shipped file no longer does. A state without those keys removes nothing. An empty name list withdraws the names that rule names. A value the tenant typed stays. The frontend shows nothing different.

| File | Line | What | Behavior |
|------|------|------|----------|
| `config/features.ts` | 20 | `TECHNOLOGY_CATALOG_SYNC_ENABLED` | Env value when set, otherwise `!SINGLE_TENANT` |
| `technologies/catalog/technology-catalog-sync.service.ts` | n/a | `technology-catalog` scheduled task (daily 04:40 UTC, and at start), registered in both modes | Reads endoflife.date only when on; syncs the tenants either way |
| `config/config.controller.ts` | 24 | `technologyCatalogSync` | `Features.TECHNOLOGY_CATALOG_SYNC_ENABLED` in `GET /config/public` |
| `frontend/src/config/FeaturesContext.tsx` | 43 | `features.technologyCatalogSync` | False until `GET /config/public` says otherwise; no screen depends on it |

#### Vulnerabilities (`Features.VULNERABILITY_FEED_ENABLED`)

The NVD feed needs the way out to the NVD (`https://services.nvd.nist.gov`) or to a mirror (`NVD_API_BASE_URL`). `VULNERABILITY_FEED_ENABLED` is true by default in the cloud and false by default on-premise; set either way, it wins. `NVD_API_KEY` is optional (more requests per 30 seconds). The same switch runs the exploitation signals (`vulnerability-signals`, minute 50 of every sixth hour): the CISA catalog (`KEV_FEED_URL`, default CISA's GitHub mirror `https://raw.githubusercontent.com/cisagov/kev-data/develop/known_exploited_vulnerabilities.json`; `www.cisa.gov` answers 403 to data-centre addresses), the EU catalog and the EUVD mapping (`EUVD_BASE_URL`, default `https://euvdservices.enisa.europa.eu`; a mirror serves `/api/kev/dump` and `/api/dump/cve-euvd-mapping` under it) and the EPSS scores (`EPSS_FEED_URL`, default `https://epss.empiricalsecurity.com/epss_scores-current.csv.gz`, gzip or plain CSV; see EPSS at https://www.first.org/epss). An empty variable keeps the default address. Outbound HTTPS, port 443: `raw.githubusercontent.com`, `euvdservices.enisa.europa.eu`, `epss.empiricalsecurity.com`. A source that cannot be reached leaves its columns as they are and is named in the task summary. The other sources and the NVD collection continue. The European record is ENISA's European vulnerability database. Off, the frontend shows none of it: no IT › Vulnerabilities page or navigation entry, no "Vulnerabilities to review" column in the technologies, assets and applications lists, no vulnerabilities section or severe badge on an asset or application record, no Vulnerabilities dashboard tile, no Technologies group in the notification preferences, and no email to the IT owners. With the feed on and email off (`EMAIL_ENABLED`), the run claims and sends nothing. With the feed on, the email lists critical or high CVE and, at any severity, CVE known to be exploited.

| File | Line | What | Behavior |
|------|------|------|----------|
| `config/features.ts` | 25 | `VULNERABILITY_FEED_ENABLED` | Env value when set, otherwise `!SINGLE_TENANT` |
| `vulnerabilities/vulnerabilities.controller.ts` | 19 | `VulnerabilityFeedGuard` on `/vulnerabilities/*` and `/technologies/:id/vulnerabilities/*` | 403 `FEATURE_DISABLED` when off |
| `vulnerabilities/nvd-feed.service.ts` | 217 | `vulnerability-feed` scheduled task (default every 6 hours, minute 20), and the notifications of each run | Registered only when on: no request leaves for the NVD and no vulnerability email goes out otherwise |
| `vulnerabilities/vulnerability-signals.service.ts` | 112 | `vulnerability-signals` scheduled task (minute 50 of every sixth hour) | Registered only when the feed is on. Updates the cached CVE from CISA, the EU KEV, EPSS and the EUVD mapping. One source failing leaves its columns and does not fail the task |
| `technologies/technologies.service.ts` | 213 | `vulnerabilities_to_review`, `vulnerabilities_severe` in `GET /technologies` (rows that alert) | `null` when off |
| `config/config.controller.ts` | 26 | `vulnerabilityFeed` | `Features.VULNERABILITY_FEED_ENABLED` in `GET /config/public` |
| `frontend/src/config/FeaturesContext.tsx` | 44 | `features.vulnerabilityFeed` | False until `GET /config/public` says otherwise |
| `frontend/src/App.tsx` | 272 | Route `/it/vulnerabilities` | Not registered when off |
| `frontend/src/components/Layout.tsx` | 189 | IT › Operations › Vulnerabilities navigation entry | Hidden when off |
| `frontend/src/pages/it/VulnerabilitiesPage.tsx` | 472 | The page itself (list grid, change of state in bulk, side panel) | Renders nothing when off |
| `frontend/src/pages/it/TechnologiesPage.tsx` | 230 | "Vulnerabilities to review" column, and the publisher's link to the page | Hidden when off (the publisher opens the technology) |
| `frontend/src/pages/settings/NotificationsTab.tsx` | 508 | Technologies group of the notification preferences | Hidden when off |
| `frontend/src/pages/it/workspace/TechnologyVulnerabilitiesSection.tsx` | 41 | Vulnerabilities section of the technology record | Renders nothing and reads nothing when off |
| `vulnerabilities/vulnerabilities.controller.ts` | 101 | `GET /vulnerabilities/home-summary` (dashboard tile) | Behind the class's `VulnerabilityFeedGuard`: 403 `FEATURE_DISABLED` when off |
| `vulnerabilities/vulnerabilities.controller.ts` | 146 | `VulnerabilityFeedGuard` on `GET /assets/:id/vulnerabilities` | 403 `FEATURE_DISABLED` when off |
| `vulnerabilities/vulnerabilities.controller.ts` | 162 | `VulnerabilityFeedGuard` on `GET /applications/:id/vulnerabilities` | 403 `FEATURE_DISABLED` when off |
| `vulnerabilities/vulnerability-reach-counts.ts` | 53 | `vulnerabilityCountsEnabled()`: every count per asset and per application (lists, records, assistant) | Counts `null` when off |
| `assets/services/assets-list.service.ts` | 37 | Sort and filter of `vulnerabilities_to_review` in `GET /assets` | Sorts as an unknown column, the filter matches nothing, counts `null` when off |
| `applications/services/applications-list.service.ts` | 562 | Sort and filter of `vulnerabilities_to_review` in `GET /applications` (`include=vulnerabilities`) | Same as the assets list |
| `vulnerabilities/vulnerability-list-column.ts` | 86 | `csvConfigForVulnerabilityFeed`: `vulnerabilities_to_review` and `severe_vulnerabilities` in the assets and applications CSV export | Columns left out of the export and its field list when off |
| `frontend/src/pages/it/AssetsPage.tsx` | 307 | "Vulnerabilities to review" column of the assets list | Hidden when off |
| `frontend/src/pages/it/ApplicationsPage.tsx` | 674 | "Vulnerabilities to review" column of the applications list | Hidden when off |
| `frontend/src/pages/it/AssetWorkspacePage.tsx` | 1071 | Vulnerabilities section (Technical tab) and severe badge of the asset record | Reads nothing and renders nothing when off |
| `frontend/src/pages/it/ApplicationWorkspacePage.tsx` | 1267 | Vulnerabilities section (Operations tab) and severe badge of the application record | Reads nothing and renders nothing when off |
| `frontend/src/pages/workspace/tiles/TileRegistry.ts` | 161 | `requiredFeature: 'vulnerabilityFeed'` on the Vulnerabilities dashboard tile (`useTilePermissions`) | Tile absent from the dashboard and its settings when off |
| `ai/ai-policy.service.ts` | 86 | `vulnerabilities` entity of the assistant and the MCP server | Left out of the readable families, refused with `vulnerabilityFeed` when off |

#### CVE.org names (`Features.CVE_LIST_FEED_ENABLED`)

The CVE.org list (cvelistV5) fills the platform cache of published records. `CVE_LIST_FEED_ENABLED` defaults to the vulnerability feed; a value set either way wins. `cveListEnabled()` is the two switches together, so the collector and the name routes stay idle while the vulnerability feed is off. With the list off and the feed on, `GET /vulnerabilities/cve-names` and `GET /technologies/:id/cve-names/suggestions` answer 403 `FEATURE_DISABLED` for `cveNames`. With the vulnerability feed off, the vulnerabilities controller answers for `vulnerabilityFeed` before the directory handler; the suggestions route answers for `cveNames`. The screen that reads `features.cveNames` is Technologies › Overview, section CVE.org names, and arrives in the following run. `GET /vulnerabilities/sources` reports both feeds in `items`, and the four exploitation catalogues (CISA KEV, EU KEV, EPSS, EUVD) in `signals`. `enabled` for the NVD and for each catalogue is `VULNERABILITY_FEED_ENABLED`, and for CVE.org it is `cveListEnabled()`. No new gate: the route uses the vulnerability-feed guard. The catalogues have no switch of their own.

| File | Line | What | Behavior |
|------|------|------|----------|
| `config/features.ts` | 31 | `CVE_LIST_FEED_ENABLED` | Env value when set, otherwise the vulnerability feed |
| `vulnerabilities/cve-list-feed.service.ts` | 101 | `cveListEnabled()` | True when the vulnerability feed and the CVE.org list are both on |
| `vulnerabilities/cve-list-feed.service.ts` | 132 | `collect` inside the 6-hour vulnerability pass | Returns a disabled summary and fetches nothing when `cveListEnabled()` is false |
| `vulnerabilities/cve-names.service.ts` | 42 | Directory and suggestions | 403 `FEATURE_DISABLED` (`cveNames`) when `cveListEnabled()` is false |
| `vulnerabilities/vulnerabilities.controller.ts` | 85 | `GET /vulnerabilities/cve-names` | `infrastructure:reader`. The feed guard answers first when the vulnerability feed is off |
| `technologies/technologies.controller.ts` | 301 | `GET /technologies/:id/cve-names/suggestions` | `infrastructure:reader`, the same right as reading the technology |
| `config/config.controller.ts` | 29 | `cveNames` | `cveListEnabled()` in `GET /config/public`, beside `vulnerabilityFeed` |
| `frontend/src/config/FeaturesContext.tsx` | 21 | `features.cveNames` | False until `GET /config/public` says otherwise. Technologies › Overview, section CVE.org names, arrives in the following run |

#### Excel workbooks in the data imports (`Features.IMPORT_XLSX`)

Every data import that takes a CSV file (the master-data lists, the IT and portfolio registers, the budget file, the technology link files, data access, the chart of accounts templates and the incident journal) also takes an Excel workbook (.xlsx): its first worksheet is read with the same columns, rules, preflight and report as the CSV file. `IMPORT_XLSX` is true by default in both modes; set to false, the imports are CSV only, as before the workbooks: the upload filter refuses an .xlsx or .xls by its name with the "save as CSV" sentence (`CSV_FILE_EXCEL`), a workbook that passes under another name meets the CSV decoder and the same sentence, and the dialogs offer `.csv` only. Import templates stay CSV files either way. Nothing leaves the server and no other component is involved: the reader is `backend/src/common/xlsx/read.ts`.

| File | Line | What | Behavior |
|------|------|------|----------|
| `config/features.ts` | 39 | `IMPORT_XLSX` | Env value when set, otherwise true |
| `common/upload.ts` | 58 | `isWorkbookUpload` in the `csv-import` file filter (every CSV import route, and the budget file through `budgetFileMulterOptions`) | Passes an .xlsx or .xls name, or the xlsx type, when on; the "save as CSV" refusal when off |
| `common/csv-sheet/read.ts` | 141 | `isWorkbookBytes`, read by `readSheet` (master-data files, budget file) and `readImportText` (field engine, registers' follow-up columns, chart of accounts templates, incident journal) | A ZIP or OLE file is read as a workbook when on; it goes to the CSV decoder when off |
| `config/config.controller.ts` | 31 | `importXlsx` | `Features.IMPORT_XLSX` in `GET /config/public` |
| `frontend/src/config/FeaturesContext.tsx` | 52 | `features.importXlsx` | False until `GET /config/public` says otherwise |
| `frontend/src/components/csv/importFiles.tsx` | 12 | `useImportFiles`, `ImportLabel` (import dialogs, budget file dialog, "Import CSV" buttons) | `.csv,.xlsx` and "Import" when on; `.csv` and the CSV labels when off |

#### Outbound target guard (`backend/src/common/ssrf-guard.ts`)

Shared by every tenant-supplied outbound URL: Netbox, PRTG and GLPI. Not a `Features` flag of its own, but mode-dependent.

| File | Line | What | Behavior |
|------|------|------|----------|
| `common/ssrf-guard.ts` | 44 | `shouldEnforce()` (`assertPublicHttpUrl`, `assertPublicHttpTarget`) | Multi-tenant: private / loopback / link-local / CGNAT / metadata ranges are refused. Single-tenant: no-op, since RFC1918 and internal-DNS targets are the normal case on-prem. Callers can force either way with `enforcePrivateBlock`. |
| `common/ssrf-guard.ts` | 56 | `SSRF_ALLOWED_HOSTS` | Operator escape hatch, comma-separated hosts/IPs allowed even when private. Empty by default, so cloud behavior is unchanged. Read per call. |

#### Netbox inventory (`backend/src/netbox/`)

No feature flag. The module is registered and the API is reachable in both modes; access is a permission check (`infrastructure:admin`), not a mode check. Mode-dependent behavior is limited to the rows below.

| File | Line | What | Behavior |
|------|------|------|----------|
| `netbox-sync.service.ts`, `netbox-config.service.ts` | `assertPublicHttpUrl` / `assertPublicHttpTarget` calls | Netbox address validation and every outbound call | Inherits the guard above: a private Netbox address is refused in multi-tenant, accepted in single-tenant. On-prem installs reaching an internal Netbox need nothing extra; a dev/cloud install does via `SSRF_ALLOWED_HOSTS`. |
| `ai/ai-secret-cipher.service.ts` | 10, 61 | Netbox API token storage | The token is encrypted with `AI_SETTINGS_ENCRYPTION_SECRET`. That variable is therefore required to configure Netbox even when all AI features are off. Without it, `secret_writable` is false and the card warns that the token cannot be stored. |
| `netbox-scheduled-sync.service.ts` | 99 | `netbox-inventory-sync` hourly task | Registered in both modes. Per-tenant `auto_sync` switch. Frozen or trial-expired tenants are skipped via `evaluateSubscriptionAccess`; the check is short-circuited when `StripeConfigService.isConfigured()` is false, so it is a no-op on-prem. |
| `frontend/src/components/ProtectedRoute.tsx` | 130 | `/admin/integrations` route gating | Now admitted by `ai_settings:admin` **or** `infrastructure:admin`. Mode-agnostic. |
| `frontend/src/components/Layout.tsx` | 100 | Admin nav entry for Integrations | Same widened condition; the Integrations entry alone can justify showing the Admin workspace. |
| `frontend/src/pages/admin/AdminIntegrationsPage.tsx` | 120, 122, 307, 309 | Card visibility | GLPI and monitoring cards require the `ai_settings` surface; the Netbox card requires `infrastructure:admin`. |

#### URL resolution

| File | Line | What | Behavior |
|------|------|------|----------|
| `url.ts` | 164 | `resolveConfiguredAppBaseUrl()` | Single-tenant: `APP_BASE_URL` directly. Multi-tenant: first of `APP_BASE_URL`, `PUBLIC_APP_URL`, `APP_URL` on a tenant domain, with slug substitution. No default address |
| `scheduled-notifications.service.ts` | 52, 57 | Weekly review + expiration emails | Calls `resolveNotificationBaseUrl(slug)` |
| `notifications.service.ts` | 122 | Event-driven notifications | Calls `resolveNotificationBaseUrl(tenantSlug)` |
| `portfolio-status-change-report.controller.ts` | 134 | PDF export base URL | Calls `resolveNotificationBaseUrl(null)` in single-tenant |

### Frontend Gates

All gates read from `useFeatures()` hook (provided by `FeaturesContext.tsx`).

#### Route gating (`App.tsx`)

| Line | Condition | Routes affected |
|------|-----------|----------------|
| 109 | `config.features.email` | `/forgot-password` — redirects to `/login` if email off |
| 181–182 | `config.features.billing` | `/admin/billing`, `/admin/choose-plan` — not rendered |
| 183 | `config.features.sso` | `/admin/auth` — not rendered |
| 184–189 | `!isSingleTenant` | `/admin/tenants`, `/admin/coa-templates`, `/admin/standard-accounts/*`, `/admin/ops-dashboard` — not rendered |
| 339 | none (always registered) | `/admin/sample-data` — the page refuses itself (`ForbiddenPage`) when the flag is off (on-premise), for a non-Administrator or on the platform host. A direct page load never falls to the catch-all |

#### Navigation gating (`Layout.tsx`)

| Line | Condition | Effect |
|------|-----------|--------|
| 453 | `isSingleTenant` | Platform admin nav hidden entirely |
| 454 | `!config.features.billing` | Billing nav item filtered out |
| 455 | `!config.features.sso` | Auth/SSO nav item filtered out |
| 495 | `config.features.billing` | `SubscriptionBanner` hidden |
| 521 | `!isPlatformHost && !isSingleTenant && config.features.sampleData && claims.isGlobalAdmin` | **Sample data** admin nav item (after Branding) added; absent otherwise |

#### Component gating

| File | Line | Condition | Effect |
|------|------|-----------|--------|
| `LoginPage.tsx` | 95 | `config.features.sso` | "Sign in with Microsoft" button hidden |
| `LoginPage.tsx` | 164 | `config.features.email` | "Forgot password" link hidden |
| `ForgotPasswordPage.tsx` | 11 | `!config.features.email` | Shows "contact your administrator" message instead of form |
| `SubscriptionBanner.tsx` | 14 | `!config.features.billing` | Returns null (hidden) |
| `ProtectedRoute.tsx` | 116 | `config.features.billing` | Skips billing/subscription redirect when billing off |
| `pages/admin/SampleDataPage.tsx`, `pages/admin/sample-data/SampleDataBanner.tsx` | 1 | `useSampleDataAvailable()`: not single-tenant, `features.sampleData`, not the platform host, Administrator role | Page shows `ForbiddenPage`; the home banner (rendered first in `WorkspaceDashboardPage.tsx`) renders nothing. No polling or retry after a 403 or 404 |
| `ProtectedRoute.tsx` | 301 | Billing redirect of a frozen workspace | `/admin/sample-data` is exempt, so an Administrator can erase a frozen workspace |

#### API client (`client.ts`)

| Line | What | Effect |
|------|------|--------|
| 107 | `FEATURE_DISABLED` in error code check | Does not redirect to login — lets caller handle gracefully |

### CI

| File | What |
|------|------|
| `.github/workflows/ci.yml:16` | Matrix: `DEPLOYMENT_MODE` set to `single-tenant` for `onprem` mode, unset for `cloud` mode. Both must build cleanly. |

### Infra

| File | What |
|------|------|
| `infra/compose.onprem.yml` | On-prem Docker Compose (api + web only, no DB/storage), on the published images of the checkout's version; `infra/compose.onprem.build.yml` on top builds them locally. The `api` service mounts `infra/certs/` read-only at `/etc/kanap/certs`, so an installation can trust its internal certificate authority with `NODE_EXTRA_CA_CERTS` (SMTP, PostgreSQL, S3 over TLS) |
| `infra/.env.onprem.example` | Complete env template with `DEPLOYMENT_MODE=single-tenant` |
| `infra/certs/README.md` | Operator instructions for the internal certificate authority file. Git ignores every other file in `infra/certs/` |

### Adding a New Feature Gate

When adding a new gate, follow this checklist:

1. **Add the flag** to `backend/src/config/features.ts` if it's a new feature area
2. **Gate the backend** at controller level using `throwFeatureDisabled()` or `MultiTenantOnlyGuard`
3. **Expose to frontend** via `config.controller.ts` → `GET /config/public` response
4. **Update `FeaturesContext.tsx`** type definition if adding a new feature key
5. **Gate the frontend** — both routes (`App.tsx`) and navigation (`Layout.tsx`)
6. **Update this inventory** — add rows to the tables above
7. **Test both modes** — CI matrix catches build errors, but manually verify runtime behavior
