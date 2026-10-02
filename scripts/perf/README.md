# Performance bench (perf plan, step 0)

Scripts to build a large tenant and measure KANAP under load. No dependencies, Node 20 or later.

| File | Role |
|---|---|
| `generate-dataset.mjs` | Deterministic CSV dataset in the Fromage fixture formats, scaled (default 5,000 OPEX, 1,000 CAPEX, 1,500 suppliers, 800 accounts, 300 cost centres, 4 dimensions, 800 contracts, 5 budget years) |
| `load-tenant.mjs` | Loads the dataset through the API and the real CSV import endpoints, and times each step |
| `bench.mjs` | `single`: one request at a time, warm, per heavy endpoint. `load`: N virtual users replaying the list and workspace request patterns, with server-side sampling |
| `explain.sql` | `EXPLAIN (ANALYZE, BUFFERS)` of the list's main SQL and of the chargeback amounts query, read-only |
| `lib/http.mjs` | HTTP client on `node:http` (6 connections per virtual user, like a browser over HTTP/1.1) |

## Environment used on 2026-10-01

- Database `appdb_perf` on the dev Postgres (`kanap-db-1`). Never another database.
- API container `kanap-perf-api`, built from `backend/Dockerfile` (compiled `dist/`, migrations at boot), single-tenant mode, tenant slug `perf`, published on `127.0.0.1:18080`.
- Minimal env file (no external keys): `DEPLOYMENT_MODE=single-tenant`, `DEFAULT_TENANT_SLUG=perf`, `ADMIN_EMAIL`/`ADMIN_PASSWORD`, random `JWT_SECRET`, `NODE_ENV=production`, `APP_ENV=perf` (non-production checks: permissive CORS), `RATE_LIMIT_ENABLED=false`, `CAPTCHA_MODE=off`, AI flags off, `EMAIL_OVERRIDE` to a `.invalid` address and no mail key, `S3_ENDPOINT` pointing at a closed local port, `DB_APP_NAME=kanap-perf-api` (to find its connections in `pg_stat_activity`). Do not set `SEED_ADMIN=true` in single-tenant mode: that path returns from `bootstrap()` before the server listens when the tenant does not exist yet.

## Rerun

```bash
S=<scratch dir>            # holds perf-api.env, credentials, dataset, results
W=<this worktree>

# 1. API (one image build at a time; check `free -g` first)
docker build -t kanap-perf-api -f $W/backend/Dockerfile $W/backend
docker run -d --name kanap-perf-api --network kanap_default -p 127.0.0.1:18080:8080 \
  --env-file $S/perf-api.env --memory=3g kanap-perf-api
# later: docker start kanap-perf-api / docker stop kanap-perf-api

# 2. Dataset + load (about 7 minutes in total on an empty tenant)
node $W/scripts/perf/generate-dataset.mjs --out $S/dataset
node $W/scripts/perf/load-tenant.mjs --base-url http://127.0.0.1:18080 \
  --email <admin> --password <pw> --data $S/dataset --results $S/results
#   --only settings,master,items,budget,costed,allocations,links,projects,projectlinks,tasks,fx
#   reruns a subset. Imports are upserts; tasks are not (a second run duplicates them).

# 3. Bench (bench-config.json: baseUrl, admin, members[], pg, container)
node $W/scripts/perf/bench.mjs single --config $S/bench-config.json --out $S/results/single.json
for v in "1 180 5" "10 240 30" "25 240 30" "50 300 60"; do set -- $v
  node $W/scripts/perf/bench.mjs load --config $S/bench-config.json --vus $1 --duration $2 --ramp $3 \
    --out $S/results/load-$1vu.json
done

# 4. Plans
PGPASSWORD=app psql -h 127.0.0.1 -U app -d appdb_perf -v tenant=perf -f $W/scripts/perf/explain.sql
```

To start from an empty database again: stop the container, drop and recreate `appdb_perf` with the
extensions `citext, pgcrypto, uuid-ossp, unaccent, pg_trgm` (owner `app`), start the container
(migrations run at boot and create the tenant and the admin), then steps 2 to 4.

## What the load mode replays

Each virtual user logs in (VU 0 as the administrator, the others as budget members), opens the
OPEX list, then loops: think time 2 to 5 s, then one scenario drawn from this mix.

| Scenario | Weight | Requests (source) |
|---|---|---|
| list open | 14 | `/budget-columns`, `/analytics-axes`, `/users?limit=1000` (cached 5 min / 30 s), then 1 block + 3 footer totals in parallel (`OpexListPage.tsx:258-278`, `ServerDataGrid.tsx:492-511, 627-635`) |
| sort change | 8 | toggles amount sort and `item_number`: 2 blocks in sequence + 2 totals |
| set filter open + 3 clicks | 8 | paying company set filter: `filter-values`, then per click 2 blocks + 1 total |
| column text filter (typed) | 7 | 5 characters, 120 to 200 ms apart, 1 block + 1 total per character (no debounce), then clear |
| quick search | 10 | 1 block + 1 total (400 ms debounce) |
| scroll 10 blocks | 6 | blocks 2 to 11 in sequence (`maxConcurrentDatasourceRequests = 1`) |
| open an item | 16 | wave 1: detail, `/summary/ids`, settings, cost-centre tree, suppliers and companies lists (1,000 rows), one value list per dimension; wave 2 on `data.id`: 5 relation counts, tasks, `/users?limit=1000` (share dialog), owner pickers, accounts of the company + account by id (`SpendItemPage.tsx` and children) |
| next x10 | 10 | per step: detail, then 5 relation counts + tasks (+ owners and accounts when not cached) |
| field save | 11 | `PATCH /spend-items/:id {notes}` then detail refetch |
| budget cell save | 10 | budget tab (company, versions, freeze state, yearly totals, then amounts of the year), then `POST /spend-versions/:id/amounts/bulk-upsert {kind: monthly, months: [{period, forecast}]}` |

React Query caching is modelled per virtual user (30 s default stale time, 5 min for settings-like
hooks). 403 answers (budget members may not read users or currency settings, which the pages ask
for anyway) are reported apart and not counted as errors.

Server side, every 2 s: `pg_stat_activity` for `application_name = kanap-perf-api` (active, idle in
transaction, waiting on a lock); `docker stats` every second; every second a CORS preflight
`OPTIONS /health`, answered by the cors middleware before any database access, as an event-loop
lag probe (the ops metrics endpoint is multi-tenant only and its histogram is never reset).
