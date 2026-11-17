# CSV- und Excel-Dateien

Jede Stammdatenseite hat **Exportieren** und **Importieren** in ihrer Symbolleiste und dokumentiert ihre eigenen Spalten. Diese Seite beschreibt, was diese Dateien gemeinsam haben. Sie gilt auch für die Benutzerliste in der **Administration**.

## Export

**Format.** Der Exportdialog bietet **CSV** oder **Excel (.xlsx)** an. Ihr Browser merkt sich die Wahl, und sie gilt für jeden Exportdialog und jedes Exportmenü. Die Datei enthält die Zeilen, die die Liste zeigt, mit ihren Filtern und ihrer Suche, sofern Sie im Dialog nicht das ganze Verzeichnis wählen.

**Von Kadratis erstellt.** Kadratis schreibt jede Exportdatei, CSV oder Excel, und zeichnet sie im [Audit-Protokoll](admin.md#audit-protokoll) auf: wer was exportiert hat, mit welchen Filtern, in welchem Format und wie viele Zeilen.

**Eine Excel-Datei** enthält ein Blatt, das nach der Liste benannt ist, mit denselben Spalten wie die CSV-Datei. Die Kopfzeile ist fett und bleibt beim Blättern stehen, mit einem Filter auf jeder Spalte. Zahlen sind Zahlen, Beträge sind centgenau, und Datumsangaben sind echte Datumswerte, die Excel und LibreOffice in der Tagesreihenfolge Ihrer Sprache anzeigen. Jede andere Zelle ist Text. Ein Text, der wie eine Formel beginnt, bleibt Text.

## Import

**Prüfen, dann laden.** Ein Import hat zwei Schritte. **Vorabprüfung** liest die Datei und meldet, was ein Laden ändern würde: die anzulegenden Zeilen, die zu aktualisierenden Zeilen und die Zeilen, die nichts ändern. **Laden** schreibt sie, dann zählt der Dialog die angelegten, aktualisierten und unveränderten Zeilen, zum Beispiel „2 angelegt, 5 aktualisiert, 30 unverändert“. Eine Null wird weggelassen. Vor dem Laden wird nichts geschrieben, und eine Datei mit einem einzigen Fehler lädt nichts. Fehler nennen die Zeile der Datei so, wie ein Texteditor sie zeigt, Leerzeilen und mehrzeilige Zellen eingeschlossen.

**Spalten werden über ihren Namen zugeordnet**, in beliebiger Reihenfolge, unabhängig von Groß- und Kleinschreibung, Leerzeichen und Unterstrichen. Eine Spalte, die Kadratis nicht kennt, lehnt die ganze Datei ab, und die Meldung nennt sie in einer Zeile **Kopfzeile**. Die Budgetdatei ist diejenige, die unbekannte Spalten ignoriert. Siehe [Ein Budget aus einer Tabellenkalkulation laden](budget-file.md).

**Referenzen.** Die Dateien für Unternehmen, Abteilungen, Lieferanten und Kontakte beginnen mit einer optionalen Spalte `reference`, die der Export ausfüllt (`COMP-12`, `DEPT-4`, `SUP-12`, `CTCT-4`). Eine ausgefüllte Referenz bezeichnet den Datensatz, den die Zeile aktualisiert, auch wenn sich sein Name oder die E-Mail eines Kontakts geändert hat. Die Vorabprüfung meldet jeden Datensatz, der umbenannt wird oder das Unternehmen wechselt, und jeden Kontakt, dessen E-Mail-Adresse sich ändert. Ist sie leer, wird die Zeile über ihren Namen zugeordnet, ein Kontakt über seine E-Mail. Eine Referenz, die Ihr Arbeitsbereich nicht kennt, lehnt die Zeile ab, etwa bei einer Datei, die aus einem anderen Arbeitsbereich exportiert wurde: Leeren Sie die Zelle, um die Zeile als neuen Datensatz oder über ihren Namen zu importieren. Siehe [Unternehmen](companies.md#csv-importexport), [Abteilungen](departments.md#csv-importexport), [Lieferanten](suppliers.md#csv-importexport) und [Kontakte](contacts.md#csv-importexport).

Die Datei der Verträge beginnt mit derselben optionalen Spalte `reference` (`CTR-12`). Eine ausgefüllte Referenz bezeichnet den Vertrag, den die Zeile aktualisiert, auch wenn sich sein Name oder sein Lieferant geändert hat, und die Vorabprüfung meldet jeden Vertrag, der umbenannt wird oder zu einem anderen Lieferanten wechselt. Bleibt sie leer, wird die Zeile über Namen und Lieferant zugeordnet. Siehe [Verträge](contracts.md#csv-importexport).

**Spaltentitel.** Die Dateien für Anwendungen, Assets, Projekte, Vorfälle, Lieferanten und Verträge benennen ihre Spalten in der Sprache Ihrer Oberfläche, zum Beispiel `Name` auf Englisch und `Nom` auf Französisch. Der Import liest diese Titel in jeder der vier Sprachen, dazu die technischen Namen, die die Seiten auflisten (`name`). Die anderen Dateien, die Budgetdatei eingeschlossen, verwenden die technischen Namen.

**Excel-Arbeitsmappen.** Ein Import liest eine CSV-Datei oder eine Excel-Arbeitsmappe (`.xlsx`), mit denselben Spalten und denselben Regeln. Kadratis liest nur das erste Blatt. Hat die Arbeitsmappe weitere Blätter, nennt die Prüfung das gelesene Blatt. Eine Zahl oder ein Datum, das in einer Zelle als Wert steht, wird so gelesen, wie es ist, ohne Frage nach Trennzeichen oder Tagesreihenfolge, und ein Datum mit Uhrzeit behält seine Uhrzeit. Ein Datum oder ein Betrag als Text folgt den Regeln einer CSV-Datei weiter unten. Eine alte Excel-Datei (`.xls`) wird mit einer Meldung abgelehnt: Speichern Sie sie als `.xlsx` oder CSV. Importvorlagen sind CSV-Dateien, die Excel öffnet.

**Kodierung und Trennzeichen einer CSV-Datei.** Speichern Sie die Datei als UTF-8 („CSV UTF-8“ in Excel). Eine Datei, die Excel als einfache CSV in Windows-1252 gespeichert hat, lässt sich ebenfalls importieren, Umlaute eingeschlossen. Das Trennzeichen wird aus der Kopfzeile gelesen: `,`, `;` oder ein Tabulator. Der Export schreibt das Trennzeichen der Sprache, in der die Oberfläche angezeigt wird.

**Andere Dateien.** Eine OpenDocument-Tabelle (`.ods`) wird abgelehnt, bevor eine Spalte gelesen wird, mit einer Meldung, die erklärt, wie man sie als CSV speichert. In LibreOffice Calc: **Datei › Speichern unter › Text CSV** oder **Excel 2007-365 (.xlsx)**. Jede andere Datei, die kein Text ist, wird ebenso abgelehnt.

## Leere Zellen und `-` { #empty-cells-and-clearing }

Die Importe von Lieferanten, Kontakten, Unternehmen, Abteilungen, Verträgen, Kostenstellen, Konten, Werten von Analysedimensionen, Geschäftsprozessen, Arbeitstagekalendern und Technologie-Verknüpfungen lesen jede Zelle wie die Budgetdatei:

- **Eine leere Zelle behält den gespeicherten Wert.** Ein leerer `status` behält den gespeicherten Status: Er aktiviert keinen deaktivierten Datensatz.
- **`-` leert den gespeicherten Wert.** Eine Zelle, die nur `-` enthält, leert den Wert. Ein Text wie `Jean-Pierre` oder eine Zahl wie `-5` ist ein Wert.
- **Eine Spalte, die die Datei weglässt, wird nie geschrieben.** Eine Datei kann nur die Spalten enthalten, die jeden Datensatz finden, etwa seine Referenz, seinen Namen oder seinen Code, und die Spalten, die sich ändern sollen.
- **Manche Werte können nicht geleert werden**: eine Referenz, ein Name oder eine andere Spalte, die den Datensatz findet, ein Pflichtwert und ein Status. `-` in einer solchen Zelle lehnt die Zeile ab, und die Meldung nennt die Spalte. Bei einer Zahl, die nicht leer sein darf, etwa der Mitarbeiterzahl eines Unternehmens oder dem Jahresbetrag eines Vertrags, fordert die Meldung auf, `0` zu schreiben.
- **Ende der Gültigkeit.** `-` in `disabled_at` leert das Datum, und der Datensatz ist wieder aktiv. Eine Zeile mit `disabled` in `status` und `-` in `disabled_at` wird abgelehnt: Behalten Sie das eine oder das andere.
- **Neue Datensätze.** Eine leere Pflichtzelle lehnt die Zeile ab. `-` bei einem optionalen Wert lässt ihn leer. Die Standardwerte eines neuen Datensatzes, etwa die Laufzeit eines Vertrags, gelten nur bei der Anlage.
- **Die Vorabprüfung zählt die geleerten Werte**, zum Beispiel „3 Werte werden geleert“. Ein `-` bei einem Wert, der bereits leer ist, wird nicht gezählt.

Jede Seite nennt die Spalten ihrer Datei und was `-` dort bewirkt. Die Importe von Anwendungen, Assets, Projekten, Anfragen, Aufgaben und Vorfällen haben ihre eigene Regel für leere Zellen, auf ihren Seiten beschrieben. Die Budgetdatei folgt derselben Regel: siehe [Was eine Zelle bedeutet](budget-file.md#was-eine-zelle-bedeutet). Ebenso die Importe dieser Listen über Kad: siehe [Eine Tabelle importieren](ai-assistant.md#eine-tabelle-importieren).

## Namen von Datensätzen { #names-of-records }

Eine Zelle, die einen anderen Datensatz nennt, etwa einen Lieferanten, ein Unternehmen oder ein Projekt, findet ihn in drei Schritten:

1. derselbe Name, genau so geschrieben;
2. derselbe Name in anderer Groß- und Kleinschreibung;
3. derselbe Name mit anderen Akzenten, zum Beispiel `Fromagerie Leger` für `Fromagerie Léger`.

Der dritte Schritt gilt nur für Datensätze, die über ihren Namen gefunden werden, in einer Liste, die Sie lesen dürfen. Eine E-Mail, eine Standortreferenz wie `LOC-4` oder ein Code durchläuft die ersten beiden Schritte. Wenn mehrere Datensätze auf den dritten Schritt passen, wird die Zeile abgelehnt und die Meldung nennt sie: Schreiben Sie den Namen so, wie er gespeichert ist.

**Zuordnungen.** Die Vorabprüfung listet die im dritten Schritt gefundenen Namen unter **N Werte zugeordnet** auf, eingeklappt. Klappen Sie die Zeile auf, um jede Zuordnung zu sehen, zum Beispiel `Lieferant: Fromagerie Leger → Fromagerie Léger`. Die Liste enthält auch die Versionen, die über ihre Katalogbezeichnung gefunden wurden (siehe [Versionsbezeichnungen](technologies.md#version-labels)). **Rückgängig** prüft die Datei erneut ohne diese Zuordnung: Der Name wird dann als ein Name gelesen, den Kadratis nicht kennt, und das Laden behält diese Wahl. Die rückgängig gemachte Zuordnung bleibt mit **Wieder zuordnen** aufgeführt, das die Datei erneut mit ihr prüft. Die Importe von Anwendungen, Assets, Projekten, Anfragen, Aufgaben, Vorfällen, Verträgen, Kontakten, Kostenstellen, Geschäftsprozessen, Technologie-Verknüpfungen und die Budgetdatei zeigen diese Liste.

**Ein Name, der nichts findet.** Die Importe von Anwendungen, Assets, Projekten, Anfragen, Aufgaben und Vorfällen behalten bei leeren Zellen die aktuellen Werte, außer Sie wählen **Vollständig ersetzen**. Bei diesen Optionen behält eine Zeile, die einen Datensatz aktualisiert, den aktuellen Wert auch dann, wenn eine Zelle einen Datensatz nennt, den Kadratis nicht findet. Die Prüfung warnt: „„X“ wurde nicht gefunden: Der aktuelle Wert bleibt erhalten.“ Ein Wert, der von einer anderen Spalte abhängt, bleibt nur erhalten, wenn die Zeile diese Spalte unverändert lässt: die Phase einer Aufgabe mit ihrem Projekt, der Stream mit seiner Kategorie, die Abteilung mit ihrem Unternehmen. Andernfalls bleibt das Feld leer und die Prüfung warnt. Eine Aufgabe behält ihre Betrachter oder ihre Verantwortlichen, wenn eine ihrer Zellen eine unbekannte E-Mail nennt. Bei einem neuen Datensatz und mit **Vollständig ersetzen** bleibt das Feld leer und die Prüfung warnt. Eine Spalte, die einen bekannten Datensatz verlangt, lehnt die Zeile ab, wie ihre Seite sagt.

Die Importe durch Kad folgen denselben Regeln und zeigen die Zuordnungen in ihrer Vorschau. Siehe [Eine Tabelle importieren](ai-assistant.md#eine-tabelle-importieren).

## Beispieldateien { #example-files }

Der Importdialog für Anwendungen, Assets, Projekte, Lieferanten, Verträge und die Budgetdatei bietet **Beispiel herunterladen** an: eine Excel-Arbeitsmappe in der Sprache Ihrer Oberfläche.

- Das erste Blatt enthält einige Beispiele von Fromage & Co für die meistgenutzten Spalten. Dieses Blatt liest der Import.
- **Erweitert** zeigt die übrigen Spalten für dieselben Zeilen, wenn der Import mehr Spalten kennt, als das erste Blatt enthält. Um eine davon zu verwenden, kopieren Sie sie in das erste Blatt.
- **Hinweise** sagt, was jede Spalte aufnimmt. Listen zeigen die Werte, die Ihr Arbeitsbereich akzeptiert, etwa seine Anwendungskategorien oder seine Analysedimensionen.

Namen, Codes und E-Mail-Adressen müssen zu Datensätzen Ihres Arbeitsbereichs passen. Die Beispiele verwenden die der Beispieldaten von Fromage & Co: Ersetzen Sie sie durch Ihre eigenen, etwa den Standort eines Servers oder das Unternehmen eines Vertrags.

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

**Status, Prioritäten und Schweregrade.** Die Dateien der Projekte, Anfragen, Aufgaben und Incidents lesen einen Status, eine Priorität oder einen Schweregrad mit seinem Namen in jeder der vier Sprachen, etwa `On hold` oder `Suspendu`, oder mit seinem Code (`on_hold`). Ein unbekannter Wert wird abgelehnt, und die Meldung nennt die zulässigen Namen in der Sprache Ihres Bildschirms.

**Größe.** Eine Datei enthält höchstens 20.000 Zeilen.

Auf einer On-Premise-Installation kann der Administrator Excel-Arbeitsmappen in Importen abschalten. Die Import-Schaltflächen heißen dann **CSV importieren** und nehmen nur CSV-Dateien an. Siehe [Konfiguration](on-premise/configuration.md#optional-excel-imports).
