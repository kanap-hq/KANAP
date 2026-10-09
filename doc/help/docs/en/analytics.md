# Analytics dimensions

Analytics dimensions classify your IT budget for reporting, outside your accounting structure. You choose your own ways of reading the budget, such as the nature of the spend or the program it serves, without reworking companies, departments, accounts or cost centers.

## Dimensions and values

A **dimension** is one way of classifying budget lines, for example **Nature** or **Program**. Its **values** are the choices it offers, for example **Licenses**, **Cloud** and **Services** for Nature.

- Each dimension has its own list of values.
- Each OPEX and CAPEX line can hold one value per dimension. A line can be **Licenses** on Nature and **Workplace** on Program at the same time.
- A line can also have no value on a dimension. Reports show these lines as "Unassigned".

For example:

```
Nature          Program
  Licenses        Workplace
  Cloud           ERP
  Services        Security
```

### The default dimension

Every workspace starts with one dimension, the default dimension. Until you give it a name, it shows as **Analytics dimension**, in each person's language. If your workspace already had analytics values, they belong to this dimension and every line keeps its value.

The default dimension has a special role:

- It always applies to OPEX and CAPEX lines: its **Used for** field is locked. See [OPEX or CAPEX dimensions](#opex-or-capex-dimensions).
- It cannot be disabled or deleted. Its workspace has no **Delete** button, and one line under **Lifecycle** says why: "This dimension cannot be disabled or deleted: older files and AI questions use it."
- Questions to Plaid about the analytics category use it. See [Analytics dimensions in Plaid](#analytics-dimensions-in-plaid). In a budget file each dimension has its own column, the default one included: see [Load a budget from a spreadsheet](budget-file.md).
- It stays the default dimension when you rename it, change its code or change its order.
- Its label is reserved: no other dimension can be named "Analytics dimension", in any of the app's languages.

---

## Getting started

Navigate to **Master data > Analytics dimensions** (in the **Finance** section).

1. **Name the default dimension** if "Analytics dimension" does not suit you: select it in the selector bar, click **Edit**, then type a name in its workspace, for example **Nature**.
2. **Add its values**: click **New value**.
3. **Add a dimension** when you need another way of reading the budget: click **New** in the selector bar, then add its values.

**Tip**: Start with one or two dimensions and 5 to 10 values each. Consistent naming makes the lists easier to scan.

---

## The Analytics dimensions page

### Dimension selector

Under the title, a grey band shows your dimensions in order, with one square toggle each. It looks and works like the selector of the charts of accounts. A disabled dimension is marked **Disabled**. A dimension used for one kind of line only is marked **OPEX only** or **CAPEX only**. With many dimensions, the band scrolls sideways.

- Click a toggle to list the values of that dimension. The selected toggle is filled. The page address keeps your choice, so a bookmarked link opens on the same dimension. Without a choice, the page opens on the default dimension.
- On the right of the band, **Edit** opens the workspace of the selected dimension. If you can only read dimensions, the button reads **Open**.
- **New**, next to it, creates a dimension (requires `analytics:member`).

With a single dimension, the band shows one toggle and the values.

### Values list

The list shows the values of the selected dimension.

**Columns**:

| Column | What it shows |
|---|---|
| **Name** | The name of the value |
| **Description** | What the value covers |
| **Status** | **Enabled** or **Disabled** |
| **Used for** | **OPEX and CAPEX**, **OPEX only** or **CAPEX only**. See [OPEX or CAPEX values](#opex-or-capex-values) |
| **Updated** | Date and time of the last change |

Click any cell to open the value's workspace.

**Filtering**:

- **Quick search**: searches the name and the description
- **Status filter**: a checkbox filter on the **Status** column. Clicking **Clear** in it, or unticking both values, lists nothing, whatever **Show** says
- **Used for filter**: a checkbox filter on the **Used for** column
- **Status scope**: the **Show: All / Enabled / Disabled** toggle above the list. The list shows enabled values by default

**Actions**:

- **New value**: create a value in the selected dimension (requires `analytics:member`). While the selected dimension is disabled, the button is disabled and its tooltip says "Enable this dimension to add values."
- **Import CSV**: load values from a file (requires `analytics:admin`)
- **Export CSV**: download the values of every dimension (requires `analytics:admin`)
- **Delete selected**: delete the selected values (requires `analytics:admin`). Values used by budget lines are kept

---

## Dimensions

### Creating a dimension

Click **New** in the selector bar, fill in the fields, then click **Create**. The workspace of the new dimension opens. A new dimension is enabled.

- **Name** is required.
- **Code** is proposed from the name: lowercase, accents removed, spaces replaced by `-`. You can change it before you create the dimension.
- **Order** is proposed so the new dimension comes last.
- **Used for** starts on **OPEX and CAPEX**. See [OPEX or CAPEX dimensions](#opex-or-capex-dimensions).
- **Description** is optional.

Then go back to the page to add the values of the new dimension.

### The dimension workspace

Open it with **Edit** (**Open** if you can only read) in the selector bar, with the dimension selected.

- **Header**: the name of the dimension. Click it to rename the dimension. **Prev** / **Next** move through the dimensions in order, and the close button returns to the page on this dimension
- **Main area**: a usage line, for example "12 values, used by 27 OPEX lines and 2 CAPEX lines.", then the **Description**
- **Properties panel** on the right: **Name**, **Code**, **Order**, **Used for** and **Lifecycle**

**Autosave**: Every change saves on its own. There is no Save button. Text fields save when you leave them (in **Name**, **Code** and **Order**, press Enter to save at once); the lifecycle saves as soon as you change it. When a change is refused, the reason shows under the field that caused it, for example a duplicate code under **Code**. A name refused in the header shows at the top of the page.

### Dimension fields

| Field | What to enter |
|---|---|
| **Name** | Up to 200 characters. Names are unique regardless of case. Required, except on the default dimension: leave it empty there to show "Analytics dimension" in each person's language. The default dimension's label is reserved in every app language ("Analytics dimension", "Dimension analytique", "Analysedimension", "Dimensión analítica"), regardless of case: another dimension with one of these names is refused with "This name is reserved for the default dimension." |
| **Code** | 1 to 40 characters: lowercase letters, digits, `-` or `_`, starting with a letter or a digit. Each code is unique. The code names the dimension's column in the OPEX and CAPEX CSV files, so changing it changes that column name. Budget lines keep their values when the code changes |
| **Order** | A whole number. Dimensions are listed by this number, lowest first: on this page, on budget lines, in the report filters and in the report's dimension picker |
| **Description** | What the dimension is for, so teammates classify lines the same way |
| **Used for** | **OPEX and CAPEX**, **OPEX only** or **CAPEX only**. Says which budget lines can have a value on this dimension. See [OPEX or CAPEX dimensions](#opex-or-capex-dimensions). Locked on the default dimension, with one line under it: "The default dimension applies to OPEX and CAPEX lines." |
| **Lifecycle** | The status switch, labelled with the current state (**Enabled** or **Disabled**), and the **End of validity** date. See [Status and lifecycle](#status-and-lifecycle). Locked on the default dimension, with one line under it: "This dimension cannot be disabled or deleted: older files and AI questions use it." |

### OPEX or CAPEX dimensions

The **Used for** field says which budget lines the dimension applies to:

| Value | Meaning |
|-------|---------|
| **OPEX and CAPEX** | OPEX and CAPEX lines can both have a value on the dimension. This is the default |
| **OPEX only** | Only OPEX lines can have a value |
| **CAPEX only** | Only CAPEX lines can have a value |

OPEX screens show the dimensions used for OPEX lines, and CAPEX screens show the dimensions used for CAPEX lines. This covers the item **Properties** panel, the list columns, filters and quick search, the budget file columns, the dimension pickers and filters of the reports (they follow the report's **OPEX** / **CAPEX** choice) and Plaid.

A line keeps the value it already has on a dimension that no longer applies to its kind of line. The value is hidden everywhere and shows again if you open the dimension to that kind of line again. When your choice hides values, a note appears under the field, for example "8 CAPEX lines have a value for this dimension. They keep it, hidden while the dimension is for OPEX lines only."

Giving a line a value on a dimension that does not apply to it is refused, in the app, in a budget file and through the API. Sending the value the line already holds changes nothing.

A single value can also be limited to one kind of line. The two settings work at different levels. For example, the dimension **Nature de coût** is used for **OPEX and CAPEX**, and its value **Abonnements SaaS** is for **OPEX only**:

- The dimension setting decides whether the field exists on a kind of line. When the field is gone, the values the lines hold are hidden.
- The value setting only filters the choices. The field stays, CAPEX lines no longer offer **Abonnements SaaS**, and a CAPEX line that already has it keeps it, shows it and stays editable. See [OPEX or CAPEX values](#opex-or-capex-values).

The two settings must agree. A dimension cannot be set to one kind of line while some of its values are for the other kind only: KANAP refuses and names the values (up to three, then "and N more"), for example "2 values of this dimension are for CAPEX lines only (Matériel, Projet). Set them to OPEX and CAPEX first."

### Deleting a dimension

The **Delete** button in the header deletes the dimension at once (requires `analytics:admin`). While the dimension still has values, the button is disabled and one line under the usage line says why: "To delete this dimension, delete its values first."

The default dimension has no **Delete** button: it cannot be deleted.

To keep the values on the lines instead, disable the dimension.

---

## Values

### Creating a value

Click **New value**. The **Dimension** field starts on the dimension selected on the page and offers the enabled dimensions only. Enter the **Name**, and a **Description** if you like. **Used for** starts on **OPEX and CAPEX**: change it if the value suits one kind of line only. Then click **Create**. The workspace of the new value opens. A new value is enabled.

### The value workspace

- **Header**: the name of the value. Click it to rename the value. **Prev** / **Next** move through the values of the same dimension, in the list's current order and filters. The close button returns to the list
- **Main area**: a line such as "Used by 3 OPEX lines and 1 CAPEX line." when budget lines use the value, then the **Description**
- **Properties panel** on the right: **Dimension** (read only), **Used for** and **Lifecycle**

Changes save on their own, as in the dimension workspace. A name refused in the header shows at the top of the page.

### Rules for values

- **One list per dimension**: names are unique within a dimension, regardless of case. Two dimensions can each have a value called "Other". A duplicate is refused, for example "A value named Licenses already exists in Nature."
- **A value stays in its dimension**: the dimension is set when the value is created and cannot change. To move a value, create it in the other dimension, change the lines, then delete the old value.
- **Renaming keeps the lines**: lines point to the value itself, so the new name shows at once in lists and reports.
- **Deleting**: the **Delete** button in the header deletes the value at once (requires `analytics:admin`). It is disabled when budget lines use the value, with the reason, for example "Used by 3 OPEX lines and 1 CAPEX line." Remove the value from these lines first, or disable it.

### OPEX or CAPEX values

The **Used for** field of a value says which budget lines may use it:

| Value | Meaning |
|-------|---------|
| **OPEX and CAPEX** | OPEX and CAPEX lines can both use the value. This is the default |
| **OPEX only** | Only OPEX lines can use the value |
| **CAPEX only** | Only CAPEX lines can use the value |

The field of an OPEX line offers the values for OPEX and for both. The field of a CAPEX line does the same for CAPEX. A line that already holds a value of the other kind keeps it, shows it and stays editable, like a disabled value. Choosing such a value for another line, or when you change the value of a line, is refused: in the app, in a budget file, through the API and in Plaid.

- When the dimension is used for one kind of line only, the kind it excludes is unavailable in the field, with a line such as "The Nature de coût dimension is for OPEX lines only." **OPEX and CAPEX** and the dimension's own kind stay selectable. A value cannot be limited to the kind of line its dimension excludes.
- When lines of the other kind hold the value, one line appears under the field, for example "4 CAPEX lines have this value. They keep it, but new CAPEX lines cannot choose it." Click **Show these lines** to open them in the list, in a new tab. The line stays as long as the conflict exists.
- The Analytics dimensions report offers the values of the selected kind in its **Exclude values** list. See [Reporting](reports.md#analytics-dimensions).

---

## Status and lifecycle

Dimensions and values each have a status (**Enabled** or **Disabled**) and an optional **End of validity**. Use them to retire a dimension or a value without deleting it.

- **End of validity**: the date it stops. Leave it blank to keep it active. You can also schedule a future date.
- Switching to **Disabled** without a date sets the end of validity to today. Switching back to **Enabled** clears the date.
- When the end of validity passes, the status switches to **Disabled** on its own within the hour.

**A disabled value**:

- Cannot be picked for a line, in the app, in a CSV file or through Plaid.
- Stays on the lines that already have it and keeps counting in reports. In the field's list it is marked **Disabled**.

**A disabled dimension**:

- Disappears from the item forms, the OPEX and CAPEX lists, the report filters, the report's dimension picker, the OPEX and CAPEX CSV exports and Plaid. Only the Analytics dimensions page shows it, marked **Disabled**.
- Keeps its values on the lines. Enable the dimension again and they show again.
- Takes no new values. **New value** is disabled while the dimension is selected, and CSV files cannot add or change its values.

The default dimension cannot be disabled.

**Prefer disabling over deleting**: disabling keeps reports consistent while keeping the lists clean.

---

## Values on budget lines

In the **Properties** panel of an OPEX or CAPEX item, and when you create one, each enabled dimension used for that kind of line has its own field, named after the dimension, in dimension order. The default dimension shows as **Analytics dimension** until you rename it.

- Pick a value, or clear the field to leave the line without a value on that dimension. The change saves at once.
- The field lists the enabled values of its dimension that are used for this kind of line. A disabled value, or a value used for the other kind of line only, stays shown on the lines that have it. See [OPEX or CAPEX values](#opex-or-capex-values).
- The field cannot create a value. Create values on the Analytics dimensions page, or let an OPEX or CAPEX CSV import create them.
- A value applies to the whole line, across all years.
- If the dimensions cannot be loaded, one line replaces these fields: "Dimensions could not be loaded."

The OPEX and CAPEX lists have one column per enabled dimension used for that kind of line, hidden by default, with checkbox filters. See [OPEX](opex.md) and [CAPEX](capex.md).

---

## Reports

The **Analytics dimensions** report (under **Reporting**) shows how the budget of your OPEX or CAPEX lines is spread across the values of one dimension. See [Reporting](reports.md#analytics-dimensions) for the full description.

- **Item type**: OPEX or CAPEX
- **Dimension**: the dimension the report groups on. It shows when you have two or more enabled dimensions, and starts on the default dimension
- **Year range**: single year (pie or bar chart) or several years (line chart)
- **Metric**: any budget column your organization shows, under its name. Starts on the default column
- **Exclude values**: leave out some values to focus on the others. The list offers the values used for the selected item type, plus the values the lines hold

The seven budget reports can also be narrowed to one value of a dimension, with one filter per dimension. See [Cost center, run or build and analytics filters](reports.md#cost-center-run-or-build-and-analytics-filters).

---

## Analytics dimensions in Plaid

- Plaid can filter and group OPEX lines on every enabled dimension used for OPEX lines, and CAPEX lines on every enabled dimension used for CAPEX lines.
- A question about the analytics category uses the default dimension, whatever its name or order.
- Plaid can set, change or clear a line's value on any dimension when it creates or updates an OPEX or CAPEX line. Ask for example: "Set the Nature de coût of OPX-12 to Licences et maintenance". Plaid finds the value by its name within that dimension and shows the dimension and the value, before and after, in the preview. Nothing changes until you approve it.
- Plaid follows the same rules as the app: only enabled dimensions used for the line's type, only enabled values used for the line's type, and a line keeps a value it already has.
- Plaid can also create a value in the dimension you name. Without a dimension, the value goes into the default dimension.

---

## CSV import/export

Load or update the values of every dimension from one file. Dimensions are created on the page.

To set values on budget lines from a file, use the OPEX and CAPEX budget files. In those files, one `analytics:<code>` column holds each dimension, the default dimension included. See [Load a budget from a spreadsheet](budget-file.md).

**Export**: click **Export CSV**, then **Export data**. The file lists the values of every dimension, enabled or disabled, dimension by dimension. For an empty file with the headers only, use **Download template** in the import dialog.

**CSV structure**:

- Headers: `axis_code`, `name`, `description`, `status`, `disabled_at`, `applies_to`
- The export writes the separator of the screen language. See [CSV files](csv-files.md) for the encoding, the separator, the date forms and the two import steps

| Column | Content |
|---|---|
| `axis_code` | The code of the value's dimension, regardless of case. Empty means the default dimension |
| `name` | Required. The name of the value |
| `description` | Free text |
| `status` | `enabled` or `disabled`. Empty means `enabled` for a new value and keeps the stored status on an update |
| `disabled_at` | The end of validity: a date (`2026-12-31`) or a full date and time. Empty if there is no end. On an update, a blank `status` and a blank `disabled_at` keep the stored values. `enabled` with an empty date clears the end of validity. `disabled` with an empty date keeps a date that has already passed, and otherwise ends the value today |

| `applies_to` | The **Used for** setting, always the last column. `opex`, `capex`, or empty for **OPEX and CAPEX**. A file without this column leaves the settings as they are. An empty cell sets **OPEX and CAPEX** |

Only `name` is a required column. When the `description`, `status`, `disabled_at` or `applies_to` column is missing, existing values keep what is stored for it, and new values are enabled with no description. A file without `axis_code` puts every row in the default dimension.

**Import**:

1. Click **Import CSV** on the page
2. Choose your file
3. Click **Preflight check**. The report gives the number of rows, the values to create and update, and the rows that change nothing
4. If the preflight is clean, click **Load**

**How the import works**:

- **The whole file is checked before anything is written.** A file with any error loads nothing: fix the rows and run the preflight again. Each error names its row by the line of the file as a text editor shows it, blank lines and cells that span several lines included.
- **Matching by dimension and name**: a row whose name exists in its dimension updates that value; any other row creates one. Each cell replaces the stored value, so an empty `description` clears it. A name written with another case finds the stored value and does not rename it. To rename a value, rename it on the page.
- **Unchanged rows**: a row identical to the stored value changes nothing. Exporting and importing the same file reports every row as unchanged.
- **Disabled dimensions**: a row of a disabled dimension is accepted when it changes nothing, so an exported file imports as it is. A row that would create or change a value there is refused.
- **Values missing from the file** are left as they are. The import never deletes.

**Common errors**:

- **"Unknown dimension '...'."**: the `axis_code` cell matches no dimension. Check the code in the dimension's workspace, or create the dimension first.
- **"The ... dimension is disabled. Enable it or leave it out."**: a row creates or changes a value in a disabled dimension. Enable the dimension, or remove the row.
- **"... is already on row N."**: two rows carry the same name for the same dimension. Keep one.
- **"Invalid status '...'. Use 'enabled' or 'disabled'."**: fix the `status` cell.
- **"Invalid applies_to '...'. Use 'opex', 'capex' or leave it empty."**: fix the `applies_to` cell.
- **"The ... dimension is for OPEX lines only."** (or CAPEX): the row limits a value to the kind of line its dimension excludes. Fix the `applies_to` cell, or change the dimension's **Used for**.
- **"Status is enabled but the end of validity has passed. Clear the date or set the status to disabled. If the file comes from an older export, export the data again."**: the row is enabled with a date that has passed. A file exported before the date passed still says `enabled`: export it again, or fix the cell.
- **"Status is disabled but the end of validity is still to come. Set the status to enabled or set a date that has passed."**: the row is disabled with a date still to come. Fix the `status` or the `disabled_at` cell.
- **"Header mismatch"**: download a fresh template.

---

## Permissions

| Level | What it allows |
|---|---|
| `analytics:reader` | View the Analytics dimensions page and open dimensions and values |
| `analytics:member` | Create dimensions and values, and edit them |
| `analytics:admin` | Everything above, plus CSV import and export, and deletion |

The built-in Budget Administrator role is admin, Budget Member is member and Budget Reader is reader. Anyone who can read OPEX, CAPEX or reporting sees the dimensions and their values on budget lines, in the lists and in the reports, without access to this page.

---

## Tips

- **Keep it simple**: a few dimensions with 5 to 10 broad values each usually reveal more than dozens of detailed values.
- **One question per dimension**: each dimension should answer one question about the spend, such as "what kind of spend is it?" or "which program does it serve?".
- **Document with descriptions**: a short description goes a long way toward consistent use across teams.
- **Leave gaps when you have to**: "Unassigned" is a valid state. Avoid vague catch-all values just to fill the gap.
- **Disable, do not delete**: retiring a value keeps reports accurate.
- **Use reports to refine**: run the Analytics dimensions report from time to time. If a value captures too much or too little spend, split or merge it.

---

## Frequently asked questions

**Can a line have several analytics values?**
Yes, one per dimension. A line can be **Licenses** on Nature and **Workplace** on Program. Within one dimension, a line has one value or none.

**Do analytics dimensions affect allocations or accounting?**
No. They are for reporting only and have no impact on cost allocations or formal accounting.

**How many values should I create?**
Start with 5 to 10 per dimension. More than 20 usually means the dimension tries to answer too many questions: split it into two dimensions.

**What is the difference between analytics dimensions, departments and cost centers?**
**Departments** are formal organizational units with precise allocation drivers. **Cost centers** say who owns and answers for the spend. **Analytics dimensions** are free, optional classifications for reporting, with no allocation or ownership attached.

**Why do some lines show "Unassigned"?**
In the Analytics dimensions report, lines without a value on the chosen dimension appear as "Unassigned". This is expected: values are optional.

**What happens to the lines when I rename a value or a dimension?**
Nothing changes on the lines. Lists and reports show the new name at once.
