# Frontend Architecture

Metadata
- Purpose: Document UI structure, shared components, and coding patterns for the web app
- Audience: Frontend engineers, full‑stack engineers, QA
- Status: updated
- Owner: TBD
- Last Updated: 2026-02-14

## Overview
- Tech: React + TypeScript (Vite) with MUI and AG Grid (community)
- State & Data: TanStack Query for server data fetching/caching; Axios client (`src/api.ts`)
- Layout: Top AppBar with a workspace toggle; permanent Drawer for navigation within the active workspace
- Workspaces: Portfolio Management, IT Landscape, Budget Management, Master Data, and Admin (toggle in AppBar). The home page (`/`) renders a personal Dashboard (no tab highlighted). Admin pages are separate to reduce confusion and enable clear permissions.
- Lists: Shared `ServerDataGrid` wrapper built on AG Grid provides server sort and per‑column floating filters (single condition). Default behavior uses infinite scroll; pages can opt into explicit server pagination (`enablePagination`) when needed for very large datasets (for example Audit Log with 100 rows per page). For entities with an enabled/disabled lifecycle, lists should expose a standard `Show: All / Enabled / Disabled` scope selector backed by the same `StatusState`/`disabled_at` helpers used server‑side, and keep the Status column hidden by default (available via the column chooser for advanced filtering).
- Page chrome: `PageHeader` renders breadcrumbs and page title, with an actions slot for primary buttons. Admin pages display an "Admin" chip.

## PWA Configuration
The app is configured as a Progressive Web App for a native-like experience when installed on desktop or mobile devices.

**Key files:**
- `frontend/public/manifest.json` - Web app manifest with `display: standalone` to hide the browser address bar
- `frontend/index.html` - Meta tags for theme color, iOS support, and manifest link
- `frontend/public/icon-192.png`, `icon-512.png`, `apple-touch-icon.png` - App icons

**Manifest settings:**
- `display: standalone` - Launches without browser UI (address bar hidden)
- `theme_color: #1976d2` - Status bar color matching MUI primary blue
- `background_color: #ffffff` - Splash screen background
- `orientation: any` - Supports portrait and landscape

**Mobile app support:**
- `mobile-web-app-capable: yes` - Enables full-screen mode (replaces deprecated `apple-mobile-web-app-capable`)
- `apple-mobile-web-app-status-bar-style: default` - iOS status bar appearance
- `apple-mobile-web-app-title` - App name on iOS home screen

**Icons:**
| File | Size | Purpose |
|------|------|---------|
| `favicon.ico` | 16×16, 32×32 | Browser tab favicon |
| `icon-192.png` | 192×192 | Standard PWA icon |
| `icon-512.png` | 512×512 | Large icon, splash screens |
| `apple-touch-icon.png` | 180×180 | iOS home screen |

Note: No service worker or offline support is configured - the PWA setup focuses only on presentation (hiding address bar, proper icons, theme color).

## Navigation & IA
- Workspace Toggle: AppBar segmented control is centered in the top bar, uses white styling, and navigates on click: `Portfolio → /portfolio`, `IT Landscape → /it`, `Budget Management → /ops`, `Master Data → /master-data`, `Admin → /admin`. The KANAP logo links to `/` (personal Dashboard). No tab is highlighted on the home page.
- Drawer: Shows only the routes for the active workspace; entries the user cannot at least read are hidden. Empty on the home page.
- Routing: Explicit prefixes: `/portfolio/*` for Portfolio Management, `/ops/*` for Budget Management, `/it/*` for IT Landscape, `/master-data/*` for Master Data, and `/admin/*` for Admin. Home (`/`) renders the personal Dashboard directly.

**See:** [page-and-feature-overview.md](page-and-feature-overview.md) for comprehensive page inventory with routes, purposes, and permission requirements.

