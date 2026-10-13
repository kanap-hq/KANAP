---
title: "Analytics dimensions: what security really costs IT"
description: "Chargeback says who pays; an analytics dimension says what the spend is for: security, cloud, licences. How to use it in the IT budget."
date: 2026-09-13
topic: cost
author: Friedrich
authorRole: Founder, CIO
draft: false
translationKey: analytics-dimensions-for-your-it-budget
---

To the question "who pays for this licence?", chargeback tools answer without hesitating. But to the question "how much does cyber security cost us, all suppliers combined?", we often have no answer.

Analytics dimensions bring that second reading. Each dimension is one way of classifying lines, with its own values: what the money pays for, the part of IT it serves, why it is spent. A new workspace starts with four of them, all optional.

## The mechanics in KANAP

### Dimensions and their values

Head to **Master data > Analytics dimensions**. A bar at the top lists the dimensions; click one to see its values. A new workspace comes with four recommended dimensions, each with values and a one-sentence description:

- **Cost pool**, the default dimension: what the money pays for (Hardware, Software, External labor, Outside services...).
- **IT tower**: the part of IT the spend serves (Compute, Network, End user, Application, Security and compliance...).
- **Purpose**: why the money is spent (Replacement, Capacity, Productivity, Security, Compliance, Business growth).
- **Priority**: Mandatory, High, Medium or Low.

![The Analytics dimensions page: the dimension bar with Cost pool selected, and its eight values with their descriptions](/screenshots/blog/analytics-dimensions-2026-10-13.png)

Cost pools and IT towers follow the TBM (Technology Business Management) model. Rename, reorder or disable what does not fit. A workspace created earlier adds them with **Recommended dimensions**. **New** creates a dimension of your own, and **New value** adds a value to the selected one.

Five to ten broad values per dimension are usually enough. Past twenty, the dimension tries to answer too many questions: split it in two. The description is mostly for your colleagues: "Contractors and consultants billed for their time" reads better than "Ext."

### Classifying a line

In the **Properties** panel of a budget line, each dimension has its own field, for example **Cost pool** or **IT tower**. Pick a value, or leave it empty for "Unassigned". The value applies to the whole line, across every fiscal year.

![The Properties panel of a budget line: Hardware on Cost pool, Compute on IT tower, Replacement on Purpose and Mandatory on Priority](/screenshots/blog/analytics-line-properties-2026-10-13.png)

A line holds one value per dimension: **Software** on Cost pool and **Application** on IT tower at the same time. Each dimension answers one question, and the report crosses them.

Two points to keep in mind:

- **No impact on allocations**, and none on formal accounting. The paying company, the account and the allocation drivers do not move. Analytics dimensions are for reporting only.
- **Departments and dimensions are not in the same league.** Departments are formal organisational units with precise allocation drivers. Analytics dimensions are informal, optional classifications with no allocation overhead.

To retire a value or a dimension, disable it: lines keep their value and past reports stay accurate. Deleting is possible, after a confirmation that counts the lines that lose their value.

In the budget lines list, each dimension has its own optional column. It sweeps every line of a value at a glance: "Which lines are External labor?".

## The Budget by analytics dimension report

The report lives under **Reporting > Analytics dimensions**.

- **Line type**: all lines, OPEX or CAPEX.
- **Dimension**: the dimension to group on, Cost pool to start with.
- **Single year**: pie or horizontal bar chart, your choice.
- **Multi-year range**: a line chart, one line per value.
- **Metric**: any budget column you show (budget, revision, actuals, expected landing).
- **Exclude values**: to focus on a subset.
- **Outputs**: summary table, CSV export of the table, PNG of the chart, full PDF.

![The report for 2026: 12.1 M EUR of OPEX budget split across the values of Cost pool](/screenshots/blog/analytics-report-2026-10-13.png)

In the 2026 fiscal year, external labor alone takes 54% of the OPEX budget. Software follows at 26%, then outside services at 11%.

In the multi-year view, the report becomes a trend tool. One line takes off, another fades, and the decision is discussed on facts.

![The same report from 2025 to 2026: one line per value of Cost pool](/screenshots/blog/analytics-report-range-2026-10-13.png)

"Unassigned" is a valid state. Values are optional, and a line without one simply shows up on that line of the report.

<aside class="tip">
  <b>Tip</b>
  <p>The report exports to PDF and can be presented as is in a budget review. Combined with the chargeback reports, you have every facet of your budget at hand.</p>
</aside>

## Hidden costs

The pie surfaces what the "top 10" lines hide. The value that grew too big to be honest. Two values that describe almost the same thing and would be better merged. The Capacity purpose that starts at zero in 2025, a trace of a line that appeared along the way. Or HR, on the Business domain dimension, moving from 468,500 EUR to 574,570 EUR in one year (+23%), while the OPEX budget grows by 13%.

This is also where the two readings cross. Security and compliance, on IT tower, accounts for 8% of the OPEX budget. The chargeback report says which subsidiary carries it. The CIO then holds a short, verifiable sentence in a budget review: here is what we spend, what for, and who pays.

## What about CAPEX?

Dimensions apply to OPEX and CAPEX lines alike, unless you set one to a single type. An investment project therefore reads with the vocabulary of recurring spend, and the two envelopes stay comparable.

That is the point of a shared nomenclature: the question "how much does security cost?" is asked the same way about a recurring licence and about an equipment project.

## Where to start

1. Review the four recommended dimensions and rename or disable the values you do not need.
2. Classify the ten heaviest lines first. The report becomes useful at that step.
3. Leave the rest as "Unassigned", then classify as you go.
4. Cross the report with the chargeback reports: who pays on one side, what for on the other.
5. Re-run the report at every budget review. Split a value that is too broad, merge two that are too fine.

Analytics dimensions complement the allocation of IT costs (see [IT cost chargeback: who pays what, and why](/blog/it-cost-chargeback-made-simple)) and give you the visibility you need to prepare, analyse and defend your budget.
