# Fromage & Co Demo Tenant — Setup Guide

Fromage & Co is the KANAP demo tenant: a European cheese group with four legal
entities, ~50 applications, spend/CAPEX budgets, a project portfolio, an IT
landscape with interfaces and connections, a Service Desk knowledge library,
and a demo AI agent working mock helpdesk tickets.

Everything is created through the public API by a single idempotent runner:

```bash
node fixtures/fromage-co/setup-tenant.mjs \
  --base-url https://fromage.dev.kanap.net \
  --email fried@kanap.net \
  --password '<admin password>'
```

The runner is safe to re-run: every step looks up existing records before
creating anything.

## What the runner does

1. **Tenant bootstrap** (if login fails): `POST /public/start-trial` →
   `POST /public/activate-trial` → sets the admin password. See
   "Tenant creation and CAPTCHA" below.
2. **Settings**: currencies (EUR/USD), IT Ops server kinds, operating systems,
   DNS domains, connection entities.
3. **Portfolio classification** (sources, categories, streams) and the
   **Domaine** dimension: the default analytics dimension, named `Domaine`,
   holds the domain each line serves (ERP, E-commerce, Workplace…).
4. **CSV imports** (01, 03→19 and 26→30): companies, charts of accounts, suppliers,
   departments, contacts, users, cost centres, analytics dimension values,
   working-day calendars, business processes, applications, contracts,
   spend, CAPEX, portfolio projects and requests, locations, assets, tasks.
   The companies import is pinned to `--year` (default 2026) because year
   columns are relative to the import year.
   **Charts of accounts**: one local chart per company (France PCG,
   Netherlands RGS, Italy PDC, US GAAP). Group reporting uses the IFRS chart
   the tenant is provisioned with: every local account maps to one of its 14
   consolidation accounts, as in the built-in templates. On a tenant built by
   an earlier version of the fixture, the runner removes the old
   `IFRS Group Chart` and its accounts 6100 to 6400 from the local charts.
   **Budget data**: right after the spend and CAPEX imports, the runner writes
   the quantity × price lines of the external staffing items (`30-costed-lines.csv`,
   keyed by item name, resolved to versions) and imports the monthly amounts
   (`29-budget-rows.csv`: 2026 actuals January to August for every item, a
   forecast on some). Three more analytics dimensions are created first (Nature de
   coût, Référence budget, Récurrence). What a line pays for is on Nature de
   coût, so Domaine holds no expense kinds; on a tenant built by an earlier
   version, the runner removes the old Domaine values Professional Services,
   Managed Services, Training and General once no line uses them. 2027 is left empty on purpose: the
   budget demo initialises it by copying the 2026 landing. Re-running the
   runner restores the budget data, except on frozen columns: unfreeze them
   first (Budget administration → Freeze).
5. **Demo user passwords**: all 19 imported users get `--demo-password`
   (default `Fromage2026!`) so you can log in as e.g.
   `thomas.berger@fromage-co.com` during a demo. Pass `--demo-password ''`
   to skip.
6. **Relations**: Microsoft 365 suite members, application↔department links,
   app instances, interfaces + bindings, connections + equipment hops,
   interface↔connection links, contract↔spend links, spend↔application links,
   portfolio teams and capacity, project phases and team members, company
   allocations on selected spend/CAPEX versions.
7. **Service Desk Docs**: a knowledge library with five published guides
   (VPN, SAP access, CaveGuard alerts, guest Wi-Fi, label printers). The
   documents are in `docs/*.md`.
8. **Demo AI agent**: `Fromage Service Desk Agent`, bound to the built-in
   mock ticketing provider, with a persona, a shared-context profile, and a
   scope targeting the `fromage-helpdesk` entity. The mock provider ships five
   fromage tickets whose answers live in the Service Desk Docs — the agent's
   knowledge search finds them during triage. The runner triggers one
   ingestion poll and one mock triage so the Activity and Approvals pages have
   content immediately.

Flags: `--skip-relations`, `--skip-agents`, `--org`, `--country`, `--year`,
`--activation-token` (see below).

## Environments

| Environment | Base URL | Notes |
|---|---|---|
| Dev | `https://fromage.dev.kanap.net` | Local stack behind the Cloudflare tunnel |
| QA | `https://fromage.qa.kanap.net` | |
| Prod | `https://demo.kanap.net` | Prospect demos: slug `demo`, private `--demo-password`, marked internal |

The runner auto-detects whether the API is served under `/api` (nginx-proxied
environments) or at the root.

