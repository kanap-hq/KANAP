# Abteilungen

Abteilungen repräsentieren organisatorische Einheiten innerhalb Ihrer Unternehmen. Verwenden Sie sie, um die Mitarbeiterzahl nach Jahr zu verfolgen, Kosten zuzuordnen und Zielgruppen für Anwendungen zu definieren. Jede Abteilung gehört zu einem Unternehmen und enthält jahresbezogene Mitarbeiterzahldaten, die in Leistungsverrechnungs- und Zuordnungsberechnungen einfließen.

Um festzuhalten, wer für jede Budgetzeile verantwortlich ist, verwenden Sie [Kostenstellen](cost-centers.md): Anders als Abteilungen lassen sie sich über Unternehmen hinweg gruppieren.

## Erste Schritte

Navigieren Sie zu **Stammdaten > Abteilungen**, um Ihre Abteilungsliste zu sehen. Klicken Sie auf **Neu**, um Ihren ersten Eintrag zu erstellen.

**Pflichtfelder**:
- **Name**: Der Abteilungsname
- **Unternehmen**: Zu welchem Unternehmen diese Abteilung gehört

**Optional aber nützlich**:
- **Beschreibung**: Freitext-Beschreibung des Zwecks oder Umfangs der Abteilung
- **Mitarbeiterzahl**: Anzahl der Mitarbeiter, jahresweise erfasst (wird nach der Erstellung im Details-Tab gesetzt)

**Tipp**: Importieren Sie Abteilungen aus Ihrem HR-System, um Ihre Organisationsstruktur abzugleichen.

---

## Mit der Liste arbeiten

Das Abteilungs-Grid gibt Ihnen einen Überblick über alle Abteilungen mit ihrer Mitarbeiterzahl für ein bestimmtes Jahr.

**Standardspalten**:
- **Referenz**: Die von Kadratis vergebene Referenz (`DEPT-4`). Zum Öffnen des Arbeitsbereichs Übersichts-Tab anklicken
- **Name**: Abteilungsname. Zum Öffnen des Arbeitsbereichs Übersichts-Tab anklicken
- **Unternehmen**: Übergeordnetes Unternehmen. Zum Öffnen des Arbeitsbereichs Übersichts-Tab anklicken
- **Mitarbeiterzahl (Jahr)**: Mitarbeiterzahl für das ausgewählte Jahr. Zum direkten Wechsel zum Details-Tab anklicken

**Zusätzliche Spalten** (über Spaltenauswahl):
- **Status**: Aktiviert oder Deaktiviert
- **Erstellt**: Wann die Abteilung erstellt wurde

**Jahrauswahl**: Verwenden Sie das Feld **Jahr** in der Symbolleiste, um zu wechseln, welche Jahresmitarbeiterzahl angezeigt wird. Das Grid aktualisiert sich automatisch bei Jahreswechsel.

**Statusbereich**: Verwenden Sie den Umschalter **Anzeigen: Alle / Aktiv / Deaktiviert**, um nach Abteilungsstatus zu filtern. Die Liste zeigt standardmäßig nur aktivierte Abteilungen.

**Schnellsuche**: Die Suchleiste filtert über Abteilungsnamen. Geben Sie eine Referenz ein, etwa `DEPT-4`, um diese Abteilung zu finden. Ziffern allein suchen im Text.

**Spaltenfilter**: Der Filter **Referenz** nimmt `DEPT-4` oder `4` an.

**Deep-Linking**: Jede Zelle im Grid ist ein anklickbarer Link. Referenz, Name und Unternehmen öffnen den Übersichts-Tab; Mitarbeiterzahl öffnet den Details-Tab. Wenn Sie zu einem Arbeitsbereich navigieren und zurückkehren, bleiben Sortierreihenfolge, Suchabfrage und Filter erhalten.

**Aktionen**:
- **Neu**: Neue Abteilung erstellen (erfordert `departments:member`)
- **Importieren**: Massenimport von Abteilungen (erfordert `departments:admin`)
- **Exportieren**: In eine CSV-Datei oder Excel-Arbeitsmappe exportieren (erfordert `departments:admin`)
- **Ausgewählte löschen**: Ausgewählte Abteilungen entfernen (erfordert `departments:admin`). Eine Abteilung, die in den Zuordnungen von Budgetzeilen verwendet wird, kann nicht gelöscht werden: Deaktivieren Sie sie stattdessen. Vor dem Löschen nennt die Bestätigung die behaltenen Abteilungen mit dem Grund

---

## Der Abteilungs-Arbeitsbereich

