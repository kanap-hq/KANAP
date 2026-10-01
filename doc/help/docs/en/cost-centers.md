# Cost centers

A cost center says who owns a budget line: the team or unit that answers for the spend. Each OPEX and CAPEX line can carry one cost center. Cost centers sit in a tree of groups, so you can read the budget of a whole division as easily as the budget of a single team.

## How cost centers differ from other master data

| Master data | What it answers | On a budget line |
|---|---|---|
| **Companies** | Which legal entity pays | The **Paying company** |
| **Departments** | Which units of a company consume IT, with their headcount | Used by allocations and chargeback |
| **Cost centers** | Who owns and answers for the spend | The **Cost center** |
| **Analytics dimensions** | Free classifications for reporting | One field per dimension, for example **Nature** |

A department belongs to one company and drives allocations through its headcount. A cost center carries a code, a company, a budget holder and a place in a tree, and groups of cost centers can span several companies. Cost centers do not change allocations or chargeback.

---

## Groups and cost centers

The tree holds two types of nodes:

- **Group**: holds cost centers and other groups. A group has no company, so it can gather cost centers of several companies. A group cannot be put on a budget line.
- **Cost center**: belongs to one company and has no children. Only cost centers go on budget lines.

Both types can sit at the top level, without a parent. For example:

```
IT division (group)
  Infrastructure (group)
    IT-100  Data centers        Company A
    IT-110  Network             Company B
  IT-200  Business applications  Company A
IT-300  Workplace               Company B
```

Here the **IT division** group gathers cost centers of two companies. Filtering a report on it covers IT-100, IT-110 and IT-200.

---

## Getting started

Navigate to **Master data > Cost centers** (in the **Organization** section) to open the list. Click **New** to create your first entry.

**Required fields**:

- **Code**: the code your finance team uses
- **Name**: the name people know it by
- **Type**: **Group** or **Cost center**
- **Company**: for a cost center only

**Optional but useful**:

- **Parent group**: where it sits in the tree. Leave it empty for the top level
- **Budget holder**: the person accountable for this budget envelope at budget review. Every OPEX and CAPEX line on the cost center shows this person
- **Description**: what the cost center covers

**Tip**: If your finance team already keeps the list of cost centers, import it from a CSV file. The rows can come in any order.

---

## Working with the list

When the workspace has no cost center yet, one line under the title says so: "Cost centers say who owns each budget line. Create one, or import a file."

**Columns**:

- **Code**: the cost center code
- **Name**: indented by level when the list is in tree order
- **Type**: **Group** or **Cost center**
- **Parent**: the group it belongs to
- **Company**: the company of a cost center (empty for a group)
- **Budget holder**: the person accountable for the budget of the cost center
- **Status**: **Enabled** or **Disabled** (hidden by default, add it from the column chooser)

Click any cell to open the workspace.

**Sorting**: The list opens in tree order: each group is followed by what it contains. Click a column header to sort by that column instead. The indentation shows only in tree order.

**Filtering**:

- **Quick search**: searches the code, the name and the full path. Searching for a group's name also finds everything inside it
- **Column filters**: **Type**, **Parent**, **Company** and **Status** use checkbox filters. Clicking **Clear** in the **Status** filter, or unticking both values, lists nothing, whatever **Show** says
- **Status scope**: the **Show: All / Enabled / Disabled** toggle above the list. The list shows enabled nodes by default

**Actions**:

- **New**: create a group or a cost center (requires `cost_centers:member`)
- **Import CSV**: load the tree from a file (requires `cost_centers:admin`)
- **Export CSV**: download every node (requires `cost_centers:admin`)
- **Delete selected**: delete the selected nodes (requires `cost_centers:admin`). Nodes that cannot be deleted are kept and listed with the reason. Contents are deleted before their group, so selecting a group together with everything it holds deletes all of it

---

## Creating a cost center

Click **New**. Fill in the fields, then click **Create**. A new node is enabled.

The **Type** starts on **Cost center**. Choose **Group** to create a group: the **Company** field then disappears.

After **Create**, the workspace of the new node opens.

---

## The cost center workspace

Click any row in the list to open the workspace.

- **Header**: the code as reference, with a copy button, and the name. Click the name to rename it. **Prev** / **Next** move through the list in its current order and filters, and the close button returns to the list
- **Main area**: a line such as "Used by 3 OPEX lines and 1 CAPEX line." when budget lines use the node, then the **Description**
- **Properties panel** on the right: **Code**, **Type**, **Parent group**, **Company** (cost centers only), **Budget holder** and **Lifecycle**

