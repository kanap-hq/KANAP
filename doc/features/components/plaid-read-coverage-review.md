# Plaid Read Coverage Review

Date: 2026-05-01
Branch: `feat/full-ai-read`

This review maps what Plaid, the KANAP AI agent, can read through chat and MCP after the full-read pass. Scope is business/domain data only. Admin/platform settings, billing, audit/security events, notification preferences, and report-grade computed pages are intentionally out of scope for this stage.

## Executive Summary

Plaid is not a raw database reader. It reads KANAP data through AI tools in `AiToolRegistry`, and every tool is gated by AI surface access, tenant availability, RBAC, tenant-scoped query execution, and knowledge-library access where relevant.

Plaid can now search, query, filter, sort, aggregate, and fetch detail for these business/domain entity families:

- `accounts`
- `analytics_categories`
- `applications`
- `assets`
- `budget_lines`
- `business_processes`
- `chart_of_accounts`
- `companies`
- `connections`
- `contacts`
- `contracts`
- `departments`
- `documents`
- `incidents`
- `interfaces`
- `locations`
- `projects`
- `requests`
- `suppliers`
- `support_deadlines`
- `support_gaps`
- `tasks`
- `technologies`
- `technology_versions`
- `users`

The most important change is the new generic `get_entity_detail` tool. `query_entities` is used for list discovery and pagination; `get_entity_detail` is used when Plaid needs the full safe scalar payload for one item. Detail payloads strip `tenant_id`, storage/object keys, file paths, secrets, tokens, API keys, and encrypted secret fields. Attachments are metadata-only at this stage.

Applications also have a dedicated `get_application_classification_catalog` read. It is available with the application reader scope and returns the tenant's business levels (with their optional documented downtime), cyber levels, data classes, recovery waves, ranks/orders and deprecation flags, ordered from most to least severe. It is the authority for interpreting classification labels and ranks; observed filter values are not a substitute for the catalog.

## Access Model

Plaid read access depends on all of these gates:

- The AI surface must be enabled and configured for the tenant.
- The current user must be active and allowed to use chat or MCP.
- The current user must have `reader` access to the business resource behind the requested entity family.
- MCP remains read-only. Chat can expose write-preview tools, but those are outside this read review.
- Knowledge reads require knowledge permission and document library access.
- Tenant isolation is enforced through tenant-scoped execution, RLS-aware managers, and explicit tenant predicates in raw AI SQL.

Entity-to-resource mapping:

| AI entity | Permission resource |
| --- | --- |
| `accounts` | `accounts` |
| `analytics_categories` | `analytics` |
| `applications` | `applications` |
| `assets` | `infrastructure` |
| `budget_lines` | `budget` |
| `business_processes` | `business_processes` |
| `chart_of_accounts` | `accounts` |
| `companies` | `companies` |
| `connections` | `infrastructure` |
| `contacts` | `contacts` |
| `contracts` | `contracts` |
| `cost_centers` | `cost_centers` |
| `analytics_axes` | `analytics` |
| `working_day_calendars` | `working_day_profiles` |
| `exchange_rates` | `budget` |
| `departments` | `departments` |
| `documents` | `knowledge` |
| `incidents` | `incidents` |
| `interfaces` | `applications` |
| `locations` | `locations` |
| `projects` | `portfolio_projects` |
| `requests` | `portfolio_requests` |
| `suppliers` | `suppliers` |
| `tasks` | `tasks` |
| `technologies` | `infrastructure` |
| `technology_versions` | `infrastructure` |
| `users` | `users` |

## Read Tools

