# Reporting Guidelines (Phase 1 foundation)

This document describes how the Reporting section is structured, what is implemented in Phase 1, and how to add new reports that follow the same logic and styling. It also lays groundwork for Phase 2.

## Overview

- Tech: React + MUI, AG Grid (tables), AG Charts CE (charts).
- Navigation: `Reporting` in the main nav → landing page with report cards.
- Currency: Report totals display in the tenant reporting currency; raw values remain available for exports/tooltips.
- Files:
  - Pages: `frontend/src/pages/reports/*`
  - Shared: `frontend/src/components/reports/ReportLayout.tsx`, `ChartCard.tsx`
- Data hooks: `frontend/src/pages/reports/useOpexSummary.ts`, `frontend/src/pages/reports/useCapexSummary.ts`
- Print CSS: `frontend/src/styles/print.css`

### Disabled Date Behaviour (Year-Aware)

- Fiscal year = calendar year (Jan 1–Dec 31).
- Entities with a `disabled_at` date are included in reports through the fiscal year of their disabled date and excluded for strictly later years.
  - Example: `disabled_at = 2025-06-30` → included in 2025 reports; excluded from 2026+.
- Summary endpoints (OPEX/CAPEX): when lifecycle status is neutral, we gate item inclusion with a period start derived from the earliest year in scope:
  - Condition: `(disabled_at IS NULL OR disabled_at >= :period_start)` with `period_start = ${minYear}-01-01T00:00:00.000Z`.
- Allocation recipient sets (companies/departments) and chargeback item joins use the same year-aware rule for each version’s year.
  - This ensures shares and chargeback totals reflect the recipients/items valid for the given budget year.
- Implementation helpers and references:
  - Shared: `backend/src/common/status-filter.ts` (period-aware condition builder)
  - OPEX summary: `backend/src/spend/spend-items.service.ts` and `backend/src/spend/spend-summary.builder.ts`
  - CAPEX summary: `backend/src/spend/spend-items.service.ts` (`CapexItemsService`, the same service on the CAPEX lines)
  - OPEX and CAPEX allocations: `backend/src/spend/allocation-calculator.service.ts` (one calculator for both natures)
  - Chargeback: `backend/src/spend/chargeback-report.service.ts`

## Phase 1 — Implemented Reports

- Top OPEX (`/reports/top-opex`)
  - Filters: Year, Top count (default 10), Chart type (Pie or Horizontal bar), item exclusions, account exclusions.
  - Chart: pie (default) or horizontal bar; both share tooltips (budget + share) and a footnote for total budget.
  - Table: Product, Budget (Y), Share of total; grid auto-sizes to display all rows. Snapshot totals (Top selection, Total budget) are rendered beneath the grid instead of pinned rows.
  - Layout: single column; chart full width, then table with summary cards.
- Top OPEX Increase/Decrease (`/reports/opex-delta`)
  - Filters: Year, Reference metric (Y-1 Budget/Landing), Mode (Increase/Decrease), Top count, Chart type, item exclusions, account exclusions.
  - Chart: pie or horizontal bar (shares the same tooltip logic); footnote shows total change of the selected top items.
  - Table: Product, Ref (Y-1), Budget (Y), Delta, % increase; grid auto-sizes (no pinned totals). Summary cards below the grid surface the top selection totals, gross change, and net change.
  - Sorting: by Delta (desc for Increase, asc for Decrease).
  - Layout: single column; chart → table with summary cards.
- Budget Trend (OPEX) (`/reports/comparison`)
  - Filters: Start/End year (Y-2..Y+2), Metrics multi‑select (Budget, Follow‑up, Landing, Revision).
  - Table: one row per metric; columns per year; totals sum across all OPEX items.
  - Chart: line chart; one series per selected metric across the selected year range.
  - Layout: single column; chart → table.
- Budget Trend (CAPEX) (`/reports/capex/trend`)
  - Same as OPEX trend, backed by `useCapexSummaryAll()` (CAPEX data).
  - Metrics include Budget, Landing, Revision, Follow‑up (values may be 0 if not used).
