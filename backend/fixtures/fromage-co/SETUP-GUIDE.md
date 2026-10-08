# Fromage & Co Demo Tenant — Setup Guide

Fromage & Co is the KANAP demo tenant: a European cheese group with four legal
entities, ~50 applications, spend/CAPEX budgets, a project portfolio, an IT
landscape with interfaces and connections, a Service Desk knowledge library,
and a demo AI agent working mock helpdesk tickets.

On a KANAP cloud workspace you do not need the runner: an Administrator loads the same
set from **Admin** → **Sample data** and erases it from the same page.

Everything is created through the public API by a single idempotent runner:

```bash
node backend/fixtures/fromage-co/setup-tenant.mjs \
  --base-url https://fromage.dev.kanap.net \
  --email <your email> \
  --password '<admin password>' \
  --demo-password '<private value>'
```

`--email` and `--password` are the tenant administrator's (the trial sign-up's)
e-mail and password.

`--demo-password` is required. It is the password every imported demo user
gets. On any tenant reachable from outside your machine, use a private value
that is not written in this repository. Pass `--demo-password ''` to create the
users without a password.

The runner is safe to re-run: every step looks up existing records before
creating anything.

The demo users are on reserved `.example` domains (`fromage-co.example`,
`kaasmeester.example`, `formaggio-supremo.example`): the API never sends an
e-mail to such an address. Tenants loaded before this change hold the same
users on the old `.com`, `.nl` and `.it` domains, and are left as they are.
Re-running the runner on such a tenant would create every demo user a second
time under its new address: load the current dataset on a new tenant instead.

The master data and the budget are in English, as an international group
would keep them; each company keeps a few local names (French, Dutch and
Italian budget lines, the French projects and requests, the local charts of
accounts). Tenants loaded before this
change hold French names for the cost centres, the dimensions and the budget
lines. The runner renames the default dimension, but re-running it on such a
tenant would add the English departments, dimension values and budget lines
next to the French ones: load the current dataset on a new tenant instead.

## What the runner does

1. **Tenant bootstrap** (if login fails): `POST /public/start-trial` →
   `POST /public/activate-trial` → sets the admin password. See
   "Tenant creation and CAPTCHA" below.
2. **Settings**: currencies (EUR/USD), IT Ops server kinds, operating systems,
   DNS domains, connection entities.
3. **Portfolio classification** (sources, categories, streams) and the
   **Domain** dimension: the default analytics dimension, named `Domain`,
   holds the domain each line serves (ERP, E-commerce, Workplace…).
4. **CSV imports** (01, 03→19 and 26→30): companies, charts of accounts, suppliers,
   departments, contacts, users, cost centres, analytics dimension values,
   working-day calendars, business processes, applications, contracts,
   spend, CAPEX, portfolio projects and requests, locations, assets, tasks.
   The companies import is pinned to `--year` (default 2026) because year
   columns are relative to the import year.
   **Charts of accounts**: one local chart per company (France PCG,
   Netherlands RGS, Italy PDC, US GAAP). The runner sets the three chart
   roles: each local chart is the default chart of its country (proposed for
   new companies there); the IFRS chart the tenant is provisioned with is the
   default for other countries and the consolidation chart. Every local
   account maps to one of the 14 IFRS consolidation accounts, as in the
   built-in templates, and takes its consolidation name and description from
   it: the runner sets IFRS as the consolidation chart on every run, which
   resyncs those names. The runner warns when the tenant has no IFRS chart,
   or when a local account is outside the consolidation chart or has no
   consolidation account.
   On a tenant built by an earlier version of the fixture, the runner removes
   the old `IFRS Group Chart` and its accounts 6100 to 6400 from the local
   charts.
   **Budget data**: right after the spend and CAPEX imports, the runner writes
   the quantity × price lines of the external staffing items (`30-costed-lines.csv`,
   keyed by item name, resolved to versions) and imports the monthly amounts
   (`29-budget-rows.csv`: 2026 actuals January to August for every item, a
   forecast on some). Three more analytics dimensions are created first (Cost
   type, Budget reference, Recurrence). What a line pays for is on Cost type,
   so Domain holds no expense kinds; on a tenant built by an earlier
   version, the runner removes the old Domain values Professional Services,
   Managed Services, Training and General once no line uses them. 2027 is left empty on purpose: the
   budget demo initialises it by copying the 2026 landing. Re-running the
   runner restores the budget data, except on frozen columns: unfreeze them
   first (Budget administration → Freeze).
5. **Demo user passwords**: all 18 imported users get the required
   `--demo-password` so you can log in as e.g.
   `thomas.berger@fromage-co.example` during a demo. Pass `--demo-password ''`
   to create them without a password.
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
   knowledge search finds them during triage. The runner turns the assistant
   on and triggers one ingestion poll and one mock triage so the Activity and
   Approvals pages have content immediately (on the KANAP included model, once
   it is confirmed: see "AI prerequisites").

Flags: `--skip-relations`, `--skip-agents`, `--org`, `--country`, `--year`,
`--shift-years`, `--activation-token` (see below), `--netbox-test-cases`,
`--accept-included-model` (see "AI prerequisites").

## Dates and years