| Tool | Purpose | Pagination / completeness |
| --- | --- | --- |
| `search_all` | Cross-entity discovery over the readable families of the search index, and over the cost centers, working-day calendars and analytics dimensions by code and name (at most five of each). | Returns compact matches with `limit`, `offset`, `returned`, `truncated`, and `complete=false`. |
| `query_entities` | Typed list/query with server-side filters, sort, pagination, and exact totals where the source supports them. | Default limit is 200. If `total > returned` or `truncated=true`, Plaid must fetch later pages before claiming all data. |
| `aggregate_entities` | Generic `count`, `group`, and numeric/date `sum`/`avg`/`min`/`max` over one entity family. | Collects up to 10,000 matching IDs and returns `truncated`/`complete=false` when the aggregate cannot cover all matches. |
| `get_filter_values` | Discovers exact set-like filter values for supported AI fields. | Returns `fields_ignored` and `complete=false` when a field is unsupported. |
| `get_entity_detail` | Returns one readable entity as an AI-safe detailed DTO. | One item at a time. Use after `query_entities` identifies the target item. |
| `get_entity_context` | Relationship-rich context for applications, assets, projects, requests, and tasks. | Complements detail reads; not the generic detail mechanism. |
| `get_entity_comments` | Paginated comments for projects and tasks. | Uses `offset` and `limit`; request comments are not exposed yet. |
| `search_knowledge` | Searches readable knowledge documents. | Uses `offset` and `limit`; library permissions apply. |
| `get_document` | Reads one knowledge document's markdown DTO. | Attachment binary content, versions, and workflow/activity are not exposed here. |
| `get_application_classification_catalog` | Reads the complete tenant application classification catalog. | Application reader scope; includes deprecated values for historical reads. It never edits settings. |

## Coverage Matrix

