# On-Premise-Konfiguration

Dieser Leitfaden behandelt erforderliche und optionale Umgebungsvariablen für On-Premise-Bereitstellungen.
Eine vollständige Vorlage ist unter `infra/.env.onprem.example` verfügbar.

## Erforderlich: Bereitstellungsmodus

| Variable | Beschreibung | Beispiel |
|----------|--------------|---------|
| `DEPLOYMENT_MODE` | **Muss `single-tenant` sein** für On-Premise-Bereitstellungen | `single-tenant` |

## Optional: Mandantenidentität

| Variable              | Erforderlich | Standard          | Beschreibung                                                     |
| --------------------- | ------------ | ----------------- | --------------------------------------------------------------- |
| `DEFAULT_TENANT_SLUG` | Nein         | `default`         | Interne Kennung für den Mandanten (URL-sicher, Kleinbuchstaben) |
| `DEFAULT_TENANT_NAME` | Nein         | `My Organization` | Name Ihrer Organisation, angezeigt im UI-Header und in Berichten |

Beim ersten Start erstellt KANAP automatisch einen Mandanten mit diesen Werten. Die Standardwerte funktionieren für die meisten Bereitstellungen -- Sie müssen sie nur ändern, wenn ein bestimmter Organisationsname in der Anwendung erscheinen soll. Eine neue Installation erhält außerdem den IFRS-Standard-Kontenplan, festgelegt als Standard-Kontenplan und Konsolidierungskontenplan (das Update einer bestehenden Installation fügt ihn nicht hinzu).

## Erforderlich: Admin-Zugangsdaten

| Variable | Beschreibung | Beispiel |
|----------|--------------|---------|
| `ADMIN_EMAIL` | E-Mail des initialen Admin-Benutzers | `admin@firma.de` |
| `ADMIN_PASSWORD` | Initiales Admin-Passwort (**nach der ersten Anmeldung ändern!**) | `AendernSie123!` |
| `JWT_SECRET` | JWT-Signaturschlüssel (generieren: `openssl rand -hex 32`) | 64 Hex-Zeichen |
| `APP_BASE_URL` | Die genaue Adresse, unter der Benutzer KANAP öffnen: Schema, Host und Port, wenn er nicht dem Standard entspricht (Grundlage aller Links, die KANAP versendet) | `https://kanap.company.com` |
| `CORS_ORIGINS` | Die genaue Adresse, unter der Benutzer KANAP öffnen, bei mehreren durch Kommas getrennt (Browser-Origins, die die API aufrufen dürfen) | `https://kanap.company.com` |

**Anwendungsadresse (`APP_BASE_URL`):** E-Mails zum Zurücksetzen des Passworts und Einladungs-E-Mails, Benachrichtigungs-E-Mails, die Weiterleitung bei der Microsoft-Entra-Anmeldung und die Links in Exporten gehen alle von `APP_BASE_URL` aus. Schreiben Sie die Adresse genau so, wie Benutzer sie eingeben, mit dem Port, wenn er nicht 443 für HTTPS oder 80 für HTTP ist (zum Beispiel `https://kanap.company.com:8443`). KANAP liest die Header `Host` oder `X-Forwarded-Host` einer Anfrage nicht, um diese Links zu erstellen, außer auf einem lokalen Entwicklungsrechner (`APP_ENV=development`). Ohne `APP_BASE_URL`:

- antworten das Zurücksetzen des Passworts, die Einladung und die Microsoft-Entra-Anmeldung mit „application URL is not configured: set APP_BASE_URL“;
- werden die geplanten Erinnerungen übersprungen, mit einer Zeile im API-Protokoll.

**Erlaubte Browser-Origins (`CORS_ORIGINS`):** `CORS_ORIGINS` legt fest, welche Webadressen die API aus einem Browser aufrufen dürfen. Tragen Sie die genaue Adresse ein: Schema, Host und Port, wenn er nicht dem Standard entspricht.

```bash
# Dieselbe Adresse wie APP_BASE_URL
CORS_ORIGINS=https://kanap.company.com
```

KANAP akzeptiert außerdem, ohne Eintrag in `CORS_ORIGINS`:

