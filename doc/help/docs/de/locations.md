# Standorte

Standorte dokumentieren, wo Ihre IT-Infrastruktur gehostet wird: Rechenzentren, Cloud-Regionen, Büroserverräume und Colocation-Einrichtungen. Das Zuweisen von Assets und Anwendungen zu Standorten gibt Ihnen geografische Sichtbarkeit, hilft bei der Kapazitätsplanung und hält Einrichtungskontakte griffbereit, wenn Sie sie brauchen.

## Erste Schritte

Navigieren Sie zu **IT-Landschaft > Standorte**, um das Standortverzeichnis zu öffnen. Klicken Sie auf **Standort hinzufügen**, um einen neuen Eintrag zu erstellen.

**Pflichtfelder**:
- **Code**: Ein eindeutiger Kurzidentifikator (z. B. `DC-EU-WEST`, `AWS-US-EAST-1`)
- **Name**: Ein beschreibender Anzeigename
- **Hosting-Typ**: Die Art der Einrichtung: eigenes Rechenzentrum, Colocation, Cloud-Region usw.

**Dringend empfohlen**:
- **Land**: Wo sich der Standort geografisch befindet
- **Anbieter** oder **Betreiberunternehmen**: Wer die Einrichtung betreibt

**Tipp**: Verwenden Sie konsistente Namenskonventionen. Das Voranstellen des Anbieternamens bei Cloud-Standorten (`AWS-`, `AZURE-`, `GCP-`) macht sie in Listen und Berichten leicht erkennbar.

---

## Arbeiten mit der Liste

Die Liste gibt Ihnen einen durchsuchbaren Überblick über jeden registrierten Standort.

**Standardspalten**:
- **Code**: Standortcode (klicken, um den Arbeitsbereich zu öffnen)
- **Name**: Anzeigename
- **Hosting-Typ**: On-prem, Colocation, Public Cloud usw.
- **Anbieter / Unternehmen**: Cloud-Anbieter für Cloud-Typ-Standorte oder Betreiberunternehmen für On-prem-Standorte
- **Land**: Ländername und ISO-Code
- **Stadt**: Stadtname
- **Assets**: Anzahl der diesem Standort zugewiesenen Assets
- **Erstellt**: Wann der Datensatz erstellt wurde

**Filterung**:
- Schnellsuche: Freitextsuche über alle Zeilen
- Spaltenfilter: Textfilter für Code, Name und Stadt; Set-Filter für Hosting-Typ

**Aktionen**:
- **Standort hinzufügen**: Einen neuen Standort erstellen (erfordert `locations:member`)

Sie können Spalten auch über die Spaltenauswahl anzeigen, ausblenden und umordnen.

---

## Der Standort-Arbeitsbereich

Klicken Sie auf eine Zeile, um den Arbeitsbereich zu öffnen. Er hat vier Reiter: **Übersicht**, **Kontakte & Support**, **Beziehungen** und **Verlauf** (die Änderungen am Standort, siehe [Verlauf der Datensätze](record-history.md)). Die Reiter Kontakte & Support und Beziehungen werden nach dem erstmaligen Speichern des Standorts verfügbar.

### Übersicht

Der Reiter Übersicht erfasst Identitäts- und geografische Informationen, aufgeteilt in zwei Abschnitte, plus ein Unter-Standorte-Panel.

**Grundinformationen**:
- **Code**: Eindeutiger Identifikator (erforderlich)
- **Name**: Anzeigename (erforderlich)
- **Hosting-Typ**: Kategorie der Einrichtung (erforderlich). Hosting-Typen sind in **IT-Landschaft > Einstellungen** konfigurierbar.

**Standortdetails**: die hier angezeigten Felder hängen von der Hosting-Typ-Kategorie ab:

Für **On-Premises**-Hosting-Typen:
- **Betreiberunternehmen**: Das Unternehmen, das die Einrichtung betreibt. Die Auswahl eines Unternehmens füllt Land und Stadt automatisch aus, wenn diese leer sind.

