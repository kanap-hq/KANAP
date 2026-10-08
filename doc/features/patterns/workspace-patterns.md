# Workspace Patterns - Implementation Guide

**Purpose**: Comprehensive guide for implementing workspace-based UIs with proper multi-tenant isolation, lifecycle management, and navigation patterns.

**Audience**: Engineers implementing new workspaces (Companies, Departments, OPEX, CAPEX, Contracts, etc.)

**Last Updated**: 2026-01-24

**Related Documentation**:
- [backend-patterns.md](backend-patterns.md) - Backend patterns & abstractions (BaseDeleteService, TenancyManager, service decomposition)
- [../frontend-architecture.md](../frontend-architecture.md) - Frontend hooks and components (useModuleItemNav, WorkspaceLayout)

---

## Overview

Workspaces replace modal-based editing with route-driven interfaces that provide:
- Deep-linkable URLs for each concern (overview, budget, allocations, tasks, relations)
- Explicit Save/Reset controls with dirty guards
- Prev/Next navigation preserving list context (sort, filters, search)
- Year-aware editors for time-series data
- Close action returning to list with preserved state

**Reference Implementations**:
- OPEX: `frontend/src/pages/opex/SpendItemPage.tsx`
- CAPEX: `frontend/src/pages/CapexPage.tsx`
- Companies: `frontend/src/pages/CompaniesPage.tsx`
- Contracts: `frontend/src/pages/ContractsPage.tsx`
- Tasks (Jira-style sidebar): `frontend/src/pages/tasks/TaskWorkspacePage.tsx`

---

## Architecture Requirements

### Multi-Tenant Isolation (RLS)

Every workspace must respect Row-Level Security (RLS) for tenant isolation.

**Backend Requirements**:

1. **Table Schema**:
   - Add `tenant_id uuid NOT NULL` to all multi-tenant tables
   - Use composite keys: `PRIMARY KEY (tenant_id, id)`
   - Unique constraints: `UNIQUE (tenant_id, slug)` or `UNIQUE (tenant_id, name)`

2. **RLS Policies**:
   ```sql
   ALTER TABLE your_table ENABLE ROW LEVEL SECURITY;
   ALTER TABLE your_table FORCE ROW LEVEL SECURITY;

   CREATE POLICY tenant_isolation ON your_table
     USING (tenant_id = app_current_tenant()::uuid);

   -- Add WITH CHECK policy for inserts/updates
   CREATE POLICY tenant_isolation_check ON your_table
     FOR ALL
     USING (tenant_id = app_current_tenant()::uuid)
     WITH CHECK (tenant_id = app_current_tenant()::uuid);
   ```

3. **Request-Scoped Context**:
   - Use `TenantInitGuard` to set `app.current_tenant` per request
   - Pass request-scoped `EntityManager` to services
   - NEVER use global `DataSource` directly in controllers

4. **Indexes**:
   ```sql
   -- Lead with tenant_id for efficient queries
   CREATE INDEX idx_your_table_tenant_id ON your_table(tenant_id);
   CREATE INDEX idx_your_table_tenant_lookup
     ON your_table(tenant_id, frequently_queried_field);
   ```

**RLS Self-Test** (Run before promoting to production):
```bash
cd backend
npm run test:rls
```

This validates:
- RLS is enabled on all multi-tenant tables
- Cross-tenant reads/writes are blocked
- No data leaks between tenants

**CSV Import Smoke Test**:
```bash
cd backend
npx ts-node scripts/csv-import-smoke.ts
```

Validates tenant-scoped CSV imports for Accounts, Suppliers, Departments, Users.

---

## Tenant Deletion Integration

When adding new tenant-scoped tables, you **MUST** update the tenant deletion script.

**File**: `backend/src/admin/tenants/admin-tenants.service.ts`

**Deletion Order** (respect foreign key dependencies):

```typescript
// Example purge order (add your tables in correct position)
const purgeOrder = [
  // Child tables first
  'supplier_contacts',
  'contact_links',
  'contract_attachments',
  'contract_links',
  'contract_spend_items',
  'spend_allocations',
  'spend_amounts',
  'spend_versions',
  'capex_amounts',
  'capex_versions',
  'tasks',

  // Parent tables
  'contracts',
  'spend_items',
  'capex_items',
  'contacts',
  'suppliers',
  'accounts',
  'departments',
  'companies',
  'company_metrics',
  'department_metrics',

  // Audit and RBAC
  'role_permissions',
  'roles',
  'users',
  'audit_log',

  // Billing
  'subscriptions'
];
```

**Checklist when adding new tables**:
1. Identify parent/child relationships
2. Insert table name in correct dependency order
3. Test deletion in dev environment
4. Verify slug can be reused after deletion

---

## Lifecycle Management (Status + disabled_at)

All master data entities use `disabled_at` as source of truth for lifecycle.

**Database Schema**:
```sql
status status_state NOT NULL DEFAULT 'enabled',  -- enum: 'enabled' | 'disabled'
disabled_at timestamptz,  -- NULL = enabled; past date = disabled
```

**Backend Helpers** (`backend/src/common/status-filter.ts`):
```typescript
// Apply status filtering to queries
applyStatusFilter(queryBuilder, {
  status?: 'enabled' | 'disabled',  // explicit filter
  includeDisabled?: boolean,        // override default
  asOf?: Date,                      // point-in-time query
  periodStart?: Date,               // for historical reporting
  periodEnd?: Date
});
```

**Default Behavior**:
- List endpoints default to "currently active" (disabled_at IS NULL OR disabled_at > NOW())
- Exception: the OPEX and CAPEX budget lists read Enabled and Disabled by the current year (enabled: no end of validity or one on or after 1 January UTC; disabled: one before it), so a line ending during the year stays listed until 31 December
- Historical queries include items active during the period
- Frontend `StatusLifecycleField` component handles date picker + derived status

