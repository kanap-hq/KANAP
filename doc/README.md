w# Project Documentation

This folder hosts the project documentation. Files here are Markdown (`.md`) unless otherwise noted.

---

## 📚 Quick Navigation

### Core Reference (Start Here)
- **[architecture.md](architecture.md)**: System architecture, components, data flows, multi-tenancy, RLS
- **[frontend-architecture.md](frontend-architecture.md)**: UI structure, shared components, patterns (TanStack Query, ServerDataGrid, PageHeader)
- **[api-reference.md](api-reference.md)**: REST endpoints, authentication, master data, OPEX/CAPEX, contracts, reporting
- **[page-and-feature-overview.md](page-and-feature-overview.md)**: Complete page map, permissions, frontend/backend integration

---

## 🚀 Getting Started

**New to the project?**
1. Read [planning/product-vision.md](product-vision.md) - High-level vision and goals
2. Read [planning/v1-plan.md](v1-plan.md) - Current implementation status and V1 scope
3. Follow [setup/dev-setup.md](setup/dev-setup.md) - Set up your local environment
4. Review [setup/contributing.md](setup/contributing.md) - Contribution guidelines

---

## 📂 Documentation Structure

### `/help` - User Documentation (Published)

**Published to**: [doc.kanap.net](https://doc.kanap.net)

End-user documentation built with MkDocs. This folder is deployed automatically and should not contain any internal/technical content.

- **`docs/en/`**: English documentation (source files)
- **`docs/fr/`**: French documentation (future)
- **`mkdocs.yml`**: MkDocs configuration
- **`_process/`**: Documentation generation templates and inventory (not published)

**To build locally**:
```bash
cd doc/help
pip install mkdocs-material
mkdocs serve  # Preview at http://localhost:8000
```

**To generate/update a page**: Use `/doc-page <route>` for a single page, `/doc-batch <category>` for bulk generation, or `/doc-check` for staleness detection. Commands are defined in `.claude/commands/doc-*.md`; there is also a Codex skill at `.codex/skills/user-manual-maintainer/`.

---

### `/on-premise` - On-Premise Deployment (Internal)
- **[technical-design.md](on-premise/technical-design.md)**: Architecture decisions, feature flags, tenant resolution, error contract, behavioral differences
- **[operations-internals.md](on-premise/operations-internals.md)**: Distribution model, maintenance strategy, support policy

User-facing on-premise guides are in `/help/docs/en/on-premise/` (published to [doc.kanap.net](https://doc.kanap.net)).

### `/setup` - Development Environment
- **[dev-setup.md](setup/dev-setup.md)**: Local development setup (Docker, subdomain testing, environment variables)
- **[contributing.md](setup/contributing.md)**: Contribution process, code guidelines, documentation standards
- **[testing-strategy.md](setup/testing-strategy.md)**: Testing approach and QA criteria

### `/operations` - Deployment & Operations
- **[runbook.md](operations/runbook.md)**: Operational procedures, monitoring, incident response
- **[prod-deploy.md](operations/prod-deploy.md)**: Production deployment guide
- **[qa-deploy.md](operations/qa-deploy.md)**: QA environment deployment guide
- **[turnstile-setup.md](operations/turnstile-setup.md)**: Cloudflare Turnstile setup for public forms
- **[connection-pool-troubleshooting-guide.md](operations/connection-pool-troubleshooting-guide.md)**: Database connection pool troubleshooting

### `/features` - Feature Implementation Guides

**Patterns** (`features/patterns/`)
- **[workspace-patterns.md](features/patterns/workspace-patterns.md)**: ⭐ **Comprehensive workspace implementation guide** (RLS, tenant deletion, lifecycle, editor patterns)
- **[backend-patterns.md](features/patterns/backend-patterns.md)**: ⭐ **Backend patterns & abstractions** (BaseDeleteService, TenancyManager, service decomposition, DTOs)
- **[csv-import-export.md](features/patterns/csv-import-export.md)**: CSV workflows, validation, templates

**Workspaces** (`features/workspaces/`)
- **[spend-workspace.md](features/workspaces/spend-workspace.md)**: OPEX-specific workspace details
- **[contracts-workspace.md](features/workspaces/contracts-workspace.md)**: Contracts-specific workspace details
- **[applications-portfolio.md](features/workspaces/applications-portfolio.md)**: Applications & Services workspace implementation
- **[interfaces-specifications.md](features/workspaces/interfaces-specifications.md)**: Interfaces workspace specification
- **[connections-workspace.md](features/workspaces/connections-workspace.md)**: Infrastructure connections workspace
- **[locations-workspace.md](features/workspaces/locations-workspace.md)**: Locations workspace details
- **[portfolio-specification.md](features/workspaces/portfolio-specification.md)**: Portfolio management workspaces (requests, projects)
- **[spend-module-maintenance.md](features/workspaces/spend-module-maintenance.md)**: OPEX module maintenance and architecture

**Components** (`features/components/`)
- **[column-customization-guide.md](features/components/column-customization-guide.md)**: ServerDataGrid column chooser and persistence
- **[reporting-guidelines.md](features/components/reporting-guidelines.md)**: Report structure, charts, exports
- **[interface-map-visualization.md](features/components/interface-map-visualization.md)**: Interface Map D3 visualization
- **[connection-map.md](features/components/connection-map.md)**: Infrastructure Connection Map controls and behavior
- **[server-clusters.md](features/components/server-clusters.md)**: Server cluster management
- **[netbox-inventory.md](features/components/netbox-inventory.md)**: Netbox inventory sync: design rules, matching, review flow, traps
- **[dark-mode-implementation.md](features/components/dark-mode-implementation.md)**: Theme architecture, AG Grid integration, print/export normalization
- **[user-documentation-system.md](features/components/user-documentation-system.md)**: User documentation generation system

**Master Data** (`features/master-data/`)
- **[accounts-and-chart-of-accounts.md](features/master-data/accounts-and-chart-of-accounts.md)**: Accounts + CoA model, Platform Admin templates
- **[business-processes-master-data.md](features/master-data/business-processes-master-data.md)**: Business processes catalog
- **[currency-management.md](features/master-data/currency-management.md)**: Tenant currency settings, exchange rates
- **[it-ops-settings.md](features/master-data/it-ops-settings.md)**: IT Landscape settings and catalogs
- **[operations-dashboard.md](features/master-data/operations-dashboard.md)**: Operations dashboard specification

### `/database` - Database Documentation
- **[database-indexes.md](database/database-indexes.md)**: Performance indexes, monitoring, troubleshooting (consolidated guide with quick start)

### `/planning` - Product Planning & Vision
- **[product-vision.md](product-vision.md)**: Purpose, personas, outcomes, guiding principles
- **[v1-plan.md](v1-plan.md)**: V1 scope, timeline, implementation status, acceptance criteria (consolidated V1 spec + implementation plan)
- **[requirements.md](requirements.md)**: Functional requirements and constraints
- **[roadmap.md](roadmap.md)**: Near-term milestones and backlog themes
- **[evaluation.md](planning/evaluation.md)**: Quality criteria and metrics
- **[security.md](planning/security.md)**: Threat model, controls, authentication/authorization

### `/adr` - Architecture Decision Records
- **[README.md](adr/README.md)**: ADR index
- **[0000-template.md](adr/0000-template.md)**: ADR template
- **[0001-allocation-model-and-metrics.md](adr/0001-allocation-model-and-metrics.md)**: Allocation methods and company metrics
- **[0002-multitenancy-storage.md](adr/0002-multitenancy-storage.md)**: Single-DB multitenancy with RLS

### `/templates` - Development Templates
- **[frontend-page-checklist.md](templates/frontend-page-checklist.md)**: Checklist for new pages
- **[checkbox-set-filter-pattern.md](templates/checkbox-set-filter-pattern.md)**: Closed-choice checkbox filter pattern (AG Grid Community)
- **[status-column-filtering-pattern.md](templates/status-column-filtering-pattern.md)**: Default status filtering patterns
- **[status-scope-pattern.md](templates/status-scope-pattern.md)**: Status scope filtering pattern
- **[ui-forms.md](templates/ui-forms.md)**: UI form patterns and conventions

### `/samples` - CSV Templates
One consistent set of sample files, in the order the manual loads them. English conventions: `,` separator, `.` decimal, `YYYY-MM-DD` dates. Every file matches its importer's headers.
- Master data: `companies.csv`, `departments.csv`, `suppliers.csv`, `accounts.csv` (imported into a chart of accounts), `cost-centers.csv`, `users.csv`
- Budget files: `opex.csv`, `capex.csv`, in the budget file layout, with amounts for 2027

`companies.csv` carries metrics for 2025 to 2027: set the Year selector of the Companies list to 2026, or edit the three years in the header. The budget files carry `kanap_token` empty and `item_number` empty, so they add new lines. See [Load a budget from a spreadsheet](help/docs/en/budget-file.md).

### `/archive` - Historical Documentation
- **`archive/fixes/`**: Historical fix documentation (connection pool fix, RBAC multi-role fix, etc.)
- **`archive/implementation-steps/`**: Completed implementation step guides (01-20)
- **`archive/planning/completed-2025/`**: Completed implementation plans from 2025 (Entra SSO, IT Ops, Interfaces, Applications Portfolio, CoA, Locations, Files/S3, RBAC, Cloudflare, Marketing, Application Versions)

### `/user-manual` - (Deprecated)
Legacy location for user documentation. Content has been migrated to `/help/docs/en/`. This folder will be removed in a future cleanup.

---

## 🎯 Key Concepts

### Multi-Tenancy & Deployment Modes
- **Single-DB approach**: Shared PostgreSQL with Row-Level Security (RLS)
- **Tenant isolation**: `tenant_id` on all tables, RLS policies enforce per-request context
- **Per-request binding**: `TenantInitGuard` sets `app.current_tenant` from subdomain
- **Platform admin**: Separate host for tenant management (`PLATFORM_ADMIN_HOST`)
- **On-premise (single-tenant)**: `DEPLOYMENT_MODE=single-tenant` bypasses subdomain routing, disables billing/platform-admin, auto-provisions tenant on first boot

**See**: [architecture.md](architecture.md) (Multitenancy section), [on-premise/technical-design.md](on-premise/technical-design.md) (on-prem design), [features/patterns/workspace-patterns.md](features/patterns/workspace-patterns.md) (RLS requirements)

### Workspace Pattern
- **Route-driven editing**: `/module/items/:id/:tab` (not modals)
- **Explicit Save/Reset**: Dirty guards prevent data loss
- **Prev/Next navigation**: Preserves list context (sort, filters, search)
- **Deep linking**: Grid cells open specific tabs/years

**See**: [features/patterns/workspace-patterns.md](features/patterns/workspace-patterns.md) ⭐

### Lifecycle Management
- **`disabled_at` as source of truth**: Past date = disabled, NULL/future = enabled
- **Derived status**: Backend computes `status` enum from `disabled_at`
- **Historical queries**: Period-aware filtering includes items active during timeframe
- **Frontend**: `StatusLifecycleField` component handles toggle + date picker

**See**: [features/patterns/workspace-patterns.md](features/patterns/workspace-patterns.md) (Lifecycle Management section)

### Allocation Methods
Six allocation methods for cost distribution:
- **Auto**: `default`, `headcount`, `it_users`, `turnover` (computed from metrics)
- **Manual**: `manual_company`, `manual_department` (explicit percentages, auto-recalculated)

**See**: [adr/0001-allocation-model-and-metrics.md](adr/0001-allocation-model-and-metrics.md)

### Backend Patterns
Shared abstractions for consistency and maintainability:
- **BaseDeleteService**: Consolidated delete logic with cascade relations, storage cleanup, audit logging
- **TenancyManager**: Request-scoped tenant context and transaction management
- **Service Decomposition**: Large services split into focused sub-services using facade pattern
- **Type Safety**: Zod DTOs, typed decorators (`@Tenant()`), response types

**See**: [features/patterns/backend-patterns.md](features/patterns/backend-patterns.md) ⭐

### Frontend Patterns
Shared hooks and components for consistency:
- **useModuleItemNav**: Generic prev/next navigation inside a workspace, behind the module-specific `use*Nav` hooks
- **useVirtualRows**: Virtual scrolling for large lists
- **WorkspaceLayout**: Reusable workspace page layout with tabs
- **EnumEditor**: Generic settings editor with virtual scrolling

**See**: [frontend-architecture.md](frontend-architecture.md)

---

## 🔧 Common Tasks

### Implementing a New Workspace
1. Read [features/patterns/workspace-patterns.md](features/patterns/workspace-patterns.md) ⭐
2. Add `tenant_id` + RLS policies to tables
3. Update tenant deletion script (`admin-tenants.service.ts`)
4. Implement shell + editors following patterns
5. Run RLS self-test (`npm run test:rls`)
6. Run CSV smoke test if applicable

### Adding a New Table
1. Add `tenant_id uuid NOT NULL` column
2. Create RLS policies (USING + WITH CHECK)
3. Add composite indexes (`tenant_id` leading)
4. Update tenant deletion purge order
5. Use request-scoped EntityManager in services
6. Run RLS self-test

### Debugging Performance Issues
1. Check [database/database-indexes.md](database/database-indexes.md) for index guidance
2. See [operations/connection-pool-troubleshooting-guide.md](operations/connection-pool-troubleshooting-guide.md)
3. Check [operations/runbook.md](operations/runbook.md) for monitoring procedures

---

## 📖 Documentation Standards

- **Template**: Use [template.md](template.md) for new documents
- **Metadata**: Include Purpose, Audience, Status (draft/current/archived/deprecated), Owner, Last Updated
- **Related Documentation**: Add links to related docs at the top of each document
- **Cross-References**: Use `**See:** [doc-name.md](path/to/doc.md)` instead of duplicating content
- **Conciseness**: Keep docs focused; link to authoritative sources for details
- **Diagrams**: Prefer diagrams-as-code (Mermaid) embedded in Markdown
- **Code references**: Use `file_path:line_number` pattern for linking to code

### Documentation Governance

- **Quarterly Review**: Review `/planning/` directory each quarter for completed implementation plans to archive
- **Archive Location**: Completed plans go to `/archive/planning/completed-YYYY/`
- **Status Updates**: Mark implementation plans as "Status: IMPLEMENTED (YYYY-MM-DD)" when complete
- **Avoid Duplication**: Maintain single source of truth; use cross-references instead of copying content
- **Link Maintenance**: When moving files, update all cross-references in README.md and related docs

---

## 🏷️ Current Status (Summary)

### Implemented Features
✅ Multi-tenancy (RLS, tenant provisioning, subdomain routing)
✅ OPEX & CAPEX modules (workspaces, budgets, allocations, tasks)
✅ Contracts (CRUD, OPEX linking, attachments, tasks)
✅ Master data (companies, departments, suppliers, accounts, analytics, contacts)
✅ Reporting (Top 10, Delta, Budget Trend (OPEX/CAPEX), Budget Column Comparison, Consolidation, Chargeback)
✅ RBAC (roles, permissions)
✅ Budget Operations (freeze, copy columns, copy allocations, reset)
✅ Platform Admin (tenant management, freeze/delete, plan updates)
✅ CSV import/export (all entities)
✅ Lifecycle management (`disabled_at` source of truth)
✅ Connection pool optimization
✅ Database indexes (90-95% performance improvement)
✅ Email notifications (event-driven + scheduled weekly review digest)
✅ User settings (profile editing, notification preferences)
✅ Rate limiting (app-level throttling on auth and public endpoints)
✅ On-premise deployment (single-tenant mode, feature flags, first-boot provisioning, CI matrix)

### In Progress
None - V1+ features complete

### Planned
See [planning/roadmap.md](roadmap.md)

---

## 🔗 External Links

- **Repository**: (Add your Git repo URL)
- **Issue Tracker**: (Add your issue tracker URL)
- **CI/CD**: (Add your CI/CD dashboard URL)
- **QA Environment**: `qa.kanap.net`
- **Production**: `kanap.net`

---

## 📞 Support & Questions

- **Architecture questions**: See [architecture.md](architecture.md) or [features/patterns/workspace-patterns.md](features/patterns/workspace-patterns.md)
- **Backend patterns**: See [features/patterns/backend-patterns.md](features/patterns/backend-patterns.md)
- **Setup issues**: See [setup/dev-setup.md](setup/dev-setup.md)
- **Operational issues**: See [operations/runbook.md](operations/runbook.md) or [operations/connection-pool-troubleshooting-guide.md](operations/connection-pool-troubleshooting-guide.md)
- **Feature guidance**: Check relevant file in `/features` subdirectories (patterns, workspaces, components, master-data)

---

## 📝 Document Conventions

- **Relative links**: Use relative paths for internal docs (e.g., `[file](setup/dev-setup.md)`)
- **Code blocks**: Use appropriate language tags for syntax highlighting
- **Callouts**: Use emoji prefixes for emphasis (⚠️ Warning, ✅ Complete, ⭐ Important)
- **Sections**: Use `---` for horizontal separators between major sections
- **Tables**: Use tables for structured data (checklists, comparisons, status)

---

**Last Updated**: 2026-02-15
**Document Owner**: Engineering Team
