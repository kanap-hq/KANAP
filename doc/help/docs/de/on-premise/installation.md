# On-Premise-Installation

## Voraussetzungen

**Serveranforderungen:**
- Linux-Server (Ubuntu 22.04+, Debian 12+, RHEL 9+ oder jedes Docker-fähige OS)
- Docker Engine 24.0+
- Docker Compose v2.20+
- Git
- Mindestens 4 GB RAM (8 GB empfohlen; mehr API-Prozesse benötigen mehr, siehe [Konfiguration](configuration.md#optional-kapazitat-und-leistung))
- Mindestens 20 GB Festplatte (+ Build-Cache)

**Vom Kunden bereitgestellte Infrastruktur:**

| Komponente | Anforderung |
|------------|-------------|
| PostgreSQL | Version 16+ mit den Erweiterungen `citext`, `pgcrypto`, `uuid-ossp` und einer dedizierten Anwendungsrolle für `DATABASE_URL` |
| S3-Speicher | Jeder S3-kompatible: AWS S3, MinIO, Cloudflare R2, Hetzner usw. |
| Reverse Proxy | TLS-Terminierung und Routing (nginx, Traefik, Caddy usw.) |
| Domain | DNS-Eintrag, der auf Ihren Server zeigt |

Optional:
- Konfiguration für ausgehende E-Mail: Resend API-Schlüssel oder SMTP-Relay/Server-Details
- Microsoft Entra SSO (siehe `sso-entra.md`)

## Schnellstart

```bash
# 1. Repository klonen
git clone https://github.com/kanap-it/kanap.git
cd kanap

# 2. Umgebung konfigurieren VOR dem Bauen
cp infra/.env.onprem.example .env
nano .env  # DATABASE_URL, S3-Credentials, ADMIN_EMAIL, JWT_SECRET, APP_BASE_URL, CORS_ORIGINS setzen
#          (APP_BASE_URL und CORS_ORIGINS: die genaue Adresse, die Benutzer öffnen)
#          APP_ENV=production ergänzen, sobald Benutzer KANAP über HTTPS erreichen
# Siehe den Konfigurationsleitfaden für alle Variablen

# 3. Docker-Images bauen (Compose baut sie aus dem Repository)
docker compose -f infra/compose.onprem.yml build --pull

# 4. Container starten
docker compose -f infra/compose.onprem.yml up -d

# 5. Start überprüfen
docker compose -f infra/compose.onprem.yml logs -f api
# Auf "[entrypoint] Migrations complete" und danach "Nest application successfully started" warten
# Beim ersten Start erstellt KANAP automatisch Mandant, Admin-Benutzer und Abonnement

# 6. Ihren Reverse Proxy konfigurieren, um Traffic zu routen an:
#    - /api/* → api:8080
#    - /*     → web:80
# Stellen Sie sicher, dass der Proxy Host beibehält und X-Forwarded-Proto setzt.
# Lesen Sie nach dem ersten Start die Zeilen [ENV], [CONFIG] und [CORS] im API-Protokoll.

# 7. Auf Anwendung zugreifen
# https://kanap.ihre-domain.de
# Mit ADMIN_EMAIL / ADMIN_PASSWORD aus .env anmelden
```

**Wichtig:** Schließen Sie die Konfiguration (Schritt 2) ab, bevor Sie Container starten. Die API liest `.env` beim Start und erstellt beim ersten Start den Mandanten und Admin-Benutzer mit diesen Werten.

**Datenbankrollen-Anforderung:** `DATABASE_URL` muss eine dedizierte PostgreSQL-Anwendungsrolle verwenden. Zeigen Sie nicht auf `postgres` oder eine andere Cluster-Admin-Rolle. KANAP verweigert den Start, anstatt ohne effektive RLS-Durchsetzung zu laufen.

**Adresse und Origins:** Setzen Sie `APP_BASE_URL` und `CORS_ORIGINS` auf die genaue Adresse, die Benutzer öffnen, mit dem Port, wenn er nicht dem Standard entspricht. Jeder Link, den KANAP versendet, stammt aus `APP_BASE_URL`. Ergänzen Sie `APP_ENV=production`, wenn Benutzer KANAP über HTTPS erreichen: Die API startet dann nicht ohne diese beiden Werte und markiert das Sitzungs-Cookie immer als Secure. Siehe [Konfiguration](configuration.md#erforderlich-admin-zugangsdaten).

**E-Mail-Wahl:** On-Premise-Bereitstellungen können entweder **Resend** oder **SMTP** für ausgehende E-Mail verwenden. SMTP ist nützlich, wenn der Kunde bereits ein internes Mail-Relay oder einen verwalteten Anbieter wie Microsoft 365 hat. Konfigurieren Sie eine dieser Optionen, wenn Sie möchten, dass Passwortzurücksetzung, Einladungen und Benachrichtigungs-E-Mails ab dem ersten Tag funktionieren.

## Reverse-Proxy-Beispiel (nginx)

**Reverse-Proxy-Anforderungen:**

1. TLS auf Port 443 terminieren
2. `/api/*` an den API-Container routen (Port 8080)
3. Alle anderen Anfragen an den Web-Container routen (Port 80)
4. `X-Forwarded-Proto: https` setzen und `Host` beibehalten. KANAP erstellt die Links, die es versendet, aus `APP_BASE_URL` und liest `X-Forwarded-Host` außerhalb der lokalen Entwicklung nicht mehr. Verwendet die Website einen nicht standardmäßigen Port, tragen Sie die genaue Adresse mit Port in `CORS_ORIGINS` ein.
5. WebSocket-Upgrade unterstützen (verwendet für Echtzeit-Funktionen)

Da Container an `127.0.0.1` gebunden sind, läuft nginx auf dem gleichen Host und proxyt zu `localhost`.

```nginx
server {
    # HTTP/2: Der Browser sendet die Dutzenden Anfragen einer Seite über eine Verbindung.
    # nginx 1.25.1 und neuer: Schreiben Sie stattdessen `listen 443 ssl;` und `http2 on;`.
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name kanap.company.com;

    ssl_certificate     /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;

    # Datei-Upload-Limit (KANAP unterstützt bis zu 20 MB)
    client_max_body_size 20m;

    # /api → /api/ kanonisieren
    location = /api { return 301 /api/; }

    # API: /api-Präfix vor dem Proxying entfernen
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

        # WebSocket-Unterstützung
        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Lang laufende Anfragen (Exporte, Importe)
        proxy_read_timeout  300s;
        proxy_send_timeout  300s;
        proxy_redirect off;
    }

    # Alles andere → SPA
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

**Kompression und HTTP/2:** Das Beispiel komprimiert die Antworten der API und aktiviert HTTP/2. Behalten Sie beides in Ihrem eigenen Proxy: Eine Seite der Budgetliste wiegt unkomprimiert etwa 390 KB JSON und komprimiert 47 KB. Hat Ihr nginx das Brotli-Modul (`libnginx-mod-http-brotli-filter` unter Debian und Ubuntu), komprimiert `brotli on; brotli_types application/json text/csv text/plain;` im selben `location`-Block etwas besser; gzip reicht aus.

**Selbstsigniertes TLS (keine Domain):** Wenn Sie keine Domain haben und per IP-Adresse auf KANAP zugreifen, erstellen Sie ein selbstsigniertes Zertifikat:

```bash
sudo mkdir -p /etc/ssl/kanap
sudo openssl req -x509 -nodes -days 365 \
  -newkey rsa:2048 \
  -keyout /etc/ssl/kanap/server.key \
  -out /etc/ssl/kanap/server.crt \
  -subj "/CN=IHRE_IP" \
  -addext "subjectAltName=IP:IHRE_IP"
```

Ersetzen Sie `IHRE_IP` durch die IP-Adresse Ihres Servers und aktualisieren Sie `server_name`, `APP_BASE_URL` und `CORS_ORIGINS` entsprechend. Benutzer müssen beim ersten Zugriff die Browser-Zertifikatswarnung akzeptieren.

**`host.docker.internal`:** Wenn PostgreSQL oder S3-Speicher auf dem Docker-Host laufen (nicht in einem Container), verwenden Sie `host.docker.internal` als Hostname in `DATABASE_URL` und `S3_ENDPOINT`. Die Datei `compose.onprem.yml` enthält das `extra_hosts`-Mapping, das dies ermöglicht.

## Netzwerkarchitektur

```
                    ┌─────────────────────────────────────────────────────┐
                    │              Kunden-Infrastruktur                    │
                    │                                                      │
    Internet        │  ┌──────────────┐    ┌─────────────────────────┐   │
        │           │  │ Ihr Reverse  │    │     Docker-Host         │   │
        │           │  │    Proxy     │    │                         │   │
   ┌────▼────┐      │  │   (TLS)      │    │  ┌─────┐    ┌─────┐    │   │
   │ Browser │──────┼─▶│   :443       │───▶│  │ api │    │ web │    │   │
   └─────────┘      │  └──────────────┘    │  │:8080│    │ :80 │    │   │
                    │                      │  └─────┘    └─────┘    │   │
                    │  ┌──────────────┐    └─────────────────────────┘   │
                    │  │  PostgreSQL  │                                   │
                    │  │   (Ihres)    │◀──────── DATABASE_URL            │
                    │  └──────────────┘                                   │
                    │  ┌──────────────┐                                   │
                    │  │  S3-Speicher │◀──────── S3_ENDPOINT             │
                    │  │   (Ihres)    │                                   │
                    │  └──────────────┘                                   │
                    └─────────────────────────────────────────────────────┘
```

**Deployment-Modell:** ein API-Container und ein Web-Container. Der Betrieb mehrerer API- oder Web-Container wird nicht unterstützt. Für mehr gleichzeitige Benutzer führen Sie mehrere API-Prozesse innerhalb des API-Containers mit `API_WORKERS` aus (siehe [Konfiguration](configuration.md#optional-kapazitat-und-leistung)). Für Hochverfügbarkeit verlassen Sie sich auf Docker-Neustart-Richtlinien und Infrastruktur-Redundanz (Datenbank-HA, S3-Haltbarkeit).

## Erste Anmeldung

1. Navigieren Sie zu `https://<ihre-domain>`
2. Melden Sie sich mit den Zugangsdaten aus `.env` an (ADMIN_EMAIL / ADMIN_PASSWORD)
3. **Ändern Sie sofort das Admin-Passwort** über das Benutzerprofil
4. Konfigurieren Sie Organisationseinstellungen
5. Laden Sie weitere Benutzer ein (wenn E-Mail konfiguriert ist)
