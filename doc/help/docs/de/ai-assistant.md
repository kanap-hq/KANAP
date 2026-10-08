# Plaid

Plaid ist der integrierte Chat-Assistent von KANAP. Er ist mit denselben Daten verbunden, mit denen Sie ohnehin arbeiten — Anwendungen, Assets, Vorfälle, Projekte, Anfragen, Aufgaben, Verträge, Wissensdokumente und Stammdaten —, sodass Sie Fragen in natürlicher Sprache stellen können, anstatt sich durch mehrere Bildschirme zu klicken, um eine Antwort zu finden.

Plaid ersetzt nicht den Rest der Anwendung. Es ist ein schnellerer Weg, um Kontext zusammenzufassen, Datensätze zu finden, Text zu entwerfen oder Änderungen vorzubereiten. Sensible Vorgänge werden immer als Vorschauen angezeigt, die Sie genehmigen müssen, bevor etwas in KANAP zurückgeschrieben wird.

!!! note "Plaid vs. KI-Agenten"
    Plaid ist der interaktive Assistent, den **Sie** steuern: Sie fragen, er antwortet, und Sie genehmigen eine Änderung nach der anderen. **KI-Agenten** sind etwas anderes — sie sind autonome Helfer, die Ihren Service-Desk überwachen und Ticket-Arbeit eigenständig vorschlagen oder erledigen, innerhalb der von Ihnen festgelegten Freigabegrenzen. Siehe [KI-Agenten – Übersicht](agents-overview.md).

## Wo Sie es finden

- Arbeitsbereich: **Plaid** (obere Navigation)
- Route: `/ai`
- Berechtigung: `ai_chat:reader` erlaubt Ihnen, den Chat-Arbeitsbereich zu öffnen und Konversationen zu beginnen
- Feature-Flag: Die Chat-Oberfläche muss auf Ihrer Instanz aktiviert sein. Ist sie deaktiviert, zeigt der Arbeitsbereich einen Hinweis anstelle der Chat-Oberfläche.

Der Arbeitsbereich steht auch Administratoren mit `ai_chat:admin` zur Verfügung, die alles sehen und moderieren können, was normale Benutzer tun.

