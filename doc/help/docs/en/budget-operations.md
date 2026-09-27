# Budget Administration

Budget Administration gives you a set of tools for managing and transforming budget data across years and columns. These are the operations you reach for during budget planning cycles -- preparing next year's numbers, locking approved budgets, and managing year-over-year transitions.

## Where to find it

- Path: **Budget Management > Administration**
- Permissions: Most operations require `budget_ops:admin`

The landing page shows six cards, each linking to a dedicated tool:

| Tool | Purpose |
|------|---------|
| **Freeze / Unfreeze Data** | Lock budget columns to prevent changes |
| **Copy Budget Columns** | Copy data between years and columns with adjustments |
| **Copy Allocations** | Copy allocation methods from one year to another |
| **Reset Budget Column** | Clear all data from a specific column |
| **Default Allocation Method** | Set the method OPEX and CAPEX items follow by default |
| **Budget rows file** | Export or import the monthly amounts of every OPEX and CAPEX line |

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
3. **Select columns** for each scope: Budget, Revision, Forecast, Actuals, Expected landing (all five are selected by default)
4. Click **Freeze Data** to lock, or **Unfreeze Data** to unlock

### What freezing does

- Prevents edits to frozen columns in OPEX and CAPEX workspaces
- Blocks CSV imports to frozen columns
- Blocks copy and reset operations targeting frozen columns
- Does **not** affect read access -- data remains visible

### Current status

Below the controls, two cards show the real-time freeze state for every column in OPEX and CAPEX. Each column displays either **Frozen** (in red) or **Editable**.

### Permissions

Without `budget_ops:admin` you can still view the freeze status, but the controls are disabled. An info banner explains what is needed.

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
| **Source Year** | Year to copy from (range: current year minus one through current year plus five) |
| **Source Column** | Budget, Revision, Actuals, or Expected landing |
| **Destination Year** | Year to copy to (same range) |
| **Destination Column** | Budget, Revision, Actuals, or Expected landing |
| **Percentage Increase** | Adjustment applied to every copied month (e.g., `3` = +3%). Defaults to 0. Accepts decimals and negative values. |
| **Overwrite existing data** | Toggle. When off, items that already have a value in the destination are skipped. When on, all destination values are replaced. |

### Two-step process: Dry Run, then Copy

1. Click **Dry Run** to generate a preview without changing any data
2. Review the preview grid, which shows:
   - **Item** name (items marked **Skipped** keep their current value)
   - **Source value** (from the source year/column)
   - **Current destination value**
   - **Preview value** (what the destination will become after copy)
3. When you are satisfied, click **Copy Data** to apply

The **Copy Data** button is only enabled after a successful dry run.

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
- Without a percentage, amounts are copied exactly, to the cent
- With a percentage, each month is rounded to a whole amount. The yearly total is the source total with the percentage applied, rounded to a whole amount. The small difference lands on the last month that has an amount. For example, 12,000 spread from April to December (1,333.33 a month and 1,333.36 in December) copied with +2% gives 1,360 a month and 12,240 for the year
- The column's period moves with the copy: April to December 2026 becomes April to December 2027. A period that ends on February 29 ends on February 28 in a year without one
- A source without a period gives a whole-year period
- In the Budget tab, the destination column shows "Copied from Budget 2026 +2%"
- Copying a column onto itself (same year and same column) is refused
- The copy is all or nothing: if one item fails, nothing is saved

### Frozen column protection

If the destination column is frozen, both **Dry Run** and **Copy Data** are disabled. An error banner tells you to unfreeze first.

---

## Copy Allocations

Copy allocation methods and percentages from one year to another for all OPEX items. This saves you from re-entering chargeback configurations when setting up a new fiscal year.

### When to use it

- Preparing next year's budget with the same cost allocations
- Rolling forward chargeback configurations
- Setting up a new fiscal year

### Fields

| Field | Description |
|-------|-------------|
| **Source Year** | Year to copy allocations from (range: current year minus one through current year plus five) |
| **Destination Year** | Year to copy allocations to (same range). Must differ from Source Year. |
| **Overwrite existing data** | Toggle. When off, items that already have allocations in the destination are skipped. |

### Two-step process: Dry Run, then Copy

1. Click **Dry Run** to see a preview
2. The preview grid shows each OPEX item with:
   - **Product** name
   - **Action** -- what will happen (Will copy, Skip -- no source year, Skip -- no allocations in source, Skip -- destination has data, Error)
   - **Source** method and label
   - **Destination** current method and label
   - **Result after copy** -- what the destination will look like
3. Click **Copy Data** to apply

### Validation

- Source and destination years must be different. If they match, a warning banner appears and both buttons are disabled.
- Changing any filter clears the preview, requiring a fresh dry run.

### Summary

After a dry run, a banner shows the count of items ready to copy, skipped, and errored. If items were skipped because the destination already has allocations, a separate warning suggests enabling overwrite.

---

## Reset Budget Column

Clear all data from a specific budget column for a given year. This is a destructive operation: use it when you need to start fresh.

The **OPEX** / **CAPEX** switch at the top chooses which items are cleared. The reset sets the twelve months of the column to zero and removes its period. In the Budget tab, the column then gets a new suggestion from the item's dates. The reset is all or nothing: if one item fails, nothing is cleared.

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
| **Budget Column** | Budget, Revision, Actuals, or Expected landing |

### Preview

The page loads a grid showing every OPEX or CAPEX item and its current value in the selected column. Amounts that will be cleared are shown in medium weight; empty values are muted. Below the grid, three stats appear:

- **Total items**
- **Items with a non-zero total**
- **Current total value**

