# Technologies

Technologies record what the IT department runs or subscribes to so that applications can work: SQL Server, vSphere, Active Directory, Entra ID, Tomcat. Each technology lists its versions and their end of support dates, so you know which ones need attention before they become a risk.

## What counts as a technology

KANAP describes your landscape in three boxes:

| Box | What it holds | Examples |
|---|---|---|
| **Applications** | What business users work in | ERP, CRM, payroll, intranet |
| **Technologies** | What the IT runs or subscribes to for those applications | SQL Server, vSphere, Active Directory, Entra ID, Tomcat |
| **Assets** | Where it runs | Servers, virtual machines, clusters, cloud databases |

A server carries technologies. An application is hosted on servers and depends on technologies.

Record an application for what you manage as a service, with its owners, criticality, contracts and costs. Record a technology for a product installed on your servers, followed through its versions, end of support dates and vulnerabilities. People rarely work in a technology itself, yet other applications fail or become exposed when it fails. One product can be both: see VMware vSphere below.

A few examples:

- **Entra ID**: a **SaaS** technology of the **Directory and identity** family, published by Microsoft. It runs on none of your servers. The applications that sign users in through it declare it.
- **Active Directory**: an **On-prem** technology of the same family, carried by your domain controllers. The applications that use it declare it.
- **VMware vSphere**: an **On-prem** technology installed on the vCenter server, while the hosts carry ESXi and the virtualization service is tracked as an application.
- **SQL Server**: one technology with one line per version in use (2016, 2019, 2022). Each server carries its own version, so the end of support report can name the servers still on an old one.
- **Windows Server**: a technology of the **Operating system** family. Each server records its version, and that technology is the server's operating system. See [Operating systems](#operating-systems).
- **A SaaS application**: no technology to record. The publisher maintains what it runs on.

One technology covers a product as a whole. "SQL Server" stands for every SQL Server you run; the versions carry the detail.

## Getting started

Navigate to **IT Landscape > Technologies** and click **New technology**.

The window opens on the **Catalog**: a list of common products with a short description, their publisher, family and hosting type. Search it by name, then click an entry. KANAP creates the technology at once with its publisher, family, hosting type, CPE product identifiers, CVE.org names, its versions with their end of support dates, and the short description in your language, then opens it. An entry stays offered when a technology of the same name was typed by hand. Adding it completes that technology, and the entry says so (Completes TEC-10).