**Key Patterns**:
```typescript
// Service query
const items = await queryBuilder
  .where('entity.tenant_id = :tenantId', { tenantId })
  .andWhere(applyStatusFilter(queryBuilder))  // defaults to active
  .getMany();

// Explicit status filter
applyStatusFilter(queryBuilder, { status: 'disabled' });

// Year-aware (reporting)
applyStatusFilter(queryBuilder, {
  periodStart: new Date('2024-01-01'),
  periodEnd: new Date('2024-12-31')
});
```

**Frontend**:
```tsx
// Form field
<StatusLifecycleField
  status={status}
  disabledAt={disabledAt}
  onChange={({ status, disabledAt }) => {
    setStatus(status);
    setDisabledAt(disabledAt);
  }}
/>
```

---

## Workspace Shell Pattern

### Route Structure
```
/module/items              → List page (grid)
/module/items/:id/:tab     → Workspace (edit/view)
/module/items/new/overview → Create mode
```

**URL Parameters**:
- `sort` - Single field:direction (e.g., `name:ASC`)
- `q` - Quick search query
- `filters` - AG Grid filterModel JSON
- `year` - For budget/allocations tabs
- `page`, `limit` - Pagination (internal, not always in URL)

### Shell Component Structure

```tsx
// Example: SpendItemPage.tsx
export const SpendItemPage = () => {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState('overview');

  // Navigation context preservation
  const listContext = {
    sort: searchParams.get('sort'),
    q: searchParams.get('q'),
    filters: searchParams.get('filters'),
  };

  // Prev/Next navigation (see useModuleItemNav documentation below)
  const { ids, currentIndex } = useItemNav(id, listContext);
  const prevId = ids[currentIndex - 1];
  const nextId = ids[currentIndex + 1];

  // Ref to active editor
  const editorRef = useRef<EditorHandle>(null);

  // Guard tab/navigation changes
  const guardNavigation = async () => {
    if (editorRef.current?.isDirty()) {
      const confirm = await showDirtyDialog();
      if (!confirm) return false;
    }
    return true;
  };

  return (
    <Box>
      <PageHeader
        title={item.name}
        actions={
          <>
            <Button onClick={() => navigate(prevId)}>Prev</Button>
            <Button onClick={() => editorRef.current?.reset()}>Reset</Button>
            <Button onClick={() => editorRef.current?.save()}>Save</Button>
            <Button onClick={() => navigate(nextId)}>Next</Button>
            <Button onClick={() => navigate(`/list?${listContext}`)}>Close</Button>
          </>
        }
      />

      <Tabs value={activeTab} onChange={handleTabChange}>
        <Tab label="Overview" value="overview" />
        <Tab label="Budget" value="budget" />
        <Tab label="Allocations" value="allocations" />
        <Tab label="Tasks" value="tasks" />
      </Tabs>

      <TabPanel value="overview">
        <OverviewEditor ref={editorRef} itemId={id} />
      </TabPanel>
      {/* Other tabs... */}
    </Box>
  );
};
```

---

## Resizable Sidebar Pattern

For workspaces with a sidebar panel (e.g., Tasks), implement user-resizable width with localStorage persistence:

**Implementation:**
```tsx
// State with localStorage persistence
const SIDEBAR_STORAGE_KEY = 'taskSidebarWidth';
const SIDEBAR_MIN = 240;
const SIDEBAR_MAX = 400;
const SIDEBAR_DEFAULT = 300;

const [sidebarWidth, setSidebarWidth] = useState(() => {
  const stored = localStorage.getItem(SIDEBAR_STORAGE_KEY);
  if (stored) {
    const parsed = parseInt(stored, 10);
    if (!isNaN(parsed) && parsed >= SIDEBAR_MIN && parsed <= SIDEBAR_MAX) return parsed;
  }
  return SIDEBAR_DEFAULT;
});
const [isResizing, setIsResizing] = useState(false);
const sidebarRef = useRef<HTMLDivElement>(null);

// Resize handler - uses container position for correct calculation
useEffect(() => {
  if (!isResizing) return;
  const handleMouseMove = (e: MouseEvent) => {
    if (!sidebarRef.current) return;
    const containerLeft = sidebarRef.current.getBoundingClientRect().left;
    const newWidth = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, e.clientX - containerLeft));
    setSidebarWidth(newWidth);
  };
  const handleMouseUp = () => {
    setIsResizing(false);
    localStorage.setItem(SIDEBAR_STORAGE_KEY, String(sidebarWidth));
  };
  document.addEventListener('mousemove', handleMouseMove);
  document.addEventListener('mouseup', handleMouseUp);
  return () => {
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  };
}, [isResizing, sidebarWidth]);

// Sidebar container with drag handle
<Box ref={sidebarRef} sx={{ width: sidebarWidth, position: 'relative' }}>
  {/* Drag handle */}
  <Box
    onMouseDown={() => setIsResizing(true)}
    sx={{
      position: 'absolute',
      top: 0,
      right: 0,
      width: 4,
      height: '100%',
      cursor: 'col-resize',
      '&:hover': { bgcolor: 'primary.main', opacity: 0.3 },
      ...(isResizing && { bgcolor: 'primary.main', opacity: 0.5 }),
    }}
  />
  {/* Sidebar content */}
</Box>
```

**Key Points:**
- Calculate width relative to container's left edge (`e.clientX - containerLeft`), not viewport edge
- This ensures correct behavior when there's a left navigation panel
- Persist to localStorage on mouseUp for cross-session memory
- Disable on mobile (use full width instead)
- Provide visual feedback on hover/drag via subtle color change

**Reference Implementation:** `frontend/src/pages/tasks/TaskWorkspacePage.tsx`

---

## Dropdowns + Relations Panels (Best Practices)