!!! note "Wartet auf einen Administrator"
    Im gehosteten Dienst kann Plaid auf dem inklusiven KANAP-Modell laufen. Zuvor bestätigt ein Administrator den Anbieter und den Ort, an dem er Daten verarbeitet. Bis dahin zeigt der Arbeitsbereich *Ein Administrator muss den KI-Anbieter unter Administration > Plaid bestätigen.* statt des Chats. Ein Administrator erledigt das auf der Seite [Plaid-Einstellungen](ai-settings.md#das-inklusive-kanap-modell-bestatigen). Organisationen, die ein eigenes Modell nutzen, sehen diesen Hinweis nie.

## Eine Konversation beginnen

Wenn Sie Plaid zum ersten Mal öffnen, gelangen Sie auf einen Begrüßungsbildschirm mit:

- Einem kurzen Slogan („Plaid ist bereit“) und einer Beschreibung dessen, was Sie fragen können
- Einem Abschnitt **Versuchen Sie** mit Beispiel-Prompts, die Sie zum Senden anklicken können
- Dem Eingabefeld am unteren Rand, bereit für Ihre erste Nachricht

Klicken Sie auf einen beliebigen Vorschlag, um ihn entweder direkt zu senden oder — bei Prompts, die einen `@`-Platzhalter enthalten — den Vorschlag in das Eingabefeld einzufügen, damit Sie ihn vervollständigen können.

Geben Sie eine Nachricht ein und drücken Sie **Eingabe** zum Senden. **Umschalt+Eingabe** fügt eine neue Zeile ein. Die Sende-Schaltfläche ist deaktiviert, solange nichts zu senden ist, und verwandelt sich in eine rote **Stopp**-Schaltfläche, während Plaid antwortet.

## Die Konversationsliste

Die linke Seitenleiste listet Ihre vergangenen Konversationen auf. Verwenden Sie das Menüsymbol oben links im Chat-Bereich, um sie ein- oder auszuklappen.

Die Liste enthält:

- Eine Schaltfläche **Neue Konversation** oben
- Ein Suchfeld, das erscheint, sobald Sie mindestens eine Konversation haben
- Nach Datum gruppierte Konversationen: **Heute**, **Gestern**, **Letzte 7 Tage**, **Älter**

Jede Zeile zeigt den Konversationstitel (oder **Ohne Titel**, wenn noch keiner festgelegt wurde). Fahren Sie mit der Maus über eine Zeile oder fokussieren Sie sie, um Folgendes einzublenden:

- Ein Stiftsymbol — die Konversation **Umbenennen**. Ein Doppelklick auf den Titel bewirkt dasselbe.
- Ein Papierkorbsymbol — die Konversation **Archivieren**. Archivierte Konversationen verschwinden aus der Liste. Wenn Sie die aktuell geöffnete Konversation archivieren, wechselt Plaid zu einem neuen, leeren Chat.

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

Die Eingabe von `@` öffnet die **Erwähnungsauswahl** über dem Eingabefeld. Damit können Sie auf jeden KANAP-Datensatz verweisen, auf den Sie Zugriff haben — mit zwei sich ergänzenden Modi:

- **Typ-Token-Präfix**: Kurzcodes, die einer einzelnen Entitätsfamilie zugeordnet sind. Beispiele:
  - `@T-5` — Aufgabe mit der Referenz T-5
  - `@DOC` — aktuelle Wissensdokumente
  - `@APP backup` — Anwendungen, die zu „backup“ passen
  - `@PRJ`, `@REQ`, `@INC`, `@AST`, `@CONN`, `@INT`, `@LOC`, `@CTR`, `@CPX`, `@COMP`, `@CONT`, `@DEPT`, `@SUP`, `@BP`
- **Klartext**: alles andere (`@payroll`, `@server-2`) startet eine typübergreifende Suche, sortiert nach Relevanz.

Verwenden Sie die Pfeiltasten, um durch die Vorschläge zu navigieren, **Eingabe** oder **Tab** zum Bestätigen und **Escape**, um die Auswahl zu schließen. Die Ergebnisse sind nach Entitätstyp gruppiert (Wissen, Aufgaben, Projekte, Anwendungen, Assets, Verträge usw.), sodass Sie auf einen Blick erkennen, welche Art von Datensatz Sie einfügen.

Wenn Sie einen Vorschlag bestätigen, zeigt das Eingabefeld weiterhin eine lesbare Bezeichnung an (`@DOC-152`, `@SAP S/4HANA`). Beim Senden der Nachricht wird jede Erwähnung in einen echten Link umgewandelt, dem Plaid zurück zum Quelldatensatz folgen kann.

### Eine Nachricht bearbeiten oder neu generieren

Fahren Sie mit der Maus über eine Ihrer vorherigen Nachrichten, um Aktionen auf Nachrichtenebene zu erhalten:

- **Kopieren** — den Nachrichtentext in die Zwischenablage kopieren
- **Bearbeiten** — die Nachricht in einem Inline-Editor erneut öffnen; beim Speichern wird die neue Version gesendet und alles danach abgeschnitten (die Konversation läuft ab diesem Punkt neu)
- **Neu generieren** (bei Assistentenantworten) — Plaid bitten, eine weitere Antwort auf denselben Prompt zu erzeugen

Bearbeiten ist die richtige Wahl, wenn Sie feststellen, dass Ihre frühere Frage unklar war. Neu generieren ist die richtige Wahl, wenn die Frage in Ordnung war, die Antwort aber nicht.

## Wie Plaid antwortet

Plaid streamt seine Antwort Zeichen für Zeichen. Während des Streamings:

- Das Eingabefeld bleibt nutzbar, sodass Sie eine Anschlussfrage vorbereiten können
- Die Sende-Schaltfläche zeigt ein rotes **Stopp**-Symbol — ein Klick darauf bricht die laufende Antwort ab
- Ein kleiner Indikator „Tools werden verwendet…“ erscheint, wenn Plaid KANAP durchsucht, ein Dokument abruft oder einen anderen Tool-Aufruf ausführt
- Anzahl und Art der verwendeten Tools werden unter der Antwort zusammengefasst, sobald sie fertig ist

Wenn der Stream endet, springt der Fokus zurück zum Eingabefeld, sodass Sie die Konversation fortsetzen können, ohne zur Maus zu greifen.

### Tool-Aufrufe

Plaid verwendet eine kleine Auswahl interner Tools, um Fragen zu beantworten: `Search all`, `Search knowledge`, `Get document`, `Get entity context` und einige weitere. Jeder Tool-Aufruf erscheint als kompakte Zeile unter der Nachricht („Alles durchsuchen verwendet · 8 Ergebnisse“). In der Regel müssen Sie die Tool-Details nicht lesen, aber sie sind vorhanden, falls Sie genau sehen möchten, auf welchen Datensätzen die Antwort beruht.

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

- **Genehmigen** — bestätigt die Änderung und lässt Plaid sie anwenden
- **Ablehnen** — verwirft die Änderung. Plaid bestätigt die Ablehnung und setzt die Konversation fort.

Nichts, was KANAP-Daten verändert, wird stillschweigend angewendet. Die Vorschau ist die Kontrollinstanz.

## Nutzungsanzeigen

Über dem Eingabefeld helfen Ihnen zwei kleine Anzeigen, Kosten und Grenzen im Blick zu behalten:

- **Integrierte Nutzung**: Wenn Plaid mit dem inklusiven KANAP-Modell arbeitet und nicht mit einem der eigenen Modelle Ihrer Organisation, zeigt dies, wie viele Nachrichten im aktuellen Monat verbleiben und an welchem Datum das Kontingent zurückgesetzt wird. Ein Administrator hat dieses Modell zuvor bestätigt (siehe [Plaid-Einstellungen](ai-settings.md#das-inklusive-kanap-modell-bestatigen)). Ist das Limit erreicht, wird das Eingabefeld deaktiviert und ein Hinweistext fordert Administratoren auf, auf ein eigenes Modell zu wechseln; siehe [KI-Modelle](ai-models.md).
- **Token-Nutzung**: ein schmaler Balken mit Zählern für Eingabe-/Ausgabe-Tokens der aktuellen Konversation sowie der Größe der letzten Anfrage. Lange Konversationen werden mit der Zeit teurer; der Balken macht diese Kosten sichtbar, sodass Sie entscheiden können, wann Sie einen neuen Verlauf beginnen.

Der Token-Nutzungsbalken erscheint erst, wenn die Konversation mindestens einen Austausch enthält.

## Tipps

- **Präfixe für Präzision nutzen**: `@T-`, `@DOC-`, `@PRJ-`, `@REQ-`, `@INC-` sind direkt nativen KANAP-Referenzen zugeordnet. Sie sind der schnellste Weg, Plaid auf einen bestimmten Datensatz zu lenken, und sie überstehen Kopieren und Einfügen, weil sie identisch mit dem aussehen, was Sie an anderer Stelle in der Anwendung sehen.
- **Pro Thema eine neue Konversation beginnen**: Wenn Sie unzusammenhängende Fragen in getrennten Konversationen halten, bleibt das Kontextfenster kleiner, die Antworten kommen schneller und die Token-Kosten sinken. Die Konversationsliste ist nach Datum gruppiert, sodass Sie sie leicht wiederfinden.
- **Bewusst genehmigen und ablehnen**: Vorschauen sind das Einzige, was zwischen Plaid und Ihren Live-Daten steht. Nehmen Sie sich die zusätzliche Sekunde, um die Gegenüberstellung zu lesen, bevor Sie auf **Genehmigen** klicken.
- **Stoppen statt warten**: Wenn Plaid mitten im Stream in die falsche Richtung läuft, drücken Sie die **Stopp**-Schaltfläche, statt auf das Ende zu warten. Sie sparen Tokens, und Ihre Anschlussnachricht kann den Kurs korrigieren.
- **Bilder direkt ablegen**: Einen Screenshot auf das Eingabefeld zu ziehen ist schneller als der Dateiauswahldialog, und das Einfügen aus der Zwischenablage funktioniert ebenfalls. Nutzen Sie das, wenn Sie ein UI-Problem beschreiben oder Plaid bitten, ein Diagramm zu lesen.
