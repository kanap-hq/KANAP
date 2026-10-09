# On-premise operations

The commands on this page run on the KANAP server, in `/opt/kanap` unless stated otherwise. Several of them use two shell variables. Set them once in your terminal session, with your values:

```bash
KANAP_HOST=kanap.example.internal    # the name users type to open KANAP, without https://
ADMIN_EMAIL=admin@example.internal   # the email of an administrator account
```

The `curl` commands on this page use `-k`. They check what KANAP answers, so they also accept a certificate the server does not trust (self-signed, or from an internal authority that is not installed on the server).

## Upgrade procedure

KANAP publishes a new version about once a month. The `stable` branch always points to the latest published version. Every version has an entry in `CHANGELOG.md` at the root of the repository. An entry that needs something from you (a setting to change, a step to run) has "Action required" in its title.

**1. Read the changelog before you pull.** Fetch the new state of `stable` and show only the entries you do not have yet. Read the entries marked "Action required" first, and do what they say. The same entries are on the GitHub releases page of the repository.

```bash
cd /opt/kanap
git fetch origin stable
git diff HEAD origin/stable -- CHANGELOG.md
```

**2. Back up the database, the files and the configuration.** Run the commands of [Before an upgrade](#before-an-upgrade). They write to a directory of their own, which the daily backup never touches. Migrations only go forward: this backup is the way back.

**3. Pull, build, start.**

```bash
cd /opt/kanap
git checkout stable
git pull origin stable
docker compose -f infra/compose.onprem.yml build --pull
docker compose -f infra/compose.onprem.yml up -d
# The old API container first finishes the requests in progress, the emails it queued and
# its running background jobs (up to 20 s), then stops. Migrations run when the new one starts.
```

Docker Compose builds the `api` and `web` images itself, from the sources you just pulled. `--pull` also fetches updated base images. Running `up -d` alone keeps the old version, because Compose reuses the images it already has. Always run `build` first. The build needs the memory of the [installation prerequisites](installation.md#prerequisites). If it stops with `signal: killed`, the server ran out of memory: build the two images one after the other (`build --pull api`, then `build --pull web`), then run `up -d`.

**A precise version.** To run a published version other than the latest, fetch the tags and check one out. The checkout is detached. The `git checkout stable` of step 3 brings it back to the branch at the next upgrade.

```bash
git fetch --tags
git checkout v26.10.1
```

Then run the `build --pull` and `up -d` commands above.

**Following `main`.** The `main` branch holds every merged change before it is published as a version. Following it is possible; the published versions are the recommended path.

**Which version runs.**

```bash
cd /opt/kanap
git describe --tags
curl -sSk -w '\n' "https://${KANAP_HOST}/api/config/public"
```

The first command prints the version of the checkout. The second one answers with a JSON document whose `version` field is the version the API reports.

**4. Check the upgrade.**

```bash
cd /opt/kanap
docker compose -f infra/compose.onprem.yml ps
docker compose -f infra/compose.onprem.yml logs --no-log-prefix api | grep -E '^\[|^Admin seeding|WARN|ERROR|successfully started|Email transport'
curl -sSk -w '\n' "https://${KANAP_HOST}/api/health"
```

- `ps` shows `api` and `web` as `healthy` after about a minute. When the new version did not change the web content, Compose keeps the running `web` container, and `ps` can show an image id in place of `infra-web`. That is expected.
- The API log shows the migrations (`[entrypoint] Migrations complete (N executed).`) and then the start of the API (`Nest application successfully started`). Read the other start-up lines too: [Configuration](configuration.md#what-the-api-log-shows-at-start) explains each one.
- The health address answers `{"status":"ok"}`.

Then run the smoke test. It checks the database, the sign-in, the main lists and the exports through the public API. The server has no Node.js, so it runs in a container. The first run on a server downloads the `node:24-alpine` image from Docker Hub (about 240 MB) and keeps it: run the test once while outbound access is open (see [Firewall rules](configuration.md#outbound-initial-setup-and-build)). At the prompt, type the current password of the `ADMIN_EMAIL` account; nothing shows as you type. The `ADMIN_PASSWORD` of `.env` is read at the first start only, so it may no longer be the right one. Keep `-e KANAP_INSECURE_TLS=1` when the certificate is self-signed (the container does not trust it); remove it with a certificate from a public authority. With a certificate from your internal authority, keep it, or replace it with `-v /opt/kanap/infra/certs:/certs:ro -e NODE_EXTRA_CA_CERTS=/certs/company-ca.pem` to let the container check the certificate against the authority's file in `/opt/kanap/infra/certs/` (see [Certificates from an internal authority](configuration.md#optional-certificates-from-an-internal-authority)). Do not add `-e KANAP_WRITE=1` on a production installation: that option creates a temporary task with an attachment to check the storage, which suits a new installation only.

```bash
read -rsp 'Administrator password: ' KANAP_PASSWORD; echo; export KANAP_PASSWORD
docker run --rm --network host \
  -e KANAP_URL="https://${KANAP_HOST}" -e KANAP_EMAIL="${ADMIN_EMAIL}" -e KANAP_PASSWORD \
  -e KANAP_INSECURE_TLS=1 \
  -v /opt/kanap/scripts/smoke:/smoke:ro node:24-alpine node /smoke/recette.mjs
unset KANAP_PASSWORD
```

The last line of the output reads `0 failed`. With `KANAP_INSECURE_TLS=1`, two TLS warnings at the top of the output are expected: the script's own and the Node.js warning about `NODE_TLS_REJECT_UNAUTHORIZED`.

**Rollback.** Migrations only go forward, so a rollback puts back the backup taken before the upgrade, under the previous version:

1. Stop KANAP: `cd /opt/kanap`, then `docker compose -f infra/compose.onprem.yml down`. A rollback often starts in a new terminal, outside `/opt/kanap`.
2. Check out the previous version and build it. The build needs the outbound access of an upgrade: if you closed it after the upgrade, open it first (see [Firewall rules](configuration.md#outbound-initial-setup-and-build)). Then run `git checkout v<previous version>` (for example `git checkout v26.10.1`), then `docker compose -f infra/compose.onprem.yml build --pull`.
3. Restore the database and the files from the `before-upgrade-...` directory of that upgrade: choose the backup, then run steps 1 to 3 of [Restore](#restore) in the same terminal. If you changed `.env` for the new version, compare it with the copy in the `config` directory of the backup. This command compares the setting names of the two files without printing their values:

    ```bash
    diff <(cut -d= -f1 /opt/kanap/.env | sort) <(sudo cut -d= -f1 "$BACKUP/config/.env" | sort)
    ```

    It lists only the names that differ. To compare the values, open both files.
4. Start KANAP: `docker compose -f infra/compose.onprem.yml up -d --wait`.
5. Check it as in step 4 above (**Check the upgrade**). Its commands use `KANAP_HOST` and `ADMIN_EMAIL` from the top of this page: in a new terminal, set them first.

Build the previous version before you start KANAP: a start with the newer version would run its migrations on the restored database again.

After a rollback, stay on the tag of the version you rolled back to. The `git checkout stable` of the upgrade procedure (its step 3) brings the checkout back to the branch at the next upgrade. The checkout (`git describe --tags`) and the running API (`/api/config/public`, see [Which version runs](#upgrade-procedure)) must show the same version. If they differ, the next `build` changes the running version.

## Version support

KANAP is a quickly evolving solution. Versions are published about once a month, and we recommend upgrading at least monthly.
For customers under support, an upgrade to the latest version might be requested before handling a support request.

## Backup and restore

Back up three things: the database, the files in the storage, and the configuration. The commands below match the [installation example](installation-example.md): PostgreSQL and RustFS on the server. With a managed PostgreSQL service or an S3 provider, use the snapshots, versioning or replication they offer, and still back up the configuration.

**Prepare the backup directory** (once). It holds personal data and secrets: only `root` and `postgres` can read it.

```bash
sudo install -d -o postgres -g postgres -m 0700 /var/backups/kanap
sudo install -d -m 0700 /var/backups/kanap/files /var/backups/kanap/config
```

**Database.** `pg_dump -Fc` writes a compressed dump that `pg_restore` reads back.

```bash
sudo -u postgres pg_dump -Fc -f /var/backups/kanap/db-$(date +%F).dump kanap
sudo -u postgres pg_restore --list /var/backups/kanap/db-$(date +%F).dump | head -5
```

**Files.** The `rc` tool of the installation example copies the bucket to a directory. It uses the `kanapstore` alias that the installation defined in root's configuration. The copy mirrors the bucket: files deleted in KANAP disappear from it at the next run. The copy is made through the storage's S3 interface, so it holds the files in the clear. Protect the directory accordingly.

```bash
sudo rc mirror --overwrite --remove kanapstore/kanap-files /var/backups/kanap/files
```

For any other S3 store, `rclone` does the same job (`sudo apt-get install -y rclone`). Replace the example values with those of your store and type the access key and the secret key at the prompts (the `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` of `.env`). `sudo` passes on only the variables that `KEEP` names: the `sudo` of Ubuntu 26.04 ignores `-E`. `rclone check` compares the copy with the bucket:

```bash
export RCLONE_S3_PROVIDER=Other
export RCLONE_S3_ENDPOINT='https://s3.example.com'   # S3_ENDPOINT of .env, as the server reaches it
export RCLONE_S3_REGION='us-east-1'                   # S3_REGION of .env
export RCLONE_S3_FORCE_PATH_STYLE=true                # S3_FORCE_PATH_STYLE of .env
read -rp 'Access key: ' RCLONE_S3_ACCESS_KEY_ID; export RCLONE_S3_ACCESS_KEY_ID
read -rsp 'Secret key: ' RCLONE_S3_SECRET_ACCESS_KEY; echo; export RCLONE_S3_SECRET_ACCESS_KEY
BUCKET=kanap-files                                    # S3_BUCKET of .env
KEEP=RCLONE_S3_PROVIDER,RCLONE_S3_ENDPOINT,RCLONE_S3_REGION,RCLONE_S3_FORCE_PATH_STYLE,RCLONE_S3_ACCESS_KEY_ID,RCLONE_S3_SECRET_ACCESS_KEY
sudo --preserve-env="$KEEP" rclone sync ":s3:${BUCKET}" /var/backups/kanap/files
sudo --preserve-env="$KEEP" rclone check ":s3:${BUCKET}" /var/backups/kanap/files
```

`rclone check` ends with `0 differences found`. rclone may also print `Config file "/root/.config/rclone/rclone.conf" not found - using defaults`: the variables replace that file. Use `RCLONE_S3_PROVIDER=AWS` for AWS S3. For RustFS on the server, the endpoint is `http://172.17.0.1:9000`: `host.docker.internal` only exists inside the containers.

**Configuration.** Keep a copy of `/opt/kanap/.env` and of `/etc/default/rustfs`. The first one holds every secret of the installation, including `AI_SETTINGS_ENCRYPTION_SECRET` when you use it. The second one holds the RustFS encryption key: files encrypted with it cannot be read without it. Also keep the nginx site file (`/etc/nginx/sites-available/kanap`) and the certificate files.

```bash
sudo cp -p /opt/kanap/.env /etc/default/rustfs /var/backups/kanap/config/
```

**Every day, with 30 days of history.** This cron file runs the three backups at night and deletes the database dumps older than 30 days. It writes one dump per day; the files copy and the configuration copy keep the latest state.

```bash
sudo tee /etc/cron.d/kanap-backup >/dev/null <<'EOF'
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
15 2 * * * postgres pg_dump -Fc -f /var/backups/kanap/db-$(date +\%F).dump kanap
30 2 * * * root rc mirror --overwrite --remove kanapstore/kanap-files /var/backups/kanap/files
45 2 * * * root cp -p /opt/kanap/.env /etc/default/rustfs /var/backups/kanap/config/
0 3 * * * root find /var/backups/kanap -maxdepth 1 -name 'db-*.dump' -mtime +30 -delete
EOF
```

**Copy the backup directory off the server.** A backup on the same disk does not survive the loss of the server. Copy `/var/backups/kanap` to another machine every day, for example with `rsync -a /var/backups/kanap/ <user>@<backup host>:<directory>/` from a scheduled job, or with the backup tool you already use. The copy holds secrets and personal data: protect its destination.

**Test a restore every few months**, on a spare server, so that you know the backups work before you need them.

### Before an upgrade

Before each upgrade, take a full backup into a dated directory of its own, for example `/var/backups/kanap/before-upgrade-20261009-1400/`. It holds `db.dump`, `files/` and `config/`. The daily backup writes other names, so it never overwrites this one.

```bash
B=/var/backups/kanap/before-upgrade-$(date +%Y%m%d-%H%M)
sudo install -d -o postgres -g postgres -m 0700 "$B"
sudo install -d -m 0700 "$B/files" "$B/config"
sudo -u postgres pg_dump -Fc -f "$B/db.dump" kanap
sudo -u postgres pg_restore --list "$B/db.dump" | head -5
sudo rc mirror --overwrite --remove kanapstore/kanap-files "$B/files"
sudo cp -p /opt/kanap/.env /etc/default/rustfs "$B/config/"
echo "$B"
```

The last line prints the directory. Note it: a rollback restores from it. With another S3 store, replace the `rc mirror` line with the `rclone sync` command of the files backup above, with `"$B/files"` as the destination. Set the variables of that block first, `KEEP` included, in the same terminal.

Keep this directory until the new version has run without trouble for a few weeks. The daily `find ... -mtime +30 -delete` of the cron file removes old daily dumps only. Delete an old `before-upgrade-...` directory yourself: list them with `sudo ls /var/backups/kanap/`, then run `sudo rm -r` followed by the path of the directory.

### Restore

These steps replace the database and the files with the content of a backup. Run them in order, in one terminal: each step uses the variables you set first.

**Choose the backup.** List the backups:

```bash
sudo ls /var/backups/kanap/
```

The list shows the `before-upgrade-...` directories and the daily dumps (`db-YYYY-MM-DD.dump`). To restore a backup taken before an upgrade, set its directory:

```bash
BACKUP=/var/backups/kanap/before-upgrade-20261009-1400   # your directory
DUMP="$BACKUP/db.dump"
FILES="$BACKUP/files"
```

To restore a daily backup instead, set the dump of that day. The daily files copy holds the latest state of the files:

```bash
DUMP=/var/backups/kanap/db-2026-10-09.dump   # your date
FILES=/var/backups/kanap/files
```

**1. Restore the database.** This block stops KANAP, recreates the database owned by the application role and restores the dump. It runs nothing unless the dump file exists and `pg_restore` can read it:

```bash
cd /opt/kanap
sudo test -s "$DUMP" \
  && sudo -u postgres pg_restore --list "$DUMP" </dev/null >/dev/null \
  && docker compose -f infra/compose.onprem.yml down \
  && sudo -u postgres psql -X -v ON_ERROR_STOP=1 -c 'DROP DATABASE IF EXISTS kanap' \
  && sudo -u postgres psql -X -v ON_ERROR_STOP=1 -c 'CREATE DATABASE kanap OWNER kanap TEMPLATE template0' \
  && sudo -u postgres pg_restore -d kanap "$DUMP" </dev/null \
  && echo 'Database restored' \
  || echo 'Stopped. Read the message above; with no message, DUMP is empty or the file is missing.'
```

The last line reads `Database restored`. When it reads `Stopped`, nothing after the failed command ran.

Run `pg_restore` as `postgres` and without `--no-owner`. The dump records the owner of every object (`kanap`), so the restore gives the tables back to the application role, with their row-level security settings. With `--no-owner` the tables would belong to `postgres` and the API could not use them. The `kanap` role must exist: on a new server, create it as in [step 4 of the installation example](installation-example.md#4-postgresql) before this step.

**2. Restore the files.** The copy replaces the content of the bucket. The command runs only if the copy exists:

```bash
sudo test -d "$FILES" \
  && sudo rc mirror --overwrite --remove "$FILES" kanapstore/kanap-files \
  && echo 'Files restored' \
  || echo 'Files not restored. Read the message above; with no message, FILES is empty or the directory is missing.'
```

If the storage was lost too, set it up again as in [step 5 of the installation example](installation-example.md#5-object-storage-rustfs), with the same `/etc/default/rustfs`, before this step.

**3. Check the result.** The first query prints `0` (no table owned by another role) and the second one prints a number above `0` (the tables that carry row-level security):

```bash
sudo -u postgres psql -d kanap -Atc "SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tableowner <> 'kanap'"
sudo -u postgres psql -d kanap -Atc "SELECT count(*) FROM pg_class WHERE relrowsecurity AND relforcerowsecurity"
```

**4. Start KANAP.**

```bash
cd /opt/kanap
docker compose -f infra/compose.onprem.yml up -d --wait
```

Then run the smoke test of [Check the upgrade](#upgrade-procedure) and open KANAP in a browser.

## Maintenance tools image

The API image holds the compiled application only. A maintenance command that needs TypeScript, such as `npm run typeorm`, runs in a second image built from the same sources. Build it from the current checkout right before each use, so that it matches the running version. The build reuses the cached layers of the API image and takes about 10 to 20 seconds when the API image is already built:

```bash
cd /opt/kanap
docker build --target dev -t kanap-api-tools backend
```

Run a command in it with the same `.env` and the same certificate directory as the API (see [Certificates from an internal authority](configuration.md#optional-certificates-from-an-internal-authority)). This example lists the migrations and whether they are applied:

```bash
cd /opt/kanap
docker run --rm --env-file .env --add-host host.docker.internal:host-gateway \
  -v /opt/kanap/infra/certs:/etc/kanap/certs:ro \
  kanap-api-tools npm run typeorm -- migration:show
```

## PostgreSQL settings

PostgreSQL's defaults are sized for a small machine. `infra/postgres/kanap-pg-tune.sh` prints settings sized from your server's memory (memory, SSD costs, slow statement log, statement statistics). Run it on the PostgreSQL server and read the file before applying it: its header explains each value. The installation example applies it in [step 4](installation-example.md#size-postgresql-for-this-server).

```bash
cd /opt/kanap
PGVER=18   # 16 on Ubuntu 24.04
# The libraries PostgreSQL already preloads (often none): the script keeps them.
CURRENT=$(sudo -u postgres psql -XAtc 'SHOW shared_preload_libraries')
# PostgreSQL on the same server as KANAP (add --dedicated if it has the server to itself)
sh infra/postgres/kanap-pg-tune.sh --preload "$CURRENT" | sudo tee /etc/postgresql/${PGVER}/main/conf.d/kanap.conf >/dev/null
sudo systemctl restart postgresql
sudo -u postgres psql -d kanap -c 'CREATE EXTENSION IF NOT EXISTS pg_stat_statements'
```

When the database already has the extension, as after the installation example, the last command prints `NOTICE:  extension "pg_stat_statements" already exists, skipping`. That is expected.

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

**Health.** The API answers `GET /health` on its own port and `GET /api/health` through the reverse proxy. Both return `{"status":"ok"}`:

```bash
curl -sSk -w '\n' http://127.0.0.1:8080/health
curl -sSk -w '\n' "https://${KANAP_HOST}/api/health"
```

**Containers.** `docker compose -f infra/compose.onprem.yml ps` shows `healthy` for `api` and `web` once they answer. Docker only reports it: nothing restarts on that status.

```bash
cd /opt/kanap
docker compose -f infra/compose.onprem.yml ps
docker compose -f infra/compose.onprem.yml logs -f api
```

Docker keeps at most 5 files of 10 MB of logs per container (about 50 MB), so the log reaches back that far only.

**Key metrics:**

- Containers running (`api`, `web`)
- API memory under ~1 GB per API process
- Database connections
- Storage usage

### After a reboot

Nothing to do: everything starts by itself. PostgreSQL and nginx start as services, the storage of the installation example starts after Docker, and Docker starts the `api` and `web` containers again. The API answers about 10 seconds after the server boots. If PostgreSQL is slower than Docker, the API retries the database (30 times, 2 seconds apart). Three checks:

```bash
cd /opt/kanap
docker compose -f infra/compose.onprem.yml ps
curl -sSk -w '\n' "https://${KANAP_HOST}/api/health"
ss -ltn | grep 172.17.0.1:9000
```

- `ps` shows `api` and `web` as `healthy`.
- The health address answers `{"status":"ok"}`.
- The last command shows one line with `172.17.0.1:9000`: the storage of the installation example listens. With another storage, check it your own way.

### API metrics for a monitoring tool

Set `OPS_METRICS_TOKEN` in `.env` (24 characters or more, for example `openssl rand -hex 32`) and recreate the API (`docker compose -f infra/compose.onprem.yml up -d api`). Your monitoring tool can then read:

```bash
OPS_METRICS_TOKEN=$(grep '^OPS_METRICS_TOKEN=' /opt/kanap/.env | cut -d= -f2-)
curl -sSk -w '\n' -H "Authorization: Bearer ${OPS_METRICS_TOKEN}" "https://${KANAP_HOST}/api/ops/metrics"
```

The answer is JSON. Without the setting the address answers 404. It answers even when the API is overloaded: the figures that need the database are then marked `db.statsStale`. The fields to watch:

| Field | What it tells |
|---|---|
| `health.status` | `ok`, `warn` or `critical`, from the thresholds below. `health.alerts` lists what is wrong and what to do |
| `topRoutes` | Requests per route over 5 minutes, with p50, p95 and p99 response times in milliseconds |
| `process.eventLoopLagMs.p95` | How long the API's main thread kept requests waiting over the last minute (the current part of a minute just after a start) |
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

Start with the API log: `docker compose -f infra/compose.onprem.yml logs --no-log-prefix --tail=200 api`.

| Symptom | Check | Solution |
|---------|-------|----------|
| Containers not starting | `docker compose -f infra/compose.onprem.yml logs api` | Check for start-up errors |
| The log repeats `[entrypoint] DB not ready or migration failed (attempt N)` | The text after `attempt N`, `DATABASE_URL`, `pg_hba.conf`, the firewall | The API tries 30 times, 2 seconds apart, then stops. Fix the cause the message names, then `docker compose -f infra/compose.onprem.yml up -d api` |
| The message above says `self-signed certificate`, `unable to verify the first certificate` or `unable to get local issuer certificate` | The end of `DATABASE_URL` | `sslmode=require` checks the server certificate completely. Use `sslmode=disable` for a PostgreSQL on the same server. When your company's authority signed the certificate, keep `require` and make the API trust the authority (see [Certificates from an internal authority](configuration.md#optional-certificates-from-an-internal-authority)). Otherwise use `sslmode=no-verify` for an encrypted connection without the check. See [Configuration](configuration.md#required-database) |
| The message above says `The server does not support SSL connections` | The end of `DATABASE_URL` | Use `sslmode=disable`, or enable TLS on PostgreSQL |
| `curl: (6) Could not resolve host` | The name in the address | The server resolves the name through DNS or `/etc/hosts`. Add the record, or a line `127.0.0.1 <name>` (your name in place of `<name>`) to `/etc/hosts` for the checks run on the server |
| `[DB] pool budget exceeded` in the API log | `API_WORKERS`, `DB_POOL_MAX`, PostgreSQL `max_connections` | Lower `DB_POOL_MAX` to the value the message gives (or `API_WORKERS`), or raise `max_connections` |
| "Database connection failed" | Verify `DATABASE_URL` | Check PostgreSQL accessibility/credentials. A password with `@ : / # ? %` needs percent-encoding in the URL |
| Uploads or downloads fail ("S3 error", `S3_BUCKET is not configured`) | The `S3_*` variables | Ensure the bucket exists, the keys and the permissions are right |
| `Authorization header malformed` or `unexpected scope` in a storage error | `S3_REGION` | Use the region your store expects (`us-east-1` for RustFS, the one set in its configuration for Garage) |
| `getaddrinfo ENOTFOUND <bucket>.host.docker.internal` | `S3_FORCE_PATH_STYLE` | Set `S3_FORCE_PATH_STYLE=true` for RustFS, MinIO, Garage and other self-hosted stores |
| `PutObject fallback used` warning | The storage encryption | The store refused the encryption request. With RustFS, set `RUSTFS_SSE_S3_MASTER_KEY` in `/etc/default/rustfs` and restart it (`sudo systemctl restart rustfs`) |
| `[RATE-LIMIT] ... RATE_LIMIT_TRUST_PROXY not set` warning | `.env` | Set `RATE_LIMIT_TRUST_PROXY=true` (nginx in front) or `false` (nothing in front), then `up -d api`. See [Configuration](configuration.md#optional-advanced) |
| Everyone shares one sign-in limit (`429` for many users) | `RATE_LIMIT_TRUST_PROXY` and the proxy | With a proxy in front, set `true` and make the proxy send `X-Forwarded-For` |
| `[SECURITY]` warning at each start | `ADMIN_PASSWORD`, `JWT_SECRET` | Change the administrator's password in the application, or see [Password Reset](#password-reset). Use a `JWT_SECRET` of 32 characters or more |
| Migration failed | PostgreSQL version | Must be 16+, extensions available |
| 502 from reverse proxy | `docker compose -f infra/compose.onprem.yml ps` | Ensure the api container is running on port 8080 |
| 413 from the reverse proxy on an upload | `client_max_body_size` | Set `client_max_body_size 50m;` in the nginx file |
| A reset email does not arrive, and the API log has an `ERROR` line with `unable to verify the first certificate` or `self-signed certificate` and the code `ESOCKET` | The certificate of the mail relay | The API does not trust the authority that signed the relay's certificate. Give it the authority's file (see [Certificates from an internal authority](configuration.md#optional-certificates-from-an-internal-authority)). Installing the authority on the server itself does not change the container |
| Can't sign in | The password | `.env` creates the administrator at the first start only. Change the password in the application, or use [Password Reset](#password-reset) |

## Password Reset

**Recommended:** Configure email (Resend API or single-tenant SMTP) and use **Forgot password** on the sign-in page.

**Fallback (SQL):** If email is not configured, reset the password directly in the database. It takes two steps: hash the new password in the API container, then write the hash as the PostgreSQL superuser. The application role cannot do the second step: row-level security hides every user from it when no workspace is selected.

Set the email of the account in the first line, then type the new password at the prompt (nothing shows as you type):

```bash
cd /opt/kanap
USER_EMAIL=admin@example.internal   # the account to reset
read -rsp 'New password: ' NEW_PASSWORD; echo
HASH=$(docker compose -f infra/compose.onprem.yml exec -T api node -e "require('argon2').hash(process.argv[1]).then(console.log)" "$NEW_PASSWORD" </dev/null)
unset NEW_PASSWORD
sudo -u postgres psql -d kanap -v hash="$HASH" -v email="${USER_EMAIL}" <<'SQL'
UPDATE users SET password_hash = :'hash' WHERE lower(email) = lower(:'email');
SQL
```

`psql` answers `UPDATE 1`. `UPDATE 0` means no account has that email. The password is briefly visible in the process list of the server while the `HASH=` line runs: sign in, then change it from your profile.

This SQL method is a last-resort fallback for locked-out administrators.
