# My Dashboard

The Dashboard is your personal landing page in KANAP. It gives you a quick overview of your tasks, projects, time logged, and recent activity, all in one place. You can customize which tiles appear, and the dashboard hides any tile you do not have permission to see.

## Where to find it

- Click the **KANAP** logo or navigate to `/`
- This is the default page after login for non-admin users.
- No special permissions are required to view the dashboard itself, but individual tiles depend on your access rights.

## Quick actions

The header strip at the top of the dashboard provides shortcut buttons for common everyday work. Each button is shown only if you have the corresponding permission.

- **Create Task**: opens the standalone task creation flow. Requires `tasks:member` or higher.
- **Log Time**: opens the **Quick Log Time** dialog (see below). Requires `portfolio_projects:contributor` or `tasks:member`.
- **New Request**: opens the request creation flow. Requires `portfolio_requests:member` or higher.
- **New Application**: opens the application creation flow. Requires `applications:member` or higher.
- **New Asset**: opens the asset creation flow. Requires `infrastructure:member` or higher.
- **New Document** (split button): creates a blank Knowledge document, or opens the template picker to start from a published template. Requires `knowledge:member` or higher.
- **Settings** (gear icon): opens the dashboard settings dialog to choose which tiles to show.

### Quick Log Time

The **Log Time** action opens a focused dialog so you can record hours without leaving the dashboard.

- Choose the target: **Project** or **Task**. The choice appears only when you can log time on both.
  - Project entries log time directly against a portfolio project. The list holds only the projects you can log time on.
  - Task entries log time against one of your active tasks: project tasks of those projects, and standalone tasks if you have `tasks:member`. OPEX, CAPEX, and contract tasks are excluded from the picker.
- Pick the project or task from the dropdown.
- Enter the **Hours** (whole hours).
- Pick a **Category**: **IT** or **Business**.
- Add **Notes** if you want context on what you worked on.

Saving checks the permission of the target: a project entry or a project task entry needs `portfolio_projects:contributor`, a standalone task entry needs `tasks:member`.

After save, the dashboard time-summary tile refreshes automatically.

## Sample data line

In a cloud workspace that is empty and has never held sample data, Administrators see one line above the tiles: "Discover KANAP with sample data." **Load** opens the sample data dialog and **Hide** removes the line for good. The line disappears once the workspace holds data and does not return after an erase. See [Sample data](sample-data.md).

## Trial: your path and first steps { #trial-first-steps }

In a trial workspace, a dialog opens the first time you open KANAP. It asks one question per screen:

1. **What brings you to KANAP?** **The IT budget**, **The IT landscape map**, **Projects and requests**, or **Just looking**.
2. **How do you want to start?** **Explore with the complete example**, or **Start with my own data**.

Starting with your own data erases the example. When items were created since the example was loaded, a confirmation gives their number before anything is erased. Only an administrator can choose your own data while the workspace holds the example.

While the example loads, or while the workspace is being erased, a line on the home page says so.

If you close the dialog, the choice waits in **About KANAP**. The line **Path: … · Change** shows the chosen path (**Choose** while nothing is chosen). Anyone can change it while an answer is missing. Afterwards, only administrators can.

### Your first five steps

Once a path is chosen, the **Your first five steps** tile comes first on the home page. It lists the five steps of the path and your progress, for example **2/5**. Each step opens its screen, where the page title is outlined with one sentence of guidance.

- With the example, opening a step marks it done.
- With your own data, click **Done** in the guidance, or the mark next to the step in the tile. The mark also undoes a step.

When the five steps are done, the tile offers the two other paths. The close button (**×**) hides the tile. To show it again, use **Show the first steps** in **About KANAP**.

