# Unternehmen

Unternehmen bilden das Fundament Ihrer Stammdaten. Sie repräsentieren die juristischen Einheiten, denen Sie IT-Ausgaben zuordnen und für die Sie Leistungsverrechnungen erstellen. Jede Zuordnung, jede Budgetzeile und viele Berichte referenzieren ein Unternehmen, daher ist es wichtig, diese Daten korrekt zu halten.

Wenn Ihr Arbeitsbereich erstellt wird, beginnt er mit einem Unternehmen, das nach Ihrer Organisation benannt ist. Sein Land ist dasjenige, das Sie bei der Testanmeldung ausgewählt haben, und es wird automatisch dem Standard-Kontenplan für dieses Land zugewiesen, sobald einer verfügbar ist. Sie können es umbenennen oder weitere hinzufügen.

## Erste Schritte

Navigieren Sie zu **Stammdaten > Unternehmen**, um die Liste zu öffnen.

**Pflichtfelder**:

- **Name**: eine eindeutige Bezeichnung, die Ihre Teams kennen
- **Land**: ISO-Ländercode (nach Name oder Code durchsuchbar)
- **Stadt**: Stadt, in der das Unternehmen ansässig ist
- **Basiswährung**: ISO-Währungscode (nach Name oder Code durchsuchbar)

**Eindeutige Namen**: Jedes Unternehmen hat seinen eigenen Namen, unabhängig von Groß- und Kleinschreibung (`Acme` und `acme` sind derselbe Name). Ein Name, den bereits ein anderes Unternehmen trägt, wird abgelehnt, mit einer Meldung unter dem Namen.

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
| **Umsatz (Jahr)** | Umsatz für das ausgewählte Jahr, in Millionen der Basiswährung des Unternehmens, zum Beispiel `35 Mio. USD` (zum Öffnen des Details-Tabs anklicken) |
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

**Werte der Kennzahlen**:

- Eine Kennzahl, die für das Jahr nie erfasst wurde, zeigt **—**. Eine erfasste Null zeigt **0**
- Zahlen folgen der Sprache von KANAP: Dezimalkomma auf Deutsch, Französisch und Spanisch, Dezimalpunkt auf Englisch
- Der Umsatz jeder Zeile ist in der Basiswährung des Unternehmens. Die Zeile **Gesamt** ist in der Berichtswährung: Jeder Umsatz wird zu den Kursen des Jahres umgerechnet. Ist die Standard-Budgetspalte des Jahres eingefroren, sind das die Kurse, die sie festgeschrieben hat. Sonst sind es die aktuellen Kurse (siehe [Währungseinstellungen](currencies.md))
- Hat eine Währung noch keinen Kurs, bleibt ihr Umsatz aus der Summe heraus, und die Summe sagt es, zum Beispiel „1.250 Mio. EUR (noch kein Kurs für BRL)“. KANAP holt den fehlenden Kurs bei der nächsten Aktualisierung der Kurse

**Aktionen**:

- **Neu**: Unternehmen erstellen (erfordert `companies:member`)
- **CSV importieren**: Massenimport von Unternehmen aus einer CSV-Datei (erfordert `companies:admin`)
- **CSV exportieren**: Unternehmen und ihre Kennzahlen als CSV exportieren (erfordert `companies:admin`)
- **Ausgewählte löschen**: Ein oder mehrere ausgewählte Unternehmen löschen (erfordert `companies:admin`; nur möglich, wenn nichts das Unternehmen referenziert)

**Suchkontext**: Wenn Sie einen Unternehmens-Arbeitsbereich aus der Liste öffnen, werden Ihre aktuelle Suche, Filter, Sortierreihenfolge und das Jahr beibehalten. Die Rückkehr zur Liste stellt Ihre vorherige Ansicht wieder her.

## Berechtigungen