When implementing multi-select dropdowns (e.g., linking OPEX, CAPEX, Contracts) and relations panels, follow these patterns to ensure snappy UX and avoid subtle state bugs:

- Preload options on mount
  - Fetch complete option lists using paging until the `total` is covered (e.g., `page=1..n`, `limit=100`), with alphabetical `sort` (name, product_name, description).
  - Store options in component state and rely on client-side filtering for instant search. Keep existing server-side search on `onInputChange` for large tenants.

- Fetch on open as a fallback
  - Add a lightweight `onOpen` fetch if the options array is empty (e.g., first time visitor in a fresh tab) so the dropdown isn’t blank before typing.

- Store selected items as objects, compare by `id`
  - Keep `value` as an array of `{ id, label }` objects (same shape as options). Derive dirty state by comparing `value.map(x => x.id)` with baseline.
  - Use `isOptionEqualToValue={(opt, val) => opt.id === val.id}` to guarantee stable identity.

- Disable label animation
  - Always set `InputLabelProps={{ shrink: true }}` on dropdown TextFields to prevent label “wiggle” during focus/clear.

- Prevent first-click delete bugs
  - House relations editors in dedicated components (not inline in page shells) to avoid remounts when the parent’s dirty state flips.
  - Reference them via `ref` from the workspace shell and call `save()`/`reset()` from the parent’s Save/Reset controls.

- Save behavior
  - Persist relations with bulk-replace endpoints (e.g., `POST /…/contracts/bulk-replace`), sending only IDs.
  - After Save, update the baseline selection arrays to match the just-saved values.

### Example: Robust Autocomplete

```tsx
<Autocomplete
  multiple
  options={contractOptions} // preloaded paged + sorted
  value={linkedContracts}
  getOptionLabel={(o) => o.name}
  isOptionEqualToValue={(opt, val) => opt.id === val.id}
  onChange={(_, v) => setLinkedContracts(v as Array<{ id: string; name: string }>)}
  onOpen={async () => { if (contractOptions.length === 0) await preloadContracts(); }}
  renderInput={(params) => (
    <TextField
      {...params}
      label="Contracts"
      placeholder="Select contracts"
      InputLabelProps={{ shrink: true }}
    />
  )}
/>
```

---

## Relevant Websites (URLs)

Implement the mini-table for URLs in a way that’s resilient to background reloads:

- Use stable client-side keys for new rows (e.g., `__id: uid()`), and a guard flag (e.g., `urlsEditedRef`) to avoid overwriting user edits when refetching.
- Remove dedicated “Save links” buttons; use the workspace Save button. On Save:
  - Delete missing rows, upsert new/changed rows.
  - Refresh the list and update baseline.

---

## Attachments (consistent across workspaces)

- Present attachments as chips with file name; clicking downloads via a blob URL.
- Gate deletes behind permission checks (e.g., `hasLevel(resource,'manager')`).
- Use `PATCH /…/attachments/:id/delete` and reload the list on success.
- Enable drag-and-drop and fallback file input with a visible upload counter and `LinearProgress` while uploading.

---

## Compliance — Data Residency (Countries)

For country selection fields (e.g., Application data residency):

- Use a multi-select `Autocomplete` bound to `COUNTRY_OPTIONS` (code + name), with `InputLabelProps={{ shrink: true }}`.
- Bind value to the underlying `data_residency` array in parent state (map to `{ country_iso: code }`).
- Save via the workspace Save button by calling a bulk-replace endpoint (e.g., `POST /applications/:id/data-residency/bulk-replace`).
- Ensure the backend GET endpoint includes the residency array (e.g., `data_residency`) so selections persist after reload.

---

## Common Gotchas and Fixes

- Dropdown appears empty until typing
  - Preload options on mount, and refetch on `onOpen` if empty. Sort alphabetically for user scanning.

- First chip delete “does nothing”
  - Relations editor should be a separate component referenced via `ref`, not inline in the page shell. Inline implementations can remount on the first dirty flip and swallow the chip removal.

- Label “wiggle” on focus/clear
  - Add `InputLabelProps={{ shrink: true }}` to dropdown inputs.

- URL row disappears after Add
  - Use a stable client key for new rows and an “edited” guard flag so background reloads don’t clobber the just-added empty row.

- Selections saved but disappear after Save
  - Verify backend GET returns the corresponding arrays (e.g., `data_residency`) and that the editor syncs baseline after save + reload.


---

## Inline Mini‑Tables (Owners/Audience) Pattern

Use this pattern for compact, row‑based editors rendered inside a workspace tab (e.g., Owners, Audience, Contacts). Goals: stable UI with no flicker, predictable order, and reliable Save.

1) Stable row identity and keys
- Generate a client‑only id per row (`__id = uid()`) and use it as the React key. Do not use array indices as keys.
- For entities that might not have server ids yet (e.g., unsaved owners), provide a stable fallback id (e.g., `__tid`) and prefer `o.id || o.__tid || o.__idx` as the key.

2) Order‑preserving sync and one‑time initialization
- Keep an internal `rows` array for the mini‑table. Initialize it from server data only once; guard future reloads with a ref (e.g., `rowsEditedRef`).
- When syncing to parent state, iterate in visual order and insert unique ids using `Set` dedupe. This preserves the on‑screen order even as users add rows in the middle.

3) Prevent label flicker in read‑only cells
- For read‑only TextFields (e.g., owner name/job title, computed Users column), apply `InputLabelProps={{ shrink: true }}` to avoid floating label animations.
- Ensure your Autocomplete fields set shrunk labels inside `renderInput`.

4) Avoid remounts to contain rerenders
- Hoist complex mini‑tables into a stable component (top‑level in the module) and pass `data`/`update` props. Avoid inline component declarations inside frequently re‑rendering parents.
- Memoization can help, but avoiding remounts is more effective.

