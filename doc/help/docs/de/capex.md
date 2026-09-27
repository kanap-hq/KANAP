# CAPEX

CAPEX-Positionen (Capital Expenditure / Investitionsausgaben) sind Ihre Investitionen in langfristige Vermögenswerte: Hardwarekäufe, Softwarelizenzen mit mehrjährigem Wert, Infrastrukturprojekte und Ausrüstung. Hier planen Sie Investitionsbudgets, verfolgen Projektausgaben und ordnen Kosten Ihrer Organisation zu.

Der CAPEX-Arbeitsbereich unterstützt Sie bei der Verwaltung jeder Investitionsposition von der ersten Budgetierung über die Durchführung bis zur Berichterstattung -- alles an einem Ort mit jahresbezogenen Budgetspalten, flexiblen Zuordnungsmethoden und direkten Verknüpfungen zu Projekten, Anwendungen, Verträgen und Kontakten.

## Erste Schritte

Navigieren Sie zu **Budgetverwaltung > CAPEX**, um Ihre Liste zu sehen. Klicken Sie auf **Neu**, um Ihre erste Position zu erstellen.

Der Arbeitsbereich öffnet sich im Erstellungsmodus, mit geöffnetem Bereich **Eigenschaften** rechts. Geben Sie den Namen der Investition oben im Titel ein, füllen Sie die Eigenschaften aus und klicken Sie dann auf **Erstellen**.

**Pflichtfelder**:

- **Titel**: Was Sie investieren (z. B. „Neue Server-Infrastruktur", „ERP-Softwarelizenz"). Das ist die Beschreibung der Position, die in der Spalte **Beschreibung** der Liste erscheint
- **Zahlendes Unternehmen**: Welches Unternehmen die Investition tätigt (erforderlich für die Buchhaltung)
- **Konto**: Das Sachkonto für diese Investitionsausgabe. Es erscheinen nur Konten aus dem Kontenplan des zahlenden Unternehmens
- **Währung**: ISO-Code (z. B. USD, EUR). Standardmäßig Ihre Arbeitsbereich-CAPEX-Währung; kann pro Position überschrieben werden
- **Anlagentyp**: Sachanlagen-Klassifizierung -- Hardware oder Software
- **Investitionsart**: Zweck der Investition (siehe Optionen unten)
- **Priorität**: Geschäftliche Prioritätsstufe (siehe Optionen unten)
- **Beginn der Gültigkeit**: Wann diese Investition beginnt (TT/MM/JJJJ)

**Optional aber nützlich**:

- **Lieferant**: Der Anbieter oder Lieferant dieser Investition. Wählen Sie ihn aus Ihren Lieferanten in den Stammdaten
- **Analysekategorie**: Benutzerdefinierte Gruppierung für Berichte
- **Ende der Gültigkeit**: Das Datum, an dem diese Investition endet, zum Beispiel am Ende der Nutzungsdauer des Assets oder beim Projektabschluss. Lassen Sie es leer, wenn es kein Ende gibt. Danach ist die Position deaktiviert und spätere Jahre zählen in den Budgetansichten nicht mehr
- **IT-Verantwortlicher** / **Fachverantwortlicher**: Wer verantwortlich ist
- **Beschreibung** (Tab Übersicht): Freitext-Details zur Investition

Einmal gesetzt, können **Zahlendes Unternehmen** und **Konto** geändert, aber nicht geleert werden. **Lieferant** können Sie jederzeit leeren. Positionen aus einem CSV-Import haben kein Konto (die CAPEX-Datei hat keine Kontospalte): Legen Sie es im Bereich **Eigenschaften** fest.

Sobald die Position erstellt ist, schaltet der Arbeitsbereich alle vier Tabs frei: **Übersicht**, **Budget**, **Zuordnungen** und **Verknüpfungen**.

**Tipp**: Sie können Positionen schnell erstellen und Budgets und Zuordnungen später ergänzen. Beginnen Sie mit dem Wesentlichen und verfeinern Sie iterativ.

---

## Investitionsarten

CAPEX-Positionen müssen nach Investitionsart klassifiziert werden. Dies hilft bei der Analyse von Investitionsmustern:

- **Ersatz**: Ersetzen bestehender Vermögenswerte, die veraltet sind oder das Lebensende erreicht haben
- **Kapazität**: Kapazitätserweiterung zur Unterstützung von Geschäftswachstum oder erhöhter Nachfrage
- **Produktivität**: Verbesserung der Effizienz oder Senkung der Betriebskosten
- **Sicherheit**: Stärkung der Sicherheitsposition, Compliance oder Risikominderung
- **Konformität**: Erfüllung regulatorischer oder Compliance-Anforderungen
- **Geschäftswachstum**: Ermöglichung neuer Produkte, Märkte oder Geschäftsfähigkeiten
- **Sonstige**: Investitionen, die nicht in die obigen Kategorien passen

**Prioritätsstufen**:

- **Obligatorisch**: Muss umgesetzt werden (regulatorisch, kritische Infrastruktur, Sicherheit)
- **Hoch**: Starker Business Case, hoher ROI oder strategische Bedeutung
- **Mittel**: Wertvoll, kann aber bei Bedarf aufgeschoben werden
- **Niedrig**: Nice-to-have, kann verschoben werden

---

## Mit der CAPEX-Liste arbeiten

Die CAPEX-Liste (unter **Budgetverwaltung > CAPEX**) ist Ihre Hauptansicht zum Durchsuchen, Filtern und Navigieren von Investitionspositionen.

### Standardspalten

| Spalte | Was sie zeigt |
|--------|---------------|
| **Ref** | Positionsreferenz, zum Beispiel CPX-12 |
| **Beschreibung** | Name der Investition |
| **Lieferant** | Der Name des Lieferanten |
| **Zahlendes Unternehmen** | Welches Unternehmen diese Position bezahlt |
| **Vertrag** | Der Name des zuletzt verknüpften Vertrags |
| **Konto** | Nummer und Name des Sachkontos |
| **Anlagentyp** | Hardware oder Software |
| **Investitionsart** | Zweck der Investition |
| **Priorität** | Geschäftliche Prioritätsstufe |
| **Zuordnung** | Zuordnungsmethoden-Bezeichnung des aktuellen Jahres |
| **Budget J** | Geplantes Investitionsbudget des aktuellen Jahres (Berichtswährung) |
| **Erwarteter Endwert J** | Erwarteter Endwert des aktuellen Jahres (Berichtswährung) |
| **Aufgabe** | Titel der neuesten mit dieser Position verknüpften Aufgabe |