## Tenant creation

Trial signup is the only tenant-creation path, and CAPTCHA is enforced on all
environments, so create the tenant **exactly like a customer would** — no
tokens, no scripting:

1. On the marketing site, start a trial with the environment's slug
   (`fromage` on dev and QA, `demo` on prod), the organisation name
   `Fromage & Co` and your own email. The runner removes the company the
   trial creates under that name; with another name, pass it with `--org`.
   On dev and QA all outbound mail is redirected to `fried@kanap.net`; prod
   sends mail for real.
2. Click the activation link in the email and set your password on the
   activation page — the tenant now exists and you are its Administrator.
3. Run the runner with that email and password. It logs in and does
   everything else.

The runner only needs its bootstrap mode (`--activation-token`) for headless
setups: pass it the activation **link** (or bare token) from the email
instead of clicking it, and it will activate the tenant and set the password
itself.

If the tenant already exists (re-running after a previous setup), the runner
just logs in and updates everything in place.

## Recreating from scratch

To wipe and rebuild (e.g. on QA):

1. Log in to platform-admin (`https://platform-admin.<env>.kanap.net`) as a
   platform administrator.
2. Delete the tenant (requires typing the slug to confirm). This purges all
   tenant data, frees the slug and clears the trial signup.
3. Follow "Tenant creation" above, then run the runner.
4. On prod, mark the tenant internal in the platform console (Tenants →
   the tenant → **Mark as internal tenant**). A trial tenant expires after 14 days:
   it freezes and every AI feature stops.

## AI prerequisites

Cloud installs (dev/QA/prod) use the platform's built-in LLM — no per-tenant
configuration needed. On-premise installs must configure an LLM endpoint in
the AI settings before the demo agent can triage tickets; everything else in
the fixture works without AI.

## Known traps

- **The tenant AI surface is off by default.** Agent triage fails with "AI chat is disabled for this tenant" until `PATCH /ai/settings` receives `{ "chat_enabled": true }`. The runner does this when it sets up the demo agent. If you skip the agent step (`--skip-agents`) or build the agent by hand, enable it yourself.
- **Users get a password only at creation.** `POST /users` is the one endpoint that accepts an initial password. `PATCH /users/:id` refuses a password (`PASSWORD_UPDATE_NOT_ALLOWED`), so a re-run cannot reset the password of a user that already exists. Use the password reset flow, or delete the user and run the runner again.
- **The seeded admin password is never updated.** With `SEED_ADMIN=true`, the backend creates the admin user from `ADMIN_EMAIL` and `ADMIN_PASSWORD` only when that user does not exist. Changing `ADMIN_PASSWORD` later has no effect on the existing account. If a platform-admin login stops working after an environment change, the stored password is the one from the first boot.

## Demo logins

| Who | Email | Role |
|---|---|---|
| Tenant owner | the `--email` you passed | Administrator |
| Thomas Berger (CIO) | `thomas.berger@fromage-co.com` | Administrator |
| Sophie Laurent | `sophie.laurent@fromage-co.com` | IT Landscape Administrator |
| Maria Casanova (controller) | `maria.casanova@fromage-co.com` | Budget Administrator |
| Nadia Lemaire (shops and e-commerce operations) | `nadia.lemaire@fromage-co.com` | Budget Member |

All demo users share the `--demo-password` (default `Fromage2026!`). The
default is public (it is in this repository): on any tenant that people
outside the team can reach, pass a private value. The runner sets it only
when it creates a user, so choose it before the first run.

## Files

- `setup-tenant.mjs` — the runner (Node ≥ 20, no dependencies).
- `01-…25-*.csv` — the dataset (semicolon-separated, UTF-8).
- `26-…30-*.csv` — the budget dataset: cost centres, dimension values,
  calendars, costed lines and monthly rows. `14-spend-items.csv` and
  `15-capex-items.csv` are generated too. Regenerate all of them with
  `node fixtures/fromage-co/tools/generate-budget.mjs` (deterministic; edit the
  script, not the files). The IT division has three divisions and twelve cost
  centres over the four legal entities; about 40 % of the OPEX is external
  staffing priced per working day.
- `docs/*.md` — the Service Desk Docs contents.
- The fromage mock helpdesk tickets live in the backend's mock ticketing
  provider (`backend/src/ai/control-plane/providers/mocks/mock-ticketing.provider.ts`,
  entity `fromage-helpdesk`) so they are available in every environment
  without seeding.
