# Budget lines

A budget line is one thing your IT budget pays for, followed year after year. Its **Type** says what kind of spend it is:

- **OPEX** (operating expenditure): recurring costs such as software licences, cloud subscriptions, maintenance contracts and services
- **CAPEX** (capital expenditure): investments in long-term assets such as hardware purchases, infrastructure projects and equipment

Both types live in one list and open in the same workspace, with year-by-year budget columns, allocations, and links to suppliers, contracts, applications and projects. The type changes a few rules (accounts, dimensions, chargeback, freezes). [OPEX and CAPEX](#opex-and-capex) lists them.

## Getting started

Navigate to **Budget management > Budget lines** to see the list. Click **New line** to create a line.

The workspace opens in creation mode, titled **New OPEX line** or **New CAPEX line**, with the **Properties** panel open on the right. Its first row is **Type**: pick **OPEX** or **CAPEX**. It starts on the type the list is filtered on in its **Type** column, else on **OPEX**. Type the line's name in the title at the top, fill in the properties, then click **Create**.

**Required fields**:

- **Title**: What you are spending on or investing in (e.g., "Salesforce licences", "New server infrastructure"). It shows in the **Product name** column of the list
- **Paying company**: Which company pays (required for accounting)
- **Account**: The general ledger account. Only accounts from the paying company's chart of accounts appear, and only those that suit the line's type in [Chart of Accounts](chart-of-accounts.md#opex-or-capex-accounts): **OPEX and CAPEX**, or **OPEX only** for an OPEX line and **CAPEX only** for a CAPEX line. A line that already has an account for the other type keeps it and stays editable. Choosing such an account on a new line or when you change the account is refused
- **Currency**: ISO code (e.g., USD, EUR). Defaults to your workspace currency; you can override it per line
- **Effective start**: When this spend begins (DD/MM/YYYY)
- **Required dimensions**: one field per dimension that is required for the line's type. A new workspace has no required dimension. See [Recommended dimensions](#recommended-dimensions)

**Optional but useful**:

- **Supplier**: Who you are paying. Links to your suppliers in master data
- **Cost center**: Who owns the spend. See [Cost centers](cost-centers.md). Once the paying company is chosen, the list shows that company's cost centers. When the paying company is still empty, picking a cost center fills it with the cost center's company
- **Run or build**: **Run** for spend that keeps existing services running, **Build** for spend that creates or changes them
- **Analytics dimensions**: One field per dimension used for the line's type, named after it, for custom grouping in reports (e.g., **Software** on **Cost pool**). The default dimension shows as **Analytics dimension** until it is renamed. See [Analytics dimensions](analytics.md)
- **End of validity**: The date this line stops. Leave it blank if there is no end. After it, the line is disabled and later years no longer count in the budget views
- **IT owner** / **Business owner**: Who is responsible
- **Description** and **Notes**: Free text on the **Overview** tab, for both types

Once set, **Paying company** and **Account** can be changed but not emptied. **Supplier** can be cleared at any time.

When you change the paying company of a line that has an account, and the new company uses another chart of accounts, the account is cleared in the same save. **Account** then shows as required, with the list on the new company's chart. Pick the new account to finish.

Once the line is created, the workspace unlocks all four tabs: **Overview**, **Budget**, **Allocations**, and **Relations**.

**Tip**: You can create lines quickly and fill in budgets and allocations later. Start with the essentials and iterate.

---

## OPEX and CAPEX

Every line has one type, shown in the **Type** column of the list and in the first row of the **Properties** panel. Most of the workspace works the same for both. The type decides:

- **Accounts**: an account can be set for **OPEX and CAPEX**, **OPEX only** or **CAPEX only**. See [OPEX or CAPEX accounts](chart-of-accounts.md#opex-or-capex-accounts)
- **Dimensions and values**: a dimension or a value can be used for one type only, and a dimension can be required for one type. The **Properties** panel shows only the dimensions used for the line's type. See [OPEX or CAPEX dimensions](analytics.md#opex-or-capex-dimensions)
- **Chargeback**: the chargeback reports open on OPEX lines, and offer CAPEX lines or both. See [Reporting](reports.md)
- **Freezes**: a budget column is frozen per year and per type. See [Freeze / unfreeze data](budget-operations.md#freeze-unfreeze-data)

The type of a line changes with **Change type...**. See [Changing the type](#changing-the-type).

### Recommended dimensions

A new workspace starts with four recommended dimensions, with their values, in the workspace's language:

| Dimension | What it says |
|---|---|
| **Cost pool** | What the money pays for: hardware, software, internal and external labor, outside services, facilities and power, telecom, other. It is the default dimension |
| **IT tower** | The part of IT the spend serves: data center, compute, storage, network, platform, output, end user, application, delivery, security and compliance, IT management |
| **Purpose** | Why the money is spent: replacement, capacity, productivity, security, compliance, business growth, other |
| **Priority** | Mandatory, high, medium or low |

They apply to OPEX and CAPEX lines and none is required. They work like any other dimension: their fields sit in the **Properties** panel, and an administrator can rename them, add values, make one required, disable or delete them. An administrator can add them to an existing workspace. See [Recommended dimensions](analytics.md#recommended-dimensions) in Analytics dimensions.

Workspaces created before the recommended dimensions keep three dimensions for CAPEX lines only, all required: **PP&E type**, **Investment type** and **Priority**. A new CAPEX line there needs a value on each.

---

## References

Each line has one reference, for example `BL-12`, from a single series for OPEX and CAPEX. It shows in the **Ref** column, in the workspace header and in the page address (`/ops/budget/BL-12`).

Lines created before the single series also had an `OPX-12` or `CPX-3` number. These numbers still work:

- A link or bookmark to a former OPEX or CAPEX page opens the line
- The quick search of the list finds a line by its former number
- The budget file reads them in `item_number`. See [Load a budget from a spreadsheet](budget-file.md)
- Plaid finds a line by either number. See [Plaid](ai-assistant.md#mentioning-records-with)

---

## Working with the list

The list (at **Budget management > Budget lines**) holds the OPEX and CAPEX lines together. Its title gives the reporting currency, for example **Budget lines (EUR)**. Every amount of the list is in that currency.

**Default columns**:

- **Ref**: The line reference, for example `BL-12` (links to the **Overview** tab)
- **Type**: **OPEX** or **CAPEX**
- **Product name**: The line's title (links to the **Overview** tab)
- **Supplier**: The supplier name
- **Paying company**: Which company pays for this line
- **Contract**: The latest linked contract name (links to the Contract workspace)
- **Account**: The GL account number and name
- **Allocation**: The allocation method label for the current year (links to the **Allocations** tab)
- **Budget Y** and **Expected landing Y**: The current-year amounts of the default column and of the last shown column (links to the **Budget** tab for this year). With the standard settings these are Budget and Expected landing. When the default column is also the last shown one, a single amount column appears. See [Budget columns](budget-operations.md#budget-columns)
- **Required dimensions**: One column per enabled dimension that is required for either type, named after it. A new workspace has none
- **Task**: The latest task title (links to the **Overview** tab, where the Tasks panel sits)

**Additional columns** (hidden by default, toggle via the column chooser):

- **Amount columns**: Every shown budget column for Y-1, Y, Y+1 and Y+2, under the names your organisation chose. The header gives the column, the year relative to today and the calendar year, for example **Revision Y+1 (2027)**. Hidden columns are not offered
- **FTE columns**: The FTE of every shown budget column for Y-1, Y, Y+1 and Y+2, under the names your organisation chose, right after the amount columns in the column chooser. The header gives the column and the calendar year, for example **Budget FTE (2026)**. A line's FTE is the sum of the FTE of its quantity and price lines in that column. See [FTE](#fte). The cell is empty when the column has no lines
- **FTE declared**: **Yes** when the line declares FTE in at least one budget column of any year, otherwise empty. These are the lines the **Lines with FTE** filter of the reports keeps
- **Enabled**: Line status (enabled or disabled)
- **Description**: The line's description
- **Currency**: ISO currency code
- **Effective start**: Start date
- **End of validity**: Date the line stops (blank means no end)
- **IT owner** / **Business owner**: Responsible users
- **Analytics dimensions**: One column per enabled dimension, named after it, with the line's value, in the order of the dimensions. The default dimension's column reads **Analytics dimension** until it is renamed
- **Cost center**: The code and name of the cost center. Hover it to see its full path in the tree; click it to open the cost center
- **Budget holder**: The budget holder of the line's cost center. It is derived from the cost center, not stored on the line: change the budget holder of a cost center and every line on it follows
- **Run or build**: **Run** or **Build**
- **Project**: Names of the projects linked on the **Relations** tab
- **Notes**: Internal notes
- **Created / Updated**: Timestamps

A column layout you saved keeps its own choice of columns. The layout you had saved on the former OPEX list carries over to this list.

**Filtering by type**:

- The **Type** column has a checkbox filter with **OPEX** and **CAPEX**. Tick one to see only the lines of that type
- **New line** starts on the type the filter keeps. With both types, or no filter, it starts on OPEX
- A former OPEX or CAPEX list address opens this list with the **Type** filter set, and keeps the sort, search and filters it carried

**Filtering**:

- **Quick search**: Searches the reference (`BL-12`, and the former `OPX-12` or `CPX-3`), product name, description, supplier, paying company, account, contract, project names, allocation, owners, analytics values, cost center (code, name and path), budget holder, notes, currency and status. Filters the list in real time as you type, ignoring accents and case
- **Column filters**: Click the filter icon in any column header. **Type**, **Supplier**, **Paying company**, **Account**, **Allocation**, **Currency**, **IT owner**, **Business owner**, each analytics dimension, **Cost center**, **Budget holder**, **Run or build** and **FTE declared** use checkbox set filters (multi-select). The **FTE declared** filter offers **Yes** and **No**. The **Enabled** filter shows the **Show** choice (**All**, **Enabled** or **Disabled**): changing one changes the other
- **All but a few**: Tick **All**, then untick the values you want to leave out: the filter keeps everything except those (the header reads, for example, **All but 3**), and a value created later is included automatically
- **Amount filters**: Every amount column has a number filter. A number typed in the box under the header keeps the lines with at least that amount. Open the filter menu for the other conditions: greater than, less than, equal, not equal, or between two amounts
- **FTE filters**: Every FTE column has a number filter with the same conditions, plus blank and not blank. **Blank** keeps the lines whose column has no quantity and price lines
- **Date filters**: **Effective start**, **End of validity**, **Created** and **Updated** have date filters. The box under the header shows the filter in words, every condition included, for example "Blank or after 31 Dec 2024". Click it to open the filter menu (on, before, after, between, blank or not blank), or click × to remove the filter. **End of validity** takes two conditions joined by AND or OR, for example blank or after a date
- **Text columns** use text filters, ignoring accents and case. On **Ref**, type the number or the full reference, for example `12` or `BL-12`
- **Status scope**: Use the **Show: All / Enabled / Disabled** toggle above the grid (defaults to **Enabled**). **Enabled** lists the lines with no end of validity or one in the current year or later: lines that end during the current year stay in **Enabled** until 31 December. **Disabled** lists the lines that ended before 1 January of the current year
- **Sharing a view**: Your sort, search and filters are kept in the page's web address, so reloading the page or sharing the link reopens the same view. A link whose filters are no longer available shows "The filters of this link are no longer available." When a link filters a hidden column, for example a report row opening the list, the list shows that column right after the product name for this visit. Your saved column layout does not change. The **Show** choice is kept in the address too. A list opened from a report is a view of that report: what you change in it stays in its address, and the list opened from the menu keeps your own sort, search and filters

**Sorting**:

- Click a column header to sort ascending/descending. Every column sorts, including every amount and FTE column. Lines without an FTE come last in ascending order
- Text columns sort in natural reading order: an accented name sorts next to its unaccented spelling (for example "Électricité" next to "Electricite"), and lowercase comes before uppercase when letters are otherwise equal
- A dimension column sorts in the order of the dimension's values, set in [Analytics dimensions](analytics.md#ordering-values), then by name. Lines without a value come last in ascending order
- Default sort is by the default column of the current year, highest first (**Budget Y** with the standard settings). The **Prev** and **Next** buttons of the workspace follow the same order
- The list remembers your last sort, search, and filters when you return

**Totals row**:

- A single **Total** row is pinned under the list. It reads **Total (12 lines)**, with the number of lines the list holds, and shows the total of every amount column
- A lock icon before a total means the column is frozen for that year. It follows the freeze of each type the list holds. When the list is filtered on one type, the lock shows when that type is frozen. When it holds both types, the lock shows when the column is frozen for both. Hover it to read **Frozen**. See [Freeze / unfreeze data](budget-operations.md#freeze-unfreeze-data)
- Each shown FTE column shows the sum of the lines' FTE. When some lines have no FTE, the count follows the total, for example "3.50 · 12 unknown". Hover it for the full sentence: "Unknown for 12 lines". When no line has an FTE, the total is blank and only the count shows
- Totals respect your current filters and search

**Amounts without an exchange rate**:

- When a line's currency has no exchange rate for a year, its amount for that year shows in its own currency with a small orange mark. Hover the mark to read, for example, "No USD exchange rate for 2026: left out of totals."
- The totals leave these amounts out, and a one-line warning under the list names them, for example "Excluding 3 lines with no exchange rate: USD 2026." Budget administration users at admin level also see **Enter a rate**, which opens the currency settings on the missing rate. When the warning names a single currency and year, the manual rate dialog opens directly.
- In a sorted column, these lines come last. An amount filter never keeps them.
- See [Manual rates](currencies.md#manual-rates) to enter the missing rate yourself.

**Deep linking**:

- Clicking any cell opens the workspace on the most relevant tab:
  - **Ref**, **Product name**, **Supplier**, **Paying company**, **Account**, the dimension columns and other general columns: Opens the **Overview** tab
  - **Amount columns** (Budget Y, Expected landing Y, Revision Y+1, etc.) and **FTE columns**: Opens the **Budget** tab pre-set to the column's year
  - **Allocation**: Opens the **Allocations** tab for the current year
  - **Task**: Opens the **Overview** tab, where the Tasks panel sits
  - **Contract**: Opens the linked Contract workspace directly
  - **Cost center**: Opens the cost center workspace

**Actions**:

- **New line**: Create a line (requires `budget:member`)
- **Import**: Bulk-load lines from a budget file (requires `budget:admin`)
- **Export**: Export the lines to a budget file (requires `budget:admin`)
- **Delete selected**: Bulk-delete selected lines (requires `budget:admin`; select rows via checkboxes). A line with amounts in a frozen column cannot be deleted. Before anything is deleted, the confirmation lists the lines kept, with the frozen column. The others are deleted. The same delete is on the line: **Delete** (trash icon) in its header, for someone with `budget:admin` whose access covers all data. The check is the same. A line with amounts in a frozen column shows the refusal and its reason. When the line can be deleted, you confirm, the line is deleted, and the list opens again

**Prev/Next navigation**:

- When you open a line, the workspace shows **Prev** and **Next** buttons and a counter, for example "Line 3 of 47"
- These navigate through the list in the current sort order, respecting filters and search
- Moving to another line saves your pending edits first
- Your list context (sort, filters, search) is preserved when you close the workspace

**Tip**: Use column filters and quick search to build focused views (e.g., "All cloud spend over 10k", or **CAPEX** in **Type** with **High** in **Priority**), then navigate line by line with **Prev**/**Next** to review budgets.

---

## The workspace

Click any row in the list to open the workspace. Its address names the line by its reference, for example `/ops/budget/BL-12/overview`. It has four parts:

- **Header**: the line reference (e.g., `BL-12`) with a copy button, the line's title (click it to rename the line), **Prev** / **Next**, **Share**, **Delete** (trash icon, `budget:admin`, access to all data), and the close button
- **Metadata bar** under the title: **Status**, **IT owner**, and **Business owner**, each editable in place. When the line's cost center has a budget holder, **Budget holder** follows them. It is read only and derived from the cost center, not stored on the line: hover it to see which cost center it comes from, and change it on the cost center (see [Cost centers](cost-centers.md#budget-holder-on-budget-lines))
- **Five tabs**: **Overview**, **Budget**, **Allocations**, **Relations** (the Relations tab shows how many links the line has), and **History**
- **Properties panel** on the right: the line's main fields, starting with **Type** (with **Change type...** next to it on an existing line, see [Changing the type](#changing-the-type)). Open or close it with the properties button; the workspace remembers your choice

**Owner pickers**:

- In the **Properties** panel of a new line and in the metadata bar of an existing one, the **IT owner** and **Business owner** lists start under **Cost center access** with the people who have budget access and can read lines of the line's cost center. Everyone else follows under a separator
- Typing searches everyone, as before. You can choose anyone
- Without a cost center, the list is the usual one. The group is not shown when it would hold everyone, for example when no one has limited [data access](data-access.md)
- When your own data access is limited, the group appears for the cost centers within your access and for the line you are editing
- Choosing an owner gives that person access to the line

**Autosave**:

- Every change saves automatically. A **Saving...** / **Saved** hint shows in the header
- Switching tabs, moving to the previous or next line, or closing the workspace saves pending edits first. If a save fails, you stay where you are and an error explains why, so no edit is lost silently
- **Ctrl+S** (**Cmd+S** on Mac) saves immediately
- If a save cannot go through right away because another save is in progress on the same data, KANAP retries it for you
- If a bulk budget operation is running (for example a column copy or reset in Budget Administration), edits here are paused with the message "Another budget operation is running. Try again when it has finished." Try again once it is done

**Editing at the same time**:

- Two people can work on the same line at once without stepping on each other. Editing different fields, different budget months, or different budget columns never conflicts, even on the same line at the same moment
- When someone else changes the same field, the same budget column, or the allocation while you are editing it, a banner shows their value and yours, with who changed it and when. Choose **Keep their value** to take theirs, or **Apply yours** to keep what you typed. For a budget column, the choices are **Reload the column** or **Overwrite**; for the allocation, **Reload the allocation** or **Overwrite**
- Only the field, column or allocation that was changed waits for your choice; everything else keeps saving as usual
- A choice waiting for you is kept when you switch tabs. It is lost, after a warning, if you leave the line or change the year
- If the earlier change was your own, from another window or tab, the banner says so instead of naming someone else

### Overview

The Overview tab holds the free-text fields and the tasks of the line.

**What you can edit**:

- **Description**: What the line covers
- **Notes**: Free-form internal notes

When the line replaces another one, or was replaced from a later year after a type change, the top of the tab links the two lines: **Replaced by** on the older line, **Follows** on the newer one.

**Tasks panel**:

- Lists every task linked to this line, with **Title**, **Status**, **Priority**, **Due date**, and **Actions** columns. The panel title shows the number of tasks
- **Status** filter: All (default), Active (not done), Open, In progress, Pending, In testing, Done, or Cancelled. The clear button resets it
- Click **Add task** to open a new task already linked to this line. Fill in the title, description, priority, assignee, and due date in the task workspace
- Use the open icon to go to a task, and the delete icon to delete it (you confirm first)
- Tasks have their own permissions (`tasks:member` to create and edit). Member access on Budget does not grant task editing rights on its own; check with your admin if you cannot create tasks
- Tasks can also be viewed and managed from **Portfolio > Tasks**, which shows all tasks across your organization

**Properties panel**:

- **Type**: **OPEX** or **CAPEX**. On an existing line, **Change type...** next to it opens the dialog described in [Changing the type](#changing-the-type)
- **Supplier**, **Cost center**, **Paying company**, **Account** (filtered by the paying company's chart of accounts and the line's type), **Currency** (only the currencies allowed in your workspace), one field per analytics dimension used for the line's type, **Run or build**, and **Effective start**
- **Lifecycle**: the status switch, labelled with the current state (**Enabled** or **Disabled**), and the **End of validity** date. See [Status and lifecycle](#status-and-lifecycle)
- **Created** and **Updated** dates (read only)
- Type in **Supplier**, **Paying company**, **Account**, **IT owner**, **Business owner** or an analytics dimension field to search by name. Matches appear as you type, so you can find any value even in a very long list; a line under the list reads "Type to narrow down: more results" when there are more matches than shown

**Cost center**:

- The list shows the cost center tree. Groups are shown to help you find your way and cannot be picked. Search by code, name or group name
- When the paying company is chosen, the list shows only that company's cost centers, with the groups above them. A line that already has a cost center of another company keeps it in the list. When the company has no cost center, the list says so
- A disabled cost center is marked **Disabled**. It stays on the lines that already have it, and cannot be picked for another line
- When you create a line and the paying company is empty, the list shows every cost center. Picking one fills the paying company with the cost center's company, so the **Account** list opens on that company's chart of accounts. Until you pick a company or an account yourself, the list keeps every cost center and choosing another one updates the company too
- When you change the paying company, a cost center of another company is cleared in the same save. **Cost center** then lists the new company's cost centers
- A line whose cost center belongs to another company, from a file or the API, keeps both. A hint under the field says "This cost center belongs to" followed by the company name
- A line saved through the API with a cost center and no paying company takes the cost center's company. For imported files, see [CSV import/export](#csv-importexport)

**Run or build**: **Run**, **Build**, or **Not set**. Use it to split the budget between keeping services running and changing them.

**Analytics dimensions**:

- Each enabled dimension used for the line's type has its own field, named after the dimension, in dimension order. A dimension used for the other type only has none, and a value a line holds on it stays hidden. Pick a value or clear the field; the change saves at once
- Each field lists the enabled values of its dimension. A disabled value stays on the lines that already have it, and cannot be picked for another line
- A value used for the other type only is not offered, and is refused as a new choice. A line that already has it keeps it and stays editable. See [OPEX or CAPEX values](analytics.md#opex-or-capex-values)
- The field cannot create a value: create it in [Analytics dimensions](analytics.md), or let an import create it
- A required dimension is marked with an asterisk. A new line needs a value on it: **Create** stops with "Cost pool is required" until you pick one. On a line that holds a value, the field cannot be cleared, only changed. A line without a value stays editable. If you change such a line, leaving it asks first: "Cost pool is required. Choose a value before leaving." **Stay** puts the cursor in the missing field. **Leave anyway** leaves. See [Required dimensions](analytics.md#required-dimensions)
- If the dimensions cannot be loaded, one line replaces these fields: "Dimensions could not be loaded."

**Tip**: When you create a line, an "Obsolete account" warning means the selected account does not belong to the paying company's chart of accounts. Choose a different account to resolve the warning. An existing line whose account is outside its company's chart can still be edited: the chart is checked only when the company or the account changes.

---

### Budget

The Budget tab holds the amounts of the line, year by year and column by column. For the year you pick, choose a column, say how it is built, then read the result month by month.

**Year selection**:

- Use the year tabs at the top to switch between Y-2, Y-1, Y (current year), Y+1, and Y+2
- Each year has its own amounts
- Switching years saves your pending edits first. If a column still waits for your choice after someone else's change, KANAP asks first: **Change the year** drops your values in that column

**Budget columns**:

- The tab shows the columns your organisation shows, under their names, always in the same order. The standard columns are:
    - **Budget**: Initial annual budget approved at the start of the year
    - **Revision**: Mid-year budget update (e.g., after a reforecast or a scope change)
    - **Forecast**: An additional planning column, hidden by default
    - **Actuals**: Actual spend, as it is recorded during the year
    - **Expected landing**: Your best estimate of the year-end figure
- A budget administrator can rename the columns, hide some and choose the default column in **Budget management > Administration > Budget columns** (see [Budget columns](budget-operations.md#budget-columns)). A hidden column keeps its amounts
- Each shown column has a card under the year tabs: its name, its total for the year, how its amounts were produced and its period, for example "Spread flat" and "9 months, April to December". A column with nothing in it reads "Not entered yet". Hover a card to see its quantity and price lines
- Click a card to work on that column. The tab opens on the first shown column that is not frozen
- With a single shown column, there are no cards: the editor shows the column directly

**Period of a column**:

- Every column has a period inside the year, for example April to December
- A month counts when the period covers its 15th. A period that starts on April 10 includes April; one that starts on April 20 begins in May
- A column with no amount and no period yet gets a suggestion: the line's **Effective start** and **End of validity**, limited to the year. A line that starts on April 1 suggests April to December
- A column that already holds amounts and has no period reads as the whole year, so existing data behaves as before
- When the stored period of a column goes beyond the line's dates, the editor says which period a save uses, for example "Stored period: January to December. Saving will use April to December, the line's dates."

**How a column is built**:

The editor under the cards is titled with the column and the year, for example **Budget 2026**. Three tabs say how the column is built:

- **Amount**: one annual amount, spread over the months
- **Quantity and price**: lines, each a quantity times a unit price. See [Quantity and price](#quantity-and-price)
- **By month**: twelve amounts typed in the table

The three tabs are always offered. A column opens on the tab that matches how its amounts were produced: **Quantity and price** when they are calculated from its lines, **By month** after an edit by hand, and **Amount** for an empty, spread or copied column.

On an empty column, a click on a tab switches at once. On a column with amounts, a question appears in the editor first and says what changes. Click **Switch** to go on, or **Cancel**:

- To **Amount**: the current total becomes the amount, spread flat over the column's period. The lines of the column stay as a reference
- To **By month**: the current months are kept and become editable in the table
- To **Quantity and price**: the total comes from the lines. The current amount is replaced, or the lines kept as a reference are used again

**Amount**:

- **Annual amount**: the total of the column for the year
- **When**: **Whole year**, **A period** with **From** and **To** dates, or **At a date** with a single **Date**
- **Distribution**: **Flat** or **4-4-5**. At a date there is no distribution: the month of the date takes the whole amount
- A sentence says what you get, for example "120,000 spread flat from April to December (9 months)." or "5,000 on 10 February 2026, all in February." Hover the info icon next to it to read the 15th rule
- When some months of the year fall outside the period, a note says which ones will be set to zero, for example "January to March will be set to zero."
- A warning appears when the period goes beyond the line's dates. The amount is still saved
- While a date is missing or no month counts, a note in red says why and nothing is saved. When the line's dates leave no month in the year, the editor reads "No month of 2026 is within the line's dates." Choose **A period** to set the dates yourself
- **Every change saves at once**: the amount when you leave the field or press Enter, the other fields as soon as you change them. There is no button to click. A blank or zero amount saves nothing
- With **4-4-5**, the weights of the months that count are scaled up so the whole amount lands on them
- To bring a column back to a flat spread over twelve months, choose **Whole year** and **Flat**
- A spread over a column built from lines keeps its lines as a reference. See [Quantity and price](#quantity-and-price)

**By month**:

- The editor reads, for example, "Enter the amounts in the Budget column of the table below." Type each month in that column of **Monthly result**. The quarter subtotals and the total follow as you type. Only the months you change are saved
- Use it to follow a cash-out plan or the milestones of a project, for example the whole amount in a single month
- Click a month of another column in the table to type that column by month: it becomes the active column and the cursor goes in that month. On a column with amounts, the editor asks first. Hover a month to read "Enter by month". The months of a frozen column cannot be clicked

**Start from**:

- An empty column, with no amount and no line, can start from another shown column that has amounts. The editor reads "Start from", then the column with its total, "adjusted by", a percentage (0 by default) and **Copy**. Or enter the column yourself below
- **Copy** works like [Copy budget columns](budget-operations.md#copy-budget-columns) on this line and year: the months keep their shape and the percentage applies to each one. A column calculated from its lines stays calculated, with its unit prices raised by the percentage. A frozen column can be the source
- When the line's dates leave out some months of the source, they are not copied, and a note says so: "Months of the Budget column outside the line's dates were not copied."

**Use for other columns too**:

- Under the editor, **Use for other columns too…** gives other columns the same construction as the active one. It shows when the active column is an amount with a valid period, or follows its quantity and price lines, and another column can take it
- The link lists the other shown columns under **Same construction for**, each with a checkbox. The columns set to follow in [Budget columns](budget-operations.md#budget-columns) start ticked. Click **Apply**, or **Cancel**
- From an amount, the ticked columns take its period and distribution, and each keeps its own total. Columns that follow their lines are not offered, and a sentence names them, for example "Forecast keeps its lines."
- From quantity and price, the ticked columns take the same lines, which replace their amounts
- Frozen columns and columns waiting for your choice are not offered

**Clear column**:

- **Clear column**, on the right under the editor, sets every month of the active column to zero, for example before entering the whole amount in a single month. When the column holds amounts, you confirm first: "Clear every month of Budget for 2026? The other columns stay as they are." It counts as an edit by hand
- To remove both the amounts and the period of a column for every line, use **Reset budget column** in Budget Administration

**Monthly result**:

- Under the editor, **Monthly result** shows the year month by month for every shown column, in the line's currency, with a subtotal per quarter (**Q1** to **Q4**) and a **Total** row. The active column is highlighted
- With two columns or more, a last row gives the difference of each column with one of them, for example "+12,000 (+1.8%)". Pick that column in **Difference with** above the table. It starts on the default column
- While every column is empty, or an amount spread flat over the whole year, a sentence replaces the table, for example "All columns are spread flat over the whole year: the monthly detail adds nothing." **Show the detail** opens the table and **Hide the detail** folds it again. Your choice holds while you stay on the line
- The table stays open while the active column is typed by month or a column waits for your choice

**Back to the opening values**:

- The tab keeps the values each column of a year had when you first opened that year during your visit of the line. Switching tabs or years keeps them. Reloading the page starts again from the values of that moment
- Once you change a column, the right of the year tabs reads, for example, "2 columns changed since 10:42", followed by **Back to the opening values**
- Click it to put the columns you changed back to those values. There is no confirmation. Your edits under way are saved first, then each column is restored on its own
- A note lists what happened, for example "Opening values restored: Budget and Revision." A column stays as it is when it was frozen meanwhile, when someone else changed it since (the banner above then asks what to keep), or while it waits for your choice. A column only someone else changed is never restored. Close the note with **Close**
- If an edit under way cannot be saved, nothing is restored: "Nothing was restored: a change could not be saved first."
- The audit trail records each restored column with the action **Restore**

**Freeze behavior**:

- If a year's budget columns are frozen for the line's type (via Budget Administration), the card of each frozen column shows a lock icon, and so does its header in the table
- A frozen column is read only. Its editor reads, for example, "The Budget 2026 column is frozen" and "Read only. An administrator can unfreeze it in Administration › Freeze / unfreeze data.", with its total and how it was produced
- When some columns are frozen, a line under the chart says "Some columns are frozen and read-only."
- Each column can be frozen independently

**How each column was produced**:

- A short label on each card tells you where the amounts of the column come from, followed by its period. With a single column, it sits under the editor title
- **Spread flat**, **Spread 4-4-5** or **Spread by quarter**: the amounts come from a spread
- **Copied from Budget 2025 +2%**: the amounts come from **Copy budget columns** in Budget Administration, or from **Start from**, with the percentage shown when there is one
- **Quantity and price · 3 lines · 1.00 FTE**: the amounts come from lines, with their number and, when the lines count people or days, the column's FTE. The FTE is the full-year average. Hover the card to see the lines, for example "Project manager: 1 person × 1,200 per day, 5 days per month, Feb to Jul"
- **Edited by hand**: a month was changed in the table or by a budget file import
- An amount at a date shows its date instead of a period, for example "On 10 February 2026"
- A column with no label kept the data it had before periods existed

**When someone else is editing the same column**:

- Two people can fill in different months or different columns of the same line at once with no conflict
- On a monthly entry, if someone else changed one of the same months, those months wait for your choice; the column's other months save as you typed them
- If someone else changed the column's total, its spread, or its quantity and price lines while you were working on them, the whole column waits: a banner offers **Reload the column** or **Overwrite**. Its card shows an orange dot (hover it to read "Waiting for your choice") and its months are tinted. The editor stays read only until you choose, with the line "Choose first, above, whether to reload this column or overwrite it."
- Saving reloads the year, so you always see the latest figures for every other column; the cell or column you are editing is not disturbed

**Multi-year trend**:

- A chart below the table shows every shown column across years, Forecast included when it is shown, and updates as you type

**How to use it**:

1. Select the year you are planning for
2. Click the card of the column to fill (Budget for initial planning, Actuals for tracking, Expected landing for the year-end figure)
3. Choose **Amount**, **Quantity and price** or **By month**, and fill it in
4. Read the result in **Monthly result**. Your changes save automatically; a **Saving...** / **Saved** hint shows next to the year tabs

**Tip**: For most lines, one amount over the whole year or a period is enough. Use **By month** when the spend varies significantly by month (e.g., seasonal licensing, one-time setup fees, phased rollouts). To fill a new column from an existing one, use **Start from**.

#### Quantity and price

Build a column from lines instead of typing its amounts. Each line reads as a sentence: a quantity, a unit, a unit price, how often, when, and on which calendar. For example, one project manager 5 days per month at 1,200 a day from February to July, and 50 licences at 12 per piece per month. The months of the column are the sum of its lines. The amounts of a column have one source at a time: its lines, or a spread, a month typed by hand, or a copy. The other source stays visible as a reference and is read only, with a link to switch.

**Opening it**: click the card of the column, then the **Quantity and price** tab of the editor. A column calculated from its lines opens on it. The lines of a frozen column are read only.

**The lines**:

| Column | What to enter |
|---|---|
| **Description** | What the line pays for, for example "Project manager". Optional, up to 200 characters |
| **Quantity** | How many, in the unit of the line. Zero or more, up to 3 decimals |
| **Unit** | **people**, **days** or **pieces**. The unit decides what the price is for, how often it counts, how the amount lands on the months, and the FTE |
| **Unit price** | The price of one unit, in the line's currency. Up to 4 decimals. A negative price is accepted, for a credit. What the price is for shows right after it: **per day** for days, **per piece** for pieces, and for people a small list to choose **per day** or **per month** |
| **How often** | It follows the unit. People priced per day: a **Full time** checkbox and, when it is not ticked, the **days per month** they work on the line (more than 0, up to 31, with up to 3 decimals). People priced per month: "per month". Days: "over the period". Pieces: a list to choose **per month** or **once** |
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

- Use **people** for staff who work on the budget line month after month. Priced per day, say how much they work: tick **Full time** to count every working day of the calendar from the start to the end of the line, or enter the days per month. For example, a project manager 5 days per month at 1,200 a day from February to July costs 6,000 a month. On a calendar with 21 working days in March, that month counts 5 ÷ 21, about 0.24 FTE. A consultant full time at 400 a day costs the month's working days × 400 each month, and counts 1 FTE
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
- Notes when they apply: "The period goes beyond the line's dates.", a calendar disabled since, for example "Head office staff is disabled. The lines still use it.", and working days changed since the last save of the lines
- To give other columns the same lines, use **Use for other columns too…** under the editor. See [Budget](#budget)

**When the amounts change another way**: the lines stay with the column as a reference, read only. Under **Amount** or **By month**, a line says how many lines are kept, for example "4 lines kept as a reference (48,000).", followed by a **Use the lines again** link. The link saves the lines as they are and computes the column from them again. Choosing the **Quantity and price** tab does the same, after a question. To change a line kept as a reference, use the lines again first, then edit it.

- Switching the column to **Amount** or **By month**, typing a month in the table, or **Clear column**
- **Copy budget columns** in Budget Administration, or **Start from**: when the source amounts were not calculated from lines, the copy brings the source column's lines as a reference. A column calculated from its lines stays calculated, with its prices raised by the percentage. See [Copying a column built from lines](budget-operations.md#copying-a-column-built-from-lines)
- A calendar's working days changed: the **Quantity and price** tab reads, for example, "Working days changed since the last computation: March: 20 days, now 19.", followed by **Use the lines again**. Nothing changes on the column until you click it. The lines stay editable meanwhile
- **Reset budget column** in Budget Administration removes the lines with the amounts. See [Reset budget column](budget-operations.md#reset-budget-column)
- A budget file changes the months of a column and leaves its lines. See [Load a budget from a spreadsheet](budget-file.md)

#### FTE

FTE (full-time equivalent) says how many people a column pays for. It comes from the quantity and price lines: each month adds up the FTE of its lines (see the table above). Two figures follow, each rounded to 2 decimals:

- **Full-year average**: the sum of the twelve months divided by 12. It is the column's FTE, shown in the label of the column and in the FTE columns of the list
- **FTE over the period**: the sum of the months with people or days, divided by the number of those months. Pieces do not count, so licences or a laptop never lower it. It shows under the lines while the amounts come from them. After an edit by hand, a spread or a copy, it is not shown until you use the lines again

For example, a consultant full time from February to October counts 1 FTE in each of those 9 months: 1.00 over the period, and 9 × 1 ÷ 12 = 0.75 for the full year. A project manager 5 days per month from February to July counts about 0.24 over the period, and 0.12 for the full year. Licences over the whole year or a laptop in December on the same column leave both figures as they are.

- **Counted**: a column with lines in people or days
- **Zero**: a column whose lines are all in pieces. Its FTE is 0
- **Blank**: a column without lines, a budget line without a version for that year, or a year after the line's end of validity. Its FTE cell stays empty, because KANAP cannot tell how many people it pays for
- The FTE stays with the lines. After an edit by hand, a spread or a copy, the column keeps the FTE of its lines. A copy calculates the FTE again from the copied lines, with the working-day calendars of the destination year

---

### Allocations

The Allocations tab distributes the spend of a year across your companies and departments. The allocations drive the chargeback reports and the cost-per-user KPIs, for OPEX and CAPEX lines.

**Year selection**:

- Works the same as Budget: use year tabs to switch between Y-2, Y-1, Y, Y+1, Y+2
- Each year can have a different allocation method
- The year total of the default column shows on the right, for example **Budget, year total**, and the table shows each share as a percentage and as an amount, with a total row

**Allocation methods**:

| Method | How it works |
|---|---|
| **Headcount (default)** | Splits spend proportionally by each company's headcount for the selected year. No manual selection required: percentages are computed automatically from company metrics. This is the standard default. |
| **IT users** | Splits spend proportionally by each company's IT user count for the selected year. |
| **Turnover** | Splits spend proportionally by each company's turnover (revenue) for the selected year, converted to the reporting currency. |
| **Manual by company** | You select which companies receive this spend and choose a driver in **Allocate by** (Headcount, IT users, or Turnover) to calculate percentages among the selected companies only. |
| **Manual by department** | You select specific company/department pairs. Percentages are calculated from each department's headcount. Useful when a line benefits only certain departments (e.g., a CRM used by Sales). |
| **Manual percentages** | You pick the companies and type each percentage yourself. The percentages must add up to 100%. |

**Default vs pinned methods**:

- The **default** entry, shown as *Headcount (default)* until your organisation configures another method, follows the setting in **Budget management > Administration > Default allocation method**. Every line left on the default is re-driven when an admin changes that setting
- That setting can also restrict the default to a **selection of companies** (for example the entity that carries the IT budget): the driver then applies to those companies only, and the option reads *Default (n companies)*
- **Headcount**, **IT users** and **Turnover** pin that method on the line: a pinned method keeps working even if the organisation default changes later
- Lines with a manual allocation are never affected by the default setting

**How percentages work**:

- For **automatic methods** (Headcount, IT users, Turnover): percentages are computed from the latest company metrics across your enabled companies. You do not edit them directly
- For **Manual by company** and **Manual by department**: you pick the companies or departments, and the system calculates percentages from your chosen driver and the current metrics
- For **Manual percentages**: typing a percentage pins that row, and the remaining rows share what is left. **Split equally** gives every row the same share; **Clear manual pins** releases the pinned rows
- Percentages reflect live data. If you update a company's headcount, allocations recalculate
- The **Driver** column shows each company's value for the driver. A turnover shows with the company's base currency, for example **35 M USD**

**Turnover in several currencies**:

- Each company enters its turnover in millions of its base currency. Before the split, KANAP converts every turnover to the reporting currency, at the rates of the budget version of the year: the rates fixed when its default column was frozen, otherwise the current rates of the year. See [Currency Settings](currencies.md)
- When a currency has no rate for the year, the companies in that currency are left out of the split: they get no share, and the other companies share 100%. A warning above the table names each company left out. KANAP fetches the missing rate in the background, and the split corrects itself once the rate is available. A [manual rate](currencies.md#manual-rates) fixes it at once
- With **Manual by company** and the Turnover driver, when none of the selected companies has a rate, the allocation is refused with a message naming the currencies and the year. Enter the rate, or choose another driver

**How to use it**:

1. Select the year
2. Choose an allocation method in **Method**
3. For a manual method, use **Add row** to add companies (or company/department pairs) and the remove icon to drop one. For **Manual by company**, pick a driver in **Allocate by**
4. Changes save automatically

**Common issues**:

- **Missing metrics**: One or more companies have zero or missing headcount/IT users/turnover for the selected year. Fill in the metrics in **Master data > Companies** (Details tab)
- **"Manual percentages must sum to 100%."**: Adjust the rows, or click **Split equally**

**When someone else is editing the allocation**:

- The method, driver and rows save together. If someone else changed the allocation while you were editing it, a banner offers **Reload the allocation** or **Overwrite**
- Changing the year while a choice is waiting asks for confirmation first

**Tip**: Use Headcount (default) for most lines: it is the simplest and updates automatically. Reserve manual methods for spend that benefits specific companies or departments only.

---

### Relations

The Relations tab shows what this line pays for: its projects, applications, technologies, contracts and assets, each in its own table, then suggestions, contacts, and links and files. Click a row to open the record. The tab badge counts the linked projects, applications, technologies, contracts and assets, and the links and files. Contacts are not counted. Technologies and assets count only if you can read the infrastructure.

**Linked records**, one table each:

| Section | Columns |
|---|---|
| **Projects** | Reference (`PRJ-7`), name, status, planned end |
| **Applications** | Reference (`APP-3`), name, lifecycle, business criticality |
| **Technologies** | Reference (`TEC-5`), name, family, vendor |
| **Contracts** | Name, supplier, end of the current term, yearly amount in the contract currency, renewal (tacit or manual) |
| **Assets** | Reference (`AST-12`), name, type, environment, status |

You only see the sections of the modules you can read. Technologies and assets need a read of the infrastructure. A Business Contributor only sees the projects and applications they take part in. The project names also appear in the list's **Project** column, where the quick search finds them. The contract names appear in its **Contract** column. A contract that differs from the line on paying company, cost center, supplier or currency shows a small orange mark next to its name. Hover the mark to see each difference, with the value on the line and the value on the contract. The picker shows the same mark on a contract before you link it. Linking stays possible. The mark appears for a contract you can read.

An end date in orange is a contract whose renewal decision is due within your contract decision window. A disabled contract, or a retired or disabled asset, stays listed with its name greyed out. From two rows on, the contracts end with one total per currency, without the disabled ones.

**Adding and removing links** (`budget:member`): **Add** at the right of a section opens a search. Type a name or a reference and pick a result: the link is saved at once. Linking also needs a read of the target module, so **Add** is absent from a section you cannot read. To remove a link, hover the row and click the cross at its end. A message confirms it and offers **Undo**. Removing a link deletes nothing else. Readers see the tables read-only.

**Related**: applications and contracts of the line's supplier that are not linked yet, with the reason "same supplier". Click **Link** to add the suggestion to its section. The suggestions show:

- applications in service, if you can read the applications. A Business Contributor only sees the applications they take part in;
- active contracts, if you can read the contracts;
- at most 20 of each.

The section is absent when the line has no supplier or there is nothing to suggest.

**Contacts**: people for this line, each with a role (**Commercial**, **Technical**, **Support** or **Other**). Pick a contact, then pick its role: choosing the role adds the contact. The table shows the role, first name, last name, job title, email and mobile. Hover the role to see whether the contact comes from the supplier or was added manually. Remove a contact with the remove icon.

**Links and files**: the web links of the line (vendor portals, documentation, admin consoles) and its files (quotes, invoices, approval memos), one row each with its name, the domain of the link or the size of the file, and the date it was added. Click a link to open it in a new tab, or a file to download it. With `budget:member`:

- **Add link** opens a dialog for a URL and an optional name; the link is saved at once. To change a link, hover its row and click the pencil.
- **Attach file** opens the file chooser. You can also drop files on the section.
- To remove a link or a file, hover the row and click the cross. Removing a link shows a message and offers **Undo**, which creates the link again. Deleting a file asks for confirmation first.

**Tip**: Link contracts to track renewals across several lines. Attach quotes and invoices to keep all the documents of a line in one place.

---

### History

The History tab lists the changes made to the line, the most recent at the top. Each entry shows the date and time, the author (a person, **System**, **Import**, or **Plaid for** a person), and each changed field with its value before and after. A change of amount names the year, the column and the values before and after.

The changes to the parts of the line appear here too: amounts, dimensions, allocations, links, attachments, contacts, applications, technologies, assets and tasks. Anyone who can open the line can read its history. A record from a module you cannot read appears by its kind only, for example "a contract".

See [Record history](record-history.md) for the details.

---

## CSV import/export

**Export** and **Import** sit in the toolbar of the list. Both need the Admin level on Budget (`budget:admin`).

**Export** writes the budget file of the lines the list shows, OPEX and CAPEX together, as `budget.csv` or as an Excel workbook, `budget.xlsx`. **Import** reads either back: it is checked first, and nothing is written until you click **Load**.

The file holds one row per line: its `nature` (`opex` or `capex`), its reference `BL-n`, the line's details, its amounts as columns and `kanap_token`. A file without a `nature` column, exported by an earlier version, is read as OPEX lines, or as CAPEX lines when the **Type** filter of the list keeps CAPEX only. [Load a budget from a spreadsheet](budget-file.md) describes the columns, what a cell means, and the two import steps.

---

## Status and lifecycle

Every line has a **status** (Enabled or Disabled) and an optional **End of validity** that controls when it appears in reports and selection lists. It is the only end date of a line.

**How it works**:

- **Enabled**: The line is active and appears everywhere (lists, reports, allocations)
- **End of validity**: The date the line stops. Leave it blank if there is no end. When the end of validity passes, the status switches to **Disabled** on its own within the hour
- After the end of validity:
    - The line no longer appears in selection lists for new contracts or allocations
    - It is excluded from reports for years strictly after the end of validity
    - Historical data remains intact; the line still appears in reports covering years when it was active

**Setting status**:

- When you create the line, you can set its **End of validity** in the **Properties** panel
- Later, change the **Status** in the metadata bar, or use the **Lifecycle** field in the **Properties** panel (the status switch and **End of validity**). Switching a line to **Disabled** ends its validity now: it is disabled at once. While a future date is set, the switch reads **Active until** and that date
- You can schedule a future end of validity, for example the end of a contract, a planned disposal or the end of an asset's useful life

**Viewing disabled lines**:

- By default, the list shows only **Enabled** lines
- Lines that end during the current year stay in **Enabled** until 31 December, even once their status reads **Disabled**. They move to **Disabled** on 1 January
- Use the **Show: All / Enabled / Disabled** toggle and pick **Disabled** or **All** to see the lines that ended in an earlier year

**When to disable vs delete**:

- **Prefer disabling**: Keeps history intact, ensures reports remain consistent, and supports audit trails
- **Delete only if**: The line was created by mistake
- A line with amounts in a frozen column cannot be deleted. Unfreeze the column first, or set an end of validity date instead. You delete a line from the list (**Delete selected**) or from its header (**Delete**, trash icon)
- Deleting a line also removes its budgets, allocations, tasks, relevant websites, attachments (with their files), and its links to contracts. If one of its tasks was turned into a request, the request is kept: it has its own copy of the title, description, and attachments, and only its link to the task goes

**Tip**: Use the End of validity to retire lines when contracts end, services stop, assets are disposed of or projects complete. Delete only a line created by mistake.

---

## Changing the type

An OPEX line that turns out to be an investment becomes a CAPEX line, and a CAPEX line that turns out to be operating spend becomes an OPEX line. Click **Change type...** next to **Type** in the **Properties** panel. You need the Member level on Budget (`budget:member`). Edits not saved yet are saved before the dialog opens.

**From** sets where the change starts:

- **The line's first year** (the default): the line itself changes type. It keeps its `BL` reference and its address, its budgets, allocations, links, attachments and tasks. Its **Type** changes in the list. A line that becomes CAPEX leaves the OPEX reports and joins the CAPEX reports, and the chargeback counts it under CAPEX. A line that becomes OPEX does the reverse
- **A later year**: this line ends on 31 December of the year before and keeps its earlier budgets. A new line of the other type, with its own `BL` reference, carries the budget from that year on, with the contacts and the links to applications, assets, contracts, projects and requests. Attachments, relevant websites and tasks stay on this line. The top of the **Overview** tab links the two lines: **Replaced by** on this line, **Follows** on the new one

The dialog also asks for:

- **Account**: an account for the new type. When the line's account is for its current type only, the line keeps it in place unless you choose another one; a new line from a later year gets it only when it suits the new type
- **Dimensions**: the dimensions required for the new type, and the values of the line that are for its current type only. In place, you can set them now or later. From a later year, the new line needs the required ones, and values for the current type only are not copied. A dimension used for CAPEX lines only does not apply to OPEX lines: a CAPEX line that becomes OPEX in place keeps its value without showing it, and shows it again if it becomes CAPEX later
- **Reason**: optional, kept in the line's audit trail

The change is refused when the line has amounts in a frozen column, of OPEX or CAPEX lines, in the years that change. Unfreeze the column first, or start the change from a later year. A later year is offered when it comes after the line's first budget year, the line has a budget in that year or a later one, starts before 1 January of that year and is still valid on that day, and has not been replaced by another line already. A change always starts on 1 January.

A budget file never changes the type of a line. See [Load a budget from a spreadsheet](budget-file.md).

---

## Tips and best practices

1. **Start simple**: Create lines with just the essentials (title, paying company, account, and the required dimensions), then add budgets and allocations as you plan.

2. **Use the default allocation method**: For most lines, Headcount (default) is enough. Reserve manual allocations for spend that benefits specific companies or departments only.

3. **Link contracts**: If you manage spend through contracts, link them in the Relations tab. It makes renewals and purchases easier to track.

4. **Link applications**: Associate lines with the applications or services they fund. This provides a clear cost-to-application mapping.

5. **Upload documentation**: Use **Attach file** in **Links and files** on the Relations tab to store vendor contracts, quotes, invoices, approval memos and SOWs.

6. **Add vendor portal links**: Use **Add link** in **Links and files** to link to vendor admin consoles, support portals, and documentation for quick access.

7. **Track contacts**: Add supplier contacts with roles (Commercial, Technical, Support) so your team knows who to call for each line.

8. **Leverage analytics dimensions**: Give lines a value on each dimension (for example **Software** on **Cost pool**, or the **Purpose** and **Priority** of a CAPEX line) to group spend in reports.

9. **Keep company metrics up to date**: Allocations depend on company headcount, IT users, and turnover. Outdated metrics cause allocation errors.

10. **Use a file for bulk setup**: If you are migrating from another system or have hundreds of lines, start with an import. Export a fresh file, fill in your rows, and check it before loading.

11. **Disable, do not delete**: Preserve history by disabling lines when they are no longer active. Delete only if it is a mistake.

12. **Review the totals row**: Before finalizing budgets, check the **Total** row under the list to ensure your spend adds up as expected. Filter on **Type** to see the total of OPEX or CAPEX alone.

13. **Use deep linking**: Click directly on a budget column in the list to jump to the Budget tab for that year. Click the Task column to jump to the line's tasks on the Overview tab. This saves navigation time.

14. **Freeze budgets after year-end close**: Use Budget Administration to freeze prior-year budgets once actuals are finalized, preventing accidental edits.

---

## Permissions

Access to budget lines is controlled by the Budget resource, which covers OPEX and CAPEX lines alike. It has three levels:

- `budget:reader`: View the list, open lines, see budgets and allocations (read-only), download attachments
- `budget:member`: Create and edit lines, change their type, update budgets and allocations, upload and delete attachments, manage relations, links and contacts
- `budget:admin`: All member rights plus import and export, budget operations (copy budget columns, with their amounts and allocations, and reset budget column), and deleting lines from the list or from the line

Freezing budget columns needs Budget administration (`budget_ops:admin`).

Data access can limit a person to the lines of some companies or cost centers. They then see those lines and the lines they are named on, a line they see in Read shows "Read only in your access", and deleting lines and bulk operations are reserved to people with access to all data. See [Data access](data-access.md).

Additionally:

- Tasks have separate permissions (`tasks:member` to create and edit tasks on budget lines)
- Users with `tasks:reader` can view tasks but not create or edit them

If you cannot perform an action (e.g., the **Import** button is missing, or you cannot upload attachments), check with your workspace admin to review your role permissions.

---

## Need help?

- **File issues**: Export a fresh file from the list and check it again. The report names the line and the column of every error, and [Load a budget from a spreadsheet](budget-file.md) explains what each cell means
- **Allocation errors**: Check that all companies have the required metrics (headcount, IT users, turnover) for the selected year
- **Obsolete account warning**: The account does not belong to the paying company's chart of accounts; pick a different account
- **Missing buttons or tabs**: Your role may not have the required permission level (member or admin). Contact your workspace admin
