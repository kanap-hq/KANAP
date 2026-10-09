# On-Premise-Konfiguration

Dieser Leitfaden beschreibt die Umgebungsvariablen einer On-Premise-Installation.
Eine vollständige Vorlage liegt unter `infra/.env.onprem.example`. Kopieren Sie sie nach `.env` im Wurzelverzeichnis des Repositorys und machen Sie sie nur für ihren Eigentümer lesbar (`chmod 600 .env`): Sie enthält alle Geheimnisse der Installation.

Eine Änderung an `.env` wird wirksam, wenn der API-Container neu erstellt wird. Führen Sie nach jeder Änderung Folgendes aus:

```bash
cd /opt/kanap
docker compose -f infra/compose.onprem.yml up -d api
```

`docker compose -f infra/compose.onprem.yml restart api` behält die alten Werte.

## Erforderlich: Bereitstellungsmodus

| Variable | Beschreibung | Beispiel |
|----------|-------------|---------|
| `DEPLOYMENT_MODE` | **Muss `single-tenant` sein** für On-Premise-Bereitstellungen | `single-tenant` |

Schreiben Sie den Wert exakt. Ein falsch geschriebener Wert (`single_tenant`) startet KANAP ohne jede Warnung im Cloud-Modus.

## Optional: Mandantenidentität

| Variable              | Erforderlich | Standard          | Beschreibung                                                    |
| --------------------- | -------- | ----------------- | --------------------------------------------------------------- |
| `DEFAULT_TENANT_SLUG` | Nein     | `default`         | Interne Kennung des Mandanten (URL-tauglich, Kleinbuchstaben)   |
| `DEFAULT_TENANT_NAME` | Nein     | `My Organization` | Der Name Ihrer Organisation: der Alternativtext des Logos und der Name, den der KI-Assistent verwendet |

Beim ersten Start legt KANAP mit diesen Werten einen Mandanten an. Die Standardwerte passen für die meisten Bereitstellungen. Eine neue Installation erhält außerdem den Standard-IFRS-Kontenplan, eingerichtet als Standard- und Konsolidierungskontenplan (ein Upgrade einer bestehenden Installation fügt ihn nicht hinzu).

Setzen Sie beide vor dem ersten Start:

- Eine spätere Änderung von `DEFAULT_TENANT_SLUG` lässt KANAP einen zweiten, leeren Arbeitsbereich anlegen und diesen bereitstellen. Der erste Arbeitsbereich bleibt unerreichbar in der Datenbank.
- Eine spätere Änderung von `DEFAULT_TENANT_NAME` hat keine Wirkung, und die Anwendung hat keine Seite, um die Organisation umzubenennen. Setzen Sie den Namen vor dem ersten Start.

Um KANAP das Erscheinungsbild Ihrer Organisation zu geben, fügen Sie unter **Administration → Branding** Ihr Logo und Ihre Farben hinzu.

## Erforderlich: Admin-Zugangsdaten

| Variable | Beschreibung | Beispiel |
|----------|-------------|---------|
| `ADMIN_EMAIL` | E-Mail-Adresse des ersten Administratorkontos | `admin@company.com` |
| `ADMIN_PASSWORD` | Passwort des ersten Administratorkontos. Verwenden Sie einen eigenen Wert mit mindestens 12 Zeichen (siehe unten) | `ChangeMe123!` |
| `JWT_SECRET` | Signaturschlüssel für Anmelde-Tokens. Erzeugen Sie ihn mit `openssl rand -hex 32` (mindestens 32 Zeichen) | 64 Hex-Zeichen |
| `APP_BASE_URL` | Die genaue Adresse, unter der Benutzer KANAP öffnen: Schema, Host und Port, wenn er nicht dem Standard entspricht (wird in jedem Link verwendet, den KANAP versendet) | `https://kanap.company.com` |
| `CORS_ORIGINS` | Die genaue Adresse, unter der Benutzer KANAP öffnen, bei mehreren durch Kommas getrennt (Browser-Origins, die die API aufrufen dürfen) | `https://kanap.company.com` |

**Das Administratorpasswort wählen.** Der Beispielwert in der Tabelle ist veröffentlicht. Ersetzen Sie ihn durch einen eigenen Wert mit mindestens 12 Zeichen, zum Beispiel die Ausgabe von `openssl rand -base64 18`. Ein Beispielwert oder ein kürzerer Wert lässt die API bei jedem Start eine `[SECURITY]`-Warnung ausgeben, bis das Passwort des Kontos geändert ist. Ein `JWT_SECRET` mit weniger als 32 Zeichen löst ebenfalls eine `[SECURITY]`-Warnung aus.

**Das Administratorkonto wird einmal angelegt.** KANAP liest `ADMIN_EMAIL` und `ADMIN_PASSWORD` beim ersten Start und legt das Konto an. Danach gilt:

- Eine Änderung einer der beiden Variablen bewirkt nichts, solange ein aktiver Administrator existiert. Ändern Sie das Passwort in der Anwendung (Profilseite oder **Passwort vergessen** auf der Anmeldeseite).
- Bleibt kein aktiver Administrator übrig (alle deaktiviert oder keiner hat die Rolle Administrator), stellt der nächste Start das Konto `ADMIN_EMAIL` als aktivierten Administrator wieder her. Sein bestehendes Passwort bleibt unverändert. Existiert das Konto nicht, wird es mit `ADMIN_PASSWORD` angelegt.
- Ist `ADMIN_EMAIL` oder `ADMIN_PASSWORD` leer, wird kein Konto angelegt, und das Protokoll erwähnt es nicht.

**Anwendungsadresse (`APP_BASE_URL`).** E-Mails zur Passwortzurücksetzung und Einladung, Benachrichtigungs-E-Mails, die Weiterleitung der Microsoft-Entra-Anmeldung und die Links in Exporten gehen alle von `APP_BASE_URL` aus. Schreiben Sie die Adresse genau so, wie Benutzer sie eingeben, mit dem Port, wenn er nicht 443 für HTTPS oder 80 für HTTP ist (zum Beispiel `https://kanap.company.com:8443`). KANAP liest die Header `Host` oder `X-Forwarded-Host` einer Anfrage nicht, um diese Links zu bauen, außer auf einem lokalen Entwicklungsrechner (`APP_ENV=development`). Ohne `APP_BASE_URL`:

- antworten Passwortzurücksetzung, Einladung und Microsoft-Entra-Anmeldung mit "application URL is not configured: set APP_BASE_URL";
- werden die geplanten Erinnerungen übersprungen, mit einer Zeile im API-Protokoll.

**Erlaubte Browser-Origins (`CORS_ORIGINS`).** `CORS_ORIGINS` legt fest, welche Webadressen die API aus einem Browser aufrufen dürfen. Tragen Sie die genaue Adresse ein: Schema, Host und Port, wenn er nicht dem Standard entspricht.

```bash
# Dieselbe Adresse wie APP_BASE_URL
CORS_ORIGINS=https://kanap.company.com
```

KANAP akzeptiert außerdem, ohne Eintrag in `CORS_ORIGINS`:

- die Anwendungsadresse (`APP_BASE_URL`);
- die Adresse der Anfrage selbst: Host und Port der Browseradresse entsprechen dem Header `Host`, der KANAP erreicht. Wenn Ihr Reverse Proxy `Host` ohne Port weitergibt, zählt derselbe Hostname auf jedem Port, außer bei `APP_ENV=production`. Tragen Sie in der Produktion die genaue Adresse mit ihrem Port in `CORS_ORIGINS` ein.

Eine Anfrage von jeder anderen Adresse erhält eine 403-Antwort, und die API protokolliert eine Zeile `[CORS] Rejected origin` pro Adresse und pro Minute. Anfragen zur Sitzungsaktualisierung und Abmeldung folgen derselben Regel: Eine Aktualisierung oder Abmeldung von einer nicht erlaubten Adresse wird mit 403 abgelehnt.

