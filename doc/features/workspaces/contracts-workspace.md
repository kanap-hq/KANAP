Title: Contracts Workspace and Unified Tasks

**⚠️ Note**: For comprehensive workspace implementation patterns (RLS, tenant deletion, lifecycle management, editor patterns), see **[`workspace-patterns.md`](workspace-patterns.md)**. This document covers Contracts-specific details only.

Overview
- The Contracts modal has been replaced by a workspace page with vertical tabs, following the same UX pattern as Companies and OPEX.
- Tabs: overview, details, relations, tasks. The Details tab is available during creation.
- Tasks are now unified across OPEX and Contracts via a single backend table and API, while preserving the existing route shapes for object‑scoped CRUD.

Routes
- SPA routes
  - List: `/ops/contracts`
  - Workspace: `/ops/contracts/:id/:tab?` where `:tab` ∈ { overview, details, relations, tasks }
  - Create: `/ops/contracts/new/overview`
- Backend endpoints
  - Contracts IDs navigation: `GET /contracts/ids` (supports `sort`, `q`, AG Grid `filters`, derived sorts for `end_date`, `cancellation_deadline` and `next_due_date`, the default).
  - Contract URLs deletion: `DELETE /contracts/:id/links/:linkId` (audit + ownership enforcement).
  - Unified tasks (object‑scoped):
    - Spend item tasks: `GET|POST|PATCH /spend-items/:id/tasks` → delegates to unified tasks
    - Contract tasks: `GET|POST|PATCH /contracts/:id/tasks` → delegates to unified tasks
  - Tasks aggregator: `GET /tasks` now reads from the unified `tasks` table and joins onto `spend_items` or `contracts` for `related_object_name`.
  - Relations (links):
    - OPEX links: `GET /contracts/:id/spend-items`, `POST /contracts/:id/spend-items/bulk-replace`
    - CAPEX links: `GET /contracts/:id/capex-items`, `POST /contracts/:id/capex-items/bulk-replace`

Unified Tasks Model
- Table: `tasks`
  - Columns: id (uuid), tenant_id (uuid), title (text, required), description (text, nullable), status (open|in_progress|done|cancelled), due_date (date, nullable), assignee_user_id (uuid, nullable), related_object_type ('spend_item' | 'contract'), related_object_id (uuid), created_at, updated_at.
  - Indexes: (tenant_id, related_object_type, related_object_id), (tenant_id, status), (tenant_id, assignee_user_id), (tenant_id, due_date)
  - RLS: Enabled with tenant isolation policy
- Backwards compatibility
  - Existing spend/contract task endpoints are preserved and internally switch to the unified service.
  - Audit keeps legacy table names for create/update records during the transition.

Frontend Editors
- Overview editor: Name, Supplier, Contracting Company, Owner, Enabled/Disabled date, Notes.
- Details editor: Start Date, Duration (months), Notice (months), Yearly amount, Currency, Billing frequency, Auto‑renewal. The current term end and the next cancellation deadline update live (`pages/contracts/contractTerms.ts`, the frontend copy of `backend/src/contracts/contract-terms.ts`), tacit renewals and the end of validity included.
- Relations editor: Linked OPEX multi‑select, Linked CAPEX multi‑select, Link Manager modal shortcut, Websites CRUD (create/update/delete), Attachments upload/list/download/delete.
- Tasks panel: Same UX as OPEX; statuses are open|in_progress|done|cancelled; Title required.

Navigation
- Contracts list preserves context (sort/q/filters) when opening a row in the workspace. Prev/Next pulls from `GET /contracts/ids` and respects the same sort/filter/search semantics as the list.

Cleanup Notes
- Legacy spend and contract task entities were removed from the codebase. The unified tasks table backs all task operations.
- The Contracts list “open modal by query param” flow has been replaced by workspace navigation.

Testing Checklist
- Run migrations and verify `tasks` table RLS.
- Create/edit tasks on both spend items and contracts via their scoped routes.
- Verify `/tasks` lists both types with filters and quick search.
- Verify `/contracts/ids` respects filters, `q`, and derived sorts.
- Exercise Relations editor (linked OPEX, websites CRUD, attachments) and Tasks panel under contracts.
