# Locations

Locations document where your IT infrastructure is hosted: data centers, cloud regions, office server rooms, and colocation facilities. Assigning assets and applications to locations gives you geographic visibility, helps with capacity planning, and keeps facility contacts within reach when you need them.

## Getting started

Navigate to **IT Landscape -> Locations** to open the location registry. Click **Add Location** to create a new entry.

**Required fields**:
- **Code**: A unique short identifier (e.g., `DC-EU-WEST`, `AWS-US-EAST-1`)
- **Name**: A descriptive display name
- **Hosting Type**: The kind of facility: on-premises data center, colocation, cloud region, etc.

**Strongly recommended**:
- **Country**: Where the location sits geographically
- **Provider** or **Operating Company**: Who operates the facility

**Tip**: Use consistent naming conventions. Prefixing cloud locations with the provider name (`AWS-`, `AZURE-`, `GCP-`) makes them easy to spot in lists and reports.

---

## Working with the list

The list gives you a searchable overview of every registered location.

**Default columns**:
- **Code**: Location code (click to open the workspace)
- **Name**: Display name
- **Hosting Type**: On-prem, colocation, public cloud, etc.
- **Provider / Company**: Cloud provider for cloud-type locations, or operating company for on-prem locations
- **Country**: Country name and ISO code
- **City**: City name
- **Assets**: Number of assets assigned to this location
- **Created**: When the record was created

**Filtering**:
- Quick search: Free-text search across all rows
- Column filters: Text filters on Code, Name, and City; set filter on Hosting Type

**Actions**:
- **Add Location**: Create a new location (requires `locations:member`)

You can also show, hide, and reorder columns using the column chooser.

---

## The Locations workspace

Click any row to open the workspace. It has four tabs: **Overview**, **Contacts & Support**, **Relations** and **History** (the changes made to the location, see [Record history](record-history.md)). The Contacts & Support and Relations tabs become available after the location is saved for the first time.

### Overview

The Overview tab captures identity and geographic information, split into two sections, plus a sub-locations panel.

**Basic information**:
- **Code**: Unique identifier (required)
- **Name**: Display name (required)
- **Hosting Type**: Category of facility (required). Hosting types are configurable in **IT Landscape -> Settings**.

**Location details**: the fields shown here depend on the hosting type category:

For **on-premises** hosting types:
- **Operating Company**: The company that runs the facility. Selecting a company auto-fills Country and City if they are blank.

For **cloud** hosting types:
- **Cloud Provider**: The cloud provider (e.g., AWS, Azure, GCP)
- **Region**: Cloud region or availability zone

Both categories also show:
- **Country**: Selected from the ISO country list
- **City**: City name
- **Additional Info**: Free-form notes about the location

**How it works**: Switching between an on-prem and a cloud hosting type clears the fields that belong to the other category. The editor asks for confirmation before making the switch.

#### Sub-locations

Below the main form, the **Sub-locations** panel lets you break a location into smaller physical areas: buildings, rooms, racks, cages, or any other subdivision that makes sense for your infrastructure.

Each sub-location has:
- **Name**: A short label (e.g., "Building A, Room 1, Rack 5")
- **Description**: Optional additional detail

Sub-locations are available once the location exists (after you click **Create**). Each row saves on its own when you leave the field, and deleting a sub-location asks for confirmation first.

Assets can be assigned to a specific sub-location within a location, which lets you track exactly where hardware sits. The Relations tab shows the sub-location of each asset that has one.

---

### Contacts & Support

This tab organises the people and references associated with a location into three sections.

**Internal contacts**: Team members from your organisation linked to this location. Each row has a **User** picker and a free-text **Role** field (e.g., "Ops lead", "Security officer").

**External contacts**: Third-party contacts pulled from your Contacts master data. Each row has a **Contact** picker and a **Role** field (e.g., "Account manager", "NOC contact").

**Relevant websites**: Useful links such as provider portals, facility documentation, or status pages. Each row has a **Description** and a **URL**.

Changes save automatically. Adding a contact or a link saves it at once, and a role, description or URL saves when you leave the field.

---

### Relations

The Relations tab shows the assets at this location and the applications that run on them, then the web links of the location. Click a row to open the asset or the application. The tab badge counts the assets and applications you can see, and the web links.

| Section | Columns |
|---|---|
| **Assets** | Reference (`AST-12`), name, sub-location, type, environment, provider, status |
| **Applications** | Reference (`APP-3`), name, environments, lifecycle |

**Assets** lists the assets placed at this location. The **Sub-location** column appears only when at least one asset has a sub-location. The section is read only: you set an asset's location on the asset itself. It needs a read of the infrastructure.

**Applications** lists the applications with an instance on one of those assets. **Environments** shows the environments of those instances. The section is read only and needs a read of the applications. A Business Contributor only sees the applications they take part in.

**Web links**: the links of the location (provider portals, facility documentation, status pages), one row each with its name, the domain of the link and the date it was added. They are the same links as the **Relevant websites** of the Contacts & Support tab. Click a link to open it in a new tab. With `locations:member`:

- **Add link** opens a dialog for a URL and an optional name; the link is saved at once. To change a link, hover its row and click the pencil.
- To remove a link, hover its row and click the cross. A message names the link and offers **Undo**, which creates it again.

---

## Deleting a location

From the workspace header, click **Delete** (trash icon) to remove a location.

- Requires `locations:member` permission.
- Linked assets are not deleted. They are automatically unassigned (their location reference is cleared).
- If you have unsaved changes in the workspace, those changes are lost on deletion.

---

## Hosting types

Hosting types are configurable in **IT Landscape -> Settings**. Each type belongs to a category that controls which fields appear in the workspace.

| Type | Category | Example |
|------|----------|---------|
| Private Data Center | On-prem | Company-owned facility |
| Colocation | On-prem | Rented space in a shared facility |
| Public Cloud | Cloud | AWS, Azure, GCP |
| Private Cloud | Cloud | Company-operated cloud platform |
| Edge | Cloud | Edge computing locations |

---

## Permissions

| Action | Minimum level |
|--------|---------------|
| View the list and workspace | `locations:reader` |
| Create, edit, or delete a location | `locations:member` |
| Configure hosting types and providers | `settings:admin` |

---

## Tips

- **Be consistent with codes**: A clear naming convention makes locations easy to identify at a glance and keeps filters useful.
- **Use sub-locations for granularity**: If a data center has multiple rooms or racks, model them as sub-locations rather than separate locations. This keeps the list clean while still tracking physical placement.
- **Track cloud regions individually**: Create one location per cloud region you use, not just one per provider.
- **Link assets to locations**: This enables geographic reporting, DR planning, and quick impact analysis during outages.
- **Document contacts early**: Having facility contacts on file before an incident saves critical time when it matters most.
