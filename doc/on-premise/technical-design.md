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

- **Database & RLS:** PostgreSQL 16 with Row-Level Security works unchanged when `DATABASE_URL` uses a dedicated application role; startup fails instead of running with a role that can bypass RLS
- **Database requirement, list engine:** PostgreSQL must provide the ICU collation `und-x-icu` (a build with ICU: the official, PGDG and Alpine images are) and the function `public.unaccent(text)` (the `unaccent` extension in schema `public`; the migrations create it when the extension files are installed). The OPEX and CAPEX lists sort, filter and search in SQL with them. Check before deploying, as the application role: `SELECT EXISTS (SELECT 1 FROM pg_collation WHERE collname = 'und-x-icu' AND collprovider = 'i') AS icu, to_regprocedure('public.unaccent(text)') IS NOT NULL AS unaccent;` must return `true, true`. Without either, the API still starts, logs `List engine disabled: missing …` once at startup, and the OPEX and CAPEX list endpoints answer 503 with the same requirement. The database sorts with its own ICU library and the API joins the project names of a line with Node's: both use the root collation, so they agree except on characters one ICU version knows and the other does not
- **Storage:** S3-compatible storage via AWS SDK v3 S3 client (`S3_ENDPOINT`, supports MinIO/R2/B2/AWS)
- **Billing:** Disabled when `STRIPE_SECRET_KEY` is not set (backend returns `FEATURE_DISABLED`, UI hides billing features)
- **Migrations:** Run automatically on container startup (`migrate-and-start.js`)
- **Local Auth:** Username/password works without external dependencies
- **SSO:** Entra ID is optional; local auth is fallback
- **FX Rates:** Gracefully degrades if API keys are not configured
- **Email links:** Use `APP_BASE_URL` directly in single-tenant mode (no subdomain derivation)

## Deployment Modes

`DEPLOYMENT_MODE` is the differentiator between cloud and on-prem.

| Value | Description | Use Case |
|-------|-------------|----------|
| `multi-tenant` (or unset) | Cloud mode: subdomain-based tenant resolution | SaaS |
| `single-tenant` | On-prem mode: fixed tenant, no subdomain parsing | Customer self-hosted |

**Effects:**
- Tenant resolution (routing)
- First-boot initialization (auto-create tenant/admin/subscription)
- Platform-admin access (fully disabled in single-tenant)
- SaaS-only endpoints (return 404 in single-tenant)
- UI elements (billing, platform admin, SSO hidden when features disabled)

## Feature Flags

Single source of truth: `backend/src/config/features.ts`

```typescript
const deploymentMode = (process.env.DEPLOYMENT_MODE || '').trim().toLowerCase();
const isSingleTenant = deploymentMode === 'single-tenant';

export const Features = {
  DEPLOYMENT_MODE: isSingleTenant ? ('single-tenant' as const) : ('multi-tenant' as const),
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

**Important:** `Host` is still used for URL generation (password reset/invites). Ensure the reverse proxy forwards `Host` and `X-Forwarded-Proto`, or set `APP_BASE_URL`.

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
3. If `ADMIN_EMAIL` and `ADMIN_PASSWORD` are set, seed admin user with Administrator role and full permissions
4. Bootstrap subscription row: `plan_name = 'On-Prem'`, `seat_limit = 1000`, `status = 'active'`

**Safety net:** `billing.service.ts` `ensureSubscription()` also defaults to On-Prem/1000 seats instead of Starter/5 when `Features.SINGLE_TENANT` is true.

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

`resolveNotificationBaseUrl()` in `backend/src/common/url.ts`:
- **Single-tenant:** Uses `APP_BASE_URL` directly (no subdomain logic)
- **Multi-tenant:** Uses `APP_URL` with slug substitution (`//app.` → `//{slug}.`)

Used by: `scheduled-notifications.service.ts`, `notifications.service.ts`, `portfolio-status-change-report.controller.ts`

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
| Tenant creation | Platform-admin UI or trial | Auto-created on first boot |
| Multiple tenants | Yes | No (single tenant only) |
| Platform-admin nav | Visible (if user has access) | Hidden |
| Trial / support endpoints | Active | Return 404 |
| Billing | Stripe-based | Disabled (`FEATURE_DISABLED`) |
| Subscription defaults | Starter / 5 seats | On-Prem / 1000 seats |
| Notification URLs | `APP_URL` + slug substitution | `APP_BASE_URL` directly |

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
- `APP_BASE_URL` (in production mode)

Fail fast with a clear error if missing.

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

Rules:

- A family with a configured key uses **only** that key — never a retry with `JWT_SECRET` after a
  failure. Without its own variable, password-reset and SSO state derive a key from `JWT_SECRET`
  through HMAC-SHA256 with a stable, versioned label (`kanap:v1:<family>`, `token-secret.util.ts`).
  The label version is a contract: bumping it rotates that family's key material.
- **Provisioning is the deliberate exception.** Its tokens are minted by a service outside this
  repository, which cannot compute a derived key, so the marker stays `provision` and the key stays
  `JWT_SECRET` until `PROVISIONING_TOKEN_SECRET` is set — and then that key is the only accepted one
  (lockstep deploy with the issuer). Sharing `JWT_SECRET` here is safe because the guard refuses the
  marker; what made it dangerous was the missing purpose control.