| Area | Current Plaid support | Notes and limits |
| --- | --- | --- |
| Applications | Search, query, aggregate, detail, relationship context, classification catalog. | Classification filters/sorts/aggregates cover business level/rank, cyber, confidentiality, recovery, objectives, and review state. `version` (text), `go_live_date`, `end_of_support_date` and `retired_date` filter (dates: blank, ranges), sort, and `version` and `end_of_support_year` group; the three dates are `MIN`/`MAX` metrics as `YYYY-MM-DD`. The Applications list service carries the same filters and sorts for the screen. Create/update mutations remain preview and approval gated and support guarded undo; Plaid cannot edit catalogs or implicitly mark reviews. App instances and asset assignments are not separate AI entity families. |
| Assets | Search, query, aggregate, detail, relationship context. | Detail includes support info, contacts, links, and attachment metadata where available. Binary content is not returned. |
| Connections | Search, query, aggregate, detail. | Covers connection identity, topology, lifecycle, source/destination, protocols, risk fields, legs in detail. |
| Interfaces | Search, query, aggregate, detail. | Covers source/target apps, business process, data class/category, lifecycle, criticality, bindings and attachment metadata in detail. |
| Locations | Search, query, aggregate, detail. | Covers location metadata, provider/hosting/country/city, sub-locations, contacts/links when included by service detail. |
| Projects | Search, query, aggregate, detail, relationship context, comments. | Relationship context remains the richest project graph; reports, full activity pagination, and capacity planning are out of scope. |
| Requests | Search, query, aggregate, detail, relationship context. | Request comments and full activity/decision pagination are not first-class AI reads yet. |
| Tasks | Search, query, aggregate, detail, relationship context, comments. | Attachments/time entries are not fully surfaced as separate AI reads yet. |
| Knowledge documents | Search, query, aggregate, detail, markdown document read. | Binary attachments are metadata-only; version history, workflow decisions, locks, and activity are not first-class AI reads. |
| Incidents | Search, query, aggregate, detail. | One register family (`incidents`). `asset`, `application` and `technology` filter on the link table by exact reference or exact name, case-insensitive: `APP-1` does not match `APP-12`. Grouping by one of them is many-to-many: the key is the linked record's name, an incident counts once per link, and an incident without a link is in no group. `detected_month` and `resolved_month` (`YYYY-MM`, UTC) filter and group; `resolution_hours` is the detected-to-resolved delay in hours with one decimal, null for a cancelled or unresolved incident or a negative delay, and also a line field. Date metrics answer `YYYY-MM-DD`. A confidential incident the caller cannot see enters no list, group or average. A Business Contributor filters and groups only the applications they take part in. Incident writes are outside this read review. |
| Technologies and technology versions | `technologies`: search, query, aggregate, detail, relationship context. `technology_versions`: query and aggregate, no detail. | Technologies filter and group by `version` (exact label, without case) and by `owner` (any type), `it_owner` and `business_owner` (exact user display names, without case). `it_owner` and `business_owner` group many-to-many: a technology counts once per owner, and one without an owner of that type is in no group. `get_filter_values` lists the tenant's version labels and owner names. `technology_versions` is one row per version of a technology: `technology` (`TEC-n`), `technology_name`, `label`, `end_of_standard_support`, `end_of_support`, `support_status`, `support_date`, `in_use`, `server_count`, `application_count` (the applications in service that declare this version itself, in the caller's application read scope), `family`, `lifecycle`. Its support dates and state are the technology detail's own rule, so a technology's `versions` and the family's rows agree. Filters: `technology` (reference or exact name), `label`, `support_status`, `in_use`, the two dates, `family`, `lifecycle`, `end_of_support_year`; groups: `technology`, `support_status`, `in_use`, `family`, `lifecycle`, `end_of_support_year`; metrics: count, `MIN`/`MAX` of the dates as `YYYY-MM-DD`, sum of `server_count`. A version has no reference of its own: `ref` is its technology's `TEC-n`, and `get_entity_detail` refuses the family, the technology's detail listing every version. The technology detail also returns `support_contacts` (name and role), `web_links` (address and description), `vulnerability_alerts`, and each version's `vulnerability_alerts` (its own exception, null when it follows the technology) and `vulnerability_alerts_effective`. |
| Vulnerabilities | `vulnerabilities`: query, aggregate, detail (by row id or CVE id), no search. | One row per CVE on a technology version, as the vulnerabilities page; without a `state` or `alerts` filter, the page's default rows. `total` counts rows and `distinct_total` the distinct CVE (list and aggregates); each count group carries `distinct_count`, and only the CVE's own fields (`severity`, `score_source`, `exploited`) add up to `distinct_total`. `estate` (in use in the estate, the page's filter) filters and groups; `matching` (false: no longer matches) filters; `version` groups by technology and version, with `(no version recorded)`. `feeds` gives each feed that is on, its last success and `failing`, never the error text. The home tile is read with `estate`, `severity`, `published_at` and `exploited`. Reach by direct links only. |
| End of support report | Query and aggregate the report's two lists; read by subject through its own family. | `support_gaps`: one row per record to complete (`gap`, `subject_type`, `subject`, `subject_name`, `related`, `related_name`, `related_type`, `version`), from `EndOfSupportService.gaps`, filters and groups on `gap` and `subject_type`, count. `support_deadlines`: one row per deadline (`subject_type`, `subject`, `subject_name`, `version`, `date`, `state`, recorded ends, `milestone`, `server_count`, `servers`, `application_count`, `applications`), from `deadlines`, filter `horizon_months` (6, 12, 24, 36; 12 by default, one value), filters and groups on `subject_type`, `state` and `end_of_support_year`, metrics count and `MIN`/`MAX` of the date as `YYYY-MM-DD`. `subject` and `related` compare a reference exactly (`APP-1` never keeps `APP-12`) and contain on the name otherwise; asset and related references are read after the service. Both need `infrastructure:reader` and follow the caller's application read scope; without that read `applications_visible` is false and the note says the empty application rows are not "none". They are read in memory from the report service, cap at 30 deadlines, and have no record detail. |
| Budget lines | Search, query, aggregate, detail. | One family, both natures (`nature`: `opex` or `capex`); a question without a nature covers both. Generic current-year/relative-year summary metrics and the native title (`product_name`) and description are available. The budget reports are read through `aggregate_entities` with the screens' own requests: the cost per FTE and the day rate (`<year>_<column>_cost_per_fte`, `_day_rate`), a change between two columns (`<destination>_minus_<source>`, with `direction`, 10 groups by default, group `line` for a top of lines), the FTE month by month (`<year>_<column>_fte_by_month`: twelve months, average, peak), several measures in one table (`metrics`, 2 to 8), a second group field (`then_by`, not on `line` nor on the linked projects' streams and categories) and `limit` with `others` and `group_count`. `consolidation_account` (the Consolidation accounts report's label) needs the right on accounts: without it the field is withheld with the reason (`fields_withheld`), and a filter, group or sort on it says why. These figures read every line, ended ones included, while the reports read the lines still active on 1 January of the year before the first year shown. The allocation of one line is in its detail. |
| Chargeback | `chargeback` and `chargeback_lines`: query and aggregate, no search, no detail. | Reporting › Global chargeback and Company chargeback, read through `ChargebackReportService` with the Reporting right, as the routes. `chargeback`: the rows of the "Detailed allocations" table (each beneficiary company with paid, net and indicators, its departments, its costs without a department); grouped by department, a group is "company › department" or "company › common costs"; filtered on a department, grouped by company, the department rows of each company. `chargeback_lines`: the lines charged to one company (`company` filter required) with the company's figures. One year (1900 to 3000), one column, both natures when none is given (said in the result); the service's warnings come back in words. A person in limited access gets the service's rules: the lines they read, no group total, and on their company report the lines they do not read named by reference and title without a link. Flows between companies and years beyond the fixed window stay out of scope. |
| Contracts | Search, query, aggregate, detail. | Attachments are metadata-only through detail; renewal workflows and full history are not separate AI reads. |
| Companies | Search, query, aggregate, detail. | Company metrics/rollups are not report-grade AI views yet. |
| Departments | Search, query, aggregate, detail. | Department metrics/rollups are not report-grade AI views yet. |
| Suppliers | Search, query, aggregate, detail. | Supplier contact and spend/contract rollups can be reached through linked detail/query flows, not a specialized supplier report. |
| Contacts | Search, query, aggregate, detail. | Includes supplier link metadata where the service provides it. |
| Accounts and charts of accounts | Search, query, aggregate, detail. | Account/COA hierarchy is available through entity detail and filters, not a specialized finance report. |
| Analytics categories | Search, query, aggregate, detail. | Master-data read support only. |
| Cost centers | `cost_centers`: search (by code and name), query, aggregate, detail (by code), history. | Master data › Cost centers, read through `CostCentersService` with the right of the page. `ref` is the code; `under` keeps every node below a group, `parent` the nodes directly under it; `budget_holder` is the node's budget holder by name, null when none is set (never an email). The quick search follows the screen (code, name, path) with the exact code or name first and `matched_on`; `search_all` leaves the path out. A person in limited access reads the whole tree, and the line counts of a detail are within their access (`data_access: limited`). |
| Analytics dimensions | `analytics_axes`: search (by code and name), query, aggregate, detail (by code), history. | Master data › Analytics dimensions, read through `AnalyticsAxesService` with the Analytics right. Settings as the screen: applies to, required, `required_for` (where a value is required now, an enabled dimension only), open values, order, status, and the budget lines field of the dimension. The values are the `analytics_categories` family. Line counts in limited access as for cost centers. |
| Working-day calendars | `working_day_calendars`: search (by code and name), query, aggregate, detail (by code), history. | Master data › Working-day calendars, read through `WorkingDayProfilesService` with the right of the page. A calendar reads one year, from 2000 to 2100, through the screen's year read: `total_days` is the sum of the twelve months computed by the server, and a year without days gives `source: none`, never 0. A country without a calendar is said in words. Line counts in limited access as for cost centers. |
| Exchange rates and currency settings | `exchange_rates`: query and aggregate, no search, no detail, no history. | Budget management › Administration › Currencies, read through the rate matrix and the missing rates of the screen with the Budget right (as the read routes). One row per currency and year, the rate in the reporting currency for 1 unit of the currency, with `inverse_rate` and, with the `against` filter, `cross_rate` computed by the server; every answer carries the currency settings and the missing rates, read without writing. No page link: the page is an administration setting. In limited access the matrix shows the currencies of the person's lines only (`data_access: limited`). |
| Business processes | Search, query, aggregate, detail. | Categories and owner metadata are exposed where the service returns them. |
| Users | Search, query, aggregate, detail. | Business user profile fields are readable; auth tokens and notification settings are out of scope. A reader of users gets name, email and status. An administrator of users with access to all data also gets `roles` (every role; `primary_role` is the primary one only) and `data_access` (the effective mode), and the person's detail carries the Data access tab (nodes, levels, what each covers). |
| Roles and their rights | `roles`: query, aggregate, detail (by name or id). `role_permissions`: query, aggregate, no detail. No search. | Admin › Roles, read through the screen's services: a role's kind and `user_count` (no person named), one row per role and right it gives, the role's detail as the screen's matrix. Rights and levels carry the screen's words in the person's language (`resource_label`, `level_label`). Users at admin level and access to all data only, as the screen. Writing a role or its rights stays on the screen. |
| Data access | `data_access`: query, aggregate, no detail. No search. | Admin › Data access: one row per limited person and node, one row for a limited person without a node, Administrators not listed. Who sees one company is the Data access block of the company's detail. Users at admin level and access to all data only, as the screen. Writing a person's access stays on the screen. |
| Record history | `get_record_history` on one record of a family with a History tab. | The record's History tab, under the record's own right, newest first, paged. A family without a History tab is refused in words; Plaid never rebuilds a history from other data, the audit log included. |

Technology writes are complete for L5, under a preview and approval, all at `infrastructure:member`: `update_technology_links` declares a technology on applications (with a version and optional deployment servers) and installs it on servers, or removes those links; it also needs `applications:reader` for an application, follows a Business Contributor's participation, refuses an operating system (recorded from the server's page), writes `source = 'ai'` with the preview as `source_ref`, audits `ai_chat`, refuses a link changed since the preview with 409, and undoes exactly the links it changed (a version it created stays). `create_business_record` and `update_business_record` on `technologies` write the fiche (name, editor, family, lifecycle, hosting type, description, notes, support notes, replacement, cyber criticality, recovery wave, RTO, RPO, administration zone); a creation adopts the exact KANAP catalog entry when it knows the name, completes a hand-typed same-name record without a catalog key (the card names it and what it adds: key, missing versions, description), or is a free entry when the catalog has none or `from_catalog: false` asks for one; it applies the other fields with an update in the same transaction, writes `source = 'ai_chat'` with the preview, refuses a same-name technology with its `TEC-n`, rechecks the announced record (new, or the completion it named) under the adoption's advisory lock (409 on a record adopted or typed in between), and never writes the CPE/CVE matching fields, the catalog key, `mode`, the vulnerability alert setting or an attachment. The IT catalog fields take a code or an exact label in the four languages the app shows; the card carries the code and the frontend localises it, refuses a retired value unless the record already holds it, and refuses an ambiguous label. `update_technology_versions` adds and changes versions (label, standard and extended support dates, notes) through the technology service, refuses a duplicate label, an extended support before the standard, an impossible day (`2028-02-30`), an empty request, an unknown key, a delete, `cpe_version`, `build_prefixes` and a version's alert exception; it compares the versions under the technology lock (409 when one changed), and its undo restores the changed versions (a version added on the way stays, and an undo with only added versions says it has nothing to do). `update_technology_people` changes the owners (IT or business) and support contacts through `bulkReplaceOwners` / `bulkReplaceSupportContacts`; an owner to add is an active user by exact display name, a removal names a current owner of the fiche, active or not, and a homonym is refused with names only, never an email; adding a contact needs `contacts:reader`, as the Operations tab's picker, removing one does not, a contact without a name is refused on add (give it a name in Contacts) and is named by its email on remove, a new contact goes last and the others keep their order, the set of each kind touched is compared under the lock (409), and the undo restores the previous owners and the contacts in their exact order. `update_technology_web_links` adds, changes and removes the fiche's web links through `createLink` / `updateLink` / `deleteLink`; an address is http or https, a designation by address is refused when two links share it, the whole set is compared under the lock (409), and the undo removes the added links, recreates the removed ones and restores the changed ones. `set_technology_vulnerability_alerts` sets the technology setting (`setVulnerabilityAlerts`, which clears every version exception, read in `dry_run` for the card) and the version exceptions (`updateVersion`), with the service packs of a base release following through the pure `servicePackAlertTargets`; the setting runs first, the card says how many exceptions will be cleared and names the packs that will follow (null included), a base release and one of its packs in the same request are refused at the preview, the setting and every exception are compared under the lock (409), and the undo puts the setting back, restores every version whose value differs from the state before (null included, base releases before their packs) and requires the exact previous state, otherwise it fails. The create-then-link plan still works: when the flagship phrase names a technology the tenant does not have, one plan creates or adopts it and declares the version, the second step resolving `{{create_….ref}}`. The technology detail reads the support contacts (name and role), the web links (address and description), the alert setting and each version's exception and effective setting, beside the owners. Outside L5: attachments (the Relations tab shows them and uploads them; Plaid does not write them, and a request names the Relations tab), `cpe_products` and `cve_names` (the matching owns them, decision 10), deleting a technology or a version, the vulnerability matching and the vulnerability states.

