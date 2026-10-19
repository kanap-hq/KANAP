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

Create a technology when people do not work in the product itself, yet other applications fail or become exposed when it fails. Keep a record as an application when business users log in to it and use it for their work.

A few examples:

- **Entra ID**: a **SaaS** technology of the **Directory and identity** family, published by Microsoft. It runs on none of your servers. The applications that sign users in through it declare it.
- **Active Directory**: an **On-prem** technology of the same family, carried by your domain controllers. The applications that use it declare it.
- **vSphere**: an **On-prem** technology carried by the vCenter virtual machine and by the hosts.
- **SQL Server**: one technology with one line per version in use (2016, 2019, 2022). Each server carries its own version, so the end of support report can name the servers still on an old one.
- **Windows Server**: a technology of the **Operating system** family. Each server records its version, and that technology is the server's operating system. See [Operating systems](#operating-systems).
- **A SaaS application**: no technology to record. The publisher maintains what it runs on.

One technology covers a product as a whole. "SQL Server" stands for every SQL Server you run; the versions carry the detail.

## Getting started

Navigate to **IT Landscape > Technologies** and click **New technology**.

The window opens on the **Catalog**: a list of common products with a short description, their publisher, family and hosting type. Search it by name, then click an entry. KANAP creates the technology at once with its publisher, family, hosting type, CPE product identifiers, its versions with their end of support dates, and the short description in your language, then opens it. The catalog only offers products you have not added yet.

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

The catalog offers Windows Server, Ubuntu, Red Hat Enterprise Linux, Debian, SUSE Linux Enterprise Server, Rocky Linux, AlmaLinux, Oracle Linux and CentOS. It lists the versions whose support ended in 2010 or later, and for Windows Server the long-term releases only.

What the two support dates mean depends on the publisher:

| Operating system | End of standard support | End of extended support |
|---|---|---|
| **Ubuntu**, **Red Hat Enterprise Linux**, **SUSE Linux Enterprise Server** | End of security updates | End of the paid extension |
| **Windows Server** | End of mainstream support | End of extended support |
| **Debian** | End of regular support | End of Debian LTS |

Any technology can be an operating system: put VMware ESXi or FortiOS in the **Operating system** family and it can be the operating system of a host or a firewall.

The catalog's operating systems have no CPE product identifiers yet, so KANAP does not match them with vulnerabilities.

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
| **Servers** | Assets that carry it, directly or because they sit inside an asset that carries it |
| **Applications** | Applications that declare it or are hosted on a server that carries it |
| **Next end of support** | The earliest end of standard support to come among the versions in use. Shown in orange when it falls within the next 12 months |
| **Vulnerabilities to review** | The known vulnerabilities still to review on the versions in use. Shown in orange with the count of critical or high ones (`3 · 1 critical or high`). Click it to open the [Vulnerabilities](vulnerabilities.md) page on this technology. Present when vulnerabilities are followed |

**Additional columns** (through the column chooser): **Lifecycle**, **Versions in use**, **IT owner**.

When vulnerabilities are followed, the **Publisher** column also opens the Vulnerabilities page on that publisher's products. See [Vulnerabilities](vulnerabilities.md) for when they are followed.

**Filtering**: **Family**, **Publisher** and **Lifecycle** offer checkbox filters. The search box matches the name, the publisher and the reference.

**Actions**:

- **New technology** (`infrastructure:member`).
- **Delete** the selected rows (`infrastructure:admin`). The confirmation counts what goes with them: links to servers and applications, contracts, budget lines, projects, incidents and documents.

---

## The technology workspace

The workspace has a header, a properties drawer on the right, and six tabs: **Overview**, **Servers**, **Applications**, **Operations**, **Compliance** and **Relations**. The **Servers**, **Applications** and **Relations** tabs show a badge with their count.

### Header

- **Name**: editable in place.
- **Reference**: click to copy it.
- **Lifecycle**: click to change it. A retired technology is no longer offered when you search for one to link.
- **Family**.
- **Delete** (`infrastructure:admin`): the confirmation names what goes with the technology.

### Properties drawer

- **Publisher**, **Family** and **Hosting type**.
- **Administration zone**: the zone of your administration model the technology belongs to, for example Tier 0 for the directory. The zones come from **IT Landscape > Settings**. A technology without a zone is listed as data to complete in the [Administration view](administration-view.md).
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

Support still runs on its end date. With a single date, that date is the end. **Add version** adds a line; hover a line to edit or delete it. Deleting a version used by servers or applications asks first: those links then show an unknown version.

#### Versions from the catalog

