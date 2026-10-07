# Datenmodell des Budgets

Diese Seite beschreibt, wie KANAP Budgetdaten organisiert: die Objekte, ihre Beziehungen, die Felder, die einen Datensatz identifizieren, und die Dateien, mit denen jedes Objekt ein- und ausgeht. Sie richtet sich an Controller und Budgetadministratoren, die einen Umstieg von Tabellenkalkulationen oder einem anderen Werkzeug vorbereiten, und an das technische Team, das ein BI-Werkzeug an eine On-Premise-Installation anbindet.

Die hier beschriebenen Dateien sind der Vertrag, auf den Sie sich stützen. Ihre Spalten sind in diesem Handbuch dokumentiert und werden beim Import geprüft. Ändert sich ein Aufbau, lehnt ein Import eine Datei im alten Aufbau ab und nennt den Grund. Die Datenbanktabellen dahinter sind intern: Sie ändern sich, wenn KANAP sich weiterentwickelt. Stützen Sie einen Umstieg von einem anderen Werkzeug und jede Integration auf die Dateien.

## Die Objekte im Überblick

| Objekt | Was es enthält | Wo Sie es verwalten |
|---|---|---|
| **OPEX-Position** | Laufende Kosten, von Jahr zu Jahr fortgeführt | **Budgetverwaltung > OPEX** |
| **CAPEX-Position** | Eine Investition, von Jahr zu Jahr fortgeführt | **Budgetverwaltung > CAPEX** |
| **Budgetspalten** | Die fünf Betragsspalten, die jede Position für jedes Jahr hat | **Budgetverwaltung > Administration > Budgetspalten** |
| **Zeilen unter Menge und Preis** | Die Zeilen, aus denen eine Spalte berechnet werden kann | Der Tab **Budget** einer Position |
| **Zuordnung** | Wie die Kosten eines Jahres einer Position auf Unternehmen oder Abteilungen verteilt werden | Der Tab **Zuordnungen** einer Position |
| **Unternehmen** | Eine juristische Person, die zahlt, mit ihren jährlichen Kennzahlen | **Stammdaten > Unternehmen** |
| **Abteilung** | Eine Einheit eines Unternehmens, mit ihrer jährlichen Mitarbeiterzahl | **Stammdaten > Abteilungen** |
| **Kontenplan** und **Konto** | Die Konten, auf die ein Unternehmen seine Positionen bucht | **Stammdaten > Kontenpläne** |
| **Kostenstelle** | Wer die Ausgabe verantwortet, in einem Baum aus Gruppen | **Stammdaten > Kostenstellen** |
| **Lieferant** | Wer bezahlt wird | **Stammdaten > Lieferanten** |
| **Analysedimension** und **Wert** | Freie Klassifizierungen für das Reporting | **Stammdaten > Analysedimensionen** |
| **Arbeitstagekalender** | Arbeitstage pro Monat und Jahr, für Preise pro Tag | **Stammdaten > Arbeitstagekalender** |
| **Benutzer** | IT- und Fachverantwortliche, Budgetverantwortliche | **Administration > Benutzer** |
| **Währungen** | Erlaubte Währungen, Reportingwährung, Wechselkurse | **Budgetverwaltung > Administration > Währungen** |

## Wie die Objekte zusammenhängen

| Objekt | Verweist auf | Wie viele |
|---|---|---|
| OPEX- oder CAPEX-Position | Zahlendes Unternehmen | Eines |
| | Konto, aus dem Kontenplan des zahlenden Unternehmens | Eines |
| | Währung, aus den erlaubten Währungen | Eine |
| | Kostenstelle | Keine oder eine. Eine Gruppe ist nicht verwendbar |
| | Lieferant | Keiner oder einer |
| | Wert jeder aktiven Analysedimension | Keiner oder einer pro Dimension |
| | IT-Verantwortlicher und Fachverantwortlicher (Benutzer) | Je keiner oder einer |
| | Budgetjahre | Eines pro Jahr |
| Budgetjahr einer Position | Budgetspalten | Fünf, jede mit zwölf Monatsbeträgen |
| | Zeilen unter Menge und Preis | Bis zu 50 pro Spalte |
| | Zuordnung | Eine Methode, mit ihren Unternehmen oder Abteilungen |
| Zeile unter Menge und Preis mit Preis pro Tag | Arbeitstagekalender | Einer |
| Kostenstelle | Unternehmen | Eines |
| | Budgetverantwortlicher (Benutzer) | Keiner oder einer |
| | Übergeordnete Gruppe | Keine oder eine |
| Gruppe von Kostenstellen | Übergeordnete Gruppe | Keine oder eine. Eine Gruppe hat kein Unternehmen |
| Unternehmen | Kontenplan | Einer. Ein Unternehmen ohne eigenen Kontenplan verwendet den Kontenplan, der Standard für andere Länder ist |
| | Land und Basiswährung | Je eines |
| | Kennzahlen: Mitarbeiterzahl, IT-Benutzer, Umsatz | Ein Satz pro Jahr |
| Abteilung | Unternehmen | Eines |
| Konto | Kontenplan | Einer |
| Analysewert | Analysedimension | Eine |

