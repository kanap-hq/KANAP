# Budget-Administration

Die Budget-Administration bietet Ihnen eine Reihe von Werkzeugen zur Verwaltung und Transformation von Budgetdaten über Jahre und Spalten hinweg. Dies sind die Operationen, die Sie während der Budgetplanungszyklen benötigen: die Vorbereitung der Zahlen für das nächste Jahr, das Einfrieren genehmigter Budgets und die Verwaltung von Jahresübergängen.

## Wo Sie es finden

- Pfad: **Budgetverwaltung > Administration**
- Berechtigungen: Jede Karte wird nur den Benutzern angezeigt, die sie verwenden können (siehe die Tabelle unten). **Administration** erscheint im Menü, sobald Sie mindestens eine Karte verwenden können.

Die Startseite hat zwei Abschnitte. Jede Karte führt zu einem eigenen Werkzeug. Ein leerer Abschnitt wird ausgeblendet.

**Einstellungen**

| Werkzeug | Zweck |
|----------|-------|
| **Währungen** | Die Reporting- und Standardwährungen festlegen und die Wechselkurse prüfen. Siehe [Währungseinstellungen](currencies.md) |
| **Budgetspalten** | Die fünf Budgetspalten benennen, die angezeigten Spalten und die Standardspalte wählen |
| **Standard-Zuordnungsmethode** | Die Methode festlegen, der OPEX- und CAPEX-Positionen standardmäßig folgen |

**Vorgänge**

| Werkzeug | Zweck |
|----------|-------|
| **Daten einfrieren / auftauen** | Budgetspalten sperren, um Änderungen zu verhindern |
| **Budgetspalten kopieren** | Daten zwischen Jahren und Spalten mit Anpassungen kopieren |
| **Zuordnungen kopieren** | Zuordnungsmethoden von einem Jahr in ein anderes kopieren |
| **Budgetspalte zurücksetzen** | Alle Daten einer bestimmten Spalte löschen |
| **Stammdaten einfrieren** | Die Kennzahlen der Unternehmen und Abteilungen für ein Jahr sperren. Siehe [Stammdaten einfrieren und Jahreskennzahlen kopieren](master-data-operations.md) |
| **Jahreskennzahlen kopieren** | Die Kennzahlen der Unternehmen und Abteilungen von einem Jahr in ein anderes kopieren. Siehe [Stammdaten einfrieren und Jahreskennzahlen kopieren](master-data-operations.md) |

| Karten | Wer sie sieht |
|---|---|
| Währungen, Budgetspalten, Standard-Zuordnungsmethode, Daten einfrieren / auftauen | Budgetadministration auf Administratorebene (`budget_ops:admin`) |
| Budgetspalten kopieren, Zuordnungen kopieren, Budgetspalte zurücksetzen | OPEX oder CAPEX auf Administratorebene. Die Registerkarten OPEX und CAPEX folgen derselben Regel: Ein OPEX-Administrator arbeitet nur mit OPEX-Positionen |
| Stammdaten einfrieren, Jahreskennzahlen kopieren | Benutzer mit Zugriff auf das Budget, die Administratoren der Budgetadministration, von Unternehmen oder Abteilungen sind. Administratoren von Unternehmen und Abteilungen handeln für ihren eigenen Bereich |

Die integrierte Rolle Budget-Administrator sieht alle Karten. Budget-Mitglied und Budget-Leser sehen keine, daher fehlt **Administration** in ihrem Menü.

