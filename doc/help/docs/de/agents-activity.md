# KI-Agenten: Aktivität

Die Aktivität ist der schreibgeschützte Verlauf all dessen, was Ihre Agenten getan haben, und all dessen, was Sie über ihre Arbeit entschieden haben: die Prüfungen, die sie ausgeführt haben, die Vorschläge, die sie entworfen haben, Ihre Freigaben und Ablehnungen, die Änderungen, die tatsächlich an ein Ticket gesendet wurden, ausgelöste Sicherheitslimits, Pausen, Konfigurationsänderungen und Fehler. Nichts auf dieser Seite ändert ein Ticket oder einen Agenten. Sie existiert, damit Sie im Nachhinein beantworten können, „was passiert ist, wann und warum", und damit Sie einen Nachweis zur Hand haben, wenn ein Anfragender oder ein Techniker nachfragt. Dieselbe Zeitachse erscheint, bereits auf einen Agenten gefiltert, am unteren Rand der [Registerkarte Monitor](agents-workspace.md) dieses Agenten; diese Seite ist die vollständige Version über alle Agenten hinweg.

## Wo Sie es finden

- Arbeitsbereich: **KI-Agenten**
- Pfad: **KI-Agenten → Aktivität**
- Route: `/agents/activity`
- Berechtigung: `ai_agents:reader` (nur Ansicht: jeder, der KI-Agenten öffnen kann, kann die Zeitachse lesen)
- Setzt voraus, dass die KI für die Instanz aktiviert ist. Diese Seite ist schreibgeschützt: Hier wird nichts freigegeben, abgelehnt oder gesendet. Um auf einen Vorschlag zu reagieren, verwenden Sie [Freigaben](agents-approvals.md).

---

## Filter

Die Zeitachse zeigt die neuesten Ereignisse zuerst. Zwei Steuerelemente grenzen sie ein:

- **Ticketnummer**: geben Sie eine Ticketnummer ein und drücken Sie **Suchen** (oder die Eingabetaste), um nur die Ereignisse zu sehen, die mit diesem einen Ticket verknüpft sind. Das ist der schnellste Weg, die vollständige Geschichte eines einzelnen Tickets nachzuvollziehen: jede Prüfung, jeder Entwurf, jede Entscheidung und jede Änderung, der Reihe nach. Leeren Sie das Feld und suchen Sie erneut, um zum vollständigen Feed zurückzukehren.
- **Typ-Chips**: sieben Umschalter am oberen Rand: **Vorschlag**, **Entscheidung**, **Ausführung**, **Konfiguration**, **Prüfungen**, **Pause** und **Fehler**. Jeder ist ein Ein/Aus-Schalter und keine Einzelauswahl: Ein gefüllter Chip ist eingeschlossen, ein umrandeter ausgeschlossen, und Sie können beliebig viele kombinieren.

**Standardmäßig sind alle Kategorien außer Prüfungen eingeschaltet.** Diese Voreinstellung ist Absicht. Ein überwachender Agent schreibt alle paar Minuten einen Prüfungseintrag, ob er etwas gefunden hat oder nicht; eingeschaltet begraben diese Zeilen genau die Einträge, die Sie tatsächlich lesen. Schalten Sie **Prüfungen** ein, wenn Sie sich vergewissern wollen, dass ein Agent lebt, oder wenn Sie untersuchen, warum er etwas aufgegriffen hat, oder eben nicht.

Schalten Sie alle Chips aus, bleibt nichts zu zeigen, und die Zeitachse sagt das auch: *Wählen Sie mindestens eine Aktivitätsart, um den Verlauf zu sehen.*

Die Ticketsuche und die Typ-Chips lassen sich kombinieren, sodass Sie sich zum Beispiel nur die Fehler zu Ticket #482 ansehen können. Ihre Auswahl steht in der Seitenadresse, eine gefilterte Ansicht ist also ein Link, den Sie einer Kollegin schicken können.

---

## Einen Eintrag der Zeitachse lesen

Jeder Eintrag steht für ein einzelnes Ereignis und enthält genug Kontext, um es auf einen Blick zu verstehen:

- Einen **Typ-Chip**: zu welcher der sieben oben genannten Kategorien das Ereignis gehört.
- Einen **Aktionstyp-Chip** (wenn das Ereignis eine bestimmte Art von Ticketarbeit betrifft): **Interne Notiz**, **Antwort an Anfragende**, **Klassifizierung aktualisieren**, **Status aktualisieren**, **Zuweisung** oder **Beobachter**.
- Einen **Statuspunkt** mit einer verständlichen Beschriftung (zum Beispiel „Wartet auf Freigabe", „Fertig", „Abgelehnt", „Verworfen", „Aufmerksamkeit erforderlich"), die beschreibt, wo dieses Element steht.
- Den **Agentennamen** und das betroffene **Ticket** (angezeigt als `#N`).
- Einen **Ereignistitel**: zum Beispiel „Vorschlag erstellt" oder „Ticket-Prüfung: 3 neue Tickets".
- Eine **einzeilige Vorschau** des Inhalts (die erste Zeile einer entworfenen Nachricht, eine Feldänderung oder den Grund), sodass Sie oft nichts erweitern müssen.
- Einen **Zeitstempel** sowie **Details anzeigen** und, wenn eine Prüfung hinter dem Ereignis steht, **Trace**.

Die Titel passen sich der Art des Agenten an: Was bei einem Helpdesk-Agenten **Ticket-Prüfung** heißt, heißt bei einem Überwachungs-Agenten **Alarmprüfung**, sodass eine gemischte Flotte lesbar bleibt.

### Was die Ereignisse bedeuten

Der Katalog deckt den gesamten Lebenszyklus der Agentenarbeit ab. Gruppiert nach dem Typ-Chip, unter den sie fallen:

- **Vorschlag**: der Agent hat etwas zur Prüfung entworfen: eine Antwort, Notiz oder Ticketaktualisierung wurde erstellt und wartet auf eine Entscheidung.
- **Entscheidung**: ein Vorschlag wurde **freigegeben**, **abgelehnt** oder **verworfen** (beiseitegelegt, ohne den Agenten zu belasten), oder ein Eintrag unter „Aufmerksamkeit erforderlich" wurde **zur Kenntnis genommen**. Freigaben und Ablehnungen können auch automatisch erfolgen, sobald dieser Aktionstyp eigenständig läuft; ein Verwerfen und eine Kenntnisnahme sind stets die bewusste Entscheidung einer Person.
- **Ausführung**: eine Änderung wurde tatsächlich an das Ticket gesendet, oder eine Ausführung ist **fehlgeschlagen**. Automatische Ausführungen und ihre Fehler erscheinen ebenfalls hier.
- **Konfiguration**: jemand hat geändert, wie ein Agent läuft: seine **Überwachungseinstellungen** oder die allgemeine **Konfiguration** wurden aktualisiert, ein Aktionstyp wurde auf **automatisch** umgestellt oder **ausgeschaltet** (oder wieder auf Zuerst fragen **zurückgestuft**), oder ein **Agent wurde gelöscht**. Auch das Greifen von Sicherheitslimits (**Tageslimit erreicht** und **Sicherheitslimit pro Ausführung erreicht**) wird hier einsortiert und nicht unter Fehler, denn ein Limit, das seine Arbeit tut, ist ein bewusster Stopp und keine Fehlfunktion.
- **Prüfungen**: der Agent hat nach Arbeit gesucht. Ein Eintrag pro Prüfung, ob er etwas gefunden hat oder nicht. Siehe unten.
- **Pause**: eine **Notfallpause wurde aktiviert** oder **aufgehoben**, oder eine **Ticketüberwachung wurde pausiert**, weil eine Pause in Kraft war.
- **Fehler**: etwas ist schiefgelaufen, das Sie wissen sollten: ein einzelnes **Ticket konnte nicht verarbeitet werden**, ein **Lauf ist fehlgeschlagen**, die **Ticketüberwachung ist fehlgeschlagen**, oder eine automatische Ausführung ist fehlgeschlagen.

Sie müssen sich diese nicht merken: die Ereignistitel sind in verständlicher Sprache verfasst, und mit den Typ-Chips können Sie auf die für Sie relevanten Einträge filtern.

### Prüfungseinträge

Ein Prüfungseintrag sagt Ihnen bereits im Titel, was der Agent gefunden hat, ohne dass Sie etwas erweitern müssen:

- **Ticket-Prüfung: keine neuen Tickets**: er hat nachgesehen, und es gab nichts zu tun. So sieht ein gesunder, ruhiger Agent aus.
- **Ticket-Prüfung: 3 neue Tickets**: drei Tickets wurden zur Bearbeitung aufgegriffen.
- **Ticket-Prüfung: 3 neue Tickets, 2 bereits gesehen, 1 Fehler**: dasselbe, zuzüglich bereits bearbeiteter Tickets und eines aufgetretenen Problems.
- **Ticket-Prüfung: Überwachung aus** / **Pausiert** / **Übersprungen** / **Fehlgeschlagen**: die Prüfung hat ihre normale Arbeit nicht verrichtet, und der Grund folgt, sofern es einen gibt.

**Details anzeigen** schlüsselt dieselbe Prüfung in vier Zahlen auf (**Gesehen**, **Eingereiht**, **Bereits gesehen**, **Bearbeitet**), zuzüglich des Grundes und etwaiger Fehlermeldungen. Das ist der ehrliche Weg, die Frage „Warum hat der Agent Ticket #482 nicht aufgegriffen?" zu beantworten: Ist **Gesehen** hoch, aber **Eingereiht** null, wurde das Ticket angesehen und von Ihrer Zielauswahl herausgefiltert; ist **Gesehen** null, hat der Agent es überhaupt nie gesehen.

---

## Details anzeigen

**Details anzeigen** erweitert einen Eintrag um alle zugrunde liegenden Belege. Je nach Ereignis sehen Sie möglicherweise:

- Die oben beschriebene **Aufschlüsselung der Prüfung**.
- Die vollständige **Vorgeschlagene Nachricht**: der gesamte vom Agenten entworfene Text, nicht nur die einzeilige Vorschau.
- **Feldänderungen**, geschrieben als „Feld: von → nach" (zum Beispiel „Status: Zugewiesen → Ausstehend"), sodass eine Änderung an Klassifizierung, Status, Zuweisung oder Beobachtern lesbar ist, ohne das Ticket zu öffnen.
- Den **Grund**: die kurze Begründung des Agenten für den Vorschlag.
- Die **Anmerkung des Prüfers**: die Notiz, die erfasst wurde, als über den Vorschlag entschieden wurde.
- Eine Zeile **„{n} Quellen zitiert"**: wie viele Ergebnisse aus Ihrer [Wissensbibliothek](knowledge.md) die entworfene Antwort gestützt haben. Das ist das ehrliche Signal dafür, ob die Antwort auf Ihren eigenen Quellen beruht; eine Antwort mit zitierten Quellen ist eine, hinter der der Agent stehen kann. Ihr Fehlen bei einer administrativen oder verfahrenstechnischen Antwort ist normal und bedeutet nicht, dass etwas fehlgeschlagen ist. Wie sich das bei der Prüfung auswirkt, erfahren Sie unter [Freigaben](agents-approvals.md).

