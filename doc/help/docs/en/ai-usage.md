# Usage & costs

This page answers two questions an administrator asks regularly: *how much are we using AI?* and *what is it costing us?* It covers the whole organization (the [Plaid chat assistant](ai-assistant.md) and every [AI agent](agents-overview.md) together), with costs priced from the real prices you recorded on the [AI models](ai-models.md) page. The conversation and token figures used to live at the bottom of the Plaid settings page; they now live here, next to the money.

## Where to find it

- Workspace: **Admin**
- Path: **Admin → Artificial intelligence → Usage & costs**
- Route: `/admin/ai-usage`
- Permission: `ai_settings:admin`

Everything on this page is read-only; it is a report, not a set of controls. Two time windows run throughout: **Current month** (since the 1st) and **Last 30 days** (a rolling window). They rarely match, and both are useful: the month for budgets, the rolling window for spotting a change of pace.

---

## Costs

Three cards across the top:

- **Total this month**: agents plus Plaid, with the last-30-days figure underneath. Agent costs are measured per call. Plaid costs are measured per message, and a message that did not record its rates is estimated at today's model (see below).
- **Agents this month**: what the agent fleet actually cost, with the last-30-days figure underneath.
- **Plaid this month**: what the chat assistant cost. This card uses its caption for the estimate warning below rather than a 30-day figure.

Costs are shown in euros to the cent, and to four decimals when the amount is under a cent. Early on, or with a cheap model, a real total genuinely can be `0.0034 €`.

**Agent costs are measured.** Every model call an agent makes records its input and output tokens, priced there and then at the rates of the model that agent was using, and the result is kept. That is why the [AI models](ai-models.md) prices matter, why a model registered without prices contributes nothing here, and why editing a price later does not rewrite what agents already cost. (When a provider returns no token counts of its own, KANAP estimates them from the size of the exchange, so a small part of the figure can be approximate.)

**Plaid is priced message by message**, and the card says how: *Rates recorded with each message. Older messages use the currently assigned model’s rates.* Each assistant message keeps the provider, the model and the rates applied when it was written, and the month adds those amounts up. A message written before that recording has no rates of its own, so KANAP prices it at the model assigned to Plaid today. Changing a price on the [AI models](ai-models.md) page leaves a message that already stored its rates as it is, and moves the figure only for those older messages. If the assigned model is free and no message recorded a price, the caption changes to *The assigned model has no cost* and the figure is zero.

The **KANAP included model** costs 0 € by design: it is part of your subscription. An organization running entirely on the included model will see zeros here, and should watch the included-message allowance on the [AI models](ai-models.md) page instead.

### Cost by agent and Cost by model

Two tables appear underneath as soon as there is agent activity to report, each with a **Current month** and a **Last 30 days** column.

- **Cost by agent**: one row per agent, so you can see which one is expensive. Pair it with the agent's own **Cost per run** cap on its [Settings tab](agents-workspace.md) if a number looks wrong.
- **Cost by model**: the same spend sliced by model, sorted with the most expensive over 30 days first. Rows are the provider and model identifiers that were actually called (`anthropic:claude-sonnet-5`, `ollama:mistral`), not the friendly names you gave them on the [AI models](ai-models.md) page. A row labelled **Unknown model** is older activity recorded before per-call model attribution existed.

Both tables cover **agent runs**. Plaid's figure is not broken down here. It appears only in the **Plaid this month** card.

---

## Conversations

Four unlabelled cards sit between the cost tables and the token table, all about the chat assistant:

- **All conversations**: every conversation currently stored. If you set a **Conversation retention (days)** period on the [Plaid settings](ai-settings.md) page, conversations eventually get purged and stop counting here.
- **Active conversations (7d)** and **Active conversations (30d)**: conversations updated in the last 7 or 30 days.
- **Active users (30d)**: how many distinct people actually used chat in the last 30 days. The most honest adoption number on the page.

---

## Token usage

One table, two rows (**Current month** and **Last 30 days**), with **Input tokens**, **Output tokens**, **Total tokens**, and **User messages** (the number of questions asked in that window).

**This table is about chat, not agents.** These are the Plaid assistant's tokens. The **Plaid this month** card prices each message from these tokens and the rates recorded with that message. Agent consumption is not counted here. It shows up in **Cost by agent** and in **Agent messages** below. That is worth remembering when you run on the included model or a local one, where cost is always zero but consumption still is not.

---

## Agent messages (this month)

One card per agent, busiest first. **All agents** gives the combined count of tickets reviewed this month, then each agent shows its own count, captioned with its last-30-days figure. Every agent you have appears here, including ones that have done nothing yet: a card sitting at 0 is itself worth noticing. Archived agents are left out.

This is the per-organization view of what each agent's own workspace shows individually. Read it alongside **Cost by agent**: an agent with many messages and little cost is running on a free or cheap model; an agent with few messages and high cost is doing expensive work per ticket and is worth a look.

---

## Tips

- **Compare the two windows, not just the totals.** *Current month* on the 3rd of the month looks tiny; the rolling 30-day figure next to it is what tells you whether anything actually changed.
- **Prices in, costs out.** These figures are only as good as the prices on the [AI models](ai-models.md) page. If a cost looks impossibly low, check that the model has prices at all: an empty price field reads as free.
- **Read the Plaid figure from the rates recorded on each message.** An assistant message keeps the rates applied when it was written. A message saved before that uses the model assigned today, and the card says so. Changing a price later moves only that older part of the figure.
- **Use Cost by model when you're weighing a change.** It shows what each model is really costing you across all your agents, which is the number to compare before moving work onto a cheaper one.
- **Zero cost is not zero usage.** On the included model or a local one, every cost figure stays at €0. **Agent messages** is where agent load shows up, and the token table is where chat load does.
