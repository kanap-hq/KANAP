# Portfolio Reporting

Portfolio Reporting provides analytics focused on workload, capacity, and delivery signals.

## Getting started

Navigate to **Portfolio > Reporting** to open the reporting hub.

**Permissions**:
- You need at least `portfolio_reports:reader` to access portfolio reports.

If you do not see Reporting in the menu, ask your administrator to grant you access.

---

## Reports landing page

The Portfolio Reporting landing page lists available portfolio reports as cards, in three rows read by horizon. Click a card to open the report.

**What happened**
- **Period review**: requests, projects and tasks created, modified and closed over a period.
- **Activity by person**: the same page, opened on its by-person reading of the tasks.
- **Time logged**: where the logged days go, month after month: projects or other work, team by team.

**What is in progress**
- **Flow and age**: what comes in and goes out week after week, how old the open work is, and how long a closing takes.
- **Attention by contributor**: open, overdue and stalled tasks, team by team and person by person.

**What comes next**
- **Upcoming**: tasks falling due, planned project ends and starts, requests awaiting review for too long, and requested deliveries.
- **Capacity Heatmap**: expected workload against capacity, for contributors and teams.

---

## Steering

The first strip above the report cards is the daily steering view. It answers two questions: what moved lately, and what is waiting for someone.

### The period

The header shows the period in use and lets you switch between the last 7, 30 and 90 days. The period always ends today and is read in your own time zone. Your choice is remembered on this browser.

### Flow

One line per entity reads like this: **14 created · 9 closed · 52 open (+5)**.

- **Created**: items created during the period and still present today.
- **Closed**: items whose last status change of the period left them closed. The creation counts as a status change, so an item created already done counts as closed. Closed means Done or Cancelled for tasks and projects, Rejected or Converted for requests.
- **Open**: items open right now, whatever happened during the period. This figure is a link to the matching list.
- **(+5)**: the net change, shown only when it is not zero. It is created, plus reopened, minus closed. Reopened items are items that went from a closed status back to an open one. Hover the figure to see the formula.

