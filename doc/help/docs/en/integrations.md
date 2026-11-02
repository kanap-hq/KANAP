# Integrations

Use the Integrations page to connect KANAP to third-party tools that complement the data you already manage in the platform. The main connection is your **GLPI** service desk. That single connection serves two purposes at once: it lets **Plaid** (the interactive chat) find and import tickets into KANAP as tasks, and it feeds the **AI Agents** that watch your service desk and propose or carry out ticket work. The page also hosts the **Netbox inventory** connection, which has nothing to do with AI. New integrations will be added here over time.

## Where to find it

- Workspace: **Admin**
- Path: **Admin → Integrations**
- Route: `/admin/integrations`
- Permission: `ai_settings:admin` or `infrastructure:admin`. Each card has its own requirement: the GLPI and monitoring connections need `ai_settings:admin`, the Netbox connection needs `infrastructure:admin`. You only see the cards you are allowed to configure.
- Feature flag: the GLPI and monitoring cards share the same `ai_settings` surface as the Plaid settings page. When that surface is off, they are hidden. The Netbox card has no feature flag and is available in both the cloud and the on-premise edition.

The credentials you enter here are what both Plaid and any AI Agent use to reach GLPI: you configure the connection once, in one place.

---

## GLPI Integration

[GLPI](https://glpi-project.org/) is a popular open-source IT service-management tool. This page stores the credentials KANAP uses to reach your GLPI instance. What KANAP does with that connection depends on which feature you point at it.

### How it works

The connection feeds two workflows that you enable and govern separately.

**1. Plaid chat import (preview and approve).** An end user asks Plaid something like "import the open GLPI tickets assigned to my team". Plaid queries GLPI through the credentials you configure here, returns the candidate tickets as a preview in the chat, and creates one task per ticket only after the user reviews the preview and clicks **Approve**. Nothing is written into KANAP without that explicit approval, so administrators can hand this to end users without worrying about silent data churn.

**2. AI Agents that watch the service desk.** Once GLPI is connected here, an administrator can point a **Helpdesk** agent at it and let the agent watch for new and updated tickets, then propose the work: requester replies, internal notes, and updates to classification, status, assignment, observers, and close/solve. Adding an observer leaves the requester unchanged.  Every agent change is still proposed for your approval before it is sent to GLPI, and hard safety limits, budgets, and freshness checks always apply. This page does not configure any agent behaviour; it only supplies the connection the agents use.

### Used by AI Agents

After you save a working connection here, an administrator sets agents up in the AI Agents section (see [AI Agents: Overview](agents-overview.md)). From **New agent** or an existing agent's **Settings**, they choose this GLPI connection as the service desk the agent watches. The agent reads and drafts against it, but by default it never sends anything on its own: each proposed reply, note, or status change goes to the review queue first.

### Prerequisites

- **Plaid chat must be enabled** on your tenant for the chat-import workflow. The page shows an info tooltip next to the section title to remind you of this dependency.
- **AI Agents must be enabled** on the instance for the agent workflow, and the agent must be configured by someone with the AI Agents Admin level (`ai_agents:admin`).
- A GLPI instance reachable from KANAP over HTTPS.
- A **User Token** for a GLPI user account that has read access to the tickets you want to expose.
- An optional **App Token** if your GLPI instance requires application-level authentication.
- **Profile rights for the agent features**: the GLPI profile of that account needs read access to ITIL categories and entities, which agents use for their targeting filters and for classification, plus read access to groups and users so an agent can route a ticket to a technician group or to a named technician. Routing also requires the right to assign tickets. Finally, grant update rights on tickets for the actions you let the agent perform: followups, classification, status, and assignment.

The integration is configured tenant-by-tenant; the credentials below are scoped to your tenant and never leave it.

### Fields

The configuration form contains:

- **Enable GLPI ticket import**: master switch for the connection. When off, KANAP will not attempt to query GLPI even if credentials are set: neither Plaid imports nor agent checks will reach your service desk.
- **GLPI URL**: the base URL of your GLPI instance, for example `https://glpi.example.com`.
- **User Token**: the personal API token of the GLPI account KANAP will use. Existing tokens are masked; leave the field blank during a save or test to keep the stored value.
- **App Token**: the optional GLPI application token. Same blank-to-keep behaviour as the user token.

### Actions

- **Save settings**: persists the form. Tokens entered in the form replace the stored ones; blank token fields keep what is already stored.
- **Test connection**: runs an authenticated round-trip against the GLPI URL using the values in the form (or, where blank, the stored values). The result banner shows success or the underlying error along with the latency.

### Secret storage

If your KANAP instance does not have a configured secret store, a helper text appears under each token field warning you that the values cannot be persisted. Configure secret storage at the instance level before relying on this integration in production.

---

## Netbox inventory

[Netbox](https://netboxlabs.com/docs/netbox/) is the source of truth for many infrastructure teams: devices, virtual machines, racks, sites, addresses. The **Netbox inventory** card stores the address and the API token KANAP uses to read that inventory and keep its assets in step with it. Netbox stays the reference for the equipment it describes; KANAP keeps the business layer around it.

This connection is independent of the AI features. It needs `infrastructure:admin`, it works in the cloud and in the on-premise edition, and it stays available when AI is turned off.

Configure the connection here, then open the **Netbox** tab of **IT Landscape > Settings** to choose what is imported and run the synchronisation. The full procedure, the matching rules and the troubleshooting table are on [Netbox synchronisation](netbox.md).

---

## Tips

- **Use a dedicated GLPI account**: create a service account in GLPI with just enough permissions to read the ticket categories you want exposed. That keeps the audit trail clean and lets you revoke access without affecting a real user. If agents will send replies and status changes, give the same account the write access those actions need.
- **Test before announcing**: run **Test connection** after every change to URL or tokens. The error message is far more actionable than a failure that surfaces inside someone's chat conversation or a stalled agent check.
- **Pair with the right permissions**: only users with `ai_chat:reader` can ask Plaid to import tickets. Pointing an agent at this connection needs the AI Agents role (`ai_agents:reader` to watch an agent, `ai_agents:admin` to configure one), with AI Agents enabled on the instance. Combine those with role-based access to tasks if you want to limit who actually creates task records from imports.
- **Plan for token rotation**: GLPI personal tokens can be regenerated. When you do, save the new value here and run the connection test before users (or agents) hit the integration again.
