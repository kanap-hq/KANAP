# KANAP agent guide

Shared instructions for every coding agent working on this repository (Claude Code, Codex, Grok,
DeepSeek and others). This file is public: it holds no credentials, hosts or customer data.
Tool-specific or private notes live in each tool's local files, never here.

## Core principles

- **Simplicity first.** Make every change as simple as possible and touch as little code as possible.
- **Find root causes.** No temporary fixes, no workarounds.
- **Verify before done.** Never call a task complete without proof: tests, logs, a check in the running app.
- **No premature migration.** Before adding a table, column or migration, prove that the existing
  schema and UI cannot already do it, and lead with that analysis.
- **Be decisive on mechanical work.** When the analysis is done, state the plan and do it. Keep
  option menus for genuine product or architecture choices.

## Repository map

- `backend/`: NestJS + TypeORM API (Node 22). Source `backend/src/**`, build `backend/dist/`.
- `frontend/`: React + Vite + MUI app. Source `frontend/src/**`.
- `marketing/`: public marketing site and blog.
- `infra/`: Docker Compose stacks. Dev uses a local `docker-compose.yml` copied from
  `docker-compose.example.yml`; servers use `compose.qa.yml`, `compose.prod.yml`, `compose.onprem.yml`.
- `doc/`: architecture, ADRs, on-premise design, API reference. `doc/help/docs/{en,fr,de,es}` is the
  user manual (MkDocs).
- `.agents/skills/`: shared agent skills (see below).

## Workflow with the maintainer

- The maintainer tests every change personally on the local dev stack before it goes anywhere.
- Work and commit locally on a dev branch. **Do not push, open a PR or merge until the maintainer
  has validated on dev and asks for it.** Never `gh pr merge --auto`. Never push to `main`.
- Once asked: `gh pr create` (problem, changes, testing notes, screenshots for UI). CI must pass
  (`backend (cloud)`, `frontend (cloud)`, `build (onprem)`). Merge only when asked:
  `gh pr merge <n> --squash --delete-branch` (squash-only history, the subject keeps `(#NNN)`).
- One PR per coherent lot. Keep diffs focused.
- When a task is finished, say so and ask the maintainer to test.
- Commits: imperative mood, short scope prefix when useful (`backend: ...`, `frontend: ...`,
  `master data: ...`). Attribution footers only when the agent actually wrote the code.
- Guard every `cd` before git commands (`set -e` or `git -C <dir>`): a failed `cd` once ran a
  checkout and cherry-pick in the wrong tree.
- Never read a pass/fail status from `$?` after a pipe (`tail` and `grep` steal it). Use
  `cmd >/dev/null 2>&1; echo $?` or `${PIPESTATUS[0]}`.

## Local stack

- Start: `docker compose -f infra/docker-compose.yml up -d`. Rebuild after changes:
  `docker compose -f infra/docker-compose.yml up -d --build api web`.
- The dev containers are baked images with **no bind-mount**. `api` runs `npm run start:dev`
  (ts-node-dev on `src/`), `web` runs Vite.
- Quick backend-only change: `docker cp` the modified `.ts` into `/app/src/...` and the watcher
  respawns. Run `chmod 644` first: a `0600` file is unreadable for the container's `node` user.
  Copying into `/app/dist` has **no effect** in dev. QA and prod run `dist/` and need an image rebuild.
- Open the app on a tenant subdomain: `http://<tenant-slug>.lvh.me`. The apex / `localhost` serves
  the marketing site.
- DB: `postgres://app:app@localhost:5432/appdb`. The `app` role is not superuser, so RLS applies:
  run `SET app.current_tenant = '<tenant uuid>'` before reading tenant tables.
- Reset DB: `bash infra/scripts/db-reset.sh`.

## Tests and checks

- Frontend: `npm test` in `frontend/` (Vitest + Testing Library, `*.test.tsx` next to the code).
- Backend: `npm run typecheck:ci` and `npm run test:ci` in `backend/`, plus focused suites
  (`test:rls`, `test:tenant-isolation`, `test:master-data`, `test:portfolio`, ...; see `package.json`).
- CI runs the backend and frontend suites in the cloud jobs, and builds both sides in on-premise
  mode. A failing spec blocks the PR.
- UI changes are also verified in a browser, in light **and** dark mode.

## Multi-tenant safety (RLS)

