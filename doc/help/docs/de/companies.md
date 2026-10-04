# Unternehmen

Unternehmen bilden das Fundament Ihrer Stammdaten. Sie repräsentieren die juristischen Einheiten, denen Sie IT-Ausgaben zuordnen und für die Sie Leistungsverrechnungen erstellen. Jede Zuordnung, jede Kostenposition und viele Berichte referenzieren ein Unternehmen, daher ist es wichtig, diese Daten korrekt zu halten.

Wenn Ihr Arbeitsbereich erstellt wird, beginnt er mit einem Unternehmen, das nach Ihrer Organisation benannt ist. Sein Land ist dasjenige, das Sie bei der Testanmeldung ausgewählt haben, und es wird automatisch dem Standard-Kontenplan für dieses Land zugewiesen, sobald einer verfügbar ist. Sie können es umbenennen oder weitere hinzufügen.

## Erste Schritte

Navigieren Sie zu **Stammdaten > Unternehmen**, um die Liste zu öffnen.

**Pflichtfelder**:

- **Name**: eine eindeutige Bezeichnung, die Ihre Teams kennen
- **Land**: ISO-Ländercode (nach Name oder Code durchsuchbar)
- **Stadt**: Stadt, in der das Unternehmen ansässig ist
- **Basiswährung**: ISO-Währungscode (nach Name oder Code durchsuchbar)

**Tipp**: Halten Sie die Namen eindeutig, um Verwechslungen bei Importen und Auswahllisten zu vermeiden.

## Mit der Liste arbeiten

Die Liste zeigt alle Unternehmen Ihres Arbeitsbereichs. Verwenden Sie sie, um wichtige Informationen auf einen Blick zu überprüfen, Unternehmen schnell zu finden und Arbeitsbereiche zum Bearbeiten zu öffnen.

**Standardspalten**:

| Spalte | Was sie zeigt |
|--------|---------------|
| **Name** | Unternehmensname (zum Öffnen des Arbeitsbereichs anklicken) |
| **Land** | ISO-Ländercode |
| **Währung** | Basiswährungscode |
| **Mitarbeiterzahl (Jahr)** | Mitarbeiterzahl für das ausgewählte Jahr (zum Öffnen des Details-Tabs anklicken) |
| **IT-Benutzer (Jahr)** | IT-Benutzer für das ausgewählte Jahr (zum Öffnen des Details-Tabs anklicken) |
| **Umsatz (Jahr)** | Umsatz für das ausgewählte Jahr (zum Öffnen des Details-Tabs anklicken) |
| **Status** | Aktiviert oder Deaktiviert |

**Zusätzliche Spalten** (standardmäßig ausgeblendet, über Spaltenauswahl hinzufügbar):

| Spalte | Was sie zeigt |
|--------|---------------|
| **Stadt** | Stadt |
| **Postleitzahl** | Postleitzahl |
| **Adresse 1** | Primäre Adresszeile |
| **Adresse 2** | Sekundäre Adresszeile |
| **Bundesland** | Bundesland oder Kanton |
| **Notizen** | Freitext-Notizen |
| **Erstellt** | Datum und Uhrzeit der Datensatzerstellung |

**Filtern**:

- **Schnellsuche**: Freitext-Suche über alle sichtbaren Spalten
- **Spaltenfilter**: Klicken Sie auf eine Spaltenüberschrift, um nach Wert zu filtern; numerische Spalten (Mitarbeiterzahl, IT-Benutzer, Umsatz) unterstützen Zahlenfilter
- **Statusbereich**: Der Umschalter **Anzeigen: Alle / Aktiv / Deaktiviert** über der Liste steuert, welche Unternehmen angezeigt werden. Standardmäßig zeigt die Liste aktivierte Unternehmen

**Jahrauswahl**: Verwenden Sie das Feld **Jahr** in der Symbolleiste, um zu wechseln, welche Jahreskennzahlen angezeigt werden. Die untere Zeile zeigt **Summen** für Mitarbeiterzahl, IT-Benutzer und Umsatz über alle sichtbaren (gefilterten) Unternehmen.

**Aktionen**:

