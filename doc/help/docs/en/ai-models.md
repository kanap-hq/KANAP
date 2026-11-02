# AI models

This page is the list of AI models your organization is allowed to use. You add a model once (its provider, its address, its key, its prices), and from then on you simply *assign* it: to the [Plaid chat assistant](ai-settings.md), to any individual [AI agent](agents-workspace.md), or as the organization-wide default that everything else falls back to. It is also where the cost figures on the [Usage & costs](ai-usage.md) page come from: the prices you enter here are what KANAP uses to price real token consumption.

## Where to find it

- Workspace: **Admin**
- Path: **Admin → Artificial intelligence → AI models**
- Route: `/admin/ai-models`
- Permission: `ai_settings:admin`

---

## How a model gets chosen

Nothing in KANAP is hard-wired to one model. Each consumer (Plaid and each agent) either points at a specific model or says "use whatever the organization uses". The rule is short:

1. **The model assigned to that consumer**, if there is one.
2. Otherwise, **the organization's default model**: the one marked with a star on this page.
3. Otherwise, **the KANAP included model**, once an administrator has confirmed its provider and processing location.

So there is exactly one default per organization, and anything you never touch follows it. Change the default and every unassigned consumer moves with it. That is the point of having one.

The third step only exists on KANAP's hosted service. On an on-premise installation there is no included model, so if nothing is assigned and no default is set, the chain simply runs out: the Plaid settings page reports that no model is configured and chat won't answer, while agents keep running but skip the steps that need a model: they fall back to their non-AI behaviour rather than failing outright. Registering a model fixes it. Star it as the default so everything picks it up at once, or assign it consumer by consumer.

