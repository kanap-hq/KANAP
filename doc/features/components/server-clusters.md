# Server clusters (IT Ops Part B)

- **Mark clusters**: set `is_cluster = true` on a server (Servers workspace toggle or POST/PATCH `/servers`).
- **Membership**: use `GET /servers/:id/members` to view and `POST /servers/:id/members` with `server_ids: string[]` to replace members (only non-cluster hosts; `remove_operating_system: true` removes the cluster's operating system with the first members). A cluster with members cannot be switched back to a plain server, a member cannot become a cluster, and a cluster with members has no operating system (a cluster with no declared member may keep one). `GET /servers/:id/clusters` lists clusters that include a host.
- **Assignments**: app–server assignments now reject cluster servers with a 400 error; assign application instances to member hosts instead.
- **Connections & map**: connections may terminate on clusters or nodes. Connection Map renders clusters with a dashed outline and visually groups cluster members below their cluster using spatial forces. Subtle dashed lines connect clusters to members, and connections can link to either the cluster or individual member servers.
- **UI**: Servers grid and workspace highlight clusters; cluster workspace includes a Members table and edit dialog (autocomplete excludes clusters). Connection workspace labels cluster endpoints and shows hints when a cluster is selected.
