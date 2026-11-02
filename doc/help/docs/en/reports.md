# Reporting

The Reports section gives you prebuilt, interactive reports for analyzing budget data, cost allocations, and spending trends. Every report pairs a summary table with a chart, and all of them export their table in CSV or Excel and their chart as an image.

## Where to find it

Navigate to **Reporting** from the main menu to open the reports hub.

- Path: **Reporting**
- Permissions: `reporting:reader` (minimum)

For a person with limited [data access](data-access.md), every report counts the lines they see, and shows no group total.

---

## Reports hub

The landing page shows a card for each available report with a short description. Click any card to open the report.

| Report | What it covers |
|--------|----------------|
| **Global chargeback** | Company-level allocation totals, KPIs, and intercompany flows |
| **Company chargeback** | Single-company drilldown with departments, lines, and KPIs |
| **Top lines** | Largest budget lines for a selected year (custom top N) |
| **Top increase / decrease** | Biggest changes between two budget columns (custom top N) |
| **Budget comparison** | Compare budget metrics across a year range |
| **Budget column comparison** | Pick up to 10 year+column totals |
| **Consolidation accounts** | Budget grouped by consolidation account |
| **Analytics dimensions** | Budget grouped by analytics dimension |
| **Staffing by month** | Monthly FTE by cost center, line, supplier or analytics dimension |
| **Cost per FTE** | Yearly cost of one FTE or average daily rate, by cost center, line, supplier or analytics dimension, across budget columns and years |

### Choosing the type of lines

**Top lines**, **Top increase / decrease**, **Budget comparison**, **Budget column comparison**, **Consolidation accounts**, **Analytics dimensions**, **Staffing by month** and **Cost per FTE** each start with **All**, **OPEX** and **CAPEX** tabs, the first control of the filter bar.

- The report opens on **All**: the OPEX and CAPEX lines together. **OPEX** or **CAPEX** keeps the lines of that type. All three need read access to budget lines (`budget:reader`). Without it, the tabs are disabled.
- The page address keeps the chosen type (`?scope=all`, `?scope=opex` or `?scope=capex`), so a bookmarked or shared link opens on the same type.
- The subtitle and the chart title name the type, so a printout or an exported PNG shows which lines it covers.
- Switching the type clears the lines you excluded.

