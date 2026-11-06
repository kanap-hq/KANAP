# Portfolio Module — Functional Specification v1.2

**February 2026**

---

## 1. Executive Summary

The Portfolio module provides CIOs and IT leaders with a comprehensive system for managing the demand lifecycle—from initial request intake through project delivery. It enables structured evaluation, prioritization, and capacity-aware planning of IT initiatives.

**Core capabilities:**

- Request intake with configurable scoring and evaluation criteria
- Formal approval workflow with CAB decision tracking
- Project execution tracking with progress monitoring
- Capacity-aware planning with roadmap simulation and selective date apply
- Portfolio reporting and analytics

---

## 2. Conceptual Model

### 2.1 Request vs. Project Separation

The module maintains a clear separation between the demand evaluation phase (Request) and the execution phase (Project). This distinction provides clean data boundaries and enables accurate portfolio analysis.

**Request** represents the demand: what is being asked for, why it matters, and whether it should be approved. Requests go through evaluation and CAB review.

**Project** represents the execution: how the approved work will be delivered, by whom, and when. Projects track actual progress and resource consumption.

### 2.2 Conversion Flow

The relationship between Requests and Projects is many-to-many. One Request may result in multiple Projects (phased delivery), and multiple Requests may be consolidated into a single Project (related demands). The conversion flow is as follows:

1. User clicks "Convert to Project" on an approved Request
2. System opens a pre-filled Project creation form
3. User confirms or adjusts details; Project is created
4. Request status changes to "Converted" and becomes read-only (field editing is disabled, but the "Convert to Project" action remains available for creating additional Projects)
5. Bidirectional links are established between Request and Project

Additional Projects can be created from the same Request at any time.

### 2.3 Projects Without Requests

Projects may exist without a source Request to accommodate fast-track executive mandates or legacy work. An "Origin" field distinguishes:

- **Standard:** Created from an approved Request (normal flow)
- **Fast-track:** Executive mandate bypassing formal request process
- **Legacy:** Pre-existing work imported into the system

---

## 3. Status Models

### 3.1 Request Statuses

| Status | Description | Transitions to |
|--------|-------------|----------------|
| Pending review | Initial status; request is being analyzed by IT | Candidate, Rejected, On hold |
| Candidate | Review complete; waiting for CAB decision | Approved, Rejected, On hold |
| Approved | CAB approved; ready to become project(s) | Converted |
| On hold | Paused before approval | Pending review, Candidate, Rejected |
| Rejected | CAB declined the request | Pending review |
| Converted | Project(s) created; request closed | *(terminal)* |

### 3.2 Project Statuses

| Status | Description | Transitions to |
|--------|-------------|----------------|
| Waiting list | Approved but not yet scheduled | Planned, On hold, Cancelled |
| Planned | Scheduled with defined start date | In progress, On hold, Cancelled |
| In progress | Active execution | In testing, Done, On hold, Cancelled |
| In testing | Validation and QA phase | In progress, Done, On hold, Cancelled |
| On hold | Paused during execution | Waiting list, Planned, In progress, Cancelled |
| Done | Successfully completed | *(terminal)* |
| Cancelled | Stopped; will not be completed | *(terminal)* |

---

## 4. Data Model

### 4.1 Request Entity

#### 4.1.1 Overview Section

| Field | Type | Notes |
|-------|------|-------|
| Name | Text | Required |
| Purpose | Text (long) | Description of what is requested |
| Requestor | User (lookup) | Default: current user |
| Type | Enum | IT, Business (see note below) |
| Category | Enum | Business Applications, End-user Computing & Services, Infrastructure & Operations, Innovation & Digital Transformation, Security & Compliance |
| Company | Lookup | From company list; cannot be changed after creation (can be disabled) |
| Department | Lookup | Filtered by selected Company |
| Target delivery date | Date | When business wants delivery |
| Status | Enum | See section 3.1 |

**Type field purpose:** Distinguishes requests originating from business stakeholders (e.g., new feature for a controlling application) from requests originating from IT itself (e.g., firewall replacement). Used for portfolio analysis and reporting.

#### 4.1.2 Scoring Section

| Field | Type | Notes |
|-------|------|-------|
| Priority score | Calculated (0-100) | Auto-calculated, prominent display, not editable |
| Priority override | Boolean | Enables manual override; blocked when mandatory bypass is active |
| Override justification | Text | Required if override = true |
| Override value | Number (0-100) | Manual score when overridden |
| [Dynamic criteria] | Per tenant config | Each criterion: N/A (0) to 5 scale |

#### 4.1.3 Effort Estimation Section

| Field | Type | Notes |
|-------|------|-------|
| Estimated effort IT | Number range (MD) | Low/High values; used for project pre-fill |
| Estimated effort Business | Number range (MD) | Low/High values; used for project pre-fill |

**Effort range to single value conversion:** When converting to a Project, the system calculates a single effort value using: `(low + high) / 2`. For open-ended ranges (e.g., ">50 MD"), use: `low + (low × 0.5)` (e.g., >50 MD → 75 MD).

#### 4.1.4 Analysis Section

| Field | Type | Notes |
|-------|------|-------|
| Impacted business processes | Lookup (multi) | Links to Business Processes from Master Data; filters to enabled processes only |
| Feasibility review | JSONB structured matrix | Six dimensions with `status` + `comment` per dimension (see below) |
| Risks & mitigations | Rich text | Residual risks, mitigation actions, and owners |

