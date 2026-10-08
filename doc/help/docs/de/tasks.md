# Aufgaben

Aufgaben helfen Ihnen, Aktionspunkte, Ergebnisse und Arbeitspakete über Ihre KANAP-Entitäten hinweg zu verfolgen. Sie werden für Verlängerungserinnerungen, Nachverfolgungen, Compliance-Prüfungen, Projektergebnisse und jede andere Arbeit verwendet, die nachverfolgt werden muss.

## Erste Schritte

Navigieren Sie zu **Portfolio > Aufgaben**, um alle Aufgaben in Ihrer Organisation zu sehen. Klicken Sie auf **Neu**, um eine Aufgabe zu erstellen.

### Eine neue Aufgabe erstellen

Wenn Sie auf **Neu** klicken, öffnet sich der vollständige Aufgaben-Arbeitsbereich. So erstellen Sie eine Aufgabe:

1. **Geben Sie den Titel ein** (erforderlich):
   - Geben Sie den Aufgabentitel in das Textfeld oben ein

2. **Wählen Sie den Kontext**:
   - **Eigenständige Aufgabe** (Standard): Lassen Sie „Verknüpft mit" als **Eigenständig**
   - **Verknüpfte Aufgabe**: Wählen Sie **Projekt**, **OPEX**, **Vertrag** oder **CAPEX** und wählen Sie das spezifische Element

3. **Füllen Sie optionale Details aus**:
   - **Aufgabentyp**: Wählen Sie eine Kategorie für die Arbeit (z. B. Aufgabe, Bug, Problem, Vorfall). Standardmäßig „Aufgabe", wenn verfügbar
   - **Beschreibung**: Fügen Sie detaillierte Informationen mit dem Markdown-Editor hinzu (unterstützt Formatierung, Listen, Links, Bilder)
   - **Phase**: Wählen Sie für Projektaufgaben eine Phase oder lassen Sie sie als „Projektebene"
   - **Klassifizierung** (eigenständige und Projektaufgaben): Legen Sie **Quelle**, **Kategorie**, **Stream** und **Unternehmen** fest. Für Projektaufgaben werden diese vom übergeordneten Projekt vorbelegt. Für eigenständige Aufgaben werden die Standardklassifizierungswerte Ihrer Organisation vorausgefüllt, wenn verfügbar
   - **Status**: Standardmäßig **Offen**
   - **Priorität**: Standardmäßig **Normal**
   - **Daten**: Start- und Fälligkeitsdaten festlegen
   - **Verantwortlicher**: Standardmäßig Sie; bei Bedarf ändern

4. Klicken Sie auf **Erstellen**, wenn bereit (aktiviert, sobald der Titel festgelegt ist). Sie können auch **Strg+S** (oder **Cmd+S** auf Mac) drücken

**Tipp**: Sie können Bilder direkt in die Beschreibung einfügen. Sie werden automatisch in den Speicher hochgeladen, wenn Sie die Aufgabe erstellen.

**Hinweis**: Aufgaben können auch innerhalb anderer Arbeitsbereiche erstellt werden (OPEX-Positionen, Verträge, CAPEX-Positionen, Portfolio-Projekte), in denen die Beziehung vorab ausgewählt ist.

**Pflichtfelder**:
  - **Titel**: Eine kurze Beschreibung dessen, was getan werden muss

**Dringend empfohlen**:
  - **Beschreibung**: Detaillierte Beschreibung der Aufgabe
  - **Verantwortlicher**: Wer ist verantwortlich
  - **Fälligkeitsdatum**: Wann es abgeschlossen sein muss

---

## Wo Sie es finden

- Pfad: **Portfolio > Aufgaben**
- Berechtigungen:
  - Sie benötigen mindestens `tasks:reader`, um Aufgaben anzuzeigen
  - Sie benötigen `tasks:member`, um Aufgaben zu erstellen und Aufgaben in eigenständigen/OPEX/Vertrags-/CAPEX-Kontexten zu bearbeiten
  - Sie benötigen `portfolio_projects:contributor`, um eine Aufgabe zu speichern, wenn der Zielkontext ein Projekt ist
  - Sie benötigen `tasks:admin` für Massenlöschung, CSV-Import und CSV-Export

Wenn Sie Aufgaben nicht im Menü sehen, bitten Sie Ihren Administrator, Ihnen die entsprechenden Berechtigungen zu erteilen.

---

## Arbeiten mit der Liste

Das Aufgaben-Raster zeigt alle Aufgaben in Ihrer Organisation.

**Oberer Bereichsfilter**:
  - **Meine Aufgaben**: Aufgaben, die Ihnen zugewiesen sind oder die Sie erstellt haben
  - **Aufgaben meines Teams**: Aufgaben, die einem Mitglied Ihres Portfolio-Teams zugewiesen sind (einschließlich Ihrer eigenen)
  - **Alle Aufgaben** (Standard): das vollständige Aufgaben-Raster
  - Wenn Sie keinem Portfolio-Team zugewiesen sind, ist **Aufgaben meines Teams** deaktiviert
  - Die Seite öffnet sich mit **Alle Aufgaben**. Ihre Auswahl wird sitzungsübergreifend gespeichert; bei Rückkehr zur Seite wird Ihre letzte Wahl wiederhergestellt

**Standardspalten** (standardmäßig sichtbar):