Ein Muster wie `https://*.company.com` funktioniert auf einer Single-Tenant-Installation noch. Die API gibt beim Start eine Warnung aus, und eine spätere Version akzeptiert nur noch genaue Adressen. Ersetzen Sie Muster jetzt durch die genaue Adresse.

Fehlen `CORS_ORIGINS` und die Anwendungsadresse (`APP_BASE_URL`) beide und ist `APP_ENV` nicht gesetzt, sind in dieser Version noch alle Origins erlaubt, und die API gibt beim Start eine Warnung aus. Eine spätere Version wird sie verlangen.

## Optional: Ausführungsmodus (`APP_ENV`)

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `APP_ENV` | Ausführungsmodus der API: `production`, `development` oder nicht gesetzt | *nicht gesetzt* |

`APP_ENV` kennt drei Zustände:

| Zustand | Werte | Was sich ändert |
|-------|--------|--------------|
| Produktion | `production`, `prod` | Die API startet nicht ohne `APP_BASE_URL` und `CORS_ORIGINS`. Das Sitzungs-Cookie ist immer als Secure markiert und funktioniert daher nur über HTTPS. |
| Entwicklung | `development`, `dev`, `local`, `test` | Erleichterungen für den Arbeitsplatzrechner: Links können einem lokalen Entwicklungshost folgen, jede Origin ist erlaubt, wenn `CORS_ORIGINS` leer ist, und `PLATFORM_ADMIN_EMAILS=*` wird akzeptiert. Nicht auf einem Server verwenden. |
| Nicht angegeben | jeder andere Wert oder kein `APP_ENV` | Dieselben Regeln für Links und Origins wie in der Produktion. Ein fehlendes `APP_BASE_URL` oder `CORS_ORIGINS` erzeugt eine Warnung beim Start, und die API startet trotzdem. Das Sitzungs-Cookie richtet sich nach der Anfrage: Secure, wenn die Anfrage über HTTPS eintrifft. |

Setzen Sie `APP_ENV=production`, wenn Benutzer KANAP über HTTPS erreichen, wie in der dokumentierten Einrichtung. Ist `NODE_ENV` gesetzt und `APP_ENV` nicht, liest KANAP stattdessen `NODE_ENV`.

**Prüfungen beim Start.** Die API startet nicht, wenn `JWT_SECRET` oder `DATABASE_URL` fehlt oder leer ist, und mit `APP_ENV=production` auch nicht, wenn `APP_BASE_URL` oder `CORS_ORIGINS` fehlt. Sie verweigert außerdem den Betrieb, wenn die PostgreSQL-Rolle aus `DATABASE_URL` `SUPERUSER` oder `BYPASSRLS` ist. Diese letzte Prüfung läuft nach den Migrationen, die Migrationen sind also bereits mit dieser Rolle gelaufen, wenn die Meldung erscheint.

## Was das API-Protokoll beim Start zeigt

Lesen Sie das API-Protokoll nach jedem Start und nach jeder Änderung an `.env`:

```bash
cd /opt/kanap
docker compose -f infra/compose.onprem.yml logs --no-log-prefix api | grep -E '^\[|^Admin seeding|WARN|ERROR|successfully started|Email transport'
```

Der Filter behält die unten aufgeführten Zeilen und lässt die Details des Frameworks weg. Ohne ihn zeigt `docker compose -f infra/compose.onprem.yml logs api` alles.

**Reihenfolge.** Die Zeilen, die KANAP selbst schreibt (`[entrypoint]`, `[ENV]`, `[SECRETS]`, `[RATE-LIMIT]`, `[CORS]`, `[DB]`, `[on-prem]`, `[SECURITY]`), kommen zuerst. Die Zeilen des Frameworks (`Starting Nest application...`, E-Mail, geplante Jobs, `Nest application successfully started`) folgen. Die Zeile `[DB] pool budget` kommt zuletzt.

