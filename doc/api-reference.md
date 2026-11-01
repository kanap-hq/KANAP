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
- `RATE_LIMIT_TRUST_PROXY`: the number of reverse proxies in front of the API (`false`, `true` for one, or 1 to 3). The client address, which the limits and the audit log use, is then read from `X-Forwarded-For`. Unset or invalid: one proxy in single-tenant mode, none in multi-tenant mode. The start-up log has a `[RATE-LIMIT]` line that says which applies.
- Limits count per client address: `POST /auth/login` 60 a minute; Microsoft sign-in (`GET /auth/entra/callback`, `POST /auth/entra/session`) 60 a minute.
- `POST /auth/refresh` first counts renewals per refresh token (`auth/refresh-session-limit.ts`, `RATE_LIMITS.authRefreshSession`): the 31st renewal of one token within a minute gets a 429 with `Retry-After`, and the token stays refused for the next 60 seconds, whatever the client address. Every open tab renews with the same cookie, since the access token lives in memory. The token is the cookie, else `refresh_token` in the body; the key is a SHA-256 of the tenant and the token. A renewal refused per token does not count against the client address, so a client that loops does not take the budget of its neighbours. The route then allows 120 renewals a minute per client address and tenant (`RATE_LIMITS.authRefresh`, `TenantRateLimitGuard`): a renewal comes about every 14 minutes per open tab and at each page load, and the people of one organisation often share one outbound address. A request without a token counts against the address limit only and gets 400. A refused origin gets its 403 before anything is counted.
- `POST /auth/login` also counts attempts per account and client address (`auth/login-attempt-limit.ts`): after 5 refused attempts within 15 minutes for one address typed (lower case, without spaces) from one client address in one tenant, that pair gets the same 429 for 15 minutes, before the password check, whether the account exists or not, with `Retry-After` in seconds. A successful sign-in clears the pair's count, and an attempt that ends in an error other than a refusal does not count. The window is fixed: it opens at the first attempt. The fifth refusal writes one `login_failed` event with the reason `too_many_attempts`; the attempts refused during the block write none.
- Defaults: `POST /auth/login` (60/60s per address, 5 refused attempts per account and address in 15m), `POST /auth/password-reset/request` (3/15m), `POST /auth/password-reset/complete` (5/10m), `POST /public/start-trial` (5/10m), `POST /public/contact` (5/10m).

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
  - The link is issued and e-mailed after the response: the status and the body are the same whether the account exists and whether the e-mail goes out, and the response waits for neither. A failure is an error line in the server log (`Password reset link not created` or `Password reset e-mail not sent`, with the tenant, the account id, the transport and the error code; never the link, the token or an e-mail address) and the request's audit row carries `source_ref = email_not_sent`, as does a request for an account on a reserved `.example` domain, where nothing is sent.
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
    - `{ status, step, started_at, heartbeat_at, loaded_at, loaded_by, failed_at, error_code, dismissed_at, ever_loaded_at, reset_failed_at, can_load, load_refusal, blocking, created_since_load, workspace_name, loaded_by_name }`
  - `?view=banner` returns the light view the home banner polls: no `created_since_load`, no `loaded_by_name`, and no check of the workspace content once the banner can no longer show (hidden, or sample data loaded once): `can_load` is then `false`. The page uses the full view.
  - `ever_loaded_at` is set when a load completes and is kept by a reset. The home banner never shows again once it is set.
  - `reset_failed_at` is set when a reset an Administrator asked for failed (nothing was changed). The next load or reset clears it.
  - `step` is the loader step of a running load (for example `companies`), `null` otherwise.
  - `error_code` when `status = failed`: `load_failed`, `load_timeout`, `load_not_started`, `load_interrupted` or `reset_failed` (the automatic reset after the failed load failed too).
  - `can_load` is true when the status is `idle` or `failed`, the subscription is in good standing and the workspace is still in its starting state (no business data, no added configuration; what activation creates does not count).
  - `load_refusal` says why a load would be refused now (status `idle` or `failed` only): `SUBSCRIPTION_FROZEN`, `TRIAL_EXPIRED` or `tenant_not_empty`. `null` when it would not be. The page shows that reason, and no Load button.
  - `blocking` lists what stands in the way when `load_refusal` is `tenant_not_empty`: `{ table, count }` for each table, where `count` is how many rows are outside the starting state (every row of a table that must be empty; the extras where activation leaves rows, such as companies beyond the first). `null` otherwise, and always on `?view=banner`.
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

## Onboarding
The workspace's angle and mode, and each user's first five steps. Every signed-in user of the workspace; every route answers `200` with the state for the calling user. Details, rules and audit events: [onboarding.md](onboarding.md).

- GET `/onboarding`
- PUT `/onboarding/choice` with `{ angle?, mode? }`
- POST, DELETE `/onboarding/steps/:key/done`
- POST, DELETE `/onboarding/dismiss`

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
  - On a running subscription with another price (monthly card to annual transfer), the annual period starts today (`billing_cycle_anchor: now`): the invoice carries the annual price less the credit for the unused month, payable within `INVOICE_PAYMENT_TERM_DAYS`. The same price keeps the period and only changes how it is paid.