Every query must be scoped by `tenant_id`. This is critical for tenant isolation.

- Never query activity logs, audit trails or any shared table without a `tenant_id` predicate.
- Batch by entity ids (`project_id = ANY($2)`), never N+1 loops.
- Read before any schema, migration or raw-SQL change: `doc/architecture.md` (sections
  "Multitenancy", "Request DB Context", "Current Coverage (RLS + tenant_id)", "RLS Starter
  Pattern") and `doc/adr/0002-multitenancy-storage.md`. The authoritative coverage list is the
  database: `SELECT relname, relforcerowsecurity FROM pg_class WHERE relrowsecurity ORDER BY 1`.
- Migrations run with **no** `app.current_tenant`. `FORCE ROW LEVEL SECURITY` also applies to the
  table owner, so a backfill must disable RLS around itself or it silently touches 0 rows
  (precedent: `1824000000000-audit-log-viewer-metadata-indexes.ts`).
- Migrations must be idempotent and self-healing: they may run on databases in any state.

## Cloud and on-premise modes

KANAP runs as `multi-tenant` (cloud SaaS) and `single-tenant` (on-premise) from one branch, with
runtime feature flags. Any change touching billing, email, SSO, platform admin, tenant resolution
or subscriptions must work in both modes.

- Flags: `backend/src/config/features.ts` (single source of truth).
- Gates: `backend/src/common/feature-gates.ts` (`throwFeatureDisabled()`, `MultiTenantOnlyGuard`, ...).
- Frontend: `GET /api/config/public` → `useFeatures()` in `frontend/src/config/FeaturesContext.tsx`.
- A new gate needs: backend gate + config endpoint + frontend route/nav gate + an update of the
  Feature Gate Inventory in `doc/on-premise/technical-design.md`.

## Product rules

- Frozen or trial-expired tenants: **all** AI and agent features are off (chat, operate, scheduled
  ingestion). The state lives on `Subscription`, not `tenant.status`. Cloud only, no-op on-premise.
  Helper: `evaluateSubscriptionAccess` in `backend/src/billing/subscription-freeze.util.ts`.
- Settings and configuration UI use plain language, never backend words (`cycle`, `ingestion`, raw
  enums). Every field about an external system gets a "where to find this value" hint.
- Agent ticket status changes (close, resolve, pending) are routine work: no dedicated stale-closure
  setting, TTL or special triage path.
- Workspace empty or secondary sections stay about one line. No large always-visible drop zones.
- User-facing lists show **names only** (no email sub-lines). Sentence case everywhere.
- Show business references (`T-4`, `PRJ-3`, `DOC-12`), never raw UUIDs. Do not invent new
  references for tables that have no `item_number`.
- Exported deliverables (PNG, print) carry the drawing and the date only, no context legend.
- License and marketing copy leads with user benefits (no lock-in, self-hosting, control), not the
  license itself.

## UI and design

- Before writing any JSX, apply the design system skill `.agents/skills/kanap-design-system`
  ("Refined Density"). The full charter is in its `references/` folder.
- Reference implementation for a detail page: the companies workspace
  (`frontend/src/pages/companies/CompanyWorkspacePage.tsx`, with its test).
- All user-facing text goes through i18n (`en`, `fr`, `de`, `es`). Use the `extract` and
  `translate` skills.

## Documentation

- User manual: `doc/help/docs/{en,fr,de,es}`. Update the English page, then translate with the
  `translate-docs` skill. `user-manual-maintainer` finds manuals made stale by code changes.
- Tone: clean, professional, human. Short sentences, no filler.
- Update `doc/` when behaviour or endpoints change.

## Shared skills

`.agents/skills/` is the single source. `.claude/skills/` contains symlinks to it. Edit the
files under `.agents/skills/`, never a copy.

| Skill | Use |
|---|---|
| `kanap-design-system` | Any UI work |
| `extract` | Move hard-coded UI strings into locale files |
| `translate` | fr/de/es locale JSON |
| `translate-docs` | fr/de/es user manual pages |
| `user-manual-maintainer` | Keep `doc/help` in line with the product |

## Security

- Never commit secrets. Use `.env` files (`backend/.env`, `frontend/.env`) and the `*.example` files.
- This repository is public. Planning notes, operations docs and agent-private files are gitignored
  (`planning/`, `doc/planning/`, `doc/operations/`, `CLAUDE.local.md`, ...). Keep it that way.
