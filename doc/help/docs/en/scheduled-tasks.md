# Scheduled Tasks

The Scheduled Tasks page lists every recurring background job KANAP runs on a cron schedule: cleanups, periodic syncs, summary emails, retention enforcement, and so on. From here you can pause a job, change when it runs, trigger it on demand, and inspect the history of every recent execution.

## Where to find it

- Workspace: **Admin** (Platform section)
- Path: **Admin → Scheduled Tasks**
- Route: `/admin/scheduled-tasks`
- Access: **Platform Admin**, or **Global Admin** on a single-tenant (on-premise) deployment. Other roles see a Forbidden page.

## The task list

The page is a single table that auto-refreshes every 15 seconds, so you can leave it open while watching a job complete.

**Columns**:

- **Name**: the internal identifier of the task (for example `purge-stale-conversations`)
- **Description**: a short human-readable summary of what the task does
- **Schedule**: the cron expression. Common patterns are translated into plain English ("Daily at 3 AM", "Every 15 minutes", "Sundays at 4 AM"); hover the label to see the raw expression. Click the pencil icon to edit it inline.
- **Enabled**: toggle the task on or off without changing the schedule
- **Last run**: when the task last started
- **Duration**: how long the last run took (`ms`, `s`, or `m` depending on length)
- **Status**: coloured indicator for the last run (**Success**, **Failed**, **Running**, or **Never run**)
- **Actions**: per-row controls (see below)

### Editing a schedule

Click the pencil icon next to any schedule to open an inline editor.

- Type a standard 5-field cron expression (`minute hour day-of-month month day-of-week`).
- Press **Enter** to save, **Escape** to cancel.
- Invalid expressions are rejected with an error notification at the bottom of the screen. The task keeps its previous schedule.

When the new expression matches a known pattern, the table immediately shows the friendly label.

### Enabling and disabling a task

Flip the **Enabled** switch to pause or resume a task. Disabled tasks stop running on the cron schedule but can still be triggered manually from the Actions column.

### Running a task on demand

The **Run now** action (play icon) triggers the task immediately, regardless of the schedule. A confirmation appears at the bottom of the screen and the row updates as soon as the run starts and completes.

This is the right control for:

- Validating a fix you just deployed
- Forcing a sync after a data import
- Smoke-testing a job before re-enabling it

### Viewing the run history

The **View history** action (clock icon) opens a side drawer with the recent runs of that task.

Each run row shows:

- **Started**: when the run began
- **Status**: Success, Failed, or Running
- **Duration**: how long the run took
- **Details**: a short structured summary on success, or the error message on failure. Long error messages are truncated in the table; the full text is preserved in the underlying record.

Pagination appears below the list when there are more than 20 runs. The drawer can be closed with the X icon in its header or by clicking outside it.

## Tips

- **Pause before debugging**: when a task is misbehaving, disable it first so it stops re-running while you investigate. Use **Run now** to test fixes without waiting for the next scheduled tick.
- **Read the run details**: failures often include enough context (record counts, error messages) to point at the root cause without diving into server logs. Open the run history before SSH'ing into a server.
- **Use plain-English checks**: if a schedule label does not match what you expect, the cron expression is probably wrong. The friendly translation only kicks in for known patterns, so an unfamiliar label is a useful sanity check on your own typing.