**Feasibility review dimensions:**
- `technical_feasibility`
- `security_compliance`
- `infrastructure_needs`
- `resource_skills`
- `delivery_constraints`
- `change_management`

**Feasibility statuses:** `not_assessed`, `no_concerns`, `minor_concerns`, `major_concerns`, `blocker`.

**Recommendation flow:** The Analysis tab submits an "Analysis Recommendation" through the existing formal decision system (Activity), using decision outcomes `go`, `no_go`, `defer`, `need_info`, `analysis_complete` and optional request status transition.

#### 4.1.5 Team Section

| Field | Type | Notes |
|-------|------|-------|
| Business sponsor | User (lookup) | Executive sponsor on business side |
| Business lead | User (lookup) | Day-to-day business contact |
| Business team | Users (multi) | Business contributors |
| IT sponsor | User (lookup) | Executive sponsor on IT side |
| IT lead | User (lookup) | Day-to-day IT contact |
| IT team | Users (multi) | IT contributors |
| External contacts | Contacts (multi) | From Contacts table |

#### 4.1.6 Relations Section

| Field | Type | Notes |
|-------|------|-------|
| Dependencies | Requests/Projects (multi) | Bidirectional links; circular dependencies prevented |
| CAPEX items | Lookup (multi) | Link to CAPEX entries |
| OPEX items | Lookup (multi) | Link to OPEX entries |
| URLs | URL list | External references |
| Attachments | Files | Supporting documents; max 20 MB per file |
| Resulting projects | Projects (multi) | Auto-populated on conversion |

#### 4.1.7 Metadata Section

| Field | Type | Notes |
|-------|------|-------|
| Created date | DateTime | Auto-generated, not editable |
| Created by | User | Auto |
| Converted date | DateTime | Auto when status → Converted |

---

### 4.2 Project Entity

#### 4.2.1 Overview Section

| Field | Type | Notes |
|-------|------|-------|
| Name | Text | Pre-filled from Request |
| Purpose | Text (long) | Pre-filled from Request |
| Category | Enum | Pre-filled from Request |
| Company | Lookup | Pre-filled from Request; cannot be changed after creation |
| Department | Lookup | Pre-filled from Request |
| Origin | Enum | Standard, Fast-track, Legacy |
| Status | Enum | See section 3.2 |
| Priority score | Number (0-100) | Inherited from Request on conversion; manually set for Fast-track/Legacy projects |
| Execution progress | Percentage (0-100) | Manual entry |

#### 4.2.2 Timeline Section

| Field | Type | Notes |
|-------|------|-------|
| Target delivery date | Date | From Request, editable |
| Planned start | Date | User-defined; required before transition to In progress |
| Planned end | Date | User-defined; required before transition to In progress |
| Actual start | Date | Auto when status → In progress |
| Actual end | Date | Auto when status → Done |

#### 4.2.3 Baseline Section

Captured automatically when project moves to "In progress". Read-only after capture.

| Field | Type | Notes |
|-------|------|-------|
| Baseline start date | Date | Snapshot of Planned start |
| Baseline end date | Date | Snapshot of Planned end |
| Baseline effort IT | Number (MD) | Snapshot of Estimated effort IT |
| Baseline effort Business | Number (MD) | Snapshot of Estimated effort Business |

**Transition requirement:** Moving a project to "In progress" requires Planned start, Planned end, Estimated effort IT, and Estimated effort Business to be populated.

#### 4.2.4 Effort Section

| Field | Type | Notes |
|-------|------|-------|
| Estimated effort IT | Number (MD) | Pre-filled from Request (see 4.1.3 for conversion logic), editable; required before transition to In progress |
| Estimated effort Business | Number (MD) | Pre-filled from Request (see 4.1.3 for conversion logic), editable; required before transition to In progress |
| Actual effort IT | Number (MD) | Manual entry or integration |
| Actual effort Business | Number (MD) | Manual entry |
| IT effort allocation mode | Enum | `auto` (default) or `manual`; determines how IT effort is distributed among contributors |
| Business effort allocation mode | Enum | `auto` (default) or `manual`; determines how Business effort is distributed among contributors |

##### Effort Allocation

Projects support granular effort allocation per contributor. Each effort type (IT/Business) can operate in one of two modes:

**Automatic Mode (default)**
- IT effort splits among IT lead + IT team members
- Business effort splits among Business lead + Business team members
- Lead receives **10%** (project management overhead)
- Remaining **90%** splits equally among team members
- If lead is also a team member: gets 10% + their equal share of 90%
- If no team but lead exists: lead gets 100%
- If no lead but team exists: 100% split equally among team
- If no lead and no team: no allocations shown

**Integer Rounding Rule (both modes)**

All percentages are integers only. When splitting doesn't divide evenly:
- Use `Math.floor()` for base share
- Distribute remainder (+1 each) to first N contributors (ordered by: lead first, then alphabetically by name)
- Example: 90% among 4 people = 22 + 23 + 23 + 22 = 90% (remainder 2 goes to positions 1 and 2)

**Manual Mode**
- User sets integer percentages per contributor
- Must sum to exactly 100% to save
- Eligible users: Lead + team members (same as auto mode, with deduplication)
- Can edit allocations anytime via "Edit" button
- Can reset back to automatic mode via "Reset" button

**UI Display**

