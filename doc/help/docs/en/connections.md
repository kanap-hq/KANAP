# Connections

Connections document the infrastructure-level network paths between servers and entities. While Interfaces describe logical data flows between applications, Connections describe the physical network routes -- which servers communicate, over which protocols and ports.

## Getting started

Navigate to **IT Landscape > Connections** to see your connection registry. Click **Add connection** to create your first entry.

**Required fields**:
  - **Connection ID**: A unique identifier (e.g., `CONN-WEB-DB-001`)
  - **Name**: A descriptive name
  - **Connection type**: Server to Server or Multi-server
  - **Source** / **Destination**: An entity, cluster, or server at each end (for Server to Server)
  - **Protocols**: At least one network protocol

**Strongly recommended**:
  - **Purpose**: Why this connection exists
  - **Lifecycle**: Current status

**Tip**: Connections can be linked to interface bindings to show which infrastructure supports each application integration.

---

## Working with the list

The list gives you a filterable overview of every connection in your registry.

**Default columns**:
  - **Connection ID**: Unique identifier (click to open workspace)
  - **Name**: Connection name (click to open workspace)
  - **Topology**: Server to Server or Multi-server
  - **Source** / **Destination**: The connected endpoints
  - **Protocols**: Network protocols shown as chips
  - **Criticality**: Business importance -- may be derived from linked interfaces
  - **Data class**: Data sensitivity level
  - **PII**: Whether personal data traverses this connection
  - **Risk**: Manual or Derived (shows the number of linked interfaces)
  - **Lifecycle**: Current status
  - **Created**: When the record was created

**Additional columns** (via column chooser):
  - **Servers**: Count of servers in a multi-server connection

**Filtering**:
  - Quick search: Searches across connection fields
  - Column filters: Topology and Lifecycle (checkbox lists). Criticality, Data class and PII have no column filter

**Actions**:
  - **Add connection**: Create a new connection (requires `infrastructure:member`)
  - **Delete connection**: Remove selected connections (requires `infrastructure:admin`)

---

## Connection types

### Server to Server

A direct connection between two specific endpoints. Each side can be a server, a cluster, or a named entity:

- **Source**: Where traffic originates -- pick a server, cluster, or entity
- **Destination**: Where traffic terminates -- same options
- You cannot select both a server and an entity for the same side; choose one or the other

If an endpoint is a cluster, a note will remind you that member hosts are managed in the Servers workspace.

### Multi-server

A connection involving multiple servers (e.g., load-balanced clusters or mesh topologies):

- Select at least two servers from the **Connected servers** picker
- Use **Layers** to define the routing path between them

---

## The Connections workspace

Click any row to open the workspace. It has four tabs: **Overview**, **Layers**, **Criticality & Compliance**, and **Related Interfaces**.

### Overview

The Overview tab captures the connection's identity and topology.

**What you can edit**:
  - **Connection ID**: Unique identifier
  - **Name**: Display name
  - **Purpose**: Why this connection exists (free text)
  - **Connection type**: Server to Server or Multi-server
  - **Source** / **Destination**: For Server to Server -- pick a server, cluster, or entity from a grouped dropdown
  - **Connected servers**: For Multi-server -- search and select two or more servers
  - **Protocols**: One or more network protocols (drawn from your Connection Types settings)
  - **Lifecycle**: Current status
  - **Notes**: Additional context

When you select protocols, the system shows their typical ports for reference.

---

### Layers

The Layers tab lets you define an ordered network path of up to three hops -- useful for documenting reverse proxies, firewalls, or intermediate routing.

**What each layer captures**:
  - **Order**: Sequence number (1 to 3)
  - **Name**: A label for the layer (e.g., `direct`, `reverse_proxy`, `firewall`)
  - **Source** / **Destination**: An entity, cluster, or server at each end of the hop
  - **Protocols**: Which protocols are used at this layer
  - **Port override**: Custom port if different from the protocol default (auto-populated when you pick a protocol)
  - **Notes**: Layer-specific notes

Layers are saved independently from the Overview tab. Use the **Save layers** button to persist your changes.

**Tip**: You must save the connection itself before you can add layers.

---

### Criticality & Compliance

This tab controls risk classification and data protection settings.

**Risk mode**:
  - **Manual**: You set criticality, data class, and PII directly
  - **Derived**: Values are aggregated from linked interface bindings -- the tab shows the effective values and how many bindings contribute

**Fields**:
  - **Criticality**: Business critical, High, Medium, or Low
  - **Data class**: Drawn from your organization's data classification settings
  - **Contains PII**: Whether personal data traverses the connection

When risk mode is Derived, the criticality, data class, and PII fields become read-only and reflect the highest values across all linked interfaces.

---

### Related Interfaces

This tab shows which interface bindings are linked to this connection.

**What you will see**:
  - **Interface**: Name and code, with criticality / data class / PII chips
  - **Environment**: Binding environment and leg type
  - **Source endpoint** / **Target endpoint**: The binding's endpoints
  - **Lifecycle**: Interface lifecycle status
  - **Actions**: A button to navigate to the interface workspace

This tab is read-only. To link an interface binding to a connection, use the Interface workspace or the Connection Map.

---

## Tips

  - **Start with critical paths**: Document connections for your most important applications first, then work outward.
  - **Use Derived risk mode**: Let the system calculate criticality from the interfaces that use each connection -- it saves effort and stays current as interfaces change.
  - **Link to interfaces**: Connecting your infrastructure to interface bindings gives you end-to-end traceability from application data flows down to network routes.
  - **Document protocols accurately**: Good protocol data makes firewall rule reviews and security audits significantly easier.
