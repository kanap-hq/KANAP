# Installation Example: Ubuntu 24.04

This guide walks through a complete on-premise installation on a single Ubuntu 24.04 server, using PostgreSQL on the host, MinIO for S3-compatible storage, and nginx as the TLS reverse proxy. It is based on a real, working deployment.

Adapt it to your environment — the core [Installation](installation.md) and [Configuration](configuration.md) guides remain the reference.

!!! tip "Prefer automation?"
    A coding AI agent can run this entire installation for you in a single prompt. See [AI-Assisted Installation](installation-ai.md).

## Architecture

```
Browser → nginx (:443, TLS) → Docker containers (api :8080, web :8081)
                             → PostgreSQL (:5432, on host)
                             → MinIO (:9000, on host)
```

All services run on a single server. Containers reach host services via `host.docker.internal`.

---

## 1. Docker Engine

Install Docker from the official repository:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg

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

Add your user to the `docker` group (log out and back in for it to take effect):

```bash
sudo usermod -aG docker $USER
```

---

## 2. PostgreSQL 16

```bash
sudo apt-get install -y postgresql-16
```

Create the database, user, and required extensions:

```bash
sudo -u postgres psql <<'SQL'
CREATE DATABASE kanap;
CREATE USER kanap WITH PASSWORD 'your-secure-password' NOSUPERUSER NOBYPASSRLS;
GRANT ALL PRIVILEGES ON DATABASE kanap TO kanap;
SQL

sudo -u postgres psql -d kanap <<'SQL'
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
GRANT ALL ON SCHEMA public TO kanap;
SQL
```

### Allow connections from Docker containers

Edit `/etc/postgresql/16/main/postgresql.conf`:

```
listen_addresses = '*'
```

Edit `/etc/postgresql/16/main/pg_hba.conf` — add before the default host rules:

```
host    kanap    kanap    172.16.0.0/12    scram-sha-256
```

This allows connections from the Docker bridge network. For tighter security, use the exact Docker subnet (`docker network inspect bridge` to find it).

Restart PostgreSQL and verify:

```bash
sudo systemctl restart postgresql
PGPASSWORD='your-secure-password' psql -h 127.0.0.1 -U kanap -d kanap -c "SELECT 1;"
```

---

## 3. MinIO (S3-Compatible Storage)

Download MinIO server and client:

```bash
wget -q https://dl.min.io/server/minio/release/linux-amd64/minio -O /tmp/minio
sudo mv /tmp/minio /usr/local/bin/minio
sudo chmod +x /usr/local/bin/minio

wget -q https://dl.min.io/client/mc/release/linux-amd64/mc -O /tmp/mc
sudo mv /tmp/mc /usr/local/bin/mc
sudo chmod +x /usr/local/bin/mc
```

Create a system user and data directory:

```bash
sudo useradd -r -s /sbin/nologin minio-user
sudo mkdir -p /opt/minio/data
sudo chown -R minio-user:minio-user /opt/minio
```

Configure MinIO — create `/etc/default/minio`:

```
MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=your-minio-admin-password
MINIO_VOLUMES="/opt/minio/data"
MINIO_OPTS="--address :9000 --console-address :9001"
```

Create the systemd service — `/etc/systemd/system/minio.service`:

```ini
[Unit]
Description=MinIO Object Storage
After=network-online.target
Wants=network-online.target

[Service]
User=minio-user
Group=minio-user
EnvironmentFile=/etc/default/minio
ExecStart=/usr/local/bin/minio server $MINIO_VOLUMES $MINIO_OPTS
Restart=always
RestartSec=5
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
```

Enable and start MinIO, then create the bucket and a service account:

```bash
sudo systemctl daemon-reload
sudo systemctl enable minio
sudo systemctl start minio

mc alias set localminio http://127.0.0.1:9000 minioadmin your-minio-admin-password
mc mb localminio/kanap-files
mc admin user svcacct add localminio minioadmin \
  --access-key your-s3-access-key \
  --secret-key your-s3-secret-key
```

---

## 4. Clone KANAP and Configure

```bash
cd /opt  # or your preferred directory
git clone https://github.com/kanap-it/kanap.git
cd kanap
cp infra/.env.onprem.example .env
```

Edit `.env` with your values. Here is a working example for this setup:

```env
# DEPLOYMENT MODE
DEPLOYMENT_MODE=single-tenant

# TENANT
DEFAULT_TENANT_SLUG=default
DEFAULT_TENANT_NAME=My Organization

# ADMIN CREDENTIALS
ADMIN_EMAIL=admin@company.com
ADMIN_PASSWORD=ChangeThisAfterFirstLogin!

# SECURITY
JWT_SECRET=<output of: openssl rand -hex 32>

# APPLICATION URL
APP_BASE_URL=https://kanap.company.com

# CORS
CORS_ORIGINS=https://kanap.company.com

# DATABASE — host.docker.internal reaches the host from inside Docker
DATABASE_URL=postgres://kanap:your-secure-password@host.docker.internal:5432/kanap?sslmode=disable

# STORAGE — MinIO on the host
S3_ENDPOINT=http://host.docker.internal:9000
S3_BUCKET=kanap-files
S3_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-s3-access-key
AWS_SECRET_ACCESS_KEY=your-s3-secret-key
S3_FORCE_PATH_STYLE=true

# EMAIL (optional — choose one transport to enable invitations, password reset, notifications)
# RESEND_API_KEY=re_xxxxx
# RESEND_FROM_EMAIL=KANAP <noreply@yourdomain.com>

# SMTP (single-tenant / on-prem only)
# SMTP_HOST=smtp.company.com
# SMTP_PORT=587
# SMTP_SECURE=false
# SMTP_USER=noreply@company.com
# SMTP_PASSWORD=your-smtp-password
# SMTP_FROM=KANAP <noreply@company.com>
```

