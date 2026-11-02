# Data access

Roles say what a person can do in each module. Data access says on which part of the budget they can do it. With it, the IT manager of a subsidiary manages the budget of that subsidiary and does not see the others, and a director reads the lines of their own cost centers.

Data access applies to budget lines (OPEX and CAPEX) and to contracts, and to everything that shows them: lists, totals, reports, search, Plaid, exports. The other modules work as before for everyone.

Every person starts with **All data**. Nothing changes until an administrator limits someone.

## Where to find it

- **The user window**: open a user from **Admin > Users** and choose the **Data access** tab, next to **Identity**. The **Data access** entry of a row's menu opens the window on that tab.
- **Admin > Data access**: the list of the people whose access is limited, with the import and the export.
- **The Access tab** of a company and of a cost center or group: who sees it, and through which node.

Permissions: these screens need the Admin level on users (`users:admin`), and all data for yourself. You cannot change your own access.

## All data or limited to

A person is in one of two modes:

- **All data**: the person sees the whole budget and every contract, as their roles allow. This is the default.
- **Limited to**: the person sees what a list of nodes covers. Each node has an access, **Read** or **Edit**.

A node is one of these:

| Node | What it covers |
|---|---|
| A company | The lines the company pays, the lines charged to its cost centers, and its contracts |
| A cost center group | Its sub-groups and their cost centers, whatever their company |
| A cost center | The lines charged to it |
| **Everything** | All lines and all contracts |

A line is visible when a listed company pays it, or when it is charged to a cost center under a listed node. A contract is visible when its company is listed, or when its **Cost center or group** field points under a listed node. That field is optional, and the contracts list has a **Without cost center** column and filter to fill it in.

An example. The workspace has two companies, Alpha France and Alpha Spain, and a group Infrastructure that holds INF-FR (France) and INF-ES (Spain).

- Marta, limited to **Alpha Spain (Edit)**, sees and edits the lines paid by Alpha Spain.
- Paul, limited to **Infrastructure (Read)**, reads the lines charged to INF-FR and INF-ES. A Spanish line with no cost center stays hidden from him.
- Claire, in **All data**, sees everything.

**Everything** serves people who read the whole budget and edit a part of it: give them **Everything (Read)** plus the nodes they edit.

Nodes add up. When two nodes cover the same line, the wider access wins: with Networks in Read and NET-01 in Edit, the lines of NET-01 can be edited and the rest of Networks is read only. A node cannot exclude one of its sub-nodes.

### Creating and moving a line or a contract

To create a line, or to change its company or cost center, the company must fit an Edit node:

- the paying company is a company in Edit, or
- the line's cost center is covered in Edit and the line is paid by that cost center's company.

A cost center node therefore lets a person create the lines of that center, paid by its company. It does not let them make another company pay. A line paid by another company than the company of its cost center is read through the cost center and edited only through its paying company.

Contracts follow the same rule with their company and their **Cost center or group**. The company and cost center pickers offer only the values the person may use. A value outside them is refused with "This company or cost center is not part of your access."

### Lines without a company

Older lines can have no company. They are visible only to people with all data, to people with an **Everything** node, and to the people named on them. **Admin > Data access** counts them, with a link to the list.

## The role says what, the nodes say where

The two work together:

- **Edit** gives what the person's roles allow. A Budget Reader with an Edit node still only reads.
- **Read** caps the access at reading, whatever the roles.
- Data access belongs to the person. It applies to budget and contracts with the level each role gives in each module.

For example, a Budget Member limited to **Alpha Spain (Edit)** creates and edits Spanish lines. A Budget Reader with the same node reads them.

## What a person always sees

A limited person always sees what they are named on, even outside their nodes:

| Named as | Access, within the role |
|---|---|
| IT owner or business owner of a line | Edit |
| Owner of a contract | Edit |
| Assignee or owner of a task | Edit |
| Viewer of a task | Read |

Creating a task does not count. Being named opens the item. It does not let the person move it to a company or cost center outside their Edit nodes, nor delete it. A change that would take a line out of the person's access is refused with "This change would take the line out of your access. Keep yourself as an owner, or ask someone with access to its company."

A limited person with no node sees only what they are named on. An empty list never turns back into all data.

