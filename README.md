# KANAP

[![Website](https://img.shields.io/badge/website-kanap.net-blue)](https://kanap.net)
[![Documentation](https://img.shields.io/badge/docs-doc.kanap.net-green)](https://doc.kanap.net)
[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--v3-blue.svg)](LICENSE)

**The open source IT governance platform.**

KANAP gives IT departments one governed record for their IT budget (OPEX and
CAPEX), applications and interfaces, infrastructure, project portfolio, tasks,
and documentation. Its built-in AI agent, **Plaid**, works on that same record
in natural language, within the platform's permissions and audit trail.

Built for IT departments of mid-sized companies and multi-entity groups:
multi-company, multi-currency, chargeback.

Self-host it for free, or let us run it for you.

[Website](https://kanap.net) | [Documentation](https://doc.kanap.net) | [Self-hosting guide](https://doc.kanap.net/on-premise/) | [Plaid architecture](doc/plaid-architecture.md) | [Source docs](doc/)

---

## Why KANAP?

IT departments often run on disconnected fragments:

- budgets in spreadsheets
- applications in wikis or partial CMDBs
- projects in generic project tools
- documentation in Confluence, SharePoint, or people's heads
- tasks spread across tickets, emails, and meetings

Nothing connects. When the CFO asks "what are we spending on that system?", or the CEO asks "what happens if we delay this project?", the answer takes days to assemble.

KANAP replaces that patchwork with a single open source system of record where
costs link to applications, applications link to infrastructure, projects link
to budgets and tasks, and knowledge links to the entities it describes. Plaid
uses that same governed record as its working context, so AI answers and actions
are grounded in the permissions, data model, and audit trail of the platform.

Think of it as the operating system of the IT department: the coordination layer for planning, documenting, budgeting, deciding, and executing.

![KANAP Dashboard](doc/assets/dashboard.png)

## Plaid: the agent layer

Plaid is the native AI agent inside KANAP. It works through typed tools,
tenant-scoped execution, RBAC, RLS, mutation previews, approvals, and audit
records.

Today, Plaid can:

- read, search, filter, aggregate, and inspect governed KANAP data across the IT
  system of record
- create or update supported KANAP records through explicit write previews that
  the user approves before execution
- create and update documents, tasks, master data, business records,
  relationships, and financial planning data through the same approval path
- import a GLPI ticket into a KANAP task after user confirmation
- expose read-only MCP tools so external AI clients can query governed KANAP data

Alongside Plaid, the **helpdesk agent** watches your connected service desk
(GLPI today), reads each ticket against your applications and documentation,
and proposes a reply to the requester, an internal note or a ticket update.
Every action type starts under approval; you switch it to automatic once its
track record justifies it.

The agentic control plane also tracks runs, tool executions, evidence, action
requests, approvals, policy decisions, and live-readiness checks. Provider
contracts exist for monitoring, ticketing, virtualization, directory, and
automation systems; production external adapters beyond the current GLPI import
path are the next step.

![Plaid prepares a change as a preview and applies it only after approval](marketing/web/public/screenshots/ai-preview.png)

*Plaid prepares a change as a preview. Nothing is applied until the user approves it.*

For the technical architecture, see [doc/plaid-architecture.md](doc/plaid-architecture.md).

## What it does

**Budget management**: Multi-year OPEX and CAPEX planning with allocation methods, multi-currency support, CSV import/export, chargeback, analytics dashboards, contracts, attachments, deadlines, and expiration warnings.

**IT landscape**: Document and visualize applications, infrastructure assets, network interfaces, connections, locations, subnets, and business processes with interactive architecture maps.

**Portfolio management**: Manage demand from initial request through project delivery with scoring, roadmap scheduling, capacity analysis, lifecycle tracking, and project/task execution.

**Knowledge management**: Govern IT documentation with markdown editing, structured libraries, review workflows, version history, export to PDF/DOCX/ODT, and links to applications, projects, assets, and tasks.

**Unified tasks**: One task system spanning budget items, contracts, CAPEX items, applications, assets, requests, and projects.

**Plaid AI agent**: Ask questions, create documents, manage tasks, update governed records, and explore IT data through natural-language chat. KANAP also exposes a read-only MCP server so external AI tools can query governed IT data directly; read-write MCP is on the roadmap and needs a dedicated approval protocol.

## Open source first

KANAP is licensed under [AGPL v3](LICENSE).

- Full product, not a teaser edition
- Free to self-host
- No feature paywall
- No seat tax for self-hosted deployments
- Source code available for audit and contribution
- Your data can stay on your own infrastructure

## Self-hosting

KANAP runs on Linux with Docker and supports on-premise single-tenant deployments.

Two install paths are documented:

- **[AI-assisted installation](https://doc.kanap.net/on-premise/installation-ai/)**: let a coding agent guide setup interactively on a clean server.
- **[Manual installation](https://doc.kanap.net/on-premise/installation-example/)**: follow the full step-by-step process yourself.

Typical requirements:

- Docker
- PostgreSQL 16+
- S3-compatible object storage
- TLS reverse proxy

## Hosted KANAP and support

Self-hosting is free.

Paid options are for teams that want operational help:

- **Self-hosted support**: priority support for teams running KANAP themselves.
- **Hosted KANAP**: the same open source platform operated by KANAP, with hosting, updates, backups, support, and activation help.

See [kanap.net](https://kanap.net/offer) for current pricing.

## Tech stack

| Layer | Technology |
|-------|------------|
| Backend | NestJS, TypeScript, TypeORM |
| Frontend | React, TypeScript, Vite, MUI, AG Grid, TanStack Query |
| Database | PostgreSQL 16 with Row-Level Security |
| Infrastructure | Docker, Nginx, S3-compatible storage |
| Marketing site | Astro |

Multi-tenant by design: shared database, PostgreSQL RLS isolation, subdomain routing, RBAC, and audit trails.

## Project structure

~~~text
backend/    NestJS API, migrations, business logic
frontend/   React SPA, pages, components, hooks
infra/      Docker Compose, Nginx configs, deploy scripts
doc/        Architecture, API reference, runbooks, guides
marketing/  Astro marketing site
~~~

## Contributing

Contributions are welcome. Please [open an issue](https://github.com/kanap-hq/kanap/issues) before larger changes so we can align on scope.

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Security

If you find a security issue, please follow [SECURITY.md](SECURITY.md).

## License

[AGPL v3](LICENSE). You are free to use, modify, and distribute KANAP. The AGPL copyleft clause ensures that anyone running a modified version as a network service must share their changes, keeping the project genuinely open.

The public holiday rules behind the standard working-day calendars come from the [date-holidays](https://github.com/commenthol/date-holidays) package: its code is under the ISC license and its holiday data under [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/), with the attributions listed in the package's LICENSE file. KANAP ships that data unchanged and works offline with it.

The licenses of KANAP's production dependencies are checked on every merge. Each published version carries a component inventory (CycloneDX) and a third-party notices file; see [doc/sbom.md](doc/sbom.md).

Copyright 2025-2026, KANAP EURL.
