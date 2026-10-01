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

Klicken Sie auf einen Unternehmensnamen in der Liste, um seinen Arbeitsbereich zu öffnen. Der Arbeitsbereich hat zwei Tabs, vertikal links angeordnet: **Übersicht** und **Details**.

Verwenden Sie **Zurück** / **Weiter**, um zwischen Unternehmen zu wechseln, ohne zur Liste zurückzukehren. Klicken Sie auf **Schließen** (X), um mit intaktem Suchkontext zur Liste zurückzukehren.

Bei nicht gespeicherten Änderungen fordert die App Sie auf, vor dem Tabwechsel, der Navigation zu einem anderen Unternehmen oder dem Jahreswechsel zu speichern.

---

### Übersicht

Der Übersichts-Tab enthält allgemeine Informationen über das Unternehmen.

**Was Sie bearbeiten können**:

- **Name** (Pflicht): der Anzeigename des Unternehmens
- **Land** (Pflicht): ISO-Ländercode, durchsuchbar nach Name oder Code
- **Kontenplan**: der mit diesem Unternehmen verknüpfte Kontenplan (siehe unten)
- **Adresse 1**, **Adresse 2**: Adresszeilen
- **Postleitzahl**: PLZ
- **Stadt** (Pflicht): Stadtname
- **Bundesland**: Bundesland oder Kanton
- **Registrierungsnr.**: Handelsregisternummer
- **USt-IdNr.**: Umsatzsteuer-Identifikationsnummer
- **Basiswährung** (Pflicht): ISO-Währungscode, durchsuchbar nach Name oder Code
- **Lebenszyklus**: der Statusschalter, dessen Beschriftung den aktuellen Zustand zeigt (**Aktiviert** oder **Deaktiviert**), und das Datum **Ende der Gültigkeit**. Siehe [Status und Lebenszyklus](#status-und-lebenszyklus)
- **Notizen**: Freitext-Notizen

---

### Details

Der Details-Tab verwaltet **Jahreskennzahlen**. Verwenden Sie die Jahrreiter oben, um zwischen Jahren zu wechseln (aktuelles Jahr plus zwei Jahre davor und danach).

**Was Sie bearbeiten können**:

- **Mitarbeiterzahl** (Pflicht): Gesamtzahl der Mitarbeiter für das Jahr, muss eine nicht-negative Ganzzahl sein
- **IT-Benutzer** (optional): Anzahl der IT-Benutzer, muss eine nicht-negative Ganzzahl sein
- **Umsatz** (optional): Erlös in Millionen der Basiswährung des Unternehmens, bis zu 3 Dezimalstellen

**Funktionsweise**:

- Jedes Speichern gilt nur für das aktuell ausgewählte Jahr
- Wenn Kennzahlen für das Jahr **eingefroren** sind, sind die Felder schreibgeschützt; geben Sie sie unter **Stammdaten-Administration** frei, um Änderungen vorzunehmen
- Sie benötigen `companies:manager`, um Kennzahlen zu bearbeiten

## Kontenplan

Jedes Unternehmen kann mit einem **Kontenplan** (CoA) verknüpft werden, der den Satz von Konten definiert, die beim Erfassen von OPEX- oder CAPEX-Positionen für dieses Unternehmen verfügbar sind.

**Funktionsweise**:

- Wenn Sie ein Unternehmen erstellen, wird es automatisch dem Standard-Kontenplan für sein Land zugewiesen (sofern vorhanden). Existiert kein Länder-Standard, wird der globale Standard-Kontenplan verwendet.
- Sie können die Kontenplan-Zuordnung im **Übersichts**-Tab des Unternehmens über den **Kontenplan**-Selektor ändern. Der Selektor zeigt Kontenpläne, die zum Land des Unternehmens passen, plus alle global gültigen Kontenpläne.
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

Halten Sie große Datensätze mit Ihren Quellsystemen per CSV synchron (Semikolon `;` getrennt).

**Export**:

- **Vorlage**: Datei nur mit Kopfzeilen, die Sie ausfüllen können (enthält dynamische Spalten für J-1, J, J+1 basierend auf dem ausgewählten Jahr)
- **Daten**: Aktuelle Unternehmen plus ihre Kennzahlen für J-1 / J / J+1

**Import**:

- Beginnen Sie mit der **Vorprüfung** (validiert Kopfzeilen, Kodierung, Pflichtfelder, Duplikate und Kennzahlen)
- Wenn die Vorprüfung OK ist, wendet **Laden** Neuanlagen und Aktualisierungen an
- Zuordnung erfolgt über den **Namen** des Unternehmens (innerhalb Ihres Arbeitsbereichs). Duplikate in der Datei werden nach Name dedupliziert (erstes Vorkommen gewinnt)
- **Pflichtfelder**: Name, Land (2 Buchstaben) und Basiswährung (3 Buchstaben). Die Stadt ist in der Datei optional
- **Optionales Feld**: `coa_code` (referenziert einen Kontenplan; wenn weggelassen, wird der Standard-Kontenplan des Landes verwendet)
- **Status und Ende der Gültigkeit**: `status` ist `enabled` oder `disabled`, und `disabled_at` ist das Ende der Gültigkeit, ein Datum (`2026-12-31`) oder ein vollständiges Datum mit Uhrzeit. Der Export schreibt den aus dem Ende der Gültigkeit abgeleiteten Status. Ein neues Unternehmen ist aktiviert, sofern die Zeile nicht `disabled` angibt. Bei einer Aktualisierung behalten ein leerer `status` und ein leeres `disabled_at` die gespeicherten Werte. `enabled` mit leerem Datum löscht das Ende der Gültigkeit. `disabled` mit leerem Datum behält ein bereits vergangenes Datum und beendet das Unternehmen sonst heute
- Eine Zeile, deren Status ihrem Datum widerspricht, wird mit einem Zeilenfehler abgelehnt: „Status is enabled but the end of validity has passed. Clear the date or set the status to disabled. If the file comes from an older export, export the data again.“ oder „Status is disabled but the end of validity is still to come. Set the status to enabled or set a date that has passed.“
- **Kennzahlen**: Wenn Sie Kennzahlen für ein Jahr angeben, ist die Mitarbeiterzahl für dieses Jahr Pflicht; IT-Benutzer und Umsatz sind optional. Umsatz akzeptiert bis zu 3 Dezimalstellen und muss in Millionen der Basiswährung des Unternehmens angegeben werden

**Hinweise**:

- Verwenden Sie **UTF-8-Kodierung** und **Semikolons** als Trennzeichen
- Die Liste wird nach einem erfolgreichen Laden automatisch aktualisiert
- Wenn Sie mit `coa_code` importieren, stellen Sie sicher, dass der Kontenplan in Ihrem Arbeitsbereich zuerst existiert

## Tipps

- **Deaktivieren statt löschen**: Bewahren Sie konsistente Historie und aussagekräftige Berichte.
- **Kontenplan**: Weisen Sie Unternehmen Kontenpläne zu, um eine konsistente Kontenverwendung bei OPEX/CAPEX-Positionen sicherzustellen.
- **Umsatz**: Geben Sie Werte in Millionen der Basiswährung des Unternehmens ein (z. B. 2,5 = 2,5 Millionen in dieser Währung).
- **Mitarbeiterzahl** ist der häufigste Zuordnungstreiber; halten Sie ihn für das aktuelle Jahr aktuell.
- **Eingefrorene Kennzahlen**: Sie können sie weiterhin einsehen, aber Bearbeitungen sind gesperrt, bis Sie sie in der Administration freigeben.
- **Spaltenauswahl**: Verwenden Sie sie, um Spalten wie Stadt, Adresse, Bundesland oder Erstellt je nach Bedarf ein- oder auszublenden.
- **Kennzahlenspalten verlinken zu Details**: Das Anklicken eines Mitarbeiterzahl-, IT-Benutzer- oder Umsatzwerts öffnet direkt den Details-Tab für dieses Unternehmen.
