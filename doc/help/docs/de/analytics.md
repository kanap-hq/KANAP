# Analysedimensionen

Analysedimensionen klassifizieren Ihr IT-Budget für das Reporting, außerhalb Ihrer Buchhaltungsstruktur. Sie wählen eigene Blickwinkel auf das Budget, etwa die Art der Ausgabe oder das Programm, dem sie dient, ohne Unternehmen, Abteilungen, Konten oder Kostenstellen umzubauen.

## Dimensionen und Werte

Eine **Dimension** ist eine Art, Budgetzeilen zu klassifizieren, zum Beispiel **Nature** oder **Program**. Ihre **Werte** sind die Auswahlmöglichkeiten, die sie bietet, zum Beispiel **Licenses**, **Cloud** und **Services** für Nature.

- Jede Dimension hat ihre eigene Werteliste.
- Jede OPEX- und CAPEX-Zeile kann einen Wert pro Dimension tragen. Eine Zeile kann gleichzeitig **Licenses** in Nature und **Workplace** in Program sein.
- Eine Zeile kann in einer Dimension auch keinen Wert haben. Berichte zeigen diese Zeilen als „Nicht zugeordnet“.

Zum Beispiel:

```
Nature          Program
  Licenses        Workplace
  Cloud           ERP
  Services        Security
```

### Die Standarddimension

Jeder Arbeitsbereich beginnt mit einer Dimension, der Standarddimension. Solange Sie ihr keinen Namen geben, erscheint sie als **Analysedimension**, in der Sprache jeder Person. Hatte Ihr Arbeitsbereich bereits Analysewerte, gehören sie zu dieser Dimension, und jede Zeile behält ihren Wert.

Die Standarddimension hat eine besondere Rolle:

- Sie kann weder deaktiviert noch gelöscht werden. Ihr Arbeitsbereich hat keine Schaltfläche **Löschen**, und eine Zeile unter **Lebenszyklus** nennt den Grund: „Diese Dimension kann weder deaktiviert noch gelöscht werden: Ältere Dateien und Fragen an die KI verwenden sie.“
- Fragen an Plaid zur Analysekategorie verwenden sie. Siehe [Analysedimensionen in Plaid](#analysedimensionen-in-plaid). In einer Budgetdatei hat jede Dimension ihre eigene Spalte, die Standarddimension eingeschlossen: Siehe [Ein Budget aus einer Tabellenkalkulation laden](budget-file.md).
- Sie bleibt die Standarddimension, wenn Sie sie umbenennen oder ihren Code oder ihre Reihenfolge ändern.
- Ihre Bezeichnung ist reserviert: Keine andere Dimension kann „Analysedimension“ heißen, und das gilt für jede Sprache der App.

---

## Erste Schritte

Navigieren Sie zu **Stammdaten > Analysedimensionen** (im Abschnitt **Finanzen**).

1. **Benennen Sie die Standarddimension**, wenn „Analysedimension“ nicht passt: Wählen Sie sie in der Auswahlleiste aus, klicken Sie auf **Bearbeiten** und geben Sie dann in ihrem Arbeitsbereich einen Namen ein, zum Beispiel **Nature**.
2. **Fügen Sie ihre Werte hinzu**: Klicken Sie auf **Neuer Wert**.
3. **Fügen Sie eine Dimension hinzu**, wenn Sie das Budget aus einem weiteren Blickwinkel lesen möchten: Klicken Sie in der Auswahlleiste auf **Neu** und fügen Sie dann ihre Werte hinzu.

**Tipp**: Beginnen Sie mit ein oder zwei Dimensionen und jeweils 5 bis 10 Werten. Eine einheitliche Benennung macht die Listen übersichtlicher.

---

## Die Seite Analysedimensionen

### Dimensionsauswahl

Unter dem Titel zeigt ein graues Band Ihre Dimensionen in ihrer Reihenfolge, mit je einer quadratischen Schaltfläche. Es sieht aus wie die Auswahl der Kontenpläne und funktioniert genauso. Eine deaktivierte Dimension ist als **Deaktiviert** markiert. Bei vielen Dimensionen scrollt das Band seitlich.

- Klicken Sie auf eine Schaltfläche, um die Werte dieser Dimension aufzulisten. Die ausgewählte Schaltfläche ist gefüllt. Die Seitenadresse speichert Ihre Wahl, sodass ein gespeicherter Link mit derselben Dimension öffnet. Ohne Wahl öffnet die Seite mit der Standarddimension.
- Rechts im Band öffnet **Bearbeiten** den Arbeitsbereich der ausgewählten Dimension. Wenn Sie Dimensionen nur lesen dürfen, heißt die Schaltfläche **Öffnen**.
- **Neu** daneben erstellt eine Dimension (erfordert `analytics:member`).

Mit einer einzigen Dimension zeigt das Band eine Schaltfläche und die Werte.

### Werteliste

Die Liste zeigt die Werte der ausgewählten Dimension.

**Spalten**:

| Spalte | Was sie zeigt |
|---|---|
| **Name** | Der Name des Werts |
| **Beschreibung** | Was der Wert abdeckt |
| **Status** | **Aktiviert** oder **Deaktiviert** |
| **Aktualisiert** | Datum und Uhrzeit der letzten Änderung |

Klicken Sie auf eine beliebige Zelle, um den Arbeitsbereich des Werts zu öffnen.

**Filtern**:

- **Schnellsuche**: durchsucht den Namen und die Beschreibung
- **Statusfilter**: ein Kontrollkästchen-Filter auf der Spalte **Status**. Wenn Sie darin auf **Leeren** klicken oder beide Werte abwählen, zeigt die Liste nichts mehr an, unabhängig von **Anzeigen**
- **Statusbereich**: der Umschalter **Anzeigen: Alle / Aktiv / Deaktiviert** über der Liste. Standardmäßig zeigt die Liste aktivierte Werte

**Aktionen**:

- **Neuer Wert**: einen Wert in der ausgewählten Dimension erstellen (erfordert `analytics:member`). Solange die ausgewählte Dimension deaktiviert ist, ist die Schaltfläche deaktiviert, und ihr Tooltip lautet „Aktivieren Sie diese Dimension, um Werte hinzuzufügen.“
- **CSV importieren**: Werte aus einer Datei laden (erfordert `analytics:admin`)
- **CSV exportieren**: die Werte aller Dimensionen herunterladen (erfordert `analytics:admin`)
- **Auswahl löschen**: die ausgewählten Werte löschen (erfordert `analytics:admin`). Werte, die von Budgetzeilen verwendet werden, bleiben erhalten

---

## Dimensionen

### Eine Dimension erstellen

Klicken Sie in der Auswahlleiste auf **Neu**, füllen Sie die Felder aus und klicken Sie dann auf **Erstellen**. Der Arbeitsbereich der neuen Dimension öffnet sich. Eine neue Dimension ist aktiviert.

- **Name** ist Pflicht.
- **Code** wird aus dem Namen vorgeschlagen: Kleinbuchstaben, ohne Akzente, Leerzeichen durch `-` ersetzt. Sie können ihn ändern, bevor Sie die Dimension erstellen.
- **Reihenfolge** wird so vorgeschlagen, dass die neue Dimension zuletzt kommt.
- **Beschreibung** ist optional.

Kehren Sie dann zur Seite zurück, um die Werte der neuen Dimension hinzuzufügen.

### Der Dimensions-Arbeitsbereich

Öffnen Sie ihn mit **Bearbeiten** (**Öffnen**, wenn Sie nur lesen dürfen) in der Auswahlleiste, bei ausgewählter Dimension.

- **Kopfzeile**: der Name der Dimension. Klicken Sie darauf, um die Dimension umzubenennen. **Zurück** / **Weiter** bewegen sich durch die Dimensionen in ihrer Reihenfolge, und die Schließen-Schaltfläche führt zur Seite mit dieser Dimension zurück
- **Hauptbereich**: eine Nutzungszeile, zum Beispiel „12 Werte, verwendet von 27 OPEX-Zeilen und 2 CAPEX-Zeilen.“, dann die **Beschreibung**
- **Bereich Eigenschaften** rechts: **Name**, **Code**, **Reihenfolge** und **Lebenszyklus**

**Automatisches Speichern**: Jede Änderung wird von selbst gespeichert. Es gibt keine Schaltfläche zum Speichern. Textfelder werden gespeichert, wenn Sie sie verlassen (drücken Sie in **Name**, **Code** und **Reihenfolge** Enter, um sofort zu speichern); der Lebenszyklus wird gespeichert, sobald Sie ihn ändern. Wird eine Änderung abgelehnt, erscheint der Grund unter dem Feld, das sie verursacht hat, zum Beispiel ein doppelter Code unter **Code**. Ein in der Kopfzeile abgelehnter Name wird oben auf der Seite angezeigt.

### Felder einer Dimension

| Feld | Was Sie eingeben |
|---|---|
| **Name** | Bis zu 200 Zeichen. Namen sind unabhängig von Groß- und Kleinschreibung eindeutig. Pflicht, außer bei der Standarddimension: Lassen Sie ihn dort leer, um „Analysedimension“ in der Sprache jeder Person anzuzeigen. Die Bezeichnung der Standarddimension ist in jeder Sprache der App reserviert („Analytics dimension“, „Dimension analytique“, „Analysedimension“, „Dimensión analítica“), unabhängig von Groß- und Kleinschreibung: Eine andere Dimension mit einem dieser Namen wird mit „This name is reserved for the default dimension.“ abgelehnt |
| **Code** | 1 bis 40 Zeichen: Kleinbuchstaben, Ziffern, `-` oder `_`, beginnend mit einem Buchstaben oder einer Ziffer. Jeder Code ist eindeutig. Der Code benennt die Spalte der Dimension in den OPEX- und CAPEX-CSV-Dateien, sodass eine Änderung des Codes diesen Spaltennamen ändert. Budgetzeilen behalten ihre Werte, wenn sich der Code ändert |
| **Reihenfolge** | Eine ganze Zahl. Dimensionen werden nach dieser Zahl sortiert, die kleinste zuerst: auf dieser Seite, auf Budgetzeilen, in den Berichtsfiltern und in der Dimensionsauswahl des Berichts |
| **Beschreibung** | Wofür die Dimension da ist, damit Teammitglieder Zeilen einheitlich klassifizieren |
| **Lebenszyklus** | Der Statusschalter, dessen Beschriftung den aktuellen Zustand zeigt (**Aktiviert** oder **Deaktiviert**), und das Datum **Ende der Gültigkeit**. Siehe [Status und Lebenszyklus](#status-und-lebenszyklus). Bei der Standarddimension gesperrt, mit einer Zeile darunter: „Diese Dimension kann weder deaktiviert noch gelöscht werden: Ältere Dateien und Fragen an die KI verwenden sie.“ |

### Eine Dimension löschen

Die Schaltfläche **Löschen** in der Kopfzeile löscht die Dimension sofort (erfordert `analytics:admin`). Solange die Dimension noch Werte hat, ist die Schaltfläche deaktiviert, und eine Zeile unter der Nutzungszeile nennt den Grund: „Um diese Dimension zu löschen, löschen Sie zuerst ihre Werte.“

Die Standarddimension hat keine Schaltfläche **Löschen**: Sie kann nicht gelöscht werden.

Um die Werte stattdessen auf den Zeilen zu behalten, deaktivieren Sie die Dimension.

---

## Werte

### Einen Wert erstellen

Klicken Sie auf **Neuer Wert**. Das Feld **Dimension** steht zunächst auf der Dimension, die auf der Seite ausgewählt ist, und bietet nur aktivierte Dimensionen an. Füllen Sie **Name** und bei Bedarf **Beschreibung** aus und klicken Sie dann auf **Erstellen**. Der Arbeitsbereich des neuen Werts öffnet sich. Ein neuer Wert ist aktiviert.

### Der Werte-Arbeitsbereich

- **Kopfzeile**: der Name des Werts. Klicken Sie darauf, um den Wert umzubenennen. **Zurück** / **Weiter** bewegen sich durch die Werte derselben Dimension, in der aktuellen Reihenfolge und mit den aktuellen Filtern der Liste. Die Schließen-Schaltfläche führt zur Liste zurück
- **Hauptbereich**: eine Zeile wie „Verwendet von 3 OPEX-Zeilen und 1 CAPEX-Zeile.“, wenn Budgetzeilen den Wert verwenden, dann die **Beschreibung**
- **Bereich Eigenschaften** rechts: **Dimension** (schreibgeschützt) und **Lebenszyklus**

Änderungen werden von selbst gespeichert, wie im Dimensions-Arbeitsbereich. Ein in der Kopfzeile abgelehnter Name wird oben auf der Seite angezeigt.

### Regeln für Werte

- **Eine Liste pro Dimension**: Namen sind innerhalb einer Dimension eindeutig, unabhängig von Groß- und Kleinschreibung. Zwei Dimensionen können jeweils einen Wert namens „Sonstiges“ haben. Ein doppelter Name wird abgelehnt, zum Beispiel „A value named Licenses already exists in Nature.“
- **Ein Wert bleibt in seiner Dimension**: Die Dimension wird beim Erstellen des Werts festgelegt und kann sich nicht ändern. Um einen Wert zu verschieben, erstellen Sie ihn in der anderen Dimension, ändern Sie die Zeilen und löschen Sie dann den alten Wert.
- **Umbenennen behält die Zeilen**: Zeilen verweisen auf den Wert selbst, daher erscheint der neue Name sofort in Listen und Berichten.
- **Löschen**: Die Schaltfläche **Löschen** in der Kopfzeile löscht den Wert sofort (erfordert `analytics:admin`). Sie ist deaktiviert, wenn Budgetzeilen den Wert verwenden, mit dem Grund, zum Beispiel „Verwendet von 3 OPEX-Zeilen und 1 CAPEX-Zeile. Deaktivieren Sie ihn stattdessen.“ Entfernen Sie den Wert zuerst von diesen Zeilen, oder deaktivieren Sie ihn.

---

## Status und Lebenszyklus

Dimensionen und Werte haben jeweils einen Status (**Aktiviert** oder **Deaktiviert**) und ein optionales **Ende der Gültigkeit**. Damit stellen Sie eine Dimension oder einen Wert außer Dienst, ohne sie zu löschen.

- **Ende der Gültigkeit**: das Datum, an dem die Dimension oder der Wert endet. Lassen Sie es leer, damit sie aktiv bleiben. Sie können auch ein zukünftiges Datum planen.
- Ein Wechsel auf **Deaktiviert** ohne Datum setzt das Ende der Gültigkeit auf heute. Ein Wechsel zurück auf **Aktiviert** löscht das Datum.
- Sobald das Ende der Gültigkeit vorbei ist, wechselt der Status innerhalb einer Stunde von selbst auf **Deaktiviert**.

**Ein deaktivierter Wert**:

- Kann nicht für eine Zeile gewählt werden, weder in der App noch in einer CSV-Datei noch über Plaid.
- Bleibt auf den Zeilen, die ihn bereits haben, und zählt weiterhin in den Berichten. In der Liste des Felds ist er als **Deaktiviert** markiert.

**Eine deaktivierte Dimension**:

- Verschwindet aus den Positionsformularen, den OPEX- und CAPEX-Listen, den Berichtsfiltern, der Dimensionsauswahl des Berichts, den OPEX- und CAPEX-CSV-Exporten und aus Plaid. Nur die Seite Analysedimensionen zeigt sie, als **Deaktiviert** markiert.
- Behält ihre Werte auf den Zeilen. Aktivieren Sie die Dimension wieder, und die Werte erscheinen wieder.
- Nimmt keine neuen Werte auf. **Neuer Wert** ist deaktiviert, solange die Dimension ausgewählt ist, und CSV-Dateien können ihre Werte weder hinzufügen noch ändern.

Die Standarddimension kann nicht deaktiviert werden.

**Deaktivieren statt löschen**: Das Deaktivieren hält die Berichte konsistent und die Listen übersichtlich.

---

## Werte auf Budgetzeilen

Im Bereich **Eigenschaften** einer OPEX- oder CAPEX-Position, und wenn Sie eine erstellen, hat jede aktivierte Dimension ein eigenes Feld, nach der Dimension benannt, in der Reihenfolge der Dimensionen. Die Standarddimension erscheint als **Analysedimension**, bis Sie sie umbenennen.

- Wählen Sie einen Wert, oder leeren Sie das Feld, um die Zeile in dieser Dimension ohne Wert zu lassen. Die Änderung wird sofort gespeichert.
- Das Feld listet die aktivierten Werte seiner Dimension. Ein deaktivierter Wert bleibt auf den Zeilen sichtbar, die ihn haben.
- Das Feld kann keinen Wert erstellen. Erstellen Sie Werte auf der Seite Analysedimensionen, oder lassen Sie sie von einem OPEX- oder CAPEX-CSV-Import erstellen.
- Ein Wert gilt für die ganze Zeile, über alle Jahre.
- Können die Dimensionen nicht geladen werden, ersetzt eine Zeile diese Felder: „Die Dimensionen konnten nicht geladen werden.“

Die OPEX- und CAPEX-Listen haben eine Spalte pro aktivierter Dimension, standardmäßig ausgeblendet, mit Kontrollkästchen-Filtern. Siehe [OPEX](opex.md) und [CAPEX](capex.md).

---

## Berichte

Der Bericht **Analysedimensionen** (unter **Berichte**) zeigt, wie sich das Budget Ihrer OPEX- oder CAPEX-Zeilen auf die Werte einer Dimension verteilt. Die vollständige Beschreibung finden Sie unter [Berichte](reports.md#analysedimensionen).

- **Positionstyp**: OPEX oder CAPEX
- **Dimension**: die Dimension, nach der der Bericht gruppiert. Sie erscheint, wenn Sie zwei oder mehr aktivierte Dimensionen haben, und steht zunächst auf der Standarddimension
- **Jahresbereich**: ein einzelnes Jahr (Kreis- oder Balkendiagramm) oder mehrere Jahre (Liniendiagramm)
- **Kennzahl**: jede Budgetspalte, die Ihre Organisation anzeigt, unter ihrem Namen. Beginnt mit der Standardspalte
- **Werte ausschließen**: einige Werte weglassen, um sich auf die anderen zu konzentrieren

Die sieben Budgetberichte lassen sich auch auf einen Wert einer Dimension eingrenzen, mit einem Filter pro Dimension. Siehe [Filter nach Kostenstelle, Run oder Build und Analysedimensionen](reports.md#filter-nach-kostenstelle-run-oder-build-und-analysedimensionen).

---

## Analysedimensionen in Plaid

- Plaid kann OPEX- und CAPEX-Zeilen nach jeder aktivierten Dimension filtern und gruppieren.
- Eine Frage zur Analysekategorie verwendet die Standarddimension, unabhängig von ihrem Namen und ihrer Reihenfolge.
- Plaid kann den Wert einer Zeile nur in der Standarddimension ändern. Setzen Sie die anderen Dimensionen in der App oder mit einer CSV-Datei.

---

## CSV-Import/Export

Laden oder aktualisieren Sie die Werte aller Dimensionen aus einer Datei. Dimensionen werden auf der Seite erstellt.

Um Werte auf Budgetpositionen aus einer Datei zu setzen, verwenden Sie die OPEX- und CAPEX-Budgetdateien. In diesen Dateien enthält je eine Spalte `analytics:<code>` jede Dimension, die Standarddimension eingeschlossen. Siehe [Ein Budget aus einer Tabellenkalkulation laden](budget-file.md).

**Export**: Klicken Sie auf **CSV exportieren** und dann auf **Daten exportieren**. Die Datei listet die Werte aller Dimensionen, aktiviert oder deaktiviert, Dimension für Dimension. Für eine leere Datei nur mit den Kopfzeilen verwenden Sie **Vorlage herunterladen** im Importdialog.

**CSV-Struktur**:

- Kopfzeilen: `axis_code`, `name`, `description`, `status`, `disabled_at`
- Der Export schreibt das Trennzeichen der Sprache der Oberfläche. Siehe [CSV-Dateien](csv-files.md) für die Kodierung, das Trennzeichen, die Datumsformen und die beiden Importschritte

| Spalte | Inhalt |
|---|---|
| `axis_code` | Der Code der Dimension des Werts, unabhängig von Groß- und Kleinschreibung. Leer bedeutet die Standarddimension |
| `name` | Pflicht. Der Name des Werts |
| `description` | Freitext |
| `status` | `enabled` oder `disabled`. Leer bedeutet `enabled` für einen neuen Wert und behält bei einer Aktualisierung den gespeicherten Status |
| `disabled_at` | Das Ende der Gültigkeit: ein Datum (`2026-12-31`) oder ein vollständiges Datum mit Uhrzeit. Leer, wenn es kein Ende gibt. Bei einer Aktualisierung behalten ein leerer `status` und ein leeres `disabled_at` die gespeicherten Werte. `enabled` mit leerem Datum löscht das Ende der Gültigkeit. `disabled` mit leerem Datum behält ein bereits vergangenes Datum und beendet den Wert sonst heute |

Nur `name` ist eine Pflichtspalte. Fehlt die Spalte `description`, `status` oder `disabled_at`, behalten bestehende Werte, was dafür gespeichert ist, und neue Werte sind aktiviert und ohne Beschreibung. Eine Datei ohne `axis_code` legt jede Zeile in die Standarddimension.

**Import**:

1. Klicken Sie auf der Seite auf **CSV importieren**
2. Wählen Sie Ihre Datei
3. Klicken Sie auf **Vorabprüfung**. Der Bericht nennt die Anzahl der Zeilen, die zu erstellenden und zu aktualisierenden Werte sowie die Zeilen, die nichts ändern
4. Wenn die Vorabprüfung fehlerfrei ist, klicken Sie auf **Laden**

**So funktioniert der Import**:

- **Die gesamte Datei wird geprüft, bevor etwas geschrieben wird.** Eine Datei mit einem Fehler lädt nichts: Korrigieren Sie die Zeilen und führen Sie die Vorabprüfung erneut aus. Jeder Fehler nennt seine Zeile mit der Zeilennummer der Datei, wie ein Texteditor sie anzeigt, einschließlich Leerzeilen und Zellen über mehrere Zeilen.
- **Zuordnung über Dimension und Name**: Eine Zeile, deren Name in ihrer Dimension existiert, aktualisiert diesen Wert; jede andere Zeile erstellt einen. Jede Zelle ersetzt den gespeicherten Inhalt, sodass eine leere `description` ihn löscht. Ein Name in anderer Groß- und Kleinschreibung findet den gespeicherten Wert und benennt ihn nicht um. Um einen Wert umzubenennen, benennen Sie ihn auf der Seite um.
- **Unveränderte Zeilen**: Eine Zeile, die dem gespeicherten Wert entspricht, ändert nichts. Wenn Sie dieselbe Datei exportieren und importieren, werden alle Zeilen als unverändert gemeldet.
- **Deaktivierte Dimensionen**: Eine Zeile einer deaktivierten Dimension wird akzeptiert, wenn sie nichts ändert, sodass eine exportierte Datei unverändert importiert wird. Eine Zeile, die dort einen Wert erstellen oder ändern würde, wird abgelehnt.
- **In der Datei fehlende Werte** bleiben unverändert. Der Import löscht nie.

**Häufige Fehler**:

- **„Unknown dimension '...'.“**: Die Zelle `axis_code` passt zu keiner Dimension. Prüfen Sie den Code im Arbeitsbereich der Dimension, oder erstellen Sie zuerst die Dimension.
- **„The ... dimension is disabled. Enable it or leave it out.“**: Eine Zeile erstellt oder ändert einen Wert in einer deaktivierten Dimension. Aktivieren Sie die Dimension, oder entfernen Sie die Zeile.
- **„... is already on row N.“**: Zwei Zeilen tragen denselben Namen für dieselbe Dimension. Behalten Sie eine.
- **„Invalid status '...'. Use 'enabled' or 'disabled'.“**: Korrigieren Sie die Zelle `status`.
- **„Status is enabled but the end of validity has passed. Clear the date or set the status to disabled. If the file comes from an older export, export the data again.“**: Die Zeile ist aktiviert, aber ihr Datum ist bereits vorbei. Eine vor diesem Datum exportierte Datei enthält noch `enabled`: Exportieren Sie erneut oder korrigieren Sie die Zelle.
- **„Status is disabled but the end of validity is still to come. Set the status to enabled or set a date that has passed.“**: Die Zeile ist deaktiviert, aber ihr Datum liegt noch in der Zukunft. Korrigieren Sie die Zelle `status` oder `disabled_at`.
- **„Header mismatch“**: Laden Sie eine neue Vorlage herunter.

---

## Berechtigungen

| Stufe | Was sie erlaubt |
|---|---|
| `analytics:reader` | Die Seite Analysedimensionen ansehen und Dimensionen und Werte öffnen |
| `analytics:member` | Dimensionen und Werte erstellen und bearbeiten |
| `analytics:admin` | Alles oben Genannte, dazu CSV-Import und -Export sowie Löschen |

Die integrierte Rolle Budget-Administrator ist admin, Budget-Mitglied ist member und Budget-Leser ist reader. Wer OPEX, CAPEX oder Reporting lesen kann, sieht die Dimensionen und ihre Werte auf Budgetzeilen, in den Listen und in den Berichten, ohne Zugriff auf diese Seite zu haben.

---

## Tipps

- **Halten Sie es einfach**: Wenige Dimensionen mit jeweils 5 bis 10 breiten Werten zeigen meist mehr als Dutzende detaillierter Werte.
- **Eine Frage pro Dimension**: Jede Dimension sollte eine Frage zu den Ausgaben beantworten, etwa „Welche Art von Ausgabe ist das?“ oder „Welchem Programm dient sie?“.
- **Dokumentieren Sie mit Beschreibungen**: Eine kurze Beschreibung trägt viel zu einer einheitlichen Verwendung über Teams hinweg bei.
- **Lassen Sie Lücken zu, wenn nötig**: „Nicht zugeordnet“ ist ein gültiger Zustand. Vermeiden Sie vage Sammelwerte, nur um die Lücke zu füllen.
- **Deaktivieren statt löschen**: Einen Wert außer Dienst zu stellen hält die Berichte korrekt.
- **Verfeinern Sie mit Berichten**: Führen Sie den Bericht Analysedimensionen von Zeit zu Zeit aus. Erfasst ein Wert zu viele oder zu wenige Ausgaben, teilen Sie ihn auf oder führen Sie ihn mit einem anderen zusammen.

---

## Häufig gestellte Fragen

**Kann eine Zeile mehrere Analysewerte haben?**
Ja, einen pro Dimension. Eine Zeile kann **Licenses** in Nature und **Workplace** in Program sein. Innerhalb einer Dimension hat eine Zeile einen Wert oder keinen.

**Wirken sich Analysedimensionen auf Zuordnungen oder die Buchhaltung aus?**
Nein. Sie dienen nur dem Reporting und haben keinen Einfluss auf Kostenzuordnungen oder die formale Buchhaltung.

**Wie viele Werte sollte ich anlegen?**
Beginnen Sie mit 5 bis 10 pro Dimension. Mehr als 20 bedeutet meist, dass die Dimension zu viele Fragen beantworten will: Teilen Sie sie in zwei Dimensionen auf.

**Was ist der Unterschied zwischen Analysedimensionen, Abteilungen und Kostenstellen?**
**Abteilungen** sind formale Organisationseinheiten mit präzisen Zuordnungsschlüsseln. **Kostenstellen** geben an, wer für die Ausgaben verantwortlich ist und einsteht. **Analysedimensionen** sind freie, optionale Klassifizierungen für das Reporting, ohne Zuordnung oder Verantwortung.

**Warum zeigen manche Zeilen „Nicht zugeordnet“?**
Im Bericht Analysedimensionen erscheinen Zeilen ohne Wert in der gewählten Dimension als „Nicht zugeordnet“. Das ist so vorgesehen: Werte sind optional.

**Was passiert mit den Zeilen, wenn ich einen Wert oder eine Dimension umbenenne?**
An den Zeilen ändert sich nichts. Listen und Berichte zeigen den neuen Namen sofort.