---

## Mehr laden

Die Zeitachse lädt die 50 neuesten passenden Einträge und sagt Ihnen, wo Sie stehen: **{n} von {total} angezeigt**. **Mehr laden** hängt die nächsten 50 an, ohne das zu stören, was Sie bereits gelesen haben, oder die Filter, die Sie gesetzt haben. Es gibt keine Seitenzahl, bei der Sie den Faden verlieren könnten: drücken Sie weiter, bis Sie gefunden haben, wonach Sie suchen.

Der Zähler ist für sich genommen lesenswert. „50 von 1.284 angezeigt" ist ein Signal, dass Sie die Filter besser eingrenzen sollten, statt weiterzuklicken.

Einträge bleiben nicht für immer. Jeder Agent behält seinen eigenen Verlauf so lange, wie es seine Einstellung **Aktivitätsverlauf aufbewahren (Tage)** vorgibt: standardmäßig 30 Tage; alles Ältere wird über Nacht automatisch gelöscht. Wenn Sie einen Nachweis darüber hinaus benötigen, sichern Sie ihn, solange er hier ist. Arbeit, über die Sie noch entscheiden müssen, wird nie gelöscht.

---

## Technischer Trace

Die Schaltfläche **Trace** öffnet den Dialog **Technischer Trace** über der Seite: es wird nichts weggeblättert, sodass Sie nach dem Schließen genau dort weitermachen, wo Sie waren. Das ist eine optionale Diagnoseansicht für Administratoren, die eine bestimmte Prüfung untersuchen. Für die tägliche Durchsicht benötigen Sie sie nie, und alles, was ein Anfragender oder Techniker wissen möchte, steht bereits unter **Details anzeigen**.

