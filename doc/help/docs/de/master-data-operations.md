# Stammdaten-Administration

Die Stammdaten-Administration stellt Ihnen Werkzeuge zur Verwaltung von Unternehmens- und Abteilungskennzahlen über Geschäftsjahre hinweg bereit. Ob Sie finalisierte Zahlen sperren, eine Baseline für die Planung des nächsten Jahres kopieren oder einfach prüfen müssen, was eingefroren ist und was nicht -- hier erledigen Sie das.

## Wo Sie es finden

- Arbeitsbereich: **Stammdaten**
- Pfad: **Stammdaten > Administration**
- Berechtigungen:
  - Einfrierstatus anzeigen: jeder authentifizierte Benutzer
  - Einfrieren / Freigeben: `companies:admin`, `departments:admin` oder `budget_ops:admin`
  - Daten kopieren: `companies:admin`, `departments:admin` oder `budget_ops:admin`

Die Startseite zeigt zwei Aktionskarten. Klicken Sie auf eine, um das entsprechende Werkzeug zu öffnen.

---

## Daten einfrieren / freigeben

Verwenden Sie dieses Werkzeug, um Unternehmens- und Abteilungskennzahlen für ein bestimmtes Jahr zu sperren oder freizugeben. Das Einfrieren verhindert versehentliche Bearbeitungen, nachdem Daten finalisiert wurden -- nützlich beim Jahresabschluss, während Audits oder vor dem Start des nächsten Budgetzyklus.

### Funktionsweise

1. Wählen Sie das **Jahr**, das Sie verwalten möchten (Bereich umfasst das Vorjahr bis fünf Jahre voraus)
2. Aktivieren Sie die Geltungsbereiche: **Unternehmen**, **Abteilungen** oder beides
3. Klicken Sie auf **Daten einfrieren** zum Sperren oder **Daten freigeben** zum Entsperren

Die Seite zeigt eine Statuskarte für jeden Bereich:

- **Eingefroren** (rot) -- Daten sind für dieses Jahr schreibgeschützt; die Karte zeigt, wer wann eingefroren hat
- **Bearbeitbar** -- Daten können noch geändert werden

### Was das Einfrieren beeinflusst

Das Einfrieren sperrt die Jahreskennzahlen im **Details**-Tab von Unternehmen (Mitarbeiterzahl, IT-Benutzer, Umsatz) oder Abteilungen (Mitarbeiterzahl). Es beeinflusst nicht:

- Den Übersichts-Tab (Name, Beschreibung und andere allgemeine Felder)
- OPEX- oder CAPEX-Positionen

### Berechtigungen

Sie benötigen Admin-Zugriff auf den relevanten Bereich zum Einfrieren oder Freigeben:

| Bereich | Erforderliche Berechtigung |
|---------|---------------------------|
| Unternehmen | `companies:admin` oder `budget_ops:admin` |
| Abteilungen | `departments:admin` oder `budget_ops:admin` |

Wenn Ihnen die erforderlichen Berechtigungen fehlen, können Sie den aktuellen Einfrierstatus weiterhin einsehen -- Sie können ihn nur nicht ändern.

---

## Stammdaten-Kopie

Kopieren Sie Unternehmens- und Abteilungskennzahlen von einem Geschäftsjahr in ein anderes. Ein integrierter Testlauf ermöglicht Ihnen die Vorschau jeder Zeile vor dem Festschreiben, sodass Sie immer wissen, was überschrieben wird.

### Funktionsweise

1. Wählen Sie ein **Quelljahr** (woher die Werte gelesen werden)
2. Wählen Sie **Datenquellen**: Unternehmen, Abteilungen oder beides
3. Wählen Sie ein **Zieljahr** (wohin die Werte geschrieben werden)
4. Wenn Unternehmen ausgewählt ist, wählen Sie, welche **Unternehmenskennzahlen** kopiert werden sollen -- jede Kombination aus Mitarbeiterzahl, IT-Benutzer und Umsatz
5. Klicken Sie auf **Testlauf**, um eine Vorschau zu erstellen
6. Überprüfen Sie die Vorschautabelle
7. Klicken Sie auf **Daten kopieren**, um die Änderungen anzuwenden