The dataset is written for 2026. `--shift-years N` moves every date by N
years when the files are loaded (for 2027, pass `--shift-years 1`): each
`YYYY-MM-DD` in a cell, each `year` value (files 28 to 30), the metric columns
of `01-companies.csv` and the companies import year, the project phases, and
the year the relative `y_*` budget columns are read against. A 29 February
moved to a common year becomes the 28th. Years written inside a text (a note
saying "2026 actuals") do not move. The files on disk never change.

Without `--shift-years`, the runner behaves as before: the dates as written,
and the `y_*` budget columns read against the current year.

## Server mode

The API runs the runner itself to load the demo data on a tenant that was just
activated: `node backend/fixtures/fromage-co/setup-tenant.mjs --server-mode`,
with no other argument. Its inputs come from the environment only:

| Variable | Value |
|---|---|
| `KANAP_DEMO_API_URL` | The API root, e.g. `http://127.0.0.1:8080` (no `/api` prefix) |
| `KANAP_DEMO_HOST` | The tenant's host name, sent as `Host` (the API resolves the tenant from it) |
| `KANAP_DEMO_TOKEN` | An access token of the tenant administrator |
| `KANAP_DEMO_STARTING_COMPANY` | The company the activation created, removed once the dataset's companies exist |
| `KANAP_DEMO_YEAR` | The year the dataset is moved to (the shift is this year minus 2026) |

In this mode the runner does not create the tenant, log in, set passwords
(the demo users have none and get no invitation), create the demo AI agent or
the Netbox test cases, or set the asset hardware info. Each step starts with
one `KANAP_DEMO_STEP <name>` line on stdout; everything else goes to stderr.
The runner exits with a non-zero code when a step fails or warns: a partial
load is a failure. The token is never printed.

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
   On dev and QA all outbound mail is redirected to the `EMAIL_OVERRIDE`
   address; prod sends mail for real.
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

Cloud installs (dev/QA/prod) use the platform's built-in LLM, the KANAP
included model. A tenant administrator confirms its provider and processing
location before the tenant's data reaches it. Pass `--accept-included-model`
to confirm it as the account of `--email`: the runner reads the provider the
API shows (`GET /ai/settings`) and confirms it in the request that turns the
assistant on. Without the flag, the runner says so, leaves the assistant off
and skips the demo ingestion poll and mock triage; confirm the included model
in Admin > Plaid, then trigger them from the agent cockpit. The platform
console must show a provider name and a processing location first (Platform AI
page), or the included model is unavailable.

On-premise installs must configure an LLM endpoint in the AI settings before
the demo agent can triage tickets; everything else in the fixture works
without AI.

## Known traps

- **The tenant AI surface is off by default.** Agent triage fails with "AI chat is disabled for this tenant" until `PATCH /ai/settings` receives `{ "chat_enabled": true }`. The runner does this when it sets up the demo agent, once the KANAP included model is confirmed (`--accept-included-model`, see "AI prerequisites"). If you skip the agent step (`--skip-agents`) or build the agent by hand, enable it yourself.
- **Users get a password only at creation.** `POST /users` is the one endpoint that accepts an initial password. `PATCH /users/:id` refuses a password (`PASSWORD_UPDATE_NOT_ALLOWED`), so a re-run cannot reset the password of a user that already exists. Use the password reset flow, or delete the user and run the runner again.
- **The seeded admin password is never updated.** With `SEED_ADMIN=true`, the backend creates the admin user from `ADMIN_EMAIL` and `ADMIN_PASSWORD` only when that user does not exist. Changing `ADMIN_PASSWORD` later has no effect on the existing account. If a platform-admin login stops working after an environment change, the stored password is the one from the first boot.

## Demo logins

| Who | Email | Role |
|---|---|---|
| Tenant owner | the `--email` you passed | Administrator |
| Thomas Berger (CIO) | `thomas.berger@fromage-co.example` | Administrator |
| Sophie Laurent | `sophie.laurent@fromage-co.example` | IT Landscape Administrator |
| Maria Casanova (controller) | `maria.casanova@fromage-co.example` | Budget Administrator |
| Nadia Lemaire (shops and e-commerce operations) | `nadia.lemaire@fromage-co.example` | Budget Member |

All demo users share the `--demo-password` value. It is required and has no
default: on any tenant reachable from outside your machine, pass a private
value. The runner sets it only when it creates a user, so choose it before the
first run.

## Files

- `setup-tenant.mjs` — the runner (Node ≥ 20, no dependencies). It reads the
  files through `backend/scripts/lib/fixture-csv.mjs` (year shift) and calls the
  API through `backend/scripts/lib/http-client.mjs`.
- `01-…25-*.csv` — the dataset (semicolon-separated, UTF-8).
- `26-…30-*.csv` — the budget dataset: cost centres, dimension values,
  calendars, costed lines and monthly rows. `14-spend-items.csv` and
  `15-capex-items.csv` are generated too. Regenerate all of them with
  `node backend/fixtures/fromage-co/tools/generate-budget.mjs` (deterministic; edit the
  script, not the files). The IT division has three divisions and twelve cost
  centres over the four legal entities; about 40 % of the OPEX is external
  staffing priced per working day.
- `docs/*.md` — the Service Desk Docs contents.
- The fromage mock helpdesk tickets live in the backend's mock ticketing
  provider (`backend/src/ai/control-plane/providers/mocks/mock-ticketing.provider.ts`,
  entity `fromage-helpdesk`) so they are available in every environment
  without seeding.
