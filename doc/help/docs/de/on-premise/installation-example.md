# Installationsbeispiel: Ubuntu 26.04

Dieser Leitfaden führt durch eine vollständige On-Premise-Installation auf einem einzelnen Server mit Ubuntu 26.04 LTS, mit PostgreSQL auf dem Host, RustFS als S3-kompatiblem Speicher und nginx als TLS-Reverse-Proxy. Jeder Schritt nennt die einzufügenden Befehle und das erwartete Ergebnis.

Ubuntu 24.04 LTS funktioniert mit zwei Unterschieden, die jeweils an der betreffenden Stelle vermerkt sind: PostgreSQL liegt in Version 16 vor (setzen Sie `PGVER=16` in Schritt 0), und nginx in Version 1.24 (ein `sed`-Befehl in Schritt 8).

Passen Sie das Beispiel an Ihre Umgebung an. Die Leitfäden [Installation](installation.md) und [Konfiguration](configuration.md) bleiben die Referenz.

!!! tip "Lieber automatisieren?"
    Ein KI-Coding-Agent kann diese gesamte Installation mit einem einzigen Prompt für Sie ausführen. Siehe [KI-gestützte Installation](installation-ai.md).

## Architektur

```
Browser → nginx (:443, TLS) → Docker containers (api :8080, web :8081)
                             → PostgreSQL (:5432, on host)
                             → RustFS (172.17.0.1:9000, on host)
```

Alle Dienste laufen auf einem Server. Die Container erreichen die Dienste des Hosts über `host.docker.internal`, die Docker-Bridge-Adresse des Servers (`172.17.0.1`). PostgreSQL lauscht auf allen Adressen des Servers, und die Firewall und `pg_hba.conf` lassen nur die Docker-Netzwerke zu. Der Speicher lauscht nur auf der Docker-Bridge-Adresse.

---

## 0. Vor dem Start

Sie benötigen:

- Einen frisch installierten Server mit Ubuntu 26.04 LTS, mindestens 6 GB RAM (8 GB empfohlen), 20 GB Festplatte und ausgehendem Internetzugang. Der Image-Build bei der Installation und bei jedem Upgrade braucht diesen Speicher.
- Einen Benutzer mit `sudo`-Rechten (nicht `root`). Alle folgenden Befehle laufen als dieser Benutzer.
- Den Namen, den Benutzer eingeben, um KANAP zu öffnen, zum Beispiel `kanap.example.internal`. Siehe [Name und Zertifikat](installation.md#name-und-zertifikat). Dieses Beispiel verwendet einen internen Namen mit einem selbstsignierten Zertifikat. Schritt 8 zeigt die beiden anderen Fälle.
- Die E-Mail-Adresse des ersten Administrators.
- Den Namen Ihrer Organisation.

Wählen Sie die vier Werte in den ersten Zeilen und fügen Sie dann den ganzen Block ein. Behalten Sie die einfachen Anführungszeichen um den Namen der Organisation bei: Er kann Leerzeichen enthalten. Enthält der Name einen Apostroph, verwenden Sie stattdessen doppelte Anführungszeichen: `ORG_NAME="Caisse d'Epargne"`. Verwenden Sie im Namen weder `$` noch Backticks. Der Block schreibt die Werte zusammen mit den erzeugten Geheimnissen in `~/kanap-install.env`, eine Datei, die nur Sie lesen können. Spätere Schritte lesen diese Datei mit `. ~/kanap-install.env`, sodass jeder Block auch in einer neuen Terminalsitzung funktioniert. Kein Befehl gibt die Geheimnisse aus.

```bash
PGVER=18                            # 16 unter Ubuntu 24.04
KANAP_HOST=kanap.example.internal   # der Name, den Benutzer eingeben, ohne https://
ADMIN_EMAIL=admin@example.internal  # E-Mail-Adresse des ersten Administrators
ORG_NAME='Example Company'          # Name Ihrer Organisation, einmalig gesetzt: Die Anwendung kann ihn später nicht ändern

install -m 600 /dev/null ~/kanap-install.env
printf 'ORG_NAME=%q\n' "${ORG_NAME}" >> ~/kanap-install.env
cat >> ~/kanap-install.env <<EOF
PGVER=${PGVER}
KANAP_HOST=${KANAP_HOST}
ADMIN_EMAIL=${ADMIN_EMAIL}
PG_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 32)
KANAP_ADMIN_PASSWORD=$(openssl rand -base64 18)
S3_SECRET_KEY=$(openssl rand -hex 32)
RUSTFS_ROOT_USER=rustfsadmin-$(openssl rand -hex 4)
RUSTFS_ROOT_PASSWORD=$(openssl rand -hex 32)
RUSTFS_SSE_S3_MASTER_KEY=$(openssl rand -base64 32)
EOF
```

Das Datenbankpasswort ist hexadezimal (Buchstaben und Ziffern) und braucht daher in der Datenbank-URL keine Kodierung. Ein Passwort, das `@ : / # ? %` enthält, muss dort prozentkodiert werden.

---

## 1. Docker Engine

Installieren Sie Docker aus dem offiziellen Repository:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg git

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

Fügen Sie Ihren Benutzer der Gruppe `docker` hinzu:

```bash
sudo usermod -aG docker "$USER"
```

Schließen Sie Ihre Sitzung und öffnen Sie eine neue, damit die Gruppe wirksam wird. Prüfen Sie dann, dass Docker ohne `sudo` antwortet:

```bash
docker ps
```

Der Befehl gibt eine Kopfzeile aus, die mit `CONTAINER ID` beginnt, und noch keinen Container.

---

## 2. Firewall

Ein frisch installierter Server nimmt jede Verbindung an. Richten Sie die Firewall ein, bevor Sie PostgreSQL und den Speicher installieren, damit keiner von beiden je im Netzwerk offen ist. Schließen Sie alles außer SSH, HTTP und HTTPS, und lassen Sie nur die Docker-Netzwerke PostgreSQL (5432) und den Speicher (9000) erreichen. Die Regeln dürfen Ports nennen, auf denen noch nichts lauscht. **Erlauben Sie SSH zuerst**, sonst sperren Sie sich beim Start der Firewall aus.

```bash
sudo apt-get install -y ufw
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow from 172.16.0.0/12 to any port 5432 proto tcp
sudo ufw allow from 172.16.0.0/12 to any port 9000 proto tcp
sudo ufw --force enable
sudo ufw status
```

Der Status listet `OpenSSH`, `80/tcp`, `443/tcp` und die beiden Regeln für `172.16.0.0/12`. Er listet außerdem `OpenSSH (v6)`, `80/tcp (v6)` und `443/tcp (v6)`: dieselben drei Regeln für IPv6. Lauscht SSH auf einem anderen Port, erlauben Sie auch diesen Port, bevor Sie die Firewall aktivieren.

---

## 3. KANAP beziehen

Holen Sie zuerst die Dateien: Das Skript zur Dimensionierung von PostgreSQL im nächsten Schritt ist darin enthalten. Der Branch `stable` zeigt immer auf die neueste veröffentlichte Version.

```bash
sudo install -d -o "$USER" -g "$USER" /opt/kanap
git clone https://github.com/kanap-hq/KANAP.git /opt/kanap
cd /opt/kanap
git checkout stable
```

---

## 4. PostgreSQL

```bash
. ~/kanap-install.env
sudo apt-get install -y postgresql-${PGVER}
pg_lsclusters
```

`pg_lsclusters` zeigt den Cluster `main` Ihrer Version im Status online. Die folgenden Pfade verwenden `/etc/postgresql/${PGVER}/main`.

Legen Sie die Datenbank, die Anwendungsrolle und die erforderlichen Erweiterungen an:

```bash
cd /opt/kanap
. ~/kanap-install.env
sudo -u postgres psql <<SQL
CREATE DATABASE kanap;
CREATE USER kanap WITH PASSWORD '${PG_PASSWORD}' NOSUPERUSER NOBYPASSRLS;
GRANT ALL PRIVILEGES ON DATABASE kanap TO kanap;
SQL

sudo -u postgres psql -d kanap <<'SQL'
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
GRANT ALL ON SCHEMA public TO kanap;
SQL
```

Die Befehle geben `CREATE DATABASE`, `CREATE ROLE` und `GRANT` aus, dann dreimal `CREATE EXTENSION` und `GRANT`.

### Verbindungen von Docker-Containern zulassen

PostgreSQL muss über `localhost` hinaus lauschen und die Anwendungsrolle aus den Docker-Netzwerken annehmen. Auf einem frisch installierten Server legt Docker das Netzwerk von KANAP in `172.16.0.0/12` an (meist `172.18.0.0/16`), die folgende Zeile erlaubt es also. Schritt 5 zeigt, wie Sie das nach dem ersten Start prüfen. Die Firewall aus Schritt 2 hält den Port für den Rest des Netzwerks geschlossen.

```bash
. ~/kanap-install.env
echo "listen_addresses = '*'" | sudo tee /etc/postgresql/${PGVER}/main/conf.d/kanap-network.conf >/dev/null
echo "host    kanap    kanap    172.16.0.0/12    scram-sha-256" | sudo tee -a /etc/postgresql/${PGVER}/main/pg_hba.conf >/dev/null
sudo systemctl restart postgresql
PGPASSWORD="${PG_PASSWORD}" psql -h 127.0.0.1 -U kanap -d kanap -c "SELECT 1;"
```

Der letzte Befehl muss eine Tabelle mit `1` ausgeben. Um die Regel später einzugrenzen, verwenden Sie das Subnetz der KANAP-Container: Nach dem ersten Start zeigt `docker network inspect infra_default` es an.

### PostgreSQL für diesen Server dimensionieren

Die Standardwerte von PostgreSQL sind für eine kleine Maschine ausgelegt. Das Repository enthält ein Skript, das Einstellungen passend zum Arbeitsspeicher dieses Servers ausgibt; es ändert selbst nichts. Es behält die Bibliotheken bei, die PostgreSQL bereits vorlädt (es übernimmt deren Liste), und fügt die Bibliothek für Anweisungsstatistiken hinzu, wenn es sie auf diesem Server findet. Die Befehle schreiben das Ergebnis in eine Drop-in-Datei, starten PostgreSQL neu und aktivieren die Anweisungsstatistiken:

```bash
cd /opt/kanap
. ~/kanap-install.env
CURRENT=$(sudo -u postgres psql -XAtc 'SHOW shared_preload_libraries')
sh infra/postgres/kanap-pg-tune.sh --preload "$CURRENT" | sudo tee /etc/postgresql/${PGVER}/main/conf.d/kanap.conf >/dev/null
sudo systemctl restart postgresql
sudo -u postgres psql -d kanap -c 'CREATE EXTENSION IF NOT EXISTS pg_stat_statements'
```

Der letzte Befehl gibt `CREATE EXTENSION` aus. Um die Einstellungen zu lesen, zeigen Sie die Datei an (ihr Kopf erklärt jeden Wert):

```bash
. ~/kanap-install.env
cat /etc/postgresql/${PGVER}/main/conf.d/kanap.conf
```

Einzelheiten finden Sie unter [Betrieb](operations.md#postgresql-einstellungen).

---

## 5. Objektspeicher (RustFS)

KANAP speichert Anhänge, Logos und Exporte in einem S3-kompatiblen Speicher. Dieses Beispiel betreibt RustFS (Apache 2.0) auf demselben Server. Jeder andere S3-kompatible Speicher funktioniert: Überspringen Sie diesen Schritt und setzen Sie die `S3_*`-Variablen in Schritt 6 für Ihren Speicher (siehe [Konfiguration](configuration.md#erforderlich-speicher)).

MinIO veröffentlicht keine neuen Downloads oder Images mehr, daher verwendet eine neue Installation einen anderen Speicher. Eine Installation, die bereits MinIO betreibt, funktioniert weiterhin mit KANAP.

Der Speicher lauscht nur auf der Docker-Bridge-Adresse `172.17.0.1` und ist daher aus dem Netzwerk nicht erreichbar. Die Konsole ist abgeschaltet.

**RustFS und sein Kommandozeilenwerkzeug installieren.** Die Versionsnummern stehen in den ersten beiden Zeilen: Verwenden Sie die neueste Version, die auf der [Release-Seite von RustFS](https://github.com/rustfs/rustfs/releases) und auf der [Release-Seite der RustFS CLI](https://github.com/rustfs/cli/releases) aufgeführt ist. Wenn Sie eine Version ändern, prüfen Sie die Dateinamen auf ihrer Release-Seite. Jeder Download wird gegen die Datei `SHA256SUMS` seines Releases geprüft; schlägt die Prüfung fehl, bricht der Befehl ab.

```bash
RUSTFS_VERSION=1.0.1
RC_VERSION=0.1.36

RUSTFS_TMP="$(mktemp -d)"
cd "$RUSTFS_TMP"
U=https://github.com/rustfs/rustfs/releases/download/${RUSTFS_VERSION}
curl -fsSLO ${U}/SHA256SUMS
curl -fsSLO ${U}/rustfs-linux-x86_64-gnu-v${RUSTFS_VERSION}.deb
sha256sum --check --ignore-missing SHA256SUMS && sudo dpkg -i rustfs-linux-x86_64-gnu-v${RUSTFS_VERSION}.deb

C=https://github.com/rustfs/cli/releases/download/v${RC_VERSION}
curl -fsSLO ${C}/rustfs-cli-linux-amd64-v${RC_VERSION}.tar.gz
curl -fsSL ${C}/SHA256SUMS -o RC_SHA256SUMS
sha256sum --check --ignore-missing RC_SHA256SUMS && tar xzf rustfs-cli-linux-amd64-v${RC_VERSION}.tar.gz rc && sudo install -m 0755 rc /usr/local/bin/rc

cd ~
rm -rf "$RUSTFS_TMP"
```

Jede `sha256sum`-Zeile muss `OK` ausgeben. Die letzten beiden Zeilen entfernen die heruntergeladenen Dateien. Das Paket legt den Benutzer `rustfs`, das Datenverzeichnis `/data/rustfs`, das Verzeichnis `/opt/rustfs` und einen systemd-Dienst an. Es installiert außerdem eine kommentierte `/etc/default/rustfs`, die der nächste Block durch eine nur für root lesbare Datei ersetzt (Modus 600). Den Dienst startet es nicht.

**Den Dienst konfigurieren und starten.**

```bash
. ~/kanap-install.env
sudo install -m 0600 /dev/null /etc/default/rustfs
sudo tee /etc/default/rustfs >/dev/null <<EOF
RUSTFS_ACCESS_KEY=${RUSTFS_ROOT_USER}
RUSTFS_SECRET_KEY=${RUSTFS_ROOT_PASSWORD}
RUSTFS_VOLUMES=/data/rustfs
RUSTFS_ADDRESS=172.17.0.1:9000
RUSTFS_CONSOLE_ENABLE=false
RUSTFS_OBS_LOGGER_LEVEL=warn
RUSTFS_SSE_S3_MASTER_KEY=${RUSTFS_SSE_S3_MASTER_KEY}
EOF

sudo mkdir -p /etc/systemd/system/rustfs.service.d
printf '[Unit]\nAfter=docker.service\n' | sudo tee /etc/systemd/system/rustfs.service.d/override.conf >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable --now rustfs

for i in $(seq 1 30); do ss -ltn | grep -q '172.17.0.1:9000' && break; sleep 1; done
ss -ltn | grep '172.17.0.1:9000'
```

Die letzte Zeile muss `172.17.0.1:9000` als lauschend zeigen. Das Drop-in `After=docker.service` sorgt dafür, dass der Dienst startet, sobald Docker die Bridge-Adresse angelegt hat. Verwendet Docker eine andere Bridge-Adresse (`ip -4 addr show docker0`), tragen Sie diese in `RUSTFS_ADDRESS` ein. Standardmäßig gibt Docker seinen ersten 15 Netzwerken die Bereiche `172.17.0.0/16` bis `172.31.0.0/16`, alle innerhalb von `172.16.0.0/12`. Weitere Netzwerke erhalten `/20`-Blöcke aus `192.168.0.0/16`. Auf einem frisch installierten Server ist das Netzwerk von KANAP `172.18.0.0/16`. Auf einem Server, der neben der Standard-Bridge bereits 13 oder mehr Docker-Netzwerke hat, kann es in `192.168.x.x` landen. Nach dem ersten Start (Schritt 7) zeigt `docker network inspect infra_default` das Netzwerk von KANAP. Liegt es außerhalb von `172.16.0.0/12`, ergänzen Sie seinen Bereich in den Firewall-Regeln aus Schritt 2 und in der `pg_hba.conf`-Zeile aus Schritt 4. Weicht Ihre Einstellung `default-address-pools` ab, ersetzen Sie stattdessen den Bereich.

`RUSTFS_SSE_S3_MASTER_KEY` ist der Schlüssel, der die Dateien im Ruhezustand verschlüsselt. KANAP verlangt beim Hochladen eine Verschlüsselung im Ruhezustand. Ohne den Schlüssel lehnt RustFS die Anfrage ab, und die API protokolliert eine Warnung `PutObject fallback used`. **Bewahren Sie diesen Schlüssel mit der Sicherung Ihrer Serverkonfiguration auf**: Mit ihm verschlüsselte Dateien sind ohne ihn nicht lesbar.

**Bucket, eine Richtlinie mit minimalen Rechten und den Anwendungsbenutzer anlegen.** Der Anwendungsbenutzer kann Objekte in `kanap-files` lesen, schreiben und löschen und sonst nichts. Sein Zugriffsschlüssel ist `kanap-app`; sein geheimer Schlüssel ist das erzeugte `S3_SECRET_KEY` mit 64 Zeichen (RustFS akzeptiert 8 bis 128 Zeichen). In den Befehlen, die `sudo` im Systemprotokoll festhält, erscheint kein Geheimnis: Das Werkzeug `rc` liest die Administratorschlüssel aus einer nur für root lesbaren Datei, und das Geheimnis des Anwendungsbenutzers erreicht es über die Standardeingabe.

```bash
. ~/kanap-install.env
sudo install -d -m 0700 /root/.config/rc
sudo install -m 0600 /dev/null /root/.config/rc/config.toml
sudo tee /root/.config/rc/config.toml >/dev/null <<EOF
schema_version = 1

[[aliases]]
name = "kanapstore"
endpoint = "http://172.17.0.1:9000"
access_key = "${RUSTFS_ROOT_USER}"
secret_key = "${RUSTFS_ROOT_PASSWORD}"
region = "us-east-1"
EOF

sudo rc mb kanapstore/kanap-files
sudo tee /root/kanap-app-policy.json >/dev/null <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": ["s3:ListBucket", "s3:GetBucketLocation"],
      "Resource": ["arn:aws:s3:::kanap-files"] },
    { "Effect": "Allow", "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": ["arn:aws:s3:::kanap-files/*"] }
  ]
}
EOF
sudo rc admin policy create kanapstore kanap-app /root/kanap-app-policy.json
sudo rm /root/kanap-app-policy.json
printf '%s' "${S3_SECRET_KEY}" | sudo sh -c 'rc admin user add kanapstore kanap-app "$(cat)"'
sudo rc admin policy attach kanapstore kanap-app --user kanap-app
sudo rc admin user info kanapstore kanap-app
```

Der letzte Befehl zeigt `Status: enabled` und die Richtlinie `kanap-app`.

Um RustFS später zu aktualisieren, installieren Sie das neuere `.deb` auf dieselbe Weise. Wenn `dpkg` nach `/etc/default/rustfs` fragt, behalten Sie Ihre Version.

---

## 6. KANAP konfigurieren

Legen Sie die Datei `.env` an. Die Vorlage führt jede Einstellung mit ihrer Erklärung auf; dieses Beispiel ersetzt sie durch eine funktionierende Datei für diese Einrichtung. Nur Sie können die Datei lesen.

```bash
cd /opt/kanap
. ~/kanap-install.env
cp infra/.env.onprem.example .env
chmod 600 .env
cat > .env <<EOF
# BEREITSTELLUNGSMODUS
DEPLOYMENT_MODE=single-tenant

# MANDANT (vor dem ersten Start setzen)
DEFAULT_TENANT_SLUG=default
DEFAULT_TENANT_NAME=${ORG_NAME}

# ADMIN-ZUGANGSDATEN (werden nur beim ersten Start gelesen)
ADMIN_EMAIL=${ADMIN_EMAIL}
ADMIN_PASSWORD=ChangeThisAfterFirstLogin!

# SICHERHEIT
JWT_SECRET=${JWT_SECRET}

# AUSFÜHRUNGSMODUS: Benutzer erreichen KANAP über HTTPS
APP_ENV=production

# ANWENDUNGS-URL UND CORS: die genaue Adresse, die Benutzer öffnen
APP_BASE_URL=https://${KANAP_HOST}
CORS_ORIGINS=https://${KANAP_HOST}

# CLIENT-ADRESSE: ein Reverse Proxy (nginx) vor der API
RATE_LIMIT_TRUST_PROXY=true

# DATENBANK: host.docker.internal erreicht den Host aus Docker heraus
DATABASE_URL=postgres://kanap:${PG_PASSWORD}@host.docker.internal:5432/kanap?sslmode=disable

# SPEICHER: RustFS auf dem Host
S3_ENDPOINT=http://host.docker.internal:9000
S3_BUCKET=kanap-files
S3_REGION=us-east-1
AWS_ACCESS_KEY_ID=kanap-app
AWS_SECRET_ACCESS_KEY=${S3_SECRET_KEY}
S3_FORCE_PATH_STYLE=true

# E-MAIL (optional: einen Versandweg wählen, um Einladungen, Passwortzurücksetzung und Benachrichtigungen zu aktivieren)
# RESEND_API_KEY=re_xxxxx
# RESEND_FROM_EMAIL=KANAP <noreply@company.com>
# SMTP_HOST=smtp.company.com
# SMTP_PORT=587
# SMTP_SECURE=false
# SMTP_USER=noreply@company.com
# SMTP_PASSWORD=<smtp password>
# SMTP_FROM=KANAP <noreply@company.com>
EOF
```

**Ein eigenes Administratorpasswort setzen.** `ADMIN_PASSWORD` muss ein eigener Wert mit mindestens 12 Zeichen sein. Der obige Beispielwert ist veröffentlicht, und ein Beispielwert oder ein kürzerer Wert lässt die API bei jedem Start eine `[SECURITY]`-Warnung ausgeben, bis das Passwort des Kontos geändert ist. Dieser Befehl ersetzt ihn durch das in Schritt 0 erzeugte Zufallspasswort (`openssl rand -base64 18`):

```bash
cd /opt/kanap
. ~/kanap-install.env
sed -i "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=${KANAP_ADMIN_PASSWORD}|" .env
```

Der Smoke-Test in Schritt 9 liest es aus `.env`, ohne es anzuzeigen. Schritt 10 zeigt es einmal für Ihre erste Anmeldung an.

Hinweise zur Datei:

- Das Administratorkonto wird beim ersten Start aus `ADMIN_EMAIL` und `ADMIN_PASSWORD` angelegt. Spätere Änderungen bewirken nichts, solange ein aktiver Administrator existiert.
- `DEFAULT_TENANT_NAME` ist der Name Ihrer Organisation aus Schritt 0. KANAP liest ihn nur beim ersten Start, und die Anwendung hat keine Seite, um ihn zu ändern.
- Das Passwort in `DATABASE_URL` und `JWT_SECRET` wurden in Schritt 0 erzeugt. Verwenden Sie keine Beispielwerte.
- Mit `sslmode=disable` bleibt die Verbindung zu PostgreSQL auf dem Server. Für einen anderen PostgreSQL-Server siehe [`sslmode`](configuration.md#erforderlich-datenbank).
- Erreichen Sie KANAP über eine IP-Adresse statt über einen Namen, setzen Sie `APP_BASE_URL` und `CORS_ORIGINS` auf `https://<ip address>`.
- Für ausgehende E-Mails entfernen Sie das `#` eines Blocks und tragen die Werte ein. Wenn Sie SMTP verwenden, stellen Sie sicher, dass der Server E-Mails von der Adresse `SMTP_FROM` annimmt und dass SPF, DKIM und DMARC eingerichtet sind, falls Nachrichten Ihr Netzwerk verlassen.
- Für die KI-Funktionen ergänzen Sie die vier `AI_*`-Variablen aus der [Konfiguration](configuration.md#optional-ki-funktionen).

---

## 7. Bauen und starten

Bauen Sie die Images und starten Sie die Container. Der Build dauert etwa ein bis zwei Minuten. `--wait` kehrt zurück, wenn beide Container `healthy` melden; der erste Start führt die Datenbankmigrationen aus und dauert einige Sekunden bis eine Minute.

```bash
cd /opt/kanap
docker compose -f infra/compose.onprem.yml build --pull
docker compose -f infra/compose.onprem.yml up -d --wait
docker compose -f infra/compose.onprem.yml ps
docker compose -f infra/compose.onprem.yml logs --no-log-prefix api | grep -E '^\[|^Admin seeding|WARN|ERROR|successfully started|Email transport'
```

Bricht der Build mit `signal: killed` ab, hatte der Server nicht genug Arbeitsspeicher. `sudo dmesg | grep -i oom` bestätigt das. Prüfen Sie den freien Speicher mit `free -m` und beenden Sie andere Dienste, die ihn belegen. Prüfen Sie, dass PostgreSQL und der Speicher noch laufen (`pg_lsclusters`, `systemctl status --no-pager rustfs`). Starten Sie dann Docker neu, was die Reste des abgebrochenen Builds beendet, bauen Sie die beiden Images nacheinander, was weniger Speicher braucht, und starten Sie KANAP:

```bash
sudo systemctl restart docker
cd /opt/kanap
docker compose -f infra/compose.onprem.yml build --pull api
docker compose -f infra/compose.onprem.yml build --pull web
docker compose -f infra/compose.onprem.yml up -d --wait
```

`ps` zeigt `api` und `web` als `healthy`. Der letzte Befehl behält die Startzeilen des API-Protokolls und lässt die Details des Frameworks weg. Beim ersten Start zeigt er diese Zeilen in dieser Reihenfolge (die erste `[SECRETS]`-Zeile ist hier gekürzt):

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

Die Zahl der Migrationen hängt von der Version ab, die Pool-Werte von Ihrem PostgreSQL.

Der Block lässt die Migrationszeilen weg: Auf `Running migrations...` folgen etwa 40 Zeilen, die mit `[Migration]` oder `[migration:` beginnen. Sie dienen der Information. Auf einer neuen Datenbank melden einige davon Änderungen an mitgelieferten Referenzdaten oder nennen eine Mandanten-ID, die nicht Ihre ist: KANAP führt einen Systemmandanten für Plattformfunktionen. Sie erfordern keine Maßnahme. `...` steht für das Präfix `[Nest]` mit Prozess-ID und Uhrzeit sowie für die Quelle in Klammern (zum Beispiel `LOG [NestApplication]`). Einige dieser Zeilen enden mit einer Dauer wie `+0ms`. Die letzte Zeile der gefilterten Ausgabe ist `[DB] pool budget ...`. Eine in eine Datei gespeicherte Protokollausgabe kann Farbcodes wie `[33m` enthalten.

Zwei Zeilen sind erwartet und erfordern keine Maßnahme: `Admin seeding disabled ...` und, bis Sie E-Mail konfigurieren, die `EmailService`-Warnung. Eine Warnung `[SECURITY]`, `[CONFIG]`, `[CORS]` oder `[ENV] APP_ENV is not set` bedeutet, dass eine Einstellung Aufmerksamkeit braucht: Die [Konfiguration](configuration.md#was-das-api-protokoll-beim-start-zeigt) erklärt jede Zeile.

---

## 8. nginx und TLS

Installieren Sie nginx:

```bash
sudo apt-get install -y nginx
```

### Der Server löst den Namen auf

Die Prüfungen in den nächsten Schritten laufen auf diesem Server und rufen KANAP über seinen Namen auf, daher muss der Server ihn auflösen. Mit einem DNS-Eintrag funktioniert das bereits. Ohne einen trägt dieser Befehl den Namen in die hosts-Datei des Servers ein (er tut nichts, wenn der Name bereits auflöst):

```bash
. ~/kanap-install.env
getent hosts "${KANAP_HOST}" || echo "127.0.0.1 ${KANAP_HOST}" | sudo tee -a /etc/hosts
```

Die Arbeitsplätze der Benutzer brauchen den DNS-Eintrag oder, für einen Test, eine Zeile in ihrer eigenen hosts-Datei, die den Namen auf die Adresse dieses Servers zeigen lässt.

### TLS-Zertifikat

Verwenden Sie einen der drei Fälle aus [Name und Zertifikat](installation.md#name-und-zertifikat). Jeder endet damit, die Pfade von Zertifikat und Schlüssel in `~/kanap-install.env` zu schreiben.

**Selbstsigniert (nur für Tests, in diesem Beispiel verwendet).** Jeder Browser zeigt eine Warnung, die jeder Benutzer bestätigen muss.

```bash
. ~/kanap-install.env
sudo install -d /etc/ssl/kanap
sudo openssl req -x509 -nodes -days 365 \
  -newkey rsa:2048 \
  -keyout /etc/ssl/kanap/server.key \
  -out /etc/ssl/kanap/server.crt \
  -subj "/CN=${KANAP_HOST}" \
  -addext "subjectAltName=DNS:${KANAP_HOST}"
sudo chmod 600 /etc/ssl/kanap/server.key
printf 'KANAP_CERT=%s\nKANAP_KEY=%s\n' /etc/ssl/kanap/server.crt /etc/ssl/kanap/server.key >> ~/kanap-install.env
```

**Zertifikat Ihrer internen Zertifizierungsstelle.** Beantragen Sie ein Zertifikat für denselben Namen. Kopieren Sie die vollständige Kette und den privaten Schlüssel nach `/etc/ssl/kanap/fullchain.pem` und `/etc/ssl/kanap/privkey.pem` (Schlüssel mit Modus `600`) und halten Sie dann die Pfade fest. Die Browser verwalteter Arbeitsplätze vertrauen der Zertifizierungsstelle bereits, Benutzer sehen also keine Warnung.

```bash
printf 'KANAP_CERT=%s\nKANAP_KEY=%s\n' /etc/ssl/kanap/fullchain.pem /etc/ssl/kanap/privkey.pem >> ~/kanap-install.env
```

**Let's Encrypt (öffentlicher Name).** Der Name muss aus dem Internet auf diesen Server auflösen, und Port 80 muss erreichbar sein. Die nginx-Standardseite beantwortet die Challenge, führen Sie dies also aus, bevor Sie die KANAP-Site aktivieren. Das Paket `certbot` erneuert das Zertifikat selbstständig; der Deploy-Hook lädt nginx nach jeder Erneuerung neu.

```bash
. ~/kanap-install.env
sudo apt-get install -y certbot
sudo certbot certonly --webroot -w /var/www/html -d "${KANAP_HOST}" \
  -m "${ADMIN_EMAIL}" --agree-tos --no-eff-email --non-interactive \
  --deploy-hook 'systemctl reload nginx'
printf 'KANAP_CERT=%s\nKANAP_KEY=%s\n' "/etc/letsencrypt/live/${KANAP_HOST}/fullchain.pem" "/etc/letsencrypt/live/${KANAP_HOST}/privkey.pem" >> ~/kanap-install.env
sudo certbot renew --dry-run
```

### Site-Konfiguration

Schreiben Sie die Site-Datei mit Platzhaltern für den Namen und das Zertifikat und füllen Sie diese dann aus. Die Datei ist für nginx ab 1.25.1 geschrieben (Ubuntu 26.04 liefert 1.28). Sie leitet `/api/` direkt an den API-Port (`127.0.0.1:8080`), damit KANAP die Adresse jedes Benutzers sieht.

```bash
sudo tee /etc/nginx/sites-available/kanap >/dev/null <<'EOF'
server {
    # HTTP/2: Der Browser sendet die Dutzenden Anfragen einer Seite über eine Verbindung.
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name KANAP_HOST;

    ssl_certificate     KANAP_CERT;
    ssl_certificate_key KANAP_KEY;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;

    # Upload-Limit: Budgetdateien bis 48 MB, Anhänge bis 20 MB
    client_max_body_size 50m;

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
    server_name KANAP_HOST;

    # Zertifikatserneuerung mit Let's Encrypt (Webroot); sonst unschädlich
    location /.well-known/acme-challenge/ { root /var/www/html; }

    location / { return 301 https://$host$request_uri; }
}
EOF

. ~/kanap-install.env
sudo sed -i -e "s|KANAP_HOST|${KANAP_HOST}|g" -e "s|KANAP_CERT|${KANAP_CERT}|g" -e "s|KANAP_KEY|${KANAP_KEY}|g" /etc/nginx/sites-available/kanap
```

**Ubuntu 24.04 (nginx 1.24):** Diese Version kennt die Direktive `http2 on;` nicht. Führen Sie nach den obigen Befehlen einmal Folgendes aus:

```bash
sudo sed -i -e 's/listen 443 ssl;/listen 443 ssl http2;/' -e 's/listen \[::\]:443 ssl;/listen [::]:443 ssl http2;/' -e '/^ *http2 on;$/d' /etc/nginx/sites-available/kanap
```

Aktivieren Sie die Site und starten Sie nginx neu:

```bash
sudo ln -sf /etc/nginx/sites-available/kanap /etc/nginx/sites-enabled/kanap
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl restart nginx
```

`nginx -t` muss `syntax is ok` und `test is successful` ausgeben.

---

## 9. Überprüfen

Prüfen Sie den Zustand der API und des Frontends über nginx. `-S` lässt `curl` einen Fehler anzeigen, etwa einen Namen, der nicht auflöst. `-k` akzeptiert ein Zertifikat, dem der Server nicht vertraut: Behalten Sie es bei einem selbstsignierten Zertifikat oder bei einem Zertifikat Ihrer internen Zertifizierungsstelle, wenn diese nicht auf dem Server installiert ist; lassen Sie es bei Let's Encrypt weg.

```bash
. ~/kanap-install.env
curl -sSk -w '\n' "https://${KANAP_HOST}/api/health"
# Erwartet: {"status":"ok"}
curl -sSk -o /dev/null -w "%{http_code}\n" "https://${KANAP_HOST}/"
# Erwartet: 200
```

Führen Sie dann den Smoke-Test aus. Er prüft die Datenbank, den Speicher, die Anmeldung und die Exporte über die öffentliche API, so wie die Web-App es tut. Der Server hat kein Node.js, daher läuft der Test in einem Container. Die Zeile, die mit `KANAP_PASSWORD=` beginnt, liest das Administratorpasswort aus `.env` in die Umgebung des Tests, ohne es anzuzeigen. Der erste Lauf lädt das Image `node:24-alpine` von Docker Hub (etwa 240 MB) und behält es für spätere Läufe. `KANAP_WRITE=1` legt außerdem eine temporäre Aufgabe mit einem Anhang an, was den Speicher prüft, und löscht sie wieder. Verwenden Sie es nur direkt nach der Installation: Es schreibt in die Daten. Die temporäre Aufgabe verbraucht eine Aufgabenreferenz (`T-1` bei einer neuen Installation), Ihre erste Aufgabe ist also `T-2`. `KANAP_INSECURE_TLS=1` akzeptiert ein Zertifikat, dem der Container nicht vertraut: Behalten Sie es bei einem selbstsignierten Zertifikat. Bei einem Zertifikat Ihrer internen Zertifizierungsstelle können Sie es behalten oder den Container das Zertifikat prüfen lassen: Legen Sie die Datei der Zertifizierungsstelle in `/opt/kanap/infra/certs/` ab (siehe [Zertifikate einer internen Zertifizierungsstelle](configuration.md#optional-zertifikate-einer-internen-zertifizierungsstelle)) und ersetzen Sie `-e KANAP_INSECURE_TLS=1` durch `-v /opt/kanap/infra/certs:/certs:ro -e NODE_EXTRA_CA_CERTS=/certs/company-ca.pem`. Bei Let's Encrypt entfernen Sie `-e KANAP_INSECURE_TLS=1`.

```bash
. ~/kanap-install.env
KANAP_PASSWORD="$(grep '^ADMIN_PASSWORD=' /opt/kanap/.env | cut -d= -f2-)"; export KANAP_PASSWORD
docker run --rm --network host \
  -e KANAP_URL="https://${KANAP_HOST}" -e KANAP_EMAIL="${ADMIN_EMAIL}" -e KANAP_PASSWORD \
  -e KANAP_INSECURE_TLS=1 -e KANAP_WRITE=1 \
  -v /opt/kanap/scripts/smoke:/smoke:ro node:24-alpine node /smoke/recette.mjs
unset KANAP_PASSWORD
```

Die letzte Zeile endet mit `0 failed`, etwa so: `25 OK, 1 skipped, 0 failed (0.5 s)`. Mit `KANAP_INSECURE_TLS=1` sind zwei TLS-Warnungen am Anfang der Ausgabe erwartet. Ein `SKIP` für die KI-Einstellungen ist normal, solange die KI-Funktionen ausgeschaltet sind. Prüfen Sie zum Schluss, dass das API-Protokoll keine Speicherwarnung enthält:

```bash
cd /opt/kanap
docker compose -f infra/compose.onprem.yml logs api | grep 'PutObject fallback' || echo "no storage warning"
```

---

## 10. Erste Anmeldung

1. Öffnen Sie `https://<your name>` in einem Browser (bestätigen Sie die Zertifikatswarnung, wenn Sie ein selbstsigniertes Zertifikat verwenden; der Arbeitsplatz muss den Namen auflösen).
2. Melden Sie sich mit `ADMIN_EMAIL` und dem Administratorpasswort an. Um das Passwort zu sehen, führen Sie auf dem Server `grep '^ADMIN_PASSWORD=' /opt/kanap/.env | cut -d= -f2-` aus. Es erscheint auf dem Bildschirm, führen Sie den Befehl also aus, wenn niemand sonst Ihren Bildschirm sehen kann.
3. Ändern Sie das Passwort direkt nach dieser ersten Anmeldung in Ihrem Profil. KANAP liest den Wert aus `.env` nur beim ersten Start.
4. Fügen Sie unter **Administration → Branding** Ihr Logo und Ihre Farben hinzu (optional).
5. Laden Sie weitere Benutzer ein (wenn E-Mail konfiguriert ist).

Die Installation ist abgeschlossen. `~/kanap-install.env` hat seinen Zweck erfüllt: Jeder Wert steht jetzt in `/opt/kanap/.env`, `/etc/default/rustfs` und in der PostgreSQL-Rolle. Löschen Sie die Datei:

```bash
rm ~/kanap-install.env
```

Richten Sie als Nächstes die [Sicherungen](operations.md#sicherung-und-wiederherstellung) ein.

---

## Übersicht der Dienste

| Dienst     | Verwaltet durch | Konfiguration                                        |
|------------|----------------|-------------------------------------------------------|
| Docker     | systemd        | keine                                                 |
| PostgreSQL | systemd (`postgresql@<version>-main`) | `/etc/postgresql/<version>/main/conf.d/`, `pg_hba.conf` |
| RustFS     | systemd        | `/etc/default/rustfs` (enthält den Verschlüsselungsschlüssel), `/root/.config/rc/config.toml` (enthält die Administratorschlüssel des Speichers für das Werkzeug `rc`) |
| Firewall   | ufw            | `sudo ufw status`                                     |
| KANAP API  | Docker Compose | `/opt/kanap/.env` + `infra/compose.onprem.yml`        |
| KANAP Web  | Docker Compose | `/opt/kanap/.env` + `infra/compose.onprem.yml`        |
| nginx      | systemd        | `/etc/nginx/sites-available/kanap`                    |

## Nützliche Befehle

Führen Sie diese Befehle einzeln aus. `logs -f` verfolgt das Protokoll, bis Sie Strg+C drücken, und `down` stoppt KANAP.

```bash
cd /opt/kanap

# Protokolle anzeigen
docker compose -f infra/compose.onprem.yml logs -f

# KANAP neu starten
docker compose -f infra/compose.onprem.yml restart

# Eine Änderung an .env übernehmen
docker compose -f infra/compose.onprem.yml up -d api

# KANAP stoppen
docker compose -f infra/compose.onprem.yml down

# Alle Dienste prüfen (pg_lsclusters zeigt den Cluster online)
pg_lsclusters
sudo systemctl status --no-pager nginx rustfs
docker compose -f infra/compose.onprem.yml ps

# Welche Version läuft: zuerst der Checkout, dann die API (-k: siehe Schritt 9)
git describe --tags
curl -sSk -w '\n' "$(grep '^APP_BASE_URL=' .env | cut -d= -f2-)/api/config/public"
```

Prüfen Sie PostgreSQL mit `pg_lsclusters`. `systemctl status postgresql` bleibt `active`, auch wenn der Cluster nicht läuft. Das Feld `version` der letzten Antwort ist die Version, die die API meldet.

Um KANAP zu aktualisieren, folgen Sie dem [Upgrade-Verfahren](operations.md#upgrade-verfahren): Lesen Sie das Changelog, dann `git pull origin stable`, `build --pull` und `up -d`.
