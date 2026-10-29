# Analysedimensionen

Analysedimensionen klassifizieren Ihr IT-Budget für das Reporting, außerhalb Ihrer Buchhaltungsstruktur. Sie wählen eigene Blickwinkel auf das Budget, etwa die Art der Ausgabe oder das Programm, dem sie dient, ohne Unternehmen, Abteilungen, Konten oder Kostenstellen umzubauen.

## Dimensionen und Werte

Eine **Dimension** ist eine Art, Budgetzeilen zu klassifizieren, zum Beispiel **Kostenart** oder **IT-Bereich**. Ihre **Werte** sind die Auswahlmöglichkeiten, die sie bietet, zum Beispiel **Hardware**, **Software** und **Externe Dienstleistungen** für Kostenart.

- Jede Dimension hat ihre eigene Werteliste.
- Jede OPEX- und CAPEX-Zeile kann einen Wert pro Dimension tragen. Eine Zeile kann gleichzeitig **Software** in Kostenart und **Anwendung** in IT-Bereich sein.
- Eine Zeile kann in einer Dimension auch keinen Wert haben. Berichte zeigen diese Zeilen als „Nicht zugeordnet“.
- Eine als **Erforderlich** markierte Dimension verlangt einen Wert auf jeder neuen Zeile. Siehe [Erforderliche Dimensionen](#erforderliche-dimensionen).

Zum Beispiel:

```
Kostenart                   IT-Bereich
  Hardware                    Rechenleistung
  Software                    Anwendung
  Externe Dienstleistungen    Arbeitsplatz
```

### Die Standarddimension

Jeder Arbeitsbereich hat eine Standarddimension. In einem neuen Arbeitsbereich ist es die **Kostenart**. Ohne Namen erscheint sie als **Analysedimension**, in der Sprache jeder Person. Hatte Ihr Arbeitsbereich bereits Analysewerte, gehören sie zu dieser Dimension, und jede Zeile behält ihren Wert.

Die Standarddimension hat eine besondere Rolle:

- Sie gilt immer für OPEX- und CAPEX-Zeilen: Ihr Feld **Verwendet für** ist gesperrt. Siehe [OPEX- oder CAPEX-Dimensionen](#opex-oder-capex-dimensionen).
- Sie kann weder deaktiviert noch gelöscht werden. Ihr Arbeitsbereich hat keine Schaltfläche **Löschen**, und eine Zeile unter **Lebenszyklus** nennt den Grund: „Diese Dimension kann weder deaktiviert noch gelöscht werden: Ältere Dateien und Fragen an die KI verwenden sie.“
- Fragen an Plaid zur Analysekategorie verwenden sie. Siehe [Analysedimensionen in Plaid](#analysedimensionen-in-plaid). In einer Budgetdatei hat jede Dimension ihre eigene Spalte, die Standarddimension eingeschlossen: Siehe [Ein Budget aus einer Tabellenkalkulation laden](budget-file.md).
- Sie bleibt die Standarddimension, wenn Sie sie umbenennen, ihren Code ändern oder sie in der Reihenfolge der Dimensionen verschieben.
- Ihre Bezeichnung ist reserviert: Keine andere Dimension kann „Analysedimension“ heißen, und das gilt für jede Sprache der App.

### Empfohlene Dimensionen

Ein neuer Arbeitsbereich beginnt mit vier empfohlenen Dimensionen und ihren Werten, in der Sprache des Arbeitsbereichs. Sie sind aktiviert, gelten für OPEX- und CAPEX-Zeilen, und keine ist erforderlich:

| Dimension | Code | Werte, in Reihenfolge |
|---|---|---|
| **Kostenart** | `default` | Hardware, Software, Internes Personal, Externes Personal, Externe Dienstleistungen, Gebäude und Energie, Telekommunikation, Sonstiges |
| **IT-Bereich** | `it_tower` | Rechenzentrum, Rechenleistung, Speicher, Netzwerk, Plattform, Druck, Arbeitsplatz, Anwendung, Betrieb und Support, Sicherheit und Compliance, IT-Management |
| **Zweck** | `purpose` | Ersatz, Kapazität, Produktivität, Sicherheit, Compliance, Wachstum, Sonstiges |
| **Priorität** | `priority` | Zwingend, Hoch, Mittel, Niedrig |

- Die Kostenart ist die Standarddimension. Kostenarten und IT-Bereiche folgen dem Modell TBM (Technology Business Management).
- Jede Dimension und jeder Wert hat eine Beschreibung, damit Ihr Team Zeilen einheitlich klassifiziert.
- Die Sprache ist die des Arbeitsbereichs: die Sprache des Browsers beim Start der Testphase oder die für eine Installation auf Ihren eigenen Servern eingestellte Sprache. Ein Zurücksetzen des Arbeitsbereichs legt sie in dieser Sprache neu an.
- Sie funktionieren wie jede andere Dimension. Sie können sie und ihre Werte umbenennen, Werte hinzufügen, die Reihenfolge ändern, eine davon erforderlich machen, sie deaktivieren oder löschen.

**Einem bestehenden Arbeitsbereich hinzufügen**: Klicken Sie in der Auswahlleiste auf **Empfohlene Dimensionen** (erfordert `analytics:admin`). Der Dialog **Empfohlene Dimensionen hinzufügen** listet die vier Dimensionen auf, dazu **Wiederkehr** (Wiederkehrend oder Einmalig), jede mit einer kurzen Beschreibung.

- Die Dimensionen, die dem Arbeitsbereich fehlen, sind anfangs angekreuzt, außer **Wiederkehr**. Eine bereits vorhandene Dimension ist ausgegraut und als **Bereits vorhanden** markiert, mit ihrem Namen im Arbeitsbereich, zum Beispiel **Bereits vorhanden (Investment type)**: Eine ältere Dimension **Investment type** steht für den Zweck.
- **Sprache der Namen** beginnt bei Ihrer Bildschirmsprache.
- Klicken Sie auf **Hinzufügen**. Eine Meldung nennt, was angelegt wurde, zum Beispiel „3 Dimensionen hinzugefügt: Kostenart, IT-Bereich, Zweck.“
- Die Kostenart kommt auf die Standarddimension, wenn diese weder einen Namen noch Werte hat. Andernfalls wird sie als neue Dimension mit dem Code `cost_pool` angelegt.
- Trägt eine andere Dimension bereits den Namen, erhält die neue eine Nummer, zum Beispiel **Priorität (2)**.
- Das [Audit-Protokoll](admin.md#audit-protokoll) erfasst jede angelegte Dimension und jeden angelegten Wert.

**Arbeitsbereiche, die vor den empfohlenen Dimensionen angelegt wurden**, behalten drei Dimensionen zur Klassifizierung von CAPEX-Zeilen, die für **Nur CAPEX** gelten, erforderlich und aktiviert sind: **PP&E type** (`ppe_type`: Hardware, Software), **Investment type** (`investment_type`: Replacement, Capacity, Productivity, Security, Conformity, Business growth, Other) und **Priority** (`priority`: Mandatory, High, Medium, Low). Ihre Namen und Werte sind englisch. Sie funktionieren wie jede andere Dimension.

Der Code einer Dimension benennt ihre Spalte in der Budgetdatei, zum Beispiel `analytics:it_tower`. Wenn Sie einen Code ändern, trägt eine vor der Änderung exportierte Datei noch den alten Spaltennamen und wird mit „Unknown dimension“ abgelehnt. Exportieren Sie eine neue Datei. Siehe [Ein Budget aus einer Tabellenkalkulation laden](budget-file.md).

---

## Erste Schritte

Navigieren Sie zu **Stammdaten > Analysedimensionen** (im Abschnitt **Finanzen**).

1. **Prüfen Sie die empfohlenen Dimensionen**: Ein neuer Arbeitsbereich hat bereits **Kostenart**, **IT-Bereich**, **Zweck** und **Priorität**, mit ihren Werten. Wählen Sie eine in der Auswahlleiste aus, um ihre Werte zu sehen. Benennen Sie einen Wert um, fügen Sie einen hinzu oder deaktivieren Sie die, die Sie nicht brauchen. Ein älterer Arbeitsbereich kann sie mit **Empfohlene Dimensionen** hinzufügen. Siehe [Empfohlene Dimensionen](#empfohlene-dimensionen).
2. **Benennen Sie die Standarddimension**, wenn sie noch „Analysedimension“ zeigt: Wählen Sie sie in der Auswahlleiste aus, klicken Sie auf **Bearbeiten** und geben Sie dann in ihrem Arbeitsbereich einen Namen ein.
3. **Fügen Sie eine Dimension hinzu**, wenn Sie das Budget aus einem weiteren Blickwinkel lesen möchten: Klicken Sie in der Auswahlleiste auf **Neu** und fügen Sie dann mit **Neuer Wert** ihre Werte hinzu.

**Tipp**: Beginnen Sie mit einigen Dimensionen und jeweils 5 bis 10 Werten. Eine einheitliche Benennung macht die Listen übersichtlicher.

---

## Die Seite Analysedimensionen

### Dimensionsauswahl

Unter dem Titel zeigt ein graues Band Ihre Dimensionen in ihrer Reihenfolge, mit je einer quadratischen Schaltfläche. Es sieht aus wie die Auswahl der Kontenpläne und funktioniert genauso. Eine deaktivierte Dimension ist als **Deaktiviert** markiert. Eine Dimension, die nur für eine Zeilenart gilt, ist als **Nur OPEX** oder **Nur CAPEX** markiert. Jede Schaltfläche zeigt den vollständigen Namen ihrer Dimension. Bei vielen Dimensionen umbrechen die Schaltflächen auf mehrere Reihen, und die Aktionen bleiben rechts in der ersten Reihe. Auf einem schmalen Bildschirm stehen die Aktionen in einer eigenen Reihe.

- Klicken Sie auf eine Schaltfläche, um die Werte dieser Dimension aufzulisten. Die ausgewählte Schaltfläche ist gefüllt. Die Seitenadresse speichert Ihre Wahl, sodass ein gespeicherter Link mit derselben Dimension öffnet. Ohne Wahl öffnet die Seite mit der Standarddimension.
- Rechts im Band öffnet **Bearbeiten** den Arbeitsbereich der ausgewählten Dimension. Wenn Sie Dimensionen nur lesen dürfen, heißt die Schaltfläche **Öffnen**.
- **Neu** daneben erstellt eine Dimension (erfordert `analytics:member`).
- **Empfohlene Dimensionen** fügt die empfohlenen Dimensionen hinzu, die dem Arbeitsbereich fehlen (erfordert `analytics:admin`). Siehe [Empfohlene Dimensionen](#empfohlene-dimensionen).
- **Neu ordnen** legt die Reihenfolge der Dimensionen fest (erfordert `analytics:member`). Die Schaltfläche ist deaktiviert, solange es nur eine Dimension gibt. Siehe [Dimensionen ordnen](#dimensionen-ordnen).

Mit einer einzigen Dimension zeigt das Band eine Schaltfläche und die Werte.

### Werteliste

Die Liste zeigt die Werte der ausgewählten Dimension in der Reihenfolge der Dimension. Siehe [Werte ordnen](#werte-ordnen).

**Spalten**:

| Spalte | Was sie zeigt |
|---|---|
| **Reihenfolge** | Die Position des Werts in seiner Dimension. Auch deaktivierte Werte haben eine Position, daher können Nummern fehlen, wenn die Liste sie ausblendet |
| **Name** | Der Name des Werts |
| **Beschreibung** | Was der Wert abdeckt |
| **Status** | **Aktiviert** oder **Deaktiviert** |
| **Verwendet für** | **OPEX und CAPEX**, **Nur OPEX** oder **Nur CAPEX**. Siehe [OPEX- oder CAPEX-Werte](#opex-oder-capex-werte) |
| **Aktualisiert** | Datum und Uhrzeit der letzten Änderung |

Klicken Sie auf eine beliebige Zelle, um den Arbeitsbereich des Werts zu öffnen.

**Filtern**:

- **Schnellsuche**: durchsucht den Namen und die Beschreibung
- **Statusfilter**: der Filter der Spalte **Status** zeigt die Auswahl von **Anzeigen** (**Alle**, **Aktiv** oder **Deaktiviert**): Eine Änderung an einem ändert auch das andere
- **Filter Verwendet für**: ein Kontrollkästchen-Filter auf der Spalte **Verwendet für**
- **Statusbereich**: der Umschalter **Anzeigen: Alle / Aktiv / Deaktiviert** über der Liste. Standardmäßig zeigt die Liste aktivierte Werte

**Aktionen**:

- **Neuer Wert**: einen Wert in der ausgewählten Dimension erstellen (erfordert `analytics:member`). Solange die ausgewählte Dimension deaktiviert ist, ist die Schaltfläche deaktiviert, und ihr Tooltip lautet „Aktivieren Sie diese Dimension, um Werte hinzuzufügen.“
- **Neu ordnen**: die Reihenfolge der Werte der ausgewählten Dimension festlegen (erfordert `analytics:member`). Die Schaltfläche ist deaktiviert, solange die Dimension weniger als zwei Werte hat. Siehe [Werte ordnen](#werte-ordnen)
- **Importieren**: Werte aus einer Datei laden (erfordert `analytics:admin`)
- **Exportieren**: die Werte der Liste herunterladen, oder die Werte aller Dimensionen (erfordert `analytics:admin`)
- **Auswahl löschen**: die ausgewählten Werte löschen (erfordert `analytics:admin`). Werden einige davon von Budgetzeilen verwendet, nennt die Bestätigung, wie viele Zeilen sie verlieren, zum Beispiel „2 ausgewählte Werte werden verwendet: Sie werden aus 5 Budgetzeilen entfernt. Diese Daten können nicht wiederhergestellt werden.“, und die Schaltfläche heißt **Trotzdem löschen**

---

## Dimensionen

### Eine Dimension erstellen

Klicken Sie in der Auswahlleiste auf **Neu**, füllen Sie die Felder aus und klicken Sie dann auf **Erstellen**. Der Arbeitsbereich der neuen Dimension öffnet sich. Eine neue Dimension ist aktiviert.

- **Name** ist Pflicht.
- **Code** wird aus dem Namen vorgeschlagen: Kleinbuchstaben, ohne Akzente, Leerzeichen durch `-` ersetzt. Sie können ihn ändern, bevor Sie die Dimension erstellen.
- **Verwendet für** beginnt mit **OPEX und CAPEX**. Siehe [OPEX- oder CAPEX-Dimensionen](#opex-oder-capex-dimensionen).
- **Erforderlich** ist zu Beginn ausgeschaltet. Siehe [Erforderliche Dimensionen](#erforderliche-dimensionen).
- **Beschreibung** ist optional.

Eine neue Dimension kommt in der Reihenfolge der Dimensionen an die letzte Stelle. Kehren Sie dann zur Seite zurück, um ihre Werte hinzuzufügen.

### Der Dimensions-Arbeitsbereich

Öffnen Sie ihn mit **Bearbeiten** (**Öffnen**, wenn Sie nur lesen dürfen) in der Auswahlleiste, bei ausgewählter Dimension. Die Schaltfläche **Verlauf** in der Kopfzeile öffnet den Verlauf der Dimension in einem Seitenbereich. Siehe [Verlauf der Datensätze](record-history.md).

- **Kopfzeile**: der Name der Dimension. Klicken Sie darauf, um die Dimension umzubenennen. **Zurück** / **Weiter** bewegen sich durch die Dimensionen in ihrer Reihenfolge, und die Schließen-Schaltfläche führt zur Seite mit dieser Dimension zurück
- **Hauptbereich**: eine Nutzungszeile, dann die **Beschreibung**. Die Nutzungszeile nennt die Anzahl der Werte und der Budgetzeilen, die einen davon tragen, OPEX und CAPEX zusammen, zum Beispiel „12 Werte · Verwendet von 29 Zeilen“. **Verwendet von 29 Zeilen** ist ein Link: Er öffnet diese Zeilen in der Liste der Budgetzeilen, in einem neuen Tab, aktivierte und deaktivierte Zeilen eingeschlossen. Eine Dimension, die keine Zeile verwendet, zeigt „Noch nicht verwendet“, eine ohne Werte „Noch keine Werte.“ Solange die Dimension deaktiviert ist, erscheint die Anzahl ohne Link
- **Bereich Eigenschaften** rechts: **Name**, **Code**, **Verwendet für**, **Erforderlich**, **Offene Werte** und **Lebenszyklus**

**Automatisches Speichern**: Jede Änderung wird von selbst gespeichert. Es gibt keine Schaltfläche zum Speichern. Textfelder werden gespeichert, wenn Sie sie verlassen (drücken Sie in **Name** und **Code** Enter, um sofort zu speichern); der Schalter **Erforderlich** und der Lebenszyklus werden gespeichert, sobald Sie sie ändern. Wird eine Änderung abgelehnt, erscheint der Grund unter dem Feld, das sie verursacht hat, zum Beispiel ein doppelter Code unter **Code**. Ein in der Kopfzeile abgelehnter Name wird oben auf der Seite angezeigt.

### Felder einer Dimension

| Feld | Was Sie eingeben |
|---|---|
| **Name** | Bis zu 200 Zeichen. Namen sind unabhängig von Groß- und Kleinschreibung eindeutig. Pflicht, außer bei der Standarddimension: Lassen Sie ihn dort leer, um „Analysedimension“ in der Sprache jeder Person anzuzeigen. Die Bezeichnung der Standarddimension ist in jeder Sprache der App reserviert („Analytics dimension“, „Dimension analytique“, „Analysedimension“, „Dimensión analítica“), unabhängig von Groß- und Kleinschreibung: Eine andere Dimension mit einem dieser Namen wird mit „This name is reserved for the default dimension.“ abgelehnt |
| **Code** | 1 bis 40 Zeichen: Kleinbuchstaben, Ziffern, `-` oder `_`, beginnend mit einem Buchstaben oder einer Ziffer. Jeder Code ist eindeutig. Der Code benennt die Spalte der Dimension in den OPEX- und CAPEX-Dateien, sodass eine Änderung des Codes diesen Spaltennamen ändert. Budgetzeilen behalten ihre Werte, wenn sich der Code ändert |
| **Beschreibung** | Wofür die Dimension da ist, damit Teammitglieder Zeilen einheitlich klassifizieren |
| **Verwendet für** | **OPEX und CAPEX**, **Nur OPEX** oder **Nur CAPEX**. Legt fest, welche Budgetzeilen einen Wert in dieser Dimension haben können. Siehe [OPEX- oder CAPEX-Dimensionen](#opex-oder-capex-dimensionen). Bei der Standarddimension gesperrt, mit einer Zeile darunter: „Die Standarddimension gilt für OPEX- und CAPEX-Zeilen.“ |
| **Erforderlich** | Ein Schalter. Ist er eingeschaltet, braucht jede neue Zeile der Arten, für die die Dimension verwendet wird, einen Wert in ihr, und eine Zeile mit einem Wert kann ihn nicht mehr verlieren. Siehe [Erforderliche Dimensionen](#erforderliche-dimensionen). Auch die Standarddimension kann erforderlich sein |
| **Offene Werte** | Ein Schalter, standardmäßig aus. Ist er eingeschaltet, kann jede Person, die eine Zeile bearbeiten kann, einen Wert hinzufügen, über die Zeile oder die Budgetdatei. Siehe [Offene Werte](#open-values) |
| **Lebenszyklus** | Der Statusschalter, dessen Beschriftung den aktuellen Zustand zeigt (**Aktiviert** oder **Deaktiviert**), und das Datum **Ende der Gültigkeit**. Siehe [Status und Lebenszyklus](#status-und-lebenszyklus). Bei der Standarddimension gesperrt, mit einer Zeile darunter: „Diese Dimension kann weder deaktiviert noch gelöscht werden: Ältere Dateien und Fragen an die KI verwenden sie.“ |

### Dimensionen ordnen

Die Dimensionen haben eine Reihenfolge, die Sie festlegen. KANAP zeigt sie in dieser Reihenfolge:

- in der Auswahlleiste dieser Seite
- im Bereich **Eigenschaften** von OPEX- und CAPEX-Zeilen
- in den Spalten der Liste der Budgetzeilen
- in den Spalten der Budgetdatei
- in den Berichtsfiltern und in der Dimensionsauswahl des Berichts
- in den Dimensionen, die Plaid auflistet

Eine neue Dimension kommt an die letzte Stelle.

So ändern Sie die Reihenfolge:

1. Klicken Sie in der Auswahlleiste auf **Neu ordnen**. Der Dialog listet alle Dimensionen, auch deaktivierte und solche für nur eine Zeilenart, jeweils mit ihren Vermerken (**Standard**, **Deaktiviert**, **Nur OPEX**, **Nur CAPEX**).
2. Ziehen Sie die Dimensionen an ihren Platz, mit der Maus oder mit der Tastatur. Die Tasten sind dieselben wie bei den Werten: Siehe [Werte ordnen](#werte-ordnen).
3. Klicken Sie auf **Speichern**. **Abbrechen** lässt die Reihenfolge, wie sie war.

Die neue Reihenfolge erscheint sofort. Das [Audit-Protokoll](admin.md#audit-protokoll) erfasst eine Änderung für jede verschobene Dimension, mit ihrer Position vorher und nachher.

### OPEX- oder CAPEX-Dimensionen

Das Feld **Verwendet für** legt fest, für welche Budgetzeilen die Dimension gilt:

| Wert | Bedeutung |
|------|-----------|
| **OPEX und CAPEX** | OPEX- und CAPEX-Zeilen können beide einen Wert in der Dimension haben. Das ist die Standardeinstellung |
| **Nur OPEX** | Nur OPEX-Zeilen können einen Wert haben |
| **Nur CAPEX** | Nur CAPEX-Zeilen können einen Wert haben |

OPEX-Ansichten zeigen die für OPEX-Zeilen verwendeten Dimensionen, CAPEX-Ansichten die für CAPEX-Zeilen verwendeten. Das betrifft den Bereich **Eigenschaften** der Budgetzeile, die Spalten, Filter und die Schnellsuche der Listen, die Dimensionsauswahl und die Dimensionsfilter der Berichte (sie folgen der Auswahl **OPEX** / **CAPEX** des Berichts) sowie Plaid. Die Budgetdatei hat eine Spalte für jede aktivierte Dimension, und jede Zeile nimmt nur in den Dimensionen ihrer Zeilenart Werte an.

Eine Zeile behält den Wert, den sie bereits in einer Dimension hat, die für ihre Zeilenart nicht mehr gilt. Der Wert ist überall ausgeblendet und erscheint wieder, wenn Sie die Dimension erneut für diese Zeilenart öffnen. Blendet Ihre Einstellung Werte aus, erscheint unter dem Feld ein Hinweis, zum Beispiel „8 CAPEX-Zeilen haben einen Wert für diese Dimension. Sie behalten ihn, ausgeblendet, solange die Dimension nur für OPEX-Zeilen gilt.“

Einer Zeile einen Wert in einer Dimension zu geben, die nicht für sie gilt, wird abgelehnt: in der Anwendung, in einer Budgetdatei und über die API. In der Anwendung und über die API ändert sich nichts, wenn der Wert gesendet wird, den die Zeile bereits hat. Lassen Sie diese Zelle in einer Budgetdatei leer: Der Export tut das auch.

Auch ein einzelner Wert kann auf eine Zeilenart beschränkt werden. Die beiden Einstellungen wirken auf verschiedenen Ebenen. Zum Beispiel gilt die Dimension **Kostenart** für **OPEX und CAPEX**, und ihr Wert **Internes Personal** gilt nur für **Nur OPEX**:

- Die Einstellung der Dimension legt fest, ob das Feld für eine Zeilenart existiert. Fällt das Feld weg, sind die Werte ausgeblendet, die die Zeilen haben.
- Die Einstellung des Werts filtert die Auswahl. Das Feld bleibt, CAPEX-Zeilen bieten **Internes Personal** nicht mehr an, und eine CAPEX-Zeile, die ihn bereits hat, behält ihn, zeigt ihn an und bleibt bearbeitbar. Siehe [OPEX- oder CAPEX-Werte](#opex-oder-capex-werte).

Die beiden Einstellungen müssen zusammenpassen. Eine Dimension kann nicht auf eine Zeilenart beschränkt werden, solange einige ihrer Werte nur für die andere gelten: KANAP lehnt dies ab und nennt die Werte (höchstens drei, dann „and N more“), zum Beispiel „2 values of this dimension are for CAPEX lines only (Hardware, Software). Set them to OPEX and CAPEX first.“

### Erforderliche Dimensionen

Schalten Sie **Erforderlich** ein, wenn jede Budgetzeile in einer Dimension klassifiziert sein muss. KANAP prüft dann die Zeilen der Arten, für die die Dimension verwendet wird:

- **Eine neue Zeile braucht einen Wert in der Dimension.** Das gilt für jeden Weg, eine Zeile anzulegen: die OPEX- und CAPEX-Bildschirme, eine Budgetdatei, Plaid und die API. Ohne Wert wird die Zeile nicht angelegt, mit der Meldung „The Kostenart dimension is required. Choose a value.“
- **Eine Zeile mit einem Wert kann ihn nicht verlieren.** Sie können einen anderen Wert wählen. Das Feld kann nicht geleert werden.
- **Eine Zeile, die vor dem Einschalten angelegt wurde, funktioniert weiter.** Hat sie keinen Wert in der Dimension, bleibt sie bearbeitbar, und Sie können andere Änderungen an ihr speichern. Ihr Feld ist als erforderlich markiert. In den OPEX- und CAPEX-Bildschirmen fragt KANAP beim Verlassen einer solchen Zeile nach einer Änderung zuerst nach einem Wert, mit **Bleiben** und **Trotzdem verlassen**. Wird sie nur geöffnet, ohne etwas zu ändern, fragt KANAP nie.

Die Einstellung wird nur geprüft, solange die Dimension aktiviert ist. Eine deaktivierte Dimension behält ihre Einstellung, und eine Zeile unter dem Schalter sagt „Wird nicht geprüft, solange die Dimension deaktiviert ist.“ Eine Dimension, die nur für eine Zeilenart verwendet wird, wird nur bei dieser Art geprüft: Eine erforderliche Dimension mit **Nur OPEX** verlangt nichts von CAPEX-Zeilen.

Solange die Einstellung eingeschaltet ist, helfen Ihnen Zeilen unter dem Schalter, die bestehenden Zeilen zu vervollständigen:

- **Zeilen ohne Wert**: zum Beispiel „117 OPEX-Zeilen und 15 CAPEX-Zeilen haben keinen Wert.“ Jede Zeilenart hat ihren eigenen Link, **OPEX-Zeilen anzeigen** und **CAPEX-Zeilen anzeigen** (**Diese Zeilen anzeigen**, wenn nur eine Art betroffen ist). Der Link öffnet die Zeilen in ihrer Liste, in einem neuen Tab, aktivierte und deaktivierte Zeilen eingeschlossen.
- **Kein Wert zur Auswahl**: Hat eine Zeilenart, für die die Dimension verwendet wird, keinen aktivierten Wert, den sie verwenden kann, weist eine Warnung darauf hin, zum Beispiel „Kein aktivierter Wert ist für CAPEX-Zeilen verwendbar. Neue CAPEX-Zeilen können nicht angelegt werden.“ Fügen Sie einen Wert für diese Zeilenart hinzu, oder aktivieren Sie einen. Siehe [OPEX- oder CAPEX-Werte](#opex-oder-capex-werte).

### Offene Werte { #open-values }

Eine Dimension mit eingeschaltetem **Offene Werte** erhält neue Werte aus den Zeilen selbst: eine Budgetreferenz, einen Projektcode, eine Bestellnummer. Im Feld einer Zeile bietet die Eingabe eines nicht vorhandenen Namens **„…“ hinzufügen** an, das den Wert anlegt. Die Budgetdatei legt ihn auf dieselbe Weise an. Jede Person, die die Zeile bearbeiten kann, tut das, auch Personen mit begrenztem [Datenzugriff](data-access.md).

Bei einer Dimension mit ausgeschaltetem Schalter werden Werte auf dieser Seite angelegt, und die Budgetdatei legt unbekannte Werte nur für Personen mit Zugriff auf alle Daten an. Der Schalter ist für Personen sichtbar, die Dimensionen bearbeiten können und Zugriff auf alle Daten haben.

### Eine Dimension löschen

Die Schaltfläche **Löschen** (Papierkorbsymbol) in der Kopfzeile löscht die Dimension mit ihren Werten (erfordert `analytics:admin`):

- Eine Dimension ohne Werte fragt zuerst („Dies kann nicht rückgängig gemacht werden.“), dann **Löschen**.
- Eine Dimension, deren Werte keine Zeile verwendet, fragt zuerst, zum Beispiel „Wiederkehr löschen?“ mit „Ihre 2 Werte werden ebenfalls gelöscht.“, dann **Löschen**.
- Eine von Budgetzeilen verwendete Dimension fragt zuerst, mit der Anzahl der Zeilen: „Ihre 3 Werte werden gelöscht, und sie wird aus 6 Budgetzeilen entfernt. Diese Daten können nicht wiederhergestellt werden.“ Klicken Sie auf **Trotzdem löschen**, um fortzufahren. Die Zeilen verlieren ihren Wert in dieser Dimension, und ihr Verlauf erfasst die Änderung.

Die Standarddimension hat keine Schaltfläche **Löschen**: Sie kann nicht gelöscht werden. Das [Audit-Protokoll](admin.md#audit-protokoll) erfasst die gelöschte Dimension mit der Anzahl ihrer Werte und Zeilen, jeden gelöschten Wert und jede Zeile, die einen Wert verloren hat.

Um die Werte stattdessen auf den Zeilen zu behalten, deaktivieren Sie die Dimension.

---

## Werte

### Einen Wert erstellen

Klicken Sie auf **Neuer Wert**. Das Feld **Dimension** steht zunächst auf der Dimension, die auf der Seite ausgewählt ist, und bietet nur aktivierte Dimensionen an. Füllen Sie **Name** und bei Bedarf **Beschreibung** aus. **Verwendet für** steht zunächst auf **OPEX und CAPEX**: Ändern Sie es, wenn der Wert nur zu einer Zeilenart passt. Klicken Sie dann auf **Erstellen**. Der Arbeitsbereich des neuen Werts öffnet sich. Ein neuer Wert ist aktiviert.

### Der Werte-Arbeitsbereich

- **Kopfzeile**: der Name des Werts. Klicken Sie darauf, um den Wert umzubenennen. **Zurück** / **Weiter** bewegen sich durch die Werte derselben Dimension, in der aktuellen Reihenfolge und mit den aktuellen Filtern der Liste. Die Schließen-Schaltfläche führt zur Liste zurück
- **Hauptbereich**: eine Nutzungszeile, dann die **Beschreibung**. Die Nutzungszeile zählt die Budgetzeilen, die den Wert tragen, OPEX und CAPEX zusammen, zum Beispiel „Verwendet von 4 Zeilen“. Sie ist ein Link, der diese Zeilen in der Liste der Budgetzeilen in einem neuen Tab öffnet. Ein Wert, den keine Zeile verwendet, zeigt „Noch nicht verwendet“. Solange die Dimension deaktiviert ist, erscheint die Anzahl ohne Link
- **Bereich Eigenschaften** rechts: **Dimension** (schreibgeschützt), **Verwendet für** und **Lebenszyklus**

Die Schaltfläche **Verlauf** in der Kopfzeile öffnet den Verlauf des Werts in einem Seitenbereich. Siehe [Verlauf der Datensätze](record-history.md).

Änderungen werden von selbst gespeichert, wie im Dimensions-Arbeitsbereich. Ein in der Kopfzeile abgelehnter Name wird oben auf der Seite angezeigt.

### Regeln für Werte

- **Eine Liste pro Dimension**: Namen sind innerhalb einer Dimension eindeutig, unabhängig von Groß- und Kleinschreibung. Zwei Dimensionen können jeweils einen Wert namens „Sonstiges“ haben. Ein doppelter Name wird abgelehnt, zum Beispiel „A value named Software already exists in Kostenart.“
- **Ein Wert bleibt in seiner Dimension**: Die Dimension wird beim Erstellen des Werts festgelegt und kann sich nicht ändern. Um einen Wert zu verschieben, erstellen Sie ihn in der anderen Dimension, ändern Sie die Zeilen und löschen Sie dann den alten Wert.
- **Umbenennen behält die Zeilen**: Zeilen verweisen auf den Wert selbst, daher erscheint der neue Name sofort in Listen und Berichten.
- **Löschen**: Die Schaltfläche **Löschen** (Papierkorbsymbol) in der Kopfzeile löscht einen Wert, den keine Zeile verwendet, nach einer Bestätigung („Dies kann nicht rückgängig gemacht werden.“, dann **Löschen**; erfordert `analytics:admin`). Verwenden Budgetzeilen den Wert, fragt sie zuerst: „Er wird aus 4 Budgetzeilen entfernt. Diese Daten können nicht wiederhergestellt werden.“ Klicken Sie auf **Trotzdem löschen**, um fortzufahren, oder deaktivieren Sie den Wert stattdessen, um ihn auf den Zeilen zu behalten.

### Werte ordnen

Die Werte einer Dimension haben eine Reihenfolge, die Sie festlegen. KANAP bietet die Werte überall in dieser Reihenfolge an, wo Sie sie auswählen oder danach filtern:

- die Wertefelder von OPEX- und CAPEX-Zeilen (wenn Sie in ein Feld tippen, stehen die besten Treffer zuerst)
- die Kontrollkästchen-Filter der Dimension in der Liste der Budgetzeilen
- die Dimensionsfilter der Berichte und die Liste **Werte ausschließen** des Berichts Analysedimensionen
- der Export der Werte
- die Werte, die Plaid auflistet

Wenn Sie die Liste der Budgetzeilen nach der Spalte einer Dimension sortieren, folgt sie ebenfalls dieser Reihenfolge, dann dem Namen des Werts. Zeilen ohne Wert stehen bei aufsteigender Sortierung am Ende. Die Zeilen der Berichte behalten ihre eigene Reihenfolge, nach Betrag.

Anfangs stehen die Werte in alphabetischer Reihenfolge. Ein neuer Wert kommt in seiner Dimension an die letzte Stelle.

So ändern Sie die Reihenfolge:

1. Wählen Sie die Dimension auf der Seite aus und klicken Sie auf **Neu ordnen**. Der Dialog listet alle Werte der Dimension, auch deaktivierte und solche für nur eine Zeilenart, jeweils mit ihrem Vermerk (**Deaktiviert**, **Nur OPEX**, **Nur CAPEX**).
2. Ziehen Sie die Werte mit der Maus an ihren Platz. Mit der Tastatur gehen Sie zu einem Wert, drücken Leertaste oder Eingabe, um ihn aufzunehmen, verschieben ihn mit den Pfeiltasten und drücken dann Leertaste oder Eingabe, um ihn abzulegen. Escape setzt ihn an seinen Platz zurück.
3. Klicken Sie auf **Speichern**. **Abbrechen** lässt die Reihenfolge, wie sie war.

Die neue Reihenfolge erscheint sofort in den Listen und Filtern. Das [Audit-Protokoll](admin.md#audit-protokoll) erfasst die Änderung an der Dimension, mit der Reihenfolge vorher und nachher.

### OPEX- oder CAPEX-Werte

Das Feld **Verwendet für** eines Werts legt fest, welche Budgetzeilen ihn verwenden dürfen:

| Wert | Bedeutung |
|------|-----------|
| **OPEX und CAPEX** | OPEX- und CAPEX-Zeilen können den Wert verwenden. Das ist die Standardeinstellung |
| **Nur OPEX** | Nur OPEX-Zeilen können den Wert verwenden |
| **Nur CAPEX** | Nur CAPEX-Zeilen können den Wert verwenden |

Das Feld einer OPEX-Zeile bietet die Werte für OPEX und für beide an. Das Feld einer CAPEX-Zeile tut dasselbe für CAPEX. Eine Zeile, die bereits einen Wert der anderen Art hat, behält ihn, zeigt ihn an und bleibt bearbeitbar, wie bei einem deaktivierten Wert. Einen solchen Wert für eine andere Zeile oder beim Ändern des Werts einer Zeile zu wählen, wird abgelehnt: in der Anwendung, in einer Budgetdatei, über die API und in Plaid.

- Gilt die Dimension nur für eine Zeilenart, ist die Zeilenart, die sie ausschließt, im Feld nicht verfügbar, mit einer Zeile wie „Die Dimension IT-Bereich gilt nur für OPEX-Zeilen.“ **OPEX und CAPEX** und die eigene Zeilenart der Dimension bleiben wählbar. Ein Wert kann nicht auf die Zeilenart beschränkt werden, die seine Dimension ausschließt.
- Haben Zeilen der anderen Art den Wert, erscheint unter dem Feld eine Zeile, zum Beispiel „4 CAPEX-Zeilen haben diesen Wert. Sie behalten ihn, aber neue CAPEX-Zeilen können ihn nicht auswählen.“ Klicken Sie auf **Diese Zeilen anzeigen**, um sie in der Liste in einem neuen Tab zu öffnen. Die Zeile bleibt, solange der Konflikt besteht.
- Der Bericht Analysedimensionen bietet in seiner Liste **Werte ausschließen** die Werte der gewählten Art an. Siehe [Berichte](reports.md#analysedimensionen).

---

## Status und Lebenszyklus

Dimensionen und Werte haben jeweils einen Status (**Aktiviert** oder **Deaktiviert**) und ein optionales **Ende der Gültigkeit**. Damit stellen Sie eine Dimension oder einen Wert außer Dienst, ohne sie zu löschen.

- **Ende der Gültigkeit**: das Datum, an dem die Dimension oder der Wert endet. Lassen Sie es leer, damit sie aktiv bleiben. Sie können auch ein zukünftiges Datum planen.
- Ein Wechsel auf **Deaktiviert** setzt das Ende der Gültigkeit auf jetzt: Die Deaktivierung gilt sofort. Solange ein zukünftiges Datum gesetzt ist, zeigt der Schalter **Aktiv bis** und dieses Datum. Ein Wechsel zurück auf **Aktiviert** löscht das Datum.
- Sobald das Ende der Gültigkeit vorbei ist, wechselt der Status innerhalb einer Stunde von selbst auf **Deaktiviert**.

**Ein deaktivierter Wert**:

- Kann nicht für eine Zeile gewählt werden, weder in der App noch in einer importierten Datei noch über Plaid.
- Bleibt auf den Zeilen, die ihn bereits haben, und zählt weiterhin in den Berichten. In der Liste des Felds ist er als **Deaktiviert** markiert.

**Eine deaktivierte Dimension**:

- Wird nicht geprüft, wenn sie **Erforderlich** ist: Zeilen können ohne Wert in ihr angelegt werden. Sie behält die Einstellung für den Fall, dass Sie sie wieder aktivieren.
- Verschwindet aus den Zeilenformularen, der Liste der Budgetzeilen, den Berichtsfiltern, der Dimensionsauswahl des Berichts, den OPEX- und CAPEX-Exporten und aus Plaid. Nur die Seite Analysedimensionen zeigt sie, als **Deaktiviert** markiert.
- Behält ihre Werte auf den Zeilen. Aktivieren Sie die Dimension wieder, und die Werte erscheinen wieder.
- Nimmt keine neuen Werte auf. **Neuer Wert** ist deaktiviert, solange die Dimension ausgewählt ist, und importierte Dateien können ihre Werte weder hinzufügen noch ändern.

Die Standarddimension kann nicht deaktiviert werden.

**Deaktivieren statt löschen**: Das Deaktivieren hält die Berichte konsistent und die Listen übersichtlich.

---

## Werte auf Budgetzeilen

Im Bereich **Eigenschaften** einer OPEX- oder CAPEX-Zeile, und wenn Sie eine erstellen, hat jede aktivierte Dimension, die für diese Zeilenart verwendet wird, ein eigenes Feld, nach der Dimension benannt, in der Reihenfolge der Dimensionen. Die Standarddimension erscheint als **Analysedimension**, bis Sie sie umbenennen.

- Wählen Sie einen Wert, oder leeren Sie das Feld, um die Zeile in dieser Dimension ohne Wert zu lassen. Die Änderung wird sofort gespeichert.
- Das Feld einer erforderlichen Dimension ist mit einem Sternchen markiert. Eine neue Budgetzeile kann ohne Wert in ihr nicht angelegt werden, mit der Meldung „Kostenart ist erforderlich“. Bei einer Budgetzeile mit einem Wert hat das Feld keine Schaltfläche zum Leeren: Sie können nur einen anderen Wert wählen. Siehe [Erforderliche Dimensionen](#erforderliche-dimensionen).
- Das Feld listet die aktivierten Werte seiner Dimension, die für diese Zeilenart verwendet werden. Ein deaktivierter Wert oder ein Wert, der nur für die andere Zeilenart gilt, bleibt auf den Zeilen sichtbar, die ihn haben. Siehe [OPEX- oder CAPEX-Werte](#opex-oder-capex-werte).
- Bei einer Dimension mit [offenen Werten](#open-values) bietet das Feld **„…“ hinzufügen** für einen nicht vorhandenen Namen an. Bei den anderen Dimensionen kann das Feld keinen Wert anlegen: Legen Sie Werte auf der Seite Analysedimensionen an, oder lassen Sie sie von der Budgetdatei anlegen.
- Ein Wert gilt für die ganze Zeile, über alle Jahre.
- Können die Dimensionen nicht geladen werden, ersetzt eine Zeile diese Felder: „Die Dimensionen konnten nicht geladen werden.“

Die Liste der Budgetzeilen hat eine Spalte pro aktivierter Dimension, mit Kontrollkästchen-Filtern. Die Spalte einer Dimension, die für OPEX- oder CAPEX-Zeilen erforderlich ist, wird standardmäßig angezeigt, die anderen Spalten sind ausgeblendet. Eine von Ihnen gespeicherte Spaltenanordnung behält ihre eigene Auswahl. Siehe [Budgetzeilen](budget-lines.md).

---

## Berichte

Der Bericht **Analysedimensionen** (unter **Berichte**) zeigt, wie sich das Budget Ihrer OPEX- oder CAPEX-Zeilen auf die Werte einer Dimension verteilt. Die vollständige Beschreibung finden Sie unter [Berichte](reports.md#analysedimensionen).

- **Zeilentyp**: OPEX oder CAPEX
- **Dimension**: die Dimension, nach der der Bericht gruppiert. Sie erscheint, wenn Sie zwei oder mehr aktivierte Dimensionen haben, und steht zunächst auf der Standarddimension
- **Jahresbereich**: ein einzelnes Jahr (Kreis- oder Balkendiagramm) oder mehrere Jahre (Liniendiagramm)
- **Kennzahl**: jede Budgetspalte, die Ihre Organisation anzeigt, unter ihrem Namen. Beginnt mit der Standardspalte
- **Werte ausschließen**: einige Werte weglassen, um sich auf die anderen zu konzentrieren. Die Liste bietet die Werte an, die für den gewählten Zeilentyp verwendet werden, dazu die Werte, die die Zeilen haben

Die sieben Budgetberichte lassen sich auch auf einen Wert einer Dimension eingrenzen, mit einem Filter pro Dimension. Siehe [Filter nach Kostenstelle, Run oder Build und Analysedimensionen](reports.md#filter-nach-kostenstelle-run-oder-build-und-analysedimensionen).

---

## Analysedimensionen in Plaid

- Plaid kann OPEX-Zeilen nach jeder aktivierten Dimension filtern und gruppieren, die für OPEX-Zeilen verwendet wird, und CAPEX-Zeilen nach jeder aktivierten Dimension, die für CAPEX-Zeilen verwendet wird.
- Eine Frage zur Analysekategorie verwendet die Standarddimension, unabhängig von ihrem Namen und ihrer Reihenfolge.
- Die Suche von Plaid und die `@`-Erwähnungen im Chat finden eine Budgetzeile über den Namen eines Werts, den sie auf einer für ihren Typ angezeigten Dimension hat, mit oder ohne Akzente.
- Plaid kann den Wert einer Zeile in jeder Dimension setzen, ändern oder löschen, wenn es eine Budgetzeile anlegt oder aktualisiert. Fragen Sie zum Beispiel: „Setze die Kostenart von BL-12 auf Software.“ Plaid findet den Wert über seinen Namen in dieser Dimension und zeigt in der Vorschau die Dimension und den Wert, vorher und nachher. Nichts ändert sich, bevor Sie zustimmen.
- Plaid befolgt dieselben Regeln wie die App: nur aktivierte Dimensionen, die für den Typ der Zeile verwendet werden, nur aktivierte Werte, die für den Typ der Zeile verwendet werden, und eine Zeile behält einen Wert, den sie bereits trägt.
- Wenn Plaid eine Zeile anlegt, braucht sie einen Wert auf jeder erforderlichen Dimension des Zeilentyps. In einem Arbeitsbereich, der vor den empfohlenen Dimensionen angelegt wurde, braucht eine CAPEX-Zeile **PP&E type**, **Investment type** und **Priority**.
- Plaid weiß, welche Dimensionen erforderlich sind. Eine neue Zeile braucht in jeder von ihnen einen Wert, und Plaid kann den Wert einer erforderlichen Dimension nicht löschen. Plaid lehnt eine Anfrage ab, die gegen die Regel verstößt, und nennt den Grund, zum Beispiel „Kostenart is required for spend item creation.“
- Plaid kann auch einen Wert in der Dimension anlegen, die Sie nennen. Ohne Angabe einer Dimension kommt der Wert in die Standarddimension.
- Mit Leserecht auf Analytik liest Plaid auch die Einstellungen jeder Dimension, die Zahl ihrer Werte und die Zeilen, die sie verwenden. Fragen Sie zum Beispiel: „Welche Dimensionen sind Pflicht?“

---

## CSV-Import/Export

Der Export schreibt eine CSV-Datei oder eine Excel-Arbeitsmappe (`.xlsx`): Wählen Sie unter **Format** im Dialog. Der Import liest beides. Siehe [CSV- und Excel-Dateien](csv-files.md).

Laden oder aktualisieren Sie die Werte aller Dimensionen aus einer Datei. Dimensionen werden auf der Seite erstellt.

Um Werte auf Budgetzeilen aus einer Datei zu setzen, verwenden Sie die Budgetdatei. Darin enthält je eine Spalte `analytics:<code>` jede aktivierte Dimension, die Standarddimension eingeschlossen. Siehe [Ein Budget aus einer Tabellenkalkulation laden](budget-file.md).

**Export**: Klicken Sie auf **Exportieren** und dann auf **Daten exportieren**. Die Datei listet die Werte aller Dimensionen, aktiviert oder deaktiviert, Dimension für Dimension, die Werte jeder Dimension in ihrer Reihenfolge. Die Datei hat keine Spalte für die Reihenfolge. Für eine leere Datei nur mit den Kopfzeilen verwenden Sie **Vorlage herunterladen** im Importdialog.

**CSV-Struktur**:

- Kopfzeilen: `axis_code`, `name`, `description`, `status`, `disabled_at`, `applies_to`
- Der Export schreibt das Trennzeichen der Sprache der Oberfläche. Siehe [CSV- und Excel-Dateien](csv-files.md) für die Kodierung, das Trennzeichen, die Datumsformen und die beiden Importschritte

| Spalte | Inhalt |
|---|---|
| `axis_code` | Der Code der Dimension des Werts, unabhängig von Groß- und Kleinschreibung. Leer bedeutet die Standarddimension |
| `name` | Pflicht. Der Name des Werts |
| `description` | Freitext |
| `status` | `enabled` oder `disabled`. Leer bedeutet `enabled` für einen neuen Wert und behält bei einer Aktualisierung den gespeicherten Status |
| `disabled_at` | Das Ende der Gültigkeit: ein Datum (`2026-12-31`) oder ein vollständiges Datum mit Uhrzeit. Der Export schreibt nur das Datum. Erneut importiert, behält dieses Datum das gespeicherte Gültigkeitsende. Leer, wenn es kein Ende gibt. Bei einer Aktualisierung behalten ein leerer `status` und ein leeres `disabled_at` die gespeicherten Werte. `enabled` mit leerem Datum löscht das Ende der Gültigkeit. `disabled` mit leerem Datum behält ein bereits vergangenes Datum und beendet den Wert sonst heute |
| `applies_to` | Die Einstellung **Verwendet für**, immer die letzte Spalte. `opex`, `capex` oder leer für **OPEX und CAPEX**. Eine Datei ohne diese Spalte lässt die Einstellungen unverändert. Eine leere Zelle setzt **OPEX und CAPEX** |

Nur `name` ist eine Pflichtspalte. Fehlt die Spalte `description`, `status`, `disabled_at` oder `applies_to`, behalten bestehende Werte, was dafür gespeichert ist, und neue Werte sind aktiviert und ohne Beschreibung. Eine Datei ohne `axis_code` legt jede Zeile in die Standarddimension.

**Import**:

1. Klicken Sie auf der Seite auf **Importieren**
2. Wählen Sie Ihre Datei
3. Klicken Sie auf **Vorabprüfung**. Der Bericht nennt die Anzahl der Zeilen, die zu erstellenden und zu aktualisierenden Werte sowie die Zeilen, die nichts ändern
4. Wenn die Vorabprüfung fehlerfrei ist, klicken Sie auf **Laden**

**So funktioniert der Import**:

- **Die gesamte Datei wird geprüft, bevor etwas geschrieben wird.** Eine Datei mit einem Fehler lädt nichts: Korrigieren Sie die Zeilen und führen Sie die Vorabprüfung erneut aus. Jeder Fehler nennt seine Zeile mit der Zeilennummer der Datei, wie ein Texteditor sie anzeigt, einschließlich Leerzeilen und Zellen über mehrere Zeilen.
- **Zuordnung über Dimension und Name**: Eine Zeile, deren Name in ihrer Dimension existiert, aktualisiert diesen Wert; jede andere Zeile erstellt einen. Jede Zelle ersetzt den gespeicherten Inhalt, sodass eine leere `description` ihn löscht. Ein Name in anderer Groß- und Kleinschreibung findet den gespeicherten Wert und benennt ihn nicht um. Um einen Wert umzubenennen, benennen Sie ihn auf der Seite um.
- **Unveränderte Zeilen**: Eine Zeile, die dem gespeicherten Wert entspricht, ändert nichts. Wenn Sie dieselbe Datei exportieren und importieren, werden alle Zeilen als unverändert gemeldet.
- **Deaktivierte Dimensionen**: Eine Zeile einer deaktivierten Dimension wird akzeptiert, wenn sie nichts ändert, sodass eine exportierte Datei unverändert importiert wird. Eine Zeile, die dort einen Wert erstellen oder ändern würde, wird abgelehnt.
- **In der Datei fehlende Werte** bleiben unverändert. Der Import löscht nie.
- **Reihenfolge**: Bestehende Werte behalten ihren Platz. Neue Werte kommen in ihrer Dimension an die letzte Stelle, in der Reihenfolge der Datei. Um die Reihenfolge zu ändern, verwenden Sie **Neu ordnen** auf der Seite.

**Häufige Fehler**:

- **„Unknown dimension '...'.“**: Die Zelle `axis_code` passt zu keiner Dimension. Prüfen Sie den Code im Arbeitsbereich der Dimension, oder erstellen Sie zuerst die Dimension.
- **„The ... dimension is disabled. Enable it or leave it out.“**: Eine Zeile erstellt oder ändert einen Wert in einer deaktivierten Dimension. Aktivieren Sie die Dimension, oder entfernen Sie die Zeile.
- **„... is already on row N.“**: Zwei Zeilen tragen denselben Namen für dieselbe Dimension. Behalten Sie eine.
- **„Invalid status '...'. Use 'enabled' or 'disabled'.“**: Korrigieren Sie die Zelle `status`.
- **„Invalid applies_to '...'. Use 'opex', 'capex' or leave it empty.“**: Korrigieren Sie die Zelle `applies_to`.
- **„The ... dimension is for OPEX lines only.“** (oder CAPEX): Die Zeile beschränkt einen Wert auf die Zeilenart, die seine Dimension ausschließt. Korrigieren Sie die Zelle `applies_to` oder ändern Sie **Verwendet für** der Dimension.
- **„Status is enabled but the end of validity has passed. Clear the date or set the status to disabled. If the file comes from an older export, export the data again.“**: Die Zeile ist aktiviert, aber ihr Datum ist bereits vorbei. Eine vor diesem Datum exportierte Datei enthält noch `enabled`: Exportieren Sie erneut oder korrigieren Sie die Zelle.
- **„Status is disabled but the end of validity is still to come. Set the status to enabled or set a date that has passed.“**: Die Zeile ist deaktiviert, aber ihr Datum liegt noch in der Zukunft. Korrigieren Sie die Zelle `status` oder `disabled_at`.
- **„Kopfzeile: Fehlende Spalten: ...“** oder **„Kopfzeile: Unbekannte Spalten: ...“**: Laden Sie eine neue Vorlage herunter.

---

## Berechtigungen

| Stufe | Was sie erlaubt |
|---|---|
| `analytics:reader` | Die Seite Analysedimensionen ansehen und Dimensionen und Werte öffnen |
| `analytics:member` | Dimensionen und Werte erstellen und bearbeiten, die Reihenfolge der Dimensionen und Werte festlegen |
| `analytics:admin` | Alles oben Genannte, dazu Import und Export, die empfohlenen Dimensionen sowie Löschen |

Die integrierte Rolle Budget-Administrator ist admin, Budget-Mitglied ist member und Budget-Leser ist reader. Wer Budgetzeilen (Budget) oder Berichte lesen kann, sieht die Dimensionen und ihre Werte auf Budgetzeilen, in den Listen und in den Berichten, ohne Zugriff auf diese Seite zu haben.

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
Ja, einen pro Dimension. Eine Zeile kann **Software** in Kostenart und **Anwendung** in IT-Bereich sein. Innerhalb einer Dimension hat eine Zeile einen Wert oder keinen.

**Wirken sich Analysedimensionen auf Zuordnungen oder die Buchhaltung aus?**
Nein. Sie dienen nur dem Reporting und haben keinen Einfluss auf Kostenzuordnungen oder die formale Buchhaltung.

**Wie viele Werte sollte ich anlegen?**
Beginnen Sie mit 5 bis 10 pro Dimension. Mehr als 20 bedeutet meist, dass die Dimension zu viele Fragen beantworten will: Teilen Sie sie in zwei Dimensionen auf.

**Was ist der Unterschied zwischen Analysedimensionen, Abteilungen und Kostenstellen?**
**Abteilungen** sind formale Organisationseinheiten mit präzisen Zuordnungsschlüsseln. **Kostenstellen** geben an, wer für die Ausgaben verantwortlich ist und einsteht. **Analysedimensionen** sind freie, optionale Klassifizierungen für das Reporting, ohne Zuordnung oder Verantwortung.

**Warum zeigen manche Zeilen „Nicht zugeordnet“?**
Im Bericht Analysedimensionen erscheinen Zeilen ohne Wert in der gewählten Dimension als „Nicht zugeordnet“. Das ist so vorgesehen: Werte sind optional, außer die Dimension ist erforderlich. Auch dann können Zeilen, die vor dem Einschalten angelegt wurden, keinen Wert haben. Der Arbeitsbereich der Dimension zählt sie und verlinkt sie.

**Was passiert mit den Zeilen, wenn ich einen Wert oder eine Dimension umbenenne?**
An den Zeilen ändert sich nichts. Listen und Berichte zeigen den neuen Namen sofort.
