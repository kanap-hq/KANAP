# On-Premise Operations

## Upgrade Procedure

```bash
# 1. Backup database and storage (your responsibility)

# 2. Pull latest changes and rebuild
cd kanap
git pull origin main
docker build -t kanap-api:latest ./backend
docker build -t kanap-web:latest ./frontend

# 3. Restart containers (migrations run automatically)
docker compose -f infra/compose.onprem.yml up -d
# The old API container first finishes the requests in progress, the emails it queued and
# its running background jobs (up to 20 s), then stops.

# 4. Verify startup
docker compose -f infra/compose.onprem.yml logs -f api
# Wait for "Application started" message
```

**Breaking changes:** Check `CHANGELOG.md` before upgrading.

**Rollback:** Restore database from backup. Migrations are forward-only.

## Version Support

KANAP is a quickly evolving solution and we recommend upgrading on a monthly basis.
For customers under support, an upgrade to the latest version might be requested before handling a support request.

## Backup & Restore

- **PostgreSQL:** Use `pg_dump`/`pg_restore` or managed DB backups
- **S3 Storage:** Use bucket versioning, replication, or provider backups

**Recommendation:** Daily database backups, retain at least 30 days.

## PostgreSQL Settings

PostgreSQL's defaults are sized for a small machine. `infra/postgres/kanap-pg-tune.sh` prints settings sized from your server's memory (memory, SSD costs, slow statement log, statement statistics). Run it on the PostgreSQL server and read the file before applying it: its header explains each value.

```bash
# The libraries PostgreSQL already preloads (often none): the script keeps them.
CURRENT=$(sudo -u postgres psql -XAtc 'SHOW shared_preload_libraries')
# PostgreSQL on the same server as KANAP (add --dedicated if it has the server to itself)
sh infra/postgres/kanap-pg-tune.sh --preload "$CURRENT" | sudo tee /etc/postgresql/16/main/conf.d/kanap.conf
sudo systemctl restart postgresql
sudo -u postgres psql -d kanap -c 'CREATE EXTENSION IF NOT EXISTS pg_stat_statements'
```

Two checks before the restart, both done by the script, which writes the `shared_preload_libraries` line commented out when one fails:

- **The list of preloaded libraries.** `shared_preload_libraries` is one list, and the value in `kanap.conf` replaces the one in `postgresql.conf`. Without `--preload`, add the value of `SHOW shared_preload_libraries` in front yourself (for example `'pg_cron,pg_stat_statements'`), then remove the `#`.
- **The library itself.** PostgreSQL does not start when a preloaded library is missing. It ships with PostgreSQL on Debian and Ubuntu; on RHEL and derivatives, install the contrib package (`postgresql16-contrib`). Check with `ls "$(pg_config --pkglibdir)/pg_stat_statements.so"`.

The restart is needed once, for the memory setting and the statement statistics: plan it in a maintenance window, KANAP cannot reach its database while PostgreSQL restarts. Statements slower than 500 ms then appear in the PostgreSQL log, without their parameters (`log_parameter_max_length = 0`: they can hold personal data). `pg_stat_statements` lists the costliest statements:

```sql
SELECT calls, round(mean_exec_time) AS avg_ms, left(query, 80) AS query
FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 10;
```

KANAP's migrations also make autovacuum start earlier on the two largest tables (budget amounts). That needs no restart and no memory.

## Monitoring

**Health endpoint:**

`GET /api/health` → `{ "status": "ok" }`

```bash
curl https://kanap.company.com/api/health
```

**Container health:**
```bash
docker compose -f infra/compose.onprem.yml ps
docker compose -f infra/compose.onprem.yml logs -f api
```

**Key metrics:**
- Containers running (`api`, `web`)
- API memory under ~1 GB per API process
- Database connections
- Storage usage

### API metrics for a monitoring tool

Set `OPS_METRICS_TOKEN` in `.env` (24 characters or more, for example `openssl rand -hex 32`) and restart the API. Your monitoring tool can then read:

```bash
curl -s -H "Authorization: Bearer $OPS_METRICS_TOKEN" https://kanap.company.com/api/ops/metrics
```

The answer is JSON. Without the setting the address answers 404. It answers even when the API is overloaded: the figures that need the database are then marked `db.statsStale`. The fields to watch:

| Field | What it tells |
|---|---|
| `health.status` | `ok`, `warn` or `critical`, from the thresholds below. `health.alerts` lists what is wrong and what to do |
| `topRoutes` | Requests per route over 5 minutes, with p50, p95 and p99 response times in milliseconds |
| `process.eventLoopLagMs.p95` | How long the API's main thread kept requests waiting over the last minute |
| `db.pool.inUse`, `db.pool.inUseMax1m`, `db.pool.waitingCount` | Database connections in use now, the most over the last minute, requests waiting for one |
| `db.pool.wait.p95Ms1m`, `db.pool.wait.failures5m` | Time to get a database connection; requests that got none (answered "busy") |
| `windows.5m.statusClasses` | Answers per status class over 5 minutes |
| `processes`, `aggregate` | With several API processes: each one, and all of them together |

Alert thresholds (`health` applies them; with several API processes, to all of them together, and the database pool to the fullest one). An alert fires above the threshold:

| Alert | Warning | Critical | What to do |
|---|---|---|---|
| Event loop p95 (1 min) | 100 ms | 500 ms | Add API processes (`API_WORKERS`) if the server has free cores |
| Wait for a database connection, p95 (1 min) | 50 ms | 1 s | Raise `DB_POOL_MAX` within PostgreSQL's `max_connections` |
| Connections in use, highest over 1 min | 90 % of the pool | | Same |
| Requests that got no connection (5 min) | | any | Check that PostgreSQL is up and `max_connections` is not reached |
| Server errors (5 min, from 20 requests) | 1 % | 5 % | Read the API log |
| p95 of one route (5 min, from 20 requests) | 1 s | 3 s | Report it with the route name; imports, exports and AI routes are not counted |
| Memory of one API process | 1 GB | | Restart the API; report it if it comes back |

## Troubleshooting

| Symptom | Check | Solution |
|---------|-------|----------|
| Containers not starting | `docker compose logs api` | Check for startup errors |
| `[DB] pool budget exceeded` in the API log | `API_WORKERS`, `DB_POOL_MAX`, PostgreSQL `max_connections` | Lower `DB_POOL_MAX` to the value the message gives (or `API_WORKERS`), or raise `max_connections` |
| "Database connection failed" | Verify `DATABASE_URL` | Check PostgreSQL accessibility/credentials |
| "S3 error" | Verify S3_* variables | Ensure bucket exists and permissions are correct |
| Migration failed | Check PostgreSQL version | Must be 16+, extensions available |
| 502 from reverse proxy | `docker compose ps` | Ensure api container is running on port 8080 |
| Can’t login | Verify `.env` credentials | Use password reset below |

## Password Reset

**Recommended:** Configure email (Resend API or single-tenant SMTP) and use the "Forgot Password" flow.

**Fallback (SQL):** If email is not configured, reset passwords directly in the database.

**1) Generate a password hash:**

```bash
# Using Node.js with argon2
# (argon2 is a production dependency in the API image)
docker compose -f infra/compose.onprem.yml exec api \
  node -e "require('argon2').hash('NewPassword123!').then(h => console.log(h))"
```

**2) Update the user in PostgreSQL:**

```sql
UPDATE users
SET password_hash = '$argon2id$v=19$m=65536,t=3,p=4$...'
WHERE email = 'user@company.com';
```

This SQL method is a last-resort fallback for locked-out administrators.