### Size PostgreSQL for this server

PostgreSQL's defaults are sized for a small machine. The repository has a script that prints settings sized from this server's memory; it changes nothing by itself. It keeps the libraries PostgreSQL already preloads (give it their list) and adds the statement statistics library when it finds it on this server. Read the file it writes, then restart PostgreSQL and enable the statement statistics:

```bash
CURRENT=$(sudo -u postgres psql -XAtc 'SHOW shared_preload_libraries')
sh infra/postgres/kanap-pg-tune.sh --preload "$CURRENT" | sudo tee /etc/postgresql/16/main/conf.d/kanap.conf
sudo systemctl restart postgresql
sudo -u postgres psql -d kanap -c 'CREATE EXTENSION IF NOT EXISTS pg_stat_statements'
```

**Important:** Generate a real JWT secret (`openssl rand -hex 32`) — do not reuse example values.

If you access KANAP by IP address instead of a domain, set `APP_BASE_URL` and `CORS_ORIGINS` to `https://YOUR_IP`.

If you use SMTP instead of Resend, make sure the SMTP server accepts mail from the `SMTP_FROM` address and that your domain's SPF, DKIM, and DMARC settings are already in place if messages leave your internal network.

---

## 5. Build and Start

```bash
cd /opt/kanap
docker build -t kanap-api:latest ./backend
docker build -t kanap-web:latest ./frontend
docker compose -f infra/compose.onprem.yml up -d
```

Check the logs — wait for the "Application started" message:

```bash
docker compose -f infra/compose.onprem.yml logs -f api
```

On first boot, KANAP runs migrations and creates the tenant, admin user, and subscription automatically.

---

## 6. Nginx Reverse Proxy with TLS

```bash
sudo apt-get install -y nginx
```

### TLS certificate

If you have a domain with a proper certificate, use that. Otherwise, generate a self-signed certificate:

```bash
sudo mkdir -p /etc/ssl/kanap
sudo openssl req -x509 -nodes -days 365 \
  -newkey rsa:2048 \
  -keyout /etc/ssl/kanap/server.key \
  -out /etc/ssl/kanap/server.crt \
  -subj "/CN=kanap.company.com" \
  -addext "subjectAltName=DNS:kanap.company.com"
```

For IP-based access (no domain), replace the `-subj` and `-addext` values:

```bash
  -subj "/CN=192.168.1.83" \
  -addext "subjectAltName=IP:192.168.1.83"
```

### Site configuration

Create `/etc/nginx/sites-available/kanap`:

```nginx
server {
    # HTTP/2: the browser sends the dozens of requests of a page over one connection.
    # nginx 1.25.1 and later: write `listen 443 ssl;` and `http2 on;` instead.
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name kanap.company.com;

    ssl_certificate     /etc/ssl/kanap/server.crt;
    ssl_certificate_key /etc/ssl/kanap/server.key;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;

    client_max_body_size 20m;

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
    server_name kanap.company.com;
    return 301 https://$host$request_uri;
}
```

Enable the site and restart nginx:

```bash
sudo ln -sf /etc/nginx/sites-available/kanap /etc/nginx/sites-enabled/kanap
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx
```

---

## 7. Verify

```bash
# API health check
curl -sk https://kanap.company.com/api/health
# Expected: {"status":"ok"}

# Frontend
curl -sk -o /dev/null -w "%{http_code}" https://kanap.company.com/
# Expected: 200
```

---

## 8. First Login

1. Open your KANAP URL in a browser (accept the certificate warning if using self-signed TLS)
2. Log in with the `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env`
3. **Change the admin password immediately** via user profile
4. Configure your organization name in Admin settings
5. Invite additional users (if email is configured)

---

## Services Summary

| Service    | Managed By     | Config Location                          |
|------------|----------------|------------------------------------------|
| Docker     | systemd        | —                                        |
| PostgreSQL | systemd        | `/etc/postgresql/16/main/postgresql.conf` |
| MinIO      | systemd        | `/etc/default/minio`                     |
| KANAP API  | Docker Compose | `.env` + `infra/compose.onprem.yml`      |
| KANAP Web  | Docker Compose | `.env` + `infra/compose.onprem.yml`      |
| nginx      | systemd        | `/etc/nginx/sites-available/kanap`       |

## Useful Commands

```bash
# View logs
docker compose -f infra/compose.onprem.yml logs -f

# Restart KANAP
docker compose -f infra/compose.onprem.yml restart

# Stop KANAP
docker compose -f infra/compose.onprem.yml down

# Rebuild after update
git pull origin main
docker build -t kanap-api:latest ./backend
docker build -t kanap-web:latest ./frontend
docker compose -f infra/compose.onprem.yml up -d

# Check all services
sudo systemctl status postgresql nginx minio
docker compose -f infra/compose.onprem.yml ps
```
