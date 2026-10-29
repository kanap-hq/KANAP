# Assets

Assets document your infrastructure inventory: physical servers, virtual machines, containers, cloud instances, and network devices. Link assets to locations, applications, connections, contracts, projects, and tasks to build a complete picture of your IT infrastructure.

## Getting started

Navigate to **IT Landscape > Assets** to see your asset inventory. Click **Add asset** to create your first entry.

**Required fields**:
- **Name**: The asset name or hostname, up to 200 characters
- **Asset type**: Web server, Virtual machine, Physical server, Container, etc. (configurable in **IT Landscape > Settings**). No type is preselected: **Create** stays unavailable until you choose one
- **Location**: Where the asset is hosted (determines provider, hosting type, and country)

**Strongly recommended**:
- **Lifecycle**: Current status (Active, Deprecated, Retired, etc.)
- **Environment**: Which environment this asset belongs to (Prod, Pre-prod, QA, Test, Dev, Sandbox)

**Unique names**: two assets cannot share a name or an FQDN. Letter case and spaces at either end do not count. KANAP refuses the duplicate and names the asset that already has it (`AST-12`). Duplicates recorded earlier stay editable as long as you leave that value unchanged.

**Tip**: Use consistent naming conventions that include environment and role information (e.g., `prod-web-01`, `dev-db-master`). When creating a new asset, the hostname is automatically derived from the name you type.

**Permissions**:
- View: `infrastructure:reader`
- Create / edit: `infrastructure:member`
- Import / Export / Delete: `infrastructure:admin`

---

## Working with the list { #working-with-the-list }

The asset list gives you a filterable, sortable overview of every asset in your inventory.

**Default columns**:

| Column | What it shows |
|--------|---------------|
| **#** | Asset reference (e.g., `AST-123`), monospaced. Sorts by number |
| **Name** | Asset name (click to open workspace) |
| **Vulnerabilities to review** | The vulnerabilities still to review on the technologies recorded on the asset, then, in orange, how many are critical or high (`5 · 2`). Empty for a retired asset or when none is left. Click it to open the [Vulnerabilities](vulnerabilities.md) page filtered on the asset. Present when vulnerabilities are followed |
| **Asset Type** | The asset's type (e.g., Virtual Machine, Physical Server) |
| **Cluster** | The clusters the asset is a member of. A cluster shows an icon instead ("Cluster" in its tooltip). Empty for an asset in no cluster |
| **Environment** | Prod, Pre-prod, QA, Test, Dev, Sandbox, with a coloured dot |
| **Location** | Where the asset is hosted |
| **Hosting** | Hosting type (derived from location) |
| **OS** | Operating system: the technology marked as the server's operating system, with its version |
| **Network Zone** | The network zone of the subnet of the first IP address. A subnet attached to the asset's location comes before a subnet of the same range with no location |
| **Lifecycle** | Current lifecycle status |
| **Assignments** | Number of application assignments, those inherited from its clusters included |
| **Created** | When the record was created |

**Default sort**: **Created** descending (newest first).

**Additional columns** (hidden by default, available via column chooser):
- **Sub-location**: Specific area within the location (building, room, rack)
- **Go-live**: Date the asset went into production
- **End-of-life**: Planned or actual retirement date
- **Administration zone**: The zone of your administration model the asset belongs to

**Filtering**:

Most columns support checkbox set filters for quick multi-select filtering. Filter options update dynamically based on other active filters and the search query, so you only see values that exist in the current result set.

| Column | Notes |
|--------|-------|
| Asset Type | Filter by one or more asset types |
| Cluster | The cluster names, then **(Is a cluster)** for the clusters themselves and **(No cluster)** for the assets in no cluster |
| Environment | Prod, Pre-prod, QA, Test, Dev, Sandbox |
| Location | Includes "(No location)" for unassigned assets |
| Sub-location | Includes "(No sub-location)" for assets without one |
| Hosting | Filter by hosting type |
| OS | Filter by operating system |
| Network Zone | Filter by network segment |
| Lifecycle | Filter by lifecycle status |
| Administration zone | Includes "(Blank)" for assets without a zone |
| Vulnerabilities to review | **With severe vulnerabilities**, **With vulnerabilities** or **Without**. A retired asset is in none of them |