The budget holder of a cost center is not named on its lines. To give budget holders their centers, use **Add their cost centers** in the user window (see below).

## Administrators

The Administrator role always sees all data. Its **Data access** tab reads "Administrators see all data." and has no controls.

When a limited person receives the Administrator role, their stored access stays and has no effect. If the role is removed later, the stored access applies again.

## Setting a person's access

The **Data access** tab of the user window holds:

- **All data** and **Limited to**.
- Under **Limited to**, the nodes, each with its type, a **Read** or **Edit** selector and a remove button.
- **Add**, which opens a picker in three sections: **Companies**, **Cost centers** (groups and centers, as a tree) and **Everything**. Without cost centers in the workspace, the picker offers companies and **Everything**.
- **Add their cost centers (3)**, when the person is the budget holder of cost centers. It adds those centers in Edit.
- Two reminders: "This person also always sees what they are named on." and "Applies to the budget and contracts."
- The preview, for example "With this access: 312 budget lines, 280 editable; 45 contracts."
- Who changed the access last, and when.

The preview follows every change, before you save. It measures the nodes, not the roles: **editable** counts the lines opened in Edit, even when the person's roles do not let them edit.

Switching back to **All data** asks for a confirmation, for example "Marta Ruiz will see all budget and contract data."

One **Save** writes the whole window: the identity tab, then the access. When something is refused, the message shows on its tab and the window stays open.

## The Data access page

**Admin > Data access** lists every limited person, including those with no node:

| Column | Content |
|---|---|
| **Person** | The name. Click it to open the user window on its **Data access** tab |
| **Roles** | The person's roles |
| **Nodes** | Each node with its access, or **None** |
| **Last change** | Who changed the access last, and when |

- **Search a name** filters by name.
- **Who has access to…** filters on a company or cost center: the list keeps the people whose nodes cover it.
- Above the list, two counts: the limited people, and the budget lines without a company, with a link to those lines.

People in **All data** are not listed.

In **Admin > Users**, an **Access** column appears once someone is limited. It reads **All data**, the names of the person's nodes (**Everything** for that node), or **None** for a limited person with no node.

## The Access tab of companies and cost centers

Companies and cost centers have an **Access** tab, for the same people who manage data access.

On a company:

- **See the whole company**: the people with a node on the company, or with **Everything**. **Add** gives a person this company in Read or Edit.
- **See part of it**: the people who reach some of its lines through a group or a cost center of the company, with the node that gives the access. For example, on Alpha Spain: Paul, through Infrastructure.

On a cost center or a group:

- **Direct access**: the people with a node on this center or group. **Add** gives a person this node in Read or Edit.
- **Inherited access**: the people who reach it through a parent group, the company of the center, or **Everything**. The **Via** column links to the node that gives it. Change an inherited access on that node.

Changes on these tabs save at once. When the person you add has all data, a confirmation says that their access will change to this node only. **Cancel** leaves it as it was.

## Import and export

**Import** and **Export** on **Admin > Data access** move the access of many people at once, in a CSV file or an Excel workbook (`.xlsx`). See [CSV and Excel files](csv-files.md). A file holds one row per person and per node:

| Column | Content |
|---|---|
| `email` | The person's email address |
| `type` | `company`, `cost_center` or `all` |
| `node` | A company by its name, a cost center or group by its code. Empty for `all` |
| `access` | `read` or `edit` |

For example:

```text
email;type;node;access
marta.ruiz@example.com;company;Alpha Spain;edit
paul.martin@example.com;cost_center;INF;read
claire.dubois@example.com;all;;read
```

- A person in the file receives exactly the nodes listed for them, in **Limited to**. A person absent from the file does not change.
- An import always limits. To give someone all data again, use the user window.
- The check comes first and writes nothing. It reports each refused row: unknown person, unknown company or cost center, invalid type or access, a node listed twice for one person, an Administrator, your own account. A file with one error loads nothing.
- The export writes the same format, for the limited people. A limited person with no node has no row, so importing the file back leaves them as they are.

The separator, the encoding and the two import steps are those of every CSV file: see [CSV and Excel files](csv-files.md).

## Audit log

Every change of a person's access is recorded in the [Audit log](admin.md#audit-log), in the table **Data access**. The entry names the person and shows the mode, the nodes and their access before and after. Its source is **Screen** or **Import**. A save that changes nothing is not recorded.

