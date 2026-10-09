# KI-gestützte Installation

Statt der [Schritt-für-Schritt-Anleitung](installation-example.md) selbst zu folgen, können Sie sie einem KI-Coding-Agenten übergeben. Der Agent liest die Anleitung und führt sie Schritt für Schritt auf Ihrem Server aus. Ein Prompt, ein Server, ein Ergebnis.

Werkzeuge wie [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview) oder [OpenAI Codex](https://openai.com/index/codex/) können die KANAP-Dokumentation lesen, alle Abhängigkeiten installieren, alle Dienste konfigurieren und das Ergebnis prüfen, in der Regel in weniger als 20 Minuten.

## Voraussetzungen

| Anforderung | Details |
|-------------|---------|
| **Server** | Ubuntu 26.04 LTS (24.04 LTS funktioniert), frisch bereitgestellt, mit mindestens 6 GB RAM (8 GB empfohlen; der Image-Build braucht diesen Platz), einem Benutzer mit sudo-Rechten und ausgehendem Internetzugang während der Installation (Pakete, Docker-Images, GitHub und Let's Encrypt, falls Sie es verwenden) |
| **Name** | Der Name, den Benutzer eingeben, um KANAP zu öffnen. Ein öffentlicher DNS-Eintrag ist nur für Let's Encrypt nötig. Verwenden Sie sonst einen Eintrag in Ihrem Unternehmens-DNS oder für einen Test einen Eintrag in der hosts-Datei (siehe [Name und Zertifikat](installation.md#name-und-zertifikat)). |
| **Zertifikat** | Einer von drei Fällen: ein öffentlicher Name mit Let's Encrypt, Zertifikatsdateien Ihrer internen Zertifizierungsstelle, die bereits auf dem Server liegen, oder ein selbstsigniertes Zertifikat für einen Test |
| **KI-Agent** | Ein auf dem Server installierter KI-Coding-Agent (Claude Code, Codex oder ähnlich) |

### Passwortloses sudo

Der KI-Agent führt viele Befehle mit `sudo` aus. Damit Sie nicht bei jedem Schritt nach einem Passwort gefragt werden, geben Sie Ihrem Benutzer vorübergehend passwortloses sudo:

```bash
echo "$USER ALL=(ALL) NOPASSWD:ALL" | sudo tee /etc/sudoers.d/90-install-nopasswd
sudo chmod 0440 /etc/sudoers.d/90-install-nopasswd
```

Sie entfernen dies am Ende der Installation: siehe [Nach der Installation](#nach-der-installation).

## Der Prompt

Öffnen Sie Ihren KI-Agenten auf dem Server und fügen Sie den folgenden Prompt ein. Ersetzen Sie die Werte der Liste **Parameters** durch Ihre eigenen und behalten Sie nur eine **Certificate**-Zeile.

```
Install KANAP on this Ubuntu server by following the official installation
example step by step, running its commands as written:

  https://doc.kanap.net/on-premise/installation-example/

Background pages: https://doc.kanap.net/on-premise/installation/ and
https://doc.kanap.net/on-premise/configuration/

Parameters:
- Address users open: https://kanap.example.com
- Administrator email: admin@example.com
- Organization name: Example Company
- Certificate (keep one line):
  - Public name: get a certificate from Let's Encrypt, with automatic renewal.
  - Internal certificate: the files are on this server at <path of the full
    chain> and <path of the private key>.
  - Test only: create a self-signed certificate.

Rules:
1. Follow the steps of the guide in order. Use the commands as they are
   written; where the guide shows a choice (Ubuntu 24.04, certificate case),
   take the one that matches this server and my parameters above.
2. Generate every secret on the server, as the guide's step 0 does. Never
   print a secret in the conversation and never write one to the log file.
3. Keep a log of your work in ~/kanap-install.md: the commands you ran, the
   configuration files you wrote (without secrets), and what you saw. For the
   secrets, write only where they are stored: ~/kanap-install.env (deleted at
   the end), /opt/kanap/.env and /etc/default/rustfs.
4. If the docker group is not active in your shell yet, put sudo in front of
   the docker commands.
5. Keep SSH allowed in the firewall before you enable it.
6. Run the checks of the guide's step 9, including the smoke test. Read the
   administrator password from /opt/kanap/.env into the environment of that
   command without printing it.
7. When you finish, report: the start-up lines of the API log (the [ENV],
   [SECRETS], [RATE-LIMIT], [CORS], [DB], [on-prem] and [SECURITY] lines and
   any WARN), the output of docker compose ps, the last line of the smoke
   test, and anything that did not work as the guide says.
```

### E-Mail-Konfiguration

Hängen Sie **einen** der folgenden Blöcke an den Prompt an, um ausgehende E-Mails zu aktivieren (Passwortzurücksetzung, Einladungen, Benachrichtigungen). Der Agent trägt die Werte in die Datei `.env` ein.

**Option A: Resend** (Cloud-E-Mail-API):

```
Email transport: Resend
- RESEND_API_KEY=re_xxxxx
- RESEND_FROM_EMAIL=KANAP <noreply@example.com>
```

**Option B: SMTP** (internes Relay oder Anbieter):

```
Email transport: SMTP
- SMTP_HOST=smtp.company.com
- SMTP_PORT=587
- SMTP_SECURE=false
- SMTP_USER=noreply@company.com
- SMTP_PASSWORD=secret
- SMTP_FROM=KANAP <noreply@company.com>
```

Ersetzen Sie die Werte durch Ihre tatsächlichen Zugangsdaten. SMTP_USER und SMTP_PASSWORD gehören zusammen. Wenn Sie die E-Mail-Konfiguration auslassen, funktioniert KANAP trotzdem, aber Passwortzurücksetzung und Einladungen stehen erst zur Verfügung, wenn Sie E-Mail später konfigurieren (siehe [Konfiguration](configuration.md)).

## Was Sie erwartet

Der Agent liest die Anleitung und arbeitet sie dann ab:

1. **Systempakete**: installiert Docker und Git.
2. **Firewall**: erlaubt SSH, HTTP und HTTPS aus dem Netzwerk sowie PostgreSQL und den Speicher nur aus den Docker-Netzwerken.
3. **KANAP-Dateien**: klont das Repository nach `/opt/kanap` und checkt `stable` aus.
4. **PostgreSQL**: installiert es, legt die Datenbank, die Anwendungsrolle und die erforderlichen Erweiterungen an und erlaubt Verbindungen aus den Docker-Netzwerken.
5. **Objektspeicher**: installiert RustFS und legt den Bucket, einen eingeschränkten Anwendungsbenutzer und den Verschlüsselungsschlüssel an.
6. **KANAP**: schreibt `.env` mit den erzeugten Geheimnissen, baut die Docker-Images und startet die Container.
7. **TLS und nginx**: beschafft oder erstellt das Zertifikat, konfiguriert den Reverse Proxy und stellt sicher, dass der Server den Namen auflöst.
8. **Überprüfung**: prüft den Zustand der API und das Frontend und führt dann den Smoke-Test aus (Datenbank, Speicher, Anmeldung, Exporte).

Der Agent bittet um Bestätigung, bevor er Befehle auf Ihrem Server ausführt. Am Ende liefert er Ihnen den im Prompt beschriebenen Bericht. Das Protokoll der Installation liegt in `~/kanap-install.md`.

## Nach der Installation

1. **Lesen Sie den Bericht.** Prüfen Sie die Startzeilen: Eine Warnung `[SECURITY]`, `[CONFIG]` oder `[CORS]` oder eine Zeile `[ENV] APP_ENV is not set` bedeutet, dass eine Einstellung Aufmerksamkeit braucht (siehe [Konfiguration](configuration.md#was-das-api-protokoll-beim-start-zeigt)).
2. **Prüfen Sie Ihre `.env`-Datei** unter `/opt/kanap/.env`. Nur ihr Eigentümer kann sie lesen, und sie enthält alle Geheimnisse.
3. **Konfigurieren Sie E-Mail**, falls noch nicht geschehen: Die Einrichtung von SMTP oder Resend steht in der [Konfiguration](configuration.md), danach [testen Sie den Versand](configuration.md#e-mail-testen). E-Mail ermöglicht Passwortzurücksetzung, Einladungen und Benachrichtigungen.
4. **Melden Sie sich an** unter `https://your-address`, mit `ADMIN_EMAIL` und dem `ADMIN_PASSWORD` aus `.env`: `grep '^ADMIN_PASSWORD=' /opt/kanap/.env` zeigt es an. Ändern Sie es in Ihrem Profil, wenn nur Sie es kennen sollen.
5. **Fügen Sie Ihr Logo und Ihre Farben hinzu** unter **Administration → Branding** (optional).
6. **Richten Sie die Sicherungen ein** und lesen Sie den Leitfaden [Betrieb](operations.md) zu Upgrades und Monitoring.
7. **Bewahren Sie den Verschlüsselungsschlüssel auf.** `/etc/default/rustfs` enthält den Schlüssel, der die gespeicherten Dateien verschlüsselt. Bewahren Sie ihn mit der Sicherung Ihrer Konfiguration auf.
8. **Entfernen Sie das passwortlose sudo.** Die Installation ist abgeschlossen, stellen Sie die normale Sicherheit wieder her:

    ```bash
    sudo rm /etc/sudoers.d/90-install-nopasswd
    ```

!!! tip "Gleiches Ergebnis, anderer Weg"
    Dieser Prompt erzeugt dieselbe Installation wie die [manuelle Anleitung](installation-example.md). Wenn Sie später einzelne Komponenten untersuchen oder anpassen müssen, bleibt dieser Leitfaden die Referenz.
