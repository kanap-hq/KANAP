# On-Premise Installation

## Prerequisites

**Server requirements:**
- Linux server (Ubuntu 22.04+, Debian 12+, RHEL 9+, or any Docker-capable OS)
- Docker Engine 24.0+
- Docker Compose v2.20+
- Git
- 4 GB RAM minimum (8 GB recommended; more API processes need more, see [Configuration](configuration.md#optional-capacity-and-performance))
- 20 GB disk minimum (+ build cache)

**Customer-provided infrastructure:**

| Component | Requirement |
|-----------|-------------|
| PostgreSQL | Version 16+ with `citext`, `pgcrypto`, `uuid-ossp` extensions, and a dedicated application role for `DATABASE_URL` |
| S3 Storage | Any S3-compatible: AWS S3, MinIO, Cloudflare R2, Hetzner, etc. |
| Reverse Proxy | TLS termination and routing (nginx, Traefik, Caddy, etc.) |
| Domain | DNS pointing to your server |

Optional:
- Outbound email configuration: Resend API key or SMTP relay/server details
- Microsoft Entra SSO (see `sso-entra.md`)

## Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/kanap-it/kanap.git
cd kanap

# 2. Configure environment BEFORE building
cp infra/.env.onprem.example .env
nano .env  # Set DATABASE_URL, S3 credentials, ADMIN_EMAIL, JWT_SECRET, APP_BASE_URL, CORS_ORIGINS
#          (APP_BASE_URL and CORS_ORIGINS: the exact address users open)
#          Add APP_ENV=production once users reach KANAP over HTTPS
# See the Configuration guide for all variables

# 3. Build the Docker images (Compose builds them from the repository)
docker compose -f infra/compose.onprem.yml build --pull

# 4. Start containers
docker compose -f infra/compose.onprem.yml up -d

# 5. Verify startup
docker compose -f infra/compose.onprem.yml logs -f api
# Wait for "[entrypoint] Migrations complete", then "Nest application successfully started"
# First boot creates the tenant, admin user, and subscription automatically

# 6. Configure your reverse proxy to route traffic to:
#    - /api/* → api:8080
#    - /*     → web:80
# Ensure the proxy preserves Host and sets X-Forwarded-Proto.
# After the first start, read the [ENV], [CONFIG] and [CORS] lines of the API log.

# 7. Access application
# https://kanap.your-domain.com
# Login with ADMIN_EMAIL / ADMIN_PASSWORD from .env
```

**Important:** Complete the configuration (step 2) before starting containers. The API reads `.env` at startup and creates the tenant and admin user on first boot using those values.

**Database role requirement:** `DATABASE_URL` must use a dedicated PostgreSQL application role. Do not point it at `postgres` or another cluster-admin role. KANAP will fail startup rather than run without effective RLS enforcement.

**Address and origins:** Set `APP_BASE_URL` and `CORS_ORIGINS` to the exact address users open, with the port when it is not standard. Every link KANAP sends comes from `APP_BASE_URL`. Add `APP_ENV=production` when users reach KANAP over HTTPS: the API then refuses to start without these two values and always marks the session cookie Secure. See [Configuration](configuration.md#required-admin-credentials).

**Email choice:** On-premise deployments can use either **Resend** or **SMTP** for outbound email. SMTP is useful when the customer already has an internal mail relay or a managed provider such as Microsoft 365. Configure one of these options if you want password reset, invitations, and notification emails to work from day one.

## Reverse Proxy Example (nginx)

**Reverse proxy requirements:**

1. Terminate TLS on port 443
2. Route `/api/*` to the API container (port 8080)
3. Route all other requests to the web container (port 80)
4. Set `X-Forwarded-Proto: https` and preserve `Host`. KANAP builds the links it sends from `APP_BASE_URL` and no longer reads `X-Forwarded-Host` outside local development. When the site uses a non-standard port, add the exact address with its port to `CORS_ORIGINS`.
5. Support WebSocket upgrade (used by real-time features)

Since containers bind to `127.0.0.1`, nginx runs on the same host and proxies to `localhost`.

```nginx
server {
    # HTTP/2: the browser sends the dozens of requests of a page over one connection.
    # nginx 1.25.1 and later: write `listen 443 ssl;` and `http2 on;` instead.
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name kanap.company.com;

    ssl_certificate     /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;

    # File upload limit (KANAP supports up to 20 MB)
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

        # WebSocket support
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
    return 301 https://$host$request_uri;
}
```

**Compression and HTTP/2:** the example compresses the API's answers and enables HTTP/2. Keep both in your own proxy: a page of the budget list is about 390 KB of JSON uncompressed and 47 KB compressed. If your nginx has the brotli module (`libnginx-mod-http-brotli-filter` on Debian and Ubuntu), `brotli on; brotli_types application/json text/csv text/plain;` in the same `location` compresses a little better; gzip is enough.

**Self-signed TLS (no domain):** If you don't have a domain and access KANAP by IP address, generate a self-signed certificate:

```bash
sudo mkdir -p /etc/ssl/kanap
sudo openssl req -x509 -nodes -days 365 \
  -newkey rsa:2048 \
  -keyout /etc/ssl/kanap/server.key \
  -out /etc/ssl/kanap/server.crt \
  -subj "/CN=YOUR_IP" \
  -addext "subjectAltName=IP:YOUR_IP"
```

Replace `YOUR_IP` with your server's IP and update `server_name`, `APP_BASE_URL`, and `CORS_ORIGINS` accordingly. Users will need to accept the browser certificate warning on first access.

**`host.docker.internal`:** When PostgreSQL or S3 storage runs on the Docker host (not in a container), use `host.docker.internal` as the hostname in `DATABASE_URL` and `S3_ENDPOINT`. The `compose.onprem.yml` file includes the `extra_hosts` mapping that makes this work.

## Network Architecture

```
                    ┌─────────────────────────────────────────────────────┐
                    │              Customer Infrastructure                 │
                    │                                                      │
    Internet        │  ┌──────────────┐    ┌─────────────────────────┐   │
        │           │  │ Your Reverse │    │     Docker Host         │   │
        │           │  │    Proxy     │    │                         │   │
   ┌────▼────┐      │  │   (TLS)      │    │  ┌─────┐    ┌─────┐    │   │
   │ Browser │──────┼─▶│   :443       │───▶│  │ api │    │ web │    │   │
   └─────────┘      │  └──────────────┘    │  │:8080│    │ :80 │    │   │
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

## First Login

1. Navigate to `https://<your-domain>`
2. Login with credentials from `.env` (ADMIN_EMAIL / ADMIN_PASSWORD)
3. **Immediately change the admin password** via user profile
4. Configure organization settings
5. Invite additional users (if email is configured)
