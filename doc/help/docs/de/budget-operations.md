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
| **Standard-Zuordnungsmethode** | Die Methode festlegen, der OPEX- und CAPEX-Zeilen standardmäßig folgen |

**Vorgänge**

| Werkzeug | Zweck |
|----------|-------|
| **Daten einfrieren / auftauen** | Budgetspalten sperren, um Änderungen zu verhindern |
| **Budgetspalten kopieren** | Beträge zwischen Jahren und Spalten kopieren, mit optionalem Prozentsatz, und Zuordnungen in ein anderes Jahr |
| **Budgetspalte zurücksetzen** | Alle Daten einer bestimmten Spalte löschen |
| **Stammdaten einfrieren** | Die Kennzahlen der Unternehmen und Abteilungen für ein Jahr sperren. Siehe [Stammdaten einfrieren und Jahreskennzahlen kopieren](master-data-operations.md) |
| **Jahreskennzahlen kopieren** | Die Kennzahlen der Unternehmen und Abteilungen von einem Jahr in ein anderes kopieren. Siehe [Stammdaten einfrieren und Jahreskennzahlen kopieren](master-data-operations.md) |

| Karten | Wer sie sieht |
|---|---|
| Währungen, Budgetspalten, Standard-Zuordnungsmethode, Daten einfrieren / auftauen | Budgetadministration auf Administratorebene (`budget_ops:admin`) |
| Budgetspalten kopieren, Budgetspalte zurücksetzen | Budget auf Administratorebene (`budget:admin`). Die Registerkarten **Alle**, **OPEX** und **CAPEX** öffnen sich alle mit dieser Stufe |
| Stammdaten einfrieren, Jahreskennzahlen kopieren | Benutzer mit Zugriff auf das Budget, die Administratoren der Budgetadministration, von Unternehmen oder Abteilungen sind. Administratoren von Unternehmen und Abteilungen handeln für ihren eigenen Bereich |

Die integrierte Rolle Budget-Administrator sieht alle Karten. Budget-Mitglied und Budget-Leser sehen keine, daher fehlt **Administration** in ihrem Menü.