| Aktion | Erforderliche Stufe |
|--------|---------------------|
| Liste und Arbeitsbereiche anzeigen | `companies:reader` |
| Unternehmen erstellen oder bearbeiten | `companies:member` |
| Importieren, exportieren oder löschen | `companies:admin` |

## Der Unternehmens-Arbeitsbereich

Klicken Sie auf eine beliebige Zeile der Liste, um den Arbeitsbereich des Unternehmens zu öffnen. Er hat zwei Tabs: **Übersicht** und **Details**.

- **Kopfzeile**: der Name des Unternehmens. Klicken Sie darauf, um das Unternehmen umzubenennen. Die Pfeile mit „N von M" wechseln zwischen Unternehmen in der Reihenfolge und mit den Filtern der Liste, ohne zur Liste zurückzukehren. Der Zurück-Link **Unternehmen** führt mit erhaltenem Suchkontext zur Liste zurück
- **Status**, unter dem Namen: **Aktiviert** oder **Deaktiviert**. Klicken Sie darauf, um ihn zu ändern. Die Wahl von **Deaktiviert** deaktiviert das Unternehmen sofort: Das Ende der Gültigkeit wird auf den aktuellen Zeitpunkt gesetzt
- **Bereich Eigenschaften** rechts: **Land**, **Basiswährung**, **Kontenplan** und **Lebenszyklus**. Mit der Schaltfläche daneben klappen Sie den Bereich ein oder wieder aus

