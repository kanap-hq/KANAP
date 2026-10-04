# Kostenstellen

Eine Kostenstelle gibt an, wer für eine Budgetzeile verantwortlich ist: das Team oder die Einheit, die für die Ausgaben einsteht. Jede OPEX- und CAPEX-Zeile kann eine Kostenstelle tragen. Kostenstellen sind in einem Baum aus Gruppen angeordnet, sodass Sie das Budget eines ganzen Bereichs ebenso leicht lesen können wie das Budget eines einzelnen Teams.

## Wie sich Kostenstellen von anderen Stammdaten unterscheiden

| Stammdaten | Welche Frage sie beantworten | Auf einer Budgetzeile |
|---|---|---|
| **Unternehmen** | Welche juristische Person zahlt | Das **Zahlende Unternehmen** |
| **Abteilungen** | Welche Einheiten eines Unternehmens IT nutzen, mit ihrer Mitarbeiterzahl | Für Zuordnungen und Leistungsverrechnung verwendet |
| **Kostenstellen** | Wer für die Ausgaben verantwortlich ist und einsteht | Die **Kostenstelle** |
| **Analysedimensionen** | Freie Klassifizierungen für das Reporting | Ein Feld pro Dimension, zum Beispiel **Nature** |

Eine Abteilung gehört zu einem Unternehmen und steuert Zuordnungen über ihre Mitarbeiterzahl. Eine Kostenstelle trägt einen Code, ein Unternehmen, einen Budgetverantwortlichen und einen Platz in einem Baum, und Gruppen von Kostenstellen können mehrere Unternehmen umfassen. Kostenstellen ändern weder Zuordnungen noch die Leistungsverrechnung.

---

## Gruppen und Kostenstellen

Der Baum enthält zwei Typen von Elementen:

- **Gruppe**: enthält Kostenstellen und andere Gruppen. Eine Gruppe hat kein Unternehmen und kann daher Kostenstellen mehrerer Unternehmen zusammenfassen. Eine Gruppe kann keiner Budgetzeile zugewiesen werden.
- **Kostenstelle**: gehört zu einem Unternehmen und hat keine untergeordneten Elemente. Nur Kostenstellen werden Budgetzeilen zugewiesen.

Beide Typen können auf der obersten Ebene stehen, ohne übergeordnetes Element. Zum Beispiel:

```
IT division (group)
  Infrastructure (group)
    IT-100  Data centers        Company A
    IT-110  Network             Company B
  IT-200  Business applications  Company A
IT-300  Workplace               Company B
```

Hier fasst die Gruppe **IT division** Kostenstellen zweier Unternehmen zusammen. Ein Bericht, der auf diese Gruppe gefiltert wird, umfasst IT-100, IT-110 und IT-200.

---

## Erste Schritte

Navigieren Sie zu **Stammdaten > Kostenstellen** (im Abschnitt **Organisation**), um die Liste zu öffnen. Klicken Sie auf **Neu**, um Ihren ersten Eintrag zu erstellen.

**Pflichtfelder**:

- **Code**: der Code, den Ihr Finanzteam verwendet
- **Name**: der Name, unter dem sie bekannt ist
- **Typ**: **Gruppe** oder **Kostenstelle**
- **Unternehmen**: nur für eine Kostenstelle

**Optional, aber nützlich**:

- **Übergeordnete Gruppe**: wo sie im Baum steht. Lassen Sie das Feld für die oberste Ebene leer
- **Budgetverantwortlicher**: die Person, die in der Budgetprüfung für diesen Budgetrahmen einsteht. Jede OPEX- und CAPEX-Zeile der Kostenstelle zeigt diese Person
- **Beschreibung**: was die Kostenstelle abdeckt

**Tipp**: Wenn Ihr Finanzteam die Liste der Kostenstellen bereits führt, importieren Sie sie aus einer CSV-Datei. Die Zeilen können in beliebiger Reihenfolge stehen.

---

## Mit der Liste arbeiten

