# My Dashboard

The Dashboard is your personal landing page in KANAP. It gives you a quick overview of your tasks, projects, time logged, and recent activity — all in one place. You can customize which tiles appear, and the dashboard hides any tile you do not have permission to see.

## Where to find it

- Click the **KANAP** logo or navigate to `/`
- This is the default page after login for non-admin users.
- No special permissions are required to view the dashboard itself, but individual tiles depend on your access rights.

## Quick actions

The header strip at the top of the dashboard provides shortcut buttons for common everyday work. Each button is shown only if you have the corresponding permission.

- **Create Task** — opens the standalone task creation flow. Requires `tasks:member` or higher.
- **Log Time** — opens the **Quick Log Time** dialog (see below). Requires `portfolio_projects:member` or `tasks:member`.
- **New Request** — opens the request creation flow. Requires `portfolio_requests:member` or higher.
- **New Application** — opens the application creation flow. Requires `applications:member` or higher.
- **New Asset** — opens the asset creation flow. Requires `infrastructure:member` or higher.
- **New Document** (split button) — creates a blank Knowledge document, or opens the template picker to start from a published template. Requires `knowledge:member` or higher.
- **Settings** (gear icon) — opens the dashboard settings dialog to choose which tiles to show.

### Quick Log Time

The **Log Time** action opens a focused dialog so you can record hours without leaving the dashboard.

- Choose the target — **Project** or **Task**.
  - Project entries log time directly against a portfolio project.
  - Task entries log time against one of your active tasks (project tasks or standalone tasks). OPEX, CAPEX, and contract tasks are intentionally excluded from the picker.
- Pick the project or task from the dropdown.
- Enter the **Hours** (in 0.25 increments).
- Pick a **Category**: **IT** or **Business**.
- Add **Notes** if you want context on what you worked on.

After save, the dashboard time-summary tile refreshes automatically.

## Sample data line

In a cloud workspace that is still empty, Administrators see one line above the tiles: "Discover KANAP with sample data." **Load** opens the sample data dialog and **Hide** removes the line for good. The line disappears once the workspace holds data. See [Sample data](sample-data.md).

## Dashboard tiles

The dashboard displays a grid of tiles, each showing a different aspect of your work. Tiles are laid out in a responsive grid (three columns on large screens, two on medium, one on small). Tiles you do not have permission to view are not loaded at all.

### My Tasks

Shows your active tasks grouped by urgency:

- **Overdue** — tasks past their due date (highlighted in red)
- **Due This Week** — tasks due within the next 7 days
- **Later** — everything else

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

Shows items you have recently opened across the application — projects, requests, applications, assets, interfaces, connections, contracts, tasks, OPEX and CAPEX items, and Knowledge documents. Each entry shows the item name, its type, and when you last viewed it.

Recently viewed items are stored locally in your browser and are scoped to the current tenant and user. Click **Clear** to reset the list. Items you no longer have permission to access are filtered out automatically.

Displays up to 5 items.

**Requires**: No special permissions.

---

### My Time Last Week

Displays a summary of time you have logged over a recent period:

- **Total hours** logged (prominently displayed)
- **Breakdown by category** — IT, Business, and Other Tasks (non-project)
- **Top projects** — a small bar chart of the projects you spent the most time on

**Settings**: time period in days (7–30).

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

- **To Review** — documents where you are the active reviewer or approver, including how long ago the review was requested and by whom. The badge color indicates whether you are at the review or approval stage.
- **Last 5 Accessed** — the last five Knowledge documents you opened in this browser for the current tenant.

Restricted libraries respect their access rules: you only see review items and recent documents from libraries you can read. If you have lost access to a previously viewed document, it stops appearing here.

**Requires**: `knowledge:reader`

---

### Compliance

Shows where the classification campaign stands for the applications you can see (retired applications excluded):

- **Progress** — a bar and three counters: reviewed, to review (the classification changed since the last review or was never reviewed), and to complete (a classification field is still empty). Each counter opens the applications list filtered on that state.
- **Attention points** — applications at the most critical business level without a recovery test in the last twelve months, applications at the most critical level without a recovery wave, and applications holding the most confidential data with the lowest cyber criticality. Only points with at least one application are listed; each one opens the matching filtered list. When nothing needs action, the tile says so.

The levels are the ones defined in the IT landscape settings; a deprecated level is never counted as the highest or lowest.

**Requires**: `applications:reader`

---

### Team Activity

Shows recent project activity on projects where you are involved (changes, comments, decisions). Each row indicates the project, the activity type, the author, and a short summary. Click an item to jump to the project's activity tab.

**Settings**: max items.

**Requires**: `portfolio_projects:reader`

---

### Project Status Changes

Shows recent project status transitions (from → to) across projects, so you can see which initiatives moved forward, paused, or closed during the last few days.

**Settings**: days to look back (1–14).

**Requires**: `portfolio_projects:reader`

---

### Stale Tasks

Shows tasks that have not been updated for a long time. Each item shows the days-stale pill (warning, then error past twice the threshold) and the linked object, if any.

**Settings**: scope (`my`, `team`, `all`) and threshold in days (30–365).

**Requires**: `tasks:reader`

## Customizing your dashboard

Click the **Settings** icon (gear) in the dashboard header to open the dashboard settings dialog.

From here you can:

- **Enable or disable tiles** — check or uncheck each tile to control what appears on your dashboard.
- **Reset to Defaults** — restore the original tile selection.

Only tiles you have permission to view appear in the settings list. Changes are saved to your account and persist across sessions and devices.

If all tiles are disabled, the dashboard shows a message prompting you to enable some.

## Tips

- **Start with the defaults**: the dashboard ships with a useful set of tiles already enabled. Try it for a few days before customizing.
- **Use the quick actions**: creating a task, request, or document — or logging time — straight from the dashboard saves you navigating around.
- **Check overdue tasks daily**: the My Tasks tile highlights overdue items in red so nothing slips through the cracks.
- **Use Stale Tasks at team scope**: with `tasks:admin`, switch the Stale Tasks tile to `team` or `all` scope to find work nobody is updating across the organization.
