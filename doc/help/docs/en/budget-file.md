# Load a budget from a spreadsheet

Most teams prepare their budget in a spreadsheet: one row per line, one column per year or per month. KANAP holds the same lines in its budget lines list, where they drive allocations, reports and the overview.

The budget file is the bridge between the two. Export the lines, change the cells you care about in Excel or LibreOffice, import the file back. KANAP compares every cell with what it holds and writes only what changed.

One file holds both kinds of line. Its `nature` column says whether a row is an OPEX or a CAPEX line, and every row is checked against the rules of its own kind. The list exports the lines it shows, OPEX and CAPEX together. Filter the **Type** column to export one kind only.

## Where to find it

- Path: **Budget management > Budget lines**
- Export: **Export** in the list toolbar
- Import: **Import** in the same toolbar
- Permissions: both buttons need the Admin level on Budget (`budget:admin`), which covers OPEX and CAPEX lines alike

## Export

1. Click **Export** in the list.
2. Choose what the file holds:

| Setting | What it does |
|---|---|
| **Lines** | The lines the list shows, with its search, filters and status scope. **All lines** exports every line instead, ended lines included, without the list's filters |
| **Years** | **First year** and **Last year**, up to twelve years. The default is the current year, the year before and the year after. Tick **Current year** to export the current year alone |
| **Columns** | The budget columns to write. The columns your organisation shows are ticked, and a hidden one is marked **hidden**. Its header is shown under the name, for example `budget_2027` |
| **Detail** | **Yearly totals**: one column per column and year. **Months**: one column per column, year and month |
| **Format** | **CSV** or **Excel (.xlsx)**. Your browser remembers the choice for the next export |

3. Click the button at the bottom of the dialog. It names what the file will hold: **Export 120 filtered lines**, **Export all lines**, **Export 3,412 lines**, and so on.

The file is saved as `budget.csv` or `budget.xlsx`. A CSV file is written for the language the screen is shown in:

| Language | Separator | Amounts | Dates |
|---|---|---|---|
| English | `,` | `12280.50` | `2027-03-01` |
| French, Spanish | `;` | `12280,50` | `01/03/2027` |
| German | `;` | `12280,50` | `01.03.2027` |

The Excel file has the same columns on one sheet named `budget`. Amounts are numbers exact to the cent, and dates are dates, shown in the day order of your language. The header row stays in place when you scroll, with a filter on each column.

Exporting a list with no line gives the header row alone. That is your template.

