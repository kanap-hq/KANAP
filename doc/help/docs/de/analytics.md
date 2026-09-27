# Analysedimensionen

Analysedimensionen bieten Ihnen eine flexible Möglichkeit, Ihr IT-Budget außerhalb Ihrer formalen Buchhaltungsstruktur zu klassifizieren und auszuwerten. Anstatt Unternehmen, Abteilungen oder Konten umzustrukturieren, erstellen Sie leichtgewichtige Kategorien -- „Infrastruktur", „Cloud-Migration", „Lizenzen" -- und taggen Ausgabenpositionen für individuelle Berichte.

## Erste Schritte

Navigieren Sie zu **Stammdaten > Analysedimensionen**, um die Kategorieliste zu öffnen.

**Pflichtfelder**:
- **Name**: Die Bezeichnung, die in Dropdowns und Berichten erscheint. Muss eindeutig sein.

**Optionale Felder**:
- **Beschreibung**: Erklären Sie, wann diese Kategorie verwendet werden soll, damit Teammitglieder sie einheitlich anwenden.

**Berechtigungen**:
- Liste anzeigen: `analytics:reader`
- Kategorien erstellen oder bearbeiten: `analytics:member`

**Tipp**: Beginnen Sie mit 5--10 breiten Kategorien. Einheitliche Benennung (alle Substantive oder alle Gerundien) erleichtert das Scannen von Listen.

## Mit der Liste arbeiten

Die Kategorieliste gibt Ihnen einen schnellen Überblick über jede Analysedimension in Ihrem Mandanten.

**Spalten**:

| Spalte | Was sie zeigt |
|--------|---------------|
| **Name** | Kategoriebezeichnung (anklickbar -- öffnet den Arbeitsbereich) |
| **Beschreibung** | Kurze Erklärung des Kategorie-Zwecks |
| **Status** | Aktiviert oder Deaktiviert |
| **Aktualisiert** | Zeitstempel der letzten Änderung |

**Filtern**:
- Schnellsuche: durchsucht Name und Beschreibung
- Statusfilter: Liste auf aktivierte oder deaktivierte Kategorien eingrenzen

**Aktionen**:
- **Neue Kategorie**: Erstellt eine neue Analysedimension (erfordert `analytics:member`)

## Der Analysedimensionen-Arbeitsbereich

Klicken Sie auf eine beliebige Zeile, um den Arbeitsbereich für diese Kategorie zu öffnen.

### Übersichts-Tab

Dies ist der einzige Tab. Er enthält alle Felder der Kategorie.

