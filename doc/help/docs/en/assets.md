# Assets

Assets document your infrastructure inventory: physical servers, virtual machines, containers, cloud instances, and network devices. Link assets to locations, applications, connections, contracts, projects, and tasks to build a complete picture of your IT infrastructure.

## Getting started

Navigate to **IT Landscape > Assets** to see your asset inventory. Click **Add asset** to create your first entry.

**Required fields**:
- **Name**: A unique asset name or hostname
- **Asset type**: Web server, Virtual machine, Physical server, Container, etc. (configurable in **IT Landscape > Settings**)
- **Location**: Where the asset is hosted (determines provider, hosting type, and country)

**Strongly recommended**:
- **Lifecycle**: Current status (Active, Deprecated, Retired, etc.)
- **Environment**: Which environment this asset belongs to (Prod, Pre-prod, QA, Test, Dev, Sandbox)

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
| **#** | Asset reference (e.g., `AST-123`), monospaced |
| **Name** | Asset name (click to open workspace) |
| **Vulnerabilities to review** | The vulnerabilities still to review on the technologies recorded on the asset, then, in orange, how many are critical or high (`5 · 2`). Empty for a retired asset or when none is left. Click it to open the [Vulnerabilities](vulnerabilities.md) page filtered on the asset. Present when vulnerabilities are followed |
| **Asset Type** | The asset's type (e.g., Virtual Machine, Physical Server) |
| **Cluster** | Cluster membership, or a "Cluster" badge if this asset is itself a cluster |
| **Environment** | Prod, Pre-prod, QA, Test, Dev, Sandbox, with a coloured dot |
| **Location** | Where the asset is hosted |
| **Hosting** | Hosting type (derived from location) |
| **OS** | Operating system: the technology marked as the server's operating system, with its version |
| **Network Zone** | Network segment (derived from subnet) |
| **Lifecycle** | Current lifecycle status |
| **Assignments** | Number of application assignments |
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
| Cluster | Includes "(No cluster)" for standalone assets |
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

**Tip**: Combine filters across columns to narrow results. For example, filter by Environment = "Prod" and Lifecycle = "Active" to see only active production assets.

**Actions**:
- **Add asset**: Create a new asset (`infrastructure:member`)
- **Import CSV** / **Export CSV**: Bulk operations (`infrastructure:admin`)
- **Delete asset** (selected rows): Remove selected assets (`infrastructure:admin`). An asset still assigned to applications or linked to connections cannot be deleted: remove it from them first. Before anything is deleted, the confirmation lists the assets kept, with the reason

---

## Clusters

Assets can be organized into clusters:

- **Regular asset**: An individual infrastructure instance
- **Cluster**: A group of assets acting as a single logical unit

To mark an asset as a cluster, turn on the **Cluster** switch in its properties drawer. Cluster assets can be endpoints in connections. Applications are assigned to the member hosts.

Cluster members are managed from the **Dependencies** tab of the cluster's workspace via **Edit members**. See [Dependencies](#dependencies).

---

## The Assets workspace

