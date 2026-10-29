# Portfolio Planning

Portfolio Planning helps you plan and update project dates at portfolio level. It combines a manual timeline view with an automatic roadmap generator that schedules projects based on remaining effort, dependencies, and contributor capacity.

## Getting started

Navigate to **Portfolio Management > Planning**.

**Permissions**:
- You need `portfolio_projects:reader` to access the Planning page and timeline data.
- You need `portfolio_reports:reader` to generate roadmap scenarios.
- You need `portfolio_projects:contributor` to drag project dates, change a project's scheduling mode, and apply generated dates.

If you do not see Planning in the menu, ask your administrator to grant the required access.

---

## Planning modes

Use the mode toggle at the top of the page:
- **Timeline**: Manual date planning in the Gantt chart
- **Roadmap Generator**: Automatic schedule simulation and selective apply

---

## Timeline mode

Use Timeline mode for direct planning edits.

### What you can do
- View projects, dependencies, and optional milestones
- Filter by category and status
- Choose time window: 1 month, 3 months, 6 months, or 1 year
- Move backward/forward in time or reset to **Today**
- Drag project bars to update planned start and end dates. This needs `portfolio_projects:contributor`. With `portfolio_projects:reader`, the bars stay in place and a double-click still opens the project.

### Display behavior
- The chart centers around today with about **25% past / 75% future** when reset to current period.
- Milestones are displayed but not draggable.

---

## Roadmap Generator mode

Roadmap Generator computes proposed project dates from the selected scope and planning parameters.

### Scenario controls
- **Start Date**
- **Statuses** (default: Waiting List, Planned, In Progress, In Testing)
- **Capacity mode**: Theoretical or Historical
- **Parallel limit**: maximum concurrent projects per contributor
- **Optimization mode**: Priority Focused or Completion Focused
- **Recalculate already scheduled projects** (enabled by default)
- **Collaborative scheduling** (disabled by default)
- **Context-switch penalty** and **context-switch grace**

**Important**: when **Recalculate already scheduled projects** is enabled, projects that already have planned dates can move in the generated scenario.

### Schedule tab

After generation, the Schedule tab shows proposed project dates.

- Project titles are clickable and open the project **Progress** tab.
- Checkboxes define the scenario scope.
- A **Category (Preview)** filter lets you filter the roadmap Gantt display without changing the generated schedule itself.
- Unselecting a project immediately regenerates the scenario:
  - the unselected project is excluded entirely,
  - it no longer consumes any capacity in bottlenecks/occupation/schedule.
- **Select Visible** / **Clear Visible Selection** only act on projects currently visible in the filtered Gantt preview.
- Unschedulable projects are listed with a reason.

### Bottlenecks tab

Shows contributors ranked by impact on roadmap end date (`impactDays`) using sensitivity reruns.
- Each contributor row has an expand/collapse arrow to open a project breakdown table.
- The breakdown includes only projects in the current generated scenario where the contributor has allocation.
- The breakdown is sorted by project start date and shows:
  - Project name
  - Project start date
  - Project end date
  - Total Contribution (days)
  - Time already spent (days)
- `Total Contribution` and `Time already spent` are derived from generated contributor load plus project execution progress.

### Occupation tab

Shows weekly occupation heatmaps:
- Contributor view: one row per contributor, grouped by team, with ISO week columns
- Team view: one row per team, with ISO week columns
- Team labels are displayed as merged multi-row cells in contributor view to avoid repetition
- Each cell shows rounded weekly occupation (%) with accent color intensity based on load
- **Export table** offers **CSV** and **Excel (.xlsx)** for the scenario on screen. The CSV holds the view on screen, contributors or teams. The Excel file holds both, one sheet each, with the occupation as percentages, plus a **Parameters** sheet. **Export occupation as PNG** saves the heatmap as an image

### Gantt preview behavior

The roadmap Gantt is read-only and:
- keeps the same today-centered 25/75 display logic as Timeline mode,
- automatically extends far enough in the future to reach the latest scheduled completion,
- shows each project bar with its current execution progress,
- auto-sizes vertically based on visible rows so larger scenarios can show many projects without internal vertical scrolling.

---

## Applying generated dates

Click **Apply Dates** to write generated planned dates back to selected projects.

### Apply rules
- Only selected projects that are currently visible in the roadmap Gantt preview are applied.
- Apply is **transactional** (all-or-nothing):
  - if one project fails validation, no project date is updated.

---

## Started projects behavior

For projects already started in the past:
- the historical start date is preserved (`Actual Start`, or eligible `Planned Start` fallback),
- scheduling uses the remaining work from today forward to compute the projected end date.

This keeps historical timeline context while still recalculating realistic completion.

---

## Common unschedulable reasons

- **No Remaining Effort**
- **No Contributors**
- **Missing Contributor Capacity**
- **Missing Blocker Date**
- **Cyclic Dependency**
- **Insufficient Capacity**

If projects are unschedulable, check contributor assignments, contributor availability, dependency data, and status scope.

---

## How the scheduler works

The Roadmap Generator simulates project execution week by week. Each week it decides which projects receive work and how much effort each contributor burns. The simulation runs from the **Start Date** forward until all projects are completed or the horizon limit is reached.

### Capacity

Each contributor has a monthly capacity (configured in **Contributors**). The scheduler converts this to a weekly value: `monthly * 12 / 52`.