**Was Sie bearbeiten können**:
- **Name**: Die Kategoriebezeichnung. Eine Änderung aktualisiert Dropdowns und Berichte überall.
- **Beschreibung**: Freitext-Erklärung der beabsichtigten Verwendung der Kategorie.
- **Lebenszyklus**: der Statusschalter, dessen Beschriftung den aktuellen Zustand zeigt (**Aktiviert** oder **Deaktiviert**), und das Datum **Ende der Gültigkeit**. Siehe [Status und Lebenszyklus](#status-und-lebenszyklus).

**Arbeitsbereich-Navigation**: Verwenden Sie die Schaltflächen **Zurück** und **Weiter**, um zwischen Kategorien zu wechseln, ohne zur Liste zurückzukehren. Der Arbeitsbereich behält Ihren aktuellen Sortier-, Such- und Filterkontext bei. Bei ungespeicherten Änderungen werden Sie vor dem Navigieren aufgefordert.

**Tipp**: Klicken Sie auf das Schließen-Symbol (X) in der oberen rechten Ecke, um mit intakten Filtern zur Liste zurückzukehren.

## Status und Lebenszyklus

Jede Kategorie hat einen Status (**Aktiviert** oder **Deaktiviert**) und ein optionales **Ende der Gültigkeit**. Damit legen Sie eine Kategorie still, ohne sie zu löschen.

- **Ende der Gültigkeit**: das Datum, an dem die Kategorie endet. Lassen Sie es leer, damit die Kategorie unbegrenzt aktiv bleibt. Sie können auch ein zukünftiges Datum planen.
- Wenn Sie die Kategorie ohne Datum auf **Deaktiviert** setzen, wird das Ende der Gültigkeit auf heute gesetzt. Zurück auf **Aktiviert** löscht das Datum.
- Nach dem Ende der Gültigkeit erscheint die Kategorie nicht mehr in Auswahl-Dropdowns für neue Elemente.
- Bestehende Elemente behalten ihre Zuordnung, und historische Berichte bleiben korrekt.
- **Deaktivieren statt löschen**: Auf dieser Seite gibt es keine Löschaktion. Das Deaktivieren bewahrt die Berichtskontinuität und hält die Liste übersichtlich.

## Ausgabenpositionen taggen

Beim Erstellen oder Bearbeiten von OPEX- oder CAPEX-Positionen:

1. Öffnen Sie den **Übersichts**-Tab der Ausgabenposition.
2. Suchen Sie das Feld **Analysekategorie**.
3. Wählen Sie eine Kategorie aus dem Dropdown oder lassen Sie es leer für „Nicht zugewiesen".
4. Speichern Sie das Element.

Sie können die Kategorie jederzeit ändern oder entfernen. Die Kategorie gilt für das gesamte Element über alle Geschäftsjahre hinweg.

## Der Analysebericht

Der Bericht **Analysedimensionen** (unter **Berichte**) zeigt, wie sich das Budget Ihrer OPEX- oder CAPEX-Positionen auf Ihre Kategorien verteilt. Die vollständige Beschreibung finden Sie unter [Berichte](reports.md).

**Berichtsfunktionen**:
- **Positionstyp**: OPEX oder CAPEX
- **Jahresbereich**: Einzeljahr (Kreis- oder Balkendiagramm) oder Mehrjahr (Liniendiagramm)
- **Kennzahl**: Budget, Ist-Werte, Erwarteter Endwert oder Revision
- **Diagrammtyp** (Einzeljahr): Kreisdiagramm oder horizontales Balkendiagramm
- **Kategorieausschluss**: Bestimmte Kategorien herausfiltern, um sich auf eine Teilmenge zu konzentrieren

**Berichtsausgaben**:
- Visuelles Diagramm der Budgetverteilung
- Zusammenfassungstabelle mit Summen nach Kategorie und Jahr
- Export als CSV (Tabelle), PNG (Diagramm) oder PDF (vollständiger Bericht)

## Tipps

- **Einfach halten**: 5--10 breite Kategorien zeigen in der Regel mehr als Dutzende granularer Tags.
- **Mit Beschreibungen dokumentieren**: Eine kurze Beschreibung trägt erheblich zur konsistenten Nutzung in Teams bei.
- **Nicht erzwingen**: „Nicht zugewiesen" ist ein gültiger Zustand. Vermeiden Sie es, vage Auffangkategorien nur zum Füllen der Lücke zu erstellen.
- **Deaktivieren statt löschen**: Das Stilllegen einer Kategorie bewahrt die historische Genauigkeit in Berichten.
- **Berichte zur Verfeinerung nutzen**: Führen Sie den Analysebericht regelmäßig aus -- wenn eine Kategorie zu viel oder zu wenig Ausgaben erfasst, teilen oder zusammenführen.

## Häufig gestellte Fragen

**Kann ich einem Element mehrere Analysedimensionen zuweisen?**
Nein. Jede Ausgabenposition hat null oder eine Kategorie. Für mehrdimensionale Analysen erwägen Sie, Kategorien zu kombinieren oder Abteilungen mit Zuordnungen zu verwenden.

**Beeinflussen Analysedimensionen Zuordnungen oder die Buchhaltung?**
Nein. Sie dienen ausschließlich der Berichterstattung und haben keinen Einfluss auf Kostenzuordnungen oder die formale Buchhaltung.

**Wie viele Kategorien sollte ich erstellen?**
Beginnen Sie mit 5--10. Mehr als 20 deutet in der Regel auf Überoptimierung hin. Sie können später jederzeit aufteilen.

**Was ist der Unterschied zwischen Analysedimensionen und Abteilungen?**
**Abteilungen** sind formale Organisationseinheiten mit präzisen Zuordnungstreibern. **Analysedimensionen** sind informelle, optionale Tags für flexible Berichterstattung ohne Zuordnungsaufwand.

**Warum zeigen einige Elemente „Nicht zugewiesen" an?**
Elemente ohne Analysekategorie erscheinen in Berichten als „Nicht zugewiesen". Das ist zu erwarten -- Kategorien sind vollständig optional.