Solange der Arbeitsbereich noch keine Kostenstelle hat, weist eine Zeile unter dem Titel darauf hin: „Kostenstellen zeigen, wer für jede Budgetzeile verantwortlich ist. Legen Sie eine an oder importieren Sie eine Datei.“

**Spalten**:

- **Code**: der Code der Kostenstelle
- **Name**: nach Ebene eingerückt, wenn die Liste in Baumreihenfolge steht
- **Typ**: **Gruppe** oder **Kostenstelle**
- **Übergeordnet**: die Gruppe, zu der sie gehört
- **Unternehmen**: das Unternehmen einer Kostenstelle (leer bei einer Gruppe)
- **Budgetverantwortlicher**: die Person, die für das Budget der Kostenstelle einsteht
- **Status**: **Aktiviert** oder **Deaktiviert** (standardmäßig ausgeblendet, über die Spaltenauswahl hinzufügen)

Klicken Sie auf eine beliebige Zelle, um den Arbeitsbereich zu öffnen.

**Sortierung**: Die Liste öffnet sich in Baumreihenfolge: Auf jede Gruppe folgt ihr Inhalt. Klicken Sie auf eine Spaltenüberschrift, um stattdessen nach dieser Spalte zu sortieren. Die Einrückung erscheint nur in Baumreihenfolge.

**Filtern**:

- **Schnellsuche**: durchsucht den Code, den Namen und den vollständigen Pfad. Die Suche nach dem Namen einer Gruppe findet auch alles, was sie enthält
- **Spaltenfilter**: **Typ**, **Übergeordnet**, **Unternehmen** und **Status** verwenden Kontrollkästchen-Filter. Wenn Sie im **Status**-Filter auf **Leeren** klicken oder beide Werte abwählen, zeigt die Liste nichts mehr an, unabhängig von **Anzeigen**
- **Statusbereich**: der Umschalter **Anzeigen: Alle / Aktiv / Deaktiviert** über der Liste. Standardmäßig zeigt die Liste aktivierte Elemente

**Aktionen**:

- **Neu**: eine Gruppe oder eine Kostenstelle erstellen (erfordert `cost_centers:member`)
- **CSV importieren**: den Baum aus einer Datei laden (erfordert `cost_centers:admin`)
- **CSV exportieren**: alle Elemente herunterladen (erfordert `cost_centers:admin`)
- **Auswahl löschen**: die ausgewählten Elemente löschen (erfordert `cost_centers:admin`). Elemente, die nicht gelöscht werden können, bleiben erhalten und werden mit dem Grund aufgeführt. Inhalte werden vor ihrer Gruppe gelöscht, sodass die Auswahl einer Gruppe zusammen mit ihrem gesamten Inhalt alles löscht

---

## Eine Kostenstelle erstellen

Klicken Sie auf **Neu**. Füllen Sie die Felder aus und klicken Sie dann auf **Erstellen**. Ein neues Element ist aktiviert.

Der **Typ** steht zunächst auf **Kostenstelle**. Wählen Sie **Gruppe**, um eine Gruppe zu erstellen: Das Feld **Unternehmen** verschwindet dann.

Nach **Erstellen** öffnet sich der Arbeitsbereich des neuen Elements.

---

## Der Kostenstellen-Arbeitsbereich

Klicken Sie auf eine beliebige Zeile der Liste, um den Arbeitsbereich zu öffnen.

- **Kopfzeile**: der Code als Referenz, mit einer Kopierschaltfläche, und der Name. Klicken Sie auf den Namen, um ihn zu ändern. **Zurück** / **Weiter** bewegen sich durch die Liste in ihrer aktuellen Reihenfolge und mit ihren Filtern, und die Schließen-Schaltfläche führt zur Liste zurück
- **Hauptbereich**: eine Zeile wie „Verwendet von 3 OPEX-Zeilen und 1 CAPEX-Zeile.“, wenn Budgetzeilen das Element verwenden, dann die **Beschreibung**
- **Bereich Eigenschaften** rechts: **Code**, **Typ**, **Übergeordnete Gruppe**, **Unternehmen** (nur Kostenstellen), **Budgetverantwortlicher** und **Lebenszyklus**

