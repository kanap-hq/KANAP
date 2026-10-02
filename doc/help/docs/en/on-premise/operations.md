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
- API memory under ~1 GB
- Database connections
- Storage usage

## Troubleshooting

| Symptom | Check | Solution |
|---------|-------|----------|
| Containers not starting | `docker compose logs api` | Check for startup errors |
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
