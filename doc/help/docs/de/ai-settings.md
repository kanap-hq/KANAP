# Plaid-Einstellungen

Diese Seite steuert den [Plaid-Chat-Assistenten](ai-assistant.md): mit welchem KI-Modell er spricht, ob Chat und MCP-API eingeschaltet sind, wie lange Gespräche aufbewahrt werden und welche Schlüssel externen MCP-Clients Zugriff auf Ihre Daten gewähren. Es ist ein auf den Chat ausgerichteter Bildschirm. Die Modelle selbst — Anbieter, Schlüssel, Preise — werden einmalig auf der Seite [KI-Modelle](ai-models.md) definiert, und jeder [KI-Agent](agents-workspace.md) wählt sein eigenes Modell auf seiner Registerkarte Einstellungen. Was Sie hier ändern, wirkt sich also nicht darauf aus, wie die Agenten arbeiten.

## Wo Sie es finden

- Arbeitsbereich: **Administration**
- Pfad: **Administration → Künstliche Intelligenz → Plaid**
- Route: `/admin/ai`
- Berechtigung: `ai_settings:admin`
- Feature-Flag: erfordert, dass die Oberfläche für die KI-Einstellungen aktiviert ist. Wenn sie deaktiviert ist, zeigt die Seite einen Hinweis an („KI-Einstellungen sind für diese Instanz deaktiviert.“) und es sind keine Steuerelemente verfügbar.

---

## Anbieter

### Von Plaid verwendetes Modell

Eine einzige Auswahlliste entscheidet, welches Modell Chat-Fragen beantwortet:

- **Standardmodell (*Name*)** — der Organisationsstandard von der Seite [KI-Modelle](ai-models.md), namentlich genannt, damit Sie sehen, was Sie bekommen. Das ist die erste Option und in aller Regel die richtige: Lassen Sie sie stehen, und Plaid folgt dem Standard, wohin Sie ihn auch verschieben.
- **Inklusives KANAP-Modell**: erscheint anstelle der obigen Option, wenn kein Standard gesetzt ist, im gehosteten Dienst. Plaid läuft dann auf dem Modell, das in Ihrem Abonnement enthalten ist, innerhalb seines monatlichen Nachrichtenkontingents. Ein Administrator bestätigt zuvor den Anbieter und den Ort, an dem er Daten verarbeitet: siehe [Das inklusive KANAP-Modell bestätigen](#das-inklusive-kanap-modell-bestatigen).
- **Kein Modell konfiguriert** — erscheint, wenn es weder einen Standard *noch* ein inklusives Modell gibt, also im On-Premise-Fall. Beachten Sie: Diese Option zeigt weiterhin *Kein Modell konfiguriert* an, bis irgendein Modell als Organisationsstandard mit dem Stern markiert ist, selbst wenn Sie längst mehrere registriert haben — sie beschreibt den Rückfall, nicht Ihre Modellliste.
- **Jedes aktive Modell namentlich** — heftet Plaid an ein bestimmtes Modell, unabhängig vom Standard. Archivierte Modelle werden nicht angeboten.

Es gibt also zwei Wege, den Chat zum Laufen zu bringen: Markieren Sie auf der Seite [KI-Modelle](ai-models.md) einen Standard mit dem Stern und lassen Sie diese Auswahlliste auf der ersten Option stehen — oder wählen Sie hier ein Modell namentlich aus. Das Anheften hier funktioniert unabhängig davon, ob ein Standard existiert.

Der Hinweis darunter verlinkt direkt auf die Seite **KI-Modelle**, aus der jede Option dieser Liste stammt. Anbieter, Endpunkt oder API-Schlüssel tragen Sie hier nicht mehr ein, und einen separaten Multimodal-Schalter gibt es ebenfalls nicht mehr — ob ein Modell Bilder lesen kann, ist eine Eigenschaft des Modells und wird einmalig in dessen Editor festgelegt.

### Das inklusive KANAP-Modell bestätigen

Im gehosteten Dienst bestätigt ein Administrator, welcher Anbieter Ihre Daten erhält, bevor Plaid oder ein Agent das inklusive Modell nutzt. Bis dahin warten beide.

Wenn Plaid oder ein Agent ohne eigenes Modell auf dem inklusiven Modell laufen würde, erscheint in der Karte „Anbieter" eine Statuszeile. Sie nennt den Anbieter und den Ort, an dem er Daten verarbeitet, zum Beispiel *Inklusives KANAP-Modell: Anthropic (Verarbeitungsort: Vereinigte Staaten)*. Daneben steht **Bestätigung erforderlich** oder **Bestätigt**. Unter der Zeile sehen Sie, wer wann bestätigt hat. Nutzen Plaid und alle Ihre Agenten Modelle, die Sie selbst angelegt haben, erscheint die Zeile nicht und es gibt nichts zu bestätigen.

Eine Bestätigung deckt ab, was diese Funktionen an den Anbieter senden: die Fragen, die Benutzer Plaid stellen, die Fragen, an denen Agenten arbeiten, und die KANAP-Daten, die sie zur Antwort lesen.

- **Bestätigen** speichert Ihre Bestätigung. Plaid wird dadurch nicht eingeschaltet.
- **Chat aktivieren** verlangt die Bestätigung, solange sie fehlt. Schalten Sie ihn ein und speichern Sie: Ein Fenster zeigt den Anbieter und den Verarbeitungsort. **Bestätigen und aktivieren** speichert Ihre Änderungen und die Bestätigung gemeinsam. Schließen Sie das Fenster, wird nichts gespeichert. Das Fenster verweist außerdem auf die Seite [KI-Modelle](ai-models.md), falls Sie lieber ein eigenes Modell verwenden.
- **Zurückziehen** entfernt die Bestätigung nach einer zweiten Rückfrage. KI-Funktionen, die das inklusive Modell verwenden, stoppen, bis ein Administrator erneut bestätigt. Plaid bleibt eingeschaltet und zeigt seinen Benutzern einen Hinweis.
- Eine erneute Bestätigung wird verlangt, wenn sich der Anbieter, seine Verbindungsadresse, der angezeigte Name oder der Verarbeitungsort ändert. Ein neues Modell desselben Anbieters verlangt sie nicht. Ändert sich der Anbieter, während Ihr Fenster offen ist, zeigt das Fenster den neuen und bittet Sie, ihn zu prüfen.
- Plaid und Agenten, die auf einem von Ihnen angelegten Modell laufen, brauchen keine Bestätigung. Auch über MCP verbundene externe Assistenten hängen nicht davon ab, weil MCP nichts an das inklusive Modell sendet.

In einer On-Premise-Installation gibt es kein inklusives Modell, dieser Abschnitt gilt dort nicht.

### Integrierte Nutzung

Wenn Plaid auf dem Inklusiven KANAP-Modell läuft — keine ausdrückliche Wahl, kein Organisationsstandard —, erscheint eine Karte **Integrierte Nutzung** mit:

- Der Anzahl der in diesem Monat verbrauchten Nachrichten im Vergleich zum Limit, mit einem Fortschrittsbalken, der ab drei Vierteln bernsteinfarben und kurz vor dem Limit rot wird
- Dem Datum, an dem das Kontingent zurückgesetzt wird
- Einem Hinweis, dass eigene API-Schlüssel die Obergrenze aufheben

Wie die Karte erläutert, wird das Kontingent für diesen Mandanten gemeinsam von Chat- und MCP-Anfragen genutzt — und die Agenten schöpfen ebenfalls daraus. Eine Nachricht ist eine Chat-Frage, eine Anfrage eines externen Assistenten über MCP oder ein von einem Agenten geprüftes Ticket. Eine ausgelastete Agentenflotte verbraucht es schneller; wenn Sie also diesen Balken beobachten, behalten Sie auch die Seite [Nutzung & Kosten](ai-usage.md) im Auge.

### Status-Chips

Der Header der Anbieter-Karte zeigt drei Indikatoren auf einen Blick:

- **Chat aktiviert / Chat deaktiviert** — der Hauptschalter für den Endbenutzer-Chat
- **MCP aktiviert / MCP deaktiviert** — ob externe MCP-Clients eine Verbindung herstellen können
- **Anbieter bereit / Anbieter unvollständig**: ob das Modell, auf das Plaid auflöst, tatsächlich nutzbar ist. Solange nur die Bestätigung des inklusiven Modells fehlt, ist dieser Indikator ausgeblendet und die Statuszeile oben tritt an seine Stelle.

Fehlt etwas, listet **Aktuelle Validierungsfehler des Anbieters** es über dem Formular auf — ein unvollständiges Modell oder gar kein Modell. Behoben wird das in der Regel auf der Seite [KI-Modelle](ai-models.md) und nicht hier.

---

## Funktionen

Der Bereich **Funktionen** schaltet die optionalen KI-Oberflächen um:

- **Chat aktivieren**: schaltet den In-App-Chat-Arbeitsbereich für Endbenutzer ein oder aus. Er lässt sich nicht einschalten, solange der Header **Anbieter unvollständig** meldet: Das Speichern wird mit den aufgeführten Gründen abgelehnt, und Sie beheben sie zuerst auf der Seite [KI-Modelle](ai-models.md). Eine fehlende Bestätigung des inklusiven Modells ist die Ausnahme: Dann öffnet das Speichern das Bestätigungsfenster. Dieselbe Prüfung läuft bei jedem Speichern, solange der Chat bereits aktiv ist: Ein Modell, das später unvollständig wird, blockiert also auch unabhängige Änderungen auf dieser Seite, bis die Sache geklärt ist.
- **MCP aktivieren**: schaltet die MCP-API für externe Clients ein oder aus. Sie wartet nicht auf die Bestätigung des inklusiven Modells. MCP-Anfragen zählen trotzdem zum monatlichen Kontingent, wenn Plaid auf diesem Modell laufen würde.
- **Websuche** — ermöglicht es dem Plaid-Chat-Assistenten, das Web zu durchsuchen. Dafür muss der Websuche-Schlüssel auf Instanzebene konfiguriert sein; ohne ihn ist der Schalter deaktiviert und ein Tooltip erklärt den Grund. Beim Aktivieren wird automatisch ein Konnektivitätstest ausgeführt und das Ergebnis gemeldet. Dieser Schalter gilt **nur für den Chat-Assistenten** — KI-Agenten haben ihre eigene, unabhängige Websuche-Einstellung auf der [Registerkarte Einstellungen](agents-workspace.md) jedes Agenten, die auf derselben Konfiguration auf Instanzebene beruht.

---

## Aufbewahrung

- **Aufbewahrung von Gesprächen (Tage)** — Chat-Gespräche und ihre Nachrichten, die älter als dieser Wert sind, kommen für die automatische Bereinigung infrage. Lassen Sie das Feld leer, um sie unbegrenzt aufzubewahren.

Änderungen unter **Anbieter**, **Funktionen**, **Aufbewahrung** *und* im weiter unten stehenden Feld **Max. Lebensdauer des Schlüssels (Tage)** werden alle von der einen Schaltfläche **Einstellungen speichern** am Fuß dieser Karte übernommen. Nichts auf dieser Seite speichert von selbst.

---

## MCP API-Schlüssel

Der Bereich **MCP API-Schlüssel** stellt langlebige Schlüssel aus, damit externe Assistenten und IDEs über das Model Context Protocol mit KANAP kommunizieren können — unter Verwendung derselben Daten, die Plaid sieht.

Die Karte zeigt eine Schaltfläche **Schlüssel erstellen**, die Obergrenze **Max. Lebensdauer des Schlüssels (Tage)** und eine Tabelle vorhandener Schlüssel mit **Bezeichnung**, **Präfix**, **Erstellt**, **Läuft ab**, **Zuletzt verwendet** und **Status** (**Aktiv** oder **Widerrufen**).

### Einen Schlüssel erstellen

1. Klicken Sie auf **Schlüssel erstellen**.
2. Geben Sie eine beschreibende **Bezeichnung** ein (zum Beispiel „Desktop-MCP-Client“).
3. Klicken Sie auf **Erstellen**. KANAP generiert ein einmaliges Geheimnis.
4. Kopieren Sie das Geheimnis sofort — es wird nur einmal angezeigt und kann später nicht mehr abgerufen werden.

Das Feld **Max. Lebensdauer des Schlüssels (Tage)** begrenzt, wie lange ein neu ausgestellter Schlüssel gültig sein kann, unabhängig davon, was die Anfrage verlangt. Lassen Sie es leer, wenn es keine Ablaufbegrenzung geben soll. Beachten Sie, dass dieses eine Feld zu den Einstellungen weiter oben gehört und nicht zu dieser Karte: Es wird von der Schaltfläche **Einstellungen speichern** geschrieben, nicht durch das Erstellen eines Schlüssels.

### Einen Schlüssel widerrufen

Klicken Sie auf das Papierkorbsymbol in einer aktiven Zeile, um den Schlüssel zu widerrufen. Widerrufene Schlüssel bleiben zu Audit-Zwecken in der Tabelle, können sich aber nicht mehr authentifizieren.

---

## Tipps

- **Lassen Sie Plaid auf dem Standardmodell, solange Sie keinen Grund für etwas anderes haben.** Den Chat an ein bestimmtes Modell zu heften bedeutet, dass er dem Organisationsstandard nicht mehr folgt — nützlich, wenn Chat und Agenten wirklich verschiedene Modelle brauchen, sonst eher lästig.
- **Chat-Volumen wird leicht unterschätzt.** Die Seite [Nutzung & Kosten](ai-usage.md) bewertet den Chat zu den Tarifen des zugewiesenen Modells; ein ausgelasteter Assistent auf einem teuren Modell fällt dort lange auf, bevor er auf einer Rechnung auffällt.
- **Ein bildfähiges Modell ist eine Anforderung der Agenten, nicht des Chats.** Wenn Ihre Triage-Agenten Ticket-Screenshots lesen sollen, gehört das an *deren* Modell — siehe **Versteht Bilder** auf der Seite [KI-Modelle](ai-models.md).
- **Rotieren Sie MCP-Schlüssel.** Bevorzugen Sie kurzlebige Schlüssel für gemeinsam genutzte Arbeitsplätze und verwenden Sie **Max. Lebensdauer des Schlüssels (Tage)**, um eine Obergrenze durchzusetzen, die keine Anfrage überschreiten kann.
- **Legen Sie ein Aufbewahrungsfenster fest.** Gespräche für immer aufzubewahren ist bequem, bis die Datenbank groß wird oder eine Compliance-Prüfung fragt, wie lange Chat-Inhalte aufbewahrt werden — 90 oder 180 Tage sind ein üblicher Ausgangspunkt.
- **GLPI wird an anderer Stelle konfiguriert.** Die Ticketing-Verbindung, mit der Ihre Agenten arbeiten, wird unter **Administration → Integrationen** konfiguriert, nicht hier — siehe [Integrationen](integrations.md).
