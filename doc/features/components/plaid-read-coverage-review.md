# Plaid Read Coverage Review

Date: 2026-05-01
Branch: `feat/full-ai-read`

This review maps what Plaid, the KANAP AI agent, can read through chat and MCP after the full-read pass. Scope is business/domain data only. Admin/platform settings, billing, audit/security events, notification preferences, and report-grade computed pages are intentionally out of scope for this stage.

## Executive Summary

Plaid is not a raw database reader. It reads KANAP data through AI tools in `AiToolRegistry`, and every tool is gated by AI surface access, tenant availability, RBAC, tenant-scoped query execution, and knowledge-library access where relevant.

Plaid can now search, query, filter, sort, aggregate, and fetch detail for these 20 business/domain entity families:

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
- `interfaces`
- `locations`
- `projects`
- `requests`
- `suppliers`
- `tasks`
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
| `departments` | `departments` |
| `documents` | `knowledge` |
| `interfaces` | `applications` |
| `locations` | `locations` |
| `projects` | `portfolio_projects` |
| `requests` | `portfolio_requests` |
| `suppliers` | `suppliers` |
| `tasks` | `tasks` |
| `users` | `users` |

## Read Tools

| Tool | Purpose | Pagination / completeness |
| --- | --- | --- |
| `search_all` | Cross-entity discovery over readable entity families. | Returns compact matches with `limit`, `offset`, `returned`, `truncated`, and `complete=false`. |
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
| Applications | Search, query, aggregate, detail, relationship context, classification catalog. | Classification filters/sorts/aggregates cover business level/rank, cyber, confidentiality, recovery, objectives, and review state. Create/update mutations remain preview and approval gated and support guarded undo; Plaid cannot edit catalogs or implicitly mark reviews. App instances and asset assignments are not separate AI entity families. |
| Assets | Search, query, aggregate, detail, relationship context. | Detail includes support info, contacts, links, and attachment metadata where available. Binary content is not returned. |
| Connections | Search, query, aggregate, detail. | Covers connection identity, topology, lifecycle, source/destination, protocols, risk fields, legs in detail. |
| Interfaces | Search, query, aggregate, detail. | Covers source/target apps, business process, data class/category, lifecycle, criticality, bindings and attachment metadata in detail. |
| Locations | Search, query, aggregate, detail. | Covers location metadata, provider/hosting/country/city, sub-locations, contacts/links when included by service detail. |
| Projects | Search, query, aggregate, detail, relationship context, comments. | Relationship context remains the richest project graph; reports, full activity pagination, and capacity planning are out of scope. |
| Requests | Search, query, aggregate, detail, relationship context. | Request comments and full activity/decision pagination are not first-class AI reads yet. |
| Tasks | Search, query, aggregate, detail, relationship context, comments. | Attachments/time entries are not fully surfaced as separate AI reads yet. |
| Knowledge documents | Search, query, aggregate, detail, markdown document read. | Binary attachments are metadata-only; version history, workflow decisions, locks, and activity are not first-class AI reads. |
| Budget lines | Search, query, aggregate, detail. | One family, both natures (`nature`: `opex` or `capex`); a question without a nature covers both. Generic current-year/relative-year summary metrics and the native title (`product_name`) and description are available. Full allocation/version/report views are out of scope. |
| Contracts | Search, query, aggregate, detail. | Attachments are metadata-only through detail; renewal workflows and full history are not separate AI reads. |
| Companies | Search, query, aggregate, detail. | Company metrics/rollups are not report-grade AI views yet. |
| Departments | Search, query, aggregate, detail. | Department metrics/rollups are not report-grade AI views yet. |
| Suppliers | Search, query, aggregate, detail. | Supplier contact and spend/contract rollups can be reached through linked detail/query flows, not a specialized supplier report. |
| Contacts | Search, query, aggregate, detail. | Includes supplier link metadata where the service provides it. |
| Accounts and charts of accounts | Search, query, aggregate, detail. | Account/COA hierarchy is available through entity detail and filters, not a specialized finance report. |
| Analytics categories | Search, query, aggregate, detail. | Master-data read support only. |
| Business processes | Search, query, aggregate, detail. | Categories and owner metadata are exposed where the service returns them. |
| Users | Search, query, aggregate, detail. | Business user profile fields are readable; auth tokens, notification settings, and full permission maps are out of scope. |

## Deliberately Not First-Class Yet

These areas are still not separate AI entity families in this stage:

- App instances/deployments, app-asset assignments, interface bindings, interface mapping rules, connection legs/protocol rows, allocation rows, spend/CAPEX version rows, and other child/link tables. They are surfaced through parent detail where current services return them.
- Portfolio planning, roadmap, capacity, weekly/status reports, dashboard views, chargeback reports, and generated report outputs.
- Currency/FX settings and snapshots, budget freeze/copy/reset operational state, and tenant/admin/platform settings.
- Audit logs, billing/subscription records, auth settings, security events, notification preferences, and AI conversations outside the current runtime context.
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
- `backend/src/ai/query/registries/*.registry.ts`
- Domain service/module exports needed by the AI query executors.
