# KANAP agent guide

Shared instructions for every coding agent working on this repository (Claude Code, Codex, Grok,
DeepSeek and others). This file is public: it holds no credentials, hosts or customer data.
Tool-specific or private notes live in each tool's local files, never here.

## How agents work on this repository

- **Bounded tasks** (a fix, a small feature, a doc update): the maintainer gives them to you
  directly. Handle them end to end: analysis, code, tests, user docs if needed, local verification,
  then hand back to the maintainer for testing.
- **Large tasks** (several lots, architecture, migrations, cross-cutting refactors): Claude leads,
  splits the work into lots and writes a brief for each one. Follow the brief. If it contradicts the
  code or this file, say so before going further.
- If a bounded task turns out to be large (schema change, several modules, a product decision),
  stop and ask the maintainer instead of improvising a large change.
- **Private context.** If `CLAUDE.local.md` exists at the repository root, read it at session start
  (it is gitignored, so most tools do not load it automatically). It points to the single project
  memory and explains how to record findings there. Do not keep a separate project memory of your own.
- When you finish: say what you changed and what you verified (commands and results), list what
  you could not verify, and hand back to the maintainer.

## Core principles

- **Simplicity first.** Make every change as simple as possible and touch as little code as possible.
- **Find root causes.** No temporary fixes, no workarounds.
- **Verify before done.** Never call a task complete without proof: tests, logs, a check in the running app.
- **No premature migration.** Before adding a table, column or migration, prove that the existing
  schema and UI cannot already do it, and lead with that analysis.
- **Be decisive on mechanical work.** When the analysis is done, state the plan and do it. Keep
  option menus for genuine product or architecture choices.

## Repository map

- `backend/`: NestJS + TypeORM API (Node 22 in the images and in CI). Source `backend/src/**`, build `backend/dist/`.
- `frontend/`: React + Vite + MUI app. Source `frontend/src/**`.
- `marketing/`: public marketing site and blog.
- `infra/`: Docker Compose stacks. Dev uses a local `docker-compose.yml` copied from
  `docker-compose.example.yml`; servers use `compose.qa.yml`, `compose.prod.yml`, `compose.onprem.yml`.
- `doc/`: architecture, ADRs, on-premise design, API reference. `doc/help/docs/{en,fr,de,es}` is the
  user manual (MkDocs).
- `.agents/skills/`: shared agent skills (see below).

## Workflow with the maintainer

- The maintainer tests every change personally on the local dev stack before it goes anywhere.
- Work and commit locally on a dev branch. **Nothing is pushed or opened before the maintainer
  has validated on dev.** Never push to `main`.
- Once validated: `gh pr create` (problem, changes, testing notes, screenshots for UI), then add
  the PR to the merge queue right away: `gh pr merge <n> --auto --squash`. From there the agent
  owns the PR up to a confirmed merge and reports the merge commit. The maintainer does not need
  to say "merge".
- The merge queue tests each PR on `main` plus the PRs ahead of it, in the order they were added,
  and merges it when `backend (cloud)`, `frontend (cloud)` and `build (onprem)` pass on that
  combination. Queue runs (`merge_group`) run every job. The repository squashes, keeps `(#NNN)`
  in the subject and deletes the branch. Do not watch or poll CI: arrange to be notified of a
  failure (Claude Code: Auto-fix, see `CLAUDE.md`) and report the merge commit on the next
  exchange. A merge needs no message: no news means it merged.
- A failed check or a conflict with `main` drops that PR from the queue; the others continue.
  Fix (merge `main` into the branch for a conflict), push, and add it again with the same command.
- One PR at a time per change: no bundling of validated PRs, the queue handles throughput.
- Releases and deploys to QA and prod are separate from merging and are the maintainer's
  decision; `main` is always releasable.
- One PR per coherent lot. Keep diffs focused.
- Stacked PRs: GitHub closes (does not retarget) a PR whose base branch is deleted at merge.
  Retarget it to `main` first, then delete the base. The base is deleted as soon as it merges,
  so retarget before adding the base to the queue. CI only runs for PRs targeting `main`.
  After a squash merge of the base: `git rebase --onto origin/main <old-base-tip> <branch>`, then
  `git push --force-with-lease`.
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
- Files written by sandboxed agent sessions can land with mode 600 (git does not track that bit)
  and make the dev containers fail with EACCES. After merging another agent's work, list them with
  `git ls-files -z | xargs -0 stat -c '%a %n' | awk '$1=="600"'` and `chmod 644` the hits before rebuilding.