Sie rekonstruiert, wie eine einzelne Prüfung abgelaufen ist:

- Wann der Lauf **gestartet** und **beendet** wurde und wie lange er insgesamt **gedauert** hat.
- Die nummerierten **Schritte**, die der Agent durchlaufen hat, jeweils mit eigenem Status und eigener Dauer.
- Die **Tool-Aufrufe**, die er gemacht hat, mit der jeweiligen Dauer: nützlich, wenn eine Prüfung langsam war oder das Zeitlimit überschritten hat.
- Die **Quellen**, die er gesammelt hat, angezeigt als kurze Zusammenfassung plus die Art der Quelle, aus der sie stammen.

Genau diese Zeiten sind der Sinn des Dialogs: Eine Prüfung, die vier Minuten gedauert hat, enthält einen langsamen Schritt, und hier finden Sie ihn.

Ein Umschalter **Rohdaten-Trace anzeigen** zeigt den zugrunde liegenden maschinenlesbaren Datensatz für die seltenen Fälle, in denen Sie das genaue Detail benötigen; lassen Sie ihn ansonsten eingeklappt.

Dieselbe Schaltfläche **Trace** erscheint unter [Freigaben](agents-approvals.md) und auf der Registerkarte **Monitor** eines Agenten und öffnet dort denselben Dialog an Ort und Stelle: das ist der übliche Weg, während der Durchsicht hierher zu gelangen.

---

## Tipps

- Die Suche nach **Ticketnummer** ist der schnellste Weg, jemandem die vollständige, geordnete Geschichte eines Tickets zu übergeben (Prüfung, Vorschlag, Entscheidung und was gesendet wurde), ohne sich durch das Ticket selbst klicken zu müssen.
- **Schalten Sie „Prüfungen" ein, wenn ein Agent untätig wirkt, und danach wieder aus.** Das ist der Unterschied zwischen „der Agent ist kaputt" und „der Agent überwacht, und es gibt nichts zu tun", aber es ist laut, und genau deshalb ist es standardmäßig aus.
- Greifen Sie zum Filter **Ausführung**, um nur das zu sehen, was das System tatsächlich verlassen hat. Vorschläge und Entscheidungen sind Absichten; Ausführungen sind die Änderungen, die ein Anfragender oder Techniker sehen kann.
- Ein Eintrag **Tageslimit erreicht** ist das System, das wie vorgesehen arbeitet, kein Fehler. Wenn ein Agent für den Rest eines Tages verstummt, ist das meist der Grund: erhöhen Sie seine Tageslimits in den [Einstellungen](agents-workspace.md) des Agenten, wenn das Limit für Ihr Volumen zu eng ist, und sehen Sie sich dort die **Heute**-Werte an, bevor Sie eine neue Zahl wählen.
- Verwenden Sie **Trace** nur, wenn Sie einer langsamen oder fehlgeschlagenen Prüfung nachgehen; für „Was hat er gesagt und warum haben wir freigegeben?" hat **Details anzeigen** die Antwort bereits.
- Diese Seite ändert nie etwas, daher ist es unbedenklich, schreibgeschützten Zugriff (`ai_agents:reader`) an alle zu vergeben, die das Agentenverhalten prüfen müssen, ohne darauf reagieren zu können.
