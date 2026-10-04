# Ein Budget aus einer Tabellenkalkulation laden

Die meisten Teams erstellen ihr Budget in einer Tabellenkalkulation: eine Zeile pro Position, eine Spalte pro Jahr oder pro Monat. KANAP führt dieselben Positionen in seinen OPEX- und CAPEX-Listen, wo sie die Zuordnungen, Berichte und die Übersicht speisen.

Die Budgetdatei verbindet beides. Exportieren Sie die Positionen, ändern Sie die Zellen, die Sie bearbeiten möchten, in Excel oder LibreOffice und importieren Sie die Datei anschließend. KANAP vergleicht jede Zelle mit dem gespeicherten Stand und schreibt nur, was sich geändert hat.

Es gibt eine Datei pro Liste. Die OPEX-Liste exportiert und importiert die OPEX-Datei, die CAPEX-Liste die CAPEX-Datei. Beide Dateien tragen dieselben Spalten und folgen denselben Regeln.

## Wo Sie es finden

- Pfad: **Budgetverwaltung > OPEX** oder **Budgetverwaltung > CAPEX**
- Export: **CSV exportieren** in der Symbolleiste der Liste
- Import: **CSV importieren** in derselben Symbolleiste
- Berechtigungen: Beide Schaltflächen erfordern Administrationsrechte auf dieser Liste (`opex:admin` oder `capex:admin`)

## Export

1. Klicken Sie in der OPEX- oder CAPEX-Liste auf **CSV exportieren**.
2. Wählen Sie, was die Datei enthält:

| Einstellung | Wirkung |
|---|---|
| **Positionen** | Die Positionen, die die Liste zeigt, mit ihrer Suche, ihren Filtern und ihrem Statusumfang. **Alle Positionen** exportiert stattdessen alle Positionen, beendete eingeschlossen, ohne die Filter der Liste |
| **Jahre** | **Erstes Jahr** und **Letztes Jahr**, bis zu zwölf Jahre. Standard: das laufende Jahr, das davor und das danach |
| **Spalten** | Die zu schreibenden Budgetspalten. Die Spalten, die Ihre Organisation zeigt, sind angehakt, und eine ausgeblendete Spalte ist mit **ausgeblendet** markiert. Ihre Überschrift steht unter dem Namen, zum Beispiel `budget_2027` |
| **Detail** | **Jahressummen**: eine Spalte pro Budgetspalte und Jahr. **Monate**: eine Spalte pro Budgetspalte, Jahr und Monat |

3. Klicken Sie auf die Schaltfläche am unteren Rand des Fensters. Sie benennt, was die Datei enthält: **120 gefilterte Positionen exportieren**, **Alle Positionen exportieren**, **3.412 Positionen exportieren** und so weiter.

Die Datei wird in der Sprache geschrieben, in der die Oberfläche angezeigt wird.

| Sprache | Trennzeichen | Beträge | Datumsangaben |
|---|---|---|---|
| Englisch | `,` | `12280.50` | `2027-03-01` |
| Französisch, Spanisch | `;` | `12280,50` | `01/03/2027` |
| Deutsch | `;` | `12280,50` | `01.03.2027` |

Der Export einer Liste ohne Positionen ergibt die Kopfzeile allein. Das ist Ihre Vorlage.

## Die Spalten

Eine Datei enthält eine Zeile pro Position: die Detailspalten, dann die Betragsspalten, dann `kanap_token`.

### Detailspalten

Sie sind in beiden Dateien gleich, außer den typspezifischen Spalten am Zeilenanfang.

**OPEX**