- **Löschen**, oben rechts: sichtbar für Unternehmensadministratoren (`companies:admin`). Siehe [Ein Unternehmen löschen](#ein-unternehmen-loschen)

**Automatisches Speichern**: Jede Änderung wird von selbst gespeichert, sobald Sie das Feld verlassen. Es gibt keine Schaltflächen zum Speichern, Zurücksetzen oder Schließen. Sie können weiterarbeiten, während eine Änderung gespeichert wird. Oben auf der Seite steht **Wird gespeichert…**, solange gespeichert wird, dann kurz **Gespeichert**. Wird eine Änderung abgelehnt, zeigt das Feld wieder seinen vorherigen Wert und darunter den Grund. Die Meldung bleibt, bis Sie wieder in das Feld tippen.

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
- **Umsatz** (optional): Umsatz in Millionen der Basiswährung des Unternehmens, bis zu 3 Dezimalstellen. Die Beschriftung nennt die Währung, zum Beispiel **Umsatz (Mio. USD)**

**So funktioniert es**:

- Jeder Wert wird für das ausgewählte Jahr gespeichert, wenn Sie das Feld verlassen (oder die Eingabetaste drücken). Ein ungültiger Wert zeigt unter dem Feld eine Meldung, zum Beispiel „Geben Sie eine ganze Zahl ein, 0 oder mehr." Das Feld zeigt wieder den gespeicherten Wert, und die Meldung bleibt, bis Sie erneut tippen
- Zahlen folgen der Sprache von KANAP: Geben Sie auf Deutsch, Französisch oder Spanisch `12,5` ein, auf Englisch `12.5`
- Jedes Jahr wird für sich gespeichert: Beim Jahreswechsel werden die Werte dieses Jahres geladen
- Sind die Unternehmenszahlen des Jahres **eingefroren**, sind die Felder gesperrt, und ein Hinweis besagt, dass ein Budgetadministrator sie wieder freigeben kann (**Budgetverwaltung > Administration > Stammdaten einfrieren**)
- Für das Bearbeiten der Kennzahlen benötigen Sie `companies:member`

## Kontenplan

Jedes Unternehmen kann mit einem **Kontenplan** (CoA) verknüpft werden, der den Satz von Konten definiert, die beim Erfassen von OPEX- oder CAPEX-Zeilen für dieses Unternehmen verfügbar sind.

**Funktionsweise**:

- Wenn Sie ein Unternehmen erstellen, wird es automatisch dem Standard-Kontenplan für sein Land zugewiesen (sofern vorhanden). Existiert kein Länderstandard, wird der Kontenplan mit der Rolle **Standard für andere Länder** verwendet.
- Sie können die Kontenplan-Zuordnung im Bereich **Eigenschaften** über den **Kontenplan**-Selektor ändern. Der Selektor zeigt Kontenpläne, die zum Land des Unternehmens passen, plus alle global gültigen Kontenpläne.
- Wenn Sie das Land des Unternehmens ändern, folgt der Kontenplan, sofern der aktuelle zu einem anderen Land gehört: Er wechselt zum Standard des neuen Landes. Ein globaler Kontenplan bleibt bestehen.
- Bei einem bestehenden Unternehmen kann der Kontenplan nicht geleert werden. Sie können ihn nur durch einen anderen ersetzen.
- Der von Ihnen ausgewählte Kontenplan bestimmt, welche Konten im Konto-Dropdown beim Erstellen oder Bearbeiten von Ausgabenzeilen für dieses Unternehmen erscheinen.

**Was dies für Ihren Workflow bedeutet**:

- **Unternehmen mit Kontenplan**: Beim Erfassen von OPEX/CAPEX können Sie nur Konten auswählen, die zum Kontenplan dieses Unternehmens gehören. Dies gewährleistet buchhalterische Konsistenz.
- **Unternehmen ohne Kontenplan** (Legacy): Können Konten verwenden, die keinem Kontenplan zugehören. Dies unterstützt die schrittweise Migration zum Kontenplan-System.
- **Kontenplan wechseln**: Wenn Sie ein Unternehmen einem anderen Kontenplan zuweisen, behalten bestehende Ausgabenzeilen ihre aktuellen Konten (mit einer Warnung, falls sie nicht zum neuen Kontenplan passen), aber neue Budgetzeilen verwenden Konten aus dem neuen Kontenplan.

**Kontenpläne einrichten**: Gehen Sie zu **Stammdaten > Kontenpläne**, um Ihre Kontenplan-Sets anzuzeigen, zu erstellen oder zu verwalten. Sie können Kontenpläne von Grund auf erstellen oder aus Plattform-Vorlagen laden (länderspezifische Standard-Kontensets). Jedes Land kann einen Standard-Kontenplan haben (**Länderstandard ({country})**), der vorgeschlagen wird, wenn Sie ein Unternehmen in diesem Land anlegen. Unternehmen in einem Land ohne Standard verwenden den Kontenplan **Standard für andere Länder**. Siehe [Rollen der Kontenpläne](chart-of-accounts.md#rollen-der-kontenplane).

**Tipp**: Wenn Sie beim Bearbeiten von OPEX/CAPEX-Zeilen eine Warnung „Veraltetes Konto" sehen, bedeutet dies, dass das Konto nicht zum aktuellen Kontenplan des Unternehmens gehört. Aktualisieren Sie das Konto auf eines aus dem richtigen Kontenplan, um dies zu beheben.

## Status und Lebenszyklus

Verwenden Sie das **Ende der Gültigkeit**, um zu steuern, wann ein Unternehmen nicht mehr aktiv ist.

- Unternehmen sind standardmäßig **aktiviert**. Lassen Sie das **Ende der Gültigkeit** leer, damit das Unternehmen unbegrenzt aktiv bleibt, oder planen Sie ein zukünftiges Datum.
- Ein Wechsel auf **Deaktiviert** setzt das Ende der Gültigkeit auf jetzt: Die Deaktivierung gilt sofort. Solange ein zukünftiges Datum gesetzt ist, zeigt der Schalter **Aktiv bis** und dieses Datum.
- Sobald das Ende der Gültigkeit vorbei ist, wechselt der Status innerhalb einer Stunde von selbst auf **Deaktiviert**.
- Nach dem Ende der Gültigkeit:
    - Das Unternehmen erscheint nicht mehr in Auswahllisten für neue Zuordnungen und wird aus Berichten für strikt spätere Jahre ausgeschlossen.
    - Historische Daten bleiben erhalten; das Unternehmen erscheint weiterhin in Berichten, die Jahre abdecken, in denen es aktiv war.
- **Deaktivieren statt löschen.** Ein Unternehmen, das noch verwendet wird, kann nicht gelöscht werden: von Budgetzeilen (als zahlendes Unternehmen oder in ihren Zuordnungen), Verträgen, Kostenstellen, Abteilungen, Benutzern, den Standorten, die es betreibt, Aufgaben, Anwendungen, Schnittstellen, Portfolio-Projekten und -Anfragen sowie Teammitgliedern, deren Standardunternehmen es ist. Die Meldung zählt auf, was es verwendet, zum Beispiel „Dieses Unternehmen wird noch verwendet: 2 Abteilungen und 14 Benutzer“. Deaktivieren Sie es stattdessen. Seine Jahreskennzahlen werden mit ihm gelöscht. In der Liste nennt die Bestätigung die so erhaltenen Unternehmen mit dem, was sie verwendet, bevor etwas gelöscht wird.
- **Um ein Unternehmen dennoch zu löschen**, entfernen Sie zuerst, was es verwendet. Tragen Sie bei seinen Benutzern, Budgetzeilen und deren Zuordnungen, Verträgen, Kostenstellen, den Standorten, die es betreibt, Aufgaben, Anwendungen, Schnittstellen, Portfolio-Projekten und -Anfragen sowie Teammitgliedern ein anderes Unternehmen ein. Verschieben Sie seine Abteilungen in ein anderes Unternehmen, oder löschen Sie sie zuletzt, wenn nichts sie mehr verwendet. Löschen Sie dann das Unternehmen.

## Ein Unternehmen löschen

Ein Unternehmensadministrator (`companies:admin`) kann ein Unternehmen auf seiner Seite mit **Löschen** löschen, oder mehrere in der Liste mit **Ausgewählte löschen**.

- KANAP prüft zuerst. Wird das Unternehmen noch verwendet, sagt der Dialog wofür, zum Beispiel „Dieses Unternehmen wird noch verwendet: 2 Abteilungen und 14 Benutzer. Deaktivieren Sie es, statt es zu löschen.“, und bietet nur **Schließen** an. Deaktivieren Sie das Unternehmen dann (siehe [Status und Lebenszyklus](#status-und-lebenszyklus))
- Sonst fragt der Dialog nach einer Bestätigung: „Dies kann nicht rückgängig gemacht werden.“ **Löschen** löscht das Unternehmen mit seinen Jahreskennzahlen und kehrt zur Liste zurück
- Ein gelöschtes Unternehmen verschwindet aus der Kachel **Kürzlich angesehen** von [Mein Dashboard](my-dashboard.md#kurzlich-angesehen)

## Jahreskennzahlen

Viele Bereiche der App sind jahresbezogen. Unternehmen haben Kennzahlen pro Jahr:

- **Mitarbeiterzahl** (Pflicht für das Jahr)
- **IT-Benutzer** (optional)
- **Umsatz** (optional, in Millionen der Basiswährung des Unternehmens)

**Wo es relevant ist**:

- Zuordnungen können Mitarbeiterzahl, IT-Benutzer oder Umsatz verwenden, um Kosten für ein bestimmtes Jahr über Unternehmen zu verteilen. Umsätze in verschiedenen Währungen werden zuerst in die Berichtswährung umgerechnet. Siehe [Zuordnungen](budget-lines.md#zuordnungen).
- Berichte verwenden diese Kennzahlen für KPIs und Verhältniszahlen.
- Nur für ein Jahr aktive Unternehmen werden für die Zuordnung und Berichterstattung dieses Jahres berücksichtigt.

**Einfrieren und Kopieren**:

- Sie können ein Jahr nach Finalisierung **einfrieren**, um Bearbeitungen zu verhindern.
- Verwenden Sie **Jahreskennzahlen kopieren** unter **Budgetverwaltung > Administration**, um Kennzahlen von einem Jahr in ein anderes zu kopieren (wählen Sie, welche Kennzahlen kopiert werden sollen). Eingefrorene Jahre können nicht überschrieben werden.

## CSV-Import/Export

**CSV exportieren** lädt die Unternehmen der Liste (oder, auf Wunsch im Dialog, alle Unternehmen) mit ihren Kennzahlen herunter. **CSV importieren** liest eine Datei wieder ein. Der Importdialog bietet außerdem **Vorlage herunterladen**: eine Datei mit den Kopfzeilen und einer Beispielzeile, einem fiktiven Unternehmen mit Kennzahlen für das Jahr der Liste. Ersetzen Sie sie durch Ihre eigenen Zeilen.

Die Spalten in dieser Reihenfolge. Die Kennzahlenspalten folgen dem in der Symbolleiste der Liste gewählten Jahr: das Jahr davor, dieses Jahr und das Jahr danach.

| Spalte | Inhalt |
|---|---|
| `name` | Pflicht. Der Name des Unternehmens. Zeilen werden über diesen Namen zugeordnet |
| `country_iso` | Pflicht. Zwei Buchstaben |
| `address1`, `address2` | Adresszeilen |
| `postal_code`, `state` | Adressangaben |
| `city` | Pflicht. Die Stadt |
| `reg_number`, `vat_number` | Handelsregisternummer und Umsatzsteuer-Identifikationsnummer |
| `base_currency` | Pflicht. Drei Buchstaben |
| `status` | `enabled` oder `disabled` |
| `disabled_at` | Das Ende der Gültigkeit: ein Datum (`2026-12-31`) oder ein vollständiges Datum mit Uhrzeit. Der Export schreibt nur das Datum. Erneut importiert, behält dieses Datum das gespeicherte Gültigkeitsende |
| `notes` | Freier Text |
| `headcount_<Jahr>` | Eine ganze Zahl. Pflicht, wenn die Zeile für dieses Jahr eine Kennzahl trägt |
| `it_users_<Jahr>` | Eine ganze Zahl |
| `turnover_<Jahr>` | Bis zu 3 Nachkommastellen, in Millionen der Basiswährung des Unternehmens |

**Import**:

- Beginnen Sie mit der **Vorabprüfung**. Sie prüft die Kopfzeilen, die Kodierung, die Pflichtfelder, die Duplikate und die Kennzahlen. Ist die Prüfung sauber, wendet **Laden** die Einfügungen und Aktualisierungen an. Danach zählt der Dialog die erstellten, aktualisierten und unveränderten Unternehmen, zum Beispiel „2 erstellt, 5 aktualisiert, 30 unverändert“
- **Zuordnung**: über den `name` des Unternehmens, unabhängig von Groß- und Kleinschreibung. Die gespeicherte Schreibweise bleibt: Eine Zeile `ACME` aktualisiert `Acme`, und die Vorabprüfung meldet „ACME“ wurde „Acme“ zugeordnet
- **Eine Zeile pro Unternehmen**: Ein Name, der zweimal in der Datei steht, unabhängig von Groß- und Kleinschreibung, wird schon bei der Prüfung abgelehnt: „„Acme“ steht bereits in Zeile 4. Verwenden Sie eine Zeile pro Unternehmen.“
- **Pflichtfelder**: `name`, `country_iso`, `city` und `base_currency`. Eine leere Stadt wird schon bei der Prüfung abgelehnt, für ein neues Unternehmen wie für eine Aktualisierung
- **Status und Ende der Gültigkeit**: Der Export schreibt den aus dem Ende der Gültigkeit abgeleiteten Status. Ein neues Unternehmen ist aktiviert, außer die Zeile sagt `disabled`. Bei einer Aktualisierung behalten ein leeres `status` und ein leeres `disabled_at` die gespeicherten Werte. `enabled` mit leerem Datum löscht das Ende der Gültigkeit. `disabled` mit leerem Datum behält ein bereits vergangenes Datum, andernfalls beendet es das Unternehmen heute
- Eine Zeile, deren Status ihrem Datum widerspricht, wird mit einem Zeilenfehler abgelehnt: „Status is enabled but the end of validity has passed. Clear the date or set the status to disabled. If the file comes from an older export, export the data again.“ oder „Status is disabled but the end of validity is still to come. Set the status to enabled or set a date that has passed.“
- **Gelesene Jahre**: Der Dialog nennt die Jahre, die er liest, zum Beispiel „Gelesene Kennzahlen: 2025, 2026, 2027, nach dem Jahr der Liste. Jedes Jahr ist optional.“
- **Jedes Jahr ist optional**: Ein Jahr ist ein Block aus drei Spalten, `headcount_<Jahr>`, `it_users_<Jahr>` und `turnover_<Jahr>`. Lassen Sie den ganzen Block weg, bleiben die gespeicherten Kennzahlen dieses Jahres unverändert. Eine Spalte eines Jahres außerhalb der drei gelesenen Jahre wird ignoriert, und die Prüfung führt sie bei den ignorierten Spalten auf
- **Ein Jahr kommt vollständig**: Eine Datei mit einer oder zwei Spalten eines Jahres ohne die anderen wird in der Zeile **Kopfzeile** abgelehnt, die die fehlenden Spalten nennt
- **Kennzahlen**: Trägt eine Zeile eine Kennzahl für ein Jahr, ist `headcount_<Jahr>` für dieses Jahr Pflicht. `it_users_<Jahr>` und `turnover_<Jahr>` dürfen leer bleiben
- **Eingefrorene Jahre**: Eine Zeile mit Kennzahlen für ein Jahr, dessen Unternehmenskennzahlen eingefroren sind, wird schon bei der Prüfung abgelehnt: „Die Kennzahlen für 2025 sind eingefroren. Ein Budgetadministrator kann die Sperre aufheben.“ Lassen Sie die Spalten dieses Jahres weg, oder heben Sie zuerst das Einfrieren des Jahres auf (siehe [Stammdaten einfrieren](master-data-operations.md))

**Hinweise**:

- Siehe [CSV-Dateien](csv-files.md) für die Kodierung, das Trennzeichen, die Datums- und Betragsformen und die beiden Importschritte
- Die Liste aktualisiert sich nach einem erfolgreichen Laden automatisch

## Tipps

- **Deaktivieren statt löschen**: Bewahren Sie konsistente Historie und aussagekräftige Berichte.
- **Kontenplan**: Weisen Sie Unternehmen Kontenpläne zu, um eine konsistente Kontenverwendung bei OPEX/CAPEX-Zeilen sicherzustellen.
- **Umsatz**: Geben Sie Werte in Millionen der Basiswährung des Unternehmens ein (z. B. 2,5 = 2,5 Millionen in dieser Währung).
- **Mitarbeiterzahl** ist der häufigste Zuordnungstreiber; halten Sie ihn für das aktuelle Jahr aktuell.
- **Eingefrorene Kennzahlen**: Sie können sie weiterhin einsehen, aber Bearbeitungen sind gesperrt, bis ein Budgetadministrator das Jahr unter **Budgetverwaltung > Administration > Stammdaten einfrieren** freigibt.
- **Spaltenauswahl**: Verwenden Sie sie, um Spalten wie Stadt, Adresse, Bundesland oder Erstellt je nach Bedarf ein- oder auszublenden.
- **Kennzahlenspalten verlinken zu Details**: Das Anklicken eines Mitarbeiterzahl-, IT-Benutzer- oder Umsatzwerts öffnet direkt den Details-Tab für dieses Unternehmen.
