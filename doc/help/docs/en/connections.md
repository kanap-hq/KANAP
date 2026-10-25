# Connections

Connections document the infrastructure-level network paths between servers and entities. While Interfaces describe logical data flows between applications, Connections describe the physical network routes: which servers communicate, over which protocols and ports.

## Getting started

Navigate to **IT Landscape > Connections** to see your connection registry. Click **Add connection** to create your first entry.

**Required fields**:
  - **Name**: A descriptive name
  - **Topology**: Server to server or Multi-server
  - **Endpoints**: A source and a destination (Server to server), or at least two servers (Multi-server)
  - **Protocols**: At least one network protocol

KANAP gives each connection a reference, such as `CONN-12`.

**Tip**: Connections can be linked to interface bindings to show which infrastructure supports each application integration.

---

## Working with the list

The list gives you a filterable overview of every connection in your registry.

**Default columns**:
  - **Reference**: The connection reference, such as `CONN-12` (click to open workspace)
  - **Name**: Connection name (click to open workspace)
  - **Topology**: Server to server or Multi-server
  - **Source** / **Destination**: The connected endpoints
  - **Protocols**: Network protocols shown as chips
  - **Criticality**: Business importance, which may be derived from linked interfaces
  - **Data class**: Data sensitivity level
  - **PII**: Whether personal data traverses this connection
  - **Risk**: Manual or Derived (shows the number of linked interfaces)
  - **Lifecycle**: Current status
  - **Created on**: When the record was created

**Additional columns** (via column chooser):
  - **Servers**: Count of servers in a multi-server connection

**Filtering**:
  - Quick search: Searches across connection fields
  - Column filters: **Topology**, **Lifecycle**, **Criticality**, **Data class** and **PII** use checkbox lists, so you can pick several values at once. **Criticality** and **Data class** also offer **(Blank)** for connections without a value
  - **Criticality**, **Data class** and **PII** filter and sort on the value shown. For a derived connection, that is the value inherited from its interfaces

**Sorting**:
  - **Criticality** and **Data class** sort by severity, in the order of the levels in [Classifications and continuity](it-ops-settings.md#classifications-and-continuity). Connections without a value come last

**Actions**:
  - **Add connection**: Create a new connection (requires `infrastructure:member`)
  - **Delete connection**: Remove selected connections (requires `infrastructure:admin`). Their servers, interfaces and documents stay; only their links to the connection go. To delete a single connection, open it and use **Delete** in its header, which needs `infrastructure:member` (see [The Connections workspace](#the-connections-workspace)).

---

## Connection types { #connection-types }

### Server to server

A direct connection between two endpoints. Each side is a server, a cluster or an entity:

- **Source**: Where traffic originates
- **Destination**: Where traffic terminates
- A side holds one server, cluster or entity
- The source and the destination cannot be the same asset

### Multi-server

A connection between several servers, such as a replication between nodes or a mesh. Select at least two servers or clusters.

### Connections on a cluster { #connections-on-a-cluster }

A source, a destination, a server of a multi-server connection or the equipment of a hop can be a cluster. The connection then applies to the members in service of the cluster. A member added later gets it too. A member taken out of the cluster loses it. A retired member gets nothing, and a retired cluster passes nothing on.

The pickers mark a cluster with an icon and list its members under its name.

When you pick a server that belongs to a cluster, KANAP asks **Connect to the cluster?**. **Connect to the cluster** puts the cluster on the connection, for all its members. **This server only** keeps the server. KANAP does not ask when the other side is already that cluster or one of its members: the connection stays on the server.

A multi-server list that holds a cluster and one of its members keeps the cluster only. A message names the members removed from the list. A list must keep at least two servers.

The [Network](assets.md#network) tab of each member lists the connections of its clusters, and the [Connection Map](connection-map.md) draws the members of a cluster.

---

## The Connections workspace

Click any row to open the workspace. It has two tabs: **Overview** and **Path**. The properties panel on the right holds **Lifecycle**, **Topology**, **Risk mode**, **Criticality**, **Data class**, **Contains PII** and **Created on**. Edits save automatically.

**Delete**, a trash icon in the header, deletes the connection after a confirmation (`infrastructure:member`). The confirmation counts the interface bindings it is unlinked from. The interfaces themselves stay.

### Overview

- **Description**: Why this connection exists and what it carries
- **Endpoints**: The source and the destination, or the servers of a multi-server connection. See [Connection types](#connection-types)
- **Protocols**: One or more network protocols, from your Connection Types settings, with their typical ports
- **Risk derivation**: In derived risk mode, the interfaces the risk comes from, with their criticality, data class and PII
- **Linked interfaces**: The interface bindings linked to this connection. **Link existing** links another one

### Path

The Path tab documents the network path of the connection, hop by hop: reverse proxies, firewalls, load balancers. Create the connection first to add hops.

Each hop has:

  - A function, such as Firewall, Reverse proxy or Load balancer
  - **Equipment**: A server, a cluster or an entity, or nothing when the equipment is not documented. A server that belongs to a cluster raises the same question as an endpoint. See [Connections on a cluster](#connections-on-a-cluster)
  - **Protocols (override)** and **Port**: When they differ from the connection
  - **Notes**

**Add hop** adds a hop at the end. The arrows reorder the hops and the bin removes one. Each change saves at once.

### Risk

**Risk mode**, in the properties panel:

  - **Manual**: You set criticality, data class and PII directly
  - **Derived**: The values come from the linked interface bindings. The fields are read-only and show the highest values across the linked interfaces

**Criticality** uses the levels of [Classifications and continuity](it-ops-settings.md#classifications-and-continuity). The default levels are Critical, High, Moderate and Low. **Data class** comes from your data classification settings.

---

## Tips

  - **Start with critical paths**: Document connections for your most important applications first, then work outward.
  - **Use Derived risk mode**: Let the system calculate criticality from the interfaces that use each connection. It saves effort and stays current as interfaces change.
  - **Link to interfaces**: Connecting your infrastructure to interface bindings gives you end-to-end traceability from application data flows down to network routes.
  - **Document protocols accurately**: Good protocol data makes firewall rule reviews and security audits significantly easier.