On the hosted service, the third step has one condition. Plaid and the agents that would use the included model wait until an administrator confirms its provider, and the Plaid settings page and the agents page say so. A model you add never needs a confirmation. See [Confirming the KANAP included model](ai-settings.md#confirming-the-kanap-included-model).

You cannot break this chain by tidying the list: a model that anything still points at cannot be archived in the first place, and should an assignment ever end up pointing at an archived model, the consumer falls back to the default rather than failing.

---

## Working with the list

The table shows every model your organization has registered, active ones first and archived ones below, alphabetically within each group.

**Columns**:

- **Default**: a star on every active row. The filled star is the organization default. Click an empty star to move the default there; click the filled star on one of your own models to clear it. Only one model can be the default, so starring a new one un-stars the old one. Archived models have no star.
- **Name**: the name you gave the model, plus **Archived** if it has been retired. A **Configuration incomplete** note appears here when something required is missing, most often a model that needs an API key and has none. Fix it: an incomplete model does not quietly fall back to another one, it just doesn't work.
- **Model**: the provider on the first line, the exact model identifier underneath.
- **Capabilities**: **Images ✓** if the model can read pictures, **Text only** if it cannot. This comes from the **Understands images** switch in the editor.
- **Input price / M tokens** and **Output price / M tokens**: what you pay per million tokens, in euros. A dash (**—**) means no price is recorded, which KANAP treats as free.
- **Usage**: for a model you added, how many messages it handled this calendar month: Plaid user messages on conversations that used this provider and model, plus one count per agent run that recorded this model. **0 messages this month** means no traffic yet, not that the model is unused as a default. The KANAP included model keeps its own display: the monthly included-message allowance with a progress bar, not this count.

**Row actions** (active models only):

- **Edit**: opens the editor dialog.
- **Archive**: retires the model. The button is disabled while anything still uses it, and the tooltip says so: *This model is still assigned and cannot be archived*.

Archived rows are shown greyed out with a single **Restore** action. Archiving is deliberately not deletion: past usage stays attributed to the model on the [Usage & costs](ai-usage.md) page, and a restored model comes back with its provider, key, prices, and capabilities intact, but no longer the default and no longer assigned to anything, so you re-assign it deliberately. An archived model can't be edited, made the default, or assigned until you restore it.

### The KANAP included model

On the hosted service, the first row of the table is always **KANAP included model** (*Operated by KANAP, included in your subscription*). It behaves differently from the models you add, on purpose:

- It costs `0.00 €` in both price columns. It is part of your subscription, not something you are billed per token for.
- It is **multimodal** (it reads ticket screenshots), and you cannot change that.
- In the **Usage** column it shows your **included messages this month** with a progress bar, so you can see how much of the monthly allowance is left. A message is one question asked of Plaid or one ticket reviewed by an agent: both draw on the same allowance. Requests from external assistants connected over MCP do not count. That bar is the included-model quota; it is not the same figure as the message counts on the models you add.
- It shows a filled star in the **Default** column whenever no active model of your own is starred. That is the "nothing configured" fallback in visible form. Click its empty star to clear your current default and fall back to it. You still cannot edit or archive it.
- It has no edit or archive actions: those belong to the models you add. It is simply always there.
- Plaid and the agents use it only after an administrator confirms the provider and where it processes data, on the [Plaid Settings](ai-settings.md#confirming-the-kanap-included-model) page. Models you add are not subject to that step.

On an on-premise installation this row does not appear at all.

---

## Adding or editing a model

**New model** opens the editor; the pencil on any active row reopens it for an existing entry. The fields:

- **Name**: how the model appears everywhere you assign it: in the Plaid selector and in each agent's **AI model** list. Use something you will recognise in a dropdown six months from now (*Claude production*, *Local Mistral*), not the raw model identifier. Note that the **Cost by model** table on [Usage & costs](ai-usage.md) does *not* use this name. It lists the identifier that was actually called, such as `anthropic:claude-sonnet-5`.
- **Provider**: who serves the model. The choice changes which of the following fields apply.
- **Model**: the exact model identifier as the provider spells it (for example `claude-sonnet-5`). This is not a display name; a typo here surfaces as a failed call, not a validation error.
- **Server address**: only for providers you host or point somewhere specific. When KANAP runs in Docker and the model runs on the same host machine, address the host rather than `localhost`.
- **API key**: the credential from your provider. It is stored encrypted and never shown again: when you reopen an existing model the field shows a mask (`••••••••`) with the hint *Leave empty to keep the current key*, so you only type in it to replace the key. If the instance has no encryption secret configured, a warning at the top of the page explains that keys cannot be stored at all.

**Capabilities**:

- **Understands images**: turn it off for a text-only model. The explanation sits in the info tooltip next to **Capabilities**: screenshots attached to tickets are then *skipped* rather than sent, which is what you want: a text-only model that receives an image fails the call instead of doing useful work. Leave it on for a vision-capable model, and your triage agents will use ticket screenshots as evidence.

**Cost input**, **Cost output** and **Cache read cost**: prices per million tokens, in euros. The info tooltip next to each label says where to find them.

- Copy the input and output prices straight from your provider's pricing page. They are usually different, and KANAP prices them separately.
- **Cache read cost** is the price of a token the provider reads back from its prompt cache. Pricing pages often call it *cached input*. It is optional. Left empty, a cached token costs a tenth of the input price with Anthropic and the full input price with other providers (see [Usage & costs](ai-usage.md)).
- **Leave the prices empty or set them to 0 for a local or self-hosted model.** A model with no prices costs nothing, which is the truth for a model running on your own hardware. Choosing an Ollama provider sets the prices still empty to 0 for that reason, and keeps any price already entered.
- KANAP prices each Plaid answer and each agent call as it happens, then keeps the cost. Editing a price changes costs **from now on** and leaves past figures alone.

**Timeout**: how long to wait for this model, in seconds, before giving up. The explanation sits in the info tooltip next to the label: leave it empty to use the standard limit. Local models often need more time, which is why the setting lives per model rather than per installation. To make this model the organization default, star it in the **Default** column of the list after saving. That choice is not in the editor.

**Reasoning effort**: how much the model thinks before it answers. It matters for models that reason before replying, which most recent models do. **Provider default** sends nothing and lets the provider decide. **Low**, **Medium**, **High**, **Very high** and **Maximum** ask for less or more thought: more effort gives more careful answers that take longer and cost more, since providers bill the thinking as output tokens. The setting applies to every call made with this model: Plaid answers, agent steps and the connection test.

The levels offered depend on the provider and the model. For Anthropic they follow the model: Claude Opus 4.5 takes **Low** to **High**, Claude Opus 4.6 and Claude Sonnet 4.6 add **Maximum**, and later models take all five. The field is greyed out for a model that takes no effort, such as Claude Haiku 4.5. OpenAI receives the level under its own name. Ollama and other compatible servers receive it as set and may ignore it: run **Test connection** to see whether the model reasoned. A provider that refuses a level answers with its own error message.

**Test connection** appears once the model has been saved. It makes one tiny call with the settings as stored and reports either *Connection successful* with the round-trip time and the effort sent (*No effort sent* when none was), or the provider's own error message. When the provider reports reasoning tokens, as OpenAI does, the result also gives their number: zero means the model answered without reasoning. It proves that the provider, model identifier, address, key and reasoning effort work together. It does not check your prices, the images switch, or the response-time setting. Run it after adding a model and after rotating a key: a wrong key is otherwise invisible until real work fails, and it fails quietly (a chat answer that errors, or an agent that skips a step and carries on).

**Create** / **Save** stay disabled until the name and model identifier are filled in and the three prices and the response time are valid numbers. A price cannot be negative. Names must be unique within your organization.

---

## Tips

- **Set a default before you assign anything.** With one starred model, every new agent and Plaid itself work immediately, and you have a single place to change model later.
- **Name models by role, not by version.** *Triage model* survives an upgrade from one model version to the next; *Claude Sonnet 4.5* becomes a lie the day you edit it.
- **Register the same provider twice when the jobs differ.** A cheap text-only model for high-volume triage and a vision model for screenshot-heavy tickets is a normal setup. That is why assignment is per agent.
- **Get the prices right, or leave them empty.** They are not decoration: they drive the cost figures on [Usage & costs](ai-usage.md) and the per-run **Cost** caps on each agent. A model priced at 0 never reaches a cost cap, so on a free model the token caps are your only protection.
- **Check the archive button before retiring a model.** It stays disabled while Plaid or an agent is *pinned* to that model (not merely falling back to it as the default). Move those pins first.
- **Test after every key rotation.** The connection test is free and instant; discovering a stale key through a failed agent run is neither.
