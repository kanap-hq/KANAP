# KI-Modelle

Diese Seite ist die Liste der KI-Modelle, die Ihre Organisation verwenden darf. Sie legen ein Modell einmal an — Anbieter, Adresse, Schlüssel, Preise — und *weisen* es von da an nur noch zu: dem [Plaid-Chat-Assistenten](ai-settings.md), einem einzelnen [KI-Agenten](agents-workspace.md) oder als organisationsweiten Standard, auf den alles andere zurückfällt. Von hier stammen auch die Kostenzahlen auf der Seite [Nutzung & Kosten](ai-usage.md): Die Preise, die Sie hier eintragen, sind die Preise, mit denen KANAP den tatsächlichen Token-Verbrauch bewertet.

## Wo Sie es finden

- Arbeitsbereich: **Administration**
- Pfad: **Administration → Künstliche Intelligenz → KI-Modelle**
- Route: `/admin/ai-models`
- Berechtigung: `ai_settings:admin`

---

## Wie ein Modell ausgewählt wird

In KANAP ist nichts fest auf ein Modell verdrahtet. Jeder Verbraucher — Plaid und jeder Agent — zeigt entweder auf ein bestimmtes Modell oder sagt „nimm das, was die Organisation nutzt“. Die Regel ist kurz:

1. **Das diesem Verbraucher zugewiesene Modell**, sofern es eines gibt.
2. Andernfalls das **Standardmodell der Organisation** — dasjenige, das auf dieser Seite mit dem Stern markiert ist.
3. Andernfalls das **Inklusive KANAP-Modell**, sobald ein Administrator seinen Anbieter und seinen Verarbeitungsort bestätigt hat.

Es gibt also genau einen Standard pro Organisation, und alles, was Sie nie anfassen, folgt ihm. Ändern Sie den Standard, und jeder nicht zugewiesene Verbraucher zieht mit — genau dafür ist er da.

Der dritte Schritt existiert nur im gehosteten Dienst von KANAP. In einer On-Premise-Installation gibt es kein inklusives Modell: Ist nichts zugewiesen und kein Standard gesetzt, läuft die Kette schlicht aus. Die Plaid-Einstellungsseite meldet dann, dass kein Modell konfiguriert ist, und der Chat antwortet nicht; die Agenten laufen zwar weiter, überspringen aber die Schritte, die ein Modell benötigen — sie fallen auf ihr Verhalten ohne KI zurück, statt komplett zu scheitern. Ein registriertes Modell behebt das: Markieren Sie es mit dem Stern als Standard, damit alles auf einen Schlag darauf zugreift, oder weisen Sie es Verbraucher für Verbraucher zu.