**Ein sauberer erster Start** des [Installationsbeispiels](installation-example.md#7-bauen-und-starten) zeigt diese Zeilen in dieser Reihenfolge (die erste `[SECRETS]`-Zeile ist hier gekürzt):

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

Der Block lässt die Migrationszeilen weg: Auf `Running migrations...` folgen etwa 40 Zeilen, die mit `[Migration]` oder `[migration:` beginnen. Sie dienen der Information. Auf einer neuen Datenbank melden einige davon Änderungen an mitgelieferten Referenzdaten oder nennen eine Mandanten-ID, die nicht Ihre ist: KANAP führt einen Systemmandanten für Plattformfunktionen. Sie erfordern keine Maßnahme. `...` steht für das Präfix `[Nest]` mit Prozess-ID und Uhrzeit sowie für die Quelle in Klammern (zum Beispiel `LOG [NestApplication]`). Einige dieser Zeilen enden mit einer Dauer wie `+0ms`. Die letzte Zeile der gefilterten Ausgabe ist `[DB] pool budget ...`. Eine in eine Datei gespeicherte Protokollausgabe kann Farbcodes wie `[33m` enthalten.

Die Zahl der Migrationen ändert sich von Version zu Version. Bei späteren Starts lautet sie `0 executed` (oder die Zahl der neuen Migrationen nach einem Upgrade), und an die Stelle der vier `[on-prem]`-Zeilen zur Anlage tritt `Administrator account ... left unchanged`. Die E-Mail-Zeile hängt von Ihren Einstellungen ab: Mit einem E-Mail-Versandweg lautet sie `LOG [EmailService] Email transport selected: ...` statt der Warnung.

**Wichtige Zeilen.**

| Zeile | Bedeutung |
|------|---------|
| `[entrypoint] Migrations complete (N executed).` | Die Datenbank ist aktuell. N ist die Zahl der Migrationen, die bei diesem Start gelaufen sind. |
| `[entrypoint] DB not ready or migration failed (attempt N): ... Retrying` | Die API kann die Datenbank nicht erreichen oder nicht nutzen. Sie versucht es 30 Mal im Abstand von 2 Sekunden und stoppt dann. Prüfen Sie `DATABASE_URL`, die PostgreSQL-Regeln und `sslmode` (siehe [Erforderlich: Datenbank](#erforderlich-datenbank)). |
| `[ENV] run mode: ...` | Wird immer ausgegeben. Zeigt den Modus, in dem die API läuft: `development`, `production` oder `unspecified`. |
| `[ENV] APP_ENV is not set: production rules apply to links, browser origins and platform administration. Set APP_ENV=production (or development on a workstation).` | Wird im nicht angegebenen Modus ausgegeben (die Meldung zeigt den Wert, wenn `APP_ENV` auf etwas anderes gesetzt ist). Setzen Sie `APP_ENV=production`, wenn Benutzer KANAP über HTTPS erreichen. |
| `[CONFIG] APP_BASE_URL is not set: ...` | E-Mails zur Passwortzurücksetzung und Einladung, Benachrichtigungslinks und Anmelde-Weiterleitungen werden verweigert. Setzen Sie `APP_BASE_URL`. |
| `[CONFIG] APP_BASE_URL is not a valid http(s) address: ...` | Der Wert ist keine Webadresse. Schreiben Sie ihn mit `https://` oder `http://`. |
| `[SECRETS] token families: ...` und `[SECRETS] Access tokens must carry purpose="access" ...` | Zur Information. Sie nennen die Herkunft jedes Signaturschlüssels (nie seinen Wert). Nichts zu tun. |
| `[RATE-LIMIT] Client address: ... (RATE_LIMIT_TRUST_PROXY=true)` | Zur Information. Zeigt, wie KANAP die Client-Adresse ermittelt. |
| `[RATE-LIMIT] Client address: ... (RATE_LIMIT_TRUST_PROXY not set, single-tenant default; ...)` | Eine Warnung. `RATE_LIMIT_TRUST_PROXY` ist nicht gesetzt. Setzen Sie es (siehe [Optional: Erweitert](#optional-erweitert)). |
| `[CORS] Configured N origin pattern(s)` | Zur Information. N ist die Zahl der Einträge in `CORS_ORIGINS`. |
| `[CORS] CORS_ORIGINS is not set: browsers are allowed only from APP_BASE_URL and from the address of each request. ...` | Setzen Sie `CORS_ORIGINS` auf die genaue Adresse, die Benutzer öffnen. |
| `[CORS] CORS_ORIGINS and APP_BASE_URL are not set: browsers are still allowed from every origin in this version; ...` | Setzen Sie beide. Eine spätere Version erlaubt nur die konfigurierten Adressen. |
| `[CORS] CORS_ORIGINS entry ... is a pattern: it is still accepted in this version. ...` | Ersetzen Sie das Muster durch die genaue Adresse. |
| `[DB] Connected as PostgreSQL role "kanap" with native RLS enforcement` | Zur Information. Die API verwendet die Anwendungsrolle. |
| `Admin seeding disabled (set SEED_ADMIN=true to enable)` | On-Premise erwartet. Nichts zu tun: Der Administrator wird aus `ADMIN_EMAIL` und `ADMIN_PASSWORD` angelegt. |
| `[on-prem] Default chart of accounts created`, `[on-prem] Created tenant '...'`, `[on-prem] Created administrator account ...`, `[on-prem] Created default subscription (On-Prem)` | Nur beim ersten Start. |
| `[on-prem] Administrator account ... left unchanged: the workspace has an active administrator` | Spätere Starts. Nichts zu tun. |
| `[on-prem] Restored ... as an enabled administrator: the workspace had no active administrator (password unchanged)` | Eine Warnung. Es war kein aktiver Administrator mehr vorhanden, daher hat KANAP das Konto `ADMIN_EMAIL` wiederhergestellt. |
| `[SECURITY] JWT_SECRET is shorter than 32 characters. ...` | Setzen Sie einen längeren Zufallswert (`openssl rand -hex 32`) und erstellen Sie die API neu: Alle Benutzer melden sich erneut an, und offene Links zur Passwortzurücksetzung funktionieren nicht mehr. |
| `[SECURITY] The account of ADMIN_EMAIL still has the password from ADMIN_PASSWORD, which is an example value from the documentation or shorter than 12 characters. ...` | Ändern Sie das Passwort des Administrators in der Anwendung oder folgen Sie [Passwort zurücksetzen](operations.md#passwort-zurucksetzen). Die Zeile verschwindet, sobald das Passwort geändert ist. |
| `LOG [EmailService] Email transport selected: smtp (<host>:<port>, secure=false)` | E-Mail ist aktiv, über das angezeigte SMTP-Relay. `secure=true` bedeutet implizites TLS (`SMTP_SECURE`). Mit Resend endet die Zeile mit `selected: resend`. Zum Testen siehe [E-Mail testen](#e-mail-testen). |
| `WARN [EmailService] No outbound email transport configured; email sending is disabled.` | Kein E-Mail-Versandweg ist gesetzt. Einladungen, Passwortzurücksetzung und Benachrichtigungen versenden nichts. Siehe [Optional: E-Mail über SMTP](#optional-e-mail-uber-smtp-nur-single-tenant-on-premise). |
| `[DB] pool budget: ...` | Zur Information. Eine Warnung `pool budget exceeded` bedeutet, dass `API_WORKERS` × `DB_POOL_MAX` für `max_connections` von PostgreSQL zu hoch ist. |

## Upgrade einer Installation aus der Zeit vor Version 26.10.1

Die erste offizielle Version, 26.10.1, ändert, wie KANAP Links baut und welche Browser-Origins es akzeptiert. Prüfen Sie Ihre `.env`-Datei, bevor Sie eine ältere Installation aktualisieren:

1. Setzen Sie `APP_BASE_URL` auf die genaue Adresse, die Benutzer öffnen (Schema, Host und Port, wenn er nicht dem Standard entspricht). Sie ist die einzige Quelle der Links in E-Mails, Anmelde-Weiterleitungen und Exporten. Die Header der Anfrage ändern sie nicht mehr. Ohne sie funktionieren Passwortzurücksetzung, Einladung und Microsoft-Entra-Anmeldung nicht mehr, und geplante Erinnerungen werden übersprungen.
2. Tragen Sie genau diese Adresse in `CORS_ORIGINS` ein, anstelle jedes Musters. Wenn Ihr Proxy den Header `Host` nicht beibehält oder die Adresse einen Nicht-Standard-Port verwendet, ist die genaue Origin mit ihrem Port erforderlich.
3. Setzen Sie `APP_ENV=production` nur, wenn Benutzer KANAP über HTTPS erreichen. Das Sitzungs-Cookie trägt dann immer das Attribut Secure, und die API startet nicht ohne `APP_BASE_URL` und `CORS_ORIGINS`.
4. Lesen Sie nach dem Upgrade die Zeilen `[ENV]`, `[CONFIG]` und `[CORS]` im API-Protokoll und beheben Sie jede Warnung.
5. Anfragen zur Sitzungsaktualisierung und Abmeldung von einer nicht erlaubten Adresse erhalten jetzt 403, und `PLATFORM_ADMIN_EMAILS=*` wird nur akzeptiert, wenn `APP_ENV` ein Entwicklungswert ist.

Weitere sichtbare Änderungen:

- Beginnt `APP_BASE_URL` mit `app.`, verwenden die Microsoft-Entra-Anmeldung und die Wissenslinks die Adresse genau wie konfiguriert.
- Ohne `CORS_ORIGINS` und ohne Anwendungsadresse und mit nicht gesetztem `APP_ENV` ändert sich noch nichts: Jede Origin bleibt erlaubt, und die API gibt eine Warnung aus.
- Ohne `CORS_ORIGINS`, aber mit einer Anwendungsadresse, sind außerhalb der Entwicklung nur die Anwendungsadresse und die Adresse der Anfrage erlaubt (vorher: jede Origin).
- Die Test-E-Mail des Wochenrückblicks liefert einen Fehler, wenn keine Anwendungsadresse konfiguriert ist.

## Erforderlich: Datenbank

| Variable | Beschreibung | Beispiel |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL-Verbindungszeichenfolge | `postgres://kanap:<password>@host.docker.internal:5432/kanap?sslmode=disable` |

**Anforderungen an die Datenbank:**

- PostgreSQL 16 oder höher (16 und 18 sind getestet)
- Erweiterungen: `citext`, `pgcrypto`, `uuid-ossp`
- Der Benutzer braucht die Rechte CREATE TABLE / ALTER TABLE für die Migrationen
- Empfohlen: eine eigene Datenbank
- `DATABASE_URL` muss eine dedizierte Anwendungsrolle verwenden
- Empfohlen: die Anwendungsrolle von Anfang an als `NOSUPERUSER NOBYPASSRLS` anlegen

**Einrichtung der Datenbank (Beispiel):**

```sql
-- 1. Create database and dedicated app role
CREATE DATABASE kanap;
CREATE USER kanap WITH PASSWORD '<password>' NOSUPERUSER NOBYPASSRLS;
GRANT ALL PRIVILEGES ON DATABASE kanap TO kanap;

-- 2. Connect to kanap database and enable extensions
\c kanap
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 3. Grant schema permissions (for migrations)
GRANT ALL ON SCHEMA public TO kanap;
```

Wurde eine dedizierte Anwendungsrolle ursprünglich mit zu vielen Rechten angelegt, schränkt die erste Migration von KANAP sie auf `NOSUPERUSER NOBYPASSRLS` ein. Zeigt `DATABASE_URL` auf eine geschützte Cluster-Admin-Rolle wie `postgres`, schlägt der Start fehl, und Sie müssen auf eine dedizierte Anwendungsrolle wechseln.

**Das Passwort in der URL.** Das Passwort ist Teil der URL. Ein Passwort, das `@ : / # ?` oder `%` enthält, macht die URL ungültig, wenn Sie diese Zeichen nicht prozentkodieren. Erzeugen Sie das Passwort stattdessen mit `openssl rand -hex 24`: Buchstaben und Ziffern brauchen keine Kodierung. Dasselbe gilt für jedes Geheimnis, das Sie in eine URL schreiben.

**Verschlüsselung der Verbindung (`sslmode`).** Das Ende der URL legt fest, wie die API mit PostgreSQL spricht:

| Wert | Verwenden Sie ihn, wenn |
|-------|-------------|
| `sslmode=disable` | PostgreSQL auf demselben Server wie KANAP läuft (das Installationsbeispiel). Der Verkehr bleibt auf dem Server. |
| `sslmode=require` | PostgreSQL ein separater Server oder ein verwalteter Dienst ist, dessen Zertifikat von einer öffentlichen Zertifizierungsstelle stammt. Die API prüft das Zertifikat. |
| `sslmode=no-verify` | die Verbindung verschlüsselt sein soll, die API das Zertifikat aber nicht prüft. Für ein privates oder selbstsigniertes Zertifikat. |

`require` prüft das Zertifikat vollständig. Ein Server mit einem privaten oder selbstsignierten Zertifikat lässt den Start der API dann scheitern: Sie versucht es 30 Mal und stoppt. Hat die Zertifizierungsstelle Ihres Unternehmens dieses Zertifikat signiert, lassen Sie die API dieser Zertifizierungsstelle vertrauen (siehe [Zertifikate einer internen Zertifizierungsstelle](#optional-zertifikate-einer-internen-zertifizierungsstelle)) und behalten `require`. Andernfalls verwenden Sie `no-verify`. Ohne `sslmode` ist die Verbindung nicht verschlüsselt.

## Erforderlich: Speicher

| Variable | Beschreibung | Beispiel |
|----------|-------------|---------|
| `S3_ENDPOINT` | S3-kompatibler Endpunkt | `https://s3.amazonaws.com` |
| `S3_BUCKET` | Name des Buckets (muss existieren) | `kanap-files` |
| `S3_REGION` | Region | `us-east-1` |
| `AWS_ACCESS_KEY_ID` | Zugriffsschlüssel | `AKIA...` |
| `AWS_SECRET_ACCESS_KEY` | Geheimer Schlüssel | `secret` |
| `S3_FORCE_PATH_STYLE` | `true` für RustFS, MinIO, Garage und die meisten selbst betriebenen Speicher; `false` für AWS S3 und Cloudflare R2 | `false` |

**Region.** Verwenden Sie `us-east-1` mit RustFS. Ein Anbieter kann seine eigene Region verlangen (die in seiner Konsole angezeigte). Bei Garage muss die Region der in seiner Konfiguration gesetzten entsprechen. Eine falsche Region führt zu Fehlern wie "Authorization header malformed".

**Anforderungen an den Bucket:**

- Legen Sie den Bucket vor dem Start von KANAP an (er wird nicht automatisch angelegt). KANAP prüft ihn beim Start nicht: Ein fehlender Bucket zeigt sich beim ersten Hoch- oder Herunterladen.
- KANAP ruft `PutObject`, `GetObject`, `HeadObject`, `DeleteObject` und `ListObjectsV2` auf und baut vorsignierte `GET`-Links, alles auf diesem einen Bucket. Die passenden Berechtigungen sind `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject` und `s3:ListBucket`.

**Verschlüsselung im Ruhezustand.** KANAP bittet den Speicher, jeden Upload zu verschlüsseln (serverseitige Verschlüsselung `AES256`). Unterstützt ein Speicher das nicht, schreibt die API die Warnung `PutObject fallback used: provider rejected explicit SSE header; upload retried without SSE request header` und speichert die Datei wie gesendet. RustFS nimmt die Anfrage an, wenn `RUSTFS_SSE_S3_MASTER_KEY` gesetzt ist, was das [Installationsbeispiel](installation-example.md#5-objektspeicher-rustfs) tut. Bewahren Sie diesen Schlüssel mit der Sicherung Ihrer Konfiguration auf: Mit ihm verschlüsselte Dateien sind ohne ihn nicht lesbar.

KANAP verwendet den S3-Client des AWS SDK v3; jeder Anbieter mit S3-kompatiblem Verhalten wird unterstützt.

**Kompatible Speicher:**

- RustFS (`S3_ENDPOINT=http://host.docker.internal:9000`, `S3_FORCE_PATH_STYLE=true`), im Installationsbeispiel verwendet
- AWS S3 (`S3_ENDPOINT=https://s3.amazonaws.com`, `S3_FORCE_PATH_STYLE=false`)
- Cloudflare R2 (`https://<account>.r2.cloudflarestorage.com`)
- Hetzner Object Storage (`https://<region>.your-objectstorage.com`)
- Garage (`S3_FORCE_PATH_STYLE=true`, Region wie in seiner Konfiguration gesetzt)
- Ein vorhandenes MinIO (`S3_FORCE_PATH_STYLE=true`). MinIO veröffentlicht keine neuen Downloads oder Images mehr, daher verwenden neue Installationen einen anderen Speicher. Eine Installation, die bereits MinIO betreibt, funktioniert weiterhin mit KANAP, ohne Änderung.

## Optional: E-Mail über Resend

| Variable | Beschreibung | Beispiel |
|----------|-------------|---------|
| `RESEND_API_KEY` | Resend-API-Schlüssel | `re_xxxxx` |
| `RESEND_FROM_EMAIL` | Absenderadresse. Setzen Sie eine Adresse, in deren Namen Ihr Resend-Konto senden darf: Ohne sie wird von einer KANAP-Adresse aus gesendet. | `KANAP <noreply@company.com>` |

Ist Resend nicht konfiguriert, kann KANAP in Single-Tenant-Bereitstellungen weiterhin über SMTP senden. Ist weder Resend noch SMTP konfiguriert, sind die E-Mail-Funktionen deaktiviert, auch Benutzereinladungen und Passwortzurücksetzung. Die Ausweichlösung steht unter [Passwort zurücksetzen](operations.md#passwort-zurucksetzen).

## Optional: E-Mail über SMTP (nur Single-Tenant / On-Premise)

SMTP wird nur mit `DEPLOYMENT_MODE=single-tenant` unterstützt. Multi-Tenant- bzw. Cloud-Bereitstellungen verwenden weiterhin Resend.

| Variable        | Beschreibung                         | Beispiel                      |
| --------------- | ------------------------------------ | ----------------------------- |
| `SMTP_HOST`     | Hostname des SMTP-Servers            | `smtp.company.com`            |
| `SMTP_PORT`     | SMTP-Port                            | `587`                         |
| `SMTP_USER`     | SMTP-Benutzername                    | `kanap`                       |
| `SMTP_PASSWORD` | SMTP-Passwort                        | `secret`                      |
| `SMTP_FROM`     | Absenderadresse                      | `KANAP <noreply@company.com>` |
| `SMTP_SECURE`   | `true` für implizites TLS (465), `false` für STARTTLS bzw. eine unverschlüsselte Verbindung (587/25) | `false` |

Hinweise:

- `SMTP_HOST` und `SMTP_FROM` sind beide erforderlich. Mit nur einem davon bleibt SMTP aus.
- `SMTP_USER` und `SMTP_PASSWORD` gehören zusammen: Setzen Sie beide, oder lassen Sie beide leer für Relays, die dem Quellhost bzw. der Quell-IP vertrauen. Ist nur eines gesetzt, startet die API nicht.
- Ist `SMTP_SECURE` nicht gesetzt, verwendet KANAP `true` für Port `465` und sonst `false`.
- Sind im Single-Tenant-Modus sowohl SMTP als auch Resend konfiguriert, hat SMTP Vorrang.
- `SMTP_FROM` sollte eine Adresse sein, in deren Namen Ihr SMTP-Server senden darf.
- Ein Relay auf dem KANAP-Server selbst: Setzen Sie `SMTP_HOST=host.docker.internal`, so erreicht der API-Container den Server. Das Relay muss auf der Docker-Bridge-Adresse lauschen (standardmäßig `172.17.0.1`). Ein auf dem Server installiertes Relay braucht außerdem eine Firewall-Regel, die seinen Port aus den Docker-Netzwerken erlaubt (siehe den Befehl unten). Ein Relay, das als Docker-Container mit veröffentlichtem Port läuft, braucht keine.
- Die Adresse `172.17.0.1` existiert erst, wenn Docker läuft. Ein auf dem Server installiertes Relay, das auf ihr lauscht, muss nach Docker starten, wie der Speicher im [Installationsbeispiel](installation-example.md#5-objektspeicher-rustfs). Legen Sie mit systemd die Datei `/etc/systemd/system/<relay service>.service.d/override.conf` an (mit dem Namen des Relay-Dienstes anstelle von `<relay service>`), mit zwei Zeilen, `[Unit]` und dann `After=docker.service`, und führen Sie `sudo systemctl daemon-reload` aus.
- Ein Relay, dessen TLS-Zertifikat von der Zertifizierungsstelle Ihres Unternehmens stammt, braucht diese Zertifizierungsstelle: siehe [Zertifikate einer internen Zertifizierungsstelle](#optional-zertifikate-einer-internen-zertifizierungsstelle).
- Werden E-Mails außerhalb Ihres Netzwerks versendet, richten Sie über Ihren Mail-Administrator oder Anbieter SPF, DKIM und DMARC für die Absenderdomain ein.

**Gängige SMTP-Profile**

Internes Relay ohne Authentifizierung:

```env
SMTP_HOST=mail.company.local
SMTP_PORT=25
SMTP_SECURE=false
SMTP_FROM=KANAP <noreply@company.com>
```

Authentifiziertes Relay oder Anbieter:

```env
SMTP_HOST=smtp.company.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=noreply@company.com
SMTP_PASSWORD=secret
SMTP_FROM=KANAP <noreply@company.com>
```

SMTP-Versand über Microsoft 365:

```env
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=noreply@company.com
SMTP_PASSWORD=secret
SMTP_FROM=KANAP <noreply@company.com>
```

Verwenden Sie das Microsoft-365-Profil nur, wenn SMTP AUTH für das Postfach und den Mandanten erlaubt ist.

**Ein Relay auf dem KANAP-Server.** Erlauben Sie dem API-Container, es zu erreichen. Tragen Sie in der ersten Zeile den Port Ihres Relays ein:

```bash
SMTP_PORT=25   # der SMTP_PORT aus .env
sudo ufw allow from 172.16.0.0/12 to any port "$SMTP_PORT" proto tcp
```

Diese Regel gilt für ein auf dem Server installiertes Relay. Ein Relay, das in einem Docker-Container mit veröffentlichtem Port läuft, braucht keine Regel: Docker veröffentlicht seine Ports an `ufw` vorbei.

### E-Mail testen

Erstellen Sie nach einer Änderung der E-Mail-Einstellungen die API neu (`docker compose -f infra/compose.onprem.yml up -d api`). Das API-Protokoll zeigt dann `Email transport selected` (siehe [Was das API-Protokoll beim Start zeigt](#was-das-api-protokoll-beim-start-zeigt)). Um eine Testnachricht zu senden, öffnen Sie die Anmeldeseite, wählen **Passwort vergessen** und geben die E-Mail-Adresse eines bestehenden Kontos ein, das sich mit einem Passwort anmeldet. Die Nachricht kommt mit einem Link an, der mit Ihrer `APP_BASE_URL` beginnt. Konten, die sich mit Microsoft Entra anmelden, erhalten keine Nachricht zum Zurücksetzen.

Schlägt der Versand fehl, kommt die Nachricht nicht an, und das API-Protokoll enthält eine `ERROR`-Zeile mit dem Grund. Bei einem Relay, dessen Zertifikat die API nicht vertraut, lautet der Grund `unable to verify the first certificate` (oder `self-signed certificate`) und der Code `ESOCKET`. Die API vertraut der Zertifizierungsstelle nicht, die das Zertifikat des Relays signiert hat: siehe [Zertifikate einer internen Zertifizierungsstelle](#optional-zertifikate-einer-internen-zertifizierungsstelle). Die Zertifizierungsstelle auf dem Server selbst zu installieren, ändert am Container nichts.

## Optional: Zertifikate einer internen Zertifizierungsstelle

Die API prüft das Zertifikat jedes Servers, den sie über TLS erreicht. Ihr SMTP-Relay, ein PostgreSQL-Server mit `sslmode=require` oder ein S3-Speicher über HTTPS kann ein Zertifikat verwenden, das die eigene Zertifizierungsstelle Ihres Unternehmens signiert hat. Die API lehnt die Verbindung dann ab, bis sie dieser Zertifizierungsstelle vertraut. Geben Sie ihr das Zertifikat der Zertifizierungsstelle als PEM-Datei:

```bash
cd /opt/kanap
cp /path/to/company-ca.pem infra/certs/company-ca.pem
chmod 644 infra/certs/company-ca.pem
echo 'NODE_EXTRA_CA_CERTS=/etc/kanap/certs/company-ca.pem' >> .env
docker compose -f infra/compose.onprem.yml up -d api
```

- Die Datei enthält die Stammzertifizierungsstelle, gefolgt von den Zwischenzertifizierungsstellen, wenn Ihre Server diese nicht mitsenden. Legen Sie nur Zertifikate hinein, keinen privaten Schlüssel.
- Der Modus `644` lässt die API die Datei lesen. Das Zertifikat einer Zertifizierungsstelle ist öffentlich.
- Git ignoriert die Dateien in `infra/certs/`, ein Upgrade lässt sie also an Ort und Stelle.
- Ihre Zertifizierungsstelle kommt zu den öffentlichen hinzu: Verbindungen zu öffentlichen Diensten funktionieren weiterhin.

Prüfen Sie, dass die API die Datei liest:

```bash
cd /opt/kanap
docker compose -f infra/compose.onprem.yml exec -T api node -e 'require("tls").createSecureContext()' </dev/null
```

Der Befehl gibt nichts aus, wenn alles in Ordnung ist. Eine Zeile, die mit `Warning: Ignoring extra certs from` beginnt, bedeutet, dass die API die Datei nicht lesen kann: Prüfen Sie den Pfad in `.env`, den Dateinamen und den Modus. Das API-Protokoll zeigt dieselbe Zeile nach seiner ersten TLS-Verbindung.

## Optional: Entra SSO

Siehe den eigenen Leitfaden: [Microsoft Entra SSO](sso-entra.md).

Er behandelt die App-Registrierung, die delegierten und die Anwendungsberechtigungen sowie die tägliche Verzeichnissynchronisierung, die Benutzerattribute aktualisiert und aus dem Verzeichnis entfernte Konten deaktiviert. Die Variablen sind `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET`, `ENTRA_AUTHORITY` und `ENTRA_REDIRECT_URI`; alle vier sind nötig. Die API braucht ausgehenden Zugriff auf `login.microsoftonline.com` und `graph.microsoft.com`.

## Optional: KI-Funktionen

Alle KI-Funktionen sind auf einer On-Premise-Installation standardmäßig ausgeschaltet. Drei Schalter schalten sie ein, und ein Geheimnis erlaubt KANAP, die Schlüssel Ihres KI-Anbieters zu speichern.

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `AI_CHAT_ENABLED` | Schaltet den [Plaid-Chat-Assistenten](../ai-assistant.md) für die Installation ein. | `false` |
| `AI_MCP_ENABLED` | Schaltet den MCP-Zugriff und die KI-API-Schlüssel ein. | `false` |
| `AI_SETTINGS_ENABLED` | Öffnet **Administration → Künstliche Intelligenz** (KI-Modelle, Plaid-Einstellungen) und die [Agenten](../agents-overview.md) für Administratoren. Ohne diesen Schalter kann niemand einen Anbieter einrichten. | `false` |
| `AI_SETTINGS_ENCRYPTION_SECRET` | Geheimnis, das die Anbieterschlüssel verschlüsselt, die Sie in KANAP eingeben. Erzeugen Sie es mit `openssl rand -hex 32`. | *nicht gesetzt* |

Hinweise:

- Ohne `AI_SETTINGS_ENCRYPTION_SECRET` verweigert KANAP das Speichern eines Anbieterschlüssels ("AI secret storage is not configured on this instance").
- Eine spätere Änderung von `AI_SETTINGS_ENCRYPTION_SECRET` macht die gespeicherten Schlüssel unlesbar. Sichern Sie es zusammen mit `.env`, und geben Sie die Schlüssel erneut ein, wenn Sie es verlieren.
- Eine On-Premise-Installation enthält kein Modell: Sie fügen Ihren eigenen Anbieter oder Modellserver unter **Administration → Künstliche Intelligenz → KI-Modelle** hinzu. Siehe [KI-Modelle](../ai-models.md) und [Plaid-Einstellungen](../ai-settings.md). Dort hat außerdem jeder Mandant seine eigenen Schalter.
- Die API braucht ausgehenden Zugriff auf den gewählten Anbieter (siehe [Firewall-Regeln](#firewall-regeln)).

## Optional: Erweitert

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `RATE_LIMIT_TRUST_PROXY` | Wie KANAP die Client-Adresse für seine Anmelde- und Anfragelimits ermittelt. `true`: Ein Reverse Proxy steht vor der API und sendet `X-Forwarded-For` (das nginx dieses Leitfadens). `false`: Nichts steht davor, die Adresse der Verbindung wird verwendet. `1` bis `3`: so viele Proxys hintereinander. | Nicht gesetzt bedeutet bei Single-Tenant ein vertrauenswürdiger Proxy, mit einer `[RATE-LIMIT]`-Warnung bei jedem Start. Setzen Sie den Wert ausdrücklich. |
| `RATE_LIMIT_ENABLED` | Schalter für die Anfragebegrenzung auf Anwendungsebene | `true` |
| `JWT_ACCESS_TOKEN_TTL` | Lebensdauer des Zugriffstokens: eine Zahl gefolgt von `s`, `m`, `h` oder `d`. Ein anderes Format ergibt 15 Minuten. | `15m` |
| `JWT_REFRESH_TOKEN_TTL` | Lebensdauer des Aktualisierungstokens, gleiches Format. Ein anderes Format ergibt 15 Minuten. | `4h` |
| `PASSWORD_RESET_TTL` | Gültigkeitsdauer eines Links zur Passwortzurücksetzung: eine Zahl von Sekunden oder eine Dauer wie `30m` oder `2h`. | `1h` |
| `LOG_LEVEL` | `debug` oder `verbose` ergänzt das Protokoll um die Details jedes Laufs eines geplanten Jobs. Jeder andere Wert ändert nichts. | *nicht gesetzt* |
| `INTEGRATED_DOCS_AUTO_ROLLOUT` | Repariert beim Start die mit Anfragen und Projekten verknüpften Dokumente. On-Premise ausgeschaltet, sofern Sie es nicht setzen: `if-needed` führt die Reparatur nur aus, wenn die Zählungen abweichen, `always` bei jedem Start. | *aus* |
| `APP_URL` | Nur Multi-Tenant (Cloud). **On-Premise nicht nötig**: `APP_BASE_URL` wird verwendet. | *nicht gesetzt* |
| `EMAIL_OVERRIDE` | Leitet alle E-Mails an diese Adresse um (nur Entwicklung/QA, **niemals in der Produktion**) | *nicht gesetzt* |

**Client-Adresse.** Mit der dokumentierten Einrichtung (nginx auf demselben Server, API-Port an `127.0.0.1` gebunden) setzen Sie `RATE_LIMIT_TRUST_PROXY=true`. Der Proxy muss `X-Forwarded-For` senden; das nginx-Beispiel tut das. Setzen Sie `false`, wenn nichts vor der API steht. Ein falscher Wert gibt allen Benutzern dieselbe Adresse, und die 5 Anmeldeversuche pro Minute teilen sich alle.

## Optional: Kapazität und Leistung

Die Standardwerte passen für einige Dutzend Benutzer. Für mehr gleichzeitige Benutzer führen Sie mehrere API-Prozesse aus und dimensionieren die Datenbankverbindungen.

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `API_WORKERS` | Anzahl der API-Prozesse im API-Container (1 bis 16). Mit mehr als einem lässt eine rechenintensive Anfrage nicht mehr alle anderen warten. | `1` |
| `DB_POOL_MAX` | Datenbankverbindungen pro API-Prozess (mindestens 2: Ein niedrigerer Wert wird auf 2 angehoben) | `20` |
| `SHUTDOWN_DRAIN_TIMEOUT_MS` | Wie lange die API beim Stoppen oder bei einem Upgrade laufende Anfragen, die von ihnen gestarteten Benachrichtigungen, laufende Hintergrundjobs und E-Mails in der Warteschlange abschließen lässt (Millisekunden, höchstens 120000). Der Container wird in jedem Fall nach 30 s gestoppt. | `20000` |
| `OPS_METRICS_TOKEN` | Aktiviert `GET /api/ops/metrics` für Ihr Monitoring-Tool (mindestens 24 Zeichen, zum Beispiel `openssl rand -hex 32`; ein kürzerer Wert lässt es deaktiviert, und die API meldet das beim Start). Siehe [Betrieb](operations.md#api-metriken-fur-ein-monitoring-tool). | *nicht gesetzt (deaktiviert)* |

**Was jede Einstellung kostet.** Jeder API-Prozess belegt beim Start etwa 200 MB Arbeitsspeicher und unter Last bis zu 300 MB (gemessen mit 50 Benutzern auf 5.000 Budgetpositionen); bei mehreren Prozessen kommt ein kleiner überwachender Prozess mit etwa 100 MB hinzu. Jeder API-Prozess kann bis zu `DB_POOL_MAX` Verbindungen zu PostgreSQL öffnen. Rechnen Sie:

- Arbeitsspeicher: `API_WORKERS` × 0,4 GB für die API, plus den Bedarf von PostgreSQL, wenn es auf demselben Server läuft, plus Platz für den Image-Build bei jedem Upgrade. 6 GB sind das Minimum für jeden Server. Auf einer neuen Installation mit laufendem PostgreSQL und Speicher brauchte der gleichzeitige Build beider Images in der Spitze insgesamt etwa 3,8 GB (etwa 3,2 GB für den Build selbst), mit 6 GB bleiben also etwa 2 GB frei;
- Verbindungen: `API_WORKERS` × `DB_POOL_MAX` muss unter `max_connections` von PostgreSQL (standardmäßig 100) minus etwa 15 bleiben. Die API prüft das beim Start und schreibt eine Warnung in ihr Protokoll, wenn es nicht passt, mit einem Wert, der passen würde.

**Empfohlene Werte.**

| Gleichzeitig arbeitende Benutzer | `API_WORKERS` | `DB_POOL_MAX` | Arbeitsspeicher des Servers (API + PostgreSQL) |
|---|---|---|---|
| Bis 20 | 1 | 20 | 6 GB |
| 20 bis 50 | 2 | 15 | 8 GB |
| 50 und mehr | 4 | 10 | 8 bis 16 GB |

Gemessen auf 5.000 Budgetpositionen: Bei 10 Benutzern antwortet ein Prozess so schnell wie vier. Bei 50 Benutzern dauerte das Öffnen einer Position 237 ms (95. Perzentil) mit einem Prozess, 142 ms mit zwei und 82 ms mit vier, und ein einzelner Prozess hielt alle seine Datenbankverbindungen beschäftigt.

Halten Sie `API_WORKERS` höchstens bei der Zahl der CPU-Kerne, die der Server KANAP zur Verfügung stellt. Änderungen werden wirksam, wenn der API-Container neu erstellt wird (`docker compose -f infra/compose.onprem.yml up -d api`).

## Vollständiges Beispiel (.env)

```bash
# =============================================================================
# KANAP On-Premise-Konfiguration
# =============================================================================

# BEREITSTELLUNGSMODUS (erforderlich)
DEPLOYMENT_MODE=single-tenant

# MANDANTENKONFIGURATION (optional - Standardwerte gezeigt; vor dem ersten Start setzen)
DEFAULT_TENANT_SLUG=default
DEFAULT_TENANT_NAME=My Organization

# ADMIN-ZUGANGSDATEN (erforderlich - werden nur beim ersten Start gelesen)
# Ersetzen Sie das Beispielpasswort durch einen eigenen Wert mit mindestens 12 Zeichen.
ADMIN_EMAIL=admin@company.com
ADMIN_PASSWORD=ChangeThisPassword123!

# SICHERHEIT (erforderlich)
JWT_SECRET=

# AUSFÜHRUNGSMODUS (production, wenn Benutzer KANAP über HTTPS erreichen)
APP_ENV=production

# ANWENDUNGS-URL (erforderlich - die genaue Adresse, die Benutzer öffnen)
APP_BASE_URL=https://kanap.company.com

# ERLAUBTE BROWSER-ORIGINS (erforderlich - die genaue Adresse, die Benutzer öffnen)
CORS_ORIGINS=https://kanap.company.com

# CLIENT-ADRESSE (ein Reverse Proxy vor der API)
RATE_LIMIT_TRUST_PROXY=true

# DATENBANK (erforderlich - eine dedizierte Anwendungsrolle, nicht postgres)
# sslmode: disable (derselbe Server), require (öffentliches Zertifikat), no-verify (privates Zertifikat)
DATABASE_URL=postgres://kanap:password@your-postgres:5432/kanap?sslmode=require

# SPEICHER (erforderlich)
S3_ENDPOINT=https://s3.amazonaws.com
S3_BUCKET=kanap-files
S3_REGION=us-east-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
# true für RustFS, MinIO, Garage; false für AWS S3 und R2
S3_FORCE_PATH_STYLE=false

# E-MAIL (optional - Resend)
# RESEND_API_KEY=re_xxxxx
# RESEND_FROM_EMAIL=KANAP <noreply@company.com>

# E-MAIL (optional - SMTP, nur Single-Tenant)
# SMTP_HOST=smtp.company.com
# SMTP_PORT=587
# SMTP_SECURE=false
# SMTP_USER=
# SMTP_PASSWORD=
# SMTP_FROM=KANAP <noreply@company.com>

# SSO (optional - Microsoft Entra ID, alle vier zusammen)
# ENTRA_CLIENT_ID=
# ENTRA_CLIENT_SECRET=
# ENTRA_AUTHORITY=https://login.microsoftonline.com/<tenant-id>
# ENTRA_REDIRECT_URI=https://kanap.company.com/api/auth/entra/callback

# KI (optional - standardmäßig aus)
# AI_CHAT_ENABLED=false
# AI_MCP_ENABLED=false
# AI_SETTINGS_ENABLED=false
# AI_SETTINGS_ENCRYPTION_SECRET=

# ERWEITERT (optional - die Standardwerte passen)
# JWT_ACCESS_TOKEN_TTL=15m
# JWT_REFRESH_TOKEN_TTL=4h
# PASSWORD_RESET_TTL=1h
# RATE_LIMIT_ENABLED=true

# KAPAZITÄT (optional - siehe "Kapazität und Leistung")
# API_WORKERS=1
# DB_POOL_MAX=20
# SHUTDOWN_DRAIN_TIMEOUT_MS=20000
# OPS_METRICS_TOKEN=
```

## Firewall-Regeln

Nach dem ersten Build kann KANAP vollständig vom Netz getrennt laufen, wenn E-Mail, SSO, KI und Wechselkursfunktionen alle deaktiviert sind.

### Eingehend

| Port | Protokoll | Zweck |
|------|----------|---------|
| 443 | TCP | HTTPS: nginx-Reverse-Proxy, der die Anwendung bereitstellt |
| 80 | TCP | HTTP: leitet auf HTTPS um (und beantwortet Zertifikatserneuerungen, wenn Sie Let's Encrypt verwenden) |
| 22 | TCP | SSH für die Administration. Erlauben Sie es, bevor Sie eine Firewall aktivieren |

Sonst muss nichts aus dem Netzwerk erreichbar sein. Insbesondere sind PostgreSQL (5432) und der Objektspeicher (9000) nur für die Docker-Netzwerke des Servers bestimmt.

### Ausgehend: Ersteinrichtung und Build

Diese Ziele werden bei der Installation, bei jedem Upgrade und bei jedem Zurücksetzen auf eine frühere Version (`docker build`) sowie beim ersten Lauf des Smoke-Tests gebraucht. Zwischen diesen Vorgängen können sie geschlossen werden.

| Ziel | Port | Zweck |
|-------------|------|---------|
| `github.com`, `*.githubusercontent.com` | 443 | KANAP-Quellcode klonen; die Release-Dateien von RustFS herunterladen (das Installationsbeispiel) |
| `download.docker.com` | 443 | APT-Repository von Docker |
| `registry.npmjs.org` | 443 | npm-Abhängigkeiten während `docker build` |
| `registry-1.docker.io`, `auth.docker.io` | 443 | Docker-Basis-Images laden (`node:24-alpine`, `nginx:alpine`) und das Image des Smoke-Tests (`node:24-alpine`) beim ersten Lauf des Tests. Jeder Pull holt sich zuerst ein Token von `auth.docker.io` |
| `production.cloudflare.docker.com`, `production.cloudfront.docker.com` | 443 | Die Image-Layer herunterladen: Docker Hub leitet jeden Pull auf diese Hosts um |
| `dl-cdn.alpinelinux.org` | 80/443 | Alpine-Pakete während `docker build` (beide Images installieren Pakete mit `apk add`) |
| Ubuntu-APT-Spiegel | 80/443 | Systempakete (PostgreSQL, nginx usw.) |
| `acme-v02.api.letsencrypt.org` | 443 | Zertifikate, nur mit Let's Encrypt (auch bei jeder Erneuerung) |

Docker kann die Download-Hosts von Docker Hub ändern. Docker pflegt die aktuelle Liste in seiner [Allowlist](https://docs.docker.com/desktop/enterprise/allow-list/). Ein Pull nutzt zwei Zeilen dieser Seite: "Docker Pull/Push" (`registry-1.docker.io`, `production.cloudfront.docker.com`) und "Authentication" (`auth.docker.io`). Diese Zeilen gelten auch für einen Server mit Docker Engine.

### Ausgehend: Laufzeit (bedingt)

Nur erforderlich, wenn die entsprechende Funktion aktiviert ist.

| Ziel | Port | Zweck | Wann |
|-------------|------|---------|------|
| `api.resend.com` | 443 | Transaktions-E-Mails | Wenn `RESEND_API_KEY` gesetzt ist |
| Ihr SMTP-Relay oder Anbieter | 25 / 465 / 587 | Transaktions-E-Mails über SMTP | Wenn `SMTP_HOST` gesetzt ist |
| `login.microsoftonline.com` | 443 | Metadaten und Tokens für Entra ID SSO | Wenn Entra SSO konfiguriert ist |
| `graph.microsoft.com` | 443 | Profilanreicherung bei der Anmeldung und die tägliche Verzeichnissynchronisierung | Wenn Entra SSO konfiguriert ist |
| Der KI-Anbieter, den Sie konfigurieren (oder Ihr eigener Modellserver) | 443 oder der Port Ihres Servers | Chat, Agenten | Wenn KI-Funktionen aktiviert sind und ein Modell eingerichtet ist |
| `api.worldbank.org` | 443 | Jährliche Wechselkurse | Optional |
| `open.er-api.com` | 443 | Tageswechselkurse | Optional |

### Intern (keine Firewall-Regel von außen nötig)

Diese Verbindungen bleiben auf dem Server: Loopback oder die Docker-Netzwerke.

| Verbindung | Port | Hinweise |
|------------|------|-------|
| nginx → API-Container | 8080 | An `127.0.0.1` gebunden |
| nginx → Web-Container | 8081 | An `127.0.0.1` gebunden |
| API-Container → PostgreSQL | 5432 | Über `host.docker.internal`, die Docker-Bridge-Adresse des Servers (standardmäßig `172.17.0.1`). Nur aus den Docker-Netzwerken erlauben (`172.16.0.0/12`). |
| API-Container → Objektspeicher | 9000 | Derselbe Weg. Im Installationsbeispiel lauscht der Speicher nur auf `172.17.0.1`. |
| API-Container → Mail-Relay auf dem Server | Sein `SMTP_PORT` | Nur wenn das Relay auf dem KANAP-Server läuft. Derselbe Weg: Das Relay lauscht auf `172.17.0.1`, und die Regel erlaubt seinen Port aus `172.16.0.0/12`. |

Standardmäßig gibt Docker seinen ersten 15 Netzwerken Bereiche innerhalb von `172.16.0.0/12` (`172.17.0.0/16` bis `172.31.0.0/16`), danach `/20`-Blöcke aus `192.168.0.0/16`. Auf einem frisch installierten Server verwenden die KANAP-Container `172.18.0.0/16`. Ein Server, der bereits viele Docker-Netzwerke hat, kann sie in `192.168.x.x` legen, außerhalb dieser Regeln. Nach dem ersten Start zeigt `docker network inspect infra_default` ihr Subnetz. Liegt es außerhalb von `172.16.0.0/12`, ergänzen Sie es in den Firewall-Regeln und in der `pg_hba.conf`-Zeile von PostgreSQL. Mit demselben Subnetz lässt sich auch eine engere Regel schreiben.

## Hintergrundjobs

Die API führt 15 geplante Jobs aus. Die folgenden Zeiten sind die Standardwerte, in UTC (die Uhr des API-Containers). Administratoren sehen die Jobs unter **Administration → Geplante Aufgaben** (siehe [Geplante Aufgaben](../scheduled-tasks.md)), wo jeder einzelne ausgeschaltet, neu geplant oder auf Anforderung ausgeführt werden kann.

| Job | Wann | Was er tut |
|-----|------|--------------|
| `check-expirations` | Täglich 08:00 | Schreibt den Verantwortlichen von Verträgen und OPEX-Positionen 30, 14, 7 und 1 Tag(e) vor einer Kündigungsfrist, einem Enddatum oder dem Ende der Gültigkeit eine E-Mail. Nur Benutzer, die diese Benachrichtigungen eingeschaltet haben, erhalten sie, einmal pro Tag. |
| `send-weekly-reviews` | Stündlich | Sendet den Wochenrückblick an Benutzer, die ihn abonniert haben, an ihrem eigenen Tag und in ihrer eigenen Zeitzone. |
| `lifecycle-status-sync` | Stündlich und einmal beim Start | Setzt Stammdaten, Verträge, OPEX- und CAPEX-Positionen auf deaktiviert, sobald ihr Gültigkeitsende überschritten ist. |
| `entra-directory-sync` | Täglich 03:00 | Aktualisiert Benutzerattribute und deaktiviert Konten, die im Verzeichnis entfernt oder deaktiviert wurden. Funktioniert nur, wenn Entra SSO verbunden und genehmigt ist. Siehe [Microsoft Entra SSO](sso-entra.md). |
| `attachment-orphan-cleanup` | Täglich 03:00 | Entfernt die Anhangsdatensätze eingebetteter Bilder, die kein Text mehr verwendet. |
| `storage-ghost-cleanup` | Sonntag 04:00 | Entfernt gespeicherte Dateien ohne Anhangsdatensatz, die älter als 7 Tage sind. |
| `list-context-purge` | Täglich 03:30 | Löscht gespeicherte Listenfilter, die 90 Tage lang niemand verwendet hat. |
| `auth-event-retention` | Täglich 03:40 | Löscht Anmeldeereignisse, die älter als 365 Tage sind, aus dem Audit-Protokoll. |
| `ai-conversation-retention` | Täglich 02:00 | Archiviert und löscht KI-Gespräche gemäß den Aufbewahrungseinstellungen. |
| `ai-search-index-reindex` | Täglich 03:00 | Baut den Suchindex neu auf, den die KI-Funktionen verwenden. |
| `ai-agent-activity-retention-purge` | Täglich 03:25 | Löscht Agentenaktivität, die älter als die Aufbewahrungsdauer des jeweiligen Agenten ist. |
| `ai-mutation-preview-expiration` | Alle 5 Minuten | Lässt KI-Änderungsvorschauen ablaufen, die niemand rechtzeitig genehmigt hat. |
| `ai-helpdesk-glpi-new-ticket-ingestion` | Alle 5 Minuten | Liest neue GLPI-Tickets für den Helpdesk-Agenten. |
| `ai-sre-monitoring-alert-ingestion` | Alle 5 Minuten | Liest neue Alarme des verbundenen Monitoring-Tools für den SRE-Agenten. |
| `netbox-inventory-sync` | Stündlich | Hält die Assets mit dem verbundenen Netbox-Inventar abgeglichen. |

Die Jobs der Funktionen Entra, Netbox, GLPI, Monitoring und KI haben nichts zu tun, solange die jeweilige Funktion nicht eingerichtet ist.

Mit mehreren API-Prozessen (`API_WORKERS`) läuft jeder Job trotzdem einmal pro geplantem Zeitpunkt: Die Prozesse einigen sich über die Datenbank, welcher ihn ausführt. Wenn die API stoppt (bei einem Upgrade), erhält ein laufender Job die Abschlusszeit, um fertig zu werden; ein Job, der danach noch läuft, erscheint in der Liste der geplanten Aufgaben als fehlgeschlagen ("interrupted") und läuft zu seinem nächsten Zeitpunkt erneut.

Die Jobs setzen voraus, dass die API als dauerhaft laufender Prozess arbeitet, was die Container tun. `check-expirations` und `send-weekly-reviews` bauen ihre E-Mail-Links aus `APP_BASE_URL`. Ist sie nicht gesetzt, überspringen sie ihre Arbeit, und die API schreibt eine Protokollzeile ("application URL is not configured"). Ist kein E-Mail-Versandweg konfiguriert, überspringen sie den Versand.
