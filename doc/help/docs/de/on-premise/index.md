# On-Premise-Bereitstellung

KANAP kann On-Premise im **Single-Tenant-Modus** bereitgestellt werden. Sie stellen Ihr eigenes PostgreSQL, S3-kompatiblen Speicher und TLS-Reverse-Proxy bereit. KANAP kümmert sich um den Rest: Migrationen laufen automatisch, der Mandant und Admin-Benutzer werden beim ersten Start erstellt, und ein großzügiges Platzlimit (1.000) ist vorkonfiguriert.

## Leitfäden

- **[Installation](installation.md):** Klonen, bauen, konfigurieren und starten
- **[Installationsbeispiel](installation-example.md):** Schritt-für-Schritt-Anleitung auf Ubuntu 24.04 mit PostgreSQL, MinIO und nginx
- **[AI-gestützte Installation](installation-ai.md):** Installation mit einem einzigen Prompt unter Verwendung eines Coding-AI-Agenten
- **[Konfiguration](configuration.md):** Referenz für Umgebungsvariablen
- **[Betrieb](operations.md):** Upgrades, Backups, Monitoring, Fehlerbehebung
- **[Microsoft Entra SSO](sso-entra.md):** Optionales Single Sign-On mit Microsoft Entra ID

## Was enthalten ist

- Vollständige Anwendungsfunktionalität (Budgets, Verträge, Portfolio, IT-Betrieb, Berichterstellung)
- Automatische Datenbankmigrationen beim Start
- Bereitstellung beim ersten Start (Mandant, Admin-Benutzer, Abonnement)
- Lokale Benutzername/Passwort-Authentifizierung (keine externen Abhängigkeiten)
- Optionale E-Mail über Resend API oder kundenverwaltetes SMTP
- Optionales Microsoft Entra SSO

## Was deaktiviert ist

- **Abrechnung / Stripe:** Automatisch deaktiviert (keine Abonnementverwaltung erforderlich)
- **Plattform-Admin:** Nur Single-Tenant, keine Multi-Tenant-Verwaltungsoberflächen
- **Trial- / Support-Rechnungs-Endpunkte:** Nicht für On-Premise zutreffend

## Schnelle Hinweise

- `DEPLOYMENT_MODE=single-tenant` ist der einzelne Schalter, der den On-Premise-Modus aktiviert.
- `APP_BASE_URL` muss mit der genauen Adresse übereinstimmen, die Benutzer öffnen (einschließlich eines nicht standardmäßigen Ports), für E-Mail-Links, Anmelde-Weiterleitungen und Exporte. Tragen Sie dieselbe Adresse in `CORS_ORIGINS` ein.
- Wählen Sie für ausgehende E-Mails entweder **Resend** oder **SMTP**. SMTP ist nur für Single-Tenant-/On-Prem-Bereitstellungen vorgesehen.
- Das Backend gibt strukturierte `FEATURE_DISABLED`-Antworten für deaktivierte Funktionen zurück — die UI blendet sie automatisch aus.