The Progress tab displays mini-tables below each effort input field showing:
- Contributor name with "Lead" badge where applicable
- Allocation percentage
- Man-days (MD) calculated from percentage × estimated effort
- Mode indicator ("Auto-calculated" or "Manual")
- Action buttons: "Manual" (in auto mode), "Edit" and "Reset" (in manual mode)

Orphaned allocations (users no longer on the team but with manual allocations) display a warning indicator.

#### 4.2.5 Team Section

Same structure as Request Team section. Pre-filled from source Request, fully editable.

#### 4.2.6 Relations Section

| Field | Type | Notes |
|-------|------|-------|
| Source requests | Requests (multi) | Link back to originating Request(s) |
| Dependencies | Projects/Requests (multi) | Bidirectional links; circular dependencies prevented |
| CAPEX items | Lookup (multi) | Link to CAPEX entries |
| OPEX items | Lookup (multi) | Link to OPEX entries |
| Applications | Read-only (multi) | Linked from Application Relations tab; displayed in table format |
| Assets | Read-only (multi) | Linked from Asset Relations tab; displayed in table format |
| URLs | URL list | External references |
| Attachments | Files | Supporting documents; max 20 MB per file |

**Note on Applications and Assets:** These relationships are managed from the IT Landscape side (Application and Asset workspaces). Each Application or Asset can link to multiple Projects via their respective Relations tabs. The Project Relations tab displays these links in read-only tables with click-through navigation to the source items.

---

### 4.3 Project Task Entity

Projects can contain tasks for tracking specific deliverables, action items, and work packages. Tasks provide granular work management within the project context.

| Field | Type | Notes |
|-------|------|-------|
| Title | Text | Required; short description of the task |
| Description | Text (long) | Detailed task description |
| Status | Enum | open, in_progress, done, cancelled |
| Priority level | Enum | blocker, high, normal, low, optional |
| Phase | Lookup (optional) | Links to project phase; "Project-level" if null |
| Start date | Date | When work begins |
| Due date | Date | Task deadline |
| Assignee | User (lookup) | Person responsible for the task |
| Creator | User (lookup) | Auto-set on creation |
| Labels | Text array | Freeform tags for categorization |
| Category | Lookup (optional) | From classification hierarchy |
| Stream | Lookup (optional) | From classification hierarchy |

**Priority levels and scoring:**

| Level | Score modifier | Use case |
|-------|----------------|----------|
| Blocker | +10 | Blocking other work; immediate attention required |
| High | +5 | Important and time-sensitive |
| Normal | 0 | Standard priority (default) |
| Low | -5 | Can be deferred if needed |
| Optional | -10 | Nice-to-have, address when capacity allows |

**Task priority score calculation:**

Project tasks display a calculated priority score that combines the parent project's score with the task-level adjustment:

```
task_priority_score = ROUND(CLAMP(project.priority_score + adjustment, 0, 100))
```

Examples:
- Project score: 70, Task priority: "blocker" (+10) → Task score: 80
- Project score: 70, Task priority: "normal" (0) → Task score: 70
- Project score: 95, Task priority: "blocker" (+10) → Task score: 100 (clamped)
- Project score: 5, Task priority: "optional" (-10) → Task score: 0 (clamped)

The score is calculated on-the-fly from the project's current priority score, ensuring immediate consistency when either the project score or task priority changes.

**Score display:**
- **Task workspace:** Circular badge (56×56px, primary color) displayed to the left of the task title, matching the project workspace styling
- **Task list:** Score column showing the calculated value; "-" for non-project tasks

**Attachments:**

Tasks support file attachments for documents, screenshots, and supporting files. The attachment pattern matches other entities (Contracts, Projects, CAPEX):

| Field | Type | Notes |
|-------|------|-------|
| Attachments | Files | Supporting documents; max 20 MB per file |

Attachments are managed via the "Attach files" button in the task header, which toggles a drag-and-drop upload area. Uploaded files appear as chips below the description with download (click) and delete (×) actions.

**Status workflow:**

| Status | Meaning | Constraints |
|--------|---------|-------------|
| Open | Not yet started | Default for new tasks |
| In Progress | Work has begun | — |
| Done | Completed | Requires time logged (validation enforced) |
| Cancelled | No longer needed | — |

**Constraint:** Tasks cannot be marked "Done" until at least one time entry has been logged. This ensures accurate effort tracking.

---

### 4.4 Task Time Entry Entity

Time entries track effort spent on individual tasks. They support granular time tracking at the task level.

| Field | Type | Notes |
|-------|------|-------|
| Task | Lookup | Parent task |
| User | User (lookup) | Person who performed the work |
| Hours | Number | Time spent (decimal, e.g., 1.5) |
| Notes | Text | Description of work performed |
| Logged at | Date | Date the work was performed |
| Logged by | User | Auto-set to current user |

**Calculation notes:**

- Task time is aggregated for project-level reporting
- Conversion: 8 hours = 1 man-day (MD)
- Project Progress tab shows breakdown: Project Overhead vs Task Time

---

### 4.5 Activity Entity

Shared model for Request, Project, and Task activity tracking. Provides unified history, comments, and decision logging.

| Field | Type | Notes |
|-------|------|-------|
| Timestamp | DateTime | Auto-generated |
| Author | User | The actual user who created the entry |
| Context | Text (optional) | Meeting or event context, e.g., "CAB Meeting 2024-12-15", "Weekly Review" |
| Type | Enum | Change, Comment, Decision |
| Content | Rich text | Comment text or decision rationale |
| Decision outcome | Enum (optional) | Go, No-go, Defer, Need info |
| Changed fields | JSON (optional) | For Type=Change: {field: [old, new]} |
| Task | Lookup (optional) | Links to task if activity is task-related |
| Updated at | DateTime (optional) | Set when a comment is edited; null if never edited |

