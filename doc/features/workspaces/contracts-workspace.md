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
  - Contracts IDs navigation: `GET /contracts/ids` (supports `sort`, `q`, AG Grid `filters`, derived sorts for `end_date`, `cancellation_deadline` and `next_due_date`, the default).
  - Detail: `GET /contracts/:id` with the term fields and the supplier, company and owner names; `PATCH /contracts/:id` takes any subset of the fields (autosave).
  - Relations from the contract side (`backend/src/contracts/contract-relations.ts`): `GET|POST bulk-replace /contracts/:id/budget-lines` (both natures), `/applications`, `/assets`, and `GET /contracts/:id/relation-counts` for the tab badges. See `doc/api-reference.md`, Contract relations.
  - Budget figures (`backend/src/contracts/contract-budget.ts`): `GET /contracts/:id/budget?year&column` for the Budget tab; `budget_year` and `budget_column` on `GET /contracts`, `/contracts/ids` and `/contracts/totals` for the list's budget columns. Both need the `budget` reader right too.
  - Unified tasks (object-scoped): `GET|POST|PATCH /contracts/:id/tasks` → delegates to unified tasks.
  - URLs: `GET|POST /contracts/:id/links`, `PATCH|DELETE /contracts/:id/links/:linkId`. Attachments: `GET|POST /contracts/:id/attachments`, download `GET /contracts/attachments/:attachmentId`, delete `PATCH /contracts/attachments/:attachmentId/delete`.

Frontend (`frontend/src/pages/contracts/`)
- `ContractWorkspacePage.tsx`: the page, its autosave and the create form. Every edit of an existing contract saves itself through a patch buffer and `useAutosave` (selects, dates and pickers at once; typed numbers and the notes after a pause; the title on blur). Contracts have no edit-conflict check (no `row_version`): the last save wins. Pending edits are flushed before a tab change, previous / next or closing.
- `workspace/ContractPropertiesDrawer.tsx`: supplier, contracting company, owner; start, duration, notice, tacit renewal; yearly amount (two decimals), currency (the tenant's currencies), billing; lifecycle (status, end of validity), created, updated.
- `contractSchedule.ts` + `workspace/ContractDeadlines.tsx`: the deadline state ("Cancellation possible until…", "Notice passed, renewed until…", "Ends on… without renewal", "Ended on…"), the timeline of the terms (past terms, current term, next term dashed while it can be cancelled, today, next deadline and the decision window) and the facts line. Built on `contractTerms.ts`, the frontend copy of `backend/src/contracts/contract-terms.ts`, so the page recomputes while the dates are edited. The decision window is the tenant's setting, which comes with the contract (`decision_window_days`); `DECISION_WINDOW_DAYS` (90) only stands in while it loads.
- `workspace/ContractRenewalDecision.tsx`: the renewal decision box under the deadlines (`GET /contracts/:id/renewal`), shown while a decision is awaited and, once taken, as one line until the term ends. Three actions for a contract editor (renew, renegotiate, terminate with its consequences confirmed in the box) and the undoing while the deadline has not passed. Rule in `doc/architecture.md`, Contract Renewal Decision.
- `workspace/ContractStopRenewalDialog.tsx`: "No" in the renewal field of a contract already renewed, or awaiting a renewal decision, asks first and ends it on the day chosen (`POST /contracts/:id/renewal/stop`; a termination while a decision is awaited); the field keeps "Yes". A contract in its first term with no decision awaited turns its renewal off at once.
- `workspace/ContractEndChoice.tsx`: the end of a termination or of that confirmation: the earliest end the notice allows (`proposed_end_date`), a date field from today and the start, an orange warning before the proposed day, and the consequences for the day chosen (`GET /contracts/:id/renewal?end_date=`). A renewal decided for the term of the next deadline shows on the timeline as "Renewal confirmed · next term from … to …", without that deadline (`confirmedRenewalOf`, from the box's query).
- Overview: deadlines, open tasks (`components/EntityTasksSection.tsx`, completed ones on demand), notes (Markdown editor, toolbar on focus).
- `workspace/ContractBudgetTab.tsx`: linked budget lines of both natures (reference, name, type, company) and the single `BudgetLinesRelationField` picker. For a reader of the budget: year tabs and a column selector (the tenant's shown columns, by name), each line's amount in that year and column with a "Total (n lines)" row, then "Commitment and coverage": one row per year of the selector (committed by the contract, linked lines, gap, state as a dot and a text, colors `CONTRACT_BUDGET_STATE_COLORS`), the chosen year marked, a row click choosing its year, and a sentence on how the commitment is computed. The figures follow the contract's edits (their query key carries `updated_at`) and its link changes.
- `contractBudget.ts`: the coverage types, `useContractBudgetChoice` (the year and column, kept per tenant and user in `localStorage` under `kanap-contract-budget:<tenant>:<user>`, next year and the tenant's default column until the user picks others; shared with the list) and `ContractBudgetStateLabel.tsx`.
- The list (`pages/ContractsPage.tsx`): "Budget" year and column selectors in the grid's toolbar, columns "Committed <year>", "Budget <year>", "Gap" (sorted and filtered on the server) and "Budget coverage" (hidden by default), quick filters "No budget line (n)" and "Under-budgeted (n)" on the coverage state beside "To decide within <n> days" (the tenant's window, from `GET /contracts/totals`; contract admins set it in the list's "Settings" dialog, `ContractSettingsDialog.tsx`), and the totals row summing the three amounts. Hidden to a user without the budget reader right.
- `workspace/ContractRelationsTab.tsx`: applications and assets pickers (`components/workspace/RelationLookupPicker.tsx`, searching through the `/applications` and `/assets` lists so their access rules apply), contacts (with "Add the supplier's contacts"), relevant websites, attachments as a list with an "Add files" button and drop on the section.

Unified Tasks Model
- Table: `tasks`
  - Columns: id (uuid), tenant_id (uuid), title (text, required), description (text, nullable), status, due_date (date, nullable), assignee_user_id (uuid, nullable), related_object_type, related_object_id (uuid), created_at, updated_at.
  - RLS: Enabled with tenant isolation policy.

Navigation
- The contracts list passes its context (sort, q, filters, scope, and the budget year and column of its budget columns) when opening a row. Prev/Next pulls from `GET /contracts/ids` with the same semantics as the list; every address of the page keeps that context.
- A task created from the contract page returns to the contract's overview (`pages/tasks/taskWorkspaceOrigin.ts`).

Testing Checklist
- `frontend/src/pages/contracts/*.test.ts(x)`: page rendering, tabs, autosave, creation, former addresses, the schedule cases and the amount parsing.
- `backend/src/contracts/__tests__/contract-relations.integration.spec.ts`: relations of both natures, applications, assets, refusals across tenants.
- `backend/src/contracts/__tests__/contract-budget.integration.spec.ts` and the commitment cases of `contract-terms.spec.ts` / `contract-terms.parity.spec.ts`: commitments, budget coverage, the list's budget columns and totals, the Budget tab's figures.