| Path | With the example | With your own data |
|---|---|---|
| IT budget | The overview, A budget line, A report, A question for Plaid, Your data | Your company, Your budget lines, A linked contract, Your first report, A colleague |
| IT landscape map | The application list, An application record, The servers, Technologies, end of support and vulnerabilities, Your data | Your applications, Your technologies, Your servers, What KANAP found, A colleague |
| Projects and requests | A request and its score, The project it became, Tasks, Time and effort, Your data | Your first request, Your project, The first tasks, The project's budget, A colleague |

## Turn on Plaid line

During a cloud trial, administrators of the Plaid settings see one line under the sample data line while Plaid is turned off and the KANAP included model is offered: "Plaid, the KANAP assistant, is turned off." **Turn on** opens the usual confirmation of the included model. Confirming turns Plaid on. The close button (**×**) hides the line in this browser. The line does not appear after the switch to a paid plan, nor on-premise. See [Plaid Settings](ai-settings.md).

## Dashboard tiles

The dashboard displays a grid of tiles, each showing a different aspect of your work. Tiles are laid out in a responsive grid (three columns on large screens, two on medium, one on small). Tiles you do not have permission to view are not loaded at all.

### My Tasks

Shows your active tasks grouped by urgency:

- **Overdue**: tasks past their due date (highlighted in red)
- **Due This Week**: tasks due within the next 7 days
- **Later**: everything else

Each task shows its title, the linked project (if any), the due date, and a priority badge when the priority is above normal. Click a task to open its workspace.

Displays up to 5 items total, distributed across the three groups.

**Settings**: max items, hide the overdue section.

**Requires**: `tasks:reader`

---

### Projects I Lead

Lists projects where you hold a leadership role (IT Lead, Business Lead, IT Sponsor, or Business Sponsor). Each project shows:

- Your role
- Current project status (color-coded pill)
- Next milestone and its target date, if set

Clicking a project opens the project workspace.

Displays up to 5 items.

**Requires**: `portfolio_projects:reader`

---

### Projects I Contribute To

Lists projects where you are a team member. Each project shows:

- Your team (IT Team or Business Team)
- Current project status
- Number of tasks assigned to you in that project

Clicking a project opens the project workspace.

Displays up to 5 items.

**Requires**: `portfolio_projects:reader` and `tasks:reader`

---

### Recently Viewed

Shows items you have recently opened across the application: projects, requests, applications, assets, interfaces, connections, contracts, tasks, OPEX and CAPEX lines, companies, and Knowledge documents. Each entry shows the item name, its type, and when you last viewed it.

Recently viewed items are stored locally in your browser and are scoped to the current tenant and user. Click **Clear** to reset the list. Items you no longer have permission to access are filtered out automatically. Items deleted since, alone or with another item (such as the tasks of a deleted contract), leave the list.

Displays up to 5 items.

**Requires**: No special permissions.

---

### My Time Last Week

Displays a summary of time you have logged over a recent period:

- **Total hours** logged (prominently displayed)
- **Breakdown by category**: IT, Business, and Other Tasks (non-project)
- **Top projects**: a small bar chart of the projects you spent the most time on

**Settings**: time period in days (7 to 30).

**Requires**: `portfolio_projects:reader`

---

### New Requests

Shows portfolio requests created within a recent period. Each request shows the name, requester, creation date, and a **High** badge when the priority score is above 80.

Clicking a request opens the request workspace.

Displays up to 5 items.

**Settings**: max items, days to look back.

**Requires**: `portfolio_requests:reader`

---

### Knowledge

Shows two Knowledge-focused sections in the same tile:

- **To Review**: documents where you are the active reviewer or approver, including how long ago the review was requested and by whom. The badge color indicates whether you are at the review or approval stage.
- **Last 5 Accessed**: the last five Knowledge documents you opened in this browser for the current tenant.

Restricted libraries respect their access rules: you only see review items and recent documents from libraries you can read. If you have lost access to a previously viewed document, it stops appearing here.

**Requires**: `knowledge:reader`

---

### Compliance

Shows where the classification campaign stands for the applications you can see (retired applications excluded):

