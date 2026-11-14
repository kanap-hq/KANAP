# On-premise operations

The commands on this page run on the Kadratis server, in `/opt/kanap` unless stated otherwise. Several of them use two shell variables. Set them once in your terminal session, with your values:

```bash
KANAP_HOST=kanap.example.internal    # the name users type to open Kadratis, without https://
ADMIN_EMAIL=admin@example.internal   # the email of an administrator account
```

The `curl` commands on this page use `-k`. They check what Kadratis answers, so they also accept a certificate the server does not trust (self-signed, or from an internal authority that is not installed on the server).

## Upgrade procedure

Kadratis publishes a new version about once a month. The `stable` branch always points to the latest published version. Every version has an entry in `CHANGELOG.md` at the root of the repository. An entry that needs something from you (a setting to change, a step to run) has "Action required" in its title.

**1. Read the changelog before you pull.** Fetch the new state of `stable` with the version tags, and show only the entries you do not have yet. Read the entries marked "Action required" first, and do what they say. The same entries are on the GitHub releases page of the repository.

```bash
cd /opt/kanap
git fetch --tags origin stable
git diff HEAD origin/stable -- CHANGELOG.md
```

Keep `--tags`. A `git fetch` or `git pull` that names a branch does not bring the version tags. Without them, `git describe --tags` prints an older version followed by a commit count (for example `v26.10.8-254-gcec464031`), and `git checkout v<version>` does not find the newer versions. The same command brings the missing tags to an installation that upgraded without it.

