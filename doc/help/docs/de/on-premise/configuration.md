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

Beim ersten Start erstellt KANAP automatisch einen Mandanten mit diesen Werten. Die Standardwerte funktionieren für die meisten Bereitstellungen -- Sie müssen sie nur ändern, wenn ein bestimmter Organisationsname in der Anwendung erscheinen soll.

## Erforderlich: Admin-Zugangsdaten

| Variable | Beschreibung | Beispiel |
|----------|--------------|---------|
| `ADMIN_EMAIL` | E-Mail des initialen Admin-Benutzers | `admin@firma.de` |
| `ADMIN_PASSWORD` | Initiales Admin-Passwort (**nach der ersten Anmeldung ändern!**) | `AendernSie123!` |
| `JWT_SECRET` | JWT-Signaturschlüssel (generieren: `openssl rand -hex 32`) | 64 Hex-Zeichen |
| `APP_BASE_URL` | Öffentliche URL (verwendet in E-Mail-Links) | `https://kanap.firma.de` |
| `CORS_ORIGINS` | Kommagetrennte erlaubte Browser-Origins (**in Produktion erforderlich**) | `https://*.firma.de` |

**E-Mail-Links:** Passwortzurücksetzungs-/Einladungs-URLs verwenden `APP_BASE_URL` (oder weitergeleiteten Host/Proto). On-Premise sollte `APP_BASE_URL` auf die extern erreichbare URL setzen und den Reverse Proxy so konfigurieren, dass er `Host` / `X-Forwarded-Proto` weitergibt.

**CORS:** Konfigurieren Sie `CORS_ORIGINS`, um zu steuern, welche Browser-Origins auf die API zugreifen können. Die Anwendung **startet in Produktion nicht**, wenn `CORS_ORIGINS` nicht gesetzt ist. Setzen Sie es auf die exakte URL, über die Benutzer auf KANAP zugreifen.

```bash
# Muss mit APP_BASE_URL übereinstimmen
CORS_ORIGINS=https://kanap.firma.de
```

**Startvalidierung:** Die Anwendung verweigert den Start, wenn `JWT_SECRET`, `DATABASE_URL` oder `APP_BASE_URL` fehlen oder leer sind. Sie verweigert auch den Betrieb, wenn die PostgreSQL-Rolle aus `DATABASE_URL` noch `SUPERUSER` oder `BYPASSRLS` ist.

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
| `APP_URL` | Basis-URL für Benachrichtigungs-E-Mail-Links im Multi-Tenant-Modus (Mandanten-Slug ersetzt `app`). **Nicht benötigt für On-Premise** -- `APP_BASE_URL` wird stattdessen verwendet. | `https://app.kanap.net` |
| `EMAIL_OVERRIDE` | Alle E-Mails an diese Adresse umleiten (nur Dev/QA, **nie in Produktion**) | *nicht gesetzt* |

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

# ANWENDUNGS-URL (erforderlich)
APP_BASE_URL=https://kanap.ihre-domain.de

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
| `registry-1.docker.io`, `production.cloudflare.docker.com` | 443 | Basis-Docker-Images pullen (`node:20-alpine`, `nginx:alpine`) |
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
| `v6.exchangerate-api.com` | 443 | Kassakurse | Optional |

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

Diese Jobs erfordern, dass die API als **dauerhaft laufender Prozess** läuft (nicht als Serverless-Funktion). Im On-Premise-Modus wird `APP_BASE_URL` für Benachrichtigungs-E-Mail-Links verwendet (keine Subdomain-Ableitung). Wenn kein ausgehender E-Mail-Transport konfiguriert ist, überspringen diese Jobs das Senden problemlos.