Eine Position ist außerdem mit Projekten, Anfragen, Anwendungen, Assets, Verträgen, Kontakten, Aufgaben, Websites und Anhängen verknüpft. Siehe [Verknüpfungen mit anderen Objekten](#verknupfungen-mit-anderen-objekten).

## Budgetpositionen

### OPEX- und CAPEX-Positionen

Eine Position lebt über mehrere Jahre: Eine Lizenz über drei Jahre ist eine Position mit drei Budgetjahren. KANAP vergibt jeder Position beim Anlegen eine Nummer: `OPX-12` für OPEX, `CPX-3` für CAPEX. Die Nummer identifiziert die Position in der Budgetdatei.

| Feld | Spalte der Budgetdatei | Erforderlich | Hinweise |
|---|---|---|---|
| Nummer | `item_number` | Von KANAP vergeben | Leer in der Datei: legt eine Position an |
| Produktname (OPEX), Titel (CAPEX) | `name` | Ja | |
| Beschreibung (OPEX) | `description` | Nein | |
| Anlagentyp (CAPEX) | `ppe_type` | Ja | `hardware` oder `software` |
| Investitionsart (CAPEX) | `investment_type` | Ja | `replacement`, `capacity`, `productivity`, `security`, `conformity`, `business_growth` oder `other` |
| Priorität (CAPEX) | `priority` | Ja | `mandatory`, `high`, `medium` oder `low` |
| Zahlendes Unternehmen | `company_name` | Ja | Wird von der Kostenstelle übernommen, wenn nur die Kostenstelle angegeben ist |
| Lieferant | `supplier_name`, `supplier_erp_id` | Nein | |
| Konto | `account_number` | Ja | Im Kontenplan des zahlenden Unternehmens |
| Kostenstelle | `cost_center_code` | Nein | Eine Gruppe wird abgelehnt |
| Run oder Build | `run_build` | Nein | `run` oder `build` |
| Analysewerte | `analytics:<code>` | Nein | Eine Spalte pro aktiver Dimension |
| IT-Verantwortlicher, Fachverantwortlicher | `owner_it_email`, `owner_business_email` | Nein | Aktive Benutzer |
| Projekt | `project` | Nein | Eine Projektnummer, zum Beispiel `PRJ-3` |
| Währung | `currency` | Ja | ISO-Code mit drei Buchstaben |
| Gültig ab | `effective_start` | Ja | In einer Datei der 1. Januar des ersten Jahres mit einem Betrag in der Zeile, sonst des laufenden Jahres |
| Ende der Gültigkeit | `end_of_validity` | Nein | Das einzige Enddatum einer Position |
| Notizen | `notes` | Nein | |

Eine Position hat keinen eigenen Status zum Laden. Sie ist aktiv bis zum Ende ihrer Gültigkeit und wird danach innerhalb einer Stunde deaktiviert. Der auf einer Position angezeigte Budgetverantwortliche kommt aus ihrer Kostenstelle und wird nicht auf der Position gespeichert.

### Budgetjahre

Jede Position hat ein Budget pro Jahr. Der Tab **Budget** zeigt das laufende Jahr, die zwei Jahre davor und die zwei Jahre danach. Eine Budgetdatei kann bis zu zwölf Jahre auf einmal exportieren.

Ein Budgetjahr enthält die fünf Budgetspalten mit ihren Monatsbeträgen, die Zeilen unter Menge und Preis jeder Spalte und die Zuordnung des Jahres.

### Budgetspalten

Jede Position hat für jedes Jahr dieselben fünf Spalten. Sie werden einmal für die ganze Organisation festgelegt, für OPEX und CAPEX gleichermaßen.

| Position | Standardname | Name in Dateien |
|---|---|---|
| 1 | Budget | `budget` |
| 2 | Revision | `revision` |
| 3 | Prognose (standardmäßig ausgeblendet) | `forecast` |
| 4 | Ist-Werte | `actual` |
| 5 | Erwarteter Endwert | `landing` |

- Ein Budgetadministrator kann eine Spalte umbenennen (bis zu 40 Zeichen), ausblenden und die Standardspalte wählen. Der Name in Dateien bleibt gleich, eine Datei funktioniert also auch nach einer Umbenennung. Siehe [Budgetspalten](budget-operations.md#budgetspalten).
- Eine ausgeblendete Spalte behält ihre Beträge und nimmt weiterhin Importe an.
- Spalten werden pro Jahr, pro Spalte und pro Bereich (OPEX oder CAPEX) eingefroren. Eine eingefrorene Spalte lehnt Bearbeitungen, Importe, Kopien und Zurücksetzungen ab. Siehe [Daten einfrieren / auftauen](budget-operations.md#daten-einfrieren-auftauen).

Eine sechste Spalte gibt es nicht. Um mehrere Budgetrunden aufzubewahren, verwenden Sie eine Spalte pro Runde, oder kopieren Sie eine Spalte in ein anderes Jahr oder eine andere Spalte mit [Budgetspalten kopieren](budget-operations.md#budgetspalten-kopieren).

### Monatsbeträge

Jede Spalte eines Budgetjahres enthält zwölf Monatsbeträge mit zwei Dezimalstellen, in der Währung der Position. Die Jahressumme ist die Summe der Monate. Eine Datei kann die Jahressumme oder die zwölf Monate einer Spalte enthalten: Eine Jahressumme wird über den Zeitraum der Spalte verteilt, wie im Tab **Budget**.

Jede Spalte speichert außerdem ihren Zeitraum innerhalb des Jahres und die Herkunft ihrer Beträge: eine Verteilung, eine Kopie, eine Eingabe von Hand oder ihre Zeilen unter Menge und Preis. Berichte rechnen die Beträge mit den Wechselkursen des Jahres in die Reportingwährung um. Siehe [Währungseinstellungen](currencies.md).

### Zeilen unter Menge und Preis

Eine Spalte kann aus Zeilen berechnet werden, jede eine Menge mal ein Stückpreis. Jede Zeile hat eine Beschreibung (bis zu 200 Zeichen), eine Menge (bis zu 3 Dezimalstellen), eine Einheit (**Personen**, **Tage** oder **Stück**), einen Stückpreis (bis zu 4 Dezimalstellen), eine Häufigkeit, einen Zeitraum oder ein Datum und einen Arbeitstagekalender, wenn der Preis pro Tag gilt. Die VZÄ der Spalte ergeben sich aus den Zeilen. Siehe [Menge und Preis](opex.md#menge-und-preis).

Diese Zeilen werden im Tab **Budget** erfasst. Keine Datei enthält sie. Eine Budgetdatei schreibt die Monatsbeträge einer Spalte, und die Zeilen bleiben als Referenz bei ihr.

### Zuordnungen

Jedes Budgetjahr einer Position hat eine Zuordnungsmethode:

| Methode | Verteilt nach |
|---|---|
| Standard | Der Standard der Organisation für das Jahr, festgelegt unter [Standard-Zuordnungsmethode](budget-operations.md#standard-zuordnungsmethode) |
| Mitarbeiterzahl, IT-Benutzer, Umsatz | Den Kennzahlen der Unternehmen für das Jahr |
| Manuell nach Unternehmen | Einer Kennzahl, über die Unternehmen, die Sie auswählen |
| Manuell nach Abteilung | Der Mitarbeiterzahl der Abteilungen, die Sie auswählen |
| Manuelle Prozentsätze | Den Prozentsätzen, die Sie eingeben, zusammen 100 % |

Zuordnungen speisen die Berichte zur Leistungsverrechnung. Keine Datei importiert sie. [Zuordnungen kopieren](budget-operations.md#zuordnungen-kopieren) überträgt sie von einem Jahr ins nächste, und die Berichte zur Leistungsverrechnung exportieren ihre Tabellen als CSV. Siehe [Berichte](reports.md).

### Verknüpfungen mit anderen Objekten

| Verknüpfung | Wo sie angelegt wird | In einer Datei |
|---|---|---|
| Projekte | Der Tab **Verknüpfungen** der Position oder des Projekts | Die Budgetdatei enthält ein Projekt pro Position in `project`. Die Verknüpfungen des Tabs **Verknüpfungen** sind nicht in der Datei. Die Listen zeigen beides |
| Anfragen | Der Tab **Verknüpfungen** der Anfrage | Nein |
| Anwendungen | Der Tab **Verknüpfungen** der Position oder der Anwendung | Nein |
| Assets | Der Tab **Verknüpfungen** des Assets | Nein |
| Verträge | Der Tab **Verknüpfungen** der Position oder des Vertrags | Nein |
| Kontakte, Websites, Anhänge | Der Tab **Verknüpfungen** der Position | Nein |
| Aufgaben | Der Tab **Übersicht** der Position | Nein |

## Stammdaten

Die Budgetdatei findet Stammdaten über fachliche Kennungen. Laden Sie die Stammdaten zuerst. Die Budgetdatei legt fehlende Lieferanten an, wenn **Fehlende Lieferanten anlegen** angehakt ist, sowie fehlende Analysewerte. Sonst legt sie nichts an.

| Objekt | In Dateien identifiziert über | Erforderlich | Auf einer Budgetposition |
|---|---|---|---|
| Unternehmen | `name` | Name, Land, Basiswährung. Die Oberfläche verlangt außerdem einen Ort | `company_name` |
| Abteilung | `company_name` und `name` | Unternehmen, Name | Von Zuordnungen verwendet |
| Kontenplan | Seinen Code (`coa_code` in der Kontendatei) | Code, Name, Geltungsbereich | Über das zahlende Unternehmen |
| Konto | `account_number` innerhalb seines Kontenplans (`coa_code` in der globalen Datei) | Nummer, Name | `account_number` |
| Kostenstelle | `code`, unabhängig von der Groß- und Kleinschreibung | Code, Name, Typ, und das Unternehmen einer Kostenstelle | `cost_center_code` |
| Lieferant | `name` | Name | `supplier_erp_id`, dann `supplier_name` |
| Analysedimension | Ihren Code | Code | Die Spaltenüberschrift `analytics:<code>` |
| Analysewert | `axis_code` und `name` | Name | Die Zelle der Spalte seiner Dimension |
| Arbeitstagekalender | `code`, unabhängig von der Groß- und Kleinschreibung | Code, Name | Von Zeilen unter Menge und Preis verwendet |
| Benutzer | `email` | E-Mail-Adresse | `owner_it_email`, `owner_business_email` |

Worauf es ankommt, wenn Sie ein anderes Werkzeug auf KANAP abbilden:

- **Unternehmen** tragen ihre Mitarbeiterzahl, ihre IT-Benutzer und ihren Umsatz pro Jahr. Der Umsatz wird in Millionen der Basiswährung des Unternehmens angegeben. Zuordnungen nach Mitarbeiterzahl, IT-Benutzern oder Umsatz brauchen die Kennzahlen des Jahres.
- **Konten** gehören zu einem Kontenplan, und ein Unternehmen verwendet einen Kontenplan. Eine Kontonummer ist eine ganze Zahl, eindeutig innerhalb ihres Kontenplans. Das Konto einer Budgetposition muss im Kontenplan ihres zahlenden Unternehmens existieren. Siehe [Kontenpläne und Kontenverwaltung](chart-of-accounts.md).
- **Kostenstellen** bilden einen Baum. Eine Gruppe fasst Kostenstellen und andere Gruppen zusammen und kann mehrere Unternehmen umfassen. Eine Kostenstelle gehört zu einem Unternehmen, hat keine Kinder und ist der einzige Knoten, den eine Position verwenden kann. Ihr Budgetverantwortlicher erscheint auf jeder Position, die sie trägt. Siehe [Kostenstellen](cost-centers.md).
- **Lieferanten** werden in ihrer eigenen Datei über den Namen zugeordnet. Die Budgetdatei ordnet sie zuerst über die ERP-ID zu, dann über den Namen: Füllen Sie die ERP-ID, wenn Ihr ERP eine hat.
- **Analysedimensionen** werden auf ihrer Seite angelegt, jede mit einem Code. Eine Position hat höchstens einen Wert pro Dimension. Siehe [Analysedimensionen](analytics.md).
- **Arbeitstagekalender** sind Standardkalender (sie folgen den Feiertagen eines Landes) oder benutzerdefinierte Kalender. Sie enthalten die Arbeitstage jedes Monats, Jahr für Jahr. Siehe [Arbeitstagekalender](working-day-calendars.md).
- **Währungen** sind ISO-Codes mit drei Buchstaben. Die erlaubten Währungen, die Reportingwährung und die Wechselkurse werden in der Oberfläche festgelegt und haben keine Datei.

## Austauschformate

Jede der folgenden Dateien wird auf der Seite exportiert und importiert, die das Objekt verwaltet. Importe laufen in zwei Schritten: eine Prüfung, die nichts schreibt, dann ein Laden. Mit Ausnahme der Vertragsdatei teilen sie die Regeln zu Kodierung, Trennzeichen, Datumsangaben und Beträgen sowie die Größengrenze, die unter [CSV-Dateien](csv-files.md) beschrieben sind.

| Objekt | Export | Import | Zugeordnet über | Details |
|---|---|---|---|---|
| OPEX-Positionen und ihre Beträge | Ja | Ja | `item_number` | [Ein Budget aus einer Tabellenkalkulation laden](budget-file.md) |
| CAPEX-Positionen und ihre Beträge | Ja | Ja | `item_number` | [Ein Budget aus einer Tabellenkalkulation laden](budget-file.md) |
| Unternehmen und ihre Kennzahlen | Ja | Ja | `name` | [Unternehmen](companies.md) |
| Abteilungen | Ja | Ja | `company_name` und `name` | [Abteilungen](departments.md) |
| Konten | Ja | Ja | `account_number` innerhalb des Kontenplans | [Kontenpläne und Kontenverwaltung](chart-of-accounts.md) |
| Kontenpläne | Nein | Nein | | Auf der Seite oder aus einer Vorlage angelegt. Siehe [Kontenpläne und Kontenverwaltung](chart-of-accounts.md) |
| Kostenstellen | Ja | Ja | `code` | [Kostenstellen](cost-centers.md) |
| Lieferanten | Ja | Ja | `name` | [Lieferanten](suppliers.md) |
| Analysewerte | Ja | Ja | `axis_code` und `name` | [Analysedimensionen](analytics.md) |
| Arbeitstagekalender | Ja | Ja | `code`, eine Zeile pro Kalender und Jahr | [Arbeitstagekalender](working-day-calendars.md) |
| Benutzer | Ja | Ja | `email` | [CSV-Datei der Benutzer](admin.md#csv-datei-der-benutzer) |
| Verträge | Ja | Ja | `name` und `supplier_name` | [Verträge](contracts.md). Die Datei enthält nicht die Verknüpfungen zu Budgetpositionen |
| Zuordnungen | Aus den Berichten zur Leistungsverrechnung | Nein | | [Berichte](reports.md) |
| Zeilen unter Menge und Preis, Einstellungen der Budgetspalten, Einfrierungen, Währungen | Nein | Nein | | In der Oberfläche festgelegt |

Die Budgetdatei liest und schreibt die Beträge jeder Spalte und jedes Jahres, als Jahressummen oder Monate, mit den Details der Position in derselben Zeile. Sie ist der Weg hinein für ein anderswo erstelltes Budget und der Weg hinaus zu einer Tabellenkalkulation oder einem BI-Werkzeug. Jede Budgetliste exportiert und importiert ihre eigene Datei: die OPEX-Datei unter **Budgetverwaltung > OPEX**, die CAPEX-Datei unter **Budgetverwaltung > CAPEX**.

### Ein Budget nach KANAP übernehmen

1. Bilden Sie jedes Objekt Ihres bisherigen Werkzeugs auf die Tabellen oben ab, und seine Kennungen auf die Spalte **Zugeordnet über**.
2. Laden Sie die Stammdaten in der Reihenfolge aus [Ein ganzes Budget laden](budget-file.md#ein-ganzes-budget-laden).
3. Exportieren Sie die OPEX-Datei und die CAPEX-Datei, um die Kopfzeile Ihrer Organisation zu erhalten, mit einer Spalte pro Analysedimension. Eine Liste ohne Position exportiert nur die Kopfzeile.
4. Füllen Sie eine Zeile pro Position, mit leerer `item_number`, mit einer Betragsspalte pro Budgetspalte und Jahr (`budget_2027`) oder pro Monat (`budget_2027_03`).
5. Importieren Sie die Dateien. Die Prüfung meldet die Fehler nach Zeile der Datei, und nichts wird geschrieben, bevor Sie laden.

Ein stimmiger Satz von Beispieldateien, mit einem fiktiven Unternehmen und seinen Stammdaten, liegt im [KANAP-Repository](https://github.com/kanap-hq/KANAP/tree/main/doc/samples).

## Die Daten direkt lesen

Bei einer On-Premise-Installation gehört die PostgreSQL-Datenbank Ihnen: KANAP läuft auf der Datenbank, die Sie bereitstellen. Sie können sie lesen, sichern und Werkzeuge daran anbinden.

Bevor Sie das tun, beachten Sie drei Punkte.

**Die Sicherheit auf Zeilenebene filtert jedes Lesen.** KANAP verbindet sich mit einer eigenen Anwendungsrolle, die die Sicherheit auf Zeilenebene nicht umgehen kann. Mit einer Superuser-Rolle oder einer Rolle, die sie umgeht, startet KANAP nicht. Jede Tabelle mit Ihren Daten zeigt ihre Zeilen nur einer Sitzung, die den gelesenen Arbeitsbereich angegeben hat. Eine Sitzung ohne diese Angabe erhält leere Ergebnisse, ohne Fehlermeldung.

**Die Tabellen sind intern.** Ihre Namen, Spalten und Speicherung ändern sich von Version zu Version, durch die Migrationen, die bei jedem Update laufen. Die Spaltennamen in der Datenbank sind Speicherschlüssel und weichen von den Namen in der Oberfläche und in den Dateien ab. Eine Abfrage auf die heutigen Tabellen kann nach einem Update falsche oder leere Ergebnisse liefern.

**Ihre Objekte können ein Update blockieren.** PostgreSQL verweigert das Ändern oder Löschen einer Spalte, von der eine View abhängt. Eine View auf KANAP-Tabellen kann ein Update scheitern lassen. Halten Sie Ihre Abfragen im BI-Werkzeug oder in einer separaten Reporting-Datenbank.

Für ein BI-Werkzeug nutzen Sie zuerst die Exporte. Die Budgetdatei und die Stammdatendateien enthalten fachliche Namen und Kennungen, die in diesem Handbuch dokumentiert sind.

Wenn ein Werkzeug die Datenbank lesen muss, geben Sie ihm eine eigene Rolle mit reinem Lesezugriff. Verwenden Sie nie die Anwendungsrolle. Zum Beispiel als PostgreSQL-Administrator, mit `kanap` als Anwendungsrolle und Datenbank:

```sql
-- The workspace of this installation
SELECT id FROM tenants;

CREATE ROLE kanap_bi LOGIN PASSWORD 'change-me' NOSUPERUSER NOBYPASSRLS;
GRANT CONNECT ON DATABASE kanap TO kanap_bi;
GRANT USAGE ON SCHEMA public TO kanap_bi;
GRANT SELECT ON spend_items, capex_items, companies, accounts TO kanap_bi;
ALTER ROLE kanap_bi IN DATABASE kanap SET app.current_tenant = '<id from the first query>';
```

Vergeben Sie `SELECT` nur auf die Tabellen, die Ihre Berichte brauchen. Die Datenbank enthält auch Benutzerkonten, Anmeldedaten und Einstellungen, die ein Reporting-Werkzeug nicht braucht. Prüfen Sie die Rechte und die Abfragen nach jedem Update.