| Spalte | Was sie zeigt |
|--------|---------------|
| **#** | Element-Referenz (z. B. T-42). Klicken zum Öffnen des Arbeitsbereichs |
| **Aufgabentitel** | Der Aufgabenname. Klicken zum Öffnen des Arbeitsbereichs |
| **Aufgabentyp** | Die Art der Arbeit (z. B. Aufgabe, Bug, Problem, Vorfall) |
| **Kontext** | Der Entitätstyp (Projekt, OPEX, Vertrag, CAPEX oder „Eigenständig") |
| **Status** | Aktueller Zustand mit einem farbigen Punkt |
| **Bewertung** | Berechneter Prioritätswert |
| **Verantwortlicher** | Zugewiesene Person |
| **Klassifizierung** | Portfolio-Kategorie |
| **Stream** | Portfolio-Stream |

**Zusätzliche Spalten** (standardmäßig ausgeblendet; über das Spaltenmenü aktivieren):

| Spalte | Was sie zeigt |
|--------|---------------|
| **Verknüpfter Eintrag** | Der verknüpfte Entitätsname (leer für eigenständige Aufgaben) |
| **Phase** | Projektphase (für Projektaufgaben) |
| **Priorität** | Prioritätsstufe |
| **Fälligkeitsdatum** | Wann die Aufgabe fällig ist |
| **Erstellt** | Wann die Aufgabe erstellt wurde |
| **Zuletzt geändert** | Wann die Aufgabe zuletzt aktualisiert wurde |
| **Beschreibung** | Aufgabenbeschreibungstext |
| **Quelle** | Portfolio-Quellklassifizierung |
| **Unternehmen** | Unternehmensklassifizierung |

**Status-Farben**:
  - **Offen**: Grau
  - **In Bearbeitung**: Blau
  - **Wartend**: Orange
  - **In Test**: Lila
  - **Erledigt**: Grün
  - **Storniert**: Rot

**Prioritäts-Farben**:
  - **Blocker**: Rot
  - **Hoch**: Orange
  - **Normal**: Grau
  - **Niedrig**: Blau
  - **Optional**: Grün

**Standardfilter**: Aktive Aufgaben werden standardmäßig angezeigt (`Offen`, `In Bearbeitung`, `Wartend`, `In Test`). Schließen Sie `Erledigt` und `Storniert` in den Status-Filter ein, um geschlossene Aufgaben zu sehen.

**Aktionen**:
  - **Neu**: Eine eigenständige Aufgabe erstellen (erfordert `tasks:member`)
  - **CSV importieren**: Eine CSV-Datei hochladen, um Aufgaben zu erstellen oder zu aktualisieren (erfordert `tasks:admin`)
  - **CSV exportieren**: Aufgaben in eine CSV-Datei herunterladen (erfordert `tasks:admin`)
  - **Ausgewählte löschen**: Ausgewählte Aufgaben entfernen (erfordert `tasks:admin`)

---

## Der Aufgaben-Arbeitsbereich

Klicken Sie auf eine Zeile, um den Aufgaben-Arbeitsbereich zu öffnen. Der Arbeitsbereich platziert den Aufgabeninhalt (Beschreibung, Anhänge, Aktivität) in der Mitte und zeigt eine **Eigenschaftsleiste** am rechten Rand, die Sie ein- oder ausblenden können.

### Kopfzeilen-Symbolleiste

Die Kopfzeile enthält:
  - **Zurück**-Breadcrumb zu **Aufgaben** (oder zum ursprünglichen Projekt-Arbeitsbereich, wenn Sie von dort kamen)
  - **Positionsindikator**: Ihre Position in der gefilterten Liste (z. B. „3 von 12") mit **Vorherige** / **Nächste**-Pfeilen
  - **Link senden**: Eine Link zur Aufgabe per E-Mail senden
  - **In Anfrage umwandeln**: Die Aufgabe zu einer Portfolio-Anfrage befördern
  - **Löschen**: Die Aufgabe mit ihren Kommentaren und ihrem Verlauf entfernen (erfordert `tasks:admin`). Sie bestätigen zuerst, und das Löschen lässt sich nicht rückgängig machen
  - **Schließen**: Zur Aufgabenliste zurückkehren

Unter der Symbolleiste zeigt der Titelblock:
  - **Element-Referenz-Chip** (z. B. T-42): Klicken, um die Referenz in die Zwischenablage zu kopieren
  - **Titel**: Klicken zum Inline-Bearbeiten (erfordert `tasks:member`)
  - **Status / Priorität / Bewertung / Verantwortlicher / Fälligkeitsdatum** als kompakte, anklickbare Metadaten-Chips
  - **Projekt-Chip** für Projektaufgaben (verlinkt zum Projekt-Arbeitsbereich)

### Hauptinhaltsbereich

**Beschreibung**: Ein Markdown-Editor, der Formatierung, Listen, Links, Codeblöcke und Bilder unterstützt. Sie können Bilder direkt einfügen; sie werden automatisch hochgeladen. Das Drücken von **Tab** im Titelfeld springt in den Beschreibungseditor. Die Beschreibung wird ein paar Sekunden nach dem Aufhören mit dem Tippen automatisch gespeichert; die Kopfzeile zeigt jedes Mal kurz **Gespeichert** an.

**Anhänge**: Ziehen Sie Dateien per Drag-and-Drop auf die Beschreibung oder verwenden Sie den Upload-Bereich, wenn er erscheint. Hochgeladene Dateien erscheinen als Chips unter der Beschreibung. Klicken Sie auf einen Chip zum Herunterladen; klicken Sie auf die **x**-Schaltfläche zum Löschen (erfordert Bearbeitungsberechtigung). Maximal 20 MB pro Datei.

**Aktivitätsbereich**: Wechseln Sie zwischen drei Ansichten:
  - **Kommentare**: Ein einheitliches Aktivitätsformular (Kommentar + optionale Statusänderung + optionales Zeitprotokoll in einer Übermittlung) plus der Kommentarverlauf
  - **Historie**: Alle Feld- und Statusänderungen für die Aufgabe, mit Zeitstempeln und Autoren
  - **Zeitprotokoll**: Zeiteinträge (nur für eigenständige und Projektaufgaben verfügbar)

### Eigenschaftsleiste

Die Leiste ist einklappbar (klicken Sie auf die vertikale Registerkarte **Eigenschaften** am rechten Rand zum Öffnen oder Schließen; drücken Sie **P** als Tastenkürzel). Ihre Breite und der Öffnungszustand werden lokal gespeichert. Die Leiste enthält vier Gruppen, getrennt durch Trennlinien:

**Kontext**:
  - **Verknüpft mit**: Eigenständig, Projekt, OPEX, Vertrag oder CAPEX. Sie können den Typ ändern und ein neues Element auswählen; beim Speichern wendet KANAP alle damit verbundenen Nebeneffekte an (siehe [Aufgaben-Kontext ändern](#aufgaben-kontext-andern))
  - **Phase** (nur Projektaufgaben): Standardmäßig **Projektebene**, es sei denn, Sie wählen eine Projektphase
  - **Aufgabentyp**: Aufgabe, Bug, Problem, Vorfall oder ein beliebiger benutzerdefinierter Typ, der von Ihrem Administrator konfiguriert wurde

**Klassifizierung** (nur eigenständige und Projektaufgaben):
  - **Quelle**: Wo die Arbeit ihren Ursprung hatte
  - **Kategorie**: Die Portfolio-Kategorie für die Arbeit
  - **Stream**: Der spezifische Stream innerhalb der Kategorie (gefiltert nach ausgewählter Kategorie; deaktiviert, bis eine Kategorie ausgewählt ist)
  - **Unternehmen**: Das Unternehmen, auf das sich diese Arbeit bezieht
  - Für OPEX-/Vertrags-/CAPEX-Aufgaben ist dieser Bereich ausgeblendet, es sei denn, Klassifizierungswerte wurden zuvor festgelegt

**Personen**:
  - **Anforderer**: Wer die Arbeit angefordert hat (Standard: Ersteller)
  - **Betrachter**: Zusätzliche Personen, die die Aufgabe sehen sollten

**Verfolgung**:
  - **Startdatum**
  - **Verbrachte Zeit**: Gesamte protokollierte Zeit, mit einem **+ Zeit erfassen**-Schnellzugriff
  - **Anwendungen**: Apps & Dienste, auf die sich diese Aufgabe bezieht
  - **Assets**: Hardware-/Cloud-Assets, auf die sich diese Aufgabe bezieht
  - **Wissensdatenbank**: Verknüpfte Wissensdokumente und ein Schnellzugriff zum Erstellen neuer (erfordert `knowledge:member` für die Erstellung)

**Hinweis**: Das Bearbeiten von Feldern in der Leiste speichert sofort. Es gibt keine Speichern-Schaltfläche an der Leiste.

### Aufgaben-Kontext ändern

Wenn Sie den Kontext einer Aufgabe ändern und speichern, wendet KANAP die Änderung in einem Vorgang an (Kontext plus alle anderen bearbeiteten Felder zusammen).

- **Projekt zu Eigenständig**: Phase wird gelöscht, Klassifizierung wird beibehalten
- **Projekt zu OPEX/Vertrag/CAPEX**: Phase und Klassifizierung werden gelöscht
- **Beliebig zu Projekt**:
  - Projektberechtigung ist erforderlich (`portfolio_projects:contributor`)
  - Phase wird auf Projektebene zurückgesetzt, es sei denn, Sie wählen eine gültige Phase für dieses Projekt
  - Vorhandene Klassifizierung wird beibehalten; fehlende Werte werden aus den Projektstandards automatisch ausgefüllt

---

## Aufgaben-Status

| Status | Bedeutung | Wann zu verwenden |
|--------|---------|-------------|
| **Offen** | Noch nicht begonnen | Standard für neue Aufgaben |
| **In Bearbeitung** | Arbeit hat begonnen | Wenn jemand anfängt, daran zu arbeiten |
| **Wartend** | Wartet auf jemand anderen | Wenn der Verantwortliche blockiert ist und Eingabe/Entscheidung benötigt |
| **In Test** | Bereit zur Validierung | Wenn die Implementierung abgeschlossen ist und auf Überprüfung/Test wartet |
| **Erledigt** | Erfolgreich abgeschlossen | Wenn die Arbeit beendet ist (erfordert protokollierte Zeit für Projektaufgaben) |
| **Storniert** | Nicht mehr benötigt | Wenn die Aufgabe irrelevant wird |

**Wichtig**: Für Projektaufgaben können Sie eine Aufgabe nicht als **Erledigt** markieren, bis Sie zumindest etwas Zeit protokolliert haben. Dies stellt eine genaue Aufwandsverfolgung sicher.

---

## Prioritätsstufen

| Priorität | Anwendungsfall |
|----------|----------|
| **Blocker** | Blockiert andere Arbeit; sofortige Aufmerksamkeit erforderlich |
| **Hoch** | Wichtig und zeitkritisch |
| **Normal** | Standardpriorität (Standard) |
| **Niedrig** | Kann bei Bedarf aufgeschoben werden |
| **Optional** | Nice-to-have, angehen, wenn Kapazität es zulässt |

---

## Zeiterfassung

Eigenständige Aufgaben und Projektaufgaben unterstützen detaillierte Zeiterfassung über das Zeitprotokoll. Zeiterfassung ist nicht für OPEX-, Vertrags- oder CAPEX-Aufgaben verfügbar.

### Zeit erfassen

1. Klicken Sie auf **+ Zeit erfassen** in der Eigenschaftsleiste (Gruppe Verfolgung) oder öffnen Sie den Reiter **Zeitprotokoll** im Aktivitätsbereich
2. Wählen Sie die **Kategorie**: IT oder Business (bestimmt, wie die Zeit zum Projektaufwand beiträgt)
3. Geben Sie das Datum ein, an dem die Arbeit ausgeführt wurde
4. Geben Sie die Zeit als Tage und/oder Stunden ein
5. Fügen Sie optionale Notizen hinzu, die die Arbeit beschreiben
6. Klicken Sie auf **Zeit erfassen**

**Kategorie**: Für Projektaufgaben bestimmt die Kategorie, ob die Zeit zum IT-Aufwand oder Fachbereichs-Aufwand des Projekts zählt. Dies entspricht dem eigenen Zeiterfassungssystem des Projekts.

### Zeiteinträge anzeigen

Der Reiter **Zeitprotokoll** im Aktivitätsbereich zeigt alle Zeiteinträge für die Aufgabe:
  - Datum, an dem die Arbeit ausgeführt wurde
  - Kategorie (IT oder Business)
  - Person, die die Zeit protokolliert hat
  - Erfasste Stunden
  - Notizen

### Einträge bearbeiten oder löschen

Sie können Ihre eigenen Zeiteinträge aus der Zeitprotokoll-Tabelle bearbeiten oder löschen.

---

## Anhänge

Aufgaben unterstützen Datei-Anhänge für Dokumente, Screenshots und andere unterstützende Dateien.

### Anhänge hinzufügen

- Ziehen Sie Dateien per Drag-and-Drop auf den Beschreibungsbereich, oder
- Klicken Sie auf **Dateien durchsuchen** im Upload-Bereich, wenn er sichtbar ist
- Dateien erscheinen als Chips unter der Beschreibung, sobald sie hochgeladen sind

**Dateigrößenlimit**: Maximal 20 MB pro Datei.

### Anhänge verwalten

- **Herunterladen**: Klicken Sie auf einen Anhang-Chip, um die Datei herunterzuladen
- **Löschen**: Klicken Sie auf die **x**-Schaltfläche am Chip, um den Anhang zu entfernen (erfordert Bearbeitungsberechtigung)

Anhänge sind für jeden sichtbar, der die Aufgabe anzeigen kann.

---

## Beschreibungs-Import und -Export

Das Beschreibungsfeld unterstützt das Importieren und Exportieren von Dokumenten, sodass Sie mit Inhalten außerhalb von KANAP arbeiten können.

### Ein Dokument importieren

1. Öffnen Sie einen vorhandenen Aufgaben-Arbeitsbereich (Import ist während der Aufgaben-Erstellung nicht verfügbar)
2. Klicken Sie auf die Schaltfläche **Importieren** neben der Überschrift **Beschreibung**
3. Wählen Sie eine `.docx`-Datei von Ihrem Computer
4. Wenn die Beschreibung bereits Inhalt hat, bestätigen Sie, dass Sie ihn ersetzen möchten
5. Das Dokument wird in Markdown konvertiert und in den Editor geladen
6. Überprüfen Sie das Ergebnis. Die importierte Beschreibung wird sofort gespeichert, und spätere Änderungen werden automatisch gespeichert

In das Dokument eingebettete Bilder werden automatisch in den Speicher hochgeladen. Wenn Inhalte nicht sauber konvertiert werden können, erscheint eine Warnung am unteren Bildschirmrand.

### Die Beschreibung exportieren

1. Klicken Sie auf die Schaltfläche **Exportieren** neben der Überschrift **Beschreibung**
2. Wählen Sie ein Format: **PDF**, **DOCX** oder **ODT**
3. Die Datei wird automatisch heruntergeladen

Die Schaltfläche „Exportieren" ist nur aktiviert, wenn die Beschreibung Inhalt hat.

---

## Kommentare und Historie

### Kommentare hinzufügen

1. Wählen Sie den Reiter **Kommentare** im Aktivitätsbereich aus
2. Geben Sie Ihren Kommentar in den Texteditor ein
3. Wählen Sie optional einen neuen Status aus dem Status-Dropdown
4. Erfassen Sie optional Zeit mit dem Schieberegler (`0` bedeutet kein Zeiteintrag)
5. Klicken Sie auf **Übermitteln** (die Beschriftung der Schaltfläche aktualisiert sich, um Ihre ausgewählten Aktionen widerzuspiegeln)

### Verhalten des einheitlichen Aktivitätsformulars

- Sie können jede Kombination einreichen aus:
  - Nur Kommentar
  - Nur Statusänderung
  - Nur Zeitprotokoll
  - Kommentar + Status + Zeit zusammen
- Für Projektaufgaben erfordert das Setzen des Status auf **Erledigt** protokollierte Zeit (vorhandene + neu hinzugefügte)
- Das Status-Dropdown in der Eigenschaftsleiste funktioniert weiterhin unabhängig, wenn Sie diesen Fluss bevorzugen

### Historie anzeigen

Der Reiter **Historie** zeigt alle Änderungen an der Aufgabe:
  - Statusänderungen
  - Feldänderungen
  - Wer welche Änderung gemacht hat und wann
  - Der Erstellungseintrag mit Datum, Uhrzeit und Ersteller, als letzter Eintrag angezeigt

Das Feld **Antragsteller** ist eine Arbeitsangabe, die jederzeit neu zugewiesen werden kann; die Erstellungszeile zeigt immer, wer die Aufgabe tatsächlich erstellt hat.

### E-Mail-Benachrichtigungen und Schnellaktionen

Wenn Aufgaben-Benachrichtigungen aktiviert sind, können Status- und Kommentar-Updates E-Mail-Benachrichtigungen auslösen.

- Wenn eine Statusänderung und ein Kommentar zusammen übermittelt werden, können Empfänger eine zusammengeführte E-Mail erhalten (abhängig von ihren Benachrichtigungseinstellungen)
- Status-E-Mails können Schnellaktions-Schaltflächen enthalten:
  - **Wartend**: `Antworten & In Bearbeitung setzen`, `Als Erledigt markieren`
  - **In Test**: `Genehmigen` (setzt `Erledigt`), `In Bearbeitung setzen`
  - **Erledigt**: `Wiedereröffnen` (setzt `Offen`)
- Das Klicken auf eine Aktions-Schaltfläche öffnet die Aufgabenseite mit dem Status, der im einheitlichen Aktivitätsformular vorausgewählt ist

---

## Anwendungen und Assets verknüpfen

Aufgaben können mit einer oder mehreren **Anwendungen** (Apps & Dienste) und **Assets** (Hardware- oder Cloud-Ressourcen) verknüpft werden. Die Verknüpfungen leben in der Gruppe **Verfolgung** der Eigenschaftsleiste.

- Verwenden Sie **Anwendungen**, um Arbeit zu kennzeichnen, die bestimmte Apps in Ihrer IT-Landschaft betrifft (z. B. eine Bereitstellung, eine Konfigurationsänderung, einen auf diese App beschränkten Vorfall)
- Verwenden Sie **Assets** für Arbeit, die auf bestimmte Server, Geräte oder Cloud-Assets beschränkt ist

Verknüpfungen sind bidirektional: Aus dem verknüpften Anwendungs- oder Asset-Arbeitsbereich erscheint die Aufgabe in der **Aufgaben**-Beziehung in der Eigenschaftsleiste dieses Arbeitsbereichs. Dies macht es einfach, von „Was ist mit dieser App/diesem Asset los?" zur tatsächlich laufenden Arbeit zu wechseln.

**Tipp**: Reservieren Sie diese Verknüpfungen für Aufgaben, bei denen es operativ um die App oder das Asset geht, nicht für jede Aufgabe, die eine im Vorbeigehen erwähnt. Andernfalls wird die Beziehung zu Rauschen statt zu einem Signal.

---

## Aufgaben aus anderen Arbeitsbereichen erstellen

Aufgaben werden häufig innerhalb anderer Arbeitsbereiche erstellt. Die Beziehung wird vorab ausgewählt, sodass Sie sie nicht von Hand einrichten müssen.

### Aus Portfolio-Projekten
Verwenden Sie im Projekt-Arbeitsbereich den Reiter **Aufgaben**, um Projektergebnisse zu verwalten:
- Aufgaben für bestimmte Arbeitspakete erstellen
- Aufgaben Projektphasen zuweisen
- Zeit gegen jede Aufgabe verfolgen

**Tipp**: Klicken Sie im Reiter Zeitleiste auf die Schaltfläche **[+]** neben einer Phase, um eine Aufgabe zu erstellen, die mit dieser Phase vorab verknüpft ist.

### Aus OPEX-Positionen
Verwenden Sie im OPEX-Arbeitsbereich den Bereich **Aufgaben** im Tab **Übersicht**, um Aufgaben zu erstellen wie:
- „Lieferantenpreise für 2026 überprüfen"
- „Mengenrabatt verhandeln"

### Aus Verträgen
Verwenden Sie im Vertrags-Arbeitsbereich den Reiter **Aufgaben** für:
- „Vertrag vor Verlängerungsdeadline überprüfen"
- „Aktualisierte Bedingungen vom Lieferanten anfordern"

### Aus CAPEX-Positionen
Im CAPEX-Arbeitsbereich verfolgen Aufgaben Projektmeilensteine:
- „Anforderungserfassung abschließen"
- „Budget-Genehmigung einholen"

Diese Aufgaben werden automatisch mit der übergeordneten Entität verknüpft und erscheinen sowohl in der Aufgabenliste als auch im übergeordneten Arbeitsbereich.

---

## Eigenständige Aufgaben

Eigenständige Aufgaben sind unabhängige Arbeitsobjekte, die nicht mit einem bestimmten Projekt, Vertrag oder Budgetposten verknüpft sind. Sie sind nützlich für:
- Allgemeine IT-Betriebsarbeit
- Ad-hoc-Anfragen
- Übergreifende Initiativen
- Persönliche Aufgabenverfolgung

### Eigenständige Aufgaben erstellen

1. Klicken Sie auf **Neu** auf der Aufgabenseite
2. Lassen Sie das Dropdown **Verknüpft mit** als **Eigenständig**
3. Die Eigenschaftsleiste zeigt „Eigenständige Aufgabe" in der Gruppe Kontext
4. Füllen Sie Titel, Beschreibung und andere Details aus
5. Klicken Sie auf **Erstellen**

### Klassifizierungsfelder

Eigenständige Aufgaben und Projektaufgaben haben bearbeitbare Klassifizierungsfelder, die helfen, Arbeit nach Portfolio-Dimensionen zu organisieren:

- **Quelle**: Wo die Arbeit ihren Ursprung hatte (z. B. Geschäftsanfrage, IT-Initiative)
- **Kategorie**: Die Portfolio-Kategorie für die Arbeit
- **Stream**: Der spezifische Stream innerhalb der Kategorie (gefiltert nach ausgewählter Kategorie)
- **Unternehmen**: Das Unternehmen, auf das sich diese Arbeit bezieht

Diese Felder erscheinen in der Gruppe **Klassifizierung** der Eigenschaftsleiste und können jederzeit bearbeitet werden. Beim Erstellen einer neuen eigenständigen Aufgabe werden die Standardklassifizierungswerte Ihrer Organisation automatisch vorausgefüllt, falls konfiguriert.

Für **Projektaufgaben** wird die Klassifizierung beim Erstellen der Aufgabe vom übergeordneten Projekt vorbelegt, kann aber unabhängig geändert werden. Dies erlaubt zum Beispiel, dass eine Infrastrukturaufgabe innerhalb eines Geschäftsprojekts existiert oder eine Compliance-Aufgabe innerhalb eines IT-Projekts. Wenn die Klassifizierung einer Aufgabe nicht ausdrücklich festgelegt ist, erbt sie die Klassifizierung des Projekts und zeigt sie an.

### Prioritätsbewertung

Eigenständige Aufgaben (und alle Nicht-Projektaufgaben) verwenden einen festen Prioritätswert basierend auf ihrer Prioritätsstufe:

| Prioritätsstufe | Wert |
|---------------|-------|
| Blocker | 110 |
| Hoch | 90 |
| Normal | 70 |
| Niedrig | 50 |
| Optional | 30 |

Blocker-Aufgaben erhalten einen Wert von 110, um sicherzustellen, dass sie immer über den höchstpriorisierten Projektaufgaben (max. 100) rangieren.

---

## Projektaufgaben

Projektaufgaben haben zusätzliche Funktionen im Vergleich zu regulären Aufgaben:

**Unabhängige Klassifizierung**: Projektaufgaben haben ihre eigenen Felder Quelle, Kategorie, Stream und Unternehmen. Wenn eine Aufgabe innerhalb eines Projekts erstellt wird, werden diese der Bequemlichkeit halber von der Klassifizierung des Projekts vorbelegt. Die Klassifizierung jeder Aufgabe kann jedoch unabhängig bearbeitet werden. Wenn das Klassifizierungsfeld einer Aufgabe nicht ausdrücklich festgelegt ist, erbt sie den Wert des Projekts und zeigt ihn an.

**Prioritätswert**: Projektaufgaben zeigen einen berechneten Prioritätswert an, der Folgendes kombiniert:
- Den Prioritätswert des übergeordneten Projekts
- Eine Anpassung basierend auf der Prioritätsstufe der Aufgabe (+10 für Blocker, +5 für Hoch, 0 für Normal, -5 für Niedrig, -10 für Optional)

Der Wert erscheint in der Metadatenleiste oben im Arbeitsbereich und als Spalte **Bewertung** in der Aufgabenliste.

**Phasen-Zuweisung**: Aufgaben können bestimmten Projektphasen zugewiesen werden oder als „Projektebene" für übergreifende Arbeit markiert werden.

**Zeit-Beitrag**: Zeit, die für Projektaufgaben protokolliert wird, trägt zu den tatsächlichen Aufwandsberechnungen des Projekts bei:
- IT-Kategorie-Zeit fügt zum **Tatsächlichen Aufwand (IT)** hinzu
- Business-Kategorie-Zeit fügt zum **Tatsächlichen Aufwand (Business)** hinzu
- Der Reiter Fortschritt des Projekts zeigt eine Aufschlüsselung von Projekt-Overhead vs. Aufgabenzeit
- Das einheitliche Zeitprotokoll zeigt alle Zeiteinträge sowohl aus dem Projekt-Overhead als auch aus der Aufgabenarbeit

**Status-Validierung**: Projektaufgaben können nicht als **Erledigt** markiert werden, ohne zuerst Zeit zu protokollieren. Dies stellt eine genaue Verfolgung des Projektaufwands sicher.

**Filterung**: Der Reiter Aufgaben des Projekts enthält Filter für:
- Status (Alle, Aktiv, bestimmter Status)
- Phase (Alle Phasen, Projektebene, bestimmte Phase)

---

## CSV-Import/Export

Verwalten Sie Aufgaben in großem Maßstab mit CSV-Import und -Export. Diese Funktion unterstützt Massenoperationen für das initiale Datenladen, Aufgabenmigrationen und Datenextraktion für Berichte.

### Zugriff auf CSV-Funktionen

Aus der Aufgabenliste:
  - **CSV exportieren**: Aufgaben in eine CSV-Datei herunterladen
  - **CSV importieren**: Eine CSV-Datei hochladen, um Aufgaben zu erstellen oder zu aktualisieren
  - **Vorlage herunterladen**: Eine leere CSV mit korrekten Spaltenköpfen erhalten (aus dem Import-Dialog)

**Erforderliche Berechtigungen**: `tasks:admin` für Import-/Export-Operationen.

### Exportoptionen

Drei Exportmodi sind verfügbar:

| Option | Beschreibung |
|--------|-------------|
| **Vollständiger Export** | Alle exportierbaren Felder — für Berichterstellung und vollständige Datenextraktion verwenden |
| **Datenanreicherung** | Alle importierbaren Felder — entspricht dem Importvorlagenformat, ideal für Round-Trip-Bearbeitung (Export, Änderung, erneuter Import) |
| **Benutzerdefinierte Auswahl** | Bestimmte Felder auswählen, die in Ihren Export aufgenommen werden sollen |

**Vorlage herunterladen** (aus Import-Dialog): Lädt eine leere CSV mit allen importierbaren Feld-Spaltenköpfen herunter — verwenden Sie dies, um Importdateien mit der korrekten Struktur vorzubereiten.

### Import-Workflow

1. **Datei vorbereiten**: Verwenden Sie UTF-8-Kodierung mit Semikolon (`;`) als Trennzeichen. Laden Sie eine Vorlage herunter, um korrekte Spaltenköpfe sicherzustellen.

2. **Importeinstellungen wählen**:
   - **Modus**:
     - `Anreichern` (Standard): Leere Zellen erhalten vorhandene Werte — nur aktualisieren, was Sie angeben
     - `Ersetzen`: Leere Zellen löschen vorhandene Werte — vollständiger Ersatz aller Felder
   - **Operation**:
     - `Upsert` (Standard): Neue Aufgaben erstellen oder vorhandene aktualisieren
     - `Nur aktualisieren`: Nur vorhandene Aufgaben ändern, neue überspringen
     - `Nur einfügen`: Nur neue Aufgaben erstellen, vorhandene überspringen

3. **Zuerst validieren**: Klicken Sie auf **Preflight**, um Ihre Datei ohne Änderungen zu validieren. Überprüfen Sie Fehler und Warnungen.

4. **Änderungen anwenden**: Wenn die Validierung erfolgreich ist, klicken Sie auf **Importieren**, um Änderungen zu übernehmen.

### Feldreferenz

**Grundfelder**:

| CSV-Spalte | Beschreibung | Erforderlich | Hinweise |
|------------|-------------|----------|-------|
| `id` | Aufgaben-UUID | Nein | Für Updates; bei neuen Aufgaben leer lassen |
| `title` | Aufgabentitel | Ja | Teil der eindeutigen Kennung |
| `description` | Aufgabendetails | Nein | Unterstützt einfachen Text |

**Kontextfelder**:

| CSV-Spalte | Beschreibung | Erforderlich | Hinweise |
|------------|-------------|----------|-------|
| `related_object_type` | Entitätstyp | Nein | Leer für eigenständige Aufgaben; akzeptiert Code oder Bezeichnung |
| `related_object_id` | Entitäts-UUID | Bedingt | Erforderlich, wenn verknüpfte Aufgabe und `related_object_name` nicht angegeben |
| `related_object_name` | Entitätsname | Bedingt | Erforderlich, wenn verknüpfte Aufgabe und `related_object_id` nicht angegeben |
| `phase_name` | Projektphase | Nein | Muss mit vorhandenem Phasennamen übereinstimmen (nur Projektaufgaben) |
| `priority_level` | Aufgabenpriorität | Nein | Akzeptiert Code oder Bezeichnung |
| `source_name` | Quelle | Nein | Portfolio-Quelle (eigenständige und Projektaufgaben) |
| `category_name` | Kategorie | Nein | Portfolio-Kategorie (eigenständige und Projektaufgaben) |
| `stream_name` | Stream | Nein | Portfolio-Stream (eigenständige und Projektaufgaben) |
| `company_name` | Unternehmen | Nein | Unternehmen (eigenständige und Projektaufgaben) |

**Eigenständige Aufgaben**: Lassen Sie `related_object_type`, `related_object_id` und `related_object_name` leer. Sie können Klassifizierungsfelder (`source_name`, `category_name`, `stream_name`, `company_name`) für eigenständige und Projektaufgaben festlegen. Für Projektaufgaben werden ausgelassene Klassifizierungsfelder vom übergeordneten Projekt vorbelegt.

**Tipp**: Verwenden Sie für neue Importe verknüpfter Aufgaben `related_object_name` anstelle von `related_object_id` — es ist viel einfacher zu handhaben. Das System löst den Namen basierend auf `related_object_type` zur korrekten ID auf. Für Round-Trip-Importe (Export, Bearbeitung, erneuter Import) sind beide Felder enthalten, sodass der Abgleich korrekt funktioniert.

**Status und Daten**:

| CSV-Spalte | Beschreibung | Hinweise |
|------------|-------------|-------|
| `status` | Aufgabenstatus | Akzeptiert Code oder Bezeichnung |
| `start_date` | Startdatum | Datumsformat: YYYY-MM-DD |
| `due_date` | Fälligkeitsdatum | Datumsformat: YYYY-MM-DD |

**Personenfelder**:

| CSV-Spalte | Beschreibung | Hinweise |
|------------|-------------|-------|
| `assignee_email` | Verantwortliche Person | Muss mit vorhandener Benutzer-E-Mail übereinstimmen |
| `creator_email` | Anforderer-E-Mail | Nur Export (in Feld-Metadaten als **Anforderer-E-Mail** angezeigt) |
| `viewer_email_1` bis `_4` | Betrachter | Müssen mit vorhandenen Benutzer-E-Mails übereinstimmen |
| `owner_email_1` bis `_4` | Verantwortliche | Müssen mit vorhandenen Benutzer-E-Mails übereinstimmen |

**Andere Felder**:

| CSV-Spalte | Beschreibung | Hinweise |
|------------|-------------|-------|
| `labels` | Aufgaben-Labels | Komma-getrennte Liste |

### Akzeptanz von Bezeichnungen und Codes

Für **status**, **priority_level** und **related_object_type** können Sie entweder den internen Code oder eine gängige Bezeichnung verwenden:

**Status-Werte**:

| Code | Akzeptierte Bezeichnungen |
|------|-----------------|
| `open` | `Open` |
| `in_progress` | `In Progress`, `Active`, `Working` |
| `pending` | `Pending` |
| `in_testing` | `In Testing`, `Testing` |
| `done` | `Done`, `Completed`, `Complete`, `Finished`, `Closed` |
| `cancelled` | `Cancelled`, `Canceled` |

**Prioritätsstufen-Werte**:

| Code | Akzeptierte Bezeichnungen |
|------|-----------------|
| `blocker` | `Blocker`, `Critical`, `Urgent` |
| `high` | `High` |
| `normal` | `Normal`, `Medium`, `Default` |
| `low` | `Low` |
| `optional` | `Optional`, `Nice to have` |

**Werte für verwandte Objekttypen**:

| Code | Akzeptierte Bezeichnungen |
|------|-----------------|
| `project` | `Project` |
| `spend_item` | `Spend Item`, `Spend` |
| `contract` | `Contract` |
| `capex_item` | `CAPEX Item`, `CAPEX` |

Das System normalisiert Werte automatisch beim Import.

### Abgleich und Updates

Aufgaben werden nach **Titel + related_object_id** (Groß-/Kleinschreibung ignorierend) abgeglichen. Wenn ein Treffer gefunden wird:
  - Mit `Anreichern`-Modus: Nur nicht-leere CSV-Werte aktualisieren die Aufgabe
  - Mit `Ersetzen`-Modus: Alle Felder werden aktualisiert, leere Werte löschen vorhandene Daten

Wenn Sie die Spalte `id` mit einer gültigen UUID einschließen, verwendet der Abgleich zuerst die ID und greift dann auf Titel + verwandtes Objekt zurück.

**Hinweis**: Wenn Sie `related_object_name` anstelle von `related_object_id` angeben, löst das System den Namen vor dem Abgleich zur ID auf. Das bedeutet, Sie können in Ihrer Importdatei durchgehend für Menschen lesbare Namen verwenden.

### Nur-Export-Felder

Einige Felder erscheinen in Exporten, können aber nicht importiert werden. Dies sind systemverwaltete Felder, die die Datenintegrität aufrechterhalten:

| Feld | Warum nur Export |
|-------|---------------------|
| `creator_email` (Anforderer) | Wird automatisch auf den Benutzer gesetzt, der die Aufgabe erstellt. Ein Import würde die Integrität der Audit-Spur kompromittieren. Bei neuen Aufgaben setzt das System dies auf den importierenden Benutzer; bei vorhandenen Aufgaben wird der ursprüngliche Anforderer beibehalten. |

Diese Felder sind im **Vollständigen Export** für Berichtszwecke enthalten, aber von **Vorlagen**- und **Datenanreicherungs**-Exporten ausgeschlossen, da sie während des Imports nicht geändert werden können.

### Einschränkungen

  - **Maximal 4 Betrachter/Verantwortliche**: Aufgaben unterstützen bis zu 4 Betrachter-E-Mails und 4 Verantwortlichen-E-Mails per CSV
  - **Klassifizierung nur für eigenständige und Projektaufgaben**: Quelle, Kategorie, Stream und Unternehmen können auf eigenständigen und Projektaufgaben festgelegt werden (nicht auf OPEX-, Vertrags- oder CAPEX-Aufgaben)
  - **Phase erfordert Projekt**: Phasenzuweisung funktioniert nur für Projektaufgaben
  - **Anwendungs-/Asset-Verknüpfungen nicht in CSV**: Verwenden Sie die Eigenschaftsleiste des Arbeitsbereichs, um Aufgaben mit Anwendungen und Assets zu verknüpfen
  - **Kommentare nicht enthalten**: Aufgabenkommentare und -historie müssen im Arbeitsbereich verwaltet werden
  - **Zeitprotokoll nicht enthalten**: Zeiteinträge müssen im Arbeitsbereich protokolliert werden
  - **Anhänge nicht enthalten**: Datei-Anhänge erfordern Arbeitsbereich-Verwaltung

### Fehlerbehebung

**Fehler „Datei ist nicht richtig formatiert"**: Dies weist normalerweise auf ein Kodierungsproblem hin. Stellen Sie sicher, dass Ihre CSV als **UTF-8** gespeichert ist:

  - **In LibreOffice**: Wählen Sie beim Öffnen einer CSV `UTF-8` im Zeichensatz-Dropdown (nicht „Japanese (Macintosh)" oder andere Kodierungen). Beim Speichern aktivieren Sie „Filtereinstellungen bearbeiten" und wählen Sie UTF-8.
  - **In Excel**: Speichern unter > CSV UTF-8 (Komma-getrennt), dann in einem Texteditor öffnen, um Kommas in Semikolons zu ändern.
  - **Allgemeiner Tipp**: Wenn Sie verstümmelte Zeichen am Anfang Ihrer Datei sehen, ist die Kodierung falsch.

### Beispiel-CSV

Mit für Menschen lesbaren Namen (empfohlen für neue Importe):

```csv
title;related_object_type;related_object_name;status;priority_level;due_date;assignee_email;source_name;category_name
Review contract terms;Contract;Acme Software License;Open;High;2026-02-28;john.doe@example.com;;
Update documentation;project;Website Redesign;In Progress;Normal;2026-03-15;jane.smith@example.com;;
Schedule kickoff;spend_item;Cloud Hosting 2026;open;low;2026-04-01;bob.wilson@example.com;;
Audit IT security;;;open;high;2026-03-01;security@example.com;IT Initiative;Security
```

Die letzte Zeile ist eine **eigenständige Aufgabe** (kein verwandtes Objekt) mit gesetzten Klassifizierungsfeldern.

Mit UUIDs (typischerweise aus Round-Trip-Exporten):

```csv
title;related_object_type;related_object_id;status;priority_level;due_date;assignee_email
Review contract terms;Contract;550e8400-e29b-41d4-a716-446655440000;Open;High;2026-02-28;john.doe@example.com
Update documentation;project;660e8400-e29b-41d4-a716-446655440001;In Progress;Normal;2026-03-15;jane.smith@example.com
Schedule kickoff;spend_item;770e8400-e29b-41d4-a716-446655440002;open;low;2026-04-01;bob.wilson@example.com
```

---

## Eine Aufgabe in eine Anfrage umwandeln

Sie können eine Aufgabe zu einer Portfolio-Anfrage befördern, wenn die Arbeit eine formale Bewertung, Priorisierung oder schließlich ein eigenes Projekt verdient. Die Konvertierung ist aus der Aufgaben-Arbeitsbereichs-Kopfzeile verfügbar.

### So konvertieren Sie

1. Öffnen Sie den Aufgaben-Arbeitsbereich
2. Klicken Sie auf **In Anfrage umwandeln** in der Kopfzeilen-Symbolleiste (neben **Link senden**)
3. Im Dialog:
   - **Anfragenname**: Standardmäßig der Aufgabentitel — bei Bedarf bearbeiten
   - **Zweck-Vorschau**: Zeigt die Aufgabenbeschreibung an, die zum Zweck der Anfrage wird
   - **Ursprüngliche Aufgabe nach Konvertierung schließen**: Aktivieren Sie diese Option, wenn der Aufgaben-Status automatisch auf **Erledigt** gesetzt werden soll
4. Klicken Sie auf **In Anfrage umwandeln**

Nach der Konvertierung navigiert KANAP Sie zum neu erstellten Anfragen-Arbeitsbereich.

### Was übernommen wird

Die neue Anfrage erbt Folgendes von der ursprünglichen Aufgabe:

| Aufgabenfeld | Anfragenfeld |
|------------|--------------|
| Titel | Name |
| Beschreibung | Zweck |
| Fälligkeitsdatum | Ziel-Lieferdatum |
| Quelle, Kategorie, Stream, Unternehmen | Quelle, Kategorie, Stream, Unternehmen |
| Anhänge | Anhänge (kopiert) |

Die Anfrage wird mit dem Status **Wartet auf Überprüfung** erstellt und ist mit der ursprünglichen Aufgabe verknüpft. Ein Historie-Eintrag wird sowohl auf der Aufgabe („In Anfrage umgewandelt") als auch auf der Anfrage („Erstellt aus Aufgabe" mit einem Link zur ursprünglichen Aufgabe) aufgezeichnet.

### Bedingungen

- **Berechtigungen**: Sie benötigen sowohl `tasks:member` als auch `portfolio_requests:member`
- **Einmalige Konvertierung**: Jede Aufgabe kann nur einmal konvertiert werden. Nach der Konvertierung ist die Schaltfläche **In Anfrage umwandeln** deaktiviert und zeigt die verknüpfte Anfragenreferenz an (z. B. „Bereits in REQ-42 konvertiert")
- **Aufgabe bleibt**: Die ursprüngliche Aufgabe wird nicht gelöscht. Es sei denn, Sie aktivieren die Schließen-Option, bleibt sie in ihrem aktuellen Status und kann unabhängig weiter aktualisiert werden

**Tipp**: Verwenden Sie dies, wenn eine Aufgabe eine größere Initiative offenbart, die ihren eigenen Anfrage-Lebenszyklus benötigt — Kriterienbewertung, Genehmigungs-Workflow und schließlich Konvertierung in ein Projekt.

---

## Einen Link senden

Sie können einen Link zu jeder Aufgabe per E-Mail an Kollegen oder externe Kontakte senden.

1. Öffnen Sie den Aufgaben-Arbeitsbereich
2. Klicken Sie auf **Link senden** in der Kopfzeilen-Symbolleiste
3. Im Dialog:
   - **Empfänger auswählen**: Suchen Sie nach vorhandenen Plattformbenutzern nach Name oder E-Mail und/oder geben Sie eine beliebige E-Mail-Adresse ein und drücken Sie Enter
   - **Eine Nachricht hinzufügen** (optional): Eine persönliche Notiz einfügen
   - **Link kopieren**: Klicken Sie auf das Kopier-Symbol, um die direkte URL zu erfassen
4. Klicken Sie auf **Senden**

Empfänger erhalten eine E-Mail mit Ihrem Namen, dem Aufgabentitel, einem direkten Link und Ihrer Nachricht (falls angegeben). Dies ändert keine Berechtigungen — es benachrichtigt einfach die Empfänger.

**Tipp**: Sie können Plattformbenutzer und externe E-Mail-Adressen in derselben Übermittlung mischen.

---

## Tastenkombinationen

Wenn der Fokus nicht auf einem Eingabefeld liegt, können Sie verwenden:

- **J** oder **←**: Vorherige Aufgabe in der aktuellen Liste
- **K** oder **→**: Nächste Aufgabe in der aktuellen Liste
- **P**: Eigenschaftsleiste umschalten
- **Escape**: Schließen und zur Liste zurückkehren
- **Strg+S** / **Cmd+S**: Speichern (oder Erstellen, im Erstellungsmodus)
- **Tab** vom Titelfeld: Direkt in den Beschreibungseditor springen

---

## Tipps

  - **Verwenden Sie Fälligkeitsdaten**: Setzen Sie realistische Fälligkeitsdaten, um Deadlines effektiv zu verfolgen.
  - **Weisen Sie Verantwortliche zu**: Jede Aufgabe sollte einen Verantwortlichen für die Rechenschaftspflicht haben.
  - **Erfassen Sie Zeit regelmäßig**: Zeiterfassung hilft bei zukünftigen Projektschätzungen.
  - **Nach Status filtern**: Der Standardfilter zeigt nur aktive Status (`Offen`, `In Bearbeitung`, `Wartend`, `In Test`) — schließen Sie `Erledigt` und `Storniert` ein, wenn Sie historische Aufgaben überprüfen.
  - **Aus dem Kontext erstellen**: Das Erstellen von Aufgaben aus Arbeitsbereichen heraus (Projekt, OPEX, Vertrag, CAPEX) verknüpft sie automatisch.
  - **Apps und Assets verknüpfen**: Verwenden Sie die Felder **Anwendungen** und **Assets** in der Eigenschaftsleiste, wenn eine Aufgabe operativ um eine bestimmte App oder ein Asset geht. Die Verknüpfung erscheint auch im Arbeitsbereich der verbundenen Entität.
  - **Verwenden Sie Priorität klug**: Reservieren Sie **Blocker** für tatsächlich blockierende Probleme.
  - **Verwenden Sie Single-Submit-Updates**: Kombinieren Sie im Reiter Kommentare Kommentar + Status + Zeit in einer Aktion, um Historie und Benachrichtigungen abgestimmt zu halten.
  - **Dokumente importieren**: Verwenden Sie die Schaltfläche **Importieren**, um `.docx`-Dateien als Beschreibungsinhalt einzubringen, anstatt zu kopieren und einzufügen.
  - **Tastenkombination**: Drücken Sie **Strg+S** (oder **Cmd+S** auf Mac), um schnell zu speichern, ohne nach der Speichern-Schaltfläche greifen zu müssen.
  - **Wissensartikel verknüpfen**: Verwenden Sie die Wissens-Gruppe in der Eigenschaftsleiste, um relevante Dokumentation mit Ihren Aufgaben zu verbinden.
