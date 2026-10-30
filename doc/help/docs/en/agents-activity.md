# AI Agents: Activity

Activity is the read-only history of everything your agents have done and everything you have decided about their work: the checks they ran, the proposals they drafted, your approvals and rejections, the changes that were actually sent to a ticket, safety limits that kicked in, pauses, configuration changes, and errors. Nothing on this page changes a ticket or an agent. It exists so you can answer "what happened, when, and why" after the fact, and to give you a paper trail when a requester or a technician asks. The same timeline appears, already filtered to one agent, at the bottom of that agent's [Monitor tab](agents-workspace.md); this page is the full version across every agent.

## Where to find it

- Workspace: **AI Agents**
- Path: **AI Agents → Activity**
- Route: `/agents/activity`
- Permission: `ai_agents:reader` (viewing only: everyone who can open AI Agents can read the timeline)
- Requires AI to be enabled on the instance. This page is read-only: nothing here approves, rejects, or sends anything. To act on a proposal, use [Approvals](agents-approvals.md).

---

## Filters

The timeline shows the most recent events first. Two controls narrow it down:

- **Ticket number**: type a ticket number and press **Search** (or Enter) to see only the events tied to that one ticket. This is the fastest way to reconstruct the full story of a single ticket: every check, draft, decision, and change, in order. Clear the box and search again to return to the full feed.
- **Type chips**: seven toggles across the top (**Proposal**, **Decision**, **Execution**, **Configuration**, **Checks**, **Pause**, and **Error**). Each one is an on/off switch, not a single choice: a filled chip is included, an outlined one is excluded, and you can combine as many as you like.

**By default every category is on except Checks.** That default is deliberate. A watching agent writes a check entry every few minutes whether or not it found anything, and left on, those rows bury the entries you actually read. Turn **Checks** on when you want to confirm an agent is alive, or when you're investigating why it did (or didn't) pick something up.

Turning every chip off leaves nothing to show, and the timeline says so: *Pick at least one activity type to see the timeline.*

The ticket search and the type chips combine, so you can look at, say, only the errors on ticket #482. Your selection lives in the page address, so a filtered view is a link you can send to a colleague.

---

## Reading a timeline entry

Each entry is one thing that happened, and it carries enough context to understand it at a glance:

- A **type chip**: which of the seven categories above the event belongs to.
- An **action-type chip** (when the event is about a specific kind of ticket work): **Internal note**, **Requester reply**, **Classification update**, **Status update**, **Assignment**, or **Observers**.
- A **status dot** with a plain-language label (for example "Waiting for approval", "Done", "Rejected", "Dismissed", "Needs attention") describing where that item stands.
- The **agent name** and the **ticket** it concerns (shown as `#N`).
- An **event title**, for example "Proposal created", or "Ticket check: 3 new tickets".
- A **one-line preview** of the substance (the first line of a drafted message, a field change, or the reason), so you often don't need to expand anything.
- A **timestamp**, plus **Show details** and, where a check is behind the event, **Trace**.

Titles adapt to the kind of agent: what reads **Ticket check** on a helpdesk agent reads **Alert check** on a monitoring one, so a mixed fleet stays legible.

### What the events mean

The catalog covers the whole lifecycle of agent work. Grouped by the type chip they fall under:

- **Proposal**: the agent drafted something for review. A reply, note, or ticket update was created and is waiting for a decision.
- **Decision**: a proposal was **approved**, **rejected**, or **dismissed** (set aside without counting against the agent), or an attention item was **acknowledged**. Approvals and rejections can also happen automatically once that action type is running on its own; a dismissal and an acknowledgement are always a person's deliberate choice.
- **Execution**: a change was actually sent to the ticket, or an execution **failed**. Automatic executions and their failures show here too.
- **Configuration**: someone changed how an agent runs. Its **watching settings** or general **configuration** were updated, an action type was switched to **automatic** or **turned off** (or **demoted** back to asking first), or an **agent was deleted**. Safety limits landing (**Daily safety cap reached** and **Per-run safety cap reached**) are filed here too rather than under Error, because a cap doing its job is a deliberate stop, not a malfunction.
- **Checks**: the agent looked for work. One entry per check, whether or not it found anything. See below.
- **Pause**: an **emergency pause was enabled** or **lifted**, or a **ticket watcher was paused** because a pause was in effect.
- **Error**: something went wrong that you should know about (a single **ticket could not be processed**, a **run failed**, the **ticket watcher failed**, or an automatic execution failed).

