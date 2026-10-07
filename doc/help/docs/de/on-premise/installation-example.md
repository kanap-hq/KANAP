# Installationsbeispiel: Ubuntu 24.04

Dieser Leitfaden führt durch eine vollständige On-Premise-Installation auf einem einzelnen Ubuntu 24.04-Server, mit PostgreSQL auf dem Host, MinIO als S3-kompatibler Speicher und nginx als TLS-Reverse-Proxy. Er basiert auf einer realen, funktionierenden Bereitstellung.

Passen Sie ihn an Ihre Umgebung an — die Kernleitfäden [Installation](installation.md) und [Konfiguration](configuration.md) bleiben die Referenz.

!!! tip "Bevorzugen Sie Automatisierung?"
    Ein Coding-AI-Agent kann diese gesamte Installation für Sie in einem einzigen Prompt ausführen. Siehe [AI-gestützte Installation](installation-ai.md).

## Architektur

```
Browser → nginx (:443, TLS) → Docker-Container (api :8080, web :8081)
                             → PostgreSQL (:5432, auf Host)
                             → MinIO (:9000, auf Host)
```

Alle Dienste laufen auf einem einzelnen Server. Container erreichen Host-Dienste über `host.docker.internal`.

---

## 1. Docker Engine

Installieren Sie Docker aus dem offiziellen Repository:

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

Fügen Sie Ihren Benutzer zur `docker`-Gruppe hinzu (melden Sie sich ab und wieder an, damit es wirksam wird):

```bash
sudo usermod -aG docker $USER
```

---

## 2. PostgreSQL 16

```bash
sudo apt-get install -y postgresql-16
```

Erstellen Sie die Datenbank, den Benutzer und die erforderlichen Erweiterungen:

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

### Verbindungen von Docker-Containern zulassen

Bearbeiten Sie `/etc/postgresql/16/main/postgresql.conf`:

```
listen_addresses = '*'
```

Bearbeiten Sie `/etc/postgresql/16/main/pg_hba.conf` — fügen Sie vor den Standard-Host-Regeln hinzu:

```
host    kanap    kanap    172.16.0.0/12    scram-sha-256
```

Dies erlaubt Verbindungen vom Docker-Bridge-Netzwerk. Verwenden Sie für höhere Sicherheit das exakte Docker-Subnetz (`docker network inspect bridge`, um es zu finden).

Starten Sie PostgreSQL neu und überprüfen Sie:

```bash
sudo systemctl restart postgresql
PGPASSWORD='your-secure-password' psql -h 127.0.0.1 -U kanap -d kanap -c "SELECT 1;"
```

---

## 3. MinIO (S3-kompatibler Speicher)

Laden Sie den MinIO-Server und -Client herunter:

```bash
wget -q https://dl.min.io/server/minio/release/linux-amd64/minio -O /tmp/minio
sudo mv /tmp/minio /usr/local/bin/minio
sudo chmod +x /usr/local/bin/minio

wget -q https://dl.min.io/client/mc/release/linux-amd64/mc -O /tmp/mc
sudo mv /tmp/mc /usr/local/bin/mc
sudo chmod +x /usr/local/bin/mc
```

Erstellen Sie einen Systembenutzer und ein Datenverzeichnis:

```bash
sudo useradd -r -s /sbin/nologin minio-user
sudo mkdir -p /opt/minio/data
sudo chown -R minio-user:minio-user /opt/minio
```

Konfigurieren Sie MinIO — erstellen Sie `/etc/default/minio`:

```
MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=your-minio-admin-password
MINIO_VOLUMES="/opt/minio/data"
MINIO_OPTS="--address :9000 --console-address :9001"
```

Erstellen Sie den systemd-Dienst — `/etc/systemd/system/minio.service`:

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

Aktivieren und starten Sie MinIO, dann erstellen Sie den Bucket und ein Servicekonto:

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

## 4. KANAP klonen und konfigurieren

```bash
cd /opt  # oder Ihr bevorzugtes Verzeichnis
git clone https://github.com/kanap-it/kanap.git
cd kanap
cp infra/.env.onprem.example .env
```

Bearbeiten Sie `.env` mit Ihren Werten. Hier ist ein funktionierendes Beispiel für dieses Setup:

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

### PostgreSQL für diesen Server dimensionieren

Die Standardwerte von PostgreSQL sind für eine kleine Maschine ausgelegt. Das Repository enthält ein Skript, das Einstellungen ausgibt, die anhand des Arbeitsspeichers dieses Servers dimensioniert sind; es ändert von sich aus nichts. Es behält die von PostgreSQL bereits vorgeladenen Bibliotheken bei (geben Sie ihm deren Liste) und fügt die Anweisungsstatistik-Bibliothek hinzu, wenn es sie auf diesem Server findet. Lesen Sie die Datei, die es schreibt, starten Sie dann PostgreSQL neu und aktivieren Sie die Anweisungsstatistiken:

```bash
CURRENT=$(sudo -u postgres psql -XAtc 'SHOW shared_preload_libraries')
sh infra/postgres/kanap-pg-tune.sh --preload "$CURRENT" | sudo tee /etc/postgresql/16/main/conf.d/kanap.conf
sudo systemctl restart postgresql
sudo -u postgres psql -d kanap -c 'CREATE EXTENSION IF NOT EXISTS pg_stat_statements'
```