5) Safe Save on bulk‑replace APIs
- Filter out placeholders/empty entries before calling a bulk‑replace endpoint, and deduplicate by the natural key (e.g., `(owner_type, user_id)`).
- This prevents accidental wipes when the API replaces with an invalid/empty set.

6) Derived metrics per row (optional)
- Fetch lazily per visible row; cache results by id in component state to avoid re‑fetch churn.
- Keep totals purely derived from the row list to avoid out‑of‑sync bugs.

Reference implementation
- `frontend/src/pages/it/ApplicationWorkspacePage.tsx` (Ownership & Audience)
- `frontend/src/components/fields/{UserSelect,CompanySelect,DepartmentSelect}.tsx`


## Linked Data Panels (e.g., Contacts)

Panels that render linked child entities coming from another module (for example, Suppliers → Contacts) must ensure data freshness and intuitive create flows.

Guidelines:
- Creation gating: Disable non‑overview tabs until the parent entity is created. Show a small caption: "Other tabs become available after you create the item." On successful create, redirect to the full workspace with all tabs enabled.
- Dedicated tab: Place linked entities in their own tab (e.g., “Contacts”) rather than embedding in Overview when the interaction is substantial.
- React Query freshness: When a linked panel uses React Query to fetch links, configure it to always refetch on mount/focus.
  - Example options: `staleTime: 0`, `refetchOnMount: 'always'`, `refetchOnWindowFocus: true`, `refetchOnReconnect: true`.
- Cross‑panel invalidation: When saving a child entity from its own workspace (e.g., Contact phone/mobile change), invalidate the parent link query keys so linked panels immediately reflect updates without manual refresh.
  - Example: `queryClient.invalidateQueries({ queryKey: ['supplier-contacts'], exact: false });`
- Immediate actions: Attach/detach operations inside linked panels can apply immediately (no additional Save button), but still surface errors inline.

Reference:
- Suppliers → Contacts tab implementation: `frontend/src/pages/suppliers/editors/SupplierContactsPanel.tsx`
- Contact save invalidation: `frontend/src/pages/contacts/editors/ContactOverviewEditor.tsx`

---

## Editor Implementation Patterns

### Editor Interface
```typescript
export interface EditorHandle {
  isDirty: () => boolean;
  save: () => Promise<void>;
  reset: () => void;
}
```

### RichTextEditor Integration

When adding rich text editing to workspaces (descriptions, notes, comments), use the shared `RichTextEditor` component. **Critical: Use deferred rendering to avoid initialization race conditions.**

**The Problem:**
RichTextEditor uses Tiptap, which initializes its editor state on mount from the `value` prop. If the component mounts before data is loaded from React Query (common with cached data), the editor initializes with empty content and may not sync correctly.

**The Solution - Deferred Rendering Pattern:**
```tsx
// 1. Add initialized flag alongside your content state
const [description, setDescription] = React.useState('');
const [initialized, setInitialized] = React.useState(false);

// 2. Fetch data with React Query
const { data: entity } = useQuery({...});

// 3. Sync to state AND mark initialized
React.useEffect(() => {
  if (entity) {
    setDescription(entity.description || '');
    setInitialized(true);  // ← Critical: set AFTER state sync
  }
}, [entity]);

// 4. Conditionally render editor only when ready
{initialized ? (
  <RichTextEditor
    value={description}
    onChange={(val) => { setDescription(val); setDirty(true); }}
    placeholder="Add a description..."
    minRows={8}
    maxRows={24}
    disabled={!canManage}
    onImageUpload={handleUploadImage}  // Optional: S3 upload for pasted images
  />
) : (
  <Box sx={{ minHeight: 8 * 24, border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
    <Typography color="text.secondary">Loading...</Typography>
  </Box>
)}
```

**Why This Works:**
1. Placeholder shows during data fetch/sync
2. RichTextEditor mounts only AFTER description state has actual value
3. Tiptap initializes with correct content on first render
4. No race condition between React Query cache and state sync

**Image Upload (Optional):**
```tsx
// Returns URL for embedding in editor
const handleUploadImage = async (file: File): Promise<string> => {
  const formData = new FormData();
  formData.append('file', file);
  const res = await api.post(`/entity/${id}/attachments`, formData);
  return `${baseUrl}/attachments/${tenantSlug}/${res.data.id}/inline`;
};
```

**Reference Implementation:** `frontend/src/pages/tasks/TaskWorkspacePage.tsx` (lines 105, 224, 490-504)

**Full Documentation:** See `planning/portfolio/phase-11d-rich-text.md` for complete Tiptap integration details.

### Base64 to S3 Image Conversion (Create Mode)

When using RichTextEditor in create mode (no entity ID yet), images can't be uploaded immediately. Use post-creation conversion:

**Problem:** No entity ID means no attachment endpoint to upload to.

**Solution:** Store as base64 during editing, convert to S3 after creation.

```tsx
// Helper: Convert base64 data URL to File
const base64ToFile = (dataUrl: string, filename: string): File => {
  const arr = dataUrl.split(',');
  const mimeMatch = arr[0].match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/png';
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new File([u8arr], filename, { type: mime });
};

// Helper: Convert base64 images to S3 attachments
const convertBase64ImagesToS3 = async (entityId: string, html: string): Promise<string> => {
  const base64Regex = /<img[^>]+src="(data:image\/[^;]+;base64,[^"]+)"[^>]*>/g;
  const matches = [...html.matchAll(base64Regex)];
  if (matches.length === 0) return html;

  let updatedHtml = html;
  for (let i = 0; i < matches.length; i++) {
    const base64Src = matches[i][1];
    const file = base64ToFile(base64Src, `image-${i + 1}.png`);

    const formData = new FormData();
    formData.append('file', file);
    const res = await api.post(`/entity/${entityId}/attachments`, formData);

    const s3Url = `${baseUrl}/attachments/${tenantSlug}/${res.data.id}/inline`;
    updatedHtml = updatedHtml.replace(base64Src, s3Url);
  }
  return updatedHtml;
};

// Usage in create handler
const handleCreate = async () => {
  const res = await api.post('/entities', payload);
  const newId = res.data.id;

  // Convert base64 images to S3 if present
  if (description?.includes('data:image/')) {
    const updated = await convertBase64ImagesToS3(newId, description);
    if (updated !== description) {
      await api.patch(`/entities/${newId}`, { description: updated });
    }
  }

  navigate(`/entities/${newId}/overview`);
};
```

