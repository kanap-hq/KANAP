# Budgetverwaltung -- Übersicht

Das Dashboard der Budgetverwaltung ist die erste Seite, die Sie nach der Anmeldung sehen. Es bietet Ihnen einen Überblick darüber, wo Ihre IT-Ausgaben aktuell stehen -- OPEX- und CAPEX-Überblick, anstehende Fristen, Datenqualitätsindikatoren und die Positionen, die Ihre Aufmerksamkeit am meisten verdienen -- alles an einem Ort.

## Wo Sie es finden

- Pfad: **Budgetverwaltung > Übersicht** (`/ops`)
- Dies ist auch die Standard-Startseite nach der Anmeldung.

## Layout

Das Dashboard besteht aus Kacheln, die in einem responsiven Raster angeordnet sind: drei Spalten auf einem breiten Bildschirm, zwei auf einem Tablet und eine einzelne Spalte auf dem Mobilgerät. Jede Kachel hat ein Symbol, einen Titel und in der Regel eine **Anzeigen**-Schaltfläche, die Sie direkt zur vollständigen Seite hinter den Daten führt.

## Kacheln

### OPEX-Überblick

Eine kompakte Tabelle, die drei Geschäftsjahre abdeckt: Vorjahr (J-1), aktuelles Jahr (J) und nächstes Jahr (J+1). Bis zu fünf Wertspalten erscheinen: **Budget**, **Revision**, **Prognose**, **Ist-Werte** und **Erwarteter Endwert**. Eine Spalte erscheint, sobald sie für mindestens eines der drei Jahre einen Betrag enthält. Die Kacheln OPEX und CAPEX zeigen dieselben Spalten. Alle Beträge sind auf den nächsten Tausender gerundet und mit dem Suffix „k" angezeigt (z. B. `7 846k`).

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

### Datenqualität (OPEX)

Vier Indikator-Chips, die Ihnen helfen, unvollständige OPEX-Datensätze auf einen Blick zu erkennen:

- **Kein IT-Verantwortlicher** -- Positionen ohne zugewiesenen IT-Verantwortlichen
- **Kein Fachverantwortlicher** -- Positionen ohne zugewiesenen Fachbereichsverantwortlichen
- **Kein zahlendes Unternehmen** -- Positionen ohne zugewiesenes zahlendes Unternehmen
- **Kontenplan-Abweichungen** -- Positionen, bei denen das ausgewählte Konto nicht zum Kontenplan des zahlenden Unternehmens gehört

Chips werden orange (oder rot bei Kontenplan-Abweichungen), wenn die Anzahl über null liegt. Klicken Sie auf einen beliebigen Chip, um zur OPEX-Liste zu springen.

### Schnellaktionen

Verknüpfungsschaltflächen zum direkten Erstellen einer neuen OPEX- oder CAPEX-Position vom Dashboard aus. Diese Schaltflächen sind nur sichtbar, wenn Ihre Rolle Ihnen mindestens die Berechtigung `opex:manager` oder `capex:manager` gewährt.

Unterhalb der Schaltflächen listet ein Abschnitt **Letzte OPEX-Aktualisierungen** die fünf zuletzt geänderten OPEX-Positionen mit ihrem Änderungsdatum auf.

### Top OPEX (J)

Die fünf größten OPEX-Positionen für das aktuelle Jahr, nach Budgetbetrag sortiert. Beträge sind auf Tausender gerundet mit dem Suffix „k".

Klicken Sie auf **Öffnen**, um den vollständigen Top-OPEX-Bericht anzuzeigen.

### Stärkste Zuwächse (J vs J-1)

Die fünf OPEX-Positionen mit der größten Budgeterhöhung im Vergleich zum Vorjahr. Beträge sind auf Tausender gerundet mit dem Suffix „k".

Klicken Sie auf **Öffnen**, um den vollständigen OPEX-Delta-Bericht anzuzeigen.

## Tipps

- **Gerundete Zahlen**: Jeder Betrag auf dem Dashboard ist zur kompakten Darstellung auf Tausender gerundet. Öffnen Sie die OPEX- oder CAPEX-Liste -- oder den Berichtsbereich -- wenn Sie genaue Zahlen benötigen.
- **Fehlende Schaltflächen**: Wenn Sie die Schaltflächen **Neue OPEX** oder **Neue CAPEX** nicht sehen, enthält Ihre aktuelle Rolle nicht die erforderliche Manager-Berechtigung. Bitten Sie Ihren Administrator, Ihren Zugriff zu prüfen.
- **Leere Kacheln**: Eine Kachel, die „Keine Daten" zeigt, bedeutet einfach, dass noch keine Datensätze dieses Typs vorhanden sind. Sobald Sie oder Ihr Team mit der Dateneingabe beginnen, wird die Kachel automatisch befüllt.
