# Installation example: Ubuntu 26.04

This guide walks through a complete on-premise installation on a single Ubuntu 26.04 LTS server, using PostgreSQL on the host, RustFS for S3-compatible storage, and nginx as the TLS reverse proxy. Each step gives the commands to paste and what to expect.

Ubuntu 24.04 LTS works with two differences, each noted where it applies: PostgreSQL is version 16 (set `PGVER=16` in step 0) and nginx is version 1.24 (one `sed` command in step 8).

Adapt the example to your environment. The core [Installation](installation.md) and [Configuration](configuration.md) guides remain the reference.

!!! tip "Prefer automation?"
    A coding AI agent can run this entire installation for you from a single prompt. See [AI-assisted installation](installation-ai.md).

## Architecture

```
Browser → nginx (:443, TLS) → Docker containers (api :8080, web :8081)
                             → PostgreSQL (:5432, on host)
                             → RustFS (172.17.0.1:9000, on host)
```

All services run on a single server. Containers reach host services through `host.docker.internal`, which is the Docker bridge address of the server (`172.17.0.1`). PostgreSQL listens on every address of the server, and the firewall and `pg_hba.conf` let only the Docker networks reach it. The storage listens on the Docker bridge address only.

---

## 0. Before you start

You need:

- A fresh Ubuntu 26.04 LTS server with 6 GB of RAM or more (8 GB recommended), 20 GB of disk and outbound internet access. The image build, at installation and at each upgrade, needs that memory.
- A user with `sudo` rights (not `root`). Every command below runs as that user.
- The name users type to open KANAP, for example `kanap.example.internal`. See [Name and certificate](installation.md#name-and-certificate). This example uses an internal name with a self-signed certificate. Step 8 shows the other two cases.
- The email address of the first administrator.
- The name of your organization.

Choose the four values in the first lines, then paste the whole block. Keep the quotes around the organization name: it can contain spaces. The block writes the values, with the secrets it generates, to `~/kanap-install.env`, a file readable by you only. Later steps read that file with `. ~/kanap-install.env`, so each block works in a new terminal session. Nothing prints the secrets.

```bash
PGVER=18                            # 16 on Ubuntu 24.04
KANAP_HOST=kanap.example.internal   # the name users type, without https://
ADMIN_EMAIL=admin@example.internal  # email of the first administrator
ORG_NAME='Example Company'          # name of your organization, set once: the application cannot change it later

install -m 600 /dev/null ~/kanap-install.env
printf 'ORG_NAME=%q\n' "${ORG_NAME}" >> ~/kanap-install.env
cat >> ~/kanap-install.env <<EOF
PGVER=${PGVER}
KANAP_HOST=${KANAP_HOST}
ADMIN_EMAIL=${ADMIN_EMAIL}
PG_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 32)
KANAP_ADMIN_PASSWORD=$(openssl rand -base64 18)
S3_SECRET_KEY=$(openssl rand -hex 32)
RUSTFS_ROOT_USER=rustfsadmin-$(openssl rand -hex 4)
RUSTFS_ROOT_PASSWORD=$(openssl rand -hex 32)
RUSTFS_SSE_S3_MASTER_KEY=$(openssl rand -base64 32)
EOF
```

The database password is hexadecimal (letters and digits), so it needs no encoding in the database URL. A password that contains `@ : / # ? %` must be percent-encoded there.

---

## 1. Docker Engine

Install Docker from the official repository:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg git

sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin
```

Add your user to the `docker` group:

```bash
sudo usermod -aG docker "$USER"
```

Close your session and open a new one so the group applies. Then check that Docker answers without `sudo`:

```bash
docker ps
```

It prints one header line that starts with `CONTAINER ID`, and no container yet.

---

## 2. Firewall

A fresh server accepts every connection. Set up the firewall before you install PostgreSQL and the storage, so that neither is ever open to the network. Close everything except SSH, HTTP and HTTPS, and let only the Docker networks reach PostgreSQL (5432) and the storage (9000). The rules can name ports that nothing listens on yet. **Allow SSH first**, or you lock yourself out when the firewall starts.

```bash
sudo apt-get install -y ufw
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow from 172.16.0.0/12 to any port 5432 proto tcp
sudo ufw allow from 172.16.0.0/12 to any port 9000 proto tcp
sudo ufw --force enable
sudo ufw status
```

The status lists `OpenSSH`, `80/tcp`, `443/tcp`, and the two rules from `172.16.0.0/12`. It also lists `OpenSSH (v6)`, `80/tcp (v6)` and `443/tcp (v6)`: the same three rules for IPv6. If SSH listens on another port, allow that port as well before you enable the firewall.

---

## 3. Get KANAP

Get the files first: the PostgreSQL sizing script of the next step comes with them. The `stable` branch always points to the latest published version.

```bash
sudo install -d -o "$USER" -g "$USER" /opt/kanap
git clone https://github.com/kanap-hq/KANAP.git /opt/kanap
cd /opt/kanap
git checkout stable
```

---

## 4. PostgreSQL

```bash
. ~/kanap-install.env
sudo apt-get install -y postgresql-${PGVER}
pg_lsclusters
```

`pg_lsclusters` shows the cluster `main` of your version, online. The paths below use `/etc/postgresql/${PGVER}/main`.

Create the database, the application role and the required extensions:

```bash
cd /opt/kanap
. ~/kanap-install.env
sudo -u postgres psql <<SQL
CREATE DATABASE kanap;
CREATE USER kanap WITH PASSWORD '${PG_PASSWORD}' NOSUPERUSER NOBYPASSRLS;
GRANT ALL PRIVILEGES ON DATABASE kanap TO kanap;
SQL

sudo -u postgres psql -d kanap <<'SQL'
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
GRANT ALL ON SCHEMA public TO kanap;
SQL
```

The commands print `CREATE DATABASE`, `CREATE ROLE` and `GRANT`, then `CREATE EXTENSION` three times and `GRANT`.

### Allow connections from Docker containers

PostgreSQL must listen beyond `localhost` and accept the application role from the Docker networks. `172.16.0.0/12` covers every network Docker creates by default. The firewall of step 2 keeps the port closed to the rest of the network.

```bash
. ~/kanap-install.env
echo "listen_addresses = '*'" | sudo tee /etc/postgresql/${PGVER}/main/conf.d/kanap-network.conf >/dev/null
echo "host    kanap    kanap    172.16.0.0/12    scram-sha-256" | sudo tee -a /etc/postgresql/${PGVER}/main/pg_hba.conf >/dev/null
sudo systemctl restart postgresql
PGPASSWORD="${PG_PASSWORD}" psql -h 127.0.0.1 -U kanap -d kanap -c "SELECT 1;"
```

The last command must print a table with `1`. To narrow the rule later, use the subnet of the KANAP containers: after the first start, `docker network inspect infra_default` shows it.

### Size PostgreSQL for this server

PostgreSQL's defaults are sized for a small machine. The repository has a script that prints settings sized from this server's memory; it changes nothing by itself. It keeps the libraries PostgreSQL already preloads (it takes their list) and adds the statement statistics library when it finds it on this server. The commands write the result to a drop-in file, restart PostgreSQL and enable the statement statistics:

```bash
cd /opt/kanap
. ~/kanap-install.env
CURRENT=$(sudo -u postgres psql -XAtc 'SHOW shared_preload_libraries')
sh infra/postgres/kanap-pg-tune.sh --preload "$CURRENT" | sudo tee /etc/postgresql/${PGVER}/main/conf.d/kanap.conf >/dev/null
sudo systemctl restart postgresql
sudo -u postgres psql -d kanap -c 'CREATE EXTENSION IF NOT EXISTS pg_stat_statements'
```

The last command prints `CREATE EXTENSION`. To read the settings, show the file (its header explains each value):

```bash
. ~/kanap-install.env
cat /etc/postgresql/${PGVER}/main/conf.d/kanap.conf
```

See [Operations](operations.md#postgresql-settings) for the details.

---

## 5. Object storage (RustFS)

KANAP stores attachments, logos and exports in S3-compatible storage. This example runs RustFS (Apache 2.0) on the same server. Any other S3-compatible store works: skip this step and set the `S3_*` variables of step 6 for your store (see [Configuration](configuration.md#required-storage)).

MinIO no longer publishes new downloads or images, so a new installation uses another store. An installation that already runs MinIO keeps working with KANAP.

The storage listens on the Docker bridge address `172.17.0.1` only, so it is not reachable from the network. The console is switched off.

**Install RustFS and its command-line tool.** The version numbers are in the first two lines: use the latest release listed on the [RustFS releases page](https://github.com/rustfs/rustfs/releases) and on the [RustFS CLI releases page](https://github.com/rustfs/cli/releases). If you change a version, check the file names on its release page. Each download is checked against the `SHA256SUMS` file of its release; the command stops if the check fails.

```bash
RUSTFS_VERSION=1.0.1
RC_VERSION=0.1.36

RUSTFS_TMP="$(mktemp -d)"
cd "$RUSTFS_TMP"
U=https://github.com/rustfs/rustfs/releases/download/${RUSTFS_VERSION}
curl -fsSLO ${U}/SHA256SUMS
curl -fsSLO ${U}/rustfs-linux-x86_64-gnu-v${RUSTFS_VERSION}.deb
sha256sum --check --ignore-missing SHA256SUMS && sudo dpkg -i rustfs-linux-x86_64-gnu-v${RUSTFS_VERSION}.deb

C=https://github.com/rustfs/cli/releases/download/v${RC_VERSION}
curl -fsSLO ${C}/rustfs-cli-linux-amd64-v${RC_VERSION}.tar.gz
curl -fsSL ${C}/SHA256SUMS -o RC_SHA256SUMS
sha256sum --check --ignore-missing RC_SHA256SUMS && tar xzf rustfs-cli-linux-amd64-v${RC_VERSION}.tar.gz rc && sudo install -m 0755 rc /usr/local/bin/rc

cd ~
rm -rf "$RUSTFS_TMP"
```

Each `sha256sum` line must print `OK`. The last two lines remove the downloaded files. The package creates the `rustfs` user, the data directory `/data/rustfs`, the directory `/opt/rustfs` and a systemd service. It also installs a commented `/etc/default/rustfs`, which the next block replaces with a file readable by root only (mode 600). It does not start the service.

**Configure and start the service.**

```bash
. ~/kanap-install.env
sudo install -m 0600 /dev/null /etc/default/rustfs
sudo tee /etc/default/rustfs >/dev/null <<EOF
RUSTFS_ACCESS_KEY=${RUSTFS_ROOT_USER}
RUSTFS_SECRET_KEY=${RUSTFS_ROOT_PASSWORD}
RUSTFS_VOLUMES=/data/rustfs
RUSTFS_ADDRESS=172.17.0.1:9000
RUSTFS_CONSOLE_ENABLE=false
RUSTFS_OBS_LOGGER_LEVEL=warn
RUSTFS_SSE_S3_MASTER_KEY=${RUSTFS_SSE_S3_MASTER_KEY}
EOF

sudo mkdir -p /etc/systemd/system/rustfs.service.d
printf '[Unit]\nAfter=docker.service\n' | sudo tee /etc/systemd/system/rustfs.service.d/override.conf >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable --now rustfs

for i in $(seq 1 30); do ss -ltn | grep -q '172.17.0.1:9000' && break; sleep 1; done
ss -ltn | grep '172.17.0.1:9000'
```

The last line must show `172.17.0.1:9000` listening. The `After=docker.service` drop-in makes the service start once Docker has created the bridge address. If Docker uses another bridge address (`ip -4 addr show docker0`), use that address in `RUSTFS_ADDRESS` and in the firewall rules.

`RUSTFS_SSE_S3_MASTER_KEY` is the key that encrypts the files at rest. KANAP asks for encryption at rest on uploads. Without the key RustFS refuses the request and the API logs a `PutObject fallback used` warning. **Keep this key with your server configuration backup**: files encrypted with it cannot be read without it.

**Create the bucket, a least-privilege policy and the application user.** The application user can read, write and delete objects in `kanap-files` and nothing else. Its access key is `kanap-app`; its secret key is the generated 64-character `S3_SECRET_KEY` (RustFS accepts 8 to 128 characters). No secret appears in the commands that `sudo` records in the system log: the `rc` tool reads the administrator keys from a root-only file, and the application user's secret reaches it through standard input.

```bash
. ~/kanap-install.env
sudo install -d -m 0700 /root/.config/rc
sudo install -m 0600 /dev/null /root/.config/rc/config.toml
sudo tee /root/.config/rc/config.toml >/dev/null <<EOF
schema_version = 1

[[aliases]]
name = "kanapstore"
endpoint = "http://172.17.0.1:9000"
access_key = "${RUSTFS_ROOT_USER}"
secret_key = "${RUSTFS_ROOT_PASSWORD}"
region = "us-east-1"
EOF

sudo rc mb kanapstore/kanap-files
sudo tee /root/kanap-app-policy.json >/dev/null <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": ["s3:ListBucket", "s3:GetBucketLocation"],
      "Resource": ["arn:aws:s3:::kanap-files"] },
    { "Effect": "Allow", "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": ["arn:aws:s3:::kanap-files/*"] }
  ]
}
EOF
sudo rc admin policy create kanapstore kanap-app /root/kanap-app-policy.json
sudo rm /root/kanap-app-policy.json
printf '%s' "${S3_SECRET_KEY}" | sudo sh -c 'rc admin user add kanapstore kanap-app "$(cat)"'
sudo rc admin policy attach kanapstore kanap-app --user kanap-app
sudo rc admin user info kanapstore kanap-app
```

The last command shows `Status: enabled` and the policy `kanap-app`.

To update RustFS later, install the newer `.deb` the same way. When `dpkg` asks about `/etc/default/rustfs`, keep your version.

---

## 6. Configure KANAP

Create the `.env` file. The template lists every setting with its explanation; this example replaces it with a working file for this setup. The file is readable by you only.

```bash
cd /opt/kanap
. ~/kanap-install.env
cp infra/.env.onprem.example .env
chmod 600 .env
cat > .env <<EOF
# DEPLOYMENT MODE
DEPLOYMENT_MODE=single-tenant