- die Anwendungsadresse (`APP_BASE_URL`);
- die Adresse der Anfrage selbst: Host und Port der Browser-Adresse entsprechen dem `Host`-Header, der KANAP erreicht. Leitet Ihr Reverse Proxy `Host` ohne Port weiter, gilt derselbe Hostname auf jedem Port, außer bei `APP_ENV=production`. Tragen Sie in der Produktion die genaue Adresse mit Port in `CORS_ORIGINS` ein.

Eine Anfrage von einer anderen Adresse erhält die Antwort 403, und die API protokolliert pro Adresse und Minute eine Zeile `[CORS] Rejected origin`. Anfragen zur Sitzungserneuerung und zur Abmeldung folgen derselben Regel: Eine Erneuerung oder Abmeldung von einer nicht erlaubten Adresse wird mit 403 abgelehnt.

Ein Muster wie `https://*.company.com` funktioniert bei einer Single-Tenant-Installation weiterhin. Die API gibt beim Start eine Warnung aus, und eine spätere Version akzeptiert nur noch genaue Adressen. Ersetzen Sie Muster jetzt durch die genaue Adresse.

Fehlen sowohl `CORS_ORIGINS` als auch die Anwendungsadresse (`APP_BASE_URL`) und ist `APP_ENV` nicht gesetzt, bleiben in dieser Version alle Origins erlaubt, und die API gibt beim Start eine Warnung aus. Eine spätere Version verlangt beides.

## Optional: Ausführungsmodus (`APP_ENV`)

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `APP_ENV` | Ausführungsmodus der API: `production`, `development` oder nicht gesetzt | *nicht gesetzt* |

`APP_ENV` kennt drei Zustände:

| Zustand | Werte | Was sich ändert |
|---------|-------|-----------------|
| Produktion | `production`, `prod` | Die API startet nicht ohne `APP_BASE_URL` und `CORS_ORIGINS`. Das Sitzungs-Cookie ist immer als Secure markiert und funktioniert daher nur über HTTPS. |
| Entwicklung | `development`, `dev`, `local`, `test` | Komfort für den Entwicklungsrechner: Links können einem lokalen Entwicklungs-Host folgen, alle Origins sind erlaubt, wenn `CORS_ORIGINS` leer ist, und `PLATFORM_ADMIN_EMAILS=*` wird akzeptiert. Verwenden Sie diesen Modus nicht auf einem Server. |
| Nicht festgelegt | jeder andere Wert oder kein `APP_ENV` | Dieselben Link- und Origin-Regeln wie in der Produktion. Ein fehlendes `APP_BASE_URL` oder `CORS_ORIGINS` erzeugt eine Startwarnung, und die API startet trotzdem. Das Sitzungs-Cookie folgt der Anfrage: Secure, wenn die Anfrage über HTTPS eintrifft. |

Setzen Sie `APP_ENV=production` nur, wenn Benutzer KANAP über HTTPS erreichen. Ist `NODE_ENV` gesetzt und `APP_ENV` nicht, liest KANAP `NODE_ENV`.

**Startvalidierung:** Die Anwendung startet nicht, wenn `JWT_SECRET` oder `DATABASE_URL` fehlt oder leer ist und, mit `APP_ENV=production`, wenn `APP_BASE_URL` oder `CORS_ORIGINS` fehlt. Sie verweigert außerdem den Betrieb, wenn die PostgreSQL-Rolle aus `DATABASE_URL` noch `SUPERUSER` oder `BYPASSRLS` ist.

**Startmeldungen:** Das API-Protokoll zeigt diese Zeilen beim Start. Lesen Sie sie nach jeder Änderung der `.env`-Datei.

