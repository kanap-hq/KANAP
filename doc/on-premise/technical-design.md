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
| Trial e-mail link (HMAC, not a JWT, cloud only) | label `kanap:v1:trial-mail`, signs tenant and purpose (unsubscribe or a discovery call placement) | `TRIAL_MAIL_LINK_SECRET`, else derived | `verifyTrialMailLink` (`/trial-mails/unsubscribe`, `/trial-mails/call`) |

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

| File | What | Behavior |
|------|------|----------|
| `main.ts` | `bootstrap` (`createSingleTenantOnFirstStart`) | Creates tenant, admin user, subscription (On-Prem, no user limit) |
| `common/tenancy/request-tenancy.middleware.ts` | `createRequestTenancyMiddleware` | Skips Host parsing when `singleTenant`, resolves to `defaultTenantSlug`; returns 503 `TENANT_NOT_READY` if the tenant is not ready. `main.ts` calls `applyTenancyAndPipeline` |
| `platform-admin.util.ts` | `isPlatformAdmin` | Returns `false` when `SINGLE_TENANT` is true |
| `public.controller.ts` | `@Post('start-trial')` | 404 via `throwNotAvailableInMode` |
| `public.controller.ts` | `@Post('request-support-invoice')` | 404 via `throwNotAvailableInMode` |
| `public.controller.ts` | `@Post('activate-trial')` | 404 via `throwNotAvailableInMode` |
| `public.controller.ts` | `@Post('contact')` | 404 via `throwNotAvailableInMode` |
| `admin-tenants.controller.ts` | `MultiTenantOnlyGuard` on `admin/tenants` | Answers 404 |
| `admin-coa-templates.controller.ts` | `MultiTenantOnlyGuard` on `admin/coa-templates` | Answers 404 |
| `admin-ops.controller.ts` | `MultiTenantOnlyGuard` on `admin/ops` | Answers 404 |
| `ai/platform/platform-ai-admin.controller.ts` | `MultiTenantOnlyGuard` on `admin/ai` | Answers 404 |
| `billing.service.ts` | `ensureSubscription()` fallback | Defaults to On-Prem, no user limit (single-tenant) or Trial, no user limit (cloud) |
| `url.ts` | `resolveConfiguredAppBaseUrl()` | Single-tenant: `APP_BASE_URL` (then `PUBLIC_APP_URL`) as configured, no subdomain substitution; nothing configured returns null and callers answer 400 or skip |
| `portfolio/portfolio-weekly-report.controller.ts` | `resolveExportBaseUrl` | Single-tenant: `resolveConfiguredAppBaseUrl()`. Multi-tenant: `resolveTenantAppBaseUrl` or `resolveAppBaseUrl` |
| `feature-gates.ts` | `MultiTenantOnlyGuard` | Throws 404 when `SINGLE_TENANT` is true |
| `ai/ai-help-manual.service.ts` | User manual of the assistant (`list_help_topics`, `read_help_section`) | The on-premise installation pages (`on-premise/`) are listed and read in single-tenant mode only |

#### Sample data (cloud only, `!Features.SINGLE_TENANT`)

Administration > Sample data loads the Fromage & Co set into an empty workspace and erases a workspace back to its starting state. On-premise there is no navigation entry and no home banner, every API route answers 404, and the page refuses itself. The flag is `sampleData` in `GET /config/public`.

| File | What | Behavior |
|------|------|----------|
| `demo-data/demo-data.controller.ts` | `MultiTenantOnlyGuard` on `admin/sample-data` | 404 via `MultiTenantOnlyGuard`; also 404 on the platform host and for system tenants. Administrator role checked by the service on every route (403 `administrator_required`) |
| `demo-data/demo-data.service.ts` | `readTenant()` | `throwNotAvailableInMode()` when `SINGLE_TENANT`: the service refuses by itself, whoever calls it |
| `demo-data/demo-data.service.ts` | `reconcileOnStartup()` | No-op when `SINGLE_TENANT` (no sweep of orphaned loads or resets) |
| `config/config.controller.ts` | `sampleData` | `!Features.SINGLE_TENANT` in `@Get('public')` |
| `frontend/src/config/FeaturesContext.tsx` | `sampleData` | Type key; default `false`, so the feature stays hidden if `/config/public` cannot be read |

#### Discovery call (cloud only, `!Features.SINGLE_TENANT`)