**Benefits:**
- Images display correctly in editor during creation
- After save, images stored in S3 (not bloating database)
- Images appear in attachments list
- Transparent to user

**Reference Implementation:** `frontend/src/pages/tasks/TaskWorkspacePage.tsx`

**Full Documentation:** See `planning/portfolio/phase-11e-create-task-form.md`

### Chart of Accounts (CoA) and Account Persistence

When implementing OPEX/CAPEX editors with company and account selection:

**✅ Correct Pattern (Do NOT clear account automatically)**:
```typescript
// OPEX/CAPEX editors
const [companyId, setCompanyId] = useState<string | null>(null);
const [accountId, setAccountId] = useState<string>('');

// NO useEffect to clear account when company changes!
// Backend enforces CoA filtering - wrong accounts don't appear in dropdown
```

**❌ Incorrect Pattern (causes account to disappear)**:
```typescript
// CAPEX editor (old, problematic pattern)
React.useEffect(() => {
  // This clears account on every company change, including during refetch!
  setAccountId('');
}, [companyId]);
```

**Why this matters**:
- Backend `AccountSelect` already filters accounts by company's CoA
- User cannot select wrong account - it's not in the dropdown
- Clearing on change breaks save+refetch flow (account disappears after successful save)
- OPEX works correctly WITHOUT this logic

**Obsolete Account Detection**:
Instead of preventing selection, show a warning when mismatches exist:
```typescript
// Detect CoA mismatch
const hasObsoleteAccount = useMemo(() => {
  if (!accountId || !companyId) return false;
  if (!accountCoaId || !companyCoaId) return false;
  return accountCoaId !== companyCoaId;
}, [accountId, companyId, accountCoaId, companyCoaId]);

// Show warning in UI
{hasObsoleteAccount && (
  <Alert severity="warning">
    Obsolete account detected. The selected account does not belong to
    the company's Chart of Accounts. Please update the account.
  </Alert>
)}
```

**Account Filtering by Company**:
```typescript
// AccountSelect component automatically filters
<AccountSelect
  value={accountId}
  onChange={(v) => setAccountId(v ?? '')}
  companyId={companyId || undefined}  // Backend filters by company's CoA
  disabled={!companyId}  // Disable until company selected
/>
```

Backend handles filtering (see `accounts.service.ts`):
- Company WITH CoA → shows only accounts from that CoA
- Company WITHOUT CoA → shows only legacy accounts (no CoA)
- Prevents cross-CoA mistakes at the API level

Global Default CoA
- Tenant companies auto‑assign a CoA on create/update: first by the country default (if set), otherwise falling back to the tenant’s Global Default CoA (which is a `GLOBAL`‑scoped CoA).
- The Global Default CoA is created automatically at tenant provisioning time (as `scope=GLOBAL`) when a platform global template is flagged “Loaded by default”.

### Critical: useImperativeHandle Dependencies

**✅ Correct Pattern**:
```typescript
const save = async () => {
  // ... reads state variables: title, description, etc.
  await api.patch(`/items/${id}`, { title, description });
};

useImperativeHandle(ref, () => ({
  isDirty: () => dirty,
  save,  // ← Function reference
  reset: () => { void load(); },
}), [dirty, save, load]);  // ← save MUST be in deps
```

**❌ Incorrect (causes partial saves)**:
```typescript
useImperativeHandle(ref, () => ({
  isDirty: () => dirty,
  save,  // save function defined earlier
  reset: () => { void load(); },
}), [dirty, load]);  // ← Missing 'save'! Stale closure!
```

**Why this matters**: Without `save` in dependencies, the ref points to an OLD version with stale state closures. Fast typing causes the save function to only capture the first character.

### Allocation Prefill Race Conditions

Manual allocation modes auto-prefill companies when empty.

**✅ Correct Pattern**:
```typescript
const load = React.useCallback(async () => {
  manualCompanyPrefilledRef.current = false;  // ← Reset at START
  setLoading(true);
  // ... fetch and process data
  if (loadedMethod === 'manual_company') {
    setRows(loadedData);
    manualCompanyPrefilledRef.current = true;  // ← Set after rows loaded
  }
  setLoading(false);
}, [deps]);

React.useEffect(() => {
  if (isManualCompany && !loading) {  // ← Guard with loading state
    void prefillManualCompanyRows();
  }
}, [isManualCompany, prefillManualCompanyRows, loading]);
```

**Why this matters**: Without guards, prefill races with data loading. When `setMethod('manual_company')` fires before `setRows()` flushes, it prefills "all companies" and overwrites loaded data.

---

## Canonical Item URL and Prev/Next Navigation

A workspace can be opened with the item's UUID (a link from an old bookmark, an API response) or with its business reference (`PRJ-12`, `T-4`, `AST-7`). The address bar always ends up showing the reference.

**Rewrite the URL with `window.history.replaceState`, never with a router `navigate`.**

```tsx
React.useEffect(() => {
  if (!data?.item_number) return;
  const isUuid = /^[0-9a-f]{8}-/.test(params.id || '');
  // Rewrite only once the loaded item is the one in the route: during a placeholder
  // navigation `data` is briefly still the previous item.
  if (isUuid && data.id === params.id) {
    const ref = formatItemRef('project', data.item_number);
    window.history.replaceState(null, '', location.pathname.replace(params.id, ref) + location.search);
  }
}, [data?.id, data?.item_number, params.id, location.pathname, location.search]);
```