- Budget Column Comparison (`/reports/budget-columns-compare`)
  - Scope: OPEX or CAPEX (toggle). Up to 10 selections. Each selection = Year + Column (Budget, Revision, Follow‑up, Landing).
  - UI: compact selection "pills" in the toolbar (Y + Col + remove), Add button, chronological rendering in chart/table.
  - Default chart: single line, X = selection labels, Y = totals.
  - Year grouping toggle:
    - When enabled and each selected column has at least 2 distinct years, switches to grouped view: X = year, series per column (distinct colors), only draw points where that year+column was selected (others are null).
    - Key table mirrors the mode: flat list per selection by default; pivoted table (rows = years, columns = selected columns) when grouped.
  - Exports: CSV exports the current table mode; chart PNG export available via toolbar.
- Budget by Consolidation Account (`/reports/consolidation`)
  - Filters: Start year, End year (from Y-1..Y+1).
  - Grouping: sums Budget totals by the account’s consolidation account fields; items without a consolidation mapping are grouped as “Unassigned”.
  - Chart: pie when a single year is selected (share of total), line with one series per consolidation account when a multi‑year range is selected.
  - Table: one row per consolidation account; columns per year; pinned bottom total row (“Total budget”).
  - Layout: single column; chart → table.

### Chargeback (Phase 2 foundation)

- Global Chargeback (`/reports/chargeback/global`)
  - Filters: Year, Column (budget/follow_up/landing/revision), section toggles (Detailed allocations, Company totals, KPIs).
  - Company section: grid of company totals (reporting currency) plus a horizontal bar chart mirroring the table; shown ahead of the detailed allocations.
  - Detailed table: grouped by company with subtotal rows, department lines underneath, and extra columns for headcount and cost-per-user (includes a “Common Costs” bucket when no department is assigned). Each row exposes both converted (`amount`) and raw (`amountRaw`) values.
  - KPI deck: tabular metrics per company (IT costs vs turnover, cost per user/IT user) with a totals row that recomputes ratios from the converted totals; raw fields are retained for CSV/analytics.
  - Exports: CSV wired to the detailed table; PNG export for the bar chart; print view leverages `ReportLayout`.
  - Backend: `GET /reports/chargeback/global` recomputes allocation shares from the active method, resolves FX rates per version, aggregates reporting currency totals alongside raw amounts (`total`, `totalRaw`), and enriches the result with headcount/IT user/turnover data (millions → absolute currency).
- Company Chargeback (`/reports/chargeback/company`)
  - Filters: Company, Year, Column (budget/follow_up/landing/revision), section toggles (Department totals, Chargeback items, KPIs).
  - Department totals: aggregates the selected company’s allocations per department with “Common Costs” capturing unassigned spend, plus a mirrored bar chart. Shares and cost-per-user values are computed from the reporting currency total while still exposing `amountRaw`.
  - Chargeback items: itemised spend contributing to the company chargeback with allocation method, share of total, and a pinned footer total (reporting currency). Raw totals remain available for exports.
  - KPI deck: mirrors the global layout but scoped to the selected company, and appends a global KPI comparison row. Ratios rely on converted totals; raw values persist for auditing.
  - Exports: CSV for department totals; PNG for the department chart.
  - Backend: `GET /reports/chargeback/company` surfaces department aggregation, itemised allocations, and KPI metrics for a single company with both reporting (`total`) and raw (`totalRaw`) amounts plus per-row dual currency fields.

## UI Conventions

- Breadcrumbs: always present via `ReportLayout` (back to `/reports`).
- Layout: single column; chart full width first, table full width second.
- Export actions:
  - Table CSV: `GridApi.exportDataAsCsv()` wired via `ReportLayout` props.
  - Chart PNG: `ChartCard.download()`; falls back to canvas capture if needed.
