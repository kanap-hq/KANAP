# On-Premise-Betrieb

## Upgrade-Verfahren

```bash
# 1. Datenbank und Speicher sichern (Ihre Verantwortung)

# 2. Neueste Änderungen pullen und neu bauen
cd kanap
git pull origin main
docker build -t kanap-api:latest ./backend
docker build -t kanap-web:latest ./frontend

# 3. Container neustarten (Migrationen laufen automatisch)
docker compose -f infra/compose.onprem.yml up -d
# Der alte API-Container beendet zuerst die laufenden Anfragen, die in die Warteschlange
# gestellten E-Mails und seine laufenden Hintergrundjobs (bis zu 20 s), dann stoppt er.

# 4. Start überprüfen
docker compose -f infra/compose.onprem.yml logs -f api
# Auf "Application started"-Meldung warten
```

**Breaking Changes:** Prüfen Sie `CHANGELOG.md` vor dem Upgrade.

**Rollback:** Datenbank aus Backup wiederherstellen. Migrationen sind nur vorwärtsgerichtet.

## Versionsunterstützung

KANAP ist eine sich schnell weiterentwickelnde Lösung und wir empfehlen monatliche Upgrades.
Für Kunden mit Supportvertrag kann vor der Bearbeitung einer Supportanfrage ein Upgrade auf die neueste Version erforderlich sein.

## Backup & Wiederherstellung

- **PostgreSQL:** Verwenden Sie `pg_dump`/`pg_restore` oder verwaltete DB-Backups
- **S3-Speicher:** Verwenden Sie Bucket-Versionierung, Replikation oder Provider-Backups

**Empfehlung:** Tägliche Datenbank-Backups, mindestens 30 Tage aufbewahren.

## PostgreSQL-Einstellungen

Die Standardwerte von PostgreSQL sind für eine kleine Maschine ausgelegt. `infra/postgres/kanap-pg-tune.sh` gibt Einstellungen aus, die anhand des Arbeitsspeichers Ihres Servers dimensioniert sind (Speicher, SSD-Kosten, Protokoll langsamer Anweisungen, Anweisungsstatistiken). Führen Sie es auf dem PostgreSQL-Server aus und lesen Sie die Datei, bevor Sie sie anwenden: Der Kopf erklärt jeden Wert.

```bash
# Die von PostgreSQL bereits vorgeladenen Bibliotheken (oft keine): Das Skript behält sie bei.
CURRENT=$(sudo -u postgres psql -XAtc 'SHOW shared_preload_libraries')
# PostgreSQL auf demselben Server wie KANAP (fügen Sie --dedicated hinzu, wenn es den Server allein hat)
sh infra/postgres/kanap-pg-tune.sh --preload "$CURRENT" | sudo tee /etc/postgresql/16/main/conf.d/kanap.conf
sudo systemctl restart postgresql
sudo -u postgres psql -d kanap -c 'CREATE EXTENSION IF NOT EXISTS pg_stat_statements'
```

Zwei Prüfungen vor dem Neustart, beide vom Skript durchgeführt, das die Zeile `shared_preload_libraries` auskommentiert schreibt, wenn eine davon fehlschlägt:

- **Die Liste der vorgeladenen Bibliotheken.** `shared_preload_libraries` ist eine einzige Liste, und der Wert in `kanap.conf` ersetzt den in `postgresql.conf`. Ohne `--preload` fügen Sie den Wert von `SHOW shared_preload_libraries` selbst voran (zum Beispiel `'pg_cron,pg_stat_statements'`), und entfernen Sie dann das `#`.
- **Die Bibliothek selbst.** PostgreSQL startet nicht, wenn eine vorgeladene Bibliothek fehlt. Sie wird bei Debian und Ubuntu mit PostgreSQL mitgeliefert; bei RHEL und Derivaten installieren Sie das Contrib-Paket (`postgresql16-contrib`). Prüfen Sie mit `ls "$(pg_config --pkglibdir)/pg_stat_statements.so"`.

Der Neustart ist einmalig nötig, für die Speichereinstellung und die Anweisungsstatistiken: Planen Sie ihn in einem Wartungsfenster, KANAP kann seine Datenbank während des PostgreSQL-Neustarts nicht erreichen. Anweisungen, die länger als 500 ms dauern, erscheinen danach im PostgreSQL-Protokoll, ohne ihre Parameter (`log_parameter_max_length = 0`: Sie können personenbezogene Daten enthalten). `pg_stat_statements` listet die teuersten Anweisungen:

```sql
SELECT calls, round(mean_exec_time) AS avg_ms, left(query, 80) AS query
FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 10;
```

Die Migrationen von KANAP lassen die Autovakuum-Bereinigung auf den beiden größten Tabellen (die Budgetbeträge) auch früher starten. Das erfordert weder Neustart noch Speicher.

## Monitoring

**Health-Endpunkt:**

`GET /api/health` → `{ "status": "ok" }`

```bash
curl https://kanap.firma.de/api/health
```

**Container-Status:**
```bash
docker compose -f infra/compose.onprem.yml ps
docker compose -f infra/compose.onprem.yml logs -f api
```

**Wichtige Kennzahlen:**
- Container laufen (`api`, `web`)
- API-Speicher unter ~1 GB pro API-Prozess
- Datenbankverbindungen
- Speichernutzung

