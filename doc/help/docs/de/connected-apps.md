# Verbundene Apps

Die Registerkarte **Verbundene Apps** listet die Anwendungen auf, die Ihre KANAP-Daten in Ihrem Namen lesen können, etwa Claude, Claude Desktop, Claude Code, ChatGPT oder Grok. Hier sehen Sie diese Zugriffe und trennen sie.

## Wo Sie es finden

- Pfad: Klicken Sie auf Ihren Avatar (oben rechts), dann auf **Mein Profil** und dann auf die Registerkarte **Verbundene Apps**
- Route: `/settings/connected-apps`
- Sichtbar, wenn MCP für Ihren Arbeitsbereich eingeschaltet ist und Sie MCP-Zugriff haben (die Rolle **AI MCP User** oder eine Rolle, die sie einschließt)

## Verbundene Anwendungen

Jede Zeile zeigt:

- Den Namen der Anwendung und den Host, zu dem sie zurückkehrt, zum Beispiel *Claude · claude.ai*
- Das Datum, an dem Sie sie verbunden haben
- Datum und Uhrzeit, zu denen sie zuletzt Ihre Daten gelesen hat

Eine Anwendung liest nur, was Sie in KANAP sehen, im Rahmen Ihrer eigenen Zugriffsrechte. Sie kann nichts ändern.

Um einen Zugriff zu trennen, klicken Sie auf **Trennen** und bestätigen Sie. Die Anwendung verliert den Zugriff sofort. Um sie wieder zu nutzen, verbinden Sie sie in der Anwendung erneut. Das Trennen vergisst auch die Wahl **Diese Anwendung merken**, die Sie beim Verbinden getroffen haben.

Wenn Sie keine verbundene Anwendung und keinen API-Schlüssel haben, zeigt die Registerkarte eine Zeile und einen Link zur Anleitung. Wie Sie eine Anwendung verbinden, steht unter [Einen MCP-Client verbinden](ai-settings.md#connecting-an-mcp-client).

## API-Schlüssel

Unter den Verbindungen listet die Registerkarte Ihre eigenen aktiven MCP-API-Schlüssel auf, mit Bezeichnung, Präfix, Erstellungsdatum sowie Datum und Uhrzeit der letzten Verwendung.

Um einen Schlüssel zu stoppen, klicken Sie auf **Widerrufen** und bestätigen Sie. Jeder Client, der den Schlüssel nutzt, verliert den Zugriff sofort, und dies lässt sich nicht rückgängig machen. Ein Administrator erstellt Schlüssel auf der Seite [Plaid-Einstellungen](ai-settings.md#mcp-schlussel-und-verbindungen).
