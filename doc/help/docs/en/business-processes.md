# Business Processes

Business Processes let you build and maintain a centralized catalog of your organization's core end-to-end processes, such as Order-to-Cash, Procure-to-Pay, or Hire-to-Retire. By keeping process names, categories, and owners in one place, you create a single reference point that the rest of KANAP can link to for ownership, reporting, and audits.

## Getting started

Navigate to **Master Data > Business Processes** to open the list.

**Required fields**:

- **Name**: the process name, ideally including a short code (e.g. "Order-to-Cash (O2C)").

**Permissions**:

- View: `business_processes:reader`
- Create / edit: `business_processes:member`
- Delete, import and export: `business_processes:admin`

If the page is missing or fields are read-only, ask your tenant admin to adjust your role permissions.

---

## Working with the list

The list shows all business processes for your tenant.

**Default columns**:

- **Name**: the process name. Click to open the workspace.
- **Categories**: one or more categories the process belongs to (e.g. "Customer & Sales", "Finance & Controlling"). Multiple categories are shown as a comma-separated list.
- **Process Owner**: the user responsible for the process.

**Additional columns** (hidden by default; enable them with the column chooser):

- **Status**: `enabled` or `disabled`.
- **Updated**: when the process was last modified.

**Filtering and sorting**:

- Quick search filters across all visible columns.
- Use the **Show: All / Enabled / Disabled** toggle above the list to choose which processes appear. The list shows enabled processes by default.
- The default sort groups rows by **Categories**, then by **Name**.

**Actions** (top-right toolbar):