**Automatisches Speichern**: Jede Änderung wird von selbst gespeichert. Es gibt keine Schaltfläche zum Speichern. Textfelder werden gespeichert, wenn Sie sie verlassen (drücken Sie Enter in **Code**, um sofort zu speichern); Auswahllisten und Schalter werden gespeichert, sobald Sie einen Wert wählen. Sie können weiterarbeiten, während eine Änderung gespeichert wird. Wird eine Änderung abgelehnt, erscheint der Grund unter dem Feld, das sie verursacht hat, zum Beispiel ein doppelter Code unter **Code**. Ein abgelehnter Name wird oben auf der Seite angezeigt.

### Felder

| Feld | Was Sie eingeben | Wo Sie diesen Wert finden |
|---|---|---|
| **Code** | Bis zu 50 Zeichen. Codes sind unabhängig von Groß- und Kleinschreibung eindeutig: `IT-100` und `it-100` sind derselbe Code | Der Code, den Ihr Finanzteam für diese Kostenstelle verwendet, wie in Ihrem Buchhaltungssystem oder Ihrer Budgetstruktur |
| **Name** | Bis zu 200 Zeichen | Der Name, der in Ihren Budgetbesprechungen verwendet wird |
| **Typ** | **Gruppe** oder **Kostenstelle** | Eine Gruppe fasst zusammen; eine Kostenstelle wird Budgetzeilen zugewiesen |
| **Übergeordnete Gruppe** | Eine Gruppe oder leer für die oberste Ebene. Ein Element kann nicht unter sich selbst oder unter etwas verschoben werden, das es enthält; diese Einträge fehlen daher in der Liste | Ihr Organigramm oder der Kostenstellenbaum Ihres Finanzteams |
| **Unternehmen** | Ein aktiviertes Unternehmen. Nur Kostenstellen | Die juristische Person, die die Kosten dieser Kostenstelle trägt. Es ist eines Ihrer Unternehmen unter **Stammdaten > Unternehmen** |
| **Budgetverantwortlicher** | Ein aktiver Benutzer | Die Person, die in der Budgetprüfung für diesen Budgetrahmen einsteht. Der Hinweis unter dem Feld sagt es |
| **Lebenszyklus** | Der Statusschalter, dessen Beschriftung den aktuellen Zustand zeigt (**Aktiviert** oder **Deaktiviert**), und das Datum **Ende der Gültigkeit** | Setzen Sie ein zukünftiges Datum, um das Ende zu planen, oder schalten Sie den Schalter aus, um das Element heute zu deaktivieren |

### Budgetverantwortlicher auf Budgetzeilen

Jede OPEX- und CAPEX-Zeile mit einer Kostenstelle zeigt den Budgetverantwortlichen dieser Kostenstelle in ihrer Metadatenleiste, nach **IT-Verantwortlicher** und **Fachverantwortlicher**. Fahren Sie mit der Maus darüber, um zu sehen, aus welcher Kostenstelle er stammt.

- **Aus der Kostenstelle gelesen**: Der Budgetverantwortliche wird nicht auf der Zeile gespeichert. Ändern Sie ihn hier, und jede Zeile der Kostenstelle zeigt sofort die neue Person. Auf einer Zeile ändert er sich nur, wenn Sie die Kostenstelle der Zeile ändern.
- **Nur angezeigt, wenn gesetzt**: Eine Zeile ohne Kostenstelle, oder deren Kostenstelle keinen Budgetverantwortlichen hat, zeigt nichts an.
- **Eine eigene Rolle**: **IT-Verantwortlicher** und **Fachverantwortlicher** einer Zeile bleiben unverändert und werden auf jeder Zeile gesetzt. Sie decken auch Arbeitsbereiche ab, die keine Kostenstellen verwenden.
- **In den Listen**: Die OPEX- und CAPEX-Listen haben eine Spalte **Budgetverantwortlicher**, standardmäßig ausgeblendet, mit einem Kontrollkästchen-Filter.

### Den Typ ändern

