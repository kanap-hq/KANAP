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

**Additional columns** (through the column chooser): **Lifecycle**, **Versions in use**, **IT owner**.

**Filtering**: **Family**, **Publisher** and **Lifecycle** offer checkbox filters. The search box matches the name, the publisher and the reference.

**Actions**:

- **New technology** (`infrastructure:member`).
- **Delete** the selected rows (`infrastructure:admin`). The confirmation counts what goes with them: links to servers and applications, contracts, budget lines, projects, incidents and documents.

---

## The technology workspace

The workspace has a header, a properties drawer on the right, and the **Overview** tab.

### Header

- **Name**: editable in place.
- **Reference**: click to copy it.
- **Lifecycle**: click to change it. A retired technology is no longer offered when you search for one to link.
- **Family**.
- **Delete** (`infrastructure:admin`): the confirmation names what goes with the technology.

### Properties drawer

- **Publisher**, **Family** and **Mode**.
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

**CPE product identifiers**: the names security databases use for this product, in the form `part:vendor:product` (for example `a:microsoft:sql_server`). A product can have several (vSphere covers vCenter and ESXi). Where to find this value: search the product in the [NIST CPE dictionary](https://nvd.nist.gov/products/cpe/search) and keep its part, vendor and product. Catalog entries come with their identifiers.

**Notes**: free text, such as licensing terms or renewal dates.

---

## Where technologies appear

- **Applications**: the **Technologies** section of the Relations tab lists what an application depends on. See [Applications](applications.md#relations).
- **Assets**: the **If this server goes down** section of an asset's Relations tab lists the technologies that stop with it. See [Assets](assets.md#relations).
- **Contracts**, **budget lines** and **incidents**: a **Technologies** field in their Relations tab, for users who can read the infrastructure.
- **End of support** report: the versions that reach their end of support, and what they touch. See [End of support](end-of-support.md).
- **Search**: the global search and the assistant's `@` mentions find technologies by name and by reference (`@TEC-4`).

## Converting an application

A record created as an application may really be a technology, for example a database engine or a directory. Open the application and use **Convert to technology**. See [Applications](applications.md#converting-an-application-to-a-technology).

## Tips

- **Start from the catalog**: you get the versions and their end of support dates without typing them.
- **Track major versions**: one line per major version (2019, 2022) is enough to follow support.
- **Name the owners**: the IT owners are the people to call when a version reaches its end of support.
