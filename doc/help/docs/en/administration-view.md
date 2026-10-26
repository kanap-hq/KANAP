# Administration zones

The Administration zones page shows who administers what. It follows the tiered administration model, a recognized practice for administering directories such as Active Directory: your administration zones, the assets in each one, the points to correct, then your directory services and domains. It helps answer the questions of a NIS2 review about privileged access.

Open it from **IT Landscape > Administration zones**, in the **Infrastructure** group. You need `infrastructure:reader` to read it, and `infrastructure:member` to assign zones from it.

## Before you start

The page reads what you record elsewhere:

1. Define your administration zones and complete your domains in **IT Landscape > Settings**. Put the zones in order: the first one is the most sensitive. See [Administration zones](it-ops-settings.md#administration-zones) and [Domains](it-ops-settings.md#domains).
2. Place each asset in its zone, here in bulk (see [Assigning a zone](#assigning-a-zone)) or with the **Administration zone** field of the asset's properties drawer. See [Assets](assets.md#properties-drawer-right-panel).
3. Link the directory technologies, such as Active Directory, to the servers that carry them. See [Linking a technology to a server](technologies.md#linking-a-technology-to-a-server).
4. A directory service with no server of yours, such as Entra ID, takes its zone from the **Administration zone** field of its properties drawer. See [Technologies](technologies.md#properties-drawer).

## Why the zones matter

In the tiered administration model, anything that can act on an element of a sensitive zone belongs to that zone: the hypervisor that runs a domain controller can take control of it, so it is Tier 0 as well. The control points find the assets that break this rule.

## Tabs

The page has two tabs, each with its count:

- **Assets**: the zones, the control points and the table of assets. Its count is the number of assets that are not retired.
- **Directories and domains**: your directory services, then your domains grouped by forest. Its count adds up the directory services and the domains.

The page opens on **Assets**. The page address keeps the open tab and the filters of the table, so a link opens the same view. **Export assets** and **Export domains** stay at the top of the page on both tabs. **Assign to a zone** shows on the **Assets** tab.

## Zones

The band at the top lists the zones in the order of the settings, the most sensitive first, then a **No zone** row. Each row shows:

- The zone's name, with its description under it.
- Its **Administrator group**.
- The number of its assets of each type, the number of applications hosted on those assets, and the number of directory services placed in the zone. Hover the directory services to read their names. Only applications and instances in service count.

Click a row to show only its assets in the table below. Click it again to show every asset. The **No zone** row gives the number of assets that have no zone yet.

Retired assets and retired technologies are left out. A zone marked **No longer offered** in the settings still shows while assets or directory services are placed in it. A zone removed from the settings while assets or directory services still name it shows after the others as **Unknown zone**, with its code.

If no zone exists yet, the page says so and, if you can read the settings, links to them.

## Control points

Under the band, one button per control point gives its short name and its number of assets. Hover it to read the full title and what to do. Click it to show only the assets it concerns in the table, and again to show every asset.

The most sensitive zone is the first zone of the settings that is not marked **No longer offered**.

| Control point | Assets it lists |
|---|---|
| **Without a zone** | The assets that have no zone |
| **Domain controller outside** | The domain controllers the **Directories and domains** tab lists, when their zone is not the most sensitive one. A directory server with no domain, or with a domain missing from the settings, counts under **Directory service outside** only |
| **Directory service outside** | The assets with a directory technology installed on them, such as Active Directory, when their zone is not the most sensitive one |
| **Less sensitive host** | The assets to raise: a host that runs an asset of a more sensitive zone (a Tier 1 host that runs a Tier 0 virtual machine, for example), or a member of a cluster in a more sensitive zone (a Tier 1 ESX host in a Tier 0 cluster, for example) |
| **Application hosted** | The assets of the most sensitive zone that host an application in service. Review whether each application belongs there |

For **Less sensitive host**, KANAP reads the **Contains** relations of the assets and the members of the clusters. What runs an asset must sit in a zone at least as sensitive. A zone marked **No longer offered** or missing from the settings is ignored. An asset without a zone interrupts the check of the chain: KANAP compares neither it nor the assets linked to it, and **Without a zone** lists it.

Without any zone in the settings, only **Without a zone** shows, and the page asks you to add a zone.

## Assets

The table lists every asset that is not retired, and loads more as you scroll. Click a row to open the asset.

| Column | What it shows |
|---|---|
| **Ref**, **Name**, **Type** | The asset |
| **Zone** | Its administration zone, or **No zone** |
| **Technologies** | The technologies installed on it. The first two names show, then the number of the others; hover the cell for the full list |
| **Applications** | The applications in service hosted on it, shown the same way, those assigned to its cluster included. Click a name to open the application |
| **Controls** | The control points that concern it. Hover **Less sensitive host** to see why: **Runs** names the more sensitive asset it runs, **Member of cluster** names the more sensitive cluster, each by its reference and name, with its zone |

Search on the name or the reference. Filter on **Type**, **Zone** (including **No zone**) and **Controls**, and sort on **Ref**, **Name**, **Type** or **Zone**. Sorting on the zone follows the order of the settings, with the assets without a zone last. The band and the control point buttons set the same filters as the **Zone** and **Controls** columns.

## Assigning a zone

With `infrastructure:member`, a box starts each row:

- Tick rows to choose them one by one.
- Tick the box in the header to choose every asset of the current filter, including those not loaded yet. You can then untick rows to leave them out.

Changing the search or the filters clears the choice. **Assign to a zone** opens a dialog where you pick a zone, or **No zone** to clear it. A zone marked **No longer offered** cannot be chosen. Before you confirm, the dialog counts the assets whose zone will change out of the assets chosen. One assignment covers up to 5,000 assets: narrow the filters beyond that.

If assets enter the filter between the count and the confirmation, KANAP refuses the change and counts again: check the new number, then confirm. Each changed asset gets an entry in the audit log, as when you edit it.

## Directory services and domains

**Directory services** lists the technologies of the **Directory and identity** family, with their zone and their number of servers (the servers that are not retired and carry the technology directly). Click a row to open the technology.

**Domains** lists your domains, except the built-in **Workgroup** and **N/A** entries, grouped by forest. Domains whose forest is spelled with different letter case share one group. The domains without a forest come last, under **No forest**. Each domain shows:

| Column | What it shows |
|---|---|
| **Domain** | The domain's name. A domain no longer offered is marked as such |
| **DNS suffix** | The suffix of its machines' names |
| **Trusts** | The domains it has a trust with, and the direction of each one |
| **Accounts**, **Computers** | The numbers recorded in the settings. A dash means none is recorded |
| **Domain controllers** | How many servers KANAP deduces as controllers of the domain, then their names. Click a name to open the asset |

**Trusts** also lists, in grey, the trusts declared on another domain toward this one, with the direction seen from this domain: an outgoing trust of A toward B reads as incoming on B. The directions mean:

- **Outgoing**: this domain trusts the other one. The other domain's accounts can reach this domain's resources.
- **Incoming**: the other domain trusts this one.
- **Two-way**: both.

**Domain controllers** are not entered by hand. KANAP takes the servers of the domain (the **Domain** field of the asset's Network tab) that are not retired and that either:

- carry a technology of the **Directory and identity** family that is not retired, such as Active Directory, or
- are assigned with the **Domain controller** server role to an application in service.

Each server appears once. "None found" means no server of the domain meets either rule.

## Export

**Export assets** downloads the assets of the table as a CSV file, with its search, filters and sort. The columns are **Zone**, **Reference**, **Name**, **Type**, **Technologies**, **Applications**, **Controls** and **Dependency**. **Dependency** gives, for **Less sensitive host**, each more sensitive asset the asset runs or cluster it belongs to, with its zone. One export holds up to 10,000 assets: narrow the filters beyond that.

**Export domains** downloads every domain with its DNS suffix, forest, trusts (its own and those declared by other domains), numbers of accounts and computers, and domain controllers.

## Tips

- **Start with Tier 0**: place the directory, its controllers, the hypervisors that run them and the tools that administer them first. They are the most exposed.
- **Work from a control point**: click **Without a zone**, tick the header box and assign the zone in one step, then refine row by row.
- **Name the administrators**: the **Administrator group** of a zone answers the first question of an audit: who holds the administrator rights?
- **Check the controllers**: a domain without a controller, or with an unexpected one, usually reveals a server whose domain, role or technologies are missing.