**2. Back up the database, the files and the configuration.** Run the commands of [Before an upgrade](#before-an-upgrade). They write to a directory of their own, which the daily backup never touches. Migrations only go forward: this backup is the way back.

**3. Pull and start.**

```bash
cd /opt/kanap
git checkout stable
git pull origin stable
docker compose -f infra/compose.onprem.yml pull
docker compose -f infra/compose.onprem.yml up -d
# The old API container first finishes the requests in progress, the emails it queued and
# its running background jobs (up to 20 s), then stops. Migrations run when the new one starts.
```

`infra/compose.onprem.yml` names the images of the version you checked out. `pull` downloads them from `ghcr.io`, and `up -d` recreates the containers on them. If you build the images yourself (see [Build the images yourself](installation.md#build-the-images-yourself)), run the `build` and `up -d` commands of that section instead of `pull` and `up -d`. From this version on, the images are named `kadratis-*`. The usual upgrade downloads them: there is nothing else to do. Earlier versions keep their `kanap-*` images.

**First upgrade to a version with published images.** Versions up to 26.10.7 were built on the server. The procedure above is all you need to move to a later version. Once the new version runs and passes the checks of step 4, free the build cache and the old images. On a server that built Kadratis, they often take 20 GB or more, depending on how many builds it made. Add `kanap-api-tools` to the second line if you built the maintenance tools image.

```bash
docker builder prune -a
docker image rm infra-api infra-web
docker image prune
```

`docker builder prune -a` and `docker image prune` each ask for a confirmation: answer `y`. Without `-a`, `docker builder prune` leaves part of the build cache. Keep this order: `docker image rm` alone frees almost nothing, and the space comes back with `docker image prune`. The total that Docker prints is higher than what the disk gains, because images share layers: compare `df -h /` before and after. `docker image rm` removes only the `latest` tag: if `docker images "infra-*"` lists other tags, remove each one.

From that version on, upgrades need outbound access to `ghcr.io` instead of `registry.npmjs.org` and the Alpine package mirrors (see [Firewall rules](configuration.md#outbound-installation-and-upgrades)).

**Coming from a checkout of `main` before 26.10.1.** An installation set up before the first version follows `main`. To move it to the published versions:

1. Back up as in step 2.
2. Fetch and switch to the branch of the published versions. `git checkout stable` moves forward from any commit of `main`.

    ```bash
    cd /opt/kanap
    git fetch origin
    git diff HEAD origin/stable -- CHANGELOG.md
    git checkout stable
    ```

3. Read every changelog entry the `git diff` shows, and do what the "Action required" lines say. Check in particular, in `.env`: `DEPLOYMENT_MODE` is `single-tenant` (an unrecognised value stops the API at start, see [Deployment mode](configuration.md#required-deployment-mode)), and `APP_BASE_URL` is set (see [Upgrading an installation from before version 26.10.1](configuration.md#upgrading-an-installation-from-before-version-26101)). In the nginx of the server, check `client_max_body_size 80m` (see the [reverse proxy example](installation.md#reverse-proxy-example-nginx)).
4. Run `docker compose -f infra/compose.onprem.yml pull`, then `docker compose -f infra/compose.onprem.yml up -d`. The migrations of every version in between run at the first start. The one that turns the operating systems of servers into technologies takes longer with more servers: the API shows `starting` until it ends.
5. Check the upgrade as in step 4, smoke test included, then free the build cache as above.

For a jump over several versions, try it first on a copy of the database.

**A precise version.** To run a published version other than the latest, fetch the tags and check one out. The checkout is detached. The `git checkout stable` of step 3 brings it back to the branch at the next upgrade.

```bash
cd /opt/kanap
git fetch --tags
git checkout v26.10.9
docker compose -f infra/compose.onprem.yml pull
docker compose -f infra/compose.onprem.yml up -d
```

**Following `main`.** The `main` branch holds every merged change before it is published as a version. Following it is possible, with images you build yourself (see [Build the images yourself](installation.md#build-the-images-yourself)); the published versions are the recommended path.

**Which version runs.**

```bash
cd /opt/kanap
git describe --tags
docker compose -f infra/compose.onprem.yml images
curl -sSk -w '\n' "https://${KANAP_HOST}/api/config/public"
```

The first command prints the version of the checkout. The second one lists the images of the containers, with their version in the `TAG` column. The third one answers with a JSON document whose `version` field is the version the API reports.

The published images carry a signed record of how they were built: from the version's tag, by the Kadratis repository's own workflow. With the GitHub CLI, `gh attestation verify oci://ghcr.io/kanap-hq/kadratis-api:<version> -R kanap-hq/KANAP` checks it.

**4. Check the upgrade.**

```bash
cd /opt/kanap
docker compose -f infra/compose.onprem.yml ps
docker compose -f infra/compose.onprem.yml logs --no-log-prefix api | grep -E '^\[(entrypoint|VERSION|ENV|CONFIG|SECRETS|RATE-LIMIT|CORS|DB|on-prem|SECURITY|DATA-ACCESS|markdown|cluster|shutdown)\]|WARN|ERROR|successfully started|Email transport'
curl -sSk -w '\n' "https://${KANAP_HOST}/api/health"
```

- `ps` shows `api` and `web` as `healthy` after about a minute.
- The API log shows the migrations (`[entrypoint] Migrations complete (N executed).`), the version (`[VERSION] Kadratis <version>`) and then the start of the API (`Nest application successfully started`). Read the other start-up lines too: [Configuration](configuration.md#what-the-api-log-shows-at-start) explains each one. The filter keeps about 20 lines per start. The log covers every start of the container since the upgrade, so after a restart the same lines appear once more.
- The health address answers `{"status":"ok","text_processing":"ready"}` (see [Monitoring](#monitoring)).

**Data-scoped access.** After an upgrade to a version with [data access](../data-access.md), everyone keeps working with all data. To limit people to part of the budget and the contracts, run the optional step of [Data-scoped access](installation.md#optional-data-scoped-access) once, then restart the API. The step is done once per PostgreSQL server: later upgrades need nothing more, because the API sets the permissions of the role at each start.

Then run the smoke test. It checks the database, the sign-in, the main lists and the exports through the public API. The server has no Node.js, so it runs in a container. The first run on a server downloads the `node:24-alpine` image from Docker Hub (about 65 MB, about 240 MB on disk) and keeps it: run the test once while outbound access is open (see [Firewall rules](configuration.md#outbound-installation-and-upgrades)). At the prompt, type the current password of the `ADMIN_EMAIL` account; nothing shows as you type. The `ADMIN_PASSWORD` of `.env` is read at the first start only, so it may no longer be the right one. Keep `-e KANAP_INSECURE_TLS=1` when the certificate is self-signed (the container does not trust it); remove it with a certificate from a public authority. With a certificate from your internal authority, keep it, or replace it with `-v /opt/kanap/infra/certs:/certs:ro -e NODE_EXTRA_CA_CERTS=/certs/company-ca.pem` to let the container check the certificate against the authority's file in `/opt/kanap/infra/certs/` (see [Certificates from an internal authority](configuration.md#optional-certificates-from-an-internal-authority)). Do not add `-e KANAP_WRITE=1` on a production installation: that option creates a temporary task with an attachment to check the storage, which suits a new installation only.

```bash
read -rsp 'Administrator password: ' KANAP_PASSWORD; echo; export KANAP_PASSWORD
docker run --rm --network host \
  -e KANAP_URL="https://${KANAP_HOST}" -e KANAP_EMAIL="${ADMIN_EMAIL}" -e KANAP_PASSWORD \
  -e KANAP_INSECURE_TLS=1 \
  -v /opt/kanap/scripts/smoke:/smoke:ro node:24-alpine node /smoke/recette.mjs
unset KANAP_PASSWORD
```

The last line of the output reads `0 failed`. With `KANAP_INSECURE_TLS=1`, two TLS warnings at the top of the output are expected: the script's own and the Node.js warning about `NODE_TLS_REJECT_UNAUTHORIZED`.

**Remove the images of older versions.** Each upgrade downloads new images and leaves those of the earlier versions on the disk, about 1.4 GB per version (2.8 GB with the maintenance tools image). Keep the images of the version you just left for as long as you may roll back to it. Remove the older ones. List the images and the space they take:

```bash
docker images "ghcr.io/kanap-hq/*"
```

The list shows the `kadratis-*` images and, from versions up to 26.11.3, the `kanap-*` images. Set `OLD` to a version to remove, then remove its images:

```bash
OLD=26.10.8   # a version older than the one you may roll back to
docker image rm $(docker images --format '{{.Repository}}:{{.Tag}}' "ghcr.io/kanap-hq/*" | grep ":${OLD}$")
```

Repeat for each older version. Docker refuses to remove an image that a container uses, so the version in service stays. A rollback to a version whose images you removed downloads them again (step 2 of the rollback below).

**Rollback.** Migrations only go forward, so a rollback puts back the backup taken before the upgrade, under the previous version:

1. Stop Kadratis: `cd /opt/kanap`, then `docker compose -f infra/compose.onprem.yml down`. A rollback often starts in a new terminal, outside `/opt/kanap`.
2. Check out the previous version and download its images. This needs the outbound access of an upgrade: if you closed it after the upgrade, open it first (see [Firewall rules](configuration.md#outbound-installation-and-upgrades)). Run `git checkout v<previous version>` (for example `git checkout v26.10.9`), then `docker compose -f infra/compose.onprem.yml pull`. A version up to 26.10.7 has no published images: build it as the guide of that version explains.
3. Restore the database and the files from the `before-upgrade-...` directory of that upgrade: choose the backup, then run steps 1 to 3 of [Restore](#restore) in the same terminal. If you changed `.env` for the new version, compare it with the copy in the `config` directory of the backup. This command compares the setting names of the two files without printing their values:

    ```bash
    diff <(cut -d= -f1 /opt/kanap/.env | sort) <(sudo cut -d= -f1 "$BACKUP/config/.env" | sort)
    ```

    It lists only the names that differ. To compare the values, open both files.
4. Start Kadratis: `docker compose -f infra/compose.onprem.yml up -d --wait`.
5. Check it as in step 4 above (**Check the upgrade**). Its commands use `KANAP_HOST` and `ADMIN_EMAIL` from the top of this page: in a new terminal, set them first. The restored database holds the accounts and passwords of the backup time: a password changed since then is back to its former value, so the smoke test needs the password that was valid when the backup was taken.

Check out the previous version before you start Kadratis: a start with the newer version would run its migrations on the restored database again.

After a rollback, stay on the tag of the version you rolled back to. The `git checkout stable` of the upgrade procedure (its step 3) brings the checkout back to the branch at the next upgrade. The checkout (`git describe --tags`) and the running API (`/api/config/public`, see [Which version runs](#upgrade-procedure)) must show the same version. If they differ, the next `pull` and `up -d` change the running version.

## Version support

Kadratis is a quickly evolving solution. Versions are published about once a month, and we recommend upgrading at least monthly.
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

**Files.** The `rc` tool of the installation example copies the bucket to a directory. It uses the `kanapstore` alias that the installation defined in root's configuration. The copy mirrors the bucket: files deleted in Kadratis disappear from it at the next run. The copy is made through the storage's S3 interface, so it holds the files in the clear. Protect the directory accordingly.

```bash
sudo rc mirror --overwrite --remove kanapstore/kanap-files /var/backups/kanap/files
```

For any other S3 store, `rclone` does the same job (`sudo apt-get install -y rclone`). Replace the example values with those of your store. `sudo` passes on only the variables that `KEEP` names, and it writes their values to the system log. The two keys are therefore typed inside the `sudo` shell, at the prompts (the `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` of `.env`). `rclone check` then compares the copy with the bucket:

```bash
export RCLONE_S3_PROVIDER=Other
export RCLONE_S3_ENDPOINT='https://s3.example.com'   # S3_ENDPOINT of .env, as the server reaches it
export RCLONE_S3_REGION='us-east-1'                   # S3_REGION of .env
export RCLONE_S3_FORCE_PATH_STYLE=true                # S3_FORCE_PATH_STYLE of .env
export BUCKET=kanap-files                             # S3_BUCKET of .env
export DEST=/var/backups/kanap/files
KEEP=RCLONE_S3_PROVIDER,RCLONE_S3_ENDPOINT,RCLONE_S3_REGION,RCLONE_S3_FORCE_PATH_STYLE,BUCKET,DEST
sudo --preserve-env="$KEEP" bash -c '
  read -rp "Access key: " RCLONE_S3_ACCESS_KEY_ID
  read -rsp "Secret key: " RCLONE_S3_SECRET_ACCESS_KEY; echo
  export RCLONE_S3_ACCESS_KEY_ID RCLONE_S3_SECRET_ACCESS_KEY
  rclone sync ":s3:${BUCKET}" "$DEST" && rclone check ":s3:${BUCKET}" "$DEST"'
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

**Copy the backup off the server.** A backup on the same disk does not survive the loss of the server. The [nightly encrypted backup](#nightly-encrypted-backup-to-an-s3-bucket) below sends the database, the files and the configuration to an S3 bucket every night. With another tool, copy `/var/backups/kanap` to another machine every day, for example with `rsync -a /var/backups/kanap/ <user>@<backup host>:<directory>/` from a scheduled job. The copy holds secrets and personal data: protect its destination.

**Test a restore every few months**, on a spare server, so that you know the backups work before you need them.

### Nightly encrypted backup to an S3 bucket

The script `infra/backup/kadratis-backup` runs every night and stores three objects in a folder named after the date and time (UTC): `database.dump.age` (the database, as `pg_dump -Fc` writes it), `attachments.tar.age` (every file of the storage) and `config.tar.age` (the configuration files). `age` encrypts them for your public key before they leave the server. With the write user described below, the server uploads and lists, and cannot read or delete what it stored. Each night uploads every file of the storage again.

**Prepare the bucket.** Use an S3 service at another provider than the one that hosts your server:

- A bucket for this backup only, with versioning and object lock turned on, in compliance mode, with a default retention of the number of days you want to keep (30, for example). In compliance mode nobody can delete an object or shorten its retention before its date, the bucket owner included.
- A lifecycle rule that deletes the objects and their older versions once the retention has ended (for example after 31 days).
- A write user for the server, limited to this bucket, with these actions only: `s3:PutObject`, `s3:ListBucket` and `s3:AbortMultipartUpload`. `s3:PutObject` also covers the uploads in several parts, which large objects use.
- A read user for restores, limited to this bucket: `s3:GetObject`, `s3:GetObjectVersion`, `s3:GetObjectRetention`, `s3:ListBucket` and `s3:ListBucketVersions`.

Note the endpoint (with `https://`), the region and the name of the bucket. Only the keys of the write user go on the server. The keys of the bucket owner and of the read user stay off it.

**Create the encryption key** on another machine than the server, with `age` installed:

```bash
age-keygen -o kadratis-backup-key.txt
```

It prints `Public key: age1...`: the server needs this public key. The file holds the private key. It stays off the server, except during a [restore](#restore), and leaves it afterwards. Without it, no backup can be read: keep two copies in separate safe places. `age-keygen -y kadratis-backup-key.txt` prints the public key again.

**Install the script** on the server:

```bash
sudo apt-get install -y rclone age
cd /opt/kanap
sudo install -m 0755 -o root -g root infra/backup/kadratis-backup /usr/local/sbin/kadratis-backup
sudo install -m 0644 -o root -g root infra/backup/kadratis-backup.service infra/backup/kadratis-backup.timer /etc/systemd/system/
sudo install -m 0600 -o root -g root infra/backup/kadratis-backup.env.example /etc/kadratis-backup.env
sudo nano /etc/kadratis-backup.env
sudo systemctl daemon-reload
```

Each setting of `/etc/kadratis-backup.env` has a comment. For the [installation example](installation-example.md):

- `BACKUP_AGE_RECIPIENTS`: the public key `age1...`.
- `BACKUP_S3_ENDPOINT`, `BACKUP_S3_REGION` and `BACKUP_S3_BUCKET`: those of the bucket. `BACKUP_S3_ACCESS_KEY_ID` and `BACKUP_S3_SECRET_ACCESS_KEY`: the keys of the write user. `BACKUP_S3_PREFIX` names the folder in the bucket (`kadratis` by default).
- `BACKUP_DB_NAME=kanap`.
- `ATTACHMENTS_S3_ENDPOINT=http://172.17.0.1:9000`. `ATTACHMENTS_S3_REGION`, `ATTACHMENTS_S3_BUCKET`, `ATTACHMENTS_S3_ACCESS_KEY_ID` and `ATTACHMENTS_S3_SECRET_ACCESS_KEY`: the `S3_REGION`, `S3_BUCKET`, `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` of `/opt/kanap/.env`.
- `BACKUP_CONFIG_FILES` lists `/opt/kanap/.env` and `/etc/default/rustfs`. Add the nginx site file and the certificate files, separated by spaces, to keep them too.

The last part of the file checks the server backups of Hetzner Cloud: leave it empty unless your server runs there with its backups turned on. The script refuses to run when other users can read the file, when it holds a private key (`AGE-SECRET-KEY-...`) or a setting it does not know.

**After an upgrade**, check that the installed copies match the new version:

```bash
cd /opt/kanap
cmp infra/backup/kadratis-backup /usr/local/sbin/kadratis-backup
cmp infra/backup/kadratis-backup.service /etc/systemd/system/kadratis-backup.service
cmp infra/backup/kadratis-backup.timer /etc/systemd/system/kadratis-backup.timer
```

No output means they match. A line such as `... differ: byte 1201, line 40` names a file the upgrade changed: run its `install` line again, then `sudo systemctl daemon-reload`. The changelog names any new setting.

**Run the first night by hand.** The first command returns when the night is over:

```bash
sudo systemctl start kadratis-backup.service
sudo journalctl -u kadratis-backup.service -o cat --since -10min
```

The journal shows the steps, then `stored and listed`:

```
kadratis-backup: backup 2026-11-14T092950Z started
kadratis-backup: database: 2.4MB encrypted in 0 s
kadratis-backup: attachments: 303 files, 301MB copied, 301MB encrypted in 2 s
kadratis-backup: configuration: 2 paths, 11KB encrypted
kadratis-backup: upload: 3 objects in 26 s
kadratis-backup: backup 2026-11-14T092950Z stored and listed in 28 s
```

Two `pam_unix` lines about the `postgres` user come with the database step: they are normal.

**Turn on the timer.**

```bash
sudo systemctl enable --now kadratis-backup.timer
systemctl list-timers kadratis-backup.timer
```

The list shows the next run. The backup starts every night at 02:00 server time, plus up to 20 minutes. A night missed while the server was off runs when it starts again.

**Monitoring (optional).** Set `BACKUP_SUCCESS_URL` to the address of a monitoring service that alerts when an expected call does not come. The script calls it once the night is stored and listed. A failed night calls nothing.

**Check the backup from another machine**, the one that holds the private key, with `rclone` and `age` installed. Set the read keys once per terminal: the values are those of your bucket, and the keys of the read user are typed at the prompts.

```bash
export RCLONE_CONFIG=/dev/null
export RCLONE_CONFIG_BACKUP_TYPE=s3 RCLONE_CONFIG_BACKUP_PROVIDER=Other
export RCLONE_CONFIG_BACKUP_ENDPOINT='https://s3.example.com'   # BACKUP_S3_ENDPOINT
export RCLONE_CONFIG_BACKUP_REGION='us-east-1'                  # BACKUP_S3_REGION
export RCLONE_CONFIG_BACKUP_FORCE_PATH_STYLE=true
BUCKET=example-backup-bucket                                    # BACKUP_S3_BUCKET
PREFIX=kadratis                                                 # BACKUP_S3_PREFIX
read -rp 'Read access key: ' RCLONE_CONFIG_BACKUP_ACCESS_KEY_ID
read -rsp 'Read secret key: ' RCLONE_CONFIG_BACKUP_SECRET_ACCESS_KEY; echo
export RCLONE_CONFIG_BACKUP_ACCESS_KEY_ID RCLONE_CONFIG_BACKUP_SECRET_ACCESS_KEY
rclone lsf --dirs-only "backup:$BUCKET/$PREFIX/"
```

The last command lists one folder per night. Choose one, then list its three objects, show their lock and decrypt the start of the database:

```bash
NIGHT=2026-11-14T092950Z   # a folder of the list, without the final /
rclone lsf --format sp "backup:$BUCKET/$PREFIX/$NIGHT/"
for f in database.dump.age attachments.tar.age config.tar.age; do
  printf 'user = "%s:%s"\n' "$RCLONE_CONFIG_BACKUP_ACCESS_KEY_ID" "$RCLONE_CONFIG_BACKUP_SECRET_ACCESS_KEY" \
    | curl -sS -K - -I --aws-sigv4 "aws:amz:${RCLONE_CONFIG_BACKUP_REGION}:s3" \
      "${RCLONE_CONFIG_BACKUP_ENDPOINT}/${BUCKET}/${PREFIX}/${NIGHT}/${f}" | grep -i '^x-amz-object-lock'
done
rclone cat "backup:$BUCKET/$PREFIX/$NIGHT/database.dump.age" | age -d -i kadratis-backup-key.txt | head -c 5; echo
```

The list shows the size and name of the three objects. Each object shows `x-amz-object-lock-mode: COMPLIANCE` and the date until which it is locked. The last line prints `PGDMP`, the start of a database dump.

**Limits.**

- Volume: each night uploads every file of the storage. The bucket holds one full copy per day of retention. During the night, the server needs free space for twice the size of the files, and the upload time grows with that size.
- The script keeps a copy of the files in `/var/backups/kanap/files`, in the clear, like the files copy of the local backup. Only `root` can read it.
- A failed night ends with exit code 1, the line `backup FAILED during step '...'` in the journal, `failed` in `systemctl status kadratis-backup.service`, and no call to `BACKUP_SUCCESS_URL`.

### Before an upgrade

Before each upgrade, take a full backup into a dated directory of its own, for example `/var/backups/kanap/before-upgrade-20261009-1400/`. It holds `db.dump`, `files/` and `config/`. The daily backup writes other names, so it never overwrites this one. On a server where `/var/backups/kanap` does not exist yet, [prepare the backup directory](#backup-and-restore) first.

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

The last line prints the directory. Note it: a rollback restores from it. With another S3 store, replace the `rc mirror` line with the `rclone` block of the files backup above, run in the same terminal after the other lines, with `export DEST="$B/files"` in place of its `DEST` line.

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

To restore a night of the [encrypted backup](#nightly-encrypted-backup-to-an-s3-bucket), download and decrypt it on the server. On a new server, install `rclone` and `age` first (`sudo apt-get install -y rclone age`). Copy the private key file to your home directory on the server (with `scp`, for example). Set the read keys with the first block of [Check the backup from another machine](#nightly-encrypted-backup-to-an-s3-bucket), in this terminal. Then:

```bash
NIGHT=2026-11-14T092950Z   # the folder of the night to restore
rclone copy "backup:$BUCKET/$PREFIX/$NIGHT/" ~/kadratis-night/
BACKUP=/var/backups/kanap-restore-$NIGHT
sudo install -d -o postgres -g postgres -m 0700 "$BACKUP"
sudo install -d -m 0700 "$BACKUP/files" "$BACKUP/config"
sudo age -d -i ~/kadratis-backup-key.txt -o "$BACKUP/db.dump" ~/kadratis-night/database.dump.age
age -d -i ~/kadratis-backup-key.txt ~/kadratis-night/attachments.tar.age | sudo tar -xf - -C "$BACKUP/files"
age -d -i ~/kadratis-backup-key.txt ~/kadratis-night/config.tar.age | sudo tar -xf - -C "$BACKUP/config"
DUMP="$BACKUP/db.dump"
FILES="$BACKUP/files"
```

`$BACKUP/config` holds the configuration files under their full path (`opt/kanap/.env`, `etc/default/rustfs`). On a new server, copy them to their place before you install Kadratis. Once Kadratis runs again, remove the key and the downloaded objects from the server (`shred -u ~/kadratis-backup-key.txt` and `rm -r ~/kadratis-night`), then close the terminal: the read keys go with it. Delete `$BACKUP` when you no longer need it.

The write keys can upload a new object under an existing name, and versioning keeps the earlier one. If a night does not decrypt, list the versions of its objects, then download the night as it was at a given time (UTC, after the night and before the replacement), in place of the `rclone copy` line above:

```bash
rclone lsf --s3-versions --format tsp "backup:$BUCKET/$PREFIX/$NIGHT/"
rclone copy --s3-version-at 2026-11-14T09:46:22Z "backup:$BUCKET/$PREFIX/$NIGHT/" ~/kadratis-night/
```

Download the folder with `rclone copy`: `rclone copyto --s3-version-at` on a single object copies nothing and reports no error.

**1. Restore the database.** This block stops Kadratis, recreates the database owned by the application role and restores the dump. It runs nothing unless the dump file exists and `pg_restore` can read it:

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

**Data-scoped access.** When the server uses [data-scoped access](installation.md#optional-data-scoped-access), its role `kanap_data_limited` must exist before the restore too. On a new server, run the script of that section after creating the `kanap` role, with `-d postgres` since the `kanap` database does not exist yet. A restore on a server without that role brings back neither the access rules nor the permissions of the role, and `pg_restore` reports errors for them. A dump made with `pg_dump --no-privileges` also leaves the permissions out. In both cases limited people are refused until you run the script again and restart the API.

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

**4. Start Kadratis.**

```bash
cd /opt/kanap
docker compose -f infra/compose.onprem.yml up -d --wait
```

Then run the smoke test of [Check the upgrade](#upgrade-procedure) and open Kadratis in a browser. Accounts and passwords are those of the backup time: sign in with the password that was valid then.

## Maintenance tools image

The API image holds the compiled application only. A maintenance command that needs TypeScript, such as `npm run typeorm`, runs in a second image of the same version, `kadratis-api-tools`. The `tools` service of `infra/compose.onprem.yml` uses it, with the same `.env`, the same access to `host.docker.internal` and the same certificate directory as the API (see [Certificates from an internal authority](configuration.md#optional-certificates-from-an-internal-authority)). `up` never starts it. The first `run` downloads the image. This example lists the migrations and whether they are applied:

```bash
cd /opt/kanap
docker compose -f infra/compose.onprem.yml run --rm tools npm run typeorm -- migration:show
```

It takes about half a minute before the list appears: the command first compiles the TypeScript sources.

## PostgreSQL settings

PostgreSQL's defaults are sized for a small machine. `infra/postgres/kanap-pg-tune.sh` prints settings sized from your server's memory (memory, SSD costs, slow statement log, statement statistics). Run it on the PostgreSQL server and read the file before applying it: its header explains each value. The installation example applies it in [step 4](installation-example.md#size-postgresql-for-this-server).

```bash
cd /opt/kanap
PGVER=18   # 16 on Ubuntu 24.04
# The libraries PostgreSQL already preloads (often none): the script keeps them.
CURRENT=$(sudo -u postgres psql -XAtc 'SHOW shared_preload_libraries')
# PostgreSQL on the same server as Kadratis (add --dedicated if it has the server to itself)
sh infra/postgres/kanap-pg-tune.sh --preload "$CURRENT" | sudo tee /etc/postgresql/${PGVER}/main/conf.d/kanap.conf >/dev/null
sudo systemctl restart postgresql
sudo -u postgres psql -d kanap -c 'CREATE EXTENSION IF NOT EXISTS pg_stat_statements'
```

When the database already has the extension, as after the installation example, the last command prints `NOTICE:  extension "pg_stat_statements" already exists, skipping`. That is expected.

Two checks before the restart, both done by the script, which writes the `shared_preload_libraries` line commented out when one fails:

- **The list of preloaded libraries.** `shared_preload_libraries` is one list, and the value in `kanap.conf` replaces the one in `postgresql.conf`. Without `--preload`, add the value of `SHOW shared_preload_libraries` in front yourself (for example `'pg_cron,pg_stat_statements'`), then remove the `#`.
- **The library itself.** PostgreSQL does not start when a preloaded library is missing. It ships with PostgreSQL on Debian and Ubuntu; on RHEL and derivatives, install the contrib package (`postgresql16-contrib`). Check with `ls "$(pg_config --pkglibdir)/pg_stat_statements.so"`.

The restart is needed once, for the memory setting and the statement statistics: plan it in a maintenance window, Kadratis cannot reach its database while PostgreSQL restarts. Statements slower than 500 ms then appear in the PostgreSQL log, without their parameters (`log_parameter_max_length = 0`: they can hold personal data). `pg_stat_statements` lists the costliest statements:

```sql
SELECT calls, round(mean_exec_time) AS avg_ms, left(query, 80) AS query
FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 10;
```

Kadratis's migrations also make autovacuum start earlier on the two largest tables (budget amounts). That needs no restart and no memory.

## Monitoring

**Health.** The API answers `GET /health` on its own port and `GET /api/health` through the reverse proxy. Both return `{"status":"ok","text_processing":"ready"}`:

```bash
curl -sSk -w '\n' http://127.0.0.1:8080/health
curl -sSk -w '\n' "https://${KANAP_HOST}/api/health"
```

`text_processing` reads `starting` for a few seconds after a start. It reads `unavailable` when the API could not start the processing of formatted texts: the API keeps serving, refuses to save formatted texts (descriptions, comments) and tries again every few seconds. The API log gives the reason.

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

- `ps` shows `api` and `web` as `healthy`. During the first 30 seconds or so after the boot, it can still show `health: starting`: run it again.
- The health address answers `{"status":"ok","text_processing":"ready"}`.
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
| The log repeats `[entrypoint] DB not ready (attempt N): ...`, then shows `DB not ready after 30 attempts` | The text after `attempt N`, `DATABASE_URL`, `pg_hba.conf`, the firewall | The API tries 30 times, 2 seconds apart, then stops. Fix the cause the message names, then `docker compose -f infra/compose.onprem.yml up -d api` |
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
| `[entrypoint] No migration ran.` after a message about the PostgreSQL role | The line above it, the role in `DATABASE_URL` | The role is a cluster-admin role, or it has `SUPERUSER` or `BYPASSRLS` and Kadratis could not remove them. Use a dedicated application role, or run the `ALTER ROLE` command the message gives as a PostgreSQL superuser, then `up -d api`. See [Configuration](configuration.md#required-database) |
| `[entrypoint] A migration failed, not retried: ...` | The message, the `[entrypoint] Failed statement: ...` line after it, the PostgreSQL version (16 or later) and its extensions | The pending migrations were rolled back: the database is as before this start. Fix the cause and run `up -d api` again, or deploy the previous version |
| 502 from reverse proxy | `docker compose -f infra/compose.onprem.yml ps` | Ensure the api container is running on port 8080 |
| 413 from the reverse proxy on an upload | `client_max_body_size` | Set `client_max_body_size 80m;` in the nginx file |
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
HASH=$(printf '%s' "$NEW_PASSWORD" | docker compose -f infra/compose.onprem.yml exec -T api node -e "let p='';process.stdin.on('data',d=>p+=d).on('end',()=>require('argon2').hash(p).then(console.log))")
unset NEW_PASSWORD
sudo -u postgres psql -d kanap -v email="${USER_EMAIL}" <<SQL
UPDATE users SET password_hash = '${HASH}' WHERE lower(email) = lower(:'email');
SQL
```

The password and its hash go through the standard input, so neither shows in the process list or in the system log. `psql` answers `UPDATE 1`. `UPDATE 0` means no account has that email.

This SQL method is a last-resort fallback for locked-out administrators.