A router `navigate(..., { replace: true })` changes the route param, which re-keys the query cache. The page mounts a second time, fetches the item again and shows the progress bar twice. `replaceState` is silent: one mount, one fetch.

Related rules for a smooth load:

- Keep `placeholderData` for the detail query across item changes, and do not blank the form when the id changes. Blanking makes the whole page flash on every prev/next click.
- The canonicalisation effect must check that the loaded data matches the current route (see the guard above), or it rewrites the URL to the previous item's reference.

**Prev/next hooks index with the loaded UUID, not the route parameter.** `useModuleItemNav` (`frontend/src/hooks/useModuleItemNav.ts`) looks the current item up with `ids.indexOf(id)` in the list of UUIDs returned by the module's `/ids` endpoint. If a page passes the route reference (`PRJ-12`) the lookup fails and prev/next and the counter are wrong or missing. Pages pass the loaded item's `id`, gated by a `*MatchesCurrentRoute` check that hides the counter while a placeholder is on screen.

**`/ids` endpoints return a parallel `refs` array.** `GET .../ids` answers `{ ids, refs, total }`, where `refs[i]` is the business reference of `ids[i]` (for projects `PRJ-<n>`). The hook returns `refs[i ± 1]` for prev and next, and falls back to the UUID when a reference is missing. Navigation then lands directly on the canonical URL, with no UUID flash. A module whose endpoint returns no `refs` still works and navigates by UUID. Add the reference column to the endpoint's query when you build a new workspace.

---

## Filter Preservation Pattern

When navigating between list pages and workspace pages, filters must be preserved bidirectionally.

### List Page → Workspace

List pages capture grid state and pass it to the workspace via URL parameters:

```tsx
// List page (e.g., TasksPage.tsx)
const lastQueryRef = useRef<{ sort: string; q: string; filters: any } | null>(null);

// Capture grid state on query changes
<ServerDataGrid
  onQueryStateChange={(state) => {
    lastQueryRef.current = { sort: state.sort, q: state.q || '', filters: state.filterModel || {} };
  }}
/>

// Build URL params for workspace navigation
const buildWorkspaceSearch = useCallback(() => {
  const sp = new URLSearchParams();
  const sort = lastQueryRef.current?.sort || 'created_at:DESC';
  const q = lastQueryRef.current?.q || '';
  const filters = lastQueryRef.current?.filters || {};
  if (sort) sp.set('sort', sort);
  if (q) sp.set('q', q);
  if (filters && Object.keys(filters).length > 0) sp.set('filters', JSON.stringify(filters));
  return sp;
}, []);

// Navigate to workspace with context
navigate(`/items/${row.id}/overview?${buildWorkspaceSearch().toString()}`);
```

### Workspace → List Page

Workspace pages preserve URL params when closing or navigating:

```tsx
// Workspace page (e.g., TaskWorkspacePage.tsx)
const handleBack = () => {
  // Preserve all URL params when returning to list
  navigate(`/items?${searchParams.toString()}`);
};
```

### List Page Filter Restoration

**Critical**: List pages must read filters from URL and apply them as initial grid state:

```tsx
// List page must read and apply URL filters
const location = useLocation();

const urlFilters = useMemo(() => {
  const params = new URLSearchParams(location.search);
  const filtersParam = params.get('filters');
  if (filtersParam) {
    try { return JSON.parse(filtersParam); } catch { return null; }
  }
  return null;
}, [location.search]);

// Default filter (e.g., hide completed items)
const defaultFilterModel = {
  status: { filterType: 'text', type: 'notContains', filter: 'done' }
};

// Use URL filters if present, otherwise use default
const initialFilterModel = useMemo(() => {
  return urlFilters || defaultFilterModel;
}, [urlFilters]);

// Pass to grid
<ServerDataGrid
  initialState={{ filter: { filterModel: initialFilterModel } }}
  // ...
/>
```

### Scope Filters (Task Example)

Pages with a "My / My team's / All" scope filter use the `useGridScopePreference` hook to persist the selection per tenant and user. The URL param takes priority when returning from workspace navigation.

```tsx
import { useGridScopePreference } from '../hooks/useGridScopePreference';

// Read scope from URL (returning from workspace preserves context)
const urlTaskScope = useMemo(() => {
  const params = new URLSearchParams(location.search);
  const scope = params.get('taskScope');
  return (scope === 'my' || scope === 'team' || scope === 'all') ? scope : null;
}, [location.search]);

// useGridScopePreference handles persistence to localStorage
// Priority: URL param > localStorage > default ('my')
// Key: kanap-grid-scope:{tenantSlug}:{userId}:tasks
const [taskScope, setTaskScope] = useGridScopePreference('tasks', urlTaskScope);

// Guard: coerce 'team' back to 'my' if user has no team
useEffect(() => {
  if (taskScope === 'team' && isTeamConfigFetched && !hasTeam) {
    setTaskScope('my');
  }
}, [taskScope, isTeamConfigFetched, hasTeam, setTaskScope]);

// Include scope in workspace URL for round-trip preservation
const buildWorkspaceSearch = useCallback(() => {
  const sp = new URLSearchParams();
  // ... standard params
  sp.set('taskScope', taskScope);  // 'my', 'team', or 'all'
  if (taskScope === 'my' && profile?.id) {
    sp.set('assigneeUserId', profile.id);
  } else if (taskScope === 'team' && myTeamConfig?.team_id) {
    sp.set('teamId', myTeamConfig.team_id);
  }
  return sp;
}, [taskScope, profile?.id, myTeamConfig?.team_id]);
```

