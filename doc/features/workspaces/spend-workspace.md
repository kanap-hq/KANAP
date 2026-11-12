Spend Workspace (OPEX) – Architecture, Patterns, and Maintenance Guide

**⚠️ Note**: For comprehensive workspace implementation patterns (RLS, tenant deletion, lifecycle management, editor patterns), see **[`workspace-patterns.md`](workspace-patterns.md)**. This document covers OPEX-specific details only.

Summary
- A consolidated edit-first workspace replaces multi-modal flows for Spend Items (OPEX).
- Vertical tabs per concern: Overview, Budget, Allocations, Tasks, Relations.
- Real routes + deep-linking, explicit Save/Reset, dirty guards, prev/next navigation, year switching.
- A "create mode" at /ops/opex/new guides item creation before enabling other tabs.

Key Routes
- List: `/ops/opex` (server grid with summary totals)
- Workspace: `/ops/opex/:id/:tab?` with optional `?sort=…&q=…&filters=…&year=YYYY`
  - `:tab` ∈ { overview | budget | allocations | tasks | relations }
  - `year` affects Budget/Allocations editors
- Create: `/ops/opex/new` (Overview only, other tabs disabled until Save)

Major Components (paths)
- Shell
  - `frontend/src/pages/opex/SpendItemPage.tsx` – workspace container (tabs, header, routing, guards)
  - Header actions: Prev / Reset / Save / Next / Close (returns to list preserving context)
  - Deep-link preservation: passes list `sort/q/filters` via URL when navigating

- Navigation helpers
  - `frontend/src/hooks/useSpendNav.ts` – builds ordered id list for prev/next from `/spend-items/summary/ids` using current `sort/q/filters`
  - `frontend/src/components/navigation/YearTabs.tsx` – year selector (Budget/Allocations)

- Editors (tab content)
  - Overview (edit existing): `frontend/src/pages/opex/editors/SpendInfoEditor.tsx`
    - All general fields (product, description, supplier, currency, account, dates, owners, analytics category, notes)
    - Explicit Save (PATCH `/spend-items/:id`), Reset to baseline, dirty tracking
    - Currency field uses the tenant’s allowed list + default from Currency Settings; error messaging mirrors backend validation when a disallowed code is selected.
  - Overview (create new): `frontend/src/pages/opex/editors/SpendInfoCreateEditor.tsx`
    - Performs POST to `/spend-items`, then redirects to the new id and enables all tabs
    - Prefills currency with the tenant default; autocomplete exposes allowed ISO codes only.
  - Budget: `frontend/src/pages/opex/editors/BudgetEditor.tsx`
    - Flat vs Monthly modes, year switching, freeze awareness, totals and per-month inputs
    - Endpoints: `GET /spend-items/:id/versions`, `PATCH` version, `GET/POST /spend-versions/:id/amounts`
- Allocations: `frontend/src/pages/opex/editors/AllocationEditor.tsx`
  - Methods: default/headcount/it_users/turnover/manual_company/manual_department
  - Manual_company: user selects the companies; workspace stores the driver (`allocation_driver`) and the raw list. Percentages are always recomputed from live company metrics.
  - Manual_department: similar flow for `{company, department}` pairs; headcount is recomputed every time allocations are read.
  - Endpoints: `GET/POST /spend-versions/:id/allocations`, `PATCH` version (`allocation_method`, `allocation_driver`)
  - **Important:** never trust the stored `allocation_pct` when auditing—treat the driver + selection as the source of truth and recompute from metrics.
  - Tasks: `frontend/src/pages/opex/editors/TasksPanel.tsx`
    - Latest task editor (create/update), with “New Task” quick clear
    - History list (all tasks) with status chip and last update date
    - Uses input refs on Save to avoid stale state edge cases
    - Endpoints: `GET /spend-items/:id/tasks`, `POST/PATCH /spend-items/:id/tasks`
- Relations: `frontend/src/pages/opex/editors/RelationsPanel.tsx`
  - Projects Autocomplete (multi-select) -> `POST /spend-items/:id/projects/bulk-replace` (via `portfolio_project_opex` junction table)
  - Applications Autocomplete (multi-select, clickable tags -> Applications Overview) -> `POST /spend-items/:id/applications/bulk-replace`
  - Contracts Autocomplete (multi-select) -> `POST /spend-items/:id/contracts/bulk-replace`

### Applications links (new)
- Purpose: surface the revamped Applications (Apps & Services) workspace inside OPEX Relations to track which apps a spend item supports.
- UX: multi-select dropdown (names only); saved tags are clickable and navigate to `/it/applications/:id/overview` in the same window.
- Storage: `application_spend_items` linking `spend_items` to `applications` (tenant-scoped, cascade on delete of app or spend item).
- API:
  - The line's Relations tab (`GET /budget-lines/:id/relations`) reads its applications.
  - `POST /spend-items/:id/applications/bulk-replace` (manager) – `{ application_ids: string[] }`.
