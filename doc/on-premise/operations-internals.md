# On-Premise Operations (Internals)

This document captures operational design decisions and support boundaries for maintainers.
User-facing procedures live in `doc/help/docs/en/on-premise/operations.md`.

## Distribution Model

- **Build from source** only (open source model)
- No private registry
- Customers build Docker images locally

## Repository Layout (On-Prem Relevant)

```
kanap/
├── backend/
│   ├── Dockerfile           # API image build
│   ├── src/
│   └── ...
├── frontend/
│   ├── Dockerfile           # Web image build
│   ├── src/
│   └── ...
├── infra/
│   ├── compose.onprem.yml   # On-prem Docker Compose reference
│   ├── .env.onprem.example  # Configuration template
│   └── postgres/kanap-pg-tune.sh  # PostgreSQL settings sized from the host's memory (applies nothing)
├── doc/
│   └── on-premise/          # Maintainer docs
└── doc/help/docs/en/on-premise/  # User docs
```

## Versioning & Support

- Semantic versioning (`v1.0.0`, `v1.1.0`, ...)
- Releases are tagged in git

Support policy:
- **Current (N):** full support (features + security)
- **Previous (N-1):** security patches only for 12 months
- **Older (N-2+):** unsupported

## Upgrade & Rollback Expectations

- Migrations are forward-only
- Rollback requires database restore
- Production upgrades should use **release tags**, not `main`

## Deployment Constraints

- **One API container and one web container.** The API container can run several API processes (`API_WORKERS`, Node cluster, default 1): migrations run once in its entrypoint before the workers start, and scheduled jobs, notification dedupe, start-up provisioning and rate limits are coordinated through the database. See `doc/architecture.md`, "Several API Processes".
- HA should be handled by the customer (database HA, storage durability, restart policies)

## Maintenance Strategy

Single codebase with minimal feature flags.

**Single source of truth:** `backend/src/config/features.ts`
**Mode/feature gating utilities:** `backend/src/common/feature-gates.ts`

```
┌─────────────────────────────────────────────────────┐
│                  main branch                         │
│                                                      │
│   Common Code (98%)  │  Cloud-only  │  On-Prem-only │
│                      │  (Stripe,    │  (first-boot   │
│                      │   trial,     │   provisioning, │
│                      │   platform   │   SMTP in      │
│                      │   admin)     │   Phase 2)     │
│                                                      │
│         Runtime detection via environment variables  │
└─────────────────────────────────────────────────────┘
```

Rules:
- Keep flags minimal and centralized in `features.ts`
- Use `MultiTenantOnlyGuard` for controller-level gating, `throwFeatureDisabled()` for endpoint-level
- Every PR must pass cloud and on-prem CI builds (matrix in `.github/workflows/ci.yml`)

## External Connectivity

Outbound access may be required for:
- GitHub (clone source)
- npm registry (build dependencies)
- Resend API (email, if enabled)
- Microsoft Entra endpoints (SSO, if enabled)
- FX APIs (optional)

See user docs for the full list and firewall guidance.
