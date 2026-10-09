# On-Premise-Betrieb

Die Befehle auf dieser Seite laufen auf dem KANAP-Server, in `/opt/kanap`, sofern nicht anders angegeben. Mehrere davon verwenden zwei Shell-Variablen. Setzen Sie diese einmal in Ihrer Terminalsitzung, mit Ihren Werten:

```bash
KANAP_HOST=kanap.example.internal    # der Name, den Benutzer eingeben, um KANAP zu öffnen, ohne https://
ADMIN_EMAIL=admin@example.internal   # die E-Mail-Adresse eines Administratorkontos
```

Die `curl`-Befehle auf dieser Seite verwenden `-k`. Sie prüfen, was KANAP antwortet, und akzeptieren daher auch ein Zertifikat, dem der Server nicht vertraut (selbstsigniert oder von einer internen Zertifizierungsstelle, die nicht auf dem Server installiert ist).

## Upgrade-Verfahren

KANAP veröffentlicht etwa einmal im Monat eine neue Version. Der Branch `stable` zeigt immer auf die neueste veröffentlichte Version. Jede Version hat einen Eintrag in `CHANGELOG.md` im Wurzelverzeichnis des Repositorys. Ein Eintrag, der etwas von Ihnen verlangt (eine zu ändernde Einstellung, ein auszuführender Schritt), trägt "Action required" im Titel.

**1. Lesen Sie das Changelog vor dem Pull.** Holen Sie den neuen Stand von `stable` und zeigen Sie nur die Einträge an, die Sie noch nicht haben. Lesen Sie die mit "Action required" markierten Einträge zuerst und tun Sie, was sie verlangen. Dieselben Einträge stehen auf der GitHub-Release-Seite des Repositorys.

```bash
cd /opt/kanap
git fetch origin stable
git diff HEAD origin/stable -- CHANGELOG.md
```

