# OPEX

OPEX-Positionen (Operating Expenditure / Betriebsausgaben) sind Ihre wiederkehrenden IT-Kosten: Softwarelizenzen, Cloud-Abonnements, Wartungsverträge und Dienstleistungen. Hier planen Sie Budgets, verfolgen Ist-Werte und ordnen Kosten Ihrer Organisation zu.

Der OPEX-Arbeitsbereich unterstützt Sie bei der Verwaltung jeder Ausgabenposition von der ersten Budgetierung über die Durchführung bis zur Berichterstattung. Alles liegt an einem Ort, mit jahresbezogenen Budgetspalten, flexiblen Zuordnungsmethoden und direkten Verknüpfungen zu Lieferanten, Verträgen, Anwendungen und Projekten.

## Erste Schritte

Navigieren Sie zu **Budgetverwaltung > OPEX**, um Ihre Liste zu sehen. Klicken Sie auf **Neu**, um Ihre erste Position zu erstellen.

Der Arbeitsbereich öffnet sich im Erstellungsmodus, mit geöffnetem Bereich **Eigenschaften** rechts. Geben Sie den Produktnamen oben im Titel ein, füllen Sie die Eigenschaften aus und klicken Sie dann auf **Erstellen**.

**Pflichtfelder**:
  - **Produktname** (der Titel): Was Sie ausgeben (z. B. „Salesforce Lizenzen", „AWS Compute")
  - **Zahlendes Unternehmen**: Welches Unternehmen diese Ausgabe bezahlt (erforderlich für die Buchhaltung)
  - **Konto**: Das Sachkonto für diese Ausgabe. Es erscheinen nur Konten aus dem Kontenplan des zahlenden Unternehmens
  - **Währung**: ISO-Code (z. B. USD, EUR). Standardmäßig Ihre Arbeitsbereich-Währung; kann pro Position überschrieben werden
  - **Beginn der Gültigkeit**: Wann diese Ausgabe beginnt (TT/MM/JJJJ)

**Optional aber nützlich**:
  - **Lieferant**: Wen Sie bezahlen. Verknüpft mit Ihren Lieferanten in den Stammdaten
  - **Kostenstelle**: Wer für die Ausgabe verantwortlich ist. Siehe [Kostenstellen](cost-centers.md). Ist das zahlende Unternehmen noch leer, füllt die Wahl einer Kostenstelle es mit dem Unternehmen der Kostenstelle
  - **Run oder Build**: **Run** für Ausgaben, die bestehende Services am Laufen halten, **Build** für Ausgaben, die sie schaffen oder verändern
  - **Analysekategorie**: Benutzerdefinierte Gruppierung für Berichte (z. B. „Infrastruktur", „Business Apps"). Neue Kategorien können spontan erstellt werden
  - **Ende der Gültigkeit**: Das Datum, an dem diese Ausgabe endet. Lassen Sie es leer, wenn es kein Ende gibt. Danach ist die Position deaktiviert und spätere Jahre zählen in den Budgetansichten nicht mehr
  - **IT-Verantwortlicher** / **Fachverantwortlicher**: Wer verantwortlich ist
  - **Beschreibung** und **Notizen**: Freitext im Tab Übersicht

Einmal gesetzt, können **Zahlendes Unternehmen** und **Konto** geändert, aber nicht geleert werden. **Lieferant** können Sie jederzeit leeren.

Wenn Sie das zahlende Unternehmen einer Position mit Konto ändern und das neue Unternehmen einen anderen Kontenplan verwendet, wird das Konto in derselben Speicherung geleert. **Konto** erscheint dann als Pflichtfeld, mit der Liste aus dem Kontenplan des neuen Unternehmens. Wählen Sie das neue Konto, um abzuschließen.

Sobald die Position erstellt ist, schaltet der Arbeitsbereich alle vier Tabs frei: **Übersicht**, **Budget**, **Zuordnungen** und **Verknüpfungen**.

**Tipp**: Sie können Positionen schnell erstellen und Budgets und Zuordnungen später ergänzen. Beginnen Sie mit dem Wesentlichen und verfeinern Sie iterativ.

---

## Mit der OPEX-Liste arbeiten

Die OPEX-Liste (unter **Budgetverwaltung > OPEX**) ist Ihre Hauptansicht zum Durchsuchen, Filtern und Navigieren von Ausgabenpositionen.

