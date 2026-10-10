# Budget Management Dashboard (Frontend)

Last updated: 2025-11-04

This page documents the Budget Management Dashboard (route: `/`) so maintainers can evolve tiles, endpoints, and UX consistently.

## Purpose

Provide an at-a-glance, actionable home for Budget Management users with consistent, professional tiles that load quickly and link to the deeper workspaces (OPEX, CAPEX, Contracts, Tasks, Reports).

## Tiles & Behavior

- OPEX Snapshot (table)
  - Three rows: `Y-1`, `Y`, `Y+1`.
  - Columns shown only if non-zero across all three years; order: Budget, Revision, Follow‑up, Landing.
  - Center-aligned numbers, rounded to nearest thousand, displayed with a `k` suffix (e.g., `7 846k`).
  - Click: navigates to OPEX list.

- CAPEX Snapshot (table)
  - Identical structure and formatting to OPEX Snapshot; uses the same column union so both tables align.
  - Click: navigates to CAPEX list.

- My Tasks
  - Shows a big count (assigned to current user; excludes `done`), plus the 5 tasks with nearest due date (overdue included). Tasks without due date are omitted.
  - Click: navigates to Tasks.

- Next Renewals
  - Shows the 5 upcoming contract cancellation deadlines (future only).
  - Click: navigates to Contracts.

- Data Hygiene (OPEX)
  - Chips show counts for:
    - No IT owner
    - No Business owner
    - No Paying Company
    - CoA mismatches (account belongs to a different Chart of Accounts than the paying company)
  - Counts computed via summary endpoint totals (fast `limit=1` queries). Future: deep-link chips to prefiltered OPEX list.

- Quick Actions
  - Buttons: `New OPEX` (opex:manager), `New CAPEX` (capex:manager).
  - Recent OPEX updates: last 5 items by `updated_at`.

- Insights
  - Top OPEX (Y): top 5 by current year budget (rounded to `k`).
  - Top increases (Y vs Y-1): top 5 largest deltas (rounded to `k`). Click “Open” to reach full reports.

## Data Sources (API)

- OPEX totals: `GET /spend-items/summary/totals`
- CAPEX totals: `GET /capex-items/summary/totals`
- My tasks: `GET /tasks` with filters: `assignee_user_id = me`, `status notContains 'done'`, `due_date notBlank`, `sort=due_date:ASC`, `limit=5`
- Renewals: `GET /contracts` with `cancellation_deadline notBlank`, `sort=ASC`, `limit=10` then filter client‑side to future and take 5
- Data hygiene counts: `GET /spend-items/summary?limit=1&filters=...` using response `total` for each chip
  - `owner_it_id blank`, `owner_business_id blank`, `paying_company_id blank`, `account_warning notBlank`
- Recent OPEX updates: `GET /spend-items/summary?sort=updated_at:DESC&limit=5`
- Top OPEX Y: `GET /spend-items/summary?years=Y-1,Y&sort=yBudget:DESC&limit=5`
- Top increases: `GET /spend-items/summary?years=Y-1,Y&sort=created_at:DESC&limit=1000000` then compute deltas client‑side and take 5

## Permissions

- Dashboard route `/` is accessible to authenticated users.
- Actions are gated:
  - `New OPEX` requires `opex:manager`
  - `New CAPEX` requires `capex:manager`
  - Underlying lists and reports enforce their own `RequireLevel` guards server-side

## Formatting Rules

- All amounts on the Dashboard are rounded to the nearest thousand and displayed with a `k` suffix (e.g., `7 846k`).
- Snapshot tables center-align numbers; headers are center-aligned; row label (Year) is left-aligned.

## Performance & Caching

- React Query caching:
  - Totals endpoints (OPEX/CAPEX): `staleTime = 5m`
  - Hygiene counts, tasks, renewals, top lists: `staleTime = 1–2m`
- Hygiene uses lightweight `limit=1` queries to fetch counts via `total` without data transfer.
- Top increases currently processes a large page client‑side for accuracy; consider a server endpoint for deltas if needed.

## Extensibility / TODOs

- Deep-link Data Hygiene chips to OPEX list with exact filters applied.
- Optional legends (e.g., “rounded to thousands”).
- Replace top-increases large fetch with a backend aggregate (`/reports/deltas/top`), if performance requires.
- Add icons/tooltips consistently across tiles per design system.

## Code References

- Frontend page: `frontend/src/pages/DashboardPage.tsx:1`
- OPEX/CAPEX totals: `backend/src/spend/spend-items.service.ts:312` (summaryTotals), `CapexItemsService` in the same file (the CAPEX lines)
- OPEX summary row shape: `backend/src/spend/spend-summary.builder.ts:398`
  - Derived `account_warning` field for CoA mismatch: `backend/src/spend/spend-summary.builder.ts:420`