A version that comes from the catalog shows **Catalog** next to its label, and a technology adopted from the catalog says "Versions and dates kept up to date from the catalog" under its versions. KANAP checks the catalog every day in the cloud. On an on-premise installation, each KANAP version brings its catalog at start, unless your administrator [turns on the daily check](on-premise/configuration.md#optional-technology-catalog).

The check adds the new versions and CPE product identifiers of the product, and updates the end of support dates and identifiers the catalog changed. It never overwrites a value you changed, and never brings back a version or an identifier you deleted. A version you typed before the catalog knew it is attached to the catalog when the labels match, and its empty dates are filled.

**CPE product identifiers**: the names security databases use for this product, in the form `part:vendor:product` (for example `a:microsoft:sql_server`). KANAP matches them with the published vulnerabilities, so a technology without one gets no vulnerability. A product can have several (vSphere covers vCenter and ESXi). Where to find this value: search the product in the [NIST CPE dictionary](https://nvd.nist.gov/products/cpe/search) and keep its part, vendor and product. Copy them as the NVD writes them, with the backslash before a sign: `a:veeam:veeam_backup_\&_replication`. Catalog entries come with their identifiers, except the operating systems.

**Notes**: free text, such as licensing terms or renewal dates.

### Servers

The servers that carry the technology, one row per server and version:

| Column | What it shows |
|---|---|
| **Ref**, **Server** | The server. Click the row to open it |
| **Environment**, **Operating system** | Taken from the server |
| **Version** | The version installed. A dash means the version is unknown |
| **Via** | For a server that carries the technology through another one: the server or cluster it is installed on. The column shows only when the tab has such a row |
| **Notes** | Free text about this installation, for example "cluster node" |

A technology reaches a server in two ways:

- **Installed**: someone linked the technology to this server. You can change the version and the notes in place, or remove the row.
- **Through another server**: the technology is installed on the server or cluster this one runs in, for example SQL Server installed on a cluster and shown on each of its members. The row names that server under **Via**. It follows the installation: change or remove it on that server.

**Add** (`infrastructure:member`) opens a search for a server, then the version picker: choose a version, **Version unknown**, or type a new label and pick **Add version "…"** to create it. Each change saves at once.

A retired server stays listed, greyed out and marked "retired", so you can remove its link. It counts nowhere: not in the badge, the total, the list counters or the reports. The **Total** row counts the servers in service, each once.

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

**Export CSV** downloads the rows in the language of your screen.

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

### Relations

The records linked to the technology, one section per kind:

- **Budget lines**: with the amount of the current year in the budget column of your workspace, and a total. A line whose currency has no exchange rate for the year shows its amount in its own currency with a small orange mark, and the total leaves it out. A one-line warning under the table names it. See [Manual rates](currencies.md#manual-rates).
- **Contracts**: supplier, end date and yearly amount, with a total per currency.
- **Projects**: status and planned end.
- **Incidents**: severity, status and detection date. Linking an incident needs `incidents:contributor`. A closed or cancelled incident cannot be linked or unlinked.
- **Documents**: files uploaded to the technology, with their size and date. **Add** uploads files; click a name to download it.
- **Web links**: a name and an address, such as the publisher's release notes. Click the name to open it; hover a row to edit it. Addresses start with `http://` or `https://`; an address without one opens as `https://`.
- **Vulnerabilities**: when vulnerabilities are followed, the known vulnerabilities of the versions in use. See [Vulnerabilities](#vulnerabilities).

A section appears only if you can read its module. **Add** (`infrastructure:member`) opens a search in place; the cross at the end of a row removes the link.

#### Vulnerabilities

One row per version and vulnerability, most severe first, with its **CVE**, **Severity**, **Version** and **State**. The count next to the title is the number of distinct vulnerabilities. Click a row to open it on the [Vulnerabilities](vulnerabilities.md) page, where you review it.

KANAP matches the technology again as soon as its identifiers, versions, servers or applications change. After a new CPE product identifier, the section says "Searching for vulnerabilities…" while KANAP reads that product from the NVD. **Match again** (`infrastructure:member`) runs the comparison by hand.

---

## Linking a technology to a server

You can record that a server carries a technology from either side:

- From the technology: **Servers** tab, **Add**, then choose the server and the version.
- From the server: **Technical** tab of the asset, **Technologies** section, **Add**, then choose the technology and the version. See [Assets](assets.md#technical).

Record the technology on the server where it is installed: the host for a hypervisor, each domain controller for Active Directory, the database server for SQL Server. The servers that run inside it, or the members of its cluster, then show it without further work. A cloud technology, such as Entra ID, runs on none of your servers: declare it on the applications instead.

---

## Where technologies appear

- **Applications**: the **Technologies** section at the top of the Operations tab lists what an application depends on. See [Applications](applications.md#operations).
- **Assets**: the **Technologies** section of an asset's Technical tab lists what the server carries, its operating system first. See [Assets](assets.md#technical).
- **Contracts**, **budget lines** and **incidents**: a **Technologies** field in their Relations tab, for users who can read the infrastructure.
- **End of support** report: the versions that reach their end of support, operating systems included, and what they touch. See [End of support](end-of-support.md).
- **Vulnerabilities**: the known vulnerabilities of the versions in use, and the servers and applications they reach. See [Vulnerabilities](vulnerabilities.md).
- **Administration view**: the technologies of each administration zone, with their servers. See [Administration view](administration-view.md).
- **Contacts**: the **Used by** section of a contact lists the technologies it supports. See [Contacts](contacts.md#where-contacts-are-used).
- **Search**: the global search and the assistant's `@` mentions find technologies by name and by reference (`@TEC-4`).

## Converting an application

A record created as an application may really be a technology, for example a database engine or a directory. Open the application and use **Convert to technology**. See [Applications](applications.md#converting-an-application-to-a-technology).

## Tips

- **Start from the catalog**: you get the versions and their end of support dates without typing them.
- **Track major versions**: one line per major version (2019, 2022) is enough to follow support.
- **Name the owners**: the IT owners are the people to call when a version reaches its end of support. They also receive the email about new critical vulnerabilities.
- **Fill in the CPE product identifiers**: without them, KANAP cannot match the technology with the published vulnerabilities.
- **Record the version on each server**: an unknown version is potentially concerned by every vulnerability of the product.
