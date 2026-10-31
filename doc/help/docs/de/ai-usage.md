# Nutzung & Kosten

Diese Seite beantwortet zwei Fragen, die Administratoren sich regelmäßig stellen: *Wie stark nutzen wir KI?* und *Was kostet uns das?* Sie deckt die gesamte Organisation ab (den [Plaid-Chat-Assistenten](ai-assistant.md) und jeden [KI-Agenten](agents-overview.md) zusammen) und bewertet die Kosten mit den echten Preisen, die Sie auf der Seite [KI-Modelle](ai-models.md) hinterlegt haben. Die Zahlen zu Gesprächen und Tokens standen früher am Ende der Plaid-Einstellungsseite; jetzt stehen sie hier, direkt neben dem Geld.

## Wo Sie es finden

- Arbeitsbereich: **Administration**
- Pfad: **Administration → Künstliche Intelligenz → Nutzung & Kosten**
- Route: `/admin/ai-usage`
- Berechtigung: `ai_settings:admin`

Alles auf dieser Seite ist schreibgeschützt; sie ist ein Bericht, keine Sammlung von Steuerelementen. Durchgehend gelten zwei Zeitfenster: **Aktueller Monat** (seit dem 1.) und **Letzte 30 Tage** (ein gleitendes Fenster). Sie stimmen selten überein, und beide sind nützlich: der Monat für Budgets, das gleitende Fenster, um eine Änderung des Tempos zu bemerken.

---

## Kosten

Drei Karten am oberen Rand:

- **Gesamt in diesem Monat**: Agenten plus Plaid, darunter der Wert der letzten 30 Tage. Agentenkosten werden pro Aufruf gemessen. Plaid-Kosten werden pro Nachricht gemessen, und eine Nachricht, die ihre Tarife nicht gespeichert hat, wird mit dem heutigen Modell geschätzt (siehe unten).
- **Agenten in diesem Monat**: was die Agentenflotte tatsächlich gekostet hat, darunter der Wert der letzten 30 Tage.
- **Plaid in diesem Monat**: was der Chat-Assistent gekostet hat. Diese Karte nutzt ihre Bildunterschrift für den unten erklärten Schätzungshinweis statt für einen 30-Tage-Wert.

Kosten werden in Euro auf den Cent genau angezeigt und auf vier Nachkommastellen, wenn der Betrag unter einem Cent liegt: am Anfang oder mit einem günstigen Modell kann eine echte Summe tatsächlich `0,0034 €` betragen.

**Agentenkosten werden gemessen.** Jeder Modellaufruf eines Agenten hält seine Eingabe- und Ausgabe-Tokens fest, die sofort zu den Tarifen des Modells bewertet werden, mit dem dieser Agent gearbeitet hat, und das Ergebnis bleibt erhalten. Deshalb sind die Preise auf [KI-Modelle](ai-models.md) wichtig, deshalb trägt ein ohne Preise registriertes Modell hier nichts bei, und deshalb schreibt eine spätere Preisänderung nicht um, was Agenten bereits gekostet haben. (Liefert ein Anbieter keine eigenen Token-Zahlen, schätzt KANAP sie aus dem Umfang des Austauschs. Ein kleiner Teil des Werts kann also näherungsweise sein.)

**Plaid wird Nachricht für Nachricht bewertet**, und die Karte sagt, wie: *Tarife, die mit jeder Nachricht gespeichert sind. Ältere Nachrichten verwenden die des aktuell zugewiesenen Modells.* Jede Antwort des Assistenten behält den Anbieter, das Modell und die Tarife, die beim Schreiben galten, und der Monat addiert diese Beträge. Eine Nachricht, die vor dieser Aufzeichnung geschrieben wurde, hat keine eigenen Tarife: KANAP bewertet sie mit dem Modell, das Plaid heute zugewiesen ist. Eine Preisänderung auf der Seite [KI-Modelle](ai-models.md) lässt eine Nachricht, die ihre Tarife bereits gespeichert hat, unverändert und verschiebt den Wert nur für diese älteren Nachrichten. Ist das zugewiesene Modell kostenfrei und hat keine Nachricht einen Preis gespeichert, wechselt die Bildunterschrift zu *Das zugewiesene Modell ist kostenfrei* und der Wert steht auf null.

Das **Inklusive KANAP-Modell** kostet konstruktionsbedingt 0 €: es ist Teil Ihres Abonnements. Eine Organisation, die vollständig auf dem inklusiven Modell läuft, sieht hier Nullen und sollte stattdessen das Kontingent an inklusiven Nachrichten auf der Seite [KI-Modelle](ai-models.md) im Auge behalten.

### Kosten pro Agent und Kosten pro Modell

Sobald es Agentenaktivität zu berichten gibt, erscheinen darunter zwei Tabellen, jeweils mit einer Spalte **Aktueller Monat** und einer Spalte **Letzte 30 Tage**.