Klicken Sie auf eine beliebige Zeile, um den Arbeitsbereich zu öffnen. Er hat drei Tabs: **Übersicht**, **Details** und **Verlauf** (die Änderungen an der Abteilung, siehe [Verlauf der Datensätze](record-history.md)).

- **Kopfzeile**: die Referenz der Abteilung (`DEPT-5`, zum Kopieren anklicken) und ihr Name. Klicken Sie auf den Namen, um die Abteilung umzubenennen. **Zurück** / **Weiter** wechseln zwischen Abteilungen in der Reihenfolge und mit den Filtern der Liste, ohne zur Liste zurückzukehren, und die Schließen-Schaltfläche führt zur Liste zurück
- **Bereich Eigenschaften** rechts: **Unternehmen** und **Lebenszyklus**

**Seitenadresse**: Die Adresse der Seite verwendet die Referenz, zum Beispiel `/master-data/departments/DEPT-5/overview`. Die frühere Adresse der Seite einer Abteilung öffnet sie weiterhin und wird durch die neue ersetzt.

**Automatisches Speichern**: Jede Änderung wird von selbst gespeichert. Es gibt keine Schaltfläche zum Speichern. Name und Beschreibung werden gespeichert, wenn Sie das Feld verlassen; Unternehmen und Lebenszyklus werden gespeichert, sobald Sie sie ändern. Sie können weiterarbeiten, während eine Änderung gespeichert wird. Wird eine Änderung abgelehnt, erscheint der Grund unter dem Feld, das sie verursacht hat.

### Übersicht

Der Übersichts-Tab enthält die Beschreibung. Die übrigen Felder befinden sich in der Kopfzeile und im Bereich **Eigenschaften**.

**Was Sie bearbeiten können**:
- **Name**: Abteilungsname (Pflicht), in der Kopfzeile
- **Unternehmen**: Übergeordnetes Unternehmen, verknüpft mit den Unternehmen-Stammdaten (Pflicht). Ein Unternehmen, das bereits eine Abteilung mit gleichem Namen hat, wird abgelehnt: „A department with this name already exists in the selected company."
- **Beschreibung**: Freitext-Beschreibung
- **Lebenszyklus**: der Statusschalter, dessen Beschriftung den aktuellen Zustand zeigt (**Aktiviert** oder **Deaktiviert**), und das Datum **Ende der Gültigkeit**. Lassen Sie das Datum leer, damit die Abteilung unbegrenzt aktiv bleibt, oder setzen Sie ein zukünftiges Datum, um ihr Ende zu planen. Ein Wechsel auf **Deaktiviert** setzt das Ende der Gültigkeit auf jetzt: Die Deaktivierung gilt sofort. Solange ein zukünftiges Datum gesetzt ist, zeigt der Schalter **Aktiv bis** und dieses Datum

**Eine Abteilung erstellen**: **Neu** öffnet die Seite der neuen Abteilung mit geöffnetem Eigenschaftenbereich. Geben Sie den Namen im Titel oben auf der Seite ein und wählen Sie das **Unternehmen**. Wenn nur ein Unternehmen angeboten wird, ist es bereits gewählt, und Sie können es ändern. Die Abteilung wird erstellt, sobald beides angegeben ist, und alle Reiter werden verfügbar. Eine **Beschreibung** wird danach automatisch gespeichert. Drücken Sie Escape im Titel, um die Seite zu verlassen, ohne etwas zu erstellen, auch wenn Sie schon einen Namen eingegeben haben.

Solange die Abteilung erstellt wird, zeigt die Kopfzeile **Erstellen** und **Abbrechen**, bis Sie die Seite verlassen. **Strg+S** wirkt wie die angezeigte Schaltfläche. **Erstellen** speichert die Abteilung, sobald die Pflichtfelder angegeben sind, und lässt sie geöffnet. Fehlt noch eines, wird seine Beschriftung rot mit einem Warnsymbol, und der Cursor springt dorthin. Sobald die Abteilung erstellt ist, wird **Erstellen** zu **Fertig**: Es speichert, was Sie gerade eingeben, und bringt Sie dorthin zurück, wo Sie begonnen haben, zur Liste oder zum vorherigen Bildschirm. **Abbrechen** verlässt die Seite, ohne etwas zu behalten. Eine bereits erstellte Abteilung wird dabei gelöscht. Wenn Sie mehr als die Angaben zur Erstellung eingegeben haben, nennt eine Bestätigung, was gelöscht wird. Sie können Ihre eigene Erstellung auch ohne das Recht zum Löschen von Abteilungen abbrechen. Verlassen Sie die Seite auf andere Weise, bleibt die Abteilung bestehen.

