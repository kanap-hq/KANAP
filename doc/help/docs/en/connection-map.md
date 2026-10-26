# Connection Map

The Connection Map is an interactive visualization of your infrastructure network topology. Servers, clusters and external entities appear as nodes; the connections between them are edges. Use it to explore dependencies, trace connection paths, and export diagrams for architecture documentation or security reviews.

## Where to find it

Navigate to **IT Landscape > Connection Map** to open the visualization.

**Permissions**: You need at least `applications:reader` to view the map.

---

## Understanding the visualization

The map uses a force-directed graph layout where:

- **Nodes** represent servers, clusters, or external entities
- **Edges** represent connections between infrastructure components
- **Colours** indicate hosting type (on-premises, cloud) or node kind
- **Role-based placement** (enabled by default) keeps the force layout but pushes nodes into top-to-bottom tier bands

### Node types

| Type | Shape | Border colour | Description |
|------|-------|---------------|-------------|
| **Servers** | Rounded rectangle | Green (on-prem) or blue (cloud) | Individual infrastructure instances (VMs, containers, etc.) |
| **Clusters** | Rounded rectangle, dashed border | Cyan | Groups of servers acting as a single logical unit |
| **Entities** | Pill / stadium shape | Orange | Logical endpoints (external systems, SaaS services) |

