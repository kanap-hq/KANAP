# Departments

Departments represent organizational units within your companies. Use them to track headcount by year, allocate costs, and define audiences for applications. Each department belongs to a company and carries year-by-year headcount data that feeds into chargeback and allocation calculations.

To record who owns each budget line, use [Cost centers](cost-centers.md): unlike departments, they can be grouped across companies.

## Getting started

Navigate to **Master Data > Departments** to see your department list. Click **New** to create your first entry.

**Required fields**:
- **Name**: The department name
- **Company**: Which company this department belongs to

**Optional but useful**:
- **Description**: Free-text description of the department's purpose or scope
- **Headcount**: Number of employees, tracked by year (set on the Details tab after creation)

**Tip**: Import departments from your HR system to keep your org structure aligned.

---

## Working with the list

The Departments grid gives you an overview of all departments with their headcount for a given year.

**Default columns**:
- **Reference**: The reference Kadratis assigns (`DEPT-4`). Click it to open the workspace Overview tab
- **Name**: Department name. Click to open the workspace Overview tab
- **Company**: Parent company. Click to open the workspace Overview tab
- **Headcount (Year)**: Employee count for the selected year. Click to jump straight to the Details tab for editing

**Additional columns** (via column chooser):
- **Status**: Enabled or Disabled
- **Created**: When the department was created

**Year selector**: Use the **Year** field in the toolbar to change which year's headcount is displayed. The grid refreshes automatically when you change the year.

**Status scope**: Use the **Show: All / Enabled / Disabled** toggle to filter by department status. The list defaults to showing only enabled departments.

**Quick search**: The search bar filters across department names. Type a reference, such as `DEPT-4`, to find that department. Digits alone search the text.

**Column filters**: The **Reference** filter takes `DEPT-4` or `4`.

**Deep-linking**: Every cell in the grid is a clickable link. Reference, Name and Company open the Overview tab; Headcount opens the Details tab. When you navigate to a workspace and then return, your sort order, search query, and filters are preserved.

**Actions**:
- **New**: Create a new department (requires `departments:member`)
- **Import**: Bulk import departments (requires `departments:admin`)
- **Export**: Export to a CSV file or an Excel workbook (requires `departments:admin`)
- **Delete Selected**: Remove selected departments (requires `departments:admin`). A department used in the allocations of budget lines cannot be deleted: disable it instead. Before anything is deleted, the confirmation lists the departments kept, with the reason

---

## The Departments workspace

Click any row to open the workspace. It has three tabs: **Overview**, **Details** and **History** (the changes made to the department, see [Record history](record-history.md)).

- **Header**: the department reference (`DEPT-5`, click it to copy it) and the department name. Click the name to rename the department. **Prev** / **Next** move between departments in the list's order and filters without returning to the list, and the close button returns to the list
- **Properties panel** on the right: **Company** and **Lifecycle**

**Page address**: the address of the page uses the reference, for example `/master-data/departments/DEPT-5/overview`. The former address of a department page still opens it, and changes to the new one.

**Autosave**: Every change saves on its own. There is no Save button. The name and the description save when you leave the field; the company and the lifecycle save as soon as you change them. You can keep working while a change saves. When a change is refused, the reason shows under the field that caused it.

### Overview

The Overview tab holds the description. The other fields are in the header and the **Properties** panel.

**What you can edit**:
- **Name**: Department name (required), in the header
- **Company**: Parent company, linked to Companies master data (required). A company that already has a department with the same name is refused: "A department with this name already exists in the selected company." A department that people, requests, projects or budget line allocations use stays in its company: the change is refused, and the message counts what uses it
- **Description**: Free-text description
- **Lifecycle**: the status switch, labelled with the current state (**Enabled** or **Disabled**), and the **End of validity** date. Leave the date blank to keep the department active indefinitely, or set a future date to schedule its end. Switching the department to **Disabled** ends its validity now: it is disabled at once. While a future date is set, the switch reads **Active until** and that date

**Creating a department**: **New** opens the page of the new department, its properties panel open. Type the name in the title at the top of the page and choose the **Company**. When a single company is offered, it is already chosen, and you can change it. The department is created as soon as both are given, and every tab becomes available. A **Description** then saves automatically. Press Escape in the title to leave without creating anything, even with a name typed.

While the department is being created, the header shows **Create** and **Cancel** until you leave it. **Ctrl+S** works like the button shown. **Create** writes the department when its required fields are given and leaves it open. If one is still missing, its label turns red with an alert icon and the cursor goes to it. Once the department is created, **Create** becomes **Done**: it saves what you are still typing and takes you back to where you started, the list or the previous screen. **Cancel** leaves without keeping anything, and deletes the department if it was already created. If you entered more than what created it, a confirmation lists what will be deleted. You can cancel your own creation without the right to delete departments. Once another person has changed it, or an application is linked to it, **Cancel** is refused. Leaving the department any other way keeps it.

