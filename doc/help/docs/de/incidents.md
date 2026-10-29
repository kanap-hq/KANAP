# Vorfallsregister

Das Vorfallsregister ist das Logbuch der bemerkenswerten Ereignisse, die Ihre IT betroffen haben: der Ausfall, der die Fakturierung drei Stunden lang lahmgelegt hat, der vom Mailfilter abgefangene Ransomware-Versuch, der Speicherausfall, der einen Tag an Sicherungen gekostet hat. Jeder Vorfall erhält eine dauerhafte Nummer, ein mit Zeitstempeln versehenes Journal, das niemand nachträglich umschreiben kann, und Verknüpfungen zu den betroffenen Assets, Anwendungen, Aufgaben und Dokumenten.

Es ist kein Service-Desk. Das Tagesgeschäft bleibt in Ihrem Ticketsystem; das Register bewahrt die Ereignisse auf, nach denen Ihre Geschäftsleitung, Ihre Prüfer und Ihr Versicherer in einem Jahr fragen werden.

## Was ins Register gehört

Erfassen Sie einen Vorfall, wenn das Ereignis es wert ist, festgehalten zu werden:

- Dienstunterbrechungen, die Benutzer, Kunden oder einen Geschäftsprozess betroffen haben
- Sicherheitsereignisse: Eindringversuche, Schadsoftware, Datenabflüsse, verlorene Geräte
- Datenverlust oder Datenbeschädigung, fehlgeschlagene Wiederherstellungen, Lücken in den Sicherungen
- Schwerwiegende Ausfälle bei Lieferanten oder Hostern, verletzte Service-Level
- Alles, was Sie später erklären oder einer Behörde melden müssen

Erfassen Sie keine Routinearbeit: Passwortzurücksetzungen, Probleme einzelner Benutzer, Standard-Änderungsanträge oder ein Ticket, das in zehn Minuten ohne Auswirkung gelöst war. Ein gutes Register enthält eine Handvoll Einträge pro Monat, nicht Tausende.

**Tipp**: Halten Sie die Ticketnummer im Feld **Externe Referenz** fest, damit jeder zur operativen Spur in Ihrem Ticketsystem zurückfindet.

---

## Erste Schritte

Gehen Sie zu **IT-Landschaft > Vorfälle**, um das Register zu sehen. Klicken Sie auf **Neuer Vorfall**, um einen zu erfassen.

**Pflichtfelder**:

- **Titel**: eine kurze, sachliche Zusammenfassung, z. B. „Mail-Dienst am Standort Lyon nicht verfügbar"
- **Schweregrad**: Kritisch, Schwerwiegend, Geringfügig oder Niedrig
- **Erkannt**: wann der Vorfall bemerkt wurde (standardmäßig jetzt)

**Auf demselben Bildschirm empfohlen**:

- **Beschreibung**: was passiert ist, wie beobachtet
- **Kategorie**: Infrastruktur, Sicherheit, Anwendung, Daten, Lieferant, Sonstiges (konfigurierbar, siehe [Kategorien](#kategorien))
- **Begonnen**: wann der Vorfall tatsächlich begann, falls das vom Zeitpunkt der Entdeckung abweicht
- **Verantwortlicher**: wer die Bearbeitung übernimmt

Der **Melder** sind standardmäßig Sie. Beide Daten akzeptieren Werte in der Vergangenheit: Ein am Montagmorgen entdeckter Vorfall kann als am Samstagabend begonnen erfasst werden.

**Berechtigungen**:

- Ansicht: `incidents:reader`
- Anlegen, bearbeiten, Journal, Verknüpfungen, Anhänge: `incidents:contributor`
- Wieder öffnen, abbrechen, löschen und eine Einschränkung aufheben: `incidents:admin`

Diese Berechtigungen decken auch die Vorfallanalyse und den PDF-Export ab. Wer an Vorfällen arbeitet, braucht also keine Berechtigung für die Wissensdatenbank, um die Analyse zu schreiben. Siehe [Übersicht](#ubersicht).

Ein eingeschränkter Vorfall ist für alle unsichtbar außer den Registeradministratoren, dem Melder und dem Verantwortlichen. Auf einem Standard-Mandanten sind das Administrator und IT-Landschaft-Administrator, plus wer den Vorfall erfasst hat oder dafür verantwortlich ist. Leser und Mitwirkende, die weder Melder noch Verantwortlicher sind, sehen ihn weder in der Liste, in der Suche, im Chat noch in einem Export. Das Öffnen über die Referenz liefert dieselbe „nicht gefunden“-Antwort wie eine fehlende Nummer. Auch seine verknüpften Aufgaben bleiben ihnen verborgen: in der Aufgabenliste, in der Suche, im Dashboard, in Plaid und unter den verknüpften Objekten. Die Vorfallanalyse unterliegt derselben Einschränkung, ganz gleich, von wo aus sie erreicht wird: Wissensdatenbank, Suche, Assistent, Exporte und die darin eingefügten Bilder.

**Auf Registeradministratoren beschränken** steht in der Eigenschaftenleiste unter Klassifizierung. Ein Mitwirkender kann es einschalten, solange er den Datensatz noch sieht; nur ein Administrator kann es ausschalten, auch nach dem Schließen. Die Änderung wird ins Journal geschrieben. Das Prüfprotokoll zeigt die Einträge eines eingeschränkten Vorfalls, seiner Analyse und seiner Aufgaben nur Personen, die den Vorfall sehen, und Dokument-Beziehungschips lassen seinen Titel weg. Nur die Liste „Kürzlich angesehen“, die im Browser jeder Person liegt, kann den Titel noch jemandem zeigen, der den Vorfall vor der Einschränkung geöffnet hat.

---

## Arbeiten mit der Liste

Die Liste ist das Register selbst: alle Vorfälle, die zuletzt erkannten zuerst.

**Standardspalten**:

| Spalte | Was sie zeigt |
|--------|---------------|
| **Ref** | Vorfallsreferenz (z. B. `INC-14`), in Monospace |
| **Titel** | Kurze Zusammenfassung (zum Öffnen des Vorfalls anklicken) |
| **Kategorie** | Klassifizierung aus den Einstellungen der IT-Landschaft |
| **Schweregrad** | Kritisch, Schwerwiegend, Geringfügig, Niedrig, mit einem farbigen Punkt |
| **Status** | Offen, In Bearbeitung, Behoben, Geschlossen, Abgebrochen, mit einem farbigen Punkt |
| **Erkannt** | Wann der Vorfall bemerkt wurde |
| **Behoben** | Wann der Dienst wiederhergestellt war |
| **Verantwortlicher** | Zuständige Person |
| **Assets** | Anzahl der verknüpften Assets |
| **Aufgaben** | Anzahl der Folgeaufgaben |

**Standardsortierung**: **Erkannt** absteigend (neueste zuerst).

**Zusätzliche Spalten** (standardmäßig ausgeblendet, über die Spaltenauswahl verfügbar): **Geschlossen**, **Anwendungen**, **Erstellt**, **Personenbezogene Daten**, **Meldung erforderlich** und **Gemeldet am**. **Personenbezogene Daten** und **Meldung erforderlich** bieten einen Ja/Nein-Filter.

**Filtern**: Kategorie, Schweregrad, Status und Verantwortlicher bieten Kontrollkästchenfilter, deren Optionen aus den aktuell angezeigten Vorfällen berechnet werden, Sie sehen also nur Werte, die in der Ergebnismenge vorkommen. Datumsspalten bieten Datumsfilter, auch als Bereich: Filtern Sie **Erkannt** zwischen zwei Daten, um einen Quartals- oder Jahresauszug zu erzeugen. Die Suche erfasst Titel, Beschreibung, Referenz (`INC-14`) sowie Namen und Referenzen verknüpfter Assets und Anwendungen: Eine Suche nach einem Hostnamen wie `PAR-ESX-01` listet die Vorfälle zu diesem Asset. Wörter, die nur in der Vorfallanalyse vorkommen, findet die globale Suche oder der Assistent, nicht dieses Feld. Die globale Suche, die `@`-Auswahl in Plaid und der MCP-Server finden einen Vorfall auch über den Namen, die Referenz `AST-N`, den Hostnamen oder den FQDN seiner verknüpften Assets.

**Tipp**: Kombinieren Sie Schweregrad = Kritisch, Schwerwiegend mit einem Bereich für **Erkannt**, um die Auswahlliste zu erstellen, die die meisten Steuerungsgremien und Prüfungen verlangen.

Was Sie filtern, wird in den geöffneten Vorfall übernommen: **Zurück / Weiter** im Arbeitsbereich durchläuft genau diese Auswahlliste.

---

## Der Vorfalls-Arbeitsbereich

Klicken Sie auf eine beliebige Zeile, um den Vorfall zu öffnen. Der Arbeitsbereich hat einen **Kopfbereich** mit der Referenz und kurzen Metadaten, eine **Eigenschaftenleiste** rechts und einen **Inhaltsbereich** in der Mitte, der mit jedem Tab wechselt.

Die Tabs sind **Übersicht**, **Verlauf** (das Journal), **Beziehungen**, **Dokumente** und **Historie** (die Änderungen am Vorfall, siehe [Verlauf der Datensätze](record-history.md)).

### Kopfbereich und Metadaten

Der Kopfbereich zeigt den Titel (direkt bearbeitbar), die Referenz `INC-N` (zum Kopieren anklicken), die Lebenszyklus-Aktionen und **Zurück / Weiter**, um die gefilterte Liste zu durchlaufen.

Die Metadatenzeile darunter zeigt **Status**, **Schweregrad**, **Verantwortlicher**, **Erkannt** und, sobald der Vorfall behoben ist, die **Dauer** zwischen Erkennung und Behebung. Schweregrad, Verantwortlicher und Erkannt lassen sich direkt in dieser Zeile ändern.

### Eigenschaftenleiste

Die Leiste bleibt auf jedem Tab sichtbar und speichert während der Bearbeitung.

**Klassifizierung**:

- **Kategorie**: aus der in den Einstellungen der IT-Landschaft konfigurierten Liste
- **Schweregrad**: Kritisch, Schwerwiegend, Geringfügig, Niedrig. Wählen Sie die Stufe, die die geschäftliche Auswirkung zum jeweiligen Zeitpunkt widerspiegelt; jede Änderung wird im Journal festgehalten, ein späteres Anheben oder Absenken ist also normal und nachvollziehbar
- **Status**: Offen, In Bearbeitung, Behoben, Geschlossen. Der Status bewegt sich nur vorwärts. Der Weg zurück führt über **Wieder öffnen**, damit das Register nicht unbemerkt zurückgedreht werden kann
- **Auf Registeradministratoren beschränken**: den Vorfall vor anderen Lesern und Mitwirkenden verbergen. Melder und Verantwortlicher sehen ihn weiter. Nur ein Administrator kann die Einschränkung aufheben, auch nach dem Schließen. Wenn sie aktiv ist, zeigt die Metadatenzeile **Eingeschränkt**

**Daten**:

- **Begonnen**: wann der Vorfall tatsächlich begann
- **Erkannt**: wann er bemerkt wurde (Pflichtfeld)
- **Behoben**: wird automatisch gesetzt, wenn Sie den Status auf Behoben ändern, und bleibt bearbeitbar, solange der Vorfall offen ist, damit Sie den tatsächlichen Zeitpunkt der Wiederherstellung eintragen können
- **Geschlossen**: schreibgeschützt, wird beim Schließen des Vorfalls gesetzt

**Personen**: **Melder** (wer ihn erfasst hat) und **Verantwortlicher** (wer ihn bearbeitet).

**Quelle**: **Externe Referenz** für die Ticketnummer, die Alarm-ID oder die Mail-Referenz, über die der Vorfall zuerst gemeldet wurde.

**Compliance**: **Personenbezogene Daten betroffen**, **Meldung an Behörde erforderlich**, **Gemeldet am** (erscheint, sobald eine Meldung erforderlich ist) und **Informierte Parteien**.

**Datensatz**: Zeitstempel **Erstellt** und **Aktualisiert**, schreibgeschützt.

---

### Übersicht

Die Übersicht erzählt den Vorfall in zwei Teilen: eine kurze Beschreibung, dann die Vorfallanalyse. Beide speichern automatisch während der Eingabe. Die Anhänge schließen die Seite ab.

**Beschreibung** sind ein bis zwei Sätze dazu, was passiert ist, wie beobachtet. Es ist die Zusammenfassung, die in der Liste, in den Suchergebnissen und oben im PDF-Bericht erscheint.

**Vorfallanalyse** ist die vollständige Schilderung, geschrieben in einem Dokument statt in einfachen Textfeldern. Sie nimmt Überschriften, Listen, Tabellen, Links und Bilder auf, die Sie direkt in den Text einfügen.

Ein neuer Vorfall startet aus der Vorlage **Vorfallanalyse**, die die fünf Teile vorschlägt, in deren Reihenfolge ein Vorfallsbericht üblicherweise gelesen wird:

- **Ausführliche Beschreibung**: was passiert ist, im Detail
- **Auswirkung**: betroffene Dienste, Standorte und Benutzer
- **Ursache**: warum es passiert ist
- **Korrekturmaßnahmen**: was zur Behebung und zur Vorbeugung getan wurde. Die eigentliche Folgearbeit verfolgen Sie als verknüpfte Aufgaben
- **Erkenntnisse**: was aus diesem Vorfall mitzunehmen ist

Schreiben Sie sie um, entfernen Sie, was Sie nicht brauchen, ergänzen Sie Eigenes. Bei einem geringfügigen Vorfall genügt die kurze Beschreibung. Bei einem schwerwiegenden ist die Analyse der Post-Mortem-Bericht.

Die Überschriften erscheinen in der Sprache der Person, die den Vorfall erfasst (Englisch, Französisch, Deutsch oder Spanisch). Eine von Ihren Administratoren umgeschriebene Vorlage behält ihren eigenen Wortlaut.

Die Vorlage ist ein gewöhnliches Dokument der Wissensdatenbank, gespeichert in der Bibliothek **Vorlagen** unter dem Dokumenttyp **Vorfallanalyse**. Wer `knowledge:admin` hat, bearbeitet sie wie jedes andere Dokument dieser Bibliothek und passt sie so an Ihr eigenes Post-Mortem-Format an. Eine neue Vorlage gilt für die danach erfassten Vorfälle und schreibt eine bereits vorhandene Analyse nie um.

Jedes Speichern, das die Analyse verändert, hält eine Version fest. Der Text lässt sich damit so nachlesen, wie er zu jedem Zeitpunkt stand, auch beim Schließen des Vorfalls. Siehe [Journal](#journal).

Die Analyse ist selbst ein Dokument der Wissensdatenbank, mit eigener Referenz `DOC-N`, abgelegt im Ordner **Vorfälle** der Bibliothek **Verwaltete Dokumente**. Das Schreiben aus dem Vorfall heraus und der PDF-Export nutzen allein die Berechtigungen des Registers. Wer dasselbe Dokument direkt in der Wissensdatenbank öffnet, braucht zusätzlich die Berechtigungen der Wissensdatenbank für diese Bibliothek. In beiden Fällen bleibt sie an den Vorfall gebunden: Sie wird gesperrt, sobald der Vorfall geschlossen oder abgebrochen ist, und bleibt für alle unsichtbar, die einen eingeschränkten Vorfall nicht sehen dürfen.

**Anhänge** enthalten die Dateien, die den Vorgang belegen: Screenshots, Log-Auszüge, Mail-Exporte, den Vorfallsbericht des Lieferanten. Mit `incidents:contributor` ziehen Sie Dateien per Drag-and-drop hierher oder klicken, um sie auszuwählen. Klicken Sie auf einen Anhang, um ihn herunterzuladen. Der Abschnitt erscheint, sobald der Vorfall eine Datei hat oder wenn Sie ihn bearbeiten dürfen. Bei einem geschlossenen oder stornierten Vorfall bleiben die Dateien lesbar. Hinzufügen und Löschen sind nach dem Wiedereröffnen wieder möglich.

---

### Journal

Das Journal macht daraus ein Register statt eines Formulars. Es listet alles auf, was mit dem Vorfall geschehen ist, das Neueste zuerst, und **nichts darin lässt sich bearbeiten oder löschen**, von niemandem, zu keinem Zeitpunkt.

**Eine Notiz hinzufügen**: Schreiben Sie sie in das Eingabefeld oben und klicken Sie auf **Hinzufügen** (oder drücken Sie Strg+Eingabe). Datum und Uhrzeit neben der Schaltfläche legen den Zeitpunkt fest, auf den sich die Notiz bezieht. Die Uhrzeit wird im 24-Stunden-Format eingegeben (23:40). Voreingestellt ist jetzt, und Sie können ihn in die Vergangenheit legen: Eine am Dienstag hinzugefügte Notiz kann als am Samstag um 23:40 Uhr geschehen erfasst werden und wird an dieser Stelle der Chronologie einsortiert. KANAP speichert getrennt davon den Moment, in dem die Notiz tatsächlich gesichert wurde, und niemand kann ihn ändern: Rückdatierung bleibt damit ehrlich. Bezieht sich eine Notiz auf einen früheren Zeitpunkt als ihre Erfassung, zeigt ihre Zeile auch den Erfassungszeitpunkt, zum Beispiel „erfasst am 27. Okt., 10:12“. Der PDF-Bericht gibt beide Zeiten in zwei Spalten an.

**Automatische Einträge** erscheinen neben Ihren Notizen:

| Eintrag | Wann er geschrieben wird |
|---------|--------------------------|
| **System** | Beim Anlegen: „Vorfall erfasst" |
| **Statusänderung** | Bei jeder Statusänderung, dargestellt als „Status: In Bearbeitung → Behoben" |
| **Änderung des Schweregrads** | Bei jeder Änderung des Schweregrads, gleiches Format |
| **Wieder geöffnet** | Beim Wiederöffnen, mit dem angegebenen Grund |
| **Verknüpfungen aktualisiert** | Wenn Assets oder Anwendungen verknüpft oder gelöst werden, mit deren Namen |

Jede Zeile zeigt den Autor, die Zeit, auf die sie sich bezieht (für „vor 3 Tagen" darüberfahren), und die Art des Eintrags für alles, was keine einfache Notiz ist.

Ein Eintrag **Verknüpfungen aktualisiert** erscheint nur für Personen, die das genannte Modul lesen dürfen: Assets und Technologien erfordern die Infrastruktur, Anwendungen die Anwendungen. Notizen behalten ihren Text, unabhängig davon, was sie erwähnen.

Das Eingabefeld verschwindet, sobald der Vorfall geschlossen oder abgebrochen ist. Feldänderungen außerhalb des Journals, etwa die Korrektur der Beschreibung, erscheinen im Tab **Historie**.

Die Vorfallanalyse führt ihre eigene Historie. Jedes Speichern, das sie verändert, erzeugt eine Version, und die Versionen bleiben dauerhaft erhalten. Gewöhnliches Bearbeiten erzeugt keine Journaleinträge: Das Schreiben der Analyse ist kein Ereignis des Vorfalls, und das Audit-Protokoll hält fest, wer was geändert hat. Schließen, Abbrechen und Importe schreiben dagegen einen Journaleintrag, und dieser Eintrag nennt die Version der Analyse, auf die er sich bezieht, dargestellt als „Vorfallanalyse, Version 4 (DOC-12)".

Das Wiederöffnen eines Vorfalls ändert daran nichts. Die Versionen bleiben, der Eintrag zum Schließen verweist weiterhin auf die Version, die beim Schließen des Datensatzes aktuell war, und dieser Text lässt sich später weiterhin mit den enthaltenen Bildern lesen, unter den Zugriffsregeln, die für den Vorfall dann gelten.

---

### Beziehungen

Der Reiter Beziehungen zeigt, was der Vorfall betrifft: seine Assets, Anwendungen und Technologien, jeweils in einer eigenen Tabelle, danach Vorschläge und die Aufgaben. Klicken Sie auf eine Tabellenzeile, um den Datensatz zu öffnen. Das Reiter-Badge zählt die verknüpften Assets, Anwendungen und Technologien, die Sie sehen dürfen, sowie die Aufgaben.

**Verknüpfte Datensätze**, jeweils eine Tabelle:

| Abschnitt | Spalten |
|---|---|
| **Assets** | Referenz (`AST-12`), Name, Typ, Umgebung, Status |
| **Anwendungen** | Referenz (`APP-3`), Name, Lebenszyklus, Geschäftskritikalität |
| **Technologien** | Referenz (`TEC-5`), Name, Familie, Hersteller |

Sie sehen nur die Abschnitte der Module, die Sie lesen dürfen. Assets und Technologien erfordern Leserechte auf die Infrastruktur. Ein Fachbereichs-Mitwirkender sieht nur die Anwendungen, an denen er beteiligt ist.

**Verknüpfungen hinzufügen und entfernen** (`incidents:contributor`): **Hinzufügen** rechts neben einem Abschnitt öffnet eine Suche. Geben Sie einen Namen oder eine Referenz ein und wählen Sie ein Ergebnis: Die Verknüpfung wird sofort gespeichert und im Journal festgehalten. Das Verknüpfen erfordert zusätzlich Leserechte auf das Zielmodul. **Hinzufügen** fehlt daher in einem Abschnitt, den Sie nicht lesen dürfen. Um eine Verknüpfung zu entfernen, fahren Sie mit der Maus über die Zeile und klicken Sie auf das Kreuz am Zeilenende. Das Entfernen einer Verknüpfung löscht nichts anderes und wird ebenfalls im Journal festgehalten. Ein geschlossener oder abgebrochener Vorfall ist schreibgeschützt: Öffnen Sie ihn erneut, um seine Verknüpfungen zu ändern.

**Verwandt**: die Technologien der verknüpften Assets und Anwendungen, die der Vorfall noch nicht aufführt. Der Grund nennt die Quelle, zum Beispiel „Technologie des Assets AST-12“ oder „Technologie der Anwendung APP-3“. Klicken Sie auf **Verknüpfen**, um den Vorschlag dem Abschnitt Technologien hinzuzufügen. Die Vorschläge erfordern Leserechte auf die Infrastruktur, zeigen höchstens 20 Technologien und fehlen bei einem geschlossenen oder abgebrochenen Vorfall.

**Aufgaben**: die Folgearbeit. Legen Sie eine Aufgabe direkt aus dem Vorfall heraus an, sie bleibt daran gebunden. Die Aufgabe zeigt „Vorfall · INC-14“ in ihrer eigenen Seitenleiste, und die Spalte Aufgaben des Vorfalls zählt sie mit.

Ein verknüpftes Asset, eine verknüpfte Anwendung oder Technologie zeigt den Vorfall in einem Abschnitt **Vorfälle** auf dem eigenen Reiter Beziehungen: Wer einen Server ansieht, sieht dessen Störungsgeschichte. Mit `incidents:contributor` können Sie dort auch einen Vorfall verknüpfen. Dokumente haben einen eigenen Reiter.

---

### Dokumente

Mit diesem Vorfall verknüpfte Dokumente der Wissensdatenbank: der Bericht des Lieferanten, die befolgte Prozedur, die Notiz des Netzwerkteams. Mit `knowledge:member` können Sie ein Dokument direkt aus diesem Tab heraus anlegen.

Die Vorfallanalyse steht hier nicht. Sie gehört zum Vorfall selbst und wird auf dem Tab Übersicht bearbeitet.

---

## Schließen, wieder öffnen und abbrechen

**Behoben** bedeutet, dass der Dienst wiederhergestellt ist. **Geschlossen** bedeutet, dass der Datensatz endgültig ist.

Das Schließen sperrt den Vorfall. Felder, die Vorfallanalyse, Journalnotizen, Verknüpfungen, Anhänge und das Anlegen von Aufgaben werden abgewiesen, in der Oberfläche, in der Wissensdatenbank, im Assistenten wie über die API. Die Übersicht zeigt einen einzeiligen Hinweis: „Geschlossen am 12. März 2026. Öffnen Sie ihn wieder, um Änderungen vorzunehmen." Die Analyse wird auf der Version eingefroren, die der Journaleintrag nennt, gleich ob der Vorfall aus dem Arbeitsbereich heraus oder durch einen Import geschlossen wurde.

**Wieder öffnen** (`incidents:admin`) setzt einen behobenen, geschlossenen oder abgebrochenen Vorfall zurück auf In Bearbeitung und löscht die Behebungs- und Schließdaten. Ein Grund ist erforderlich und wird ins Journal geschrieben, der Datensatz zeigt also, warum er erneut angefasst wurde.

**Vorfall abbrechen** (`incidents:admin`) ist für einen Datensatz gedacht, den es nie hätte geben dürfen: ein Duplikat oder ein irrtümlich erfasstes Ereignis. Ein Grund ist erforderlich, der Status wird Abgebrochen, und der Vorfall wird wie ein geschlossener gesperrt. Nichts wird gelöscht und die Nummer bleibt erhalten: `INC-13` verschwindet nie zwischen `INC-12` und `INC-14`. Eine Lücke in der Nummerierung wäre das Erste, wonach ein Prüfer fragt.

### Einen Vorfall löschen

**Löschen** (`incidents:admin`) steht als Papierkorbsymbol auf der Seite des Vorfalls und in der Liste, sobald Zeilen ausgewählt sind. Es entfernt einen irrtümlich erfassten Vorfall, etwa ein Duplikat oder einen Testeintrag. Nur ein offener, in Bearbeitung befindlicher oder gelöster Vorfall kann gelöscht werden. Ein geschlossener oder abgebrochener Vorfall bleibt im Register und behält seine Nummer `INC-N`. Andere Benutzer sehen weder die Schaltfläche noch die Auswahl.

Bevor etwas entfernt wird, listet eine Bestätigung auf, was mit dem Vorfall gelöscht wird: seine Vorfallsanalyse, seine Aufgaben, seine Journaleinträge und seine Anhänge (samt Dateien). Sie listet auch die entfernten Verknüpfungen auf: Anwendungen, Assets und Knowledge-Dokumente bleiben erhalten, nur ihre Verknüpfung mit dem Vorfall entfällt. Die Löschung wird im Audit-Trail festgehalten.

Ein Vorfall mit Daten der behördlichen Meldung kann nicht gelöscht werden: **Personenbezogene Daten betroffen** oder **Meldung an Behörde erforderlich** angehakt, **Gemeldet am** oder **Informierte Parteien** ausgefüllt. Ein solcher Datensatz ist ein Prüfnachweis (Meldung an die Behörde nach NIS2 und Artikel 33(5) DSGVO, der die Dokumentation jeder Verletzung des Schutzes personenbezogener Daten verlangt). Die Bestätigung sagt das, bevor etwas geschieht: Brechen Sie den Vorfall stattdessen ab oder schließen Sie ihn. In einer Auswahl bleiben die Vorfälle erhalten, die nicht gelöscht werden können, und die anderen werden gelöscht.

---

## Compliance und Prüfnachweise

Zwei Schalter in der Eigenschaftenleiste tragen den regulatorischen Teil des Datensatzes:

- **Personenbezogene Daten betroffen**: Schalten Sie ihn ein, sobald personenbezogene Daten offengelegt, verändert oder verloren wurden. Es ist das Merkmal, nach dem Ihr Datenschutzbeauftragter filtert
- **Meldung an Behörde erforderlich**: Schalten Sie ihn ein, wenn das Ereignis gemeldet werden muss, etwa an eine Datenschutzbehörde, eine nationale Cybersicherheitsbehörde oder einen Branchenregulierer. **Gemeldet am** hält dann fest, wann Sie gemeldet haben, und **Informierte Parteien** listet auf, wer benachrichtigt wurde: Regulierer, Versicherer, betroffene Kunden, Konzernsicherheit

Fristen und Schwellenwerte hängen von Ihrer Rechtsordnung und Ihrer Branche ab. KANAP hält die Fakten und die Daten fest; es entscheidet nicht, ob Sie melden müssen.

**Was das Register einem Prüfer bietet**:

- Eine nummerierte Folge, in der geschlossene und abgebrochene Vorfälle nie gelöscht werden
- Für jeden Vorfall: wann er begann, wann er bemerkt wurde, wann er behoben und geschlossen wurde und wer verantwortlich war
- Ein Journal, das nicht umgeschrieben werden kann, mit jeder Status- und Schweregradänderung datiert und einer Person zugeordnet
- Die Nachweise selbst, als Anhänge und verknüpfte Dokumente
- Die Vorfallanalyse mit der Ursache, den Korrekturmaßnahmen und den Erkenntnissen, Version für Version aufbewahrt, und die Folgeaufgaben, die die Umsetzung der Maßnahmen belegen
- Gefilterte Sichten nach Zeitraum, Schweregrad, Kategorie oder Compliance-Merkmal, direkt aus der Liste
- Ein Export des Registers als CSV oder Excel (**Exportieren** in der Liste), für Prüfer und für Ihr eigenes Archiv. Die Datei beginnt mit der INC-Referenz. Er folgt den Filtern, der Suche und der Sortierung der Liste, und bei aktivem Filter nennt der Dialog die Anzahl der exportierten Vorfälle. Eingeschränkte Vorfälle entfallen, es sei denn, Sie dürfen sie sehen; die Datei enthält eine importierbare Spalte **Auf Registeradministratoren beschränken**
- Ein PDF-Bericht zu einem einzelnen Vorfall (**PDF exportieren** im Arbeitsbereich), für den Prüfer, der eine Akte statt des gesamten Registers möchte

**Ein bestehendes Register importieren**: **Importieren** in der Liste nimmt eine CSV-Datei oder eine Excel-Arbeitsmappe (`.xlsx`) entgegen. Lassen Sie die Referenzspalte leer, um Vorfälle anzulegen (KANAP vergibt die nächsten INC-Nummern), oder behalten Sie die Referenz INC-N bei, um die passenden Datensätze zu aktualisieren. Jeder importierte Vorfall erhält einen Journaleintrag, der auf die Herkunft aus einer Datei hinweist. Exportieren Sie zuerst oder laden Sie die leere Vorlage herunter, wenn Sie das exakte Spaltenlayout möchten. Die Vorlage berücksichtigt die Filter der Liste nicht.

Kopfzeilen, Schweregrad und Status werden in der Sprache des Exports geschrieben. Der Import akzeptiert Kopfzeilen und Werte in jeder der vier Sprachen, ebenso die technischen Codes (`major`, `in_progress`).

Ein Status kann per Datei vorwärts gehen. Ihn zurückzusetzen oder einen Vorfall abzubrechen erfordert `incidents:admin`: Das Journal erhält dann eine Wiedereröffnung oder einen Abbruch mit dem Grund „Imported from CSV“. Für einen Mitwirkenden wird eine solche Zeile mit einer Meldung abgelehnt.

Die Datei führt die kurze **Beschreibung** in einer Spalte und die gesamte **Vorfallanalyse** in einer anderen, als formatierten Text. Diese eine Analysespalte ersetzt die früheren Spalten Auswirkung, Ursache, Korrekturmaßnahmen und Erkenntnisse. Überschriften, Listen und Links überstehen den Hin- und Rückweg; eingefügte Bilder nicht, denn sie liegen im Dokument. Eine leere Analysezelle lässt den vorhandenen Text unverändert.

Datum und Uhrzeit stehen in der Ortszeit Ihres Browsers in der Datei, so wie die Exportsprache Daten schreibt: Ein um 10:38 in Paris erkannter Vorfall steht auf Deutsch als `16.10.2026 10:38` in der Datei. Die Kopfzeile jeder Datums- und Uhrzeitspalte nennt diese Zeitzone nach dem Spaltennamen, zum Beispiel `detected_at (Europe/Paris)`, und die Vorlage nennt sie ebenfalls. Der Import liest jede Spalte in der Zeitzone, die ihre Kopfzeile nennt, sodass eine exportierte Datei unverändert wieder eingelesen wird, wo immer sie importiert wird. Eine Kopfzeile ohne Zeitzone, wie in älteren oder von Hand erstellten Dateien, wird in UTC (koordinierte Weltzeit) gelesen. Eine Zeitzone, die KANAP nicht kennt, stoppt den Import. Der Import akzeptiert auch `2026-10-16T08:38:00Z`, das seine eigene Zeitzone enthält.

Der Import ist der einzige Vorgang, der noch in einen geschlossenen oder abgebrochenen Vorfall schreibt. Eine Korrektur, die Monate später eintrifft, lässt sich also festhalten, ohne den Datensatz wieder zu öffnen. Er erzeugt eine neue Version der Analyse und einen Journaleintrag, der darauf verweist, und er schreibt die Version, auf die sich das Schließen bezieht, nie um. Sonst wird nichts gelockert: Die Berechtigungen des Registers gelten, und ein eingeschränkter Vorfall, den Sie nicht sehen dürfen, wird abgewiesen.

---

## Einen PDF-Bericht für einen Prüfer exportieren

Öffnen Sie einen Vorfall und klicken Sie in den Aktionen der Kopfzeile auf **PDF exportieren**. KANAP lädt ein PDF dieses Datensatzes herunter: `INC-12-incident-report.pdf`. Der Download verwendet Ihre angemeldete Sitzung; es ist kein öffentlicher Link.

Der Bericht folgt der Sprache der Oberfläche (Englisch, Französisch, Deutsch oder Spanisch). Er ist in dieser Reihenfolge aufgebaut:

1. Kopfzeile und Eigenschaften des Vorfalls
2. Die kurze Beschreibung
3. Die Vorfallanalyse in ihrem aktuellen Stand, mit ihrer Formatierung und ihren Bildern
4. Das Journal in chronologischer Reihenfolge, einschließlich der Analyseversionen, auf die die Einträge verweisen
5. Verknüpfte Assets, Anwendungen, Technologien, Aufgaben (mit Zuständigem und Fälligkeitsdatum) und Dokumente
6. Die Compliance-Felder
7. Die Anhänge (Dateiname, Größe und Datum)

Leere Abschnitte entfallen, und eine Analyse, die nur die unveränderten Überschriften der Vorlage enthält, gilt als leer. Jeder verknüpfte Abschnitt folgt den Berechtigungen des Lesers: Assets und Technologien erfordern Leserechte auf die Infrastruktur, Anwendungen Leserechte auf die Anwendungen (ein Fachbereichs-Mitwirkender sieht die, an denen er beteiligt ist) und Aufgaben Leserechte auf die Aufgaben. Ein Abschnitt, den Sie nicht lesen dürfen, fehlt.

Der Export ist ein Lesevorgang. Er funktioniert bei einem geschlossenen oder abgebrochenen Vorfall; der Datensatz bleibt gesperrt. Die Schaltfläche wird auf **Neuer Vorfall** nicht angezeigt.

---

## Kategorien

Die Vorfallskategorien gehören Ihnen: Legen Sie sie in **IT-Landschaft > Einstellungen** unter **Vorfälle > Vorfallskategorien** fest. KANAP liefert Infrastruktur, Sicherheit, Anwendung, Daten, Lieferant und Sonstiges mit.

Halten Sie die Liste kurz. Kategorien sind das, wonach Sie ein Jahr an Vorfällen gruppieren werden, und eine Liste mit dreißig Einträgen nutzt niemand einheitlich. Statt eine bereits verwendete Kategorie zu löschen, markieren Sie sie als veraltet: Sie verschwindet aus der Auswahl für neue Vorfälle, während die bestehenden ihre Historie behalten.

---

## Den Assistenten fragen

Plaid liest und schreibt das Register im Chat, mit denselben Berechtigungen wie im Rest der Anwendung. Jede Änderung kommt als Vorschau, die Sie genehmigen.

**Lesen**: Bitten Sie Plaid um eine Zählung („Wie viele kritische Vorfälle in diesem Quartal?“), eine gefilterte Liste („Offene Vorfälle auf PAR-ESX-01“) oder einen vollständigen Datensatz („Zusammenfassung von INC-2“). Der vollständige Datensatz enthält das Journal und die Vorfallanalyse, eine Frage lässt sich also aus der Ursache oder den Erkenntnissen beantworten. Zeiten werden in Ihrer eigenen Zeitzone angegeben. Liest Plaid einen Vorfall, folgen die verknüpften Objekte denselben Berechtigungen wie im PDF-Bericht. Ein eingeschränkter Vorfall, den Sie nicht sehen dürfen, bleibt aus den Antworten, den Zählungen, den Gruppierungen, den Durchschnitten und den Quellen heraus, samt seiner Analyse.

Plaid filtert Vorfälle nach Asset, Anwendung oder Technologie, angegeben mit Referenz oder exaktem Namen: `APP-1` bringt nicht die Vorfälle von `APP-12`. Nach Asset, Anwendung oder Technologie gruppiert, zählt ein Vorfall in jedem seiner verknüpften Datensätze, die Gruppen können also zusammen mehr als die Gesamtzahl ergeben. Ein Vorfall ohne Verknüpfung erscheint in keiner Gruppe. Plaid gruppiert Vorfälle auch nach Monat der Erkennung oder der Behebung. Die Monate folgen UTC (koordinierte Weltzeit): Ein Vorfall, der am 1. November um 00:30 in Paris erkannt wurde, zählt im Oktober. Plaid liest die Behebungsdauer, von der Erkennung bis zur Behebung in Stunden, für jeden Vorfall oder als Durchschnitt, Minimum oder Maximum. Abgebrochene und nicht behobene Vorfälle bleiben dabei außen vor. Fragen Sie zum Beispiel: „Durchschnittliche Behebungsdauer der Vorfälle mit Schweregrad Hoch pro Monat in diesem Jahr“.

**Schreiben** (Stufe Mitwirkender für Vorfälle): Plaid erfasst einen Vorfall, ändert seine Felder und setzt seinen Status bis Geschlossen voran. Es erfasst einen Vorfall als Offen oder In Bearbeitung. Ein bereits behobener Vorfall wird offen erfasst und dann in einer zweiten Vorschau vorangesetzt, damit der Schritt im Journal erscheint. Plaid kann **Auf Registeradministratoren beschränken** einschalten. Die Vorschau warnt Sie, wenn Ihnen der Vorfall dadurch verborgen würde. Plaid fügt außerdem Notizen zum Journal hinzu, mit dem Zeitpunkt, auf den sich die Notiz bezieht, wenn Sie ihn angeben, und verknüpft Assets, Anwendungen und Technologien oder löst diese Verknüpfungen, angegeben mit Referenz oder exaktem Namen, bei einem Asset auch mit Hostname oder FQDN. Mit der Stufe Mitglied für Aufgaben legt es eine Folgeaufgabe zum Vorfall an. Fragen Sie zum Beispiel: „Erfasse einen Vorfall mit Schweregrad Hoch: E-Mail im Büro Lyon seit 08:40 nicht verfügbar, verknüpft mit PAR-MAIL-01“.

Das Schließen friert den Datensatz ein, und die Vorschau des Schließens sagt es. Nur ein Administrator kann den Vorfall wieder öffnen.

**Administratoraktionen** (Stufe Administrator für Vorfälle): Plaid öffnet einen behobenen, geschlossenen oder abgebrochenen Vorfall wieder, bricht einen Vorfall ab und schaltet **Auf Registeradministratoren beschränken** ein oder aus, auch bei einem geschlossenen oder abgebrochenen Vorfall. Wiederöffnen und Abbrechen verlangen einen Grund, der ins Journal geschrieben wird, zum Beispiel: „Öffne INC-14 wieder: Das Problem ist nach der Korrektur zurückgekehrt“.

Das Löschen eines Vorfalls und das Hinzufügen von Anhängen bleiben auf der Seite des Vorfalls (siehe [Einen Vorfall löschen](#einen-vorfall-loschen)). Über MCP verbundene Assistenten lesen nur.

---

## Tipps

- **Früh erfassen, später vervollständigen**: Legen Sie den Vorfall an, während er läuft, mit Titel und Schweregrad. Das Journal ist dafür gebaut, Fakten nach und nach aufzunehmen
- **Notizen als Fakten schreiben, mit Uhrzeit**: „13:05 Umschaltung auf den Zweitstandort, Mail für 40 Benutzer wieder verfügbar". Setzen Sie Datum und Uhrzeit, damit die Chronologie den Vorfall abbildet und nicht Ihr Tipptempo
- **Ehrlich rückdatieren**: Begonnen und Erkannt sollen die tatsächlichen Zeiten tragen. Der Erfassungszeitpunkt jedes Journaleintrags wird getrennt gespeichert und lässt sich nicht ändern
- **Ein Vorfall, nicht einer pro Ticket**: Ein einzelner Ausfall, der vierzig Tickets erzeugt hat, ist ein Vorfall, verknüpft mit den betroffenen Assets
- **Maßnahmen in Aufgaben überführen**: Der Abschnitt Korrekturmaßnahmen der Analyse beschreibt die Absicht; eine Aufgabe mit zuständiger Person und Fälligkeitsdatum ist das, was tatsächlich erledigt wird
- **Bewusst schließen**: Mit dem Schließen wird der Datensatz zum Nachweis. Stellen Sie die Analyse fertig, bevor Sie schließen, denn die dabei festgehaltene Version ist die, die ein Prüfer lesen wird, und danach braucht es einen Administrator, um den Vorfall wieder zu öffnen
- **Das Register quartalsweise durchsehen**: Filtern Sie nach Zeitraum und Schweregrad, achten Sie auf wiederkehrende Kategorien und auf Assets, die mehr als einmal auftauchen. Von dort kommt die nächste Budgetanforderung