**Autosave**: Every change saves on its own. There is no Save button. Text fields save when you leave them (press Enter in **Code** to save at once); lists and switches save as soon as you pick a value. You can keep working while a change saves. When a change is refused, the reason shows under the field that caused it, for example a duplicate code under **Code**. A refused name shows at the top of the page.

### Fields

| Field | What to enter | Where to find this value |
|---|---|---|
| **Code** | Up to 50 characters. Codes are unique regardless of case: `IT-100` and `it-100` are the same code | The code your finance team uses for this cost center, as in your accounting system or budget referential |
| **Name** | Up to 200 characters | The name used in your budget reviews |
| **Type** | **Group** or **Cost center** | A group gathers; a cost center goes on budget lines |
| **Parent group** | A group, or empty for the top level. A node cannot move under itself or under something it contains, so these are left out of the list | Your organization chart or your finance team's cost center tree |
| **Company** | An enabled company. Cost centers only | The legal entity that pays the costs of this cost center. It is one of your companies in **Master data > Companies** |
| **Budget holder** | An active user | The person accountable for this budget envelope at budget review. The hint under the field says so |
| **Lifecycle** | The status switch, labelled with the current state (**Enabled** or **Disabled**), and the **End of validity** date | Set a future date to schedule the end, or switch it off to disable it today |

### Budget holder on budget lines

Each OPEX and CAPEX line with a cost center shows the cost center's budget holder in its metadata bar, after **IT owner** and **Business owner**. Hover it to see which cost center it comes from.

- **Read from the cost center**: the budget holder is not stored on the line. Change it here and every line of the cost center shows the new person at once. It changes on a line only when you change the line's cost center.
- **Shown only when set**: a line without a cost center, or whose cost center has no budget holder, shows nothing.
- **A separate role**: the **IT owner** and **Business owner** of a line stay as they are, set on each line. They also cover workspaces that do not use cost centers.
- **In the lists**: the OPEX and CAPEX lists have a **Budget holder** column, hidden by default, with a checkbox filter.

### Changing the type

- **From cost center to group**: the company is removed. This is refused while budget lines use the cost center.
- **From group to cost center**: choose **Cost center** in **Type**, then choose the company. The change saves once the company is set. A group that contains nodes cannot become a cost center, so **Type** does not offer it.

### Deleting

The **Delete** button in the header deletes the node at once (requires `cost_centers:admin`). It is disabled, with the reason on one line, when budget lines use the cost center (for example "Used by 3 OPEX lines. Disable it instead.") or when the group still contains nodes (for example "Contains 2 nodes."). Disable the node instead: it stays on its lines and in reports.

---

## Rules you will meet

- **A cost center used by budget lines cannot become a group, and cannot be deleted.** Disable it instead. The message names the lines, for example "IT-300 is used by 3 OPEX lines and 1 CAPEX line. Disable it instead."
- **A group that contains nodes cannot be deleted, and cannot become a cost center.** Move or delete its content first. The message gives the count, for example "Infrastructure still contains 4 nodes. Move or delete them first."
- **Only a group can be a parent.** A cost center has no children.
- **No loops.** A group cannot move under itself or under one of its own groups.
- **Disabled nodes stay where they are.** A disabled cost center stays on the budget lines that already have it and keeps counting in reports. In the pickers it is marked **Disabled** and cannot be chosen for a new line. Disabling a group does not change what it contains, and a disabled group can still receive nodes.
- **Codes are unique regardless of case.** A duplicate code is refused: "A cost center with code IT-100 already exists."
- **Renaming a code keeps the lines.** Budget lines point to the cost center itself, so a new code changes nothing on them. After a rename, lists and reports show the new code. The change is recorded in the audit log.
- **A disabled company or an inactive user cannot be chosen** for a cost center.
- **A company that cost centers belong to cannot be deleted.** Change their company, or disable the company instead.

---

## Cost centers on budget lines

