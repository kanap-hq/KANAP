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

### Choosing OPEX or CAPEX

**Top items**, **Top increase / decrease**, **Consolidation accounts**, and **Analytics dimensions** each start with an **OPEX** / **CAPEX** switch, the first control of the filter bar.

- The report opens on a type you can read, OPEX first. A type you cannot read is disabled.
- The page address keeps the chosen type (`?scope=opex` or `?scope=capex`), so a bookmarked or shared link opens on the same type.
- The subtitle and the chart title name the type, so a printout or an exported PNG shows which type it covers.
- Switching the type clears the items you excluded, since each type has its own items.

The two chargeback reports cover OPEX only.

---

## Global chargeback

View cost allocations across all companies with summary KPIs and intercompany flows.

### Controls

- **Year**: Previous, current, or next fiscal year
- **Column**: Budget, Expected landing, Actuals, or Revision
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
- **Column**: Budget, Expected landing, Actuals, or Revision
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
- **Year**: Previous, current, or next year
- **Metric**: Budget, Revision, Actuals, or Expected landing
- **Top count**: How many items to show (default: 10, minimum: 1)
- **Chart type**: Pie chart or horizontal bar chart
- **Exclude items**: Multi-select autocomplete to exclude specific items
- **Exclude accounts**: Multi-select autocomplete to exclude specific accounts

### What you'll see

**Chart**: Pie or horizontal bar chart of the top items. Its title names the type, for example "Top 10 CAPEX · Budget 2026".

**Table columns**:

- Item
- Value for the selected metric and year
- Share of total (percentage)

**Summary cards below the table**:

- Top N total (with percentage of filtered metric)
- Total value for the selected metric across all items

### Use case

Use this report to quickly spot where most of your IT budget goes and identify candidates for cost optimization.

---

## Top increase / decrease

Identify the biggest OPEX or CAPEX changes between two budget columns (any combination of year and metric).

### Controls

- **Item type**: OPEX or CAPEX (see [Choosing OPEX or CAPEX](#choosing-opex-or-capex))
- **Source year** and **Source metric**: The baseline column to compare from
- **Destination year** and **Destination metric**: The target column to compare to
- **Top count**: How many items to show per direction (default: 10)
- **Chart type**: Pie chart (single direction only) or horizontal bar chart
- **Exclude items**: Multi-select autocomplete to exclude specific items
- **Exclude accounts**: Multi-select autocomplete to exclude specific accounts
- **Direction**: **Increases**, **Decreases**, or **Both** tabs

The year pickers list the years that hold data. The metric pickers offer the four report columns: Budget, Actuals, Expected landing, and Revision.

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

- **Start year**: Beginning of the range (current year minus 2 through plus 2)
- **End year**: End of the range
- **Metrics**: Multi-select from Budget, Actuals, Expected landing, Revision (at least one required)

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

- **Start year**, **End year**, **Metrics**: Same as the OPEX trend report

### What you'll see

- Line chart of CAPEX totals by metric across years
- Summary table with year columns

---

## Budget column comparison

Flexibly compare up to 10 year+column combinations for either OPEX or CAPEX.

### Controls

- **Item type**: OPEX or CAPEX toggle
- **Selections**: Each selection has a year picker and a column picker (Budget, Revision, Actuals, Expected landing). Add selections with the **Add** button and remove with the delete icon. Maximum of 10 selections; minimum of 1.
- **Year grouping** (checkbox): When enabled and at least two years share a metric, switches to a grouped line chart with one series per metric and years on the X axis. When disabled, shows a flat line chart with each selection as a data point.

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
- **Start year** and **End year**: Previous, current, or next year
- **Metric**: Budget, Actuals, Expected landing, or Revision
- **Chart type**: Pie chart or horizontal bar chart (only available when a single year is selected)
- **Exclude accounts**: Multi-select autocomplete to exclude specific accounts

### What you'll see

**Single-year mode**:

- Pie or horizontal bar chart of totals by consolidation account
- Footnote with the total for the selected metric

**Multi-year mode**:

- Line chart with one series per consolidation account, plotted across years

**Table**: One row per consolidation account with year columns. A pinned totals row at the bottom sums all groups.

Items without a consolidation account appear as "Unassigned".

---

## Analytics dimensions

View OPEX or CAPEX budget data grouped by analytics dimension. The layout mirrors the Consolidation accounts report.

### Controls

- **Item type**: OPEX or CAPEX (see [Choosing OPEX or CAPEX](#choosing-opex-or-capex))
- **Start year** and **End year**: Previous, current, or next year
- **Metric**: Budget, Actuals, Expected landing, or Revision
- **Chart type**: Pie chart or horizontal bar chart (single-year only)
- **Exclude analytics dimensions**: Multi-select autocomplete to exclude specific dimensions

### What you'll see

**Single-year mode**:

- Pie or bar chart of totals by analytics dimension
- Footnote with the metric total

**Multi-year mode**:

- Line chart with one series per analytics dimension

**Table**: One row per analytics dimension with year columns. A pinned totals row at the bottom. Items without an analytics dimension appear as "Unassigned".

---

## Common features

Every report shares these capabilities through the shared toolbar:

### Export options

- **Export table as CSV** (download icon): Downloads the primary table data
- **Export chart as PNG** (image icon): Downloads the chart as a PNG image
- **Print / Save as PDF** (print icon): Opens the browser print dialog. You can also append `?print=1` to any report URL to trigger printing automatically on load.

### Available metrics

All reports that offer a metric selector use the same four columns:

| Key | Label |
|-----|-------|
| `budget` | Budget |
| `revision` | Revision |
| `follow_up` | Actuals |
| `landing` | Expected landing |

### Navigation

Every report shows a breadcrumb trail back to the **Reporting** hub, so you can switch reports quickly.

---

## Tips

- **Start with Global chargeback**: Get the big picture of allocations before drilling into a single company.
- **Use Top items for quick wins**: The largest cost items are your first candidates for optimization.
- **Compare Budget vs Expected landing**: Use the Budget column comparison report to measure forecast accuracy across years.
- **Toggle sections on chargeback reports**: The checkbox controls let you focus on just the data you need -- departments, items, KPIs, or flows -- without visual clutter.
- **Year grouping in Budget column comparison**: When comparing the same metric across multiple years, enable year grouping for a cleaner line chart.
- **Export for presentations**: Charts export as PNG and tables as CSV, both ready for slides or spreadsheets.