- After a rebuild, check that the container runs the new source (for the web app,
  `curl localhost:5173/src/<path>`) before concluding anything from the browser.
- Open the app on a tenant subdomain: `http://<tenant-slug>.lvh.me`. The apex / `localhost` serves
  the marketing site.
- Scripts against the local API: the tenant comes from the `Host` header, and Node's `fetch`
  silently drops a custom `Host`. Call `http://<tenant-slug>.lvh.me/api/...` instead (curl honours
  `-H 'Host: ...'`). `POST /auth/login` allows 5 calls per minute: a script that logs in repeatedly
  gets a 429 and no token, which then surfaces as an "Invalid token" error. Log in once and reuse it.
- DB: `postgres://app:app@localhost:5432/appdb`. The `app` role is not superuser, so RLS applies:
  run `SET app.current_tenant = '<tenant uuid>'` before reading tenant tables.
- Reset DB: `bash infra/scripts/db-reset.sh`.

## Tests and checks

- Frontend: `npm test` in `frontend/` (Vitest + Testing Library, `*.test.tsx` next to the code).
- Backend: `npm run test:ci` in `backend/`, plus focused suites (`test:rls`,
  `test:tenant-isolation`, `test:master-data`, `test:portfolio`, ...; see `package.json`).
  `npm run typecheck:ci` type-checks only.
- `test:ci` first empties `backend/ci-dist/` (gitignored) and runs `tsc -p tsconfig.ci.json`
  once. That call type-checks the sources, the specs and the database scripts and emits
  JavaScript with source maps. A type error stops the run. Each spec then runs as
  `node ci-dist/backend/<path>.js`. `--no-compile` reuses the last output (CI compiles in its
  own step), `--compile-only` (`npm run build:ci`) only compiles, `--jobs N` sets how many specs
  run at once and `--db-lanes N` the number of database lanes (below).
- A spec still runs alone from its source: `npx ts-node src/.../__tests__/x.spec.ts`. A spec
  that reads source files, fixtures or scripts resolves them with `backendPath()`
  (`src/common/__tests__/backend-root.ts`), not `__dirname`: the compiled tree holds no `.ts`
  file and no fixture.
- CI runs the backend and frontend suites in the cloud jobs, and builds both sides in on-premise
  mode. A failing spec blocks the PR.
- On a PR, each job runs only when its side changed (`backend/`, `frontend/`; a CI file change runs
  all three); a skipped job counts as passed. Every job runs for a push on `main` and in the
  merge queue. The rules live in `.github/scripts/ci-changes.sh`.
- The frontend check runs as a `frontend build` job and three `frontend tests (i/3)` shards in
  parallel (`vitest run --shard`, split by file); the `frontend (cloud)` job only gathers their
  results. To rerun one shard locally: `npm test -- --shard=2/3` in `frontend/`.
- A new `backend/src/**/__tests__/*.spec.ts` runs in CI from its first commit, nothing to register
  (`backend/scripts/run-ci-tests.js`). Specs that boot Nest or TypeORM (`NestFactory.create`,
  `createTestingModule`, `TypeOrmModule`, `.initialize()`, `data-source`, or a `// @database-spec`
  marker) run on the database lanes; the others run in parallel on every free slot.
- Database lanes: with `--db-lanes N`, each lane has its own copy of the migrated database,
  `<db>_1` to `<db>_N`, where `<db>` is the database of `DATABASE_URL`. A lane runs its specs one
  at a time and reuses its copy, as the specs always shared `appdb`. CI makes the copies after
  the migrations (`CREATE DATABASE appdb_n TEMPLATE appdb OWNER app`) and runs 4 lanes. When the
  copies are missing, the runner says so in one line and runs the database specs in series.
- Lanes locally: the runner makes fresh copies on every run when `CI_ADMIN_DATABASE_URL` names a
  role that may create databases. A copy needs a template nobody is connected to, so point
  `DATABASE_URL` at a dedicated migrated database (the dev `appdb` has the API connected):
  `CI_ADMIN_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres`
  `DATABASE_URL=postgres://app:app@localhost:5432/appdb_ci npm run test:ci -- --db-lanes 4`.
  The race specs run on the copies, which are throwaway.
- Exclusive specs touch what the whole PostgreSQL server shares. They run first, one at a time,
  while no other lane runs a database spec. The runner finds them by pattern, in the spec and in
  the `__tests__` helpers it imports: roles, databases, `ALTER SYSTEM`, `pg_reload_conf`,
  `CHECKPOINT`, `pg_terminate_backend`, `pg_cancel_backend`, `pg_stat_reset`, and reads of
  `pg_stat_activity` or `pg_locks` that filter neither on a `pid` nor on the current database.
  Add `// @exclusive-db-spec: <reason>` when a spec depends on the whole server in a way no
  pattern sees (an assertion that holds only when nothing else runs, a server-wide statement in
  application code). When a spec fails only in parallel, find the cause first, and mark it only
  if it truly needs the whole server. Advisory locks are safe on a copy: PostgreSQL keys them by
  database.
