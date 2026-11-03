# Business Processes Master Data (ISO 9001-style Core Processes)

Status: current  
Last Updated: 2026-11-03 (lot 26.11 H1: type and hierarchy in place of categories)

This document describes the Business Processes master data used across the app to model ISO 9001-style business processes (Order-to-Cash, Procure-to-Pay, Hire-to-Retire, etc.) and their hierarchy.

It covers:
- The data model: ISO 9001 type and process tree
- Permissions and RLS behavior
- Frontend list + workspace UX
- CSV import/export
- Search, history and the assistant
- How other modules should integrate with this master data

---

## Concepts

- **Business Process**: A named end-to-end process such as "Order-to-Cash (O2C)" or "Hire-to-Retire (H2R)". Each process:
  - Has a human-readable name that includes the short code in parentheses (e.g. `Order-to-Cash (O2C)`). Names are unique per tenant, whatever the case.
  - Has a description and internal notes.
  - Has an optional **type** (ISO 9001) and an optional **parent process**.
  - Has lifecycle fields (`status`, `disabled_at`) to support enable/disable semantics.
  - Has a **Process Owner** and an **IT Owner** (user references).

- **Type** (`process_type`): `management` (steering, "pilotage"), `core` (realisation, the value chain) or `support`. Optional. A sub-process does not inherit the type of its parent: each process carries its own.

- **Hierarchy** (`parent_id`): processes form a tree, as cost centers do. A top-level process has no parent. There is no depth limit. The tree is the only grouping: the former categories no longer exist.

The Business Processes master data is tenant-scoped and RLS-protected.

---

## Data Model

### Table `business_processes`

- `id uuid PK`
- `tenant_id uuid NOT NULL DEFAULT app_current_tenant()`
- `name text NOT NULL`  
  - Includes the code, e.g. `Order-to-Cash (O2C)`.
- `description text NULL`
- `notes text NULL`
- `process_type text NULL`  
  - CHECK `business_processes_process_type_check`: `management`, `core` or `support`, or null.
- `parent_id uuid NULL`  
  - Composite foreign key `business_processes_parent_fk`: `(tenant_id, parent_id)` → `business_processes (tenant_id, id)`, `ON DELETE NO ACTION`. It relies on `UNIQUE (tenant_id, id)` (`business_processes_tenant_id_id_key`).
  - CHECK `business_processes_not_own_parent_check`: `parent_id IS NULL OR parent_id <> id`.
- `status status_state NOT NULL DEFAULT 'enabled'`
- `disabled_at timestamptz NULL`
- `owner_user_id uuid NULL` → FK to `users(id) ON DELETE SET NULL`
- `it_owner_user_id uuid NULL` → FK to `users(id) ON DELETE SET NULL`
- `is_default boolean NOT NULL DEFAULT false` (internal flag set by the original seeding migration)
- `created_at timestamptz NOT NULL DEFAULT now()`
- `updated_at timestamptz NOT NULL DEFAULT now()`

Indexes:
- `idx_business_processes_tenant_status(tenant_id, status)`
- `idx_business_processes_owner_user(owner_user_id)`
- `idx_business_processes_it_owner_user(it_owner_user_id)`
- `idx_business_processes_unique_name(tenant_id, lower(name))` (unique name per tenant)
- `idx_business_processes_tenant_parent(tenant_id, parent_id)`

RLS:
- Enabled and forced.
- Tenant isolation policy: `tenant_id = app_current_tenant()` for both `USING` and `WITH CHECK`.

### Migration `1856170000000-business-process-type-and-parent`

- Adds `process_type`, `parent_id`, the constraints and the parent index. Idempotent: every step checks what exists.
- Drops `business_process_categories` and `business_process_category_links` with their data and the search trigger of the links. No data is kept. Existing processes start with no type and no parent.
- Redefines `search_index_refresh_business_processes` (SECURITY DEFINER, `search_path` pinned): the entry reads the type in place of the first category. It then refreshes the entries tenant by tenant.
- `down()` recreates empty category tables and restores the previous search function.

### Tree rules

Code: `backend/src/business-processes/business-process-tree.ts`.

- A parent must exist in the same tenant (`BUSINESS_PROCESS_PARENT_NOT_FOUND`).
- A process cannot be its own parent (`BUSINESS_PROCESS_OWN_PARENT`).
- A process cannot move under one of its own sub-processes (`BUSINESS_PROCESS_PARENT_CYCLE`, with the two names). The service walks up from the new parent in the stored tree.
- Create, update and CSV import take a per-tenant advisory lock (`business-process-tree:<tenant>`) before checking, so two moves cannot make a cycle together.
- Deleting a process that has sub-processes is refused (`BUSINESS_PROCESS_HAS_SUB_PROCESSES`); the foreign key is `NO ACTION` as a second guard.
- The path of a process is the names from the top joined by ` › `. The SQL helper stops after 100 steps, so a cycle (never written by the service) cannot loop. A process whose parent is missing is shown as a root.

