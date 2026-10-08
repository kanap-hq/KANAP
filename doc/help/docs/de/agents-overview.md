# KI-Agenten — Übersicht

KI-Agenten sind automatisierte Helfer, die Ihren verbundenen Service-Desk überwachen und den ersten Durchgang bei Tickets für Sie übernehmen: Sie entwerfen eine Antwort an den Anfragenden, fügen eine interne Notiz hinzu oder schlagen eine Aktualisierung der Klassifizierung, des Status, der Zuweisung, der Beteiligten oder ein Schließen/Lösen eines Tickets vor. Diese Seite ist das Flotten-Dashboard – der eine Ort, an dem Sie jeden Agenten auf einen Blick sehen: wie viel Arbeit auf Ihre Entscheidung wartet, wie die Flotte abschneidet, was sie Sie kostet und wo Sie die Notbremse ziehen, wenn etwas nicht stimmt.

Der wichtigste Gedanke, den Sie sich merken sollten: Ein Agent schlägt vor, Sie entscheiden. Alles, was ein Agent an einen Anfragenden senden oder in ein Ticket zurückschreiben möchte, wird zunächst zu Ihrer Freigabe vorgeschlagen, und feste Sicherheitslimits, Budgets, Aktualitätsprüfungen und Pausen gelten immer – selbst nachdem Sie einem Agenten erlaubt haben, eigenständig zu handeln. Die alltägliche Konfiguration eines einzelnen Agenten befindet sich in seinem [Agent-Arbeitsbereich](agents-workspace.md); auf dieser Seite überwachen Sie die gesamte Flotte.

## Wo Sie es finden

- Arbeitsbereich: **KI-Agenten**
- Pfad: **KI-Agenten → Übersicht**
- Route: `/agents`
- Berechtigung: `ai_agents:reader`, um den Bereich anzuzeigen, `ai_agents:contributor`, um auf die Arbeit eines Agenten zu reagieren. Die unten beschriebenen Bedienelemente zum Erstellen, für die Notfallpause und zum Löschen erfordern die Administratorstufe für KI-Agenten (`ai_agents:admin`); der Administrator für KI-Einstellungen (`ai_settings:admin`) schaltet sie ebenfalls frei.
- Feature-Flag: Der gesamte Bereich KI-Agenten setzt voraus, dass KI auf der Instanz aktiviert ist. Wenn KI deaktiviert ist, ist der Bereich nicht verfügbar.

---

## Konzepte in einer Minute

Einige Konzepte tauchen auf jeder Seite in diesem Bereich wieder auf. Lernen Sie sie hier einmal kennen.

