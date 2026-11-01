# Plaid-Einstellungen

Diese Seite steuert den [Plaid-Chat-Assistenten](ai-assistant.md): mit welchem KI-Modell er spricht, ob Chat und MCP-API eingeschaltet sind, wie lange Gespräche aufbewahrt werden und welche Schlüssel und Verbindungen externen MCP-Clients Zugriff auf Ihre Daten gewähren. Es ist ein auf den Chat ausgerichteter Bildschirm. Die Modelle selbst (Anbieter, Schlüssel, Preise) werden einmalig auf der Seite [KI-Modelle](ai-models.md) definiert, und jeder [KI-Agent](agents-workspace.md) wählt sein eigenes Modell auf seiner Registerkarte Einstellungen. Was Sie hier ändern, wirkt sich also nicht darauf aus, wie die Agenten arbeiten.

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

- **Standardmodell (*Name*)**: der Organisationsstandard von der Seite [KI-Modelle](ai-models.md), namentlich genannt, damit Sie sehen, was Sie bekommen. Das ist die erste Option und in aller Regel die richtige: Lassen Sie sie stehen, und Plaid folgt dem Standard, wohin Sie ihn auch verschieben.
- **Inklusives KANAP-Modell**: erscheint anstelle der obigen Option, wenn kein Standard gesetzt ist, im gehosteten Dienst. Plaid läuft dann auf dem Modell, das in Ihrem Abonnement enthalten ist, innerhalb seines monatlichen Nachrichtenkontingents. Ein Administrator bestätigt zuvor den Anbieter und den Ort, an dem er Daten verarbeitet: siehe [Das inklusive KANAP-Modell bestätigen](#das-inklusive-kanap-modell-bestatigen).
- **Kein Modell konfiguriert**: erscheint, wenn es weder einen Standard *noch* ein inklusives Modell gibt, also im On-Premise-Fall. Beachten Sie: Diese Option zeigt weiterhin *Kein Modell konfiguriert* an, bis irgendein Modell als Organisationsstandard mit dem Stern markiert ist, selbst wenn Sie längst mehrere registriert haben: sie beschreibt den Rückfall, nicht Ihre Modellliste.
- **Jedes aktive Modell namentlich**: heftet Plaid an ein bestimmtes Modell, unabhängig vom Standard. Archivierte Modelle werden nicht angeboten.

Es gibt also zwei Wege, den Chat zum Laufen zu bringen: Markieren Sie auf der Seite [KI-Modelle](ai-models.md) einen Standard mit dem Stern und lassen Sie diese Auswahlliste auf der ersten Option stehen, oder wählen Sie hier ein Modell namentlich aus. Das Anheften hier funktioniert unabhängig davon, ob ein Standard existiert.

Der Hinweis darunter verlinkt direkt auf die Seite **KI-Modelle**, aus der jede Option dieser Liste stammt. Anbieter, Endpunkt oder API-Schlüssel tragen Sie hier nicht mehr ein, und einen separaten Multimodal-Schalter gibt es ebenfalls nicht mehr: ob ein Modell Bilder lesen kann, ist eine Eigenschaft des Modells und wird einmalig in dessen Editor festgelegt.

### Das inklusive KANAP-Modell bestätigen

Im gehosteten Dienst bestätigt ein Administrator, welcher Anbieter Ihre Daten erhält, bevor Plaid oder ein Agent das inklusive Modell nutzt. Bis dahin warten beide.

Wenn Plaid oder ein Agent ohne eigenes Modell auf dem inklusiven Modell laufen würde, erscheint in der Karte „Anbieter" eine Statuszeile. Sie nennt den Anbieter und den Ort, an dem er Daten verarbeitet, zum Beispiel *Inklusives KANAP-Modell: Anthropic (Verarbeitungsort: Vereinigte Staaten)*. Daneben steht **Bestätigung erforderlich** oder **Bestätigt**. Unter der Zeile sehen Sie, wer wann bestätigt hat. Nutzen Plaid und alle Ihre Agenten Modelle, die Sie selbst angelegt haben, erscheint die Zeile nicht und es gibt nichts zu bestätigen.

Eine Bestätigung deckt ab, was diese Funktionen an den Anbieter senden: die Fragen, die Benutzer Plaid stellen, die Fragen, an denen Agenten arbeiten, und die KANAP-Daten, die sie zur Antwort lesen.

- **Bestätigen** speichert Ihre Bestätigung. Plaid wird dadurch nicht eingeschaltet.
- **Chat aktivieren** verlangt die Bestätigung, solange sie fehlt. Schalten Sie ihn ein und speichern Sie: Ein Fenster zeigt den Anbieter und den Verarbeitungsort. **Bestätigen und aktivieren** speichert Ihre Änderungen und die Bestätigung gemeinsam. Schließen Sie das Fenster, wird nichts gespeichert. Das Fenster verweist außerdem auf die Seite [KI-Modelle](ai-models.md), falls Sie lieber ein eigenes Modell verwenden.
- Solange die Bestätigung fehlt, zeigt die Seite von Plaid ein Kästchen anstelle des Nachrichtenfelds. Setzt ein Administrator der Plaid-Einstellungen das Häkchen, wird die Bestätigung gespeichert und Plaid eingeschaltet. Siehe [Plaid](ai-assistant.md#included-model-acceptance).
- **Zurückziehen** entfernt die Bestätigung nach einer zweiten Rückfrage. KI-Funktionen, die das inklusive Modell verwenden, stoppen, bis ein Administrator erneut bestätigt. Plaid bleibt eingeschaltet und zeigt seinen Benutzern einen Hinweis.
- Eine erneute Bestätigung wird verlangt, wenn sich der Anbieter, seine Verbindungsadresse, der angezeigte Name oder der Verarbeitungsort ändert. Ein neues Modell desselben Anbieters verlangt sie nicht. Ändert sich der Anbieter, während Ihr Fenster offen ist, zeigt das Fenster den neuen und bittet Sie, ihn zu prüfen.
- Plaid und Agenten, die auf einem von Ihnen angelegten Modell laufen, brauchen keine Bestätigung. Auch über MCP verbundene externe Assistenten hängen nicht davon ab, weil MCP nichts an das inklusive Modell sendet.

In einer On-Premise-Installation gibt es kein inklusives Modell, dieser Abschnitt gilt dort nicht.

### Integrierte Nutzung

Wenn Plaid auf dem Inklusiven KANAP-Modell läuft (keine ausdrückliche Wahl, kein Organisationsstandard), erscheint eine Karte **Integrierte Nutzung** mit:

- Der Anzahl der in diesem Monat verbrauchten Nachrichten im Vergleich zum Limit, mit einem Fortschrittsbalken, der ab drei Vierteln bernsteinfarben und kurz vor dem Limit rot wird
- Dem Datum, an dem das Kontingent zurückgesetzt wird
- Einem Hinweis, dass eigene API-Schlüssel die Obergrenze aufheben

Wie die Karte erläutert, teilen sich der Chat und die Agenten dieses Arbeitsbereichs das Kontingent. Eine Nachricht ist eine Chat-Frage oder ein von einem Agenten geprüftes Ticket. Anfragen externer Assistenten über MCP zählen nicht. Eine ausgelastete Agentenflotte verbraucht es schneller; wenn Sie also diesen Balken beobachten, behalten Sie auch die Seite [Nutzung & Kosten](ai-usage.md) im Auge.

### Status-Chips

Der Header der Anbieter-Karte zeigt drei Indikatoren auf einen Blick:

- **Chat aktiviert / Chat deaktiviert**: der Hauptschalter für den Endbenutzer-Chat
- **MCP aktiviert / MCP deaktiviert**: ob externe MCP-Clients eine Verbindung herstellen können
- **Anbieter bereit / Anbieter unvollständig**: ob das Modell, auf das Plaid auflöst, tatsächlich nutzbar ist. Solange nur die Bestätigung des inklusiven Modells fehlt, ist dieser Indikator ausgeblendet und die Statuszeile oben tritt an seine Stelle.

Fehlt etwas, listet **Aktuelle Validierungsfehler des Anbieters** es über dem Formular auf: ein unvollständiges Modell oder gar kein Modell. Behoben wird das in der Regel auf der Seite [KI-Modelle](ai-models.md) und nicht hier.

---

## Funktionen

Der Bereich **Funktionen** schaltet die optionalen KI-Oberflächen um:

- **Chat aktivieren**: schaltet den In-App-Chat-Arbeitsbereich für Endbenutzer ein oder aus. Er lässt sich nicht einschalten, solange der Header **Anbieter unvollständig** meldet: Das Speichern wird mit den aufgeführten Gründen abgelehnt, und Sie beheben sie zuerst auf der Seite [KI-Modelle](ai-models.md). Eine fehlende Bestätigung des inklusiven Modells ist die Ausnahme: Dann öffnet das Speichern das Bestätigungsfenster. Dieselbe Prüfung läuft bei jedem Speichern, solange der Chat bereits aktiv ist: Ein Modell, das später unvollständig wird, blockiert also auch unabhängige Änderungen auf dieser Seite, bis die Sache geklärt ist.
- **MCP aktivieren**: schaltet die MCP-API für externe Clients ein oder aus. Sie wartet nicht auf die Bestätigung des inklusiven Modells. MCP-Anfragen zählen nicht zum monatlichen Kontingent.
- **Websuche**: ermöglicht es dem Plaid-Chat-Assistenten, das Web zu durchsuchen. Dafür muss der Websuche-Schlüssel auf Instanzebene konfiguriert sein; ohne ihn ist der Schalter deaktiviert und ein Tooltip erklärt den Grund. Beim Aktivieren wird automatisch ein Konnektivitätstest ausgeführt und das Ergebnis gemeldet. Dieser Schalter gilt **nur für den Chat-Assistenten**: KI-Agenten haben ihre eigene, unabhängige Websuche-Einstellung auf der [Registerkarte Einstellungen](agents-workspace.md) jedes Agenten, die auf derselben Konfiguration auf Instanzebene beruht.

---

## Aufbewahrung

- **Aufbewahrung von Gesprächen (Tage)**: Chat-Gespräche und ihre Nachrichten, die älter als dieser Wert sind, kommen für die automatische Bereinigung infrage. Lassen Sie das Feld leer, um sie unbegrenzt aufzubewahren.

Änderungen unter **Anbieter**, **Funktionen**, **Aufbewahrung** *und* im weiter unten stehenden Feld **Max. Lebensdauer des Schlüssels (Tage)** werden alle von der einen Schaltfläche **Einstellungen speichern** am Fuß dieser Karte übernommen. Nichts auf dieser Seite speichert von selbst.

---

## MCP-Schlüssel und -Verbindungen

Externe Assistenten und IDEs greifen über das Model Context Protocol (MCP) auf KANAP zu, mit denselben Daten, die Plaid sieht. Sie verbinden sich auf eine von zwei Arten:

- **Verbindung** (OAuth): Claude, Claude Desktop, Claude Code, ChatGPT und Grok melden sich mit dem eigenen Konto des Benutzers bei KANAP an. Niemand erstellt oder kopiert einen Schlüssel. Siehe [Einen MCP-Client verbinden](#connecting-an-mcp-client).
- **API-Schlüssel**: ein langlebiger Schlüssel für Cursor, Skripte und jeden anderen MCP-Client, der einen Header senden kann.

### Verbindung oder API-Schlüssel { #connection-or-api-key }

| | Verbindung (OAuth) | API-Schlüssel |
|---|---|---|
| Für | Jede Person, die einen KI-Assistenten mit ihrem eigenen KANAP-Konto verwendet | Ein Skript, ein gemeinsam genutztes Werkzeug oder einen Client, der sich nicht anmelden kann |
| Clients | Claude (claude.ai), Claude Desktop, Claude Code, ChatGPT, Grok | Claude Code, Cursor, Skripte, jeder MCP-Client, der einen Header `Authorization` oder `X-API-Key` senden kann |
| Einrichtung | Serveradresse im Client einfügen, bei KANAP anmelden, auf **Zulassen** klicken | Eine Person, die diese Seite öffnen kann, erstellt einen Schlüssel; das Geheimnis wird in den Client eingefügt |
| Liest mit | den Zugriffsrechten der angemeldeten Person | den Zugriffsrechten der Person, die den Schlüssel erstellt hat |
| Lebensdauer | 90 Tage lang still erneuert, oder kürzer, wenn **Max. Lebensdauer des Schlüssels (Tage)** kürzer ist. Danach verbindet sich der Benutzer erneut | Bis zum Widerruf oder bis **Max. Lebensdauer des Schlüssels (Tage)** |
| Netzwerk | HTTPS. Claude, Claude Desktop, ChatGPT und Grok: KANAP aus dem Internet erreichbar. Jeder Client: KANAP erreicht den Host des Clients über HTTPS (`claude.ai`, `chatgpt.com` oder `grok.com`) | Der Client erreicht KANAP. Funktioniert in einem privaten Netz, auch über einfaches HTTP |
| Grenzen | Nur Clients, die ein Client-Metadatendokument veröffentlichen: Claude, ChatGPT und Grok | Von benutzerdefinierten Konnektoren in Claude und Claude Desktop nicht akzeptiert. Ein Geheimnis, das sicher aufbewahrt, rotiert und widerrufen werden muss |

Beim gehosteten Dienst ist KANAP bereits über HTTPS aus dem Internet erreichbar: Verbindungen funktionieren ohne weitere Einrichtung. Bei einer On-Premise-Installation steht unter [KI-Assistenten über MCP verbinden](on-premise/configuration.md#connecting-ai-assistants-over-mcp), was geöffnet werden muss.

Beide Wege teilen den Rest:

- **MCP aktivieren** muss eingeschaltet sein (siehe **Funktionen** oben).
- Dieselben schreibgeschützten [Werkzeuge](#verfugbare-werkzeuge), im Rahmen der Zugriffsrechte der Person hinter dem Schlüssel oder der Verbindung.
- Eine Grenze von 60 MCP-Anfragen pro Minute für jeden Schlüssel und jede Verbindung. Darüber hinaus werden Anfragen mit einem `Retry-After`-Header abgelehnt, der die Wartezeit in Sekunden angibt.
- Dasselbe [MCP-Protokoll](#mcp-journal).

Die Karte **MCP-Schlüssel und -Verbindungen** zeigt eine Schaltfläche **Schlüssel erstellen**, die **Serveradresse**, mit der sich Clients verbinden (mit einer Kopierschaltfläche), die Obergrenze **Max. Lebensdauer des Schlüssels (Tage)** und eine Tabelle mit **Bezeichnung**, **Typ**, **Person**, **Erstellt**, **Läuft ab**, **Zuletzt verwendet** und **Status** (**Aktiv** oder **Widerrufen**).

Die Spalte **Typ** zeigt **API-Schlüssel** oder **Verbindung**. Eine Verbindungszeile zeigt den Namen der Anwendung und den Host, zu dem sie zurückkehrt, zum Beispiel *Claude · claude.ai*. Ein API-Schlüssel zeigt sein Präfix neben seiner Bezeichnung, zum Beispiel *Laptop · abcd1234*. **Person** nennt, wer den Schlüssel erstellt oder die Verbindung genehmigt hat.

### Einen Schlüssel erstellen

Schlüssel werden nur auf dieser Seite erstellt, also erstellen sie nur Personen, die diese Seite öffnen können (`ai_settings:admin`, mit MCP-Zugriff). Ein Schlüssel liest mit den Zugriffsrechten der Person, die ihn erstellt hat: Ein von einem Administrator erstellter Schlüssel liest alles, was ein Administrator sieht. Behandeln Sie ihn wie das Passwort dieser Person, und bevorzugen Sie eine Verbindung, wenn sich jeder Benutzer anmelden kann.

1. Klicken Sie auf **Schlüssel erstellen**.
2. Geben Sie eine beschreibende **Bezeichnung** ein (zum Beispiel „Cursor auf meinem Laptop“).
3. Klicken Sie auf **Erstellen**. KANAP generiert ein einmaliges Geheimnis, das mit `kanap_mcp_` beginnt.
4. Kopieren Sie das Geheimnis sofort. Es wird nur einmal angezeigt und kann später nicht mehr abgerufen werden.
5. Wenn Sie Claude Code mit einem Schlüssel verwenden, kopieren Sie den **Claude-Code-Befehl** unter dem Schlüssel. Er enthält bereits die Serveradresse und den Schlüssel.

Das Feld **Max. Lebensdauer des Schlüssels (Tage)** begrenzt, wie lange ein neu ausgestellter Schlüssel gültig sein kann, unabhängig davon, was die Anfrage verlangt. Es begrenzt auch, wie lange eine Verbindung besteht. Lassen Sie es leer, wenn es keine Ablaufbegrenzung geben soll. Dieses Feld gehört zu den Einstellungen weiter oben und nicht zu dieser Karte: Es wird von der Schaltfläche **Einstellungen speichern** geschrieben, nicht durch das Erstellen eines Schlüssels.

### Einen Schlüssel oder eine Verbindung widerrufen

Klicken Sie auf die Schaltfläche **Widerrufen** (ein durchgestrichener Schlüssel, bei einer Verbindung ein unterbrochener Link) am Ende einer aktiven Zeile und bestätigen Sie. Der Dialog nennt den Schlüssel oder die Anwendung. Ein widerrufener Schlüssel funktioniert sofort nicht mehr. Eine widerrufene Verbindung trennt die Anwendung sofort, und der Benutzer muss sie erneut verbinden. Widerrufene Zeilen bleiben zu Audit-Zwecken in der Tabelle. Eine bereits widerrufene Zeile erneut zu widerrufen ändert nichts: Sie behält ihr erstes Widerrufsdatum.

Benutzer können auch ihre eigenen Schlüssel widerrufen und ihre eigenen Anwendungen auf ihrer Registerkarte [Verbundene Apps](connected-apps.md) trennen.

### Wer sich verbinden kann

- **MCP aktivieren** muss eingeschaltet sein (siehe **Funktionen** oben).
- Der Benutzer braucht die Rolle **AI MCP User** oder eine Rolle, die Lesezugriff auf MCP gewährt.
- Der Zugriff ist schreibgeschützt. Ein Client sieht genau das, was der Benutzer in KANAP sieht, und nicht mehr. Bei einem Schlüssel ist dieser Benutzer die Person, die ihn erstellt hat.

### Einen MCP-Client verbinden { #connecting-an-mcp-client }

Jeder Client braucht die **Serveradresse**: Ihre KANAP-Adresse, gefolgt von `/api/ai/mcp`, zum Beispiel `https://acme.kanap.net/api/ai/mcp`. Die Karte **MCP-Schlüssel und -Verbindungen** auf dieser Seite zeigt sie an, mit einer Kopierschaltfläche. Benutzer, die diese Seite nicht öffnen können, nehmen die Adresse von KANAP in ihrem Browser und hängen `/api/ai/mcp` an.

Jeder Schlüssel und jede verbundene Anwendung akzeptiert bis zu 60 Anfragen pro Minute. Darüber hinaus lehnt der Server die Anfrage ab, und der Client kann es eine Minute später erneut versuchen.

#### Claude und Claude Desktop { #connecting-claude }

1. Fügen Sie KANAP als benutzerdefinierten Konnektor hinzu: Öffnen Sie in Claude **Settings > Connectors** und klicken Sie auf **Add custom connector**.
2. Fügen Sie die Serveradresse ein. Wenn Claude fragt, wie die Anmeldung erfolgen soll, wählen Sie **Sign in now** und **Use Claude's published identity**. **Register automatically** funktioniert mit KANAP nicht, und es werden weder Client-ID noch Client-Geheimnis benötigt.
3. Bestätigen Sie. Claude öffnet die KANAP-Anmeldeseite. Melden Sie sich mit Ihrem Passwort oder mit Microsoft an.
4. KANAP zeigt *Claude möchte Ihre KANAP-Daten lesen*. Der Bildschirm nennt, was Claude tun kann (lesen, was Sie sehen, im Rahmen Ihrer eigenen Zugriffsrechte), den Host, zu dem Claude zurückkehrt, sowie das Konto und den Arbeitsbereich, mit denen Sie angemeldet sind. Wenn das Konto nicht Ihres ist, klicken Sie auf **Nicht Sie?**, um sich mit einem anderen anzumelden.
5. Klicken Sie auf **Zulassen**. Claude ist verbunden. **Ablehnen** schließt die Anfrage, und es wird nichts verbunden.

Claude Desktop verwendet dieselben Konnektoren wie claude.ai: Fügen Sie den Konnektor in einem der beiden hinzu. Claude ruft KANAP von den Servern von Anthropic aus auf, daher muss die Serveradresse über HTTPS aus dem Internet erreichbar sein.

Bei einer selbst gehosteten Installation kann ein Administrator einen Link teilen, der den Dialog **Add custom connector** mit bereits ausgefülltem Namen und ausgefüllter Adresse öffnet. Ersetzen Sie das Ende durch Ihre eigene Serveradresse, URL-kodiert (`:` wird zu `%3A`, `/` wird zu `%2F`):

```text
https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=KANAP&connectorUrl=https%3A%2F%2Fkanap.example.com%2Fapi%2Fai%2Fmcp
```

#### Claude Team und Enterprise

Ein Owner der Organisation fügt den benutzerdefinierten Konnektor einmal mit der Serveradresse für die gesamte Claude-Organisation hinzu. Jedes Mitglied klickt dann beim Konnektor auf **Connect** und meldet sich mit seinem eigenen KANAP-Konto an. Jedes Mitglied sieht nur seine eigenen KANAP-Daten.

#### Claude Code

Fügen Sie den Server ohne Schlüssel hinzu:

```bash
claude mcp add --transport http kanap https://acme.kanap.net/api/ai/mcp
```

Führen Sie dann `claude mcp login kanap` aus, oder verwenden Sie den Server einfach: Claude Code öffnet Ihren Browser auf der KANAP-Anmeldeseite und dann auf demselben Bildschirm wie oben. Der Browser kehrt zu Ihrem eigenen Computer zurück, daher muss KANAP nicht aus dem Internet erreichbar sein: Ihr Computer erreicht KANAP über HTTPS, und KANAP erreicht `claude.ai` über HTTPS.

#### ChatGPT und Grok { #connecting-chatgpt-grok }

ChatGPT und Grok verbinden sich auf dieselbe Weise wie Claude.

1. Fügen Sie KANAP als benutzerdefinierten MCP-Server mit der Serveradresse hinzu:
    - **ChatGPT**: Fügen Sie einen benutzerdefinierten MCP-Server oder eine benutzerdefinierte App hinzu. Das Menü hängt von Ihrem Tarif und Ihrem Arbeitsbereich ab, und ein Administrator des Arbeitsbereichs muss es unter Umständen zuerst erlauben. Siehe [Developer mode and MCP apps in ChatGPT](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt).
    - **Grok**: Öffnen Sie `grok.com/connectors`, klicken Sie auf **New Connector** und dann auf **Custom**. Bei Grok Business und Enterprise fügt zuerst ein Teamadministrator den Konnektor in der xAI-Konsole hinzu. Siehe [Grok connectors](https://docs.x.ai/grok/connectors).
2. Melden Sie sich mit Ihrem Passwort oder mit Microsoft bei KANAP an.
3. KANAP zeigt denselben Bildschirm wie für Claude, mit dem Namen der Anwendung und dem Host, zu dem sie zurückkehrt (`chatgpt.com`, `grok.com` oder `console.x.ai`).
4. Klicken Sie auf **Zulassen**.

ChatGPT und Grok rufen KANAP von ihren eigenen Servern aus auf, daher muss die Serveradresse über HTTPS aus dem Internet erreichbar sein. KANAP liest außerdem die öffentliche Beschreibung jeder Anwendung über HTTPS von `chatgpt.com` oder `grok.com`.

#### Diese Anwendung merken

Das Kästchen **Diese Anwendung merken** ist standardmäßig angehakt. Bleibt es angehakt, geht die nächste Verbindung derselben Anwendung durch denselben Benutzer schneller:

- Claude Code, das zu Ihrem eigenen Computer zurückkehrt, wird ohne Bildschirm zugelassen.
- Claude, Claude Desktop, ChatGPT und Grok zeigen einen kurzen Bildschirm mit einer einzigen Schaltfläche **Weiter**.

Entfernen Sie das Häkchen, um jedes Mal den vollständigen Bildschirm zu sehen. Wenn Sie die Anwendung trennen, wird die Wahl vergessen.

Eine Verbindung bleibt bis zu 90 Tage von selbst angemeldet, oder kürzer, wenn **Max. Lebensdauer des Schlüssels (Tage)** kürzer ist. Danach verbindet sich der Benutzer erneut.

#### Cursor, Skripte und andere Clients

Diese Clients verwenden einen API-Schlüssel (siehe [Einen Schlüssel erstellen](#einen-schlussel-erstellen)). Der Schlüssel wird im Header `Authorization: Bearer kanap_mcp_...` jeder Anfrage gesendet. Clients, die diesen Header nicht setzen können, verwenden stattdessen `X-API-Key: kanap_mcp_...`. Der Schlüssel muss aktiv und nicht abgelaufen sein.

Fügen Sie in Cursor einen Remote-Server (HTTP) in `mcp.json` hinzu:

```json
{
  "mcpServers": {
    "kanap": {
      "url": "https://acme.kanap.net/api/ai/mcp",
      "headers": { "Authorization": "Bearer kanap_mcp_..." }
    }
  }
}
```

Claude Code akzeptiert auch einen Schlüssel, zum Beispiel auf einem Rechner ohne Browser oder wenn KANAP `claude.ai` nicht erreichen kann:

```bash
claude mcp add --transport http kanap https://acme.kanap.net/api/ai/mcp --header "Authorization: Bearer kanap_mcp_..."
```

### Verfügbare Werkzeuge

Der MCP-Server ist schreibgeschützt. Ein Client kann Ihre Daten durchsuchen und lesen, aber nichts ändern. Ein Schlüssel oder eine Verbindung erhält die vierzehn Werkzeuge unten, und fünfzehn, wenn die Websuche für Ihre Organisation eingeschaltet ist. Eine Person sieht nur die Werkzeuge für die Daten, die ihre Rolle sie lesen lässt.

| Werkzeug | Funktion |
|---|---|
| `search_all` | Durchsucht alle Arten von Datensätzen nach Stichwort |
| `describe_entity_filters` | Listet die Filter auf, die für eine Art von Datensatz verfügbar sind |
| `query_entities` | Listet Datensätze auf, die zu Filtern passen |
| `aggregate_entities` | Zählt oder summiert Datensätze, gruppiert nach einem Feld |
| `get_filter_values` | Listet die möglichen Werte eines Filters auf |
| `get_application_classification_catalog` | Liest die Klassifizierungsstufen der Anwendungen: Kritikalität, maximal tolerierbare Ausfallzeit, Wiederherstellungswellen |
| `get_entity_detail` | Liest einen Datensatz vollständig |
| `get_entity_context` | Liest die mit einem Datensatz verknüpften Datensätze |
| `get_entity_comments` | Liest die Kommentare eines Projekts oder einer Aufgabe |
| `get_record_history` | Liest den Verlauf eines Datensatzes, wie ihn sein Tab Verlauf zeigt |
| `search_knowledge` | Durchsucht die Wissensdatenbank |
| `get_document` | Liest ein Dokument der Wissensdatenbank |
| `list_help_topics` | Listet die Seiten und Abschnitte des Benutzerhandbuchs auf |
| `read_help_section` | Liest eine Seite oder einen Abschnitt des Benutzerhandbuchs, mit seinem Link |
| `web_search` | Sucht im Web, wenn die Websuche für Ihre Organisation eingeschaltet ist |

Wenn sich ein Client verbindet, teilt der Server ihm mit, welchen Arbeitsbereich er liest, dass er nur liest, dass er mit den Rechten der Person hinter dem Schlüssel oder der Verbindung liest, wie er sucht (Kostenstellen, Kalender und Dimensionen eingeschlossen), wo er die Wechselkurse liest und welche Daten er nicht liest (das Audit-Protokoll und KI-Agenten). Rollen und Einstellungen des Datenzugriffs liest er nur für eine Person, die Benutzer verwaltet und Zugriff auf alle Daten hat. Außerdem weist er den Client an, Fragen zur Bedienung von KANAP anhand des Benutzerhandbuchs zu beantworten.

Ein Aufruf, den der Server ablehnt, kommt mit seiner Ursache zurück, damit der Assistent sie erklären kann: ein unbekanntes Werkzeug, ein Werkzeug, das Daten ändern würde, ein Werkzeug, das der Schlüssel nicht erlaubt, oder Daten, die die Person nicht lesen darf.

## MCP-Protokoll { #mcp-journal }

Die Karte **MCP-Protokoll** listet jeden Werkzeugaufruf der MCP-Clients Ihrer Organisation auf, die neuesten zuerst:

- **Datum**
- **Person**: der Eigentümer des Schlüssels oder der Verbindung
- **Schlüssel oder Verbindung**: der Name des Schlüssels, bei einer Verbindung die Anwendung und ihre Domain (*Claude · claude.ai*). *Gelöschter Schlüssel*, wenn der Schlüssel nicht mehr existiert
- **Tool**
- **Ergebnis**: **Erfolgreich**, **Abgelehnt** oder **Fehlgeschlagen**, mit der Ursache neben einer Ablehnung oder einem Fehler (zum Beispiel *Der Server ist schreibgeschützt*, *Der Schlüssel erlaubt dieses Tool nicht*, *Widerrufener Schlüssel*)
- **Dauer**: ein Strich, wenn sie unbekannt ist

Filtern Sie die Liste nach **Person**, **Schlüssel oder Verbindung**, **Ergebnis** und **Zeitraum** (letzte 24 Stunden, letzte 7 Tage, letzte 30 Tage oder gesamter Zeitraum). Sie zeigt 25 Aufrufe pro Seite. Mit **Zurück** und **Weiter** wechseln Sie zwischen den Seiten.

Klicken Sie auf eine Zeile, um die Argumente des Aufrufs zu sehen, gekürzt, und bei einer Ablehnung oder einem Fehler die vollständige Ursache. Geheime Werte erscheinen als *Ausgeblendet*.

Das Protokoll erfasst auch Aufrufe mit einem widerrufenen oder abgelaufenen Schlüssel. Es speichert nie einen Schlüssel oder ein Token.

---

## Tipps

- **Lassen Sie Plaid auf dem Standardmodell, solange Sie keinen Grund für etwas anderes haben.** Den Chat an ein bestimmtes Modell zu heften bedeutet, dass er dem Organisationsstandard nicht mehr folgt: nützlich, wenn Chat und Agenten wirklich verschiedene Modelle brauchen, sonst eher lästig.
- **Chat-Volumen wird leicht unterschätzt.** Die Seite [Nutzung & Kosten](ai-usage.md) bewertet jede Chat-Nachricht zu den mit ihr gespeicherten Tarifen; ein ausgelasteter Assistent auf einem teuren Modell fällt dort lange auf, bevor er auf einer Rechnung auffällt.
- **Ein bildfähiges Modell ist eine Anforderung der Agenten, nicht des Chats.** Wenn Ihre Triage-Agenten Ticket-Screenshots lesen sollen, gehört das an *deren* Modell: siehe **Versteht Bilder** auf der Seite [KI-Modelle](ai-models.md).
- **Bevorzugen Sie Verbindungen für Claude.** Jede Person meldet sich mit ihrem eigenen Konto an und liest mit ihren eigenen Zugriffsrechten, sodass niemand einen Schlüssel teilt. Behalten Sie Schlüssel für Clients, die einen brauchen, rotieren Sie sie und verwenden Sie **Max. Lebensdauer des Schlüssels (Tage)**, um eine Obergrenze durchzusetzen, die keine Anfrage überschreiten kann.
- **Legen Sie ein Aufbewahrungsfenster fest.** Gespräche für immer aufzubewahren ist bequem, bis die Datenbank groß wird oder eine Compliance-Prüfung fragt, wie lange Chat-Inhalte aufbewahrt werden: 90 oder 180 Tage sind ein üblicher Ausgangspunkt.
- **GLPI wird an anderer Stelle konfiguriert.** Die Ticketing-Verbindung, mit der Ihre Agenten arbeiten, wird unter **Administration → Integrationen** konfiguriert, nicht hier. Siehe [Integrationen](integrations.md).
