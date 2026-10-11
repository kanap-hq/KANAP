# Load a budget from a spreadsheet

Most teams prepare their budget in a spreadsheet: one row per line, one column per year or per month. KANAP holds the same lines in its OPEX and CAPEX lists, where they drive allocations, reports and the overview.

The budget file is the bridge between the two. Export the lines, change the cells you care about in Excel or LibreOffice, import the file back. KANAP compares every cell with what it holds and writes only what changed.

One file holds both kinds of line. Its `nature` column says whether a row is an OPEX or a CAPEX line, and every row is checked against the rules of its own kind. The OPEX list exports its OPEX lines and the CAPEX list its CAPEX lines, in the same layout. Either list imports a file that holds both.

## Where to find it

- Path: **Budget Management > OPEX**, or **Budget Management > CAPEX**
- Export: **Export CSV** in the list toolbar
- Import: **Import CSV** in the same toolbar
- Permissions: both buttons need administration rights on that list (`opex:admin` or `capex:admin`). A file that holds OPEX and CAPEX lines needs both

## Export

1. Click **Export CSV** in the OPEX or CAPEX list.
2. Choose what the file holds:

| Setting | What it does |
|---|---|
| **Lines** | The lines the list shows, with its search, filters and status scope. **All lines** exports every line instead, ended lines included, without the list's filters |
| **Years** | **First year** and **Last year**, up to twelve years. The default is the current year, the year before and the year after |
| **Columns** | The budget columns to write. The columns your organisation shows are ticked, and a hidden one is marked **hidden**. Its header is shown under the name, for example `budget_2027` |
| **Detail** | **Yearly totals**: one column per column and year. **Months**: one column per column, year and month |

3. Click the button at the bottom of the dialog. It names what the file will hold: **Export 120 filtered lines**, **Export all lines**, **Export 3,412 lines**, and so on.

The file is saved as `budget.csv`, from either list, and written for the language the screen is shown in.

| Language | Separator | Amounts | Dates |
|---|---|---|---|
| English | `,` | `12280.50` | `2027-03-01` |
| French, Spanish | `;` | `12280,50` | `01/03/2027` |
| German | `;` | `12280,50` | `01.03.2027` |

Exporting a list with no line gives the header row alone. That is your template.

## The columns

A file holds one row per line: the detail columns, then the amount columns, then `kanap_token`.

### Detail columns

The detail columns are the same for both kinds of line.

| Column | Holds | On a new line |
|---|---|---|
| `nature` | `opex` or `capex`, the kind of line | Required. A file without this column is read as lines of the list you import it on |
| `item_number` | The line's reference: `BL-12`, or `12`. The `OPX-12` and `CPX-3` numbers of earlier files are read too | Empty: the row adds a line |
| `name` | The product name of an OPEX line, the title of a CAPEX investment | Required |
| `description` | The long description | Optional |
| `company_name` | Paying company | Required unless the line has a cost center |
| `supplier_name` | Supplier name | Optional |
| `supplier_erp_id` | The supplier's ID in your ERP | Optional |
| `account_number` | Account number, in the paying company's chart of accounts | Required |
| `cost_center_code` | Cost center code. A group is refused | Optional |
| `run_build` | `run` or `build` | Optional |
| `analytics:<code>` | The value's name in the dimension whose code it is, regardless of case. One column per enabled dimension, the default dimension included. A dimension used for one kind of line only takes a value on the rows of that kind and stays empty on the others. The PP&E type, investment type and priority of a CAPEX line are in `analytics:ppe_type`, `analytics:investment_type` and `analytics:priority`, for example `Hardware`, `Business growth` or `High` | Optional, except for a required dimension of the line's kind, such as the three CAPEX dimensions on a CAPEX line. A value that does not exist is created by the load |
| `owner_it_email` | Email of an active user | Optional |
| `owner_business_email` | Email of an active user | Optional |
| `project` | Project number, such as `PRJ-3` | Optional |
| `currency` | Three-letter ISO code, among the currencies your workspace allows | Required |
| `effective_start` | The day the line starts | January 1 of the first year with an amount in the row, else of the current year |
| `end_of_validity` | The day the line stops | No end |
| `notes` | Free text | Optional |

