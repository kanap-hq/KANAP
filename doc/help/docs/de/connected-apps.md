# Verbundene Apps

Die Registerkarte **Verbundene Apps** listet die Anwendungen auf, die Ihre KANAP-Daten in Ihrem Namen lesen können, etwa Claude, Claude Desktop oder Claude Code. Hier sehen Sie diese Zugriffe und trennen sie.

## Wo Sie es finden

- Pfad: Klicken Sie auf Ihren Avatar (oben rechts), dann auf **Mein Profil** und dann auf die Registerkarte **Verbundene Apps**
- Route: `/settings/connected-apps`
- Sichtbar, wenn MCP für Ihren Arbeitsbereich eingeschaltet ist und Sie MCP-Zugriff haben (die Rolle **AI MCP User** oder eine Rolle, die sie einschließt)

## Verbundene Anwendungen

Jede Zeile zeigt:

- Den Namen der Anwendung und den Host, zu dem sie zurückkehrt, zum Beispiel *Claude · claude.ai*
- Das Datum, an dem Sie sie verbunden haben
- Das Datum, an dem sie zuletzt Ihre Daten gelesen hat

Eine Anwendung liest nur, was Sie in KANAP sehen, im Rahmen Ihrer eigenen Zugriffsrechte. Sie kann nichts ändern.

Um einen Zugriff zu trennen, klicken Sie auf **Trennen** und bestätigen Sie. Die Anwendung verliert den Zugriff sofort. Um sie wieder zu nutzen, verbinden Sie sie in der Anwendung erneut. Das Trennen vergisst auch die Wahl **Diese Anwendung merken**, die Sie beim Verbinden getroffen haben.

Wenn nichts verbunden ist, zeigt die Registerkarte eine Zeile und einen Link zur Anleitung. Wie Sie Claude verbinden, steht unter [Einen MCP-Client verbinden](ai-settings.md#einen-mcp-client-verbinden).

## API-Schlüssel

Unter den Verbindungen listet die Registerkarte Ihre eigenen aktiven MCP-API-Schlüssel auf, mit Bezeichnung, Präfix, Erstellungsdatum und letzter Verwendung. Diese Liste ist schreibgeschützt. Ein Administrator erstellt und widerruft Schlüssel auf der Seite [Plaid-Einstellungen](ai-settings.md#mcp-schlussel-und-verbindungen).
