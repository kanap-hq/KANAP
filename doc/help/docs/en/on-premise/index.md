# On-premise deployment

KANAP can be deployed on-premise in **single-tenant mode**. You provide your own PostgreSQL, S3-compatible storage, and TLS reverse proxy. KANAP handles everything else: migrations run automatically, the tenant and admin user are created on first boot. There is no user limit.

## Guides

- **[Installation](installation.md):** Requirements, name and certificate, clone, build, configure, and start
- **[Installation example](installation-example.md):** Step-by-step walkthrough on Ubuntu 26.04 with PostgreSQL, RustFS, a firewall, and nginx
- **[AI-assisted installation](installation-ai.md):** One-prompt installation using a coding AI agent
- **[Configuration](configuration.md):** Environment variables reference, start-up log lines, background jobs, firewall rules
- **[Operations](operations.md):** Versions and upgrades, backup and restore, monitoring, troubleshooting
- **[Microsoft Entra SSO](sso-entra.md):** Optional single sign-on with Microsoft Entra ID

## What's included

- Full application functionality (budgets, contracts, portfolio, IT operations, reporting)
- Automatic database migrations on startup
- First-boot provisioning (tenant, admin user, subscription)
- Local username/password authentication (no external dependencies)
- Optional email via Resend API or customer-managed SMTP
- Optional Microsoft Entra SSO
- Optional AI features, with your own provider

## What's disabled

- **Billing / Stripe:** Disabled automatically (no subscription management needed)
- **Platform admin:** Single-tenant only, no multi-tenant management surfaces
- **Trial / support invoice endpoints:** Not applicable to on-premise

## Quick notes

- **Versions.** KANAP publishes a version about once a month (`26.10.1` is the first). You install the `stable` branch, which always points to the latest published version, and upgrade by pulling it after reading `CHANGELOG.md`. Upgrade at least monthly. See [Operations](operations.md#upgrade-procedure).
- **Platform.** The example uses Ubuntu 26.04 LTS (Ubuntu 24.04 works). Any OS with Docker Engine 24+ and the Docker Compose plugin 2.20 or later (current releases are 5.x) is supported.
- **Storage.** The example runs RustFS on the server. Any S3-compatible storage works, and an existing MinIO keeps working.
- **Internal networks.** No public DNS is needed. Use a name from your company DNS (or a hosts file entry for a test) with a certificate from your internal authority. See [Name and certificate](installation.md#name-and-certificate).
- `DEPLOYMENT_MODE=single-tenant` is the single switch that activates on-premise mode.
- `APP_BASE_URL` must match the exact address users open (including a non-standard port) for email links, sign-in redirects and exports. Put the same address in `CORS_ORIGINS`.
- For outbound email, choose either **Resend** or **SMTP**. SMTP is intended for single-tenant/on-prem deployments only.
- Features that are disabled on-premise are hidden in the application automatically.