Pages using this pattern: Tasks (`tasks`), Requests (`requests`), Projects (`projects`), Apps & Services (`apps`). The `pageKey` must be unique per page. Requests and Projects already had team-scope guards; Tasks and Apps had guards added alongside the hook.

### Navigation Hooks with Extra Params

Workspace pages pass scope params to navigation hooks for correct prev/next behavior:

```tsx
// Workspace page - pass scope params to navigation hook
const assigneeUserId = searchParams.get('assigneeUserId') || undefined;
const teamId = searchParams.get('teamId') || undefined;

const navExtraParams = useMemo(() => {
  const params: Record<string, string | undefined> = {};
  if (assigneeUserId) params.assigneeUserId = assigneeUserId;
  if (teamId) params.teamId = teamId;
  return Object.keys(params).length > 0 ? params : undefined;
}, [assigneeUserId, teamId]);

const nav = useTaskNav({ id, sort, q, filters, extraParams: navExtraParams });
```

### Backend Support

Backend `/ids` endpoints must support the same filter params:

```typescript
// tasks-list.service.ts
async listIds(query: any, opts?: ServiceOpts): Promise<{ ids: string[] }> {
  // ... standard filtering ...

  // Scope filters (assigneeUserId or teamId)
  if (query?.assigneeUserId) {
    qb.andWhere('t.assignee_user_id = :assigneeUserId', { assigneeUserId: query.assigneeUserId });
  }
  if (query?.teamId) {
    qb.andWhere(`t.assignee_user_id IN (
      SELECT user_id FROM portfolio_team_member_configs WHERE team_id = :teamId
    )`, { teamId: query.teamId });
  }

  // ... rest of query
}
```

---

## Grid Navigation Pattern

List grids deep-link to workspace tabs based on column clicked.

**✅ Correct Pattern**:
```typescript
const onCellClicked = useCallback((params: any) => {
  const colId = params?.column?.getColId?.() || params?.colDef?.colId;
  const row = params?.data;

  const go = (tab: string, year?: number) => {
    const s = new URLSearchParams(listContext);
    if (year) s.set('year', String(year));
    navigate(`/ops/opex/${row.id}/${tab}?${s.toString()}`);
  };

  // Allocation columns
  if (colId === 'yAllocation') return go('allocations', Y);
  if (colId === 'yPlus1Allocation') return go('allocations', Y + 1);

  // Budget columns
  if (colId === 'yBudget') return go('budget', Y);
  if (colId === 'yPlus1Budget') return go('budget', Y + 1);

  // Default to overview
  return go('overview');
}, [navigate, Y, listContext]);
```

---

## Year-Aware Editors (Budget/Allocations)

### Year Navigation Component
```tsx
<YearTabs
  currentYear={year}
  onChange={(newYear) => {
    if (editorRef.current?.isDirty()) {
      const confirm = await showDirtyDialog();
      if (!confirm) return;
    }
    setYear(newYear);
  }}
/>
```

### Year-Specific Data Loading
```typescript
const { data: version } = useQuery({
  queryKey: ['version', itemId, year],
  queryFn: () => api.get(`/items/${itemId}/versions?year=${year}`)
});
```

---

## Deep Linking from Lists

### Pattern
When clicking grid cells, open workspace on correct tab/year:

```typescript
// In list page
<ServerDataGrid
  onCellClicked={(params) => {
    const colId = params.column.getColId();
    const year = extractYearFromColumn(colId);
    const tab = mapColumnToTab(colId);

    navigate(`/items/${params.data.id}/${tab}?year=${year}&${listContext}`);
  }}
/>
```

**Column Mapping**:
- Allocation columns → `/allocations` tab
- Budget columns → `/budget` tab
- Task column → `/tasks` tab
- Others → `/overview` tab

---

## Create Mode Pattern

### Route Structure
```
/items/new/overview  → Create-only route
```

### Simple Create Mode (Minimal Form)

For entities with few required fields, use a minimal create form:

```tsx
export const ItemCreateEditor = forwardRef((props, ref) => {
  const navigate = useNavigate();

  const save = async () => {
    const response = await api.post('/items', formData);
    // Redirect to full workspace after creation
    navigate(`/items/${response.id}/overview?${listContext}`);
  };

  useImperativeHandle(ref, () => ({
    isDirty: () => dirty,
    save,
    reset: () => { setFormData(initialState); }
  }), [dirty, save]);

  return (
    <form>
      {/* Only essential fields for creation */}
    </form>
  );
});
```

**Shell Behavior**:
- Disable non-overview tabs until item is created
- Show hint: "Other tabs will be available after you create the item."
- After save, redirect to full workspace with all tabs enabled

### Full Workspace Create Mode (Jira-style)

For entities requiring context selection or many fields, render the full workspace in create mode:

**Reference Implementation:** `frontend/src/pages/tasks/TaskWorkspacePage.tsx`

**Key Patterns:**

1. **Relation Selection Component:**
```tsx
// Two-dropdown pattern for selecting relation type and item
<RelatedObjectSelect
  relationType={createRelation.type}
  relationId={createRelation.id}
  onChangeType={(type) => setCreateRelation({ type, id: null, name: null })}
  onChangeId={(id, name) => setCreateRelation({ ...createRelation, id, name })}
/>
```

2. **Create Form State:**
```tsx
const [createRelation, setCreateRelation] = useState<{
  type: RelatedObjectType;
  id: string | null;
  name: string | null;
}>({ type: null, id: null, name: null });
```

3. **Default Values:**
```tsx
useEffect(() => {
  if (isCreate && profile?.id) {
    setForm({
      status: 'open',
      priority_level: 'normal',
      assignee_user_id: profile.id,
      creator_id: profile.id,
      // ... other defaults
    });
    setInitialized(true);
  }
}, [isCreate, profile?.id]);
```