The Activity model supports three entry types:

- **Change:** Auto-logged for field and relation changes. Includes field-level diff.
- **Comment:** Manual entry by any authorized user. Authors can edit their own comments at any time.
- **Decision:** Formal CAB decision with structured outcome and rationale. The Context field captures the meeting reference (e.g., "CAB Meeting 2024-12-15").

**Comment editing:**
- Only `Comment`-type activities can be edited (not Change or Decision)
- Only the original author can edit their comment
- Editing updates the `Content` field and sets `Updated at`
- Edited comments display an "(edited)" indicator in the UI
- No time limit on editing

**Task activities:** When associated with a task, activities appear in the task's Comments/History tabs rather than the project activity feed.

**Auto-logged change categories (current implementation):**

- **Tasks:** `title`, `description`, `status`, `task_type_id`, `priority_level`, `creator_id`, `assignee_user_id`, `start_date`, `due_date`, `labels`, `phase_id`, `source_id`, `category_id`, `stream_id`, `company_id`, plus synthetic `related_to` on context change.
- **Requests:** `name`, `purpose`, `requestor_id`, `target_delivery_date`, classification/org fields, sponsors/leads, analysis fields (`current_situation`, `expected_benefits`, `risks`, `feasibility_review`), and sub-entity diffs (`business_team`, `it_team`, `dependency`, `capex_items`, `opex_items`).
- **Projects:** `name`, `purpose`, classification/org fields, sponsors/leads, `planned_start`, `planned_end`, `execution_progress`, effort fields, effort-allocation mode fields, and sub-entity diffs (`business_team`, `it_team`, `dependency`, `capex_items`, `opex_items`, `phase`, `phase.<phaseId>.<field>`, `task_created`, `created_from_request`).
- **Scoring (requests/projects):** `priority_score` when the score moves numerically, plus `criteria_values` as readable before/after labels of the criteria that changed — never the raw criterion/value identifier maps.
- **Managed documents (requests/projects):** `document_updated` holding the slot key (`purpose`, `risks_mitigations`), which the UI labels in the reader's language.
- **Scoring overrides (requests/projects):** `priority_override`, `override_value`, `override_justification`, `priority_score`.

**Creation is not a stored activity.** The History tab therefore appends a synthetic creation entry, rendered like any other feed row (date with time, and author), as the last entry — the feed is newest first. It is built from the record itself (`created_at`) and the creator resolved from the audit trail: `portfolio_projects` has no creator column, and `tasks.creator_id` holds the requestor — a mutable field — so neither can be used. Accounts without a name are shown by email.

**Snapshot semantics:**

- `changed_fields` is stored as JSONB with structure `{ "<field>": [oldValue, newValue] }`.
- Foreign-key values are resolved to human-readable labels at write time where possible (for example user names), preserving historical readability even if related records are later renamed.
- Numeric columns are compared and stored as numbers: Postgres returns `numeric` as a string, so a plain comparison logs an unchanged value as a change.

**Tenant safety:**

- Requests, projects, and tasks share the same `portfolio_activities` table.
- `portfolio_activities` is tenant-isolated with enforced RLS (`FORCE ROW LEVEL SECURITY`) and canonical policy `tenant_id = app_current_tenant()`.

---

### 4.6 Team Member Configuration

Extended user attributes for capacity planning. Stored in core application Settings.

| Field | Type | Notes |
|-------|------|-------|
| User | User (lookup) | Reference to Users table |
| Areas of expertise | Tags (multi) | From configurable list |
| Project availability | Number (d/w) | Days per week available for project work |

---

### 4.7 Evaluation Criteria

Requests are evaluated against a configurable set of criteria. Each criterion uses a discrete scale of values. The system calculates a priority score (0–100) based on these evaluations.

#### Default Criteria

The following criteria are pre-loaded for a new workspace, with names and value labels in its seed language (English, French, German or Spanish). The English wording is below. Amount and duration labels keep their figures. Each criterion can be enabled, disabled, edited, or removed. Additional criteria can be created.

| Criterion                | Scale (display order)                                    | Inverted |
| ------------------------ | -------------------------------------------------------- | -------- |
| Business value           | 0-10k€, 10-50k€, 50-200k€, 200-500k€, >500k€, Mandatory* | No       |
| Strategic alignment      | Low, Medium, High, Top                                   | No       |
| Project costs            | No direct cost, 0-10k€, 10-50k€, 50-200k€, 200-500k€, >500k€ | Yes  |
| ROI                      | Not quantifiable, >10y, 5-10y, 2-5y, 1-2y, <1y           | No       |
| Risk level               | Negligible, Low, Medium, High, Top                       | Yes      |
| Urgency                  | Low, Medium, High, Critical                              | No       |
| Time estimation IT       | 0-10 MD, 10-20 MD, 20-50 MD, >50 MD                      | Yes      |
| Time estimation Business | 0-10 MD, 10-20 MD, 20-50 MD, >50 MD                      | Yes      |

*\* "Mandatory" has the `triggers_mandatory_bypass` flag enabled by default.*

**Column definitions:**