**2. Sichern Sie die Datenbank, die Dateien und die Konfiguration.** Führen Sie die Befehle aus [Vor einem Upgrade](#vor-einem-upgrade) aus. Sie schreiben in ein eigenes Verzeichnis, das die tägliche Sicherung nie berührt. Migrationen gehen nur vorwärts: Diese Sicherung ist der Weg zurück.

**3. Pullen, bauen, starten.**

```bash
cd /opt/kanap
git checkout stable
git pull origin stable
docker compose -f infra/compose.onprem.yml build --pull
docker compose -f infra/compose.onprem.yml up -d
# Der alte API-Container schließt zuerst die laufenden Anfragen, die von ihm eingereihten E-Mails und
# seine laufenden Hintergrundjobs ab (bis zu 20 s) und stoppt dann. Die Migrationen laufen beim Start des neuen.
```

Docker Compose baut die Images `api` und `web` selbst, aus den gerade gepullten Quellen. `--pull` holt außerdem aktualisierte Basis-Images. Ein `up -d` allein behält die alte Version, weil Compose die vorhandenen Images wiederverwendet. Führen Sie immer zuerst `build` aus. Der Build braucht den Arbeitsspeicher aus den [Installationsvoraussetzungen](installation.md#voraussetzungen). Bricht er mit `signal: killed` ab, hatte der Server nicht genug Arbeitsspeicher: Bauen Sie die beiden Images nacheinander (`build --pull api`, dann `build --pull web`) und führen Sie dann `up -d` aus.

**Eine bestimmte Version.** Um eine andere veröffentlichte Version als die neueste zu betreiben, holen Sie die Tags und checken einen davon aus. Der Checkout ist losgelöst (detached). Das `git checkout stable` aus Schritt 3 bringt ihn beim nächsten Upgrade zurück auf den Branch.

```bash
git fetch --tags
git checkout v26.10.1
```

Führen Sie dann die obigen Befehle `build --pull` und `up -d` aus.

**`main` folgen.** Der Branch `main` enthält jede gemergte Änderung, bevor sie als Version veröffentlicht wird. Sie können ihm folgen; empfohlen sind die veröffentlichten Versionen.

**Welche Version läuft.**

```bash
cd /opt/kanap
git describe --tags
curl -sSk -w '\n' "https://${KANAP_HOST}/api/config/public"
```

Der erste Befehl gibt die Version des Checkouts aus. Der zweite antwortet mit einem JSON-Dokument, dessen Feld `version` die Version ist, die die API meldet.

**4. Das Upgrade prüfen.**

```bash
cd /opt/kanap
docker compose -f infra/compose.onprem.yml ps
docker compose -f infra/compose.onprem.yml logs --no-log-prefix api | grep -E '^\[|^Admin seeding|WARN|ERROR|successfully started|Email transport'
curl -sSk -w '\n' "https://${KANAP_HOST}/api/health"
```

- `ps` zeigt `api` und `web` nach etwa einer Minute als `healthy`. Hat die neue Version den Web-Inhalt nicht geändert, behält Compose den laufenden `web`-Container, und `ps` kann statt `infra-web` eine Image-ID zeigen. Das ist erwartet.
- Das API-Protokoll zeigt die Migrationen (`[entrypoint] Migrations complete (N executed).`) und dann den Start der API (`Nest application successfully started`). Lesen Sie auch die anderen Startzeilen: Die [Konfiguration](configuration.md#was-das-api-protokoll-beim-start-zeigt) erklärt jede davon.
- Die Health-Adresse antwortet `{"status":"ok"}`.

Führen Sie dann den Smoke-Test aus. Er prüft die Datenbank, die Anmeldung, die wichtigsten Listen und die Exporte über die öffentliche API. Der Server hat kein Node.js, daher läuft der Test in einem Container. Der erste Lauf auf einem Server lädt das Image `node:24-alpine` von Docker Hub (etwa 240 MB) und behält es: Führen Sie den Test einmal aus, solange der ausgehende Zugriff offen ist (siehe [Firewall-Regeln](configuration.md#ausgehend-ersteinrichtung-und-build)). Geben Sie an der Eingabeaufforderung das aktuelle Passwort des Kontos `ADMIN_EMAIL` ein; beim Tippen wird nichts angezeigt. Das `ADMIN_PASSWORD` aus `.env` wird nur beim ersten Start gelesen und ist daher möglicherweise nicht mehr das richtige. Behalten Sie `-e KANAP_INSECURE_TLS=1`, wenn das Zertifikat selbstsigniert ist (der Container vertraut ihm nicht); entfernen Sie es bei einem Zertifikat einer öffentlichen Zertifizierungsstelle. Bei einem Zertifikat Ihrer internen Zertifizierungsstelle behalten Sie es oder ersetzen es durch `-v /opt/kanap/infra/certs:/certs:ro -e NODE_EXTRA_CA_CERTS=/certs/company-ca.pem`, damit der Container das Zertifikat gegen die Datei der Zertifizierungsstelle in `/opt/kanap/infra/certs/` prüft (siehe [Zertifikate einer internen Zertifizierungsstelle](configuration.md#optional-zertifikate-einer-internen-zertifizierungsstelle)). Fügen Sie auf einer Produktionsinstallation nicht `-e KANAP_WRITE=1` hinzu: Diese Option legt eine temporäre Aufgabe mit einem Anhang an, um den Speicher zu prüfen, was nur zu einer neuen Installation passt.

```bash
read -rsp 'Administrator password: ' KANAP_PASSWORD; echo; export KANAP_PASSWORD
docker run --rm --network host \
  -e KANAP_URL="https://${KANAP_HOST}" -e KANAP_EMAIL="${ADMIN_EMAIL}" -e KANAP_PASSWORD \
  -e KANAP_INSECURE_TLS=1 \
  -v /opt/kanap/scripts/smoke:/smoke:ro node:24-alpine node /smoke/recette.mjs
unset KANAP_PASSWORD
```

Die letzte Zeile der Ausgabe lautet `0 failed`. Mit `KANAP_INSECURE_TLS=1` sind zwei TLS-Warnungen am Anfang der Ausgabe erwartet: die des Skripts selbst und die Node.js-Warnung zu `NODE_TLS_REJECT_UNAUTHORIZED`.

**Zurücksetzen auf die vorherige Version.** Migrationen gehen nur vorwärts, daher spielt ein Zurücksetzen die vor dem Upgrade erstellte Sicherung unter der vorherigen Version wieder ein:

1. Stoppen Sie KANAP: `cd /opt/kanap`, dann `docker compose -f infra/compose.onprem.yml down`. Ein Zurücksetzen beginnt oft in einem neuen Terminal, außerhalb von `/opt/kanap`.
2. Checken Sie die vorherige Version aus und bauen Sie sie. Der Build braucht den ausgehenden Zugriff eines Upgrades: Haben Sie ihn nach dem Upgrade geschlossen, öffnen Sie ihn zuerst (siehe [Firewall-Regeln](configuration.md#ausgehend-ersteinrichtung-und-build)). Führen Sie dann `git checkout v<previous version>` aus (zum Beispiel `git checkout v26.10.1`), danach `docker compose -f infra/compose.onprem.yml build --pull`.
3. Stellen Sie die Datenbank und die Dateien aus dem Verzeichnis `before-upgrade-...` dieses Upgrades wieder her: Wählen Sie die Sicherung und führen Sie dann die Schritte 1 bis 3 aus [Wiederherstellen](#wiederherstellen) im selben Terminal aus. Haben Sie `.env` für die neue Version geändert, vergleichen Sie die Datei mit der Kopie im Verzeichnis `config` der Sicherung. Dieser Befehl vergleicht die Namen der Einstellungen beider Dateien, ohne ihre Werte auszugeben:

    ```bash
    diff <(cut -d= -f1 /opt/kanap/.env | sort) <(sudo cut -d= -f1 "$BACKUP/config/.env" | sort)
    ```

    Er listet nur die Namen auf, die sich unterscheiden. Um die Werte zu vergleichen, öffnen Sie beide Dateien.
4. Starten Sie KANAP: `docker compose -f infra/compose.onprem.yml up -d --wait`.
5. Prüfen Sie es wie in Schritt 4 oben (**Das Upgrade prüfen**). Dessen Befehle verwenden `KANAP_HOST` und `ADMIN_EMAIL` vom Anfang dieser Seite: Setzen Sie diese in einem neuen Terminal zuerst. Die wiederhergestellte Datenbank enthält die Konten und Passwörter zum Zeitpunkt der Sicherung: Ein seitdem geändertes Passwort hat wieder seinen früheren Wert. Der Smoke-Test braucht daher das Passwort, das bei der Sicherung gültig war.

Bauen Sie die vorherige Version, bevor Sie KANAP starten: Ein Start mit der neueren Version würde ihre Migrationen erneut auf der wiederhergestellten Datenbank ausführen.

Bleiben Sie nach dem Zurücksetzen auf dem Tag der Version, zu der Sie zurückgekehrt sind. Das `git checkout stable` des Upgrade-Verfahrens (dessen Schritt 3) bringt den Checkout beim nächsten Upgrade zurück auf den Branch. Der Checkout (`git describe --tags`) und die laufende API (`/api/config/public`, siehe [Welche Version läuft](#upgrade-verfahren)) müssen dieselbe Version zeigen. Weichen sie ab, ändert der nächste `build` die laufende Version.

## Versionsunterstützung

KANAP ist eine Lösung, die sich schnell weiterentwickelt. Versionen erscheinen etwa einmal im Monat, und wir empfehlen, mindestens monatlich zu aktualisieren.
Bei Kunden mit Supportvertrag kann vor der Bearbeitung einer Supportanfrage ein Upgrade auf die neueste Version verlangt werden.

## Sicherung und Wiederherstellung

Sichern Sie drei Dinge: die Datenbank, die Dateien im Speicher und die Konfiguration. Die folgenden Befehle passen zum [Installationsbeispiel](installation-example.md): PostgreSQL und RustFS auf dem Server. Bei einem verwalteten PostgreSQL-Dienst oder einem S3-Anbieter verwenden Sie deren Snapshots, Versionierung oder Replikation und sichern trotzdem die Konfiguration.

**Das Sicherungsverzeichnis vorbereiten** (einmalig). Es enthält personenbezogene Daten und Geheimnisse: Nur `root` und `postgres` können es lesen.

```bash
sudo install -d -o postgres -g postgres -m 0700 /var/backups/kanap
sudo install -d -m 0700 /var/backups/kanap/files /var/backups/kanap/config
```

**Datenbank.** `pg_dump -Fc` schreibt einen komprimierten Dump, den `pg_restore` wieder einliest.

```bash
sudo -u postgres pg_dump -Fc -f /var/backups/kanap/db-$(date +%F).dump kanap
sudo -u postgres pg_restore --list /var/backups/kanap/db-$(date +%F).dump | head -5
```

**Dateien.** Das Werkzeug `rc` aus dem Installationsbeispiel kopiert den Bucket in ein Verzeichnis. Es verwendet den Alias `kanapstore`, den die Installation in der Konfiguration von root angelegt hat. Die Kopie spiegelt den Bucket: In KANAP gelöschte Dateien verschwinden beim nächsten Lauf auch aus ihr. Die Kopie entsteht über die S3-Schnittstelle des Speichers und enthält die Dateien daher unverschlüsselt. Schützen Sie das Verzeichnis entsprechend.

```bash
sudo rc mirror --overwrite --remove kanapstore/kanap-files /var/backups/kanap/files
```

Für jeden anderen S3-Speicher erledigt `rclone` dieselbe Aufgabe (`sudo apt-get install -y rclone`). Ersetzen Sie die Beispielwerte durch die Ihres Speichers. `sudo` gibt nur die Variablen weiter, die `KEEP` nennt, und schreibt ihre Werte in das Systemprotokoll. Die beiden Schlüssel werden daher in der `sudo`-Shell an den Eingabeaufforderungen eingegeben (`AWS_ACCESS_KEY_ID` und `AWS_SECRET_ACCESS_KEY` aus `.env`). `rclone check` vergleicht dann die Kopie mit dem Bucket:

```bash
export RCLONE_S3_PROVIDER=Other
export RCLONE_S3_ENDPOINT='https://s3.example.com'   # S3_ENDPOINT aus .env, so wie der Server ihn erreicht
export RCLONE_S3_REGION='us-east-1'                   # S3_REGION aus .env
export RCLONE_S3_FORCE_PATH_STYLE=true                # S3_FORCE_PATH_STYLE aus .env
export BUCKET=kanap-files                             # S3_BUCKET aus .env
export DEST=/var/backups/kanap/files
KEEP=RCLONE_S3_PROVIDER,RCLONE_S3_ENDPOINT,RCLONE_S3_REGION,RCLONE_S3_FORCE_PATH_STYLE,BUCKET,DEST
sudo --preserve-env="$KEEP" bash -c '
  read -rp "Access key: " RCLONE_S3_ACCESS_KEY_ID
  read -rsp "Secret key: " RCLONE_S3_SECRET_ACCESS_KEY; echo
  export RCLONE_S3_ACCESS_KEY_ID RCLONE_S3_SECRET_ACCESS_KEY
  rclone sync ":s3:${BUCKET}" "$DEST" && rclone check ":s3:${BUCKET}" "$DEST"'
```

`rclone check` endet mit `0 differences found`. rclone kann außerdem `Config file "/root/.config/rclone/rclone.conf" not found - using defaults` ausgeben: Die Variablen ersetzen diese Datei. Verwenden Sie `RCLONE_S3_PROVIDER=AWS` für AWS S3. Für RustFS auf dem Server ist der Endpunkt `http://172.17.0.1:9000`: `host.docker.internal` existiert nur in den Containern.

**Konfiguration.** Bewahren Sie eine Kopie von `/opt/kanap/.env` und von `/etc/default/rustfs` auf. Die erste enthält alle Geheimnisse der Installation, einschließlich `AI_SETTINGS_ENCRYPTION_SECRET`, wenn Sie es verwenden. Die zweite enthält den Verschlüsselungsschlüssel von RustFS: Mit ihm verschlüsselte Dateien sind ohne ihn nicht lesbar. Bewahren Sie auch die nginx-Site-Datei (`/etc/nginx/sites-available/kanap`) und die Zertifikatsdateien auf.

```bash
sudo cp -p /opt/kanap/.env /etc/default/rustfs /var/backups/kanap/config/
```

**Täglich, mit 30 Tagen Historie.** Diese cron-Datei führt die drei Sicherungen nachts aus und löscht Datenbank-Dumps, die älter als 30 Tage sind. Sie schreibt einen Dump pro Tag; die Kopie der Dateien und die Kopie der Konfiguration behalten den jeweils neuesten Stand.

```bash
sudo tee /etc/cron.d/kanap-backup >/dev/null <<'EOF'
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
15 2 * * * postgres pg_dump -Fc -f /var/backups/kanap/db-$(date +\%F).dump kanap
30 2 * * * root rc mirror --overwrite --remove kanapstore/kanap-files /var/backups/kanap/files
45 2 * * * root cp -p /opt/kanap/.env /etc/default/rustfs /var/backups/kanap/config/
0 3 * * * root find /var/backups/kanap -maxdepth 1 -name 'db-*.dump' -mtime +30 -delete
EOF
```

**Das Sicherungsverzeichnis vom Server wegkopieren.** Eine Sicherung auf derselben Festplatte übersteht den Verlust des Servers nicht. Kopieren Sie `/var/backups/kanap` täglich auf einen anderen Rechner, zum Beispiel mit `rsync -a /var/backups/kanap/ <user>@<backup host>:<directory>/` aus einem geplanten Job oder mit dem Sicherungswerkzeug, das Sie bereits verwenden. Die Kopie enthält Geheimnisse und personenbezogene Daten: Schützen Sie ihr Ziel.

**Testen Sie alle paar Monate eine Wiederherstellung** auf einem Ersatzserver, damit Sie wissen, dass die Sicherungen funktionieren, bevor Sie sie brauchen.

### Vor einem Upgrade

Erstellen Sie vor jedem Upgrade eine vollständige Sicherung in einem eigenen, datierten Verzeichnis, zum Beispiel `/var/backups/kanap/before-upgrade-20261009-1400/`. Es enthält `db.dump`, `files/` und `config/`. Die tägliche Sicherung schreibt andere Namen und überschreibt dieses Verzeichnis daher nie.

```bash
B=/var/backups/kanap/before-upgrade-$(date +%Y%m%d-%H%M)
sudo install -d -o postgres -g postgres -m 0700 "$B"
sudo install -d -m 0700 "$B/files" "$B/config"
sudo -u postgres pg_dump -Fc -f "$B/db.dump" kanap
sudo -u postgres pg_restore --list "$B/db.dump" | head -5
sudo rc mirror --overwrite --remove kanapstore/kanap-files "$B/files"
sudo cp -p /opt/kanap/.env /etc/default/rustfs "$B/config/"
echo "$B"
```

Die letzte Zeile gibt das Verzeichnis aus. Notieren Sie es: Ein Zurücksetzen stellt daraus wieder her. Bei einem anderen S3-Speicher ersetzen Sie die Zeile `rc mirror` durch den `rclone`-Block aus der obigen Dateisicherung. Führen Sie ihn im selben Terminal nach den anderen Zeilen aus, mit `export DEST="$B/files"` anstelle seiner Zeile `DEST`.

Behalten Sie dieses Verzeichnis, bis die neue Version einige Wochen ohne Probleme gelaufen ist. Das tägliche `find ... -mtime +30 -delete` der cron-Datei entfernt nur alte tägliche Dumps. Löschen Sie ein altes Verzeichnis `before-upgrade-...` selbst: Listen Sie die Verzeichnisse mit `sudo ls /var/backups/kanap/` auf und führen Sie dann `sudo rm -r` gefolgt vom Pfad des Verzeichnisses aus.

### Wiederherstellen

Diese Schritte ersetzen die Datenbank und die Dateien durch den Inhalt einer Sicherung. Führen Sie sie der Reihe nach in einem Terminal aus: Jeder Schritt verwendet die Variablen, die Sie zuerst setzen.

**Die Sicherung wählen.** Listen Sie die Sicherungen auf:

```bash
sudo ls /var/backups/kanap/
```

Die Liste zeigt die Verzeichnisse `before-upgrade-...` und die täglichen Dumps (`db-YYYY-MM-DD.dump`). Um eine vor einem Upgrade erstellte Sicherung wiederherzustellen, setzen Sie ihr Verzeichnis:

```bash
BACKUP=/var/backups/kanap/before-upgrade-20261009-1400   # Ihr Verzeichnis
DUMP="$BACKUP/db.dump"
FILES="$BACKUP/files"
```

Um stattdessen eine tägliche Sicherung wiederherzustellen, setzen Sie den Dump dieses Tages. Die tägliche Kopie der Dateien enthält den neuesten Stand der Dateien:

```bash
DUMP=/var/backups/kanap/db-2026-10-09.dump   # Ihr Datum
FILES=/var/backups/kanap/files
```

**1. Die Datenbank wiederherstellen.** Dieser Block stoppt KANAP, legt die Datenbank im Besitz der Anwendungsrolle neu an und spielt den Dump ein. Er führt nichts aus, solange die Dump-Datei nicht existiert und `pg_restore` sie nicht lesen kann:

```bash
cd /opt/kanap
sudo test -s "$DUMP" \
  && sudo -u postgres pg_restore --list "$DUMP" </dev/null >/dev/null \
  && docker compose -f infra/compose.onprem.yml down \
  && sudo -u postgres psql -X -v ON_ERROR_STOP=1 -c 'DROP DATABASE IF EXISTS kanap' \
  && sudo -u postgres psql -X -v ON_ERROR_STOP=1 -c 'CREATE DATABASE kanap OWNER kanap TEMPLATE template0' \
  && sudo -u postgres pg_restore -d kanap "$DUMP" </dev/null \
  && echo 'Database restored' \
  || echo 'Stopped. Read the message above; with no message, DUMP is empty or the file is missing.'
```

Die letzte Zeile lautet `Database restored`. Lautet sie `Stopped`, ist nach dem fehlgeschlagenen Befehl nichts mehr gelaufen.

Führen Sie `pg_restore` als `postgres` und ohne `--no-owner` aus. Der Dump hält den Eigentümer jedes Objekts fest (`kanap`), daher gibt die Wiederherstellung die Tabellen mit ihren Einstellungen zur Sicherheit auf Zeilenebene an die Anwendungsrolle zurück. Mit `--no-owner` gehörten die Tabellen `postgres`, und die API könnte sie nicht verwenden. Die Rolle `kanap` muss existieren: Legen Sie sie auf einem neuen Server vor diesem Schritt wie in [Schritt 4 des Installationsbeispiels](installation-example.md#4-postgresql) an.

**2. Die Dateien wiederherstellen.** Die Kopie ersetzt den Inhalt des Buckets. Der Befehl läuft nur, wenn die Kopie existiert:

```bash
sudo test -d "$FILES" \
  && sudo rc mirror --overwrite --remove "$FILES" kanapstore/kanap-files \
  && echo 'Files restored' \
  || echo 'Files not restored. Read the message above; with no message, FILES is empty or the directory is missing.'
```

Ging auch der Speicher verloren, richten Sie ihn vor diesem Schritt wie in [Schritt 5 des Installationsbeispiels](installation-example.md#5-objektspeicher-rustfs) neu ein, mit derselben `/etc/default/rustfs`.

**3. Das Ergebnis prüfen.** Die erste Abfrage gibt `0` aus (keine Tabelle im Besitz einer anderen Rolle) und die zweite eine Zahl größer als `0` (die Tabellen mit Sicherheit auf Zeilenebene):

```bash
sudo -u postgres psql -d kanap -Atc "SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tableowner <> 'kanap'"
sudo -u postgres psql -d kanap -Atc "SELECT count(*) FROM pg_class WHERE relrowsecurity AND relforcerowsecurity"
```

**4. KANAP starten.**

```bash
cd /opt/kanap
docker compose -f infra/compose.onprem.yml up -d --wait
```

Führen Sie dann den Smoke-Test aus [Das Upgrade prüfen](#upgrade-verfahren) aus und öffnen Sie KANAP in einem Browser. Konten und Passwörter entsprechen dem Stand der Sicherung: Melden Sie sich mit dem Passwort an, das damals gültig war.

## Image für Wartungswerkzeuge

Das API-Image enthält nur die kompilierte Anwendung. Ein Wartungsbefehl, der TypeScript braucht, etwa `npm run typeorm`, läuft in einem zweiten Image, das aus denselben Quellen gebaut wird. Bauen Sie es direkt vor jeder Verwendung aus dem aktuellen Checkout, damit es zur laufenden Version passt. Der Build verwendet die zwischengespeicherten Layer des API-Images wieder und dauert etwa 10 bis 20 Sekunden, wenn das API-Image bereits gebaut ist:

```bash
cd /opt/kanap
docker build --target dev -t kanap-api-tools backend
```

Führen Sie einen Befehl darin mit derselben `.env` und demselben Zertifikatsverzeichnis wie die API aus (siehe [Zertifikate einer internen Zertifizierungsstelle](configuration.md#optional-zertifikate-einer-internen-zertifizierungsstelle)). Dieses Beispiel listet die Migrationen auf und zeigt, ob sie angewendet sind:

```bash
cd /opt/kanap
docker run --rm --env-file .env --add-host host.docker.internal:host-gateway \
  -v /opt/kanap/infra/certs:/etc/kanap/certs:ro \
  kanap-api-tools npm run typeorm -- migration:show
```

## PostgreSQL-Einstellungen

Die Standardwerte von PostgreSQL sind für eine kleine Maschine ausgelegt. `infra/postgres/kanap-pg-tune.sh` gibt Einstellungen passend zum Arbeitsspeicher Ihres Servers aus (Arbeitsspeicher, SSD-Kosten, Protokoll langsamer Anweisungen, Anweisungsstatistiken). Führen Sie es auf dem PostgreSQL-Server aus und lesen Sie die Datei, bevor Sie sie anwenden: Ihr Kopf erklärt jeden Wert. Das Installationsbeispiel wendet sie in [Schritt 4](installation-example.md#postgresql-fur-diesen-server-dimensionieren) an.

```bash
cd /opt/kanap
PGVER=18   # 16 unter Ubuntu 24.04
# Die Bibliotheken, die PostgreSQL bereits vorlädt (oft keine): Das Skript behält sie bei.
CURRENT=$(sudo -u postgres psql -XAtc 'SHOW shared_preload_libraries')
# PostgreSQL auf demselben Server wie KANAP (--dedicated ergänzen, wenn es den Server für sich allein hat)
sh infra/postgres/kanap-pg-tune.sh --preload "$CURRENT" | sudo tee /etc/postgresql/${PGVER}/main/conf.d/kanap.conf >/dev/null
sudo systemctl restart postgresql
sudo -u postgres psql -d kanap -c 'CREATE EXTENSION IF NOT EXISTS pg_stat_statements'
```

Hat die Datenbank die Erweiterung bereits, wie nach dem Installationsbeispiel, gibt der letzte Befehl `NOTICE:  extension "pg_stat_statements" already exists, skipping` aus. Das ist erwartet.

Zwei Prüfungen vor dem Neustart, beide vom Skript erledigt, das die Zeile `shared_preload_libraries` auskommentiert schreibt, wenn eine davon fehlschlägt:

- **Die Liste der vorgeladenen Bibliotheken.** `shared_preload_libraries` ist eine einzige Liste, und der Wert in `kanap.conf` ersetzt den in `postgresql.conf`. Ohne `--preload` stellen Sie den Wert von `SHOW shared_preload_libraries` selbst voran (zum Beispiel `'pg_cron,pg_stat_statements'`) und entfernen dann das `#`.
- **Die Bibliothek selbst.** PostgreSQL startet nicht, wenn eine vorgeladene Bibliothek fehlt. Unter Debian und Ubuntu wird sie mit PostgreSQL ausgeliefert; unter RHEL und abgeleiteten Systemen installieren Sie das contrib-Paket (`postgresql16-contrib`). Prüfen Sie mit `ls "$(pg_config --pkglibdir)/pg_stat_statements.so"`.

Der Neustart ist einmal nötig, für die Speichereinstellung und die Anweisungsstatistiken: Planen Sie ihn in einem Wartungsfenster ein, denn KANAP erreicht seine Datenbank nicht, während PostgreSQL neu startet. Anweisungen, die länger als 500 ms dauern, erscheinen danach im PostgreSQL-Protokoll, ohne ihre Parameter (`log_parameter_max_length = 0`: Sie können personenbezogene Daten enthalten). `pg_stat_statements` listet die aufwendigsten Anweisungen:

```sql
SELECT calls, round(mean_exec_time) AS avg_ms, left(query, 80) AS query
FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 10;
```

Die Migrationen von KANAP lassen außerdem den Autovacuum auf den beiden größten Tabellen (Budgetbeträge) früher starten. Das braucht keinen Neustart und keinen Arbeitsspeicher.

## Monitoring

**Health.** Die API antwortet auf `GET /health` an ihrem eigenen Port und auf `GET /api/health` über den Reverse Proxy. Beide liefern `{"status":"ok"}`:

```bash
curl -sSk -w '\n' http://127.0.0.1:8080/health
curl -sSk -w '\n' "https://${KANAP_HOST}/api/health"
```

**Container.** `docker compose -f infra/compose.onprem.yml ps` zeigt `healthy` für `api` und `web`, sobald sie antworten. Docker meldet diesen Status nur: Er löst keinen Neustart aus.

```bash
cd /opt/kanap
docker compose -f infra/compose.onprem.yml ps
docker compose -f infra/compose.onprem.yml logs -f api
```

Docker behält pro Container höchstens 5 Protokolldateien zu 10 MB (etwa 50 MB), das Protokoll reicht also nur so weit zurück.

**Wichtige Kennzahlen:**

- Laufende Container (`api`, `web`)
- API-Arbeitsspeicher unter ~1 GB pro API-Prozess
- Datenbankverbindungen
- Speicherbelegung

### Nach einem Neustart

Nichts zu tun: Alles startet von selbst. PostgreSQL und nginx starten als Dienste, der Speicher des Installationsbeispiels startet nach Docker, und Docker startet die Container `api` und `web` wieder. Die API antwortet etwa 10 Sekunden nach dem Hochfahren des Servers. Ist PostgreSQL langsamer als Docker, versucht die API die Datenbank erneut (30 Mal im Abstand von 2 Sekunden). Drei Prüfungen:

```bash
cd /opt/kanap
docker compose -f infra/compose.onprem.yml ps
curl -sSk -w '\n' "https://${KANAP_HOST}/api/health"
ss -ltn | grep 172.17.0.1:9000
```

- `ps` zeigt `api` und `web` als `healthy`. In den ersten etwa 30 Sekunden nach dem Hochfahren kann es noch `health: starting` zeigen: Führen Sie den Befehl erneut aus.
- Die Health-Adresse antwortet `{"status":"ok"}`.
- Der letzte Befehl zeigt eine Zeile mit `172.17.0.1:9000`: Der Speicher des Installationsbeispiels lauscht. Bei einem anderen Speicher prüfen Sie ihn auf Ihre eigene Weise.

### API-Metriken für ein Monitoring-Tool

Setzen Sie `OPS_METRICS_TOKEN` in `.env` (mindestens 24 Zeichen, zum Beispiel `openssl rand -hex 32`) und erstellen Sie die API neu (`docker compose -f infra/compose.onprem.yml up -d api`). Ihr Monitoring-Tool kann dann Folgendes lesen:

```bash
OPS_METRICS_TOKEN=$(grep '^OPS_METRICS_TOKEN=' /opt/kanap/.env | cut -d= -f2-)
curl -sSk -w '\n' -H "Authorization: Bearer ${OPS_METRICS_TOKEN}" "https://${KANAP_HOST}/api/ops/metrics"
```

Die Antwort ist JSON. Ohne die Einstellung antwortet die Adresse mit 404. Sie antwortet auch, wenn die API überlastet ist: Die Werte, die die Datenbank brauchen, sind dann mit `db.statsStale` markiert. Die zu beobachtenden Felder:

| Feld | Was es aussagt |
|---|---|
| `health.status` | `ok`, `warn` oder `critical`, nach den folgenden Schwellenwerten. `health.alerts` listet, was nicht stimmt und was zu tun ist |
| `topRoutes` | Anfragen pro Route über 5 Minuten, mit den Antwortzeiten p50, p95 und p99 in Millisekunden |
| `process.eventLoopLagMs.p95` | Wie lange der Haupt-Thread der API Anfragen in der letzten Minute warten ließ (direkt nach einem Start der bisherige Teil einer Minute) |
| `db.pool.inUse`, `db.pool.inUseMax1m`, `db.pool.waitingCount` | Aktuell genutzte Datenbankverbindungen, das Maximum der letzten Minute, Anfragen, die auf eine Verbindung warten |
| `db.pool.wait.p95Ms1m`, `db.pool.wait.failures5m` | Zeit bis zum Erhalt einer Datenbankverbindung; Anfragen, die keine erhalten haben (mit "busy" beantwortet) |
| `windows.5m.statusClasses` | Antworten pro Statusklasse über 5 Minuten |
| `processes`, `aggregate` | Bei mehreren API-Prozessen: jeder einzeln und alle zusammen |

Alarmschwellen (`health` wendet sie an; bei mehreren API-Prozessen auf alle zusammen, beim Datenbank-Pool auf den vollsten). Ein Alarm wird oberhalb der Schwelle ausgelöst:

| Alarm | Warnung | Kritisch | Was zu tun ist |
|---|---|---|---|
| Event-Loop p95 (1 min) | 100 ms | 500 ms | API-Prozesse hinzufügen (`API_WORKERS`), wenn der Server freie Kerne hat |
| Warten auf eine Datenbankverbindung, p95 (1 min) | 50 ms | 1 s | `DB_POOL_MAX` innerhalb von `max_connections` von PostgreSQL erhöhen |
| Genutzte Verbindungen, Höchstwert über 1 min | 90 % des Pools | | Dasselbe |
| Anfragen, die keine Verbindung erhalten haben (5 min) | | jede | Prüfen, dass PostgreSQL läuft und `max_connections` nicht erreicht ist |
| Serverfehler (5 min, ab 20 Anfragen) | 1 % | 5 % | Das API-Protokoll lesen |
| p95 einer Route (5 min, ab 20 Anfragen) | 1 s | 3 s | Mit dem Namen der Route melden; Importe, Exporte und KI-Routen werden nicht gezählt |
| Arbeitsspeicher eines API-Prozesses | 1 GB | | Die API neu starten; melden, wenn es wieder auftritt |

## Fehlerbehebung

Beginnen Sie mit dem API-Protokoll: `docker compose -f infra/compose.onprem.yml logs --no-log-prefix --tail=200 api`.

| Symptom | Prüfen | Lösung |
|---------|-------|----------|
| Container starten nicht | `docker compose -f infra/compose.onprem.yml logs api` | Auf Fehler beim Start prüfen |
| Das Protokoll wiederholt `[entrypoint] DB not ready or migration failed (attempt N)` | Den Text nach `attempt N`, `DATABASE_URL`, `pg_hba.conf`, die Firewall | Die API versucht es 30 Mal im Abstand von 2 Sekunden und stoppt dann. Beheben Sie die in der Meldung genannte Ursache, dann `docker compose -f infra/compose.onprem.yml up -d api` |
| Die obige Meldung lautet `self-signed certificate`, `unable to verify the first certificate` oder `unable to get local issuer certificate` | Das Ende von `DATABASE_URL` | `sslmode=require` prüft das Serverzertifikat vollständig. Verwenden Sie `sslmode=disable` für ein PostgreSQL auf demselben Server. Hat die Zertifizierungsstelle Ihres Unternehmens das Zertifikat signiert, behalten Sie `require` und lassen die API dieser Zertifizierungsstelle vertrauen (siehe [Zertifikate einer internen Zertifizierungsstelle](configuration.md#optional-zertifikate-einer-internen-zertifizierungsstelle)). Andernfalls verwenden Sie `sslmode=no-verify` für eine verschlüsselte Verbindung ohne Prüfung. Siehe [Konfiguration](configuration.md#erforderlich-datenbank) |
| Die obige Meldung lautet `The server does not support SSL connections` | Das Ende von `DATABASE_URL` | Verwenden Sie `sslmode=disable` oder aktivieren Sie TLS in PostgreSQL |
| `curl: (6) Could not resolve host` | Den Namen in der Adresse | Der Server löst den Namen über DNS oder `/etc/hosts` auf. Ergänzen Sie den Eintrag oder eine Zeile `127.0.0.1 <name>` (Ihr Name anstelle von `<name>`) in `/etc/hosts` für die Prüfungen auf dem Server |
| `[DB] pool budget exceeded` im API-Protokoll | `API_WORKERS`, `DB_POOL_MAX`, `max_connections` von PostgreSQL | Senken Sie `DB_POOL_MAX` auf den Wert aus der Meldung (oder `API_WORKERS`) oder erhöhen Sie `max_connections` |
| "Database connection failed" | `DATABASE_URL` prüfen | Erreichbarkeit und Zugangsdaten von PostgreSQL prüfen. Ein Passwort mit `@ : / # ? %` muss in der URL prozentkodiert werden |
| Hoch- oder Herunterladen schlägt fehl ("S3 error", `S3_BUCKET is not configured`) | Die `S3_*`-Variablen | Stellen Sie sicher, dass der Bucket existiert und die Schlüssel und Berechtigungen stimmen |
| `Authorization header malformed` oder `unexpected scope` in einem Speicherfehler | `S3_REGION` | Verwenden Sie die Region, die Ihr Speicher erwartet (`us-east-1` für RustFS, bei Garage die in seiner Konfiguration gesetzte) |
| `getaddrinfo ENOTFOUND <bucket>.host.docker.internal` | `S3_FORCE_PATH_STYLE` | Setzen Sie `S3_FORCE_PATH_STYLE=true` für RustFS, MinIO, Garage und andere selbst betriebene Speicher |
| Warnung `PutObject fallback used` | Die Verschlüsselung des Speichers | Der Speicher hat die Verschlüsselungsanfrage abgelehnt. Setzen Sie bei RustFS `RUSTFS_SSE_S3_MASTER_KEY` in `/etc/default/rustfs` und starten Sie den Dienst neu (`sudo systemctl restart rustfs`) |
| Warnung `[RATE-LIMIT] ... RATE_LIMIT_TRUST_PROXY not set` | `.env` | Setzen Sie `RATE_LIMIT_TRUST_PROXY=true` (nginx davor) oder `false` (nichts davor), dann `up -d api`. Siehe [Konfiguration](configuration.md#optional-erweitert) |
| Alle teilen sich ein Anmeldelimit (`429` für viele Benutzer) | `RATE_LIMIT_TRUST_PROXY` und den Proxy | Mit einem Proxy davor setzen Sie `true` und lassen den Proxy `X-Forwarded-For` senden |
| `[SECURITY]`-Warnung bei jedem Start | `ADMIN_PASSWORD`, `JWT_SECRET` | Ändern Sie das Passwort des Administrators in der Anwendung, oder siehe [Passwort zurücksetzen](#passwort-zurucksetzen). Verwenden Sie ein `JWT_SECRET` mit mindestens 32 Zeichen |
| Migration fehlgeschlagen | PostgreSQL-Version | Muss 16+ sein, Erweiterungen verfügbar |
| 502 vom Reverse Proxy | `docker compose -f infra/compose.onprem.yml ps` | Stellen Sie sicher, dass der api-Container auf Port 8080 läuft |
| 413 vom Reverse Proxy bei einem Upload | `client_max_body_size` | Setzen Sie `client_max_body_size 50m;` in der nginx-Datei |
| Eine E-Mail zum Zurücksetzen kommt nicht an, und das API-Protokoll enthält eine `ERROR`-Zeile mit `unable to verify the first certificate` oder `self-signed certificate` und dem Code `ESOCKET` | Das Zertifikat des Mail-Relays | Die API vertraut der Zertifizierungsstelle nicht, die das Zertifikat des Relays signiert hat. Geben Sie ihr die Datei der Zertifizierungsstelle (siehe [Zertifikate einer internen Zertifizierungsstelle](configuration.md#optional-zertifikate-einer-internen-zertifizierungsstelle)). Die Zertifizierungsstelle auf dem Server selbst zu installieren, ändert am Container nichts |
| Anmeldung nicht möglich | Das Passwort | `.env` legt den Administrator nur beim ersten Start an. Ändern Sie das Passwort in der Anwendung oder verwenden Sie [Passwort zurücksetzen](#passwort-zurucksetzen) |

## Passwort zurücksetzen

**Empfohlen:** Konfigurieren Sie E-Mail (Resend-API oder Single-Tenant-SMTP) und verwenden Sie **Passwort vergessen** auf der Anmeldeseite.

**Ausweichlösung (SQL):** Ist E-Mail nicht konfiguriert, setzen Sie das Passwort direkt in der Datenbank zurück. Das geschieht in zwei Schritten: das neue Passwort im API-Container hashen und dann den Hash als PostgreSQL-Superuser schreiben. Die Anwendungsrolle kann den zweiten Schritt nicht ausführen: Die Sicherheit auf Zeilenebene verbirgt jeden Benutzer vor ihr, wenn kein Arbeitsbereich ausgewählt ist.

Setzen Sie in der ersten Zeile die E-Mail-Adresse des Kontos und geben Sie dann an der Eingabeaufforderung das neue Passwort ein (beim Tippen wird nichts angezeigt):

```bash
cd /opt/kanap
USER_EMAIL=admin@example.internal   # das zurückzusetzende Konto
read -rsp 'New password: ' NEW_PASSWORD; echo
HASH=$(printf '%s' "$NEW_PASSWORD" | docker compose -f infra/compose.onprem.yml exec -T api node -e "let p='';process.stdin.on('data',d=>p+=d).on('end',()=>require('argon2').hash(p).then(console.log))")
unset NEW_PASSWORD
sudo -u postgres psql -d kanap -v email="${USER_EMAIL}" <<SQL
UPDATE users SET password_hash = '${HASH}' WHERE lower(email) = lower(:'email');
SQL
```

Das Passwort und sein Hash laufen über die Standardeingabe, daher erscheint keines von beiden in der Prozessliste oder im Systemprotokoll. `psql` antwortet `UPDATE 1`. `UPDATE 0` bedeutet, dass kein Konto diese E-Mail-Adresse hat.

Diese SQL-Methode ist eine letzte Ausweichlösung für ausgesperrte Administratoren.
