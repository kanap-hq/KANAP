# Load a budget from a spreadsheet

Most teams prepare their budget in a spreadsheet: one row per line, one column per year or per month. KANAP holds the same lines in its OPEX and CAPEX lists, where they drive allocations, reports and the overview.

The budget file is the bridge between the two. Export the lines, change the cells you care about in Excel or LibreOffice, import the file back. KANAP compares every cell with what it holds and writes only what changed.

There is one file per list. The OPEX list exports and imports the OPEX file, the CAPEX list the CAPEX file. Both files carry the same columns and follow the same rules.

## Where to find it

- Path: **Budget Management > OPEX**, or **Budget Management > CAPEX**
- Export: **Export CSV** in the list toolbar
- Import: **Import CSV** in the same toolbar
- Permissions: both buttons need administration rights on that list (`opex:admin` or `capex:admin`)

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

The file is written for the language the screen is shown in.

| Language | Separator | Amounts | Dates |
|---|---|---|---|
| English | `,` | `12280.50` | `2027-03-01` |
| French, Spanish | `;` | `12280,50` | `01/03/2027` |
| German | `;` | `12280,50` | `01.03.2027` |

Exporting a list with no line gives the header row alone. That is your template.

## The columns

A file holds one row per line: the detail columns, then the amount columns, then `kanap_token`.

### Detail columns

These are the same in both files, except for the type-specific columns near the start.

**OPEX**

| Column | Holds | On a new line |
|---|---|---|
| `item_number` | The line's number: `OPX-12` or `12` | Empty: the row adds a line |
| `name` | Product name | Required |
| `description` | The long description | Optional |
| `company_name` | Paying company | Required unless the line has a cost center |
| `supplier_name` | Supplier name | Optional |
| `supplier_erp_id` | The supplier's ID in your ERP | Optional |
| `account_number` | Account number, in the paying company's chart of accounts | Required |
| `cost_center_code` | Cost center code. A group is refused | Optional |
| `run_build` | `run` or `build` | Optional |
| `analytics:<code>` | The value's name in the dimension whose code it is. One column per dimension, the default dimension included | Optional. A value that does not exist is created by the load |
| `owner_it_email` | Email of an active user | Optional |
| `owner_business_email` | Email of an active user | Optional |
| `project` | Project number, such as `PRJ-3` | Optional |
| `currency` | Three-letter ISO code, among the currencies your workspace allows | Required |
| `effective_start` | The day the line starts | January 1 of the first year with an amount in the row, else of the current year |
| `end_of_validity` | The day the line stops | No end |
| `notes` | Free text | Optional |

**CAPEX**

| Column | Holds | On a new line |
|---|---|---|
| `item_number` | The line's number: `CPX-3` or `3` | Empty: the row adds a line |
| `name` | The title of the investment | Required |
| `ppe_type` | `hardware` or `software` | Required |
| `investment_type` | `replacement`, `capacity`, `productivity`, `security`, `conformity`, `business_growth` or `other` | Required |
| `priority` | `mandatory`, `high`, `medium` or `low` | Required |
| `company_name` | Paying company | Required unless the line has a cost center |
| `supplier_name` | Supplier name | Optional |
| `supplier_erp_id` | The supplier's ID in your ERP | Optional |
| `account_number` | Account number, in the paying company's chart of accounts | Required |
| `cost_center_code` | Cost center code. A group is refused | Optional |
| `run_build` | `run` or `build` | Optional |
| `analytics:<code>` | The value's name in the dimension whose code it is. One column per dimension, the default dimension included | Optional. A value that does not exist is created by the load |
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

- An empty cell keeps the stored value.
- `-` clears a line detail: description, notes, supplier name and ERP supplier ID, cost center, run or build, a dimension value, an owner, the project, the end of validity. On a column a new line must fill, `-` is a row error.
- `0` writes zero.
- A yearly total equal to the stored total writes nothing. A different one is spread over the column's period, exactly as when you type the total in the **Budget** tab.
- A month cell writes that month, and marks the column as edited by hand, as a month typed in the **Budget** tab does.
- An amount has at most two decimals. An amount cell cannot be cleared with `-`: write `0`, or leave the cell empty.
- A file can hold the yearly total of a column and year, or its twelve months, never both.

An absent column keeps every stored value of that column. A file holding only `item_number` and a few amount columns is a valid file.

## Adding and matching lines

- `item_number` filled: that line is updated. Empty: a new line is created.
- There is no other key. A new row that looks like an existing line, or like another new row of the same file, is a warning you can ignore.
- Suppliers are matched by `supplier_erp_id` when it is filled, otherwise by `supplier_name`. A supplier the file names and KANAP does not have is created by the load when **Create missing suppliers** is ticked. Without it, the check lists them and asks you to create them in **Master data > Suppliers**.
- A dimension value that does not exist is created by the load, and listed in the check. Accounts, cost centers, companies and users are never created: an unknown one is a row error naming where to add it.
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
| **Warnings** | A row that looks like another line, columns the file ignores |
| **Created by the load** | The suppliers and the dimension values the load would add |

3. Click **Load**. The load writes everything or nothing.

If a line changed between the check and the load, the load stops and asks you to check the file again. The check also states how it read the file when a date or an amount could be read in two ways, with a button to switch the reading.

## Excel and LibreOffice

Opening the file and saving it keeps it loadable. Both programs keep the columns, the separator and the values.

A date or an amount the file cannot settle on its own is read the way the export wrote it, then in the language the screen is shown in. Every date whose day is 12 or less is ambiguous (`01/03/2027` is March 1 in French and January 3 in English), and so is an amount written like `12,280`. The check says how it read them and offers a button to switch.

A column KANAP does not know is ignored, with a warning. A column that looks like a misspelled amount column, such as `budjet_2027`, refuses the whole file.

## Files from earlier versions

A file in an older layout is refused as a whole: the item files with `y_budget` style columns, and the budget rows file with `measure` and `jan` … `dec` columns. The screen shows this message:

> This file comes from an earlier version of KANAP. Export a fresh file from this list, copy your changes into it, and import it again.

Export a fresh file and copy your rows into it.

## Loading a whole budget

The budget file holds budget lines. The paying company, the account, the cost center, the supplier and the users a line names must exist first. A small team loads them in this order:

1. A chart of accounts and its accounts, in [Chart of Accounts](chart-of-accounts.md)
2. The companies, in [Companies](companies.md)
3. The OPEX file, with **Create missing suppliers** ticked
4. The CAPEX file, with **Create missing suppliers** ticked

A larger organisation adds the rest of the master data in between:

1. The chart of accounts and its accounts
2. The companies
3. The users, in [Users](admin.md)
4. The cost centers, in [Cost centers](cost-centers.md)
5. The suppliers, in [Suppliers](suppliers.md)
6. The dimension values, in [Analytics dimensions](analytics.md). The dimensions themselves are created on that page
7. The working-day calendars, in [Working-day calendars](working-day-calendars.md), once lines carry quantity and price
8. The OPEX file
9. The CAPEX file

**The chart of accounts comes first.** On the Charts of Accounts page, click **New**, give the chart a code and a name, and choose the **Global** scope. Then open **Manage** and click **Set global default**. A company without a chart takes that one, which is how the account numbers of a budget file resolve. Select the chart on the page, then click **Import CSV** to load its accounts.

Each of these pages has its own **Import CSV** section with the columns of its file.