- **Theoretical mode** uses the configured capacity directly.
- **Historical mode** uses actual time-tracking data from recent months as the capacity baseline.

### Reservations

Projects that are **not recalculated** (when **Recalculate already scheduled projects** is off, or projects with external blockers) keep their existing planned dates. Their contributor loads are pre-committed in the capacity ledger before candidate scheduling begins. This means reserved projects consume contributor time in the weeks they span, reducing availability for other projects.

### Dependencies

A project cannot start until all its dependency predecessors have finished. If a predecessor is a candidate in the current run, the dependent project waits until the predecessor's computed end date passes. If a predecessor is outside the candidate set (e.g. excluded or in a different status), its known planned/actual end date is used.

### Project ranking

Each week, ready projects (not blocked, not done) are sorted to determine scheduling priority. The ranking depends on the **Optimization mode**.

**Priority Focused** mode ranks by **effective priority** (highest first):

- **Started projects** (already received work in a prior week): effective priority = `min(100, priorityScore + 5 * weeksSinceStart)`. A started project gains 5 priority points per week of active work, up to a maximum of 100. This ensures in-flight projects steadily climb in priority so they get finished.
- **Waiting projects** (ready but not yet started): effective priority = `min(90, priorityScore + weeksWaiting)`. Each week a ready project waits without receiving work, it gains 1 priority point, up to 90. This prevents indefinite starvation but a waiting project can never outrank a moderately-prioritized started project.
- **Other projects** (not yet ready): use their raw `priorityScore` as-is.

**Completion Focused** mode ranks by **bottleneck weeks** (lowest first), then raw `priorityScore` (highest first). Bottleneck weeks estimate how many weeks a project would take if it were the only project scheduled, based on its most constrained contributor. This mode prioritizes quick-to-finish projects.

**Tiebreakers** (both modes): dependency depth descending (projects that block the most downstream work go first), then project ID lexicographic for determinism.

### Continuity rule

Before considering new project starts each week, the scheduler pre-assigns contributors to their **ongoing projects**. A contributor is "continuing" a project if:

- The project has already started (received work in a prior week).
- The project is ready (not blocked by a dependency).
- The contributor has remaining effort on it.
- The contributor has already worked on it previously.

Ongoing projects are processed in rank order (highest priority first). Each pre-assigned continuation consumes a parallelization slot for that contributor.

**Effect**: with **Parallel limit = 1**, a contributor working on a project must finish it (or wait for it to become unblocked) before starting anything new. With higher limits, ongoing work fills slots first and remaining slots become available for new projects.

The continuity rule applies in both collaborative and non-collaborative modes, but the feasibility check differs:

- **Collaborative**: all continuing contributors on a project must have free slots for the project to be pre-selected as a whole.
- **Non-collaborative**: each continuing contributor is individually pre-selected if they have a free slot.

### Collaborative scheduling

The **Collaborative scheduling** toggle controls how the scheduler selects projects and distributes work each week.

#### Collaborative (toggle ON)

All contributors assigned to a project must have a free parallelization slot **and** available capacity for the project to be selected. If even one contributor is fully occupied, the entire project waits.

Work is burned **proportionally**: all contributors make progress at the pace of the most constrained contributor. If Contributor A has 4 days available and Contributor B has 1 day, the project progresses at a rate constrained by Contributor B's availability. This keeps all contributors synchronized but means available capacity from faster contributors goes unused on that project.

Use collaborative scheduling when projects genuinely require all team members to work in lockstep (e.g. tightly coupled development phases, workshops, or joint deliverables).

#### Non-collaborative (toggle OFF, default)

A project is selected if **any** contributor has a free parallelization slot and available capacity. Contributors work **independently**: each burns effort at their own pace, up to their available weekly capacity. A project can make progress even if some of its contributors are busy with other work.

This mode includes a **minimum-start guard** for new projects: a project only starts if the expected total burn across all feasible contributors is at least 0.5 days that week. This prevents optimistically early start dates from tiny trickle burns. The guard does not apply to continuations (already-started projects keep going via the continuity rule regardless of weekly capacity).

Use non-collaborative scheduling (the default) when contributors can work on their portions independently, which is typical for most IT projects where different team members handle separate tasks.

### Parallelization limit

The **Parallel limit** controls how many candidate projects a single contributor can work on simultaneously in a given week. Reservations (pre-committed projects) also consume slots.

With a limit of 1, each contributor works on at most one candidate project per week. With a limit of 2 or 3, contributors can split their time across multiple projects.

### Context-switch penalty

When a contributor works on more than one candidate project in the same week (concurrency > grace threshold), their effective capacity is reduced by the **Context-switch penalty** percentage for each additional project beyond the grace count.

- **Context-switch penalty**: the percentage of capacity lost per additional concurrent project (default 10%).
- **Context-switch grace**: the number of concurrent projects before the penalty kicks in (default 1).

For example, with 10% penalty and grace of 1: working on 2 projects costs 10% capacity, 3 projects costs 20%.

### Sensitivity analysis (bottlenecks)

After the main scheduling run, the scheduler re-runs the simulation multiple times, each time giving one contributor +20% extra monthly capacity. The difference between the original roadmap end date and each variant's end date measures that contributor's **impact on the timeline**. Contributors are ranked by this impact in the **Bottlenecks** tab.

This helps identify which contributors are the biggest scheduling constraints. Adding capacity to high-impact contributors (through hiring, reallocation, or workload reduction) would most improve the overall portfolio timeline.