### Vorschautabellen-Spalten

| Spalte | Was sie zeigt |
|--------|---------------|
| **Typ** | Unternehmen oder Abteilung |
| **Name** | Entitätsname |
| **Kennzahl** | Mitarbeiterzahl, IT-Benutzer oder Umsatz |
| **Quellwert** | Der Wert aus dem Quelljahr |
| **Aktuelles Ziel** | Der bestehende Wert im Zieljahr (falls vorhanden) |
| **Neuer Wert** | Der Wert, der geschrieben wird -- in Fettschrift |
| **Status** | „Bereit zum Kopieren" oder der Grund, warum die Zeile übersprungen wurde |

Übersprungene Zeilen erscheinen in einer Warnfarbe. Häufige Überspringungsgründe:

- Quellwert ist null oder leer
- Zieljahr ist für diesen Bereich eingefroren
- Entität ist für das Zieljahr nicht aktiv

### Zusammenfassungskarten

Unterhalb des Grids geben vier Zusammenfassungskarten eine schnelle Übersicht:

- **Gesamtzeilen** -- alles, was die Operation ausgewertet hat
- **Bereit zum Kopieren** -- Zeilen, die geschrieben werden
- **Übersprungen** -- ausgeschlossene Zeilen (mit Gründen in der Tabelle sichtbar)
- **Fehler** -- Zeilen, die beim tatsächlichen Kopieren fehlgeschlagen sind

### Schutz eingefrorener Daten

Sie können keine Daten in ein eingefrorenes Jahr kopieren. Wenn das Zieljahr für Unternehmen oder Abteilungen eingefroren ist, erscheint ein Fehlerbanner und die Aktionsschaltflächen werden deaktiviert. Geben Sie zuerst das Zieljahr mit dem Einfrieren/Freigeben-Werkzeug frei.

### CSV-Export

