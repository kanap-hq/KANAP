# Budget-Administration

Die Budget-Administration bietet Ihnen eine Reihe von Werkzeugen zur Verwaltung und Transformation von Budgetdaten über Jahre und Spalten hinweg. Dies sind die Operationen, die Sie während der Budgetplanungszyklen benötigen -- die Vorbereitung der Zahlen für das nächste Jahr, das Einfrieren genehmigter Budgets und die Verwaltung von Jahresübergängen.

## Wo Sie es finden

- Pfad: **Budgetverwaltung > Administration**
- Berechtigungen: Die meisten Operationen erfordern `budget_ops:admin`

Die Startseite zeigt sechs Karten, die jeweils zu einem dedizierten Werkzeug führen:

| Werkzeug | Zweck |
|----------|-------|
| **Daten einfrieren / freigeben** | Budgetspalten sperren, um Änderungen zu verhindern |
| **Budgetspalten kopieren** | Daten zwischen Jahren und Spalten mit Anpassungen kopieren |
| **Zuordnungen kopieren** | Zuordnungsmethoden von einem Jahr in ein anderes kopieren |
| **Budgetspalte zurücksetzen** | Alle Daten einer bestimmten Spalte löschen |
| **Standard-Zuordnungsmethode** | Die Methode festlegen, der OPEX- und CAPEX-Positionen standardmäßig folgen |
| **Datei der Budgetzeilen** | Die Monatsbeträge aller OPEX- und CAPEX-Positionen exportieren oder importieren |

---

## Daten einfrieren / freigeben

Sperren Sie Budgetspalten, sodass sie nicht bearbeitet, importiert oder auf andere Weise geändert werden können. Das Einfrieren schützt genehmigte Zahlen vor versehentlichen Änderungen.

### Wann verwenden

- Nach der Genehmigung des Jahresbudgets
- Beim Abschluss einer Geschäftsperiode
- Zum Schutz von Ist-Werten vor Änderungen

### Funktionsweise

1. **Wählen Sie ein Jahr** aus dem Dropdown (Bereich: aktuelles Jahr minus eins bis aktuelles Jahr plus vier)
2. **Wählen Sie Geltungsbereiche**: Aktivieren Sie **OPEX**, **CAPEX** oder beides
3. **Wählen Sie Spalten** für jeden Bereich: Budget, Revision, Prognose, Ist-Werte, Erwarteter Endwert (alle fünf sind standardmäßig ausgewählt)
4. Klicken Sie auf **Daten einfrieren** zum Sperren oder **Daten freigeben** zum Entsperren

### Was das Einfrieren bewirkt

- Verhindert Bearbeitungen an eingefrorenen Spalten in OPEX- und CAPEX-Arbeitsbereichen
- Blockiert CSV-Importe in eingefrorene Spalten
- Blockiert Kopier- und Zurücksetzungsoperationen für eingefrorene Spalten
- Beeinflusst **nicht** den Lesezugriff -- Daten bleiben sichtbar

### Aktueller Status

Unterhalb der Steuerelemente zeigen zwei Karten den Echtzeit-Einfrierstatus für jede Spalte in OPEX und CAPEX. Jede Spalte zeigt entweder **Eingefroren** (in Rot) oder **Bearbeitbar** an.

### Berechtigungen

Ohne `budget_ops:admin` können Sie den Einfrierstatus weiterhin einsehen, aber die Steuerelemente sind deaktiviert. Ein Hinweisbanner erklärt, was benötigt wird.

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
| **Quellspalte** | Budget, Revision, Ist-Werte oder Erwarteter Endwert |
| **Zieljahr** | Jahr, in das kopiert wird (gleicher Bereich) |
| **Zielspalte** | Budget, Revision, Ist-Werte oder Erwarteter Endwert |
| **Prozentuale Erhöhung** | Anpassung, die auf jeden kopierten Monat angewendet wird (z. B. `3` = +3 %). Standard ist 0. Dezimalwerte und negative Werte möglich. |
| **Vorhandene Daten überschreiben** | Umschalter. Wenn aus, werden Elemente die bereits einen Wert im Ziel haben, übersprungen. Wenn ein, werden alle Zielwerte ersetzt. |

