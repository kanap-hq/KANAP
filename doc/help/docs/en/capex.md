# CAPEX

CAPEX (Capital Expenditure) items are your investments in long-term assets: hardware purchases, software licenses with multi-year value, infrastructure projects, and equipment. This is where you plan capital budgets, track project spending, and allocate costs across your organization.

The CAPEX workspace helps you manage each capital item from initial budgeting through execution and reporting -- all in one place with year-by-year budget columns, flexible allocation methods, and direct links to projects, applications, contracts, and contacts.

## Getting started

Navigate to **Budget management > CAPEX** to see your list. Click **New** to create your first item.

The workspace opens in creation mode, with the **Properties** panel open on the right. Type the investment's name in the title at the top, fill in the properties, then click **Create**.

**Required fields**:

- **Title**: What you are investing in (e.g., "New Server Infrastructure", "ERP Software License"). This is the item's description, shown in the **Description** column of the list
- **Paying company**: Which company is making the investment (required for accounting)
- **Account**: The general ledger account for this capital expenditure. Only accounts from the paying company's chart of accounts appear
- **Currency**: ISO code (e.g., USD, EUR). Defaults to your workspace CAPEX currency; you can override per item
- **PP&E type**: Property, Plant & Equipment classification -- Hardware or Software
- **Investment type**: Purpose of the investment (see options below)
- **Priority**: Business priority level (see options below)
- **Effective start**: When this investment begins (DD/MM/YYYY)

**Optional but useful**:

- **Supplier**: The vendor or supplier for this investment. Select from your suppliers in master data
- **Cost center**: Who owns the investment. See [Cost centers](cost-centers.md). When the paying company is still empty, picking a cost center fills it with the cost center's company
- **Run or build**: **Run** for spend that keeps existing services running, **Build** for spend that creates or changes them
- **Analytics dimensions**: One field per dimension, named after it, for custom grouping in reports. The default dimension shows as **Analytics dimension** until it is renamed. See [Analytics dimensions](analytics.md)
- **End of validity**: The date this investment stops, for example when the asset's useful life ends or the project completes. Leave it blank if there is no end. After it, the item is disabled and later years no longer count in the budget views
- **IT owner** / **Business owner**: Who is responsible
- **Description** (Overview tab): Free-form details about the investment

Once set, **Paying company** and **Account** can be changed but not emptied. **Supplier** can be cleared at any time. When you change the paying company of an item that has an account, and the new company uses another chart of accounts, the account is cleared in the same save: pick the new account on the new company's chart. The CAPEX file carries the account too, as `account_number` in the paying company's chart of accounts.

Once the item is created, the workspace unlocks all four tabs: **Overview**, **Budget**, **Allocations**, and **Relations**.

**Tip**: You can create items quickly and fill in budgets and allocations later. Start with the essentials and iterate.

---

## Investment types

CAPEX items must be classified by investment type. This helps analyze capital spending patterns:

- **Replacement**: Replacing existing assets that are obsolete or end-of-life
- **Capacity**: Adding capacity to support business growth or increased demand
- **Productivity**: Improving efficiency or reducing operational costs
- **Security**: Enhancing security posture, compliance, or risk mitigation
- **Conformity**: Meeting regulatory or compliance requirements
- **Business growth**: Enabling new products, markets, or business capabilities
- **Other**: Investments that do not fit the above categories

**Priority levels**:

- **Mandatory**: Must be done (regulatory, critical infrastructure, security)
- **High**: Strong business case, high ROI or strategic importance
- **Medium**: Valuable but can be deferred if needed
- **Low**: Nice to have, can be postponed

---

## Working with the CAPEX list

The CAPEX list (at **Budget management > CAPEX**) is your main view for browsing, filtering, and navigating capital items.

### Default columns

