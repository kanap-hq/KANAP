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
- **Name**: Department name -- click to open the workspace Overview tab
- **Company**: Parent company -- click to open the workspace Overview tab
- **Headcount (Year)**: Employee count for the selected year -- click to jump straight to the Details tab for editing

**Additional columns** (via column chooser):
- **Status**: Enabled or Disabled
- **Created**: When the department was created

**Year selector**: Use the **Year** field in the toolbar to change which year's headcount is displayed. The grid refreshes automatically when you change the year.

**Status scope**: Use the **Show: All / Enabled / Disabled** toggle to filter by department status. The list defaults to showing only enabled departments.

**Quick search**: The search bar filters across department names.

**Deep-linking**: Every cell in the grid is a clickable link. Name and Company open the Overview tab; Headcount opens the Details tab. When you navigate to a workspace and then return, your sort order, search query, and filters are preserved.

**Actions**:
- **New**: Create a new department (requires `departments:manager`)
- **Import CSV**: Bulk import departments (requires `departments:admin`)
- **Export CSV**: Export to CSV (requires `departments:admin`)
- **Delete Selected**: Remove selected departments (requires `departments:admin`)

---

## The Departments workspace

Click any row to open the workspace. It has two tabs: **Overview** and **Details**.

- **Header**: the department name. Click it to rename the department. **Prev** / **Next** move between departments in the list's order and filters without returning to the list, and the close button returns to the list
- **Properties panel** on the right: **Company** and **Lifecycle**

**Autosave**: Every change saves on its own. There is no Save button. The name and the description save when you leave the field; the company and the lifecycle save as soon as you change them. You can keep working while a change saves. When a change is refused, the reason shows under the field that caused it, except for the name, which shows its refusal at the top of the page.

### Overview

The Overview tab holds the description. The other fields are in the header and the **Properties** panel.

**What you can edit**:
- **Name**: Department name (required), in the header
- **Company**: Parent company, linked to Companies master data (required). A company that already has a department with the same name is refused: "A department with this name already exists in the selected company."
- **Description**: Free-text description
- **Lifecycle**: the status switch, labelled with the current state (**Enabled** or **Disabled**), and the **End of validity** date. Leave the date blank to keep the department active indefinitely, or set a future date to schedule its end. Switching the department to **Disabled** without a date sets the end of validity to today

**Creating a department**: **New** opens a form with **Name**, **Company** and **Description**. Click **Create** to save it. The Details tab becomes available after you create the department.

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

**Export CSV** downloads every department with its company, name, description, status and end of validity. **Import CSV** reads a file back. The import dialog also carries **Download template**: a file with the headers only.

The columns:

| Column | Content |
|---|---|
| `company_name` | Required. The company the department belongs to, by name |
| `name` | Required. The department name |
| `description` | Free text |
| `status` | `enabled` or `disabled` |
| `disabled_at` | The end of validity: a date (`2026-12-31`) or a full date and time |

**Import**:

- Use **Preflight check** to validate the file before applying it, then **Load**
- Matched by department name and company name: a row updates the department it names, any other row creates one

**Required cells**: `name` and `company_name`, an existing company

**Optional cells**: `description`, `status`, `disabled_at`

**Lifecycle columns**:
- `status` is `enabled` or `disabled`, and `disabled_at` is the end of validity, a date (`2026-12-31`) or a full date and time. The export writes the status read from the end of validity. A new department is enabled unless the row says `disabled`. On an update, a blank `status` and a blank `disabled_at` keep the stored values. `enabled` with an empty date clears the end of validity. `disabled` with an empty date keeps a date that has already passed, and otherwise ends the department today
- A row whose status contradicts its date is refused with a row error: "Status is enabled but the end of validity has passed. Clear the date or set the status to disabled. If the file comes from an older export, export the data again." or "Status is disabled but the end of validity is still to come. Set the status to enabled or set a date that has passed."

**Notes**:
- See [CSV files](master-data-operations.md#csv-files) for the encoding, the separator, the date forms and the two import steps
- Headcount is not in the file. Enter it per year on the department's **Details** tab

---

## Tips

- **Match your org structure**: Mirror your HR system's department hierarchy for consistency.
- **Update headcount annually**: Set a reminder to refresh department metrics during budget planning.
- **Use for allocations**: Department headcount drives cost allocation calculations -- keep it accurate.
- **Disable, don't delete**: When departments are reorganized, disable old ones rather than deleting to preserve historical data.
- **Leverage deep-links**: Click the headcount number directly from the list to jump to the Details tab and edit metrics without an extra click.
