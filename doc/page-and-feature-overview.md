# Page & Platform Feature Overview

 _Last updated: 2026-06-13_

This document summarizes the current tenant-facing and platform-facing page structure alongside the backend features that support multi-tenancy, permissions, and tenant lifecycle operations.

## Frontend Page Map

| Route | Component | Purpose & Key Interactions | Permissions Surface |
| --- | --- | --- | --- |
| `/` | `frontend/src/pages/DashboardPage.tsx` | Budget Management Dashboard: visual tiles for OPEX/CAPEX snapshot tables (Y-1/Y/Y+1, dynamic columns), My Tasks (assigned to me), Next Contract Renewals, Data Hygiene (owners/paying company/CoA mismatches), Quick Actions (New OPEX/CAPEX + recent updates), and Insights (Top OPEX Y, Top increases). Values rounded to thousands with “k”. | Read-only for all authenticated users; actions gated by resource (`opex`/`capex` manager). |
| `/ops/opex` | `frontend/src/pages/OpexListPage.tsx` | Primary OPEX grid with infinite scroll (`ServerDataGrid`). Row interactions deep-link into the spend workspace (`/ops/opex/:id/:tab`) covering overview, budget, allocations, tasks, and relations with explicit save/reset. | Requires `reader` on `opex`; write actions gated server-side by `RequireLevel`. |
| `/ops/capex` | `frontend/src/pages/CapexPage.tsx` | CAPEX grid mirroring the OPEX workspace. Rows open `/ops/capex/:id/:tab` with tabs: overview, budget, allocations, tasks, relations. The grid has an optional “Task” column deep-linking to the Tasks tab. | `capex` |
| `/ops/projects` | `frontend/src/pages/ProjectsPage.tsx` | Projects list with create/edit modal; links to spend. | `projects` |
| `/ops/contracts` | `frontend/src/pages/ContractsPage.tsx` | Contract registry. Inline actions for attachments, tasks, and spend linking. | `contracts` |
| `/portfolio/tasks` | `frontend/src/pages/TasksPage.tsx` | Task management grid with ServerDataGrid. Shows all tasks across standalone, OPEX, Contracts, CAPEX, and Projects with advanced filtering, quick search, status tracking (`open`, `in_progress`, `pending`, `in_testing`, `done`, `cancelled`), and assignee management. Default filter shows active statuses and hides closed statuses by default. Scope filter (My/Team/All) persisted per user via `useGridScopePreference`. | Requires `reader` on `tasks`; auto-granted when any operations resource (opex, capex, projects, contracts) has access |
| `/ops/operations` | `frontend/src/pages/operations/BudgetOperationsLandingPage.tsx` | Budget operations landing page with cards linking to freeze, column initialization, allocation copy, and column reset tools. | Requires `opex:reader` (landing) |
| `/ops/operations/freeze` | `frontend/src/pages/operations/BudgetFreezePage.tsx` | Freeze / Unfreeze Data tool for budget scopes (OPEX, CAPEX). Supports per-column locking, status cards, and requires admin confirmation. | `budget_ops:admin` |
| `/ops/operations/copy-budget-columns` (alias: `/ops/operations/column-init`) | `frontend/src/pages/operations/CopyBudgetColumnsPage.tsx` | Copy Budget Columns tool for copying budget data between years and columns with percentage adjustments, overwrite control, and dry run preview. Shows complete data preview with skip indicators and preserves source data integrity. | Requires `opex:admin` for execution |
| `/ops/operations/copy-allocations` | `frontend/src/pages/operations/CopyAllocationsPage.tsx` | Copy Allocations tool to clone allocation methods (and manual splits when present) between years with dry run previews, overwrite toggle, and CSV export. Auto/default methods recompute shares using the destination year’s metrics. | Requires `opex:admin` for execution |
| `/ops/operations/column-reset` | `frontend/src/pages/operations/BudgetColumnResetPage.tsx` | Reset Budget Column tool for permanently clearing all data from a specific budget column for a given year. Shows AG Grid preview with items highlighted in red, requires confirmation dialog, and sets values to NULL. | Requires `opex:admin` for execution |
| `/ops/reports/*` | `frontend/src/pages/reports/*.tsx` | Prebuilt analytics (Top OPEX, Delta, Budget Trend (OPEX/CAPEX), Budget Column Comparison, Consolidation, Chargeback) rendered from `/reports/*` endpoints. | `reporting` |
| `/ops/reports/chargeback/global` | `frontend/src/pages/reports/GlobalChargebackReport.tsx` | Global chargeback workspace (year + metric selectors, section toggles) with company totals + chart and a grouped company/department grid that surfaces headcount & cost-per-user subtotals. Backed by `GET /reports/chargeback/global`. | `reporting` |
| `/ops/reports/chargeback/company` | `frontend/src/pages/reports/CompanyChargebackReport.tsx` | Company chargeback drilldown with company/year/metric selectors, department totals + chart, itemised allocations, and KPIs sourced from `GET /reports/chargeback/company`. | `reporting` |
| `/it/locations` | `frontend/src/pages/it/LocationsPage.tsx` | IT Landscape: Locations grid (ServerDataGrid) with columns for code, name, hosting type (labelled via Hosting Types list), Provider/Company (auto-switches based on hosting category), country, city, assets count, created. Quick search + AG filters persist via query params so the workspace can round-trip back to the same list context. | `locations` (`reader` to view grid) |
| `/it/locations/:id/:tab` | `frontend/src/pages/it/LocationWorkspacePage.tsx` | Locations workspace with tabs: Overview (code, hosting type, operating company + auto-fill for country/city, provider/region/additional info, country/city), Contacts & Support (internal users, external contacts, relevant websites) and Relations (assets + derived application list with deep links). Save/Reset honor dirty state; create flow lives at `/it/locations/new/overview`. | `locations` (`manager` to edit/attach contacts; `reader` read-only) |
| `/it/assets` | `frontend/src/pages/it/AssetsPage.tsx` | Infrastructure inventory (servers, VMs, containers, cloud instances, network devices) used by App Instances. `ServerDataGrid` with filters for environment, kind, provider, **cluster**, status; shows derived assignment counts and links to `/it/assets/:id/:tab`. Admins can multi-select and delete assets; deletion is blocked (with a clear message listing related items) when the asset still has app assignments or any connections. Asset workspace has **Overview / Technical / Assignments / Connections** tabs: Overview handles name/type/location + lifecycle; Technical holds environment, operating system, **network segment**, hostname, IP, and the editable **Cluster** field (with suggestions + inline cluster members mini-table); Assignments tab supports add/edit/remove; Connections tab lists all connections involving the asset with deep links to the Connections workspace. | `applications` (`reader` list/detail, `manager` mutates) |
| `/it/connections` | `frontend/src/pages/it/ConnectionsPage.tsx` | IT Landscape: Connections grid for documenting infrastructure-level connectivity. Columns for Connection ID, topology (Asset to Asset / Multi-asset), source/destination (asset or entity), protocols (from IT Ops Connection Types), lifecycle, assets count, **criticality**, **data class**, **PII**, created. Workspace: Overview tab (ID, name, purpose, topology-specific participants with consolidated entity/asset pickers, protocols, lifecycle, notes), **Layers** tab (up to 3 ordered legs with per-leg endpoints, multi-select protocols, port overrides auto-filled from protocol defaults, notes), **Criticality & Compliance** tab, and **Related Interfaces** tab listing linked interface bindings (env/leg, endpoints, lifecycle) with deep links to Interface Environments and Connection Map. | `applications` (`reader` list/detail, `manager` mutates, `admin` bulk delete) |
| `/it/connection-map` | `frontend/src/pages/it/ConnectionMapPage.tsx` | Infra connection map (D3 force layout) showing assets/entities as nodes and connections as edges. Filters: environment, lifecycle; toggles for multi-server visibility, connection layers, and **Role-based placement**. Role-based placement uses IT Ops Settings tiers (`serverRoles.graph_tier`, `entities.graph_tier`) to guide nodes into top/upper/center/lower/bottom Y bands (with environment-scoped role derivation). Controls: freeze/unfreeze simulation, auto-center, zoom. Side panel shows node/connection details, linked Interfaces (via `/connections/:id/interface-links`) with deep links to Interface workspaces and Interface Map (`focusInterfaceId`), and deep links to Assets/Connections. The page reads and updates `environment`, `lifecycles`, and optional `focusConnectionId` from the URL for shareable deep links. | `applications:reader` |
| `/it/interface-map` | `frontend/src/pages/it/InterfaceMapPage.tsx` | Interface Map (D3 force layout) showing applications as nodes and Interfaces as edges. Business view hides middleware; Technical view shows middleware and leg-level routes. Controls: environment and lifecycle filters, middleware toggle, freeze/auto-center/zoom. Side panel shows app/interface details, environment-specific endpoints, linked infra connections (via `/interfaces/:id/connection-links`) with deep links to Connection workspaces and Connection Map (`focusConnectionId`). The page reads and updates `environment`, `lifecycles`, and optional `focusInterfaceId` from the URL for shareable deep links. | `applications:reader` |
| `/it/applications` | `frontend/src/pages/it/ApplicationsPage.tsx` | IT Landscape: **Apps & Services** grid. Default lifecycle filter hides Retired (but Retired remains selectable). Closed-set columns use checkbox-set filters (Category, Environments, Lifecycle, Criticality, Hosting, External Facing, SSO, MFA, Data Class, Contains PII) with scoped values; Environments reflect **active** instances (matching the chips), Hosting is derived from server locations, and Data Class can be blank. Columns include environment chips, suite/component counts, owners, compliance fields, counts, vendor data, and the catalog type badge. Scope filter (My/Team/All) persisted per user via `useGridScopePreference`. Actions: New App/Service, Import CSV, Export CSV, Copy item, Delete Selected. Column chooser toggles include flags (instances/structure/counts/etc.), letting the UI request the necessary expansions lazily. | `applications` (`reader` for list; `manager` to create/update/delete) |
| `/it/applications/:id/:tab` | `frontend/src/pages/it/ApplicationWorkspacePage.tsx` | Apps & Services workspace tabs: Overview (logical fields + the new Type selector and suite toggle), **Instances** (per-environment grid + dialog, bulk apply, copy from Prod), **Servers** (per-instance assignments with add/edit/remove actions and deep links), **Interfaces** (environment-grouped mini-table of related interfaces where the app is source/target/middleware; columns: name, source app, target app, via middleware, with deep links to the Interface workspace), Ownership & Audience, Technical (DR/external-facing/ETL), Relations (Suites/Components + links/attachments), Compliance (PII + residency). Unsaved changes prompt before navigation; Instances/Servers persist immediately and refresh the parent view. | `applications` (`reader` to view; `manager` to edit; attachment upload constrained by same resource) |
| `/it/interfaces` | `frontend/src/pages/it/InterfacesPage.tsx` | Logical integration registry. Grid columns (default): Interface ID, Name, Environments (chips for envs with bindings), Source App, Target App, Lifecycle, Criticality, Created. Additional columns (available via chooser, hidden by default): Business Process, Data Category, Contains PII, Env Coverage (# environments with at least one binding), Bindings Count. Column filters (with inline clear buttons) map to backend query parameters; the Environments filter applies a contains-style match against `interface_bindings.environment`. Actions: Add Interface and bulk delete (admin only); rows open the workspace. | `applications` (`reader` list/detail; `manager` mutates) |
| `/it/interfaces/:id/:tab` | `frontend/src/pages/it/InterfaceWorkspacePage.tsx` | Interfaces workspace aligned with the revamp spec, with tabs: Overview (ID, business process, purpose, route type, lifecycle, criticality), Ownership (business/IT owners, impacted companies), Functional (business objects, use cases, key identifiers, dependencies, functional docs), Technical (leg template editor plus technical docs/attachments), Environments (user-managed environments with per-environment, per-leg bindings between App Instances), and Compliance (data class, PII, typical data, residency, audit/security notes). Unsaved scalar/relations changes prompt before navigation; bindings are managed via dedicated API calls and refreshed in place. | `applications` |
| `/it/settings` | `frontend/src/pages/it/ItOperationsSettingsPage.tsx` | IT Landscape Settings page for configuring tenant-wide lists. Includes collapsible sections, Operating Systems catalog (name + standard/extended support dates), and tier-aware editors for **Entities** and **Server Roles** with `Graph tier` (`top|upper|center|lower|bottom`) used by Connection Map role-based placement. Other lists: Data Classes, Asset Types, Hosting Types (on-prem/cloud category), Cloud Providers, Lifecycle, and Interface enums. | `settings` (`reader` to view, `admin` to edit) |
| `/agents` | `frontend/src/pages/agents/AgentsOverviewPage.tsx` | AI Agents fleet overview: one card per agent (name, type, plain-language status, pending-approvals count, today's activity/spend vs cap, error indicator, earned-autonomy summary), tenant-wide emergency pause, and a “New agent” dialog. Top-level “AI Agents” nav group (not under Admin). `/admin/agent-control` redirects here. | `ai_agents` (`reader` to view; gated by `features.aiSettings` + instance AI capability; `ai_settings:admin` implies `ai_agents:admin`) |
| `/agents/approvals` | `frontend/src/pages/agents/AgentsApprovalsPage.tsx` | Cross-agent approvals inbox (technician daily surface): one row per ticket with proposal cards (reply / internal note / ticket updates), evidence summary, ticket context, approve / reject / approve-all, agent filter chips, history toggle, and a pending-count badge. Action classes running in automatic mode appear in Activity, not here. | `ai_agents` (`reader`) |
| `/agents/activity` | `frontend/src/pages/agents/AgentsActivityPage.tsx` | Read-only agent activity timeline (proposals, decisions, executions, configuration changes, pauses, errors) filterable by agent / date / ticket ref / type / actor / status, with one-click technical-trace drill-down (tool executions, evidence, JSON, hashes). | `ai_agents` (`reader`) |
| `/agents/:agentKey` | `frontend/src/pages/agents/AgentWorkspacePage.tsx` | Per-agent workspace; tab via `?tab=`: **Monitor** (default — status, pause/resume, “Check for new tickets now”, watching health, queue snapshot, today's limits, recent activity, “Test on a ticket”), **Performance** (acceptance/latency/KB-hit/cost KPIs, trend charts, rejection breakdown, per-action-class acceptance, autonomy ladder), **Approvals** (the inbox filtered to this agent), **Settings** (admin-only — identity & persona, connection, watching scope, pace, spending limits, capabilities, autonomy, approval defaults, and **Knowledge and web sources**: search KANAP knowledge on/off, library scope (all or a chosen set, intersected with the configuring admin's accessible libraries), and search the web on/off — web requires a configured provider and is disabled with a “not available on this platform” hint otherwise; on conflict KANAP knowledge always wins and web is only used to fill gaps and is always cited). | `ai_agents` (`reader` to view Monitor/Performance/Approvals; Settings tab requires `ai_agents:admin`) |
 
## Platform Admin Additions

Pages
- `/admin/coa-templates` → `frontend/src/pages/admin/AdminCoaTemplatesPage.tsx`
  - Manage template metadata (code, name, version, scope)
  - Scope:
    - Country template → requires `country_iso` (2‑letter)
    - Global template → `is_global=true` (no country); appears as “ALL” in UI
  - “Loaded by default” (global templates only): at most one global template can be marked; it is auto‑applied on tenant provisioning
  - CSV: export/import with preflight via `/admin/coa-templates/:id/(export|import)`
- `/admin/standard-accounts` → `frontend/src/pages/admin/AdminStandardAccountsPage.tsx`
  - Select a CoA Template (scope shown as ALL or country) and manage its “standard accounts” (CSV‑backed)
  - Grid actions: New, Import (preflight + load), Export, Delete Selected (bulk)
- `/admin/standard-accounts/:templateId/:id/:tab?` → `frontend/src/pages/admin/AdminStandardAccountWorkspacePage.tsx`
  - Workspace to create/edit a standard account; prev/next across the current filtered/sorted list

- `/admin/ops-dashboard` → `frontend/src/pages/admin/OpsDashboardPage.tsx`
  - Platform-admin-only ops monitoring (multi-tenant cloud only, gated by `MultiTenantOnlyGuard`)
  - Backend: Express middleware (`request-metrics.middleware.ts`) captures every request's timing + status before tenancy pipeline; in-memory store (`ops-metrics.store.ts`) retains 15 minutes of samples; DB metrics service (`db-metrics.service.ts`) queries `pg_stat_activity` and `pg_stat_database` with 10s cache
  - Single endpoint: `GET /admin/ops/snapshot` returns traffic windows (1m/5m/15m), auth stats, top-30 route latencies (P50/P95/P99), recent errors (top-15), DB pool/activity stats, and Node.js process metrics (memory, event loop lag, CPU, uptime)
  - Frontend polls every 15s with `refetchIntervalInBackground: false`; threshold coloring on key cards (5xx, 429, pool utilization, event loop lag)

Behavior
- Standard accounts operate exclusively on the template CSV payload; they do not touch tenant data.
- Tenant CoAs can load from a template via `/chart-of-accounts/:id/load-template` (supports preflight), creating/updating tenant `accounts` scoped to the target CoA.
- During tenant provisioning, the single global template marked “Loaded by default” is copied into the new tenant as a `GLOBAL`‑scoped CoA and set as the tenant’s Global Default CoA.
| `/settings` | `frontend/src/pages/settings/SettingsPage.tsx` | User settings hub. Tabs: Profile (edit name, job title, phone) and Notifications (per-workspace email toggles, weekly review config). URL-driven tabs via `:tab` param (`/settings/profile`, `/settings/notifications`). | Any authenticated user |
| `/settings/:tab` | `frontend/src/pages/settings/SettingsPage.tsx` | Deep-link to a specific settings tab (profile or notifications). Email footer links point to `/settings/notifications`. | Any authenticated user |
| `/admin` | `frontend/src/pages/admin/AdminLanding.tsx` | Quick links to master data, billing, roles. Switchboard for admins. | Any admin-level access; available once `companies` reader allowed. |
| `/admin/audit-logs` | `frontend/src/pages/admin/AuditLogsPage.tsx` | Read-only audit viewer with quick search, date filter, set filters (`table_name`, `action`, `source`), and explicit pagination (100 rows/page). Row click opens a detail dialog with metadata plus side-by-side before/after JSON and changed-field chips. | `users:admin` |
| `/admin/master-data` | `frontend/src/pages/admin/MasterDataOperationsPage.tsx` | Master Data Operations landing page with cards for freeze/unfreeze and copy workflows. | `companies` or `departments` reader |
| `/master-data/business-processes` | `frontend/src/pages/BusinessProcessesPage.tsx` | Business Processes master data grid: seeded ISO 9001-style core processes (O2C, P2P, H2R, etc.) with categories, Process Owner / IT Owner, CSV import/export, and a workspace for editing. | `business_processes` (`reader` for view, `manager` for edit, `admin` for CSV + delete) |
| `/admin/master-data/freeze` | `frontend/src/pages/admin/master-data/MasterDataFreezePage.tsx` | Freeze / Unfreeze Data tool for company and department metrics with per-resource permission checks. | `companies:admin` and/or `departments:admin` (budget ops admin also allowed) |
| `/admin/master-data/copy` | `frontend/src/pages/admin/master-data/MasterDataCopyPage.tsx` | Copy wizard for master data metrics (companies, departments) with dry run preview, skip reasons, and transactional copy. | `companies:admin` and/or `departments:admin` (budget ops admin also allowed) |
| `/master-data/companies` | `frontend/src/pages/CompaniesPage.tsx` | Master data grid that deep-links into the Companies workspace (`/master-data/companies/:id/:tab`). Overview tab edits general details (Name, Country, Address 1/2, Postal Code, City, State, Registration/VAT, Base Currency, Enabled/Disabled_at, Notes) with searchable ISO dropdowns; Details tab manages yearly metrics with year tabs, freeze awareness, and prev/next navigation across companies. CSV import/export, quick search, and numeric filters stay available on the grid. | `companies` |
| `/master-data/departments` | `frontend/src/pages/DepartmentsPage.tsx` | Department management with nested metrics. Quick search spans name, description, company, and derived headcount; column filters available for company name and yearly headcount. | `departments` |
| `/admin/suppliers` | `frontend/src/pages/SuppliersPage.tsx` | Supplier CRUD, CSV I/O. | `suppliers` |
| `/master-data/coa` | `frontend/src/pages/coa/CoaPage.tsx` + `frontend/src/pages/accounts/AccountWorkspacePage.tsx` | Merged CoA-centric page: chip-based CoA selection, CoA-scoped accounts grid, CoA manage modal, and account workspace deep links. Legacy `/master-data/accounts` redirects here. | `accounts` |
| `/master-data/working-day-calendars` | `frontend/src/pages/WorkingDayCalendarsPage.tsx` + `frontend/src/pages/working-day-calendars/WorkingDayCalendarWorkspacePage.tsx` | Working-day calendars (Master data > Finance): list (Code, Name, Years, Status, Updated) with quick search, status scope, CSV import/export (one row per calendar and year) and bulk delete; workspace (`/master-data/working-day-calendars/:id/overview`, create at `/new/overview`) with autosave, usage line, year tabs, twelve monthly working days (up to 6 decimals, at most the month's calendar days), yearly total, copy from the previous year and remove a year. Used by budget columns computed per day. Delete refused while a budget line uses the calendar. | `working_day_profiles` (`reader` view, `member` create/edit, `admin` CSV + delete); list and detail API also open to `opex` / `capex` readers for the compute panel |
| `/admin/analytics` | `frontend/src/pages/AnalyticsCategoriesPage.tsx` | Manage analytics categories (name, description, status). | `analytics` |
| `/admin/users` | `frontend/src/pages/UsersPage.tsx` | User provisioning with bulk Invite/Delete actions in the header, Entra-synced profile fields (first/last name, job title, business/mobile phones), search + column chooser (Job Title shown by default), and status scope toggle (All/Enabled/Disabled). Status edits live in the user modal. | `users` |
| `/admin/roles` | `frontend/src/pages/admin/RolesPage.tsx` | RBAC editor for page-level permissions. | `users` (aliased in guard). |
| `/admin/billing` | `frontend/src/pages/admin/BillingCenter.tsx` | Subscription summary, seat usage, plan updates. | `billing` |
| `/admin/auth` | `frontend/src/pages/admin/AdminAuthPage.tsx` | Tenant SSO settings: shows current Microsoft Entra connection, “Connect/Reconnect Microsoft Entra” (calls `POST /auth/entra/setup/start`), and “Test Microsoft sign-in” (hits `/auth/entra/login?redirectTo=/admin/auth`). | `users` (admin level) |
| `/admin/branding` | `frontend/src/pages/admin/AdminBrandingPage.tsx` | Tenant branding workspace: logo upload/removal (with dark-mode visibility toggle), light/dark primary color inputs, color picker + presets, contrast warning, dirty-state save/discard, and one-click reset to defaults. Uses `/admin/branding/*` endpoints and refreshes tenant context without full page reload. Blocked on platform host. | `users` (admin level, tenant host only) |
| `/admin/tenants` | `frontend/src/pages/admin/AdminTenantsPage.tsx` | Platform host console: tenant list, freeze/unfreeze, plan updates (status and trial end included), mark as internal tenant, synchronous deletion. | Platform admin only (host guard). |
| `/admin/ops-dashboard` | `frontend/src/pages/admin/OpsDashboardPage.tsx` | Ops monitoring dashboard: API traffic counters (1m/5m/15m windows), rate-limit (429) and auth pressure, DB connection/pool stats (pg_stat_activity + TypeORM pool), Node.js process metrics (memory, event loop lag, CPU), endpoint latency table (P50/P95/P99 by route group), and recent errors list. Polls every 15s, pauses when tab hidden. Backend: `GET /admin/ops/snapshot` aggregates in-memory request metrics store + cached DB snapshot (10s TTL). Multi-tenant only (cloud). | Platform admin only (host guard + `MultiTenantOnlyGuard`). |

### Public/Auth Pages
- `/login` (public) surfaces both the email/password form and a **Sign in with Microsoft** CTA on tenant hosts. When redirected back with `?sessionExpired=true`, it shows “Your session has expired. Please sign in again.” once, and clears that state on a new sign-in attempt.
- `/login/callback` (public) reads either an Entra handoff (`#handoff=...`) or the legacy token payload from the URL fragment. Handoff callbacks are redeemed through `/auth/entra/session` on the tenant host so the backend can set the `HttpOnly` refresh cookie before `AuthContext.login(...)` navigates with history replacement. If the payload is missing or invalid it redirects back to `/login` with error state.

Supporting infrastructure:
- `frontend/src/components/Layout.tsx` drives the Budget Management/Admin workspace toggle, left navigation, and permission-aware menu (`hasLevel`).
- `frontend/src/components/ProtectedRoute.tsx` enforces minimum `reader` level per resource and redirects to `/403` when the JWT claims lack access.
- `frontend/src/tenant/TenantContext.tsx` resolves host context, exposes tenant branding (`logoUrl`, `useLogoInDark`, `primaryColorLight`, `primaryColorDark`), and redirects unknown tenants back to marketing.
- `frontend/src/config/ThemeContext.tsx` consumes tenant branding colors and applies mode-aware primary color overrides (`light`/`dark`) in `createAppTheme(...)`.

## OPEX Experience Highlights

The OPEX workspace (`frontend/src/pages/OpexListPage.tsx`) bundles the spend lifecycle:
- Server-driven AG Grid (`ServerDataGrid`) over `/spend-items/summary` with persistent column state, column chooser, and pinned totals.
- Spend workspace: list clicks route to `/ops/opex/:id/:tab` (overview, budget, allocations, tasks, relations) with explicit save/reset and prev/next navigation embedded in the workspace instead of layered modals.
- Allocations editor mirrors budget navigation (year tabs + prev/next arrows with unsaved-change guard) and always recomputes manual company/department rows using the latest per-year metrics; manual department mode seeds one row per company on first entry for quicker editing.
- Tasks panel includes optional title field, responsible person dropdown (UserSelect), status tracking (`open`, `in_progress`, `pending`, `in_testing`, `done`, `cancelled`), and due date management.
- Analytics column surfaces the admin-defined category; the workspace overview uses `AnalyticsCategorySelect` tied to `/analytics-categories`.
- Column renderers resolve owners via cached `/users` lookups and surface quick links to contracts/projects.
- Grids default to showing records active as of today (derived from `disabled_at`). Editors expose a `StatusLifecycleField` with an Enabled toggle and a Disabled Date; the date controls the actual lifecycle.

## Task Management

The Task Management system (frontend `TasksPage` + workspace and backend `TasksService`) provides cross-platform task tracking:
- Frontend list: ServerDataGrid-based interface at `/portfolio/tasks` with cross-context columns (Project/OPEX/Contract/CAPEX/Standalone), status, assignee, score, phase, due date, and description. Cells are clickable and open the task workspace.
- Workspace UX: Clicking a row opens `/portfolio/tasks/:id/overview`. Creation uses `/portfolio/tasks/new/overview`. The workspace has explicit Save controls, Prev/Next navigation based on current list context (sort, filters, search, scope), and a Close action that returns to the list with the same query state.
- Related context editing: In writable mode, the Context section exposes a selector (`Standalone`, `Project`, `Budget (OPEX)`, `Contract`, `CAPEX`) plus entity picker when applicable. Changes are applied only on Save.
- Save model: context changes and field edits persist atomically in one PATCH call (no split move-then-update flow).
- Filtering & search: Default filter shows active tasks (`open`, `in_progress`, `pending`, `in_testing`); supports quick search across all fields and column-specific filtering via AG Grid floating filters.
- Status workflow: Six states (`open`, `in_progress`, `pending`, `in_testing`, `done`, `cancelled`) with color-coded status chips.
- Activity workflow: Comments tab includes a unified action form where comment, status change, and optional time logging can be submitted in one action (`type: 'unified'`).
- Change-history workflow: standard task saves (`PATCH /tasks/:id` and `PATCH /portfolio/projects/:projectId/tasks/:taskId`) also auto-write `type='change'` activity rows using shared backend diff detection (beyond unified form status/time entries).
- History snapshots: `changed_fields` stores historical old/new values at write time, with FK display names resolved before persistence where possible (for example assignee/user or classification names).
- Live updates: task write paths invalidate `task-activities` cache (`save`, `unified activity`, and task time-entry mutations), so the History tab updates without full page reload.
- History comment preview: history cards render one-line plain-text previews (HTML stripped) by design; full rich text remains in the Comments tab.
- Selection & deletion: Admins can multi-select rows and use “Delete Selected,” which calls `DELETE /tasks/bulk`. Success clears selection and refreshes the grid.
- Backend APIs:
  - Aggregated list: `GET /tasks` (reader), mirrors grid filters/sort with pagination.
  - Navigation: `GET /tasks/ids` (reader) returns ordered ids for Prev/Next.
  - Single task: `GET /tasks/:id` (reader) returns a task with `related_object_name` and `assignee_name`.
  - Generic update route: `PATCH /tasks/:id` (`tasks:member`) supports field updates and context targets `standalone|spend_item|contract|capex_item`.
  - Project-target update route: `PATCH /portfolio/projects/:projectId/tasks/:taskId` (`portfolio_projects:contributor`) is required for any save where the target context is project.
  - Move convenience: `PATCH /tasks/:id/move` (`tasks:member`) supports context-only changes for `standalone|spend_item|contract|capex_item`.
  - Activities: `GET/POST /tasks/:id/activities` and `GET/POST /portfolio/projects/:projectId/tasks/:taskId/activities`; POST supports standard comment/change payloads and unified payloads (`type: 'unified'`).
  - Activity comment editing: `PATCH /tasks/:id/activities/:activityId` and `PATCH /portfolio/projects/:projectId/tasks/:taskId/activities/:activityId`.
  - Time entries: `GET/POST/PATCH/DELETE` task time-entry routes exist for both standalone and project-task paths.
  - Bulk delete: `DELETE /tasks/bulk` (admin) returns `{ deleted: string[]; failed: { id, name, reason }[] }`.
  - Object-scoped create/update: `POST/PATCH /spend-items/:id/tasks`, `/contracts/:id/tasks`, and `/capex-items/:id/tasks` (`tasks:member`) remain available.
- Permissions: `tasks:reader` shows all tasks in the tenant (auto-granted when any operations resource has access). `tasks:member` allows create/edit/move for non-project contexts. Project-target saves require `portfolio_projects:contributor`. `tasks:admin` is required for bulk delete.
- Multi-tenant model: The unified `tasks` table includes `tenant_id` with enforced RLS.
- Schema: `tasks` fields include id, tenant_id, title (NOT NULL), description (nullable HTML), status, priority_level, start_date, due_date, assignee_user_id, creator_id, related_object_type (`'project'|'spend_item'|'contract'|'capex_item'`), related_object_id, phase_id (project tasks only), source_id, category_id, stream_id, company_id (classification — editable for standalone and project tasks; for project tasks defaults from parent project at creation, can be overridden independently), labels (JSONB), viewer_ids (JSONB), created_at, updated_at.
- Create mode: Full workspace at `/portfolio/tasks/new/overview` with context selector. `Standalone` is valid (and default), or users can select Project/OPEX/Contract/CAPEX + item.
- Project task creation: From Projects workspace (Tasks tab or Timeline "Add Task" button), navigation redirects to `/portfolio/tasks/new/overview?projectId=...&phaseId=...` to pre-fill the relation.
- **Send link**: A "Send link" button in the workspace header (to the left of prev/next arrows) lets any reader quickly email a link to the current task. The dialog (`ShareDialog`) supports selecting existing platform users and/or typing arbitrary email addresses (freeSolo Autocomplete), with an optional personal message and a copy-link shortcut. Backend: `POST /tasks/:id/share` (reader permission).

## Portfolio Management

The Portfolio Management module (`/portfolio/*`) provides end-to-end IT portfolio lifecycle management:

### Requests (`/portfolio/requests`)
- Grid: `frontend/src/pages/portfolio/RequestsPage.tsx` with status, type, category filters. Scope filter (My/Team/All) persisted per user via `useGridScopePreference`.
- Workspace: `frontend/src/pages/portfolio/RequestWorkspacePage.tsx`
  - **Send link**: Button in header (left of prev/next arrows) opens `ShareDialog` to email a link to the request. Supports platform users and arbitrary email addresses. Backend: `POST /portfolio/requests/:id/share` (reader permission).
  - Tabs: Overview, Activity, Analysis, Scoring, Team, Relations
  - Overview rich text field: `purpose` (RichTextEditor)
  - Analysis tab: impacted business processes, feasibility review matrix (`feasibility_review` JSONB), `risks` rich text (labeled "Risks & Mitigations"), and recommendation panel
  - Feasibility matrix dimensions: technical feasibility, security & compliance, infrastructure needs, resource & skills, delivery constraints, change management
  - Feasibility statuses per dimension: not_assessed, no_concerns, minor_concerns, major_concerns, blocker (with row accent + select outline color coding)
  - Dimension comments support inline multiline notes and optional expanded "Detailed notes"
  - Analysis recommendation is submitted as a formal decision in Activity with context `Analysis Recommendation`, and the Analysis tab shows a latest-recommendation summary card with "View in Activity"
  - Legacy `current_situation` / `expected_benefits` are shown read-only in a collapsed "Previous Analysis" accordion when historical data exists
  - Activity tab: Unified view combining comments and audit history
  - History now includes overview/analysis field updates and sub-entity diffs (team, dependencies, CAPEX/OPEX links, scoring override fields) with display-name snapshots.
  - Opening the Activity tab triggers a fresh fetch so newly logged history entries appear without manual page reload.
- Conversion: Approved requests can be converted to projects via `POST /portfolio/requests/:id/convert`

### Projects (`/portfolio/projects`)
- Grid: `frontend/src/pages/portfolio/ProjectsPage.tsx` with progress bar column. Scope filter (My/Team/All) persisted per user via `useGridScopePreference`.
- Workspace: `frontend/src/pages/portfolio/ProjectWorkspacePage.tsx`
  - **Send link**: Button in header (left of prev/next arrows) opens `ShareDialog` to email a link to the project. Supports platform users and arbitrary email addresses. Backend: `POST /portfolio/projects/:id/share` (reader permission).
  - Tab order: Overview, Activity, Timeline, Progress, Tasks, Team, Scoring, Relations
  - Rich text: `purpose` field using RichTextEditor
  - Activity tab: Unified view with Comments/History subtabs
  - History now includes overview/timeline/progress updates plus sub-entity diffs (team, dependencies, CAPEX/OPEX links, phases, scoring override fields, project task creation).
  - Opening the Activity tab triggers a fresh fetch so newly logged history entries appear without manual page reload.
  - Tasks tab: `ProjectTasksPanel.tsx` with status/phase filtering, navigation-based task creation
  - Timeline tab: Phase/milestone management with "Add Task" button per phase
  - Progress tab: Effort tracking with IT/Business split, time log showing project overhead and task time

### Planning (`/portfolio/planning`)
- Page: `frontend/src/pages/portfolio/PlanningPage.tsx`
- Gantt component: `frontend/src/pages/portfolio/components/PortfolioGantt.tsx`
- Purpose: Interactive schedule planning plus roadmap simulation/apply workflow for portfolio projects
- Modes:
  - **Timeline**: direct project date planning with draggable bars
  - **Roadmap Generator**: scenario-based scheduling with bottlenecks and occupation analytics
- Data:
  - Uses `GET /portfolio/projects/planning/timeline`
  - Displays projects, dependencies, and optional milestones
  - Supports filters by category and multi-status
- Roadmap generator:
  - Component: `frontend/src/pages/portfolio/components/RoadmapGenerator.tsx`
  - Generate endpoint: `POST /portfolio/reports/roadmap/generate`
  - Apply endpoint: `POST /portfolio/projects/planning/roadmap/apply`
  - Default statuses: Waiting List, Planned, In Progress, In Testing
  - "Recalculate already scheduled projects" is enabled by default; scheduled items may be recomputed
  - Unchecking projects in the Schedule tab triggers regeneration and excludes those projects entirely from scenario/capacity
  - Schedule project titles link to project Progress (`/portfolio/projects/:id/effort`)
  - Bottlenecks tab provides contributor impact ranking with expandable per-contributor project contribution details (start/end, total contribution days, spent days), sorted by start date
  - Occupation tab provides weekly heatmap matrices (week-number columns) for Contributors (grouped by team) and Teams (aggregated rows)
  - Roadmap Gantt preview is read-only, keeps 25/75 today positioning, and auto-expands time range so latest scheduled completion remains visible
- Time controls:
  - Range presets: 1 month, 3 months, 6 months, 1 year
  - Month offset navigation (back/today/forward)
  - Range window uses ~25% past / 75% future around today when centered
- Scale presets:
  - 1 month: week/day
  - 3 months: month/week
  - 6 months: quarter/month
  - 12 months: year/month
- UX details:
  - Single resizable `Project` column
  - Start/end columns intentionally removed (timeline bar is the source of truth)
  - Font sizes: project header 12px bold, project rows 12px, bar labels 11px, scale labels 12px
  - Custom vertical today line overlay (no label) with scroll positioning to keep today visible
  - Horizontal scrolling stays inside the chart container
- Editing:
  - Dragging project bars updates planned dates (`PATCH /portfolio/projects/:id`)
  - Milestones are displayed but not draggable

### Reporting (`/portfolio/reports`)
- Hub: `frontend/src/pages/portfolio/ReportsPage.tsx` with report cards
- Status Change Report: `frontend/src/pages/portfolio/StatusChangeReport.tsx`
  - Filters: period (start/end), status, item type, source, category, stream (stream enabled only when one or more categories are selected)
  - Scope: standalone tasks + requests + projects whose status changed during the selected period
  - In-period logic: one row per item using the latest status change in the period (final status reached in range)
  - Grid: Name, Item Type, Priority, Status, Source, Category, Stream, Company, Last Changed
  - Export: CSV and XLSX (item title hyperlinks to workspace item)
- Capacity Heatmap: `frontend/src/pages/portfolio/CapacityHeatmapReport.tsx`
  - Filters: teams (incl. No team), project status, capacity mode, group-by
  - Heatmap table: Remaining days, capacity/month, months of work, color-coded bands
  - Unassigned work: summary card + expandable project table
  - Drill-down: click contributor row to open project breakdown dialog
  - Export: CSV, PNG, Print

### Unified Activity Component
Portfolio workspaces use a shared activity system (modeled after Tasks):
- `PortfolioActivity.tsx`: Container with Comments/History toggle
- `PortfolioComments.tsx`: Rich text comment form with formal decision support
  - "Formal decision" checkbox enables decision mode
  - Decision mode requires: Context/Meeting field, Decision Outcome (go/no_go/defer/need_info/analysis_complete)
  - Optional status transition on decision
  - Layout: checkbox + context on row 1; decision fields on row 2 (when checked)
  - **Editable comments**: Authors can edit their own comments (type=comment only, not decisions/changes)
  - Shows "(edited)" indicator when a comment has been modified (`updated_at` is set)
- `PortfolioHistory.tsx`: Audit trail showing field changes and decisions
  - Multi-field entries render per-field deltas; null/add/remove transitions are shown explicitly.
  - Phase keys (`phase.<phaseId>.<field>`) are formatted for readability in the UI.
  - Comment entries in History use one-line plain-text previews (HTML stripped).

### Rich Text & Inline Images
- All description fields use RichTextEditor with 6/12 min/max rows
- Images pasted into rich text are uploaded to S3 via inline attachment endpoints
- Inline images tracked via `source_field` column on attachment tables (hidden from explicit Attachments panel)
- Orphan cleanup: Removed images are deleted on save

### Backend APIs
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /portfolio/requests | List requests with filters |
| POST | /portfolio/requests/:id/convert | Convert request to project |
| POST | /portfolio/requests/:id/attachments/inline | Upload inline image |
| GET | /portfolio/requests/inline/:tenantSlug/:attachmentId | View inline image |
| GET | /portfolio/requests/:id?include=activities | Load request including activity history |
| PATCH | /portfolio/requests/:id/comments/:activityId | Edit comment (author-only) |
| GET | /portfolio/projects | List projects with filters |
| GET | /portfolio/projects/planning/timeline | Planning timeline data (projects, dependencies, milestones) |
| POST | /portfolio/reports/roadmap/generate | Generate roadmap scenario (schedule, bottlenecks, occupation) |
| POST | /portfolio/projects/planning/roadmap/apply | Apply selected generated dates transactionally |
| GET | /portfolio/projects/:id/tasks | List project tasks |
| POST | /portfolio/projects/:id/attachments/inline | Upload inline image |
| GET | /portfolio/projects/inline/:tenantSlug/:attachmentId | View inline image |
| GET | /portfolio/projects/:id?include=activities | Load project including activity history |
| PATCH | /portfolio/projects/:id/comments/:activityId | Edit comment (author-only) |
| POST | /portfolio/requests/:id/share | Send link email for a request |
| POST | /portfolio/projects/:id/share | Send link email for a project |
| PATCH | /portfolio/projects/:projectId/tasks/:taskId/activities/:activityId | Edit task comment (author-only) |
| GET | /portfolio/reports/status-change | Portfolio status change report (final status per item in selected period) |
| GET | /portfolio/reports/status-change/filter-values | Distinct filter values for status change report (status/type/source/category/stream) |
| GET | /portfolio/reports/status-change/export | Export status change report (`format=csv` or `format=xlsx`) |
| GET | /portfolio/reports/capacity-heatmap | Portfolio capacity heatmap (contributors/teams) |
| GET | /portfolio/reports/capacity-heatmap/contributor/:contributorId | Project breakdown for contributor |

### Permissions
- `portfolio_requests`: reader/member/admin for request management
- `portfolio_projects`: reader/contributor/member/admin for project management. The `contributor` level can edit existing projects, add comments/attachments, manage phases/milestones/dependencies, and work on project tasks, but cannot create new projects (requires `member`) or import/export CSV (requires `admin`)
- Tasks use mixed permission enforcement:
  - `tasks:*` controls global tasks list and non-project task edits
  - `portfolio_projects:contributor` is required for saves that target project context (including moving a task into a project)

## Backend Multi-Tenancy & RLS

Tenant isolation combines request-scoped transactions with Postgres row-level security (RLS):
- `backend/src/common/tenant-init.guard.ts` and `backend/src/common/tenant.interceptor.ts` wrap each request in a `QueryRunner`, call `set_config('app.current_tenant', <uuid>)`, and share the transaction with controllers.
- The helper `withTenant` (`backend/src/common/tenant-runner.ts`) performs ad-hoc tenant-scoped tasks (billing summaries, purge jobs) inside an explicit transaction.
- Tenancy metadata lives in `backend/src/tenants/tenant.entity.ts`; the slug is resolved at request bootstrap and attached to `req.tenant`.
- Tenant slug reservation/normalization is centralized in `backend/src/tenants/tenant-slug-policy.ts` and enforced at both public signup (`backend/src/public/public.controller.ts`) and tenant service creation/update (`backend/src/tenants/tenants.service.ts`). Unavailable slugs return `SUBDOMAIN_NOT_AVAILABLE`.
- RLS policies are applied to every tenant-owned table via migrations `backend/src/migrations/1756687500000-rls-enable-initial.ts`, `...7700000-rls-add-with-check.ts`, `...7900000-rls-enable-spend-contracts.ts`, etc. Each table includes `tenant_id` with default `app_current_tenant()` and `FORCE ROW LEVEL SECURITY` to prevent bypass.
- `portfolio_activities` has canonical enforced RLS (`1830000000000-portfolio-activities-rls-canonical.ts`) and request/project activity queries add explicit tenant predicates (`a.tenant_id = app_current_tenant()`) as defense in depth.

## Permissions & RBAC

Role-based access guards every admin and operations endpoint:
- The decorator/guard pair `backend/src/auth/require-level.decorator.ts` + `backend/src/auth/permission.guard.ts` compare the required level against the caller's role-derived map (reader < contributor < member < admin). The `contributor` level sits between reader and member, allowing edits to existing items without creating new top-level items.
- Role permissions are stored in `role_permissions` and managed by `PermissionsService` (`backend/src/permissions/permissions.service.ts`); aliases map routes like `/admin/roles` to the `users` resource and `/ops/reports` to `reporting`.
- Users inherit permissions from their assigned role (`users.role_id`); the frontend reflects allowed tiles via `hasLevel` from `AuthContext`.
- **Auto-grant dependency**: When saving role permissions, if any operations resource (opex, capex, projects, contracts) has reader or higher access, `tasks:reader` is automatically granted. This ensures task data embedded in operations pages displays correctly without explicit configuration.

## Tenant Lifecycle & Deletion

Platform admins operate through `AdminTenantsService` (`backend/src/admin/tenants/admin-tenants.service.ts`):
- List/search tenants with aggregated stats (`TenantStatsService`) and billing snapshot (`BillingService`).
- Freeze/unfreeze flips `TenantStatus` and records audit entries via `AuditService`.
- Plan updates run inside `withTenant` to respect RLS while touching per-tenant subscriptions.
- Mark as internal tenant (`markInternal`) turns a demonstration or test tenant into an active subscription with plan `Internal`, unlimited seats and no money flow, which also reactivates an expired trial. It is refused when the subscription is linked to Stripe. See "Internal tenants" in `architecture.md`.
- Synchronous deletion (`deleteTenant`) validates confirmation slug, transitions status to `deleting`, purges tenant data across spend, contracts, CAPEX, RBAC, audit, accounting master data (including `chart_of_accounts` and `accounts`), and branding storage objects (tenant logo), then marks the record `deleted`. The tenant slug is cleared for reuse by assigning a unique `deleted-<slug>-<timestamp>` marker. Failures revert to `frozen` with an audit trail.

## Audit & Compliance

Every mutating service logs to `audit_log` via `backend/src/audit/audit.service.ts`, using the same tenant-scoped `EntityManager`. Entries capture table, record ID, serialized `before`/`after`, actor ID, source metadata (`source`, `source_ref`), and timestamp, ensuring traceability under RLS.

Audit records are exposed in the Admin workspace through `GET /audit-logs`, `GET /audit-logs/filter-values`, and `GET /audit-logs/:id` (all guarded by `users:admin`).

## Frontend/Backend Integration Patterns

- List pages consume REST endpoints with pagination, filter, and quick-search parameters shaped by `parsePagination` (`backend/src/common/pagination.ts`).
- Mutations (`Create`, `Update`, `Disable`) run through React Query `useMutation`, invalidating cache keys (`queryClient.invalidateQueries`) to keep grids fresh.
- CSV import/export flows leverage `fast-csv` adapters with UTF-8/BOM safeguards (`backend/src/common/encoding.ts`) and surface dialogs like `CsvImportDialog`/`CsvExportDialog` under each master data page.

---

_Next maintainers: extend this map when adding pages or platform flows so admins can quickly trace UI behaviors back to the enforcing backend modules/policies._

## Contacts Directory

- Route: `/master-data/contacts` → `frontend/src/pages/ContactsPage.tsx` with a grid, CSV import/export (admins), and a workspace for create/edit (`/master-data/contacts/:id/overview`).
- Purpose: Central directory of external contacts (first/last name, job title, email, phone, mobile, country, notes, active) with an **optional Supplier** link.
- Phone UX: Country code has its own enlarged dropdown (fits 4+ digits); selecting a dial code immediately keeps it selected and leaves the local number field independent. The country field auto-fills from the first chosen dial code when empty (best-effort map), and phone/mobile combine the dial code + local part transparently for validation/save.
- Save/close: Saving a contact now returns to the Contacts list (workspace closes on save for both create and edit flows).
- Supplier picker: Overview form adds a Supplier dropdown (same component as OPEX/Application forms), positioned above Job Title. Selection is optional and persisted on save.
- Grid defaults: The Contacts grid shows the Supplier column by default, placed between First Name and Email; sortable/filterable alongside other columns.
- Supplier linking: Suppliers can link multiple contacts per fixed role (`commercial|technical|support|other`). Linked contacts are managed from the Suppliers workspace Contacts tab and displayed as a compact table (First name, Last name, Email, Mobile) with a delete action. Rows are clickable to open the Contact workspace.
- Data freshness: The Suppliers Contacts tab always refetches on mount/focus, and saving a Contact invalidates supplier‑contact link caches to reflect phone/mobile changes immediately without requiring a page refresh.
- Permissions: `contacts:reader|manager|admin`; contacts:reader is auto‑granted for roles with suppliers:manager or suppliers:admin.
- CSV:
  - Contacts: `GET /contacts/export`, `POST /contacts/import`
  - Suppliers (compatibility): `commercial_contact|technical_contact|support_contact` columns accept an email; import links by email; export shows the first/primary linked contact email per role.
- Tenant deletion: Contact tables are included in purge order (`supplier_contacts`, then `contacts`) so tenant removal fully clears directory data.