- Frontend test traps: jsdom has no `localStorage` here (stub it); a `useTranslation` mock that
  returns a new `t` on each render loops effects (hoist a stable `t`); MUI `Select` hides an
  empty-value `MenuItem` without `displayEmpty`, and its `aria-label` goes through `SelectDisplayProps`.
- Browser automation in a hidden tab: CSS transitions do not advance, so colours read stale after a
  theme toggle. Finish them first: `el.getAnimations().forEach(a => a.finish())`.
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
- A new tenant-scoped table is registered in `backend/src/common/tenant-isolation.inventory.ts`
  and `backend/src/admin/tenants/tenant-purge.inventory.ts` (CI fails otherwise), with a policy
  named `<table>_tenant_isolation` (USING and WITH CHECK). A migration cannot INSERT into a table it
  has just put under FORCE RLS: seed first, enable RLS after.
- In psql, `count(*)` on a FORCE RLS table returns 0 without `app.current_tenant`, even for the
  owner. Count per tenant (a `DO` block looping over tenants with `set_config`).
- Migrations are idempotent and self-healing: they may run on databases nobody can inspect. A
  migration that adds a constraint first repairs the rows that would violate it, deterministically
  (for example keep the earliest row by `created_at, id`), in its own transaction with RLS disabled
  around the repair. It is rerun-safe, logs the repaired counts, and fails loudly only for data it
  cannot repair safely. A spec runs it against a seeded dirty database
  (precedent: `1853640000000-capex-versions-unique-year.ts`).

## Cloud and on-premise modes

KANAP runs as `multi-tenant` (cloud SaaS) and `single-tenant` (on-premise) from one branch, with
runtime feature flags. Any change touching billing, email, SSO, platform admin, tenant resolution
or subscriptions must work in both modes.

- Flags: `backend/src/config/features.ts` (single source of truth).
- Gates: `backend/src/common/feature-gates.ts` (`throwFeatureDisabled()`, `MultiTenantOnlyGuard`, ...).
- Frontend: `GET /api/config/public` → `useFeatures()` in `frontend/src/config/FeaturesContext.tsx`.
- A new gate needs: backend gate + config endpoint + frontend route/nav gate + an update of the
  Feature Gate Inventory in `doc/on-premise/technical-design.md`.

## Known traps

- TypeORM 0.3 drops `null` and `undefined` from find options (`{ fiscal_year: null }` matches every
  row). Use `IsNull()`.
- The JWT payload carries the user id in `sub`: use `req.user.sub`, not `req.user.id`.
- Nest matches routes in declaration order: declare `@Get('export')` before `@Get(':id')`.
- Fire-and-forget notifications must never reject (an unhandled rejection exits Node). Mark them
  `@NeverRejects()` and never hand them the request's entity manager, which may be released first.
- A new NOT NULL column or numbered reference (`item_number`) breaks raw seed inserts: update
  `backend/scripts/rls-self-test.ts` and `backend/src/ai/__tests__/ai-phase1.integration.spec.ts`.
- nginx `add_header ... always` also stamps error responses: a 404 for a missing chunk must not
  be marked `immutable`.
- A hook placed after an early return changes the hook count between renders. Regression tests for
  it need a real `useQuery`, not a mock.
- Never `git add -A` in a tree with `node_modules` symlinks: add explicit paths.
- Never `git clean -x`, `-X` or `-fdx`: it deletes gitignored local files (`.env` files,
  `CLAUDE.local.md`, `planning/`, local agent settings) that git cannot restore. Remove build
  output by explicit path instead.

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
- Prose rules for docs, blog, marketing and UI copy: no em dashes (use a colon, a period or
  parentheses); no "not X, but Y" or "X, never Y" constructions, state the positive fact once; no
  two-beat punchlines; cut anything that carries no information.
- A new manual page also needs a `doc/help/mkdocs.yml` nav entry (with fr/de/es labels), the Help
  button mapping in `frontend/src/utils/docUrls.ts`, a row in `doc/help/_process/doc-update-map.tsv`
  and an inventory entry. Find stale pages with
  `python3 .agents/skills/user-manual-maintainer/scripts/stale_doc_check.py --base origin/main`.
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
