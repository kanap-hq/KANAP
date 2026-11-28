# Integrations

Use the Integrations page to connect Kadratis to third-party tools that complement the data you already manage in the platform. The main connection is your **GLPI** service desk. That single connection serves two purposes at once: it lets **Kad** (the interactive chat) find and import tickets into Kadratis as tasks, and it feeds the **AI Agents** that watch your service desk and propose or carry out ticket work. The page also hosts the **Netbox inventory** connection, which has nothing to do with AI. New integrations will be added here over time.

## Where to find it

- Module: **Administration**
- Path: **Administration → Integrations**
- Route: `/admin/integrations`
- Permission: `ai_settings:admin` or `infrastructure:admin`. Each card has its own requirement: the GLPI and monitoring connections need `ai_settings:admin`, the Netbox connection needs `infrastructure:admin`. You only see the cards you are allowed to configure.
- Feature flag: the GLPI and monitoring cards share the same `ai_settings` surface as the Kad settings page. When that surface is off, they are hidden. The Netbox card has no feature flag and is available in both the cloud and the on-premise edition.

The credentials you enter here are what both Kad and any AI Agent use to reach GLPI: you configure the connection once, in one place.

---

## GLPI Integration

[GLPI](https://glpi-project.org/) is a popular open-source IT service-management tool. This page stores the credentials Kadratis uses to reach your GLPI instance. What Kadratis does with that connection depends on which feature you point at it.

### How it works

The connection feeds two workflows that you enable and govern separately.

**1. Kad chat import (preview and approve).** An end user asks Kad something like "import the open GLPI tickets assigned to my team". Kad queries GLPI through the credentials you configure here, returns the candidate tickets as a preview in the chat, and creates one task per ticket only after the user reviews the preview and clicks **Approve**. Nothing is written into Kadratis without that explicit approval, so administrators can hand this to end users without worrying about silent data churn.

**2. AI Agents that watch the service desk.** Once GLPI is connected here, an administrator can point a **Helpdesk** agent at it and let the agent watch for new and updated tickets, then propose the work: requester replies, internal notes, and updates to classification, status, assignment, observers, and close/solve. Adding an observer leaves the requester unchanged.  Every agent change is still proposed for your approval before it is sent to GLPI, and hard safety limits, budgets, and freshness checks always apply. This page does not configure any agent behaviour; it only supplies the connection the agents use.

### Used by AI Agents

After you save a working connection here, an administrator sets agents up in the AI Agents section (see [AI Agents: Overview](agents-overview.md)). From **New agent** or an existing agent's **Settings**, they choose this GLPI connection as the service desk the agent watches. The agent reads and drafts against it, but by default it never sends anything on its own: each proposed reply, note, or status change goes to the review queue first.

### Prerequisites

- **Kad chat must be enabled** on your tenant for the chat-import workflow. The page shows an info tooltip next to the section title to remind you of this dependency.
- **AI Agents must be enabled** on the instance for the agent workflow, and the agent must be configured by someone with the AI Agents Admin level (`ai_agents:admin`).
- A GLPI instance reachable from Kadratis over HTTPS.
- A **User Token** for a GLPI user account that has read access to the tickets you want to expose.
- An optional **App Token** if your GLPI instance requires application-level authentication.
- **Profile rights for the agent features**: the GLPI profile of that account needs read access to ITIL categories and entities, which agents use for their targeting filters and for classification, plus read access to groups and users so an agent can route a ticket to a technician group or to a named technician. Routing also requires the right to assign tickets. Finally, grant update rights on tickets for the actions you let the agent perform: followups, classification, status, and assignment.

The integration is configured tenant-by-tenant; the credentials below are scoped to your tenant and never leave it.

### Fields

- **Enable GLPI ticket import**: master switch for the connection. When off, Kadratis will not attempt to query GLPI even if credentials are set: neither Kad imports nor agent checks will reach your service desk.
- **GLPI URL**: the address you open GLPI with, for example `https://glpi.example.com`. The GLPI API must be on: in GLPI, **Setup > General > API**, **Enable Rest API**.
- **User token**: the personal API token of the GLPI account Kadratis will use. In GLPI, open your preferences (your name at the top right), then **Remote access keys**, and copy the **API token**. If it is empty, tick **Regenerate** and save.
- **App token**: optional. In GLPI, **Setup > General > API**, open the API client Kadratis connects through and copy its application token. Leave it empty if the client has none.

The information icon beside each field says where to find its value. A saved token is never shown again: the field shows dots, with **Replace** beside it to enter a new one. A new URL empties the saved tokens: the user token field asks for it again, and the app token field says that the saved token is not sent to the new address. Enter the app token again to keep it.

### Actions

- **Test**: runs an authenticated round-trip against GLPI with the values on the card, saved or not. It is available once the URL and the user token are there. The status line at the top right of the card says how it went: "Last test passed on …" with the response time, or the reason it failed.
- **Save**: available once something changed. Typed tokens replace the saved ones; a token left as dots stays.

The status line keeps the last test of the saved values: it shows again when you come back to the page, with the response time or the reason it failed. A test of values you have not saved shows until you leave the page. Without a test, the status line says **Saved, not tested yet** or **Never tested**, and **Changes not saved** while the card holds changes. Leaving the page with changes on a card asks for confirmation first.

### Secret storage

If your Kadratis instance does not have a configured secret store, a line under the fields says that the tokens cannot be saved. Configure secret storage at the instance level before relying on this integration in production.

---

## Monitoring: PRTG

[PRTG](https://www.paessler.com/prtg) is a network and infrastructure monitoring tool. The **Monitoring: PRTG** card stores the address and the API key that the monitoring agents use to read alerts and sensor health. Like the GLPI card, it needs `ai_settings:admin` and the `ai_settings` surface.

### Fields

- **Enable PRTG monitoring**: master switch for the connection. When off, agents do not reach PRTG.
- **Server address**: the address you open PRTG with in your browser, for example `https://prtg.example.com`.
- **API key**: create one in PRTG under **Setup | Account Settings | API Keys**. Read-only access is enough. A saved key shows as dots, with **Replace** beside it. A new address empties the saved key: the field asks for it again.
- **Server time zone**: the time zone of the PRTG core server, as set in its operating system. Kadratis reads the times of alerts in this zone.
- **Request timeout (seconds)**: how long to wait for PRTG, between 5 and 120. Leave it empty to use 30.

### Actions

**Test** and **Save** work as on the GLPI card: **Test** is available once the address and the key are there. A passed test shows the PRTG version and the number of sensors the key can see. Once a working connection is saved and switched on, the card offers a link to the agents page, where a monitoring agent can be created.

---

## Netbox inventory

[Netbox](https://netboxlabs.com/docs/netbox/) is the source of truth for many infrastructure teams: devices, virtual machines, racks, sites, addresses. The **Netbox inventory** card stores the address and the API token Kadratis uses to read that inventory and keep its assets in step with it. Netbox stays the reference for the equipment it describes; Kadratis keeps the business layer around it.

This connection is independent of the AI features. It needs `infrastructure:admin`, it works in the cloud and in the on-premise edition, and it stays available when AI is turned off.

Configure the connection here, then open the **Netbox** tab of **IT Landscape > Settings** to choose what is imported and run the synchronisation. The full procedure, the matching rules and the troubleshooting table are on [Netbox synchronisation](netbox.md).

---

## Removing a connection

The three cards remove a connection the same way: empty its address, save, and confirm. Kadratis deletes the address and the saved secrets, turns the connection off and writes an entry to the audit log. The confirmation says what changes for each system:

- **GLPI**: tickets can no longer be imported. Tickets already imported stay.
- **PRTG**: monitoring agents can no longer read PRTG and report it as unavailable at their next run.
- **Netbox**: the automatic synchronisation stops. What was already synchronised stays.

The audit log says whether a secret is set, and marks a replaced one: the entry of a save that changes a key or a token at the same address shows **Secret replaced**, and for GLPI **GLPI user token replaced** or **GLPI application token replaced**. The secret itself is never written to the log.

---

## Tips

- **Use a dedicated GLPI account**: create a service account in GLPI with just enough permissions to read the ticket categories you want exposed. That keeps the audit trail clean and lets you revoke access without affecting a real user. If agents will send replies and status changes, give the same account the write access those actions need.
- **Test before announcing**: run **Test** after every change to URL or tokens. The error message is far more actionable than a failure that surfaces inside someone's chat conversation or a stalled agent check.
- **Pair with the right permissions**: only users with `ai_chat:reader` can ask Kad to import tickets. Pointing an agent at this connection needs the AI Agents role (`ai_agents:reader` to watch an agent, `ai_agents:admin` to configure one), with AI Agents enabled on the instance. Combine those with role-based access to tasks if you want to limit who actually creates task records from imports.
- **Plan for token rotation**: GLPI personal tokens can be regenerated. When you do, save the new value here and run the connection test before users (or agents) hit the integration again.