- **Scale (display order):** Values shown to the user from left to right in the UI. Scales may have any number of items (minimum 2).
- **Inverted:** Determines scoring direction. See section 4.5.1.

---

#### 4.7.1 Scoring Calculation

The priority score is calculated in three steps: per-criterion normalization, weighted aggregation, and optional bypass rules.

##### Step 1: Per-Criterion Percentage

Each criterion's selected value is converted to a percentage (0–100%) based on its position in the scale.

**Formula:**

```
position = zero-based index of selected value in the scale
max_position = number of items in scale − 1

For non-inverted criteria:
    criterion_percent = (position / max_position) × 100

For inverted criteria:
    criterion_percent = ((max_position − position) / max_position) × 100
```

**Example — Non-inverted (Business value, 6 items):**

| Selected value | Position | Calculation       | Percentage |
| -------------- | -------- | ----------------- | ---------- |
| 0-10k€         | 0        | (0 / 5) × 100     | 0%         |
| 10-50k€        | 1        | (1 / 5) × 100     | 20%        |
| 50-200k€       | 2        | (2 / 5) × 100     | 40%        |
| 200-500k€      | 3        | (3 / 5) × 100     | 60%        |
| >500k€         | 4        | (4 / 5) × 100     | 80%        |
| Mandatory      | 5        | (5 / 5) × 100     | 100%       |

**Example — Inverted (Risk level, 5 items):**

| Selected value | Position | Calculation           | Percentage |
| -------------- | -------- | --------------------- | ---------- |
| Negligible     | 0        | ((4 − 0) / 4) × 100   | 100%       |
| Low            | 1        | ((4 − 1) / 4) × 100   | 75%        |
| Medium         | 2        | ((4 − 2) / 4) × 100   | 50%        |
| High           | 3        | ((4 − 3) / 4) × 100   | 25%        |
| Top            | 4        | ((4 − 4) / 4) × 100   | 0%         |

**Key behaviors:**

- Scales can have any number of items; the percentage spreads evenly across the range.
- Adding or removing items from a scale does not break scoring — percentages are recalculated dynamically.
- First display position always scores 0% (non-inverted) or 100% (inverted).
- Last display position always scores 100% (non-inverted) or 0% (inverted).

##### Step 2: Weighted Aggregation

Each active criterion has a configurable weight (positive number, default: 1). The priority score is the weighted average of all criterion percentages.

**Formula:**

```
priority_score = Σ(criterion_percent × weight) / Σ(weight)
```

**Example:**

| Criterion           | Percentage | Weight | Weighted value |
| ------------------- | ---------- | ------ | -------------- |
| Business value      | 60%        | 2      | 120            |
| Strategic alignment | 75%        | 1      | 75             |
| Project costs       | 50%        | 1      | 50             |
| Risk level          | 75%        | 1      | 75             |

```
priority_score = (120 + 75 + 50 + 75) / (2 + 1 + 1 + 1)
               = 320 / 5
               = 64
```

**Key behaviors:**

- Only enabled criteria are included in the calculation.
- Disabled criteria are ignored entirely (not counted in numerator or denominator).
- A criterion with weight = 2 has twice the influence of a criterion with weight = 1.
- The result is always in the range 0–100.

##### Step 3: Bypass and Override Rules

Two mechanisms can replace the calculated score:

**Mandatory bypass (optional, tenant-configurable):**

When enabled via the setting "Mandatory requests automatically score 100 points":
- If the request has selected the scale item flagged as "triggers mandatory bypass", the priority score is set to **100**, regardless of other criteria values.
- Other criteria values are preserved for reporting and capacity planning purposes.
- This bypass is evaluated before manual override.
- **When mandatory bypass is active, manual override is blocked** — the Priority override toggle is disabled and cannot be enabled.
- See section 4.5.2 for flag configuration.

**Manual override:**

- If "Priority override" is enabled on the request, the "Override value" (0–100) replaces the calculated score.
- "Override justification" is required when override is enabled.
- Manual override is only available when mandatory bypass is not active.

**Evaluation order:**

```
1. Calculate weighted score (Steps 1-2)
2. If mandatory bypass enabled AND flagged item selected → score = 100, override blocked
3. If manual override enabled → score = override value
4. Final score is used for prioritization
```

---

#### 4.7.2 Criteria Configuration

Administrators can customize the evaluation framework in the Settings page. All changes apply tenant-wide and affect future evaluations. Existing request scores are recalculated when criteria configuration changes.

##### Managing Criteria

| Action | Rules |
| ------ | ----- |
| Enable/disable criterion | Disabled criteria are hidden from the evaluation form and excluded from score calculation. Existing values are preserved. |
| Create criterion | Requires: name (unique), scale (minimum 2 items), inverted flag, weight. |
| Edit criterion | Name, scale items, inverted flag, and weight can be modified at any time. |
| Delete criterion | Removes the criterion permanently. Existing values on requests are deleted. Requires confirmation. |

##### Managing Scale Items

Each criterion's scale can be customized:

| Action | Rules |
| ------ | ----- |
| Add item | New item is added at a specified position. Existing requests with this criterion retain their selected value. |
| Remove item | Item is removed from scale. Requests that had this value selected are moved to the adjacent position that yields a lower percentage score (see below). Requires confirmation. |
| Reorder items | Display order can be changed. This affects scoring since position determines percentage. Requires confirmation. |
| Rename item | Label change only; no impact on scoring or existing selections. |

