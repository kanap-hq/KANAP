# Tasks

Tasks help you track action items, deliverables, and work packages across your KANAP entities. They are used for renewal reminders, follow-ups, compliance checks, project deliverables, and any other work that needs tracking.

## Getting started

Navigate to **Portfolio > Tasks** to see all tasks across your organization. Click **New** to create a task.

### Creating a new task

When you click **New**, the full task workspace opens. To create a task:

1. **Enter the title** (required):
   - Type the task title in the text field at the top

2. **Choose context**:
   - **Standalone task** (default): Keep "Related To" as **Standalone**
   - **Linked task**: Select **Project**, **OPEX**, **Contract**, or **CAPEX**, then pick the specific item

3. **Fill in optional details**:
   - **Task Type**: Select a category for the work (e.g., Task, Bug, Problem, Incident). Defaults to "Task" when available
   - **Description**: Add detailed information using the markdown editor (supports formatting, lists, links, images)
   - **Phase**: For project tasks, select a phase or leave as "Project-level"
   - **Classification** (standalone and project tasks): Set **Source**, **Category**, **Stream**, and **Company**. For project tasks, these default from the parent project. For standalone tasks, your organization's default classification values are pre-filled when available
   - **Status**: Defaults to **Open**
   - **Priority**: Defaults to **Normal**
   - **Dates**: Set start and due dates
   - **Assignee**: Defaults to you; change if needed

4. Click **Create** when ready (enabled once title is set). You can also press **Ctrl+S** (or **Cmd+S** on Mac)

**Tip**: You can paste images directly into the description. They are uploaded to storage automatically when you create the task.

**Note**: Tasks can also be created from within other workspaces (OPEX items, Contracts, CAPEX items, Portfolio Projects) where the relation is pre-selected.

**Required fields**:
  - **Title**: A short description of what needs to be done

**Strongly recommended**:
  - **Description**: Detailed description of the task
  - **Assignee**: Who is responsible
  - **Due Date**: When it needs to be completed

---

## Where to find it

- Path: **Portfolio > Tasks**
- Permissions:
  - You need at least `tasks:reader` to view tasks
  - You need `tasks:member` to create tasks and edit tasks in standalone/OPEX/Contract/CAPEX contexts
  - You need `portfolio_projects:contributor` to save a task when the target context is a project
  - You need `tasks:admin` for bulk deletion, CSV import, and CSV export

If you don't see Tasks in the menu, ask your administrator to grant you the appropriate permissions.

---

## Working with the list

The Tasks grid shows all tasks across your organization.

**Top scope filter**:
  - **My tasks** (default): tasks assigned to you
  - **My team's tasks**: tasks assigned to any member of your Portfolio team (including yours)
  - **All tasks**: the full tasks grid
  - If you are not assigned to a Portfolio team, **My team's tasks** is disabled
  - Your selection is remembered across sessions; returning to the page restores your last choice

**Default columns** (visible by default):

| Column | What it shows |
|--------|---------------|
| **#** | Item reference (e.g., T-42). Click to open the workspace |
| **Task Title** | The task name. Click to open the workspace |
| **Task Type** | The type of work (e.g., Task, Bug, Problem, Incident) |
| **Context** | The entity type (Project, OPEX, Contract, CAPEX, or "Standalone") |
| **Status** | Current state with a colored dot |
| **Score** | Calculated priority score |
| **Assignee** | Assigned person |
| **Classification** | Portfolio category |
| **Stream** | Portfolio stream |

**Additional columns** (hidden by default; enable via the column menu):

| Column | What it shows |
|--------|---------------|
| **Related Entry** | The linked entity name (empty for standalone tasks) |
| **Phase** | Project phase (for project tasks) |
| **Priority** | Priority level |
| **Due Date** | When the task is due |
| **Created** | When the task was created |
| **Last changed** | When the task was last updated |
| **Description** | Task description text |
| **Source** | Portfolio source classification |
| **Company** | Company classification |

**Status colors**:
  - **Open**: Gray
  - **In Progress**: Blue
  - **Pending**: Orange
  - **In Testing**: Purple
  - **Done**: Green
  - **Cancelled**: Red

**Priority colors**:
  - **Blocker**: Red
  - **High**: Orange
  - **Normal**: Gray
  - **Low**: Blue
  - **Optional**: Green

