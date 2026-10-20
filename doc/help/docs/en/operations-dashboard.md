# Budget management overview

The budget management overview gives you a high-level view of where your IT spend stands right now: the budget by type and year, your own budget lines, upcoming deadlines, data quality indicators, and the lines that deserve your attention most, all in one place.

## Where to find it

- Path: **Budget management > Overview** (`/ops`)
- The page you land on after login is your personal [dashboard](my-dashboard.md). Open this overview from the **Budget management** workspace.

## Header actions

The header holds shortcut buttons:

- **New OPEX line** and **New CAPEX line** open a new budget line of that type. They show when your role has at least the Member level on Budget (`budget:member`)
- **New contract** opens a new contract. It shows when your role can create contracts
- **Customize**, on the right, opens the settings of this overview. See [Customizing the overview](#customizing-the-overview)

## Layout

The overview is built from tiles arranged in a responsive grid: three columns on a wide screen, two on a tablet, and a single column on mobile. The **Budget** tile is wider: two columns on a wide screen, the full width on a tablet. Each tile has an icon, a title, and usually a button that takes you to the full page behind the data.

Several tiles have **All**, **OPEX** and **CAPEX** tabs in their header to choose the type of lines they cover. Each tile remembers your choice in your browser.

## Tiles

The tiles below are listed in their default order.

### Budget

A table covering three fiscal years: last year (Y-1), the current year (Y) and next year (Y+1). Each year has three rows: **OPEX**, **CAPEX** and **Total**. The value columns are the budget columns your organisation shows, under their names (**Budget**, **Revision**, **Actuals** and **Expected landing** with the standard settings, plus **Forecast** when it is shown). You can keep fewer of them in [Customize](#customizing-the-overview). A column shows when it holds an amount for at least one row. Hidden columns never appear. All amounts are rounded to the nearest thousand and displayed with a "k" suffix (for example, `7 846k`).

Click an amount to open the [budget lines list](budget-lines.md) on that type. A **Total** amount opens the list on both types. Click **View** to open the list.

### Data hygiene

Checks that help you spot incomplete lines at a glance. The tile shows one column of counts per type: **OPEX** and **CAPEX** side by side. The counts cover the lines the list shows by default (**Show: Enabled**).

- **No IT owner**: lines missing an IT owner
- **No business owner**: lines missing a business owner
- **No paying company**: lines without a paying company
- **No cost center**: lines without a cost center
- **No Budget for next year**: lines whose default column is zero or empty for next year. The check names your default column
- **Account not in the company's chart**: lines whose account does not belong to the paying company's chart of accounts

A count turns orange (red for the chart check) when it is above zero. Click a count to open the list on exactly the lines it counts.

### My budget

The lines in your name, on the default column of the current year (the subtitle names it, for example **Budget, Y**). Use the **All** / **OPEX** / **CAPEX** tabs to choose the type.

- **As IT owner**, **As business owner** and **As budget holder**: how many lines you hold in each role, and their total. Click a row to open the list on those lines
- **My lines**: your three largest lines, whatever the role, with their reference. Click one to open it

The tile reads "No budget lines in your name" when you hold no line.

### My tasks

Displays the total number of open tasks assigned to you (tasks marked "done" are excluded), followed by the five tasks whose due dates are closest. Overdue tasks are highlighted in red. Tasks that have no due date set do not appear here.

Click **View all** to open the Tasks page.

### Next renewals

Lists the five contracts due next, today included, in the order of the **Next due date** column of the Contracts list: a contract that renews tacitly appears on its next cancellation deadline, any other contract on its end. Ended contracts do not appear.

Click **View all** to open the Contracts page.

### Top lines

The five largest lines for the current year, ranked by the default column. The subtitle names the column, for example **Budget, Y**. Amounts are rounded to thousands with a "k" suffix.

Use the **All** / **OPEX** / **CAPEX** tabs to choose the type. Click **Open** to view the full Top items report on the same type.

### Top increases

The five lines with the largest increase in the default column compared to the previous year. The subtitle names the column, for example **Budget, Y vs Y-1**. Lines whose amount stayed flat or went down do not appear.

Use the **All** / **OPEX** / **CAPEX** tabs to choose the type. Click **Open** to view the full Top increase / decrease report on the same type.

### By cost center

The five cost centers with the largest total on the default column of the current year, with a bar for each. Lines without a cost center count together as **No cost center**. Use the **All** / **OPEX** / **CAPEX** tabs to choose the type. Click a row to open the list on that cost center's lines.

### Recent updates

The five most recently edited budget lines, OPEX and CAPEX together. Each row shows the date of the last edit, the line's reference, its name and its type. Click a row to open the line.

Without read access to budget lines (`budget:reader`), the budget tiles are hidden. **My tasks** needs read access to tasks, and **Next renewals** read access to contracts.

### Amounts without an exchange rate

When a line's currency has no exchange rate for a year, its amount is left out of the totals of that year. The **Budget**, **Top increases**, **My budget** and **By cost center** tiles then show a one-line warning, for example "Excluding 3 lines with no exchange rate: USD 2026." Budget administration users at admin level also see **Enter a rate**, which opens the currency settings on the missing rate. When the warning names a single currency and year, the manual rate dialog opens directly. In **Top lines**, such a line shows its amount in its own currency with a small orange mark. See [Manual rates](currencies.md#manual-rates).

## Customizing the overview

Click **Customize** to open **Budget dashboard settings**. Your choices apply to your own overview only.

- **Show or hide a tile**: tick or untick it. The dialog lists the tiles your role can see
- **Change the order**: drag a tile by its handle on the right
- **Amount columns of the Budget tile**: **Workspace columns**, ticked by default, follows the columns your organisation shows. Untick it to choose the columns yourself. Keep at least one: the dialog says "Choose at least one amount column." otherwise
- **Save** applies your choices. **Reset to defaults** shows every tile again, in the default order, with the organisation's columns

## Tips

- **Which column the tiles use**: A budget administrator chooses the default column and the column names in [Budget columns](budget-operations.md#budget-columns). The tiles and the reports they open follow that choice.
- **Rounded numbers**: Every amount on the overview is rounded to thousands for a compact view. Open the budget lines list, or the reports, when you need exact figures.
- **Missing buttons**: If you do not see the **New OPEX line** or **New CAPEX line** buttons, your current role does not have the Member level on Budget. Ask your administrator to check your access.
- **Empty tiles**: A tile that shows "No data" simply means there are no records of that type yet. Once you or your team start entering data, the tile will populate automatically.
