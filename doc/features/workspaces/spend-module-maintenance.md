# Spend Module Maintenance Guide

This guide documents how the OPEX/“Spend items” feature is structured after the Q1 refactor. Use it when you need to add fields, extend CSV behaviours, or work on bulk budget operations so we keep the backend and frontend in sync.

## High-level flow

```
SpendItemsController
└─ SpendItemsService (thin façade)
   ├─ spend-summary.builder.ts (query/denormalise helpers)
   ├─ SpendItemsCsvService (export/import logic)
   └─ SpendBudgetOperationsService (copy/clear/allocate bulk actions)
```

The controller keeps returning exactly the same response shapes as before. Each responsibility now lives in a focused class:

### Summary / grid endpoints

* `backend/src/spend/spend-summary.builder.ts`
  * Pure data helpers: build denormalised rows, apply AG Grid filters, quick search, and sort derived columns.
  * Reused by `summary`, `summaryIds`, and `summaryTotals` so they always agree.
  * When you add a new derived column:
    1. Fetch/compute it in `buildSpendSummaryRows`.
    2. Extend `getSpendSummaryFieldValue` for filters/sort.
    3. Update the frontend column definition.
  * Disabled date masking (year-aware): versions whose `budget_year` is strictly greater than the item’s `disabled_at` year must be treated as zero for reporting (keeps OPEX reports consistent with chargeback and CAPEX). See `buildSpendSummaryRows` for the masking logic.

### CSV export/import

* `backend/src/spend/spend-items-csv.service.ts`
  * Handles BOM, headers, encoding, lookups, auditing, and freeze checks.
  * `exportCsv()` pulls all spend items once and reuses the summary builder totals pipeline.
  * `importCsv()` stages rows, validates, then creates new items/versions with a flat monthly spread.
  * UI/API should always call `SpendItemsService.exportCsv/importCsv` which just delegates.
  * To add columns, adjust the `csvHeaders()` list and extend the mapping in the service (only one place).

### Bulk budget operations

* `backend/src/spend/spend-budget-operations.service.ts`
  * `copyBudget` – "Copy budget columns" (`budget-copy.ts`): the amounts, the allocations or both, of one nature or both, under one tenant lock and in one transaction (`POST /budget-lines/budget-operations/copy`).
  * `clearBudgetColumns` – "Reset a column" of one nature or both (`POST /budget-lines/budget-operations/clear-column`).
  * `copyBudgetColumn` – copies one column of one nature to another year or column, respecting freeze state and audit logging (the routes of each nature).
  * `copyAllocations` – copies the allocations of one nature to another year, and surfaces preview data for dry runs (the routes of each nature).
  * `clearBudgetColumn` – wipes a single measure for all versions of one nature in a year.
  * Any new operation (e.g., “scale by factor”) should live here so `SpendItemsService` stays small.

### Allocation recipients and year-aware availability

* Allocation calculators (OPEX and CAPEX) compute recipient sets per version year using `(disabled_at IS NULL OR disabled_at >= :period_start)` where `period_start = ${year}-01-01`.
* Manual company/department modes validate selected recipients against the same rule for the version’s fiscal year.
* This ensures all reports (including Chargeback) use consistent availability semantics: recipients and items are included through the disabled year, and excluded afterward.

### Frontend pieces

* `frontend/src/pages/OpexListPage.tsx`
  * Main grid. Tracks the current query in `lastQueryRef` so links into the workspace preserve sort/filter/search context.
* `frontend/src/pages/opex/SpendItemPage.tsx`
  * Workspace shell coordinating tab navigation, explicit Save/Reset actions, dirty guards, prev/next navigation, and year switching.
* Editors
  * Overview (edit): `frontend/src/pages/opex/editors/SpendInfoEditor.tsx`
  * Overview (create): `frontend/src/pages/opex/editors/SpendInfoCreateEditor.tsx`
  * Budget: `frontend/src/pages/opex/editors/BudgetEditor.tsx` (`GET/PATCH /spend-items/:id/versions`, `/spend-versions/:id/amounts`)
  * Allocations: `frontend/src/pages/opex/editors/AllocationEditor.tsx` (`GET/POST /spend-versions/:id/allocations`, `PATCH` allocation metadata)
  * Tasks: `frontend/src/pages/opex/editors/TasksPanel.tsx`
  * Relations: `frontend/src/pages/opex/editors/RelationsPanel.tsx`

## Development checklist

When introducing a change to spend items:

1. **API shape changes** – Update the summary builder and add backend tests (unit or contract) around `buildSpendSummaryRows`.
2. **CSV changes** – Adjust `SpendItemsCsvService` (headers + mapping) and extend `doc/csv-import-export.md` if user-visible.
3. **Bulk operations** – Implement in `SpendBudgetOperationsService` and add backend coverage (look for TODO in `__tests__` once they exist).
4. **Frontend behaviour** – Confirm workspace editors respect the dirty/save/reset contract:
   * Overview editors only mark dirty when fields diverge from the last loaded baseline.
   * Budget and Allocations editors guard year changes and prev/next navigation when dirty and keep freeze-state rules intact.
   * Tasks panel and Relations panel persist correctly and refresh the cached item.
5. **Regression sweep** – Run:
  ```bash
  (cd backend && npm run build)
  (cd frontend && npm run build)
  ```
   plus manual workspace smoke tests (overview save/reset, budget annual vs monthly edit, allocations manual modes, tasks, relations) and a budget operations dry run.

## Related documents

* `doc/frontend-architecture.md` – overall React data-loading patterns.
* `doc/csv-import-export.md` – end-user CSV workflow.
* `doc/testing-strategy.md` – endpoints to cover in automated tests.

Keeping to this layout lets us add features without turning `spend-items.service.ts` back into a 2,000-line monolith.
