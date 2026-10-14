# Connected apps

The **Connected apps** tab lists the applications that can read your KANAP data on your behalf, such as Claude, Claude Desktop or Claude Code. It is where you see these accesses and cut them.

## Where to find it

- Path: click your avatar (top right), then **My profile**, then the **Connected apps** tab
- Route: `/settings/connected-apps`
- Shown when MCP is switched on for your workspace and you have MCP access (the **AI MCP User** role, or a role that includes it)

## Connected applications

Each row shows:

- The name of the application and the host it returns to, for example *Claude · claude.ai*
- The date you connected it
- The date it last read your data

An application reads only what you can see in KANAP, within your own access rights. It cannot change anything.

To cut an access, click **Disconnect** and confirm. The application loses access at once. To use it again, connect it again from the application. Disconnecting also forgets the **Remember this application** choice you made when you connected it.

When nothing is connected, the tab shows one line and a link to the instructions. To connect Claude, see [Connecting an MCP client](ai-settings.md#connecting-an-mcp-client).

## API keys

Under the connections, the tab lists your own active MCP API keys, with their label, prefix, creation date and last use. This list is read only. An administrator creates and revokes keys on the [Plaid Settings](ai-settings.md#mcp-keys-and-connections) page.
