# API Reference (Short)

Metadata
- Purpose: Quick reference for core endpoints and allocation/metrics model
- Audience: Engineers, integrators
- Status: current
- Last Updated: 2026-10-08

## Auth

### Session Management
The API uses a **refresh token pattern with sliding expiration**:
- **Access tokens**: Short-lived (default 15 minutes), used for API authentication
- **Refresh tokens**: Longer-lived (default 4 hours), stored in database, extend on activity
- **Sliding window**: Each token refresh extends the session by the refresh TTL
- **Automatic logout**: Sessions expire after the refresh TTL of inactivity

Configuration (backend `.env`):
```
JWT_ACCESS_TOKEN_TTL=15m      # Access token lifetime (default: 15m)
JWT_REFRESH_TOKEN_TTL=4h      # Inactivity timeout / sliding window (default: 4h)
```

Rate limiting (default enabled):
- `RATE_LIMIT_ENABLED=true` to keep app-level throttling on; set `false` for local testing.
- `RATE_LIMIT_TRUST_PROXY=true` when behind a proxy/Cloudflare so limits use the real client IP.
- Defaults: `POST /auth/login` (5/60s), `POST /auth/password-reset/request` (3/15m), `POST /auth/password-reset/complete` (5/10m), `POST /public/start-trial` (5/10m), `POST /public/contact` (5/10m).

### Endpoints

- POST `/auth/login` → `{ access_token, refresh_token, expires_in, refresh_expires_in }`
  - Returns both tokens; `expires_in` is access token lifetime in seconds
  - `refresh_expires_in` is the refresh-token TTL in seconds (idle timeout window)
  - Use header `Authorization: Bearer <access_token>` for protected routes
  - Backend also sets `refresh_token` as an `HttpOnly` cookie (primary transport for refresh/logout)

- POST `/auth/refresh` → `{ access_token, expires_in, refresh_expires_in }`
  - Body: `{ refresh_token?: string }` (optional when `refresh_token` cookie is present)
  - Validates the refresh token, extends its expiration (sliding window), returns new access token
  - Returns 401 if refresh token is invalid or expired
  - Returns 403 `Origin not allowed` when the request's `Origin` (or, without it, the origin of its `Referer`) is refused by the CORS policy (`CORS_ORIGINS`, the configured application address, the address of the request; see `backend/src/common/cors-policy.ts`). No token is issued and no cookie is changed. A request with neither header is accepted as before.

- POST `/auth/logout` → `{ ok: true }`
  - Body: `{ refresh_token?: string }` (optional when `refresh_token` cookie is present)
  - Revokes the refresh token (logout from current device)
  - Returns success even if token was already revoked
  - Returns 403 under the same origin rule as `/auth/refresh`, before any token is revoked or cookie cleared.

- GET `/auth/me` → returns claims and subscription summary
  - Response:
    - `profile`: `{ id, email, first_name, last_name, status, role }`
    - `claims`: `{ isGlobalAdmin: boolean, isBillingAdmin: boolean, isPlatformAdmin: boolean, permissions: { [resource]: 'reader'|'manager'|'admin' } }`
    - `subscription`: `{ plan_name, seat_limit, seats_used }`
  - Notes:
    - Admin safety: users with the `Administrator` role have `admin` across all resources.
    - `seat_limit` is `null` (unlimited) unless a platform administrator set a user limit on the tenant's plan. `seats_used` counts users with `status='enabled'`.
- POST `/auth/password-reset/request` → `{ email }`
  - Body: `{ email: string }` (case-insensitive). Returns `{ ok: true }` whether or not the account exists.
  - Requires `RESEND_API_KEY` to be configured. Links are built from the configured application address: `APP_BASE_URL` (or `PUBLIC_APP_URL`) in single-tenant mode; in multi-tenant mode, the address of the request's tenant derived from the first of `APP_BASE_URL`, `PUBLIC_APP_URL`, `APP_URL` (for example `https://acme.kanap.net`). `Host` and `X-Forwarded-*` headers are followed only in development mode (`APP_ENV=development`) on a local development host (`lvh.me`, `localhost`, `dev.kanap.net` and their subdomains).
  - Without a configured address: `400` `application URL is not configured: set APP_BASE_URL`, checked before the account lookup, so every address gets the same answer.
  - Security: reset links now carry the token in URL fragment form (`/reset-password#token=...`) instead of query string.
- POST `/auth/password-reset/complete` → `{ ok: true }`
  - Body: `{ token: string, password: string }`. Minimum length 8.
  - Token expires based on `PASSWORD_RESET_TTL` (defaults to 1 hour).

### Microsoft Entra SSO
- POST `/auth/entra/setup/start` → `{ url }`
  - Requires tenant context + `users:admin` (the user must be an Administrator in the current tenant).
  - Reads `req.tenant` (blocked on the platform-admin host) and signs a short-lived `state` containing the OIDC `nonce` before returning an Entra consent URL. The SPA immediately navigates to the returned URL.
  - The nonce is validated from signed `state`, not from a browser cookie, so callbacks work across tenant subdomains and custom/on-prem domains.
- GET `/auth/entra/login?redirectTo=/path`
  - Public endpoint, but only available on tenant hosts that previously completed setup (`sso_provider='entra'`).
  - Validates `redirectTo` (defaults to `/`), signs new `state` containing the nonce, sends the same nonce to Microsoft, and 302s to the Microsoft authorization endpoint. Errors return JSON (e.g., `{ message: 'SSO_NOT_CONFIGURED' }`).
- GET `/auth/entra/callback`
  - Shared callback for both setup & login.
  - Mode and nonce are embedded in the signed `state` payload (`mode='setup' | 'login'`). The endpoint exchanges the auth code for tokens using the shared app registration, validates the ID token (issuer, audience, nonce, `tid`, `oid`, email), and then:
    - `mode=setup`: stores `sso_provider='entra'`, `entra_tenant_id=tid`, and metadata on the tenant, then redirects to `/admin/auth?setup=success` on the tenant host.
    - `mode=login`: links or provisions a tenant user (by external subject first, then email), signs a short-lived handoff, and redirects to `/login/callback#handoff=...` on the tenant host.
      - Security: the handoff is passed in the URL fragment, then the SPA redeems it with the tenant host via `POST /auth/entra/session`.
- POST `/auth/entra/session`
  - Public tenant-host endpoint used only by the Entra callback page.
  - Body: `{ handoff: string }`.
  - Validates that the handoff tenant matches `req.tenant`, issues app tokens, sets the `HttpOnly` `refresh_token` cookie on the tenant host, and returns `{ access_token, expires_in, refresh_expires_in, redirectTo }`.

- GET `/admin/auth/settings`
  - Requires `users:admin` and a tenant host.
  - Returns `{ sso_provider, sso_enabled, entra_tenant_id, entra_metadata }` for the current tenant. Used by the **Admin → Authentication** UI to show status and surface the “Test Microsoft sign-in” button (which simply calls `/auth/entra/login`).

## Public Utilities
- GET `/public/tenant-info`
  - Resolves tenant metadata for the current host.
  - Returns branding-aware tenant metadata for valid tenant hosts:
    - `{ slug, name, logoPath, logoVersion, useLogoInDark, primaryColorLight, primaryColorDark }`
    - `logoPath` is a relative API path (`/public/branding/logo`) or `null`.
    - `logoVersion` is a numeric cache-busting counter or `null` when no logo exists.
    - `useLogoInDark` controls whether the tenant logo is shown on dark headers/login.
    - `primaryColorLight`/`primaryColorDark` are `#RRGGBB` or `null`.
  - Returns `{ platform: true }` when called on `PLATFORM_ADMIN_HOST` (no tenant context).
  - Returns `{ marketing: true }` when called on marketing/apex hosts (no tenant context).
  - Responds `404 { error: 'TENANT_NOT_FOUND', marketingUrl }` for unknown slugs so the SPA can redirect users back to marketing.

- GET `/public/branding/logo`
  - Public logo stream for the current tenant (no JWT).
  - Returns `404` on platform host, unknown tenant context, or when no logo is configured.
  - Response headers include `Cache-Control: public, max-age=300`.

- GET `/public/captcha-config`
  - Returns current CAPTCHA client configuration for the marketing forms:
    - `{ provider: 'turnstile', mode: 'off'|'monitor'|'enforce', enabled: boolean, required: boolean, siteKey: string|null }`
  - `siteKey` is only returned when CAPTCHA is enabled and configured.

- POST `/public/start-trial` → `{ ok: true } | { ok: true, activation_url }`
  - Body: `{ org: string, slug: string, email: string, country_iso: string, captchaToken?: string }`
    - `slug` must match `/^[a-z0-9-]+$/`.
    - Slug normalization/reservation is centralized in `backend/src/tenants/tenant-slug-policy.ts`.
    - Reserved slugs rejected as unavailable: `www`, `api`, `admin`, `billing`, `account`, `platform-admin`, `app`, `nextcloud`, `migration`, `example`.
    - `country_iso` is a 2-letter ISO code (uppercase), used later for the initial company.
  - Behavior: saves a pending signup and emails an activation link. When email is not configured, returns `{ activation_url }` so QA/dev can activate manually.
  - The activation link starts with `MARKETING_BASE_URL`. Without it, outside development mode: `400` `marketing URL is not configured: set MARKETING_BASE_URL` for every request, before anything is saved or sent. In development mode, a request on a local development host stands in for it.
  - Unavailable slug response (reserved or already used by an active tenant): `400` with `message: 'Slug not available'` and `code: 'SUBDOMAIN_NOT_AVAILABLE'`.
  - CAPTCHA:
    - When `CAPTCHA_MODE=enforce`, a valid Turnstile token is required.
    - When `CAPTCHA_MODE=monitor`, verification failures are logged but requests are not blocked.
  - Security: activation links now use fragment token form (`/activate.html#token=...`).

- POST `/public/contact` → `{ ok: true }`
  - Body: `{ name: string, email: string, company: string, message: string, captchaToken?: string }`
  - CAPTCHA behavior matches `/public/start-trial` (`off|monitor|enforce`).

- POST `/public/activate-trial` → `{ tenant_url, reset_token }`
  - Body: `{ token: string }`
  - Behavior (transactional):
    - Creates the tenant and an Administrator user for the submitted email.
    - Creates an initial company named from the org/slug with `country_iso` from the signup.
    - Provisions the default global CoA into the tenant if a platform template is marked `loaded_by_default`.
    - Issues a password-reset token so the owner can set credentials inside the tenant.
    - `tenant_url` is the new tenant's address derived from the configured application address, as for password reset links (for example `https://acme.kanap.net`). Without a configured address: `400` `application URL is not configured: set APP_BASE_URL`, before the tenant is created.
    - Sends a non-blocking notification email to `admin@kanap.net` with the tenant name, slug, registered email, and `country_iso`. This notification does not affect the response if delivery fails.

## Admin Branding (Tenant)
These endpoints are tenant-scoped and require:
- JWT authentication
- `users:admin` permission
- tenant host context (platform host is blocked)

- GET `/admin/branding/settings`
  - Returns:
    - `{ has_logo, logo_version, use_logo_in_dark, primary_color_light, primary_color_dark }`

- POST `/admin/branding/logo`
  - Multipart upload (`file` field) for tenant logo.
  - Allowed formats: `PNG`, `JPG/JPEG`, `GIF`, `WEBP`.
  - Max file size: 20 MB.
  - Replaces previous logo if present.
  - Returns `{ ok, has_logo, logo_version, use_logo_in_dark }`.

- DELETE `/admin/branding/logo`
  - Deletes the current tenant logo (idempotent).
  - Increments `logo_version` to invalidate cached logo URLs.
  - Returns `{ ok, has_logo, logo_version, use_logo_in_dark }`.

- PATCH `/admin/branding/settings`
  - Body (partial):
    - `{ primary_color_light?: '#RRGGBB'|null, primary_color_dark?: '#RRGGBB'|null, use_logo_in_dark?: boolean }`
  - Returns merged settings payload:
    - `{ ok, has_logo, logo_version, use_logo_in_dark, primary_color_light, primary_color_dark }`.

- POST `/admin/branding/reset`
  - Restores defaults:
    - remove logo
    - `use_logo_in_dark = true`
    - clear both primary colors
  - Returns `{ ok, has_logo, logo_version, use_logo_in_dark, primary_color_light, primary_color_dark }`.

## Admin Sample Data (cloud workspaces)
Loads the Fromage & Co demonstration set into an empty workspace and erases a workspace back to its starting state. Requirements for all four routes:
- JWT authentication
- the user holds the **Administrator** role of the workspace (the role itself, not a module permission level). Otherwise `403` `administrator_required`. There is no `@RequireLevel`, so a frozen workspace is not blocked by the generic freeze guard; the service decides per route (see below).
- multi-tenant mode only: `404` in single-tenant mode (`MultiTenantOnlyGuard`), `404` on the platform host, and `404` for system tenants
- no request transaction (`@SkipTenantTransaction`): the service opens its own, so a reset never waits on a lock held by its own request

The state lives in `tenants.metadata.demo` (no table of its own). Status values: `idle`, `loading`, `loaded`, `failed`, `resetting`.

- GET `/admin/sample-data`
  - Returns the state plus what the page needs:
    - `{ status, step, started_at, heartbeat_at, loaded_at, loaded_by, failed_at, error_code, dismissed_at, ever_loaded_at, reset_failed_at, can_load, load_refusal, created_since_load, workspace_name, loaded_by_name }`
  - `?view=banner` returns the light view the home banner polls: no `created_since_load`, no `loaded_by_name`, and no check of the workspace content once the banner can no longer show (hidden, or sample data loaded once): `can_load` is then `false`. The page uses the full view.
  - `ever_loaded_at` is set when a load completes and is kept by a reset. The home banner never shows again once it is set.
  - `reset_failed_at` is set when a reset an Administrator asked for failed (nothing was changed). The next load or reset clears it.
  - `step` is the loader step of a running load (for example `companies`), `null` otherwise.
  - `error_code` when `status = failed`: `load_failed`, `load_timeout`, `load_not_started`, `load_interrupted` or `reset_failed` (the automatic reset after the failed load failed too).
  - `can_load` is true when the status is `idle` or `failed`, the subscription is in good standing and the workspace is still in its starting state (no business data, no added configuration; what activation creates does not count).
  - `load_refusal` says why a load would be refused now (status `idle` or `failed` only): `SUBSCRIPTION_FROZEN`, `TRIAL_EXPIRED` or `tenant_not_empty`. `null` when it would not be. The page shows one line from it, and no Load button.
  - `created_since_load` counts the rows created after `loaded_at` in the business and configuration tables, the companies and the documents (every library). Users are not counted: a reset keeps real users. `null` unless `status = loaded`.
  - `loaded_by_name` is the name of the user who started the last load, or their e-mail address when they have no name.
  - `workspace_name` is the name an Administrator types to confirm a reset (the workspace slug when the name is empty).
  - A `loading` or `resetting` state left by a stopped API process is taken over on read (reset, then `failed` or `idle`).

- POST `/admin/sample-data/load` → `202` with the `loading` state
  - No body. Starts the loader in the background; the client polls `GET`.
  - The request `Host` header (`req.headers.host`, never `X-Forwarded-Host`) must be a host of the workspace: the loader calls this API with it. The reverse proxies forward the browser's host unchanged.
  - Refused when:
    - `403` `administrator_required` (checked first: nothing else about the workspace is told to a non-Administrator)
    - `403` `tenant_not_active`
    - `403` `TRIAL_EXPIRED` or `SUBSCRIPTION_FROZEN` (same rule as the AI features, `evaluateSubscriptionAccess`; cloud only)
    - `400` `host_mismatch`
    - `409` `tenant_not_empty` (body lists the offending `tables`)
    - `409` `demo_status_conflict` (body carries the current `status`: a load, a reset or a loaded set already exists)
    - `409` `demo_load_capacity` (too many loads running across all workspaces)
    - `503` `demo_data_unavailable` (loader missing, or the server is stopping)
  - A failed load resets the workspace automatically and ends in `failed` with an `error_code`.

- POST `/admin/sample-data/reset` → `202` with the `resetting` state
  - Body: `{ confirm_name: string }`, compared to `workspace_name` with surrounding spaces and case ignored. `400` `confirmation_mismatch` otherwise (also when missing).
  - Allowed when the status is `loaded` or `failed`, and on a frozen workspace or an expired trial. `409` `demo_status_conflict` otherwise; `409` `tenant_reset_running` if another reset holds the lock.
  - Runs `TenantResetService` in the background. It keeps real users and their roles, the subscription, the workspace name, address and logo, the Microsoft sign-in setup, the AI settings and the audit log (plus one audit entry with source reference `demo-reset`). Workspace settings (currencies, budget columns, classification catalog) go back to defaults. Storage objects are deleted after the commit.
  - While the status is `resetting`, every other write request of the workspace gets `409` `tenant_resetting` (reads, token refresh and sign-out still work).
  - After a successful reset, every enabled user with the Administrator role gets an e-mail (who, when, link to the workspace), if e-mail is enabled. A failure to send never fails the reset. The e-mail is sent by the service, also when another API process finishes a reset a stopped process left.
  - A reset that fails changes nothing: the state goes back to what it was, with `reset_failed_at` set, and the page shows the failure.

- POST `/admin/sample-data/dismiss` → `200` with the state
  - Hides the home banner for every Administrator: sets `metadata.demo.dismissed_at` (a targeted `jsonb_set`, never an entity save). A reset keeps it.

Rate limit: `load`, `reset` and `dismiss` allow 10 calls per 10 minutes per user (`RATE_LIMITS.sampleDataAction`, `UserRateLimitGuard`); `429` beyond, which the interface shows as a translated message ("Too many attempts. Wait a few minutes and try again."). `GET` has no dedicated limit.

Public config: `GET /config/public` returns `features.sampleData` (`true` in multi-tenant mode, `false` in single-tenant mode). The frontend shows the navigation entry and the home banner only when it is true and the user holds the Administrator role. The route itself is always registered; the page refuses itself otherwise.

## Billing
- GET `/billing/subscription` → `{ plan_name, seat_limit, seats_used }`
- POST `/billing/portal` → `{ url }`
  - Opens Stripe Customer Portal for Billing/Global Admins
  - Requires env: `STRIPE_SECRET_KEY` (or `STRIPE_SECRET`) and a `stripe_customer_id` stored in subscription
- GET `/billing/profile` → `{ subscription, customer, invoice, invoice_missing_fields, invoices }`
  - `invoice_missing_fields: string[]` lists the invoice details still missing, in the order below (empty when complete). Possible keys: `company`, `email`, `addressLine1`, `postalCode`, `city`, `country`, `vatNumber`.
  - A malformed email, a country that is not an ISO 3166-1 alpha-2 code, or a malformed EU VAT number counts as missing. `vatNumber` is only reported when the country is in the EU.
  - `invoice` is read field by field: the saved invoicing value, else the stored customer contact (`customer`, from the former customer card), else the tenant billing columns. A field saved empty stays empty.
- PATCH `/billing/profile` → `{ customer, invoice, invoice_missing_fields, invoices }`
  - Body: `{ invoice?: { name?, company?, email?, phone?, vatNumber?, address?: { line1?, line2?, city?, state?, postalCode?, country? } }, customer?: { same fields } }`. The billing page sends one changed field per call, for example `{ "invoice": { "address": { "city": "Lyon" } } }`.
  - A field present in the body replaces the saved value; an empty string or `null` clears it. A field left out stays as it is, and so does the whole address when `address` is left out or `null`. `email` accepts an empty string or `null` (clearing it); any other value must be an email address (400 otherwise).
  - Every save writes all invoicing fields, cleared ones as `null`, so values taken from the customer contact become invoicing values. `customer` is written only when the body holds it.
  - Incomplete details are accepted and saved; the answer reports what is still missing in `invoice_missing_fields`.
- POST `/billing/checkout` → `{ url, id }`
  - Body: `{ plan_key, interval, success_url?, cancel_url?, allow_promotion_codes? }`. `plan_key` (a current plan: `max`) and `interval` (`monthly` or `annual`) are required; a missing or unknown value is a 400. The price is always the plan's configured Stripe price (`STRIPE_PRICE_<PLAN>_<INTERVAL>`) and the quantity is always 1. The former `price_id`, `quantity` and `subscription_type` fields are gone: the validation pipe strips them, so they have no effect. A plan without a configured price is a 400.
  - Refused before any Stripe call when the invoice details are incomplete: 400 `{ "message": "BILLING_PROFILE_INCOMPLETE", "missing": [ ... ] }`. `missing` holds the keys listed above, in that order.
  - 400 `{ "message": "VAT_NUMBER_INVALID" }` when Stripe does not accept the EU VAT number. The invoice details are copied to the Stripe customer at this point, and an EU VAT number is registered there as a tax id so it appears on invoices.
- POST `/billing/request-invoice` (bank transfer)
  - Same 400 answers as `/billing/checkout`: `BILLING_PROFILE_INCOMPLETE` with `missing`, and `VAT_NUMBER_INVALID`.