---

### Details

Der Details-Tab verwaltet jahresbezogene Mitarbeiterzahl-Kennzahlen.

**Jahrauswahl**: Wählen Sie über die Jahrreiter oben im Panel, welches Jahr angezeigt oder bearbeitet werden soll. Fünf Jahre stehen zur Verfügung: zwei Jahre vor dem aktuellen Jahr bis zwei Jahre danach.

**Kennzahlen pro Jahr**:
- **Mitarbeiterzahl**: Gesamtzahl der Mitarbeiter in dieser Abteilung für das ausgewählte Jahr

**Funktionsweise**:
- Die Mitarbeiterzahl wird für das ausgewählte Jahr gespeichert, wenn Sie das Feld verlassen (oder Enter drücken). Alles andere als eine ganze Zahl von 0 oder mehr zeigt „Geben Sie eine ganze Zahl ein, 0 oder mehr." unter dem Feld
- Die Mitarbeiterzahl fließt in Zielgruppenberechnungen für Anwendungen ein
- Jedes Jahr wird für sich gespeichert: Ein Jahreswechsel lädt den Wert dieses Jahres
- Wenn die Kennzahlen für das ausgewählte Jahr von einem Administrator **eingefroren** wurden, ist das Feld gesperrt und ein Hinweis besagt, dass ein Budgetadministrator die Sperre aufheben kann (**Budgetverwaltung > Administration > Stammdaten einfrieren**)

**Tipp**: Aktualisieren Sie die Mitarbeiterzahl jährlich während Ihres Budgetplanungszyklus. Verwenden Sie die Jahrreiter, um zukünftige Jahre zu überprüfen oder vorzufüllen.

---

## CSV-Import/Export

Der Export schreibt eine CSV-Datei oder eine Excel-Arbeitsmappe (`.xlsx`): Wählen Sie unter **Format** im Dialog. Der Import liest beides. Siehe [CSV- und Excel-Dateien](csv-files.md).

**Exportieren** lädt die Abteilungen der Liste (oder, auf Wunsch im Dialog, alle Abteilungen) mit ihrer Referenz, ihrem Unternehmen, Namen, Beschreibung, Status und Ende der Gültigkeit herunter. **Importieren** liest eine Datei wieder ein. Der Importdialog bietet außerdem **Vorlage herunterladen**: eine Datei nur mit den Kopfzeilen.

Die Spalten in dieser Reihenfolge:

| Spalte | Inhalt |
|---|---|
| `reference` | Optional. Die Referenz der Abteilung (`DEPT-12`). Der Export schreibt sie |
| `company_name` | Pflicht. Das Unternehmen, zu dem die Abteilung gehört, über seinen Namen |
| `name` | Pflicht. Der Name der Abteilung |
| `description` | Freier Text |
| `status` | `enabled` oder `disabled` |
| `disabled_at` | Das Ende der Gültigkeit: ein Datum (`2026-12-31`) oder ein vollständiges Datum mit Uhrzeit. Der Export schreibt nur das Datum. Erneut importiert, behält dieses Datum das gespeicherte Gültigkeitsende |

**Import**:

- Verwenden Sie die **Vorabprüfung**, um die Datei vor dem Anwenden zu prüfen, und dann **Laden**
- **Zuordnung über die Referenz**: Eine ausgefüllte `reference` (`DEPT-12` oder `12`) bezeichnet die Abteilung, die die Zeile aktualisiert, auch wenn sich ihr Name geändert hat. Die Abteilung erhält den Namen und das Unternehmen, die die Zeile angibt: Ein anderes Unternehmen verschiebt sie dorthin. Die Vorabprüfung meldet jede Abteilung, die umbenannt wird oder das Unternehmen wechselt
- **Zuordnung über den Namen**: Ist `reference` leer oder fehlt die Spalte in der Datei, wird eine Zeile über Abteilungsname und Unternehmensname zugeordnet. Sie aktualisiert die Abteilung, die sie nennt, und jede andere Zeile legt eine an
- **Unbekannte Referenz**: Eine Referenz, die Ihr Arbeitsbereich nicht kennt, lehnt die Zeile ab: „„DEPT-999“ ist keine Referenz in diesem Arbeitsbereich. Lassen Sie die Zelle leer, um die Zeile ohne sie zu importieren.“ Das betrifft etwa eine Datei, die aus einem anderen Arbeitsbereich exportiert wurde
- **Umbenennen oder Verschieben**: Ein Name, den bereits eine andere Abteilung im Unternehmen der Zeile trägt, wird abgelehnt, und die Meldung nennt deren Referenz: „„Finance“ gehört bereits zu DEPT-7.“
- **Eine Zeile pro Abteilung**: Zwei Zeilen, die dieselbe Abteilung aktualisieren, werden abgelehnt: „Diese Zeile aktualisiert DEPT-7, wie Zeile 3. Verwenden Sie eine Zeile pro Datensatz.“ Zwei Zeilen, die dieselbe Abteilung anlegen (gleiches Unternehmen und gleicher Name, unabhängig von der Groß- und Kleinschreibung), werden ebenfalls abgelehnt: „Gleiche Werte in company_name, name wie in Zeile 3.“