- **OPEX and CAPEX**: the **Cost center** field in the **Properties** panel lists the tree. Groups are shown to help you find your way and cannot be picked. When you create a line and the paying company is empty, picking a cost center fills it with the cost center's company, and the company follows the cost center until you pick a company or an account yourself. When the two companies differ, both are kept and a hint says so. See [OPEX](opex.md) and [CAPEX](capex.md).
- **Lists**: the **Cost center** and **Run or build** columns and filters of the OPEX and CAPEX lists.
- **Reports**: the budget reports can be filtered on a cost center or a group. See [Cost center, run or build and analytics filters](reports.md#cost-center-run-or-build-and-analytics-filters).

---

## CSV import/export

Load or update the whole tree from a file.

**Export**: click **Export CSV**, then **Export data**. The file lists every node, enabled or disabled, in tree order. For an empty file with the headers only, use **Download template** in the import dialog.

**CSV structure**:

- Delimiter: semicolon `;`
- Encoding: UTF-8 (save as "CSV UTF-8" in Excel)
- Headers: `code;kind;name;parent_code;company_name;owner_email;description;status;disabled_at`

| Column | Content |
|---|---|
| `code` | Required. The code of the node. Rows are matched to existing nodes by code, regardless of case |
| `kind` | Required. `group` or `cost_center` |
| `name` | Required |
| `parent_code` | The code of the parent group, from the same file or already in KANAP. Empty for the top level |
| `company_name` | Required for a `cost_center`, empty for a `group`. Matched by company name, regardless of case |
| `owner_email` | The email of the budget holder, an active user. Empty for no budget holder |
| `description` | Free text |
| `status` | `enabled` or `disabled`. Empty means `enabled` for a new node and keeps the stored status on an update |
| `disabled_at` | Optional column. The end of validity: a date (`2026-12-31`) or a full date and time. Empty if there is no end. On an update, a blank `status` and a blank `disabled_at` keep the stored values. `enabled` with an empty date clears the end of validity. `disabled` with an empty date keeps a date that has already passed, and otherwise ends the node today |

**Import**:

1. Click **Import CSV** in the list
2. Choose your file
3. Click **Preflight check**. The report gives the number of rows, the nodes to create and update, and the rows that change nothing
4. If the preflight is clean, click **Load**

**How the import works**:

- **Rows in any order**: a child can come before its parent group. Parents are resolved against the whole file and the nodes already in KANAP.
- **The whole file is checked before anything is written**: each row, then the parents, then the rules of the tree (a cost center has a company, a group has none, only groups are parents, no loops, a cost center used by lines stays a cost center). A file with any error loads nothing: fix the rows and run the preflight again. Each error names its row by the line of the file as a text editor shows it, blank lines and cells that span several lines included.
- **Matching by code**: a row whose code exists updates that node; any other row creates one. Each cell replaces the stored value, so an empty `owner_email` or `description` clears it.
- **Unchanged rows**: a row identical to the stored node changes nothing. Exporting and importing the same file reports every row as unchanged.
- **Nodes missing from the file** are left as they are. The import never deletes.

**Common errors**:

- **"Unknown company '...'"**: create the company in **Master data > Companies**, or fix the name.
- **"Unknown parent code '...'"**: add the parent group to the file, or fix the code.
- **"Unknown budget holder email '...'."** or **"Budget holder '...' is not an active user."**: the `owner_email` cell names the budget holder. Use the email of an active user, or leave the cell empty.
- **"Code ... is already used on row N."**: two rows carry the same code. Keep one.
- **"Type must be 'group' or 'cost_center'."**: fix the `kind` cell.
- **"Status is enabled but the end of validity has passed. Clear the date or set the status to disabled. If the file comes from an older export, export the data again."**: the row is enabled with a date that has passed. A file exported before the date passed still says `enabled`: export it again, or fix the cell.
- **"Status is disabled but the end of validity is still to come. Set the status to enabled or set a date that has passed."**: the row is disabled with a date still to come. Fix the `status` or the `disabled_at` cell.
- **"Header mismatch"**: download a fresh template.

---

## Permissions

| Level | What it allows |
|---|---|
| `cost_centers:reader` | View the list and open cost centers |
| `cost_centers:member` | Create cost centers and groups, and edit them |
| `cost_centers:admin` | Everything above, plus CSV import and export, and deletion |

Each role starts with the level it has on departments, except the built-in Budget Administrator role, which gets admin. So Budget Administrator and Master Data Administrator are admins, Budget Member and Master Data Member are members, and the reader roles can read. Anyone who can read OPEX, CAPEX or reporting can pick a cost center on a line or in a report filter without access to this page.

---

## Tips

- **Mirror your finance referential**: use the same codes as your accounting system so budget lines and actuals line up.
- **Group by responsibility**: build groups around the people who answer for the budget, across companies if needed.
- **Disable, do not delete**: when a cost center closes, disable it. Its lines keep it and reports stay consistent.
- **Name a budget holder**: a budget holder on each cost center shows on every line it carries, so everyone knows who to ask about a line.
