# Geschäftsprozesse

Mit Geschäftsprozessen können Sie einen zentralen Katalog der End-to-End-Prozesse Ihrer Organisation erstellen und pflegen -- beispielsweise Order-to-Cash, Procure-to-Pay oder Hire-to-Retire. Indem Sie Prozessnamen, Kategorien und Verantwortliche an einem Ort verwalten, schaffen Sie einen einheitlichen Referenzpunkt, auf den der Rest von KANAP für Zuständigkeiten, Berichte und Audits zugreifen kann.

## Erste Schritte

Navigieren Sie zu **Stammdaten > Geschäftsprozesse**, um die Liste zu öffnen.

**Pflichtfelder**:

- **Name**: Der Prozessname, idealerweise mit einem Kurzcode (z. B. „Order-to-Cash (O2C)").

**Berechtigungen**:

- Anzeigen: `business_processes:reader`
- Erstellen / Bearbeiten: `business_processes:manager`
- Löschen, CSV importieren/exportieren: `business_processes:admin`

Wenn die Seite fehlt oder Felder schreibgeschützt sind, bitten Sie Ihren Mandanten-Administrator, Ihre Rollenberechtigungen anzupassen.

---

## Mit der Liste arbeiten

Die Liste zeigt alle Geschäftsprozesse Ihres Mandanten.

**Standardspalten**:

- **Name** -- der Prozessname. Zum Öffnen des Arbeitsbereichs anklicken.
- **Kategorien** -- eine oder mehrere Kategorien, denen der Prozess angehört (z. B. „Kunden & Vertrieb", „Finanzen & Controlling"). Mehrere Kategorien werden als kommagetrennte Liste angezeigt.
- **Prozessverantwortlicher** -- der für den Prozess verantwortliche Benutzer.

**Zusätzliche Spalten** (standardmäßig ausgeblendet; über Spaltenauswahl aktivierbar):

- **Status** -- `aktiviert` oder `deaktiviert`.
- **Aktualisiert** -- wann der Prozess zuletzt geändert wurde.

**Filtern und Sortieren**:

- Die Schnellsuche filtert über alle sichtbaren Spalten.
- Mit dem Umschalter **Anzeigen: Alle / Aktiv / Deaktiviert** über der Liste wählen Sie, welche Prozesse angezeigt werden. Standardmäßig zeigt die Liste aktivierte Prozesse.
- Die Standardsortierung gruppiert Zeilen nach **Kategorien**, dann nach **Name**.

**Aktionen** (Symbolleiste oben rechts):

- **Neu** (Manager+) -- einen neuen Geschäftsprozess erstellen.
- **Kategorien verwalten** (Manager+) -- den Dialog zur Kategorieverwaltung öffnen.
- **CSV importieren** (Admin) -- Prozesse aus einer CSV-Datei massenimportieren.
- **CSV exportieren** (Admin) -- alle Prozesse als CSV exportieren.
- **Ausgewählte löschen** (Admin) -- eine oder mehrere ausgewählte Zeilen löschen.

---

## Der Geschäftsprozess-Arbeitsbereich

Klicken Sie auf eine beliebige Zeile in der Liste -- oder die Schaltfläche **Neu** -- um den Arbeitsbereich zu öffnen.

Der Arbeitsbereich hat einen einzelnen **Übersichts**-Tab auf der linken Seite und eine Symbolleiste am oberen Rand:

- **Zurück / Weiter** -- zwischen Prozessen in der aktuellen Listenreihenfolge wechseln.
- **Zurücksetzen** -- nicht gespeicherte Änderungen verwerfen.
- **Speichern** -- Änderungen speichern.
- **Schließen** (X-Symbol) -- zur Liste zurückkehren, Filter und Sortierung beibehalten.

Wenn Sie mit nicht gespeicherten Änderungen navigieren, werden Sie aufgefordert, zu speichern oder zu verwerfen.

### Übersicht

Der Übersichts-Tab ist in drei Abschnitte gegliedert.

**Grunddaten**

- **Name** (Pflicht) -- verwenden Sie einen klaren Namen einschließlich des Kurzcodes, z. B. „Order-to-Cash (O2C)" oder „Hire-to-Retire (H2R)".
- **Beschreibung** -- eine kurze Zusammenfassung, was der Prozess umfasst. Eine gute Beschreibung erfasst die Start- und Endpunkte (z. B. „Von der Kundenbestellung über Lieferung, Rechnungsstellung bis zum Zahlungseingang.").
- **Statusschalter** -- seine Beschriftung zeigt den aktuellen Zustand (**Aktiviert** oder **Deaktiviert**). Aktivierte Prozesse erscheinen in Auswahlfeldern in der gesamten App. Deaktivieren Sie einen Prozess, um ihn stillzulegen ohne zu löschen, damit historische Referenzen erhalten bleiben.

**Klassifizierung**

- **Kategorien** (Mehrfachauswahl) -- weisen Sie eine oder mehrere Kategorien zu. Sie können aus bestehenden Kategorien wählen, eine neue inline mit **Neue Kategorie** erstellen oder auf **Kategorien bearbeiten** klicken, um den vollständigen Dialog zur Kategorieverwaltung zu öffnen.
- **Prozessverantwortlicher** -- der für den Prozess letztlich verantwortliche Benutzer. Wird im Listen-Grid angezeigt und steht für künftige Benachrichtigungen und Genehmigungen zur Verfügung.
- **IT-Verantwortlicher** -- der für die IT-Systeme und Werkzeuge verantwortliche Benutzer, die diesen Prozess unterstützen.

**Details**

- **Notizen** -- Freitextfeld für interne Informationen wie Links zu Prozesskarten, SOPs, Bereichsnotizen oder Verbesserungsplänen.

---

## Kategorien verwalten

Kategorien werden über alle Geschäftsprozesse hinweg geteilt. Sie können sie von zwei Stellen aus verwalten:

1. Auf der Listenseite klicken Sie auf **Kategorien verwalten**.
2. Im Arbeitsbereich, unter dem Feld **Kategorien**, klicken Sie auf **Kategorien bearbeiten**.

Beide öffnen den Dialog **Geschäftsprozess-Kategorien verwalten**.

**Was Sie tun können**:

- **Umbenennen** -- den Namen direkt im Textfeld bearbeiten.
- **Aktivieren / Deaktivieren** -- umschalten, ob eine Kategorie in Auswahlfeldern erscheint. Inaktive Kategorien werden bei neuen Zuweisungen ausgeblendet, bleiben aber bei bestehenden Prozessen erhalten.
- **Löschen** -- eine Kategorie entfernen. Das Löschen funktioniert nur, wenn kein Prozess sie verwendet; andernfalls sehen Sie eine Fehlermeldung.
- **Neue Kategorie** -- eine neue Zeile oben im Dialog hinzufügen.

**Speichern und Abbrechen**:

- Es wird nichts gespeichert, bis Sie auf **Speichern** klicken. Während der Dialog geöffnet ist, werden alle Änderungen lokal verfolgt.
- **Abbrechen** schließt den Dialog und verwirft alles, was Sie geändert haben.
- Wenn beim Speichern ein Fehler auftritt (z. B. ein doppelter Name oder eine noch verwendete Kategorie), bleibt der Dialog geöffnet, damit Sie das Problem korrigieren können.

---

## CSV-Import/Export

Verwenden Sie CSV-Import und -Export für den Massenimport oder die Offline-Bearbeitung Ihres Prozesskatalogs. Beide erfordern **Admin**-Zugriff.

### Exportieren

Klicken Sie auf der Listenseite auf **CSV exportieren**. Sie können exportieren:

- Eine **Vorlage** (nur Kopfzeile) als Ausgangspunkt.
- **Daten** (alle Prozesse des aktuellen Mandanten).

Die Datei verwendet Semikolons (`;`) als Trennzeichen und ist als UTF-8 mit BOM für Excel-Kompatibilität codiert.

**Spalten**: `name`, `categories`, `description`, `notes`, `status`.

Die Spalte `categories` kann mehrere durch Semikolons getrennte Kategorienamen innerhalb der Zelle enthalten (z. B. `Kunden & Vertrieb; Finanzen & Controlling`).

### Importieren

Klicken Sie auf der Listenseite auf **CSV importieren**, dann:

1. Laden Sie Ihre CSV-Datei hoch (muss den Vorlagenkopfzeilen entsprechen und `;` als Trennzeichen verwenden).
2. Führen Sie die **Vorprüfung** durch -- diese validiert Kopfzeilen und Daten und zeigt, wie viele Zeilen erstellt bzw. aktualisiert werden.
3. Wenn die Vorprüfung bestanden wird, klicken Sie auf **Laden** zum Anwenden.

**Zuordnungsregeln**:

- Zeilen werden anhand des **Namens** zugeordnet (Groß-/Kleinschreibung wird ignoriert). Ein übereinstimmender Name aktualisiert den bestehenden Prozess; ein neuer Name erstellt einen neuen Prozess.
- Jede Kategorie in der Zelle `categories` wird getrimmt und anhand des Namens zugeordnet. Wenn eine Kategorie noch nicht existiert, wird sie automatisch als aktive Kategorie erstellt.
- Die Spalte `status` legt den Aktiviert/Deaktiviert-Zustand fest. Lebenszyklusdaten werden nicht importiert -- passen Sie diese bei Bedarf im Arbeitsbereich an.

**Tipp**: Exportieren Sie zuerst Ihre aktuellen Daten, ändern Sie die CSV und importieren Sie erneut. Dies vermeidet versehentliche Duplikate und stellt sicher, dass Sie mit dem aktuellsten Stand arbeiten.

---

## Tipps

- **Namenskonvention** -- bleiben Sie beim Format „Klarname (CODE)" (z. B. „Order-to-Cash (O2C)"), damit Prozesse leicht zu finden und auf einen Blick erkennbar sind.
- **Stilllegen statt löschen** -- deaktivieren Sie Prozesse, die Sie nicht mehr nutzen, anstatt sie zu löschen. Dies bewahrt historische Referenzen und Audit-Trails.
- **Kategorien zuerst** -- richten Sie Ihre Kategoriestruktur ein, bevor Sie Prozesse massenimportieren. Der Import erstellt fehlende Kategorien automatisch, aber vorherige Planung hält alles ordentlich.
- **Prozessverantwortliche frühzeitig** -- die Zuweisung eines Prozessverantwortlichen jetzt bedeutet, dass Zuständigkeitsdaten bereits vorhanden sind, wenn künftige Funktionen wie Benachrichtigungen und Aufgabenweiterleitung verfügbar werden.