### Ownership fields

- **Process Owner** (`owner_user_id`): the business/functional owner. Shown in the list as the user's name, else the e-mail.
- **IT Owner** (`it_owner_user_id`): the IT contact responsible for the tools and systems supporting the process. Shown in the workspace only.

---

## Permissions and RLS

### Resource key

- `resource = 'business_processes'`, wired in `PermissionsService.RESOURCES` and available in the RBAC UI.

### Levels

- **Reader (`business_processes:reader`)**
  - `GET /business-processes`, `/business-processes/ids`, `/business-processes/tree`, `/business-processes/:id`
  - `GET /business-processes/:id/applications` (the list is empty without `applications:reader`)
  - Pickers on other pages use `GET /business-processes/lookup`, open to the roles that pick a process.

- **Member (`business_processes:member`)**
  - All reader capabilities, plus:
    - `POST /business-processes`, `PATCH /business-processes/:id`
    - `POST` and `DELETE /business-processes/:id/applications...` (also needs `applications:reader`)
    - `GET /business-processes/:id/creation` and `DELETE /business-processes/:id/creation` (cancel a process the person just created, with the creation token)
  - Can create and edit processes: name, type, parent, description, notes, owners, lifecycle.

- **Admin (`business_processes:admin`)**
  - All member capabilities, plus:
    - `POST /business-processes/delete-check`
    - `DELETE /business-processes/bulk`, `DELETE /business-processes/:id`
    - `GET /business-processes/export`, `POST /business-processes/import`

The full list of routes, bodies and refusal codes is in `doc/api-reference.md`, section "Business Processes (Master Data)".

### Default assignment

The Administrator role gets `business_processes:admin` per tenant. All queries run under `app_current_tenant()` and only see the calling tenant's data.

---

## Frontend UX

### Navigation

- **Master Data Sidebar**: `Master Data → Business Processes` (`/master-data/business-processes`). Requires `business_processes:reader`.
- **Master Data landing page**: entry for Business Processes (`ModuleLanding`).

### List

Route: `/master-data/business-processes`  
Component: `frontend/src/pages/BusinessProcessesPage.tsx`