The "Book a discovery call" button of trial workspaces, its click events and the Cal.com webhook that stores the call's date (`doc/discovery-call.md`). On-premise the variables are ignored, the button never shows and both routes answer 404.

| File | What | Behavior |
|------|------|----------|
| `discovery-call/discovery-call.config.ts` | `discoveryCallConfig()` | Every value empty when `SINGLE_TENANT`, whatever `DISCOVERY_CALL_URL`, `DISCOVERY_CALL_FALLBACK_EMAIL` and `DISCOVERY_CALL_WEBHOOK_SECRET` say |
| `discovery-call/discovery-call.controller.ts` | `MultiTenantOnlyGuard` on `discovery-call` | 404; the webhook also answers 404 while no secret is set |
| `config/config.controller.ts` | `discoveryCall` | `{ url, fallbackEmail }` from `discoveryCallConfig()` in `@Get('public')` |
| `frontend/src/components/BookDiscoveryCallButton.tsx` | `useDiscoveryCall()` | Hidden on-premise, without a running trial, for a platform administrator, and when both values are empty |

#### Trial e-mails (cloud only, `!Features.SINGLE_TENANT`)

The e-mails of trial workspaces and the thank-you at the first subscription (`doc/trial-mails.md`). On-premise nothing is scheduled and the link routes answer 404.

| File | What | Behavior |
|------|------|----------|
| `email/trial-mails/trial-mails.service.ts` | `onModuleInit()` | The task `send-trial-mails` is not registered when `SINGLE_TENANT` |
| `email/trial-mails/trial-mails.service.ts` | `run()`, `onSubscriptionChanged()` | Nothing read or sent when `SINGLE_TENANT` (summary `not available on-premise`) |
| `email/trial-mails/trial-mails.controller.ts` | `MultiTenantOnlyGuard` on `trial-mails` | 404 |

#### Microsoft Entra (`Features.ENTRA_SSO`)

Optional in both modes: true when `ENTRA_CLIENT_ID` is configured. Per-tenant activation lives on `tenants.sso_provider` / `sso_enabled`; everything below is inert for tenants without Entra.

| File | What | Behavior |
|------|------|----------|
| `entra-directory-sync.service.ts` | `entra-directory-sync` scheduled task (default daily 03:00) | Registered in both modes; handler `runAll` returns `skipped` when `ENTRA_SSO` is false, otherwise iterates active tenants with `sso_provider='entra'` under RLS. Tenants whose Entra admin has not granted application consent are reported `consent_required` and keep login-time enrichment only. The contributor reporting line imported from the directory rides on the same gate (`syncDirectoryManagers`, same file) |
| `admin-auth.controller.ts` | `@Post('directory-sync')` | 400 `SSO_NOT_CONFIGURED` when `ENTRA_SSO` is false |
| `admin-auth.controller.ts` | `getSettings` → `directory_sync` | `null` unless the tenant is connected to Entra and `ENTRA_SSO` is true |

#### Billing (`Features.STRIPE_BILLING`)

| File | What | Behavior |
|------|------|----------|
| `billing.controller.ts` | `@Get('plans')` | 403 `FEATURE_DISABLED` |
| `billing.controller.ts` | `@Get('subscription')` | 403 `FEATURE_DISABLED` |
| `billing.controller.ts` | `@Post('change-plan')` | 403 `FEATURE_DISABLED` |
| `billing.controller.ts` | `@Post('scheduled-change/cancel')` | 403 `FEATURE_DISABLED` |
| `billing.controller.ts` | `@Post('request-invoice')` | 403 `FEATURE_DISABLED` |
| `billing.controller.ts` | `@Get('profile')` | 403 `FEATURE_DISABLED` |
| `billing.controller.ts` | `@Post('portal')` | 403 `FEATURE_DISABLED` |
| `billing.controller.ts` | `@Post('checkout')` | 403 `FEATURE_DISABLED` |
| `billing.controller.ts` | `@Patch('profile')` | 403 `FEATURE_DISABLED` |

#### Email (`Features.EMAIL_ENABLED`)