### Confirmation

Clicking **Clear Column** opens a confirmation dialog that shows:

- The column and year being reset
- The number of items affected
- The total value being deleted
- A clear warning that this action cannot be undone

You must click **Clear Column** in the dialog to proceed, or **Cancel** to abort.

### Safety features

- The **Clear Column** button stays available when no item has an amount, so the spread periods can still be removed
- Frozen columns cannot be reset -- unfreeze first
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
2. **Pick the company scope** -- *All enabled companies*, or *Selected companies* and then the companies themselves
3. **Pick the driver** that weights the companies (Headcount, IT Users, or Turnover)
4. Every change saves immediately, there is no Save button
5. To return to the standard, click **Use the standard method** (shown only while a custom default is configured)

### Selected companies

- The driver is applied to the selected companies only: their percentages are computed from their own headcount, IT users or turnover for the year
- The page shows the resulting split, so you can check the effect before relying on it
- A single selected company always takes **100%**, with no driver value required
- With two companies or more, every selected company needs a value for the chosen driver. A company without one is rejected when you save -- fix the company metrics in **Master Data > Companies** first
- A company disabled for the year cannot be selected: disabled companies are excluded from that year's allocations

### What it affects

- Every OPEX item and CAPEX investment whose allocation method is **default** -- shown as *Headcount (default)* (or *Default (n companies)*) in the Allocations tab until an organisation default is set
- Items with an explicit method (Headcount, IT Users, or Turnover pinned on the item) or a manual allocation keep their own setting
- Allocated amounts are recomputed the next time allocations are displayed. Budget amounts themselves are never modified

### Standard method

Until an organisation configures a default, the standard applies: **Headcount** over every company enabled for the year. The page always shows whether the year is on the standard or on a configured default, and what the standard method is.

### Changing the default after the fact

The default is resolved every time allocations are displayed, so editing it re-drives every item left on the default. If a company included in the selection later loses its driver value or is disabled, the affected items show an error instead of a silently rebalanced split -- the page warns you about the current selection.

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

The file lists every OPEX and CAPEX line you can read, for every year that has amounts. Each line and year gets five rows, in this order: Budget, Revision, Forecast, Actuals, Expected landing. Columns without amounts are included too. When the file covers one year, or only OPEX or only CAPEX because of your permissions, its name ends with `partial`.

A file can be imported up to 10 MB. For a larger budget, export and import one year at a time: a year-limited export gives a smaller file.

### Columns

The file uses a semicolon `;` as separator and UTF-8 encoding.

| Column | Content |
|--------|---------|
| `item_type` | `opex` or `capex` |
| `item_number` | The item number, for example `7`. On import, the reference also works (`OPX-7`, `CPX-7`) |
| `year` | Four digits |
| `measure` | The column: `planned` (Budget), `committed` (Revision), `forecast` (Forecast), `actual` (Actuals), `expected_landing` (Expected landing). On import, `budget`, `revision`, `follow_up` and `landing` also work |
| `period_start`, `period_end` | The column's period as `YYYY-MM-DD`, inside the row's year. On import, both empty means the whole year |
| `jan` to `dec` | The twelve monthly amounts, with a dot as decimal separator. On import, a comma and spaces are accepted too |
| `method` | How the column was produced: `spread`, `copied` or `manual`. For information only, ignored on import |

### Import rules

1. Click **Import**, choose the file and run **Preflight check**
2. Review the report, then click **Load**

- The whole file is checked before anything is saved. If one row has an error, nothing is saved and the report lists the errors by line number
- Each row replaces the twelve months of its line, year and column. Lines, years and columns that are not in the file stay untouched
- All twelve months are required. Write `0` for a month without an amount
- A row identical to what is stored is left untouched, including how the column was produced. Re-importing an export changes nothing
- A row whose amounts change marks the column as **Edited by hand**, with the period from the file
- A row that only changes the period updates the period and keeps the rest
- Actuals rows follow the same rules, which lets you import monthly actuals
- A changed row on a frozen column is refused. An identical row on a frozen column is accepted
- Repeated rows (same item, year and column), unknown item numbers, and items of a type you cannot administer are errors
- Importing needs administration rights on OPEX or on CAPEX. Exporting needs read access to either

---

## Workflow Example: Annual Budget Cycle

Here is a typical sequence using these tools:

### 1. End of Year N

1. Freeze Year N Actuals (protect historical data)
2. Copy N Budget to N+1 Budget (with a percentage increase for inflation)
3. Copy N Allocations to N+1

### 2. During Budget Planning (N+1)

1. Teams edit the N+1 Budget column
2. CFO reviews and approves

### 3. Budget Approval

1. Freeze N+1 Budget (lock the approved budget)
2. Copy N+1 Budget to N+1 Revision (starting point for in-year tracking)

### 4. Mid-Year Revision

1. Teams update N+1 Revision with forecast changes
2. When finalized, freeze N+1 Revision

---

## Tips

- **Always dry-run first**: Copy Budget Columns and Copy Allocations both support a dry run. Use it every time to verify the outcome before committing.
- **Freeze after approval**: Locking columns after approval maintains your audit trail and prevents accidental edits.
- **Use percentage adjustments**: When copying between years, apply an inflation or growth factor so you do not have to adjust every line manually.
- **Check freeze status before bulk operations**: Frozen columns block copy and reset operations. If a button is greyed out, check the Freeze page first.
- **Set the year's default before entering budgets**: If your allocation basis is not headcount, configure it in Default Allocation Method first, so items are created on the right basis instead of being re-driven later.
- **Reset with caution**: Column reset is irreversible. Double-check the year and column before confirming.
