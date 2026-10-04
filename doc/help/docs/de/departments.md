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
- **Name**: Abteilungsname -- zum Öffnen des Arbeitsbereichs Übersichts-Tab anklicken
- **Unternehmen**: Übergeordnetes Unternehmen -- zum Öffnen des Arbeitsbereichs Übersichts-Tab anklicken
- **Mitarbeiterzahl (Jahr)**: Mitarbeiterzahl für das ausgewählte Jahr -- zum direkten Wechsel zum Details-Tab anklicken

**Zusätzliche Spalten** (über Spaltenauswahl):
- **Status**: Aktiviert oder Deaktiviert
- **Erstellt**: Wann die Abteilung erstellt wurde

**Jahrauswahl**: Verwenden Sie das Feld **Jahr** in der Symbolleiste, um zu wechseln, welche Jahresmitarbeiterzahl angezeigt wird. Das Grid aktualisiert sich automatisch bei Jahreswechsel.

**Statusbereich**: Verwenden Sie den Umschalter **Anzeigen: Alle / Aktiv / Deaktiviert**, um nach Abteilungsstatus zu filtern. Die Liste zeigt standardmäßig nur aktivierte Abteilungen.

**Schnellsuche**: Die Suchleiste filtert über Abteilungsnamen.

**Deep-Linking**: Jede Zelle im Grid ist ein anklickbarer Link. Name und Unternehmen öffnen den Übersichts-Tab; Mitarbeiterzahl öffnet den Details-Tab. Wenn Sie zu einem Arbeitsbereich navigieren und zurückkehren, bleiben Sortierreihenfolge, Suchabfrage und Filter erhalten.

**Aktionen**:
- **Neu**: Neue Abteilung erstellen (erfordert `departments:manager`)
- **CSV importieren**: Massenimport von Abteilungen (erfordert `departments:admin`)
- **CSV exportieren**: Als CSV exportieren (erfordert `departments:admin`)
- **Ausgewählte löschen**: Ausgewählte Abteilungen entfernen (erfordert `departments:admin`)

---

## Der Abteilungs-Arbeitsbereich

Klicken Sie auf eine beliebige Zeile, um den Arbeitsbereich zu öffnen. Er hat zwei Tabs: **Übersicht** und **Details**.

- **Kopfzeile**: der Name der Abteilung. Klicken Sie darauf, um die Abteilung umzubenennen. **Zurück** / **Weiter** wechseln zwischen Abteilungen in der Reihenfolge und mit den Filtern der Liste, ohne zur Liste zurückzukehren, und die Schließen-Schaltfläche führt zur Liste zurück
- **Bereich Eigenschaften** rechts: **Unternehmen** und **Lebenszyklus**

**Automatisches Speichern**: Jede Änderung wird von selbst gespeichert. Es gibt keine Schaltfläche zum Speichern. Name und Beschreibung werden gespeichert, wenn Sie das Feld verlassen; Unternehmen und Lebenszyklus werden gespeichert, sobald Sie sie ändern. Sie können weiterarbeiten, während eine Änderung gespeichert wird. Wird eine Änderung abgelehnt, erscheint der Grund unter dem Feld, das sie verursacht hat, außer beim Namen, dessen Ablehnung oben auf der Seite angezeigt wird.

### Übersicht

Der Übersichts-Tab enthält die Beschreibung. Die übrigen Felder befinden sich in der Kopfzeile und im Bereich **Eigenschaften**.

**Was Sie bearbeiten können**:
- **Name**: Abteilungsname (Pflicht), in der Kopfzeile
- **Unternehmen**: Übergeordnetes Unternehmen, verknüpft mit den Unternehmen-Stammdaten (Pflicht). Ein Unternehmen, das bereits eine Abteilung mit gleichem Namen hat, wird abgelehnt: „A department with this name already exists in the selected company."
- **Beschreibung**: Freitext-Beschreibung
- **Lebenszyklus**: der Statusschalter, dessen Beschriftung den aktuellen Zustand zeigt (**Aktiviert** oder **Deaktiviert**), und das Datum **Ende der Gültigkeit**. Lassen Sie das Datum leer, damit die Abteilung unbegrenzt aktiv bleibt, oder setzen Sie ein zukünftiges Datum, um ihr Ende zu planen. Wenn Sie die Abteilung ohne Datum auf **Deaktiviert** setzen, wird das Ende der Gültigkeit auf heute gesetzt

