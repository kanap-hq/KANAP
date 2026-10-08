# AI Agents — Overview

AI Agents are automated helpers that watch your connected service desk and do the first pass on tickets for you: drafting a reply to the requester, adding an internal note, or proposing an update to a ticket's classification, status, assignment, participants, or a close/solve. This page is the fleet dashboard — the one place to see every agent at a glance, how much work is waiting for your decision, how the fleet is performing, what it is costing you, and where to pull the emergency brake if something looks wrong.

The important idea to hold onto: an agent proposes, you dispose. Anything an agent wants to send to a requester or write back to a ticket is proposed for your approval first, and hard safety limits, budgets, freshness checks, and pauses always apply — even after you let an agent act on its own. Day-to-day configuration for a single agent lives on its [Agent workspace](agents-workspace.md); this page is where you supervise the whole fleet.

## Where to find it

- Workspace: **AI Agents**
- Path: **AI Agents → Overview**
- Route: `/agents`
- Permission: `ai_agents:reader` to view the section, `ai_agents:contributor` to act on an agent's work. The create, emergency-pause, and delete controls described below require the AI Agents Admin level (`ai_agents:admin`); the AI Settings admin (`ai_settings:admin`) unlocks them too.
- Feature flag: the whole AI Agents section requires AI to be enabled on the instance. If AI is off, the section is not available.

---

## Concepts, in one minute

A few ideas recur across every page in this section. Learn them once here.

