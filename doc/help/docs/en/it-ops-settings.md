# IT landscape settings

The **IT landscape settings** page lets you customize the dropdown values used throughout IT Landscape. These lists control what options appear when users create or edit Applications, Interfaces, Assets, Connections, and Locations. Changes here apply to all users in your workspace.

For map readability, **Entities** and **Server roles** also include a **Graph tier** field used by the Connection Map's role-based placement.

## Where to find it

- Workspace: **IT Landscape**
- Path: **IT Landscape → Settings**, the last entry of the menu
- Permissions:
  - You need at least `settings:reader` to view the **Lists** tab.
  - You need `settings:admin` to change values.
  - You need `infrastructure:admin` to see the **Netbox** tab.

You only see the tabs your permissions allow. If you don't see the **Settings** entry in the IT Landscape drawer, ask your administrator to grant you the appropriate permissions. Other screens call this page the IT settings.

## How the page is organized

The page has two tabs:

- **Lists** holds the dropdown values described on this page.
- **Netbox** holds the synchronisation with your Netbox inventory. See [Netbox synchronisation](netbox.md).

On the **Lists** tab, the **Classifications and continuity** editor sits at the top. Below it, lists are grouped into four collapsible sections:

1. **Locations** - Lists used when creating or editing locations.
2. **Servers & connections** - Lists used for servers, connections, and related risk/endpoint data.
3. **Apps, services & interfaces** - Lists used across applications, app instances, interfaces, and bindings.
4. **Incidents** - Lists used by the incident register.

The lists of the technologies are in two sections: **Technology families** and **Administration zones** under **Servers & connections**, **Hosting types** under **Locations**.

Within a section, lists are sorted by name. Each list appears as an expandable panel with a short hint that says where its values are used (for example, *Applications / Category selector*). Click a panel header to expand it and see the values. Only one section loads its content when you first expand it, which keeps the page fast even when you have many lists.

### Editor controls

Each list has its own controls at the top:

- **Add item** - Inserts a new row at the top of the list, focused and ready to type. Its name field shows an example for that list.
- Edits save automatically about a second and a half after your last change, once every row is valid. A saving indicator shows next to the list.

For long lists (more than 25 rows), the table virtualizes rows, showing about 20 at a time with smooth scrolling and sticky headers.

### Names are the identity of a value

You only ever see and type **names**. KANAP generates a stable internal code from the name when a value is first saved and keeps it forever, so renaming a value never breaks the records that use it. The code is visible to integrators in the API and can be used in CSV files, but the CSV export writes names and the import accepts either.

Because names identify values, a few rules apply within a list:

- every value needs a name (an asterisk marks the **Name** column), and two values cannot have the same name (case does not matter);
- a name cannot be identical to the internal code of another value in the same list;
- names of **Access methods** cannot contain a comma or a semicolon, because the CSV export lists them in one comma-separated cell.

A list that breaks one of these rules is not saved until you fix it; the row shows what is wrong.

### Removing a value

**Remove** deletes a value that nothing uses. When records still reference the value, KANAP shows how many (applications, assets, interfaces, connections, sites, incidents, subnets…), with a link to the filtered list where a list can be filtered on that field, and offers **No longer offered** instead: the value stays visible on the records that already use it and is no longer proposed for new ones. A value in use is never removed, even through the API.

Built-in values that KANAP manages itself (the four lifecycle statuses, the Workgroup and N/A domains) cannot be edited or removed. Default network zones and asset types can be edited and retired but not removed: the server would add them back.

### Translating your values

The values you type are shown as is in every language. To show them in the language of each user, use the **Translate** action on a row: the dialog shows the base name (and description for classification levels) and one field per language. A field left empty uses the automatic translation when the value is still a KANAP default, otherwise the base text. Saving translations never changes the base text, and a translated name can be used in CSV files and the API like the name itself, which is why it must not duplicate another value of the list.

Editors always show and edit the base text; when the displayed name differs for your language, the row says so ("Shown: …").

---

## Locations

### Cloud providers

