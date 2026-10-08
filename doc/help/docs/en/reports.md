# Reporting

The Reports section gives you prebuilt, interactive reports for analyzing budget data, cost allocations, and spending trends. Every report pairs a summary table with a chart, and all of them support CSV and image exports.

## Where to find it

Navigate to **Reporting** from the main menu to open the reports hub.

- Path: **Reporting**
- Permissions: `reporting:reader` (minimum)

---

## Reports hub

The landing page shows a card for each available report with a short description. Click any card to open the report.

| Report | What it covers |
|--------|----------------|
| **Global chargeback** | Company-level allocation totals, KPIs, and intercompany flows (OPEX) |
| **Company chargeback** | Single-company drilldown with departments, items, and KPIs (OPEX) |
| **Top items** | Largest OPEX or CAPEX items for a selected year (custom top N) |
| **Top increase / decrease** | Biggest OPEX or CAPEX changes between two budget columns (custom top N) |
| **Budget trend (OPEX)** | Compare OPEX metrics across a year range |
| **Budget trend (CAPEX)** | Compare CAPEX metrics across a year range |
| **Budget column comparison** | Pick up to 10 year+column totals for OPEX or CAPEX |
| **Consolidation accounts** | OPEX or CAPEX budget grouped by consolidation account |
| **Analytics dimensions** | OPEX or CAPEX budget grouped by analytics dimension |
| **Staffing by month** | Monthly FTE by cost center, item, supplier or analytics dimension |

### Choosing OPEX or CAPEX

**Top items**, **Top increase / decrease**, **Consolidation accounts**, **Analytics dimensions**, and **Staffing by month** each start with an **OPEX** / **CAPEX** switch, the first control of the filter bar.

- The report opens on a type you can read, OPEX first. A type you cannot read is disabled.
- The page address keeps the chosen type (`?scope=opex` or `?scope=capex`), so a bookmarked or shared link opens on the same type.
- The subtitle and the chart title name the type, so a printout or an exported PNG shows which type it covers.
- Switching the type clears the items you excluded, since each type has its own items.

The two chargeback reports cover OPEX only.

### Choosing amount or FTE

The seven budget reports have a **Measure** select. It sits right after the **OPEX** / **CAPEX** switch, or first when the report has no switch. It offers **Amount** (the default) and **FTE**. The two chargeback reports have no measure.

With **FTE**, a report sums people instead of money:

- Each budget column shows the full-year average FTE that its quantity and price lines declare. Lines in people or days add FTE. Lines in pieces count 0. A column without lines declares no FTE and is left out: only declared FTE count. See [Quantity and price](opex.md#quantity-and-price) and [FTE](opex.md#fte).
- A year or column where no item declares FTE shows an empty cell, with no bar or point in the chart.
- **Top items**, **Consolidation accounts** and **Analytics dimensions** leave out the items and groups that declare no FTE. Shares are shares of the FTE total.
- **Top increase / decrease** compares the FTE of the two columns item by item. An item that declares FTE on one side only counts 0 on the other.
- Values show with two decimals. Column names and chart titles carry FTE.
- The page address keeps the measure (`?measure=fte`), so a bookmarked or shared link opens on the same measure.
- Exported PNG and CSV file names end with `-fte`.

With FTE, a line under the table warns when some items declare FTE in a column whose amount no longer follows its lines. This happens when the amount was spread, its months were edited by hand, or the column was copied from a column whose lines were only a reference. The line says how many items and how many FTE are concerned, per column and year. With several columns it reads, for example, "Amount no longer follows the lines for: Budget 2026 (2 items, 1.50 FTE), Budget 2027 (1 item, 0.50 FTE)." With one column it reads "2 items declare 1.50 FTE while their amount no longer follows their lines." Their FTE still counts. The line tells you that the column's amount is not the cost of its lines.

### Budget columns in reports

Every column or metric picker offers the budget columns your organisation shows, under their names, in the fixed column order. Forecast is offered when it is shown. Hidden columns are not offered. Each report starts on the default column, as described below. Budget administrators set the names, the shown columns and the default column in [Budget columns](budget-operations.md#budget-columns).

### Cost center, run or build and analytics filters

The seven budget reports (**Top items**, **Top increase / decrease**, **Budget trend (OPEX)**, **Budget trend (CAPEX)**, **Budget column comparison**, **Consolidation accounts** and **Analytics dimensions**) and **Staffing by month** can be narrowed to one part of the budget with these filters:

- **Cost center**: pick a cost center or a group. A group includes everything below it, disabled cost centers included, since their lines still belong to the group. **All cost centers** removes the filter. See [Cost centers](cost-centers.md).
- **Run or build**: **All**, **Run**, **Build**, or **Not set** for the lines that have neither.
- **Items**: **All items** or **Items with FTE**. **Items with FTE** keeps the items that declare FTE in at least one budget column of any year. It works with both measures. An Amount report narrowed to **Items with FTE** compares, for example, the Budget and Actual amounts of staffing items. The Actual amount covers the whole item.
- **Analytics dimensions**: one filter per dimension, named after it. The default dimension shows as **Analytics dimension** until it is renamed. Pick a value, **No value** for the lines without a value on that dimension, or **All** to remove the filter. Each filter offers the values the report's lines hold. See [Analytics dimensions](analytics.md).

When the filters appear:

- **Cost center** shows once your workspace has at least one cost center or group.
- **Run or build** shows once a line of the report is marked **Run** or **Build**, or when the page address already carries the filter.
- **Items** shows once an item of the report declares FTE, or when the page address already carries the filter.
- A dimension's filter shows once a line of the report has a value on that dimension, or when the page address already carries it. Disabled dimensions have no filter.
- With none of these, the filter bar shows only the report's own controls.

How they work:

- The filters apply before any total. Amounts, shares, charts and totals cover the kept lines only.
- Filters on several dimensions combine: a line must match each of them.
- The lists of items, accounts and values to exclude keep offering every line.
- The page address keeps the filters (`?costCenter=`, `?runBuild=`, `?fte=with` and `?analytics=`), so a bookmarked or shared link opens the report already narrowed. A link that names a dimension since disabled or deleted ignores that part.
- If the link names a cost center that was deleted since, or the cost centers could not be loaded, the report shows no lines and one line of text: "This cost center no longer exists or could not be loaded." Click **Clear filter** to see the report again.
- If the link carries an analytics filter and the dimensions could not be loaded, the report shows no lines and one line of text: "The analytics filter could not be applied. Clear it or try again." Click **Clear filter** to remove the analytics filters and see the report again.
- The two chargeback reports have no such filters and are not affected.

---

## Global chargeback

View cost allocations across all companies with summary KPIs and intercompany flows.

### Controls

- **Year**: Previous, current, or next fiscal year
- **Column**: Any shown budget column. Starts on the default column
- **Company totals** (checkbox): Show or hide the company totals table and bar chart
- **Detailed allocations** (checkbox): Show or hide the company-by-department breakdown
- **Include KPIs** (checkbox): Show or hide the KPI table
- **Intercompany flows** (checkbox): Show or hide netted payer/consumer flows
- **Run** button: Manually refresh the report

### What you'll see

**Overall total card**: The grand total for the selected metric and year, plus counts of companies, detailed lines, and KPI coverage.

**Company totals table** (when enabled):

- Company name
- Amount for the selected metric
- Paid (booked) amount
- Net (consumed minus paid)
- Share of total

**Chart**: Horizontal bar chart of allocations by company.

**Detailed allocations table** (when enabled):

- Company and department columns (grouped with bold subtotal rows per company)
- Amount, share of total, headcount, and cost per user
- Rows labelled "Common Costs" represent costs without a department assignment

**Intercompany flows table** (when enabled):

- Netted payer-to-consumer flows per company pair (self-consumption excluded)
- Columns: Payer, Consumer, amount
- Separate **Export netted flows CSV** button

**KPI table** (when enabled):

| Column | Description |
|--------|-------------|
| Company | Company name |
| Amount | Selected metric total |
| Headcount | Total headcount |
| IT users | IT user count |
| Turnover | Annual turnover |
| IT costs vs turnover | Percentage ratio |
| IT costs per user | Amount divided by headcount |
| IT costs per IT user | Amount divided by IT users |

A totals row is pinned at the bottom.

### Export

- **Export table as CSV** (download icon): Exports the detailed allocations grid
- **Export chart as PNG** (image icon): Exports the bar chart
- **Print / Save as PDF** (print icon)

---

## Company chargeback

Drill down into a single company's chargeback allocations across departments, budget items, intercompany flows, and KPIs.

### Controls

- **Company**: Select which company to analyze
- **Year**: Previous, current, or next fiscal year
- **Column**: Any shown budget column. Starts on the default column
- **Department totals** (checkbox): Show or hide department breakdown
- **Chargeback items** (checkbox): Show or hide itemised allocations
- **Chargeback KPIs** (checkbox): Show or hide the KPI comparison table
- **Intercompany flows** (checkbox): Show or hide partner-company flows
- **Run** button: Manually refresh the report (disabled until a company is selected)

### What you'll see

**Company summary card**: Company name, total amount, reporting currency, headcount, IT users, cost per user, cost per IT user, and IT costs vs turnover.

**Department totals** (when enabled):

- Department name, amount, share of total, headcount, cost per user
- "Common Costs" aggregates allocations without a specific department
- Horizontal bar chart alongside the table

**Chargeback items** (when enabled):

- Item name, allocation method, amount, share of total
- Pinned totals row at the bottom

**Intercompany flows** (when enabled):

- Partner company, receivables, payables, net
- Pinned totals row
- Separate **Export flows CSV** button

**KPI table** (when enabled): Same columns as the Global chargeback KPI table, with a "Global totals" row at the bottom for comparison.

### Export

- **Export table as CSV**: Exports the department totals grid
- **Export chart as PNG**: Exports the department bar chart
- **Print / Save as PDF**

---

## Top items

Identify your largest OPEX or CAPEX items for a given year.

### Controls

- **Item type**: OPEX or CAPEX (see [Choosing OPEX or CAPEX](#choosing-opex-or-capex))
- **Measure**: **Amount** or **FTE** (see [Choosing amount or FTE](#choosing-amount-or-fte))
- **Year**: Previous, current, or next year
- **Metric**: Any shown budget column. Starts on the default column
- **Top count**: How many items to show (default: 10, minimum: 1)
- **Chart type**: Pie chart or horizontal bar chart
- **Exclude items**: Multi-select autocomplete to exclude specific items
- **Exclude accounts**: Multi-select autocomplete to exclude specific accounts
- **Cost center**, **Run or build**, **Items** and the analytics dimension filters: See [Cost center, run or build and analytics filters](#cost-center-run-or-build-and-analytics-filters)

### What you'll see

**Chart**: Pie or horizontal bar chart of the top items. Its title names the type, for example "Top 10 CAPEX · Budget 2026".

**Table columns**:

- Item
- Value for the selected metric and year
- Share of total (percentage)

**Summary cards below the table**:

- **Top N total**, with its share of the filtered total, for example "45% of the filtered total"
- The total of the selected column across all items, labelled with the column name, for example **Budget, total**

The chart footnote gives the same total, for example "Budget, total: 1 234".

### Use case

Use this report to quickly spot where most of your IT budget goes and identify candidates for cost optimization.

---

## Top increase / decrease

Identify the biggest OPEX or CAPEX changes between two budget columns (any combination of year and metric).

### Controls

- **Item type**: OPEX or CAPEX (see [Choosing OPEX or CAPEX](#choosing-opex-or-capex))
- **Measure**: **Amount** or **FTE** (see [Choosing amount or FTE](#choosing-amount-or-fte))
- **Source year** and **Source metric**: The baseline column to compare from
- **Destination year** and **Destination metric**: The target column to compare to
- **Top count**: How many items to show per direction (default: 10)
- **Chart type**: Pie chart (single direction only) or horizontal bar chart
- **Exclude items**: Multi-select autocomplete to exclude specific items
- **Exclude accounts**: Multi-select autocomplete to exclude specific accounts
- **Direction**: **Increases**, **Decreases**, or **Both** tabs
- **Cost center**, **Run or build**, **Items** and the analytics dimension filters: See [Cost center, run or build and analytics filters](#cost-center-run-or-build-and-analytics-filters)

The year pickers list the years that hold data. The metric pickers offer the shown budget columns. The report starts on the default column of last year as the source and the default column of the current year as the destination.

When **Both** is selected, the pie chart option is disabled and the report automatically switches to bar.

### What you'll see

**Chart**: Visualisation of the top changes. Its title names the type, for example "Top 10 OPEX increases".

**Table columns**:

- Item
- Source value (previous)
- Destination value (current)
- Delta (absolute change)
- Percentage increase

**Summary cards below the table**:

- Selection totals (increase and/or decrease amounts, with source/destination sums)
- Gross changes across all items (with coverage percentage)
- Net increase or decrease across all items

### Use case

Use this report for identifying cost overruns, spotting savings opportunities, and explaining year-over-year variance in budget reviews.

---

## Budget trend (OPEX)

Compare OPEX metrics across multiple years on a single line chart.

### Controls

- **Measure**: **Amount** or **FTE** (see [Choosing amount or FTE](#choosing-amount-or-fte))
- **Start year**: Beginning of the range (current year minus 2 through plus 2)
- **End year**: End of the range
- **Metrics**: Multi-select from the shown budget columns. The report starts on the default column and the last shown column (Budget and Expected landing with the standard settings). If you clear every metric, the default column is used
- **Cost center**, **Run or build**, **Items** and the analytics dimension filters: See [Cost center, run or build and analytics filters](#cost-center-run-or-build-and-analytics-filters)

### What you'll see

**Chart**: Line chart with one series per selected metric, plotted across the year range.

**Table**: One row per selected metric, with year columns showing totals.

### Export

- **Export table as CSV**
- **Export chart as PNG**
- **Print / Save as PDF**

---

## Budget trend (CAPEX)

Identical layout to the OPEX trend report, but pulls from CAPEX budget data.

### Controls

- **Measure**: **Amount** or **FTE** (see [Choosing amount or FTE](#choosing-amount-or-fte))
- **Start year**, **End year**, **Metrics**: Same as the OPEX trend report
- **Cost center**, **Run or build**, **Items** and the analytics dimension filters: See [Cost center, run or build and analytics filters](#cost-center-run-or-build-and-analytics-filters)

### What you'll see

- Line chart of CAPEX totals by metric across years
- Summary table with year columns

---

## Budget column comparison

Flexibly compare up to 10 year+column combinations for either OPEX or CAPEX.

### Controls

- **Item type**: OPEX or CAPEX toggle
- **Measure**: **Amount** or **FTE** (see [Choosing amount or FTE](#choosing-amount-or-fte))
- **Selections**: Each selection has a year picker and a column picker with the shown budget columns. The report starts with two selections: the default column of the current year and of next year. **Add** adds the default column of the current year, and the delete icon removes a selection. Maximum of 10 selections; minimum of 1.
- **Year grouping** (checkbox): When enabled and at least two years share a metric, switches to a grouped line chart with one series per metric and years on the X axis. When disabled, shows a flat line chart with each selection as a data point.
- **Cost center**, **Run or build**, **Items** and the analytics dimension filters: See [Cost center, run or build and analytics filters](#cost-center-run-or-build-and-analytics-filters)

### What you'll see

**Chart**:

- Default mode: Line chart with each selection on the X axis and its total on the Y axis
- Year grouping mode: Line chart with years on the X axis and one line per metric

**Table**:

- Default mode: Selection label, year, column name, total
- Year grouping mode: Year column, then one column per metric with totals

### Export

- **Export table as CSV**
- **Export chart as PNG**
- **Print / Save as PDF**

---

## Consolidation accounts

View OPEX or CAPEX budget data grouped by consolidation account, with chart type adapting to the year range.

### Controls

- **Item type**: OPEX or CAPEX (see [Choosing OPEX or CAPEX](#choosing-opex-or-capex))
- **Measure**: **Amount** or **FTE** (see [Choosing amount or FTE](#choosing-amount-or-fte))
- **Start year** and **End year**: Previous, current, or next year
- **Metric**: Any shown budget column. Starts on the default column
- **Chart type**: Pie chart or horizontal bar chart (only available when a single year is selected)
- **Exclude accounts**: Multi-select autocomplete to exclude specific accounts. Offers every account used by the report's lines, by name and number, whether or not you can open the chart of accounts
- **Cost center**, **Run or build**, **Items** and the analytics dimension filters: See [Cost center, run or build and analytics filters](#cost-center-run-or-build-and-analytics-filters)

### What you'll see

**Single-year mode**:

- Pie or horizontal bar chart of totals by consolidation account
- Footnote with the total for the selected metric

**Multi-year mode**:

- Line chart with one series per consolidation account, plotted across years

**Table**: One row per consolidation account with year columns. A pinned totals row at the bottom sums all groups.

A line on a consolidation account that has since been disabled still counts, under that account's own consolidation line. Account names and numbers show only when you can read the [chart of accounts](chart-of-accounts.md); without that access, every line appears under "Unassigned" instead (the totals are still right, only the breakdown by account is hidden). Items without a consolidation account also appear as "Unassigned". The consolidation accounts are the accounts of your [consolidation chart](chart-of-accounts.md#the-consolidation-chart).

---

## Analytics dimensions

View OPEX or CAPEX budget data grouped by the values of one analytics dimension. The layout mirrors the Consolidation accounts report. See [Analytics dimensions](analytics.md) to set up dimensions and values.

### Controls

- **Item type**: OPEX or CAPEX (see [Choosing OPEX or CAPEX](#choosing-opex-or-capex))
- **Measure**: **Amount** or **FTE** (see [Choosing amount or FTE](#choosing-amount-or-fte))
- **Dimension**: the dimension the report groups on. It shows when you have two or more enabled dimensions, and the report opens on the default dimension. The page address keeps your choice, so a bookmarked or shared link opens on the same dimension
- **Start year** and **End year**: Previous, current, or next year
- **Metric**: Any shown budget column. Starts on the default column
- **Chart type**: Pie chart or horizontal bar chart (single-year only)
- **Exclude values**: Multi-select autocomplete to exclude specific values of the chosen dimension. Switching the item type or the dimension clears it
- **Cost center**, **Run or build**, **Items** and the analytics dimension filters: See [Cost center, run or build and analytics filters](#cost-center-run-or-build-and-analytics-filters)

The subtitle, the chart title and the first column of the table name the chosen dimension, for example "OPEX by Nature".

### What you'll see

**Single-year mode**:

- Pie or bar chart of totals by value
- Footnote with the metric total

**Multi-year mode**:

- Line chart with one series per value

**Table**: One row per value with year columns. A pinned totals row at the bottom. Lines without a value on the chosen dimension appear as "Unassigned".

---

## Staffing by month

See how many people each part of the budget plans, month by month. The report reads the monthly FTE that the quantity and price lines of a budget column declare. See [Quantity and price](opex.md#quantity-and-price) and [FTE](opex.md#fte).

### Controls

- **Item type**: OPEX or CAPEX (see [Choosing OPEX or CAPEX](#choosing-opex-or-capex))
- **Cost center**, **Run or build**, **Items** and the analytics dimension filters: See [Cost center, run or build and analytics filters](#cost-center-run-or-build-and-analytics-filters)
- **Year**: Previous, current, or next year
- **Column**: Any shown budget column. Starts on the default column
- **Group by**: **Cost center** (the default), **Item**, **Supplier** or **Analytics dimension**
- **Dimension**: the dimension the report groups on, with **Analytics dimension**. It shows when you have two or more enabled dimensions, and the report opens on the default dimension

The page address keeps the grouping (`?group=item`, `?group=supplier` or `?group=axis:<dimension id>`), so a bookmarked or shared link opens on the same grouping. Without it, the report groups by cost center.

### What you'll see

**Chart**: Stacked areas over the twelve months, one for each of the eight largest groups by average. The other groups add up in one **Others** area. The title names the type, the grouping, the column and the year, for example "OPEX staffing by cost center, Budget 2026". Hover a month to read a group's FTE.

**Table**: One row per group that declares monthly FTE, the largest average first:

- The group: a cost center, an item, a supplier or a value of the dimension. Items without a cost center appear as "No cost center", without a supplier as "No supplier", and without a value on the dimension as "No value"
- One column per month
- **Average**: the sum of the twelve months divided by 12. This is the full-year average FTE the column declares
- **Peak**: the highest month

A pinned **Total** row gives the monthly totals, their average and their peak. Values show with two decimals. Only declared FTE count: items without quantity and price lines in the column are left out.

### Notices

One line under the table for each case, when it applies:

- "2 items declare 1.50 FTE while their amount no longer follows their lines." The amount was spread, its months were edited by hand, or the column was copied. This line covers the items that have monthly detail, and their FTE still counts in the months. Items without monthly detail appear in the next line only. See [Choosing amount or FTE](#choosing-amount-or-fte).
- "1 item declares 3.00 FTE without monthly detail. It is not in the months." These items declare a full-year FTE but no FTE per month. They are left out of the months, the average and the peak.

### Export

- **Export table as CSV**: The file name carries the type, the year, the column and the grouping, for example `staffing-opex-2026-budget-cost-center.csv`
- **Export chart as PNG**: Same name, as a PNG image
- **Print / Save as PDF**

---

## Common features

Every report shares these capabilities through the shared toolbar:

### Export options

- **Export table as CSV** (download icon): Downloads the primary table data
- **Export chart as PNG** (image icon): Downloads the chart as a PNG image
- **Print / Save as PDF** (print icon): Opens the browser print dialog. You can also append `?print=1` to any report URL to trigger printing automatically on load.

Exported file names carry the column name, for example `top10-opex-2026-budget-bar.png`. With the FTE measure, they end with `-fte`.

### Available metrics

Every metric or column selector offers the same budget columns: the ones your organisation shows, under their names. With the standard settings these are Budget, Revision, Actuals and Expected landing. Forecast is offered when it is shown. See [Budget columns in reports](#budget-columns-in-reports).

### Navigation

Every report shows a breadcrumb trail back to the **Reporting** hub, so you can switch reports quickly.

---

## Tips

- **Start with Global chargeback**: Get the big picture of allocations before drilling into a single company.
- **Use Top items for quick wins**: The largest cost items are your first candidates for optimization.
- **Compare Budget vs Expected landing**: Use the Budget column comparison report to measure forecast accuracy across years.
- **Toggle sections on chargeback reports**: The checkbox controls let you focus on just the data you need (departments, items, KPIs, or flows) without visual clutter.
- **Year grouping in Budget column comparison**: When comparing the same metric across multiple years, enable year grouping for a cleaner line chart.
- **Export for presentations**: Charts export as PNG and tables as CSV, both ready for slides or spreadsheets.
