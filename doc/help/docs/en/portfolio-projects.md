# Portfolio Projects

Portfolio Projects are the execution workspaces for approved initiatives. They are where delivery is planned, progress is tracked, workload is measured, tasks are coordinated, and project-specific knowledge is connected back to the rest of KANAP.

Projects usually come from approved requests, but they can also be created directly as **Fast-track** or **Legacy** projects when the request stage is not part of the process.

For portfolio-wide sequencing and roadmap work, use [Portfolio Planning](portfolio-planning.md). The Projects area is for running the work once a project exists.

## Where to find it

- Workspace: **Portfolio**
- Path: **Portfolio > Projects**

## Permissions

- `portfolio_projects:reader`: open the list and view project workspaces
- `portfolio_projects:contributor`: update the managed **Purpose** document and maintain project-overhead time entries
- `portfolio_projects:manager`: create projects and manage project data, status, team, relations, timeline, progress, tasks, scoring, comments, and decisions
- `portfolio_projects:admin`: includes manager capabilities and can also import/export CSV and maintain other users' project-overhead time entries
- Knowledge viewing also requires Knowledge access
- Creating or linking standalone knowledge also requires a Knowledge creation role

If Projects does not appear in the navigation, ask an administrator for access.

## Working with the list

The project list is designed to answer two questions quickly: "what should I care about?" and "what is moving?"

**Scope selector**

- **My projects** shows projects where you are explicitly involved as sponsor, lead, or contributor
- **My team's projects** expands that view to projects involving members of your portfolio team
- **All projects** removes the involvement filter
- If you are not assigned to a portfolio team, the team scope is unavailable
- The list opens on **All projects**. Your scope preference is remembered, so the list comes back the way you left it

**Default columns**

| Column | What it shows |
|--------|---------------|
| **#** | Reference number (e.g., PRJ-42). Click to open the workspace |
| **Project Name** | The project name |
| **Priority** | Calculated priority score |
| **Status** | Current execution state with a colored dot |
| **Origin** | Request, Fast-track, or Legacy |
| **Progress** | Execution progress as a bar |
| **Source** | Portfolio source classification |
| **Category** | Portfolio category |
| **Stream** | Portfolio stream |
| **Company** | Company classification |
| **Start** | Planned start date |
| **End** | Planned end date |
| **Created** | Creation date |

**Additional columns** (hidden by default):

- **Last changed**: When the project was last updated

**Default behavior**

- Projects are sorted by priority score unless you change the sort
- Projects in **Done** status are hidden by default
- Search works across text content
- Status, origin, source, category, stream, and company filters are available directly in the grid

**Bulk administration**

- **New Project** is available to managers
- **Import CSV** and **Export CSV** are available to administrators

Opening a project from the list preserves the current list context. The project workspace uses the same context for **Previous** and **Next** navigation, so you can review a filtered set without losing your place.

## Creating a project

Direct project creation is for work that should enter execution without a separate request record.

- New projects open on **Summary** only
- Until the project is saved the first time, the other tabs are unavailable
- Directly created projects use an origin of **Fast-track** or **Legacy**
- Request-origin projects keep their request origin and source linkage

Use **Fast-track** for work that is genuinely being introduced directly into delivery. Use **Legacy** for work that already exists outside the normal intake history. That distinction affects reporting and makes later portfolio analysis much less confusing.

## Workspace mental model

The project workspace has two layers:

- The **main content area** for the operational tabs: **Summary**, **Tasks**, **Timeline**, **Progress**, **Scoring**, **Relations**, and **Knowledge**
- A persistent **Properties** drawer on the right edge for core properties, team assignment, and source requests

Open or close the Properties drawer using the vertical tab on the right edge.

For existing projects, the Properties drawer behaves like a live property panel: changes there are saved immediately. The main tab content follows the usual **Save** / **Reset** workflow when that tab contains draft changes. If you switch tabs or move to the previous or next project with unsaved workspace changes, KANAP asks whether to save first.

## Header and metadata

The workspace header is a control strip, not decoration.

- A copyable **PRJ-...** reference chip
- The project title (click to edit when you have manage rights)
- A compact metadata row: **Status**, **Score**, **Progress**, **IT Lead**, **Planned End**, and **Origin** (or the source request reference for request-origin projects)
- **Previous** and **Next** move through the current list result set, not through every project in the system
- **Send link** emails the current project URL with an optional message

Sending a link does not grant access. It only shares the location. Permissions remain exactly as they were before the email was sent.

Changing the status from the metadata strip opens a status-change dialog so the transition can be recorded properly. That is where you can log the change as a formal decision, capture context, and store the rationale with the transition instead of letting it disappear into hallway memory.

The workflow is intentionally controlled:

- **Waiting List** can move to **Planned**, **On Hold**, or **Cancelled**
- **Planned** can move to **In Progress**, **On Hold**, or **Cancelled**
- **In Progress** can move to **In Testing**, **Done**, **On Hold**, or **Cancelled**
- **In Testing** can move back to **In Progress**, or forward to **Done**, **On Hold**, or **Cancelled**
- **On Hold** can return to **Waiting List**, **Planned**, or **In Progress**, or be **Cancelled**
- **Done** and **Cancelled** are terminal states

