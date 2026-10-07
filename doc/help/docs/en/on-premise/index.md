# On-Premise Deployment

KANAP can be deployed on-premise in **single-tenant mode**. You provide your own PostgreSQL, S3-compatible storage, and TLS reverse proxy. KANAP handles everything else: migrations run automatically, the tenant and admin user are created on first boot. There is no user limit.

## Guides

- **[Installation](installation.md):** Clone, build, configure, and start
- **[Installation Example](installation-example.md):** Step-by-step walkthrough on Ubuntu 24.04 with PostgreSQL, MinIO, and nginx
- **[AI-Assisted Installation](installation-ai.md):** One-prompt installation using a coding AI agent
- **[Configuration](configuration.md):** Environment variables reference
- **[Operations](operations.md):** Upgrades, backups, monitoring, troubleshooting
- **[Microsoft Entra SSO](sso-entra.md):** Optional single sign-on with Microsoft Entra ID

## What's Included

- Full application functionality (budgets, contracts, portfolio, IT operations, reporting)
- Automatic database migrations on startup
- First-boot provisioning (tenant, admin user, subscription)
- Local username/password authentication (no external dependencies)
- Optional email via Resend API or customer-managed SMTP
- Optional Microsoft Entra SSO

## What's Disabled

- **Billing / Stripe:** Disabled automatically (no subscription management needed)
- **Platform admin:** Single-tenant only, no multi-tenant management surfaces
- **Trial / support invoice endpoints:** Not applicable to on-premise

## Quick Notes

- `DEPLOYMENT_MODE=single-tenant` is the single switch that activates on-premise mode.
- `APP_BASE_URL` must match the exact address users open (including a non-standard port) for email links, sign-in redirects and exports. Put the same address in `CORS_ORIGINS`.
- For outbound email, choose either **Resend** or **SMTP**. SMTP is intended for single-tenant/on-prem deployments only.
- The backend returns structured `FEATURE_DISABLED` responses for disabled features — the UI hides them automatically.