- **New** (`business_processes:member`): create a new business process. See [Creating a business process](#creating-a-business-process).
- **Manage Categories** (`business_processes:member`): open the category management dialog.
- **Import** (Admin): bulk-import processes from a CSV file or an Excel workbook.
- **Export** (Admin): export the processes the list shows, or all processes, to a CSV file or an Excel workbook.
- **Delete Selected** (Admin): delete one or more selected rows. A process that applications or interfaces use cannot be deleted: disable it instead. Before anything is deleted, the confirmation lists the processes kept, with the reason. Requests linked to a deleted process stay, without the link.

---

## Creating a business process { #creating-a-business-process }

1. Click **New** on the list. The process page opens with an empty title in the header. The rest of the page is dimmed.
2. Type the process name, ideally with its short code (e.g. "Order-to-Cash (O2C)").
3. Press Enter, or click outside the title. KANAP creates the process at once, enabled, and all tabs open.

Press Escape on the empty title to leave without creating anything. Two processes cannot share a name, whatever the case: a name already used is refused, with a message under the title.

While the process is being created, its header shows **Create** and **Cancel**. They stay until you leave the process.

- **Create** keeps the process and closes it. You go back to where you started: the list or the previous screen. With an empty title, nothing closes and the title asks for one.
- **Cancel** closes without keeping anything. On a process already created, it deletes it, with the application links you added. If you entered more than the name, a confirmation lists what will be deleted. You can cancel your own creation without the right to delete processes.

Leaving the process any other way keeps it.

---

## The Business Process workspace

Click any row in the list to open the workspace. Every change saves on its own: a list or a picker when you choose a value, a text when you leave it. **Saved** shows briefly in the header.

The header holds:

- **Business processes** (back arrow): return to the list, keeping your filters and sort.
- The **name**: click it to rename the process.
- The **previous / next** arrows: step through processes in the current list order.
- **Status**: **Enabled** or **Disabled**. Enabled processes appear in selectors across the app. Disable a process to retire it without deleting it, so historical references stay intact.
- **Delete** (trash icon, Admin): delete the process and return to the list. A process that applications or interfaces use cannot be deleted: the message counts them. Disable it instead.

Without `business_processes:member`, the page opens read only.

### Properties

The properties drawer on the right holds:

- **Categories**: one or more categories. Pick existing ones, create one with **New category**, or open the category management dialog with **Edit categories**.
- **Process owner**: the user ultimately responsible for the process. Shown in the list.
- **IT owner**: the user responsible for the IT systems and tools that support the process.
- **Lifecycle**: the status switch and the end of validity date. A process whose end of validity has passed is disabled.

### Overview

- **Description**: what the process covers, ideally from its start to its end point (e.g. "From customer order through delivery, invoicing and payment received").
- **Notes**: internal information such as links to process maps, procedures, scope notes or improvement plans.

### Relations

The **Applications** section lists the applications that support the process, with their reference, criticality and IT owner. **Add** opens a search; a link saves at once. Hover a row and click its cross to unlink it. The application shows the same link in the **Business processes** section of its Relations tab.

You need `business_processes:member` to change the links. The tab appears only if you can read applications. A Business Contributor sees and links only the applications in their scope.

### History

The changes made to the process and its application links. See [Record history](record-history.md).

---

## Managing categories

Categories are shared across all business processes. You can manage them from two places:

1. On the list page, click **Manage Categories**.
2. In the workspace, under the **Categories** field of the properties drawer, click **Edit categories**.

Both open the **Manage Business Process Categories** dialog.

**What you can do**:

- **Rename**: edit the name directly in the text field.
- **Activate / Deactivate**: toggle whether a category appears in selectors. Inactive categories are hidden from new assignments but preserved on existing processes.
- **Delete**: remove a category. Deletion only works if no process is using it; otherwise the message counts the processes that use it. Disable it instead.
- **New category**: add a new row at the top of the dialog.

**Save and cancel behavior**:

- Nothing is saved until you click **Save**. While the dialog is open, all changes are tracked locally.
- **Cancel** closes the dialog and discards everything you changed.
- If an error occurs on save (e.g. a duplicate name or a category still in use), the dialog stays open so you can correct the problem.

---

## CSV import/export

The export writes a CSV file or an Excel workbook (`.xlsx`): choose under **Format** in the dialog. The import reads either. See [CSV and Excel files](csv-files.md).

Use import and export for bulk onboarding or offline editing of your process catalog. Both require **Admin** access.

### Exporting

Click **Export** on the list page. The file holds the processes the list shows, with its search, filters and sort, or every process when you choose **The whole register** in the dialog. For an empty file with the headers only, use **Download template** in the import dialog.

The separator follows the language of your screen. See [CSV and Excel files](csv-files.md) for the encoding, the separator and the two import steps.

**Columns**: `name`, `categories`, `description`, `notes`, `status`.

The `categories` column may contain multiple category names separated by semicolons inside the cell (e.g. `Customer & Sales; Finance & Controlling`).

### Importing

Click **Import** on the list page, then:

1. Upload your CSV file or Excel workbook with the column titles of the template. In a CSV file, commas or semicolons both work.
2. Run the **Preflight** check. It validates headers and data, and shows how many rows will be created vs. updated.
3. If preflight passes, click **Load** to apply changes.

**Matching rules**:

- Rows are matched by **Name**, whatever the case. A matching name updates the existing process and keeps its stored spelling (the preflight check says which process the row matched); a new name creates a new process.
- Each category in the `categories` cell is trimmed and matched by name. If a category does not exist yet, it is created automatically as an active category.
- The file has no end of validity column. On an update, a blank `status`, or one equal to the process's current status, keeps its end of validity. A different status applies it: `enabled` clears the end of validity, and `disabled` ends the process today unless its end of validity has already passed. A new process is enabled unless the row says `disabled`.

**Tip**: export your current data first, modify the file, and re-import. This avoids accidental duplicates and ensures you are working from the latest state.

---

## Tips

- **Naming convention**: stick to the "Plain Name (CODE)" format (e.g. "Order-to-Cash (O2C)") so processes are easy to search and recognizable at a glance.
- **Retire, don't delete**: disable processes you no longer use instead of deleting them. This preserves historical references and audit trails.
- **Categories first**: set up your category structure before importing processes in bulk. The import will auto-create missing categories, but planning ahead keeps things tidy.
- **Process Owner early**: assigning a Process Owner now means ownership data is already in place when future features like notifications and task routing come online.