**Default filter**: Active tasks are shown by default (`Open`, `In Progress`, `Pending`, `In Testing`). Include `Done` and `Cancelled` in the Status filter to see closed tasks.

**Actions**:
  - **New**: Create a standalone task (requires `tasks:member`)
  - **Import CSV**: Upload a CSV file to create or update tasks (requires `tasks:admin`)
  - **Export CSV**: Download tasks to a CSV file (requires `tasks:admin`)
  - **Delete Selected**: Remove selected tasks (requires `tasks:admin`)

---

## The Task workspace

Click any row to open the task workspace. The workspace puts the task content (description, attachments, activity) in the centre and exposes a **Properties** drawer on the right edge that you can show or hide.

### Header toolbar

The header contains:
  - **Back** breadcrumb to **Tasks** (or to the originating project workspace, when you came from one)
  - **Position indicator**: Your position in the filtered list (e.g., "3 of 12") with **Previous** / **Next** arrows
  - **Send link**: Email a link to the task
  - **Convert to Request**: Promote the task to a portfolio request
  - **Delete**: Remove the task, with its comments and history (requires `tasks:admin`). You confirm first, and the delete cannot be undone
  - **Close**: Return to the task list

Below the toolbar, the title block shows:
  - **Item reference chip** (e.g., T-42): Click to copy the reference to your clipboard
  - **Title**: Click to edit inline (requires `tasks:member`)
  - **Status / Priority / Score / Assignee / Due Date** as compact, clickable metadata chips
  - **Project chip** for project tasks (links to the project workspace)

### Main content area

**Description**: A markdown editor that supports formatting, lists, links, code blocks, and images. You can paste images directly; they upload automatically. Pressing **Tab** from the title field jumps into the description editor. The description autosaves a couple of seconds after you stop typing; the header shows **Saved** briefly each time it persists.

**Attachments**: Drag and drop files onto the description, or use the upload area when it appears. Uploaded files appear as chips below the description. Click a chip to download; click the **x** button to delete (requires edit permission). Maximum 20 MB per file.

**Activity Section**: Toggle between three views:
  - **Comments**: A unified activity form (comment + optional status change + optional time log in one submit) plus the comment thread
  - **History**: All field and status changes for the task, with timestamps and authors
  - **Time Log**: Time entries (available for standalone and project tasks only)

### Properties drawer

The drawer is collapsible (click the vertical **Properties** tab on the right edge to open or close it; press **P** as a shortcut). Its width and open state are remembered locally. The drawer contains four groups, separated by dividers:

**Context**:
  - **Related to**: Standalone, Project, OPEX, Contract, or CAPEX. You can change the type and pick a new item; on save, KANAP applies any related side effects (see [Changing task context](#changing-task-context))
  - **Phase** (project tasks only): Defaults to **Project-level** unless you pick a project phase
  - **Task Type**: Task, Bug, Problem, Incident, or any custom type configured by your administrator

**Classification** (standalone and project tasks only):
  - **Source**: Where the work originated
  - **Category**: The portfolio category for the work
  - **Stream**: The specific stream within the category (filtered by selected category; disabled until a category is selected)
  - **Company**: The company this work relates to
  - For OPEX/Contract/CAPEX tasks, this section is hidden unless classification values were previously set

**People**:
  - **Requestor**: Who requested the work (defaults to creator)
  - **Viewers**: Additional people who should see the task

**Tracking**:
  - **Start date**
  - **Time spent**: Total time logged, with a **+ Log time** shortcut
  - **Applications**: Apps & Services this task relates to
  - **Assets**: Hardware/cloud assets this task relates to
  - **Knowledge**: Linked knowledge documents and a shortcut to create new ones (requires `knowledge:member` for creation)

**Note**: Editing fields in the drawer saves immediately. There is no Save button on the drawer.

### Changing task context

When you change a task's context and save, KANAP applies the change in one operation (context plus any other edited fields together).

- **Project to Standalone**: Phase is cleared, classification is kept
- **Project to OPEX/Contract/CAPEX**: Phase and classification are cleared
- **Any to Project**:
  - Project permission is required (`portfolio_projects:contributor`)
  - Phase resets to project-level unless you choose a valid phase for that project
  - Existing classification is kept; missing values are auto-filled from project defaults

---

## Task statuses

| Status | Meaning | When to use |
|--------|---------|-------------|
| **Open** | Not yet started | Default for new tasks |
| **In Progress** | Work has begun | When someone starts working on it |
| **Pending** | Waiting on someone else | When the assignee is blocked and needs input/decision |
| **In Testing** | Ready for validation | When implementation is complete and awaiting review/testing |
| **Done** | Completed successfully | When the work is finished (requires time logged for project tasks) |
| **Cancelled** | No longer needed | When the task becomes irrelevant |

**Important**: For project tasks, you cannot mark a task as **Done** until you have logged at least some time. This ensures accurate effort tracking.

---

## Priority levels

| Priority | Use case |
|----------|----------|
| **Blocker** | Blocking other work; immediate attention required |
| **High** | Important and time-sensitive |
| **Normal** | Standard priority (default) |
| **Low** | Can be deferred if needed |
| **Optional** | Nice-to-have, address when capacity allows |

---

## Time tracking

Standalone tasks and project tasks support detailed time tracking through the Time Log. Time tracking is not available for OPEX, Contract, or CAPEX tasks.

### Logging time

1. Click **+ Log time** in the Properties drawer (Tracking group), or open the **Time Log** tab in the activity section
2. Select the **Category**: IT or Business (determines how time contributes to project effort)
3. Enter the date the work was performed
4. Enter time as days and/or hours
5. Add optional notes describing the work
6. Click **Log Time**

**Category**: For project tasks, the category determines whether the time counts toward the project's IT effort or Business effort. This matches the project's own time-logging system.

### Viewing time entries

The **Time Log** tab in the activity section shows all time entries for the task:
  - Date the work was performed
  - Category (IT or Business)
  - Person who logged the time
  - Hours logged
  - Notes

### Editing or deleting entries

You can edit or delete your own time entries from the Time Log table.

---

## Attachments

Tasks support file attachments for documents, screenshots, and other supporting files.

### Adding attachments

- Drag and drop files onto the description area, or
- Click **Browse files** in the upload area when it is visible
- Files appear as chips below the description once uploaded

**File size limit**: Maximum 20 MB per file.

### Managing attachments

- **Download**: Click on an attachment chip to download the file
- **Delete**: Click the **x** button on the chip to remove the attachment (requires edit permission)

Attachments are visible to anyone who can view the task.

---

## Description import and export

The description field supports importing and exporting documents so you can work with content outside KANAP.

### Importing a document

1. Open an existing task workspace (import is not available during task creation)
2. Click the **Import** button next to the **Description** heading
3. Select a `.docx` file from your computer
4. If the description already has content, confirm that you want to replace it
5. The document is converted to markdown and loaded into the editor
6. Review the result. The imported description is saved right away, and any edits you make afterwards save automatically

Images embedded in the document are uploaded to storage automatically. If any content cannot be converted cleanly, a warning appears at the bottom of the screen.

### Exporting the description

1. Click the **Export** button next to the **Description** heading
2. Choose a format: **PDF**, **DOCX**, or **ODT**
3. The file downloads automatically

The export button is only enabled when the description has content.

---

## Comments and history

### Adding comments

1. Select the **Comments** tab in the activity section
2. Type your comment in the text editor
3. Optionally pick a new status from the status dropdown
4. Optionally log time with the slider (`0` means no time entry)
5. Click **Submit** (the button label updates to reflect your selected actions)

### Unified activity form behavior

- You can submit any combination of:
  - Comment only
  - Status change only
  - Time log only
  - Comment + status + time together
- For project tasks, setting status to **Done** requires logged time (existing + newly added)
- The status dropdown in the Properties drawer still works independently if you prefer that flow

### Viewing history

The **History** tab shows all changes to the task:
  - Status changes
  - Field modifications
  - Who made each change and when
  - The creation entry, with the date, time and creator, shown as the last entry

The **Requestor** field is working information that can be reassigned at any time; the creation line always shows who actually created the task.

### Email notifications and quick actions

When task notifications are enabled, status and comment updates can trigger email notifications.

- If a status change and a comment are submitted together, recipients may receive a merged email (depending on their notification preferences)
- Status emails can include quick action buttons:
  - **Pending**: `Respond & Set In Progress`, `Mark Done`
  - **In Testing**: `Approve` (sets `Done`), `Set In Progress`
  - **Done**: `Reopen` (sets `Open`)
- Clicking an action button opens the task page with the status preselected in the unified activity form

---

## Linking applications and assets

Tasks can be linked to one or more **Applications** (Apps & Services) and **Assets** (hardware or cloud resources). The links live in the **Tracking** group of the Properties drawer.

- Use **Applications** to flag work that touches specific apps in your IT landscape (e.g., a deployment, a configuration change, an incident scoped to that app)
- Use **Assets** for work scoped to specific servers, devices, or cloud assets

Links are bidirectional: from the linked Application or Asset workspace, the task appears in the **Tasks** relation in that workspace's Properties drawer. This makes it easy to pivot from "what's going on with this app/asset?" to the actual work in flight.

**Tip**: Reserve these links for tasks that are operationally about the app or asset, not every task that mentions one in passing. Otherwise the relation becomes noise instead of signal.

---

## Creating tasks from other workspaces

Tasks are commonly created from within other workspaces. The relation is pre-selected so you don't have to set it up by hand.

### From Portfolio Projects
In the Project workspace, use the **Tasks** tab to manage project deliverables:
- Create tasks for specific work packages
- Assign tasks to project phases
- Track time against each task

**Tip**: In the Timeline tab, click the **[+]** button next to a phase to create a task pre-linked to that phase.

### From OPEX items
In the OPEX workspace, use the **Tasks** panel on the **Overview** tab to create tasks like:
- "Review vendor pricing for 2026"
- "Negotiate volume discount"

### From Contracts
In the Contract workspace, use the **Tasks** tab for:
- "Review contract before renewal deadline"
- "Request updated terms from vendor"

### From CAPEX items
In the CAPEX workspace, tasks track project milestones:
- "Complete requirements gathering"
- "Obtain budget approval"

These tasks automatically link to the parent entity and appear in both the task list and the parent workspace.

---

## Standalone tasks

Standalone tasks are independent work items not linked to any specific project, contract, or budget item. They are useful for:
- General IT operations work
- Ad-hoc requests
- Cross-cutting initiatives
- Personal task tracking

### Creating standalone tasks

1. Click **New** in the Tasks page
2. Leave the **Related To** dropdown as **Standalone**
3. The Properties drawer shows "Standalone Task" in the Context group
4. Fill in the title, description, and other details
5. Click **Create**

### Classification fields

Standalone tasks and project tasks have editable classification fields that help organize work by portfolio dimensions:

- **Source**: Where the work originated (e.g., Business Request, IT Initiative)
- **Category**: The portfolio category for the work
- **Stream**: The specific stream within the category (filtered by selected category)
- **Company**: The company this work relates to

These fields appear in the **Classification** group of the Properties drawer and can be edited at any time. When creating a new standalone task, your organization's default classification values are pre-filled automatically if configured.

For **project tasks**, classification defaults from the parent project when the task is created but can be changed independently. This allows, for example, an infrastructure task to exist within a business project, or a compliance task within an IT project. If a task's classification is not explicitly set, it inherits and displays the project's classification.

### Priority scoring

Standalone tasks (and all non-project tasks) use a fixed priority score based on their priority level:

| Priority Level | Score |
|---------------|-------|
| Blocker | 110 |
| High | 90 |
| Normal | 70 |
| Low | 50 |
| Optional | 30 |

Blocker tasks score 110 to ensure they always rank above even the highest-priority project tasks (max 100).

---

## Project tasks

Project tasks have additional features compared to regular tasks:

**Independent classification**: Project tasks have their own Source, Category, Stream, and Company fields. When a task is created within a project, these default from the project's classification for convenience. However, each task's classification can be edited independently. If a task's classification field is not explicitly set, it inherits and displays the project's value.

**Priority score**: Project tasks display a calculated priority score that combines:
- The parent project's priority score
- An adjustment based on the task's priority level (+10 for Blocker, +5 for High, 0 for Normal, -5 for Low, -10 for Optional)

The score appears in the metadata bar at the top of the workspace and as the **Score** column in the task list.

**Phase assignment**: Tasks can be assigned to specific project phases or marked as "Project-level" for cross-cutting work.

**Time contribution**: Time logged to project tasks contributes to the project's actual effort calculations:
- IT-category time adds to **Actual Effort (IT)**
- Business-category time adds to **Actual Effort (Business)**
- The project Progress tab shows a breakdown of Project Overhead vs Task Time
- The unified Time Log displays all time entries from both project overhead and task work

**Status validation**: Project tasks cannot be marked as **Done** without logging time first. This ensures accurate project effort tracking.

**Filtering**: The project Tasks tab includes filters for:
- Status (All, Active, specific status)
- Phase (All Phases, Project-level, specific phase)

---

## CSV import/export

Manage tasks at scale using CSV import and export. This feature supports bulk operations for initial data loading, task migrations, and data extraction for reporting.

### Accessing CSV features

From the Tasks list:
  - **Export CSV**: Download tasks to a CSV file
  - **Import CSV**: Upload a CSV file to create or update tasks
  - **Download Template**: Get a blank CSV with correct headers (from the Import dialog)

**Permissions required**: `tasks:admin` for import/export operations.

### Export options

Three export modes are available:

| Option | Description |
|--------|-------------|
| **Full Export** | All exportable fields — use for reporting and complete data extraction |
| **Data Enrichment** | All importable fields — matches the import template format, ideal for round-trip editing (export, modify, re-import) |
| **Custom Selection** | Choose specific fields to include in your export |

**Template download** (from Import dialog): Downloads a blank CSV with all importable field headers — use this to prepare import files with the correct structure.

### Import workflow

1. **Prepare your file**: Use UTF-8 encoding with semicolon (`;`) separators. Download a template to ensure correct headers.

2. **Choose import settings**:
   - **Mode**:
     - `Enrich` (default): Empty cells preserve existing values — only update what you specify
     - `Replace`: Empty cells clear existing values — full replacement of all fields
   - **Operation**:
     - `Upsert` (default): Create new tasks or update existing ones
     - `Update only`: Only modify existing tasks, skip new ones
     - `Insert only`: Only create new tasks, skip existing ones

3. **Validate first**: Click **Preflight** to validate your file without making changes. Review errors and warnings.

4. **Apply changes**: If validation passes, click **Import** to commit changes.

### Field reference

**Basic fields**:

| CSV Column | Description | Required | Notes |
|------------|-------------|----------|-------|
| `id` | Task UUID | No | For updates; leave blank for new tasks |
| `title` | Task title | Yes | Part of unique identifier |
| `description` | Task details | No | Supports plain text |

**Context fields**:

| CSV Column | Description | Required | Notes |
|------------|-------------|----------|-------|
| `related_object_type` | Entity type | No | Empty for standalone tasks; accepts code or label |
| `related_object_id` | Entity UUID | Conditional | Required if linked task and `related_object_name` not provided |
| `related_object_name` | Entity name | Conditional | Required if linked task and `related_object_id` not provided |
| `phase_name` | Project phase | No | Must match existing phase name (project tasks only) |
| `priority_level` | Task priority | No | Accepts code or label |
| `source_name` | Source | No | Portfolio source (standalone and project tasks) |
| `category_name` | Category | No | Portfolio category (standalone and project tasks) |
| `stream_name` | Stream | No | Portfolio stream (standalone and project tasks) |
| `company_name` | Company | No | Company (standalone and project tasks) |

**Standalone tasks**: Leave `related_object_type`, `related_object_id`, and `related_object_name` empty. You can set classification fields (`source_name`, `category_name`, `stream_name`, `company_name`) for standalone and project tasks. For project tasks, omitted classification fields default from the parent project.

**Tip**: For new linked-task imports, use `related_object_name` instead of `related_object_id` — it is much easier to work with. The system resolves the name to the correct ID based on `related_object_type`. For round-trip imports (export, edit, re-import), both fields are included so matching works correctly.

**Status and dates**:

| CSV Column | Description | Notes |
|------------|-------------|-------|
| `status` | Task status | Accepts code or label |
| `start_date` | Start date | Date format: YYYY-MM-DD |
| `due_date` | Due date | Date format: YYYY-MM-DD |

**People fields**:

| CSV Column | Description | Notes |
|------------|-------------|-------|
| `assignee_email` | Responsible person | Must match existing user email |
| `creator_email` | Requestor email | Export only (shown as **Requestor Email** in field metadata) |
| `viewer_email_1` through `_4` | Viewers | Must match existing user emails |
| `owner_email_1` through `_4` | Owners | Must match existing user emails |

**Other fields**:

| CSV Column | Description | Notes |
|------------|-------------|-------|
| `labels` | Task labels | Comma-separated list |

### Label and code acceptance

For **status**, **priority_level**, and **related_object_type**, you can use either the internal code or a common label:

**Status values**:

| Code | Accepted labels |
|------|-----------------|
| `open` | `Open` |
| `in_progress` | `In Progress`, `Active`, `Working` |
| `pending` | `Pending` |
| `in_testing` | `In Testing`, `Testing` |
| `done` | `Done`, `Completed`, `Complete`, `Finished`, `Closed` |
| `cancelled` | `Cancelled`, `Canceled` |

**Priority level values**:

| Code | Accepted labels |
|------|-----------------|
| `blocker` | `Blocker`, `Critical`, `Urgent` |
| `high` | `High` |
| `normal` | `Normal`, `Medium`, `Default` |
| `low` | `Low` |
| `optional` | `Optional`, `Nice to have` |

**Related object type values**:

| Code | Accepted labels |
|------|-----------------|
| `project` | `Project` |
| `spend_item` | `Spend Item`, `Spend` |
| `contract` | `Contract` |
| `capex_item` | `CAPEX Item`, `CAPEX` |

The system normalizes values automatically during import.

### Matching and updates

Tasks are matched by **title + related_object_id** (case-insensitive). When a match is found:
  - With `Enrich` mode: Only non-empty CSV values update the task
  - With `Replace` mode: All fields are updated, empty values clear existing data

If you include the `id` column with a valid UUID, matching uses ID first, then falls back to title + related object.

**Note**: If you provide `related_object_name` instead of `related_object_id`, the system resolves the name to the ID before matching. This means you can use human-readable names throughout your import file.

### Export-only fields

Some fields appear in exports but cannot be imported. These are system-managed fields that maintain data integrity:

| Field | Why it's export-only |
|-------|---------------------|
| `creator_email` (Requestor) | Automatically set to the user who creates the task. Allowing import would compromise audit trail integrity. For new tasks the system sets this to the importing user; for existing tasks the original requestor is preserved. |

These fields are included in **Full Export** for reporting purposes but excluded from **Template** and **Data Enrichment** exports since they cannot be modified during import.

### Limitations

  - **Maximum 4 viewers/owners**: Tasks support up to 4 viewer emails and 4 owner emails via CSV
  - **Classification for standalone and project tasks only**: Source, Category, Stream, and Company can be set on standalone and project tasks (not on OPEX, Contract, or CAPEX tasks)
  - **Phase requires project**: Phase assignment only works for project tasks
  - **Application/Asset links not in CSV**: Use the workspace Properties drawer to link tasks to applications and assets
  - **Comments not included**: Task comments and history must be managed in the workspace
  - **Time log not included**: Time entries must be logged in the workspace
  - **Attachments not included**: File attachments require workspace management

### Troubleshooting

**"File isn't properly formatted" error**: This usually indicates an encoding issue. Ensure your CSV is saved as **UTF-8**:

  - **In LibreOffice**: When opening a CSV, select `UTF-8` in the Character set dropdown (not "Japanese (Macintosh)" or other encodings). When saving, check "Edit filter settings" and choose UTF-8.
  - **In Excel**: Save As > CSV UTF-8 (Comma delimited), then open in a text editor to change commas to semicolons.
  - **General tip**: If you see garbled characters at the start of your file, the encoding is incorrect.

### Example CSV

Using human-readable names (recommended for new imports):

```csv
title;related_object_type;related_object_name;status;priority_level;due_date;assignee_email;source_name;category_name
Review contract terms;Contract;Acme Software License;Open;High;2026-02-28;john.doe@example.com;;
Update documentation;project;Website Redesign;In Progress;Normal;2026-03-15;jane.smith@example.com;;
Schedule kickoff;spend_item;Cloud Hosting 2026;open;low;2026-04-01;bob.wilson@example.com;;
Audit IT security;;;open;high;2026-03-01;security@example.com;IT Initiative;Security
```

The last row is a **standalone task** (no related object) with classification fields set.

Using UUIDs (typically from round-trip exports):

```csv
title;related_object_type;related_object_id;status;priority_level;due_date;assignee_email
Review contract terms;Contract;550e8400-e29b-41d4-a716-446655440000;Open;High;2026-02-28;john.doe@example.com
Update documentation;project;660e8400-e29b-41d4-a716-446655440001;In Progress;Normal;2026-03-15;jane.smith@example.com
Schedule kickoff;spend_item;770e8400-e29b-41d4-a716-446655440002;open;low;2026-04-01;bob.wilson@example.com
```

---

## Converting a task to a request

You can promote a task into a portfolio request when the work deserves formal evaluation, prioritization, or eventually its own project. The conversion is available from the task workspace header.

### How to convert

1. Open the task workspace
2. Click **Convert to Request** in the header toolbar (next to **Send link**)
3. In the dialog:
   - **Request Name**: Defaults to the task title — edit if needed
   - **Purpose Preview**: Shows the task description, which becomes the request's purpose
   - **Close the original task after conversion**: Check this option if you want the task status set to **Done** automatically
4. Click **Convert to Request**

After conversion, KANAP navigates you to the newly created request workspace.

### What gets carried over

The new request inherits the following from the original task:

| Task field | Request field |
|------------|--------------|
| Title | Name |
| Description | Purpose |
| Due Date | Target Delivery Date |
| Source, Category, Stream, Company | Source, Category, Stream, Company |
| Attachments | Attachments (copied) |

The request is created with a status of **Pending Review** and is linked back to the originating task. A history entry is recorded on both the task ("Converted To Request") and the request ("Created from Task" with a link to the original task).

### Conditions

- **Permissions**: You need both `tasks:member` and `portfolio_requests:member`
- **One-time conversion**: Each task can only be converted once. After conversion, the **Convert to Request** button is disabled and shows the linked request reference (e.g., "Already converted to REQ-42")
- **Task remains**: The original task is not deleted. Unless you check the close option, it stays in its current status and can still be updated independently

**Tip**: Use this when a task reveals a larger initiative that needs its own request lifecycle — criteria scoring, approval workflow, and eventual conversion to a project.

---

## Sending a link

You can email a link to any task to colleagues or external contacts.

1. Open the task workspace
2. Click **Send link** in the header toolbar
3. In the dialog:
   - **Select recipients**: Search for existing platform users by name or email, and/or type any email address and press Enter
   - **Add a message** (optional): Include a personal note
   - **Copy link**: Click the copy icon to grab the direct URL
4. Click **Send**

Recipients receive an email with your name, the task title, a direct link, and your message (if provided). This does not change any permissions — it simply notifies the recipients.

**Tip**: You can mix platform users and external email addresses in the same send.

---

## Keyboard shortcuts

When the focus is not on an input field, you can use:

- **J** or **←**: Previous task in the current list
- **K** or **→**: Next task in the current list
- **P**: Toggle the Properties drawer
- **Escape**: Close and return to the list
- **Ctrl+S** / **Cmd+S**: Save (or create, in create mode)
- **Tab** from the title field: Jump straight into the description editor

---

## Tips

  - **Use due dates**: Set realistic due dates to track deadlines effectively.
  - **Assign owners**: Every task should have an assignee for accountability.
  - **Log time regularly**: Time tracking helps with future project estimation.
  - **Filter by status**: The default filter shows active statuses only (`Open`, `In Progress`, `Pending`, `In Testing`) — include `Done` and `Cancelled` when reviewing historical tasks.
  - **Create from context**: Creating tasks from within workspaces (project, OPEX, contract, CAPEX) automatically links them.
  - **Link apps and assets**: Use the **Applications** and **Assets** fields in the Properties drawer when a task is operationally about a specific app or asset. The link shows up in the related entity's workspace too.
  - **Use priority wisely**: Reserve **Blocker** for genuinely blocking issues.
  - **Use single-submit updates**: In the Comments tab, combine comment + status + time in one action to keep history and notifications aligned.
  - **Import documents**: Use the **Import** button to pull in `.docx` files as description content instead of copy-pasting.
  - **Keyboard shortcut**: Press **Ctrl+S** (or **Cmd+S** on Mac) to save quickly without reaching for the Save button.
  - **Link knowledge articles**: Use the Knowledge group in the Properties drawer to connect relevant documentation to your tasks.
