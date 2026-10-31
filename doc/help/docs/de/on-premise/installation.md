# On-Premise-Installation

## Voraussetzungen

**Anforderungen an den Server:**

- Linux-Server: Ubuntu 26.04 oder 24.04 LTS, Debian 12 oder 13, RHEL 9 oder 10 oder ein beliebiges Betriebssystem mit Docker Engine 24.0+ und dem Docker-Compose-Plugin
- Docker Engine 24.0+
- Docker-Compose-Plugin ab Version 2.20 (aktuelle Versionen sind 5.x)
- Git
- Mindestens 4 GB RAM, 8 GB empfohlen, wenn PostgreSQL auf demselben Server läuft. Mehr API-Prozesse benötigen mehr Speicher, siehe [Konfiguration](configuration.md#optional-kapazitat-und-leistung).
- Mindestens 10 GB Festplatte. KANAP selbst belegt etwa 1,5 GB (seine Images), 2 GB mit dem Image der Wartungswerkzeuge. Die Datenbank und die gespeicherten Dateien wachsen mit der Zeit.
- Ausgehender HTTPS-Zugang zu `ghcr.io` bei der Installation und bei jedem Upgrade, um die Images herunterzuladen (siehe [Firewall-Regeln](configuration.md#outbound-installation-and-upgrades)).

**Vom Kunden bereitgestellte Infrastruktur:**

| Komponente | Anforderung |
|-----------|-------------|
| PostgreSQL | Version 16+ mit den Erweiterungen `citext`, `pgcrypto`, `uuid-ossp` und einer dedizierten Anwendungsrolle für `DATABASE_URL` |
| S3-Speicher | Ein beliebiger S3-kompatibler Speicher mit einem Bucket: AWS S3, Cloudflare R2, Hetzner Object Storage, Garage, RustFS, ein vorhandenes MinIO und andere. KANAP benötigt auf diesem Bucket `PutObject`, `GetObject`, `HeadObject`, `DeleteObject`, `ListObjectsV2` und vorsignierte `GET`-Links. |
| Reverse Proxy | TLS-Terminierung und Routing (nginx, Traefik, Caddy usw.) |
| Name und Zertifikat | Ein Name, den Benutzer und Server auflösen, und ein passendes Zertifikat (siehe unten) |

Ein bereits laufendes MinIO funktioniert weiterhin mit KANAP, ohne Änderung. MinIO veröffentlicht keine neuen Downloads oder Images mehr, deshalb verwendet das [Installationsbeispiel](installation-example.md) RustFS.

Optional:

- Konfiguration für ausgehende E-Mails: Resend-API-Schlüssel oder Angaben zu einem SMTP-Relay bzw. -Server
- Microsoft Entra SSO (siehe [Microsoft Entra SSO](sso-entra.md))
- Ein KI-Coding-Agent, der die Installation für Sie ausführt (siehe [KI-gestützte Installation](installation-ai.md))

## Name und Zertifikat

Benutzer öffnen KANAP unter einer HTTPS-Adresse, zum Beispiel `https://kanap.company.com`. Diese Adresse braucht einen Namen, der auf Ihren Server auflöst, und ein Zertifikat, das dazu passt. Drei Fälle decken die meisten Netzwerke ab:

| Fall | Name | Zertifikat |
|------|------|-------------|
| **Öffentlicher Name** | Ein Eintrag im öffentlichen DNS, der auf den Server zeigt (oder auf die Firewall davor) | Von einer öffentlichen Zertifizierungsstelle, zum Beispiel Let's Encrypt mit `certbot`. Port 80 muss aus dem Internet erreichbar sein. |
| **Interner Name** | Ein Eintrag in Ihrem Unternehmens-DNS. Für einen Test eine Zeile in `/etc/hosts` auf dem Server und auf jedem Client. | Von der internen Zertifizierungsstelle Ihres Unternehmens. Die Browser verwalteter Arbeitsplätze vertrauen ihr bereits, Benutzer sehen also keine Warnung. |
| **Selbstsigniert** | Wie beim internen Namen | Auf dem Server erstellt. Nur für Tests: Jeder Browser zeigt eine Warnung, die jeder Benutzer bestätigen muss. |

Viele Installationen haben kein öffentliches DNS. Ein interner Name mit einem internen Zertifikat ist eine normale, unterstützte Einrichtung. Das Zertifikat des Reverse Proxys dient den Browsern. Die API baut auch eigene Verbindungen auf, zu SMTP, PostgreSQL oder S3: Wenn Ihre Zertifizierungsstelle die Zertifikate dieser Server signiert hat, siehe [Zertifikate einer internen Zertifizierungsstelle](configuration.md#optional-zertifikate-einer-internen-zertifizierungsstelle).

**Auch der Server muss den Namen auflösen.** Die Prüfbefehle in diesem Leitfaden und der Smoke-Test laufen auf dem Server und rufen KANAP über seinen Namen auf. Solange kein DNS-Eintrag existiert, tragen Sie den Namen in die hosts-Datei des Servers ein:

```bash
echo "127.0.0.1 kanap.company.com" | sudo tee -a /etc/hosts
```

Ersetzen Sie `kanap.company.com` durch Ihren Namen. Clients brauchen einen eigenen Eintrag (oder den DNS-Eintrag), der auf die Adresse des Servers zeigt.

**Selbstsigniertes Zertifikat (nur für Tests):**

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

Ersetzen Sie `kanap.company.com` durch Ihren Namen. Für einen Zugriff per IP-Adresse verwenden Sie `IP:192.0.2.10` in `subjectAltName` und tragen die IP in `-subj` und in `server_name` ein. Um stattdessen Ihre interne Zertifizierungsstelle zu nutzen, beantragen Sie ein Zertifikat für denselben Namen und lassen `ssl_certificate` und `ssl_certificate_key` in der nginx-Datei auf die erhaltenen Dateien zeigen (die vollständige Kette und den privaten Schlüssel). Sonst ändert sich nichts.

**Let's Encrypt:** `sudo apt-get install -y certbot`, dann `sudo certbot certonly --webroot -w /var/www/html -d kanap.company.com`, während die nginx-Standardseite auf Port 80 antwortet. Die Zertifikatsdateien sind `/etc/letsencrypt/live/kanap.company.com/fullchain.pem` und `privkey.pem`. Das [Installationsbeispiel](installation-example.md#8-nginx-und-tls) zeigt den vollständigen Ablauf einschließlich der Erneuerung.

## Schnellstart

```bash
# 1. KANAP beziehen. Der Branch "stable" zeigt immer auf die neueste veröffentlichte Version.
sudo install -d -o "$USER" -g "$USER" /opt/kanap
git clone https://github.com/kanap-hq/KANAP.git /opt/kanap
cd /opt/kanap
git checkout stable

# 2. Vor dem ersten Start konfigurieren
cp infra/.env.onprem.example .env
chmod 600 .env
nano .env  # DATABASE_URL, S3-Zugangsdaten, ADMIN_EMAIL, ADMIN_PASSWORD, JWT_SECRET setzen,
#          DEFAULT_TENANT_NAME (Name Ihrer Organisation, wird nur beim ersten Start gelesen),
#          APP_BASE_URL und CORS_ORIGINS (die genaue Adresse, die Benutzer öffnen),
#          APP_ENV=production (Benutzer erreichen KANAP über HTTPS) und RATE_LIMIT_TRUST_PROXY=true
# Alle Variablen stehen im Konfigurationsleitfaden

# 3. Die Images dieser Version herunterladen
docker compose -f infra/compose.onprem.yml pull

# 4. Container starten
docker compose -f infra/compose.onprem.yml up -d

# 5. Start überprüfen
docker compose -f infra/compose.onprem.yml logs -f api
# Auf "[entrypoint] Migrations complete" und danach "Nest application successfully started" warten
# Der erste Start legt Mandant, Admin-Benutzer und Abonnement automatisch an
# Mit Strg+C beenden Sie das Verfolgen des Protokolls

# 6. Den Reverse Proxy so konfigurieren, dass er den Verkehr weiterleitet an:
#    - /api/* → 127.0.0.1:8080 (der api-Container)
#    - /.well-known/oauth-* → 127.0.0.1:8080, path kept (MCP connections without a key)
#    - /*     → 127.0.0.1:8081 (der web-Container, Port 80 im Container)
# Der Proxy muss Host beibehalten und X-Forwarded-Proto und X-Forwarded-For setzen.
# Lesen Sie nach dem ersten Start die Zeilen [ENV], [CONFIG], [CORS], [RATE-LIMIT] und [SECURITY] im API-Protokoll.

# 7. Anwendung öffnen
# https://kanap.company.com
# Mit ADMIN_EMAIL / ADMIN_PASSWORD aus .env anmelden
```

**Wichtig:** Schließen Sie die Konfiguration (Schritt 2) ab, bevor Sie die Container starten. Die API liest `.env` beim Start und legt Mandant und Admin-Benutzer beim ersten Start mit diesen Werten an. Die Datei enthält alle Geheimnisse der Installation: `chmod 600` macht sie nur für ihren Eigentümer lesbar.

**Versionen.** KANAP veröffentlicht etwa einmal im Monat eine neue Version (`26.10.1` ist die erste). Der Branch `stable` zeigt immer auf die neueste veröffentlichte Version. Jede Version kommt mit ihren Images in der GitHub Container Registry (`ghcr.io/kanap-hq/kanap-api`, `kanap-web` und `kanap-api-tools`), gebaut aus dem Tag der Version. Sie sind öffentlich: Ein Konto ist nicht nötig. `infra/compose.onprem.yml` nennt die Images der ausgecheckten Version, also bestimmt `git checkout stable` oder `git checkout v26.10.9` die Version, die `pull` herunterlädt. Versionen bis 26.10.7 haben keine veröffentlichten Images: Sie werden auf dem Server gebaut, wie es die Anleitung dieser Version beschreibt. Unter [Betrieb](operations.md#upgrade-verfahren) erfahren Sie, wie Sie aktualisieren, eine bestimmte Version festlegen und zurückkehren. Der Branch `main` enthält jede gemergte Änderung, bevor sie als Version veröffentlicht wird. Sie können ihm folgen, für einen Produktionsserver ist das nicht empfohlen: Sie bauen dann die Images selbst.

**Anforderung an die Datenbankrolle:** `DATABASE_URL` muss eine dedizierte PostgreSQL-Anwendungsrolle verwenden. Lassen Sie sie nicht auf `postgres` oder eine andere Cluster-Admin-Rolle zeigen. KANAP bricht den Start ab, statt ohne wirksame RLS-Durchsetzung zu laufen.

**Adresse und Origins:** Setzen Sie `APP_BASE_URL` und `CORS_ORIGINS` auf die genaue Adresse, die Benutzer öffnen, mit dem Port, wenn er nicht dem Standard entspricht. Jeder Link, den KANAP versendet, stammt aus `APP_BASE_URL`. Setzen Sie `APP_ENV=production`, wenn Benutzer KANAP über HTTPS erreichen: Die API startet dann nicht ohne diese beiden Werte und markiert das Sitzungs-Cookie immer als Secure. Siehe [Konfiguration](configuration.md#erforderlich-admin-zugangsdaten).

**Wahl des E-Mail-Versands:** On-Premise-Bereitstellungen können für ausgehende E-Mails entweder **Resend** oder **SMTP** verwenden. SMTP ist nützlich, wenn der Kunde bereits ein internes Mail-Relay oder einen verwalteten Anbieter wie Microsoft 365 hat. Konfigurieren Sie eine dieser Optionen, wenn Passwortzurücksetzung, Einladungen und Benachrichtigungs-E-Mails vom ersten Tag an funktionieren sollen.

## Die Images selbst bauen { #build-the-images-yourself }

Die veröffentlichten Images passen für die meisten Installationen. Bauen Sie sie auf dem Server für einen Fork, eine lokale Korrektur, einen Server ohne Zugang zu `ghcr.io` oder eine API auf einem anderen Host. Die Datei `infra/compose.onprem.build.yml`, zusätzlich zur Hauptdatei angegeben, baut sie aus dem Checkout und nennt sie `kanap-api:local`, `kanap-web:local` und `kanap-api-tools:local`:

```bash
docker compose -f infra/compose.onprem.yml -f infra/compose.onprem.build.yml build
docker compose -f infra/compose.onprem.yml -f infra/compose.onprem.build.yml up -d
```

Geben Sie bei jedem späteren `up` und `run` beide Dateien an: Mit der Hauptdatei allein startet Compose die veröffentlichten Images. Der Build braucht das Paket `docker-buildx-plugin` und 6 GB RAM auf dem Server. Er lädt npm- und Alpine-Pakete herunter (siehe [Firewall-Regeln](configuration.md#outbound-installation-and-upgrades)). Für eine API auf einem anderen Host geben Sie deren Adresse in der Shell an, wenn Sie das Web-Image bauen: `VITE_API_URL=https://api.company.com docker compose -f infra/compose.onprem.yml -f infra/compose.onprem.build.yml build web`. Compose liest sie nicht aus `.env`.

## Reverse-Proxy-Beispiel (nginx) { #reverse-proxy-example-nginx }

**Anforderungen an den Reverse Proxy:**

1. TLS auf Port 443 terminieren
2. `/api/*` direkt an den API-Container leiten (Port 8080 auf `127.0.0.1`), ohne das Präfix `/api`. Leiten Sie `/api/` nicht über den Web-Container (Port 8081): Seine eigene `/api/`-Route gibt `X-Forwarded-For` nicht weiter, und KANAP würde jede Anfrage unter der Adresse des Web-Containers zählen und protokollieren.
3. Alle anderen Anfragen an den Web-Container leiten (Port 8081 auf `127.0.0.1`)
4. `X-Forwarded-Proto: https` setzen und `Host` beibehalten. KANAP baut jeden versendeten Link aus `APP_BASE_URL`. Das Beispiel sendet außerdem `X-Forwarded-Host` mit demselben Wert wie `Host`. Verwendet die Site einen Nicht-Standard-Port, tragen Sie die genaue Adresse mit Port in `CORS_ORIGINS` ein.
5. `X-Forwarded-For` mit der Client-Adresse senden (das Beispiel tut das) und `RATE_LIMIT_TRUST_PROXY=true` setzen. KANAP verwendet diese Adresse für seine Anmeldelimits. Der API-Port muss an `127.0.0.1` gebunden bleiben, wie es `compose.onprem.yml` tut. Steht nichts vor der API, setzen Sie `RATE_LIMIT_TRUST_PROXY=false`.
6. Anfragen bis 80 MB annehmen (`client_max_body_size 80m`): Das Laden einer Budgetdatei sendet bis zu 72 MB (die Datei, bis zu 48 MB, und das Ergebnis ihrer Prüfung), Anhänge sind bis zu 20 MB groß.
7. `/.well-known/oauth-*` an die API leiten (Port 8080), mit unverändertem Pfad. KI-Assistenten wie Claude lesen diese Adressen, um sich ohne Schlüssel über MCP zu verbinden. Andere `/.well-known/`-Adressen bleiben beim Web-Container. Siehe [KI-Assistenten über MCP verbinden](configuration.md#connecting-ai-assistants-over-mcp).

Da die Container an `127.0.0.1` gebunden sind, läuft nginx auf demselben Host und leitet an `localhost` weiter.

Die Datei ist für nginx ab 1.25.1 geschrieben (Ubuntu 26.04 liefert 1.28). Ubuntu 24.04 liefert nginx 1.24: Schreiben Sie dort `listen 443 ssl http2;` und `listen [::]:443 ssl http2;` und entfernen Sie die Zeile `http2 on;`.

```nginx
server {
    # HTTP/2: Der Browser sendet die Dutzenden Anfragen einer Seite über eine Verbindung.
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name kanap.company.com;

    ssl_certificate     /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;

    # Upload-Limit: Laden von Budgetdateien bis 72 MB, Anhänge bis 20 MB
    client_max_body_size 80m;

    # /api → /api/ vereinheitlichen
    location = /api { return 301 /api/; }

    # API: das Präfix /api vor der Weiterleitung entfernen
    location ^~ /api/ {
        proxy_pass http://127.0.0.1:8080/;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host  $host;

        # JSON- und CSV-Antworten der API komprimieren (eine Seite der Budgetliste schrumpft etwa auf ein Achtel).
        # Gestreamte KI-Antworten (application/x-ndjson) sind bewusst ausgenommen.
        gzip on;
        gzip_proxied any;
        gzip_comp_level 5;
        gzip_min_length 1024;
        gzip_vary on;
        gzip_types application/json text/csv text/plain;

        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Lang laufende Anfragen (Exporte, Importe)
        proxy_read_timeout  300s;
        proxy_send_timeout  300s;
        proxy_redirect off;
    }

    # MCP connections without a key: discovery served by the API, path kept
    # (no trailing slash on proxy_pass). Other /.well-known addresses stay below.
    location ^~ /.well-known/oauth- {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
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

    # Zertifikatserneuerung mit Let's Encrypt (Webroot); sonst unschädlich
    location /.well-known/acme-challenge/ { root /var/www/html; }

    location / { return 301 https://$host$request_uri; }
}
```

**Komprimierung und HTTP/2:** Das Beispiel komprimiert die Antworten der API und aktiviert HTTP/2. Behalten Sie beides in Ihrem eigenen Proxy bei: Eine Seite der Budgetliste umfasst unkomprimiert etwa 390 KB JSON, komprimiert 47 KB. Hat Ihr nginx das Brotli-Modul (`libnginx-mod-http-brotli-filter` unter Debian und Ubuntu), komprimiert `brotli on; brotli_types application/json text/csv text/plain;` im selben `location` etwas besser; gzip genügt.

**`host.docker.internal`:** Wenn PostgreSQL oder der S3-Speicher direkt auf dem Docker-Host läuft (nicht in einem Container), verwenden Sie `host.docker.internal` als Hostnamen in `DATABASE_URL` und `S3_ENDPOINT`. Die Datei `compose.onprem.yml` enthält die `extra_hosts`-Zuordnung, die das ermöglicht. Sie zeigt auf die Docker-Bridge-Adresse des Servers (standardmäßig `172.17.0.1`), die Dienste auf dem Host müssen also Verbindungen aus diesem Netzwerk annehmen (siehe [Installationsbeispiel](installation-example.md)).

**Health.** Die API antwortet auf `GET /health` an ihrem eigenen Port (`http://127.0.0.1:8080/health`) und auf `GET /api/health` über den Proxy. Beide liefern `{"status":"ok","text_processing":"ready"}`. [Monitoring](operations.md#monitoring) erklärt die anderen Werte von `text_processing`. `docker compose -f infra/compose.onprem.yml ps` zeigt `healthy` für die Container `api` und `web`, sobald sie antworten.

## Netzwerkarchitektur

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

**Bereitstellungsmodell:** ein API-Container und ein Web-Container. Mehrere API- oder Web-Container werden nicht unterstützt. Für mehr gleichzeitige Benutzer führen Sie mit `API_WORKERS` mehrere API-Prozesse im API-Container aus (siehe [Konfiguration](configuration.md#optional-kapazitat-und-leistung)). Für Hochverfügbarkeit verlassen Sie sich auf die Neustart-Richtlinien von Docker und auf Redundanz in der Infrastruktur (Datenbank-HA, S3-Haltbarkeit).

## Erste Anmeldung

1. Öffnen Sie `https://<your-name>`
2. Melden Sie sich mit `ADMIN_EMAIL` und `ADMIN_PASSWORD` aus `.env` an
3. **Ändern Sie das Admin-Passwort** in Ihrem Profil, wenn Sie mit einem Wert gestartet sind, den Sie nicht behalten möchten. Die `[SECURITY]`-Warnung im API-Protokoll verschwindet, sobald das Passwort geändert ist (siehe unten).
4. Fügen Sie unter **Administration → Branding** Ihr Logo und Ihre Farben hinzu (optional)
5. Laden Sie weitere Benutzer ein (wenn E-Mail konfiguriert ist)

**Zum Administratorkonto.** KANAP legt es beim ersten Start aus `ADMIN_EMAIL` und `ADMIN_PASSWORD` an, und nur dann. Spätere Änderungen an diesen beiden Zeilen bewirken nichts, solange ein aktiver Administrator existiert: Ändern Sie das Passwort in der Anwendung. Bleibt kein aktiver Administrator übrig, stellt der nächste Start das Konto `ADMIN_EMAIL` als aktivierten Administrator wieder her und behält sein bestehendes Passwort. `ADMIN_PASSWORD` muss ein eigener Wert mit mindestens 12 Zeichen sein: `openssl rand -base64 18` erzeugt einen. Ein Beispielwert oder ein kürzerer Wert lässt die API bei jedem Start eine `[SECURITY]`-Warnung ausgeben, bis das Passwort des Kontos geändert ist. Siehe [Konfiguration](configuration.md#erforderlich-admin-zugangsdaten).

## Optional: Datenzugriff nach Bereich { #optional-data-scoped-access }

Der [Datenzugriff](../data-access.md) begrenzt eine Person auf einen Teil des Budgets und der Verträge, nach Unternehmen oder nach Kostenstelle. Ohne diesen Schritt arbeiten alle mit allen Daten, wie in früheren Versionen, und **Begrenzt auf** bleibt im Benutzerfenster ausgegraut. Überspringen Sie ihn, wenn niemand begrenzt werden muss.

Der Schritt legt eine PostgreSQL-Rolle an, `kanap_data_limited`, die KANAP für die Anfragen begrenzter Personen annimmt. Er erfolgt einmal pro PostgreSQL-Server, durch einen Superuser oder eine Rolle mit `CREATEROLE`. Er gibt der Anwendungsrolle das Recht, diese Rolle anzunehmen, ohne ihre Rechte zu erben. KANAP setzt danach die Rechte und Zugriffsregeln dieser Rolle in seiner Datenbank selbst, bei jedem Start und jedem Upgrade.

**1. Führen Sie das Skript aus.** Es liegt im Repository. Übergeben Sie die Anwendungsrolle aus `DATABASE_URL` als `app_role`. Mit dem [Installationsbeispiel](installation-example.md) (Rolle und Datenbank `kanap`, PostgreSQL auf dem Server):

```bash
cd /opt/kanap
sudo -u postgres psql -X -v ON_ERROR_STOP=1 -v app_role=kanap -v mode=install \
  -f /opt/kanap/infra/scripts/data-access-role.sql -d kanap
```

Bei einem verwalteten PostgreSQL-Dienst führen Sie denselben `psql`-Befehl mit dem Administratorkonto des Dienstes aus, von einem Rechner, der die Datenbank erreicht.

Das Skript endet mit einer Tabelle `data-access-role: final state`. Unter PostgreSQL 16 und neuer zeigt sie `limited_role_exists` = `t`, `app_is_member` = `t`, `membership_inherit` = `false`, `membership_set` = `true` und `app_inherits_limited` = `f`. Ein erneuter Lauf ändert nichts.

Unter PostgreSQL 15 sorgt das Skript außerdem dafür, dass die Anwendungsrolle die Rechte anderer Rollen nicht mehr erbt, und es muss auf jeder Datenbank laufen, die dieser Rolle gehört. Der Kopf des Skripts erklärt das und enthält die passende Schleife.

**2. Starten Sie die API neu,** zu einer ruhigen Zeit: Bei ihrem Start setzt sie die Rechte und Zugriffsregeln der Rolle.

```bash
cd /opt/kanap
docker compose -f infra/compose.onprem.yml restart api
docker compose -f infra/compose.onprem.yml logs api | grep DATA-ACCESS
```

Das Protokoll zeigt `[DATA-ACCESS] data-scoped access available`. Listet es stattdessen auf, was fehlt, lesen Sie die Zeilen davor. Hat die API zu lange auf eine belegte Tabelle gewartet, meldet sie das und versucht es beim nächsten Start erneut: Starten Sie sie etwas später noch einmal neu.

**Die Funktion entfernen.** Geben Sie den begrenzten Personen zuerst **Alle Daten** zurück (**Administration > Datenzugriff** listet sie auf): Solange die Rolle fehlt, werden sie abgewiesen. Führen Sie dann das Skript mit `mode=uninstall` als Superuser aus und starten Sie die API neu:

```bash
cd /opt/kanap
sudo -u postgres psql -X -v ON_ERROR_STOP=1 -v app_role=kanap -v mode=uninstall \
  -f /opt/kanap/infra/scripts/data-access-role.sql -d kanap
docker compose -f infra/compose.onprem.yml restart api
```

Das Skript entfernt die Rechte und Zugriffsregeln der Rolle in der Datenbank, dann die Rolle selbst. Halten andere Datenbanken des Servers noch etwas für die Rolle, nennt es sie: Führen Sie es auf jeder davon aus.

Eine Wiederherstellung der Datenbank kann den Schritt erneut erfordern: siehe [Wiederherstellen](operations.md#wiederherstellen).
