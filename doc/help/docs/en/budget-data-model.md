# Budget data model

This page describes how KANAP organises budget data: the objects, how they relate, which fields identify a record, and which files carry each object in and out. It is written for finance controllers and budget administrators preparing a move from spreadsheets or another tool, and for the technical team connecting a BI tool to an on-premise installation.

The files described here are the contract to rely on. Their columns are documented in this manual and checked on import, and when a layout changes, an import refuses a file in the old layout and says why. The database tables behind them are internal: they change when KANAP evolves. Base a move from another tool, and any integration, on the files.

## The objects at a glance

| Object | What it holds | Where to manage it |
|---|---|---|
| **OPEX line** | A recurring cost, carried from year to year | **Budget management > OPEX** |
| **CAPEX line** | An investment, carried from year to year | **Budget management > CAPEX** |
| **Budget columns** | The five amount columns every line has for each year | **Budget management > Administration > Budget columns** |
| **Quantity and price lines** | The lines a column can be calculated from | The **Budget** tab of a line |
| **Allocation** | How a line's cost of one year is split over companies or departments | The **Allocations** tab of a line |
| **Company** | A legal entity that pays, with its yearly metrics | **Master data > Companies** |
| **Department** | A unit of a company, with its yearly headcount | **Master data > Departments** |
| **Chart of accounts** and **account** | The accounts a company books its lines on | **Master data > Charts of accounts** |
| **Cost center** | Who owns the spend, in a tree of groups | **Master data > Cost centers** |
| **Supplier** | Who is paid | **Master data > Suppliers** |
| **Analytics dimension** and **value** | Free classifications for reporting | **Master data > Analytics dimensions** |
| **Working-day calendar** | Working days per month and year, for prices per day | **Master data > Working-day calendars** |
| **User** | IT and business owners, budget holders | **Administration > Users** |
| **Currencies** | Allowed currencies, reporting currency, exchange rates | **Budget management > Administration > Currencies** |

## How the objects relate

| Object | Refers to | How many |
|---|---|---|
| OPEX or CAPEX line | Paying company | One |
| | Account, from the chart of accounts of the paying company | One |
| | Currency, among the allowed currencies | One |
| | Cost center | Zero or one. A group cannot be used |
| | Supplier | Zero or one |
| | Value of each enabled analytics dimension | Zero or one per dimension |
| | IT owner and business owner (users) | Zero or one each |
| | Budget years | One per year |
| Budget year of a line | Budget columns | Five, each with twelve monthly amounts |
| | Quantity and price lines | Up to 50 per column |
| | Allocation | One method, with its companies or departments |
| Quantity and price line priced per day | Working-day calendar | One |
| Cost center | Company | One |
| | Budget holder (user) | Zero or one |
| | Parent group | Zero or one |
| Group of cost centers | Parent group | Zero or one. A group has no company |
| Company | Chart of accounts | One. A company without its own chart uses the chart that is the default for other countries |
| | Country and base currency | One each |
| | Metrics: headcount, IT users, turnover | One set per year |
| Department | Company | One |
| Account | Chart of accounts | One |
| Analytics value | Analytics dimension | One |