- **Progress**: a bar and three counters for reviewed, to review (the classification changed since the last review or was never reviewed), and to complete (a classification field is still empty). Each counter opens the applications list filtered on that state.
- **Attention points**: applications at the most critical business level without a recovery test in the last twelve months, applications at the most critical level without a recovery wave, and applications holding the most confidential data with the lowest cyber criticality. Only points with at least one application are listed; each one opens the matching filtered list. When nothing needs action, the tile says so.

The levels are the ones defined in the IT landscape settings; a deprecated level is never counted as the highest or lowest.

**Requires**: `applications:reader`

---

### Vulnerabilities in your estate { #vulnerabilities }

Shows the vulnerabilities that call for attention in your estate, under the subtitle "CVE to review on technologies in use". The counts follow [What KANAP counts](vulnerabilities.md#what-kanap-counts): vulnerabilities still to review, in the alerts. Each line opens the matching list:

- **Applications at the highest criticality with a critical or high CVE**, for example "2 Critical applications with a critical or high CVE": the applications at the highest business criticality level of your catalog that a critical or high vulnerability reaches. Opens the applications list filtered on that level and on **With severe vulnerabilities**. Needs `applications:reader`, and counts the applications you can read.
- **Critical CVEs published in the last 7 days** and **in the last 30 days**, on technologies in use in the estate: installed on an asset in service or declared by an application in service. Opens the [Vulnerabilities](vulnerabilities.md) page on those vulnerabilities, with the **In use in the estate** filter.
- **CVEs known to be exploited**, on technologies in use in the estate. Opens the Vulnerabilities page on the exploited ones, with the same filter.
- **Assets with a critical or high CVE**. Opens the assets list filtered on **With severe vulnerabilities**.

A line at zero is hidden. When every line is at zero, the tile says "No critical vulnerability to review." A warning follows when a source has not been read for more than 3 days, for example "The NVD has not been read for 4 days": the figures may then be out of date. **View all** opens the Vulnerabilities page.

The tile is on by default. It exists only when vulnerabilities are followed. See [Vulnerabilities](vulnerabilities.md#availability).

**Requires**: `infrastructure:reader`

---

### Team Activity

Shows recent project activity on projects where you are involved (changes, comments, decisions). Each row indicates the project, the activity type, the author, and a short summary. Click an item to jump to the project's activity tab.

**Settings**: max items.

**Requires**: `portfolio_projects:reader`

---

### Project Status Changes

Shows recent project status transitions (from → to) across projects, so you can see which initiatives moved forward, paused, or closed during the last few days.

**Settings**: days to look back (1 to 14).

**Requires**: `portfolio_projects:reader`

---

### Stale Tasks

Shows tasks that have not been updated for a long time. Each item shows the days-stale pill (warning, then error past twice the threshold) and the linked object, if any.

**Settings**: scope (`my`, `team`, `all`) and threshold in days (30 to 365).

**Requires**: `tasks:reader`

## Customizing your dashboard

Click the **Settings** icon (gear) in the dashboard header to open the dashboard settings dialog.

From here you can:

- **Enable or disable tiles**: check or uncheck each tile to control what appears on your dashboard.
- **Reset to Defaults**: restore the original tile selection.

Only tiles you have permission to view appear in the settings list. Changes are saved to your account and persist across sessions and devices.

If all tiles are disabled, the dashboard shows a message prompting you to enable some.

## Tips

- **Start with the defaults**: the dashboard ships with a useful set of tiles already enabled. Try it for a few days before customizing.
- **Use the quick actions**: creating a task, request, or document (or logging time) straight from the dashboard saves you navigating around.
- **Check overdue tasks daily**: the My Tasks tile highlights overdue items in red so nothing slips through the cracks.
- **Use Stale Tasks at team scope**: with `tasks:admin`, switch the Stale Tasks tile to `team` or `all` scope to find work nobody is updating across the organization.