Cloud providers used by servers and locations (e.g., AWS, Azure, GCP).

**Columns**: Name, No longer offered

**Where used**:
- Assets workspace → Overview tab → **Provider** field
- Locations workspace → Overview tab → **Cloud provider** (when hosting type is cloud)

### Hosting types

Where locations and technologies are hosted. Defaults: On-prem, Colocation, Public cloud, Private cloud, SaaS.

**Columns**: Name, Category (**On-prem / colocation** or **Cloud / SaaS**), No longer offered

**Where used**:
- Locations workspace → Overview tab → **Hosting Type** field
- Technologies workspace → properties drawer → **Hosting type**, and the new technology window. See [Technologies](technologies.md#hosting-type).

A type a technology uses cannot be removed: mark it **No longer offered** instead.

The category determines which fields appear when editing a Location:
- **On-prem / colocation** shows Operating Company and Datacenter fields
- **Cloud / SaaS** shows Cloud Provider, Region, and Additional information fields

---

## Servers & connections

### Administration zones

The zones of your administration model. KANAP ships the three tiers of the tiered administration model, a recognized practice:

- **Tier 0 (core of trust)**: directories such as Active Directory or Entra ID, PKI, identity administration tools, and the systems that host them.
- **Tier 1 (servers and applications)**: business servers, applications, databases and middleware.
- **Tier 2 (workstations)**: user workstations and devices.

Rename them, add your own or retire them to match your administration policy or your privileged access model. The three tiers appear as long as the list has never been saved. Once it has been saved, even empty, KANAP no longer adds them: add them yourself if you need them.

The order of the list matters: the first zone is the most sensitive. Drag a row by its handle to move it. A new zone is added at the top, so move it to its place. The [Administration zones](administration-view.md) page shows the zones in this order and checks the assets against the first zone that is not marked **No longer offered**.

**Columns**: Name, Administrator group, Description, No longer offered

- **Administrator group**: the directory group or the team that administers the zone, for example "Domain admins".

**Where used**:
- Assets workspace → properties drawer → **Administration zone**
- Technologies workspace → properties drawer → **Administration zone**, for the technologies of the **Directory and identity** family
- **IT Landscape > Administration zones**, which counts the assets and directory services of each zone, runs the control points and assigns zones in bulk. See [Administration zones](administration-view.md).

A zone marked **No longer offered** stays on the technologies and assets already placed in it.

### Technology families

What kind of technology each one is: database, hypervisor, directory and identity, and so on. The technologies list and the reports group technologies by family, and the [Administration zones](administration-view.md) page finds the directory services through the **Directory and identity** family.

**Columns**: Name, No longer offered

**Where used**:
- Technologies workspace → header and properties drawer → **Family**, and the new technology window

The **Operating system** family marks the operating systems: a technology of that family added to a server without one becomes its operating system. See [Technologies](technologies.md#operating-systems).

### Connection types

A two-level catalog (category and entry) of connection protocols, with typical ports.

**Columns**: Category (e.g., Database, Remote Access), Name, Typical ports, No longer offered

**Where used**:
- Connections workspace → **Connection Type** selector

The **Typical ports** field is free text - you can enter single ports (`443`), lists (`80, 443`), ranges (`9101-9103`), or placeholders like `multiple` or `specify`.

Default categories include: Application, Authentication, Backup, Database, Email, File Sharing, File Transfer, Messaging, Monitoring, Network Services, Remote Access, Replication, Storage, VPN / Tunnel, Generic.

### Domains

Active Directory or DNS domains for assets. Built-in entries cannot be modified. The DNS suffix is used to compute the fully qualified domain name (FQDN) for each asset.

**Columns**: Name, DNS suffix, Forest, Number of accounts, Number of computers, Trusts, No longer offered

- **Forest**: the Active Directory forest of the domain, as shown in Active Directory Domains and Trusts.
- **Number of accounts** and **Number of computers**: the numbers of user accounts and computers in the domain, as counted in Active Directory Users and Computers or by a count of the user and computer objects of the domain. Whole numbers only.

Hover the **Forest**, **Number of accounts** and **Number of computers** headers to see where to find each value.
- **Trusts**: the button shows how many trusts the domain has. Click it to list the other domains it has a trust with, as shown in Active Directory Domains and Trusts. **Add a trusted domain** adds one; choose its **Direction**: **outgoing** (this domain trusts the other one, whose accounts can reach its resources), **incoming** (the other domain trusts this one) or **two-way** (both). The dialog also shows, read only, the trusts declared on other domains toward this one. The button appears once the domain is saved, and needs at least one other domain in the list.

**Where used**:
- Assets workspace → Technical tab → **Domain** selector
- Assets workspace → Technical tab → **FQDN** (auto-computed from hostname + DNS suffix)
- **IT Landscape > Administration zones**: domains grouped by forest, with their trusts, counts and domain controllers. See [Administration zones](administration-view.md#directory-services-and-domains).

**System entries** (cannot be modified or deleted):
- **Workgroup** - For standalone assets not joined to a domain
- **N/A** - For asset types where domain membership doesn't apply (e.g., network devices, racks)

**Auto-fill behavior**: When adding a new domain, the DNS suffix auto-fills from the name you enter until you edit it yourself.

**Example**: A domain named "Corporate AD" with DNS suffix `corp.example.com` would produce an FQDN of `hostname.corp.example.com` for an asset with hostname `web-server-01`.

### Entities

Endpoints used in connections and maps (e.g., Internal Users, Internet, Partner Networks, External Systems). The graph tier sets their default placement on the map.

**Columns**: Name, Graph tier, No longer offered

**Where used**:
- Connections workspace → **Source Entity** and **Target Entity** fields
- Connection Map → entities appear as flow endpoints and use their graph tier for vertical placement (default entities are Top)

### Graph tier values

The graph tier controls the preferred vertical band in Connection Map when **Role-based placement** is enabled:

- **Top**: Most user-facing or external endpoints
- **Upper**: Upper application/service layer
- **Center**: Neutral/default middle layer
- **Lower**: Supporting infrastructure
- **Bottom**: Data/storage-heavy endpoints

### IP address types

Types of IP addresses for assets. Useful for distinguishing between different network interfaces like host IPs, management interfaces, and storage networks.

**Columns**: Name, No longer offered

**Default values**: Host, IPMI, Management, iSCSI

**Where used**:
- Assets workspace → Technical tab → **IP Addresses** section → **Type** dropdown

Assets can have multiple IP addresses, each with its own type. For example, a physical server might have:
- A **Host** IP for application traffic
- An **IPMI** IP for out-of-band management
- An **iSCSI** IP for storage network connectivity

### Network zones

Network zones used to categorize subnets and describe connectivity (e.g., LAN, DMZ, Industrial LAN, WiFi, Public Cloud, Guest, Management, Storage, VPN).

**Columns**: Name, No longer offered

**Where used**:
- Subnets list → **Network Zone** selector
- Assets workspace → Technical tab → **Network Zone** (auto-populated when subnet is selected)

### Subnets

Define network subnets with CIDR notation and optional VLAN assignments. Each subnet belongs to a network zone and to a location.

**Columns**: Location, CIDR, VLAN (1-4094), Network zone, Description, No longer offered

**Where used**:
- Assets workspace → Technical tab → **Subnet** selector

**Validation rules**:
- CIDR must be valid IPv4 notation (e.g., `192.168.1.0/24`)
- VLAN numbers must be between 1 and 4094
- CIDR and VLAN numbers are unique per location (same values can exist at different locations)

**Auto-population**: When you select a subnet on an Asset, the Network Zone is automatically populated from the subnet's configuration.

### Server roles

Roles assigned to servers when linking app instances (e.g., Web server, Database server, Worker). The graph tier sets their placement on the connection map.

**Columns**: Name, Graph tier, No longer offered

**Where used**:
- Applications workspace → Servers tab → **Role** dropdown when linking an asset to an instance
- Connection Map → role-derived placement band for servers and clusters

Default built-in examples:
- `web`, `proxy` → **Top**
- `app`, `cloud-service` → **Upper**
- `db` → **Bottom**

### Asset types

Logical types for servers and infrastructure assets (e.g., Physical server, Virtual machine, Container, Serverless, Appliance). Physical assets can track hardware and support information.

**Columns**: Name, Physical, No longer offered

**Where used**:
- Assets workspace → Overview tab → **Type** field

---

## Apps, services & interfaces

### Access methods

Methods by which users access applications (e.g., Web, Mobile, VDI).

**Columns**: Name, No longer offered

**Default values**: Web, Locally installed application, Mobile application, Proprietary HMI (industrial interface), Terminal / CLI, VDI / Remote Desktop, Kiosk

**Where used**:
- Applications workspace → Technical & Support tab → **Access Methods** multi-select field

**Tip**: Customize access methods to match how your organization categorizes application access. For example, add "Citrix" or "Thin Client" if those are common access patterns in your environment.

### Application categories

Categories that describe the primary purpose of each application or service.

**Columns**: Name, No longer offered

**Default values**: Line-of-business, Productivity, Security, Analytics, Development, Integration, Infrastructure

**Where used**:
- Applications workspace → Overview tab → **Category** field
- Applications list → **Category** column and filter

**Tip**: Customize categories to match your organization's terminology. For example, rename "Line-of-business" to "Business Applications" if that's how your team refers to them.

### Classifications and continuity

This editor configures the levels used to classify applications, and technologies in their Compliance tab. It is available to `settings:admin` users at the top of the page and opens as a single dialog with one list per catalog:

- **Business criticality**: the levels an application can be assigned. Each level has a name, a description shown under the name when choosing a level, an optional **maximum tolerable downtime** in minutes, and a **No longer offered** flag. The downtime documents the level and triggers a warning on an application whose RTO reaches it; it is an attribute of the level, not a value entered on applications.
- **Cyber criticality**: independent consequence levels.
- **Data confidentiality**: the data classes catalog, with descriptions.
- **Recovery waves**: ordered restoration stages. The order does not represent severity or a time estimate.

**Order is the position in the list.** Severity catalogs are listed from the most critical level at the top to the least critical at the bottom; recovery waves in restoration order. Use the arrows to move a level; the position drives the sort order of lists, the "highest level" rule used by interfaces and connections, and the order of the pickers. **Add level** appends at the bottom.

**Changing the catalog never changes applications.** An application stores the code of its level. Renaming a level, editing its description or downtime, and reordering the catalog leave every application on the same level and do not invalidate reviews. A level still used by an application, interface or connection cannot be removed; mark it **No longer offered** instead: it stays visible on existing records and is no longer proposed for new ones.

Codes are generated from names and never shown; the naming rules above apply.

The business levels also power operational criticality on interfaces and connections. Missing derived inputs are marked incomplete; they are not treated as the lowest level.

#### Data confidentiality

The **Data confidentiality** list holds the data classes used by applications and interfaces. The built-in levels (Public, Internal, Confidential, Restricted) cannot be deleted or deprecated.

**Where used**:
- Applications workspace → Compliance tab → **Data Class** field
- Interfaces workspace → Overview tab → **Data Class** field
- Applications list → **Data Class** column

### Integration patterns

Integration patterns used by interface legs (e.g., REST API, File batch, Queue, DB staging).

**Columns**: Name, No longer offered

**Where used**:
- Interface legs → **Pattern** field

### Interface authentication modes

Authentication modes for interface legs and bindings (e.g., Service account, OAuth2, API key, Certificate).

**Columns**: Name, No longer offered

**Where used**:
- Interface bindings → **Auth Mode** field

### Interface data categories

Business data categories for interfaces (e.g., Master Data, Transactional, Reporting, Control).

**Columns**: Name, No longer offered

**Where used**:
- Interfaces workspace → **Data Category** field

### Interface data formats

Data formats for interface legs (e.g., CSV, JSON, XML, IDoc, Binary).

**Columns**: Name, No longer offered

**Where used**:
- Interface legs → **Format** field

### Interface protocols

Supported protocols for interface bindings between applications (e.g., HTTP/REST, gRPC, SFTP, Kafka, Database).

**Columns**: Name, No longer offered

**Where used**:
- Interface bindings → **Protocol** field (legacy bindings)

### Interface trigger types

Trigger types for interface legs (e.g., Event-based, Scheduled, Real-time, Manual).

**Columns**: Name, No longer offered

**Where used**:
- Interface legs → **Trigger** field

### Lifecycle statuses

Shared lifecycle options for applications, app instances, interfaces, interface bindings, and servers.

**Columns**: Name, No longer offered

**Locked codes**: The built-in statuses (Proposed, Active, Deprecated, Retired) cannot be deleted or have their codes changed.

**Where used**:
- Applications, App Instances, Interfaces, Interface Bindings, Assets → **Status** fields

---

## Incidents

### Incident categories

Categories used to classify entries in the incident register.

**Columns**: Name, No longer offered

**Where used**:
- Incidents → **Category** selector

---

## How changes affect existing data

- **Existing records keep their value** - Renaming only changes what users see, not the underlying data.
- **Values marked No longer offered**:
  - Remain valid for records that already use them.
  - Are hidden from dropdowns when creating new records.
  - Still appear during edits if the record already uses that value.
- **New values** become immediately available in the relevant dropdowns and are validated server-side.

This approach lets you evolve your taxonomy over time without breaking existing records.

---

## Quick reference: which list powers which field

| List | Where it's used |
|------|-----------------|
| **Access methods** | Applications (Technical & Support tab → Access Methods) |
| **Application categories** | Applications (Category) |
| **Administration zones** | Assets (properties drawer → Administration zone), Technologies of the Directory and identity family (properties drawer → Administration zone), Administration zones page |
| **Cloud providers** | Assets (Provider), Locations (Cloud provider) |
| **Connection types** | Connections (Connection Type) |
| **Domains** | Assets (Technical tab → Domain, FQDN), Administration zones page |
| **Entities** | Connections (Source/Target Entity), Connection Map (graph tier placement) |
| **Hosting types** | Locations (Overview), Technologies (Hosting type) |
| **Integration patterns** | Interface legs (Pattern) |
| **Interface authentication modes** | Interface bindings (Auth Mode) |
| **Interface data categories** | Interfaces (Data Category) |
| **Interface data formats** | Interface legs (Format) |
| **Interface protocols** | Interface bindings (Protocol) |
| **Interface trigger types** | Interface legs (Trigger) |
| **Incident categories** | Incidents (Category) |
| **IP address types** | Assets (Technical tab → IP Addresses → Type) |
| **Lifecycle statuses** | Applications, App Instances, Interfaces, Bindings, Assets |
| **Network zones** | Subnets (Network Zone), Assets (auto-populated from subnet) |
| **Subnets** | Assets (Technical tab → IP Addresses → Subnet selector) |
| **Server roles** | Applications → Servers tab (role when linking asset to app), Connection Map (graph tier placement) |
| **Asset types** | Assets (Overview → Type) |
| **Technology families** | Technologies (Family), Administration zones page (directory services) |

---

## Tips

- **Align names with your terminology** - Review the defaults and rename values to match how your organization talks about these concepts. Records keep their link to the value; only the name changes.
- **Retire gradually** - When transitioning away from a value, mark it **No longer offered** rather than removing it. This keeps historical data intact while steering users toward new options.
- **Coordinate data classes with security** - Changes to data classes should align with your information security policies. Discuss with compliance before adding or renaming classification levels.
- **Use typical ports as documentation** - The **Typical ports** field of connection types is informational. Fill it in to help users understand what ports each connection type commonly uses.
- **Tune map readability with tiers** - Keep the graph tiers of entities and server roles aligned with your architecture layers (edge, app, data) for clearer Connection Map layouts.