| File | What | Behavior |
|------|------|----------|
| `auth.controller.ts` | `@Post('password-reset/request')` | 403 `FEATURE_DISABLED` |
| `users.controller.ts` | `@Post(':id/invite')` | 403 `FEATURE_DISABLED` |
| `notification-preferences.controller.ts` | `@Post('test-weekly-review')` | 403 `FEATURE_DISABLED` |
| `email/transports/disabled-email.transport.ts` | `DisabledEmailTransport` | `send` throws `FeatureDisabledError('email')`. `createEmailTransport` selects this transport when none is configured. Callers still read `error.code` |
| `public.controller.ts` | `FEATURE_DISABLED` in `startTrial`, `requestSupportInvoice`, `activateTrial` | Checks `error.code === 'FEATURE_DISABLED'`: suppresses it and returns a graceful fallback |

#### AI Chat / MCP / Settings / Web Search (`Features.AI_CHAT_ENABLED`, `Features.AI_MCP_ENABLED`, `Features.AI_SETTINGS_ENABLED`, `Features.AI_WEB_SEARCH_READY`)

| File | What | Behavior |
|------|------|----------|
| `backend/src/config/config.controller.ts` | `@Get('public')` feature payload | Exposes `aiChat`, `aiMcp`, `aiSettings`, `aiWebSearch`, and `builtinAiProvider` to the frontend |
| `backend/src/config/config.controller.ts` | `builtinAiProvider` gate | Returns `true` for cloud deployments and `false` in single-tenant mode |
| `backend/src/ai/ai-capabilities.controller.ts` | `@Get('capabilities')` | Returns per-surface AI availability derived from feature flags, tenant settings, permissions, and provider readiness |
| `backend/src/ai/ai-policy.service.ts` | `assertSurfaceAccess()`, `assertSettingsAccess()`, `assertKeyManagementAccess()` | Surface, settings, key-management and readable-entity checks enforce the AI gates |
| `backend/src/ai/ai-chat.controller.ts` | `@Controller('ai/chat')`, `@Post('stream')` | Chat surface is unavailable when native AI chat is disabled by feature flag or tenant settings |
| `backend/src/ai/ai-mcp.controller.ts` | `@Controller('ai/mcp')` | MCP surface is unavailable when MCP is disabled by feature flag or tenant settings |
| `backend/src/ai/ai-settings.controller.ts` | `@Controller('ai/settings')` | AI settings surface is unavailable when the AI settings feature is disabled |
| `backend/src/ai/ai-tool.registry.ts` | Chat `web_search` tool registration and execution | The Plaid **chat** web search tool is only listed and executable when `AI_WEB_SEARCH_READY` is true and the tenant chat web search toggle is enabled |
| `backend/src/ai/control-plane/capability/ai-capability.registry.ts` | `web_search` (`internalWebSearchContract`, `webSearchInternal`) | Internal capability, `mcp_exposure` disabled. `webSearchInternal` throws when `braveSearch` is absent. No cloud/on-prem branch in this file. |
| `backend/src/ai/control-plane/agent-control/ai-agent-control.service.ts` | `AI_WEB_SEARCH_READY` | An agent calls `web_search` only when `knowledgeSources.webEnabled` and `Features.AI_WEB_SEARCH_READY` are both true. |
| `backend/src/ai/control-plane/agent-control/ai-ticket-evidence-extraction.service.ts` | `supportsVision` | Not a cloud/on-prem feature gate. Screenshot evidence is skipped when `runtime.supportsVision` is false (`vision_disabled_by_setting`). Limits are `AI_AGENT_VISION_MAX_IMAGES`, `AI_AGENT_VISION_MAX_IMAGE_BYTES`, `AI_AGENT_VISION_EXTRACTION_MAX_TOKENS` and `AI_AGENT_VISION_EXTRACTION_TIMEOUT_MS`. |
| `backend/src/ai/control-plane/agent-control/ai-agent-control.controller.ts` | `@Controller('ai/admin/control-plane')` | The AI Agents control-plane API. Unavailable when the AI settings surface is disabled. This is the API behind every `/agents` page. |
| `frontend/src/components/Layout.tsx` | `canShowAgents` | The AI Agents nav group is shown when `features.aiSettings` is true, the instance AI-settings capability is on, and `hasLevel('ai_agents', 'reader')` holds. The Shared context item sets `resource: 'ai_agents', level: 'admin'`. |
| `frontend/src/components/ProtectedRoute.tsx` | `isAgentsRoute` | `/agents` routes, registered in App.tsx, call `refuse()` when `features.aiSettings` is false or `instance_features.ai_settings` is not true |
| `frontend/src/config/FeaturesContext.tsx` | `normalizeFeaturesConfig` | Normalizes AI feature flags from `/config/public` for route and UI gating |
| `frontend/src/pages/ai/AiWorkspacePage.tsx` | `features.aiChat` | Hides native AI chat UI when `aiChat` is false |
| `frontend/src/pages/admin/AdminAiPage.tsx` | `features.aiSettings` | Hides AI settings and web search controls when the corresponding flags are false |