| Spalte | Inhalt | Bei einer neuen Position |
|---|---|---|
| `item_number` | Die Nummer der Position: `OPX-12` oder `12` | Leer: Die Zeile legt eine Position an |
| `name` | Produktname | Erforderlich |
| `description` | Die ausführliche Beschreibung | Optional |
| `company_name` | Zahlendes Unternehmen | Erforderlich, außer die Position hat eine Kostenstelle |
| `supplier_name` | Name des Lieferanten | Optional |
| `supplier_erp_id` | Die ID des Lieferanten in Ihrem ERP | Optional |
| `account_number` | Kontonummer, im Kontenplan des zahlenden Unternehmens | Erforderlich |
| `cost_center_code` | Code der Kostenstelle. Eine Gruppe wird abgelehnt | Optional |
| `run_build` | `run` oder `build` | Optional |
| `analytics:<code>` | Der Name des Werts in der Dimension, deren Code dies ist. Eine Spalte pro Dimension, die Standarddimension eingeschlossen | Optional. Ein nicht vorhandener Wert wird beim Laden angelegt |
| `owner_it_email` | E-Mail-Adresse eines aktiven Benutzers | Optional |
| `owner_business_email` | E-Mail-Adresse eines aktiven Benutzers | Optional |
| `project` | Projektnummer, zum Beispiel `PRJ-3` | Optional |
| `currency` | ISO-Code mit drei Buchstaben, aus den in Ihrem Arbeitsbereich erlaubten Währungen | Erforderlich |
| `effective_start` | Der Tag, an dem die Position beginnt | Der 1. Januar des ersten Jahres mit einem Betrag in der Zeile, sonst des laufenden Jahres |
| `end_of_validity` | Der Tag, an dem die Position endet | Kein Ende |
| `notes` | Freier Text | Optional |

**CAPEX**

| Spalte | Inhalt | Bei einer neuen Position |
|---|---|---|
| `item_number` | Die Nummer der Position: `CPX-3` oder `3` | Leer: Die Zeile legt eine Position an |
| `name` | Der Titel der Investition | Erforderlich |
| `ppe_type` | `hardware` oder `software` | Erforderlich |
| `investment_type` | `replacement`, `capacity`, `productivity`, `security`, `conformity`, `business_growth` oder `other` | Erforderlich |
| `priority` | `mandatory`, `high`, `medium` oder `low` | Erforderlich |
| `company_name` | Zahlendes Unternehmen | Erforderlich, außer die Position hat eine Kostenstelle |
| `supplier_name` | Name des Lieferanten | Optional |
| `supplier_erp_id` | Die ID des Lieferanten in Ihrem ERP | Optional |
| `account_number` | Kontonummer, im Kontenplan des zahlenden Unternehmens | Erforderlich |
| `cost_center_code` | Code der Kostenstelle. Eine Gruppe wird abgelehnt | Optional |
| `run_build` | `run` oder `build` | Optional |
| `analytics:<code>` | Der Name des Werts in der Dimension, deren Code dies ist. Eine Spalte pro Dimension, die Standarddimension eingeschlossen | Optional. Ein nicht vorhandener Wert wird beim Laden angelegt |
| `owner_it_email` | E-Mail-Adresse eines aktiven Benutzers | Optional |
| `owner_business_email` | E-Mail-Adresse eines aktiven Benutzers | Optional |
| `project` | Projektnummer, zum Beispiel `PRJ-3` | Optional |
| `currency` | ISO-Code mit drei Buchstaben, aus den in Ihrem Arbeitsbereich erlaubten Währungen | Erforderlich |
| `effective_start` | Der Tag, an dem die Position beginnt | Der 1. Januar des ersten Jahres mit einem Betrag in der Zeile, sonst des laufenden Jahres |
| `end_of_validity` | Der Tag, an dem die Position endet | Kein Ende |
| `notes` | Freier Text | Optional |

### Betragsspalten

Eine Betragsspalte trägt den Namen der Budgetspalte und das Jahr: `budget_2027`. Mit dem Detail **Monate** kommt der Monat hinzu: `budget_2027_03`.

| Name in der Datei | Die Spalte in der Anwendung |
|---|---|
| `budget` | Die erste Spalte, standardmäßig Budget genannt |
| `revision` | Die zweite Spalte, standardmäßig Revision genannt |
| `forecast` | Die dritte Spalte, standardmäßig Prognose genannt |
| `actual` | Die vierte Spalte, standardmäßig Ist-Werte genannt |
| `landing` | Die fünfte Spalte, standardmäßig Erwarteter Endwert genannt |

