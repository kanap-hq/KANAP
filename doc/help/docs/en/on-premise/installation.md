# On-premise installation

## Prerequisites

**Server requirements:**

- Linux server: Ubuntu 26.04 or 24.04 LTS, Debian 12 or 13, RHEL 9 or 10, or any OS with Docker Engine 24.0+ and the Docker Compose plugin
- Docker Engine 24.0+
- Docker Compose plugin 2.20 or later (current releases are 5.x)
- Git
- 6 GB RAM minimum, 8 GB recommended. The image build, at installation and at each upgrade, needs that room. More API processes need more memory, see [Configuration](configuration.md#optional-capacity-and-performance).
- 20 GB disk minimum. After installation KANAP takes about 4 GB (images 1.3 GB, build cache 2.5 GB). The database, the stored files and the build cache grow over time; the cache grows at each upgrade, and `docker builder prune` reclaims it.

**Customer-provided infrastructure:**

| Component | Requirement |
|-----------|-------------|
| PostgreSQL | Version 16+ with `citext`, `pgcrypto`, `uuid-ossp` extensions, and a dedicated application role for `DATABASE_URL` |
| S3 storage | Any S3-compatible storage with one bucket: AWS S3, Cloudflare R2, Hetzner Object Storage, Garage, RustFS, an existing MinIO, and others. KANAP needs `PutObject`, `GetObject`, `HeadObject`, `DeleteObject`, `ListObjectsV2` and presigned `GET` on that bucket. |
| Reverse proxy | TLS termination and routing (nginx, Traefik, Caddy, etc.) |
| Name and certificate | A name that users and the server resolve, and a certificate for it (see below) |

A MinIO that already runs keeps working with KANAP: nothing to change. MinIO no longer publishes new downloads or images, so the [installation example](installation-example.md) uses RustFS.

Optional:

- Outbound email configuration: Resend API key or SMTP relay/server details
- Microsoft Entra SSO (see [Microsoft Entra SSO](sso-entra.md))
- A coding AI agent that can run the installation for you (see [AI-assisted installation](installation-ai.md))

## Name and certificate

Users open KANAP at one HTTPS address, for example `https://kanap.company.com`. That address needs a name that resolves to your server and a certificate that matches it. Three cases cover most networks:

| Case | Name | Certificate |
|------|------|-------------|
| **Public name** | A record in public DNS pointing to the server (or to the firewall in front of it) | From a public authority, for example Let's Encrypt with `certbot`. Port 80 must be reachable from the internet. |
| **Internal name** | A record in your company DNS. For a test, a line in `/etc/hosts` on the server and on each client. | From your company's internal certificate authority. The browsers of managed workstations already trust it, so users see no warning. |
| **Self-signed** | Same as the internal name | Created on the server. Test only: every browser shows a warning that each user must accept. |

Many installations have no public DNS. The internal name with an internal certificate is a normal, supported setup. The certificate of the reverse proxy serves the browsers. The API also opens connections of its own, to SMTP, PostgreSQL or S3: when your authority signed those servers' certificates, see [Certificates from an internal authority](configuration.md#optional-certificates-from-an-internal-authority).

**The server must resolve the name too.** The verification commands in this guide, and the smoke test, run on the server and call KANAP by its name. When no DNS record exists yet, add the name to the server's hosts file:

```bash
echo "127.0.0.1 kanap.company.com" | sudo tee -a /etc/hosts
```

Replace `kanap.company.com` with your name. Clients need their own entry (or the DNS record) that points to the server's address.

**Self-signed certificate (test only):**

```bash
sudo install -d /etc/ssl/kanap
sudo openssl req -x509 -nodes -days 365 \
  -newkey rsa:2048 \
  -keyout /etc/ssl/kanap/server.key \
  -out /etc/ssl/kanap/server.crt \
  -subj "/CN=kanap.company.com" \
  -addext "subjectAltName=DNS:kanap.company.com"
sudo chmod 600 /etc/ssl/kanap/server.key
```

Replace `kanap.company.com` with your name. For an access by IP address use `IP:192.0.2.10` in `subjectAltName` and put the IP in the `-subj` and in `server_name`. To use your internal authority instead, ask for a certificate for the same name and point `ssl_certificate` and `ssl_certificate_key` in the nginx file to the files it gives you (the full chain and the private key). Nothing else changes.

**Let's Encrypt:** `sudo apt-get install -y certbot`, then `sudo certbot certonly --webroot -w /var/www/html -d kanap.company.com`, with the default nginx page answering on port 80. The certificate files are `/etc/letsencrypt/live/kanap.company.com/fullchain.pem` and `privkey.pem`. The [installation example](installation-example.md#8-nginx-and-tls) shows the full sequence, including the renewal.

## Quick start

```bash
# 1. Get KANAP. The "stable" branch always points to the latest published version.
sudo install -d -o "$USER" -g "$USER" /opt/kanap
git clone https://github.com/kanap-hq/KANAP.git /opt/kanap
cd /opt/kanap
git checkout stable

# 2. Configure BEFORE building
cp infra/.env.onprem.example .env
chmod 600 .env
nano .env  # Set DATABASE_URL, S3 credentials, ADMIN_EMAIL, ADMIN_PASSWORD, JWT_SECRET,
#          APP_BASE_URL and CORS_ORIGINS (the exact address users open),
#          APP_ENV=production (users reach KANAP over HTTPS) and RATE_LIMIT_TRUST_PROXY=true
# See the Configuration guide for all variables

# 3. Build the Docker images (Compose builds them from the repository)
docker compose -f infra/compose.onprem.yml build --pull

# 4. Start containers
docker compose -f infra/compose.onprem.yml up -d

# 5. Verify startup
docker compose -f infra/compose.onprem.yml logs -f api
# Wait for "[entrypoint] Migrations complete", then "Nest application successfully started"
# First boot creates the tenant, admin user, and subscription automatically
# Press Ctrl+C to stop following the log

# 6. Configure your reverse proxy to route traffic to:
#    - /api/* → 127.0.0.1:8080 (the api container)
#    - /*     → 127.0.0.1:8081 (the web container, port 80 inside the container)
# Ensure the proxy preserves Host and sets X-Forwarded-Proto and X-Forwarded-For.
# After the first start, read the [ENV], [CONFIG], [CORS], [RATE-LIMIT] and [SECURITY] lines of the API log.

# 7. Access application
# https://kanap.your-domain.com
# Login with ADMIN_EMAIL / ADMIN_PASSWORD from .env
```

**Important:** Complete the configuration (step 2) before starting containers. The API reads `.env` at startup and creates the tenant and admin user on first boot using those values. The file holds every secret of the installation: `chmod 600` keeps it readable by its owner only.

**Versions.** KANAP publishes a new version about once a month (`26.10.1` is the first). The `stable` branch always points to the latest published version. See [Operations](operations.md#upgrade-procedure) to upgrade, to pin a precise version and to roll back. The branch `main` holds every merged change before it is published as a version. Following it is possible, and not recommended for a production server.

**Database role requirement:** `DATABASE_URL` must use a dedicated PostgreSQL application role. Do not point it at `postgres` or another cluster-admin role. KANAP will fail startup rather than run without effective RLS enforcement.

**Address and origins:** Set `APP_BASE_URL` and `CORS_ORIGINS` to the exact address users open, with the port when it is not standard. Every link KANAP sends comes from `APP_BASE_URL`. Set `APP_ENV=production` when users reach KANAP over HTTPS: the API then refuses to start without these two values and always marks the session cookie Secure. See [Configuration](configuration.md#required-admin-credentials).

**Email choice:** On-premise deployments can use either **Resend** or **SMTP** for outbound email. SMTP is useful when the customer already has an internal mail relay or a managed provider such as Microsoft 365. Configure one of these options if you want password reset, invitations, and notification emails to work from day one.

## Reverse proxy example (nginx)

**Reverse proxy requirements:**

1. Terminate TLS on port 443
2. Route `/api/*` directly to the API container (port 8080 on `127.0.0.1`), without the `/api` prefix. Do not send `/api/` through the web container (port 8081): its own `/api/` route does not forward `X-Forwarded-For`, so KANAP would count and log every request under the address of the web container.
3. Route all other requests to the web container (port 8081 on `127.0.0.1`)
4. Set `X-Forwarded-Proto: https` and preserve `Host`. KANAP builds the links it sends from `APP_BASE_URL` and no longer reads `X-Forwarded-Host` outside local development. When the site uses a non-standard port, add the exact address with its port to `CORS_ORIGINS`.
5. Send `X-Forwarded-For` with the client address (the example does) and set `RATE_LIMIT_TRUST_PROXY=true`. KANAP uses that address for its sign-in limits. The API port must stay bound to `127.0.0.1`, as `compose.onprem.yml` does. With nothing in front of the API, set `RATE_LIMIT_TRUST_PROXY=false`.
6. Accept bodies of 50 MB (`client_max_body_size 50m`): budget files go up to 48 MB and attachments up to 20 MB.

Since containers bind to `127.0.0.1`, nginx runs on the same host and proxies to `localhost`.

The file is written for nginx 1.25.1 and later (Ubuntu 26.04 ships 1.28). Ubuntu 24.04 ships nginx 1.24: there, write `listen 443 ssl http2;` and `listen [::]:443 ssl http2;` and remove the `http2 on;` line.

```nginx
server {
    # HTTP/2: the browser sends the dozens of requests of a page over one connection.
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name kanap.company.com;

    ssl_certificate     /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

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

        # Long-running requests (exports, imports)
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

    # Certificate renewal with Let's Encrypt (webroot); harmless otherwise
    location /.well-known/acme-challenge/ { root /var/www/html; }

    location / { return 301 https://$host$request_uri; }
}
```

**Compression and HTTP/2:** the example compresses the API's answers and enables HTTP/2. Keep both in your own proxy: a page of the budget list is about 390 KB of JSON uncompressed and 47 KB compressed. If your nginx has the brotli module (`libnginx-mod-http-brotli-filter` on Debian and Ubuntu), `brotli on; brotli_types application/json text/csv text/plain;` in the same `location` compresses a little better; gzip is enough.

**`host.docker.internal`:** When PostgreSQL or S3 storage runs on the Docker host (not in a container), use `host.docker.internal` as the hostname in `DATABASE_URL` and `S3_ENDPOINT`. The `compose.onprem.yml` file includes the `extra_hosts` mapping that makes this work. It points to the Docker bridge address of the server (`172.17.0.1` by default), so the host services must accept connections from that network (see the [installation example](installation-example.md)).

**Health.** The API answers `GET /health` on its own port (`http://127.0.0.1:8080/health`) and `GET /api/health` through the proxy. Both return `{"status":"ok"}`. `docker compose ps` shows `healthy` for the `api` and `web` containers once they answer.

## Network architecture

```
                    ┌─────────────────────────────────────────────────────┐
                    │              Customer Infrastructure                 │
                    │                                                      │
    Network         │  ┌──────────────┐    ┌─────────────────────────┐   │
        │           │  │ Your Reverse │    │     Docker Host         │   │
        │           │  │    Proxy     │    │                         │   │
   ┌────▼────┐      │  │   (TLS)      │    │  ┌─────┐    ┌─────┐    │   │
   │ Browser │──────┼─▶│   :443       │───▶│  │ api │    │ web │    │   │
   └─────────┘      │  └──────────────┘    │  │:8080│    │:8081│    │   │
                    │                      │  └─────┘    └─────┘    │   │
                    │  ┌──────────────┐    └─────────────────────────┘   │
                    │  │  PostgreSQL  │                                   │
                    │  │   (yours)    │◀──────── DATABASE_URL            │
                    │  └──────────────┘                                   │
                    │  ┌──────────────┐                                   │
                    │  │  S3 Storage  │◀──────── S3_ENDPOINT             │
                    │  │   (yours)    │                                   │
                    │  └──────────────┘                                   │
                    └─────────────────────────────────────────────────────┘
```

**Deployment model:** one API container and one web container. Running several API or web containers is not supported. For more users at once, run several API processes inside the API container with `API_WORKERS` (see [Configuration](configuration.md#optional-capacity-and-performance)). For high availability, rely on Docker restart policies and infrastructure-level redundancy (database HA, S3 durability).

## First login

1. Navigate to `https://<your-name>`
2. Sign in with `ADMIN_EMAIL` and `ADMIN_PASSWORD` from `.env`
3. **Change the admin password** in your profile if you started with a value you do not want to keep. The `[SECURITY]` warning in the API log stops once the password has been changed (see below).
4. Configure organization settings
5. Invite additional users (if email is configured)

**About the administrator account.** KANAP creates it at the first start from `ADMIN_EMAIL` and `ADMIN_PASSWORD`, and only then. Changing those two lines later changes nothing while an active administrator exists: change the password in the application. If no active administrator remains, the next start restores the `ADMIN_EMAIL` account as an enabled administrator and keeps its existing password. `ADMIN_PASSWORD` must be a value of your own, 12 characters or more: `openssl rand -base64 18` generates one. An example value or a shorter one makes the API print a `[SECURITY]` warning at each start until the account's password is changed. See [Configuration](configuration.md#required-admin-credentials).
