# Business Processes

Business Processes let you build and maintain a centralized catalog of your organization's core end-to-end processes -- things like Order-to-Cash, Procure-to-Pay, or Hire-to-Retire. By keeping process names, categories, and owners in one place, you create a single reference point that the rest of KANAP can link to for ownership, reporting, and audits.

## Getting started

Navigate to **Master Data > Business Processes** to open the list.

**Required fields**:

- **Name**: the process name, ideally including a short code (e.g. "Order-to-Cash (O2C)").

**Permissions**:

- View: `business_processes:reader`
- Create / edit: `business_processes:manager`
- Delete, import/export CSV: `business_processes:admin`

If the page is missing or fields are read-only, ask your tenant admin to adjust your role permissions.

---

## Working with the list

The list shows all business processes for your tenant.

**Default columns**:

- **Name** -- the process name. Click to open the workspace.
- **Categories** -- one or more categories the process belongs to (e.g. "Customer & Sales", "Finance & Controlling"). Multiple categories are shown as a comma-separated list.
- **Process Owner** -- the user responsible for the process.

**Additional columns** (hidden by default; enable them with the column chooser):

- **Status** -- `enabled` or `disabled`.
- **Updated** -- when the process was last modified.

**Filtering and sorting**:

- Quick search filters across all visible columns.
- Use the **Show: All / Enabled / Disabled** toggle above the list to choose which processes appear. The list shows enabled processes by default.
- The default sort groups rows by **Categories**, then by **Name**.

**Actions** (top-right toolbar):

- **New** (Manager+) -- create a new business process.
- **Manage Categories** (Manager+) -- open the category management dialog.
- **Import CSV** (Admin) -- bulk-import processes from a CSV file.
- **Export CSV** (Admin) -- export all processes to CSV.
- **Delete Selected** (Admin) -- delete one or more selected rows.

---

## The Business Process workspace

Click any row in the list -- or the **New** button -- to open the workspace.

The workspace has a single **Overview** tab on the left, and a toolbar across the top:

- **Prev / Next** -- step through processes in the current list order.
- **Reset** -- discard unsaved changes.
- **Save** -- persist changes.
- **Close** (X icon) -- return to the list, keeping your filters and sort intact.

If you navigate away with unsaved changes, you will be prompted to save or discard them.

### Overview

The Overview tab is organized into three sections.

**Basic info**

- **Name** (required) -- use a clear name including the short code, e.g. "Order-to-Cash (O2C)" or "Hire-to-Retire (H2R)".
- **Description** -- a short summary of what the process covers. A good description captures the start and end points (e.g. "From customer order through delivery, invoicing, and payment received.").
- **Status switch** -- labelled with the current state (**Enabled** or **Disabled**). Enabled processes appear in selectors across the app. Disable a process to retire it without deleting it, so historical references stay intact.

**Classification**

- **Categories** (multi-select) -- assign one or more categories. You can pick from existing categories, create a new one inline with **New category**, or click **Edit categories** to open the full category management dialog.
- **Process Owner** -- the user ultimately responsible for the process. Shown in the list grid and available for future notifications and approvals.
- **IT Owner** -- the user responsible for the IT systems and tools that support this process.

**Details**

- **Notes** -- free-form field for internal information such as links to process maps, SOPs, scope notes, or improvement plans.

---

## Managing categories

Categories are shared across all business processes. You can manage them from two places:

1. On the list page, click **Manage Categories**.
2. In the workspace, under the **Categories** field, click **Edit categories**.

Both open the **Manage Business Process Categories** dialog.

**What you can do**:

- **Rename** -- edit the name directly in the text field.
- **Activate / Deactivate** -- toggle whether a category appears in selectors. Inactive categories are hidden from new assignments but preserved on existing processes.
- **Delete** -- remove a category. Deletion only works if no process is using it; otherwise, you will see an error.
- **New category** -- add a new row at the top of the dialog.

**Save and cancel behavior**:

- Nothing is saved until you click **Save**. While the dialog is open, all changes are tracked locally.
- **Cancel** closes the dialog and discards everything you changed.
- If an error occurs on save (e.g. a duplicate name or a category still in use), the dialog stays open so you can correct the problem.

---

## CSV import/export

Use CSV import and export for bulk onboarding or offline editing of your process catalog. Both require **Admin** access.

### Exporting

Click **Export CSV** on the list page. You can export:

- A **template** (header row only) to use as a starting point.
- **Data** (all processes for the current tenant).

The file uses semicolons (`;`) as separators and is encoded as UTF-8 with BOM for Excel compatibility.

**Columns**: `name`, `categories`, `description`, `notes`, `status`.

The `categories` column may contain multiple category names separated by semicolons inside the cell (e.g. `Customer & Sales; Finance & Controlling`).

### Importing

Click **Import CSV** on the list page, then:

1. Upload your CSV file (must match the template headers and use `;` as separator).
2. Run the **Preflight** check -- this validates headers and data, and shows how many rows will be created vs. updated.
3. If preflight passes, click **Load** to apply changes.

**Matching rules**:

- Rows are matched by **Name** (case-insensitive). A matching name updates the existing process; a new name creates a new process.
- Each category in the `categories` cell is trimmed and matched by name. If a category does not exist yet, it is created automatically as an active category.
- The `status` column sets enabled/disabled state. Lifecycle dates are not imported -- adjust them in the workspace if needed.

**Tip**: export your current data first, modify the CSV, and re-import. This avoids accidental duplicates and ensures you are working from the latest state.

---

## Tips

- **Naming convention** -- stick to the "Plain Name (CODE)" format (e.g. "Order-to-Cash (O2C)") so processes are easy to search and recognizable at a glance.
- **Retire, don't delete** -- disable processes you no longer use instead of deleting them. This preserves historical references and audit trails.
- **Categories first** -- set up your category structure before importing processes in bulk. The import will auto-create missing categories, but planning ahead keeps things tidy.
- **Process Owner early** -- assigning a Process Owner now means ownership data is already in place when future features like notifications and task routing come online.
