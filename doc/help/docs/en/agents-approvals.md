# AI Agents: Approvals

Approvals is the daily review queue for everything your AI Agents want to do. Before an agent posts a reply, adds a note, reclassifies a ticket, changes its status, reassigns it, or closes it, it puts that work in front of you here as a **proposal**. Nothing on this page has happened yet on the requester's side: a proposal is the agent's suggestion, and it only reaches your connected ticketing system once you approve it. This is where an operator spends most of their time supervising a helpdesk agent: reading each draft and deciding what to do with it: apply the good ones, reject the wrong ones, and set aside the ones that are accurate but should not be sent.

## Where to find it

- Workspace: **AI Agents**
- Path: **AI Agents → Approvals**
- Route: `/agents/approvals`
- Permission: requires AI to be enabled on the instance and the AI Agents Reader role (`ai_agents:reader`) to read the queue. Deciding a proposal, acknowledging an attention row, and re-running an analysis need the contributor level (`ai_agents:contributor`).
- The same queue appears scoped to a single agent on that agent's [workspace](agents-workspace.md) **Approvals** tab. The page at `/agents/approvals` is the combined view across every agent; the workspace tab shows only the proposals from the agent you are looking at. The layout and controls are identical.

---

## What a proposal is

Each proposal is one concrete action an agent wants to take on one ticket. There are eight action types, each with its own label and icon:

| Action | What it does |
| --- | --- |
| **Requester reply** | A message the agent wants to send to the person who opened the ticket. |
| **Internal note** | A note the agent wants to add for your team, not visible to the requester. |
| **Classification** | Changes the ticket’s category, type, priority or urgency according to the instructions. One proposal may contain several fields; it shows the current and proposed values, using category names. |
| **Status** | A move to a different ticket status (for example, from **New** to **Pending**). |
| **Close ticket** | Closes the ticket. See [Closing and solving tickets](#closing-and-solving-tickets). |
| **Solve ticket** | Marks the ticket solved. See [Closing and solving tickets](#closing-and-solving-tickets). |
| **Assignment** | Adds a technician group **or** a named technician to the ticket, following the routing rule written in the agent's instructions. Nobody already on the ticket is removed. The proposal shows who is being added and who is currently assigned. |
| **Observers** | Adds one technician or one assignable group as an observer. The requester stays unchanged, and people already watching the ticket stay. |

For a **Requester reply** or **Internal note**, the body you see is the full drafted message, exactly as it would be posted. Read it as the requester (or your team) would. For the other five types, the body is a short change summary rather than free text, for example `Status: New -> Pending`, `Assignee: Unassigned -> Jane`, or a per-field classification diff, often followed by a **Reason** line explaining why the agent proposes it.

Proposals are grouped by ticket. Each group is headed by the ticket (**Ticket #N**), its current status, a count such as **3 proposals**, and when it was last updated. A ticket can hold several proposals at once (say a reply, a reclassification, and a status change), and you can decide them individually or all together.

---

## The four sections

The queue is organized into four sections by where each item sits in its lifecycle.

### Needs your decision

The proposals waiting on you, grouped by ticket. This is the section where most of your work happens; **In progress** and **Recently finished** are purely informational. When it is clear, it reads *Nothing needs your decision.* Once you decide a proposal, it collapses to a single status line within its ticket group while the ticket's remaining proposals stay open for you.

### In progress

Work that is already moving and needs nothing from you: proposals you approved that are now being applied to the connected ticketing system, and tickets an agent is actively checking. Rows here show live status such as **Waiting to start**, **In progress**, **Executing…**, or **Agent working…**. When nothing is moving the section isn't shown at all: an empty "in progress" list tells you nothing you can't already read from the agent's own status.

### Needs attention

Anything that failed or is blocked: a proposal that could not be sent to the connected ticketing system, or a check that errored out. Each row carries a red caption explaining what went wrong and a **Trace** button that opens the full story without leaving the page. When clear it reads *No agent work needs attention.*

This is the section to watch, and it is no longer a dead end: see [Clearing an attention row](#clearing-an-attention-row) below.

### Recently finished

A collapsible history of the most recently completed items: applied, rejected, dismissed, skipped, or done. It stays folded until you open it, remembers that choice, and shows up to 30 rows with a **+N more** line telling you how many older items exist. Use it to confirm that an approval actually went through, or to check what an agent did while you were away. Rows you acknowledged in **Needs attention** end up here too.

---

## Making a decision: Approve, Reject, and Dismiss

Every pending proposal offers three actions.

- **Approve** reads **Approve** on a proposal you have not decided yet, and **Execute** on one you already approved but that has not run. In both cases it does the same thing: it sends the action to your connected ticketing system, where the agent posts the reply or note, or applies the change. Approving is the moment the requester (or your team) can be affected. Up to that point nothing has left KANAP.
- **Reject** does not apply the action. The proposal is dropped but stays in the audit trail so there is always a record of what the agent suggested and that you declined it. Rejecting a single proposal takes effect immediately. Reject is a quality signal: it counts against the agent's evaluation and its acceptance rate, because it tells the agent the proposal was wrong.
- **Dismiss** also sets the proposal aside without sending anything. Unlike Reject, it does **not** count against the agent. The acceptance rate and the agent's autonomy track record are unaffected. Use it when the proposal is accurate but simply should not go out: a sensitive ticket, a colleague who already answered, a duplicate. It is one click with no reason prompt, and its tooltip reads *Set aside without counting against the agent's track record*. A dismissed proposal can no longer be approved.

If a proposal is currently **blocked** (for example a freshness or safety check no longer holds, or the ticketing system will not accept the change right now), its primary button is disabled and the reason appears in the button's tooltip. The proposal remains visible so you can see why it cannot proceed.

**Approve all**, **Reject all**, and **Dismiss all** appear on a ticket group when there is more than one item to act on, so you can clear a whole ticket in one step. **Approve all** is the coloured, primary button on the group. Clearing a ticket in one decision is the intended rhythm of this page, and the per-proposal buttons are deliberately quieter so the eye lands on the group first. **Reject all** opens a short dialog that confirms how many proposals will be rejected and offers an optional note for the audit trail; **Dismiss all** opens a short confirmation dialog stating that nothing will be sent and the agent's track record is not affected.

Every proposal comes through this queue until enough of your decisions have been captured to promote that action type from **Ask first** to **Automatic** on the agent's [Performance & autonomy](agents-workspace.md) tab. For the action types a requester can see, promotion additionally requires an explicit acknowledgement from an administrator.

### Dismiss vs Reject

Both Reject and Dismiss stop a proposal from reaching the ticket, but they tell the agent very different things, so the choice matters.

- **Reject** when the proposal is wrong or poor: a bad draft, an incorrect classification, an inappropriate status change. Rejection is negative training and evaluation signal: it lowers the agent's acceptance rate and slows its path to acting on its own, which is exactly what you want when it gets things wrong.
- **Dismiss** when the proposal is *right* but should not be sent: the ticket is sensitive, a colleague already replied, it duplicates something already in flight. Because dismiss is neutral, it neither rewards nor penalizes the agent: its acceptance rate and autonomy track record are untouched.

Reaching for Dismiss when you really mean "this was wrong" hides a genuine quality problem, and rejecting a good-but-unsendable proposal unfairly drags down an agent that did nothing wrong. A dismissed proposal shows a grey **Dismissed** status and ages into **Recently finished**; the agent may still propose again on the same ticket in a later cycle, just as it can after a reject. **Dismissed** is not the same as **Expired**: an expired proposal is one nobody decided before its approval window lapsed, whereas a dismissed proposal is a deliberate decision you made.

---

## Closing and solving tickets

**Close ticket** and **Solve ticket** titles are shown in red, because they end the ticket and the requester sees the change straight away. That red title is the only extra flag. There is no separate "terminal" badge.

Approving one of these (on its own or as part of an **Approve all** where any item closes or solves the ticket) opens a confirmation named after the action (**Apply Solve ticket?**). It names the ticket, warns that the requester will see the change immediately, lists every closing item in a bulk approval, and gives you a reason field for the record. You confirm with the action name itself (**Solve ticket** or **Close ticket**). This is deliberate friction: routine replies and notes apply in one click, but closing or solving a ticket always asks you to pause and confirm.

---

## Reading drafted replies: the fallback note

When an agent drafts a **Requester reply** or **Internal note**, it normally grounds that draft in your [Knowledge](knowledge.md) libraries and cites the sources it drew on. Occasionally you will see **This reply is not backed by your knowledge base.** on such a proposal. It means the agent could not back this particular draft with cited sources, so treat it as a plain suggestion and read it closely before approving, rather than trusting it as source-verified.

**Details** opens the technical reason (for support), for example a synthesis error or a blocked leak of internal guidance. You do not need those codes to decide.

The important thing to know is that **the absence of this note is the normal, healthy case.** Most drafts are grounded and carry no caption at all. And a reply can legitimately have no cited sources without triggering this warning (an administrative acknowledgement or a purely internal escalation is not meant to be drafted from your knowledge base). So do not read a missing fallback note as a problem; it means the draft is either properly grounded or was never meant to be. The note only appears when the agent tried to ground a reply and could not.

---

## Clearing an attention row

Rows in **Needs attention** used to be read-only: you could see that a proposal had expired or that a check had failed, but there was nothing to do about it except watch it sit there. Each row now carries two controls.

- **Re-run analysis** asks the agent to look at that ticket (or alert) again, right now. It runs exactly the same pass as **Test on a ticket** on the agent's [Monitor tab](agents-workspace.md), so whatever it comes up with lands back in **Needs your decision** as fresh proposals for you to review. Its tooltip reads *Ask the agent to look at this one again.*, and while it is working, *The agent is looking at it again…* This is the right first move when the failure was transient: a connection blip, a ticket that changed mid-flight, a proposal that expired before anyone got to it.
- **Acknowledge** clears the row for good. Its tooltip reads *Mark this as seen and remove it from the list for good.* Use it when you have understood the failure and dealt with it (or decided it needs no action): the row disappears immediately, does not come back on another device or after a refresh, and the acknowledgement is recorded in the [Activity](agents-activity.md) timeline as a **Decision**, with who cleared it and when. It ages into **Recently finished** like any other closed item.

**Re-run analysis** only appears where a re-run is actually possible: the row has to name a ticket (or alert) the agent can still reach, and the agent itself has to still exist. Where it can't, **Acknowledge** is offered on its own, which is the honest outcome: there is nothing to retry, only something to close. Rows left behind by an agent that has since been deleted say so in place of the button: *Agent no longer exists*.

When the backlog is large (a run of proposals that expired before anyone reviewed them, say), clearing rows one by one is not the answer. Use **Acknowledge all** in the section header instead. It asks you to confirm with the real count, which covers the whole backlog and not only the rows on screen (the section says *Showing the most recent N of M* when there are more), then clears every expired, failed, or dead-lettered item in one go. Proposals that are still being executed are left alone, and the batch is recorded once in the [Activity](agents-activity.md) timeline as a **Decision**. Deleting an agent does the same for its own leftovers automatically, so an agent you retire does not leave a pile behind.

The pairing is deliberate. **Re-run** is for "try that again"; **Acknowledge** is for "I've seen it, it's handled". Between them, **Needs attention** should return to empty rather than growing into a list nobody reads.

---

## Tracing a proposal back to its check

Each ticket group and each attention row carries a **Trace** button. It opens the **Technical trace** dialog over the queue. The page underneath doesn't move, so closing the dialog puts you back exactly where you were, with your scroll position and, in an agent's workspace, your current tab intact. Inside you can follow the full check that produced the proposal: what the agent looked at, the steps it went through and how long each took, and the evidence it gathered. Use it whenever a draft or an update is surprising and you want the reasoning behind it. It is the same dialog described on the [Activity](agents-activity.md) page.

---

## Tips

- Work top to bottom: clear **Needs your decision**, then clear **Needs attention** with **Re-run analysis** or **Acknowledge**. **In progress** and **Recently finished** need nothing from you.
- Nothing here has reached the requester until you approve it. Reading a draft, tracing it, or leaving it in the queue changes nothing on the ticket.
- Reject rather than ignore. A rejected proposal stays in the audit trail with your optional note, which is far more useful later than a proposal that simply expired unattended.
- Dismiss, don't reject, a proposal you simply won't send. If a draft is accurate but shouldn't go out (a sensitive ticket, a colleague already replied), **Dismiss** sets it aside without counting against the agent. Keep **Reject** for proposals that were genuinely wrong.
- A missing fallback note is good news, not missing information. Spend your closest reading on the drafts that *do* carry it.
- If an approved change lands in **Needs attention**, the red caption and the **Trace** button tell you whether it was the agent, a safety check, or the connected ticketing system that stopped it. Fix the underlying cause, then **Re-run analysis**, rather than re-approving blindly.
- Don't acknowledge to make a number go away. **Acknowledge** is a record that a person looked at the failure; a queue you clear without reading is worth less than one you leave alone.
- The combined queue at `/agents/approvals` is fastest when you run several agents; switch to an agent's own **Approvals** tab when you want to focus on just that one.
