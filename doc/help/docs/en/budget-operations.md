# Budget Administration

Budget Administration gives you a set of tools for managing and transforming budget data across years and columns. These are the operations you reach for during budget planning cycles: preparing next year's numbers, locking approved budgets, and managing year-over-year transitions.

## Where to find it

- Path: **Budget Management > Administration**
- Permissions: Most operations require `budget_ops:admin`

The landing page shows seven cards, each linking to a dedicated tool:

| Tool | Purpose |
|------|---------|
| **Freeze / unfreeze data** | Lock budget columns to prevent changes |
| **Copy budget columns** | Copy data between years and columns with adjustments |
| **Copy allocations** | Copy allocation methods from one year to another |
| **Reset budget column** | Clear all data from a specific column |
| **Default allocation method** | Set the method OPEX and CAPEX items follow by default |
| **Budget rows file** | Export or import the monthly amounts of every OPEX and CAPEX line |
| **Budget columns** | Name the five budget columns, choose which ones are shown and which one is the default |

The budget columns are Budget, Revision, Forecast, Actuals and Expected landing. These are the standard names. Your organisation can rename them, hide some and choose a default column in [Budget columns](#budget-columns). Every page below shows the names your organisation chose.

---

## Freeze / Unfreeze Data

Lock budget columns so they cannot be edited, imported into, or modified in any way. Freezing protects approved figures from accidental changes.

### When to use it

- After the annual budget is approved
- When closing a fiscal period
- To protect actuals from being modified

### How it works

1. **Select a year** from the dropdown (range: current year minus one through current year plus four)
2. **Select scopes**: tick **OPEX**, **CAPEX**, or both
3. **Select columns** for each scope. The list offers all five columns. Hidden columns are marked **Hidden**. Every column is selected by default, so freezing a year freezes every column, hidden ones included. Untick a column to leave it out
4. Click **Freeze data** to lock, or **Unfreeze data** to unlock. Both buttons stay disabled while a selected scope has no column picked

### What freezing does

- Prevents edits to frozen columns in OPEX and CAPEX workspaces
- Blocks CSV imports to frozen columns
- Blocks copy and reset operations targeting frozen columns
- Does **not** affect read access: data remains visible
- Applies to hidden columns too. A frozen column stays frozen when it is hidden, and imports into it are still refused

### Freezing the default column fixes the exchange rates

Freezing the [default column](#budget-columns) for a year also fixes that year's exchange rates for the scope you freeze. KANAP refreshes the rates for the year, then keeps the latest set for every OPEX or CAPEX amount of that year. Reports then convert those amounts with the same rates, even when newer rates arrive. Unfreezing the default column releases them.

Freezing another column does not touch the rates. Changing the default column later does not fix or release anything by itself: the rates follow the next freeze or unfreeze of the new default column.

### Current status

Below the controls, two cards show the real-time freeze state of all five columns in OPEX and CAPEX. Each column displays either **Frozen** (in red) or **Editable**. Hidden columns are marked **Hidden**.

### Permissions

Without `budget_ops:admin` you can still view the freeze status, but the controls are disabled. A banner reads "Only budget administrators can change this page."

---

## Copy Budget Columns

Copy budget data from one year and column to another, with an optional percentage adjustment. This is the primary tool for seeding next year's budget from the current one.

The **OPEX** / **CAPEX** switch at the top chooses which items the copy runs on. OPEX is selected by default when you can read OPEX items, otherwise CAPEX.

Needs administration rights on OPEX, or on CAPEX for CAPEX lines.

### When to use it

- Preparing next year's budget from the current year
- Creating a revision from the approved budget
- Rolling forward projections with an inflation factor

### Fields

| Field | Description |
|-------|-------------|
| **Source year** | Year to copy from (range: current year minus one through current year plus five) |
| **Source column** | Any shown column, Forecast included when it is shown. Starts on the default column |
| **Destination year** | Year to copy to (same range) |
| **Destination column** | Any shown column. Starts on the default column |
| **Percentage increase** | Adjustment applied to every copied month (e.g., `3` = +3%). Defaults to 0. Accepts decimals and negative values. |
| **Overwrite existing data** | Toggle. When off, items that already have a value in the destination are skipped. When on, all destination values are replaced. |

The page opens on the default column of the current year as the source and the default column of next year as the destination. Hidden columns are not offered.

### Two-step process: Dry Run, then Copy

1. Click **Dry run** to generate a preview without changing any data
2. Review the preview grid, which shows:
   - **Item** name (items marked **Skipped** keep their current value; items marked **Prorated** start or end during the destination year and get only the months within their validity)
   - **Source value** (from the source year/column)
   - **Current destination value**
   - **Preview value** (what the destination will become after copy)
3. When you are satisfied, click **Copy data** to apply

The **Copy data** button is only enabled after a successful dry run.

### Summary statistics

Below the grid, a stats bar shows:

- **Total items** in the dataset
- **Items to be processed** (non-skipped)
- **Source total** (sum of source values)
- **Current destination total**
- **Preview total** (shown after dry run)

### Overwrite behavior

| Overwrite | Destination has data | Result |
|-----------|---------------------|--------|
| Off | Yes | Skipped |
| Off | No (zero) | Copied |
| On | Yes | Replaced |
| On | No (zero) | Copied |

### How amounts are copied

- The copy keeps the monthly shape. Each of the twelve months is copied to the same month of the destination, so a column spread from April to December stays April to December
- Only items valid in the destination year are copied. An item counts for the months whose 15th falls between its **Effective start** and its **End of validity**. An item without such a month is left out, as the Budget tab does not show it either
- An item valid for part of the destination year gets only those months. The other months keep their amount, and the period is cut to the item's dates. For example, a twelve-month source copied to an item ending on June 30 gives January to June
- Without a percentage, amounts are copied exactly, to the cent
- With a percentage, each month is rounded to a whole amount. The yearly total is the source total with the percentage applied, rounded to a whole amount. The small difference lands on the last month that has an amount. For example, 12,000 spread from April to December (1,333.33 a month and 1,333.36 in December) copied with +2% gives 1,360 a month and 12,240 for the year
- The column's period moves with the copy: April to December 2026 becomes April to December 2027. A period that ends on February 29 ends on February 28 in a year without one
- A source without a period gives a whole-year period
- In the Budget tab, the destination column shows "Copied from Budget 2026 +2%"
- Copying a column onto itself (same year and same column) is refused
- The copy is all or nothing: if one item fails, nothing is saved

### Copying a computed column

A column can be built from lines, each a quantity times a unit price. See [Quantity and price](opex.md#quantity-and-price).

- The copy brings the source column's lines to the destination, with their description, quantity, unit, unit price and calendar. Their periods move to the destination year, like the column's period: March to December 2026 becomes March to December 2027, and a line that ends on February 29 ends on February 28 in a year without one
- The copy brings the source column's FTE too
- The months are copied like any other column. The percentage increase applies to the copied amounts only. The lines keep their unit prices
- A copy from a column without lines leaves the destination without lines, and its FTE becomes blank
- In the Budget tab, the destination column shows "Copied from Budget 2026", and its **Quantity and price** tab says "Amounts were copied from Budget 2026. Use the lines again."
- To plan the destination year at its own prices, open the item's Budget tab and change the unit prices on the **Quantity and price** tab: each change computes the column from the lines again. To keep the prices, click **Use the lines again**. A line priced per day needs a calendar that holds the destination year: a standard calendar always does, and a custom one may not, for example "Head office staff has no working days for 2027. Add them on the Working-day calendars page."

### Frozen column protection

If the destination column is frozen, both **Dry run** and **Copy data** are disabled. An error banner tells you to unfreeze first.

---

## Copy Allocations

Copy allocation methods and percentages from one year to another. This saves you from re-entering chargeback configurations when setting up a new fiscal year.

The **OPEX** / **CAPEX** switch at the top chooses which items are copied. Only items valid in the destination year are copied, with the same rule as **Copy budget columns**. The copy is all or nothing: if one item fails, nothing is copied.

Needs administration rights on OPEX, or on CAPEX for CAPEX lines.

### When to use it

- Preparing next year's budget with the same cost allocations
- Rolling forward chargeback configurations
- Setting up a new fiscal year

### Fields

| Field | Description |
|-------|-------------|
| **Source year** | Year to copy allocations from (range: current year minus one through current year plus five) |
| **Destination year** | Year to copy allocations to (same range). Must differ from the source year. |
| **Overwrite existing data** | Toggle. When off, items that already have allocations in the destination are skipped. |

### Two-step process: Dry Run, then Copy

1. Click **Dry run** to see a preview
2. The preview grid shows each OPEX or CAPEX item with:
   - **Item** name
   - **Action**: what will happen (Will copy, Skip – no source year, Skip – no allocations in source, Skip – destination has data, Error)
   - **Source** method and label
   - **Destination** current method and label
   - **Result after copy**: what the destination will look like
3. Click **Copy data** to apply

### Validation

- Source and destination years must be different. If they match, a warning banner appears and both buttons are disabled.
- Changing any filter clears the preview, requiring a fresh dry run.

### Summary

After a dry run, a banner shows the count of items ready to copy, skipped, and errored. If items were skipped because the destination already has allocations, a separate warning suggests enabling overwrite.

---

## Reset Budget Column

Clear all data from a specific budget column for a given year. This is a destructive operation: use it when you need to start fresh.

The **OPEX** / **CAPEX** switch at the top chooses which items are cleared. The reset sets the twelve months of the column to zero and removes its period, and its lines when the column was built from quantity and price. In the Budget tab, the column then gets a new suggestion from the item's dates. The reset covers every item, including items whose end of validity has passed. The reset is all or nothing: if one item fails, nothing is cleared.

Needs administration rights on OPEX, or on CAPEX for CAPEX lines.

A column whose items hold no amount can still be reset: the reset then only removes the spread periods, and the confirmation says so.

### When to use it

- Starting fresh with budget planning
- Correcting mass data entry errors
- Clearing test data

### Fields

| Field | Description |
|-------|-------------|
| **Year** | The fiscal year to clear (range: current year minus one through current year plus five) |
| **Budget column** | Any shown column, Forecast included when it is shown. No column is preselected: the field reads **Choose a column** and **Clear column** stays disabled until you pick one |

### Preview

Before you choose a column, one line replaces the grid: "Choose a column to see the amounts it holds." Once you choose a column, a grid shows every OPEX or CAPEX item and its current value in that column. Amounts that will be cleared are shown in medium weight; empty values are muted. Below the grid, three stats appear:

- **Total items**
- **Items with a non-zero total**
- **Current total value**

### Confirmation

Clicking **Clear column** opens a confirmation dialog that shows:

- The column and year being reset
- The number of items affected
- The total value being deleted
- A clear warning that this action cannot be undone

You must click **Clear column** in the dialog to proceed, or **Cancel** to abort.

### Safety features

- The **Clear column** button stays available when no item has an amount, so the spread periods can still be removed
- No column is preselected, so you always choose the column to clear
- Frozen columns cannot be reset. Unfreeze them first
- The confirmation dialog requires explicit acknowledgement

---

## Default Allocation Method

Set the method that OPEX items and CAPEX investments follow when they are left on the default allocation. The setting is per fiscal year: each year resolves its own default, so you can change the basis for one year without touching the others.

### When to use it

- Your chargeback model is not headcount-based (for example revenue-driven)
- The IT budget is carried by one entity and must not be spread over every subsidiary
- You want new items to follow a shared basis without editing them one by one
- You are preparing a fiscal year whose allocation basis differs from the previous one

### Fields

| Field | Description |
|-------|-------------|
| **Fiscal year** | The year the setting applies to (range: current year minus one through current year plus five) |
| **Companies** | **All enabled companies** (default) spreads the cost over every company active for the year. **Selected companies** restricts it to the companies you pick |
| **Default method** | The driver weighting the companies: Headcount, IT Users, or Turnover |

### How it works

1. **Select a year**
2. **Pick the company scope**: *All enabled companies*, or *Selected companies* and then the companies themselves
3. **Pick the driver** that weights the companies (Headcount, IT Users, or Turnover)
4. Every change saves immediately, there is no Save button
5. To return to the standard, click **Use the standard method** (shown only while a custom default is configured)

### Selected companies

- The driver is applied to the selected companies only: their percentages are computed from their own headcount, IT users or turnover for the year
- The page shows the resulting split, so you can check the effect before relying on it
- A single selected company always takes **100%**, with no driver value required
- With two companies or more, every selected company needs a value for the chosen driver. A company without one is rejected when you save. Fix the company metrics in **Master Data > Companies** first
- A company disabled for the year cannot be selected: disabled companies are excluded from that year's allocations

### What it affects

- Every OPEX item and CAPEX investment whose allocation method is **default**, shown as *Headcount (default)* (or *Default (n companies)*) in the Allocations tab until an organisation default is set
- Items with an explicit method (Headcount, IT Users, or Turnover pinned on the item) or a manual allocation keep their own setting
- Allocated amounts are recomputed the next time allocations are displayed. Budget amounts themselves are never modified

### Standard method

Until an organisation configures a default, the standard applies: **Headcount** over every company enabled for the year. The page always shows whether the year is on the standard or on a configured default, and what the standard method is.

### Changing the default after the fact

The default is resolved every time allocations are displayed, so editing it re-drives every item left on the default. If a company included in the selection later loses its driver value or is disabled, the affected items show an error instead of a silently rebalanced split. The page warns you about the current selection.

### Permissions

Without `budget_ops:admin` you can view the current setting but not change it.

---

## Budget rows file

Export or import the monthly amounts of every OPEX and CAPEX line in one file, with one row per line, year and column.

### When to use it

- Load monthly budgets prepared in a spreadsheet
- Import monthly actuals from your accounting system
- Review or archive every column, including Forecast

### Export

1. Choose a year, or keep **All years**
2. Click **Export**, then **Export data**

The file lists every OPEX and CAPEX line you can read, for every year that has amounts. Each line and year gets five rows, one per budget column in the fixed order (Budget, Revision, Forecast, Actuals, Expected landing under their standard names). Columns without amounts and hidden columns are included too.

Under the intro, the page shows which technical name in the file stands for which of your columns, for example "`planned` for Budget". The same technical names appear as **In files** on the [Budget columns](#budget-columns) page. When the file covers one year, or only OPEX or only CAPEX because of your permissions, its name ends with `partial`.

A file can be imported up to 10 MB. For a larger budget, export and import one year at a time: a year-limited export gives a smaller file.

### Columns

The file uses a semicolon `;` as separator and UTF-8 encoding.

| Column | Content |
|--------|---------|
| `item_type` | `opex` or `capex` |
| `item_number` | The item number, for example `7`. On import, the reference also works (`OPX-7`, `CPX-7`) |
| `year` | Four digits |
| `measure` | The column, by its technical name, whatever your organisation calls it: `planned` (column 1, standard name Budget), `committed` (column 2, Revision), `forecast` (column 3, Forecast), `actual` (column 4, Actuals), `expected_landing` (column 5, Expected landing). On import, `budget`, `revision`, `follow_up` and `landing` also work |
| `period_start`, `period_end` | The column's period as `YYYY-MM-DD`, inside the row's year. On import, both empty means the whole year |
| `jan` to `dec` | The twelve monthly amounts, with a dot as decimal separator. On import, a comma and spaces are accepted too |
| `method` | How the column was produced: `spread`, `copied`, `manual` or `computed` (built from quantity and price). For information only, ignored on import |

### Import rules

1. Click **Import**, choose the file and run **Preflight check**
2. Review the report, then click **Load**

- The whole file is checked before anything is saved. If one row has an error, nothing is saved and the report lists the errors by line number
- Each row replaces the twelve months of its line, year and column. Lines, years and columns that are not in the file stay untouched
- All twelve months are required. Write `0` for a month without an amount
- A row identical to what is stored is left untouched, including how the column was produced. Re-importing an export changes nothing
- A row whose amounts change marks the column as **Edited by hand**, with the period from the file. A column built from quantity and price keeps its lines, and its Budget tab offers to use them again. See [Quantity and price](opex.md#quantity-and-price)
- The file holds amounts only. The lines of a column are managed in the Budget tab
- A row that only changes the period updates the period and keeps the rest
- Actuals rows follow the same rules, which lets you import monthly actuals
- A changed row on a frozen column is refused. An identical row on a frozen column is accepted
- Rows for a hidden column are imported like any other row. Hiding a column never blocks its imports, and a hidden frozen column still refuses changed rows
- Repeated rows (same item, year and column), unknown item numbers, and items of a type you cannot administer are errors
- Importing needs administration rights on OPEX or on CAPEX. Exporting needs read access to either

---

## Budget columns

Name the five budget columns, choose which ones everyone sees, and which one reports and lists start from. The setting applies to the whole organisation, for OPEX and CAPEX alike.

### When to use it

- Your budget rounds have their own names, for example A0, A1, A2 and Actual
- Your organisation does not use every column and wants a lighter screen
- Reports and lists should start from a column other than Budget

### The table

One row per column, always in the same order, from column 1 to column 5. The standard names are Budget, Revision, Forecast, Actuals and Expected landing.

| Field | Description |
|-------|-------------|
| **Column** | The position, 1 to 5. Columns cannot be reordered |
| **Name** | The name everyone sees in lists, the Budget tab, reports, the overview and Budget administration. Leave it empty to use the standard name, shown as a placeholder. At most 40 characters, with no control or invisible characters. Each name must differ from the other columns' names, including the standard name of a column you have not renamed, whatever the capitals |
| **In files** | The line under each name. It gives the technical name of the column in the budget rows file and its imports, for example `planned` for column 1. It never changes when you rename a column |
| **Shown** | Whether the column appears on screen. At least one column must stay shown |
| **Follows "Apply to all columns"** | Whether the column takes the same period when a spread in the Budget tab is applied to all columns. A column that does not follow keeps its own period, and when you spread it, it spreads alone |
| **Default** | The column that reports preselect and that sorts the lists and the overview. Freezing it fixes the year's exchange rates. The default column must be shown |

The **Follows "Apply to all columns"** and **Default** headers carry an info icon. Hover over it, or move the keyboard focus to it, to read the same explanation on the page.

By default, Budget, Revision, Actuals and Expected landing are shown and Forecast is hidden, every column follows "Apply to all columns", and Budget is the default column.

### What the settings change

- **Hidden columns** leave the lists, the column chooser, the Budget tab, the report pickers, the copy and reset pages and the overview. They keep their amounts: hiding a column never clears data, and showing it again brings the amounts back. Hidden columns still accept imports through the budget rows file, and freezes still apply to them. The freeze page lists hidden columns too, marked **Hidden**, so freezing a year freezes them along with the others
- **The default column** is preselected in every report. It sorts the OPEX and CAPEX lists, their previous and next navigation, and the **Top items** and **Top increases** tiles of the overview. The lists show it for the current year, next to the last shown column. It is also the reference amount of the Allocations tab and the column the spread panel opens on. Freezing it for a year fixes that year's exchange rates (see [Freezing the default column fixes the exchange rates](#freezing-the-default-column-fixes-the-exchange-rates))
- **Follows "Apply to all columns"** decides which columns move together when a spread is applied to all columns. Frozen columns never change, whatever this setting says

### Saving

Click **Save** to apply your changes. The button stays disabled until something changed and every name is valid. **Reset** discards the changes you have not saved yet. Mistakes are explained under the field or the table, for example "At least one column must stay shown." or "The default column must be shown: choose another default column first." To hide the current default column, choose another default column first. Both changes can be saved together.

### Permissions

Changing the settings needs Budget administration admin rights (`budget_ops:admin`). Everyone else can open the page and see the settings, read-only, under the banner "Only budget administrators can change this page."

If the settings cannot be loaded, the page shows one line, "The column settings could not be loaded.", and no controls.

---

## Workflow Example: Annual Budget Cycle

Here is a typical sequence using these tools, with the standard column names and Budget as the default column:

### 1. End of Year N

1. Freeze Year N Actuals (protect historical data)
2. Copy N Budget to N+1 Budget (with a percentage increase for inflation)
3. Copy N Allocations to N+1

### 2. During Budget Planning (N+1)

1. Teams edit the N+1 Budget column
2. CFO reviews and approves

### 3. Budget Approval

1. Freeze N+1 Budget (lock the approved budget and fix the year's exchange rates)
2. Copy N+1 Budget to N+1 Revision (starting point for in-year tracking)

### 4. Mid-Year Revision

1. Teams update N+1 Revision with forecast changes
2. When finalized, freeze N+1 Revision

---

## Tips

- **Always dry-run first**: Copy Budget Columns and Copy Allocations both support a dry run. Use it every time to verify the outcome before committing.
- **Freeze after approval**: Locking columns after approval maintains your audit trail and prevents accidental edits.
- **Use percentage adjustments**: When copying between years, apply an inflation or growth factor so you do not have to adjust every line manually.
- **Check freeze status before bulk operations**: Frozen columns block copy and reset operations. If a button is greyed out, check the freeze page first.
- **Set the year's default before entering budgets**: If your allocation basis is not headcount, configure it in Default Allocation Method first, so items are created on the right basis instead of being re-driven later.
- **Reset with caution**: Column reset is irreversible. Double-check the year and column before confirming.
