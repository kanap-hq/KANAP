# Analytics dimensions

Analytics dimensions classify your IT budget for reporting, outside your accounting structure. You choose your own ways of reading the budget, such as the nature of the spend or the program it serves, without reworking companies, departments, accounts or cost centers.

## Dimensions and values

A **dimension** is one way of classifying budget lines, for example **Cost pool** or **IT tower**. Its **values** are the choices it offers, for example **Hardware**, **Software** and **Outside services** for Cost pool.

- Each dimension has its own list of values.
- Each OPEX and CAPEX line can hold one value per dimension. A line can be **Software** on Cost pool and **Application** on IT tower at the same time.
- A line can also have no value on a dimension. Reports show these lines as "Unassigned".
- A dimension marked **Required** asks for a value on every new line. See [Required dimensions](#required-dimensions).

For example:

```
Cost pool             IT tower
  Hardware              Compute
  Software              Application
  Outside services      End user
```

### The default dimension

Every workspace has one default dimension. In a new workspace it is the **Cost pool**. Without a name, it shows as **Analytics dimension**, in each person's language. If your workspace already had analytics values, they belong to this dimension and every line keeps its value.

The default dimension has a special role:

- It always applies to OPEX and CAPEX lines: its **Used for** field is locked. See [OPEX or CAPEX dimensions](#opex-or-capex-dimensions).
- It cannot be disabled or deleted. Its workspace has no **Delete** button, and one line under **Lifecycle** says why: "This dimension cannot be disabled or deleted: older files and AI questions use it."
- Questions to Plaid about the analytics category use it. See [Analytics dimensions in Plaid](#analytics-dimensions-in-plaid). In a budget file each dimension has its own column, the default one included: see [Load a budget from a spreadsheet](budget-file.md).
- It stays the default dimension when you rename it, change its code or move it in the order of the dimensions.
- Its label is reserved: no other dimension can be named "Analytics dimension", in any of the app's languages.

### Recommended dimensions

A new workspace starts with four recommended dimensions and their values, in the workspace's language. They are enabled, used for OPEX and CAPEX lines, and none is required:

| Dimension | Code | Values, in order |
|---|---|---|
| **Cost pool** | `default` | Hardware, Software, Internal labor, External labor, Outside services, Facilities and power, Telecom, Other |
| **IT tower** | `it_tower` | Data center, Compute, Storage, Network, Platform, Output, End user, Application, Delivery, Security and compliance, IT management |
| **Purpose** | `purpose` | Replacement, Capacity, Productivity, Security, Compliance, Business growth, Other |
| **Priority** | `priority` | Mandatory, High, Medium, Low |

- The cost pool is the default dimension. Cost pools and IT towers follow the TBM (Technology Business Management) model.
- Each dimension and each value has a description, so teammates classify lines the same way.
- The language is the workspace's: the language of the browser when the trial starts, or the language set for an installation on your own servers. A workspace reset creates them again in that language.
- They work like any other dimension. You can rename them and their values, add values, change the order, make one required, disable or delete them.

**Adding them to an existing workspace**: click **Recommended dimensions** in the selector bar (requires `analytics:admin`). The dialog **Add the recommended dimensions** lists the four dimensions, plus **Recurrence** (Recurring or One-off), with a short description each.

- The dimensions the workspace lacks start ticked, except **Recurrence**. A dimension already present is greyed out and marked **Already present**, with its name in the workspace, for example **Already present (Investment type)**: an older **Investment type** dimension stands for the purpose.
- **Language of the names** starts on your screen language.
- Click **Add**. A message lists what was created, for example "3 dimensions added: Cost pool, IT tower, Purpose."
- The cost pool goes on the default dimension when it has neither a name nor values. Otherwise it is created as a new dimension, with the code `cost_pool`.
- When another dimension already has the name, the new one gets a number, for example **Priority (2)**.
- The [Audit log](admin.md#audit-log) records each dimension and value created.

**Workspaces created before the recommended dimensions** keep three dimensions that classify CAPEX lines, used for **CAPEX only**, required and enabled: **PP&E type** (`ppe_type`: Hardware, Software), **Investment type** (`investment_type`: Replacement, Capacity, Productivity, Security, Conformity, Business growth, Other) and **Priority** (`priority`: Mandatory, High, Medium, Low). Their names and values are in English. They work like any other dimension.

The code of a dimension names its column in the budget file, for example `analytics:it_tower`. When you change a code, a file exported before the change still has the old column name and is refused with "Unknown dimension". Export a fresh file. See [Load a budget from a spreadsheet](budget-file.md).

---

## Getting started

Navigate to **Master data > Analytics dimensions** (in the **Finance** section).

1. **Review the recommended dimensions**: a new workspace already has **Cost pool**, **IT tower**, **Purpose** and **Priority**, with their values. Select one in the selector bar to see its values. Rename a value, add one or disable the ones you do not need. An older workspace can add them with **Recommended dimensions**. See [Recommended dimensions](#recommended-dimensions).
2. **Name the default dimension** if it still shows "Analytics dimension": select it in the selector bar, click **Edit**, then type a name in its workspace.
3. **Add a dimension** when you need another way of reading the budget: click **New** in the selector bar, then add its values with **New value**.

**Tip**: Start with a few dimensions and 5 to 10 values each. Consistent naming makes the lists easier to scan.

---

## The Analytics dimensions page

### Dimension selector

Under the title, a grey band shows your dimensions in order, with one square toggle each. It looks and works like the selector of the charts of accounts. A disabled dimension is marked **Disabled**. A dimension used for one kind of line only is marked **OPEX only** or **CAPEX only**. Each toggle shows the full name of its dimension. With many dimensions, the toggles wrap onto several rows, and the actions stay on the right of the first row. On a narrow screen, the actions move to a row of their own.

- Click a toggle to list the values of that dimension. The selected toggle is filled. The page address keeps your choice, so a bookmarked link opens on the same dimension. Without a choice, the page opens on the default dimension.
- On the right of the band, **Edit** opens the workspace of the selected dimension. If you can only read dimensions, the button reads **Open**.
- **New**, next to it, creates a dimension (requires `analytics:member`).
- **Recommended dimensions** adds the recommended dimensions the workspace lacks (requires `analytics:admin`). See [Recommended dimensions](#recommended-dimensions).
- **Reorder** sets the order of the dimensions (requires `analytics:member`). The button is disabled while there is only one dimension. See [Ordering dimensions](#ordering-dimensions).

With a single dimension, the band shows one toggle and the values.

### Values list

The list shows the values of the selected dimension, in the dimension's order. See [Ordering values](#ordering-values).

**Columns**:

| Column | What it shows |
|---|---|
| **Order** | The position of the value in its dimension. Disabled values have a position too, so the numbers can skip when the list hides them |
| **Name** | The name of the value |
| **Description** | What the value covers |
| **Status** | **Enabled** or **Disabled** |
| **Used for** | **OPEX and CAPEX**, **OPEX only** or **CAPEX only**. See [OPEX or CAPEX values](#opex-or-capex-values) |
| **Updated** | Date and time of the last change |

Click any cell to open the value's workspace.

**Filtering**:

- **Quick search**: searches the name and the description
- **Status filter**: the filter of the **Status** column shows the **Show** choice (**All**, **Enabled** or **Disabled**): changing one changes the other
- **Used for filter**: a checkbox filter on the **Used for** column
- **Status scope**: the **Show: All / Enabled / Disabled** toggle above the list. The list shows enabled values by default

**Actions**:

- **New value**: create a value in the selected dimension (requires `analytics:member`). While the selected dimension is disabled, the button is disabled and its tooltip says "Enable this dimension to add values."
- **Reorder**: set the order of the selected dimension's values (requires `analytics:member`). The button is disabled while the dimension has fewer than two values. See [Ordering values](#ordering-values)
- **Import**: load values from a file (requires `analytics:admin`)
- **Export**: download the values the list shows, or the values of every dimension (requires `analytics:admin`)
- **Delete selected**: delete the selected values (requires `analytics:admin`). When some of them are used by budget lines, the confirmation says how many lines lose them, for example "2 selected values are used: they are removed from 5 budget lines. This data cannot be recovered.", and the button reads **Delete anyway**

---

## Dimensions

### Creating a dimension

Click **New** in the selector bar, fill in the fields, then click **Create**. The workspace of the new dimension opens. A new dimension is enabled.

- **Name** is required.
- **Code** is proposed from the name: lowercase, accents removed, spaces replaced by `-`. You can change it before you create the dimension.
- **Used for** starts on **OPEX and CAPEX**. See [OPEX or CAPEX dimensions](#opex-or-capex-dimensions).
- **Required** starts off. See [Required dimensions](#required-dimensions).
- **Description** is optional.

A new dimension goes last in the order of the dimensions. Then go back to the page to add its values.

### The dimension workspace

Open it with **Edit** (**Open** if you can only read) in the selector bar, with the dimension selected. The **History** button in the header opens the dimension's history in a side panel. See [Record history](record-history.md).

- **Header**: the name of the dimension. Click it to rename the dimension. **Prev** / **Next** move through the dimensions in order, and the close button returns to the page on this dimension
- **Main area**: a usage line, then the **Description**. The usage line gives the number of values and of budget lines that hold one of them, OPEX and CAPEX together, for example "12 values · Used by 29 lines". **Used by 29 lines** is a link: it opens those lines in the budget lines list, in a new tab, enabled and disabled lines included. A dimension no line uses reads "Not used yet", and one with no values "No values yet." While the dimension is disabled, the count shows without a link
- **Properties panel** on the right: **Name**, **Code**, **Used for**, **Required**, **Open values** and **Lifecycle**

**Autosave**: Every change saves on its own. There is no Save button. Text fields save when you leave them (in **Name** and **Code**, press Enter to save at once); the **Required** switch and the lifecycle save as soon as you change them. When a change is refused, the reason shows under the field that caused it, for example a duplicate code under **Code**. A name refused in the header shows at the top of the page.

### Dimension fields

| Field | What to enter |
|---|---|
| **Name** | Up to 200 characters. Names are unique regardless of case. Required, except on the default dimension: leave it empty there to show "Analytics dimension" in each person's language. The default dimension's label is reserved in every app language ("Analytics dimension", "Dimension analytique", "Analysedimension", "Dimensión analítica"), regardless of case: another dimension with one of these names is refused with "This name is reserved for the default dimension." |
| **Code** | 1 to 40 characters: lowercase letters, digits, `-` or `_`, starting with a letter or a digit. Each code is unique. The code names the dimension's column in the OPEX and CAPEX files, so changing it changes that column name. Budget lines keep their values when the code changes |
| **Description** | What the dimension is for, so teammates classify lines the same way |
| **Used for** | **OPEX and CAPEX**, **OPEX only** or **CAPEX only**. Says which budget lines can have a value on this dimension. See [OPEX or CAPEX dimensions](#opex-or-capex-dimensions). Locked on the default dimension, with one line under it: "The default dimension applies to OPEX and CAPEX lines." |
| **Required** | A switch. When it is on, every new line of the kinds the dimension is used for needs a value on it, and a line that holds a value cannot lose it. See [Required dimensions](#required-dimensions). The default dimension can be required too |
| **Open values** | A switch, off by default. When it is on, anyone who can edit a line can add a value, from the line or the budget file. See [Open values](#open-values) |
| **Lifecycle** | The status switch, labelled with the current state (**Enabled** or **Disabled**), and the **End of validity** date. See [Status and lifecycle](#status-and-lifecycle). Locked on the default dimension, with one line under it: "This dimension cannot be disabled or deleted: older files and AI questions use it." |

### Ordering dimensions

The dimensions have an order, which you set. KANAP shows them in this order:

- in the selector bar of this page
- in the **Properties** panel of OPEX and CAPEX lines
- in the columns of the budget lines list
- in the columns of the budget file
- in the report filters and the report's dimension picker
- in the dimensions Plaid lists

A new dimension goes last.

To change the order:

1. Click **Reorder** in the selector bar. The dialog lists every dimension, disabled ones and dimensions for one kind of line included, each with its marks (**Default**, **Disabled**, **OPEX only**, **CAPEX only**).
2. Drag the dimensions into place, with the mouse or with the keyboard. The keys are the same as for values: see [Ordering values](#ordering-values).
3. Click **Save**. **Cancel** leaves the order as it was.

The new order shows at once. The [Audit log](admin.md#audit-log) records one change for each dimension that moved, with its position before and after.

### OPEX or CAPEX dimensions

The **Used for** field says which budget lines the dimension applies to:

| Value | Meaning |
|-------|---------|
| **OPEX and CAPEX** | OPEX and CAPEX lines can both have a value on the dimension. This is the default |
| **OPEX only** | Only OPEX lines can have a value |
| **CAPEX only** | Only CAPEX lines can have a value |

OPEX screens show the dimensions used for OPEX lines, and CAPEX screens show the dimensions used for CAPEX lines. This covers the line **Properties** panel, the list columns, filters and quick search, the dimension pickers and filters of the reports (they follow the report's **OPEX** / **CAPEX** choice) and Plaid. The budget file has a column for every enabled dimension, and each row takes values only on the dimensions of its kind of line.

A line keeps the value it already has on a dimension that no longer applies to its kind of line. The value is hidden everywhere and shows again if you open the dimension to that kind of line again. When your choice hides values, a note appears under the field, for example "8 CAPEX lines have a value for this dimension. They keep it, hidden while the dimension is for OPEX lines only."

Giving a line a value on a dimension that does not apply to it is refused, in the app, in a budget file and through the API. In the app and through the API, sending the value the line already holds changes nothing. In a budget file, leave that cell empty: the export does so.

A single value can also be limited to one kind of line. The two settings work at different levels. For example, the dimension **Cost pool** is used for **OPEX and CAPEX**, and its value **Internal labor** is for **OPEX only**:

- The dimension setting decides whether the field exists on a kind of line. When the field is gone, the values the lines hold are hidden.
- The value setting only filters the choices. The field stays, CAPEX lines no longer offer **Internal labor**, and a CAPEX line that already has it keeps it, shows it and stays editable. See [OPEX or CAPEX values](#opex-or-capex-values).

The two settings must agree. A dimension cannot be set to one kind of line while some of its values are for the other kind only: KANAP refuses and names the values (up to three, then "and N more"), for example "2 values of this dimension are for CAPEX lines only (Hardware, Software). Set them to OPEX and CAPEX first."

### Required dimensions

Turn on **Required** when every budget line must be classified on a dimension. KANAP then checks the lines of the kinds the dimension is used for:

- **A new line needs a value on the dimension.** This applies to every way of creating a line: the OPEX and CAPEX screens, a budget file, Plaid and the API. Without a value, the line is not created, with the message "The Cost pool dimension is required. Choose a value."
- **A line that holds a value cannot lose it.** You can pick another value. The field cannot be cleared.
- **A line created before you turned the setting on keeps working.** If it has no value on the dimension, it stays editable and you can save other changes on it. Its field is marked as required. On the OPEX and CAPEX screens, leaving such a line after changing it asks you to choose a value first, with **Stay** and **Leave anyway**. Opening it without changing anything never asks.

The setting is checked only while the dimension is enabled. A disabled dimension keeps its setting, and one line under the switch says "Not checked while the dimension is disabled." A dimension used for one kind of line only is checked on that kind only: a dimension set to **OPEX only** and required asks nothing of CAPEX lines.

While the setting is on, lines under the switch help you complete the existing lines:

- **Lines without a value**: for example "117 OPEX lines and 15 CAPEX lines have no value." Each kind of line has its own link, **Show OPEX lines** and **Show CAPEX lines** (**Show these lines** when only one kind is concerned). The link opens the lines in their list, in a new tab, enabled and disabled lines included.
- **No value to choose**: when a kind of line the dimension is used for has no enabled value it can use, a warning says so, for example "No enabled value can be used on CAPEX lines. New CAPEX lines cannot be created." Add a value for that kind of line, or enable one. See [OPEX or CAPEX values](#opex-or-capex-values).

### Open values

A dimension with **Open values** on takes new values from the lines themselves: a budget reference, a project code, an order number. In the field of a line, typing a name that does not exist offers **Add “…”**, which creates the value. The budget file creates it the same way. Anyone who can edit the line does it, including people with limited [data access](data-access.md).

On a dimension with the switch off, values are created on this page, and the budget file creates unknown values only for people with access to all data. The switch is shown to people who can edit dimensions and have access to all data.

### Deleting a dimension

The **Delete** button (trash icon) in the header deletes the dimension with its values (requires `analytics:admin`):

- A dimension without values asks first ("This cannot be undone."), then **Delete**.
- A dimension whose values no line uses asks first, for example "Delete Recurrence?" with "Its 2 values are deleted too.", then **Delete**.
- A dimension used by budget lines asks first, with the number of lines: "Its 3 values are deleted, and it is removed from 6 budget lines. This data cannot be recovered." Click **Delete anyway** to go on. The lines lose their value on this dimension, and their history records the change.

The default dimension has no **Delete** button: it cannot be deleted. The [Audit log](admin.md#audit-log) records the deleted dimension with its counts of values and lines, each deleted value, and each line that lost a value.

To keep the values on the lines instead, disable the dimension.

---

## Values

### Creating a value

Click **New value**. The **Dimension** field starts on the dimension selected on the page and offers the enabled dimensions only. Enter the **Name**, and a **Description** if you like. **Used for** starts on **OPEX and CAPEX**: change it if the value suits one kind of line only. Then click **Create**. The workspace of the new value opens. A new value is enabled.

### The value workspace

- **Header**: the name of the value. Click it to rename the value. **Prev** / **Next** move through the values of the same dimension, in the list's current order and filters. The close button returns to the list
- **Main area**: a usage line, then the **Description**. The usage line counts the budget lines that hold the value, OPEX and CAPEX together, for example "Used by 4 lines". It is a link that opens those lines in the budget lines list, in a new tab. A value no line uses reads "Not used yet". While the dimension is disabled, the count shows without a link
- **Properties panel** on the right: **Dimension** (read only), **Used for** and **Lifecycle**

The **History** button in the header opens the value's history in a side panel. See [Record history](record-history.md).

Changes save on their own, as in the dimension workspace. A name refused in the header shows at the top of the page.

### Rules for values

- **One list per dimension**: names are unique within a dimension, regardless of case. Two dimensions can each have a value called "Other". A duplicate is refused, for example "A value named Software already exists in Cost pool."
- **A value stays in its dimension**: the dimension is set when the value is created and cannot change. To move a value, create it in the other dimension, change the lines, then delete the old value.
- **Renaming keeps the lines**: lines point to the value itself, so the new name shows at once in lists and reports.
- **Deleting**: the **Delete** button (trash icon) in the header deletes a value no line uses after a confirmation ("This cannot be undone.", then **Delete**; requires `analytics:admin`). When budget lines use the value, it asks first: "It is removed from 4 budget lines. This data cannot be recovered." Click **Delete anyway** to go on, or disable the value instead to keep it on the lines.

### Ordering values

The values of a dimension have an order, which you set. KANAP offers the values in this order wherever you choose or filter on them:

- the value fields of OPEX and CAPEX lines (when you type in a field, the best matches come first)
- the dimension's checkbox filters in the budget lines list
- the dimension filters of the reports and the **Exclude values** list of the Analytics dimensions report
- the values export
- the values Plaid lists

Sorting the budget lines list on a dimension's column follows this order too, then the value name. Lines without a value come last in ascending order. Report rows keep their own order, by amount.

At first, the values are in alphabetical order. A new value goes last in its dimension.

To change the order:

1. Select the dimension on the page and click **Reorder**. The dialog lists every value of the dimension, disabled ones and values for one kind of line included, each with its mark (**Disabled**, **OPEX only**, **CAPEX only**).
2. Drag the values into place with the mouse. With the keyboard, move to a value, press Space or Enter to pick it up, move it with the arrow keys, then press Space or Enter to drop it. Escape puts it back.
3. Click **Save**. **Cancel** leaves the order as it was.

The new order shows at once in the lists and filters. The [Audit log](admin.md#audit-log) records the change on the dimension, with the order before and after.

### OPEX or CAPEX values

The **Used for** field of a value says which budget lines may use it:

| Value | Meaning |
|-------|---------|
| **OPEX and CAPEX** | OPEX and CAPEX lines can both use the value. This is the default |
| **OPEX only** | Only OPEX lines can use the value |
| **CAPEX only** | Only CAPEX lines can use the value |

The field of an OPEX line offers the values for OPEX and for both. The field of a CAPEX line does the same for CAPEX. A line that already holds a value of the other kind keeps it, shows it and stays editable, like a disabled value. Choosing such a value for another line, or when you change the value of a line, is refused: in the app, in a budget file, through the API and in Plaid.

- When the dimension is used for one kind of line only, the kind it excludes is unavailable in the field, with a line such as "The IT tower dimension is for OPEX lines only." **OPEX and CAPEX** and the dimension's own kind stay selectable. A value cannot be limited to the kind of line its dimension excludes.
- When lines of the other kind hold the value, one line appears under the field, for example "4 CAPEX lines have this value. They keep it, but new CAPEX lines cannot choose it." Click **Show these lines** to open them in the list, in a new tab. The line stays as long as the conflict exists.
- The Analytics dimensions report offers the values of the selected kind in its **Exclude values** list. See [Reporting](reports.md#analytics-dimensions).

---

## Status and lifecycle

Dimensions and values each have a status (**Enabled** or **Disabled**) and an optional **End of validity**. Use them to retire a dimension or a value without deleting it.

- **End of validity**: the date it stops. Leave it blank to keep it active. You can also schedule a future date.
- Switching to **Disabled** ends its validity now: it is disabled at once. While a future date is set, the switch reads **Active until** and that date. Switching back to **Enabled** clears the date.
- When the end of validity passes, the status switches to **Disabled** on its own within the hour.

**A disabled value**:

- Cannot be picked for a line, in the app, in an imported file or through Plaid.
- Stays on the lines that already have it and keeps counting in reports. In the field's list it is marked **Disabled**.

**A disabled dimension**:

- Is not checked when it is **Required**: lines can be created without a value on it. It keeps the setting for when you enable it again.
- Disappears from the line forms, the budget lines list, the report filters, the report's dimension picker, the OPEX and CAPEX exports and Plaid. Only the Analytics dimensions page shows it, marked **Disabled**.
- Keeps its values on the lines. Enable the dimension again and they show again.
- Takes no new values. **New value** is disabled while the dimension is selected, and imported files cannot add or change its values.

The default dimension cannot be disabled.

**Prefer disabling over deleting**: disabling keeps reports consistent while keeping the lists clean.

---

## Values on budget lines

In the **Properties** panel of an OPEX or CAPEX line, and when you create one, each enabled dimension used for that kind of line has its own field, named after the dimension, in dimension order. The default dimension shows as **Analytics dimension** until you rename it.

- Pick a value, or clear the field to leave the line without a value on that dimension. The change saves at once.
- A required dimension's field is marked with an asterisk. A new line cannot be created without a value on it, with the message "Cost pool is required". On a line that holds a value, the field offers no clear button: you can only pick another value. See [Required dimensions](#required-dimensions).
- The field lists the enabled values of its dimension that are used for this kind of line. A disabled value, or a value used for the other kind of line only, stays shown on the lines that have it. See [OPEX or CAPEX values](#opex-or-capex-values).
- On a dimension with [open values](#open-values), the field offers **Add “…”** for a name that does not exist. On the other dimensions, the field cannot create a value: create values on the Analytics dimensions page, or let the budget file create them.
- A value applies to the whole line, across all years.
- If the dimensions cannot be loaded, one line replaces these fields: "Dimensions could not be loaded."

The budget lines list has one column per enabled dimension, with checkbox filters. The column of a dimension required for OPEX or CAPEX lines shows by default, and the other columns are hidden. A column layout you saved keeps its own choice. See [Budget lines](budget-lines.md).

---

## Reports

The **Analytics dimensions** report (under **Reporting**) shows how the budget of your OPEX or CAPEX lines is spread across the values of one dimension. See [Reporting](reports.md#analytics-dimensions) for the full description.

- **Line type**: OPEX or CAPEX
- **Dimension**: the dimension the report groups on. It shows when you have two or more enabled dimensions, and starts on the default dimension
- **Year range**: single year (pie or bar chart) or several years (line chart)
- **Metric**: any budget column your organization shows, under its name. Starts on the default column
- **Exclude values**: leave out some values to focus on the others. The list offers the values used for the selected line type, plus the values the lines hold

The seven budget reports can also be narrowed to one value of a dimension, with one filter per dimension. See [Cost center, run or build and analytics filters](reports.md#cost-center-run-or-build-and-analytics-filters).

---

## Analytics dimensions in Plaid

- Plaid can filter and group OPEX lines on every enabled dimension used for OPEX lines, and CAPEX lines on every enabled dimension used for CAPEX lines.
- A question about the analytics category uses the default dimension, whatever its name or order.
- Plaid's search and the `@` mentions in the chat find a budget line by the name of a value it holds on a dimension shown for its type, with or without accents.
- Plaid can set, change or clear a line's value on any dimension when it creates or updates a budget line. Ask for example: "Set the Cost pool of BL-12 to Software". Plaid finds the value by its name within that dimension and shows the dimension and the value, before and after, in the preview. Nothing changes until you approve it.
- Plaid follows the same rules as the app: only enabled dimensions used for the line's type, only enabled values used for the line's type, and a line keeps a value it already has.
- When Plaid creates a line, it needs a value on each required dimension of the line's type. In a workspace created before the recommended dimensions, a CAPEX line needs **PP&E type**, **Investment type** and **Priority**.
- Plaid knows which dimensions are required. A new line needs a value on each of them, and Plaid cannot clear the value of a required dimension. Plaid refuses a request that breaks the rule and says why, for example "Cost pool is required for spend item creation."
- Plaid can also create a value in the dimension you name. Without a dimension, the value goes into the default dimension.
- With read access to analytics, Plaid also reads the settings of each dimension, its number of values and the lines that use it. Ask, for example: "Which dimensions are required?"

---

## CSV import/export

The export writes a CSV file or an Excel workbook (`.xlsx`): choose under **Format** in the dialog. The import reads either. See [CSV and Excel files](csv-files.md).

Load or update the values of every dimension from one file. Dimensions are created on the page.

To set values on budget lines from a file, use the budget file. In it, one `analytics:<code>` column holds each enabled dimension, the default dimension included. See [Load a budget from a spreadsheet](budget-file.md).

**Export**: click **Export**, then **Export data**. The file lists the values of every dimension, enabled or disabled, dimension by dimension, each dimension's values in its order. The file has no order column. For an empty file with the headers only, use **Download template** in the import dialog.

**CSV structure**:

- Headers: `axis_code`, `name`, `description`, `status`, `disabled_at`, `applies_to`
- The export writes the separator of the screen language. See [CSV and Excel files](csv-files.md) for the encoding, the separator, the date forms and the two import steps

| Column | Content |
|---|---|
| `axis_code` | The code of the value's dimension, regardless of case. Empty means the default dimension |
| `name` | Required. The name of the value |
| `description` | Free text |
| `status` | `enabled` or `disabled`. Empty means `enabled` for a new value and keeps the stored status on an update |
| `disabled_at` | The end of validity: a date (`2026-12-31`) or a full date and time. The export writes the date only. Imported again, that date keeps the stored end of validity. Empty if there is no end. On an update, a blank `status` and a blank `disabled_at` keep the stored values. `enabled` with an empty date clears the end of validity. `disabled` with an empty date keeps a date that has already passed, and otherwise ends the value today |
| `applies_to` | The **Used for** setting, always the last column. `opex`, `capex`, or empty for **OPEX and CAPEX**. A file without this column leaves the settings as they are. An empty cell sets **OPEX and CAPEX** |

Only `name` is a required column. When the `description`, `status`, `disabled_at` or `applies_to` column is missing, existing values keep what is stored for it, and new values are enabled with no description. A file without `axis_code` puts every row in the default dimension.

**Import**:

1. Click **Import** on the page
2. Choose your file
3. Click **Preflight check**. The report gives the number of rows, the values to create and update, and the rows that change nothing
4. If the preflight is clean, click **Load**

**How the import works**:

- **The whole file is checked before anything is written.** A file with any error loads nothing: fix the rows and run the preflight again. Each error names its row by the line of the file as a text editor shows it, blank lines and cells that span several lines included.
- **Matching by dimension and name**: a row whose name exists in its dimension updates that value; any other row creates one. Each cell replaces the stored value, so an empty `description` clears it. A name written with another case finds the stored value and does not rename it. To rename a value, rename it on the page.
- **Unchanged rows**: a row identical to the stored value changes nothing. Exporting and importing the same file reports every row as unchanged.
- **Disabled dimensions**: a row of a disabled dimension is accepted when it changes nothing, so an exported file imports as it is. A row that would create or change a value there is refused.
- **Values missing from the file** are left as they are. The import never deletes.
- **Order**: existing values keep their place. New values go last in their dimension, in the order of the file. To change the order, use **Reorder** on the page.

**Common errors**:

- **"Unknown dimension '...'."**: the `axis_code` cell matches no dimension. Check the code in the dimension's workspace, or create the dimension first.
- **"The ... dimension is disabled. Enable it or leave it out."**: a row creates or changes a value in a disabled dimension. Enable the dimension, or remove the row.
- **"... is already on row N."**: two rows carry the same name for the same dimension. Keep one.
- **"Invalid status '...'. Use 'enabled' or 'disabled'."**: fix the `status` cell.
- **"Invalid applies_to '...'. Use 'opex', 'capex' or leave it empty."**: fix the `applies_to` cell.
- **"The ... dimension is for OPEX lines only."** (or CAPEX): the row limits a value to the kind of line its dimension excludes. Fix the `applies_to` cell, or change the dimension's **Used for**.
- **"Status is enabled but the end of validity has passed. Clear the date or set the status to disabled. If the file comes from an older export, export the data again."**: the row is enabled with a date that has passed. A file exported before the date passed still says `enabled`: export it again, or fix the cell.
- **"Status is disabled but the end of validity is still to come. Set the status to enabled or set a date that has passed."**: the row is disabled with a date still to come. Fix the `status` or the `disabled_at` cell.
- **"Header: Missing columns: ..."** or **"Header: Unknown columns: ..."**: download a fresh template.

---

## Permissions

| Level | What it allows |
|---|---|
| `analytics:reader` | View the Analytics dimensions page and open dimensions and values |
| `analytics:member` | Create dimensions and values, edit them and set the order of dimensions and values |
| `analytics:admin` | Everything above, plus import and export, the recommended dimensions, and deletion |

The built-in Budget Administrator role is admin, Budget Member is member and Budget Reader is reader. Anyone who can read budget lines (Budget) or reports sees the dimensions and their values on budget lines, in the lists and in the reports, without access to this page.

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
Yes, one per dimension. A line can be **Software** on Cost pool and **Application** on IT tower. Within one dimension, a line has one value or none.

**Do analytics dimensions affect allocations or accounting?**
No. They are for reporting only and have no impact on cost allocations or formal accounting.

**How many values should I create?**
Start with 5 to 10 per dimension. More than 20 usually means the dimension tries to answer too many questions: split it into two dimensions.

**What is the difference between analytics dimensions, departments and cost centers?**
**Departments** are formal organizational units with precise allocation drivers. **Cost centers** say who owns and answers for the spend. **Analytics dimensions** are free, optional classifications for reporting, with no allocation or ownership attached.

**Why do some lines show "Unassigned"?**
In the Analytics dimensions report, lines without a value on the chosen dimension appear as "Unassigned". This is expected: values are optional, unless the dimension is required. Even then, lines created before the setting was turned on can lack a value. The dimension's workspace counts them and links to them.

**What happens to the lines when I rename a value or a dimension?**
Nothing changes on the lines. Lists and reports show the new name at once.