- Columns:
  - `Name` (clickable cell, opens the workspace). Indented by tree depth while the list is sorted by path.
  - `Type` (Management, Core, Support). Checkbox set filter.
  - `Parent process` (parent's name). Checkbox set filter that lists the processes having sub-processes.
  - `Process Owner` (display-only).
  - `Status` and `Updated`: hidden by default, available in the column chooser.
- Default sort: `path:ASC`, the tree order (each process right after its parent, siblings by name). Any other column sorts flat, without indentation. Sorting on `Type` follows the ISO order (management, core, support), then the processes without a type.
- Default scope: enabled processes. A disabled parent with enabled sub-processes leaves the sub-processes shown at their indentation.
- Actions (top-right):
  - `New` (member): opens the new process page.
  - `Import` (admin) and `Export` (admin): the export follows the list (search, filters, scope, sort) or the whole register.
  - `Delete selected` (admin): asks `POST /business-processes/delete-check` first, then `DELETE /business-processes/bulk`. A process used by applications or interfaces, or that has sub-processes, is refused with the reason.
- Navigation context: `sort`, `q`, `filters` and `scope` are carried in the URL to the workspace, so Close and prev/next stay on the same list.

### Workspace

Route: `/master-data/business-processes/:id/:tab` (`overview`, `relations`, `history`); `new` as id for a new process.  
Component: `frontend/src/pages/business-processes/BusinessProcessWorkspacePage.tsx`  
Fields: `BusinessProcessFields.tsx`. Built on the record shell (`PortfolioDetailWorkspaceShell`), as the other record pages.

Header:
- The process name, editable in place. Prev/next arrows walk the current list (`/business-processes/ids`, same sort and filters).
- Status menu (Enabled / Disabled). Disabling sets the end of validity now.
- Saving / Saved indicator: every field saves itself on change, with no Save button.
- Delete (admin) and Close.

New process: the page opens with the title to type. Entering the name creates the process at once (`POST /business-processes` with the name), enabled, and moves to it with **Create** and **Cancel**. Cancel deletes it with the creation token, even without the admin level, while nobody else has written on it. The other fields are drawn dimmed until the name exists.

Tabs:
- **Overview**: `Description` and `Notes` (long texts, saved when the field loses focus).
- **Relations**: the applications that use the process (link, unlink). Shown only with `applications:reader`; not available while the process is being created.
- **History**: the common record history (fields, including type and parent, and application links).

Properties panel (right):
- `Type`: select, "Not set" by default.
- `Parent process`: `BusinessProcessParentSelect`, an autocomplete on `GET /business-processes/tree`, loaded when first opened. Options are indented by depth and searched on the full path (a match keeps its ancestors). The process and its sub-processes are left out. Disabled processes stay pickable, marked Disabled. Empty means top level.
- `Process owner` and `IT owner`: user pickers.
- `Lifecycle`: status switch and end-of-validity date.

Permissions: without `business_processes:member`, the fields are read-only. A refused move (cycle, unknown parent) shows the server message above the fields.

---

## CSV Import/Export

Endpoints: `/business-processes/export` and `/business-processes/import` (admin). Frontend: `CsvExportDialog` / `CsvImportDialog`, shared CSV and Excel layer (`common/csv-sheet`).

### Export

- `scope=template`: header only. `scope=data`: the processes the list shows, or all of them.
- Columns: `name;process_type;parent_name;description;notes;status`
  - `process_type`: `management`, `core`, `support` or empty.
  - `parent_name`: the parent's name, empty at the top.
  - `status`: `enabled` or `disabled`.
- Format, separator and encoding follow the shared layer (see `doc/api-reference.md`).

### Import

- Dry run (preflight) then load. The header must match; `name` is required; `status` is `enabled` or `disabled`; `process_type` is one of the three codes.
- Rows are matched by `name`, case-insensitive: a match updates, a new name inserts. A name twice in the file is a row error.
- `parent_name` is matched case-insensitive against the file first, then the stored processes. An unknown name is a row error. A row under itself, or under one of its own sub-processes in the tree the file would make, is refused. Rows may come in any order: parents are written before their children.
- The import holds the tree lock from the check to the last write.
- A row identical to the stored process counts as unchanged and is not written.

---

## Search, history and the assistant

- **Search index**: the entry holds the name, status, type, description and notes (`extra_json.process_type`). The trigger that followed the category links is gone.
- **Record history**: `process_type` and `parent_id` are shown fields (`parent_id` names the parent). Rows written before 26.11 may carry category names; they are hidden.
- **Assistant read side** (registry `business-processes.registry.ts`): filters and groups on `status`, `name`, `process_type` and `parent`; sorts also on `path`; the filter `under` gives every process below a named one at all levels. Rows and details carry `process_type`, `parent`, `path` and `sub_processes`.
- **Assistant write side** (create and update of master data, under approval): `process_type` and `parent_id` (the parent by name). The service applies the same tree refusals as the screen.
- **Inventories**: `business_process_categories` and `business_process_category_links` are gone from the tenant isolation inventory, the purge inventory and `scripts/tenant-export.sh`.

---

## Integration Guidelines

Business Processes are reused where end-to-end processes matter: applications (`application_business_processes`), interfaces (`interfaces.business_process_id`) and portfolio requests (`portfolio_request_business_processes`).

1. **Reference by ID.** Store the process id on the domain table, never the name. Use `GET /business-processes/lookup` for a picker. Use `GET /business-processes/tree` when the picker should show the hierarchy.
2. **Hierarchy.** A link names one process, at any level. Reports that group by a process choose their level themselves: the tree gives each node its `path` and `path_ids`. Nothing rolls up automatically: a link on a sub-process is not a link on its parent.
3. **Type.** `process_type` is a property of the process alone. Do not derive it from the parent.
4. **Ownership.** Use `owner_user_id` and `it_owner_user_id` to route tasks, approvals and notifications. Edit ownership in the Business Process workspace only.
5. **Lifecycle.** Honor `status`/`disabled_at`: disabled processes are not offered for new items; existing links stay visible and may show an inactive marker.
6. **Delete.** A process used by applications or interfaces cannot be deleted (`BUSINESS_PROCESS_IN_USE`): disable it. A process with sub-processes cannot be deleted either (`BUSINESS_PROCESS_HAS_SUB_PROCESSES`): move or delete them first. Requests linked to a deleted process keep existing without the link.

### When NOT to use Business Processes

- Very granular workflow steps or tasks.
- Purely IT-centric technical flows (Interfaces / Integrations model those).
- Temporary projects or initiatives (Projects / Tasks).

Business Processes are for stable, medium to long term processes that appear in ISO 9001, operating models and high-level SOPs.

---

## Tenant Purge Behavior

During tenant deletion (admin purge) and tenant reset, `business_processes` is removed after the tables that link to it, tenant-scoped via `tenant_id = app_current_tenant()` and honoring RLS (`backend/src/admin/tenants/tenant-purge.inventory.ts`). The foreign key on `parent_id` is `NO ACTION` and is checked at the end of the statement, so a whole-table delete is valid.