**Pflichtzellen**: `name` und `company_name`, ein bestehendes Unternehmen. Eine Zeile mit einer `reference` kann sie leer lassen: Die Abteilung behält ihren Namen und ihr Unternehmen

**Gleicher Name in zwei Unternehmen**: Zwei Unternehmen können jeweils eine Abteilung mit demselben Namen haben. Ein Import, der eine davon bei einer Person, einer Anfrage oder einem Projekt nennt, oder Kad bei einer Anfrage oder einem Projekt, liest sie im Unternehmen des Datensatzes; hat der Datensatz keines, nennt die Meldung die Unternehmen, die eine solche Abteilung haben. Siehe [Namen von Datensätzen](csv-files.md#names-of-records)

**Leere Zellen und `-`**: Bei einer Abteilung, die die Datei aktualisiert, behält eine leere Zelle den gespeicherten Wert, und `-` leert `description` oder `disabled_at`. `-` kann `reference`, `company_name`, `name` oder `status` nicht leeren: Die Zeile wird abgelehnt. Siehe [Leere Zellen und `-`](csv-files.md#empty-cells-and-clearing)

**Optionale Zellen**: `reference`, `description`, `status`, `disabled_at`

**Lebenszyklusspalten**:
- `status` ist `enabled` oder `disabled`, und `disabled_at` ist das Ende der Gültigkeit, ein Datum (`2026-12-31`) oder ein vollständiges Datum mit Uhrzeit. Der Export schreibt den aus dem Ende der Gültigkeit abgeleiteten Status. Eine neue Abteilung ist aktiviert, außer die Zeile sagt `disabled`. Bei einer Aktualisierung behalten ein leeres `status` und ein leeres `disabled_at` die gespeicherten Werte. `enabled` mit leerem Datum löscht das Ende der Gültigkeit. `disabled` mit leerem Datum behält ein bereits vergangenes Datum, andernfalls beendet es die Abteilung heute
- Eine Zeile, deren Status ihrem Datum widerspricht, wird mit einem Zeilenfehler abgelehnt: „Der Status ist „Aktiviert“, aber das Gültigkeitsende ist überschritten. Schreiben Sie „-“ in das Gültigkeitsende oder „disabled“ in den Status. Stammt die Datei aus einem älteren Export, exportieren Sie die Daten erneut.“ oder „Der Status ist „Deaktiviert“, aber das Gültigkeitsende liegt noch in der Zukunft. Schreiben Sie „enabled“ in den Status oder ein vergangenes Datum in das Gültigkeitsende.“

**Hinweise**:
- Siehe [CSV- und Excel-Dateien](csv-files.md) für die Kodierung, das Trennzeichen, die Datumsformen und die beiden Importschritte
- Die Mitarbeiterzahl steht nicht in der Datei. Erfassen Sie sie pro Jahr im **Details-Tab** der Abteilung

## Tipps

- **Organisationsstruktur abgleichen**: Spiegeln Sie die Abteilungshierarchie Ihres HR-Systems für Konsistenz wider.
- **Mitarbeiterzahl jährlich aktualisieren**: Setzen Sie sich eine Erinnerung, die Abteilungskennzahlen während der Budgetplanung zu aktualisieren.
- **Für Zuordnungen verwenden**: Die Abteilungs-Mitarbeiterzahl treibt Kostenzuordnungsberechnungen. Halten Sie sie aktuell.
- **Deaktivieren statt löschen**: Wenn Abteilungen umstrukturiert werden, deaktivieren Sie alte statt sie zu löschen, um historische Daten zu bewahren.
- **Deep-Links nutzen**: Klicken Sie direkt auf die Mitarbeiterzahl in der Liste, um zum Details-Tab zu springen und Kennzahlen ohne zusätzlichen Klick zu bearbeiten.