Das sind die Standardnamen. Ihre Organisation kann die fünf Spalten in [Budgetspalten](budget-operations.md#budgetspalten) umbenennen, einige ausblenden und eine Standardspalte wählen. Die Datei schreibt immer den technischen Namen oben, wie Ihre Spalten auf dem Bildschirm auch heißen.

### Die letzte Spalte

`kanap_token` wird von KANAP geschrieben. Lassen Sie ihn unverändert. KANAP nutzt ihn, um Ihnen zu sagen, dass sich eine Position nach Ihrem Export geändert hat. Lassen Sie ihn in einer Zeile, die Sie hinzufügen, leer.

## Was eine Zelle bedeutet

- Eine leere Zelle behält den gespeicherten Wert.
- `-` löscht ein Detail der Position: Beschreibung, Notizen, Name und ERP-ID des Lieferanten, Kostenstelle, Run oder Build, einen Dimensionswert, einen Verantwortlichen, das Projekt, das Ende der Gültigkeit. In einer Spalte, die eine neue Position füllen muss, ist `-` ein Zeilenfehler.
- `0` schreibt null.
- Eine Jahressumme, die der gespeicherten Summe entspricht, schreibt nichts. Eine abweichende Summe wird über den Zeitraum der Spalte verteilt, genau wie bei der Eingabe der Summe im **Budget-Tab**.
- Eine Monatszelle schreibt diesen Monat und markiert die Spalte als manuell bearbeitet, wie ein im **Budget-Tab** eingegebener Monat.
- Ein Betrag hat höchstens zwei Nachkommastellen. Eine Betragszelle lässt sich nicht mit `-` löschen: Schreiben Sie `0`, oder lassen Sie die Zelle leer.
- Eine Datei kann die Jahressumme einer Spalte und eines Jahres enthalten oder deren zwölf Monate, niemals beides.

Eine fehlende Spalte behält alle gespeicherten Werte dieser Spalte. Eine Datei, die nur `item_number` und einige Betragsspalten enthält, ist eine gültige Datei.

## Positionen hinzufügen und zuordnen

- `item_number` gefüllt: Diese Position wird aktualisiert. Leer: Es wird eine neue Position angelegt.
- Es gibt keinen weiteren Schlüssel. Eine neue Zeile, die einer bestehenden Position ähnelt oder einer anderen neuen Zeile derselben Datei, ist eine Warnung, die Sie ignorieren können.
- Lieferanten werden über `supplier_erp_id` zugeordnet, wenn er gefüllt ist, sonst über `supplier_name`. Einen Lieferanten, den die Datei nennt und den KANAP nicht kennt, legt das Laden an, wenn **Fehlende Lieferanten anlegen** angehakt ist. Ohne diese Option listet die Prüfung die fehlenden Lieferanten auf und bittet Sie, sie unter **Stammdaten > Lieferanten** anzulegen.
- Ein nicht vorhandener Dimensionswert wird beim Laden angelegt und in der Prüfung aufgelistet. Konten, Kostenstellen, Unternehmen und Benutzer werden nie angelegt: Ein unbekanntes Element ist ein Zeilenfehler, der nennt, wo es hinzugefügt wird.
- Projekte werden über ihre Nummer zugeordnet, zum Beispiel `PRJ-3`.
- Eine beendete Position ist eine Position, deren `end_of_validity` verstrichen ist. Setzen Sie das Datum, um eine Position zu beenden, oder schreiben Sie `-` in die Zelle, um es zu löschen und die Position weiterlaufen zu lassen. Es gibt keine Statusspalte.

## Prüfen, dann laden

1. Klicken Sie auf **CSV importieren** und wählen Sie die Datei, oder legen Sie sie im Fenster ab. Die Datei wird sofort geprüft. Nichts wird geschrieben.
2. Lesen Sie den Bericht:

| Abschnitt | Inhalt |
|---|---|
| **Fehler** | Die Zeilen, die das Laden ablehnt, nach Zeile der Datei mit der Spalte, wenn sie bekannt ist. Eine Datei mit einem einzigen Fehler lädt nichts |
| **Änderungen** | Die anzulegenden Positionen, die zu aktualisierenden Positionen und die Positionen, die die Datei unverändert lässt |
| **Seit dem Export in KANAP geändert** | Die Positionen, die jemand nach Ihrem Export geändert hat, mit wer und wann. Das Laden der Datei schreibt Ihre Werte über diese Änderungen |
| **Warnungen** | Eine Zeile, die einer anderen Position ähnelt, Spalten, die die Datei ignoriert |
| **Beim Laden angelegt** | Die Lieferanten und Dimensionswerte, die das Laden hinzufügen würde |

3. Klicken Sie auf **Laden**. Das Laden schreibt alles oder nichts.

Ändert sich eine Position zwischen der Prüfung und dem Laden, stoppt das Laden und bittet Sie, die Datei erneut zu prüfen. Die Prüfung sagt außerdem, wie sie die Datei gelesen hat, wenn ein Datum oder ein Betrag auf zwei Arten gelesen werden konnte, mit einer Schaltfläche zum Wechseln der Lesart.

## Excel und LibreOffice

Die Datei zu öffnen und zu speichern lässt sie ladbar. Beide Programme behalten die Spalten, das Trennzeichen und die Werte.

Ein Datum oder ein Betrag, den die Datei nicht selbst entscheiden kann, wird so gelesen, wie der Export ihn geschrieben hat, dann in der Sprache, in der die Oberfläche angezeigt wird. Jedes Datum mit einem Tag bis 12 ist mehrdeutig (`01/03/2027` ist auf Französisch der 1. März und auf Englisch der 3. Januar), und ein Betrag wie `12,280` ebenfalls. Die Prüfung sagt, wie sie gelesen wurden, und bietet eine Schaltfläche zum Wechseln der Lesart.

Eine Spalte, die KANAP nicht kennt, wird mit einer Warnung ignoriert. Eine Spalte, die wie eine falsch geschriebene Betragsspalte aussieht, zum Beispiel `budjet_2027`, lehnt die ganze Datei ab.

## Dateien aus früheren Versionen

Eine Datei in einem älteren Format wird als Ganzes abgelehnt: die Positionsdateien mit Spalten der Art `y_budget` und die Datei der Budgetzeilen mit den Spalten `measure` und `jan` … `dec`. Der Bildschirm zeigt diese Meldung:

> Diese Datei stammt aus einer früheren Version von KANAP. Exportieren Sie eine neue Datei aus dieser Liste, übertragen Sie Ihre Änderungen hinein und importieren Sie sie erneut.

Exportieren Sie eine neue Datei und übertragen Sie Ihre Zeilen hinein.

## Ein ganzes Budget laden

Die Budgetdatei enthält Budgetpositionen. Das zahlende Unternehmen, das Konto, die Kostenstelle, der Lieferant und die Benutzer, die eine Position nennt, müssen zuerst existieren. Ein kleines Team lädt sie in dieser Reihenfolge:

1. Einen Kontenplan und seine Konten, unter [Kontenpläne](chart-of-accounts.md)
2. Die Unternehmen, unter [Unternehmen](companies.md)
3. Die OPEX-Datei, mit angehaktem **Fehlende Lieferanten anlegen**
4. Die CAPEX-Datei, mit angehaktem **Fehlende Lieferanten anlegen**

Eine größere Organisation fügt dazwischen die übrigen Stammdaten hinzu:

1. Den Kontenplan und seine Konten
2. Die Unternehmen
3. Die Benutzer, unter [Benutzer](admin.md)
4. Die Kostenstellen, unter [Kostenstellen](cost-centers.md)
5. Die Lieferanten, unter [Lieferanten](suppliers.md)
6. Die Dimensionswerte, unter [Analysedimensionen](analytics.md). Die Dimensionen selbst werden auf dieser Seite angelegt
7. Die Arbeitstagekalender, unter [Arbeitstagekalender](working-day-calendars.md), sobald Positionen Mengen und Preise tragen
8. Die OPEX-Datei
9. Die CAPEX-Datei

**Der Kontenplan kommt zuerst.** Klicken Sie auf der Seite Kontenpläne auf **Neu**, geben Sie dem Plan einen Code und einen Namen und wählen Sie den Geltungsbereich **Global**. Öffnen Sie dann **Verwalten** und klicken Sie auf **Als globalen Standard festlegen**. Ein Unternehmen ohne Kontenplan übernimmt diesen, und so werden die Kontonummern einer Budgetdatei aufgelöst. Wählen Sie den Plan auf der Seite aus und klicken Sie dann auf **CSV importieren**, um seine Konten zu laden.

Jede dieser Seiten hat ihren eigenen Abschnitt **CSV importieren** mit den Spalten ihrer Datei.