| Zeile | Bedeutung |
|-------|-----------|
| `[ENV] run mode: ...` | Wird immer ausgegeben. Zeigt den Modus, in dem die API läuft: `development`, `production` oder `unspecified`. |
| `[ENV] APP_ENV is not set: production rules apply to links, browser origins and platform administration. Set APP_ENV=production (or development on a workstation).` | Wird im nicht festgelegten Modus ausgegeben (die Meldung zeigt den Wert, wenn `APP_ENV` einen anderen Wert hat). Setzen Sie `APP_ENV=production`, wenn Benutzer KANAP über HTTPS erreichen. |
| `[CONFIG] APP_BASE_URL is not set: ...` | E-Mails zum Zurücksetzen des Passworts und Einladungs-E-Mails, Benachrichtigungs-Links und Anmelde-Weiterleitungen werden abgelehnt. Setzen Sie `APP_BASE_URL`. |
| `[CONFIG] APP_BASE_URL is not a valid http(s) address: ...` | Der Wert ist keine Webadresse. Schreiben Sie ihn mit `https://` oder `http://`. |
| `[CORS] CORS_ORIGINS is not set: browsers are allowed only from APP_BASE_URL and from the address of each request. ...` | Setzen Sie `CORS_ORIGINS` auf die genaue Adresse, die Benutzer öffnen. |
| `[CORS] CORS_ORIGINS and APP_BASE_URL are not set: browsers are still allowed from every origin in this version; ...` | Setzen Sie beide. Eine spätere Version erlaubt nur noch die konfigurierten Adressen. |
| `[CORS] CORS_ORIGINS entry ... is a pattern: it is still accepted in this version. ...` | Ersetzen Sie das Muster durch die genaue Adresse. |

## Upgrade: Anwendungsadresse und erlaubte Origins

Diese Version ändert, wie KANAP Links erstellt und welche Browser-Origins es akzeptiert. Prüfen Sie vor dem Upgrade Ihre `.env`-Datei:

1. Setzen Sie `APP_BASE_URL` auf die genaue Adresse, die Benutzer öffnen (Schema, Host und Port, wenn er nicht dem Standard entspricht). Sie ist die einzige Quelle der Links in E-Mails, Anmelde-Weiterleitungen und Exporten. Die Anfrage-Header ändern sie nicht mehr. Ohne sie funktionieren das Zurücksetzen des Passworts, die Einladung und die Microsoft-Entra-Anmeldung nicht mehr, und geplante Erinnerungen werden übersprungen.
2. Tragen Sie diese genaue Adresse anstelle eines Musters in `CORS_ORIGINS` ein. Behält Ihr Proxy den `Host`-Header nicht bei oder verwendet die Adresse einen nicht standardmäßigen Port, ist die genaue Origin mit Port unerlässlich.
3. Setzen Sie `APP_ENV=production` nur, wenn Benutzer KANAP über HTTPS erreichen. Das Sitzungs-Cookie trägt dann immer das Attribut Secure, und die API startet nicht ohne `APP_BASE_URL` und `CORS_ORIGINS`.
4. Lesen Sie nach dem Upgrade die Zeilen `[ENV]`, `[CONFIG]` und `[CORS]` im API-Protokoll und beheben Sie jede Warnung.
5. Anfragen zur Sitzungserneuerung und zur Abmeldung von einer nicht erlaubten Adresse erhalten jetzt 403, und `PLATFORM_ADMIN_EMAILS=*` wird nur akzeptiert, wenn `APP_ENV` ein Entwicklungswert ist.

Weitere sichtbare Änderungen:

- Beginnt `APP_BASE_URL` mit `app.`, verwenden die Microsoft-Entra-Anmeldung und die Wissensbasis-Links die Adresse genau wie konfiguriert.
- Ohne `CORS_ORIGINS` und ohne Anwendungsadresse und bei nicht gesetztem `APP_ENV` ändert sich noch nichts: Alle Origins bleiben erlaubt, und die API gibt eine Warnung aus.
- Ohne `CORS_ORIGINS`, aber mit Anwendungsadresse, sind außerhalb der Entwicklung nur die Anwendungsadresse und die Adresse der Anfrage erlaubt (vorher: alle Origins).
- Die Test-E-Mail der wöchentlichen Zusammenfassung liefert einen Fehler, wenn keine Anwendungsadresse konfiguriert ist.

## Erforderlich: Datenbank

| Variable | Beschreibung | Beispiel |
|----------|--------------|---------|
| `DATABASE_URL` | PostgreSQL-Verbindungsstring | `postgres://user:pass@host:5432/kanap?sslmode=require` |