The two chargeback reports have the same **All**, **OPEX** and **CAPEX** tabs, and open on **OPEX**. See [Global chargeback](#global-chargeback).

### Choosing amount or FTE

The six budget reports have a **Measure** select. It sits right after the type tabs. It offers **Amount** (the default) and **FTE**. The two chargeback reports have no measure.

With **FTE**, a report sums people instead of money:

- Each budget column shows the full-year average FTE that its quantity and price lines declare. Lines in people or days add FTE. Lines in pieces count 0. A column without lines declares no FTE and is left out: only declared FTE count. See [Quantity and price](budget-lines.md#quantity-and-price) and [FTE](budget-lines.md#fte).
- A year or column where no line declares FTE shows an empty cell, with no bar or point in the chart.
- **Top lines**, **Consolidation accounts** and **Analytics dimensions** leave out the lines and groups that declare no FTE. Shares are shares of the FTE total.
- **Top increase / decrease** compares the FTE of the two columns line by line. A line that declares FTE on one side only counts 0 on the other.
- Values show with two decimals. Column names and chart titles carry FTE.
- The page address keeps the measure (`?measure=fte`), so a bookmarked or shared link opens on the same measure.
- Exported file names carry `-fte`.

With FTE, a line under the table warns when some lines declare FTE in a column whose amount no longer follows its lines. This happens when the amount was spread, its months were edited by hand, or the column was copied from a column whose lines were only a reference. The line says how many lines and how many FTE are concerned, per column and year. With several columns it reads, for example, "Amount no longer follows the lines for: Budget 2026 (2 lines, 1.50 FTE), Budget 2027 (1 line, 0.50 FTE)." With one column it reads "2 lines declare 1.50 FTE while their amount no longer follows their quantity and price lines." Their FTE still counts. The line tells you that the column's amount is not the cost of its lines.

### Budget columns in reports

Every column or metric picker offers the budget columns your organisation shows, under their names, in the fixed column order. Forecast is offered when it is shown. Hidden columns are not offered. Each report starts on the default column, as described below. Budget administrators set the names, the shown columns and the default column in [Budget columns](budget-operations.md#budget-columns).

### Cost center, run or build and analytics filters

The budget reports (**Top lines**, **Top increase / decrease**, **Budget comparison**, **Budget column comparison**, **Consolidation accounts** and **Analytics dimensions**), **Staffing by month** and **Cost per FTE** can be narrowed to one part of the budget with these filters:

- **Cost center**: pick a cost center or a group. A group includes everything below it, disabled cost centers included, since their lines still belong to the group. **All cost centers** removes the filter. See [Cost centers](cost-centers.md).
- **Run or build**: **All**, **Run**, **Build**, or **Not set** for the lines that have neither.
- **Lines**: **All lines** or **Lines with FTE**. **Lines with FTE** keeps the lines that declare FTE in at least one budget column of any year. It works with both measures. An Amount report narrowed to **Lines with FTE** compares, for example, the Budget and Actual amounts of staffing lines. The Actual amount covers the whole line.
- **Analytics dimensions**: one filter per dimension, named after it. The default dimension shows as **Analytics dimension** until it is renamed. Pick a value, **No value** for the lines without a value on that dimension, or **All** to remove the filter. Each filter offers the values the report's lines hold. See [Analytics dimensions](analytics.md).

When the filters appear:

- **Cost center** shows once your workspace has at least one cost center or group.
- **Run or build** shows once a line of the report is marked **Run** or **Build**, or when the page address already carries the filter.
- **Lines** shows once a line of the report declares FTE, or when the page address already carries the filter.
- A dimension's filter shows once a line of the report has a value on that dimension, or when the page address already carries it. Disabled dimensions have no filter. A report shows only the dimensions used for the lines it covers: switching the type changes the list. A dimension set to **OPEX only** has no filter in a CAPEX report, and the reverse. **All** shows the dimensions of both types. See [OPEX or CAPEX dimensions](analytics.md#opex-or-capex-dimensions).
- With none of these, the filter bar shows only the report's own controls.

How they work:

- The filters apply before any total. Amounts, shares, charts and totals cover the kept lines only.
- Filters on several dimensions combine: a line must match each of them.
- The lists of lines, accounts and values to exclude keep offering every line.
- The page address keeps the filters (`?costCenter=`, `?runBuild=`, `?fte=with` and `?analytics=`), so a bookmarked or shared link opens the report already narrowed. A link that names a dimension since disabled or deleted ignores that part.
- If the link names a cost center that was deleted since, or the cost centers could not be loaded, the report shows no lines and one line of text: "This cost center no longer exists or could not be loaded." Click **Clear filter** to see the report again.
- If the link carries an analytics filter and the dimensions could not be loaded, the report shows no lines and one line of text: "The analytics filter could not be applied. Clear it or try again." Click **Clear filter** to remove the analytics filters and see the report again.
- The two chargeback reports have no such filters and are not affected.

### Amounts without an exchange rate

When a line's currency has no exchange rate for a year, the budget reports, **Staffing by month** and **Cost per FTE** leave that line's amounts for the year out of their figures. A one-line warning at the top of the report names them, for example "Excluding 3 lines with no exchange rate: USD 2026." Budget administration users at admin level also see **Enter a rate**, which opens the currency settings on the missing rate. When the warning names a single currency and year, the manual rate dialog opens directly. The warning does not print. See [Manual rates](currencies.md#manual-rates).

The two chargeback reports leave these amounts out of every figure: paid, consumed, departments and intercompany flows. Each report stays balanced on what it counts. The same warning shows above the report.

### Opening the list from a report

In **Staffing by month**, **Cost per FTE**, **Analytics dimensions** and **Consolidation accounts**, a group name is a link that opens the [budget lines list](budget-lines.md) in a new tab, on the lines the row counts:

- the lines of the group, narrowed by the filter bar, and by the **Type** filter when the report is on **OPEX** or **CAPEX**;
- every status (**Show: All**), with an **End of validity** filter "blank, or after 31 December" of the year before the report's first year. A report counts the lines still active on 1 January of its first year, including the ones disabled since;
- in **Staffing by month** and **Cost per FTE**, and with the **FTE** measure, only the lines that declare FTE (the **FTE declared** filter).

The filtered columns show right after the line name for this visit, so you see why the list is narrowed. A consolidation account filters on its accounts without a column of its own.

This list is a view of the report. What you change in it stays in its address, and opening **Budget lines** from the menu afterwards shows your own sort, search and filters.

---

## Global chargeback

View cost allocations across all companies with summary KPIs and intercompany flows.

### Controls

- **Line type**: **All**, **OPEX** or **CAPEX**. The report opens on **OPEX**. On **All** or **CAPEX**, a note above the results says "CAPEX lines count for their amount of the year, without depreciation."
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
- Rows labelled "Common costs" represent costs without a department assignment

**Intercompany flows table** (when enabled):

- Netted payer-to-consumer flows per company pair (self-consumption excluded)
- Columns: Payer, Consumer, amount

**KPI table** (when enabled):

| Column | Description |
|--------|-------------|
| Company | Company name |
| Amount | Selected metric total |
| Headcount | Total headcount |
| IT users | IT user count |
| Turnover | Annual turnover, in millions of the reporting currency |
| IT costs vs turnover | Percentage ratio, both in the reporting currency |
| IT costs per user | Amount divided by headcount |
| IT costs per IT user | Amount divided by IT users |

A totals row is pinned at the bottom.

### Export

- **Export table** (download icon): **Excel (.xlsx)** writes one sheet per table: **Detailed allocations**, **Global company totals**, **Intercompany flows** and **Chargeback KPIs**, then the **Parameters** sheet. **CSV** offers one entry per table, for example **CSV: Intercompany flows**. The detailed allocations hold one row per department, with its company on each row, so a sum of the amount column gives the total. The company totals are in their own table
- **Export chart as PNG** (image icon): Exports the bar chart
- **Print / Save as PDF** (print icon)

The export holds every table, whichever tables the checkboxes show on screen.

---

## Company chargeback

Drill down into a single company's chargeback allocations across departments, budget lines, intercompany flows, and KPIs.

### Controls

- **Line type**: **All**, **OPEX** or **CAPEX**, as in the Global chargeback. The report opens on **OPEX**
- **Company**: Select which company to analyze
- **Year**: Previous, current, or next fiscal year
- **Column**: Any shown budget column. Starts on the default column
- **Department totals** (checkbox): Show or hide department breakdown
- **Chargeback lines** (checkbox): Show or hide itemised allocations
- **Chargeback KPIs** (checkbox): Show or hide the KPI comparison table
- **Intercompany flows** (checkbox): Show or hide partner-company flows
- **Run** button: Manually refresh the report (disabled until a company is selected)

### What you'll see

**Company summary card**: Company name, total amount, reporting currency, headcount, IT users, cost per user, cost per IT user, and IT costs vs turnover.

**Turnover in the chargeback reports**: each company enters its turnover in millions of its base currency. Both chargeback reports convert it to the reporting currency, at the rates of the year's budget version, like the amounts. The turnover, the IT costs vs turnover ratio and the global turnover of the KPI tables use the converted value. When a currency has no rate for the year, the companies in that currency are left out of the turnover figures, and a warning at the top of the report names each of them. The global IT costs vs turnover ratio is then computed on the companies whose turnover was converted, on both sides: their costs and their turnover. KANAP fetches the missing rate in the background.

**Department totals** (when enabled):

- Department name, amount, share of total, headcount, cost per user
- "Common costs" aggregates allocations without a specific department
- Horizontal bar chart alongside the table

**Chargeback lines** (when enabled):

- Line name, allocation method, amount, share of total
- Pinned totals row at the bottom
- The line name is a link that opens the budget line in a new tab. Common costs and totals are plain text.

**Intercompany flows** (when enabled):

- Partner company, receivables, payables, net
- Pinned totals row

**KPI table** (when enabled): Same columns as the Global chargeback KPI table, with a "Global totals" row at the bottom for comparison.

**Limited data access**: a limited person opens the companies of their company nodes, or every company with **Everything**. The chargeback lines then show the share charged to the company, with the paying company, the allocation percentage and the departments; a line they do not otherwise see shows its reference without a link. The figures of the other companies and the global totals are left out, and a cost center node does not open this report. See [Data access](data-access.md#what-a-limited-person-sees).

### Export

- **Export table**: **Excel (.xlsx)** writes one sheet per table: **Department totals**, **Chargeback lines**, **Intercompany flows** and **Chargeback KPIs**, then the **Parameters** sheet. **CSV** offers one entry per table, for example **CSV: Chargeback lines**
- **Export chart as PNG**: Exports the department bar chart
- **Print / Save as PDF**

The export holds every table, whichever tables the checkboxes show on screen.

---

## Top lines

Identify your largest budget lines for a given year.

### Controls

- **Line type**: **All**, **OPEX** or **CAPEX** (see [Choosing the type of lines](#choosing-the-type-of-lines))
- **Measure**: **Amount** or **FTE** (see [Choosing amount or FTE](#choosing-amount-or-fte))
- **Year**: Previous, current, or next year
- **Metric**: Any shown budget column. Starts on the default column
- **Top count**: How many lines to show (default: 10, minimum: 1)
- **Chart type**: Pie chart or horizontal bar chart
- **Exclude lines**: Multi-select autocomplete to exclude specific lines
- **Exclude accounts**: Multi-select autocomplete to exclude specific accounts
- **Cost center**, **Run or build**, **Lines** and the analytics dimension filters: See [Cost center, run or build and analytics filters](#cost-center-run-or-build-and-analytics-filters)

### What you'll see

**Chart**: Pie or horizontal bar chart of the top lines. Its title names the type, for example "Top 10 CAPEX · Budget 2026".

**Table columns**:

- Line
- Value for the selected metric and year
- Share of total (percentage)

The line name is a link that opens the budget line in a new tab.

**Summary cards below the table**:

- **Top N total**, with its share of the filtered total, for example "45% of the filtered total"
- The total of the selected column across all lines, labelled with the column name, for example **Budget, total**

The chart footnote gives the same total, for example "Budget, total: 1 234".

### Use case

Use this report to quickly spot where most of your IT budget goes and identify candidates for cost optimization.

---

## Top increase / decrease

Identify the biggest changes between two budget columns (any combination of year and metric).

### Controls

- **Line type**: **All**, **OPEX** or **CAPEX** (see [Choosing the type of lines](#choosing-the-type-of-lines))
- **Measure**: **Amount** or **FTE** (see [Choosing amount or FTE](#choosing-amount-or-fte))
- **Source year** and **Source metric**: The baseline column to compare from
- **Destination year** and **Destination metric**: The target column to compare to
- **Top count**: How many lines to show per direction (default: 10)
- **Chart type**: Pie chart (single direction only) or horizontal bar chart
- **Exclude lines**: Multi-select autocomplete to exclude specific lines
- **Exclude accounts**: Multi-select autocomplete to exclude specific accounts
- **Direction**: **Increases**, **Decreases**, or **Both** tabs
- **Cost center**, **Run or build**, **Lines** and the analytics dimension filters: See [Cost center, run or build and analytics filters](#cost-center-run-or-build-and-analytics-filters)

The year pickers list the years that hold data. The metric pickers offer the shown budget columns. The report starts on the default column of last year as the source and the default column of the current year as the destination.

When **Both** is selected, the pie chart option is disabled and the report automatically switches to bar.

### What you'll see

**Chart**: Visualisation of the top changes. Its title names the type, for example "Top 10 OPEX increases".

**Table columns**:

- Line
- Source value (previous)
- Destination value (current)
- Delta (absolute change)
- Percentage increase

The line name is a link that opens the budget line in a new tab.

**Summary cards below the table**:

- Selection totals (increase and/or decrease amounts, with source/destination sums)
- Gross changes across all lines (with coverage percentage)
- Net increase or decrease across all lines

### Use case

Use this report for identifying cost overruns, spotting savings opportunities, and explaining year-over-year variance in budget reviews.

---

## Budget comparison

Compare budget metrics across multiple years on a single line chart. The address of the former **Budget trend (CAPEX)** report opens this report on CAPEX.

### Controls

- **Line type**: **All**, **OPEX** or **CAPEX** (see [Choosing the type of lines](#choosing-the-type-of-lines))
- **Measure**: **Amount** or **FTE** (see [Choosing amount or FTE](#choosing-amount-or-fte))
- **Start year**: Beginning of the range (current year minus 2 through plus 2)
- **End year**: End of the range
- **Metrics**: Multi-select from the shown budget columns. The report starts on the default column and the last shown column (Budget and Expected landing with the standard settings). If you clear every metric, the default column is used
- **Cost center**, **Run or build**, **Lines** and the analytics dimension filters: See [Cost center, run or build and analytics filters](#cost-center-run-or-build-and-analytics-filters)

### What you'll see

**Chart**: Line chart with one series per selected metric, plotted across the year range.

**Table**: One row per selected metric, with year columns showing totals.

### Export

- **Export table**: CSV or Excel. See [Export options](#export-options)
- **Export chart as PNG**
- **Print / Save as PDF**

---

## Budget column comparison

Flexibly compare up to 10 year+column combinations.

### Controls

- **Line type**: **All**, **OPEX** or **CAPEX** (see [Choosing the type of lines](#choosing-the-type-of-lines))
- **Measure**: **Amount** or **FTE** (see [Choosing amount or FTE](#choosing-amount-or-fte))
- **Selections**: Each selection has a year picker and a column picker with the shown budget columns. The report starts with two selections: the default column of the current year and of next year. **Add** adds the default column of the current year, and the delete icon removes a selection. Maximum of 10 selections; minimum of 1.
- **Year grouping** (checkbox): When enabled and at least two years share a metric, switches to a grouped line chart with one series per metric and years on the X axis. When disabled, shows a flat line chart with each selection as a data point.
- **Cost center**, **Run or build**, **Lines** and the analytics dimension filters: See [Cost center, run or build and analytics filters](#cost-center-run-or-build-and-analytics-filters)

### What you'll see

**Chart**:

- Default mode: Line chart with each selection on the X axis and its total on the Y axis
- Year grouping mode: Line chart with years on the X axis and one line per metric

**Table**:

- Default mode: Selection label, year, column name, total
- Year grouping mode: Year column, then one column per metric with totals

### Export

- **Export table**: CSV or Excel. See [Export options](#export-options)
- **Export chart as PNG**
- **Print / Save as PDF**

---

## Consolidation accounts

View budget data grouped by consolidation account, with chart type adapting to the year range.

### Controls

- **Line type**: **All**, **OPEX** or **CAPEX** (see [Choosing the type of lines](#choosing-the-type-of-lines))
- **Measure**: **Amount** or **FTE** (see [Choosing amount or FTE](#choosing-amount-or-fte))
- **Start year** and **End year**: Previous, current, or next year
- **Metric**: Any shown budget column. Starts on the default column
- **Chart type**: Pie chart or horizontal bar chart (only available when a single year is selected)
- **Exclude accounts**: Multi-select autocomplete to exclude specific accounts. Offers every account used by the report's lines, by name and number, whether or not you can open the chart of accounts. The list starts with "Unassigned": choosing it leaves out the lines without a consolidation account
- **Cost center**, **Run or build**, **Lines** and the analytics dimension filters: See [Cost center, run or build and analytics filters](#cost-center-run-or-build-and-analytics-filters)

### What you'll see

**Single-year mode**:

- Pie or horizontal bar chart of totals by consolidation account
- Footnote with the total for the selected metric

**Multi-year mode**:

- Line chart with one series per consolidation account, plotted across years

**Table**: One row per consolidation account with year columns. A pinned totals row at the bottom sums all groups. A consolidation account opens the list of the lines on its accounts in a new tab ("Unassigned": the lines whose account has no consolidation account, and the lines without an account). See [Opening the list from a report](#opening-the-list-from-a-report). The totals row is plain text.

A line on a consolidation account that has since been disabled still counts, under that account's own consolidation line. Account names and numbers show only when you can read the [chart of accounts](chart-of-accounts.md); without that access, every line appears under "Unassigned" instead (the totals are still right, only the breakdown by account is hidden). Lines without a consolidation account also appear as "Unassigned". The consolidation accounts are the accounts of your [consolidation chart](chart-of-accounts.md#the-consolidation-chart).

---

## Analytics dimensions

View budget data grouped by the values of one analytics dimension. The layout mirrors the Consolidation accounts report. See [Analytics dimensions](analytics.md) to set up dimensions and values.

### Controls

- **Line type**: **All**, **OPEX** or **CAPEX** (see [Choosing the type of lines](#choosing-the-type-of-lines))
- **Measure**: **Amount** or **FTE** (see [Choosing amount or FTE](#choosing-amount-or-fte))
- **Dimension**: the dimension the report groups on. It offers the enabled dimensions used for the selected line type, shows when there are two or more, and the report opens on the default dimension. Switching the line type to one that does not use the chosen dimension returns to the default dimension. The page address keeps your choice, so a bookmarked or shared link opens on the same dimension
- **Start year** and **End year**: Previous, current, or next year
- **Metric**: Any shown budget column. Starts on the default column
- **Chart type**: Pie chart or horizontal bar chart. Available for a single year, when **OPEX / CAPEX split** is off
- **Detail by line**: lists the lines of each value under it
- **OPEX / CAPEX split**: adds the OPEX and CAPEX shares of each value. Available with the **All** line type only
- **Exclude values**: Multi-select autocomplete to exclude specific values of the chosen dimension. It offers the values used for the selected line type, plus the values the report's lines hold. The list starts with "Unassigned": choosing it leaves out the lines without a value on the dimension. Switching the line type or the dimension clears it
- **Cost center**, **Run or build**, **Lines** and the analytics dimension filters: See [Cost center, run or build and analytics filters](#cost-center-run-or-build-and-analytics-filters)

The subtitle, the chart title and the first column of the table name the chosen dimension, for example "OPEX by Nature". The page address also keeps the two boxes, so a shared link opens with the same detail and split.

### What you'll see

**Single-year mode**:

- Pie or bar chart of totals by value. The bar chart is as tall as its bars need
- With **Detail by line**, the chart shows the lines ("BL-12 · name") instead of the values
- With **OPEX / CAPEX split**, one horizontal bar per value, scaled to 100 %: its OPEX part and its CAPEX part, each with its percentage. A **Total** bar comes first when there are two values or more, and a legend names OPEX and CAPEX. With **Detail by line** as well, the bars stay one per value
- Footnote with the metric total

**Multi-year mode**:

- Line chart with one series per value, or one per line with **Detail by line**. The split does not change the chart: the table gives it

**Table**: One row per value with year columns, and a **Lines** column with the number of lines of each value. A pinned totals row at the bottom, with the total number of lines. Lines without a value on the chosen dimension appear as "Unassigned".

With **Detail by line**, the lines of each value appear indented under it, "Unassigned" included, with these columns:

- **Level**: **Value** or **Line**
- **Ref**: the line's reference, which opens the line in a new tab
- **Nature**: **OPEX** or **CAPEX**
- **Share of total** for each year: the line's share of its value's total

Column sorting is off while rows are nested under the values.

With **OPEX / CAPEX split**, each year gets an **OPEX share** and a **CAPEX share** column, on every value and on the totals row. With the detail, each line shows 100 % in its own nature.

A value opens the list of its lines in a new tab ("Unassigned": the lines without a value). With the **FTE** measure, the list shows the value's lines that declare FTE. See [Opening the list from a report](#opening-the-list-from-a-report). The totals row is plain text.

**Limited data access**: a person with limited [data access](data-access.md#what-a-limited-person-sees) sees a mention under each value, for example "and 3 lines outside your access". With the detail, it comes after the value's lines. The count follows the line type and the years of the report, and ignores the filters. "Unassigned" shows no mention.

The CSV or Excel export holds the **Lines** column, and the detail and the split when they are on. Printing and the export leave out the mentions of lines outside your access.

---

## Staffing by month

See how many people each part of the budget plans, month by month. The report reads the monthly FTE that the quantity and price lines of a budget column declare. See [Quantity and price](budget-lines.md#quantity-and-price) and [FTE](budget-lines.md#fte).

### Controls

- **Line type**: **All**, **OPEX** or **CAPEX** (see [Choosing the type of lines](#choosing-the-type-of-lines))
- **Cost center**, **Run or build**, **Lines** and the analytics dimension filters: See [Cost center, run or build and analytics filters](#cost-center-run-or-build-and-analytics-filters)
- **Year**: Previous, current, or next year
- **Column**: Any shown budget column. Starts on the default column
- **Group by**: **Cost center** (the default), **Line**, **Supplier** or **Analytics dimension**
- **Dimension**: the dimension the report groups on, with **Analytics dimension**. It offers the enabled dimensions used for the lines of the report and shows when there are two or more. The report opens on the default dimension

The page address keeps the grouping (`?group=item`, `?group=supplier` or `?group=axis:<dimension id>`), so a bookmarked or shared link opens on the same grouping. Without it, the report groups by cost center.

### What you'll see

**Chart**: Stacked areas over the twelve months, one for each of the eight largest groups by average. The other groups add up in one **Others** area. The title names the type, the grouping, the column and the year, for example "OPEX staffing by cost center, Budget 2026". Hover a month to read a group's FTE.

**Table**: One row per group that declares monthly FTE, the largest average first:

- The group: a cost center, a line, a supplier or a value of the dimension. Lines without a cost center appear as "No cost center", without a supplier as "No supplier", and without a value on the dimension as "No value"
- One column per month
- **Average**: the sum of the twelve months divided by 12. This is the full-year average FTE the column declares
- **Peak**: the highest month

A pinned **Total** row gives the monthly totals, their average and their peak. Values show with two decimals. Only declared FTE count: lines without quantity and price lines in the column are left out.

A group name is a link that opens in a new tab. A line opens its page. A cost center, a supplier or a value opens the budget lines list on the group's lines that declare FTE, in the report's window and narrowed by the filter bar (see [Opening the list from a report](#opening-the-list-from-a-report)). "No cost center", "No supplier" and "No value" open the lines without one. The **Total** row is plain text. The export keeps the plain names.

### Notices

One line under the table for each case, when it applies:

- "2 lines declare 1.50 FTE while their amount no longer follows their quantity and price lines." The amount was spread, its months were edited by hand, or the column was copied. This line covers the lines that have monthly detail, and their FTE still counts in the months. Lines without monthly detail appear in the next line only. See [Choosing amount or FTE](#choosing-amount-or-fte).
- "1 line declares 3.00 FTE without monthly detail. It is not in the months." These lines declare a full-year FTE but no FTE per month. They are left out of the months, the average and the peak.

### Export

- **Export table**: CSV or Excel. The file name carries the type, the year, the column, the grouping and the day of the export, for example `staffing-opex-2026-budget-cost-center-2026-10-27.xlsx`
- **Export chart as PNG**: The type, the year, the column and the grouping, as a PNG image
- **Print / Save as PDF**

---

## Cost per FTE

See what one FTE costs in each part of the budget, and how that cost moves across budget columns and years. The report divides the cost of the quantity and price lines in people or days by their FTE. It can also show the average daily rate of the lines priced per day (see [Daily rate](#daily-rate)). See [Quantity and price](budget-lines.md#quantity-and-price) and [FTE](budget-lines.md#fte).

### Controls

- **Line type**: **All**, **OPEX** or **CAPEX** (see [Choosing the type of lines](#choosing-the-type-of-lines))
- **Cost center**, **Run or build**, **Lines** and the analytics dimension filters: See [Cost center, run or build and analytics filters](#cost-center-run-or-build-and-analytics-filters)
- **Group by** and **Dimension**: the same choices as in [Staffing by month](#staffing-by-month). The page address keeps the grouping in the same way
- **Show**: **Cost per FTE** (the default) or **Daily rate**. Switching keeps the type, the grouping, the pairs and the filters. The page address keeps the daily rate (`?view=rate`), so a bookmarked or shared link opens on it
- **Columns**: one to four pairs of a year and a budget column. The years go from two years back to two years ahead. **Add** adds a pair, and the remove button next to a pair removes it. The report opens on the default column for last year and this year. The table and the chart show the pairs in chronological order

### What is counted

- The cost and the FTE of the lines in people or days. Lines in pieces are left out of both.
- The report reads the results of the lines, also when the column's amount no longer follows them (the amount was spread, its months were edited by hand, or the column was copied). The cost is then the cost of the lines.
- The cost is converted to the reporting currency at the rate of each year's version, like every amount in the reports.
- Lines that declare FTE without line detail are left out. A notice names them (see below).

### What you'll see

**Table**: One row per group with staff FTE in at least one pair, the largest FTE first. The FTE compared are those of the earliest pair where a group has staff FTE, so a budget that plans staff for this year only still sorts by FTE. Without any staff FTE, the rows go by name. Each pair has three columns under its name, for example "Budget 2026":

- **FTE**: the full-year average FTE of the lines
- **Staff cost**: the cost of the same lines for the year, in the reporting currency
- **Cost per FTE**: the staff cost divided by the FTE. The cell is empty when the FTE is 0 or when the group has no staff lines in that pair

Groups are named as in Staffing by month ("No cost center", "No supplier", "No value"). A pinned **Total** row gives, for each pair, the total FTE, the total staff cost and the total staff cost divided by the total FTE.

In both views, a group name opens its line, or the list of the group's lines that declare FTE, in a new tab, as in [Staffing by month](#staffing-by-month).

**Chart**: Horizontal bars of the cost per FTE, one bar for each pair. The first category is the total, followed by the first ten groups of the table. The title names the type and the grouping, for example "OPEX cost per FTE by cost center". Hover a bar to read the group, the pair, the cost per FTE, the FTE and the staff cost.

### Notices

One line under the table for each case, when it applies. Each line names the pairs concerned:

- "Amount no longer follows the lines for: Budget 2026 (2 lines, 1.50 FTE). These figures use the cost of their lines." These columns count with the cost of their lines. See [Choosing amount or FTE](#choosing-amount-or-fte).
- "No line detail for: Budget 2025 (1 line, 0.50 FTE). They are left out of these figures." These lines declare a full-year FTE but keep no result per line, so the report cannot read their cost.

### Daily rate

Choose **Show** > **Daily rate** to see the average daily rate of each group in place of the cost per FTE.

- Only the lines priced per day count: people priced per day and days bundles. The rate is their cost divided by the days they buy, so each line weighs by its days.
- Lines priced per month have no daily rate. They are left out, and a notice gives their cost (see below).
- As for the cost per FTE, the report reads the results of the lines and converts the cost to the reporting currency.

**Table**: One row per group with days in at least one pair, the most days first. The days compared are those of the earliest pair where a group has days. Each pair has three columns under its name:

- **Days**: the days bought by the lines priced per day
- **Day cost**: the cost of the same lines for the year, in the reporting currency
- **Daily rate**: the day cost divided by the days. The cell is empty when the days are 0 or when the group has no lines priced per day in that pair

A pinned **Total** row gives, for each pair, the total days, the total day cost and the total day cost divided by the total days.

**Chart**: The same horizontal bars, with the daily rate. The title names the type and the grouping, for example "OPEX daily rate by cost center". Hover a bar to read the group, the pair, the daily rate, the days and the day cost.

**Notices**: The two notices above, and one more line when some people lines are priced per month: "Lines priced per month are not in the daily rate: Budget 2026 (180 000)." The amount is the cost of those lines in each pair concerned, in the reporting currency.

### Export

- **Export table**: CSV or Excel. The file name carries the type, the grouping, the first pair and the day of the export, for example `cost-per-fte-opex-cost-center-2025-budget-2026-10-27.xlsx`. In the daily rate it starts with `daily-rate`, for example `daily-rate-opex-cost-center-2025-budget-2026-10-27.csv`
- **Export chart as PNG**: The type, the grouping and the first pair, as a PNG image
- **Print / Save as PDF**

---

## Ask the assistant

[Plaid](ai-assistant.md) gives the figures of these reports, with the same rights: Consolidation accounts, Top increase / decrease (10 lines by default), Staffing by month (each month, the average and the peak), Cost per FTE, Global chargeback and Company chargeback. It also measures several columns or years in one answer, for example the budget of each supplier over three years. On the chargeback, it covers OPEX and CAPEX when you name neither, and repeats the warnings of the report. Ask, for example: "Which lines rise the most from the 2026 budget to the revision?" or "How much is charged to each company in 2026, and how much does each one pay?"

Plaid reads every budget line, ended lines included. The budget reports read the lines still active on 1 January of the year before the first year shown, so a line that ended earlier counts in Plaid's answer and not in the report.

## Common features

Every report shares these capabilities through the shared toolbar:

### Export options { #export-options }

- **Export table** (download icon): opens a menu with **CSV** and **Excel (.xlsx)**. Your browser remembers the last choice and highlights it
- **Export chart as PNG** (image icon): Downloads the chart as a PNG image
- **Print / Save as PDF** (print icon): Opens the browser print dialog. You can also append `?print=1` to any report URL to trigger printing automatically on load.

KANAP builds the table file from the same figures as the screen, with the filters on screen:

- **Values**: amounts carry their cents, FTE and days their decimals, shares are percentages. The screen rounds them for reading; the file keeps the values, so a sum in Excel matches the report.
- **Order**: the rows come in the report's own order. A sort you click in a column header stays on the screen.
- **Language**: the headers, the group names ("No cost center") and the dates follow the language of your screen. A CSV file also takes that language's separator and decimal mark (see [CSV and Excel files](csv-files.md)).
- **Excel**: one sheet per table, with the total rows in bold after the data. A sort or a filter in Excel leaves the totals in place. A last sheet, **Parameters**, lists the filters applied, the date and time of the export in your time zone, and your name.
- **Limited data access**: for a person with limited [data access](data-access.md), the file counts the lines they see and holds no total row. The **Parameters** sheet says **Computed on your access**.

Every table export is recorded in the [audit log](admin.md#audit-log).

Exported file names carry the column name, for example `top10-opex-2026-budget-bar.png`, and a table file ends with the day of the export. With the FTE measure, the names carry `-fte`, before the day for a table file.

### Available metrics

Every metric or column selector offers the same budget columns: the ones your organisation shows, under their names. With the standard settings these are Budget, Revision, Actuals and Expected landing. Forecast is offered when it is shown. See [Budget columns in reports](#budget-columns-in-reports).

### Navigation

To switch reports, click **Reporting** in the left panel to return to the hub.

---

## Tips

- **Start with Global chargeback**: Get the big picture of allocations before drilling into a single company.
- **Use Top lines for quick wins**: The largest cost lines are your first candidates for optimization.
- **Compare Budget vs Expected landing**: Use the Budget column comparison report to measure forecast accuracy across years.
- **Toggle sections on chargeback reports**: The checkbox controls let you focus on just the data you need (departments, lines, KPIs, or flows) without visual clutter.
- **Year grouping in Budget column comparison**: When comparing the same metric across multiple years, enable year grouping for a cleaner line chart.
- **Export for presentations**: Charts export as PNG and tables as CSV or Excel, ready for slides or spreadsheets.
