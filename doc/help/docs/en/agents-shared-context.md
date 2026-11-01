# AI Agents: Shared context

Shared context is a small library of reusable background guidance that you write once and hand to your agents. A profile is a named set of a few plain-language lines about your IT environment: how your fleet is managed, what your agents should and shouldn't say, the conventions your service desk follows. The same profile can be attached to any agent, where it shapes how that agent interprets incoming tickets and how it words its replies.

The point is consistency without repetition. Instead of re-teaching every agent the same house rules, you keep them in one profile and point each agent at it. Change the profile once and every agent using it picks up the new guidance.

One thing to be clear about from the start, because it drives every good use of this feature: shared context is **not a permission grant and not a citable source**. It steers tone and interpretation, but its lines are never quoted back to a requester and grant no new data access. Facts you expect an agent to cite belong in a [Knowledge library](knowledge.md), not here.

---

## Where to find it

- Workspace: **AI Agents > Shared context**
- Route: `/agents/shared-context`
- Permissions:
  - `ai_agents:reader` lets you open the page and read the profile list
  - `ai_agents:admin` (or `ai_settings:admin`) is required to create, edit, archive, and restore profiles
- Availability: the whole AI Agents section only appears when AI is enabled on the instance and you hold `ai_agents:reader`

Without an admin level you still see the full list of profiles, but the **New profile** button and the per-row Edit, Archive, and Restore controls are hidden. The page is read-only for you.

---

## What a profile is

A profile bundles three things:

- A **Name** that identifies it, for example `Default IT environment`.
- An optional **Description** for your own reference, for example "Company-wide IT context for helpdesk agents".
- A set of **Context lines**: one short background-guidance line per row. Each line is a single instruction or fact about your environment. Typical lines look like "Most users run managed laptops." or "Never ask users for passwords."

Think of the lines as standing guidance rather than a knowledge base. Good lines are the kind of thing you'd tell a new technician on day one: how the environment is set up, what tone to take, and hard "never do this" rules. They influence the stages where the agent decides what to do and where it drafts the reply, without you having to restate them for each agent.

---

## The Profiles list

The **Profiles** section lists every profile on the instance. Each row shows:

- The profile **name**, with an **Archived** tag beside it when the profile is no longer active (archived rows are dimmed).
- The **Description**, when one was provided.
- A summary line: **{n} lines** and, where available, **Updated {time}** so you can see how many guidance lines the profile carries and when it last changed.

Admins get a **New profile** button in the page header, Edit and Archive controls on each active row, and a Restore control on each archived row. An archived profile stays read-only until you restore it: it carries no Edit control.

---

## Creating and editing a profile

**New profile** (admins only) opens the editor dialog. Editing an active profile opens the same dialog pre-filled.

You fill in:

- **Name**: required.
- **Description**: optional, for your own reference.
- **Context lines**: one background-guidance line per row. Blank rows are ignored.

**Save** stays disabled until there is a name and at least one context line. When you're editing an existing profile, saving updates it in place: every agent already pointed at that profile immediately runs on the new lines, so treat edits to a widely-used profile as a change that ripples across your fleet.

---

## Archiving a profile

Archive is for retiring a profile you no longer want agents to use. Before it takes effect, KANAP warns you plainly:

> "{name}" will stop being available to agents. Any agent currently using it will run without shared context until you point it at another profile.

That's the important consequence to absorb: archiving does not automatically move affected agents to a replacement. Any agent that was pointed at the archived profile keeps running, but with **no** shared context, until you go into that agent's settings and select a different profile. If several agents share the profile you're archiving, plan the swap first.

Archived profiles stay in the list, dimmed and tagged **Archived**. They can no longer be edited or attached to an agent until you restore them.

---

## Restoring a profile

**Restore** is on each archived row, in the same place as Archive on an active row. It sets the profile back to active and records the change. Agents that still point at the profile pick up its lines again, and you can edit it or attach it as before. The profile keeps its key the whole time it is archived, so a new profile with the same key is refused. Restore the existing profile to use that key again.

---

## How a profile connects to an agent

Profiles live here, but they're switched on per agent from that agent's **Settings** tab, in the **Objective** section (see [Agent workspace](agents-workspace.md)). Until you turn on **Use shared context**, that's the only thing you see there: the switch and a one-line description. Turning it on reveals the profile selector, a **+ New profile** shortcut for creating one on the spot, and a preview of the selected profile's lines. Pick a profile and the agent runs on it; leave it at **No profile selected** and the agent runs without any shared context.

Because the link is a reference, one profile can back many agents at once, and updating the profile updates all of them. Detaching an agent (or archiving its profile) simply drops the guidance for that agent; it changes nothing about the profile's other users.

---

## The key caveat: guidance, not a source

Shared context and [Knowledge libraries](knowledge.md) both feed an agent, but they do fundamentally different jobs, and mixing them up is the most common mistake here.

- **Shared context** shapes *how* an agent behaves: its tone, its assumptions about your environment, its hard "never do this" rules. Its lines are **never cited** in a reply and grant the agent **no new data access**. They are steering, not evidence.
- **Knowledge libraries** are *what* an agent can quote. Their results ARE cited back in the drafted reply, so the requester can see the source behind an answer.

The practical rule: if you want the agent to state a fact and stand behind it (a policy, a procedure, a specific configuration), put that fact in a knowledge library so it can be cited. Reserve shared context for the standing guidance and guardrails that shouldn't appear as a quoted source. And because a context line is not a permission, writing "the agent may close billing tickets" into a profile grants nothing. Real permissions and automation are governed per action type in the agent's own settings and by the approval flow.

---

## Tips

- Keep lines short, imperative, and one idea each. "Never ask users for passwords." reads and applies more reliably than a paragraph combining several rules.
- Lead with your hard "never" rules: the guardrails you most want honored are worth stating plainly and early.
- Prefer a small number of broadly-useful profiles (for example, one company-wide baseline) over many near-duplicates. Fewer profiles are easier to keep current, and edits reach every attached agent at once.
- Don't smuggle citable facts in here. Anything you'd want a requester to see quoted with a source belongs in a [Knowledge library](knowledge.md).
- Before archiving a shared profile, note which agents use it and repoint them first. Archiving leaves them running with no shared context until you do.
- **Restore** brings an archived profile back. Agents that still point at it use its lines again.
- The **Description** is only for you and never reaches the agent; use it to record who owns the profile or what it's for, so a teammate isn't guessing later.
