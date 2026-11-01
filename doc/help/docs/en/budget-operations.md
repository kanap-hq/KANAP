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
| **Default allocation method** | Set the method OPEX and CAPEX lines follow by default |

**Operations**

| Tool | Purpose |
|------|---------|
| **Freeze / unfreeze data** | Lock budget columns to prevent changes |
| **Copy budget columns** | Copy amounts between years and columns, with an optional percentage, and allocations to another year |
| **Reset budget column** | Clear all data from a specific column |
| **Freeze master data** | Lock company and department metrics for a year. See [Freeze master data and copy yearly metrics](master-data-operations.md) |
| **Copy yearly metrics** | Copy company and department metrics from one year to another. See [Freeze master data and copy yearly metrics](master-data-operations.md) |

| Cards | Who sees them |
|---|---|
| Currencies, Budget columns, Default allocation method, Freeze / unfreeze data | Budget administration at admin level (`budget_ops:admin`) |
| Copy budget columns, Reset budget column | Budget at admin level (`budget:admin`). The **All**, **OPEX** and **CAPEX** tabs all open with it |
| Freeze master data, Copy yearly metrics | Users with access to the budget who are admins of Budget administration, companies or departments. Company and department admins act on their own scope |

The built-in Budget Administrator role sees every card. Budget Member and Budget Reader see none, so **Administration** is not in their menu.