- **Kosten pro Agent**: eine Zeile pro Agent, sodass Sie sehen, welcher teuer ist. Ziehen Sie die Obergrenze **Kosten pro Lauf (EUR)** des Agenten auf seiner [Registerkarte Einstellungen](agents-workspace.md) hinzu, wenn eine Zahl falsch aussieht.
- **Kosten pro Modell**: dieselben Ausgaben, nach Modell geschnitten, sortiert nach dem über 30 Tage teuersten Modell zuerst. Die Zeilen sind die Anbieter- und Modellkennungen, die tatsächlich aufgerufen wurden (`anthropic:claude-sonnet-5`, `ollama:mistral`), nicht die sprechenden Namen, die Sie ihnen auf der Seite [KI-Modelle](ai-models.md) gegeben haben. Eine Zeile mit der Bezeichnung **Unbekanntes Modell** ist ältere Aktivität, die erfasst wurde, bevor es die Modellzuordnung pro Aufruf gab.

Beide Tabellen beziehen sich auf **Agentenläufe**. Plaids Wert wird hier nicht aufgeschlüsselt. Er erscheint nur auf der Karte **Plaid in diesem Monat**.

---

## Gespräche

Zwischen den Kostentabellen und der Token-Tabelle stehen vier unbeschriftete Karten, alle zum Chat-Assistenten:

- **Alle Gespräche**: jedes derzeit gespeicherte Gespräch. Wenn Sie auf der Seite [Plaid-Einstellungen](ai-settings.md) eine **Aufbewahrung von Gesprächen (Tage)** festlegen, werden Gespräche irgendwann bereinigt und zählen hier nicht mehr mit.
- **Aktive Gespräche (7T)** und **Aktive Gespräche (30T)**: Gespräche, die in den letzten 7 bzw. 30 Tagen aktualisiert wurden.
- **Aktive Benutzer (30T)**: wie viele verschiedene Personen den Chat in den letzten 30 Tagen tatsächlich genutzt haben. Die ehrlichste Adoptionszahl der Seite.

---

## Token-Verbrauch

Eine Tabelle, zwei Zeilen (**Aktueller Monat** und **Letzte 30 Tage**) mit **Eingabe-Tokens**, **Ausgabe-Tokens**, **Tokens gesamt** und **Benutzernachrichten** (der Anzahl der in diesem Zeitfenster gestellten Fragen).

**Diese Tabelle betrifft den Chat, nicht die Agenten.** Es sind die Tokens des Plaid-Assistenten. Die Karte **Plaid in diesem Monat** bewertet jede Nachricht aus diesen Tokens und den mit dieser Nachricht gespeicherten Tarifen. Der Verbrauch der Agenten wird hier nicht mitgezählt. Er taucht in **Kosten pro Agent** und weiter unten in **Agenten-Nachrichten** auf. Daran lohnt es sich zu denken, wenn Sie auf dem inklusiven oder einem lokalen Modell laufen: Dort sind die Kosten immer null, der Verbrauch aber nicht.

---

## Agenten-Nachrichten (diesen Monat)

Eine Karte pro Agent, die aktivste zuerst. **Alle Agenten** nennt die Gesamtzahl der in diesem Monat geprüften Tickets, danach zeigt jeder Agent seine eigene Zahl, in der Bildunterschrift ergänzt um seinen Wert der letzten 30 Tage. Jeder Ihrer Agenten erscheint hier, auch solche, die noch nichts getan haben: eine Karte, die auf 0 steht, ist selbst eine Beobachtung wert. Archivierte Agenten bleiben außen vor.

Das ist die organisationsweite Sicht auf das, was der Arbeitsbereich jedes Agenten einzeln zeigt. Lesen Sie sie zusammen mit **Kosten pro Agent**: Ein Agent mit vielen Nachrichten und wenig Kosten läuft auf einem kostenfreien oder günstigen Modell; ein Agent mit wenigen Nachrichten und hohen Kosten leistet pro Ticket teure Arbeit und verdient einen genaueren Blick.

---

## Tipps

- **Vergleichen Sie die beiden Zeitfenster, nicht nur die Summen.** *Aktueller Monat* sieht am 3. eines Monats winzig aus; erst der gleitende 30-Tage-Wert daneben sagt Ihnen, ob sich tatsächlich etwas geändert hat.
- **Preise rein, Kosten raus.** Diese Zahlen sind nur so gut wie die Preise auf der Seite [KI-Modelle](ai-models.md). Wirkt eine Kostenzahl unmöglich niedrig, prüfen Sie, ob das Modell überhaupt Preise hat: ein leeres Preisfeld liest sich als kostenlos.
- **Lesen Sie den Plaid-Wert an den Tarifen, die mit jeder Nachricht gespeichert sind.** Eine Antwort des Assistenten behält die Tarife, die beim Schreiben galten. Eine Nachricht, die davor gespeichert wurde, verwendet das heute zugewiesene Modell, und die Karte sagt es. Eine spätere Preisänderung verschiebt nur diesen älteren Teil des Werts.
- **Nutzen Sie Kosten pro Modell, wenn Sie eine Umstellung abwägen.** Die Tabelle zeigt, was Sie jedes Modell über alle Agenten hinweg wirklich kostet: genau die Zahl, die Sie vergleichen sollten, bevor Sie Arbeit auf ein günstigeres Modell verschieben.
- **Kosten von null heißt nicht Nutzung von null.** Auf dem inklusiven oder einem lokalen Modell bleibt jede Kostenzahl bei 0 €: die Agentenlast zeigt sich in **Agenten-Nachrichten**, die Chat-Last in der Token-Tabelle.
