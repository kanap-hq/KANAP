# User Manual Documentation Inventory

_Generated: 2026-08-13_

This document tracks documentation coverage for the KANAP user manual.

## Summary

| Category | Total Pages | Documented | Gap |
|----------|-------------|------------|-----|
| Home | 1 | 1 | 0 |
| Budget Management | 9 | 9 | 0 |
| IT Landscape | 9 | 9 | 0 |
| Knowledge | 1 | 1 | 0 |
| Master Data | 8 | 8 | 0 |
| Admin & Settings | 15 | 15 | 0 |
| Plaid | 1 | 1 | 0 |
| AI Agents | 5 | 5 | 0 |
| Reports | 10 | 10 | 0 |
| Portfolio | 10 | 10 | 0 |
| **TOTAL** | **69** | **69** | **0** |

_Note: Supplemental Fast Track guides are excluded from these route-based counts. All tenant-facing routes have a manual. The classic product (through the 2026-05-10 sweep) is available in en/fr/de/es; the AI Agents section (added 2026-07-05) is also available in en/fr/de/es. The two AI model registry pages (added 2026-08-10) are available in en/fr/de/es._

---

## Recent Updates

| Date | Doc File | Changes |
|------|----------|---------|
| 2026-10-06 | _CSV files (en/fr/de/es)_ | New `csv-files.md`: the shared reference for the master data **Export CSV** and **Import CSV** buttons, moved out of `master-data-operations.md` (which is now only the freeze and the yearly metrics copy). Links from `companies.md`, `departments.md`, `cost-centers.md`, `suppliers.md`, `chart-of-accounts.md`, `analytics.md`, `working-day-calendars.md` and `admin.md` point to it. Not tied to a route, so no Help button mapping; listed under Supplemental Guides. The mkdocs nav has it as the last item of Master Data. |
| 2026-10-06 | _Budget administration (en/fr/de/es)_ | Currencies and the master data freeze and yearly metrics copy moved under **Budget management > Administration**. `budget-operations.md`: landing now has a **Settings** and an **Operations** section (nine cards, shown by access); `currencies.md`: new location and a read-only versus budget administrator note; `master-data-operations.md`: retitled "Freeze master data and copy yearly metrics" with the new path; `admin.md`: `budget_ops` row mentions currency settings, `settings` row covers the IT landscape only; `companies.md` and `departments.md`: frozen-metrics notice and paths; `analytics.md`: now in the **Finance** group of the Master data sidebar; `index.md`, `fast-track/getting-started.md` and the mkdocs nav follow. The `/master-data/currency` and `/master-data/operations*` routes redirect to the new `/ops/operations/*` routes. |
| 2026-09-04 | _Microsoft Entra (3 pages, en/fr/de/es)_ | Documented the Microsoft Entra features shipped in the user management revamp (PRs #163, #164, #168). `on-premise/sso-entra.md`: Step 3 rewritten into delegated permissions (the five sign-in scopes added as **configured** permissions, with the warning that tenant-wide admin consent rewrites the grant to the configured list and would drop `openid`/`profile`/`email`/`offline_access`), the application permission **User.Read.All** for the nightly sync, who owns the app registration in hosted vs on-prem, and the corrected `ENTRA_ENRICH_PROFILE` scope (it only skips the login-time Graph `/me` call, the nightly sync still runs). New Step 7 for granting consent from KANAP, a "The daily directory sync" section (03:00 server time, refreshed attributes, name-matched company/department, empty values never clear data, disable on removal or `accountEnabled=false`), and an extended Troubleshooting (all four `ssoError` codes, "Not authorized yet", consent-dropped scopes, expired secret `AADSTS7000222`). `admin.md`: Authentication gained a **Daily directory sync** states/actions table and corrected button labels (**Connect** / **Reconnect** / **Test sign-in**); Users gained the Status / Last sign-in / Roles / Account type columns, the five status values incl. **Pending access**, the **Invited** filter scope, the row-action table, the bulk **Disable**, the Contact fallback when roles are cleared, a rewritten "Users managed by Microsoft Entra" (login + nightly sync, locked fields, no invitations or password resets, deprovisioning disables), and a "Just-in-time sign-in with Microsoft" section. `on-premise/configuration.md`: `graph.microsoft.com` outbound row rescoped, the Entra SSO pointer expanded, and the directory sync added to Background Jobs. No new pages, so no mkdocs nav change. fr/de/es synced. |
| 2026-08-13 | _AI Agents (5 pages, en/fr/de/es)_ | Refreshed the whole AI Agents section for the Desk agents UX revamp shipped in PRs #147–#151. `agents-workspace`: new **action bar** section (merged run-mode/status control with the three run modes Off / Manual only / Watching, Check now, Test, and the red **Pause agent** brake, on every tab); Monitor rewritten around the read-only **Status** section (the old Status/Queue/Limits cards are gone); **Performance** renamed **Performance & autonomy** and now carries the two 14-day trend charts plus the autonomy ladder moved out of Settings, with the new **risk tiers** (requester replies / assignment / participants are automatable but always demand an acknowledgement + written reason); Settings reordered Targeting → Objective and capabilities → Knowledge and web sources → Operating settings, documenting **Check every (minutes)** (5–1440), the **Safety limits** group with live "Today:" usage, **Keep activity history (days)** (7–90, default 30) and its nightly purge, plus the 28-day autonomy-window caveat, the collapsed effective-prompt expander, capabilities-first ordering and shared-context progressive disclosure. `agents-overview`: **New agent** is a top-right header button (the grid card is gone), the **Cost — today / 7 days** fleet tile replaces **Cost per ticket** and covers every agent, statuses gained colours, the built-in helpdesk agent is hidden until first used, the wizard's SRE path documented, run modes added to the concepts block. `agents-approvals`: **Acknowledge** and **Re-run analysis** on **Needs attention** rows, traces now open in place instead of navigating to Activity, **Approve all** as the primary button, **In progress** hidden when empty. `agents-activity`: seven multi-select type chips (all on except the new **Checks**), informative check titles with the Seen/Queued/Already seen/Handled breakdown, **Load more** with the shown/total counter, retention note, trace timestamps and per-step durations, safety-cap entries corrected from Error to Configuration. `agents-shared-context`: enabling it now reveals the profile controls progressively, under **Objective and capabilities**. Also mapped the new `AgentControlBar` / `AgentStatusStrip` / `agentRunState` / `RunTraceDialog` components in `doc-update-map.tsv`. No new routes, so no mkdocs nav or `docUrls.ts` change. fr/de/es synced. |
| 2026-08-10 | _AI model registry (2 new + 4 refreshed)_ | Documented the per-tenant AI model registry shipped in PRs #140 + #142. New: `ai-models.md` (`/admin/ai-models` — the model list with the pinned KANAP included model row, capabilities, €/M-token prices, "Used by", the default-model star, the editor dialog, and the archive/restore rules) and `ai-usage.md` (`/admin/ai-usage` — the token/conversation metrics moved off the Plaid page, plus real monthly and 30-day costs broken down by agent and by model, with the Plaid-estimate caveat). Rewrote `ai-settings` around the single **Model used by Plaid** selector (the provider radio, the flat provider/model/endpoint/key fields, the Multimodal LLM toggle and the Usage Overview are all gone). Refreshed `agents-workspace` (per-agent **AI model** selector defaulting to **Organization default**; cost caps priced by the assigned model and inert on a free one; monitoring agents get the same selector), `agents-overview` (Limits list + the "shared provider" framing), `ai-assistant` (built-in usage now phrased as the KANAP included model), and `index`. Wired mkdocs nav (+fr/de/es labels), `docUrls.ts` (the `/^\/admin\/ai/` prefix was capturing both new routes and sending their Help button to Plaid Settings) and `doc-update-map.tsv`. |
| 2026-07-06 | _AI Agents (4 pages, en/fr/de/es)_ | Documented the new **Dismiss** operator decision on `agents-approvals` (a third action beside Approve/Reject: sets a proposal aside without sending anything and without counting against the agent's evaluation; adds the **Dismiss all** bulk action and its confirmation dialog, a short Dismiss-vs-Reject guidance subsection, and the Dismissed-vs-Expired distinction; intro reworked from the two-decision framing). Added the **Dismissed** metric to the `agents-overview` fleet header and the `agents-workspace` Performance tab (with the "high dismiss rate = targeting problem" reading guidance), and "Proposal dismissed" to `agents-activity` decision entries. Authored natively in en/fr/de/es. |
| 2026-07-05 | _AI Agents (5 new) + 3 refreshed_ | New **AI Agents** section documented: `agents-overview`, `agents-workspace`, `agents-approvals`, `agents-activity`, `agents-shared-context`. Refreshed `ai-settings` (Multimodal LLM toggle, Agent-messages usage, provider now powers agents too), `integrations` (the GLPI connection now also feeds agents), `ai-assistant` (Plaid-vs-Agents note). Wired mkdocs nav (+fr/de/es labels), `docUrls.ts`, `doc-update-map.tsv`, a new `ai_agents` glossary category, and the on-prem feature-gate inventory. EN authored; fr/de/es translation pending (`/translate-docs`). |
| 2026-05-10 | _15 pages_ | Stale-doc sweep + 4 new pages. Refreshed: tasks, portfolio-projects, portfolio-requests (properties drawer + new tab layouts, task ↔ application/asset linking), applications/assets (new tab layouts, linked-tasks under Relations), interfaces (mapping-group/mapping-rule model, 5-tab workspace), connection-map / interface-map (current filters and side panels), knowledge (restricted libraries, docx import, AI document generation), branding (two-card form), my-dashboard (current tiles + quick actions). New: ai-assistant.md (Plaid), ai-settings.md (Plaid Settings), integrations.md (GLPI), scheduled-tasks.md. fr/de/es synced for all updates. |
| 2026-03-29 | `assets.md` | Refreshed: added sub-location column (list), sub-location field (Overview tab), sub-location filter |
| 2026-03-29 | `locations.md` | Refreshed: added sub-locations panel, fixed permissions (member not admin), added Additional Info for both hosting types, added Permissions table, sub-location column in Relations |
| 2026-03-27 | IT Landscape batch | Renamed "IT Operations" → "IT Landscape" across applications, assets, connections, connection-map, interfaces, interface-map, locations, it-ops-settings docs |
| 2026-03-15 | _27 pages refreshed_ | Full staleness sweep: all stale route manuals regenerated from current code. Key changes: docx import (tasks, knowledge, requests, projects), LinkCellRenderer migration across all list pages, Relations tab expansions (opex, capex, contracts, applications), new tabs documented (assets: 8 tabs, applications: Knowledge tab), permission corrections, terminology fixes (Servers not Assets in maps/connections) |
| 2026-03-12 | `fast-track/index.md` | Updated for the current request/project workspace model: Summary + Analysis + Scoring flow, sidebar-based team/relations, current statuses, and conversion behavior |
| 2026-03-10 | `knowledge.md` | New manual for the Knowledge workspace, document lifecycle, review flow, relations, and export behavior |
| 2026-03-10 | `portfolio-requests.md` | Rewritten for the current Summary / Activity / Analysis / Scoring / Knowledge workspace model |
| 2026-03-10 | `portfolio-projects.md` | Rewritten for the current Summary / Activity / Timeline / Progress / Tasks / Scoring / Knowledge workspace model |
| 2026-03-10 | `_documentation-inventory.md` | Added Knowledge coverage, counted Planning as documented, and refreshed coverage totals |
| 2026-02-28 | `portfolio-reporting.md` | Added Weekly Report section (filters, three tables, exports) |
| 2026-02-28 | `portfolio-projects.md` | Added item number (#) column in list and workspace header |
| 2026-02-28 | `portfolio-requests.md` | Added item number (#) column in list and workspace header |
| 2026-02-28 | `portfolio-team-members.md` | Added Time Logged tab documentation (view, edit, delete time entries) |
| 2026-02-28 | `tasks.md` | Added "Converting a task to a request" section |
| 2026-02-28 | `_documentation-inventory.md` | Added branding, settings, weekly report routes; updated counts and triggers |
| 2026-02-27 | `branding.md` | New documentation for Branding page (logo, colors, favicon) |
| 2026-02-22 | `chart-of-accounts.md` | Added Available Templates catalog (20 templates, 10 standards × 2 versions), IFRS consolidation reference table, v1.0 vs v2.0 guidance, updated scenarios and FAQ |
| 2026-02-16 | Multiple files | Dissolved My Workspace: Dashboard promoted to home page (`/`), Tasks moved to Portfolio section, My Workspace tab removed, legacy routes redirect |
| 2026-02-15 | Multiple files | Navigation restructure: renamed "Apps & Services" → "Applications", "Budget Operations" → "Budget Administration", "Master Data Operations" → "Master Data Administration", "Analytics Categories" → "Analytics Dimensions", "Dashboard" → "Overview"; added sidebar grouping to IT Ops and Master Data doc nav |
| 2026-02-14 | `my-dashboard.md` | New documentation for My Dashboard (tiles, quick actions, settings, customisation) |
| 2026-02-14 | `admin.md` | Added Audit Log documentation (access, filtering, pagination, source interpretation) |
| 2026-02-12 | `portfolio-reporting.md` | Added Status Change Report documentation (filters, inclusion rules, columns, exports) |
| 2026-02-10 | `tasks.md` | Added "Sending a link" section (Send link feature) |
| 2026-02-10 | `portfolio-projects.md` | Added "Sending a link" section (Send link feature) |
| 2026-02-10 | `portfolio-requests.md` | Added "Sending a link" section (Send link feature) |
| 2026-02-10 | `opex.md` | Rewrote Tasks tab for new EntityTasksPanel (list view with links to task workspace) |
| 2026-02-10 | `capex.md` | Rewrote Tasks tab for new EntityTasksPanel |
| 2026-02-10 | `contracts.md` | Rewrote Tasks tab for new EntityTasksPanel |
| 2026-02-10 | `operations-dashboard.md` | Updated for dashboard redesign: 3-column layout, View buttons, structured tile sections |
| 2026-02-10 | `tasks.md` | Fixed OPEX terminology, added default task type auto-selection |
| 2026-02-10 | `portfolio-projects.md` | Added Gantt view documentation to Timeline tab |
| 2026-02-10 | `portfolio-requests.md` | Added Integration & Compatibility as 7th feasibility dimension |
| 2026-02-10 | `contacts.md` | Added create-contact-from-supplier workflow |
| 2026-02-10 | `applications.md` | Updated for latest changes |
| 2026-02-08 | `admin.md` | Updated for latest changes |
| 2026-01-31 | `tasks.md` | Updated for task workspace sidebar, CSV import/export, standalone classification |
| 2026-01-31 | `portfolio-settings.md` | Updated for latest changes |
| 2026-01-31 | `interfaces.md` | Updated for latest changes |
| 2026-01-31 | `suppliers.md` | Updated for latest changes |
| 2026-01-29 | `portfolio-reporting.md` | New documentation for Portfolio Reporting + Capacity Heatmap |
| 2026-01-27 | `assets.md` | Updated for latest changes |
| 2026-01-26 | `it-ops-settings.md` | Updated IT Landscape Settings |
| 2026-01-18 | `portfolio-team-members.md` | New documentation for Portfolio Team Members |
| 2026-01-15 | `connections.md` | Updated for latest changes |
| 2026-01-15 | `connection-map.md` | Added Applications filter, App Env filter, connection layers, export SVG/PNG, linked interfaces |
| 2026-01-15 | `interface-map.md` | Added Applications filter, export SVG/PNG, snap to grid, infra connections panel |
| 2026-01-15 | `locations.md` | Updated for latest changes |
| 2026-01-11 | `portfolio-requests.md` | New documentation for Portfolio Requests (initial) |
| 2026-01-11 | `portfolio-projects.md` | New documentation for Portfolio Projects (initial) |
| 2026-01-11 | `portfolio-settings.md` | New documentation for Portfolio Settings (initial) |
| 2026-01-11 | `admin.md` | Updated for RBAC changes: multi-role assignment, permission groups, built-in roles, role duplication |

---

## Supplemental Guides

These published pages are maintained alongside the user manual but are not tied to a single route and are therefore excluded from the coverage totals above.

| Guide | Path | Purpose |
|-------|------|---------|
| Getting Started | `fast-track/getting-started.md` | First-day onboarding across the product |
| Portfolio Fast Track | `fast-track/index.md` | Request-to-project delivery workflow |
| IT Ops Fast Track | `fast-track/apps-and-assets.md` | Application-to-server documentation flow |
| Task Types Fast Track | `fast-track/task-types.md` | Run vs Build vs Task terminology |
| CSV files | `csv-files.md` | Rules shared by the **Export CSV** and **Import CSV** buttons of the master data lists: preflight check, columns, encoding, separator, amounts, dates, size |

---

## Detailed Inventory

### Home

| Route | Component | Status | Doc File |
|-------|-----------|--------|----------|
| `/` | WorkspaceDashboardPage | **DOCUMENTED** | `my-dashboard.md` |

_Note: `/my/dashboard` redirects to `/`. `/my/tasks` and `/ops/tasks` redirect to `/portfolio/tasks`._

### Budget Management

| Route | Component | Status | Doc File |
|-------|-----------|--------|----------|
| `/ops` | DashboardPage (Overview) | **DOCUMENTED** | `operations-dashboard.md` |
| `/ops/opex` | OpexListPage + SpendItemPage | **DOCUMENTED** | `opex.md` |
| `/ops/capex` | CapexPage + CapexItemPage | **DOCUMENTED** | `capex.md` |
| `/ops/contracts` | ContractsPage + ContractWorkspacePage | **DOCUMENTED** | `contracts.md` |
| `/ops/operations` | BudgetOperationsLandingPage (Administration) | **DOCUMENTED** | `budget-operations.md` |
| `/ops/operations/freeze` | BudgetFreezePage | **DOCUMENTED** | (in budget-operations) |
| `/ops/operations/copy-budget-columns` | CopyBudgetColumnsPage | **DOCUMENTED** | (in budget-operations) |
| `/ops/operations/copy-allocations` | CopyAllocationsPage | **DOCUMENTED** | (in budget-operations) |
| `/ops/operations/column-reset` | BudgetColumnResetPage | **DOCUMENTED** | (in budget-operations) |
| `/ops/operations/columns` | BudgetColumnsSettingsPage | **DOCUMENTED** | (in budget-operations) |
| `/ops/operations/allocation-default` | AllocationDefaultPage | **DOCUMENTED** | (in budget-operations) |
| `/ops/operations/currency` | CurrencySettingsPage | **DOCUMENTED** | `currencies.md` |
| `/ops/operations/master-data-freeze` | MasterDataFreezePage | **DOCUMENTED** | `master-data-operations.md` |
| `/ops/operations/metrics-copy` | MasterDataCopyPage | **DOCUMENTED** | (in master-data-operations) |

### IT Landscape

**Infrastructure**

| Route | Component | Status | Doc File |
|-------|-----------|--------|----------|
| `/it/locations` | LocationsPage + LocationWorkspacePage | **DOCUMENTED** | `locations.md` |
| `/it/assets` | AssetsPage + AssetWorkspacePage | **DOCUMENTED** | `assets.md` |
| `/it/connections` | ConnectionsPage + ConnectionWorkspacePage | **DOCUMENTED** | `connections.md` |
| `/it/connection-map` | ConnectionMapPage | **DOCUMENTED** | `connection-map.md` |
| `/it/netbox` | NetboxSyncPage | **DOCUMENTED** | `netbox.md` |

**Applications**

| Route | Component | Status | Doc File |
|-------|-----------|--------|----------|
| `/it/applications` | ApplicationsPage + ApplicationWorkspacePage | **DOCUMENTED** | `applications.md` |
| `/it/interfaces` | InterfacesPage + InterfaceWorkspacePage | **DOCUMENTED** | `interfaces.md` |
| `/it/interface-map` | InterfaceMapPage | **DOCUMENTED** | `interface-map.md` |

**Settings**

| Route | Component | Status | Doc File |
|-------|-----------|--------|----------|
| `/it/settings` | ItOperationsSettingsPage | **DOCUMENTED** | `it-ops-settings.md` |

### Knowledge

| Route | Component | Status | Doc File |
|-------|-----------|--------|----------|
| `/knowledge` | KnowledgePage + KnowledgeWorkspacePage | **DOCUMENTED** | `knowledge.md` |

_Note: `/knowledge/new`, `/knowledge/:id`, and `/knowledge/:id/:tab` are covered by the same manual._

### Master Data

**Organization**

| Route | Component | Status | Doc File |
|-------|-----------|--------|----------|
| `/master-data/companies` | CompaniesPage + CompanyWorkspacePage | **DOCUMENTED** | `companies.md` |
| `/master-data/departments` | DepartmentsPage + DepartmentWorkspacePage | **DOCUMENTED** | `departments.md` |

**External Parties**

| Route | Component | Status | Doc File |
|-------|-----------|--------|----------|
| `/master-data/suppliers` | SuppliersPage + SupplierWorkspacePage | **DOCUMENTED** | `suppliers.md` |
| `/master-data/contacts` | ContactsPage + ContactWorkspacePage | **DOCUMENTED** | `contacts.md` |

**Finance**

| Route | Component | Status | Doc File |
|-------|-----------|--------|----------|
| `/master-data/coa` | CoaPage + AccountWorkspacePage | **DOCUMENTED** | `chart-of-accounts.md` |
| `/master-data/accounts` | Legacy redirect to `/master-data/coa` + AccountWorkspacePage | **DOCUMENTED** | `chart-of-accounts.md` |
| `/master-data/analytics` | AnalyticsCategoriesPage + AnalyticsWorkspacePage | **DOCUMENTED** | `analytics.md` |

**Classification**

| Route | Component | Status | Doc File |
|-------|-----------|--------|----------|
| `/master-data/business-processes` | BusinessProcessesPage + BusinessProcessWorkspacePage | **DOCUMENTED** | `business-processes.md` |

### Admin & Settings

| Route | Component | Status | Doc File |
|-------|-----------|--------|----------|
| `/admin/users` | UsersPage | **DOCUMENTED** | `admin.md` |
| `/admin/roles` | RolesPage | **DOCUMENTED** | `admin.md` |
| `/admin/audit-logs` | AuditLogsPage | **DOCUMENTED** | `admin.md` |
| `/admin/billing` | BillingCenter | **DOCUMENTED** | `admin.md` |
| `/admin/auth` | AdminAuthPage | **DOCUMENTED** | `admin.md` |
| `/admin/branding` | AdminBrandingPage | **DOCUMENTED** | `branding.md` |
| `/admin/ai-models` | AdminAiModelsPage | **DOCUMENTED** | `ai-models.md` |
| `/admin/ai` | AdminAiPage | **DOCUMENTED** | `ai-settings.md` |
| `/admin/ai-usage` | AdminAiUsagePage | **DOCUMENTED** | `ai-usage.md` |
| `/admin/integrations` | AdminIntegrationsPage | **DOCUMENTED** | `integrations.md` |
| `/admin/scheduled-tasks` | ScheduledTasksPage | **DOCUMENTED** | `scheduled-tasks.md` |
| `/settings` | SettingsPage | **DOCUMENTED** | mapped to `fast-track/getting-started.md` in `docUrls.ts` (personal settings are covered in the Getting Started guide) |

### Plaid

| Route | Component | Status | Doc File |
|-------|-----------|--------|----------|
| `/ai` | AiWorkspacePage | **DOCUMENTED** | `ai-assistant.md` |

### AI Agents

| Route | Component | Status | Doc File |
|-------|-----------|--------|----------|
| `/agents` | AgentsOverviewPage | **DOCUMENTED** | `agents-overview.md` |
| `/agents/:agentKey` | AgentWorkspacePage | **DOCUMENTED** | `agents-workspace.md` |
| `/agents/approvals` | AgentsApprovalsPage | **DOCUMENTED** | `agents-approvals.md` |
| `/agents/activity` | AgentsActivityPage | **DOCUMENTED** | `agents-activity.md` |
| `/agents/shared-context` | SharedContextProfilesPage | **DOCUMENTED** | `agents-shared-context.md` |

_Note: `/admin/agent-control` and `/admin/agent-control/*` redirect to `/agents`. The whole section requires AI to be enabled on the instance and the `ai_agents` role. All five manuals are published in en/fr/de/es._

### Reports

| Route | Component | Status | Doc File |
|-------|-----------|--------|----------|
| `/ops/reports` | ReportsLandingPage | **DOCUMENTED** | `reports.md` |
| `/ops/reports/top-opex` | TopOpexReport | **DOCUMENTED** | `reports.md` |
| `/ops/reports/opex-delta` | OpexDeltaReport | **DOCUMENTED** | `reports.md` |
| `/ops/reports/comparison` | ComparisonReport | **DOCUMENTED** | `reports.md` |
| `/ops/reports/capex/trend` | CapexBudgetTrendReport | **DOCUMENTED** | `reports.md` |
| `/ops/reports/budget-columns-compare` | BudgetColumnsCompareReport | **DOCUMENTED** | `reports.md` |
| `/ops/reports/consolidation` | ConsolidationReport | **DOCUMENTED** | `reports.md` |
| `/ops/reports/analytics` | AnalyticsCategoryReport | **DOCUMENTED** | `reports.md` |
| `/ops/reports/chargeback/global` | GlobalChargebackReport | **DOCUMENTED** | `reports.md` |
| `/ops/reports/chargeback/company` | CompanyChargebackReport | **DOCUMENTED** | `reports.md` |

### Portfolio

| Route | Component | Status | Doc File |
|-------|-----------|--------|----------|
| `/portfolio/requests` | RequestsPage + RequestWorkspacePage | **DOCUMENTED** | `portfolio-requests.md` |
| `/portfolio/projects` | ProjectsPage + ProjectWorkspacePage | **DOCUMENTED** | `portfolio-projects.md` |
| `/portfolio/tasks` | TasksPage + TaskWorkspacePage | **DOCUMENTED** | `tasks.md` |
| `/portfolio/contributors` | ContributorsPage + ContributorWorkspacePage | **DOCUMENTED** | `portfolio-team-members.md` |
| `/portfolio/settings` | SettingsPage | **DOCUMENTED** | `portfolio-settings.md` |
| `/portfolio/reports` | ReportsPage | **DOCUMENTED** | `portfolio-reporting.md` |
| `/portfolio/reports/capacity-heatmap` | CapacityHeatmapReport | **DOCUMENTED** | `portfolio-reporting.md` |
| `/portfolio/reports/weekly` | WeeklyReport | **DOCUMENTED** | `portfolio-reporting.md` |
| `/portfolio/planning` | PlanningPage | **DOCUMENTED** | `portfolio-planning.md` |

### Excluded (Work in Progress or Platform Admin)

| Route | Reason |
|-------|--------|
| `/admin/tenants` | Platform admin only (not tenant-facing) |
| `/admin/coa-templates` | Platform admin only |
| `/admin/standard-accounts` | Platform admin only |
| `/admin/platform-ai` | Platform admin only (multi-tenant deployments) |
| `/admin/ops-dashboard` | Platform admin only (multi-tenant deployments) |
| `/ops/projects` | Placeholder (removed from routes) |
| `/ops/tasks` | Legacy route, redirects to `/portfolio/tasks` |

On-premise docs (`on-premise/*.md`) are deployment guides, not route manuals — maintained separately and excluded from route-based coverage tracking.

---

## Remaining Gaps

No route-manual gaps remain. The classic product was swept 2026-05-10; the AI Agents section was documented 2026-07-05 and the AI model registry pages 2026-08-10, both available in en/fr/de/es.

Known minor staleness:
- `portfolio-planning.md` — Roadmap Generator's drag-to-pin-start interaction is in code but not yet covered in the doc (LOW)
- `agents-workspace.md` — written for the helpdesk agent. The monitoring/SRE agent (shipped in #120/#136/#137) has its own Monitor, targeting and Operating settings and is only referenced in passing; it has no section of its own (MEDIUM)
- `/master-data` (MasterDataHomePage) — the Master Data hub landing page has no manual and no `docUrls.ts` mapping (LOW)

---

## Documentation Update Triggers

See `doc/help/_process/doc-update-map.tsv` for the machine-readable mapping
from frontend component files to documentation files. This mapping enables
automated staleness detection.
