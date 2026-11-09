# ADR 0002: Multitenancy Storage and Isolation Strategy

Status: Accepted
Date: 2025-09-20

## Context
We are preparing for a scalable, easy-to-operate SaaS with tenant-per-subdomain routing. A key design choice is how to store and isolate tenant data in Postgres.

Options considered:
- Per-tenant database (one DB per tenant)
- Per-tenant schema (one schema per tenant in a shared DB)
- Shared schema + `tenant_id` column on multi-tenant tables (single DB)

## Decision
Use a single Postgres database per environment with a shared schema. All multi-tenant tables include a `tenant_id` column. Enforce isolation with Postgres Row-Level Security (RLS) driven by a request-scoped session variable set by the API (e.g., `SET LOCAL app.current_tenant = '<uuid>'`). Avoid per-tenant databases.

## Rationale
- Operational simplicity: one set of migrations, one connection pool, simpler backups and failover.
- Performance & pooling: PgBouncer pools per (db,user); many databases degrade pooling efficiency and increase overhead.
- Consistent analytics: cross-tenant queries and admin views are straightforward.
- Real isolation requires separate clusters anyway; separate DBs in one cluster don’t isolate CPU/IO.

## Consequences
- Application must consistently set the tenant context per request/transaction and never use roles that BYPASS RLS.
- All multi-tenant tables must have RLS enabled and appropriate indexes with `tenant_id` leading.
- Migrations must add `tenant_id` and composite uniques as needed.
- Path to isolate a “whale” tenant later: extract rows by `tenant_id` to a dedicated cluster and repoint that tenant.

## Implementation Sketch
- Resolution: API resolves tenant from `Host` → tenant `slug` → tenant UUID.
- Session variable: `SET LOCAL app.current_tenant = '<tenant-uuid>'` at the start of each request’s DB transaction.
- Policy: `USING (tenant_id = current_setting('app.current_tenant', true)::uuid)`; optional trigger to default `tenant_id` on insert.
- Indexing: `PRIMARY KEY (tenant_id, id)`; `UNIQUE (tenant_id, slug)` and similar composite constraints.

## System Tenants
Certain tenants are designated as **system tenants** via the `is_system_tenant` boolean flag on the `tenants` table. System tenants are internal infrastructure tenants that support platform operations:

- **`platform-admin`**: The management tenant used for platform administration. This tenant provides the RLS context needed for platform admin operations without bypassing tenant isolation.

System tenants have special protections:
- Cannot be deleted, frozen, or have their status/slug modified.
- Hidden from the tenant list in the admin UI by default.
- Tenant slug reservation is centralized in `backend/src/tenants/tenant-slug-policy.ts` and enforced at signup plus tenant creation/update. Current reserved slugs: `www`, `api`, `admin`, `billing`, `account`, `platform-admin`, `app`, `nextcloud`, `migration`, `example`; in multi-tenant mode also `dev`, `qa`, `doc`, `send`, `tenants`, `mail`, `autodiscover`, `status`, `kanap` (a tenant that already holds one keeps it).

This design ensures platform operations work under the same RLS rules as regular tenants while maintaining clear separation.

## When to Revisit
- Contractual isolation or BYOK per tenant.
- Region/data-residency per tenant.
- A small number of high-value tenants needing dedicated hardware; in that case, prefer per-tenant cluster over per-tenant DB.

## References
- `doc/architecture.md` → Multitenancy section
- Nginx and provisioning flow notes in product docs
