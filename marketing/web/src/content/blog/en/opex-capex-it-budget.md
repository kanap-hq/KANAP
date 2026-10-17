---
title: "OPEX and CAPEX in one IT budget that finance can read"
description: "Operating and capital spending in a single list, classified with the dimensions finance asks for: purpose, priority, program. The reports follow."
date: 2026-10-17
topic: cost
author: Friedrich
authorRole: Founder, CIO
draft: false
translationKey: opex-capex-it-budget
series:
  key: opex-budget
  part: 4
  title: "Building the IT budget"
---

The operating budget on one side, the capital plan on the other. Two files, two calendars, two people who keep them. And a finance team that asks the same questions every year: how much is operating, how much is investment, what is it for, and what does this program really cost, all in?

Every answer goes through a manual consolidation. KANAP starts from a simple principle: one budget, two kinds of spending, and one classification that IT and finance share.

## OPEX or CAPEX, the rule in plain words

**OPEX** keeps the information system running during the year: subscriptions, maintenance, recurring services. **CAPEX** creates or improves an asset used over several years: servers, workstations, capitalized development. What gets capitalized follows the company's accounting rules, which finance sets with IT.

A second question often gets mixed with the first: run or build? Run keeps existing services going, build creates or changes them. A build project often carries both kinds of spending: capitalized development in CAPEX, training and change management in OPEX. KANAP keeps both answers on every line, in two separate fields.

## One list, one workspace

In KANAP, the type is a field of the budget line. OPEX and CAPEX lines sit in the same list, under **Budget management > Budget lines**, with a single series of references (`BL-12`). They have the same five budget columns per year, the same allocations across companies and departments, the same links to applications, projects, contracts and suppliers. The filter of the **Type** column isolates one kind or the other in one click.

![The budget lines of Fromage & Co: OPEX and CAPEX lines together, with the Type column](/screenshots/blog/opex-capex-list-2026-10-17.png)

The type sets what it needs to set, and nothing more:

- **Accounts**: each account of the chart of accounts serves OPEX, CAPEX or both. A CAPEX line only offers capital accounts.
- **Analytics dimensions**: a dimension or a value can be kept for one type (see below).
- **Chargeback**: the chargeback reports offer OPEX, CAPEX or both.
- **Freezes**: a budget column is frozen per year and per type. The approved capital budget can be locked while the operating budget is still in preparation.

A single budget file brings both types in and out, with a `nature` column. A budget prepared in a spreadsheet loads in one go.

## Dimensions, the shared language of IT and finance

Analytics dimensions classify lines for reporting, next to the accounting structure (the details are in [Analytics dimensions: what security really costs IT](/blog/analytics-dimensions-for-your-it-budget)). Each dimension answers one question. Here are the ones finance asks about investment, and the setting that answers each.

**"What is this investment for?"** A **Purpose** dimension: replacement, capacity, productivity, security, compliance, growth. Keep it for CAPEX lines and make it required: every new investment arrives classified, whether it is created on screen, loaded from a file, prepared by Plaid or sent through the API. No more chasing a forgotten column.

**"What can't we cut?"** A **Priority** dimension: mandatory, high, medium, low. It is what structures the trade-offs in committee. At Fromage & Co, our sample company, mandatory investments weigh €1.13M out of €2.35M in 2026: the S/4HANA migration, the data center refresh and the plant network segmentation.

**"What does this program cost, all in?"** A **Budget reference** dimension, used by OPEX and CAPEX alike, with one value per program. The Fromage & Co S/4HANA program brings together €704k of contractors and support in operating spending and €757k of investment (integration, capitalized development, HANA servers): €1.46M for the year, in a single report. When the program ends, the value is disabled: it stays on the lines and in past reports, and is no longer offered.

**"What kind of spending is it?"** **Cost pool** and **IT tower**, two recommended dimensions from the TBM model (Technology Business Management), shared by both types. A value can be kept for one type: internal labor, for example, for OPEX only.

![The Properties panel of a CAPEX line: capital account, Purpose, Priority and Budget reference filled in](/screenshots/blog/opex-capex-line-properties-2026-10-17.png)

The link with accounting goes through the accounts, set per type, and the group's consolidation accounts. Dimensions remain a reading tool: they leave accounts and allocations untouched.

Finance gains rules that enforce themselves. A dimension can be renamed, reordered or given an end-of-validity date without losing history, and the audit log keeps track of the changes.

## Reports: All, OPEX or CAPEX

Eight reports open on three tabs, **All**, **OPEX** and **CAPEX**: top lines, top increases and decreases, budget comparison, budget column comparison, consolidation accounts, analytics dimensions, headcount by month and cost per FTE.

Filters combine: cost center, run or build, and one value per dimension. The 2026 CAPEX grouped by purpose, the cost of a program on the **All** tab, only the mandatory investments of one subsidiary: each view takes a few clicks.

![The Analytics dimensions report on the 2026 CAPEX of Fromage & Co, grouped by Purpose](/screenshots/blog/opex-capex-report-purpose-2026-10-17.png)

In the example, replacement accounts for 59% of the 2026 investment, growth for 36% and security for 5%. It is the kind of figure an executive committee asks for, and here it comes without rework.

The page address keeps the type and the filters. The link sent to the financial controller opens exactly the same view, and the PDF export can be presented as is. The chargeback reports also offer OPEX, CAPEX or both; CAPEX counts there for its amount of the year.

## When spending changes type

A service turns out to be capitalizable, an investment turns back into operating spending. On the line, **Change type...** makes the change cleanly:

- **From the line's first year**, the line itself changes type. It keeps its reference, budgets, allocations and links.
- **From a later year**, the line ends on December 31 of the previous year and keeps its history. A new line of the other type takes over, with the links to applications, contracts and projects. The two lines stay connected: "Replaced by" on one side, "Follows" on the other.

![The Change type window of a budget line: starting year, account, dimensions and reason](/screenshots/blog/opex-capex-change-type-2026-10-17.png)

The window asks for an account that suits the new type and for the required dimensions that apply to it. The reason for the change goes to the audit log. A frozen budget stays intact: the change is refused while a frozen column holds amounts on the years concerned.

## What KANAP does not do

KANAP does not compute depreciation and does not keep the fixed asset register: that is the job of accounting and the ERP. KANAP prepares and tracks the IT budget, OPEX and CAPEX, classified the way finance asks. The budget file exports the amounts to an ERP or a BI tool.

## Where to start

1. List with finance the questions the budget must answer.
2. Set the accounts per type, then the dimensions: which ones for CAPEX, which ones for both, which ones required.
3. Load the existing budget through the budget file, OPEX and CAPEX in the same file.
4. Bookmark the useful report views and share their links.

The sample data of a trial, the fictional Fromage & Co group, includes an OPEX and CAPEX budget already classified on these dimensions: enough to see all of this before loading your own. KANAP can also be installed for free on your own servers ([see the offer](/offer)).