- Printing: only the report content prints (`.report-print-frame` in `print.css`). See [Printing and PDF](#printing-and-pdf).
- Number formatting: use a helper like `formatNumber()` (thousands separated by spaces, no decimals) for consistency.
- KPI tables: percentages display with two decimals; per-user costs are rounded to integers; totals rows recompute metrics from summed raw values to avoid rounding drift.
- Currency: report views always display the tenant’s reporting currency. Conversion happens server-side using the World Bank averages captured for each fiscal year (historic = annual average, current = live spot/annual fallback, forward = projected). The settings live under **Budget Management → Currency Settings**, which also exposes a “Force FX rates sync” action to refresh the current and next fiscal years on demand. For the full lifecycle (allowed lists, snapshots, freeze behaviour) see [`doc/currency-management.md`](./currency-management.md).

## Chart Patterns

- Pie charts:
  - `calloutLabelKey`: human label (e.g., product_name).
  - `sectorLabelKey`: value key; sector label `formatter` renders integer percentage when ≥ 5%.
  - Tooltip shows absolute value and percentage.
  - `legend`: disabled unless explicitly needed (use labels instead).
  - `footnote`: show totals (e.g., “Total Budget” or “Total Increase/Decrease”).
  - `animation`: enabled, ~800ms.
- Horizontal bar charts (alternative top-N view):
  - Axes: category on the left, number on the bottom with formatted labels.
  - Series: `type: 'bar'`, `direction: 'horizontal'`, value labels formatted with `formatNumber`.
  - Tooltip mirrors pie charts (absolute + percentage or increase/decrease wording).
  - For delta-style reports, feed signed values so decreases render as negative bars while tooltips surface the absolute change and share.
- Line charts:
  - One series per metric; `xKey` is `year`.
  - Legend enabled; subtitle lists selected metrics.

## Table Patterns

- Use AG Grid with minimal default column defs (sortable, resizable).
- Totals: surface aggregate snapshots beneath the grid (instead of pinned rows) so the table can auto-size and exports remain uncluttered.
- Sorting: set sort model via `api.setSortModel()` (or `applyColumnState` fallback) when a computed column is the primary ordering (see OPEX delta by `delta`).

## Top OPEX specifics

- Filters:
  - Year selector (previous, current, next) paired with a metric selector (`Budget`, `Revision`, `Follow-up`, `Landing`).
  - Top count number input, chart type switcher, item/account exclusion pickers – laid out in a wrapped flex row with responsive gaps so double rows do not overlap on smaller widths.
- Data shaping:
  - Values come from the selected metric within the chosen year slot (`pickYearSlot`).
  - Totals panel and chart subtitles dynamically reflect the metric label so exports and tooltips remain accurate.
- Exports suffix downloads with the metric key (e.g., `top10-opex-2024-budget-bar`) to remove ambiguity.

## Top OPEX Increase/Decrease specifics

- Filters:
  - Separate selectors for source (year + metric) and destination (year + metric) columns; defaults pick the latest budget pairs when available.
  - Increase/decrease toggle accepts one or both directions; when both are selected the default chart switches to horizontal bars and the pie option is disabled.
  - Chart type helper text clarifies why the pie option may be unavailable.
- Data shaping:
  - Rows carry both signed `delta` and absolute `magnitude` for chart/tooling needs.
  - Coverage snapshots surface gross increases, gross decreases, and net change alongside the top selection totals.
- Exports name files with source/destination slugs plus the selected direction mix for easier traceability.

## Data Access (Phase 1)

- Source: `GET /spend-items/summary?years=2024,2025,2026`
  - Returns per‑item derived totals with dynamic year support.
  - Optional `years` parameter: comma-separated list of years (defaults to Y-1, Y, Y+1 if omitted).
  - Response includes both legacy keys (`yMinus1`, `y`, `yPlus1`) and dynamic keys (`y2024`, `y2025`, etc.).
  - The hook `useOpexSummaryAll(years?)` paginates to fetch all items and accepts an optional years array; it no longer hardcodes a `status` filter because the backend includes items that were active within the requested years.
- Year slot mapping: `pickYearSlot(row, year)` retrieves year data using dynamic keys (e.g., `y2024`) with fallback to legacy keys for backward compatibility (shared by OPEX and CAPEX hooks).

### Data Access — Chargeback

- Global: `GET /reports/chargeback/global?year=2025&metric=budget`
  - Returns reporting totals (`total`), raw totals (`totalRaw`), `reportingCurrency`, and the `detailed`, `companies`, and `kpis` collections.
  - `detailed`: allocation rows per company/department (residual company costs emitted as “Common Costs”) with both converted (`amount`) and raw (`amountRaw`) values, plus headcount/cost-per-user metadata for subtotal calculations.
  - `companies`: per-company reporting totals feeding the grid and bar chart; `amountRaw` accompanies each record for exports.
  - `kpis`: enriched totals with raw amount (`amountRaw`) and turnover (`turnoverRaw`) for accurate ratio rollups; converted fields are pre-rounded to two decimals.
- Company: `GET /reports/chargeback/company?companyId=:id&year=2025&metric=budget`
  - Returns company summary, `departments`, `items`, and `kpis` for the selected company, alongside `total`, `totalRaw`, and `reportingCurrency`.
  - `departments`: per-department aggregation with reporting totals, raw totals, share of total, headcount, and cost-per-user metrics.
  - `items`: itemised allocations including allocation method labels, reporting totals, raw totals, and share of total.
  - `kpis`: single-row KPI view mirroring the global layout (amount, headcount, IT users, turnover, ratios) with dual reporting/raw fields for downstream processing.

## Adding a New Report (Checklist)

1) Create page: `frontend/src/pages/reports/MyNewReport.tsx`.
2) Add a card in `ReportsLandingPage.tsx` and a route in `App.tsx`.
3) Wrap with `ReportLayout` for breadcrumbs and export actions.
4) Fetch data (Phase 1: use `useOpexSummaryAll`; Phase 2+: use `/reports/aggregate`).
5) Build chart with `ChartCard`; follow the patterns above (pie or line) and use footnotes/tooltips consistently.
6) Build table with AG Grid; format numbers and add `pinnedBottomRowData` for totals.
7) Exports: wire `onExportTableCsv` and `onExportChartPng` from `ReportLayout`.
8) Print: ensure report content is inside `ReportLayout` so print CSS applies.
9) Sorting: if sorting by a derived field, set sort model via `api.setSortModel()`.

