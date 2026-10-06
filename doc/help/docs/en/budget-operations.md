# Budget Administration

Budget Administration gives you a set of tools for managing and transforming budget data across years and columns. These are the operations you reach for during budget planning cycles: preparing next year's numbers, locking approved budgets, and managing year-over-year transitions.

## Where to find it

- Path: **Budget Management > Administration**
- Permissions: each card shows only to the users who can use it (see the table below). **Administration** appears in the menu when you can use at least one card.

The landing page has two sections. Each card links to a dedicated tool. An empty section is hidden.

**Settings**

| Tool | Purpose |
|------|---------|
| **Currencies** | Set the reporting and default currencies, and review the FX rates. See [Currency Settings](currencies.md) |
| **Budget columns** | Name the five budget columns, choose which ones are shown and which one is the default |
| **Default allocation method** | Set the method OPEX and CAPEX items follow by default |

**Operations**

| Tool | Purpose |
|------|---------|
| **Freeze / unfreeze data** | Lock budget columns to prevent changes |
| **Copy budget columns** | Copy data between years and columns with adjustments |
| **Copy allocations** | Copy allocation methods from one year to another |
| **Reset budget column** | Clear all data from a specific column |
| **Freeze master data** | Lock company and department metrics for a year. See [Freeze master data and copy yearly metrics](master-data-operations.md) |
| **Copy yearly metrics** | Copy company and department metrics from one year to another. See [Freeze master data and copy yearly metrics](master-data-operations.md) |

| Cards | Who sees them |
|---|---|
| Currencies, Budget columns, Default allocation method, Freeze / unfreeze data | Budget administration at admin level (`budget_ops:admin`) |
| Copy budget columns, Copy allocations, Reset budget column | OPEX or CAPEX at admin level. The OPEX and CAPEX tabs follow the same rule: an OPEX administrator works on OPEX items only |
| Freeze master data, Copy yearly metrics | Users with access to the budget who are admins of Budget administration, companies or departments. Company and department admins act on their own scope |

The built-in Budget Administrator role sees every card. Budget Member and Budget Reader see none, so **Administration** is not in their menu.