**Standardspalten**:
  - **Produktname**: Der Positionsname (verlinkt zum Übersichts-Tab)
  - **Lieferant**: Der Lieferantenname
  - **Zahlendes Unternehmen**: Welches Unternehmen diese Position bezahlt
  - **Vertrag**: Der neueste verknüpfte Vertragsname (verlinkt zum Vertrags-Arbeitsbereich)
  - **Konto**: Die Sachkonto-Nummer und -Bezeichnung
  - **Zuordnung**: Die Zuordnungsmethoden-Bezeichnung für das aktuelle Jahr (verlinkt zum Zuordnungen-Tab)
  - **Budget J** und **Erwarteter Endwert J**: Die Beträge des aktuellen Jahres in der Standardspalte und in der letzten angezeigten Spalte (verlinkt zum Budget-Tab für dieses Jahr). Mit den Standardeinstellungen sind das Budget und Erwarteter Endwert. Ist die Standardspalte zugleich die letzte angezeigte Spalte, erscheint nur eine Betragsspalte. Siehe [Budgetspalten](budget-operations.md#budgetspalten)
  - **Aufgabe**: Der neueste Aufgabentitel (verlinkt zum Tab Übersicht, in dem sich der Aufgabenbereich befindet)

**Zusätzliche Spalten** (standardmäßig ausgeblendet, über Spaltenauswahl umschaltbar):
  - **Betragsspalten**: Jede angezeigte Budgetspalte für J-1, J, J+1 und J+2, unter den Namen, die Ihre Organisation gewählt hat. Die Überschrift nennt die Spalte, das Jahr relativ zu heute und das Kalenderjahr, zum Beispiel **Revision J+1 (2027)**. Die Beträge sind in der Berichtswährung. Ausgeblendete Spalten werden nicht angeboten
  - **Aktiviert**: Positionsstatus (aktiviert oder deaktiviert)
  - **Beschreibung**: Positionsbeschreibung
  - **Währung**: ISO-Währungscode
  - **Gültig ab**: Startdatum
  - **Ende der Gültigkeit**: Datum, an dem die Position endet (leer bedeutet kein Ende)
  - **IT-Verantwortlicher** / **Fachbereichsverantwortlicher**: Zuständige Benutzer
  - **Analytik**: Name der Analysekategorie
  - **Kostenstelle**: Code und Name der Kostenstelle. Fahren Sie mit der Maus darüber, um ihren vollständigen Pfad im Baum zu sehen; klicken Sie darauf, um die Kostenstelle zu öffnen
  - **Budgetverantwortlicher**: Der Budgetverantwortliche der Kostenstelle der Position. Er wird aus der Kostenstelle abgeleitet und nicht auf der Position gespeichert: Ändern Sie den Budgetverantwortlichen einer Kostenstelle, und alle ihre Positionen folgen
  - **Run oder Build**: **Run** oder **Build**
  - **Projekt**: Namen der im Tab Verknüpfungen verknüpften Projekte
  - **Notizen**: Interne Notizen
  - **Erstellt / Aktualisiert**: Zeitstempel

**Filtern**:
  - **Schnellsuche**: Durchsucht Referenz, Produktname, Beschreibung, Lieferant, zahlendes Unternehmen, Konto, Vertrag, Projektnamen, Zuordnung, Verantwortliche, Analysekategorie, Kostenstelle (Code, Name und Pfad), Budgetverantwortlicher, Notizen, Währung und Status. Filtert die Liste in Echtzeit während der Eingabe
  - **Spaltenfilter**: Klicken Sie auf das Filtersymbol in einer Spaltenüberschrift. **Lieferant**, **Zahlendes Unternehmen**, **Konto**, **Zuordnung**, **Währung**, **IT-Verantwortlicher**, **Fachbereichsverantwortlicher**, **Analytik**, **Kostenstelle**, **Budgetverantwortlicher**, **Run oder Build** und **Aktiviert** verwenden Kontrollkästchen-Set-Filter (Mehrfachauswahl). Der Filter **Aktiviert** bietet **Aktiviert** und **Deaktiviert** und grenzt die Liste ein, wenn **Anzeigen** auf **Alle** steht
  - **Betragsfilter**: Jede Betragsspalte hat einen Zahlenfilter. Eine Zahl im Feld unter der Überschrift behält die Positionen mit mindestens diesem Betrag. Öffnen Sie das Filtermenü für die anderen Bedingungen: größer als, kleiner als, gleich, ungleich oder zwischen zwei Beträgen
  - **Datumsfilter**: **Gültig ab**, **Ende der Gültigkeit**, **Erstellt** und **Aktualisiert** haben Datumsfilter. Wählen Sie ein Datum im Feld unter der Überschrift, um die Positionen an diesem Datum zu behalten, oder öffnen Sie das Filtermenü für vor, nach, zwischen, leer oder nicht leer
  - **Textspalten** verwenden Textfilter. Geben Sie bei **Ref** die Nummer oder die vollständige Referenz ein, zum Beispiel `12` oder `OPX-12`
  - **Statusbereich**: Verwenden Sie den Umschalter **Anzeigen: Aktiviert / Deaktiviert / Alle** über dem Grid (Standard ist **Aktiviert**)

**Sortierung**:
  - Klicken Sie auf eine Spaltenüberschrift, um aufsteigend/absteigend zu sortieren. Jede Spalte ist sortierbar, auch jede Betragsspalte
  - Standardmäßig wird nach der Standardspalte des aktuellen Jahres sortiert, höchster Betrag zuerst (**Budget J** mit den Standardeinstellungen). Die Schaltflächen **Zurück** und **Weiter** des Arbeitsbereichs folgen derselben Reihenfolge
  - Die Liste merkt sich Ihre letzte Sortierung, Suche und Filter bei der Rückkehr

**Summenzeile**:
  - Die angeheftete Zeile unten zeigt die Summe jeder Betragsspalte, in der Berichtswährung
  - Summen berücksichtigen Ihre aktuellen Filter und Suche

**Deep Linking**:
  - Das Anklicken einer beliebigen Zelle öffnet den Arbeitsbereich auf dem relevantesten Tab:
    - **Produktname**, **Lieferant**, **Zahlendes Unternehmen**, **Konto** und andere allgemeine Spalten: Öffnet den **Übersichts**-Tab
    - **Betragsspalten** (Budget J, Erwarteter Endwert J, Revision J+1 usw.): Öffnet den **Budget**-Tab voreingestellt auf das Jahr der Spalte
    - **Zuordnung**: Öffnet den **Zuordnungen**-Tab für das aktuelle Jahr
    - **Aufgabe**: Öffnet den Tab **Übersicht**, in dem sich der Aufgabenbereich befindet
    - **Vertrag**: Öffnet den verknüpften Vertrags-Arbeitsbereich direkt (nicht den OPEX-Arbeitsbereich)
    - **Kostenstelle**: Öffnet den Kostenstellen-Arbeitsbereich

**Aktionen**:
  - **Neu**: Neue OPEX-Position erstellen (erfordert `opex:manager`)
  - **CSV importieren**: Massenladen von Positionen aus CSV (erfordert `opex:admin`)
  - **CSV exportieren**: Positionen als CSV exportieren (erfordert `opex:admin`)
  - **Auswahl löschen**: Massenlöschung ausgewählter Positionen (erfordert `opex:admin`; Zeilen über Kontrollkästchen auswählen)

**Zurück/Weiter-Navigation**:
  - Wenn Sie eine Position öffnen, zeigt der Arbeitsbereich **Zurück** und **Weiter**-Schaltflächen
  - Diese navigieren durch die Liste in der aktuellen Sortierreihenfolge unter Berücksichtigung von Filtern und Suche
  - Der Wechsel zu einer anderen Position speichert zuerst Ihre ausstehenden Änderungen
  - Ihr Listenkontext (Sortierung, Filter, Suche) bleibt erhalten, wenn Sie den Arbeitsbereich schließen

**Tipp**: Verwenden Sie Spaltenfilter + Schnellsuche, um fokussierte Ansichten zu erstellen (z. B. „Alle Cloud-Ausgaben über 10k"), und navigieren Sie dann mit Zurück/Weiter von Position zu Position, um Budgets zu überprüfen.

---

## Der OPEX-Arbeitsbereich

Klicken Sie auf eine beliebige Zeile der Liste, um den Arbeitsbereich zu öffnen. Er besteht aus vier Teilen:

  - **Kopfzeile**: die Referenz der Position (z. B. `OPX-12`) mit einer Kopierschaltfläche, der Produktname (anklicken, um die Position umzubenennen), **Zurück** / **Weiter**, **Link senden** und die Schaltfläche zum Schließen
  - **Metadatenleiste** unter dem Titel: **Status**, **IT-Verantwortlicher** und **Fachverantwortlicher**, direkt bearbeitbar. Hat die Kostenstelle der Position einen Budgetverantwortlichen, folgt **Budgetverantwortlicher** danach. Er ist schreibgeschützt und aus der Kostenstelle abgeleitet, nicht auf der Position gespeichert: Fahren Sie mit der Maus darüber, um zu sehen, aus welcher Kostenstelle er stammt, und ändern Sie ihn auf der Kostenstelle (siehe [Kostenstellen](cost-centers.md#budgetverantwortlicher-auf-budgetzeilen))
  - **Vier Tabs**: **Übersicht**, **Budget**, **Zuordnungen** und **Verknüpfungen** (der Tab Verknüpfungen zeigt die Anzahl der Verknüpfungen der Position)
  - **Bereich Eigenschaften** rechts: die Hauptfelder der Position. Öffnen oder schließen Sie ihn mit der Eigenschaften-Schaltfläche; der Arbeitsbereich merkt sich Ihre Wahl

**Automatisches Speichern**:
  - Jede Änderung wird automatisch gespeichert. In der Kopfzeile erscheint der Hinweis **Wird gespeichert...** / **Gespeichert**
  - Beim Wechsel des Tabs, beim Wechsel zur vorherigen oder nächsten Position oder beim Schließen des Arbeitsbereichs werden ausstehende Änderungen zuerst gespeichert. Schlägt ein Speichervorgang fehl, bleiben Sie an Ort und Stelle und eine Meldung nennt den Grund, sodass keine Änderung unbemerkt verloren geht
  - **Strg+S** (**Cmd+S** auf dem Mac) speichert sofort

### Übersicht

Der Tab Übersicht enthält die Freitextfelder und die Aufgaben der Position.

**Was Sie bearbeiten können**:
  - **Beschreibung**: Was die Ausgabe abdeckt
  - **Notizen**: Interne Freitext-Notizen

**Aufgabenbereich**:
  - Listet alle mit dieser OPEX-Position verknüpften Aufgaben mit den Spalten **Titel**, **Status**, **Priorität**, **Fälligkeitsdatum** und **Aktionen**. Der Titel des Bereichs zeigt die Anzahl der Aufgaben
  - Filter **Status**: Alle (Standard), Aktiv (nicht erledigt), Offen, In Bearbeitung, Ausstehend, Im Test, Erledigt oder Abgebrochen. Die Zurücksetzen-Schaltfläche löscht ihn
  - Klicken Sie auf **Aufgabe hinzufügen**, um eine neue, bereits mit dieser Position verknüpfte Aufgabe zu öffnen. Titel, Beschreibung, Priorität, Zuständigen und Fälligkeitsdatum füllen Sie im Aufgaben-Arbeitsbereich aus
  - Mit dem Öffnen-Symbol gehen Sie zu einer Aufgabe, mit dem Löschsymbol löschen Sie sie (nach Bestätigung)
  - Aufgaben haben eigene Berechtigungen (`tasks:member` zum Erstellen und Bearbeiten). OPEX-Manager-Zugriff allein berechtigt nicht zum Bearbeiten von Aufgaben; wenden Sie sich an Ihren Administrator, wenn Sie keine Aufgaben erstellen können
  - Aufgaben können auch unter **Portfolio > Aufgaben** angezeigt und verwaltet werden, wo alle Aufgaben Ihrer Organisation erscheinen

**Bereich Eigenschaften**:
  - **Lieferant**, **Kostenstelle**, **Zahlendes Unternehmen**, **Konto** (gefiltert nach dem Kontenplan des zahlenden Unternehmens), **Währung** (nur die in Ihrem Arbeitsbereich erlaubten Währungen), **Analysekategorie**, **Run oder Build** und **Beginn der Gültigkeit**
  - **Lebenszyklus**: der Schalter **Aktiviert** und das Datum **Ende der Gültigkeit**. Siehe [Status und Lebenszyklus](#status-und-lebenszyklus)
  - Die Daten **Erstellt** und **Aktualisiert** (schreibgeschützt)

**Kostenstelle**:
  - Die Liste zeigt den Kostenstellenbaum. Gruppen werden zur Orientierung angezeigt und können nicht gewählt werden. Suchen Sie nach Code, Name oder Gruppenname
  - Eine deaktivierte Kostenstelle ist als **Deaktiviert** markiert. Sie bleibt auf den Positionen, die sie bereits haben, und kann für keine andere Position gewählt werden
  - Wenn Sie eine Position erstellen und das zahlende Unternehmen leer ist, füllt die Wahl einer Kostenstelle das zahlende Unternehmen mit dem Unternehmen der Kostenstelle, sodass die Liste **Konto** den Kontenplan dieses Unternehmens zeigt. Solange Sie nicht selbst ein Unternehmen oder ein Konto wählen, aktualisiert die Wahl einer anderen Kostenstelle auch das Unternehmen
  - Wenn sich das zahlende Unternehmen vom Unternehmen der Kostenstelle unterscheidet, bleiben beide erhalten. Ein Hinweis unter dem Feld lautet „Diese Kostenstelle gehört zu", gefolgt vom Namen des Unternehmens
  - Eine über die API gespeicherte Position mit Kostenstelle und ohne zahlendes Unternehmen erhält das Unternehmen der Kostenstelle. Für CSV-Dateien siehe [CSV-Import/Export](#csv-importexport)

**Run oder Build**: **Run**, **Build** oder **Nicht festgelegt**. Damit teilen Sie das Budget auf zwischen dem Betrieb bestehender Services und deren Veränderung.

**Tipp**: Beim Erstellen einer Position bedeutet die Warnung „Veraltetes Konto", dass das ausgewählte Konto nicht zum Kontenplan des zahlenden Unternehmens gehört. Wählen Sie ein anderes Konto, um die Warnung zu beheben. Eine bestehende Position, deren Konto außerhalb des Kontenplans ihres Unternehmens liegt, lässt sich weiterhin bearbeiten: Der Kontenplan wird nur geprüft, wenn sich das Unternehmen oder das Konto ändert.

---

### Budget

Im Budget-Tab geben Sie Finanzdaten pro Jahr ein. Er unterstützt mehrere Budgetspalten und zwei Eingabemodi, die als Tabs erscheinen: **Jährlich** (Jahressummen) und **Monatlich** (monatliche Aufschlüsselung).

**Jahresauswahl**:
  - Verwenden Sie die Jahres-Tabs oben, um zwischen J-2, J-1, J (aktuelles Jahr), J+1 und J+2 zu wechseln
  - Jedes Jahr hat seine eigene Version, seinen eigenen Modus und eigene Beträge
  - Beim Wechsel des Jahres werden Ihre ausstehenden Änderungen zuerst gespeichert

**Budgetspalten**:
  - Der Tab zeigt die Spalten, die Ihre Organisation anzeigt, unter ihren Namen und immer in derselben Reihenfolge. Die Standardspalten sind:
  - **Budget**: Ursprüngliches Jahresbudget, das zu Jahresbeginn genehmigt wurde
  - **Revision**: Budgetaktualisierung im Jahresverlauf (z. B. nach einer Neuprognose)
  - **Prognose**: Eine zusätzliche Planungsspalte, standardmäßig ausgeblendet
  - **Ist-Werte**: Tatsächliche Ausgaben, so wie sie im Jahresverlauf erfasst werden
  - **Erwarteter Endwert**: Ihre beste Schätzung des Werts zum Jahresende
  - Ein Budgetadministrator kann die Spalten umbenennen, einige ausblenden und die Standardspalte unter **Budgetverwaltung > Administration > Budgetspalten** wählen (siehe [Budgetspalten](budget-operations.md#budgetspalten)). Eine ausgeblendete Spalte behält ihre Beträge

**Zeitraum einer Spalte**:
  - Jede Spalte hat einen Zeitraum innerhalb des Jahres, zum Beispiel April bis Dezember
  - Ein Monat zählt, wenn der Zeitraum seinen 15. Tag abdeckt. Ein Zeitraum, der am 10. April beginnt, schließt den April ein; einer, der am 20. April beginnt, startet im Mai
  - Eine Spalte ohne Betrag und ohne Zeitraum erhält einen Vorschlag: **Beginn der Gültigkeit** und **Ende der Gültigkeit** der Position, begrenzt auf das Jahr. Eine Position, die am 1. April beginnt, ergibt den Vorschlag April bis Dezember
  - Eine Spalte, die bereits Beträge enthält und keinen Zeitraum hat, gilt als ganzes Jahr, sodass sich vorhandene Daten wie bisher verhalten

**Jährlich oder Monatlich**:
  - **Jährlich**: Geben Sie eine Summe pro Spalte ein. Die Summe wird gleichmäßig auf die Monate des Zeitraums der Spalte verteilt, und die Monate außerhalb des Zeitraums werden auf null gesetzt. Der Zeitraum wird unter jeder Summe angezeigt, bevor Sie etwas eingeben, zum Beispiel „9 Monate, April bis Dezember“. Nur die Summe, die Sie bearbeiten, wird gespeichert. Die anderen Spalten behalten ihre Monatsbeträge.
  - Klicken Sie auf das Stiftsymbol neben dem Zeitraum unter einer Summe (**Zeitraum ändern**), um das Verteilungsfeld für diese Spalte mit ihrer aktuellen Summe zu öffnen. Lassen die Daten der Position keinen Monat im Jahr übrig, ist die Summe deaktiviert und zeigt „Kein Monat von 2026 liegt innerhalb der Daten der Position.“ Klicken Sie auf das Stiftsymbol daneben (**Zeitraum wählen**), um selbst einen festzulegen.
  - **Monatlich**: Geben Sie Beträge pro Monat (Jan-Dez) für jede angezeigte Spalte ein. Quartalszwischensummen und eine Jahressumme werden angezeigt. Nur die Monate, die Sie ändern, werden gespeichert.
  - Beide Tabs zeigen dieselben Spalten: Prognose erscheint auch in **Jährlich**, wenn sie angezeigt wird.
  - Wechseln Sie mit den Tabs **Jährlich** und **Monatlich** zwischen den Modi. Der Wechsel ändert Ihre Beträge nicht.

**Einfrierverhalten**:
  - Wenn die Budgetspalten eines Jahres eingefroren sind (über die Budgetadministration), werden die entsprechenden Felder schreibgeschützt und zeigen ein Schloss-Symbol
  - Sie können eingefrorene Daten weiterhin ansehen; Administratoren können sie über **Budgetverwaltung > Administration > Daten einfrieren / auftauen** wieder freigeben
  - Jede Spalte kann unabhängig eingefroren werden

**Einen Betrag verteilen**:
  - Das Verteilungsfeld ist im Tab **Monatlich** immer sichtbar. Im Tab **Jährlich** öffnet es sich über das Stiftsymbol unter einer Summe
  - Wählen Sie eine **Spalte** unter den angezeigten Spalten, prüfen Sie den **Betrag**, wählen Sie eine **Verteilung** (**Gleichmäßig** oder **4-4-5**) und legen Sie die Daten **Von** und **Bis** fest. Die Daten gehen vom aktuellen Zeitraum der Spalte aus, die Verteilung von der bisherigen Verteilung der Spalte
  - Das Feld öffnet sich mit der Standardspalte. Der Betrag übernimmt die aktuelle Summe der Spalte, in beiden Tabs, und passt sich an, wenn Sie eine andere Spalte wählen. Er bleibt leer, wenn die Spalte keinen Betrag hat
  - **Auf alle Spalten anwenden** ist standardmäßig aktiviert: Jede Spalte, die dieser Option folgt, erhält denselben Zeitraum und dieselbe Verteilung, jeweils mit ihrer eigenen aktuellen Summe. Standardmäßig folgt jede Spalte. Ein Budgetadministrator legt unter [Budgetspalten](budget-operations.md#budgetspalten) fest, welche folgen. Eingefrorene Spalten ändern sich nie. Fahren Sie mit der Maus über den Schalter, um zu sehen, welche Spalten folgen und welche ihren eigenen Zeitraum behalten. Schalten Sie den Schalter aus, um nur die gewählte Spalte zu verteilen
  - Eine Spalte, die „Auf alle Spalten anwenden“ nicht folgt, wird allein verteilt: Der Schalter erscheint nicht, wenn Sie sie verteilen. Der Schalter ist auch ausgeblendet, wenn sich keine andere folgende Spalte ändern kann
  - **Zurücksetzen** füllt das Feld mit der aktuellen Summe der Spalte, **Gleichmäßig** und dem ganzen Jahr. Dabei wird nichts gespeichert: Klicken Sie auf **Anwenden**, um es zu übernehmen. Ist **Auf alle Spalten anwenden** aktiviert, setzen **Zurücksetzen** und dann **Anwenden** jede folgende Spalte auf eine gleichmäßige Verteilung über zwölf Monate zurück
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

**Werkzeuge im Monatsmodus**:
  - **Spalte leeren**: Das Symbol neben einer Spaltenüberschrift setzt alle Monate dieser Spalte auf null, zum Beispiel bevor Sie den gesamten Betrag in einem einzigen Monat erfassen. Das gilt als Änderung von Hand. Um Beträge und Zeitraum einer Spalte für alle Positionen zu entfernen, verwenden Sie **Budgetspalte zurücksetzen** in der Budgetadministration

**Mehrjahrestrend**:
  - Ein Diagramm unter dem Raster zeigt jede angezeigte Spalte über mehrere Jahre, auch Prognose, wenn sie angezeigt wird, und aktualisiert sich während der Eingabe

**So verwenden Sie ihn**:
  1. Wählen Sie das Jahr, für das Sie planen
  2. Wählen Sie den Tab **Jährlich** oder **Monatlich**
  3. Füllen Sie die relevanten Spalten aus (Budget für die Erstplanung, Ist-Werte für die Nachverfolgung, Erwarteter Endwert für die Zahl zum Jahresende)
  4. Ihre Änderungen werden automatisch gespeichert; neben den Jahres-Tabs erscheint der Hinweis **Wird gespeichert...** / **Gespeichert**

**Tipp**: Für die meisten Positionen ist der Modus Jährlich schneller. Verwenden Sie den Modus Monatlich, wenn die Ausgaben von Monat zu Monat stark schwanken (z. B. saisonale Lizenzen, einmalige Einrichtungsgebühren).

---

### Zuordnungen

Der Tab Zuordnungen verteilt die Ausgabe auf Ihre Unternehmen und Abteilungen. Das speist Leistungsverrechnungsberichte und Kosten-pro-Benutzer-KPIs.

**Jahresauswahl**:
  - Funktioniert wie beim Budget: Wechseln Sie mit den Jahres-Tabs zwischen J-2, J-1, J, J+1, J+2
  - Jedes Jahr kann eine andere Zuordnungsmethode haben
  - Die Jahressumme der Standardspalte erscheint rechts, zum Beispiel **Budget, Jahressumme**, und die Tabelle zeigt jeden Anteil als Prozentsatz und als Betrag

**Zuordnungsmethoden**:

| Methode | Funktionsweise |
|---|---|
| **Mitarbeiterzahl (Standard)** | Teilt Ausgaben proportional nach der Mitarbeiterzahl jedes Unternehmens für das ausgewählte Jahr. Keine manuelle Auswahl erforderlich: Die Prozentsätze werden automatisch aus den Unternehmenskennzahlen berechnet. Das ist der Standard. |
| **IT-Benutzer** | Teilt Ausgaben proportional nach der Anzahl der IT-Benutzer jedes Unternehmens für das ausgewählte Jahr. |
| **Umsatz** | Teilt Ausgaben proportional nach dem Umsatz jedes Unternehmens für das ausgewählte Jahr. |
| **Manuell nach Unternehmen** | Sie wählen aus, welche Unternehmen diese Ausgabe erhalten, und wählen unter **Zuordnen nach** einen Treiber (Mitarbeiterzahl, IT-Benutzer oder Umsatz), um die Prozentsätze nur unter den ausgewählten Unternehmen zu berechnen. |
| **Manuell nach Abteilung** | Sie wählen bestimmte Unternehmen/Abteilungs-Paare aus. Die Prozentsätze werden aus der Mitarbeiterzahl jeder Abteilung berechnet. Nützlich, wenn eine Ausgabenposition nur bestimmten Abteilungen zugutekommt (z. B. ein CRM, das vom Vertrieb genutzt wird). |
| **Manuelle Prozentsätze** | Sie wählen die Unternehmen und geben jeden Prozentsatz selbst ein. Die Summe muss 100 % ergeben. |

**Standard- und fixierte Methoden**:
  - Der **Standard**-Eintrag, angezeigt als *Mitarbeiterzahl (Standard)*, bis Ihre Organisation eine andere Methode konfiguriert, folgt der Einstellung unter **Budgetverwaltung > Administration > Standard-Zuordnungsmethode**. Jede Position, die auf Standard bleibt, wird neu berechnet, wenn ein Administrator diese Einstellung ändert
  - Diese Einstellung kann den Standard auch auf eine **Auswahl von Unternehmen** beschränken (zum Beispiel das Unternehmen, das das IT-Budget trägt): Der Treiber gilt dann nur für diese Unternehmen, und die Option lautet *Standard (n Unternehmen)*
  - **Mitarbeiterzahl**, **IT-Benutzer** und **Umsatz** fixieren diese Methode an der Position: Eine fixierte Methode funktioniert weiterhin, auch wenn sich der Standard der Organisation später ändert
  - Positionen mit einer manuellen Zuordnung sind vom Standard nie betroffen

**Wie Prozentsätze funktionieren**:
  - Bei **automatischen Methoden** (Mitarbeiterzahl, IT-Benutzer, Umsatz): Die Prozentsätze werden aus den aktuellen Kennzahlen Ihrer aktiven Unternehmen berechnet. Sie bearbeiten sie nicht direkt
  - Bei **Manuell nach Unternehmen** und **Manuell nach Abteilung**: Sie wählen die Unternehmen oder Abteilungen, und das System berechnet die Prozentsätze aus dem gewählten Treiber und den aktuellen Kennzahlen
  - Bei **Manuelle Prozentsätze**: Die Eingabe eines Prozentsatzes fixiert diese Zeile, und die übrigen Zeilen teilen sich den Rest. **Gleichmäßig aufteilen** gibt jeder Zeile denselben Anteil; **Manuelle Fixierungen löschen** hebt die Fixierungen auf
  - Die Prozentsätze spiegeln Live-Daten wider. Wenn Sie die Mitarbeiterzahl eines Unternehmens aktualisieren, werden die Zuordnungen neu berechnet

**So verwenden Sie ihn**:
  1. Wählen Sie das Jahr
  2. Wählen Sie unter **Methode** eine Zuordnungsmethode
  3. Bei einer manuellen Methode fügen Sie mit **Zeile hinzufügen** Unternehmen (oder Unternehmen/Abteilungs-Paare) hinzu und entfernen sie mit dem Entfernen-Symbol. Bei **Manuell nach Unternehmen** wählen Sie unter **Zuordnen nach** einen Treiber
  4. Änderungen werden automatisch gespeichert

**Häufige Probleme**:
  - **Fehlende Kennzahlen**: Für ein oder mehrere Unternehmen fehlen Mitarbeiterzahl, IT-Benutzer oder Umsatz für das ausgewählte Jahr, oder der Wert ist null. Tragen Sie die Kennzahlen unter **Stammdaten > Unternehmen** (Details-Tab) ein
  - **„Manuelle Prozentsätze müssen in Summe 100 % ergeben."**: Passen Sie die Zeilen an oder klicken Sie auf **Gleichmäßig aufteilen**

**Tipp**: Verwenden Sie für die meisten Positionen Mitarbeiterzahl (Standard). Das ist am einfachsten und aktualisiert sich automatisch. Reservieren Sie manuelle Methoden für Ausgaben, die nur bestimmten Unternehmen oder Abteilungen zugutekommen.

---

### Verknüpfungen

Der Tab Verknüpfungen verbindet diese OPEX-Position mit zugehörigen Objekten: Projekte, Anwendungen, Verträge, Kontakte, Relevante Websites und Anhänge. Alles in diesem Tab wird automatisch gespeichert.

**Projekte**:
  - Verknüpfen Sie über die Autovervollständigung ein oder mehrere Projekte aus Ihrem Portfolio
  - Das hilft, Ausgaben in Berichten nach Projekt zu gruppieren, und ermöglicht die Projektbuchhaltung
  - Die Projektnamen erscheinen in der Spalte **Projekt** der OPEX-Liste, und die Schnellsuche findet sie
  - Entfernen Sie ein Projekt mit dem X auf seinem Chip

**Anwendungen**:
  - Verknüpfen Sie über die Autovervollständigung eine oder mehrere Anwendungen oder Services aus Ihrem IT-Katalog
  - Das hilft nachzuverfolgen, welche OPEX-Positionen welche Anwendungen oder Services finanzieren

**Verträge**:
  - Verknüpfen Sie über die Autovervollständigung einen oder mehrere Verträge
  - Verknüpfte Verträge erscheinen zur schnellen Orientierung in der Spalte **Vertrag** der OPEX-Liste
  - Ein Vertrag kann mit mehreren OPEX-Positionen verknüpft sein (n:m-Beziehung)
  - Entfernen Sie einen Vertrag mit dem X auf seinem Chip

**Kontakte**:
  - Verknüpfen Sie Kontakte mit dieser Position: Wählen Sie einen Kontakt und dann seine Rolle (**Vertrieb**, **Technik**, **Support** oder **Sonstige**). Die Wahl der Rolle fügt den Kontakt hinzu
  - Die Tabelle zeigt Rolle, Vorname, Nachname, Position, E-Mail und Mobilnummer. Fahren Sie mit der Maus über die Rolle, um zu sehen, ob der Kontakt vom Lieferanten stammt oder manuell hinzugefügt wurde
  - Entfernen Sie einen Kontakt mit dem Entfernen-Symbol
  - Nützlich, um zu wissen, wen Sie bei Verlängerungen, Supportfällen oder Verhandlungen ansprechen

**Relevante Websites**:
  - Klicken Sie auf **URL hinzufügen**, um einen Link hinzuzufügen (z. B. Lieferantenportale, Dokumentation, Admin-Konsolen, interne Wikis). Jeder Link hat einen **Namen** und eine **URL**
  - Klicken Sie auf die Zeile eines Links, um ihn zu bearbeiten, oder entfernen Sie ihn mit dem Löschsymbol

**Anhänge**:
  - Laden Sie Dateien zu dieser Position hoch (z. B. Verträge, Rechnungen, Angebote, Leistungsbeschreibungen, technische Spezifikationen)
  - Ziehen Sie Dateien in den Anhangsbereich oder klicken Sie auf **Dateien auswählen**
  - Klicken Sie auf den Chip einer Datei, um sie herunterzuladen
  - Löschen Sie einen Anhang mit dem Löschsymbol auf seinem Chip (nach Bestätigung; erfordert `opex:manager`)

**Tipp**: Verknüpfen Sie Verträge, um Verlängerungen über mehrere OPEX-Positionen hinweg zu verfolgen. Fügen Sie URLs von Lieferantenportalen für den schnellen Zugriff hinzu. Laden Sie Angebote und Rechnungen als Anhänge hoch, um die gesamte ausgabenbezogene Dokumentation zu bündeln.

---

## CSV-Import/Export

Sie können OPEX-Positionen per CSV massenimportieren, um die Ersteinrichtung zu beschleunigen oder mit externen Systemen zu synchronisieren.

**Export**:
  1. Klicken Sie in der OPEX-Liste auf **CSV exportieren**
  2. Wählen Sie:
     - **Vorlage**: Nur Kopfzeilen (verwenden Sie dies, um eine leere CSV zum Ausfüllen zu erstellen)
     - **Daten**: Alle OPEX-Positionen mit Budgets für J-1, J und J+1

**CSV-Struktur**:
  - Trennzeichen: Semikolon `;` (kein Komma)
  - Kodierung: UTF-8 (in Excel als „CSV UTF-8" speichern)
  - Kopfzeilen: `product_name;description;supplier_name;company_name;account_number;currency;effective_start;status;disabled_at;owner_it_email;owner_business_email;analytics_category;cost_center_code;run_build;notes;y_minus1_budget;y_minus1_landing;y_budget;y_follow_up;y_landing;y_revision;y_plus1_budget;y_plus1_revision`
  - `disabled_at` ist das Ende der Gültigkeit: das Datum, an dem die Position endet. Verwenden Sie ein Datum (`2026-12-31`) oder ein vollständiges Datum mit Uhrzeit. Lassen Sie das Feld leer, wenn es kein Ende gibt
  - Ältere Dateien mit einer Spalte `effective_end` werden weiterhin importiert: Das Datum dieser Spalte füllt das Ende der Gültigkeit, wenn `disabled_at` leer ist
  - `cost_center_code` und `run_build` sind optionale Spalten: Exporte und die Vorlage enthalten sie immer, und Dateien ohne sie werden weiterhin importiert

**Import**:
  1. Klicken Sie in der OPEX-Liste auf **CSV importieren**
  2. Laden Sie Ihre CSV-Datei hoch (Drag-and-Drop oder Dateiauswahl)
  3. Klicken Sie auf **Vorprüfung** zur Validierung:
     - Kopfzeilen stimmen exakt überein
     - Pflichtfelder (product_name, account_number) sind vorhanden. Eine neue Position braucht außerdem eine Währung und einen company_name, sofern sie keine Kostenstelle hat
     - Jedes Unternehmen, jeder Lieferant, jedes Konto, jede Kostenstelle und jeder Verantwortliche aus der Datei existiert in Ihrem Arbeitsbereich
     - Datumsangaben sind gültig, und keine zwei Zeilen beschreiben dieselbe Position
     - Währungen sind in den Währungseinstellungen Ihres Arbeitsbereichs erlaubt
     - Verantwortliche sind aktive Benutzer
  4. Überprüfen Sie den Vorprüfungsbericht (zeigt Zählungen und bis zu 5 Beispielfehler). Eine Datei mit einem Fehler lädt nichts: Korrigieren Sie die Zeilen und führen Sie die Vorprüfung erneut aus
  5. Wenn OK, klicken Sie auf **Laden** zum Importieren

**Wichtige Hinweise**:
  - **Abgleich**: Eine Zeile wird einer OPEX-Position über Produktname und Lieferant zugeordnet. Eine Zeile, die zu einer bestehenden Position passt, aktualisiert sie; jede andere Zeile legt eine neue Position an. Eine Zeile mit leerem `supplier_name` passt nur zu einer Position ohne Lieferant. Zwei Zeilen mit demselben Produktnamen und Lieferanten sind ein Fehler („Same line as row N"): Behalten Sie eine Zeile pro Position
  - **Währung**: Pflicht für eine neue Position, und sie muss in den Währungseinstellungen Ihres Arbeitsbereichs erlaubt sein. Bei einer bestehenden Position behält eine leere Zelle deren Währung
  - **Lieferant**: `supplier_name` ist optional. Ist das Feld gefüllt, wird ein Lieferant mit genau diesem Namen verwendet. Andernfalls wird der Name ohne Rücksicht auf Groß-/Kleinschreibung abgeglichen. Ein Name, der zu keinem Lieferanten passt, ist ein Fehler. Ebenso ein Name, der zu mehreren Lieferanten nur über die Groß-/Kleinschreibung passt (zum Beispiel „Acme" und „ACME", wenn die Datei „acme" enthält)
  - **Unternehmen und Konto**: `company_name` muss einem Unternehmen namentlich entsprechen (Groß-/Kleinschreibung wird ignoriert). Ein leeres `company_name` behält das Unternehmen einer bestehenden Position; eine neue Position erhält das Unternehmen ihrer Kostenstelle. Fehlt beides, wird die Zeile abgelehnt: „Company is required unless the line has a cost center." `account_number` wird im Kontenplan dieses Unternehmens gesucht, oder im Standard-Kontenplan, wenn das Unternehmen keinen hat. Eine Kontonummer, die nur in einem anderen Kontenplan existiert, ist ein Fehler
  - **Verantwortliche**: `owner_it_email` und `owner_business_email` müssen aktiven Benutzern per E-Mail entsprechen: Ein eingeladener Benutzer oder ein Kontakt ohne Konto wird abgelehnt
  - **Datumsangaben**: `effective_start` (und `effective_end` in älteren Dateien) muss ein echter Kalendertag im Format `YYYY-MM-DD` sein, zum Beispiel `2026-01-01`. Andere Formate wie `01/03/2026` sind Fehler. Ein leeres `effective_start` behält das gespeicherte Datum einer bestehenden Position; eine neue Position beginnt am 1. Januar des laufenden Jahres
  - **Analysekategorie**: Existiert die Kategorie nicht, wird sie beim Import automatisch erstellt
  - **Kostenstelle**: `cost_center_code` ist der Code einer Kostenstelle, unabhängig von Groß- und Kleinschreibung. Eine Gruppe wird abgelehnt. Eine deaktivierte Kostenstelle wird auf einer Position akzeptiert, die sie bereits hat, und als neuer Wert abgelehnt. Eine leere Zelle entfernt die Kostenstelle der Position. Fehlt die ganze Spalte, behalten die Positionen ihre Kostenstelle
  - **Run oder Build**: `run_build` ist `run`, `build` oder leer (unabhängig von Groß- und Kleinschreibung). Eine leere Zelle entfernt den Wert. Fehlt die ganze Spalte, behalten die Positionen ihren Wert
  - **Unternehmen aus der Kostenstelle**: Eine neue Position mit leerem `company_name` erhält das Unternehmen ihrer Kostenstelle, und `account_number` wird im Kontenplan dieses Unternehmens gesucht. Ein gefülltes `company_name` bleibt erhalten, auch wenn es vom Unternehmen der Kostenstelle abweicht
  - **Budgets**: Budgetspalten füllen J-1, J und J+1 Versionen. Beträge werden gleichmäßig auf 12 Monate verteilt (Modus Jährlich), und der Zeitraum der Spalte wird das ganze Jahr. Eine leere Zelle lässt die Spalte unverändert; `0` leert sie. Die Überschriften behalten ihre technischen Namen, egal wie Ihre Organisation die Spalten nennt, und sie laden auch ausgeblendete Spalten
  - **Monatsbeträge**: Um Beträge Monat für Monat zu laden oder zu prüfen, mit dem Zeitraum jeder Spalte, verwenden Sie die **Datei der Budgetzeilen** in der Budgetadministration

**Häufige Fehler**:
  - **„Supplier '...' not found"**: Prüfen Sie die Schreibweise, oder erstellen Sie den Lieferanten zuerst unter **Stammdaten > Lieferanten**, dann importieren Sie erneut
  - **„Supplier '...' matches more than one supplier"**: Mehrere Lieferanten unterscheiden sich von diesem Namen nur durch die Groß-/Kleinschreibung. Schreiben Sie den Namen genau wie bei einem von ihnen, oder benennen Sie einen unter **Stammdaten > Lieferanten** um, dann importieren Sie erneut
  - **„Same line as row N"**: Zwei Zeilen beschreiben dieselbe Position. Führen Sie sie zu einer Zeile zusammen und importieren Sie dann erneut
  - **„Account ... not found in ...'s chart of accounts"**: Verwenden Sie ein Konto aus dem Kontenplan des zahlenden Unternehmens, oder fügen Sie das Konto unter **Stammdaten > Kontenpläne** hinzu, dann importieren Sie erneut
  - **„effective_start must be a valid date"**: Verwenden Sie das Format `YYYY-MM-DD`
  - **„Company is required unless the line has a cost center."**: Füllen Sie `company_name` oder `cost_center_code` für die neue Position
  - **„Cost center ... was not found."**: Prüfen Sie den Code, oder legen Sie die Kostenstelle unter **Stammdaten > Kostenstellen** an, dann importieren Sie erneut
  - **„... is a group. Choose a cost center."**: Verwenden Sie den Code einer Kostenstelle innerhalb dieser Gruppe
  - **„Cost center ... is disabled."**: Verwenden Sie eine aktivierte Kostenstelle, oder aktivieren Sie sie unter **Stammdaten > Kostenstellen** wieder
  - **„Run or build must be run, build or blank."**: Korrigieren Sie die Zelle `run_build`
  - **„Ungültige Währung"**: Verwenden Sie 3-stellige ISO-Codes (USD, EUR, GBP), die in Ihren Arbeitsbereich-Währungseinstellungen zugelassen sind
  - **„Kopfzeilen stimmen nicht überein"**: Laden Sie eine frische Vorlage herunter; Kopfzeilen müssen exakt übereinstimmen (einschließlich Reihenfolge)

**Tipp**: Beginnen Sie mit dem Vorlagenexport, füllen Sie einige Zeilen aus und führen Sie eine Vorprüfung durch, um Probleme frühzeitig zu erkennen. Beheben Sie Fehler in der CSV und laden Sie sie erneut hoch, bis die Vorprüfung besteht, dann laden Sie.

---

## Status und Lebenszyklus

Jede OPEX-Position hat einen **Status** (Aktiviert oder Deaktiviert) und ein optionales **Ende der Gültigkeit**, das steuert, wann sie in Berichten und Auswahllisten erscheint. Es ist das einzige Enddatum einer Position.

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
  - Sie können ein zukünftiges Ende der Gültigkeit planen (nützlich für geplante Vertragsenden)

**Deaktivierte Positionen anzeigen**:
  - Standardmäßig zeigt die OPEX-Liste nur **aktivierte** Positionen
  - Verwenden Sie den Umschalter **Anzeigen: Deaktiviert** oder **Anzeigen: Alle**, um deaktivierte Positionen zu sehen

**Wann deaktivieren vs. löschen**:
  - **Bevorzugen Sie das Deaktivieren**: Bewahrt die Historie, stellt konsistente Berichte sicher und unterstützt Audit-Trails
  - **Nur löschen, wenn**: Die Position versehentlich erstellt wurde
  - Beim Löschen einer Position werden auch ihre Budgets, Zuordnungen, Aufgaben, relevanten Websites, Anhänge (mit ihren Dateien) und ihre Verknüpfungen zu Verträgen entfernt. Wurde eine ihrer Aufgaben in eine Anfrage umgewandelt, bleibt die Anfrage erhalten: Sie hat eine eigene Kopie von Titel, Beschreibung und Anhängen, und nur ihre Verknüpfung zur Aufgabe entfällt

**Tipp**: Verwenden Sie das Ende der Gültigkeit, um OPEX-Positionen auslaufen zu lassen, wenn Verträge enden oder Dienste eingestellt werden. Löschen Sie nur bei echten Fehlern.

---

## Tipps und Best Practices

1. **Einfach anfangen**: Erstellen Sie Positionen nur mit dem Wesentlichen (Produktname, zahlendes Unternehmen, Konto), dann ergänzen Sie Budgets und Zuordnungen bei der Planung.

2. **Die Standard-Zuordnungsmethode verwenden**: Für die meisten Positionen reicht Mitarbeiterzahl (Standard) aus. Reservieren Sie manuelle Zuordnungen für Ausgaben, die nur bestimmten Unternehmen oder Abteilungen zugutekommen.

3. **Verträge verknüpfen**: Wenn Sie Ausgaben über Verträge verwalten, verknüpfen Sie sie im Verknüpfungen-Tab. Das erleichtert die Nachverfolgung von Verlängerungen.

4. **Anwendungen verknüpfen**: Ordnen Sie OPEX-Positionen den Anwendungen oder Diensten zu, die sie finanzieren. Dies bietet eine klare Kosten-zu-Anwendungs-Zuordnung.

5. **Dokumentation hochladen**: Verwenden Sie die Anhangfunktion, um Lieferantenverträge, Angebote, Rechnungen und SOWs zu speichern.

6. **Lieferantenportal-Links hinzufügen**: Verwenden Sie relevante Websites, um zu Lieferanten-Admin-Konsolen, Support-Portalen und Dokumentation für schnellen Zugriff zu verlinken.

7. **Kontakte verfolgen**: Fügen Sie Lieferantenkontakte mit Rollen (Kommerziell, Technisch, Support) hinzu, damit Ihr Team weiß, wen es für jede Ausgabenposition kontaktieren soll.

8. **Analysekategorien nutzen**: Taggen Sie Positionen mit Kategorien (Infrastruktur, Business Apps, Sicherheit), um Ausgaben in Berichten zu gruppieren.

9. **Unternehmenskennzahlen aktuell halten**: Zuordnungen hängen von Mitarbeiterzahl, IT-Benutzern und Umsatz der Unternehmen ab. Veraltete Kennzahlen verursachen Zuordnungsfehler.

10. **CSV für Masseneinrichtung verwenden**: Wenn Sie von einem anderen System migrieren oder Hunderte von Positionen haben, beginnen Sie mit dem CSV-Import. Exportieren Sie eine Vorlage, füllen Sie sie aus und prüfen Sie sie vor dem Laden.

11. **Deaktivieren statt löschen**: Bewahren Sie die Historie, indem Sie Positionen deaktivieren, wenn sie nicht mehr aktiv sind. Löschen Sie nur bei Fehlern.

12. **Summenzeile überprüfen**: Bevor Sie Budgets finalisieren, prüfen Sie die angeheftete Summenzeile in der Liste, um sicherzustellen, dass Ihre Ausgaben wie erwartet aufgehen.

13. **Deep Linking nutzen**: Klicken Sie direkt auf eine Budgetspalte in der Liste, um zum Budget-Tab für dieses Jahr zu springen. Klicken Sie auf die Aufgaben-Spalte, um zu den Aufgaben der Position im Tab Übersicht zu springen. Das spart Navigationszeit.

14. **Budgets nach Jahresabschluss einfrieren**: Verwenden Sie die Budget-Administration, um Vorjahresbudgets einzufrieren, sobald die Ist-Werte finalisiert sind, um versehentliche Bearbeitungen zu verhindern.

---

## Berechtigungen

Der OPEX-Zugriff wird durch drei Stufen gesteuert:

- `opex:reader`: OPEX-Liste anzeigen, Positionen öffnen, Budgets und Zuordnungen einsehen (schreibgeschützt), Anhänge herunterladen
- `opex:manager`: OPEX-Positionen erstellen und bearbeiten, Budgets und Zuordnungen aktualisieren, Anhänge hochladen und löschen, Verknüpfungen verwalten
- `opex:admin`: Alle Manager-Rechte plus CSV-Import/Export, Budget-Operationen (Einfrieren, Kopieren, Zurücksetzen) und Massenlöschung

Zusätzlich:
- Aufgaben haben separate Berechtigungen (`tasks:member` zum Erstellen/Bearbeiten von Aufgaben an OPEX-Positionen)
- Benutzer mit `tasks:reader` können Aufgaben anzeigen, aber nicht erstellen oder bearbeiten

Wenn Sie eine Aktion nicht ausführen können (z. B. die Schaltfläche **CSV importieren** fehlt, Anhänge nicht hochladen können), prüfen Sie mit Ihrem Arbeitsbereich-Administrator Ihre Rollenberechtigungen.

---

## Hilfe benötigt?

- **CSV-Probleme**: Laden Sie eine frische Vorlage herunter, stellen Sie UTF-8-Kodierung sicher und führen Sie eine Vorprüfung durch, um detaillierte Fehler zu sehen
- **Zuordnungsfehler**: Prüfen Sie, ob alle Unternehmen die erforderlichen Kennzahlen (Mitarbeiterzahl, IT-Benutzer, Umsatz) für das ausgewählte Jahr haben
- **Warnung „Veraltetes Konto"**: Das Konto gehört nicht zum Kontenplan des zahlenden Unternehmens; wählen Sie ein anderes Konto
- **Fehlende Schaltflächen oder Tabs**: Ihre Rolle hat möglicherweise nicht die erforderliche Berechtigungsstufe (Manager oder Admin). Kontaktieren Sie Ihren Arbeitsbereich-Administrator