Created and closed come from the change history, so they include every way an item can be written: the app, a CSV import and the agents. No list filter reproduces that history, so these two figures open the [Period review](#period-review) on the same days instead. Its created and closed lists show exactly the items counted here. A zero is not a link.

### Which tasks count

Every task figure counts standalone tasks and project tasks only. Tasks attached to a contract, an OPEX line, a CAPEX line or an incident belong to those workflows and are left out everywhere in this strip.

### Needs attention

The last line appears only when something needs a decision:
- **Overdue tasks**: open tasks whose due date is before today. The figure opens the task list filtered on the same items.
- **Tasks without assignee**: open tasks nobody owns. The task list has no filter for an empty assignee, so this figure is not a link.
- **Projects without activity for 30 days**: projects in progress or in testing where nothing has happened for a month. Clicking it opens a short list of those projects with their last activity date, and each name opens the project.

Activity is read widely. A project counts as active when anything changed on it or on one of its tasks, when someone wrote in its journal, or when time was logged on the project or on one of its tasks. A project only appears here when all of those are older than 30 days.

---

## To classify

Above the report cards, a compact strip shows how much of your open work is still missing a classification value. Use it as a daily steering aid: see the gap, click it, fix it.

### What it counts

One line per entity, for open items only:
- **Tasks**: status other than Done and Cancelled.
- **Requests**: status other than Rejected and Converted.
- **Projects**: status other than Done and Cancelled.

Each line reports how many of those items have no Source, no Category and no Stream. Tasks also report how many have no Task Type.

### Which tasks are excluded

Only standalone tasks and project tasks are counted. Tasks attached to a contract, an OPEX line, a CAPEX line or an incident never carry a classification, so counting them would report a gap nobody can close.

A project task with no classification of its own inherits the one of its project, and the task list shows that inherited value. The counts follow the same rule, so a figure never sends you to a list where the column is already filled.

### Streams

A missing Stream is only counted when the item already has a Category and that Category offers at least one active Stream. Many categories have no stream to choose from. An item with no category at all is already counted under Category.

### Opening the list

Every figure above zero is a link. Clicking it opens the matching list, already filtered on exactly the items behind the figure, across the whole tenant. The list total matches the figure you clicked. Zeros are shown for context but are not clickable.

When nothing is missing, the strip shows a single line confirming that everything open is classified.

---

## Upcoming

Use this report to see what falls due soon and what has been waiting too long. It is the only report that looks ahead: the period review reads the past, the flow report and the attention blocks read the present.

### What it shows

The page has five sections. Each one shows how many items it holds, a table sorted by date, and a horizon you can change on the right of its title.

- **Planned project ends**: open projects whose planned end falls between today and the end of the horizon. Horizon: 30 (default), 60 or 90 days. Projects already past their planned end stay in the flow report; a line gives their number and opens it.
- **Planned project starts**: projects still in Waiting list or Planned whose planned start falls in the same horizon.
- **Requests awaiting review**: requests still Pending review, created at least 14, 30 (default) or 60 days ago. Candidate, Approved and On hold requests already had a decision, so they are not listed here.
- **Requested deliveries**: open requests (Pending review, Candidate, Approved, On hold) whose requested delivery date falls in the project horizon.
- **Tasks due**: open tasks (Open, In progress, Pending, In testing) due between today and the end of the horizon, both days included. Horizon: 7, 14 (default) or 30 days. Only standalone tasks and project tasks count, like in the other reports. A line below the title gives the number of tasks already overdue, with a link to them.

The project horizon is shared: changing it in one of the three sections that use it changes it in all three. The page remembers your horizons and the sections you folded.

### Filters

- **Project**: tasks of those projects, those projects themselves, and requests linked to them.
- **Team**: tasks assigned to a member of the team, and projects and requests that involve one.

### Opening the list

Every figure above zero is a link. It opens the task, project or request list filtered on exactly the items of the section, with the same project and team filters, so the list total matches the figure. The report has no export: the lists already export.

---

## Capacity Heatmap report

Use this report to understand current workload, capacity pressure, and unassigned work.

### What it shows
- **Remaining effort** (IT + Business), adjusted by execution progress.
- **Capacity** per contributor (historical or theoretical).
- **Months of work** (remaining days / capacity days per month).
- **Unassigned work** when effort is not fully allocated.
- **People without a contributor profile** who are staffed on a project. They appear at the end of the list with their remaining days and no capacity, so their load stays visible. Create their contributor profile to give them a capacity.

### Filters
- **Teams** (multi-select, includes **No team**)
- **Status** (default: Waiting List, Planned, In Progress, In Testing, On Hold)
- **Capacity mode**: Historical (default) or Theoretical
- **Group by**: Contributors (default) or Teams

### Color scale
Cells in the **Months of work** column are color-coded:

| Range | Color |
|-------|-------|
| <= 1 month | Green |
| 1-3 months | Yellow |
| 3-6 months | Orange |
| 6-12 months | Red |
| > 12 months | Violet |
| No data | Gray (N/A) |

### Summary cards
The summary row includes:
- **Total contributors**
- **Average months of work** (contributors with capacity only)
- **Unassigned work** (total unallocated days and project count)

Click **Unassigned work** to expand details.

### Drill-down
Click a contributor row to open a project breakdown:
- Each row shows remaining effort, allocation %, and your days.
- Project names are clickable and open the project's **Progress** tab.

### Exports
- **CSV**: Export the heatmap table
- **PNG**: Snapshot of the report
- **Print**: Print or save as PDF

---

## Period review

Use this report to see what happened to requests, projects and tasks over a period. The report follows the portfolio funnel: requests first, then projects, then tasks.

### What it shows

Each of the three sections holds the same three lists.

- **Created**: items created during the period.
- **Modified**: items changed during the period without being created or closed in it.
- **Closed**: items whose last status change of the period leaves them in a closed status.

An item created and closed inside the same period appears in both lists, with its own date in each. It never appears under Modified: Modified is what is left once creations and closures are accounted for.

The creation counts as a status change. A CSV import or an agent can create a task already done, or a request already rejected. Such an item is listed as created and as closed on the same day, even though nobody ever changed its status afterwards.

Closed means different statuses per type:

- **Requests**: converted or rejected. A request has no cancelled status.
- **Projects**: done or cancelled.
- **Tasks**: done or cancelled.

Each list shows the count in its heading. A list with nothing in it stays on a single line, so a report with little activity stays short.

### Which tasks count

The Tasks section covers portfolio tasks only: standalone tasks and tasks attached to a project. Tasks attached to a contract, an OPEX line, a CAPEX line or an incident are left out. This is narrower than earlier versions of the report, which counted every task.

### Where a project came from

The Projects created list carries an **Origin** column.

- A project converted from a request shows that request, for example `REQ-12 Cave climate digital twin`. Click it to open the request.
- A project created without a request shows how it entered the portfolio, in the words used everywhere else in KANAP: **Fast-track**, **Legacy** or **Request**.

### Folding a section

Each section title carries a chevron. Click the title row to fold the section away, and click it again to open it. A folded section keeps its counts next to its title, so you still see what it holds.

Your choice is remembered on this browser, section by section. Printing is not affected: a printed report always carries the three sections in full.

### What changed

The Modified lists carry a **Changes** column. It reads the audit trail of the period and shows:

- the status move, when the status changed, as `In progress -> In testing`;
- then the fields that changed, in plain language, separated by commas.

The wording matches the history feed on the item itself. Fields rewritten on every save, such as the technical update timestamp, are left out.

### Filters

- **Start date** and **End date** (defaults to the last 7 days)
- **Source** (multi-select)
- **Category** (multi-select)
- **Stream** (multi-select; scoped to the selected categories)
- **Task types** (multi-select; applies to the Tasks section)
- **Status reached** (multi-select, grouped by requests, projects and tasks)

Filters apply to all nine lists, and to the by-person reading.

**Status reached** keeps the items whose last status change of the period left them in one of the selected statuses. The creation counts as a status change: an item created during the period and never moved afterwards reached the status it was created with. An item whose status did not change during the period matches no status, so it drops out as soon as a status is selected. The status shown in the Status column is the one the item holds today, which can differ: a task closed during the period and reopened since then reached **Done**, and shows **Open**.

A status shared by several types, such as Done or On hold, is one choice: ticking it under Tasks also ticks it under Projects.

### Table columns

Every list starts with the business reference (`REQ-12`, `PRJ-3`, `T-4`) and the name. Clicking the name opens the item.

**Requests**: Reference, Request name, Source, Category, Stream, Company, Status, date of the event.

**Projects**: Reference, Project name, Origin (created list), Priority, Source, Category, Stream, Company, Effort, Status, date of the event.

**Tasks**: Reference, Task name, Task type, Priority, Source, Category, Stream, Company, Status, date of the event.

A task with no company of its own shows the company of its project, the same way the task list reads it.

The date column carries the creation day on the created lists, the last change day on the modified lists, and the closing day on the closed lists. Days are read in your own time zone.

The closed lists carry two dates: **Created on**, then **Closed on**. The creation day is always shown, even when the item was created long before the period. It tells you at a glance how long the item took.

Modified lists add the **Changes** column at the end.

### Exports

- **CSV**: nine blocks in the order of the page, each with its own heading and header row.
- **XLSX**: three sheets, Requests, Projects and Tasks. Rows run created, then modified, then closed, with a leading **Event** column that says which list a row comes from. The name cell links back to the item.

Both exports carry the reference, the company, the origin of a project, the changes of a modified row and the event date. The closed rows also carry the creation day.

Both files are written in the language of the screen: titles, column names, statuses, the changes, yes or no and the days. The CSV also takes that language's separator and decimal mark, as described in [CSV files](csv-files.md).

## Time logged

Days logged month after month, on projects or on other work, team by team and person by person. It shows how the workload is spread, not who logs the most: teams keep their configured order and people are listed alphabetically.

### Where the days come from

The report reads every time entry: the time logged on tasks and the time logged directly on a project. A day is 8 hours, and figures carry one decimal. Each entry falls in the month of its date, in your own time zone.

- **Project days**: time logged on a task that belongs to a project, or directly on a project.
- **Other days**: all other time, such as standalone tasks.

Choose **6 months** or **12 months**. The current month is always the last one. The page remembers your choice.

### What it shows

- **Tiles**: project days, other days, the total, the project share, and the number of contributors who logged nothing over the period. Work outside projects is often logged less than project work, and this last tile is a reminder of that.
- **Chart**: project and other days stacked, month by month.
- **Table**: one row per team, one column per month. Each cell shows the days logged, with project days / other days below. Expand a team to see its people. A contributor who logged nothing still appears, with empty cells. People without a team are grouped under **No team**. Time logged without a person appears there as **Unknown user**.

The report shows days only. It never shows the notes of an entry.

### Filters

- **Team**: the people of the selected teams.
- **Project**: only the time logged on the selected projects, on their tasks or directly. Other days are then zero.

### Exports

- **CSV**: one line per person and month, with the team, the person, the month, project days, other days and the total.
- **PNG**: the chart.

## Tips
- **Keep contributor profiles updated**: Capacity is based on contributor availability and historical time stats.
- **Use team filters**: Scope the report to a department or function.
- **Check unassigned work**: Helps surface projects with missing allocations or missing leads.
- **Period review for stand-ups**: Export the Period review as XLSX and share it with stakeholders for status meetings.