Click any row to open the workspace. The workspace has a **header** with quick metadata, a **properties drawer** on the right (the asset's identity card, always visible), and a **content area** in the centre that switches with each tab.

The tabs are **Overview**, **Operations**, **Network**, **Hardware** (physical asset types only), **Dependencies** and **Relations**. When you create an asset, **Overview** and **Network** are open. The other tabs open once you click **Create**.

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
- **Cluster**: turn it on to mark the asset as a cluster. The change saves at once. A cluster has no operating system of its own, so turning the switch on removes the asset's operating system. See [Clusters](#clusters)
- **Environment**: Prod, Pre-prod, QA, Test, Dev, Sandbox
- **Administration zone**: The zone of your administration model the asset belongs to, for example Tier 0 for a domain controller and the hypervisor that runs it. Choose from the zones configured in **IT Landscape > Settings**. The asset then appears in that zone on the [Administration zones](administration-view.md) page

**Location**:
- **Location** (required)
- **Sub-location** (when the location has sub-locations defined)
- **Hosting type**, **Operating company** or **Cloud provider**, **Country**, **City**: read-only, derived from the location

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

The Operations tab shows what runs on the asset: the applications it hosts, the technologies it carries and their vulnerabilities. It opens once the asset is created.

**Hosted applications**: the applications running on this asset. Each row shows:

| Column | What it shows |
|--------|---------------|
| **Application** | Application name. Click it to open the application on its **Deployments** tab |
| **Environment** | The deployment environment the assignment belongs to |
| **Role** | Server role (Web, Database, Application, etc.) |
| **Since** | Date the server was assigned |
| **Notes** | Free-text notes |

Click **Add assignment** to attach this asset to an application deployment. Pick the application, then the environment (the application must already have a deployment in that environment), then the role and optional date / notes. The pencil at the end of a row opens the application: the assignment is edited in its **Deployments** tab. The bin icon removes the assignment, after a confirmation.

On a cluster, a notice above the table asks you to assign the member hosts instead, and **Add assignment** is unavailable. It is also unavailable while no server role is set up in **IT Landscape > Settings**.

**Technologies**: what the server carries, for example Windows Server, SQL Server, vSphere or Active Directory. Columns: **Ref**, **Name**, **Family**, **Version** and, when the server carries a technology through another one, **Via**.

- **Operating system**: the server's operating system is one of its technologies, of the **Operating system** family. It comes first in the list, with "Operating system" after its name. See [Operating system](#operating-system) below.
- **Version**: shown in orange when support ends within 12 months or only extended support remains, and in red once every end date has passed. Hover it to see the end of standard and extended support.
- A technology installed on this server can be removed with the cross at the end of its row.
- A technology installed on the server or cluster this one runs in shows that server under **Via**. It follows the installation and is removed there.
- **Add** (`infrastructure:member`) opens a search for a technology, then the version picker: choose a version, **Version unknown**, or type a new label and pick **Add version "…"** to create it. Each change saves at once.
- **Change a version** (`infrastructure:member`): click the version of an installed technology, or the pencil at the end of its row. The same version picker opens.

The notes of an installation are changed from the technology's **Servers** tab. See [Technologies](technologies.md#servers).

#### Operating system

A server has one operating system: a technology of the **Operating system** family, with its version.

- **Add** it like any technology. When the server has no operating system yet, the first technology of that family you add becomes it.
- **Remove** it with its cross. If another technology of the family stays on the server, that one becomes the operating system.
- **Change the version** by clicking it, as for any technology.
- A **cluster** has no operating system of its own: each member has its own. Turning on the **Cluster** switch of an asset removes its operating system.

To make VMware ESXi or FortiOS the operating system of a host, put that technology in the **Operating system** family (its **Family** field, on the technology).

The operating system shows in the **OS** column of the list, in the cluster members table and on the [Connection Map](connection-map.md). Its versions and end of support dates come from the technology: see [Technologies](technologies.md).

#### Vulnerabilities

When vulnerabilities are followed, the last section of the tab lists the vulnerabilities still to review on the technologies recorded on this asset, in the alerts. The count next to the title is the number of distinct vulnerabilities to review: click it to open the [Vulnerabilities](vulnerabilities.md) page filtered on the asset. One line per technology and version:

| Column | What it shows |
|---|---|
| **Technology**, **Version** | The technology and its version. **Version not recorded (potentially concerned)** when the asset names no version |
| **Crit.**, **High**, **Med.**, **Low**, **N/R** | One column per severity (Critical, High, Medium, Low, Not rated, the full name in a tooltip on the header): the vulnerabilities still to review. A vulnerability rated **None** counts with **Low** |
| **Total** | The distinct vulnerabilities still to review on this line |

**See** opens the [Vulnerabilities](vulnerabilities.md) page filtered on the asset and the technology. When nothing is left to review, the section says so in one line. A retired asset has no section.

**Through another asset** lists apart the technologies the asset gets from another one, such as the host it runs on or its cluster, with that asset in the **Asset** column. These lines are not counted, in the badge or anywhere else: a vulnerability counts on the asset where the technology is recorded. Their **See** opens the page on that other asset. See [What KANAP counts](vulnerabilities.md#what-kanap-counts).

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
- **IP address**: The address itself
- **Subnet**: Network subnet from the configured list (filtered to the asset's location)
- **Network zone**: Automatically derived from the selected subnet (read-only)
- **VLAN**: Automatically derived from the selected subnet (read-only)

This lets you document multiple network interfaces per asset, for example a physical server with both a host IP and an IPMI management address on different subnets.

**Connections**: A read-only view of all connections involving this asset, once it is created. Each row shows the connection ID and name (clickable: opens the Connection workspace), topology (Server to Server or Multi-server), protocols, source and destination endpoint labels, and lifecycle status. To create or edit a connection, navigate to **IT Landscape > Connections**.

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

The Dependencies tab shows how the asset stands among the other assets: what stops with it, its cluster, and its relations with other assets. It opens once the asset is created. The tab badge counts the relations between assets, plus the members of a cluster or the clusters the asset belongs to.

**If this server goes down**: the tab opens on what stops with this asset. A summary line counts the applications, assets, clusters and business processes affected, then one table per kind:

- **Applications**: those with a deployment in service on a fallen asset, with their environments, criticality and the assets they run on (**Via**).
- **Assets**: the assets it contains, down to three levels, and the assets that depend on it. **Via** shows the path.
- **Clusters**: clusters with a fallen member. **Down** when no member stands, otherwise **Degraded** with the number of members down. The applications of a cluster that is down fall with it.
- **Business processes**: the processes of the affected applications.

Retired assets stop the chain: nothing falls through them. Each table shows its first 50 rows and counts the rest. The applications and the processes need the right to read them. The section updates as soon as you add or remove a relation between assets, change the members of a cluster or turn the **Cluster** switch on or off.

**Cluster**:

- On a **cluster**, a note recalls that a cluster can be an endpoint in connections and that applications are assigned to its member hosts. The **Members** section lists the member assets (Name, Environment, Status, Operating system). Click a name to open that asset. Click **Edit members** to add or remove members through a search dialog.
- On **any other asset**, the **Cluster membership** section shows the clusters this asset belongs to, with their environment and status. Click a name to open the cluster.

**Relations between assets**, one table per direction:

| Section | Meaning |
|---|---|
| **Contains** | The assets inside this one, for example the servers in a rack |
| **Contained by** | The assets this one sits in |
| **Depends on** | The assets this one needs to run, for example a database server |
| **Depended on by** | The assets that need this one |

Each table shows the reference (`AST-12`), name, type, environment and status. A retired or disabled asset stays listed with its name greyed out. Click a row to open the asset.

With `infrastructure:member`, **Add** at the right of a section opens a search for an asset. Pick a result: the relation is saved at once. To remove a relation, hover the row and click the cross at its end. Readers see the tables read-only.

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

**Adding and removing links** (`infrastructure:member`): **Add** at the right of a section opens a search. Type a name or a reference and pick a result: the link is saved at once. Linking also needs a read of the target module, so **Add** is absent from a section you cannot read. To remove a link, hover the row and click the cross at its end. Removing a link deletes nothing else. Readers see the tables read-only.

- A task you link or unlink here also shows in the task's activity.
- Linking or unlinking an incident also needs `incidents:contributor` and is recorded in the incident's journal. A closed or cancelled incident cannot be linked or unlinked: reopen it first.

**Links and files**: the web links of the asset (vendor portals, monitoring dashboards, documentation) and its files (configuration files, diagrams, vendor documents), one row each with its name, the domain of the link or the size of the file, and the date it was added. Click a link to open it in a new tab, or a file to download it. With `infrastructure:member`:

- **Add link** opens a dialog for a URL and an optional name; the link is saved at once. To change a link, hover its row and click the pencil.
- **Attach file** opens the file chooser. You can also drop files on the section.
- To remove a link or a file, hover the row and click the cross. Deleting a file asks for confirmation first.

---

## CSV import/export

Maintain your asset inventory at scale using CSV import and export. This feature supports bulk operations for initial data loading, periodic updates from external systems, and data extraction for reporting.

### Accessing CSV features

From the Assets list:
- **Export CSV**: Download assets to a CSV file
- **Import CSV**: Upload a CSV file to create or update assets

**Permissions required**: `infrastructure:admin` for import/export operations.

### Export options

| Option | Description |
|--------|-------------|
| **Full Export** | All exportable fields. Use for reporting and complete data extraction |
| **Data Enrichment** | All importable fields. Matches the import template format, ideal for round-trip editing (export, modify, re-import) |
| **Custom Selection** | Choose specific fields to include in your export |

**Template download** (from Import dialog): Downloads a blank CSV with all importable field headers. Use this to prepare import files with the correct structure.

### Import workflow

1. **Prepare your file**: Save it as UTF-8. Commas or semicolons both work, and so does a file Excel saved as plain CSV (Windows-1252). Download a template to ensure correct headers. The separator, amounts, dates and yes or no of each language are in [CSV files](csv-files.md).

2. **Choose import settings**:
   - **Mode**:
     - `Enrich` (default): Empty cells preserve existing values: only update what you specify
     - `Replace`: Empty cells clear existing values: full replacement of all fields
   - **Operation**:
     - `Upsert` (default): Create new assets or update existing ones
     - `Update only`: Only modify existing assets, skip new ones
     - `Insert only`: Only create new assets, skip existing ones

3. **Validate first**: Click **Preflight** to validate your file without making changes. Review errors and warnings.

4. **Apply changes**: If validation passes, click **Import** to commit changes.

### Field reference

**Core fields**:

| CSV Column | Description | Required | Notes |
|------------|-------------|----------|-------|
| `id` | Asset UUID | No | For updates; leave blank for new assets |
| `name` | Asset name | Yes | Used as unique identifier for matching |
| `location_code` | Location code | Yes | Must match an existing location code |
| `kind` | Asset type | Yes | Accepts code or label (e.g., `vm` or `Virtual Machine`) |
| `environment` | Environment | Yes | `prod`, `pre_prod`, `qa`, `test`, `dev`, `sandbox` |
| `status` | Lifecycle status | No | Accepts code or label (e.g., `active` or `Active`) |
| `is_cluster` | Is this a cluster | No | `yes` or `no` |
| `hostname` | Network hostname | No | |
| `domain` | DNS domain | No | Accepts code or label from Settings |
| `admin_zone` | Administration zone | No | Accepts code or label from Settings |
| `aliases` | DNS aliases | No | Comma-separated list |
| `operating_system` | Operating system | No | The technology name, with its version (`Windows Server 2019`). See below |
| `cluster` | Cluster membership | No | Name of parent cluster |
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

For fields configured in **IT Landscape > Settings**, you can use either the internal code or the display label:

| Field | Example codes | Example labels |
|-------|---------------|----------------|
| Asset Type (`kind`) | `vm`, `physical`, `container` | `Virtual Machine`, `Physical Server`, `Container` |
| Lifecycle (`status`) | `active`, `inactive`, `decommissioned` | `Active`, `Inactive`, `Decommissioned` |
| Domain | `corp`, `dmz` | `Corporate Domain`, `DMZ` |
| Administration zone (`admin_zone`) | `tier_0`, `tier_1` | `Tier 0 (core of trust)`, `Tier 1 (servers and applications)` |
| IP Address Type | `host`, `ipmi`, `mgmt` | `Host IP`, `IPMI`, `Management` |

The system automatically normalizes values during import, so `Virtual Machine`, `virtual machine`, and `vm` all resolve to the same asset type. A value that matches several entries is refused rather than guessed. The CSV export writes names for these columns, so an exported file can be imported back as is.

**Operating system**: the `operating_system` column holds the technology name followed by its version, as the export writes it (`Windows Server 2019`, `Ubuntu 24.04 LTS`). On import, KANAP looks for the technology among yours, then in the catalog, and records the version. A technology or a version it does not find is created, so check the spelling first. The value becomes the server's operating system.

### Matching and updates

Assets are matched by **name** (case-insensitive). When a match is found:
- With `Enrich` mode: Only non-empty CSV values update the asset
- With `Replace` mode: All fields are updated, empty values clear existing data

If you include the `id` column with a valid UUID, matching uses ID first, then falls back to name.

### Derived fields

Some fields are computed and cannot be imported:
- **Provider**: Automatically derived from the asset's location
- **FQDN**: Computed from hostname + domain
- **Vulnerabilities**: `vulnerabilities_to_review` (the vulnerabilities still to review) and `severe_vulnerabilities` (those critical or high), as the list column counts them. Export only: the import ignores them. Empty for a retired asset. Left out of the file when vulnerabilities are not followed

### Limitations

- **Maximum 4 IP addresses**: Assets support up to 4 IP address entries via CSV
- **Cluster assignment by name**: Use the cluster name, not ID, in the `cluster` column
- **Location required**: Every asset must have a valid location code
- **Relations not included**: Application assignments, connections, financial links, projects, tasks, and attachments must be managed in the workspace

### Troubleshooting

**"File isn't properly formatted" error**: This usually indicates an encoding issue. Ensure your CSV is saved as **UTF-8**:

- **In LibreOffice**: When opening a CSV, select `UTF-8` in the Character set dropdown (not "Japanese (Macintosh)" or other encodings). When saving, check "Edit filter settings" and choose UTF-8.
- **In Excel**: Save As > CSV UTF-8 (Comma delimited).
- **General tip**: If you see garbled characters at the start of your file, the encoding is incorrect.

### Example CSV

```csv
name;location_code;kind;environment;status;hostname;domain;ip_1_type;ip_1_address
PROD-WEB-01;NYC-DC1;Virtual Machine;prod;Active;prodweb01;corp;Host IP;10.0.1.10
PROD-DB-01;NYC-DC1;vm;prod;active;proddb01;corp;host;10.0.1.20
```

---

## Tips

- **Name consistently**: Include environment, role, and sequence in asset names for easy identification.
- **Use clusters**: Group related assets (e.g., web cluster, database cluster) to simplify management. Assign applications to member hosts, not to the cluster itself.
- **Track lifecycle**: Mark deprecated and retired assets to keep inventory counts accurate.
- **Link to locations**: Assign assets to locations so hosting type, country and city are populated automatically.
- **Assign to applications**: Use the **Hosted applications** section of the Operations tab to link assets to application deployments. The same assignments appear under the application's Deployments tab.
- **Use the Relations tab**: Connect assets to budget lines, contracts, and projects for financial visibility.
- **Link tasks here**: Add a task under Relations > Tasks. The link also shows in the task's activity.
- **Attach documentation**: Upload configuration files, architecture diagrams, or vendor docs directly to the Relations tab.
