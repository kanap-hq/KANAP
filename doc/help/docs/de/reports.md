# Berichte

Der Berichtsbereich bietet Ihnen vorgefertigte, interaktive Berichte zur Analyse von Budgetdaten, Kostenzuordnungen und Ausgabentrends. Jeder Bericht kombiniert eine Zusammenfassungstabelle mit einem Diagramm, und alle unterstützen CSV- und Bildexporte.

## Wo Sie es finden

Navigieren Sie im Hauptmenü zu **Berichte**, um den Berichts-Hub zu öffnen.

- Pfad: **Berichte**
- Berechtigungen: `reporting:reader` (Minimum)

---

## Berichts-Hub

Die Startseite zeigt eine Karte für jeden verfügbaren Bericht mit einer kurzen Beschreibung. Klicken Sie auf eine beliebige Karte, um den Bericht zu öffnen.

| Bericht | Was er abdeckt |
|---------|----------------|
| **Globale Leistungsverrechnung** | Unternehmensebene: Zuordnungssummen, KPIs und konzerninterne Flüsse (OPEX) |
| **Leistungsverrechnung pro Unternehmen** | Einzelunternehmen-Detailansicht mit Abteilungen, Positionen und KPIs (OPEX) |
| **Top-Positionen** | Größte OPEX- oder CAPEX-Positionen für ein ausgewähltes Jahr (anpassbare Top-N-Anzahl) |
| **Top Anstieg / Rückgang** | Größte OPEX- oder CAPEX-Veränderungen zwischen zwei Budgetspalten (anpassbare Top-N-Anzahl) |
| **Budgettrend (OPEX)** | OPEX-Kennzahlen über einen Jahresbereich vergleichen |
| **Budgettrend (CAPEX)** | CAPEX-Kennzahlen über einen Jahresbereich vergleichen |
| **Budgetspaltenvergleich** | Bis zu 10 Jahr+Spalten-Kombinationen für OPEX oder CAPEX auswählen |
| **Konsolidierungskonten** | OPEX- oder CAPEX-Budget gruppiert nach Konsolidierungskonto |
| **Analysedimensionen** | OPEX- oder CAPEX-Budget gruppiert nach Analysedimension |

### OPEX oder CAPEX wählen

**Top-Positionen**, **Top Anstieg / Rückgang**, **Konsolidierungskonten** und **Analysedimensionen** beginnen jeweils mit einem Umschalter **OPEX** / **CAPEX**, dem ersten Steuerelement der Filterleiste.

- Der Bericht öffnet sich auf einem Typ, den Sie lesen dürfen, zuerst OPEX. Ein Typ, den Sie nicht lesen dürfen, ist deaktiviert.
- Die Seitenadresse behält den gewählten Typ (`?scope=opex` oder `?scope=capex`). Ein gespeicherter oder geteilter Link öffnet sich daher auf demselben Typ.
- Untertitel und Diagrammtitel nennen den Typ. So zeigt ein Ausdruck oder ein exportiertes PNG, welchen Typ es abdeckt.
- Ein Wechsel des Typs leert die ausgeschlossenen Positionen, da jeder Typ seine eigenen Positionen hat.

Die beiden Leistungsverrechnungsberichte decken nur OPEX ab.

### Budgetspalten in Berichten