Die Budgetspalten sind Budget, Revision, Prognose, Ist-Werte und Erwarteter Endwert. Das sind die Standardnamen. Ihre Organisation kann sie umbenennen, einige ausblenden und unter [Budgetspalten](#budgetspalten) eine Standardspalte wählen. Jede der folgenden Seiten zeigt die Namen, die Ihre Organisation gewählt hat.

Solange einer dieser Vorgänge läuft, können OPEX- und CAPEX-Positionen nicht gespeichert werden: Eine Änderung zeigt die Meldung „Ein anderer Budgetvorgang läuft gerade. Bitte versuchen Sie es erneut, wenn er abgeschlossen ist.“, bis der Vorgang abgeschlossen ist.

---

## Daten einfrieren / auftauen

Sperren Sie Budgetspalten, sodass sie nicht bearbeitet, importiert oder auf andere Weise geändert werden können. Das Einfrieren schützt genehmigte Zahlen vor versehentlichen Änderungen.

### Wann verwenden

- Nach der Genehmigung des Jahresbudgets
- Beim Abschluss einer Geschäftsperiode
- Zum Schutz von Ist-Werten vor Änderungen

### Funktionsweise

1. **Wählen Sie ein Jahr** aus dem Dropdown (Bereich: aktuelles Jahr minus eins bis aktuelles Jahr plus vier)
2. **Wählen Sie Geltungsbereiche**: Aktivieren Sie **OPEX**, **CAPEX** oder beides
3. **Wählen Sie Spalten** für jeden Bereich. Die Liste bietet alle fünf Spalten an. Ausgeblendete Spalten sind mit **Ausgeblendet** gekennzeichnet. Alle Spalten sind standardmäßig ausgewählt: Das Einfrieren eines Jahres friert also jede Spalte ein, auch die ausgeblendeten. Entfernen Sie das Häkchen bei einer Spalte, um sie auszulassen
4. Klicken Sie auf **Daten einfrieren** zum Sperren oder **Daten auftauen** zum Entsperren. Beide Schaltflächen bleiben deaktiviert, solange in einem gewählten Bereich keine Spalte ausgewählt ist

### Was das Einfrieren bewirkt

- Verhindert Bearbeitungen an eingefrorenen Spalten in OPEX- und CAPEX-Arbeitsbereichen
- Blockiert CSV-Importe in eingefrorene Spalten
- Blockiert Kopier- und Zurücksetzungsoperationen für eingefrorene Spalten
- Beeinflusst **nicht** den Lesezugriff: Die Daten bleiben sichtbar
- Gilt auch für ausgeblendete Spalten. Eine eingefrorene Spalte bleibt eingefroren, wenn sie ausgeblendet wird, und Importe in sie werden weiterhin abgelehnt

### Das Einfrieren der Standardspalte schreibt die Wechselkurse fest

Wenn Sie die [Standardspalte](#budgetspalten) für ein Jahr einfrieren, werden auch die Wechselkurse dieses Jahres für den eingefrorenen Bereich festgeschrieben. KANAP aktualisiert die Kurse des Jahres und behält dann den neuesten Satz für jeden OPEX- oder CAPEX-Betrag dieses Jahres. Berichte rechnen diese Beträge danach mit denselben Kursen um, auch wenn neuere Kurse eintreffen. Das Auftauen der Standardspalte gibt sie wieder frei.

Das Einfrieren einer anderen Spalte berührt die Kurse nicht. Eine spätere Änderung der Standardspalte schreibt von sich aus nichts fest und gibt nichts frei: Die Kurse folgen dem nächsten Einfrieren oder Auftauen der neuen Standardspalte.

### Aktueller Status

Unterhalb der Steuerelemente zeigen zwei Karten den Echtzeit-Einfrierstatus aller fünf Spalten in OPEX und CAPEX. Jede Spalte zeigt entweder **Eingefroren** (in Rot) oder **Bearbeitbar** an. Ausgeblendete Spalten sind mit **Ausgeblendet** gekennzeichnet.

### Berechtigungen

Einfrieren und Auftauen erfordern `budget_ops:admin`. Die Karte ist für andere Benutzer ausgeblendet.

---

## Budgetspalten kopieren

Kopieren Sie Budgetdaten von einem Jahr und einer Spalte in eine andere, mit einer optionalen prozentualen Anpassung. Dies ist das primäre Werkzeug zur Vorbereitung des nächsten Jahresbudgets aus dem aktuellen.

Der Umschalter **OPEX** / **CAPEX** oben auf der Seite legt fest, auf welche Positionen sich die Kopie bezieht. OPEX ist standardmäßig ausgewählt, wenn Sie OPEX-Positionen lesen dürfen, andernfalls CAPEX.

Erfordert Administrationsrechte für OPEX, bzw. für CAPEX bei CAPEX-Positionen.

### Wann verwenden

- Vorbereitung des nächsten Jahresbudgets aus dem aktuellen Jahr
- Erstellen einer Revision aus dem genehmigten Budget
- Fortschreibung von Prognosen mit einem Inflationsfaktor

### Felder

| Feld | Beschreibung |
|------|--------------|
| **Quelljahr** | Jahr, aus dem kopiert wird (Bereich: aktuelles Jahr minus eins bis aktuelles Jahr plus fünf) |
| **Quellspalte** | Jede angezeigte Spalte, auch Prognose, wenn sie angezeigt wird. Beginnt mit der Standardspalte |
| **Zieljahr** | Jahr, in das kopiert wird (gleicher Bereich) |
| **Zielspalte** | Jede angezeigte Spalte. Beginnt mit der Standardspalte |
| **Prozentuale Erhöhung** | Anpassung, die auf jeden kopierten Monat angewendet wird (z. B. `3` = +3 %). Bei einer aus Zeilen berechneten Spalte erhöht sie stattdessen den Stückpreis jeder Zeile. Siehe [Eine aus Zeilen aufgebaute Spalte kopieren](#eine-aus-zeilen-aufgebaute-spalte-kopieren). Standard ist 0. Dezimalwerte und negative Werte möglich. Ein Prozentsatz von -100 % oder weniger wird abgelehnt. |
| **Vorhandene Daten überschreiben** | Umschalter. Wenn aus, werden Elemente die bereits einen Wert im Ziel haben, übersprungen. Wenn ein, werden alle Zielwerte ersetzt. |

Die Seite öffnet mit der Standardspalte des aktuellen Jahres als Quelle und der Standardspalte des nächsten Jahres als Ziel. Ausgeblendete Spalten werden nicht angeboten.

### Zwei-Schritt-Prozess: Testlauf, dann Kopieren

1. Klicken Sie auf **Testlauf**, um eine Vorschau zu erstellen, ohne Daten zu ändern
2. Überprüfen Sie das Vorschau-Grid, das zeigt:
   - Name der **Position** (mit **Übersprungen** markierte Positionen behalten ihren aktuellen Wert; mit **Anteilig** markierte Positionen beginnen oder enden im Zieljahr und erhalten nur die Monate innerhalb ihrer Gültigkeit)
   - **Quellwert** (aus dem Quelljahr/der Quellspalte)
   - **Aktueller Zielwert**
   - **Vorschauwert** (was das Ziel nach dem Kopieren wird)
3. Wenn Sie zufrieden sind, klicken Sie auf **Daten kopieren** zum Anwenden

Die Schaltfläche **Daten kopieren** ist erst nach einem erfolgreichen Testlauf aktiviert.

### Zusammenfassungsstatistiken

Unterhalb des Grids zeigt eine Statistikleiste:

- **Gesamtelemente** im Datensatz
- **Zu verarbeitende Elemente** (nicht übersprungene)
- **Quellsumme** (Summe der Quellwerte)
- **Aktuelle Zielsumme**
- **Vorschausumme** (nach Testlauf angezeigt)

### Überschreibungsverhalten

| Überschreiben | Ziel hat Daten | Ergebnis |
|---------------|----------------|----------|
| Aus | Ja | Übersprungen |
| Aus | Nein (Null) | Kopiert |
| Ein | Ja | Ersetzt |
| Ein | Nein (Null) | Kopiert |

### Wie Beträge kopiert werden

- Dieser Teil beschreibt Spalten, deren Beträge eingegeben, verteilt oder kopiert sind, sowie die Monate von Referenzzeilen. Eine aus Zeilen berechnete Spalte folgt [eigenen Regeln](#eine-aus-zeilen-aufgebaute-spalte-kopieren)
- Die Kopie behält die monatliche Verteilung bei. Jeder der zwölf Monate wird in denselben Monat des Ziels kopiert: Eine Spalte, die von April bis Dezember verteilt ist, bleibt von April bis Dezember verteilt
- Nur Positionen, die im Zieljahr gültig sind, werden kopiert. Eine Position zählt für die Monate, deren 15. zwischen ihrem **Beginn der Gültigkeit** und ihrem **Ende der Gültigkeit** liegt. Eine Position ohne solchen Monat wird ausgelassen, da der Budget-Tab sie ebenfalls nicht anzeigt
- Eine Position, die nur einen Teil des Zieljahres gültig ist, erhält nur diese Monate. Die übrigen Monate behalten ihren Betrag, und der Zeitraum wird auf die Daten der Position gekürzt. Beispiel: Eine Quelle über zwölf Monate, kopiert auf eine Position, die am 30. Juni endet, ergibt Januar bis Juni
- Ohne Prozentsatz werden die Beträge exakt kopiert, auf den Cent genau
- Mit einem Prozentsatz wird jeder Monat auf einen ganzen Betrag gerundet, und die Jahressumme bleibt die Quellsumme mit angewendetem Prozentsatz, auf einen ganzen Betrag gerundet. Die durch die Rundung übrigen Einheiten gehen an die Monate mit den größten abgeschnittenen Nachkommaanteilen, bei Gleichstand zuerst an den spätesten Monat. Kein Monat wechselt das Vorzeichen. Beispiel: 12.000, verteilt von April bis Dezember (1.333,33 pro Monat und 1.333,36 im Dezember), ergeben mit +2 % kopiert 1.360 pro Monat und 12.240 für das Jahr
- Der Zeitraum der Spalte wandert mit der Kopie: April bis Dezember 2026 wird zu April bis Dezember 2027. Ein Zeitraum, der am 29. Februar endet, endet in einem Jahr ohne diesen Tag am 28. Februar
- Eine Quelle ohne Zeitraum ergibt einen Zeitraum über das ganze Jahr
- Im Budget-Tab zeigt die Zielspalte „Kopiert aus Budget 2026 +2 %“
- Das Kopieren einer Spalte auf sich selbst (gleiches Jahr und gleiche Spalte) wird abgelehnt
- Die Kopie gilt ganz oder gar nicht: Schlägt eine Position fehl, wird nichts gespeichert

### Eine aus Zeilen aufgebaute Spalte kopieren

Eine Spalte kann aus Zeilen aufgebaut sein, jede eine Menge mal ein Stückpreis. Siehe [Menge und Preis](opex.md#menge-und-preis). Die Kopie behandelt eine solche Spalte auf eine von zwei Arten.

**Die Beträge werden aus den Zeilen berechnet.** Die Spalte bleibt im Ziel aus ihren Zeilen berechnet.

- Die prozentuale Erhöhung hebt den Stückpreis jeder Zeile an, auf 4 Nachkommastellen gerundet. Die Mengen ändern sich nicht
- Die Monate werden aus den Zeilen mit den Arbeitstagekalendern des Zieljahres neu berechnet. Die kopierte Summe kann leicht von der Quellsumme mit angewendetem Prozentsatz abweichen, weil sich die Zahl der Arbeitstage von Jahr zu Jahr ändert
- Die Zeilen wandern ins Zieljahr, mit Beschreibung, Menge, Einheit, Häufigkeit und Kalender. Ihre Zeiträume wandern wie der Zeitraum der Spalte: März bis Dezember 2026 wird zu März bis Dezember 2027, und eine Zeile, die am 29. Februar endet, endet in einem Jahr ohne diesen Tag am 28. Februar. Ein am 15. März 2026 einmalig gekauftes Stück wird am 15. März 2027 gekauft. Die VZÄ werden aus den Zeilen neu berechnet
- Eine Zeile, die wegen der Gültigkeit der Position nur für einen Teil des Zieljahres bleibt, wird auf diesen Zeitraum gekürzt. Eine Zeile ohne verbleibenden Monat entfällt
- Die Spalte zeigt ihre Zeilen im Budget-Tab wie gewohnt. Sie hat keinen Hinweis „Kopiert aus“

**Die Zeilen sind nur eine Referenz.** Das ist der Fall, wenn die Quellbeträge von Hand eingegeben, verteilt oder kopiert wurden.

- Die prozentuale Erhöhung gilt für die Monate, wie bei jeder anderen Spalte. Die Stückpreise der Zeilen ändern sich nicht
- Die Zeilen wandern ins Zieljahr, mit Beschreibung, Menge, Einheit, Häufigkeit und Kalender, und ihre Zeiträume wandern wie der Zeitraum der Spalte. Eine Zeile, die wegen der Gültigkeit der Position nur für einen Teil des Zieljahres bleibt, wird auf diesen Zeitraum gekürzt, und eine Zeile ohne verbleibenden Monat entfällt
- Die VZÄ werden aus den kopierten Zeilen mit den Arbeitstagekalendern des Zieljahres neu berechnet
- Im Budget-Tab zeigt die Zielspalte „Kopiert aus Budget 2026“, und ihr Tab **Menge und Preis** meldet „Die Beträge wurden aus Budget 2026 kopiert. Die Zeilen wieder verwenden.“
- Die kopierten Zeilen sind eine schreibgeschützte Referenz. Klicken Sie im Tab **Menge und Preis** auf **Die Zeilen wieder verwenden**, um die Spalte mit ihren aktuellen Preisen aus den Zeilen zu berechnen. Um das Zieljahr zu eigenen Preisen zu planen, ändern Sie danach die Stückpreise: Jede Änderung berechnet die Spalte erneut

Eine Kopie aus einer Spalte ohne Zeilen lässt das Ziel ohne Zeilen, und seine VZÄ bleiben leer.

#### Kalender ohne Tage für das Zieljahr

Eine Zeile mit Preis pro Tag braucht einen Kalender, der das Zieljahr enthält. Hat der Kalender einer Zeile für dieses Jahr keine Arbeitstage, verwendet die Kopie stattdessen den Standardkalender des Landes des zahlenden Unternehmens der Position. Das ist der Kalender, der mit dem Unternehmen angelegt wurde. Das gilt für eine Spalte, die aus Zeilen aufgebaut ist, und für eine Spalte, deren Zeilen nur eine Referenz sind. Gibt es keinen, wird die Position auf die übliche Weise kopiert: Monate mal Prozentsatz. Die Zeilen bleiben unverändert als Referenz, und die VZÄ bleiben die VZÄ der Quellspalte.

Der Testlauf kennzeichnet diese Positionen mit einem Hinweis **Kalender**, mit einem Tooltip je Zeile, und zeigt eine Warnung über der Vorschau. Die Vorschau meldet auch eine Position, für die es keinen Ersatzkalender gibt. Um trotzdem zu kopieren, haken Sie **Trotzdem mit diesen Kalenderänderungen kopieren** an. Besser ist es, die Tage des Jahres auf der Seite **Arbeitstagekalender** hinzuzufügen und den Testlauf erneut auszuführen.

Ein deaktivierter Kalender wird weiterhin verwendet. Der Testlauf vermerkt ihn und verlangt keine Bestätigung.

### Schutz eingefrorener Spalten

Wenn die Zielspalte eingefroren ist, sind sowohl **Testlauf** als auch **Daten kopieren** deaktiviert. Ein Fehlerbanner weist Sie an, zuerst die Sperrung aufzuheben.

---

## Zuordnungen kopieren

Kopieren Sie Zuordnungsmethoden und Prozentsätze von einem Jahr in ein anderes. Dies erspart Ihnen die Neueingabe der Leistungsverrechnungs-Konfigurationen beim Einrichten eines neuen Geschäftsjahres.

Der Umschalter **OPEX** / **CAPEX** oben legt fest, welche Positionen kopiert werden. Nur Positionen, die im Zieljahr gültig sind, werden kopiert, nach derselben Regel wie bei **Budgetspalten kopieren**. Die Kopie erfolgt ganz oder gar nicht: Schlägt eine Position fehl, wird nichts kopiert.

Erfordert Administrationsrechte für OPEX, bei CAPEX-Positionen für CAPEX.

### Wann verwenden

- Vorbereitung des nächsten Jahresbudgets mit denselben Kostenzuordnungen
- Fortschreibung der Leistungsverrechnungs-Konfigurationen
- Einrichtung eines neuen Geschäftsjahres

### Felder

| Feld | Beschreibung |
|------|--------------|
| **Quelljahr** | Jahr, aus dem die Zuordnungen kopiert werden (Bereich: aktuelles Jahr minus eins bis aktuelles Jahr plus fünf) |
| **Zieljahr** | Jahr, in das die Zuordnungen kopiert werden (gleicher Bereich). Muss sich vom Quelljahr unterscheiden. |
| **Vorhandene Daten überschreiben** | Umschalter. Wenn aus, werden Elemente übersprungen, die im Ziel bereits Zuordnungen haben. |

### Zwei-Schritt-Prozess: Testlauf, dann Kopieren

1. Klicken Sie auf **Testlauf**, um eine Vorschau zu sehen
2. Das Vorschau-Grid zeigt jede OPEX- oder CAPEX-Position mit:
   - Name der **Position**
   - **Aktion**: was geschehen wird (Wird kopiert, Übersprungen – kein Quelljahr, Übersprungen – keine Zuordnungen in der Quelle, Übersprungen – Ziel enthält Daten, Fehler)
   - **Quell**methode und -bezeichnung
   - **Ziel** aktuelle Methode und Bezeichnung
   - **Ergebnis nach dem Kopieren**: wie das Ziel aussehen wird
3. Klicken Sie auf **Daten kopieren** zum Anwenden

### Validierung

- Quell- und Zieljahr müssen unterschiedlich sein. Bei Übereinstimmung erscheint ein Warnbanner und beide Schaltflächen werden deaktiviert.
- Jede Filteränderung löscht die Vorschau und erfordert einen neuen Testlauf.

### Zusammenfassung

Nach einem Testlauf zeigt ein Banner die Anzahl der kopierbereiten, übersprungenen und fehlerhaften Elemente. Wenn Elemente übersprungen wurden, weil das Ziel bereits Zuordnungen hat, erscheint eine separate Warnung mit dem Vorschlag, die Überschreibung zu aktivieren.

---

## Budgetspalte zurücksetzen

Löschen Sie alle Daten einer bestimmten Budgetspalte für ein gegebenes Jahr. Dies ist eine destruktive Operation: Verwenden Sie sie, wenn Sie neu beginnen müssen.

Der Umschalter **OPEX** / **CAPEX** oben auf der Seite legt fest, welche Positionen geleert werden. Das Zurücksetzen setzt die zwölf Monate der Spalte auf null und entfernt ihren Zeitraum sowie ihre Zeilen, wenn die Spalte aus Menge und Preis aufgebaut wurde. Im Budget-Tab erhält die Spalte danach einen neuen Vorschlag aus den Daten der Position. Das Zurücksetzen erfasst alle Positionen, auch solche, deren Gültigkeit bereits abgelaufen ist. Es gilt ganz oder gar nicht: Schlägt eine Position fehl, wird nichts geleert.

Erfordert Administrationsrechte für OPEX, bzw. für CAPEX bei CAPEX-Positionen.

Eine Spalte, deren Positionen keinen Betrag enthalten, kann trotzdem zurückgesetzt werden: Das Zurücksetzen entfernt dann nur die Verteilungszeiträume, und die Bestätigung weist darauf hin.

### Wann verwenden

- Neustart der Budgetplanung
- Korrektur von Massendateneingabefehlern
- Löschen von Testdaten

### Felder

| Feld | Beschreibung |
|------|--------------|
| **Jahr** | Das zu löschende Geschäftsjahr (Bereich: aktuelles Jahr minus eins bis aktuelles Jahr plus fünf) |
| **Budgetspalte** | Jede angezeigte Spalte, auch Prognose, wenn sie angezeigt wird. Keine Spalte ist vorausgewählt: Das Feld zeigt **Spalte wählen**, und **Spalte leeren** bleibt deaktiviert, bis Sie eine Spalte wählen |

### Vorschau

Bevor Sie eine Spalte wählen, ersetzt eine einzige Zeile das Grid: „Wählen Sie eine Spalte, um ihre Beträge zu sehen.“ Sobald Sie eine Spalte gewählt haben, zeigt ein Grid jede OPEX- oder CAPEX-Position und ihren aktuellen Wert in dieser Spalte. Beträge, die geleert werden, erscheinen halbfett; leere Werte sind abgeschwächt. Unterhalb des Grids erscheinen drei Statistiken:

- **Gesamtelemente**
- **Positionen mit einer Summe ungleich null**
- **Aktueller Gesamtwert**

### Bestätigung

Klicken auf **Spalte leeren** öffnet einen Bestätigungsdialog, der zeigt:

- Die zu löschende Spalte und das Jahr
- Die Anzahl der betroffenen Elemente
- Den Gesamtwert, der gelöscht wird
- Eine deutliche Warnung, dass diese Aktion nicht rückgängig gemacht werden kann

Sie müssen im Dialog auf **Spalte leeren** klicken, um fortzufahren, oder **Abbrechen** zum Abbrechen.

### Sicherheitsfunktionen

- Die Schaltfläche **Spalte leeren** bleibt verfügbar, wenn keine Position einen Betrag enthält, damit die Verteilungszeiträume trotzdem entfernt werden können
- Keine Spalte ist vorausgewählt, Sie wählen die zu leerende Spalte also immer selbst
- Eingefrorene Spalten können nicht zurückgesetzt werden. Tauen Sie sie zuerst auf
- Der Bestätigungsdialog erfordert eine explizite Bestätigung

---

## Standard-Zuordnungsmethode

Legen Sie die Methode fest, der OPEX-Positionen und CAPEX-Investitionen folgen, wenn sie auf der Standardzuordnung belassen werden. Die Einstellung gilt pro Geschäftsjahr: Jedes Jahr löst seinen eigenen Standard auf, sodass Sie die Basis für ein Jahr ändern können, ohne die anderen zu berühren.

### Wann verwenden

- Ihr Leistungsverrechnungsmodell basiert nicht auf der Mitarbeiterzahl (zum Beispiel umsatzgetrieben)
- Das IT-Budget wird von einem einzigen Unternehmen getragen und darf nicht auf alle Tochtergesellschaften verteilt werden
- Sie möchten, dass neue Positionen einer gemeinsamen Basis folgen, ohne sie einzeln zu bearbeiten
- Sie bereiten ein Geschäftsjahr vor, dessen Zuordnungsbasis sich vom vorherigen unterscheidet

### Felder

| Feld | Beschreibung |
|------|--------------|
| **Geschäftsjahr** | Das Jahr, für das die Einstellung gilt (Bereich: aktuelles Jahr minus eins bis aktuelles Jahr plus fünf) |
| **Unternehmen** | **Alle aktiven Unternehmen** (Standard): Die Kosten werden auf alle für das Jahr aktiven Unternehmen verteilt. **Ausgewählte Unternehmen**: Die Zuordnung wird auf die von Ihnen ausgewählten Unternehmen beschränkt |
| **Standardmethode** | Der Treiber, der die Unternehmen gewichtet: Mitarbeiterzahl, IT-Benutzer oder Umsatz |

### Funktionsweise

1. **Wählen Sie ein Jahr**
2. **Wählen Sie den Unternehmensumfang**: *Alle aktiven Unternehmen* oder *Ausgewählte Unternehmen* und dann die Unternehmen selbst
3. **Wählen Sie den Treiber**, der die Unternehmen gewichtet (Mitarbeiterzahl, IT-Benutzer oder Umsatz)
4. Jede Änderung wird sofort gespeichert, es gibt keine Schaltfläche zum Speichern
5. Um zur Standardmethode zurückzukehren, klicken Sie auf **Standardmethode verwenden** (wird nur angezeigt, solange ein eigener Standard konfiguriert ist)

### Ausgewählte Unternehmen

- Der Treiber wird nur auf die ausgewählten Unternehmen angewendet: ihre Prozentsätze werden aus ihrer eigenen Mitarbeiterzahl, ihren IT-Benutzern oder ihrem Umsatz für das Jahr berechnet
- Die Seite zeigt die daraus resultierende Aufteilung, sodass Sie die Wirkung prüfen können, bevor Sie sich darauf verlassen
- Ein einzelnes ausgewähltes Unternehmen erhält immer **100 %**, ohne dass ein Treiberwert erforderlich ist
- Ab zwei Unternehmen benötigt jedes ausgewählte Unternehmen einen Wert für den gewählten Treiber. Ein Unternehmen ohne Wert wird beim Speichern abgelehnt. Korrigieren Sie zuerst die Unternehmenskennzahlen unter **Stammdaten > Unternehmen**
- Ein für das Jahr deaktiviertes Unternehmen kann nicht ausgewählt werden: Deaktivierte Unternehmen sind von den Zuordnungen dieses Jahres ausgeschlossen

### Was es beeinflusst

- Jede OPEX-Position und CAPEX-Investition, deren Zuordnungsmethode **Standard** ist, im Zuordnungen-Tab als *Mitarbeiterzahl (Standard)* (oder *Standard (n Unternehmen)*) angezeigt, bis ein organisationsweiter Standard festgelegt ist
- Positionen mit einer expliziten Methode (Mitarbeiterzahl, IT-Benutzer oder Umsatz, fest an der Position gewählt) oder einer manuellen Zuordnung behalten ihre eigene Einstellung
- Zugeordnete Beträge werden neu berechnet, sobald die Zuordnungen das nächste Mal angezeigt werden. Die Budgetbeträge selbst werden nie geändert

### Standardmethode

Solange eine Organisation keinen Standard konfiguriert, gilt die Standardmethode: **Mitarbeiterzahl** über alle für das Jahr aktiven Unternehmen. Die Seite zeigt immer an, ob das Jahr auf der Standardmethode oder auf einem konfigurierten Standard läuft, und welche Methode als Standard gilt.

### Den Standard nachträglich ändern

Der Standard wird bei jeder Anzeige der Zuordnungen neu aufgelöst: Eine Änderung berechnet alle Positionen neu, die auf Standard stehen. Verliert ein Unternehmen der Auswahl später seinen Treiberwert oder wird es deaktiviert, zeigen die betroffenen Positionen einen Fehler statt einer stillschweigend neu verteilten Aufteilung. Die Seite weist Sie auf Probleme mit der aktuellen Auswahl hin.

### Berechtigungen

Das Ändern der Standardmethode erfordert `budget_ops:admin`. Die Karte ist für andere Benutzer ausgeblendet.

---

## Budgetspalten

Benennen Sie die fünf Budgetspalten, wählen Sie, welche alle sehen, und von welcher Berichte und Listen ausgehen. Die Einstellung gilt für die ganze Organisation, für OPEX und CAPEX gleichermaßen.

### Wann verwenden

- Ihre Budgetrunden haben eigene Namen, zum Beispiel A0, A1, A2 und Ist
- Ihre Organisation nutzt nicht jede Spalte und möchte eine übersichtlichere Ansicht
- Berichte und Listen sollen von einer anderen Spalte als Budget ausgehen

### Die Tabelle

Eine Zeile pro Spalte, immer in derselben Reihenfolge, von Spalte 1 bis Spalte 5. Die Standardnamen sind Budget, Revision, Prognose, Ist-Werte und Erwarteter Endwert.

| Feld | Beschreibung |
|------|--------------|
| **Spalte** | Die Position, 1 bis 5. Spalten lassen sich nicht umsortieren |
| **Name** | Der Name, den alle in Listen, im Budget-Tab, in Berichten, in der Übersicht und in der Budget-Administration sehen. Lassen Sie ihn leer, um den Standardnamen zu verwenden, der als Platzhalter erscheint. Höchstens 40 Zeichen, ohne Steuerzeichen oder unsichtbare Zeichen. Jeder Name muss sich von den Namen der anderen Spalten unterscheiden, auch vom Standardnamen einer Spalte, die Sie nicht umbenannt haben, unabhängig von der Groß- und Kleinschreibung |
| **In Dateien** | Die Zeile unter jedem Namen. Sie nennt den technischen Namen der Spalte in der Budgetdatei und ihren Importen, zum Beispiel `budget` für Spalte 1. Sie ändert sich nie, wenn Sie eine Spalte umbenennen. Siehe [Ein Budget aus einer Tabellenkalkulation laden](budget-file.md) |
| **Angezeigt** | Ob die Spalte auf dem Bildschirm erscheint. Mindestens eine Spalte muss angezeigt bleiben |
| **Folgt Verteilung und Zeilen** | Ob die Spalte übernimmt, was im Budget-Tab auf alle Spalten angewendet wird: Verteilung und Zeitraum eines verteilten Betrags (**Die Verteilung auf alle Spalten anwenden**) sowie die Zeilen mit Menge und Preis (**Diese Zeilen auf alle Spalten anwenden**). Eine Spalte, die nicht folgt, behält ihre eigenen: Wenn Sie sie verteilen oder ihre Zeilen bearbeiten, ändert sie sich allein |
| **Standard** | Die Spalte, die Berichte vorauswählen und nach der die Listen und die Übersicht sortiert werden. Ihr Einfrieren schreibt die Wechselkurse des Jahres fest. Die Standardspalte muss angezeigt werden |

Die Überschriften **Folgt Verteilung und Zeilen** und **Standard** tragen ein Infosymbol. Fahren Sie mit der Maus darüber oder setzen Sie den Tastaturfokus darauf, um dieselbe Erklärung auf der Seite zu lesen.

Standardmäßig sind Budget, Revision, Ist-Werte und Erwarteter Endwert angezeigt und Prognose ist ausgeblendet. Jede Spalte folgt den Schaltern des Budget-Tabs, und Budget ist die Standardspalte.

### Was die Einstellungen ändern

- **Ausgeblendete Spalten** verschwinden aus den Listen, der Spaltenauswahl, dem Budget-Tab, den Auswahlfeldern der Berichte, den Seiten zum Kopieren und Zurücksetzen und der Übersicht. Sie behalten ihre Beträge: Das Ausblenden einer Spalte löscht nie Daten, und wenn Sie sie wieder anzeigen, sind die Beträge wieder da. Ausgeblendete Spalten nehmen weiterhin Importe über die Budgetdatei an, und Einfrierungen gelten weiterhin für sie. Die Seite zum Einfrieren listet ausgeblendete Spalten ebenfalls auf, mit **Ausgeblendet** gekennzeichnet. Das Einfrieren eines Jahres friert sie also mit den anderen ein
- **Die Standardspalte** ist in jedem Bericht vorausgewählt. Nach ihr werden die OPEX- und CAPEX-Listen, ihre Navigation mit Zurück und Weiter sowie die Kacheln **Top-Positionen** und **Stärkste Zuwächse** der Übersicht sortiert. Die Listen zeigen sie für das aktuelle Jahr, neben der letzten angezeigten Spalte. Sie ist auch der Referenzbetrag des Zuordnungen-Tabs und die Spalte, mit der sich das Verteilungsfeld öffnet. Ihr Einfrieren für ein Jahr schreibt die Wechselkurse dieses Jahres fest (siehe [Das Einfrieren der Standardspalte schreibt die Wechselkurse fest](#das-einfrieren-der-standardspalte-schreibt-die-wechselkurse-fest))
- **Folgt Verteilung und Zeilen** legt fest, welche Spalten sich gemeinsam ändern, wenn eine Verteilung auf alle Spalten angewendet wird, und welche Spalten die Zeilen übernehmen, wenn **Diese Zeilen auf alle Spalten anwenden** eingeschaltet ist. Eingefrorene Spalten ändern sich nie, unabhängig von dieser Einstellung

### Speichern

Klicken Sie auf **Speichern**, um Ihre Änderungen anzuwenden. Die Schaltfläche bleibt deaktiviert, bis sich etwas geändert hat und jeder Name gültig ist. **Zurücksetzen** verwirft die Änderungen, die Sie noch nicht gespeichert haben. Fehler werden unter dem Feld oder der Tabelle erklärt, zum Beispiel „Mindestens eine Spalte muss angezeigt bleiben.“ oder „Die Standardspalte muss angezeigt werden: Wählen Sie zuerst eine andere Standardspalte.“ Um die aktuelle Standardspalte auszublenden, wählen Sie zuerst eine andere Standardspalte. Beide Änderungen lassen sich zusammen speichern.

### Berechtigungen

Zum Ändern der Einstellungen sind Administrationsrechte für die Budget-Administration erforderlich (`budget_ops:admin`). Die Karte ist für andere Benutzer ausgeblendet.

Wenn die Einstellungen nicht geladen werden können, zeigt die Seite eine einzige Zeile, „Die Spalteneinstellungen konnten nicht geladen werden.“, und keine Steuerelemente.

---

## Workflow-Beispiel: Jährlicher Budgetzyklus

Hier ist eine typische Abfolge mit diesen Werkzeugen, mit den Standardnamen der Spalten und Budget als Standardspalte:

### 1. Ende des Jahres N

1. Ist-Werte des Jahres N einfrieren (historische Daten schützen)
2. N Budget nach N+1 Budget kopieren (mit prozentualer Erhöhung für Inflation)
3. N Zuordnungen nach N+1 kopieren

### 2. Während der Budgetplanung (N+1)

1. Teams bearbeiten die Budgetspalte N+1
2. CFO prüft und genehmigt

### 3. Budgetgenehmigung

1. N+1 Budget einfrieren (genehmigtes Budget sperren und die Wechselkurse des Jahres festschreiben)
2. N+1 Budget nach N+1 Revision kopieren (Ausgangspunkt für unterjährige Nachverfolgung)

### 4. Halbjahresrevision

1. Teams aktualisieren die N+1 Revision mit Prognoseänderungen
2. Nach Finalisierung N+1 Revision einfrieren

---

## Tipps

- **Immer zuerst einen Testlauf durchführen**: Sowohl Budgetspalten kopieren als auch Zuordnungen kopieren unterstützen einen Testlauf. Verwenden Sie ihn jedes Mal, um das Ergebnis vor dem Festschreiben zu überprüfen.
- **Nach Genehmigung einfrieren**: Das Sperren von Spalten nach der Genehmigung bewahrt Ihren Audit-Trail und verhindert versehentliche Bearbeitungen.
- **Prozentuale Anpassungen verwenden**: Beim Kopieren zwischen Jahren wenden Sie einen Inflations- oder Wachstumsfaktor an, damit Sie nicht jede Zeile manuell anpassen müssen.
- **Einfrierstatus vor Massenoperationen prüfen**: Eingefrorene Spalten blockieren Kopier- und Zurücksetzungsoperationen. Wenn eine Schaltfläche ausgegraut ist, prüfen Sie zuerst die Seite zum Einfrieren.
- **Legen Sie den Standard des Jahres vor der Budgeterfassung fest**: Wenn Ihre Zuordnungsbasis nicht die Mitarbeiterzahl ist, konfigurieren Sie sie zuerst unter Standard-Zuordnungsmethode, damit Positionen gleich auf der richtigen Basis angelegt werden und nicht später neu berechnet werden müssen.
- **Mit Vorsicht zurücksetzen**: Das Zurücksetzen von Spalten ist irreversibel. Überprüfen Sie Jahr und Spalte doppelt, bevor Sie bestätigen.