Incident linked groups are many-to-many, as the task linked groups are: the group counts need not add up to `total`, and a record with no link is in none of them. `detected_month` and `resolved_month` are read in UTC, whatever the database session time zone; `resolved_month` is empty unless the incident is resolved or closed.

## Deliberately Not First-Class Yet

These areas are still not separate AI entity families in this stage:

- App instances/deployments, app-asset assignments, interface bindings, interface mapping rules, connection legs/protocol rows, allocation rows, spend/CAPEX version rows, and other child/link tables. They are surfaced through parent detail where current services return them.
- Portfolio planning, roadmap, capacity, weekly/status reports, dashboard views, and generated report outputs.
- Currency snapshots, budget freeze/copy/reset operational state, and tenant/admin/platform settings (the rates and the currency settings are the `exchange_rates` family).
- Audit logs (a record's own history is read through its History tab), billing/subscription records, auth settings, security events, notification preferences, and AI conversations outside the current runtime context.
- A person's own access ("what can I see?"): their roles are in the chat's user context; their data access is not read for themselves.
- Raw uploaded binary content. Only metadata is exposed for attachments for now.

## Discoverability Fixes Completed

- Prompt-visible readable entity types now use the same shared entity list as the tool schemas.
- The budget lines are one AI family (`budget_lines`); the search index keeps its two per-nature types internally, mapped at the AI boundary.
- `get_entity_context` is only advertised when the user can read at least one context-capable family (`applications`, `assets`, `projects`, `requests`, `tasks`).
- `search_all`, `query_entities`, `aggregate_entities`, `get_filter_values`, and `get_entity_detail` now share the same business/domain entity type list.
- The system prompt now tells Plaid to use `query_entities` for exhaustive lists, later pages for incomplete results, and `get_entity_detail` for full item inspection.
- Application classification discovery now uses `get_application_classification_catalog`; mutations use application services, and catalog editing remains an administrative UI capability.

## Source Files Updated

- `backend/src/ai/ai.types.ts`
- `backend/src/ai/ai-tool.registry.ts`
- `backend/src/ai/ai-system-prompt.service.ts`
- `backend/src/ai/ai-chat-orchestrator.service.ts`
- `backend/src/ai/ai-policy.service.ts`
- `backend/src/ai/ai-entity.service.ts`
- `backend/src/ai/query/ai-query.executor.ts`
- `backend/src/ai/query/ai-aggregate.executor.ts`
- `backend/src/ai/query/ai-filter.types.ts`
- `backend/src/ai/query/registries/*.registry.ts`
- `backend/src/incidents/incident-sql.ts`
- `backend/src/incidents/services/incidents.service.ts`
- Domain service/module exports needed by the AI query executors.