Sie können die Vorschautabelle über die Export-Schaltfläche in der Symbolleiste als CSV exportieren. Das ist praktisch für Offline-Überprüfung oder zum Teilen mit Kollegen vor dem Festschreiben. Dieser Export schreibt die Tabelle so, wie sie angezeigt wird. Die Dateien, die die Stammdatenseiten importieren, sind unter [CSV-Dateien](#csv-dateien) beschrieben.

### Berechtigungen

Es gelten die gleichen Regeln wie beim Einfrieren:

| Bereich | Erforderliche Berechtigung |
|---------|---------------------------|
| Unternehmen | `companies:admin` oder `budget_ops:admin` |
| Abteilungen | `departments:admin` oder `budget_ops:admin` |

Wenn Sie nur Zugriff auf einen Bereich haben, ist der andere in der Datenquellen-Auswahl ausgegraut.

---

## CSV-Dateien

Jede Stammdatenseite hat **CSV exportieren** und **CSV importieren** in ihrer Symbolleiste und dokumentiert ihre eigenen Spalten. Dieser Abschnitt beschreibt, was diese Dateien gemeinsam haben.

**Prüfen, dann laden.** Ein Import hat zwei Schritte. Die **Vorabprüfung** liest die Datei und meldet, was ein Laden ändern würde: die anzulegenden Zeilen, die zu aktualisierenden Zeilen und die Zeilen, die nichts ändern. **Laden** schreibt die Datei. Vorher wird nichts geschrieben, und eine Datei mit einem einzigen Fehler lädt nichts. Fehler nennen die Zeile der Datei, wie ein Texteditor sie anzeigt, leere Zeilen und Zellen über mehrere Zeilen eingeschlossen.

**Spalten werden über ihren Namen zugeordnet**, in beliebiger Reihenfolge, unabhängig von Groß- und Kleinschreibung, Leerzeichen und Unterstrichen. Diese Dateien sind strikt: Eine Spalte, die KANAP nicht kennt, lehnt die ganze Datei ab, und die Meldung nennt die unbekannten und die fehlenden Spalten. Die Budgetdatei ist diejenige, die unbekannte Spalten ignoriert. Siehe [Ein Budget aus einer Tabellenkalkulation laden](budget-file.md).

**Kodierung und Trennzeichen.** Speichern Sie die Datei als UTF-8 („CSV UTF-8“ in Excel). Eine von Excel als einfache CSV gespeicherte Datei in Windows-1252 lässt sich ebenfalls importieren, Akzente eingeschlossen. Das Trennzeichen wird aus der Kopfzeile gelesen: `,`, `;` oder ein Tabulator. Der Export schreibt das Trennzeichen der Sprache, in der die Oberfläche angezeigt wird.

**Beträge und Datumsangaben folgen der Sprache der Oberfläche** beim Export, und ein Import liest beide Formen:

| Sprache | Trennzeichen | Beträge | Datumsangaben |
|---|---|---|---|
| Englisch | `,` | `12280.50` | `2027-03-01` |
| Französisch, Spanisch | `;` | `12280,50` | `01/03/2027` |
| Deutsch | `;` | `12280,50` | `01.03.2027` |

Ein Datum, das die Datei nicht selbst entscheiden kann, zum Beispiel `01/03/2027`, wird in der Reihenfolge der Sprache gelesen, in der die Oberfläche angezeigt wird: Tag zuerst auf Französisch, Deutsch und Spanisch, Monat zuerst auf Englisch. Die Prüfung sagt, wie sie die Datei gelesen hat, mit einer Schaltfläche zum Ändern der Lesart. Ein Datum mit einem Tag über 12 entscheidet die Frage selbst, und die Datei trägt keinen Hinweis auf die Sprache, in der sie exportiert wurde.

**Größe.** Eine Datei enthält bis zu 20.000 Zeilen.

---

## Häufige Szenarien

### Finalisierte Jahresend-Daten schützen

Ihr Budget 2025 ist genehmigt. Sperren Sie es, damit niemand versehentlich die Zahlen ändert.

1. Öffnen Sie **Stammdaten > Administration > Daten einfrieren / freigeben**
2. Wählen Sie Jahr **2025**
3. Aktivieren Sie **Unternehmen** und **Abteilungen**
4. Klicken Sie auf **Daten einfrieren**

Alle Unternehmens- und Abteilungskennzahlen für 2025 sind jetzt schreibgeschützt, bis Sie sie freigeben.

### Budget des nächsten Jahres vorbereiten

Sie möchten die 2026-Planung mit der Mitarbeiterzahl und dem Umsatz von 2025 als Baseline starten.

1. Öffnen Sie **Stammdaten > Administration > Stammdaten-Kopie**
2. Setzen Sie **Quelljahr** auf **2025** und **Zieljahr** auf **2026**
3. Wählen Sie unter **Datenquellen** **Unternehmen**
4. Wählen Sie unter **Unternehmenskennzahlen** **Mitarbeiterzahl** und **Umsatz** (deaktivieren Sie IT-Benutzer, wenn nicht benötigt)
5. Klicken Sie auf **Testlauf** und überprüfen Sie die Vorschau
6. Klicken Sie auf **Daten kopieren**

Alle Unternehmen tragen jetzt die Mitarbeiterzahl und den Umsatz von 2025 ins Jahr 2026. Passen Sie einzelne Werte nach Bedarf an.

### Korrektur eingefrorener Daten

Sie haben 2025 eingefroren, aber einen Fehler in der Mitarbeiterzahl eines Unternehmens entdeckt.

1. Öffnen Sie **Stammdaten > Administration > Daten einfrieren / freigeben**
2. Wählen Sie Jahr **2025**, aktivieren Sie **Unternehmen** und klicken Sie auf **Daten freigeben**
3. Bearbeiten Sie die Mitarbeiterzahl des Unternehmens unter **Stammdaten > Unternehmen > Details**
4. Kehren Sie zum Einfrieren-Werkzeug zurück und frieren Sie 2025 Unternehmen erneut ein

---

## Häufig gestellte Fragen

**Was passiert, wenn ich versuche, ein eingefrorenes Jahr zu bearbeiten?**
Der Details-Tab für Unternehmen oder Abteilungen wird für dieses Jahr schreibgeschützt. Sie sehen eine Meldung, dass die Daten eingefroren sind. Geben Sie sie frei, um Änderungen vorzunehmen.

**Beeinflusst das Einfrieren OPEX- oder CAPEX-Positionen?**
Nein. Das Einfrieren sperrt nur Jahreskennzahlen (Mitarbeiterzahl, IT-Benutzer, Umsatz) bei Unternehmen und Abteilungen. OPEX- und CAPEX-Positionen sind nicht betroffen.

**Kann ich Daten in ein eingefrorenes Jahr kopieren?**
Nein. Das Kopier-Werkzeug zeigt einen Fehler und deaktiviert die Aktionsschaltflächen. Geben Sie zuerst das Zieljahr frei.

**Was passiert, wenn das Ziel bereits Werte hat?**
Die Kopieroperation überschreibt sie. Führen Sie immer zuerst einen Testlauf durch, damit Sie die Spalte „Aktuelles Ziel" sehen und verstehen, was ersetzt wird.

**Kann ich eine Kopie rückgängig machen?**
Nein. Kopieroperationen sind nicht umkehrbar. Wenn Sie ein Sicherheitsnetz benötigen, exportieren Sie die Daten des Zieljahres vor dem Kopieren als CSV.

**Warum werden einige Zeilen übersprungen?**
Zeilen werden übersprungen, wenn der Quellwert null ist, die Entität für das Zieljahr inaktiv ist oder das Ziel eingefroren ist. Die Status-Spalte in der Vorschau zeigt Ihnen, welcher Grund zutrifft.

**Kann ich nur bestimmte Unternehmen oder Abteilungen kopieren?**
Nein. Das Werkzeug kopiert alle Entitäten für die ausgewählten Bereiche und Kennzahlen. Für selektive Aktualisierungen verwenden Sie stattdessen CSV-Export/Import auf den einzelnen Unternehmen- oder Abteilungsseiten.

**Erstellt die Kopie neue Unternehmen oder Abteilungen?**
Nein. Es werden nur Kennzahlen für Entitäten geschrieben, die in beiden Jahren existieren. Wenn ein Unternehmen im Quelljahr existiert, aber nicht im Ziel, wird diese Zeile übersprungen.

**Wer kann den Einfrierstatus sehen?**
Jeder mit Zugriff auf den Stammdaten-Arbeitsbereich. Nur Administratoren des relevanten Bereichs können tatsächlich einfrieren oder freigeben.

**Kann ich zukünftige Jahre einfrieren?**
Ja. Die Jahrauswahl umfasst einen Bereich vom letzten Jahr bis fünf Jahre voraus. Das Einfrieren eines zukünftigen Jahres ist nützlich, um genehmigte Budgets vor Beginn des Geschäftsjahres zu sperren.

---

## Tipps

- **Immer zuerst einen Testlauf durchführen** -- überprüfen Sie die Vorschautabelle vor dem Festschreiben, um versehentliche Überschreibungen zu vermeiden
- **Nach Genehmigung einfrieren** -- sperren Sie Daten, sobald Budgets unterzeichnet sind, um Abweichungen zu verhindern
- **Vorübergehend freigeben** -- nehmen Sie Ihre Korrektur vor und frieren Sie dann sofort wieder ein
- **Früh kopieren** -- starten Sie den nächsten Planungszyklus, indem Sie die Kennzahlen des aktuellen Jahres nach vorne kopieren und dann für erwartete Änderungen anpassen
- **Berechtigungen prüfen** -- wenn ein Bereich ausgegraut ist, bitten Sie einen Administrator, Ihnen die richtige Zugriffsstufe zu gewähren
