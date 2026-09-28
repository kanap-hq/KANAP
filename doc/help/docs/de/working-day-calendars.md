# Arbeitstagekalender

Ein Arbeitstagekalender enthält die Anzahl der Arbeitstage jedes Monats, Jahr für Jahr. Mit ihm wird eine Budgetzeile mit Preis pro Tag multipliziert. Zum Beispiel kostet ein Berater zu 400 pro Tag im März 8.000, wenn sein Kalender im März 20 Arbeitstage enthält.

Es gibt zwei Arten von Kalendern:

- **Standard**: aus einem Land angelegt, und aus einer Region, wenn das Land Regionen hat. Die Arbeitstage eines beliebigen Jahres sind die Wochentage jedes Monats abzüglich der Feiertage des Landes. Sie müssen nichts eingeben und können trotzdem jeden Monat jedes Jahres ändern
- **Individuell**: Sie geben die Arbeitstage jedes Jahres selbst ein, zum Beispiel für eine Arbeitszeitvereinbarung mit eigenen freien Tagen

Im Budget-Tab einer OPEX- oder CAPEX-Position verwendet jede Zeile mit Preis pro Tag einen Kalender. Zeilen mit Preis pro Monat oder einmaligem Preis brauchen keinen. Siehe [Menge und Preis](opex.md#menge-und-preis).

---

## Erste Schritte

Navigieren Sie zu **Stammdaten > Arbeitstagekalender** (im Abschnitt **Finanzen**), um die Liste zu öffnen.

Am schnellsten starten Sie mit einem Standardkalender für jedes Land, in dem Ihre Unternehmen ansässig sind:

- **Wenn Sie ein Unternehmen** mit einem Land anlegen, legt KANAP den Standardkalender dieses Landes für Sie an, sofern der Arbeitsbereich noch keinen für das ganze Land hat
- **Für Ihre bestehenden Unternehmen** zeigt die Listenseite eine Zeile über dem Raster, zum Beispiel „Länder Ihrer Unternehmen: Frankreich, Niederlande und Italien. Legen Sie ihre Standardkalender an.“ Klicken Sie auf **3 Kalender anlegen**, um sie in einem Schritt anzulegen

Um selbst einen Kalender anzulegen, klicken Sie auf **Neu**.

**Pflichtfelder**:

- **Code**: ein kurzer Code, den Ihr Team kennt. Importdateien finden den Kalender über diesen Code
- **Name**: der Name, den man im Budget-Tab auswählt, zum Beispiel „Mitarbeitende am Hauptsitz“

**Optional, aber nützlich**:

- **Land** und **Region**: machen den Kalender zu einem Standardkalender. Ohne Land ist der Kalender individuell
- **Beschreibung**: für wen der Kalender gilt, zum Beispiel „Arbeitstage der Angestellten, ohne Feiertage“

**Tipp**: Wenn Ihr Finanzteam die Arbeitstage bereits in einer Tabellenkalkulation führt, importieren Sie sie aus einer CSV-Datei. Eine Zeile enthält einen Kalender und ein Jahr.

---

## Mit der Liste arbeiten

Solange der Arbeitsbereich noch keinen Kalender hat, weist eine Zeile unter dem Titel darauf hin: „Ein Kalender enthält die Arbeitstage jedes Monats, für Zeilen mit Preis pro Tag. Legen Sie einen an oder importieren Sie eine Datei.“

**Spalten**:

- **Code**: der Code des Kalenders
- **Name**: der Name des Kalenders
- **Land**: das Land eines Standardkalenders, mit der Region in Klammern, zum Beispiel „Frankreich (Département Moselle)“. Leer bei einem individuellen Kalender
- **Jahre**: „Alle Jahre“ bei einem Standardkalender, gefolgt von den Jahren, die Sie geändert haben, zum Beispiel „Alle Jahre, 2026 geändert“. Bei einem individuellen Kalender die Jahre, die er enthält, zum Beispiel „2026, 2027“
- **Status**: **Aktiviert** oder **Deaktiviert** (standardmäßig ausgeblendet, über die Spaltenauswahl hinzufügen)
- **Aktualisiert**: Datum und Uhrzeit der letzten Änderung

Klicken Sie auf eine beliebige Zelle, um den Arbeitsbereich zu öffnen.

**Sortierung**: Die Liste öffnet sich nach Namen sortiert. Klicken Sie auf eine Spaltenüberschrift, um stattdessen nach dieser Spalte zu sortieren.

**Filtern**:

- **Schnellsuche**: durchsucht den Code, den Namen, die Beschreibung sowie Land und Region eines Standardkalenders
- **Status**: Der Spaltenfilter bietet **Aktiviert** und **Deaktiviert**
- **Statusbereich**: der Umschalter **Alle / Aktiv / Deaktiviert** über der Liste. Standardmäßig zeigt die Liste aktivierte Kalender

**Vorgeschlagene Kalender**: Wer Kalender anlegen darf, sieht über dem Raster eine Zeile mit den Ländern Ihrer aktivierten Unternehmen, die noch keinen Standardkalender haben, und eine Schaltfläche, die sie anlegt. Jeder Kalender erhält den Ländercode als Code und den Namen des Landes in Ihrer Sprache als Namen. Die Zeile verschwindet, sobald jedes Land seinen Kalender hat.

**Aktionen**:

- **Neu**: einen Kalender erstellen (erfordert `working_day_profiles:member`)
- **CSV importieren**: Kalender und ihre Arbeitstage aus einer Datei laden (erfordert `working_day_profiles:admin`)
- **CSV exportieren**: alle Kalender herunterladen (erfordert `working_day_profiles:admin`)
- **Auswahl löschen**: die ausgewählten Kalender löschen (erfordert `working_day_profiles:admin`). Kalender, die nicht gelöscht werden können, bleiben erhalten und werden mit dem Grund aufgeführt

---

## Einen Kalender erstellen

Klicken Sie auf **Neu** und dann:

1. **Land** (optional): Tippen Sie, um nach Name oder zweistelligem Code zu suchen. Mit einem Land ist der Kalender ein Standardkalender
2. **Region**: erscheint, wenn das Land Regionen hat, zum Beispiel die deutschen Bundesländer oder die französischen Départements mit eigenen Feiertagen. Behalten Sie **Ganzes Land** oder wählen Sie eine Region
3. **Code** und **Name**: Die Wahl eines Landes füllt sie aus, zum Beispiel `FR-57` und „Frankreich (Département Moselle)“. Ändern Sie sie bei Bedarf
4. **Beschreibung**: optional
5. Klicken Sie auf **Erstellen**

Ein neuer Kalender ist aktiviert, und sein Arbeitsbereich öffnet sich. Ein Standardkalender enthält bereits die Arbeitstage jedes Jahres. Bei einem individuellen Kalender geben Sie sie Jahr für Jahr ein.

Land und Region werden einmal festgelegt, beim Anlegen. Um einem anderen Land zu folgen, legen Sie einen weiteren Kalender an.

---

## Der Kalender-Arbeitsbereich

Klicken Sie auf eine beliebige Zeile der Liste, um den Arbeitsbereich zu öffnen.

- **Kopfzeile**: der Code als Referenz, mit einer Kopierschaltfläche, und der Name. Klicken Sie auf den Namen, um ihn zu ändern. **Zurück** / **Weiter** bewegen sich durch die Liste in ihrer aktuellen Reihenfolge und mit ihren Filtern, und die Schließen-Schaltfläche führt zur Liste zurück
- **Hauptbereich**: eine Zeile wie „Verwendet von 3 OPEX-Zeilen und 1 CAPEX-Zeile.“, wenn Budgetzeilen den Kalender verwenden, dann die **Beschreibung** und der Abschnitt **Arbeitstage**
- **Bereich Eigenschaften** rechts: **Code**, **Quelle** (nur bei Standardkalendern, zum Beispiel „Frankreich (Département Moselle)“, schreibgeschützt) und **Lebenszyklus**

**Automatisches Speichern**: Jede Änderung wird von selbst gespeichert. Es gibt keine Schaltfläche zum Speichern. Textfelder und Monate werden gespeichert, wenn Sie sie verlassen (drücken Sie Enter in **Code** oder in einem Monat, um sofort zu speichern); der Lebenszyklus wird gespeichert, sobald Sie ihn ändern. Wird eine Änderung abgelehnt, erscheint der Grund unter dem Feld, das sie verursacht hat, zum Beispiel ein doppelter Code unter **Code**.

### Felder

| Feld | Was Sie eingeben | Wo Sie diesen Wert finden |
|---|---|---|
| **Code** | Bis zu 50 Zeichen. Codes sind unabhängig von Groß- und Kleinschreibung eindeutig: `CAL-01` und `cal-01` sind derselbe Code | Der Code, den Ihr Finanzteam für diese Arbeitstage verwendet, zum Beispiel in seiner Budgetarbeitsmappe. Bei einem Standardkalender ist der Ländercode eine gute Wahl |
| **Name** | Bis zu 200 Zeichen. Namen sind unabhängig von Groß- und Kleinschreibung eindeutig | Der Name, unter dem Ihr Team den Kalender kennt. Dieser Name erscheint im Budget-Tab |
| **Beschreibung** | Freitext | Für wen der Kalender gilt und was er ausschließt |
| **Land** / **Region** | Nur beim Anlegen. Die Liste der Regionen richtet sich nach dem Land | Das Land, in dem die Personen oder Dienste des Kalenders arbeiten, und die Region, wenn deren Feiertage abweichen |
| **Lebenszyklus** | Der Schalter **Aktiviert** und das Datum **Ende der Gültigkeit** | Setzen Sie ein zukünftiges Datum, um das Ende zu planen, oder schalten Sie den Schalter aus, um den Kalender heute zu deaktivieren |

### Arbeitstage eines Standardkalenders

Der Abschnitt **Arbeitstage** zeigt jeweils ein Jahr, mit denselben Jahres-Tabs wie der Budget-Tab: fünf Jahre um das aktuelle Jahr herum und Pfeile, um jeweils ein Jahr weiterzugehen, von 2000 bis 2100. Jedes Jahr ist vorhanden: Sie müssen nichts hinzufügen.

- **Zwölf Monate**: Jeder Monat zeigt seine Arbeitstage, also die Wochentage (Montag bis Freitag), die kein Feiertag sind
- **Jahressumme**: die Zeile unter den Monaten, zum Beispiel „252 Tage in 2026“
- **Feiertage**: Eine Zeile listet die Feiertage des Jahres mit ihrem Datum auf, zum Beispiel „Feiertage: 1. Jan. Neujahr, 6. Apr. Ostermontag, …“. Ein Feiertag, der auf einen Samstag oder Sonntag fällt, erscheint mit „(Wochenende)“: Er entfernt keinen Arbeitstag, was die Zählung erklärt

**Einen Monat ändern**: Geben Sie den gewünschten Wert ein, zum Beispiel um einen Schließtag des Unternehmens abzuziehen. Das Jahr wird dann zu einem geänderten Jahr: Seine zwölf Monate bleiben so, wie sie jetzt sind, und die anderen Jahre folgen weiterhin den Feiertagen.

- Unter der Summe eines geänderten Jahres nennt eine Zeile die Standardwerte, zum Beispiel „Standardwerte: 252 Tage“
- **Auf Standardwerte zurücksetzen** bringt das Jahr sofort auf die Feiertage zurück. Es gibt keine Bestätigung: Die eingegebenen Werte werden durch die Standardwerte ersetzt

**Woher die Standardwerte stammen**: Die Feiertagsregeln stammen aus [`date-holidays`](https://github.com/commenthol/date-holidays), einer Open-Source-Bibliothek, die in KANAP enthalten ist. Die Regeln werden mit der Anwendung ausgeliefert, sodass Standardkalender ohne Internetzugang funktionieren. Die Feiertagsdaten stehen unter der Lizenz Creative Commons Attribution-ShareAlike 3.0 (CC BY-SA 3.0), und KANAP verwendet sie unverändert. Nur gesetzliche Feiertage zählen, Bankfeiertage, Schulferien und Gedenktage zählen nicht. Ein Feiertag, der am Abend beginnt (ab 18 Uhr), wie Heiligabend im australischen Northern Territory, entfernt den Tag nicht; beginnt er früher am Tag, entfernt er den ganzen Tag.

### Arbeitstage eines individuellen Kalenders

Der Abschnitt **Arbeitstage** zeigt jeweils ein Jahr.

- **Jahres-Tabs**: jedes Jahr, das der Kalender enthält, die Jahre um das aktuelle Jahr herum und je ein leeres Jahr vor und nach den gespeicherten Jahren, sodass sich das nächste Jahr immer hinzufügen lässt
- **Zwölf Monate**: ein Feld pro Monat. Geben Sie die Arbeitstage dieses Monats ein
- **Jahressumme**: die Zeile unter den Monaten, zum Beispiel „218 Tage in 2026“. Sie addiert die Monate während der Eingabe, mit höchstens 2 Dezimalstellen, zum Beispiel „229 Tage in 2026“ für zwölf Monate zu 19.083333
- **Aus 2025 übernehmen**: erscheint, wenn das Jahr leer ist und das Vorjahr Arbeitstage enthält. Füllt die zwölf Monate mit den Werten des Vorjahres und speichert sie. Passen Sie danach die abweichenden Monate an
- **2026 entfernen**: erscheint bei einem Jahr, das der Kalender enthält. Verwendet keine Budgetzeile den Kalender, wird das Jahr sofort entfernt. Verwenden Zeilen ihn, fragt zuerst ein Dialog: „Arbeitstage von 2026 entfernen?“ Er nennt die Anzahl der Zeilen und erklärt die Wirkung. Die Zeilen behalten ihre Beträge, aber Zeilen mit Preis pro Tag auf diesem Kalender können für dieses Jahr nicht gespeichert werden, bis die Tage erneut eingegeben sind. Klicken Sie zur Bestätigung auf **Trotzdem entfernen**

**Ein neues Jahr** wird gespeichert, sobald alle zwölf Monate ausgefüllt sind. Bis dahin sagt ein Hinweis „Füllen Sie alle zwölf Monate aus, um 2027 zu speichern.“ Danach wird jede Änderung gespeichert, sobald Sie den Monat verlassen.

### Regeln für die Monate

Diese Regeln gelten für beide Arten von Kalendern:

- **Höchstens die Kalendertage des Monats**: 31 für März, 30 für April, 28 für Februar, 29 für Februar in einem Schaltjahr. Ein größerer Wert wird abgelehnt: „März 2027 hat 31 Tage: Geben Sie höchstens 31 ein.“
- **Null oder mehr**: Ein negativer Wert wird abgelehnt.
- **Bis zu 6 Dezimalstellen**: Arbeitstage können Bruchzahlen sein, zum Beispiel `19.083333` für eine Jahressumme, die auf zwölf Monate verteilt ist. Mehr Dezimalstellen werden abgelehnt: „Verwenden Sie höchstens 6 Dezimalstellen.“
- **Alle zwölf Monate**: Ein Jahr enthält zwölf Werte. Einen Monat eines gespeicherten Jahres leer zu lassen, wird abgelehnt: „Geben Sie die Arbeitstage aller zwölf Monate von 2027 ein.“ Tragen Sie `0` für einen Monat ohne Arbeitstage ein.

### Wenn sich Arbeitstage ändern

**Eine Änderung der Arbeitstage ändert nie von selbst eine Budgetzeile.** Die bereits auf einer Budgetzeile gespeicherten Beträge bleiben unverändert. Wenn Sie den Budget-Tab der Zeile öffnen, weist der Tab **Menge und Preis** darauf hin, zum Beispiel „Seit der letzten Berechnung geänderte Arbeitstage: März: 20 Tage, jetzt 19“. Klicken Sie dort auf **Die Zeilen wieder verwenden**, um die neuen Tage anzuwenden.

---

## Deaktivierte Kalender

Deaktivieren Sie einen Kalender, wenn er nicht mehr verwendet werden soll, zum Beispiel nach einer Änderung der Arbeitszeitvereinbarung.

- Ein deaktivierter Kalender bleibt auf den Budgetzeilen, die ihn bereits verwenden. Ihre Beträge ändern sich nicht.
- Er kann für keine andere Zeile gewählt werden. Der Budget-Tab bietet nur aktivierte Kalender an, dazu den Kalender, den eine Zeile bereits verwendet, mit dem Zusatz „(deaktiviert)“.
- Zeilen, die ihn bereits verwenden, können weiterhin gespeichert werden. Das Feld warnt dann, zum Beispiel: „Mitarbeitende am Hauptsitz ist deaktiviert. Die Zeilen verwenden ihn weiterhin.“

---

## Löschen

Die Schaltfläche **Löschen** in der Kopfzeile löscht den Kalender sofort (erfordert `working_day_profiles:admin`). Sie ist deaktiviert, mit dem Grund in einer Zeile, solange Budgetzeilen den Kalender verwenden, zum Beispiel „Verwendet von 3 OPEX-Zeilen und 1 CAPEX-Zeile. Deaktivieren Sie ihn stattdessen.“

Dieselbe Regel gilt für **Auswahl löschen** in der Liste: Ein Kalender, den Budgetzeilen verwenden, bleibt erhalten, mit einem Grund wie „Mitarbeitende am Hauptsitz is used by 3 OPEX lines and 1 CAPEX line. Disable it instead.“

Eine Budgetzeile verwendet einen Kalender, wenn eine ihrer Spalten, in einem beliebigen Jahr, eine Zeile mit Preis pro Tag auf diesem Kalender hat. Das Entfernen dieser Zeile im Budget-Tab oder **Budgetspalte zurücksetzen** in der Budgetadministration hebt die Verknüpfung auf. Siehe [Budgetspalte zurücksetzen](budget-operations.md#budgetspalte-zurucksetzen).

---

## CSV-Import/-Export

Laden oder aktualisieren Sie Kalender und ihre Arbeitstage aus einer Datei.

**Export**: Klicken Sie auf **CSV exportieren** und dann auf **Daten exportieren**. Die Datei enthält alle Kalender, aktiviert oder deaktiviert, nach Code sortiert. Für eine leere Datei nur mit den Kopfzeilen verwenden Sie **Vorlage herunterladen** im Importdialog.

**CSV-Struktur**:

- Trennzeichen: Semikolon `;`
- Kodierung: UTF-8 (in Excel als „CSV UTF-8“ speichern)
- Kopfzeilen: `code;name;description;country;region;status;disabled_at;year;jan;feb;mar;apr;may;jun;jul;aug;sep;oct;nov;dec`
- Eine Zeile pro Kalender und Jahr. Ein Kalender mit drei Jahren belegt drei Zeilen. Ein Kalender ohne Jahr wird als eine Zeile mit leerem Jahr und leeren Monaten exportiert
- Ein Standardkalender exportiert nur die Jahre, die Sie geändert haben. Die anderen Jahre folgen den Feiertagen und brauchen keine Zeile
- Die Spalten `country`, `region` und `disabled_at` sind beim Import optional. Eine Datei ohne `country` und `region` legt individuelle Kalender an

| Spalte | Inhalt |
|---|---|
| `code` | Pflicht. Der Code des Kalenders. Zeilen werden bestehenden Kalendern über den Code zugeordnet, unabhängig von Groß- und Kleinschreibung |
| `name` | Pflicht |
| `description` | Freitext |
| `country` | Optional. Der zweistellige Ländercode eines Standardkalenders, zum Beispiel `FR`. Leer bei einem individuellen Kalender |
| `region` | Optional. Der Regionscode, zum Beispiel `57` für Moselle oder `BY` für Bayern. Erfordert ein Land. Leer für das ganze Land |
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
- **Zeilen eines Codes beschreiben einen Kalender.** Sie müssen beim Namen, bei der Beschreibung, beim Land, bei der Region, beim Status und beim Ende der Gültigkeit übereinstimmen.
- **Land und Region gelten, wenn die Datei einen Kalender anlegt.** Bei einem bestehenden Kalender lassen Sie sie leer oder geben die Werte des Kalenders an. Ein abweichender Wert wird abgelehnt.
- **Jahre eines Standardkalenders werden zu geänderten Jahren.** Die anderen Jahre folgen weiterhin den Feiertagen.
- **Monate folgen den Regeln des Arbeitsbereichs**: alle zwölf Monate, jeder höchstens mit den Kalendertagen des Monats, bis zu 6 Dezimalstellen.
- **In der Datei fehlende Jahre bleiben erhalten.** Ein Import fügt Jahre hinzu oder ersetzt sie. Er entfernt nie eines. Um ein Jahr zu entfernen, verwenden Sie seinen Link **... entfernen** im Arbeitsbereich oder bei einem Standardkalender **Auf Standardwerte zurücksetzen**.
- **Zählung**: Ein neuer Kalender oder ein neues Jahr zählt als Einfügung. Ein geändertes Jahr oder eine Änderung von Name, Beschreibung oder Lebenszyklus zählt als Aktualisierung. Eine Zeile, die dem gespeicherten Stand entspricht, gilt als unverändert. Wenn Sie dieselbe Datei exportieren und importieren, werden alle Zeilen als unverändert gemeldet.
- **In der Datei fehlende Kalender** bleiben unverändert. Der Import löscht nie.

**Häufige Fehler**:

- **„Rows of CAL-01 disagree on the name.“** (oder die Beschreibung, das Land, die Region, den Status, das Ende der Gültigkeit): Machen Sie die Zeilen dieses Codes in diesen Feldern identisch.
- **„CAL-01 has 2027 twice (rows 3 and 5).“**: Behalten Sie eine Zeile pro Kalender und Jahr.
- **„Enter the working days of all twelve months of 2027.“**: Füllen Sie jeden Monat der Zeile aus. Tragen Sie `0` für einen Monat ohne Arbeitstage ein.
- **„March 2027 has 31 days: enter 31 or less.“**: Korrigieren Sie den Monat.
- **„Use at most 6 decimals.“**: Runden Sie den Wert.
- **„Give the year of these working days.“**: Die Zeile hat Monate, aber kein Jahr.
- **„Country XX is not in the list.“**: Verwenden Sie einen zweistelligen Ländercode, zum Beispiel `FR` oder `DE`.
- **„BY is not a region of France.“**: Die Region gehört nicht zum Land. Korrigieren Sie die Region oder lassen Sie sie für das ganze Land leer.
- **„Give the country of region BY.“**: Eine Region erfordert ihr Land.
- **„The country of a calendar cannot be changed. Create another calendar.“**: Die Zeile nennt ein anderes Land oder eine andere Region als der gespeicherte Kalender. Lassen Sie beide Zellen leer oder geben Sie die Werte des Kalenders an.
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

- **Beginnen Sie mit den Standardkalendern**: Einer pro Land deckt die meisten Budgets ab. Fügen Sie eine Region nur hinzu, wenn deren Feiertage abweichen, zum Beispiel Moselle in Frankreich oder Bayern in Deutschland.
- **Ein Kalender pro Arbeitszeitvereinbarung**: Wenn Personen eigene freie Tage haben, legen Sie einen individuellen Kalender für ihre Vereinbarung an, nicht einen pro Person.
- **Benennen Sie ihn nach den Personen, die er abdeckt**: Der Budget-Tab zeigt den Namen, daher sagt „Mitarbeitende am Hauptsitz“ mehr als ein Code.
- **Bereiten Sie bei einem individuellen Kalender das nächste Jahr früh vor**: Verwenden Sie **Aus ... übernehmen** im neuen Jahr und passen Sie dann die abweichenden Monate an. Eine Zeile mit Preis pro Tag kann nicht für ein Jahr gespeichert werden, das ihr Kalender nicht enthält. Standardkalender brauchen nichts: Jedes Jahr ist bereits vorhanden.
- **Deaktivieren statt löschen**: Wird ein Kalender nicht mehr für neue Zeilen verwendet, deaktivieren Sie ihn. Die Zeilen, die ihn verwenden, behalten ihre Beträge und können weiterhin gespeichert werden.