| Column | What it shows |
|---|---|
| **Ref** | Item reference, for example CPX-12 |
| **Description** | Name of the investment |
| **Supplier** | The supplier name |
| **Paying company** | Which company pays for this item |
| **Contract** | The latest linked contract name |
| **Account** | The GL account number and name |
| **PP&E type** | Hardware or Software |
| **Investment type** | Purpose of the investment |
| **Priority** | Business priority level |
| **Allocation** | Current-year allocation method label |
| **Budget Y** and **Expected landing Y** | The current-year amounts of the default column and of the last shown column, in the reporting currency. With the standard settings these are Budget and Expected landing. When the default column is also the last shown one, a single amount column appears. See [Budget columns](budget-operations.md#budget-columns) |
| **Task** | Title of the most recent task linked to this item |

### Additional columns

These columns are hidden by default. Show them from the column chooser (hamburger menu in the grid header):

| Column | What it shows |
|---|---|
| **Amount columns** | Every shown budget column for Y-1, Y, Y+1 and Y+2, under the names your organisation chose. The header gives the column, the year relative to today and the calendar year, for example **Revision Y+1 (2027)**. Amounts are in the reporting currency. Hidden columns are not offered |
| **FTE columns** | The FTE of every shown budget column for Y-1, Y, Y+1 and Y+2, under the names your organization chose, right after the amount columns in the column chooser. The header gives the column and the calendar year, for example **Budget FTE (2026)**. An item's FTE is the sum of the FTE of its lines in that column. See [FTE](#fte). The cell is empty when the column has no lines |
| **Currency** | Item-level currency code |
| **Effective start** | Start date |
| **End of validity** | Date the item stops (blank means no end) |
| **IT owner** / **Business owner** | Responsible users |
| **Analytics dimensions** | One column per enabled dimension, named after it, with the item's value. The default dimension's column comes first (**Analytics dimension** until it is renamed), then the other dimensions in their order |
| **Cost center** | The code and name of the cost center. Hover it to see its full path in the tree; click it to open the cost center |
| **Budget holder** | The budget holder of the item's cost center. It is derived from the cost center, not stored on the item: change the budget holder of a cost center and every item on it follows |
| **Run or build** | **Run** or **Build** |
| **Project** | Names of the projects linked on the Relations tab |
| **Notes** | Free-form notes |
| **Enabled** | Status (enabled or disabled) |
| **Created** / **Updated** | Timestamps |

### Quick search

The search box at the top searches the reference, description, supplier, paying company, account, contract, project names, allocation, owners, analytics values, cost center (code, name and path), budget holder, PP&E type, investment type, priority, notes, currency and status. Results update in real time as you type, ignoring accents and case.

### Column filters

Each filterable column header has a filter icon. **Supplier**, **Paying company**, **Account**, **PP&E type**, **Investment type**, **Priority**, **Allocation**, **Currency**, **IT owner**, **Business owner**, each analytics dimension, **Cost center**, **Budget holder**, **Run or build** and **Enabled** use checkbox set filters with **All**, **None**, and a clear button. The **Enabled** filter offers **Enabled** and **Disabled** and narrows the list when **Show** is set to **All**. Clicking **Clear** in it, or unticking both values, lists nothing, whatever **Show** says. Multiple filters combine with AND logic.

Tick **All**, then untick the values you want to leave out: the filter keeps everything except those (the header reads, for example, **All but 3**), and a value created later is included automatically.

Every amount column has a number filter. A number typed in the box under the header keeps the items with at least that amount. Open the filter menu for the other conditions: greater than, less than, equal, not equal, or between two amounts.

Every FTE column has a number filter with the same conditions, plus blank and not blank. **Blank** keeps the items whose column has no lines.

**Effective start**, **End of validity**, **Created** and **Updated** have date filters. Pick a date in the box under the header to keep the items on that date, or open the filter menu for before, after, between, blank or not blank.

Text columns use text filters, ignoring accents and case. On **Ref**, type the number or the full reference, for example `12` or `CPX-12`.

### Sorting

Click a column header to sort ascending or descending. Every column sorts, including every amount and FTE column. Items without an FTE come last in ascending order. Text columns sort in natural reading order: an accented name sorts next to its unaccented spelling (for example "Électricité" next to "Electricite"), and lowercase comes before uppercase when letters are otherwise equal. The default sort is the default column of the current year, highest first (**Budget Y** with the standard settings). **Prev** and **Next** in the workspace follow the same order. The list remembers your last sort when you return.

### Totals row

The pinned row at the bottom shows the total of every amount column. Totals respect your current filters and search. All amounts are converted to your reporting currency, shown in the page title.

Each shown FTE column shows the sum of the items' FTE. When some items have no FTE, the count follows the total, for example "3.50 · 12 unknown". Hover it for the full sentence: "Unknown for 12 lines". When no item has an FTE, the total is blank and only the count shows.

### Deep linking

Click any cell in a row to open the workspace on the tab most relevant to that column:

- **Description**, **Supplier**, **Paying company**, **PP&E type**, **Investment type**, **Priority** and the other general columns: Opens **Overview**
- **Amount columns** (Budget Y, Expected landing Y, Revision Y+1, etc.) and **FTE columns**: Opens the **Budget** tab for the column's year
- **Allocation**: Opens the **Allocations** tab for the current year
- **Task**: Opens the **Overview** tab, where the Tasks panel sits
- **Contract**: Opens the linked contract directly
- **Cost center**: Opens the cost center workspace

### Status filter

Use the **Show: All / Enabled / Disabled** toggle above the grid to control lifecycle scope (defaults to **Enabled**). Pick **Disabled** to review archived investments or **All** to include both states. Totals update immediately.

### Search context preservation

Your list context -- sort order, search text, and active filters -- is preserved when you open an item and restored when you return to the list. This means you can drill into several items in sequence without losing your place.

The same filters are also kept in the page's web address, so reloading the page or sharing the link reopens the same view. A link whose filters are no longer available shows "The filters of this link are no longer available."

### Prev/Next navigation

When you open an item, the workspace shows **Prev** and **Next** buttons. These navigate through the list in the current sort order, respecting filters and search, and save your pending edits first. The counter (e.g., "Item 3 of 47") shows your position in the filtered list.

**Tip**: Use column filters and quick search to build focused views (e.g., "All hardware investments with high priority"), then navigate item-by-item with **Prev**/**Next** to review budgets.

---

## The CAPEX workspace

Click any row in the list to open the workspace. It has four parts:

- **Header**: the item reference (e.g., `CPX-7`) with a copy button, the investment's name (click it to rename the item), **Prev** / **Next**, **Send link**, and the close button
- **Metadata bar** under the title: **Status**, **Priority**, **IT owner**, and **Business owner**, each editable in place. When the item's cost center has a budget holder, **Budget holder** follows them. It is read only and derived from the cost center, not stored on the item: hover it to see which cost center it comes from, and change it on the cost center (see [Cost centers](cost-centers.md#budget-holder-on-budget-lines))
- **Four tabs**: **Overview**, **Budget**, **Allocations**, and **Relations** (the Relations tab shows how many links the item has)
- **Properties panel** on the right: the item's main fields. Open or close it with the properties button; the workspace remembers your choice

**Autosave**:

- Every change saves automatically. A **Saving...** / **Saved** hint shows in the header
- Switching tabs, moving to the previous or next item, or closing the workspace saves pending edits first. If a save fails, you stay where you are and an error explains why, so no edit is lost silently
- **Ctrl+S** (**Cmd+S** on Mac) saves immediately
- If a save cannot go through right away because another save is in progress on the same data, KANAP retries it for you
- If a bulk budget operation is running (for example a column copy or reset in Budget Administration), edits here are paused with the message "Another budget operation is running. Try again when it has finished." Try again once it is done

**Editing at the same time**:

- Two people can work on the same item at once without stepping on each other. Editing different fields, different budget months, or different budget columns never conflicts, even on the same item at the same moment
- When someone else changes the same field, the same budget column, or the allocation while you are editing it, a banner shows their value and yours, with who changed it and when. Choose **Keep their value** to take theirs, or **Apply yours** to keep what you typed. For a budget column, the choices are **Reload the column** or **Overwrite**; for the allocation, **Reload the allocation** or **Overwrite**
- Only the field, column or allocation that was changed waits for your choice; everything else keeps saving as usual
- A choice waiting for you is kept when you switch tabs. It is lost, after a warning, if you leave the item or change the year
- If the earlier change was your own, from another window or tab, the banner says so instead of naming someone else

### Overview

The Overview tab holds the details of the investment and its tasks.

**What you can edit**:

- **Description**: Free-form details about the investment (the `name` column in the CAPEX file). The investment's name itself is the title at the top

**Tasks panel**:

- Lists every task linked to this CAPEX item, with **Title**, **Status**, **Priority**, **Due date**, and **Actions** columns. The panel title shows the number of tasks
- **Status** filter: All (default), Active (not done), or a specific status. The clear button resets it
- Click **Add task** to open a new task already linked to this item. Fill in the title, description, priority, assignee, and due date in the task workspace
- Use the open icon to go to a task, and the delete icon to delete it (you confirm first)
- Tasks have their own permissions (`tasks:member` to create and edit). CAPEX manager access does not grant task editing rights on its own; check with your admin if you cannot create tasks
- Tasks can also be viewed and managed from **Portfolio > Tasks**, which shows all tasks across your organization
- The latest task title is also shown in the list view's **Task** column (hidden by default)

**Properties panel**:

- **Supplier**, **Cost center**, **Paying company**, **Account** (filtered by the paying company's chart of accounts), **Currency** (only the currencies allowed in your workspace), **PP&E type**, **Investment type**, one field per analytics dimension, **Run or build**, and **Effective start**
- **Lifecycle**: the status switch, labelled with the current state (**Enabled** or **Disabled**), and the **End of validity** date. See [Status and lifecycle](#status-and-lifecycle)
- **Created** and **Updated** dates (read only)
- **Priority** is set in the Properties panel when you create the item, then in the metadata bar
- Type in **Supplier**, **Paying company**, **Account**, **IT owner**, **Business owner** or an analytics dimension field to search by name. Matches appear as you type, so you can find any value even in a very long list; a line under the list reads "Type to narrow down: more results" when there are more matches than shown

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

**Tip**: When you create an item, an "obsolete account" warning means the selected account does not belong to the paying company's chart of accounts. Choose a different account to resolve the warning. An existing item whose account is outside its company's chart can still be edited: the chart is checked only when the company or the account changes.

---

### Budget

The Budget tab is where you enter financial data per year. It supports multiple budget columns and two input modes, shown as tabs: **Flat** (annual total) and **Monthly** (12-month breakdown).

**Year selection**:

- Use the year tabs at the top to switch between Y-2, Y-1, Y (current year), Y+1, and Y+2
- Each year has its own version, allocation method, and amounts
- Switching years saves your pending edits first

**Budget columns** (all years):

The tab shows the columns your organisation shows, under their names, always in the same order. The standard columns are:

- **Budget**: Initial planned capital budget
- **Revision**: Mid-year budget update (e.g., after scope changes or reforecasts)
- **Forecast**: An additional planning column, hidden by default
- **Actuals**: Actual capital spending, as it is recorded during the year
- **Expected landing**: Your best estimate of the year-end capital expenditure

A budget administrator can rename the columns, hide some and choose the default column in **Budget management > Administration > Budget columns** (see [Budget columns](budget-operations.md#budget-columns)). A hidden column keeps its amounts.

**Period of a column**:

- Every column has a period inside the year, for example April to December
- A month counts when the period covers its 15th. A period that starts on April 10 includes April; one that starts on April 20 begins in May
- A column with no amount and no period yet gets a suggestion: the item's **Effective start** and **End of validity**, limited to the year. An investment that starts on April 1 suggests April to December
- A column that already holds amounts and has no period reads as the whole year, so existing data behaves as before

**Flat vs Monthly**:

- **Flat**: Enter one total per column. The total is spread evenly over the months of the column's period, and the months outside it are set to zero. The period shows under each total before you type, for example "9 months, April to December". Only the total you edit is saved. The other columns keep their monthly amounts.
- Click the pencil icon next to the period under a total (**Change period**) to open the spread panel on that column, with its current total. If the item's dates leave no month in the year, the total is disabled and reads "No month of 2026 is within the item's dates." Click the pencil icon next to it (**Choose the period**) to set one yourself.
- Click the calculator icon next to the pencil (**Quantity and price**) to open the same box on the lines of that column. See [Quantity and price](#quantity-and-price).
- A column that follows its lines (its amounts were computed from its Quantity and price lines) has a read-only total. Click the total, or press Enter on it, to open **Quantity and price** on that column. The pencil does the same. Hover the total to read "Calculated from its lines. Open Quantity and price to change it."
- **Monthly**: Enter amounts per month (Jan through Dec) for each shown column, for granular project spend tracking. Quarter subtotals and a yearly total are shown. Only the months you change are saved.
- Both tabs show the same columns: Forecast appears in **Flat** too when it is shown.
- Switch between modes with the **Flat** and **Monthly** tabs
- Switching modes does not change your amounts: it only changes the view. Flat shows the yearly total of the stored months, and Monthly shows the stored months.
- Your choice between **Flat** and **Monthly** is kept in your browser, for you only: switching does not change what other users see when they open this item. Until you choose, a column opens in the mode its amounts were last entered in.

**Freeze behavior**:

- If a year's budget is frozen (via Budget Administration), inputs are read-only and show a lock icon
- Each column can be frozen independently
- You can still view frozen data; admins can unfreeze via **Budget management > Administration > Freeze / unfreeze data**

**Spreading an amount**:

- The panel box has two tabs: **Spread an amount** and **Quantity and price**. This part covers the first one
- The spread panel is always visible in the **Monthly** tab. In the **Flat** tab it opens from the pencil icon under a total, and its close button closes it
- Choose a **Column** among the shown columns, check the **Amount**, pick a **Distribution** (**Flat** or **4-4-5**), and set the **From** and **To** dates. The dates start from the column's current period, and the distribution from the column's own
- The panel opens on the default column. The amount starts with the column's current total, in both tabs, and follows when you choose another column. It is empty when the column has no amount
- **Every change saves at once**: the amount when you leave the field or press Enter, the distribution and the dates as soon as you change them. There is no button to click. A blank or zero amount saves nothing
- **Apply the distribution to all columns** is a switch, on by default: every column that follows it gets the same distribution and period, and each keeps its own current total. Turning it on spreads those columns at once, and it stays on for your next changes. Turning it off changes nothing by itself: the next changes apply to the selected column only. By default every column follows. A budget administrator chooses which ones in [Budget columns](budget-operations.md#budget-columns). Frozen columns never change. Hover the switch to see which columns follow and which keep their own period
- A column that does not follow the switch spreads alone: the switch does not appear when you spread it. The switch is also hidden when no other following column can change
- Columns that follow their lines are left out of the switch: they keep the amounts of their lines, and a sentence names them, for example "Forecast keeps its lines." When every other column follows its lines, the switch does not appear
- To bring a column back to a flat spread over twelve months, choose **Flat** and set the dates to January 1 and December 31
- Totals typed in the **Flat** tab still apply to their own column only
- The **From** and **To** dates show the period. When some months fall outside it, the panel says which ones will be set to zero ("January to March will be set to zero."). A whole-year period shows no line. Hover the info icon next to the panel title to see the 15th rule
- With **4-4-5**, the weights of the months that count are scaled up so the whole amount lands on them
- A soft warning appears when the period goes beyond the item's dates. The spread is still saved
- While a date is missing or no month counts, the panel says why and saves nothing
- A column that follows its lines shows its current values in the fields, greyed, under the sentence "The amounts come from the 4 lines of Quantity and price." Click **Spread an amount instead** to unlock the fields for that column. The sentence then reads "A spread replaces the amounts of the lines. The lines stay as a reference." The lock comes back when you change the column, the year or the box
- A spread over a column built from lines keeps its lines as a reference. See [Quantity and price](#quantity-and-price)

**How each column was produced**:

- A short label tells you where the amounts of a column come from. In the **Monthly** tab it sits under the column header (hover it to see the period). In the **Flat** tab it sits next to the period
- **Spread flat**, **Spread 4-4-5** or **Spread by quarter**: the amounts come from a spread
- **Copied from Budget 2025 +2%**: the amounts come from **Copy budget columns** in Budget Administration, with the percentage shown when there is one
- **Quantity and price · 3 lines · 1.00 FTE**: the amounts come from lines, with their number and, when the lines count people or days, the column's FTE. The FTE is the full-year average. Hover the label to see the lines, for example "Project manager: 1 person × 1,200 per day, 5 days per month, Feb to Jul"
- **Edited by hand**: a month was changed in the grid or by a budget file import
- A column with no label kept the data it had before periods existed

**When someone else is editing the same column**:

- Two people can fill in different months or different columns of the same item at once with no conflict
- On a monthly entry, if someone else changed one of the same months, those months wait for your choice; the column's other months save as you typed them
- If someone else changed the column's total, its spread, or its quantity-and-price lines while you were working on them, the whole column waits: a banner offers **Reload the column** or **Overwrite**. The column's amounts, spread panel and lines stay read-only until you choose
- Saving reloads the year, so you always see the latest figures for every other column; the cell or column you are editing is not disturbed

**Monthly tools** (Monthly mode only):

- **Clear column**: the icon next to a column header sets every month of that column to zero. When the column holds amounts, you confirm first
- Useful for entering a cash-out plan by hand, for example the whole amount in a single month
- Clearing this way counts as an edit by hand. To remove both the amounts and the period of a column for every investment, use **Reset budget column** in Budget Administration

**Multi-year trend**:

- A chart below the table shows every shown column across years, Forecast included when it is shown, and updates as you type

**How to use it**:

1. Select the year you are planning for
2. Choose the **Flat** or **Monthly** tab
3. Fill in the relevant columns (Budget for initial planning, Actuals for tracking, Expected landing for the year-end figure)
4. Your changes save automatically; a **Saving...** / **Saved** hint shows next to the year tabs

**Tip**: For most items, Flat mode is faster. Use Monthly mode when you need to track project spend timing or phased rollouts.

#### Quantity and price

Build a column from lines instead of typing its amounts. Each line reads as a sentence: a quantity, a unit, a unit price, how often, when, and on which calendar. For example, one contractor on a build project full time at 400 a day from February to October, and 20 laptops at 1,200 per piece, bought once on March 15. The months of the column are the sum of its lines. The amounts of a column have one source at a time: its lines, or a spread, a month typed by hand, or a copy. The other source stays visible as a reference and is read only, with a link to switch.

**Opening the tab**:

- **Flat** tab: click the calculator icon next to the period under a total. The box opens on **Quantity and price** for that column. On a column that follows its lines, the pencil and the total open it too
- **Monthly** tab: click **Quantity and price** at the top of the panel box. Choosing a column that follows its lines, or having one as the default column, switches the box to **Quantity and price**
- Choose the **Column** at the top of the tab. Frozen columns cannot be picked

**The lines**:

| Column | What to enter |
|---|---|
| **Description** | What the line pays for, for example "Project manager". Optional, up to 200 characters |
| **Quantity** | How many, in the unit of the line. Zero or more, up to 3 decimals |
| **Unit** | **people**, **days** or **pieces**. The unit decides what the price is for, how often it counts, how the amount lands on the months, and the FTE |
| **Unit price** | The price of one unit, in the item's currency. Up to 4 decimals. A negative price is accepted, for a credit. What the price is for shows right after it: **per day** for days, **per piece** for pieces, and for people a small list to choose **per day** or **per month** |
| **How often** | It follows the unit. People priced per day: a **Full time** checkbox and, when it is not ticked, the **days per month** they work on the item (more than 0, up to 31, with up to 3 decimals). People priced per month: "per month". Days: "over the period". Pieces: a list to choose **per month** or **once** |
| **From** / **To** | The period of the line, inside the year. A month counts when the period covers its 15th, as for a spread. Pieces bought once take a single **Date** instead and land in its month. When every line takes a date, the header reads **Date** |
| **Calendar** | Shown for a price per day only: people priced per day, and days. The working-day calendar whose days count. The list offers the enabled calendars, plus the calendar a line already uses if it was disabled since, marked "(disabled)". When there is no calendar yet, the tab reads "No working-day calendar yet.", with an **Add a calendar** link for those who can create calendars. See [Working-day calendars](working-day-calendars.md) |
| **Amount** | The total of the line, once it is saved. Read only |

Each line has a number in the margin. When the column has several lines, the notes under the table use it, for example "Line 2: Enter a quantity and a unit price to save this line."

When the tab is wide enough, each line fits on one row. On a narrower panel, each line takes two rows. The first reads as a calculation: **Description**, **Quantity**, **Unit**, × **Unit price** and **Amount**. The second reads as a sentence: **How often**, "from" a date "to" a date (or one **Date**), "calendar" and the **Calendar**. On a medium-width panel, **How often** moves up to the first row. Closing the **Properties** panel gives the lines more room.

Click **Add a line** under the table to add a line, and the cross at the end of a line to remove it. A column holds up to 50 lines.

**Units and prices**:

| Unit | Price | How often | Amount of each month of the period | FTE of each month |
|---|---|---|---|---|
| **people** | **per day** | **Full time** | The month's working days in the calendar × quantity × unit price | The quantity |
| **people** | **per day** | **5 days per month** | 5 × quantity × unit price | Quantity × 5 ÷ the month's working days in the calendar |
| **people** | **per month** | per month | Quantity × unit price | The quantity |
| **days** | **per day** | over the period | Quantity × unit price, counted once and split evenly over the months of the period | The month's share of the days ÷ the month's working days in the calendar |
| **pieces** | **per piece** | **per month** | Quantity × unit price | None |
| **pieces** | **per piece** | **once** | Quantity × unit price, in the month of the date | None |

- Use **people** for staff who work on the item month after month. Priced per day, say how much they work: tick **Full time** to count every working day of the calendar from the start to the end of the line, or enter the days per month. For example, a project manager 5 days per month at 1,200 a day from February to July costs 6,000 a month. On a calendar with 21 working days in March, that month counts 5 ÷ 21, about 0.24 FTE. A consultant full time at 400 a day costs the month's working days × 400 each month, and counts 1 FTE
- Priced per month, people cost the quantity × the unit price each month, for example 1 person at 8,000 per month
- Use **days** for a number of days bought for the period, as one bundle. For example, 30 days at 1,200 a day from February to July give 36,000, that is 6,000 a month. Each month holds 5 days: in a month with 20 working days, the line counts 0.25 FTE
- Use **pieces** for licences, devices or subscriptions. Per month, they count in every month of the period: 50 licences at 12 per piece give 600 a month. Once, they take one date and land in its month: a laptop at 2,000 on March 15 lands in March. Pieces never count as FTE
- Each month is rounded to the cent. When an amount is split over the period, the rounding difference lands on the last month. The months outside a line's period get nothing from it
- Changing the unit adapts the rest of the line. People keep a price per month when you chose it, and are priced per day otherwise. Days are priced per day, over the period. Pieces are priced per piece and bought once, dated the start of the column's period. Switching pieces from once to per month gives them the column's period again

**A new line** starts with the unit **people**, a quantity of 1, a price per day, **Full time** unticked with the days per month to enter, the period of the column (the whole year when the column has none) and the default calendar. The default calendar is the standard calendar of the paying company's country, else the first enabled calendar. Enter the unit price and the days per month, or tick **Full time**, and the line saves. Without an enabled calendar, a new line starts with a price per month.

**Saving**: every field saves as you leave it, press Enter, or pick a value or a date. There is no button to click. Each save sends every complete line of the column, and the months of the column follow at once. The **Saving...** hint next to the year tabs shows while it works.

- A line is complete when it has a quantity, a unit price, a valid period or date, the days per month or **Full time** for people priced per day, and a calendar for a price per day. Until then it stays on screen with a hint, for example "Enter a quantity and a unit price to save this line.", "Enter the days per month, or tick Full time." or "Choose a calendar for a price per day.", and the saved lines do not change
- Removing the last line removes the lines of the column, and its amounts stay as they are. A column computed from its lines then counts as amounts entered by hand. A spread or copied column keeps its spread or copy
- When a save is refused, the reason shows under the table in red, and what you typed stays in place. For example, "Head office staff has no working days for 2027. Add them on the Working-day calendars page." when a custom calendar does not hold the year yet
- On a frozen column, the lines are read only. They are also read only while the column keeps them as a reference, see the next part

**Under the table**:

- The FTE of the lines, when a line counts people or days, for example "FTE over the period 0.24 · Full-year average 0.12". See [FTE](#fte). The total of the column shows in the column itself
- Where the amounts come from, when they no longer come from the lines: one of the sentences in the next part
- Notes when they apply: "The period goes beyond the item's dates.", a calendar disabled since, for example "Head office staff is disabled. The lines still use it.", and working days changed since the last save of the lines
- **Apply these lines to all columns**: a switch for the same columns as the spread tab's switch, off by default here. Turning it on writes the lines to every column that follows at once, and it stays on: each later save writes the lines to those columns too. Turning it off changes nothing by itself

**When the amounts change another way**: the lines stay with the column as a reference, and the tab says where the amounts come from now, followed by a **Use the lines again** link. The lines are then read only: you cannot add, remove or edit a line, and the tab shows no amount per line, no FTE and no **Apply these lines to all columns**. The link saves the lines as they are and computes the column from them again, and the lines become editable again. To change a line kept as a reference, click **Use the lines again** first, then edit it.

- A month typed in the **Monthly** tab: "Amounts were entered by hand. Use the lines again."
- A spread: "Amounts come from a spread. Use the lines again."
- **Copy budget columns** in Budget Administration: "Amounts were copied from Budget 2025. Use the lines again." The copy brings the source column's lines with the amounts. See [Copying a computed column](budget-operations.md#copying-a-computed-column)
- A calendar's working days changed: "Working days changed since the last computation: March: 20 days, now 19." Nothing changes on the column until you click **Use the lines again**. The lines stay editable meanwhile
- **Reset budget column** in Budget Administration removes the lines with the amounts. See [Reset budget column](budget-operations.md#reset-budget-column)
- A budget file changes the months of a column and leaves its lines. See [Load a budget from a spreadsheet](budget-file.md)

#### FTE

FTE (full-time equivalent) says how many people a column pays for. It comes from the lines: each month adds up the FTE of its lines (see the table above). Two figures follow, each rounded to 2 decimals:

- **Full-year average**: the sum of the twelve months divided by 12. It is the column's FTE, shown in the label of the column and in the FTE columns of the CAPEX list
- **FTE over the period**: the sum of the months with people or days, divided by the number of those months. Pieces do not count, so licences or a laptop never lower it. It shows under the lines while the amounts come from them. After an edit by hand, a spread or a copy, it is not shown until you use the lines again

For example, a consultant full time from February to October counts 1 FTE in each of those 9 months: 1.00 over the period, and 9 × 1 ÷ 12 = 0.75 for the full year. A project manager 5 days per month from February to July counts about 0.24 over the period, and 0.12 for the full year. Licences over the whole year or a laptop in December on the same column leave both figures as they are.

- **Counted**: a column with lines in people or days
- **Zero**: a column whose lines are all in pieces. Its FTE is 0
- **Blank**: a column without lines, an item without a version for that year, or a year after the item's end of validity. Its FTE cell stays empty, because KANAP cannot tell how many people it pays for
- The FTE stays with the lines. After an edit by hand, a spread or a copy, the column keeps the FTE of its lines. A copy brings the FTE of the source column

---

### Allocations

The Allocations tab distributes the capital expenditure across your companies and departments. This drives chargeback reports and helps allocate asset costs.

**Year selection**:

- Works the same as Budget: use year tabs to switch between Y-2, Y-1, Y, Y+1, Y+2
- Each year can have a different allocation method
- The year total of the default column shows on the right, for example **Budget, year total**

**Allocation methods**:

1. **Headcount (default)**: Splits capital spend proportionally by each company's headcount for the selected year. Percentages update automatically when you edit company metrics. This is the standard default.

2. **IT users**: Splits spend proportionally by each company's IT user count for the selected year. Useful for IT infrastructure investments that scale with IT staff.

3. **Turnover**: Splits spend proportionally by each company's turnover (revenue) for the selected year. Useful for business-wide platforms or infrastructure.

4. **Manual by company**: You select which companies receive this capital investment. Choose a driver in **Allocate by** (Headcount, IT users, or Turnover) to calculate percentages among the selected companies. Only the selected companies are included in the split.

5. **Manual by department**: You select specific company/department pairs. Percentages are calculated from each department's headcount. Useful when a capital investment benefits only certain departments (e.g., manufacturing equipment).

6. **Manual percentages**: You pick the companies and type each percentage yourself. The percentages must add up to 100%.

**Default vs pinned methods**:

- The **default** entry -- shown as *Headcount (default)* until your organisation configures another method -- follows the setting in **Budget management > Administration > Default allocation method**. Every investment left on the default is re-driven when an admin changes that setting.
- That setting can also restrict the default to a **selection of companies** (for example the entity that carries the IT budget): the driver then applies to those companies only, and the option reads *Default (n companies)*.
- **Headcount**, **IT users** and **Turnover** pin that method on the investment: a pinned method keeps working even if the organisation default changes later.
- Investments with a manual allocation are never affected by the default setting.

**How percentages work**:

- For **auto methods** (Headcount, IT users, Turnover): percentages are computed from the latest company metrics across your enabled companies. You do not edit them directly.
- For **Manual by company** and **Manual by department**: you pick the companies or departments, and the system calculates percentages from your chosen driver and the current metrics.
- For **Manual percentages**: typing a percentage pins that row, and the remaining rows share what is left. **Split equally** gives every row the same share; **Clear manual pins** releases the pinned rows.
- Percentages reflect live data. If you update a company's headcount, allocations recalculate.

**Viewing allocations**:

- The table shows the company (or company / department), the driver value, the percentage, and the amount, with a total row
- The total percentage should equal 100%; for Manual percentages a warning appears until it does

**How to use it**:

1. Select the year
2. Choose an allocation method in **Method**
3. For a manual method, use **Add row** to add companies (or company/department pairs) and the remove icon to drop any that do not benefit from this investment
4. Changes save automatically

**Common issues**:

- **Missing metrics**: One or more companies have zero or missing headcount/IT users/turnover for the selected year. Fill in the metrics in **Master data > Companies** (Details tab).
- **"Manual percentages must sum to 100%."**: Adjust the rows, or click **Split equally**.

**When someone else is editing the allocation**:

- The method, driver and rows save together. If someone else changed the allocation while you were editing it, a banner offers **Reload the allocation** or **Overwrite**
- Changing the year while a choice is waiting asks for confirmation first

**Tip**: Use Headcount for most items (it is simplest and updates automatically). Reserve Manual by company for investments that benefit only specific entities (e.g., regional data center). Use Manual by department for highly targeted investments.

---

### Relations

The Relations tab links this CAPEX item to related objects: Projects, Applications, Contracts, Contacts, Relevant websites, and Attachments. Everything on this tab saves automatically.

**Projects**:

- Use the autocomplete to link one or more projects
- This helps group capital spend by project in reports and enables project accounting
- The project names appear in the CAPEX list **Project** column, and the quick search finds them
- Remove a project by clicking the X on its chip

**Applications**:

- Use the autocomplete to link one or more applications or services from your IT catalogue
- This helps track which CAPEX items fund which applications or services
- Remove an application by clicking the X on its chip

**Contracts**:

- Use the autocomplete to link one or more contracts
- When linked, the contract name appears in the CAPEX list **Contract** column for quick reference
- Contracts can also link to multiple CAPEX items (many-to-many relationship)
- Remove a contract by clicking the X on its chip

**Contacts**:

- Link contacts to this CAPEX item: pick a contact, then pick its role (**Commercial**, **Technical**, **Support**, or **Other**). Choosing the role adds the contact
- The table shows the role, first name, last name, job title, email, and mobile. Hover the role to see whether the contact comes from the supplier or was added manually
- Remove a contact with the remove icon

**Relevant websites**:

- Click **Add URL** to add a link (e.g., vendor product pages, technical documentation, internal wikis). Each link has a **Name** and a **URL**
- Click a link row to edit it, or use the delete icon to remove it

**Attachments**:

- Upload files related to this capital item (e.g., quotes, vendor proposals, technical specs, approval memos)
- Drag and drop files into the attachment area, or click **Select files** to browse
- Click a file chip to download the file
- Delete an attachment with the delete icon on its chip (you confirm first; requires `capex:manager` permission)

**Why link?**:

- **Projects**: Roll up capital spend by project for project accounting and reporting
- **Applications**: See which applications or services an investment funds
- **Contracts**: Track which capital items are covered by purchase agreements or service contracts
- **Contacts**: Keep vendor and stakeholder contact details associated with the investment
- **Relevant websites and attachments**: Centralize all investment-related documentation and references for easy access

**Tip**: Upload vendor quotes, approval memos, and technical specs as attachments. Link contracts for procurement tracking. Use contacts to keep vendor representatives associated with each capital item.

---

## CSV import/export

**Export CSV** and **Import CSV** sit in the toolbar of the CAPEX list. Both need administration rights on CAPEX (`capex:admin`).

**Export CSV** writes the CAPEX budget file for the lines the list shows. **Import CSV** reads a file back: it is checked first, and nothing is written until you click **Load**.

The file holds one row per line, the line's details, its amounts as columns and `kanap_token`. [Load a budget from a spreadsheet](budget-file.md) describes the columns, what a cell means, and the two import steps.

---

## Status and lifecycle

Every CAPEX item has a **status** (Enabled or Disabled) and an optional **End of validity** that controls when it appears in reports and selection lists. It is the only end date of an item.

**How it works**:

- **Enabled**: The item is active and appears everywhere (lists, reports, allocations)
- **End of validity**: The date the item stops. Leave it blank if there is no end. When the end of validity passes, the status switches to **Disabled** on its own within the hour
- After the end of validity:
  - The item no longer appears in selection lists for new contracts or allocations
  - It is excluded from reports for years strictly after the end of validity
  - Historical data remains intact; the item still appears in reports covering years when it was active

**Setting status**:

- When you create the item, you can set its **End of validity** in the **Properties** panel
- Later, change the **Status** in the metadata bar, or use the **Lifecycle** field in the **Properties** panel (the status switch and **End of validity**). Switching an item to Disabled without a date sets its end of validity to today
- You can schedule a future end of validity (useful for planned asset disposals or end-of-life dates)

**Viewing disabled items**:

- By default, the CAPEX list shows only **Enabled** items
- Use the **Show: All / Enabled / Disabled** toggle to change the scope

**When to disable vs delete**:

- **Prefer disabling**: Keeps history intact, ensures reports remain consistent, and supports audit trails
- **Delete only if**: The item was created by mistake
- An item with amounts in a frozen column cannot be deleted. Unfreeze the column first, or set an end of validity date instead. When you delete several items at once, the others are deleted, and the message names each refused item with its reason
- Deleting an item also removes its budgets, allocations, tasks, relevant websites, attachments (with their files), and its links to contracts. If one of its tasks was turned into a request, the request is kept: it has its own copy of the title, description, and attachments, and only its link to the task goes

**Tip**: Use the End of validity to mark assets that have been fully depreciated, disposed of, or projects that have completed. Do not delete unless it is a true mistake.

---

## Permissions

CAPEX access is controlled by three levels:

- `capex:reader` -- View CAPEX list, open items, see budgets and allocations (read-only)
- `capex:manager` -- Create and edit CAPEX items, update budgets and allocations, upload attachments, manage links and contacts
- `capex:admin` -- All manager rights plus CSV import, budget operations (freeze, copy, reset), and bulk delete

Additionally:

- Tasks have separate permissions (`tasks:member` to create/edit tasks on CAPEX items)
- Users with `tasks:reader` can view tasks but not create or edit them

If you cannot perform an action (e.g., the **Import CSV** button is missing), check with your workspace admin to review your role permissions.

---

## Tips

- **Start simple**: Create items with just the essentials (description, PP&E type, investment type, paying company, account), then add budgets and allocations as you plan.
- **Use Headcount allocation**: For most capital investments, Headcount is enough. Reserve manual allocations for investments that benefit specific companies or departments only.
- **Link contracts**: If you manage capital purchases via contracts, link them in the Relations tab for procurement tracking.
- **Upload documentation**: Use the attachments feature to store vendor quotes, approval memos, and technical specs alongside the item.
- **Classify accurately**: Use Investment type and Priority consistently to enable meaningful capital spend analysis and prioritization.
- **Keep company metrics current**: Allocations depend on company headcount, IT users, and turnover. Outdated metrics cause allocation errors.
- **Use CSV for bulk setup**: If you are migrating from another system or have many capital items, start with CSV import. Export a fresh file, fill in your rows, and check it before loading.
- **Disable, do not delete**: Preserve history by disabling items when assets are disposed of or projects complete.
- **Review the totals row**: Before finalizing capital budgets, check the pinned totals row to ensure your capital spend adds up as expected.
- **Use deep linking**: Click directly on a budget or allocation column in the list to jump straight to that tab and year.
- **Track spend timing**: For large projects with phased spending, use Monthly mode to track spend against project milestones.
- **Freeze after year-end**: Use Budget Administration to freeze prior year budgets once actuals are finalized, preventing accidental edits.