**Datenbankanforderungen:**
- PostgreSQL 16 oder höher (getestetes Minimum; ältere Versionen können funktionieren, werden aber nicht unterstützt)
- Erweiterungen: `citext`, `pgcrypto`, `uuid-ossp`
- Benutzer benötigt CREATE TABLE / ALTER TABLE-Berechtigungen für Migrationen
- Empfohlen: Dedizierte Datenbank
- `DATABASE_URL` muss eine dedizierte Anwendungsrolle verwenden, nicht `postgres` oder eine andere Cluster-Admin-Rolle
- Empfohlen: App-Rolle von Anfang an als `NOSUPERUSER NOBYPASSRLS` erstellen

**Datenbankeinrichtung (Beispiel):**

```sql
-- 1. Datenbank und dedizierte App-Rolle erstellen
CREATE DATABASE kanap;
CREATE USER kanap WITH PASSWORD 'sicheres-passwort' NOSUPERUSER NOBYPASSRLS;
GRANT ALL PRIVILEGES ON DATABASE kanap TO kanap;

-- 2. Mit kanap-Datenbank verbinden und Erweiterungen aktivieren
\c kanap
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 3. Schema-Berechtigungen vergeben (für Migrationen)
GRANT ALL ON SCHEMA public TO kanap;
```

Wenn eine dedizierte Anwendungsrolle anfangs mit zu vielen Rechten erstellt wurde, wird KANAPs erste Migration sie automatisch auf `NOSUPERUSER NOBYPASSRLS` härten. Wenn `DATABASE_URL` auf eine geschützte Cluster-Admin-Rolle wie `postgres` zeigt, schlägt der Start fehl und Sie müssen auf eine dedizierte App-Rolle wechseln.

## Erforderlich: Speicher

| Variable | Beschreibung | Beispiel |
|----------|--------------|---------|
| `S3_ENDPOINT` | S3-kompatibler Endpunkt | `https://s3.amazonaws.com` |
| `S3_BUCKET` | Bucket-Name (muss existieren) | `kanap-files` |
| `S3_REGION` | Region | `us-east-1` |
| `AWS_ACCESS_KEY_ID` | Zugriffsschlüssel | `AKIA...` |
| `AWS_SECRET_ACCESS_KEY` | Geheimschlüssel | `secret` |
| `S3_FORCE_PATH_STYLE` | `true` für MinIO, `false` für AWS/R2 | `false` |

**Bucket-Anforderungen:**
- Erstellen Sie den Bucket vor dem Start von KANAP (wird nicht automatisch erstellt)
- Berechtigungen: `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`, `s3:ListBucket`

KANAP verwendet den AWS SDK v3 S3-Client für den Objektspeicherzugriff; jeder Anbieter mit S3-kompatiblem API-Verhalten wird unterstützt.

**Getestete Anbieter:**
- AWS S3 (`S3_ENDPOINT=https://s3.amazonaws.com`, `S3_FORCE_PATH_STYLE=false`)
- MinIO (`S3_ENDPOINT=http://minio:9000`, `S3_FORCE_PATH_STYLE=true`)
- Cloudflare R2 (`https://<account>.r2.cloudflarestorage.com`)
- Hetzner (`https://<region>.your-objectstorage.com`)

## Optional: E-Mail über Resend

| Variable | Beschreibung | Beispiel |
|----------|--------------|---------|
| `RESEND_API_KEY` | Resend API-Schlüssel | `re_xxxxx` |
| `RESEND_FROM_EMAIL` | Absenderadresse | `KANAP <noreply@ihredomain.de>` |

Wenn nicht konfiguriert, kann KANAP in Single-Tenant-Bereitstellungen dennoch E-Mail über SMTP senden. Wenn weder Resend noch SMTP konfiguriert ist, sind E-Mail-Funktionen deaktiviert, einschließlich Benutzereinladungen und Passwortzurücksetzung. Siehe Betrieb für SQL-Passwortzurücksetzungs-Fallback.

## Optional: E-Mail über SMTP (nur Single-Tenant / On-Premise)