A technology adopted from the catalog stays up to date: when the publisher releases a new version or changes a date, KANAP adds the version and moves the date (see [Versions from the catalog](#versions-from-the-catalog)).

For a product the catalog does not know, click **Enter a technology missing from the catalog**. Fill in:

- **Name** (required): unique among your technologies.
- **Family**: what kind of technology it is (database, hypervisor, directory and identity, and so on).
- **Publisher**: suggestions come from your other technologies and from the catalog, so the same publisher keeps one spelling.
- **Hosting type**: where the technology runs. **On-prem** by default. See [Hosting type](#hosting-type).

**Permissions**:

- View: `infrastructure:reader`
- Create and edit: `infrastructure:member`
- Delete: `infrastructure:admin`

## Operating systems

The operating system of a server is a technology of the **Operating system** family. Add it to the server like any other technology, with its version: when the server has none yet, it becomes the server's operating system. The server page shows it first in its **Technologies** section, marked "Operating system". See [Assets](assets.md#operating-system).

The catalog offers Windows Server, Ubuntu, Red Hat Enterprise Linux, Debian, SUSE Linux Enterprise Server, Rocky Linux, AlmaLinux, Oracle Linux, Amazon Linux, Alpine Linux, CentOS, IBM AIX, IBM i and Oracle Solaris. It lists the versions whose support ended in 2010 or later, and for Windows Server the long-term releases only.

What the two support dates mean depends on the publisher:

| Operating system | End of standard support | End of extended support |
|---|---|---|
| **Ubuntu**, **Red Hat Enterprise Linux**, **SUSE Linux Enterprise Server** | End of security updates | End of the paid extension |
| **Windows Server** | End of mainstream support | End of extended support |
| **Debian** | End of regular support | End of Debian LTS |

Any technology can be an operating system: put VMware ESXi or FortiOS in the **Operating system** family and it can be the operating system of a host or a firewall.

The catalog's operating systems come with CPE product identifiers, and KANAP matches them with published vulnerabilities.

Linux distributions publish their vulnerabilities per package. KANAP tracks the support of each version and matches the vulnerabilities that the publisher assigns to the version. It does not know which packages a server has installed, or at which level. For the Linux distributions of the catalog, the versions table links to the distributor's security tracker, where you can check each package. See [Versions from the catalog](#versions-from-the-catalog).

Operating systems are excluded from vulnerability alerts by default. KANAP does not know the patch level of a server, so an operating system would raise a very large number of vulnerabilities, most of them already patched. This applies to a technology of the **Operating system** family and to an operating system adopted from the catalog, whatever its family. An existing technology that you adopt from the catalog as an operating system becomes excluded too. You can include it again: see [Vulnerability alerts](#vulnerability-alerts).

Installations upgraded from an earlier version keep their data: the operating systems the servers used, and the entries added to the former operating systems list of the settings, became technologies with their versions and dates.

---

## Working with the list

Each row is one technology. Click a row to open it.

**Default columns**:

| Column | What it shows |
|---|---|
| **Reference** | The technology's reference (`TEC-4`) |
| **Name** | The technology's name |
| **Family** | Kind of technology |
| **Publisher** | Who publishes it |
| **Servers** | Assets in service it is installed on. Clusters are not counted, nor the virtual machines of a host that carries it. The **Servers** badge of the record and the [End of support](end-of-support.md) report give the same number |
| **Applications** | Applications that declare it or are hosted on a server that carries it |
| **Next end of support** | The earliest end of standard support to come among the versions in use. Shown in orange when it falls within the next 12 months |
| **Vulnerabilities to review** | The known vulnerabilities still to review on the versions in use that are in the alerts. Shown in orange with the count of critical or high ones (`3 · 1 critical or high`). Click it to open the [Vulnerabilities](vulnerabilities.md) page on this technology. Present when vulnerabilities are followed |

**Additional columns** (through the column chooser): **Lifecycle**, **Versions in use**, **IT owner**.

When vulnerabilities are followed, the **Publisher** column also opens the Vulnerabilities page on that publisher's products. See [Vulnerabilities](vulnerabilities.md) for when they are followed.

**Filtering**: **Family**, **Publisher** and **Lifecycle** offer checkbox filters. The search box matches the name, the publisher and the reference.

**Actions**:

- **New technology** (`infrastructure:member`).
- **Import links** (`infrastructure:member`) and **Export links**: load or download the links between technologies and servers or applications as a CSV file or an Excel workbook. See [Import and export links](#import-and-export-links).
- **Delete** the selected rows (`infrastructure:admin`). The confirmation counts what goes with them: links to servers and applications, contracts, budget lines, projects, incidents and documents.

---

## The technology workspace

The workspace has a header, a properties drawer on the right, and seven tabs: **Overview**, **Servers**, **Applications**, **Operations**, **Compliance**, **Relations** and **History** (the changes made to the technology, see [Record history](record-history.md)). The **Servers**, **Applications** and **Relations** tabs show a badge with their count.

### Header

- **Name**: editable in place.
- **Reference**: click to copy it.
- **Lifecycle**: click to change it. A retired technology is no longer offered when you search for one to link.
- **Family**.
- **Delete**, a trash icon (`infrastructure:admin`): the confirmation names what goes with the technology.

### Properties drawer

- **Publisher**, **Family** and **Hosting type**.
- **Administration zone**: shown for the technologies of the **Directory and identity** family only. It places a directory service in a zone of your administration model, for example Tier 0 for Entra ID, which runs on no server of yours. The zones come from **IT Landscape > Settings**, and the [Administration zones](administration-view.md) page lists the directory services with their zone. The other technologies take no zone: place the servers that carry them instead. A zone set earlier on a technology of another family stays shown, read only, with a note that the value is no longer used.
- **Replaced by**: the technology that takes over from this one, for example a newer product your teams are moving to.
- **IT owners**: the people responsible for the technology.

Changes save as you make them.

#### Hosting type

The hosting type says where the technology runs. The list is the **Hosting types** list of **IT Landscape > Settings**, shared with the locations: **On-prem**, **Colocation**, **Public cloud**, **Private cloud** and **SaaS** by default. Each type is either on premises or in the cloud:

- **On premises** (On-prem, Colocation): the technology is expected on your servers. One that runs on no server shows in the **Missing data** of the [End of support](end-of-support.md#missing-data) report.
- **In the cloud** (Public cloud, Private cloud, SaaS): the provider runs it, for example Entra ID or a managed Kubernetes service. Declare it on the applications that use it.

A type marked **No longer offered** stays on the technologies that have it. A type removed from the settings, or a list left without any type in use, shows the technology in the **Missing data** too.

### Overview

**Description**: what the technology is used for.

**Versions**: one line per version you track, with **End of standard support**, **End of extended support** and a **Status**:

| Status | Meaning |
|---|---|
| **Supported** | Standard support ends more than 12 months from today |
| **Ending soon** | Standard support ends within 12 months |
| **Extended support** | Standard support has ended; extended support still runs |
| **Out of support** | Every end date has passed |
| **Date unknown** | No end date recorded |

Support still runs on its end date. With a single date, that date is the end. **Add version** adds a line; hover a line to edit or delete it. Deleting a version used by servers or applications asks first, with the number of servers it is installed on and of applications: those links then show an unknown version.

**Notes**: at the bottom of the tab, free text such as licensing terms or renewal dates.

#### Vulnerability alerts

When vulnerabilities are followed, the versions table chooses which versions count in the vulnerability alerts. A version in the alerts appears on the [Vulnerabilities](vulnerabilities.md) page by default, in the emails and in the counts. A version out of the alerts is still matched with the vulnerabilities: the technology's [Vulnerabilities](#vulnerabilities) section still shows it, and the page shows its rows with its **Alerts** filter.

- **Include in vulnerability alerts**: the switch in the title line of **Versions**, next to **Add version**. It is the setting of the technology. Hover it for a reminder: it applies to the versions without their own setting, to the versions added later, and to the servers and applications that name no version. Changing it replaces the own settings of the versions; when some versions have one, KANAP asks first and says how many. It shows even when the technology has no version.
- **Alerts** column: a switch per version, for an exception on one version. Hover the information icon of its header for what it does. A small dot next to the switch marks a version with its own setting. Set the switch back to the value of the technology and the version follows the technology again.

New technologies are in the alerts, with two exceptions:

- **Operating systems**: see [Operating systems](#operating-systems).
- **Cloud services run by a provider**: a technology whose [hosting type](#hosting-type) is in the cloud, such as **Public cloud** or **SaaS**, and a catalog entry the provider runs, such as Entra ID. The provider patches an online service, so its vulnerabilities call for no action on your side. A technology in a **Private cloud** stays in the alerts.

Changing the family or the hosting type of a technology later leaves its setting as it is. The switches need `infrastructure:member`.

#### Versions from the catalog

A version that comes from the catalog shows **Catalog** next to its label, and a technology adopted from the catalog says "Versions and dates kept up to date from the catalog" under its versions. KANAP checks the catalog every day in the cloud. On an on-premise installation, each KANAP version brings its catalog at start, unless your administrator [turns on the daily check](on-premise/configuration.md#optional-technology-catalog).

The dates come from two sources. Most products take them from endoflife.date. For the products endoflife.date does not cover, such as Cisco NX-OS, Juniper Junos or Dell PowerStore, KANAP reads the dates on the publisher's official pages. Each KANAP version brings these dates up to date.

A version whose dates KANAP read shows their source under its label: "Source:", the publisher, and the day the dates were verified. The publisher's name links to the page the dates come from. The line stays while both end dates match the catalog. It goes away once you change one of them. When the publisher plans no end of support, as for IBM WebSphere 8.5 and 9.0, both end of support columns say "No end planned by the vendor".

Some products have no public dates: HPE Aruba Networking AOS-CX, Pure Storage Purity//FA, HPE Alletra 5000/6000 (NimbleOS), Rubrik CDM, Cohesity DataProtect and PRTG Network Monitor. The catalog brings them without versions. Add your versions and their dates yourself.

A Linux distribution from the catalog shows a line under the table: "This distributor publishes vulnerabilities per package". The line links to the distributor's security tracker, for example the Debian security tracker or Red Hat security updates. There you can see which packages a vulnerability affects and which updates fix it. See [Operating systems](#operating-systems).

The check adds the new versions, CPE product identifiers and CVE.org names of the product, and updates the end of support dates, identifiers and names the catalog changed. It never overwrites a value you changed, and never brings back a version, an identifier or a name you deleted. A version you typed before the catalog knew it is attached to the catalog when the labels match, and its empty dates are filled.

#### Vulnerability identifiers

The **Vulnerability identifiers** group, under the versions, holds the CPE product identifiers and the CVE.org names. KANAP finds the vulnerabilities of a technology through them.

- **Folded**: when the technology has at least one identifier, the group is folded, with a summary on its title line, for example `2 CPE identifiers · 3 CVE.org names`. Click the title to open it.
- **Open**: when the technology has none, the group is open, with a warning: no vulnerability is looked up for this technology. The **Versions** section says so too. With `infrastructure:member`, **Add an identifier** next to that line opens the group.

The match is made at the level of the technology. Every version of the technology is compared with the vulnerabilities of its identifiers, and a version you add is matched at once. Without an identifier, KANAP looks up no vulnerability for any version.

**CPE product identifiers**: the names security databases use for this product, in the form `part:vendor:product` (for example `a:microsoft:sql_server`). KANAP matches them with the published vulnerabilities. A product can have several (vSphere covers vCenter and ESXi). Where to find this value: search the product in the [NIST CPE dictionary](https://nvd.nist.gov/products/cpe/search) and keep its part, vendor and product. Copy them as the NVD writes them, with the backslash before a sign: `a:veeam:veeam_backup_\&_replication`. Most catalog entries come with their identifiers, operating systems included.

**CVE.org names**: the publisher and product names as the publisher writes them in its own vulnerability records, for example publisher `SAP_SE` and product `SAP HANA Database`. KANAP matches them with the CVE.org list, which also holds the vulnerabilities the NVD has not analysed (see [Vulnerabilities](vulnerabilities.md#how-kanap-finds-them)). The names sit under the CPE product identifiers and show when KANAP reads the CVE.org list. Each name is listed on its own.

- **Adding a name**: type part of the product name in the search. The list offers the exact names publishers write on their records, each with its number of vulnerabilities and the date of the latest one. Pick one, with an optional version. A name missing from the list cannot be typed in.
- **Suggestions**: the names seen on the vulnerabilities of your CPE identifiers. Each one shows its number of vulnerabilities and the share of those vulnerabilities that carry it.
- **Exact names**: the comparison ignores case and punctuation, and otherwise needs the exact name. A close name does not match, so declare each variant of a product on its own. For example, `Microsoft SQL Server 2008` matches nothing: the records write `Microsoft SQL Server 2008 Service Pack 4 (QFE)`. Pick that name, with the version `2008`.
- **Version**: a version limits the name to the versions of the technology whose label starts with it, for example `2019` for `Windows Server 2019`. When a label starts with several of them, only the longest counts: `2012 R2` gets the name of `2012 R2` and leaves the one of `2012`.
- **From the catalog**: many catalog entries come with their names (Microsoft, Apache, databases and others). The catalog check keeps them up to date like the CPE identifiers, and a name you removed does not come back.

Where to find this value: on [cve.org](https://www.cve.org), open the record of a vulnerability of the product. The name must be the one in its **Product status** section. Changing the names needs `infrastructure:member`, as for the CPE identifiers.

### Servers

The servers that carry the technology, one row per server and version:

| Column | What it shows |
|---|---|
| **Ref**, **Server** | The server. A cluster shows an icon before its name. Click the row to open it |
| **Environment**, **Operating system** | Taken from the server |
| **Version** | The version installed. A dash means the version is unknown |
| **Via** | For a server that carries the technology through another one: the assets it is installed on. The column shows only when the tab has such a row |
| **Notes** | Free text about this installation, for example "cluster node" |

A technology reaches a server in two ways:

- **Installed**: someone linked the technology to this server. You can change the version and the notes in place, or remove the row.
- **Through another server**: for a cluster, the technology is installed on its members. For example, SQL Server installed on the nodes of a cluster shows on the cluster in one row per version, with the nodes that carry it under **Via**. It follows the installation: change or remove it on those servers.

The servers that run inside a host carrying the technology, such as the virtual machines of an ESXi host, sit under a closed line at the end of the table, **Hosted assets (n)**. Click it to show them, with their host under **Via**.

**Add** (`infrastructure:member`) opens a search for a server, then the version picker: choose a version, **Version unknown**, or type a new label and pick **Add version "…"** to create it. Each change saves at once.

A retired server stays listed, greyed out and marked "retired", so you can remove its link. It counts nowhere: not in the badge, the total, the list counters or the reports. The badge and the **Total** row count the servers in service the technology is installed on, each once. A cluster and a hosted asset are listed and not counted.

### Applications

The applications that use the technology, one row per application, environment, server and version. You need to read applications to see this tab; without that right, a single line says so. A Business Contributor sees only their own applications.

| Column | What it shows |
|---|---|
| **Ref**, **Application** | The application. Click the row to open it |
| **Environment** | The environment of the deployment |
| **Criticality** | The application's business criticality |
| **External** | "Yes" when the application is exposed outside |
| **Server** | The server that carries the technology for this deployment, with its host when it runs inside another server. **Declared** for a row added by hand |
| **Version** | The version used. A dash means the version is unknown |
| **IT owner** | The application's IT owners |

An application appears in two ways:

- **Hosted**: one of its deployments runs on a server that carries the technology. KANAP deduces the row from the servers; change the server or the deployment to change it.
- **Declared**: the application depends on the technology without running next to it, for example an application that signs users in through Entra ID. Change the version in place, or remove the declaration. Removing it withdraws every declared version of that application.

**Add** (`infrastructure:member`) opens a search where you can tick several applications, then add them in one go. They are declared with an unknown version: set it afterwards on each row. Disabled applications and deployments do not count.

**Export** downloads the rows as a CSV or Excel file, in the language of your screen.

### Operations

Who to call and how to get help:

- **Support**: the support contacts, with their **Email**, **Phone** and **Role**. **Add contact** opens a short form: choose the **Contact** (required) and give an optional **Role**. A contact is listed once; adding it again keeps its role. Remove a contact with the cross at the end of its row.
- **Support notes**: free text, such as the support contract number, the hotline hours or the escalation path. It saves when you leave the field.

The technology then appears in the **Used by** section of each contact's page.

### Compliance

The same classification as applications, for the technologies that matter to your continuity plans:

- **Criticality**: **Cyber criticality**.
- **Continuity and recovery**: **Recovery wave**, **Recovery time objective (RTO)** and **Recovery point objective (RPO)**.

The levels and waves come from **Classifications and continuity** in [IT Landscape Settings](it-ops-settings.md#classifications-and-continuity). Hover the question mark next to a field for its meaning.

Below them, when vulnerabilities are followed, the **Vulnerabilities** section sums up the known vulnerabilities of each version. See [Vulnerabilities](#vulnerabilities).

#### Vulnerabilities

A summary of the vulnerabilities, one line per installed version of the technology, in the order of the versions table. The count next to the title is the number of distinct vulnerabilities, every state.

| Column | What it shows |
|---|---|
| **Version** | The version. A version out of the alerts is greyed and says **Excluded from alerts**. **Version not recorded (potentially concerned)** groups the servers and applications that name no version; this line shows only when there are some |
| **Servers** | How many servers in service have this version recorded on themselves. Clusters and the servers that run inside another one are not counted. See [What KANAP counts](vulnerabilities.md#what-kanap-counts) |
| **Critical**, **High**, **Medium**, **Low**, **Not rated** | One column per severity: the vulnerabilities still to review. A vulnerability rated **None** counts with **Low**. A dot stands for none left. Hover a header for a reminder |
| **Total** | The distinct vulnerabilities of this version, every state |

**See** opens the [Vulnerabilities](vulnerabilities.md) page filtered on the version: on its vulnerabilities to review when it has some, on every state otherwise. **See everything on the Vulnerabilities page**, under the table, opens the page on the whole technology, every state.

The versions that no server and no application uses get no line. They are named together under the table, for example "Not installed: 2016, 2017". KANAP only looks for vulnerabilities of versions installed on a server or declared by an application.

When the technology or some of its versions are out of the alerts, a line at the top of the section says so: **Excluded from alerts**, **Excluded from alerts, except 2 versions** or **3 versions excluded from alerts**. With `infrastructure:member`, **Change** next to it opens the versions table of the Overview tab, where the switches are. See [Vulnerability alerts](#vulnerability-alerts).

KANAP matches the technology again as soon as its identifiers, CVE.org names, versions, servers or applications change. After a new CPE product identifier, the section says "Searching for vulnerabilities…" while KANAP reads that product from the NVD. When that read cannot be completed, the section says so. **Refresh** (`infrastructure:member`) runs the comparison by hand.

### Relations

The records linked to the technology, one section per kind:

- **Budget lines**: with the amount of the current year in the budget column of your workspace, and a total. A line whose currency has no exchange rate for the year shows its amount in its own currency with a small orange mark, and the total leaves it out. A one-line warning under the table names it. See [Manual rates](currencies.md#manual-rates).
- **Contracts**: supplier, end date and yearly amount, with a total per currency.
- **Projects**: status and planned end.
- **Incidents**: severity, status and detection date. Linking an incident needs `incidents:contributor`. A closed or cancelled incident cannot be linked or unlinked.
- **Links and files**: the web links of the technology and its files, one row each with its name, the domain of the link or the size of the file, and the date it was added. Click a link to open it in a new tab, or a file to download it. With `infrastructure:member`, **Add link** and **Attach file** add a row, and files can also be dropped on the section. Hover a row to edit a link or to remove a row. Removing a link shows a message and offers **Undo**, which creates the link again. Deleting a file asks for confirmation. An address typed without `http://` or `https://` gets `https://`. Any other scheme is refused.

A section appears only if you can read its module. **Add** (`infrastructure:member`) opens a search in place; the cross at the end of a row removes the link.

---

## Linking a technology to a server

You can record that a server carries a technology from either side:

- From the technology: **Servers** tab, **Add**, then choose the server and the version.
- From the server: **Operations** tab of the asset, **Technologies** section, **Add**, then choose the technology and the version. See [Assets](assets.md#operations).

Record the technology on the server where it is installed: the host for a hypervisor, each domain controller for Active Directory, the database server for SQL Server. The servers that run inside it, and the cluster of those servers, then show it without further work. A cloud technology, such as Entra ID, runs on none of your servers: declare it on the applications instead.

---

## Import and export links

The technologies list loads and downloads links in bulk, one link per row of a CSV file or an Excel workbook. Two files exist:

- **Servers and technologies**: the technologies installed on each server.
- **Applications and technologies**: the technologies each application declares. Applications hosted on a server that carries a technology are deduced from the servers, so the file leaves them out.

Click **Import links** or **Export links** in the toolbar, then pick the file. The export offers the data, in CSV or Excel, or an empty CSV template. The general rules of import files apply: encoding, separator, yes and no in four languages, at most 20,000 rows. See [CSV and Excel files](csv-files.md).

**Permissions**:

- Export the servers file: `infrastructure:reader`.
- Import the servers file: `infrastructure:member`.
- The applications file also needs the right to read applications. A Business Contributor exports and imports links of their own applications only.

### Columns

| Column | Meaning |
|---|---|
| `asset_reference`, `asset_name` | The server (servers file). The reference (`AST-12`) is read first. Without it, the name finds the server, and a name shared by two servers is an error. A reference and a name that point to two different servers are an error too |
| `application_reference`, `application_name` | The application (applications file), by its reference (`APP-4`) first, then by its name |
| `technology_reference`, `technology_name` | The technology, by its reference (`TEC-3`) first, then by its name |
| `version` | The version label. An empty cell means the version is unknown |
| `operating_system` | Servers file only. Whether the technology is the server's operating system: see below |
| `notes` | Free text about the link |
| `source` | Where the link comes from: manual entry, import, assistant, agent or Netbox. The export writes it; the import ignores it |

The `operating_system` column takes three values:

- **yes**: the link becomes the server's operating system. The import refuses the row when the technology is not of the **Operating system** family, when the server is a cluster that has members, or when the server already has another operating system.
- **no**: the link is never marked.
- **Empty**: a new link follows the rule of the server page. A technology of the **Operating system** family becomes the server's operating system when the server has none yet and is not a cluster. The preview says so on the row.

The import never removes the operating system mark from a link.

### What an import does

**Preflight check** reads the file and lists what the load would do, with any error by row. A file with one error loads nothing.

- A link is a server or an application, a technology and a version: a row with another version adds a second link. The same link twice in one file is an error.
- Each row adds a link or updates an existing one. Links missing from the file stay as they are: the import never deletes a link.
- An existing link keeps where it comes from. Its notes change when the `notes` cell holds a different text, and an empty cell leaves them as they are.
- A new link is marked as coming from an import, with the file name.
- The technology must already be in your list. Adopt it from the catalog or create it first.
- A version you do not track yet is created on the technology. The preview names it.

A large file takes some time to load, and holds the links of its technologies until it finishes. Several smaller files are easier on the people working at the same time.

---

## Where technologies appear

- **Applications**: the **Technologies** section at the top of the Operations tab lists what an application depends on. See [Applications](applications.md#operations).
- **Assets**: the **Technologies** section of an asset's Operations tab lists what the server carries, its operating system first. See [Assets](assets.md#operations).
- **Contracts**, **budget lines** and **incidents**: a **Technologies** field in their Relations tab, for users who can read the infrastructure.
- **End of support** report: the versions that reach their end of support, operating systems included, and what they touch. See [End of support](end-of-support.md).
- **Vulnerabilities**: the known vulnerabilities of the versions in use, and the servers and applications they reach. See [Vulnerabilities](vulnerabilities.md).
- **Administration zones**: the directory services with their zone, and the servers that carry a directory technology outside the most sensitive zone. See [Administration zones](administration-view.md).
- **Contacts**: the **Used by** section of a contact lists the technologies it supports. See [Contacts](contacts.md#where-contacts-are-used).
- **Search**: the global search and the assistant's `@` mentions find technologies by name and by reference (`@TEC-4`).

## Converting an application

A record created as an application may really be a technology, for example a database engine or a directory. Open the application and use **Convert to technology**. See [Applications](applications.md#converting-an-application-to-a-technology).

## Ask the assistant

[Plaid](ai-assistant.md) reads the technologies with the same rights as this page. Ask, for example: "Who is responsible for TEC-3?", "Which web links does PostgreSQL have?", "Are vulnerability alerts on for TEC-3?" or "Which technologies are out of support?"

With the Member level on infrastructure, Plaid also writes, and every change comes as a preview that you approve:

- Adopt a catalog entry, complete a technology of the same name typed by hand, or create a technology the catalog does not know.
- Change the fields of the technology.
- Add versions and change their labels, dates and notes.
- Add or remove IT owners, business owners and support contacts.
- Add, change or remove web links.
- Turn vulnerability alerts on or off, for the technology or one version.

Plaid names the family, lifecycle and other list values in your language, and refuses a value that matches more than one. It refuses a name shared by two users or two contacts, and two links with the same address. Ask, for example: "Adopt PostgreSQL from the KANAP catalog", "Add version 17 to TEC-3", "Add Camille Roux as business owner of PostgreSQL", "Add the contact Oracle Support to the support of TEC-3", "Add the release notes link https://www.postgresql.org/docs/release/ to PostgreSQL" or "Exclude version 14 of TEC-3 from the alerts".

Adding a support contact also needs the right to read contacts. Removing one does not. Plaid adds only active users as owners, and removes an owner even when the account is disabled. A contact without a name cannot be added: give it a name in Contacts first. When Plaid completes a technology typed by hand, it changes only the fields that differ, and stops if one of them changed on the screen after the preview.

Deleting a technology or a version, attachments, CPE identifiers and CVE.org names, and the matching of vulnerabilities stay on this page.

## Tips

- **Start from the catalog**: you get the versions and their end of support dates without typing them.
- **Track major versions**: one line per major version (2019, 2022) is enough to follow support.
- **Name the owners**: the IT owners are the people to call when a version reaches its end of support. They also receive the email about new critical vulnerabilities.
- **Fill in the CPE product identifiers and the CVE.org names**: without either, KANAP cannot match the technology with the published vulnerabilities.
- **Record the version on each server**: an unknown version is potentially concerned by every vulnerability of the product.