**Scale item removal — value reassignment logic:**

When a scale item is deleted, affected requests are automatically reassigned to the adjacent position that yields a lower percentage score:
- **Non-inverted criteria:** Move to the previous position (lower index = lower score)
- **Inverted criteria:** Move to the next position (higher index = lower score)

If the deleted item is at the boundary (first position for non-inverted, last position for inverted), requests are moved to the new boundary position.

**Constraint:** A scale must always have at least 2 items.

##### Mandatory Bypass Setting

The mandatory bypass feature has two components:

**1. Trigger flag (per scale item):**

Any scale item can be marked as the mandatory trigger. In the scale item configuration, a toggle is available:

> **☐ Triggers mandatory bypass**

Constraints:
- Only one item across all criteria can have this flag enabled at a time.
- Enabling the flag on a new item automatically disables it on the previously flagged item.
- The flag is independent of item name, position, or parent criterion — renaming or reordering has no effect.

**2. Tenant-level activation (global setting):**

> **☐ Mandatory requests automatically score 100 points**
> 
> When enabled, requests with the flagged item selected receive a priority score of 100, regardless of other criteria. Manual override is blocked for these requests. Other criteria values are preserved for reporting.

**Default:** Disabled (both the trigger flag and the tenant setting)

**Recommended configuration:** Enable the trigger flag on the "Mandatory" item in the "Business value" criterion (pre-configured in default criteria).

---

#### 4.7.3 Edge Cases and Validation

| Scenario | Behavior |
| -------- | -------- |
| All criteria disabled | Priority score = 0. Warning displayed on request form. |
| Request has no values selected | Priority score = 0 (all percentages default to first position = 0% for non-inverted). |
| Criterion deleted after request evaluated | Deleted criterion's value is removed; score recalculated with remaining criteria. |
| Scale reduced to 1 item | Not allowed. Minimum 2 items enforced. |
| Weight set to 0 | Equivalent to disabling the criterion. |
| Negative weight | Not allowed. Weight must be positive. |
| Flagged item deleted | Mandatory bypass no longer triggers for any request until a new item is flagged. Existing requests previously at score 100 are recalculated normally; their override toggle becomes available. |
| Flagged item's criterion disabled | Bypass does not trigger (criterion not evaluated). Score calculated from remaining criteria. |
| Flagged item's criterion deleted | Same as "flagged item deleted" — bypass no longer triggers. |


## 5. Pages & Features

### 5.1 Section Structure

The Portfolio section includes the following pages:

| Page | Purpose |
|------|---------|
| Requests | Grid view for request management with filters and inline navigation |
| Projects | Grid view for project management, similar structure to Requests |
| Contributors | Manage contributor profiles, skills, availability, and time statistics |
| Planning | Interactive project timeline (Gantt) with filters and drag scheduling |
| Reports | Pre-built portfolio analytics (role-restricted) |
| Settings | Criteria configuration, weights, areas of expertise |

**Contributors page highlights:**
- List view shows average monthly project effort (last 6 months, months with data only)
- Contributor workspace includes a 12‑month time statistics chart (Project/Other/Total in man‑days)
- Time statistics are derived from logged time (project overhead + task time), grouped by UTC month; unassigned time is excluded

---

### 5.2 Requests Page

Standard grid page with full CRUD capabilities. Key features:

- Column filtering, sorting, and full-text search
- Default filter excludes "Converted" and "Rejected" requests
- Inline navigation between requests
- "Convert to Project" action on approved requests
- Priority score displayed prominently in grid and detail view

**Request creation form:** Displays all fields from Overview, Scoring, Effort Estimation, Analysis, and Team sections. Relations and Metadata sections are not displayed on the creation form. No fields are mandatory except Name. This ensures requestors provide sufficient context while maintaining a barrier to entry that discourages non-serious requests.

**Deletion policy:** Requests cannot be deleted. Use "Rejected" status to decline requests while preserving history.

---

### 5.3 Projects Page

Standard grid page mirroring Requests structure. Key features:

- Default filter excludes "Done" and "Cancelled" projects
- Progress bar visualization in grid view
- Quick links to source Request(s)
- "Create Project" action for fast-track/legacy projects without source Request

**Deletion policy:** Projects cannot be deleted. Use "Cancelled" status to stop projects while preserving history.

#### 5.3.1 Project Workspace Tabs

The project workspace provides comprehensive project management through the following tabs:

| Tab | Purpose |
|-----|---------|
| Overview | Core project information, status, classification |
| Activity | Complete audit trail of changes, comments, and formal decisions |
| Team | Business and IT sponsors, leads, and team members |
| Timeline | Phase management with templates, milestones, and baseline tracking |
| Progress | Effort tracking with time breakdown (project overhead vs task time) |
| Tasks | Task management with filtering, inline creation, and work log |
| Scoring | Priority scoring (inherited from request or manual for fast-track) |
| Relations | Dependencies, source requests, linked applications and assets |

#### 5.3.2 Tasks Tab

The Tasks tab provides Jira-style task management within the project context:

**Features:**
- Task list with status, priority, phase, and due date columns
- Filtering by status (Active/All/specific status) and phase
- Quick task creation from the Tasks tab
- [+] button in Timeline tab creates tasks with phase pre-selected
- Click-through to full task workspace

**Task classification:**
- Project tasks store classification (Source, Category, Stream, Company) directly on the task
- When a task is created, classification defaults from the parent project
- Each task's classification can be edited independently (e.g., an infrastructure task within a business project)
- If a task's classification field is not explicitly set, the project's value is displayed as a fallback