Jede Spalten- oder Kennzahlauswahl bietet die Budgetspalten an, die Ihre Organisation anzeigt, unter ihren Namen und in der festen Spaltenreihenfolge. Prognose wird angeboten, wenn sie angezeigt wird. Ausgeblendete Spalten werden nicht angeboten. Jeder Bericht beginnt mit der Standardspalte, wie unten beschrieben. Budgetadministratoren legen die Namen, die angezeigten Spalten und die Standardspalte unter [Budgetspalten](budget-operations.md#budgetspalten) fest.

### Filter nach Kostenstelle, Run oder Build und Analysedimensionen

Die sieben Budgetberichte (**Top-Positionen**, **Top Anstieg / Rückgang**, **Budgettrend (OPEX)**, **Budgettrend (CAPEX)**, **Budgetspaltenvergleich**, **Konsolidierungskonten** und **Analysedimensionen**) lassen sich mit diesen Filtern auf einen Teil des Budgets eingrenzen:

- **Kostenstelle**: Wählen Sie eine Kostenstelle oder eine Gruppe. Eine Gruppe umfasst alles, was darunter liegt, einschließlich deaktivierter Kostenstellen, da deren Zeilen weiterhin zur Gruppe gehören. **Alle Kostenstellen** entfernt den Filter. Siehe [Kostenstellen](cost-centers.md).
- **Run oder Build**: **Alle**, **Run**, **Build** oder **Nicht festgelegt** für die Zeilen, die keines von beiden haben.
- **Analysedimensionen**: ein Filter pro Dimension, nach ihr benannt. Die Standarddimension erscheint als **Analysedimension**, bis sie umbenannt wird. Wählen Sie einen Wert, **Kein Wert** für die Zeilen ohne Wert in dieser Dimension oder **Alle**, um den Filter zu entfernen. Jeder Filter bietet die Werte an, die die Zeilen des Berichts tragen. Siehe [Analysedimensionen](analytics.md).

Wann die Filter erscheinen:

- **Kostenstelle** erscheint, sobald Ihr Arbeitsbereich mindestens eine Kostenstelle oder Gruppe hat.
- **Run oder Build** erscheint, sobald eine Zeile des Berichts als **Run** oder **Build** markiert ist oder die Seitenadresse den Filter bereits enthält.
- Der Filter einer Dimension erscheint, sobald eine Zeile des Berichts einen Wert in dieser Dimension hat oder die Seitenadresse ihn bereits enthält. Deaktivierte Dimensionen haben keinen Filter.
- Ohne all diese zeigt die Filterleiste nur die eigenen Steuerelemente des Berichts.

So funktionieren sie:

- Die Filter wirken vor jeder Summe. Beträge, Anteile, Diagramme und Summen umfassen nur die verbleibenden Zeilen.
- Filter in mehreren Dimensionen werden kombiniert: Eine Zeile muss jedem von ihnen entsprechen.
- Die Listen der auszuschließenden Positionen, Konten und Werte bieten weiterhin alle Zeilen an.
- Die Seitenadresse speichert die Filter (`?costCenter=`, `?runBuild=` und `?analytics=`), sodass ein gespeicherter oder geteilter Link den Bericht bereits eingegrenzt öffnet. Nennt ein Link eine inzwischen deaktivierte oder gelöschte Dimension, wird dieser Teil ignoriert.
- Nennt der Link eine inzwischen gelöschte Kostenstelle oder konnten die Kostenstellen nicht geladen werden, zeigt der Bericht keine Zeilen und eine Textzeile: „Diese Kostenstelle existiert nicht mehr oder konnte nicht geladen werden." Klicken Sie auf **Filter entfernen**, um den Bericht wieder zu sehen.
- Enthält der Link einen Analysefilter und konnten die Dimensionen nicht geladen werden, zeigt der Bericht keine Zeilen und eine Textzeile: „Der Analysefilter konnte nicht angewendet werden. Entfernen Sie ihn oder versuchen Sie es erneut.“ Klicken Sie auf **Filter entfernen**, um die Analysefilter zu entfernen und den Bericht wieder zu sehen.
- Die beiden Leistungsverrechnungsberichte haben keine solchen Filter und sind nicht betroffen.

---

## Globale Leistungsverrechnung

Zeigen Sie Kostenzuordnungen über alle Unternehmen hinweg mit Zusammenfassungs-KPIs und konzerninternen Flüssen.

### Steuerungen

- **Jahr**: Vorheriges, aktuelles oder nächstes Geschäftsjahr
- **Spalte**: Jede angezeigte Budgetspalte. Beginnt mit der Standardspalte
- **Unternehmens-Summen** (Kontrollkästchen): Unternehmens-Summentabelle und Balkendiagramm ein-/ausblenden
- **Detaillierte Zuordnungen** (Kontrollkästchen): Aufschlüsselung nach Unternehmen/Abteilung ein-/ausblenden
- **KPIs einbeziehen** (Kontrollkästchen): KPI-Tabelle ein-/ausblenden
- **Konzerninterne Flüsse** (Kontrollkästchen): Verrechnete Zahler/Nutznießer-Flüsse ein-/ausblenden
- **Ausführen**-Schaltfläche: Bericht manuell aktualisieren

### Was Sie sehen

**Gesamtsummen-Karte**: Die Gesamtsumme für die ausgewählte Kennzahl und das Jahr, plus Anzahl der Unternehmen, Detailzeilen und KPI-Abdeckung.

**Unternehmens-Summentabelle** (wenn aktiviert):

- Unternehmensname
- Betrag für die ausgewählte Kennzahl
- Bezahlt (gebuchter) Betrag
- Netto (verbraucht minus bezahlt)
- Anteil an der Gesamtsumme

**Diagramm**: Horizontales Balkendiagramm der Zuordnungen nach Unternehmen.

**Detaillierte Zuordnungstabelle** (wenn aktiviert):

- Unternehmens- und Abteilungsspalten (gruppiert mit fetten Zwischensummenzeilen pro Unternehmen)
- Betrag, Anteil an Gesamtsumme, Mitarbeiterzahl und Kosten pro Benutzer
- Zeilen mit „Gemeinkosten" repräsentieren Kosten ohne Abteilungszuordnung

**Konzerninterne Flüsse-Tabelle** (wenn aktiviert):

- Verrechnete Zahler-zu-Nutznießer-Flüsse pro Unternehmenspaar (Eigenverbrauch ausgeschlossen)
- Spalten: Zahler, Nutznießer, Betrag
- Separate Schaltfläche **Verrechnete Flüsse als CSV exportieren**

**KPI-Tabelle** (wenn aktiviert):

| Spalte | Beschreibung |
|--------|--------------|
| Unternehmen | Unternehmensname |
| Betrag | Summe der ausgewählten Kennzahl |
| Mitarbeiterzahl | Gesamte Mitarbeiterzahl |
| IT-Benutzer | Anzahl IT-Benutzer |
| Umsatz | Jahresumsatz |
| IT-Kosten vs. Umsatz | Prozentsatz |
| IT-Kosten pro Benutzer | Betrag geteilt durch Mitarbeiterzahl |
| IT-Kosten pro IT-Benutzer | Betrag geteilt durch IT-Benutzer |

Eine Summenzeile ist unten angeheftet.

### Export

- **Tabelle als CSV exportieren** (Download-Symbol): Exportiert das detaillierte Zuordnungs-Grid
- **Diagramm als PNG exportieren** (Bild-Symbol): Exportiert das Balkendiagramm
- **Drucken / Als PDF speichern** (Druck-Symbol)

---

## Leistungsverrechnung pro Unternehmen

Detailansicht der Leistungsverrechnungs-Zuordnungen eines einzelnen Unternehmens über Abteilungen, Budgetpositionen, konzerninterne Flüsse und KPIs.

### Steuerungen

- **Unternehmen**: Welches Unternehmen analysiert werden soll
- **Jahr**: Vorheriges, aktuelles oder nächstes Geschäftsjahr
- **Spalte**: Jede angezeigte Budgetspalte. Beginnt mit der Standardspalte
- **Abteilungs-Summen** (Kontrollkästchen): Abteilungsaufschlüsselung ein-/ausblenden
- **Verrechnungspositionen** (Kontrollkästchen): Einzelzuordnungen ein-/ausblenden
- **Verrechnungs-KPIs** (Kontrollkästchen): KPI-Vergleichstabelle ein-/ausblenden
- **Konzerninterne Flüsse** (Kontrollkästchen): Partnerunternehmens-Flüsse ein-/ausblenden
- **Ausführen**-Schaltfläche: Bericht manuell aktualisieren (deaktiviert, bis ein Unternehmen ausgewählt ist)

### Was Sie sehen

**Unternehmens-Zusammenfassungskarte**: Unternehmensname, Gesamtbetrag, Berichtswährung, Mitarbeiterzahl, IT-Benutzer, Kosten pro Benutzer, Kosten pro IT-Benutzer und IT-Kosten vs. Umsatz.

**Abteilungs-Summen** (wenn aktiviert):

- Abteilungsname, Betrag, Anteil an Gesamtsumme, Mitarbeiterzahl, Kosten pro Benutzer
- „Gemeinkosten" aggregiert Zuordnungen ohne bestimmte Abteilung
- Horizontales Balkendiagramm neben der Tabelle

**Verrechnungspositionen** (wenn aktiviert):

- Positionsname, Zuordnungsmethode, Betrag, Anteil an Gesamtsumme
- Angeheftete Summenzeile unten

**Konzerninterne Flüsse** (wenn aktiviert):

- Partnerunternehmen, Forderungen, Verbindlichkeiten, Netto
- Angeheftete Summenzeile
- Separate Schaltfläche **Flüsse als CSV exportieren**

**KPI-Tabelle** (wenn aktiviert): Gleiche Spalten wie die KPI-Tabelle der Globalen Leistungsverrechnung, mit einer „Globale Summen"-Zeile unten zum Vergleich.

### Export

- **Tabelle als CSV exportieren**: Exportiert das Abteilungs-Summen-Grid
- **Diagramm als PNG exportieren**: Exportiert das Abteilungs-Balkendiagramm
- **Drucken / Als PDF speichern**

---

## Top-Positionen

Identifizieren Sie Ihre größten OPEX- oder CAPEX-Positionen für ein bestimmtes Jahr.

### Steuerungen

- **Positionstyp**: OPEX oder CAPEX (siehe [OPEX oder CAPEX wählen](#opex-oder-capex-wahlen))
- **Jahr**: Vorheriges, aktuelles oder nächstes Jahr
- **Kennzahl**: Jede angezeigte Budgetspalte. Beginnt mit der Standardspalte
- **Top-Anzahl**: Wie viele Positionen angezeigt werden (Standard: 10, Minimum: 1)
- **Diagrammtyp**: Kreisdiagramm oder horizontales Balkendiagramm
- **Positionen ausschließen**: Mehrfachauswahl mit Autovervollständigung zum Ausschließen bestimmter Positionen
- **Konten ausschließen**: Mehrfachauswahl mit Autovervollständigung zum Ausschließen bestimmter Konten
- **Kostenstelle**, **Run oder Build** und die Filter nach Analysedimension: Siehe [Filter nach Kostenstelle, Run oder Build und Analysedimensionen](#filter-nach-kostenstelle-run-oder-build-und-analysedimensionen)

### Was Sie sehen

**Diagramm**: Kreis- oder horizontales Balkendiagramm der Top-Positionen. Sein Titel nennt den Typ, zum Beispiel „Top 10 CAPEX · Budget 2026".

**Tabellenspalten**:

- Position
- Wert für die ausgewählte Kennzahl und das Jahr
- Anteil an Gesamtsumme (Prozentsatz)

**Zusammenfassungskarten unter der Tabelle**:

- **Top N gesamt**, mit ihrem Anteil an der gefilterten Summe, zum Beispiel „45 % der gefilterten Summe“
- Die Summe der ausgewählten Spalte über alle Positionen, beschriftet mit dem Spaltennamen, zum Beispiel **Budget, gesamt**

Die Fußnote des Diagramms nennt dieselbe Summe, zum Beispiel „Budget, gesamt: 1 234“.

### Anwendungsfall

Verwenden Sie diesen Bericht, um schnell zu erkennen, wohin der Großteil Ihres IT-Budgets fließt, und Kandidaten für Kostenoptimierung zu identifizieren.

---

## Top Anstieg / Rückgang

Identifizieren Sie die größten OPEX- oder CAPEX-Veränderungen zwischen zwei Budgetspalten (jede Kombination aus Jahr und Kennzahl).

### Steuerungen

- **Positionstyp**: OPEX oder CAPEX (siehe [OPEX oder CAPEX wählen](#opex-oder-capex-wahlen))
- **Quelljahr** und **Quellkennzahl**: Die Basisspalte zum Vergleich
- **Zieljahr** und **Zielkennzahl**: Die Zielspalte zum Vergleich
- **Top-Anzahl**: Wie viele Positionen pro Richtung angezeigt werden (Standard: 10)
- **Diagrammtyp**: Kreisdiagramm (nur eine Richtung) oder horizontales Balkendiagramm
- **Positionen ausschließen**: Mehrfachauswahl mit Autovervollständigung zum Ausschließen bestimmter Positionen
- **Konten ausschließen**: Mehrfachauswahl mit Autovervollständigung zum Ausschließen bestimmter Konten
- **Richtung**: Tabs **Anstiege**, **Rückgänge** oder **Beide**
- **Kostenstelle**, **Run oder Build** und die Filter nach Analysedimension: Siehe [Filter nach Kostenstelle, Run oder Build und Analysedimensionen](#filter-nach-kostenstelle-run-oder-build-und-analysedimensionen)

Die Jahresauswahlen listen die Jahre, die Daten enthalten. Die Kennzahlauswahlen bieten die angezeigten Budgetspalten an. Der Bericht beginnt mit der Standardspalte des Vorjahres als Quelle und der Standardspalte des aktuellen Jahres als Ziel.

Wenn **Beide** ausgewählt ist, wird die Kreisdiagramm-Option deaktiviert und der Bericht wechselt automatisch zum Balkendiagramm.

### Was Sie sehen

**Diagramm**: Visualisierung der Top-Veränderungen. Sein Titel nennt den Typ, zum Beispiel „Top 10 OPEX-Anstiege".

**Tabellenspalten**:

- Position
- Quellwert (vorher)
- Zielwert (aktuell)
- Delta (absolute Änderung)
- Prozentuale Steigerung

**Zusammenfassungskarten unter der Tabelle**:

- Auswahlsummen (Steigerungs- und/oder Rückgangsbeträge, mit Quell-/Zielsummen)
- Brutto-Veränderungen über alle Positionen (mit Abdeckungsprozentsatz)
- Netto-Steigerung oder -Rückgang über alle Positionen

### Anwendungsfall

Verwenden Sie diesen Bericht zur Identifizierung von Kostenüberschreitungen, zum Aufspüren von Einsparmöglichkeiten und zur Erklärung der Jahresvergleichsabweichung in Budget-Reviews.

---

## Budgettrend (OPEX)

Vergleichen Sie OPEX-Kennzahlen über mehrere Jahre in einem einzelnen Liniendiagramm.

### Steuerungen

- **Startjahr**: Beginn des Bereichs (aktuelles Jahr minus 2 bis plus 2)
- **Endjahr**: Ende des Bereichs
- **Kennzahlen**: Mehrfachauswahl aus den angezeigten Budgetspalten. Der Bericht beginnt mit der Standardspalte und der letzten angezeigten Spalte (Budget und Erwarteter Endwert mit den Standardeinstellungen). Wenn Sie alle Kennzahlen entfernen, wird die Standardspalte verwendet
- **Kostenstelle**, **Run oder Build** und die Filter nach Analysedimension: Siehe [Filter nach Kostenstelle, Run oder Build und Analysedimensionen](#filter-nach-kostenstelle-run-oder-build-und-analysedimensionen)

### Was Sie sehen

**Diagramm**: Liniendiagramm mit einer Serie pro ausgewählter Kennzahl, aufgetragen über den Jahresbereich.

**Tabelle**: Eine Zeile pro ausgewählter Kennzahl mit Jahresspalten, die Summen zeigen.

### Export

- **Tabelle als CSV exportieren**
- **Diagramm als PNG exportieren**
- **Drucken / Als PDF speichern**

---

## Budgettrend (CAPEX)

Identisches Layout wie der OPEX-Trendbericht, aber mit CAPEX-Budgetdaten.

### Steuerungen

- **Startjahr**, **Endjahr**, **Kennzahlen**: Gleich wie beim OPEX-Trendbericht
- **Kostenstelle**, **Run oder Build** und die Filter nach Analysedimension: Siehe [Filter nach Kostenstelle, Run oder Build und Analysedimensionen](#filter-nach-kostenstelle-run-oder-build-und-analysedimensionen)

### Was Sie sehen

- Liniendiagramm der CAPEX-Summen nach Kennzahl über Jahre
- Zusammenfassungstabelle mit Jahresspalten

---

## Budgetspaltenvergleich

Vergleichen Sie flexibel bis zu 10 Jahr+Spalten-Kombinationen für entweder OPEX oder CAPEX.

### Steuerungen

- **Positionstyp**: OPEX- oder CAPEX-Umschalter
- **Auswahlen**: Jede Auswahl hat eine Jahrauswahl und eine Spaltenauswahl mit den angezeigten Budgetspalten. Der Bericht beginnt mit zwei Auswahlen: der Standardspalte des aktuellen Jahres und des nächsten Jahres. **Hinzufügen** fügt die Standardspalte des aktuellen Jahres hinzu, und das Löschsymbol entfernt eine Auswahl. Maximum von 10 Auswahlen; Minimum von 1.
- **Jahresgruppierung** (Kontrollkästchen): Wenn aktiviert und mindestens zwei Jahre eine Kennzahl teilen, wechselt zu einem gruppierten Liniendiagramm mit einer Serie pro Kennzahl und Jahren auf der X-Achse. Wenn deaktiviert, zeigt ein flaches Liniendiagramm mit jeder Auswahl als Datenpunkt.
- **Kostenstelle**, **Run oder Build** und die Filter nach Analysedimension: Siehe [Filter nach Kostenstelle, Run oder Build und Analysedimensionen](#filter-nach-kostenstelle-run-oder-build-und-analysedimensionen)

### Was Sie sehen

**Diagramm**:

- Standardmodus: Liniendiagramm mit jeder Auswahl auf der X-Achse und ihrer Summe auf der Y-Achse
- Jahresgruppierungsmodus: Liniendiagramm mit Jahren auf der X-Achse und einer Linie pro Kennzahl

**Tabelle**:

- Standardmodus: Auswahlbezeichnung, Jahr, Spaltenname, Summe
- Jahresgruppierungsmodus: Jahresspalte, dann eine Spalte pro Kennzahl mit Summen

### Export

- **Tabelle als CSV exportieren**
- **Diagramm als PNG exportieren**
- **Drucken / Als PDF speichern**

---

## Konsolidierungskonten

Zeigen Sie OPEX- oder CAPEX-Budgetdaten gruppiert nach Konsolidierungskonto, wobei sich der Diagrammtyp an den Jahresbereich anpasst.

### Steuerungen

- **Positionstyp**: OPEX oder CAPEX (siehe [OPEX oder CAPEX wählen](#opex-oder-capex-wahlen))
- **Startjahr** und **Endjahr**: Vorheriges, aktuelles oder nächstes Jahr
- **Kennzahl**: Jede angezeigte Budgetspalte. Beginnt mit der Standardspalte
- **Diagrammtyp**: Kreisdiagramm oder horizontales Balkendiagramm (nur verfügbar bei Auswahl eines einzelnen Jahres)
- **Konten ausschließen**: Mehrfachauswahl mit Autovervollständigung zum Ausschließen bestimmter Konten
- **Kostenstelle**, **Run oder Build** und die Filter nach Analysedimension: Siehe [Filter nach Kostenstelle, Run oder Build und Analysedimensionen](#filter-nach-kostenstelle-run-oder-build-und-analysedimensionen)

### Was Sie sehen

**Einzeljahr-Modus**:

- Kreis- oder horizontales Balkendiagramm der Summen nach Konsolidierungskonto
- Fußnote mit der Summe der ausgewählten Kennzahl

**Mehrjahr-Modus**:

- Liniendiagramm mit einer Serie pro Konsolidierungskonto über Jahre

**Tabelle**: Eine Zeile pro Konsolidierungskonto mit Jahresspalten. Eine angeheftete Summenzeile unten summiert alle Gruppen.

Positionen ohne Konsolidierungskonto erscheinen als „Nicht zugewiesen".

---

## Analysedimensionen

Zeigen Sie OPEX- oder CAPEX-Budgetdaten gruppiert nach den Werten einer Analysedimension. Das Layout entspricht dem Bericht Konsolidierungskonten. Siehe [Analysedimensionen](analytics.md), um Dimensionen und Werte einzurichten.

### Steuerungen

- **Positionstyp**: OPEX oder CAPEX (siehe [OPEX oder CAPEX wählen](#opex-oder-capex-wahlen))
- **Dimension**: die Dimension, nach der der Bericht gruppiert. Sie erscheint, wenn Sie zwei oder mehr aktivierte Dimensionen haben, und der Bericht öffnet mit der Standarddimension. Die Seitenadresse speichert Ihre Wahl, sodass ein gespeicherter oder geteilter Link mit derselben Dimension öffnet
- **Startjahr** und **Endjahr**: Vorheriges, aktuelles oder nächstes Jahr
- **Kennzahl**: Jede angezeigte Budgetspalte. Beginnt mit der Standardspalte
- **Diagrammtyp**: Kreisdiagramm oder horizontales Balkendiagramm (nur Einzeljahr)
- **Werte ausschließen**: Mehrfachauswahl mit Autovervollständigung zum Ausschließen bestimmter Werte der gewählten Dimension. Ein Wechsel des Positionstyps oder der Dimension leert die Auswahl
- **Kostenstelle**, **Run oder Build** und die Filter nach Analysedimension: Siehe [Filter nach Kostenstelle, Run oder Build und Analysedimensionen](#filter-nach-kostenstelle-run-oder-build-und-analysedimensionen)

Untertitel, Diagrammtitel und erste Tabellenspalte nennen die gewählte Dimension, zum Beispiel „OPEX nach Nature“.

### Was Sie sehen

**Einzeljahr-Modus**:

- Kreis- oder Balkendiagramm der Summen nach Wert
- Fußnote mit der Kennzahl-Summe

**Mehrjahr-Modus**:

- Liniendiagramm mit einer Serie pro Wert

**Tabelle**: Eine Zeile pro Wert mit Jahresspalten. Eine angeheftete Summenzeile unten. Zeilen ohne Wert in der gewählten Dimension erscheinen als „Nicht zugeordnet“.

---

## Gemeinsame Funktionen

Jeder Bericht bietet diese Funktionen über die gemeinsame Symbolleiste:

### Exportoptionen

- **Tabelle als CSV exportieren** (Download-Symbol): Lädt die Primärtabellendaten herunter
- **Diagramm als PNG exportieren** (Bild-Symbol): Lädt das Diagramm als PNG-Bild herunter
- **Drucken / Als PDF speichern** (Druck-Symbol): Öffnet den Browser-Druckdialog. Sie können auch `?print=1` an jede Bericht-URL anhängen, um den Druck beim Laden automatisch auszulösen.

Exportierte Dateinamen enthalten den Spaltennamen, zum Beispiel `top10-opex-2026-budget-bar.png`.

### Verfügbare Kennzahlen

Jede Kennzahl- oder Spaltenauswahl bietet dieselben Budgetspalten an: die, die Ihre Organisation anzeigt, unter ihren Namen. Mit den Standardeinstellungen sind das Budget, Revision, Ist-Werte und Erwarteter Endwert. Prognose wird angeboten, wenn sie angezeigt wird. Siehe [Budgetspalten in Berichten](#budgetspalten-in-berichten).

### Navigation

Jeder Bericht zeigt eine Breadcrumb-Navigation zurück zum **Berichte**-Hub, sodass Sie schnell zwischen Berichten wechseln können.

---

## Tipps

- **Mit der Globalen Leistungsverrechnung beginnen**: Verschaffen Sie sich den Gesamtüberblick über Zuordnungen, bevor Sie in ein einzelnes Unternehmen eintauchen.
- **Top-Positionen für schnelle Erfolge nutzen**: Die größten Kostenpositionen sind Ihre ersten Kandidaten für Optimierung.
- **Budget vs. Erwarteter Endwert vergleichen**: Verwenden Sie den Bericht Budgetspaltenvergleich, um die Prognosegenauigkeit über Jahre zu messen.
- **Abschnitte in Leistungsverrechnungsberichten umschalten**: Die Kontrollkästchen ermöglichen es, sich nur auf die benötigten Daten zu konzentrieren (Abteilungen, Positionen, KPIs oder Flüsse), ohne visuelle Unordnung.
- **Jahresgruppierung im Budgetspaltenvergleich**: Wenn Sie die gleiche Kennzahl über mehrere Jahre vergleichen, aktivieren Sie die Jahresgruppierung für ein übersichtlicheres Liniendiagramm.
- **Für Präsentationen exportieren**: Diagramme exportieren als PNG und Tabellen als CSV, beides bereit für Folien oder Tabellenkalkulationen.