- Validation: all application ids must exist and belong to the same tenant as the spend item; duplicates are deduped server-side.

Dirty, Save, Reset – Contract
- Each editor exposes a small imperative interface via ref:
  - `isDirty(): boolean`
  - `save(): Promise<void>` (or Promise<string> for create)
  - `reset(): void`
- The shell (SpendItemPage) controls the active tab’s Save/Reset
- Dirty guards appear when switching tabs, navigating prev/next, or changing years (Budget/Allocations)

Deep Linking and Context Preservation
- From the list, clicks open workspace on the correct tab/year:
  - Allocation label → `/ops/opex/:id/allocations?year=Y`
  - Budget/landing cells → `/ops/opex/:id/budget?year=YYYY`
  - Latest task → `/ops/opex/:id/tasks`
  - Other fields → `/ops/opex/:id/overview`
- List context (`sort/q/filters`) flows via URL and is preserved by Close action; prev/next order respects it

Create Mode
- Route `/ops/opex/new` uses `SpendInfoCreateEditor`
- Only Overview is enabled; other tabs show a subtle hint: “Other tabs will be available after you create the item.”
- Save immediately POSTs and redirects to `/ops/opex/:id/overview` enabling all tabs
- “New” button in list now navigates to `/ops/opex/new?sort=…&q=…&filters=…`

API Contracts (used by workspace)
- Spend items
  - `GET /spend-items/:id` – load Overview
  - `PATCH /spend-items/:id` – update Overview fields
  - `POST /spend-items` – create new item
  - `GET /spend-items/summary/ids` – ordered id list for prev/next
  - `POST /spend-items/:id/projects/bulk-replace` – link to Portfolio projects (via `portfolio_project_opex` junction table)
  - `POST /spend-items/:id/applications/bulk-replace` – link to Applications workspace entries
  - `GET /spend-items/:id/contracts` / `POST /spend-items/:id/contracts/bulk-replace`
- Versions
  - `GET /spend-items/:id/versions`, `POST /spend-items/:id/versions`, `PATCH /spend-items/:id/versions`
  - `GET /spend-versions/:id/amounts`, `POST /spend-versions/:id/amounts/bulk-upsert`
  - `GET /spend-versions/:id/allocations`, `POST /spend-versions/:id/allocations/bulk-upsert`
- Tasks
  - `GET /spend-items/:id/tasks`, `POST /spend-items/:id/tasks`, `PATCH /spend-items/:id/tasks`

Patterns to Reuse in Other Refactors
1) Start with a route shell similar to `SpendItemPage` (tabs + header)
   - Preserve list context in URLs
   - Use an ordered id endpoint for prev/next
   - Implement a Close that returns to the list with context

2) Extract modal bodies into editors (workspace panels)
   - Convert them to pure editors exposing `isDirty/save/reset`
   - Avoid internal dialogs unless necessary; prefer inline expanders
   - Keep Save explicit (no optimistic write), Reset to baseline

3) Manage year/state via URL
   - Tabs that require versions should read/write `?year`
   - Use a shared YearTabs component for consistency

4) Guard against re-render pitfalls
   - Keep parent callbacks stable (e.g. wrap `onDirtyChange` with `useCallback`)
   - Avoid temporal dead zones by defining helpers before effects that depend on them
   - Refrain from using stateful values in helper dependencies unless strictly needed
   - **Critical: `useImperativeHandle` dependencies**
     - Always include the `save` function in the dependency array when it's defined separately
     - Remove recreated object dependencies (`current`, `baseline`) from both `useEffect` and `useImperativeHandle`
     - Stale closures in refs cause partial saves when state updates rapidly (e.g., typing)

5) Link from list to the workspace
   - Replace modal launches with deep links per clicked column

Common Pitfalls (and how we fixed them here)
- Hook order crashes on create → Always call hooks (e.g., `useSpendNav`) and conditionally ignore values
- Blink loops in heavy tabs → Stabilize dependencies and pass computed arrays to recalculation helpers
- Stale form values when saving → Read directly from input refs in edge cases (Tasks) or ensure controlled state is flushed
- Dirty flickers due to unstable callbacks → Wrap parent callbacks with `useCallback`
- **Partial saves (only one character saved)** → Missing `save` function in `useImperativeHandle` dependencies causes stale closures; always include `save` in the deps array
- **Allocation prefill race on first load** → Reset `manualCompanyPrefilledRef` at start of `load()` and add `!loading` guard to prefill effect to prevent overwriting loaded data

Where to Look in Code
- Shell: `frontend/src/pages/opex/SpendItemPage.tsx`
- Editors:
  - Overview edit: `frontend/src/pages/opex/editors/SpendInfoEditor.tsx`
  - Overview create: `frontend/src/pages/opex/editors/SpendInfoCreateEditor.tsx`
  - Budget: `frontend/src/pages/opex/editors/BudgetEditor.tsx`
  - Allocations: `frontend/src/pages/opex/editors/AllocationEditor.tsx`
  - Tasks: `frontend/src/pages/opex/editors/TasksPanel.tsx`
  - Relations: `frontend/src/pages/opex/editors/RelationsPanel.tsx`
