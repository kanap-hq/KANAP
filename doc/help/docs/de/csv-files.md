# CSV- und Excel-Dateien

Jede Stammdatenseite hat **Exportieren** und **Importieren** in ihrer Symbolleiste und dokumentiert ihre eigenen Spalten. Diese Seite beschreibt, was diese Dateien gemeinsam haben. Sie gilt auch für die Benutzerliste in der **Administration**.

## Export

**Format.** Der Exportdialog bietet **CSV** oder **Excel (.xlsx)** an. Ihr Browser merkt sich die Wahl, und sie gilt für jeden Exportdialog und jedes Exportmenü. Die Datei enthält die Zeilen, die die Liste zeigt, mit ihren Filtern und ihrer Suche, sofern Sie im Dialog nicht das ganze Verzeichnis wählen.

**Von KANAP erstellt.** KANAP schreibt jede Exportdatei, CSV oder Excel, und zeichnet sie im [Audit-Protokoll](admin.md#audit-protokoll) auf: wer was exportiert hat, mit welchen Filtern, in welchem Format und wie viele Zeilen.

**Eine Excel-Datei** enthält ein Blatt, das nach der Liste benannt ist, mit denselben Spalten wie die CSV-Datei. Die Kopfzeile ist fett und bleibt beim Blättern stehen, mit einem Filter auf jeder Spalte. Zahlen sind Zahlen, Beträge sind centgenau, und Datumsangaben sind echte Datumswerte, die Excel und LibreOffice in der Tagesreihenfolge Ihrer Sprache anzeigen. Jede andere Zelle ist Text. Ein Text, der wie eine Formel beginnt, bleibt Text.

## Import

**Prüfen, dann laden.** Ein Import hat zwei Schritte. **Vorabprüfung** liest die Datei und meldet, was ein Laden ändern würde: die anzulegenden Zeilen, die zu aktualisierenden Zeilen und die Zeilen, die nichts ändern. **Laden** schreibt sie, dann zählt der Dialog die angelegten, aktualisierten und unveränderten Zeilen, zum Beispiel „2 angelegt, 5 aktualisiert, 30 unverändert“. Eine Null wird weggelassen. Vor dem Laden wird nichts geschrieben, und eine Datei mit einem einzigen Fehler lädt nichts. Fehler nennen die Zeile der Datei so, wie ein Texteditor sie zeigt, Leerzeilen und mehrzeilige Zellen eingeschlossen.

**Spalten werden über ihren Namen zugeordnet**, in beliebiger Reihenfolge, unabhängig von Groß- und Kleinschreibung, Leerzeichen und Unterstrichen. Diese Dateien sind streng: Eine Spalte, die KANAP nicht kennt, lehnt die ganze Datei ab, und die Meldung nennt in einer Zeile **Kopfzeile** die unbekannten und die fehlenden Spalten. Die Budgetdatei ist diejenige, die unbekannte Spalten ignoriert. Siehe [Ein Budget aus einer Tabellenkalkulation laden](budget-file.md).

**Excel-Arbeitsmappen.** Ein Import liest eine CSV-Datei oder eine Excel-Arbeitsmappe (`.xlsx`), mit denselben Spalten und denselben Regeln. KANAP liest nur das erste Blatt. Hat die Arbeitsmappe weitere Blätter, nennt die Prüfung das gelesene Blatt. Eine Zahl oder ein Datum, das in einer Zelle als Wert steht, wird so gelesen, wie es ist, ohne Frage nach Trennzeichen oder Tagesreihenfolge, und ein Datum mit Uhrzeit behält seine Uhrzeit. Ein Datum oder ein Betrag als Text folgt den Regeln einer CSV-Datei weiter unten. Eine alte Excel-Datei (`.xls`) wird mit einer Meldung abgelehnt: Speichern Sie sie als `.xlsx` oder CSV. Importvorlagen sind CSV-Dateien, die Excel öffnet.

**Kodierung und Trennzeichen einer CSV-Datei.** Speichern Sie die Datei als UTF-8 („CSV UTF-8“ in Excel). Eine Datei, die Excel als einfache CSV in Windows-1252 gespeichert hat, lässt sich ebenfalls importieren, Umlaute eingeschlossen. Das Trennzeichen wird aus der Kopfzeile gelesen: `,`, `;` oder ein Tabulator. Der Export schreibt das Trennzeichen der Sprache, in der die Oberfläche angezeigt wird.

**Andere Dateien.** Eine OpenDocument-Tabelle (`.ods`) wird abgelehnt, bevor eine Spalte gelesen wird, mit einer Meldung, die erklärt, wie man sie als CSV speichert. In LibreOffice Calc: **Datei › Speichern unter › Text CSV** oder **Excel 2007-365 (.xlsx)**. Jede andere Datei, die kein Text ist, wird ebenso abgelehnt.

## Beträge, Datumsangaben und Ja oder Nein

**In einer CSV-Datei folgen Beträge, Datumsangaben und Ja oder Nein der Sprache der Oberfläche** beim Export, und ein Import liest jede Form:

| Sprache | Trennzeichen | Beträge | Datumsangaben | Ja, Nein |
|---|---|---|---|---|
| Englisch | `,` | `12280.50` | `2027-03-01` | `yes`, `no` |
| Französisch | `;` | `12280,50` | `01/03/2027` | `oui`, `non` |
| Spanisch | `;` | `12280,50` | `01/03/2027` | `sí`, `no` |
| Deutsch | `;` | `12280,50` | `01.03.2027` | `ja`, `nein` |

**Datumsangaben** werden mit dem Jahr zuerst geschrieben (`2027-03-01`, `2027/03/01` oder `2027.03.01`) oder mit Tag und Monat vor dem Jahr (`01/03/2027`, `01.03.2027`). Ein in Worten geschriebenes Datum wie `Mar 1 2027` wird abgelehnt, ebenso ein Tag, den es im Kalender nicht gibt, wie `31/02/2027`.

Auf den Stammdatenseiten wird ein Datum, das die Datei nicht selbst entscheiden kann, wie `01/03/2027`, in der Reihenfolge der Sprache gelesen, in der die Oberfläche angezeigt wird: Tag zuerst auf Französisch, Deutsch und Spanisch, Monat zuerst auf Englisch. Die Prüfung sagt, wie sie die Datei gelesen hat, mit einer Schaltfläche, um die Lesart zu ändern. Ein Datum mit einem Tag über 12 entscheidet die Frage selbst, und die Datei hält nicht fest, in welcher Sprache sie exportiert wurde. Die Dateien der Anwendungen, Assets, Incidents, Projekte, Anfragen und Aufgaben lesen ein solches Datum immer mit dem Tag zuerst.

Ein Import liest Ja oder Nein in jeder dieser Sprachen sowie die `true`, `false`, `1` und `0` älterer Dateien. Die Dateien der Anwendungen, Assets, Incidents, Projekte, Anfragen und Aufgaben folgen derselben Tabelle, ebenso die Verknüpfungsdateien der Technologieliste. Siehe [Technologien](technologies.md#verknupfungen-importieren-und-exportieren).

**Größe.** Eine Datei enthält höchstens 20.000 Zeilen.

Auf einer On-Premise-Installation kann der Administrator Excel-Arbeitsmappen in Importen abschalten. Die Import-Schaltflächen heißen dann **CSV importieren** und nehmen nur CSV-Dateien an. Siehe [Konfiguration](on-premise/configuration.md#optional-excel-imports).
