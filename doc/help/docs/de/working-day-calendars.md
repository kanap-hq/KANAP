# Arbeitstagekalender

Ein Arbeitstagekalender enthält die Anzahl der Arbeitstage jedes Monats, Jahr für Jahr. Mit ihm wird eine Budgetzeile mit Preis pro Tag multipliziert. Zum Beispiel kostet ein Berater zu 400 pro Tag im März 8.000, wenn sein Kalender im März 20 Arbeitstage enthält.

Jede OPEX- und CAPEX-Spalte, die mit einem Preis pro Tag berechnet wird, verwendet einen Kalender. Die anderen Berechnungsarten einer Zeile (pro Monat oder für den gesamten Zeitraum) brauchen keinen Kalender. Siehe [Aus Menge und Preis berechnen](opex.md#aus-menge-und-preis-berechnen).

---

## Erste Schritte

Navigieren Sie zu **Stammdaten > Arbeitstagekalender** (im Abschnitt **Finanzen**), um die Liste zu öffnen. Klicken Sie auf **Neu**, um Ihren ersten Kalender zu erstellen.

**Pflichtfelder**:

- **Code**: ein kurzer Code, den Ihr Team kennt. Importdateien finden den Kalender über diesen Code
- **Name**: der Name, den man im Budget-Tab auswählt, zum Beispiel „Mitarbeitende am Hauptsitz“

**Optional, aber nützlich**:

- **Beschreibung**: für wen der Kalender gilt, zum Beispiel „Arbeitstage der Angestellten, ohne Feiertage“

Sobald der Kalender angelegt ist, geben Sie in seinem Arbeitsbereich die Arbeitstage jedes Jahres ein.

**Tipp**: Wenn Ihr Finanzteam die Arbeitstage bereits in einer Tabellenkalkulation führt, importieren Sie sie aus einer CSV-Datei. Eine Zeile enthält einen Kalender und ein Jahr.

---

## Mit der Liste arbeiten

Solange der Arbeitsbereich noch keinen Kalender hat, weist eine Zeile unter dem Titel darauf hin: „Ein Kalender enthält die Arbeitstage jedes Monats, für Zeilen mit Preis pro Tag. Legen Sie einen an oder importieren Sie eine Datei.“

**Spalten**:

- **Code**: der Code des Kalenders
- **Name**: der Name des Kalenders
- **Jahre**: die Jahre, die der Kalender enthält, zum Beispiel „2026, 2027“
- **Status**: **Aktiviert** oder **Deaktiviert** (standardmäßig ausgeblendet, über die Spaltenauswahl hinzufügen)
- **Aktualisiert**: Datum und Uhrzeit der letzten Änderung

Klicken Sie auf eine beliebige Zelle, um den Arbeitsbereich zu öffnen.

**Sortierung**: Die Liste öffnet sich nach Namen sortiert. Klicken Sie auf eine Spaltenüberschrift, um stattdessen nach dieser Spalte zu sortieren.

**Filtern**:

- **Schnellsuche**: durchsucht den Code, den Namen und die Beschreibung
- **Status**: Der Spaltenfilter bietet **Aktiviert** und **Deaktiviert**
- **Statusbereich**: der Umschalter **Alle / Aktiv / Deaktiviert** über der Liste. Standardmäßig zeigt die Liste aktivierte Kalender

**Aktionen**:

- **Neu**: einen Kalender erstellen (erfordert `working_day_profiles:member`)
- **CSV importieren**: Kalender und ihre Arbeitstage aus einer Datei laden (erfordert `working_day_profiles:admin`)
- **CSV exportieren**: alle Kalender herunterladen (erfordert `working_day_profiles:admin`)
- **Auswahl löschen**: die ausgewählten Kalender löschen (erfordert `working_day_profiles:admin`). Kalender, die nicht gelöscht werden können, bleiben erhalten und werden mit dem Grund aufgeführt

---

## Einen Kalender erstellen

Klicken Sie auf **Neu**. Füllen Sie **Code**, **Name** und bei Bedarf **Beschreibung** aus und klicken Sie dann auf **Erstellen**. Ein neuer Kalender ist aktiviert.

Nach **Erstellen** öffnet sich der Arbeitsbereich des neuen Kalenders, bereit für seine Arbeitstage.

---

## Der Kalender-Arbeitsbereich

Klicken Sie auf eine beliebige Zeile der Liste, um den Arbeitsbereich zu öffnen.

- **Kopfzeile**: der Code als Referenz, mit einer Kopierschaltfläche, und der Name. Klicken Sie auf den Namen, um ihn zu ändern. **Zurück** / **Weiter** bewegen sich durch die Liste in ihrer aktuellen Reihenfolge und mit ihren Filtern, und die Schließen-Schaltfläche führt zur Liste zurück
- **Hauptbereich**: eine Zeile wie „Verwendet von 3 OPEX-Zeilen und 1 CAPEX-Zeile.“, wenn Budgetzeilen den Kalender verwenden, dann die **Beschreibung** und der Abschnitt **Arbeitstage**
- **Bereich Eigenschaften** rechts: **Code** und **Lebenszyklus**

**Automatisches Speichern**: Jede Änderung wird von selbst gespeichert. Es gibt keine Schaltfläche zum Speichern. Textfelder und Monate werden gespeichert, wenn Sie sie verlassen (drücken Sie Enter in **Code** oder in einem Monat, um sofort zu speichern); der Lebenszyklus wird gespeichert, sobald Sie ihn ändern. Wird eine Änderung abgelehnt, erscheint der Grund unter dem Feld, das sie verursacht hat, zum Beispiel ein doppelter Code unter **Code**.

### Felder

| Feld | Was Sie eingeben | Wo Sie diesen Wert finden |
|---|---|---|
| **Code** | Bis zu 50 Zeichen. Codes sind unabhängig von Groß- und Kleinschreibung eindeutig: `CAL-01` und `cal-01` sind derselbe Code | Der Code, den Ihr Finanzteam für diese Arbeitstage verwendet, zum Beispiel in seiner Budgetarbeitsmappe |
| **Name** | Bis zu 200 Zeichen. Namen sind unabhängig von Groß- und Kleinschreibung eindeutig | Der Name, unter dem Ihr Team den Kalender kennt. Dieser Name erscheint im Budget-Tab |
| **Beschreibung** | Freitext | Für wen der Kalender gilt und was er ausschließt |
| **Lebenszyklus** | Der Schalter **Aktiviert** und das Datum **Ende der Gültigkeit** | Setzen Sie ein zukünftiges Datum, um das Ende zu planen, oder schalten Sie den Schalter aus, um den Kalender heute zu deaktivieren |

### Arbeitstage

Der Abschnitt **Arbeitstage** zeigt jeweils ein Jahr.

- **Jahres-Tabs**: jedes Jahr, das der Kalender enthält, die Jahre um das aktuelle Jahr herum und je ein leeres Jahr vor und nach den gespeicherten Jahren, sodass sich das nächste Jahr immer hinzufügen lässt
- **Zwölf Monate**: ein Feld pro Monat. Geben Sie die Arbeitstage dieses Monats ein
- **Jahressumme**: die Zeile unter den Monaten, zum Beispiel „218 Tage in 2026“. Sie addiert die Monate während der Eingabe, mit höchstens 2 Dezimalstellen, zum Beispiel „229 Tage in 2026“ für zwölf Monate zu 19.083333
- **Aus 2025 übernehmen**: erscheint, wenn das Jahr leer ist und das Vorjahr Arbeitstage enthält. Füllt die zwölf Monate mit den Werten des Vorjahres und speichert sie. Passen Sie danach die abweichenden Monate an
- **2026 entfernen**: erscheint bei einem Jahr, das der Kalender enthält. Verwendet keine Budgetzeile den Kalender, wird das Jahr sofort entfernt. Verwenden Zeilen ihn, fragt zuerst ein Dialog: „Arbeitstage von 2026 entfernen?“ Er nennt die Anzahl der Zeilen und erklärt die Wirkung. Die Zeilen behalten ihre Beträge und Erläuterungen, aber keine von ihnen kann für dieses Jahr neu berechnet werden, und die Datei der Budgetzeilen kann sie nicht berechnen, bis die Tage erneut eingegeben sind. Klicken Sie zur Bestätigung auf **Trotzdem entfernen**

**Ein neues Jahr** wird gespeichert, sobald alle zwölf Monate ausgefüllt sind. Bis dahin sagt ein Hinweis „Füllen Sie alle zwölf Monate aus, um 2027 zu speichern.“ Danach wird jede Änderung gespeichert, sobald Sie den Monat verlassen.

**Regeln für die Monate**:

- **Höchstens die Kalendertage des Monats**: 31 für März, 30 für April, 28 für Februar, 29 für Februar in einem Schaltjahr. Ein größerer Wert wird abgelehnt: „März 2027 hat 31 Tage: Geben Sie höchstens 31 ein.“
- **Null oder mehr**: Ein negativer Wert wird abgelehnt.
- **Bis zu 6 Dezimalstellen**: Arbeitstage können Bruchzahlen sein, zum Beispiel `19.083333` für eine Jahressumme, die auf zwölf Monate verteilt ist. Mehr Dezimalstellen werden abgelehnt: „Verwenden Sie höchstens 6 Dezimalstellen.“
- **Alle zwölf Monate**: Ein Jahr enthält zwölf Werte. Einen Monat eines gespeicherten Jahres leer zu lassen, wird abgelehnt: „Geben Sie die Arbeitstage aller zwölf Monate von 2027 ein.“ Tragen Sie `0` für einen Monat ohne Arbeitstage ein.

**Eine Änderung der Arbeitstage ändert nie von selbst eine Budgetzeile.** Die Beträge bereits berechneter Zeilen bleiben unverändert, ebenso die Erläuterung, wie sie berechnet wurden. Öffnen Sie den Budget-Tab einer Zeile und klicken Sie auf **Neu berechnen**, um die neuen Tage anzuwenden. Das Feld listet dann die Monate auf, deren Tage sich geändert haben, zum Beispiel „März: 20 Tage, jetzt 19“.

---

## Deaktivierte Kalender

Deaktivieren Sie einen Kalender, wenn er nicht mehr verwendet werden soll, zum Beispiel nach einer Änderung der Arbeitszeitvereinbarung.

- Ein deaktivierter Kalender bleibt auf den Budgetzeilen, die ihn bereits verwenden. Ihre Beträge ändern sich nicht.
- Er kann für keine andere Zeile gewählt werden. Der Budget-Tab bietet nur aktivierte Kalender an, dazu den eigenen Kalender der Zeile.
- Eine Zeile, die ihn bereits verwendet, kann weiterhin neu berechnet werden. Das Feld warnt dann: „This calendar is disabled. The computation still uses it.“
- In einer Datei der Budgetzeilen wird eine Zeile abgelehnt, die einen deaktivierten Kalender einer Zeile zuweist, die ihn noch nicht verwendet: „Mitarbeitende am Hauptsitz is disabled. Pick an enabled calendar.“

---

## Löschen

Die Schaltfläche **Löschen** in der Kopfzeile löscht den Kalender sofort (erfordert `working_day_profiles:admin`). Sie ist deaktiviert, mit dem Grund in einer Zeile, solange Budgetzeilen den Kalender verwenden, zum Beispiel „Verwendet von 3 OPEX-Zeilen und 1 CAPEX-Zeile. Deaktivieren Sie ihn stattdessen.“

Dieselbe Regel gilt für **Auswahl löschen** in der Liste: Ein Kalender, den Budgetzeilen verwenden, bleibt erhalten, mit einem Grund wie „Mitarbeitende am Hauptsitz is used by 3 OPEX lines and 1 CAPEX line. Disable it instead.“

Eine Zeile verwendet einen Kalender, wenn eine ihrer Spalten, in einem beliebigen Jahr, mit einem Preis pro Tag auf diesem Kalender berechnet ist. **Budgetspalte zurücksetzen** in der Budgetadministration entfernt diese Verknüpfung für die zurückgesetzte Spalte. Siehe [Budgetspalte zurücksetzen](budget-operations.md#budgetspalte-zurucksetzen).

---

## CSV-Import/-Export

Laden oder aktualisieren Sie Kalender und ihre Arbeitstage aus einer Datei.

**Export**: Klicken Sie auf **CSV exportieren** und dann auf **Daten exportieren**. Die Datei enthält alle Kalender, aktiviert oder deaktiviert, nach Code sortiert. Für eine leere Datei nur mit den Kopfzeilen verwenden Sie **Vorlage herunterladen** im Importdialog.

**CSV-Struktur**:

- Trennzeichen: Semikolon `;`
- Kodierung: UTF-8 (in Excel als „CSV UTF-8“ speichern)
- Kopfzeilen: `code;name;description;status;disabled_at;year;jan;feb;mar;apr;may;jun;jul;aug;sep;oct;nov;dec`
- Eine Zeile pro Kalender und Jahr. Ein Kalender mit drei Jahren belegt drei Zeilen. Ein Kalender ohne Jahr wird als eine Zeile mit leerem Jahr und leeren Monaten exportiert

| Spalte | Inhalt |
|---|---|
| `code` | Pflicht. Der Code des Kalenders. Zeilen werden bestehenden Kalendern über den Code zugeordnet, unabhängig von Groß- und Kleinschreibung |
| `name` | Pflicht |
| `description` | Freitext |
| `status` | `enabled` oder `disabled`. Leer bedeutet `enabled` |
| `disabled_at` | Optionale Spalte. Das Ende der Gültigkeit: ein Datum (`2026-12-31`) oder ein vollständiges Datum mit Uhrzeit. Leer, wenn es kein Ende gibt |
| `year` | Vier Ziffern, von 2000 bis 2100. Leer bei einer Zeile, die nur die Felder des Kalenders setzt |
| `jan` bis `dec` | Die Arbeitstage jedes Monats, mit einem Punkt als Dezimaltrennzeichen (ein Komma wird auch akzeptiert). Pflicht bei einer Zeile mit Jahr |

**Import**:

1. Klicken Sie in der Liste auf **CSV importieren**
2. Wählen Sie Ihre Datei
3. Klicken Sie auf **Vorabprüfung**. Der Bericht nennt die Anzahl der Zeilen, die Einfügungen und Aktualisierungen sowie die Zeilen, die nichts ändern
4. Wenn die Vorabprüfung fehlerfrei ist, klicken Sie auf **Laden**

**So funktioniert der Import**:

- **Die gesamte Datei wird geprüft, bevor etwas geschrieben wird.** Eine Datei mit einem Fehler lädt nichts: Korrigieren Sie die Zeilen und führen Sie die Vorabprüfung erneut aus.
- **Zeilen eines Codes beschreiben einen Kalender.** Sie müssen beim Namen, bei der Beschreibung, beim Status und beim Ende der Gültigkeit übereinstimmen.
- **Monate folgen den Regeln des Arbeitsbereichs**: alle zwölf Monate, jeder höchstens mit den Kalendertagen des Monats, bis zu 6 Dezimalstellen.
- **In der Datei fehlende Jahre bleiben erhalten.** Ein Import fügt Jahre hinzu oder ersetzt sie. Er entfernt nie eines. Um ein Jahr zu entfernen, verwenden Sie seinen Link **... entfernen** im Arbeitsbereich.
- **Zählung**: Ein neuer Kalender oder ein neues Jahr zählt als Einfügung. Ein geändertes Jahr oder eine Änderung von Name, Beschreibung oder Lebenszyklus zählt als Aktualisierung. Eine Zeile, die dem gespeicherten Stand entspricht, gilt als unverändert. Wenn Sie dieselbe Datei exportieren und importieren, werden alle Zeilen als unverändert gemeldet.
- **In der Datei fehlende Kalender** bleiben unverändert. Der Import löscht nie.

**Häufige Fehler**:

- **„Rows of CAL-01 disagree on the name.“** (oder die Beschreibung, den Status, das Ende der Gültigkeit): Machen Sie die Zeilen dieses Codes in diesen Feldern identisch.
- **„CAL-01 has 2027 twice (rows 3 and 5).“**: Behalten Sie eine Zeile pro Kalender und Jahr.
- **„Enter the working days of all twelve months of 2027.“**: Füllen Sie jeden Monat der Zeile aus. Tragen Sie `0` für einen Monat ohne Arbeitstage ein.
- **„March 2027 has 31 days: enter 31 or less.“**: Korrigieren Sie den Monat.
- **„Use at most 6 decimals.“**: Runden Sie den Wert.
- **„Give the year of these working days.“**: Die Zeile hat Monate, aber kein Jahr.
- **„A calendar named ... already exists.“**: Ein anderer Kalender verwendet diesen Namen bereits. Namen sind unabhängig von Groß- und Kleinschreibung eindeutig.
- **„Header mismatch“**: Laden Sie eine neue Vorlage herunter.

---

## Berechtigungen

| Stufe | Was sie erlaubt |
|---|---|
| `working_day_profiles:reader` | Die Liste ansehen und Kalender öffnen |
| `working_day_profiles:member` | Kalender erstellen, sie und ihre Arbeitstage bearbeiten |
| `working_day_profiles:admin` | Alles oben Genannte, dazu CSV-Import und -Export sowie Löschen |

Budget-Administratoren sind Kalender-Administratoren: Die integrierte Rolle Budget-Administrator erhält admin. Jede andere Rolle beginnt mit der Stufe, die sie für Abteilungen hat. Stammdaten-Administrator ist also admin, Budget-Mitglied und Stammdaten-Mitglied sind Mitglieder, und die Leserollen können lesen.

Wer OPEX oder CAPEX lesen kann, kann im Budget-Tab einen Kalender wählen, ohne Zugriff auf diese Seite zu haben.

---

## Tipps

- **Ein Kalender pro Arbeitszeitvereinbarung**: Personen mit derselben Vereinbarung teilen dieselben Arbeitstage. Erstellen Sie einen Kalender für jede Vereinbarung, nicht einen pro Person.
- **Benennen Sie ihn nach den Personen, die er abdeckt**: Der Budget-Tab zeigt den Namen, daher sagt „Mitarbeitende am Hauptsitz“ mehr als ein Code.
- **Bereiten Sie das nächste Jahr früh vor**: Verwenden Sie **Aus ... übernehmen** im neuen Jahr und passen Sie dann die abweichenden Monate an. Eine pro Tag berechnete Zeile kann nicht für ein Jahr neu berechnet werden, das ihr Kalender nicht enthält.
- **Deaktivieren statt löschen**: Wird ein Kalender nicht mehr für neue Zeilen verwendet, deaktivieren Sie ihn. Die Zeilen, die ihn verwenden, behalten ihre Beträge und können weiterhin neu berechnet werden.