SMTP wird nur im Modus `DEPLOYMENT_MODE=single-tenant` unterstützt. Multi-Tenant/Cloud-Bereitstellungen verwenden weiterhin Resend.

| Variable        | Beschreibung                          | Beispiel                       |
| --------------- | ------------------------------------- | ------------------------------ |
| `SMTP_HOST`     | SMTP-Server-Hostname                  | `smtp.firma.de`                |
| `SMTP_PORT`     | SMTP-Port                             | `587`                          |
| `SMTP_USER`     | SMTP-Benutzername                     | `kanap`                        |
| `SMTP_PASSWORD` | SMTP-Passwort                         | `secret`                       |
| `SMTP_FROM`     | Absenderadresse                       | `KANAP <noreply@firma.de>`     |
| `SMTP_SECURE`   | `true` für implizites TLS (465), `false` für STARTTLS/Plain (587/25) | `false` |

Hinweise:
- `SMTP_USER` und `SMTP_PASSWORD` sind optional. Lassen Sie beide ungesetzt für Relays, die dem Quellhost/der Quell-IP vertrauen.
- Wenn `SMTP_SECURE` nicht gesetzt ist, verwendet KANAP standardmäßig `true` für Port `465` und `false` andernfalls.
- Wenn sowohl SMTP als auch Resend im Single-Tenant-Modus konfiguriert sind, hat SMTP Vorrang.
- `SMTP_FROM` sollte eine Adresse sein, als die Ihr SMTP-Server senden darf.
- Wenn E-Mail außerhalb Ihres Netzwerks gesendet wird, konfigurieren Sie SPF, DKIM und DMARC auf der Absenderdomain über Ihren Mail-Administrator oder Provider.

**Gängige SMTP-Profile**

Internes Relay ohne Authentifizierung:

```env
SMTP_HOST=mail.firma.local
SMTP_PORT=25
SMTP_SECURE=false
SMTP_FROM=KANAP <noreply@firma.de>
```

Authentifiziertes Relay oder Provider:

```env
SMTP_HOST=smtp.firma.de
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=noreply@firma.de
SMTP_PASSWORD=secret
SMTP_FROM=KANAP <noreply@firma.de>
```

Microsoft 365 SMTP-Übermittlung:

```env
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=noreply@firma.de
SMTP_PASSWORD=secret
SMTP_FROM=KANAP <noreply@firma.de>
```

Verwenden Sie das Microsoft 365-Profil nur, wenn SMTP AUTH für das Postfach und den Mandanten erlaubt ist.

## Optional: Entra SSO

Siehe den dedizierten Leitfaden: [Microsoft Entra SSO](sso-entra.md).

Er behandelt die App-Registrierung, die delegierten Berechtigungen und die Anwendungsberechtigung sowie die tägliche Verzeichnissynchronisierung, die Benutzerattribute aktualisiert und Konten deaktiviert, die aus dem Verzeichnis entfernt wurden. Die API benötigt ausgehenden Zugriff auf `login.microsoftonline.com` und `graph.microsoft.com`.

## Optional: Erweitert

| Variable | Beschreibung | Standard |
|----------|--------------|---------|
| `LOG_LEVEL` | Protokollierungsausführlichkeit (`debug`, `info`, `warn`, `error`) | `info` |
| `JWT_ACCESS_TOKEN_TTL` | Zugriffstoken-Lebensdauer | `15m` |
| `JWT_REFRESH_TOKEN_TTL` | Aktualisierungstoken-Lebensdauer | `4h` |
| `RATE_LIMIT_ENABLED` | App-Level Rate-Limiting-Schalter | `true` |
| `RATE_LIMIT_TRUST_PROXY` | Proxy-Header für Client-IP-Erkennung vertrauen | `false` |
| `APP_URL` | Nur Multi-Tenant (Cloud): dritte Quelle der Anwendungsadresse, nach `APP_BASE_URL` und `PUBLIC_APP_URL` (der Mandanten-Slug ersetzt `app`). **Nicht benötigt für On-Premise**: `APP_BASE_URL` wird verwendet. | *nicht gesetzt* |
| `EMAIL_OVERRIDE` | Alle E-Mails an diese Adresse umleiten (nur Dev/QA, **nie in Produktion**) | *nicht gesetzt* |