## Companies
- GET `/companies?year=YYYY&status=enabled|disabled&page=1&limit=50&sort=name:ASC`
  - Response item fields include (in addition to company fields):
    - `headcount_year: number` (0 if missing)
    - `it_users_year: number` (0 if missing)
    - `turnover_year: number` (0 if missing)
    - `metrics_frozen: boolean`
    - `metrics_frozen` reflects the `freeze-states` companies scope for that year
- GET `/companies/ids?year=YYYY&sort=headcount_year:DESC&q&filters`
  - Returns `{ ids: string[], total: number }` ordered according to the current list query (supports the Companies workspace prev/next navigation).
- POST `/companies` → create
- PATCH `/companies/:id` → update (no metrics here)

### Company and CoA
- Companies include an optional `coa_id` which links the company to a Chart of Accounts.
- If `coa_id` is not supplied on create/update, the backend auto-assigns the default CoA for the company’s `country_iso` (when available); otherwise it falls back to the tenant’s Global Default CoA (a `GLOBAL`‑scoped CoA).

### Companies CSV
- GET `/companies/export?scope=template|data&year=YYYY&language=en|fr|de|es` → `text/csv`
- POST `/companies/import?dryRun=true|false&year=YYYY&language=…&dateOrder=day-first|month-first&decimalMark=comma|dot` (multipart `file`)
- Headers: `name, country_iso, address1, address2, postal_code, city, state, reg_number, vat_number, base_currency, status, disabled_at, notes, headcount_<Y-1>, it_users_<Y-1>, turnover_<Y-1>, headcount_<Y>, it_users_<Y>, turnover_<Y>, headcount_<Y+1>, it_users_<Y+1>, turnover_<Y+1>`. Upsert on `name`.
- **Shared master-data CSV contract.** Every master-data route below (companies, departments, users, suppliers, accounts, cost centers, analytics values, working-day calendars) reads through `backend/src/common/csv-sheet/` and shares this contract:
  - `language` (`en|fr|de|es`) sets the separator, the decimal mark and the date form of an export and the reading conventions of an import. Without it, the user's stored locale, then English.
  - `dateOrder` (`day-first|month-first`) and `decimalMark` (`comma|dot`) are the switches used when the file itself does not settle the question.
  - The report carries `notices: { dates: string | null, amounts: string | null }` (the one-line reading, for example "Dates read day first: 01/03/2027 is March 1.") and `ignoredColumns: string[]`, always empty for these files: a column KANAP does not know is a `row: 0` "Header mismatch. Missing: X, Extra: Y".
  - A file that cannot be read at all (encoding, empty, over 20,000 rows, unclosed quote) is a 400 with the shared layer's message.

