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
| **Globale Leistungsverrechnung** | Unternehmensebene: Zuordnungssummen, KPIs und konzerninterne Flüsse |
| **Leistungsverrechnung pro Unternehmen** | Einzelunternehmen-Detailansicht mit Abteilungen, Budgetzeilen und KPIs |
| **Top-Zeilen** | Größte Budgetzeilen für ein ausgewähltes Jahr (anpassbare Top-N-Anzahl) |
| **Top Anstieg / Rückgang** | Größte Veränderungen zwischen zwei Budgetspalten (anpassbare Top-N-Anzahl) |
| **Budgetvergleich** | Budgetkennzahlen über einen Jahresbereich vergleichen |
| **Budgetspaltenvergleich** | Bis zu 10 Jahr+Spalten-Kombinationen auswählen |
| **Konsolidierungskonten** | Budget gruppiert nach Konsolidierungskonto |
| **Analysedimensionen** | Budget gruppiert nach Analysedimension |
| **Personal nach Monat** | Monatliche VZÄ nach Kostenstelle, Budgetzeile, Lieferant oder Analysedimension |
| **Kosten pro VZÄ** | Jährliche Kosten eines VZÄ oder durchschnittlicher Tagessatz, nach Kostenstelle, Budgetzeile, Lieferant oder Analysedimension, über Budgetspalten und Jahre |

### Typ der Zeilen wählen

**Top-Zeilen**, **Top Anstieg / Rückgang**, **Budgetvergleich**, **Budgetspaltenvergleich**, **Konsolidierungskonten**, **Analysedimensionen**, **Personal nach Monat** und **Kosten pro VZÄ** beginnen jeweils mit den Tabs **Alle**, **OPEX** und **CAPEX**, dem ersten Steuerelement der Filterleiste.

- Der Bericht öffnet sich auf **Alle**: die OPEX- und CAPEX-Zeilen zusammen. **OPEX** oder **CAPEX** behält die Zeilen dieses Typs. Alle drei erfordern Lesezugriff auf Budgetzeilen (`budget:reader`). Ohne diesen Zugriff sind die Tabs deaktiviert.
- Die Seitenadresse behält den gewählten Typ (`?scope=all`, `?scope=opex` oder `?scope=capex`). Ein gespeicherter oder geteilter Link öffnet sich daher auf demselben Typ.
- Untertitel und Diagrammtitel nennen den Typ. So zeigt ein Ausdruck oder ein exportiertes PNG, welche Zeilen es abdeckt.
- Ein Wechsel des Typs leert die ausgeschlossenen Budgetzeilen.