- **Was ein Agent überwacht.** Jeder Agent ist auf Ihr verbundenes Ticketsystem ausgerichtet (heute ist das GLPI, eingerichtet unter **Administration → Integrationen** – siehe [die GLPI-Verbindung](integrations.md)). In den Agentenbildschirmen wird es allgemein als das verbundene Ticketsystem oder die Verbindung bezeichnet. Ein Überwachungs-Agent beobachtet stattdessen ein verbundenes Überwachungstool und dessen Alarme.
- **Worauf ein Agent einwirkt.** Tickets. Die Arbeit, die ein Agent vorschlagen kann, umfasst eine Antwort an den Anfragenden, eine interne Notiz, eine Änderung der Klassifizierung, eine Statusänderung (einschließlich Schließen/Lösen), eine Änderung der Zuweisung sowie das Hinzufügen oder Entfernen von Beteiligten.
- **Zuerst fragen vs. automatisch.** Jeder Aktionstyp beginnt mit **Zuerst fragen** – der Agent entwirft die Änderung, und sie verbleibt in Ihrer Freigabe-Warteschlange, bis Sie sie freigeben, ablehnen oder verwerfen. Sobald ein Agent bei einem bestimmten Aktionstyp genügend Erfahrung gesammelt hat, kann ein Administrator genau diesen Aktionstyp auf **Automatisch** hochstufen, sodass er ohne Wartezeit angewendet wird. Die Hochstufung erfolgt pro Aktionstyp, und die untenstehenden Sicherheitslimits gelten immer weiter.
- **Betriebsmodi.** Jeder Agent befindet sich in einem von drei Modi, die Sie in der Steuerleiste seines [Arbeitsbereichs](agents-workspace.md) setzen: **Aus** (es läuft überhaupt nichts), **Nur manuell** (er läuft nur, wenn jemand ihn darum bittet – eine von Ihnen ausgelöste Prüfung oder ein Test an einem einzelnen Ticket) und **Beobachtung** (er prüft selbstständig in der von Ihnen festgelegten Frequenz, zusätzlich zu allem, was der manuelle Modus kann). Neue Agenten starten immer als „Nicht gestartet", und **Nur manuell** ist der Modus, in dem Sie bleiben sollten, solange Sie einen Agenten abstimmen.
- **Sicherheit gilt immer.** Limits pro Prüfung, Budgets pro Lauf und pro Tag, Aktualitätsprüfungen (was zu tun ist, wenn sich das Ticket geändert hat, nachdem der Agent seine Arbeit entworfen hat) und Pausen gelten unabhängig davon, ob ein Aktionstyp auf „Zuerst fragen" oder „Automatisch" steht. Sie können jederzeit alles stoppen – siehe [Notfallpause](#notfallpause) unten.

Zwei Agententypen sind heute durchgängig einsatzbereit: der **Helpdesk**-Agent, den der Rest dieses Bereichs beschreibt, und der Agent für **Infrastruktur-Überwachung (SRE)**, der Alarme aus einem verbundenen Überwachungstool liest und Diagnosenotizen zur Prüfung vorbereitet. Andere Typen erscheinen möglicherweise in der Liste der Agententypen, sind aber nicht startbereit.

Zwei weitere KI-Oberflächen lassen sich leicht mit Agenten verwechseln, sind aber eigenständige Dinge: [Plaid](ai-assistant.md) ist der interaktive Chat-Assistent, den Sie selbst steuern, und in den [Plaid-Einstellungen](ai-settings.md) wird eben dieser Assistent konfiguriert. Die Modelle selbst liegen auf der Seite [KI-Modelle](ai-models.md); dort wird das Modell jedes Agenten festgelegt – ebenso wie der Standard der Organisation, auf den er zurückfällt.

---

## Das Flotten-Dashboard

!!! note "Agenten warten auf eine Bestätigung"
    Im gehosteten Dienst läuft ein Agent ohne eigenes Modell auf dem inklusiven KANAP-Modell, sobald ein Administrator dessen Anbieter bestätigt hat. Bis dahin steht oben auf der Seite ein Banner: *Agenten, die das inklusive KANAP-Modell verwenden, sind pausiert, bis ein Administrator es unter Administration > Plaid bestätigt.* Administratoren finden darauf die Schaltfläche **Plaid-Einstellungen öffnen**. Agenten, die an ein von Ihnen angelegtes Modell gebunden sind, arbeiten weiter. Siehe [Das inklusive KANAP-Modell bestätigen](ai-settings.md#das-inklusive-kanap-modell-bestatigen).

Fünf gebündelte Kennzahlen stehen ganz oben. Sie beschreiben die gesamte Flotte, nicht einen einzelnen Agenten:

- **Offene Freigaben** – wie viele Vorschläge in der gesamten Flotte gerade auf eine menschliche Entscheidung warten. Dies ist dieselbe Zahl, die das Abzeichen in der Seitenleiste steuert.
- **Aktionen heute** – wie viele Vorschläge heute tatsächlich ausgeführt wurden (freigegeben und angewendet oder automatisch angewendet).
- **Annahme** – der Anteil der entschiedenen Vorschläge, die freigegeben statt abgelehnt wurden. Zeigt **Nicht genug Daten** an, bis genügend Entscheidungsverlauf vorliegt, um aussagekräftig zu sein.
- **Verworfen** – der Anteil der von einem Menschen geprüften Vorschläge, die beiseitegelegt statt freigegeben oder abgelehnt wurden. Ein Verwerfen belastet den Agenten nicht; ein dauerhaft hoher Wert deutet daher meist auf ein Zielauswahl-Problem hin – der Agent greift Tickets auf, die er nicht bearbeiten sollte – und nicht auf schlechte Antwortqualität; beheben Sie es in der Zielauswahl des Agenten. Zeigt ebenfalls **Nicht genug Daten** an, bis genügend Prüfverlauf vorliegt.
- **Kosten — heute / 7 Tage** – was Ihre Agenten tatsächlich an KI-Ausgaben verursachen, in EUR: die heutige Summe und die vergangenen sieben Tage (heute eingeschlossen). Das umfasst **jeden** Agenten im Mandanten, Desk- wie Überwachungs-Agenten, und ist damit die Zahl, die Sie ansehen, wenn Sie wissen wollen, was die Flotte Sie kostet – Punkt. Die Wirtschaftlichkeit einzelner Agenten – Kosten pro Ticket, Limits pro Lauf und pro Tag – finden Sie auf den Registerkarten **Leistung und Autonomie** und **Einstellungen** des jeweiligen Agenten.

Betrachten Sie diese als Gesundheitszustand der Flotte, nicht als Abrechnung pro Agent. Für die Zahlen eines einzelnen Agenten öffnen Sie dessen Arbeitsbereich und verwenden die Registerkarte **Leistung und Autonomie**.

---

## Die Flottenkarten

Unterhalb des Dashboards zeigt der Bereich **Agentenflotte** eine Karte pro Agent. Jede Karte enthält den **Namen** und die **Beschreibung** des Agenten (oder **Keine Beschreibung.**, wenn keine festgelegt wurde), seinen Status, eine Reihe von Chips und – bei einem Desk-Agenten – einen Streifen mit Live-Kennzahlen.

**Der Status** (oben rechts auf der Karte) zeigt Ihnen als farbigen Punkt mit Beschriftung, was der Agent gerade tut. Die Farbe ist der schnelle Blick: Grün bedeutet, der Agent arbeitet; Blau, dass er nur auf Anfrage läuft; Rot, dass er angehalten ist; Grau, dass er überhaupt nicht läuft.

| Status | Farbe | Was er bedeutet |
| --- | --- | --- |
| **Überwachung — mit Rückfrage** | Grün | Überwacht eigenständig, aber jeder Aktionstyp wird weiterhin zu Ihrer Freigabe geleitet. |
| **Überwachung — teilweise automatisch** | Grün | Überwacht, wobei mindestens ein Aktionstyp so hochgestuft wurde, dass er ohne Freigabe läuft. Der Rest fragt weiterhin zuerst. |
| **Test** | Blau | Eingeschaltet, aber nicht überwachend – der Modus **Nur manuell**. Er läuft, wenn Sie ihn von Hand prüfen oder testen, nie von selbst. |
| **Pausiert** | Rot | Durch eine Notfallpause angehalten (mandantenweit oder nur für diesen Agenten). Prüfungen und ausstehende Schreibvorgänge sind eingefroren, bis die Pause aufgehoben wird. |
| **Nicht gestartet** | Grau | Erstellt, aber noch nie ausgeführt. Hier beginnt jeder neue Agent. |
| **Aus** | Grau | Es läuft nichts, auch keine manuelle Prüfung. |
| **Archiviert** | Grau | Aus dem aktiven Einsatz genommen, Konfiguration und Verlauf bleiben erhalten. |

**Die Chips** fassen den Agenten auf einen Blick zusammen:

- **Typ** – der Agententyp, z. B. **Helpdesk** oder **SRE**.
- **Umgebung** – auf welche Verbindungsumgebung er zeigt: **Produktion**, **Staging**, **Sandbox**, **Labor** oder **Mock**. Dies ist Ihr Hinweis darauf, ob der Agent echte Tickets berührt.
- **N offen** – Vorschläge dieses Agenten, die auf Ihre Entscheidung warten (hervorgehoben, wenn größer als null).
- **N fehlgeschlagen** – Arbeit dieses Agenten, die ins Stocken geraten ist und geprüft werden muss (hervorgehoben, wenn größer als null). Diese erscheinen als **Aufmerksamkeit erforderlich** in der täglichen Warteschlange.
- **N automatisch** oder **Zuerst fragen** – entweder die Anzahl der auf automatisch hochgestuften Aktionstypen oder **Zuerst fragen**, wenn nichts hochgestuft wurde.

**Bei einem Desk-Agenten** erscheinen vier Kennzahlen auf der Karte:

- **Letzte Prüfung** – das Ergebnis der jüngsten Prüfung.
- **Bereich** – **Alle Tickets** oder **Gefilterte Tickets**, je nachdem, ob die Zielauswahl des Agenten eingrenzt, worauf er schaut.
- **Läufe heute** – wie oft er heute bisher gelaufen ist.
- **Aktualisiert** – der Zeitpunkt seiner letzten Prüfung.

Ein Klick an eine beliebige Stelle auf einer Karte öffnet den [Arbeitsbereich](agents-workspace.md) des Agenten, wo Sie ihn steuern, überwachen, seine Freigaben prüfen, seine Leistung einsehen und seine Einstellungen ändern.

Administratoren sehen außerdem ein kleines Papierkorbsymbol auf jeder Karte – es löscht den Agenten samt seiner Warteschlange und seinem Überwachungsverlauf (die Tickets in Ihrem Ticketsystem werden dabei nie berührt, und dies kann nicht rückgängig gemacht werden).

---

## Einen Agenten erstellen

Administratoren erhalten oben rechts auf der Seite eine Schaltfläche **Neuer Agent**. Sie öffnet einen Dialog:

- **Agententyp** – **Helpdesk** oder **Infrastruktur-Überwachung (SRE)**. Name und Beschreibung sind mit sinnvollen Standardwerten vorbelegt, die ausgetauscht werden, wenn Sie den Typ wechseln und sie nicht selbst bearbeitet haben.
- **Name** und **Beschreibung**.
- **Verbindung** – das Ticketsystem (**GLPI**) bei einem Helpdesk-Agenten oder das **Überwachungstool** bei einem SRE-Agenten. **Integrationen verwalten** springt zu **Administration → Integrationen**, falls die Verbindung noch nicht eingerichtet ist. Ist kein Überwachungstool verbunden, wird der Agent dennoch erstellt – er bleibt lediglich inaktiv, bis eines verbunden ist.

Überwachung, Zielauswahl und Limits werden hier nicht erfasst. **Erstellen** öffnet die Registerkarte **Einstellungen** des neuen Agenten in seinem [Arbeitsbereich](agents-workspace.md), wo Sie diese Einrichtung abschließen. Der Agent wird immer als **Nicht gestartet** erstellt – es läuft nichts, bevor Sie seinen Ausführungsmodus gesetzt haben. Der empfohlene Weg ist, die Einstellungen abzuschließen, den Agenten auf **Nur manuell** zu stellen und ihn an echten Tickets (oder Alarmen) zu testen und ihn erst dann auf **Beobachtung** zu setzen, wenn Sie seiner Ausgabe vertrauen.

---

## Notfallpause

Wenn auf breiter Front etwas nicht stimmt – unerwartete Antworten gehen hinaus, eine Fehlkonfiguration, ein Vorfall –, können Administratoren mit **Alle Agenten pausieren** in der Kopfzeile des Bereichs **Agentenflotte** alles auf einmal einfrieren. Sie werden nach einem Grund gefragt (der Teil des Audit-Protokolls wird), und ein dauerhaftes Banner zeigt daraufhin im gesamten Bereich **Notfallpause aktiv: {reason}** an. Solange sie aktiv ist, werden die Prüfungen jedes Agenten und alle ausstehenden Schreibvorgänge für den gesamten Mandanten angehalten. Klicken Sie im Banner auf **Pause aufheben**, um fortzufahren.

Diese mandantenweite Bremse ist bewusst grob. Um einen einzelnen Agenten, der sich falsch verhält, einzufrieren, ohne den Rest der Flotte anzutasten, verwenden Sie stattdessen **Agent pausieren** in der Steuerleiste im Arbeitsbereich dieses Agenten – siehe den [Agent-Arbeitsbereich](agents-workspace.md). Und denken Sie an den Unterschied zwischen Pausieren und Ausschalten: **Aus** legt einen Agenten schlicht still, während eine Pause zusätzlich die bereits laufende Arbeit einfriert und festhält, warum.

---

## Die Flotte im Alltag betreuen

Auf der Übersicht führen Sie die Aufsicht; die eigentliche tägliche Arbeit findet auf zwei dedizierten Seiten statt:

- [Freigaben](agents-approvals.md) ist die Prüf-Warteschlange – vorgeschlagene Antworten, Notizen und Ticketänderungen, die auf Ihre Entscheidung warten, gruppiert nach Ticket.
- [Aktivität](agents-activity.md) ist die schreibgeschützte Audit-Zeitachse jeder Prüfung, jedes Vorschlags, jeder Entscheidung, Ausführung, Pause und jedes Fehlers.

Wiederverwendbare Hintergrundhinweise, die mehrere Agenten gemeinsam nutzen sollen, befinden sich auf der Seite [Gemeinsamer Kontext](agents-shared-context.md). Beachten Sie, dass der gemeinsame Kontext beeinflusst, wie Agenten Tickets interpretieren, aber niemals in einer Antwort als Quelle angegeben wird – die Quellen, die ein Agent tatsächlich zitiert, stammen aus Ihren [Wissensbibliotheken](knowledge.md).

---

## Tipps

- **Lesen Sie den Umgebungs-Chip, bevor Sie einer Zahl vertrauen.** Ein Agent in **Produktion** berührt echte Tickets und echte Anfragende; **Sandbox**, **Labor** und **Mock** eignen sich gefahrlos zum Experimentieren. Wenn Sie einen neuen Agenten in Betrieb nehmen, halten Sie ihn von Produktionstickets fern, bis seine Ausgabe stimmt.
- **Die Kostenkachel ist die ehrliche Rechnung der Flotte.** Sie umfasst jeden Agenten, den Sie betreiben. Steigt sie schneller als erwartet, liegt es meist an einem Agenten, der weit häufiger prüft, als seine Warteschlange es rechtfertigt – schauen Sie zuerst auf **Prüfen alle (Minuten)**, bevor Sie irgendetwas anderes ansehen.
- **Eine steigende Zahl fehlgeschlagener Einträge ist Ihr Frühwarnsignal.** Der Chip **N fehlgeschlagen** zeigt Arbeit, die ins Stocken geraten ist. Öffnen Sie den Agenten und arbeiten Sie die Einträge unter **Aufmerksamkeit erforderlich** ab, bevor sie sich anhäufen – sie weisen meist auf ein Verbindungsproblem oder ein Ticket hin, das sich unter dem Agenten geändert hat.
- **Nur manuell vor Beobachtung.** Ein über **Neuer Agent** erstellter Agent ist absichtlich **Nicht gestartet**. Lassen Sie ihn zuerst von Hand an einigen repräsentativen Tickets aus seinem Arbeitsbereich laufen; setzen Sie ihn erst dann auf **Beobachtung**, wenn Sie mit dem, was er entwirft, zufrieden sind.
- **Automatik wird verdient und ist umkehrbar.** Einen Aktionstyp auf automatisch hochzustufen entfernt keine Schutzvorkehrung – die Budgets pro Tag und pro Lauf, die Aktualitätsprüfungen und die Pausen gelten weiterhin, ein Aktionstyp mit einer schlechten Stunde wartet auf Ihre Freigabe, und ein Typ, dessen Annahme unter die Hälfte fällt, wird wieder auf „Zuerst fragen" zurückgestuft (siehe [Die Autonomie-Stufen](agents-workspace.md#die-autonomie-stufen)). Bei den Aktionstypen, die der Anfragende sehen kann, kommt zusätzlich eine ausdrückliche Bestätigung hinzu.
- **Bevorzugen Sie die Pause pro Agent.** Greifen Sie nur bei einem echten flottenweiten Problem zu **Alle Agenten pausieren**. Bei einem einzelnen lauten Agenten hält die Pause in seinem eigenen Arbeitsbereich den Rest Ihrer Flotte am Laufen.