Die Budgetspalten sind Budget, Revision, Prognose, Ist-Werte und Erwarteter Endwert. Das sind die Standardnamen. Ihre Organisation kann sie umbenennen, einige ausblenden und unter [Budgetspalten](#budgetspalten) eine Standardspalte wählen. Jede der folgenden Seiten zeigt die Namen, die Ihre Organisation gewählt hat.

Solange einer dieser Vorgänge läuft, können Budgetzeilen nicht gespeichert werden: Eine Änderung zeigt die Meldung „Ein anderer Budgetvorgang läuft gerade. Bitte versuchen Sie es erneut, wenn er abgeschlossen ist.“, bis der Vorgang abgeschlossen ist.

---

## Daten einfrieren / auftauen

Sperren Sie Budgetspalten, sodass sie nicht bearbeitet, importiert oder auf andere Weise geändert werden können. Das Einfrieren schützt genehmigte Zahlen vor versehentlichen Änderungen.

### Wann verwenden

- Nach der Genehmigung des Jahresbudgets
- Beim Abschluss einer Geschäftsperiode
- Zum Schutz von Ist-Werten vor Änderungen

### Funktionsweise

Die Seite zeigt jeweils ein Jahr. Wählen Sie es mit den Jahres-Tabs oben, vom letzten Jahr bis vier Jahre im Voraus.

Unter den Tabs hat eine Tabelle eine Zeile pro Budgetspalte und eine Spalte pro Typ, **OPEX** und **CAPEX**. Ausgeblendete Spalten werden ebenfalls aufgeführt, mit **Ausgeblendet** gekennzeichnet. Jede Zelle zeigt den Zustand dieser Spalte für diesen Typ, **Offen** oder **Eingefroren**, mit einem Schloss-Symbol:

- Klicken Sie auf eine Zelle, um sie umzuschalten. Ein Klick friert diese Spalte für diesen Typ ein oder taut sie auf
- Die Aktion am Ende einer Zeile wirkt auf beide Typen zugleich. Sie lautet **Beide einfrieren**, solange eine der beiden Zellen offen ist, und friert die offene ein. Sind beide eingefroren, lautet sie **Beide auftauen**
- Eine Zelle bleibt deaktiviert, solange ihre Änderung gespeichert wird. Die Jahres-Tabs warten, bis jede Änderung abgeschlossen ist

Ohne die Administratorstufe für die Budget-Administration zeigt die Seite die Zustände schreibgeschützt an, mit der Meldung „Sie benötigen Budgetadministrator-Rechte, um diese Seite zu verwenden.“

### Was das Einfrieren bewirkt

- Verhindert Bearbeitungen an eingefrorenen Spalten im Arbeitsbereich der Zeilen dieses Typs. Die Felder zeigen ein Schloss-Symbol
- Blockiert Importe in eingefrorene Spalten
- Blockiert Kopier- und Zurücksetzungsoperationen für eingefrorene Spalten
- Verweigert das Löschen einer Zeile oder die Änderung ihres Typs, solange sie Beträge in einer eingefrorenen Spalte der betroffenen Jahre hat
- Beeinflusst **nicht** den Lesezugriff: Die Daten bleiben sichtbar
- Gilt auch für ausgeblendete Spalten. Eine eingefrorene Spalte bleibt eingefroren, wenn sie ausgeblendet wird, und Importe in sie werden weiterhin abgelehnt

### Schloss-Symbole in der Liste

Die einzige Zeile **Gesamt** [der Liste der Budgetzeilen](budget-lines.md#mit-der-liste-arbeiten) zeigt ein Schloss-Symbol vor der Summe einer eingefrorenen Spalte. Es folgt dem Einfrieren jedes Typs in der Liste. Ist die Liste auf einen Typ gefiltert, erscheint das Schloss, wenn dieser Typ eingefroren ist. Enthält sie beide Typen, erscheint es, wenn die Spalte für beide eingefroren ist. Fahren Sie mit der Maus über das Symbol, um **Eingefroren** zu lesen.

### Das Einfrieren der Standardspalte schreibt die Wechselkurse fest

Wenn Sie die [Standardspalte](#budgetspalten) für ein Jahr einfrieren, werden auch die Wechselkurse dieses Jahres für den eingefrorenen Typ festgeschrieben. KANAP aktualisiert die Kurse des Jahres und behält dann den neuesten Satz für jeden OPEX- oder CAPEX-Betrag dieses Jahres. Berichte rechnen diese Beträge danach mit denselben Kursen um, auch wenn neuere Kurse eintreffen. Wechselt die Berichtswährung später, behalten diese Beträge die eingefrorenen Kurse und werden dann zum Kurs der früheren Berichtswährung im selben Jahr in die neue umgerechnet. Fehlt dieser Kurs, sind sie in keiner Summe enthalten und werden wie jeder fehlende Kurs genannt. Siehe [Eingefrorene Jahre](currencies.md#eingefrorene-jahre). Das Auftauen der Standardspalte gibt sie wieder frei.

Das Einfrieren einer anderen Spalte berührt die Kurse nicht. Eine spätere Änderung der Standardspalte schreibt von sich aus nichts fest und gibt nichts frei: Die Kurse folgen dem nächsten Einfrieren oder Auftauen der neuen Standardspalte. **Beide einfrieren** friert nur die offene Zelle ein, sodass ein Typ, dessen Standardspalte bereits eingefroren ist, die festgeschriebenen Kurse behält.

### Berechtigungen

Einfrieren und Auftauen erfordern `budget_ops:admin`. Die Karte ist für andere Benutzer ausgeblendet.

---

## Budgetspalten kopieren

Kopieren Sie die Beträge einer Spalte in ein anderes Jahr oder eine andere Spalte, mit einem optionalen Prozentsatz, und die Zuordnungen eines Jahres in ein anderes Jahr. Dies ist das wichtigste Werkzeug, um das Budget des nächsten Jahres aus dem aktuellen zu befüllen.

Die Registerkarten **Alle** / **OPEX** / **CAPEX** oben auf der Seite legen fest, auf welche Budgetzeilen die Kopie wirkt. **Alle**, die Voreinstellung, kopiert OPEX- und CAPEX-Zeilen zusammen.

Erfordert die Admin-Stufe für Budget (`budget:admin`).

### Wann verwenden

- Das Budget des nächsten Jahres, Beträge und Zuordnungen, aus dem aktuellen Jahr vorbereiten
- Eine Revision aus dem genehmigten Budget erstellen
- Prognosen mit einem Inflationsfaktor fortschreiben

### Felder

| Feld | Beschreibung |
|-------|-------------|
| **Quelljahr** | Jahr, aus dem kopiert wird (Bereich: aktuelles Jahr minus eins bis aktuelles Jahr plus fünf). Beginnt beim aktuellen Jahr |
| **Zieljahr** | Jahr, in das kopiert wird (gleicher Bereich). Beginnt beim nächsten Jahr |
| **Zu kopieren** | **Beträge**, **Zuordnungen** oder beides. **Zuordnungen** wird angeboten, wenn sich die beiden Jahre unterscheiden, und ist anfangs angekreuzt. Bewegen Sie den Mauszeiger über jedes Kontrollkästchen, um zu lesen, was es kopiert |
| **Quellspalte** | Mit **Beträge**: jede angezeigte Spalte, auch Prognose, wenn sie angezeigt wird. Beginnt bei der Standardspalte |
| **Zielspalte** | Mit **Beträge**: jede angezeigte Spalte. Beginnt bei der Standardspalte |
| **Prozentuale Erhöhung** | Mit **Beträge**: Anpassung, die auf jeden kopierten Monat angewendet wird (z. B. `3` = +3 %). Bei einer aus ihren Zeilen berechneten Spalte erhöht sie stattdessen den Stückpreis jeder Zeile. Siehe [Eine aus Zeilen aufgebaute Spalte kopieren](#eine-aus-zeilen-aufgebaute-spalte-kopieren). Standardwert 0. Dezimalzahlen und negative Werte sind erlaubt. Ein Prozentsatz von -100 % oder weniger wird abgelehnt |
| **Vorhandene Daten überschreiben** | Ein Schalter für beide Teile. Aus: Eine Zielspalte, die bereits Beträge enthält, behält sie, und eine von Hand erfasste Zuordnung im Zieljahr bleibt erhalten. Ein: Beides wird ersetzt |

Ausgeblendete Spalten werden nicht angeboten. Ist unter **Zu kopieren** nichts angekreuzt, zeigt die Seite „Wählen Sie, was kopiert wird: die Beträge, die Zuordnungen oder beides.“

### Zwei Schritte: Vorschau, dann Kopieren

1. Klicken Sie auf **Vorschau**, um zu sehen, was die Kopie mit jeder Zeile macht, ohne Daten zu ändern
2. Prüfen Sie die Tabelle, eine Zeile pro Budgetzeile:
   - **Zeile**: der Name der Zeile, ein Link, der sie in einem neuen Tab öffnet, damit die Vorschau stehen bleibt. Mit **Anteilig** markierte Zeilen beginnen oder enden im Zieljahr und erhalten nur die Monate ihrer Gültigkeit. Mit **Kalender** markierte Zeilen wechseln den Kalender (siehe unten)
   - **Zeilentyp**: **OPEX** oder **CAPEX**, in der Registerkarte **Alle**
   - Für die Beträge: die Quellspalte, die aktuelle Zielspalte, die Zielspalte nach der Kopie und der Status der Beträge
   - Für die Zuordnungen: die Quellzuordnung, die aktuelle Zielzuordnung, die Zuordnung nach der Kopie und der Status der Zuordnungen
3. Wenn Sie zufrieden sind, klicken Sie auf **Kopieren**, um sie anzuwenden

**Kopieren** ist erst nach einer Vorschau aktiv. Jede Änderung eines Feldes verwirft die Vorschau: Starten Sie sie erneut. Nach der Kopie bleibt die Tabelle unter dem Titel **Ergebnis** sichtbar, mit dem, was jede Zeile getan hat.

**Tabelle exportieren** (Download-Symbol) lädt die Vorschau der angezeigten Felder als CSV- oder Excel-Datei herunter, eine Zeile pro Budgetzeile, mit den Spalten und Status der Tabelle. Nach dem Kopieren ist der Export deaktiviert: Die Tabelle zeigt dann, was das Kopieren getan hat, was eine Vorschau nicht mehr beschreibt. Die Beträge der Datei behalten ihre Cents.

Jeder Teil hat in jeder Zeile seinen eigenen Status:

| Status | Bedeutung |
|---|---|
| **Zu kopieren** / **Kopiert** | Der Teil wird kopiert oder wurde kopiert |
| **Ersetzt Mitarbeiterzahl** / **Hat Mitarbeiterzahl ersetzt** | Die Zuordnung des Zieljahres folgt einer anderen Methode, die die kopierte Zuordnung ersetzt |
| **In 2027 nicht gültig** | Die Zeile ist im Zieljahr nicht gültig. Sie wird ausgelassen |
| **Übersprungen: nichts in 2026** | Die Zeile hat im Quelljahr kein Budget |
| **Übersprungen: die Quellspalte ist leer** | Die Quellspalte hat keinen Betrag |
| **Übersprungen: das Ziel enthält Beträge** | Die Zielspalte enthält bereits Beträge, und **Vorhandene Daten überschreiben** ist aus |
| **Übersprungen: keine Zuordnung in 2026 erfasst** | Die Zeile hat im Quelljahr keine Zuordnung zum Kopieren |
| **Übersprungen: 2027 hat eine von Hand erfasste Zuordnung** | Das Zieljahr hat eine von Hand erfasste Zuordnung, und **Vorhandene Daten überschreiben** ist aus |
| **Fehler** | Die Zuordnungsregeln der Zeile lehnen die Kopie ab, mit dem Grund. **Kopieren** bleibt deaktiviert, solange eine Zeile einen Fehler hat |

### Zusammenfassung

Über der Tabelle fasst ein Banner die Vorschau zusammen, zum Beispiel „136 Zeilen in der Vorschau. 6 Zeilen, die 2027 nicht gültig sind, werden ausgelassen. Beträge: 120 zu kopieren, 10 übersprungen. Zuordnungen: 124 zu kopieren, 6 übersprungen.“ Die Zeilenzahl entspricht der Tabelle. Die im Zieljahr nicht gültigen Zeilen stehen darin, und die Zahlen für Beträge und Zuordnungen lassen sie aus. Nach der Kopie zeigt es „Kopie abgeschlossen.“ mit denselben Zahlen.

Warnungen erscheinen, wenn sie zutreffen:

- Zeilen, deren Zielspalte bereits einen Betrag hat und die ohne **Vorhandene Daten überschreiben** übersprungen werden
- Zeilen, die ohne **Vorhandene Daten überschreiben** eine von Hand erfasste Zuordnung im Zieljahr behalten
- Zeilen, deren Zuordnungsmethode sich im Zieljahr ändert. Ohne **Vorhandene Daten überschreiben** behält die Kopie nur die von Hand erfassten Zuordnungen: Eine Zeile, die einer Methode ohne von Hand erfasste Aufteilung folgt, übernimmt die Methode des Quelljahres
- Zeilen auf der Standardzuordnung, wenn sich der Standard des Zieljahres von dem des Quelljahres unterscheidet. Kopierte Zeilen folgen weiterhin dem Standard ihres eigenen Jahres. Konfigurieren Sie ihn unter [Standard-Zuordnungsmethode](#standard-zuordnungsmethode), wenn die Basis gleich bleiben soll

Unter der Tabelle zeigen die Summen die Anzahl der Zeilen, die zu kopierenden Beträge, das Quelltotal, das aktuelle Zieltotal und das Total nach der Kopie sowie die zu kopierenden Zuordnungen.

### Wie Beträge kopiert werden

- Dieser Teil beschreibt Spalten, deren Beträge eingegeben, verteilt oder kopiert sind, sowie die Monate von Referenzzeilen. Eine aus Zeilen berechnete Spalte folgt [eigenen Regeln](#eine-aus-zeilen-aufgebaute-spalte-kopieren)
- Die Kopie behält die monatliche Verteilung bei. Jeder der zwölf Monate wird in denselben Monat des Ziels kopiert: Eine Spalte, die von April bis Dezember verteilt ist, bleibt von April bis Dezember verteilt
- Nur Budgetzeilen, die im Zieljahr gültig sind, werden kopiert. Eine Budgetzeile zählt für die Monate, deren 15. zwischen ihrem **Beginn der Gültigkeit** und ihrem **Ende der Gültigkeit** liegt. Eine Budgetzeile ohne solchen Monat wird ausgelassen, da der Budget-Tab sie ebenfalls nicht anzeigt
- Eine Budgetzeile, die nur einen Teil des Zieljahres gültig ist, erhält nur diese Monate. Die übrigen Monate behalten ihren Betrag, und der Zeitraum wird auf die Daten der Budgetzeile gekürzt. Beispiel: Eine Quelle über zwölf Monate, kopiert auf eine Budgetzeile, die am 30. Juni endet, ergibt Januar bis Juni
- Ohne Prozentsatz werden die Beträge exakt kopiert, auf den Cent genau
- Mit einem Prozentsatz wird jeder Monat auf einen ganzen Betrag gerundet, und die Jahressumme bleibt die Quellsumme mit angewendetem Prozentsatz, auf einen ganzen Betrag gerundet. Die durch die Rundung übrigen Einheiten gehen an die Monate mit den größten abgeschnittenen Nachkommaanteilen, bei Gleichstand zuerst an den spätesten Monat. Kein Monat wechselt das Vorzeichen. Beispiel: 12.000, verteilt von April bis Dezember (1.333,33 pro Monat und 1.333,36 im Dezember), ergeben mit +2 % kopiert 1.360 pro Monat und 12.240 für das Jahr
- Der Zeitraum der Spalte wandert mit der Kopie: April bis Dezember 2026 wird zu April bis Dezember 2027. Ein Zeitraum, der am 29. Februar endet, endet in einem Jahr ohne diesen Tag am 28. Februar
- Eine Quelle ohne Zeitraum ergibt einen Zeitraum über das ganze Jahr
- Im Budget-Tab zeigt die Zielspalte „Kopiert aus Budget 2026 +2 %“
- Das Kopieren einer Spalte auf sich selbst (gleiches Jahr und gleiche Spalte) wird abgelehnt
- Die Kopie gilt ganz oder gar nicht: Schlägt eine Budgetzeile fehl, wird nichts gespeichert, weder Beträge noch Zuordnungen

### Eine aus Zeilen aufgebaute Spalte kopieren

Eine Spalte kann aus Zeilen aufgebaut sein, jede eine Menge mal ein Stückpreis. Siehe [Menge und Preis](budget-lines.md#menge-und-preis). Die Kopie behandelt eine solche Spalte auf eine von zwei Arten.

**Die Beträge werden aus den Zeilen berechnet.** Die Spalte bleibt im Ziel aus ihren Zeilen berechnet.

- Die prozentuale Erhöhung hebt den Stückpreis jeder Zeile an, auf 4 Nachkommastellen gerundet. Die Mengen ändern sich nicht
- Die Monate werden aus den Zeilen mit den Arbeitstagekalendern des Zieljahres neu berechnet. Die kopierte Summe kann leicht von der Quellsumme mit angewendetem Prozentsatz abweichen, weil sich die Zahl der Arbeitstage von Jahr zu Jahr ändert
- Die Zeilen wandern ins Zieljahr, mit Beschreibung, Menge, Einheit, Häufigkeit und Kalender. Ihre Zeiträume wandern wie der Zeitraum der Spalte: März bis Dezember 2026 wird zu März bis Dezember 2027, und eine Zeile, die am 29. Februar endet, endet in einem Jahr ohne diesen Tag am 28. Februar. Ein am 15. März 2026 einmalig gekauftes Stück wird am 15. März 2027 gekauft. Die VZÄ werden aus den Zeilen neu berechnet
- Eine Zeile, die wegen der Gültigkeit der Budgetzeile nur für einen Teil des Zieljahres bleibt, wird auf diesen Zeitraum gekürzt. Eine Zeile ohne verbleibenden Monat entfällt
- Die Spalte zeigt ihre Zeilen im Budget-Tab wie gewohnt. Sie hat keinen Hinweis „Kopiert aus“

**Die Zeilen sind nur eine Referenz.** Das ist der Fall, wenn die Quellbeträge von Hand eingegeben, verteilt oder kopiert wurden.

- Die prozentuale Erhöhung gilt für die Monate, wie bei jeder anderen Spalte. Die Stückpreise der Zeilen ändern sich nicht
- Die Zeilen wandern ins Zieljahr, mit Beschreibung, Menge, Einheit, Häufigkeit und Kalender, und ihre Zeiträume wandern wie der Zeitraum der Spalte. Eine Zeile, die wegen der Gültigkeit der Budgetzeile nur für einen Teil des Zieljahres bleibt, wird auf diesen Zeitraum gekürzt, und eine Zeile ohne verbleibenden Monat entfällt
- Die VZÄ werden aus den kopierten Zeilen mit den Arbeitstagekalendern des Zieljahres neu berechnet
- Im Budget-Tab zeigt die Zielspalte „Kopiert aus Budget 2026“, und ihr Editor zeigt zum Beispiel „4 Zeilen als Referenz behalten (48.000). Die Zeilen wieder verwenden.“
- Die kopierten Zeilen sind eine schreibgeschützte Referenz. Klicken Sie auf **Die Zeilen wieder verwenden**, um die Spalte mit ihren aktuellen Preisen aus den Zeilen zu berechnen. Um das Zieljahr zu eigenen Preisen zu planen, ändern Sie danach die Stückpreise: Jede Änderung berechnet die Spalte erneut

Eine Kopie aus einer Spalte ohne Zeilen lässt das Ziel ohne Zeilen, und seine VZÄ bleiben leer.

#### Kalender ohne Tage für das Zieljahr

Eine Zeile mit Preis pro Tag braucht einen Kalender, der das Zieljahr enthält. Hat der Kalender einer Zeile für dieses Jahr keine Arbeitstage, verwendet die Kopie stattdessen den Standardkalender des Landes des zahlenden Unternehmens der Budgetzeile. Das ist der Kalender, der mit dem Unternehmen angelegt wurde. Das gilt für eine Spalte, die aus Zeilen aufgebaut ist, und für eine Spalte, deren Zeilen nur eine Referenz sind. Gibt es keinen, wird die Budgetzeile auf die übliche Weise kopiert: Monate mal Prozentsatz. Die Zeilen bleiben unverändert als Referenz, und die VZÄ bleiben die VZÄ der Quellspalte.

Die Vorschau kennzeichnet diese Budgetzeilen mit einem Hinweis **Kalender**, mit einem Tooltip je Zeile, und zeigt eine Warnung über der Tabelle. Die Vorschau meldet auch eine Budgetzeile, für die es keinen Ersatzkalender gibt. Um trotzdem zu kopieren, haken Sie **Trotzdem mit diesen Kalenderänderungen kopieren** an. Besser ist es, die Tage des Jahres auf der Seite **Arbeitstagekalender** hinzuzufügen und die Vorschau erneut zu starten.

Ein deaktivierter Kalender wird weiterhin verwendet. Die Vorschau vermerkt ihn und verlangt keine Bestätigung.

### Zuordnungen kopieren

**Zuordnungen** kopiert die Zuordnungsmethode jeder Zeile aus dem Quelljahr in das Zieljahr, mit einer von Hand erfassten Aufteilung (die gewählten Unternehmen oder Abteilungen, die eingegebenen Prozentsätze). Nur Zeilen, die im Zieljahr gültig sind, werden kopiert, nach derselben Regel wie die Beträge.

- Eine Zeile auf der Standardzuordnung bleibt auf dem Standard: Im Zieljahr folgt sie dem Standard dieses Jahres
- Ohne **Vorhandene Daten überschreiben** behält eine Zeile die von Hand erfasste Zuordnung im Zieljahr. Eine Zeile, deren Zieljahr einer Methode ohne von Hand erfasste Aufteilung folgt, erhält die Quellzuordnung, und die Vorschau nennt die Methode, die sie ersetzt, zum Beispiel „Ersetzt Mitarbeiterzahl“
- Mit **Vorhandene Daten überschreiben** ersetzt jede kopierte Zuordnung die Zuordnung im Ziel

### Schutz eingefrorener Spalten

Umfasst die Kopie die Beträge und ist die Zielspalte eingefroren, sind **Vorschau** und **Kopieren** deaktiviert, und ein Fehlerbanner weist Sie an, zuerst aufzutauen. In der Registerkarte **Alle** nennt das Banner den Typ, wenn die Spalte nur für einen Typ eingefroren ist, zum Beispiel „Die Spalte Budget für 2027 ist für CAPEX eingefroren. Tauen Sie sie auf, oder kopieren Sie nur den anderen Typ.“ Die Zuordnungen allein hängen nicht vom Einfrieren ab.

---

## Budgetspalte zurücksetzen

Löschen Sie alle Daten einer bestimmten Budgetspalte für ein gegebenes Jahr. Dies ist eine destruktive Operation: Verwenden Sie sie, wenn Sie neu beginnen müssen.

Die Registerkarten **Alle** / **OPEX** / **CAPEX** oben auf der Seite legen fest, welche Budgetzeilen geleert werden. **Alle**, die Voreinstellung, leert OPEX- und CAPEX-Zeilen zusammen. Das Zurücksetzen setzt die zwölf Monate der Spalte auf null und entfernt ihren Zeitraum sowie ihre Zeilen, wenn die Spalte aus Menge und Preis aufgebaut wurde. Im Budget-Tab erhält die Spalte danach einen neuen Vorschlag aus den Daten der Budgetzeile. Das Zurücksetzen erfasst alle Budgetzeilen, auch solche, deren Gültigkeit bereits abgelaufen ist. Es gilt ganz oder gar nicht: Schlägt eine Budgetzeile fehl, wird nichts geleert.

Erfordert die Administratorstufe auf Budget (`budget:admin`).

Eine Spalte, deren Budgetzeilen keinen Betrag enthalten, kann trotzdem zurückgesetzt werden: Das Zurücksetzen entfernt dann nur die Verteilungszeiträume, und die Bestätigung weist darauf hin.

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

Bevor Sie eine Spalte wählen, ersetzt eine einzige Zeile das Grid: „Wählen Sie eine Spalte, um ihre Beträge zu sehen.“ Sobald Sie eine Spalte gewählt haben, zeigt ein Grid jede Zeile des gewählten Typs und ihren aktuellen Wert in dieser Spalte. Der Name der Zeile öffnet sie in einem neuen Tab, und in der Registerkarte **Alle** nennt eine Spalte **Zeilentyp** **OPEX** oder **CAPEX**. Beträge, die geleert werden, erscheinen halbfett; leere Werte sind abgeschwächt. Unterhalb des Grids erscheinen drei Statistiken:

- **Gesamtelemente**
- **Zeilen mit einer Summe ungleich null**
- **Aktueller Gesamtwert**

**Tabelle exportieren** (Download-Symbol) lädt das Raster als CSV- oder Excel-Datei herunter: die Budgetzeilen des gewählten Typs und ihren aktuellen Wert in der gewählten Spalte.

### Bestätigung

Klicken auf **Spalte leeren** öffnet einen Bestätigungsdialog, der zeigt:

- Die zu löschende Spalte und das Jahr
- Die Anzahl der betroffenen Elemente
- Den Gesamtwert, der gelöscht wird
- Eine deutliche Warnung, dass diese Aktion nicht rückgängig gemacht werden kann

Sie müssen im Dialog auf **Spalte leeren** klicken, um fortzufahren, oder **Abbrechen** zum Abbrechen.

### Sicherheitsfunktionen

- Die Schaltfläche **Spalte leeren** bleibt verfügbar, wenn keine Budgetzeile einen Betrag enthält, damit die Verteilungszeiträume trotzdem entfernt werden können
- Keine Spalte ist vorausgewählt, Sie wählen die zu leerende Spalte also immer selbst
- Eingefrorene Spalten können nicht zurückgesetzt werden. Tauen Sie sie zuerst auf. In der Registerkarte **Alle** nennt die Meldung den Typ, wenn die Spalte nur für einen Typ eingefroren ist, zum Beispiel „Die Spalte Budget für 2026 ist für CAPEX eingefroren. Tauen Sie sie auf, bevor Sie Daten löschen, oder leeren Sie nur den anderen Typ.“
- Der Bestätigungsdialog erfordert eine explizite Bestätigung

---

## Standard-Zuordnungsmethode

Legen Sie die Methode fest, der OPEX-Zeilen und CAPEX-Investitionen folgen, wenn sie auf der Standardzuordnung belassen werden. Die Einstellung gilt pro Geschäftsjahr: Jedes Jahr löst seinen eigenen Standard auf, sodass Sie die Basis für ein Jahr ändern können, ohne die anderen zu berühren.

### Wann verwenden

- Ihr Leistungsverrechnungsmodell basiert nicht auf der Mitarbeiterzahl (zum Beispiel umsatzgetrieben)
- Das IT-Budget wird von einem einzigen Unternehmen getragen und darf nicht auf alle Tochtergesellschaften verteilt werden
- Sie möchten, dass neue Budgetzeilen einer gemeinsamen Basis folgen, ohne sie einzeln zu bearbeiten
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
- Die Seite zeigt die daraus resultierende Aufteilung, sodass Sie die Wirkung prüfen können, bevor Sie sich darauf verlassen. Die Spalte **Treiberwert** zeigt den Wert jedes Unternehmens. Ein Umsatz erscheint mit der Basiswährung des Unternehmens, zum Beispiel **35 Mio. USD**, und die Aufteilung verwendet ihn umgerechnet in die Berichtswährung, wie im [Tab Zuordnungen](budget-lines.md#zuordnungen). Hat eine Währung für das Jahr keinen Kurs, bleiben die Unternehmen in dieser Währung aus der Aufteilung heraus: Sie erhalten keinen Anteil, die übrigen ausgewählten Unternehmen teilen sich 100 %, und eine Warnung über der Aufteilung nennt jedes ausgelassene Unternehmen
- Ein einzelnes ausgewähltes Unternehmen erhält immer **100 %**, ohne dass ein Treiberwert erforderlich ist
- Ab zwei Unternehmen benötigt jedes ausgewählte Unternehmen einen Wert für den gewählten Treiber. Ein Unternehmen ohne Wert wird beim Speichern abgelehnt. Korrigieren Sie zuerst die Unternehmenskennzahlen unter **Stammdaten > Unternehmen**
- Ein für das Jahr deaktiviertes Unternehmen kann nicht ausgewählt werden: Deaktivierte Unternehmen sind von den Zuordnungen dieses Jahres ausgeschlossen

### Was es beeinflusst

- Jede OPEX-Zeile und CAPEX-Investition, deren Zuordnungsmethode **Standard** ist, im Zuordnungen-Tab als *Mitarbeiterzahl (Standard)* (oder *Standard (n Unternehmen)*) angezeigt, bis ein organisationsweiter Standard festgelegt ist
- Budgetzeilen mit einer expliziten Methode (Mitarbeiterzahl, IT-Benutzer oder Umsatz, fest an der Budgetzeile gewählt) oder einer manuellen Zuordnung behalten ihre eigene Einstellung
- Zugeordnete Beträge werden neu berechnet, sobald die Zuordnungen das nächste Mal angezeigt werden. Die Budgetbeträge selbst werden nie geändert

### Standardmethode

Solange eine Organisation keinen Standard konfiguriert, gilt die Standardmethode: **Mitarbeiterzahl** über alle für das Jahr aktiven Unternehmen. Die Seite zeigt immer an, ob das Jahr auf der Standardmethode oder auf einem konfigurierten Standard läuft, und welche Methode als Standard gilt.

### Den Standard nachträglich ändern

Der Standard wird bei jeder Anzeige der Zuordnungen neu aufgelöst: Eine Änderung berechnet alle Budgetzeilen neu, die auf Standard stehen. Verliert ein Unternehmen der Auswahl später seinen Treiberwert oder wird es deaktiviert, zeigen die betroffenen Budgetzeilen einen Fehler statt einer stillschweigend neu verteilten Aufteilung. Die Seite weist Sie auf Probleme mit der aktuellen Auswahl hin.

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
| **Folgt Verteilung und Zeilen** | Ob die Spalte unter **Auch für andere Spalten verwenden…** im Budget-Tab anfangs angekreuzt ist. Dieser Link gibt anderen Spalten den Zeitraum und die Verteilung eines Betrags oder die Zeilen mit Menge und Preis. Sie können dort jede Spalte weiterhin an- oder abwählen |
| **Standard** | Die Spalte, die Berichte vorauswählen und nach der die Listen und die Übersicht sortiert werden. Ihr Einfrieren schreibt die Wechselkurse des Jahres fest. Die Standardspalte muss angezeigt werden |

Die Überschriften **Folgt Verteilung und Zeilen** und **Standard** tragen ein Infosymbol. Fahren Sie mit der Maus darüber oder setzen Sie den Tastaturfokus darauf, um dieselbe Erklärung auf der Seite zu lesen.

Standardmäßig sind Budget, Revision, Ist-Werte und Erwarteter Endwert angezeigt und Prognose ist ausgeblendet. Jede Spalte folgt Verteilung und Zeilen, und Budget ist die Standardspalte.

### Was die Einstellungen ändern

- **Ausgeblendete Spalten** verschwinden aus den Listen, der Spaltenauswahl, dem Budget-Tab, den Auswahlfeldern der Berichte, den Seiten zum Kopieren und Zurücksetzen und der Übersicht. Sie behalten ihre Beträge: Das Ausblenden einer Spalte löscht nie Daten, und wenn Sie sie wieder anzeigen, sind die Beträge wieder da. Ausgeblendete Spalten nehmen weiterhin Importe über die Budgetdatei an, und Einfrierungen gelten weiterhin für sie. Die Seite zum Einfrieren listet ausgeblendete Spalten ebenfalls auf, mit **Ausgeblendet** gekennzeichnet, sodass Sie sie wie die anderen einfrieren können
- **Die Standardspalte** ist in jedem Bericht vorausgewählt. Nach ihr werden die Liste der Budgetzeilen und ihre Navigation mit Zurück und Weiter sortiert. Die Kachel **Top-Zeilen**, in der Rangfolge nach **Betrag** oder nach **Anstieg**, und die Kacheln **Mein Budget** und **Nach Kostenstelle** der Übersicht verwenden sie. Die Liste zeigt sie für das aktuelle Jahr, neben der letzten angezeigten Spalte. Sie ist auch der Referenzbetrag des Zuordnungen-Tabs und die Ausgangsspalte der Zeile **Abweichung zu** im Budget-Tab. Ihr Einfrieren für ein Jahr schreibt die Wechselkurse dieses Jahres fest (siehe [Das Einfrieren der Standardspalte schreibt die Wechselkurse fest](#das-einfrieren-der-standardspalte-schreibt-die-wechselkurse-fest))
- **Folgt Verteilung und Zeilen** legt fest, welche Spalten anfangs angekreuzt sind, wenn Sie **Auch für andere Spalten verwenden…** im Budget-Tab nutzen. Eingefrorene Spalten werden nie angeboten, unabhängig von dieser Einstellung

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
2. N Budget nach N+1 Budget kopieren, mit den Zuordnungen (ein Lauf von **Budgetspalten kopieren**, mit prozentualer Erhöhung für Inflation)

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

- **Immer zuerst die Vorschau ansehen**: **Budgetspalten kopieren** zeigt vor dem Kopieren, was es mit jeder Zeile macht. Prüfen Sie sie jedes Mal vor dem Festschreiben.
- **Nach Genehmigung einfrieren**: Das Sperren von Spalten nach der Genehmigung bewahrt Ihren Audit-Trail und verhindert versehentliche Bearbeitungen.
- **Prozentuale Anpassungen verwenden**: Beim Kopieren zwischen Jahren wenden Sie einen Inflations- oder Wachstumsfaktor an, damit Sie nicht jede Zeile manuell anpassen müssen.
- **Einfrierstatus vor Massenoperationen prüfen**: Eingefrorene Spalten blockieren Kopier- und Zurücksetzungsoperationen. Wenn eine Schaltfläche ausgegraut ist, prüfen Sie zuerst die Seite zum Einfrieren.
- **Legen Sie den Standard des Jahres vor der Budgeterfassung fest**: Wenn Ihre Zuordnungsbasis nicht die Mitarbeiterzahl ist, konfigurieren Sie sie zuerst unter Standard-Zuordnungsmethode, damit Budgetzeilen gleich auf der richtigen Basis angelegt werden und nicht später neu berechnet werden müssen.
- **Mit Vorsicht zurücksetzen**: Das Zurücksetzen von Spalten ist irreversibel. Überprüfen Sie Jahr und Spalte doppelt, bevor Sie bestätigen.