**Eine Abteilung erstellen**: **Neu** öffnet ein Formular mit **Name**, **Unternehmen** und **Beschreibung**. Klicken Sie auf **Erstellen**, um sie zu speichern. Der Details-Tab wird verfügbar, nachdem Sie die Abteilung erstellt haben.

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
- Wenn die Kennzahlen für das ausgewählte Jahr von einem Administrator **eingefroren** wurden, ist das Feld gesperrt und ein Hinweis erklärt, wie die Sperre aufgehoben werden kann

**Tipp**: Aktualisieren Sie die Mitarbeiterzahl jährlich während Ihres Budgetplanungszyklus. Verwenden Sie die Jahrreiter, um zukünftige Jahre zu überprüfen oder vorzufüllen.

---

## CSV-Import/Export

**CSV exportieren** lädt alle Abteilungen mit ihrem Unternehmen, Namen, Beschreibung, Status und Ende der Gültigkeit herunter. **CSV importieren** liest eine Datei wieder ein. Der Importdialog bietet außerdem **Vorlage herunterladen**: eine Datei nur mit den Kopfzeilen.

Die Spalten:

| Spalte | Inhalt |
|---|---|
| `company_name` | Pflicht. Das Unternehmen, zu dem die Abteilung gehört, über seinen Namen |
| `name` | Pflicht. Der Name der Abteilung |
| `description` | Freier Text |
| `status` | `enabled` oder `disabled` |
| `disabled_at` | Das Ende der Gültigkeit: ein Datum (`2026-12-31`) oder ein vollständiges Datum mit Uhrzeit |

**Import**:

- Verwenden Sie die **Vorabprüfung**, um die Datei vor dem Anwenden zu prüfen, und dann **Laden**
- Zuordnung über Abteilungsname und Unternehmensname: Eine Zeile aktualisiert die Abteilung, die sie nennt, jede andere Zeile legt eine an

**Pflichtzellen**: `name` und `company_name`, ein bestehendes Unternehmen

**Optionale Zellen**: `description`, `status`, `disabled_at`

**Lebenszyklusspalten**:
- `status` ist `enabled` oder `disabled`, und `disabled_at` ist das Ende der Gültigkeit, ein Datum (`2026-12-31`) oder ein vollständiges Datum mit Uhrzeit. Der Export schreibt den aus dem Ende der Gültigkeit abgeleiteten Status. Eine neue Abteilung ist aktiviert, außer die Zeile sagt `disabled`. Bei einer Aktualisierung behalten ein leeres `status` und ein leeres `disabled_at` die gespeicherten Werte. `enabled` mit leerem Datum löscht das Ende der Gültigkeit. `disabled` mit leerem Datum behält ein bereits vergangenes Datum, andernfalls beendet es die Abteilung heute
- Eine Zeile, deren Status ihrem Datum widerspricht, wird mit einem Zeilenfehler abgelehnt: „Status is enabled but the end of validity has passed. Clear the date or set the status to disabled. If the file comes from an older export, export the data again.“ oder „Status is disabled but the end of validity is still to come. Set the status to enabled or set a date that has passed.“

**Hinweise**:
- Siehe [CSV-Dateien](master-data-operations.md#csv-dateien) für die Kodierung, das Trennzeichen, die Datumsformen und die beiden Importschritte
- Die Mitarbeiterzahl steht nicht in der Datei. Erfassen Sie sie pro Jahr im **Details-Tab** der Abteilung

## Tipps

- **Organisationsstruktur abgleichen**: Spiegeln Sie die Abteilungshierarchie Ihres HR-Systems für Konsistenz wider.
- **Mitarbeiterzahl jährlich aktualisieren**: Setzen Sie sich eine Erinnerung, die Abteilungskennzahlen während der Budgetplanung zu aktualisieren.
- **Für Zuordnungen verwenden**: Die Abteilungs-Mitarbeiterzahl treibt Kostenzuordnungsberechnungen -- halten Sie sie aktuell.
- **Deaktivieren statt löschen**: Wenn Abteilungen umstrukturiert werden, deaktivieren Sie alte statt sie zu löschen, um historische Daten zu bewahren.
- **Deep-Links nutzen**: Klicken Sie direkt auf die Mitarbeiterzahl in der Liste, um zum Details-Tab zu springen und Kennzahlen ohne zusätzlichen Klick zu bearbeiten.
