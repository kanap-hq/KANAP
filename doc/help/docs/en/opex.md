# OPEX

OPEX (Operating Expenditure) items are your recurring IT costs: software licenses, cloud subscriptions, maintenance contracts, and services. This is where you plan budgets, track actuals, and allocate costs across your organization.

The OPEX workspace helps you manage each spend item from initial budgeting through execution and reporting -- all in one place with year-by-year budget columns, flexible allocation methods, and direct links to suppliers, contracts, applications, and projects.

## Getting started

Navigate to **Budget management > OPEX** to see your list. Click **New** to create your first item.

The workspace opens in creation mode, with the **Properties** panel open on the right. Type the product name in the title at the top, fill in the properties, then click **Create**.

**Required fields**:
  - **Product name** (the title): What you are spending on (e.g., "Salesforce Licenses", "AWS Compute")
  - **Paying company**: Which company pays for this spend (required for accounting)
  - **Account**: The general ledger account for this spend. Only accounts from the paying company's chart of accounts appear
  - **Currency**: ISO code (e.g., USD, EUR). Defaults to your workspace currency; you can override per item
  - **Effective start**: When this spend begins (DD/MM/YYYY)

**Optional but useful**:
  - **Supplier**: Who you are paying. Links to your suppliers in master data
  - **Cost center**: Who owns the spend. See [Cost centers](cost-centers.md). When the paying company is still empty, picking a cost center fills it with the cost center's company
  - **Run or build**: **Run** for spend that keeps existing services running, **Build** for spend that creates or changes them
  - **Analytics dimensions**: One field per dimension, named after it, for custom grouping in reports (e.g., "Licenses" on Nature). The default dimension shows as **Analytics dimension** until it is renamed. See [Analytics dimensions](analytics.md)
  - **End of validity**: The date this spend stops. Leave it blank if there is no end. After it, the item is disabled and later years no longer count in the budget views
  - **IT owner** / **Business owner**: Who is responsible
  - **Description** and **Notes**: Free text on the Overview tab

Once set, **Paying company** and **Account** can be changed but not emptied. **Supplier** can be cleared at any time.

When you change the paying company of an item that has an account, and the new company uses another chart of accounts, the account is cleared in the same save. **Account** then shows as required, with the list on the new company's chart. Pick the new account to finish.

Once the item is created, the workspace unlocks all four tabs: **Overview**, **Budget**, **Allocations**, and **Relations**.

**Tip**: You can create items quickly and fill in budgets and allocations later. Start with the essentials and iterate.

---

## Working with the OPEX list

The OPEX list (at **Budget management > OPEX**) is your main view for browsing, filtering, and navigating spend items.