### API-Metriken für ein Monitoring-Tool

Setzen Sie `OPS_METRICS_TOKEN` in `.env` (24 Zeichen oder mehr, zum Beispiel `openssl rand -hex 32`) und starten Sie die API neu. Ihr Monitoring-Tool kann dann lesen:

```bash
curl -s -H "Authorization: Bearer $OPS_METRICS_TOKEN" https://kanap.firma.de/api/ops/metrics
```

Die Antwort ist JSON. Ohne diese Einstellung antwortet die Adresse mit 404. Sie antwortet auch, wenn die API überlastet ist: Die Werte, die die Datenbank benötigen, sind dann mit `db.statsStale` markiert. Die zu beobachtenden Felder:

| Feld | Was es zeigt |
|---|---|
| `health.status` | `ok`, `warn` oder `critical`, anhand der Schwellenwerte unten. `health.alerts` listet, was nicht stimmt und was zu tun ist |
| `topRoutes` | Anfragen pro Route über 5 Minuten, mit Antwortzeiten p50, p95 und p99 in Millisekunden |
| `process.eventLoopLagMs.p95` | Wie lange der Haupt-Thread der API Anfragen in der letzten Minute warten ließ |
| `db.pool.inUse`, `db.pool.inUseMax1m`, `db.pool.waitingCount` | Gerade genutzte Datenbankverbindungen, das Maximum der letzten Minute, auf eine wartende Anfragen |
| `db.pool.wait.p95Ms1m`, `db.pool.wait.failures5m` | Zeit, um eine Datenbankverbindung zu erhalten; Anfragen, die keine erhielten (Antwort „busy“) |
| `windows.5m.statusClasses` | Antworten pro Statusklasse über 5 Minuten |
| `processes`, `aggregate` | Bei mehreren API-Prozessen: jeder einzeln, und alle zusammen |

Alarmschwellen (`health` wendet sie an; bei mehreren API-Prozessen auf alle zusammen, und den Datenbankpool auf den am stärksten ausgelasteten). Ein Alarm löst oberhalb des Schwellenwerts aus:

| Alarm | Warnung | Kritisch | Was zu tun ist |
|---|---|---|---|
| Event-Loop p95 (1 min) | 100 ms | 500 ms | API-Prozesse hinzufügen (`API_WORKERS`), wenn der Server freie Kerne hat |
| Warten auf eine Datenbankverbindung, p95 (1 min) | 50 ms | 1 s | `DB_POOL_MAX` erhöhen, innerhalb von `max_connections` von PostgreSQL |
| Genutzte Verbindungen, Höchstwert über 1 min | 90 % des Pools | | Dasselbe |
| Anfragen ohne Verbindung (5 min) | | beliebig | Prüfen, ob PostgreSQL läuft und `max_connections` nicht erreicht ist |
| Serverfehler (5 min, ab 20 Anfragen) | 1 % | 5 % | API-Protokoll lesen |
| p95 einer Route (5 min, ab 20 Anfragen) | 1 s | 3 s | Mit dem Routennamen melden; Import-, Export- und KI-Routen werden nicht gezählt |
| Speicher eines API-Prozesses | 1 GB | | API neu starten; melden, wenn es wiederkehrt |

## Fehlerbehebung

| Symptom | Prüfen | Lösung |
|---------|--------|--------|
| Container starten nicht | `docker compose logs api` | Auf Startfehler prüfen |
| `[DB] pool budget exceeded` im API-Protokoll | `API_WORKERS`, `DB_POOL_MAX`, PostgreSQL `max_connections` | `DB_POOL_MAX` auf den im Meldungstext genannten Wert senken (oder `API_WORKERS`), oder `max_connections` erhöhen |
| "Database connection failed" | `DATABASE_URL` überprüfen | PostgreSQL-Erreichbarkeit/Zugangsdaten prüfen |
| "S3 error" | S3_*-Variablen überprüfen | Sicherstellen, dass Bucket existiert und Berechtigungen korrekt sind |
| Migration fehlgeschlagen | PostgreSQL-Version prüfen | Muss 16+ sein, Erweiterungen verfügbar |
| 502 vom Reverse Proxy | `docker compose ps` | Sicherstellen, dass api-Container auf Port 8080 läuft |
| Anmeldung nicht möglich | `.env`-Zugangsdaten überprüfen | Passwortzurücksetzung unten verwenden |

## Passwortzurücksetzung

**Empfohlen:** E-Mail konfigurieren (Resend API oder Single-Tenant SMTP) und den „Passwort vergessen"-Flow verwenden.

**Fallback (SQL):** Wenn E-Mail nicht konfiguriert ist, Passwörter direkt in der Datenbank zurücksetzen.

**1) Passwort-Hash generieren:**

```bash
# Mit Node.js und argon2
# (argon2 ist eine Produktionsabhängigkeit im API-Image)
docker compose -f infra/compose.onprem.yml exec api \
  node -e "require('argon2').hash('NeuesPasswort123!').then(h => console.log(h))"
```

**2) Benutzer in PostgreSQL aktualisieren:**

```sql
UPDATE users
SET password_hash = '$argon2id$v=19$m=65536,t=3,p=4$...'
WHERE email = 'benutzer@firma.de';
```

Diese SQL-Methode ist ein letzter Ausweg für ausgesperrte Administratoren.