**Wichtig:** Generieren Sie ein echtes JWT-Secret (`openssl rand -hex 32`) — verwenden Sie keine Beispielwerte.

Wenn Sie auf KANAP über die IP-Adresse anstelle einer Domäne zugreifen, setzen Sie `APP_BASE_URL` und `CORS_ORIGINS` auf `https://YOUR_IP`.

Wenn Sie SMTP anstelle von Resend verwenden, stellen Sie sicher, dass der SMTP-Server E-Mails von der `SMTP_FROM`-Adresse akzeptiert und dass die SPF-, DKIM- und DMARC-Einstellungen Ihrer Domäne bereits eingerichtet sind, falls Nachrichten Ihr internes Netzwerk verlassen.

---

## 5. Bauen und starten

```bash
cd /opt/kanap
docker compose -f infra/compose.onprem.yml build --pull
docker compose -f infra/compose.onprem.yml up -d
```

Überprüfen Sie die Logs. Warten Sie auf die Zeile „[entrypoint] Migrations complete" und danach auf „Nest application successfully started":

```bash
docker compose -f infra/compose.onprem.yml logs -f api
```

Beim ersten Start führt KANAP Migrationen aus und erstellt automatisch den Mandanten, den Admin-Benutzer und das Abonnement.

---

## 6. Nginx-Reverse-Proxy mit TLS

```bash
sudo apt-get install -y nginx
```

### TLS-Zertifikat

Wenn Sie eine Domäne mit einem gültigen Zertifikat haben, verwenden Sie diese. Andernfalls generieren Sie ein selbstsigniertes Zertifikat:

```bash
sudo mkdir -p /etc/ssl/kanap
sudo openssl req -x509 -nodes -days 365 \
  -newkey rsa:2048 \
  -keyout /etc/ssl/kanap/server.key \
  -out /etc/ssl/kanap/server.crt \
  -subj "/CN=kanap.company.com" \
  -addext "subjectAltName=DNS:kanap.company.com"
```

Für IP-basierten Zugriff (keine Domäne) ersetzen Sie die Werte für `-subj` und `-addext`:

```bash
  -subj "/CN=192.168.1.83" \
  -addext "subjectAltName=IP:192.168.1.83"
```

### Site-Konfiguration

Erstellen Sie `/etc/nginx/sites-available/kanap`:

```nginx
server {
    # HTTP/2: Der Browser sendet die Dutzenden Anfragen einer Seite über eine Verbindung.
    # nginx 1.25.1 und neuer: Schreiben Sie stattdessen `listen 443 ssl;` und `http2 on;`.
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

        # Komprimiert die JSON- und CSV-Antworten der API (eine Budgetlisten-Seite wird etwa 8-mal kleiner).
        # Gestreamte KI-Antworten (application/x-ndjson) sind absichtlich ausgenommen.
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

Aktivieren Sie die Site und starten Sie nginx neu:

```bash
sudo ln -sf /etc/nginx/sites-available/kanap /etc/nginx/sites-enabled/kanap
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx
```

---

## 7. Verifizieren

```bash
# API-Health-Check
curl -sk https://kanap.company.com/api/health
# Erwartet: {"status":"ok"}

# Frontend
curl -sk -o /dev/null -w "%{http_code}" https://kanap.company.com/
# Erwartet: 200
```

---

## 8. Erste Anmeldung

1. Öffnen Sie Ihre KANAP-URL in einem Browser (akzeptieren Sie die Zertifikatswarnung, wenn Sie selbstsigniertes TLS verwenden)
2. Melden Sie sich mit `ADMIN_EMAIL` / `ADMIN_PASSWORD` aus `.env` an
3. **Ändern Sie sofort das Admin-Passwort** über das Benutzerprofil
4. Konfigurieren Sie Ihren Organisationsnamen in den Admin-Einstellungen
5. Laden Sie zusätzliche Benutzer ein (wenn E-Mail konfiguriert ist)

---

## Dienste-Übersicht

| Dienst    | Verwaltet von  | Konfigurations-Standort                  |
|------------|----------------|------------------------------------------|
| Docker     | systemd        | —                                        |
| PostgreSQL | systemd        | `/etc/postgresql/16/main/postgresql.conf` |
| MinIO      | systemd        | `/etc/default/minio`                     |
| KANAP API  | Docker Compose | `.env` + `infra/compose.onprem.yml`      |
| KANAP Web  | Docker Compose | `.env` + `infra/compose.onprem.yml`      |
| nginx      | systemd        | `/etc/nginx/sites-available/kanap`       |

## Nützliche Befehle

```bash
# Logs anzeigen
docker compose -f infra/compose.onprem.yml logs -f

# KANAP neu starten
docker compose -f infra/compose.onprem.yml restart

# KANAP stoppen
docker compose -f infra/compose.onprem.yml down

# Nach einem Update neu bauen
git pull origin main
docker compose -f infra/compose.onprem.yml build --pull
docker compose -f infra/compose.onprem.yml up -d

# Alle Dienste prüfen
sudo systemctl status postgresql nginx minio
docker compose -f infra/compose.onprem.yml ps
```
