# Interface Map

The Interface Map is an interactive visualization of your application integration landscape. Applications appear as nodes and interfaces as connecting edges, giving you a bird's-eye view of how data flows across your systems for a given environment.

## Where to find it

Navigate to **IT Landscape > Interface Map** to open the visualization.

**Permissions**: You need at least `applications:reader` to view the map.

---

## Understanding the visualization

The map uses a force-directed graph layout where:

- **Nodes** represent applications
- **Edges** represent interfaces between applications
- **Edge labels** display the interface identifier on each connection
- **Node size** reflects how many interfaces touch the application

### Business vs Technical view

Toggle between the two view modes with the **Show middleware** switch in the toolbar.

**Business view** (default, switch off):

- Hides middleware applications
- Shows direct source-to-target relationships
- Best for understanding business data flows

**Technical view** (switch on):

- Shows middleware platforms as intermediate nodes (rendered as diamonds)
- Expands each interface into its actual data path (Source -> Middleware -> Target)
- Best for understanding the technical architecture

A short caption under the page header reminds you which view is active.

---

## Filters

All filters are in the toolbar above the map.

### Environment

Filter interfaces by deployment environment:

- Production, Pre-Prod, QA, Test, Development, Sandbox

The default is **Production**. Bindings shown in the side panel and the linked infrastructure connections always reflect the selected environment.

### Lifecycle

Multi-select filter for interface lifecycle status (Active, Planned, Deprecated, etc.). Defaults to **Active**.

### Applications

Focus the map on specific applications or services:

1. Click the **Applications** dropdown
2. Pick one or more options (grouped under **Applications** and **Infrastructure services**)
3. The map filters to show only interfaces connected to your selection

When you pick at least one application here, the **Depth** filter automatically switches from **All** to **1** so you see only the immediate neighborhood.

### Depth

Limit how many hops from the selected applications to display:

- **All**: Show every connected node (no limit)
- **1-5**: Show only nodes within N hops of the selected applications

Middleware nodes do not count as a hop: the depth counter only increments when traversing through a primary application node.

This filter only takes effect when you have at least one application selected; with no selection the value is locked to **All**.

---

## Graph controls

The control panel on the left side of the map provides these tools:

| Icon | Action | Description |
|------|--------|-------------|
| Pause / Play | **Freeze / Unfreeze** | Pause the force simulation so you can manually position nodes |
| Crosshair | **Auto-center** | Toggle automatic centering when selecting nodes (highlighted when enabled) |
| Zoom + | **Zoom in** | Increase zoom level |
| Zoom - | **Zoom out** | Decrease zoom level |
| Grid | **Snap to grid** | Align all nodes to a grid for cleaner layouts |
| SVG | **Export SVG** | Download the current view as a vector image |
| PNG | **Export PNG** | Download the current view as a raster image |

The freeze and auto-center buttons change colour when active so you can tell at a glance whether they are on or off. You can also zoom with the mouse wheel and pan by clicking and dragging the background.

---

## Interacting with the map

### Selecting nodes

Click an application node to highlight its connections and open a detail panel on the right.

### Selecting edges

Click an interface edge to see interface details in the side panel. Edges have a wider invisible hit area, so you don't need to click the line precisely.

### Dragging nodes

Drag any node to reposition it manually. While the simulation is running, the layout continues to adjust around the moved node. When the simulation is frozen, the node stays exactly where you place it.

### Clearing the selection

Click the empty background of the map (or **Close** in the side panel) to dismiss the detail panel.

### Deep linking

The map supports URL parameters for sharing specific views:

| Parameter | Description | Example |
|-----------|-------------|---------|
| `environment` | Pre-select an environment | `prod`, `dev` |
| `lifecycles` | Pre-select lifecycle filters (comma-separated) | `active,planned` |
| `focusInterfaceId` | Highlight a specific interface | UUID |
| `rootIds` | Pre-select applications to focus on (comma-separated) | UUIDs |
| `depth` | Set the depth limit | `1`, `2`, `all` |

**Example**: `/it/interface-map?environment=prod&rootIds=abc123&depth=2`

---

## The detail panel

When you select a node or edge, a side panel opens on the right with details.

### Application panel

- **Description**: What the application does
- **Publisher**: Software publisher
- **Criticality**: a business criticality level from your organization's catalog in [Classifications and continuity](it-ops-settings.md#classifications-and-continuity). The default levels are Critical, High, Moderate and Low
- **Servers**: Servers hosting this app, grouped by environment. Click a server name to open its workspace.
- **Business owners** and **IT owners**: Responsible contacts
- **Support information**: Support contacts with their roles. Click a contact name to navigate to the application's Technical tab.
- **Edit application**: Opens the application workspace

### Interface panel

For the selected interface and the current environment:

- **Criticality**, **Route**, **Bindings count**, **Via middleware** (yes/no)
- **Endpoints**: For each binding in the active environment, shows source app -> target app, leg type, job name, source endpoint, and target endpoint
- **Infra connections**: Infrastructure connections linked to this interface for the current environment. Each card shows source, destination, protocols, and the binding's environment / leg type. From the card you can:
  - Click **Edit** to open the connection workspace
  - Click **View in Connection Map** to jump to the infrastructure topology, pre-focused on the connection
- **Edit interface**: Opens the interface workspace

---

## Tips

- **Start with Production**: Select the Prod environment to see your most critical integrations first.
- **Focus on specific apps**: Pick a few apps in the Applications filter and use depth 1 or 2 to explore one application's neighbourhood without the full landscape.
- **Switch to Technical view**: When troubleshooting, enable **Show middleware** to see the actual data path through integration platforms.
- **Export for documentation**: Use SVG to create vector architecture diagrams, or PNG when you need a raster image.
- **Snap for clarity**: After dragging nodes into position, use **Snap to grid** to create cleaner, more aligned layouts.
- **Deep link for sharing**: Copy the URL after setting filters to share specific views with colleagues.
- **Cross-reference with Connection Map**: Use **View in Connection Map** in the Infra connections section to see the underlying network topology for a chosen binding.