## Phase 2 — Foundation

To support arbitrary year ranges, groupings, and chargeback:

- `GET /reports/aggregate`: generic aggregator
  - Params: `metric`, `groupBy`, `year|fromYear&toYear`, `top`, `order`, `filters[...]`.
  - Returns: aggregated totals grouped by dimension (and optionally by year).
- `GET /reports/chargeback/global`:
  - Params: `year`, `metric`.
  - Returns: per-company summary, department allocations, and KPIs across all companies.
- `GET /reports/chargeback/company`:
  - Params: `companyId`, `year`, `metric`.
  - Returns: department rollups, allocation items, and KPIs for the selected company (used for invoicing detail).
- Performance: cache by tenant + params; consider materialized views for annual summaries and chargeback.

## Portfolio reports hub

The portfolio Reports hub (`frontend/src/pages/portfolio/ReportsPage.tsx`, route `/portfolio/reports`) is a landing page. It shows a steering strip and a to-classify strip (about one line each, side by side), then the report cards grouped by horizon: past, current, upcoming.

- Every new report view is its own page under `/portfolio/reports/<slug>`, wrapped in `ReportLayout`.
- A report gets one entry in `REPORT_SECTIONS` in the row it answers, with its title and description under `reports.cards.<key>` in the `portfolio` locale namespace.
- Only one-line strips with a few clickable figures may live on the hub itself. Multi-row tables and per-person views never do: they would push the cards below the fold and turn the landing page into one report.
- Two cards can open the same page in a different reading. The URL decides (for example `?groupBy=person`). The choice is not persisted.
- Filter options come from the catalogue (`GET /portfolio/reports/filter-values`), never from the rows currently displayed, so a value stays selectable after a filter hides its rows.

## Portfolio reports: data rules

Endpoints live under `portfolio/reports/` (`weekly`, `flow`, `upcoming`, `time-logged`, `capacity-heatmap`, `attention-by-assignee`, `steering-summary`, `classification-gaps`, `filter-values`). They follow these rules. A new report must too, or its totals will disagree with the lists it links to.

