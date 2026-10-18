# Administration view

The Administration view shows who administers what. It lists your administration zones with their technologies and servers, then your domains with their forest, trusts and domain controllers. It follows the administration view of the ANSSI information system mapping guide, and helps answer the questions of a NIS2 review about privileged access.

Open it from **IT Landscape > Administration view**, in the **Infrastructure** group. You need `infrastructure:reader`.

## Before you start

The view reads what you record elsewhere:

1. Define your administration zones and complete your domains in **IT Landscape > Settings**. See [Administration zones](it-ops-settings.md#administration-zones) and [Domains](it-ops-settings.md#domains).
2. Place each technology in its zone with the **Administration zone** field of its properties drawer. See [Technologies](technologies.md#properties-drawer).
3. Link the technologies to the servers that carry them. See [Linking a technology to a server](technologies.md#linking-a-technology-to-a-server).

## Administration zones

One block per zone, by name. Each block shows:

- The zone's **Administrator group**, **Privilege level** and **Secrets** (where its secrets are kept).
- **Directory services**: the technologies of the **Directory and identity** family placed in the zone.
- A table of its technologies: **Ref**, **Technology**, **Family** and **Servers**. The servers are those that carry the technology, directly or through the server they run in ("via" that server).

The technologies without a zone come last, under **No zone**. A warning at the top of the page counts them: open each one and set its zone.

Retired technologies and retired servers are left out. A zone marked **No longer offered** in the settings still shows while technologies are placed in it. A zone removed from the settings while technologies still name it shows as **Unknown zone**, with its code.

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

## Export

**Export zones** and **Export domains** download each list as a CSV file.

## Tips

- **Start with Tier 0**: place the directory, its controllers and the tools that administer them first. They are the most exposed.
- **Name the secrets**: the **Secrets location** of a zone answers the first question of an audit: where are the administrator passwords kept?
- **Check the controllers**: a domain without a controller, or with an unexpected one, usually reveals a server whose domain or technologies are missing.