A cluster brings its members in service: each one is a server node, tied to the cluster by a dashed line. See [Cluster visualization](#cluster-visualization).

---

## Filters

### Lifecycle

Multi-select filter for connection lifecycle status (Active, Planned, Deprecated, etc.). Defaults to **Active**.

### Applications and App Env

Find servers via the applications that run on them:

1. Select one or more applications from the **Applications** dropdown
2. Pick environments in the **App Env** dropdown (only environments where the selected apps have assigned servers appear)
3. The matching servers are automatically added to the **Servers** filter. An application assigned to a cluster brings the cluster and its members

This is useful when you want to see the infrastructure connections for an application without knowing which servers it runs on.

### Servers

Directly pick servers, clusters, or entities to focus on:

1. Click the **Servers** dropdown
2. Pick items (grouped by **Entities**, **Clusters**, **Servers**)
3. Use the **Depth** filter to control how many hops to show

When many items are selected, only the first chip is shown along with a **+N more** chip. Click **+N more** to open a popover that lists every selected item, with a remove icon next to each.

### Depth

Limit how many hops from the selected items to display:

- **All**: Show every connection (no depth filtering)
- **0**: Show only the selected items, their parent clusters, and directly adjacent entities
- **1-5**: Show items within N hops of the selected roots

Depth automatically switches to **0** when you select roots through the Applications or Servers filters.

---

## Display options

### Show multi-server connections

Toggle visibility of multi-server connections (connections that involve more than two servers in a mesh topology). Enabled by default.

### Show connection layers

When enabled (default), each leg of a multi-leg connection is rendered as its own edge so you can see how it routes through intermediate points. When disabled, connections are rendered as simple source-to-destination edges.

### Role-based placement

When enabled (default), the map keeps its force layout but adds vertical tier guidance:

- **Top / Upper / Center / Lower / Bottom** bands
- **Servers** use the role assignments configured in IT Landscape settings
- **Entities** use their configured **Graph Tier** (default Top)
- **Unassigned servers** fall back to Center
- **Clusters** use the roles assigned to them, or else the highest-priority tier of their members. A member also takes the roles of its cluster

Use this toggle when you want a topology view that reads like architecture tiers (edge-facing components at the top, data stores at the bottom). The setting is session-only and resets when you reload the page.

---

## Graph controls

The control panel on the left side of the map provides these tools:

| Control | Action | Description |
|---------|--------|-------------|
| Pause / Play | **Freeze / Unfreeze** | Pause the force simulation to manually position nodes |
| Crosshair | **Auto-center** | Toggle automatic centering when selecting nodes (highlighted when enabled) |
| Zoom + | **Zoom in** | Increase zoom level |
| Zoom - | **Zoom out** | Decrease zoom level |
| Grid | **Snap to grid** | Align all nodes to a grid for cleaner layouts |
| SVG | **Export SVG** | Download the current view as a vector image |
| PNG | **Export PNG** | Download the current view as a raster image |

You can also zoom with the mouse wheel and pan by clicking and dragging the background.

---

## Interacting with the map

### Selecting nodes

Click a server or cluster node to highlight its connections and open a detail panel showing:

- **Server type**, **Server location**, **Operating system**, **Network segment**, **IP address**
- **Assigned applications**: Apps running on this server, grouped by environment. On a member, an app assigned to its cluster shows "via" the cluster's name. Click an app name to open it.
- **Edit server** or **View cluster** button to open the workspace. **View cluster** opens the cluster on its **Operations** tab, where its members are managed

Click an entity node to see its type and environment.

### Selecting edges

Click a connection edge to see:

- **Purpose**, **Protocols**, **Typical ports**, **Criticality**
- **Topology**: Server to server or Multi-server
- **Edit connection** button to open the connection workspace
- **Linked interfaces** section showing which application interfaces use this connection. Each linked interface card shows the leg type, environment, pattern, and source/target endpoints. From there you can:
  - Click **Open interface** to view the interface
  - Click **View in Interface Map** to jump to the interface in context

### Dragging nodes

Drag any node to reposition it. While the simulation is running, the layout adjusts around the moved node. When the simulation is frozen, dragging moves the node freely without affecting others.

---

## Deep linking

The map supports URL parameters for sharing specific views:

| Parameter | Description | Example |
|-----------|-------------|---------|
| `lifecycles` | Pre-select lifecycle filters (comma-separated) | `active,planned` |
| `focusConnectionId` | Highlight a specific connection | UUID |
| `rootIds` | Pre-select servers/clusters/entities to focus on (comma-separated) | UUIDs |
| `depth` | Set the depth limit | `0`, `1`, `all` |

**Example**: `/it/connection-map?lifecycles=active&rootIds=abc123&depth=1`

---

## Cluster visualization { #cluster-visualization }

Clusters appear as distinct nodes with a dashed cyan border:

- A cluster on the map shows its members in service, tied to it by dashed lines, even when no connection names them. A connection on the cluster applies to each of them. See [Connections on a cluster](connections.md#connections-on-a-cluster)
- Beyond ten members, the members no connection names are folded. The cluster shows **+N** after its environment, and its tooltip gives the number of hidden members. A member you picked in **Servers** always shows
- A member picked in **Servers** brings the connections of its clusters: its clusters count as picked too
- Members keep their own connections in addition to the cluster's

---

## Configure graph tiers

You can control where nodes tend to appear vertically by editing tiers in **IT Landscape > Settings**:

- **Server Roles** list: set Graph Tier for each role (e.g., Web = Top, DB = Bottom)
- **Entities** list: set Graph Tier for each entity type (entities default to Top)

Tier changes take effect the next time the map data is loaded.

---

## Tips

- **Start from applications**: Use the Applications + App Env filters to find servers for a specific application without knowing the server names.
- **Use depth=0 for focused views**: When you only want to see the connections directly attached to specific servers, select them and set depth to 0.
- **Export for architecture docs**: SVG produces vector network diagrams suitable for documentation; PNG produces a high-DPI raster image.
- **Enable layers for troubleshooting**: Turn on **Show connection layers** to see exactly how multi-leg connections route through your infrastructure.
- **Use role tiers for architecture views**: Keep **Role-based placement** on when presenting layered architecture diagrams.
- **Cross-reference with Interface Map**: Use **View in Interface Map** in the linked-interfaces panel to see which business interfaces depend on a given infrastructure connection.
- **Snap and freeze before exporting**: After positioning nodes, freeze the layout and use **Snap to grid** to produce the cleanest output.
