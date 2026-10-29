# Ein Budget aus einer Tabellenkalkulation laden

Die meisten Teams erstellen ihr Budget in einer Tabellenkalkulation: eine Zeile pro Budgetzeile, eine Spalte pro Jahr oder pro Monat. KANAP führt dieselben Budgetzeilen in seiner Liste der Budgetzeilen, wo sie die Zuordnungen, Berichte und die Übersicht speisen.

Die Budgetdatei verbindet beides. Exportieren Sie die Budgetzeilen, ändern Sie die Zellen, die Sie bearbeiten möchten, in Excel oder LibreOffice und importieren Sie die Datei anschließend. KANAP vergleicht jede Zelle mit dem gespeicherten Stand und schreibt nur, was sich geändert hat.

Eine Datei enthält beide Arten von Budgetzeilen. Ihre Spalte `nature` gibt an, ob eine Zeile eine OPEX- oder eine CAPEX-Zeile ist, und jede Zeile wird nach den Regeln ihrer eigenen Art geprüft. Die Liste exportiert die Budgetzeilen, die sie zeigt, OPEX und CAPEX zusammen. Filtern Sie die Spalte **Typ**, um nur eine Art zu exportieren.

## Wo Sie es finden

- Pfad: **Budgetverwaltung > Budgetzeilen**
- Export: **Exportieren** in der Symbolleiste der Liste
- Import: **Importieren** in derselben Symbolleiste
- Berechtigungen: Beide Schaltflächen erfordern die Administratorstufe auf Budget (`budget:admin`), die für OPEX- und CAPEX-Zeilen gleichermaßen gilt

## Export

1. Klicken Sie in der Liste auf **Exportieren**.
2. Wählen Sie, was die Datei enthält:

| Einstellung | Wirkung |
|---|---|
| **Zeilen** | Die Budgetzeilen, die die Liste zeigt, mit ihrer Suche, ihren Filtern und ihrem Statusumfang. **Alle Zeilen** exportiert stattdessen alle Budgetzeilen, beendete eingeschlossen, ohne die Filter der Liste |
| **Jahre** | **Erstes Jahr** und **Letztes Jahr**, bis zu zwölf Jahre. Standard: das laufende Jahr, das davor und das danach. Aktivieren Sie **Laufendes Jahr**, um nur das laufende Jahr zu exportieren |
| **Spalten** | Die zu schreibenden Budgetspalten. Die Spalten, die Ihre Organisation zeigt, sind angehakt, und eine ausgeblendete Spalte ist mit **ausgeblendet** markiert. Ihre Überschrift steht unter dem Namen, zum Beispiel `budget_2027` |
| **Detail** | **Jahressummen**: eine Spalte pro Budgetspalte und Jahr. **Monate**: eine Spalte pro Budgetspalte, Jahr und Monat |
| **Format** | **CSV** oder **Excel (.xlsx)**. Ihr Browser merkt sich die Wahl für den nächsten Export |

3. Klicken Sie auf die Schaltfläche am unteren Rand des Fensters. Sie benennt, was die Datei enthält: **120 gefilterte Zeilen exportieren**, **Alle Zeilen exportieren**, **3.412 Zeilen exportieren** und so weiter.

Die Datei wird als `budget.csv` oder `budget.xlsx` gespeichert. Eine CSV-Datei wird in der Sprache geschrieben, in der die Oberfläche angezeigt wird:

| Sprache | Trennzeichen | Beträge | Datumsangaben |
|---|---|---|---|
| Englisch | `,` | `12280.50` | `2027-03-01` |
| Französisch, Spanisch | `;` | `12280,50` | `01/03/2027` |
| Deutsch | `;` | `12280,50` | `01.03.2027` |

Die Excel-Datei hat dieselben Spalten auf einem Blatt namens `budget`. Beträge sind centgenaue Zahlen, und Datumsangaben sind echte Datumswerte, angezeigt in der Tagesreihenfolge Ihrer Sprache. Die Kopfzeile bleibt beim Blättern stehen, mit einem Filter auf jeder Spalte.

Der Export einer Liste ohne Budgetzeilen ergibt die Kopfzeile allein. Das ist Ihre Vorlage.