A line also links to projects, requests, applications, assets, contracts, contacts, tasks, websites and attachments. See [Links to other objects](#links-to-other-objects).

## Budget lines

### OPEX and CAPEX lines

A line lives across years: a three-year licence is one line with three budget years. KANAP gives each line a number when it is created: `OPX-12` for OPEX, `CPX-3` for CAPEX. The number identifies the line in the budget file.

| Field | Column in the budget file | Required | Notes |
|---|---|---|---|
| Number | `item_number` | Set by KANAP | Empty in the file creates a line |
| Product name (OPEX), title (CAPEX) | `name` | Yes | |
| Description (OPEX) | `description` | No | |
| PP&E type (CAPEX) | `ppe_type` | Yes | `hardware` or `software` |
| Investment type (CAPEX) | `investment_type` | Yes | `replacement`, `capacity`, `productivity`, `security`, `conformity`, `business_growth` or `other` |
| Priority (CAPEX) | `priority` | Yes | `mandatory`, `high`, `medium` or `low` |
| Paying company | `company_name` | Yes | Taken from the cost center when only the cost center is given |
| Supplier | `supplier_name`, `supplier_erp_id` | No | |
| Account | `account_number` | Yes | In the chart of accounts of the paying company |
| Cost center | `cost_center_code` | No | A group is refused |
| Run or build | `run_build` | No | `run` or `build` |
| Analytics values | `analytics:<code>` | No | One column per enabled dimension |
| IT owner, business owner | `owner_it_email`, `owner_business_email` | No | Active users |
| Project | `project` | No | A project number such as `PRJ-3` |
| Currency | `currency` | Yes | Three-letter ISO code |
| Effective start | `effective_start` | Yes | In a file, defaults to January 1 of the first year with an amount in the row, else of the current year |
| End of validity | `end_of_validity` | No | The only end date of a line |
| Notes | `notes` | No | |

A line has no status of its own to load. It is enabled until its end of validity, then disabled within the hour. The budget holder shown on a line comes from its cost center and is not stored on the line.

### Budget years

Each line holds one budget per year. The **Budget** tab shows the current year, the two years before and the two years after. A budget file can export up to twelve years at once.

A budget year holds the five budget columns with their monthly amounts, the quantity and price lines of each column, and the allocation of that year.

### Budget columns

Every line has the same five columns for each year. They are set once for the whole organisation, for OPEX and CAPEX alike.

| Position | Standard name | Name in files |
|---|---|---|
| 1 | Budget | `budget` |
| 2 | Revision | `revision` |
| 3 | Forecast (hidden by default) | `forecast` |
| 4 | Actuals | `actual` |
| 5 | Expected landing | `landing` |

- A budget administrator can rename a column (up to 40 characters), hide it and choose the default column. The name in files stays the same, so a file keeps working after a rename. See [Budget columns](budget-operations.md#budget-columns).
- A hidden column keeps its amounts and still accepts imports.
- Columns are frozen per year, per column and per scope (OPEX or CAPEX). A frozen column refuses edits, imports, copies and resets. See [Freeze / unfreeze data](budget-operations.md#freeze-unfreeze-data).

There is no sixth column. To keep several budget rounds, use one column per round, or copy a column to another year or column with [Copy budget columns](budget-operations.md#copy-budget-columns).

### Monthly amounts

Each column of a budget year holds twelve monthly amounts, with two decimals, in the currency of the line. The year total is the sum of the months. A file can carry the yearly total or the twelve months of a column: a yearly total is spread over the column's period, as in the **Budget** tab.

Each column also records its period inside the year and how its amounts were produced: a spread, a copy, an edit by hand, or its quantity and price lines. Reports convert the amounts to the reporting currency with the exchange rates of the year. See [Currency Settings](currencies.md).

### Quantity and price lines

A column can be calculated from lines, each a quantity times a unit price. Each line has a description (up to 200 characters), a quantity (up to 3 decimals), a unit (**people**, **days** or **pieces**), a unit price (up to 4 decimals), how often it counts, a period or a date, and a working-day calendar when the price is per day. The FTE of the column is derived from the lines. See [Quantity and price](opex.md#quantity-and-price).

These lines are entered in the **Budget** tab. No file carries them. A budget file writes the monthly amounts of a column, and the lines stay with it as a reference.

### Allocations

Each budget year of a line has one allocation method:

| Method | Split by |
|---|---|
| Default | The organisation's default for the year, set in [Default allocation method](budget-operations.md#default-allocation-method) |
| Headcount, IT users, Turnover | The company metrics of the year |
| Manual by company | A driver, over the companies you pick |
| Manual by department | The headcount of the departments you pick |
| Manual percentages | Percentages you type, adding up to 100% |

Allocations drive the chargeback reports. No file imports them. [Copy allocations](budget-operations.md#copy-allocations) carries them from one year to the next, and the chargeback reports export their tables as CSV. See [Reporting](reports.md).

### Links to other objects

| Link | Where it is made | In a file |
|---|---|---|
| Projects | The **Relations** tab of the line, or of the project | The budget file carries one project per line in `project`. The links of the **Relations** tab are not in the file. The lists show both |
| Requests | The **Relations** tab of the request | No |
| Applications | The **Relations** tab of the line, or of the application | No |
| Assets | The **Relations** tab of the asset | No |
| Contracts | The **Relations** tab of the line, or of the contract | No |
| Contacts, websites, attachments | The **Relations** tab of the line | No |
| Tasks | The **Overview** tab of the line | No |

## Reference data

The budget file finds reference data by business identifiers. Load the reference data first. The budget file creates missing suppliers when **Create missing suppliers** is ticked, and missing analytics values. It creates nothing else.

| Object | Identified in files by | Required | On a budget line |
|---|---|---|---|
| Company | `name` | Name, country, base currency. The screen also asks for a city | `company_name` |
| Department | `company_name` and `name` | Company, name | Used by allocations |
| Chart of accounts | Its code (`coa_code` in the accounts file) | Code, name, scope | Through the paying company |
| Account | `account_number` within its chart (`coa_code` on the global file) | Number, name | `account_number` |
| Cost center | `code`, whatever the case | Code, name, type, and the company of a cost center | `cost_center_code` |
| Supplier | `name` | Name | `supplier_erp_id`, then `supplier_name` |
| Analytics dimension | Its code | Code | The `analytics:<code>` column header |
| Analytics value | `axis_code` and `name` | Name | The cell of its dimension column |
| Working-day calendar | `code`, whatever the case | Code, name | Used by quantity and price lines |
| User | `email` | Email | `owner_it_email`, `owner_business_email` |

Points that matter when you map another tool to KANAP:

- **Companies** carry their headcount, IT users and turnover per year. The turnover is in millions of the company's base currency. Allocations by headcount, IT users or turnover need the metrics of the year.
- **Accounts** belong to a chart of accounts, and a company uses one chart. An account number is a whole number, unique within its chart. A budget line's account must exist in the chart of its paying company. See [Chart of Accounts](chart-of-accounts.md).
- **Cost centers** form a tree. A group gathers cost centers and other groups, and may span companies. A cost center belongs to one company, has no children and is the only node a line can use. Its budget holder shows on every line it carries. See [Cost centers](cost-centers.md).
- **Suppliers** are matched by name in their own file. The budget file matches them by ERP ID first, then by name: keep the ERP ID filled when your ERP has one.
- **Analytics dimensions** are created on their page, each with a code. A line holds at most one value per dimension. See [Analytics dimensions](analytics.md).
- **Working-day calendars** are standard (following a country's public holidays) or custom. They hold the working days of each month, year by year. See [Working-day calendars](working-day-calendars.md).
- **Currencies** are three-letter ISO codes. The allowed currencies, the reporting currency and the exchange rates are set on the screen and have no file.

## Exchange formats

Every file below exports and imports from the page that manages the object. Imports run in two steps: a check that writes nothing, then a load. Except for the contracts file, they share the encoding, separator, date and amount rules and the size limit described in [CSV files](csv-files.md).

| Object | Export | Import | Matched by | Details |
|---|---|---|---|---|
| OPEX lines and their amounts | Yes | Yes | `item_number` | [Load a budget from a spreadsheet](budget-file.md) |
| CAPEX lines and their amounts | Yes | Yes | `item_number` | [Load a budget from a spreadsheet](budget-file.md) |
| Companies and their metrics | Yes | Yes | `name` | [Companies](companies.md) |
| Departments | Yes | Yes | `company_name` and `name` | [Departments](departments.md) |
| Accounts | Yes | Yes | `account_number` within the chart | [Chart of Accounts](chart-of-accounts.md) |
| Charts of accounts | No | No | | Created on the page or from a template. See [Chart of Accounts](chart-of-accounts.md) |
| Cost centers | Yes | Yes | `code` | [Cost centers](cost-centers.md) |
| Suppliers | Yes | Yes | `name` | [Suppliers](suppliers.md) |
| Analytics values | Yes | Yes | `axis_code` and `name` | [Analytics dimensions](analytics.md) |
| Working-day calendars | Yes | Yes | `code`, one row per calendar and year | [Working-day calendars](working-day-calendars.md) |
| Users | Yes | Yes | `email` | [Users CSV](admin.md#users-csv) |
| Contracts | Yes | Yes | `name` and `supplier_name` | [Contracts](contracts.md). The file does not carry the links to budget lines |
| Allocations | From the chargeback reports | No | | [Reporting](reports.md) |
| Quantity and price lines, budget column settings, freezes, currencies | No | No | | Set on the screen |

The budget file reads and writes the amounts of any column and year, as yearly totals or months, with the line details in the same row. It is the way in for a budget prepared elsewhere and the way out for a spreadsheet or a BI tool. Each budget list exports and imports its own file: the OPEX file from **Budget management > OPEX**, the CAPEX file from **Budget management > CAPEX**.

### Moving a budget into KANAP

1. Map each object of your current tool to the tables above, and its identifiers to the **Matched by** column.
2. Load the reference data in the order given in [Loading a whole budget](budget-file.md#loading-a-whole-budget).
3. Export the OPEX file and the CAPEX file to get the header row of your organisation, with one column per analytics dimension. A list with no line exports the header row alone.
4. Fill one row per line, leaving `item_number` empty, with one amount column per budget column and year (`budget_2027`), or per month (`budget_2027_03`).
5. Import the files. The check reports the errors by line of the file, and nothing is written until you load.

A consistent set of sample files, with one fictional company and its reference data, is in the [KANAP repository](https://github.com/kanap-hq/KANAP/tree/main/doc/samples).

## Reading the data directly

On an on-premise installation, the PostgreSQL database is yours: KANAP runs on the database you provide. You can read it, back it up and connect tools to it.

Before you do, keep three facts in mind.

**Row-level security filters every read.** KANAP connects with a dedicated application role that cannot bypass row-level security. It refuses to start with a superuser role or a role that bypasses it. Every table holding your data shows its rows only to a session that has set the workspace it reads. A session that has not set it gets empty results, with no error.

**The tables are internal.** Their names, columns and storage change between versions, through the migrations that run at each upgrade. Column names in the database are storage keys and differ from the names on screen and in the files. A query written against today's tables can return wrong or empty results after an upgrade.

**Your objects can block an upgrade.** PostgreSQL refuses to change or drop a column that a view depends on. A view created on KANAP tables can make an upgrade fail. Keep your queries in the BI tool or in a separate reporting database.

For a BI tool, use the exports first. The budget file and the master data files carry business names and identifiers, documented in this manual.

When a tool must read the database, give it a read-only role of its own. Never reuse the application role. For example, as the PostgreSQL administrator, with `kanap` as the application role and database:

```sql
-- The workspace of this installation
SELECT id FROM tenants;

CREATE ROLE kanap_bi LOGIN PASSWORD 'change-me' NOSUPERUSER NOBYPASSRLS;
GRANT CONNECT ON DATABASE kanap TO kanap_bi;
GRANT USAGE ON SCHEMA public TO kanap_bi;
GRANT SELECT ON spend_items, capex_items, companies, accounts TO kanap_bi;
ALTER ROLE kanap_bi IN DATABASE kanap SET app.current_tenant = '<id from the first query>';
```

Grant `SELECT` on the tables your reports need only. The database also holds user accounts, sign-in data and settings that a reporting tool has no use for. Check the grants and the queries after each upgrade.