- **Neu**: Unternehmen erstellen (erfordert `companies:manager`)
- **CSV importieren**: Massenimport von Unternehmen aus einer CSV-Datei (erfordert `companies:admin`)
- **CSV exportieren**: Unternehmen und ihre Kennzahlen als CSV exportieren (erfordert `companies:admin`)
- **Ausgewählte löschen**: Ein oder mehrere ausgewählte Unternehmen löschen (erfordert `companies:admin`; nur möglich, wenn nichts das Unternehmen referenziert)

**Suchkontext**: Wenn Sie einen Unternehmens-Arbeitsbereich aus der Liste öffnen, werden Ihre aktuelle Suche, Filter, Sortierreihenfolge und das Jahr beibehalten. Die Rückkehr zur Liste stellt Ihre vorherige Ansicht wieder her.

## Berechtigungen

| Aktion | Erforderliche Stufe |
|--------|---------------------|
| Liste und Arbeitsbereiche anzeigen | `companies:reader` |
| Unternehmen erstellen oder bearbeiten | `companies:manager` |
| Importieren, exportieren oder löschen | `companies:admin` |

## Der Unternehmens-Arbeitsbereich

Klicken Sie in der Liste auf einen Unternehmensnamen, um den Arbeitsbereich zu öffnen. Er hat zwei Tabs: **Übersicht** und **Details**.

- **Kopfzeile**: der Name des Unternehmens. Klicken Sie darauf, um das Unternehmen umzubenennen. Die Pfeile mit „N von M" wechseln zwischen Unternehmen in der Reihenfolge und mit den Filtern der Liste, ohne zur Liste zurückzukehren. Der Zurück-Link **Unternehmen** führt mit erhaltenem Suchkontext zur Liste zurück
- **Bereich Eigenschaften** rechts: **Land**, **Basiswährung**, **Kontenplan** und **Lebenszyklus**. Mit der Schaltfläche daneben klappen Sie den Bereich ein oder wieder aus

**Automatisches Speichern**: Jede Änderung wird von selbst gespeichert, sobald Sie das Feld verlassen. Es gibt keine Schaltflächen zum Speichern, Zurücksetzen oder Schließen. Sie können weiterarbeiten, während eine Änderung gespeichert wird. Wird eine Änderung abgelehnt, erscheint der Grund unter dem Feld, das sie verursacht hat, außer beim Namen, dessen Ablehnung oben auf der Seite angezeigt wird.

---

### Bereich Eigenschaften