# TENANT (set before the first start)
DEFAULT_TENANT_SLUG=default
DEFAULT_TENANT_NAME=${ORG_NAME}

# ADMIN CREDENTIALS (read at the first start only)
ADMIN_EMAIL=${ADMIN_EMAIL}
ADMIN_PASSWORD=ChangeThisAfterFirstLogin!

# SECURITY
JWT_SECRET=${JWT_SECRET}

# RUN MODE: users reach KANAP over HTTPS
APP_ENV=production

# APPLICATION URL AND CORS: the exact address users open
APP_BASE_URL=https://${KANAP_HOST}
CORS_ORIGINS=https://${KANAP_HOST}

# CLIENT ADDRESS: one reverse proxy (nginx) in front of the API
RATE_LIMIT_TRUST_PROXY=true

# DATABASE: host.docker.internal reaches the host from inside Docker
DATABASE_URL=postgres://kanap:${PG_PASSWORD}@host.docker.internal:5432/kanap?sslmode=disable

# STORAGE: RustFS on the host
S3_ENDPOINT=http://host.docker.internal:9000
S3_BUCKET=kanap-files
S3_REGION=us-east-1
AWS_ACCESS_KEY_ID=kanap-app
AWS_SECRET_ACCESS_KEY=${S3_SECRET_KEY}
S3_FORCE_PATH_STYLE=true

