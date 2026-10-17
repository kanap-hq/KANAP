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

- **Entra ID**: a subscribed technology of the **Directory and identity** family, published by Microsoft. It runs on none of your servers. The applications that sign users in through it declare it.
- **Active Directory**: an installed technology of the same family, carried by your domain controllers. The applications that use it declare it.
- **vSphere**: an installed technology carried by the vCenter virtual machine and by the hosts.
- **SQL Server**: one technology with one line per version in use (2016, 2019, 2022). Each server carries its own version, so the end of support report can name the servers still on an old one.
- **A SaaS application**: no technology to record. The publisher maintains what it runs on.

One technology covers a product as a whole. "SQL Server" stands for every SQL Server you run; the versions carry the detail.

## Getting started

Navigate to **IT Landscape > Technologies** and click **New technology**.

The window opens on the **Catalog**: a list of common products with their publisher, family and versions. Search it by name, then click an entry. KANAP creates the technology at once with its publisher, family, mode, CPE product identifiers and its versions with their end of support dates, then opens it. The catalog only offers products you have not added yet.

For a product the catalog does not know, click **Enter a technology missing from the catalog**. Fill in:

- **Name** (required): unique among your technologies.
- **Family**: what kind of technology it is (database, hypervisor, directory and identity, and so on).
- **Publisher**: suggestions come from your other technologies and from the catalog, so the same publisher keeps one spelling.
- **Mode**: **Installed** when it runs on your servers, **Subscribed** for a service you buy from a provider.

**Permissions**:

- View: `infrastructure:reader`
- Create and edit: `infrastructure:member`
- Delete: `infrastructure:admin`

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

- **Publisher**, **Family** and **Mode**.
- **Administration zone**: the zone of your administration model the technology belongs to, for example Tier 0 for the directory. The zones come from **IT Landscape > Settings**. A technology without a zone is listed as data to complete in the [Administration view](administration-view.md).
- **Replaced by**: the technology that takes over from this one, for example a newer product your teams are moving to.
- **IT owners**: the people responsible for the technology.

Changes save as you make them.

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

**CPE product identifiers**: the names security databases use for this product, in the form `part:vendor:product` (for example `a:microsoft:sql_server`). KANAP matches them with the published vulnerabilities, so a technology without one gets no vulnerability. A product can have several (vSphere covers vCenter and ESXi). Where to find this value: search the product in the [NIST CPE dictionary](https://nvd.nist.gov/products/cpe/search) and keep its part, vendor and product. Catalog entries come with their identifiers.

**Notes**: free text, such as licensing terms or renewal dates.

### Servers

The servers that carry the technology, one row per server and version:

| Column | What it shows |
|---|---|
| **Ref**, **Server** | The server. Click the row to open it |
| **Environment**, **Operating system** | Taken from the server |
| **Version** | The version installed. A dash means the version is unknown |
| **Installed on** | For a server that carries the technology through another one: the server or cluster it is installed on |
| **Notes** | Free text about this installation, for example "cluster node" |

A technology reaches a server in two ways:

- **Installed**: someone linked the technology to this server. You can change the version and the notes in place, or remove the row.
- **Through another server**: the technology is installed on the server or cluster this one runs in, for example SQL Server installed on a cluster and shown on each of its members. The row names that server under **Installed on**. It follows the installation: change or remove it on that server.

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

- **Budget lines**: with the amount of the current year in the budget column of your workspace, and a total.
- **Contracts**: supplier, end date and yearly amount, with a total per currency.
- **Projects**: status and planned end.
- **Incidents**: severity, status and detection date. Linking an incident needs `incidents:contributor`. A closed or cancelled incident cannot be linked or unlinked.
- **Documents**: files uploaded to the technology, with their size and date. **Add** uploads files; click a name to download it.
- **Web links**: a name and an address, such as the publisher's release notes. Click the name to open it; hover a row to edit it. Addresses start with `http://` or `https://`; an address without one opens as `https://`.
- **Vulnerabilities**: when vulnerabilities are followed, the known vulnerabilities of the versions in use. See [Vulnerabilities](#vulnerabilities).

A section appears only if you can read its module. **Add** (`infrastructure:member`) opens a search in place; the cross at the end of a row removes the link.

#### Vulnerabilities

One row per version and vulnerability, most severe first, with its **CVE**, **Severity**, **Version** and **State**. The count next to the title is the number of distinct vulnerabilities. Click a row to open it on the [Vulnerabilities](vulnerabilities.md) page, where you review it.

**Match again** (`infrastructure:member`) compares the technology with the known vulnerabilities right away. Use it after changing the CPE product identifiers, the versions or the servers and applications that use them. Otherwise the next scheduled check takes the change into account.

---

## Linking a technology to a server

You can record that a server carries a technology from either side:

- From the technology: **Servers** tab, **Add**, then choose the server and the version.
- From the server: **Technical** tab of the asset, **Technologies** section, **Add**, then choose the technology and the version. See [Assets](assets.md#technical).

Record the technology on the server where it is installed: the host for a hypervisor, each domain controller for Active Directory, the database server for SQL Server. The servers that run inside it, or the members of its cluster, then show it without further work. A subscribed technology, such as Entra ID, runs on none of your servers: declare it on the applications instead.

---

## Where technologies appear

- **Applications**: the **Technologies** section of the Relations tab lists what an application depends on. See [Applications](applications.md#relations).
- **Assets**: the **Technologies** section of an asset's Technical tab lists what the server carries; the **If this server goes down** section of its Relations tab lists the technologies that stop with it. See [Assets](assets.md#technical).
- **Contracts**, **budget lines** and **incidents**: a **Technologies** field in their Relations tab, for users who can read the infrastructure.
- **End of support** report: the versions that reach their end of support, and what they touch. See [End of support](end-of-support.md).
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