- **Von Kostenstelle zu Gruppe**: Das Unternehmen wird entfernt. Dies wird abgelehnt, solange Budgetzeilen die Kostenstelle verwenden.
- **Von Gruppe zu Kostenstelle**: Wählen Sie **Kostenstelle** unter **Typ** und dann das Unternehmen. Die Änderung wird gespeichert, sobald das Unternehmen gesetzt ist. Eine Gruppe, die Elemente enthält, kann keine Kostenstelle werden; **Typ** bietet diese Option dann nicht an.

### Löschen

Die Schaltfläche **Löschen** in der Kopfzeile löscht das Element sofort (erfordert `cost_centers:admin`). Sie ist deaktiviert, mit dem Grund in einer Zeile, wenn Budgetzeilen die Kostenstelle verwenden (zum Beispiel „Verwendet von 3 OPEX-Zeilen. Deaktivieren Sie sie stattdessen.“) oder wenn die Gruppe noch Elemente enthält (zum Beispiel „Enthält 2 Elemente.“). Deaktivieren Sie das Element stattdessen: Es bleibt auf seinen Zeilen und in den Berichten.

---

## Regeln, auf die Sie stoßen werden

- **Eine Kostenstelle, die von Budgetzeilen verwendet wird, kann weder eine Gruppe werden noch gelöscht werden.** Deaktivieren Sie sie stattdessen. Die Meldung nennt die Zeilen, zum Beispiel „IT-300 is used by 3 OPEX lines and 1 CAPEX line. Disable it instead.“
- **Eine Gruppe, die Elemente enthält, kann weder gelöscht werden noch eine Kostenstelle werden.** Verschieben oder löschen Sie zuerst ihren Inhalt. Die Meldung nennt die Anzahl, zum Beispiel „Infrastructure still contains 4 nodes. Move or delete them first.“
- **Nur eine Gruppe kann übergeordnet sein.** Eine Kostenstelle hat keine untergeordneten Elemente.
- **Keine Schleifen.** Eine Gruppe kann nicht unter sich selbst oder unter eine ihrer eigenen Gruppen verschoben werden.
- **Deaktivierte Elemente bleiben, wo sie sind.** Eine deaktivierte Kostenstelle bleibt auf den Budgetzeilen, die sie bereits haben, und zählt weiterhin in den Berichten. In den Auswahllisten ist sie als **Deaktiviert** markiert und kann nicht für eine neue Zeile gewählt werden. Das Deaktivieren einer Gruppe ändert ihren Inhalt nicht, und eine deaktivierte Gruppe kann weiterhin Elemente aufnehmen.
- **Codes sind unabhängig von Groß- und Kleinschreibung eindeutig.** Ein doppelter Code wird abgelehnt: „A cost center with code IT-100 already exists.“
- **Das Umbenennen eines Codes behält die Zeilen.** Budgetzeilen verweisen auf die Kostenstelle selbst, daher ändert ein neuer Code nichts an ihnen. Nach dem Umbenennen zeigen Listen und Berichte den neuen Code. Die Änderung wird im Audit-Protokoll erfasst.
- **Ein deaktiviertes Unternehmen oder ein inaktiver Benutzer kann nicht gewählt werden** für eine Kostenstelle.
- **Ein Unternehmen, zu dem Kostenstellen gehören, kann nicht gelöscht werden.** Ändern Sie deren Unternehmen oder deaktivieren Sie stattdessen das Unternehmen.

---

## Kostenstellen auf Budgetzeilen

