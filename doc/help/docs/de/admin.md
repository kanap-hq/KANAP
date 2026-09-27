# Administration

Der Bereich Administration bietet Zugriff auf Benutzerverwaltung, Rollenkonfiguration, Abrechnung, Authentifizierungseinstellungen, Branding-Steuerung und den Audit-Protokoll-Viewer. Diese Seiten sind in der Regel auf Administratoren beschränkt.

## Wo Sie es finden

Navigieren Sie im Hauptmenü zu **Administration**, um den Administrationsbereich aufzurufen.

**Berechtigungen**: Verschiedene Administrationsseiten erfordern unterschiedliche Berechtigungen:
- Unternehmen, Abteilungen, Lieferanten, Konten: `{resource}:reader` zum Anzeigen
- Benutzer & Zugriff: `users:reader` zum Anzeigen, `users:admin` zum Verwalten
- Rollen: `users:reader` zum Anzeigen, `users:admin` zum Bearbeiten
- Audit-Protokoll: Erfordert `users:admin`
- Abrechnung: Erfordert die Rolle Abrechnungsadministrator
- Authentifizierung: Erfordert `users:admin` (Feature-Flag-gesteuert; erfordert aktiviertes SSO)
- Branding: Erfordert `users:admin` (nur Mandanten-Host; über die Seitenleiste zugänglich)

---

## Administrations-Hub

Die Startseite der Administration bietet schnellen Zugriff auf die wichtigsten Verwaltungsfunktionen:

| Karte | Beschreibung | Erforderliche Berechtigung |
|-------|--------------|----------------------------|
| **Unternehmen** | Unternehmen und Jahreskennzahlen verwalten | `companies:reader` |
| **Abteilungen** | Abteilungen und Mitarbeiterzahl verwalten | `departments:reader` |
| **Lieferanten** | Lieferanten und Kontakte verwalten | `suppliers:reader` |
| **Konten** | Buchungskonten verwalten | `accounts:reader` |
| **Benutzer & Zugriff** | Benutzer und Rollen verwalten | `users:reader` |
| **Rollen** | Rollenberechtigungen definieren | `users:reader` |
| **Audit-Protokoll** | Gesamte Änderungshistorie durchsuchen | `users:admin` |
| **Abrechnung** | Tarif und Rechnungen | Abrechnungsadministrator |

Authentifizierung und Branding sind über die Seitenleistennavigation erreichbar, erscheinen jedoch nicht auf der Startseite des Administrations-Hubs.

---

## Audit-Protokoll

Die Audit-Protokoll-Seite zeigt die mandantenbezogene Änderungshistorie für Datenaktualisierungen auf der gesamten Plattform.

### Zugriff

- Route: `/admin/audit-logs`
- Erforderliche Berechtigung: `users:admin`
- Diese Seite ist schreibgeschützt (keine Erstellen/Bearbeiten/Löschen-Aktionen).

### Was Sie tun können

- Suche über Tabellenname, Aktion und Akteur (E-Mail/Name)
- Filtern nach:
  - Datum
  - Tabelle
  - Aktion
  - Quelle (`user`, `system`, `webhook`)
- Beliebige Zeile öffnen, um vollständige Details anzuzeigen:
  - Metadaten-Chips (Datum, Tabelle, Aktion, Quelle, Quellreferenz, Mandant, Datensatz-ID, Benutzer)
  - Zusammenfassung der geänderten Felder
  - Nebeneinander dargestellte **Vorher**- und **Nachher**-JSON-Daten

### Spalten

**Standardspalten**:
- **Datum**: Wann die Änderung erfolgte
- **Tabelle**: Welche Datenbanktabelle betroffen war
- **Aktion**: Art der Änderung (Erstellen, Aktualisieren, Löschen, Deaktivieren)
- **Quelle**: Wer oder was die Änderung ausgelöst hat (Benutzer, System, Webhook)
- **Benutzer**: E-Mail des Benutzers, der die Änderung vorgenommen hat (oder „System"/„Webhook" für Nicht-Benutzer-Quellen)

**Zusätzliche Spalten** (über Spaltenauswahl):
- **Datensatz-ID**: Kennung des betroffenen Datensatzes
- **Benutzer-ID**: UUID des handelnden Benutzers
- **Benutzername**: Anzeigename des handelnden Benutzers
- **Quellreferenz**: Externe Referenz für Webhook-initiierte Änderungen
- **Mandanten-ID**: Der Mandant, zu dem dieser Eintrag gehört

