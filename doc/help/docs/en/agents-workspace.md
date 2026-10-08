# AI Agents — Agent workspace

The agent workspace is where a single agent lives: you drive it, watch what it is doing, review its proposals, judge how well it is performing, and — if you are an administrator — configure every detail of how it works. It is the deepest surface in the AI Agents area. Everything about one agent that isn't a fleet-wide control is here: an action bar that stays with you on every tab, and four tabs beneath it. Administrators can click the agent name or the short description under it to rename it or update that summary; both still appear on the agent's card in the fleet.

Open an agent by clicking its card on [AI Agents — Overview](agents-overview.md). The workspace always opens on **Monitor**; you can deep-link to any tab, and links from elsewhere in the product land you on the right one.

## Where to find it

- **Workspace:** AI Agents
- **Path:** **AI Agents → Overview →** open an agent's card
- **Route:** `/agents/:agentKey`
- **Permission:** viewing needs the AI Agents Reader role (`ai_agents:reader`). Running a check, testing the agent, and deciding proposals need the contributor level (`ai_agents:contributor`). Changing the run mode, pausing the agent, and the **Settings** tab need the AI Agents Admin level (`ai_agents:admin`); the AI Settings admin (`ai_settings:admin`) unlocks all of it too.
- **Availability:** the whole AI Agents area requires AI to be enabled on the instance. If you open a link to an agent that doesn't exist for your tenant, you'll see **Agent not found** — "This agent is not available in the current tenant." — with a way back to the fleet.

The tabs are **Monitor**, **Approvals**, **Performance & autonomy**, and **Settings**. Readers see the first three; only administrators see **Settings**.

---

## The action bar

Directly under the agent's name sits a slim bar of controls, right-aligned, that stays visible on **every** tab. It carries actions only — the agent's read-only figures live in the **Status** section of the **Monitor** tab. The point is that you never have to leave what you're doing to start, stop, or test the agent.

### The run mode control

The first control is the agent itself. Closed, it reads the agent's live state as a coloured dot and a label — **Watching — asks first**, **Watching — partly automatic**, **Testing**, **Off**, **Paused**, **Not started**, or **Archived**. Open it (administrators, on an agent that is neither paused nor archived) and it offers the three run modes:

| Mode | What it means |
| --- | --- |
| **Off** | Nothing runs, not even a manual check. |
| **Manual only** | Runs only when you ask — **Check now** and tests work, but the agent never looks on its own. |
| **Watching** | Checks on its own at the frequency you set, plus everything **Manual only** does. |

Read the closed label as the truth and the menu as the intent: an agent set to **Watching** that is currently held by a pause reads **Paused**, not **Watching**, so the control never tells you the agent is working when it isn't.

**Manual only** is the mode that makes a new agent safe to try. It is where you should sit while you tune a persona and its targeting: you can run the agent as often as you like against real tickets, but nothing happens unless you ask for it. Move to **Watching** only when you're happy with what it drafts.

### The other controls

- **Check now** (**Check for new alerts** on a monitoring agent) runs a check immediately instead of waiting for the next scheduled one. It is disabled when the agent is **Off** ("Turn the agent on first.") or paused ("Lift the pause first."), with the reason in the tooltip.
- **Test on a ticket** (**Test on an alert** on a monitoring agent) takes you to the test section on the **Monitor** tab, whichever tab you were on.
- **Pause agent** is the red emergency brake, and it is deliberately not the same thing as **Off**. It asks for a reason, then holds this agent's checks *and any pending writes* until you lift it. Other agents keep running. While a pause is in effect a warning banner reads **Emergency pause active: {reason}** and the control becomes **Lift pause**. A pause set for the whole tenant instead shows **Paused for all agents** and sends you to the fleet overview — you can't lift a tenant-wide pause from a single agent.
- **Archive agent** (administrators) retires the agent: it stops watching and running, keeps its configuration and history, and asks you to confirm first. When the agent is already archived, this control becomes **Restore agent** and brings it back to **Off**.