### Zusätzliche Spalten

Diese Spalten sind standardmäßig ausgeblendet. Zeigen Sie sie über die Spaltenauswahl an (Hamburger-Menü im Grid-Header):

| Spalte | Was sie zeigt |
|--------|---------------|
| **Betragsspalten** | Jede Budgetspalte (Budget, Revision, Prognose, Ist-Werte und Erwarteter Endwert) für J-1, J, J+1 und J+2. Die Überschrift nennt die Spalte, das Jahr relativ zu heute und das Kalenderjahr, zum Beispiel **Revision J+1 (2027)**. Die Beträge sind in der Berichtswährung |
| **Währung** | Währungscode der Position |
| **Gültig ab** | Startdatum |
| **Ende der Gültigkeit** | Datum, an dem die Position endet (leer bedeutet kein Ende) |
| **IT-Verantwortlicher** / **Fachbereichsverantwortlicher** | Zuständige Benutzer |
| **Analytik** | Name der Analysekategorie |
| **Projekt** | Namen der im Tab Verknüpfungen verknüpften Projekte |
| **Notizen** | Freitext-Notizen |
| **Aktiviert** | Status (aktiviert oder deaktiviert) |
| **Erstellt** / **Aktualisiert** | Zeitstempel |

### Schnellsuche

Das Suchfeld oben durchsucht Referenz, Beschreibung, Lieferant, zahlendes Unternehmen, Konto, Vertrag, Projektnamen, Zuordnung, Verantwortliche, Analysekategorie, Anlagentyp, Investitionsart, Priorität, Notizen, Währung und Status. Ergebnisse aktualisieren sich in Echtzeit während der Eingabe.

### Spaltenfilter

Jede filterbare Spaltenüberschrift hat ein Filtersymbol. **Lieferant**, **Zahlendes Unternehmen**, **Konto**, **Anlagentyp**, **Investitionsart**, **Priorität**, **Zuordnung**, **Währung**, **IT-Verantwortlicher**, **Fachbereichsverantwortlicher**, **Analytik** und **Aktiviert** verwenden Kontrollkästchen-Set-Filter mit **Alle**, **Keine** und einer Löschen-Schaltfläche. Der Filter **Aktiviert** bietet **Aktiviert** und **Deaktiviert** und grenzt die Liste ein, wenn **Anzeigen** auf **Alle** steht. Mehrere Filter werden mit UND-Logik kombiniert.

Jede Betragsspalte hat einen Zahlenfilter. Eine Zahl im Feld unter der Überschrift behält die Positionen mit mindestens diesem Betrag. Öffnen Sie das Filtermenü für die anderen Bedingungen: größer als, kleiner als, gleich, ungleich oder zwischen zwei Beträgen.

**Gültig ab**, **Ende der Gültigkeit**, **Erstellt** und **Aktualisiert** haben Datumsfilter. Wählen Sie ein Datum im Feld unter der Überschrift, um die Positionen an diesem Datum zu behalten, oder öffnen Sie das Filtermenü für vor, nach, zwischen, leer oder nicht leer.

Textspalten verwenden Textfilter. Geben Sie bei **Ref** die Nummer oder die vollständige Referenz ein, zum Beispiel `12` oder `CPX-12`.

### Sortierung

Klicken Sie auf eine Spaltenüberschrift, um aufsteigend oder absteigend zu sortieren. Jede Spalte ist sortierbar, auch jede Betragsspalte. Standardmäßig wird nach **Budget J** sortiert, der höchste Betrag zuerst. Die Liste merkt sich Ihre letzte Sortierung bei der Rückkehr.

### Summenzeile

Die angeheftete Zeile unten zeigt die Summe jeder Betragsspalte. Summen berücksichtigen Ihre aktuellen Filter und Suche. Alle Beträge werden in Ihre Berichtswährung umgerechnet, die im Seitentitel angezeigt wird.

### Deep Linking

Klicken Sie auf eine beliebige Zelle in einer Zeile, um den Arbeitsbereich auf dem für diese Spalte relevantesten Tab zu öffnen:

- **Beschreibung**, **Lieferant**, **Zahlendes Unternehmen**, **Anlagentyp**, **Investitionsart**, **Priorität** und die anderen allgemeinen Spalten: Öffnet die **Übersicht**
- **Betragsspalten** (Budget J, Erwarteter Endwert J, Revision J+1 usw.): Öffnet den **Budget**-Tab für das Jahr der Spalte
- **Zuordnung**: Öffnet den **Zuordnungen**-Tab für das aktuelle Jahr
- **Aufgabe**: Öffnet den Tab **Übersicht**, in dem sich der Aufgabenbereich befindet
- **Vertrag**: Öffnet direkt den verknüpften Vertrag

### Statusfilter

Verwenden Sie den Umschalter **Anzeigen: Aktiviert / Deaktiviert / Alle** über dem Grid, um den Lebenszyklusbereich zu steuern (Standard ist **Aktiviert**). Wählen Sie **Deaktiviert**, um archivierte Investitionen zu überprüfen, oder **Alle**, um beide Zustände einzuschließen. Summen aktualisieren sich sofort.

### Suchkontext-Erhaltung

Ihr Listenkontext -- Sortierreihenfolge, Suchtext und aktive Filter -- wird beibehalten, wenn Sie eine Position öffnen, und wiederhergestellt, wenn Sie zur Liste zurückkehren. Sie können also mehrere Positionen nacheinander aufrufen, ohne Ihren Platz zu verlieren.

### Zurück/Weiter-Navigation

