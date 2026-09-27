# Budgetverwaltung: Übersicht

Die Übersicht der Budgetverwaltung zeigt Ihnen auf einen Blick, wo Ihre IT-Ausgaben aktuell stehen: OPEX- und CAPEX-Überblick, anstehende Fristen, Datenqualitätsindikatoren und die Positionen, die Ihre Aufmerksamkeit am meisten verdienen, alles an einem Ort.

## Wo Sie es finden

- Pfad: **Budgetverwaltung > Übersicht** (`/ops`)
- Nach der Anmeldung landen Sie auf Ihrem persönlichen [Dashboard](my-dashboard.md). Diese Übersicht öffnen Sie im Arbeitsbereich **Budgetverwaltung**.

## Layout

Das Dashboard besteht aus Kacheln, die in einem responsiven Raster angeordnet sind: drei Spalten auf einem breiten Bildschirm, zwei auf einem Tablet und eine einzelne Spalte auf dem Mobilgerät. Jede Kachel hat ein Symbol, einen Titel und in der Regel eine **Anzeigen**-Schaltfläche, die Sie direkt zur vollständigen Seite hinter den Daten führt.

## Kacheln

### OPEX-Überblick

Eine kompakte Tabelle, die drei Geschäftsjahre abdeckt: Vorjahr (J-1), aktuelles Jahr (J) und nächstes Jahr (J+1). Bis zu fünf Wertspalten erscheinen: die Budgetspalten, die Ihre Organisation anzeigt, unter ihren Namen (**Budget**, **Revision**, **Ist-Werte** und **Erwarteter Endwert** mit den Standardeinstellungen, dazu **Prognose**, wenn sie angezeigt wird). Eine Spalte erscheint, sobald sie für mindestens eines der drei Jahre einen Betrag enthält. Ausgeblendete Spalten erscheinen nie. Die Kacheln OPEX und CAPEX zeigen dieselben Spalten. Alle Beträge sind auf den nächsten Tausender gerundet und mit dem Suffix „k" angezeigt (z. B. `7 846k`).

Klicken Sie auf **Anzeigen**, um die OPEX-Liste zu öffnen.

### CAPEX-Überblick

Gleiches Layout und gleiche Formatierung wie der OPEX-Überblick, aber mit Daten aus Ihren Investitionsausgaben.

Klicken Sie auf **Anzeigen**, um die CAPEX-Liste zu öffnen.

### Meine Aufgaben

Zeigt die Gesamtzahl der Ihnen zugewiesenen offenen Aufgaben (als „erledigt" markierte Aufgaben sind ausgeschlossen), gefolgt von den fünf Aufgaben mit den nächsten Fälligkeitsterminen. Überfällige Aufgaben sind rot hervorgehoben. Aufgaben ohne Fälligkeitsdatum erscheinen hier nicht.

Klicken Sie auf **Alle anzeigen**, um die Aufgaben-Seite zu öffnen.

### Nächste Verlängerungen

Listet die nächsten fünf Vertragskündigungsfristen auf, die noch in der Zukunft liegen. Vergangene Fristen werden automatisch herausgefiltert, sodass Sie nur sehen, was ansteht.

Klicken Sie auf **Alle anzeigen**, um die Verträge-Seite zu öffnen.

### Datenqualität

Vier Prüfungen, die Ihnen helfen, unvollständige Datensätze auf einen Blick zu erkennen. Die Kachel zeigt eine Spalte mit Zählern pro Positionstyp, den Sie lesen dürfen: **OPEX** und **CAPEX** nebeneinander.

- **Ohne IT-Verantwortlichen**: Positionen ohne IT-Verantwortlichen
- **Ohne Fachbereichsverantwortlichen**: Positionen ohne Fachbereichsverantwortlichen
- **Ohne zahlendes Unternehmen**: Positionen ohne zahlendes Unternehmen
- **Konto nicht im Kontenplan des Unternehmens**: Positionen, deren Konto nicht zum Kontenplan des zahlenden Unternehmens gehört

Ein Zähler wird orange (rot bei der Kontenplan-Prüfung), wenn er über null liegt. Klicken Sie auf einen Zähler, um die Liste dieses Typs zu öffnen.

### Schnellaktionen

Verknüpfungsschaltflächen zum direkten Erstellen einer neuen OPEX- oder CAPEX-Position vom Dashboard aus. Diese Schaltflächen sind nur sichtbar, wenn Ihre Rolle Ihnen mindestens die Berechtigung `opex:manager` oder `capex:manager` gewährt.

Unterhalb der Schaltflächen listet ein Abschnitt **Aktuelle Änderungen** die fünf zuletzt bearbeiteten Positionen auf, OPEX und CAPEX zusammen. Jede Zeile zeigt das Datum der letzten Bearbeitung, den Namen der Position und ihren Typ. Klicken Sie auf eine Zeile, um die Position zu öffnen.

### Top-Positionen (J)

Die fünf größten Positionen für das aktuelle Jahr, nach der Standardspalte sortiert. Der Titel nennt die Spalte, zum Beispiel **Top-Positionen (Budget, J)**. Beträge sind auf Tausender gerundet mit dem Suffix „k".

Wählen Sie mit den Tabs **OPEX** / **CAPEX** im Kopf der Kachel den Positionstyp. Die Kachel merkt sich Ihre Wahl. Klicken Sie auf **Öffnen**, um den vollständigen Bericht **Top-Positionen** für denselben Typ anzuzeigen.

### Stärkste Zuwächse (J vs J-1)

Die fünf Positionen mit dem größten Anstieg in der Standardspalte im Vergleich zum Vorjahr, berechnet über alle Positionen des Typs. Der Titel nennt die Spalte, zum Beispiel **Stärkste Zuwächse (Budget, J vs J-1)**. Positionen, deren Betrag gleich geblieben oder gesunken ist, erscheinen nicht. Beträge sind auf Tausender gerundet mit dem Suffix „k".

Wählen Sie mit den Tabs **OPEX** / **CAPEX** im Kopf der Kachel den Positionstyp. Die Kachel merkt sich Ihre Wahl. Klicken Sie auf **Öffnen**, um den vollständigen Bericht **Top Anstieg / Rückgang** für denselben Typ anzuzeigen.

Ein Typ, den Sie nicht lesen dürfen, ist in den Tabs deaktiviert und hat keine Spalte in **Datenqualität**. Dürfen Sie weder OPEX noch CAPEX lesen, sind diese Kacheln ausgeblendet.

## Tipps

- **Welche Spalte die Kacheln verwenden**: Ein Budgetadministrator wählt die Standardspalte und die Spaltennamen unter [Budgetspalten](budget-operations.md#budgetspalten). Die Top-Kacheln und die Berichte, die sie öffnen, folgen dieser Wahl.
- **Gerundete Zahlen**: Jeder Betrag auf dem Dashboard ist zur kompakten Darstellung auf Tausender gerundet. Öffnen Sie die OPEX- oder CAPEX-Liste oder die Berichte, wenn Sie genaue Zahlen benötigen.
- **Fehlende Schaltflächen**: Wenn Sie die Schaltflächen **Neue OPEX** oder **Neue CAPEX** nicht sehen, enthält Ihre aktuelle Rolle nicht die erforderliche Manager-Berechtigung. Bitten Sie Ihren Administrator, Ihren Zugriff zu prüfen.
- **Leere Kacheln**: Eine Kachel, die „Keine Daten" zeigt, bedeutet einfach, dass noch keine Datensätze dieses Typs vorhanden sind. Sobald Sie oder Ihr Team mit der Dateneingabe beginnen, wird die Kachel automatisch befüllt.
