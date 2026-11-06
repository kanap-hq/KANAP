# Business Processes

Business Processes let you build and maintain a centralized catalog of your organization's core end-to-end processes, such as Order-to-Cash, Procure-to-Pay, or Hire-to-Retire. By keeping process names, types, owners and their hierarchy in one place, you create a single reference point that the rest of KANAP can link to for ownership, reporting, and audits.

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

- **Name**: the process name. Click to open the workspace. Indented by level when the list is in tree order.
- **Type**: **Management**, **Core** or **Support**, or empty.
- **Parent process**: the process it sits under, or empty for a top-level process.
- **Process Owner**: the user responsible for the process.

**Additional columns** (hidden by default; enable them with the column chooser):

- **Status**: `enabled` or `disabled`.
- **Updated**: when the process was last modified.

**Filtering and sorting**:

- Quick search filters across all visible columns.
- Use the **Show: All / Enabled / Disabled** toggle above the list to choose which processes appear. The list shows enabled processes by default.
- **Type** and **Parent process** use checkbox filters. The type filter offers Management, Core, Support and No type (processes with an empty type). The parent filter lists the processes that have sub-processes.
- The list opens in tree order: each process is followed by its sub-processes. Click a column header to sort by that column instead. The indentation shows only in tree order.

**Actions** (top-right toolbar):

- **New** (`business_processes:member`): create a new business process. See [Creating a business process](#creating-a-business-process).
- **Import** (Admin): bulk-import processes from a CSV file or an Excel workbook.
- **Export** (Admin): export the processes the list shows, or all processes, to a CSV file or an Excel workbook.
- **Delete Selected** (Admin): delete one or more selected rows. Sub-processes are deleted before their parent, so selecting a process together with every sub-process deletes the whole branch. A process that applications or interfaces use cannot be deleted: disable it instead. That process keeps its parent when both were selected. A process that still has a sub-process outside the selection cannot be deleted: move or delete it first. Before anything is deleted, the confirmation lists the processes kept, with the reason. Requests linked to a deleted process stay, without the link.

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
- **Delete** (trash icon, Admin): delete the process and return to the list. A process that applications or interfaces use cannot be deleted: the message counts them. Disable it instead. A process that has sub-processes cannot be deleted either: the message counts them. Move or delete them first.

Without `business_processes:member`, the page opens read only.

### Properties

The properties drawer on the right holds:

- **Type**: the ISO 9001 process type, optional. **Management** processes steer and direct the organization. **Core** processes deliver value to customers. **Support** processes provide resources to the others. A sub-process does not inherit the type of its parent.
- **Parent process**: the process this one sits under. Processes form a tree with no depth limit. The picker shows the tree indented and searches on the full path. The process itself and its sub-processes are left out of the list. Leave it empty for the top level. A process cannot be its own parent, and cannot move under one of its own sub-processes.
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

The changes made to the process, such as its type or its parent, and to its application links. See [Record history](record-history.md).

---

## CSV import/export

The export writes a CSV file or an Excel workbook (`.xlsx`): choose under **Format** in the dialog. The import reads either. See [CSV and Excel files](csv-files.md).

Use import and export for bulk onboarding or offline editing of your process catalog. Both require **Admin** access.

### Exporting

Click **Export** on the list page. The file holds the processes the list shows, with its search, filters and sort, or every process when you choose **The whole register** in the dialog. For an empty file with the headers only, use **Download template** in the import dialog.

The separator follows the language of your screen. See [CSV and Excel files](csv-files.md) for the encoding, the separator and the two import steps.

**Columns**: `name`, `process_type`, `parent_name`, `description`, `notes`, `status`.

- `process_type`: `management`, `core` or `support`, or empty.
- `parent_name`: the name of the parent process, or empty for the top level.

### Importing

Click **Import** on the list page, then:

1. Upload your CSV file or Excel workbook with the column titles of the template. In a CSV file, commas or semicolons both work.
2. Run the **Preflight** check. It validates headers and data, and shows how many rows will be created vs. updated.
3. If preflight passes, click **Load** to apply changes.

**Matching rules**:

- Rows are matched by **Name**, whatever the case. A matching name updates the existing process and keeps its stored spelling (the preflight check says which process the row matched); a new name creates a new process.
- `parent_name` is matched by name, whatever the case: a process of the same file or one already in KANAP. When both exist, the file wins. Rows can come in any order: parents are created before their children.
- An unknown parent name, a process under itself, or a loop is refused, with the row number.
- The file has no end of validity column. On an update, a blank `status`, or one equal to the process's current status, keeps its end of validity. A different status applies it: `enabled` clears the end of validity, and `disabled` ends the process today unless its end of validity has already passed. A new process is enabled unless the row says `disabled`.

**Tip**: export your current data first, modify the file, and re-import. This avoids accidental duplicates and ensures you are working from the latest state.

---

## Tips

- **Naming convention**: stick to the "Plain Name (CODE)" format (e.g. "Order-to-Cash (O2C)") so processes are easy to search and recognizable at a glance.
- **Retire, don't delete**: disable processes you no longer use instead of deleting them. This preserves historical references and audit trails.
- **Process Owner early**: assigning a Process Owner now means ownership data is already in place when future features like notifications and task routing come online.