# EMAIL (optional: choose one transport to enable invitations, password reset, notifications)
# RESEND_API_KEY=re_xxxxx
# RESEND_FROM_EMAIL=KANAP <noreply@company.com>
# SMTP_HOST=smtp.company.com
# SMTP_PORT=587
# SMTP_SECURE=false
# SMTP_USER=noreply@company.com
# SMTP_PASSWORD=<smtp password>
# SMTP_FROM=KANAP <noreply@company.com>
EOF
```

**Set your own administrator password.** `ADMIN_PASSWORD` must be a value of your own, 12 characters or more. The example value above is published, and an example value or a shorter one makes the API print a `[SECURITY]` warning at each start until the account's password is changed. This command replaces it with the random password generated in step 0 (`openssl rand -base64 18`):

```bash
cd /opt/kanap
. ~/kanap-install.env
sed -i "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=${KANAP_ADMIN_PASSWORD}|" .env
```

The smoke test of step 9 reads it from `.env` without showing it. Step 10 shows it once for your first sign-in.

Notes on the file:

- The administrator account is created at the first start from `ADMIN_EMAIL` and `ADMIN_PASSWORD`. Changing them later changes nothing while an active administrator exists.
- `DEFAULT_TENANT_NAME` is your organization's name, from step 0. KANAP reads it at the first start only, and the application has no page to change it.
- The `DATABASE_URL` password and the `JWT_SECRET` were generated in step 0. Do not reuse example values.
- With `sslmode=disable` the connection to PostgreSQL stays on the server. For another PostgreSQL server, see [`sslmode`](configuration.md#required-database).
- If you reach KANAP by IP address instead of a name, set `APP_BASE_URL` and `CORS_ORIGINS` to `https://<ip address>`.
- For outbound email, remove the `#` of one block and fill in the values. If you use SMTP, make sure the server accepts mail from the `SMTP_FROM` address and that SPF, DKIM and DMARC are in place if messages leave your network.
- For the AI features, add the four `AI_*` variables of [Configuration](configuration.md#optional-ai-features).

---

## 7. Build and start

Build the images and start the containers. The build takes about a minute or two. `--wait` returns when both containers report `healthy`; the first start runs the database migrations and takes a few seconds to a minute.

```bash
cd /opt/kanap
docker compose -f infra/compose.onprem.yml build --pull
docker compose -f infra/compose.onprem.yml up -d --wait
docker compose -f infra/compose.onprem.yml ps
docker compose -f infra/compose.onprem.yml logs --no-log-prefix api | grep -E '^\[|^Admin seeding|WARN|ERROR|successfully started|Email transport'
```

If the build stops with `signal: killed`, the server ran out of memory. `sudo dmesg | grep -i oom` confirms it. Check the free memory with `free -m` and stop the other services that use it. Check that PostgreSQL and the storage still run (`pg_lsclusters`, `systemctl status --no-pager rustfs`). Then restart Docker, which stops what is left of the killed build, build the two images one after the other, which needs less memory, and start KANAP:

```bash
sudo systemctl restart docker
cd /opt/kanap
docker compose -f infra/compose.onprem.yml build --pull api
docker compose -f infra/compose.onprem.yml build --pull web
docker compose -f infra/compose.onprem.yml up -d --wait
```

`ps` shows `api` and `web` as `healthy`. The last command keeps the start-up lines of the API log and leaves out the framework details. On the first start it shows these lines, in this order (the `[SECRETS]` lines are shortened here):

```
[entrypoint] Initializing DB (attempt 1/30) ...
[entrypoint] DB initialized. Running migrations...
[entrypoint] Migrations complete (330 executed).
[ENV] run mode: production
[SECRETS] token families: password-reset=derived-key provisioning=jwt-secret entra-state=derived-key (...)
[SECRETS] Access tokens must carry purpose="access" (legacy untyped access tokens: refused)
[RATE-LIMIT] Client address: taken from X-Forwarded-For behind 1 trusted proxy (RATE_LIMIT_TRUST_PROXY=true)
[CORS] Configured 1 origin pattern(s)
[DB] Connected as PostgreSQL role "kanap" with native RLS enforcement
Admin seeding disabled (set SEED_ADMIN=true to enable)
[on-prem] Default chart of accounts created
[on-prem] Created tenant 'default'
[on-prem] Created administrator account admin@example.internal: the workspace had no active administrator
[on-prem] Created default subscription (On-Prem)
... WARN [EmailService] No outbound email transport configured; email sending is disabled.
... Nest application successfully started
[DB] pool budget: 1 process × 20 connections = 20 of 87 usable (...)
```

The number of migrations depends on the version, and the pool figures on your PostgreSQL.

The block leaves out the migration lines: about 40 lines that start with `[Migration]` or `[migration:` follow `Running migrations...`. They are informational. On a new database some of them report changes to built-in reference data or name a tenant id that is not yours: KANAP keeps a system tenant for platform features. They need no action. `...` stands for the `[Nest]` prefix with the process id and the time. The last line of the filtered output is `[DB] pool budget ...`. Log output saved to a file can contain colour codes such as `[33m`.

Two lines are expected and need no action: `Admin seeding disabled ...` and, until you configure email, the `EmailService` warning. A `[SECURITY]`, `[CONFIG]`, `[CORS]` or `[ENV] APP_ENV is not set` warning means a setting needs attention: [Configuration](configuration.md#what-the-api-log-shows-at-start) explains every line.

---

## 8. nginx and TLS

Install nginx:

```bash
sudo apt-get install -y nginx
```

### The server resolves the name

The checks in the next steps run on this server and call KANAP by its name, so the server must resolve it. With a DNS record this works already. Without one, this command adds the name to the server's hosts file (it does nothing when the name already resolves):

```bash
. ~/kanap-install.env
getent hosts "${KANAP_HOST}" || echo "127.0.0.1 ${KANAP_HOST}" | sudo tee -a /etc/hosts
```

Users' workstations need the DNS record, or for a test a line in their own hosts file that points the name to this server's address.

### TLS certificate

Use one of the three cases of [Name and certificate](installation.md#name-and-certificate). Each one ends by writing the paths of the certificate and the key to `~/kanap-install.env`.

**Self-signed (test only, used in this example).** Every browser shows a warning that each user must accept.

```bash
. ~/kanap-install.env
sudo install -d /etc/ssl/kanap
sudo openssl req -x509 -nodes -days 365 \
  -newkey rsa:2048 \
  -keyout /etc/ssl/kanap/server.key \
  -out /etc/ssl/kanap/server.crt \
  -subj "/CN=${KANAP_HOST}" \
  -addext "subjectAltName=DNS:${KANAP_HOST}"
sudo chmod 600 /etc/ssl/kanap/server.key
printf 'KANAP_CERT=%s\nKANAP_KEY=%s\n' /etc/ssl/kanap/server.crt /etc/ssl/kanap/server.key >> ~/kanap-install.env
```

**Certificate from your internal authority.** Ask for a certificate for the same name. Copy the full chain and the private key to `/etc/ssl/kanap/fullchain.pem` and `/etc/ssl/kanap/privkey.pem` (key mode `600`), then record the paths. Browsers of managed workstations already trust the authority, so users see no warning.

```bash
printf 'KANAP_CERT=%s\nKANAP_KEY=%s\n' /etc/ssl/kanap/fullchain.pem /etc/ssl/kanap/privkey.pem >> ~/kanap-install.env
```

**Let's Encrypt (public name).** The name must resolve to this server from the internet and port 80 must be reachable. The default nginx page answers the challenge, so run this before you enable the KANAP site. The `certbot` package renews the certificate by itself; the deploy hook reloads nginx after each renewal.

```bash
. ~/kanap-install.env
sudo apt-get install -y certbot
sudo certbot certonly --webroot -w /var/www/html -d "${KANAP_HOST}" \
  -m "${ADMIN_EMAIL}" --agree-tos --no-eff-email --non-interactive \
  --deploy-hook 'systemctl reload nginx'
printf 'KANAP_CERT=%s\nKANAP_KEY=%s\n' "/etc/letsencrypt/live/${KANAP_HOST}/fullchain.pem" "/etc/letsencrypt/live/${KANAP_HOST}/privkey.pem" >> ~/kanap-install.env
sudo certbot renew --dry-run
```

### Site configuration

Write the site file with placeholders for the name and the certificate, then fill them in. The file is for nginx 1.25.1 and later (Ubuntu 26.04 ships 1.28). It sends `/api/` directly to the API port (`127.0.0.1:8080`) so that KANAP sees the address of each user.

```bash
sudo tee /etc/nginx/sites-available/kanap >/dev/null <<'EOF'
server {
    # HTTP/2: the browser sends the dozens of requests of a page over one connection.
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name KANAP_HOST;

    ssl_certificate     KANAP_CERT;
    ssl_certificate_key KANAP_KEY;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;

    # Upload limit: budget files up to 48 MB, attachments up to 20 MB
    client_max_body_size 50m;

    # Canonicalize /api → /api/
    location = /api { return 301 /api/; }

    # API: strip /api prefix before proxying
    location ^~ /api/ {
        proxy_pass http://127.0.0.1:8080/;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host  $host;

        # Compress the API's JSON and CSV answers (a budget list page shrinks about 8 times).
        # Streamed AI answers (application/x-ndjson) are left out on purpose.
        gzip on;
        gzip_proxied any;
        gzip_comp_level 5;
        gzip_min_length 1024;
        gzip_vary on;
        gzip_types application/json text/csv text/plain;

        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_read_timeout  300s;
        proxy_send_timeout  300s;
        proxy_redirect off;
    }

    # Everything else → SPA
    location / {
        proxy_pass http://127.0.0.1:8081;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_redirect off;
    }
}

server {
    listen 80;
    listen [::]:80;
    server_name KANAP_HOST;

    # Certificate renewal with Let's Encrypt (webroot); harmless otherwise
    location /.well-known/acme-challenge/ { root /var/www/html; }

    location / { return 301 https://$host$request_uri; }
}
EOF

. ~/kanap-install.env
sudo sed -i -e "s|KANAP_HOST|${KANAP_HOST}|g" -e "s|KANAP_CERT|${KANAP_CERT}|g" -e "s|KANAP_KEY|${KANAP_KEY}|g" /etc/nginx/sites-available/kanap
```

**Ubuntu 24.04 (nginx 1.24):** it does not know the `http2 on;` directive. Run this once after the commands above:

```bash
sudo sed -i -e 's/listen 443 ssl;/listen 443 ssl http2;/' -e 's/listen \[::\]:443 ssl;/listen [::]:443 ssl http2;/' -e '/^ *http2 on;$/d' /etc/nginx/sites-available/kanap
```

Enable the site and restart nginx:

```bash
sudo ln -sf /etc/nginx/sites-available/kanap /etc/nginx/sites-enabled/kanap
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl restart nginx
```

`nginx -t` must print `syntax is ok` and `test is successful`.

---

## 9. Verify

Check the health of the API and the front end through nginx. `-S` makes `curl` show an error such as a name that does not resolve. `-k` accepts a certificate the server does not trust: keep it with a self-signed certificate, or with a certificate from your internal authority when that authority is not installed on the server; leave it out with Let's Encrypt.

```bash
. ~/kanap-install.env
curl -sSk -w '\n' "https://${KANAP_HOST}/api/health"
# Expected: {"status":"ok"}
curl -sSk -o /dev/null -w "%{http_code}\n" "https://${KANAP_HOST}/"
# Expected: 200
```

Then run the smoke test. It checks the database, the storage, the sign-in and the exports through the public API, the way the web app does. The server has no Node.js, so it runs in a container. The line that starts with `KANAP_PASSWORD=` reads the administrator password from `.env` into the environment of the test without showing it. The first run downloads the `node:24-alpine` image from Docker Hub (about 240 MB) and keeps it for later runs. `KANAP_WRITE=1` also creates a temporary task with an attachment, which checks the storage, and deletes it again. Use it right after installation only: it writes to the data. The temporary task uses one task reference (`T-1` on a new installation), so your first task is `T-2`. `KANAP_INSECURE_TLS=1` accepts a certificate the container does not trust: keep it with a self-signed certificate. With a certificate from your internal authority, you can keep it or let the container check the certificate: put the authority's file in `/opt/kanap/infra/certs/` (see [Certificates from an internal authority](configuration.md#optional-certificates-from-an-internal-authority)) and replace `-e KANAP_INSECURE_TLS=1` with `-v /opt/kanap/infra/certs:/certs:ro -e NODE_EXTRA_CA_CERTS=/certs/company-ca.pem`. With Let's Encrypt, remove `-e KANAP_INSECURE_TLS=1`.

```bash
. ~/kanap-install.env
KANAP_PASSWORD="$(grep '^ADMIN_PASSWORD=' /opt/kanap/.env | cut -d= -f2-)"; export KANAP_PASSWORD
docker run --rm --network host \
  -e KANAP_URL="https://${KANAP_HOST}" -e KANAP_EMAIL="${ADMIN_EMAIL}" -e KANAP_PASSWORD \
  -e KANAP_INSECURE_TLS=1 -e KANAP_WRITE=1 \
  -v /opt/kanap/scripts/smoke:/smoke:ro node:24-alpine node /smoke/recette.mjs
unset KANAP_PASSWORD
```

The last line ends with `0 failed`: it reads like `25 OK, 1 skipped, 0 failed (0.5 s)`. With `KANAP_INSECURE_TLS=1`, two TLS warnings at the top of the output are expected. A `SKIP` for the AI settings is normal while the AI features are off. Finally, check that the API log shows no storage warning:

```bash
cd /opt/kanap
docker compose -f infra/compose.onprem.yml logs api | grep 'PutObject fallback' || echo "no storage warning"
```

---

## 10. First login

1. Open `https://<your name>` in a browser (accept the certificate warning if you use a self-signed certificate; the workstation must resolve the name).
2. Sign in with `ADMIN_EMAIL` and the administrator password. To see the password, run `grep '^ADMIN_PASSWORD=' /opt/kanap/.env | cut -d= -f2-` on the server. It shows on screen, so run it when nobody else can see your screen.
3. Change the password in your profile right after this first sign-in. KANAP reads the `.env` value at the first start only.
4. Add your logo and colors in **Admin → Branding** (optional).
5. Invite additional users (if email is configured).

The installation is complete. `~/kanap-install.env` has done its job: every value now lives in `/opt/kanap/.env`, `/etc/default/rustfs` and the PostgreSQL role. Delete the file:

```bash
rm ~/kanap-install.env
```

Next, set up the [backups](operations.md#backup-and-restore).

---

## Services summary

| Service    | Managed by     | Configuration                                         |
|------------|----------------|-------------------------------------------------------|
| Docker     | systemd        | none                                                  |
| PostgreSQL | systemd (`postgresql@<version>-main`) | `/etc/postgresql/<version>/main/conf.d/`, `pg_hba.conf` |
| RustFS     | systemd        | `/etc/default/rustfs` (holds the encryption key)      |
| Firewall   | ufw            | `sudo ufw status`                                     |
| KANAP API  | Docker Compose | `/opt/kanap/.env` + `infra/compose.onprem.yml`        |
| KANAP Web  | Docker Compose | `/opt/kanap/.env` + `infra/compose.onprem.yml`        |
| nginx      | systemd        | `/etc/nginx/sites-available/kanap`                    |

## Useful commands

```bash
cd /opt/kanap

# View logs
docker compose -f infra/compose.onprem.yml logs -f

# Restart KANAP
docker compose -f infra/compose.onprem.yml restart

# Apply a change of .env
docker compose -f infra/compose.onprem.yml up -d api

# Stop KANAP
docker compose -f infra/compose.onprem.yml down

# Check all services (pg_lsclusters shows the cluster online)
pg_lsclusters
sudo systemctl status --no-pager nginx rustfs
docker compose -f infra/compose.onprem.yml ps

# Which version runs: the checkout, then the API (-k: see step 9)
git describe --tags
curl -sSk -w '\n' "$(grep '^APP_BASE_URL=' .env | cut -d= -f2-)/api/config/public"
```

Check PostgreSQL with `pg_lsclusters`. `systemctl status postgresql` stays `active` even when the cluster is down. The `version` field of the last answer is the version the API reports.

To update KANAP, follow the [upgrade procedure](operations.md#upgrade-procedure): read the changelog, then `git pull origin stable`, `build --pull` and `up -d`.