### Zwei-Schritt-Prozess: Testlauf, dann Kopieren

1. Klicken Sie auf **Testlauf**, um eine Vorschau zu erstellen, ohne Daten zu ändern
2. Überprüfen Sie das Vorschau-Grid, das zeigt:
   - Name der **Position** (mit **Übersprungen** markierte Positionen behalten ihren aktuellen Wert)
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

- Die Kopie behält die monatliche Verteilung bei. Jeder der zwölf Monate wird in denselben Monat des Ziels kopiert: Eine Spalte, die von April bis Dezember verteilt ist, bleibt von April bis Dezember verteilt
- Ohne Prozentsatz werden die Beträge exakt kopiert, auf den Cent genau
- Mit einem Prozentsatz wird jeder Monat auf einen ganzen Betrag gerundet. Die Jahressumme ist die Quellsumme mit angewendetem Prozentsatz, auf einen ganzen Betrag gerundet. Die kleine Differenz wird dem letzten Monat mit einem Betrag zugeschlagen. Beispiel: 12.000, verteilt von April bis Dezember (1.333,33 pro Monat und 1.333,36 im Dezember), ergeben mit +2 % kopiert 1.360 pro Monat und 12.240 für das Jahr
- Der Zeitraum der Spalte wandert mit der Kopie: April bis Dezember 2026 wird zu April bis Dezember 2027. Ein Zeitraum, der am 29. Februar endet, endet in einem Jahr ohne diesen Tag am 28. Februar
- Eine Quelle ohne Zeitraum oder eine Ist-Werte-Quelle ergibt einen Zeitraum über das ganze Jahr
- Im Budget-Tab zeigt die Zielspalte „Kopiert aus Budget 2026 +2 %“
- Das Kopieren einer Spalte auf sich selbst (gleiches Jahr und gleiche Spalte) wird abgelehnt
- Die Kopie gilt ganz oder gar nicht: Schlägt eine Position fehl, wird nichts gespeichert

### Schutz eingefrorener Spalten

Wenn die Zielspalte eingefroren ist, sind sowohl **Testlauf** als auch **Daten kopieren** deaktiviert. Ein Fehlerbanner weist Sie an, zuerst die Sperrung aufzuheben.

---

## Zuordnungen kopieren

Kopieren Sie Zuordnungsmethoden und Prozentsätze von einem Jahr in ein anderes für alle OPEX-Positionen. Dies erspart Ihnen die Neueingabe der Leistungsverrechnungs-Konfigurationen beim Einrichten eines neuen Geschäftsjahres.

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
2. Das Vorschau-Grid zeigt jede OPEX-Position mit:
   - **Produkt**name
   - **Aktion** -- was geschehen wird (Wird kopiert, Übersprungen -- kein Quelljahr, Übersprungen -- keine Zuordnungen in der Quelle, Übersprungen -- Ziel hat Daten, Fehler)
   - **Quell**methode und -bezeichnung
   - **Ziel** aktuelle Methode und Bezeichnung
   - **Ergebnis nach Kopieren** -- wie das Ziel aussehen wird
3. Klicken Sie auf **Daten kopieren** zum Anwenden

### Validierung

- Quell- und Zieljahr müssen unterschiedlich sein. Bei Übereinstimmung erscheint ein Warnbanner und beide Schaltflächen werden deaktiviert.
- Jede Filteränderung löscht die Vorschau und erfordert einen neuen Testlauf.

### Zusammenfassung

Nach einem Testlauf zeigt ein Banner die Anzahl der kopierberiten, übersprungenen und fehlerhaften Elemente. Wenn Elemente übersprungen wurden, weil das Ziel bereits Zuordnungen hat, erscheint eine separate Warnung mit dem Vorschlag, die Überschreibung zu aktivieren.