- POST `/billing/change-plan` (card, running subscription) → the subscription summary plus `change: { status, invoice?, effective_at? }`
  - Body: `{ plan_key, subscription_type, terms_version }`. The invoicing details are copied to the Stripe customer first (complete details as at checkout, `VAT_NUMBER_INVALID` included; incomplete ones best effort).
  - Monthly to annual (any change other than annual to monthly): a new period starts today, the unused part of the current one is credited and the difference is invoiced and charged at once (`billing_cycle_anchor: now`, `proration_behavior: always_invoice`, `payment_behavior: pending_if_incomplete`). `status: 'paid'` with `invoice: { number, amount, currency, hosted_invoice_url }` (amount in cents) once paid; `status: 'requires_payment'` with the invoice when the card needs the customer (3-D Secure) or is refused: Stripe keeps the change pending and applies it only when that invoice is paid, and the local subscription is unchanged.
  - Annual to monthly: `status: 'scheduled'`, `effective_at` = end of the annual period. A Stripe subscription schedule keeps the annual price until then and bills the monthly price by card from that date; nothing is refunded.
  - Optional `success_url` and `cancel_url` in the body, as for `/billing/checkout` (the checkout URLs from the configuration otherwise): where the card setup page returns.
  - A bank transfer subscription (`send_invoice`) moves to card only once the customer has a card: the subscription's or the customer's default payment method, or a saved card (which becomes the customer's default). Without one, nothing changes and the answer is `status: 'requires_card'` with `setup_url`, a Stripe Checkout page in setup mode that saves a card and returns to `success_url` with `card_saved=<interval>` added; the billing page then reopens the plan dialog to confirm the change.
  - The current plan and interval while a switch is planned cancel the switch: `status: 'scheduled_change_cancelled'`, as `POST /billing/scheduled-change/cancel`.
  - 400 `PLAN_UNCHANGED` when the plan and interval are the current ones and no switch is planned; `NO_ACTIVE_SUBSCRIPTION` without a running subscription.
- POST `/billing/scheduled-change/cancel` (billing admin) → the subscription summary
  - Cancels a planned switch ("Keep annual"): releases the Stripe subscription schedule, so the subscription keeps its price and period, and gives a bank transfer subscription its transfer payment settings back. Audited on the subscription. Nothing planned: nothing changes. `NO_ACTIVE_SUBSCRIPTION` without a Stripe subscription.
- The subscription summary (`GET /billing/subscription`, `GET /billing/profile`) carries `scheduled_change: { interval, effective_at } | null`: the interval the subscription schedule switches to and when. It is read from Stripe on each refresh (these two endpoints force one) and is not stored, so a summary built without a refresh says `null`.
- Webhook `checkout.session.completed` in setup mode (the card setup page) makes the saved card the customer's default payment method.

## Companies
- GET `/companies?year=YYYY&status=enabled|disabled&page=1&limit=50&sort=name:ASC`
  - `year` is optional. When present it is a four-digit year from 1900 to 2999. Any other value is a 400 (`Year must be a four-digit year from 1900 to 2999.`). `/companies/ids`, `/companies/totals`, `/companies/export` and `/companies/import` use the same rule. Totals, export and import take the current year when `year` is omitted.
  - Response item fields include (in addition to company fields):
    - `headcount_year: number | null` (null when missing)
    - `it_users_year: number | null` (null when missing)
    - `turnover_year: number | null` (null when missing)
    - `metrics_frozen: boolean`
    - `metrics_frozen` reflects the `freeze-states` companies scope for that year
- GET `/companies/totals?year=YYYY` uses the same filters as the list. `headcount`, `it_users` and `turnover` are null when no company has that figure for the year. Entered zeros still total zero. `headcount` and `it_users` otherwise sum every company. `turnover` sums the turnovers converted into the reporting currency (`turnover_currency`) at the year's rates (the rate set the year is frozen at, else the live rates). A currency without a rate is left out of `turnover` and named in `turnover_fx_missing: [{ currency, year, companies }]`, where `companies` is how many companies of that currency had a turnover. Each row of the list stays in the company's own currency.
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
  - The report carries `notices: { dates: string | null, amounts: string | null }` (the one-line reading, for example "Dates read day first: 01/03/2027 is March 1.") and `ignoredColumns: string[]`, always empty for these files: a column KANAP does not know is a `row: 0` "Header mismatch. Missing: X, Extra: Y", naming only the parts that apply. Errors may carry a `code` and `params` for the interface to translate (`CSV_HEADER_MISSING_COLUMNS`, `CSV_HEADER_UNKNOWN_COLUMNS`, `CSV_HEADER_MISMATCH` with `params: { missing, extra }`; the account import's row codes `CSV_ACCOUNT_*`); `message` stays in English.
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
- POST `/admin/coa-templates/:id/accounts` → create row `{ account_number, account_name, native_name?, description?, consolidation_account_number?, consolidation_account_name?, consolidation_account_description?, status, nature? }` (`nature`: `opex`, `capex` or null for both)
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
account_number;account_name;native_name;description;consolidation_account_number;consolidation_account_name;consolidation_account_description;status;nature
```
Notes: only `account_number` and `account_name` are required in the header; the other columns may be absent (an update keeps the stored values, a new account takes the defaults). `native_name` is the original local-language label. `account_number` and `consolidation_account_number` are whole numbers from 1 to 15 digits; `status` is `enabled|disabled`; `nature` is `opex`, `capex` or empty.

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
- POST `/admin/coa-templates/:id/accounts` → create `{ account_number, account_name, native_name?, description?, consolidation_account_number?, consolidation_account_name?, consolidation_account_description?, status, nature? }` (`nature`: `opex`, `capex` or null for both)
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
- GET `/accounts/:id` → detail, with `consolidation_status` and `line_counts: { opex, capex }` (the OPEX and CAPEX lines, all statuses, that use the account)
- DELETE `/accounts/:id` (and `DELETE /accounts/bulk`): an account used by budget lines of either nature is refused, 409 `Cannot delete account "6000 - Licences": 2 OPEX item(s) reference this account; 1 CAPEX item(s) reference this account. Please disable instead or remove references first.` (in `failed[].reason` for the bulk delete)
- Accounts carry `nature` (`opex`, `capex` or null for both) on list, detail, POST and PATCH (`null` clears it, absent leaves it unchanged); the list filter on `nature` is a set filter where a blank value means null. A line write that creates a line or changes its account to an account of the other type is a 400: `This account is for CAPEX lines only. Choose an account for OPEX lines.` (swapped for the other side)
- POST `/accounts`, PATCH `/accounts/:id` and the CSV imports derive `consolidation_account_name` and `consolidation_account_description` from the consolidation chart's account of the given number; without a match (or without a consolidation chart) the values sent are kept, and a new number drops the name and description not sent with it; a null or empty number clears both. When an account of the consolidation chart is created, renamed, described or renumbered, or an account joins the consolidation chart (`coa_id`), every account mapped to its old or new number follows it (number, name, description) in the same transaction, one audit line per account. An account that leaves the consolidation chart takes nobody along (the accounts mapped to it become `outside`).
- GET `/accounts/export?scope=template|data&coaId=...&language=…`
  - Global export includes `coa_code`; when `coaId` is provided, export is scoped
- POST `/accounts/import?dryRun=true|false&coaId=...&language=…&dateOrder=…&decimalMark=…`
  - If `coaId` is not provided, the CSV must include a single uniform `coa_code` across all rows
  - Same shared master-data contract as `/companies/import`

CSV schema (Global):
```
coa_code;account_number;account_name;native_name;description;consolidation_account_number;consolidation_account_name;consolidation_account_description;status;nature
```
Validation/behavior:
- `account_number`: required, a whole number from 1 to 15 digits (`bigint`). A longer one is a row error with `code: CSV_ACCOUNT_NUMBER_TOO_LONG`; leading zeros are dropped and listed in `warnings: [{ row, column, code: CSV_ACCOUNT_NUMBER_LEADING_ZEROS, params: { value, stored }, message }]`
- `account_name`: required (English UI label)
- `native_name`: optional (local-language label); exported and visible in UI tooltip
- `consolidation_*`: optional; the number follows the `account_number` rules when present
- `nature`: optional last column, `opex`, `capex` or empty (both). An absent column leaves the stored natures unchanged; another value is a row error
- Every column but `coa_code` (without `coaId`), `account_number` and `account_name` may be absent from the header: an update keeps the stored values of an absent column, a new account takes the defaults (empty, `enabled`, both natures)
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
- RBAC: resource `cost_centers` (`reader` to view, `member` to create and edit, `admin` to delete, import and export). `GET /cost-centers/tree` and `GET /cost-centers/tree/count` also answer `budget` or `reporting` readers (item forms and budget reports).
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

## Data access (the person's own)
- GET `/data-access/placement-options` → the paying companies and cost centers the signed-in person may place a budget line on (data-scoped access, spec §2.3, §7.7; `backend/src/data-access/placement-options.ts`). Any signed-in person; not reserved, it reads nothing beyond the person's own access. A person with access to all data: `{ limited: false }`, with no query beyond the mode. A limited person: `{ limited: true, all, companies: string[], costCenters: [{ id, companyId }] }`, read from the edit settings of the request's transaction, the ones `data_access_placable_line` tests: `all` places anywhere, a company of `companies` takes any of its cost centers (or none), a cost center of `costCenters` takes its own company. The line's company and cost center pickers offer these only; the server still refuses any other placement (`403 DATA_ACCESS_LIMITED` "This company or cost center is not part of your access.").
- The line's dimension picker adds a value of an open dimension through POST `/analytics-categories/from-line` (see Analytics Dimensions and Values).

## Working-day Calendars
- RBAC: resource `working_day_profiles` ("Working-day calendars" in the UI). `GET /working-day-profiles`, `/ids`, `/countries`, `/:id` and `/:id/years/:year` answer `reader` on any of `working_day_profiles`, `budget` (the budget tab's quantity and price lines list the calendars); `member` creates and edits, and reads `/suggestions`; `admin` deletes, imports and exports.
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
- DELETE `/applications/:id` → 409 `APPLICATION_HAS_INTERFACES` (with `usages`) while the application is the source or target of an interface, and DELETE `/applications/bulk` lists it as a failed item with the same code; otherwise deletes it with its deployments and its links (owners, audience, links, attachments, data residency).
- POST `/applications/delete-check` with `{ ids: string[] }` [Requires: applications:admin] → `{ refused: Array<{ id, name, code, usages }>, removes: Array<{ type, total }> }`: the applications that are the source or target of an interface (`APPLICATION_HAS_INTERFACES`, `usages: [{ type: 'interfaces', total }]`), which both deletes refuse, and the deployments the others take with them (`removes: [{ type: 'app_instances', total }]`). Nothing is written.

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
- Relations tab: `GET /applications/:id/relations` (`applications:reader`) → one round trip for the tab: `{ year, budget_column: { key, label }, budget_lines, contracts, projects, requests, tasks, technologies, deployment_servers, processes, incidents, suggestions, also }`.
  - `year` is the current calendar year (UTC); `budget_column` the tenant's default budget column (`tenants.metadata.budget_columns.default_column`, `planned` by default).
  - `budget_lines: [{ id, item_number, nature, product_name, supplier_name, amount, currency, status }]`: `amount` is the line's newest version of `year` on the default column, converted to the reporting `currency` like the budget list; `null` without a version for the year.
  - `contracts: [{ id, name, supplier_name, end_date, yearly_amount, currency, auto_renewal, in_renewal_window, status }]`: `end_date` is the end of the current term; `in_renewal_window` is true when the contract is "to decide" under the tenant's decision window.
  - `projects: [{ id, item_number, name, status, planned_end }]`, `requests: [{ id, item_number, name, status, target_delivery_date }]`, `tasks: [{ id, item_number, title, status, assignee_name, due_date }]` (tasks linked to the application directly, `task_applications`; never through a linked project).
  - `technologies: [{ id, reference, name, family, declared, hosted, versions, version_unknown, standard_support_end, via: [{ asset_id, asset_name, host_name }], declarations: [{ link_id, technology_version_id, version_label }] }]`: one row per technology (lot T2a), from `TechnologyLinksService.technologiesOfApplication`. `declared` is a direct dependency (`application_technologies`, removable); `hosted` a technology carried by a server the application is deployed on, or by that server's host (`host_name`), through the technology reach (not removable). A technology both declared and hosted is one row with both flags. `versions` are the known version labels, `version_unknown` is true when a row has none, `standard_support_end` (`YYYY-MM-DD`) is the earliest standard end of support among those versions; `via` lists the servers of the hosted rows. Sorted by name.
  - `technologies[].declarations` are the application's own links of the technology, one per version declared (`version_label` null: unknown); `PATCH /technologies/:id/application-links/:linkId` changes the version of one.
  - `deployment_servers: [{ asset_id, name, asset_reference, environments, roles }]`: the servers the application is deployed on (`app_asset_assignments` of its instances), the hostings the reach counts (the server, the instance and the application in service), one row per server with the environments of its instances and its roles, by name. `null` with `technologies`.
  - `processes: [{ id, name, status, owner_name }]`: the business processes linked to the application (`application_business_processes`), `owner_name` their business owner. The screen shows them in the properties panel of the application (lot R1b).
  - `incidents: [{ id, item_number, title, status, severity, detected_at }]`: the incidents linked to the application (`incident_applications`) that the caller may see under the incident confidentiality rule, newest detection first; `title` is null for a confidential incident.
  - A section is `null` when the caller cannot read its module (`budget`, `contracts`, `portfolio_projects`, `portfolio_requests`, `tasks`, `infrastructure` for technologies, `business_processes` for processes, `incidents`). Projects, requests and tasks follow the Business Contributor participation scopes.
  - `suggestions: [{ type: 'budget_line' | 'contract' | 'project', id, item_number, name, via: { kind: 'same_supplier' | 'contract' | 'project' | 'task', label } }]`: active records not linked yet, at most 20 per rule: contracts and lines of the application's supplier, lines of a linked contract (`contract_spend_items` or `spend_items.contract_id`) or project (`portfolio_project_opex` or `spend_items.project_id`), projects that carry a linked task (`tasks.related_object_id` of type `project`, else the task's phase). `label` is the contract name, `PRJ-n` or `T-n`.
  - `also: { assets, interfaces, documents }`: distinct assets of the deployments, distinct interfaces listed by `GET /interfaces/by-application/:id` (an interface bound in several environments counts once; an interface the application is the source or target of counts even with no binding; 0 for a Business Contributor), knowledge documents the caller can read.
- Single links: `POST /applications/:id/relations/:kind` with `{ id }` and `DELETE /applications/:id/relations/:kind/:targetId` (`applications:member`, plus read access to the target module, else 403), `kind` ∈ `budget_lines`, `contracts`, `incidents`, `processes`, `projects`, `requests`, `tasks`, `technologies` → `{ ok: true, changed }`. `incidents` also needs `incidents:contributor` (403 otherwise) and writes through `IncidentRelationsService.setApplicationLink`: the incident must be visible to the caller (the same 404 for an unknown and a hidden confidential incident) and open (a closed or cancelled incident refuses the link and the unlink); the incident row is locked, the change is recorded in its journal and audited on `incident_applications`. `technologies` and `processes` also need `infrastructure:member` or `business_processes:member` (403 otherwise) and write through `TechnologyLinksService` (`declareApplicationTechnology` for a declaration, `setApplicationTechnology` for the removal of every declaration of the technology; `setProcessApplication`), idempotent and audited on the link table. An unknown technology or business process is a 404 (the convention of the technology layer), where the other kinds answer 400. The `technologies` section reads the application's declarations in every state of the application (a disabled one keeps them visible and removable; the Relations badge does not count them); its hosted rows follow the technology reach, which leaves out applications and instances out of service. The application's row is locked, the stored set is read and replaced through the existing replacement (same validation and audit) with one id more or less, so a link made meanwhile by someone else stays. A budget line's nature is read on the server. A project, request or task outside the caller's participation scope is a 400.
  - `technologies` takes its version in the same body: `{ id, technology_version_id? | version_label?, asset_ids? }` (`VersionChoice`, as `POST /assets/:id/technologies`: an existing version of the technology, else 400; a label resolved without case and created when missing; neither: version unknown). `asset_ids` records the technology at that version on deployment servers of the application (`deployment_servers`), in the same transaction, as manual installed links audited on `asset_technologies` (`recordId` the technology), and the vulnerabilities are matched again. A server that already has the technology installed, at any version, keeps its links. Any id that is not a deployment server of the application in service, in the tenant, is a 400 and nothing is written; so is `asset_ids` on a technology of family `operating_system` (marked from the server's page). With `asset_ids`, the answer adds `servers: { added, skipped }`.
- Requests: `POST /applications/:id/requests/bulk-replace` with `{ request_ids: string[] }` (`applications:member` and `portfolio_requests:reader`) → `{ ok: true, added, removed }`. Only the requests the caller can read are compared and changed; each request that gains or loses the application has its list replaced by the request service, which records the change in the request's activity.
- Helper: `GET /applications/:id/total-users?year=YYYY`

### Application classification and continuity (V1)
- `GET /applications/classification-summary` (same query parameters as the list: `q`, `filters`, `ownerUserId`, `ownerTeamId`, `include_inactive`; `applications:reader`, participant scope applied) → `{ total, reviewed, stale, incomplete }`, one aggregate over exactly the list's filters.
- `GET /applications/:id/recovery-dependencies` (`applications:reader`; refused to Business Contributors with a restricted scope, like interface routes) → `{ items: [{ interface_id (UUID), interface_reference, interface_name, direction ('source' | 'target' = role of the requested application), application_id, application_ref, application_name, recovery_wave }] }`: interfaces (not retired nor deprecated) to applications restored in a later wave.
- `GET /applications/classification-catalog` → tenant catalog: `businessCriticalityLevels` (with an optional `maxMtdMinutes` documenting each level), `cyberCriticalityLevels`, `dataClasses`, `recoveryWaves`; requires `applications:reader` or `infrastructure:reader` (the technologies' Compliance tab reads it too). Levels are returned from most to least severe and waves in restoration order; `rank`/`order` are assigned by the server from that order on every settings write. Deprecated options are included for historical reads and cannot be newly assigned.
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
  - `DELETE /app-instances/:instanceId`: a deployment still used by interface bindings or server assignments is refused with `409` `{ code: 'DEPLOYMENT_IN_USE', message, usages: [{ type: 'interface_bindings' | 'server_assignments', total }] }`; remove them first.
- Rules:
  - Environments are unique per application (`409` `deployment_environment_taken`, `params: { environment }`).
  - An unknown environment is `400` `deployment_environment_invalid` (`params: { value }`), an unknown lifecycle `400` `deployment_lifecycle_invalid`, an empty body `400` `body_required`.
  - Status resolves from `status` + `disabled_at` using shared lifecycle helper.

### Interfaces & Interface Bindings
- Interfaces (`/interfaces`)
  - `GET /interfaces?page&limit&sort&q&filters` supports filters for `interface_id`, `name`, source/target app names, `lifecycle`, `criticality`, `data_category`, `data_class`, `integration_route_type`, `business_process_id`, `contains_pii`, and optionally `environment` (via EXISTS on `interface_bindings.environment`, using a contains-style match so `qa` matches `QA`). Results include `bindings_count`, `environment_coverage`, and `binding_environments: string[]` (env codes with at least one binding).
  - `POST /interfaces` → `{ interface_id, name, business_purpose, business_process_id?, source_application_id, target_application_id, data_category, integration_route_type('direct'|'via_middleware'), lifecycle?, overview_notes?, criticality?, impact_of_failure?, business_objects?, main_use_cases?, functional_rules?, core_transformations_summary?, error_handling_summary?, data_class, contains_pii?, pii_description?, typical_data?, audit_logging?, security_controls_summary?, middleware_application_ids?: string[] }`
  - `PATCH /interfaces/:id` → accepts the same fields as `POST /interfaces` (all optional) and updates the interface; changing `integration_route_type` recreates legs (bindings cascade).
  - `DELETE /interfaces/:id` [Requires: applications:admin, as `DELETE /interfaces/bulk`] deletes one interface with its integrated documents; with bindings it is refused (`409` `INTERFACE_HAS_BINDINGS`) unless the body carries `deleteRelatedBindings: true`.
  - `POST /interfaces/delete-check` with `{ ids: string[] }` [Requires: applications:admin] → `{ refused: Array<{ id, name, code, usages }> }`: the interfaces with bindings (`INTERFACE_HAS_BINDINGS`, `usages: [{ type: 'interface_bindings', total }]`), which `DELETE /interfaces/bulk` refuses unless `deleteRelatedBindings: true`. Nothing is written.
  - `GET /interfaces/:id?include=relations,legs` → detail plus related owners/companies/dependencies/key identifiers/data residency/links/attachments and leg templates when requested.
  - `GET /interfaces/:id/legs` → `{ items: InterfaceLeg[] }` for the given interface.
  - `PATCH /interfaces/:id/legs` → `{ items: InterfaceLeg[] }` updates leg template fields for the given interface. Body: `{ items: Array<{ id: string; trigger_type?: string; integration_pattern?: string; data_format?: string; job_name?: string | null }> }`. Enum fields are validated against IT Ops settings.
  - `GET /interfaces/:id/relations` [Requires: applications:reader; refused to Business Contributors, like the other interface routes] → `{ upstream, downstream }`, each `Array<{ id, reference ('INT-n'), name, source_application_name, target_application_name, lifecycle }>` sorted by name. `:id` is a uuid or an `INT-n` reference. A dependency is one row on the interface that holds it: an upstream B of A does not list A downstream of B. Web links and attachments keep their own routes.
  - `POST /interfaces/:id/relations/:kind` with `{ id }` and `DELETE /interfaces/:id/relations/:kind/:targetId` [Requires: applications:member] link or unlink one interface, `kind` `upstream` or `downstream` → `{ ok: true, changed }`. Unknown kind 404 `Unknown relation type.`, invalid id 400 `Invalid id.`, the interface itself 400, a missing target 400 `One or more interfaces were not found.`, a missing interface 404. Linking what is linked, or unlinking what is not, changes nothing. A change writes the audit of `POST /interfaces/:id/dependencies/bulk-replace` (`interface_dependencies`, sorted `direction:id` before and after), under the interface lock.
  - `POST /interfaces/:id/links` (`{ description?, url }`), `PATCH /interfaces/:id/links/:linkId` and `DELETE /interfaces/:id/links/:linkId` [Requires: applications:member] write one web link. A link of another interface is 404 on `PATCH` and left alone on `DELETE`. `POST /interfaces/:id/links/bulk-replace` stays for the other callers.
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
  - `GET /connections/by-server/:serverId` → the Network tab of an asset: the connections where the asset is a source, a destination, a server of a multi-server connection or the equipment of a hop, directly or through one of its clusters (`effectiveConnectionAssetsSql`, `backend/src/connections/effective-connection-assets.ts`: a retired member inherits nothing, a retired cluster passes nothing on, a cluster sees nothing of its members). Same list shape as `GET /connections` (protocol labels, source/destination labels, multi-server count, risk fields), plus:
    - `asset_roles`: `[{ part: 'source'|'destination'|'server'|'hop', hop_order, inherited, via_clusters }]`, every place the connection names the asset, sorted source, destination, server, hop, then hop order, direct before inherited; `hop_order` is null except for a hop.
    - `inherited`: true when every role comes through a cluster.
    - `via_clusters`: `[{ id, name }]`, the union of the clusters that give the roles, by name (a role both direct and inherited keeps its cluster here).
    - `servers`: for a multi-server connection, the stored servers `[{ id, name, asset_reference, is_cluster }]` by name; `[]` otherwise.
    No paging (single-asset scope).
  - `GET /connections/:id` → detail including protocol codes, risk fields, aggregated effective risk (`effective_*`, `derived_interface_count`), (for multi-server) the connected servers list, and optional `legs` when `include=legs` is provided.
  - `GET /connections/:id/legs` → the hops of the connection by `order_index`. `POST /connections/:id/legs`, `PATCH /connections/:id/legs/:legId`, `DELETE /connections/:id/legs/:legId` and `POST /connections/:id/legs/:legId/swap` write them. Each hop returned by `GET`, `POST` and `PATCH` (and each of `legs` on `GET /connections/:id?include=legs`) carries `equipment_asset`, the summary of its equipment asset `{ id, name, asset_reference, environment, kind, provider, is_cluster }`, or null without one (no equipment, or an entity). A hop's equipment may be a cluster: the hop then counts for its members in service.
  - `GET /connections/:id/interface-links` → linked interface bindings (interface, environment, leg, endpoints, lifecycle/status) for the connection.
  - `POST /connections`
    - Body: `{ connection_id, name, purpose?, topology: 'server_to_server'|'multi_server', source_server_id?, source_entity_code?, destination_server_id?, destination_entity_code?, servers?: string[], protocol_codes: string[], lifecycle?, notes?, criticality?, data_class?, contains_pii?, risk_mode?('manual'|'derived') }`
    - Validation: at least one protocol; lifecycle from IT Ops lifecycle list (default `active`); `server_to_server` requires exactly one participant per side (server XOR entity), and the same asset on both sides is a `400` with `code: 'connection_same_endpoint'` (an existing loop can still be renamed, but a change of a side may not keep it looped); `multi_server` drops from `servers` the members in service of a cluster in service the list also holds (`absorbClusterMembers`, `backend/src/connections/connection-cluster-rules.ts`), then requires ≥2 assets (`400`, `code: 'connection_min_servers'`). The answer of `POST` and `PATCH` carries `absorbed: [{ asset_id, name, cluster_id, cluster_name }]` (`[]` when nothing was dropped). A side or a server may be a cluster: the connection counts for its members in service. Risk fields validated against IT Ops settings; `risk_mode` accepts `manual|derived` but `derived` is rejected on create (connections start in manual mode until interfaces are linked).
    - Protocol codes must exist in IT Ops **Connection Types** (also surface typical ports in UI).
  - `PATCH /connections/:id` → same shape as POST (all optional); protocols/servers use replace semantics. Setting `risk_mode = 'derived'` is allowed only when at least one `interface_connection_link` exists for the connection.
  - Hop body (`POST` and `PATCH /connections/:id/legs`): `{ order_index?, function_code?, equipment_asset_id?, equipment_entity_code?, protocol_codes?, port_override?, notes? }`; `function_code` from IT Ops `pathHopFunctions`, `protocol_codes` from Connection Types, an `order_index` already used is a `400`.
  - `DELETE /connections/:id`
  - `DELETE /connections/bulk` (admin only) with body `{ ids: string[] }`
  - `GET /connections/map?environment=prod&lifecycles=active` → returns `{ environment, lifecycles, nodes: [{ id, name, kind:'server'|'cluster'|'entity', is_cluster?, environment?, hosting_category?, graph_tier?, member_server_ids?, implicit_member? }], connections: [{ id, connection_id, name, topology, lifecycle, criticality, data_class, contains_pii, protocol_codes, protocol_labels, source_server_id, source_entity_code, destination_server_id, destination_entity_code, server_ids: string[], legs?: [{ id, order_index, layer_type, source_server_id, source_entity_code, destination_server_id, destination_entity_code, protocol_codes, protocol_labels, port_override, notes }] }], clusterMemberships: [{ cluster_id, server_id }] }`. `criticality`, `data_class`, and `contains_pii` on the map payload reflect effective (aggregated) risk where `risk_mode = 'derived'`. When legs exist, clients render one edge per leg; otherwise they use the S2S/mesh fallback. Nodes are the participants plus the members in service of each cluster node, even when no connection names them (`implicit_member: true` on those; `false` on a participant). `member_server_ids` lists a cluster's members in service. Multi-server edges are expanded client-side when the toggle is enabled. Tier semantics: servers/clusters use environment-scoped app role assignments (highest user-facing priority wins for multi-role assets), entities use IT Ops `entities.graph_tier`; fallback is `center` for unassigned servers/clusters and `top` for entities.
- RBAC: uses `applications` resource (`reader` list/detail; `manager` create/update/delete; `admin` bulk delete).

### Assets & App Server Assignments
- Assets (`/servers` — endpoint name preserved for backward compatibility)
- Tenant scope: all assets endpoints require tenant context and explicitly filter by `tenant_id` (defense-in-depth in case RLS is bypassed in dev).
- `GET /servers?page&limit&sort&q&filters` supports environment/kind/provider/status/cluster/is_cluster/admin_zone filters and returns `assignments_count` and cluster membership context (`cluster`: the names of the real clusters of a member, from `asset_cluster_members`, by name then id; the legacy `assets.cluster` text is never read). The `cluster` set filter takes cluster names, `__cluster__` (the clusters themselves) and `null` (plain assets in no cluster), joined by OR; sorting on `cluster` gives one row per asset. Search (`q`) matches name, hostname, fqdn, and aliases. The list includes `admin_zone` (hidden by default on the screen). With `include=member_names`, each cluster row also carries `member_names`, its members by name (one read for the page; the server picker uses it).
- `POST /servers` → `{ name, kind, provider, environment, region?, zone?, hostname?, ip_addresses?, is_cluster?, status?, operating_system?, location_id?, domain?, admin_zone?, aliases?: string[] }`. `operating_system` is the readable label of the marked technology (`Windows Server 2019`, `Ubuntu 22.04 LTS`, `Cisco Meraki`). A write resolves it to that link (an old shipped code such as `windows_server_2019` still works). `null` or an empty string clears the mark. The column `assets.operating_system` is gone. `admin_zone` (nullable) is a code of the IT Ops catalog `adminZones`; a write also accepts the zone's name; an unknown value is a `400`.
- `PATCH /servers/:id` → same fields; `fqdn` is computed server-side from `hostname` + domain's `dns_suffix`
- IP addresses structure:
  - `ip_addresses`: Array of `{ type, ip, subnet_cidr }` entries, or `null`
  - `type`: IP address type code from IT Ops Settings `ipAddressTypes` (e.g., `host`, `ipmi`, `management`, `iscsi`)
  - `ip`: The IP address string (validated to belong to the subnet if `subnet_cidr` is set)
  - `subnet_cidr`: Optional subnet CIDR from IT Ops Settings subnets list; network zone and VLAN are derived from subnet at display time
- Identity fields (Technical tab):
  - `hostname`: Asset hostname; required when `domain` is set to a non-system domain
  - `domain`: Domain code from IT Ops Settings domains list (e.g., `corp-ad`, `workgroup`, `n-a`)
  - `admin_zone`: Administration zone code from IT Ops Settings `adminZones` (nullable); listed hidden by default, sortable and filterable
  - `fqdn`: Read-only, computed as `{hostname}.{dns_suffix}` or just `hostname` if dns_suffix is empty
  - `aliases`: Array of additional DNS names/aliases; stored as `text[]`
- Cluster membership
  - `GET /servers/:id/members` (cluster only) → list of member servers.
  - `POST /assets/:id/members` body `{ asset_ids: string[] (or server_ids), remove_operating_system?: boolean }` replaces membership. Coded 400 refusals: `cluster_member_self`, `cluster_member_not_found` (unknown in the tenant), `cluster_member_is_cluster` (`params.name`), and `cluster_os_with_members` (`params.os`) when a non-empty list is sent to a cluster that has an operating system. With `remove_operating_system: true` that operating system is removed in the same transaction (its own audit entry).
  - The Cluster switch (`is_cluster` through PATCH, the assistant or the CSV import): a cluster with members cannot become a plain asset (`cluster_has_members`, `params.count`), a member of a cluster cannot become a cluster (`cluster_switch_member`, `params.cluster`). The switch never changes the operating system. A cluster with members has no operating system: writing one is refused (`os_cluster_with_members`), clearing is accepted; a cluster with no member keeps or takes one. The CSV import reports the same codes as row errors, at the check and at the load.
  - `POST /assets/delete-check` `{ ids }` → `{ refused, warnings }`. `warnings` never refuse: per asset, `member_of` (`{ id, name }` of its clusters), `member_count` (its own members), `stops_hosting` (the distinct names of the applications it hosts through its clusters, inherited assignments only), `relations` (the first ten related assets, `{ id, name, relation_type, direction }`) and `relations_total`. A delete audits what the cascade removes: an `asset_cluster_members` update on each cluster the asset left, an `asset_relations` update on each asset that held a relation to it; its own members and relations are in its delete entry (`before.members`, `before.relations`).
  - `GET /servers/:id/clusters` (host only) → clusters that include the server.
  - `GET /servers/:id`, `PATCH /servers/:id`
- Impact ("if this server goes down")
  - `GET /assets/:id/impact` (`infrastructure:reader`) → `{ asset, assets, clusters, applications, technologies, processes, totals }`, read in one request.
  - A failure spreads from a container to what it contains (`contains`), from an asset to the assets that depend on it (`depends_on`), and from a cluster that falls to all its members in service (`member`, an edge counted in neither bound). Each kind of edge is followed at most 3 times on a path, never twice through the same asset. The walk goes level by level, one statement per level for the whole frontier.
  - A retired asset (`status` `retired`) is never crossed: it does not fall, nothing falls through it, it counts for no cluster, and no application, technology or process is read from it. A retired asset asked for directly is listed alone at depth 0.
  - `assets`: `{ id, reference, name, kind, depth, relation, via: [{ id, name }] }`, the asset itself first (`depth` 0, `relation` null), then each fallen asset once with its shortest path (`via` = the fallen assets from the server to its parent; `relation` = the last edge), nearest first, then by name.
  - `clusters`: clusters with a fallen member, `{ id, reference, name, state: 'degraded' | 'down', members, fallen_members, applications, via, via_total }` (`applications`: how many applications are assigned to the cluster itself, `null` without `applications:reader`); `down` when no member stands. A fallen member does not take its cluster. A cluster down takes the applications assigned to it and what it contains (a new walk from it, `via` ending with the cluster, until no new cluster goes down, at most 3 rounds); a degraded cluster takes nothing. A cluster down is listed here, not in `assets`.
  - `applications`: `{ id, reference, name, criticality, environments, via, via_total }`, one row per application with an in-service instance on a fallen asset (`environments` of those instances, production first); `null` without `applications:reader`, a Business Contributor's own applications only.
  - `technologies`: technologies installed on a fallen asset, `{ id, reference, name, versions, via, via_total }`.
  - `processes`: in-service business processes of the affected applications, `{ id, name, via, via_total }` (`via` = applications); `null` without `business_processes:reader` or without the applications.
  - Caps: each list keeps its first 200 rows (`assets`: the server plus 200), each `via` of a cluster, application, technology or process its first 20 names (`via_total` counts them all). `totals: { assets, applications, clusters, technologies, processes }` gives the full counts (`assets` without the server, 0 for a list the caller cannot read).
  - `404` for an unknown asset or one of another tenant.
- Relations tab (`backend/src/assets/asset-relations-tab.service.ts`, lot R2h); `:id` is a uuid or `AST-n`, `404` for an unknown asset or one of another tenant.
  - `GET /assets/:id/relations-tab` (`infrastructure:reader`) → `{ year, budget_column: { key, label }, assets, budget_lines, contracts, projects, tasks, incidents, counts }`, read in one request. `GET /assets/:id/relations` keeps its `{ outgoing, incoming }` shape.
  - `assets`: `{ contains, contained_by, depends_on, depended_on_by }`, each a list of `{ id, reference, name, kind, environment, status }` by name (`asset_relations`: `contains` and `depends_on` are held by this asset, `contained_by` and `depended_on_by` by the other one). A row of `contains` whose asset has other containers in service carries `also_contained_by: [{ id, name }]` (R3 of the placement rules).
    On a cluster, `assets` also carries `depends_on_through_members`: the assets its members in service depend on, each a `depends_on` row plus `via: [{ id, name }]` (those members, by name). It leaves out the cluster itself, its own members and the assets the cluster already depends on directly; a retired cluster returns an empty list. These rows are read-only and stay out of `counts.assets`. The field is absent on any other asset.
  - `budget_lines` (OPEX and CAPEX, `{ id, item_number, nature, product_name, supplier_name, amount, currency, status, fx_missing? }`, the amount on the tenant's default budget column for the current year) needs `budget:reader`; `contracts` (`{ id, name, supplier_name, end_date, yearly_amount, currency, auto_renewal, in_renewal_window, status }`) `contracts:reader`; `projects` (`{ id, item_number, name, status, planned_end }`) `portfolio_projects:reader`; `tasks` (`{ id, item_number, title, status, assignee_name, due_date }`, open ones first) `tasks:reader`; `incidents` (`{ id, item_number, title, status, severity, detected_at }`, confidential ones by the register's rule, without title) `incidents:reader`. A section without its read is `null`. A Business Contributor sees the projects and tasks they take part in.
  - `counts`: `{ assets, budget_lines, contracts, projects, tasks, incidents, links, attachments, total }`, the rows the answer shows (a `null` section counts 0) plus the asset's web links and attachments; `total` is the Relations badge and leaves out `assets`, which feeds the Dependencies badge.
  - `POST /assets/:id/relations/:kind` `{ id }` and `DELETE /assets/:id/relations/:kind/:targetId` (`infrastructure:member`) → `{ ok: true, changed }`, one link at a time; linking what is linked, or unlinking what is not, changes nothing and writes nothing. Kinds: `contains`, `contained_by`, `depends_on`, `depended_on_by`, `budget_lines`, `contracts`, `projects`, `tasks`, `incidents`; another is `404` `Unknown relation type.`. A kind other than the four directions needs the read of its module (`403`); an incident also needs `incidents:contributor`. A bad id is `400` `Invalid id.`.
  - Directions: written on the asset that holds the relation, under its row lock, audited on `asset_relations` (`recordId` that asset, `{ relations }` before and after). An asset cannot relate to itself (`400`); a missing asset is `400`; no cycle check.
  - Placement (`backend/src/assets/placement-rules.ts`), for a `contains` or `contained_by` link and for `POST /assets/:id/relations` (bulk replacement) when it adds a `contains`: a `contains` written by a cluster in service replaces the `contains` of its members in service towards the same assets, each removal audited on the host (R1); a `contains` from a host in service towards an asset one of its clusters in service already contains is `409` `{ code: 'placement_inherited', params: { cluster } }` (R2; a link already stored is written again without refusal). The answer adds `replaced_host_links: [{ host_id, host_name, asset_id, asset_name, cluster_id, cluster_name }]` and `double_containers: [{ asset_id, asset_name, containers: [{ id, name }] }]` (the assets now held by two containers in service, R3), each only when not empty. The bulk replacement absorbs only the `contains` it adds. Lock order: the clusters (`lockAssignmentClusters`), the source asset, the hosts whose links are removed.
  - Budget lines, contracts and projects: one row under the asset row lock, audited on `asset_spend_items` (`asset_capex_items` for a CAPEX line), `asset_contracts` or `asset_projects`, `recordId` the asset, `{ ids }` of the sorted ids (a budget line: the ids of its nature). A missing target, or a project outside a Business Contributor's participation, is `400`.
  - Tasks: the task service replaces the set plus or minus one task, recorded in the task's activity; a missing task, or one outside a Business Contributor's participation, is `400`. Incidents: the incident's own service (`link_change` journal entry, incident row lock; a closed incident is `403`, an incident the viewer cannot see is `404`).
- Delete
  - `DELETE /servers/:id` (admin) — blocked with `409 Conflict` if the server has any app assignments or is referenced by any connection (including multi-server and leg participants); the message lists sample related items.
  - `DELETE /servers/bulk` (admin) body `{ ids: string[] }` → `{ deleted: string[], failed: [{ id, name, reason }] }` with the same conflict rules.
- App Server Assignments
  - `GET /applications/:applicationId/deployment-servers` (`applications:reader`; the id or the reference `APP-n`) → `{ items, groupable }`: the server assignments of every deployment of the application in one call (the Deployments tab), each row as in `GET /app-instances/:instanceId/servers` and naming its `app_instance_id`, by server name. Only stored rows come in `items`; a cluster's row lists the members in service that inherit it in `members` (`[]` on any other row). `groupable`: the deployments and roles assigned directly to every member in service of a cluster that has at least two, as in `GET /assets/:assetId/assignments/groupable`. A Business Contributor reads only the applications they take part in; an unknown or hidden application is `404`.
  - `GET /app-instances/:instanceId/servers` → assignments for a given app instance (with joined server metadata)
  - `POST /app-instances/:instanceId/servers` → `{ server_id, role, since_date?, notes? }` (unique per `(instance, server, role)`). The server may be a cluster: its members in service inherit the row when read. A row written to a cluster in service replaces, in the same transaction, the direct rows of the same deployment and role on its members in service (each deletion audited); it keeps the earliest `since_date` and adds their distinct notes after its own, one per line. The answer is the row plus `absorbed: [{ asset_id, name }]`, the members whose row it replaced, by name (`[]` otherwise). A create on a cluster that already carries the deployment and role absorbs its members' identical rows into that row and answers it; with nothing to absorb it is `409` `assignment_duplicate`. `PATCH` answers the same way and applies the same rules when the row changes server or role. Refusals carry a code: `body_required`, `asset_required` (no server), `assignment_role_invalid` (a role outside the server roles catalog), `date_invalid`, `409` `assignment_duplicate`, `409` `assignment_inherited` (`params.cluster`: a member already has this deployment and role through that cluster). The assistant follows the same rules.
  - `DELETE /app-instances/:instanceId/servers/:assignmentId`
  - `GET /servers/:serverId/assignments` (also `GET /assets/:assetId/assignments`) → an array: the assignments from the server perspective, a member's rows inherited from its clusters included (`inherited`, `via_clusters`; a retired cluster passes nothing on). Each direct row of a member also carries `groupable`, the set of its cluster it belongs to (`{ cluster_id, cluster_name, member_ids }`), else `null`.
  - `GET /assets/:assetId/assignments/groupable` (`applications:reader`) → `{ items }`: for a cluster, the deployments and roles assigned directly to every member in service (`{ cluster_id, cluster_name, app_instance_id, role, application_id, application_name, environment, member_ids }`), limited to the applications a Business Contributor takes part in; `[]` for any other server. Assigning the cluster to one of them (`POST /app-instances/:instanceId/servers`) replaces the members' rows, also when the cluster already carries that deployment and role.
  - `POST /app-server-assignments/servers-by-apps` → `{ applicationIds: string[], environments: string[] }`
    - Returns unique servers assigned to app instances for the given applications and environments.
    - Response: `{ items: [{ id, name, environment, kind, provider, is_cluster }] }`
    - Used by Connection Map for app-based server selection.
  - Instance-facing list responses expose a `hosting` object derived from the assigned server's location (or the default cloud hosting type) for read-only display.

RBAC: All of the above share the `applications` resource.

### Netbox inventory
Import of a tenant's Netbox inventory into the assets. Design, rules and every route: `doc/features/components/netbox-inventory.md`. Resource `infrastructure:admin`. Only the routes changed by the cluster matching are listed here.
- GET `/netbox/mapping-options` → the Netbox roles, sites, platforms and clusters next to what KANAP can match them with, the saved maps and a suggestion for each entry with no saved match. Clusters: `clusters: [{ id, name, vm_count }]` (keyed by Netbox id), `clusters_unavailable` (the token could not read them; the rest of the response is unaffected), `kanap_clusters: [{ id, name }]` (the tenant's assets with `is_cluster`, not retired, by name), `cluster_map` (Netbox cluster id → asset id), `cluster_names` (Netbox cluster id → the Netbox name saved with the match), `suggested_cluster_map` (only one KANAP cluster with the same name, without case).
- PUT `/netbox/mapping` → `{ role_map, site_map, os_map?, cluster_map?, cluster_names? }`. `role_map` and `site_map` are required and replaced in full. `os_map` and `cluster_map` are replaced in full when sent and kept when left out. Every `cluster_map` value must be an asset of this tenant with `is_cluster`, not retired: otherwise `400` with a plain reason, and nothing is saved. `cluster_names` is kept only for the ids of `cluster_map`; an id with no name sent keeps the stored one.
- POST `/netbox/sync/preview` → also `notices`: one notice per Netbox cluster whose virtual machines cannot be attached (`cluster_not_mapped`, `cluster_match_invalid`). A row of a virtual machine to add to its cluster carries the diff `{ field: 'cluster', before, after }` (`before`: the clusters that already contain it, or `null`) and, when another cluster holds it, the notice `cluster_other_present`.

### Technologies
What the IT runs or subscribes to for the applications (SQL Server, Entra ID, vSphere), lot S of planning/cartographie-technologies.md. Resource `infrastructure`: reads `reader`, writes `member`, deletes `admin`. Every statement carries the tenant besides RLS; a technology of another tenant is a `404`. `:id` takes the UUID or the reference `TEC-n`.
- GET `/technologies?family&editor&lifecycle&hosting_type&q&sort&direction&limit&offset` → `{ items, total, limit, offset, page }`. The list grid's parameters are accepted too: `page` (from 1) instead of `offset`, `sort` as `field:DIR` (`name:DESC`), and `filters`, the grid's JSON model: its set filters on `family`, `editor`, `lifecycle` and `hosting_type` narrow like the plain parameters (`null` ticked: no value), its text filters on `name` and `reference` (`contains`, `notContains`, `equals`, `notEqual`, `startsWith`, `endsWith`, `blank`, `notBlank`, without case) narrow the name and the `TEC-n` reference. `sort` takes `name`, `editor`, `family`, `lifecycle`, `reference` or `updated_at`. Each item is the technology with `reference`, `owner_names` (IT owners first), `it_owner_names` and the counters of the page, computed in one statement: `servers` (assets in service it is installed on, a direct link, clusters excluded; what the asset graph carries does not count), `applications` (hosted or declared), `versions_in_use`, `next_support_end` (earliest standard end of support to come among the versions in use) and `ended_versions`; while the vulnerability feed is on, `vulnerabilities_to_review` (distinct CVE still `to_review` on a row that alerts) and `vulnerabilities_severe` (those critical or high), `null` otherwise. A row alerts when its version's own setting says so, or the technology's setting when the version has none or the row names no version. A CVE that also matches a silent row still counts while one alerting row remains. `family`, `editor`, `lifecycle` and `hosting_type` take one value or a comma list; `editor` compares without case.
- GET `/technologies/lookup?q&limit&ids` → the picker contract of `useLookupPicker` (`{ items: [{ id, name, editor, family, reference, lifecycle }], has_more }`); retired technologies are not offered when searching.
- GET `/technologies/ids?sort&q&filters&family&editor&lifecycle&hosting_type` → `{ ids, refs, total }`: the whole list (up to 10 000 rows) with the list's filters, in its order (`refs` are the `TEC-n` references); the record's previous / next band reads it.
- GET `/technologies/filter-values?fields=editor,family,lifecycle,hosting_type` → `{ <field>: values[] }`: the values the list's set filters offer, the tenant's own and all of them (editors once each without case, `null` for a technology without one).
- GET `/technologies/editors?q` → `{ items: string[] }`: the tenant's editors and the catalog's, deduplicated without case, at most 50.
- GET `/technologies/catalog?q&family&language` → `{ items: [{ key, name, editor, family, hosting_type, cpe_products, versions, latest_version, description, completes }], adopted: [{ key, name, editor, family, family_label, reference, id }] }`: the entries of the shipped catalog (`backend/src/technologies/catalog/technologies.catalog.json`, from endoflife.date, MIT license; its CPE identifiers checked against the NVD dictionary with `scripts/technologies/build-catalog.mjs --check-cpe --nvd`) the tenant has not adopted (no technology with that catalog key, and no technology of that name already tied to the catalog). A technology typed under the entry's name and still free of a catalog key keeps the entry on offer: `completes` is that technology's reference (`TEC-<item_number>`), compared without case, or null. The catalog file says `mode` per entry, `installed` or `subscribed`, and may name a `hosting_type` (the managed Kubernetes services are `public_cloud`; `scripts/technologies/build-catalog.mjs` writes it from its product list, `--refresh-cpe-versions` included); `hosting_type` in the answer is the type the adoption writes: the entry's, else `on_prem` for `installed` and `saas` for `subscribed`, resolved against the tenant's hosting types (a code the tenant's catalog lacks gives its first type in use of the same category). `versions` and `latest_version` count the living catalog: the shipped versions plus the cycles endoflife.date published since, from the platform cache of the `technology-catalog` task (see `doc/architecture.md`, "Living catalog"). `adopted` lists the entries the tenant already adopted (a technology holds the catalog key) that match the same `q` and `family`, sorted by name; `reference` is that technology (`TEC-<item_number>`) and `id` its row. It is empty when `q` is blank, so an empty search does not return every technology the tenant already has. `items` stays the entries still on offer.
- POST `/technologies/adopt` `{ catalog_key, language? }` → `{ ok, created, versions_added, technology: { id, name, reference } }`: creates the technology with its editor, family, hosting type (as the catalog list gives it), CPE identifiers and short description, and the versions of the living catalog with their dates (`technology_versions.catalog_key` set: the version comes from the catalog), and records what it offered in `technologies.catalog_state` (not returned by the API). From then on the daily `technology-catalog` task adds the versions and identifiers the catalog gains, removes an identifier the shipped file no longer lists when `catalog_state.shipped_cpe` recorded it, `catalog_state.cpe_written` records that the catalog wrote it, and the technology still holds it, and moves the dates and `cpe_version` the catalog wrote and the tenant left as they were. A description the catalog wrote and the tenant left unchanged (the same characters) follows the catalog's new text in `catalog_state.description_language`, the language it was written in. The state and the audit move only for a row the update changed. A change of the tenant's language rewrites nothing. A state without `description_language` takes the language whose catalog text equals the remembered description, and is not rewritten when none does. A value the tenant changed, a version or identifier the tenant deleted, and an identifier the tenant added stay as the tenant left them. An endoflife.date answer or a stale cache that omits an identifier removes nothing: the identifier stays until the shipped file itself drops it. A shipped file that lists no identifier without `noCpe` withdraws nothing. The description (`backend/src/technologies/catalog/technologies.descriptions.json`, written for KANAP in `en`, `fr`, `de`, `es`) is in `language`, failing that the user's stored language, failing that English; the catalog list gives it in the same language. Another `language` is a `400`. Idempotent: an adopted entry returns its technology and adds nothing (a version the tenant deleted stays deleted); a technology of the same name receives the catalog key, the missing identifiers and versions, and the description when it has none. `catalog_key` is written by the adoption only. The identifiers the catalog gained when checked against the NVD reached the technologies adopted before through migration `1854300000000` (identifiers added; the MongoDB identifier the NVD does not know removed; `cpe_version` set where empty for Exchange Subscription Edition); their vulnerabilities follow at the next scheduled run of the feed, which reads every CVE of a product it did not follow yet, with no rematch needed. Since the living catalog (lot C4), the versions, identifiers, dates and `cpe_version` a later shipped catalog adds reach the adopted technologies at the first start of the new version, without a migration. Since lot C5, an identifier the shipped file withdraws or replaces is removed at that same start when `catalog_state.shipped_cpe` listed it, `cpe_written` records that the catalog wrote it, and the technology still holds it. An identifier the tenant typed, or held before the adoption, is not withdrawn. An identifier that came from the endoflife.date cache is not removed when the cache omits it. The audit row of the sync (`system`, `technology-catalog`) also names `cpe_products_removed` and `description_updated`. The scheduled task summary counts the identifiers removed (`cpe_removed`) and the descriptions replaced (`descriptions_updated`). Technologies whose identifiers changed are matched again with the vulnerability cache, the same way as a manual edit, so the rows of a removed product disappear. `build_prefixes` still change only on a version the sync creates or attaches. `1854300000000` stays for the installations it already ran on.
- POST `/technologies` and PATCH `/technologies/:id` with `{ name, editor?, family?, hosting_type?, lifecycle?, description?, notes?, support_notes?, cpe_products?: string[], replaced_by_id?, cyber_criticality?, recovery_wave?, rto_minutes?, rpo_minutes?, admin_zone? }`. `family` comes from the IT Ops catalog `technologyFamilies`, `hosting_type` from `hostingTypes` (the hosting types of the locations, each `on_prem` or `cloud`; a technology always has one: `on_prem` when a create omits it, or the tenant's first type in use on premises when its catalog lacks that code; migration `1854310000000` filled it from the former `mode`, installed `on_prem`, subscribed `saas`, and removed `mode`; a body that still sends `mode` is a `400` "mode is replaced by hosting_type."; a hosting type a technology uses cannot be removed from the catalog), `admin_zone` (nullable) from `adminZones`, `lifecycle` from `lifecycleStates`, the classification fields from the classification catalog. A CPE product is `part:vendor:product` (`a:microsoft:sql_server`, `o:vmware:esxi`), stored in lower case, punctuation escaped with a backslash as the NVD writes it (`a:veeam:veeam_backup_\&_replication`). The name is unique per tenant without case (`409`, code `duplicate`). A replacement that leads back to the technology (A by B, B by A) is a `400`. A create may also send `vulnerability_alerts` (`true` or `false`; another value is a `400`). When it is absent, an operating system or a cloud service starts excluded and every other technology included (the operating-system mark follows the same rule for the family it writes). A cloud service is a technology whose `hosting_type` is of the `cloud` category of the tenant's hosting types (a code outside the list is on premises only for `on_prem` and `colocation`); the adoption of a catalog entry of mode `subscribed` (such as `entra-id` or `azure-kubernetes-service`) also starts excluded, whatever hosting type the tenant's list gives it. The conversion of an application follows the hosting type it writes. The adoption of a shipped operating system (`almalinux`, `centos`, `debian`, `oracle-linux`, `rhel`, `rocky-linux`, `sles`, `ubuntu`, `windows-server`) excludes the technology whatever its family: a new one under `other`, or a typed one adopted by its name (its version exceptions stay). A later change of family or of hosting type leaves the setting as it is. PATCH of the technology refuses `vulnerability_alerts` with a `400` "vulnerability_alerts is set with PUT /technologies/:id/vulnerability-alerts." (the PUT below also clears the version exceptions).
- PUT `/technologies/:id/vulnerability-alerts` `{ enabled: boolean }` (`infrastructure:member`) sets the technology's setting and clears every version exception in the same transaction (the technology row is locked first, then the versions that have their own setting). It returns `{ enabled, versions_reset }`. The change of the technology is audited on `technologies`, and each cleared exception as an update of its version on `technology_versions`, as a PATCH of the version writes it. `versions_reset` counts the versions whose setting was `true` or `false` (a version that already followed the technology is left out). `dry_run=true` (the query, or `dry_run: true` in the body; the query wins when it is sent) writes nothing, records nothing, and returns `{ versions_reset }` only. `enabled` is still required. `dry_run` other than `true` or `false` is a `400`.
- GET `/technologies/:id` → the technology with `versions` (each with `servers` and `applications` that name it directly, retired assets included, and `server_count`, its servers counted as the list counts them: in service, the version installed on them, clusters excluded), `owners` and `replaced_by`. The technology carries `vulnerability_alerts`. Each version carries `vulnerability_alerts` (its own setting, `null` when it follows the technology) and `vulnerability_alerts_effective` (the version's exception, or the technology's setting). Versions come newest number first (`11.0`, `10.1`, `9.0`; `2019`, `2016`), compared segment by segment on the label's numeric prefix, then the labels without a number in alphabetical order (`backend/src/technologies/version-order.ts`); GET `/technologies/:id/versions` uses the same order.
- POST `/technologies/delete-check` `{ ids }` → `{ refused: [], removes: [{ type, total }] }`: what a delete takes with it (servers and applications links, contracts, budget lines, projects, incidents, documents). DELETE `/technologies/:id` and DELETE `/technologies/bulk` `{ ids }`.
- Versions: GET/POST `/technologies/:id/versions`, PATCH/DELETE `/technologies/:id/versions/:versionId` with `{ label, cpe_version?, build_prefixes?: string[], standard_support_end?, extended_support_end?, notes?, vulnerability_alerts? }`. PATCH accepts `vulnerability_alerts` as `true`, `false` or `null` (follow the technology); another value is a `400`. When the technology carries a CPE product of `SERVICE_PACK_PRODUCTS` (`backend/src/vulnerabilities/vulnerability-rules.ts`) and the patched version is a base release (`servicePackOf(label)` is null: `11`, `15`), the same value is written in that transaction on each service pack of the release (`11 SP1`, `15.5`: the same major, `servicePackOf` set). The versions are read once, then updated in one statement (`tenant_id`, `technology_id`, `id = ANY`). Each pack whose stored value changes is audited as an update of its version, the same way a PATCH of that pack writes it. The response stays the patched version and, when a pack changed, adds `updated_versions` (the patched version and those packs). A service pack changed on its own leaves the base release and the other packs. Windows Server `2012` and `2012 R2` are separate versions: a product outside the set does not propagate on the label. A PATCH that changes only `vulnerability_alerts` does not match the technology again, neither the base release nor its packs. Another field still matches it once. A create that omits it leaves the version following the technology. The label is unique per technology without case. Deleting a version makes the links that named it "version unknown" (`merged_links` counts the links merged into an existing unknown-version link of the same server or application).
- Owners: GET `/technologies/:id/owners`, POST `/technologies/:id/owners/bulk-replace` `{ owners: [{ user_id, owner_type: business|it }] }`.
- Support contacts (Operations tab, as the applications'): GET `/technologies/:id/support-contacts` → `[{ id, contact_id, role, contact: { id, first_name, last_name, email, phone, mobile } }]` in the order they were added; POST `/technologies/:id/support-contacts/bulk-replace` `{ contacts: [{ contact_id, role? }] }` (`infrastructure:member`) replaces the list in the order given, one row per contact (the first role given wins), every contact of the tenant (`400` otherwise), and returns the new list; one audit row on `technology_support_contacts` when the list changes. The support notes are `support_notes` on the technology (PATCH).
- Web links: GET/POST `/technologies/:id/links`, PATCH/DELETE `/technologies/:id/links/:linkId` with `{ url, description? }`. The address is http or https, or has no scheme (`www.vmware.com/support`, opened as https); another scheme (`javascript:`, `data:`, `ftp:`) is a `400`. PATCH returns the updated link.
- Documents: GET/POST (multipart `file`) `/technologies/:id/attachments`, GET `/technologies/attachments/:attachmentId` (download), DELETE `/technologies/attachments/:attachmentId`.
- Relations, on the model of the applications' Relations tab: GET `/technologies/:id/relations` → `{ year, budget_column, budget_lines, contracts, projects, incidents, documents, links }` in one round trip; a section whose module the caller cannot read (`budget`, `contracts`, `portfolio_projects`, `incidents`) is `null`; confidential incidents follow the incident rules. POST `/technologies/:id/relations/:kind` `{ id }` and DELETE `/technologies/:id/relations/:kind/:targetId` (`kind`: `budget_lines`, `contracts`, `projects`, `incidents`) → `{ ok, changed }`. Linking an incident needs `incidents:contributor` (403 otherwise), and the incident must be visible and open (the same `404` for an unknown and a hidden confidential incident). A single link locks the technology row and keeps a link written meanwhile; an incident's link goes through the incident's own service, which locks the incident row and computes the set plus or minus one under that lock (journal entry).
- Servers: GET `/technologies/:id/assets` → `{ items }`: the assets that carry the technology, `kind` `installed` (with `link_id`, version, notes and `source`) or `carried` (through `contains` or cluster membership, at most 3 edges, one row per asset and version with `via_assets: [{ id, name, reference }]`, every asset it is installed on that carries it there, by name, and `via_asset_*` the first of them), with `is_cluster` (a cluster is listed, the counters leave it out), `through_host` (a carried row every path of which crosses a `contains` edge: the assets a host it is installed on contains, shown folded; false for what a cluster's members carry), with environment, operating system (the readable label of the marked technology) and `asset_status` (a retired asset's direct link is listed, `installed`, and reaches nothing). POST `/technologies/:id/assets` `{ asset_id, technology_version_id? | version_label?, notes? }` (a label is resolved without case and created when missing; idempotent; a link written over HTTP is manual), PATCH `/technologies/:id/assets/:linkId` `{ technology_version_id? | version_label?, notes? }` (the link becomes manual), DELETE `/technologies/:id/assets/:linkId`.
- Applications (need `applications:reader`: `items` is `null` without it, the export and the writes answer `403`; a Business Contributor sees and links its own applications only): GET `/technologies/:id/applications` → `{ technology, items }`: `hosted` (an instance assigned to a server that carries it: environment, server, `via` asset, version) and `declared` rows, with the application's reference, criticality, `external_facing` and IT owners; an unknown version is `null`. Disabled applications and disabled instances are left out of every deduction, list counters included, and so are retired assets (`status` `retired`): they carry nothing, the traversal stops at them, and their links count in no counter or deduction. Their direct links stay listed in the Servers rows and on the asset's side, to be seen and removed. GET `/technologies/:id/applications/export?language=` returns the same rows as a CSV file (recorded as an export in the audit log), written in `language` (`en`, `fr`, `de`, `es`; the user's locale without it): headers, link kind, "version unknown", yes and no, environments by name, and the criticality as the tenant's catalog names it in that language (its translation, else the shipped label's). POST `/technologies/:id/applications` `{ application_ids }` declares the technology on several applications at once (`{ ok, added }`); PATCH `/technologies/:id/application-links/:linkId` changes a declaration's version or notes; DELETE `/technologies/:id/applications/:appId` withdraws every declaration of the application.
- Link files (lot C2a), from the technologies list: one row is one link. Column ids stay English; the separator follows `language` (`en` comma, `fr`, `de` and `es` semicolon); formula cells are guarded on export and read back as they were stored. GET `/technologies/asset-links/export?scope=data|template&language=` (`infrastructure:reader`) returns `servers-technologies.csv` (every link of `asset_technologies`, retired assets included, by server, technology, then version, a link with no version first), or `servers-technologies-template.csv` (the header only); another `scope` is a `400`. Columns: `asset_reference` (`AST-n`), `asset_name`, `technology_reference` (`TEC-n`), `technology_name`, `version` (empty: no version), `operating_system` (yes or no, written in the file's language; the import reads yes and no in the four languages, as the other files do), `notes`, `source` (where the link comes from, in the file's language). GET `/technologies/application-links/export?scope=&language=` returns `applications-technologies.csv` (the declared links of `application_technologies`, deductions left out; a Business Contributor's own applications only) or its template. Columns: `application_reference` (`APP-n`), `application_name`, `technology_reference`, `technology_name`, `version`, `notes`, `source`. It needs `applications:reader`, as the single application links (`403` otherwise). POST `/technologies/asset-links/import?dryRun&language=` (`infrastructure:member`) and POST `/technologies/application-links/import?dryRun&language=` (`infrastructure:member` and `applications:reader`), multipart `file`, return `{ ok, dryRun, total, inserted, updated, unchanged, errors, warnings, ignoredColumns, notices }`; `dryRun` defaults to true and writes nothing, versions included. Matching ignores case and edge spaces. The server matches by `asset_reference` when the cell is filled, otherwise by name (unknown, or several assets with that name: a row error; a retired asset is accepted); a reference and a name that designate two different servers are a row error, so two servers with one name export and import again by their reference. The application matches by `APP-n` when the reference is filled, otherwise by name; one outside the caller's scope is unknown. The technology matches by `TEC-n` when filled, otherwise by name; an unknown one is a row error (`CSV_TECHNOLOGY_NOT_ADOPTED`: adopt it from the catalog first), and a filled reference that is not of the form `TEC-n` is `CSV_TECHNOLOGY_REFERENCE_INVALID`. A version label is resolved without case and created when missing (warning `CSV_TECHNOLOGY_VERSION_CREATED`); an empty version is its own link, distinct from a named one. The import adds and updates, never deletes. An existing link is `unchanged` when the `notes` cell is empty or equal, otherwise its notes are replaced (`updated`), and it keeps its provenance; a link the import creates is `source = 'import'`, `source_ref` the file name, decoded from the upload and cut to at most 200 characters on a whole character. `source` is ignored on import. `operating_system` `yes` marks the server link through the operating-system service: a row error when the technology's family is not `operating_system`, the asset is a cluster, or the server already has another operating system (the import does not move a mark). `no` never sets a mark. An empty cell on a link the import creates follows the server page: the link is marked when its technology is of family `operating_system`, the asset is not a cluster and the server has no mark yet (warning `CSV_OPERATING_SYSTEM_MARKED` in the preview); a `yes` row for that server in the same file wins. The import never clears a mark, and leaves an existing link's mark as it is. Two rows of the same link: the second is an error. A file with any row error writes nothing; a clean file writes in the request transaction, through the services of the single links (audit, search, vulnerability matching). At most 20,000 rows.
- Administration view (lot A1e, view 4 of the ANSSI mapping guide). Reads need `infrastructure:reader`. Assigning a zone needs `infrastructure:member`.
  - GET `/technologies/reports/administration` → `{ most_sensitive, zones, without_zone, controls }`. `most_sensitive` is the code of the first zone of the catalog that is not deprecated, or `null` when the catalog has none. `zones`, in catalog order: `code`, `label`, `description`, `admin_group`, `deprecated`, `unknown`, `asset_counts` (`kind`, `count`: assets that are not retired), `hosted_application_count` (distinct applications in service whose instances are assigned to those assets; a disabled application or instance is left out) and `directory_services` (technologies of family `directory` whose `admin_zone` is this zone and that are not retired: `id`, `reference`, `name`). A deprecated zone is included only while an asset or a directory service still carries it. A code the catalog no longer has, carried by an asset or a directory service, is appended after the catalog, sorted by code, with `unknown: true` and `label` set to the code. A technology of another family does not open a zone. `without_zone` is `{ asset_count }`, the assets that are not retired and have no zone. `controls` is one entry per control, in this order, `{ key, count }`: `assets_without_zone` (that count), `domain_controllers_outside` (assets assigned the server role `domain-controller` on an application and instance in service whose zone is not the most sensitive one; the role alone, `assets.domain` is not required), `directory_assets_outside` (assets with a direct `asset_technologies` link to a directory technology that is not retired and whose zone is not that one), `trust_raised` (the asset to raise: a container, `asset_relations` of type `contains`, whose zone is less sensitive than an asset it contains, or a cluster member whose zone is less sensitive than its cluster), `applications_on_most_sensitive` (assets of that zone hosting an application in service, on an instance in service). Each `count` is a number of distinct assets: the `total` of the asset list filtered on that control. A lower index among the zones of the catalog that are not deprecated is more sensitive. A pair is left out when either zone is missing, deprecated or outside the catalog, and a self-link is left out. `count` is `null` for the four controls that name the most sensitive zone when the catalog has none. Retired assets and retired technologies are left out of every control.
  - GET `/technologies/reports/administration/assets` → `{ items, total, limit, offset, page }`, one row per asset that is not retired. Query: `page` (from 1), `limit` (50 by default, at most 200), `offset` (it wins over `page`, including 0), `sort` (`name`, `reference`, `kind` or `zone`; `type` is `kind`; direction `ASC` or `DESC`; an unknown field is a `400`; `zone` follows the catalog order, deprecated zones at their place, then codes the catalog no longer has, by code, and assets without a zone come last in both directions), `q` (name or reference, without case), `filters` (the grid's JSON model). Text filters on `name` and `reference`, without case: `contains`, `notContains`, `equals`, `notEqual`, `startsWith`, `endsWith`, `blank`, `notBlank`. Set filters: `zone` (a code, or `null` for no zone), `kind` or `type`, `control` (a control key; several keys match an asset that has any of them; an unknown key matches nothing). A set filter in exclude mode is a `400`. An empty set matches nothing. An asset row: `id`, `reference`, `name`, `kind`, `zone` (the code, or `null`), `technologies` `{ total, items }` (direct `asset_technologies` links, with `reference`, `name` and `version`, sorted, at most 10 items), `applications` `{ total, items }` (applications in service hosted on the asset, `reference` and `name`, at most 10), `findings` (the control keys that concern this asset), `trust_peers` `{ total, items }` (for a trust finding, why the asset is to be raised: each more sensitive asset it contains, `relation: 'contains'`, and each more sensitive cluster it is a member of, `relation: 'cluster'`, with `reference`, `name` and `zone`; at most 10 items) and `application_references` `{ total, items }` (the references of the applications that place the asset in `applications_on_most_sensitive`, at most 10 items, in the order of `applications`).
  - POST `/technologies/reports/administration/assets/zone` `{ zone, ids?, exclude_ids?, all?, filters?, dry_run?, as_of?, expected_rows? }`. `zone` is a catalog code or label that is not deprecated, or `null` to clear it; an empty or blank text is `null` (a missing, unknown or deprecated zone is a `400`). `ids` are the chosen assets, and the filters leave them as chosen. `all: true` is every asset the asset list's filters reach, less `exclude_ids`; it requires `filters`, the asset list request with exactly the keys `q` and `filters` (both optional, `{}` for every asset), `filters.filters` being the grid model as the list receives it, JSON text or the same object: `{ "zone": null, "all": true, "dry_run": true, "filters": { "q": "srv", "filters": "{\"control\":{\"filterType\":\"set\",\"values\":[\"trust_raised\"]}}" } }`. A missing `filters`, another key (`sort`, `page`, or a flat grid model such as `{ "zone": { ... } }`), a model that does not parse, or a model entry the list does not apply (a column other than the text filters `name` and `reference` and the set filters `zone`, `kind`, `type` and `control`) is a `400` `bulk_filters_invalid`. `filters` is ignored with `ids`. Sending both scopes is a `400`. `dry_run: true` writes nothing and returns `{ ok: true, dry_run: true, rows, changes, as_of }`. The write returns `{ ok: true, rows, changed }` and audits each changed asset on `assets`, as a change of that asset does. `rows` is the scope. `changes` and `changed` are the assets whose stored zone differs. A write with `all` sends `as_of` and `expected_rows` from the dry run: it changes only assets created by `as_of`, and a locked scope larger than `expected_rows` is a `409` `bulk_list_changed`. More than 5000 assets is a `400` `bulk_too_many`, on a dry run as well. Retired assets stay out of the scope. The assets `search_index` trigger stays in place.
  - GET `/technologies/reports/administration/directories` → `{ services, forests }`. `services`: technologies of family `directory` that are not retired, with `id`, `reference`, `name`, `zone` and `servers` (assets that are not retired and carry the technology directly). `forests`: the domains of the catalog except the system entries, grouped by `forest` without case and named as the first domain of the group spells it (the domains that name none share `forest: null`, and that group comes last). A domain keeps `code`, `label`, `dns_suffix`, `forest`, `trusts`, `declared_by`, `account_count`, `machine_count`, `domain_controllers` and `deprecated`. Nothing in the database links a directory service to a forest, and this route does not add one.
  - GET `/technologies/reports/administration/export?list=assets|domains&language=` returns one list as a CSV file (a path ending with `/export`: recorded as an export). `list` defaults to `assets`. `list=assets` (`administration_view_assets.csv`) is every asset the asset list's filters and sort reach, with the headers `Zone`, `Reference`, `Name`, `Type`, `Technologies`, `Applications`, `Controls`, `Dependency`. The zone and the type use the catalog's label. Technologies, applications and dependencies name every link. A dependency reads `Runs <reference> <name> (<zone>)` for a contained asset and `Member of cluster <reference> <name> (<zone>)` for a cluster. A control cell uses the English title. More than 10000 assets is a `400` `export_too_many`. `list=domains` (`administration_view_domains.csv`) keeps the headers `Domain`, `DNS suffix`, `Forest`, `Trusts`, `Trusts declared by other domains`, `Accounts`, `Machines`, `Domain controllers`, `Domain controller servers`. Any other `list` is a `400`. A cell that a spreadsheet would read as a formula is prefixed with a quote.
- From the incident's side: GET `/incidents/:id/technologies` (`incidents:reader`) and POST `/incidents/:id/technologies/bulk-replace` `{ technology_ids }` (`incidents:contributor`), journaled like the assets and applications of an incident. Both also need `infrastructure` reader (`403` otherwise, before anything is read or written). The Relations tab is GET `/incidents/:id/relations` (see Incidents). GET `/incidents/:id` counts assets and technologies in `counts.assets` and `counts.technologies` for a reader of `infrastructure` (`null` otherwise), and applications in `counts.applications` for a reader of `applications` (`null` otherwise; a Business Contributor counts the applications they take part in).
- From the asset's side: GET `/assets/:id/technologies` (installed and carried, with `removable` and `is_operating_system`; a carried technology is one row per version, with `via_assets: [{ id, name, reference }]`, every asset that carries it there (a host, the members of a cluster), by name, `via_asset_*` the first, and `through_host`, true when every path that brings it crosses a `contains` edge (the platform underneath: the hypervisor of the host), false for what a cluster's members carry; a retired asset lists its direct links only; the marked operating system comes first; each row names `standard_support_end` and `extended_support_end` of its version, `null` when unknown), POST `/assets/:id/technologies` `{ technology_id, technology_version_id? | version_label?, notes?, is_operating_system? }` (a technology of family `operating_system` is marked as the OS when the asset is not a cluster and has no marked link yet; `is_operating_system` forces the mark: the link that held it before is deleted, whether it named another version or another technology, unless it is the link being marked), PUT `/assets/:id/operating-system` `{ technology_id, technology_version_id? | version_label? }` (an empty `technology_id` clears it; the previous marked link is deleted), DELETE `/assets/:id/operating-system` (deletes the marked link), DELETE `/assets/:id/technologies/:linkId` (when the removed link was the operating system and the asset is not a cluster, the mark passes to the oldest remaining link of family `operating_system` on that server, by `created_at` then id, under the asset row lock; a cluster, or a server with no such link left, loses the mark). One server has one operating system (`asset_technologies.is_operating_system`, migration `1854330000000`).
- Converting an application (lot C1; `applications:admin` and `infrastructure:member`, `403` otherwise): GET `/applications/:id/conversion-preview` → `{ application: { id, name, reference }, hosting_type, refusals: [{ reason, count, fields?, files? }], moves, unlinked, losses }`. `refusals` lists why the application cannot convert: `interfaces` (source or target), `middleware`, `integration_tool` (of an interface binding), `suite_components`, `interface_bindings` (on its instances), `name_taken` (a technology of that name, trimmed and without case), `invalid_fields` (`fields`: values the technology refuses, `hosting_type` when the tenant's catalog has no hosting type in use, such as a name over 200 characters, support notes over 20,000 or a kept support contact role over 200 (`support_contact_roles`), a catalog code no longer listed, a recovery time out of range), `missing_files` (`files`: attachments whose object is missing from storage). `moves` counts what goes to the technology (`owners`, `support_contacts`: its contacts of the tenant, once each, `contracts`, `budget_lines` of both natures, `projects`, `links`, `attachments`, `incidents`, `servers`: the servers of its enabled instances); a count of a module the caller cannot read (`contracts`, `budget`, `portfolio_projects`, `incidents`) is `null`, and confidential incidents follow the incident rules. `unlinked.managed_documents` counts its managed documents, which stay, released to the unfiled documents of their library with their files. `losses` counts what goes with the application (`instances`, `disabled_instance_servers`, `suites`, `predecessor`, `successors`, `data_residency`, `audience`, `links_without_url`, `knowledge_links`, `tasks`, `requests`, `business_processes`, `technologies`). `hosting_type` is the type the technology is created with. With servers (those of its enabled instances): the hosting type of their sites the tenant's catalog has (the one with the most servers), else `on_prem`. Without: the application's `hosting_model` when the catalog has it (`on_premise` is `on_prem`; the deprecated field never overrides the servers), else `saas`. The fallbacks are resolved against the tenant's hosting types. POST `/applications/:id/convert-to-technology` `{ family }` → `{ technology: { id, reference, name } }`, in one transaction that locks the application and its instances: the technology is created with the name, editor, description, notes, support notes, lifecycle and classification fields, the links are copied to it, the support contacts become its own (one row per contact, the first role given kept) (one journal entry per incident), each server of an enabled instance becomes an installation link (version unknown, `manual`, note "Converted from APP-n"), the files are copied under the technology's key, the application is deleted by its delete service, and its managed documents are released. Both records get an audit row that names the other (the old `APP-n` stays in the log). A refused conversion is a `409` `APPLICATION_CONVERSION_REFUSED` with `refusals`; a file unreadable at the copy is a `409` `APPLICATION_CONVERSION_MISSING_FILE` (`params.file`). The original files go once the answer has left after the commit; after a failure the copies go instead.
- Link provenance: `asset_technologies` and `application_technologies` carry `source` (`manual`, `import`, `ai`, `agent`, `netbox`), `source_ref` and `observed_at` (`backend/src/common/link-provenance.ts`). The HTTP routes write `manual` and clear the other two; another source is a parameter of the services (imports, assistant, agents).
- End of support report (`backend/src/technologies/reports/`, `infrastructure:reader`; the application columns follow the rule of `GET /technologies/:id/applications`):
  - GET `/technologies/reports/end-of-support?horizon_months=6|12|24|36&type=` → `{ horizon_months, today, until, applications_visible, items }`. One row per item whose support ended, or ends by `until` (today plus the horizon, 12 months by default): versions in use (on an asset in service, or declared by an application in service) with their standard and extended ends, typed `operating_system` when the technology family is `operating_system` and `technology` otherwise, applications in service (`end_of_support_date`), and physical assets in service (a kind marked physical in the IT Ops catalog `serverKinds`, clusters left out) at their end of life or at the end of their support contract (`milestone`: `end_of_life`, `support_contract`). Retired assets take no part. `type`: `technology`, `operating_system`, `application`, `hardware`. Each row has `type`, `item_id`, `item_name`, `item_reference`, `version`, `date`, `standard_support_end`, `extended_support_end`, `state` (`out_of_support`, `extended_support`: standard end passed and extended end to come, `upcoming`), `server_count`, `servers` (for a version or an operating system: the assets in service it is installed on, clusters excluded; for a piece of hardware: the assets in service it carries, clusters excluded, itself excluded) and `application_count`, `applications` (`null`, and no application rows, without `applications:reader`; a Business Contributor's own applications only). A version touches what the deductions of the technology layer reach with that version; an operating system or a piece of hardware touches its assets, what they carry down the asset graph (the VMs of a host, at most 3 edges) and the applications assigned to all of them; an application, the servers it is assigned to. A value outside the lists is a `400`.
  - GET `/technologies/reports/end-of-support/gaps` → `{ applications_visible, items: [{ gap, subject_type, subject_id, subject_name, subject_reference, related_type, related_id, related_name, version }] }`: the missing data, one row per record to complete. `gap`: `application_without_server` (hosting `on_premise` or `private_cloud`, no server assigned to an instance in service), `vm_without_host` (kind `virtual_machine`, no `contains` relation toward it), `technology_not_installed` (a hosting type of the `on_prem` category, not retired, on no asset; a code out of the catalog counts as on premises when it is `on_prem` or `colocation`), `technology_without_hosting_type` (not retired, a hosting type out of the tenant's catalog: a catalog without any type in use leaves the writers its default code, `backend/src/technologies/hosting-type.ts`), `database_server_without_dbms` (an assignment role `db` of an instance in service, no technology of the `database` family installed or carried), `sso_application_without_identity` (an instance in service with SSO, no technology of the `directory` family declared or hosted), `link_without_version` (a link to an asset in service or an application without a version, on a technology hosted on premises or one that has versions), `version_without_end_date` (a version in use without any end of support). The application gaps need `applications:reader`.
  - GET `/technologies/reports/end-of-support/export?list=deadlines|gaps&horizon_months&type&format=csv|xlsx&language` returns one of the lists as a CSV or Excel file (recorded as an export in the audit log, with its format and row count): the columns of the screen in `language` (else the user's locale), the end date as a date, an XLSX Parameters sheet. `horizon_months` and `type` belong to `deadlines`; any other query key is a `400`.

### Vulnerabilities

The CVE published by the NVD matched with the tenant's technologies (lot T6a of planning/cartographie-technologies.md). Resource `infrastructure`: reads `reader`, writes `member`. Every route answers `403` `FEATURE_DISABLED` while `VULNERABILITY_FEED_ENABLED` is off (`GET /config/public` → `features.vulnerabilityFeed`).

- Cache and feed (platform tables, no tenant): `vulnerability_cves` (id, summary, CVSS score and severity from v3.1, then v3.0, v4.0, v2; publication and modification dates, NVD status, reference links) and `vulnerability_cve_matches` (the CPE criteria of each CVE: product `part:vendor:product`, exact version or bounds, `vulnerable`; negated nodes are left out). The cache also keeps exploitation signals, all nullable (migration `1854360000000`): `cisa_kev`, `kev_added_at` (the day CISA added the CVE), `kev_ransomware` (true when `knownRansomwareCampaignUse` is Known), `eu_kev`, `epss` and `epss_percentile` (0 to 1, `numeric(6,5)`), `epss_date`, `euvd_id` (`EUVD-AAAA-NNNNN`). CISA `dueDate` is omitted: it addresses US federal agencies. The scheduled task `vulnerability-signals` (minute 50 of every sixth hour, registered while `VULNERABILITY_FEED_ENABLED` is on, the same switch as the NVD feed) asks the CISA catalog on each run, CISA's GitHub mirror by default (`If-None-Match`, to which the mirror answers 304, and `If-Modified-Since`; `www.cisa.gov` answers to the date only) and reads the EU KEV, the EPSS file and the EUVD mapping once a day (the EU dump and the mapping send no cache validator). Each file is read as a stream, inflated on the fly when it is gzip, within a size limit per source; of the CSV files only the lines of cached CVE are kept, until they are written, and only the two KEV catalogs stay in memory. Before anything is written a file passes checks, and one that fails writes nothing for its source (status `refused` in the summary): the CISA `count` is required and matches the list; a KEV list may not lose more than 10 % of the entries known at the last pass (the last file read, and the flags the cache holds) beyond 10 entries; the EU dump must name a known source; a CSV may not have far fewer lines than the last one read, nor 1,000 lines in a row without a readable row, nor more than 10 % unreadable lines. It updates only CVE already in the cache, in batches of 1,000, one short transaction each, locking the rows in `cve_id` order as the NVD upsert does. A KEV flag is NULL until the CVE is read in that catalog, then true or false. A CVE that leaves a catalog loses that catalog's flag; an EUVD identifier is never removed. One pass at a time over every process (advisory lock `vulnerability-signals:pass`, also taken by `applyKnown`). A source that fails leaves its columns and is named in the run summary; the other sources and the NVD collection continue. Mirrors: `KEV_FEED_URL`, `EPSS_FEED_URL`, `EUVD_BASE_URL` (an empty value keeps the default address; firewall hosts `raw.githubusercontent.com`, `epss.empiricalsecurity.com`, `euvdservices.enisa.europa.eu`). After a product is collected on demand, and after each scheduled NVD collection before its matching, the KEV catalogs already read (when current) are applied to the CVE whose flags were never written, without a download (`applyKnown`); EPSS and the EUVD identifier wait for the next file. An NVD re-read leaves these columns. See EPSS at https://www.first.org/epss. The European identifiers come from ENISA (European vulnerability database). The scheduled task `vulnerability-feed` (every 6 hours) reads each CPE product named by a technology not retired of any tenant: every CVE of the product at its first pass (pages only), then the CVE modified since the last success, in windows of at most 120 days. Products tried longest ago go first; after two products in a row failed for a failure of the service (no answer, server error, 403 or 429 after three attempts), the others wait for the next run, while a 400 or 404 stays the product's own error. A CVE the NVD has not analysed yet is kept without criteria and matches once it is. After a change (lot T6b): when a technology receives a CPE product (creation, edition, adoption from the catalog), when one of its versions or links changes, or when a server it is on is deleted, retired or back in service, or an application that declares it is deleted or enters or leaves service, the change is queued with the id of its transaction; a queue outside any request reads that transaction's status (`txid_status`) and, once it has committed, matches the technology with the cache from the committed state (a transaction rolled back does nothing). The products the feed never collected are then collected right away in the background (same collection and cadence, one request at a time per process, each product under its own lock, which the scheduled run takes too, never the run's lock; one try per request, the first failure of the service stops it; 20 new products an hour per tenant and process, the run takes the others), then every workspace that carries a product whose first collection succeeded is matched, once, when that queue of collections is idle, so several products collected one after another are all in the cache; a workspace that asks once a product is already collected is matched too. A rematch does the same for the technology's products never collected. These matches send no email. Nothing while the feed is off.
- Matching (`technology_vulnerabilities`, one row per technology, version and CVE, after each run and on demand): technologies not retired, and only their versions in use, named by a link to a server not retired or by an application in service. A technology is concerned when one of its `cpe_products` is the product of a `vulnerable` criterion; a version when its CPE version, failing that its label, falls in the bounds. Versions compare on their numeric prefix, segment by segment (`19c` is 19, `2016 SP3` is 2016); a version of fewer than three numbers stands for its branch (`9.0` covers every `9.0.x`, so it is concerned by `> 9.0`). A product named for a release by a year suffix (`a:microsoft:sql_server_2019`, `o:microsoft:windows_server_2019`, bounded in build numbers) applies only to the versions whose label starts with that year, and concerns them as a whole release unless their CPE version is a build of three numbers or more, then compared to the bounds. `match_basis`: `version_in_range`, `version_not_comparable` (no numeric prefix, or equal numbers with different qualifiers such as `1.0.2` against `1.0.2zf`: counted as concerned) or `version_unknown` (the row without version: a link in use that names no version, `potential: true`; kept only for the CVE that concern at least one version the technology declares, every CVE when it declares none). The criteria of a CVE are read one by one: a configuration that requires two products together (Tomcat running on Windows) matches the vulnerable product alone, so such a CVE can be shown for an installation it does not affect. A match never changes the state a user chose; a row that no longer matches (version no longer in use, technology retired, criterion changed) is deleted while `to_review`, kept with `matching: false` otherwise, and matches again with its state if it comes back. A change of a technology (CPE products, a version created, renamed or deleted, a link to a server or an application added, removed or moved to another version) matches that technology again with the cache once its transaction has committed (below).
- GET `/vulnerabilities?severity&state&editor&technology&from&to&q&alerts&exploited&epss&source&limit&offset` → `{ items, total, cves, limit, offset }` (`total`: the rows; `cves`: the distinct CVE among them), one item per row of `technology_vulnerabilities` (technology, version and CVE, the unit that carries the state; lot T6c), exploited first, then most severe. `severity` (`critical`, `high`, `medium`, `low`, `none`), `state` (`to_review`, `handled`, `not_affected`), `editor` and `technology` (id or `TEC-n`) take one value or a comma list; `from` and `to` (`YYYY-MM-DD`, inclusive) bound the publication date; `q` searches the CVE id, the summary and the technology name. `exploited` is `yes` or `no` (in the CISA KEV or the EU KEV). `epss` is a number, the minimum probability (0 to 1). `source` is `nvd` (the row's sources contain the NVD), `cve_org` (they contain CVE.org) or `both` (they contain the two); a row both feeds matched stays in `nvd` and in `cve_org`. An unknown technology, an impossible day, another `exploited` value, another `source` value or an `epss` that is not a number is a `400`. The list grid's parameters are accepted too: `page` (from 1) instead of `offset`; `sort` as `field:DIR` on `exploited` (default, then the severity and the score), `severity` (the severity and the score), `cvss_score`, `published_at`, `cve_id`, `technology` (its name; then most severe first) or `epss` (a missing score last), every order ending on the CVE, technology, version (newest number first, as `technologies/version-order.ts`) and row so that pages neither repeat nor skip a row (another column, or an impossible day in the date filter, is a `400`); and `filters`, the grid's JSON model: set filters on `severity`, `state`, `editor` (without case), `technology` (id or `TEC-n`; an unknown one matches nothing), `version` (labels, the same label on several technologies included; `null` for the rows without version) and `exploited` (`yes` or `no`; an unknown value matches nothing; `yes` and `no` together match every row) and `source` (`nvd`, `cve_org`, `both`; an unknown value matches nothing; several values match the rows any of them would keep), text filters on `cve_id` and `summary`, a number filter on `cvss_score` and on `epss`, a date filter on `published_at`; `technologies`, the column's name before lot T6c, reads as `technology`, and a set filter in exclude mode (`mode: 'exclude'`) is a `400`. Each item: `id` (the row's id, stable), `cve_id`, `summary`, `cvss_score`, `score_source` (`nvd` when the NVD cache holds the score and `nvd_status` is set, `cve_org` when the shown score comes from the CVE.org record, null when there is no score), `severity`, `cvss_version`, `published_at`, `last_modified_at`, `nvd_status`, `cisa_kev`, `eu_kev`, `exploited` (either catalog; a null flag counts as false), `kev_added_at` (`YYYY-MM-DD`, the CISA day, null when only the EU lists it), `kev_ransomware` (true, false, or null when CISA does not list it), `epss`, `epss_percentile` (0 to 1, or null), `epss_date`, `euvd_id`, `technology: { id, reference, name }`, `editor`, `version` (the label, `null` when none is recorded: potentially concerned), `technology_version_id`, `potential`, `match_basis`, `matching`, `match_sources` (sorted: `cve_org`, `nvd`, or both), `state`, `note`, `state_changed_at`, `state_changed_by_name`, `detected_at`, `servers` (distinct servers in service whose direct link names this version, clusters excluded as on the technology list, `backend/src/vulnerabilities/vulnerability-reach-counts.ts`) and `applications` (declared, or hosted on a server with such a direct link, for this version; `null` without `applications:reader`, a Business Contributor's own only). Each item carries `alerts` (whether the row alerts: the version's own setting, or the technology's when the version has none or the row names no version). `alerts` is `included` (default: the rows that alert), `excluded` or `all`; an empty value is `included`, and another value is a `400`. The same parameter narrows the export and the filter values (query), and a bulk change with `all: true` (`filters.alerts` in the body of POST `/vulnerabilities/bulk-state`). Chosen `ids` stay as they are: `alerts` does not narrow them. The score, the severity and the CVSS version shown are the NVD cache when `vulnerability_cves.cvss_score` is set. When that score is null and `vulnerability_cve_records` has one, the list shows the record's score, severity and CVSS version. The summary text falls back to the record only when the cache summary is blank. A CVE only CVE.org matched is copied into the cache with `nvd_status` null, so its score stays `score_source` `cve_org`. The severity filter, the score filter, the summary search and the severity and score sorts use those displayed values. The export writes the same score and severity. The cache row itself is left as stored.
- GET `/vulnerabilities/export?<same filters and sort>&language=` → the list as a CSV file, one line per grid row, in the grid's order (recorded as an export in the audit log). `Source` follows `Match`: `NVD`, `CVE.org`, or `NVD, CVE.org`. The columns `Exploited` (`yes` or `no`), `KEV added`, `Ransomware` (`yes`, `no`, or empty), `EPSS`, `EPSS percentile` (the stored values from 0 to 1, empty when missing) and `EUVD` come before the last column, `Alerts` (`yes` or `no`). More than 10,000 rows matching the filters is a `400`: narrow them.
- GET `/vulnerabilities/filter-values?fields=version&<same filters>` → `{ version }`: the labels of the versions of the rows the other filters reach (the `version` filter of the model is left out), newest number first, `null` last when a row has no version. Another field answers nothing.
- POST `/vulnerabilities/bulk-state` `{ state, note?, ids?, all?, filters?, exclude_ids?, dry_run?, as_of?, expected_rows? }` (`member`) → `{ ok, rows, cves, changed }`, or `{ ok, dry_run, rows, cves, changes, as_of }` with `dry_run: true` (nothing written; `rows` counts the rows, `cves` the distinct CVE among them; `as_of` is the instant of the count: sent back with the write, required with `all: true`, it limits the change to the rows detected by then, so a row found after the count stays to review; `expected_rows`, the `rows` of the count, also required with `all: true`: when the rows locked for the write are more, as with a row whose matching began before the count and committed after it, nothing is written and the answer is a `409` `bulk_list_changed`, to count again): sets the state, and the note when one is sent (`null` clears, absent keeps), of the chosen rows (`ids`, row ids of the list, taken as they are: `filters` does not narrow them) or, with `all: true`, of every row the filters reach (`filters`: the list's parameters, grid model included) but those in `exclude_ids` (the rows the user unticked). `ids` and `all` together, `exclude_ids` without `all`, an id that is not a row id, or more than 5,000 ids is a `400`; a row of another workspace is never reached. The rows are locked in the matching's order and written in batches of 500; each changed row is audited on `technology_vulnerabilities`. More than 5,000 rows, or more than 5,000 ids, is a `400` with the code `bulk_too_many` that says to narrow the filters.
- GET `/vulnerabilities/sources` → `{ items }` (`infrastructure:reader`, the same right as the list, declared before `:cveId`). `items` always holds the NVD, then CVE.org: `{ source: 'nvd' | 'cve_org', last_success_at, last_attempt_at, failing, enabled }`. Dates are null when that source has no row yet. `failing` is true when `last_error` is set and `last_attempt_at` is more recent than `last_success_at` (a first attempt that failed has no success). The error text is not returned. `enabled` is `VULNERABILITY_FEED_ENABLED` for the NVD and `cveListEnabled()` for CVE.org (both switches). The route itself answers 403 `FEATURE_DISABLED` while the vulnerability feed is off, like the other routes of this controller. The NVD pass writes its row at the start (`last_attempt_at`) and at the end (`last_success_at` and a cleared error when no product failed, including a pass with nothing to read; otherwise `last_error`, the first error, 300 characters, and the previous success stays). A failed write of that progress does not stop the pass.
- GET `/vulnerabilities/:cveId` → the item, with `cvss_vector`, `reference_urls`, `euvd_url` (`https://euvd.enisa.europa.eu/vulnerability/` plus `euvd_id`, or the CVE id when the mapping has none; source: ENISA, European vulnerability database), `kev_sources` (`cisa`, `eu`, or both), `technologies` (each with its `versions`), `servers_list` (`asset_id`, `name`, `reference`, `environment`, technology, version, `via_asset_name`) and `applications_list` (`null` without the read right): one entry per application, technology version and way it is reached, with `application_id`, `name`, `reference`, `criticality`, `kind` (`declared`: the application names the technology; `hosted`: an instance on a server the technology reaches), `environment`, `server_name` (the server of a hosted entry, null for a declared one), `via_asset_name` (the asset the technology is installed on when that server reaches it through another asset, such as a host or a cluster; null when the technology is on the server itself), technology, version and `alerts`. An entry is direct when it is declared or `via_asset_name` is null; the panel lists one line per application and version, with its servers. `404` when the CVE concerns nothing of the tenant. The detail is not narrowed by `alerts`: it keeps every row, alerting or not. Each version, each entry of `servers_list` and each entry of `applications_list` carries `alerts`, the effective setting of its row. `servers` and `applications` count every row; `alerting: { servers, applications }` counts only the rows that alert, as the list does (a CVE on PostgreSQL 16, alerting on 3 servers, and on an excluded Windows Server 2019 on 200 servers: `servers` 203, `alerting.servers` 3). The score, the severity, the CVSS version and vector, and `score_source` follow the list. `record` is `{ assigner, published_at, updated_at, state }` from `vulnerability_cve_records`, or null when this installation has not read the record. `nvd_status` stays the cache value (null when the NVD has no row of its own). Each version carries `matches`, recomputed when the detail is read. A feed absent from that version's `match_sources` contributes nothing. An NVD match is `{ source: 'nvd', cpe, versions }`: one object per product (`part:vendor:product`) of the technology's `cpe_products`, holding the vulnerable bounds of this CVE for that product (`exact`, or `start` with `start_including`, or `end` with `end_including`), sorted. A CVE.org match is `{ source: 'cve_org', vendor, product, cpe, container, default_status, versions, versions_total }`, plus `package_name`, `platforms` and `modules` when the block has them. `cpe` is the product a CPE of the block matched, or null when only a declared name matched. `versions` keeps at most 20 entries (`version`, `status`, `lessThan`, `lessThanOrEqual`, `changes`, `versionType`) and `versions_total` counts every entry of the block. Which block matches is `probesOf`, the same function as the matching.
- GET `/technologies/:id/vulnerabilities` → `{ technology, technology_alerts, versions_excluded, versions_included, products, items }`: one item per version and CVE (CVE fields, the exploitation signals and row fields, including `alerts`, `match_sources` and `score_source`), most severe first, alerting rows and the others. `technology_alerts` is the technology's setting. `versions_excluded` counts the versions whose effective setting is false (their own exception, or the technology's setting when they have none), `versions_included` those whose effective setting is true: an excluded technology with `versions_included: 2` is "excluded, except 2 versions", an included one with `versions_excluded: 2` has "2 versions excluded". `products`, one `{ product, status }` per CPE product of the technology: `collected`, `pending` (never collected yet: the search is under way) or `failed` (never collected, the last attempt failed).
- GET `/technologies/:id/vulnerabilities/summary` → `{ technology, technology_alerts, versions_excluded, versions_included, collecting, products, cves, versions }` (same right as the list above, and declared before `:cveId`): one entry of `versions` per version of the technology, in the order of the versions table (newest number first, then the labels without a number, `backend/src/technologies/version-order.ts`), plus one with `version_id` and `label` null when a link (a server or an application) names no version. A technology with no version and no such link answers `versions: []`. Each entry: `installed` (the version is in use: a direct link of an asset in service, or of an application in service, names it, `assetLinksSql` and `applicationLinksSql` in `backend/src/vulnerabilities/vulnerability-reach-counts.ts`; for the entry without a version, at least one such link names no version), `alerts` (the effective setting: the version's own, or the technology's when the version has none or the entry names no version), `servers` (distinct servers in service whose direct link names that version, as every count; a server the asset graph carries the version to, a VM or a cluster, is not counted; 0 when `installed` is false), `open` (distinct CVE still `to_review`, by `critical`, `high`, `medium`, `low`, `none` and `unknown` (neither the NVD cache nor the CVE.org record has a severity; the Vulnerabilities page shows it "Not rated"); every count is 0 when `installed` is false) and `total` (distinct CVE of the version, every state; 0 when `installed` is false). `cves` counts the distinct CVE of the technology once, across versions, including a row of a version that is not in use. `versions_excluded` and `versions_included` count every version by its effective setting, in use or not. `products` is the same list as on the full list; `collecting` is true while one of them is `pending`. The entry without a version comes last. One statement reads the versions, the links, the matches, the severities and the servers (`vulnerability_cves` and `vulnerability_cve_records` have no `tenant_id`; the open counts use the displayed severity, the cache's when the cache has a score, otherwise the record's); every tenant table in it carries `tenant_id`. The summary does not count applications. `404` for another tenant's technology.
- GET `/assets/:id/vulnerabilities` (id or `AST-n`, `infrastructure:reader`) and GET `/applications/:id/vulnerabilities` (id or `APP-n`, `applications:reader`, among the applications the user reads: another one, or one of another tenant, is a `404`) → `{ rows, indirect?, totals, pending }`, for the records and their badge; `403` `FEATURE_DISABLED` while the feed is off. `rows`: one line per technology and version of the direct links (`backend/src/vulnerabilities/vulnerability-reach-counts.ts`: the asset's `asset_technologies`; for an application, what it declares and the direct links of the servers its instances are assigned to, application and instance in service) with at least one CVE that counts, most severe first, then most CVE, then the technology's name. Each line: `technology: { id, name, reference }`, `version_id`, `label` (null without version), `open` (distinct CVE that count by `critical`, `high`, `medium`, `low`, `none`, `unknown`), `total`, `severe` (critical or high), `exploited_severe` (severe and in a KEV catalog); for an application also `declared` (it declares this technology and version) and `servers: [{ id, name }]` (its servers in service that carry it in a direct link, each once, by name). `indirect` (asset only): the same lines for what another asset carries to it through the asset graph (a host, a cluster), with `via_assets: [{ id, name, reference }]`, every asset that carries the technology and version to it (a host, the members of a cluster), by name, one line per technology and version (`via`: the first of them), and `through_host` (every path crosses a `contains` edge: the platform underneath, shown folded); listed, not counted; a technology and version both direct and carried is a direct line only. `totals: { open, severe, exploited_severe }`: distinct CVE over every direct line; `null` for a retired asset or an application out of service (no line then). A cluster also gets `member_totals` (same shape): distinct CVE over its own direct links and those of its members in service, what its badge and its list column show; the list column, its filter, the export, the assistant and the Vulnerabilities page filtered on the asset count a cluster the same way (`assetCountLinksSql`). `pending` is true while a match is queued or running for a technology of the record that has CPE identifiers (the asset's direct links, and a cluster's members; for an application, what it declares and the direct links of its servers). It is false when that technology has no CPE identifiers, for a retired asset and for an application out of service. The record's section then says the search is in progress and reads the route again until `pending` is false.
- PATCH `/technologies/:id/vulnerabilities/:cveId` `{ state?, note?, technology_version_id? }` → `{ ok, changed, technology, items }`: sets the state and the note (at most 4,000 characters, `null` clears) of every version of the technology for that CVE, or of one (`technology_version_id`, `null` for the unknown version). Each changed row is audited on `technology_vulnerabilities`; a change of state records who and when.
- POST `/technologies/:id/vulnerabilities/rematch` → `{ ok, added, updated, removed, unmatched, collecting }` (`collecting`: its products never collected, now collected in the background): matches the technology again with the cache, after a change of its CPE identifiers or of its versions.
- Notifications (lot T6b, K2a): after each scheduled run, the IT owners of a technology (`technology_owners`, `owner_type = 'it'`, enabled accounts that read the infrastructure: an administrator, or a role with an `infrastructure` level) receive one email that lists the CVE still `to_review`, new to them, and on a row that alerts (a version follows its technology unless that version has its own setting; a row with no version follows the technology), when the CVE is critical or high or known to be exploited (CISA KEV or EU KEV, any severity): a row detected since the run started, whatever wrote it (the run's matching, a matching after a change, a collection on demand), for a CVE published within the last 30 days, on a CPE product the technology was already matched on before the run; or a row whose CVE the run's collection raised to critical or high. The first match of a technology, or of a CPE identifier just added to it, is a silent baseline (its history shows on the page). That baseline still counts every matched row, so a product already matched stays known when a later alerting row appears. A row that does not alert is left out of the email and stays out of it. A CVE already cached as not exploited (its KEV flags read false) that enters the CISA KEV or the EU KEV is reported by the signals task after its run: its rows still to review and in the alerts are announced once more, whatever the CVE's age or severity, as "now known to be exploited" (claim key with an `:exploited` suffix, so never twice); a row found after its CVE entered a catalog is not concerned. The scheduled NVD run stamps the CVE it just cached from the catalogs already read before it matches (`applyKnown`), so a new CVE already exploited is announced at that run. The line names the severity and, when the CVE is exploited, that it is known to be exploited (or now known to be exploited). The email lists 25 lines at most, one per technology and CVE with its versions, then "and N more" with a link to the page (to review, published within 30 days). Active workspaces only (a frozen workspace is matched, not mailed; an expired trial keeps its `active` status and is mailed, as for the other scheduled notifications); nothing while email is off (`EMAIL_ENABLED`) or the application address is not configured. The user's preferences decide (`GET/PATCH /users/me/notification-preferences`: `emails_enabled` and `workspace_settings.technologies` `{ enabled, vulnerabilities }`, both on by default). Each recipient hears of a CVE on a technology once: the claim is a system row of the audit log (`table_name = 'vulnerability_notifications'`, record = the technology), written before the email goes out; a recipient left out by his preferences is not recorded. What is not announced at its run (baseline, older CVE, a row detected between two runs, a frozen workspace, email off, the recipient's preferences, a failed claim) is never announced later.

### Department Metrics (per year)
- GET `/department-metrics/:departmentId?year=YYYY` → `{ headcount, ... } | null`
- PATCH `/department-metrics/:departmentId?year=YYYY`
  - Body: `{ headcount: int }`
  - Validation errors: headcount must be non‑negative integer
  - Freeze: edits are rejected when the departments scope is frozen for that year

## Incidents

### Incident relations
The Relations tab of an incident, one round trip (`backend/src/incidents/services/incident-relations.service.ts`). `:id` is the uuid or `INC-n`. A missing incident and a confidential incident the caller cannot see are the same `404` `{ code: 'INCIDENT_NOT_FOUND', message: 'Incident not found' }`. Reads need `incidents:reader`. Writes need `incidents:contributor` and a read of the target module. Tasks, documents and attachments stay on their own routes.
- GET `/incidents/:id/relations` → `{ assets, applications, technologies, editable, suggestions }`. Each list is ordered by name.
  - `assets: [{ id, reference, name, kind, environment, status }] | null`. `reference` is `AST-n`. `null` without a read of `infrastructure`.
  - `applications: [{ id, reference, name, lifecycle, business_criticality, status }] | null`. `reference` is `APP-n`. `business_criticality` is the application's criticality. `null` without a read of `applications`. A Business Contributor sees the applications they take part in.
  - `technologies: [{ id, reference, name, family, vendor }] | null`. `reference` is `TEC-n`. `vendor` is the editor. `null` without a read of `infrastructure`.
  - `editable`: `false` when the incident is closed or cancelled.
  - `suggestions`: up to 20 technologies carried by a linked asset (`asset_technologies`) or, for a caller who reads `applications`, by a linked application they can see (`application_technologies`), that the incident does not list yet. Each item is `{ type: 'technology', id, reference, name, family, vendor, via: { kind, label } }`. `kind` is `asset_technology` or `application_technology`. `label` is the source reference (`AST-n` or `APP-n`). Several sources for one technology keep the first reference in alphabetical order. A source with no reference is left out. Suggestions are returned to a reader of `infrastructure`, on an incident that can still be edited.
- The older GET `/incidents/:id/assets` and `/incidents/:id/applications` (`incidents:reader`) and POST `/incidents/:id/assets/bulk-replace` `{ asset_ids }` and `/incidents/:id/applications/bulk-replace` `{ application_ids }` (`incidents:contributor`) also need the read of the module they list (`infrastructure` for assets, `applications` for applications): `403` `You cannot read assets.` or `You cannot read applications.`, before anything is read or written.
- POST `/incidents/:id/relations/:kind` with `{ id }` and DELETE `/incidents/:id/relations/:kind/:targetId` → `{ ok: true, changed }`. `kind` is `assets`, `applications` or `technologies`. Anything else is `404` `Unknown relation type.`, before the module check and before the id is read. `assets` need a read of `infrastructure` (`403` `You cannot read this module.`). `technologies` need the same read (`403` `You cannot read technologies.`). `applications` need a read of `applications` (`403` `You cannot read this module.`). The module check comes before the id is parsed and before the incident is read. An id that is not a uuid is `400` `Invalid id.`. A uuid that is not a row of the tenant is `404` (`Asset not found.`, `Application not found.` or `Technology not found.`). A closed or cancelled incident refuses the write (`403` `This incident is closed. Reopen it to make changes.`), and that answer comes before the missing-target check. Linking a row that is already linked, or unlinking a row that is not, answers `changed: false` and writes nothing. A change locks the incident (`FOR NO KEY UPDATE`), appends one `link_change` journal entry (the business references, for example `Assets linked: AST-n.`) and one audit row on the link table (`incident_assets`, `incident_applications` or `incident_technologies`): `recordId` the incident, `action` `update`, `before` and `after` the target ids in name order.

### Sample-data journal import
POST `/incidents/import-journal` (`incidents:admin`) takes the sample data's journal file (`backend/fixtures/fromage-co/32-incident-journal.csv`): a CSV with the incident reference, its exact title, the author e-mail, the kind (`note`, `status_change` or `severity_change`), the event time in the zone the `occurred_at` header names, and the from and to values of a change. It answers `{ ok: true, imported, skipped, entries }`. The author and the event time come from the file; `created_at` stays the import time. A row identical to an existing entry is skipped, so the fixture runner can be re-run. The route is accepted only while the tenant's sample data is `loading`, a state the load route gives only to an empty workspace; outside a load it answers `409` with the code `SAMPLE_DATA_LOAD_ONLY` and writes nothing. This route exists for the Fromage & Co sample data: the register's import dialog never carries the journal.

## Location relations

GET `/locations/:id/relations` (`locations:reader`) returns the Relations tab of a location in one round trip. `:id` is a UUID or `LOC-n`. A missing location is `404` "Location not found". Both sections are read only: an asset's location is set on the asset. A section the caller cannot read is `null`. Web links stay on `/locations/:id/links`.

| Field | Read | Contents |
|---|---|---|
| `assets` | `infrastructure` | Assets at the location: `{ id, reference, name, kind, environment, status, provider, sub_location_id, sub_location_name }` (`reference` is `AST-n`), ordered by name |
| `applications` | `applications` | Applications with an instance on one of those assets: `{ id, reference, name, lifecycle, status, environments }` (`reference` is `APP-n`, `environments` the sorted environments of those instances). A Business Contributor sees the applications they take part in |

GET `/locations/:id/relation-counts` (`locations:reader`) → `{ relations }`: the tab badge. It counts the assets for a reader of `infrastructure`, the applications for a reader of `applications` (inside a Business Contributor's participation), and the web links.

The older GET `/locations/:id/servers` (assets) and `/locations/:id/applications` stay, under `locations:reader`, and also need the read of the module they list (`infrastructure`, `applications`): `403` `You cannot read assets.` or `You cannot read applications.` otherwise.

## IT Ops Settings
Tenant-scoped configuration for IT Landscape dropdowns and enums.

- GET `/it-ops/settings`
  - Guards: `JwtAuthGuard`, `PermissionGuard`, `@RequireLevel('settings', 'reader')`
  - Returns merged settings with defaults: `{ dataClasses, networkSegments, entities, serverKinds, serverProviders, serverRoles, hostingTypes, lifecycleStates, interfaceProtocols, interfaceDataCategories, interfaceTriggerTypes, interfacePatterns, interfaceFormats, interfaceAuthModes, connectionTypes, subnets, domains, ipAddressTypes, accessMethods }`
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
      "domains": [{ "code": "corp-ad", "label": "Corporate AD", "dns_suffix": "corp.example.com", "forest": "corp.example.com", "trusts": [{ "domain": "lab", "direction": "two_way" }], "account_count": 1200, "machine_count": 300 }],
      "adminZones": [{ "label": "Tier 0", "admin_group": "Domain admins", "description": "Identity core" }]
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
    - `forest`: optional text (200 characters); `account_count`, `machine_count`: optional whole numbers from 0 to 100,000,000, as a number or its digits (`400` otherwise, booleans included)
    - `trusts`: optional list of `{ domain, direction }`, `direction` `two_way`, `outgoing` (this domain trusts the other) or `incoming` (`400` otherwise); a trust to the domain itself, to a system entry, to a domain not in the list, or a second trust to the same domain is dropped. Removing a domain drops the trusts to it.
    - Domains stored before these fields stay valid: the fields are absent until typed.
  - Administration zones (`adminZones`): `label`, optional `admin_group` (200), `description` (2000). Tenants that never customised the list receive the three ANSSI tiers (`tier_0` "Tier 0 (core of trust)", `tier_1` "Tier 1 (servers and applications)", `tier_2` "Tier 2 (workstations)"); an empty stored list stays empty. The saved list order is the catalog order, and the first zone is the most sensitive. A stored `privilege_level` or `secrets_location` is ignored on read and dropped on the next save. A zone used by a technology (`technologies.admin_zone`) or an asset (`assets.admin_zone`) cannot be removed (`409`, `CATALOG_VALUE_IN_USE`); retire it instead.

- POST `/it-ops/settings/reset`
  - Guards: `JwtAuthGuard`, `PermissionGuard`, `@RequireLevel('settings', 'admin')`
  - Resets all settings to defaults

## Analytics Dimensions and Values (Master Data)

A tenant classifies its budget lines along analytics dimensions (`analytics_axes`, "dimensions" in the UI); each dimension holds values (`analytics_categories`). A line holds at most one value per dimension (`spend_item_analytics_values`, `capex_item_analytics_values`). Resource key: `analytics` for every route below.

- **Default dimension.** Every tenant has exactly one dimension with `is_default = true` (created by migration `1853660000000` for existing tenants, by the tenant bootstrap for new ones, and on the first write that needs it for a tenant inserted any other way). The legacy item field `analytics_category_id` and the AI key `analytics_category` address it through `is_default`, never through its position, code or name: renaming or reordering dimensions changes nothing for them (the budget file and the AI assistant address every dimension, the default one included, through its own `analytics:<code>` key). Its `name` may be `null` (screens then show the translated "Analytics dimension"). It cannot be disabled or deleted, and no API writes `is_default`.
- **Values** belong to one dimension, set on create and never changed. Names are unique per dimension (case-insensitive), so two dimensions can each hold "Other".
- **Value order.** Each value has a position in its dimension (`analytics_categories.sort_order integer NOT NULL DEFAULT 0`, migration `1853930000000`, index `(tenant_id, axis_id, sort_order)`). The order of a dimension's values is always `sort_order`, then the name in ICU order, then the id (`ANALYTICS_VALUE_ORDER_SQL` in `analytics/analytics-axes.util.ts`). The migration numbered the existing values 1..n per dimension in alphabetical order (the name in ICU order, then the id; `lower(name), name, id` on a PostgreSQL without the ICU collation), only in dimensions where every value was still 0, so a rerun leaves an ordered dimension alone. A new value goes last (`max(sort_order) + 1` in its dimension): `POST /analytics-categories`, the values CSV import and the AI create go through the service, which takes the dimension row `FOR SHARE`; the budget file load gives the values it creates consecutive positions after the dimension's highest, in file order. Two creates in the same dimension at the same moment can get the same position; equal positions read by name, so the order stays defined, and the next reorder renumbers them. Only `POST /analytics-categories/reorder` changes a position. Where the order applies: the values list default sort and its `/ids`, the picker lookup, the OPEX and CAPEX list filter values of the analytics columns, the report filter selects and the value exclusion picker (client side, from the values list), the values CSV export and the AI registry's default sort (`sort_order`, dimension by dimension without a dimension filter; each AI item carries `metadata.sort_order`). Report rows (by amount), the OPEX and CAPEX grid sort on an analytics column (by name) and the quick search keep their own order.
- **RLS**: all four tables are tenant-scoped (`tenant_id = app_current_tenant()`, forced). A value references its dimension by `(tenant_id, axis_id)` and a line's value references `(tenant_id, category_id, axis_id)`, so a line can only hold a value of its own tenant that belongs to the named dimension, raw SQL included.

### Dimensions

- A new tenant starts with the four recommended dimensions (`seedTenantDefaults`, `analytics/recommended-dimensions.seed.ts`; tenant creation, trial activation, reset and first start on-premise): the default dimension named as the cost pool ("Cost pool", 8 TBM cost pools), then `it_tower` "IT tower" (11 TBM towers), `purpose` "Purpose" (7 values) and `priority` "Priority" (Mandatory, High, Medium, Low). All are enabled, optional, for OPEX and CAPEX lines (`applies_to` null, values too), with a description on the dimension and on each value. The names are in the tenant's seed language, stored in `tenants.metadata.language` (`en`, `fr`, `de` or `es`) when the tenant is created: the browser language of the person who activates a trial (`Accept-Language`), `DEFAULT_TENANT_LANGUAGE` at the first start on-premise (English by default). The reset keeps the key and seeds the dimensions in that language again. The table exists in en, fr, de and es with the same codes and values (`recommended-dimensions-seed.spec.ts`). `recurrence` "Recurrence" (Recurring, One-off) is an optional pack, never seeded. A rerun creates nothing.
- Tenants created before the recommended dimensions (lot D) keep the three CAPEX dimensions they received (`analytics/capex-dimensions.seed.ts`, frozen; migration `1853980000000`): `ppe_type` "PP&E type", `investment_type` "Investment type" and `priority` "Priority", each `applies_to = 'capex'`, `required = true`. They are ordinary dimensions: renamed, extended, reordered, disabled or deleted like any other.
- GET `/analytics-axes/recommended` → `{ language, items: [{ code, present, axis_id, axis_code, name, starting, values: [{ key, english_name, name }] }] }`: the five recommended dimensions (`cost_pool`, `it_tower`, `purpose`, `priority`, `recurrence`) in that order, whether the tenant has each (`present`, with the dimension that stands for it: its id, code and name) and whether a new tenant starts with it (`starting`; `recurrence` is the optional pack). `language` is the tenant's seed language (`tenants.metadata.language`, `en` when it holds none). `values` lists the seed values of a dimension the tenant has, in the table's order: the value's stable key, its English name, and the tenant's value that stands for it (`name`: the value of that dimension whose name is the seed name of the key in one of the four languages, regardless of case, the first by position when two match; `null` when the administrator renamed or deleted it). It lets a caller that writes English names, such as the sample data loader, use a French tenant's "Matériel" for "Hardware". Empty for a dimension the tenant lacks. The cost pool is present when a dimension of code `cost_pool` exists, or when the default dimension's name is the cost pool's name in one of the four languages; the purpose when a dimension of code `purpose` exists, or else `investment_type` (an older tenant's investment type stands for it, and its name is returned); the others go by code. `analytics:admin`. Declared before the `/:id` routes.
- POST `/analytics-axes/recommended` `{ codes: string[], language: 'en' | 'fr' | 'de' | 'es' }` → `{ created: [...], existing: [...] }`, each `{ code, axis_code, axis_id, name, values_created }`. Creates the ones of `codes` the tenant lacks, named in `language`, after the tenant's other dimensions; a dimension already there is left exactly as it is (settings and values), and `purpose` is never created next to `investment_type`. The cost pool goes on the default dimension (named and filled, `axis_code: 'default'`) only while it has neither a name nor a value; otherwise it is a new dimension of code `cost_pool`. A name another dimension holds gets " (2)", " (3)"… Idempotent: a second call creates nothing. One audit entry per dimension created or named and per value created. `400` for an empty list or an unknown code. `analytics:admin`. Two calls for one tenant run one after the other (transaction advisory lock).
- GET `/analytics-axes` → `{ items }`: every dimension, disabled included, ordered by `sort_order`, then name, then code. Item: `{ id, tenant_id, code, name, description, sort_order, is_default, applies_to, required, open_values, status, disabled_at, created_at, updated_at }` (`status` is the effective one: disabled once `disabled_at` has passed).
  - Access: `reader` on any of `analytics`, `budget`, `reporting` (item forms, lists and reports need the dimensions).
- GET `/analytics-axes/:id` → the dimension plus `value_count`, `opex_count`, `capex_count` (lines holding one of its values), `opex_missing`, `capex_missing` and `unusable_for`. `analytics:reader`.
  - `opex_missing` / `capex_missing`: the OPEX / CAPEX lines of every status with no value on the dimension (no row in the link table for it), `0` for a type the dimension does not apply to. They match the list link the dimension page opens (every status, the dimension's column filtered on "no value").
  - `unusable_for`: `('opex' | 'capex')[]`, the types the dimension applies to on which none of its values can be chosen (no value that is enabled, its `disabled_at` not passed, with `applies_to` null or that type). A required dimension with such a type blocks every new line of it.
  - All three are computed whatever `required` says; the client decides when to show them.
- POST `/analytics-axes` `{ code, name, description?, sort_order?, applies_to?, required?, open_values?, status?, disabled_at? }` → as GET `/:id`. `analytics:member`.
  - `code`: 1 to 40 characters, lowercase letters, digits, `_` and `-`, starting with a letter or a digit ("Use lowercase letters, digits, - or _ (40 at most)."); unique per tenant (`400` "A dimension with code {code} already exists."). The code names the CSV column (`analytics:<code>`) and the AI key, which reads and writes a line's value on the dimension (`create_business_record` / `update_business_record`; the preview stores the dimension id, not the code); it can be changed (lines store ids).
  - `name`: required, trimmed, 200 characters at most, unique per tenant (`400` "A dimension named {name} already exists."). The labels an unnamed default shows ("Analytics dimension", "Dimension analytique", "Analysedimension", "Dimensión analítica", any case) are refused for any other dimension (`400` "This name is reserved for the default dimension.").
  - `sort_order`: optional whole number (`400` "Order must be a whole number."); when omitted the new dimension goes last (`max(sort_order) + 1`). The app no longer sends it: it orders dimensions through `/reorder`. API clients may still set it on POST and PATCH.
  - `applies_to`: `'opex'`, `'capex'` or `null` (both, the default and the stored value NULL). Anything else is a `400`. The default dimension always applies to both: a non-null value on it is a `400` "The default dimension applies to OPEX and CAPEX lines." (`applies_to`), and a CHECK keeps it so in the database. On PATCH, `null` clears it and an absent field keeps it. Limiting a dimension to one type while some of its values are limited to the other is a `400` on `applies_to` that names the values, up to three, then "and N more": "2 values of this dimension are for CAPEX lines only (Matériel, Projet). Set them to OPEX and CAPEX first." (singular: "1 value of this dimension is for CAPEX lines only (Matériel). Set it to OPEX and CAPEX first.")
  - `required`: boolean, default `false` (column `analytics_axes.required boolean NOT NULL DEFAULT false`, migration `1853920000000`); anything else is a `400`. On PATCH an absent field keeps it. The default dimension may be required. A dimension is required for a line type when `required` is true, the dimension is enabled (effective status) and it applies to the type (`axisRequiredFor` in `analytics/analytics-axes.util.ts`, mirrored in the frontend `useAnalyticsAxes`). A disabled dimension keeps the setting, which is then ignored. There is one setting per dimension: no "required for CAPEX only" on a dimension used by both types. The line write rules below enforce it; `missingRequiredDimensions` (`spend/item-analytics.util.ts`) lists the required dimensions a set of values leaves empty, with no database access.
  - `open_values`: boolean, default `false` (column `analytics_axes.open_values boolean NOT NULL DEFAULT false`, migration `1854700000000`; data-scoped access). On PATCH an absent field keeps it. Open: anyone who may modify a budget line adds a value, from the line's picker (`POST /analytics-categories/from-line`) or the budget file. Closed (every dimension by default, the recommended ones included): values come from the dimension page; the budget file creates an unknown value for a person with access to all data and refuses it to a limited person. Writing the dimension, this field included, is reserved to people with access to all data.
  - `GET /analytics-axes` is not filtered by type: the admin screens need every dimension. The clients show the dimensions that apply to a line type (`applies_to` null or equal to the type). The same filter applies to the OPEX and CAPEX list columns, filters and quick search, the report pickers and the AI query fields (`budget_lines`, whose `analytics:<code>` fields cover both natures). The budget file has a column for every enabled dimension (one file for both natures, lot C1b); a row takes a value only on the dimensions of its nature.
- PATCH `/analytics-axes/:id` (any subset of the create fields; `is_default` is ignored) → as GET `/:id`. `analytics:member`.
  - On the default dimension, `name` may be cleared (`null` or blank, stored `null`); a lifecycle change is refused (`400` "This dimension cannot be disabled: older files and AI questions use it.").
  - An unchanged body writes nothing (no audit row).
- POST `/analytics-axes/reorder` `{ axis_ids: string[] }` (at most 1,000 ids) → `{ items }`: every dimension, disabled included, in the new order (same item shape as GET `/analytics-axes`). `analytics:member`, the permission of PATCH; declared before the `/:id` routes.
  - `axis_ids` go first, in the order given; the dimensions missing from the list follow in their current order. All dimensions are then renumbered 1..n in one `UPDATE … FROM unnest(…) WITH ORDINALITY`, which writes only the rows whose position changes, inside the request transaction.
  - Refusals (`400`, field `axis_ids`): not a list "The dimensions must be a list."; the same id twice "Each dimension can appear only once in the order."; an id that is not a dimension of the tenant "A dimension in this order does not exist. Reload the page and try again."
  - Locks: every dimension of the tenant `FOR NO KEY UPDATE ORDER BY id`. A dimension update (`FOR UPDATE`) and a value write (which holds its dimension `FOR SHARE`; the values CSV import locks every dimension it writes to in id order first) wait for the reorder, or the reorder waits for them. Line writes never lock a dimension and go on during a reorder.
  - The dimensions keep their `updated_at`. Audit: one row per dimension whose position changed (`analytics_axes`, the axis id, action `update`, `before` and `after` `{ sort_order }`). Sending the current order writes nothing.
- DELETE `/analytics-axes/:id[?force=true]`. `analytics:admin`. `409` for the default dimension ("This dimension cannot be deleted: older files and AI questions use it."), with or without `force`. Without `force`, `409` while the dimension has values ("Nature still has 3 values. Delete them first."). With `force=true`, in the request transaction: the budget lines' values on the dimension (`spend_item_analytics_values`, both natures), then its values, then the dimension are deleted (`analytics/analytics-forced-delete.ts`). Locks: the lines holding one of its values (both natures, id order), then the values (id order), then the dimension. The link statement triggers bump each line's `row_version` once and refresh its search entry. Audit: the dimension's `delete` row has `after: { forced: true, values, lines, opex_lines, capex_lines }` (distinct lines); each value gets a `delete` row with its own `lines`, `opex_lines`, `capex_lines`; each line gets an `update` row on `spend_items` or `capex_items` with `row_version` and `analytics_values` before and after and `operation: 'analytics_dimension_delete'`, `axis_id`, `axis_name`. A required dimension deleted no longer applies to any write. The AI and the CSV import never delete a dimension.

### Values

- GET `/analytics-categories?axis_id=&page=&limit=&sort=sort_order:ASC&q=&filters=&status=&includeDisabled=` → `{ items, total, page, limit }`; items `{ id, tenant_id, axis_id, name, description, sort_order, status, disabled_at, applies_to, created_at, updated_at, opex_count, capex_count }` (`sort_order` read only; `opex_count` and `capex_count` are the OPEX and CAPEX lines holding the value, which the values grid's bulk delete confirms on; the AI list reads the same page without them).
  - `axis_id` restricts to one dimension. Default scope: enabled values; `status=enabled|disabled` or a `status` set filter picks one, `includeDisabled=1|true` lifts the default scope.
  - Sort: `sort_order` (the default), `name`, `description`, `applies_to`, `status`, `disabled_at`, `created_at`, `updated_at`. `sort_order` first sorts by dimension, in the dimensions' own order (their `sort_order`, name, code, id), so the values of two dimensions never interleave in a list without `axis_id`; then by the value's `sort_order`, its name (ICU order) and id. Every key follows the direction, so `sort_order:DESC` is the exact reverse; the other fields break ties on the id. Filters (grid model, set or text): `name`, `description`, `applies_to` (set filter, a blank entry matches the NULL rows), `axis_code`, `axis_name` (the dimension's name, "Analytics dimension" for an unnamed default). Quick search on name and description.
  - Access: `reader` on any of `analytics`, `budget`, `reporting`.
- GET `/analytics-categories/ids` (same query) → `{ ids, total }` (at most 10,000 ids). Same access.
- GET `/analytics-categories/:id` → the value (with `sort_order`) plus `axis_name`, `axis_code`, `axis_is_default`, `opex_count`, `capex_count`. Same access.
- POST `/analytics-categories` `{ axis_id?, name, description?, applies_to?, status?, disabled_at? }` → as GET `/:id`. `analytics:member`.
- POST `/analytics-categories/from-line` `{ axis_id, name, line_id?, paying_company_id?, cost_center_id? }` → as GET `/:id` plus `created: boolean`. The line's picker: the value of `name` in the dimension, found regardless of case (`created: false`) or created enabled, for both line types, last in the dimension (`created: true`, one audit row). `budget:member`. `line_id` names the line the value goes on: it must be readable (`404` "Budget line not found." otherwise) and modifiable by a limited person (`403 DATA_ACCESS_LIMITED` "This line is read only in your access."); a line being created names its place instead, which a limited person must be allowed to place a line in (`403 DATA_ACCESS_LIMITED` "This company or cost center is not part of your access."). A dimension with a closed list (`open_values` false) creates nothing from a line: `403 DATA_ACCESS_LIMITED` for a limited person, `400` ("… has a closed list of values. Add the value on its page, or turn on open values.") otherwise; an existing value is still found. A disabled dimension: `400`. Not reserved to people with access to all data.
  - The new value goes last in its dimension (`max(sort_order) + 1`). A `sort_order` in the body is dropped by the validation whitelist, as on PATCH.
  - Without `axis_id` the value goes into the default dimension. The dimension is resolved in the tenant (`400` "Dimension not found.") and must be enabled ("The Nature dimension is disabled. Enable it to add values.").
  - Name unique within the dimension (`400` "A value named {name} already exists in {dimension}.", where an unnamed default reads "the analytics dimension").
  - `applies_to`: `'opex'`, `'capex'` or `null` (both, the default and the stored value NULL). Anything else is a `400`. A value may not be limited to the type its dimension excludes: `400` "The Nature dimension is for OPEX lines only." (`applies_to`), on create, update and CSV import. A value limited to the dimension's own type is accepted. On PATCH, `null` clears it and an absent field keeps it.
- PATCH `/analytics-categories/:id` (`name`, `description`, `applies_to`, `status`, `disabled_at`) → as GET `/:id`. `analytics:member`. `axis_id` is accepted only when equal to the stored one (`400` "A value cannot move to another dimension."). An unchanged body writes nothing. `sort_order` is not writable here: use `/reorder`.
- POST `/analytics-categories/reorder` `{ axis_id, value_ids: string[] }` (at most 10,000 ids) → `{ items }`: every value of the dimension, disabled included, in the new order (same item shape as the list). `analytics:member`, the permission of PATCH; declared before the `/:id` routes.
  - `value_ids` go first, in the order given; the dimension's values missing from the list follow in their current order. The dimension is then renumbered 1..n in one `UPDATE … FROM unnest(…) WITH ORDINALITY`, inside the request transaction.
  - Refusals (`400`, with `field`): an unknown dimension in the tenant "Dimension not found." (`axis_id`); `value_ids` not a list "The values must be a list."; the same id twice "Each value can appear only once in the order."; an id that is not a value of that dimension in the tenant (another dimension, another tenant, unknown) "Only values of the Nature dimension can be ordered in it." ("… of the analytics dimension …" for an unnamed default) (`value_ids`). A disabled dimension can be reordered.
  - Locks: the dimension's values `FOR NO KEY UPDATE ORDER BY id`, then the dimension row `FOR NO KEY UPDATE` (a concurrent create holds it `FOR SHARE`), then the values again, so a value created meanwhile is numbered too. A line write takes `FOR KEY SHARE` on the value it links, which `NO KEY UPDATE` does not block: lines and budget file loads go on during a reorder. Every value write that also locks the dimension locks its existing values first (an edit its value, the values CSV import every existing value it writes, in id order, before its first write), so the lock order is always values, then dimension.
  - The values keep their `updated_at`. Audit: one row on the dimension (`analytics_axes`, the axis id, action `update`) whose `before` and `after` are the ordered value names, written only when the order changes; no row per value. Sending the current order writes nothing.
- DELETE `/analytics-categories/:id[?force=true]`. `analytics:admin`. Without `force`, `409` while a line holds the value ("Licences is used by 3 OPEX lines and 1 CAPEX line. Disable it instead."). With `force=true`: the lines lose the value (locks: the lines, then the value), then it is deleted; one `row_version` bump and search refresh per line, a value `delete` row with `after: { forced: true, lines, opex_lines, capex_lines }`, one line `update` row each (`operation: 'analytics_value_delete'`, `axis_id`, `category_id`, `category_name`). Disabling stays possible. The AI and the CSV import never delete a value.
- DELETE `/analytics-categories/bulk` `{ ids, force? }` (at most 1,000) → `{ deleted, failed: [{ id, name, reason }] }`. `analytics:admin`. Each value is deleted under its own savepoint: a refused one leaves the others deleted. With `force: true` the values in use go too, as the single delete with `force`; the lines holding any of the values are locked first, all at once.
- GET `/analytics-categories/export?scope=data|template&language=…`. `analytics:admin`. Headers `axis_code, name, description, status, disabled_at, applies_to` (`applies_to` is last and optional on import: an absent column leaves the stored settings, an empty cell clears the setting, any word other than `opex` or `capex` is a row error "Invalid applies_to 'x'. Use 'opex', 'capex' or leave it empty."; the separator follows the language), every value of every dimension (disabled included), dimension by dimension in the dimensions' order, each dimension's values in their order. No column carries the position.
- POST `/analytics-categories/import?dryRun=true|false&language=…&dateOrder=…&decimalMark=…` (multipart `file`). `analytics:admin` → `{ ok, dryRun, total, inserted, updated, unchanged, errors: [{ row, message }] }`, plus `notices` and `ignoredColumns` (same shared master-data contract as `/companies/import`).
  - Only `name` is required; an absent column keeps what is stored. A blank `axis_code` is the default dimension; an unknown code is a row error. In a disabled dimension a row identical to the stored value passes as `unchanged`; a new value or an edit there is a row error ("The Nature dimension is disabled. Enable it or leave it out.").
  - Rows match on (dimension, name), case-insensitively; the same pair twice in the file is a row error.
  - Existing values keep their position. New values are created through the service, one by one in file order, so each goes last in its dimension.
  - The whole file is validated before any write; nothing is written when a row fails. A row identical to the stored value is counted `unchanged` and writes nothing. Exporting and re-importing the same file reports every row unchanged.
- The AI master-data tools create and update values through the same service: a value created without a dimension lands in the default one, and a name used in two dimensions is the usual "several matches" error. The create accepts `dimension`: the dimension's code, its `analytics:<code>` key or its name (case-insensitive), and for the default dimension also `analytics_category` or its reserved label; an unknown or ambiguous reference is refused. The preview refuses a disabled dimension and a value `applies_to` that conflicts with the dimension, before approval. On update, `dimension` naming the value's current dimension is accepted as no change, and any other is refused, since a value cannot move to another dimension.

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

### Applications of a process
- GET `/business-processes/:id/applications` → `{ items: [{ id, name, reference, criticality, lifecycle, it_owner_names, created_at }] }` (`business_processes:reader`; `items` is `null` without `applications:reader`, a Business Contributor's applications only).
- POST `/business-processes/:id/applications` `{ application_id }` and DELETE `/business-processes/:id/applications/:applicationId` → `{ ok, changed }` (`business_processes:member` and `applications:reader`, 403 otherwise; an application outside a Business Contributor's scope is a 400). Idempotent; the process row is locked first; one audit row on `application_business_processes` per change. The application's side is the `processes` section of `GET /applications/:id/relations`.

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

## Budget lines (both natures)

These neutral routes use the existing budget SQL list engine with an explicit `all` scope. The `/spend-items` and `/capex-items` routes retain their contracts and nature-specific behavior. All reads stay within the request's tenant. Consolidation fields retain the accounts reader gate used by the existing lists.

| Route | Required access | Response |
|---|---|---|
| GET `/budget-lines/summary` | `budget:reader` | `{ items, total, page, limit }` |
| GET `/budget-lines/summary/totals` | `budget:reader` | Amount totals, `reportingCurrency` and `fxMissing`, plus requested FTE totals |
| GET `/budget-lines/summary/filter-values` | `budget:reader` | `{ [field]: [value, ...] }`, including `nature` |
| GET `/budget-lines/summary/ids` | `budget:reader` | `{ ids, item_numbers, total }` |
| GET `/budget-lines/summary/neighbors` | `budget:reader` | `{ index, total, prev, next }`; neighbors are `{ id, item_number, nature }` or `null` |
| POST `/budget-lines/summary/hidden-by-value` | `budget:reader` | `{ counts: { [valueId]: n } }`: the lines of each dimension value the person cannot read; empty outside limited mode |
| POST `/budget-lines/summary/aggregate` | `budget:reader` | `{ groups, others, total, groupCount, reportingCurrency, fxMissing }` |
| GET `/budget-lines/resolve/:ref` | `budget:reader` | `{ id, nature, reference }` |
| DELETE `/budget-lines/bulk` | `budget:admin` | `{ deleted, failed }` |
| GET `/budget-lines/budget-file/export` | `budget:admin` | CSV attachment `budget.csv`, or `budget.xlsx` with `format=xlsx`; the lines of both natures, with the parameters of the [Budget file](#budget-file-opex-and-capex) export |

`POST /budget-lines/summary/hidden-by-value` counts, for each value of the dimension, the budget lines the person may not read, without naming them. The body is `{ axis: <uuid>, values: [<uuid>, ...], year?: <yyyy>, scope: "all" | "opex" | "capex" }`: `values` holds at most 500 UUIDs, else a 400; `scope` is required and `year` is the report's first year (default: the server's current year - 1, within the same ten-year reach as the aggregate). The window is the engine's `windowScope`: a line with no end of validity or one ending on or after 1 January UTC of `year` is counted. The function answers a value only when at least one line the person may read holds it in the same tenant, dimension, window and nature, so a value no line of theirs carries answers nothing. `scope` also selects the nature, on the CAPEX and OPEX tabs. The answer is `{ counts: { [valueId]: n } }`; outside limited mode it is `{ counts: {} }` and no counting query runs. Only values of the requested dimension and tenant answer; a value with no hidden line is absent, which the caller reads as zero.

The summary routes take the same query parameters and response shapes as their `/spend-items/summary` equivalents: `page`, `limit`, `sort`, `q`, `filters`, lifecycle/status options, `years`, `shape`, `amounts`, `fte` and saved filter `ctx`, as applicable to each route. The summary uses the existing year-window default; ids and neighbors use the existing enabled-lines default. The native row has `product_name` as its title, `description` as its description, `item_number` as its shared BL number, `nature` (`opex` or `capex`), `reference` (`BL-n`) and `legacy_number`. `shape=grid` preserves these fields. Nature supports set filtering and sorting; filter values include both natures subject to the other filters. Analytics columns include shared and nature-specific dimensions. Quick search matches existing text plus `BL-n`, a bare BL number and case-insensitive legacy `OPX-n` and `CPX-n` references.

Plaid search, entity summaries, query results and mentions cite the budget lines of both natures
as `BL-n`. Search accepts `BL-n`, and resolves persisted `OPX-n` and `CPX-n` legacy references to
the native reference, including after a type change. Numbered budget mentions search the one AI
entity family `budget_lines`, which reads both `spend_items` and `capex_items` index types and
needs the single `budget` reader right; a result, a detail or an aggregate says the line's `nature`.
The search index stores `ref_prefix = BL`, the native `item_number` as `ref_number`, and the
persisted `legacy_number` in its searchable text.

Aggregate body: `{ query, spec }`, with the same validation, limits and measures as the existing aggregate route. `groupBy: ['nature']` returns one group per selected nature. This POST is read-only and remains available to frozen subscriptions.

Neighbors take `id` as a UUID or any reference accepted by the neutral resolver. Resolution accepts a tenant line UUID, case-insensitive `BL-n` or a bare number by `item_number`, and `OPX-n` or `CPX-n` by `legacy_number`. A reclassified line keeps resolving through its persisted legacy reference. Malformed references answer 400; missing or foreign-tenant lines answer 404.

Bulk-delete body: `{ ids: string[] }`, identical to the existing bulk route. A mixed selection delegates each line to its nature's delete service, including its existing freeze, cleanup, savepoint and audit behavior. Unknown and foreign-tenant ids are reported as existing per-item failures, without revealing the foreign line.

Budget-file export takes the same filtering and file options as the existing export (`all`, `language`, `amountYears`, `columns`, `detail`, list parameters and `ctx`). It reads the filtered ids from the neutral list and explicitly exports both natures. The file name, format and headers are unchanged. `all=true` (or `1`) keeps the existing export's meaning of dropping list filters. Existing nature-specific exports and import/preflight routes keep their behavior.

## Spend Items & Versions (OPEX)
- `:id` on every route under `/spend-items/:id` (GET, PATCH, DELETE, and the share, yearly-totals, versions, tasks, contracts, projects, applications, links, attachments and contacts routes) is a UUID, an `OPX-n` reference, its neutral twin `BL-n` (same number) or the plain number; every route under `/capex-items/:id` takes a UUID, `CPX-n`, the plain CPX number or the line's `BL-n`. A malformed id is a `400` "Invalid item reference: …", a reference of the other prefix a `400` "Invalid reference for capex: expected CPX-N, got OPX-12", an unknown reference a `404`
- Every budget line, OPEX and CAPEX, is stored in `spend_items` with its `nature` since lot Z1 (see `doc/architecture.md`, "Budget Line Nature"). `/spend-items` serves OPEX lines only, `/capex-items` and `/capex-versions` CAPEX lines only: a line of the other nature answers `404` on every route addressed by its id or reference, or by the id of its version, attachment or link (`/spend-versions/:id/*`, `/spend-items/attachments/:attachmentId` and their CAPEX twins), and no list, summary, total, aggregate or report of the other nature counts it
- `reference`: every line of both natures carries `BL-n` (its `item_number`, one numbering for both natures) on the detail, the create and update responses, the plain lists and the summary rows (full and grid shapes). The OPEX lines keep `item_number` = n and the `OPX-n` reference; the CAPEX routes keep the CPX number (below)
- POST `/spend-items` → create item
- PATCH `/spend-items/:id` → update item (any subset of the writable fields)
- GET `/spend-items/:id` → detail (every item column, `cost_center_id`, `run_build` and `nature` included) plus the analytics values:
  - `nature`: `opex`, read-only (the API never writes it: a line created through `/spend-items` is OPEX). The plain list and the summary rows (full shape) carry it too; the grid shape (`shape=grid`) does not
  - `analytics_values: [{ axis_id, axis_code, axis_name, is_default, category_id, category_name }]`: every dimension the line holds a value on (disabled dimensions included), in dimension order; `axis_name` is `null` on the default dimension while it has no name
  - `analytics_category_id`, `analytics_category_name`: the default dimension's value, `null` when the line has none. They are read from the line's analytics values; the item column of the same name is no longer read or written (it stays in the database for one release)
  - The create and update responses carry the same fields
  - The GET detail (OPEX and CAPEX) adds `references: { supplier, paying_company, account, owner_it, owner_business, cost_center }`: the labels the workspace pickers show, in the shapes of the reference lookups (below), each `null` when the line has none (`cost_center`: `{ id, code, name, kind, status, company_id, company_name, owner_user_id, owner_name }`, the effective status, the company and the budget holder). One statement, so the workspace never loads a picker's list, the cost center tree or a user record to show the chosen value
- GET `/spend-items/:id/relation-counts` (same on `/capex-items/:id/relation-counts`) → `{ contracts, applications, technologies, assets, projects, links, attachments, total }`: the counts of the Relations tab, in one statement (the tab badge shows `total`). `technologies` and `assets` are counted, and in `total`, for a caller who reads `infrastructure` only (`null` otherwise). `assets` counts the linked assets of the line's nature (`asset_spend_items`). The tab shows its Technologies and Assets sections to that caller only
- GET `/spend-items/:id/meta` (same on `/capex-items/:id/meta`, the detail's read level) → `{ id, row_version, changed_by: { id, name } | null, changed_at, versions: [{ id, budget_year, budget_rev, changed_by, changed_at }] }` (versions in year order): what the workspace polls every 30 seconds to see that someone else changed the line or its budget (lot 3G). `changed_by` / `changed_at` of the line: the audit row that wrote the current `row_version` (among the line's 50 newest), null when no audit row explains it; of a version: when its `budget_rev` last moved, and the first audit row about it written since (null when nothing logged the change). `changed_by.name`: first and last name, null for a user without one (never the e-mail). One statement, bounded whatever the line's history; `404` when the line is not in the tenant
- GET `/spend-items` and GET `/capex-items` (the plain lists the pickers use) carry the item columns plus `analytics_category_id` and `analytics_category_name` of the default dimension, read the same way. `/spend-items` breaks ties of its sort by `id` (descending), so lines that share a `created_at` keep one order from page to page
- Writable fields and write rules (OPEX and CAPEX alike, `spend/item-write.util.ts`; the UI, the API, the AI and the budget files all go through them):
  - OPEX: `product_name, description, supplier_id, paying_company_id, account_id, currency, effective_start, owner_it_id, owner_business_id, analytics_values, analytics_category_id, project_id, contract_id, cost_center_id, run_build, notes`, plus the lifecycle inputs `status`, `disabled_at` and the deprecated `effective_end`
  - CAPEX: `description, supplier_id, paying_company_id` (legacy alias `company_id`)`, account_id, currency, effective_start, owner_it_id, owner_business_id, analytics_values, analytics_category_id, project_id, cost_center_id, run_build, notes`, plus the same lifecycle inputs. The PP&E type, investment type and priority are the values of the dimensions of codes `ppe_type`, `investment_type` and `priority` (lot C1), sent in `analytics_values` like any dimension; a body that still names `ppe_type`, `investment_type` or `priority` is not written (dropped like any unknown key)
  - Any other key (`id`, `tenant_id`, `item_number`, timestamps, unknown keys) is dropped, never refused
  - Every id is resolved in the current tenant; an unknown id, or an id of another tenant, is a `400` "<Field> not found." (`Paying company`, `Account`, `Supplier`, `Analytics category`, `IT owner`, `Business owner`, `Project`, `Contract`, `Cost center`)
  - `analytics_values: { [axis_id]: category_id | null }` (`spend/item-analytics.util.ts`): each named dimension takes the value, `null` clears it, an omitted dimension is untouched. The dimension must be one of the tenant's ("Analytics dimension not found.") and enabled ("The Nature dimension is disabled. Enable it or leave it out."); on a disabled dimension the line's unchanged value, or `null` where the line has none, passes as a no-op, and only a real change is refused. A dimension that does not apply to the line's type (`applies_to` set to the other type) is refused the same way: the held value, or `null` where the line has none, is a no-op, anything else is a `400` "The Recurrence dimension is for CAPEX lines only. Leave it out." (dimension name, other type); when a dimension is both disabled and not applicable, this message wins. The line detail endpoints still return every held value; the list rows and summaries carry only the dimensions that apply to the line's type. The value must be one of the tenant's ("Analytics value not found.") and belong to that dimension ("Hardware is not a value of the Nature dimension."; "… of the analytics dimension." for the default dimension while it has no name); a disabled value is refused as a new assignment ("This value is disabled.") and kept as the line's current one. A value whose `applies_to` is the other type is refused the same way (`400` "Abonnements SaaS is for OPEX lines only. Choose a value for CAPEX lines.") and kept as the line's current one; clearing stays allowed. The same check covers `analytics_category_id`, the budget file (a row error on the `analytics:<code>` cell; there a cell on a dimension of the other nature is refused even when it repeats the held value, which the export never writes) and the AI writes. The value is read `FOR KEY SHARE`: a value deleted meanwhile makes the save wait, then answer "Analytics value not found."
  - Required dimensions (`axisRequiredFor` the line's type, see [Dimensions](#dimensions)): a create must end with a value on each of them, counting `analytics_values` and the legacy `analytics_category_id` on the default dimension; the check runs even when the body names no dimension. An update that sends `null` on a required dimension where the line holds a value is refused. Both answer `400` "The Nature dimension is required. Choose a value." ("The analytics dimension is required. …" for an unnamed default), for the first dimension in dimension order. `null` where the line holds no value stays a no-op, and a line that lacks a value is never refused for it on any other change. Known edge: undoing "set a value on a line that had none" on a required dimension is refused the same way.
  - `analytics_category_id` (legacy) is the default dimension's value (`null` clears it); sent with a different value for the default dimension in `analytics_values`: `400` "Send the analytics category once: analytics_category_id and analytics_values disagree."
  - The values are written after the line, in the same transaction; a change of analytics values alone is an edit (`updated_at`, audit). Audit snapshots carry `analytics_values` as `{ [axis_id]: category_id }` and `analytics_category_id`
  - `cost_center_id`: a new value must name an enabled cost center, not a group (`400` "Choose a cost center, not a group." / "This cost center is disabled."); the line's current value is always kept, disabled or not
  - `run_build`: `run`, `build` or `null` (case-insensitive); anything else is a `400`
  - A line with a cost center and no paying company takes the cost center's company (this satisfies "paying company required" on create); an explicit different company is kept. Without either: `400` "Paying company is required."
  - A create requires `effective_start` (`YYYY-MM-DD`). A missing or invalid date is `400` `{ message: "effective_start: Date must be in YYYY-MM-DD format", field: "effective_start" }`. `POST /spend-items` and `POST /capex-items` check the zod schema and still pass the original body, so `status` and the other lifecycle keys stay. `POST /budget-lines` (both natures, column names) and the other create paths (the AI, the budget file, a change of type) hit the same check in the write gate. An update that omits the date keeps the stored one.
  - The chart of accounts check (the account must belong to the paying company's chart) runs on create, and on update when the resulting company or account differs from the stored one; a line already mismatched still takes unrelated edits
- **Change the type of a line** (lot M, `spend/budget-line-type-change.service.ts`; same routes under `/capex-items/:id` for a CAPEX line) **[Requires: budget:member]**:
  - GET `/spend-items/:id/change-type/check?from_year=` → what the dialog shows for a change starting in `from_year` (none: the line's first year): `{ id, reference, row_version, from_nature, to_nature, first_year, last_year, years, from_year, mode, dated_refusal, blockers, account, dimensions, carried, successor }`
    - `first_year` / `last_year`: the smallest and largest `budget_year` of the line's versions (`null` without a version). `years`: the years the change may start from, the first one then the later ones offered. `mode`: `in_place` (from the first year, or a line without a version) or `dated` (a later year)
    - A later year N is offered when the line has a version in N or after, starts before 1 January N, is still valid on 1 January N and has no successor. `dated_refusal` says why none is (`successor`, `no_later_year`, `ends`, `starts`), `null` otherwise
    - `blockers: [{ year, column, column_name, nature }]`: each frozen column, of either nature, where the line holds a non-zero amount in a year that changes (every year in place, N and after when dated)
    - `account: { id, account_number, account_name, fits, carried } | null`: the line's account, whether it suits the new type (`fits`), and whether a dated change copies it to the new line (`carried`: it fits, is enabled and is on the paying company's chart)
    - `dimensions: [{ axis_id, axis_name, reason, required, current }]`: the enabled dimensions of the new type the dialog asks for: `reason: 'required'` (required for the new type and empty, or, dated, not copied), `reason: 'value_other_type'` (the line holds a value for the old type only, `current`); `required: true` when the new line cannot do without it (dated)
    - `carried: { versions, tasks, attachments, links, contacts, applications, assets, contracts, projects, requests }`: what goes to the line of the new type: in place, everything; dated, the versions from `from_year`, the contacts and the five link families (copied), and 0 for `tasks`, `attachments` and `links` (web links), which stay on the old line
    - `successor: { id, reference, nature, from_year } | null`: the line that already continues this one
  - POST `/spend-items/:id/change-type` with `{ row_version, from_year?, account_id?, analytics_values?, reason? }` → `{ id, reference, nature, predecessor_id? }`, `200`
    - `row_version` (required): the one the check returned. A line changed since: `409` `edit_conflict` (`conflicts: []`, the current `row_version`)
    - In place (`from_year` empty or the first year): the line keeps its id, `BL-n`, history, versions, allocations, links, contacts, attachments and tasks; its `nature` changes, its tasks change type (`spend_item` ↔ `capex_item`), its search entry moves. Reaching CAPEX, a line without a CPX number gets the next one (what the CAPEX routes show as its `item_number`); back in OPEX it keeps it, and takes it again later. `account_id` and `analytics_values` follow the write rules of an update for the new type (an account chosen must suit it, a value chosen must apply to it; a held value or a missing required value is not refused); without them nothing is checked and the line keeps its account and values. `account_id: null` is refused in place (`400` "Choose an account, or leave the field as it is."): leave the key out to keep the account
    - From a later year N: the line ends on 31 December N-1 (`disabled_at` noon UTC) and keeps its versions before N. A new line of the other type is created with the rules of a creation (a required dimension missing, an account for the other type, a disabled cost center: `400`): title, description, company, supplier, owners, project, currency, run or build, notes; the account and cost center when they suit it (or the `account_id` given, `null` for none); the values that apply to the new type plus `analytics_values`; `effective_start` 1 January N; the old line's end of validity when it ended later. It takes the versions of N and after (their months, totals, column rounds and allocations, same ids), the old line's contacts and links to applications, assets, contracts, projects and requests (copied); tasks, attachments and web links stay. It names the old line (`predecessor_id`, answered)
    - `409` `budget_frozen` with `blockers` when a frozen column refuses it; `400` for a year the line does not offer (with the reason), a reason over 1,000 characters; `404` for a line of the other nature, as every route
    - Audit: one row per line under the label of its nature after the change, `action: 'update'`, its `after_json` with `operation: 'change_type'`, `from_nature`, `to_nature`, `from_year`, `from_reference`, `to_reference` (as each type's screens show the lines), `reason`, and `successor_id` / `predecessor_id` (dated). The new line's row also has `copied: { contacts, applications, assets, contracts, projects, requests }`, each `{ count, items: [{ id, name }] }` (contacts with their `role`; projects and requests named `PRJ-n: name`, `REQ-n: name`); no audit row per copied link. The new line also gets its creation row
  - GET `/spend-items/:id` and GET `/capex-items/:id` add `lineage: { predecessor: { id, reference, nature } | null, successor: { id, reference, nature, from_year } | null }`: the line this one continues and the line that continues it
- **Budget file** (`/spend-items/budget-file/*` and `/capex-items/budget-file/*`): one file for both natures, detailed under [Budget file](#budget-file-opex-and-capex). The old `GET /spend-items/export`, `POST /spend-items/import` and their CAPEX twins are gone.
- POST `/spend-items/:id/versions` with `{ version_name, as_of_date, input_grain, budget_year?, allocation_method?, allocation_driver? }`
  - `budget_year` defaults to `as_of_date` year; one version per (item, year)
  - `allocation_method` defaults to `default`; `allocation_driver` defaults to `headcount`
- PATCH `/spend-items/:id/versions` with `{ id, ...updates }`
  - `budget_year` immutable; `allocation_method` can change

## Native budget line detail and writes

The neutral routes use the same contract for OPEX and CAPEX lines. Child routes remain under
`/spend-items*` and `/capex-items*`.

| Route | Permission | Behaviour |
|---|---|---|
| GET `/budget-lines/:ref` | `budget:reader` | Read a line by UUID, `BL-n`, bare BL number, `OPX-n` or `CPX-n` |
| POST `/budget-lines` | `budget:member` | Create a line with required `nature: 'opex' \| 'capex'` |
| PATCH `/budget-lines/:id` | `budget:member` | Update native fields, optionally with a per-field `base` |

All three return `product_name` (title), `description`, `notes`, `item_number` (BL number),
`reference` (`BL-n`), `legacy_number`, `nature`, `contract_id`, and the existing detail fields
(including `analytics_values`, `references` and `lineage`). `contract_id` is `null` for CAPEX;
writing that key on a CAPEX line, including `null`, returns `400`. Writing `nature` in PATCH
returns `400`: change the type through the existing `change-type` routes.

Create and update delegate to the existing service for the line's nature with native column
names. The same reference, account and required-dimension validations apply. PATCH uses the
existing field conflict rules: optional `base` values are compared under the line lock;
conflicting fields return `409 edit_conflict`. No `row_version` is required. Metadata remains
editable when the line's amounts are frozen. Unknown lines and lines of another tenant return
`404`.

Native writes record native fields in the audit log, under the existing nature-specific table
label (`spend_items` or `capex_items`). Legacy route writes retain their audit shape. The legacy
`/capex-items` alias keeps `description` as the title and its CPX `item_number`. The description
of a CAPEX line is read through `/budget-lines/:ref`; `/capex-items` does not expose it.

GET `/budget-lines/owner-suggestions?cost_center_id=<uuid>` (`budget:member`) returns the enabled
people who hold at least the reader right on `budget` and read the cost centre: a limited person
whose access node covers it (the centre, a parent group, its company, or `all`), or an unscoped
person (`data_access_mode = 'all'`, or an Administrator). A limited caller only asks about a centre
it reads (`read_all`, or its unfolded read nodes), can place a line on
(`data_access_placable_line`), or names the readable line placed on it through `line=<ref>` (a
hidden line is `404`); outside those cases the answer is empty, like an unknown centre. The group is
also empty when it would leave nobody out among the enabled people with the budget right, as in a
tenant without scoped access. The rows keep the `/users/lookup` columns and order, names only, in
`{ items, has_more }`: at most 500 rows, `has_more: true` beyond. A missing or malformed cost centre
is `400`. The owner pickers of a line use this list as their first group and still offer every
enabled person. The line's paying company is not part of this rule: a person who reads the line
through it is not proposed unless they also read the centre.

## Budget line relations

GET `/budget-lines/:id/relations` (`budget:reader`) returns the Relations tab of an OPEX or a CAPEX line in one round trip. `:id` is a UUID, `BL-n`, a bare BL number, `OPX-n` or `CPX-n`, the same resolver as GET `/budget-lines/:ref`. A missing line is `404` "Budget line not found". A malformed reference is `400` "Malformed budget line reference".

The nature is the line's. A section the caller cannot read is `null`. Contacts, web links and attachments stay on their current routes.

| Field | Read | Contents |
|---|---|---|
| `projects` | `portfolio_projects` | Linked projects: `{ id, item_number, name, status, planned_end }`. A Business Contributor sees the projects they take part in |
| `applications` | `applications` | `{ id, reference, name, lifecycle, business_criticality, status }` (`reference` is `APP-n`). A Business Contributor sees the applications they take part in |
| `technologies` | `infrastructure` | `{ id, reference, name, family, vendor }` (`reference` is `TEC-n`, `vendor` is the editor) |
| `contracts` | `contracts` | Linked contracts: `{ id, name, supplier_name, end_date, yearly_amount, currency, auto_renewal, in_renewal_window, status }` |
| `assets` | `infrastructure` | `{ id, reference, name, kind, environment, status }` (`reference` is `AST-n`), the links of the line's nature |
| `suggestions` | applications and contracts reads | See below |

`suggestions` lists applications and contracts of the line's supplier that are not linked yet, at most 20 of each rule, then merged by name. An application is in service (`status` enabled, and `disabled_at` unset or still to come) and is offered to a reader of the applications, inside a Business Contributor's participation scope. A contract is active under the same status rule and is offered to a reader of the contracts. Contracts have no participation scope. A line with no supplier has `suggestions: []`. Each row is `{ type: 'application' | 'contract', id, reference, name, via: { kind: 'same_supplier', label: null } }`. `reference` is `APP-n` for an application and `null` for a contract, which has no business reference.

POST `/budget-lines/:id/relations/:kind` with `{ id }` and DELETE `/budget-lines/:id/relations/:kind/:targetId` (`budget:member`) link or unlink one row. `kind` is `projects`, `applications`, `technologies`, `contracts` or `assets`. Anything else is `404` "Unknown relation type." The kind also needs a read of its module: `403` "You cannot read technologies." for technologies, `403` "You cannot read this module." for the others. That check runs before the id is parsed, so a bad id with no read of the module is `403`. A bad id is otherwise `400` "Invalid id.", before a missing line is `404`. A missing target is `400`: "One or more applications were not found.", "One or more technologies were not found.", "One or more contracts not found.", "One or more projects not found", "One or more assets were not found". Linking what is linked, or unlinking what is not, changes nothing and writes no audit row. A Business Contributor who removes an application or a project they cannot see gets that `400`, and the link stays.

The line row is locked (`FOR NO KEY UPDATE`). Applications, technologies, contracts and projects go through one insert or delete (`setOwnedLink`). One audit row when the set changes: `recordId` the line, `before` and `after` the sorted ids. The table is `application_spend_items`, `technology_spend_items`, `contract_spend_items` or `portfolio_project_opex`. A CAPEX line keeps the CAPEX label (`application_capex_items`, `contract_capex_items`, `portfolio_project_capex`). Technologies keep `technology_spend_items` for both natures. Projects and contracts record that audit on these routes (the link table, the line, the sorted ids).

An asset is written from the line with the asset's audit shape. The table is `asset_spend_items` (`asset_capex_items` for a CAPEX line), `recordId` is the asset, and `before` and `after` are `{ ids }` of the sorted line ids of that nature linked to the asset. A row is written when the set changes. The ids are sorted. An OPEX link of the same asset is left in place when a CAPEX link changes, and the other way around.

## Amounts (OPEX)
- POST `/spend-versions/:id/amounts/bulk-upsert` (`budget:member`) → `{ updated, round_inputs: RoundInput[], items, budget_rev }` (a lines payload adds `warnings`; `items`: the year's months as stored after the write; `budget_rev`: the version's counter after it, lot 3G); `year` must be the version's year, each column written is checked against the freeze in the request transaction
  - `annual`, `quarterly` and `monthly` payloads as before (see README; `period_start` / `period_end` both or neither). A month counts when the period covers its 15th; a period of one day (`period_start` = `period_end`, "at a date") counts the month of that date, so an `annual` total over it goes whole to that month (a `quarterly` one puts the date's quarter there, the other quarters must be 0). The record stores the date as its period; a budget file's yearly total for that column goes to the same month. A line whose own dates leave one day in the year without its 15th still gets no month from a budget file (`400`, as before): the date rule is for a column set at a date
  - `updated` is the number of months written; a write that leaves every month as stored (the same spread or lines sent again) writes none, answers `updated: 0` and adds no amounts audit row, while a changed period or method is still saved on the column's record
  - Lines payload (a column computed from quantity × price lines): `{ kind: 'lines', year, measure, also_measures?: AmountMeasure[], lines: Line[] }` with `Line = { label, quantity_unit: 'people'|'days'|'pieces', quantity, unit_price, price_basis: 'per_day'|'per_month'|'per_piece', frequency: 'per_month'|'once', days_per_month: string | number | null, period_start, period_end, working_day_profile_id: string | null }` → `{ updated, round_inputs, warnings: string[] }`
    - `measure`: any of the five columns, including one hidden by the settings; `also_measures`: the same lines written to these columns too, in the same request (a frozen one refuses the whole write, as any freeze); `lines`: 0 to 50
    - Each line: `label` trimmed, may be blank, at most 200 characters; `quantity` at most 3 decimals, from 0 to below 10^9; `unit_price` at most 4 decimals, below 10^14 either way (credits allowed); numbers or decimal strings, read exactly; the unit decides the price basis and how often: people per day or per month, counted per month; days per day, counted once over their period (a bundle); pieces per piece, per month or once (`frequency` may be left out for people and days, which have one choice; pieces must send it); `days_per_month` only on people priced per day: `null` (or left out) is full time, a number is the days worked each month, above 0, at most 31, at most 3 decimals; `period_start` and `period_end` (`YYYY-MM-DD`) inside `year`, start before end, covering at least one month's 15th, except a line counted once on one date (`period_start` = `period_end`, the pieces' date), which counts that date's month; `working_day_profile_id` required for a price per day (people per day and days), refused otherwise, resolved in the current tenant; a disabled calendar is refused unless the stored lines of every column written already use it (then `warnings: ["This calendar is disabled. The computation still uses it."]`)
    - Refusals are `400` sentences naming the line: "Line 2: choose a calendar for a price per day.", "Line 2: quantity accepts at most 3 decimals.", "Line 2: a price for days is per day.", "Line 2: a price for pieces is per piece.", "Line 2: a price for people is per day or per month.", "Line 2: choose how often: per month or once.", "Line 2: people are counted per month.", "Line 2: a price per month applies per month.", "Line 2: days are counted once over their period.", "Line 2: enter the days per month, or tick Full time.", "Line 2: days per month must be more than 0 and at most 31.", "Line 2: days per month accepts at most 3 decimals.", "Line 2: days per month apply to people priced per day.", "Line 2: unknown unit 'weeks'. Use days, people or pieces.", "Line 2: the calendar was not found.", "Line 2: France 218 is disabled. Pick an enabled calendar.", "Line 2: France 218 has no working days for 2027. Add them on the Working-day calendars page.", "Line 2: the computed amount is too large."; for the request: "Send the lines as a list.", "A column holds at most 50 lines.", "The computed amount is too large.", "The lines add up to too many FTE.". Nothing is written on a refusal
    - Months of a line (its active months; the others are zero): people per day, full time = the calendar's days of the month × quantity × unit price, rounded half away from zero to cents per month; people per day, N days per month = N × quantity × unit price per month; people per month and pieces per month = quantity × unit price per month; days and pieces once = quantity × unit price rounded once, split equally over the months, the remainder on the last (one date: all of it in that month). FTE of a month: people full time or per month = the quantity; people N days per month = quantity × N ÷ the calendar's working days of that month; days = the days bought split like the price (6 decimals, the remainder on the last month) ÷ the calendar's working days of that month; both 6 decimals, 0 when the calendar has none that month; pieces = 0
    - A column = the sum of its lines. Its `fte` (stored, the lists) = the twelve months' FTE summed ÷ 12, the full-year average; its `fte_period` (in `last_calculation` only) = the FTE of the months where at least one people or days line is active summed ÷ their number (pieces lines do not widen it; 0 without such a month). Both rounded half away from zero to 2 decimals; each line has the same two figures over its own months
    - Replaces the twelve months of each column written (the other columns keep theirs) and each column's lines, wholesale in the order sent, then stores its round: `period_start` = the earliest line start, `period_end` = the latest line end, `method: 'computed'`, `spread_profile_name: null`, `fte`, `last_calculation` of kind `computed`. The same lines sent again write no record
    - `lines: []` removes the lines: no month is written, `fte` becomes `null`, a `computed` column becomes `manual` (its explanation cleared), any other method stays; a column without a record is left alone
  - Restore payload (the budget tab's "back to the opening values", one column per request): `{ kind: 'restore', year, measure, months: string[12] | number[12], record: RoundInput | null, base: { columns: { <measure>: { months, lines } } } }` → `{ updated, round_inputs, items, budget_rev }`
    - `months`: the column's twelve months, January first, as the screen read them (`items` of the GET); `record`: the column's `RoundInput` as the GET returned it (`measure`, `updated_at`, `updated_by` and the lines' `id`, `sort`, calendar code and name are ignored; `measure`, when sent, must be the column's), or `null` for a column without one; `base` is required with both `months` (the column's twelve months as the screen last knew them) and `lines` (its lines then, `[]` without any): a colleague's change of the lines that leaves the months as they were is a `409` too (no period moved, `current_lines` in the answer), and so is a restore to `null` over lines someone added
    - Checked in this order: the payload and the record (`400`), the base present (`400`), the freeze of the column (`403`), the calendars of the lines (`400` "Line 2: the calendar was not found."; a disabled calendar is restored as it was), what the lines give (`400`), the base against what is stored (`409 edit_conflict`, the body of every budget conflict). Then written: the twelve months as sent (the version's totals follow), the record and its lines replaced, or the record deleted when `record` is `null`. The same restore sent again writes nothing
    - What the lines give is never taken from the request: with lines, the record's `fte`, the whole calculation of a `computed` record (or of a `manual` one that keeps a `computed` calculation) and the `lines_result` of any other are computed again from the lines with the calendars as they are; a `computed` record whose months are not what its lines give, or lines that cannot be computed (a calendar without days for the year), are refused
    - A record is refused (`400`) unless: `method` is `spread`, `copied`, `manual` or `computed`; `period_start` and `period_end` are dates of `year`, start not after end; `spread_profile_name` is a name or `null`; `fte` is `null` or at most 2 decimals, 0 or more, below 10^7; `lines` pass the lines payload's checks; `last_calculation` is `null` or of kind `annual`, `quarterly`, `copy` or `computed` with only the keys its writer writes and every key it always writes (the shapes are read from the writers), each value checked: amounts are decimals within the amounts columns, FTE decimals within theirs, months and lists as written, at most 50 lines; `lines_result` only on a record with lines; the method matches it (`spread` with `annual` or `quarterly`, `copied` with `copy`, `computed` with `computed`, `manual` with any or none); a `computed` record has lines; a record with lines has an `fte`, one without has none; except for `manual`, the twelve months add up to what the calculation explains (`total`, or the four `quarters`); a `spread`: its `active_months` are the months its period counts, its months outside them are 0, each quarter adds up to its amount, its `weights` are one per active month adding up to more than 0 (`1` each when flat)
    - Audit: the months' row (by the version) and the record's row, as for any column write, with the action `restored`
  - Copy payload (the budget tab's "Start from", one line and year): `{ kind: 'copy', year, source, measure, percentage?, base }` → `{ updated, round_inputs, items, budget_rev, copy: { prorated, from_lines, calendar_issues } }`
    - `source` and `measure`: two different columns of the version (storage names); `percentage`: a number or decimal string above -100, blank or absent is 0; `base` required, as for a restore: `base.columns.<measure>` with `months` and `lines` (`[]` without any), the destination as the screen last knew it
    - The result of the column copy of Budget operations (`POST /spend-items/budget-operations/copy-column`) restricted to this line and year, the destination overwritten: the months keep their shape (whole units with a percentage), source months outside the line's dates are left out (`prorated`), a source that follows its lines is copied by its lines with the prices raised and the column follows them (`computed`, `from_lines: true`), lines that are only a reference travel with the copy (prices unchanged, `lines_result` and `fte` computed for the year), and otherwise the record is `copied` with a `copy` calculation (`source_year` = `year`, `source_measure`, `uplift_pct`, `source_total`, `total`, `source_method`). `calendar_issues`: disabled calendars the copied lines still use
    - `budget:member`, like every write of the tab. Refused: a frozen destination (`403`; a frozen source can be copied from), the column onto itself, an unknown column, a percentage at or below -100, a source with nothing to copy ("Nothing to copy: Budget 2026 is empty.", or "… has no amount within the line's dates."), a line with no month in the year, a line whose calendar has no working days for the year ("Line 2: France 218 has no working days for 2026. Add them on the Working-day calendars page."), a destination changed since the base (`409 edit_conflict`)
    - Audit: the months' row (by the version), the destination record's row, and the line's row of a column copy (`operation: 'budget_column_copy'`, as the operation writes it)
  - The AI never sends `restore` or `copy`: its amounts are rebuilt from `annual`, `quarterly` and `monthly`
- GET `/spend-versions/:id/amounts?year=` (`budget:reader`) → `{ items, totals, year, round_inputs: RoundInput[] }`
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
  - Error codes: `400` on missing IDs or missing/zero metrics needed for the distribution. A turnover split whose selected companies all lack an exchange rate for the year answers `400 { code: 'turnover_fx_missing_all', message }`, the message naming the currencies, the reporting currency and the year (`No exchange rate from JPY to EUR for 2026: …`).

## CAPEX Items & Versions
- Since lot Z1 the CAPEX routes are aliases on the lines of nature `capex` of `spend_items`. They keep their paths, messages and output for one version, until the unified screens; since lot R they need the `budget` right, like the OPEX routes:
  - a line reads `description` (its title), `item_number` = its CPX number (n of `CPX-n`), plus `reference` (`BL-n`); it has no `product_name`, `contract_id`, `nature` or `legacy_number`. Versions, contacts, links and attachments name their line `capex_item_id`
  - POST `/capex-items` gives the new line a `BL` number and a `CPX` number; the `CPX` number is its `item_number` on these routes
  - since lot C1 a line has no `ppe_type`, `investment_type` or `priority` field (in the detail, the lists, `/summary*`, the create and update responses and the audit rows): its PP&E type, investment type and priority are its values on the dimensions of those codes, in `analytics_values` (detail) and `analytics_<axis id>` (list rows). A tenant created before the recommended dimensions (lot D) has the three dimensions (used for CAPEX lines, required; migration `1853980000000`), so there a create without one of them is a `400` naming the dimension ("The PP&E type dimension is required. Choose a value."), and an update cannot clear a value the line holds
  - the audit rows of a CAPEX line keep the CAPEX labels (`capex_items`, `capex_versions`, `capex_amounts`, …) and field names
  - the budget file names a CAPEX line by its `BL-n` reference since lot C1b, on both routes; the `CPX-n` of a file exported before is still read (`legacy_number`), and its `kanap_token` stays valid (the lot C1 migration does not move `row_version` either)
- POST `/capex-items` → create CAPEX item
- PATCH `/capex-items/:id` → update CAPEX item (writable fields and write rules as OPEX, see above)
- GET `/capex-items/:id` → detail (every item column, `cost_center_id` and `run_build` included) plus the analytics values, as OPEX (see above)
- POST `/capex-items/:id/versions` with `{ version_name, as_of_date, input_grain, budget_year?, allocation_method?, allocation_driver? }`
  - `allocation_method` defaults to `default`; `allocation_driver` defaults to `headcount`
  - One version per (item, budget_year)
- PATCH `/capex-items/:id/versions` with `{ id, input_grain?, notes?, allocation_method? }`

## Amounts (CAPEX)
- POST `/capex-versions/:id/amounts/bulk-upsert` → annual or monthly payload; server writes the appropriate rows to `spend_amounts` (audited as `capex_amounts`)
  - Annual payload: `{ kind: 'annual', year, totals: { planned?, committed?, forecast?, actual?, expected_landing? } }` (at least one; each named column is spread over the year, the others are kept)
  - Monthly payload: `{ kind: 'monthly', year, months: [{ period: 'YYYY-MM-01', planned?, actual?, expected_landing?, committed?, forecast? }] }`
  - Lines, restore and copy payloads, responses and round inputs as OPEX (see above), with `budget:member`

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
  - GET `/capex-items/:id/applications` (`budget` reader) → `{ items: [{ id, name }] }` sorted by name
  - POST `/capex-items/:id/applications/bulk-replace` (`budget` member) with `{ application_ids: uuid[] }` → replaces the whole set, returns the new list
    - `400` "One or more applications not found" when an id is not an application of the tenant
    - One audit row on `application_capex_items` when the set changes (`record_id` = the CAPEX item, before/after = sorted application ids); the OPEX route writes the same on `application_spend_items`
- Technologies (same on `/spend-items/:id/technologies`; `technology_spend_items`, `spend/item-technologies.ts`; a line of the other nature is a `404`)
  - GET `/capex-items/:id/technologies` (`budget` reader) → `{ items: [{ id, name, reference }] }` sorted by name (`reference` is `TEC-n`); `{ items: null }` without `infrastructure` reader
  - POST `/capex-items/:id/technologies/bulk-replace` (`budget` member, and `infrastructure` reader: `403` otherwise) with `{ technology_ids: uuid[] }` → replaces the whole set under the line's row lock, returns the new list
    - `400` "One or more technologies were not found." when an id is not a technology of the tenant or not a UUID; nothing is written
    - One audit row on `technology_spend_items` when the set changes (`record_id` = the line, before/after = sorted technology ids), for both natures
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
    - `analytics_<axis_id>`: the value's name on each dimension of the tenant that applies to the list's type (disabled ones included; `applies_to` null or the type), `null` when the line has none. A dimension of the other type has no key, so the row carries no hidden value, and a filter or sort on its field reads as empty. The key uses `_`, not `:`, because sort strings are `field:DIR`
    - `analytics_value_ids`: `{ [axis_id]: category_id }` for the dimensions of the list's type the line has a value on
    - Every analytics field filters (set, text, blank) and sorts in memory, `analytics_category_id` included; the quick search reads the value names of every dimension that applies to the list's type
  - FTE (both item types): `fte_<slot><Suffix>` (`fte_yBudget`, `fte_yPlus1Revision`, `fte_y2027Landing`), one per slot (the five fixed ones and each requested `y<YYYY>`) and column, `number | null`. Read from the round of that column on the version the amounts show (the newest per item and year):
    - a column with quantity × price lines: the `fte` its lines gave when they were written, the full-year average (people lines: the quantity each month, or quantity × days per month ÷ the calendar's working days; days lines: the month's share of the days ÷ the calendar's working days; summed over the twelve months, divided by 12, 2 decimals, `0.75`); a later hand edit or spread of the months keeps it
    - lines of pieces only: `0`
    - no round, a round without lines, no version for that year, or a year after the end of validity: `null` (unknown, never 0)
    - Number filters (`blank` = unknown; `null` fails every comparison) and sort (unknown last ascending) run in memory; a sort or filter key naming `fte_y<YYYY><Suffix>` loads that year, as for the amount fields
- GET `/spend-items/summary/filter-values?fields=fieldA,fieldB&q&filters&years=2024,2025,2026` **[Requires: budget:reader]**
  - Fields include `cost_center_label`, `cost_center_code`, `cost_center_name`, `cost_center_path`, `budget_holder_name`, `run_build`, `analytics_category_name` and any `analytics_<axis_id>` (both item types)
  - Values come in text order, except the analytics columns (`analytics_<axis_id>` and the default dimension's `analytics_category_name`), which come in the dimension's value order (positions read in one tenant-scoped query per request); a name the dimension does not hold follows in text order, `null` stays last. Same on the CAPEX route and for the AI `get_filter_values`
  - Distinct filter values for closed-choice columns in the OPEX summary grid.
  - Response: `{ fieldA: Array<string | null>, fieldB: Array<string | null> }`
  - Caller should remove the column’s own filter so values stay discoverable.
- POST `/spend-items/summary/aggregate` **[Requires: budget:reader]** (and POST `/capex-items/summary/aggregate`, **budget:reader**): the lines of a list state grouped and measured on the server, in one statement. The budget reports and the dashboard's budget tiles use it. A read: a frozen subscription keeps it, as the GET routes
  - Body `{ query, spec }`. `query` is the list's query: `filters` (an object or its JSON), `q`, `status`, `includeDisabled`, `years` (`2025,2026`: without a status, the lines still active on 1 January of the earliest year, else of last year), and `ctx` (a saved list context, merged as on the GET routes)
  - `spec`: `groupBy` (0 to 6 fields of the list; `id` gives one group per line), `measures` (0 to 60, each `{ id, fn: sum|min|max|avg, field, minus?, part?: positive|negative }` on an amount `y<YYYY><Suffix>` or `<slot><Suffix>`, an amount in the line's own currency `local_<amount field>`, or an FTE `fte_<amount field>`; at most 8 with group keys, 60 without), `having` (0 to 10 conditions on measures, exact), `order` (0 to 10 terms by `count`, a `measure` or a `key`), `limit` (1 to 10,000) and `others`
  - Fields the reports read besides the list's: `analytics_id_<axis_id>` (the line's value id on a dimension), `account_consolidation_key` and `account_consolidation_label` (the line's consolidation line: `c_<number>`, else `c_<name>`; one label per key, from the accounts the type's lines use; null for a caller without **accounts:reader**, here and as a filter or sort key of the GET summary routes), `has_version_<slot>` (`yes` when the line shows a version that year)
  - Response: `{ groups: [{ keys, count, values, unknown }], others, total, groupCount, reportingCurrency, fxMissing }`; amounts exact to the cent in the reporting currency (`local_` amounts in each line's currency), `total` over every line of the state
  - Amounts without an exchange rate: a version whose line currency has no rate for its year (its pinned set, then the live set) has no value in the reporting currency. It is left out of every amount measure (the sum, the mean's count, the lowest and highest; a line still counts in `count`), sorts last in both directions and matches no amount filter, blank and not blank included. `fxMissing: [{ currency, year, lines }]` names each line currency and budget year the spec's converted amount fields left out, with the number of distinct lines of the state; `[]` when none. The totals answer the same `fxMissing` for their keys. Rows: the full shape keeps `totals` in the line's currency and gives `reporting` five null amounts, `fx_rate: null` and `fx_source: 'missing'`; the grid shape gives `reporting` five nulls and `fx_missing: { currency, amounts }`, the five amounts in the line's currency. The Relations tabs' budget lines answer `amount: null` and `fx_missing: { currency, amount }`. Example: `"fxMissing": [{ "currency": "JPY", "year": 2026, "lines": 2 }]`

## Summary (CAPEX list)
- GET `/capex-items/summary?status=enabled&page=1&limit=50&sort=yBudget:DESC`
  - Each row includes `{ versions: { yMinus1, y, yPlus1 }, allocation_method_label, next_year_allocation_method_label, spread_mode_for_y, company_name }`
  - Also includes `latest_task?: { id, title?, description?, status, created_at } | null` for open/in_progress tasks (most recent)
  - Cost center and run or build fields, analytics dimension fields, filters, sort and quick search as OPEX (see above)
  - A dimension field (`analytics_<axis id>`, and `analytics_category_name` for the default dimension), OPEX and CAPEX alike, sorts in the dimension's order: the value's position (`sort_order`), then its name, a line without a value last ascending (lot C1, decision 2; before: by name). An aggregate ordered by such a key follows the same order; its filter values were already in that order. `status` and `run_build` keep their business order
- GET `/capex-items/summary/ids` → `{ ids, item_numbers, total }` ordered by requested sort (supports derived fields like `yBudget`); `item_numbers[i]` is the item number of `ids[i]`
- GET `/capex-items/summary/neighbors?id=` (`id`: a UUID or a `CPX-n` reference, plus the list parameters of `/summary/ids`) → `{ index, total, prev, next }`: the line's 0-based position in the list (`null` when the list does not hold it) and its previous and next lines as `{ id, item_number }` or `null`. Same on `/spend-items/summary/neighbors` (`OPX-n`)
- GET `/capex-items/summary/totals` → `{ reportingCurrency, fxMissing, ...amounts }`: one key per `<slot><Suffix>` for the slots `yMinus2`, `yMinus1`, `y`, `yPlus1`, `yPlus2` and the suffixes `Budget`, `Revision`, `Forecast`, `FollowUp`, `Landing` (25 keys, for example `yBudget`, `yPlus2Forecast`), plus `y<YYYY><Suffix>` for each requested year. Same shape as the OPEX totals
  - Optional `fte=<comma-separated FTE keys>` (for example `fte=fte_yBudget,fte_y2027Revision`; other keys ignored) adds `fte: { [key]: { total, unknown } }`: the sum of the lines' FTE values as listed (2 decimals each, summed exactly; `null` when no line of the selection has an FTE, never 0) and the number of lines whose FTE is unknown. A key naming `y<YYYY>` reads that year without `years`. Without `fte` the response keeps the amount keys and `reportingCurrency` only. Same on `/spend-items/summary/totals`
- GET `/capex-items/summary/filter-values?fields=fieldA,fieldB&q&filters` **[Requires: budget:reader]**
  - Distinct filter values for closed-choice columns in the CAPEX summary grid.
  - Response: `{ fieldA: Array<string | null>, fieldB: Array<string | null> }`
  - Caller should remove the column’s own filter so values stay discoverable.

## Contracts

- GET `/contracts?status=enabled&page=1&limit=50&sort=next_due_date:ASC&q&filters`
  - Items include derived: the term fields below, `linked_lines_count` (linked budget lines, OPEX and CAPEX), and nested `supplier {id,name}`, `company {id,name}` plus `latest_task`.
  - `sort` and `filters` on `end_date`, `cancellation_deadline`, `next_due_date` and `term_state` (set filter) use the same values as the items (as of today, UTC). Default sort: `next_due_date:ASC`; contracts without a next due date (ended) come last in both directions. Same on GET `/contracts/ids`.
  - `budget_year` (within 10 years of the current one) and `budget_column` (`planned`, `committed`, `forecast`, `actual` or `expected_landing`, the five budget columns by key), both or neither, for a user who may read the budget (`budget:reader`, ignored otherwise; 400 when invalid): each item adds `budget_committed` (the year's commitment in the reporting currency, `null` when its currency has no rate that year), `budget_linked` (its linked budget lines' amounts in that year and column, as the budget list shows them), `budget_linked_fx_missing` (`true` when a linked line has an amount in a currency without a rate that year: that line is left out of `budget_linked`, and `budget_gap` and `budget_state` are `null`, unknown rather than covered or over), `budget_gap` (`budget_linked − budget_committed`, `null` without a rate) and `budget_state` (`covered`, `under`, `over`, `no_line`, `no_commitment`, `not_started`, or `null` without a rate). The three amounts sort (no value last in both directions) and filter (number filters, in units of the reporting currency); `budget_state` filters (set filter). Same on GET `/contracts/ids`. Rule in `doc/architecture.md`, Contract Commitments and Budget Coverage.
  - Each item adds `compliance: { expected, missing, to_check, state }`, the contract's compliance summary (see Contract compliance register below). `state` (`missing`, `to_check`, `complete`, `none`) sorts and filters as `compliance_state` (set filter): ascending puts `none` first, then `complete`, `to_check` and `missing`, by count. Same on GET `/contracts/ids` and in the totals' filters.
- GET `/contracts/totals?status&includeDisabled&q&filters` **[Requires: contracts:reader]**: the footer of the list for the same request.
  - Response: `{ count, yearly_amount, reporting_currency, fx_year, excluded: Array<{ currency, count }>, to_decide_count }`.
  - `yearly_amount`: the sum of `yearly_amount_at_signature` converted to the reporting currency with the latest rate set of `fx_year` (the current year). Contracts in a currency that set does not rate are left out and counted in `excluded`.
  - `to_decide_count`: the contracts with `term_state = to_decide` for the same request, its `term_state` filter left out (the count of the list's quick filter). `decision_window_days`: the tenant's decision window that state uses.
  - With `budget_year` and `budget_column` (see the list): `budget: { year, column, reporting_currency, committed, linked, gap, linked_fx_missing: Array<{ currency, year, lines }>, excluded: Array<{ currency, count }>, no_line_count, under_count, years }`. `linked_fx_missing`: the linked lines of the contracts in scope left out of `linked` for lack of a rate, by line currency and year, each line counted once (`[]` when none; example `[{ "currency": "GBP", "year": 2027, "lines": 1 }]`). `committed` leaves out the contracts whose currency has no rate that year (counted by currency in `excluded`); `gap` sums the contracts with a committed amount. `no_line_count` and `under_count`: the contracts in state `no_line` and `under`, the `budget_state` filter left out (the counts of the list's quick filters). `years`: the years the selector offers (the year before the current one when the budget holds lines for it, the current year and the two after, and the year asked for).
- GET `/contracts/:id` → details including the term fields, `decision_window_days` (the tenant's decision window), `supplier_name`, `company_name`, `owner_name` (the names the page header shows), `links` (URLs), `attachments` (metadata), and `linked_spend_items` (OPEX only, kept for older callers).
- Term fields, computed as of today (UTC) by `backend/src/contracts/contract-terms.ts` (rule in `doc/architecture.md`, Contract Terms), tacit renewals included:
  - `term_index`: the current term, 0 for the first one; `renewed`: `term_index > 0`.
  - `current_term_end`: end of the term containing today (the first term for a future contract, the last one once ended).
  - `next_cancellation_deadline`: first cancellation deadline on or after today, or `null` (no renewal and the deadline passed, or the end of validity comes first).
  - `end_date`: same as `current_term_end`. `cancellation_deadline`: `next_cancellation_deadline`, or the last term's deadline when it is `null`.
  - `next_due_date`: `next_cancellation_deadline` for a contract that renews at the end of its current term, else its end (term end, or end of validity when earlier); `null` once ended.
  - `term_state`: `to_decide` (deadline within the tenant's decision window, 90 days by default, and no renewal confirmed for its term; without tacit renewal, its end within the window and not decided), `in_progress`, `renewed` (current term's deadline passed, next term not started), `ending` (no renewal at the end of the current term) or `expired`.
- POST `/contracts` → create; PATCH `/contracts/:id` → update. 400 when the update turns off `auto_renewal` on a contract already renewed (past its first term) and leaves it without an end of validity: set one in the same request, or use `POST /contracts/:id/renewal/stop`.
- DELETE `/contracts/:id` and DELETE `/contracts/bulk` with `{ ids: string[] }` **[Requires: contracts:admin]** (bulk → `{ deleted: string[], failed: Array<{ id, name, reason, code?, usages? }> }`, each contract under its own savepoint). A contract with recorded compliance requirements (a `contract_compliance_items` row with a state or a reference) is refused: 409 `{ code: 'CONTRACT_HAS_COMPLIANCE_RECORDS', usages: [{ type: 'compliance_requirements', total }], message }` (`RecordInUseException`, `common/record-in-use.ts`), the same `code` and `usages` on its bulk failure. Otherwise the links go and the linked objects stay: `contract_spend_items` and `spend_items.contract_id`, `application_contracts`, `asset_contracts`, `asset_support_info.support_contract_id` (set to null), `contract_contacts`. Its tasks (`related_object_type = 'contract'`, through the budget line's task removal), `contract_tasks`, `contract_links` and `contract_attachments` (rows, then the files no attachment row of the tenant uses) go with it. One audit row (`contracts`, `delete`). 404 for a contract of another tenant (`backend/src/contracts/contracts-delete.service.ts`).
- POST `/contracts/delete-impact` with `{ ids: string[] }` **[Requires: contracts:admin]** → `{ contracts, budget_lines, applications, assets, contacts, tasks, links, attachments, blocked, recorded_requirements }`: what deleting those contracts of the tenant removes, for the confirmation. The counts cover the `contracts` that can go; `blocked` contracts are refused for their `recorded_requirements`, and `refused` lists them as the bulk delete would (`{ id, name, code, usages }`). Linked objects count once each (`assets` includes the assets whose support contract it is).
- GET `/contract-settings` **[Requires: contracts:reader]** → `{ decision_window_days }`; PATCH `/contract-settings` **[Requires: contracts:admin]** with `{ decision_window_days }` (whole days, 0 to 365; 400 otherwise) → the settings. Stored in `tenants.metadata.contracts`, default 90.
- GET `/contracts/:id/renewal?end_date=YYYY-MM-DD` **[Requires: contracts:reader]** → `{ decision_window_days, proposed_end_date, notice_period_months, mode: 'renewal' | 'end' | null, state: 'none' | 'pending' | 'decided', renegotiating, term: { term_index, term_start, term_end, deadline, renews_on, next_term_end, days_left } | null, duration_months, decision: { decision, reason, decided_at, decided_by_name, end_date } | null, can_undo, task: { id, item_number, status, assignee_name } | null, impact: { currency, commitments: Array<{ year, before, after }>, applications: Array<{ id, name }>, assets: Array<{ id, name }> } | null }`. `proposed_end_date`: the end a termination proposes (last day of the first term whose deadline has not passed). `impact` while a decision is awaited (ending on the proposed day), or for the `end_date` asked, whatever the state (400 for a day before today or before the start). Rule in `doc/architecture.md`, Contract Renewal Decision.
- POST `/contracts/:id/renewal/renew`, `/terminate`, `/renegotiate`, `/undo` **[Requires: contracts:member]** with `{ reason?: string }` (`terminate`: also `end_date?: 'YYYY-MM-DD'`) → the same body as the GET, after the action. `renew` closes the decision task, `terminate` turns `auto_renewal` off and sets the end of validity to `end_date` (the proposed end when absent; 400 before today or before the start) and closes the task, `renegotiate` adds the justification to the open task, `undo` (while the deadline has not passed) reopens the task and, after a termination, puts the previous end of validity back. 409 when no decision is awaited (or none to undo), 404 for a contract of another tenant.
- POST `/contracts/:id/renewal/end` **[Requires: contracts:member]** with `{ reason?: string }` → the same body as the GET. A contract without tacit renewal whose end is within the window (`mode: 'end'`): let it end, the decision task closed. `renew` in that mode turns `auto_renewal` on and removes the end of validity; `undo` puts both back. 409 in the other mode.
- POST `/contracts/:id/renewal/resume` **[Requires: contracts:member]**, no body → the same body as the GET. Turns the renewal back on for a contract without renewal that has an end of validity: `auto_renewal` on and the end of validity removed, one audit row. While a decision is awaited on its end, the same as `renew`. An open decision task on the end becomes the renewal decision's task when its deadline is within the window, and is closed otherwise. 409 when the renewal is on, or without an end of validity.
- POST `/contracts/:id/renewal/stop` **[Requires: contracts:member]** with `{ end_date?: 'YYYY-MM-DD' }` → the same body as the GET. Turns off the renewal of a contract already renewed or awaiting a decision: `auto_renewal` off, its end of validity on `end_date` (the proposed end when absent; 400 before today or before the start), one audit row. No decision is recorded: the open decision task is retitled for the end, due on it, with a comment; without one, a task is created when the end is within the window. 409 when the renewal is already off, or in the first term with no decision awaited.

### Contract relations (contract page)
Every statement carries the contract's tenant besides RLS; a contract of another tenant is a `404`. Reads need `contracts:reader`, writes `contracts:member`. A replacement locks the contract row first (the last one wins) and writes one audit row on the link table when the set changes (`recordId` the contract, before and after the sorted ids). An id that is not a row of the tenant, or not a UUID, is a `400` and nothing is written.
- GET `/contracts/:id/budget-lines` → `{ items: [{ id, nature, item_number, product_name, company_id, company_name }] }`: the linked budget lines of both natures (`contract_spend_items`), by reference number; `company_*` is the line's paying company.
- POST `/contracts/:id/budget-lines/bulk-replace` with `{ budget_line_ids: string[] }` (lines of either nature) → `{ ok, added, removed }`.
- GET `/contracts/:id/budget?year=2027&column=planned` **[Requires: contracts:reader and budget:reader]** (403 without the budget right; 400 without a valid year and column): the Budget tab's figures. Response: `{ year, column, reporting_currency, currency, lines: Array<{ id, amount, fx_missing? }>, lines_fx_missing: Array<{ currency, year, lines }>, years: Array<{ year, committed_local, committed, linked, linked_fx_missing, gap, state }> }`. `lines`: each linked line's amount in that year and column, as the budget list shows it, in the reporting currency; a line whose currency has no rate that year answers `amount: null` and `fx_missing: { currency, amount }`, its amount in its own currency (a line with nothing in that column answers `0` whatever the rate). `lines_fx_missing`: those lines by currency and year, for every year of `years`. `linked_fx_missing` on a year: its `linked` leaves such a line out, so `gap` and `state` are `null`. `years`: for every year the selector offers (see `GET /contracts/totals`), the commitment in the contract's currency (`committed_local`) and in the reporting currency (`committed`, `null` without a rate), the linked lines' sum, the gap and the state.
- GET `/contracts/:id/applications` and POST `/contracts/:id/applications/bulk-replace` with `{ application_ids: string[] }` (`application_contracts`).
- GET `/contracts/:id/assets` and POST `/contracts/:id/assets/bulk-replace` with `{ asset_ids: string[] }` (`asset_contracts`).
- GET `/contracts/:id/technologies` → `{ items: [{ id, name, reference }] }` and POST `/contracts/:id/technologies/bulk-replace` with `{ technology_ids: string[] }` (`technology_contracts`). Both also need `infrastructure` reader: without it the list is `{ items: null }` and the replacement a `403`.
- GET `/contracts/:id/relation-counts` → `{ budget_lines, applications, assets, technologies, contacts, links, attachments, relations }`: the tab badges (`relations` sums the Relations tab's sets). `technologies` is counted, and in `relations`, for a caller who reads `infrastructure` only (`null` otherwise).
- GET `/contracts/:id/relations` **[Requires: contracts:reader]** → `{ applications, assets, technologies, suggestions }`, one round trip. Each list is ordered by name. Web links, attachments and contacts stay on their own routes.
  - `applications: [{ id, reference, name, lifecycle, business_criticality, status }]`: the linked applications (`application_contracts`). `reference` is `APP-n`. `business_criticality` is the application's criticality.
  - `assets: [{ id, reference, name, kind, environment, status }]`: the linked assets (`asset_contracts`). `reference` is `AST-n`.
  - `technologies: [{ id, reference, name, family, vendor }] | null`: the linked technologies (`technology_contracts`). `reference` is `TEC-n`. `vendor` is the editor. `null` when the caller cannot read `infrastructure`.
  - `suggestions: [{ type: 'application' | 'asset', id, reference, name, via: { kind: 'same_supplier', label: null } }]`: up to 20 applications and 20 assets of the contract's supplier, not linked yet. An application is in service (`status` enabled, and `disabled_at` empty or still to come) and, for a Business Contributor, one they take part in. An asset is not retired, and is suggested to a reader of `infrastructure` only. A contract with no supplier has no suggestion.
- POST `/contracts/:id/relations/:kind` with `{ id }` and DELETE `/contracts/:id/relations/:kind/:targetId` **[Requires: contracts:member]** → `{ ok: true, changed }`. `kind` is `applications`, `assets` or `technologies`; anything else is `404` `Unknown relation type.`. One row at a time, under the contract's row lock (`FOR NO KEY UPDATE`). A row already linked, or a row absent from the set, answers `changed: false` and writes no audit row. An id that is not a uuid is `400` `Invalid id.`. A uuid that is not a row of the tenant is `400` with the bulk replacement's message (`One or more applications not found.`, and the same sentence for assets and technologies). `technologies` also needs a read of `infrastructure`: `403` `You cannot read technologies.` without it. One audit row on the link table when the set changes, the same shape as the bulk replacement: `recordId` the contract, `before` and `after` `{ ids }` the sorted ids.

### Contract compliance register
What a contract is expected to hold, and what was recorded (`backend/src/contracts/contract-compliance.ts`, rule in `doc/architecture.md`, Contract Compliance Register). Requirements (fixed list, stable codes): `gdpr_dpa`, `data_location`, `reversibility`, `exit_plan`, `audit_security`. A contract of another tenant is a `404`.
- GET `/contracts/:id/compliance` **[Requires: contracts:reader]** → `{ summary: { expected, missing, to_check, state }, requirements: Array<{ requirement, expected, reasons, state, reference, updated_at, updated_by: { id, name } | null }> }`, every requirement in the list's order. `reasons`: `Array<{ rule, application: { id, name }, asset: { id, name } | null, level: { axis, code, label, translations? } | null }>`, empty when the requirement is not expected; `rule` is `personal_data`, `business_criticality`, `cyber_criticality` or `cloud_hosting`; `asset` names the covered asset the application was reached through (null when the application is linked to the contract); `level` is the application's level (`businessCriticalityLevels`, `cyberCriticalityLevels`) or the hosting type (`hostingTypes`) as the tenant's settings name it. `state`: `present`, `absent`, `not_applicable` or `null`.
- PATCH `/contracts/:id/compliance/:requirement` **[Requires: contracts:member]** with `{ state?: 'present' | 'absent' | 'not_applicable' | null, reference?: string | null }` → the same body as the GET. A field left out is kept; `null` (or an empty reference) clears it; a requirement with neither left has no row. The reference is trimmed, at most 500 characters. Any requirement can be recorded, expected or not. 400 for an unknown requirement or state, a reference too long or not a text, or a body with neither field. The contract's row is locked first; one audit row on `contract_compliance_items` per write that changes something (`create`, `update` or `delete`, before and after the row).
- GET `/contracts/compliance-register/export?language&status&includeDisabled&q&filters` **[Requires: contracts:admin]** → `contract-compliance-register.csv`: the contracts the list request selects (search, filters, status scope; the budget filters with `budget_year` and `budget_column` for a reader of the budget), by name, one line per contract and requirement: contract, supplier, company, requirement, expected (yes or no), reasons (joined by `; `), state (`To check` when expected and nothing recorded), reference, updated on (date), updated by. Headers and words in `language` (`en`, `fr`, `de`, `es`; the user's locale without it), with that language's separator. Recorded as an export in the security events.

### Contracts ↔ OPEX links (many-to-many)
- Contracts side: GET `/contracts/:id/spend-items` and POST `/contracts/:id/spend-items/bulk-replace` with `{ spend_item_ids: string[] }`
- OPEX side: GET `/spend-items/:id/contracts` and POST `/spend-items/:id/contracts/bulk-replace` with `{ contract_ids: string[] }`

### OPEX URLs and attachments
- URLs: GET `/spend-items/:id/links`, POST `/spend-items/:id/links`, PATCH `/spend-items/:id/links/:linkId`, DELETE `/spend-items/:id/links/:linkId`
- Attachments: GET `/spend-items/:id/attachments`, POST `/spend-items/:id/attachments`; download GET `/spend-items/attachments/:attachmentId`, delete PATCH `/spend-items/attachments/:attachmentId/delete`
  - Permissions: `budget:reader` for list/download; `budget:member` for create/update/delete

### Contracts ↔ CAPEX links (many-to-many)
- Contracts side: GET `/contracts/:id/capex-items` and POST `/contracts/:id/capex-items/bulk-replace` with `{ capex_item_ids: string[] }` (no screen calls them since the contract page uses `/contracts/:id/budget-lines`; kept until the CAPEX aliases go)
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
- POST `/contracts/:id/share` — share a contract **[Requires: contracts:reader]**; the link opens `/ops/contracts/:id/overview`, recipients are people of the contract's tenant who can sign in, plus plain addresses; a contract of another tenant is a `404`

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
  - TaskRow: `{ id, tenant_id, title, description, status, due_date, created_at, assignee_user_id, assignee_name, related_object_type, related_object_id, related_object_name, priority_level, priority_score, task_type_id, task_type_name, task_type_code, source_id, source_name, category_id, category_name, stream_id, stream_name, company_id, company_name }`
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
- POST `/portfolio/requests/:id/opex/bulk-replace` — replace OPEX links (logs `opex_items` diff) **[Requires: portfolio_requests:member]**. Every id must name an OPEX line of the tenant, or nothing is written: `400` "One or more OPEX items were not found."; the links to lines of another nature are kept
- GET `/portfolio/requests/:id/relations` **[Requires: portfolio_requests:reader]** → `{ year, budget_column: { key, label }, budget_lines, applications, assets, processes, resulting_projects }` in one round trip. The request is resolved with the reader's participation scope. A section the caller cannot read is `null`: `budget` for `budget_lines`, `applications` for `applications`, `infrastructure` for `assets`, `business_processes` for `processes`, `portfolio_projects` for `resulting_projects`.
  - `budget_lines`: lines of both natures linked through `portfolio_request_opex` (`opex_id`), with the year's amount on the tenant's default budget column.
  - `applications`: `{ id, reference, name, lifecycle, business_criticality, status }`. A Business Contributor sees the applications they take part in.
  - `assets`: `{ id, reference, name, kind, environment, status }`.
  - `processes`: `{ id, name, status, owner_name }`.
  - `resulting_projects`: `{ id, item_number, name, status }`, the projects this request produced. Read only. A Business Contributor sees the projects they take part in.
- POST `/portfolio/requests/:id/relations/:kind` with `{ id }` and DELETE `/portfolio/requests/:id/relations/:kind/:targetId` **[Requires: portfolio_requests:contributor]** → `{ ok: true, changed }`. `kind` is `budget_lines`, `applications`, `assets` or `processes`. Any other kind, `resulting_projects` included, is `404` `Unknown relation type.`. The request row is locked (`FOR NO KEY UPDATE`) and resolved at contributor, with the participation scope. A row already linked, or absent from the set, answers `changed: false` and writes nothing. An id that is not a uuid is `400` `Invalid id.`.
  - `budget_lines`, `applications` and `assets` also need a read of their module (`403` `You cannot read this module.` otherwise). The line's nature is read on the server. The link is written by the OPEX or CAPEX replacement of that nature, which logs `opex_items` or `capex_items`. Applications and assets go through their own replacement and log `applications` or `assets`. The replacement receives the whole stored set plus or minus one id, so a link outside the caller's participation scope stays. A missing line is `400` `Budget line not found.`. A missing application, or one outside that scope, is `400` `One or more applications were not found`. A missing asset is `400` `One or more assets were not found`.
  - `processes` also needs `business_processes:reader` (`403` `You cannot read this module.`) and `business_processes:member` (`403` `You cannot edit this module.`), both before the service. One row on `portfolio_request_business_processes` and one audit row: `table` `portfolio_request_business_processes`, `recordId` the request, `before` and `after` the sorted ids. A missing process is `400` `One or more business processes were not found.`.
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
- GET `/portfolio/team-members/skills-matrix/export?teamId=&employmentTypeId=&orientation=&showUnused=&hiddenCategories=&format=csv|xlsx&language=&tz=`: the skills matrix as the screen draws it **[Requires: portfolio_settings:reader]**
  - `teamId`: `all` (default), `unassigned` or a team id. `employmentTypeId`: `all` (default) or a contract type id. A team or contract type that is not one of the tenant is a `400`.
  - `orientation`: `contributors` (default) or `skills`. `showUnused`: `true|false` (default `false`). `hiddenCategories`: a JSON list of category names (names may hold commas).
  - Levels are numbers from 1 to 4, empty when none is declared. The footer row holds the summaries of the column entries. One table. Any other query key, `table` included, is a `400`. Recorded as an export.

## Portfolio Reports
- GET `/portfolio/reports/weekly?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&tz=&statuses=&entities=&groupBy=&sourceIds=&categoryIds=&streamIds=&taskTypeIds=&projectIds=&teamIds=`: weekly report of what was created, modified and closed in a period **[Requires: portfolio_reports:reader]**
  - Required: `startDate` and `endDate` (`YYYY-MM-DD`, start on or before end). A missing or malformed date, or a start after the end, is a `400`.
  - Optional:
    - `tz`: IANA time zone of the viewer; the period and every event day are read in it
    - `entities`: comma-separated `request|project|task`. Unknown values are dropped; nothing left means all three. An object left out is not queried and comes back as empty lists
    - `groupBy`: `person` adds `byPerson`; any other value keeps the default `type`
    - `statuses`: comma-separated; matches the status reached, that is the status left by the last status event of the period. An item with no status event in the period matches none
    - `sourceIds`, `categoryIds`, `streamIds`, `taskTypeIds`, `projectIds`, `teamIds`: comma-separated UUIDs. `projectIds` and `teamIds` also narrow the logged time
  - Response: `{ requests, projects, tasks, byPerson? }`. Each of the first three is `{ created, modified, closed }`, a list of rows with `ref`, `itemPath`, `name`, `sourceId`/`sourceName`, `categoryId`/`categoryName`, `streamId`/`streamName`, `company`, `status`, `createdAt`, `eventAt` and `changes` (filled on `modified` only: `{ statusChain, fields[] }`). Projects add `projectId`, `priority`, `progress`, `origin`, `originValue`. Tasks add `taskId`, `taskTypeId`, `taskTypeName`, `taskTypeCode`, `priority`. Requests add `requestId`.
  - `byPerson` (only with `groupBy=person`): `{ teams: [{ teamId, teamName, members: [{ userId, name, contributorRef, loggedDays, created, modified, closed }], totals }], unassigned }`. It covers tasks and logged time only.
- GET `/portfolio/reports/weekly/filter-values`: options of the weekly report filters **[Requires: portfolio_reports:reader]**
  - No parameters. Active values only.
  - Response: `{ sources: {id,name}[], categories: {id,name}[], streams: {id,name,categoryId}[], taskTypes: {id,name,code}[] }`
- GET `/portfolio/reports/weekly/export?<same parameters as weekly>&format=csv|xlsx&language=`: the report as a file **[Requires: portfolio_reports:reader]**
  - Same parameters and the same service call as `weekly`, same `400` on the dates. `format` is read in any case; `xlsx` gives a workbook, any other value or none gives CSV. `language` (else the user's locale) sets the words, the days, the decimal mark and the CSV separator. A parameter this route does not know is ignored.
  - File name `weekly-report-<startDate>_to_<endDate>.csv|xlsx`. Recorded as an export (the path ends with `/export`).
  - CSV: one block per object and list (created, modified, closed), each with a heading and a header row. With `groupBy=person`, the tasks are one block by person.
  - XLSX: one sheet per object covered (requests, projects, tasks), with an event column in place of the three lists. The reference cells link to the item, with absolute links when an application address is configured and relative ones otherwise.
- GET `/portfolio/reports/filter-values`: project and team options for the report filters **[Requires: portfolio_reports:reader]**
  - Response: `{ projects: { id, ref, name, status }[], teams: { id, name }[] }`. Open projects come first. Served under the reports' own permission, so a report reader needs no access to the project list or the team settings.
- GET `/portfolio/reports/flow?weeks=&months=&tz=&sourceIds=&categoryIds=&projectIds=&teamIds=`: flow report **[Requires: portfolio_reports:reader]**
  - `weeks` and `months` take the horizons the screen offers; any other value falls back to the default. Ids are comma-separated.
- GET `/portfolio/reports/upcoming?taskDays=&projectDays=&requestDays=&tz=&projectIds=&teamIds=`: what is due soon **[Requires: portfolio_reports:reader]**
  - Each `...Days` takes the horizons the screen offers; any other value falls back to the default.
- GET `/portfolio/reports/steering-summary?days=&tz=`: steering summary **[Requires: portfolio_reports:reader]**
  - `days` takes the horizons the screen offers; any other value falls back to the default. A project with no activity for the stale threshold counts as stale.
- GET `/portfolio/reports/attention-by-assignee?staleDays=&tz=&projectIds=&teamIds=`: items that need attention, by assignee **[Requires: portfolio_reports:reader]**
- GET `/portfolio/reports/classification-gaps`: items missing a source, category or stream **[Requires: portfolio_reports:reader]**
- GET `/portfolio/reports/capacity-heatmap?teamIds=...&statuses=...&capacityMode=...&groupBy=...` — capacity heatmap **[Requires: portfolio_reports:reader]**
  - `teamIds`: comma-separated team ids; include `no-team` to include contributors without a team (omit to include all teams)
  - `statuses`: comma-separated project statuses; default is `waiting_list,planned,in_progress,in_testing,on_hold`
  - `capacityMode`: `historical` (default) or `theoretical`
  - `groupBy`: `contributor` (default) or `team`
  - Response: `{ contributors: ContributorCapacityRow[], teams: TeamCapacityRow[], unassignedSummary, unassignedProjects, filters }`
- GET `/portfolio/reports/capacity-heatmap/export?teamIds=...&statuses=...&capacityMode=...&groupBy=...&format=csv|xlsx&language=` — the contributor and team tables as a file **[Requires: portfolio_reports:reader]**
  - Same parameters and service call as the heatmap, with stricter values: an unknown status, a team id that is neither a uuid nor `no-team`, or any other query key is a `400`.
  - CSV: the table of `groupBy`; XLSX: both tables (the `groupBy` one first) and a Parameters sheet. Headers and fixed words in `language` (else the user's locale); "N/A" is an empty cell. Common rules: `backend/src/common/report-export/report-export.ts`.
- GET `/portfolio/reports/time-logged?months=6|12&tz=&projectIds=&teamIds=` — days logged by month, team and person **[Requires: portfolio_reports:reader]**
  - Each month cell carries `projectDays`, `otherDays` and `totalDays` (the two added, one decimal: the total the screen shows).
- GET `/portfolio/reports/time-logged/export?months=6|12&tz=&projectIds=&teamIds=&format=csv|xlsx&language=` — the report table as a file **[Requires: portfolio_reports:reader]**
  - One row per person and month: Team, Person, Month (`YYYY-MM`), Project days, Other days, Total days, from the same report call. `months` defaults to 6. A `months` other than 6 or 12, an unknown `tz`, a `projectIds` or `teamIds` value that is not an id or names no project (team) of the tenant, or any other query key is a `400`. The data route is lenient on ids; the export is not, so the Parameters sheet never lists a filter the file did not apply.
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
- POST `/portfolio/reports/roadmap/occupation/export?format=csv|xlsx&language=&tz=&table=contributors|teams`: the occupation tables of a roadmap generation as a file **[Requires: portfolio_reports:reader]**
  - The body is the `generate` payload, validated the same way. The generation runs without the sensitivity reruns, which only rank the bottlenecks.
  - CSV: one table, picked by `table` (required, `400` otherwise). XLSX: both tables (the `table` one first) and a Parameters sheet. Any other query key is a `400`. Recorded as an export (the path ends with `/export`).

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
- POST `/portfolio/projects/:id/opex/bulk-replace` — replace OPEX links (logs `opex_items` diff) **[Requires: portfolio_projects:contributor]**. Every id must name an OPEX line of the tenant, or nothing is written: `400` "One or more OPEX items were not found."; the links to lines of another nature are kept
- GET `/portfolio/projects/:id/relations` **[Requires: portfolio_projects:reader]** → `{ year, budget_column: { key, label }, budget_lines, applications, assets, technologies, source_requests }` in one round trip. The project is resolved with the reader's participation scope. A section the caller cannot read is `null`: `budget` for `budget_lines`, `applications` for `applications`, `infrastructure` for `assets` and `technologies`, `portfolio_requests` for `source_requests`.
  - `budget_lines`: lines of both natures linked through `portfolio_project_opex` (`opex_id`), with the year's amount on the tenant's default budget column.
  - `applications`: `{ id, reference, name, lifecycle, business_criticality, status }`. A Business Contributor sees the applications they take part in.
  - `assets`: `{ id, reference, name, kind, environment, status }`.
  - `technologies`: `{ id, reference, name, family, vendor }`.
  - `source_requests`: `{ id, item_number, name, status }`, the requests this project comes from. Read only. A Business Contributor sees the requests they take part in.
- POST `/portfolio/projects/:id/relations/:kind` with `{ id }` and DELETE `/portfolio/projects/:id/relations/:kind/:targetId` **[Requires: portfolio_projects:contributor]** → `{ ok: true, changed }`. `kind` is `budget_lines`, `applications`, `assets` or `technologies`. Any other kind, `source_requests` included, is `404` `Unknown relation type.`. The project row is locked (`FOR NO KEY UPDATE`) and resolved at contributor, with the participation scope. A row already linked, or absent from the set, answers `changed: false` and writes nothing. An id that is not a uuid is `400` `Invalid id.`.
  - `budget_lines`, `applications` and `assets` also need a read of their module (`403` `You cannot read this module.` otherwise). The line's nature is read on the server. The link is written by the OPEX or CAPEX replacement of that nature, which logs `opex_items` or `capex_items`. Applications and assets go through their own replacement and log `applications` or `assets`. The replacement receives the whole stored set plus or minus one id, so a link outside the caller's participation scope stays. A missing line is `400` `Budget line not found.`. A missing application, or one outside that scope, is `400` `One or more applications were not found`. A missing asset is `400` `One or more assets were not found`.
  - `technologies` also needs `infrastructure:reader` (`403` `You cannot read technologies.` before the service). One row on `technology_projects` and one audit row: `table` `technology_projects`, `recordId` the project, `before` and `after` the sorted ids. A missing technology is `400` `One or more technologies not found.`.
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
  - Note: Tasks are independent objects; budget permissions alone do not grant task create/edit rights
- PATCH `/spend-items/:id/tasks` → update task **[Requires: tasks:member]**
  - Body: `{ id: string, title?: string, description?: string, status?: string, due_date?: string, assignee_user_id?: string }`
  - Requires task `id` in body; validates task belongs to specified item
  - `title` cannot be empty if provided
  - `description` can be null or omitted
  - Note: budget permissions alone do not grant task create/edit rights

### Contracts Task Management
- GET `/contracts/:id/tasks` → list tasks for specific Contract (sorted by creation date DESC) **[Requires: tasks:reader]**
- POST `/contracts/:id/tasks` → create task **[Requires: tasks:member]**
- PATCH `/contracts/:id/tasks` → update task **[Requires: tasks:member]**
  - Same body/validation semantics as OPEX tasks (title required, description optional, unified statuses)

### Contracts CSV
- Export `GET /contracts/export?scope=template|data`; Import `POST /contracts/import?dryRun=true|false` (a row that turns off `auto_renewal` on a contract already renewed is an error of that row; nothing is written)
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

- GET `/contacts/:id/usages` — where the contact is used, by type of object. [Requires: contacts:reader]
  - Response: `{ total, groups: { type, total, items: { id, reference, name, nature?, status, active, roles }[] }[] }`. Types, in this order: `suppliers`, `budget_lines` (both natures), `contracts`, `applications`, `assets` and `technologies` (support contacts), `locations`, `projects`, `requests`.
  - One item per object. `roles` holds the contact's roles on it: contact types (`commercial`, `technical`, `support`, `other`) for suppliers, budget lines and contracts; the free text of the link for applications, assets, technologies and locations (trimmed, blanks dropped); empty for projects and requests.
  - Shared rules with `/suppliers/:id/usages` (below): a group appears only when it has objects and the caller reads its resource (`suppliers`, `budget`, `contracts`, `applications`, `infrastructure` for assets and technologies, `locations`, `portfolio_projects`, `portfolio_requests`), and `total` sums the groups shown. A group lists at most 50 objects, active ones first; its `total` counts them all. `reference` is the business reference (`BL-n` for both natures, `TEC-n`, `PRJ-n`, `REQ-n`) or `null`; `nature` (`opex`/`capex`) is set on budget lines; `status` is the stored status (`enabled`/`disabled` for suppliers, budget lines and contracts, the lifecycle for applications and technologies, the workflow status for projects and requests, the asset status, `null` for locations); `active` is false once the object is disabled or past its end of validity, or retired for a technology. A malformed id is a `400`, an id of another tenant a `404`.

### Contacts CSV
- Export: `GET /contacts/export?scope=template|data` (semicolon separator, UTF‑8 with BOM)
- Import: `POST /contacts/import?dryRun=true|false`
- Headers: `first_name;last_name;job_title;email;phone;mobile;country;notes;active`
- Upsert key: `email` (per tenant). Import normalizes to lowercase; creates when missing; updates otherwise.
- Validation: `email` required; `country` ISO alpha‑2; `active` accepts `true|false|1|0|yes|no`.

### Suppliers ↔ Contacts Links
- GET `/suppliers/:id/contacts` — list links with embedded contact and role. [Requires: suppliers:reader]
- GET `/suppliers/:id/usages` — where the supplier is used: `{ total, groups: { type, total, items: { id, reference, name, nature?, status, active }[] }[] }`, types `budget_lines` (both natures), `contracts`, `applications`, `assets` (support vendor). Its contacts are listed by `/suppliers/:id/contacts`. Same rules as `/contacts/:id/usages`. [Requires: suppliers:reader]
- POST `/suppliers/:id/contacts` — attach `{ contactId, role: 'commercial'|'technical'|'support'|'other', isPrimary? }`. [Requires: suppliers:manager]
- DELETE `/suppliers/:id/contacts/:linkId` — detach. [Requires: suppliers:manager]
- POST `/suppliers/delete-check` and POST `/companies/delete-check` with `{ ids: string[] }` [Requires: suppliers:admin / companies:admin] → `{ refused: Array<{ id, name, code, usages }> }`: the records of the tenant a delete would refuse (`SUPPLIER_IN_USE`, `COMPANY_IN_USE`, with the counts per kind), asked before the list's confirmation. Nothing is written (`common/record-in-use.ts`, `refusalsOf`).
- The same check, same body and answer, for the portfolio settings lists and knowledge folders: POST `/portfolio/classification/{sources,categories,streams,task-types}/delete-check`, `/portfolio/teams/delete-check`, `/portfolio/employment-types/delete-check` [Requires: portfolio_settings:admin] (`BUILT_IN_RECORD`, `RECORD_USED_BY`, `TEAM_NOT_EMPTY`), and `/knowledge-folders/delete-check` [Requires: knowledge:member] (`KNOWLEDGE_FOLDER_HAS_SUBFOLDERS`). Each delete asks the same refusal function (`refusalsFrom`).

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
  - `scope`: `opex` (default), `capex` or `all`
  - Requires `reporting:reader`
  - The tables the screens show are built by the server (`chargeback-report.tables.ts`). Global: `detailedRows` (each company's total row, `rowType: 'company'`, then its departments), `companies[].share`, `nettedFlows` (one row per pair of companies, payer to consumer), `kpiTotals` (null without a company). Company: `items[].itemLabel` (`BL-n · name` for a line the person cannot read), `itemsTotalShare`, `intercompanyRows` (receivables and payables per partner, `net`) and `intercompanyTotal`. Shares are fractions; a null department or company name is a label the client words (common costs, unknown department, unknown company).
- GET `/reports/chargeback/global/export?year=&metric=&scope=&format=csv|xlsx&language=&tz=&table=detailed|companies|flows|kpis`
- GET `/reports/chargeback/company/export?companyId=<uuid>&year=&metric=&scope=&format=csv|xlsx&language=&tz=&table=departments|items|intercompany|kpis`
  - The report tables as a file, from the same service call as the data route (same guard, same 403 for a person under data-scoped access outside their coverage). Excel: one sheet per table and a Parameters sheet; CSV: the table named by `table` (required). Totals are footer rows, left out for a person under data-scoped access; no data row is a total, so each amount column adds up (the `detailed` table holds the department rows only, the company totals are the `companies` table). Unknown parameters and invalid values are a 400. Recorded as an export with its row count.
  - `warnings`: sentences, or structured warnings each screen words in the user's language:
    - `{ code: 'turnover_fx_missing', items: [{ companyId, companyName, currency, year }], reportingCurrency }`: a company whose turnover has no rate for the year is left out of the turnover indicators (its row stays in its own currency). The other companies' turnovers are converted. Example: `{ "code": "turnover_fx_missing", "items": [{ "companyId": "…", "companyName": "New York", "currency": "USD", "year": 2026 }], "reportingCurrency": "EUR" }`
    - `{ code: 'amount_fx_missing', items: [{ currency, year, lines }], reportingCurrency }`: a budget line whose currency has no rate for its year is left out of every sum of the report (paid, consumed, departments, items, intercompany flows, KPIs, raw amounts included), so the report balances on what it counts. One warning per report lists every pair with its number of distinct lines. Example: `{ "code": "amount_fx_missing", "items": [{ "currency": "JPY", "year": 2026, "lines": 2 }], "reportingCurrency": "EUR" }`

### Budget report exports
- GET `/reports/budget/comparison/export?startYear=&endYear=&metrics=budget,landing`
- GET `/reports/budget/columns-compare/export?selections=2026:budget,2027:budget&yearGrouping=true|false`
- GET `/reports/budget/top-lines/export?year=&metric=&top=&excludeIds=<line id>,…&excludeAccounts=["<account label>",…]`
- GET `/reports/budget/increases-decreases/export?sourceYear=&sourceMetric=&destinationYear=&destinationMetric=&direction=increase|decrease|both&top=&excludeIds=&excludeAccounts=`
- GET `/reports/budget/consolidation/export?startYear=&endYear=&metric=&excludeAccounts=<account id or none>,…`
- GET `/reports/budget/analytics/export?axis=<dimension id>&startYear=&endYear=&metric=&excludeValues=<value id or none>,…`
  - `detail=values|lines` (default `values`): with `lines`, the lines of every value follow it (level, reference, nature, amounts, share of the value per year). `split=none|nature` (default `none`): with `nature` and `scope=all`, every row and the total get their OPEX and CAPEX shares per year (a line's are 1 and 0); ignored on the OPEX or CAPEX lines alone
- GET `/reports/budget/staffing/export?group=costCenter|item|supplier|axis:<dimension id>&year=&metric=`
- GET `/reports/budget/cost-per-fte/export?group=&view=fte|rate&pairs=2025:budget,2026:budget`
  - Every route also takes the screen's address: `scope=all|opex|capex` (default `all`), `measure=amount|fte` (default `amount`; not on the staffing and cost per FTE routes), `costCenter=<id>` (the node and every node below it), `runBuild=run|build|none`, `fte=with`, `analytics=<dimension id>:<value id or none>,…`, plus `format=csv|xlsx`, `language`, `tz`
  - Requires `budget:reader`, as the aggregate routes. The server rebuilds the screen's request (`spend/reports/shared/reportAggregates.ts`, a byte-identical copy of the frontend file), runs it on the aggregate route's path in the request's transaction, and writes the screen's table (`spend/reports/shared/reportTables.ts`): amounts to the cent, FTE as numbers, shares as fractions. Excel adds a Parameters sheet. A person under data-scoped access gets the figures of their lines, the `X-Data-Access: limited` header and the access line. Years must be in the screen's window (Y-2 to Y+2; Y-1 to Y+1 for the top, the consolidation, the analytics and the staffing reports), columns shown, excluded lines, accounts and values among those the exclusion pickers offer, `axis` and `group=axis:<id>` an enabled dimension of the scope's lines (without `axis`, the default dimension's field; without `group`, by cost center), `pairs` 1 to 4 year and column pairs, each once; anything else is a 400. Increases and decreases list the increases first, the change as a fraction of the source (empty when the source is empty or not above 0). Consolidation, analytics, staffing and cost per FTE write their total as a footer row. Staffing: one row per group with a monthly FTE, the twelve months (named in `language`), the average and the peak, FTE as numbers. Cost per FTE: one request per pair, three columns per pair headed `<value> (<column> <year>)` (FTE, staff cost, cost per FTE; or days, day cost, daily rate with `view=rate`), costs and rates to the cent, the total row's ratio the ratio of the totals. Rows of equal value are ordered by label in `language`. Recorded as an export with its row count.

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
  - Resources and scopes: `/suppliers/lookup` (`{ id, name, erp_supplier_id, status }`, the ERP id is searched too), `/accounts/lookup?companyId=` (the company's chart, else the global default chart; or `coaId=`; `nature=opex|capex` offers the accounts of that nature and those for both, `ids=` ignores it, any other value is a 400; `{ id, account_number, account_name, description, coa_id, nature }`, by number, a typed number ranks first), `/companies/lookup`, `/departments/lookup?company_id=`, `/users/lookup` (people: `{ id, first_name, last_name, email, status }`, names only, searched as "first last" and "last first", sorted by last name; `email` is set only for a person without a name, the only case it is shown or searched), `/analytics-categories/lookup?axis_id=&applies_to=opex|capex` (`applies_to` offers the values for that type and those for both, `ids=` ignores it so a held value of the other type still displays, any other value is a 400 "applies_to must be 'opex' or 'capex'."; rows carry `applies_to` and `sort_order`; in the dimension's order, `sort_order` then name, a typed text keeping its match rank first), `/business-processes/lookup`, `/contracts/lookup`
  - Read access (`common/lookup/lookup-requirements.ts`): a search (`q`, blank or not) needs read access on the reference's own page, or the level that edits a page whose forms pick it (member; contributor for incidents); read access on such a page allows `ids` only (the labels of values already chosen), and a search answers 403 `lookup_search_forbidden`. Exception: `/users/lookup` searches for the readers of every page with "Send link" (OPEX, CAPEX, tasks, requests, projects, applications, infrastructure, locations, knowledge). `/companies/lookup` and `/departments/lookup` keep their reader-level search (read-only reports filter on a company)
  - Currency settings are a budget setting. GET `/currency/settings` and GET `/currency/rates` need `budget_ops` or `budget` at `reader` (the OPEX and CAPEX forms read their currency picker); PATCH `/currency/settings` and POST `/currency/rates/refresh` need `budget_ops:admin`. GET `/currency/rates` answers `{ currencies, rates }`: `rates` is the latest set of each year in the current reporting currency, each year's maps limited to the currencies in use plus manual rates, and `currencies` is that row list with the reporting currency first (see `doc/features/master-data/currency-management.md`). `PUT /currency/rates/manual` and `DELETE /currency/rates/manual/:year/:currency` add `frozenVersions`, the number of versions of that budget year the manual rate does not reach (pinned to a set of the current reporting currency that rates the currency). The IT landscape `settings` resource grants nothing on currencies. GET `/currency/settings` writes nothing (the currency rows are ensured when the settings are saved). `POST /currency/rates/refresh` queues the years on the tenant's refresh queue (merged into the next run when a run already going does not cover them) and waits up to 20 seconds for the run that covers them. It answers `{ ok, completed: true, failed, years, fetched, stillMissing }` when that run finished (`failed` true when it captured nothing, source unreachable or job error, with `fetched` 0; `fetched` is the number of currency-year pairs of the current reporting currency that gained a usable rate, `stillMissing` the pairs still without one) or `{ ok, completed: false, years }` when the wait ends first. Without `years`, the set is the previous, current and next calendar years, the years of missing pairs, and the years with a non-zero budget amount. `PATCH /currency/settings` saves in the request transaction (a `reportingCurrency` outside `ISO_CURRENCIES` is 400 `currency_invalid`), queues the refresh to start after the commit, and answers the settings plus `refreshYears` without waiting: every year in use for the new base when `reportingCurrency` changes (budget version years, company metric years with a turnover, the years contract amounts are read for, the current year and the year on each side of it, and frozen years), otherwise the current year. The client waits for the result with `POST /currency/rates/refresh` and `{ years: refreshYears }`. `GET /currency/reporting-change-impact?to=CHF` (`budget_ops:admin`) answers `{ manualRates: [{ currency, year, rate }], frozenVersions: [{ year, count }], allowedAdded }` before that save: manual rates of the current base, frozen versions by year, and whether `to` will be added to a restricted allowed list (`false` when the list is unrestricted). `to` must be an ISO currency code (400 `currency_invalid` otherwise)
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
  - `budget` covers every budget line, OPEX and CAPEX alike (lot R, migration `1853990000000`, which gave each role the higher of its former effective `opex` and `capex` levels: a `manager` row, which opened nothing, still opens nothing). The former names are aliases of `budget`: a row still named `opex` or `capex` (a tenant export or a database of before) is read as `budget` at the higher level; in a PUT, the keys that name `budget` are merged at the highest level given, a `null` removes the right only when every key naming it is `null`, and the rows of the former names are replaced. `GET /roles/:id/permissions` and `GET /auth/me` answer `budget`, never `opex` or `capex`
  - Note: `Administrator` and `Contact` are system-locked; the former is always full access, the latter cannot be granted access or login

## Audit Logs (Admin)
- Permission: `users:admin`
- GET `/audit-logs?page=1&limit=100&sort=created_at:DESC&q=...&q_tables=...&from=YYYY-MM-DD&to=YYYY-MM-DD&table_name=...&action=...&source=...&user_id=...&filters=<agGridFilterModel>`
  - Returns paginated audit entries for the current tenant:
    - `{ items, total, page, limit }`
  - Item shape:
    - `{ id, tenant_id, table_name, record_id, action, before_json, after_json, user_id, user_email, user_name, source, source_ref, created_at }`
  - Supports quick search (`q`) across `table_name`, `action`, and actor name/email. With a search, `q_tables=<code>,<code>` (optional) also matches those tables: the web app sends the codes whose label, in the reader's language, holds the text ("Fournisseurs" → `suppliers`). Values other than table codes (`[a-z][a-z0-9_]*`) are ignored; at most 300. The export and `filter-values` take it too.
  - Supports date range filtering:
    - `from` is inclusive (`>=`)
    - `to` is exclusive (`<`) when a full datetime is provided; for `YYYY-MM-DD`, API treats it as end-of-day inclusive by shifting to the next day internally.
  - Whitelisted sort fields: `created_at`, `table_name`, `action`. Default: `created_at:DESC`.
  - `source` identifies origin (`user`, `system`, `webhook`); `source_ref` stores upstream event correlation (for example Stripe event id).
  - The grid's date filter (`filters.created_at`, a date model) applies on the server, by day, for the list and the export. Days must be real calendar dates.
  - Answers 400 for an invalid `from`, `to` or grid date, and for a `user_id` (parameter or grid filter) that is not a user id (UUID).
  - Besides data changes, the log holds sign-in and session events (`table_name = auth`: `login`, `login_failed`, `logout`, `refresh_denied`, `password_reset_requested`, `password_reset_completed`, `sso_login`, `sso_login_failed`; the reason in `source_ref`; `after_json = { ip, user_agent }`) and exports (`table_name = export`, `action = export`; `after_json = { resource, path, query, ip, user_agent }`, plus `format`, the type of the file sent (`csv`, `xlsx`, `pdf`, `docx`, `odt`, `markdown`, else its media type; absent when the response named none), and `rows` when the export reports its row count, today the budget file). Sign-in and session events are deleted after 365 days.
- GET `/audit-logs/export?sort=...&q=...&filters=<agGridFilterModel>&from=...&to=...&table_name=...&action=...&source=...&user_id=...`
  - Permission: `users:admin`. Same filters, search and sort as the list; `page` and `limit` do not apply. Answers 400 on the same invalid dates and user ids as the list, and on a request without a tenant (platform host).
  - Returns the matching entries of the current tenant as a CSV file (`Content-Type: text/csv; charset=utf-8`, `Content-Disposition` with `audit-log-YYYY-MM-DD.csv`). The file is read in batches of 1,000 rows and streamed, so memory stays bounded. If an error occurs after the first part was sent, the server closes the connection and the client receives an incomplete file.
  - At most 100,000 rows, in the list's order (newest first by default). When more rows match, the response carries `X-Export-Truncated: 100000` (the limit) and the file holds the first rows only.
  - One fixed format, whatever the user's language: RFC 4180, comma separator, UTF-8 without a byte order mark, English headers `date,action,table,record_id,user,source,source_ref,ip,user_agent,before,after`. `date` is ISO 8601 in UTC; `action`, `table` and `source_ref` are the stored codes; `user` is the person's name (their address when they have no name), else `Unknown account`, `Webhook` or `System`; `ip` and `user_agent` are filled for sign-in, session and export rows only; `before` and `after` are compact JSON. Every cell is guarded against spreadsheet formulas.
  - `before` and `after` hold the complete values stored in the log, personal data included, the same as `GET /audit-logs/:id` and at the same permission. Password hashes and MFA secrets are never written to the log.
  - Recorded in the audit log like every `/export` route. Rate-limited as the other document exports (429 beyond 5 requests a minute per client address).
- GET `/audit-logs/filter-values?fields=table_name,action,source&q=...&filters=<agGridFilterModel>`
  - Returns distinct filter values for checkbox-set column filters, scoped by the current query state.
  - Response shape:
    - `{ table_name?: (string|null)[], action?: (string|null)[], source?: (string|null)[] }`
- GET `/audit-logs/:id`
  - Returns one audit entry with the same shape as list items.
  - Used by the detail dialog to display full before/after JSON payloads.

## Record history
- GET `/records/:table/:id/history?cursor=&limit=`
  - The history of one record, for the person who can open its page: no other right. `:table` is the route key of the record family (`spend_items` for every budget line, OPEX or CAPEX). The permission is the record's module at `reader` (`budget:reader` for a budget line), else `403`.
  - The record is read first in the request transaction, under the tenant and the person's data access. An unknown table, an id that is not a UUID, and a record that is missing or outside the person's access answer `404`, as the record's page does.
  - `limit` defaults to 50 and is capped at 100. `cursor` is the opaque `nextCursor` of the previous page. The answer is `{ items, nextCursor }`, newest first; `nextCursor` is `null` on the last page. An invalid cursor, including a timestamp that is not a complete ISO date with its offset, is a `400`.
  - Item: `{ id, at, action, actor: { kind, name }, subject: { kind, label? }, changes: [...] }`.
    - `action` is the stored action (`create`, `update`, `delete`, `disable`, `restored`).
    - `actor.kind`: `user` (the person named), `system` (source `system`, or no author), `import` (the budget file, an import), `assistant` (Plaid, source `ai_chat` or `ai_mcp`; `name` is the person it acted for, or `null`).
    - `subject.kind`: `record` for the record's own rows, else `version`, `amounts`, `allocations`, `round_input`, `link`, `attachment`, `contact`, `application`, `technology`, `asset` or `task`. `label` names the version, the file, the link, the contact, the application, the technology, the asset or the task; a set change has no label.
    - `changes` holds `{ field, before?, after?, event?, year?, column?, sourceYear?, sourceColumn?, percentageIncrease?, monthlyOnly?, months?, wholeYear?, dimension?, changed? }`. Fields are the stored keys (`planned`, `supplier_id`, `status`, ...), values are raw except the references below. Only the keys a label knows are returned: an unknown key of an old or new payload is dropped. A creation has `after` only, a deletion `before` only.
    - A budget amount is one change per year and column: the `year` and `column` context, the sum of the months the write touched before and after, and the list of those `months` (`YYYY-MM`); `wholeYear: true` marks the twelve months of the year. `monthlyOnly: true` marks a write whose touched months total the same before and after, so only their distribution moved. A budget-file flat spread writes yearly totals instead: `after` (and `before` when the payload carries it), `year`, `column` and `wholeYear: true`, with no month list. An allocation change gives the number of targets; an allocation copy adds `sourceYear` and `year` (the destination). A dimension change has `field: 'dimension'`, the dimension name and the category names before and after. A link, attachment, contact, application, technology, asset or task change carries `event: 'added' | 'removed'` and the child in `before` or `after`.
    - A value that names another module's record is `{ kind, id, label, reference? }` when the person reads that module and the record is visible in their access, with the screen's own rules: a Business Contributor's participation for applications, projects and requests, and their tasks; a task on a confidential incident follows the incident register. Otherwise it is `{ hidden: true, kind }`. A person outside the tenant or a deleted account is hidden the same way. No neighbouring label from the audit payload (`supplier_name`, `contract_name`, `*_label`) is copied.
  - Only the budget lines (`spend_items`) are declared in this run. The inventory (`backend/src/audit/record-history.inventory.ts`) declares each family's table, module, audit labels, children and the document checks.

## Budget Operations (budget admin)

### Copy budget columns (all lines or one nature)
- POST `/budget-lines/budget-operations/copy` (requires `budget:admin`; Budget administration › Copy budget columns)
  - Body: `{ scope: 'all' | 'opex' | 'capex', sourceYear, destinationYear, amounts?: { sourceColumn, destinationColumn, percentageIncrease?, acceptCalendarChanges? } | null, allocations?: boolean, overwrite?: boolean, dryRun?: boolean }`
  - Two parts, either or both: `amounts` is the column copy below (same rules: months kept, whole units with a percentage, lines recomputed, validity, calendar confirmation), `allocations: true` the allocation copy below. `all` runs both natures. One `overwrite` covers both parts: the amounts of a destination column that holds some, and a destination allocation with manual rows (an allocation on an automatic method, without manual rows, counts as empty and takes the source method either way)
  - One tenant lock (`operation_running` 409 while another bulk operation runs; a dry run takes none) and one transaction: the lines in play, of every nature of the scope, are locked first in id order in one statement, and each part reads its lines again under that lock and locks no line of its own. A line that entered the scope after that lock (a line created meanwhile) refuses the copy with a 409 `retry` rather than be locked out of order. The amounts of every nature are decided before any is written, then written, then the allocations are copied. Any refusal or error leaves nothing written
  - 400: no part asked (`amounts` missing, `null` or `false` and `allocations` not `true`), `allocations` within one year, a percentage of -100 or less, a column onto itself, an unknown `scope` or column, a calendar change not confirmed on a real copy. 403: the destination column of either nature is frozen (the message names the nature); the allocations have no freeze
  - Returns `{ success, dryRun, scope, summary: { lines, amounts?: { totalItems, processed, skipped, errors }, allocations?: { totalItems, processed, skipped, errors } }, results: CopyBudgetLine[] }`, `success` false when the allocation preview lists an error. A real copy answers the entries its preview answered, line by line and part by part: a line whose destination version the amounts part creates during the copy keeps, in its allocations part, the destination as it was before the copy (`destinationMethod: null`, an empty label, no row), and a skipped line its destination amount as read, though the copy neither locks nor writes it
  - `CopyBudgetLine`: `{ itemId, itemNumber, reference, nature, itemName, amounts?, allocations? }`, one per line valid in the destination year. `itemNumber` is the line's own number and `reference` its `BL-n` (never the CPX number). `amounts`: `{ sourceValue, currentDestinationValue, newValue, skipped, skip, prorated, fromLines, calendarIssues }`, `skip` one of `no_source` (no version in the source year), `source_empty` (nothing to copy within the line's validity), `destination_filled` (the destination holds amounts, without overwrite), or null. `allocations`: the `AllocationCopyResult` below without `itemId` and `itemName`
  - Audit: the rows of each part as below; the column copy row of the line and the allocation copy rows also carry `budgetCopy: { scope, nature, parts }`

### Reset a column (all lines or one nature)
- POST `/budget-lines/budget-operations/clear-column` (requires `budget:admin`)
  - Body: `{ scope: 'all' | 'opex' | 'capex', year, column }`. The clear below on each nature of the scope, under one tenant lock, the lines in play locked first in id order (a line that entered the scope after that lock: 409 `retry`); a frozen column of either nature refuses the whole reset (403 naming the nature)
  - Returns `{ success, scope, summary: { totalItems, cleared, skipped, errors } }`, the natures added up
- GET `/budget-lines/budget-operations/clear-column/export?scope=all|opex|capex&year=YYYY&column=&format=csv|xlsx&language=&tz=` (requires `budget:admin`, reserved to people without data-scoped access): the lines of "Reset a column" with the column's amount, largest first, as the screen shows them
  - `scope`, `year` and `column` are required; `column` is one of the five columns and must be shown by the tenant. Any other query key is a `400`. One table; with `scope=all` it adds a column for the nature. Recorded as an export.
- GET `/budget-lines/budget-operations/copy/export?scope=all|opex|capex&sourceYear=&destinationYear=&amounts=true|false&allocations=true|false&sourceColumn=&destinationColumn=&percentageIncrease=&overwrite=true|false&format=csv|xlsx&language=&tz=` (requires `budget:admin`, reserved to people without data-scoped access): the preview of "Copy budget columns" as a file
  - `scope`, `sourceYear` and `destinationYear` are required. With `amounts=true`, `sourceColumn` and `destinationColumn` are required and `percentageIncrease` (a decimal, default `0`) is read; without it those three are a `400`. The preview is the dry run of the copy, so its checks apply (a part asked, the freeze, the percentage). The flags are `true|false` and default to `false`. Any other query key is a `400`. One table, largest source amount first when the amounts are copied. Recorded as an export.
- GET `/master-data-operations/copy/export?sourceYear=&destinationYear=&includeCompanies=true|false&includeDepartments=true|false&companyMetrics=headcount,it_users,turnover&format=csv|xlsx&language=&tz=` (requires `budget_ops:admin`, `companies:admin` or `departments:admin`, reserved to people without data-scoped access): the preview (dry run) of the master data copy as a file
  - `sourceYear` and `destinationYear` are four-digit years. `companyMetrics` is a comma-separated list. The dry run checks the rest as for the screen. Any other query key is a `400`. Recorded as an export.

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
  - Requires: `budget:admin` level
  - Notes:
    - True copy operation - source data is never modified
    - Preserves all other columns when updating destination column
    - Creates versions/amounts for destination year if they don't exist; a created version is named `Y<year>`
    - The destination column's quantity and price lines are replaced by the source column's, each period shifted to the destination year (29 February becomes 28 February), quantity and unit price unchanged (the uplift applies to the months only). For lines that are only a reference: cut to the item's validity (a line with no month left is dropped), a calendar without days for the destination year replaced by the paying company's standard calendar (accepted after the preview like the other calendar changes), the destination FTE computed from the copied lines on the destination year's calendars; without a replacement calendar the lines are copied as they are with the source's FTE. A source without lines leaves the destination without lines
    - Full audit logging for compliance

### Copy Allocations
- POST `/spend-items/budget-operations/copy-allocations` (OPEX lines, requires `budget:admin`)
- POST `/capex-items/budget-operations/copy-allocations` (CAPEX lines, requires `budget:admin`)
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
  - Requires: `budget:admin` level
  - Notes:
    - Sets all values in the specified column to zero
    - Preserves all other columns
    - Only processes items that have data in the target column
    - Full audit logging for compliance
    - Permanent operation - cannot be undone

### Budget file (OPEX and CAPEX)
One file for both natures since lot C1b: a `nature` column (`opex`, `capex`) says what each row is, and every check of a row follows its nature. The OPEX list exports its OPEX lines, the CAPEX list its CAPEX lines, in the same layout; either route imports a file of both. The manual is `doc/help/docs/en/budget-file.md`.
- GET `/spend-items/budget-file/export?language=en|fr|de|es&amountYears=2026,2027&columns=budget,revision&detail=yearly|months&all=true&format=csv|xlsx` (same on `/capex-items/budget-file/export`, and on `/budget-lines/budget-file/export` for the lines of both natures)
  - Requires `budget:admin` (a read: a frozen tenant keeps it). The other query parameters are the list's own (`sort`, `q`, `filters`, `status`, `includeDisabled`, `ctx`), and the file holds the lines the list engine returns, in its order: lines of the route's nature, `nature` filled, `item_number` written `BL-n`
  - One `analytics:<code>` column per enabled dimension; a line's cell is empty on a dimension of the other nature
  - `all=true` drops the filters, the search and the status scope and includes ended lines. `amountYears` defaults to the current year ±1, at most twelve years within ten years of the current one. `columns` defaults to the tenant's shown columns, in the fixed order `budget, revision, forecast, actual, landing`. `detail=months` writes `<column>_<year>_<mm>` instead of `<column>_<year>`
  - `format=xlsx` writes the same rows as a workbook of one sheet, `budget`: amounts are numbers (`#,##0.00`, the exact cents), days are dates in the language's format, references, codes and the token are text; an empty amount is an empty cell. `format` defaults to `csv`
  - `400` for an unknown column, no column at all, an unknown `detail`, a malformed `amountYears`, or a `format` other than `csv` or `xlsx` (any case). Zero lines still write the header row (the template). File name `budget.csv` (or `budget.xlsx`) on both routes
- POST `/spend-items/budget-file/preflight?language=…&dateOrder=day-first|month-first&decimalMark=comma|dot&createSuppliers=true|false` (multipart `file`; same on `/capex-items/budget-file/preflight`)
  - Read-only, no lock, nothing written. Requires `budget:admin`, which covers the lines of both natures (lot R): either route reads, checks and loads a file of both. `createSuppliers` is honoured only for a user allowed to create suppliers
  - `nature`: `opex` or `capex`, any case. A file without the column (an export of before lot C1b) is read as lines of the route's nature. Required on a new line when the column is there ("nature is required."); blank on an existing line keeps its nature; `-` is refused ("nature cannot be cleared."); another word is refused ("nature 'x' is not a value. Use opex or capex."). A row naming an existing line with the other nature is refused ("BL-125 is a CAPEX line, not an OPEX line. A file does not change the type of a line."), on `nature`, or on `item_number` for a file without the column
  - `item_number`: `BL-n` names the line's own number (unique per tenant) on both routes, and so does a bare number in a file with a `nature` column; in a file without it, a bare number keeps its meaning of before (`CPX-n` on the CAPEX route, the OPEX line's number on the OPEX route). `OPX-n` and `CPX-n` name the line by `legacy_number` (an `OPX-n` also an OPEX line's own number). A line named twice is a row error. `kanap_token` carries no line identity: it cannot tell that a number names another line than the one exported
  - `description`: the line's description for both OPEX and CAPEX, separate from `name` (title) and `notes`. Export and import use the same text normalization, including trailing line breaks.
  - Answers `BudgetFileReport`: `{ ok, scope, encoding, separator, notices: { dates, amounts }, fileErrors[], headerErrors[], errors: [{ line, column, message }], errorCount, missing: [{ type, count, examples, where, message }], deleted[], deletedCount, changes: { created, updated, unchanged, createdLines[], updatedLines[] }, changedSinceExport[], changedSinceExportCount, warnings: { duplicates[], ignoredColumns[], supplierNames[] }, creates: { dimensionValues[], suppliers[] }, supplierMessage, snapshot: { lines: [{ id, itemNumber, rowVersion, years: [{ year, versionId, budgetRev }] }] } }`. `scope` is the route's nature; the lines are named `BL-n` in `updatedLines`, `changedSinceExport` and the duplicate warnings, `itemNumber` of the snapshot is the line's own number
  - Header errors: an amount-looking column that does not parse (`budget_27`, `budjet_2027`), an `analytics:<code>` column naming no enabled dimension, a yearly header and a monthly header for the same column and year. The PP&E type, investment type and priority of a CAPEX line travel in `analytics:ppe_type`, `analytics:investment_type` and `analytics:priority` since lot C1; a file with the three former columns together (a CAPEX file exported before lot C1), on either route, is refused as a whole with one `fileErrors` entry; one or two of them alone are unknown columns, ignored with a warning ("The ppe_type, investment_type and priority columns are now dimension columns (analytics:ppe_type, analytics:investment_type, analytics:priority). Export a fresh file from this list, copy your changes into it, and import it again."). Row errors name the physical line, each checked against the row's nature: an unknown `item_number`, a line deleted since the export, a nature that differs from the line's, a missing reference (company, account, cost center, user, project), a line with no paying company that the load creates or updates, unless its cost center has one ("company_name is required."; amounts alone need none), an account for the other nature, a value of a disabled dimension, a value or `-` on a dimension of the other nature ("The Recurrence dimension is for CAPEX lines only. Leave it out."), a value for the other nature, a required dimension of the row's nature left empty (a new line with no value on it: column absent, blank cell or `-`, a value the load creates counting; an existing line clearing with `-` a value it holds; message "The Nature dimension is required. Choose a value." on the `analytics:<code>` cell), a cleared amount column, more than two decimals, an amount too large, a changed cell in a column frozen for the row's nature, a malformed `kanap_token`. Old layouts are refused as a whole with one `fileErrors` entry
- POST `/spend-items/budget-file/import?language=…&dateOrder=…&decimalMark=…&createSuppliers=…` (multipart `file` plus `snapshot`; same on `/capex-items/budget-file/import`)
  - Not a read. Requires `budget:admin`. `snapshot` is the preflight's `snapshot`, sent as JSON
  - The load re-runs the preflight under the tenant's bulk lock, locks the target lines in id order (both natures in one statement) and writes everything in one transaction: nothing on a row error. Each line is written by the item service of its nature, its fields named as the columns (`product_name`, `description` and `notes` for both natures), with the freeze, round inputs and audit labels of its nature; a new line takes the next BL number, a new CAPEX line also a CPX number. Answers `{ ok, dryRun: false, inserted, updated, createdSuppliers, createdDimensionValues }` (a `409` when a line moved between the check and the load; a report instead of a result when the second check refuses the file). Runs `ANALYZE` after more than 1,000 rows
- Refusals and codes: `400` "The preflight snapshot is missing. Run the preflight again." / "The preflight snapshot is not valid."; `409` "Some lines changed since the preflight. Run the preflight again."; `409 operation_running` "Another budget operation is running (copy, clear or import). Try again when it ends." (the per-tenant bulk lock, shared with copy, clear and allocation copy); `503 busy` with `Retry-After` while KANAP is saturated; `413` for a file over 48 MB or a `snapshot` over 24 MB ("This file is too large. A budget file can hold 20,000 lines. Export fewer lines or fewer years."), then the shared 20,000-row cap
- File layout, cell rules (`-` clears, `0` zeroes, empty keeps), matching by `item_number`, supplier matching and creation, the `kanap_token` freshness check and the write rules are in `doc/features/patterns/csv-import-export.md`
- **Data-scoped access**: a limited person whose role allows the file uses it within their access, line by line, with the rules of the screen.
  - Export: the list engine and the read by id run under the person's policies: the visible lines, whole. The response then carries `X-Data-Access: limited` (exposed by CORS) for "Calculated on your access".
  - Preflight and load: the report carries `dataAccessLimited: true`. A number naming a line out of read access is a number with no line ("item_number 'OPX-12' does not match a line.", or "OPX-12 is no longer available since the export." with a token, the message every person now gets for a deleted line). A readable line the person may not modify passes unchanged and is refused when the row changes it ("OPX-12 is read only in your access."). A new line, or a new company or cost center, needs a place the person may place a line in, owner or not ("This company or cost center is not part of your access.", on `cost_center_code` or `company_name`); an owner change must leave the line modifiable by them ("This change would take the line out of your access. …"). The checks call `data_access_line_editable` and `data_access_placable_line` (`spend/budget-file/access.ts`), as the line write gate does. An unknown value of an open dimension is created and listed in `creates.dimensionValues`; one of a closed dimension is a row error ("Value 'X' is not in the list of code. Pick an existing value.") and listed in `creates.refusedDimensionValues`. Suppliers follow `canCreateSuppliers` as before.
  - Load: the checks run again after the line lock; the snapshot lines carry `editable`. A line gone from the access or whose `editable` changed since the preflight answers `409` "Some lines changed since the preflight. Run the preflight again." and writes nothing; so does a write refused by the database (42501) or by a write check. The line lock skips read-only lines, which are never written. The file never deletes a line; freeze and audit are unchanged.
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
  - Response: `{ emails_enabled, workspace_settings: { portfolio: { enabled, status_changes, team_additions, team_changes_as_lead, comments }, tasks: { enabled, as_assignee, as_requestor, as_viewer, status_changes, comments }, budget: { enabled, expiration_warnings, status_changes, comments }, technologies: { enabled, vulnerabilities } }, weekly_review_enabled, weekly_review_day, weekly_review_hour, timezone }`
  - Returns defaults on first access (emails enabled, all categories on, weekly review Monday 09:00 in user's timezone)

- PATCH `/users/me/notification-preferences` → update (upsert)
  - Body: partial `NotificationPreferencesData` (any subset of the fields above)
  - Returns the full updated preferences object

- POST `/users/me/notification-preferences/test-weekly-review` → `{ success, message }`
  - Sends a test weekly review email to the current user immediately
  - Useful for verifying email rendering and delivery

## Health

- GET `/health` → `{ status: 'ok' }` — liveness probe

### Recently viewed check

POST `/dashboard/recent-items/existing` with `{ items: Array<{ type, id }> }` (at most 50) → `{ existing: Array<{ type, id }> }`: of the "Recently viewed" entries the browser holds, the records that still exist in the tenant, in one statement. Types: project, request, application, asset, interface, connection, contract, task, spend_item, capex_item, incident, location, document; others and malformed ids are left out (`dashboard/recent-items.ts`). Requires an authenticated user only.

### Personal budget dashboard settings

These routes require an authenticated user, as `/dashboard/config` does. The tenant comes from the request context and the user from the access token. Each user reads and writes only their own settings.

- GET `/dashboard/budget-config`: returns `{ tiles: [{ id, enabled, order, config }] }`. Without saved settings, all nine tiles are enabled in this order: `budget`, `hygiene`, `my-budget`, `my-tasks`, `renewals`, `top-lines`, `top-increases`, `cost-centers`, `recent-updates`. Missing tiles receive their defaults when read or saved, so newly introduced tiles appear enabled.
- PUT `/dashboard/budget-config`: saves the same shape. Unknown or duplicate tile ids return 400. The `budget` tile accepts `config: { columns: null }` (the tenant's enabled columns) or a non-empty array of amount column keys: `budget`, `revision`, `forecast`, `follow_up`, `landing`. Unknown column keys return 400. The UI intersects the saved selection with the tenant's currently enabled columns. `order` sets the tile order; the response numbers it from 1.
- POST `/dashboard/budget-config/reset`: restores the default budget tiles and tenant columns.

Budget settings are stored in `user_dashboard_config.budget_tiles`, independently of the main dashboard's `tiles`. Saving or resetting either dashboard preserves the other. Existing tenant RLS applies to both columns.