- **OPEX und CAPEX**: Das Feld **Kostenstelle** im Bereich **Eigenschaften** zeigt den Baum. Gruppen werden zur Orientierung angezeigt und können nicht gewählt werden. Wenn Sie eine Zeile erstellen und das zahlende Unternehmen leer ist, füllt die Wahl einer Kostenstelle es mit dem Unternehmen der Kostenstelle, und das Unternehmen folgt der Kostenstelle, bis Sie selbst ein Unternehmen oder ein Konto wählen. Wenn sich die beiden Unternehmen unterscheiden, bleiben beide erhalten und ein Hinweis weist darauf hin. Siehe [OPEX](opex.md) und [CAPEX](capex.md).
- **Listen**: die Spalten und Filter **Kostenstelle** und **Run oder Build** der OPEX- und CAPEX-Listen.
- **Berichte**: Die Budgetberichte können auf eine Kostenstelle oder eine Gruppe gefiltert werden. Siehe [Filter nach Kostenstelle, Run oder Build und Analysedimensionen](reports.md#filter-nach-kostenstelle-run-oder-build-und-analysedimensionen).

---

## CSV-Import/-Export

Laden oder aktualisieren Sie den gesamten Baum aus einer Datei.

**Export**: Klicken Sie auf **CSV exportieren** und dann auf **Daten exportieren**. Die Datei enthält alle Elemente, aktiviert oder deaktiviert, in Baumreihenfolge. Für eine leere Datei nur mit den Kopfzeilen verwenden Sie **Vorlage herunterladen** im Importdialog.

**CSV-Struktur**:

- Kopfzeilen: `code`, `kind`, `name`, `parent_code`, `company_name`, `owner_email`, `description`, `status`, `disabled_at`
- Der Export schreibt das Trennzeichen der Sprache der Oberfläche. Siehe [CSV-Dateien](master-data-operations.md#csv-dateien) für die Kodierung, das Trennzeichen, die Datumsformen und die beiden Importschritte

| Spalte | Inhalt |
|---|---|
| `code` | Pflicht. Der Code des Elements. Zeilen werden bestehenden Elementen über den Code zugeordnet, unabhängig von Groß- und Kleinschreibung |
| `kind` | Pflicht. `group` oder `cost_center` |
| `name` | Pflicht |
| `parent_code` | Der Code der übergeordneten Gruppe, aus derselben Datei oder bereits in KANAP vorhanden. Leer für die oberste Ebene |
| `company_name` | Pflicht für ein `cost_center`, leer für eine `group`. Über den Unternehmensnamen zugeordnet, unabhängig von Groß- und Kleinschreibung |
| `owner_email` | Die E-Mail-Adresse des Budgetverantwortlichen, eines aktiven Benutzers. Leer für keinen Budgetverantwortlichen |
| `description` | Freitext |
| `status` | `enabled` oder `disabled`. Leer bedeutet `enabled` für einen neuen Knoten und behält bei einer Aktualisierung den gespeicherten Status |
| `disabled_at` | Optionale Spalte. Das Ende der Gültigkeit: ein Datum (`2026-12-31`) oder ein vollständiges Datum mit Uhrzeit. Leer, wenn es kein Ende gibt. Bei einer Aktualisierung behalten ein leerer `status` und ein leeres `disabled_at` die gespeicherten Werte. `enabled` mit leerem Datum löscht das Ende der Gültigkeit. `disabled` mit leerem Datum behält ein bereits vergangenes Datum und beendet den Knoten sonst heute |

**Import**:

1. Klicken Sie in der Liste auf **CSV importieren**
2. Wählen Sie Ihre Datei
3. Klicken Sie auf **Vorabprüfung**. Der Bericht nennt die Anzahl der Zeilen, die zu erstellenden und zu aktualisierenden Elemente sowie die Zeilen, die nichts ändern
4. Wenn die Vorabprüfung fehlerfrei ist, klicken Sie auf **Laden**

**So funktioniert der Import**:

- **Zeilen in beliebiger Reihenfolge**: Ein untergeordnetes Element kann vor seiner übergeordneten Gruppe stehen. Übergeordnete Elemente werden anhand der gesamten Datei und der bereits in KANAP vorhandenen Elemente aufgelöst.
- **Die gesamte Datei wird geprüft, bevor etwas geschrieben wird**: jede Zeile, dann die übergeordneten Elemente, dann die Regeln des Baums (eine Kostenstelle hat ein Unternehmen, eine Gruppe keines, nur Gruppen sind übergeordnet, keine Schleifen, eine von Zeilen verwendete Kostenstelle bleibt eine Kostenstelle). Eine Datei mit einem Fehler lädt nichts: Korrigieren Sie die Zeilen und führen Sie die Vorabprüfung erneut aus. Jeder Fehler nennt seine Zeile mit der Zeilennummer der Datei, wie ein Texteditor sie anzeigt, einschließlich Leerzeilen und Zellen über mehrere Zeilen.
- **Zuordnung über den Code**: Eine Zeile, deren Code existiert, aktualisiert dieses Element; jede andere Zeile erstellt eines. Jede Zelle ersetzt den gespeicherten Wert, sodass ein leeres `owner_email` oder `description` ihn löscht.
- **Unveränderte Zeilen**: Eine Zeile, die dem gespeicherten Element entspricht, ändert nichts. Wenn Sie dieselbe Datei exportieren und importieren, werden alle Zeilen als unverändert gemeldet.
- **In der Datei fehlende Elemente** bleiben unverändert. Der Import löscht nie.

**Häufige Fehler**:

- **„Unknown company '...'“**: Legen Sie das Unternehmen unter **Stammdaten > Unternehmen** an oder korrigieren Sie den Namen.
- **„Unknown parent code '...'“**: Fügen Sie die übergeordnete Gruppe der Datei hinzu oder korrigieren Sie den Code.
- **„Unknown budget holder email '...'.“** oder **„Budget holder '...' is not an active user.“**: Die Zelle `owner_email` benennt den Budgetverantwortlichen. Verwenden Sie die E-Mail-Adresse eines aktiven Benutzers oder lassen Sie die Zelle leer.
- **„Code ... is already used on row N.“**: Zwei Zeilen tragen denselben Code. Behalten Sie eine.
- **„Type must be 'group' or 'cost_center'.“**: Korrigieren Sie die Zelle `kind`.
- **„Status is enabled but the end of validity has passed. Clear the date or set the status to disabled. If the file comes from an older export, export the data again.“**: Die Zeile ist aktiviert, aber ihr Datum ist bereits vorbei. Eine vor diesem Datum exportierte Datei enthält noch `enabled`: Exportieren Sie erneut oder korrigieren Sie die Zelle.
- **„Status is disabled but the end of validity is still to come. Set the status to enabled or set a date that has passed.“**: Die Zeile ist deaktiviert, aber ihr Datum liegt noch in der Zukunft. Korrigieren Sie die Zelle `status` oder `disabled_at`.
- **„Header mismatch“**: Laden Sie eine neue Vorlage herunter.

---

## Berechtigungen

| Stufe | Was sie erlaubt |
|---|---|
| `cost_centers:reader` | Die Liste ansehen und Kostenstellen öffnen |
| `cost_centers:member` | Kostenstellen und Gruppen erstellen und bearbeiten |
| `cost_centers:admin` | Alles oben Genannte, dazu CSV-Import und -Export sowie Löschen |

Jede Rolle beginnt mit der Stufe, die sie für Abteilungen hat, mit Ausnahme der integrierten Rolle Budget-Administrator, die admin erhält. Budget-Administrator und Stammdaten-Administrator sind also Administratoren, Budget-Mitglied und Stammdaten-Mitglied sind Mitglieder, und die Leserollen können lesen. Wer OPEX, CAPEX oder Reporting lesen kann, kann eine Kostenstelle auf einer Zeile oder in einem Berichtsfilter wählen, ohne Zugriff auf diese Seite zu haben.

---

## Tipps

- **Übernehmen Sie Ihre Finanzstruktur**: Verwenden Sie dieselben Codes wie Ihr Buchhaltungssystem, damit Budgetzeilen und Istwerte übereinstimmen.
- **Gruppieren Sie nach Verantwortung**: Bilden Sie Gruppen um die Personen, die für das Budget einstehen, bei Bedarf über Unternehmen hinweg.
- **Deaktivieren statt löschen**: Wenn eine Kostenstelle geschlossen wird, deaktivieren Sie sie. Ihre Zeilen behalten sie, und die Berichte bleiben konsistent.
- **Benennen Sie einen Budgetverantwortlichen**: Ein Budgetverantwortlicher auf jeder Kostenstelle erscheint auf jeder ihrer Zeilen, sodass alle wissen, wen sie zu einer Zeile fragen können.