Sorting on **Vulnerabilities to review** orders the assets by their critical or high vulnerabilities, then by their total. Retired assets come last. The column counts direct links only: a virtual machine does not count the vulnerabilities of its host. See [What KANAP counts](vulnerabilities.md#what-kanap-counts).

**Quick search** looks in the name, the reference, the host name, the FQDN, the IP addresses, the cluster, the location, the sub-location and the operating system.

**Tip**: Combine filters across columns to narrow results. For example, filter by Environment = "Prod" and Lifecycle = "Active" to see only active production assets.

**Actions**:
- **Add asset**: opens a menu (`infrastructure:member`). **Add asset** creates an asset; **Add cluster** creates one with the **Cluster** switch already on
- **Import** / **Export**: Bulk operations in CSV or Excel (`infrastructure:admin`). The export holds the assets the list shows. See [Export options](#export-options)
- **Delete asset** (selected rows): Remove selected assets (`infrastructure:admin`). An asset still assigned to applications or linked to connections cannot be deleted. The refusal names the applications, and up to five connections by reference and name. Remove the asset from them first. An assignment the asset only inherits from its cluster does not block it. Before anything is deleted, the confirmation lists the assets kept, with the reason, and what the others take with them (see [Deleting a cluster or a member](#deleting-a-cluster-or-a-member))

---

## Clusters

Assets can be organized into clusters:

- **Regular asset**: An individual infrastructure instance
- **Cluster**: A group of assets acting as a single logical unit

To create a cluster, choose **Add cluster** in the **Add asset** menu, or turn on the **Cluster** switch in the properties drawer of an asset. A connection set on a cluster applies to its members: see [Connections on a cluster](connections.md#connections-on-a-cluster).

### Applications on a cluster { #applications-on-a-cluster }

An application can be assigned to a cluster, from the **Deployments** tab of the application or the **Operations** tab of the cluster. Its members in service then host the application with the role of the cluster's assignment. A member added later hosts it too. A member taken out of the cluster no longer hosts it. A retired member inherits nothing, and a retired cluster passes nothing on.

Where to assign depends on the cluster:

- **Failover cluster** (SQL Server Always On, for example): the application runs on each node. Assign it to the cluster.
- **Virtualisation cluster** (vSphere, for example): the applications run in the virtual machines the cluster contains. Assign each application to its virtual machine. Only the platform itself, such as vSphere with the virtualisation role, is assigned to the cluster.

A member runs what is assigned to its cluster. An asset the cluster contains runs inside it and inherits nothing.

When you assign an application to a member of a cluster, KANAP asks **Assign to the cluster?**: **Assign to the cluster** puts the assignment on the cluster for all its members, **This server only** keeps it on that server. The question names the members whose own assignment of the same environment and role the cluster's will replace. The cluster's assignment then keeps the earliest **Since** date and their notes. When the member already hosts the application in that role through its cluster, nothing is created and a message says so. An assignment made through the assistant follows the same rules, without the question.

Wherever KANAP reads where an application runs, it counts the members of the cluster: the vulnerabilities and end of support of the application, its hosting type (a cluster without a location takes the hosting type of its members), the administration zones, the applications of a location or of a contract on a server, the assistant and Knowledge. In the impact of a fallen member, the cluster is degraded and its applications keep running. See [Dependencies](#dependencies).

Members are managed at the top of the **Operations** tab of the cluster. See [Operations](#operations). The rules:

- A member is a plain asset. A cluster cannot be a member, and an asset cannot be a member of itself.
- A cluster that has members cannot be turned back into a plain asset: remove its members first.
- A member of a cluster cannot become a cluster: take it out of its clusters first.
- A cluster that has members has no operating system: each member has its own. A cluster without members can keep one, for example a group of cloud instances whose servers you do not record. See [Operating system](#operating-system).

Installations upgraded from an earlier version keep their clusters. Memberships that break these rules were removed during the upgrade. A cluster name typed in the former text field became a real membership when it named exactly one cluster.

### Virtual machines on a cluster { #virtual-machines-on-a-cluster }

A virtualisation cluster contains its virtual machines: add them to the **Contains** section of the cluster, on its **Dependencies** tab. A machine in the cluster can run on any of its hosts.

When you add a **Contains** relation from a host that belongs to a cluster, KANAP asks **Place in the cluster?**. **Place in the cluster** puts the relation on the cluster. **This host only** keeps it on the host. The same question comes when you add such a host under **Contained by**. A retired host or cluster raises no question.

- Placing an asset in the cluster replaces the links the member hosts held to it. A message names the hosts.
- A host cannot contain an asset its cluster already contains. The message names the cluster.
- An asset with two containers in service, such as a host and a cluster, carries a warning icon next to its name in **Contains** and **Contained by**. The tooltip names the other containers. Remove the link that is out of date.

The assistant and the [Netbox synchronisation](netbox.md#clusters) follow the same rules, without the question.

### Deleting a cluster or a member { #deleting-a-cluster-or-a-member }

Before you delete an asset, the confirmation says what goes with it: the clusters it leaves, the members that lose their cluster, and the relations with other assets that are removed. Confirm with **Delete anyway**. The [Audit log](admin.md#audit-log) records these losses: on each cluster it leaves and each asset that held a relation to it, and, for its own members and relations, in the entry of its deletion.

---

## The Assets workspace

Click any row to open the workspace. The workspace has a **header** with quick metadata, a **properties drawer** on the right (the asset's identity card, always visible), and a **content area** in the centre that switches with each tab.

An address that names no asset opens an **Asset not found** page, with a link back to the list.

The tabs are **Overview**, **Operations**, **Network**, **Hardware** (physical asset types only), **Dependencies**, **Relations** and **History** (the changes made to the asset, see [Record history](record-history.md)). When you create an asset, **Overview** and **Network** are open. The other tabs open once you click **Create**.

### Header

The header shows:
- **Asset name** (editable in place)
- **Asset reference** (e.g., `AST-123`): copyable identifier
- **Lifecycle** chip (also editable from the properties drawer)
- **Severe vulnerabilities**, for example "3 severe": the critical or high vulnerabilities still to review on the asset, with the colour of the highest one. An alert icon follows when some are known to be exploited. Click it to open the [Vulnerabilities](vulnerabilities.md) page filtered on the asset. Shown only when the asset has some
- **Share**: copy a shareable link to this workspace
- **Delete**, a trash icon with its name in a tooltip (`infrastructure:admin`). For an asset still in use, the reason shows before any confirmation
- **Previous / Next** (e.g., "3 of 47"): navigate the filtered list without returning to it

### Properties drawer (right panel)

The drawer shows the asset's identity card on every tab. Edits save automatically. The fields come in three groups.

**Type and zone**:
- **Asset type** (required)
- **Cluster**: turn it on to mark the asset as a cluster. The change saves at once and removes nothing. It is refused for a cluster that has members, and for a member of a cluster. See [Clusters](#clusters)
- **Environment**: Prod, Pre-prod, QA, Test, Dev, Sandbox
- **Administration zone**: The zone of your administration model the asset belongs to, for example Tier 0 for a domain controller and the hypervisor that runs it. Choose from the zones configured in **IT Landscape > Settings**, or **No zone**. The asset then appears in that zone on the [Administration zones](administration-view.md) page

**Location**:
- **Location** (required)
- **Sub-location** (when the location has sub-locations defined)
- **Hosting type**, **Operating company** or **Cloud provider**, **Country**, **City**: read-only, derived from the location. They follow when you change the location

**Lifecycle**:
- **Lifecycle**: Active, Deprecated, Retired, etc. (configurable in Settings)
- **Go-live date**: When the asset entered production
- **End-of-life date**: Planned or actual retirement date

---

### Overview

The Overview tab is the asset's home page.

**Netbox**: on an asset linked to Netbox, a line at the top shows when it was last synchronised, with **Open in Netbox**. It also says when the object is no longer in Netbox, when its Netbox status needs attention, and when the asset is **Managed by Netbox**. See [Netbox synchronisation](netbox.md).

**Basics** (when you create an asset): **Name**, **Asset type**, **Location** and **Environment**.

**Description**: A rich-text description of the asset. Autosaves as you edit.

**Support**: the vendor support of the asset, for every asset type. It appears once the asset is created and saves on its own as you type.

- **Vendor**: Select from the supplier directory
- **Support contract**: Link to a contract record
- **Support tier**: Free text (e.g., Gold, Silver, 24x7)
- **Support expiry**: Expiration date
- **Notes**

**Support contacts**: A table where you can add contacts from the contact directory, each with a free-text role label. The table displays each contact's email, phone, and mobile automatically.

**Knowledge**: Linked knowledge articles for this asset. With `knowledge:member` you can create new articles directly from this section. It appears once the asset is created.

---

### Operations { #operations }

The Operations tab shows the cluster of the asset and what runs on it: the applications it hosts, the technologies it carries and their vulnerabilities. It opens once the asset is created.

**Cluster**, at the top of the tab:

- On a **cluster**, the **Members** section lists the member assets (Name, Environment, Status, Operating system). Click a name to open that asset. **Add members** (on a cluster without members) or **Edit members** opens a search dialog. It offers plain assets only, never a cluster or the cluster itself. A warning icon marks a member whose environment differs from the cluster's. When you remove members from a cluster that carries applications, **Remove members?** names the applications each one will no longer host. **Remove anyway** saves.
- On a server that belongs to a cluster, the **Cluster membership** section shows its clusters, with their environment and status. Click a name to open the cluster. A server in no cluster has no such section.

**Hosted applications**: the applications running on this asset. Each row shows:

| Column | What it shows |
|--------|---------------|
| **Application** | Application name. Click it to open the application on its **Deployments** tab |
| **Environment** | The deployment environment the assignment belongs to |
| **Role** | Server role (Web, Database, Application, etc.) |
| **Since** | Date the server was assigned |
| **Notes** | Free-text notes |

Click **Add assignment** to attach this asset to an application deployment. Pick the application, then the environment (the application must already have a deployment in that environment), then the role and optional date / notes. On a member of a cluster, KANAP first asks whether to assign the cluster or this server only. See [Applications on a cluster](#applications-on-a-cluster). The pencil at the end of a row opens the application: the assignment is edited in its **Deployments** tab. The bin icon removes the assignment, after a confirmation. **Add assignment** is unavailable while no server role is set up in **IT Landscape > Settings**. These commands need `infrastructure:member` and `applications:member`. Without both, the table is read-only.

On a member, an application assigned to its cluster shows "via" the cluster's name, without pencil or bin: change it on the cluster.

On a cluster, when an application is assigned directly to each of its members in service, a line under the table names them, with **Assign to the cluster**. After a confirmation, the cluster takes the assignment and the members' own assignments are removed. The application then stays available as long as one member stands.

**Technologies**: what the server carries, for example Windows Server, SQL Server, vSphere or Active Directory. Columns: **Ref**, **Name**, **Family**, **Version** and, when the server carries a technology through another one, **Via**.

- **Operating system**: the server's operating system is one of its technologies, of the **Operating system** family. It comes first in the list, with "Operating system" after its name. See [Operating system](#operating-system) below.
- **Version**: shown in orange when support ends within 12 months or only extended support remains, and in red once every end date has passed. Hover it to see the end of standard and extended support.
- A technology installed on this server can be removed with the cross at the end of its row.
- On a cluster, a technology installed on its members shows once per version, with the members that carry it under **Via**. Such a row follows the installation and is removed there.
- A technology that only comes from the host this server runs in, such as the ESXi of its host, is the underlying platform. It sits under a closed line at the end of the table, **Underlying platform (n)**, with the host under **Via**. Click the line to show it. These rows are not counted in the section.
- **Add** (`infrastructure:member`) opens a search for a technology, then the version picker: choose a version, **Version unknown**, or type a new label and pick **Add version "…"** to create it. Each change saves at once.
- **Change a version** (`infrastructure:member`): click the version of an installed technology, or the pencil at the end of its row. The same version picker opens.

The notes of an installation are changed from the technology's **Servers** tab. See [Technologies](technologies.md#servers).

#### Operating system

A server has one operating system: a technology of the **Operating system** family, with its version.

- **Add** it like any technology. When the server has no operating system yet, the first technology of that family you add becomes it.
- **Remove** it with its cross. If another technology of the family stays on the server, that one becomes the operating system.
- **Change the version** by clicking it, as for any technology.
- A **cluster** that has members has no operating system: each member has its own. A cluster without members can carry one, set by an import or the assistant. On the screen, a technology of that family added to a cluster stays a plain technology.
- Adding the first members to a cluster that has an operating system asks **Remove the operating system?**. **Remove and save** removes it and saves the members. Cancel and nothing is saved.

To make VMware ESXi or FortiOS the operating system of a host, put that technology in the **Operating system** family (its **Family** field, on the technology).

The operating system shows in the **OS** column of the list, in the cluster members table and on the [Connection Map](connection-map.md). Its versions and end of support dates come from the technology: see [Technologies](technologies.md).

#### Vulnerabilities

When vulnerabilities are followed, the last section of the tab lists the vulnerabilities still to review on the technologies recorded on this asset, in the alerts. The count next to the title is the number of distinct vulnerabilities to review: click it to open the [Vulnerabilities](vulnerabilities.md) page filtered on the asset. One line per technology and version:

| Column | What it shows |
|---|---|
| **Technology**, **Version** | The technology and its version. **Version not recorded (potentially concerned)** when the asset names no version |
| **Crit.**, **High**, **Med.**, **Low**, **N/R** | One column per severity (Critical, High, Medium, Low, Not rated, the full name in a tooltip on the header): the vulnerabilities still to review. A vulnerability rated **None** counts with **Low** |
| **Total** | The distinct vulnerabilities still to review on this line |

**See** opens the [Vulnerabilities](vulnerabilities.md) page filtered on the asset and the technology. When nothing is left to review, the section says so in one line. While the first read of a product from the NVD, or the match of a technology just recorded on this asset, is still running, the section says "Searching for vulnerabilities…" and fills in on its own. When the search cannot be completed, the section says so. A retired asset has no section.

On a **cluster**, **On its members** lists apart the technologies of its members, one line per technology and version, with the members that carry it in the **Asset** column. A cluster counts the vulnerabilities of its members in service with its own: the count of the section, the header badge (its tooltip says "members included") and the column of the list. The **See** of a line opens the page on the member that carries it.

What only comes from the host the asset or its members run in, such as the ESXi of the host of a virtual machine, is the underlying platform. It sits under a closed line **Underlying platform (n)**, which a click opens. It is not counted in the section, the badge or the list column: a vulnerability counts on the asset where the technology is recorded. Its **See** opens the page on that host. See [What KANAP counts](vulnerabilities.md#what-kanap-counts).

---

### Network { #network }

The Network tab holds the asset's network identity, its IP addresses and its connections. It is open when you create an asset. If the host name is malformed when you click **Create**, the tab opens on the error.

On an asset managed by Netbox, a line at the top says that Netbox fills in the fields it provides and that the others are yours to complete.

**Identity**:
- **Hostname**: The asset's network hostname. Automatically pre-filled from the asset name on creation; you can override it at any time. Required when a domain is selected. It accepts letters, digits, hyphens and dots, with each part between dots limited to 63 characters, so a name such as `DL3.ROBOT-15MS.IE2000` is valid as it stands.
- **Domain**: The Active Directory or DNS domain the asset belongs to. Choose from domains configured in **IT Landscape > Settings**. System options include "Workgroup" (standalone) and "N/A" (not applicable).
- **FQDN**: Fully Qualified Domain Name, automatically computed from hostname and domain DNS suffix. Read-only.
- **Aliases**: Additional DNS names or aliases for this asset. Type and press Enter to add.

**IP addresses**:

Assets support multiple IP addresses, each with its own network configuration:

- Click **Add IP address** to add a new entry.
- **Type**: The purpose of the IP address (Host, IPMI, Management, iSCSI, or custom types from Settings)
- **IP address**: The address itself. A malformed address is refused, with the message under the field
- **Subnet**: Network subnet from the configured list (filtered to the asset's location)
- **Network zone**: Automatically derived from the selected subnet (read-only)
- **VLAN**: Automatically derived from the selected subnet (read-only)

This lets you document multiple network interfaces per asset, for example a physical server with both a host IP and an IPMI management address on different subnets.

**Connections**: A read-only view of the connections of this asset, once it is created: those where it is an endpoint, a server or the equipment of a hop, and those of its clusters. Each row shows the reference and name (click to open the connection), topology, protocols, source and destination, and lifecycle status. Under the name, **Hop 2** means the asset is the equipment of that hop, and **via** names the cluster when the connection reaches the asset through it. A multi-server connection names its servers in place of the source and destination. To create or edit a connection, navigate to **IT Landscape > Connections**.

---

### Hardware

*Only visible for physical asset types. It opens once the asset is created.*

Tracks physical hardware details. Saves automatically as you type.

- **Serial number**
- **Manufacturer**
- **Model**
- **Purchase date**
- **Rack location** (e.g., Row A, Rack 12)
- **Rack unit** (e.g., U1-U4)
- **Notes**

---

### Dependencies { #dependencies }

The Dependencies tab shows how the asset stands among the other assets: what stops with it and its relations with other assets. It opens once the asset is created. The tab badge counts the relations between assets. The members of a cluster are on the [Operations](#operations) tab.

**If this server goes down**: the tab opens on what stops with this asset. A summary line counts the applications, assets, clusters and business processes affected, then one table per kind:

- **Applications**: those with a deployment in service on a fallen asset, with their environments, criticality and the assets they run on (**Via**).
- **Assets**: the assets it contains, down to three levels, and the assets that depend on it. A cluster that goes down takes all its members in service, and what depends on them. **Via** shows the path.
- **Clusters**: clusters with a fallen member. **Degraded** while a member stands, with the number of members down: its applications keep running. **Down** when no member stands: its applications and the assets it contains, such as its virtual machines, fall with it.
- **Business processes**: the processes of the affected applications.

Retired assets stop the chain: nothing falls through them. Each table shows its first 50 rows and counts the rest. The applications and the processes need the right to read them. The section updates as soon as you add or remove a relation between assets, change the members of a cluster or turn the **Cluster** switch on or off.

**Relations between assets**, one table per direction:

| Section | Meaning |
|---|---|
| **Contains** | The assets inside this one, for example the servers in a rack |
| **Contained by** | The assets this one sits in |
| **Depends on** | The assets this one needs to run, for example a database server |
| **Depended on by** | The assets that need this one |

Each table shows the reference (`AST-12`), name, type, environment and status. A retired or disabled asset stays listed with its name greyed out. Click a row to open the asset.

On a cluster, **Depends on** ends with a folded line, **Through members (n)**. It lists the assets that the cluster's members in service depend on, with those members in the **Via** column. These rows are read-only and stay out of the tab badge.

With `infrastructure:member`, **Add** at the right of a section opens a search for an asset. Pick a result: the relation is saved at once. To remove a relation, hover the row and click the cross at its end. A message confirms it and offers **Undo**. Readers see the tables read-only. A **Contains** relation from a member of a cluster first asks where to place the asset: see [Virtual machines on a cluster](#virtual-machines-on-a-cluster).

---

### Relations

The Relations tab shows what the asset is linked to: budget lines, contracts, projects, tasks and incidents, each in its own table, then its links and files. The relations between assets are on the [Dependencies](#dependencies) tab, and the technologies of the asset on the [Operations](#operations) tab. The tab opens once the asset is created. Click a row to open the record. The tab badge counts the linked records you can see, plus the links and files.

**Linked records**, one table each:

| Section | Columns |
|---|---|
| **Budget lines** | Reference (`BL-12`), name, type (OPEX or CAPEX), supplier, and the amount of the current year in your default budget column, in the reporting currency. A dash means the line has no budget for the year |
| **Contracts** | Name, supplier, end of the current term, yearly amount in the contract currency, renewal (tacit or manual) |
| **Projects** | Reference (`PRJ-7`), name, status, planned end |
| **Tasks** | Reference (`T-118`), title, status, assignee, due date. Open tasks come first |
| **Incidents** | Reference (`INC-14`), title, severity, status, detection date |

You only see the sections of the modules you can read: budget, contracts, portfolio projects, tasks and incidents. A Business Contributor only sees the projects and tasks they take part in. A confidential incident appears only to the people who can see it in the incident register, without its title.

Dates in orange need attention: a contract whose renewal decision is due within your contract decision window, or an open task past its due date. A disabled budget line or contract stays listed with its name greyed out. From two rows on, the budget lines and the contracts end with a total line. The budget line total is in the reporting currency and leaves out a line whose currency has no exchange rate for the year: a one-line warning under the table names it. Contracts get one total per currency, without the disabled ones.

**Adding and removing links** (`infrastructure:member`): **Add** at the right of a section opens a search. Type a name or a reference and pick a result: the link is saved at once. Linking also needs a read of the target module, so **Add** is absent from a section you cannot read. To remove a link, hover the row and click the cross at its end. A message confirms it and offers **Undo**. Removing a link deletes nothing else. Readers see the tables read-only.

- A task you link or unlink here also shows in the task's activity.
- Linking or unlinking an incident also needs `incidents:contributor` and is recorded in the incident's journal. A closed or cancelled incident cannot be linked or unlinked: reopen it first.

**Links and files**: the web links of the asset (vendor portals, monitoring dashboards, documentation) and its files (configuration files, diagrams, vendor documents), one row each with its name, the domain of the link or the size of the file, and the date it was added. Click a link to open it in a new tab, or a file to download it. With `infrastructure:member`:

- **Add link** opens a dialog for a URL and an optional name; the link is saved at once. An address typed without `http://` or `https://` gets `https://`. Any other scheme is refused. To change a link, hover its row and click the pencil.
- **Attach file** opens the file chooser. You can also drop files on the section.
- To remove a link or a file, hover the row and click the cross. Removing a link shows a message and offers **Undo**, which creates the link again. Deleting a file asks for confirmation first.

---

## CSV import/export

Maintain your asset inventory at scale using import and export. This feature supports bulk operations for initial data loading, periodic updates from external systems, and data extraction for reporting.

### Accessing CSV features

From the Assets list:
- **Export**: Download assets to a CSV file or an Excel workbook
- **Import**: Upload a CSV file or an Excel workbook to create or update assets

**Permissions required**: `infrastructure:admin` for import/export operations.

### Export options { #export-options }

**What the file holds**: the assets the list shows. The export follows the column filters and the quick search. The dialog says how many assets the file will hold. You can also export the whole register. The rows keep the order of the list.

**Format**: **CSV** or **Excel (.xlsx)**, chosen in the dialog and remembered in your browser. The workbook holds the same columns as the CSV on one sheet, with numbers and dates as values Excel can sort and filter. The import reads either; in a workbook, it reads the first sheet. See [CSV and Excel files](csv-files.md).

**Columns**: the file starts with `id` and `reference` (`AST-12`), then the columns follow the workspace, tab by tab. The import ignores `reference`.

The asset type, lifecycle, domain, administration zone and IP address type columns hold the names shown on screen, in the language of the screen.

| Option | Description |
|--------|-------------|
| **Full Export** | All exportable fields. Use for reporting and complete data extraction |
| **Data Enrichment** | All importable fields. Matches the import template format, ideal for round-trip editing (export, modify, re-import) |
| **Custom Selection** | Choose specific fields to include in your export |

**Template download** (from Import dialog): Downloads a blank CSV with all importable field headers. Use this to prepare import files with the correct structure.

### Import workflow

1. **Prepare your file**: a CSV file or an Excel workbook (`.xlsx`). Save a CSV file as UTF-8. Commas or semicolons both work, and so does a file Excel saved as plain CSV (Windows-1252). Download a template to ensure correct headers. The separator, amounts, dates and yes or no of each language are in [CSV and Excel files](csv-files.md).

2. **Choose import settings**:
   - **Mode**:
     - `Enrich` (default): Empty cells preserve existing values: only update what you specify
     - `Replace`: Replaces the values of the columns in the file. An empty cell clears the stored value. A column left out of the file keeps its values. Some fields cannot be cleared: **Preflight** points them out.
   - **Operation**:
     - `Upsert` (default): Create new assets or update existing ones
     - `Update only`: Only modify existing assets, skip new ones
     - `Insert only`: Only create new assets, skip existing ones

3. **Validate first**: Click **Preflight** to validate your file without making changes. Review errors and warnings.

4. **Apply changes**: If validation passes, click **Import** to commit changes.

### What preflight refuses

Preflight reports an error on the row, and nothing is loaded, for:

- a host name that breaks the rule of the Network tab;
- a malformed IP address;
- an asset type, domain, lifecycle, administration zone or IP address type that matches nothing in **IT Landscape > Settings**;
- a date that is not on the calendar, such as `31/02/2025`, or a date written in words. See [CSV and Excel files](csv-files.md) for the forms a date can take;
- an IP address slot filled while an earlier one is empty, for example `ip_2_address` without `ip_1_address`;
- a name or an FQDN that another asset already has.

For an existing asset, the host name and the IP addresses are checked again only when the file changes them.

### Field reference

**Core fields**:

| CSV Column | Description | Required | Notes |
|------------|-------------|----------|-------|
| `id` | Asset UUID | No | For updates; leave blank for new assets |
| `name` | Asset name | Yes | Used as unique identifier for matching |
| `location_reference` | Location code | Yes | The **Code** of an existing location |
| `kind` | Asset type | Yes | Accepts code or label (e.g., `vm` or `Virtual Machine`) |
| `environment` | Environment | Yes | `prod`, `pre_prod`, `qa`, `test`, `dev`, `sandbox` |
| `status` | Lifecycle status | No | Accepts code or label (e.g., `active` or `Active`) |
| `is_cluster` | Is this a cluster | No | `yes` or `no` |
| `hostname` | Network hostname | No | |
| `domain` | DNS domain | No | Accepts code or label from Settings |
| `admin_zone` | Administration zone | No | Accepts code or label from Settings |
| `aliases` | DNS aliases | No | Comma-separated list |
| `operating_system` | Operating system | No | The technology name, with its version (`Windows Server 2019`). See below |
| `cluster` | Cluster Membership | No | The names of the clusters the asset is a member of, separated by commas. See below |
| `notes` | Free-form notes | No | |

**IP Address fields** (up to 4 addresses per asset):

| CSV Column | Description | Notes |
|------------|-------------|-------|
| `ip_1_type` | IP address type | Accepts code or label (e.g., `host` or `Host IP`) |
| `ip_1_address` | IP address | |
| `ip_1_subnet_cidr` | Subnet in CIDR notation | |
| `ip_2_type` through `ip_4_type` | Additional IP types | Same pattern for slots 2-4 |
| `ip_2_address` through `ip_4_address` | Additional addresses | |
| `ip_2_subnet_cidr` through `ip_4_subnet_cidr` | Additional subnets | |

### Label and code acceptance

For fields configured in **IT Landscape > Settings**, you can use either the internal code or the name shown on screen, in English, French, German or Spanish:

| Field | Example codes | Example labels |
|-------|---------------|----------------|
| Asset Type (`kind`) | `vm`, `physical`, `container` | `Virtual Machine`, `Physical Server`, `Container` |
| Lifecycle (`status`) | `active`, `inactive`, `decommissioned` | `Active`, `Inactive`, `Decommissioned` |
| Domain | `corp`, `dmz` | `Corporate Domain`, `DMZ` |
| Administration zone (`admin_zone`) | `tier_0`, `tier_1` | `Tier 0 (core of trust)`, `Tier 1 (servers and applications)` |
| IP Address Type | `host`, `ipmi`, `mgmt` | `Host IP`, `IPMI`, `Management` |

The system automatically normalizes values during import, so `Virtual Machine`, `virtual machine`, and `vm` all resolve to the same asset type. A value that matches several entries is refused rather than guessed. The export writes names for these columns, in the language of the screen, so an exported file can be imported back as is.

**Operating system**: the `operating_system` column holds the technology name followed by its version, as the export writes it (`Windows Server 2019`, `Ubuntu 24.04 LTS`). On import, KANAP looks for the technology among yours, then in the catalog, and records the version. A technology or a version it does not find is created, so check the spelling first. The value becomes the server's operating system.

**Cluster Membership**: the `cluster` column names the clusters of the asset, separated by commas (`ESX-PROD, SQL-CLUSTER`). Case does not matter. The export writes the clusters the asset is a member of. On import:

- With `Enrich`, the asset joins the clusters named in the cell and stays in its other clusters.
- With `Replace`, the asset also leaves the clusters its cell does not name.
- An empty cell changes nothing, in both modes.

**Preflight** reports an error on the row when a name matches no asset, matches several clusters, or names an asset that is not a cluster. It also refuses a row that names itself, a row that is or becomes a cluster, and a cluster that has an operating system: the import never removes one. The `is_cluster` and `operating_system` columns follow the rules of [Clusters](#clusters).

### Matching and updates

Assets are matched by **name** (case-insensitive). When a match is found:
- With `Enrich` mode: Only non-empty CSV values update the asset
- With `Replace` mode: The columns in the file are updated, and an empty cell clears the stored value. Columns left out of the file keep their values. The name, the `id`, the status and required fields cannot be cleared: **Preflight** reports an error on the row. For the IP address columns, only the sub-columns in the file are applied. A new asset gets the default values.

If you include the `id` column with a valid UUID, matching uses ID first, then falls back to name.

### Derived fields

Some fields are computed and cannot be imported:
- **Provider**: Automatically derived from the asset's location, and updated when the location changes
- **FQDN**: Computed from hostname + domain
- **Vulnerabilities**: `vulnerabilities_to_review` (the vulnerabilities still to review) and `severe_vulnerabilities` (those critical or high), as the list column counts them. Export only: the import ignores them. Empty for a retired asset. Left out of the file when vulnerabilities are not followed

### Limitations

- **Maximum 4 IP addresses**: Assets support up to 4 IP address entries in a file
- **Location required**: Every asset must have the code of an existing location
- **Relations not included**: Application assignments, connections, financial links, projects, tasks, and attachments must be managed in the workspace

### Troubleshooting

**"File isn't properly formatted" error**: This usually indicates an encoding issue. Ensure your CSV is saved as **UTF-8**:

- **In LibreOffice**: When opening a CSV, select `UTF-8` in the Character set dropdown (not "Japanese (Macintosh)" or other encodings). When saving, check "Edit filter settings" and choose UTF-8.
- **In Excel**: Save As > CSV UTF-8 (Comma delimited).
- **General tip**: If you see garbled characters at the start of your file, the encoding is incorrect.

### Example CSV

```csv
name;location_reference;kind;environment;status;hostname;domain;ip_1_type;ip_1_address
PROD-WEB-01;NYC-DC1;Virtual Machine;prod;Active;prodweb01;corp;Host IP;10.0.1.10
PROD-DB-01;NYC-DC1;vm;prod;active;proddb01;corp;host;10.0.1.20
```

---

## Tips

- **Name consistently**: Include environment, role, and sequence in asset names for easy identification.
- **Use clusters**: Group related assets (e.g., web cluster, database cluster) to simplify management. Assign an application that runs on every node to the cluster, and an application of a virtual machine to that machine.
- **Track lifecycle**: Mark deprecated and retired assets to keep inventory counts accurate.
- **Link to locations**: Assign assets to locations so hosting type, country and city are populated automatically.
- **Assign to applications**: Use the **Hosted applications** section of the Operations tab to link assets to application deployments. The same assignments appear under the application's Deployments tab.
- **Use the Relations tab**: Connect assets to budget lines, contracts, and projects for financial visibility.
- **Link tasks here**: Add a task under Relations > Tasks. The link also shows in the task's activity.
- **Attach documentation**: Upload configuration files, architecture diagrams, or vendor docs directly to the Relations tab.
