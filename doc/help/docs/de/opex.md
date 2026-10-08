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
  - **Analysedimensionen**: Ein Feld pro Dimension, nach ihr benannt, für eine eigene Gruppierung in Berichten (z. B. „Licenses“ in Nature). Die Standarddimension erscheint als **Analysedimension**, bis sie umbenannt wird. Siehe [Analysedimensionen](analytics.md)
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
  - **VZÄ-Spalten**: Die VZÄ jeder angezeigten Budgetspalte für J-1, J, J+1 und J+2, unter den Namen, die Ihre Organisation gewählt hat, in der Spaltenauswahl direkt nach den Betragsspalten. Die Überschrift nennt die Spalte und das Kalenderjahr, zum Beispiel **VZÄ Budget (2026)**. Die VZÄ einer Position sind die Summe der VZÄ ihrer Zeilen in dieser Spalte. Siehe [VZÄ](#vza). Die Zelle ist leer, wenn die Spalte keine Zeilen hat
  - **Aktiviert**: Positionsstatus (aktiviert oder deaktiviert)
  - **Beschreibung**: Positionsbeschreibung
  - **Währung**: ISO-Währungscode
  - **Gültig ab**: Startdatum
  - **Ende der Gültigkeit**: Datum, an dem die Position endet (leer bedeutet kein Ende)
  - **IT-Verantwortlicher** / **Fachbereichsverantwortlicher**: Zuständige Benutzer
  - **Analysedimensionen**: Eine Spalte pro aktivierter Dimension, nach ihr benannt, mit dem Wert der Position. Die Spalte der Standarddimension steht zuerst (**Analysedimension**, bis sie umbenannt wird), danach die anderen Dimensionen in ihrer Reihenfolge
  - **Kostenstelle**: Code und Name der Kostenstelle. Fahren Sie mit der Maus darüber, um ihren vollständigen Pfad im Baum zu sehen; klicken Sie darauf, um die Kostenstelle zu öffnen
  - **Budgetverantwortlicher**: Der Budgetverantwortliche der Kostenstelle der Position. Er wird aus der Kostenstelle abgeleitet und nicht auf der Position gespeichert: Ändern Sie den Budgetverantwortlichen einer Kostenstelle, und alle ihre Positionen folgen
  - **Run oder Build**: **Run** oder **Build**
  - **Projekt**: Namen der im Tab Verknüpfungen verknüpften Projekte
  - **Notizen**: Interne Notizen
  - **Erstellt / Aktualisiert**: Zeitstempel

**Filtern**:
  - **Schnellsuche**: Durchsucht Referenz, Produktname, Beschreibung, Lieferant, zahlendes Unternehmen, Konto, Vertrag, Projektnamen, Zuordnung, Verantwortliche, Analysewerte, Kostenstelle (Code, Name und Pfad), Budgetverantwortlicher, Notizen, Währung und Status. Filtert die Liste in Echtzeit während der Eingabe, unabhängig von Akzenten und Groß-/Kleinschreibung
  - **Spaltenfilter**: Klicken Sie auf das Filtersymbol in einer Spaltenüberschrift. **Lieferant**, **Zahlendes Unternehmen**, **Konto**, **Zuordnung**, **Währung**, **IT-Verantwortlicher**, **Fachbereichsverantwortlicher**, jede Analysedimension, **Kostenstelle**, **Budgetverantwortlicher**, **Run oder Build** und **Aktiviert** verwenden Kontrollkästchen-Set-Filter (Mehrfachauswahl). Der Filter **Aktiviert** bietet **Aktiviert** und **Deaktiviert** und grenzt die Liste ein, wenn **Anzeigen** auf **Alle** steht. Wenn Sie darin auf **Leeren** klicken oder beide Werte abwählen, zeigt die Liste nichts mehr an, unabhängig von **Anzeigen**
  - **Alle außer einigen**: Aktivieren Sie **Alle** und deaktivieren Sie dann die Werte, die Sie ausschließen möchten: Der Filter behält alles außer diesen (die Überschrift zeigt dann zum Beispiel **Alle außer 3**), und ein später angelegter Wert wird automatisch einbezogen
  - **Betragsfilter**: Jede Betragsspalte hat einen Zahlenfilter. Eine Zahl im Feld unter der Überschrift behält die Positionen mit mindestens diesem Betrag. Öffnen Sie das Filtermenü für die anderen Bedingungen: größer als, kleiner als, gleich, ungleich oder zwischen zwei Beträgen
  - **VZÄ-Filter**: Jede VZÄ-Spalte hat einen Zahlenfilter mit denselben Bedingungen, dazu leer und nicht leer. **Leer** behält die Positionen, deren Spalte keine Zeilen hat
  - **Datumsfilter**: **Gültig ab**, **Ende der Gültigkeit**, **Erstellt** und **Aktualisiert** haben Datumsfilter. Wählen Sie ein Datum im Feld unter der Überschrift, um die Positionen an diesem Datum zu behalten, oder öffnen Sie das Filtermenü für vor, nach, zwischen, leer oder nicht leer
  - **Textspalten** verwenden Textfilter, unabhängig von Akzenten und Groß-/Kleinschreibung. Geben Sie bei **Ref** die Nummer oder die vollständige Referenz ein, zum Beispiel `12` oder `OPX-12`
  - **Statusbereich**: Verwenden Sie den Umschalter **Anzeigen: Alle / Aktiv / Deaktiviert** über dem Grid (Standard ist **Aktiv**)
  - **Eine Ansicht teilen**: Ihre Sortierung, Suche und Filter werden in der Webadresse der Seite gespeichert. Ein Neuladen der Seite oder das Teilen des Links öffnet dieselbe Ansicht wieder. Ein Link, dessen Filter nicht mehr verfügbar sind, zeigt „Die Filter dieses Links sind nicht mehr verfügbar.“

**Sortierung**:
  - Klicken Sie auf eine Spaltenüberschrift, um aufsteigend/absteigend zu sortieren. Jede Spalte ist sortierbar, auch jede Betrags- und VZÄ-Spalte. Positionen ohne VZÄ stehen bei aufsteigender Sortierung am Ende
  - Textspalten sortieren in natürlicher Lesereihenfolge: Ein Name mit Akzent wird neben seiner unakzentuierten Schreibweise eingeordnet (zum Beispiel „Électricité“ neben „Electricite“), und Kleinbuchstaben stehen vor Großbuchstaben, wenn die Buchstaben sonst gleich sind
  - Standardmäßig wird nach der Standardspalte des aktuellen Jahres sortiert, höchster Betrag zuerst (**Budget J** mit den Standardeinstellungen). Die Schaltflächen **Zurück** und **Weiter** des Arbeitsbereichs folgen derselben Reihenfolge
  - Die Liste merkt sich Ihre letzte Sortierung, Suche und Filter bei der Rückkehr

**Summenzeile**:
  - Die angeheftete Zeile unten zeigt die Summe jeder Betragsspalte, in der Berichtswährung
  - Jede angezeigte VZÄ-Spalte zeigt die Summe der VZÄ der Positionen. Haben einige Positionen keine VZÄ, folgt die Anzahl auf die Summe, zum Beispiel „3.50 · 12 unbekannt“. Fahren Sie mit der Maus darüber, um den vollständigen Satz zu lesen: „Unbekannt für 12 Zeilen“. Hat keine Position VZÄ, bleibt die Summe leer, und nur die Anzahl erscheint
  - Summen berücksichtigen Ihre aktuellen Filter und Suche

**Deep Linking**:
  - Das Anklicken einer beliebigen Zelle öffnet den Arbeitsbereich auf dem relevantesten Tab:
    - **Produktname**, **Lieferant**, **Zahlendes Unternehmen**, **Konto** und andere allgemeine Spalten: Öffnet den **Übersichts**-Tab
    - **Betragsspalten** (Budget J, Erwarteter Endwert J, Revision J+1 usw.) und **VZÄ-Spalten**: Öffnet den **Budget**-Tab voreingestellt auf das Jahr der Spalte
    - **Zuordnung**: Öffnet den **Zuordnungen**-Tab für das aktuelle Jahr
    - **Aufgabe**: Öffnet den Tab **Übersicht**, in dem sich der Aufgabenbereich befindet
    - **Vertrag**: Öffnet den verknüpften Vertrags-Arbeitsbereich direkt (nicht den OPEX-Arbeitsbereich)
    - **Kostenstelle**: Öffnet den Kostenstellen-Arbeitsbereich

**Aktionen**:
  - **Neu**: Neue OPEX-Position erstellen (erfordert `opex:manager`)
  - **CSV importieren**: Massenladen von Positionen aus CSV (erfordert `opex:admin`)
  - **CSV exportieren**: Positionen als CSV exportieren (erfordert `opex:admin`)
  - **Auswahl löschen**: Massenlöschung ausgewählter Positionen (erfordert `opex:admin`; Zeilen über Kontrollkästchen auswählen). Eine Position mit Beträgen in einer eingefrorenen Spalte kann nicht gelöscht werden: Die anderen werden gelöscht, und die Meldung nennt jede abgelehnte Position mit ihrem Grund

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
  - Kann eine Speicherung nicht sofort erfolgen, weil gerade eine andere Speicherung auf denselben Daten läuft, wiederholt KANAP sie automatisch für Sie
  - Läuft ein Budgetvorgang für mehrere Positionen (zum Beispiel eine Spaltenkopie oder ein Zurücksetzen in der Budgetadministration), werden Änderungen hier mit der Meldung „Ein anderer Budgetvorgang läuft gerade. Bitte versuchen Sie es erneut, wenn er abgeschlossen ist.“ zurückgestellt. Versuchen Sie es erneut, sobald er abgeschlossen ist

**Gleichzeitiges Bearbeiten**:
  - Zwei Personen können dieselbe Position gleichzeitig bearbeiten, ohne sich zu stören. Die Bearbeitung unterschiedlicher Felder, unterschiedlicher Budgetmonate oder unterschiedlicher Budgetspalten führt nie zu einem Konflikt, selbst auf derselben Position im selben Moment
  - Ändert jemand anderes dasselbe Feld, dieselbe Budgetspalte oder die Zuordnung, während Sie sie bearbeiten, zeigt ein Banner den anderen Wert und Ihren, mit wer ihn geändert hat und wann. Wählen Sie **Anderen Wert behalten**, um dessen Wert zu übernehmen, oder **Ihren Wert übernehmen**, um Ihre Eingabe zu behalten. Bei einer Budgetspalte lauten die Optionen **Spalte neu laden** oder **Überschreiben**; bei der Zuordnung **Zuordnung neu laden** oder **Überschreiben**
  - Nur das geänderte Feld, die Spalte oder die Zuordnung wartet auf Ihre Wahl; alles andere wird weiterhin wie gewohnt gespeichert
  - Eine wartende Wahl bleibt erhalten, wenn Sie den Tab wechseln. Sie geht, nach einer Warnung, verloren, wenn Sie die Position verlassen oder das Jahr wechseln
  - War die frühere Änderung Ihre eigene, aus einem anderen Fenster oder Tab, sagt das Banner das, statt jemand anderen zu nennen

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
  - **Lieferant**, **Kostenstelle**, **Zahlendes Unternehmen**, **Konto** (gefiltert nach dem Kontenplan des zahlenden Unternehmens), **Währung** (nur die in Ihrem Arbeitsbereich erlaubten Währungen), ein Feld pro Analysedimension, **Run oder Build** und **Beginn der Gültigkeit**
  - **Lebenszyklus**: der Statusschalter, dessen Beschriftung den aktuellen Zustand zeigt (**Aktiviert** oder **Deaktiviert**), und das Datum **Ende der Gültigkeit**. Siehe [Status und Lebenszyklus](#status-und-lebenszyklus)
  - Die Daten **Erstellt** und **Aktualisiert** (schreibgeschützt)
  - Geben Sie in **Lieferant**, **Zahlendes Unternehmen**, **Konto**, **IT-Verantwortlicher**, **Fachbereichsverantwortlicher** oder einem Analysedimensionsfeld Text ein, um nach Namen zu suchen. Treffer erscheinen während der Eingabe, sodass Sie jeden Wert auch in einer sehr langen Liste finden; eine Zeile unter der Liste zeigt „Weiter tippen, um einzugrenzen: es gibt weitere Ergebnisse“, wenn es mehr Treffer gibt als angezeigt werden

**Kostenstelle**:
  - Die Liste zeigt den Kostenstellenbaum. Gruppen werden zur Orientierung angezeigt und können nicht gewählt werden. Suchen Sie nach Code, Name oder Gruppenname
  - Eine deaktivierte Kostenstelle ist als **Deaktiviert** markiert. Sie bleibt auf den Positionen, die sie bereits haben, und kann für keine andere Position gewählt werden
  - Wenn Sie eine Position erstellen und das zahlende Unternehmen leer ist, füllt die Wahl einer Kostenstelle das zahlende Unternehmen mit dem Unternehmen der Kostenstelle, sodass die Liste **Konto** den Kontenplan dieses Unternehmens zeigt. Solange Sie nicht selbst ein Unternehmen oder ein Konto wählen, aktualisiert die Wahl einer anderen Kostenstelle auch das Unternehmen
  - Wenn sich das zahlende Unternehmen vom Unternehmen der Kostenstelle unterscheidet, bleiben beide erhalten. Ein Hinweis unter dem Feld lautet „Diese Kostenstelle gehört zu", gefolgt vom Namen des Unternehmens
  - Eine über die API gespeicherte Position mit Kostenstelle und ohne zahlendes Unternehmen erhält das Unternehmen der Kostenstelle. Für CSV-Dateien siehe [CSV-Import/Export](#csv-importexport)

**Run oder Build**: **Run**, **Build** oder **Nicht festgelegt**. Damit teilen Sie das Budget auf zwischen dem Betrieb bestehender Services und deren Veränderung.

**Analysedimensionen**:
  - Jede aktivierte Dimension hat ein eigenes Feld, nach der Dimension benannt, in der Reihenfolge der Dimensionen. Wählen Sie einen Wert oder leeren Sie das Feld; die Änderung wird sofort gespeichert
  - Jedes Feld listet die aktivierten Werte seiner Dimension. Ein deaktivierter Wert bleibt auf den Positionen, die ihn bereits haben, und kann für keine andere Position gewählt werden
  - Das Feld kann keinen Wert erstellen: Erstellen Sie ihn unter [Analysedimensionen](analytics.md), oder lassen Sie ihn von einem CSV-Import erstellen
  - Können die Dimensionen nicht geladen werden, ersetzt eine Zeile diese Felder: „Die Dimensionen konnten nicht geladen werden.“

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
  - Klicken Sie auf das Rechnersymbol neben dem Stift (**Menge und Preis**), um dasselbe Feld mit den Zeilen dieser Spalte zu öffnen. Siehe [Menge und Preis](#menge-und-preis).
  - Eine Spalte, die ihren Zeilen folgt (ihre Beträge wurden aus ihren Zeilen von Menge und Preis berechnet), hat eine schreibgeschützte Summe. Klicken Sie auf die Summe oder drücken Sie darauf Enter, um **Menge und Preis** für diese Spalte zu öffnen. Der Stift tut dasselbe. Zeigen Sie mit der Maus auf die Summe, um „Aus den Zeilen berechnet. Öffnen Sie Menge und Preis, um den Betrag zu ändern.“ zu lesen
  - **Monatlich**: Geben Sie Beträge pro Monat (Jan-Dez) für jede angezeigte Spalte ein. Quartalszwischensummen und eine Jahressumme werden angezeigt. Nur die Monate, die Sie ändern, werden gespeichert.
  - Beide Tabs zeigen dieselben Spalten: Prognose erscheint auch in **Jährlich**, wenn sie angezeigt wird.
  - Wechseln Sie mit den Tabs **Jährlich** und **Monatlich** zwischen den Modi. Der Wechsel ändert Ihre Beträge nicht.
  - Ihre Wahl zwischen **Jährlich** und **Monatlich** wird in Ihrem Browser gespeichert, nur für Sie: Der Wechsel ändert nicht, was andere Benutzer sehen, die diese Position öffnen. Bis Sie wählen, öffnet sich eine Spalte in dem Modus, in dem ihre Beträge zuletzt erfasst wurden.

**Einfrierverhalten**:
  - Wenn die Budgetspalten eines Jahres eingefroren sind (über die Budgetadministration), werden die entsprechenden Felder schreibgeschützt und zeigen ein Schloss-Symbol
  - Sie können eingefrorene Daten weiterhin ansehen; Administratoren können sie über **Budgetverwaltung > Administration > Daten einfrieren / auftauen** wieder freigeben
  - Jede Spalte kann unabhängig eingefroren werden

**Einen Betrag verteilen**:
  - Das Feld hat zwei Tabs: **Betrag verteilen** und **Menge und Preis**. Dieser Teil behandelt den ersten
  - Das Verteilungsfeld ist im Tab **Monatlich** immer sichtbar. Im Tab **Jährlich** öffnet es sich über das Stiftsymbol unter einer Summe, und seine Schließen-Schaltfläche schließt es
  - Wählen Sie eine **Spalte** unter den angezeigten Spalten, prüfen Sie den **Betrag**, wählen Sie eine **Verteilung** (**Gleichmäßig** oder **4-4-5**) und legen Sie die Daten **Von** und **Bis** fest. Die Daten gehen vom aktuellen Zeitraum der Spalte aus, die Verteilung von der bisherigen Verteilung der Spalte
  - Das Feld öffnet sich mit der Standardspalte. Der Betrag übernimmt die aktuelle Summe der Spalte, in beiden Tabs, und passt sich an, wenn Sie eine andere Spalte wählen. Er bleibt leer, wenn die Spalte keinen Betrag hat
  - **Jede Änderung wird sofort gespeichert**: der Betrag, wenn Sie das Feld verlassen oder Enter drücken, die Verteilung und die Daten, sobald Sie sie ändern. Es gibt keine Schaltfläche zum Klicken. Ein leerer Betrag oder null speichert nichts
  - **Die Verteilung auf alle Spalten anwenden** ist ein Schalter, standardmäßig eingeschaltet: Jede Spalte, die ihm folgt, erhält dieselbe Verteilung und denselben Zeitraum, und jede behält ihre eigene aktuelle Summe. Das Einschalten verteilt diese Spalten sofort, und der Schalter bleibt für Ihre nächsten Änderungen eingeschaltet. Das Ausschalten allein ändert nichts: Die nächsten Änderungen gelten nur für die gewählte Spalte. Standardmäßig folgt jede Spalte. Ein Budgetadministrator legt unter [Budgetspalten](budget-operations.md#budgetspalten) fest, welche folgen. Eingefrorene Spalten ändern sich nie. Fahren Sie mit der Maus über den Schalter, um zu sehen, welche Spalten folgen und welche ihren eigenen Zeitraum behalten
  - Eine Spalte, die dem Schalter nicht folgt, wird allein verteilt: Der Schalter erscheint nicht, wenn Sie sie verteilen. Der Schalter ist auch ausgeblendet, wenn sich keine andere folgende Spalte ändern kann
  - Spalten, die ihren Zeilen folgen, lässt der Schalter aus: Sie behalten die Beträge ihrer Zeilen, und ein Satz nennt sie, zum Beispiel „Die Spalte Prognose behält ihre Zeilen.“ Folgen alle anderen Spalten ihren Zeilen, erscheint der Schalter nicht
  - Um eine Spalte auf eine gleichmäßige Verteilung über zwölf Monate zurückzusetzen, wählen Sie **Gleichmäßig** und setzen Sie die Daten auf den 1. Januar und den 31. Dezember
  - Summen, die Sie im Tab **Jährlich** eingeben, gelten weiterhin nur für ihre eigene Spalte
  - Die Felder **Von** und **Bis** zeigen den Zeitraum. Fallen Monate heraus, nennt das Feld die Monate, die auf null gesetzt werden („Januar bis März werden auf null gesetzt.“). Ein Zeitraum über das ganze Jahr zeigt keine Zeile. Fahren Sie mit der Maus über das Info-Symbol neben dem Titel des Felds, um die Regel zum 15. zu sehen
  - Mit **4-4-5** werden die Gewichte der zählenden Monate hochskaliert, sodass der gesamte Betrag auf sie entfällt
  - Ein Hinweis erscheint, wenn der Zeitraum über die Daten der Position hinausgeht. Die Verteilung wird trotzdem gespeichert
  - Solange ein Datum fehlt oder kein Monat zählt, nennt das Feld den Grund und speichert nichts
  - Eine Spalte, die ihren Zeilen folgt, zeigt ihre aktuellen Werte in den Feldern ausgegraut, unter dem Satz „Die Beträge stammen aus den 4 Zeilen von Menge und Preis.“ Klicken Sie auf **Stattdessen Betrag verteilen**, um die Felder dieser Spalte freizugeben. Der Satz lautet dann „Eine Verteilung ersetzt die Beträge der Zeilen. Die Zeilen bleiben als Referenz erhalten.“ Die Sperre kehrt zurück, wenn Sie die Spalte, das Jahr oder das Feld wechseln
  - Eine Verteilung über eine aus Zeilen aufgebaute Spalte behält ihre Zeilen als Referenz. Siehe [Menge und Preis](#menge-und-preis)

**Wie jede Spalte entstanden ist**:
  - Eine kurze Kennzeichnung zeigt, woher die Beträge einer Spalte stammen. Im Tab **Monatlich** steht sie unter der Spaltenüberschrift (fahren Sie mit der Maus darüber, um den Zeitraum zu sehen). Im Tab **Jährlich** steht sie neben dem Zeitraum
  - **Gleichmäßig verteilt**, **Nach 4-4-5 verteilt** oder **Nach Quartal verteilt**: Die Beträge stammen aus einer Verteilung
  - **Kopiert aus Budget 2025 +2 %**: Die Beträge stammen aus **Budgetspalten kopieren** in der Budgetadministration, mit dem Prozentsatz, falls einer angewendet wurde
  - **Menge und Preis · 3 Zeilen · 1.00 VZÄ**: Die Beträge stammen aus Zeilen, mit ihrer Anzahl und, wenn die Zeilen Personen oder Tage zählen, den VZÄ der Spalte. Die VZÄ sind der Jahresdurchschnitt. Fahren Sie mit der Maus über die Kennzeichnung, um die Zeilen zu sehen, zum Beispiel „Projektleitung: 1 Person × 1.200 pro Tag, 5 Tage pro Monat, Feb. bis Juli“
  - **Von Hand geändert**: Ein Monat wurde im Raster oder durch einen Import einer Budgetdatei geändert
  - Eine Spalte ohne Kennzeichnung hat die Daten behalten, die sie vor der Einführung der Zeiträume hatte

**Wenn jemand anderes dieselbe Spalte bearbeitet**:
  - Zwei Personen können gleichzeitig unterschiedliche Monate oder unterschiedliche Spalten derselben Position ausfüllen, ohne Konflikt
  - Bei einer monatlichen Eingabe warten, wenn jemand anderes einen der gleichen Monate geändert hat, nur diese Monate auf Ihre Wahl; die übrigen Monate der Spalte werden gespeichert, wie Sie sie eingegeben haben
  - Hat jemand anderes die Summe der Spalte, ihre Verteilung oder ihre Mengen-und-Preis-Zeilen geändert, während Sie daran arbeiteten, wartet die ganze Spalte: Ein Banner bietet **Spalte neu laden** oder **Überschreiben**. Die Beträge, das Verteilungsfeld und die Zeilen der Spalte bleiben bis zu Ihrer Wahl schreibgeschützt
  - Speichern lädt das Jahr neu, sodass Sie für jede andere Spalte immer die neuesten Zahlen sehen; die Zelle oder Spalte, die Sie bearbeiten, wird dabei nicht gestört

**Werkzeuge im Monatsmodus**:
  - **Spalte leeren**: Das Symbol neben einer Spaltenüberschrift setzt alle Monate dieser Spalte auf null, zum Beispiel bevor Sie den gesamten Betrag in einem einzigen Monat erfassen. Wenn die Spalte Beträge enthält, bestätigen Sie zuerst. Das gilt als Änderung von Hand. Um Beträge und Zeitraum einer Spalte für alle Positionen zu entfernen, verwenden Sie **Budgetspalte zurücksetzen** in der Budgetadministration

**Mehrjahrestrend**:
  - Ein Diagramm unter dem Raster zeigt jede angezeigte Spalte über mehrere Jahre, auch Prognose, wenn sie angezeigt wird, und aktualisiert sich während der Eingabe

**So verwenden Sie ihn**:
  1. Wählen Sie das Jahr, für das Sie planen
  2. Wählen Sie den Tab **Jährlich** oder **Monatlich**
  3. Füllen Sie die relevanten Spalten aus (Budget für die Erstplanung, Ist-Werte für die Nachverfolgung, Erwarteter Endwert für die Zahl zum Jahresende)
  4. Ihre Änderungen werden automatisch gespeichert; neben den Jahres-Tabs erscheint der Hinweis **Wird gespeichert...** / **Gespeichert**

**Tipp**: Für die meisten Positionen ist der Modus Jährlich schneller. Verwenden Sie den Modus Monatlich, wenn die Ausgaben von Monat zu Monat stark schwanken (z. B. saisonale Lizenzen, einmalige Einrichtungsgebühren).

#### Menge und Preis

Bauen Sie eine Spalte aus Zeilen auf, statt ihre Beträge einzugeben. Jede Zeile liest sich wie ein Satz: eine Menge, eine Einheit, ein Stückpreis, wie oft, wann und nach welchem Kalender. Zum Beispiel eine Projektleitung mit 5 Tagen pro Monat zu 1.200 pro Tag von Februar bis Juli und 50 Lizenzen zu 12 pro Stück pro Monat. Die Monate der Spalte sind die Summe ihrer Zeilen. Die Beträge einer Spalte haben jeweils nur eine Quelle: ihre Zeilen, eine Verteilung, einen von Hand eingegebenen Monat oder eine Kopie. Die andere Quelle bleibt als schreibgeschützte Referenz sichtbar, mit einem Link zum Wechseln.

**Den Tab öffnen**:
  - Tab **Jährlich**: Klicken Sie auf das Rechnersymbol neben dem Zeitraum unter einer Summe. Das Feld öffnet sich auf **Menge und Preis** für diese Spalte. Bei einer Spalte, die ihren Zeilen folgt, öffnen auch der Stift und die Summe es
  - Tab **Monatlich**: Klicken Sie oben im Feld auf **Menge und Preis**. Wenn Sie eine Spalte wählen, die ihren Zeilen folgt, oder wenn die Standardspalte eine solche ist, wechselt das Feld auf **Menge und Preis**
  - Wählen Sie oben im Tab die **Spalte**. Eingefrorene Spalten können nicht gewählt werden

**Die Zeilen**:

| Spalte | Was Sie eingeben |
|---|---|
| **Beschreibung** | Wofür die Zeile bezahlt, zum Beispiel „Projektleitung“. Optional, bis zu 200 Zeichen |
| **Menge** | Wie viele, in der Einheit der Zeile. Null oder mehr, bis zu 3 Dezimalstellen |
| **Einheit** | **Personen**, **Tage** oder **Stück**. Die Einheit bestimmt, wofür der Preis gilt, wie oft er zählt, wie der Betrag auf die Monate verteilt wird und die VZÄ |
| **Stückpreis** | Der Preis einer Einheit, in der Währung der Position. Bis zu 4 Dezimalstellen. Ein negativer Preis wird akzeptiert, für eine Gutschrift. Wofür der Preis gilt, steht direkt dahinter: **pro Tag** bei Tagen, **pro Stück** bei Stück und bei Personen eine kleine Liste zur Wahl zwischen **pro Tag** und **pro Monat** |
| **Wie oft** | Richtet sich nach der Einheit. Personen mit Preis pro Tag: ein Kontrollkästchen **Vollzeit** und, wenn es nicht angehakt ist, die **Tage pro Monat**, die sie an der Position arbeiten (mehr als 0, bis 31, mit bis zu 3 Dezimalstellen). Personen mit Preis pro Monat: „pro Monat“. Tage: „über den Zeitraum“. Stück: eine Liste zur Wahl zwischen **pro Monat** und **einmalig** |
| **Von** / **Bis** | Der Zeitraum der Zeile, innerhalb des Jahres. Ein Monat zählt, wenn der Zeitraum seinen 15. Tag abdeckt, wie bei einer Verteilung. Einmalig gekaufte Stücke erhalten stattdessen ein einzelnes **Datum** und fallen in dessen Monat. Wenn jede Zeile ein Datum hat, lautet die Überschrift **Datum** |
| **Kalender** | Nur bei einem Preis pro Tag sichtbar: bei Personen mit Preis pro Tag und bei Tagen. Der Arbeitstagekalender, dessen Tage zählen. Die Liste bietet die aktivierten Kalender an, dazu den Kalender, den eine Zeile bereits verwendet, falls er inzwischen deaktiviert wurde, mit dem Zusatz „(deaktiviert)“. Gibt es noch keinen Kalender, zeigt der Tab „Noch kein Arbeitstagekalender vorhanden.“, mit einem Link **Kalender hinzufügen** für alle, die Kalender anlegen dürfen. Siehe [Arbeitstagekalender](working-day-calendars.md) |
| **Betrag** | Die Summe der Zeile, sobald sie gespeichert ist. Schreibgeschützt |

Jede Zeile hat am Rand eine Nummer. Hat die Spalte mehrere Zeilen, nennen die Hinweise unter der Tabelle sie, zum Beispiel „Zeile 2: Geben Sie Menge und Stückpreis ein, um diese Zeile zu speichern.“

Ist der Tab breit genug, steht jede Zeile in einer Reihe. Auf einem schmaleren Bereich belegt jede Zeile zwei Reihen. Die erste liest sich wie eine Rechnung: **Beschreibung**, **Menge**, **Einheit**, × **Stückpreis** und **Betrag**. Die zweite liest sich wie ein Satz: **Wie oft**, „vom“ Datum „bis“ Datum (oder ein einzelnes **Datum**), „Kalender“ und der **Kalender**. Bei mittlerer Breite rückt **Wie oft** in die erste Reihe. Wenn Sie den Bereich **Eigenschaften** schließen, haben die Zeilen mehr Platz.

Klicken Sie unter der Tabelle auf **Zeile hinzufügen**, um eine Zeile hinzuzufügen, und auf das Kreuz am Ende einer Zeile, um sie zu entfernen. Eine Spalte enthält bis zu 50 Zeilen.

**Einheit und Preis**:

| Einheit | Preis | Wie oft | Betrag jedes Monats des Zeitraums | VZÄ jedes Monats |
|---|---|---|---|---|
| **Personen** | **pro Tag** | **Vollzeit** | Die Arbeitstage des Monats im Kalender × Menge × Stückpreis | Die Menge |
| **Personen** | **pro Tag** | **5 Tage pro Monat** | 5 × Menge × Stückpreis | Menge × 5 ÷ die Arbeitstage des Monats im Kalender |
| **Personen** | **pro Monat** | pro Monat | Menge × Stückpreis | Die Menge |
| **Tage** | **pro Tag** | über den Zeitraum | Menge × Stückpreis, einmal gezählt und gleichmäßig auf die Monate des Zeitraums verteilt | Der Anteil des Monats an den Tagen ÷ die Arbeitstage des Monats im Kalender |
| **Stück** | **pro Stück** | **pro Monat** | Menge × Stückpreis | Keine |
| **Stück** | **pro Stück** | **einmalig** | Menge × Stückpreis, im Monat des Datums | Keine |

  - Verwenden Sie **Personen** für Mitarbeitende, die Monat für Monat an der Position arbeiten. Geben Sie bei einem Preis pro Tag an, wie viel sie arbeiten: Haken Sie **Vollzeit** an, um jeden Arbeitstag des Kalenders vom Beginn bis zum Ende der Zeile zu zählen, oder geben Sie die Tage pro Monat ein. Zum Beispiel kostet eine Projektleitung mit 5 Tagen pro Monat zu 1.200 pro Tag von Februar bis Juli 6.000 pro Monat. Auf einem Kalender mit 21 Arbeitstagen im März zählt dieser Monat 5 ÷ 21, etwa 0,24 VZÄ. Ein Berater in Vollzeit zu 400 pro Tag kostet jeden Monat die Arbeitstage des Monats × 400 und zählt 1 VZÄ
  - Mit Preis pro Monat kosten Personen jeden Monat Menge × Stückpreis, zum Beispiel 1 Person zu 8.000 pro Monat
  - Verwenden Sie **Tage** für eine Anzahl von Tagen, die als ein Paket für den Zeitraum eingekauft wird. Zum Beispiel ergeben 30 Tage zu 1.200 pro Tag von Februar bis Juli 36.000, also 6.000 pro Monat. Jeder Monat enthält 5 Tage: In einem Monat mit 20 Arbeitstagen zählt die Zeile 0,25 VZÄ
  - Verwenden Sie **Stück** für Lizenzen, Geräte oder Abonnements. Pro Monat zählen sie in jedem Monat des Zeitraums: 50 Lizenzen zu 12 pro Stück ergeben 600 pro Monat. Einmalig erhalten sie ein Datum und fallen in dessen Monat: Ein Laptop zu 2.000 am 15. März fällt in den März. Stücke zählen nie als VZÄ
  - Jeder Monat wird auf den Cent gerundet. Wird ein Betrag über den Zeitraum verteilt, fällt die Rundungsdifferenz auf den letzten Monat. Die Monate außerhalb des Zeitraums einer Zeile erhalten nichts von ihr
  - Beim Wechsel der Einheit passt sich der Rest der Zeile an. Personen behalten einen Preis pro Monat, wenn Sie ihn gewählt haben, und erhalten sonst einen Preis pro Tag. Tage erhalten einen Preis pro Tag, über den Zeitraum. Stücke erhalten einen Preis pro Stück und werden einmalig gekauft, mit dem Beginn des Zeitraums der Spalte als Datum. Wechseln Stücke von einmalig zu pro Monat, erhalten sie wieder den Zeitraum der Spalte

**Eine neue Zeile** beginnt mit der Einheit **Personen**, einer Menge von 1, einem Preis pro Tag, **Vollzeit** nicht angehakt mit den noch einzugebenden Tagen pro Monat, dem Zeitraum der Spalte (dem ganzen Jahr, wenn die Spalte keinen hat) und dem Standardkalender. Der Standardkalender ist der Standardkalender des Landes des zahlenden Unternehmens, sonst der erste aktivierte Kalender. Geben Sie den Stückpreis und die Tage pro Monat ein oder haken Sie **Vollzeit** an, und die Zeile wird gespeichert. Ohne aktivierten Kalender beginnt eine neue Zeile mit einem Preis pro Monat.

**Speichern**: Jedes Feld wird gespeichert, wenn Sie es verlassen, Enter drücken oder einen Wert oder ein Datum wählen. Es gibt keine Schaltfläche zum Klicken. Jede Speicherung sendet alle vollständigen Zeilen der Spalte, und die Monate der Spalte folgen sofort. Währenddessen erscheint neben den Jahres-Tabs der Hinweis **Wird gespeichert...**.
  - Eine Zeile ist vollständig, wenn sie eine Menge, einen Stückpreis, einen gültigen Zeitraum oder ein gültiges Datum, bei Personen mit Preis pro Tag die Tage pro Monat oder **Vollzeit** und bei einem Preis pro Tag einen Kalender hat. Bis dahin bleibt sie mit einem Hinweis auf dem Bildschirm, zum Beispiel „Geben Sie Menge und Stückpreis ein, um diese Zeile zu speichern.“, „Geben Sie die Tage pro Monat ein oder wählen Sie Vollzeit.“ oder „Wählen Sie für einen Preis pro Tag einen Kalender.“, und die gespeicherten Zeilen ändern sich nicht
  - Das Entfernen der letzten Zeile entfernt die Zeilen der Spalte, und ihre Beträge bleiben unverändert. Eine aus ihren Zeilen berechnete Spalte gilt dann als von Hand eingegeben. Eine verteilte oder kopierte Spalte behält ihre Verteilung oder Kopie
  - Wird eine Speicherung abgelehnt, erscheint der Grund rot unter der Tabelle, und Ihre Eingabe bleibt stehen. Zum Beispiel „Mitarbeitende am Hauptsitz has no working days for 2027. Add them on the Working-day calendars page.“, wenn ein individueller Kalender das Jahr noch nicht enthält
  - Bei einer eingefrorenen Spalte sind die Zeilen schreibgeschützt. Sie sind auch schreibgeschützt, solange die Spalte sie als Referenz behält, siehe nächster Teil

**Unter der Tabelle**:
  - Die VZÄ der Zeilen, wenn eine Zeile Personen oder Tage zählt, zum Beispiel „VZÄ im Zeitraum 0.24 · Jahresdurchschnitt 0.12“. Siehe [VZÄ](#vza). Die Summe der Spalte steht in der Spalte selbst
  - Woher die Beträge stammen, wenn sie nicht mehr aus den Zeilen stammen: einer der Sätze im nächsten Teil
  - Hinweise, wenn sie zutreffen: „Der Zeitraum reicht über die Daten der Position hinaus.“, ein inzwischen deaktivierter Kalender, zum Beispiel „Mitarbeitende am Hauptsitz ist deaktiviert. Die Zeilen verwenden ihn weiterhin.“, und seit der letzten Speicherung der Zeilen geänderte Arbeitstage
  - **Diese Zeilen auf alle Spalten anwenden**: ein Schalter für dieselben Spalten wie der Schalter im Tab für die Verteilung, hier standardmäßig ausgeschaltet. Das Einschalten schreibt die Zeilen sofort in jede folgende Spalte, und der Schalter bleibt eingeschaltet: Jede spätere Speicherung schreibt die Zeilen auch in diese Spalten. Das Ausschalten allein ändert nichts

**Wenn sich die Beträge auf anderem Weg ändern**: Die Zeilen bleiben als Referenz bei der Spalte, und der Tab nennt, woher die Beträge jetzt stammen, gefolgt vom Link **Die Zeilen wieder verwenden**. Die Zeilen sind dann schreibgeschützt: Sie können keine Zeile hinzufügen, entfernen oder ändern, und der Tab zeigt weder einen Betrag pro Zeile noch VZÄ noch **Diese Zeilen auf alle Spalten anwenden**. Der Link speichert die Zeilen, wie sie sind, und berechnet die Spalte erneut aus ihnen, und die Zeilen sind wieder bearbeitbar. Um eine als Referenz behaltene Zeile zu ändern, klicken Sie zuerst auf **Die Zeilen wieder verwenden** und ändern Sie sie dann.
  - Ein im Tab **Monatlich** eingegebener Monat: „Die Beträge wurden von Hand eingegeben. Die Zeilen wieder verwenden.“
  - Eine Verteilung: „Die Beträge stammen aus einer Verteilung. Die Zeilen wieder verwenden.“
  - **Budgetspalten kopieren** in der Budgetadministration: „Die Beträge wurden aus Budget 2025 kopiert. Die Zeilen wieder verwenden.“ Waren die Quellbeträge nicht aus Zeilen berechnet, überträgt die Kopie die Zeilen der Quellspalte als Referenz. Eine aus ihren Zeilen berechnete Spalte bleibt berechnet, mit um den Prozentsatz erhöhten Preisen. Siehe [Eine aus Zeilen aufgebaute Spalte kopieren](budget-operations.md#eine-aus-zeilen-aufgebaute-spalte-kopieren)
  - Geänderte Arbeitstage eines Kalenders: „Seit der letzten Berechnung geänderte Arbeitstage: März: 20 Tage, jetzt 19“. An der Spalte ändert sich nichts, bis Sie auf **Die Zeilen wieder verwenden** klicken. Die Zeilen bleiben bis dahin bearbeitbar
  - **Budgetspalte zurücksetzen** in der Budgetadministration entfernt die Zeilen zusammen mit den Beträgen. Siehe [Budgetspalte zurücksetzen](budget-operations.md#budgetspalte-zurucksetzen)
  - Eine Budgetdatei ändert die Monate einer Spalte und lässt ihre Zeilen. Siehe [Ein Budget aus einer Tabellenkalkulation laden](budget-file.md)

#### VZÄ

VZÄ (Vollzeitäquivalente) geben an, für wie viele Personen eine Spalte bezahlt. Sie ergeben sich aus den Zeilen: Jeder Monat addiert die VZÄ seiner Zeilen (siehe die Tabelle oben). Daraus folgen zwei Werte, jeweils auf 2 Dezimalstellen gerundet:
  - **Jahresdurchschnitt**: die Summe der zwölf Monate geteilt durch 12. Das sind die VZÄ der Spalte, angezeigt in der Kennzeichnung der Spalte und in den VZÄ-Spalten der OPEX-Liste
  - **VZÄ im Zeitraum**: die Summe der Monate mit Personen oder Tagen, geteilt durch die Anzahl dieser Monate. Stücke zählen nicht mit, daher senken Lizenzen oder ein Laptop diesen Wert nie. Er erscheint unter den Zeilen, solange die Beträge aus ihnen stammen. Nach einer Änderung von Hand, einer Verteilung oder einer Kopie wird er erst wieder angezeigt, wenn Sie die Zeilen wieder verwenden

Zum Beispiel zählt ein Berater in Vollzeit von Februar bis Oktober in jedem dieser 9 Monate 1 VZÄ: 1,00 im Zeitraum und 9 × 1 ÷ 12 = 0,75 für das ganze Jahr. Eine Projektleitung mit 5 Tagen pro Monat von Februar bis Juli zählt etwa 0,24 im Zeitraum und 0,12 für das ganze Jahr. Lizenzen über das ganze Jahr oder ein Laptop im Dezember in derselben Spalte lassen beide Werte unverändert.

  - **Gezählt**: eine Spalte mit Zeilen in Personen oder Tagen
  - **Null**: eine Spalte, deren Zeilen alle in Stück sind. Ihre VZÄ sind 0
  - **Leer**: eine Spalte ohne Zeilen, eine Position ohne Version für dieses Jahr oder ein Jahr nach dem Ende der Gültigkeit der Position. Ihre VZÄ-Zelle bleibt leer, weil KANAP nicht sagen kann, für wie viele Personen sie bezahlt
  - Die VZÄ bleiben bei den Zeilen. Nach einer Änderung von Hand, einer Verteilung oder einer Kopie behält die Spalte die VZÄ ihrer Zeilen. Eine Kopie berechnet die VZÄ aus den kopierten Zeilen neu, mit den Arbeitstagekalendern des Zieljahres

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

**Wenn jemand anderes die Zuordnung bearbeitet**:
  - Methode, Treiber und Zeilen werden zusammen gespeichert. Hat jemand anderes die Zuordnung geändert, während Sie sie bearbeiteten, bietet ein Banner **Zuordnung neu laden** oder **Überschreiben**
  - Ein Jahreswechsel bei einer wartenden Wahl fragt zuerst nach einer Bestätigung

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

**CSV exportieren** und **CSV importieren** befinden sich in der Symbolleiste der OPEX-Liste. Beide erfordern Administrationsrechte auf OPEX (`opex:admin`).

**CSV exportieren** schreibt die OPEX-Budgetdatei für die Positionen, die die Liste zeigt. **CSV importieren** liest eine Datei wieder ein: Sie wird zuerst geprüft, und nichts wird geschrieben, bevor Sie auf **Laden** klicken.

Die Datei enthält eine Zeile pro Position, die Details der Position, ihre Beträge als Spalten und `kanap_token`. [Ein Budget aus einer Tabellenkalkulation laden](budget-file.md) beschreibt die Spalten, die Bedeutung einer Zelle und die beiden Importschritte.

## Status und Lebenszyklus

Jede OPEX-Position hat einen **Status** (Aktiviert oder Deaktiviert) und ein optionales **Ende der Gültigkeit**, das steuert, wann sie in Berichten und Auswahllisten erscheint. Es ist das einzige Enddatum einer Position.

**Funktionsweise**:
  - **Aktiviert**: Die Position ist aktiv und erscheint überall (Listen, Berichte, Zuordnungen)
  - **Ende der Gültigkeit**: Das Datum, an dem die Position endet. Lassen Sie es leer, wenn es kein Ende gibt. Sobald das Ende der Gültigkeit vorbei ist, wechselt der Status innerhalb einer Stunde von selbst auf **Deaktiviert**
  - Nach dem Ende der Gültigkeit:
    - Die Position erscheint nicht mehr in Auswahllisten für neue Verträge oder Zuordnungen
    - Sie wird aus Berichten für Jahre ausgeschlossen, die strikt nach dem Ende der Gültigkeit liegen
    - Historische Daten bleiben erhalten; die Position erscheint weiterhin in Berichten, die Jahre abdecken, in denen sie aktiv war

**Status setzen**:
  - Beim Anlegen der Position können Sie ihr **Ende der Gültigkeit** im Panel **Eigenschaften** festlegen
  - Später ändern Sie den **Status** in der Metadatenleiste oder verwenden das Feld **Lebenszyklus** im Bereich **Eigenschaften** (Statusschalter und **Ende der Gültigkeit**). Wird eine Position ohne Datum deaktiviert, wird ihr Ende der Gültigkeit auf heute gesetzt
  - Sie können ein zukünftiges Ende der Gültigkeit planen (nützlich für geplante Vertragsenden)

**Deaktivierte Positionen anzeigen**:
  - Standardmäßig zeigt die OPEX-Liste nur **aktivierte** Positionen
  - Wählen Sie im Umschalter **Anzeigen: Alle / Aktiv / Deaktiviert** die Option **Deaktiviert** oder **Alle**, um deaktivierte Positionen zu sehen

**Wann deaktivieren vs. löschen**:
  - **Bevorzugen Sie das Deaktivieren**: Bewahrt die Historie, stellt konsistente Berichte sicher und unterstützt Audit-Trails
  - **Nur löschen, wenn**: Die Position versehentlich erstellt wurde
  - Eine Position mit Beträgen in einer eingefrorenen Spalte kann nicht gelöscht werden. Heben Sie zuerst das Einfrieren der Spalte auf, oder setzen Sie stattdessen ein Ende der Gültigkeit
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

8. **Analysedimensionen nutzen**: Geben Sie Positionen einen Wert in jeder Dimension (zum Beispiel Licenses in Nature, Workplace in Program), um Ausgaben in Berichten zu gruppieren.

9. **Unternehmenskennzahlen aktuell halten**: Zuordnungen hängen von Mitarbeiterzahl, IT-Benutzern und Umsatz der Unternehmen ab. Veraltete Kennzahlen verursachen Zuordnungsfehler.

10. **CSV für Masseneinrichtung verwenden**: Wenn Sie von einem anderen System migrieren oder Hunderte von Positionen haben, beginnen Sie mit dem CSV-Import. Exportieren Sie eine neue Datei, füllen Sie Ihre Zeilen aus und prüfen Sie sie vor dem Laden.

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

- **CSV-Probleme**: Exportieren Sie eine neue Datei aus der Liste und prüfen Sie sie erneut. Der Bericht nennt die Zeile und die Spalte jedes Fehlers, und [Ein Budget aus einer Tabellenkalkulation laden](budget-file.md) erklärt, was jede Zelle bedeutet
- **Zuordnungsfehler**: Prüfen Sie, ob alle Unternehmen die erforderlichen Kennzahlen (Mitarbeiterzahl, IT-Benutzer, Umsatz) für das ausgewählte Jahr haben
- **Warnung „Veraltetes Konto"**: Das Konto gehört nicht zum Kontenplan des zahlenden Unternehmens; wählen Sie ein anderes Konto
- **Fehlende Schaltflächen oder Tabs**: Ihre Rolle hat möglicherweise nicht die erforderliche Berechtigungsstufe (Manager oder Admin). Kontaktieren Sie Ihren Arbeitsbereich-Administrator