- **Source.** Period reports read `audit_log` for what happened and live tables for the current state. Every writer goes through the audited services, including CSV import and AI chat, so creations and status changes are all present. No report needs its own history table.
- **Dates.** Reports take the browser's IANA zone as a `tz` parameter and read their day and week boundaries in it. A missing or unknown zone falls back to UTC (`backend/src/common/report-period.ts`).
- **"Closed".** Tasks and projects are closed when `done` or `cancelled`. Requests are closed when `converted` or `rejected`. The steering strip and the period review use the same rule, so their figures link to each other without drift.
- **Tasks in steering** are standalone tasks and project tasks. Tasks attached to contracts, spend or capex items, or incidents are outside the portfolio.
- **Stale project.** A project without activity for 30 days (`STALE_PROJECT_DAYS`).
- **Classification is inherited.** A project task without its own source, category or stream takes its project's value. The task list filters on `COALESCE(t.source_id, pp.source_id)` (see `spend/tasks.service.ts`). A report that filters tasks by classification must use the same expression, otherwise the report total and the list total diverge under a filter.
- **Classification is null on some tasks.** It is allowed only on standalone and project tasks. The backend clears it on contract, spend, capex and incident tasks. A "missing classification" figure must exclude those, or it shows permanent false positives.
- **Actors.** `audit_log.source` says where a change came from (for example `ai_chat` or `system`). Changes written by system integrations carry no user. A task has one assignee, and a closure is attributed to the assignee at closing time.
- **Time data.** Hours live in `task_time_entries` and `portfolio_project_time_entries`. Monthly per-person totals are in `user_time_monthly_aggregates`. A task is "project" work when `related_object_type = 'project'`.
- **Links to lists.** Deep links carry the exact filter that produced the figure. An empty value is `values: [null]` (see `frontend/src/pages/portfolio/components/portfolioListLinks.ts`). Filters a list does not support in its UI are hidden list filters, kept out of the column chooser.
- **People.** Reports are team-first and alphabetical. They show no rankings and no per-person ratios.

## Printing and PDF

Every report prints as a clean light-themed document through the browser's print dialog or save as PDF. The pieces:

- **Print store** (`frontend/src/components/reports/reportPrint.ts`). A module-level store (`useReportPrinting`, `setReportPrinting`) rather than a context, so the page component that builds chart options can read it too. `useReportTheme()` returns the light theme on paper and the screen theme otherwise.
- **Entering print mode** (`ReportLayout`). The toolbar button, Ctrl/Cmd+P and `?print=1` call `requestPrint`: switch to print mode, wait for every chart to be redrawn at paper width (`prepareReportPrint`), then open the dialog. A print started from the browser menu still gets the switch, flushed synchronously on `beforeprint` because the browser lays out the pages right after the handlers return. `afterprint` restores the screen. The frame is wrapped in `lightIslandTheme` while printing, the breadcrumb and filter bar are hidden (`report-print-hide`), and the title shows a "printed on" date.
- **Grids** use `ReportGrid` (`components/reports/ReportGrid.tsx`) instead of a bare `AgGridReact`. On screen it is the live grid. On paper it renders a static `<table class="report-print-table">` built from the same column definitions: value getters and formatters, alignment, pinned bottom rows, row styles, two-row column groups and cell renderers. Every row and column prints, with repeated headers and a single footer.
- **Charts** use `PrintableChart` (used by `ChartCard` and directly by small-multiple layouts). A live canvas keeps its screen pixel size, so on paper it is replaced by a page-wide `<canvas>` copy (`drawImage`). The live chart stays mounted off-page, at `printWidth` (default `PRINT_CONTENT_WIDTH`, 700 px, the A4 content width), so it redraws in the light theme. Each chart registers a print preparer through `registerPrintPreparer`. The preparer waits until the live canvas measures `printWidth`, takes the copy, and never upscales it. Do not copy the canvas to an `<img>` data URL: the page can freeze before the image decodes and the chart prints blank.
- **Layout on paper** is decided in React from the `printing` state (for example a two-column layout for small multiples), with `frontend/src/styles/print.css` for page rules only (A4 margins, repeated `thead`, flat papers, no splitting of a canvas).
- **Rule of thumb.** Never rely on a fixed delay or on print-media CSS for something React can decide. A new chart must go through `PrintableChart`, and a new grid through `ReportGrid`.

To check a print headlessly, drive Chromium over the DevTools protocol, run the report, then call `Page.printToPDF` and rasterize the pages. `Page.printToPDF` fires `beforeprint`, so it exercises the same path as a user print. To test the toolbar path, stub `window.print`, click the print button, then call `printToPDF`. Compare the chart canvas `width` and `clientWidth` to confirm each copy was drawn at paper size.

## Testing & QA Notes

- Visual: chart labels readable, pie label threshold respected, footnotes shown.
- Exports: CSV reflects visible data; PNG works even when chart API is unavailable (fallback canvas capture).
- Print: only report content, not the shell.
- Sorting: derived sort (e.g., delta) applied correctly after data refresh and filter changes.