Wenn Sie eine Position öffnen, zeigt der Arbeitsbereich die Schaltflächen **Zurück** und **Weiter**. Diese navigieren durch die Liste in der aktuellen Sortierreihenfolge unter Berücksichtigung von Filtern und Suche und speichern zuerst Ihre ausstehenden Änderungen. Der Zähler (z. B. „Position 3 von 47") zeigt Ihre Position in der gefilterten Liste.

**Tipp**: Verwenden Sie Spaltenfilter und Schnellsuche, um fokussierte Ansichten zu erstellen (z. B. „Alle Hardware-Investitionen mit hoher Priorität"), und navigieren Sie dann mit **Zurück**/**Weiter** von Position zu Position, um Budgets zu überprüfen.

---

## Der CAPEX-Arbeitsbereich

Klicken Sie auf eine beliebige Zeile der Liste, um den Arbeitsbereich zu öffnen. Er besteht aus vier Teilen:

- **Kopfzeile**: die Referenz der Position (z. B. `CPX-7`) mit einer Kopierschaltfläche, der Name der Investition (anklicken, um die Position umzubenennen), **Zurück** / **Weiter**, **Link senden** und die Schaltfläche zum Schließen
- **Metadatenleiste** unter dem Titel: **Status**, **Priorität**, **IT-Verantwortlicher** und **Fachverantwortlicher**, direkt bearbeitbar
- **Vier Tabs**: **Übersicht**, **Budget**, **Zuordnungen** und **Verknüpfungen** (der Tab Verknüpfungen zeigt die Anzahl der Verknüpfungen der Position)
- **Bereich Eigenschaften** rechts: die Hauptfelder der Position. Öffnen oder schließen Sie ihn mit der Eigenschaften-Schaltfläche; der Arbeitsbereich merkt sich Ihre Wahl

**Automatisches Speichern**:

- Jede Änderung wird automatisch gespeichert. In der Kopfzeile erscheint der Hinweis **Wird gespeichert...** / **Gespeichert**
- Beim Wechsel des Tabs, beim Wechsel zur vorherigen oder nächsten Position oder beim Schließen des Arbeitsbereichs werden ausstehende Änderungen zuerst gespeichert. Schlägt ein Speichervorgang fehl, bleiben Sie an Ort und Stelle und eine Meldung nennt den Grund, sodass keine Änderung unbemerkt verloren geht
- **Strg+S** (**Cmd+S** auf dem Mac) speichert sofort

### Übersicht

Der Tab Übersicht enthält die Details der Investition und ihre Aufgaben.

**Was Sie bearbeiten können**:

- **Beschreibung**: Freitext-Details zur Investition (im CSV als `notes` exportiert). Der Name der Investition selbst ist der Titel oben

**Aufgabenbereich**:

- Listet alle mit dieser CAPEX-Position verknüpften Aufgaben mit den Spalten **Titel**, **Status**, **Priorität**, **Fälligkeitsdatum** und **Aktionen**. Der Titel des Bereichs zeigt die Anzahl der Aufgaben
- Filter **Status**: Alle (Standard), Aktiv (nicht erledigt) oder ein bestimmter Status. Die Zurücksetzen-Schaltfläche löscht ihn
- Klicken Sie auf **Aufgabe hinzufügen**, um eine neue, bereits mit dieser Position verknüpfte Aufgabe zu öffnen. Titel, Beschreibung, Priorität, Zuständigen und Fälligkeitsdatum füllen Sie im Aufgaben-Arbeitsbereich aus
- Mit dem Öffnen-Symbol gehen Sie zu einer Aufgabe, mit dem Löschsymbol löschen Sie sie (nach Bestätigung)
- Aufgaben haben eigene Berechtigungen (`tasks:member` zum Erstellen und Bearbeiten). CAPEX-Manager-Zugriff allein berechtigt nicht zum Bearbeiten von Aufgaben; wenden Sie sich an Ihren Administrator, wenn Sie keine Aufgaben erstellen können
- Aufgaben können auch unter **Portfolio > Aufgaben** angezeigt und verwaltet werden, wo alle Aufgaben Ihrer Organisation erscheinen
- Der Titel der neuesten Aufgabe erscheint auch in der Spalte **Aufgabe** der Liste (standardmäßig ausgeblendet)

**Bereich Eigenschaften**:

- **Lieferant**, **Zahlendes Unternehmen**, **Konto** (gefiltert nach dem Kontenplan des zahlenden Unternehmens), **Währung** (nur die in Ihrem Arbeitsbereich erlaubten Währungen), **Anlagentyp**, **Investitionsart**, **Analysekategorie** und **Beginn der Gültigkeit**
- **Lebenszyklus**: der Schalter **Aktiviert** und das Datum **Ende der Gültigkeit**. Siehe [Status und Lebenszyklus](#status-und-lebenszyklus)
- Die Daten **Erstellt** und **Aktualisiert** (schreibgeschützt)
- Die **Priorität** stellen Sie beim Erstellen im Bereich Eigenschaften ein, danach in der Metadatenleiste

**Tipp**: Beim Erstellen einer Position bedeutet die Warnung „veraltetes Konto", dass das ausgewählte Konto nicht zum Kontenplan des zahlenden Unternehmens gehört. Wählen Sie ein anderes Konto, um die Warnung zu beheben.

---

### Budget

Im Budget-Tab geben Sie Finanzdaten pro Jahr ein. Er unterstützt mehrere Budgetspalten und zwei Eingabemodi, die als Tabs erscheinen: **Jährlich** (Jahressumme) und **Monatlich** (12-Monats-Aufschlüsselung).

**Jahresauswahl**:

- Verwenden Sie die Jahres-Tabs oben, um zwischen J-2, J-1, J (aktuelles Jahr), J+1 und J+2 zu wechseln
- Jedes Jahr hat seine eigene Version, Zuordnungsmethode und Beträge
- Beim Wechsel des Jahres werden Ihre ausstehenden Änderungen zuerst gespeichert

**Budgetspalten** (alle Jahre):

- **Budget**: Ursprünglich geplantes Investitionsbudget
- **Revision**: Budgetaktualisierung im Jahresverlauf (z. B. nach Umfangsänderungen oder Neuprognosen)
- **Ist-Werte**: Erwartete tatsächliche Ausgaben (Ihre beste Schätzung im Jahresverlauf)
- **Erwarteter Endwert**: Tatsächliche Investitionsausgaben nach dem Jahresabschluss

**Zeitraum einer Spalte**:

- Jede Spalte (Budget, Revision, Prognose, Ist-Werte und Erwarteter Endwert) hat einen Zeitraum innerhalb des Jahres, zum Beispiel April bis Dezember
- Ein Monat zählt, wenn der Zeitraum seinen 15. Tag abdeckt. Ein Zeitraum, der am 10. April beginnt, schließt den April ein; einer, der am 20. April beginnt, startet im Mai
- Eine Spalte ohne Betrag und ohne Zeitraum erhält einen Vorschlag: **Beginn der Gültigkeit** und **Ende der Gültigkeit** der Position, begrenzt auf das Jahr. Eine Investition, die am 1. April beginnt, ergibt den Vorschlag April bis Dezember
- Eine Spalte, die bereits Beträge enthält und keinen Zeitraum hat, gilt als ganzes Jahr, sodass sich vorhandene Daten wie bisher verhalten

**Jährlich oder Monatlich**:

- **Jährlich**: Geben Sie eine Summe pro Spalte ein. Die Summe wird gleichmäßig auf die Monate des Zeitraums der Spalte verteilt, und die Monate außerhalb des Zeitraums werden auf null gesetzt. Der Zeitraum wird unter jeder Summe angezeigt, bevor Sie etwas eingeben, zum Beispiel „9 Monate, April bis Dezember“. Nur die Summe, die Sie bearbeiten, wird gespeichert. Die anderen Spalten behalten ihre Monatsbeträge.
- Klicken Sie auf das Stiftsymbol neben dem Zeitraum unter einer Summe (**Zeitraum ändern**), um das Verteilungsfeld für diese Spalte mit ihrer aktuellen Summe zu öffnen. Lassen die Daten der Position keinen Monat im Jahr übrig, ist die Summe deaktiviert und zeigt „Kein Monat von 2026 liegt innerhalb der Daten der Position.“ Klicken Sie auf das Stiftsymbol daneben (**Zeitraum wählen**), um selbst einen festzulegen.
- **Monatlich**: Geben Sie Beträge pro Monat (Januar bis Dezember) für eine genaue Verfolgung der Projektausgaben ein, plus eine Spalte **Prognose**. Quartalszwischensummen und eine Jahressumme werden angezeigt. Nur die Monate, die Sie ändern, werden gespeichert.
- Wechseln Sie mit den Tabs **Jährlich** und **Monatlich** zwischen den Modi
- Der Moduswechsel ändert Ihre Beträge nicht, nur die Ansicht. Jährlich zeigt die Jahressumme der gespeicherten Monate, Monatlich zeigt die gespeicherten Monate.

**Einfrierverhalten**:

- Wenn das Budget eines Jahres eingefroren ist (über die Budgetadministration), sind die Felder schreibgeschützt und zeigen ein Schloss-Symbol
- Jede Spalte kann unabhängig eingefroren werden (Budget, Revision, Prognose, Ist-Werte, Erwarteter Endwert)
- Sie können eingefrorene Daten weiterhin ansehen; Administratoren können sie über **Budgetverwaltung > Administration > Daten einfrieren / auftauen** wieder freigeben

**Einen Betrag verteilen**:

- Das Verteilungsfeld ist im Tab **Monatlich** immer sichtbar. Im Tab **Jährlich** öffnet es sich über das Stiftsymbol unter einer Summe
- Wählen Sie eine **Spalte** (Budget, Revision, Prognose, Erwarteter Endwert oder Ist-Werte), prüfen Sie den **Betrag**, wählen Sie eine **Verteilung** (**Gleichmäßig** oder **4-4-5**) und legen Sie die Daten **Von** und **Bis** fest. Die Daten gehen vom aktuellen Zeitraum der Spalte aus, die Verteilung von der bisherigen Verteilung der Spalte
- Der Betrag übernimmt die aktuelle Summe der Spalte, in beiden Tabs, und passt sich an, wenn Sie eine andere Spalte wählen. Er bleibt leer, wenn die Spalte keinen Betrag hat
- **Auf alle Spalten anwenden** ist standardmäßig aktiviert: Jede Spalte (Budget, Revision, Prognose, Ist-Werte und Erwarteter Endwert) erhält denselben Zeitraum und dieselbe Verteilung, jeweils mit ihrer eigenen aktuellen Summe. Ausgenommen sind eingefrorene Spalten: Sie ändern sich nie. Fahren Sie mit der Maus über den Schalter, um zu sehen, welche Spalten folgen. Schalten Sie den Schalter aus, um nur die gewählte Spalte zu verteilen
- **Zurücksetzen** füllt das Feld mit der aktuellen Summe der Spalte, **Gleichmäßig** und dem ganzen Jahr. Dabei wird nichts gespeichert: Klicken Sie auf **Anwenden**, um es zu übernehmen. Ist **Auf alle Spalten anwenden** aktiviert, setzen **Zurücksetzen** und dann **Anwenden** jede Spalte auf eine gleichmäßige Verteilung über zwölf Monate zurück
- Summen, die Sie im Tab **Jährlich** eingeben, gelten weiterhin nur für ihre eigene Spalte
- Die Felder **Von** und **Bis** zeigen den Zeitraum. Fallen Monate heraus, nennt das Feld die Monate, die auf null gesetzt werden („Januar bis März werden auf null gesetzt.“). Ein Zeitraum über das ganze Jahr zeigt keine Zeile. Fahren Sie mit der Maus über das Info-Symbol neben dem Titel des Felds, um die Regel zum 15. zu sehen
- Mit **4-4-5** werden die Gewichte der zählenden Monate hochskaliert, sodass der gesamte Betrag auf sie entfällt
- Ein Hinweis erscheint, wenn der Zeitraum über die Daten der Position hinausgeht. Sie können trotzdem anwenden
- **Anwenden** bleibt deaktiviert, solange ein Datum fehlt oder kein Monat zählt. Nichts wird gespeichert, bevor Sie auf **Anwenden** klicken
- Im Tab **Monatlich** füllt Anwenden das Raster. Im Tab **Jährlich** bleiben Sie in der Jahresansicht

**Wie jede Spalte entstanden ist**:

- Eine kurze Kennzeichnung zeigt, woher die Beträge einer Spalte stammen. Im Tab **Monatlich** steht sie unter der Spaltenüberschrift (fahren Sie mit der Maus darüber, um den Zeitraum zu sehen). Im Tab **Jährlich** steht sie neben dem Zeitraum
- **Gleichmäßig verteilt**, **Nach 4-4-5 verteilt** oder **Nach Quartal verteilt**: Die Beträge stammen aus einer Verteilung
- **Kopiert aus Budget 2025 +2 %**: Die Beträge stammen aus **Budgetspalten kopieren** in der Budgetadministration, mit dem Prozentsatz, falls einer angewendet wurde
- **Von Hand geändert**: Ein Monat wurde im Raster oder durch einen Import der Datei der Budgetzeilen geändert
- Eine Spalte ohne Kennzeichnung hat die Daten behalten, die sie vor der Einführung der Zeiträume hatte

**Werkzeuge im Monatsmodus** (nur Modus Monatlich):

- **Spalte leeren**: Das Symbol neben einer Spaltenüberschrift setzt alle Monate dieser Spalte auf null
- Nützlich, um einen Auszahlungsplan von Hand zu erfassen, zum Beispiel den gesamten Betrag in einem einzigen Monat
- Das Leeren auf diese Weise gilt als Änderung von Hand. Um Beträge und Zeitraum einer Spalte für alle Investitionen zu entfernen, verwenden Sie **Budgetspalte zurücksetzen** in der Budgetadministration

**Mehrjahrestrend**:

- Ein Diagramm unter der Tabelle zeigt die Budgetspalten der Position über mehrere Jahre und aktualisiert sich während der Eingabe

**So verwenden Sie ihn**:

1. Wählen Sie das Jahr, für das Sie planen
2. Wählen Sie den Tab **Jährlich** oder **Monatlich**
3. Füllen Sie die relevanten Spalten aus (Budget für die Erstplanung, Ist-Werte für die Nachverfolgung, Erwarteter Endwert für die Zahl zum Jahresende)
4. Ihre Änderungen werden automatisch gespeichert; neben den Jahres-Tabs erscheint der Hinweis **Wird gespeichert...** / **Gespeichert**

**Tipp**: Für die meisten Positionen ist der Modus Jährlich schneller. Verwenden Sie den Modus Monatlich, wenn Sie die zeitliche Verteilung von Projektausgaben oder phasenweise Einführungen verfolgen müssen.

---

### Zuordnungen

Der Tab Zuordnungen verteilt die Investitionsausgabe auf Ihre Unternehmen und Abteilungen. Das speist Leistungsverrechnungsberichte und hilft, Anlagekosten zuzuordnen.

**Jahresauswahl**:

- Funktioniert wie beim Budget: Wechseln Sie mit den Jahres-Tabs zwischen J-2, J-1, J, J+1, J+2
- Jedes Jahr kann eine andere Zuordnungsmethode haben
- Das **Jahresbudget** des ausgewählten Jahres erscheint rechts

**Zuordnungsmethoden**:

1. **Mitarbeiterzahl (Standard)**: Teilt Investitionsausgaben proportional nach der Mitarbeiterzahl jedes Unternehmens für das ausgewählte Jahr. Die Prozentsätze aktualisieren sich automatisch, wenn Sie Unternehmenskennzahlen bearbeiten. Das ist der Standard.

2. **IT-Benutzer**: Teilt Ausgaben proportional nach der Anzahl der IT-Benutzer jedes Unternehmens für das ausgewählte Jahr. Nützlich für IT-Infrastrukturinvestitionen, die mit dem IT-Personal skalieren.

3. **Umsatz**: Teilt Ausgaben proportional nach dem Umsatz jedes Unternehmens für das ausgewählte Jahr. Nützlich für unternehmensweite Plattformen oder Infrastruktur.

4. **Manuell nach Unternehmen**: Sie wählen aus, welche Unternehmen diese Investition erhalten. Wählen Sie unter **Zuordnen nach** einen Treiber (Mitarbeiterzahl, IT-Benutzer oder Umsatz), um die Prozentsätze unter den ausgewählten Unternehmen zu berechnen. Nur die ausgewählten Unternehmen werden bei der Aufteilung berücksichtigt.

5. **Manuell nach Abteilung**: Sie wählen bestimmte Unternehmen/Abteilungs-Paare aus. Die Prozentsätze werden aus der Mitarbeiterzahl jeder Abteilung berechnet. Nützlich, wenn eine Investition nur bestimmten Abteilungen zugutekommt (z. B. Fertigungsanlagen).

6. **Manuelle Prozentsätze**: Sie wählen die Unternehmen und geben jeden Prozentsatz selbst ein. Die Summe muss 100 % ergeben.

**Standard- und fixierte Methoden**:

- Der **Standard**-Eintrag -- angezeigt als *Mitarbeiterzahl (Standard)*, bis Ihre Organisation eine andere Methode konfiguriert -- folgt der Einstellung unter **Budgetverwaltung > Administration > Standard-Zuordnungsmethode**. Jede Investition, die auf Standard bleibt, wird neu berechnet, wenn ein Administrator diese Einstellung ändert.
- Diese Einstellung kann den Standard auch auf eine **Auswahl von Unternehmen** beschränken (zum Beispiel das Unternehmen, das das IT-Budget trägt): Der Treiber gilt dann nur für diese Unternehmen, und die Option lautet *Standard (n Unternehmen)*.
- **Mitarbeiterzahl**, **IT-Benutzer** und **Umsatz** fixieren diese Methode an der Investition: Eine fixierte Methode funktioniert weiterhin, auch wenn sich der Standard der Organisation später ändert.
- Investitionen mit einer manuellen Zuordnung sind vom Standard nie betroffen.

**Wie Prozentsätze funktionieren**:

- Bei **automatischen Methoden** (Mitarbeiterzahl, IT-Benutzer, Umsatz): Die Prozentsätze werden aus den aktuellen Kennzahlen Ihrer aktiven Unternehmen berechnet. Sie bearbeiten sie nicht direkt.
- Bei **Manuell nach Unternehmen** und **Manuell nach Abteilung**: Sie wählen die Unternehmen oder Abteilungen, und das System berechnet die Prozentsätze aus dem gewählten Treiber und den aktuellen Kennzahlen.
- Bei **Manuelle Prozentsätze**: Die Eingabe eines Prozentsatzes fixiert diese Zeile, und die übrigen Zeilen teilen sich den Rest. **Gleichmäßig aufteilen** gibt jeder Zeile denselben Anteil; **Manuelle Fixierungen löschen** hebt die Fixierungen auf.
- Die Prozentsätze spiegeln Live-Daten wider. Wenn Sie die Mitarbeiterzahl eines Unternehmens aktualisieren, werden die Zuordnungen neu berechnet.

**Zuordnungen ansehen**:

- Die Tabelle zeigt das Unternehmen (oder Unternehmen / Abteilung), den Treiberwert, den Prozentsatz und den Betrag, mit einer Summenzeile
- Der Gesamtprozentsatz sollte 100 % ergeben; bei Manuelle Prozentsätze erscheint eine Warnung, bis das der Fall ist

**So verwenden Sie ihn**:

1. Wählen Sie das Jahr
2. Wählen Sie unter **Methode** eine Zuordnungsmethode
3. Bei einer manuellen Methode fügen Sie mit **Zeile hinzufügen** Unternehmen (oder Unternehmen/Abteilungs-Paare) hinzu und entfernen mit dem Entfernen-Symbol diejenigen, die von dieser Investition nicht profitieren
4. Änderungen werden automatisch gespeichert

**Häufige Probleme**:

- **Fehlende Kennzahlen**: Für ein oder mehrere Unternehmen fehlen Mitarbeiterzahl, IT-Benutzer oder Umsatz für das ausgewählte Jahr, oder der Wert ist null. Tragen Sie die Kennzahlen unter **Stammdaten > Unternehmen** (Details-Tab) ein.
- **„Manuelle Prozentsätze müssen in Summe 100 % ergeben."**: Passen Sie die Zeilen an oder klicken Sie auf **Gleichmäßig aufteilen**.

**Tipp**: Verwenden Sie für die meisten Positionen Mitarbeiterzahl (am einfachsten, aktualisiert sich automatisch). Reservieren Sie Manuell nach Unternehmen für Investitionen, die nur bestimmten Einheiten zugutekommen (z. B. ein regionales Rechenzentrum). Verwenden Sie Manuell nach Abteilung für sehr gezielte Investitionen.

---

### Verknüpfungen

Der Tab Verknüpfungen verbindet diese CAPEX-Position mit zugehörigen Objekten: Projekte, Anwendungen, Verträge, Kontakte, Relevante Websites und Anhänge. Alles in diesem Tab wird automatisch gespeichert.

**Projekte**:

- Verknüpfen Sie über die Autovervollständigung ein oder mehrere Projekte
- Das hilft, Investitionsausgaben in Berichten nach Projekt zu gruppieren, und ermöglicht die Projektbuchhaltung
- Die Projektnamen erscheinen in der Spalte **Projekt** der CAPEX-Liste, und die Schnellsuche findet sie
- Entfernen Sie ein Projekt mit dem X auf seinem Chip

**Anwendungen**:

- Verknüpfen Sie über die Autovervollständigung eine oder mehrere Anwendungen oder Dienste aus Ihrem IT-Katalog
- So verfolgen Sie, welche CAPEX-Positionen welche Anwendungen oder Dienste finanzieren
- Entfernen Sie eine Anwendung mit dem X auf ihrem Chip

**Verträge**:

- Verknüpfen Sie über die Autovervollständigung einen oder mehrere Verträge
- Verknüpfte Verträge erscheinen mit ihrem Namen in der Spalte **Vertrag** der CAPEX-Liste zur schnellen Orientierung
- Ein Vertrag kann auch mit mehreren CAPEX-Positionen verknüpft sein (n:m-Beziehung)
- Entfernen Sie einen Vertrag mit dem X auf seinem Chip

**Kontakte**:

- Verknüpfen Sie Kontakte mit dieser CAPEX-Position: Wählen Sie einen Kontakt und dann seine Rolle (**Vertrieb**, **Technik**, **Support** oder **Sonstige**). Die Wahl der Rolle fügt den Kontakt hinzu
- Die Tabelle zeigt Rolle, Vorname, Nachname, Position, E-Mail und Mobilnummer. Fahren Sie mit der Maus über die Rolle, um zu sehen, ob der Kontakt vom Lieferanten stammt oder manuell hinzugefügt wurde
- Entfernen Sie einen Kontakt mit dem Entfernen-Symbol

**Relevante Websites**:

- Klicken Sie auf **URL hinzufügen**, um einen Link hinzuzufügen (z. B. Produktseiten des Anbieters, technische Dokumentation, interne Wikis). Jeder Link hat einen **Namen** und eine **URL**
- Klicken Sie auf die Zeile eines Links, um ihn zu bearbeiten, oder entfernen Sie ihn mit dem Löschsymbol

**Anhänge**:

- Laden Sie Dateien zu dieser Position hoch (z. B. Angebote, Lieferantenvorschläge, technische Spezifikationen, Genehmigungsvermerke)
- Ziehen Sie Dateien in den Anhangsbereich oder klicken Sie auf **Dateien auswählen**
- Klicken Sie auf den Chip einer Datei, um sie herunterzuladen
- Löschen Sie einen Anhang mit dem Löschsymbol auf seinem Chip (nach Bestätigung; erfordert die Berechtigung `capex:manager`)

**Warum verknüpfen?**:

- **Projekte**: Investitionsausgaben nach Projekt für Projektbuchhaltung und Berichte zusammenfassen
- **Anwendungen**: Sehen, welche Anwendungen oder Dienste eine Investition finanziert
- **Verträge**: Nachverfolgen, welche Investitionen durch Kauf- oder Serviceverträge abgedeckt sind
- **Kontakte**: Kontaktdaten von Lieferanten und Beteiligten mit der Investition verbunden halten
- **Relevante Websites und Anhänge**: Alle Unterlagen und Referenzen zur Investition an einem Ort bündeln

**Tipp**: Laden Sie Lieferantenangebote, Genehmigungsvermerke und technische Spezifikationen als Anhänge hoch. Verknüpfen Sie Verträge, um Beschaffungen nachzuverfolgen. Nutzen Sie Kontakte, um die Ansprechpartner des Lieferanten jeder Investition zuzuordnen.

---

## CSV-Import/Export

Sie können CAPEX-Positionen per CSV massenimportieren, um die Ersteinrichtung zu beschleunigen oder mit externen Systemen zu synchronisieren.

**Export**:

1. Klicken Sie in der CAPEX-Liste auf **CSV exportieren**
2. Wählen Sie:
   - **Vorlage**: Nur Kopfzeilen (verwenden Sie dies, um eine leere CSV zum Ausfüllen zu erstellen)
   - **Daten**: Alle CAPEX-Positionen, auch beendete, mit Budgets für J-1 bis J+2

**CSV-Struktur**:

- Trennzeichen: Semikolon `;` (kein Komma)
- Kodierung: UTF-8 (in Excel als „CSV UTF-8" speichern)
- Kopfzeilen: `item_number;description;ppe_type;investment_type;priority;currency;effective_start;status;disabled_at;notes;company_name;owner_it_email;owner_business_email;analytics_category;y_minus1_budget;y_minus1_landing;y_budget;y_follow_up;y_landing;y_revision;y_plus1_budget;y_plus1_revision;y_plus2_budget`
- `disabled_at` ist das Ende der Gültigkeit: das Datum, an dem die Position endet. Verwenden Sie ein Datum (`2026-12-31`) oder ein vollständiges Datum mit Uhrzeit. Lassen Sie das Feld leer, wenn es kein Ende gibt
- Ältere Dateien mit einer Spalte `effective_end` werden weiterhin importiert: Das Datum dieser Spalte füllt das Ende der Gültigkeit, wenn `disabled_at` leer ist

**Import**:

1. Klicken Sie in der CAPEX-Liste auf **CSV importieren**
2. Laden Sie Ihre CSV-Datei hoch (Drag-and-Drop oder Dateiauswahl)
3. Klicken Sie auf **Vorprüfung** zur Validierung:
   - Kopfzeilen stimmen exakt überein
   - Unternehmen und Benutzer existieren in Ihrem Arbeitsbereich
   - Pflichtfelder (description, ppe_type, investment_type, priority) sind vorhanden. Eine neue Position braucht außerdem company_name und currency
   - Währungen sind in den Währungseinstellungen Ihres Arbeitsbereichs erlaubt
   - Verantwortliche sind aktive Benutzer
   - Eine `item_number` entspricht einer bestehenden CAPEX-Position
   - Datumsangaben sind gültig, und keine zwei Zeilen beschreiben dieselbe Position
4. Überprüfen Sie den Vorprüfungsbericht (zeigt Zählungen und bis zu 5 Beispielfehler). Eine Datei mit einem Fehler lädt nichts: Korrigieren Sie die Zeilen und führen Sie die Vorprüfung erneut aus
5. Wenn OK, klicken Sie auf **Laden** zum Importieren

**Wichtige Hinweise**:

- **Abgleich**: Eine Zeile mit einer `item_number` aktualisiert diese CAPEX-Position; die Vorprüfung meldet eine Nummer, die zu keiner Position passt. Eine Zeile ohne Nummer wird über `description` zugeordnet: Bei einem Treffer wird die Position aktualisiert, sonst legt die Zeile eine neue Position an. Zwei Zeilen mit derselben `item_number` oder mit derselben `description` ohne Nummer sind ein Fehler („Same line as row N"): Behalten Sie eine Zeile pro Position.
- **Neue Positionen**: `company_name` und `currency` sind für eine neue Position Pflicht. Die Währung muss in den Währungseinstellungen Ihres Arbeitsbereichs erlaubt sein. Bei einer bestehenden Position behält eine leere Währungszelle deren Währung.
- **Datumsangaben**: `effective_start` (und `effective_end` in älteren Dateien) muss ein echter Kalendertag im Format `YYYY-MM-DD` sein, zum Beispiel `2026-01-01`. Andere Formate wie `01/03/2026` sind Fehler. Ein leeres `effective_start` behält das gespeicherte Datum einer bestehenden Position; eine neue Position beginnt am 1. Januar des laufenden Jahres.
- **Referenzen**: `company_name` muss einem Unternehmen namentlich entsprechen (Groß-/Kleinschreibung wird ignoriert). `owner_it_email` und `owner_business_email` müssen aktiven Benutzern per E-Mail entsprechen: Ein eingeladener Benutzer oder ein Kontakt ohne Konto wird abgelehnt.
- **Anlagentyp**: Muss `hardware` oder `software` sein (Groß-/Kleinschreibung wird ignoriert).
- **Investitionsart**: Muss eine von: `replacement`, `capacity`, `productivity`, `security`, `conformity`, `business_growth`, `other` sein (Groß-/Kleinschreibung wird ignoriert).
- **Priorität**: Muss `mandatory`, `high`, `medium` oder `low` sein (Groß-/Kleinschreibung wird ignoriert).
- **Budgets**: Budgetspalten füllen J-1, J und J+1 Versionen. Beträge werden gleichmäßig auf 12 Monate verteilt (Modus Jährlich), und der Zeitraum der Spalte wird das ganze Jahr. Eine leere Zelle lässt die Spalte unverändert; `0` leert sie.
- **Monatsbeträge**: Um Beträge Monat für Monat zu laden oder zu prüfen, mit dem Zeitraum jeder Spalte, verwenden Sie die **Datei der Budgetzeilen** in der Budgetadministration.

**Häufige Fehler**:

- **„Unternehmen nicht gefunden"**: Erstellen Sie das Unternehmen zuerst unter **Stammdaten > Unternehmen**, dann importieren Sie erneut.
- **„Ungültiger ppe_type"**: Verwenden Sie exakt `hardware` oder `software`.
- **„Ungültiger investment_type"**: Verwenden Sie eine der 7 gültigen Investitionsarten (siehe Liste oben).
- **„Ungültige Priorität"**: Verwenden Sie `mandatory`, `high`, `medium` oder `low`.
- **„Ungültige Währung"**: Verwenden Sie 3-stellige ISO-Codes (USD, EUR, GBP), die in Ihren Arbeitsbereich-Währungseinstellungen zugelassen sind.
- **„Kopfzeilen stimmen nicht überein"**: Laden Sie eine frische Vorlage herunter; Kopfzeilen müssen exakt übereinstimmen (einschließlich Reihenfolge).
- **„effective_start must be a valid date"**: Verwenden Sie das Format `YYYY-MM-DD`.
- **„Same line as row N"**: Zwei Zeilen beschreiben dieselbe Position. Führen Sie sie zu einer Zeile zusammen und importieren Sie dann erneut.

**Tipp**: Beginnen Sie mit dem Vorlagenexport, füllen Sie einige Zeilen aus und führen Sie eine Vorprüfung durch, um Probleme frühzeitig zu erkennen. Beheben Sie Fehler in der CSV und laden Sie sie erneut hoch, bis die Vorprüfung besteht, dann laden Sie.

---

## Status und Lebenszyklus

Jede CAPEX-Position hat einen **Status** (Aktiviert oder Deaktiviert) und ein optionales **Ende der Gültigkeit**, das steuert, wann sie in Berichten und Auswahllisten erscheint. Es ist das einzige Enddatum einer Position.

**Funktionsweise**:

- **Aktiviert**: Die Position ist aktiv und erscheint überall (Listen, Berichte, Zuordnungen)
- **Ende der Gültigkeit**: Das Datum, an dem die Position endet. Lassen Sie es leer, wenn es kein Ende gibt
- Nach dem Ende der Gültigkeit:
  - Die Position erscheint nicht mehr in Auswahllisten für neue Verträge oder Zuordnungen
  - Sie wird aus Berichten für Jahre ausgeschlossen, die strikt nach dem Ende der Gültigkeit liegen
  - Historische Daten bleiben erhalten; die Position erscheint weiterhin in Berichten, die Jahre abdecken, in denen sie aktiv war

**Status setzen**:

- Beim Anlegen der Position können Sie ihr **Ende der Gültigkeit** im Panel **Eigenschaften** festlegen
- Später ändern Sie den **Status** in der Metadatenleiste oder verwenden das Feld **Lebenszyklus** im Bereich **Eigenschaften** (Schalter **Aktiviert** und **Ende der Gültigkeit**). Wird eine Position ohne Datum deaktiviert, wird ihr Ende der Gültigkeit auf heute gesetzt
- Sie können ein zukünftiges Ende der Gültigkeit planen (nützlich für geplante Anlagenveräußerungen oder End-of-Life-Termine)

**Deaktivierte Positionen anzeigen**:

- Standardmäßig zeigt die CAPEX-Liste nur **aktivierte** Positionen
- Verwenden Sie den Umschalter **Anzeigen: Aktiviert / Deaktiviert / Alle**, um den Bereich zu ändern

**Wann deaktivieren vs. löschen**:

- **Bevorzugen Sie das Deaktivieren**: Bewahrt die Historie, stellt konsistente Berichte sicher und unterstützt Audit-Trails
- **Nur löschen, wenn**: Die Position versehentlich erstellt wurde
- Beim Löschen einer Position werden auch ihre Budgets, Zuordnungen, Aufgaben, relevanten Websites, Anhänge (mit ihren Dateien) und ihre Verknüpfungen zu Verträgen entfernt. Wurde eine ihrer Aufgaben in eine Anfrage umgewandelt, bleibt die Anfrage erhalten: Sie hat eine eigene Kopie von Titel, Beschreibung und Anhängen, und nur ihre Verknüpfung zur Aufgabe entfällt

**Tipp**: Verwenden Sie das Ende der Gültigkeit, um vollständig abgeschriebene, veräußerte Vermögenswerte oder abgeschlossene Projekte zu kennzeichnen. Löschen Sie nur bei echten Fehlern.

---

## Berechtigungen

Der CAPEX-Zugriff wird durch drei Stufen gesteuert:

- `capex:reader` -- CAPEX-Liste anzeigen, Positionen öffnen, Budgets und Zuordnungen einsehen (schreibgeschützt)
- `capex:manager` -- CAPEX-Positionen erstellen und bearbeiten, Budgets und Zuordnungen aktualisieren, Anhänge hochladen, Verknüpfungen und Kontakte verwalten
- `capex:admin` -- Alle Manager-Rechte plus CSV-Import, Budget-Operationen (Einfrieren, Kopieren, Zurücksetzen) und Massenlöschung

Zusätzlich:

- Aufgaben haben separate Berechtigungen (`tasks:member` zum Erstellen/Bearbeiten von Aufgaben an CAPEX-Positionen)
- Benutzer mit `tasks:reader` können Aufgaben anzeigen, aber nicht erstellen oder bearbeiten

Wenn Sie eine Aktion nicht ausführen können (z. B. die Schaltfläche **CSV importieren** fehlt), prüfen Sie mit Ihrem Arbeitsbereich-Administrator Ihre Rollenberechtigungen.

---

## Tipps

- **Einfach anfangen**: Erstellen Sie Positionen nur mit dem Wesentlichen (Beschreibung, Anlagentyp, Investitionsart, zahlendes Unternehmen, Konto), dann ergänzen Sie Budgets und Zuordnungen bei der Planung.
- **Mitarbeiterzahl-Zuordnung verwenden**: Für die meisten Investitionen reicht Mitarbeiterzahl aus. Reservieren Sie manuelle Zuordnungen für Investitionen, die nur bestimmten Unternehmen oder Abteilungen zugutekommen.
- **Verträge verknüpfen**: Wenn Sie Investitionen über Verträge verwalten, verknüpfen Sie sie im Verknüpfungen-Tab für die Beschaffungsverfolgung.
- **Dokumentation hochladen**: Verwenden Sie die Anhangfunktion, um Lieferantenangebote, Genehmigungsvermerke und technische Spezifikationen neben der Position zu speichern.
- **Genau klassifizieren**: Verwenden Sie Investitionsart und Priorität konsistent, um aussagekräftige Analysen und Priorisierung der Investitionsausgaben zu ermöglichen.
- **Unternehmenskennzahlen aktuell halten**: Zuordnungen hängen von Mitarbeiterzahl, IT-Benutzern und Umsatz der Unternehmen ab. Veraltete Kennzahlen verursachen Zuordnungsfehler.
- **CSV für Masseneinrichtung verwenden**: Wenn Sie von einem anderen System migrieren oder viele Investitionspositionen haben, beginnen Sie mit dem CSV-Import.
- **Deaktivieren statt löschen**: Bewahren Sie die Historie, indem Sie Positionen deaktivieren, wenn Vermögenswerte veräußert oder Projekte abgeschlossen werden.
- **Summenzeile überprüfen**: Bevor Sie Investitionsbudgets finalisieren, prüfen Sie die angeheftete Summenzeile, um sicherzustellen, dass Ihre Investitionsausgaben wie erwartet aufgehen.
- **Deep Linking nutzen**: Klicken Sie direkt auf eine Budget- oder Zuordnungsspalte in der Liste, um direkt zum entsprechenden Tab und Jahr zu springen.
- **Ausgaben zeitlich verfolgen**: Für große Projekte mit phasenweisen Ausgaben verwenden Sie den Modus Monatlich, um Ausgaben gegen Projektmeilensteine zu verfolgen.
- **Nach Jahresende einfrieren**: Verwenden Sie die Budget-Administration, um Vorjahresbudgets einzufrieren, sobald die Ist-Werte finalisiert sind, um versehentliche Bearbeitungen zu verhindern.
