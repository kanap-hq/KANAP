Title: Contracts Workspace and Unified Tasks

**Note**: For workspace implementation patterns (RLS, tenant deletion, lifecycle management, editor patterns), see **[`workspace-patterns.md`](workspace-patterns.md)**. This document covers Contracts-specific details only.

Overview
- The contract page uses the shared workspace shell (`PortfolioDetailWorkspaceShell`), like the company and budget line pages: back link to the list, previous / next within the list context, click-to-edit title, metadata bar (supplier, contracting company, owner, status), properties panel (`kanap.contracts.drawerOpen`).
- Tabs: Overview, Budget, Relations. The former Details and Tasks addresses (`/ops/contracts/:id/details`, `/tasks`) redirect to the overview.
- Contracts have no business reference (`item_number`): the title carries none.
- Tasks are unified across OPEX, CAPEX and Contracts via a single backend table and API, while preserving the existing route shapes for object-scoped CRUD.

Routes
- SPA routes
  - List: `/ops/contracts`
  - Workspace: `/ops/contracts/:id/:tab` where `:tab` ∈ { overview, budget, relations }
  - Create: `/ops/contracts/new/overview`
- Backend endpoints
  - Contracts IDs navigation: `GET /contracts/ids` (supports `sort`, `q`, AG Grid `filters`, derived sorts for `end_date` and `cancellation_deadline`).
  - Detail: `GET /contracts/:id` with the term fields and the supplier, company and owner names; `PATCH /contracts/:id` takes any subset of the fields (autosave).
  - Relations from the contract side (`backend/src/contracts/contract-relations.ts`): `GET|POST bulk-replace /contracts/:id/budget-lines` (both natures), `/applications`, `/assets`, and `GET /contracts/:id/relation-counts` for the tab badges. See `doc/api-reference.md`, Contract relations.
  - Unified tasks (object-scoped): `GET|POST|PATCH /contracts/:id/tasks` → delegates to unified tasks.
  - URLs: `GET|POST /contracts/:id/links`, `PATCH|DELETE /contracts/:id/links/:linkId`. Attachments: `GET|POST /contracts/:id/attachments`, download `GET /contracts/attachments/:attachmentId`, delete `PATCH /contracts/attachments/:attachmentId/delete`.

Frontend (`frontend/src/pages/contracts/`)
- `ContractWorkspacePage.tsx`: the page, its autosave and the create form. Every edit of an existing contract saves itself through a patch buffer and `useAutosave` (selects, dates and pickers at once; typed numbers and the notes after a pause; the title on blur). Contracts have no edit-conflict check (no `row_version`): the last save wins. Pending edits are flushed before a tab change, previous / next or closing.
- `workspace/ContractPropertiesDrawer.tsx`: supplier, contracting company, owner; start, duration, notice, tacit renewal; yearly amount (two decimals), currency (the tenant's currencies), billing; lifecycle (status, end of validity), created, updated.
- `contractSchedule.ts` + `workspace/ContractDeadlines.tsx`: the deadline state ("Cancellation possible until…", "Notice passed, renewed until…", "Ends on… without renewal", "Ended on…"), the timeline of the terms (past terms, current term, next term dashed while it can be cancelled, today, next deadline and the decision window) and the facts line. Built on `contractTerms.ts`, the frontend copy of `backend/src/contracts/contract-terms.ts`, so the page recomputes while the dates are edited. `DECISION_WINDOW_DAYS` (90) is a constant until a tenant setting replaces it.
- Overview: deadlines, open tasks (`components/EntityTasksSection.tsx`, completed ones on demand), notes (Markdown editor, toolbar on focus).
- `workspace/ContractBudgetTab.tsx`: linked budget lines of both natures (reference, name, type, company) and the single `BudgetLinesRelationField` picker. No amounts or years yet.
- `workspace/ContractRelationsTab.tsx`: applications and assets pickers (`components/workspace/RelationLookupPicker.tsx`, searching through the `/applications` and `/assets` lists so their access rules apply), contacts (with "Add the supplier's contacts"), relevant websites, attachments as a list with an "Add files" button and drop on the section.

Unified Tasks Model
- Table: `tasks`
  - Columns: id (uuid), tenant_id (uuid), title (text, required), description (text, nullable), status, due_date (date, nullable), assignee_user_id (uuid, nullable), related_object_type, related_object_id (uuid), created_at, updated_at.
  - RLS: Enabled with tenant isolation policy.

Navigation
- The contracts list passes its context (sort, q, filters, scope) when opening a row. Prev/Next pulls from `GET /contracts/ids` with the same semantics as the list; every address of the page keeps that context.
- A task created from the contract page returns to the contract's overview (`pages/tasks/taskWorkspaceOrigin.ts`).

Testing Checklist
- `frontend/src/pages/contracts/*.test.ts(x)`: page rendering, tabs, autosave, creation, former addresses, the schedule cases and the amount parsing.
- `backend/src/contracts/__tests__/contract-relations.integration.spec.ts`: relations of both natures, applications, assets, refusals across tenants.