### Authentication UX
- `/login` is a public page rendered inside `AuthFrame`. It shows both the traditional email/password form and a primary "Sign in with Microsoft" button when the current host resolves to a tenant. Clicking the Microsoft button sets `window.location.href = ${VITE_API_URL}/auth/entra/login?redirectTo=…` (`redirectTo` defaults to `/` or the router's requested location).
- `/login/callback` is a transient page that reads either a short-lived Entra `handoff` or the legacy `token`/`expiresIn` payload from the URL fragment (`location.hash`). For handoff callbacks it first posts to `/auth/entra/session` on the tenant host so the backend can set the `HttpOnly` refresh cookie, then calls `AuthContext.login(...)` with the returned access token and redirects with `navigate(redirectTo, { replace: true })`. Invalid/missing payloads bounce users back to `/login` with an error message in `location.state`.
- **Session expired redirect**: When a session expires (refresh token invalid/expired), users are redirected to `/login?sessionExpired=true` and shown a warning message.

### Session Management
The frontend implements automatic session management with sliding expiration:

**Components:**
- `SessionManager` (`src/auth/SessionManager.tsx`): Wraps the app and orchestrates session monitoring
- `useSessionTimer` (`src/hooks/useSessionTimer.ts`): Tracks token expiration, triggers callbacks before/at expiry
- `useSessionActivity` (`src/hooks/useSessionActivity.ts`): Detects user activity (mouse, keyboard, touch) with debouncing

**Behavior:**
- Access tokens expire after 15 minutes (configurable via `JWT_ACCESS_TOKEN_TTL`)
- The frontend proactively refreshes tokens 1 minute before expiry
- User activity (with 30-second debounce) triggers token refresh when < 5 minutes until expiry
- SessionManager tracks last user activity (synced across tabs) and enforces the refresh TTL as an inactivity timeout
- After login, SessionManager rehydrates idle state from storage before evaluating expiration to avoid stale-state redirects during the token transition from `/login` to protected routes
- On expiry, SessionManager awaits logout completion before redirecting to `/login?sessionExpired=true` to avoid token-clear races
- The idle window is sourced from `refresh_expires_in` and stored as `refresh_ttl_ms`
- If the refresh token expires (4 hours of inactivity by default), users are **silently redirected** to `/login?sessionExpired=true`
- No warning dialogs - the redirect is immediate and automatic

**Token Storage:**
- `accessTokenStore` (`src/auth/accessTokenStore.ts`): in-memory access token for the current tab
- `HttpOnly` `refresh_token` cookie (set by backend): refresh token transport for `/auth/refresh` and `/auth/logout`
- `localStorage.refresh_ttl_ms`: Refresh token TTL in milliseconds (idle timeout window, supplied by backend)
- `localStorage.last_activity_at`: Unix timestamp (ms) of the most recent user activity (shared across tabs)
- Legacy localStorage keys (`token`, `refresh_token`, `token_expires_at`) are cleared on bootstrap/login and are no longer part of the active auth model

**API Client Integration:**
- The app-wide Axios instance is `src/api.ts`; it injects the in-memory access token into `Authorization` headers.
- `AuthContext` performs startup refresh (`POST /auth/refresh`) and loads claims via `GET /auth/me`.
- `SessionManager` orchestrates expiry detection, refresh attempts, and redirect-on-expiry behavior.
- `/admin/auth` (Admin workspace) surfaces current SSO status and CTA buttons:
  - “Connect/Reconnect Microsoft Entra” → `api.post('/auth/entra/setup/start')` (requires JWT). On success, the browser navigates to the returned Microsoft consent URL.
  - “Test Microsoft sign-in” → redirects to `/auth/entra/login?redirectTo=/admin/auth` so admins can validate the tenant’s Entra connection end-to-end.
- These flows assume the SPA is loaded over HTTPS for public Entra redirects. When testing locally, load the SPA through Cloudflare on `https://<slug>.dev.kanap.net` with `VITE_API_URL=/api`, and configure `ENTRA_REDIRECT_URI` to `https://dev.kanap.net/api/auth/entra/callback` as described in `doc/planning/cloudflare-setup.md`. Entra always calls back to the shared marketing host (`dev.kanap.net` in dev), and the backend then redirects to the appropriate tenant host (`https://<slug>.dev.kanap.net/...`) based on the slug embedded in the signed state. The OIDC nonce is also embedded in signed state, and the SPA redeems a short-lived `handoff` on the tenant host so refresh cookies are scoped to the tenant domain rather than the shared callback domain.

### IT Landscape workspace
- Drawer entries: Applications, Interfaces, Servers, Settings (servers live under `/ops` but remain in this workspace for operator convenience).
- **Applications**
- List: `frontend/src/pages/it/ApplicationsPage.tsx` uses `ServerDataGrid` with a default lifecycle filter (retired excluded but selectable). Closed-set columns use checkbox-set filters with scoped values (Category, Environments, Lifecycle, Criticality, Hosting, External Facing, SSO, MFA, Data Class, Contains PII). The “Environments” column renders chips for **active** App Instances and deep-links to the Instances tab; Hosting uses derived server location hosting types. Column chooser toggles `include` flags (supplier, owners, counts, structure, instances) automatically so the grid only fetches required expansions.
  - Workspace: `frontend/src/pages/it/ApplicationWorkspacePage.tsx` tabs → Overview, Ownership & Audience, Technical, Instances, Servers, Relations, Compliance.
    - Ownership & Audience remains the inline mini-table (stable row ids, de-duped owners, derived vs manual user counts).
    - Instances tab (`InstancesEditor`) manages per-environment deployments with add/edit dialogs, Copy from Prod helper, and bulk apply for hosting/SSO/MFA.
    - Servers tab (`ServerAssignmentsEditor`) groups assignments by instance, surfaces add/remove actions, and links to the server workspace.
    - Technical tab now focuses on DR/external/ETL; hosting/auth toggles live under Instances.
    - Relations/Compliance mirror previous behavior (links/attachments, suites/components, data residency).
- **Interfaces**
  - Grid: `frontend/src/pages/it/InterfacesPage.tsx` displays Interface ID, Name, Business Process, Source App, Target App, Lifecycle, Criticality, Data Category, Contains PII, Environments (chips for envs with bindings), Environment Coverage, Bindings count, Created. Filters map directly to backend query params (type, lifecycle, criticality, contains_pii, owner; the optional `environment` filter remains backend-only). Rows open the workspace and primary action is “Add Interface”.
  - Workspace: `frontend/src/pages/it/InterfaceWorkspacePage.tsx` features:
    - Overview, Ownership & Criticality, Functional Definition, Technical Definition, Environments, Compliance.
    - Technical tab: leg template editor backed by `interface_legs` plus technical docs/attachments.
    - Environments tab powered by `InterfaceBindingsMatrix`, which enforces same-environment bindings, constrains Add Environment to envs with AppInstances for the route, supports environment deletion (including cascading binding removal), and shows readable AppInstance labels for bindings.
- **Interface Map**
  - Page: `frontend/src/pages/it/InterfaceMapPage.tsx` (`/it/interface-map`)
  - Visualization: `InterfaceMapGraph.tsx` uses D3.js + SVG for a force-directed layout.
  - Features:
    - **Business View**: Filters out middleware to show logical app-to-app connections.
    - **Technical View**: Shows full routing including middleware nodes.
    - **Highway Layout**: Parallel edges are rendered as straight, offset lines to prevent overlap and ensure distinct directionality.
  - See `doc/features/interface-map-visualization.md` for details.
- **Connections**
  - Grid: `frontend/src/pages/it/ConnectionsPage.tsx` (`/it/connections`) lists infrastructure-level connections with topology, source/destination (server or entity), protocols, lifecycle, and multi-server counts.
  - Workspace: `frontend/src/pages/it/ConnectionWorkspacePage.tsx` currently has an Overview tab only:
    - Connection ID, Name, Purpose.
    - Connection type (topology) → server-to-server (one side = server or entity, grouped picker with Entities first, Servers second) or multi-server (multi-select servers).
    - Protocols from IT Ops Connection Types; shows Typical ports chips beneath the selector.
    - Lifecycle (IT Ops lifecycle list), Notes.
  - Permissions: `applications` resource (`reader` view, `manager` mutate, `admin` bulk delete).
- **Servers**
  - Grid: `frontend/src/pages/ops/ServersPage.tsx` is exposed in the IT drawer. It lists infrastructure assets with environment/kind/provider/status filters and derived assignment counts.
- Workspace: `frontend/src/pages/ops/ServerWorkspacePage.tsx` includes Overview (name/kind/provider/env/region/zone/hostname/ip/status plus cluster toggle) and Technical (environment, OS, network segment, hostname/IP, cluster membership editor/view). Assignments tab remains a table of linked applications/envs with remove actions.
- **Settings**
  - Page: `frontend/src/pages/it/ItOperationsSettingsPage.tsx` (`/it/settings`).
  - Purpose: Tenant-wide configuration of Data Classes, Server Types, Hosting Types, Cloud Providers, Lifecycle, and Interface enums used across IT Landscape dropdowns.
  - Permissions: Requires `settings:reader` to view, `settings:admin` to change values.


### Portfolio Management workspace
- Drawer entries: Requests, Projects, Planning, Reports, Settings
- Purpose: Portfolio management for IT requests, projects, and resource planning

**Requests**
- List: `frontend/src/pages/portfolio/RequestsPage.tsx` uses `ServerDataGrid` with status, type, category filters
- Workspace: `frontend/src/pages/portfolio/RequestWorkspacePage.tsx`
  - Tabs: Overview, Activity, Analysis, Scoring, Team, Relations
  - Overview: Core request metadata + rich text `purpose`
  - Analysis:
    - Impacted Business Processes selector (persistent relation table)
    - `FeasibilityReview` matrix editor (`frontend/src/pages/portfolio/editors/FeasibilityReview.tsx`) backed by `feasibility_review` JSONB
      - Dimensions: technical_feasibility, security_compliance, infrastructure_needs, resource_skills, delivery_constraints, change_management
      - Statuses: not_assessed, no_concerns, minor_concerns, major_concerns, blocker
      - Each row has inline multiline comment editing and an optional expanded "Detailed notes" area
      - Color coding uses row-left accent and status select border (status chips removed)
    - Rich text `risks` field labeled "Risks & Mitigations"
    - Recommendation panel with `RecommendationDialog` (`frontend/src/pages/portfolio/components/RecommendationDialog.tsx`) to submit formal decisions with fixed context `Analysis Recommendation`
    - Latest recommendation summary card with outcome chip, author/time, rationale preview, status-change preview, and "View in Activity"
    - Legacy `current_situation` and `expected_benefits` render read-only under a collapsed "Previous Analysis" accordion when present
  - Activity tab: Unified view with Comments/History subtabs using PortfolioActivity component
  - Activity refresh model: entering the Activity tab triggers `refetch()` so freshly written history appears without full page reload

**Projects**
- List: `frontend/src/pages/portfolio/ProjectsPage.tsx` uses `ServerDataGrid` with progress bar column
- Workspace: `frontend/src/pages/portfolio/ProjectWorkspacePage.tsx`
  - Tab order: Overview, Activity, Timeline, Progress, Tasks, Team, Scoring, Relations
  - Overview: Rich text purpose field using RichTextEditor
  - Activity tab: Unified view with Comments/History subtabs
  - Activity refresh model: entering the Activity tab triggers `refetch()` so freshly written history appears without full page reload
  - Tasks tab: `ProjectTasksPanel.tsx` with filtering and navigation-based task creation
  - Timeline tab: Phase/milestone management with "Add Task" button per phase

**Planning**
- Page: `frontend/src/pages/portfolio/PlanningPage.tsx` (`/portfolio/planning`)
- Gantt: `frontend/src/pages/portfolio/components/PortfolioGantt.tsx` (SVAR React Gantt)
- Mode toggle in page header: `Timeline | Roadmap Generator`
- Data:
  - Timeline API: `GET /portfolio/projects/planning/timeline`
  - Query params from UI: `months`, optional `category`, repeated `status`
  - UI renders projects, dependencies, and optional milestones
- Roadmap generator:
  - Component: `frontend/src/pages/portfolio/components/RoadmapGenerator.tsx`
  - Generate API: `POST /portfolio/reports/roadmap/generate`
  - Apply API: `POST /portfolio/projects/planning/roadmap/apply`
  - Default generation scope: `waiting_list`, `planned`, `in_progress`, `in_testing`
  - "Recalculate already scheduled projects" defaults to enabled (scheduled items can move)
  - Schedule table selection is scenario-defining: unchecking a row regenerates with `excludedProjectIds`, excluding that project from both schedule output and capacity consumption
  - Schedule project titles are links to project Progress (`/portfolio/projects/:id/effort`)
  - Bottlenecks tab: contributors ranked by `impactDays` with expandable per-contributor project breakdown (project start/end, total contribution days, spent days), sorted by planned start
  - Occupation tab: weekly heatmap matrices with week-number columns; contributor view groups rows by team using merged team cells, and team view aggregates one row per team
  - Apply action sends only selected rows; UI confirms before submit
  - Read-only roadmap Gantt preview uses `monthOffset=0` to preserve the same 25/75 today positioning as main timeline and auto-expands `months` to keep the latest scheduled completion visible
- Controls:
  - Time range: 1 month, 3 months, 6 months, 1 year
  - Month navigation: previous, today reset, next
  - Filters: category, multi-status, milestones toggle
- Time window and positioning:
  - Visual range length is exactly `months`
  - When `monthOffset=0`, chart uses a 25%/75% past/future positioning around today
  - Initial and post-change repositioning keeps today visible in viewport
- Scale behavior:
  - 1 month: week/day
  - 3 months: month/week
  - 6 months: quarter/month
  - 12 months: year/month
- UX details:
  - Left table has one resizable `Project` column (12px bold header, 12px row text)
  - Bar labels use 11px font
  - Date columns are intentionally removed from the table
  - Today marker is a custom vertical overlay line (label hidden to avoid scale overlap)
  - Horizontal scroll stays within the chart container (no page-level overflow dependency)
- Interactions:
  - Dragging project bars updates `planned_start` / `planned_end` via `PATCH /portfolio/projects/:id`
  - Milestones are read-only in the Gantt
  - Double-click navigates to project workspace tabs (overview or timeline)

**Reporting**
- Reports hub: `frontend/src/pages/portfolio/ReportsPage.tsx` lists available portfolio reports
- Status Change Report: `frontend/src/pages/portfolio/StatusChangeReport.tsx` (`/portfolio/reports/status-change`)
  - Filters: period, status, item type, source, category, stream (stream enabled only when category is selected)
  - Table: AG Grid with one row per item (Name, Item Type, Priority, Status, Source, Category, Stream, Company, Last Changed)
  - Default sort: Priority descending; supports standard AG Grid column sorting
  - Exports: CSV and XLSX (XLSX name cells link to item workspace routes)
- Capacity Heatmap: `frontend/src/pages/portfolio/CapacityHeatmapReport.tsx`
  - Filters: teams, status, capacity mode, group-by
  - Table: AG Grid with heatmap color bands on months-of-work
  - Drill-down: `ContributorDrilldownDialog.tsx` for project breakdown

**Shared Portfolio Components:**
- `PortfolioActivity.tsx` - Tab container with Comments/History toggle
- `PortfolioComments.tsx` - Rich text comments with formal decision toggle
  - "Formal decision" checkbox + Context field on same line
  - Decision Outcome + Status change dropdowns (shown when decision checked)
  - Edit functionality: Authors can edit their own comments (not decisions/changes)
  - Shows "(edited)" indicator when comment has been modified
- `PortfolioHistory.tsx` - Audit trail of field changes and decisions
  - Renders multi-field diffs with explicit add/remove semantics (`null -> value`, `value -> null`)
  - Handles phase keys (`phase.<phaseId>.<field>`) with readable labels
  - Comment cards in History use one-line plain-text previews (HTML stripped); rich text remains in Comments

### Tasks (Portfolio)
- Drawer entry under Portfolio, after Projects
- Purpose: Centralized view for tasks across all entities (OPEX, Contracts, CAPEX, Projects) plus standalone tasks
- **Tasks**
  - List: `frontend/src/pages/TasksPage.tsx` uses `ServerDataGrid` with Type, Phase, Priority, Score, Status columns. Default filter shows active statuses (`open`, `in_progress`, `pending`, `in_testing`) and hides closed statuses by default. Score column shows calculated priority score for all tasks (project: `project.score + adjustment`; non-project: fixed mapping from priority level). Type column shows "Standalone" for tasks without a related object.
  - **Scope filter**: Radio buttons for "My tasks" (default), "My team's tasks", "All tasks". Scope is persisted per user via `useGridScopePreference` hook (localStorage key `kanap-grid-scope:{tenantSlug}:{userId}:tasks`), so returning to the page restores the last selection. URL params take priority when returning from workspace (scope is preserved in URL via `taskScope`, `assigneeUserId`, `teamId`). If the persisted scope is `team` but the user has no team, it falls back to `my`. Prev/Next navigation in workspace respects the selected scope.
  - Workspace: `frontend/src/pages/tasks/TaskWorkspacePage.tsx` — Jira-inspired sidebar layout
    - Header: Priority score badge (project tasks only, 56×56 circular, primary color, left of title), inline-editable title, status chip, priority chip, "Attach files" button (toggles upload area)
    - Priority score calculation:
      - Project tasks: `ROUND(CLAMP(project.priority_score + adjustment, 0, 100))`
      - Non-project tasks: Fixed mapping (Blocker=110, High=90, Normal=70, Low=50, Optional=30)
    - Main content: Click-to-edit description, attachments section (below description), activity section with Comments/History/Work Log tabs
      - Comments tab uses `UnifiedActivityForm.tsx`:
        - One submit can include comment, status change, and optional time logging (`0..8h`) together.
        - Deep-link query params (`?action=set_status&status=...`) preselect status in the form, then URL params are cleaned from browser history state.
    - Attachments: `TaskAttachments.tsx` component with drag-and-drop upload area (shown when "Attach files" clicked), file chips with download (click) and delete (×) actions
    - Sidebar: Resizable (drag handle on right edge, 240-400px range, persisted to localStorage), collapsible accordion sections
    - Section order: CONTEXT → STATUS → TIME → PEOPLE → DATES (all expanded by default, separated by dividers)
    - CONTEXT section:
      - Task Type dropdown (from portfolio task types)
      - Related object selector (editable in writable mode): `Standalone`, `Project`, `Budget (OPEX)`, `Contract`, `CAPEX`
      - Selecting `Standalone` hides the entity picker and stores `(related_object_type, related_object_id) = (null, null)`
      - Read-only mode shows the context card (e.g., "**Project** : Project Name" with link, or "**Standalone Task**")
      - Phase dropdown (project tasks only)
      - Priority dropdown
      - **Classification fields** (behavior varies by task type):
        - **Standalone tasks**: Editable dropdowns for Source, Category, Stream (filtered by category), Company
        - **Project tasks**: Editable dropdowns for Source, Category, Stream, Company. Defaults from parent project at creation; can be edited independently per task. Falls back to project value if not explicitly set
        - **OPEX/Contract/CAPEX tasks**: Classification section hidden
      - Save behavior: context change and field edits are persisted in a single PATCH call (atomic)
        - Targeting project context uses `PATCH /portfolio/projects/:projectId/tasks/:taskId`
        - Other contexts use `PATCH /tasks/:id`
    - PEOPLE section: Assignee, Requestor (`creator_id`), Viewers (multi-select via `UserMultiSelect` component)
    - TIME section: "Log Time" button above time spent display (hidden for Contract/OPEX/CAPEX tasks)
    - Components: `TaskSidebar.tsx`, `TaskActivity.tsx`, `TaskAttachments.tsx`, `TaskComments.tsx`, `UnifiedActivityForm.tsx`, `TaskHistory.tsx`, `TaskWorkLog.tsx`, `TaskLogTimeDialog.tsx`
    - Features: File attachments (drag-and-drop or browse, 20MB limit), time logging with hours/days, unified activity submit flow, comment edit capability (author-only), expanded change history, status validation (cannot mark "Done" without logged time for project tasks)
    - Task history refresh model: task mutations invalidate `task-activities` React Query cache (task save, unified submit, and time-entry mutations), so history updates live without full page reload
    - Task history preview model: comment entries are rendered as one-line plain-text previews (HTML stripped)
  - Create mode: Related object defaults to `Standalone`; users can switch to Project/OPEX/Contract/CAPEX. Classification fields are editable for standalone and project tasks during creation; for project tasks, classification defaults from the parent project.
  - Routes: `/portfolio/tasks` (list), `/portfolio/tasks/:id/:tab` (workspace with overview tab), `/portfolio/tasks/new/:tab` (create)
  - Permissions: `tasks:reader` (view), `tasks:member` (create/edit in non-project contexts), `portfolio_projects:contributor` (save when target context is project), `tasks:admin` (bulk delete)

### Account Menu
- Avatar menu in the AppBar provides quick access based on permissions:
  - Admin Console → `/admin` (visible if user can read any Admin resource)
  - Billing Center → `/admin/billing` (visible if user is Billing Admin)
  - Logout

### Navigation Drawer (Mini Variant)
- The left drawer supports a mini-variant for dense table workflows:
  - Toggle via the AppBar menu icon; state persists in `localStorage` under `navOpen`.
  - Collapsed mode shows only icons with tooltips; section titles are hidden; labels are not rendered to prevent overflow.
  - Drawer width animates between `240px` and `theme.spacing(7) + 1px`; paper uses `overflowX: 'hidden'` to avoid mini-mode x-scrollbars.
  - Implementation: `src/components/Layout.tsx` using MUI `Drawer`, `ListItemIcon`, `ListItemButton` with conditional layout.

## Shared Hooks

### useModuleItemNav
Generic hook for prev/next navigation within a workspace, fetching ordered IDs from the server.

**Location:** `frontend/src/hooks/useModuleItemNav.ts`

```typescript
interface ModuleItemNavConfig {
  endpoint: string;           // API endpoint (e.g., '/tasks/ids')
  queryKey: string;           // React Query cache key
  defaultSort: string;        // Default sort order (e.g., 'created_at:DESC')
  extraParams?: Record<string, string | number | undefined>;  // Static params
}

interface ModuleItemNavParams {
  id: string;                 // Current item ID
  sort?: string | null;       // Sort from URL
  q?: string | null;          // Search query from URL
  filters?: string | null;    // AG Grid filterModel JSON from URL
  year?: number | string | null;  // Optional year param
  statusScope?: string | null;    // Grid status scope (enabled | disabled | all), so prev/next walks the set on screen
  extraParams?: Record<string, string | number | undefined>;  // Dynamic params per invocation
}

interface ModuleItemNavResult {
  ids: string[];              // All IDs matching current filters
  index: number;              // Current item's position
  total: number;              // Total count
  hasPrev: boolean;
  hasNext: boolean;
  prevId: string | null;
  nextId: string | null;
}
```

**Module hooks** (one file per module in `hooks/use*Nav.ts`, most of them thin wrappers around `useModuleItemNav`):
- `useTaskNav` - Tasks (`/tasks/ids`)
- `useSpendNav` - OPEX items (`/spend-items/summary/ids`; its own query, prev/next returned as `OPX-N` references)
- `useCapexNav` - CAPEX items (`/capex-items/summary/ids`; its own query, prev/next returned as `CPX-N` references)
- `useContractNav` - Contracts (`/contracts/ids`)
- `useRequestNav` - Portfolio requests (`/portfolio/requests/ids`)
- `useProjectNav` - Portfolio projects (`/portfolio/projects/ids`)
- `useAssetNav` - Assets (`/assets/ids`)
- `useApplicationNav` - Applications (`/applications/ids`)
- `useCostCenterNav` - Cost centers (`/cost-centers/ids`, default sort `path:ASC`)
- `useWorkingDayCalendarNav` - Working-day calendars (`/working-day-profiles/ids`, default sort `name:ASC`)
- `useAnalyticsNav` - Analytics values (`/analytics-categories/ids`; pass the dimension as `extraParams: { axis_id }` so the walk stays in it). `useAnalyticsDimensionNav(id)` in the same file walks the dimensions in their order from `useAnalyticsAxes()`, with no request of its own.
- Plus: suppliers, companies, departments, accounts, template accounts, business processes

`useModuleItemNav.ts` itself only keeps the wrappers that have no file of their own: `useLocationItemNav`, `useConnectionItemNav`, `useInterfaceItemNav` and `useIncidentItemNav`.

**Usage with dynamic extraParams:**
```typescript
// Workspace page with scope filtering (e.g., TaskWorkspacePage.tsx)
const assigneeUserId = searchParams.get('assigneeUserId') || undefined;
const teamId = searchParams.get('teamId') || undefined;

const navExtraParams = useMemo(() => {
  const params: Record<string, string | undefined> = {};
  if (assigneeUserId) params.assigneeUserId = assigneeUserId;
  if (teamId) params.teamId = teamId;
  return Object.keys(params).length > 0 ? params : undefined;
}, [assigneeUserId, teamId]);

// Pass extraParams to hook - navigation respects scope filters
const nav = useTaskNav({ id, sort, q, filters, extraParams: navExtraParams });
const { hasPrev, hasNext, prevId, nextId, total, index } = nav;

// Navigate preserving all context
const confirmAndNavigate = (targetId: string | null) => {
  if (!targetId) return;
  navigate(`/portfolio/tasks/${targetId}/overview?${searchParams.toString()}`);
};
```

**Backend requirement:** The corresponding `/ids` endpoint must support the same filter params (assigneeUserId, teamId, etc.) to ensure prev/next navigation returns IDs within the same filtered set.

### useGridScopePreference
Persists the grid scope filter selection (my / team / all) per tenant and user.

**Location:** `frontend/src/hooks/useGridScopePreference.ts`

```typescript
function useGridScopePreference(
  pageKey: string,        // e.g. 'tasks', 'requests', 'projects', 'apps'
  urlScope: string | null // URL param value (takes priority over stored)
): [Scope, (scope: Scope) => void]
```

- localStorage key: `kanap-grid-scope:{tenantSlug}:{userId}:{pageKey}`
- Priority: URL param > localStorage > default (`'my'`)
- Automatically reloads from localStorage when tenant or user changes (follows `useRecentlyViewed` pattern)
- Pages should add a team-scope fallback guard to coerce `'team'` back to `'my'` when the user has no team:
  ```typescript
  useEffect(() => {
    if (scope === 'team' && isTeamConfigFetched && !hasTeam) {
      setScope('my');
    }
  }, [scope, isTeamConfigFetched, hasTeam, setScope]);
  ```
- Used on: Tasks, Requests, Projects, Apps & Services

### useVirtualRows
Virtual scrolling hook for large lists with consistent performance.

**Location:** `frontend/src/hooks/useVirtualRows.ts`

```typescript
interface VirtualRowsConfig<T> {
  items: T[];
  rowHeight: number;
  overscan?: number;      // Buffer rows (default: 3)
  threshold?: number;     // Min items before virtualizing (default: 25)
  maxVisibleRows?: number;
}

interface VirtualRowsResult<T> {
  containerRef: React.RefObject<HTMLDivElement>;
  virtualItems: Array<{ item: T; index: number; style: React.CSSProperties }>;
  visibleItems: T[];      // Currently visible items
  totalHeight: number;
  maxHeight: number;
  paddingTop: number;
  paddingBottom: number;
  onScroll: (event: React.UIEvent<HTMLDivElement>) => void;
  useVirtual: boolean;    // Whether virtualization is active
  startIndex: number;
  endIndex: number;
}

function useVirtualRows<T>(config: VirtualRowsConfig<T>): VirtualRowsResult<T>
```

**Usage:**
```typescript
const { containerRef, virtualItems, totalHeight, onScroll, useVirtual } = useVirtualRows({
  items: allItems,
  rowHeight: 48,
  overscan: 5,
});

return (
  <div ref={containerRef} onScroll={onScroll} style={{ height: 400, overflow: 'auto' }}>
    <div style={{ height: totalHeight, position: 'relative' }}>
      {virtualItems.map(({ item, index, style }) => (
        <div key={index} style={style}>{/* render item */}</div>
      ))}
    </div>
  </div>
);
```

### useBudgetColumns
The tenant's settings for the five budget columns: names, which columns are shown, which follow "Apply to all columns", and the default column.

**Location:** `frontend/src/hooks/useBudgetColumns.ts` (service `services/budgetColumns.ts`, `GET|PATCH /budget-columns`; query key `['budget-columns']`, 5 min `staleTime`; the settings page `/ops/operations/columns` writes the saved value into the cache).

```typescript
type BudgetColumns = {
  ready: boolean;                      // false until loaded; every field holds the product defaults meanwhile
  error: Error | null;                 // the setting could not be loaded: ready, with the product defaults (the settings page shows the error and edits nothing)
  settings: BudgetColumnsSettings;     // the raw setting (storage keys)
  all: BudgetColumnView[];             // five, fixed order: column 1 to 5
  shown: BudgetColumnView[];           // enabled, fixed order
  defaultColumn: BudgetColumnView;
  group: BudgetColumnView[];           // shown and following "Apply to all columns"
  displayDefaults: BudgetColumnView[]; // list columns visible by default: the default column, then the last shown one
  get(key: string): BudgetColumnView;  // storage, summary or freeze key; throws on anything else
  label(key: string): string;          // tenant name, else the translated product name
  defaultSort: string;                 // `y${defaultColumn.suffix}:DESC`
};
```

- `BudgetColumnView` extends one row of `AMOUNT_COLUMNS` (`components/finance/amountColumns.ts`), the single table of the five columns in fixed order with every key they have: storage key (`measure`), summary and copy/clear key (`key`), summary field suffix, freeze key and product label key.
- Screens iterate `shown` (or `all` where hidden columns matter, such as the freeze page), never a column name. A default derived from the setting (list sort, spread panel column, report column) follows `defaultColumn`; a screen whose first request depends on it waits for `ready`.
- Hidden columns are not built as list columns; a saved or linked sort or filter on one falls back to the defaults (`sortOnShownColumn`, `filtersOnShownColumns`, `settleListSearch` in `amountColumns.ts`). The OPEX and CAPEX lists mount their grid once the URL is settled, so the first request already uses the tenant's default sort.
- `resolveBudgetColumns(settings, t)` is the hook's pure core; tests mock `/budget-columns` or the hook.

### useCostCenterTree
The tenant's whole cost center tree, for item forms, lists and report filters.

**Location:** `frontend/src/hooks/useCostCenterTree.ts` (service `services/costCenters.ts`, `GET /cost-centers/tree`, readable with `cost_centers`, `opex`, `capex` or `reporting` reader; query key `['cost-centers', 'tree']`, 5 min `staleTime`; the Cost centers page and workspace invalidate it after every write).

```typescript
type CostCenterTree = {
  ready: boolean;                          // false until loaded, or while disabled (`useCostCenterTree({ enabled })`)
  nodes: CostCenterNode[];                 // tree order: each node after its parent, siblings by sort order then code
  byId: Map<string, CostCenterNode>;
  hasAny: boolean;                         // false for a tenant without a node (screens then hide cost center filters)
  isError: boolean;                        // the load failed: `nodes` is empty and proves nothing, so no empty state
  descendantIds(id: string): Set<string>;  // the node and everything below it, disabled nodes included
};
```

- A node carries `kind` (`group` | `cost_center`), `company_id`/`company_name` (cost centers only), `owner_user_id`/`owner_name`, `status`, `depth` (0 = root), `path` (names root to node, joined with ` › `) and `path_ids`.
- `buildCostCenterTree(nodes)` is the hook's pure core; tests mock the hook with it.

### useAnalyticsAxes
The tenant's analytics dimensions (storage word: axes), for item forms, lists, report filters and the Analytics dimensions page. A budget line holds at most one value per dimension.

**Location:** `frontend/src/hooks/useAnalyticsAxes.ts` (service `services/analytics.ts`, `GET /analytics-axes`, readable with `analytics`, `opex`, `capex` or `reporting` reader; query key `['analytics-axes']`, 5 min `staleTime`; the Analytics dimensions page and both workspaces invalidate it after every write).

```typescript
type AnalyticsAxes = {
  ready: boolean;                   // false until loaded, or while disabled (`useAnalyticsAxes({ enabled })`)
  isError: boolean;                 // the load failed: `axes` is empty and proves nothing
  axes: AnalyticsAxis[];            // every dimension, disabled ones included: sort order, then name, then code
  enabled: AnalyticsAxis[];         // enabled now (a future disable date still counts), in order: forms, lists, filters, reports
  byId: Map<string, AnalyticsAxis>;
  defaultAxis: AnalyticsAxis | null;
  label(axis): string;              // the name, or the translated "Analytics dimension" when it has none
};
```

- The default dimension (`is_default`) is an identity, never a position: the legacy `analytics_category_id` / `analytics_category_name` fields, the `analytics_category` CSV header and the AI `analytics_category` key address it, whatever its order or name. Its name may be null; every screen shows `label(axis)`, never `axis.name`.
- List and summary fields of the other dimensions are `analyticsFieldKey(axisId)` = `analytics_<axis id>` (no colon: sort strings are `field:DIR`). CSV headers and AI keys use `analytics:<code>`.
- Items read `analytics_values: ItemAnalyticsValue[]` and write `analytics_values: { [axisId]: valueId | null }` (omitted dimensions untouched, `null` clears); the frontend never sends the legacy field.
- `buildAnalyticsAxes(list, t)` is the hook's pure core; tests mock the hook with it. `analyticsAxisLabel(axis, t)` labels an axis-like object (`{ name }`) outside the hook.

### useWorkingDayProfiles
The tenant's working-day calendars (storage word: working-day profiles), for the budget tab's compute panel and the Working-day calendars page (`/master-data/working-day-calendars`, resource `working_day_profiles`, nav Master data → Finance). A calendar holds, per year, the working days of each month; a price per day multiplies them.

**Location:** `frontend/src/hooks/useWorkingDayProfiles.ts` (service `services/workingDayProfiles.ts`, `GET /working-day-profiles?limit=1000&includeDisabled=true&sort=name:ASC`, readable with `working_day_profiles`, `opex` or `capex` reader; query key `['working-day-profiles']`, 5 min `staleTime`; the calendars page and workspace invalidate it after every write).

```typescript
type WorkingDayProfiles = {
  ready: boolean;                          // false until loaded, or while disabled (`useWorkingDayProfiles({ enabled })`)
  isError: boolean;                        // the load failed: `profiles` is empty and proves nothing
  profiles: WorkingDayProfile[];           // every calendar, disabled ones included, by name then code
  enabled: WorkingDayProfile[];            // enabled now (a future disable date still counts): a new assignment offers these only
  byId: Map<string, WorkingDayProfile>;
};
```

- `days_by_year` is `{ "<year>": twelve decimal strings }` (January first, at most 6 decimals, none above the month's calendar days). `PATCH` merges it per year: a year sent replaces that year, `null` removes it.
- The workspace edits one year at a time (`pages/working-day-calendars/WorkingDayProfileEditor.tsx`): a year the calendar does not hold yet is written once its twelve months are filled (or copied from the year before), then each month autosaves on blur. Totals are summed exactly in millionths (`workingDayCalendarFields.ts`), never in binary floating point.
- `buildWorkingDayProfiles(list)` is the hook's pure core; tests mock the hook with it.

## Shared Components
- `FormModal` (`src/components/forms/FormModal.tsx`)
  - Replaces `FormDrawer` for create/edit forms, providing a centered modal overlay.
  - Props: `title`, `open`, `onClose`, `children`, `formId`, `disableSave`, `saving`, `fullWidth`, `maxWidth`.
  - Uses MUI Dialog for accessibility (focus trap, aria-labelledby) and consistent styling.
  - Recommended for all new create/edit forms to ensure a consistent user experience.
- `StatusLifecycleField` (`src/components/fields/StatusLifecycleField.tsx`)
  - Composite field exposing an Enabled toggle and a Disabled Date input.
  - The toggle is a convenience; the Disabled Date (`disabled_at`) is the source of truth.
  - Changing the date derives the status client-side and the backend persists both fields consistently.
- `CompanySelect` (`src/components/fields/CompanySelect.tsx`)
  - MUI Autocomplete (typable) for selecting companies in forms.
  - Fetches companies that are active as of “now” (derived from `disabled_at`) using TanStack Query; client-side filtering.
  - Shows a loading adornment while fetching; full-width, case-insensitive search.
- `DepartmentSelect` (`src/components/fields/DepartmentSelect.tsx`)
  - MUI Autocomplete (typable) scoped by `companyId`.
  - Fetches departments that are active as of "now" (derived from `disabled_at`); client-side filtering.
  - Auto-clears invalid values when the selected department doesn't belong to the current company.
- `CostCenterSelect` (`src/components/fields/CostCenterSelect.tsx`)
  - MUI Autocomplete over `useCostCenterTree()`, in tree order, each option indented by depth and labeled `code · name`.
  - Search matches code, name and path, and keeps the matches' ancestors, so typing a group name shows its descendants.
  - `selectable`: `cost_centers` (default, a line's assignment: groups are shown and not pickable, a disabled cost center is marked and pickable only when it is the current value), `all` (report filters: every node, groups and disabled ones included), `groups` (a node's parent; `excludeIds` removes its own subtree).
  - `onChange(id, node)`. When there is nothing to pick, one line "No cost center yet." links to `/master-data/cost-centers` for users with `cost_centers` member (the link reads `useAuth()`, only when that line renders).
- `AnalyticsCategorySelect` (`src/components/fields/AnalyticsCategorySelect.tsx`)
  - MUI Autocomplete over one dimension's values: `axisId` (required) loads `GET /analytics-categories?axis_id=…&limit=1000&sort=name:ASC` (enabled values, query key `['analytics-categories', 'axis', axisId]`).
  - A disabled current value is fetched by id and kept shown, marked Disabled; it cannot be picked anew because the list holds enabled values only.
  - Label: `label` when given, else the dimension's display name from `useAnalyticsAxes()` (loaded only in that case). With `hideLabel`, `label` still names the input for assistive technology.
- `FormattedNumberField` (`src/components/inputs/FormattedNumberField.tsx`)
  - Text field that groups thousands with spaces and reads a comma as the decimal point. A typed point and trailing zeros stay while typing (`1.` then `1.5`, `400.10`).
  - `decimals` (default 2, the budget amounts) caps the decimals kept while typing: quantities 3, unit prices and price indexes 4, working days 6.
  - `emit`: `'number'` (default) sends a JS number, or `''` when empty; `'string'` sends the cleaned decimal string (point separator, no group spaces, minus kept, `''` when empty), for values that must stay exact (quantities, prices, indexes, working days).
  - When the parent hands back the value the field just sent, the text stays as typed; any other value replaces it.
- `YearTabs` (`src/components/navigation/YearTabs.tsx`)
  - Year tabs with previous and next arrows (`currentYear`, `availableYears`, `onYearChange`, `disabled`); texts from `common:yearTabs.*`.
- `UserSelect` (`src/components/fields/UserSelect.tsx`)
  - MUI Autocomplete for selecting a single user; supports `size` prop for compact display.
  - Fetches enabled users, preloads missing selections by ID.
- `UserMultiSelect` (`src/components/fields/UserMultiSelect.tsx`)
  - MUI Autocomplete with `multiple` for selecting multiple users (e.g., Viewers field on tasks).
  - Returns array of user IDs; renders selected users as chips.
  - Supports `size` prop for compact display in sidebars.
- IT Ops helpers:
  - `ApplicationSelect` and `ServerSelect` provide searchable autocompletes that preload missing selections (fetch-by-id) so dialogs can show persisted values immediately.
  - `InstancesEditor`, `ServerAssignmentsEditor`, and `InterfaceBindingsMatrix` encapsulate the multi-row editors for the Application workspace (Instances/Servers tabs) and Interface bindings, emitting callbacks when edits complete so parents can refresh.

### Settings Components

**Location:** `frontend/src/components/settings/`

- `SettingsSection` - Collapsible accordion-based section wrapper with lazy rendering
  - Props: `title`, `description?`, `children`, `actions?`, `defaultExpanded?`
  - Defers rendering of collapsed sections until first expansion

- `SettingsControls` - Standard Add/Save/Reset button bar
  - Props: `onAdd?`, `onSave?`, `onReset?`, `addLabel?`, `saving?`, `dirty?`

- `SettingsGroup` - Container for organizing related settings sections

- `EnumEditor<T>` - Generic component for editing enum/lookup tables
  - Props: `title`, `description?`, `items`, `onChange`, `columns?`, `lockedCodes?`, `hideAddButton?`, `rowHeight?`
  - Supports customizable columns via `EnumEditorColumn` interface
  - Includes virtual scrolling via `useVirtualRows` hook
  - Pre-built specialized editors: `HostingTypeEditor`, `AssetKindEditor`

**Usage:**
```typescript
<SettingsSection title="Data Classes" description="Classification levels for data sensitivity">
  <EnumEditor
    title="Data Classes"
    items={dataClasses}
    onChange={handleChange}
    columns={[
      { key: 'code', header: 'Code', width: 120 },
      { key: 'name', header: 'Name', flex: 1 },
    ]}
  />
</SettingsSection>
```

### Workspace Components

**Location:** `frontend/src/components/workspace/`

- `WorkspaceLayout` - Reusable layout for workspace pages with vertical tabs
  - Props: `title`, `subtitle?`, `tabs`, `currentTab`, `onTabChange`, `actions?`, `sidebar?`, `error?`, `loading?`
  - Consistent layout pattern with tab navigation, title, and actions header
  - Support for optional sidebar area

- `WorkspaceActions` - Standard save/reset/close button group
  - Props: `onSave?`, `onReset?`, `onClose?`, `saving?`, `dirty?`, `disableSave?`

**Usage:**
```typescript
<WorkspaceLayout
  title={<>Interface: <strong>{data.name}</strong></>}
  subtitle={data.interface_id}
  tabs={[
    { id: 'overview', label: 'Overview', content: <OverviewTab /> },
    { id: 'technical', label: 'Technical', content: <TechnicalTab /> },
    // ...
  ]}
  currentTab={tab}
  onTabChange={setTab}
  actions={<WorkspaceActions onSave={handleSave} onClose={handleClose} dirty={isDirty} />}
/>
```

### Grid Cell Renderers

**Location:** `frontend/src/components/grid/renderers/`

Shared cell renderers for AG Grid consistency:

- `StatusCellRenderer` - Status badges with color coding
- `DateCellRenderer` - Formatted date display
- `UserCellRenderer` - User avatar and name
- `LinkCellRenderer` - Clickable links
- `ActionsCellRenderer` - Row action buttons
- `TagsCellRenderer` - Multiple tag chips
- `CurrencyCellRenderer` - Formatted currency values

### Type-Safe API Client

**Location:** `frontend/src/api/client.ts`

```typescript
class ApiClient {
  async get<T>(url: string, config?): Promise<T>
  async post<T, D = unknown>(url: string, data?: D, config?): Promise<T>
  async put<T, D = unknown>(url: string, data?: D, config?): Promise<T>
  async delete<T = void>(url: string, config?): Promise<T>
  async paginated<T>(url: string, params?): Promise<PaginatedResponse<T>>
}

export const api = new ApiClient('/api');
```

**Typed Endpoint Definitions:** `frontend/src/api/endpoints/`

```typescript
// applications.ts
export const applicationsApi = {
  list: (params?) => api.paginated<Application>('/applications', params),
  get: (id: string) => api.get<Application>(`/applications/${id}`),
  create: (data: CreateApplication) => api.post<Application>('/applications', data),
  update: (id: string, data: UpdateApplication) => api.put<Application>(`/applications/${id}`, data),
  delete: (id: string) => api.delete(`/applications/${id}`),
};
```
- `PageHeader` (`src/components/PageHeader.tsx`)
  - Shows route-derived breadcrumbs (always starts at Dashboard) and a page title
  - Accepts `actions` (ReactNode) for right-aligned primary actions
  - Admin pages show a small "Admin" chip for context
  - "Manage in Admin" deep links: operational forms (e.g., OPEX, Contracts) may show buttons linking to the corresponding Admin pages when the user has `reader` for that resource
  - Wraps on narrow widths (`flexWrap: 'wrap'`) so action buttons remain visible without expanding the page width
- `ServerDataGrid` (`src/components/ServerDataGrid.tsx`)
    - Props: `columns` (AG `ColDef[]`), `endpoint`, `queryKey`, `getRowId?`, `cacheBlockSize?`, `enablePagination?`, `paginationPageSize?`, `enableSearch?`, `defaultSort?`, `extraParams?`, `refreshKey?`, `initialState?`, `enableColumnChooser?`, `requiredColumns?`, `defaultHiddenColumns?`, `columnPreferencesKey?`, `onColumnStateChange?`, `onCellClicked?`
    - URL sync: `?sort` only (field:ASC|DESC). Filters are not URL‑synced.
    - Server contract: `{ items, total, page, limit }` with `sort` and optional `filters` (AG Grid filterModel JSON)
    - DefaultColDef: `sortable: true`, `filter: true`, `floatingFilter: true`, `filterParams` = single‑condition (no AND/OR) with options: contains, notContains, equals, notEqual, startsWith, endsWith, blank, notBlank.
    - Supports infinite scrolling and optional paginated mode, both backed by server requests. Sort/filter/search changes reset and refetch data (and reset page index when pagination is enabled).
    - Column state persistence: When `columnPreferencesKey` is set, column visibility/width/order/pinning are saved to localStorage scoped per tenant and user (`grid-columns:{tenantSlug}:{userId}:{pageKey}`). Column state is automatically re-applied when the user or tenant changes. Legacy unscoped keys are migrated on first load. All 22 grid pages benefit from this scoping.
    - Closed-choice filters: use `CheckboxSetFilter` + `CheckboxSetFloatingFilter` for finite choice columns (Status, Type, Category, Stream, Company).
      - Default state is "implicit All": all values selected and the filter is unfiltered.
      - Emits Set filter models: `{ filterType: 'set', values: [...] }` (empty array = match nothing; no model = unfiltered).
      - Floating filter shows `All`, `None`, or `N selected` and includes an **x** to clear the filter without opening the list.
      - Use `treatAllAsUnfiltered: false` for default-filtered columns (e.g., lifecycle/status default hides Retired/Done) so "All" stays active.
      - `ServerDataGrid` exposes `context.getQueryState()` (q, filterModel, extraParams) so filters can request scoped values from a `filter-values` endpoint.

## Modal UX
- Save on Enter: All form modals listen for Enter and submit the associated form (`formId`).
  - Plain Enter submits unless a dropdown/menu is open.
  - In multiline fields, Enter inserts a newline; Ctrl/Cmd+Enter submits.
  - Implemented centrally in `FormModal` via `onKeyDown` to keep behavior consistent across modals.
- Typable dropdowns: All dropdowns within modals are typable with MUI `Autocomplete`.
  - Enum-like fields use `EnumAutocomplete` to present a fixed option list (no free text).
  - Data selects (Company, Department, Account, Supplier, User, Role) are Autocompletes with client-side filter and loading adorners.
- Forms: Each modal wraps fields in a `<form id=...>` and uses the Save button with `type=submit` + `form={formId}`.
- Escape closes via MUI Dialog defaults; focus is trapped while open.

## Global Quick Filter
- `ServerDataGrid` exposes a quick filter input when `enableSearch` is true (default).
  - Input is debounced (400ms), synced to URL as `?q=...`, and sent to the server with each data request.
  - Works alongside per-column filters (AG Grid `filterModel`), which are also sent in `filters`.
- Backend pattern:
  - Simple list endpoints: apply `q` as a case-insensitive search across relevant text fields using OR (and combine with column filters via AND).
  - Summary/derived endpoints (e.g., OPEX summary): fetch the base rows, compute derived fields, then apply `q` in-memory across both base and derived/display fields (supplier/account labels, latest contract/task text, allocation labels, etc.).
  - When `q` is present and DB sort cannot apply across derived fields, perform in-memory sort + pagination after filtering to preserve correct UX.
- Example: OPEX summary (`backend/src/spend/spend-items.service.ts`)
  - Does not restrict the DB query by `q`; instead, builds a rich row with derived fields (supplier/account display, version totals, allocation method label, latest task).
  - Applies in-memory quick search across those fields; if DB-level sort isn’t safe, sorts and paginates in-memory.

### Contracts UX specifics
- Contracts grid default sort by Cancel-by (ascending). Columns include derived `End` and `Cancel by`, `Linked OPEX` count, Task summary, and standard fields.
- Deep-link: opening `/contracts?open=<id>` opens the edit modal for that contract and clears the query param when closed.
- OPEX grid shows a `Contract` column displaying the most recently linked contract name. Clicking it navigates to `/contracts?open=<id>`.

## Reporting UI

- Location: `src/pages/reports/*`
- Shared components:
  - `components/reports/ReportLayout.tsx`: breadcrumbs back to `/reports`, filter/action toolbar, CSV/PNG export triggers, and `.report-print-frame` wrapper for print­-only output.
  - `components/reports/ChartCard.tsx`: AG Charts React wrapper exposing `download()` with canvas fallback for PNG export.
- Data access (Phase 1): `pages/reports/useOpexSummary.ts` implements `useOpexSummaryAll(years?)` (loads all pages from `/spend-items/summary?years=...`; no hardcoded status param). `pickYearSlot(row, year)` retrieves year-specific data using dynamic keys (e.g., `y2024`) with legacy key fallback.
- Styling: `src/styles/print.css` ensures the report content prints without the app shell.
- Layout convention: single column; chart (full width) first, then table (full width).
- Charts: AG Charts CE; pie (Top‑N distributions, label threshold 5%) or line (trends/comparisons) with consistent tooltips/footnotes.
- Tables: AG Grid, pinned bottom rows for totals; pinned data is never included in charts.

### Built-in Reports (selection)
- Budget Trend (OPEX): `ComparisonReport.tsx` — multi-metric line chart across years.
- Budget Trend (CAPEX): `CapexBudgetTrendReport.tsx` — same logic as OPEX, backed by CAPEX summary.
- Budget Column Comparison: `BudgetColumnsCompareReport.tsx` — compare up to ten year+column totals for either OPEX or CAPEX; includes a Year grouping toggle to pivot by year and render one series per column when each selected column spans at least two distinct years.

### Viewport Containment & Scrolling
- Goal: The entire page (AppBar, left drawer, breadcrumbs, header actions, and grid) remains within the browser viewport; only the grid scrolls.
- Implementation details:
  - The main content area (`Layout` → `<Box component="main">`) uses `display: 'flex'`, `flexDirection: 'column'`, and `minWidth: 0` so content cannot widen the page.
  - `ServerDataGrid` measures available viewport height using `getBoundingClientRect()` on the grid container and sets its height dynamically. This prevents page-level vertical scrolling.
  - The grid container sets `overflow: 'hidden'`; AG Grid handles vertical scrolling internally.
  - For wide tables, an auxiliary horizontal scrollbar can be rendered sticky at the bottom of the visible grid area (not at the page bottom), synchronized with the grid’s native horizontal scroll.
  - In paginated mode, the auxiliary scrollbar is suppressed to avoid duplicate horizontal bars (native AG Grid scrollbar remains).
  - The grid container reserves 14px bottom padding only when the auxiliary scroller is enabled.
  - On resize/orientation changes, the component re-measures height and recalculates the horizontal scrollbar width.

Developer notes:
- Avoid adding page-level `overflow` rules that hide overflowing content globally; keep containment local to the grid.
- When adding new header actions, rely on `PageHeader`’s wrapping to keep actions visible instead of forcing horizontal expansion.
- Query Provider
  - `src/lib/queryClient.tsx` wraps the app with `QueryClientProvider` and enables React Query DevTools

## Guidelines for New Pages
- Use `PageHeader` at the top of every screen; place primary CTA(s) in the `actions` slot
- Use `ServerDataGrid` for list views; wire `endpoint` and `queryKey`, provide AG Grid column definitions; rely on built‑in sort URL sync; use floating filters for column filtering.
- For detail/edit views, keep route structure shallow and reflect hierarchy in breadcrumbs (e.g., `/opex/:itemId`, `/opex/:itemId/versions/:versionId`)
- Use TanStack Query `useQuery`/`useMutation` for data access; invalidate lists on create/update/delete
- Keep sort param as `field:direction` to match backend’s `parsePagination`. Filters are passed as `filters` (JSON filterModel).
- Prefer module pages under Budget Management; gather catalog CRUD under an Admin hub when the time comes

## OPEX Workspace Pattern
- Pattern: Single `ServerDataGrid` list with derived columns. Clicking any row/column deep-links into the spend workspace (`/ops/opex/:id/:tab`) which hosts dedicated editors for overview, budget, allocations, tasks, and relations.
- Workspace shell (`frontend/src/pages/opex/SpendItemPage.tsx`):
  - Persists list context (`sort`, `q`, `filters`) in the URL so closing returns users to the same grid state.
  - Exposes explicit Save/Reset buttons, dirty guards on tab changes, prev/next navigation, and year switching for budget/allocations.
  - Create route (`/ops/opex/new`) loads the same shell with only the Overview tab enabled until the item is saved.
- Derived columns surfaced in the grid mirror the workspace tabs (allocation label, budget totals, latest task, spread mode, etc.) so navigation stays consistent.
- Year semantics: one version per item per `budget_year`. Freeze state still gates editing—frozen scopes render read-only regardless of user level.
- Editors:
  - Overview (edit/create) handle core fields and linked contracts.
  - Budget editor toggles between flat (annual) and manual (monthly) entry and drives `/spend-versions/:id/amounts`.
  - Allocation editor manages drivers/modes and bulk upserts `/spend-versions/:id/allocations`.
  - Tasks panel edits the latest task while showing history.
  - Relations panel patches project IDs and contract links.

### CAPEX Workspace Pattern
- CAPEX list (`frontend/src/pages/CapexPage.tsx`) follows the same navigation scheme. Row clicks route to `/ops/capex/:id/:tab` for overview, budget, and allocations editors implemented under `frontend/src/pages/capex/editors/*`.
- The shell mirrors OPEX behaviour (explicit save/reset, dirty guards, year switching). Allocation logic aligns with OPEX but targets `/capex-versions/:id/allocations`.

### Allocation Editor Behavior
- Supported methods: `default`, `headcount`, `it_users`, `turnover`, `manual_company`, `manual_department`.
- Auto methods (default/headcount/it_users/turnover):
  - Render read-only distributions based on latest metrics; saving validates coverage and clears stale rows.
  - Errors if metrics are missing or sum to zero for the chosen driver.
- Manual by Company:
  - Prefills enabled companies ordered by allocation desc when no rows exist.
  - Driver changes recompute percentages; manual edits persist without auto-overwrite.
- Manual by Department:
  - Requires explicit `{company, department}` rows; headcount metrics drive recomputation.
  - Errors when headcount data is missing or zero.
- Allocation editor enforces totals ≈ 100 % and keeps initialisation flags so opening the workspace never mutates existing allocations.

## Critical Workspace Implementation Patterns

### Editor Save Function Dependencies
When using `useImperativeHandle` to expose save/reset functions:
- **Always include the `save` function in the dependency array** if defined separately
- Omitting `save` from deps causes stale closures that capture old state
- Symptom: Rapid typing saves only the first character instead of full text
- See `doc/spend-workspace.md` "Editor Implementation Patterns" for detailed examples

### Allocation Prefill Race Conditions
Manual allocation modes auto-prefill companies when rows are empty:
- **Reset prefill flag at START of load()**, not end
- **Guard prefill effect with `!loading`** condition
- Without guards, prefill overwrites loaded data on first render
- Symptom: Direct navigation to Allocations tab shows "all companies" instead of saved selection
- Both OPEX and CAPEX AllocationEditor implementations include these guards

### Grid Navigation to Workspace Tabs
List grids use `onCellClicked` to route to specific tabs:
- Allocation columns → `allocations` tab with year parameter
- Budget columns → `budget` tab with year parameter
- Other columns → `overview` tab (default)
- Both OPEX (`OpexListPage.tsx`) and CAPEX (`CapexPage.tsx`) implement this pattern

## References
- Layout: `src/components/Layout.tsx`
- Routing: `src/App.tsx`
- Data: `src/api.ts`, `src/lib/queryClient.tsx`
- Lists: `src/components/ServerDataGrid.tsx`
- Headers: `src/components/PageHeader.tsx`
- Workspace patterns: `doc/spend-workspace.md`

## New Page Checklist
- Route: Registered under `Layout` and correct module group (Budget Management/Admin).
- PageHeader: Present with correct title; breadcrumbs reflect route; actions in the right slot.
- List views: Use `ServerDataGrid` with stable `queryKey`, proper `endpoint`, and `getRowId`; default sort set; URL sync for `sort` works; floating filters behave per AG docs.
- Data fetching: Queries/mutations via TanStack Query; invalidates the right keys after writes; consider optimistic updates where safe.
- States: Consistent loading/empty/error handling; user-friendly messages.
- RBAC: Gate route access and actions by per‑page permission level (`reader|manager|admin`) via claims from `/auth/me`.
- Performance: Sensible page sizes; avoid unnecessary re-renders.
- Accessibility: Labels, focus order, keyboard navigation; contrast for actions.
- Responsive: Works with permanent drawer; grid height uses a flexible/viewport-based layout.
- Docs: Update step guide, testing strategy, and any relevant section in `doc/` when adding new pages/actions.

## Auth & Claims
- After login, the app calls `GET /auth/me` to load:
  - `profile` (id, email, name, status)
  - `claims` (global/billing admin flags and per‑resource permission levels)
  - `subscription` (plan and seats)
- `ProtectedRoute` shows a 403 page if the user lacks the required level for a route.
- UI actions are hidden or disabled based on the current user’s level for the page.
- Action gating conventions:
  - `reader`: can view
  - `manager`: can create/update (Save buttons active)
  - `admin`: can delete and import/export CSV


### Allocations Modal Behavior
- Methods stored on `spend_versions.allocation_method`:
  - `default|headcount|it_users|turnover|manual_company|manual_department`
- Auto methods (default/headcount/it_users/turnover):
  - Modal shows a read-only distribution sourced from the latest company metrics; no rows are stored when saved
  - Saving simply validates metric coverage for the selected driver and clears any legacy system-generated rows
  - Errors when metrics are missing or sum to 0 for the selected driver
- Manual by Company:
  - Single control “Allocate by” (Headcount default; IT users, Turnover options) and a “Reset” action
  - On entry, auto‑prefills all enabled companies ordered by allocation desc
  - Remove row / change company → recalculates immediately using current driver and re‑orders rows
  - Add row → recalculates after company selection; manual edits of % do not auto‑recalc
- Manual by Department:
  - No prefill; user adds department rows one by one
  - Auto‑recalc on add/remove/department change using department headcount (year‑specific); errors when headcount missing or sum=0
