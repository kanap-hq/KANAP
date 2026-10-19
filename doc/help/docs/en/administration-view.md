# Administration view

The Administration view shows who administers what. It lists your administration zones with the assets they cover, then your domains with their forest, trusts and domain controllers, then the points to correct. It follows the administration view of the ANSSI information system mapping guide, and helps answer the questions of a NIS2 review about privileged access.

Open it from **IT Landscape > Administration view**, in the **Infrastructure** group. You need `infrastructure:reader`.

## Before you start

The view reads what you record elsewhere:

1. Define your administration zones and complete your domains in **IT Landscape > Settings**. Put the zones in order: the first one is the most sensitive. See [Administration zones](it-ops-settings.md#administration-zones) and [Domains](it-ops-settings.md#domains).
2. Place each asset in its zone with the **Administration zone** field of its properties drawer. See [Assets](assets.md#properties-drawer-right-panel).
3. Link the directory technologies, such as Active Directory, to the servers that carry them. See [Linking a technology to a server](technologies.md#linking-a-technology-to-a-server).
4. A directory service with no server of yours, such as Entra ID, takes its zone from the **Administration zone** field of its properties drawer. See [Technologies](technologies.md#properties-drawer).

## Why the zones matter

In the ANSSI tier model, anything that can act on an element of a sensitive zone belongs to that zone. The hypervisor that runs a domain controller can take control of it, so it is Tier 0 as well. The control points at the bottom of the page find the assets that break this rule.

## Administration zones

One block per zone, in the order of the settings, with the number of its assets. Each block shows:

- The zone's **Administrator group** and its description.
- Its scope: the number of assets of each type, and the number of applications hosted on those assets. Only applications and instances in service count.
- A table of its assets: **Ref**, **Name** and **Type**. Click a row to open the asset.
- **Directory services**: the technologies of the **Directory and identity** family placed in the zone. Click a row to open the technology.

Retired assets and retired technologies are left out. A zone marked **No longer offered** in the settings still shows while assets or directory services are placed in it. A zone removed from the settings while assets or directory services still name it shows after the others as **Unknown zone**, with its code.

If no zone exists yet, the page says so and, if you can read the settings, links to them.

## Domains

One row per domain, except the built-in **Workgroup** and **N/A** entries:

| Column | What it shows |
|---|---|
| **Domain** | The domain's name. A domain no longer offered is marked as such |
| **DNS suffix** | The suffix of its machines' names |
| **Forest** | The Active Directory forest it belongs to |
| **Trusts** | The domains it has a trust with, and the direction of each one |
| **Accounts**, **Machines** | The numbers recorded in the settings |
| **Domain controllers** | The servers deduced as controllers of the domain |

**Trusts** also lists, read only, the trusts declared on another domain toward this one, with the direction seen from this domain: an outgoing trust of A toward B reads as incoming on B. The directions mean:

- **Outgoing**: this domain trusts the other one. The other domain's accounts can reach this domain's resources.
- **Incoming**: the other domain trusts this one.
- **Two-way**: both.

**Domain controllers** are not entered by hand. KANAP takes the servers of the domain (the **Domain** field of the asset's Technical tab) that are not retired and that either:

- carry a technology of the **Directory and identity** family that is not retired, such as Active Directory, or
- are assigned with the **Domain controller** server role to an application in service.

Each server appears once. "None found" means no server of the domain meets either rule.

## Control points

The control points list what to correct. The first zone of the settings that is not marked **No longer offered** is the most sensitive zone, and the page names it. Each control point shows its count and a table. Click a row to open the record to correct.

| Control point | What it lists |
|---|---|
| **Assets without an administration zone** | The assets that are not retired and have no zone |
| **Domain controllers outside the most sensitive zone** | The assets assigned the **Domain controller** server role on an application in service, when their zone is another one |
| **Assets carrying a directory service outside the most sensitive zone** | The assets with a directory technology installed on them, such as Active Directory, when their zone is another one |
| **What runs an asset is in a less sensitive zone** | A contained asset in a more sensitive zone than its container (a Tier 0 virtual machine on a Tier 1 host, for example), or a cluster member in a less sensitive zone than its cluster (a Tier 1 ESX host in a Tier 0 cluster, for example). Each row shows the asset, its zone, the relation (**Runs on** or **Member of cluster**) and the asset it depends on, with its zone. The row opens the asset in the less sensitive zone: place it in a zone at least as sensitive |
| **Applications hosted in the most sensitive zone** | Each application hosted on an asset of that zone, with the asset. Review whether it belongs there |

For this check, KANAP reads the **Contains** relations of the assets and the members of the clusters. What runs an asset must sit in a zone at least as sensitive. A zone marked **No longer offered** or missing from the settings is ignored. An asset without a zone interrupts the check of the chain: KANAP compares neither it nor the assets linked to it, and the first control point lists it.

Without any zone in the settings, only the first control point runs, and the page asks you to add a zone.

## Export

**Export zones** and **Export domains** download each list as a CSV file.

The zones file has a **Record** column that says what each row is:

- **zone**: one row per zone, with its administrator group, description, number of hosted applications and, in **Note**, its number of assets of each type.
- **asset** and **directory**: the assets and the directory services of the zone named in **Zone**.
- **control**: one row per finding of the control points, with the title of the control point in **Zone**. **Note** gives the asset's zone, or the hosting asset for an application. For the trust check, **Type** gives the relation (**Runs on** or **Member of cluster**), and **Note** gives the asset's zone, then the asset it depends on with its zone. A control point with no finding has no row.

## Tips

- **Start with Tier 0**: place the directory, its controllers, the hypervisors that run them and the tools that administer them first. They are the most exposed.
- **Name the administrators**: the **Administrator group** of a zone answers the first question of an audit: who holds the administrator rights?
- **Check the controllers**: a domain without a controller, or with an unexpected one, usually reveals a server whose domain, role or technologies are missing.