- `JwtAuthGuard` accepts only access tokens (RFC 8725 §3.12, "Use Explicit Typing"). Signature and
  tenant checks alone would accept any family, since all of them carry a valid `sub`/`tenant_id`.
  `purpose` is tested explicitly: `null`, `''`, a number, an object, another family's marker and the
  handoff's `type` are all rejected. Shape is checked on **every** acceptance path — a non-empty
  `sub` and no `type` claim — so a marked token cannot also be something else. A marker-less payload
  is accepted **only** during the compatibility window and only with that shape; a pre-fix SSO state
  (`mode`/`nonce`, no `sub`) is therefore refused from day one.
- Start-up reports where each family key comes from, plus the access-token compatibility window
  (`[SECRETS]` lines in `main.ts`). The window line is informational when the cut-over is pinned
  explicitly, and a warning when it needs an operator decision: deadline unparseable or already
  past, or no deadline configured (the derived window then renews with every restart).
- **Upgrade impact (both modes, once):**
  - Password-reset links and Entra SSO states minted before the upgrade stop verifying, because
    their family key changes even when no dedicated variable is configured.
  - Provisioning keeps working untouched, until an operator sets `PROVISIONING_TOKEN_SECRET`; from
    that moment the issuer must sign with the same key.
  - Untyped access tokens stop being accepted at `JWT_LEGACY_ACCESS_TOKEN_DEADLINE`, which must be
    an explicit future instant. In the web UI this costs one extra round trip (a 401 triggers
    `/auth/refresh`, and refresh tokens are unaffected); only clients holding a stale `Bearer` token
    of their own break. Announce both effects before deploying, then pin the deadline once every
    instance runs the new build.

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
| `main.ts` | 195 | First-boot provisioning | Creates tenant, admin user, subscription (On-Prem / 1000 seats) |
| `main.ts` | 324 | Tenancy middleware | Skips Host parsing, resolves to `DEFAULT_TENANT_SLUG`; returns 503 if tenant not ready |
| `platform-admin.util.ts` | 18 | `isPlatformAdmin()` | Returns `false` unconditionally |
| `public.controller.ts` | 157 | `POST /public/start-trial` | 404 |
| `public.controller.ts` | 277 | `POST /public/request-support-invoice` | 404 |
| `public.controller.ts` | 373 | `POST /public/activate-trial` | 404 |
| `admin-tenants.controller.ts` | 10 | All `/admin/tenants/*` | 404 via `MultiTenantOnlyGuard` |
| `admin-coa-templates.controller.ts` | 11 | All `/admin/coa-templates/*` | 404 via `MultiTenantOnlyGuard` |
| `admin-ops.controller.ts` | 11 | All `/admin/ops/*` | 404 via `MultiTenantOnlyGuard` |
| `billing.service.ts` | 1281 | `ensureSubscription()` fallback | Defaults to On-Prem / 1000 seats instead of Starter / 5 |
| `url.ts` | 163 | `resolveNotificationBaseUrl()` | Uses `APP_BASE_URL` directly (no subdomain substitution) |
| `portfolio-status-change-report.controller.ts` | 134 | Export base URL | Delegates to `resolveNotificationBaseUrl()` |
| `feature-gates.ts` | 34 | `MultiTenantOnlyGuard` | Throws 404 when `SINGLE_TENANT` is true |

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
| `url.ts` | 163 | `resolveNotificationBaseUrl()` | Single-tenant: `APP_BASE_URL` directly. Multi-tenant: `APP_URL` with slug substitution |
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

#### Navigation gating (`Layout.tsx`)

| Line | Condition | Effect |
|------|-----------|--------|
| 453 | `isSingleTenant` | Platform admin nav hidden entirely |
| 454 | `!config.features.billing` | Billing nav item filtered out |
| 455 | `!config.features.sso` | Auth/SSO nav item filtered out |
| 495 | `config.features.billing` | `SubscriptionBanner` hidden |

#### Component gating

| File | Line | Condition | Effect |
|------|------|-----------|--------|
| `LoginPage.tsx` | 95 | `config.features.sso` | "Sign in with Microsoft" button hidden |
| `LoginPage.tsx` | 164 | `config.features.email` | "Forgot password" link hidden |
| `ForgotPasswordPage.tsx` | 11 | `!config.features.email` | Shows "contact your administrator" message instead of form |
| `SubscriptionBanner.tsx` | 14 | `!config.features.billing` | Returns null (hidden) |
| `ProtectedRoute.tsx` | 116 | `config.features.billing` | Skips billing/subscription redirect when billing off |

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
| `infra/compose.onprem.yml` | On-prem Docker Compose (api + web only, no DB/storage) |
| `infra/.env.onprem.example` | Complete env template with `DEPLOYMENT_MODE=single-tenant` |

### Adding a New Feature Gate

When adding a new gate, follow this checklist:

1. **Add the flag** to `backend/src/config/features.ts` if it's a new feature area
2. **Gate the backend** at controller level using `throwFeatureDisabled()` or `MultiTenantOnlyGuard`
3. **Expose to frontend** via `config.controller.ts` → `GET /config/public` response
4. **Update `FeaturesContext.tsx`** type definition if adding a new feature key
5. **Gate the frontend** — both routes (`App.tsx`) and navigation (`Layout.tsx`)
6. **Update this inventory** — add rows to the tables above
7. **Test both modes** — CI matrix catches build errors, but manually verify runtime behavior
