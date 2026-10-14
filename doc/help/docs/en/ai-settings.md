# Plaid Settings

This page controls the [Plaid chat assistant](ai-assistant.md): which AI model it talks to, whether chat and the MCP API are switched on, how long conversations are kept, and which keys and connections let external MCP clients reach your data. It is a chat-focused screen. The models themselves (providers, keys, prices) are defined once on the [AI models](ai-models.md) page, and each [AI agent](agents-workspace.md) picks its own model on its Settings tab, so nothing you change here alters how the agents run.

## Where to find it

- Workspace: **Admin**
- Path: **Admin → Artificial intelligence → Plaid**
- Route: `/admin/ai`
- Permission: `ai_settings:admin`
- Feature flag: requires the AI settings surface to be enabled. When it is off, the page shows a notice ("AI settings are disabled for this instance") and no controls are available.

---

## Provider

### Model used by Plaid

A single selector decides which model answers chat questions:

- **Default model (*name*)** — the organization default from the [AI models](ai-models.md) page, named so you can see what you are getting. This is the first option and the usual answer: leave it here and Plaid follows the default wherever you move it.
- **KANAP included model**: shown in place of the above when no default is set, on the hosted service. Plaid then runs on the model included in your subscription, within its monthly message allowance. An administrator first confirms the provider and where it processes data: see [Confirming the KANAP included model](#confirming-the-kanap-included-model).
- **No model configured** — shown when there is no default *and* no included model, which is the on-premise case. Note that this option keeps saying *No model configured* until some model is starred as the organization default, even if you have already registered several — it describes the fallback, not your registry.
- **Any active model by name** — pin Plaid to one specific model, independent of the default. Archived models are not offered.

So there are two ways to get chat working: star a default on the [AI models](ai-models.md) page and leave this selector on the first option, or pick a model here by name. Pinning one here works whether or not a default exists.

The hint underneath links straight to the **AI models page**, which is where every option in the list comes from. There is no provider, endpoint, or API key to fill in here any more, and no separate multimodal switch — whether the model can read images is a property of the model, set once in its editor.

### Confirming the KANAP included model

On the hosted service, an administrator confirms which provider receives your data before Plaid or an agent uses the included model. Until then, they wait.

When Plaid, or an agent without a model of its own, would run on the included model, a status line appears in the Provider card. It names the provider and the place where it processes data, for example *KANAP included model: Anthropic (processing location: United States)*. **Needs confirmation** or **Confirmed** sits beside it. Under the line you see who confirmed and when. If Plaid and all your agents use models you added, the line is not shown and there is nothing to confirm.

A confirmation covers what these features send to the provider: the questions people ask Plaid, the questions agents work on, and the KANAP data they read to answer.

- **Confirm** records your confirmation. It does not switch Plaid on.
- **Enable chat** asks for the confirmation when it is still missing. Switch it on and save: a window shows the provider and the processing location. **Confirm and turn on** saves your changes and the confirmation together. If you close the window, nothing is saved. The window also links to the [AI models](ai-models.md) page, in case you prefer to use your own model.
- **Withdraw** removes the confirmation, after a second confirmation. AI features that use the included model stop until an administrator confirms again. Plaid stays switched on and shows a notice to its users.
- You are asked again when the provider, its connection address, the name shown or the processing location changes. A new model from the same provider does not ask again. If the provider changes while your window is open, the window shows the new one and asks you to review it.
- Plaid and agents that run on a model you added need no confirmation. External assistants connected over MCP do not depend on it either, because MCP sends nothing to the included model.

On an on-premise installation there is no included model, so this section does not apply.

### Built-in usage

When Plaid is running on the KANAP included model — no explicit choice, no organization default — a **Built-in usage** card appears with:

- How many **messages used this month** against the limit, with a progress bar that turns amber past three-quarters and red near the top
- The date the allowance **resets**
- A reminder that using your own API keys removes the cap

As the card says, chat and the agents of this tenant share the allowance. One message is one chat question or one ticket reviewed by an agent. Requests from external assistants over MCP do not count. A busy agent fleet consumes it faster, so if you are watching this bar, watch the [Usage & costs](ai-usage.md) page too.

### Status chips

The header of the Provider card shows three at-a-glance indicators:

- **Chat enabled / Chat disabled** — the master switch for end-user chat
- **MCP enabled / MCP disabled** — whether external MCP clients can connect
- **Provider ready / Provider incomplete**: whether the model Plaid resolves to is actually usable. While the only thing missing is the confirmation of the included model, this chip is hidden and the status line above stands in for it.

When something is missing, **Current provider validation errors** lists it above the form — an incomplete model, or no model at all. The fix is normally on the [AI models](ai-models.md) page rather than here.

---

## Features

The **Features** section toggles the optional AI surfaces:

- **Enable chat**: turns the in-app chat workspace on or off for end users. It cannot be switched on while the header says **Provider incomplete**: the save is refused with the reasons listed, and you fix them on the [AI models](ai-models.md) page first. A missing confirmation of the included model is the exception: the save opens the confirmation window instead. The same check runs on every save while chat is already on, so a model that becomes incomplete later will block unrelated changes on this page until it is sorted out.
- **Enable MCP**: turns the MCP API on or off for external clients. It does not wait for the confirmation of the included model. MCP requests do not count against the included monthly allowance.
- **Web search** — lets the Plaid chat assistant search the web. It requires the instance-level web-search key to be configured; without it, the toggle is disabled and a tooltip explains why. Switching it on automatically runs a connectivity test and reports the result. This toggle applies to the **chat assistant only** — AI agents have their own, independent web-search setting on each agent's [Settings tab](agents-workspace.md), which relies on the same instance-level configuration.

---

## Retention

- **Conversation retention (days)** — chat conversations and their messages older than this value become eligible for automatic cleanup. Leave it empty to keep them indefinitely.

Changes in **Provider**, **Features**, **Retention** *and* the **Key max lifetime (days)** field further down are all applied by the single **Save settings** button at the bottom of this card. Nothing on this page saves by itself.

---

## MCP keys and connections

External assistants and IDEs reach KANAP through the Model Context Protocol (MCP), with the same data Plaid sees. They connect in one of two ways:

- **Connection**: Claude, Claude Desktop and Claude Code sign in to KANAP with the user's own account. Nobody creates or copies a key. See [Connecting an MCP client](#connecting-an-mcp-client).
- **API key**: a long-lived key for Cursor, scripts and other MCP clients.

The **MCP keys and connections** card shows a **Create key** button, the **Server address** that clients connect to (with a copy button), the **Key max lifetime (days)** cap, and a table with **Label**, **Type**, **Prefix**, **Created**, **Expires**, **Last used** and **Status** (**Active** or **Revoked**).

The **Type** column says **API key** or **Connection**. A connection row shows the name of the application and the host it returns to, for example *Claude · claude.ai*. Connections have no prefix.

### Creating a key

1. Click **Create key**.
2. Enter a descriptive **Label** (for example, "Cursor on my laptop").
3. Click **Create**. KANAP generates a one-time secret.
4. Copy the secret immediately. It is shown once and cannot be retrieved later.
5. Copy the **Claude Code command** shown under the key if you use Claude Code with a key. It already contains the server address and the key.

The **Key max lifetime (days)** field caps how long any newly issued key can live, regardless of what the request asks for. It also caps how long a connection lasts. Leave it empty for no expiration limit. This field belongs to the settings above rather than to this card: it is written by the **Save settings** button, not by creating a key.

### Revoking a key or a connection

Click the trash icon on any active row. A revoked key stops working at once. A revoked connection cuts the application off at once, and the user has to connect it again. Revoked rows stay in the table for audit purposes.

Users can also disconnect their own applications on their [Connected apps](connected-apps.md) tab.

### Who can connect

- **Enable MCP** must be on (see **Features** above).
- The user needs the **AI MCP User** role, or any role that gives read access to MCP.
- Access is read only. A client sees exactly what the user sees in KANAP, and nothing more. For a key, that is the person who created it: create keys from an account whose access matches what the client should read.
- Connections and keys share the same rate limits, the same audit trail and, on the KANAP included model, the same monthly allowance.

### Connecting an MCP client

Every client needs the **Server address**: your KANAP address followed by `/api/ai/mcp`, for example `https://acme.kanap.net/api/ai/mcp`. The **MCP keys and connections** card shows it for your organization.

Each key or connected application accepts up to 60 requests a minute. Past that, the server refuses the request and the client can retry a minute later.

#### Claude and Claude Desktop

1. In Claude, open **Settings > Connectors** and click **Add custom connector**.
2. Paste the server address and confirm.
3. Claude opens the KANAP sign-in page. Sign in with your password or with Microsoft.
4. KANAP shows *Claude wants to read your KANAP data*. The screen lists what Claude can do (read what you can see, within your own access rights), the host it returns to, and the account and workspace you are signed in with. If the account is not yours, click **Not you?** to sign in with another one.
5. Click **Allow**. Claude is connected. **Refuse** closes the request and nothing is connected.

Claude Desktop uses the same connectors as claude.ai: add the connector in either one.

#### Claude Team and Enterprise

An organization Owner adds the custom connector once, with the server address, for the whole Claude organization. Each member then clicks **Connect** on the connector and signs in with their own KANAP account. Every member sees only their own KANAP data.

#### Claude Code

Add the server without a key:

```bash
claude mcp add --transport http kanap https://acme.kanap.net/api/ai/mcp
```

Then run `claude mcp login kanap`, or just use the server: Claude Code opens your browser on the KANAP sign-in page, then on the same screen as above.

#### Remember this application

The **Remember this application** box is ticked by default. When it stays ticked, the next connection of the same application by the same user is quicker:

- Claude Code, which returns to your own computer, is approved without any screen.
- Claude and Claude Desktop show a short screen with a single **Continue** button.

Untick the box to see the full screen every time. Disconnecting the application forgets the choice.

A connection stays signed in by itself for up to 90 days, or less when **Key max lifetime (days)** is shorter. After that, the user connects again.

#### Cursor, scripts and other clients

These clients use an API key (see [Creating a key](#creating-a-key)). The key goes in the header `Authorization: Bearer kanap_mcp_...` of every request. Clients that cannot set this header can use `X-API-Key: kanap_mcp_...` instead. The key must be active and not expired.

In Cursor, add a remote (HTTP) server in `mcp.json`:

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

Claude Code also accepts a key, for example on a machine with no browser:

```bash
claude mcp add --transport http kanap https://acme.kanap.net/api/ai/mcp --header "Authorization: Bearer kanap_mcp_..."
```

#### Available tools

The MCP server is read only. A client can search and read your data but cannot change anything.

| Tool | What it does |
|---|---|
| `search_all` | Searches every kind of record by keyword |
| `describe_entity_filters` | Lists the filters available for a kind of record |
| `query_entities` | Lists records that match filters |
| `aggregate_entities` | Counts or totals records, grouped by a field |
| `get_filter_values` | Lists the possible values of a filter |
| `get_entity_detail` | Reads one record in full |
| `get_entity_context` | Reads the records linked to one record |
| `get_entity_comments` | Reads the comments of one project or task |
| `search_knowledge` | Searches the knowledge base |
| `get_document` | Reads one knowledge document |
| `web_search` | Searches the web, when web search is switched on for your organization |

---

## Tips

- **Leave Plaid on the default model unless you have a reason not to.** Pinning chat to a specific model means it stops following the organization default — useful when chat and agents genuinely need different models, a nuisance otherwise.
- **Chat volume is cheap to underestimate.** The [Usage & costs](ai-usage.md) page prices chat at the assigned model's rates; a busy assistant on an expensive model shows up there long before it shows up on an invoice.
- **A vision model is an agent requirement, not a chat one.** If your triage agents need to read ticket screenshots, that belongs on *their* model — see **Understands images** on the [AI models](ai-models.md) page.
- **Prefer connections for Claude.** Each person signs in with their own account, so nobody shares a key. Keep keys for clients that need one, rotate them, and use **Key max lifetime (days)** to set a ceiling no request can exceed.
- **Set a retention window.** Keeping conversations forever is convenient until the database grows large or a compliance review asks how long chat content is kept — 90 or 180 days is a common starting point.
- **GLPI lives elsewhere.** The ticketing connection your agents work against is configured under **Admin → Integrations**, not here — see [Integrations](integrations.md).