Die beiden Leistungsverrechnungsberichte haben dieselben Registerkarten **Alle**, **OPEX** und **CAPEX** und öffnen sich auf **OPEX**. Siehe [Globale Leistungsverrechnung](#globale-leistungsverrechnung).

### Betrag oder VZÄ wählen

Die sechs Budgetberichte haben eine Auswahl **Messgröße**. Sie steht direkt nach den Tabs für den Typ. Sie bietet **Betrag** (Standard) und **VZÄ**. Die beiden Leistungsverrechnungsberichte haben keine Messgröße.

Mit **VZÄ** summiert ein Bericht Personen statt Geld:

- Jede Budgetspalte zeigt die durchschnittlichen VZÄ über das ganze Jahr, die ihre Zeilen mit Menge und Preis melden. Zeilen in Personen oder Tagen erhöhen die VZÄ. Zeilen in Stück zählen 0. Eine Spalte ohne Zeilen meldet keine VZÄ und bleibt unberücksichtigt: Es zählen nur gemeldete VZÄ. Siehe [Menge und Preis](budget-lines.md#menge-und-preis) und [VZÄ](budget-lines.md#vza).
- Ein Jahr oder eine Spalte, in der keine Budgetzeile VZÄ meldet, zeigt eine leere Zelle, ohne Balken oder Punkt im Diagramm.
- **Top-Zeilen**, **Konsolidierungskonten** und **Analysedimensionen** lassen Budgetzeilen und Gruppen ohne gemeldete VZÄ weg. Anteile sind Anteile an der VZÄ-Summe.
- **Top Anstieg / Rückgang** vergleicht die VZÄ der beiden Spalten Budgetzeile für Budgetzeile. Eine Budgetzeile, die nur auf einer Seite VZÄ meldet, zählt auf der anderen Seite 0.
- Werte erscheinen mit zwei Dezimalstellen. Spaltennamen und Diagrammtitel tragen den Zusatz VZÄ.
- Die Seitenadresse speichert die Messgröße (`?measure=fte`), sodass ein gespeicherter oder geteilter Link mit derselben Messgröße öffnet.
- Die Dateinamen exportierter PNG- und CSV-Dateien enden auf `-fte`.

Mit VZÄ warnt eine Zeile unter der Tabelle, wenn einige Budgetzeilen VZÄ in einer Spalte melden, deren Betrag den Mengen-und-Preis-Zeilen nicht mehr folgt. Das ist der Fall, wenn der Betrag verteilt wurde, seine Monate von Hand bearbeitet wurden oder die Spalte aus einer Spalte kopiert wurde, deren Zeilen nur als Referenz dienten. Die Zeile nennt pro Spalte und Jahr, wie viele Budgetzeilen und wie viele VZÄ betroffen sind. Bei mehreren Spalten lautet sie zum Beispiel: „Der Betrag folgt nicht mehr den Zeilen bei: Budget 2026 (2 Zeilen, 1,50 VZÄ), Budget 2027 (1 Zeile, 0,50 VZÄ).“ Bei einer Spalte lautet sie: „2 Zeilen melden 1,50 VZÄ, ihr Betrag folgt aber nicht mehr ihren Mengen-und-Preis-Zeilen.“ Ihre VZÄ zählen weiterhin. Die Zeile weist darauf hin, dass der Betrag der Spalte nicht den Kosten ihrer Zeilen entspricht.

### Budgetspalten in Berichten

Jede Spalten- oder Kennzahlauswahl bietet die Budgetspalten an, die Ihre Organisation anzeigt, unter ihren Namen und in der festen Spaltenreihenfolge. Prognose wird angeboten, wenn sie angezeigt wird. Ausgeblendete Spalten werden nicht angeboten. Jeder Bericht beginnt mit der Standardspalte, wie unten beschrieben. Budgetadministratoren legen die Namen, die angezeigten Spalten und die Standardspalte unter [Budgetspalten](budget-operations.md#budgetspalten) fest.

### Filter nach Kostenstelle, Run oder Build und Analysedimensionen

Die Budgetberichte (**Top-Zeilen**, **Top Anstieg / Rückgang**, **Budgetvergleich**, **Budgetspaltenvergleich**, **Konsolidierungskonten** und **Analysedimensionen**), **Personal nach Monat** und **Kosten pro VZÄ** lassen sich mit diesen Filtern auf einen Teil des Budgets eingrenzen:

- **Kostenstelle**: Wählen Sie eine Kostenstelle oder eine Gruppe. Eine Gruppe umfasst alles, was darunter liegt, einschließlich deaktivierter Kostenstellen, da deren Zeilen weiterhin zur Gruppe gehören. **Alle Kostenstellen** entfernt den Filter. Siehe [Kostenstellen](cost-centers.md).
- **Run oder Build**: **Alle**, **Run**, **Build** oder **Nicht festgelegt** für die Zeilen, die keines von beiden haben.
- **Zeilen**: **Alle Zeilen** oder **Zeilen mit VZÄ**. **Zeilen mit VZÄ** behält die Budgetzeilen, die in mindestens einer Budgetspalte eines beliebigen Jahres VZÄ melden. Der Filter wirkt mit beiden Messgrößen. Ein Betragsbericht, der auf **Zeilen mit VZÄ** eingegrenzt ist, vergleicht zum Beispiel die Beträge von Budget und Ist-Werte der Personalzeilen. Die Ist-Werte umfassen die ganze Budgetzeile.
- **Analysedimensionen**: ein Filter pro Dimension, nach ihr benannt. Die Standarddimension erscheint als **Analysedimension**, bis sie umbenannt wird. Wählen Sie einen Wert, **Kein Wert** für die Zeilen ohne Wert in dieser Dimension oder **Alle**, um den Filter zu entfernen. Jeder Filter bietet die Werte an, die die Zeilen des Berichts tragen. Siehe [Analysedimensionen](analytics.md).

Wann die Filter erscheinen:

- **Kostenstelle** erscheint, sobald Ihr Arbeitsbereich mindestens eine Kostenstelle oder Gruppe hat.
- **Run oder Build** erscheint, sobald eine Zeile des Berichts als **Run** oder **Build** markiert ist oder die Seitenadresse den Filter bereits enthält.
- **Zeilen** erscheint, sobald eine Budgetzeile des Berichts VZÄ meldet oder die Seitenadresse den Filter bereits enthält.
- Der Filter einer Dimension erscheint, sobald eine Zeile des Berichts einen Wert in dieser Dimension hat oder die Seitenadresse ihn bereits enthält. Deaktivierte Dimensionen haben keinen Filter. Ein Bericht zeigt nur die Dimensionen, die für die Zeilen gelten, die er abdeckt: Ein Wechsel des Typs ändert die Liste. Eine Dimension mit **Nur OPEX** hat in einem CAPEX-Bericht keinen Filter und umgekehrt. **Alle** zeigt die Dimensionen beider Typen. Siehe [OPEX- oder CAPEX-Dimensionen](analytics.md#opex-oder-capex-dimensionen).
- Ohne all diese zeigt die Filterleiste nur die eigenen Steuerelemente des Berichts.

So funktionieren sie:

- Die Filter wirken vor jeder Summe. Beträge, Anteile, Diagramme und Summen umfassen nur die verbleibenden Zeilen.
- Filter in mehreren Dimensionen werden kombiniert: Eine Zeile muss jedem von ihnen entsprechen.
- Die Listen der auszuschließenden Budgetzeilen, Konten und Werte bieten weiterhin alle Zeilen an.
- Die Seitenadresse speichert die Filter (`?costCenter=`, `?runBuild=`, `?fte=with` und `?analytics=`), sodass ein gespeicherter oder geteilter Link den Bericht bereits eingegrenzt öffnet. Nennt ein Link eine inzwischen deaktivierte oder gelöschte Dimension, wird dieser Teil ignoriert.
- Nennt der Link eine inzwischen gelöschte Kostenstelle oder konnten die Kostenstellen nicht geladen werden, zeigt der Bericht keine Zeilen und eine Textzeile: „Diese Kostenstelle existiert nicht mehr oder konnte nicht geladen werden." Klicken Sie auf **Filter entfernen**, um den Bericht wieder zu sehen.
- Enthält der Link einen Analysefilter und konnten die Dimensionen nicht geladen werden, zeigt der Bericht keine Zeilen und eine Textzeile: „Der Analysefilter konnte nicht angewendet werden. Entfernen Sie ihn oder versuchen Sie es erneut.“ Klicken Sie auf **Filter entfernen**, um die Analysefilter zu entfernen und den Bericht wieder zu sehen.
- Die beiden Leistungsverrechnungsberichte haben keine solchen Filter und sind nicht betroffen.

### Beträge ohne Wechselkurs

Hat die Währung einer Zeile für ein Jahr keinen Wechselkurs, lassen die Budgetberichte, **Personal nach Monat** und **Kosten pro VZÄ** die Beträge dieser Zeile für das Jahr bei ihren Zahlen aus. Ein einzeiliger Hinweis oben im Bericht nennt sie, zum Beispiel „3 Zeilen ohne Wechselkurs ausgeschlossen: USD 2026.“ Benutzer der Budgetadministration auf Administratorebene sehen außerdem **Kurs eingeben**, das die Währungseinstellungen beim fehlenden Kurs öffnet. Nennt der Hinweis nur eine Währung und ein Jahr, öffnet sich direkt der Dialog für den manuellen Kurs. Der Hinweis wird nicht gedruckt. Siehe [Manuelle Kurse](currencies.md#manuelle-kurse).

Die beiden Leistungsverrechnungsberichte lassen diese Beträge bei allen Zahlen aus: bezahlt, verbraucht, Abteilungen und konzerninterne Flüsse. So bleibt jeder Bericht für das, was er zählt, ausgeglichen. Derselbe Hinweis erscheint über dem Bericht.

### Die Liste aus einem Bericht öffnen

In **Personal nach Monat**, **Kosten pro VZÄ**, **Analysedimensionen** und **Konsolidierungskonten** ist der Name einer Gruppe ein Link, der die [Liste der Budgetzeilen](budget-lines.md) in einem neuen Tab öffnet, mit den Budgetzeilen, die die Zeile zählt:

- die Budgetzeilen der Gruppe, eingegrenzt durch die Filterleiste und durch den Filter **Typ**, wenn der Bericht auf **OPEX** oder **CAPEX** steht;
- alle Status (**Anzeigen: Alle**), mit einem Filter **Ende der Gültigkeit** „leer oder nach dem 31. Dezember“ des Jahres vor dem ersten Jahr des Berichts. Ein Bericht zählt die Budgetzeilen, die am 1. Januar seines ersten Jahres noch aktiv waren, auch die seither deaktivierten;
- in **Personal nach Monat** und **Kosten pro VZÄ** sowie mit der Messgröße **VZÄ** nur die Budgetzeilen, die VZÄ melden (der Filter **VZÄ gemeldet**).

Die gefilterten Spalten erscheinen für diesen Besuch direkt nach dem Positionsnamen, damit Sie sehen, warum die Liste eingegrenzt ist. Ein Konsolidierungskonto filtert auf seine Konten, ohne eigene Spalte.

Diese Liste ist eine Ansicht des Berichts. Was Sie darin ändern, bleibt in ihrer Adresse, und **Budgetzeilen**, danach über das Menü geöffnet, zeigt Ihre eigene Sortierung, Suche und Filter.

---

## Globale Leistungsverrechnung

Zeigen Sie Kostenzuordnungen über alle Unternehmen hinweg mit Zusammenfassungs-KPIs und konzerninternen Flüssen.

### Steuerungen

- **Zeilentyp**: **Alle**, **OPEX** oder **CAPEX**. Der Bericht öffnet sich auf **OPEX**. Bei **Alle** oder **CAPEX** sagt ein Hinweis über den Ergebnissen „CAPEX-Zeilen zählen mit ihrem Betrag des Jahres, ohne Abschreibung.“
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
| Umsatz | Jahresumsatz, in Millionen der Berichtswährung |
| IT-Kosten vs. Umsatz | Prozentsatz, beide Werte in der Berichtswährung |
| IT-Kosten pro Benutzer | Betrag geteilt durch Mitarbeiterzahl |
| IT-Kosten pro IT-Benutzer | Betrag geteilt durch IT-Benutzer |

Eine Summenzeile ist unten angeheftet.

### Export

- **Tabelle als CSV exportieren** (Download-Symbol): Exportiert das detaillierte Zuordnungs-Grid
- **Diagramm als PNG exportieren** (Bild-Symbol): Exportiert das Balkendiagramm
- **Drucken / Als PDF speichern** (Druck-Symbol)

---

## Leistungsverrechnung pro Unternehmen

Detailansicht der Leistungsverrechnungs-Zuordnungen eines einzelnen Unternehmens über Abteilungen, Budgetzeilen, konzerninterne Flüsse und KPIs.

### Steuerungen

- **Zeilentyp**: **Alle**, **OPEX** oder **CAPEX**, wie in der globalen Leistungsverrechnung. Der Bericht öffnet sich auf **OPEX**
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

**Umsatz in den Leistungsverrechnungsberichten**: Jedes Unternehmen erfasst seinen Umsatz in Millionen seiner Basiswährung. Beide Berichte rechnen ihn zu den Kursen der Budgetversion des Jahres in die Berichtswährung um, wie die Beträge. Der Umsatz, das Verhältnis IT-Kosten vs. Umsatz und der Gesamtumsatz der KPI-Tabellen verwenden den umgerechneten Wert. Hat eine Währung für das Jahr keinen Kurs, bleiben die Unternehmen in dieser Währung aus den Umsatzkennzahlen heraus, und eine Warnung oben im Bericht nennt jedes von ihnen. Das globale Verhältnis IT-Kosten vs. Umsatz wird dann nur über die Unternehmen berechnet, deren Umsatz umgerechnet wurde, bei den Kosten wie beim Umsatz. KANAP ruft den fehlenden Kurs im Hintergrund ab.

**Abteilungs-Summen** (wenn aktiviert):

- Abteilungsname, Betrag, Anteil an Gesamtsumme, Mitarbeiterzahl, Kosten pro Benutzer
- „Gemeinkosten" aggregiert Zuordnungen ohne bestimmte Abteilung
- Horizontales Balkendiagramm neben der Tabelle

**Verrechnungspositionen** (wenn aktiviert):

- Positionsname, Zuordnungsmethode, Betrag, Anteil an Gesamtsumme
- Angeheftete Summenzeile unten
- Der Positionsname ist ein Link, der die Budgetzeile in einem neuen Tab öffnet. Gemeinkosten und Summen bleiben einfacher Text.

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

## Top-Zeilen

Identifizieren Sie Ihre größten Budgetzeilen für ein bestimmtes Jahr.

### Steuerungen

- **Zeilentyp**: **Alle**, **OPEX** oder **CAPEX** (siehe [Typ der Zeilen wählen](#typ-der-zeilen-wahlen))
- **Messgröße**: **Betrag** oder **VZÄ** (siehe [Betrag oder VZÄ wählen](#betrag-oder-vza-wahlen))
- **Jahr**: Vorheriges, aktuelles oder nächstes Jahr
- **Kennzahl**: Jede angezeigte Budgetspalte. Beginnt mit der Standardspalte
- **Top-Anzahl**: Wie viele Budgetzeilen angezeigt werden (Standard: 10, Minimum: 1)
- **Diagrammtyp**: Kreisdiagramm oder horizontales Balkendiagramm
- **Zeilen ausschließen**: Mehrfachauswahl mit Autovervollständigung zum Ausschließen bestimmter Budgetzeilen
- **Konten ausschließen**: Mehrfachauswahl mit Autovervollständigung zum Ausschließen bestimmter Konten
- **Kostenstelle**, **Run oder Build**, **Zeilen** und die Filter nach Analysedimension: Siehe [Filter nach Kostenstelle, Run oder Build und Analysedimensionen](#filter-nach-kostenstelle-run-oder-build-und-analysedimensionen)

### Was Sie sehen

**Diagramm**: Kreis- oder horizontales Balkendiagramm der Top-Zeilen. Sein Titel nennt den Typ, zum Beispiel „Top 10 CAPEX · Budget 2026".

**Tabellenspalten**:

- Budgetzeile
- Wert für die ausgewählte Kennzahl und das Jahr
- Anteil an Gesamtsumme (Prozentsatz)

Der Positionsname ist ein Link, der die Budgetzeile in einem neuen Tab öffnet.

**Zusammenfassungskarten unter der Tabelle**:

- **Top N gesamt**, mit ihrem Anteil an der gefilterten Summe, zum Beispiel „45 % der gefilterten Summe“
- Die Summe der ausgewählten Spalte über alle Budgetzeilen, beschriftet mit dem Spaltennamen, zum Beispiel **Budget, gesamt**

Die Fußnote des Diagramms nennt dieselbe Summe, zum Beispiel „Budget, gesamt: 1 234“.

### Anwendungsfall

Verwenden Sie diesen Bericht, um schnell zu erkennen, wohin der Großteil Ihres IT-Budgets fließt, und Kandidaten für Kostenoptimierung zu identifizieren.

---

## Top Anstieg / Rückgang

Identifizieren Sie die größten Veränderungen zwischen zwei Budgetspalten (jede Kombination aus Jahr und Kennzahl).

### Steuerungen

- **Zeilentyp**: **Alle**, **OPEX** oder **CAPEX** (siehe [Typ der Zeilen wählen](#typ-der-zeilen-wahlen))
- **Messgröße**: **Betrag** oder **VZÄ** (siehe [Betrag oder VZÄ wählen](#betrag-oder-vza-wahlen))
- **Quelljahr** und **Quellkennzahl**: Die Basisspalte zum Vergleich
- **Zieljahr** und **Zielkennzahl**: Die Zielspalte zum Vergleich
- **Top-Anzahl**: Wie viele Budgetzeilen pro Richtung angezeigt werden (Standard: 10)
- **Diagrammtyp**: Kreisdiagramm (nur eine Richtung) oder horizontales Balkendiagramm
- **Zeilen ausschließen**: Mehrfachauswahl mit Autovervollständigung zum Ausschließen bestimmter Budgetzeilen
- **Konten ausschließen**: Mehrfachauswahl mit Autovervollständigung zum Ausschließen bestimmter Konten
- **Richtung**: Tabs **Anstiege**, **Rückgänge** oder **Beide**
- **Kostenstelle**, **Run oder Build**, **Zeilen** und die Filter nach Analysedimension: Siehe [Filter nach Kostenstelle, Run oder Build und Analysedimensionen](#filter-nach-kostenstelle-run-oder-build-und-analysedimensionen)

Die Jahresauswahlen listen die Jahre, die Daten enthalten. Die Kennzahlauswahlen bieten die angezeigten Budgetspalten an. Der Bericht beginnt mit der Standardspalte des Vorjahres als Quelle und der Standardspalte des aktuellen Jahres als Ziel.

Wenn **Beide** ausgewählt ist, wird die Kreisdiagramm-Option deaktiviert und der Bericht wechselt automatisch zum Balkendiagramm.

### Was Sie sehen

**Diagramm**: Visualisierung der Top-Veränderungen. Sein Titel nennt den Typ, zum Beispiel „Top 10 OPEX-Anstiege".

**Tabellenspalten**:

- Budgetzeile
- Quellwert (vorher)
- Zielwert (aktuell)
- Delta (absolute Änderung)
- Prozentuale Steigerung

Der Positionsname ist ein Link, der die Budgetzeile in einem neuen Tab öffnet.

**Zusammenfassungskarten unter der Tabelle**:

- Auswahlsummen (Steigerungs- und/oder Rückgangsbeträge, mit Quell-/Zielsummen)
- Brutto-Veränderungen über alle Budgetzeilen (mit Abdeckungsprozentsatz)
- Netto-Steigerung oder -Rückgang über alle Budgetzeilen

### Anwendungsfall

Verwenden Sie diesen Bericht zur Identifizierung von Kostenüberschreitungen, zum Aufspüren von Einsparmöglichkeiten und zur Erklärung der Jahresvergleichsabweichung in Budget-Reviews.

---

## Budgetvergleich

Vergleichen Sie Budgetkennzahlen über mehrere Jahre in einem einzelnen Liniendiagramm. Die Adresse des früheren Berichts **Budgettrend (CAPEX)** öffnet diesen Bericht auf CAPEX.

### Steuerungen

- **Zeilentyp**: **Alle**, **OPEX** oder **CAPEX** (siehe [Typ der Zeilen wählen](#typ-der-zeilen-wahlen))
- **Messgröße**: **Betrag** oder **VZÄ** (siehe [Betrag oder VZÄ wählen](#betrag-oder-vza-wahlen))
- **Startjahr**: Beginn des Bereichs (aktuelles Jahr minus 2 bis plus 2)
- **Endjahr**: Ende des Bereichs
- **Kennzahlen**: Mehrfachauswahl aus den angezeigten Budgetspalten. Der Bericht beginnt mit der Standardspalte und der letzten angezeigten Spalte (Budget und Erwarteter Endwert mit den Standardeinstellungen). Wenn Sie alle Kennzahlen entfernen, wird die Standardspalte verwendet
- **Kostenstelle**, **Run oder Build**, **Zeilen** und die Filter nach Analysedimension: Siehe [Filter nach Kostenstelle, Run oder Build und Analysedimensionen](#filter-nach-kostenstelle-run-oder-build-und-analysedimensionen)

### Was Sie sehen

**Diagramm**: Liniendiagramm mit einer Serie pro ausgewählter Kennzahl, aufgetragen über den Jahresbereich.

**Tabelle**: Eine Zeile pro ausgewählter Kennzahl mit Jahresspalten, die Summen zeigen.

### Export

- **Tabelle als CSV exportieren**
- **Diagramm als PNG exportieren**
- **Drucken / Als PDF speichern**

---

## Budgetspaltenvergleich

Vergleichen Sie flexibel bis zu 10 Jahr+Spalten-Kombinationen.

### Steuerungen

- **Zeilentyp**: **Alle**, **OPEX** oder **CAPEX** (siehe [Typ der Zeilen wählen](#typ-der-zeilen-wahlen))
- **Messgröße**: **Betrag** oder **VZÄ** (siehe [Betrag oder VZÄ wählen](#betrag-oder-vza-wahlen))
- **Auswahlen**: Jede Auswahl hat eine Jahrauswahl und eine Spaltenauswahl mit den angezeigten Budgetspalten. Der Bericht beginnt mit zwei Auswahlen: der Standardspalte des aktuellen Jahres und des nächsten Jahres. **Hinzufügen** fügt die Standardspalte des aktuellen Jahres hinzu, und das Löschsymbol entfernt eine Auswahl. Maximum von 10 Auswahlen; Minimum von 1.
- **Jahresgruppierung** (Kontrollkästchen): Wenn aktiviert und mindestens zwei Jahre eine Kennzahl teilen, wechselt zu einem gruppierten Liniendiagramm mit einer Serie pro Kennzahl und Jahren auf der X-Achse. Wenn deaktiviert, zeigt ein flaches Liniendiagramm mit jeder Auswahl als Datenpunkt.
- **Kostenstelle**, **Run oder Build**, **Zeilen** und die Filter nach Analysedimension: Siehe [Filter nach Kostenstelle, Run oder Build und Analysedimensionen](#filter-nach-kostenstelle-run-oder-build-und-analysedimensionen)

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

Zeigen Sie Budgetdaten gruppiert nach Konsolidierungskonto, wobei sich der Diagrammtyp an den Jahresbereich anpasst.

### Steuerungen

- **Zeilentyp**: **Alle**, **OPEX** oder **CAPEX** (siehe [Typ der Zeilen wählen](#typ-der-zeilen-wahlen))
- **Messgröße**: **Betrag** oder **VZÄ** (siehe [Betrag oder VZÄ wählen](#betrag-oder-vza-wahlen))
- **Startjahr** und **Endjahr**: Vorheriges, aktuelles oder nächstes Jahr
- **Kennzahl**: Jede angezeigte Budgetspalte. Beginnt mit der Standardspalte
- **Diagrammtyp**: Kreisdiagramm oder horizontales Balkendiagramm (nur verfügbar bei Auswahl eines einzelnen Jahres)
- **Konten ausschließen**: Mehrfachauswahl mit Autovervollständigung zum Ausschließen bestimmter Konten. Bietet jedes vom Bericht verwendete Konto nach Name und Nummer an, unabhängig davon, ob Sie den Kontenplan öffnen können. Die Liste beginnt mit „Nicht zugeordnet“: Wenn Sie diesen Eintrag wählen, entfallen die Zeilen ohne Konsolidierungskonto
- **Kostenstelle**, **Run oder Build**, **Zeilen** und die Filter nach Analysedimension: Siehe [Filter nach Kostenstelle, Run oder Build und Analysedimensionen](#filter-nach-kostenstelle-run-oder-build-und-analysedimensionen)

### Was Sie sehen

**Einzeljahr-Modus**:

- Kreis- oder horizontales Balkendiagramm der Summen nach Konsolidierungskonto
- Fußnote mit der Summe der ausgewählten Kennzahl

**Mehrjahr-Modus**:

- Liniendiagramm mit einer Serie pro Konsolidierungskonto über Jahre

**Tabelle**: Eine Zeile pro Konsolidierungskonto mit Jahresspalten. Eine angeheftete Summenzeile unten summiert alle Gruppen. Ein Konsolidierungskonto öffnet die Liste der Budgetzeilen auf seinen Konten in einem neuen Tab („Nicht zugeordnet“: die Budgetzeilen, deren Konto kein Konsolidierungskonto hat, und die Budgetzeilen ohne Konto). Siehe [Die Liste aus einem Bericht öffnen](#die-liste-aus-einem-bericht-offnen). Die Summenzeile ist reiner Text.

Eine Zeile auf einem inzwischen deaktivierten Konsolidierungskonto zählt weiterhin, unter der Konsolidierungszeile dieses Kontos. Kontonamen und -nummern werden nur angezeigt, wenn Sie den [Kontenplan](chart-of-accounts.md) lesen dürfen; ohne diesen Zugriff erscheinen alle Zeilen stattdessen unter „Nicht zugeordnet“ (die Summen bleiben richtig, nur die Aufteilung nach Konto ist ausgeblendet). Budgetzeilen ohne Konsolidierungskonto erscheinen ebenfalls als „Nicht zugeordnet“. Die Konsolidierungskonten sind die Konten Ihres [Konsolidierungskontenplans](chart-of-accounts.md#der-konsolidierungskontenplan).

---

## Analysedimensionen

Zeigen Sie Budgetdaten gruppiert nach den Werten einer Analysedimension. Das Layout entspricht dem Bericht Konsolidierungskonten. Siehe [Analysedimensionen](analytics.md), um Dimensionen und Werte einzurichten.

### Steuerungen

- **Zeilentyp**: **Alle**, **OPEX** oder **CAPEX** (siehe [Typ der Zeilen wählen](#typ-der-zeilen-wahlen))
- **Messgröße**: **Betrag** oder **VZÄ** (siehe [Betrag oder VZÄ wählen](#betrag-oder-vza-wahlen))
- **Dimension**: die Dimension, nach der der Bericht gruppiert. Sie bietet die aktivierten Dimensionen an, die für die gewählte Positionsart verwendet werden, erscheint, wenn es zwei oder mehr gibt, und der Bericht öffnet mit der Standarddimension. Wechseln Sie zu einer Positionsart, die die gewählte Dimension nicht verwendet, kehrt der Bericht zur Standarddimension zurück. Die Seitenadresse speichert Ihre Wahl, sodass ein gespeicherter oder geteilter Link mit derselben Dimension öffnet
- **Startjahr** und **Endjahr**: Vorheriges, aktuelles oder nächstes Jahr
- **Kennzahl**: Jede angezeigte Budgetspalte. Beginnt mit der Standardspalte
- **Diagrammtyp**: Kreisdiagramm oder horizontales Balkendiagramm (nur Einzeljahr)
- **Werte ausschließen**: Mehrfachauswahl mit Autovervollständigung zum Ausschließen bestimmter Werte der gewählten Dimension. Die Liste bietet die Werte an, die für den gewählten Zeilentyp verwendet werden, dazu die Werte, die die Zeilen des Berichts haben. Die Liste beginnt mit „Nicht zugeordnet“: Wenn Sie diesen Eintrag wählen, entfallen die Zeilen ohne Wert in der Dimension. Ein Wechsel des Zeilentyps oder der Dimension leert die Auswahl
- **Kostenstelle**, **Run oder Build**, **Zeilen** und die Filter nach Analysedimension: Siehe [Filter nach Kostenstelle, Run oder Build und Analysedimensionen](#filter-nach-kostenstelle-run-oder-build-und-analysedimensionen)

Untertitel, Diagrammtitel und erste Tabellenspalte nennen die gewählte Dimension, zum Beispiel „OPEX nach Nature“.

### Was Sie sehen

**Einzeljahr-Modus**:

- Kreis- oder Balkendiagramm der Summen nach Wert
- Fußnote mit der Kennzahl-Summe

**Mehrjahr-Modus**:

- Liniendiagramm mit einer Serie pro Wert

**Tabelle**: Eine Zeile pro Wert mit Jahresspalten. Eine angeheftete Summenzeile unten. Zeilen ohne Wert in der gewählten Dimension erscheinen als „Nicht zugeordnet“.

Ein Wert öffnet die Liste seiner Budgetzeilen in einem neuen Tab („Nicht zugeordnet“: die Budgetzeilen ohne Wert). Mit der Messgröße **VZÄ** zeigt die Liste die Budgetzeilen des Werts, die VZÄ melden. Siehe [Die Liste aus einem Bericht öffnen](#die-liste-aus-einem-bericht-offnen). Die Summenzeile ist reiner Text.

---

## Personal nach Monat

Sehen Sie, wie viele Personen jeder Teil des Budgets Monat für Monat plant. Der Bericht liest die monatlichen VZÄ, die die Zeilen mit Menge und Preis einer Budgetspalte melden. Siehe [Menge und Preis](budget-lines.md#menge-und-preis) und [VZÄ](budget-lines.md#vza).

### Steuerungen

- **Zeilentyp**: **Alle**, **OPEX** oder **CAPEX** (siehe [Typ der Zeilen wählen](#typ-der-zeilen-wahlen))
- **Kostenstelle**, **Run oder Build**, **Zeilen** und die Filter nach Analysedimension: Siehe [Filter nach Kostenstelle, Run oder Build und Analysedimensionen](#filter-nach-kostenstelle-run-oder-build-und-analysedimensionen)
- **Jahr**: Vorheriges, aktuelles oder nächstes Jahr
- **Spalte**: Jede angezeigte Budgetspalte. Beginnt mit der Standardspalte
- **Gruppieren nach**: **Kostenstelle** (Standard), **Zeile**, **Lieferant** oder **Analysedimension**
- **Dimension**: die Dimension, nach der der Bericht gruppiert, bei **Analysedimension**. Sie bietet die aktivierten Dimensionen an, die für die Zeilen des Berichts verwendet werden, und erscheint, wenn es zwei oder mehr gibt. Der Bericht öffnet mit der Standarddimension

Die Seitenadresse speichert die Gruppierung (`?group=item`, `?group=supplier` oder `?group=axis:<dimension id>`), sodass ein gespeicherter oder geteilter Link mit derselben Gruppierung öffnet. Ohne diesen Parameter gruppiert der Bericht nach Kostenstelle.

### Was Sie sehen

**Diagramm**: Gestapelte Flächen über die zwölf Monate, eine für jede der acht größten Gruppen nach Durchschnitt. Die übrigen Gruppen ergeben zusammen eine Fläche **Sonstige**. Der Titel nennt Typ, Gruppierung, Spalte und Jahr, zum Beispiel „OPEX-Personal nach Kostenstelle, Budget 2026“. Fahren Sie über einen Monat, um die VZÄ einer Gruppe zu lesen.

**Tabelle**: Eine Zeile pro Gruppe mit monatlichen VZÄ, der größte Durchschnitt zuerst:

- Die Gruppe: eine Kostenstelle, eine Budgetzeile, ein Lieferant oder ein Wert der Dimension. Budgetzeilen ohne Kostenstelle erscheinen als „Keine Kostenstelle“, ohne Lieferant als „Kein Lieferant“ und ohne Wert in der Dimension als „Kein Wert“
- Eine Spalte pro Monat
- **Durchschnitt**: die Summe der zwölf Monate geteilt durch 12. Das sind die durchschnittlichen VZÄ über das ganze Jahr, die die Spalte meldet
- **Spitze**: der höchste Monat

Eine angeheftete Zeile **Gesamt** zeigt die Monatssummen, ihren Durchschnitt und ihre Spitze. Werte erscheinen mit zwei Dezimalstellen. Es zählen nur gemeldete VZÄ: Budgetzeilen ohne Zeilen mit Menge und Preis in der Spalte bleiben unberücksichtigt.

Der Name einer Gruppe ist ein Link, der sich in einem neuen Tab öffnet. Eine Budgetzeile öffnet ihre Seite. Eine Kostenstelle, ein Lieferant oder ein Wert öffnet die Liste der Budgetzeilen mit den Budgetzeilen der Gruppe, die VZÄ melden, im Zeitraum des Berichts und eingegrenzt durch die Filterleiste (siehe [Die Liste aus einem Bericht öffnen](#die-liste-aus-einem-bericht-offnen)). „Keine Kostenstelle“, „Kein Lieferant“ und „Kein Wert“ öffnen die Budgetzeilen ohne Angabe. Die Zeile **Gesamt** ist reiner Text. Der CSV-Export behält die Namen als reinen Text.

### Hinweise

Eine Zeile unter der Tabelle für jeden Fall, wenn er eintritt:

- „2 Zeilen melden 1,50 VZÄ, ihr Betrag folgt aber nicht mehr ihren Mengen-und-Preis-Zeilen.“ Der Betrag wurde verteilt, seine Monate wurden von Hand bearbeitet oder die Spalte wurde kopiert. Diese Zeile umfasst die Budgetzeilen mit Monatsdetail, und ihre VZÄ zählen weiterhin in den Monaten. Budgetzeilen ohne Monatsdetail erscheinen nur in der nächsten Zeile. Siehe [Betrag oder VZÄ wählen](#betrag-oder-vza-wahlen).
- „1 Zeile meldet 3,00 VZÄ ohne Monatsdetail. Sie ist nicht in den Monaten enthalten.“ Diese Budgetzeilen melden VZÄ für das ganze Jahr, aber keine VZÄ pro Monat. Sie fehlen in den Monaten, im Durchschnitt und in der Spitze.

### Export

- **Tabelle als CSV exportieren**: Der Dateiname nennt Typ, Jahr, Spalte und Gruppierung, zum Beispiel `staffing-opex-2026-budget-cost-center.csv`
- **Diagramm als PNG exportieren**: Gleicher Name, als PNG-Bild
- **Drucken / Als PDF speichern**

---

## Kosten pro VZÄ

Sehen Sie, was ein VZÄ in jedem Teil des Budgets kostet und wie sich diese Kosten über Budgetspalten und Jahre entwickeln. Der Bericht teilt die Kosten der Zeilen mit Menge und Preis in Personen oder Tagen durch ihre VZÄ. Er kann auch den durchschnittlichen Tagessatz der pro Tag bepreisten Zeilen zeigen (siehe [Tagessatz](#tagessatz)). Siehe [Menge und Preis](budget-lines.md#menge-und-preis) und [VZÄ](budget-lines.md#vza).

### Steuerungen

- **Zeilentyp**: **Alle**, **OPEX** oder **CAPEX** (siehe [Typ der Zeilen wählen](#typ-der-zeilen-wahlen))
- **Kostenstelle**, **Run oder Build**, **Zeilen** und die Filter nach Analysedimension: Siehe [Filter nach Kostenstelle, Run oder Build und Analysedimensionen](#filter-nach-kostenstelle-run-oder-build-und-analysedimensionen)
- **Gruppieren nach** und **Dimension**: dieselben Optionen wie in [Personal nach Monat](#personal-nach-monat). Die Seitenadresse speichert die Gruppierung auf dieselbe Weise
- **Anzeige**: **Kosten pro VZÄ** (Standard) oder **Tagessatz**. Beim Wechsel bleiben Typ, Gruppierung, Paare und Filter erhalten. Die Seitenadresse speichert den Tagessatz (`?view=rate`), sodass ein gespeicherter oder geteilter Link damit öffnet
- **Spalten**: ein bis vier Paare aus einem Jahr und einer Budgetspalte. Die Jahre reichen von zwei Jahren zurück bis zwei Jahre voraus. **Hinzufügen** fügt ein Paar hinzu, die Schaltfläche zum Entfernen neben einem Paar entfernt es. Der Bericht öffnet mit der Standardspalte für das letzte und das laufende Jahr. Tabelle und Diagramm zeigen die Paare in chronologischer Reihenfolge

### Was gezählt wird

- Die Kosten und die VZÄ der Zeilen in Personen oder Tagen. Zeilen in Stück bleiben bei beiden unberücksichtigt.
- Der Bericht liest die Ergebnisse der Zeilen, auch wenn der Betrag der Spalte ihnen nicht mehr folgt (der Betrag wurde verteilt, seine Monate wurden von Hand bearbeitet oder die Spalte wurde kopiert). Die Kosten sind dann die Kosten der Zeilen.
- Die Kosten werden zum Kurs der Version des jeweiligen Jahres in die Berichtswährung umgerechnet, wie jeder Betrag in den Berichten.
- Budgetzeilen, die VZÄ ohne Zeilendetails melden, bleiben unberücksichtigt. Ein Hinweis nennt sie (siehe unten).

### Was Sie sehen

**Tabelle**: Eine Zeile pro Gruppe mit Personal-VZÄ in mindestens einem Paar, die meisten VZÄ zuerst. Verglichen werden die VZÄ des frühesten Paars, in dem eine Gruppe Personal-VZÄ hat, sodass ein Budget, das nur für dieses Jahr Personal plant, trotzdem nach VZÄ sortiert ist. Ohne Personal-VZÄ folgen die Zeilen den Namen. Jedes Paar hat drei Spalten unter seinem Namen, zum Beispiel „Budget 2026“:

- **VZÄ**: die durchschnittlichen VZÄ der Zeilen über das ganze Jahr
- **Personalkosten**: die Kosten derselben Zeilen für das Jahr, in der Berichtswährung
- **Kosten pro VZÄ**: die Personalkosten geteilt durch die VZÄ. Die Zelle ist leer, wenn die VZÄ 0 sind oder die Gruppe in diesem Paar keine Personalzeilen hat

Die Gruppen heißen wie in Personal nach Monat („Keine Kostenstelle“, „Kein Lieferant“, „Kein Wert“). Eine angeheftete Zeile **Gesamt** zeigt für jedes Paar die VZÄ gesamt, die Personalkosten gesamt und die Personalkosten gesamt geteilt durch die VZÄ gesamt.

In beiden Ansichten öffnet der Name einer Gruppe ihre Budgetzeile oder die Liste der Budgetzeilen der Gruppe, die VZÄ melden, in einem neuen Tab, wie in [Personal nach Monat](#personal-nach-monat).

**Diagramm**: Horizontale Balken der Kosten pro VZÄ, ein Balken pro Paar. Die erste Kategorie ist die Summe, gefolgt von den ersten zehn Gruppen der Tabelle. Der Titel nennt Typ und Gruppierung, zum Beispiel „OPEX-Kosten pro VZÄ nach Kostenstelle“. Fahren Sie über einen Balken, um Gruppe, Paar, Kosten pro VZÄ, VZÄ und Personalkosten zu lesen.

### Hinweise

Eine Zeile unter der Tabelle für jeden Fall, wenn er eintritt. Jede Zeile nennt die betroffenen Paare:

- „Der Betrag folgt nicht mehr den Zeilen bei: Budget 2026 (2 Zeilen, 1,50 VZÄ). Diese Zahlen verwenden die Kosten ihrer Zeilen.“ Diese Spalten zählen mit den Kosten ihrer Zeilen. Siehe [Betrag oder VZÄ wählen](#betrag-oder-vza-wahlen).
- „Keine Zeilendetails bei: Budget 2025 (1 Zeile, 0,50 VZÄ). Sie fließen nicht in diese Zahlen ein.“ Diese Budgetzeilen melden VZÄ für das ganze Jahr, aber kein Ergebnis pro Zeile, sodass der Bericht ihre Kosten nicht lesen kann.

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

Um den Bericht zu wechseln, klicken Sie im linken Bereich auf **Berichte**, um zum Hub zurückzukehren.

---

## Tipps

- **Mit der Globalen Leistungsverrechnung beginnen**: Verschaffen Sie sich den Gesamtüberblick über Zuordnungen, bevor Sie in ein einzelnes Unternehmen eintauchen.
- **Top-Zeilen für schnelle Erfolge nutzen**: Die größten Budgetzeilen sind Ihre ersten Kandidaten für Optimierung.
- **Budget vs. Erwarteter Endwert vergleichen**: Verwenden Sie den Bericht Budgetspaltenvergleich, um die Prognosegenauigkeit über Jahre zu messen.
- **Abschnitte in Leistungsverrechnungsberichten umschalten**: Die Kontrollkästchen ermöglichen es, sich nur auf die benötigten Daten zu konzentrieren (Abteilungen, Budgetzeilen, KPIs oder Flüsse), ohne visuelle Unordnung.
- **Jahresgruppierung im Budgetspaltenvergleich**: Wenn Sie die gleiche Kennzahl über mehrere Jahre vergleichen, aktivieren Sie die Jahresgruppierung für ein übersichtlicheres Liniendiagramm.
- **Für Präsentationen exportieren**: Diagramme exportieren als PNG und Tabellen als CSV, beides bereit für Folien oder Tabellenkalkulationen.
