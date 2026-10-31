# Budgetzeilen

Eine Budgetzeile ist eine Sache, die Ihr IT-Budget bezahlt, verfolgt über die Jahre. Ihr **Typ** gibt an, um welche Art von Ausgabe es sich handelt:

- **OPEX** (Operating Expenditure / Betriebsausgaben): wiederkehrende Kosten wie Softwarelizenzen, Cloud-Abonnements, Wartungsverträge und Dienstleistungen
- **CAPEX** (Capital Expenditure / Investitionsausgaben): Investitionen in langfristige Vermögenswerte wie Hardwarekäufe, Infrastrukturprojekte und Ausrüstung

Beide Typen stehen in einer Liste und öffnen sich im selben Arbeitsbereich, mit jahresbezogenen Budgetspalten, Zuordnungen und Verknüpfungen zu Lieferanten, Verträgen, Anwendungen und Projekten. Der Typ ändert einige Regeln (Konten, Dimensionen, Leistungsverrechnung, Einfrieren). [OPEX und CAPEX](#opex-und-capex) listet sie auf.

## Erste Schritte

Navigieren Sie zu **Budgetverwaltung > Budgetzeilen**, um die Liste zu sehen. Klicken Sie auf **Neue Zeile**, um eine Zeile zu erstellen.

Der Arbeitsbereich öffnet sich im Erstellungsmodus mit dem Titel **Neue OPEX-Zeile** oder **Neue CAPEX-Zeile**, mit geöffnetem Bereich **Eigenschaften** rechts. Seine erste Zeile ist **Typ**: Wählen Sie **OPEX** oder **CAPEX**. Er beginnt auf dem Typ, auf den die Liste in ihrer Spalte **Typ** gefiltert ist, sonst auf **OPEX**. Geben Sie den Namen der Zeile oben im Titel ein, füllen Sie die Eigenschaften aus und klicken Sie dann auf **Erstellen**.

**Pflichtfelder**:

- **Titel**: Wofür Sie ausgeben oder worin Sie investieren (z. B. „Salesforce Lizenzen“, „Neue Server-Infrastruktur“). Er erscheint in der Spalte **Produktname** der Liste
- **Zahlendes Unternehmen**: Welches Unternehmen bezahlt (erforderlich für die Buchhaltung)
- **Konto**: Das Sachkonto. Es erscheinen nur Konten aus dem Kontenplan des zahlenden Unternehmens, und zwar nur solche, die in [Kontenpläne und Kontenverwaltung](chart-of-accounts.md#opex-oder-capex-konten) zum Typ der Zeile passen: **OPEX und CAPEX**, oder **Nur OPEX** für eine OPEX-Zeile und **Nur CAPEX** für eine CAPEX-Zeile. Eine Zeile, die bereits ein Konto für den anderen Typ hat, behält es und bleibt bearbeitbar. Ein solches Konto für eine neue Zeile oder beim Ändern des Kontos zu wählen, wird abgelehnt
- **Währung**: ISO-Code (z. B. USD, EUR). Standardmäßig Ihre Arbeitsbereich-Währung; kann pro Zeile überschrieben werden
- **Beginn der Gültigkeit**: Wann diese Ausgabe beginnt (TT.MM.JJJJ)
- **Erforderliche Dimensionen**: ein Feld pro Dimension, die für den Typ der Zeile erforderlich ist. Ein neuer Arbeitsbereich hat keine erforderliche Dimension. Siehe [Empfohlene Dimensionen](#empfohlene-dimensionen)

**Optional aber nützlich**:

- **Lieferant**: Wen Sie bezahlen. Verknüpft mit Ihren Lieferanten in den Stammdaten
- **Kostenstelle**: Wer für die Ausgabe verantwortlich ist. Siehe [Kostenstellen](cost-centers.md). Sobald das zahlende Unternehmen gewählt ist, zeigt die Liste die Kostenstellen dieses Unternehmens. Ist das zahlende Unternehmen noch leer, füllt die Wahl einer Kostenstelle es mit dem Unternehmen der Kostenstelle
- **Run oder Build**: **Run** für Ausgaben, die bestehende Services am Laufen halten, **Build** für Ausgaben, die sie schaffen oder verändern
- **Analysedimensionen**: Ein Feld pro Dimension, die für den Typ der Zeile verwendet wird, nach ihr benannt, für eine eigene Gruppierung in Berichten (z. B. **Software** in **Kostenart**). Die Standarddimension erscheint als **Analysedimension**, bis sie umbenannt wird. Siehe [Analysedimensionen](analytics.md)
- **Ende der Gültigkeit**: Das Datum, an dem diese Zeile endet. Lassen Sie es leer, wenn es kein Ende gibt. Danach ist die Zeile deaktiviert und spätere Jahre zählen in den Budgetansichten nicht mehr
- **IT-Verantwortlicher** / **Fachbereichsverantwortlicher**: Wer verantwortlich ist
- **Beschreibung** und **Notizen**: Freitext im Tab **Übersicht**, für beide Typen

Einmal gesetzt, können **Zahlendes Unternehmen** und **Konto** geändert, aber nicht geleert werden. **Lieferant** können Sie jederzeit leeren.

Wenn Sie das zahlende Unternehmen einer Zeile mit Konto ändern und das neue Unternehmen einen anderen Kontenplan verwendet, wird das Konto in derselben Speicherung geleert. **Konto** erscheint dann als Pflichtfeld, mit der Liste aus dem Kontenplan des neuen Unternehmens. Wählen Sie das neue Konto, um abzuschließen.

Sobald die Zeile erstellt ist, schaltet der Arbeitsbereich alle vier Tabs frei: **Übersicht**, **Budget**, **Zuordnungen** und **Verknüpfungen**.

**Tipp**: Sie können Zeilen schnell erstellen und Budgets und Zuordnungen später ergänzen. Beginnen Sie mit dem Wesentlichen und verfeinern Sie iterativ.

---

## OPEX und CAPEX

Jede Zeile hat einen Typ, angezeigt in der Spalte **Typ** der Liste und in der ersten Zeile des Bereichs **Eigenschaften**. Der größte Teil des Arbeitsbereichs funktioniert für beide gleich. Der Typ bestimmt:

- **Konten**: Ein Konto kann auf **OPEX und CAPEX**, **Nur OPEX** oder **Nur CAPEX** gesetzt sein. Siehe [OPEX- oder CAPEX-Konten](chart-of-accounts.md#opex-oder-capex-konten)
- **Dimensionen und Werte**: Eine Dimension oder ein Wert kann nur für einen Typ verwendet werden, und eine Dimension kann für einen Typ erforderlich sein. Der Bereich **Eigenschaften** zeigt nur die Dimensionen, die für den Typ der Zeile verwendet werden. Siehe [OPEX- oder CAPEX-Dimensionen](analytics.md#opex-oder-capex-dimensionen)
- **Leistungsverrechnung**: Die Leistungsverrechnungsberichte öffnen sich auf OPEX-Zeilen und bieten CAPEX-Zeilen oder beide an. Siehe [Berichte](reports.md)
- **Einfrieren**: Eine Budgetspalte wird pro Jahr und pro Typ eingefroren. Siehe [Daten einfrieren / auftauen](budget-operations.md#daten-einfrieren-auftauen)

Der Typ einer Zeile ändert sich mit **Typ ändern…**. Siehe [Typ ändern](#typ-andern).

### Empfohlene Dimensionen

Ein neuer Arbeitsbereich beginnt mit vier empfohlenen Dimensionen, mit ihren Werten, in der Sprache des Arbeitsbereichs:

| Dimension | Was sie aussagt |
|---|---|
| **Kostenart** | Wofür das Geld ausgegeben wird: Hardware, Software, internes und externes Personal, externe Dienstleistungen, Gebäude und Energie, Telekommunikation, Sonstiges. Sie ist die Standarddimension |
| **IT-Bereich** | Der Teil der IT, dem die Ausgabe dient: Rechenzentrum, Rechenleistung, Speicher, Netzwerk, Plattform, Druck, Arbeitsplatz, Anwendung, Betrieb und Support, Sicherheit und Compliance, IT-Management |
| **Zweck** | Warum das Geld ausgegeben wird: Ersatz, Kapazität, Produktivität, Sicherheit, Compliance, Wachstum, Sonstiges |
| **Priorität** | Zwingend, hoch, mittel oder niedrig |

Sie gelten für OPEX- und CAPEX-Zeilen, und keine ist erforderlich. Sie funktionieren wie jede andere Dimension: Ihre Felder stehen im Bereich **Eigenschaften**, und ein Administrator kann sie umbenennen, Werte hinzufügen, eine davon erforderlich machen, sie deaktivieren oder löschen. Ein Administrator kann sie einem bestehenden Arbeitsbereich hinzufügen. Siehe [Empfohlene Dimensionen](analytics.md#empfohlene-dimensionen) unter Analysedimensionen.

Arbeitsbereiche, die vor den empfohlenen Dimensionen angelegt wurden, behalten drei Dimensionen nur für CAPEX-Zeilen, alle erforderlich: **PP&E type**, **Investment type** und **Priority**. Eine neue CAPEX-Zeile braucht dort auf jeder einen Wert.

---

## Referenzen

Jede Zeile hat eine Referenz, zum Beispiel `BL-12`, aus einer einzigen Reihe für OPEX und CAPEX. Sie erscheint in der Spalte **Ref**, in der Kopfzeile des Arbeitsbereichs und in der Seitenadresse (`/ops/budget/BL-12`).

Zeilen, die vor der einzigen Reihe angelegt wurden, hatten zusätzlich eine Nummer `OPX-12` oder `CPX-3`. Diese Nummern funktionieren weiterhin:

- Ein Link oder Lesezeichen zu einer früheren OPEX- oder CAPEX-Seite öffnet die Zeile
- Die Schnellsuche der Liste findet eine Zeile über ihre frühere Nummer
- Die Budgetdatei liest sie in `item_number`. Siehe [Ein Budget aus einer Tabellenkalkulation laden](budget-file.md)
- Plaid findet eine Zeile über beide Nummern. Siehe [Plaid](ai-assistant.md#datensatze-mit-erwahnen)

---

## Mit der Liste arbeiten

Die Liste (unter **Budgetverwaltung > Budgetzeilen**) enthält die OPEX- und CAPEX-Zeilen zusammen. Ihr Titel nennt die Berichtswährung, zum Beispiel **Budgetzeilen (EUR)**. Jeder Betrag der Liste ist in dieser Währung.

**Standardspalten**:

- **Ref**: Die Referenz der Zeile, zum Beispiel `BL-12` (verlinkt zum Tab **Übersicht**)
- **Typ**: **OPEX** oder **CAPEX**
- **Produktname**: Der Titel der Zeile (verlinkt zum Tab **Übersicht**)
- **Lieferant**: Der Lieferantenname
- **Zahlendes Unternehmen**: Welches Unternehmen diese Zeile bezahlt
- **Vertrag**: Der neueste verknüpfte Vertragsname (verlinkt zum Vertrags-Arbeitsbereich)
- **Konto**: Die Sachkonto-Nummer und -Bezeichnung
- **Zuordnung**: Die Zuordnungsmethoden-Bezeichnung für das aktuelle Jahr (verlinkt zum Tab **Zuordnungen**)
- **Budget J** und **Erwarteter Endwert J**: Die Beträge des aktuellen Jahres in der Standardspalte und in der letzten angezeigten Spalte (verlinkt zum Tab **Budget** für dieses Jahr). Mit den Standardeinstellungen sind das Budget und Erwarteter Endwert. Ist die Standardspalte zugleich die letzte angezeigte Spalte, erscheint nur eine Betragsspalte. Siehe [Budgetspalten](budget-operations.md#budgetspalten)
- **Erforderliche Dimensionen**: Eine Spalte pro aktivierter Dimension, die für einen der beiden Typen erforderlich ist, nach ihr benannt. Ein neuer Arbeitsbereich hat keine
- **Aufgabe**: Der neueste Aufgabentitel (verlinkt zum Tab **Übersicht**, in dem sich der Aufgabenbereich befindet)

**Zusätzliche Spalten** (standardmäßig ausgeblendet, über die Spaltenauswahl umschaltbar):

- **Betragsspalten**: Jede angezeigte Budgetspalte für J-1, J, J+1 und J+2, unter den Namen, die Ihre Organisation gewählt hat. Die Überschrift nennt die Spalte, das Jahr relativ zu heute und das Kalenderjahr, zum Beispiel **Revision J+1 (2027)**. Ausgeblendete Spalten werden nicht angeboten
- **VZÄ-Spalten**: Die VZÄ jeder angezeigten Budgetspalte für J-1, J, J+1 und J+2, unter den Namen, die Ihre Organisation gewählt hat, in der Spaltenauswahl direkt nach den Betragsspalten. Die Überschrift nennt die Spalte und das Kalenderjahr, zum Beispiel **VZÄ Budget (2026)**. Die VZÄ einer Zeile sind die Summe der VZÄ ihrer Zeilen unter Menge und Preis in dieser Spalte. Siehe [VZÄ](#vza). Die Zelle ist leer, wenn die Spalte keine solchen Zeilen hat
- **VZÄ gemeldet**: **Ja**, wenn die Zeile in mindestens einer Budgetspalte eines beliebigen Jahres VZÄ meldet, sonst leer. Das sind die Zeilen, die der Filter **Zeilen mit VZÄ** der Berichte behält
- **Aktiviert**: Status der Zeile (aktiviert oder deaktiviert)
- **Beschreibung**: Die Beschreibung der Zeile
- **Währung**: ISO-Währungscode
- **Gültig ab**: Startdatum
- **Ende der Gültigkeit**: Datum, an dem die Zeile endet (leer bedeutet kein Ende)
- **IT-Verantwortlicher** / **Fachbereichsverantwortlicher**: Zuständige Benutzer
- **Analysedimensionen**: Eine Spalte pro aktivierter Dimension, nach ihr benannt, mit dem Wert der Zeile, in der Reihenfolge der Dimensionen. Die Spalte der Standarddimension heißt **Analysedimension**, bis sie umbenannt wird
- **Kostenstelle**: Code und Name der Kostenstelle. Fahren Sie mit der Maus darüber, um ihren vollständigen Pfad im Baum zu sehen; klicken Sie darauf, um die Kostenstelle zu öffnen
- **Budgetverantwortlicher**: Der Budgetverantwortliche der Kostenstelle der Zeile. Er wird aus der Kostenstelle abgeleitet und nicht auf der Zeile gespeichert: Ändern Sie den Budgetverantwortlichen einer Kostenstelle, und alle ihre Zeilen folgen
- **Run oder Build**: **Run** oder **Build**
- **Projekt**: Namen der im Tab **Verknüpfungen** verknüpften Projekte
- **Notizen**: Interne Notizen
- **Erstellt / Aktualisiert**: Zeitstempel

Eine von Ihnen gespeicherte Spaltenanordnung behält ihre eigene Auswahl an Spalten. Die Anordnung, die Sie in der früheren OPEX-Liste gespeichert hatten, gilt auch für diese Liste.

**Nach Typ filtern**:

- Die Spalte **Typ** hat einen Kontrollkästchen-Filter mit **OPEX** und **CAPEX**. Haken Sie einen an, um nur die Zeilen dieses Typs zu sehen
- **Neue Zeile** beginnt auf dem Typ, den der Filter behält. Mit beiden Typen oder ohne Filter beginnt sie auf OPEX
- Die Adresse einer früheren OPEX- oder CAPEX-Liste öffnet diese Liste mit gesetztem Filter **Typ** und behält die Sortierung, Suche und Filter, die sie enthielt

**Filtern**:

- **Schnellsuche**: Durchsucht Referenz (`BL-12` und die früheren `OPX-12` oder `CPX-3`), Produktname, Beschreibung, Lieferant, zahlendes Unternehmen, Konto, Vertrag, Projektnamen, Zuordnung, Verantwortliche, Analysewerte, Kostenstelle (Code, Name und Pfad), Budgetverantwortlicher, Notizen, Währung und Status. Filtert die Liste in Echtzeit während der Eingabe, unabhängig von Akzenten und Groß-/Kleinschreibung
- **Spaltenfilter**: Klicken Sie auf das Filtersymbol in einer Spaltenüberschrift. **Typ**, **Lieferant**, **Zahlendes Unternehmen**, **Konto**, **Zuordnung**, **Währung**, **IT-Verantwortlicher**, **Fachbereichsverantwortlicher**, jede Analysedimension, **Kostenstelle**, **Budgetverantwortlicher**, **Run oder Build** und **VZÄ gemeldet** verwenden Kontrollkästchen-Set-Filter (Mehrfachauswahl). Der Filter **VZÄ gemeldet** bietet **Ja** und **Nein**. Der Filter **Aktiviert** zeigt die Auswahl von **Anzeigen** (**Alle**, **Aktiv** oder **Deaktiviert**): Eine Änderung an einem ändert auch das andere
- **Alle außer einigen**: Aktivieren Sie **Alle** und deaktivieren Sie dann die Werte, die Sie ausschließen möchten: Der Filter behält alles außer diesen (die Überschrift zeigt dann zum Beispiel **Alle außer 3**), und ein später angelegter Wert wird automatisch einbezogen
- **Betragsfilter**: Jede Betragsspalte hat einen Zahlenfilter. Eine Zahl im Feld unter der Überschrift behält die Zeilen mit mindestens diesem Betrag. Öffnen Sie das Filtermenü für die anderen Bedingungen: größer als, kleiner als, gleich, ungleich oder zwischen zwei Beträgen
- **VZÄ-Filter**: Jede VZÄ-Spalte hat einen Zahlenfilter mit denselben Bedingungen, dazu leer und nicht leer. **Leer** behält die Zeilen, deren Spalte keine Zeilen unter Menge und Preis hat
- **Datumsfilter**: **Gültig ab**, **Ende der Gültigkeit**, **Erstellt** und **Aktualisiert** haben Datumsfilter. Das Feld unter der Überschrift zeigt den Filter in Worten mit allen Bedingungen, zum Beispiel „Leer oder nach dem 31. Dez. 2024“. Klicken Sie darauf, um das Filtermenü zu öffnen (am, vor, nach, zwischen, leer oder nicht leer), oder klicken Sie auf ×, um den Filter zu entfernen. **Ende der Gültigkeit** nimmt zwei Bedingungen, verknüpft mit UND oder ODER, zum Beispiel leer oder nach einem Datum
- **Textspalten** verwenden Textfilter, unabhängig von Akzenten und Groß-/Kleinschreibung. Geben Sie bei **Ref** die Nummer oder die vollständige Referenz ein, zum Beispiel `12` oder `BL-12`
- **Statusbereich**: Verwenden Sie den Umschalter **Anzeigen: Alle / Aktiv / Deaktiviert** über dem Grid (Standard ist **Aktiv**). **Aktiv** listet die Zeilen ohne Ende der Gültigkeit oder mit einem Ende im laufenden Jahr oder später: Zeilen, die im laufenden Jahr enden, bleiben bis zum 31. Dezember unter **Aktiv**. **Deaktiviert** listet die Zeilen, die vor dem 1. Januar des laufenden Jahres geendet haben
- **Eine Ansicht teilen**: Ihre Sortierung, Suche und Filter werden in der Webadresse der Seite gespeichert. Ein Neuladen der Seite oder das Teilen des Links öffnet dieselbe Ansicht wieder. Ein Link, dessen Filter nicht mehr verfügbar sind, zeigt „Die Filter dieses Links sind nicht mehr verfügbar.“ Filtert ein Link eine ausgeblendete Spalte, zum Beispiel eine Berichtszeile, die die Liste öffnet, zeigt die Liste diese Spalte für diesen Besuch direkt nach dem Produktnamen an. Ihre gespeicherte Spaltenanordnung ändert sich nicht. Auch die Auswahl unter **Anzeigen** wird in der Adresse gespeichert. Eine aus einem Bericht geöffnete Liste ist eine Ansicht dieses Berichts: Was Sie darin ändern, bleibt in ihrer Adresse, und die über das Menü geöffnete Liste behält Ihre eigene Sortierung, Suche und Filter

**Sortierung**:

- Klicken Sie auf eine Spaltenüberschrift, um aufsteigend/absteigend zu sortieren. Jede Spalte ist sortierbar, auch jede Betrags- und VZÄ-Spalte. Zeilen ohne VZÄ stehen bei aufsteigender Sortierung am Ende
- Textspalten sortieren in natürlicher Lesereihenfolge: Ein Name mit Akzent wird neben seiner unakzentuierten Schreibweise eingeordnet (zum Beispiel „Électricité“ neben „Electricite“), und Kleinbuchstaben stehen vor Großbuchstaben, wenn die Buchstaben sonst gleich sind
- Eine Dimensionsspalte sortiert in der Reihenfolge der Werte der Dimension, festgelegt unter [Analysedimensionen](analytics.md#werte-ordnen), dann nach Name. Zeilen ohne Wert stehen bei aufsteigender Sortierung am Ende
- Standardmäßig wird nach der Standardspalte des aktuellen Jahres sortiert, höchster Betrag zuerst (**Budget J** mit den Standardeinstellungen). Die Schaltflächen **Zurück** und **Weiter** des Arbeitsbereichs folgen derselben Reihenfolge
- Die Liste merkt sich Ihre letzte Sortierung, Suche und Filter bei der Rückkehr

**Summenzeile**:

- Unter der Liste ist eine einzige Zeile **Gesamt** angeheftet. Sie lautet **Gesamt (12 Zeilen)**, mit der Anzahl der Zeilen in der Liste, und zeigt die Summe jeder Betragsspalte
- Ein Schloss-Symbol vor einer Summe bedeutet, dass die Spalte für dieses Jahr eingefroren ist. Es folgt dem Einfrieren jedes Typs in der Liste. Ist die Liste auf einen Typ gefiltert, erscheint das Schloss, wenn dieser Typ eingefroren ist. Enthält sie beide Typen, erscheint es, wenn die Spalte für beide eingefroren ist. Fahren Sie mit der Maus darüber, um **Eingefroren** zu lesen. Siehe [Daten einfrieren / auftauen](budget-operations.md#daten-einfrieren-auftauen)
- Jede angezeigte VZÄ-Spalte zeigt die Summe der VZÄ der Zeilen. Haben einige Zeilen keine VZÄ, folgt die Anzahl auf die Summe, zum Beispiel „3.50 · 12 unbekannt“. Fahren Sie mit der Maus darüber, um den vollständigen Satz zu lesen: „Unbekannt für 12 Zeilen“. Hat keine Zeile VZÄ, bleibt die Summe leer, und nur die Anzahl erscheint
- Summen berücksichtigen Ihre aktuellen Filter und Suche

**Beträge ohne Wechselkurs**:

- Hat die Währung einer Zeile für ein Jahr keinen Wechselkurs, erscheint ihr Betrag für dieses Jahr in seiner eigenen Währung mit einer kleinen orangefarbenen Markierung. Fahren Sie mit der Maus über die Markierung, um zum Beispiel „Kein Wechselkurs für USD im Jahr 2026: nicht in den Summen enthalten.“ zu lesen.
- Die Summen lassen diese Beträge aus, und ein einzeiliger Hinweis unter der Liste nennt sie, zum Beispiel „3 Zeilen ohne Wechselkurs ausgeschlossen: USD 2026.“ Benutzer der Budgetadministration auf Administratorebene sehen außerdem **Kurs eingeben**, das die Währungseinstellungen beim fehlenden Kurs öffnet. Nennt der Hinweis nur eine Währung und ein Jahr, öffnet sich direkt der Dialog für den manuellen Kurs.
- In einer sortierten Spalte stehen diese Zeilen am Ende. Ein Betragsfilter behält sie nie.
- Unter [Manuelle Kurse](currencies.md#manuelle-kurse) können Sie den fehlenden Kurs selbst eingeben.

**Deep Linking**:

- Das Anklicken einer beliebigen Zelle öffnet den Arbeitsbereich auf dem relevantesten Tab:
    - **Ref**, **Produktname**, **Lieferant**, **Zahlendes Unternehmen**, **Konto**, die Dimensionsspalten und andere allgemeine Spalten: Öffnet den Tab **Übersicht**
    - **Betragsspalten** (Budget J, Erwarteter Endwert J, Revision J+1 usw.) und **VZÄ-Spalten**: Öffnet den Tab **Budget**, voreingestellt auf das Jahr der Spalte
    - **Zuordnung**: Öffnet den Tab **Zuordnungen** für das aktuelle Jahr
    - **Aufgabe**: Öffnet den Tab **Übersicht**, in dem sich der Aufgabenbereich befindet
    - **Vertrag**: Öffnet den verknüpften Vertrags-Arbeitsbereich direkt
    - **Kostenstelle**: Öffnet den Kostenstellen-Arbeitsbereich

**Aktionen**:

- **Neue Zeile**: Eine Zeile erstellen (erfordert `budget:member`)
- **Importieren**: Zeilen aus einer Budgetdatei in großer Zahl laden (erfordert `budget:admin`)
- **Exportieren**: Die Zeilen in eine Budgetdatei exportieren (erfordert `budget:admin`)
- **Auswahl löschen**: Massenlöschung ausgewählter Zeilen (erfordert `budget:admin`; Zeilen über Kontrollkästchen auswählen). Eine Zeile mit Beträgen in einer eingefrorenen Spalte kann nicht gelöscht werden. Vor dem Löschen nennt die Bestätigung die behaltenen Zeilen mit der eingefrorenen Spalte. Die anderen werden gelöscht

**Zurück/Weiter-Navigation**:

- Wenn Sie eine Zeile öffnen, zeigt der Arbeitsbereich die Schaltflächen **Zurück** und **Weiter** und einen Zähler, zum Beispiel „Zeile 3 von 47“
- Diese navigieren durch die Liste in der aktuellen Sortierreihenfolge unter Berücksichtigung von Filtern und Suche
- Der Wechsel zu einer anderen Zeile speichert zuerst Ihre ausstehenden Änderungen
- Ihr Listenkontext (Sortierung, Filter, Suche) bleibt erhalten, wenn Sie den Arbeitsbereich schließen

**Tipp**: Verwenden Sie Spaltenfilter und Schnellsuche, um fokussierte Ansichten zu erstellen (z. B. „Alle Cloud-Ausgaben über 10k“, oder **CAPEX** in **Typ** mit **High** in **Priority**), und navigieren Sie dann mit **Zurück**/**Weiter** von Zeile zu Zeile, um Budgets zu überprüfen.

---

## Der Arbeitsbereich

Klicken Sie auf eine beliebige Zeile der Liste, um den Arbeitsbereich zu öffnen. Seine Adresse nennt die Zeile über ihre Referenz, zum Beispiel `/ops/budget/BL-12/overview`. Er besteht aus vier Teilen:

- **Kopfzeile**: die Referenz der Zeile (z. B. `BL-12`) mit einer Kopierschaltfläche, der Titel der Zeile (anklicken, um die Zeile umzubenennen), **Zurück** / **Weiter**, **Teilen** und die Schaltfläche zum Schließen
- **Metadatenleiste** unter dem Titel: **Status**, **IT-Verantwortlicher** und **Fachbereichsverantwortlicher**, direkt bearbeitbar. Hat die Kostenstelle der Zeile einen Budgetverantwortlichen, folgt **Budgetverantwortlicher** danach. Er ist schreibgeschützt und aus der Kostenstelle abgeleitet, nicht auf der Zeile gespeichert: Fahren Sie mit der Maus darüber, um zu sehen, aus welcher Kostenstelle er stammt, und ändern Sie ihn auf der Kostenstelle (siehe [Kostenstellen](cost-centers.md#budgetverantwortlicher-auf-budgetzeilen))
- **Fünf Tabs**: **Übersicht**, **Budget**, **Zuordnungen**, **Verknüpfungen** (der Tab Verknüpfungen zeigt die Anzahl der Verknüpfungen der Zeile) und **Verlauf**
- **Bereich Eigenschaften** rechts: die Hauptfelder der Zeile, beginnend mit **Typ** (bei einer bestehenden Zeile mit **Typ ändern…** daneben, siehe [Typ ändern](#typ-andern)). Öffnen oder schließen Sie ihn mit der Eigenschaften-Schaltfläche; der Arbeitsbereich merkt sich Ihre Wahl

**Auswahl der Verantwortlichen**:

- Im Bereich **Eigenschaften** einer neuen Zeile und in der Metadatenleiste einer bestehenden Zeile beginnen die Listen **IT-Verantwortlicher** und **Fachbereichsverantwortlicher** unter **Zugriff auf die Kostenstelle** mit den Personen, die Budgetzugriff haben und Zeilen der Kostenstelle der Zeile lesen können. Alle anderen folgen nach einem Trennstrich
- Die Eingabe durchsucht wie bisher alle Personen. Sie können jede Person wählen
- Ohne Kostenstelle bleibt die Liste wie gewohnt. Die Gruppe erscheint nicht, wenn sie alle Personen enthielte, etwa wenn niemand einen begrenzten [Datenzugriff](data-access.md) hat
- Ist Ihr eigener Datenzugriff begrenzt, erscheint die Gruppe für die Kostenstellen in Ihrem Zugriff und für die Zeile, die Sie bearbeiten
- Wer als Verantwortlicher gewählt wird, erhält Zugriff auf die Zeile

**Automatisches Speichern**:

- Jede Änderung wird automatisch gespeichert. In der Kopfzeile erscheint der Hinweis **Wird gespeichert...** / **Gespeichert**
- Beim Wechsel des Tabs, beim Wechsel zur vorherigen oder nächsten Zeile oder beim Schließen des Arbeitsbereichs werden ausstehende Änderungen zuerst gespeichert. Schlägt ein Speichervorgang fehl, bleiben Sie an Ort und Stelle und eine Meldung nennt den Grund, sodass keine Änderung unbemerkt verloren geht
- **Strg+S** (**Cmd+S** auf dem Mac) speichert sofort
- Kann eine Speicherung nicht sofort erfolgen, weil gerade eine andere Speicherung auf denselben Daten läuft, wiederholt KANAP sie automatisch für Sie
- Läuft ein Budgetvorgang für viele Zeilen (zum Beispiel eine Spaltenkopie oder ein Zurücksetzen in der Budgetadministration), werden Änderungen hier mit der Meldung „Ein anderer Budgetvorgang läuft gerade. Bitte versuchen Sie es erneut, wenn er abgeschlossen ist.“ zurückgestellt. Versuchen Sie es erneut, sobald er abgeschlossen ist

**Gleichzeitiges Bearbeiten**:

- Zwei Personen können dieselbe Zeile gleichzeitig bearbeiten, ohne sich zu stören. Die Bearbeitung unterschiedlicher Felder, unterschiedlicher Budgetmonate oder unterschiedlicher Budgetspalten führt nie zu einem Konflikt, selbst auf derselben Zeile im selben Moment
- Ändert jemand anderes dasselbe Feld, dieselbe Budgetspalte oder die Zuordnung, während Sie sie bearbeiten, zeigt ein Banner den anderen Wert und Ihren, mit wer ihn geändert hat und wann. Wählen Sie **Anderen Wert behalten**, um dessen Wert zu übernehmen, oder **Ihren Wert übernehmen**, um Ihre Eingabe zu behalten. Bei einer Budgetspalte lauten die Optionen **Spalte neu laden** oder **Überschreiben**; bei der Zuordnung **Zuordnung neu laden** oder **Überschreiben**
- Nur das geänderte Feld, die Spalte oder die Zuordnung wartet auf Ihre Wahl; alles andere wird weiterhin wie gewohnt gespeichert
- Eine wartende Wahl bleibt erhalten, wenn Sie den Tab wechseln. Sie geht, nach einer Warnung, verloren, wenn Sie die Zeile verlassen oder das Jahr wechseln
- War die frühere Änderung Ihre eigene, aus einem anderen Fenster oder Tab, sagt das Banner das, statt jemand anderen zu nennen

### Übersicht

Der Tab Übersicht enthält die Freitextfelder und die Aufgaben der Zeile.

**Was Sie bearbeiten können**:

- **Beschreibung**: Was die Zeile abdeckt
- **Notizen**: Interne Freitext-Notizen

Ersetzt die Zeile eine andere, oder wurde sie nach einer Typänderung ab einem späteren Jahr ersetzt, verknüpft der obere Teil des Tabs die beiden Zeilen: **Ersetzt durch** auf der älteren Zeile, **Folgt auf** auf der neueren.

**Aufgabenbereich**:

- Listet alle mit dieser Zeile verknüpften Aufgaben mit den Spalten **Titel**, **Status**, **Priorität**, **Fälligkeitsdatum** und **Aktionen**. Der Titel des Bereichs zeigt die Anzahl der Aufgaben
- Filter **Status**: Alle (Standard), Aktiv (nicht erledigt), Offen, In Bearbeitung, Ausstehend, Im Test, Erledigt oder Abgebrochen. Die Zurücksetzen-Schaltfläche löscht ihn
- Klicken Sie auf **Aufgabe hinzufügen**, um eine neue, bereits mit dieser Zeile verknüpfte Aufgabe zu öffnen. Titel, Beschreibung, Priorität, Zuständigen und Fälligkeitsdatum füllen Sie im Aufgaben-Arbeitsbereich aus
- Mit dem Öffnen-Symbol gehen Sie zu einer Aufgabe, mit dem Löschsymbol löschen Sie sie (nach Bestätigung)
- Aufgaben haben eigene Berechtigungen (`tasks:member` zum Erstellen und Bearbeiten). Die Stufe Mitglied auf Budget allein berechtigt nicht zum Bearbeiten von Aufgaben; wenden Sie sich an Ihren Administrator, wenn Sie keine Aufgaben erstellen können
- Aufgaben können auch unter **Portfolio > Aufgaben** angezeigt und verwaltet werden, wo alle Aufgaben Ihrer Organisation erscheinen

**Bereich Eigenschaften**:

- **Typ**: **OPEX** oder **CAPEX**. Bei einer bestehenden Zeile öffnet **Typ ändern…** daneben den unter [Typ ändern](#typ-andern) beschriebenen Dialog
- **Lieferant**, **Kostenstelle**, **Zahlendes Unternehmen**, **Konto** (gefiltert nach dem Kontenplan des zahlenden Unternehmens und dem Typ der Zeile), **Währung** (nur die in Ihrem Arbeitsbereich erlaubten Währungen), ein Feld pro Analysedimension, die für den Typ der Zeile verwendet wird, **Run oder Build** und **Beginn der Gültigkeit**
- **Lebenszyklus**: der Statusschalter, dessen Beschriftung den aktuellen Zustand zeigt (**Aktiviert** oder **Deaktiviert**), und das Datum **Ende der Gültigkeit**. Siehe [Status und Lebenszyklus](#status-und-lebenszyklus)
- Die Daten **Erstellt** und **Aktualisiert** (schreibgeschützt)
- Geben Sie in **Lieferant**, **Zahlendes Unternehmen**, **Konto**, **IT-Verantwortlicher**, **Fachbereichsverantwortlicher** oder einem Analysedimensionsfeld Text ein, um nach Namen zu suchen. Treffer erscheinen während der Eingabe, sodass Sie jeden Wert auch in einer sehr langen Liste finden; eine Zeile unter der Liste zeigt „Weiter tippen, um einzugrenzen: es gibt weitere Ergebnisse“, wenn es mehr Treffer gibt als angezeigt werden

**Kostenstelle**:

- Die Liste zeigt den Kostenstellenbaum. Gruppen werden zur Orientierung angezeigt und können nicht gewählt werden. Suchen Sie nach Code, Name oder Gruppenname
- Ist das zahlende Unternehmen gewählt, zeigt die Liste nur die Kostenstellen dieses Unternehmens, mit den Gruppen darüber. Eine Zeile, die bereits eine Kostenstelle eines anderen Unternehmens hat, behält sie in der Liste. Hat das Unternehmen keine Kostenstelle, weist die Liste darauf hin
- Eine deaktivierte Kostenstelle ist als **Deaktiviert** markiert. Sie bleibt auf den Zeilen, die sie bereits haben, und kann für keine andere Zeile gewählt werden
- Wenn Sie eine Zeile erstellen und das zahlende Unternehmen leer ist, zeigt die Liste alle Kostenstellen. Die Wahl einer Kostenstelle füllt das zahlende Unternehmen mit dem Unternehmen der Kostenstelle, sodass die Liste **Konto** den Kontenplan dieses Unternehmens zeigt. Solange Sie nicht selbst ein Unternehmen oder ein Konto wählen, zeigt die Liste weiterhin alle Kostenstellen und die Wahl einer anderen Kostenstelle aktualisiert auch das Unternehmen
- Wenn Sie das zahlende Unternehmen ändern, wird eine Kostenstelle eines anderen Unternehmens beim selben Speichern entfernt. **Kostenstelle** zeigt dann die Kostenstellen des neuen Unternehmens
- Eine Zeile, deren Kostenstelle zu einem anderen Unternehmen gehört, aus einer Datei oder über die API, behält beide. Ein Hinweis unter dem Feld lautet „Diese Kostenstelle gehört zu“, gefolgt vom Namen des Unternehmens
- Eine über die API gespeicherte Zeile mit Kostenstelle und ohne zahlendes Unternehmen erhält das Unternehmen der Kostenstelle. Für importierte Dateien siehe [CSV-Import/Export](#csv-importexport)

**Run oder Build**: **Run**, **Build** oder **Nicht festgelegt**. Damit teilen Sie das Budget auf zwischen dem Betrieb bestehender Services und deren Veränderung.

**Analysedimensionen**:

- Jede aktivierte Dimension, die für den Typ der Zeile verwendet wird, hat ein eigenes Feld, nach der Dimension benannt, in der Reihenfolge der Dimensionen. Eine Dimension, die nur für den anderen Typ verwendet wird, hat keines, und der Wert, den eine Zeile dort hat, bleibt ausgeblendet. Wählen Sie einen Wert oder leeren Sie das Feld; die Änderung wird sofort gespeichert
- Jedes Feld listet die aktivierten Werte seiner Dimension. Ein deaktivierter Wert bleibt auf den Zeilen, die ihn bereits haben, und kann für keine andere Zeile gewählt werden
- Ein Wert, der nur für den anderen Typ verwendet wird, wird nicht angeboten, und seine Wahl wird abgelehnt. Eine Zeile, die ihn bereits hat, behält ihn und bleibt bearbeitbar. Siehe [OPEX- oder CAPEX-Werte](analytics.md#opex-oder-capex-werte)
- Das Feld kann keinen Wert erstellen: Erstellen Sie ihn unter [Analysedimensionen](analytics.md), oder lassen Sie ihn von einem Import erstellen
- Eine erforderliche Dimension ist mit einem Sternchen markiert. Eine neue Zeile braucht einen Wert in ihr: **Erstellen** bricht mit „Kostenart ist erforderlich“ ab, bis Sie einen wählen. Bei einer Zeile mit einem Wert kann das Feld nicht geleert, nur geändert werden. Eine Zeile ohne Wert bleibt bearbeitbar. Wenn Sie eine solche Zeile ändern, fragt KANAP beim Verlassen zuerst: „Kostenart ist erforderlich. Wählen Sie einen Wert, bevor Sie die Seite verlassen.“ **Bleiben** setzt den Cursor in das fehlende Feld. **Trotzdem verlassen** verlässt die Zeile. Siehe [Erforderliche Dimensionen](analytics.md#erforderliche-dimensionen)
- Können die Dimensionen nicht geladen werden, ersetzt eine Zeile diese Felder: „Die Dimensionen konnten nicht geladen werden.“

**Tipp**: Beim Erstellen einer Zeile bedeutet die Warnung „Veraltetes Konto“, dass das ausgewählte Konto nicht zum Kontenplan des zahlenden Unternehmens gehört. Wählen Sie ein anderes Konto, um die Warnung zu beheben. Eine bestehende Zeile, deren Konto außerhalb des Kontenplans ihres Unternehmens liegt, lässt sich weiterhin bearbeiten: Der Kontenplan wird nur geprüft, wenn sich das Unternehmen oder das Konto ändert.

---

### Budget

Der Budget-Tab enthält die Beträge der Zeile, Jahr für Jahr und Spalte für Spalte. Wählen Sie für das gewählte Jahr eine Spalte, legen Sie fest, wie sie aufgebaut ist, und lesen Sie dann das Ergebnis Monat für Monat.

**Jahresauswahl**:

- Verwenden Sie die Jahres-Tabs oben, um zwischen J-2, J-1, J (aktuelles Jahr), J+1 und J+2 zu wechseln
- Jedes Jahr hat seine eigenen Beträge
- Beim Wechsel des Jahres werden Ihre ausstehenden Änderungen zuerst gespeichert. Wartet eine Spalte nach der Änderung einer anderen Person noch auf Ihre Wahl, fragt KANAP zuerst: **Jahr wechseln** verwirft Ihre Werte in dieser Spalte

**Budgetspalten**:

- Der Tab zeigt die Spalten, die Ihre Organisation anzeigt, unter ihren Namen und immer in derselben Reihenfolge. Die Standardspalten sind:
    - **Budget**: Ursprüngliches Jahresbudget, das zu Jahresbeginn genehmigt wurde
    - **Revision**: Budgetaktualisierung im Jahresverlauf (z. B. nach einer Neuprognose oder einer Änderung des Umfangs)
    - **Prognose**: Eine zusätzliche Planungsspalte, standardmäßig ausgeblendet
    - **Ist-Werte**: Tatsächliche Ausgaben, so wie sie im Jahresverlauf erfasst werden
    - **Erwarteter Endwert**: Ihre beste Schätzung des Werts zum Jahresende
- Ein Budgetadministrator kann die Spalten umbenennen, einige ausblenden und die Standardspalte unter **Budgetverwaltung > Administration > Budgetspalten** wählen (siehe [Budgetspalten](budget-operations.md#budgetspalten)). Eine ausgeblendete Spalte behält ihre Beträge
- Jede angezeigte Spalte hat unter den Jahres-Tabs eine Karte: ihren Namen, ihre Summe für das Jahr, die Herkunft ihrer Beträge und ihren Zeitraum, zum Beispiel „Gleichmäßig verteilt“ und „9 Monate, April bis Dezember“. Eine leere Spalte zeigt „Noch nicht erfasst“. Bewegen Sie den Mauszeiger über eine Karte, um ihre Zeilen unter Menge und Preis zu sehen
- Klicken Sie auf eine Karte, um an dieser Spalte zu arbeiten. Der Tab öffnet sich auf der ersten angezeigten Spalte, die nicht eingefroren ist
- Bei nur einer angezeigten Spalte gibt es keine Karten: Der Editor zeigt die Spalte direkt

**Zeitraum einer Spalte**:

- Jede Spalte hat einen Zeitraum innerhalb des Jahres, zum Beispiel April bis Dezember
- Ein Monat zählt, wenn der Zeitraum seinen 15. Tag abdeckt. Ein Zeitraum, der am 10. April beginnt, schließt den April ein; einer, der am 20. April beginnt, startet im Mai
- Eine Spalte ohne Betrag und ohne Zeitraum erhält einen Vorschlag: **Beginn der Gültigkeit** und **Ende der Gültigkeit** der Zeile, begrenzt auf das Jahr. Eine Zeile, die am 1. April beginnt, ergibt den Vorschlag April bis Dezember
- Eine Spalte, die bereits Beträge enthält und keinen Zeitraum hat, gilt als ganzes Jahr, sodass sich vorhandene Daten wie bisher verhalten
- Geht der gespeicherte Zeitraum einer Spalte über die Daten der Zeile hinaus, nennt der Editor den Zeitraum, den das Speichern verwendet, zum Beispiel „Gespeicherter Zeitraum: Januar bis Dezember. Beim Speichern gilt April bis Dezember, nach den Daten der Zeile.“

**Wie eine Spalte aufgebaut ist**:

Der Editor unter den Karten trägt den Namen der Spalte und das Jahr, zum Beispiel **Budget 2026**. Drei Tabs legen fest, wie die Spalte aufgebaut ist:

- **Betrag**: ein Jahresbetrag, auf die Monate verteilt
- **Menge und Preis**: Zeilen, jeweils eine Menge mal ein Stückpreis. Siehe [Menge und Preis](#menge-und-preis)
- **Pro Monat**: zwölf Beträge, in der Tabelle erfasst

Die drei Tabs werden immer angeboten. Eine Spalte öffnet sich auf dem Tab, der zur Herkunft ihrer Beträge passt: **Menge und Preis**, wenn sie aus ihren Zeilen berechnet werden, **Pro Monat** nach einer Änderung von Hand, und **Betrag** für eine leere, verteilte oder kopierte Spalte.

Bei einer leeren Spalte wechselt ein Klick auf einen Tab sofort. Bei einer Spalte mit Beträgen erscheint zuerst eine Frage im Editor, die sagt, was sich ändert. Klicken Sie auf **Wechseln**, um fortzufahren, oder auf **Abbrechen**:

- Zu **Betrag**: Die aktuelle Summe wird zum Betrag, gleichmäßig über den Zeitraum der Spalte verteilt. Die Zeilen der Spalte bleiben als Referenz erhalten
- Zu **Pro Monat**: Die aktuellen Monate bleiben erhalten und werden in der Tabelle bearbeitbar
- Zu **Menge und Preis**: Die Summe ergibt sich aus den Zeilen. Der aktuelle Betrag wird ersetzt, oder die als Referenz behaltenen Zeilen werden wieder verwendet

**Betrag**:

- **Jahresbetrag**: die Summe der Spalte für das Jahr
- **Wann**: **Ganzes Jahr**, **Ein Zeitraum** mit den Daten **Von** und **Bis**, oder **An einem Datum** mit einem einzigen **Datum**
- **Verteilung**: **Gleichmäßig** oder **4-4-5**. An einem Datum gibt es keine Verteilung: Der Monat des Datums erhält den ganzen Betrag
- Ein Satz sagt, was Sie erhalten, zum Beispiel „120.000 von April bis Dezember (9 Monate) gleichmäßig verteilt.“ oder „5.000 am 10. Februar 2026, ganz im Februar.“ Bewegen Sie den Mauszeiger über das Info-Symbol daneben, um die Regel des 15. zu lesen
- Fallen Monate des Jahres außerhalb des Zeitraums, nennt ein Hinweis, welche auf null gesetzt werden, zum Beispiel „Januar bis März werden auf null gesetzt.“
- Eine Warnung erscheint, wenn der Zeitraum über die Daten der Zeile hinausgeht. Der Betrag wird trotzdem gespeichert
- Solange ein Datum fehlt oder kein Monat zählt, nennt ein roter Hinweis den Grund, und nichts wird gespeichert. Lassen die Daten der Zeile keinen Monat im Jahr übrig, zeigt der Editor „Kein Monat von 2026 liegt innerhalb der Daten der Zeile.“ Wählen Sie **Ein Zeitraum**, um die Daten selbst festzulegen
- **Jede Änderung wird sofort gespeichert**: der Betrag, wenn Sie das Feld verlassen oder die Eingabetaste drücken, die übrigen Felder, sobald Sie sie ändern. Es gibt keine Schaltfläche. Ein leerer Betrag oder null speichert nichts
- Bei **4-4-5** werden die Gewichte der zählenden Monate so erhöht, dass der ganze Betrag auf sie entfällt
- Um eine Spalte wieder gleichmäßig auf zwölf Monate zu verteilen, wählen Sie **Ganzes Jahr** und **Gleichmäßig**
- Eine Verteilung auf einer aus Zeilen aufgebauten Spalte behält ihre Zeilen als Referenz. Siehe [Menge und Preis](#menge-und-preis)

**Pro Monat**:

- Der Editor zeigt zum Beispiel „Geben Sie die Beträge in der Spalte Budget der Tabelle unten ein.“ Geben Sie jeden Monat in dieser Spalte von **Ergebnis pro Monat** ein. Die Quartalssummen und die Gesamtsumme folgen während der Eingabe. Nur die Monate, die Sie ändern, werden gespeichert
- Nutzen Sie diesen Modus für einen Auszahlungsplan oder die Meilensteine eines Projekts, zum Beispiel den ganzen Betrag in einem einzigen Monat
- Klicken Sie auf einen Monat einer anderen Spalte in der Tabelle, um diese Spalte pro Monat zu erfassen: Sie wird zur aktiven Spalte, und der Cursor steht in diesem Monat. Bei einer Spalte mit Beträgen fragt der Editor zuerst. Bewegen Sie den Mauszeiger über einen Monat, um „Pro Monat erfassen“ zu lesen. Die Monate einer eingefrorenen Spalte sind nicht anklickbar

**Ausgehend von**:

- Eine leere Spalte, ohne Betrag und ohne Zeile, kann von einer anderen angezeigten Spalte mit Beträgen ausgehen. Der Editor zeigt „Ausgehend von“, dann die Spalte mit ihrer Summe, „angepasst um“, einen Prozentsatz (standardmäßig 0) und **Übernehmen**. Sie können die Spalte auch selbst darunter erfassen
- **Übernehmen** arbeitet wie [Budgetspalten kopieren](budget-operations.md#budgetspalten-kopieren) für diese Zeile und dieses Jahr: Die Monate behalten ihre Form, und der Prozentsatz gilt für jeden Monat. Eine aus ihren Zeilen berechnete Spalte bleibt berechnet, mit um den Prozentsatz erhöhten Stückpreisen. Eine eingefrorene Spalte kann als Quelle dienen
- Schließen die Daten der Zeile Monate der Quelle aus, werden sie nicht übernommen, und ein Hinweis sagt es: „Monate der Spalte Budget außerhalb der Daten der Zeile wurden nicht übernommen.“

**Auch für andere Spalten verwenden**:

- Unter dem Editor gibt **Auch für andere Spalten verwenden…** anderen Spalten denselben Aufbau wie der aktiven Spalte. Der Link erscheint, wenn die aktive Spalte ein Betrag mit gültigem Zeitraum ist oder ihren Zeilen unter Menge und Preis folgt, und eine andere Spalte ihn übernehmen kann
- Der Link listet die anderen angezeigten Spalten unter **Gleicher Aufbau für** auf, jede mit einem Kontrollkästchen. Die Spalten, die unter [Budgetspalten](budget-operations.md#budgetspalten) folgen sollen, sind anfangs angekreuzt. Klicken Sie auf **Übernehmen** oder auf **Abbrechen**
- Von einem Betrag aus übernehmen die angekreuzten Spalten seinen Zeitraum und seine Verteilung, und jede behält ihre eigene Summe. Spalten, die ihren Zeilen folgen, werden nicht angeboten, und ein Satz nennt sie, zum Beispiel „Die Spalte Prognose behält ihre Zeilen.“
- Von Menge und Preis aus erhalten die angekreuzten Spalten dieselben Zeilen, die ihre Beträge ersetzen
- Eingefrorene Spalten und Spalten, die auf Ihre Wahl warten, werden nicht angeboten

**Spalte leeren**:

- **Spalte leeren**, rechts unter dem Editor, setzt jeden Monat der aktiven Spalte auf null, zum Beispiel bevor Sie den ganzen Betrag in einem einzigen Monat erfassen. Enthält die Spalte Beträge, bestätigen Sie zuerst: „Alle Monate der Spalte Budget für 2026 leeren? Die anderen Spalten bleiben unverändert.“ Das zählt als Änderung von Hand
- Um Beträge und Zeitraum einer Spalte für alle Zeilen zu entfernen, verwenden Sie **Budgetspalte zurücksetzen** in der Budget-Administration

**Ergebnis pro Monat**:

- Unter dem Editor zeigt **Ergebnis pro Monat** das Jahr Monat für Monat für jede angezeigte Spalte, in der Währung der Zeile, mit einer Zwischensumme pro Quartal (**Q1** bis **Q4**) und einer Zeile **Gesamt**. Die aktive Spalte ist hervorgehoben
- Ab zwei Spalten gibt eine letzte Zeile die Abweichung jeder Spalte zu einer von ihnen an, zum Beispiel „+12.000 (+1,8 %)“. Wählen Sie diese Spalte unter **Abweichung zu** über der Tabelle. Sie beginnt bei der Standardspalte
- Solange jede Spalte leer oder ein gleichmäßig über das ganze Jahr verteilter Betrag ist, ersetzt ein Satz die Tabelle, zum Beispiel „Alle Spalten sind linear über das ganze Jahr verteilt: Die Monatswerte zeigen nichts Neues.“ **Details anzeigen** öffnet die Tabelle, **Details ausblenden** klappt sie wieder zu. Ihre Wahl gilt, solange Sie auf der Zeile bleiben
- Die Tabelle bleibt offen, solange die aktive Spalte pro Monat erfasst wird oder eine Spalte auf Ihre Wahl wartet

**Zurück zu den Werten beim Öffnen**:

- Der Tab behält die Werte, die jede Spalte eines Jahres hatte, als Sie dieses Jahr während Ihres Besuchs der Zeile zum ersten Mal geöffnet haben. Ein Wechsel des Tabs oder des Jahres behält sie. Ein Neuladen der Seite beginnt mit den Werten dieses Moments neu
- Sobald Sie eine Spalte ändern, steht rechts neben den Jahres-Tabs zum Beispiel „2 Spalten seit 10:42 geändert“, gefolgt von **Zurück zu den Werten beim Öffnen**
- Ein Klick darauf setzt die Spalten, die Sie geändert haben, auf diese Werte zurück. Es gibt keine Bestätigung. Ihre laufenden Änderungen werden zuerst gespeichert, dann wird jede Spalte einzeln wiederhergestellt
- Ein Hinweis nennt das Ergebnis, zum Beispiel „Werte beim Öffnen wiederhergestellt: Budget und Revision.“ Eine Spalte bleibt, wie sie ist, wenn sie inzwischen eingefroren wurde, wenn jemand anderes sie seitdem geändert hat (das Banner oben fragt dann, was gilt) oder solange sie auf Ihre Wahl wartet. Eine Spalte, die nur jemand anderes geändert hat, wird nie wiederhergestellt. Schließen Sie den Hinweis mit **Schließen**
- Kann eine laufende Änderung nicht gespeichert werden, wird nichts wiederhergestellt: „Nichts wurde wiederhergestellt: Eine Änderung konnte vorher nicht gespeichert werden.“
- Das Audit-Protokoll erfasst jede wiederhergestellte Spalte mit der Aktion **Wiederherstellen**

**Einfrierverhalten**:

- Sind die Budgetspalten eines Jahres für den Typ der Zeile eingefroren (über die Budget-Administration), zeigt die Karte jeder eingefrorenen Spalte ein Schloss-Symbol, ebenso ihre Kopfzeile in der Tabelle
- Eine eingefrorene Spalte ist schreibgeschützt. Ihr Editor zeigt zum Beispiel „Die Spalte Budget 2026 ist eingefroren“ und „Schreibgeschützt. Ein Administrator hebt das Einfrieren unter Administration › Daten einfrieren / auftauen auf.“, mit ihrer Summe und der Herkunft ihrer Beträge
- Sind Spalten eingefroren, sagt eine Zeile unter dem Diagramm „Einige Spalten sind eingefroren und schreibgeschützt.“
- Jede Spalte kann unabhängig eingefroren werden

**Wie jede Spalte entstanden ist**:

- Eine kurze Bezeichnung auf jeder Karte nennt die Herkunft der Beträge der Spalte, gefolgt von ihrem Zeitraum. Bei nur einer Spalte steht sie unter dem Titel des Editors
- **Gleichmäßig verteilt**, **Nach 4-4-5 verteilt** oder **Nach Quartal verteilt**: Die Beträge stammen aus einer Verteilung
- **Kopiert aus Budget 2025 +2 %**: Die Beträge stammen aus **Budgetspalten kopieren** in der Budget-Administration oder aus **Ausgehend von**, mit dem Prozentsatz, falls es einen gibt
- **Menge und Preis · 3 Zeilen · 1.00 VZÄ**: Die Beträge stammen aus Zeilen, mit ihrer Anzahl und, wenn die Zeilen Personen oder Tage zählen, den VZÄ der Spalte. Die VZÄ sind der Jahresdurchschnitt. Bewegen Sie den Mauszeiger über die Karte, um die Zeilen zu sehen, zum Beispiel „Projektleiter: 1 Person × 1.200 pro Tag, 5 Tage pro Monat, Feb. bis Juli“
- **Von Hand geändert**: Ein Monat wurde in der Tabelle oder durch den Import einer Budgetdatei geändert
- Ein Betrag an einem Datum zeigt sein Datum statt eines Zeitraums, zum Beispiel „Am 10. Februar 2026“
- Eine Spalte ohne Bezeichnung hat die Daten behalten, die sie vor der Einführung der Zeiträume hatte

**Wenn jemand anderes dieselbe Spalte bearbeitet**:

- Zwei Personen können gleichzeitig unterschiedliche Monate oder unterschiedliche Spalten derselben Zeile ausfüllen, ohne Konflikt
- Bei einer monatlichen Eingabe warten, wenn jemand anderes einen der gleichen Monate geändert hat, nur diese Monate auf Ihre Wahl; die übrigen Monate der Spalte werden gespeichert, wie Sie sie eingegeben haben
- Hat jemand anderes die Summe der Spalte, ihre Verteilung oder ihre Zeilen unter Menge und Preis geändert, während Sie daran arbeiteten, wartet die ganze Spalte: Ein Banner bietet **Spalte neu laden** oder **Überschreiben**. Ihre Karte zeigt einen orangefarbenen Punkt (bewegen Sie den Mauszeiger darüber, um „Wartet auf Ihre Wahl“ zu lesen), und ihre Monate sind eingefärbt. Der Editor bleibt bis zu Ihrer Wahl schreibgeschützt, mit der Zeile „Wählen Sie zuerst oben, ob Sie diese Spalte neu laden oder überschreiben.“
- Speichern lädt das Jahr neu, sodass Sie für jede andere Spalte immer die neuesten Zahlen sehen; die Zelle oder Spalte, die Sie bearbeiten, wird dabei nicht gestört

**Mehrjahrestrend**:

- Ein Diagramm unter der Tabelle zeigt jede angezeigte Spalte über mehrere Jahre, auch Prognose, wenn sie angezeigt wird, und aktualisiert sich während der Eingabe

**So verwenden Sie ihn**:

1. Wählen Sie das Jahr, das Sie planen
2. Klicken Sie auf die Karte der Spalte, die Sie ausfüllen (Budget für die erste Planung, Ist-Werte für die Verfolgung, Erwarteter Endwert für den Wert zum Jahresende)
3. Wählen Sie **Betrag**, **Menge und Preis** oder **Pro Monat** und füllen Sie die Spalte aus
4. Lesen Sie das Ergebnis unter **Ergebnis pro Monat**. Ihre Änderungen werden automatisch gespeichert; neben den Jahres-Tabs erscheint der Hinweis **Wird gespeichert...** / **Gespeichert**

**Tipp**: Für die meisten Zeilen genügt ein Betrag über das ganze Jahr oder einen Zeitraum. Verwenden Sie **Pro Monat**, wenn die Ausgaben von Monat zu Monat deutlich schwanken (z. B. saisonale Lizenzen, einmalige Einrichtungsgebühren, schrittweise Einführungen). Um eine neue Spalte aus einer vorhandenen zu füllen, verwenden Sie **Ausgehend von**.

#### Menge und Preis

Bauen Sie eine Spalte aus Zeilen auf, statt ihre Beträge einzugeben. Jede Zeile liest sich wie ein Satz: eine Menge, eine Einheit, ein Stückpreis, wie oft, wann und nach welchem Kalender. Zum Beispiel eine Projektleitung mit 5 Tagen pro Monat zu 1.200 pro Tag von Februar bis Juli und 50 Lizenzen zu 12 pro Stück pro Monat. Die Monate der Spalte sind die Summe ihrer Zeilen. Die Beträge einer Spalte haben jeweils nur eine Quelle: ihre Zeilen, eine Verteilung, einen von Hand eingegebenen Monat oder eine Kopie. Die andere Quelle bleibt als schreibgeschützte Referenz sichtbar, mit einem Link zum Wechseln.

**Öffnen**: Klicken Sie auf die Karte der Spalte und dann auf den Tab **Menge und Preis** des Editors. Eine aus ihren Zeilen berechnete Spalte öffnet sich auf diesem Tab. Die Zeilen einer eingefrorenen Spalte sind schreibgeschützt.

**Die Zeilen**:

| Spalte | Was Sie eingeben |
|---|---|
| **Beschreibung** | Wofür die Zeile bezahlt, zum Beispiel „Projektleitung“. Optional, bis zu 200 Zeichen |
| **Menge** | Wie viele, in der Einheit der Zeile. Null oder mehr, bis zu 3 Dezimalstellen |
| **Einheit** | **Personen**, **Tage** oder **Stück**. Die Einheit bestimmt, wofür der Preis gilt, wie oft er zählt, wie der Betrag auf die Monate verteilt wird und die VZÄ |
| **Stückpreis** | Der Preis einer Einheit, in der Währung der Budgetzeile. Bis zu 4 Dezimalstellen. Ein negativer Preis wird akzeptiert, für eine Gutschrift. Wofür der Preis gilt, steht direkt dahinter: **pro Tag** bei Tagen, **pro Stück** bei Stück und bei Personen eine kleine Liste zur Wahl zwischen **pro Tag** und **pro Monat** |
| **Wie oft** | Richtet sich nach der Einheit. Personen mit Preis pro Tag: ein Kontrollkästchen **Vollzeit** und, wenn es nicht angehakt ist, die **Tage pro Monat**, die sie an der Budgetzeile arbeiten (mehr als 0, bis 31, mit bis zu 3 Dezimalstellen). Personen mit Preis pro Monat: „pro Monat“. Tage: „über den Zeitraum“. Stück: eine Liste zur Wahl zwischen **pro Monat** und **einmalig** |
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

- Verwenden Sie **Personen** für Mitarbeitende, die Monat für Monat an der Budgetzeile arbeiten. Geben Sie bei einem Preis pro Tag an, wie viel sie arbeiten: Haken Sie **Vollzeit** an, um jeden Arbeitstag des Kalenders vom Beginn bis zum Ende der Zeile zu zählen, oder geben Sie die Tage pro Monat ein. Zum Beispiel kostet eine Projektleitung mit 5 Tagen pro Monat zu 1.200 pro Tag von Februar bis Juli 6.000 pro Monat. Auf einem Kalender mit 21 Arbeitstagen im März zählt dieser Monat 5 ÷ 21, etwa 0,24 VZÄ. Ein Berater in Vollzeit zu 400 pro Tag kostet jeden Monat die Arbeitstage des Monats × 400 und zählt 1 VZÄ
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
- Hinweise, wenn sie zutreffen: „Der Zeitraum reicht über die Daten der Zeile hinaus.“, ein inzwischen deaktivierter Kalender, zum Beispiel „Mitarbeitende am Hauptsitz ist deaktiviert. Die Zeilen verwenden ihn weiterhin.“, und seit der letzten Speicherung der Zeilen geänderte Arbeitstage
- Um anderen Spalten dieselben Zeilen zu geben, verwenden Sie **Auch für andere Spalten verwenden…** unter dem Editor. Siehe [Budget](#budget)

**Wenn sich die Beträge auf anderem Weg ändern**: Die Zeilen bleiben als Referenz bei der Spalte, schreibgeschützt. Unter **Betrag** oder **Pro Monat** sagt eine Zeile, wie viele Zeilen behalten werden, zum Beispiel „4 Zeilen als Referenz behalten (48.000).“, gefolgt vom Link **Die Zeilen wieder verwenden**. Der Link speichert die Zeilen, wie sie sind, und berechnet die Spalte erneut daraus. Die Wahl des Tabs **Menge und Preis** tut dasselbe, nach einer Frage. Um eine als Referenz behaltene Zeile zu ändern, verwenden Sie die Zeilen zuerst wieder und ändern sie dann.

- Die Spalte auf **Betrag** oder **Pro Monat** umstellen, einen Monat in der Tabelle eingeben oder **Spalte leeren**
- **Budgetspalten kopieren** in der Budgetadministration oder **Ausgehend von**: Waren die Quellbeträge nicht aus Zeilen berechnet, überträgt die Kopie die Zeilen der Quellspalte als Referenz. Eine aus ihren Zeilen berechnete Spalte bleibt berechnet, mit um den Prozentsatz erhöhten Preisen. Siehe [Eine aus Zeilen aufgebaute Spalte kopieren](budget-operations.md#eine-aus-zeilen-aufgebaute-spalte-kopieren)
- Geänderte Arbeitstage eines Kalenders: Der Tab **Menge und Preis** zeigt zum Beispiel „Seit der letzten Berechnung geänderte Arbeitstage: März: 20 Tage, jetzt 19.“, gefolgt von **Die Zeilen wieder verwenden**. An der Spalte ändert sich nichts, bis Sie auf **Die Zeilen wieder verwenden** klicken. Die Zeilen bleiben bis dahin bearbeitbar
- **Budgetspalte zurücksetzen** in der Budgetadministration entfernt die Zeilen zusammen mit den Beträgen. Siehe [Budgetspalte zurücksetzen](budget-operations.md#budgetspalte-zurucksetzen)
- Eine Budgetdatei ändert die Monate einer Spalte und lässt ihre Zeilen. Siehe [Ein Budget aus einer Tabellenkalkulation laden](budget-file.md)

#### VZÄ

VZÄ (Vollzeitäquivalente) geben an, für wie viele Personen eine Spalte bezahlt. Sie ergeben sich aus den Zeilen unter Menge und Preis: Jeder Monat addiert die VZÄ seiner Zeilen (siehe die Tabelle oben). Daraus folgen zwei Werte, jeweils auf 2 Dezimalstellen gerundet:

- **Jahresdurchschnitt**: die Summe der zwölf Monate geteilt durch 12. Das sind die VZÄ der Spalte, angezeigt in der Kennzeichnung der Spalte und in den VZÄ-Spalten der Liste
- **VZÄ im Zeitraum**: die Summe der Monate mit Personen oder Tagen, geteilt durch die Anzahl dieser Monate. Stücke zählen nicht mit, daher senken Lizenzen oder ein Laptop diesen Wert nie. Er erscheint unter den Zeilen, solange die Beträge aus ihnen stammen. Nach einer Änderung von Hand, einer Verteilung oder einer Kopie wird er erst wieder angezeigt, wenn Sie die Zeilen wieder verwenden

Zum Beispiel zählt ein Berater in Vollzeit von Februar bis Oktober in jedem dieser 9 Monate 1 VZÄ: 1,00 im Zeitraum und 9 × 1 ÷ 12 = 0,75 für das ganze Jahr. Eine Projektleitung mit 5 Tagen pro Monat von Februar bis Juli zählt etwa 0,24 im Zeitraum und 0,12 für das ganze Jahr. Lizenzen über das ganze Jahr oder ein Laptop im Dezember in derselben Spalte lassen beide Werte unverändert.

- **Gezählt**: eine Spalte mit Zeilen in Personen oder Tagen
- **Null**: eine Spalte, deren Zeilen alle in Stück sind. Ihre VZÄ sind 0
- **Leer**: eine Spalte ohne Zeilen, eine Budgetzeile ohne Version für dieses Jahr oder ein Jahr nach dem Ende der Gültigkeit der Budgetzeile. Ihre VZÄ-Zelle bleibt leer, weil KANAP nicht sagen kann, für wie viele Personen sie bezahlt
- Die VZÄ bleiben bei den Zeilen. Nach einer Änderung von Hand, einer Verteilung oder einer Kopie behält die Spalte die VZÄ ihrer Zeilen. Eine Kopie berechnet die VZÄ aus den kopierten Zeilen neu, mit den Arbeitstagekalendern des Zieljahres

---

### Zuordnungen

Der Tab Zuordnungen verteilt die Ausgabe eines Jahres auf Ihre Unternehmen und Abteilungen. Die Zuordnungen speisen die Leistungsverrechnungsberichte und die Kosten-pro-Benutzer-KPIs, für OPEX- und CAPEX-Zeilen.

**Jahresauswahl**:

- Funktioniert wie beim Budget: Wechseln Sie mit den Jahres-Tabs zwischen J-2, J-1, J, J+1, J+2
- Jedes Jahr kann eine andere Zuordnungsmethode haben
- Die Jahressumme der Standardspalte erscheint rechts, zum Beispiel **Budget, Jahressumme**, und die Tabelle zeigt jeden Anteil als Prozentsatz und als Betrag, mit einer Summenzeile

**Zuordnungsmethoden**:

| Methode | Funktionsweise |
|---|---|
| **Mitarbeiterzahl (Standard)** | Teilt Ausgaben proportional nach der Mitarbeiterzahl jedes Unternehmens für das ausgewählte Jahr. Keine manuelle Auswahl erforderlich: Die Prozentsätze werden automatisch aus den Unternehmenskennzahlen berechnet. Das ist der Standard. |
| **IT-Benutzer** | Teilt Ausgaben proportional nach der Anzahl der IT-Benutzer jedes Unternehmens für das ausgewählte Jahr. |
| **Umsatz** | Teilt Ausgaben proportional nach dem Umsatz jedes Unternehmens für das ausgewählte Jahr, umgerechnet in die Berichtswährung. |
| **Manuell nach Unternehmen** | Sie wählen aus, welche Unternehmen diese Ausgabe erhalten, und wählen unter **Zuordnen nach** einen Treiber (Mitarbeiterzahl, IT-Benutzer oder Umsatz), um die Prozentsätze nur unter den ausgewählten Unternehmen zu berechnen. |
| **Manuell nach Abteilung** | Sie wählen bestimmte Unternehmen/Abteilungs-Paare aus. Die Prozentsätze werden aus der Mitarbeiterzahl jeder Abteilung berechnet. Nützlich, wenn eine Zeile nur bestimmten Abteilungen zugutekommt (z. B. ein CRM, das vom Vertrieb genutzt wird). |
| **Manuelle Prozentsätze** | Sie wählen die Unternehmen und geben jeden Prozentsatz selbst ein. Die Summe muss 100 % ergeben. |

**Standard- und fixierte Methoden**:

- Der **Standard**-Eintrag, angezeigt als *Mitarbeiterzahl (Standard)*, bis Ihre Organisation eine andere Methode konfiguriert, folgt der Einstellung unter **Budgetverwaltung > Administration > Standard-Zuordnungsmethode**. Jede Zeile, die auf Standard bleibt, wird neu berechnet, wenn ein Administrator diese Einstellung ändert
- Diese Einstellung kann den Standard auch auf eine **Auswahl von Unternehmen** beschränken (zum Beispiel das Unternehmen, das das IT-Budget trägt): Der Treiber gilt dann nur für diese Unternehmen, und die Option lautet *Standard (n Unternehmen)*
- **Mitarbeiterzahl**, **IT-Benutzer** und **Umsatz** fixieren diese Methode an der Zeile: Eine fixierte Methode funktioniert weiterhin, auch wenn sich der Standard der Organisation später ändert
- Zeilen mit einer manuellen Zuordnung sind vom Standard nie betroffen

**Wie Prozentsätze funktionieren**:

- Bei **automatischen Methoden** (Mitarbeiterzahl, IT-Benutzer, Umsatz): Die Prozentsätze werden aus den aktuellen Kennzahlen Ihrer aktiven Unternehmen berechnet. Sie bearbeiten sie nicht direkt
- Bei **Manuell nach Unternehmen** und **Manuell nach Abteilung**: Sie wählen die Unternehmen oder Abteilungen, und das System berechnet die Prozentsätze aus dem gewählten Treiber und den aktuellen Kennzahlen
- Bei **Manuelle Prozentsätze**: Die Eingabe eines Prozentsatzes fixiert diese Zeile, und die übrigen Zeilen teilen sich den Rest. **Gleichmäßig aufteilen** gibt jeder Zeile denselben Anteil; **Manuelle Fixierungen löschen** hebt die Fixierungen auf
- Die Prozentsätze spiegeln Live-Daten wider. Wenn Sie die Mitarbeiterzahl eines Unternehmens aktualisieren, werden die Zuordnungen neu berechnet
- Die Spalte **Treiber** zeigt den Wert jedes Unternehmens für den Treiber. Ein Umsatz erscheint mit der Basiswährung des Unternehmens, zum Beispiel **35 Mio. USD**

**Umsatz in mehreren Währungen**:

- Jedes Unternehmen erfasst seinen Umsatz in Millionen seiner Basiswährung. Vor der Aufteilung rechnet KANAP jeden Umsatz in die Berichtswährung um, zu den Kursen der Budgetversion des Jahres: den beim Einfrieren ihrer Standardspalte festgeschriebenen Kursen, sonst den aktuellen Kursen des Jahres. Siehe [Währungseinstellungen](currencies.md)
- Hat eine Währung für das Jahr keinen Kurs, bleiben die Unternehmen in dieser Währung aus der Aufteilung heraus: Sie erhalten keinen Anteil, und die übrigen Unternehmen teilen sich 100 %. Eine Warnung über der Tabelle nennt jedes ausgelassene Unternehmen. KANAP ruft den fehlenden Kurs im Hintergrund ab, und die Aufteilung korrigiert sich von selbst, sobald der Kurs verfügbar ist. Ein [manueller Kurs](currencies.md#manuelle-kurse) behebt es sofort
- Bei **Manuell nach Unternehmen** mit dem Treiber Umsatz wird die Zuordnung abgelehnt, wenn keines der ausgewählten Unternehmen einen Kurs hat. Die Meldung nennt die Währungen und das Jahr. Geben Sie den Kurs ein oder wählen Sie einen anderen Treiber

**So verwenden Sie ihn**:

1. Wählen Sie das Jahr
2. Wählen Sie unter **Methode** eine Zuordnungsmethode
3. Bei einer manuellen Methode fügen Sie mit **Zeile hinzufügen** Unternehmen (oder Unternehmen/Abteilungs-Paare) hinzu und entfernen sie mit dem Entfernen-Symbol. Bei **Manuell nach Unternehmen** wählen Sie unter **Zuordnen nach** einen Treiber
4. Änderungen werden automatisch gespeichert

**Häufige Probleme**:

- **Fehlende Kennzahlen**: Für ein oder mehrere Unternehmen fehlen Mitarbeiterzahl, IT-Benutzer oder Umsatz für das ausgewählte Jahr, oder der Wert ist null. Tragen Sie die Kennzahlen unter **Stammdaten > Unternehmen** (Details-Tab) ein
- **„Manuelle Prozentsätze müssen in Summe 100 % ergeben.“**: Passen Sie die Zeilen an oder klicken Sie auf **Gleichmäßig aufteilen**

**Wenn jemand anderes die Zuordnung bearbeitet**:

- Methode, Treiber und Zeilen werden zusammen gespeichert. Hat jemand anderes die Zuordnung geändert, während Sie sie bearbeiteten, bietet ein Banner **Zuordnung neu laden** oder **Überschreiben**
- Ein Jahreswechsel bei einer wartenden Wahl fragt zuerst nach einer Bestätigung

**Tipp**: Verwenden Sie für die meisten Zeilen Mitarbeiterzahl (Standard). Das ist am einfachsten und aktualisiert sich automatisch. Reservieren Sie manuelle Methoden für Ausgaben, die nur bestimmten Unternehmen oder Abteilungen zugutekommen.

---

### Verknüpfungen

Der Reiter Verknüpfungen zeigt, was diese Zeile bezahlt: ihre Projekte, Anwendungen, Technologien, Verträge und Assets, jeweils in einer eigenen Tabelle, danach Vorschläge, die Kontakte sowie Links und Dateien. Klicken Sie auf eine Tabellenzeile, um den Datensatz zu öffnen. Das Reiter-Badge zählt die verknüpften Projekte, Anwendungen, Technologien, Verträge und Assets sowie die Links und Dateien. Kontakte werden nicht gezählt. Technologien und Assets zählen nur, wenn Sie die Infrastruktur lesen dürfen.

**Verknüpfte Datensätze**, jeweils eine Tabelle:

| Abschnitt | Spalten |
|---|---|
| **Projekte** | Referenz (`PRJ-7`), Name, Status, geplantes Ende |
| **Anwendungen** | Referenz (`APP-3`), Name, Lebenszyklus, Geschäftskritikalität |
| **Technologien** | Referenz (`TEC-5`), Name, Familie, Hersteller |
| **Verträge** | Name, Lieferant, Ende der laufenden Laufzeit, Jahresbetrag in der Vertragswährung, Verlängerung (stillschweigend oder manuell) |
| **Assets** | Referenz (`AST-12`), Name, Typ, Umgebung, Status |

Sie sehen nur die Abschnitte der Module, die Sie lesen dürfen. Technologien und Assets erfordern Leserechte auf die Infrastruktur. Ein Fachbereichs-Mitwirkender sieht nur die Projekte und Anwendungen, an denen er beteiligt ist. Die Projektnamen erscheinen auch in der Spalte **Projekt** der Liste, wo die Schnellsuche sie findet. Die Vertragsnamen erscheinen in ihrer Spalte **Vertrag**. Ein Vertrag, der von der Zeile beim zahlenden Unternehmen, bei der Kostenstelle, beim Lieferanten oder bei der Währung abweicht, zeigt eine kleine orangefarbene Markierung neben seinem Namen. Fahren Sie mit der Maus über die Markierung, um jeden Unterschied zu sehen, mit dem Wert auf der Zeile und dem Wert auf dem Vertrag. Die Auswahl zeigt dieselbe Markierung an einem Vertrag, bevor Sie ihn verknüpfen. Die Verknüpfung bleibt möglich. Die Markierung erscheint für einen Vertrag, den Sie lesen dürfen.

Ein orangefarbenes Enddatum kennzeichnet einen Vertrag, dessen Verlängerungsentscheidung in Ihr Entscheidungsfenster für Verträge fällt. Ein deaktivierter Vertrag oder ein ausgemustertes oder deaktiviertes Asset bleibt mit ausgegrautem Namen aufgeführt. Ab zwei Zeilen enden die Verträge mit einer Summe je Währung, ohne die deaktivierten Verträge.

**Verknüpfungen hinzufügen und entfernen** (`budget:member`): **Hinzufügen** rechts neben einem Abschnitt öffnet eine Suche. Geben Sie einen Namen oder eine Referenz ein und wählen Sie ein Ergebnis: Die Verknüpfung wird sofort gespeichert. Das Verknüpfen erfordert zusätzlich Leserechte auf das Zielmodul. **Hinzufügen** fehlt daher in einem Abschnitt, den Sie nicht lesen dürfen. Um eine Verknüpfung zu entfernen, fahren Sie mit der Maus über die Zeile und klicken Sie auf das Kreuz am Zeilenende. Eine Meldung bestätigt es und bietet **Rückgängig** an. Das Entfernen einer Verknüpfung löscht nichts anderes. Leser sehen die Tabellen schreibgeschützt.

**Verwandt**: die Anwendungen und Verträge des Lieferanten der Zeile, die noch nicht verknüpft sind, mit dem Grund „gleicher Lieferant“. Klicken Sie auf **Verknüpfen**, um den Vorschlag seinem Abschnitt hinzuzufügen. Die Vorschläge zeigen:

- Anwendungen in Betrieb, wenn Sie die Anwendungen lesen dürfen. Ein Fachbereichs-Mitwirkender sieht nur die Anwendungen, an denen er beteiligt ist;
- aktive Verträge, wenn Sie die Verträge lesen dürfen;
- höchstens 20 je Typ.

Der Abschnitt fehlt, wenn die Zeile keinen Lieferanten hat oder es nichts vorzuschlagen gibt.

**Kontakte**: Personen zu dieser Zeile, jede mit einer Rolle (**Vertrieb**, **Technik**, **Support** oder **Sonstige**). Wählen Sie einen Kontakt und dann seine Rolle: Die Wahl der Rolle fügt den Kontakt hinzu. Die Tabelle zeigt Rolle, Vorname, Nachname, Funktion, E-Mail und Mobilnummer. Fahren Sie mit der Maus über die Rolle, um zu sehen, ob der Kontakt vom Lieferanten stammt oder manuell hinzugefügt wurde. Entfernen Sie einen Kontakt mit dem Entfernen-Symbol.

**Links und Dateien**: die Weblinks der Zeile (Lieferantenportale, Dokumentation, Admin-Konsolen) und ihre Dateien (Angebote, Rechnungen, Genehmigungsvermerke), je eine Zeile mit Name, der Domain des Links oder der Größe der Datei und dem Datum, an dem sie hinzugefügt wurden. Klicken Sie auf einen Link, um ihn in einem neuen Tab zu öffnen, oder auf eine Datei, um sie herunterzuladen. Mit `budget:member`:

- **Link hinzufügen** öffnet einen Dialog für eine URL und einen optionalen Namen; der Link wird sofort gespeichert. Um einen Link zu ändern, fahren Sie mit der Maus über seine Zeile und klicken Sie auf den Stift.
- **Datei anhängen** öffnet die Dateiauswahl. Sie können Dateien auch auf den Abschnitt ziehen.
- Um einen Link oder eine Datei zu entfernen, fahren Sie mit der Maus über die Zeile und klicken Sie auf das Kreuz. Das Entfernen eines Links zeigt eine Meldung und bietet **Rückgängig** an, womit der Link wieder angelegt wird. Das Löschen einer Datei fragt zuerst nach einer Bestätigung.

**Tipp**: Verknüpfen Sie Verträge, um Verlängerungen über mehrere Zeilen hinweg zu verfolgen. Hängen Sie Angebote und Rechnungen an, um alle Dokumente einer Zeile an einem Ort zu haben.

---

### Verlauf

Der Tab Verlauf listet die Änderungen an der Zeile, die neueste oben. Jeder Eintrag zeigt Datum und Uhrzeit, den Urheber (eine Person, **System**, **Import** oder **Plaid für** eine Person) und jedes geänderte Feld mit seinem Wert vorher und nachher. Eine Betragsänderung nennt das Jahr, die Spalte und die Werte vorher und nachher.

Auch die Änderungen an den Bestandteilen der Zeile erscheinen hier: Beträge, Dimensionen, Zuordnungen, Links, Anhänge, Kontakte, Anwendungen, Technologien, Assets und Aufgaben. Wer die Zeile öffnen kann, kann auch ihren Verlauf lesen. Ein Datensatz aus einem Modul, das Sie nicht lesen können, erscheint nur mit seiner Art, zum Beispiel „ein Vertrag“.

Details finden Sie unter [Verlauf der Datensätze](record-history.md).

---

## CSV-Import/Export

**Exportieren** und **Importieren** befinden sich in der Symbolleiste der Liste. Beide erfordern die Administratorstufe auf Budget (`budget:admin`).

**Exportieren** schreibt die Budgetdatei der Zeilen, die die Liste zeigt, OPEX und CAPEX zusammen, als `budget.csv` oder als Excel-Arbeitsmappe `budget.xlsx`. **Importieren** liest beides wieder ein: Die Datei wird zuerst geprüft, und nichts wird geschrieben, bevor Sie auf **Laden** klicken.

Die Datei enthält eine Zeile pro Budgetzeile: ihre `nature` (`opex` oder `capex`), ihre Referenz `BL-n`, die Details der Budgetzeile, ihre Beträge als Spalten und `kanap_token`. Eine Datei ohne Spalte `nature`, die eine frühere Version exportiert hat, wird als OPEX-Zeilen gelesen, oder als CAPEX-Zeilen, wenn der Filter **Typ** der Liste nur CAPEX behält. [Ein Budget aus einer Tabellenkalkulation laden](budget-file.md) beschreibt die Spalten, die Bedeutung einer Zelle und die beiden Importschritte.

---

## Status und Lebenszyklus

Jede Zeile hat einen **Status** (Aktiviert oder Deaktiviert) und ein optionales **Ende der Gültigkeit**, das steuert, wann sie in Berichten und Auswahllisten erscheint. Es ist das einzige Enddatum einer Zeile.

**Funktionsweise**:

- **Aktiviert**: Die Zeile ist aktiv und erscheint überall (Listen, Berichte, Zuordnungen)
- **Ende der Gültigkeit**: Das Datum, an dem die Zeile endet. Lassen Sie es leer, wenn es kein Ende gibt. Sobald das Ende der Gültigkeit vorbei ist, wechselt der Status innerhalb einer Stunde von selbst auf **Deaktiviert**
- Nach dem Ende der Gültigkeit:
    - Die Zeile erscheint nicht mehr in Auswahllisten für neue Verträge oder Zuordnungen
    - Sie wird aus Berichten für Jahre ausgeschlossen, die strikt nach dem Ende der Gültigkeit liegen
    - Historische Daten bleiben erhalten; die Zeile erscheint weiterhin in Berichten, die Jahre abdecken, in denen sie aktiv war

**Status setzen**:

- Beim Anlegen der Zeile können Sie ihr **Ende der Gültigkeit** im Bereich **Eigenschaften** festlegen
- Später ändern Sie den **Status** in der Metadatenleiste oder verwenden das Feld **Lebenszyklus** im Bereich **Eigenschaften** (Statusschalter und **Ende der Gültigkeit**). Ein Wechsel auf **Deaktiviert** setzt das Ende der Gültigkeit auf jetzt: Die Deaktivierung gilt sofort. Solange ein zukünftiges Datum gesetzt ist, zeigt der Schalter **Aktiv bis** und dieses Datum
- Sie können ein zukünftiges Ende der Gültigkeit planen, zum Beispiel das Ende eines Vertrags, eine geplante Veräußerung oder das Ende der Nutzungsdauer eines Assets

**Deaktivierte Zeilen anzeigen**:

- Standardmäßig zeigt die Liste nur **aktivierte** Zeilen
- Zeilen, die im laufenden Jahr enden, bleiben bis zum 31. Dezember unter **Aktiv**, auch wenn ihr Status bereits **Deaktiviert** lautet. Am 1. Januar wechseln sie zu **Deaktiviert**
- Wählen Sie im Umschalter **Anzeigen: Alle / Aktiv / Deaktiviert** die Option **Deaktiviert** oder **Alle**, um die in einem früheren Jahr beendeten Zeilen zu sehen

**Wann deaktivieren vs. löschen**:

- **Bevorzugen Sie das Deaktivieren**: Bewahrt die Historie, stellt konsistente Berichte sicher und unterstützt Audit-Trails
- **Nur löschen, wenn**: Die Zeile versehentlich erstellt wurde
- Eine Zeile mit Beträgen in einer eingefrorenen Spalte kann nicht gelöscht werden. Heben Sie zuerst das Einfrieren der Spalte auf, oder setzen Sie stattdessen ein Ende der Gültigkeit
- Beim Löschen einer Zeile werden auch ihre Budgets, Zuordnungen, Aufgaben, relevanten Websites, Anhänge (mit ihren Dateien) und ihre Verknüpfungen zu Verträgen entfernt. Wurde eine ihrer Aufgaben in eine Anfrage umgewandelt, bleibt die Anfrage erhalten: Sie hat eine eigene Kopie von Titel, Beschreibung und Anhängen, und nur ihre Verknüpfung zur Aufgabe entfällt

**Tipp**: Verwenden Sie das Ende der Gültigkeit, um Zeilen auslaufen zu lassen, wenn Verträge enden, Dienste eingestellt, Vermögenswerte veräußert oder Projekte abgeschlossen werden. Löschen Sie nur eine versehentlich erstellte Zeile.

---

## Typ ändern

Eine OPEX-Zeile, die sich als Investition herausstellt, wird zu einer CAPEX-Zeile, und eine CAPEX-Zeile, die sich als Betriebsausgabe herausstellt, wird zu einer OPEX-Zeile. Klicken Sie auf **Typ ändern…** neben **Typ** im Bereich **Eigenschaften**. Sie benötigen die Stufe Mitglied für Budget (`budget:member`). Noch nicht gespeicherte Änderungen werden gespeichert, bevor sich der Dialog öffnet.

**Ab** legt fest, wo die Änderung beginnt:

- **Das erste Jahr der Zeile** (Standard): Die Zeile selbst ändert ihren Typ. Sie behält ihre `BL`-Referenz und ihre Adresse, ihre Budgets, Zuordnungen, Verknüpfungen, Anhänge und Aufgaben. Ihr **Typ** ändert sich in der Liste. Eine Zeile, die zu CAPEX wird, verlässt die OPEX-Berichte und erscheint in den CAPEX-Berichten, und die Leistungsverrechnung zählt sie unter CAPEX. Eine Zeile, die zu OPEX wird, tut das Umgekehrte
- **Ein späteres Jahr**: Diese Zeile endet am 31. Dezember des Vorjahres und behält ihre früheren Budgets. Eine neue Zeile des anderen Typs, mit ihrer eigenen `BL`-Referenz, übernimmt das Budget ab diesem Jahr, mit den Kontakten und den Verknüpfungen zu Anwendungen, Assets, Verträgen, Projekten und Anfragen. Anhänge, relevante Websites und Aufgaben bleiben bei dieser Zeile. Oben im Tab **Übersicht** sind die beiden Zeilen verknüpft: **Ersetzt durch** auf dieser Zeile, **Folgt auf** auf der neuen

Der Dialog fragt außerdem nach:

- **Konto**: ein Konto für den neuen Typ. Gilt das Konto der Zeile nur für ihren aktuellen Typ, behält die Zeile es, wenn sie selbst ihren Typ ändert, sofern Sie kein anderes wählen; eine neue Zeile ab einem späteren Jahr erhält es nur, wenn es zum neuen Typ passt
- **Dimensionen**: die für den neuen Typ erforderlichen Dimensionen und die Werte der Zeile, die nur für ihren aktuellen Typ gelten. Ändert die Zeile selbst ihren Typ, können Sie sie jetzt oder später festlegen. Ab einem späteren Jahr braucht die neue Zeile die erforderlichen Dimensionen, und Werte nur für den aktuellen Typ werden nicht übernommen. Eine Dimension nur für CAPEX-Zeilen gilt nicht für OPEX-Zeilen: Eine CAPEX-Zeile, die selbst zu OPEX wird, behält ihren Wert, ohne ihn anzuzeigen, und zeigt ihn wieder an, wenn sie später wieder zu CAPEX wird
- **Grund**: optional, wird im Audit-Protokoll der Zeile gespeichert

Die Änderung wird abgelehnt, wenn die Zeile in den betroffenen Jahren Beträge in einer eingefrorenen Spalte hat, ob für OPEX- oder CAPEX-Zeilen. Heben Sie zuerst das Einfrieren der Spalte auf, oder lassen Sie die Änderung in einem späteren Jahr beginnen. Ein späteres Jahr wird angeboten, wenn es nach dem ersten Budgetjahr der Zeile liegt, die Zeile in diesem oder einem späteren Jahr ein Budget hat, vor dem 1. Januar dieses Jahres beginnt und an diesem Tag noch gültig ist und noch nicht durch eine andere Zeile ersetzt wurde. Eine Änderung beginnt immer am 1. Januar.

Eine Budgetdatei ändert den Typ einer Zeile nie. Siehe [Ein Budget aus einer Tabellenkalkulation laden](budget-file.md).

---

## Tipps und Best Practices

1. **Einfach anfangen**: Erstellen Sie Zeilen nur mit dem Wesentlichen (Titel, zahlendes Unternehmen, Konto und die erforderlichen Dimensionen), dann ergänzen Sie Budgets und Zuordnungen bei der Planung.

2. **Die Standard-Zuordnungsmethode verwenden**: Für die meisten Zeilen reicht Mitarbeiterzahl (Standard) aus. Reservieren Sie manuelle Zuordnungen für Ausgaben, die nur bestimmten Unternehmen oder Abteilungen zugutekommen.

3. **Verträge verknüpfen**: Wenn Sie Ausgaben über Verträge verwalten, verknüpfen Sie sie im Tab Verknüpfungen. Das erleichtert die Nachverfolgung von Verlängerungen und Beschaffungen.

4. **Anwendungen verknüpfen**: Ordnen Sie Zeilen den Anwendungen oder Services zu, die sie finanzieren. Dies bietet eine klare Kosten-zu-Anwendungs-Zuordnung.

5. **Dokumentation hochladen**: Verwenden Sie **Datei anhängen** unter **Links und Dateien** im Reiter Verknüpfungen, um Lieferantenverträge, Angebote, Rechnungen, Genehmigungsvermerke und Leistungsbeschreibungen zu speichern.

6. **Lieferantenportal-Links hinzufügen**: Verwenden Sie **Link hinzufügen** unter **Links und Dateien**, um zu Lieferanten-Admin-Konsolen, Support-Portalen und Dokumentation für schnellen Zugriff zu verlinken.

7. **Kontakte verfolgen**: Fügen Sie Lieferantenkontakte mit Rollen (Vertrieb, Technik, Support) hinzu, damit Ihr Team weiß, wen es für jede Zeile kontaktieren soll.

8. **Analysedimensionen nutzen**: Geben Sie Zeilen einen Wert in jeder Dimension (zum Beispiel **Software** in **Kostenart**, oder **Zweck** und **Priorität** einer CAPEX-Zeile), um Ausgaben in Berichten zu gruppieren.

9. **Unternehmenskennzahlen aktuell halten**: Zuordnungen hängen von Mitarbeiterzahl, IT-Benutzern und Umsatz der Unternehmen ab. Veraltete Kennzahlen verursachen Zuordnungsfehler.

10. **Eine Datei für die Masseneinrichtung verwenden**: Wenn Sie von einem anderen System migrieren oder Hunderte von Zeilen haben, beginnen Sie mit einem Import. Exportieren Sie eine neue Datei, füllen Sie Ihre Zeilen aus und prüfen Sie sie vor dem Laden.

11. **Deaktivieren statt löschen**: Bewahren Sie die Historie, indem Sie Zeilen deaktivieren, wenn sie nicht mehr aktiv sind. Löschen Sie nur bei Fehlern.

12. **Summenzeile überprüfen**: Bevor Sie Budgets finalisieren, prüfen Sie die Zeile **Gesamt** unter der Liste, um sicherzustellen, dass Ihre Ausgaben wie erwartet aufgehen. Filtern Sie auf **Typ**, um die Summe nur der OPEX oder nur der CAPEX zu sehen.

13. **Deep Linking nutzen**: Klicken Sie direkt auf eine Budgetspalte in der Liste, um zum Budget-Tab für dieses Jahr zu springen. Klicken Sie auf die Spalte Aufgabe, um zu den Aufgaben der Zeile im Tab Übersicht zu springen. Das spart Navigationszeit.

14. **Budgets nach Jahresabschluss einfrieren**: Verwenden Sie die Budgetadministration, um Vorjahresbudgets einzufrieren, sobald die Ist-Werte finalisiert sind, um versehentliche Bearbeitungen zu verhindern.

---

## Berechtigungen

Der Zugriff auf Budgetzeilen wird durch die Ressource Budget gesteuert, die für OPEX- und CAPEX-Zeilen gleichermaßen gilt. Sie hat drei Stufen:

- `budget:reader`: Liste anzeigen, Zeilen öffnen, Budgets und Zuordnungen einsehen (schreibgeschützt), Anhänge herunterladen
- `budget:member`: Zeilen erstellen und bearbeiten, ihren Typ ändern, Budgets und Zuordnungen aktualisieren, Anhänge hochladen und löschen, Beziehungen, Verknüpfungen und Kontakte verwalten
- `budget:admin`: Alle Mitglied-Rechte plus Import und Export, Budget-Operationen (Budgetspalten kopieren, mit Beträgen und Zuordnungen, und Budgetspalte zurücksetzen) und Massenlöschung

Das Einfrieren von Budgetspalten erfordert die Budgetadministration (`budget_ops:admin`).

Der Datenzugriff kann eine Person auf die Zeilen bestimmter Unternehmen oder Kostenstellen begrenzen. Sie sieht dann diese Zeilen und die, auf denen sie benannt ist, eine mit Lesen sichtbare Zeile zeigt „Schreibgeschützt in Ihrem Zugriff“, und das Löschen von Zeilen sowie Massenvorgänge sind Personen mit Zugriff auf alle Daten vorbehalten. Siehe [Datenzugriff](data-access.md).

Zusätzlich:

- Aufgaben haben separate Berechtigungen (`tasks:member` zum Erstellen und Bearbeiten von Aufgaben an Budgetzeilen)
- Benutzer mit `tasks:reader` können Aufgaben anzeigen, aber nicht erstellen oder bearbeiten

Wenn Sie eine Aktion nicht ausführen können (z. B. die Schaltfläche **Importieren** fehlt oder Sie keine Anhänge hochladen können), prüfen Sie mit Ihrem Arbeitsbereich-Administrator Ihre Rollenberechtigungen.

---

## Hilfe benötigt?

- **Dateiprobleme**: Exportieren Sie eine neue Datei aus der Liste und prüfen Sie sie erneut. Der Bericht nennt die Zeile und die Spalte jedes Fehlers, und [Ein Budget aus einer Tabellenkalkulation laden](budget-file.md) erklärt, was jede Zelle bedeutet
- **Zuordnungsfehler**: Prüfen Sie, ob alle Unternehmen die erforderlichen Kennzahlen (Mitarbeiterzahl, IT-Benutzer, Umsatz) für das ausgewählte Jahr haben
- **Warnung „Veraltetes Konto“**: Das Konto gehört nicht zum Kontenplan des zahlenden Unternehmens; wählen Sie ein anderes Konto
- **Fehlende Schaltflächen oder Tabs**: Ihre Rolle hat möglicherweise nicht die erforderliche Berechtigungsstufe (Mitglied oder Admin). Wenden Sie sich an Ihren Arbeitsbereich-Administrator
