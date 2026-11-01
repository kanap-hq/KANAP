# Plaid

Plaid ist der integrierte Chat-Assistent von KANAP. Er ist mit denselben Daten verbunden, mit denen Sie ohnehin arbeiten (Anwendungen, Assets, Technologien, Vorfälle, Projekte, Anfragen, Aufgaben, Verträge, Wissensdokumente und Stammdaten), sodass Sie Fragen in natürlicher Sprache stellen können, anstatt sich durch mehrere Bildschirme zu klicken, um eine Antwort zu finden.

Plaid ersetzt nicht den Rest der Anwendung. Es ist ein schnellerer Weg, um Kontext zusammenzufassen, Datensätze zu finden, Text zu entwerfen oder Änderungen vorzubereiten. Sensible Vorgänge werden immer als Vorschauen angezeigt, die Sie genehmigen müssen, bevor etwas in KANAP zurückgeschrieben wird.

!!! note "Plaid vs. KI-Agenten"
    Plaid ist der interaktive Assistent, den **Sie** steuern: Sie fragen, er antwortet, und Sie genehmigen eine Änderung nach der anderen. **KI-Agenten** sind etwas anderes: sie sind autonome Helfer, die Ihren Service-Desk überwachen und Ticket-Arbeit eigenständig vorschlagen oder erledigen, innerhalb der von Ihnen festgelegten Freigabegrenzen. Siehe [KI-Agenten: Übersicht](agents-overview.md).

## Wo Sie es finden

- Arbeitsbereich: **Plaid** (obere Navigation)
- Route: `/ai`
- Berechtigung: `ai_chat:reader` erlaubt Ihnen, den Chat-Arbeitsbereich zu öffnen und Konversationen zu beginnen
- Feature-Flag: Die Chat-Oberfläche muss auf Ihrer Instanz aktiviert sein. Ist sie deaktiviert, zeigt der Arbeitsbereich einen Hinweis anstelle der Chat-Oberfläche.

Der Arbeitsbereich steht auch Administratoren mit `ai_chat:admin` zur Verfügung, die alles sehen und moderieren können, was normale Benutzer tun.

### Bevor das inklusive Modell akzeptiert ist { #included-model-acceptance }

Im gehosteten Dienst kann Plaid mit dem inklusiven KANAP-Modell arbeiten. Vorher akzeptiert ein Administrator den Anbieter und den Ort, an dem er die Daten verarbeitet. Neue Arbeitsbereiche in der Testphase beginnen in diesem Zustand, mit ausgeschaltetem Plaid.

Bis dahin öffnet sich die Seite von Plaid wie gewohnt mit ihren Vorschlägen. Ein Kästchen nimmt den Platz des Nachrichtenfelds ein: *Ich bin einverstanden, dass {Anbieter} ({Ort}) meine Fragen und die Daten, die sie betreffen, für die Antworten von Plaid verarbeitet. Sie werden nicht zum Training seiner Modelle verwendet.*, gefolgt von *Anderes Modell oder Deaktivierung: Administration › Plaid*.

- Ein Administrator der Plaid-Einstellungen setzt das Häkchen. Damit wird Plaid eingeschaltet und die Zustimmung gespeichert, mit Person und Zeitpunkt. Danach erscheint das Nachrichtenfeld.
- Alle anderen lesen *Plaid wartet darauf, dass eine Administratorin oder ein Administrator es aktiviert.*

