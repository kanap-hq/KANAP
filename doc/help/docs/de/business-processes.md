# Geschäftsprozesse

Mit Geschäftsprozessen können Sie einen zentralen Katalog der End-to-End-Prozesse Ihrer Organisation erstellen und pflegen, beispielsweise Order-to-Cash, Procure-to-Pay oder Hire-to-Retire. Indem Sie Prozessnamen, Typen, Verantwortliche und ihre Hierarchie an einem Ort verwalten, schaffen Sie einen einheitlichen Referenzpunkt, auf den der Rest von KANAP für Zuständigkeiten, Berichte und Audits zugreifen kann.

## Erste Schritte

Navigieren Sie zu **Stammdaten > Geschäftsprozesse**, um die Liste zu öffnen.

**Pflichtfelder**:

- **Name**: Der Prozessname, idealerweise mit einem Kurzcode (z. B. „Order-to-Cash (O2C)").

**Berechtigungen**:

- Anzeigen: `business_processes:reader`
- Erstellen / Bearbeiten: `business_processes:member`
- Löschen, importieren und exportieren: `business_processes:admin`

Wenn die Seite fehlt oder Felder schreibgeschützt sind, bitten Sie Ihren Mandanten-Administrator, Ihre Rollenberechtigungen anzupassen.

---

## Mit der Liste arbeiten

Die Liste zeigt alle Geschäftsprozesse Ihres Mandanten.

**Standardspalten**:

- **Name**: der Prozessname. Zum Öffnen des Arbeitsbereichs anklicken. In der Baumreihenfolge nach Ebene eingerückt.
- **Typ**: **Führungsprozess**, **Kernprozess** oder **Unterstützungsprozess**, oder leer.
- **Übergeordneter Prozess**: der Prozess, unter dem er steht, oder leer für einen Prozess der obersten Ebene.
- **Prozessverantwortlicher**: der für den Prozess verantwortliche Benutzer.

**Zusätzliche Spalten** (standardmäßig ausgeblendet; über Spaltenauswahl aktivierbar):

- **Status**: `aktiviert` oder `deaktiviert`.
- **Aktualisiert**: wann der Prozess zuletzt geändert wurde.

**Filtern und Sortieren**:

- Die Schnellsuche filtert über alle sichtbaren Spalten.
- Mit dem Umschalter **Anzeigen: Alle / Aktiv / Deaktiviert** über der Liste wählen Sie, welche Prozesse angezeigt werden. Standardmäßig zeigt die Liste aktivierte Prozesse.
- **Typ** und **Übergeordneter Prozess** verwenden Kontrollkästchen-Filter. Der Filter des übergeordneten Prozesses listet die Prozesse, die Teilprozesse haben.
- Die Liste öffnet sich in der Baumreihenfolge: Auf jeden Prozess folgen seine Teilprozesse. Klicken Sie auf eine Spaltenüberschrift, um stattdessen nach dieser Spalte zu sortieren. Die Einrückung erscheint nur in der Baumreihenfolge.

**Aktionen** (Symbolleiste oben rechts):

- **Neu** (`business_processes:member`): einen neuen Geschäftsprozess erstellen. Siehe [Einen Geschäftsprozess erstellen](#creating-a-business-process).
- **Importieren** (Admin): Prozesse aus einer CSV-Datei oder Excel-Arbeitsmappe massenimportieren.
- **Exportieren** (Admin): die Prozesse der Liste, oder alle Prozesse, in eine CSV-Datei oder Excel-Arbeitsmappe exportieren.
- **Ausgewählte löschen** (Admin): eine oder mehrere ausgewählte Zeilen löschen. Teilprozesse werden vor ihrem übergeordneten Prozess gelöscht, sodass die Auswahl eines Prozesses zusammen mit allen seinen Teilprozessen den ganzen Zweig löscht. Ein Prozess, den Anwendungen oder Schnittstellen verwenden, kann nicht gelöscht werden: Deaktivieren Sie ihn stattdessen. Dieser Prozess behält seinen übergeordneten Prozess, wenn beide ausgewählt waren. Ein Prozess, der noch einen Teilprozess außerhalb der Auswahl hat, kann nicht gelöscht werden: Verschieben oder löschen Sie ihn zuerst. Bevor etwas gelöscht wird, listet die Bestätigung die behaltenen Prozesse mit dem Grund auf. Anfragen, die mit einem gelöschten Prozess verknüpft sind, bleiben ohne die Verknüpfung erhalten.

---

## Einen Geschäftsprozess erstellen { #creating-a-business-process }

1. Klicken Sie in der Liste auf **Neu**. Die Seite des Prozesses öffnet sich mit einem leeren Titel in der Kopfzeile. Der Rest der Seite ist abgeblendet.
2. Geben Sie den Namen des Prozesses ein, am besten mit seinem Kurzcode (z. B. „Order-to-Cash (O2C)“).
3. Drücken Sie die Eingabetaste oder klicken Sie außerhalb des Titels. KANAP erstellt den Prozess sofort, aktiviert, und alle Reiter öffnen sich.

Drücken Sie Escape im leeren Titel, um die Seite zu verlassen, ohne etwas zu erstellen. Zwei Prozesse können nicht denselben Namen tragen, unabhängig von Groß- und Kleinschreibung: Ein bereits verwendeter Name wird abgelehnt, mit einer Meldung unter dem Titel.

Solange der Prozess erstellt wird, zeigt seine Kopfzeile **Erstellen** und **Abbrechen**. Beide bleiben, bis Sie den Prozess verlassen.

- **Erstellen** behält den Prozess und schließt ihn. Sie kehren dorthin zurück, wo Sie begonnen haben: zur Liste oder zum vorherigen Bildschirm. Bei leerem Titel schließt sich nichts, und der Titel verlangt einen.
- **Abbrechen** schließt, ohne etwas zu behalten. Ein bereits erstellter Prozess wird gelöscht, mit den Verknüpfungen zu Anwendungen, die Sie hinzugefügt haben. Wenn Sie mehr als den Namen eingegeben haben, nennt eine Bestätigung, was gelöscht wird. Sie können Ihre eigene Erstellung auch ohne das Recht zum Löschen von Prozessen abbrechen.

Verlassen Sie den Prozess auf andere Weise, bleibt er bestehen.

---

## Der Geschäftsprozess-Arbeitsbereich

Klicken Sie auf eine beliebige Zeile in der Liste, um den Arbeitsbereich zu öffnen. Jede Änderung wird von selbst gespeichert: eine Liste oder ein Auswahlfeld, sobald Sie einen Wert wählen, ein Text, sobald Sie ihn verlassen. **Gespeichert** erscheint kurz in der Kopfzeile.

Die Kopfzeile enthält:

- **Geschäftsprozesse** (Zurück-Pfeil): zur Liste zurückkehren, Filter und Sortierung bleiben erhalten.
- Den **Namen**: Klicken Sie darauf, um den Prozess umzubenennen.
- Die Pfeile **vorheriger / nächster**: zwischen Prozessen in der aktuellen Listenreihenfolge wechseln.
- **Status**: **Aktiviert** oder **Deaktiviert**. Aktivierte Prozesse erscheinen in Auswahlfeldern in der gesamten App. Deaktivieren Sie einen Prozess, um ihn stillzulegen ohne zu löschen, damit historische Referenzen erhalten bleiben.
- **Löschen** (Papierkorb-Symbol, Admin): den Prozess löschen und zur Liste zurückkehren. Ein Prozess, den Anwendungen oder Schnittstellen verwenden, kann nicht gelöscht werden: Die Meldung zählt sie auf. Deaktivieren Sie ihn stattdessen. Ein Prozess mit Teilprozessen kann ebenfalls nicht gelöscht werden: Die Meldung zählt sie auf. Verschieben oder löschen Sie diese zuerst.

Ohne `business_processes:member` öffnet sich die Seite nur zum Lesen.

### Eigenschaften

Die Eigenschaftsleiste auf der rechten Seite enthält:

- **Typ**: der Prozesstyp nach ISO 9001, optional. Ein **Führungsprozess** steuert und lenkt die Organisation. Ein **Kernprozess** schafft Wert für die Kunden. Ein **Unterstützungsprozess** stellt den anderen Prozessen Ressourcen bereit. Ein Teilprozess erbt den Typ seines übergeordneten Prozesses nicht.
- **Übergeordneter Prozess**: der Prozess, unter dem dieser steht. Prozesse bilden einen Baum ohne Tiefenbegrenzung. Die Auswahl zeigt den Baum eingerückt und durchsucht den vollständigen Pfad. Der Prozess selbst und seine Teilprozesse werden nicht angeboten. Lassen Sie das Feld für die oberste Ebene leer. Ein Prozess kann nicht sein eigener übergeordneter Prozess sein und nicht unter einen seiner eigenen Teilprozesse verschoben werden.
- **Prozessverantwortlicher**: der für den Prozess letztlich verantwortliche Benutzer. Wird in der Liste angezeigt.
- **IT-Verantwortlicher**: der Benutzer, der für die IT-Systeme und Werkzeuge verantwortlich ist, die den Prozess unterstützen.
- **Lebenszyklus**: der Statusschalter und das Datum **Ende der Gültigkeit**. Ein Prozess, dessen Gültigkeit abgelaufen ist, ist deaktiviert.

### Übersicht

- **Beschreibung**: was der Prozess umfasst, am besten von seinem Start- bis zu seinem Endpunkt (z. B. „Von der Kundenbestellung über Lieferung und Rechnungsstellung bis zum Zahlungseingang“).
- **Notizen**: interne Informationen wie Links zu Prozesskarten, Verfahren, Bereichsnotizen oder Verbesserungsplänen.

### Beziehungen

Der Abschnitt **Anwendungen** listet die Anwendungen, die den Prozess unterstützen, mit Referenz, Kritikalität und IT-Verantwortlichem. **Hinzufügen** öffnet eine Suche; eine Verknüpfung wird sofort gespeichert. Fahren Sie über eine Zeile und klicken Sie auf ihr Kreuz, um die Verknüpfung zu lösen. Die Anwendung zeigt dieselbe Verknüpfung im Abschnitt **Geschäftsprozesse** ihres Reiters Beziehungen.

Zum Ändern der Verknüpfungen benötigen Sie `business_processes:member`. Der Reiter erscheint nur, wenn Sie Anwendungen lesen dürfen. Ein Business Contributor sieht und verknüpft nur die Anwendungen in seinem Bereich.

### Verlauf

Die Änderungen am Prozess, etwa an seinem Typ oder seinem übergeordneten Prozess, und an seinen Verknüpfungen zu Anwendungen. Siehe [Verlauf der Datensätze](record-history.md).

---

## CSV-Import/Export

Der Export schreibt eine CSV-Datei oder eine Excel-Arbeitsmappe (`.xlsx`): Wählen Sie unter **Format** im Dialog. Der Import liest beides. Siehe [CSV- und Excel-Dateien](csv-files.md).

Verwenden Sie Import und Export für den Massenimport oder die Offline-Bearbeitung Ihres Prozesskatalogs. Beide erfordern **Admin**-Zugriff.

### Exportieren

Klicken Sie auf der Listenseite auf **Exportieren**. Die Datei enthält die Prozesse, die die Liste zeigt, mit ihrer Suche, ihren Filtern und ihrer Sortierung, oder alle Prozesse, wenn Sie im Dialog **Das ganze Verzeichnis** wählen. Für eine leere Datei nur mit den Kopfzeilen verwenden Sie **Vorlage herunterladen** im Importdialog.

Das Trennzeichen folgt der Sprache Ihres Bildschirms. Siehe [CSV- und Excel-Dateien](csv-files.md) für die Kodierung, das Trennzeichen und die beiden Importschritte.

**Spalten**: `name`, `process_type`, `parent_name`, `description`, `notes`, `status`.

- `process_type`: `management`, `core` oder `support`, oder leer.
- `parent_name`: der Name des übergeordneten Prozesses, oder leer für die oberste Ebene.

### Importieren

Klicken Sie auf der Listenseite auf **Importieren**, dann:

1. Laden Sie Ihre CSV-Datei oder Excel-Arbeitsmappe mit den Spaltentiteln der Vorlage hoch. In einer CSV-Datei funktionieren Kommas und Semikolons beide.
2. Führen Sie die **Vorprüfung** durch. Diese validiert Kopfzeilen und Daten und zeigt, wie viele Zeilen erstellt bzw. aktualisiert werden.
3. Wenn die Vorprüfung bestanden wird, klicken Sie auf **Laden** zum Anwenden.

**Zuordnungsregeln**:

- Zeilen werden anhand des **Namens** zugeordnet, unabhängig von Groß- und Kleinschreibung. Ein übereinstimmender Name aktualisiert den bestehenden Prozess und behält die gespeicherte Schreibweise (die Vorabprüfung meldet, welchem Prozess die Zeile zugeordnet wurde); ein neuer Name erstellt einen neuen Prozess.
- `parent_name` wird anhand des Namens zugeordnet, unabhängig von Groß- und Kleinschreibung: ein Prozess derselben Datei oder ein Prozess, der bereits in KANAP besteht. Gibt es beide, hat die Datei Vorrang. Die Zeilen können in beliebiger Reihenfolge stehen: Übergeordnete Prozesse werden vor ihren Teilprozessen erstellt.
- Ein unbekannter übergeordneter Name, ein Prozess unter sich selbst oder eine Schleife werden mit der Zeilennummer abgelehnt.
- Die Datei hat keine Spalte für das Gültigkeitsende. Bei einer Aktualisierung behält ein leerer `status` oder einer, der dem aktuellen Status des Prozesses entspricht, dessen Gültigkeitsende. Ein anderer Status wird angewendet: `enabled` löscht das Gültigkeitsende, und `disabled` beendet den Prozess heute, sofern sein Gültigkeitsende nicht bereits vergangen ist. Ein neuer Prozess ist aktiviert, sofern die Zeile nicht `disabled` angibt.

**Tipp**: Exportieren Sie zuerst Ihre aktuellen Daten, ändern Sie die Datei und importieren Sie erneut. Dies vermeidet versehentliche Duplikate und stellt sicher, dass Sie mit dem aktuellsten Stand arbeiten.

---

## Tipps

- **Namenskonvention**: bleiben Sie beim Format „Klarname (CODE)" (z. B. „Order-to-Cash (O2C)"), damit Prozesse leicht zu finden und auf einen Blick erkennbar sind.
- **Stilllegen statt löschen**: deaktivieren Sie Prozesse, die Sie nicht mehr nutzen, anstatt sie zu löschen. Dies bewahrt historische Referenzen und Audit-Trails.
- **Prozessverantwortliche frühzeitig**: die Zuweisung eines Prozessverantwortlichen jetzt bedeutet, dass Zuständigkeitsdaten bereits vorhanden sind, wenn künftige Funktionen wie Benachrichtigungen und Aufgabenweiterleitung verfügbar werden.
