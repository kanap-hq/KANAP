# KI-Agenten: Freigaben

Freigaben ist die tägliche Prüf-Warteschlange für alles, was Ihre KI-Agenten vorhaben. Bevor ein Agent eine Antwort veröffentlicht, eine Notiz hinzufügt, ein Ticket neu klassifiziert, dessen Status ändert, es neu zuweist oder schließt, legt er Ihnen diese Arbeit hier als **Vorschlag** vor. Auf Seiten des Anfragenden ist auf dieser Seite noch nichts geschehen: Ein Vorschlag ist die Empfehlung des Agenten, und er erreicht Ihr verbundenes Ticketsystem erst, sobald Sie ihn freigeben. Hier verbringt ein Operator die meiste Zeit mit der Beaufsichtigung eines Helpdesk-Agenten, indem er jeden Entwurf liest und entscheidet, was damit geschehen soll: die guten anwenden, die falschen ablehnen und die zutreffenden, aber nicht zu versendenden beiseitelegen.

## Wo Sie es finden

- Arbeitsbereich: **KI-Agenten**
- Pfad: **KI-Agenten → Freigaben**
- Route: `/agents/approvals`
- Berechtigung: Erfordert, dass KI für die Instanz aktiviert ist, sowie die Rolle KI-Agenten-Leser (`ai_agents:reader`), um die Warteschlange zu lesen. Über einen Vorschlag zu entscheiden, eine Zeile zur Kenntnis zu nehmen und eine Analyse erneut zu starten setzt die Stufe Mitwirkender (`ai_agents:contributor`) voraus.
- Dieselbe Warteschlange erscheint, auf einen einzelnen Agenten beschränkt, auf dem Tab **Freigaben** im [Arbeitsbereich](agents-workspace.md) dieses Agenten. Die Seite unter `/agents/approvals` ist die kombinierte Ansicht über alle Agenten hinweg; der Tab im Arbeitsbereich zeigt nur die Vorschläge des Agenten, den Sie gerade betrachten. Layout und Bedienelemente sind identisch.

---

## Was ein Vorschlag ist

Jeder Vorschlag ist eine konkrete Aktion, die ein Agent an einem Ticket ausführen möchte. Es gibt acht Aktionstypen, jeder mit eigenem Label und Symbol:

| Aktion | Was sie bewirkt |
| --- | --- |
| **Antwort an Anfragende** | Eine Nachricht, die der Agent an die Person senden möchte, die das Ticket eröffnet hat. |
| **Interne Notiz** | Eine Notiz, die der Agent für Ihr Team hinzufügen möchte, für den Anfragenden nicht sichtbar. |
| **Klassifizierung** | Ändert Kategorie, Typ, Priorität oder Dringlichkeit des Tickets gemäß den Anweisungen. Ein Vorschlag kann mehrere Felder enthalten und zeigt die aktuellen sowie die vorgeschlagenen Werte mit den Kategorienamen. |
| **Status** | Ein Wechsel zu einem anderen Ticketstatus (zum Beispiel von **Neu** zu **Ausstehend**). |
| **Ticket schließen** | Schließt das Ticket. Siehe [Tickets schließen und lösen](#tickets-schlieen-und-losen). |
| **Ticket lösen** | Markiert das Ticket als gelöst. Siehe [Tickets schließen und lösen](#tickets-schlieen-und-losen). |
| **Zuweisung** | Fügt dem Ticket eine Technikergruppe **oder** einen namentlich genannten Techniker hinzu, gemäß der in den Anweisungen des Agenten hinterlegten Weiterleitungsregel. Niemand, der bereits auf dem Ticket steht, wird entfernt. Der Vorschlag zeigt, wer hinzugefügt wird und wer aktuell zugewiesen ist. |
| **Beobachter** | Fügt einen Techniker oder eine zuweisbare Gruppe als Beobachter hinzu. Der Anfragende bleibt unverändert, und die Personen, die das Ticket bereits verfolgen, bleiben. |

Bei einer **Antwort an Anfragende** oder einer **Interne Notiz** ist der angezeigte Textkörper die vollständige entworfene Nachricht, genau so, wie sie veröffentlicht würde. Lesen Sie sie so, wie der Anfragende (oder Ihr Team) sie lesen würde. Bei den anderen fünf Typen ist der Textkörper eine kurze Änderungszusammenfassung statt Freitext (zum Beispiel `Status: New -> Pending`, `Assignee: Unassigned -> Jane` oder ein feldweiser Klassifizierungs-Diff), oft gefolgt von einer **Grund**-Zeile, die erläutert, warum der Agent sie vorschlägt.

Vorschläge sind nach Ticket gruppiert. Jede Gruppe wird angeführt vom Ticket (**Ticket #N**), seinem aktuellen Status, einer Anzahl wie **3 Vorschläge** und dem Zeitpunkt der letzten Aktualisierung. Ein Ticket kann mehrere Vorschläge gleichzeitig enthalten (etwa eine Antwort, eine Neuklassifizierung und eine Statusänderung) und Sie können sie einzeln oder alle zusammen entscheiden.

---

## Die vier Abschnitte

Die Warteschlange ist in vier Abschnitte gegliedert, je nachdem, wo sich ein Element in seinem Lebenszyklus befindet.

### Benötigt Ihre Entscheidung

Die Vorschläge, die auf Sie warten, nach Ticket gruppiert. In diesem Abschnitt findet der Großteil Ihrer Arbeit statt; **In Bearbeitung** und **Kürzlich abgeschlossen** sind rein informativ. Wenn er leer ist, steht dort *Nichts benötigt Ihre Entscheidung.* Sobald Sie einen Vorschlag entscheiden, wird er innerhalb seiner Ticketgruppe auf eine einzelne Statuszeile reduziert, während die übrigen Vorschläge des Tickets für Sie offen bleiben.

### In Bearbeitung

Arbeit, die bereits läuft und nichts von Ihnen benötigt: Vorschläge, die Sie freigegeben haben und die nun auf das verbundene Ticketsystem angewendet werden, sowie Tickets, die ein Agent gerade prüft. Zeilen zeigen hier einen Live-Status wie **Wartet auf Start**, **Läuft**, **Wird ausgeführt…** oder **Agent arbeitet…**. Wenn nichts läuft, wird der Abschnitt gar nicht erst angezeigt: eine leere Liste „in Bearbeitung" sagt Ihnen nichts, was Sie nicht schon am Status des Agenten selbst ablesen können.

### Aufmerksamkeit erforderlich

Alles, was fehlgeschlagen ist oder blockiert wird: ein Vorschlag, der nicht an das verbundene Ticketsystem gesendet werden konnte, oder eine Prüfung, die mit einem Fehler abgebrochen ist. Jede Zeile trägt eine rote Bildunterschrift, die erklärt, was schiefgelaufen ist, sowie eine Schaltfläche **Trace**, die den vollständigen Verlauf öffnet, ohne dass Sie die Seite verlassen. Wenn er leer ist, steht dort *Keine Agentenarbeit benötigt Aufmerksamkeit.*

Das ist der Abschnitt, den Sie im Auge behalten sollten, und er ist keine Sackgasse mehr: siehe [Eine Zeile unter Aufmerksamkeit erforderlich abarbeiten](#eine-zeile-unter-aufmerksamkeit-erforderlich-abarbeiten) weiter unten.

### Kürzlich abgeschlossen

Ein einklappbarer Verlauf der zuletzt abgeschlossenen Elemente: angewendet, abgelehnt, verworfen, übersprungen oder fertig. Er bleibt eingeklappt, bis Sie ihn öffnen, merkt sich diese Wahl und zeigt bis zu 30 Zeilen mit einer Zeile **+N weitere**, die Ihnen sagt, wie viele ältere Elemente es gibt. Nutzen Sie ihn, um zu bestätigen, dass eine Freigabe tatsächlich durchgelaufen ist, oder um zu prüfen, was ein Agent getan hat, während Sie abwesend waren. Zeilen, die Sie unter **Aufmerksamkeit erforderlich** zur Kenntnis genommen haben, landen ebenfalls hier.

---

## Eine Entscheidung treffen: Freigeben, Ablehnen und Verwerfen

Jeder offene Vorschlag bietet drei Aktionen.

- **Freigeben** heißt **Freigeben** bei einem Vorschlag, den Sie noch nicht entschieden haben, und **Ausführen** bei einem, den Sie bereits freigegeben haben, der aber noch nicht ausgeführt wurde. In beiden Fällen bewirkt es dasselbe: Es sendet die Aktion an Ihr verbundenes Ticketsystem, wo der Agent die Antwort oder Notiz veröffentlicht oder die Änderung anwendet. Die Freigabe ist der Moment, in dem der Anfragende (oder Ihr Team) betroffen sein kann. Bis dahin hat nichts KANAP verlassen.
- **Ablehnen** wendet die Aktion nicht an. Der Vorschlag wird fallengelassen, bleibt aber im Audit-Trail erhalten, sodass es stets einen Nachweis darüber gibt, was der Agent vorgeschlagen und dass Sie es abgelehnt haben. Das Ablehnen eines einzelnen Vorschlags wird sofort wirksam. Ablehnen ist ein Qualitätssignal: Es belastet die Bewertung des Agenten und seine Annahmequote, weil es dem Agenten mitteilt, dass der Vorschlag falsch war.
- **Verwerfen** legt den Vorschlag ebenfalls beiseite, ohne etwas zu senden, belastet aber, anders als das Ablehnen, den Agenten **nicht**. Die Annahmequote und die Autonomie-Bilanz des Agenten bleiben unberührt. Verwenden Sie es, wenn der Vorschlag zutreffend ist, aber schlicht nicht hinausgehen soll: ein sensibles Ticket, ein Kollege, der bereits geantwortet hat, ein Duplikat. Es ist ein einziger Klick ohne Grundabfrage, und sein Tooltip lautet *Beiseitelegen, ohne die Bewertung des Agenten zu belasten*. Ein verworfener Vorschlag kann nicht mehr freigegeben werden.

Wenn ein Vorschlag derzeit **blockiert** ist (etwa weil eine Aktualitäts- oder Sicherheitsprüfung nicht mehr zutrifft oder das Ticketsystem die Änderung im Moment nicht akzeptiert), ist seine primäre Schaltfläche deaktiviert und der Grund erscheint im Tooltip der Schaltfläche. Der Vorschlag bleibt sichtbar, damit Sie sehen können, warum er nicht fortgesetzt werden kann.

**Alle freigeben**, **Alle ablehnen** und **Alle verwerfen** erscheinen bei einer Ticketgruppe, wenn mehr als ein Element zu bearbeiten ist, sodass Sie ein ganzes Ticket in einem Schritt erledigen können. **Alle freigeben** ist die farbige, primäre Schaltfläche der Gruppe: ein Ticket mit einer einzigen Entscheidung zu erledigen ist der vorgesehene Rhythmus dieser Seite, und die Schaltflächen der einzelnen Vorschläge sind bewusst zurückhaltender gestaltet, damit das Auge zuerst auf der Gruppe landet. **Alle ablehnen** öffnet einen kurzen Dialog, der bestätigt, wie viele Vorschläge abgelehnt werden, und eine optionale Notiz für den Audit-Trail anbietet; **Alle verwerfen** öffnet einen kurzen Bestätigungsdialog, der angibt, dass nichts gesendet wird und die Bewertung des Agenten unberührt bleibt.

Jeder Vorschlag durchläuft diese Warteschlange, bis genügend Ihrer Entscheidungen erfasst wurden, um diesen Aktionstyp auf der Registerkarte [Leistung und Autonomie](agents-workspace.md) des Agenten von **Zuerst fragen** auf **Automatisch** hochzustufen, und bei den Aktionstypen, die ein Anfragender sehen kann, verlangt die Hochstufung zusätzlich eine ausdrückliche Bestätigung durch einen Administrator.

### Verwerfen oder ablehnen

Sowohl Ablehnen als auch Verwerfen halten einen Vorschlag davon ab, das Ticket zu erreichen, aber sie teilen dem Agenten ganz Unterschiedliches mit: die Wahl ist also wichtig.

- **Lehnen Sie ab**, wenn der Vorschlag falsch oder schlecht ist: ein schlechter Entwurf, eine falsche Klassifizierung, eine unpassende Statusänderung. Ablehnung ist negatives Trainings- und Bewertungssignal: sie senkt die Annahmequote des Agenten und verlangsamt seinen Weg zum eigenständigen Handeln, was genau dann erwünscht ist, wenn er Fehler macht.
- **Verwerfen Sie**, wenn der Vorschlag *richtig* ist, aber nicht gesendet werden soll: das Ticket ist sensibel, ein Kollege hat bereits geantwortet, es dupliziert etwas bereits Laufendes. Da das Verwerfen neutral ist, belohnt oder bestraft es den Agenten nicht: seine Annahmequote und seine Autonomie-Bilanz bleiben unangetastet.

Zum Verwerfen zu greifen, wenn Sie eigentlich „das war falsch" meinen, verschleiert ein echtes Qualitätsproblem, und einen richtigen, aber nicht versendbaren Vorschlag abzulehnen belastet einen Agenten zu Unrecht, der nichts falsch gemacht hat. Ein verworfener Vorschlag zeigt einen grauen Status **Verworfen** und wandert in **Kürzlich abgeschlossen**; der Agent kann in einem späteren Zyklus weiterhin erneut zum selben Ticket vorschlagen, genau wie nach einer Ablehnung. **Verworfen** ist nicht dasselbe wie **Abgelaufen**: Ein abgelaufener Vorschlag ist einer, über den niemand entschieden hat, bevor sein Genehmigungsfenster verstrichen ist, während ein verworfener Vorschlag eine bewusste Entscheidung ist, die Sie getroffen haben.

---

## Tickets schließen und lösen

Die Titel **Ticket schließen** und **Ticket lösen** werden rot angezeigt, weil sie das Ticket beenden und der Anfragende die Änderung sofort sieht. Dieser rote Titel ist das einzige Extra-Kennzeichen: es gibt kein gesondertes „terminales“ Abzeichen.

Das Freigeben einer dieser Aktionen (einzeln oder als Teil von **Alle freigeben**, wenn ein Element das Ticket schließt oder löst) öffnet eine Bestätigung, die nach der Aktion benannt ist (**Ticket lösen anwenden?**). Sie nennt das Ticket, warnt, dass der Anfragende die Änderung sofort sieht, listet bei einer Sammelfreigabe jedes schließende Element auf und bietet ein Grund-Feld für die Aufzeichnung. Sie bestätigen mit dem Aktionsnamen selbst (**Ticket lösen** oder **Ticket schließen**). Dies ist eine bewusste Reibung: Routineantworten und -notizen werden mit einem Klick angewendet, aber das Schließen oder Lösen eines Tickets erfordert von Ihnen stets ein kurzes Innehalten und Bestätigen.

---

## Entworfene Antworten lesen: der Fallback-Hinweis

Wenn ein Agent eine **Antwort an Anfragende** oder eine **Interne Notiz** entwirft, stützt er diesen Entwurf normalerweise auf die Bibliotheken Ihrer [Wissensdatenbank](knowledge.md) und nennt die Quellen, die er herangezogen hat. Gelegentlich sehen Sie bei einem solchen Vorschlag den Hinweis **Diese Antwort ist nicht durch Ihre Wissensdatenbank belegt.**. Sie bedeutet, dass der Agent diesen bestimmten Entwurf nicht mit zitierten Quellen belegen konnte. Behandeln Sie ihn daher als bloße Empfehlung und lesen Sie ihn vor dem Freigeben genau, statt ihm als quellengeprüft zu vertrauen.

**Details** öffnet den technischen Grund (für den Support), zum Beispiel einen Synthesefehler oder ein blockiertes Offenlegen interner Hinweise. Für Ihre Entscheidung brauchen Sie diese Codes nicht.

Wichtig zu wissen ist: **Das Fehlen dieses Hinweises ist der normale, gesunde Fall.** Die meisten Entwürfe sind belegt und tragen überhaupt keine Bildunterschrift. Und eine Antwort kann berechtigterweise keine zitierten Quellen haben (eine administrative Bestätigung oder eine rein interne Eskalation soll nicht aus Ihrer Wissensdatenbank entworfen werden), ohne diese Warnung auszulösen. Lesen Sie einen fehlenden Fallback-Hinweis daher nicht als Problem; er bedeutet, dass der Entwurf entweder ordnungsgemäß belegt ist oder nie belegt sein sollte. Der Hinweis erscheint nur, wenn der Agent versucht hat, eine Antwort zu belegen, und dies nicht konnte.

---

## Eine Zeile unter Aufmerksamkeit erforderlich abarbeiten

Zeilen unter **Aufmerksamkeit erforderlich** waren früher schreibgeschützt: Sie konnten sehen, dass ein Vorschlag abgelaufen oder eine Prüfung fehlgeschlagen war, konnten aber nichts tun, außer ihm beim Liegenbleiben zuzusehen. Jede Zeile trägt jetzt zwei Bedienelemente.

- **Analyse erneut starten** bittet den Agenten, sich dieses Ticket (oder diesen Alarm) noch einmal anzusehen, und zwar sofort. Es läuft genau derselbe Durchgang wie bei **An einem Ticket testen** auf der [Registerkarte Monitor](agents-workspace.md) des Agenten, sodass alles, was dabei herauskommt, als frische Vorschläge zur Prüfung in **Benötigt Ihre Entscheidung** landet. Der Tooltip lautet *Den Agenten bitten, das noch einmal anzusehen.*, und während der Arbeit *Der Agent sieht es sich erneut an …* Das ist der richtige erste Schritt, wenn der Fehler vorübergehender Natur war: ein Verbindungsaussetzer, ein Ticket, das sich mitten im Lauf geändert hat, ein Vorschlag, der abgelaufen ist, bevor jemand dazu kam.
- **Zur Kenntnis nehmen** räumt die Zeile endgültig weg. Der Tooltip lautet *Als gesehen markieren und dauerhaft aus der Liste entfernen.* Nutzen Sie es, wenn Sie den Fehler verstanden und behoben haben (oder entschieden haben, dass nichts zu tun ist): Die Zeile verschwindet sofort, kommt weder auf einem anderen Gerät noch nach einer Aktualisierung zurück, und die Kenntnisnahme wird in der Zeitachse der [Aktivität](agents-activity.md) als **Entscheidung** festgehalten, samt der Person, die sie erledigt hat, und dem Zeitpunkt. Sie wandert wie jedes andere abgeschlossene Element in **Kürzlich abgeschlossen**.

**Analyse erneut starten** erscheint nur dort, wo ein erneuter Lauf tatsächlich möglich ist: die Zeile muss ein Ticket (oder einen Alarm) benennen, das der Agent noch erreichen kann, und der Agent selbst muss noch existieren. Wo das nicht der Fall ist, wird **Zur Kenntnis nehmen** allein angeboten, und das ist das ehrliche Ergebnis: Es gibt nichts zu wiederholen, nur etwas abzuschließen. Zeilen, die ein inzwischen gelöschter Agent hinterlassen hat, sagen das anstelle der Schaltfläche: *Agent existiert nicht mehr*.

Ist der Rückstand groß (etwa eine Reihe von Vorschlägen, die abgelaufen sind, bevor jemand sie geprüft hat), ist das Abarbeiten Zeile für Zeile nicht die Antwort. Nutzen Sie stattdessen **Alle zur Kenntnis nehmen** in der Kopfzeile des Abschnitts. Es bittet Sie um Bestätigung mit der tatsächlichen Anzahl, die den gesamten Rückstand umfasst und nicht nur die Zeilen auf dem Bildschirm (der Abschnitt zeigt *Die N neuesten von M werden angezeigt*, wenn es mehr gibt), und räumt dann alle abgelaufenen, fehlgeschlagenen oder endgültig gescheiterten Einträge auf einmal weg. Vorschläge, die noch ausgeführt werden, bleiben unberührt, und der Stapel wird einmal in der Zeitachse der [Aktivität](agents-activity.md) als **Entscheidung** festgehalten. Das Löschen eines Agenten erledigt dasselbe automatisch für seine eigenen Überbleibsel, sodass ein Agent, den Sie außer Dienst stellen, keinen Haufen hinterlässt.

Die Paarung ist bewusst gewählt. **Analyse erneut starten** steht für „versuch das noch einmal", **Zur Kenntnis nehmen** für „ich habe es gesehen, es ist erledigt". Zusammen sollten sie **Aufmerksamkeit erforderlich** wieder auf leer bringen, statt es zu einer Liste anwachsen zu lassen, die niemand liest.

---

## Einen Vorschlag zu seiner Prüfung zurückverfolgen

Jede Ticketgruppe und jede Zeile unter „Aufmerksamkeit erforderlich" trägt eine Schaltfläche **Trace**. Sie öffnet den Dialog **Technischer Trace** über der Warteschlange: die Seite darunter bewegt sich nicht, sodass Sie nach dem Schließen des Dialogs genau dort weitermachen, wo Sie waren, mit unveränderter Scrollposition und, im Arbeitsbereich eines Agenten, auf der aktuellen Registerkarte. Darin können Sie die vollständige Prüfung nachvollziehen, die den Vorschlag erzeugt hat: was der Agent angesehen hat, welche Schritte er durchlaufen hat und wie lange jeder gedauert hat, sowie die Belege, die er gesammelt hat. Nutzen Sie ihn immer dann, wenn ein Entwurf oder eine Aktualisierung überraschend ist und Sie die dahinterstehende Begründung sehen möchten. Es ist derselbe Dialog, der auf der Seite [Aktivität](agents-activity.md) beschrieben ist.

---

## Tipps

- Arbeiten Sie von oben nach unten: Erledigen Sie **Benötigt Ihre Entscheidung** und räumen Sie dann **Aufmerksamkeit erforderlich** mit **Analyse erneut starten** oder **Zur Kenntnis nehmen** auf. **In Bearbeitung** und **Kürzlich abgeschlossen** erfordern nichts von Ihnen.
- Nichts hier hat den Anfragenden erreicht, bevor Sie es freigeben. Einen Entwurf zu lesen, ihn zurückzuverfolgen oder ihn in der Warteschlange zu belassen, ändert nichts am Ticket.
- Lehnen Sie ab, statt zu ignorieren. Ein abgelehnter Vorschlag bleibt mit Ihrer optionalen Notiz im Audit-Trail, was später weit nützlicher ist als ein Vorschlag, der einfach unbeachtet abgelaufen ist.
- Verwerfen Sie einen Vorschlag, den Sie schlicht nicht senden werden, statt ihn abzulehnen. Ist ein Entwurf zutreffend, soll aber nicht hinausgehen (ein sensibles Ticket, ein Kollege hat bereits geantwortet), legt **Verwerfen** ihn beiseite, ohne den Agenten zu belasten. **Ablehnen** bleibt Vorschlägen vorbehalten, die wirklich falsch waren.
- Ein fehlender Fallback-Hinweis ist eine gute Nachricht, keine fehlende Information. Widmen Sie Ihre gründlichste Lektüre den Entwürfen, die ihn *tatsächlich* tragen.
- Wenn eine freigegebene Änderung in **Aufmerksamkeit erforderlich** landet, verraten Ihnen die rote Bildunterschrift und die Schaltfläche **Trace**, ob der Agent, eine Sicherheitsprüfung oder das verbundene Ticketsystem sie gestoppt hat. Beheben Sie die zugrunde liegende Ursache und starten Sie dann die **Analyse erneut**, statt blind erneut freizugeben.
- Nehmen Sie nichts zur Kenntnis, nur damit eine Zahl verschwindet. **Zur Kenntnis nehmen** ist der Nachweis, dass sich eine Person den Fehler angesehen hat; eine Warteschlange, die Sie ungelesen leeren, ist weniger wert als eine, die Sie stehen lassen.
- Die kombinierte Warteschlange unter `/agents/approvals` ist am schnellsten, wenn Sie mehrere Agenten betreiben; wechseln Sie zum eigenen Tab **Freigaben** eines Agenten, wenn Sie sich nur auf diesen konzentrieren möchten.
