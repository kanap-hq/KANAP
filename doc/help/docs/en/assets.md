# Assets

Assets document your infrastructure inventory -- physical servers, virtual machines, containers, cloud instances, and network devices. Link assets to locations, applications, connections, contracts, projects, and tasks to build a complete picture of your IT infrastructure.

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

## Working with the list

The asset list gives you a filterable, sortable overview of every asset in your inventory.

**Default columns**:

| Column | What it shows |
|--------|---------------|
| **#** | Asset reference (e.g., `AST-123`), monospaced |
| **Name** | Asset name (click to open workspace) |
| **Asset Type** | The asset's type (e.g., Virtual Machine, Physical Server) |
| **Cluster** | Cluster membership, or a "Cluster" badge if this asset is itself a cluster |
| **Environment** | Prod, Pre-prod, QA, Test, Dev, Sandbox -- with a coloured dot |
| **Location** | Where the asset is hosted |
| **Hosting** | Hosting type (derived from location) |
| **OS** | Operating system |
| **Network Zone** | Network segment (derived from subnet) |
| **Lifecycle** | Current lifecycle status |
| **Assignments** | Number of application assignments |
| **Created** | When the record was created |

**Default sort**: **Created** descending (newest first).

**Additional columns** (hidden by default, available via column chooser):
- **Sub-location**: Specific area within the location (building, room, rack)
- **Go-live**: Date the asset went into production
- **End-of-life**: Planned or actual retirement date

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

**Tip**: Combine filters across columns to narrow results. For example, filter by Environment = "Prod" and Lifecycle = "Active" to see only active production assets.

**Actions**:
- **Add asset**: Create a new asset (`infrastructure:member`)
- **Import CSV** / **Export CSV**: Bulk operations (`infrastructure:admin`)
- **Delete asset** (selected rows): Remove selected assets (`infrastructure:admin`)

---

## Clusters

Assets can be organized into clusters:

- **Regular asset**: An individual infrastructure instance
- **Cluster**: A group of assets acting as a single logical unit

When editing an asset, toggle **Cluster** in the Technical tab to mark it as a cluster. Cluster assets can be endpoints in connections, but application assignments must be made on the member hosts, not on the cluster itself.

Cluster members are managed from the **Technical** tab of the cluster's workspace via **Edit members**.

---

## The Assets workspace