Every export is recorded in the [audit log](admin.md#audit-log), with its settings, its format and its number of lines.

## The columns

A file holds one row per line: the detail columns, then the amount columns, then `kanap_token`.

### Detail columns

The detail columns are the same for both kinds of line.

| Column | Holds | On a new line |
|---|---|---|
| `nature` | `opex` or `capex`, the kind of line | Required. A file without this column is read as OPEX lines, or as CAPEX lines when the **Type** filter of the list keeps CAPEX only |
| `item_number` | The line's reference: `BL-12`, or `12`. The `OPX-12` and `CPX-3` numbers of earlier files are read too | Empty: the row adds a line |
| `name` | The title of the line, shown in the **Product name** column of the list | Required |
| `description` | The long description | Optional |
| `company_name` | Paying company. Empty on a new line: the cost center's company. A company other than the cost center's is accepted, with a warning | Required unless the line has a cost center |
| `supplier_name` | Supplier name | Optional |
| `supplier_erp_id` | The supplier's ID in your ERP | Optional |
| `account_number` | Account number, in the paying company's chart of accounts | Required |
| `cost_center_code` | Cost center code. A group is refused | Optional |
| `cost_center_path` | The cost center's place in the tree, from its top group down to the cost center, names separated by ` / `, for example `IT / Infrastructure / Network`. Empty for a cost center at the top of the tree or a line without one. Use it to filter or group lines by department in your spreadsheet | Export only, ignored on import |
| `run_build` | `run` or `build` | Optional |
| `analytics:<code>` | The value's name in the dimension whose code it is, regardless of case. One column per enabled dimension, the default dimension included. A dimension used for one kind of line only takes a value on the rows of that kind and stays empty on the others. In a new workspace, the recommended dimensions are in `analytics:default` (the cost pool), `analytics:it_tower`, `analytics:purpose` and `analytics:priority`, for example `Software`, `Application`, `Replacement` or `High` | Optional, except for a required dimension of the line's kind, such as the PP&E type of a CAPEX line in a workspace created before the recommended dimensions. A value that does not exist is created by the load |
| `owner_it_email` | Email of an active user | Optional |
| `owner_business_email` | Email of an active user | Optional |
| `project` | Project number, such as `PRJ-3` | Optional |
| `currency` | Three-letter ISO code, among the currencies your workspace allows | Required |
| `effective_start` | The day the line starts | January 1 of the first year with an amount in the row, else of the current year |
| `end_of_validity` | The day the line stops | No end |
| `notes` | Free text | Optional |

### Amount columns

An amount column is named after the budget column and the year: `budget_2027`. With **Months** detail, the month is added: `budget_2027_03`.

| File name | The column in the app |
|---|---|
| `budget` | The first column, named Budget by default |
| `revision` | The second column, named Revision by default |
| `forecast` | The third column, named Forecast by default |
| `actual` | The fourth column, named Actuals by default |
| `landing` | The fifth column, named Expected landing by default |

These are the standard names. Your organisation can rename the five columns in [Budget columns](budget-operations.md#budget-columns), hide some and choose a default. The file always writes the technical name above, whatever your columns are called on screen.

### The last column

`kanap_token` is written by KANAP. Leave it as it is. KANAP uses it to tell you when a line changed after your export. Leave it empty on a line you add.

## What a cell means

- An empty cell keeps the stored value. An empty `nature` cell keeps the kind of an existing line.
- `-` clears a line detail: description, notes, supplier name and ERP supplier ID, cost center, run or build, a dimension value, an owner, the project, the end of validity. On a column a new line must fill, and on `nature`, `-` is a row error. On a required dimension, `-` is a row error when the line holds a value.
- `0` writes zero.
- A yearly total equal to the stored total writes nothing. A different one is spread over the column's period, exactly as when you type the total in the **Budget** tab.
- A month cell writes that month, and marks the column as edited by hand, as a month typed in the **Budget** tab does.
- An amount has at most two decimals. An amount cell cannot be cleared with `-`: write `0`, or leave the cell empty.
- A file can hold the yearly total of a column and year, or its twelve months, never both.

An absent column keeps every stored value of that column. A file holding only `item_number` and a few amount columns is a valid file.

## Adding and matching lines

- `item_number` filled: that line is updated. Empty: a new line is created, of the kind its `nature` cell says.
- `item_number` holds the line's reference, `BL-12`. In a file with a `nature` column, a bare number is the same reference. The `OPX-12` and `CPX-3` numbers of earlier files still name their line. Naming one line twice in a file is a row error.
- A line keeps its kind. A row that names an existing line with the other `nature` is refused, for example "BL-125 is a CAPEX line, not an OPEX line. A file does not change the type of a line."
- Each row is checked against its own kind: the dimensions and values it may hold, its account, the frozen columns and the duplicate warning. A column frozen for CAPEX refuses a change on a CAPEX line only.
- There is no other key. A new row that looks like an existing line of its kind, or like another new row of the same kind in the file, is a warning you can ignore.
- Suppliers are matched by `supplier_erp_id` when it is filled, otherwise by `supplier_name`. A supplier the file names and KANAP does not have is created by the load when **Create missing suppliers** is ticked. Without it, the check lists them and asks you to create them in **Master data > Suppliers**.
- A dimension value that does not exist is created by the load, and listed in the check. For a person with limited data access, only on a dimension with open values: see [Limited data access](#limited-data-access). Accounts, cost centers, companies and users are never created: an unknown one is a row error naming where to add it.
- A value, or `-`, on a dimension used for the other kind of line only is a row error on its `analytics:<code>` cell, for example "The Recurrence dimension is for CAPEX lines only. Leave it out." The export leaves such a cell empty, so a value hidden on a line is not exported and a load leaves it in place. The setting is in [Analytics dimensions](analytics.md#opex-or-capex-dimensions).
- A value used for the other kind of line only is a row error on its `analytics:<code>` cell, for example "Internal labor is for OPEX lines only. Pick a value for CAPEX lines." A line keeps the value it already holds. Values the load creates are used for OPEX and CAPEX. The setting is in [Analytics dimensions](analytics.md#opex-or-capex-values).
- A new line needs a value on each required dimension of its own kind, with the message "The Cost pool dimension is required. Choose a value." on the `analytics:<code>` cell. This holds when the column is missing from the file, when the cell is empty and when it holds `-`. A value the load creates counts. An existing line is refused only for a `-` that would clear the value it holds: an empty cell or a missing column leaves it as it is. The setting is in [Analytics dimensions](analytics.md#required-dimensions).
- A row that creates a line, or changes its account, is refused when the account is for the other kind of line, with the message "Account 6061 is for CAPEX lines only." (or OPEX). A line keeps its current account, and the account setting is in [Chart of Accounts](chart-of-accounts.md#opex-or-capex-accounts).
- Projects are matched by their number, such as `PRJ-3`.
- An ended line is a line whose `end_of_validity` has passed. Set the date to end a line, or write `-` in the cell to clear it and keep the line running. There is no status column.

## Check, then load

1. Click **Import** and choose the file, a CSV file or an Excel workbook (`.xlsx`), or drop it on the dialog. The file is checked at once. Nothing is written.
2. Read the report:

| Section | What it shows |
|---|---|
| **Errors** | The rows the load refuses, by line of the file with the column when it knows it. A file with one error loads nothing |
| **Changes** | The lines to create, the lines to update and the lines the file leaves as they are |
| **Changed in KANAP since the export** | The lines someone changed after your export, with who and when. Loading the file writes your values over those changes |
| **Warnings** | A row that looks like another line, a `company_name` other than the company of the row's cost center, an amount that stops a column following its calculation lines, columns and cells the file ignores |
| **Created by the load** | The suppliers and the dimension values the load would add |

3. Click **Load**. The load writes everything or nothing.

If a line changed between the check and the load, the load stops and asks you to check the file again. The check also states how it read the file when a date or an amount could be read in two ways, with a button to switch the reading.

### Columns built from quantity and price

A line can build a column from calculation lines, quantity × price: see [Quantity and price](budget-lines.md#quantity-and-price). The budget file carries the totals and the months of a column only. Calculation lines are edited on the line's **Budget** tab.

When the file changes the yearly total or a month of such a column, the check shows a warning for each line, column and year, for example:

> BL-83 · Revision 2026: 3 calculation lines (281 280) will no longer drive these amounts.

The load is allowed. After it, the calculation lines stay on the line as a reference, with their total, and the column follows the amounts of the file. A yearly total equal to what the lines give writes nothing: the column keeps following its lines.

## Limited data access

A person limited to part of the budget uses the file within their access, when their role allows it. See [Data access](data-access.md).

- The export holds the lines they see.
- A row that names a line they do not see is treated like a line that does not exist. In a file from an export, the message is "BL-12 is no longer available since the export.", the same as for a line deleted since then.
- A line they see in Read passes when its row is unchanged. A change is refused with "BL-12 is read only in your access."
- A new line, or a new company or cost center on a line, must fit one of their Edit nodes. Otherwise the row is refused with "This company or cost center is not part of your access."
- An unknown value is created only on a dimension with open values. On the other dimensions, it is a row error.

These rows appear among the **Errors** of the check, like any other refused row.

## Excel and LibreOffice

Opening the file and saving it keeps it loadable, as CSV or as `.xlsx`. Both programs keep the columns, the separator and the values.

In a workbook, KANAP reads the first sheet. When the workbook has other sheets, the check says which sheet it read. An amount or a date typed in a cell is read exactly as it is, with no question of decimal mark or day order. An old Excel file (`.xls`) is refused: save it as `.xlsx` or CSV.

A date or an amount written as text, which the file cannot settle on its own, is read the way the export wrote it, then in the language the screen is shown in. Every date whose day is 12 or less is ambiguous (`01/03/2027` is March 1 in French and January 3 in English), and so is an amount written like `12,280`. The check says how it read them and offers a button to switch.

A column KANAP does not know is ignored, with a warning. A column that looks like a misspelled amount column, such as `budjet_2027`, refuses the whole file. An `analytics:<code>` column that names no enabled dimension refuses the whole file too, with "Unknown dimension 'x'."

## Files from earlier versions

A file in an older layout is refused as a whole: the old OPEX and CAPEX files with `y_budget` style columns, and the budget rows file with `measure` and `jan` … `dec` columns. The screen shows this message:

> This file comes from an earlier version of KANAP. Export a fresh file from this list, copy your changes into it, and import it again.

A CAPEX file exported before the PP&E type, investment type and priority became dimensions, recognised by its three columns `ppe_type`, `investment_type` and `priority` together, is refused as a whole too. These values now travel in dimension columns. One or two of these columns alone are unknown columns, ignored with a warning. The screen shows this message:

> The ppe_type, investment_type and priority columns are now dimension columns (analytics:ppe_type, analytics:investment_type, analytics:priority). Export a fresh file from this list, copy your changes into it, and import it again.

Export a fresh file and copy your rows into it.

An OPEX or CAPEX file exported before the `nature` column was added is accepted. Its rows are read as OPEX lines, or as CAPEX lines when the **Type** filter of the list keeps CAPEX only, and its `OPX-12` and `CPX-3` numbers still name their lines: import an earlier OPEX file with the list on OPEX or both types, and an earlier CAPEX file with the list filtered on CAPEX. Its `kanap_token` cells stay valid. A bare number keeps its earlier meaning in such a file: filtered on CAPEX, `3` is `CPX-3`; otherwise, it is the number of the OPEX line.

KANAP recognises the `nature` column by its name, whatever the case. An earlier file with a column of your own named Nature must rename it before the import: KANAP would read that column as the kind of each line and refuse its values.

## Loading a whole budget

The budget file holds budget lines. The paying company, the account, the cost center, the supplier and the users a line names must exist first. A small team loads them in this order:

1. A chart of accounts and its accounts, in [Chart of Accounts](chart-of-accounts.md)
2. The companies, in [Companies](companies.md)
3. The budget file, with **Create missing suppliers** ticked. It holds the OPEX and the CAPEX lines together, or you load one file per kind

A larger organisation adds the rest of the master data in between:

1. The chart of accounts and its accounts
2. The companies
3. The users, in [Users](admin.md)
4. The cost centers, in [Cost centers](cost-centers.md)
5. The suppliers, in [Suppliers](suppliers.md)
6. The dimension values, in [Analytics dimensions](analytics.md). The dimensions themselves are created on that page
7. The working-day calendars, in [Working-day calendars](working-day-calendars.md), once lines carry quantity and price
8. The budget file, OPEX and CAPEX lines

**The chart of accounts comes first.** On the Charts of Accounts page, click **New**, give the chart a code and a name, and choose **All countries** under **Used for**. Then click **Manage charts**, open the **⋯** menu of the chart and click **Make default for other countries**. A company without a chart takes that one, which is how the account numbers of a budget file resolve. Select the chart on the page, then click **Import** to load its accounts.

Each of these pages has its own import section with the columns of its file. Every one of them reads a CSV file or an Excel workbook. See [CSV and Excel files](csv-files.md).