## Properties drawer

Treat the Properties drawer as the project's persistent identity card. It is grouped into three sections.

### Core properties

- Project name
- Status
- Origin (during initial creation only; locked afterward)
- Source, Category, Stream
- Company, Department
- Planned start, Planned end

These fields drive reporting, planning, filtering, and default portfolio context. Classification choices are especially important because they affect where the project appears in cross-portfolio analysis.

### Team

Team assignment lives in the drawer so it stays available while you work on schedule, effort, or tasks.

- **Business Sponsor** / **IT Sponsor** capture executive accountability
- **Business Lead** / **IT Lead** identify day-to-day leadership
- **Business Contributors** / **IT Contributors** define the wider working team

These assignments do more than fill boxes:

- they determine what appears in **My projects** and **My team's projects**
- they feed project context in summary and reporting
- they define who is available for effort allocation in the **Progress** tab

If leads and contributors are wrong, your effort planning will also be wrong.

### Source Requests

A read-only list of the request records that produced the project. Click an entry to navigate to the source request workspace.

For dependencies, related projects, and related business/technical objects, see the **Relations** tab.

## Summary

The **Summary** tab is the project cockpit. It is meant to answer the current state of the project in a single pass, not to duplicate every field in the drawer.

### Purpose

The **Purpose** section is a managed project document, not a disposable note field.

- use it for the narrative brief of the project: intent, expected outcome, scope boundaries, and any framing that should travel with the project
- purpose changes follow the workspace **Save** / **Reset** flow
- contributors can update the Purpose even when they cannot manage the rest of the project

This split is deliberate. It allows narrative ownership to be broader than structural project administration.

The Purpose editor includes document import and export:

- **Import** accepts a `.docx` file and converts it to the internal markdown format. If the Purpose already has content, KANAP asks for confirmation before replacing it.
- **Export** lets you download the current Purpose as PDF, DOCX, or ODT.

These tools are useful when a project brief originates in Word or when stakeholders need a formatted copy outside KANAP.

The managed Purpose document is different from the **Knowledge** tab:

- **Purpose** is the embedded, project-owned brief
- **Knowledge** is for standalone documents that may need their own lifecycle, reuse, or relationships

### Activity

Below Purpose, the Summary tab includes the project activity stream:

- **Comments** for discussion, contextual notes, and formal decisions
- **History** for the audit trail of field and status changes

**History** lists the recorded changes — status moves, field edits, team and relation changes, edits to the Purpose document — and closes with the creation entry: who created the project and when.

Managers can add and edit project comments. Comments can also be recorded as formal decisions, with an outcome and an optional status change. Use that when the discussion itself changes the project's course.

Images can be included in activity comments when visual evidence is useful — architecture sketches, screenshots, or review evidence.

Use **History** when you need to know what changed. Use **Comments** when you need to know why.

## Tasks

The **Tasks** tab is the project's execution queue. The tab badge shows the number of project tasks.

- tasks created here are linked to the project automatically
- tasks can also be created from a timeline phase, which links them to both the project and the selected phase
- the tab supports status filtering and phase filtering
- the default task view focuses on active work by hiding done and cancelled items

This tab is for managing project-linked tasks in context, not for replacing the full task workspace. Opening a task takes you to its own workspace, where task-specific detail and time logging continue.

From a project perspective, the important consequence is this: task status and task time are not isolated. They feed back into Summary and Progress, so neglected tasks make the whole project picture less trustworthy.

## Timeline

The **Timeline** tab is where the delivery structure becomes explicit.

### Project dates

The bottom of the tab shows three lines:

- **Actual**: dates captured by execution events (when the project moved to In Progress and when it reached Done). Read-only in the workspace.
- **Planned**: the intended delivery window. Edit these in the Properties drawer.
- **Baseline**: a snapshot of planned dates captured when the project moved to **In Progress**. Variance against the baseline is displayed as `Nd late` or `Nd early`.

### Phases

Projects can start with a phase template or a fully custom phase plan.

- if no phases exist yet, pick a template and click **Apply Template** to create the initial structure
- once phases exist, they can be reordered (drag the handle), renamed, dated, and status-managed
- each phase row includes a milestone checkbox; ticking it creates a phase-completion milestone for that phase
- each phase has a shortcut to create a task already linked to that phase and project
- **Add Phase** appends a new empty phase
- **Replace with Template** rebuilds the phase structure from a template — use it only when you really mean "start the phase model over"

The phase model affects more than the timeline:

- the active phase appears back in Summary and the metadata bar
- phase-linked tasks inherit delivery context immediately
- phase milestones provide completion markers without creating a separate tracking scheme

### Milestones

Standalone milestones live in their own section below phases. Use **+ Add milestone** to create them. Each milestone has a name, target date, status, and (when triggered from a phase) a link to the phase it represents.

Phase-completion milestones follow the phase they are attached to. Standalone milestones are for checkpoints that should exist outside the phase structure.