#### Living catalog of technologies (`Features.TECHNOLOGY_CATALOG_SYNC_ENABLED`)

The living catalog reads the release cycles of endoflife.date (`https://endoflife.date/api/v1`, or a mirror in `ENDOFLIFE_API_BASE_URL`) for the catalog entries the technologies were adopted from. `TECHNOLOGY_CATALOG_SYNC_ENABLED` is true by default in the cloud and false by default on-premise; set either way, it wins. Off, nothing leaves for endoflife.date: the scheduled task `technology-catalog` still runs at each start and daily (while it is enabled in the scheduled tasks), the cache is not read, and the task brings the catalog shipped with the installed version to the adopted technologies (new versions, dates and CPE identifiers, the withdrawal of an identifier `shipped_cpe` listed, that `cpe_written` records as written by the catalog, and that the shipped file no longer lists (a file that lists no identifier without `noCpe` withdraws nothing, a cache identifier stays while the cache omits it, and an identifier the tenant typed is kept), and a description the catalog wrote in `description_language` when that language's text changes and the technology still holds the same characters (a change of the tenant's language rewrites nothing, and a state without `description_language` takes the language whose catalog text equals the remembered description or is left unchanged when none does)). CVE.org names follow the same pass: a name the catalog gains is added, a name the tenant removed stays removed, and a name is removed only when `cve_names_written` lists it, `shipped_cve_names` listed it and the shipped file no longer does. A state without those keys removes nothing. An empty name list withdraws the names that rule names. A value the tenant typed stays. The frontend shows nothing different.

| File | What | Behavior |
|------|------|----------|
| `config/features.ts` | `TECHNOLOGY_CATALOG_SYNC_ENABLED` | Env value when set, otherwise `!SINGLE_TENANT` |
| `technologies/catalog/technology-catalog-sync.service.ts` | `technology-catalog` scheduled task (daily 04:40 UTC, and at start), registered in both modes | Reads endoflife.date only when on; syncs the tenants either way |
| `config/config.controller.ts` | `technologyCatalogSync` | `Features.TECHNOLOGY_CATALOG_SYNC_ENABLED` in `@Get('public')` |
| `frontend/src/config/FeaturesContext.tsx` | `technologyCatalogSync` | False until `GET /config/public` says otherwise; no screen depends on it |

#### Vulnerabilities (`Features.VULNERABILITY_FEED_ENABLED`)