- **What an agent watches.** Each agent is pointed at your connected ticketing system (today that is GLPI, set up under **Admin → Integrations** — see [the GLPI connection](integrations.md)). In the agent screens it is referred to generically as the connected ticketing system or the connection. A monitoring agent watches a connected monitoring tool and its alerts instead.
- **What an agent acts on.** Tickets. The work an agent can propose is a requester reply, an internal note, a classification change, a status move (including close/solve), an assignment change, and adding or removing participants.
- **Asks first vs. automatic.** Every action type starts in **Ask first** — the agent drafts the change and it sits in your approvals queue until you approve, reject, or dismiss it. Once an agent has built up enough of a track record on a given action type, an admin can promote just that action type to **Automatic** so it applies without waiting. Promotion is per action type, and the safety limits below never stop applying.
- **Run modes.** Every agent sits in one of three modes, set from the action bar on its [workspace](agents-workspace.md): **Off** (nothing runs at all), **Manual only** (it runs only when someone asks — a check you trigger, or a test on a single ticket), and **Watching** (it checks on its own at the frequency you set, on top of everything Manual does). New agents always start not-started, and **Manual only** is the mode to live in while you tune one.
- **Safety always applies.** Per-check caps, per-run and daily budgets, freshness checks (what to do if the ticket changed after the agent drafted its work), and pauses apply regardless of whether an action type is ask-first or automatic. You can always stop everything — see [Emergency pause](#emergency-pause) below.

Two agent types work end to end today: the **Helpdesk** agent, which is what the rest of this section describes, and the **Infrastructure monitoring (SRE)** agent, which reads alerts from a connected monitoring tool and prepares diagnosis notes for review. Other types may appear in the agent-type list elsewhere, but they are not ready to run.

Two other AI surfaces are easy to confuse with agents but are separate things: [Plaid](ai-assistant.md) is the interactive chat assistant you drive yourself, and [Plaid Settings](ai-settings.md) configures that assistant. The models themselves live on the [AI models](ai-models.md) page, where each agent's model — and the organization default it falls back to — is defined.

---

## The fleet dashboard

!!! note "Agents waiting for a confirmation"
    On the hosted service, an agent that has no model of its own runs on the KANAP included model once an administrator has confirmed its provider. Until then, a banner at the top of the page says *Agents that use the KANAP included model are paused until an administrator confirms it in Admin > Plaid.* Administrators get an **Open Plaid settings** button on it. Agents pinned to a model you added keep working. See [Confirming the KANAP included model](ai-settings.md#confirming-the-kanap-included-model).

Five pooled numbers sit at the top. They describe the whole fleet, not any one agent:

- **Pending approvals** — how many proposals across the whole fleet are waiting for a human decision right now. This is the same number that drives the sidebar badge.
- **Actions today** — how many proposals were actually executed today (approved and applied, or applied automatically).
- **Acceptance** — the share of decided proposals that were approved rather than rejected. Reads **Not enough data** until there is enough decision history to be meaningful.
- **Dismissed** — the share of human-reviewed proposals that were set aside rather than approved or rejected. A dismissal doesn't count against the agent, so a persistently high value usually points to a targeting problem — the agent is picking up tickets it shouldn't handle — rather than poor answer quality; fix it in the agent's targeting. Also reads **Not enough data** until there is enough review history.
- **Cost — today / 7 days** — what your agents actually cost in AI spend, in EUR: today's total and the trailing seven days (today included). This covers **every** agent in the tenant, desk and monitoring alike, so it is the number to check when you want to know what the fleet is costing you, full stop. Per-agent economics — cost per ticket, per-run and daily caps — live on each agent's **Performance & autonomy** and **Settings** tabs.

Treat these as fleet health, not per-agent accounting. For one agent's numbers, open its workspace and use **Performance & autonomy**.

---

## The Fleet cards

Below the dashboard, the **Fleet** section shows one card per agent. Each card carries the agent's **name** and **description** (or **No description.** if none was set), its status, a row of chips, and — for a desk agent — a strip of live figures.

**The status** (top-right of the card) tells you what the agent is doing right now, as a coloured dot and a label. The colour is the fast read: green means the agent is working, blue that it only runs when asked, red that it is held, grey that it isn't running at all.

| Status | Colour | What it means |
| --- | --- | --- |
| **Watching — asks first** | Green | Watching on its own, but every action type still routes to you for approval. |
| **Watching — partly automatic** | Green | Watching, with at least one action type promoted to run without approval. The rest still ask first. |
| **Testing** | Blue | On, but not watching — the **Manual only** mode. It runs when you check or test it by hand, never on its own. |
| **Paused** | Red | Held by an emergency pause (tenant-wide or just this agent). Checks and pending writes are frozen until the pause is lifted. |
| **Not started** | Grey | Created but never run. This is where every new agent begins. |
| **Off** | Grey | Nothing runs, not even a manual check. |
| **Archived** | Grey | Retired from active use, configuration and history kept. |

**The chips** summarize the agent at a glance:

- **Type** — the agent type, e.g. **Helpdesk** or **SRE**.
- **Environment** — which connection environment it points at: **Production**, **Staging**, **Sandbox**, **Lab**, or **Mock**. This is your cue for whether the agent is touching real tickets.
- **N pending** — proposals from this agent awaiting your decision (highlighted when above zero).
- **N failed** — work from this agent that stalled and needs a look (highlighted when above zero). These surface as **Needs attention** in the daily queue.
- **N automatic** or **Ask first** — either the count of action types promoted to automatic, or **Ask first** when nothing has been promoted.

**On a desk agent**, four figures appear on the card:

- **Last check** — the outcome of the most recent check.
- **Scope** — **All tickets** or **Filtered tickets**, depending on whether the agent's targeting narrows what it looks at.
- **Runs today** — how many times it has run so far today.
- **Updated** — the time of its last check.

Clicking anywhere on a card opens that agent's [workspace](agents-workspace.md), where you drive it, monitor it, review its approvals, read its performance, and change its settings.

Admins also see a small trash icon on every card — it deletes the agent along with its queue and watch history (the tickets in your ticketing system are never touched, and this can't be undone).

---

## Creating an agent

Admins get a **New agent** button at the top right of the page. It opens a dialog:

- **Agent type** — **Helpdesk** or **Infrastructure monitoring (SRE)**. Name and description come pre-filled with sensible defaults, which are swapped if you change type and haven't edited them yourself.
- **Name** and **Description**.
- **Connection** — the ticketing system (**GLPI**) for a helpdesk agent, or the **Monitoring tool** for an SRE one. **Manage integrations** jumps to **Admin → Integrations** if the connection isn't set up yet. If no monitoring tool is connected, the agent is still created — it just stays inactive until one is.

Watching, targeting, and limits are not collected here. **Create** opens the new agent's **Settings** tab on its [workspace](agents-workspace.md), where you finish that setup. The agent is always created as **Not started**, so nothing runs until you set its run mode. The recommended path is to finish Settings, put the agent in **Manual only** and test it on real tickets (or alerts), then move it to **Watching** once you trust its output.

---

## Emergency pause

If something looks wrong across the board — unexpected replies going out, a misconfiguration, an incident — admins can freeze everything at once with **Pause all agents**, in the header of the **Fleet** section. You are asked for a reason (which becomes part of the audit trail), and a persistent banner then reads **Emergency pause active: {reason}** across the section. While it is active, every agent's checks and any pending writes are held for the whole tenant. Click **Lift pause** on the banner to resume.

This tenant-wide brake is deliberately blunt. To freeze a single misbehaving agent without touching the rest of the fleet, use **Pause agent** in the action bar of that agent's workspace instead — see the [Agent workspace](agents-workspace.md). And remember the difference between pausing and switching off: **Off** simply stands an agent down, while a pause also freezes the work already in flight and records why.

---

## Working the fleet day to day

The overview is where you supervise; two dedicated pages are where the actual daily work happens:

- [Approvals](agents-approvals.md) is the review queue — proposed replies, notes, and ticket updates waiting for your decision, grouped by ticket.
- [Activity](agents-activity.md) is the read-only audit timeline of every check, proposal, decision, execution, pause, and error.

Reusable background guidance you want several agents to share lives on the [Shared context](agents-shared-context.md) page. Note that shared context shapes how agents interpret tickets but is never cited back in a reply — the sources an agent actually cites come from your [Knowledge libraries](knowledge.md).

---

## Tips

- **Read the environment chip before you trust a number.** A **Production** agent is touching real tickets and real requesters; **Sandbox**, **Lab**, and **Mock** are safe to experiment with. When you spin up a new agent, keep it off production tickets until its output looks right.
- **The cost tile is the fleet's honest bill.** It covers every agent you run. If it climbs faster than you expected, the usual cause is an agent checking far more often than its queue warrants — look at **Check every (minutes)** before you look at anything else.
- **A rising failed count is your early warning.** The **N failed** chip surfaces work that stalled. Open the agent and clear the **Needs attention** items before they pile up — they usually point at a connection issue or a ticket that changed under the agent.
- **Manual only before Watching.** An agent created from **New agent** is intentionally **Not started**. Run it by hand on a handful of representative tickets from its workspace first; only move it to **Watching** once you're happy with what it drafts.
- **Automatic is earned, and reversible.** Promoting an action type to automatic doesn't remove any guardrail: the daily and per-run budgets, freshness checks, and pauses still apply, and an action type that has a bad hour waits for your approval, and one whose acceptance falls below half goes back to ask-first (see [The autonomy ladder](agents-workspace.md#the-autonomy-ladder)). The action types the requester can see ask for an explicit acknowledgement on top.
- **Prefer the per-agent pause.** Reach for **Pause all agents** only for a genuine fleet-wide problem. For one noisy agent, the pause in its own workspace keeps the rest of your fleet working.