Administratoren können auch auf der Seite [Plaid-Einstellungen](ai-settings.md#das-inklusive-kanap-modell-bestatigen) zustimmen. Organisationen mit einem eigenen Modell sehen dieses Kästchen nie.

!!! note "Chat ausgeschaltet"
    Wenn ein Administrator den Chat unter **Administration › Plaid** ausschaltet, öffnet eine Person mit dem Chat-Recht weiterhin diese Seite, und der Eintrag Plaid bleibt in der oberen Navigation. Die Seite zeigt *Plaid ist für diesen Arbeitsbereich ausgeschaltet.* Ein Administrator des Assistenten sieht außerdem *Schalten Sie ihn unter Administration › Plaid ein*, einen Link zu den Plaid-Einstellungen. Alle anderen sehen *Bitten Sie einen Administrator, ihn einzuschalten.* Eine Person ohne das Chat-Recht sieht die Seite Zugriff verweigert. Solange das inklusive Modell auf seine Zustimmung wartet, zeigt die Seite stattdessen das Kästchen zur Zustimmung, auch bei ausgeschaltetem Chat: siehe [Bevor das inklusive Modell akzeptiert ist](#included-model-acceptance).

## Eine Konversation beginnen

Wenn Sie Plaid zum ersten Mal öffnen, gelangen Sie auf einen Begrüßungsbildschirm mit:

- Einem kurzen Slogan („Plaid ist bereit“) und einer Beschreibung dessen, was Sie fragen können
- Einem Abschnitt **Versuchen Sie** mit Beispiel-Prompts, die Sie zum Senden anklicken können
- Dem Eingabefeld am unteren Rand, bereit für Ihre erste Nachricht

Klicken Sie auf einen beliebigen Vorschlag, um ihn entweder direkt zu senden oder (bei Prompts, die einen `@`-Platzhalter enthalten) den Vorschlag in das Eingabefeld einzufügen, damit Sie ihn vervollständigen können.

Wurde beim ersten Öffnen des Arbeitsbereichs, während der Testphase, ein Pfad gewählt, beginnen die Vorschläge mit dessen zwei Fragen, soweit Sie sie lesen dürfen, dann folgen die üblichen, höchstens fünf:

| Pfad | Fragen |
|---|---|
| IT-Budget | *Wo liegen die größten Einsparpotenziale bei den IT-OPEX?*, *Welche Budgetzeilen haben keine verantwortliche Person?* |
| IT-Landkarte | *Welche Technologien erreichen in den nächsten sechs Monaten ihr Supportende?*, *Welche kritischen Anwendungen haben keinen Wiederanlaufplan?* |
| Projekte und Anfragen | *Welche Projekte überschreiten ihr Budget?*, *Welche Anfragen warten auf eine Entscheidung?* |

Geben Sie eine Nachricht ein und drücken Sie **Eingabe** zum Senden. **Umschalt+Eingabe** fügt eine neue Zeile ein. Die Sende-Schaltfläche ist deaktiviert, solange nichts zu senden ist, und verwandelt sich in eine rote **Stopp**-Schaltfläche, während Plaid antwortet.

## Die Konversationsliste

Die linke Seitenleiste listet Ihre vergangenen Konversationen auf. Verwenden Sie das Menüsymbol oben links im Chat-Bereich, um sie ein- oder auszuklappen.

Die Liste enthält:

- Eine Schaltfläche **Neue Konversation** oben
- Ein Suchfeld, das erscheint, sobald Sie mindestens eine Konversation haben
- Nach Datum gruppierte Konversationen: **Heute**, **Gestern**, **Letzte 7 Tage**, **Älter**

Jede Zeile zeigt den Konversationstitel (oder **Ohne Titel**, wenn noch keiner festgelegt wurde). Fahren Sie mit der Maus über eine Zeile oder fokussieren Sie sie, um Folgendes einzublenden:

- Ein Stiftsymbol: die Konversation **Umbenennen**. Ein Doppelklick auf den Titel bewirkt dasselbe.
- Ein Papierkorbsymbol: die Konversation **Archivieren**. Archivierte Konversationen verschwinden aus der Liste. Wenn Sie die aktuell geöffnete Konversation archivieren, wechselt Plaid zu einem neuen, leeren Chat.

Die Suche filtert die Liste während der Eingabe nach Titel. Umbenennen und Archivieren werden sofort gespeichert.

## Eine Nachricht schreiben

Das Eingabefeld ist das zentrale Bedienelement des Arbeitsbereichs. Es unterstützt:

- Mehrzeiligen Text mit bis zu 10 sichtbaren Zeilen, bevor gescrollt wird
- Inline-Bildanhänge (PNG, JPG, GIF, WEBP)
- `@`-Erwähnungen von KANAP-Datensätzen
- Einen Tastatur-Hinweis („Eingabe zum Senden · Umschalt+Eingabe für neue Zeile“)

### Bilder anhängen

Sie können Bilder auf drei Arten hinzufügen:

- Klicken Sie auf das Büroklammer-Symbol und wählen Sie Dateien von Ihrem Computer aus
- Ziehen Sie Bilddateien per Drag-and-drop auf das Eingabefeld (eine eingeblendete Hilfe bestätigt das Ablageziel)
- Fügen Sie ein Bild direkt aus der Zwischenablage ein

Jedes noch nicht gesendete Bild erscheint als Miniaturansicht über dem Text. Klicken Sie auf das kleine **X** einer Miniaturansicht, um sie zu entfernen. Es gibt ein Anhang-Limit pro Nachricht; sobald es erreicht ist, ist die Büroklammer deaktiviert, bis Sie die aktuellen Anhänge entfernen oder senden.

Bilder werden zusammen mit Ihrer Nachricht hochgeladen, damit Plaid sie beschreiben, vergleichen oder Details daraus extrahieren kann.

### Datensätze mit `@` erwähnen

Die Eingabe von `@` öffnet die **Erwähnungsauswahl** über dem Eingabefeld. Damit können Sie auf jeden KANAP-Datensatz verweisen, auf den Sie Zugriff haben: mit zwei sich ergänzenden Modi:

- **Typ-Token-Präfix**: Kurzcodes, die einer einzelnen Entitätsfamilie zugeordnet sind. Beispiele:
  - `@T-5`: Aufgabe mit der Referenz T-5
  - `@DOC`: aktuelle Wissensdokumente
  - `@APP backup`: Anwendungen, die zu „backup“ passen
  - `@BL-12`: die Budgetzeile mit der Referenz BL-12. `@BL` allein listet Budgetzeilen beider Typen auf. Die früheren Nummern funktionieren weiterhin: `@OPX-12` oder `@CPX-3` findet seine Zeile
  - `@PRJ`, `@REQ`, `@INC`, `@TEC`, `@AST`, `@CONN`, `@INT`, `@LOC`, `@CTR`, `@COMP`, `@CONT`, `@DEPT`, `@SUP`, `@BP`
- **Klartext**: alles andere (`@payroll`, `@server-2`) startet eine typübergreifende Suche, sortiert nach Relevanz. Sie findet auch Budgetzeilen über die Namen ihrer Analysewerte.

Verwenden Sie die Pfeiltasten, um durch die Vorschläge zu navigieren, **Eingabe** oder **Tab** zum Bestätigen und **Escape**, um die Auswahl zu schließen. Die Ergebnisse sind nach Entitätstyp gruppiert (Wissen, Aufgaben, Projekte, Anwendungen, Assets, Verträge usw.), sodass Sie auf einen Blick erkennen, welche Art von Datensatz Sie einfügen.

Wenn Sie einen Vorschlag bestätigen, zeigt das Eingabefeld weiterhin eine lesbare Bezeichnung an (`@DOC-152`, `@SAP S/4HANA`). Beim Senden der Nachricht wird jede Erwähnung in einen echten Link umgewandelt, dem Plaid zurück zum Quelldatensatz folgen kann.

### Eine Nachricht bearbeiten oder neu generieren

Fahren Sie mit der Maus über eine Ihrer vorherigen Nachrichten, um Aktionen auf Nachrichtenebene zu erhalten:

- **Kopieren**: den Nachrichtentext in die Zwischenablage kopieren
- **Bearbeiten**: die Nachricht in einem Inline-Editor erneut öffnen; beim Speichern wird die neue Version gesendet und alles danach abgeschnitten (die Konversation läuft ab diesem Punkt neu)
- **Neu generieren** (bei Assistentenantworten): Plaid bitten, eine weitere Antwort auf denselben Prompt zu erzeugen

Bearbeiten ist die richtige Wahl, wenn Sie feststellen, dass Ihre frühere Frage unklar war. Neu generieren ist die richtige Wahl, wenn die Frage in Ordnung war, die Antwort aber nicht.

## Wie Plaid antwortet

Plaid streamt seine Antwort Zeichen für Zeichen. Während des Streamings:

- Das Eingabefeld bleibt nutzbar, sodass Sie eine Anschlussfrage vorbereiten können
- Die Sende-Schaltfläche zeigt ein rotes **Stopp**-Symbol: ein Klick darauf bricht die laufende Antwort ab
- Ein kleiner Indikator „Tools werden verwendet…“ erscheint, wenn Plaid KANAP durchsucht, ein Dokument abruft oder einen anderen Tool-Aufruf ausführt
- Anzahl und Art der verwendeten Tools werden unter der Antwort zusammengefasst, sobald sie fertig ist

Wenn der Stream endet, springt der Fokus zurück zum Eingabefeld, sodass Sie die Konversation fortsetzen können, ohne zur Maus zu greifen.

In KANAP gespeicherte Bilder, etwa Anhänge, werden wie gewohnt angezeigt. Ein Bild, das auf einer anderen Website liegt, wird nicht von selbst geladen, weder in einer Antwort noch in Ihren eigenen Nachrichten oder in der Vorschau einer vorgeschlagenen Änderung. Es erscheint als Link mit einem Bildsymbol: Klicken Sie darauf, um das Bild in einem neuen Tab zu öffnen. Bis zu Ihrem Klick wird nichts von dieser Website abgerufen.

### Tool-Aufrufe { #tool-calls }

Plaid verwendet eine kleine Auswahl interner Tools, um Fragen zu beantworten: `Search all`, `Search knowledge`, `Get document`, `Get entity context` und einige weitere. Jeder Tool-Aufruf erscheint als kompakte Zeile unter der Nachricht („Alles durchsuchen verwendet · 8 Ergebnisse“). In der Regel müssen Sie die Tool-Details nicht lesen, aber sie sind vorhanden, falls Sie genau sehen möchten, auf welchen Datensätzen die Antwort beruht.

Wenn Sie fragen, wie etwas in KANAP geht, etwa wo sich eine Einstellung befindet oder welche Schritte eine Aufgabe hat, liest Plaid das Benutzerhandbuch Ihrer KANAP-Version in Ihrer Sprache (`Benutzerhandbuch durchsuchen`, `Benutzerhandbuch lesen`). Es beschreibt die Bildschirme so, wie das Handbuch es tut, und verlinkt den gelesenen Abschnitt auf doc.kanap.net.

`Search all` findet Budgetzeilen über die Namen ihrer Analysewerte und teilt Plaid mit, welche Werte jede Zeile hat. Plaid nennt eine Budgetzeile mit ihrer Referenz `BL-12`, und seine Links öffnen die Zeile. Eine Zahl allein, etwa 21, bedeutet `BL-21`. Die früheren Nummern funktionieren weiterhin: `OPX-12` oder `CPX-3` findet seine Zeile.

Plaid liest OPEX- und CAPEX-Zeilen zusammen. Eine Frage, die keinen der beiden Typen nennt, gilt für beide, und Plaid kann die Zeilen nach Typ filtern oder gruppieren.

Plaid listet und liest Technologien für Benutzer, die die Infrastruktur lesen dürfen. Es kann sie nach Familie, Hersteller, Version, Verantwortlichem, Supportende oder Anzahl der Server filtern und die Versionen, Server, Anwendungen, Verantwortlichen, Support-Kontakte, Weblinks und die Einstellung der Schwachstellenwarnungen einer Technologie lesen. Es liest auch die beiden Ansichten des Berichts [Supportende](end-of-support.md#den-assistenten-fragen) sowie die Version und die Daten jeder Anwendung. Wird es zu einem Server, einer Anwendung oder einer Technologie über den Namen ohne Referenz gefragt, liest es auch die verknüpften Datensätze. Fragen Sie zum Beispiel: „Welche Technologien haben keinen IT-Verantwortlichen?“ Über MCP verbundene Assistenten erhalten dieselben Antworten.

Wenn Schwachstellen verfolgt werden, listet, zählt und liest Plaid auch die Schwachstellen, für Benutzer, die die Infrastruktur lesen dürfen. Ein Element ist eine CVE auf einer Version einer Technologie, wie auf der Seite [Schwachstellen](vulnerabilities.md). Plaid kann sie nach Schweregrad, Ausnutzung, Status, Warnungen, Technologie, Veröffentlichungsdatum, Asset oder Anwendung filtern. Es kann auch die im Bestand eingesetzten Technologien behalten oder die Zeilen, die nicht mehr passen. Es zählt sie nach Schweregrad, Technologie oder Version, in Zeilen und in eindeutigen CVE, wie die Seite: „117 Zeilen (112 CVE)“. Sofern Sie nichts anderes verlangen, behält Plaid die noch zu prüfenden Schwachstellen in den Warnungen, wie die Seite. Es sagt auch, wann KANAP die NVD und CVE.org zuletzt gelesen hat und ob das letzte Lesen fehlgeschlagen ist. Die Server und Anwendungen, die eine Schwachstelle erreicht, folgen den direkten Verknüpfungen, so wie die Seite sie zählt (siehe [Was KANAP zählt](vulnerabilities.md#what-kanap-counts)). Bei Assets und Anwendungen liest Plaid, wie viele Schwachstellen noch zu prüfen sind und wie viele davon kritisch oder hoch sind. Fragen Sie zum Beispiel: „Welche kritischen Anwendungen sind von einer ausgenutzten CVE betroffen?“ Über MCP verbundene Assistenten erhalten dieselben Antworten.

Plaid listet, zählt und liest Vorfälle. Es filtert sie nach Asset, Anwendung oder Technologie, gruppiert sie nach verknüpftem Datensatz oder nach Monat und liest die Behebungsdauer. Ein eingeschränkter Vorfall, den Sie nicht sehen dürfen, erscheint nirgends. Siehe [Den Assistenten fragen](incidents.md#den-assistenten-fragen).

Plaid liest Verträge so, wie die Liste der [Verträge](contracts.md) sie zeigt: den Zustand der laufenden Periode (zu entscheiden, laufend, verlängert, endet ohne Verlängerung, abgelaufen), die nächste Frist und den Kündigungstermin, mit dem Entscheidungszeitraum Ihres Arbeitsbereichs und den bereits erfassten Verlängerungsentscheidungen. Es liest auch, was ein Vertrag abdeckt: seine Anwendungen, Assets, Technologien und Budgetzeilen. Fragen Sie zum Beispiel: „Welche Verträge sind zu entscheiden, und welche Anwendungen decken sie ab?“ oder „Welche Verträge decken APP-8 ab?“ Über MCP verbundene Assistenten erhalten dieselben Antworten.

Plaid nennt einen Datensatz bei seiner Referenz, etwa `APP-8` oder `BL-14`, oder bei seinem Namen, wenn er keine hat, etwa einen Vertrag, einen Lieferanten oder einen Standort. Die Referenz oder der Name führt zur Seite des Datensatzes, wenn Sie sie öffnen können.

Plaid nennt einen Datensatz, der mit dem erfragten verknüpft ist, nur dann, wenn Sie sein Modul lesen dürfen, wie die Seite des Datensatzes: Die Anwendungen eines Projekts erfordern die Anwendungen, seine Assets die Infrastruktur, seine Ursprungsanträge die Anträge. Ein Business Contributor erhält nur die Projekte, Anträge und Anwendungen, an denen er beteiligt ist. Die Server, auf denen eine Anwendung läuft, sind die Ausnahme: Sie gehören zur Anwendung, wie auf ihrem Reiter **Bereitstellungen**. Auf eine Person angesprochen, gibt Plaid wieder, was Ihnen die Benutzerliste zeigt: Ein Benutzeradministrator erhält das vollständige Profil, alle anderen Name, E-Mail und Status. Über MCP verbundene Assistenten erhalten dieselben Antworten.

Ein Benutzeradministrator mit Zugriff auf alle Daten liest mit Plaid, was **Administration › Rollen** und **Administration › Datenzugriff** zeigen. Plaid listet die Rollen, die Zahl ihrer Personen und die Rechte, die jede Rolle gibt, mit den Begriffen der Seite Rollen. Es sagt, wer auf welche Unternehmen, Kostenstellen oder Gruppen begrenzt ist, mit Lesen oder Bearbeiten, wer ohne Knoten begrenzt ist und wer ein Unternehmen sieht. Die Benutzerliste enthält außerdem alle Rollen einer Person und ihren Zugriff. Fragen Sie zum Beispiel: „Wer ist auf Alpha Spain begrenzt, und mit welchem Zugriff?“ oder „Welche Rollen geben die Stufe Administrator auf Budget?“ Eine Person, deren eigener Zugriff begrenzt ist, liest diese Angaben nicht, auch als Benutzeradministrator, und Plaid sagt es. Plaid ändert nichts davon: Der Datenzugriff einer Person, ihre Rollen, die Rechte einer Rolle sowie das Anlegen oder Deaktivieren einer Person bleiben auf den Seiten unter **Administration**. Über MCP verbundene Assistenten erhalten dieselben Antworten.

Plaid liest den [Verlauf](record-history.md) eines Datensatzes, wie ihn sein Tab **Verlauf** zeigt, für alle, die den Datensatz öffnen können. Fragen Sie zum Beispiel: „Wer hat die Beträge von BL-12 geändert?“ Ein Datensatz ohne Tab Verlauf, etwa ein Benutzer oder eine Rolle, hat in KANAP keinen Verlauf: Plaid sagt es und rekonstruiert keinen aus anderen Daten. Über MCP verbundene Assistenten erhalten dieselben Antworten.

Wenn Plaid Budgetbeträge addiert, bleibt eine Zeile, deren Währung für das Jahr keinen Wechselkurs hat, außerhalb der Summe. Plaid nennt dann die ausgelassenen Währungen und Jahre. Über MCP verbundene Assistenten erhalten dieselbe Antwort.

Plaid liest die Personalzahlen des Berichts [Kosten pro VZÄ](reports.md#kosten-pro-vza) für jedes Jahr und jede Budgetspalte: Kosten und VZÄ der Zeilen in Personen oder Tagen, die Kosten der pro Tag bepreisten Zeilen und die Tage, die sie einkaufen. KANAP berechnet die Kosten pro VZÄ und den durchschnittlichen Tagessatz pro Lieferant, Unternehmen, Kostenstelle oder jede andere Gruppierung, wie der Bericht, und Plaid nennt sie. Fragen Sie zum Beispiel: „Wie viele externe VZÄ und welchen durchschnittlichen Tagessatz pro Lieferant gibt es 2026?“ Wenn Sie weder OPEX noch CAPEX nennen, antwortet Plaid für beide Typen. Über MCP verbundene Assistenten erhalten dieselben Antworten.

Plaid liefert auch die Zahlen weiterer Budgetberichte. Mit Leserecht auf Konten summiert es das Budget nach Konsolidierungskonto, wie der Bericht [Konsolidierungskonten](reports.md#konsolidierungskonten). Ohne dieses Recht sagt Plaid, dass dafür das Recht auf Konten nötig ist. Es misst mehrere Spalten oder Jahre in einer Antwort und fügt eine zweite Gruppierung hinzu, zum Beispiel Budget, Revision und erwarteten Endwert jedes Unternehmens oder jeden Lieferanten über drei Jahre. Es findet die stärksten Anstiege oder Rückgänge zwischen zwei Spalten, standardmäßig 10, wie der Bericht [Top Anstieg / Rückgang](reports.md#top-anstieg-ruckgang). Es gibt die VZÄ Monat für Monat mit dem Durchschnitt und dem höchsten Monat an, wie [Personal nach Monat](reports.md#personal-nach-monat). Fragen Sie zum Beispiel: „Welche Zeilen steigen vom Budget 2026 zur Revision am stärksten?“ oder „Wie hoch ist das Budget jedes Lieferanten 2025, 2026 und 2027?“ Plaid liest alle Budgetzeilen, während die Berichte die Zeilen lesen, die am 1. Januar des Jahres vor dem ersten angezeigten Jahr noch aktiv sind. Eine früher beendete Zeile kann daher eine Zahl vom Bericht abweichen lassen. Über MCP verbundene Assistenten erhalten dieselben Antworten.

Mit Leserecht auf Berichtswesen liest Plaid die Leistungsverrechnung so, wie die Berichte [Globale Leistungsverrechnung](reports.md#globale-leistungsverrechnung) und [Leistungsverrechnung pro Unternehmen](reports.md#leistungsverrechnung-pro-unternehmen) sie zeigen: den Betrag, der jedem begünstigten Unternehmen und jeder Abteilung verrechnet wird, was jedes Unternehmen zahlt, den Saldo, die Kennzahlen pro Benutzer und zum Umsatz sowie die einem Unternehmen verrechneten Zeilen. Wenn Sie weder OPEX noch CAPEX nennen, deckt es beide Typen ab. Plaid wiederholt die Warnungen des Berichts, etwa eine Zeile, die es nicht verteilen konnte, eine Zeile ohne zahlendes Unternehmen oder einen Betrag ohne Wechselkurs. Wenn Ihr Datenzugriff begrenzt ist, beziehen sich die Zahlen auf die Zeilen, die Sie lesen können, ohne die Gesamtsumme der Gruppe, und Plaid listet die einem Unternehmen verrechneten Zeilen nur für die Unternehmen Ihres Zugriffs auf. Über MCP verbundene Assistenten erhalten dieselben Antworten.

Plaid liest vier Arten von Stammdaten, so wie ihre Bildschirme sie zeigen. Es ändert keine davon.

- **Kostenstellen**, mit Leserecht auf Kostenstellen: der Baum der Kostenstellengruppen und Kostenstellen, das Unternehmen und der Budgetverantwortliche jedes Knotens und die Zahl der OPEX- und CAPEX-Zeilen, die ihn verwenden. Plaid listet alle Knoten unter einer Gruppe auf allen Ebenen auf oder nur die Knoten direkt darunter.
- **Arbeitstagekalender**, mit Leserecht auf Arbeitstagekalender: die Arbeitstage eines Jahres, Monat für Monat, und die Feiertage eines Standardkalenders. KANAP berechnet die Summe des Jahres, und Plaid zitiert sie. Ein Land ohne Kalender in Ihrem Arbeitsbereich hat keinen, und Plaid berechnet seine Tage nicht.
- **Analysedimensionen**, mit Leserecht auf Analytik: die Einstellungen jeder Dimension (die Zeilenarten, für die sie gilt, ob ein Wert Pflicht ist, ob jeder einen Wert hinzufügen kann), die Zahl ihrer Werte und die Zeilen, die sie verwenden. Eine Pflichtdimension gilt nur als Pflicht, solange sie aktiviert ist.
- **Wechselkurse und Reporting-Währung**, mit Leserecht auf das Budget: die Reporting-Währung, die Standard- und die zulässigen Währungen, der Kurs jeder Währung für jedes Jahr mit seiner Quelle, die von Hand eingegebenen Kurse und die fehlenden Kurse.

Ein Kurs ist der Betrag in der Reporting-Währung für 1 Einheit der Währung. In einem Arbeitsbereich, der in Euro berichtet, bedeutet ein Kurs von 0,89 für USD: 1 USD = 0,89 EUR. KANAP berechnet den Kehrwert und den Kurs zwischen zwei anderen Währungen, etwa von USD nach CHF, und Plaid zitiert sie.

Ohne das Recht, das eine Art von Stammdaten verlangt, nennt Plaid das fehlende Recht. Wenn Ihr Datenzugriff begrenzt ist, lesen Sie alle Stammdaten, wie auf den Bildschirmen. Nur die Zahlen der Budgetzeilen decken Ihren Zugriff ab, und die mit ihren Kursen aufgeführten Währungen sind die der Zeilen und Verträge, die Sie lesen können.

Plaid liest den Verlauf einer Kostenstelle, eines Kalenders oder einer Dimension, wie ihn der Tab **Verlauf** zeigt. `Search all` findet eine Kostenstelle, einen Kalender oder eine Dimension über Code oder Namen. Wechselkurse durchsucht es nicht: Plaid listet sie stattdessen auf.

Fragen Sie zum Beispiel: „Welche Kostenstellen liegen unter Group IT?“, „Wer ist der Budgetverantwortliche von FR-TRV-600?“, „Wie viele Arbeitstage hat Frankreich 2026?“, „Welche Dimensionen sind Pflicht?“ oder „Wie hoch ist der USD-Kurs für 2026?“ Über MCP verbundene Assistenten erhalten dieselben Antworten.

Summen kommen von KANAP. Eine Liste von Budgetzeilen oder Verträgen enthält die Summe aller passenden Datensätze über alle Seiten hinweg, und die Summe der aufgelisteten Datensätze. Plaid nennt eine der beiden oder lässt KANAP eine Summe bilden. Fragen Sie nach den zehn größten Zeilen und ihrer Summe, nennt Plaid die Summe dieser zehn Zeilen. Wenn Ihr Datenzugriff auf bestimmte Unternehmen oder Kostenstellen beschränkt ist, sagt Plaid, dass seine Anzahlen und Summen Ihren Zugriff abdecken, und stellt sie nicht als Summe des Arbeitsbereichs dar.

Wenn Plaid einen Filterwert versucht, den ein Feld nicht annimmt, etwa „aktiv“ für den Status einer Anwendung (der „aktiviert“ oder „deaktiviert“ ist), lehnt KANAP ihn ab und listet die zulässigen Werte auf. Plaid sucht dann erneut mit dem richtigen Wert.

Wenn Sie eine Änderung verlangen, die Ihre Rolle nicht erlaubt, nennt Plaid das fehlende Recht, zum Beispiel „Sie benötigen das Recht, Projekte zu ändern“. Ein Administrator fügt es Ihrer Rolle hinzu.

Plaid nimmt nur die Änderungen vor, die Ihre Bildschirme Ihnen erlauben, an den Datensätzen, die Sie dort erreichen. Mit dem Recht, an Projekten mitzuwirken, können Sie Plaid den Zweck eines Projekts und seine Verknüpfungen mit Anwendungen, Assets und Budgetzeilen ändern lassen. Das Recht, an Anträgen mitzuwirken, deckt dieselben Verknüpfungen bei Anträgen ab. Ein Business Contributor nimmt diese Änderungen nur an den Projekten und Anträgen vor, an denen er beteiligt ist. Um einen Datensatz zu verknüpfen, brauchen Sie das Recht, sein Modul zu lesen. Um ein Projekt umzubenennen oder seine anderen Felder zu ändern, brauchen Sie das Recht, Projekte zu ändern, wie auf der Projektseite.

Mit der Stufe Mitwirkender für Vorfälle erfasst Plaid einen Vorfall, ändert seine Felder, setzt seinen Status bis Geschlossen voran, fügt Notizen zum Journal hinzu und verknüpft Assets, Anwendungen und Technologien. Mit der Stufe Mitglied für Aufgaben legt es eine Folgeaufgabe zu einem Vorfall an. Mit der Stufe Administrator für Vorfälle öffnet es einen Vorfall wieder oder bricht ihn ab, mit einem Grund, und schaltet seine Beschränkung ein oder aus. Das Schließen friert den Vorfall ein. Gelöscht wird er auf seinem Bildschirm. Siehe [Den Assistenten fragen](incidents.md#den-assistenten-fragen).

Mit der Stufe Mitglied für die Infrastruktur legt Plaid eine Technologie an, übernimmt sie aus dem KANAP-Katalog oder vervollständigt eine von Hand erfasste Technologie. Es ändert ihre Felder, fügt Versionen hinzu und ändert deren Daten, verknüpft sie mit Anwendungen und Servern, fügt ihre Verantwortlichen, Support-Kontakte und Weblinks hinzu oder entfernt sie und schaltet ihre Schwachstellenwarnungen ein oder aus, für die ganze Technologie oder für eine Version. Eine Anwendung zu verknüpfen erfordert zusätzlich das Recht, Anwendungen zu lesen. Einen Support-Kontakt hinzuzufügen erfordert das Recht, Kontakte zu lesen. Bitten Sie Plaid, eine Änderung aus der Konversation rückgängig zu machen: Es bereitet eine Vorschau vor, die den vorherigen Stand wiederherstellt. Das Anlegen oder Übernehmen einer Technologie lässt sich nicht rückgängig machen, und eine dabei hinzugefügte Version bleibt. Das Löschen einer Technologie oder einer Version, Anhänge, Schwachstellenkennungen und der erneute Abgleich der Schwachstellen (**Aktualisieren**) bleiben auf den Bildschirmen. Siehe [Den Assistenten fragen](technologies.md#den-assistenten-fragen).

Mit derselben Stufe ändert Plaid, wenn Schwachstellen verfolgt werden, den Status von Schwachstellen auf **Zu prüfen**, **Behandelt** oder **Nicht betroffen**, mit einer Notiz, wenn Sie eine angeben. Nennen Sie eine CVE, um alle ihre Zeilen zu ändern, fügen Sie eine Technologie oder eine Technologie und eine Version hinzu, um einzugrenzen, oder beschreiben Sie die Zeilen mit den Filtern der Seite. Eine Änderung umfasst höchstens 5.000 Zeilen, wie auf der Seite. Die Vorschau sagt, wie viele Zeilen und CVE sich ändern. **Akzeptiert** ist kein Status: Plaid bietet **Behandelt** mit einer Notiz an, oder **Nicht betroffen**. Bitten Sie Plaid, die Änderung in der Konversation rückgängig zu machen. Fragen Sie zum Beispiel: „Setze CVE-2024-3094 auf TEC-3 auf nicht betroffen, das Paket ist nicht installiert“. Siehe [Den Assistenten fragen](vulnerabilities.md#den-assistenten-fragen).

Wenn Plaid eine Budgetzeile anlegt, fragt es, ob die Zeile OPEX oder CAPEX ist, falls Sie es nicht gesagt haben. Den Typ einer bestehenden Zeile ändert es nicht: Verwenden Sie **Typ ändern...** im Arbeitsbereich der Zeile (siehe [Typ ändern](budget-lines.md#typ-andern)). Plaid setzt den Vertrag nur bei OPEX-Zeilen. Eine CAPEX-Zeile erreicht ihre Verträge über die Verknüpfungen ihres Reiters **Verknüpfungen**.

### Einen Datensatz löschen { #deleting-a-record }

Plaid löscht einen Datensatz nach dem anderen: eine Aufgabe, einen Kontakt, einen Standort, ein Dokument, eine Budgetzeile (OPEX oder CAPEX), eine Verbindung oder eine Schnittstelle. Jede Löschung kommt als Vorschau, die Sie genehmigen. Eine Löschung lässt sich nicht rückgängig machen.

Die Vorschau listet, was mit dem Datensatz gelöscht wird, etwa Kommentare, Zeiteinträge, Anhänge, Versionen und Verknüpfungen. Sie nennt nur, was Sie lesen dürfen, und zählt den Rest zu den anderen Verknüpfungen. Ändert sich der Datensatz zwischen der Vorschau und Ihrer Genehmigung, lehnt KANAP die Löschung ab. Bitten Sie Plaid erneut darum, um eine neue Vorschau zu erhalten.

In einer Unterhaltung wartet immer nur eine Löschung auf Genehmigung. Wenn Sie mehrere Datensätze löschen lassen, bereitet Plaid sie nacheinander vor.

Plaid braucht die Stufe, die der Bildschirm verlangt:

| Datensatz | Stufe |
|---|---|
| Aufgabe | Administrator der Aufgaben |
| Kontakt | Administrator der Kontakte |
| Standort | Mitglied der Standorte |
| Dokument | Administrator der Wissensdatenbank, mit dem Recht, in seine Bibliothek zu schreiben |
| Budgetzeile | Administrator des Budgets |
| Verbindung | Mitglied der Infrastruktur |
| Schnittstelle | Administrator der Anwendungen |

Wenn Ihr Datenzugriff auf bestimmte Unternehmen oder Kostenstellen beschränkt ist, löscht Plaid weder Kontakte noch Budgetzeilen, wie die Bildschirme.

Plaid lehnt ab, was die Bildschirme ablehnen:

- Eine Aufgabe, die eine Anfrage als ihren Ursprung nennt
- Eine Budgetzeile mit Beträgen in einer eingefrorenen Spalte
- Eine Schnittstelle mit Bindungen, außer Sie verlangen, ihre Bindungen mit ihr zu löschen
- Ein Dokument, das in einen Datensatz eingebettet ist. Es wird mit seinem Datensatz gelöscht.

Andere Datensätze, etwa Anwendungen, Assets, Verträge, Projekte, Anfragen, Vorfälle und Technologien, werden auf ihren Bildschirmen gelöscht. Plaid sagt das und nennt den Bildschirm. Über MCP verbundene Assistenten lesen nur.

### Was Plaid nicht liest { #what-plaid-does-not-read }

Plaid liest nicht:

- Das Audit-Protokoll (**Administration › Audit-Protokoll**)
- KI-Agenten

Berührt eine Frage einen dieser Bereiche, sagt Plaid, dass es ihn nicht lesen kann, und nennt die Seite, die ihn zeigt, so wie Ihre Menüs sie in der Sprache Ihres Profils nennen. Eine Suche ohne Ergebnis teilt Plaid mit, was es nicht durchsucht hat, damit die Antwort nicht behauptet, der Datensatz fehle. Dasselbe gilt für ein Feld: Der Kontext eines Datensatzes enthält seine wichtigsten Felder, und Plaid liest den vollständigen Datensatz, bevor es sagt, dass ein Feld leer ist. Über MCP verbundene Assistenten erhalten dieselben Antworten.

## Artefakte und Vorschauen

Einige Antworten bringen zusätzliches Material mit, das nicht natürlich in den Chat-Verlauf passt. KANAP nennt diese **Artefakte**.

Häufige Fälle:

- Ein langer Text- oder Markdown-Block, den Plaid für Sie vorbereitet hat
- Eine nebeneinander angeordnete **Vorher/Nachher**-Gegenüberstellung eines Datensatzes, den Plaid aktualisieren möchte
- Ein Entwurf für einen Import oder ein Änderungspaket, das Ihre Bestätigung erfordert

Artefakte öffnen sich in einem seitlichen Panel rechts im Arbeitsbereich. Das Panel lässt sich über die Registerkarten-Schaltfläche **Artefakte** am rechten Bildschirmrand ein- und ausblenden.

Das Panel öffnet sich automatisch, wenn:

- Eine lange Vorschau während einer gestreamten Antwort eintrifft
- Eine ausstehende Vorschau Ihre Entscheidung erfordert (diese öffnen das Panel immer, da Sie darauf reagieren müssen)

Bei ausstehenden Änderungsvorschauen bietet das Panel zwei Schaltflächen:

- **Genehmigen**: bestätigt die Änderung und lässt Plaid sie anwenden
- **Ablehnen**: verwirft die Änderung. Plaid teilt mit, dass die Änderung abgelehnt wurde, und bereitet nichts an ihrer Stelle vor. Wenn Ihre Anfrage mehrere Änderungen umfasste, fährt es mit den übrigen fort.

Eine Vorschau und die Nachricht, die Plaid nach Ihrer Genehmigung oder Ablehnung schreibt, sind in der Sprache Ihres Profils, mit den Feldnamen und Werten der Bildschirme. Eine Budgetzeile, die mit einem Betrag angefragt wird, kommt als eine einzige Vorschau: Eine Genehmigung legt die Zeile, ihre Budgetversion für das Jahr und den Betrag an.

Wenn Sie eine Änderung anfragen, die Plaid nicht vornehmen kann, etwa ein Projekt löschen oder den Abgleich der Schwachstellen erneut starten, sagt es das und nennt den Bildschirm, auf dem Sie sie vornehmen können. Es bereitet keine andere Änderung an ihrer Stelle vor.

Nichts, was KANAP-Daten verändert, wird stillschweigend angewendet. Die Vorschau ist die Kontrollinstanz.

## Nutzungsanzeigen

Über dem Eingabefeld zeigt eine kleine Anzeige, wie viel vom inkludierten Monatsvolumen noch bleibt:

- **Integrierte Nutzung**: Wenn Plaid mit dem inklusiven KANAP-Modell arbeitet und nicht mit einem der eigenen Modelle Ihrer Organisation, zeigt dies, wie viele Nachrichten im aktuellen Monat verbleiben und an welchem Datum das Kontingent zurückgesetzt wird. Ein Administrator hat dieses Modell zuvor bestätigt (siehe [Plaid-Einstellungen](ai-settings.md#das-inklusive-kanap-modell-bestatigen)). Ist das Limit erreicht, wird das Eingabefeld deaktiviert und ein Hinweistext fordert Administratoren auf, auf ein eigenes Modell zu wechseln; siehe [KI-Modelle](ai-models.md).

Personen, die **Administration > Plaid** öffnen können, sehen außerdem einen schmalen Balken unter dem Eingabefeld, sobald die Konversation mindestens einen Austausch enthält. **Verarbeitetes Volumen** zählt die Eingabe- und Ausgabe-Tokens aller Nachrichten dieser Konversation zusammen. Jede Frage sendet die früheren Nachrichten erneut, daher wächst das Volumen schneller als die Zahl der Durchgänge. **Kontext der letzten Anfrage** ist die Eingabe der letzten Frage. Der Balken zeigt außerdem die Eingabe-Tokens und die Ausgabe-Tokens der Konversation.

## Tipps

- **Präfixe für Präzision nutzen**: `@T-`, `@DOC-`, `@PRJ-`, `@REQ-`, `@INC-`, `@TEC-` sind direkt nativen KANAP-Referenzen zugeordnet. Sie sind der schnellste Weg, Plaid auf einen bestimmten Datensatz zu lenken, und sie überstehen Kopieren und Einfügen, weil sie identisch mit dem aussehen, was Sie an anderer Stelle in der Anwendung sehen.
- **Pro Thema eine neue Konversation beginnen**: Wenn Sie unzusammenhängende Fragen in getrennten Konversationen halten, bleibt das Kontextfenster kleiner, die Antworten kommen schneller und die Token-Kosten sinken. Die Konversationsliste ist nach Datum gruppiert, sodass Sie sie leicht wiederfinden.
- **Bewusst genehmigen und ablehnen**: Vorschauen sind das Einzige, was zwischen Plaid und Ihren Live-Daten steht. Nehmen Sie sich die zusätzliche Sekunde, um die Gegenüberstellung zu lesen, bevor Sie auf **Genehmigen** klicken.
- **Stoppen statt warten**: Wenn Plaid mitten im Stream in die falsche Richtung läuft, drücken Sie die **Stopp**-Schaltfläche, statt auf das Ende zu warten. Sie sparen Tokens, und Ihre Anschlussnachricht kann den Kurs korrigieren.
- **Bilder direkt ablegen**: Einen Screenshot auf das Eingabefeld zu ziehen ist schneller als der Dateiauswahldialog, und das Einfügen aus der Zwischenablage funktioniert ebenfalls. Nutzen Sie das, wenn Sie ein UI-Problem beschreiben oder Plaid bitten, ein Diagramm zu lesen.