### Table and Gantt views

Above the phase list, switch between **Table** and **Gantt** views:

- use the **Table** view when you are shaping the structure
- use the **Gantt** view when you need to see overlap, sequencing, and date spread

Only phases with usable start and end dates appear meaningfully on the Gantt. If the dates are vague, the chart will be equally vague. In Gantt view, you can drag phase bars to adjust start/end dates (with manage permission).

## Progress

The **Progress** tab combines execution progress, workload planning, and actual time consumption. That combination matters because a project that reports 80% progress with 20% of the effort consumed is not necessarily efficient; it may simply be badly estimated.

### Progress and workload

- **Execution Progress** is the overall completion signal for the project
- **Workload consumption** compares actual effort with planned effort

Keep these two numbers aligned with reality. If progress advances without corresponding effort, or effort accumulates without delivery movement, the mismatch is usually telling you something important about scope, estimation, or reporting discipline.

### Estimated effort and allocations

Progress separates estimated effort into:

- **IT effort**
- **Business effort**

Each side can be allocated across the relevant lead and contributors. Allocations depend on the team configured in the Properties drawer, so team changes have planning consequences here as well.

### Actual effort and time log

Actual effort is calculated from two sources:

- **Project Overhead**: time logged directly on the project
- **Task Time**: time logged from the project's tasks

The time log merges both into one view and identifies the source for each entry. This is intentional: project effort should be understood as the whole delivery footprint, not as a fight between "project work" and "task work."

Important consequences:

- task time contributes to project actual effort automatically
- task time is visible here but must be corrected in the task workspace
- project-overhead entries are maintained from the Progress tab
- contributors can maintain their own project-overhead entries
- administrators can maintain project-overhead entries across users

### Baseline effort

When the project moves to **In Progress**, KANAP captures baseline effort values. Later changes are shown as variance against that baseline, which is useful for distinguishing normal delivery updates from quiet scope creep.

## Scoring

The **Scoring** tab keeps delivery tied to prioritization.

- for request-origin projects, the source request remains visible as the scoring reference
- for fast-track and legacy projects, scoring is maintained directly on the project
- managers can review or update scoring, including priority overrides where portfolio rules allow it

The resulting priority score matters outside this tab:

- it appears in the project header
- it is visible in the list
- it affects how projects rank when the list is sorted by priority

If scoring drifts away from delivery reality, portfolio discussions become harder than they need to be.

## Relations

The **Relations** tab brings together the links that explain how the project fits into the rest of the portfolio. The tab badge shows the count of related items.

### Dependencies

Track delivery dependencies on other requests or projects. Use the search field to find and add a related item; remove links you no longer want with the chip's delete icon.

Dependencies are operational, not cosmetic. They shape how delays and sequencing should be interpreted.

### Other relations

Below dependencies, the Relations tab also lets you maintain links to related business and technical context (for example, related applications, business processes, or other portfolio items). Each relation is autosaved.

## Knowledge

The **Knowledge** tab connects the project to standalone Knowledge documents. The tab badge shows the count of related knowledge documents.

It distinguishes between:

- **linked documents**: documents directly attached to the project
- **related documents**: documents discovered through other linked entities such as source requests, dependencies, or connected items

This distinction matters:

- direct links represent documentation that the project explicitly owns or uses
- related links provide context without pretending that everything belongs directly to the project

Depending on your Knowledge permissions, you can:

- create a new blank document already linked to the project
- create a linked document from a template
- link an existing document
- unlink directly linked documents
- open any linked or related document in Knowledge

If you can open the project but do not have Knowledge viewing rights, KANAP will tell you that knowledge exists without exposing the document content. That is expected behavior, not a broken tab.

## CSV import and export

Project CSV tools are available from the list page to administrators.

### Export

Exports support:

- **Full Export**
- **Data Enrichment**
- **Custom Selection**

Use **Data Enrichment** when you want to export, adjust selected fields externally, and import the result back into KANAP with minimal drama.

### Import

Imports are designed for controlled bulk changes:

- download a template first when you need the correct structure
- validate before importing
- use advanced options to choose enrichment vs replacement behavior and insert/update rules

Bulk import is useful for large portfolio maintenance, but it is not a shortcut around project governance. Phase planning, tasks, knowledge, and ongoing delivery control still belong in the workspace.

## Sending a link

Use **Send link** from the workspace header to email a direct project link to internal or external recipients.

- you can send it to platform users or to any email address
- you can include an optional message
- the copied or emailed link points directly to the project workspace

Again, sending a link does not grant access. It only saves people from hunting for the project themselves.

## Practical guidance

- Use the Properties drawer for structural data that should stay visible while you work.
- Use **Summary** for the project narrative, latest activity, and high-level operating picture.
- Use **Timeline** to define delivery structure before task volume grows.
- Use **Progress** regularly, otherwise effort variance arrives as a surprise even though the data was already warning you.
- Use **Knowledge** for reusable or governed documentation, not as a second copy of the Purpose brief.
- Use **Import** on the Purpose editor when a project brief already exists as a Word document, rather than reformatting it by hand.