---

### Details

The Details tab manages year-by-year headcount metrics.

**Year selector**: Choose which year to view or edit using the year tabs at the top of the panel. Five years are available: two years before the current year through two years after.

**Metrics per year**:
- **Headcount**: Total number of employees in this department for the selected year

**How it works**:
- Headcount is saved for the selected year when you leave the field (or press Enter). Anything other than a whole number of zero or more shows "Enter a whole number, 0 or more." under the field
- Headcount feeds into audience calculations for applications
- Each year is stored on its own: switching years loads that year's value
- If metrics for the selected year have been **frozen** (by an administrator), the field is locked and a notice says that a budget administrator can unfreeze them (**Budget management > Administration > Freeze master data**)

**Tip**: Update headcount annually during your budget planning cycle. Use the year tabs to review or pre-fill future years.

---

## CSV import/export

The export writes a CSV file or an Excel workbook (`.xlsx`): choose under **Format** in the dialog. The import reads either. See [CSV and Excel files](csv-files.md).

**Export** downloads the departments the list shows (or, on request in the dialog, every department) with its reference, company, name, description, status and end of validity. **Import** reads a file back. The import dialog also carries **Download template**: a file with the headers only.

The columns, in this order:

| Column | Content |
|---|---|
| `reference` | Optional. The department reference (`DEPT-12`). The export writes it |
| `company_name` | Required. The company the department belongs to, by name |
| `name` | Required. The department name |
| `description` | Free text |
| `status` | `enabled` or `disabled` |
| `disabled_at` | The end of validity: a date (`2026-12-31`) or a full date and time. The export writes the date only. Imported again, that date keeps the stored end of validity |

**Import**:

- Use **Preflight check** to validate the file before applying it, then **Load**
- **Matching by reference**: a filled `reference` (`DEPT-12` or `12`) names the department the row updates, even when the name has changed. The department takes the name and the company the row gives: a different company moves it to that company, unless the department is in use, as on its page (the row is then refused). The preflight check lists each department that will be renamed or move to another company
- **Matching by name**: when `reference` is empty, or the file has no such column, a row is matched by department name and company name. It updates the department it names, and any other row creates one
- **Unknown reference**: a reference your workspace does not know refuses the row: "\"DEPT-999\" is no reference in this workspace. Leave the cell empty to import the row without it." This happens with a file exported from another workspace
- **Renaming or moving**: a name that another department of the row's company already has is refused, and the message names that department's reference: "\"Finance\" already belongs to DEPT-7."
- **One row per department**: two rows that update the same department are refused: "This row updates DEPT-7, as row 3 does. Keep one row per record." Two rows that create the same department (same company and name, whatever the case) are refused too: "Same values in company_name, name as row 3."

**Required cells**: `name` and `company_name`, an existing company. A row with a `reference` can leave them empty: the department keeps its name and company

**Same name in two companies**: two companies may each have a department of the same name. An import that names one on a person, a request or a project, or Kad on a request or a project, reads it in the record's company. When the record has no company, a name only one company has gives its company, and a name several companies share is refused with a message that names them. See [Names of records](csv-files.md#names-of-records)

**Empty cells and `-`**: on a department the file updates, an empty cell keeps the stored value, and `-` clears `description` or `disabled_at`. `-` cannot clear `reference`, `company_name`, `name` or `status`: the row is refused. See [Empty cells and `-`](csv-files.md#empty-cells-and-clearing)

**Optional cells**: `reference`, `description`, `status`, `disabled_at`

**Lifecycle columns**:
- `status` is `enabled` or `disabled`, and `disabled_at` is the end of validity, a date (`2026-12-31`) or a full date and time. The export writes the status read from the end of validity. A new department is enabled unless the row says `disabled`. On an update, a blank `status` and a blank `disabled_at` keep the stored values. `enabled` with an empty date clears the end of validity. `disabled` with an empty date keeps a date that has already passed, and otherwise ends the department today
- A row whose status contradicts its date is refused with a row error: "The status is "Enabled", but the end of validity has passed. Write "-" in the end of validity, or "disabled" in the status. If the file comes from an older export, export the data again." or "The status is "Disabled", but the end of validity is still to come. Write "enabled" in the status, or a date that has passed in the end of validity."

**Notes**:
- See [CSV and Excel files](csv-files.md) for the encoding, the separator, the date forms and the two import steps
- Headcount is not in the file. Enter it per year on the department's **Details** tab

---

## Tips

- **Match your org structure**: Mirror your HR system's department hierarchy for consistency.
- **Update headcount annually**: Set a reminder to refresh department metrics during budget planning.
- **Use for allocations**: Department headcount drives cost allocation calculations. Keep it accurate.
- **Disable, don't delete**: When departments are reorganized, disable old ones rather than deleting to preserve historical data.
- **Leverage deep-links**: Click the headcount number directly from the list to jump to the Details tab and edit metrics without an extra click.