## Ask the assistant

[Plaid](ai-assistant.md#tool-calls) reads this page and the Access tab of companies for an administrator of users with access to all data. Ask, for example: "Who is limited to Alpha Spain?", "Which limited people have no node?" or "What can Marta Ruiz see?" Changes to a person's access stay on the screens described here.

## What a limited person sees

For a limited person, the budget and the contracts hold only what their access covers.

**Lists, totals and reports** count the visible lines only. A line is whole or absent. There is no group total.

**Read only.** A line or a contract visible in Read shows "Read only in your access" at the top, without editing commands.

**Links to hidden items.**

- A hidden line shows by its reference only, such as `BL-12`, without a link.
- A hidden contract shows as "Contract outside your access", without a link.
- Lists of links (the lines of a contract, an application, a server, a technology, a project or a request) show the visible links, then a count such as "and 3 lines outside your access". No name, no amount.
- The contract of a visible line opens in read only. Its attachments and document links stay closed, with a count such as "2 attachments, for people who see this contract".
- Search, Plaid, MCP and exports show no trace of a hidden item.

These counts appear to people who read the budget but not those lines. A person without the budget right sees no budget lines in the panels of applications, servers and projects, and no count.

**Figures of a visible item** cover all its data. The coverage of a contract counts all its linked lines, hidden ones included, so its owner sees the real coverage. See [Contracts](contracts.md#commitment-and-coverage).

**Deleting an item that holds hidden links** (an application, a server, a technology, a project, a request) is refused, for example "This application is linked to 3 lines outside your access." Someone who sees those lines can delete it.

**Tasks** of a line or a contract follow it: the person sees them when they see the line or the contract, or when they are named on the task.

**The budget file**, for a person whose role allows it, follows the same rules row by row. See [Load a budget from a spreadsheet](budget-file.md#limited-data-access).

**Dimensions with open values.** On a dimension marked **Open values**, anyone who can edit a line adds a value from the line or the budget file. On the other dimensions, values are created on the Analytics dimensions page, by people with all data. See [Analytics dimensions](analytics.md#open-values).

**Chargeback.** The company chargeback opens on the companies of the person's company nodes (all of them with **Everything**). It shows the share charged to those companies, line by line: reference, label, paying company, method, percentage, amount, and the departments when the allocation goes down to them. A line the person does not otherwise see shows its reference and label without a link. The figures of the other companies and the group totals are left out. The global chargeback shows the visible lines. A cost center node does not open the chargeback of a company. See [Reporting](reports.md#company-chargeback).

### Reserved to people with all data

Even when their roles allow it, a limited person cannot:

- change the workspace settings: freeze and unfreeze, the default allocation rule, budget columns, currencies, the yearly copy of master data, the headcount and metrics of companies and departments;
- run operations on many lines: copy and reset budget columns, copy allocations, bulk delete;
- delete a line or a contract;
- manage people: users, roles, data access, the audit log;
- edit organisation data: companies, departments, cost centers, accounts and charts of accounts, business processes, the dimensions themselves and the values of dimensions without open values;
- edit or delete a supplier or a shared contact (they can create one, as their role allows);
- import suppliers, contacts, contracts or tasks;
- use the AI agents screens;
- change the contract settings, the branding and the scheduled tasks.

The checks that come with these operations (the impact previews, the check before a delete) are reserved too. Those commands are hidden. A request that reaches the server anyway is refused with "This action is reserved to people with access to all data." A person with a budget administration role keeps the budget file within their access.

## When data access is unavailable

Limiting data access needs a one-time step on the database server. Until it is done, **Limited to** is greyed out in the user window, with "Limiting data access needs a one-time step on the database, done by the person who runs KANAP." and a link to this page. **Admin > Data access** shows the same message, with what is missing.

On-premise, the step is in the installation guide: [Data-scoped access](on-premise/installation.md#optional-data-scoped-access).

If the step is undone later, for example after a database restore on another server, limited people are refused with "Data access is temporarily unavailable. Contact the person who runs KANAP." People with all data keep working. Running the step again and restarting the API brings limited people back. See [Backup and restore](on-premise/operations.md#restore).