You don't need to memorise these: the event titles are written in plain language, and the type chips let you filter down to the ones you care about.

### Check entries

A check entry tells you what the agent found, in its title, without you having to expand anything:

- **Ticket check: no new tickets**: it looked and there was nothing to do. This is what a healthy, quiet agent looks like.
- **Ticket check: 3 new tickets**: three tickets were picked up for work.
- **Ticket check: 3 new tickets, 2 already seen, 1 error**: the same, plus tickets it had already handled and a problem it hit.
- **Ticket check: Not watching** / **Paused** / **Skipped** / **Failed**: the check didn't do its normal job, and the reason follows where there is one.

**Show details** breaks the same check down into four numbers (**Seen**, **Queued**, **Already seen**, **Handled**), plus the reason and any error messages. That is the honest way to answer "why didn't the agent pick up ticket #482?": if **Seen** is high but **Queued** is zero, the ticket was looked at and filtered out by your targeting; if **Seen** is zero, the agent never saw it at all.

---

## Show details

**Show details** expands an entry into the full evidence behind it. Depending on the event, you may see:

- The **check breakdown** described above.
- The complete **Proposed message**: the full text the agent drafted, not just the one-line preview.
- **Field changes**, written as "Field: from → to" (for example "Status: Assigned → Pending"), so a classification, status, assignment, or observer change is legible without opening the ticket.
- The **Reason**: the agent's short justification for the proposal.
- The **Reviewer note**: the note captured when the proposal was decided.
- A **"{n} sources cited"** line: how many of your [Knowledge library](knowledge.md) results backed the drafted reply. This is the honest signal of whether the reply is grounded in your own sources; a reply with cited sources is one the agent could stand behind. Its absence on an administrative or procedural reply is normal and does not mean something failed. For how that plays out during review, see [Approvals](agents-approvals.md).

---

## Loading more

The timeline loads the 50 most recent matching entries and tells you where you stand: **{n} of {total} shown**. **Load more** appends the next 50 without disturbing what you've already read or the filters you set. There is no page number to lose your place in. Keep pressing until you reach what you're looking for.

The counter is worth reading on its own. "50 of 1,284 shown" is a signal that you should probably narrow the filters rather than keep clicking.

Entries don't stay forever. Each agent keeps its own history for as long as its **Keep activity history (days)** setting says: 30 days by default, and anything older is deleted automatically overnight. If you need to keep a record beyond that, capture it while it's here. Work you still have to decide is never purged.

---

## Technical trace

The **Trace** button opens the **Technical trace** dialog over the page. Nothing navigates away, so closing it puts you back exactly where you were. This is an optional diagnostics view aimed at administrators troubleshooting a specific check; you never need it for day-to-day review, and everything a requester or technician would want is already in **Show details**.

It reconstructs how a single check unfolded:

- When the run **started** and **finished**, and how long it **took** in total.
- The numbered **steps** the agent went through, each with its own status and how long it took.
- The **tool calls** it made, with their durations, useful when a check was slow or timed out.
- The **evidence** it gathered, shown as a short summary plus the kind of source it came from.

Those timings are the point of the dialog: a check that took four minutes has one slow step in it, and this is where you find it.

A **Show raw trace** toggle reveals the underlying machine-readable record for the rare case where you need the exact detail; leave it collapsed otherwise.

The same **Trace** button appears in [Approvals](agents-approvals.md) and on an agent's **Monitor** tab, and opens this same dialog in place, which is the usual way to get here while reviewing.

---

## Tips

- Searching by **ticket number** is the fastest way to hand someone the full, ordered story of one ticket (check, proposal, decision, and what was sent) without clicking through the ticket itself.
- **Turn Checks on when an agent seems idle, and off again afterwards.** It is the difference between "the agent is broken" and "the agent is watching and there's nothing to do", but it is noisy, which is why it starts off.
- Reach for the **Execution** filter to see only what actually left the building. Proposals and decisions are intentions; executions are the changes a requester or technician can see.
- A **Daily safety cap reached** entry is the system working as designed, not a bug. If an agent went quiet for the rest of a day, this is usually why. Raise its daily limits in the agent's [Settings](agents-workspace.md) if the cap is too tight for your volume, and check the **Today** figures there before you pick a new number.
- Use **Trace** only when you're chasing a slow or failed check; for "what did it say and why did we approve it", **Show details** already has the answer.
- This page never changes anything, so it's safe to hand read-only (`ai_agents:reader`) access to anyone who needs to audit agent behaviour without the ability to act on it.