## Charts of Accounts (Tenant)
- GET `/chart-of-accounts` → list (supports quick search and AG Grid filters; filter and sort on `is_consolidation` like the other flags)
  - Items include `scope: 'GLOBAL'|'COUNTRY'`, `country_iso` (NULL for GLOBAL), `is_default`, `is_global_default`, `is_consolidation`, `companies_count`, `accounts_count`, `accounts_unmapped_count` (accounts without consolidation number) and `accounts_outside_count` (number set but absent from the tenant's consolidation chart; 0 when the tenant has none). Disabled accounts count too.
- GET `/chart-of-accounts/:id` → detail, with the same flags and counts
- POST `/chart-of-accounts` → create
  - Body: `{ code: string, name: string, scope: 'GLOBAL'|'COUNTRY', country_iso?: string(2), is_default?: boolean }`
  - Rules: `scope='GLOBAL'` → `country_iso` omitted and `is_default=false`. `scope='COUNTRY'` → `country_iso` required; `is_default=true` makes it the single default for that country.
- PATCH `/chart-of-accounts/:id` → update (enforces the same scope rules as create)
- PATCH `/chart-of-accounts/:id/global-default` → sets the Global Default CoA ("Default for other countries")
  - Only allowed when the target CoA has `scope='GLOBAL'`; clears any previous Global Default and assigns it to companies with `coa_id=NULL`. Empty response.
- DELETE `/chart-of-accounts/:id/global-default` → removes the Global Default from this CoA → `{ cleared: boolean }` (`false` when it did not hold it)
- PATCH `/chart-of-accounts/:id/consolidation` → makes this CoA (any scope) the tenant's consolidation chart and clears the previous one, then resyncs the derived fields: every account whose `consolidation_account_number` matches an account of this CoA takes that account's name and description. Accounts are never remapped.
  - Response: `{ resynced: number, outside: number }`: the accounts whose consolidation name or description was rewritten, and the accounts of the other CoAs whose consolidation number is absent from this CoA.
- DELETE `/chart-of-accounts/:id/consolidation` → removes the consolidation role from this CoA → `{ cleared: boolean }` (`false` when it did not hold it); accounts are not touched
- GET `/chart-of-accounts/:id/consolidation-impact` → preview before a switch, no write → `{ matched, outside, unmapped }`: among the accounts of the other CoAs, those whose consolidation number exists in this CoA, is set but absent from it, or is not set
- Role endpoints require `accounts` at manager level (`member`). Every role change is audited on `chart_of_accounts` (one line per CoA changed, before and after); the accounts rewritten by a resync get one audit line each. The country default stays on PATCH `/chart-of-accounts/:id` with `{ is_default: true|false }`.
- DELETE `/chart-of-accounts/:id` → guarded delete
  - Blocks when companies reference the CoA
  - Blocks when any OPEX/CAPEX items reference its accounts
  - If no usage, removes the CoA and all its unused accounts
- DELETE `/chart-of-accounts/bulk` → guarded bulk delete
- GET `/chart-of-accounts/templates` → platform-admin template catalog (for tenant selection in “Copy from template”)
- POST `/chart-of-accounts/:id/load-template` → `{ template_id, dryRun?: boolean, overwrite?: boolean }`
  - When `overwrite=false`, only new account numbers are inserted; existing ones are left unchanged.
  - When `overwrite=true` (default), existing accounts are updated.
  
  Preflight:
- POST `/chart-of-accounts/import-template/preflight` → `{ template_id, target_coa_id? }`
  - Without `target_coa_id`, returns counts for creating a new CoA: `{ ok, dryRun: true, total, inserted: total, updated: 0 }`.
  - With `target_coa_id`, returns `{ ok, dryRun: true, total, inserted, updated }` based on conflicts in the target CoA.
  - Copies accounts from the selected platform template into the target CoA; supports preflight (`dryRun: true`).

## CoA Templates (Platform Admin)
Requires platform admin claim (`isPlatformAdmin: true`) and must be called on the platform admin host. These endpoints manage the cross-tenant template catalog that tenants can copy from.

- GET `/admin/coa-templates` → list
- GET `/admin/coa-templates/:id` → detail
- POST `/admin/coa-templates` → create
  - Body: `{ template_code: string, template_name: string, version: string, is_global?: boolean, loaded_by_default?: boolean, country_iso?: string }`
  - If `is_global=true`, `country_iso` is ignored (NULL). If `is_global=false` or omitted, `country_iso` is required (2-letter ISO).
  - At most one global template can be `loaded_by_default=true` at a time (enforced). This template is auto-provisioned into every new tenant as the tenant’s Global Default CoA.
- PATCH `/admin/coa-templates/:id` → update (same fields as POST; you can toggle `is_global` and `loaded_by_default`)
- DELETE `/admin/coa-templates/:id` → delete template metadata + CSV payload
- GET `/admin/coa-templates/:id/export` → download accounts CSV (semicolon, UTF‑8 with BOM)
- POST `/admin/coa-templates/:id/import?dryRun=true|false` → upload accounts CSV (headers validated; preflight on `dryRun=true`)

Template Accounts (CSV-backed, addressed by `account_number`)
- GET `/admin/coa-templates/:id/accounts?sort=account_number:ASC&q=&page=1&limit=50` → list parsed rows
- GET `/admin/coa-templates/:id/accounts/ids?sort=...&q=...` → `{ ids: string[] }` ordered for prev/next navigation
- GET `/admin/coa-templates/:id/accounts/:accountNumber` → single row (404 if the number does not exist in the template)
- POST `/admin/coa-templates/:id/accounts` → create row `{ account_number, account_name, native_name?, description?, consolidation_account_number?, consolidation_account_name?, consolidation_account_description?, status }`
- PATCH `/admin/coa-templates/:id/accounts/:accountNumber` → update row (supports renumbering; prevents duplicates)
- DELETE `/admin/coa-templates/:id/accounts/bulk` → bulk delete `{ ids: string[] }` by account numbers
- DELETE `/admin/coa-templates/:id/accounts/:accountNumber` → delete one row by its `account_number`

Notes
- Global templates appear in UI with scope “ALL”. Country templates display their 2-letter code.
- The single template with `loaded_by_default=true` (global scope) is applied during tenant provisioning; its accounts are copied into the tenant’s newly created Global Default CoA (editable by the tenant).

### CoA-scoped Accounts CSV
- GET `/chart-of-accounts/:id/accounts/export?scope=template|data&language=…`
  - `template`: header line only; `data`: rows for this CoA
- POST `/chart-of-accounts/:id/accounts/import?dryRun=true|false&language=…&dateOrder=…&decimalMark=…`
  - UTF‑8 CSV with the separator of the language (`,`, `;` or a tab are all read); validates header and rows; returns preflight or applies changes
  - Same shared master-data contract as `/companies/import`

CSV schema (CoA-scoped):
```
account_number;account_name;native_name;description;consolidation_account_number;consolidation_account_name;consolidation_account_description;status
```
Notes: `native_name` is optional (original local-language label). `account_number` must be integer-like; `status` is `enabled|disabled`.

## Platform Admin: CoA Templates & Standard Accounts
- GET `/admin/coa-templates` → list templates `{ id, country_iso, template_code, template_name, version, created_at, updated_at }`
- GET `/admin/coa-templates/:id` → get template
- POST `/admin/coa-templates` → create template `{ country_iso, template_code, template_name, version }`
- PATCH `/admin/coa-templates/:id` → update template metadata or `csv_payload`
- DELETE `/admin/coa-templates/:id` → delete template

CSV (Templates)
- GET `/admin/coa-templates/:id/export` → returns template CSV (headers only if empty)
- POST `/admin/coa-templates/:id/import?dryRun=true|false` → preflight/commit CSV payload for the template
  - Response: `{ ok, dryRun, total, inserted, updated, processed?, errors: [] }`

Standard Accounts within a Template
- GET `/admin/coa-templates/:id/accounts?sort=account_number:ASC&q=&page=1&limit=50` → list standard accounts parsed from the template CSV
- GET `/admin/coa-templates/:id/accounts/ids?sort=...&q=...` → `{ ids: string[] }` ordered for workspace navigation
- GET `/admin/coa-templates/:id/accounts/:accountNumber` → get a single account
- POST `/admin/coa-templates/:id/accounts` → create `{ account_number, account_name, native_name?, description?, consolidation_account_number?, consolidation_account_name?, consolidation_account_description?, status }`
- PATCH `/admin/coa-templates/:id/accounts/:accountNumber` → update (supports changing `account_number`)
- DELETE `/admin/coa-templates/:id/accounts/:accountNumber` → delete one
- DELETE `/admin/coa-templates/:id/accounts/bulk` → delete many `{ ids: string[] }` (ids are account numbers as strings)

Notes
- Platform Admin endpoints operate outside of tenant context and never read/write tenant `accounts`.
- Standard accounts are stored as the template’s `csv_payload` and are used to seed tenant CoAs via `/chart-of-accounts/:id/load-template`.

## Accounts (Tenant)
- GET `/accounts?status=...&page=...&limit=...&sort=...&filters=...&companyId=...&coaId=...&consolidationStatus=...`
  - Respects quick search and AG Grid filter model
  - Supports CoA scoping via `companyId` (company’s `coa_id`) or explicit `coaId`
  - Items include `coa_code` to display CoA in the grid, and `consolidation_status`: `mapped` (the consolidation number exists in the tenant's consolidation chart), `outside` (set but absent from it), `unmapped` (no number), or `null` (a number is set and the tenant has no consolidation chart)
  - `consolidationStatus=mapped|outside|unmapped` filters on the server; page and total follow the filter; without a consolidation chart `mapped` and `outside` return no account (`unmapped` still returns the accounts without a number); any other value is a 400
- GET `/accounts/ids?sort=...&q=...&filters=...&consolidationStatus=...` → `{ ids, total }` (ordered by current list query)
- GET `/accounts/:id` → detail, with `consolidation_status`
- POST `/accounts`, PATCH `/accounts/:id` and the CSV imports derive `consolidation_account_name` and `consolidation_account_description` from the consolidation chart's account of the given number; without a match (or without a consolidation chart) the values sent are kept, and a new number drops the name and description not sent with it; a null or empty number clears both. When an account of the consolidation chart is created, renamed, described or renumbered, or an account joins the consolidation chart (`coa_id`), every account mapped to its old or new number follows it (number, name, description) in the same transaction, one audit line per account. An account that leaves the consolidation chart takes nobody along (the accounts mapped to it become `outside`).
- GET `/accounts/export?scope=template|data&coaId=...&language=…`
  - Global export includes `coa_code`; when `coaId` is provided, export is scoped
- POST `/accounts/import?dryRun=true|false&coaId=...&language=…&dateOrder=…&decimalMark=…`
  - If `coaId` is not provided, the CSV must include a single uniform `coa_code` across all rows
  - Same shared master-data contract as `/companies/import`

CSV schema (Global):
```
coa_code;account_number;account_name;native_name;description;consolidation_account_number;consolidation_account_name;consolidation_account_description;status
```
Validation/behavior:
- `account_number`: required integer-like (stored as text)
- `account_name`: required (English UI label)
- `native_name`: optional (local-language label); exported and visible in UI tooltip
- `consolidation_*`: optional; number must be integer-like when present
- Deduplicates by `(account_number, target CoA)`; classifies rows as insert/update in the target CoA; supports `dryRun` preflight

### Company Metrics (per year)
- GET `/company-metrics/:companyId?year=YYYY` → `{ headcount, it_users, turnover, ... } | null`
- PATCH `/company-metrics/:companyId?year=YYYY`
  - Body: `{ headcount: int, it_users?: int, turnover?: number(<=3dp) }`
  - Validation errors: headcount/it_users must be non‑negative integers; turnover non‑negative, ≤3 decimals
  - Freeze: edits are rejected when the `freeze-states` API reports the companies scope locked for that year

## Departments
- GET `/departments?year=YYYY&status=enabled|disabled&page=1&limit=50&sort=name:ASC`
  - Response item fields include:
    - `headcount_year: number` (0 if missing)
    - `metrics_frozen: boolean`
    - `metrics_frozen` reflects the `freeze-states` departments scope for that year
- GET `/departments/ids?year=YYYY&sort=headcount_year:DESC&q&filters`
  - Returns `{ ids: string[], total: number }` ordered according to the current list query (supports the Departments workspace prev/next navigation).
- POST `/departments` → create
- PATCH `/departments/:id` → update (no metrics here)

### Departments CSV
- GET `/departments/export?scope=template|data&language=…` → `text/csv`
- POST `/departments/import?dryRun=true|false&language=…&dateOrder=…&decimalMark=…` (multipart `file`)
- Headers: `company_name, name, description, status, disabled_at`. Upsert on `company_id + name`. Same shared master-data contract as `/companies/import`.

## Cost Centers
- RBAC: resource `cost_centers` (`reader` to view, `member` to create and edit, `admin` to delete, import and export). `GET /cost-centers/tree` and `GET /cost-centers/tree/count` also answer `opex`, `capex` or `reporting` readers (item forms and budget reports).
- A node is a `group` or a `cost_center`. A cost center has a company and no children and is what OPEX and CAPEX lines are attached to; a group has no company and may hold nodes of several companies. Codes are trimmed, 1 to 50 characters, unique per tenant case-insensitively.
- Node fields (`CostCenterTreeNode`): `id, code, name, kind, parent_id, company_id, company_name, owner_user_id, owner_name, status, disabled_at, sort_order, depth, path, path_ids` (`status` is the effective lifecycle from `disabled_at`; `path` joins the names root → node with ` › `).
- GET `/cost-centers/tree` → `{ items: CostCenterTreeNode[] }`: the whole tree in tree order (siblings by `sort_order`, then code), disabled nodes included. `Cache-Control: private, no-cache` with an `ETag`: a request with `If-None-Match` on an unchanged tree answers 304 without a body.
- GET `/cost-centers/tree/count` → `{ count }`: how many nodes the tenant has (the budget reports show their cost center filter only when there is one, without loading the tree). Same readers and cache headers.
- GET `/cost-centers?page&limit&sort&q&filters&status|includeDisabled` → `{ items: (CostCenterTreeNode & { parent_code, parent_name })[], total, page, limit }`
  - Default sort `path:ASC` (tree order); set filters on `kind`, `status`, `company_name`, `parent_name` (plus text filters on `code`, `name`, `owner_name`, `path`); `q` matches code, name and path. Enabled nodes only unless `status` or `includeDisabled=1` says otherwise.
- GET `/cost-centers/ids` (same params) → `{ ids: string[], total }` for the workspace prev/next.
- GET `/cost-centers/:id` → node + `{ parent_code, parent_name, description, opex_count, capex_count }`
- POST `/cost-centers` `{ code, kind, name, description?, parent_id?, company_id?, owner_user_id?, status?, disabled_at?, sort_order? }` and PATCH `/cost-centers/:id` (any subset; `null` clears) → same shape as GET `/:id`.
  - Refusals are `400 { message, field }`: company required on a cost center and refused on a group; only a group can be a parent, no self-parenting or loop; a cost center used by lines cannot become a group; a group holding nodes cannot become a cost center; company, owner and parent must belong to the tenant (a new company must be enabled, a new owner an enabled user; the stored value is always kept); duplicate code. Turning a node into a group without sending `company_id` drops its company.
- DELETE `/cost-centers/:id` → 200, or 409 with a readable message when the node is used by lines (`IT-300 is used by 3 OPEX lines and 1 CAPEX line. Disable it instead.`) or still holds nodes.
- DELETE `/cost-centers/bulk` `{ ids }` → `{ deleted: string[], failed: { id, name, reason }[] }` (each delete under its own savepoint; deeper nodes first, so a group and its content go together).
- GET `/cost-centers/export?scope=data|template&language=…` and POST `/cost-centers/import?dryRun=true|false&language=…&dateOrder=…&decimalMark=…` (multipart `file`; the separator follows the language and `,`, `;` and a tab are all read; same shared master-data contract as `/companies/import`)
  - Headers `code;kind;name;parent_code;company_name;owner_email;description;status;disabled_at` (`disabled_at` optional on import). `kind` is `group` or `cost_center`, `status` `enabled` or `disabled`.
  - Upsert matched by code (case-insensitive); parents resolve against the file and the stored tree, so any row order imports; the whole resulting tree is checked before anything is written. → `{ ok, dryRun, total, inserted, updated, unchanged, errors: { row, message }[] }`; an export imported back is all `unchanged`.
- Every write takes a per-tenant advisory lock (`cost-center:<tenant>`), so concurrent tree edits are serialized.

## Working-day Calendars
- RBAC: resource `working_day_profiles` ("Working-day calendars" in the UI). `GET /working-day-profiles`, `/ids`, `/countries`, `/:id` and `/:id/years/:year` answer `reader` on any of `working_day_profiles`, `opex`, `capex` (the budget tab's quantity and price lines list the calendars); `member` creates and edits, and reads `/suggestions`; `admin` deletes, imports and exports.
- A calendar holds, per year, the working days of the twelve months: `days_by_year: { "<year>": string[12] }`. A price per day multiplies them (people) or divides the days bought by them for the FTE (days); a quantity and price line that uses a calendar references it by `(tenant_id, working_day_profile_id)` with `ON DELETE RESTRICT`. Table `working_day_profiles`, tenant-scoped with forced RLS.
- Standard calendar: `country_iso` (two upper-case letters) and optionally `region_code` (a state code of the public holiday rules), both set at creation and never changed; a custom calendar has both `null`. The working days of a year on a standard calendar are `days_by_year[year]` when that year was edited, otherwise generated from the country's public holidays: the month's Monday to Friday days that are not a public holiday (type `public` only), any year from 2000 to 2100, nothing generated is stored. The rules come from the `date-holidays` package (bundled, no network call; code ISC, data CC BY-SA 3.0). "Reset to standard" is `PATCH days_by_year: { "<year>": null }`. Every computation of a line priced per day reads the days through the same rule.
- `lang` (query, optional, default `en`; `fr-FR` reads as `fr`) names countries, regions and holidays in that language: country names from the runtime's Intl data, region and holiday names from the package (falling back to the country's language, then English).
- Days rules (one helper shared by the API, the CSV and the computation): a year key of four digits from 2000 to 2100; exactly twelve values; each a decimal from 0 to the month's calendar days (29 in a leap February), at most 6 decimals, a decimal comma accepted, numbers or strings. Stored and returned normalised, without trailing zeros (`"18"`, `"19.083333"`). Refusals are sentences: "March 2027 has 31 days: enter 31 or less.", "Enter the working days of all twelve months of 2027.", "Use at most 6 decimals.", "2201 is not a year between 2000 and 2100.".
- `WorkingDayProfile` = `{ id, code, name, description, days_by_year, status, disabled_at, created_at, updated_at }` (`status` is the effective lifecycle: disabled once `disabled_at` has passed; years in ascending order).
- `WorkingDayProfile` = `{ id, code, name, description, days_by_year, country_iso, region_code, country_name, region_name, status, disabled_at, created_at, updated_at }` (the four source fields `null` on a custom calendar; `region_name` `null` without a region).
- GET `/working-day-profiles?page&limit&sort&q&filters&status|includeDisabled&lang` → `{ items: (WorkingDayProfile & { years: string[] })[], total, page, limit }`
  - `years` = the stored years (on a standard calendar, the edited ones).
  - Default sort `code:ASC`; sort on `code`, `name`, `description`, `status`, `years`, `disabled_at`, `created_at`, `updated_at`, `country` (read as "France (Moselle)"), `country_iso`, `country_name`, `region_code`, `region_name` (blanks last ascending). Filters (grid model, set or text) on `code`, `name`, `description`, `status`, `years` (read as `2026, 2027`), `disabled_at` and the five source fields; `q` matches code, name, description and the country read as "France (Moselle)". Enabled calendars only unless `status`, a `status` filter or `includeDisabled=1|true` says otherwise.
- GET `/working-day-profiles/countries?lang` → `{ items: { code, name, regions: { code, name }[] }[] }`: every country the public holiday rules know (207), sorted by name in `lang`, regions sorted by name.
- GET `/working-day-profiles/suggestions?lang` (`member`) → `{ items: { country_iso, country_name, companies: string[] }[] }`: the known countries of the tenant's enabled companies without a standard calendar for the whole country (any status; a region's calendar does not count), company names sorted, items sorted by country name.
- GET `/working-day-profiles/:id/years/:year?lang` → `{ year, source: 'edited' | 'standard' | 'none', days: string[12] | null, standard_days: string[12] | null, holidays: { date: 'YYYY-MM-DD', name, weekend }[] }`. `source` is `edited` when `days_by_year` holds the year, `standard` when generated, `none` on a custom calendar without it; `days` = what a computation uses. On a standard calendar `standard_days` and `holidays` are the generated values also when the year is edited (holidays on a Saturday or Sunday are listed with `weekend: true` and not counted); `null` and `[]` on a custom one. `400` "Pick a year between 2000 and 2100.", `404` "Calendar not found.".
- GET `/working-day-profiles/ids` (same params) → `{ ids: string[], total }` (at most 10,000 ids) for the workspace prev/next.
- GET `/working-day-profiles/:id?lang` → `WorkingDayProfile & { opex_count, capex_count }`: the distinct OPEX and CAPEX lines (items) with at least one quantity and price line (any year, any column) on the calendar. `404` "Calendar not found." for an unknown id or another tenant's.
- POST `/working-day-profiles?lang` `{ code, name, description?, days_by_year?, status?, disabled_at?, country_iso?, region_code? }` → as GET `/:id`. With `country_iso` the calendar is standard (codes matched without case and stored as the rules write them); days given become edited years. Refusals (`field: 'country_iso'` or `'region_code'`): "Country ZZ is not in the list.", "BY is not a region of France.", "Give the country of region 57.".
- PATCH `/working-day-profiles/:id?lang` (any subset) → as GET `/:id`. `days_by_year` is merged per year: a year sent replaces that year, a year sent as `null` is removed (on a standard calendar the year follows the rules again), the other years stay as stored. `country_iso` and `region_code` are accepted only equal to the stored values; otherwise `400` "The country of a calendar cannot be changed. Create another calendar." (`field: 'country_iso'`). An unchanged body writes nothing (no audit row).
  - Code 1 to 50 characters and name 1 to 200, both trimmed and unique per tenant case-insensitively. Refusals are `400 { message, field }`: "Code is required.", "A calendar with code FR218 already exists.", "A calendar named France 218 already exists." (checked before the unique indexes, which answer with the same sentences), a days rule above (`field: 'days_by_year'`), an invalid status or end of validity.
  - Lifecycle as on cost centers: `status: 'disabled'` sets `disabled_at` to now when none is stored, `status: 'enabled'` clears it, a `disabled_at` still to come keeps the calendar enabled until then. A disabled calendar keeps its days and stays valid on the lines that use it; it cannot be newly used by a column's lines, and writing again the lines of a column whose stored lines already use it goes through with a warning.
  - Editing a calendar never rewrites a stored amount or explanation: a computation keeps the day counts each line used in the round's `last_calculation`.
- DELETE `/working-day-profiles/:id` → 200, or 409 while a quantity and price line uses it ("France 218 is used by 3 OPEX lines and 1 CAPEX line. Disable it instead."; counts are distinct OPEX and CAPEX lines, items, through their rounds and versions). The calendar row is locked before the count, so a line written concurrently is either counted or refused by its key.
- DELETE `/working-day-profiles/bulk` `{ ids }` (at most 1,000) → `{ deleted: string[], failed: { id, name, reason }[] }` (each delete under its own savepoint: a refused one leaves the others deleted).
- Create, update and delete write an audit row (`table_name = 'working_day_profiles'`).
- Company creation (`CompaniesService.create`: the page, the companies CSV import, the AI tools, the trial signup): when the company's `country_iso` is known to the rules and the tenant has no standard calendar for that whole country, the standard calendar `{ code: <ISO>, name: <country name in the creator's language, else English>, country_iso }` is created in the same transaction, audited as the creator. A taken code or name, or any other failure, is logged and never fails the company creation (its own savepoint). Not on update.
- GET `/working-day-profiles/export?scope=data|template&language=…` and POST `/working-day-profiles/import?dryRun=true|false&language=…&dateOrder=…&decimalMark=…` (multipart `file`; the separator follows the language; same shared master-data contract as `/companies/import`)
  - Headers `code;name;description;country;region;status;disabled_at;year;jan;feb;mar;apr;may;jun;jul;aug;sep;oct;nov;dec` (`disabled_at`, `country` and `region` optional on import). One row per calendar and year, years ascending; a calendar without years exports one row with a blank year and blank months. `country` and `region` are the codes of a standard calendar, which exports its edited years only.
  - `country` and `region` are applied when the row creates a calendar (validated against the rules, a region must belong to its country, same sentences as POST); on an existing calendar each is blank (kept) or equal to the stored value, otherwise the row is refused with "The country of a calendar cannot be changed. Create another calendar.". Rows of one code must agree on them too. Year rows of a standard calendar are edited years.
  - Rows match stored calendars on code (case-insensitive) and fold into one calendar per code. The whole file is validated before anything is written: rows of one code must agree on name, description, status and end of validity ("Rows of FR218 disagree on the name."); a year appears once per code ("FR218 has 2026 twice (rows 2 and 4)."); a row with a year gives its twelve months (days rules above); months without a year are refused; names stay unique across the stored calendars and the file. Years absent from the file are kept: an import never removes a year.
  - → `{ ok, dryRun, total, inserted, updated, unchanged, errors: { row, message }[] }`, counted per row: `inserted` for a new calendar or a new year, `updated` for a changed year (or the first row of a calendar whose fields changed), `unchanged` otherwise. A header mismatch is an error at row 0. One audit row per calendar written; an export imported back is all `unchanged` and writes nothing.

## Applications (IT Landscape)
- RBAC: resource `applications` (`reader` to view, `manager` to mutate). Admin inherits all.

- GET `/applications?status=enabled|disabled&page=1&limit=50&sort=created_at:DESC&q&filters&include`
  - AG Grid filters supported for logical columns; lifecycle filter defaults to excluding `retired`.
  - Column filters in the Applications grid (including the "Environments" summary column) are forwarded as AG Grid models via `filters` and compiled server-side; text filters use contains-style semantics (`ILIKE '%value%'`).
  - Items include `derived_total_users` plus optional expansions driven by `include`:
    - `supplier` → adds `supplier_name`
    - `owners` → adds `owners_business`, `owners_it`
    - `counts` → adds spend/capex/contracts counts + first-item tooltips
    - `residency` → adds `data_residency` ISO codes
    - `structure` → adds `suites_count`, `first_suite_name`, `components_count`, `first_component_name`
    - `instances` → adds `instances: AppInstanceSummary[]` (env, URLs, auth flags, status)
  - Sorting on derived columns is unlocked only when the respective `include` is present.
- GET `/applications/filter-values?fields=fieldA,fieldB&q&filters&include`
  - Distinct filter values for closed-choice columns in Apps & Services.
  - Response: `{ fieldA: Array<string | null>, fieldB: Array<string | null> }`
  - Caller should remove the column’s own filter so values stay discoverable.
  - Lifecycle default exclusion (Retired) is not applied to filter-values so users can opt in.
- GET `/applications/with-server-assignments`
  - Returns applications that have at least one app instance with server assignments.
  - Response: `{ items: [{ id, name, lifecycle, environments: string[] }] }` where `environments` lists only those with server assignments.
  - Used by Connection Map for app-based server selection.
- GET `/applications/:id?include`
  - Returns the logical application fields plus inline collections (owners, companies, departments, links, attachments, data_residency, derived_total_users). `include=instances` attaches the environment-level rows.
- POST `/applications`
  - Body: `{ name, supplier_id?, description?, editor?, retired_date?, version?, go_live_date?, end_of_support_date?, lifecycle, criticality, data_class, external_facing?, is_suite?, last_dr_test?, etl_enabled?, contains_pii?, licensing?, notes?, users_mode?, users_year?, users_override? }`
  - Legacy fields (`environment`, `hosting_model`, `sso_enabled`, `mfa_supported`) are accepted but discouraged; the UI writes App Instances instead.
- PATCH `/applications/:id` → partial update of the fields above.
- DELETE `/applications/:id` → cascade deletes owners/audience/links/attachments/data_residency (App Instances must be removed first via the dedicated endpoints).

Version Management
- POST `/applications/:id/create-version`
  - Creates a new application version with lineage to the source.
  - Body: `{ name, version?, go_live_date?, end_of_support_date?, copyOwners?, copyCompanies?, copyDepartments?, copyDataResidency?, copyLinks?, copySupportContacts?, copyInstances?, interfaceIds?[] }`
  - Returns the newly created application with `predecessor_id` set to the source.
  - Copies selected relations (defaults: all except instances).
  - Migrates selected interfaces by duplicating them with updated source/target references.
  - New app starts with `lifecycle: 'proposed'`.
- GET `/applications/:id/version-lineage`
  - Returns `{ predecessors: Application[], current: Application, successors: Application[] }`.
  - Walks the predecessor chain upward; queries successors by `predecessor_id`.
- GET `/applications/:id/interfaces-for-migration`
  - Returns interfaces where this app is source or target.
  - Each row includes `app_role: 'source' | 'target' | 'both'` plus `source_app_name`, `target_app_name`.

Sub-resources
- Owners: `GET /applications/:id/owners`, `POST /applications/:id/owners/bulk-replace`
- Audience: `GET /applications/:id/companies`, `POST /applications/:id/companies/bulk-replace`, equivalent endpoints for departments
- Links/Attachments: CRUD endpoints under `/applications/:id/(links|attachments)` plus download/delete helpers
- Compliance: `GET`/`POST bulk-replace` for `/applications/:id/data-residency`
- Suites: `GET /applications/:id/suites`, `POST /applications/:id/suites/bulk-replace`, `GET /applications/:id/components`
- Helper: `GET /applications/:id/total-users?year=YYYY`

### Application classification and continuity (V1)
- `GET /applications/classification-summary` (same query parameters as the list: `q`, `filters`, `ownerUserId`, `ownerTeamId`, `include_inactive`; `applications:reader`, participant scope applied) → `{ total, reviewed, stale, incomplete }`, one aggregate over exactly the list's filters.
- `GET /applications/:id/recovery-dependencies` (`applications:reader`; refused to Business Contributors with a restricted scope, like interface routes) → `{ items: [{ interface_id (UUID), interface_reference, interface_name, direction ('source' | 'target' = role of the requested application), application_id, application_ref, application_name, recovery_wave }] }`: interfaces (not retired nor deprecated) to applications restored in a later wave.
- `GET /applications/classification-catalog` → tenant catalog: `businessCriticalityLevels` (with an optional `maxMtdMinutes` documenting each level), `cyberCriticalityLevels`, `dataClasses`, `recoveryWaves`; requires `applications:reader`. Levels are returned from most to least severe and waves in restoration order; `rank`/`order` are assigned by the server from that order on every settings write. Deprecated options are included for historical reads and cannot be newly assigned.
- Application responses include nullable `criticality` (a chosen level code), `cyber_criticality`, `recovery_wave`, `rto_minutes`, `rpo_minutes`, `classification_justification`, `classification_revision`, and derived review fields (`classification_review_state` = `incomplete | stale | reviewed`, `classification_review_reason` = `missing_fields | never_reviewed | data_changed`, `classification_reviewed_at`, `classification_reviewer_name`). The application detail adds `classification_reviewer_name` from a tenant-scoped name lookup; the stored review identifies the reviewing user.
- `PATCH /applications/:id` accepts `criticality`, `cyber_criticality`, `data_class` and `recovery_wave` as a tenant code or an unambiguous label, plus `rto_minutes`/`rpo_minutes` (free integer minutes, RPO accepts zero) and `classification_justification`; null means not set. Changing the catalog in settings never rewrites an application's level.
- `POST /applications/:id/classification-review` → `{ expected_revision }`; rejects a stale revision and marks the current classification reviewed only when business criticality, cyber criticality, data confidentiality, recovery wave and justification are present. The server supplies actor, date and revision. A later change of a classification field, recovery reference or data residency makes the review `stale` (`data_changed`); catalog edits do not.
- CSV classification cells preserve existing values when blank in both modes; the literal `__CLEAR__` clears a value. Catalog-backed columns are exported as names and imported as a code or an unambiguous name (an input matching several values is refused). Applications, assets and incidents share this rule.

### IT Ops classification settings
- `GET /it-ops/settings` includes the classification catalog for settings readers, sorted for display (levels most-severe-first, waves in restoration order).
- `PATCH /it-ops/settings` accepts every catalog list. For the classification lists the array order is the contract: the server assigns `rank`/`order` from the position and ignores incoming values; `maxMtdMinutes` is a positive integer or null and at least one level must stay active.
- Codes: a row sent without `code` is a **new entry** whose code is generated from its name (accents stripped, lowercase, `_` between words, `_2`/`_3` on collision, `value_n` when the name has no usable ASCII); renaming requires sending the existing code. Within a list, every alias (code or name, trimmed, case-insensitive) designates one entry; identical aliases on the same entry are allowed. Names of `accessMethods` cannot contain `,` or `;`. These rules apply to the lists a PATCH carries; reads stay tolerant of older data.
- `GET /it-ops/settings/usage?list=<key>&code=<code>` (or `list=subnets&location_id=…&cidr=…`), `settings:reader` → `{ total, usage: [{ record, count, listPath? }] }`: distinct records referencing the value per record type, with a deep link to the filtered list when the page supports it. A PATCH removing a value with `total > 0` is refused with the same `usage` payload (`400`, `{ list, code, label, usage }`); mark it `deprecated` instead.
- `GET /it-ops/settings` also returns `lockedCodes` (server-managed rows) and `protectedCodes` (defaults re-added after removal) per list.
- Every catalog row accepts `translations`: `{ fr?: { label?, description? }, de?: …, es?: …, en?: … }`. Empty fields and unknown locales are dropped. Translated names are aliases for resolution (CSV, API, Plaid) and count in the alias rule; the export keeps writing base names. Display resolves field by field: tenant translation, then the shipped translation for an untouched default, then base text.
- Saving the catalog never rewrites an application's level or review. Interfaces and connections use business ranks for operational criticality; incomplete derivations are flagged and null values are not treated as low.

Notes
- Attachments are stored in S3-compatible storage; tenant purge deletes DB rows and blobs.
- Filters include `is_suite`, derived counts, and all base fields.

### App Instances
- Endpoints:
  - `GET /applications/:applicationId/instances`
  - `POST /applications/:applicationId/instances` → `{ environment, lifecycle?, base_url?, region?, zone?, notes?, sso_enabled?, mfa_supported?, status?, disabled_at? }`
  - `PATCH /app-instances/:instanceId`
  - `DELETE /app-instances/:instanceId` (fails with 400 if bindings or server assignments exist)
- Rules:
  - Environments are unique per application.
  - Status resolves from `status` + `disabled_at` using shared lifecycle helper.
  - Deleting instances with bindings/assignments returns a descriptive error.

### Interfaces & Interface Bindings
- Interfaces (`/interfaces`)
  - `GET /interfaces?page&limit&sort&q&filters` supports filters for `interface_id`, `name`, source/target app names, `lifecycle`, `criticality`, `data_category`, `data_class`, `integration_route_type`, `business_process_id`, `contains_pii`, and optionally `environment` (via EXISTS on `interface_bindings.environment`, using a contains-style match so `qa` matches `QA`). Results include `bindings_count`, `environment_coverage`, and `binding_environments: string[]` (env codes with at least one binding).
  - `POST /interfaces` → `{ interface_id, name, business_purpose, business_process_id?, source_application_id, target_application_id, data_category, integration_route_type('direct'|'via_middleware'), lifecycle?, overview_notes?, criticality?, impact_of_failure?, business_objects?, main_use_cases?, functional_rules?, core_transformations_summary?, error_handling_summary?, data_class, contains_pii?, pii_description?, typical_data?, audit_logging?, security_controls_summary?, middleware_application_ids?: string[] }`
  - `PATCH /interfaces/:id` → accepts the same fields as `POST /interfaces` (all optional) and updates the interface; changing `integration_route_type` recreates legs (bindings cascade).
  - `DELETE /interfaces/:id`
  - `GET /interfaces/:id?include=relations,legs` → detail plus related owners/companies/dependencies/key identifiers/data residency/links/attachments and leg templates when requested.
  - `GET /interfaces/:id/legs` → `{ items: InterfaceLeg[] }` for the given interface.
  - `PATCH /interfaces/:id/legs` → `{ items: InterfaceLeg[] }` updates leg template fields for the given interface. Body: `{ items: Array<{ id: string; trigger_type?: string; integration_pattern?: string; data_format?: string; job_name?: string | null }> }`. Enum fields are validated against IT Ops settings.
- Interface Bindings (`/interfaces/:id/bindings`)
  - `GET /interfaces/:id/bindings` → list of bindings joined with leg metadata and source/target app instances.
  - `POST /interfaces/:id/bindings` → `{ interface_leg_id, source_instance_id, target_instance_id, source_endpoint?, target_endpoint?, trigger_details?, env_job_name?, authentication_mode?, monitoring_url?, env_notes?, status?, integration_tool_application_id? }`
  - `PATCH /interface-bindings/:bindingId`, `DELETE /interface-bindings/:bindingId`
  - Connection links (binding-centric):
    - `GET /interface-bindings/:bindingId/connection-links`
    - `POST /interface-bindings/:bindingId/connection-links` → `{ connection_id, notes? }` (idempotent on existing link)
    - `DELETE /interface-bindings/:bindingId/connection-links/:linkId`
  - Connection links (interface-centric, summary for maps/navigation):
    - `GET /interfaces/:id/connection-links?environment=prod` → `{ items: Array<{ id, binding_id, environment, leg_type, binding_status, connection: { id, connection_id, name, topology, lifecycle, criticality, data_class, contains_pii, risk_mode } }> }`
    - Used by the Interface Map side panel to show infra connections backing a selected interface and to drive “View in Connection Map” deep-links.
  - Service enforces:
    - The target interface exists and the leg belongs to that interface.
    - Source/target instances share the same `environment`.
    - Instances’ `application_id` values match the leg roles (source/target/middleware) and the interface’s configured applications.
    - At most one binding per `(interface_leg_id, environment)` (per tenant).

### Connections
- Connections (`/connections`)
  - `GET /connections?page&limit&sort&q&filters` → filters on `connection_id`, `name`, `topology`, `lifecycle`, `criticality`, `data_class`, `contains_pii`; returns source/destination labels, protocols, multi-server counts, and risk fields. Risk fields include both stored values (`criticality`, `data_class`, `contains_pii`, `risk_mode`) and aggregated values (`effective_criticality`, `effective_data_class`, `effective_contains_pii`, `derived_interface_count`).
  - `GET /connections/by-server/:serverId` → all connections where the server appears as source, destination, or in `connection_servers`; returns the same list shape as `GET /connections` (protocol labels, source/destination labels, multi-server count, risk fields). No paging (single-server scope).
  - `GET /connections/:id` → detail including protocol codes, risk fields, aggregated effective risk (`effective_*`, `derived_interface_count`), (for multi-server) the connected servers list, and optional `legs` when `include=legs` is provided.
  - `GET /connections/:id/legs` → ordered list (max 3) of legs for the connection.
  - `GET /connections/:id/interface-links` → linked interface bindings (interface, environment, leg, endpoints, lifecycle/status) for the connection.
  - `POST /connections`
    - Body: `{ connection_id, name, purpose?, topology: 'server_to_server'|'multi_server', source_server_id?, source_entity_code?, destination_server_id?, destination_entity_code?, servers?: string[], protocol_codes: string[], lifecycle?, notes?, criticality?, data_class?, contains_pii?, risk_mode?('manual'|'derived') }`
    - Validation: at least one protocol; lifecycle from IT Ops lifecycle list (default `active`); `server_to_server` requires exactly one participant per side (server XOR entity); `multi_server` requires ≥2 servers. Risk fields validated against IT Ops settings; `risk_mode` accepts `manual|derived` but `derived` is rejected on create (connections start in manual mode until interfaces are linked).
    - Protocol codes must exist in IT Ops **Connection Types** (also surface typical ports in UI).
  - `PATCH /connections/:id` → same shape as POST (all optional); protocols/servers use replace semantics. Setting `risk_mode = 'derived'` is allowed only when at least one `interface_connection_link` exists for the connection.
  - `PUT /connections/:id/legs` → replace legs (array of up to 3) with `order_index 1..3`, `layer_type`, one source + one destination (server or entity per side), `protocol_codes[]` (from Connection Types), optional `port_override`, `notes`.
  - `DELETE /connections/:id`
  - `DELETE /connections/bulk` (admin only) with body `{ ids: string[] }`
  - `GET /connections/map?environment=prod&lifecycles=active` → returns `{ environment, lifecycles, nodes: [{ id, name, kind:'server'|'cluster'|'entity', is_cluster?, environment?, hosting_category?, graph_tier?, member_server_ids? }], connections: [{ id, connection_id, name, topology, lifecycle, criticality, data_class, contains_pii, protocol_codes, protocol_labels, source_server_id, source_entity_code, destination_server_id, destination_entity_code, server_ids: string[], legs?: [{ id, order_index, layer_type, source_server_id, source_entity_code, destination_server_id, destination_entity_code, protocol_codes, protocol_labels, port_override, notes }] }], clusterMemberships: [{ cluster_id, server_id }] }`. `criticality`, `data_class`, and `contains_pii` on the map payload reflect effective (aggregated) risk where `risk_mode = 'derived'`. When legs exist, clients render one edge per leg; otherwise they use the S2S/mesh fallback. Nodes are limited to participants; multi-server edges are expanded client-side when the toggle is enabled. Tier semantics: servers/clusters use environment-scoped app role assignments (highest user-facing priority wins for multi-role assets), entities use IT Ops `entities.graph_tier`; fallback is `center` for unassigned servers/clusters and `top` for entities.
- RBAC: uses `applications` resource (`reader` list/detail; `manager` create/update/delete; `admin` bulk delete).

### Assets & App Server Assignments
- Assets (`/servers` — endpoint name preserved for backward compatibility)
- Tenant scope: all assets endpoints require tenant context and explicitly filter by `tenant_id` (defense-in-depth in case RLS is bypassed in dev).
- `GET /servers?page&limit&sort&q&filters` supports environment/kind/provider/status/cluster/is_cluster filters and returns `assignments_count` and cluster membership context (cluster name for member servers). Search (`q`) matches name, hostname, fqdn, and aliases.
- `POST /servers` → `{ name, kind, provider, environment, region?, zone?, hostname?, ip_addresses?, is_cluster?, status?, operating_system?, location_id?, domain?, aliases?: string[] }`
- `PATCH /servers/:id` → same fields; `fqdn` is computed server-side from `hostname` + domain's `dns_suffix`
- IP addresses structure:
  - `ip_addresses`: Array of `{ type, ip, subnet_cidr }` entries, or `null`
  - `type`: IP address type code from IT Ops Settings `ipAddressTypes` (e.g., `host`, `ipmi`, `management`, `iscsi`)
  - `ip`: The IP address string (validated to belong to the subnet if `subnet_cidr` is set)
  - `subnet_cidr`: Optional subnet CIDR from IT Ops Settings subnets list; network zone and VLAN are derived from subnet at display time
- Identity fields (Technical tab):
  - `hostname`: Asset hostname; required when `domain` is set to a non-system domain
  - `domain`: Domain code from IT Ops Settings domains list (e.g., `corp-ad`, `workgroup`, `n-a`)
  - `fqdn`: Read-only, computed as `{hostname}.{dns_suffix}` or just `hostname` if dns_suffix is empty
  - `aliases`: Array of additional DNS names/aliases; stored as `text[]`
- Cluster membership
  - `GET /servers/:id/members` (cluster only) → list of member servers.
  - `POST /servers/:id/members` body `{ server_ids: string[] }` replaces membership; members must be non-cluster servers.
  - `GET /servers/:id/clusters` (host only) → clusters that include the server.
  - `GET /servers/:id`, `PATCH /servers/:id`
- Delete
  - `DELETE /servers/:id` (admin) — blocked with `409 Conflict` if the server has any app assignments or is referenced by any connection (including multi-server and leg participants); the message lists sample related items.
  - `DELETE /servers/bulk` (admin) body `{ ids: string[] }` → `{ deleted: string[], failed: [{ id, name, reason }] }` with the same conflict rules.
- App Server Assignments
  - `GET /app-instances/:instanceId/servers` → assignments for a given app instance (with joined server metadata)
  - `POST /app-instances/:instanceId/servers` → `{ server_id, role, since_date?, notes? }` (unique per `(instance, server, role)`)
  - `DELETE /app-instances/:instanceId/servers/:assignmentId`
  - `GET /servers/:serverId/assignments` → view assignments from the server perspective
  - `POST /app-server-assignments/servers-by-apps` → `{ applicationIds: string[], environments: string[] }`
    - Returns unique servers assigned to app instances for the given applications and environments.
    - Response: `{ items: [{ id, name, environment, kind, provider, is_cluster }] }`
    - Used by Connection Map for app-based server selection.
  - Instance-facing list responses expose a `hosting` object derived from the assigned server's location (or the default cloud hosting type) for read-only display.

RBAC: All of the above share the `applications` resource.

### Department Metrics (per year)
- GET `/department-metrics/:departmentId?year=YYYY` → `{ headcount, ... } | null`
- PATCH `/department-metrics/:departmentId?year=YYYY`
  - Body: `{ headcount: int }`
  - Validation errors: headcount must be non‑negative integer
  - Freeze: edits are rejected when the departments scope is frozen for that year

## IT Ops Settings
Tenant-scoped configuration for IT Landscape dropdowns and enums.

- GET `/it-ops/settings`
  - Guards: `JwtAuthGuard`, `PermissionGuard`, `@RequireLevel('settings', 'reader')`
  - Returns merged settings with defaults: `{ dataClasses, networkSegments, entities, serverKinds, serverProviders, serverRoles, hostingTypes, lifecycleStates, interfaceProtocols, interfaceDataCategories, interfaceTriggerTypes, interfacePatterns, interfaceFormats, interfaceAuthModes, operatingSystems, connectionTypes, subnets, domains, ipAddressTypes, accessMethods }`
  - `entities[]` and `serverRoles[]` include optional `graph_tier` (`top|upper|center|lower|bottom`) used by Connection Map role-based placement.

- PATCH `/it-ops/settings`
  - Guards: `JwtAuthGuard`, `PermissionGuard`, `@RequireLevel('settings', 'admin')`
  - Body: partial update of any settings list
  - Example body:
    ```json
    {
      "networkSegments": [{ "code": "lan", "label": "LAN" }],
      "entities": [{ "code": "internet", "label": "Internet", "graph_tier": "top" }],
      "serverRoles": [{ "code": "db", "label": "Database server", "graph_tier": "bottom" }],
      "subnets": [{ "location_id": "uuid", "cidr": "192.168.1.0/24", "vlan_number": 100, "network_zone": "lan", "description": "Office network" }],
      "domains": [{ "code": "corp-ad", "label": "Corporate AD", "dns_suffix": "corp.example.com" }]
    }
    ```
  - `graph_tier` values outside `top|upper|center|lower|bottom` are normalized to the default tier for that code (or `center` if unknown).
  - Subnets validation:
    - `location_id`: required, must reference valid location
    - `cidr`: required, valid IPv4 CIDR (e.g., `192.168.1.0/24`)
    - `vlan_number`: optional, 1-4094, unique per location
    - `network_zone`: required, must exist in `networkSegments`
    - CIDR uniqueness enforced per location
  - Domains validation:
    - `code`: required, auto-generated from label if not provided
    - `label`: required, display name
    - `dns_suffix`: DNS suffix for FQDN computation (can be empty for Workgroup/N/A)
    - System entries (`workgroup`, `n-a`) cannot be modified or deleted

- POST `/it-ops/settings/reset`
  - Guards: `JwtAuthGuard`, `PermissionGuard`, `@RequireLevel('settings', 'admin')`
  - Resets all settings to defaults

## Analytics Dimensions and Values (Master Data)

A tenant classifies its budget lines along analytics dimensions (`analytics_axes`, "dimensions" in the UI); each dimension holds values (`analytics_categories`). A line holds at most one value per dimension (`spend_item_analytics_values`, `capex_item_analytics_values`). Resource key: `analytics` for every route below.

- **Default dimension.** Every tenant has exactly one dimension with `is_default = true` (created by migration `1853660000000` for existing tenants, by the tenant bootstrap for new ones, and on the first write that needs it for a tenant inserted any other way). The legacy item field `analytics_category_id` and the AI key `analytics_category` address it through `is_default`, never through its position, code or name: renaming or reordering dimensions changes nothing for them (the budget file addresses every dimension, the default one included, through its own `analytics:<code>` column). Its `name` may be `null` (screens then show the translated "Analytics dimension"). It cannot be disabled or deleted, and no API writes `is_default`.
- **Values** belong to one dimension, set on create and never changed. Names are unique per dimension (case-insensitive), so two dimensions can each hold "Other".
- **RLS**: all four tables are tenant-scoped (`tenant_id = app_current_tenant()`, forced). A value references its dimension by `(tenant_id, axis_id)` and a line's value references `(tenant_id, category_id, axis_id)`, so a line can only hold a value of its own tenant that belongs to the named dimension, raw SQL included.

### Dimensions

- GET `/analytics-axes` → `{ items }`: every dimension, disabled included, ordered by `sort_order`, then name, then code. Item: `{ id, tenant_id, code, name, description, sort_order, is_default, status, disabled_at, created_at, updated_at }` (`status` is the effective one: disabled once `disabled_at` has passed).
  - Access: `reader` on any of `analytics`, `opex`, `capex`, `reporting` (item forms, lists and reports need the dimensions).
- GET `/analytics-axes/:id` → the dimension plus `value_count`, `opex_count`, `capex_count` (lines holding one of its values). `analytics:reader`.
- POST `/analytics-axes` `{ code, name, description?, sort_order?, status?, disabled_at? }` → as GET `/:id`. `analytics:member`.
  - `code`: 1 to 40 characters, lowercase letters, digits, `_` and `-`, starting with a letter or a digit ("Use lowercase letters, digits, - or _ (40 at most)."); unique per tenant (`400` "A dimension with code {code} already exists."). The code names the CSV column (`analytics:<code>`) and the AI key; it can be changed (lines store ids).
  - `name`: required, trimmed, 200 characters at most, unique per tenant (`400` "A dimension named {name} already exists."). The labels an unnamed default shows ("Analytics dimension", "Dimension analytique", "Analysedimension", "Dimensión analítica", any case) are refused for any other dimension (`400` "This name is reserved for the default dimension.").
  - `sort_order`: optional whole number; when omitted the new dimension goes last.
- PATCH `/analytics-axes/:id` (any subset of the create fields; `is_default` is ignored) → as GET `/:id`. `analytics:member`.
  - On the default dimension, `name` may be cleared (`null` or blank, stored `null`); a lifecycle change is refused (`400` "This dimension cannot be disabled: older files and AI questions use it.").
  - An unchanged body writes nothing (no audit row).
- DELETE `/analytics-axes/:id`. `analytics:admin`. `409` for the default dimension ("This dimension cannot be deleted: older files and AI questions use it.") and while the dimension has values ("Nature still has 3 values. Delete them first.").

### Values

- GET `/analytics-categories?axis_id=&page=&limit=&sort=name:ASC&q=&filters=&status=&includeDisabled=` → `{ items, total, page, limit }`; items `{ id, tenant_id, axis_id, name, description, status, disabled_at, created_at, updated_at }`.
  - `axis_id` restricts to one dimension. Default scope: enabled values; `status=enabled|disabled` or a `status` set filter picks one, `includeDisabled=1|true` lifts the default scope.
  - Sort: `name`, `description`, `status`, `disabled_at`, `created_at`, `updated_at`. Filters (grid model, set or text): `name`, `description`, `axis_code`, `axis_name` (the dimension's name, "Analytics dimension" for an unnamed default). Quick search on name and description.
  - Access: `reader` on any of `analytics`, `opex`, `capex`, `reporting`.
- GET `/analytics-categories/ids` (same query) → `{ ids, total }` (at most 10,000 ids). Same access.
- GET `/analytics-categories/:id` → the value plus `axis_name`, `axis_code`, `axis_is_default`, `opex_count`, `capex_count`. Same access.
- POST `/analytics-categories` `{ axis_id?, name, description?, status?, disabled_at? }` → as GET `/:id`. `analytics:member`.
  - Without `axis_id` the value goes into the default dimension. The dimension is resolved in the tenant (`400` "Dimension not found.") and must be enabled ("The Nature dimension is disabled. Enable it to add values.").
  - Name unique within the dimension (`400` "A value named {name} already exists in {dimension}.", where an unnamed default reads "the analytics dimension").
- PATCH `/analytics-categories/:id` (`name`, `description`, `status`, `disabled_at`) → as GET `/:id`. `analytics:member`. `axis_id` is accepted only when equal to the stored one (`400` "A value cannot move to another dimension."). An unchanged body writes nothing.
- DELETE `/analytics-categories/:id`. `analytics:admin`. `409` while a line holds the value ("Licences is used by 3 OPEX lines and 1 CAPEX line. Disable it instead.").
- DELETE `/analytics-categories/bulk` `{ ids }` (at most 1,000) → `{ deleted, failed: [{ id, name, reason }] }`. `analytics:admin`. Each value is deleted under its own savepoint: a refused one leaves the others deleted.
- GET `/analytics-categories/export?scope=data|template&language=…`. `analytics:admin`. Headers `axis_code, name, description, status, disabled_at` (the separator follows the language), every value of every dimension (disabled included), in dimension order then by name.
- POST `/analytics-categories/import?dryRun=true|false&language=…&dateOrder=…&decimalMark=…` (multipart `file`). `analytics:admin` → `{ ok, dryRun, total, inserted, updated, unchanged, errors: [{ row, message }] }`, plus `notices` and `ignoredColumns` (same shared master-data contract as `/companies/import`).
  - Only `name` is required; an absent column keeps what is stored. A blank `axis_code` is the default dimension; an unknown code is a row error. In a disabled dimension a row identical to the stored value passes as `unchanged`; a new value or an edit there is a row error ("The Nature dimension is disabled. Enable it or leave it out.").
  - Rows match on (dimension, name), case-insensitively; the same pair twice in the file is a row error.
  - The whole file is validated before any write; nothing is written when a row fails. A row identical to the stored value is counted `unchanged` and writes nothing. Exporting and re-importing the same file reports every row unchanged.
- The AI master-data tools create and update values through the same service: a value created without a dimension lands in the default one, and a name used in two dimensions is the usual "several matches" error.

## Business Processes (Master Data)

- Resource key: `business_processes`
- RLS: tenant-scoped via `tenant_id = app_current_tenant()`

### Entities

- `business_processes`:
  - Fields: `{ id, tenant_id, name, description, notes, status, disabled_at, owner_user_id, it_owner_user_id, is_default, created_at, updated_at }`
  - Notes:
    - `name` includes the short code in parentheses, e.g. `Order-to-Cash (O2C)`.
    - `owner_user_id` and `it_owner_user_id` are optional FKs to `users(id)`.

- `business_process_categories`:
  - Fields: `{ id, tenant_id, name, is_default, is_active, sort_order, created_at, updated_at }`

- `business_process_category_links`:
  - Fields: `{ id, tenant_id, process_id, category_id, created_at, updated_at }`
  - Many-to-many join table between processes and categories.

### Endpoints

- GET `/business-processes`
  - Query params: `page`, `limit`, `sort`, `q`, `filters`.
  - Filters: supports AG Grid filters on `name`, `status`; `q` matches name/description/notes.
  - Returns list shape: `{ items: BusinessProcessRow[], total, page, limit }`.
  - `BusinessProcessRow` includes:
    - Entity fields plus:
      - `categories: { id, name, is_active }[]` (sorted by name).
      - `primary_category_name: string | null` (first category name used for default sorting).
      - `owner_name: string | null` (derived from `owner_user_id`).
  - Permissions: `business_processes:reader`.

- GET `/business-processes/ids`
  - Same query params/filters as list; returns `{ ids: string[], total: number }` for workspace navigation.
  - Permissions: `business_processes:reader`.

- GET `/business-processes/:id`
  - Returns a single process with the same shape as `BusinessProcessRow` plus timestamps.
  - Permissions: `business_processes:reader`.

- POST `/business-processes`
  - Body: `BusinessProcessUpsertDto`:
    - `{ name, description?, notes?, status?, disabled_at?, category_ids?: string[], owner_user_id?: string|null, it_owner_user_id?: string|null }`
  - Behavior:
    - Validates unique name (per tenant, case-insensitive).
    - Applies lifecycle using `status`/`disabled_at`.
    - Syncs category links to the provided `category_ids`.
  - Permissions: `business_processes:manager`.

- PATCH `/business-processes/:id`
  - Body: partial `BusinessProcessUpsertDto`.
  - Behavior:
    - Allows renaming (with uniqueness check).
    - Allows updating description/notes/owners/lifecycle and category links.
  - Permissions: `business_processes:manager`.

- DELETE `/business-processes/bulk`
  - Body: `{ ids: string[] }`.
  - Returns: `{ deleted: string[], failed: { id, name, reason }[] }`.
  - Behavior:
    - Uses a dedicated delete service; FKs or usage conflicts are reported per item.
  - Permissions: `business_processes:admin`.

- DELETE `/business-processes/:id`
  - Deletes a single process; mirrors bulk behavior.
  - Permissions: `business_processes:admin`.

### Categories

- GET `/business-process-categories`
  - Query params: `page`, `limit`, `sort`, `includeInactive=true|false`.
  - Default: only active categories unless `includeInactive=true`.
  - Returns: `{ items: BusinessProcessCategory[], total, page, limit }`.
  - Permissions: `business_processes:reader`.

- POST `/business-process-categories`
  - Body: `{ name: string, is_active?: boolean }`.
  - Behavior:
    - Names are unique per tenant (case-insensitive).
  - Permissions: `business_processes:manager`.

- PATCH `/business-process-categories/:id`
  - Body: `{ name?: string, is_active?: boolean, is_default?: boolean, sort_order?: number }`.
  - Permissions: `business_processes:manager`.

- DELETE `/business-process-categories/:id`
  - Fails with `400` if the category is still referenced by any `business_process_category_links`.
  - Permissions: `business_processes:admin`.

### CSV Import/Export

- GET `/business-processes/export?scope=template|data`
  - `scope=template`: header-only CSV.
  - `scope=data`: data CSV for all processes in the tenant.
  - Format (semicolon `;` separated, UTF‑8 with BOM):
    - `name;categories;description;notes;status`
    - `categories` is a semicolon-separated list of category names.
  - Permissions: `business_processes:admin`.

- POST `/business-processes/import?dryRun=true|false`
  - Multipart form-data with `file` field.
  - Dry-run:
    - Returns `{ ok, dryRun: true, total, inserted, updated, errors[] }`.
  - Actual load:
    - Returns `{ ok, dryRun: false, total, inserted, updated, processed, errors[] }`.
  - Behavior:
    - Validates headers and required fields.
    - Deduplicates identical rows.
    - Upserts by `name` per tenant and syncs category links, auto-creating categories as needed.
  - Permissions: `business_processes:admin`.

## Allocation Rules (default method per tenant/year)
- GET `/allocation-rules/active?year=YYYY` → `{ fiscal_year, mode, method, source: 'standard'|'tenant', standard_mode, standard_method, tenant_mode, tenant_method, company_ids, shares, preview_error }`
  - `mode` is the effective company set: `auto` spreads over every company enabled for the year, `manual_company` restricts it to `company_ids`
  - `method` is the effective driver (`headcount` | `it_users` | `turnover`) weighing the companies, in both modes
  - `standard_*` describes the global row (`tenant_id IS NULL`, seeded as `headcount`/`auto`); `tenant_*` is `null` when the year runs on the standard
  - `shares` is the computed split of the effective selection (empty in `auto` mode), `preview_error` explains why it cannot be computed
- PATCH `/allocation-rules/active?year=YYYY` with `{ mode?: 'auto'|'manual_company', method, company_ids?: string[] }` → upserts the calling tenant's override for that year
  - `mode` defaults to `auto` and `company_ids` is then ignored; `manual_company` requires at least one company
  - The selection is validated with the same computation the calculators run: a foreign-tenant company, a company disabled for the fiscal year (a company counts as enabled when `disabled_at` is null or on/after January 1st) or a company without a driver value is rejected with 400. A single selected company is accepted without a driver value and takes 100%
- DELETE `/allocation-rules/active?year=YYYY` → drops the tenant override, the year falls back to the standard method
  - Permissions: any authenticated member of the tenant for GET, `budget_ops:admin` for PATCH and DELETE
  - Used when a spend version or capex version has `allocation_method='default'`; `allocation_rules`, `spend_versions` and `capex_versions` share this resolution (`resolveDefault` in the allocation calculators)
  - `allocation_rules` holds global standard rows plus per-tenant rows and is RLS-scoped: a tenant sees the global rows and its own overrides only. DB CHECKs enforce that `manual_company` always carries companies and that the global row never does

## Budget Columns (tenant settings)
- GET `/budget-columns` → `BudgetColumnsSettings`
  ```json
  { "labels": { "planned": null, "committed": null, "forecast": null, "actual": null, "expected_landing": null },
    "enabled": { "planned": true, "committed": true, "forecast": false, "actual": true, "expected_landing": true },
    "group_spread": { "planned": true, "committed": true, "forecast": true, "actual": true, "expected_landing": true },
    "default_column": "planned" }
  ```
  - The five budget columns keyed by storage name, in the fixed order (column 1 to 5). `labels`: the tenant's name per column, `null` = the product name (Budget, Revision, Forecast, Actuals, Expected landing). `enabled`: shown in lists, the budget tab, report pickers and the dashboard. `group_spread`: follows "Apply to all columns" in the budget tab. `default_column`: preselected in reports, default sort of the lists and the dashboard; freezing it pins the year's FX rate set
  - A tenant that never saved gets the product defaults above (stored in `tenants.metadata.budget_columns`, no migration)
- PATCH `/budget-columns` with a partial `{ labels?, enabled?, group_spread?, default_column? }` → the full settings
  - The patch is merged onto the stored settings, then the whole is validated: names trimmed (inner whitespace collapsed, blank = `null`, at most 40 characters, no control characters) and distinct after case folding across the five resolved names; at least one column shown; the default column shown. Unknown keys, unknown columns and non-boolean flags are refused. Every refusal is a 400 with a readable message, e.g. `The default column must be shown: choose another default column first.`
  - The write locks the tenant row and replaces only the `budget_columns` key; audited on `tenants` when the settings change
  - Hidden columns keep their amounts: the summary API, CSV files, budget file imports, freezes and AI keys still carry every column
  - Permissions: any authenticated member of the tenant for GET, `budget_ops:admin` for PATCH

## Spend Items & Versions (OPEX)
- `:id` on every route under `/spend-items/:id` (GET, PATCH, DELETE, and the share, yearly-totals, versions, tasks, contracts, projects, applications, links, attachments and contacts routes) is a UUID or an `OPX-n` reference, as every route under `/capex-items/:id` takes `CPX-n`; a malformed id is a `400` "Invalid item reference: …", an unknown reference a `404`
- POST `/spend-items` → create item
- PATCH `/spend-items/:id` → update item (any subset of the writable fields)
- GET `/spend-items/:id` → detail (every item column, `cost_center_id` and `run_build` included) plus the analytics values:
  - `analytics_values: [{ axis_id, axis_code, axis_name, is_default, category_id, category_name }]`: every dimension the line holds a value on (disabled dimensions included), in dimension order; `axis_name` is `null` on the default dimension while it has no name
  - `analytics_category_id`, `analytics_category_name`: the default dimension's value, `null` when the line has none. They are read from the line's analytics values; the item column of the same name is no longer read or written (it stays in the database for one release)
  - The create and update responses carry the same fields
  - The GET detail (OPEX and CAPEX) adds `references: { supplier, paying_company, account, owner_it, owner_business, cost_center }`: the labels the workspace pickers show, in the shapes of the reference lookups (below), each `null` when the line has none (`cost_center`: `{ id, code, name, kind, status, company_id, company_name, owner_user_id, owner_name }`, the effective status, the company and the budget holder). One statement, so the workspace never loads a picker's list, the cost center tree or a user record to show the chosen value
- GET `/spend-items/:id/relation-counts` (same on `/capex-items/:id/relation-counts`) → `{ contracts, applications, projects, links, attachments, total }`: the counts of the Relations tab, in one statement (the tab badge shows `total`)
- GET `/spend-items/:id/meta` (same on `/capex-items/:id/meta`, the detail's read level) → `{ id, row_version, changed_by: { id, name } | null, changed_at, versions: [{ id, budget_year, budget_rev, changed_by, changed_at }] }` (versions in year order): what the workspace polls every 30 seconds to see that someone else changed the line or its budget (lot 3G). `changed_by` / `changed_at` of the line: the audit row that wrote the current `row_version` (among the line's 50 newest), null when no audit row explains it; of a version: when its `budget_rev` last moved, and the first audit row about it written since (null when nothing logged the change). `changed_by.name`: first and last name, null for a user without one (never the e-mail). One statement, bounded whatever the line's history; `404` when the line is not in the tenant
- GET `/spend-items` and GET `/capex-items` (the plain lists the pickers use) carry the item columns plus `analytics_category_id` and `analytics_category_name` of the default dimension, read the same way
- Writable fields and write rules (OPEX and CAPEX alike, `spend/item-write.util.ts`; the UI, the API, the AI and the budget files all go through them):
  - OPEX: `product_name, description, supplier_id, paying_company_id, account_id, currency, effective_start, owner_it_id, owner_business_id, analytics_values, analytics_category_id, project_id, contract_id, cost_center_id, run_build, notes`, plus the lifecycle inputs `status`, `disabled_at` and the deprecated `effective_end`
  - CAPEX: `description, ppe_type, investment_type, priority, supplier_id, paying_company_id` (legacy alias `company_id`)`, account_id, currency, effective_start, owner_it_id, owner_business_id, analytics_values, analytics_category_id, project_id, cost_center_id, run_build, notes`, plus the same lifecycle inputs
  - Any other key (`id`, `tenant_id`, `item_number`, timestamps, unknown keys) is dropped, never refused
  - Every id is resolved in the current tenant; an unknown id, or an id of another tenant, is a `400` "<Field> not found." (`Paying company`, `Account`, `Supplier`, `Analytics category`, `IT owner`, `Business owner`, `Project`, `Contract`, `Cost center`)
  - `analytics_values: { [axis_id]: category_id | null }` (`spend/item-analytics.util.ts`): each named dimension takes the value, `null` clears it, an omitted dimension is untouched. The dimension must be one of the tenant's ("Analytics dimension not found.") and enabled ("The Nature dimension is disabled. Enable it or leave it out."); on a disabled dimension the line's unchanged value, or `null` where the line has none, passes as a no-op, and only a real change is refused. The value must be one of the tenant's ("Analytics value not found.") and belong to that dimension ("Hardware is not a value of the Nature dimension."; "… of the analytics dimension." for the default dimension while it has no name); a disabled value is refused as a new assignment ("This value is disabled.") and kept as the line's current one. The value is read `FOR KEY SHARE`: a value deleted meanwhile makes the save wait, then answer "Analytics value not found."
  - `analytics_category_id` (legacy) is the default dimension's value (`null` clears it); sent with a different value for the default dimension in `analytics_values`: `400` "Send the analytics category once: analytics_category_id and analytics_values disagree."
  - The values are written after the line, in the same transaction; a change of analytics values alone is an edit (`updated_at`, audit). Audit snapshots carry `analytics_values` as `{ [axis_id]: category_id }` and `analytics_category_id`
  - `cost_center_id`: a new value must name an enabled cost center, not a group (`400` "Choose a cost center, not a group." / "This cost center is disabled."); the line's current value is always kept, disabled or not
  - `run_build`: `run`, `build` or `null` (case-insensitive); anything else is a `400`
  - A line with a cost center and no paying company takes the cost center's company (this satisfies "paying company required" on create); an explicit different company is kept. Without either: `400` "Paying company is required."
  - The chart of accounts check (the account must belong to the paying company's chart) runs on create, and on update when the resulting company or account differs from the stored one; a line already mismatched still takes unrelated edits
- **Budget file** (`/spend-items/budget-file/*` and `/capex-items/budget-file/*`): one file per list, detailed under [Budget files](#budget-files-opex-and-capex). The old `GET /spend-items/export`, `POST /spend-items/import` and their CAPEX twins are gone.
- POST `/spend-items/:id/versions` with `{ version_name, as_of_date, input_grain, budget_year?, allocation_method?, allocation_driver? }`
  - `budget_year` defaults to `as_of_date` year; one version per (item, year)
  - `allocation_method` defaults to `default`; `allocation_driver` defaults to `headcount`
- PATCH `/spend-items/:id/versions` with `{ id, ...updates }`
  - `budget_year` immutable; `allocation_method` can change

## Amounts (OPEX)
- POST `/spend-versions/:id/amounts/bulk-upsert` (`opex:member`) → `{ updated, round_inputs: RoundInput[], items, budget_rev }` (a lines payload adds `warnings`; `items`: the year's months as stored after the write; `budget_rev`: the version's counter after it, lot 3G); `year` must be the version's year, each column written is checked against the freeze in the request transaction
  - `annual`, `quarterly` and `monthly` payloads as before (see README; `period_start` / `period_end` both or neither)
  - `updated` is the number of months written; a write that leaves every month as stored (the same spread or lines sent again) writes none, answers `updated: 0` and adds no amounts audit row, while a changed period or method is still saved on the column's record
  - Lines payload (a column computed from quantity × price lines): `{ kind: 'lines', year, measure, also_measures?: AmountMeasure[], lines: Line[] }` with `Line = { label, quantity_unit: 'people'|'days'|'pieces', quantity, unit_price, price_basis: 'per_day'|'per_month'|'per_piece', frequency: 'per_month'|'once', days_per_month: string | number | null, period_start, period_end, working_day_profile_id: string | null }` → `{ updated, round_inputs, warnings: string[] }`
    - `measure`: any of the five columns, including one hidden by the settings; `also_measures`: the same lines written to these columns too, in the same request (a frozen one refuses the whole write, as any freeze); `lines`: 0 to 50
    - Each line: `label` trimmed, may be blank, at most 200 characters; `quantity` at most 3 decimals, from 0 to below 10^9; `unit_price` at most 4 decimals, below 10^14 either way (credits allowed); numbers or decimal strings, read exactly; the unit decides the price basis and how often: people per day or per month, counted per month; days per day, counted once over their period (a bundle); pieces per piece, per month or once (`frequency` may be left out for people and days, which have one choice; pieces must send it); `days_per_month` only on people priced per day: `null` (or left out) is full time, a number is the days worked each month, above 0, at most 31, at most 3 decimals; `period_start` and `period_end` (`YYYY-MM-DD`) inside `year`, start before end, covering at least one month's 15th, except a line counted once on one date (`period_start` = `period_end`, the pieces' date), which counts that date's month; `working_day_profile_id` required for a price per day (people per day and days), refused otherwise, resolved in the current tenant; a disabled calendar is refused unless the stored lines of every column written already use it (then `warnings: ["This calendar is disabled. The computation still uses it."]`)
    - Refusals are `400` sentences naming the line: "Line 2: choose a calendar for a price per day.", "Line 2: quantity accepts at most 3 decimals.", "Line 2: a price for days is per day.", "Line 2: a price for pieces is per piece.", "Line 2: a price for people is per day or per month.", "Line 2: choose how often: per month or once.", "Line 2: people are counted per month.", "Line 2: a price per month applies per month.", "Line 2: days are counted once over their period.", "Line 2: enter the days per month, or tick Full time.", "Line 2: days per month must be more than 0 and at most 31.", "Line 2: days per month accepts at most 3 decimals.", "Line 2: days per month apply to people priced per day.", "Line 2: unknown unit 'weeks'. Use days, people or pieces.", "Line 2: the calendar was not found.", "Line 2: France 218 is disabled. Pick an enabled calendar.", "Line 2: France 218 has no working days for 2027. Add them on the Working-day calendars page.", "Line 2: the computed amount is too large."; for the request: "Send the lines as a list.", "A column holds at most 50 lines.", "The computed amount is too large.", "The lines add up to too many FTE.". Nothing is written on a refusal
    - Months of a line (its active months; the others are zero): people per day, full time = the calendar's days of the month × quantity × unit price, rounded half away from zero to cents per month; people per day, N days per month = N × quantity × unit price per month; people per month and pieces per month = quantity × unit price per month; days and pieces once = quantity × unit price rounded once, split equally over the months, the remainder on the last (one date: all of it in that month). FTE of a month: people full time or per month = the quantity; people N days per month = quantity × N ÷ the calendar's working days of that month; days = the days bought split like the price (6 decimals, the remainder on the last month) ÷ the calendar's working days of that month; both 6 decimals, 0 when the calendar has none that month; pieces = 0
    - A column = the sum of its lines. Its `fte` (stored, the lists) = the twelve months' FTE summed ÷ 12, the full-year average; its `fte_period` (in `last_calculation` only) = the FTE of the months where at least one people or days line is active summed ÷ their number (pieces lines do not widen it; 0 without such a month). Both rounded half away from zero to 2 decimals; each line has the same two figures over its own months
    - Replaces the twelve months of each column written (the other columns keep theirs) and each column's lines, wholesale in the order sent, then stores its round: `period_start` = the earliest line start, `period_end` = the latest line end, `method: 'computed'`, `spread_profile_name: null`, `fte`, `last_calculation` of kind `computed`. The same lines sent again write no record
    - `lines: []` removes the lines: no month is written, `fte` becomes `null`, a `computed` column becomes `manual` (its explanation cleared), any other method stays; a column without a record is left alone
- GET `/spend-versions/:id/amounts?year=` (`opex:reader`) → `{ items, totals, year, round_inputs: RoundInput[] }`
- `RoundInput`: `{ measure, period_start, period_end, method: 'spread'|'copied'|'manual'|'computed', spread_profile_name, last_calculation, fte: string | null, lines: RoundLine[], updated_at, updated_by }`; `RoundLine` = `{ id, sort, label, quantity_unit, quantity, unit_price, price_basis, frequency, days_per_month: string | null, period_start, period_end, working_day_profile_id, working_day_profile_code, working_day_profile_name }` in `sort` order (from 1), decimals as plain strings without trailing zeros; `lines: []` and `fte: null` on a column without lines
  - The lines are set by a lines payload, deleted with the record by Clear, and kept by a hand edit (the column becomes `manual`), a spread and a budget file: they stay as the reference the budget tab shows, `fte` with them. A copy replaces the destination's lines with the source's (how often and days per month included), each period shifted to the destination year (29 February becomes 28 February). Lines that are only a reference go through the same planning as the lines of a column that follows them, with the uplift on the months only (unit prices unchanged): each line is cut to the item's validity and dropped when no month is left; a per-day calendar with no working days for the destination year is replaced by the paying company's standard calendar (a `fallback` calendar note, to accept like the others); the destination `fte` is computed from the copied lines on the destination year's calendars (no lines left: `fte` null). Without a replacement calendar (a `missing` calendar note, to accept too) the lines are copied as they are, shifted, with the source's `fte`. A source without lines leaves none and `fte` null
  - `last_calculation` of kind `computed`: `{ kind, total, fte, fte_period, month_amounts: string[12], fte_months: string[12], active_months, lines: [{ label, quantity_unit, quantity, unit_price, price_basis, frequency, days_per_month, period_start, period_end, working_day_profile_id, working_day_profile_code, working_day_profile_name, active_months, day_counts: string[12] | null, total_days: string | null, month_amounts: string[12], fte_months: string[12], fte, fte_period, total }] }`: what each line used and gave (`day_counts` = the calendar's days of the year, `total_days` = those of the line's months, per day only), so editing the calendar later never changes it. `copy.source_method` may be `computed`
  - `lines_result` (optional) on `last_calculation` of kind `annual`, `quarterly` or `copy`: what the column's lines give while the column no longer follows them, so the monthly FTE and each line's result outlive a spread, a budget file yearly total or a copy of reference lines. Same content as the `computed` calculation without `kind`: `{ total, fte, fte_period, month_amounts, fte_months, active_months, lines: [...] }`. Present only on a record with lines (`fte` not null); records stored before it have none (a migration filled the columns already in that state, computed with the calendars as they were then). A spread or a budget file load carries over the result of the stored lines (their `computed` calculation, or the `lines_result` of the previous one); a copy of reference lines writes the result it computed for the destination year. Removing the lines (`lines: []`) drops it. Read-only, the app does not display it

## Allocations (OPEX)
- GET `/spend-versions/:id/allocations` → `{ items: AllocationRow[], total_pct, resolved_method, method, driver, base_signature, budget_rev, totals }` (`budget_rev`: the version's counter, read with the signature; `totals`: the year's five column totals, read after it; the PUT of the same path answers the same after its write)
  - `AllocationRow`: `{ id|null, company_id, department_id|null, allocation_pct, source: 'manual'|'auto' }`
  - Percentages are recomputed on the fly from the active allocation method and latest company metrics. Manual rows surface as `source: 'manual'` with their persisted percentage; auto rows are derived each request.
- POST `/spend-versions/:id/allocations/bulk-upsert`
  - Auto methods (`default|headcount|it_users|turnover`) ignore the payload; the endpoint validates data/metrics and clears any persisted rows so the distribution is always derived dynamically.
  - Manual by Company (`manual_company`): send the selected `company_id`s (and optional `allocation_driver` via the version PATCH). Percentages are recomputed server-side from the chosen metric.
  - Manual by Department (`manual_department`): send `{ company_id, department_id }` pairs; headcount percentages are recomputed server-side.
  - Error codes: `400` on missing IDs or missing/zero metrics needed for the distribution.

## CAPEX Items & Versions
- POST `/capex-items` → create CAPEX item
- PATCH `/capex-items/:id` → update CAPEX item (writable fields and write rules as OPEX, see above)
- GET `/capex-items/:id` → detail (every item column, `cost_center_id` and `run_build` included) plus the analytics values, as OPEX (see above)
- POST `/capex-items/:id/versions` with `{ version_name, as_of_date, input_grain, budget_year?, allocation_method?, allocation_driver? }`
  - `allocation_method` defaults to `default`; `allocation_driver` defaults to `headcount`
  - One version per (item, budget_year)
- PATCH `/capex-items/:id/versions` with `{ id, input_grain?, notes?, allocation_method? }`

## Amounts (CAPEX)
- POST `/capex-versions/:id/amounts/bulk-upsert` → annual or monthly payload; server writes the appropriate rows to `capex_amounts`
  - Annual payload: `{ kind: 'annual', year, totals: { planned?, committed?, forecast?, actual?, expected_landing? } }` (at least one; each named column is spread over the year, the others are kept)
  - Monthly payload: `{ kind: 'monthly', year, months: [{ period: 'YYYY-MM-01', planned?, actual?, expected_landing?, committed?, forecast? }] }`
  - Lines payload, response and round inputs as OPEX (see above), with `capex:member`

## Allocations (CAPEX)
- GET `/capex-versions/:id/allocations` → `{ items: AllocationRow[], total_pct, resolved_method }`
  - Same schema as OPEX allocations; resolves `default` using allocation rules for the fiscal year
- POST `/capex-versions/:id/allocations/bulk-upsert`
  - Manual methods mirror the spend API: patch the version with `{ allocation_method, allocation_driver? }`, then POST only the selected companies/departments. Percentages are recomputed server-side from company or department metrics.
  - Auto (`default|headcount|it_users|turnover`): send `[]` to recompute distribution
  - Manual company: rows require `company_id`, `department_id = null`
  - Manual department: rows require `company_id` and `department_id`

### CAPEX Tasks
- GET `/capex-items/:id/tasks` → list tasks for a CAPEX item (latest first)
- POST `/capex-items/:id/tasks` → create `{ title: string, description?: string, status?: 'open'|'in_progress'|'done'|'cancelled', due_date?: 'YYYY-MM-DD', assignee_user_id?: uuid }`
- PATCH `/capex-items/:id/tasks` → update `{ id, ...fields }`
  - Uses the same unified tasks model as OPEX/Contracts

### CAPEX Relations
- Project
  - PATCH `/capex-items/:id` → accepts `{ project_id?: uuid|null }`
- Contracts
  - GET `/capex-items/:id/contracts` → `{ items: [{ id, name }] }`
  - POST `/capex-items/:id/contracts/bulk-replace` → `{ contract_ids: uuid[] }`
- Applications (same shape as `/spend-items/:id/applications`; `:id` is a UUID or a `CPX-n` reference)
  - GET `/capex-items/:id/applications` (`capex` reader) → `{ items: [{ id, name }] }` sorted by name
  - POST `/capex-items/:id/applications/bulk-replace` (`capex` member) with `{ application_ids: uuid[] }` → replaces the whole set, returns the new list
    - `400` "One or more applications not found" when an id is not an application of the tenant
    - One audit row on `application_capex_items` when the set changes (`record_id` = the CAPEX item, before/after = sorted application ids); the OPEX route writes the same on `application_spend_items`
- Relevant Websites (Links)
  - GET `/capex-items/:id/links`
  - POST `/capex-items/:id/links` → `{ description?: string, url: string }`
  - PATCH `/capex-items/:id/links/:linkId`
  - DELETE `/capex-items/:id/links/:linkId`
- Attachments
  - GET `/capex-items/:id/attachments`
  - POST `/capex-items/:id/attachments` (multipart `file`)
  - GET `/capex-items/attachments/:attachmentId` (download)
  - PATCH `/capex-items/attachments/:attachmentId/delete`

## Summary (OPEX list)
- GET `/spend-items/summary?status=enabled&page=1&limit=50&sort=product_name:ASC&years=2024,2025,2026`
  - Status (OPEX and CAPEX, every summary route: page, ids, neighbours, totals, filter values, aggregate): `status=enabled` (or a `status` set filter on `enabled`) keeps the lines with no `disabled_at` or one on or after 1 January of the current year (UTC), so a line ending during the year stays enabled until 31 December; `status=disabled` keeps the lines with a `disabled_at` before 1 January. Without a status, `/summary/ids`, `/summary/neighbors` and `/summary/totals` use the enabled lines. The item lists (`GET /spend-items`, `/capex-items`) keep "not ended as of now"
  - Each row includes derived blocks for Y-1, Y, Y+1 totals and:
    - `allocation_method_label`: `Headcount|IT users|Turnover|Company|Department` (resolves `default` via rule)
    - `latest_contract_id` and `latest_contract_name` when linked to Contracts
  - Optional `years` parameter: comma-separated list of years to fetch (e.g., `years=2024,2025,2026`)
    - If omitted, defaults to Y-1, Y, Y+1 (where Y = current year)
    - Response includes dynamic year keys: `versions.y2024`, `versions.y2025`, etc. in addition to legacy `yMinus1`, `y`, `yPlus1` for backward compatibility
  - Cost center and run or build (both item types): `cost_center_id`, `cost_center_code`, `cost_center_name`, `cost_center_label` (`"{code} · {name}"`, the list column), `cost_center_path` (names from the root group to the cost center, joined with `" › "`), `run_build` (`run` | `build` | `null`); all `null` when not set
    - Set and text filters on `run_build` run in SQL; `cost_center_label`, `cost_center_code`, `cost_center_name` and `cost_center_path` filter and sort in memory (a group through the path: `contains` its name); `sort=run_build:ASC` orders run, build, then blanks
    - The quick search reads the cost center code, name and path, and the budget holder name
  - Budget holder (both item types): `budget_holder_id` and `budget_holder_name`, the owner (`owner_user_id`) of the line's cost center and that user's display name. Derived when the rows are built, never stored on the line: a change of the cost center's owner shows on every line at once. `null` when the line has no cost center or its cost center has no owner
    - `budget_holder_name` filters (set and text) and sorts in memory
  - Analytics dimensions (both item types), read from the line's analytics values (never the legacy item column):
    - `analytics_category_id` and `analytics_category_name`: the value on the default dimension, `null` when the line has none
    - `analytics_<axis_id>`: the value's name on each dimension of the tenant (disabled ones included), `null` when the line has none. The key uses `_`, not `:`, because sort strings are `field:DIR`
    - `analytics_value_ids`: `{ [axis_id]: category_id }` for the dimensions the line has a value on
    - Every analytics field filters (set, text, blank) and sorts in memory, `analytics_category_id` included; the quick search reads the value names of every dimension
  - FTE (both item types): `fte_<slot><Suffix>` (`fte_yBudget`, `fte_yPlus1Revision`, `fte_y2027Landing`), one per slot (the five fixed ones and each requested `y<YYYY>`) and column, `number | null`. Read from the round of that column on the version the amounts show (the newest per item and year):
    - a column with quantity × price lines: the `fte` its lines gave when they were written, the full-year average (people lines: the quantity each month, or quantity × days per month ÷ the calendar's working days; days lines: the month's share of the days ÷ the calendar's working days; summed over the twelve months, divided by 12, 2 decimals, `0.75`); a later hand edit or spread of the months keeps it
    - lines of pieces only: `0`
    - no round, a round without lines, no version for that year, or a year after the end of validity: `null` (unknown, never 0)
    - Number filters (`blank` = unknown; `null` fails every comparison) and sort (unknown last ascending) run in memory; a sort or filter key naming `fte_y<YYYY><Suffix>` loads that year, as for the amount fields
- GET `/spend-items/summary/filter-values?fields=fieldA,fieldB&q&filters&years=2024,2025,2026` **[Requires: opex:reader]**
  - Fields include `cost_center_label`, `cost_center_code`, `cost_center_name`, `cost_center_path`, `budget_holder_name`, `run_build`, `analytics_category_name` and any `analytics_<axis_id>` (both item types)
  - Distinct filter values for closed-choice columns in the OPEX summary grid.
  - Response: `{ fieldA: Array<string | null>, fieldB: Array<string | null> }`
  - Caller should remove the column’s own filter so values stay discoverable.
- POST `/spend-items/summary/aggregate` **[Requires: opex:reader]** (and POST `/capex-items/summary/aggregate`, **capex:reader**): the lines of a list state grouped and measured on the server, in one statement. The budget reports and the dashboard's budget tiles use it. A read: a frozen subscription keeps it, as the GET routes
  - Body `{ query, spec }`. `query` is the list's query: `filters` (an object or its JSON), `q`, `status`, `includeDisabled`, `years` (`2025,2026`: without a status, the lines still active on 1 January of the earliest year, else of last year), and `ctx` (a saved list context, merged as on the GET routes)
  - `spec`: `groupBy` (0 to 6 fields of the list; `id` gives one group per line), `measures` (0 to 60, each `{ id, fn: sum|min|max|avg, field, minus?, part?: positive|negative }` on an amount `y<YYYY><Suffix>` or `<slot><Suffix>`, an amount in the line's own currency `local_<amount field>`, or an FTE `fte_<amount field>`; at most 8 with group keys, 60 without), `having` (0 to 10 conditions on measures, exact), `order` (0 to 10 terms by `count`, a `measure` or a `key`), `limit` (1 to 10,000) and `others`
  - Fields the reports read besides the list's: `analytics_id_<axis_id>` (the line's value id on a dimension), `account_consolidation_key` and `account_consolidation_label` (the line's consolidation line: `c_<number>`, else `c_<name>`; one label per key, from the accounts the type's lines use; null for a caller without **accounts:reader**, here and as a filter or sort key of the GET summary routes), `has_version_<slot>` (`yes` when the line shows a version that year)
  - Response: `{ groups: [{ keys, count, values, unknown }], others, total, groupCount, reportingCurrency }`; amounts exact to the cent in the reporting currency (`local_` amounts in each line's currency), `total` over every line of the state

## Summary (CAPEX list)
- GET `/capex-items/summary?status=enabled&page=1&limit=50&sort=yBudget:DESC`
  - Each row includes `{ versions: { yMinus1, y, yPlus1 }, allocation_method_label, next_year_allocation_method_label, spread_mode_for_y, company_name }`
  - Also includes `latest_task?: { id, title?, description?, status, created_at } | null` for open/in_progress tasks (most recent)
  - Cost center and run or build fields, analytics dimension fields, filters, sort and quick search as OPEX (see above)
  - `priority`, `investment_type` and `ppe_type` sort in their business order (declaration order: `mandatory, high, medium, low`; the investment types and PPE types as declared), like `status` and `run_build`; their filter values are listed in text order
- GET `/capex-items/summary/ids` → `{ ids, item_numbers, total }` ordered by requested sort (supports derived fields like `yBudget`); `item_numbers[i]` is the item number of `ids[i]`
- GET `/capex-items/summary/neighbors?id=` (`id`: a UUID or a `CPX-n` reference, plus the list parameters of `/summary/ids`) → `{ index, total, prev, next }`: the line's 0-based position in the list (`null` when the list does not hold it) and its previous and next lines as `{ id, item_number }` or `null`. Same on `/spend-items/summary/neighbors` (`OPX-n`)
- GET `/capex-items/summary/totals` → `{ reportingCurrency, ...amounts }`: one key per `<slot><Suffix>` for the slots `yMinus2`, `yMinus1`, `y`, `yPlus1`, `yPlus2` and the suffixes `Budget`, `Revision`, `Forecast`, `FollowUp`, `Landing` (25 keys, for example `yBudget`, `yPlus2Forecast`), plus `y<YYYY><Suffix>` for each requested year. Same shape as the OPEX totals
  - Optional `fte=<comma-separated FTE keys>` (for example `fte=fte_yBudget,fte_y2027Revision`; other keys ignored) adds `fte: { [key]: { total, unknown } }`: the sum of the lines' FTE values as listed (2 decimals each, summed exactly; `null` when no line of the selection has an FTE, never 0) and the number of lines whose FTE is unknown. A key naming `y<YYYY>` reads that year without `years`. Without `fte` the response keeps the amount keys and `reportingCurrency` only. Same on `/spend-items/summary/totals`
- GET `/capex-items/summary/filter-values?fields=fieldA,fieldB&q&filters` **[Requires: capex:reader]**
  - Distinct filter values for closed-choice columns in the CAPEX summary grid.
  - Response: `{ fieldA: Array<string | null>, fieldB: Array<string | null> }`
  - Caller should remove the column’s own filter so values stay discoverable.

## Contracts

- GET `/contracts?status=enabled&page=1&limit=50&sort=cancellation_deadline:ASC&q&filters`
  - Items include derived: `end_date`, `cancellation_deadline`, `linked_opex_count`, and nested `supplier {id,name}`, `company {id,name}` plus `latest_task`.
- GET `/contracts/:id` → details including `links` (URLs), `attachments` (metadata), and `linked_spend_items`.
- POST `/contracts` → create; PATCH `/contracts/:id` → update.

### Contracts ↔ OPEX links (many-to-many)
- Contracts side: GET `/contracts/:id/spend-items` and POST `/contracts/:id/spend-items/bulk-replace` with `{ spend_item_ids: string[] }`
- OPEX side: GET `/spend-items/:id/contracts` and POST `/spend-items/:id/contracts/bulk-replace` with `{ contract_ids: string[] }`

### OPEX URLs and attachments
- URLs: GET `/spend-items/:id/links`, POST `/spend-items/:id/links`, PATCH `/spend-items/:id/links/:linkId`, DELETE `/spend-items/:id/links/:linkId`
- Attachments: GET `/spend-items/:id/attachments`, POST `/spend-items/:id/attachments`; download GET `/spend-items/attachments/:attachmentId`, delete PATCH `/spend-items/attachments/:attachmentId/delete`
  - Permissions: `opex:reader` for list/download; `opex:manager` for create/update/delete

### Contracts ↔ CAPEX links (many-to-many)
- Contracts side: GET `/contracts/:id/capex-items` and POST `/contracts/:id/capex-items/bulk-replace` with `{ capex_item_ids: string[] }`
- CAPEX side: GET `/capex-items/:id/contracts` and POST `/capex-items/:id/contracts/bulk-replace` with `{ contract_ids: string[] }`

### Contract tasks, URLs, attachments
- Tasks: GET `/contracts/:id/tasks`, POST `/contracts/:id/tasks`, PATCH `/contracts/:id/tasks`
- URLs: GET `/contracts/:id/links`, POST `/contracts/:id/links`, PATCH `/contracts/:id/links/:linkId`
- Attachments: GET `/contracts/:id/attachments`, POST `/contracts/:id/attachments`; download GET `/contracts/attachments/:attachmentId`, delete PATCH `/contracts/attachments/:attachmentId/delete`

## Share / Send Link

Fire-and-forget email notifications to share a link to a Task, Project, or Request. Recipients can be existing platform users (by ID) and/or arbitrary email addresses. No access control changes — this is a notification, not a permission grant.

- POST `/tasks/:id/share` — share a task **[Requires: tasks:reader]**
- POST `/portfolio/projects/:id/share` — share a project **[Requires: portfolio_projects:reader]**
- POST `/portfolio/requests/:id/share` — share a request **[Requires: portfolio_requests:reader]**

All three endpoints accept the same body (`ShareItemDto`):
```json
{
  "recipient_user_ids": ["uuid", ...],   // optional — existing user IDs
  "recipient_emails": ["a@b.com", ...],  // optional — arbitrary email addresses
  "message": "Check this out"            // optional — personal message
}
```
At least one of `recipient_user_ids` or `recipient_emails` must be non-empty. User IDs are resolved to emails server-side (only enabled, non-system-role users receive the notification). Raw emails are sent directly without validation against the user table.

Response: `{ success: true }` (202-style fire-and-forget; email failures are silent).

## Tasks (Cross-Platform)

- GET `/tasks?status=open|in_progress|pending|in_testing|done|cancelled&page=1&limit=50&sort=created_at:DESC&q&filters` — list all tasks (aggregated) **[Requires: tasks:reader]**
  - Response: `{ items: TaskRow[], total, page, limit }`
  - TaskRow: `{ id, tenant_id, title, description, status, due_date, created_at, assignee_user_id, assignee_name, related_object_type, related_object_id, related_object_name, priority_level, priority_score, task_type_id, task_type_name, source_id, source_name, category_id, category_name, stream_id, stream_name, company_id, company_name }`
  - Filtering: supports AG Grid filter model via `filters` JSON and `q` quick search; default sort `created_at:DESC`
    - Text filters: `{ filterType: 'text', type: 'contains' | 'equals' | ... , filter: string }`
    - Set filters: `{ filterType: 'set', values: string[] }` (empty array = match nothing)
  - Status: `open|in_progress|pending|in_testing|done|cancelled`; Types: `spend_item|contract|capex_item|project` (or `null` for standalone)
  - Priority score: All tasks have scores; project tasks use `project.score + adjustment`, non-project use fixed mapping (Blocker=110, High=90, Normal=70, Low=50, Optional=30)
  - Classification: For standalone and project tasks, returns the task's own values (with fallback to the parent project if not explicitly set); for other types, returns null
  - Permissions: `tasks:reader` auto-granted when any operations resource has access

- GET `/tasks/ids?sort=...&q=...&filters=...` — ordered ids for workspace navigation **[Requires: tasks:reader]**
- GET `/tasks/filter-values?fields=fieldA,fieldB&q&filters&assigneeUserId&teamId` — distinct filter values for closed-choice columns **[Requires: tasks:reader]**
  - Response: `{ fieldA: Array<string | null>, fieldB: Array<string | null> }`
  - `filters` should be the current AG Grid filterModel JSON; the caller should remove the column’s own filter so values stay discoverable.
- GET `/tasks/:id` — single task with joined names **[Requires: tasks:reader]**
- PATCH `/tasks/:id` — update task by id (non-project target route) **[Requires: tasks:member]**
  - Body: `{ title?, description?, status?, priority_level?, start_date?, due_date?, assignee_user_id?, task_type_id?, phase_id?, source_id?, category_id?, stream_id?, company_id?, related_object_type?, related_object_id? }`
  - Context change is supported when `related_object_type` and `related_object_id` are provided together.
  - Allowed targets on this route:
    - `(related_object_type, related_object_id) = (null, null)` → standalone
    - `(spend_item|contract|capex_item, <uuid>)` → linked non-project task
  - Targeting `project` on this route is rejected; use `PATCH /portfolio/projects/:projectId/tasks/:taskId`.
  - Atomic behavior: relation change + field updates are saved in one transaction.
  - Context cleanup rules:
    - project → standalone: `phase_id` cleared, classification kept
    - project → spend_item|contract|capex_item: `phase_id` + classification cleared
    - any → spend_item|contract|capex_item: classification cleared
    - any → standalone: `phase_id` cleared
- PATCH `/tasks/:id/move` — context-only convenience move **[Requires: tasks:member]**
  - Body: `{ related_object_type: 'spend_item'|'contract'|'capex_item'|null, related_object_id: string|null }`
  - Same pair validation as `PATCH /tasks/:id`; `project` target is not allowed.
- PATCH `/portfolio/projects/:projectId/tasks/:taskId` — update task and force/move context to the specified project **[Requires: portfolio_projects:contributor]**
  - Use this route for any save where the target context is a project.
  - Body uses the same editable task fields as `PATCH /tasks/:id`; project context comes from the path.
- GET `/tasks/:id/activities` — list task activity feed (comments + changes) **[Requires: tasks:reader]**
- GET `/portfolio/projects/:projectId/tasks/:taskId/activities` — list task activity feed in project context **[Requires: portfolio_projects:reader]**
- POST `/tasks/:id/activities` — create task activity **[Requires: tasks:member]**
- POST `/portfolio/projects/:projectId/tasks/:taskId/activities` — create task activity in project context **[Requires: portfolio_projects:contributor]**
  - Supported payloads:
    - Comment: `{ type: 'comment', content: string }`
    - Change: `{ type: 'change', changed_fields: Record<string, [unknown, unknown]> }`
    - Unified action: `{ type: 'unified', content?, status?, time_hours?, time_category? }`
      - `status` accepts task statuses listed above.
      - `time_hours`: integer `0..8` (`0` = no time entry).
      - For project tasks, setting status to `done` requires logged time (existing + submitted).
      - Notification behavior: when `status` and `content` are submitted together, recipients receive preference-aware emails (merged or split based on status/comment notification settings).
      - Task status emails can include deep-link action buttons:
        - `pending`: set `in_progress` or `done`
        - `in_testing`: set `done` or `in_progress`
        - `done`: set `open`
- PATCH `/tasks/:id/activities/:activityId` — edit task comment (author-only) **[Requires: tasks:member]**
- PATCH `/portfolio/projects/:projectId/tasks/:taskId/activities/:activityId` — edit task comment (author-only) **[Requires: portfolio_projects:contributor]**
  - History notes:
    - Task field changes are also auto-written as `type='change'` activity rows during normal task saves (`PATCH /tasks/:id` and `PATCH /portfolio/projects/:projectId/tasks/:taskId`).
    - `changed_fields` uses historical snapshots with human-readable FK values (not UUIDs) where possible.
    - Common auto-generated keys: `title`, `description`, `status`, `task_type_id`, `priority_level`, `creator_id`, `assignee_user_id`, `start_date`, `due_date`, `labels`, `phase_id`, `source_id`, `category_id`, `stream_id`, `company_id`, plus synthetic `related_to` when context changes.
    - Creating a task under a project also writes a project history change key: `task_created: [null, <task title>]`.
    - Portfolio reads that include activities (`?include=activities` on project and request detail) return `created_by_name`: the creation author resolved from the audit trail, with the email as fallback for accounts without a name. `created_at` carries the creation date. Creation itself is not a stored activity row, so the history feed appends a creation entry (date with time, and author) after the recorded changes, which are listed newest first.
    - Managed document edits are stored as `document_updated: [null, <slotKey>]` (`purpose`, `risks_mitigations`) instead of a rendered sentence, so clients can label the change in their own language; a `change` row without `changed_fields` still carries a human-readable `content`.
    - Scoring changes store `criteria_values` as readable before/after labels of the criteria that changed, and `priority_score` only when the score actually moved. Rows written before that format hold raw `{criterionId: valueId}` maps; clients must not render them as text.
    - Converting a request into a project writes `created_from_request: [null, "REQ-<n>: <name>"]` on the new project.
- GET `/tasks/:id/time-entries` — list time entries for a task **[Requires: tasks:reader]**
- GET `/tasks/:id/time-entries/sum` — get total logged hours for a task **[Requires: tasks:reader]**
- POST `/tasks/:id/time-entries` — create time entry **[Requires: tasks:member]**
- PATCH `/tasks/:id/time-entries/:entryId` — update time entry **[Requires: tasks:member]**
- DELETE `/tasks/:id/time-entries/:entryId` — delete time entry **[Requires: tasks:member]**
- GET `/portfolio/projects/:projectId/tasks/:taskId/time-entries` — list project-task time entries **[Requires: portfolio_projects:reader]**
- GET `/portfolio/projects/:projectId/tasks/:taskId/time-entries/sum` — get total logged hours for a project task **[Requires: portfolio_projects:reader]**
- POST `/portfolio/projects/:projectId/tasks/:taskId/time-entries` — create project-task time entry **[Requires: portfolio_projects:contributor]**
- PATCH `/portfolio/projects/:projectId/tasks/:taskId/time-entries/:entryId` — update project-task time entry **[Requires: portfolio_projects:contributor]**
- DELETE `/portfolio/projects/:projectId/tasks/:taskId/time-entries/:entryId` — delete project-task time entry **[Requires: portfolio_projects:contributor]**
- DELETE `/tasks/bulk` — bulk delete `{ ids: string[] }` → `{ deleted: string[], failed: { id, name, reason }[] }` **[Requires: tasks:admin]**

## Portfolio Requests
- GET `/portfolio/requests/:id?include=activities` — load request (include activity feed via `include=activities`) **[Requires: portfolio_requests:reader]**
  - Activity rows are ordered newest-first and tenant-scoped in SQL (`a.tenant_id = app_current_tenant()`).
- PATCH `/portfolio/requests/:id` — update request **[Requires: portfolio_requests:member]**
  - Auto-writes `type='change'` history for tracked fields.
  - Tracked keys: `name`, `purpose`, `requestor_id`, `target_delivery_date`, `source_id`, `category_id`, `stream_id`, `company_id`, `department_id`, `business_sponsor_id`, `business_lead_id`, `it_sponsor_id`, `it_lead_id`, `current_situation`, `expected_benefits`, `risks`, `feasibility_review`.
  - Status is still written via the dedicated status/decision flow (`changed_fields.status`), preserving existing decision/notification behavior.
- POST `/portfolio/requests/:id/comments` — add request comment or formal decision **[Requires: portfolio_requests:member]**
- PATCH `/portfolio/requests/:id/comments/:activityId` — edit request comment (author-only; comment type only) **[Requires: portfolio_requests:member]**
- POST `/portfolio/requests/:id/business-team/bulk-replace` — replace business contributors (logs `business_team` diff) **[Requires: portfolio_requests:member]**
- POST `/portfolio/requests/:id/it-team/bulk-replace` — replace IT contributors (logs `it_team` diff) **[Requires: portfolio_requests:member]**
- POST `/portfolio/requests/:id/capex/bulk-replace` — replace CAPEX links (logs `capex_items` diff) **[Requires: portfolio_requests:member]**
- POST `/portfolio/requests/:id/opex/bulk-replace` — replace OPEX links (logs `opex_items` diff) **[Requires: portfolio_requests:member]**
- POST `/portfolio/requests/:id/dependencies` — add dependency (logs `dependency: [null, label]`) **[Requires: portfolio_requests:member]**
- DELETE `/portfolio/requests/:id/dependencies/:targetType/:targetId` — remove dependency (logs `dependency: [label, null]`) **[Requires: portfolio_requests:member]**
- GET `/portfolio/requests/filter-values?fields=fieldA,fieldB&q&filters` — distinct filter values for closed-choice columns **[Requires: portfolio_requests:reader]**
  - Response: `{ fieldA: Array<string | null>, fieldB: Array<string | null> }`
  - Caller should remove the column's own filter so values stay discoverable.

## Portfolio Team Members
- GET `/portfolio/team-members/time-stats` — bulk time stats for contributor list **[Requires: portfolio_settings:reader]**
  - Response: `{ stats: { [configId]: { avgProjectDays, avgTotalDays } } }`
- GET `/portfolio/team-members/:id/time-stats` — time stats for a single contributor config **[Requires: portfolio_settings:reader]**
  - Response: `{ userId, averageProjectDays, monthly: [{ yearMonth, projectDays, otherDays, totalDays }] }`

## Portfolio Reports
- GET `/portfolio/reports/status-change?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&statuses=...&itemTypes=...&sourceIds=...&categoryIds=...&streamIds=...` — status change report **[Requires: portfolio_reports:reader]**
  - Required:
    - `startDate` (`YYYY-MM-DD`)
    - `endDate` (`YYYY-MM-DD`)
  - Optional filters:
    - `statuses`: comma-separated status values; applies to the status reached after the change (final status for the period)
    - `itemTypes`: comma-separated `task|request|project`
    - `sourceIds`, `categoryIds`, `streamIds`: comma-separated UUIDs
  - Inclusion logic:
    - Includes items whose `status` changed during the selected period (inclusive by day).
    - If an item changed status multiple times in the period, only the latest in-period change is kept.
    - Task scope includes standalone tasks only (project-linked tasks excluded).
  - Response:
    - `{ items: StatusChangeReportRow[] }`
    - `StatusChangeReportRow`: `{ itemType, itemId, itemPath, name, priority, status, sourceId, sourceName, categoryId, categoryName, streamId, streamName, companyName, lastChangedAt }`
- GET `/portfolio/reports/status-change/filter-values?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&...` — distinct filters for status change report **[Requires: portfolio_reports:reader]**
  - Returns values constrained to the current query scope and period.
  - Response:
    - `{ statuses: string[], itemTypes: ('task'|'request'|'project')[], sources: {id,name}[], categories: {id,name}[], streams: {id,name,categoryId}[] }`
- GET `/portfolio/reports/status-change/export?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&...&format=csv|xlsx` — export status change report **[Requires: portfolio_reports:reader]**
  - `format` defaults to `csv`.
  - CSV columns: `Name, Item Type, Priority, Status, Source, Category, Stream, Company, Last Changed`.
  - XLSX includes the same columns; `Name` cells are hyperlinks to the item workspace route.
- GET `/portfolio/reports/capacity-heatmap?teamIds=...&statuses=...&capacityMode=...&groupBy=...` — capacity heatmap **[Requires: portfolio_reports:reader]**
  - `teamIds`: comma-separated team ids; include `no-team` to include contributors without a team (omit to include all teams)
  - `statuses`: comma-separated project statuses; default is `waiting_list,planned,in_progress,in_testing,on_hold`
  - `capacityMode`: `historical` (default) or `theoretical`
  - `groupBy`: `contributor` (default) or `team`
  - Response: `{ contributors: ContributorCapacityRow[], teams: TeamCapacityRow[], unassignedSummary, unassignedProjects, filters }`
- GET `/portfolio/reports/capacity-heatmap/contributor/:contributorId?statuses=...` — project breakdown for contributor **[Requires: portfolio_reports:reader]**
  - Response: `{ projects: ProjectBreakdownRow[] }`
- POST `/portfolio/reports/roadmap/generate` — generate roadmap scenario (read-only simulation) **[Requires: portfolio_reports:reader]**
  - Body:
    - `startDate` (`YYYY-MM-DD`, required)
    - `statuses` (`waiting_list|planned|in_progress|in_testing|on_hold|done`; default: `waiting_list,planned,in_progress,in_testing`)
    - `capacityMode` (`theoretical|historical`, default `theoretical`)
    - `parallelizationLimit` (`1..3`, default `1`)
    - `optimizationMode` (`priority_focused|completion_focused`, default `priority_focused`)
    - `includeAlreadyScheduled` (boolean, default `true`)
    - `excludedProjectIds` (`uuid[]`, default `[]`)
    - `contextSwitchPenaltyPct` (`0..0.5`, default `0.1`)
    - `contextSwitchGrace` (`0..10`, default `1`)
  - Response:
    - `schedule[]`:
      - `{ projectId, projectName, status, categoryId, executionProgress, priorityScore, plannedStart, plannedEnd, durationWeeks, remainingEffortDays, blockerProjectIds, contributorLoads[] }`
      - `contributorLoads[]`: `{ contributorId, contributorName, days }`
    - `unschedulable[]` (with reasons such as `missing_blocker_date`, `insufficient_capacity`, `missing_contributor_capacity`)
    - `bottlenecks[]` (`impactDays` sensitivity)
      - shape: `{ contributorId, contributorName, impactDays }`
      - UI drilldown table (project start/end, total contribution, spent days) is derived client-side from `schedule[].contributorLoads` and `executionProgress`
    - `occupation[]` (contributor/week effort/capacity/occupation + project breakdown)
      - shape: `{ contributorId, contributorName, teamId, teamName, week, effortDays, capacityDays, occupationPct, projects[] }`
      - `occupationPct` is rounded to the nearest integer
    - `teamOccupation[]` (team/week aggregation)
      - shape: `{ teamId, teamName, week, effortDays, capacityDays, occupationPct }`
      - `occupationPct` is rounded to the nearest integer
    - `roadmapEndDate`, `options`, `diagnostics`
  - Behavioral notes:
    - `includeAlreadyScheduled=true` allows recomputing projects that already have planned dates.
    - `includeAlreadyScheduled=false` keeps those projects as frozen commitments that still consume capacity.
    - `excludedProjectIds` excludes projects entirely from the scenario, including frozen-capacity consumption.
    - Best effort is used for missing capacity: contributors without configured capacity are dropped per project; the project is unschedulable only if no contributor with capacity remains.
    - For already started projects (past `actual_start`, fallback eligible past `planned_start`), the historical start is preserved while remaining effort is simulated forward.

## Portfolio Projects
- GET `/portfolio/projects/:id?include=activities` — load project (include activity feed via `include=activities`) **[Requires: portfolio_projects:reader]**
  - Activity rows are ordered newest-first and tenant-scoped in SQL (`a.tenant_id = app_current_tenant()`).
- PATCH `/portfolio/projects/:id` — update project **[Requires: portfolio_projects:contributor]**
  - Auto-writes `type='change'` history for tracked fields.
  - Tracked keys: `name`, `purpose`, `source_id`, `category_id`, `stream_id`, `company_id`, `department_id`, `business_sponsor_id`, `business_lead_id`, `it_sponsor_id`, `it_lead_id`, `planned_start`, `planned_end`, `execution_progress`, `estimated_effort_it`, `estimated_effort_business`, `actual_effort_it`, `actual_effort_business`, `it_effort_allocation_mode`, `business_effort_allocation_mode`.
  - Status is still written via the dedicated status/decision flow (`changed_fields.status`), preserving existing decision/notification behavior.
- POST `/portfolio/projects/:id/comments` — add project comment or formal decision **[Requires: portfolio_projects:contributor]**
- PATCH `/portfolio/projects/:id/comments/:activityId` — edit project comment (author-only; comment type only) **[Requires: portfolio_projects:contributor]**
- POST `/portfolio/projects/:id/business-team/bulk-replace` — replace business contributors (logs `business_team` diff) **[Requires: portfolio_projects:contributor]**
- POST `/portfolio/projects/:id/it-team/bulk-replace` — replace IT contributors (logs `it_team` diff) **[Requires: portfolio_projects:contributor]**
- POST `/portfolio/projects/:id/capex/bulk-replace` — replace CAPEX links (logs `capex_items` diff) **[Requires: portfolio_projects:contributor]**
- POST `/portfolio/projects/:id/opex/bulk-replace` — replace OPEX links (logs `opex_items` diff) **[Requires: portfolio_projects:contributor]**
- POST `/portfolio/projects/:id/dependencies` — add dependency (logs `dependency: [null, "PRJ-<n>: <name>"]`) **[Requires: portfolio_projects:contributor]**
- DELETE `/portfolio/projects/:id/dependencies/:targetType/:targetId` — remove dependency (logs `dependency: [label, null]`) **[Requires: portfolio_projects:contributor]**
- POST `/portfolio/projects/:id/phases` — create phase (logs `phase: [null, <name>]`) **[Requires: portfolio_projects:contributor]**
- PATCH `/portfolio/projects/:id/phases/:phaseId` — update phase (logs `phase.<phaseId>.name|planned_start|planned_end|status`) **[Requires: portfolio_projects:contributor]**
- DELETE `/portfolio/projects/:id/phases/:phaseId` — delete phase (logs `phase: [<name>, null]`) **[Requires: portfolio_projects:contributor]**
- Priority override history:
  - `POST /portfolio/criteria/requests/:requestId/override` **[Requires: portfolio_requests:admin]** and `POST /portfolio/criteria/projects/:projectId/override` **[Requires: portfolio_projects:admin]** write `priority_override`, `override_value`, `override_justification`, and `priority_score` changes into activity history.
- POST `/portfolio/criteria/reorder` — reorder evaluation criteria; body `{ criterion_ids: string[] }` reassigns `display_order` in the given order **[Requires: portfolio_settings:admin]**
- GET `/portfolio/projects/filter-values?fields=fieldA,fieldB&q&filters` — distinct filter values for closed-choice columns **[Requires: portfolio_projects:reader]**
  - Response: `{ fieldA: Array<string | null>, fieldB: Array<string | null> }`
  - Caller should remove the column's own filter so values stay discoverable.
- GET `/portfolio/projects/planning/timeline?months=3&category=<uuid>&status=planned&status=in_progress` — planning timeline feed for Gantt **[Requires: portfolio_projects:reader]**
  - Query parameters:
    - `months` (optional, number): lookback horizon for including historical items; defaults to `3`
    - `category` (optional, UUID): filter by project category
    - `status` (optional, repeated): filter by one or more project statuses
  - Response shape:
    - `projects: Array<{ id, name, status, category_id, planned_start, planned_end, actual_start, actual_end, execution_progress }>`
    - `dependencies: Array<{ id, project_id, depends_on_project_id, dependency_type }>` (only links where both ends are visible in the current project set)
    - `milestones: Array<{ id, project_id, name, target_date, status, project_name }>` (filtered to milestones with `target_date >= viewStart`)
    - `viewStart: string` (`YYYY-MM-DD`, computed as `today - months`)
  - Notes:
    - Cancelled projects are excluded.
    - Returned projects include items with planned dates, plus recently completed items still inside lookback (`planned_end` or `actual_end` >= `viewStart`).
    - Frontend visual windowing/scroll positioning is managed client-side.
- POST `/portfolio/projects/planning/roadmap/apply` — apply generated roadmap dates to selected projects **[Requires: portfolio_projects:contributor]**
  - Body: `{ projects: Array<{ projectId: uuid, plannedStart: YYYY-MM-DD, plannedEnd: YYYY-MM-DD }> }`
  - Validation:
    - `projects` must contain at least one item
    - duplicate `projectId` values are rejected
    - each item requires `plannedStart <= plannedEnd`
  - Behavior:
    - all-or-nothing transaction; one failing project aborts the entire apply
    - updates run through project update service path (same validation/audit behavior as manual edits)
  - Success response: `{ updated: number }`
  - Error response (HTTP 400):
    - `{ message: "Roadmap apply failed", code: "ROADMAP_APPLY_FAILED", details: [{ projectId, error }] }`

### Effort Allocations
- GET `/portfolio/projects/:id/effort-allocations/:effortType` — get allocations for a project **[Requires: portfolio_projects:reader]**
  - `effortType`: `it` or `business`
  - Returns: `{ mode: 'auto'|'manual', allocations: AllocationUser[], total_pct: number, estimated_effort: number }`
  - `AllocationUser`: `{ user_id, email, first_name, last_name, allocation_pct, is_lead, is_orphaned? }`
  - In auto mode, allocations are computed on-the-fly using business rules (10% lead, 90% team split)
  - In manual mode, returns stored allocations; `is_orphaned=true` for users no longer on the team
- POST `/portfolio/projects/:id/effort-allocations/:effortType` — set manual allocations **[Requires: portfolio_projects:manager]**
  - Body: `{ allocations: Array<{ user_id: string, allocation_pct: number }> }`
  - Validation: sum must equal 100%, all values must be integers 0-100, users must be eligible (lead or team member)
  - Sets allocation mode to `manual` and stores the allocations
- DELETE `/portfolio/projects/:id/effort-allocations/:effortType` — reset to auto mode **[Requires: portfolio_projects:manager]**
  - Deletes stored allocations and sets mode back to `auto`

### Standalone Task Management
- POST `/tasks/standalone` — create standalone task (not linked to any object) **[Requires: tasks:member]**
  - Body: `{ title: string, description?: string, status?: string, priority_level?: string, start_date?: string, due_date?: string, assignee_user_id?: string, task_type_id?: string, source_id?: string, category_id?: string, stream_id?: string, company_id?: string }`
  - `title` is required and cannot be empty
  - Classification fields (`source_id`, `category_id`, `stream_id`, `company_id`) reference portfolio classification entities

### OPEX Task Management
- GET `/spend-items/:id/tasks` → list tasks for specific OPEX item (sorted by creation date DESC) **[Requires: tasks:reader]**
- POST `/spend-items/:id/tasks` → create task **[Requires: tasks:member]**
  - Body: `{ title: string, description?: string, status?: string, due_date?: string (YYYY-MM-DD), assignee_user_id?: string }`
  - `title` is required and cannot be empty
  - `description` is optional (nullable)
  - Status defaults to `open` if not provided
  - Note: Tasks are independent objects; OPEX permissions alone do not grant task create/edit rights
- PATCH `/spend-items/:id/tasks` → update task **[Requires: tasks:member]**
  - Body: `{ id: string, title?: string, description?: string, status?: string, due_date?: string, assignee_user_id?: string }`
  - Requires task `id` in body; validates task belongs to specified item
  - `title` cannot be empty if provided
  - `description` can be null or omitted
  - Note: OPEX permissions alone do not grant task create/edit rights

### Contracts Task Management
- GET `/contracts/:id/tasks` → list tasks for specific Contract (sorted by creation date DESC) **[Requires: tasks:reader]**
- POST `/contracts/:id/tasks` → create task **[Requires: tasks:member]**
- PATCH `/contracts/:id/tasks` → update task **[Requires: tasks:member]**
  - Same body/validation semantics as OPEX tasks (title required, description optional, unified statuses)

### Contracts CSV
- Export `GET /contracts/export?scope=template|data`; Import `POST /contracts/import?dryRun=true|false`
- Headers: `name;company_name;supplier_name;start_date;duration_months;auto_renewal;notice_period_months;yearly_amount_at_signature;currency;billing_frequency;status;owner_email;notes`
- Upsert key: composite `name + supplier_name`; references by name/email

## Contacts (Directory)

- GET `/contacts?page=1&limit=50&sort=last_name:ASC|supplier_name:ASC&q&filters&active=true|false` — list contacts with search across name/email/phone **and supplier name**. [Requires: contacts:reader]
  - Response: `{ items: { id, first_name, last_name, job_title, email, phone, mobile, country, notes, active, supplier_id, supplier_name, created_at, updated_at }[], total, page, limit }`
  - Filters accept `supplier_id` and `supplier_name` (AG Grid text filter semantics) in addition to the existing fields.
- GET `/contacts/:id` — single contact, returns `supplier_id` and `supplier_name`. [Requires: contacts:reader]
- POST `/contacts` — create. Body supports the fields above; `email` required, `supplier_id` optional (validated against existing suppliers). [Requires: contacts:manager]
- PATCH `/contacts/:id` — partial update (supplier_id can be set or cleared). [Requires: contacts:manager]
- DELETE `/contacts/:id` — delete one. Removes supplier links first. [Requires: contacts:manager]
- DELETE `/contacts/bulk` — bulk delete `{ ids: string[] }` → `{ deleted: string[], failed: { id, name, reason }[] }`. [Requires: contacts:admin]

### Contacts CSV
- Export: `GET /contacts/export?scope=template|data` (semicolon separator, UTF‑8 with BOM)
- Import: `POST /contacts/import?dryRun=true|false`
- Headers: `first_name;last_name;job_title;email;phone;mobile;country;notes;active`
- Upsert key: `email` (per tenant). Import normalizes to lowercase; creates when missing; updates otherwise.
- Validation: `email` required; `country` ISO alpha‑2; `active` accepts `true|false|1|0|yes|no`.

### Suppliers ↔ Contacts Links
- GET `/suppliers/:id/contacts` — list links with embedded contact and role. [Requires: suppliers:reader]
- POST `/suppliers/:id/contacts` — attach `{ contactId, role: 'commercial'|'technical'|'support'|'other', isPrimary? }`. [Requires: suppliers:manager]
- DELETE `/suppliers/:id/contacts/:linkId` — detach. [Requires: suppliers:manager]

### Suppliers CSV (contacts columns)
- GET `/suppliers/export?scope=template|data&language=…` and POST `/suppliers/import?dryRun=true|false&language=…&dateOrder=…&decimalMark=…` (multipart `file`). Same shared master-data contract as `/companies/import`.
- Headers: `name, erp_supplier_id, commercial_contact, technical_contact, support_contact, notes, status`. Upsert on `name`.
- The contact columns hold one email address each. On import, the system links the supplier to contacts by email (creating contacts if needed). On export, these columns contain the primary (or first) linked contact email per role.

## Reporting (Phase 1)
- Frontend reports consume `/spend-items/summary` and `/capex-items/summary` to compute:
  - Top 10 OPEX by Budget (Y)
  - Top Increase/Decrease vs (Y-1) Budget or Landing → Budget (Y)
  - Budget Trend (OPEX): multi-metric line over a year range (Budget, Follow-up, Landing, Revision)
  - Budget Trend (CAPEX): same controls as OPEX trend, backed by CAPEX data
  - Budget Column Comparison: up to 10 selections (Year + Column), with a Year grouping mode that pivots by year and renders one series per column when each selected column spans at least two distinct years
  - Budget by Consolidation Account: group totals by each account's consolidation account; pie for single year, line for multi-year
  - Budget by Analytics Category: same controls/visuals as consolidation report but grouped by analytics category metadata
- Totals fields exposed per year slot:
  - Legacy keys (backward compatible): `versions.yMinus1`, `versions.y`, `versions.yPlus1`
  - Dynamic year keys: `versions.y2024`, `versions.y2025`, etc. (available when using `years` parameter)
  - Each slot contains: `{ year?, totals: { budget, follow_up, landing, revision }, approved?, version_id? }`
  - Note: Use the `years` query parameter to fetch arbitrary years (Y-5 through Y+5). Without it, defaults to Y-1, Y, Y+1.

### Chargeback (OPEX)
- GET `/reports/chargeback/global?year=YYYY&metric=<column>`
- GET `/reports/chargeback/company?companyId=<uuid>&year=YYYY&metric=<column>`
  - `metric`: one of `budget`, `revision`, `forecast`, `follow_up`, `landing`; omitted = the tenant's default column (`/budget-columns`); anything else is a 400 listing the five names
  - Requires `reporting:reader`

### Disabled Date Semantics (applies to Reporting endpoints)
- Fiscal year = calendar year.
- Items contribute through their `disabled_at` year and contribute zero for strictly later years.
  - OPEX/CAPEX summaries: when `status` is omitted (neutral), items are included if `(disabled_at IS NULL OR disabled_at >= :period_start)`, where `period_start` is the start of the earliest requested year.
  - Chargeback: version/item joins are per selected `year` using `(disabled_at IS NULL OR disabled_at >= :period_start)`.
  - Allocation recipients (companies/departments): computed per version year with the same rule.
  - Manual allocation validations (company/department modes) enforce availability per fiscal year, using the same condition.
  - Example: `disabled_at = 2025-06-30` → contributes to 2025 totals; excluded from 2026.

## Common Notes
- Reference lookups (pickers, `common/lookup/`)
  - GET `/<resource>/lookup?q=&limit=&<scope>` searches a reference table as the user types: `q` matches with accents and case folded on both sides (as the list quick search), rows whose label starts with `q` first, then rows where a word starts with it, then the others; `limit` defaults to 30, at most 50; the response is `{ items, has_more }`. Only active rows are offered
  - GET `/<resource>/lookup?ids=a,b` returns the rows of those ids whatever their status (the values already chosen, at most 100 ids), and ignores `q` and the scope
  - Resources and scopes: `/suppliers/lookup` (`{ id, name, erp_supplier_id, status }`, the ERP id is searched too), `/accounts/lookup?companyId=` (the company's chart, else the global default chart; or `coaId=`; `{ id, account_number, account_name, description, coa_id }`, by number, a typed number ranks first), `/companies/lookup`, `/departments/lookup?company_id=`, `/users/lookup` (people: `{ id, first_name, last_name, email, status }`, names only, searched as "first last" and "last first", sorted by last name; `email` is set only for a person without a name, the only case it is shown or searched), `/analytics-categories/lookup?axis_id=`, `/business-processes/lookup`, `/contracts/lookup`
  - Read access (`common/lookup/lookup-requirements.ts`): a search (`q`, blank or not) needs read access on the reference's own page, or the level that edits a page whose forms pick it (member; contributor for incidents); read access on such a page allows `ids` only (the labels of values already chosen), and a search answers 403 `lookup_search_forbidden`. Exception: `/users/lookup` searches for the readers of every page with "Send link" (OPEX, CAPEX, tasks, requests, projects, applications, infrastructure, locations, knowledge). `/companies/lookup` and `/departments/lookup` keep their reader-level search (read-only reports filter on a company)
  - Currency settings are a budget setting. GET `/currency/settings` and GET `/currency/rates` need `budget_ops`, `opex` or `capex` at `reader` (the OPEX and CAPEX forms read their currency picker); PATCH `/currency/settings` and POST `/currency/rates/refresh` need `budget_ops:admin`. The IT landscape `settings` resource grants nothing on currencies. GET `/currency/settings` writes nothing (the currency rows are ensured when the settings are saved)
- Pagination/sort
  - `page`, `limit`, `sort=field:ASC|DESC` supported on list endpoints; lists return `{ items, total, page, limit }`
- Filtering (grids)
  - Grids pass `filters` as an AG Grid `filterModel` JSON string; server applies simple equals/contains where applicable
- Status & lifecycle
  - Most master lists support `?status=enabled|disabled`. When omitted, lists default to rows that are active as of now.
  - Reporting endpoints (OPEX/CAPEX summaries, Chargeback) are year-aware:
    - For neutral status, item inclusion uses a period-start gate derived from the requested years.
    - For joins/allocations tied to a single report year, the period start is the start of that year.
    - This yields: included through the disabled year and excluded for strictly later years.
  - Users additionally support `contact|invited`; a user limit, when a platform administrator has set one on the tenant's plan, only counts `enabled` users.

## Examples

### Upsert company metrics
```
PATCH /company-metrics/3b1c…?year=2025
{
  "headcount": 120,
  "it_users": 80,
  "turnover": 12.345
}
```

### Manual by company allocations
```
PATCH /spend-items/9a2f…/versions
{
  "id": "v-2025",
  "allocation_method": "manual_company",
  "allocation_driver": "it_users"   // optional, defaults to "headcount"
}

POST  /spend-versions/v-2025/allocations/bulk-upsert
[
  { "company_id": "c1" },
  { "company_id": "c2" }
]
```
- Send only the companies you want to keep. `allocation_pct` is optional and ignored—percentages are recomputed from the latest company metrics using the stored `allocation_driver`.
- `allocation_driver` may be `headcount`, `it_users`, or `turnover`. Omit it to fall back to headcount.

### Auto (headcount) allocations (empty payload → full materialization)
```
PATCH /spend-items/9a2f…/versions { id: "v-2025", allocation_method: "headcount" }
POST  /spend-versions/v-2025/allocations/bulk-upsert []
```
## Users (Admin)
- POST `/users` → create user `{ email, first_name?, last_name?, role_id?, status? }`
  - Password is optional; most flows leave it empty and rely on the invite/password-reset pipeline.
  - `role_id` preferred; falls back to `role_name` (defaults to system `Contact`).
  - `status` defaults to `enabled`; a user limit, when set on the tenant's plan, is enforced when saving with `status='enabled'`.
- POST `/users/:id/enable` → sets user `status='enabled'`
  - Requires: users:admin level
  - Enforces the user limit only when a platform administrator has set one on the tenant's plan (`seat_limit` not null): fails with 400 when the number of `enabled` users has reached it. No limit applies by default.
- POST `/users/:id/disable` → sets user `status='disabled'`
  - Requires: users:admin level
- POST `/users/:id/invite` → sets user `status='invited'` (an invited user does not count toward a user limit)
  - Requires: users:admin level
  - Sends a Resend email with a password setup CTA pointing to `/accept-invite#token=...`. The token reuses the password-reset pipeline and automatically enables the user once a password is set.
  - The link uses the same address as password reset links (the tenant's address in multi-tenant mode). Without a configured address: `400` `application URL is not configured: set APP_BASE_URL`.

### Users CSV
- GET `/users/export?scope=template|data&language=…` → `text/csv`
- POST `/users/import?dryRun=true|false&language=…&dateOrder=…&decimalMark=…` (multipart `file`)
- Headers: `email, first_name, last_name, role, company_name, department_name, status` (`contact|invited|enabled|disabled`, blank means `contact`). Upsert on `email`; `department_name` needs a `company_name`. Same shared master-data contract as `/companies/import`.
- A role the tenant does not have is created by the **load**, never by the check: a check answers `rolesToCreate` (distinct names) and writes nothing, and a refused file creates no role either.

## Roles (Admin)
- GET `/roles` → `{ items: Role[] }` (includes `user_count` and `is_system`)
- POST `/roles` → create role `{ role_name, role_description }` (admin only)
- DELETE `/roles/:id` → delete role (no users assigned, not system)
- GET `/roles/:id/permissions` → returns per-page permission levels for the role
  - Example: `{ companies: 'manager', suppliers: null, ... }`
- PUT `/roles/:id/permissions` → sets per-page permission levels for the role
  - Body: `{ permissions: { [resource]: 'reader'|'manager'|'admin'|null } }`
  - Note: `Administrator` and `Contact` are system-locked; the former is always full access, the latter cannot be granted access or login

## Audit Logs (Admin)
- Permission: `users:admin`
- GET `/audit-logs?page=1&limit=100&sort=created_at:DESC&q=...&from=YYYY-MM-DD&to=YYYY-MM-DD&table_name=...&action=...&source=...&user_id=...&filters=<agGridFilterModel>`
  - Returns paginated audit entries for the current tenant:
    - `{ items, total, page, limit }`
  - Item shape:
    - `{ id, tenant_id, table_name, record_id, action, before_json, after_json, user_id, user_email, user_name, source, source_ref, created_at }`
  - Supports quick search (`q`) across `table_name`, `action`, and actor name/email.
  - Supports date range filtering:
    - `from` is inclusive (`>=`)
    - `to` is exclusive (`<`) when a full datetime is provided; for `YYYY-MM-DD`, API treats it as end-of-day inclusive by shifting to the next day internally.
  - Whitelisted sort fields: `created_at`, `table_name`, `action`. Default: `created_at:DESC`.
  - `source` identifies origin (`user`, `system`, `webhook`); `source_ref` stores upstream event correlation (for example Stripe event id).
- GET `/audit-logs/filter-values?fields=table_name,action,source&q=...&filters=<agGridFilterModel>`
  - Returns distinct filter values for checkbox-set column filters, scoped by the current query state.
  - Response shape:
    - `{ table_name?: (string|null)[], action?: (string|null)[], source?: (string|null)[] }`
- GET `/audit-logs/:id`
  - Returns one audit entry with the same shape as list items.
  - Used by the detail dialog to display full before/after JSON payloads.

## Budget Operations (OPEX Admin)

### Copy Budget Columns
- POST `/spend-items/budget-operations/copy-column`
  - Body: `{ sourceYear: number, sourceColumn: BudgetColumn, destinationYear: number, destinationColumn: BudgetColumn, percentageIncrease: number, overwrite: boolean, dryRun: boolean }`
  - Budget columns: `budget`, `revision`, `forecast`, `follow_up`, `landing` (mapped to database columns: `planned`, `committed`, `forecast`, `actual`, `expected_landing`)
  - Year range: Y-1 to Y+5 (relative to current year)
  - Features:
    - `percentageIncrease`: Apply percentage adjustment (e.g., 5.0 for 5% increase) with integer rounding
    - `overwrite`: If false, skips destination items that already have data; if true, overwrites all
    - `dryRun`: If true, returns preview without making changes
  - Returns: `{ success: boolean, dryRun: boolean, summary: { totalItems, processed, skipped, errors }, results: BudgetOperationResult[] }`
  - `BudgetOperationResult`: `{ itemId, itemName, sourceValue, currentDestinationValue, newValue }`
  - Requires: `opex:admin` level
  - Notes:
    - True copy operation - source data is never modified
    - Preserves all other columns when updating destination column
    - Creates versions/amounts for destination year if they don't exist; a created version is named `Y<year>`
    - The destination column's quantity and price lines are replaced by the source column's, each period shifted to the destination year (29 February becomes 28 February), quantity and unit price unchanged (the uplift applies to the months only). For lines that are only a reference: cut to the item's validity (a line with no month left is dropped), a calendar without days for the destination year replaced by the paying company's standard calendar (accepted after the preview like the other calendar changes), the destination FTE computed from the copied lines on the destination year's calendars; without a replacement calendar the lines are copied as they are with the source's FTE. A source without lines leaves the destination without lines
    - Full audit logging for compliance

### Copy Allocations
- POST `/spend-items/budget-operations/copy-allocations` (OPEX lines, requires `opex:admin`)
- POST `/capex-items/budget-operations/copy-allocations` (CAPEX lines, requires `capex:admin`)
  - Body (both routes): `{ sourceYear: number, destinationYear: number, overwrite?: boolean, dryRun?: boolean }`
  - Returns: `{ success: boolean, dryRun: boolean, summary: { totalItems, processed, skipped, errors }, results: AllocationCopyResult[] }`
  - `AllocationCopyResult`: `{ itemId, itemName, sourceMethod, sourceMethodLabel, destinationMethod, destinationMethodLabel, resultMethod, resultMethodLabel, sourceAllocationsCount, destinationAllocationsCount, action, message? }`, with `action` one of `copy`, `skip_missing_source_version`, `skip_no_source_allocations`, `skip_destination_has_data`, `error`
  - Notes:
    - Reads the newest budget version of each line for the source year; creates the destination year's version when missing
    - Manual methods copy their percentages; automatic methods are recomputed for the destination year
    - `overwrite: false` skips lines whose destination year already has allocations
    - All or nothing: if one line fails, nothing is written

### Clear Budget Column
- POST `/spend-items/budget-operations/clear-column`
  - Body: `{ year: number, column: BudgetColumn }`
  - Budget columns: `budget`, `revision`, `forecast`, `follow_up`, `landing`
  - Year range: Y-1 to Y+5 (relative to current year)
  - Returns: `{ success: boolean, summary: { totalItems, cleared, skipped, errors } }`
  - Requires: `opex:admin` level
  - Notes:
    - Sets all values in the specified column to zero
    - Preserves all other columns
    - Only processes items that have data in the target column
    - Full audit logging for compliance
    - Permanent operation - cannot be undone

### Budget files (OPEX and CAPEX)
One file per list: the OPEX list exports and imports the OPEX file, the CAPEX list the CAPEX file. Same columns and rules in both; the manual is `doc/help/docs/en/budget-file.md`.
- GET `/spend-items/budget-file/export?language=en|fr|de|es&amountYears=2026,2027&columns=budget,revision&detail=yearly|months&all=true` (same on `/capex-items/budget-file/export`)
  - Requires `opex:admin` / `capex:admin` (a read: a frozen tenant keeps it). The other query parameters are the list's own (`sort`, `q`, `filters`, `status`, `includeDisabled`, `ctx`), and the file holds the lines the list engine returns, in its order
  - `all=true` drops the filters, the search and the status scope and includes ended lines. `amountYears` defaults to the current year ±1, at most twelve years within ten years of the current one. `columns` defaults to the tenant's shown columns, in the fixed order `budget, revision, forecast, actual, landing`. `detail=months` writes `<column>_<year>_<mm>` instead of `<column>_<year>`
  - `400` for an unknown column, no column at all, an unknown `detail`, or a malformed `amountYears`. Zero lines still write the header row (the template). File names `opex.csv` / `capex.csv`
- POST `/spend-items/budget-file/preflight?language=…&dateOrder=day-first|month-first&decimalMark=comma|dot&createSuppliers=true|false` (multipart `file`; same on `/capex-items/budget-file/preflight`)
  - Read-only, no lock, nothing written. Requires `opex:admin` / `capex:admin`. `createSuppliers` is honoured only for a user allowed to create suppliers
  - Answers `BudgetFileReport`: `{ ok, scope, encoding, separator, notices: { dates, amounts }, fileErrors[], headerErrors[], errors: [{ line, column, message }], errorCount, missing: [{ type, count, examples, where, message }], deleted[], deletedCount, changes: { created, updated, unchanged, createdLines[], updatedLines[] }, changedSinceExport[], changedSinceExportCount, warnings: { duplicates[], ignoredColumns[], supplierNames[] }, creates: { dimensionValues[], suppliers[] }, supplierMessage, snapshot: { lines: [{ id, itemNumber, rowVersion, years: [{ year, versionId, budgetRev }] }] } }`
  - Header errors: an amount-looking column that does not parse (`budget_27`, `budjet_2027`), an `analytics:<code>` column naming no dimension, a yearly header and a monthly header for the same column and year. Row errors name the physical line: an unknown `item_number`, a number of the other type, a line deleted since the export, a missing reference (company, account, cost center, user, project), a value of a disabled dimension, a cleared amount column, more than two decimals, an amount too large, a changed cell in a frozen column, a malformed `kanap_token`. Old layouts are refused as a whole with one `fileErrors` entry
- POST `/spend-items/budget-file/import?language=…&dateOrder=…&decimalMark=…&createSuppliers=…` (multipart `file` plus `snapshot`; same on `/capex-items/budget-file/import`)
  - Not a read. Requires `opex:admin` / `capex:admin`. `snapshot` is the preflight's `snapshot`, sent as JSON
  - The load re-runs the preflight under the tenant's bulk lock, locks the target lines in id order and writes everything in one transaction: nothing on a row error. Answers `{ ok, scope, inserted, updated, unchanged }` (a `409` when a line moved between the check and the load; a report instead of a result when the second check refuses the file). Runs `ANALYZE` after more than 1,000 rows
- Refusals and codes: `400` "The preflight snapshot is missing. Run the preflight again." / "The preflight snapshot is not valid."; `409` "Some lines changed since the preflight. Run the preflight again."; `409 operation_running` "Another budget operation is running (copy, clear or import). Try again when it ends." (the per-tenant bulk lock, shared with copy, clear and allocation copy); `503 busy` with `Retry-After` while KANAP is saturated; `413` over 48 MB ("This file is too large. A budget file can hold 20,000 lines. Export fewer lines or fewer years."), then the shared 20,000-row cap
- File layout, cell rules (`-` clears, `0` zeroes, empty keeps), matching by `item_number`, supplier matching and creation, the `kanap_token` freshness check and the write rules are in `doc/features/patterns/csv-import-export.md`
### Freeze / Unfreeze Data
- GET `/freeze-states?year=YYYY`
  - Returns `{ year, entries: FreezeState[], summary }`
  - `entries` list raw rows (`scope`, optional `column`, timestamps, user IDs); `summary` aggregates by scope/column for quick status checks
- POST `/freeze-states/freeze`
  - Body: `{ year: number, scopes: Array<{ scope: 'opex'|'capex'|'companies'|'departments', columns?: ('budget'|'revision'|'forecast'|'actual'|'landing')[] }> }`
  - Locks the requested year/scope combinations (OPEX/CAPEX without `columns` freezes all five; ignored for company/department metrics)
  - Freezing the tenant's default column (`/budget-columns`) pins the year's latest FX rate set on the versions of that year and scope; unfreezing it unpins. Changing the default column pins or unpins nothing by itself
  - Requires `budget_ops:admin`
- POST `/freeze-states/unfreeze`
  - Body mirrors the freeze payload
  - Requires `budget_ops:admin`
- All three endpoints return the same shape so the UI can refresh local state after each call.

## Tenants (Platform Admin)
- GET `/admin/tenants?page=1&limit=20&q=slug&status=active`
  - Requires platform admin claim (`isPlatformAdmin` true)
  - Returns `{ items, total, page, limit }` where each item contains summary stats (companies, headcount, departments, suppliers, OPEX, CAPEX, users enabled/total) and plan snapshot `{ plan_name, seat_limit, seats_used, subscription_type, payment_mode, next_payment_at }`
  - Supports `status` filters: `active`, `frozen`, `deleting`, `deleted`
- GET `/admin/tenants/:tenantId`
  - Returns full detail including lifecycle timestamps (`frozen_at`, `deletion_requested_at`, `deletion_confirmed_at`, `deleted_at`), optional deletion reason, plan details, and stats
- PATCH `/admin/tenants/:tenantId/plan`
  - Body: subset of `{ plan_name, seat_limit, active_seats, subscription_type, payment_mode, next_payment_at, status, trial_end, notes }`
  - `seat_limit: null` means unlimited seats. `status` is one of the subscription statuses (`trialing`, `active`, `past_due`, `unpaid`, `paused`, `canceled`, `incomplete`, `incomplete_expired`). `trial_end` is an ISO-8601 date-time, or `null` to clear it.
  - Updates the tenant’s subscription metadata and records an audit entry
- POST `/admin/tenants/:tenantId/mark-internal`
  - No body. Marks the tenant as an internal tenant (demonstration, test): subscription `active`, no trial end, plan `Internal`, unlimited seats, `bank_transfer`, no next payment, and a dated line appended to the notes. No Stripe call.
  - Returns the tenant detail. Calling it again on an internal tenant changes nothing.
  - 400 on system tenants and on deleted tenants. 409 when the subscription has a `stripe_subscription_id`, whatever its status.
  - Audited on `tenants_plan` with `source_ref = 'mark-internal'`. See "Internal tenants" in `architecture.md`.
- POST `/admin/tenants/:tenantId/freeze`
  - Body (optional): `{ reason?: string }`
  - Sets tenant status to `frozen`, records timestamp, blocks login for tenant users, and logs audit trail
- POST `/admin/tenants/:tenantId/unfreeze`
  - Restores tenant status to `active`, clears `frozen_at`
- POST `/admin/tenants/:tenantId/delete`
  - Body: `{ confirmSlug: string, reason?: string }`
  - Immediately purges tenant-owned data across companies, users, spend, contracts, RBAC, audit, and accounting master data, frees the slug, and returns `{ tenant, purgeReport }`.
  - Purge coverage (order-aware): `contract_attachments`, `contract_tasks`, `contract_links`, `contract_spend_items`, `contracts`, `tasks`, `spend_amounts`, `spend_allocations`, `spend_versions`, `spend_tasks`, `spend_items`, `analytics_categories`, `capex_amounts`, `capex_allocations`, `capex_versions`, `currency_rate_sets`, `capex_items`, `freeze_states`, `department_metrics`, `company_metrics`, `departments`, `companies`, `user_page_roles`, `role_permissions`, `users`, `roles`, `supplier_contacts`, `contacts`, `suppliers`, `accounts`, `chart_of_accounts`, `allocation_rules`, `audit_log`, `subscriptions`.
  - Slug reuse: the tenant record remains for auditability but its `slug` is cleared for reuse by setting it to a unique marker like `deleted-<old-slug>-<timestamp>`.
  - Use freeze when you want a reversible lock; deletion is irreversible
## Notification Preferences

Requires JWT authentication. All endpoints operate on the current user's preferences within their tenant.

- GET `/users/me/notification-preferences` → current preferences
  - Response: `{ emails_enabled, workspace_settings: { portfolio: { enabled, status_changes, team_additions, team_changes_as_lead, comments }, tasks: { enabled, as_assignee, as_requestor, as_viewer, status_changes, comments }, budget: { enabled, expiration_warnings, status_changes, comments } }, weekly_review_enabled, weekly_review_day, weekly_review_hour, timezone }`
  - Returns defaults on first access (emails enabled, all categories on, weekly review Monday 09:00 in user's timezone)

- PATCH `/users/me/notification-preferences` → update (upsert)
  - Body: partial `NotificationPreferencesData` (any subset of the fields above)
  - Returns the full updated preferences object

- POST `/users/me/notification-preferences/test-weekly-review` → `{ success, message }`
  - Sends a test weekly review email to the current user immediately
  - Useful for verifying email rendering and delivery

## Health

- GET `/health` → `{ status: 'ok' }` — liveness probe