**Task time integration:**
- Time logged to tasks contributes to project actual effort
- Progress tab shows breakdown: Project Overhead vs Task Time
- Cannot mark task as "Done" without logged time

---

### 5.4 Planning Page

Interactive planning workspace (`/portfolio/planning`) with two modes:
- **Timeline**: manual planning with editable project bars in Gantt
- **Roadmap Generator**: automatic capacity-aware scheduling simulation with optional transactional apply

#### 5.4.1 Timeline Mode: Scope and Data

- Data source: `GET /portfolio/projects/planning/timeline`
- Displays projects with planned dates (`planned_start`, `planned_end`)
- Includes dependencies between visible projects
- Includes milestones (optional display toggle)
- Excludes cancelled projects
- Requests are not shown in the current implementation

#### 5.4.2 Timeline Mode: Filters and Navigation

- Time range selector: **1 month**, **3 months**, **6 months**, **1 year**
- Category filter (single-select)
- Status filter (multi-select; default: Planned, In Progress, In Testing)
- Milestones toggle
- Month navigation controls:
  - Previous month (`monthOffset - 1`)
  - Today reset (`monthOffset = 0`)
  - Next month (`monthOffset + 1`)

#### 5.4.3 Timeline Mode: Time Window and Scale Behavior

- Visual window length is exactly the selected range (`months`)
- Default positioning keeps approximately **25% past / 75% future** around today when `monthOffset = 0`
- Scale configuration by range:
  - **1 month:** Week + Day
  - **3 months:** Month + Week (week numbers shown)
  - **6 months:** Quarter + Month
  - **12 months:** Year + Month
- Timeline density (`cellWidth`) is tuned per range to keep labels readable
- Horizontal scrolling is contained inside the chart container (no page-level horizontal scroll dependency)

#### 5.4.4 Timeline Mode: Grid and Typography

- Left table currently contains a single `Project` column
- Project column is user-resizable
- Date columns were removed (start/end are represented by bars on the timeline)
- Typography standards:
  - `Project` header: **12px**, bold
  - Project row text: **12px**
  - Bar label text: **11px**
  - Time scale labels (months/weeks): **12px**

#### 5.4.5 Timeline Mode: Today Indicator and Interactions

- Uses a custom vertical overlay line (independent from built-in marker behavior)
- Correctly positions within the current week/day cell in week-based scales
- Marker label is intentionally hidden to avoid overlap with scale headers
- On initial load and on range changes (when `monthOffset = 0`), chart scroll is adjusted so today appears near 25% of the visible width
- Dragging a project bar updates `planned_start` / `planned_end`
- Validation prevents `planned_end < planned_start`
- Double-click behavior routes to project workspace:
  - Project row -> `/portfolio/projects/:id/overview`
  - Milestone row -> `/portfolio/projects/:projectId/timeline`

#### 5.4.6 Roadmap Generator Mode

The Roadmap Generator computes proposed project dates from remaining effort, contributor allocations, dependencies, and capacity assumptions.

**Backend endpoints:**
- `POST /portfolio/reports/roadmap/generate` (permission: `portfolio_reports:reader`)
- `POST /portfolio/projects/planning/roadmap/apply` (permission: `portfolio_projects:contributor`)

**Generation controls:**
- Start date (`YYYY-MM-DD`)
- Status scope (default: Waiting List, Planned, In Progress, In Testing)
- Capacity mode (`theoretical` or `historical`)
- Parallelization limit (1..3)
- Optimization mode (`priority_focused` or `completion_focused`)
- "Recalculate already scheduled projects" (default enabled)
- Context-switch penalty and grace parameters

**Scenario behavior:**
- In Schedule results, row selection defines scenario scope.
- Unchecked rows are excluded entirely and do not consume capacity.
- A category filter is available for roadmap Gantt preview display only (does not change generated schedule dates).
- "Select Visible" / "Clear Visible Selection" operate on currently visible (filtered) Gantt projects only.
- If "Recalculate already scheduled projects" is disabled, already-planned projects stay frozen and consume capacity without being re-timed.
- Best effort with partial capacity: contributors without configured capacity are removed from that project; project is unschedulable only if no contributor with capacity remains.
- For projects already started in the past (`actual_start`, fallback eligible `planned_start`), historical start is preserved and remaining work is scheduled forward.

**Outputs:**
- **Schedule** tab: proposed dates, selection controls, unschedulable reasons, read-only roadmap Gantt preview
- **Bottlenecks** tab: contributor impact (`impactDays`) from sensitivity reruns, with expandable per-contributor project breakdown sorted by planned start date (project name, start/end dates, total contribution days, spent days); contribution/spent values are derived from schedule contributor loads and execution progress
- **Occupation** tab: weekly matrix heatmaps (`week` buckets) for contributors and teams, with rounded occupation percentages per cell; contributor view is grouped by team with merged team labels and week-number columns

**Roadmap Gantt behavior:**
- Uses the same today-centered 25/75 positioning logic as Timeline (`monthOffset = 0`)
- Auto-expands visible horizon so the latest scheduled completion remains reachable
- Shows execution progress inside each project bar
- Auto-sizes vertically to visible row count to avoid internal vertical scrolling in large scenarios