### Paginierung

- Das Grid verwendet explizite Paginierung mit **100 Zeilen pro Seite**.
- Filter und Suche gelten für den gesamten Datensatz, nicht nur für die aktuelle Seite.

### Quelle und Akteur verstehen

- **Quelle = user**: Änderung wurde durch eine authentifizierte Benutzeraktion ausgelöst.
- **Quelle = webhook**: Änderung wurde durch einen externen Webhook ausgelöst (z. B. Abrechnungs-Sync-Ereignisse). Verwenden Sie die **Quellreferenz**, um vorgelagerte Ereignis-IDs zuzuordnen.
- **Quelle = system**: Interner Plattformprozess ohne direkten Benutzerakteur.

Wenn ein Benutzerkonto im aktuellen Kontext nicht mehr aufgelöst werden kann, zeigt die Benutzer-Spalte möglicherweise einen UUID-Fallback (`Unbekannt (xxxx...)`) anstelle einer E-Mail an.

---

## Benutzer & Zugriff

Verwalten Sie, wer auf KANAP zugreifen kann und was die jeweiligen Personen tun können.

### Das Benutzer-Grid

**Standardspalten**:
- **Nachname** / **Vorname**: Name des Benutzers
- **E-Mail-Adresse**: Anmelde-E-Mail-Adresse
- **Position**: Rolle in der Organisation
- **Status**: Ein farbiger Punkt mit dem Kontozustand. Siehe unten.
- **Letzte Anmeldung**: Wann die Person sich zuletzt angemeldet hat, oder **Nie**
- **Rollen**: Alle dem Benutzer zugewiesenen Rollen
- **Kontotyp**: **Lokal** für Konten, die sich mit E-Mail und Passwort anmelden, **Microsoft Entra** für Konten, die sich mit Microsoft anmelden
- **Unternehmen** / **Abteilung**: Organisatorische Zuordnung des Benutzers

**Zusätzliche Spalten** (über Spaltenauswahl):
- **Geschäftstelefon** / **Mobiltelefon**: Telefonnummern
- **MFA aktiviert**: Ob Multi-Faktor-Authentifizierung aktiv ist
- **Erstellt**: Wann der Benutzer erstellt wurde

**Statuswerte**:

| Status | Bedeutung |
|--------|-----------|
| **Aktiv** | Das Konto kann sich anmelden und KANAP nutzen. |
| **Deaktiviert** | Das Konto bleibt mit seiner gesamten Historie erhalten, kann sich aber nicht anmelden. |
| **Eingeladen** | Eine Einladung wurde gesendet und noch nicht angenommen. |
| **Zugriff ausstehend** | Die Person kann sich anmelden, hat aber keine Rolle und kann daher nichts öffnen. Weisen Sie eine Rolle zu, um Zugriff zu geben. |
| **Kontakt** | Nur ein Verzeichniseintrag. Die Person meldet sich nicht an. |

Das Grid zeigt standardmäßig **aktive** Benutzer. Verwenden Sie den Umschalter **Anzeigen**, um zwischen **Alle**, **Aktiv**, **Eingeladen** und **Deaktiviert** zu wechseln.

### Benutzerverwaltungsaktionen

Aktionen in der Symbolleiste:

| Aktion | Beschreibung | Berechtigung |
|--------|--------------|--------------|
| **Neu** | Neuen Benutzer erstellen | `users:admin` |
| **CSV importieren** | Massenimport von Benutzern | `users:admin` |
| **CSV exportieren** | Benutzerliste exportieren | `users:admin` |
| **Einladen** | Anmeldeeinladungen an ausgewählte Benutzer senden | `users:admin` |
| **Deaktivieren** | Die ausgewählten Benutzer deaktivieren. Sie werden sofort abgemeldet. | `users:admin` |
| **Löschen** | Ausgewählte Benutzer dauerhaft entfernen | `users:admin` |

`users:reader` genügt, um die Seite zu öffnen und die Liste zu lesen. Alle Aktionen oben und die folgenden Zeilenaktionen erfordern `users:admin`.

Zeilenaktionen über das Menü am Ende jeder Zeile:

| Aktion | Beschreibung |
|--------|--------------|
| **Bearbeiten** | Öffnet den Benutzer zur Bearbeitung. Ein Klick auf die Zeile bewirkt dasselbe. |
| **Aktivieren** / **Deaktivieren** | Schaltet das Konto ein oder aus. Beim Deaktivieren wird die Person sofort abgemeldet. |
| **Einladung senden** | Sendet eine Anmeldeeinladung per E-Mail. Für Microsoft Entra-Konten ausgeblendet. |
| **Passwort-Zurücksetzung senden** | Sendet einen Link zum Zurücksetzen des Passworts per E-Mail. Nur für aktive lokale Konten sichtbar. |
| **Löschen** | Entfernt den Benutzer dauerhaft. Deaktivieren Sie das Konto stattdessen, wenn andere Datensätze darauf verweisen. |

### Benutzer erstellen

1. Klicken Sie auf **Neu**
2. Füllen Sie die Pflichtfelder aus:
   - **E-Mail**: Anmelde-E-Mail-Adresse (muss eindeutig sein)
3. Optionale Felder:
   - **Vorname** / **Nachname**: Name des Benutzers
   - **Berufsbezeichnung**: Rolle in der Organisation
   - **Geschäftstelefon** / **Mobiltelefon**: Telefonnummern
   - **Rollen**: Eine oder mehrere Rollen zuweisen (bestimmt die Berechtigungen)
   - **Unternehmen** / **Abteilung**: Organisatorische Zuordnung
   - **Aktiviert**: Ob der Benutzer sich anmelden kann
4. Klicken Sie auf **Speichern** oder **Speichern und einladen**, um die Anmelde-E-Mail zu senden

### Mehrfach-Rollenzuweisung

Benutzern können mehrere Rollen zugewiesen werden. Ihre effektiven Berechtigungen sind die Kombination aller zugewiesenen Rollen -- wenn eine Rolle Zugriff auf eine Ressource gewährt, hat der Benutzer diesen Zugriff.

Das Entfernen aller Rollen löscht das Konto nicht. Der Benutzer fällt auf die Systemrolle **Kontakt** zurück, behält keinen Zugriff und erscheint im Grid mit dem Status **Zugriff ausstehend**. Sie können Ihre eigene letzte Rolle nicht entfernen und sperren sich damit nicht selbst aus.

### Platzverwaltung

Das gehostete Abonnement umfasst **unbegrenzte Nutzer** — es gibt kein Platzlimit zu verwalten:
- **Aktivierte Benutzer**: Können sich anmelden und KANAP nutzen
- **Deaktivierte Benutzer**: Behalten ihre Daten, können sich aber nicht mehr anmelden
- Der Zähler in der Symbolleiste zeigt die Anzahl der aktivierten Benutzer
- Schalten Sie den **Aktiviert**-Schalter beim Bearbeiten eines Benutzers um, um den Zugriff zu steuern

### Von Microsoft Entra verwaltete Benutzer

Konten mit dem Kontotyp **Microsoft Entra** gehören Ihrem Verzeichnis. Ihr Profil wird zu zwei Zeitpunkten aus Entra aktualisiert:

- **Bei jeder Anmeldung**, aus dem eigenen Microsoft-Profil der Person
- **Jede Nacht**, durch die tägliche Verzeichnissynchronisierung, sofern ein Microsoft Entra-Administrator sie genehmigt hat. Siehe [Authentifizierung](#authentifizierung).

Beide aktualisieren dieselben Felder: Vorname, Nachname, Position, Geschäftstelefon, Mobiltelefon sowie Abteilung und Unternehmen, die nach Namen mit bereits in KANAP vorhandenen Datensätzen abgeglichen werden. Leere Werte im Verzeichnis löschen niemals das, was in KANAP gespeichert ist.

Personen, die zugleich Mitwirkende sind, erhalten mit der nächtlichen Synchronisierung auch ihren **Vorgesetzten** aus dem Verzeichnis. KANAP gleicht den in Entra hinterlegten Vorgesetzten mit dessen KANAP-Konto ab und trägt ihn im Profil des Mitwirkenden ein, wo das Feld schreibgeschützt wird. Ein Vorgesetzter ohne KANAP-Konto wird von einer späteren Synchronisierung nachgetragen. Siehe [Mitwirkende](portfolio-team-members.md).

Beim Bearbeiten eines solchen Benutzers sind die Felder E-Mail, Name, Position und Telefon gesperrt, mit dem Hinweis:

> Dieser Benutzer wird von Microsoft Entra ID verwaltet und kann hier nicht bearbeitet werden. Zuletzt aus Microsoft Entra synchronisiert: {Datum}

Rollen, Unternehmen, Abteilung und den Aktiviert-Schalter können Sie weiterhin verwalten.

Microsoft Entra-Konten haben nie ein KANAP-Passwort. An sie kann weder eine Einladung noch eine Passwort-Zurücksetzung gesendet werden.

Wenn jemand aus Ihrem Verzeichnis entfernt wird oder sein Verzeichniskonto deaktiviert wird, deaktiviert die nächtliche Synchronisierung sein KANAP-Konto. Die Person wird sofort abgemeldet und ihre Daten bleiben erhalten.

### Just-in-time-Anmeldung mit Microsoft

Wenn Single Sign-On verbunden ist, erhält eine Person, die sich zum ersten Mal mit Microsoft anmeldet, automatisch ein KANAP-Konto. Existiert bereits ein Konto mit derselben E-Mail-Adresse, wird stattdessen dieses mit ihrer Microsoft-Identität verknüpft.

Ein neues Konto startet mit der Systemrolle **Kontakt** und ohne Berechtigungen. Die Person sieht eine Seite mit dem Hinweis:

> Ihr Konto hat noch keinen Zugriff auf KANAP erhalten. Bitten Sie Ihren Administrator, Ihnen Zugriff zu gewähren.

Administratoren erhalten in diesem Fall eine E-Mail. Um der Person Zugriff zu geben, öffnen Sie **Administration > Benutzer**, suchen Sie sie über den Status **Zugriff ausstehend** und weisen Sie eine Rolle zu.

---

## Rollen

Definieren Sie, was jede Rolle in KANAP tun kann.

### Wie Rollen funktionieren

Jede Rolle hat Berechtigungsstufen für verschiedene Ressourcen:
- **Keine**: Kein Zugriff auf diese Ressource
- **Leser**: Nur Ansicht
- **Mitwirkender**: Ansicht und Bearbeitung bestehender Elemente, Kommentare und Anhänge hinzufügen, aber keine neuen übergeordneten Elemente erstellen (derzeit für Portfolio-Projekte verwendet)
- **Mitglied**: Ansicht, Erstellen und Bearbeiten
- **Administrator**: Vollzugriff einschließlich Löschen

### Berechtigungsgruppen

Ressourcen sind zur einfacheren Verwaltung in Gruppen organisiert:

**Budget & Finanzen**
| Ressource | Was sie steuert |
|-----------|-----------------|
| `opex` | Betriebsausgaben |
| `capex` | Investitionsausgaben |
| `budget_ops` | Budget-Administrationswerkzeuge |
| `contracts` | Lieferantenverträge |
| `analytics` | Analysedimensionen |
| `reporting` | Berichtszugriff |

**Portfolio**
| Ressource | Was sie steuert |
|-----------|-----------------|
| `portfolio_requests` | Portfolio-Anfragen |
| `portfolio_projects` | Portfolio-Projekte |
| `portfolio_planning` | Portfolio-Planung |
| `portfolio_reports` | Portfolio-Berichte |
| `portfolio_settings` | Portfolio-Einstellungen |

**IT-Landschaft**
| Ressource | Was sie steuert |
|-----------|-----------------|
| `applications` | Anwendungen |
| `infrastructure` | Server und Infrastruktur |
| `locations` | Standort-Stammdaten |
| `settings` | Anwendungseinstellungen |

**Stammdaten**
| Ressource | Was sie steuert |
|-----------|-----------------|
| `companies` | Unternehmens-Stammdaten |
| `departments` | Abteilungs-Stammdaten |
| `cost_centers` | Kostenstellen und ihre Gruppen |
| `suppliers` | Lieferanten-Stammdaten |
| `contacts` | Kontaktverzeichnis |
| `accounts` | Kontenplan |
| `business_processes` | Geschäftsprozess-Katalog |

**Aufgaben**
| Ressource | Was sie steuert |
|-----------|-----------------|
| `tasks` | Aufgabenverwaltung |

**Wissensdatenbank**
| Ressource | Was sie steuert |
|-----------|-----------------|
| `knowledge` | Wissensdatenbank-Artikel |

Die Wissensdatenbank-Ressource unterstützt die Stufen Leser, Mitglied und Administrator (Mitwirkender ist für diese Ressource nicht verfügbar).

**Administration**
| Ressource | Was sie steuert |
|-----------|-----------------|
| `users` | Benutzer- und Rollenverwaltung |
| `billing` | Abrechnung und Abonnement |

### Rollentypen

Rollen werden nach ihrer Änderbarkeit kategorisiert:

| Kennzeichnung | Beschreibung |
|---------------|--------------|
| **System** | Kann nicht geändert werden. Administrator hat Vollzugriff; Kontakt ist nur für Verzeichniseinträge. |
| **Integriert** | Vorkonfigurierte Rollen mit Standard-Zugriffsmustern. Können nicht direkt geändert werden -- verwenden Sie **Duplizieren**, um eine anpassbare Kopie zu erstellen. |
| _(keine Kennzeichnung)_ | Benutzerdefinierte Rollen, die Sie erstellen. Vollständig bearbeitbar. |

### Integrierte Rollen

KANAP wird mit vorkonfigurierten Rollen ausgeliefert, die nach Funktionsbereichen organisiert sind:

**Budget**: Budget-Administrator, Budget-Mitglied, Budget-Leser
**Portfolio**: Portfolio-Administrator, Portfolio-Mitglied, Portfolio-Leser, **Fachbereichs-Mitwirkender**
**IT-Landschaft**: IT-Landschaft-Administrator, IT-Landschaft-Mitglied, IT-Landschaft-Leser
**Stammdaten**: Stammdaten-Administrator, Stammdaten-Mitglied, Stammdaten-Leser
**Aufgaben**: Aufgaben-Administrator, Aufgaben-Mitglied, Aufgaben-Leser

#### Die Rolle Fachbereichs-Mitwirkender

Die Rolle **Fachbereichs-Mitwirkender** ist für Fachbereichs-Stakeholder konzipiert, die am Portfolio-Prozess teilnehmen, ohne vollständige Projektmanagement-Rechte zu haben. Ein Fachbereichs-Mitwirkender kann:

- **Portfolio-Anfragen einreichen und verwalten** (voller Mitgliederzugriff auf Anfragen)
- **Bestehende Projekte bearbeiten** -- Felder aktualisieren, Kommentare hinzufügen, Anhänge hochladen, Phasen, Meilensteine, Abhängigkeiten und Zeiteinträge verwalten
- **Projektaufgaben erstellen und bearbeiten** -- Aufgaben zu Projekten hinzufügen, Zeit erfassen und Kommentare posten
- **Benutzer, Unternehmen, Abteilungen und Kontakte anzeigen** für Dropdown-Auswahlen

Ein Fachbereichs-Mitwirkender **kann nicht**:
- Neue Projekte erstellen (erfordert Mitglied-Stufe für Portfolio-Projekte)
- Anfragen in Projekte umwandeln (erfordert Mitglied-Stufe)
- CSV importieren/exportieren (erfordert Administrator-Stufe)

Diese Rolle schließt die Lücke zwischen schreibgeschütztem Zugriff (Leser) und vollem Projektmanagement (Mitglied) und ermöglicht es Fachbereichsbenutzern, aktiv beizutragen, ohne neue Projekte erstellen zu können.

### Die Rolle Kontakt

Die Rolle **Kontakt** ist eine spezielle Systemrolle für Benutzer, die in Dropdown-Listen erscheinen, sich aber nicht anmelden müssen. Typische Verwendungen:

- Antragsteller oder Sponsoren, die nur referenziert, nicht als aktive Benutzer benötigt werden
- Externe Stakeholder, die zu Nachverfolgungszwecken aufgeführt sind
- Platzhaltereinträge für die Organisationsstruktur

**Kontakt-Benutzer:**
- Können sich nicht bei KANAP anmelden
- Zählen nicht zur Gesamtzahl der aktivierten Benutzer
- Erhalten keine E-Mail-Benachrichtigungen (auch wenn sie Projekten/Aufgaben zugewiesen sind)
- Können in Benutzer-Dropdowns ausgewählt werden (z. B. als Projektsponsor)

Wenn jemand mit der Kontakt-Rolle KANAP aktiv nutzen muss, ändern Sie die Rolle zu einer regulären Rolle (z. B. Leser, Mitglied) und laden Sie die Person ein.

Eine Ausnahme: Auch eine Person, die bei ihrer ersten Microsoft-Anmeldung automatisch angelegt wird, hat die Kontakt-Rolle. Sie kann sich anmelden, erreicht aber nur die Seite mit dem ausstehenden Zugriff, bis Sie ihr eine Rolle zuweisen. Im Grid erscheint sie als **Zugriff ausstehend**.

### Rollen verwalten

Die Rollenseite hat ein zweispaltiges Layout:
- **Linke Spalte**: Liste aller Rollen mit Kennzeichnungen für den Typ und einer Benutzeranzahl für jede Rolle
- **Rechte Spalte**: Details und Berechtigungen für die ausgewählte Rolle

**Aktionen**:
- **Neue Rolle**: Benutzerdefinierte Rolle von Grund auf erstellen
- **Duplizieren**: Bestehende Rolle (einschließlich integrierter Rollen) als Ausgangspunkt kopieren. Nicht verfügbar für Systemrollen.
- **Löschen**: Benutzerdefinierte Rolle entfernen (nur wenn keine Benutzer zugewiesen sind)
- **Details speichern**: Rollenname und -beschreibung aktualisieren
- **Berechtigungen speichern**: Berechtigungsänderungen anwenden

### Benutzerdefinierte Rolle erstellen

1. Klicken Sie auf **Neue Rolle**
2. Geben Sie einen Namen und eine Beschreibung ein
3. Klicken Sie auf **Erstellen**
4. Legen Sie die Berechtigungsstufen für jede Ressourcengruppe fest
5. Klicken Sie auf **Berechtigungen speichern**

**Tipp**: Beginnen Sie damit, eine integrierte Rolle zu duplizieren, die Ihren Anforderungen nahekommt, und passen Sie dann die Berechtigungen an.

---

## Abrechnung

Verwalten Sie Ihr Abonnement, Ihre Benutzer und Rechnungen.

### Abonnement-Übersicht

Die Abonnementkarte zeigt Ihren aktuellen Tarif auf einen Blick:
- **Tarif**: Hosted KANAP (oder Kostenlose Testversion). Das Abonnement umfasst unbegrenzte Nutzer — monatliche oder jährliche Abrechnung
- **Plätze**: Anzahl der aktivierten Benutzer
- **Status**: Aktiv, Testphase, Überfällig, Gekündigt usw.
- **Verlängerungsdatum**: Wann der nächste Abrechnungszeitraum beginnt

Für aktive Abonnements (keine lokalen Testversionen) werden zusätzliche Details angezeigt:
- **Betrag pro Zeitraum**: Kosten für den aktuellen Abrechnungszeitraum
- **Abrechnungsfrequenz**: Monatlich oder Jährlich
- **Einzugsverfahren**: Automatische Belastung oder Rechnung (manuelle Zahlung)
- **Zahlungsmethode**: Kartendetails oder Banküberweisung
- **Letzte Stripe-Synchronisation**: Wann die Abonnementdaten zuletzt von Stripe aktualisiert wurden

Befindet sich das Abonnement in einer Testphase, werden die verbleibenden Testtage angezeigt.

### Aktionen

- **Tarif wählen** / **Tarif ändern**: Öffnet den Tarifdialog zum Abonnieren oder zum Wechsel zwischen monatlicher und jährlicher Abrechnung. Erfordert Abrechnungsadministrator.
- **Abonnement verwalten**: Öffnet das Stripe-Kundenportal zum Aktualisieren von Zahlungsmethoden, Kündigen oder für andere Änderungen. Nur verfügbar, wenn ein Stripe-Abonnement existiert.

Wenn Ihr Abonnement nicht in Ordnung ist (abgelaufene Testversion, überfällig usw.), öffnet sich der Tarifauswahldialog automatisch, wenn Sie die Abrechnungsseite besuchen.

### Rechnungshistorie

Vergangene Rechnungen werden unterhalb der Abonnementkarte angezeigt:
- Rechnungsnummer und Datum
- Status (Entwurf, Offen, Bezahlt, Storniert, Uneinbringlich)
- Betrag und Währung
- **Ansehen**: Rechnung im gehosteten Stripe-Viewer öffnen
- **Herunterladen**: Rechnungs-PDF herunterladen

Standardmäßig werden die fünf neuesten Rechnungen angezeigt. Klicken Sie auf **Weitere Rechnungen anzeigen**, um die vollständige Historie zu sehen.

### Kundeninformationen

Aktualisieren Sie die Kontaktdaten, die mit Ihrem Stripe-Kundendatensatz verknüpft sind:
- **Kundenname** und **Unternehmen**
- **E-Mail** und **Telefon**
- **USt-IdNr.**
- **Adresse** (Zeile 1, Zeile 2, Stadt, Bundesland/Kanton, Postleitzahl, Land)

### Rechnungsinformationen

Separate Kontaktdaten, die speziell auf Rechnungen verwendet werden. Klicken Sie auf **Vom Kunden kopieren**, um die Daten aus den obigen Kundeninformationen zu übernehmen.

Die Felder entsprechen dem Bereich Kundeninformationen: Empfängername, Unternehmen, E-Mail, Telefon, USt-IdNr. und vollständige Adresse.

Klicken Sie auf **Änderungen speichern**, um Kunden- und Rechnungsdaten zu aktualisieren. Verwenden Sie **Zurücksetzen**, um nicht gespeicherte Änderungen zu verwerfen.

---

## Authentifizierung

Konfigurieren Sie Single Sign-On (SSO) für Ihre Organisation. Diese Seite ist nur verfügbar, wenn das SSO-Feature aktiviert ist, und ist vom Plattform-Admin-Host aus nicht zugänglich.

### Microsoft Entra ID

Verbinden Sie KANAP mit Ihrem Microsoft Entra ID-Mandanten für SSO:

1. Klicken Sie auf **Verbinden**
2. Melden Sie sich mit einem Microsoft-Administratorkonto an
3. Erteilen Sie die angeforderten Berechtigungen
4. Benutzer können sich jetzt mit ihren Microsoft-Konten anmelden

### SSO-Status

- **Verbunden**: Zeigt Ihre Entra-Mandanten-ID
- **Nicht verbunden**: Nur lokale Authentifizierung

### Aktionen

| Aktion | Beschreibung |
|--------|--------------|
| **Verbinden** | Microsoft Entra-Einrichtungsablauf starten |
| **Erneut verbinden** | Einrichtungsablauf erneut durchführen (wird angezeigt, wenn bereits verbunden) |
| **Anmeldung testen** | SSO-Anmeldung mit Ihrem Microsoft-Konto testen |
| **Trennen** | SSO-Konfiguration entfernen (kehrt zur lokalen Authentifizierung zurück) |

### Tägliche Verzeichnissynchronisierung

Dieser Block erscheint unterhalb der Entra-Karte, sobald Single Sign-On verbunden ist. Jede Nacht um 03:00 Uhr Serverzeit aktualisiert KANAP Namen, Titel, Telefonnummern, Abteilungen und Unternehmen aus Microsoft Entra, aktualisiert den Vorgesetzten der Personen, die Mitwirkende sind, und deaktiviert Konten, die im Verzeichnis entfernt oder deaktiviert wurden.

Abteilungen und Unternehmen werden nach Namen mit bereits in KANAP vorhandenen Datensätzen abgeglichen. Es wird nichts automatisch angelegt. Leere Werte im Verzeichnis löschen niemals das, was bereits in KANAP gespeichert ist.

Die Synchronisierung erfordert eine einmalige Genehmigung durch einen Microsoft Entra-Administrator. Bis sie erteilt ist, zeigt der Block **Noch nicht autorisiert. Ein Microsoft Entra-Administrator muss KANAP die Berechtigung erteilen, Verzeichnisbenutzer zu lesen.**

| Zustand oder Aktion | Was er bedeutet |
|---------------------|-----------------|
| **Noch nicht autorisiert...** | Kein Microsoft Entra-Administrator hat die Synchronisierung genehmigt, oder die erforderliche Berechtigung fehlt in der App-Registrierung. |
| **Zugriff in Microsoft Entra gewähren** | Führt Sie zur Genehmigungsseite von Microsoft. Wird angezeigt, solange die Synchronisierung nicht autorisiert ist. Sie kehren zurück mit **Zugriff gewährt. Die erste Synchronisierung läuft.** |
| **Zuletzt synchronisiert {Datum}: N Konten aktualisiert, N deaktiviert.** | Ergebnis des letzten erfolgreichen Laufs. |
| **Die letzte Synchronisierung ist fehlgeschlagen: {Meldung}** | Der letzte Lauf wurde nicht abgeschlossen. Die Meldung stammt von Microsoft. |
| **Jetzt synchronisieren** | Startet die Synchronisierung sofort, statt auf die kommende Nacht zu warten. Meldet **Synchronisierung abgeschlossen: N Konten aktualisiert, N deaktiviert.** |

Die Einrichtungsschritte für die Entra-App-Registrierung finden Sie unter [Microsoft Entra SSO](on-premise/sso-entra.md).

---

## Branding

Verwenden Sie **Administration > Branding**, um Ihre Unternehmensidentität in KANAP anzuwenden.

- Route: `/admin/branding`
- Berechtigung: `users:admin`
- Geltungsbereich: Nur Mandanten-Hosts (nicht auf dem Plattform-Admin-Host verfügbar)

Mit Branding können Sie:
- Ihr Mandanten-Logo hochladen oder entfernen
- Steuern, ob das Logo im Dunkelmodus angezeigt wird
- Separate Primärfarben für Hell- und Dunkelmodus festlegen
- Alle Branding-Einstellungen auf die Standardwerte zurücksetzen

Für eine vollständige Schritt-für-Schritt-Anleitung siehe: [Branding](branding.md)

---

## Einstellungen

Die Einstellungsseite ermöglicht die Verwaltung Ihres persönlichen Profils und Ihrer Benachrichtigungseinstellungen. Zugriff über das Benutzermenü (Avatar oben rechts) oder durch Navigation zu `/settings`.

Die Seite hat zwei Tabs, erreichbar über URL:
- `/settings/profile` (Standard) -- Profil-Tab
- `/settings/notifications` -- Benachrichtigungs-Tab

### Profil

Bearbeiten Sie Ihre persönlichen Informationen:
- **Vorname** / **Nachname**
- **Berufsbezeichnung**
- **Geschäftstelefon** / **Mobiltelefon**

Wenn Ihre Organisation Microsoft Entra ID (SSO) verwendet, können einige Felder aus Entra synchronisiert sein und in KANAP nicht bearbeitet werden.

### Benachrichtigungen

Steuern Sie, welche E-Mail-Benachrichtigungen Sie erhalten.

**Hauptschalter**: Schalten Sie alle E-Mail-Benachrichtigungen mit dem Schalter **E-Mail-Benachrichtigungen** oben ein oder aus.

**Arbeitsbereich-Kategorien** (jeweils mit eigenem Ein-/Ausschalter):

| Arbeitsbereich | Benachrichtigungskategorien |
|----------------|---------------------------|
| **Portfolio** | Statusänderungen, Hinzufügung zu einem Team, Teamänderungen bei Elementen die Sie leiten, Kommentare |
| **Aufgaben** | Zuweisung (als Beauftragter, Antragsteller oder Betrachter), Statusänderungen, Kommentare |
| **Budget** | Ablaufwarnungen, Statusänderungen, Kommentare |

**Ablaufwarnungen** senden den Verantwortlichen eines Vertrags, einer OPEX-Position oder einer CAPEX-Position 30, 14, 7 und 1 Tag(e) vor deren Terminen eine E-Mail: Kündigungsfrist und Enddatum eines Vertrags, Ende der Gültigkeit einer OPEX- oder CAPEX-Position. Nur Verantwortliche, die die Budget-Benachrichtigungen und die **Ablaufwarnungen** eingeschaltet haben, erhalten sie. Die Prüfung läuft jeden Tag um 08:00 UTC.

**Wöchentliche Zusammenfassungs-E-Mail**: Erhalten Sie eine regelmäßige Zusammenfassung Ihrer Aktivitäten und anstehenden Termine. Konfigurieren Sie:
- **Wochentag** (z. B. Montag)
- **Uhrzeit** (Stunde in Ihrer Zeitzone)
- **Zeitzone**

Verwenden Sie die Schaltfläche **E-Mail-Vorschau**, um sich eine Test-E-Mail zu senden und das Format zu überprüfen.

Alle Änderungen werden automatisch gespeichert, sobald Sie Schalter umschalten oder Auswahlen ändern.

---

## Tipps

  - **Integrierte Rollen duplizieren**: Anstatt Rollen von Grund auf zu erstellen, duplizieren Sie eine integrierte Rolle und passen Sie die Berechtigungen an. Das spart Zeit und stellt sicher, dass Sie keine wichtigen Ressourcen übersehen.
  - **Mehrfach-Rollen für Flexibilität**: Weisen Sie Benutzern mehrere Rollen zu, um Berechtigungen zu kombinieren -- z. B. eine Rolle „Finanz-Leser" plus eine Rolle „Projektmanager".
  - **SSO verwenden**: Wenn Sie Microsoft 365 haben, verbinden Sie Entra ID für einfachere Benutzerverwaltung und automatische Profilsynchronisation.
  - **Deaktivieren statt löschen**: Wenn jemand das Unternehmen verlässt, deaktivieren Sie das Konto, um die Audit-Historie zu bewahren.
  - **Berechtigungen regelmäßig überprüfen**: Prüfen Sie die Rollenberechtigungen regelmäßig, um das Prinzip der minimalen Rechte einzuhalten.