4. **Validation:**
```tsx
const isCreateValid = Boolean(
  title.trim() &&
  createRelation.type &&
  createRelation.id
);

<Button disabled={!isCreateValid || saving}>Create</Button>
```

5. **Conditional Sidebar Content:**
```tsx
// In sidebar component
{isCreate ? (
  <RelatedObjectSelect {...props} />
) : (
  <ReadOnlyLink to={relationUrl}>{relationName}</ReadOnlyLink>
)}
```

6. **Hide Unavailable Features:**
```tsx
// Time logging, attachments, activity - require entity ID
{!isCreate && (
  <TimeAccordion ... />
)}
```

**Full Documentation:** See `planning/portfolio/phase-11e-create-task-form.md`

---

## Testing Checklist

When implementing a new workspace:

### Backend
- [ ] RLS enabled on all tables (`npm run test:rls` passes)
- [ ] Table added to tenant deletion script in correct order
- [ ] Status filter applied to list endpoints
- [ ] CSV import/export includes `disabled_at` column
- [ ] Request-scoped EntityManager used everywhere
- [ ] Audit logging wired for all mutations

### Frontend
- [ ] **Rapid typing test**: Type quickly in text fields, click Save → full text saved (not just one character)
- [ ] **First-load test**: Direct navigation to tab loads correct data (no race conditions)
- [ ] **Account persistence test** (OPEX/CAPEX): Select company + account, save → account remains visible (doesn't disappear)
- [ ] **CoA filtering test**: Company WITH CoA shows only accounts from that CoA; company WITHOUT CoA shows only legacy accounts
- [ ] **Obsolete account warning**: When account's CoA ≠ company's CoA, warning appears
- [ ] **RichTextEditor test** (if applicable): Navigate to page → description loads; refresh page → description still loads; edit → saves correctly
- [ ] Prev/Next navigation preserves list context
- [ ] Year switching guards against dirty state
- [ ] Close returns to list with same filters/sort
- [ ] Deep links from grid open correct tab/year
- [ ] Create mode shows only overview tab
- [ ] Status lifecycle field works (toggle + date picker)
- [ ] All tabs have explicit Save/Reset buttons
- [ ] Dirty guards prevent accidental data loss

### Integration
- [ ] Multi-tenant smoke test (data isolated between tenants)
- [ ] Freeze state blocks editing (for master data with metrics)
- [ ] CSV round-trip preserves all fields
- [ ] Allocation recomputation uses correct year metrics
- [ ] Historical queries include disabled items for relevant periods

---

## Common Pitfalls

### 1. Stale Closures in useImperativeHandle
**Symptom**: Saving only captures first character of typed text
**Fix**: Include `save` function in dependency array

### 2. Allocation Prefill Race
**Symptom**: Direct navigation shows "all companies" instead of saved selection
**Fix**: Reset prefill flag at START of load(), guard effect with `!loading`

### 3. Missing RLS Policies
**Symptom**: Cross-tenant data leaks in production
**Fix**: Always run `npm run test:rls` before deployment

### 4. Forgotten Tenant Deletion Entry
**Symptom**: Tenant deletion fails with foreign key errors
**Fix**: Add table to purge order in `admin-tenants.service.ts`

### 5. Incorrect Status Filtering
**Symptom**: Disabled items disappear from historical reports
**Fix**: Use `applyStatusFilter` with `periodStart` for historical queries

### 6. Direct DataSource Usage
**Symptom**: Queries ignore tenant context
**Fix**: Always use request-scoped EntityManager from TenantInterceptor

### 7. Clearing Account on Company Change
**Symptom**: Account disappears after save/refetch in OPEX/CAPEX
**Fix**: Remove `useEffect` that clears account when company changes; backend handles CoA filtering

### 8. Virtual Field Sorting/Filtering Errors
**Symptom**: PostgreSQL errors like "column does not exist" when sorting/filtering by enriched fields
**Fix**: Map virtual fields to actual DB columns before query (e.g., `coa_code` → `coa_id`)

### 9. RichTextEditor Shows Empty on Refresh
**Symptom**: Description field is empty after page refresh, but loads correctly when navigating from list
**Fix**: Use deferred rendering pattern - don't mount RichTextEditor until `initialized` flag is set after data sync. See "RichTextEditor Integration" section above.

---

## Related Documentation

- **Specific Implementations**:
  - OPEX: `doc/spend-workspace.md`
  - Contracts: `doc/contracts-workspace.md`
- **Architecture**:
  - Multi-tenancy: `doc/architecture.md` (Multitenancy section)
  - Frontend: `doc/frontend-architecture.md`
  - API: `doc/api-reference.md`
- **Operations**:
  - Tenant Management: `doc/page-and-feature-overview.md` (Tenant Lifecycle section)
  - Status Lifecycle: Implemented patterns documented here

---

## Quick Reference

### Backend Checklist for New Workspace
1. Add `tenant_id` + RLS policies
2. Use request-scoped EntityManager
3. Apply status filter to lists
4. Add table to deletion script
5. Run RLS self-test
6. Add CSV import/export

### Frontend Checklist for New Workspace
1. Create shell with tabs
2. Implement editor with correct `useImperativeHandle` deps
3. Add Prev/Next/Close navigation
4. Guard dirty state on tab/year changes
5. Deep link from grid to tabs
6. Test rapid typing and race conditions
7. If using RichTextEditor: use deferred rendering pattern (initialized flag)

### Critical Files to Update
- `backend/src/admin/tenants/admin-tenants.service.ts` (deletion order)
- `backend/src/migrations/*.ts` (RLS policies)
- Entity files (tenant_id, status, disabled_at columns)
- Frontend workspace shell + editors
- AG Grid cell click handlers (deep linking)

---

**Document Owner**: Engineering Team
**Review Cadence**: Update when new patterns emerge from workspace implementations