**Default columns**:
  - **Product name**: The item name (links to the Overview tab)
  - **Supplier**: The supplier name
  - **Paying company**: Which company pays for this item
  - **Contract**: The latest linked contract name (links to the Contract workspace)
  - **Account**: The GL account number and name
  - **Allocation**: The allocation method label for the current year (links to the Allocations tab)
  - **Budget Y** and **Expected landing Y**: The current-year amounts of the default column and of the last shown column (links to the Budget tab for this year). With the standard settings these are Budget and Expected landing. When the default column is also the last shown one, a single amount column appears. See [Budget columns](budget-operations.md#budget-columns)
  - **Task**: The latest task title (links to the Overview tab, where the Tasks panel sits)

**Additional columns** (hidden by default, toggle via the column chooser):
  - **Amount columns**: Every shown budget column for Y-1, Y, Y+1 and Y+2, under the names your organisation chose. The header gives the column, the year relative to today and the calendar year, for example **Revision Y+1 (2027)**. Amounts are in the reporting currency. Hidden columns are not offered
  - **FTE columns**: The FTE of every shown budget column for Y-1, Y, Y+1 and Y+2, under the names your organization chose, right after the amount columns in the column chooser. The header gives the column and the calendar year, for example **Budget FTE (2026)**. A line has an FTE when the column was computed from quantity and price. See [FTE](#fte). The cell is empty when the FTE is unknown
  - **Enabled**: Item status (enabled or disabled)
  - **Description**: Item description
  - **Currency**: ISO currency code
  - **Effective start**: Start date
  - **End of validity**: Date the item stops (blank means no end)
  - **IT owner** / **Business owner**: Responsible users
  - **Analytics dimensions**: One column per enabled dimension, named after it, with the item's value. The default dimension's column comes first (**Analytics dimension** until it is renamed), then the other dimensions in their order
  - **Cost center**: The code and name of the cost center. Hover it to see its full path in the tree; click it to open the cost center
  - **Budget holder**: The budget holder of the item's cost center. It is derived from the cost center, not stored on the item: change the budget holder of a cost center and every item on it follows
  - **Run or build**: **Run** or **Build**
  - **Project**: Names of the projects linked on the Relations tab
  - **Notes**: Internal notes
  - **Created / Updated**: Timestamps

**Filtering**:
  - **Quick search**: Searches the reference, product name, description, supplier, paying company, account, contract, project names, allocation, owners, analytics values, cost center (code, name and path), budget holder, notes, currency and status. Filters the list in real time as you type
  - **Column filters**: Click the filter icon in any column header. **Supplier**, **Paying company**, **Account**, **Allocation**, **Currency**, **IT owner**, **Business owner**, each analytics dimension, **Cost center**, **Budget holder**, **Run or build** and **Enabled** use checkbox set filters (multi-select). The **Enabled** filter offers **Enabled** and **Disabled** and narrows the list when **Show** is set to **All**
  - **Amount filters**: Every amount column has a number filter. A number typed in the box under the header keeps the items with at least that amount. Open the filter menu for the other conditions: greater than, less than, equal, not equal, or between two amounts
  - **FTE filters**: Every FTE column has a number filter with the same conditions, plus blank and not blank. **Blank** keeps the lines whose FTE is unknown
  - **Date filters**: **Effective start**, **End of validity**, **Created** and **Updated** have date filters. Pick a date in the box under the header to keep the items on that date, or open the filter menu for before, after, between, blank or not blank
  - **Text columns** use text filters. On **Ref**, type the number or the full reference, for example `12` or `OPX-12`
  - **Status scope**: Use the **Show: All / Enabled / Disabled** toggle above the grid (defaults to **Enabled**)

**Sorting**:
  - Click a column header to sort ascending/descending. Every column sorts, including every amount and FTE column. Lines whose FTE is unknown come last in ascending order
  - Default sort is by the default column of the current year, highest first (**Budget Y** with the standard settings). The **Prev** and **Next** buttons of the workspace follow the same order
  - The list remembers your last sort, search, and filters when you return

**Totals row**:
  - The pinned row at the bottom shows the total of every amount column, in the reporting currency
  - Each shown FTE column shows the sum of the lines' FTE. When some lines have no FTE, the count follows the total, for example "3.50 · 12 unknown". Hover it for the full sentence: "Unknown for 12 lines". When no line has an FTE, the total is blank and only the count shows
  - Totals respect your current filters and search

**Deep linking**:
  - Clicking any cell opens the workspace on the most relevant tab:
    - **Product name**, **Supplier**, **Paying company**, **Account**, and other general columns: Opens the **Overview** tab
    - **Amount columns** (Budget Y, Expected landing Y, Revision Y+1, etc.) and **FTE columns**: Opens the **Budget** tab pre-set to the column's year
    - **Allocation**: Opens the **Allocations** tab for the current year
    - **Task**: Opens the **Overview** tab, where the Tasks panel sits
    - **Contract**: Opens the linked Contract workspace directly (not the OPEX workspace)
    - **Cost center**: Opens the cost center workspace

**Actions**:
  - **New**: Create a new OPEX item (requires `opex:manager`)
  - **Import CSV**: Bulk-load items from CSV (requires `opex:admin`)
  - **Export CSV**: Export items to CSV (requires `opex:admin`)
  - **Delete selected**: Bulk-delete selected items (requires `opex:admin`; select rows via checkboxes)

**Prev/Next navigation**:
  - When you open an item, the workspace shows **Prev** and **Next** buttons
  - These navigate through the list in the current sort order, respecting filters and search
  - Moving to another item saves your pending edits first
  - Your list context (sort, filters, search) is preserved when you close the workspace

**Tip**: Use column filters + quick search to build focused views (e.g., "All cloud spend over 10k"), then navigate item-by-item with Prev/Next to review budgets.

---

## The OPEX workspace

Click any row in the list to open the workspace. It has four parts:

  - **Header**: the item reference (e.g., `OPX-12`) with a copy button, the product name (click it to rename the item), **Prev** / **Next**, **Send link**, and the close button
  - **Metadata bar** under the title: **Status**, **IT owner**, and **Business owner**, each editable in place. When the item's cost center has a budget holder, **Budget holder** follows them. It is read only and derived from the cost center, not stored on the item: hover it to see which cost center it comes from, and change it on the cost center (see [Cost centers](cost-centers.md#budget-holder-on-budget-lines))
  - **Four tabs**: **Overview**, **Budget**, **Allocations**, and **Relations** (the Relations tab shows how many links the item has)
  - **Properties panel** on the right: the item's main fields. Open or close it with the properties button; the workspace remembers your choice

**Autosave**:
  - Every change saves automatically. A **Saving...** / **Saved** hint shows in the header
  - Switching tabs, moving to the previous or next item, or closing the workspace saves pending edits first. If a save fails, you stay where you are and an error explains why, so no edit is lost silently
  - **Ctrl+S** (**Cmd+S** on Mac) saves immediately

### Overview

The Overview tab holds the free-text fields and the tasks of the item.

**What you can edit**:
  - **Description**: What the spend covers
  - **Notes**: Free-form internal notes

**Tasks panel**:
  - Lists every task linked to this OPEX item, with **Title**, **Status**, **Priority**, **Due date**, and **Actions** columns. The panel title shows the number of tasks
  - **Status** filter: All (default), Active (not done), Open, In progress, Pending, In testing, Done, or Cancelled. The clear button resets it
  - Click **Add task** to open a new task already linked to this item. Fill in the title, description, priority, assignee, and due date in the task workspace
  - Use the open icon to go to a task, and the delete icon to delete it (you confirm first)
  - Tasks have their own permissions (`tasks:member` to create and edit). OPEX manager access does not grant task editing rights on its own; check with your admin if you cannot create tasks
  - Tasks can also be viewed and managed from **Portfolio > Tasks**, which shows all tasks across your organization

**Properties panel**:
  - **Supplier**, **Cost center**, **Paying company**, **Account** (filtered by the paying company's chart of accounts), **Currency** (only the currencies allowed in your workspace), one field per analytics dimension, **Run or build**, and **Effective start**
  - **Lifecycle**: the **Enabled** switch and the **End of validity** date. See [Status and lifecycle](#status-and-lifecycle)
  - **Created** and **Updated** dates (read only)

**Cost center**:
  - The list shows the cost center tree. Groups are shown to help you find your way and cannot be picked. Search by code, name or group name
  - A disabled cost center is marked **Disabled**. It stays on the items that already have it, and cannot be picked for another item
  - When you create an item and the paying company is empty, picking a cost center fills the paying company with the cost center's company, so the **Account** list opens on that company's chart of accounts. Until you pick a company or an account yourself, choosing another cost center updates the company too
  - When the paying company differs from the cost center's company, both are kept. A hint under the field says "This cost center belongs to" followed by the company name
  - An item saved through the API with a cost center and no paying company takes the cost center's company. For CSV files, see [CSV import/export](#csv-importexport)

**Run or build**: **Run**, **Build**, or **Not set**. Use it to split the budget between keeping services running and changing them.

**Analytics dimensions**:
  - Each enabled dimension has its own field, named after the dimension, in dimension order. Pick a value or clear the field; the change saves at once
  - Each field lists the enabled values of its dimension. A disabled value stays on the items that already have it, and cannot be picked for another item
  - The field cannot create a value: create it in [Analytics dimensions](analytics.md), or let a CSV import create it
  - If the dimensions cannot be loaded, one line replaces these fields: "Dimensions could not be loaded."

**Tip**: When you create an item, an "Obsolete account" warning means the selected account does not belong to the paying company's chart of accounts. Choose a different account to resolve the warning. An existing item whose account is outside its company's chart can still be edited: the chart is checked only when the company or the account changes.

---

### Budget

The Budget tab is where you enter financial data per year. It supports multiple budget columns and two input modes, shown as tabs: **Flat** (annual totals) and **Monthly** (monthly breakdown).

**Year selection**:
  - Use the year tabs at the top to switch between Y-2, Y-1, Y (current year), Y+1, and Y+2
  - Each year has its own version, mode, and amounts
  - Switching years saves your pending edits first

**Budget columns**:
  - The tab shows the columns your organisation shows, under their names, always in the same order. The standard columns are:
  - **Budget**: Initial annual budget approved at the start of the year
  - **Revision**: Mid-year budget update (e.g., after a reforecast)
  - **Forecast**: An additional planning column, hidden by default
  - **Actuals**: Actual spend, as it is recorded during the year
  - **Expected landing**: Your best estimate of the year-end figure
  - A budget administrator can rename the columns, hide some and choose the default column in **Budget management > Administration > Budget columns** (see [Budget columns](budget-operations.md#budget-columns)). A hidden column keeps its amounts

**Period of a column**:
  - Every column has a period inside the year, for example April to December
  - A month counts when the period covers its 15th. A period that starts on April 10 includes April; one that starts on April 20 begins in May
  - A column with no amount and no period yet gets a suggestion: the item's **Effective start** and **End of validity**, limited to the year. An item that starts on April 1 suggests April to December
  - A column that already holds amounts and has no period reads as the whole year, so existing data behaves as before

**Flat vs Monthly**:
  - **Flat**: Enter one total per column. The total is spread evenly over the months of the column's period, and the months outside it are set to zero. The period shows under each total before you type, for example "9 months, April to December". Only the total you edit is saved. The other columns keep their monthly amounts.
  - Click the pencil icon next to the period under a total (**Change period**) to open the spread panel on that column, with its current total. If the item's dates leave no month in the year, the total is disabled and reads "No month of 2026 is within the item's dates." Click the pencil icon next to it (**Choose the period**) to set one yourself.
  - Click the calculator icon next to the pencil (**Compute from quantity and price**) to open the same box on the computation for that column. See [Compute from quantity and price](#compute-from-quantity-and-price).
  - **Monthly**: Enter amounts per month (Jan-Dec) for each shown column. Quarter subtotals and a yearly total are shown. Only the months you change are saved.
  - Both tabs show the same columns: Forecast appears in **Flat** too when it is shown.
  - Switch between modes with the **Flat** and **Monthly** tabs. Switching does not change your amounts.

**Freeze behavior**:
  - If a year's budget columns are frozen (via Budget Administration), the corresponding inputs become read-only and show a lock icon
  - You can still view frozen data; admins can unfreeze via **Budget management > Administration > Freeze / unfreeze data**
  - Each column can be frozen independently

**Spreading an amount**:
  - The panel box has two tabs: **Spread an amount** and **Compute from quantity and price**. This part covers the first one
  - The spread panel is always visible in the **Monthly** tab. In the **Flat** tab it opens from the pencil icon under a total
  - Choose a **Column** among the shown columns, check the **Amount**, pick a **Distribution** (**Flat** or **4-4-5**), and set the **From** and **To** dates. The dates start from the column's current period, and the distribution from the column's own
  - The panel opens on the default column. The amount starts with the column's current total, in both tabs, and follows when you choose another column. It is empty when the column has no amount
  - **Apply to all columns** is on by default: every column that follows it gets the same period and distribution, each with its own current total. By default every column follows. A budget administrator chooses which ones in [Budget columns](budget-operations.md#budget-columns). Frozen columns never change. Hover the switch to see which columns follow and which keep their own period. Turn the switch off to spread only the selected column
  - A column that does not follow "Apply to all columns" spreads alone: the switch does not appear when you spread it. The switch is also hidden when no other following column can change
  - **Reset** fills the panel with the column's current total, **Flat** and the whole year. It saves nothing: click **Apply** to use it. With **Apply to all columns** on, **Reset** then **Apply** brings every following column back to a flat spread over twelve months
  - Totals typed in the **Flat** tab still apply to their own column only
  - The **From** and **To** dates show the period. When some months fall outside it, the panel says which ones will be set to zero ("January to March will be set to zero."). A whole-year period shows no line. Hover the info icon next to the panel title to see the 15th rule
  - With **4-4-5**, the weights of the months that count are scaled up so the whole amount lands on them
  - A soft warning appears when the period goes beyond the item's dates. You can still apply
  - **Apply** stays disabled while a date is missing or no month counts. Nothing is saved before you click **Apply**
  - From the **Monthly** tab, Apply fills the grid. From the **Flat** tab, you stay in the Flat view

**How each column was produced**:
  - A short label tells you where the amounts of a column come from. In the **Monthly** tab it sits under the column header (hover it to see the period). In the **Flat** tab it sits next to the period
  - **Spread flat**, **Spread 4-4-5** or **Spread by quarter**: the amounts come from a spread
  - **Copied from Budget 2025 +2%**: the amounts come from **Copy budget columns** in Budget Administration, with the percentage shown when there is one
  - **Computed per day, Head office staff**, **Computed per month** or **Computed for the whole period**: the amounts come from a quantity and a price. Hover the label to see the recipe, for example "Per day · Quantity 1 · Unit price 400 · Calendar Head office staff · Counts as FTE"
  - **Edited by hand**: a month was changed in the grid or by a budget rows import
  - A column with no label kept the data it had before periods existed

**Monthly tools**:
  - **Clear column**: the icon next to a column header sets every month of that column to zero, for example before entering the whole amount in a single month. It counts as an edit by hand. To remove both the amounts and the period of a column for every item, use **Reset budget column** in Budget Administration

**Multi-year trend**:
  - A chart below the grid shows every shown column across years, Forecast included when it is shown, and updates as you type

**How to use it**:
  1. Select the year you are planning for
  2. Choose the **Flat** or **Monthly** tab
  3. Fill in the relevant columns (Budget for initial planning, Actuals for tracking, Expected landing for the year-end figure)
  4. Your changes save automatically; a **Saving...** / **Saved** hint shows next to the year tabs

**Tip**: For most items, Flat mode is faster. Use Monthly mode when the spend varies significantly by month (e.g., seasonal licensing, one-time setup fees).

#### Compute from quantity and price

Compute a column from a quantity and a unit price instead of typing its amounts. For example: one consultant, 400 a day, on the working days of February to October.

**Opening the panel**:
  - **Flat** tab: click the calculator icon next to the period under a total. The box opens on **Compute from quantity and price** for that column
  - **Monthly** tab: click **Compute from quantity and price** at the top of the panel box

**Fields**:

| Field | What to enter |
|---|---|
| **Column** | The column to compute, among the shown columns. Frozen columns cannot be picked |
| **From** / **To** | The period. It starts from the column's current period. A month counts when the period covers its 15th, as for a spread |
| **Basis** | **Per day**: the unit price is a price per working day. **Per month**: the unit price is a price per month. **For the whole period**: the unit price is the price of the whole period |
| **Quantity** | How many units, for example 1 consultant or 50 licences. Zero or more, up to 3 decimals |
| **Unit price** | The price of one unit, in the item's currency. Up to 4 decimals. A negative price is accepted, for a credit |
| **Price index (%)** | An increase applied to the unit price, for example `3` for +3%. Empty means 0. Up to 4 decimals, and not below -100 |
| **Calendar** | **Per day** only. The working-day calendar whose days multiply the price. The list offers the enabled calendars, plus the column's own calendar if it was disabled since, marked "(disabled)". When there is no calendar yet, the field reads "No working-day calendar yet.", with an **Add a calendar** link for those who can create calendars. See [Working-day calendars](working-day-calendars.md) |
| **Counts as FTE** | Turn it on when the quantity is people. The lists then show it as FTE for the months that hold an amount. When it is off, the lists show 0 FTE for this column. Hover the label to read this hint. See [FTE](#fte) |

**How the months are computed**:
  - **Per day**: each month of the period gets its working days × quantity × unit price with the index. The calendar's days of the column's year are used. A month partly in the period counts whole, with all its working days, when the period covers its 15th
  - **Per month**: each month of the period gets quantity × unit price with the index
  - **For the whole period**: the total is quantity × unit price with the index. It is spread evenly over the months of the period, and the rounding difference lands on the last month
  - Each month is rounded to the cent. The months outside the period are set to zero
  - The price index applies to the unit price before anything else: 400 with an index of 2 gives 408

**The live line**: as you type, the panel shows the result under the fields, for example "9 months · 163 days · 65 200 · 0.75 FTE". It gives the months of the period, the working days (per day only), the total and the FTE (when **Counts as FTE** is on). Numbers follow the budget tab's style: spaces between thousands and a dot for decimals. Typing in the panel never saves anything, and it never creates the year on the item: only **Compute** writes. When the inputs are incomplete or refused, a sentence replaces the line, for example "Enter a quantity and a unit price to see the result." or "Choose a working-day calendar for a price per day."

**Compute**: click **Compute** to replace the twelve months of that column with the result. The other columns keep their amounts. The button stays disabled while the inputs are incomplete, while the column is frozen, and until the result is shown. From the **Flat** tab, the panel closes. From the **Monthly** tab, the grid shows the new months.

**Recompute**: on a column that already has a recipe, the panel opens with it, and the button reads **Recompute**. Before you click, the panel lists what would change:
  - The working days that changed in the calendar since the last computation, for example "Working days changed since the last computation: March: 20 days, now 19"
  - The months whose amount would change, for example "Amounts that would change: March: 8 000, now 7 600"
  - Or "The stored amounts already match." when nothing would change

Recompute uses the calendar's current days and the recipe in the panel. Change any field first to compute with new values, for example a new index for next year.

**Refusals you may meet**:
  - "Head office staff has no working days for 2027. Add them on the Working-day calendars page.": the calendar does not hold the column's year yet
  - "Head office staff is disabled. Pick an enabled calendar.": a disabled calendar cannot be chosen for another column. A column that already uses it can still be recomputed, with the warning "This calendar is disabled. The computation still uses it."
  - "Quantity accepts at most 3 decimals.", "Quantity cannot be negative.", "The price index cannot be below -100%."
  - "The computed amount is too large."

**What later changes do to the recipe**:
  - The recipe stays on the column after an edit by hand or a spread. The label then says **Edited by hand** or **Spread flat**, the recipe still shows when you hover it, and **Recompute** stays available
  - **Copy budget columns** in Budget Administration brings the source column's recipe with the amounts. See [Copying a computed column](budget-operations.md#copying-a-computed-column)
  - A copy from a column without a recipe removes the destination column's recipe: the destination has none afterwards, and its FTE becomes unknown.
  - **Reset budget column** in Budget Administration removes the recipe with the amounts. See [Reset budget column](budget-operations.md#reset-budget-column)
  - A budget rows file with the costing columns sets or clears it. See [Budget rows file](budget-operations.md#budget-rows-file)
  - Changing a calendar's working days changes nothing on the column until you recompute it

#### FTE

FTE (full-time equivalent) says how many people a line pays for over the year. KANAP follows the usual budget workbook convention: each month that holds an amount counts the quantity, and the year is the sum of the months divided by 12.

For example, 1 consultant from February to October: 9 months × 1 ÷ 12 = 0.75 FTE.

  - **Counted**: a column with a recipe and **Counts as FTE** on. Only the months of the period whose amount is above zero count. The result is rounded to 2 decimals, and totals add the rounded values of the lines
  - **Zero**: a column with a recipe and **Counts as FTE** off, for example licences. Its FTE is 0
  - **Unknown**: a column without a recipe, or an item without a version for that year, or a year after the item's end of validity. Its FTE is empty, never 0, because KANAP cannot tell how many people it pays for
  - The FTE follows the months that hold an amount. After a spread or an edit by hand over a computed column, the FTE still counts the quantity for each month that holds an amount
  - The FTE shows in the live line of the panel, and in the FTE columns of the OPEX list

---

### Allocations

The Allocations tab distributes the spend across your companies and departments. This drives chargeback reports and cost-per-user KPIs.

**Year selection**:
  - Works the same as Budget: use year tabs to switch between Y-2, Y-1, Y, Y+1, Y+2
  - Each year can have a different allocation method
  - The year total of the default column shows on the right, for example **Budget, year total**, and the table shows each share as a percentage and as an amount

**Allocation methods**:

| Method | How it works |
|---|---|
| **Headcount (default)** | Splits spend proportionally by each company's headcount for the selected year. No manual selection required -- percentages are computed automatically from company metrics. This is the standard default. |
| **IT users** | Splits spend proportionally by each company's IT user count for the selected year. |
| **Turnover** | Splits spend proportionally by each company's turnover (revenue) for the selected year. |
| **Manual by company** | You select which companies receive this spend and choose a driver in **Allocate by** (Headcount, IT users, or Turnover) to calculate percentages among the selected companies only. |
| **Manual by department** | You select specific company/department pairs. Percentages are calculated from each department's headcount. Useful when a spend item benefits only certain departments (e.g., a CRM used by Sales). |
| **Manual percentages** | You pick the companies and type each percentage yourself. The percentages must add up to 100%. |

**Default vs pinned methods**:
  - The **default** entry -- shown as *Headcount (default)* until your organisation configures another method -- follows the setting in **Budget management > Administration > Default allocation method**. Every item left on the default is re-driven when an admin changes that setting
  - That setting can also restrict the default to a **selection of companies** (for example the entity that carries the IT budget): the driver then applies to those companies only, and the option reads *Default (n companies)*
  - **Headcount**, **IT users** and **Turnover** pin that method on the item: a pinned method keeps working even if the organisation default changes later
  - Items with a manual allocation are never affected by the default setting

**How percentages work**:
  - For **automatic methods** (Headcount, IT users, Turnover): percentages are computed from the latest company metrics across your enabled companies. You do not edit them directly
  - For **Manual by company** and **Manual by department**: you pick the companies or departments, and the system calculates percentages from your chosen driver and the current metrics
  - For **Manual percentages**: typing a percentage pins that row, and the remaining rows share what is left. **Split equally** gives every row the same share; **Clear manual pins** releases the pinned rows
  - Percentages reflect live data. If you update a company's headcount, allocations recalculate

**How to use it**:
  1. Select the year
  2. Choose an allocation method in **Method**
  3. For a manual method, use **Add row** to add companies (or company/department pairs) and the remove icon to drop one. For **Manual by company**, pick a driver in **Allocate by**
  4. Changes save automatically

**Common issues**:
  - **Missing metrics**: One or more companies have zero or missing headcount/IT users/turnover for the selected year. Fill in the metrics in **Master data > Companies** (Details tab)
  - **"Manual percentages must sum to 100%."**: Adjust the rows, or click **Split equally**

**Tip**: Use Headcount (default) for most items -- it is the simplest and updates automatically. Reserve manual methods for spend that benefits specific companies or departments only.

---

### Relations

The Relations tab links this OPEX item to related objects: Projects, Applications, Contracts, Contacts, Relevant websites, and Attachments. Everything on this tab saves automatically.

**Projects**:
  - Use the autocomplete to link one or more projects from your Portfolio
  - This helps group spend by project in reports and enables project accounting
  - The project names appear in the OPEX list **Project** column, and the quick search finds them
  - Remove a project by clicking the X on its chip

**Applications**:
  - Use the autocomplete to link one or more applications or services from your IT catalogue
  - This helps track which OPEX items fund which applications or services

**Contracts**:
  - Use the autocomplete to link one or more contracts
  - When linked, the contract name appears in the OPEX list **Contract** column for quick reference
  - Contracts can link to multiple OPEX items (many-to-many relationship)
  - Remove a contract by clicking the X on its chip

**Contacts**:
  - Link contacts to this spend item: pick a contact, then pick its role (**Commercial**, **Technical**, **Support**, or **Other**). Choosing the role adds the contact
  - The table shows the role, first name, last name, job title, email, and mobile. Hover the role to see whether the contact comes from the supplier or was added manually
  - Remove a contact with the remove icon
  - Useful for tracking who to reach out to for renewals, support issues, or negotiations

**Relevant websites**:
  - Click **Add URL** to add a link (e.g., vendor portals, documentation, admin consoles, internal wikis). Each link has a **Name** and a **URL**
  - Click a link row to edit it, or use the delete icon to remove it

**Attachments**:
  - Upload files related to this spend item (e.g., contracts, invoices, quotes, SOWs, technical specs)
  - Drag and drop files into the attachment area, or click **Select files** to browse
  - Click a file chip to download the file
  - Delete an attachment with the delete icon on its chip (you confirm first; requires `opex:manager`)

**Tip**: Link contracts to track renewals across multiple OPEX items. Add vendor portal URLs for quick access. Upload quotes and invoices as attachments to centralize all spend-related documentation.

---

## CSV import/export

You can bulk-load OPEX items via CSV to speed up initial setup or sync with external systems.

**Export**:
  1. Click **Export CSV** in the OPEX list
  2. Choose:
     - **Template**: Headers only (use this to create a blank CSV to fill in)
     - **Data**: Every OPEX item with budgets for Y-1, Y, and Y+1

**CSV structure**:
  - Delimiter: semicolon `;` (not comma)
  - Encoding: UTF-8 (save as "CSV UTF-8" in Excel)
  - Headers: `product_name;description;supplier_name;company_name;account_number;currency;effective_start;status;disabled_at;owner_it_email;owner_business_email;analytics_category;cost_center_code;run_build;notes;y_minus1_budget;y_minus1_landing;y_budget;y_follow_up;y_landing;y_revision;y_plus1_budget;y_plus1_revision`
  - `disabled_at` is the end of validity: the date the item stops. Use a date (`2026-12-31`) or a full date and time. Leave it empty if there is no end
  - Older files with an `effective_end` column still import: its date fills the end of validity when `disabled_at` is empty
  - `analytics_category` holds the value of the default analytics dimension, whatever its name. Each other enabled dimension has its own column, `analytics:<code>`, where `<code>` is the dimension's code. Exports and the template carry these columns right after `analytics_category`, in dimension order
  - `analytics_category`, the `analytics:<code>` columns, `cost_center_code` and `run_build` are optional columns: exports and the template always carry them, and files without them still import

**Import**:
  1. Click **Import CSV** in the OPEX list
  2. Upload your CSV file (drag-and-drop or file picker)
  3. Click **Preflight check** to validate:
     - Every required column is present and no column is unknown. Columns are matched by name, in any order
     - Required fields (product_name, account_number) are present. A new item also needs a currency, and a company_name unless it has a cost center
     - Each company, supplier, account, cost center, and owner in the file exists in your workspace
     - Dates are valid, and no two rows describe the same item
     - Currencies are allowed in your workspace currency settings
     - Owners are active users
  4. Review the preflight report (shows counts and up to 5 sample errors). A file with any error loads nothing: fix the rows and run the preflight again
  5. If OK, click **Load** to import

**Important notes**:
  - **Matching**: A row is matched to an OPEX item by product name and supplier. A row that matches an existing item updates it; any other row creates a new item. A row with an empty `supplier_name` matches only an item that has no supplier. Two rows with the same product name and supplier are an error ("Same line as row N"): keep one row per item
  - **Currency**: Required for a new item, and it must be allowed in your workspace currency settings. On an existing item, an empty cell keeps its currency
  - **Supplier**: `supplier_name` is optional. When filled, a supplier with exactly this name is used. Otherwise the name is matched without regard to case. A name that matches no supplier is an error, and so is a name that matches several suppliers only by case (for example "Acme" and "ACME" when the file says "acme")
  - **Company and account**: `company_name` must match a company by name (case-insensitive). An empty `company_name` keeps the company of an existing item; a new item takes the company of its cost center. With neither, the row is refused: "Company is required unless the line has a cost center." `account_number` is looked up in the chart of accounts of that company, or in the default chart of accounts when the company has none. An account number that exists only in another chart is an error
  - **Owners**: `owner_it_email` and `owner_business_email` must match active users by email: an invited user or a contact without an account is refused
  - **Dates**: `effective_start` (and `effective_end` in older files) must be a real calendar day in `YYYY-MM-DD` format, for example `2026-01-01`. Other formats, such as `01/03/2026`, are errors. An empty `effective_start` keeps the stored date of an existing item; a new item starts on January 1 of the current year
  - **Analytics dimensions**: Each analytics cell names a value of its column's dimension, regardless of case. A value that does not exist yet is created in that dimension during the load. A disabled value is accepted on an item that already has it, and refused as a new value. An empty cell clears the item's value on that dimension. When a column is absent, items keep their value on that dimension. A column for an unknown or disabled dimension refuses the whole file, and so do two columns for the same dimension (`analytics_category` and the default dimension's own code). Exporting and importing the same file changes nothing
  - **Cost center**: `cost_center_code` is the code of a cost center, regardless of case. A group is refused. A disabled cost center is accepted on an item that already has it, and refused as a new value. An empty cell clears the item's cost center. When the whole column is absent, items keep their cost center
  - **Run or build**: `run_build` is `run`, `build` or empty (regardless of case). An empty cell clears the value. When the whole column is absent, items keep their value
  - **Company from the cost center**: A new item with an empty `company_name` takes its cost center's company, and `account_number` is looked up in that company's chart of accounts. A filled `company_name` is kept, even when it differs from the cost center's company
  - **Budgets**: Budget columns populate Y-1, Y, and Y+1 versions. Amounts are spread evenly across 12 months (Flat mode) and the column's period becomes the whole year. An empty cell leaves the column as it is; `0` clears it. The headers keep their technical names whatever your organisation calls the columns, and they also load hidden columns
  - **Monthly amounts**: to load or review amounts month by month, with the period of each column, use the **Budget rows file** in Budget Administration

**Common errors**:
  - **"Supplier '...' not found"**: Check the spelling, or create the supplier in **Master data > Suppliers** first, then re-import
  - **"Supplier '...' matches more than one supplier"**: Several suppliers differ from this name only by case. Write the name exactly as one of them, or rename one in **Master data > Suppliers**, then re-import
  - **"Same line as row N"**: Two rows describe the same item. Merge them into one row, then re-import
  - **"Account ... not found in ...'s chart of accounts"**: Use an account of the paying company's chart, or add the account in **Master data > Charts of accounts**, then re-import
  - **"effective_start must be a valid date"**: Use the `YYYY-MM-DD` format
  - **"Company is required unless the line has a cost center."**: Fill `company_name` or `cost_center_code` for the new item
  - **"Cost center ... was not found."**: Check the code, or create the cost center in **Master data > Cost centers**, then re-import
  - **"... is a group. Choose a cost center."**: Use the code of a cost center inside that group
  - **"Cost center ... is disabled."**: Use an enabled cost center, or enable it again in **Master data > Cost centers**
  - **"Run or build must be run, build or blank."**: Fix the `run_build` cell
  - **"The column analytics:... names no dimension. Check the dimension code or remove the column."**: Use the code shown in the dimension's workspace in **Master data > Analytics dimensions**, or remove the column
  - **"The ... dimension is disabled. Enable it or leave it out."**: Enable the dimension in **Master data > Analytics dimensions**, or remove its column
  - **"The file has two columns for ..."**: Two columns name the same dimension, for example `analytics_category` and the default dimension's own code. Keep one column
  - **"... is disabled. Pick an enabled value."**: Use an enabled value of that dimension, or enable the value again
  - **"Invalid currency"**: Use 3-letter ISO codes (USD, EUR, GBP) that are allowed in your workspace currency settings
  - **"Header mismatch"**: A required column is missing, or a column is unknown; the message lists them. Columns are matched by name, in any order, and the analytics columns are optional. Compare your first line with a fresh template

**Tip**: Start with the template export, fill in a few rows, and run a preflight to catch issues early. Fix errors in the CSV and re-upload until preflight passes, then load.

---

## Status and lifecycle

Every OPEX item has a **status** (Enabled or Disabled) and an optional **End of validity** that controls when it appears in reports and selection lists. It is the only end date of an item.

**How it works**:
  - **Enabled**: The item is active and appears everywhere (lists, reports, allocations)
  - **End of validity**: The date the item stops. Leave it blank if there is no end
  - After the end of validity:
    - The item no longer appears in selection lists for new contracts or allocations
    - It is excluded from reports for years strictly after the end of validity
    - Historical data remains intact; the item still appears in reports covering years when it was active

**Setting status**:
  - When you create the item, you can set its **End of validity** in the **Properties** panel
  - Later, change the **Status** in the metadata bar, or use the **Lifecycle** field in the **Properties** panel (**Enabled** switch and **End of validity**). Switching an item to Disabled without a date sets its end of validity to today
  - You can schedule a future end of validity (useful for planned end-of-contract items)

**Viewing disabled items**:
  - By default, the OPEX list shows only **Enabled** items
  - Use the **Show: Disabled** or **Show: All** toggle to see disabled items

**When to disable vs delete**:
  - **Prefer disabling**: Keeps history intact, ensures reports remain consistent, and supports audit trails
  - **Delete only if**: The item was created by mistake
  - Deleting an item also removes its budgets, allocations, tasks, relevant websites, attachments (with their files), and its links to contracts. If one of its tasks was turned into a request, the request is kept: it has its own copy of the title, description, and attachments, and only its link to the task goes

**Tip**: Use the End of validity to sunset OPEX items when contracts end or services are discontinued. Do not delete unless it is a true mistake.

---

## Tips and best practices

1. **Start simple**: Create items with just the essentials (product name, paying company, account), then add budgets and allocations as you plan.

2. **Use the default allocation method**: For most items, Headcount (default) is enough. Reserve manual allocations for spend that benefits specific companies or departments only.

3. **Link contracts**: If you manage spend via contracts, link them in the Relations tab. It makes renewals easier to track.

4. **Link applications**: Associate OPEX items with the applications or services they fund. This provides a clear cost-to-application mapping.

5. **Upload documentation**: Use the Attachments feature to store vendor contracts, quotes, invoices, and SOWs.

6. **Add vendor portal links**: Use Relevant websites to link to vendor admin consoles, support portals, and documentation for quick access.

7. **Track contacts**: Add supplier contacts with roles (Commercial, Technical, Support) so your team knows who to call for each spend item.

8. **Leverage analytics dimensions**: Give items a value on each dimension (for example Licenses on Nature, Workplace on Program) to group spend in reports.

9. **Keep company metrics up to date**: Allocations depend on company headcount, IT users, and turnover. Outdated metrics cause allocation errors.

10. **Use CSV for bulk setup**: If you are migrating from another system or have hundreds of items, start with CSV import. Export a template, fill it in, and preflight before loading.

11. **Disable, do not delete**: Preserve history by disabling items when they are no longer active. Delete only if it is a mistake.

12. **Review the totals row**: Before finalizing budgets, check the pinned totals row in the list to ensure your spend adds up as expected.

13. **Use deep linking**: Click directly on a budget column in the list to jump to the Budget tab for that year. Click the Task column to jump to the item's tasks on the Overview tab. This saves navigation time.

14. **Freeze budgets after year-end close**: Use Budget Administration to freeze prior-year budgets once actuals are finalized, preventing accidental edits.

---

## Permissions

OPEX access is controlled by three levels:

- `opex:reader` -- View the OPEX list, open items, see budgets and allocations (read-only), download attachments
- `opex:manager` -- Create and edit OPEX items, update budgets and allocations, upload and delete attachments, manage relations and links
- `opex:admin` -- All manager rights plus CSV import/export, budget operations (freeze, copy, reset), and bulk delete

Additionally:
- Tasks have separate permissions (`tasks:member` to create/edit tasks on OPEX items)
- Users with `tasks:reader` can view tasks but not create or edit them

If you cannot perform an action (e.g., **Import CSV** button is missing, cannot upload attachments), check with your workspace admin to review your role permissions.

---

## Need help?

- **CSV issues**: Download a fresh template, ensure UTF-8 encoding, and run preflight to see detailed errors
- **Allocation errors**: Check that all companies have the required metrics (headcount, IT users, turnover) for the selected year
- **Obsolete account warning**: The account does not belong to the paying company's chart of accounts; pick a different account
- **Missing buttons or tabs**: Your role may not have the required permission level (manager or admin). Contact your workspace admin