**Apply behavior:**
- Applies selected dates for currently visible projects only (after preview filtering)
- Transactional all-or-nothing update path (if one project fails, no project dates are changed)

#### 5.4.7 Deferred Planning Views (Not Yet Implemented)

- Kanban planning view
- Workload/capacity matrix (contributors x periods)
- Solver-grade optimization mode (CP-SAT/MIP)

---

### 5.5 Reports Page

Pre-built analytics dashboards. Access restricted by role.

| Report | Description |
|--------|-------------|
| Status change report | Tracks standalone tasks, requests, and projects whose status changed during a selected period; one row per item with the latest in-period status and classification context |
| Capacity heatmap | Remaining effort vs capacity by contributor/team, with unassigned work and drill-down |
| Pipeline health | Requests by status, aging analysis (requests >90 days in Pending/Candidate) |
| Delivery performance | Baseline vs. actual dates, on-time completion rate |
| Portfolio balance | Distribution by Category, Company, Business Value tier |
| Trend analysis | Request intake rate, completion rate, backlog evolution over time |

**Status:** Status Change Report and Capacity Heatmap are implemented; the remaining items are planned.

---

### 5.6 Settings Page

#### 5.6.1 Evaluation Criteria Configuration

Manage the list of scoring criteria available tenant-wide (see section 4.5 for details):

- Enable/disable individual criteria
- Edit criterion name and scale descriptions
- Create new custom criteria
- Delete unused criteria (with confirmation)
- Set weight for each active criterion

#### 5.6.2 Areas of Expertise

Configure the list of expertise tags available for team member profiles. Used for competence matrix (future feature), not directly linked to request evaluation.

---

## 6. Permissions & Notifications

### 6.1 Role-Based Access Control

#### 6.1.1 Role Definitions

| Role | Scope | Description |
|------|-------|-------------|
| Request Viewer | Requests | Can view all requests |
| Request Member | Requests | Can view, comment, edit fields, and change status on all requests |
| Project Viewer | Projects | Can view all projects |
| Project Member | Projects | Can view, comment, edit fields, and change status on all projects |
| Demand Manager | All | Full request/project member access + settings configuration |
| Report Viewer | Reports | Can access reports page |
| Admin | All | Full access to all features |

#### 6.1.2 Action Permissions

| Action | Required Role |
|--------|---------------|
| View requests | Request Viewer, Request Member, Demand Manager, Admin |
| Comment on request | Request Member, Demand Manager, Admin |
| Edit request fields | Request Member, Demand Manager, Admin |
| Change request status | Request Member, Demand Manager, Admin |
| Override priority | Demand Manager, Admin |
| View projects | Project Viewer, Project Member, Demand Manager, Admin |
| Comment on project | Project Member, Demand Manager, Admin |
| Edit project fields | Project Member, Demand Manager, Admin |
| Change project status | Project Member, Demand Manager, Admin |
| Create project (any origin) | Project Member, Demand Manager, Admin |
| Configure settings | Demand Manager, Admin |
| Access reports | Report Viewer, Demand Manager, Admin |

### 6.2 Email Notifications

The following notifications are sent automatically:

| Trigger | Recipients |
|---------|------------|
| Request status change | Requestor, all team members (Business + IT leads, sponsors) |
| Project status change | All project team members (leads, sponsors) |
| Added to request team | The added user |
| Added to project team | The added user |
| Send link (manual) | Selected platform users and/or arbitrary email addresses |

**Note:** External contacts (from Contacts table) do not receive automatic email notifications. They can however be reached via the "Send link" feature by typing their email address.

#### 6.2.1 Send Link

Users with reader-level access can send an email notification containing a direct link to any Request, Project, or Task. This is a convenience action for quickly sharing an item with colleagues — it does not grant access or modify permissions.

**Behavior:**
- Available via the **Send link** button in workspace headers (Requests, Projects, Tasks)
- Recipients can be selected from existing platform users and/or entered as arbitrary email addresses
- An optional personal message is included in the email body
- The email contains the sender's name, item name, a clickable link, and the message (if provided)
- No deduplication — each click of "Send" dispatches emails (intentional user action)

---

## 7. Future Considerations (v2+)

The following features are explicitly out of scope for v1 but should be considered in the design to avoid blocking future implementation:

- **Status transition rules:** Configurable workflow with allowed transitions and required approvals
- **Skill-based capacity:** Match required skills to available expertise for smarter resource allocation
- **Hard deadline constraints:** Fixed delivery dates that override pure priority-based sequencing
- **What-if simulation:** Draft planning scenarios without affecting live data
- **Project milestones:** Phase-based tracking with milestone dependencies
- **Bulk actions:** Multi-select operations for CAB review efficiency
- **Saved views:** User-defined filter configurations
- **Scoring templates:** Pre-configured weight profiles (e.g., "Cost-focused", "Strategic")
- **In-app notifications:** Notification center with badge counts
- **Digest emails:** Weekly summary for CIO-level overview
- **Enhanced dependency management:** Dependency impact analysis, blocking rules, cascade notifications when dependent items change status

---

## 8. Appendix: Recommended Libraries

| Component | Library | License | Notes |
|-----------|---------|---------|-------|
| Kanban | dnd-kit | MIT | Modern, accessible drag-drop |
| Gantt/Timeline | frappe-gantt | MIT | Lightweight, clean UI |
| Workload heatmap | D3.js or Nivo | MIT/BSD | Custom build required |

All recommended libraries are compatible with SaaS distribution.
