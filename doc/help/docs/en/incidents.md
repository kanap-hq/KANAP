# Incident register

The incident register is the logbook of the notable events that affected your IT: the outage that stopped invoicing for three hours, the ransomware attempt caught by the mail filter, the storage failure that lost a day of backups. Each incident gets a permanent number, a timestamped journal that nobody can rewrite, and links to the assets, applications, tasks and documents involved.

It is not a helpdesk. Day-to-day tickets stay in your ticketing tool; the register keeps the events your management, your auditors and your insurer will ask about a year from now.

## What belongs in the register

Log an incident when the event is worth remembering:

- Service interruptions that affected users, customers or a business process
- Security events: intrusion attempts, malware, data leaks, lost devices
- Data loss or corruption, failed restores, backup gaps
- Serious supplier or hosting failures, breached service levels
- Anything you will have to explain later, or report to an authority

Do not log routine work: password resets, single-user problems, standard change requests, or a ticket that was solved in ten minutes with no impact. A good register holds a handful of entries per month, not thousands.

**Tip**: keep the ticket number in the **External reference** field so anyone can jump back to the operational trail in your ticketing tool.

---

## Getting started

Navigate to **IT Landscape > Incidents** to see the register. Click **New incident** to log one.

**Required fields**:

- **Title**: a short factual summary, e.g. "Mail service unavailable at the Lyon office"
- **Severity**: Critical, Major, Minor or Low
- **Detected**: when the incident was noticed (defaults to now)

**Recommended on the same screen**:

- **Description**: what happened, as observed
- **Category**: infrastructure, security, application, data, supplier, other (configurable, see [Categories](#categories))
- **Started**: when the incident actually began, if it differs from when you noticed it
- **Owner**: who is responsible for handling it

**Reporter** defaults to you. Both dates accept past values, so an incident discovered on Monday morning can be recorded as having started on Saturday night.

**Permissions**:

- View: `incidents:reader`
- Create, edit, journal, links, attachments: `incidents:contributor`
- Reopen, cancel, delete, and lift a restriction: `incidents:admin`

These permissions also cover the incident review and the PDF export, so someone who works on incidents does not need any Knowledge permission to write the review. See [Overview](#overview).

A restricted incident is hidden from everyone except register administrators, the reporter and the owner. On a stock tenant that means Administrator and IT Landscape Administrator, plus whoever logged or owns that record. Readers and contributors who are not the reporter or owner do not see it in the list, in search, in chat or in a CSV export. Opening it by reference returns the same “not found” as a missing number. Linked tasks keep the `INC-N` reference but drop the title. The incident review is covered by the same restriction, wherever it is reached from: Knowledge, search, the assistant, exports and the images pasted into it.

**Restrict to register administrators** is in the properties drawer, under Classification. A contributor can turn it on while they can still see the record; only an administrator can turn it off, including after the incident is closed. The change is written to the journal. The audit log, document relation chips and “recently viewed” still show the title to people who already have those screens.

---

## Working with the list

The list is the register itself: every incident, newest detection first.

**Default columns**:

| Column | What it shows |
|--------|---------------|
| **Ref** | Incident reference (e.g. `INC-14`), monospaced |
| **Title** | Short summary (click to open the incident) |
| **Category** | Classification from IT Landscape settings |
| **Severity** | Critical, Major, Minor, Low, with a coloured dot |
| **Status** | Open, In progress, Resolved, Closed, Cancelled, with a coloured dot |
| **Detected** | When the incident was noticed |
| **Resolved** | When service was restored |
| **Owner** | Person responsible |
| **Assets** | Number of linked assets |
| **Tasks** | Number of follow-up tasks |

**Default sort**: **Detected** descending (most recent first).

**Additional columns** (hidden by default, available via the column chooser): **Closed**, **Applications**, **Created**.

**Filtering**: Category, Severity, Status and Owner offer checkbox filters whose options are computed from the incidents currently in view, so you only see values that exist in the result set. Date columns offer date filters, including a range: filter **Detected** between two dates to produce a quarterly or yearly extract. The search box matches the title, the description, the reference (`INC-14`), and the names and references of linked assets and applications, so a search for a hostname such as `PAR-ESX-01` lists the incidents on that asset. Words that only appear in the incident review are found by the global search and by the assistant rather than by this box.

**Tip**: combine Severity = Critical, Major with a **Detected** range to build the shortlist most steering committees and audits ask for.

Whatever you filter carries over into the incident you open, so **Previous / Next** in the workspace walks that same shortlist.

---

## The incident workspace

Click any row to open the incident. The workspace has a **header** with the reference and quick metadata, a **properties drawer** on the right, and a **content area** in the centre that switches with each tab.

### Header and metadata

The header shows the title (editable in place), the reference `INC-N` (click to copy), the lifecycle actions, and **Previous / Next** to walk the filtered list.

The metadata line underneath shows **Status**, **Severity**, **Owner**, **Detected** and, once the incident is resolved, the **Duration** between detection and resolution. Severity, Owner and Detected can be changed straight from that line.

### Properties drawer

The drawer stays visible on every tab and saves as you edit.

**Classification**:

- **Category**: from the list configured in IT Landscape settings
- **Severity**: Critical, Major, Minor, Low. Pick the level that reflects the business impact at the time; every change is journaled, so raising or lowering it later is normal and traceable
- **Status**: Open, In progress, Resolved, Closed. The status only moves forward. Going back is done with **Reopen**, so the register cannot be quietly rewound
- **Restrict to register administrators**: hide the incident from other readers and contributors. The reporter and the owner still see it. Only an administrator can lift the restriction, including after close. When it is on, the metadata line shows **Restricted**

**Dates**:

- **Started**: when the incident actually began
- **Detected**: when it was noticed (required)
- **Resolved**: filled in automatically when you set the status to Resolved, and editable while the incident is open, so you can correct it to the real restoration time
- **Closed**: read-only, stamped when the incident is closed

**People**: **Reporter** (who logged it) and **Owner** (who handles it).

**Source**: **External reference** for the ticket number, alert id or mail reference where the incident was first reported.

**Compliance**: **Personal data affected**, **Authority notification required**, **Notified on** (appears once notification is required) and **Parties informed**.

**Record**: **Created** and **Updated** timestamps, read-only.

---

### Overview

The Overview tells the story of the incident in two parts: a short description, then the incident review. Both save automatically as you type.

**Description** is one or two sentences on what happened, as observed. It is the summary that appears in the list, in search results and at the top of the PDF report.

**Incident review** is the full account, written in a document rather than in plain text boxes. It takes headings, lists, tables, links and images you paste straight into the text.

A new incident starts from the **Incident review** template, which proposes the five parts an incident report is normally read in:

- **Detailed description**: what happened, in detail
- **Impact**: services, sites and users affected
- **Root cause**: why it happened
- **Corrective actions**: what was done to fix it and to prevent it. Track the actual follow-up work as linked tasks
- **Lessons learned**: what to keep from this incident

Rewrite them, remove the ones you do not need, add your own. For a minor incident the short description alone is enough. For a major one, the review is the post-mortem.

The headings come in the language of the person who logs the incident (English, French, German or Spanish). A template your administrators have rewritten keeps its own words.

The template is an ordinary Knowledge document, stored in the **Templates** library under the **Incident review** document type, so a knowledge administrator can rewrite it to match your own post-mortem format. A new template applies to the incidents logged afterwards and never rewrites a review that already exists.

Every save that changes the review keeps a version, so the text can be read back as it stood at any moment, including at the closure of the incident. See [Journal](#journal).

The review is itself a Knowledge document, with its own `DOC-N` reference, filed in the **Incidents** folder of the **Managed Docs** library. Writing it from the incident and exporting the PDF use the incident permissions alone. Opening the same document directly in Knowledge also requires the Knowledge permissions for that library. Either way it stays tied to the incident: it is frozen when the incident is closed or cancelled, and hidden from anyone who cannot see a restricted incident.

---

### Journal

The journal is what makes this a register rather than a form. It lists everything that happened to the incident, most recent first, and **nothing in it can be edited or deleted**, by anyone, at any time.

**Adding a note**: type it in the composer at the top and click **Add** (or press Ctrl+Enter). The date and time next to the button set the moment the note refers to. The time is typed on 24 hours (23:40). It defaults to now, and you can set it to the past: a note added on Tuesday can be recorded as having happened at 23:40 on Saturday, and it will sort into the timeline at that point. KANAP separately stores the moment the note was actually saved, and that timestamp is never editable, so backdating stays honest.

**Automatic entries** appear alongside your notes:

| Entry | When it is written |
|-------|--------------------|
| **System** | On creation: "Incident logged" |
| **Status change** | Every status change, shown as "Status: In progress → Resolved" |
| **Severity change** | Every severity change, same format |
| **Reopened** | On reopening, with the reason you gave |
| **Links updated** | When assets or applications are linked or unlinked, naming them |

Each row shows the author, the time it refers to (hover for "3 days ago"), and the kind of entry for anything that is not a plain note.

The composer disappears once the incident is closed or cancelled. Field edits made outside the journal, such as correcting the description, are recorded in the platform audit trail rather than in the journal.

The incident review keeps its own history. Every save that changes it produces a version, and versions are kept for good. Ordinary editing does not add journal entries: writing the review is not an event of the incident, and the audit trail records who changed what. Closing, cancelling and CSV imports do write a journal entry, and that entry names the version of the review it applies to, shown as "Incident review version 4 (DOC-12)".

Reopening an incident changes none of that. The versions stay, the closure entry keeps pointing at the version that was current when the record was closed, and that text can still be read later with the images it contained, under whatever access rules the incident has at that moment.

---

### Relations

- **Assets**: the servers, VMs or devices involved. Search and select; linking and unlinking is journaled
- **Applications**: the applications and services affected, same behaviour
- **Technologies**: the technologies involved, such as a directory or a database engine, same behaviour. Shown, and counted in the tab badge, only for users who can read the infrastructure
- **Tasks**: the follow-up work. Create a task directly from the incident, and it stays attached to it. The task shows "Incident · INC-14" in its own sidebar, and the incident's Tasks column counts it

Linking is done from the incident side only. A linked asset or application shows the incident in a read-only **Incidents** section on its own Relations tab, so anyone looking at a server sees its history of trouble.

---

### Documents

Knowledge documents linked to this incident: the supplier's report, the procedure that was followed, the note the network team wrote. With `knowledge:member` you can create a document straight from this tab.

The incident review is not listed here. It belongs to the incident itself and is edited on the Overview tab.

---

### Attachments

Drag and drop files or click to select them: screenshots, log extracts, mail exports, the supplier's incident report. Click an attachment to download it. Uploads and deletions stop once the incident is closed.

---

## Closing, reopening and cancelling

**Resolved** means service is restored. **Closed** means the record is final.

Closing locks the incident. Fields, the incident review, journal notes, links, attachments and task creation are all refused, in the interface, in Knowledge, in the assistant and through the API. The Overview shows a one-line banner: "Closed on 12 Mar 2026. Reopen it to make changes." The review is frozen at the version the journal entry names, whether it was closed from the incident or by a CSV import.

**Reopen** (`incidents:admin`) takes a resolved, closed or cancelled incident back to In progress and clears the resolution and closing dates. A reason is required and is written into the journal, so the record shows why it was touched again.

**Cancel** (`incidents:admin`) is for a record that should never have existed: a duplicate, or an event logged in error. A reason is required, the status becomes Cancelled, and the incident is locked like a closed one. Nothing is deleted and the number stays in place, so `INC-13` never disappears between `INC-12` and `INC-14`. A gap in the numbering would be the first thing an auditor asks about.

### Deleting an incident

**Delete** (`incidents:admin`) is a trash icon on the incident page, and on the list once you select rows. It removes a record that has no place in the register, such as a test entry. Other users see neither the button nor the selection.

Before anything is removed, a confirmation lists what goes with the incident: its incident review, its tasks, its journal entries and its attachments (the files too). It also lists the links that are removed: applications, assets and Knowledge documents stay, only their link to the incident goes. The deletion is recorded in the audit trail.

An incident that holds regulatory reporting data cannot be deleted: **Personal data affected** or **Authority notification required** ticked, **Notified on** or **Parties informed** filled in. Such a record is audit evidence (NIS2 authority notification, and GDPR article 33(5), which requires every personal data breach to be documented). The confirmation says so before anything happens: cancel or close the incident instead. In a selection, those incidents are kept and the others are deleted.

---

## Compliance and audit evidence

Two switches in the drawer carry the regulatory part of the record:

- **Personal data affected**: turn it on as soon as personal data was exposed, altered or lost. It is the flag your data protection officer filters on
- **Authority notification required**: turn it on when the event has to be reported, for instance to a data protection authority, a national cyber agency or a sector regulator. **Notified on** then records when you filed, and **Parties informed** lists who was told: regulator, insurer, affected customers, group security

Deadlines and thresholds depend on your jurisdiction and sector. KANAP records the facts and the dates; it does not decide whether you must notify.

**What the register gives an auditor**:

- A continuous, numbered sequence with no deletions and no gaps
- For each incident: when it started, when it was noticed, when it was resolved and closed, and who owned it
- A journal that cannot be rewritten, with every status and severity change dated and attributed
- The evidence itself, as attachments and linked documents
- The incident review, with the root cause, the corrective actions and what was learned, kept version by version, and the follow-up tasks that prove the actions were carried out
- Filtered views by period, severity, category or compliance flag, straight from the list
- A CSV export of the register (**Export CSV** on the list), for auditors and for your own archive. Restricted incidents are omitted unless you are allowed to see them; the file includes a **Restricted to register administrators** column that can be imported
- A PDF report of a single incident (**Export PDF** in the workspace), for the auditor who wants one record rather than the whole register

**Importing an existing register**: **Import CSV** on the list takes a CSV file. Leave the reference column empty to create incidents (KANAP allocates the next INC numbers), or keep the INC-N reference to update the matching records. Each imported incident gets a journal entry saying it came from a file. Export first if you want the exact column layout.

The file carries the short **Description** in one column and the whole **Incident review** in another, as formatted text. That single review column replaces the former Impact, Root cause, Corrective actions and Lessons learned columns. Headings, lists and links survive the round trip; pasted images do not, because they live in the document. An empty review cell leaves the existing text untouched.

Dates and times are written in the local time your browser uses, the way the export language writes dates: an incident detected at 10:38 in Paris reads `16/10/2026 10:38` in French. The header of each date and time column names that time zone after the column name, for example `detected_at (Europe/Paris)`, and the template names it too. The import reads each column in the time zone its header names, so an exported file loads back unchanged wherever it is imported. A header without a time zone, as in older or hand-made files, is read in UTC (Coordinated Universal Time). A time zone KANAP does not recognise stops the import. The import also accepts `2026-10-16T08:38:00Z`, which carries its own time zone.

Importing is the one operation that still writes to a closed or cancelled incident, so a correction that arrives months later can be filed without reopening the record. It creates a new version of the review and a journal entry pointing at it, and it never rewrites the version the closure refers to. Nothing else is relaxed: the register permissions apply, and a restricted incident you are not allowed to see is refused.

---

## Export a PDF report for an auditor

Open an incident and click **Export PDF** in the header actions. KANAP downloads a PDF of that record: `INC-12-incident-report.pdf`. The download uses your signed-in session; it is not a public link.

The report follows the language of the interface (English, French, German or Spanish). It is assembled in this order:

1. Header and properties of the incident
2. The short description
3. The incident review as it currently reads, with its formatting and its images
4. The journal in chronological order, including the review versions the entries refer to
5. Linked assets, applications, tasks and documents
6. The compliance fields
7. The attachments (file name, size and date)

Empty sections are left out, and a review still holding nothing but the untouched template headings counts as empty.

Export is a read. It works on a closed or cancelled incident; the record stays locked. The button is not shown on **New incident**.

---

## Categories

Incident categories are yours to define, in **IT Landscape > Settings**, under **Incidents > Incident categories**. KANAP ships with infrastructure, security, application, data, supplier and other.

Keep the list short. Categories are what you will group a year of incidents by, and a list of thirty is a list nobody uses consistently. Rather than deleting a category that is already in use, mark it deprecated: it disappears from the selector for new incidents while the existing ones keep their history.

---

## Ask the assistant

Plaid can query the register in chat, with the same permissions as the rest of the application. Ask it for a count ("How many critical incidents this quarter?"), a filtered list ("List of open incidents on PAR-ESX-01"), or a full record ("Summary of INC-2"). The last one includes the journal and the incident review, so a question can be answered from the root cause or the lessons learned. A restricted incident stays out of the answers, of the counts and of the sources, review included.

---

## Tips

- **Log early, complete later**: create the incident while it is happening, with a title and a severity. The journal is built for adding facts as they arrive
- **Write notes as facts, with times**: "13:05 failover to the secondary site, mail back for 40 users". Set the date and time so the timeline reflects the incident, not your typing speed
- **Backdate honestly**: Started and Detected are meant to hold the real times. The recorded time of each journal entry is kept separately and cannot be changed
- **One incident, not one per ticket**: a single outage that generated forty tickets is one incident, linked to the assets involved
- **Turn actions into tasks**: the corrective actions section of the review describes the intent; a task with an assignee and a due date is what actually gets done
- **Close deliberately**: closing is the point where the record becomes evidence. Finish the review before you close, because the version kept at that moment is the one an auditor will read, and after that it takes an administrator to reopen the incident
- **Review the register quarterly**: filter by period and severity, look at the recurring categories and the assets that appear more than once. That is where the next budget request comes from
