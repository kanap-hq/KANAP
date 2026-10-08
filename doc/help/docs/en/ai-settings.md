# Plaid Settings

This page controls the [Plaid chat assistant](ai-assistant.md): which AI model it talks to, whether chat and the MCP API are switched on, how long conversations are kept, and which keys let external MCP clients reach your data. It is a chat-focused screen. The models themselves — providers, keys, prices — are defined once on the [AI models](ai-models.md) page, and each [AI agent](agents-workspace.md) picks its own model on its Settings tab, so nothing you change here alters how the agents run.

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

As the card says, the allowance is shared across chat and MCP requests for this tenant — and the agents draw on it too. One message is one chat question, one request from an external assistant over MCP, or one ticket reviewed by an agent. A busy agent fleet consumes it faster, so if you are watching this bar, watch the [Usage & costs](ai-usage.md) page too.

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
- **Enable MCP**: turns the MCP API on or off for external clients. It does not wait for the confirmation of the included model. MCP requests still count against the included monthly allowance when Plaid would run on that model.
- **Web search** — lets the Plaid chat assistant search the web. It requires the instance-level web-search key to be configured; without it, the toggle is disabled and a tooltip explains why. Switching it on automatically runs a connectivity test and reports the result. This toggle applies to the **chat assistant only** — AI agents have their own, independent web-search setting on each agent's [Settings tab](agents-workspace.md), which relies on the same instance-level configuration.

---

## Retention

- **Conversation retention (days)** — chat conversations and their messages older than this value become eligible for automatic cleanup. Leave it empty to keep them indefinitely.

Changes in **Provider**, **Features**, **Retention** *and* the **Key max lifetime (days)** field further down are all applied by the single **Save settings** button at the bottom of this card. Nothing on this page saves by itself.

---

## MCP API keys

The **MCP API keys** section mints long-lived keys so external assistants and IDEs can talk to KANAP through the Model Context Protocol, using the same data Plaid sees.

The card shows a **Create key** button, the **Key max lifetime (days)** cap, and a table of existing keys with **Label**, **Prefix**, **Created**, **Expires**, **Last used**, and **Status** (**Active** or **Revoked**).

### Creating a key

1. Click **Create key**.
2. Enter a descriptive **Label** (for example, "Desktop MCP client").
3. Click **Create**. KANAP generates a one-time secret.
4. Copy the secret immediately — it is shown once and cannot be retrieved later.

The **Key max lifetime (days)** field caps how long any newly issued key can live, regardless of what the request asks for. Leave it empty for no expiration limit. Note that this one field belongs to the settings above rather than to this card: it is written by the **Save settings** button, not by creating a key.

### Revoking a key

Click the trash icon on any active row to revoke the key. Revoked keys stay in the table for audit purposes but can no longer authenticate.

---

## Tips

- **Leave Plaid on the default model unless you have a reason not to.** Pinning chat to a specific model means it stops following the organization default — useful when chat and agents genuinely need different models, a nuisance otherwise.
- **Chat volume is cheap to underestimate.** The [Usage & costs](ai-usage.md) page prices chat at the assigned model's rates; a busy assistant on an expensive model shows up there long before it shows up on an invoice.
- **A vision model is an agent requirement, not a chat one.** If your triage agents need to read ticket screenshots, that belongs on *their* model — see **Understands images** on the [AI models](ai-models.md) page.
- **Rotate MCP keys.** Prefer short-lived keys for shared workstations, and use **Key max lifetime (days)** to enforce a ceiling no request can exceed.
- **Set a retention window.** Keeping conversations forever is convenient until the database grows large or a compliance review asks how long chat content is kept — 90 or 180 days is a common starting point.
- **GLPI lives elsewhere.** The ticketing connection your agents work against is configured under **Admin → Integrations**, not here — see [Integrations](integrations.md).