The NVD feed needs the way out to the NVD (`https://services.nvd.nist.gov`) or to a mirror (`NVD_API_BASE_URL`). `VULNERABILITY_FEED_ENABLED` is true by default in the cloud and false by default on-premise; set either way, it wins. `NVD_API_KEY` is optional (more requests per 30 seconds). The same switch runs the exploitation signals (`vulnerability-signals`, minute 50 of every sixth hour): the CISA catalog (`KEV_FEED_URL`, default CISA's GitHub mirror `https://raw.githubusercontent.com/cisagov/kev-data/develop/known_exploited_vulnerabilities.json`; `www.cisa.gov` answers 403 to data-centre addresses), the EU catalog and the EUVD mapping (`EUVD_BASE_URL`, default `https://euvdservices.enisa.europa.eu`; a mirror serves `/api/kev/dump` and `/api/dump/cve-euvd-mapping` under it) and the EPSS scores (`EPSS_FEED_URL`, default `https://epss.empiricalsecurity.com/epss_scores-current.csv.gz`, gzip or plain CSV; see EPSS at https://www.first.org/epss). An empty variable keeps the default address. Outbound HTTPS, port 443: `raw.githubusercontent.com`, `euvdservices.enisa.europa.eu`, `epss.empiricalsecurity.com`. A source that cannot be reached leaves its columns as they are and is named in the task summary. The other sources and the NVD collection continue. The European record is ENISA's European vulnerability database. Off, the frontend shows none of it: no IT › Vulnerabilities page or navigation entry, no "Vulnerabilities to review" column in the technologies, assets and applications lists, no vulnerabilities section or severe badge on an asset or application record, no Vulnerabilities dashboard tile, no Technologies group in the notification preferences, and no email to the IT owners. With the feed on and email off (`EMAIL_ENABLED`), the run claims and sends nothing. With the feed on, the email lists critical or high CVE and, at any severity, CVE known to be exploited.

| File | What | Behavior |
|------|------|----------|
| `config/features.ts` | `VULNERABILITY_FEED_ENABLED` | Env value when set, otherwise `!SINGLE_TENANT` |
| `vulnerabilities/vulnerabilities.controller.ts` | `VulnerabilityFeedGuard` on `vulnerabilities` and `technologies/:id/vulnerabilities` | 403 `FEATURE_DISABLED` when off |
| `vulnerabilities/nvd-feed.service.ts` | `vulnerability-feed` scheduled task (default every 6 hours, minute 20), and the notifications of each run | Registered only when on: no request leaves for the NVD and no vulnerability email goes out otherwise |
| `vulnerabilities/vulnerability-signals.service.ts` | `vulnerability-signals` scheduled task (minute 50 of every sixth hour) | Registered only when the feed is on. Updates the cached CVE from CISA, the EU KEV, EPSS and the EUVD mapping. One source failing leaves its columns and does not fail the task |
| `technologies/technologies.service.ts` | `vulnerabilities_to_review`, `vulnerabilities_severe` (GET /technologies, rows that alert) | `null` when off |
| `config/config.controller.ts` | `vulnerabilityFeed` | `Features.VULNERABILITY_FEED_ENABLED` in `@Get('public')` |
| `frontend/src/config/FeaturesContext.tsx` | `vulnerabilityFeed` | False until `GET /config/public` says otherwise |
| `frontend/src/App.tsx` | Route `/it/vulnerabilities` | Not registered when `features.vulnerabilityFeed` is off |
| `frontend/src/components/Layout.tsx` | `features.vulnerabilityFeed` | IT › Operations › Vulnerabilities navigation entry hidden when off |
| `frontend/src/pages/it/VulnerabilitiesPage.tsx` | `features.vulnerabilityFeed` | The page (list grid, change of state in bulk, side panel) renders nothing when off |
| `frontend/src/pages/it/TechnologiesPage.tsx` | `features.vulnerabilityFeed` | "Vulnerabilities to review" column, and the publisher's link to the page, hidden when off (the publisher opens the technology) |
| `frontend/src/pages/settings/NotificationsTab.tsx` | `features.vulnerabilityFeed` | Technologies group of the notification preferences hidden when off |
| `frontend/src/pages/it/workspace/TechnologyVulnerabilitiesSection.tsx` | `features.vulnerabilityFeed` | Vulnerabilities section of the technology record renders nothing and reads nothing when off |
| `vulnerabilities/vulnerabilities.controller.ts` | `@Get('home-summary')` | Behind the class's `VulnerabilityFeedGuard`: 403 `FEATURE_DISABLED` when off |
| `vulnerabilities/vulnerabilities.controller.ts` | `VulnerabilityFeedGuard` on `assets/:id/vulnerabilities` | 403 `FEATURE_DISABLED` when off |
| `vulnerabilities/vulnerabilities.controller.ts` | `VulnerabilityFeedGuard` on `applications/:id/vulnerabilities` | 403 `FEATURE_DISABLED` when off |
| `vulnerabilities/vulnerability-reach-counts.ts` | `vulnerabilityCountsEnabled()`: every count per asset and per application (lists, records, assistant) | Counts `null` when off |
| `assets/services/assets-list.service.ts` | `VULNERABILITIES_LIST_FIELD` | Sort and filter of the vulnerabilities column in GET /assets: sorts as an unknown column, the filter matches nothing, counts `null` when off |
| `applications/services/applications-list.service.ts` | `VULNERABILITIES_LIST_FIELD` (`include.has('vulnerabilities')`) | Same as the assets list |
| `vulnerabilities/vulnerability-list-column.ts` | `csvConfigForVulnerabilityFeed`: `vulnerabilities_to_review` and `severe_vulnerabilities` in the assets and applications CSV export | Columns left out of the export and its field list when off |
| `frontend/src/pages/it/AssetsPage.tsx` | `features.vulnerabilityFeed` | "Vulnerabilities to review" column of the assets list hidden when off |
| `frontend/src/pages/it/ApplicationsPage.tsx` | `features.vulnerabilityFeed` | "Vulnerabilities to review" column of the applications list hidden when off |
| `frontend/src/pages/it/AssetWorkspacePage.tsx` | `features.vulnerabilityFeed` | Vulnerabilities section (Technical tab) and severe badge of the asset record: reads nothing and renders nothing when off |
| `frontend/src/pages/it/ApplicationWorkspacePage.tsx` | `features.vulnerabilityFeed` | Vulnerabilities section (Operations tab) and severe badge of the application record: reads nothing and renders nothing when off |
| `frontend/src/pages/workspace/tiles/TileRegistry.ts` | `requiredFeature: 'vulnerabilityFeed'` | Vulnerabilities dashboard tile. The hook in `frontend/src/pages/workspace/hooks/useTilePermissions.ts` drops a tile whose `requiredFeature` is off |
| `ai/ai-policy.service.ts` | `vulnerabilities` | Left out of the readable families of the assistant and the MCP server, refused with `vulnerabilityFeed` when off |

#### CVE.org names (`Features.CVE_LIST_FEED_ENABLED`)

The CVE.org list (cvelistV5) fills the platform cache of published records. `CVE_LIST_FEED_ENABLED` defaults to the vulnerability feed; a value set either way wins. `cveListEnabled()` is the two switches together, so the collector and the name routes stay idle while the vulnerability feed is off. With the list off and the feed on, `GET /vulnerabilities/cve-names` and `GET /technologies/:id/cve-names/suggestions` answer 403 `FEATURE_DISABLED` for `cveNames`. With the vulnerability feed off, the vulnerabilities controller answers for `vulnerabilityFeed` before the directory handler; the suggestions route answers for `cveNames`. The screen that reads `features.cveNames` is Technologies › Overview, section CVE.org names, and arrives in the following run. `GET /vulnerabilities/sources` reports both feeds in `items`, and the four exploitation catalogues (CISA KEV, EU KEV, EPSS, EUVD) in `signals`. `enabled` for the NVD and for each catalogue is `VULNERABILITY_FEED_ENABLED`, and for CVE.org it is `cveListEnabled()`. No new gate: the route uses the vulnerability-feed guard. The catalogues have no switch of their own.

| File | What | Behavior |
|------|------|----------|
| `config/features.ts` | `CVE_LIST_FEED_ENABLED` | Env value when set, otherwise the vulnerability feed |
| `vulnerabilities/cve-list-feed.service.ts` | `cveListEnabled()` | True when the vulnerability feed and the CVE.org list are both on |
| `vulnerabilities/cve-list-feed.service.ts` | `collect` inside the 6-hour vulnerability pass | Returns a disabled summary and fetches nothing when `cveListEnabled()` is false |
| `vulnerabilities/cve-names.service.ts` | `cveListEnabled` | Directory and suggestions answer 403 `FEATURE_DISABLED` (`cveNames`) when `cveListEnabled()` is false |
| `vulnerabilities/vulnerabilities.controller.ts` | `@Get('cve-names')` | `@RequireLevel('infrastructure', 'reader')`. The feed guard answers first when the vulnerability feed is off |
| `technologies/technologies.controller.ts` | `@Get(':id/cve-names/suggestions')` | `@RequireLevel('infrastructure', 'reader')`, the same right as reading the technology |
| `config/config.controller.ts` | `cveNames` | `cveListEnabled()` in `@Get('public')`, beside `vulnerabilityFeed` |
| `frontend/src/config/FeaturesContext.tsx` | `cveNames` | False until `GET /config/public` says otherwise. Technologies › Overview, section CVE.org names, arrives in the following run |

#### Excel workbooks in the data imports (`Features.IMPORT_XLSX`)

Every data import that takes a CSV file (the master-data lists, the IT and portfolio registers, the budget file, the technology link files, data access, the chart of accounts templates and the incident journal) also takes an Excel workbook (.xlsx): its first worksheet is read with the same columns, rules, preflight and report as the CSV file. `IMPORT_XLSX` is true by default in both modes; set to false, the imports are CSV only, as before the workbooks: the upload filter refuses an .xlsx or .xls by its name with the "save as CSV" sentence (`CSV_FILE_EXCEL`), a workbook that passes under another name meets the CSV decoder and the same sentence, and the dialogs offer `.csv` only. Import templates stay CSV files either way. Nothing leaves the server and no other component is involved: the reader is `backend/src/common/xlsx/read.ts`.

| File | What | Behavior |
|------|------|----------|
| `config/features.ts` | `IMPORT_XLSX` | Env value when set, otherwise true |
| `common/upload.ts` | `isWorkbookUpload` in the `csv-import` filter (`csvImportMulterOptions`) | Passes an .xlsx or .xls name, or the xlsx type, when on; the "save as CSV" refusal when off. The budget file spreads this filter |
| `common/csv-sheet/read.ts` | `isWorkbookBytes`, read by `readSheet` (master-data files, budget file) and `readImportText` (field engine, registers' follow-up columns, chart of accounts templates, incident journal) | A ZIP or OLE file is read as a workbook when on; it goes to the CSV decoder when off |
| `config/config.controller.ts` | `importXlsx` | `Features.IMPORT_XLSX` in `@Get('public')` |
| `frontend/src/config/FeaturesContext.tsx` | `importXlsx` | False until `GET /config/public` says otherwise |
| `frontend/src/components/csv/importFiles.tsx` | `useImportFiles`, `ImportLabel` (import dialogs, budget file dialog, "Import CSV" buttons) | `.csv,.xlsx` and "Import" when on; `.csv` and the CSV labels when off |

#### Outbound target guard (`backend/src/common/ssrf-guard.ts`)

Shared by every tenant-supplied outbound URL: Netbox, PRTG and GLPI. Not a `Features` flag of its own, but mode-dependent.

| File | What | Behavior |
|------|------|----------|
| `common/ssrf-guard.ts` | `shouldEnforce()` (`assertPublicHttpUrl`, `assertPublicHttpTarget`) | Multi-tenant: private / loopback / link-local / CGNAT / metadata ranges are refused. Single-tenant: no-op, since RFC1918 and internal-DNS targets are the normal case on-prem. Callers can force either way with `enforcePrivateBlock`. |
| `common/ssrf-guard.ts` | `SSRF_ALLOWED_HOSTS` | Operator escape hatch, comma-separated hosts/IPs allowed even when private. Empty by default, so cloud behavior is unchanged. Read per call. |

#### Netbox inventory (`backend/src/netbox/`)

No feature flag. The module is registered and the API is reachable in both modes; access is a permission check (`infrastructure:admin`), not a mode check. Mode-dependent behavior is limited to the rows below.

| File | What | Behavior |
|------|------|----------|
| `netbox/netbox-sync.service.ts`, `netbox/netbox-config.service.ts` | `assertPublicHttpUrl` | Netbox address validation and every outbound call. A private Netbox address is refused in multi-tenant, accepted in single-tenant. On-prem installs reaching an internal Netbox need nothing extra; a dev/cloud install does via `SSRF_ALLOWED_HOSTS`. |
| `ai/ai-secret-cipher.service.ts` | `canEncrypt` (`AI_SETTINGS_ENCRYPTION_SECRET`) | The Netbox API token is encrypted with that variable, so it is required to configure Netbox even when all AI features are off. Without it, `canEncrypt()` is false and the card warns that the token cannot be stored. |
| `netbox/netbox-scheduled-sync.service.ts` | `netbox-inventory-sync` | Hourly task, registered in both modes. Per-tenant `auto_sync` switch. Frozen or trial-expired tenants are skipped via `evaluateSubscriptionAccess`; the check returns early when `isConfigured()` is false, so it is a no-op on-prem. |
| `frontend/src/components/ProtectedRoute.tsx` | `/admin/integrations` | Admitted by `hasLevel('ai_settings', 'admin')` or `hasLevel('infrastructure', 'admin')`. Mode-agnostic. |
| `frontend/src/components/Layout.tsx` | `canShowIntegrations` | Admin nav entry for Integrations. The same widened condition; the Integrations entry alone can justify showing the Admin workspace. |
| `frontend/src/pages/admin/AdminIntegrationsPage.tsx` | `aiSettingsAvailable`, `canManageNetbox` | GLPI and monitoring cards follow `aiSettingsAvailable`; the Netbox card follows `canManageNetbox` (`hasLevel('infrastructure', 'admin')`). |

#### URL resolution

| File | What | Behavior |
|------|------|----------|
| `url.ts` | `resolveConfiguredAppBaseUrl()` | Single-tenant: first of `APP_BASE_URL`, `PUBLIC_APP_URL`, as configured, no slug substitution. Multi-tenant: first of `APP_BASE_URL`, `PUBLIC_APP_URL`, `APP_URL` on a tenant domain, with slug substitution. Nothing configured returns null |
| `notifications/scheduled-notifications.service.ts` | `getTenantAppUrl` (`resolveNotificationBaseUrl`), `skipWithoutAppUrl` (`resolveConfiguredAppBaseUrl`) | Weekly review links use `resolveNotificationBaseUrl`. Expirations and the weekly review are skipped when `resolveConfiguredAppBaseUrl` returns null |
| `notifications/notifications.service.ts` | `buildTenantBaseUrl` (`resolveNotificationBaseUrl`) | Event-driven notifications |
| `portfolio/portfolio-weekly-report.controller.ts` | `resolveExportBaseUrl` | Single-tenant: `resolveConfiguredAppBaseUrl()`. Multi-tenant: `resolveTenantAppBaseUrl` or `resolveAppBaseUrl` |

### Frontend Gates

All gates read from `useFeatures()` hook (provided by `FeaturesContext.tsx`).

#### Route gating (`frontend/src/App.tsx`)

| Condition | Routes affected |
|-----------|----------------|
| `config.features.email` | `/forgot-password`: redirects to `/login` if email is off |
| `config.features.billing` | `/admin/billing`, `/admin/choose-plan`: not rendered |
| `config.features.sso` | `/admin/auth`: not rendered |
| `!isSingleTenant` | `/admin/tenants`, `/admin/coa-templates`, `/admin/standard-accounts`, `/admin/ops-dashboard`, `/admin/platform-ai`: not rendered |
| `/admin/sample-data` | Always registered. The page refuses itself (`ForbiddenPage`) when the flag is off (on-premise), for a non-Administrator or on the platform host. A direct page load never falls to the catch-all |

#### Navigation gating (`frontend/src/components/Layout.tsx`)

| Condition | Effect |
|-----------|--------|
| `isPlatformHost && !isSingleTenant` | Platform admin nav is used only then. In single-tenant mode an administrator also gets Scheduled tasks (`isSingleTenant`) |
| `!config.features.billing` | Billing nav item filtered out |
| `!config.features.sso` | Auth/SSO nav item filtered out |
| `config.features.billing` | `SubscriptionBanner` hidden when this is false |
| `!isPlatformHost && !isSingleTenant && config.features.sampleData && claims?.isGlobalAdmin` | **Sample data** admin nav item (after Branding) added; absent otherwise |

#### Component gating

| File | Condition | Effect |
|------|-----------|--------|
| `LoginPage.tsx` | `config.features.sso` | "Sign in with Microsoft" button hidden |
| `LoginPage.tsx` | `config.features.email` | "Forgot password" link hidden |
| `ForgotPasswordPage.tsx` | `!config.features.email` | Shows "contact your administrator" message instead of form |
| `SubscriptionBanner.tsx` | `!config.features.billing` | Returns null (hidden) |
| `ProtectedRoute.tsx` | `config.features.billing` | Skips billing/subscription redirect when billing is off |
| `pages/admin/SampleDataPage.tsx`, `pages/admin/sample-data/SampleDataBanner.tsx` | `useSampleDataAvailable()` | Not single-tenant, sample data flag on, not the platform host, Administrator role. The page shows `ForbiddenPage`; the home banner (rendered first in `WorkspaceDashboardPage.tsx`) renders nothing. No polling or retry after a 403 or 404 |
| `ProtectedRoute.tsx` | `/admin/sample-data` | Exempt from the billing redirect of a frozen workspace, so an Administrator can erase that workspace |

### CI

| File | What |
|------|------|
| `.github/workflows/ci.yml` | `DEPLOYMENT_MODE` on the `onprem` job (`build (onprem)`) is `single-tenant`. The cloud jobs leave it unset. Both builds must pass. |

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
6. **Update this inventory**. Add rows to the tables above. Cite the file and the symbol (function, class, constant, route or condition), never a line number.
7. **Test both modes** — CI matrix catches build errors, but manually verify runtime behavior
