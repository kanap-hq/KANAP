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
| **Personal nach Monat** | Monatliche VZÄ nach Kostenstelle, Position, Lieferant oder Analysedimension |
| **Kosten pro VZÄ** | Jährliche Kosten eines VZÄ oder durchschnittlicher Tagessatz, nach Kostenstelle, Position, Lieferant oder Analysedimension, über Budgetspalten und Jahre |

### OPEX oder CAPEX wählen

**Top-Positionen**, **Top Anstieg / Rückgang**, **Konsolidierungskonten**, **Analysedimensionen**, **Personal nach Monat** und **Kosten pro VZÄ** beginnen jeweils mit einem Umschalter **OPEX** / **CAPEX**, dem ersten Steuerelement der Filterleiste.

- Der Bericht öffnet sich auf einem Typ, den Sie lesen dürfen, zuerst OPEX. Ein Typ, den Sie nicht lesen dürfen, ist deaktiviert.
- Die Seitenadresse behält den gewählten Typ (`?scope=opex` oder `?scope=capex`). Ein gespeicherter oder geteilter Link öffnet sich daher auf demselben Typ.
- Untertitel und Diagrammtitel nennen den Typ. So zeigt ein Ausdruck oder ein exportiertes PNG, welchen Typ es abdeckt.
- Ein Wechsel des Typs leert die ausgeschlossenen Positionen, da jeder Typ seine eigenen Positionen hat.

Die beiden Leistungsverrechnungsberichte decken nur OPEX ab.

### Betrag oder VZÄ wählen

Die sieben Budgetberichte haben eine Auswahl **Messgröße**. Sie steht direkt nach dem Umschalter **OPEX** / **CAPEX**, oder an erster Stelle, wenn der Bericht keinen Umschalter hat. Sie bietet **Betrag** (Standard) und **VZÄ**. Die beiden Leistungsverrechnungsberichte haben keine Messgröße.

Mit **VZÄ** summiert ein Bericht Personen statt Geld:

- Jede Budgetspalte zeigt die durchschnittlichen VZÄ über das ganze Jahr, die ihre Zeilen mit Menge und Preis melden. Zeilen in Personen oder Tagen erhöhen die VZÄ. Zeilen in Stück zählen 0. Eine Spalte ohne Zeilen meldet keine VZÄ und bleibt unberücksichtigt: Es zählen nur gemeldete VZÄ. Siehe [Menge und Preis](opex.md#menge-und-preis) und [VZÄ](opex.md#vza).
- Ein Jahr oder eine Spalte, in der keine Position VZÄ meldet, zeigt eine leere Zelle, ohne Balken oder Punkt im Diagramm.
- **Top-Positionen**, **Konsolidierungskonten** und **Analysedimensionen** lassen Positionen und Gruppen ohne gemeldete VZÄ weg. Anteile sind Anteile an der VZÄ-Summe.
- **Top Anstieg / Rückgang** vergleicht die VZÄ der beiden Spalten Position für Position. Eine Position, die nur auf einer Seite VZÄ meldet, zählt auf der anderen Seite 0.
- Werte erscheinen mit zwei Dezimalstellen. Spaltennamen und Diagrammtitel tragen den Zusatz VZÄ.
- Die Seitenadresse speichert die Messgröße (`?measure=fte`), sodass ein gespeicherter oder geteilter Link mit derselben Messgröße öffnet.
- Die Dateinamen exportierter PNG- und CSV-Dateien enden auf `-fte`.

Mit VZÄ warnt eine Zeile unter der Tabelle, wenn einige Positionen VZÄ in einer Spalte melden, deren Betrag den Zeilen nicht mehr folgt. Das ist der Fall, wenn der Betrag verteilt wurde, seine Monate von Hand bearbeitet wurden oder die Spalte aus einer Spalte kopiert wurde, deren Zeilen nur als Referenz dienten. Die Zeile nennt pro Spalte und Jahr, wie viele Positionen und wie viele VZÄ betroffen sind. Bei mehreren Spalten lautet sie zum Beispiel: „Der Betrag folgt nicht mehr den Zeilen bei: Budget 2026 (2 Positionen, 1,50 VZÄ), Budget 2027 (1 Position, 0,50 VZÄ).“ Bei einer Spalte lautet sie: „2 Positionen melden 1,50 VZÄ, ihr Betrag folgt aber nicht mehr ihren Zeilen.“ Ihre VZÄ zählen weiterhin. Die Zeile weist darauf hin, dass der Betrag der Spalte nicht den Kosten ihrer Zeilen entspricht.

### Budgetspalten in Berichten

Jede Spalten- oder Kennzahlauswahl bietet die Budgetspalten an, die Ihre Organisation anzeigt, unter ihren Namen und in der festen Spaltenreihenfolge. Prognose wird angeboten, wenn sie angezeigt wird. Ausgeblendete Spalten werden nicht angeboten. Jeder Bericht beginnt mit der Standardspalte, wie unten beschrieben. Budgetadministratoren legen die Namen, die angezeigten Spalten und die Standardspalte unter [Budgetspalten](budget-operations.md#budgetspalten) fest.

### Filter nach Kostenstelle, Run oder Build und Analysedimensionen

Die sieben Budgetberichte (**Top-Positionen**, **Top Anstieg / Rückgang**, **Budgettrend (OPEX)**, **Budgettrend (CAPEX)**, **Budgetspaltenvergleich**, **Konsolidierungskonten** und **Analysedimensionen**), **Personal nach Monat** und **Kosten pro VZÄ** lassen sich mit diesen Filtern auf einen Teil des Budgets eingrenzen:

- **Kostenstelle**: Wählen Sie eine Kostenstelle oder eine Gruppe. Eine Gruppe umfasst alles, was darunter liegt, einschließlich deaktivierter Kostenstellen, da deren Zeilen weiterhin zur Gruppe gehören. **Alle Kostenstellen** entfernt den Filter. Siehe [Kostenstellen](cost-centers.md).
- **Run oder Build**: **Alle**, **Run**, **Build** oder **Nicht festgelegt** für die Zeilen, die keines von beiden haben.
- **Positionen**: **Alle Positionen** oder **Positionen mit VZÄ**. **Positionen mit VZÄ** behält die Positionen, die in mindestens einer Budgetspalte eines beliebigen Jahres VZÄ melden. Der Filter wirkt mit beiden Messgrößen. Ein Betragsbericht, der auf **Positionen mit VZÄ** eingegrenzt ist, vergleicht zum Beispiel die Beträge von Budget und Ist-Werte der Personalpositionen. Die Ist-Werte umfassen die ganze Position.
- **Analysedimensionen**: ein Filter pro Dimension, nach ihr benannt. Die Standarddimension erscheint als **Analysedimension**, bis sie umbenannt wird. Wählen Sie einen Wert, **Kein Wert** für die Zeilen ohne Wert in dieser Dimension oder **Alle**, um den Filter zu entfernen. Jeder Filter bietet die Werte an, die die Zeilen des Berichts tragen. Siehe [Analysedimensionen](analytics.md).

Wann die Filter erscheinen:

- **Kostenstelle** erscheint, sobald Ihr Arbeitsbereich mindestens eine Kostenstelle oder Gruppe hat.
- **Run oder Build** erscheint, sobald eine Zeile des Berichts als **Run** oder **Build** markiert ist oder die Seitenadresse den Filter bereits enthält.
- **Positionen** erscheint, sobald eine Position des Berichts VZÄ meldet oder die Seitenadresse den Filter bereits enthält.
- Der Filter einer Dimension erscheint, sobald eine Zeile des Berichts einen Wert in dieser Dimension hat oder die Seitenadresse ihn bereits enthält. Deaktivierte Dimensionen haben keinen Filter.
- Ohne all diese zeigt die Filterleiste nur die eigenen Steuerelemente des Berichts.

So funktionieren sie:

- Die Filter wirken vor jeder Summe. Beträge, Anteile, Diagramme und Summen umfassen nur die verbleibenden Zeilen.
- Filter in mehreren Dimensionen werden kombiniert: Eine Zeile muss jedem von ihnen entsprechen.
- Die Listen der auszuschließenden Positionen, Konten und Werte bieten weiterhin alle Zeilen an.
- Die Seitenadresse speichert die Filter (`?costCenter=`, `?runBuild=`, `?fte=with` und `?analytics=`), sodass ein gespeicherter oder geteilter Link den Bericht bereits eingegrenzt öffnet. Nennt ein Link eine inzwischen deaktivierte oder gelöschte Dimension, wird dieser Teil ignoriert.
- Nennt der Link eine inzwischen gelöschte Kostenstelle oder konnten die Kostenstellen nicht geladen werden, zeigt der Bericht keine Zeilen und eine Textzeile: „Diese Kostenstelle existiert nicht mehr oder konnte nicht geladen werden." Klicken Sie auf **Filter entfernen**, um den Bericht wieder zu sehen.
- Enthält der Link einen Analysefilter und konnten die Dimensionen nicht geladen werden, zeigt der Bericht keine Zeilen und eine Textzeile: „Der Analysefilter konnte nicht angewendet werden. Entfernen Sie ihn oder versuchen Sie es erneut.“ Klicken Sie auf **Filter entfernen**, um die Analysefilter zu entfernen und den Bericht wieder zu sehen.
- Die beiden Leistungsverrechnungsberichte haben keine solchen Filter und sind nicht betroffen.

### Die Liste aus einem Bericht öffnen

In **Personal nach Monat**, **Kosten pro VZÄ**, **Analysedimensionen** und **Konsolidierungskonten** ist der Name einer Gruppe ein Link, der die OPEX- oder CAPEX-Liste in einem neuen Tab öffnet, mit den Positionen, die die Zeile zählt:

- die Positionen der Gruppe, eingegrenzt durch die Filterleiste;
- alle Status (**Anzeigen: Alle**), mit einem Filter **Ende der Gültigkeit** „leer oder nach dem 31. Dezember“ des Jahres vor dem ersten Jahr des Berichts. Ein Bericht zählt die Positionen, die am 1. Januar seines ersten Jahres noch aktiv waren, auch die seither deaktivierten;
- in **Personal nach Monat** und **Kosten pro VZÄ** sowie mit der Messgröße **VZÄ** nur die Positionen, die VZÄ melden (der Filter **VZÄ gemeldet**).

Die gefilterten Spalten erscheinen für diesen Besuch direkt nach dem Positionsnamen, damit Sie sehen, warum die Liste eingegrenzt ist. Ein Konsolidierungskonto filtert auf seine Konten, ohne eigene Spalte.

Diese Liste ist eine Ansicht des Berichts. Was Sie darin ändern, bleibt in ihrer Adresse, und **OPEX** oder **CAPEX**, danach über das Menü geöffnet, zeigen Ihre eigene Sortierung, Suche und Filter.

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
- Der Positionsname ist ein Link, der die OPEX-Position in einem neuen Tab öffnet. Gemeinkosten und Summen bleiben einfacher Text.

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
- **Messgröße**: **Betrag** oder **VZÄ** (siehe [Betrag oder VZÄ wählen](#betrag-oder-vza-wahlen))
- **Jahr**: Vorheriges, aktuelles oder nächstes Jahr
- **Kennzahl**: Jede angezeigte Budgetspalte. Beginnt mit der Standardspalte
- **Top-Anzahl**: Wie viele Positionen angezeigt werden (Standard: 10, Minimum: 1)
- **Diagrammtyp**: Kreisdiagramm oder horizontales Balkendiagramm
- **Positionen ausschließen**: Mehrfachauswahl mit Autovervollständigung zum Ausschließen bestimmter Positionen
- **Konten ausschließen**: Mehrfachauswahl mit Autovervollständigung zum Ausschließen bestimmter Konten
- **Kostenstelle**, **Run oder Build**, **Positionen** und die Filter nach Analysedimension: Siehe [Filter nach Kostenstelle, Run oder Build und Analysedimensionen](#filter-nach-kostenstelle-run-oder-build-und-analysedimensionen)

### Was Sie sehen

**Diagramm**: Kreis- oder horizontales Balkendiagramm der Top-Positionen. Sein Titel nennt den Typ, zum Beispiel „Top 10 CAPEX · Budget 2026".

**Tabellenspalten**:

- Position
- Wert für die ausgewählte Kennzahl und das Jahr
- Anteil an Gesamtsumme (Prozentsatz)

Der Positionsname ist ein Link, der die OPEX- oder CAPEX-Position in einem neuen Tab öffnet.

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
- **Messgröße**: **Betrag** oder **VZÄ** (siehe [Betrag oder VZÄ wählen](#betrag-oder-vza-wahlen))
- **Quelljahr** und **Quellkennzahl**: Die Basisspalte zum Vergleich
- **Zieljahr** und **Zielkennzahl**: Die Zielspalte zum Vergleich
- **Top-Anzahl**: Wie viele Positionen pro Richtung angezeigt werden (Standard: 10)
- **Diagrammtyp**: Kreisdiagramm (nur eine Richtung) oder horizontales Balkendiagramm
- **Positionen ausschließen**: Mehrfachauswahl mit Autovervollständigung zum Ausschließen bestimmter Positionen
- **Konten ausschließen**: Mehrfachauswahl mit Autovervollständigung zum Ausschließen bestimmter Konten
- **Richtung**: Tabs **Anstiege**, **Rückgänge** oder **Beide**
- **Kostenstelle**, **Run oder Build**, **Positionen** und die Filter nach Analysedimension: Siehe [Filter nach Kostenstelle, Run oder Build und Analysedimensionen](#filter-nach-kostenstelle-run-oder-build-und-analysedimensionen)

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

Der Positionsname ist ein Link, der die OPEX- oder CAPEX-Position in einem neuen Tab öffnet.

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

- **Messgröße**: **Betrag** oder **VZÄ** (siehe [Betrag oder VZÄ wählen](#betrag-oder-vza-wahlen))
- **Startjahr**: Beginn des Bereichs (aktuelles Jahr minus 2 bis plus 2)
- **Endjahr**: Ende des Bereichs
- **Kennzahlen**: Mehrfachauswahl aus den angezeigten Budgetspalten. Der Bericht beginnt mit der Standardspalte und der letzten angezeigten Spalte (Budget und Erwarteter Endwert mit den Standardeinstellungen). Wenn Sie alle Kennzahlen entfernen, wird die Standardspalte verwendet
- **Kostenstelle**, **Run oder Build**, **Positionen** und die Filter nach Analysedimension: Siehe [Filter nach Kostenstelle, Run oder Build und Analysedimensionen](#filter-nach-kostenstelle-run-oder-build-und-analysedimensionen)

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

- **Messgröße**: **Betrag** oder **VZÄ** (siehe [Betrag oder VZÄ wählen](#betrag-oder-vza-wahlen))
- **Startjahr**, **Endjahr**, **Kennzahlen**: Gleich wie beim OPEX-Trendbericht
- **Kostenstelle**, **Run oder Build**, **Positionen** und die Filter nach Analysedimension: Siehe [Filter nach Kostenstelle, Run oder Build und Analysedimensionen](#filter-nach-kostenstelle-run-oder-build-und-analysedimensionen)

### Was Sie sehen

- Liniendiagramm der CAPEX-Summen nach Kennzahl über Jahre
- Zusammenfassungstabelle mit Jahresspalten

---

## Budgetspaltenvergleich

Vergleichen Sie flexibel bis zu 10 Jahr+Spalten-Kombinationen für entweder OPEX oder CAPEX.

### Steuerungen

- **Positionstyp**: OPEX- oder CAPEX-Umschalter
- **Messgröße**: **Betrag** oder **VZÄ** (siehe [Betrag oder VZÄ wählen](#betrag-oder-vza-wahlen))
- **Auswahlen**: Jede Auswahl hat eine Jahrauswahl und eine Spaltenauswahl mit den angezeigten Budgetspalten. Der Bericht beginnt mit zwei Auswahlen: der Standardspalte des aktuellen Jahres und des nächsten Jahres. **Hinzufügen** fügt die Standardspalte des aktuellen Jahres hinzu, und das Löschsymbol entfernt eine Auswahl. Maximum von 10 Auswahlen; Minimum von 1.
- **Jahresgruppierung** (Kontrollkästchen): Wenn aktiviert und mindestens zwei Jahre eine Kennzahl teilen, wechselt zu einem gruppierten Liniendiagramm mit einer Serie pro Kennzahl und Jahren auf der X-Achse. Wenn deaktiviert, zeigt ein flaches Liniendiagramm mit jeder Auswahl als Datenpunkt.
- **Kostenstelle**, **Run oder Build**, **Positionen** und die Filter nach Analysedimension: Siehe [Filter nach Kostenstelle, Run oder Build und Analysedimensionen](#filter-nach-kostenstelle-run-oder-build-und-analysedimensionen)

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
- **Messgröße**: **Betrag** oder **VZÄ** (siehe [Betrag oder VZÄ wählen](#betrag-oder-vza-wahlen))
- **Startjahr** und **Endjahr**: Vorheriges, aktuelles oder nächstes Jahr
- **Kennzahl**: Jede angezeigte Budgetspalte. Beginnt mit der Standardspalte
- **Diagrammtyp**: Kreisdiagramm oder horizontales Balkendiagramm (nur verfügbar bei Auswahl eines einzelnen Jahres)
- **Konten ausschließen**: Mehrfachauswahl mit Autovervollständigung zum Ausschließen bestimmter Konten. Bietet jedes vom Bericht verwendete Konto nach Name und Nummer an, unabhängig davon, ob Sie den Kontenplan öffnen können
- **Kostenstelle**, **Run oder Build**, **Positionen** und die Filter nach Analysedimension: Siehe [Filter nach Kostenstelle, Run oder Build und Analysedimensionen](#filter-nach-kostenstelle-run-oder-build-und-analysedimensionen)

### Was Sie sehen

**Einzeljahr-Modus**:

- Kreis- oder horizontales Balkendiagramm der Summen nach Konsolidierungskonto
- Fußnote mit der Summe der ausgewählten Kennzahl

**Mehrjahr-Modus**:

- Liniendiagramm mit einer Serie pro Konsolidierungskonto über Jahre

**Tabelle**: Eine Zeile pro Konsolidierungskonto mit Jahresspalten. Eine angeheftete Summenzeile unten summiert alle Gruppen. Ein Konsolidierungskonto öffnet die Liste der Positionen auf seinen Konten in einem neuen Tab („Nicht zugeordnet“: die Positionen, deren Konto kein Konsolidierungskonto hat, und die Positionen ohne Konto). Siehe [Die Liste aus einem Bericht öffnen](#die-liste-aus-einem-bericht-offnen). Die Summenzeile ist reiner Text.

Eine Zeile auf einem inzwischen deaktivierten Konsolidierungskonto zählt weiterhin, unter der Konsolidierungszeile dieses Kontos. Kontonamen und -nummern werden nur angezeigt, wenn Sie den [Kontenplan](chart-of-accounts.md) lesen dürfen; ohne diesen Zugriff erscheinen alle Zeilen stattdessen unter „Nicht zugeordnet“ (die Summen bleiben richtig, nur die Aufteilung nach Konto ist ausgeblendet). Positionen ohne Konsolidierungskonto erscheinen ebenfalls als „Nicht zugeordnet“. Die Konsolidierungskonten sind die Konten Ihres [Konsolidierungskontenplans](chart-of-accounts.md#der-konsolidierungskontenplan).

---

## Analysedimensionen

Zeigen Sie OPEX- oder CAPEX-Budgetdaten gruppiert nach den Werten einer Analysedimension. Das Layout entspricht dem Bericht Konsolidierungskonten. Siehe [Analysedimensionen](analytics.md), um Dimensionen und Werte einzurichten.

### Steuerungen

- **Positionstyp**: OPEX oder CAPEX (siehe [OPEX oder CAPEX wählen](#opex-oder-capex-wahlen))
- **Messgröße**: **Betrag** oder **VZÄ** (siehe [Betrag oder VZÄ wählen](#betrag-oder-vza-wahlen))
- **Dimension**: die Dimension, nach der der Bericht gruppiert. Sie erscheint, wenn Sie zwei oder mehr aktivierte Dimensionen haben, und der Bericht öffnet mit der Standarddimension. Die Seitenadresse speichert Ihre Wahl, sodass ein gespeicherter oder geteilter Link mit derselben Dimension öffnet
- **Startjahr** und **Endjahr**: Vorheriges, aktuelles oder nächstes Jahr
- **Kennzahl**: Jede angezeigte Budgetspalte. Beginnt mit der Standardspalte
- **Diagrammtyp**: Kreisdiagramm oder horizontales Balkendiagramm (nur Einzeljahr)
- **Werte ausschließen**: Mehrfachauswahl mit Autovervollständigung zum Ausschließen bestimmter Werte der gewählten Dimension. Ein Wechsel des Positionstyps oder der Dimension leert die Auswahl
- **Kostenstelle**, **Run oder Build**, **Positionen** und die Filter nach Analysedimension: Siehe [Filter nach Kostenstelle, Run oder Build und Analysedimensionen](#filter-nach-kostenstelle-run-oder-build-und-analysedimensionen)

Untertitel, Diagrammtitel und erste Tabellenspalte nennen die gewählte Dimension, zum Beispiel „OPEX nach Nature“.

### Was Sie sehen

**Einzeljahr-Modus**:

- Kreis- oder Balkendiagramm der Summen nach Wert
- Fußnote mit der Kennzahl-Summe

**Mehrjahr-Modus**:

- Liniendiagramm mit einer Serie pro Wert

**Tabelle**: Eine Zeile pro Wert mit Jahresspalten. Eine angeheftete Summenzeile unten. Zeilen ohne Wert in der gewählten Dimension erscheinen als „Nicht zugeordnet“.

Ein Wert öffnet die Liste seiner Positionen in einem neuen Tab („Nicht zugeordnet“: die Positionen ohne Wert). Mit der Messgröße **VZÄ** zeigt die Liste die Positionen des Werts, die VZÄ melden. Siehe [Die Liste aus einem Bericht öffnen](#die-liste-aus-einem-bericht-offnen). Die Summenzeile ist reiner Text.

---

## Personal nach Monat

Sehen Sie, wie viele Personen jeder Teil des Budgets Monat für Monat plant. Der Bericht liest die monatlichen VZÄ, die die Zeilen mit Menge und Preis einer Budgetspalte melden. Siehe [Menge und Preis](opex.md#menge-und-preis) und [VZÄ](opex.md#vza).

### Steuerungen

- **Positionstyp**: OPEX oder CAPEX (siehe [OPEX oder CAPEX wählen](#opex-oder-capex-wahlen))
- **Kostenstelle**, **Run oder Build**, **Positionen** und die Filter nach Analysedimension: Siehe [Filter nach Kostenstelle, Run oder Build und Analysedimensionen](#filter-nach-kostenstelle-run-oder-build-und-analysedimensionen)
- **Jahr**: Vorheriges, aktuelles oder nächstes Jahr
- **Spalte**: Jede angezeigte Budgetspalte. Beginnt mit der Standardspalte
- **Gruppieren nach**: **Kostenstelle** (Standard), **Position**, **Lieferant** oder **Analysedimension**
- **Dimension**: die Dimension, nach der der Bericht gruppiert, bei **Analysedimension**. Sie erscheint, wenn Sie zwei oder mehr aktivierte Dimensionen haben, und der Bericht öffnet mit der Standarddimension

Die Seitenadresse speichert die Gruppierung (`?group=item`, `?group=supplier` oder `?group=axis:<dimension id>`), sodass ein gespeicherter oder geteilter Link mit derselben Gruppierung öffnet. Ohne diesen Parameter gruppiert der Bericht nach Kostenstelle.

### Was Sie sehen

**Diagramm**: Gestapelte Flächen über die zwölf Monate, eine für jede der acht größten Gruppen nach Durchschnitt. Die übrigen Gruppen ergeben zusammen eine Fläche **Sonstige**. Der Titel nennt Typ, Gruppierung, Spalte und Jahr, zum Beispiel „OPEX-Personal nach Kostenstelle, Budget 2026“. Fahren Sie über einen Monat, um die VZÄ einer Gruppe zu lesen.

**Tabelle**: Eine Zeile pro Gruppe mit monatlichen VZÄ, der größte Durchschnitt zuerst:

- Die Gruppe: eine Kostenstelle, eine Position, ein Lieferant oder ein Wert der Dimension. Positionen ohne Kostenstelle erscheinen als „Keine Kostenstelle“, ohne Lieferant als „Kein Lieferant“ und ohne Wert in der Dimension als „Kein Wert“
- Eine Spalte pro Monat
- **Durchschnitt**: die Summe der zwölf Monate geteilt durch 12. Das sind die durchschnittlichen VZÄ über das ganze Jahr, die die Spalte meldet
- **Spitze**: der höchste Monat

Eine angeheftete Zeile **Gesamt** zeigt die Monatssummen, ihren Durchschnitt und ihre Spitze. Werte erscheinen mit zwei Dezimalstellen. Es zählen nur gemeldete VZÄ: Positionen ohne Zeilen mit Menge und Preis in der Spalte bleiben unberücksichtigt.

Der Name einer Gruppe ist ein Link, der sich in einem neuen Tab öffnet. Eine Position öffnet ihre Seite. Eine Kostenstelle, ein Lieferant oder ein Wert öffnet die OPEX- oder CAPEX-Liste mit den Positionen der Gruppe, die VZÄ melden, im Zeitraum des Berichts und eingegrenzt durch die Filterleiste (siehe [Die Liste aus einem Bericht öffnen](#die-liste-aus-einem-bericht-offnen)). „Keine Kostenstelle“, „Kein Lieferant“ und „Kein Wert“ öffnen die Positionen ohne Angabe. Die Zeile **Gesamt** ist reiner Text. Der CSV-Export behält die Namen als reinen Text.

### Hinweise

Eine Zeile unter der Tabelle für jeden Fall, wenn er eintritt:

- „2 Positionen melden 1,50 VZÄ, ihr Betrag folgt aber nicht mehr ihren Zeilen.“ Der Betrag wurde verteilt, seine Monate wurden von Hand bearbeitet oder die Spalte wurde kopiert. Diese Zeile umfasst die Positionen mit Monatsdetail, und ihre VZÄ zählen weiterhin in den Monaten. Positionen ohne Monatsdetail erscheinen nur in der nächsten Zeile. Siehe [Betrag oder VZÄ wählen](#betrag-oder-vza-wahlen).
- „1 Position meldet 3,00 VZÄ ohne Monatsdetail. Sie ist nicht in den Monaten enthalten.“ Diese Positionen melden VZÄ für das ganze Jahr, aber keine VZÄ pro Monat. Sie fehlen in den Monaten, im Durchschnitt und in der Spitze.

### Export

- **Tabelle als CSV exportieren**: Der Dateiname nennt Typ, Jahr, Spalte und Gruppierung, zum Beispiel `staffing-opex-2026-budget-cost-center.csv`
- **Diagramm als PNG exportieren**: Gleicher Name, als PNG-Bild
- **Drucken / Als PDF speichern**

---

## Kosten pro VZÄ

Sehen Sie, was ein VZÄ in jedem Teil des Budgets kostet und wie sich diese Kosten über Budgetspalten und Jahre entwickeln. Der Bericht teilt die Kosten der Zeilen mit Menge und Preis in Personen oder Tagen durch ihre VZÄ. Er kann auch den durchschnittlichen Tagessatz der pro Tag bepreisten Zeilen zeigen (siehe [Tagessatz](#tagessatz)). Siehe [Menge und Preis](opex.md#menge-und-preis) und [VZÄ](opex.md#vza).

### Steuerungen

- **Positionstyp**: OPEX oder CAPEX (siehe [OPEX oder CAPEX wählen](#opex-oder-capex-wahlen))
- **Kostenstelle**, **Run oder Build**, **Positionen** und die Filter nach Analysedimension: Siehe [Filter nach Kostenstelle, Run oder Build und Analysedimensionen](#filter-nach-kostenstelle-run-oder-build-und-analysedimensionen)
- **Gruppieren nach** und **Dimension**: dieselben Optionen wie in [Personal nach Monat](#personal-nach-monat). Die Seitenadresse speichert die Gruppierung auf dieselbe Weise
- **Anzeige**: **Kosten pro VZÄ** (Standard) oder **Tagessatz**. Beim Wechsel bleiben Typ, Gruppierung, Paare und Filter erhalten. Die Seitenadresse speichert den Tagessatz (`?view=rate`), sodass ein gespeicherter oder geteilter Link damit öffnet
- **Spalten**: ein bis vier Paare aus einem Jahr und einer Budgetspalte. Die Jahre reichen von zwei Jahren zurück bis zwei Jahre voraus. **Hinzufügen** fügt ein Paar hinzu, die Schaltfläche zum Entfernen neben einem Paar entfernt es. Der Bericht öffnet mit der Standardspalte für das letzte und das laufende Jahr. Tabelle und Diagramm zeigen die Paare in chronologischer Reihenfolge

### Was gezählt wird

- Die Kosten und die VZÄ der Zeilen in Personen oder Tagen. Zeilen in Stück bleiben bei beiden unberücksichtigt.
- Der Bericht liest die Ergebnisse der Zeilen, auch wenn der Betrag der Spalte ihnen nicht mehr folgt (der Betrag wurde verteilt, seine Monate wurden von Hand bearbeitet oder die Spalte wurde kopiert). Die Kosten sind dann die Kosten der Zeilen.
- Die Kosten werden zum Kurs der Version des jeweiligen Jahres in die Berichtswährung umgerechnet, wie jeder Betrag in den Berichten.
- Positionen, die VZÄ ohne Zeilendetails melden, bleiben unberücksichtigt. Ein Hinweis nennt sie (siehe unten).

### Was Sie sehen

**Tabelle**: Eine Zeile pro Gruppe mit Personal-VZÄ in mindestens einem Paar, die meisten VZÄ zuerst. Verglichen werden die VZÄ des frühesten Paars, in dem eine Gruppe Personal-VZÄ hat, sodass ein Budget, das nur für dieses Jahr Personal plant, trotzdem nach VZÄ sortiert ist. Ohne Personal-VZÄ folgen die Zeilen den Namen. Jedes Paar hat drei Spalten unter seinem Namen, zum Beispiel „Budget 2026“:

- **VZÄ**: die durchschnittlichen VZÄ der Zeilen über das ganze Jahr
- **Personalkosten**: die Kosten derselben Zeilen für das Jahr, in der Berichtswährung
- **Kosten pro VZÄ**: die Personalkosten geteilt durch die VZÄ. Die Zelle ist leer, wenn die VZÄ 0 sind oder die Gruppe in diesem Paar keine Personalzeilen hat

Die Gruppen heißen wie in Personal nach Monat („Keine Kostenstelle“, „Kein Lieferant“, „Kein Wert“). Eine angeheftete Zeile **Gesamt** zeigt für jedes Paar die VZÄ gesamt, die Personalkosten gesamt und die Personalkosten gesamt geteilt durch die VZÄ gesamt.

In beiden Ansichten öffnet der Name einer Gruppe ihre Position oder die Liste der Positionen der Gruppe, die VZÄ melden, in einem neuen Tab, wie in [Personal nach Monat](#personal-nach-monat).

**Diagramm**: Horizontale Balken der Kosten pro VZÄ, ein Balken pro Paar. Die erste Kategorie ist die Summe, gefolgt von den ersten zehn Gruppen der Tabelle. Der Titel nennt Typ und Gruppierung, zum Beispiel „OPEX-Kosten pro VZÄ nach Kostenstelle“. Fahren Sie über einen Balken, um Gruppe, Paar, Kosten pro VZÄ, VZÄ und Personalkosten zu lesen.

### Hinweise

Eine Zeile unter der Tabelle für jeden Fall, wenn er eintritt. Jede Zeile nennt die betroffenen Paare:

- „Der Betrag folgt nicht mehr den Zeilen bei: Budget 2026 (2 Positionen, 1,50 VZÄ). Diese Zahlen verwenden die Kosten ihrer Zeilen.“ Diese Spalten zählen mit den Kosten ihrer Zeilen. Siehe [Betrag oder VZÄ wählen](#betrag-oder-vza-wahlen).
- „Keine Zeilendetails bei: Budget 2025 (1 Position, 0,50 VZÄ). Sie fließen nicht in diese Zahlen ein.“ Diese Positionen melden VZÄ für das ganze Jahr, aber kein Ergebnis pro Zeile, sodass der Bericht ihre Kosten nicht lesen kann.

### Tagessatz

Wählen Sie **Anzeige** > **Tagessatz**, um anstelle der Kosten pro VZÄ den durchschnittlichen Tagessatz jeder Gruppe zu sehen.

- Nur die pro Tag bepreisten Zeilen zählen: Personen mit Preis pro Tag und Tagespakete. Der Tagessatz entspricht ihren Kosten geteilt durch die Tage, die sie einkaufen, sodass jede Zeile nach ihren Tagen gewichtet wird.
- Pro Monat bepreiste Zeilen haben keinen Tagessatz. Sie bleiben unberücksichtigt, und ein Hinweis nennt ihre Kosten (siehe unten).
- Wie bei den Kosten pro VZÄ liest der Bericht die Ergebnisse der Zeilen und rechnet die Kosten in die Berichtswährung um.

**Tabelle**: Eine Zeile pro Gruppe mit Tagen in mindestens einem Paar, die meisten Tage zuerst. Verglichen werden die Tage des frühesten Paars, in dem eine Gruppe Tage hat. Jedes Paar hat drei Spalten unter seinem Namen:

- **Tage**: die Tage, die die pro Tag bepreisten Zeilen einkaufen
- **Kosten der Tage**: die Kosten derselben Zeilen für das Jahr, in der Berichtswährung
- **Tagessatz**: die Kosten der Tage geteilt durch die Tage. Die Zelle ist leer, wenn die Tage 0 sind oder die Gruppe in diesem Paar keine pro Tag bepreisten Zeilen hat

Eine angeheftete Zeile **Gesamt** zeigt für jedes Paar die Tage gesamt, die Kosten der Tage gesamt und die Kosten der Tage gesamt geteilt durch die Tage gesamt.

**Diagramm**: Dieselben horizontalen Balken, mit dem Tagessatz. Der Titel nennt Typ und Gruppierung, zum Beispiel „OPEX-Tagessatz nach Kostenstelle“. Fahren Sie über einen Balken, um Gruppe, Paar, Tagessatz, Tage und Kosten der Tage zu lesen.

**Hinweise**: Die beiden Hinweise oben und eine weitere Zeile, wenn Zeilen in Personen pro Monat bepreist sind: „Monatlich bepreiste Zeilen sind nicht im Tagessatz enthalten: Budget 2026 (180 000).“ Der Betrag entspricht den Kosten dieser Zeilen in jedem betroffenen Paar, in der Berichtswährung.

### Export

- **Tabelle als CSV exportieren**: Der Dateiname nennt Typ, Gruppierung und das erste Paar, zum Beispiel `cost-per-fte-opex-cost-center-2025-budget.csv`. Beim Tagessatz beginnt er mit `daily-rate`, zum Beispiel `daily-rate-opex-cost-center-2025-budget.csv`
- **Diagramm als PNG exportieren**: Gleicher Name, als PNG-Bild
- **Drucken / Als PDF speichern**

---

## Gemeinsame Funktionen

Jeder Bericht bietet diese Funktionen über die gemeinsame Symbolleiste:

### Exportoptionen

- **Tabelle als CSV exportieren** (Download-Symbol): Lädt die Primärtabellendaten herunter
- **Diagramm als PNG exportieren** (Bild-Symbol): Lädt das Diagramm als PNG-Bild herunter
- **Drucken / Als PDF speichern** (Druck-Symbol): Öffnet den Browser-Druckdialog. Sie können auch `?print=1` an jede Bericht-URL anhängen, um den Druck beim Laden automatisch auszulösen.

Exportierte Dateinamen enthalten den Spaltennamen, zum Beispiel `top10-opex-2026-budget-bar.png`. Mit der Messgröße VZÄ enden sie auf `-fte`.

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
