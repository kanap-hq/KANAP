# ADR 0001: Allocation Model and Yearly Metrics

- Status: accepted
- Date: 2025-11-09
- Owner: Team

## Context
The product needs a flexible way to allocate OPEX items across companies and departments, supporting default chargeback rules, headcount/IT users/turnover drivers, and manual overrides. We also need stability over time and clear, auditable behavior.

## Decision
- Per-row allocation method on `spend_versions`:
  - `default|headcount|it_users|turnover|manual_company|manual_department`
- Auto methods (default/headcount/it_users/turnover):
  - Allocate the remainder (or full 100% if no rows provided) across enabled companies using metrics for the version’s year
  - Metrics can be frozen centrally; freeze only blocks edits, not calculations
- Manual methods:
  - Manual by Company: explicit company rows sum ≈100%; add “Allocate by” driver (Headcount/IT users/Turnover) for recalculation; quick “Reset” to default prefill; auto-recalc on add/remove/change; manual % edits do not trigger recalc
  - Manual by Department: explicit department rows sum ≈100%; auto-recalc on add/remove/change using department headcount; no prefill
- Yearly metrics:
  - `company_metrics`: headcount (int), it_users (int), turnover (numeric with 3 decimals); freeze state managed via `freeze_states`
  - `department_metrics`: headcount (int); freeze state managed via `freeze_states`
- Default rule per tenant/year (`allocation_rules`): method in {headcount,it_users,turnover}; `default` resolves via this rule
- Schema updates:
  - `spend_versions`: + `allocation_method`
  - `spend_allocations`: `department_id` nullable; removed `driver_type`/`driver_note`

## Consequences
- Clear separation of concerns: master data vs. yearly metrics vs. allocation behavior
- Backwards-compatible: default rule is headcount; manual methods provide explicit control
- Reporting: allocation shares are recomputed on demand from the active method and metrics, ensuring reports stay aligned with the latest master data while keeping manual overrides auditable

## Note (2026-10-12): CAPEX lines in the chargeback
Since the unified budget, OPEX and CAPEX lines share `spend_versions` and the same allocation model. The chargeback reports take a scope: OPEX (the default, the report as before), CAPEX, or both. A CAPEX line is spread on its amount of the year in the chosen column, with its own allocation or the year's default rule. Depreciation plays no part in the chargeback.

## Alternatives Considered
- Placeholder “All Companies” entity: rejected due to data model confusion and leaky semantics
- Forcing frozen metrics to compute: rejected; estimation workflows benefit from calculating before freeze

## References
- Companies/Departments pages: Year selector + workspace editors (Overview for master data, Details for metrics) replacing legacy metrics modals
- OPEX allocations modal: method select; Manual by Company “Allocate by” + Reset; Manual by Department recalculation