Click any row to open the workspace. The workspace has a **header** with quick metadata, a **properties drawer** on the right (the asset's identity card -- always visible), and a **content area** in the centre that switches with each tab.

### Header

The header shows:
- **Asset name** (editable in place)
- **Asset reference** (e.g., `AST-123`): copyable identifier
- **Lifecycle** chip (also editable from the properties drawer)
- **Send link**: copy a shareable link to this workspace
- **Delete** (`infrastructure:admin`)
- **Previous / Next** (e.g., "3 of 47"): navigate the filtered list without returning to it

### Properties drawer (right panel)

The drawer shows the asset's identity card on every tab. Edits save automatically.

**Identification & location**:
- **Asset type** (required)
- **Location** (required)
- **Sub-location** (when the location has sub-locations defined)
- **Hosting type**, **Cloud provider / Operating company**, **Country**, **City** -- read-only, derived from the location

**Status**:
- **Environment**: Prod, Pre-prod, QA, Test, Dev, Sandbox
- **Lifecycle**: Active, Deprecated, Retired, etc. (configurable in Settings)
- **Go live**: When the asset entered production
- **End of life**: Planned or actual retirement date

---

### Overview

The Overview tab is the asset's home page.

**Description**: A rich-text description of the asset. Autosaves as you edit.

**Assignments** (not shown for cluster assets): Lists the applications running on this asset. Each row shows:

| Column | What it shows |
|--------|---------------|
| **Application** | Application name (clickable -- jumps to the application's Deployments) |
| **Environment** | The deployment environment the assignment belongs to |
| **Role** | Server role (Web, Database, Application, etc.) |
| **Since** | Date the server was assigned |
| **Notes** | Free-text notes |

Click **Add assignment** to attach this asset to an application deployment. Pick the application, then the environment (the application must already have a deployment in that environment), then the role and optional date / notes. Use the row icons to edit or remove.

If this asset is a cluster, an inline notice replaces the assignments table and asks you to assign member hosts instead.

**Connections**: A read-only view of all connections involving this asset. Each row shows the connection ID and name (clickable -- opens the Connection workspace), topology (Server to Server or Multi-server), protocols, source and destination endpoint labels, and lifecycle status. To create or edit a connection, navigate to **IT Landscape > Connections**.

**Knowledge**: Linked knowledge articles for this asset. With `knowledge:member` you can create new articles directly from this section.

---

### Technical

The Technical tab organizes cluster, network identity and IP configuration.

**Cluster management**:
- **Cluster** toggle: mark this asset as a cluster.
- If the asset **is a cluster**: a **Members** section lists the member assets (Name, Environment, Status, Operating system). Click **Edit members** to add or remove members through a search dialog.
- If the asset **is not a cluster**: a **Cluster membership** section shows the clusters this asset belongs to (if any).

**Identity**:
- **Hostname**: The asset's network hostname. Automatically pre-filled from the asset name on creation; you can override it at any time. Required when a domain is selected. It accepts letters, digits, hyphens and dots, with each part between dots limited to 63 characters, so a name such as `DL3.ROBOT-15MS.IE2000` is valid as it stands.
- **Domain**: The Active Directory or DNS domain the asset belongs to. Choose from domains configured in **IT Landscape > Settings**. System options include "Workgroup" (standalone) and "N/A" (not applicable).
- **FQDN**: Fully Qualified Domain Name, automatically computed from hostname and domain DNS suffix. Read-only.
- **Aliases**: Additional DNS names or aliases for this asset. Type and press Enter to add.
- **Operating system**: OS type and version (e.g., Windows Server 2022, Ubuntu 24.04 LTS). Disabled for clusters -- OS is defined per member. When selected, shows standard and extended support end dates underneath.

**IP addresses**:

Assets support multiple IP addresses, each with its own network configuration:

- Click **Add IP address** to add a new entry.
- **Type**: The purpose of the IP address (Host, IPMI, Management, iSCSI, or custom types from Settings)
- **IP address**: The address itself
- **Subnet**: Network subnet from the configured list (filtered to the asset's location)
- **Network zone**: Automatically derived from the selected subnet (read-only)
- **VLAN**: Automatically derived from the selected subnet (read-only)

This lets you document multiple network interfaces per asset -- for example, a physical server with both a host IP and an IPMI management address on different subnets.

---

### Hardware

*Only visible for physical asset types.*

Tracks physical hardware details. Saves automatically as you type.

- **Serial number**
- **Manufacturer**
- **Model**
- **Purchase date**
- **Rack location** (e.g., Row A, Rack 12)
- **Rack unit** (e.g., U1-U4)
- **Notes**

---

### Support

*Only visible for physical asset types.*

Tracks vendor support and contact information.

- **Vendor**: Select from the supplier directory
- **Support contract**: Link to a contract record
- **Support tier**: Free text (e.g., Gold, Silver, 24x7)
- **Support expiry**: Expiration date
- **Notes**

**Support contacts**: A table where you can add contacts from the contact directory, each with a free-text role label. The table displays each contact's email, phone, and mobile automatically.

---

### Relations

The Relations tab connects this asset to other records across KANAP. The tab badge counts all linked items. Most fields save automatically.

**Asset relations**:
- **Depends on**: Other assets this one depends on (e.g., a database server)
- **Contains**: Assets contained within this one (e.g., servers in a rack)
- **Contained by** / **Depended on by**: Read-only reverse views, shown only when other assets reference this one

**Financials & projects**:
- **Budget lines**: Link to OPEX and CAPEX lines, in one list. Search by title or reference (`BL-12`); each suggestion shows its type
- **Contracts**: Link to contract records
- **Projects**: Link to portfolio projects related to this asset

**Tasks**: Tasks linked to this asset. Read-only here -- tasks gain or lose this link when you set the **Asset** field on a task in the Tasks page.

**Relevant websites**: Add URLs with optional names -- useful for vendor portals, monitoring dashboards, or documentation links. **Add URL** opens a dialog; existing entries can be edited or deleted.

**Attachments**: Drag and drop files or click **Select files** to upload. Click an attachment chip to download it. Delete is available to managers.

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
| **Full Export** | All exportable fields -- use for reporting and complete data extraction |
| **Data Enrichment** | All importable fields -- matches the import template format, ideal for round-trip editing (export, modify, re-import) |
| **Custom Selection** | Choose specific fields to include in your export |

**Template download** (from Import dialog): Downloads a blank CSV with all importable field headers -- use this to prepare import files with the correct structure.

### Import workflow

1. **Prepare your file**: Use UTF-8 encoding with semicolon (`;`) separators. Download a template to ensure correct headers.

2. **Choose import settings**:
   - **Mode**:
     - `Enrich` (default): Empty cells preserve existing values -- only update what you specify
     - `Replace`: Empty cells clear existing values -- full replacement of all fields
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
| `is_cluster` | Is this a cluster | No | `true` or `false` |
| `hostname` | Network hostname | No | |
| `domain` | DNS domain | No | Accepts code or label from Settings |
| `aliases` | DNS aliases | No | Comma-separated list |
| `operating_system` | OS type | No | Accepts code or label from Settings |
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
| Operating System | `windows_2022`, `ubuntu_24` | `Windows Server 2022`, `Ubuntu 24.04 LTS` |
| Domain | `corp`, `dmz` | `Corporate Domain`, `DMZ` |
| IP Address Type | `host`, `ipmi`, `mgmt` | `Host IP`, `IPMI`, `Management` |

The system automatically normalizes values during import, so `Virtual Machine`, `virtual machine`, and `vm` all resolve to the same asset type. A value that matches several entries is refused rather than guessed. The CSV export writes names for these columns, so an exported file can be imported back as is.

### Matching and updates

Assets are matched by **name** (case-insensitive). When a match is found:
- With `Enrich` mode: Only non-empty CSV values update the asset
- With `Replace` mode: All fields are updated, empty values clear existing data

If you include the `id` column with a valid UUID, matching uses ID first, then falls back to name.

### Derived fields

Some fields are computed and cannot be imported:
- **Provider**: Automatically derived from the asset's location
- **FQDN**: Computed from hostname + domain

### Limitations

- **Maximum 4 IP addresses**: Assets support up to 4 IP address entries via CSV
- **Cluster assignment by name**: Use the cluster name, not ID, in the `cluster` column
- **Location required**: Every asset must have a valid location code
- **Relations not included**: Application assignments, connections, financial links, projects, tasks, and attachments must be managed in the workspace

### Troubleshooting

**"File isn't properly formatted" error**: This usually indicates an encoding issue. Ensure your CSV is saved as **UTF-8**:

- **In LibreOffice**: When opening a CSV, select `UTF-8` in the Character set dropdown (not "Japanese (Macintosh)" or other encodings). When saving, check "Edit filter settings" and choose UTF-8.
- **In Excel**: Save As > CSV UTF-8 (Comma delimited), then open in a text editor to change commas to semicolons.
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
- **Assign to applications**: Use the Overview tab to link assets to application deployments. The same assignments appear under the application's Deployments tab.
- **Use the Relations tab**: Connect assets to budget lines, contracts, and projects for financial visibility.
- **Tasks come from the Tasks page**: To attach a task to an asset, set the Asset field on the task itself; it will then appear under Relations > Tasks.
- **Attach documentation**: Upload configuration files, architecture diagrams, or vendor docs directly to the Relations tab.