Für **Cloud**-Hosting-Typen:
- **Cloud-Anbieter**: Der Cloud-Anbieter (z. B. AWS, Azure, GCP)
- **Region**: Cloud-Region oder Verfügbarkeitszone

Beide Kategorien zeigen außerdem:
- **Land**: Ausgewählt aus der ISO-Länderliste
- **Stadt**: Stadtname
- **Zusätzliche Informationen**: Freitext-Notizen zum Standort

**So funktioniert es**: Das Wechseln zwischen einem On-prem- und einem Cloud-Hosting-Typ löscht die Felder, die zur anderen Kategorie gehören. Der Editor bittet um Bestätigung, bevor der Wechsel durchgeführt wird.

#### Unter-Standorte

Unterhalb des Hauptformulars ermöglicht das Panel **Unter-Standorte**, einen Standort in kleinere physische Bereiche aufzuteilen: Gebäude, Räume, Racks, Cages oder jede andere Unterteilung, die für Ihre Infrastruktur sinnvoll ist.

Jeder Unter-Standort hat:
- **Name**: Eine kurze Bezeichnung (z. B. „Gebäude A, Raum 1, Rack 5")
- **Beschreibung**: Optionale zusätzliche Details

Unter-Standorte sind verfügbar, sobald der Standort existiert (nachdem Sie auf **Erstellen** geklickt haben). Jede Zeile wird einzeln gespeichert, wenn Sie das Feld verlassen, und das Löschen eines Unter-Standorts muss zuerst bestätigt werden.

Assets können einem bestimmten Unter-Standort innerhalb eines Standorts zugewiesen werden, um genau zu verfolgen, wo Hardware steht. Der Reiter Beziehungen zeigt den Unter-Standort jedes Assets, das einen hat.

---

### Kontakte & Support

Dieser Reiter organisiert die Personen und Referenzen, die mit einem Standort verbunden sind, in drei Abschnitte.

**Interne Kontakte**: Teammitglieder Ihrer Organisation, die mit diesem Standort verknüpft sind. Jede Zeile hat einen **Benutzer**-Picker und ein Freitext-**Rolle**-Feld (z. B. „Ops-Leiter", „Sicherheitsbeauftragter").

**Externe Kontakte**: Drittanbieter-Kontakte aus Ihren Kontakte-Stammdaten. Jede Zeile hat einen **Kontakt**-Picker und ein **Rolle**-Feld (z. B. „Account-Manager", „NOC-Kontakt").

**Relevante Websites**: Nützliche Links wie Anbieterportale, Einrichtungsdokumentation oder Statusseiten. Jede Zeile hat eine **Beschreibung** und eine **URL**.

Änderungen werden automatisch gespeichert. Ein hinzugefügter Kontakt oder Link wird sofort gespeichert, eine Rolle, Beschreibung oder URL beim Verlassen des Felds.

---

### Beziehungen

Der Reiter Beziehungen zeigt die Assets an diesem Standort und die Anwendungen, die darauf laufen, danach die Weblinks des Standorts. Klicken Sie auf eine Zeile, um das Asset oder die Anwendung zu öffnen. Das Badge des Reiters zählt die Assets und Anwendungen, die Sie sehen dürfen, und die Weblinks.

| Abschnitt | Spalten |
|---|---|
| **Assets** | Referenz (`AST-12`), Name, Unterstandort, Typ, Umgebung, Anbieter, Status |
| **Anwendungen** | Referenz (`APP-3`), Name, Umgebungen, Lebenszyklus |

**Assets** listet die Assets an diesem Standort. Die Spalte **Unterstandort** erscheint nur, wenn mindestens ein Asset einen Unter-Standort hat. Der Abschnitt ist schreibgeschützt: Den Standort eines Assets legen Sie am Asset selbst fest. Er erfordert Leserechte auf die Infrastruktur.

**Anwendungen** listet die Anwendungen mit einer Instanz auf einem dieser Assets. **Umgebungen** zeigt die Umgebungen dieser Instanzen. Der Abschnitt ist schreibgeschützt und erfordert Leserechte auf die Anwendungen. Ein Fachbereichs-Mitwirkender sieht nur die Anwendungen, an denen er beteiligt ist.

**Weblinks**: die Links des Standorts (Anbieterportale, Einrichtungsdokumentation, Statusseiten), je eine Zeile mit Name, der Domain des Links und dem Datum, an dem er hinzugefügt wurde. Es sind dieselben Links wie die **Relevanten Websites** im Reiter Kontakte & Support. Klicken Sie auf einen Link, um ihn in einem neuen Tab zu öffnen. Mit `locations:member`:

- **Link hinzufügen** öffnet einen Dialog für eine URL und einen optionalen Namen; der Link wird sofort gespeichert. Um einen Link zu ändern, fahren Sie mit der Maus über seine Zeile und klicken Sie auf den Stift.
- Um einen Link zu entfernen, fahren Sie mit der Maus über seine Zeile und klicken Sie auf das Kreuz. Eine Meldung nennt den Link und bietet **Rückgängig** an, womit er wieder angelegt wird.

---

## Einen Standort löschen

Klicken Sie in der Arbeitsbereich-Kopfzeile auf **Löschen** (Papierkorbsymbol), um einen Standort zu entfernen.

- Erfordert die Berechtigung `locations:member`.
- Ein Standort, dem noch Assets zugeordnet sind, kann nicht gelöscht werden: Die Meldung nennt ihre Anzahl. Ordnen Sie die Assets zuerst einem anderen Standort zu.
- Wenn Sie ungespeicherte Änderungen im Arbeitsbereich haben, gehen diese bei der Löschung verloren.

---

## Hosting-Typen

Hosting-Typen sind in **IT-Landschaft > Einstellungen** konfigurierbar. Jeder Typ gehört zu einer Kategorie, die bestimmt, welche Felder im Arbeitsbereich erscheinen.

| Typ | Kategorie | Beispiel |
|------|----------|---------|
| Privates Rechenzentrum | On-prem | Firmeneigene Einrichtung |
| Colocation | On-prem | Gemieteter Platz in einer gemeinsamen Einrichtung |
| Public Cloud | Cloud | AWS, Azure, GCP |
| Private Cloud | Cloud | Firmenbetriebene Cloud-Plattform |
| Edge | Cloud | Edge-Computing-Standorte |

---

## Berechtigungen

| Aktion | Mindeststufe |
|--------|---------------|
| Liste und Arbeitsbereich anzeigen | `locations:reader` |
| Standort erstellen, bearbeiten oder löschen | `locations:member` |
| Hosting-Typen und Anbieter konfigurieren | `settings:admin` |

---

## Tipps

- **Seien Sie konsistent mit Codes**: Eine klare Namenskonvention macht Standorte auf einen Blick erkennbar und hält Filter nützlich.
- **Verwenden Sie Unter-Standorte für Granularität**: Wenn ein Rechenzentrum mehrere Räume oder Racks hat, modellieren Sie diese als Unter-Standorte statt als separate Standorte. Dies hält die Liste sauber und verfolgt dennoch die physische Platzierung.
- **Verfolgen Sie Cloud-Regionen einzeln**: Erstellen Sie einen Standort pro verwendeter Cloud-Region, nicht nur einen pro Anbieter.
- **Verknüpfen Sie Assets mit Standorten**: Dies ermöglicht geografische Berichte, DR-Planung und schnelle Auswirkungsanalyse bei Ausfällen.
- **Dokumentieren Sie Kontakte frühzeitig**: Einrichtungskontakte vor einem Vorfall zu haben, spart wertvolle Zeit, wenn es darauf ankommt.