---

## Budgetspalte zurücksetzen

Löschen Sie alle Daten einer bestimmten Budgetspalte für ein gegebenes Jahr. Dies ist eine destruktive Operation: Verwenden Sie sie, wenn Sie neu beginnen müssen.

Der Umschalter **OPEX** / **CAPEX** oben auf der Seite legt fest, welche Positionen geleert werden. Das Zurücksetzen setzt die zwölf Monate der Spalte auf null und entfernt ihren Zeitraum. Im Budget-Tab erhält die Spalte danach einen neuen Vorschlag aus den Daten der Position. Das Zurücksetzen gilt ganz oder gar nicht: Schlägt eine Position fehl, wird nichts geleert.

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
| **Budgetspalte** | Budget, Revision, Ist-Werte oder Erwarteter Endwert |

### Vorschau

Die Seite lädt ein Grid mit jeder OPEX- oder CAPEX-Position und ihrem aktuellen Wert in der ausgewählten Spalte. Beträge, die geleert werden, erscheinen halbfett; leere Werte sind abgeschwächt. Unterhalb des Grids erscheinen drei Statistiken:

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
- Eingefrorene Spalten können nicht zurückgesetzt werden -- heben Sie zuerst die Sperrung auf
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
2. **Wählen Sie den Unternehmensumfang** -- *Alle aktiven Unternehmen* oder *Ausgewählte Unternehmen* und dann die Unternehmen selbst
3. **Wählen Sie den Treiber**, der die Unternehmen gewichtet (Mitarbeiterzahl, IT-Benutzer oder Umsatz)
4. Jede Änderung wird sofort gespeichert, es gibt keine Schaltfläche zum Speichern
5. Um zur Standardmethode zurückzukehren, klicken Sie auf **Standardmethode verwenden** (wird nur angezeigt, solange ein eigener Standard konfiguriert ist)

### Ausgewählte Unternehmen

- Der Treiber wird nur auf die ausgewählten Unternehmen angewendet: ihre Prozentsätze werden aus ihrer eigenen Mitarbeiterzahl, ihren IT-Benutzern oder ihrem Umsatz für das Jahr berechnet
- Die Seite zeigt die daraus resultierende Aufteilung, sodass Sie die Wirkung prüfen können, bevor Sie sich darauf verlassen
- Ein einzelnes ausgewähltes Unternehmen erhält immer **100 %**, ohne dass ein Treiberwert erforderlich ist
- Ab zwei Unternehmen benötigt jedes ausgewählte Unternehmen einen Wert für den gewählten Treiber. Ein Unternehmen ohne Wert wird beim Speichern abgelehnt -- korrigieren Sie zuerst die Unternehmenskennzahlen unter **Stammdaten > Unternehmen**
- Ein für das Jahr deaktiviertes Unternehmen kann nicht ausgewählt werden: Deaktivierte Unternehmen sind von den Zuordnungen dieses Jahres ausgeschlossen

### Was es beeinflusst

- Jede OPEX-Position und CAPEX-Investition, deren Zuordnungsmethode **Standard** ist -- im Zuordnungen-Tab als *Mitarbeiterzahl (Standard)* (oder *Standard (n Unternehmen)*) angezeigt, bis ein organisationsweiter Standard festgelegt ist
- Positionen mit einer expliziten Methode (Mitarbeiterzahl, IT-Benutzer oder Umsatz, fest an der Position gewählt) oder einer manuellen Zuordnung behalten ihre eigene Einstellung
- Zugeordnete Beträge werden neu berechnet, sobald die Zuordnungen das nächste Mal angezeigt werden. Die Budgetbeträge selbst werden nie geändert

### Standardmethode

Solange eine Organisation keinen Standard konfiguriert, gilt die Standardmethode: **Mitarbeiterzahl** über alle für das Jahr aktiven Unternehmen. Die Seite zeigt immer an, ob das Jahr auf der Standardmethode oder auf einem konfigurierten Standard läuft, und welche Methode als Standard gilt.