- **Land** (Pflicht): ISO-Ländercode, Suche nach Name oder Code. Wenn Sie das Land ändern, wechselt auch der **Kontenplan** zum Standard des neuen Landes, aber nur, wenn der aktuelle Kontenplan zu einem anderen Land gehört. Ein globaler Kontenplan bleibt bestehen
- **Basiswährung** (Pflicht): ISO-Währungscode, Suche nach Name oder Code
- **Kontenplan**: der mit diesem Unternehmen verknüpfte Kontenplan (siehe [Kontenplan](#kontenplan)). Bei einem bestehenden Unternehmen können Sie einen anderen Kontenplan wählen, das Feld aber nicht leeren, weil der Standard des Landes zurückkäme
- **Lebenszyklus**: der Statusschalter, dessen Beschriftung den aktuellen Zustand zeigt (**Aktiviert** oder **Deaktiviert**), und das Datum **Ende der Gültigkeit**. Siehe [Status und Lebenszyklus](#status-und-lebenszyklus)

---

### Übersicht

Der Übersichts-Tab enthält die Adresse, die Registrierungsangaben und die Notizen. Name, Land, Währung, Kontenplan und Lebenszyklus befinden sich in der Kopfzeile und im Bereich **Eigenschaften**.

**Was Sie bearbeiten können**:

- Abschnitt **Adresse**:
    - **Adresszeile 1**, **Adresszeile 2**: Adresszeilen
    - **Postleitzahl**: Postleitzahl
    - **Stadt** (Pflicht): Name der Stadt. Eine leere Stadt wird mit „Geben Sie eine Stadt ein." abgelehnt
    - **Bundesland oder Region**: Bundesland, Provinz oder Region
- Abschnitt **Registrierung**:
    - **Handelsregisternummer**: Registernummer des Unternehmens
    - **USt-IdNr.**: Umsatzsteuer-Identifikationsnummer
- **Notizen**: Freitextnotizen

**Ein Unternehmen erstellen**: **Neu** öffnet ein einziges Formular mit dem Namen, **Land**, **Basiswährung**, **Kontenplan**, **Stadt**, den übrigen Adressfeldern, den Registrierungsfeldern und **Notizen**. Mit der Wahl eines Landes wird der **Kontenplan** für Sie ausgefüllt: der Standard-Kontenplan des Landes, falls vorhanden, sonst ein globaler Kontenplan. Sie können ihn vor dem Speichern ändern. Klicken Sie auf **Erstellen**, um das Unternehmen zu speichern. Der Tab **Details** steht nach dem Erstellen des Unternehmens zur Verfügung.

---

### Details

Der Details-Tab verwaltet die **Jahreskennzahlen**. Wechseln Sie mit den Jahres-Tabs oben zwischen den Jahren (aktuelles Jahr plus zwei Jahre davor und danach).

**Was Sie bearbeiten können**:

- **Mitarbeiterzahl** (Pflicht): Gesamtzahl der Beschäftigten im Jahr, muss eine ganze Zahl von 0 oder mehr sein
- **IT-Benutzer** (optional): Anzahl der IT-Benutzer, muss eine ganze Zahl von 0 oder mehr sein
- **Umsatz (Mio. €)** (optional): Umsatz in Millionen der Basiswährung des Unternehmens, bis zu 3 Dezimalstellen

**So funktioniert es**:

- Jeder Wert wird für das ausgewählte Jahr gespeichert, wenn Sie das Feld verlassen (oder die Eingabetaste drücken). Ein ungültiger Wert zeigt unter dem Feld eine Meldung, zum Beispiel „Geben Sie eine ganze Zahl ein, 0 oder mehr."
- Jedes Jahr wird für sich gespeichert: Beim Jahreswechsel werden die Werte dieses Jahres geladen
- Sind die Unternehmenszahlen des Jahres **eingefroren**, sind die Felder gesperrt, und ein Hinweis erklärt, dass ein Administrator sie in der **Stammdatenverwaltung** wieder freigeben kann
- Für das Bearbeiten der Kennzahlen benötigen Sie `companies:manager`

## Kontenplan

Jedes Unternehmen kann mit einem **Kontenplan** (CoA) verknüpft werden, der den Satz von Konten definiert, die beim Erfassen von OPEX- oder CAPEX-Positionen für dieses Unternehmen verfügbar sind.

**Funktionsweise**:

- Wenn Sie ein Unternehmen erstellen, wird es automatisch dem Standard-Kontenplan für sein Land zugewiesen (sofern vorhanden). Existiert kein Länder-Standard, wird der globale Standard-Kontenplan verwendet.
- Sie können die Kontenplan-Zuordnung im Bereich **Eigenschaften** über den **Kontenplan**-Selektor ändern. Der Selektor zeigt Kontenpläne, die zum Land des Unternehmens passen, plus alle global gültigen Kontenpläne.
- Wenn Sie das Land des Unternehmens ändern, folgt der Kontenplan, sofern der aktuelle zu einem anderen Land gehört: Er wechselt zum Standard des neuen Landes. Ein globaler Kontenplan bleibt bestehen.
- Bei einem bestehenden Unternehmen kann der Kontenplan nicht geleert werden. Sie können ihn nur durch einen anderen ersetzen.
- Der von Ihnen ausgewählte Kontenplan bestimmt, welche Konten im Konto-Dropdown beim Erstellen oder Bearbeiten von Ausgabenpositionen für dieses Unternehmen erscheinen.

**Was dies für Ihren Workflow bedeutet**:

- **Unternehmen mit Kontenplan**: Beim Erfassen von OPEX/CAPEX können Sie nur Konten auswählen, die zum Kontenplan dieses Unternehmens gehören. Dies gewährleistet buchhalterische Konsistenz.
- **Unternehmen ohne Kontenplan** (Legacy): Können Konten verwenden, die keinem Kontenplan zugehören. Dies unterstützt die schrittweise Migration zum Kontenplan-System.
- **Kontenplan wechseln**: Wenn Sie ein Unternehmen einem anderen Kontenplan zuweisen, behalten bestehende Ausgabenpositionen ihre aktuellen Konten (mit einer Warnung, falls sie nicht zum neuen Kontenplan passen), aber neue Positionen verwenden Konten aus dem neuen Kontenplan.

**Kontenpläne einrichten**: Gehen Sie zu **Stammdaten > Kontenpläne**, um Ihre Kontenplan-Sets anzuzeigen, zu erstellen oder zu verwalten. Sie können Kontenpläne von Grund auf erstellen oder aus Plattform-Vorlagen laden (länderspezifische Standard-Kontensets). Jedes Land kann einen Standard-Kontenplan haben, der automatisch neuen Unternehmen aus diesem Land zugewiesen wird.

**Tipp**: Wenn Sie beim Bearbeiten von OPEX/CAPEX-Positionen eine Warnung „Veraltetes Konto" sehen, bedeutet dies, dass das Konto nicht zum aktuellen Kontenplan des Unternehmens gehört. Aktualisieren Sie das Konto auf eines aus dem richtigen Kontenplan, um dies zu beheben.

## Status und Lebenszyklus

Verwenden Sie das **Ende der Gültigkeit**, um zu steuern, wann ein Unternehmen nicht mehr aktiv ist.

- Unternehmen sind standardmäßig **aktiviert**. Lassen Sie das **Ende der Gültigkeit** leer, damit das Unternehmen unbegrenzt aktiv bleibt, oder planen Sie ein zukünftiges Datum.
- Wenn Sie das Unternehmen ohne Datum auf **Deaktiviert** setzen, wird das Ende der Gültigkeit auf heute gesetzt.
- Sobald das Ende der Gültigkeit vorbei ist, wechselt der Status innerhalb einer Stunde von selbst auf **Deaktiviert**.
- Nach dem Ende der Gültigkeit:
    - Das Unternehmen erscheint nicht mehr in Auswahllisten für neue Zuordnungen und wird aus Berichten für strikt spätere Jahre ausgeschlossen.
    - Historische Daten bleiben erhalten; das Unternehmen erscheint weiterhin in Berichten, die Jahre abdecken, in denen es aktiv war.
- **Deaktivieren statt löschen.** Das Löschen ist nur möglich, wenn nichts das Unternehmen referenziert (keine Zuordnungen, Ausgaben oder Kostenstellen). Ein Unternehmen, zu dem Kostenstellen gehören, wird mit einer Meldung wie „Company A is used by 3 cost centers. Change their company or disable it instead." abgelehnt.

## Jahreskennzahlen

Viele Bereiche der App sind jahresbezogen. Unternehmen haben Kennzahlen pro Jahr:

- **Mitarbeiterzahl** (Pflicht für das Jahr)
- **IT-Benutzer** (optional)
- **Umsatz** (optional, in Millionen der Basiswährung des Unternehmens)

**Wo es relevant ist**:

- Zuordnungen können Mitarbeiterzahl, IT-Benutzer oder Umsatz verwenden, um Kosten für ein bestimmtes Jahr über Unternehmen zu verteilen.
- Berichte verwenden diese Kennzahlen für KPIs und Verhältniszahlen.
- Nur für ein Jahr aktive Unternehmen werden für die Zuordnung und Berichterstattung dieses Jahres berücksichtigt.

**Einfrieren und Kopieren**:

- Sie können ein Jahr nach Finalisierung **einfrieren**, um Bearbeitungen zu verhindern.
- Verwenden Sie die **Stammdaten-Administration**, um Kennzahlen von einem Jahr in ein anderes zu kopieren (wählen Sie, welche Kennzahlen kopiert werden sollen). Eingefrorene Jahre können nicht überschrieben werden.

## CSV-Import/Export

**CSV exportieren** lädt alle Unternehmen mit ihren Kennzahlen herunter. **CSV importieren** liest eine Datei wieder ein. Der Importdialog bietet außerdem **Vorlage herunterladen**: eine Datei nur mit den Kopfzeilen, bereit zum Ausfüllen.

Die Spalten in dieser Reihenfolge. Die Kennzahlenspalten folgen dem in der Symbolleiste der Liste gewählten Jahr: das Jahr davor, dieses Jahr und das Jahr danach.

| Spalte | Inhalt |
|---|---|
| `name` | Pflicht. Der Name des Unternehmens. Zeilen werden über diesen Namen zugeordnet |
| `country_iso` | Pflicht. Zwei Buchstaben |
| `address1`, `address2` | Adresszeilen |
| `postal_code`, `city`, `state` | Adressangaben |
| `reg_number`, `vat_number` | Handelsregisternummer und Umsatzsteuer-Identifikationsnummer |
| `base_currency` | Pflicht. Drei Buchstaben |
| `status` | `enabled` oder `disabled` |
| `disabled_at` | Das Ende der Gültigkeit: ein Datum (`2026-12-31`) oder ein vollständiges Datum mit Uhrzeit |
| `notes` | Freier Text |
| `headcount_<Jahr>` | Pflicht, wenn die Zeile für dieses Jahr eine Kennzahl trägt |
| `it_users_<Jahr>` | Eine ganze Zahl |
| `turnover_<Jahr>` | Bis zu 3 Nachkommastellen, in Millionen der Basiswährung des Unternehmens |

**Import**:

- Beginnen Sie mit der **Vorabprüfung**. Sie prüft die Kopfzeilen, die Kodierung, die Pflichtfelder, die Duplikate und die Kennzahlen. Ist die Prüfung sauber, wendet **Laden** die Einfügungen und Aktualisierungen an
- **Zuordnung**: über den `name` des Unternehmens. Ein Name, der zweimal in der Datei steht, wird einmal behalten, die erste Zeile gewinnt
- **Pflichtfelder**: `name`, `country_iso` und `base_currency`
- **Status und Ende der Gültigkeit**: Der Export schreibt den aus dem Ende der Gültigkeit abgeleiteten Status. Ein neues Unternehmen ist aktiviert, außer die Zeile sagt `disabled`. Bei einer Aktualisierung behalten ein leeres `status` und ein leeres `disabled_at` die gespeicherten Werte. `enabled` mit leerem Datum löscht das Ende der Gültigkeit. `disabled` mit leerem Datum behält ein bereits vergangenes Datum, andernfalls beendet es das Unternehmen heute
- Eine Zeile, deren Status ihrem Datum widerspricht, wird mit einem Zeilenfehler abgelehnt: „Status is enabled but the end of validity has passed. Clear the date or set the status to disabled. If the file comes from an older export, export the data again.“ oder „Status is disabled but the end of validity is still to come. Set the status to enabled or set a date that has passed.“
- **Kennzahlen**: Geben Sie für ein Jahr Kennzahlen an, ist `headcount_<Jahr>` für dieses Jahr Pflicht. `it_users_<Jahr>` und `turnover_<Jahr>` sind optional

**Hinweise**:

- Siehe [CSV-Dateien](master-data-operations.md#csv-dateien) für die Kodierung, das Trennzeichen, die Datums- und Betragsformen und die beiden Importschritte
- Die Liste aktualisiert sich nach einem erfolgreichen Laden automatisch

## Tipps

- **Deaktivieren statt löschen**: Bewahren Sie konsistente Historie und aussagekräftige Berichte.
- **Kontenplan**: Weisen Sie Unternehmen Kontenpläne zu, um eine konsistente Kontenverwendung bei OPEX/CAPEX-Positionen sicherzustellen.
- **Umsatz**: Geben Sie Werte in Millionen der Basiswährung des Unternehmens ein (z. B. 2,5 = 2,5 Millionen in dieser Währung).
- **Mitarbeiterzahl** ist der häufigste Zuordnungstreiber; halten Sie ihn für das aktuelle Jahr aktuell.
- **Eingefrorene Kennzahlen**: Sie können sie weiterhin einsehen, aber Bearbeitungen sind gesperrt, bis Sie sie in der Administration freigeben.
- **Spaltenauswahl**: Verwenden Sie sie, um Spalten wie Stadt, Adresse, Bundesland oder Erstellt je nach Bedarf ein- oder auszublenden.
- **Kennzahlenspalten verlinken zu Details**: Das Anklicken eines Mitarbeiterzahl-, IT-Benutzer- oder Umsatzwerts öffnet direkt den Details-Tab für dieses Unternehmen.
