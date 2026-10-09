# On-Premise-Bereitstellung

KANAP lässt sich On-Premise im **Single-Tenant-Modus** betreiben. Sie stellen PostgreSQL, einen S3-kompatiblen Speicher und einen TLS-Reverse-Proxy bereit. Um den Rest kümmert sich KANAP: Die Migrationen laufen automatisch, Mandant und Admin-Benutzer werden beim ersten Start angelegt. Es gibt keine Begrenzung der Benutzerzahl.

## Leitfäden

- **[Installation](installation.md):** Voraussetzungen, Name und Zertifikat, Klonen, Bauen, Konfigurieren und Starten
- **[Installationsbeispiel](installation-example.md):** Schritt-für-Schritt-Anleitung unter Ubuntu 26.04 mit PostgreSQL, RustFS, einer Firewall und nginx
- **[KI-gestützte Installation](installation-ai.md):** Installation mit einem einzigen Prompt durch einen KI-Coding-Agenten
- **[Konfiguration](configuration.md):** Referenz der Umgebungsvariablen, Startzeilen im Protokoll, Hintergrundjobs, Firewall-Regeln
- **[Betrieb](operations.md):** Versionen und Upgrades, Sicherung und Wiederherstellung, Monitoring, Fehlerbehebung
- **[Microsoft Entra SSO](sso-entra.md):** Optionales Single Sign-On mit Microsoft Entra ID

## Was enthalten ist

- Der volle Funktionsumfang der Anwendung (Budgets, Verträge, Portfolio, IT-Betrieb, Berichte)
- Automatische Datenbankmigrationen beim Start
- Einrichtung beim ersten Start (Mandant, Admin-Benutzer, Abonnement)
- Lokale Anmeldung mit Benutzername und Passwort (ohne externe Abhängigkeiten)
- Optionaler E-Mail-Versand über die Resend-API oder einen eigenen SMTP-Server
- Optionales Microsoft Entra SSO
- Optionale KI-Funktionen mit Ihrem eigenen Anbieter

## Was deaktiviert ist

- **Abrechnung / Stripe:** Automatisch deaktiviert (keine Abonnementverwaltung nötig)
- **Plattform-Administration:** Nur Single-Tenant, keine Oberflächen zur Verwaltung mehrerer Mandanten
- **Endpunkte für Testphase und Support-Rechnungen:** Für On-Premise nicht relevant

## Kurz notiert

- **Versionen.** KANAP veröffentlicht etwa einmal im Monat eine Version (`26.10.1` ist die erste). Sie installieren den Branch `stable`, der immer auf die neueste veröffentlichte Version zeigt, und aktualisieren, indem Sie ihn nach dem Lesen von `CHANGELOG.md` erneut pullen. Aktualisieren Sie mindestens monatlich. Siehe [Betrieb](operations.md#upgrade-verfahren).
- **Plattform.** Das Beispiel verwendet Ubuntu 26.04 LTS (Ubuntu 24.04 funktioniert ebenfalls). Unterstützt wird jedes Betriebssystem mit Docker Engine 24+ und dem Docker-Compose-Plugin ab Version 2.20 (aktuelle Versionen sind 5.x).
- **Speicher.** Das Beispiel betreibt RustFS auf dem Server. Jeder S3-kompatible Speicher funktioniert, und ein vorhandenes MinIO funktioniert weiterhin.
- **Interne Netzwerke.** Ein öffentlicher DNS-Eintrag ist nicht nötig. Verwenden Sie einen Namen aus Ihrem Unternehmens-DNS (oder für einen Test einen Eintrag in der hosts-Datei) mit einem Zertifikat Ihrer internen Zertifizierungsstelle. Siehe [Name und Zertifikat](installation.md#name-und-zertifikat).
- `DEPLOYMENT_MODE=single-tenant` ist der einzige Schalter, der den On-Premise-Modus aktiviert.
- `APP_BASE_URL` muss genau der Adresse entsprechen, die Benutzer öffnen (einschließlich eines Nicht-Standard-Ports), für E-Mail-Links, Anmelde-Weiterleitungen und Exporte. Tragen Sie dieselbe Adresse in `CORS_ORIGINS` ein.
- Für ausgehende E-Mails wählen Sie entweder **Resend** oder **SMTP**. SMTP ist nur für Single-Tenant- bzw. On-Premise-Bereitstellungen vorgesehen.
- Funktionen, die On-Premise deaktiviert sind, blendet die Anwendung automatisch aus.
