# CSV-Dateien

Jede Stammdatenseite hat **CSV exportieren** und **CSV importieren** in ihrer Symbolleiste und dokumentiert ihre eigenen Spalten. Diese Seite beschreibt, was diese Dateien gemeinsam haben. Sie gilt auch für die Benutzerliste in der **Administration**.

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