On a CAPEX line, `description` is not read or written yet: the export leaves it empty, and a filled cell is ignored with a warning.

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
- `item_number` holds the line's reference, `BL-12`. In a file with a `nature` column, a bare number is the same reference, on both lists. The `OPX-12` and `CPX-3` numbers of earlier files still name their line. Naming one line twice in a file is a row error.
- A line keeps its kind. A row that names an existing line with the other `nature` is refused, for example "BL-125 is a CAPEX line, not an OPEX line. A file does not change the type of a line."
- A file that holds OPEX and CAPEX lines needs administration rights on both. Without one of them, each line of that kind is refused with the right it needs, for example "Importing CAPEX lines needs the Admin level on CAPEX." The other lines are checked as usual, and the file loads once those rows are removed.
- Each row is checked against its own kind: the dimensions and values it may hold, its account, the frozen columns and the duplicate warning. A column frozen for CAPEX refuses a change on a CAPEX line only.
- There is no other key. A new row that looks like an existing line of its kind, or like another new row of the same kind in the file, is a warning you can ignore.
- Suppliers are matched by `supplier_erp_id` when it is filled, otherwise by `supplier_name`. A supplier the file names and KANAP does not have is created by the load when **Create missing suppliers** is ticked. Without it, the check lists them and asks you to create them in **Master data > Suppliers**.
- A dimension value that does not exist is created by the load, and listed in the check. Accounts, cost centers, companies and users are never created: an unknown one is a row error naming where to add it.
- A value, or `-`, on a dimension used for the other kind of line only is a row error on its `analytics:<code>` cell, for example "The Recurrence dimension is for CAPEX lines only. Leave it out." The export leaves such a cell empty, so a value hidden on a line is not exported and a load leaves it in place. The setting is in [Analytics dimensions](analytics.md#opex-or-capex-dimensions).
- A value used for the other kind of line only is a row error on its `analytics:<code>` cell, for example "Abonnements SaaS is for OPEX lines only. Pick a value for CAPEX lines." A line keeps the value it already holds. Values the load creates are used for OPEX and CAPEX. The setting is in [Analytics dimensions](analytics.md#opex-or-capex-values).
- A new line needs a value on each required dimension of its own kind, with the message "The Nature dimension is required. Choose a value." on the `analytics:<code>` cell. This holds when the column is missing from the file, when the cell is empty and when it holds `-`. A value the load creates counts. An existing line is refused only for a `-` that would clear the value it holds: an empty cell or a missing column leaves it as it is. The setting is in [Analytics dimensions](analytics.md#required-dimensions).
- A row that creates a line, or changes its account, is refused when the account is for the other kind of line, with the message "Account 6061 is for CAPEX lines only." (or OPEX). A line keeps its current account, and the account setting is in [Chart of Accounts](chart-of-accounts.md#opex-or-capex-accounts).
- Projects are matched by their number, such as `PRJ-3`.
- An ended line is a line whose `end_of_validity` has passed. Set the date to end a line, or write `-` in the cell to clear it and keep the line running. There is no status column.

## Check, then load

1. Click **Import CSV** and choose the file, or drop it on the dialog. The file is checked at once. Nothing is written.
2. Read the report:

| Section | What it shows |
|---|---|
| **Errors** | The rows the load refuses, by line of the file with the column when it knows it. A file with one error loads nothing |
| **Changes** | The lines to create, the lines to update and the lines the file leaves as they are |
| **Changed in KANAP since the export** | The lines someone changed after your export, with who and when. Loading the file writes your values over those changes |
| **Warnings** | A row that looks like another line, columns and cells the file ignores |
| **Created by the load** | The suppliers and the dimension values the load would add |

3. Click **Load**. The load writes everything or nothing.

If a line changed between the check and the load, the load stops and asks you to check the file again. The check also states how it read the file when a date or an amount could be read in two ways, with a button to switch the reading.

## Excel and LibreOffice

Opening the file and saving it keeps it loadable. Both programs keep the columns, the separator and the values.

A date or an amount the file cannot settle on its own is read the way the export wrote it, then in the language the screen is shown in. Every date whose day is 12 or less is ambiguous (`01/03/2027` is March 1 in French and January 3 in English), and so is an amount written like `12,280`. The check says how it read them and offers a button to switch.

A column KANAP does not know is ignored, with a warning. A column that looks like a misspelled amount column, such as `budjet_2027`, refuses the whole file. An `analytics:<code>` column that names no enabled dimension refuses the whole file too, with "Unknown dimension 'x'."

## Files from earlier versions

A file in an older layout is refused as a whole: the item files with `y_budget` style columns, and the budget rows file with `measure` and `jan` … `dec` columns. The screen shows this message:

> This file comes from an earlier version of KANAP. Export a fresh file from this list, copy your changes into it, and import it again.

A CAPEX file exported before the PP&E type, investment type and priority became dimensions, recognised by its three columns `ppe_type`, `investment_type` and `priority` together, is refused as a whole too. These values now travel in dimension columns. One or two of these columns alone are unknown columns, ignored with a warning. The screen shows this message:

> The ppe_type, investment_type and priority columns are now dimension columns (analytics:ppe_type, analytics:investment_type, analytics:priority). Export a fresh file from this list, copy your changes into it, and import it again.

Export a fresh file and copy your rows into it.

An OPEX or CAPEX file exported before the `nature` column was added is accepted. Its rows are read as lines of the list you import it on, and its `OPX-12` and `CPX-3` numbers still name their lines: import an earlier OPEX file from the OPEX list and an earlier CAPEX file from the CAPEX list. Its `kanap_token` cells stay valid. A bare number keeps its earlier meaning in such a file: on the CAPEX list, `3` is `CPX-3`; on the OPEX list, it is the number of the OPEX line.

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

**The chart of accounts comes first.** On the Charts of Accounts page, click **New**, give the chart a code and a name, and choose **All countries** under **Used for**. Then click **Manage charts**, open the **⋯** menu of the chart and click **Make default for other countries**. A company without a chart takes that one, which is how the account numbers of a budget file resolve. Select the chart on the page, then click **Import CSV** to load its accounts.

Each of these pages has its own **Import CSV** section with the columns of its file.