### Den Standard nachträglich ändern

Der Standard wird bei jeder Anzeige der Zuordnungen neu aufgelöst: Eine Änderung berechnet alle Positionen neu, die auf Standard stehen. Verliert ein Unternehmen der Auswahl später seinen Treiberwert oder wird es deaktiviert, zeigen die betroffenen Positionen einen Fehler statt einer stillschweigend neu verteilten Aufteilung -- die Seite weist Sie auf Probleme mit der aktuellen Auswahl hin.

### Berechtigungen

Ohne `budget_ops:admin` können Sie die aktuelle Einstellung einsehen, aber nicht ändern.

---

## Datei der Budgetzeilen

Exportieren oder importieren Sie die Monatsbeträge aller OPEX- und CAPEX-Positionen in einer einzigen Datei, mit einer Zeile pro Position, Jahr und Spalte.

### Wann verwenden

- Monatsbudgets laden, die in einer Tabellenkalkulation vorbereitet wurden
- Monatliche Ist-Werte aus Ihrem Buchhaltungssystem importieren
- Alle Spalten prüfen oder archivieren, einschließlich der Prognose

### Export

1. Wählen Sie ein Jahr oder behalten Sie **Alle Jahre** bei
2. Klicken Sie auf **Exportieren** und dann auf **Daten exportieren**

Die Datei enthält jede OPEX- und CAPEX-Position, die Sie lesen dürfen, für jedes Jahr mit Beträgen. Jede Position erhält pro Jahr fünf Zeilen in dieser Reihenfolge: Budget, Revision, Prognose, Ist-Werte, Erwarteter Endwert. Spalten ohne Beträge sind ebenfalls enthalten. Wenn die Datei nur ein Jahr abdeckt, oder aufgrund Ihrer Berechtigungen nur OPEX oder nur CAPEX, endet ihr Name auf `partial`.

Eine Datei kann bis zu 10 MB groß sein, um importiert zu werden. Bei einem größeren Budget exportieren und importieren Sie jeweils ein Jahr: Ein auf ein Jahr begrenzter Export ergibt eine kleinere Datei.

### Spalten

Die Datei verwendet das Semikolon `;` als Trennzeichen und die Kodierung UTF-8.

| Spalte | Inhalt |
|--------|--------|
| `item_type` | `opex` oder `capex` |
| `item_number` | Die Positionsnummer, zum Beispiel `7`. Beim Import funktioniert auch die Referenz (`OPX-7`, `CPX-7`) |
| `year` | Vier Ziffern |
| `measure` | Die Spalte: `planned` (Budget), `committed` (Revision), `forecast` (Prognose), `actual` (Ist-Werte), `expected_landing` (Erwarteter Endwert). Beim Import funktionieren auch `budget`, `revision`, `follow_up` und `landing` |
| `period_start`, `period_end` | Der Zeitraum der Spalte im Format `YYYY-MM-DD`, innerhalb des Jahres der Zeile. Leer bei Ist-Werte-Zeilen. Beim Import bedeuten zwei leere Werte das ganze Jahr |
| `jan` bis `dec` | Die zwölf Monatsbeträge, mit einem Punkt als Dezimaltrennzeichen. Beim Import werden auch ein Komma und Leerzeichen akzeptiert |
| `method` | Wie die Spalte entstanden ist: `spread`, `copied` oder `manual`. Nur zur Information, beim Import ignoriert |

### Importregeln

1. Klicken Sie auf **Importieren**, wählen Sie die Datei und starten Sie die **Vorabprüfung**
2. Prüfen Sie den Bericht und klicken Sie dann auf **Laden**