Jeder Export wird im [Audit-Protokoll](admin.md#audit-protokoll) aufgezeichnet, mit seinen Einstellungen, seinem Format und seiner Zeilenzahl.

## Die Spalten

Eine Datei enthält eine Zeile pro Budgetzeile: die Detailspalten, dann die Betragsspalten, dann `kanap_token`.

### Detailspalten

Die Detailspalten sind für beide Arten von Budgetzeilen gleich.

| Spalte | Inhalt | Bei einer neuen Budgetzeile |
|---|---|---|
| `nature` | `opex` oder `capex`, die Art der Budgetzeile | Erforderlich. Eine Datei ohne diese Spalte wird als OPEX-Zeilen gelesen, oder als CAPEX-Zeilen, wenn der Filter **Typ** der Liste nur CAPEX behält |
| `item_number` | Die Referenz der Budgetzeile: `BL-12` oder `12`. Die Nummern `OPX-12` und `CPX-3` früherer Dateien werden ebenfalls gelesen | Leer: Die Zeile legt eine Budgetzeile an |
| `name` | Der Titel der Budgetzeile, angezeigt in der Spalte **Produktname** der Liste | Erforderlich |
| `description` | Die ausführliche Beschreibung | Optional |
| `company_name` | Zahlendes Unternehmen. Leer bei einer neuen Zeile: das Unternehmen der Kostenstelle. Ein anderes Unternehmen als das der Kostenstelle wird mit einer Warnung akzeptiert | Erforderlich, außer die Budgetzeile hat eine Kostenstelle |
| `supplier_name` | Name des Lieferanten | Optional |
| `supplier_erp_id` | Die ID des Lieferanten in Ihrem ERP | Optional |
| `account_number` | Kontonummer, im Kontenplan des zahlenden Unternehmens | Erforderlich |
| `cost_center_code` | Code der Kostenstelle. Eine Gruppe wird abgelehnt | Optional |
| `cost_center_path` | Die Stelle der Kostenstelle im Baum, von ihrer obersten Gruppe bis zur Kostenstelle, Namen getrennt durch ` / `, zum Beispiel `IT / Infrastruktur / Netzwerk`. Leer bei einer Kostenstelle auf oberster Ebene des Baums oder einer Budgetzeile ohne Kostenstelle. Damit filtern oder gruppieren Sie die Zeilen in Ihrer Tabellenkalkulation nach Bereich | Nur Export, beim Import ignoriert |
| `run_build` | `run` oder `build` | Optional |
| `analytics:<code>` | Der Name des Werts in der Dimension, deren Code dies ist, unabhängig von Groß- und Kleinschreibung. Eine Spalte pro aktivierter Dimension, die Standarddimension eingeschlossen. Eine Dimension, die nur für eine Art von Budgetzeilen verwendet wird, nimmt nur in den Zeilen dieser Art einen Wert an und bleibt in den anderen leer. In einem neuen Arbeitsbereich stehen die empfohlenen Dimensionen in `analytics:default` (die Kostenart), `analytics:it_tower`, `analytics:purpose` und `analytics:priority`, zum Beispiel `Software`, `Anwendung`, `Ersatz` oder `Hoch` | Optional, außer bei einer erforderlichen Dimension der Art der Budgetzeile, wie dem Anlagentyp einer CAPEX-Zeile in einem Arbeitsbereich, der vor den empfohlenen Dimensionen angelegt wurde. Ein nicht vorhandener Wert wird beim Laden angelegt |
| `owner_it_email` | E-Mail-Adresse eines aktiven Benutzers | Optional |
| `owner_business_email` | E-Mail-Adresse eines aktiven Benutzers | Optional |
| `project` | Projektnummer, zum Beispiel `PRJ-3` | Optional |
| `currency` | ISO-Code mit drei Buchstaben, aus den in Ihrem Arbeitsbereich erlaubten Währungen | Erforderlich |
| `effective_start` | Der Tag, an dem die Budgetzeile beginnt | Der 1. Januar des ersten Jahres mit einem Betrag in der Zeile, sonst des laufenden Jahres |
| `end_of_validity` | Der Tag, an dem die Budgetzeile endet | Kein Ende |
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

`kanap_token` wird von KANAP geschrieben. Lassen Sie ihn unverändert. KANAP nutzt ihn, um Ihnen zu sagen, dass sich eine Budgetzeile nach Ihrem Export geändert hat. Lassen Sie ihn in einer Zeile, die Sie hinzufügen, leer.

## Was eine Zelle bedeutet

- Eine leere Zelle behält den gespeicherten Wert. Eine leere Zelle `nature` behält die Art einer bestehenden Budgetzeile.
- `-` löscht ein Detail der Budgetzeile: Beschreibung, Notizen, Name und ERP-ID des Lieferanten, Kostenstelle, Run oder Build, einen Dimensionswert, einen Verantwortlichen, das Projekt, das Ende der Gültigkeit. In einer Spalte, die eine neue Budgetzeile füllen muss, und in `nature` ist `-` ein Zeilenfehler. In einer erforderlichen Dimension ist `-` ein Zeilenfehler, wenn die Zeile einen Wert hat.
- `0` schreibt null.
- Eine Jahressumme, die der gespeicherten Summe entspricht, schreibt nichts. Eine abweichende Summe wird über den Zeitraum der Spalte verteilt, genau wie bei der Eingabe der Summe im **Budget-Tab**.
- Eine Monatszelle schreibt diesen Monat und markiert die Spalte als manuell bearbeitet, wie ein im **Budget-Tab** eingegebener Monat.
- Ein Betrag hat höchstens zwei Nachkommastellen. Eine Betragszelle lässt sich nicht mit `-` löschen: Schreiben Sie `0`, oder lassen Sie die Zelle leer.
- Eine Datei kann die Jahressumme einer Spalte und eines Jahres enthalten oder deren zwölf Monate, niemals beides.

Eine fehlende Spalte behält alle gespeicherten Werte dieser Spalte. Eine Datei, die nur `item_number` und einige Betragsspalten enthält, ist eine gültige Datei.

## Budgetzeilen hinzufügen und zuordnen

- `item_number` gefüllt: Diese Budgetzeile wird aktualisiert. Leer: Es wird eine neue Budgetzeile angelegt, von der Art, die ihre Zelle `nature` angibt.
- `item_number` enthält die Referenz der Budgetzeile, `BL-12`. In einer Datei mit einer Spalte `nature` ist eine bloße Zahl dieselbe Referenz. Die Nummern `OPX-12` und `CPX-3` früherer Dateien bezeichnen weiterhin ihre Budgetzeile. Dieselbe Budgetzeile zweimal in einer Datei zu nennen ist ein Zeilenfehler.
- Eine Budgetzeile behält ihre Art. Eine Zeile, die eine bestehende Budgetzeile mit der anderen `nature` nennt, wird abgelehnt, zum Beispiel „BL-125 is a CAPEX line, not an OPEX line. A file does not change the type of a line.“
- Jede Zeile wird nach ihrer eigenen Art geprüft: die Dimensionen und Werte, die sie haben darf, ihr Konto, die eingefrorenen Spalten und die Warnung vor Duplikaten. Eine für CAPEX eingefrorene Spalte lehnt eine Änderung nur bei einer CAPEX-Zeile ab.
- Es gibt keinen weiteren Schlüssel. Eine neue Zeile, die einer bestehenden Budgetzeile ihrer Art ähnelt oder einer anderen neuen Zeile derselben Art in der Datei, ist eine Warnung, die Sie ignorieren können.
- Lieferanten werden über `supplier_erp_id` zugeordnet, wenn er gefüllt ist, sonst über `supplier_name`. Einen Lieferanten, den die Datei nennt und den KANAP nicht kennt, legt das Laden an, wenn **Fehlende Lieferanten anlegen** angehakt ist. Ohne diese Option listet die Prüfung die fehlenden Lieferanten auf und bittet Sie, sie unter **Stammdaten > Lieferanten** anzulegen.
- Ein nicht vorhandener Dimensionswert wird beim Laden angelegt und in der Prüfung aufgelistet. Konten, Kostenstellen, Unternehmen und Benutzer werden nie angelegt: Ein unbekanntes Element ist ein Zeilenfehler, der nennt, wo es hinzugefügt wird. Für eine Person mit begrenztem Datenzugriff nur bei einer Dimension mit offenen Werten: siehe [Begrenzter Datenzugriff](#limited-data-access).
- Ein Wert oder `-` in einer Dimension, die nur für die andere Zeilenart gilt, ist ein Zeilenfehler in ihrer Zelle `analytics:<code>`, zum Beispiel „The Recurrence dimension is for CAPEX lines only. Leave it out.“ Der Export lässt eine solche Zelle leer: Ein ausgeblendeter Wert einer Zeile wird nicht exportiert, und ein Laden lässt ihn unverändert. Die Einstellung finden Sie unter [Analysedimensionen](analytics.md#opex-oder-capex-dimensionen).
- Ein Wert, der nur für die andere Zeilenart verwendet wird, ist ein Zeilenfehler in seiner Zelle `analytics:<code>`, zum Beispiel „Internes Personal is for OPEX lines only. Pick a value for CAPEX lines.“ Eine Zeile behält den Wert, den sie bereits hat. Werte, die der Import anlegt, werden für OPEX und CAPEX verwendet. Die Einstellung finden Sie unter [Analysedimensionen](analytics.md#opex-oder-capex-werte).
- Eine neue Zeile braucht einen Wert in jeder erforderlichen Dimension ihrer eigenen Art, mit der Meldung „The Kostenart dimension is required. Choose a value.“ in der Zelle `analytics:<code>`. Das gilt, wenn die Spalte in der Datei fehlt, wenn die Zelle leer ist und wenn sie `-` enthält. Ein Wert, den das Laden anlegt, zählt. Eine bestehende Zeile wird nur bei einem `-` abgelehnt, das ihren Wert löschen würde: Eine leere Zelle oder eine fehlende Spalte lässt sie unverändert. Die Einstellung finden Sie unter [Analysedimensionen](analytics.md#erforderliche-dimensionen).
- Eine Zeile, die eine Budgetzeile anlegt oder deren Konto ändert, wird abgelehnt, wenn das Konto für die andere Art von Budgetzeile bestimmt ist, mit der Meldung „Account 6061 is for CAPEX lines only.“ (oder OPEX). Eine Budgetzeile behält ihr aktuelles Konto. Die Einstellung der Konten steht in [Kontenpläne und Kontenverwaltung](chart-of-accounts.md#opex-oder-capex-konten).
- Projekte werden über ihre Nummer zugeordnet, zum Beispiel `PRJ-3`.
- Eine beendete Budgetzeile ist eine Budgetzeile, deren `end_of_validity` verstrichen ist. Setzen Sie das Datum, um eine Budgetzeile zu beenden, oder schreiben Sie `-` in die Zelle, um es zu löschen und die Budgetzeile weiterlaufen zu lassen. Es gibt keine Statusspalte.

## Prüfen, dann laden

1. Klicken Sie auf **Importieren** und wählen Sie die Datei, eine CSV-Datei oder eine Excel-Arbeitsmappe (`.xlsx`), oder legen Sie sie im Fenster ab. Die Datei wird sofort geprüft. Nichts wird geschrieben.
2. Lesen Sie den Bericht:

| Abschnitt | Inhalt |
|---|---|
| **Fehler** | Die Zeilen, die das Laden ablehnt, nach Zeile der Datei mit der Spalte, wenn sie bekannt ist. Eine Datei mit einem einzigen Fehler lädt nichts |
| **Änderungen** | Die anzulegenden Budgetzeilen, die zu aktualisierenden Budgetzeilen und die Budgetzeilen, die die Datei unverändert lässt |
| **Seit dem Export in KANAP geändert** | Die Budgetzeilen, die jemand nach Ihrem Export geändert hat, mit wer und wann. Das Laden der Datei schreibt Ihre Werte über diese Änderungen |
| **Warnungen** | Eine Zeile, die einer anderen Budgetzeile ähnelt, ein `company_name`, der vom Unternehmen der Kostenstelle der Zeile abweicht, ein Betrag, durch den eine Spalte ihren Berechnungszeilen nicht mehr folgt, Spalten und Zellen, die die Datei ignoriert |
| **Beim Laden angelegt** | Die Lieferanten und Dimensionswerte, die das Laden hinzufügen würde |

3. Klicken Sie auf **Laden**. Das Laden schreibt alles oder nichts.

Ändert sich eine Budgetzeile zwischen der Prüfung und dem Laden, stoppt das Laden und bittet Sie, die Datei erneut zu prüfen. Die Prüfung sagt außerdem, wie sie die Datei gelesen hat, wenn ein Datum oder ein Betrag auf zwei Arten gelesen werden konnte, mit einer Schaltfläche zum Wechseln der Lesart.

### Spalten aus Menge und Preis

Eine Budgetzeile kann eine Spalte aus Berechnungszeilen bilden, Menge × Preis: siehe [Menge und Preis](budget-lines.md#menge-und-preis). Die Budgetdatei enthält nur die Summen und die Monate einer Spalte. Berechnungszeilen bearbeiten Sie im Tab **Budget** der Budgetzeile.

Ändert die Datei die Jahressumme oder einen Monat einer solchen Spalte, zeigt die Prüfung eine Warnung pro Budgetzeile, Spalte und Jahr, zum Beispiel:

> BL-83 · Revision 2026: 3 Berechnungszeilen (281.280,00) steuern diese Beträge nicht mehr.

Das Laden ist erlaubt. Danach bleiben die Berechnungszeilen als Referenz bei der Budgetzeile, mit ihrer Summe, und die Spalte folgt den Beträgen der Datei. Eine Jahressumme, die dem Ergebnis der Zeilen entspricht, schreibt nichts: Die Spalte folgt weiter ihren Zeilen.

## Begrenzter Datenzugriff { #limited-data-access }

Eine Person, die auf einen Teil des Budgets begrenzt ist, verwendet die Datei innerhalb ihres Zugriffs, wenn ihre Rolle es erlaubt. Siehe [Datenzugriff](data-access.md).

- Der Export enthält die Zeilen, die sie sieht.
- Eine Dateizeile, die eine Budgetzeile nennt, die sie nicht sieht, wird wie eine nicht vorhandene Zeile behandelt. In einer Datei aus einem Export lautet die Meldung „BL-12 ist seit dem Export nicht mehr verfügbar.“, wie bei einer seitdem gelöschten Zeile.
- Eine Zeile, die sie mit Lesen sieht, wird akzeptiert, wenn ihre Dateizeile unverändert ist. Eine Änderung wird mit „BL-12 ist in Ihrem Zugriff schreibgeschützt.“ abgelehnt.
- Eine neue Zeile, oder ein neues Unternehmen oder eine neue Kostenstelle auf einer Zeile, muss zu einem ihrer Knoten mit Bearbeiten passen. Sonst wird die Dateizeile mit „Dieses Unternehmen oder diese Kostenstelle gehört nicht zu Ihrem Zugriff.“ abgelehnt.
- Ein unbekannter Wert wird nur bei einer Dimension mit offenen Werten angelegt. Bei den anderen Dimensionen ist er ein Zeilenfehler.

Diese Zeilen erscheinen unter den **Fehlern** der Prüfung, wie jede andere abgelehnte Zeile.

## Excel und LibreOffice

Die Datei zu öffnen und zu speichern lässt sie ladbar, als CSV wie als `.xlsx`. Beide Programme behalten die Spalten, das Trennzeichen und die Werte.

In einer Arbeitsmappe liest KANAP das erste Blatt. Hat die Arbeitsmappe weitere Blätter, nennt die Prüfung das gelesene Blatt. Ein Betrag oder ein Datum, das in einer Zelle als Wert steht, wird genau so gelesen, ohne Frage nach Dezimalzeichen oder Tagesreihenfolge. Eine alte Excel-Datei (`.xls`) wird abgelehnt: Speichern Sie sie als `.xlsx` oder CSV.

Ein Datum oder ein Betrag als Text, den die Datei nicht selbst entscheiden kann, wird so gelesen, wie der Export ihn geschrieben hat, dann in der Sprache, in der die Oberfläche angezeigt wird. Jedes Datum mit einem Tag bis 12 ist mehrdeutig (`01/03/2027` ist auf Französisch der 1. März und auf Englisch der 3. Januar), und ein Betrag wie `12,280` ebenfalls. Die Prüfung sagt, wie sie gelesen wurden, und bietet eine Schaltfläche zum Wechseln der Lesart.

Eine Spalte, die KANAP nicht kennt, wird mit einer Warnung ignoriert. Eine Spalte, die wie eine falsch geschriebene Betragsspalte aussieht, zum Beispiel `budjet_2027`, lehnt die ganze Datei ab. Auch eine Spalte `analytics:<code>`, die keine aktivierte Dimension benennt, lehnt die ganze Datei ab, mit „Unknown dimension 'x'.“

## Dateien aus früheren Versionen

Eine Datei in einem älteren Format wird als Ganzes abgelehnt: die Positionsdateien mit Spalten der Art `y_budget` und die Datei der Budgetzeilen mit den Spalten `measure` und `jan` … `dec`. Der Bildschirm zeigt diese Meldung:

> Diese Datei stammt aus einer früheren Version von KANAP. Exportieren Sie eine neue Datei aus dieser Liste, übertragen Sie Ihre Änderungen hinein und importieren Sie sie erneut.

Eine CAPEX-Datei, die exportiert wurde, bevor Anlagentyp, Investitionsart und Priorität zu Dimensionen wurden, erkennbar an ihren drei Spalten `ppe_type`, `investment_type` und `priority` zusammen, wird ebenfalls als Ganzes abgelehnt. Diese Werte stehen jetzt in Dimensionsspalten. Eine oder zwei dieser Spalten allein sind unbekannte Spalten und werden mit einer Warnung ignoriert. Der Bildschirm zeigt diese Meldung:

> The ppe_type, investment_type and priority columns are now dimension columns (analytics:ppe_type, analytics:investment_type, analytics:priority). Export a fresh file from this list, copy your changes into it, and import it again.

Exportieren Sie eine neue Datei und übertragen Sie Ihre Zeilen hinein.

Eine OPEX- oder CAPEX-Datei, die exportiert wurde, bevor es die Spalte `nature` gab, wird angenommen. Ihre Zeilen werden als OPEX-Zeilen gelesen, oder als CAPEX-Zeilen, wenn der Filter **Typ** der Liste nur CAPEX behält, und ihre Nummern `OPX-12` und `CPX-3` bezeichnen weiterhin ihre Budgetzeilen: Importieren Sie eine frühere OPEX-Datei mit der Liste auf OPEX oder beiden Typen und eine frühere CAPEX-Datei mit der auf CAPEX gefilterten Liste. Ihre Zellen `kanap_token` bleiben gültig. Eine bloße Zahl behält in einer solchen Datei ihre frühere Bedeutung: Auf CAPEX gefiltert ist `3` die Budgetzeile `CPX-3`, sonst ist sie die Nummer der OPEX-Zeile.

KANAP erkennt die Spalte `nature` an ihrem Namen, unabhängig von Groß- und Kleinschreibung. Hat eine frühere Datei eine eigene Spalte namens Nature, benennen Sie diese vor dem Import um: KANAP würde diese Spalte als Art jeder Budgetzeile lesen und ihre Werte ablehnen.

## Ein ganzes Budget laden

Die Budgetdatei enthält Budgetzeilen. Das zahlende Unternehmen, das Konto, die Kostenstelle, der Lieferant und die Benutzer, die eine Budgetzeile nennt, müssen zuerst existieren. Ein kleines Team lädt sie in dieser Reihenfolge:

1. Einen Kontenplan und seine Konten, unter [Kontenpläne](chart-of-accounts.md)
2. Die Unternehmen, unter [Unternehmen](companies.md)
3. Die Budgetdatei, mit angehaktem **Fehlende Lieferanten anlegen**. Sie enthält die OPEX- und die CAPEX-Zeilen zusammen, oder Sie laden eine Datei pro Art

Eine größere Organisation fügt dazwischen die übrigen Stammdaten hinzu:

1. Den Kontenplan und seine Konten
2. Die Unternehmen
3. Die Benutzer, unter [Benutzer](admin.md)
4. Die Kostenstellen, unter [Kostenstellen](cost-centers.md)
5. Die Lieferanten, unter [Lieferanten](suppliers.md)
6. Die Dimensionswerte, unter [Analysedimensionen](analytics.md). Die Dimensionen selbst werden auf dieser Seite angelegt
7. Die Arbeitstagekalender, unter [Arbeitstagekalender](working-day-calendars.md), sobald Budgetzeilen Mengen und Preise tragen
8. Die Budgetdatei, OPEX- und CAPEX-Zeilen

**Der Kontenplan kommt zuerst.** Klicken Sie auf der Seite Kontenpläne auf **Neu**, geben Sie dem Plan einen Code und einen Namen und wählen Sie unter **Verwendet für** die Option **Alle Länder**. Klicken Sie dann auf **Kontenpläne verwalten**, öffnen Sie das Menü **⋯** des Plans und klicken Sie auf **Als Standard für andere Länder festlegen**. Ein Unternehmen ohne Kontenplan übernimmt diesen, und so werden die Kontonummern einer Budgetdatei aufgelöst. Wählen Sie den Plan auf der Seite aus und klicken Sie dann auf **Importieren**, um seine Konten zu laden.

Jede dieser Seiten hat ihren eigenen Importabschnitt mit den Spalten ihrer Datei. Jede liest eine CSV-Datei oder eine Excel-Arbeitsmappe. Siehe [CSV- und Excel-Dateien](csv-files.md).