Im gehosteten Dienst knüpft der dritte Schritt an eine Bedingung. Plaid und die Agenten, die das inklusive Modell nutzen würden, warten, bis ein Administrator dessen Anbieter bestätigt hat, und die Plaid-Einstellungsseite sowie die Agentenseite weisen darauf hin. Ein Modell, das Sie selbst anlegen, braucht nie eine Bestätigung. Siehe [Das inklusive KANAP-Modell bestätigen](ai-settings.md#das-inklusive-kanap-modell-bestatigen).

Durch Aufräumen der Liste können Sie diese Kette nicht zerreißen: Ein Modell, auf das noch etwas zeigt, lässt sich gar nicht erst archivieren; und sollte eine Zuweisung doch einmal auf ein archiviertes Modell zeigen, fällt der Verbraucher auf den Standard zurück, statt zu scheitern.

---

## Arbeiten mit der Liste

Die Tabelle zeigt jedes Modell, das Ihre Organisation registriert hat — aktive zuerst, archivierte darunter, innerhalb jeder Gruppe alphabetisch.

**Spalten**:

- **Standard** — ein Stern in jeder aktiven Zeile. Der ausgefüllte Stern ist der Organisationsstandard. Klicken Sie auf einen leeren Stern, um den Standard dorthin zu verschieben; klicken Sie auf den ausgefüllten Stern eines eigenen Modells, um ihn zu entfernen. Es kann nur ein Standardmodell geben, das Markieren eines neuen hebt die Markierung des alten also auf. Archivierte Modelle haben keinen Stern.
- **Name** — der Name, den Sie dem Modell gegeben haben, dazu **Archiviert**, wenn es ausgemustert wurde. Ein Hinweis **Konfiguration unvollständig** erscheint hier, wenn etwas Erforderliches fehlt — meist ein Modell, das einen API-Schlüssel braucht und keinen hat. Beheben Sie das: Ein unvollständiges Modell fällt nicht still auf ein anderes zurück, es funktioniert einfach nicht.
- **Modell** — der Anbieter in der ersten Zeile, darunter die genaue Modellkennung.
- **Fähigkeiten** — **Bilder ✓**, wenn das Modell Bilder lesen kann, **Nur Text**, wenn nicht. Das ergibt sich aus dem Schalter **Versteht Bilder** im Editor.
- **Eingabepreis / M Tokens** und **Ausgabepreis / M Tokens** — was Sie pro Million Tokens zahlen, in Euro. Ein Gedankenstrich (**—**) bedeutet, dass kein Preis hinterlegt ist, was KANAP als kostenlos behandelt.
- **Nutzung** — für ein von Ihnen angelegtes Modell, wie viele Nachrichten es in diesem Kalendermonat verarbeitet hat: Plaid-Benutzer-Nachrichten in Gesprächen, die diesen Anbieter und dieses Modell genutzt haben, plus ein Zähler pro Agentenlauf, der dieses Modell aufgezeichnet hat. **0 Nachrichten in diesem Monat** heißt: noch kein Verkehr, nicht dass das Modell ungenutzt als Standard wäre. Das inklusive KANAP-Modell behält seine eigene Anzeige: das monatliche Kontingent inklusiver Nachrichten mit Fortschrittsbalken, nicht diese Zahl.

**Zeilenaktionen** (nur bei aktiven Modellen):

- **Bearbeiten** — öffnet den Editor-Dialog.
- **Archivieren** — mustert das Modell aus. Die Schaltfläche ist deaktiviert, solange noch etwas es verwendet, und der Tooltip sagt es auch: *Dieses Modell ist noch zugewiesen und kann nicht archiviert werden*.

Archivierte Zeilen erscheinen ausgegraut mit einer einzigen Aktion **Wiederherstellen**. Archivieren ist bewusst kein Löschen: Die bisherige Nutzung bleibt dem Modell auf der Seite [Nutzung & Kosten](ai-usage.md) zugerechnet, und ein wiederhergestelltes Modell kommt mit Anbieter, Schlüssel, Preisen und Fähigkeiten unverändert zurück — aber nicht mehr als Standard und keinem Verbraucher mehr zugewiesen, sodass Sie es bewusst neu zuweisen. Ein archiviertes Modell lässt sich weder bearbeiten noch als Standard setzen oder zuweisen, solange Sie es nicht wiederherstellen.

### Das Inklusive KANAP-Modell

Im gehosteten Dienst ist die erste Zeile der Tabelle immer **Inklusives KANAP-Modell** — *Von KANAP betrieben, in Ihrem Abonnement enthalten*. Es verhält sich mit Absicht anders als die Modelle, die Sie selbst anlegen:

- Es kostet in beiden Preisspalten `0,00 €`. Es ist Teil Ihres Abonnements und wird Ihnen nicht pro Token berechnet.
- Es ist **multimodal** — es liest Ticket-Screenshots — und daran können Sie nichts ändern.
- In der Spalte **Nutzung** zeigt es Ihre **inklusiven Nachrichten in diesem Monat** mit einem Fortschrittsbalken, sodass Sie sehen, wie viel des Monatskontingents noch übrig ist. Eine Nachricht ist eine an Plaid gestellte Frage, eine Anfrage eines externen Assistenten über MCP oder ein von einem Agenten geprüftes Ticket — alle drei schöpfen aus demselben Kontingent. Dieser Balken ist das Kontingent des inklusiven Modells; es ist nicht dieselbe Zahl wie die Nachrichtenzähler der Modelle, die Sie anlegen.
- Es zeigt in der Spalte **Standard** einen ausgefüllten Stern, solange keines Ihrer eigenen aktiven Modelle mit dem Stern markiert ist — der Rückfall „nichts konfiguriert“ in sichtbarer Form. Klicken Sie auf seinen leeren Stern, um Ihren aktuellen Standard zu löschen und darauf zurückzufallen. Bearbeiten oder archivieren können Sie es weiterhin nicht.
- Es hat keine Bearbeiten- oder Archivieren-Aktionen: die gehören zu den Modellen, die Sie selbst anlegen. Es ist einfach immer da.
- Plaid und die Agenten nutzen es erst, nachdem ein Administrator den Anbieter und den Ort der Datenverarbeitung auf der Seite [Plaid-Einstellungen](ai-settings.md#das-inklusive-kanap-modell-bestatigen) bestätigt hat. Modelle, die Sie selbst anlegen, unterliegen diesem Schritt nicht.

In einer On-Premise-Installation erscheint diese Zeile überhaupt nicht.

---

## Ein Modell hinzufügen oder bearbeiten

**Neues Modell** öffnet den Editor; das Stiftsymbol in einer aktiven Zeile öffnet ihn für einen vorhandenen Eintrag erneut. Die Felder:

- **Name** — wie das Modell überall dort erscheint, wo Sie es zuweisen: in der Plaid-Auswahl und in der Liste **KI-Modell** jedes Agenten. Nehmen Sie etwas, das Sie in sechs Monaten in einer Auswahlliste wiedererkennen (*Claude Produktion*, *Mistral lokal*), nicht die rohe Modellkennung. Beachten Sie: Die Tabelle **Kosten pro Modell** auf [Nutzung & Kosten](ai-usage.md) verwendet diesen Namen *nicht* — sie listet die Kennung auf, die tatsächlich aufgerufen wurde, etwa `anthropic:claude-sonnet-5`.
- **Anbieter** — wer das Modell bereitstellt. Die Auswahl bestimmt, welche der folgenden Felder gelten.
- **Modell** — die genaue Modellkennung in der Schreibweise des Anbieters (zum Beispiel `claude-sonnet-5`). Das ist kein Anzeigename; ein Tippfehler zeigt sich hier als fehlgeschlagener Aufruf, nicht als Validierungsfehler.
- **Serveradresse** — nur für Anbieter, die Sie selbst betreiben oder gezielt adressieren. Wenn KANAP in Docker läuft und das Modell auf derselben Host-Maschine, adressieren Sie den Host statt `localhost`.
- **API-Schlüssel** — die Zugangsdaten Ihres Anbieters. Er wird verschlüsselt gespeichert und nie wieder angezeigt: Wenn Sie ein vorhandenes Modell erneut öffnen, zeigt das Feld eine Maske (`••••••••`) mit dem Hinweis *Leer lassen, um den aktuellen Schlüssel zu behalten*, Sie tippen also nur hinein, um den Schlüssel zu ersetzen. Ist auf der Instanz kein Verschlüsselungsgeheimnis konfiguriert, erklärt eine Warnung am Seitenanfang, dass Schlüssel überhaupt nicht gespeichert werden können.

**Fähigkeiten**:

- **Versteht Bilder** — für ein reines Textmodell deaktivieren. Die Erklärung steht im Info-Tooltip neben **Fähigkeiten**: An Tickets angehängte Screenshots werden dann *übersprungen* statt gesendet, und genau das wollen Sie — ein reines Textmodell, das ein Bild erhält, lässt den Aufruf fehlschlagen, statt nützliche Arbeit zu leisten. Bei einem bildfähigen Modell lassen Sie den Schalter an, dann nutzen Ihre Triage-Agenten Ticket-Screenshots als Nachweis.

**Eingabekosten** und **Ausgabekosten** — der Info-Tooltip neben jeder Beschriftung erklärt *Preis pro Million Tokens, wie auf der Preisseite Ihres Anbieters angegeben*:

- Übernehmen Sie die beiden Zahlen direkt von der Preisseite Ihres Anbieters. Sie unterscheiden sich in der Regel, und KANAP bewertet sie getrennt.
- **Lassen Sie beide leer oder setzen Sie sie auf 0, wenn das Modell lokal oder selbst gehostet läuft.** Ein Modell ohne Preise kostet nichts — was für ein Modell auf Ihrer eigenen Hardware der Wahrheit entspricht. Die Wahl des Anbieters Ollama füllt genau deshalb beide Preise mit 0 vor.
- Agentenkosten werden bewertet, während die Arbeit läuft, und dann festgehalten. Eine Preisänderung ändert also, was Agenten **ab jetzt** kosten, und lässt vergangene Zahlen unberührt. Plaids Kosten werden anders ermittelt — siehe [Nutzung & Kosten](ai-usage.md) — und dort verschiebt eine Preisänderung auch die historischen Werte.

**Zeitlimit** — wie lange, in Sekunden, auf dieses Modell gewartet wird, bevor abgebrochen wird. Die Erklärung steht im Info-Tooltip neben der Beschriftung: leer lassen für das Standardlimit. Lokale Modelle brauchen oft mehr Zeit — deshalb sitzt die Einstellung am Modell und nicht an der Installation. Um dieses Modell zum Organisationsstandard zu machen, markieren Sie es nach dem Speichern in der Spalte **Standard** der Liste mit dem Stern — diese Wahl steht nicht im Editor.

**Verbindung testen** erscheint, sobald das Modell gespeichert ist. Die Schaltfläche macht einen winzigen Aufruf mit den Einstellungen, wie sie gespeichert sind, und meldet entweder *Verbindung erfolgreich* mit der Round-Trip-Zeit oder die Fehlermeldung des Anbieters selbst. Sie belegt, dass Anbieter, Modellkennung, Adresse und Schlüssel zusammenspielen — sie prüft weder Ihre Preise noch den Bilder-Schalter oder die Antwortzeit. Führen Sie sie nach dem Anlegen eines Modells und nach jedem Schlüsselwechsel aus: Ein falscher Schlüssel bleibt sonst unsichtbar, bis echte Arbeit fehlschlägt — und sie schlägt leise fehl (eine Chat-Antwort, die mit einem Fehler endet, oder ein Agent, der einen Schritt überspringt und weitermacht).

**Erstellen** / **Speichern** bleiben deaktiviert, bis Name und Modellkennung ausgefüllt sind und Preise sowie Antwortzeit gültige Zahlen ergeben. Namen müssen innerhalb Ihrer Organisation eindeutig sein.

---

## Tipps

- **Setzen Sie einen Standard, bevor Sie irgendetwas zuweisen.** Mit einem markierten Modell funktionieren jeder neue Agent und Plaid selbst sofort, und Sie haben eine einzige Stelle, um das Modell später zu wechseln.
- **Benennen Sie Modelle nach ihrer Rolle, nicht nach ihrer Version.** *Triage-Modell* überlebt den Wechsel von einer Modellversion zur nächsten; *Claude Sonnet 4.5* wird an dem Tag zur Lüge, an dem Sie es bearbeiten.
- **Registrieren Sie denselben Anbieter zweimal, wenn die Aufgaben verschieden sind.** Ein günstiges reines Textmodell für die Triage großer Mengen und ein bildfähiges Modell für screenshotlastige Tickets ist ein ganz normales Setup — genau dafür gibt es die Zuweisung pro Agent.
- **Tragen Sie die Preise korrekt ein oder lassen Sie sie leer.** Sie sind keine Dekoration: Sie treiben die Kostenzahlen auf [Nutzung & Kosten](ai-usage.md) und die Obergrenze **Kosten pro Lauf (EUR)** jedes Agenten. Ein mit 0 bepreistes Modell erreicht nie eine Kostenobergrenze — bei einem kostenfreien Modell sind die Token-Limits Ihr einziger Schutz.
- **Prüfen Sie die Archivieren-Schaltfläche, bevor Sie ein Modell ausmustern.** Sie bleibt deaktiviert, solange Plaid oder ein Agent an dieses Modell *angeheftet* ist (nicht nur als Standard darauf zurückfällt). Hängen Sie diese Anheftungen zuerst um.
- **Testen Sie nach jedem Schlüsselwechsel.** Der Verbindungstest ist kostenlos und sofort erledigt; ein veralteter Schlüssel, den Sie erst durch einen fehlgeschlagenen Agentenlauf entdecken, ist beides nicht.