## Optional: Kapazität und Leistung

Die Standardwerte reichen für einige Dutzend Benutzer. Für mehr gleichzeitige Benutzer führen Sie mehrere API-Prozesse aus und dimensionieren die Datenbankverbindungen.

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `API_WORKERS` | Anzahl der API-Prozesse im API-Container (1 bis 16). Bei mehr als einem lässt eine rechnende Anfrage nicht mehr alle anderen warten. | `1` |
| `DB_POOL_MAX` | Datenbankverbindungen pro API-Prozess (mindestens 2: ein niedrigerer Wert wird auf 2 angehoben) | `20` |
| `SHUTDOWN_DRAIN_TIMEOUT_MS` | Bei Stopp oder Upgrade: wie lange die API laufenden Anfragen, den davon ausgelösten Benachrichtigungen, laufenden Hintergrundjobs und wartenden E-Mails Zeit zum Abschluss lässt (Millisekunden, höchstens 120000). Der Container wird in jedem Fall nach 30 s gestoppt. | `20000` |
| `OPS_METRICS_TOKEN` | Aktiviert `GET /api/ops/metrics` für Ihr Monitoring-Tool (24 Zeichen oder mehr, zum Beispiel `openssl rand -hex 32`; ein kürzerer Wert lässt es deaktiviert, und die API meldet dies beim Start). Siehe [Betrieb](operations.md#api-metriken-fur-ein-monitoring-tool). | *nicht gesetzt (deaktiviert)* |

**Was jedes kostet.** Jeder API-Prozess benötigt beim Start etwa 200 MB Speicher und unter Last bis zu 300 MB (gemessen mit 50 Benutzern auf 5.000 Budgetzeilen); bei mehreren Prozessen kommt ein kleiner überwachender Prozess mit etwa 100 MB hinzu. Jeder API-Prozess kann bis zu `DB_POOL_MAX` Verbindungen zu PostgreSQL öffnen. Zur Berechnung:

- Speicher: `API_WORKERS` × 0,4 GB für die API, plus was PostgreSQL verbraucht, wenn es auf demselben Server läuft, plus etwa 1 GB Spielraum (Image-Builds brauchen ihn bei Upgrades);
- Verbindungen: `API_WORKERS` × `DB_POOL_MAX` muss unter `max_connections` von PostgreSQL (standardmäßig 100) minus etwa 15 bleiben. Die API prüft dies beim Start und schreibt eine Warnung ins Protokoll, wenn es nicht passt, mit einem Wert, der passen würde.

**Empfohlene Werte.**

| Gleichzeitig arbeitende Benutzer | `API_WORKERS` | `DB_POOL_MAX` | Serverspeicher (API + PostgreSQL) |
|---|---|---|---|
| Bis zu 20 | 1 | 20 | 4 GB |
| 20 bis 50 | 2 | 15 | 8 GB |
| 50 und mehr | 4 | 10 | 8 bis 16 GB |

Gemessen auf 5.000 Budgetzeilen: Bei 10 Benutzern antwortet ein Prozess so schnell wie vier. Bei 50 Benutzern dauerte das Öffnen einer Zeile 237 ms (95. Perzentil) mit einem Prozess, 142 ms mit zwei und 82 ms mit vier, und der einzelne Prozess hielt alle seine Datenbankverbindungen ausgelastet.

Halten Sie `API_WORKERS` bei oder unter der Anzahl der CPU-Kerne, die der Server KANAP gibt. Änderungen wirken sich beim Neustart des API-Containers aus (`docker compose -f infra/compose.onprem.yml up -d api`).

## Vollständiges Beispiel (.env)

```bash
# =============================================================================
# KANAP On-Premise-Konfiguration
# =============================================================================

# BEREITSTELLUNGSMODUS (erforderlich)
DEPLOYMENT_MODE=single-tenant

# MANDANTENKONFIGURATION (optional - Standardwerte gezeigt)
DEFAULT_TENANT_SLUG=default
DEFAULT_TENANT_NAME=Meine Organisation

# ADMIN-ZUGANGSDATEN (erforderlich)
ADMIN_EMAIL=admin@firma.de
ADMIN_PASSWORD=AendernSieDiesesPasswort123!

# SICHERHEIT (erforderlich)
JWT_SECRET=

# AUSFÜHRUNGSMODUS (optional - production, sobald Benutzer KANAP über HTTPS erreichen)
# APP_ENV=production

# ANWENDUNGS-URL (erforderlich - die genaue Adresse, die Benutzer öffnen)
APP_BASE_URL=https://kanap.ihre-domain.de

# ERLAUBTE BROWSER-ORIGINS (erforderlich - die genaue Adresse, die Benutzer öffnen)
CORS_ORIGINS=https://kanap.ihre-domain.de

# DATENBANK (erforderlich - dedizierte App-Rolle verwenden, nie postgres)
DATABASE_URL=postgres://kanap:passwort@ihr-postgres:5432/kanap?sslmode=require

# SPEICHER (erforderlich)
S3_ENDPOINT=https://s3.amazonaws.com
S3_BUCKET=kanap-files
S3_REGION=us-east-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
S3_FORCE_PATH_STYLE=false   # true für MinIO

# E-MAIL (optional - Resend)
# RESEND_API_KEY=re_xxxxx
# RESEND_FROM_EMAIL=KANAP <noreply@ihredomain.de>

# E-MAIL (optional - SMTP, nur Single-Tenant)
# SMTP_HOST=smtp.firma.de
# SMTP_PORT=587
# SMTP_SECURE=false
# SMTP_USER=
# SMTP_PASSWORD=
# SMTP_FROM=KANAP <noreply@firma.de>

# ERWEITERT (optional - Standardwerte sind in Ordnung)
# LOG_LEVEL=info
# JWT_ACCESS_TOKEN_TTL=15m
# JWT_REFRESH_TOKEN_TTL=4h
# RATE_LIMIT_ENABLED=true
# RATE_LIMIT_TRUST_PROXY=false

# KAPAZITÄT (optional - siehe „Kapazität und Leistung“)
# API_WORKERS=1
# DB_POOL_MAX=20
# SHUTDOWN_DRAIN_TIMEOUT_MS=20000
# OPS_METRICS_TOKEN=
```

## Firewall-Regeln

Nach dem initialen Build kann KANAP vollständig isoliert (Air-Gapped) betrieben werden, wenn E-Mail-, SSO- und FX-Kurs-Funktionen alle deaktiviert sind.

### Eingehend

| Port | Protokoll | Zweck |
|------|-----------|-------|
| 443 | TCP | HTTPS -- nginx Reverse Proxy, der die Anwendung ausliefert |
| 80 | TCP | HTTP -- leitet auf HTTPS um |

### Ausgehend -- Ersteinrichtung & Build

Diese Ziele werden nur während der Installation und `docker build` benötigt. Sie können geschlossen werden, sobald die Anwendung läuft.

| Ziel | Port | Zweck |
|------|------|-------|
| `github.com` | 443 | KANAP-Quellcode klonen |
| `download.docker.com` | 443 | Docker APT-Repository |
| `dl.min.io` | 443 | MinIO-Binary-Download |
| `registry.npmjs.org` | 443 | npm-Abhängigkeiten während `docker build` |
| `registry-1.docker.io`, `production.cloudflare.docker.com` | 443 | Basis-Docker-Images pullen (`node:22-alpine`, `nginx:alpine`) |
| Ubuntu APT-Mirrors | 80/443 | Systempakete (PostgreSQL, nginx usw.) |

### Ausgehend -- Laufzeit (Bedingt)

Nur erforderlich, wenn die entsprechende Funktion aktiviert ist.

| Ziel | Port | Zweck | Wann |
|------|------|-------|------|
| `api.resend.com` | 443 | Transaktions-E-Mail | Wenn `RESEND_API_KEY` gesetzt ist |
| Ihr SMTP-Relay oder Provider | 25 / 465 / 587 | Transaktions-E-Mail über SMTP | Wenn `SMTP_HOST` gesetzt ist |
| `login.microsoftonline.com` | 443 | Entra ID SSO-Metadaten & Tokens | Wenn Entra SSO konfiguriert ist |
| `graph.microsoft.com` | 443 | Profilanreicherung bei der Anmeldung und tägliche Verzeichnissynchronisierung | Wenn Entra SSO konfiguriert ist |
| `api.worldbank.org` | 443 | Jährliche FX-Kurse | Optional |
| `open.er-api.com` | 443 | Kassakurse | Optional |

### Intern (Keine Firewall-Regel nötig)

Diese Verbindungen bleiben auf dem Server -- Loopback oder Docker-Bridge-Netzwerk.

| Verbindung | Port | Hinweise |
|------------|------|----------|
| nginx → API-Container | 8080 | Gebunden an `127.0.0.1` |
| nginx → Web-Container | 8081 | Gebunden an `127.0.0.1` |
| API-Container → PostgreSQL | 5432 | Über `host.docker.internal` (Docker-Bridge `172.16.0.0/12`) |
| API-Container → MinIO | 9000 | Über `host.docker.internal` |
| MinIO-Konsole | 9001 | Nur lokale Administration, nicht extern exponiert |

## Hintergrundjobs

Das Backend führt geplante Hintergrundjobs für E-Mail-Benachrichtigungen aus:
- **Ablaufwarnungen**: täglich um 08:00 UTC. Sendet den Verantwortlichen von Verträgen und OPEX-Positionen 30, 14, 7 und 1 Tag(e) vor der Kündigungsfrist eines Vertrags, dem Enddatum eines Vertrags oder dem Ende der Gültigkeit einer OPEX-Position eine E-Mail. Nur Benutzer, die in ihren Benachrichtigungseinstellungen die Budget-Benachrichtigungen und die Ablaufwarnungen eingeschaltet haben, erhalten sie. Jede Erinnerung geht pro Tag nur einmal an jeden Empfänger, auch wenn der Job an diesem Tag erneut läuft, etwa nach einem Neustart.
- **Wöchentlicher Zusammenfassungs-Digest**: stündliche Prüfung -- sendet zeitzonenbewusste wöchentliche Zusammenfassungen an Benutzer, die sich dafür entschieden haben.

Ein weiterer geplanter Job läuft, wenn Entra SSO konfiguriert ist:

- **Microsoft Entra-Verzeichnissynchronisierung**: täglich um 03:00 Uhr Serverzeit -- aktualisiert Benutzerattribute und deaktiviert Konten, die im Verzeichnis entfernt oder deaktiviert wurden. Sie bleibt inaktiv, bis ein Microsoft Entra-Administrator sie genehmigt. Siehe [Microsoft Entra SSO](sso-entra.md).

Ein weiterer Job hält die Status aktuell:

- **`lifecycle-status-sync`**: stündlich und einmal beim Start der API. Setzt Stammdaten, Verträge sowie OPEX- und CAPEX-Positionen auf deaktiviert, sobald ihr Ende der Gültigkeit vorbei ist.

Bei mehreren API-Prozessen (`API_WORKERS`) läuft jeder Job weiterhin nur einmal pro geplantem Zeitpunkt: Die Prozesse einigen sich über die Datenbank darauf, welcher ihn ausführt. Stoppt die API (ein Upgrade), erhält ein laufender Job die Drain-Zeit zum Abschluss; ein dann noch laufender Job wird in der Liste der geplanten Aufgaben als **Fehlgeschlagen** angezeigt und läuft zum nächsten Zeitpunkt erneut.

Diese Jobs erfordern, dass die API als **dauerhaft laufender Prozess** läuft (nicht als Serverless-Funktion). Im On-Premise-Modus wird `APP_BASE_URL` für Benachrichtigungs-E-Mail-Links verwendet (keine Subdomain-Ableitung). Ist `APP_BASE_URL` nicht gesetzt, werden die Ablaufwarnungen und die wöchentlichen Zusammenfassungen übersprungen, und die API schreibt eine Zeile ins Protokoll („application URL is not configured“). Wenn kein ausgehender E-Mail-Transport konfiguriert ist, überspringen diese Jobs das Senden problemlos.