The budget columns are Budget, Revision, Forecast, Actuals and Expected landing. These are the standard names. Your organisation can rename them, hide some and choose a default column in [Budget columns](#budget-columns). Every page below shows the names your organisation chose.

While one of these operations is running, OPEX and CAPEX items cannot be saved: an edit shows the message "Another budget operation is running. Try again when it has finished." until the operation completes.

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

Freezing and unfreezing need `budget_ops:admin`. The card is hidden from other users.

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
| **Percentage increase** | Adjustment applied to every copied month (e.g., `3` = +3%). On a column calculated from its lines, it raises the unit price of each line instead. See [Copying a column built from lines](#copying-a-column-built-from-lines). Defaults to 0. Accepts decimals and negative values. A percentage of -100% or less is refused. |
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
- This part describes columns whose amounts are typed, spread or copied, and the months of reference lines. A column calculated from its lines follows [its own rules](#copying-a-column-built-from-lines)
- Only items valid in the destination year are copied. An item counts for the months whose 15th falls between its **Effective start** and its **End of validity**. An item without such a month is left out, as the Budget tab does not show it either
- An item valid for part of the destination year gets only those months. The other months keep their amount, and the period is cut to the item's dates. For example, a twelve-month source copied to an item ending on June 30 gives January to June
- Without a percentage, amounts are copied exactly, to the cent
- With a percentage, each month is rounded to a whole amount, and the year total stays the source total with the percentage applied, rounded to a whole amount. The units left over by the rounding go to the months that dropped the largest fractions, the latest month first on a tie. No month changes sign. For example, 12,000 spread from April to December (1,333.33 a month and 1,333.36 in December) copied with +2% gives 1,360 a month and 12,240 for the year
- The column's period moves with the copy: April to December 2026 becomes April to December 2027. A period that ends on February 29 ends on February 28 in a year without one
- A source without a period gives a whole-year period
- In the Budget tab, the destination column shows "Copied from Budget 2026 +2%"
- Copying a column onto itself (same year and same column) is refused
- The copy is all or nothing: if one item fails, nothing is saved

### Copying a column built from lines

A column can be built from lines, each a quantity times a unit price. See [Quantity and price](opex.md#quantity-and-price). The copy treats such a column in one of two ways.

**The amounts are calculated from the lines.** The column stays calculated from its lines in the destination.

- The percentage increase raises the unit price of each line, rounded to 4 decimals. Quantities do not change
- The months are recalculated from the lines with the working-day calendars of the destination year. The copied total can differ slightly from the source total with the percentage applied, because the number of working days changes from one year to the next
- The lines move to the destination year with their description, quantity, unit, how often and calendar. Their periods move like the column's period: March to December 2026 becomes March to December 2027, and a line that ends on February 29 ends on February 28 in a year without one. A piece bought once on March 15, 2026 is bought on March 15, 2027. The FTE is recalculated from the lines
- A line kept for only part of the destination year, because of the item's validity, is cut to that period. A line left with no month is dropped
- The column shows its lines as usual in the Budget tab. It has no "Copied from" label

**The lines are only a reference.** This is the case when the source amounts were typed by hand, spread, or copied.

- The percentage increase applies to the months, as for any other column. The lines are copied as they are, with their unit prices and their FTE
- In the Budget tab, the destination column shows "Copied from Budget 2026", and its **Quantity and price** tab says "Amounts were copied from Budget 2026. Use the lines again."
- The copied lines are a read-only reference. Click **Use the lines again** on the **Quantity and price** tab to compute the column from them at their current prices. To plan the destination year at its own prices, change the unit prices after that: each change computes the column again

A copy from a column without lines leaves the destination without lines, and its FTE becomes blank.

#### Calendars without days for the destination year

A line priced per day needs a calendar that holds the destination year. When the calendar of a line has no working days for that year, the copy uses the company standard calendar of the country of the item's paying company instead. This is the calendar created with the company. If there is none, the item is copied the usual way: months times the percentage, with the lines kept unchanged as a reference.

The dry run flags these items with a **Calendar** note, with a tooltip for each line, and shows a warning above the preview. To copy anyway, tick **Copy anyway with these calendar changes**. The better fix is to add the year's days on the **Working-day calendars** page, then run the dry run again.

A disabled calendar is still used. The dry run notes it and asks for no confirmation.

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

Changing the default needs `budget_ops:admin`. The card is hidden from other users.

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
| **In files** | The line under each name. It gives the technical name of the column in the budget file and its imports, for example `budget` for column 1. It never changes when you rename a column. See [Load a budget from a spreadsheet](budget-file.md) |
| **Shown** | Whether the column appears on screen. At least one column must stay shown |
| **Follows the spread and the lines** | Whether the column takes what is applied to all columns on the Budget tab: the distribution and period of a spread (**Apply the distribution to all columns**), and the quantity and price lines (**Apply these lines to all columns**). A column that does not follow keeps its own: when you spread it or edit its lines, it changes alone |
| **Default** | The column that reports preselect and that sorts the lists and the overview. Freezing it fixes the year's exchange rates. The default column must be shown |

The **Follows the spread and the lines** and **Default** headers carry an info icon. Hover over it, or move the keyboard focus to it, to read the same explanation on the page.

By default, Budget, Revision, Actuals and Expected landing are shown and Forecast is hidden, every column follows the switches of the Budget tab, and Budget is the default column.

### What the settings change

- **Hidden columns** leave the lists, the column chooser, the Budget tab, the report pickers, the copy and reset pages and the overview. They keep their amounts: hiding a column never clears data, and showing it again brings the amounts back. Hidden columns still accept imports through the budget file, and freezes still apply to them. The freeze page lists hidden columns too, marked **Hidden**, so freezing a year freezes them along with the others
- **The default column** is preselected in every report. It sorts the OPEX and CAPEX lists, their previous and next navigation, and the **Top items** and **Top increases** tiles of the overview. The lists show it for the current year, next to the last shown column. It is also the reference amount of the Allocations tab and the column the spread panel opens on. Freezing it for a year fixes that year's exchange rates (see [Freezing the default column fixes the exchange rates](#freezing-the-default-column-fixes-the-exchange-rates))
- **Follows the spread and the lines** decides which columns move together when a spread is applied to all columns, and which columns take the lines when **Apply these lines to all columns** is on. Frozen columns never change, whatever this setting says

### Saving

Click **Save** to apply your changes. The button stays disabled until something changed and every name is valid. **Reset** discards the changes you have not saved yet. Mistakes are explained under the field or the table, for example "At least one column must stay shown." or "The default column must be shown: choose another default column first." To hide the current default column, choose another default column first. Both changes can be saved together.

### Permissions

Changing the settings needs Budget administration admin rights (`budget_ops:admin`). The card is hidden from other users.

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