- Linking from list: `frontend/src/pages/OpexListPage.tsx` (onCellClicked + New)
- Shared UI:
  - Year tabs: `frontend/src/components/navigation/YearTabs.tsx`
  - Selects: `frontend/src/components/fields/*Select.tsx`

Editor Implementation Patterns (Critical for Future Workspaces)

### useImperativeHandle Pattern
Editors expose `isDirty/save/reset` via `useImperativeHandle`. **Critical rules:**

**✅ Correct pattern:**
```typescript
// Define save function separately
const save = async () => {
  // ... reads state variables: title, description, etc.
};

// Include save in dependencies
useImperativeHandle(ref, () => ({
  isDirty: () => dirty,
  save,  // ← Function reference
  reset: () => { void load(); },
}), [dirty, save, load]);  // ← save MUST be in deps
```

**❌ Incorrect pattern (causes partial saves):**
```typescript
useImperativeHandle(ref, () => ({
  isDirty: () => dirty,
  save,  // save function defined earlier
  reset: () => { void load(); },
}), [dirty, load]);  // ← Missing 'save'! Stale closure!
```

**❌ Also incorrect (causes excessive recreations):**
```typescript
useImperativeHandle(ref, () => ({
  isDirty: () => dirty,
  save,
  reset,
}), [dirty, current, baseline, ...]);  // ← Objects recreate every render!
```

**Why this matters:** When `save` is not in dependencies, the ref points to an OLD version of the function with stale state closures. Fast typing causes 3-4 renders, but the save function captures state from the first render only.

### Allocation Prefill Race Condition Pattern
Manual allocation modes prefill companies when empty. **Defense-in-depth approach:**

**✅ Correct pattern:**
```typescript
const load = React.useCallback(async () => {
  manualCompanyPrefilledRef.current = false;  // ← Reset at START
  setLoading(true);
  // ... fetch and process data
  if (loadedMethod === 'manual_company') {
    setRows(loadedData);
    manualCompanyPrefilledRef.current = true;  // ← Set after rows loaded
  }
}, [deps]);

React.useEffect(() => {
  if (isManualCompany && !loading) {  // ← Guard with loading state
    void prefillManualCompanyRows();
  }
}, [isManualCompany, prefillManualCompanyRows, loading]);
```

**Why this matters:** Without guards, the prefill effect races with data loading. When `setMethod('manual_company')` fires, the prefill effect checks if rows are empty - but `setRows()` hasn't flushed yet, so it prefills "all companies" and overwrites the correct loaded data.

### Grid Cell Click Navigation Pattern
List grids deep-link to workspace tabs based on column clicked.

**✅ Correct pattern (CapexPage.tsx, OpexListPage.tsx):**
```typescript
const onCellClicked = useCallback((params: any) => {
  const colId = params?.column?.getColId?.() || params?.colDef?.colId;
  const row = params?.data;

  const go = (tab: string, year?: number) => {
    const s = new URLSearchParams(listContext);
    if (year) s.set('year', String(year));
    navigate(`/ops/capex/${row.id}/${tab}?${s.toString()}`);
  };

  // Allocation columns
  if (colId === 'yAllocation') return go('allocations', Y);
  if (colId === 'yPlus1Allocation') return go('allocations', Y + 1);

  // Budget columns
  if (colId === 'yBudget') return go('budget', Y);
  if (colId === 'yPlus1Budget') return go('budget', Y + 1);

  // Default to overview
  return go('overview');
}, [navigate, Y]);
```

Extending with To‑Dos (Optional)
- Add success toasts on Save for each tab
- Add keyboard shortcuts (Prev/Next and Year Left/Right)
- Extract a generic WorkspaceShell if you refactor other domains (CAPEX, Projects)

Testing/QA Checklist
- Overview Save and Reset work; Enabled toggle persists
- **Rapid typing test:** Type quickly in text fields (product name, notes, task title) and immediately click Save → full text should be saved (not just one character)
- Budget and Allocations:
  - Year switching guarded when dirty
  - **First-load test:** Open item directly to Allocations tab with manual_company/manual_department → shows saved data, NOT "all companies" prefill
  - Manual modes load preselected rows and don't autoselect all companies
  - Freeze logic disables relevant inputs
  - Notes field visible and functional in Budget tab
- Tasks create/update, history list ordering and content render as expected
- Relations Projects (multi-select) and contract linking persist and reload
- Deep links from list open correct tab/year; Close returns with same filters/sort
- **Grid navigation:** Clicking allocation columns in both OPEX and CAPEX grids opens Allocations tab (not Overview)