- Die gesamte Datei wird geprüft, bevor etwas gespeichert wird. Enthält eine Zeile einen Fehler, wird nichts gespeichert, und der Bericht listet die Fehler nach Zeilennummer auf
- Jede Zeile ersetzt die zwölf Monate ihrer Position, ihres Jahres und ihrer Spalte. Positionen, Jahre und Spalten, die nicht in der Datei stehen, bleiben unverändert
- Alle zwölf Monate sind Pflicht. Tragen Sie `0` für einen Monat ohne Betrag ein
- Eine Zeile, die dem gespeicherten Stand entspricht, bleibt unverändert, einschließlich der Angabe, wie die Spalte entstanden ist. Ein erneuter Import eines Exports ändert nichts
- Eine Zeile mit geänderten Beträgen kennzeichnet die Spalte als **Von Hand geändert**, mit dem Zeitraum aus der Datei
- Eine Zeile, die nur den Zeitraum ändert, aktualisiert den Zeitraum und behält den Rest bei
- Ist-Werte-Zeilen sind erlaubt, sodass Sie monatliche Ist-Werte importieren können. Ist-Werte haben keinen Zeitraum
- Eine geänderte Zeile in einer eingefrorenen Spalte wird abgelehnt. Eine unveränderte Zeile in einer eingefrorenen Spalte wird akzeptiert
- Doppelte Zeilen (gleiche Position, gleiches Jahr und gleiche Spalte), unbekannte Positionsnummern und Positionen eines Typs, den Sie nicht administrieren dürfen, sind Fehler
- Der Import erfordert Administrationsrechte für OPEX oder für CAPEX. Der Export erfordert Lesezugriff auf einen der beiden Bereiche

---

## Workflow-Beispiel: Jährlicher Budgetzyklus

Hier ist eine typische Abfolge mit diesen Werkzeugen:

### 1. Ende des Jahres N

1. Ist-Werte des Jahres N einfrieren (historische Daten schützen)
2. N Budget nach N+1 Budget kopieren (mit prozentualer Erhöhung für Inflation)
3. N Zuordnungen nach N+1 kopieren

### 2. Während der Budgetplanung (N+1)

1. Teams bearbeiten die Budgetspalte N+1
2. CFO prüft und genehmigt

### 3. Budgetgenehmigung

1. N+1 Budget einfrieren (genehmigtes Budget sperren)
2. N+1 Budget nach N+1 Revision kopieren (Ausgangspunkt für unterjährige Nachverfolgung)

### 4. Halbjahresrevision

1. Teams aktualisieren die N+1 Revision mit Prognoseänderungen
2. Nach Finalisierung N+1 Revision einfrieren

---

## Tipps

- **Immer zuerst einen Testlauf durchführen**: Sowohl Budgetspalten kopieren als auch Zuordnungen kopieren unterstützen einen Testlauf. Verwenden Sie ihn jedes Mal, um das Ergebnis vor dem Festschreiben zu überprüfen.
- **Nach Genehmigung einfrieren**: Das Sperren von Spalten nach der Genehmigung bewahrt Ihren Audit-Trail und verhindert versehentliche Bearbeitungen.
- **Prozentuale Anpassungen verwenden**: Beim Kopieren zwischen Jahren wenden Sie einen Inflations- oder Wachstumsfaktor an, damit Sie nicht jede Zeile manuell anpassen müssen.
- **Einfrierstatus vor Massenoperationen prüfen**: Eingefrorene Spalten blockieren Kopier- und Zurücksetzungsoperationen. Wenn eine Schaltfläche ausgegraut ist, prüfen Sie zuerst die Einfrierseite.
- **Legen Sie den Standard des Jahres vor der Budgeterfassung fest**: Wenn Ihre Zuordnungsbasis nicht die Mitarbeiterzahl ist, konfigurieren Sie sie zuerst unter Standard-Zuordnungsmethode, damit Positionen gleich auf der richtigen Basis angelegt werden und nicht später neu berechnet werden müssen.
- **Mit Vorsicht zurücksetzen**: Das Zurücksetzen von Spalten ist irreversibel. Überprüfen Sie Jahr und Spalte doppelt, bevor Sie bestätigen.