Use **Off** to stand an agent down for a while; use **Pause agent** when something is going wrong and you want the pending work frozen too; use **Archive agent** when you are done with it.

---

## Monitor

Monitor is the live board for this one agent. It refreshes as work moves through, so it's the tab to keep open when you're keeping an eye on things.

### Status

The **Status** section is read-only: it is where every fact about the agent's current state now lives, in one line of figures.

- The agent's state, in the same words as the action bar.
- **Watching** — **All tickets**, **Filtered** (when your targeting narrows the scope), or **Off**. A monitoring agent reads **All alerts**, **Filtered**, or **Off**.
- **Last check** — the outcome of the most recent check.
- **Next check** — **Every N minutes**, following the **Check every (minutes)** setting, while the agent is watching. Otherwise **Not set**, because nothing is scheduled.
- **Queue** — *N waiting · N in progress*: proposals waiting for your decision, and tickets the agent is working right now.
- **N failed**, in red, when something stalled and won't retry on its own. These are the items you'll find under **Needs attention** in [Approvals](agents-approvals.md).
- **Runs today**, **Tokens today**, and **Cost today**, each as *used / cap*. These are the daily safety limits set on **Settings**, and this is where you notice an agent that is about to go quiet for the day. (Desk agents only — monitoring agents don't meter this way, so the figures are hidden rather than shown as misleading zeros.)

### Test on a ticket

**Test on a ticket** runs the agent once against a single ticket you name — the fastest way to see how it behaves before you let it watch on its own, or to check its reasoning on a specific case. Type a ticket number (for example `64`) and press **Run test**. The agent does a full pass on just that ticket; whatever it proposes lands in the **Approvals** tab for your review like any other work. Nothing is sent to the requester without approval.

A monitoring agent gets **Test on an alert** instead: give it an alert ID and its diagnosis appears underneath, in the same dossier layout as a stored one.

Testing works in **Manual only** as well as in **Watching**, which is exactly the point — it is the companion to a not-yet-trusted agent.

### Recent activity

The bottom of Monitor embeds the live timeline of this agent's checks, proposals, decisions, executions, pauses, and errors. It is the same feed as the full [Activity](agents-activity.md) page, already filtered to this agent — same category toggles, same **Load more**, same trace dialog.

---

## Approvals

The **Approvals** tab is the review queue — proposed replies, notes, and ticket updates waiting for your decision — scoped to just this agent. It behaves exactly like the standalone queue, including approving in bulk, the terminal-action confirmation, and the **Acknowledge** and **Re-run analysis** controls on **Needs attention** rows. See [Approvals](agents-approvals.md) for the full explanation; nothing about it changes here except that you only see this agent's items.

---

## Performance & autonomy

This tab answers one question: is the agent earning more independence? It holds the evidence and the switch side by side, so you never have to judge in one place and act in another.

### The headline figures

- **Acceptance** — the share of its proposals you approved. This is the number that most influences whether an action type can go automatic.
- **Dismissed** — the share of reviewed proposals you set aside rather than approved or rejected. A dismissal doesn't count against the agent, so this figure sits apart from acceptance. Read a persistently high value as a targeting problem — the agent is picking up tickets it shouldn't handle — and fix it in **Settings → Targeting**, rather than treating it as an answer-quality issue.
- **Approval latency** — the typical time, in minutes, between a proposal appearing and someone deciding on it. A rising figure usually means the queue needs more reviewer attention, not that the agent is doing worse.
- **Knowledge hit rate** — how often its replies were backed by your knowledge sources.
- **Cost per ticket** — average spend per ticket handled, in EUR. (Fleet-wide cost lives on the [Overview](agents-overview.md).)
- **Runs per ticket** — how many checks it took, on average, to resolve a ticket.

### Trends

Two charts cover the last 14 days. **Trends** plots **Proposed** against **Executed** per day, so you can see the agent warming up, a spike, or a day it went quiet. **Cost per day** sits beneath it as a smaller chart on the same day axis — counts and euros deliberately don't share a scale. Until the agent has done anything, both read **No activity recorded yet.**

### The autonomy ladder

By default every action type **asks first** — the agent proposes and waits for you. This section is where you promote an action type to **Automatic**, one type at a time, once it has earned it.

Each row shows the action type, its current mode (**Ask first** or **Automatic**), and a progress line: decisions captured against the number required, acceptance rate against the required rate, and days of activity against the required days. When a row isn't eligible yet, it says why in plain terms — *Not enough reviewed proposals yet.*, *Acceptance rate is below the threshold.*, *Not enough days of activity yet.*

**Not every action type carries the same risk, and the ladder now says so.**

- **Internal notes**, **Classification update** and **Status update** are the lower-risk tier. Nothing leaves your team and nothing moves between people. The evidence thresholds are recommendations here: when a type is eligible, **Turn on** opens a short confirmation; when it isn't, **Override** lets you grant it anyway with a written reason.
- **Requester reply**, **Assignment** and **Participants** are the higher-risk tier, and their rows are marked with a warning border and a one-line reminder of what you would be agreeing to — *The agent would reply to the requester with nobody reading it first.* These can now be automated, which they previously could not. But the grant **always** requires an explicit acknowledgement and a written reason, even when every threshold is already met and the row is eligible. The reason is kept in the agent's history so your team can see who accepted this and why.

In both cases the confirmation reminds you that automatic actions still respect the daily limits and the emergency pause, and that KANAP can step back to asking first on its own (see below). **Turn off** returns any automatic action type to asking first, immediately.

**When an automatic action type steps back.** Two safeguards work without you:

- **A bad hour holds the next action.** If an action type had a failed action, a rejected proposal, an error from the connected system or an unusual cost spike in the last 60 minutes, the next action of that type waits in the approvals queue instead of being applied. The type stays on **Automatic**, and actions apply again once the hour is clean.
- **Low acceptance turns the type off.** If fewer than half of an action type's decided proposals were approved, KANAP switches that type back to **Ask first** and records *Automatic mode demoted* in the agent's [Activity](agents-activity.md). You can promote it again once it qualifies.

Two blocks are absolute and no reason will lift them: an action type you switched off under **Capabilities** (*This action isn't enabled for this agent.*), and an open incident (*An open incident is blocking automation.*).

Automatic never means unsupervised. Hard safety limits, budgets, freshness checks and pauses apply the same way whatever an action type's mode.

---

## Settings

The **Settings** tab is administrator-only and holds every configuration knob for the agent. It **autosaves**: there are no save buttons, and each section shows a small **Saving…** / **Saved** indicator in its header as your edits are written. If you switch tabs with a save still in flight, the save is completed first — and if it fails, the switch is cancelled so the error and your edit stay on screen.

The sections follow the order you actually set an agent up in: decide what it looks at, then what it may do, then what it is, then what it knows, then how hard it may work.

### Targeting

Targeting decides which tickets the agent watches. (Whether it watches at all is the run mode in the action bar — targeting only describes the scope.)

Quick presets — **New tickets**, **All open**, **Handled by this agent** — drop in a starting filter set; if you already have filters, you're asked before they're replaced. **New tickets** means tickets opened in the last N hours or days (shown under the preset), not tickets whose status is New. The filter builder lets you combine conditions: all filters are combined, and the available values come straight from the connected ticketing system. Selecting a category or an **Organization / site** includes everything beneath it, and the builder says so. **Inactive for at least** also lets the agent propose closing tickets that have been quiet that long.

A live line under the filters tells you how many tickets currently match. If another agent already watches some of those tickets, that count is mentioned too — that is the signal that two agents may fight over the same work. When the line says **at least N**, the real queue is larger than the preview (your per-check limits cap how many tickets are inspected).

Monitoring agents have the same section, filtering on alert state, severity, acknowledgement, group, device and check type instead.

### Capabilities

Capabilities come first, because they frame everything else: a row of checkboxes for which kinds of change the agent may *ever* propose — **Internal notes**, **Requester replies**, **Classification**, **Status updates**, **Assignment**, and **Participants**. Unticking one removes that action type entirely: the agent can't propose it, whatever the instructions say, and it can't be promoted on the autonomy ladder. Monitoring agents don't have this section.

**Assignment** deserves a word, because it works through the instructions rather than through a setting. With it ticked, the agent may propose to assign a ticket to a **technician group** of the ticketing system, and the rule that says which group lives in **Instructions**, in plain language — for example *"If the question is about SAP, assign the ticket to the group SAP-team. If it is about Teamcenter, assign it to PLM-team. In all other cases, assign it to Tech-desk."* The agent only ever picks from the groups the ticketing system marks as assignable, and it **adds** a group: it never removes a technician or a group already on the ticket. Like every other action it is proposed for your approval unless you have promoted it on the autonomy ladder. The instructions may also name an individual **technician**, as long as that person belongs to an assignable group — for example *"tickets about the badge system go to Marie Dupont"*. The agent prefers a group unless a person is named, and one round of proposals carries at most one group and one technician. Naming a technician is additive too: nobody already on the ticket is removed.

**Classification** also follows the rules in **Instructions**. Enable it and write, for example, *"For SAP tickets, use category Software > SAP, type incident and priority high."* The agent chooses from the ticketing system’s catalogue and can change several fields in one proposal, including values already set. Unchanged fields are omitted. Without an instruction rule, it does not fill in default classification values. Urgency can also be specified using the priority scale. Changes require approval unless you have promoted classification on the autonomy ladder.

### Objective

The objective is who the agent is and how it writes:

- **Purpose** — what the agent is here to do, in one line. It reads this on every run.
- **Instructions** — house rules, written freely as lines or paragraphs. They cannot widen what the agent is allowed to do. There is a single limit of 10 000 characters in total — beyond it, part of the text would no longer reach the agent. A quiet counter appears as you approach the limit; past it the section is not saved until you shorten the draft.
- **Reply language** — **Ticket language** (answer in whatever language the requester used), **French**, **English**, **German**, or **Spanish**.

Next to the instructions, **Names you can use in the instructions** lists ticket statuses and their keys, technician groups and the technicians themselves when **Assignment** is enabled, and categories, priorities and types when **Classification** is enabled. Use the displayed names or enum keys. Statuses, priorities and types are listed inline; technician groups, technicians and categories stay collapsed on a single row with their count, and open one at a time. The search field at the top looks through all of these lists at once, and clicking a name inserts it in the instructions where your cursor is. The search covers all categories; when there are more than 200, the agent first narrows its choices to the category subtrees in your targeting, then keeps the first 200 full names alphabetically. The run trace reports any remaining truncation.

The agent's name and short description live on the workspace title, not in this grid: click them to edit. How the agent should sound, and when it should hand work to a person, belong in **Instructions** as ordinary rules.

**Use shared context** layers reusable background about your environment onto this agent. The switch is all you see until you turn it on; once it's on, you get the profile selector, a **+ New profile** shortcut, and a preview of the selected profile's lines. Shared context shapes how the agent interprets tickets and writes replies, but it is never a permission grant and is **not** a citable source — unlike [Knowledge libraries](knowledge.md), whose results *are* cited back in replies. Manage profiles on the [Shared context](agents-shared-context.md) page. If a profile has more lines than the agent can send, a warning tells you how many lines of shared context are not being sent to the model — nothing is dropped silently.

**View effective prompt** is collapsed by default. Expand it to read exactly what the agent's runtime is given, compiled from everything above plus the platform's own rules. Use the selector to inspect each stage — **Action planner**, **Planner**, and **Interpreter** are where the agent decides *what to do*; **Synthesis** is where it drafts the reply grounded in your knowledge sources; a monitoring agent has **Diagnosis** instead. The preview refreshes after each save. As the hint says, **guidance cannot override safety rules** — nothing you write in the persona can loosen the platform's hard limits. The same shared-context warning appears here if any lines were left out.

### Knowledge and web sources

Where the agent gets its facts:

- **Search KANAP knowledge** — when on, the agent draws on your [Knowledge libraries](knowledge.md) and cites them in replies. With it off, the agent answers from the model's own knowledge (and the web, if that's on).
- **Search all available libraries**, or turn it off to pick specific **Libraries** — the agent then searches only those, within what it's allowed to access. Library names come from the Knowledge section.
- **Search the web** — lets the agent also consult the public web; KANAP knowledge always takes precedence and web results are cited. This switch is only available if web search is enabled for the whole platform. When it isn't, the switch is disabled and a note points you to your administrator — see [Plaid Settings](ai-settings.md).

Monitoring agents get **Search KANAP data** here instead, which lets the agent look up your own IT inventory — **Applications**, **Assets**, **Interfaces**, **Connections**, **Locations** — to add business context to a diagnosis.

### Operating settings

The pace-and-budget controls. Four of them sit in the open: **Check every (minutes)**, **Tickets per check**, **Runs per day**, and **Cost per day (EUR)**. Everything else — including the AI model — is behind **More options**. Every field carries an information tooltip that says what it does and what happens when it is reached.

- **Check every (minutes)** — how often the agent looks for new tickets while it is watching, between **5** minutes and 24 hours (1440). This is the single biggest lever on how busy — and how expensive — a watching agent is. **Check now** always runs straight away, whatever this says, and this is the figure that **Next check** reports on the Monitor tab.
- **Tickets per check** — the most tickets the agent picks up in one check (the rest wait for the next one).
- **Runs per day** and **Cost per day (EUR)** — daily ceilings, each with today's real consumption underneath (**Today: …**). A *run* is one pass on one ticket, not one scheduled check.
- **AI model** (under **More options**): which model this agent runs on. **Organization default** is the starting value and usually the right one: the agent follows whatever model your organization has set as default, and moves with it. Pick a specific model by name to pin this agent to it: a vision-capable model for screenshot-heavy queues, a cheap local one for high-volume triage. Only active models appear; they are defined on the [AI models](ai-models.md) page. When your organization has no default model, the agent runs on the KANAP included model, and only after an administrator has confirmed its provider on the [Plaid Settings](ai-settings.md#confirming-the-kanap-included-model) page. Until then the agent is paused: scheduled checks wait, queued tickets stay in line, and a check you start by hand stops with a message that says why. An agent pinned to a model you added is not affected. A model an agent is pinned to cannot be archived out from under it: the agent has to be moved off it first. Note that reading the model list needs the AI settings admin permission (`ai_settings:admin`): with the **Agent Admin** role alone the dropdown offers only **Organization default**, which is a permissions gap rather than an empty registry.
- **Max provider requests** (under **More options**) — the most calls the agent makes to the ticketing system in one check, so it never floods it.
- **Review every (hours)** — how soon the agent may look at the same ticket again after there is nothing waiting (applied, rejected, dismissed, or the window ran out). A waiting proposal occupies the ticket: the agent does not write another pair until that proposal is gone, unless the ticket itself changed.
- **Agent priority** and **Ticket collision** — which agent wins when several target the same ticket (lower number = higher priority), and what this one does when another is already working it: **Defer** (stand back) or **Supersede equal priority** (take over from an agent of the same priority).
- **Approval window (hours)** — how long you have to approve. All proposals from one check share this window and expire together. A live proposal occupies the ticket for that whole window, so **Review every** 24 hours with an approval window of 168 hours is a valid pair: you have a week to decide, and the agent does not write another pair in the meantime unless the ticket changes.
- **If ticket changed** — what happens to a waiting proposal when the ticket moves on before you decide: **Re-review**, **Cancel**, or **Apply anyway**.
- **Agent on the ticket** — how the agent appears among the ticket's actors once one of its replies is applied. **Takes the ticket (assignee)** is the default: the ticket is assigned to the agent's own user in the ticketing system, and the ticket moves to its "processing" status the way it would for any technician. **Follows the ticket (observer)** keeps the agent visible on the ticket without taking it. **Stays out of the ticket actors** leaves the actors untouched: the reply is posted and nothing else changes. Internal notes never take a ticket; at most they add the agent as an observer.
- **Keep activity history (days)** — how long this agent's timeline is kept, between **7** and **90** days, **30** by default. Older entries, runs, and finished proposals are deleted automatically each night. See the caution below.

#### Safety limits

The five economic caps sit in their own group, under a plain warning: these are **hard stops, not estimates**. When the agent reaches one of them it stops working for the rest of the day and waits for you — it starts again the next day.

- **Tokens per run** and **Cost per run (EUR)** — the most the agent may spend on *one ticket*. Reaching one stops that ticket, and nothing is proposed for it. A *run* is one pass on one ticket, not one check: a single check can spend the per-run budget once for each ticket it picks up, so read these next to **Tickets per check**. These two, plus **Tokens per day**, sit under **More options**.
- **Runs per day**, **Tokens per day**, and **Cost per day (EUR)** — the daily ceilings. Each of the three shows today's real consumption underneath it (**Today: …**), so you can size a cap against what the agent actually uses instead of guessing. These are the same figures as the **Status** section on Monitor.

The two cost caps are priced with the **AI model** assigned above, using the prices recorded for it on the [AI models](ai-models.md) page. That has one consequence worth knowing: **a free model (0 €) never reaches a cost cap**, because everything it does costs nothing. On the KANAP included model, on a local model, or on any model you registered without prices, the cost caps are inert and the **token** and **run** caps are your only real protection. Set them accordingly.

Monitoring agents have the same section in a shorter form: **AI model**, **Check every (minutes)**, **Alerts handled per check**, **Requests to the monitoring tool per check**, and **Keep activity history (days)**.

!!! warning "Keep at least 30 days of history if you plan to use automatic mode"
    An agent's track record is measured over the last **28 days**. Setting **Keep activity history (days)** below 30 deletes the very evidence the autonomy ladder counts, so an agent can appear to lose ground it had already earned. The 30-day default is chosen to sit safely above that window — shorten it only on an agent you have no intention of promoting. Nothing you still have to decide is ever purged: pending proposals and the traces behind them are kept regardless of the setting.

---

## Tips

- **Sit in Manual only before you sit in Watching.** It's the honest way to tune an agent: run it by hand on real tickets, read what it drafts, adjust, repeat. Nothing happens that you didn't ask for.
- **Off and Pause are different tools.** **Off** stands the agent down. **Pause agent** freezes it *and* the work already in flight, and it asks for a reason that goes into the record — reach for it when something is going wrong, not when you're done for the week.
- **Check frequency is your cost dial.** Before raising a daily cap, ask whether the agent needs to look every five minutes. On a quiet queue, checking every 30 or 60 minutes changes nothing about responsiveness that your requesters will notice, and cuts the bill accordingly.
- **Size the caps against the "Today" figures.** Each daily limit shows what the agent actually consumed today right underneath it. That's a far better basis for a cap than a round number.
- **The Status section is your early-warning light.** An agent that suddenly goes quiet has usually hit a daily cap — check *Runs / Tokens / Cost today* on Monitor before assuming something broke. On a free model, only the token and run caps can be the cause.
- **Grow autonomy one action type at a time.** Promote the lower-risk types first and leave requester replies asking first until acceptance is consistently high. The higher-risk types are available to you now, but the acknowledgement is there for a reason: read what the row says the agent would do before you agree to it.
- **Read the effective prompt after a persona change.** It's the ground truth of what the agent actually receives, and it makes it obvious when an instruction landed the way you meant it to.
- **Prefer shared context for background, libraries for facts.** Shared context colours the agent's judgement but is never cited; only knowledge libraries (and, if enabled, the web) show up as sources in a reply.
- **Watch Overlap in the targeting preview.** A high overlap number means two agents are competing for the same tickets — narrow one agent's filters, or use **Agent priority** and **Ticket collision** to decide who wins.