The budget columns are Budget, Revision, Forecast, Actuals and Expected landing. These are the standard names. Your organisation can rename them, hide some and choose a default column in [Budget columns](#budget-columns). Every page below shows the names your organisation chose.

While one of these operations is running, budget lines cannot be saved: an edit shows the message "Another budget operation is running. Try again when it has finished." until the operation completes.

---

## Freeze / Unfreeze Data

Lock budget columns so they cannot be edited, imported into, or modified in any way. Freezing protects approved figures from accidental changes.

### When to use it

- After the annual budget is approved
- When closing a fiscal period
- To protect actuals from being modified

### How it works

The page shows one year at a time. Pick it with the year tabs at the top, from last year to four years ahead.

Below the tabs, a table has one row per budget column and one column per type, **OPEX** and **CAPEX**. Hidden columns are listed too, marked **Hidden**. Each cell shows the state of that column for that type, **Open** or **Frozen**, with a lock icon:

- Click a cell to switch it. One click freezes or unfreezes that column for that type
- The action at the end of a row acts on both types at once. It reads **Freeze both** while one of the two cells is open, and freezes the open one. Once both are frozen, it reads **Unfreeze both**
- A cell stays disabled while its change is saving. The year tabs wait for every change to finish

Without the Admin level on Budget administration, the page shows the states read only, with the message "You need budget administrator rights to use this page."

### What freezing does

- Prevents edits to frozen columns in the workspace of the lines of that type. The inputs show a lock icon
- Blocks imports to frozen columns
- Blocks copy and reset operations targeting frozen columns
- Refuses to delete a line, or to change its type, while it has amounts in a frozen column of the years concerned
- Does **not** affect read access: data remains visible
- Applies to hidden columns too. A frozen column stays frozen when it is hidden, and imports into it are still refused

### Lock icons in the list

The single **Total** row of [the budget lines list](budget-lines.md#working-with-the-list) shows a lock icon before the total of a frozen column. It follows the freeze of each type the list holds. When the list is filtered on one type, the lock shows when that type is frozen. When it holds both types, the lock shows when the column is frozen for both. Hover the icon to read **Frozen**.

### Freezing the default column fixes the exchange rates

Freezing the [default column](#budget-columns) for a year also fixes that year's exchange rates for the type you freeze. KANAP refreshes the rates for the year, then keeps the latest set for every OPEX or CAPEX amount of that year. Reports then convert those amounts with the same rates, even when newer rates arrive. If the reporting currency changes later, these amounts keep the frozen rates, then convert into the new reporting currency at that year's rate of the former one. Without that rate, they are left out of the totals and named like any missing rate. See [Frozen years](currencies.md#frozen-years). Unfreezing the default column releases them.

Freezing another column does not touch the rates. Changing the default column later does not fix or release anything by itself: the rates follow the next freeze or unfreeze of the new default column. **Freeze both** freezes only the open cell, so a type whose default column is already frozen keeps the rates it fixed.

### Permissions

Freezing and unfreezing need `budget_ops:admin`. The card is hidden from other users.

---

## Copy Budget Columns

Copy the amounts of a column to another year or column, with an optional percentage, and the allocations of a year to another year. This is the primary tool for seeding next year's budget from the current one.

The **All** / **OPEX** / **CAPEX** tabs at the top choose which lines the copy runs on. **All**, the default, copies the OPEX and CAPEX lines together.

Needs the Admin level on Budget (`budget:admin`).

### When to use it

- Preparing next year's budget, amounts and allocations, from the current year
- Creating a revision from the approved budget
- Rolling forward projections with an inflation factor

### Fields

| Field | Description |
|-------|-------------|
| **Source year** | Year to copy from (range: current year minus one through current year plus five). Starts on the current year |
| **Destination year** | Year to copy to (same range). Starts on next year |
| **To copy** | **Amounts**, **Allocations**, or both. **Allocations** is offered when the two years differ, and starts ticked. Hover each checkbox to read what it copies |
| **Source column** | With **Amounts**: any shown column, Forecast included when it is shown. Starts on the default column |
| **Destination column** | With **Amounts**: any shown column. Starts on the default column |
| **Percentage increase** | With **Amounts**: adjustment applied to every copied month (e.g., `3` = +3%). On a column calculated from its lines, it raises the unit price of each line instead. See [Copying a column built from lines](#copying-a-column-built-from-lines). Defaults to 0. Accepts decimals and negative values. A percentage of -100% or less is refused |
| **Overwrite existing data** | A switch for both parts. Off: a destination column that already has amounts keeps them, and an allocation entered by hand in the destination year is kept. On: both are replaced |

Hidden columns are not offered. With nothing ticked under **To copy**, the page reads "Choose what to copy: the amounts, the allocations or both."

### Two steps: Preview, then Copy

1. Click **Preview** to see what the copy does on each line, without changing any data
2. Review the table, one row per line:
   - **Line**: the line's name, a link that opens it in a new tab so the preview stays in place. Lines marked **Prorated** start or end during the destination year and get only the months within their validity. Lines marked **Calendar** change calendar (see below)
   - **Line type**: **OPEX** or **CAPEX**, on the **All** tab
   - For the amounts: the source column, the current destination column, the destination column after the copy, and the status of the amounts
   - For the allocations: the source allocation, the current destination allocation, the allocation after the copy, and the status of the allocations
3. When you are satisfied, click **Copy** to apply

**Copy** is enabled only after a preview. Changing any field drops the preview: run it again. After the copy, the table stays on screen under the title **Result**, with what each line did.

**Export table** (download icon) downloads the preview of the fields on screen as a CSV or Excel file, one row per line, with the columns and statuses of the table. After the copy, the export is disabled: the table then shows what the copy did, which a preview no longer describes. Amounts in the file carry their cents.

Each part has its own status on each line:

| Status | Meaning |
|---|---|
| **To copy** / **Copied** | The part is copied, or was copied |
| **Replaces Headcount** / **Replaced Headcount** | The allocation of the destination year follows another method, which the copied allocation replaces |
| **Not valid in 2027** | The line is not valid in the destination year. It is left out |
| **Skipped: nothing in 2026** | The line has no budget in the source year |
| **Skipped: the source column is empty** | The source column has no amount |
| **Skipped: the destination has amounts** | The destination column already has amounts, and **Overwrite existing data** is off |
| **Skipped: no allocation entered in 2026** | The line has no allocation to copy in the source year |
| **Skipped: 2027 has an allocation entered by hand** | The destination year has an allocation entered by hand, and **Overwrite existing data** is off |
| **Error** | The allocation rules of the line refuse the copy, with the reason. **Copy** stays disabled while a line has an error |

### Summary

Above the table, a banner sums up the preview, for example "136 lines in the preview. 6 lines not valid in 2027 are left out. Amounts: 120 to copy, 10 skipped. Allocations: 124 to copy, 6 skipped." The line count matches the table. The lines not valid in the destination year are in it, and the amounts and allocations counts leave them out. After the copy it reads "Copy done." with the same counts.

Warnings show when they apply:

- Lines whose destination column already has an amount, and will be skipped without **Overwrite existing data**
- Lines that keep an allocation entered by hand in the destination year, without **Overwrite existing data**
- Lines whose allocation method changes in the destination year. Without **Overwrite existing data**, the copy keeps only the allocations entered by hand: a line that follows a method, with no split typed by hand, takes the method of the source year
- Lines left on the default allocation, when the destination year's default differs from the source year's. Copied lines keep following the default of their own year. Configure it in [Default allocation method](#default-allocation-method) if the basis should stay the same

Under the table, the totals show the number of lines, the amounts to copy, the source total, the current destination total and the total after the copy, and the allocations to copy.

### How amounts are copied

- The copy keeps the monthly shape. Each of the twelve months is copied to the same month of the destination, so a column spread from April to December stays April to December
- This part describes columns whose amounts are typed, spread or copied, and the months of reference lines. A column calculated from its lines follows [its own rules](#copying-a-column-built-from-lines)
- Only lines valid in the destination year are copied. A line counts for the months whose 15th falls between its **Effective start** and its **End of validity**. A line without such a month is left out, as the Budget tab does not show it either
- A line valid for part of the destination year gets only those months. The other months keep their amount, and the period is cut to the line's dates. For example, a twelve-month source copied to a line ending on June 30 gives January to June
- Without a percentage, amounts are copied exactly, to the cent
- With a percentage, each month is rounded to a whole amount, and the year total stays the source total with the percentage applied, rounded to a whole amount. The units left over by the rounding go to the months that dropped the largest fractions, the latest month first on a tie. No month changes sign. For example, 12,000 spread from April to December (1,333.33 a month and 1,333.36 in December) copied with +2% gives 1,360 a month and 12,240 for the year
- The column's period moves with the copy: April to December 2026 becomes April to December 2027. A period that ends on February 29 ends on February 28 in a year without one
- A source without a period gives a whole-year period
- In the Budget tab, the destination column shows "Copied from Budget 2026 +2%"
- Copying a column onto itself (same year and same column) is refused
- The copy is all or nothing: if one line fails, nothing is saved, amounts or allocations

### Copying a column built from lines

A column can be built from lines, each a quantity times a unit price. See [Quantity and price](budget-lines.md#quantity-and-price). The copy treats such a column in one of two ways.

**The amounts are calculated from the lines.** The column stays calculated from its lines in the destination.

- The percentage increase raises the unit price of each line, rounded to 4 decimals. Quantities do not change
- The months are recalculated from the lines with the working-day calendars of the destination year. The copied total can differ slightly from the source total with the percentage applied, because the number of working days changes from one year to the next
- The lines move to the destination year with their description, quantity, unit, how often and calendar. Their periods move like the column's period: March to December 2026 becomes March to December 2027, and a line that ends on February 29 ends on February 28 in a year without one. A piece bought once on March 15, 2026 is bought on March 15, 2027. The FTE is recalculated from the lines
- A line kept for only part of the destination year, because of the line's validity, is cut to that period. A line left with no month is dropped
- The column shows its lines as usual in the Budget tab. It has no "Copied from" label

**The lines are only a reference.** This is the case when the source amounts were typed by hand, spread, or copied.

- The percentage increase applies to the months, as for any other column. The unit prices of the lines do not change
- The lines move to the destination year with their description, quantity, unit, how often and calendar, and their periods move like the column's period. A line kept for only part of the destination year, because of the line's validity, is cut to that period, and a line left with no month is dropped
- The FTE is recalculated from the copied lines with the working-day calendars of the destination year
- In the Budget tab, the destination column shows "Copied from Budget 2026", and its editor reads, for example, "4 lines kept as a reference (48,000). Use the lines again."
- The copied lines are a read-only reference. Click **Use the lines again** to compute the column from them at their current prices. To plan the destination year at its own prices, change the unit prices after that: each change computes the column again

A copy from a column without lines leaves the destination without lines, and its FTE becomes blank.

#### Calendars without days for the destination year

A line priced per day needs a calendar that holds the destination year. When the calendar of a line has no working days for that year, the copy uses the company standard calendar of the country of the line's paying company instead. This is the calendar created with the company. This holds for a column built from lines and for a column whose lines are only a reference. If there is none, the line is copied the usual way: months times the percentage. The lines are kept unchanged as a reference, and the FTE stays the FTE of the source column.

The preview flags these lines with a **Calendar** note, with a tooltip for each line, and shows a warning above the table. The preview also reports a line for which no replacement calendar exists. To copy anyway, tick **Copy anyway with these calendar changes**. The better fix is to add the year's days on the **Working-day calendars** page, then run the preview again.

A disabled calendar is still used. The preview notes it and asks for no confirmation.

### Copying allocations

**Allocations** copies each line's allocation method from the source year to the destination year, with any split entered by hand (the companies or departments picked, the percentages typed). Only lines valid in the destination year are copied, with the same rule as the amounts.

- A line left on the default allocation stays on the default: in the destination year, it follows the default of that year
- Without **Overwrite existing data**, a line keeps the allocation entered by hand in the destination year. A line whose destination year follows a method with no split typed by hand takes the source allocation, and the preview says which method it replaces, for example "Replaces Headcount"
- With **Overwrite existing data**, every copied allocation replaces the destination one

### Frozen column protection

When the copy includes the amounts and the destination column is frozen, **Preview** and **Copy** are disabled and an error banner tells you to unfreeze first. On the **All** tab, when the column is frozen for one type only, the banner names it, for example "The 2027 Budget column is frozen for CAPEX. Unfreeze it, or copy the other type only." The allocations alone are not affected by freezes.

---

## Reset Budget Column

Clear all data from a specific budget column for a given year. This is a destructive operation: use it when you need to start fresh.

The **All** / **OPEX** / **CAPEX** tabs at the top choose which lines are cleared. **All**, the default, clears the OPEX and CAPEX lines together. The reset sets the twelve months of the column to zero and removes its period, and its lines when the column was built from quantity and price. In the Budget tab, the column then gets a new suggestion from the line's dates. The reset covers every line, including lines whose end of validity has passed. The reset is all or nothing: if one line fails, nothing is cleared.

Needs the Admin level on Budget (`budget:admin`).

A column whose lines hold no amount can still be reset: the reset then only removes the spread periods, and the confirmation says so.

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

Before you choose a column, one line replaces the grid: "Choose a column to see the amounts it holds." Once you choose a column, a grid shows every line of the chosen type and its current value in that column. The line's name opens it in a new tab, and on the **All** tab a **Line type** column says **OPEX** or **CAPEX**. Amounts that will be cleared are shown in medium weight; empty values are muted. Below the grid, three stats appear:

- **Total lines**
- **Lines with a non-zero total**
- **Current total value**

**Export table** (download icon) downloads the grid as a CSV or Excel file: the lines of the chosen type and their current value in the chosen column.

### Confirmation

Clicking **Clear column** opens a confirmation dialog that shows:

- The column and year being reset
- The number of lines affected
- The total value being deleted
- A clear warning that this action cannot be undone

You must click **Clear column** in the dialog to proceed, or **Cancel** to abort.

### Safety features

- The **Clear column** button stays available when no line has an amount, so the spread periods can still be removed
- No column is preselected, so you always choose the column to clear
- Frozen columns cannot be reset. Unfreeze them first. On the **All** tab, when the column is frozen for one type only, the message names it, for example "The 2026 Budget column is frozen for CAPEX. Unfreeze it before clearing data, or clear the other type only."
- The confirmation dialog requires explicit acknowledgement

---

## Default Allocation Method

Set the method that OPEX lines and CAPEX investments follow when they are left on the default allocation. The setting is per fiscal year: each year resolves its own default, so you can change the basis for one year without touching the others.

### When to use it

- Your chargeback model is not headcount-based (for example revenue-driven)
- The IT budget is carried by one entity and must not be spread over every subsidiary
- You want new lines to follow a shared basis without editing them one by one
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
- The page shows the resulting split, so you can check the effect before relying on it. The **Driver value** column shows each company's value. A turnover shows with the company's base currency, for example **35 M USD**, and the split uses it converted to the reporting currency, as in the [Allocations tab](budget-lines.md#allocations). When a currency has no rate for the year, the companies in that currency are left out of the split: they get no share, the other selected companies share 100%, and a warning above the split names each company left out
- A single selected company always takes **100%**, with no driver value required
- With two companies or more, every selected company needs a value for the chosen driver. A company without one is rejected when you save. Fix the company metrics in **Master Data > Companies** first
- A company disabled for the year cannot be selected: disabled companies are excluded from that year's allocations

### What it affects

- Every OPEX line and CAPEX investment whose allocation method is **default**, shown as *Headcount (default)* (or *Default (n companies)*) in the Allocations tab until an organisation default is set
- Lines with an explicit method (Headcount, IT Users, or Turnover pinned on the line) or a manual allocation keep their own setting
- Allocated amounts are recomputed the next time allocations are displayed. Budget amounts themselves are never modified

### Standard method

Until an organisation configures a default, the standard applies: **Headcount** over every company enabled for the year. The page always shows whether the year is on the standard or on a configured default, and what the standard method is.

### Changing the default after the fact

The default is resolved every time allocations are displayed, so editing it re-drives every line left on the default. If a company included in the selection later loses its driver value or is disabled, the affected lines show an error instead of a silently rebalanced split. The page warns you about the current selection.

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
| **Follows the spread and the lines** | Whether the column starts ticked in **Use for other columns too…** on the Budget tab, which gives other columns the period and distribution of an amount, or the quantity and price lines. You can still tick or untick each column there |
| **Default** | The column that reports preselect and that sorts the lists and the overview. Freezing it fixes the year's exchange rates. The default column must be shown |

The **Follows the spread and the lines** and **Default** headers carry an info icon. Hover over it, or move the keyboard focus to it, to read the same explanation on the page.

By default, Budget, Revision, Actuals and Expected landing are shown and Forecast is hidden, every column follows the spread and the lines, and Budget is the default column.

### What the settings change

- **Hidden columns** leave the lists, the column chooser, the Budget tab, the report pickers, the copy and reset pages and the overview. They keep their amounts: hiding a column never clears data, and showing it again brings the amounts back. Hidden columns still accept imports through the budget file, and freezes still apply to them. The freeze page lists hidden columns too, marked **Hidden**, so you can freeze them like the others
- **The default column** is preselected in every report. It sorts the budget lines list and its previous and next navigation. The **Top lines** tile, ranked by **Amount** or by **Increase**, and the **My budget** and **By cost center** tiles of the overview use it. The list shows it for the current year, next to the last shown column. It is also the reference amount of the Allocations tab and the column the **Difference with** row of the Budget tab starts on. Freezing it for a year fixes that year's exchange rates (see [Freezing the default column fixes the exchange rates](#freezing-the-default-column-fixes-the-exchange-rates))
- **Follows the spread and the lines** decides which columns start ticked when you use **Use for other columns too…** on the Budget tab. Frozen columns are never offered, whatever this setting says

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
2. Copy N Budget to N+1 Budget, with the allocations (one run of **Copy budget columns**, with a percentage increase for inflation)

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

- **Always preview first**: **Copy budget columns** shows what it does on each line before you copy. Check it every time before committing.
- **Freeze after approval**: Locking columns after approval maintains your audit trail and prevents accidental edits.
- **Use percentage adjustments**: When copying between years, apply an inflation or growth factor so you do not have to adjust every line manually.
- **Check freeze status before bulk operations**: Frozen columns block copy and reset operations. If a button is greyed out, check the freeze page first.
- **Set the year's default before entering budgets**: If your allocation basis is not headcount, configure it in Default Allocation Method first, so lines are created on the right basis instead of being re-driven later.
- **Reset with caution**: Column reset is irreversible. Double-check the year and column before confirming.
