# IT Landscape Settings

Metadata
- Purpose: Document tenant-scoped settings for the IT Landscape workspace
- Audience: Engineers, QA, product
- Status: draft
- Last Updated: 2026-02-25

## Overview

IT Landscape Settings let each tenant configure the enum-like values used across the IT workspace:

- **Access Methods** – methods by which users access applications (e.g., Web, Mobile, VDI, Terminal).
- **Application Categories** – categories that describe the primary purpose of each application or service.
- **Data Classes** – sensitivity levels for Applications and Interfaces.
- **Network Segments** – network zones used by Servers (e.g., LAN, DMZ, WiFi, Public Cloud).
- **Entities** – source/target entities for flows or connectivity (e.g., Internal Users, Internet, Partner Networks), including optional `graph_tier` for Connection Map placement.
- **Server Types** – types of infrastructure assets in the Servers workspace.
- **Server Roles** – roles assigned when linking Servers to Applications (e.g., Web, Database, Backup), including optional `graph_tier` for Connection Map placement.
- **Hosting Types** – configurable Location hosting models (e.g., On‑prem, Colocation, Public Cloud, SaaS) with a category flag that drives UI + backend validation.
- **Cloud Providers** – hosting providers for servers and Locations (cloud vendors + "other").
- **Interface Protocols** – allowed protocols for Interface Bindings.
- **Connection Types** – two-level catalog (category + entry) with typical ports for connectivity patterns. These codes are the source of truth for the **Protocols** field in the IT Connections workspace, and the **Typical ports** values are displayed under the protocol selector when editing a Connection.
- **Connection risk defaults** – Connection risk fields (`criticality`, `data_class`, `contains_pii`, `risk_mode`) rely on Data Classes and Lifecycle from these settings; validation rejects codes outside the tenant's catalogs.
- **Lifecycle statuses** – shared lifecycle states for Applications, App Instances, Interfaces, Interface Bindings, and Servers.
- **Operating Systems** – catalog of OS options with standard/extended support end dates; feeds the Server Technical tab selector.
- **Subnets** – per-location subnet definitions with CIDR, optional VLAN number, network zone reference, and description. Used to auto-populate network information on Assets.
- **Domains** – Active Directory or DNS domain catalog with DNS suffixes. Used to compute FQDNs for Assets. Includes locked system entries for Workgroup and N/A.

These settings are stored in `tenants.metadata.it_ops` and drive both frontend dropdowns and backend validation. They are tenant-scoped and respect the existing RLS and tenant-deletion patterns.

### Application classification catalog (V1)

The same tenant metadata also contains `businessCriticalityLevels`, `cyberCriticalityLevels`, `dataClasses` and `recoveryWaves`. Level entries contain `code`, `label`, `description`, `rank`, and `deprecated`; business entries add a nullable `maxMtdMinutes` that documents the level (it is not an application field), while recovery waves use `order`.

Array order is the contract: levels are written most-severe-first and waves in restoration order; `validateClassificationCatalog` ignores incoming `rank`/`order` and assigns them from the position, and `catalogFromMetadata` sorts on read so tenants stored in an older order display consistently. Labels must be unique within a catalog (import and the API accept either code or label). `GET /applications/classification-catalog` exposes the catalog to application readers; IT Ops settings reads include it.

Saving the catalog never rewrites an application: levels are referenced by stable code, so renaming, reordering or changing a downtime leaves every application on the same level and does not touch reviews. Used codes cannot be removed (`assertClassificationUsage` checks applications, interfaces and connections); deprecate them instead. Obsolete metadata keys from earlier builds (`business_mtd_presets`, `classification_versions`, `classification_settings_revision`, `classification_anomalies`) are dropped on the next settings write.

A review is an explicit action requiring business criticality, cyber, confidentiality, recovery wave, and justification; it stores the server actor/date and the application revision. Recovery references use the existing Knowledge section and existing Relations links; no duplicate recovery-link store is created.

## Data Model

Settings are kept inside `Tenant.metadata` rather than a separate table:

```ts
// tenants.metadata.it_ops
type ItOpsEnumOption = {
  code: string;        // canonical value persisted in DB
  label: string;       // human label shown in the UI
  builtin?: boolean;   // true for KANAP defaults
  deprecated?: boolean;// true = do not use for new records
  locked?: boolean;    // true = code cannot be changed/deleted
  category?: string;   // Hosting Types use 'on_prem' | 'cloud'; free-form for Connection Types
};

type GraphTier = 'top' | 'upper' | 'center' | 'lower' | 'bottom';

type EntityOption = ItOpsEnumOption & {
  graph_tier?: GraphTier; // vertical placement hint for Connection Map nodes
};

type ServerRoleOption = ItOpsEnumOption & {
  graph_tier?: GraphTier; // vertical placement hint for servers linked with this role
};

type ItOpsSettings = {
  accessMethods: ItOpsEnumOption[];     // how users access applications
  applicationCategories: ItOpsEnumOption[];
  dataClasses: ItOpsEnumOption[];
  networkSegments: ItOpsEnumOption[];
  entities: EntityOption[];
  serverKinds: ItOpsEnumOption[];
  serverRoles: ServerRoleOption[];
  hostingTypes: ItOpsEnumOption[];
  serverProviders: ItOpsEnumOption[]; // exposed as Cloud Providers in the UI
  lifecycleStates: ItOpsEnumOption[];
  interfaceProtocols: ItOpsEnumOption[];
  connectionTypes: ConnectionTypeOption[];
  operatingSystems: OperatingSystemOption[];
  subnets: SubnetOption[];
  domains: DomainOption[];
  ipAddressTypes: ItOpsEnumOption[];  // types of IP addresses for assets
};

type OperatingSystemOption = ItOpsEnumOption & {
  standardSupportEnd?: string; // YYYY-MM-DD
  extendedSupportEnd?: string; // YYYY-MM-DD
};

type ConnectionTypeOption = ItOpsEnumOption & {
  typicalPorts?: string; // free text (e.g., "80, 443", "multiple", "5900+")
};

type SubnetOption = {
  location_id: string;    // Mandatory, references locations table
  cidr: string;           // e.g., "192.168.1.0/24" (mandatory)
  vlan_number?: number;   // Optional VLAN ID (1-4094)
  network_zone: string;   // Mandatory, references networkSegments code
  description?: string;   // Optional one-line description
  deprecated?: boolean;
};

type DomainOption = {
  code: string;           // Unique identifier (e.g., "corp-ad")
  label: string;          // Display name (e.g., "Corporate AD")
  dns_suffix: string;     // DNS suffix for FQDN computation (e.g., "corp.example.com")
  deprecated?: boolean;
  system?: boolean;       // true for locked system entries (Workgroup, N/A)
};
```

Defaults are applied in memory when reading settings:

- **Access Methods** (builtin, tenant-editable):
  - `web` _(Web)_, `local` _(Locally installed application)_, `mobile` _(Mobile application)_, `hmi` _(Proprietary HMI/industrial interface)_, `terminal` _(Terminal / CLI)_, `vdi` _(VDI / Remote Desktop)_, `kiosk` _(Kiosk)_
- **Application Categories** (builtin, tenant-editable):
  - `line_of_business`, `productivity`, `security`, `analytics`, `development`, `integration`, `infrastructure`
- **Data Classes** (builtin, locked):
  - `public`, `internal`, `confidential`, `restricted`
- **Network Zones** (formerly Network Segments):
  - `lan`, `dmz`, `industrial_lan`, `wifi`, `public_cloud`, `guest`, `management`, `storage`, `vpn`
- **Entities**:
  - Defaults are all `graph_tier: top`: `internal_users`, `external_users`, `internet`, `customers`, `partner_networks`
- **Server Types** (builtin, locked):
  - `physical_server`, `virtual_machine`, `container`, `serverless`, `appliance`, `other`
- **Server Roles** (builtin, locked, sorted alphabetically in the UI):
  - `top`: `web`, `proxy`
  - `upper`: `app`, `cloud-service`
  - `center`: `file`, `mail`, `monitoring`, `other`, `print`, `remote-desktop`
  - `lower`: `backup`, `domain-controller`, `virtualization`
  - `bottom`: `db`
- **Hosting Types** (builtin, locked — drives Locations UI/validation):
  - `on_prem` _(category: on_prem)_, `colocation` _(on_prem)_, `public_cloud` _(cloud)_, `private_cloud` _(cloud)_, `saas` _(cloud)_
- **Cloud Providers** (stored as `serverProviders`, builtin, locked):
  - `aws`, `azure`, `gcp`, `other`
- **Interface Protocols** (builtin, locked):
  - `http`, `https`, `ftp`, `sftp`, `smb`, `smtp`, `jdbc`, `odbc`, `amqp`, `ssh`, `other`
- **Connection Types** (builtin, tenant-editable, grouped by `category`; sorted by category then label):
  - Application: HTTP (`http`, 80), HTTPS (`https`, 443), WebSocket (`ws`, 80, 443), REST API (`rest`, 80, 443), SOAP (`soap`, 80, 443)
  - Database: SQL Server (TDS) (`mssql`, 1433), Oracle Net (`oracle`, 1521), MySQL (`mysql`, 3306), PostgreSQL (`pgsql`, 5432), MongoDB (`mongodb`, 27017), Redis (`redis`, 6379)
  - Authentication: LDAP (`ldap`, 389), LDAPS (`ldaps`, 636), Kerberos (`kerberos`, 88), RADIUS (`radius`, 1812, 1813), TACACS+ (`tacacs`, 49)
  - Remote Access: SSH (`ssh`, 22), RDP (`rdp`, 3389), VNC (`vnc`, 5900+), WinRM (`winrm`, 5985, 5986), Telnet (`telnet`, 23)
  - File Transfer: SFTP (`sftp`, 22), SCP (`scp`, 22), FTP (`ftp`, 21), FTPS (`ftps`, 990), TFTP (`tftp`, 69)
  - File Sharing: SMB / CIFS (`smb`, 445), NFS (`nfs`, 2049), DFS (`dfs`, 445)
  - Storage: iSCSI (`iscsi`, 3260), NDMP (`ndmp`, 10000)
  - Messaging: AMQP (`amqp`, 5672), MQTT (`mqtt`, 1883, 8883), Kafka (`kafka`, 9092), RabbitMQ (`rabbitmq`, 5672)
  - Email: SMTP (`smtp`, 25, 587), IMAP (`imap`, 143, 993), POP3 (`pop3`, 110, 995)
  - Monitoring: SNMP (`snmp`, 161, 162), Syslog (`syslog`, 514), WMI (`wmi`, 135 + dynamic), IPMI (`ipmi`, 623), Zabbix Agent (`zabbix`, 10050), Prometheus (`prometheus`, 9090+)
  - Network Services: DNS (`dns`, 53), NTP (`ntp`, 123), DHCP (`dhcp`, 67, 68), ICMP (`icmp`)
  - Replication: AD Replication (`ad-repl`, multiple), DFS-R (`dfsr`, 5722), SQL AlwaysOn (`sql-ag`, 5022), rsync (`rsync`, 873), DRBD (`drbd`, 7788)
  - VPN / Tunnel: IPSec (`ipsec`, 500, 4500), OpenVPN (`openvpn`, 1194), WireGuard (`wireguard`, 51820), SSL VPN (`sslvpn`, 443), GRE (`gre`)
  - Backup: Veeam (`veeam`, multiple), Commvault (`commvault`, 8400+), Bacula (`bacula`, 9101-9103)
  - Generic: TCP (custom) (`tcp`, specify), UDP (custom) (`udp`, specify), Other (`other`, specify), Unknown (`unknown`)
- **Lifecycle statuses** (builtin, locked):
  - `proposed`, `active`, `deprecated`, `retired`
- **Operating Systems** (builtin defaults, tenant-editable; stored in ISO, shown as DD/MM/YYYY):
  - Windows Server 2012 R2, 2016, 2019, 2022, 2025
  - Ubuntu 18.04/20.04/22.04/24.04 LTS
  - RHEL 7/8/9
  - Debian 10/11/12
  - SLES 12 SP5, 15 SP5/SP6/SP7
- **Subnets** (no defaults; tenant-defined):
  - Each subnet requires a location (references `locations` table), CIDR notation, and network zone.
  - Optional VLAN number (1-4094) and description.
  - Uniqueness: CIDR and VLAN numbers are unique per location (same values can exist at different locations).
- **Domains** (system entries locked; tenant-editable):
  - `workgroup` _(system, locked)_ – For standalone assets not joined to a domain; empty DNS suffix.
  - `n-a` _(system, locked)_ – For asset types where domain membership doesn't apply (e.g., network devices, racks); empty DNS suffix.
  - Tenants add custom domains with a code, label, and DNS suffix.
  - Used to compute FQDN on Assets: `{hostname}.{dns_suffix}` (or just hostname if dns_suffix is empty).
- **IP Address Types** (builtin defaults; tenant-editable):
  - `host` – Primary host IP address
  - `ipmi` – IPMI/BMC management interface
  - `management` – Dedicated management network interface
  - `iscsi` – iSCSI storage network interface
  - Assets can have multiple IP addresses, each with a type, IP, and optional subnet. Network zone and VLAN are derived from the subnet at display time.

Tenants can override labels and add new codes. Built‑in codes always exist and cannot be removed or renamed (only their display labels and, for some lists, `deprecated` flags can be changed).

### List interaction pattern (frontend)

- Each list has its own inline controls (top-right of the card): **Add item**, **Save changes**, **Reset**.
- **Add item** inserts a new row at the top of the table and focuses the first field. Users can add new categories (where applicable).
- Lists do **not resort while typing**; ordering is applied only when data is reloaded from the server (after Save or page load). Defaults are loaded sorted (label ASC; for Connection Types: category ASC, then label).
- **Save changes** sends a partial PATCH containing only that list, so other lists remain untouched.
- **Reset** restores that list to the last saved server state (not factory defaults).
- Each accordion header shows a short **usage hint** (e.g., “Servers / Technical tab”) so users know where the list is consumed.
- Per-row inputs are locally keyed (`localId`) to prevent focus loss and React remount churn; this pattern should be reused for new lists.
- Tiered lists (**Entities**, **Server Roles**) add a `Graph tier` select column (`top|upper|center|lower|bottom`).
  - New-row defaults: Entities -> `top`; Server Roles -> `center`.
  - Dirty detection explicitly compares `graph_tier` so tier-only edits enable Save.

## Frontend architecture (2025-12 refactor)

File: `frontend/src/pages/it/ItOperationsSettingsPage.tsx`

Key implementation details:
- **Reducer, not 15 states**: All lists live in a single `useReducer` state (`enums`, `operatingSystems`, `connectionTypes`, `dirty`, `pending`, `baseline`). Dirty is O(1) per list and saved separately.
- **Config-driven sections + grouping**: Lists are defined in `enumSections` (id, title, description, locked codes, kind, group, usage). Groups: Locations; Servers & Connections; Apps/Interfaces. Operating Systems and Connection Types are injected into the Servers & Connections group.
- **Specialized editors for tiered enums**: `kind: 'entity' | 'serverRole'` routes to `EntityEditor` / `ServerRoleEditor`, each rendering a `Graph tier` dropdown.
- **Usage hints in headers**: Each `ListSection` renders a caption line with `usage` text (e.g., “Connections / Protocol selector”).
- **Lazy mount per accordion**: `ListSection` renders its body only after the accordion is first expanded. All accordions start collapsed by default to keep initial render light.
- **Virtualized tables**: `useVirtualRows` enables row virtualization when length > threshold (25). Tables show ~20 visible rows (`maxHeight` derived from row height), with sticky headers and spacer rows. Threshold/row heights: enums (52px), operating systems (64px), connection types (60px). Disable by raising the threshold if needed.
- **Add-focus preservation**: Each list tracks `focusId` and uses `localId` keys; new rows still autofocus the first field even under virtualization.
- **Per-list save/reset**: Save still PATCHes only the active list; `pending` map drives the “Saving…” label per section.
- **Uniform add flow**: All lists, including Connection Types, create the new row in the parent reducer (no token handshakes), keeping children controlled-only.
- **Sorting/strip helpers**: Sorting and `localId` stripping happen in shared helpers; baseline is stored without `localId`, while UI state keeps it for stable keys.

Operational guidance:
- When adding a new list, reuse `withLocalIds`, `stripLocalIds`, `sortEnum` (or supply a sort fn), and add to `enumSections`.
- Keep row heights aligned with actual cell heights if table content changes; adjust `useVirtualRows` `rowHeight` accordingly to avoid scroll jumps.
- If you see focus glitches in virtual mode, temporarily disable virtualization by setting `threshold` higher than expected row counts.
- Build command: `cd frontend && npm run build` (runs `tsc -b` + Vite build). No repo-wide ESLint yet—match file style (2 spaces).

## Backend (NestJS)

### IT Ops Settings Module

- **Module**: `backend/src/it-ops-settings/it-ops-settings.module.ts`
  - Imports: `TypeOrmModule.forFeature([Tenant])`, `PermissionsModule`, `UsersModule`.
  - Providers: `ItOpsSettingsService`.
  - Controllers: `ItOpsSettingsController`.
  - Exports: `ItOpsSettingsService`.

- **Service**: `backend/src/it-ops-settings/it-ops-settings.service.ts`
  - Reads/writes `Tenant.metadata.it_ops` using the tenant-scoped `EntityManager`.
  - `getSettings(tenantId, opts?)`:
    - Loads the tenant via `manager.getRepository(Tenant).findOne({ where: { id: tenantId } })`.
    - Merges stored `it_ops` metadata with the defaults for each list.
  - `updateSettings(tenantId, patch, opts?)`:
    - Normalizes codes (lowercase, non‑empty) and labels (falls back to `code.toUpperCase()`).
    - Preserves built‑in `code`, `builtin`, and `locked` flags; allows overriding labels and `deprecated`.
    - Writes the updated arrays back to `tenant.metadata.it_ops` and saves the tenant.
  - Tiered enums (`entities`, `serverRoles`) use `normalizeTieredList(...)`:
    - Validates `graph_tier` against `top|upper|center|lower|bottom`.
    - Falls back to default tier by code (or `center` if unknown).
    - Follows regular list semantics (no forced reinsertion of removed defaults).
  - Hosting Types use a dedicated `normalizeHostingTypes` path that preserves/derives the `category` flag (`'on_prem'` vs `'cloud'`). When tenants forget to set the category, the service defaults `on_prem`/`colocation` to `'on_prem'` and treats everything else as `'cloud'`. Consumers (Locations, Servers) rely on this flag to decide which fields to show/clear.
  - The former “Server Providers” list remains exposed as `serverProviders` for backward compatibility, but defaults/labels now represent cloud providers only. The UI surfaces it as **Cloud Providers**, and backend validation still references `settings.serverProviders`.

> RLS / multi-tenancy: All operations use the tenant-scoped manager injected via `TenantInterceptor` (`req.queryRunner.manager`) and rely on `TenantInitGuard` to set `req.tenant`. No separate tenant tables are introduced; settings live in the shared `tenants` table.

### API Endpoints

- Controller: `backend/src/it-ops-settings/it-ops-settings.controller.ts`
- Base path: `/it-ops`

Endpoints:

1. `GET /it-ops/settings`
   - Guards: `JwtAuthGuard`, `PermissionGuard`, `@RequireLevel('settings', 'reader')`.
   - Uses `req.tenant.id` to resolve `tenantId`.
   - Returns the merged `ItOpsSettings` for the current tenant.

2. `PATCH /it-ops/settings`
   - Guards: `JwtAuthGuard`, `PermissionGuard`, `@RequireLevel('settings', 'admin')`.
   - Body shape (partial):
     ```json
     {
       \"dataClasses\": [{ \"code\": \"internal\", \"label\": \"Internal\", \"deprecated\": false }],
       \"entities\": [{ \"code\": \"internet\", \"label\": \"Internet\", \"graph_tier\": \"top\" }],
       \"serverKinds\": [{ \"code\": \"vm\", \"label\": \"Virtual machine\" }],
       \"serverRoles\": [{ \"code\": \"db\", \"label\": \"Database server\", \"graph_tier\": \"bottom\" }],
       \"serverProviders\": [{ \"code\": \"on_prem\", \"label\": \"On-prem\" }],
       \"interfaceProtocols\": [{ \"code\": \"http\", \"label\": \"HTTP\" }]
     }
     ```
   - Normalizes codes/labels and persists them via `ItOpsSettingsService.updateSettings`.
   - `graph_tier` accepted values: `top`, `upper`, `center`, `lower`, `bottom`.

### Connection Map Integration (Tiered Placement)

- The Connection Map backend reads `settings.serverRoles[].graph_tier` and `settings.entities[].graph_tier` to derive each node's vertical band.
- Server tiers are calculated from app assignments in the selected environment (`app_asset_assignments` joined with `app_instances` filtered by `environment`).
- Multi-role servers select the highest user-facing tier (`top < upper < center < lower < bottom`).
- Clusters inherit the best tier among member servers.
- Fallbacks are deterministic:
  - Unassigned servers/clusters -> `center`
  - Entities with missing/invalid tier -> `top`
- Result is returned via `GET /connections/map` in each node's `graph_tier`, so the frontend only consumes metadata and applies a soft placement force.

### Integration with IT Ops Entities

The settings drive validation for several tenant-scoped tables.

#### Servers

- Table: `servers` (unchanged schema in DB; `kind` and `provider` remain `text`).
- Entity: `backend/src/servers/server.entity.ts` (TS types widened to `string`).
- Service: `backend/src/servers/servers.service.ts`
  - Injects `ItOpsSettingsService`.
  - `create(body, tenantId, userId, opts?)`:
    - Validates `environment` via static list.
    - Calls `resolveKind(body.kind, tenantId, manager)` and `resolveProvider(body.provider, tenantId, manager)` to ensure codes exist in `settings.serverKinds` / `settings.serverProviders`.
    - Resolves `status` (lifecycle) via `settings.lifecycleStates`.
  - `update(id, body, tenantId, userId, opts?)`:
    - If `kind`/`provider`/`status` are present in the patch, re-validates them via the same helpers.
  - `list`:
    - Treats `kind`/`provider` filters as raw codes; it does not validate them, so filtering by a non-existent code safely returns zero rows.
- Controller: `backend/src/servers/servers.controller.ts`
  - `POST /servers`, `PATCH /servers/:id` pass `req.tenant.id` down to `ServersService`.

#### Applications & App Instances

- **Applications Service** (`backend/src/applications/applications.service.ts`)
  - Injects `ItOpsSettingsService`.
  - Validates `application.lifecycle` against `settings.lifecycleStates` in `create`, `update`, and CSV import flows.
- **App Instances Service** (`backend/src/app-instances/app-instances.service.ts`)
  - Injects `ItOpsSettingsService`.
  - Normalizes `app_instances.lifecycle` via `settings.lifecycleStates` and maps the `retired` lifecycle to a disabled status.

#### Interfaces

- Table: `interfaces` (DB schema unchanged; `data_class` remains `text`).
- Entity: `backend/src/interfaces/interface.entity.ts` (TS type widened to `string`).
- Service: `backend/src/interfaces/interfaces.service.ts`
  - Injects `ItOpsSettingsService`.
  - `normalizeDataClass(value, tenantId, manager?)`:
    - Ensures the code is non-empty and present in `settings.dataClasses`.
  - `create` / `update` also normalize `lifecycle` against `settings.lifecycleStates`.
  - `create(body, tenantId, userId, opts?)`:
    - Uses `normalizeDataClass(body.data_class ?? 'internal', tenantId, manager)`.
  - `update(id, body, tenantId, userId, opts?)`:
    - Applies `normalizeDataClass` only when `data_class` is present in the patch; otherwise leaves the existing value unchanged.
- Controller: `backend/src/interfaces/interfaces.controller.ts`
  - `POST/PATCH /interfaces` resolve `tenantId` from `req.tenant.id` and pass it into the service.

#### Interface Bindings

- Table: `interface_bindings` (DB schema unchanged; `protocol` remains `text`).
- Entity: `backend/src/interface-bindings/interface-binding.entity.ts` (TS type widened to `string`).
- Service: `backend/src/interface-bindings/interface-bindings.service.ts`
  - Injects `ItOpsSettingsService`.
  - `normalizeProtocol(value, tenantId, manager?)`:
    - Ensures a non-empty code present in `settings.interfaceProtocols`.
  - `create` / `update` normalize the binding `status` against `settings.lifecycleStates`.
  - `create(interfaceId, payload, tenantId, userId, opts?)`:
    - Uses `normalizeProtocol(payload.protocol ?? 'http', tenantId, manager)` when constructing the binding.
  - `update(bindingId, payload, tenantId, userId, opts?)`:
    - Re-validates `payload.protocol` if present.
- Controller: `backend/src/interface-bindings/interface-bindings.controller.ts`
  - `POST /interfaces/:interfaceId/bindings` and `PATCH /interface-bindings/:bindingId` now include `tenantId` from `req.tenant.id`.

> Tenant deletion: No new tenant-scoped tables are introduced. IT Ops settings live in `Tenant.metadata` so the existing purge order in `AdminTenantsService.purgeTenantData` remains valid. Tables that rely on these settings (`servers`, `interfaces`, `interface_bindings`) are already purged via `DELETE … WHERE tenant_id = app_current_tenant()`.

## Frontend (Web)

### Path and Navigation

- Workspace: **IT Landscape**.
- Route: `/it/settings`.
- Component: `frontend/src/pages/it/ItOperationsSettingsPage.tsx`.
- Drawer entry (IT workspace):
  - Label: **Settings**
  - Icon: `SettingsIcon`
  - Resource: `settings` (requires `settings:reader` to see; `settings:admin` to change values).

### Page Layout (current)

- `PageHeader title="IT Landscape Settings"` + short intro.
- Sections are accordions; only the first is expanded by default. Bodies lazy-mount on first open to cut initial render time.
- Per-section controls (top-right): **Add item**, **Save changes**, **Reset** — act only on that list and PATCH a partial payload.
- Editors:
  - Standard enums: Label, Code, Deprecated, Actions.
  - Tiered enums (Entities, Server Roles): Label, Code, Graph tier, Deprecated, Actions.
  - Hosting Types: Label, Code, Category (On‑prem/Colocation vs Cloud/SaaS), Deprecated, Actions.
  - Operating Systems: Name, Code, Standard Support, Extended Support, Deprecated, Actions.
  - Connection Types: Category, Label, Code, Typical ports, Deprecated, Actions.
  - Subnets: Location, CIDR, VLAN, Network Zone, Description, Deprecated, Actions.
  - Domains: Name, Code, DNS Suffix, Deprecated, Actions. System entries (Workgroup, N/A) show "System" badge and are read-only.
- Add inserts a top row and focuses the first field (works with virtualization).
- Sorting occurs on save/load (label ASC; Connection Types sort by category then label).
- Deprecated values are hidden for new selections but preserved for existing records across the app.
- Section order in UI (grouped and sorted alphabetically within groups):
  - **Locations group**: Cloud Providers, Hosting Types
  - **Servers & Connections group**: Server Roles, Asset Types, Connection Types, Domains, Entities, IP Address Types, Network Zones, Operating Systems, Subnets
  - **Apps/Interfaces group**: Access Methods, Application Categories, Data Classes, Integration Patterns, Interface Auth Modes, Interface Data Categories, Interface Data Formats, Interface Protocols, Interface Trigger Types, Lifecycle Statuses
- Virtualized tables: turn on when a list has >25 rows. Scroll area shows ~20 visible rows with sticky headers; spacer rows preserve total height.

### Consumers

These settings feed into the IT workspace forms and lists.

- **Applications Workspace** (`ApplicationWorkspacePage.tsx`)
  - Technical & Support tab's "Access Methods" field uses `settings.accessMethods`:
    - New values: only non-deprecated options.
    - Existing values: always include current codes, even if deprecated, with "(deprecated)" suffix.
  - Compliance tab's "Data Class" field uses `settings.dataClasses`:
    - New values: only non-deprecated options.
    - Existing values: always include the current code, even if deprecated or removed from defaults.
  - The Overview tab's Lifecycle selector reads from `settings.lifecycleStates` (current value is preserved even if deprecated or removed).
- **Interfaces Workspace** (`InterfaceWorkspacePage.tsx`)
  - “Data Class” field uses the same list + rules.
- **Applications Grid** (`ApplicationsPage.tsx`)
  - Data Class column uses settings labels via `labelFor('dataClass', code)` instead of hard-coded mappings.
- **Assets Workspace** (`AssetWorkspacePage.tsx`)
  - Asset type/Provider selects use `settings.serverKinds` / `settings.serverProviders`.
  - Technical tab → Identity section:
    - **Hostname**: Free text input; required when a domain (other than Workgroup/N/A) is selected.
    - **Domain** selector uses `settings.domains`. System entries (Workgroup, N/A) are always available.
    - **FQDN**: Read-only, auto-computed as `{hostname}.{domain.dns_suffix}` (or just hostname if dns_suffix is empty).
    - **Aliases**: Chip-style multi-entry using MUI Autocomplete; stored as `text[]` array on the asset.
  - Technical tab → IP Addresses section:
    - Multiple IP addresses supported, each with its own type, IP, and subnet.
    - **Type** dropdown uses `settings.ipAddressTypes` (e.g., Host, IPMI, Management, iSCSI).
    - **IP Address**: Free text input; validated to belong to the selected subnet when saving.
    - **Subnet** dropdown uses `settings.subnets` filtered by asset's location.
    - **Network Zone** and **VLAN**: Read-only, derived from the selected subnet.
    - "Add IP Address" button at top of the list adds new entries.
  - Operating System selector (Technical tab) uses `settings.operatingSystems` and shows support end dates in DD/MM/YYYY.
  - Deprecated options are hidden for new selections but shown (with a suffix) for existing values.
  - Lifecycle select uses `settings.lifecycleStates`.
- **Application Instances Editor** (`InstancesEditor.tsx`)
  - Instance lifecycle dropdowns use `settings.lifecycleStates`, showing deprecated values only when already selected to preserve legacy data.
- **Interface Bindings Matrix** (`InterfaceBindingsMatrix.tsx`)
  - Uses `settings.lifecycleStates` for per-environment binding statuses (fallback labels preserve legacy values).
  - Integration Tool selector filters applications to those with Data Integration / ETL enabled.

## Permissions

- Resource key: `settings`.
- IT Ops Settings page:
  - Visible when the user has `settings:reader`.
  - Editable when the user has `settings:admin` (backend enforces this on `PATCH /it-ops/settings`).

## Testing Notes

- Backend:
  - Add Supertest coverage for:
    - `GET /it-ops/settings` (returns defaults when metadata is empty).
    - `PATCH /it-ops/settings` (overrides labels/adds codes and persists them).
    - Servers/Interfaces/Bindings create/update flows rejecting invalid codes and accepting valid ones from metadata.
  - RLS:
    - Reuse the existing RLS test harness to confirm cross-tenant access isn’t possible (tenants can only see/edit their own settings and data).

- Frontend:
  - Storybook / component tests:
    - IT Ops Settings page with a mocked `GET /it-ops/settings` payload, verifying:
      - Built-in entries cannot be deleted or have codes changed.
      - Custom entries can be added and marked deprecated.
    - Forms (Applications, Interfaces, Servers, Interface Bindings) seeded with:
      - Custom data class, server kind/provider, and protocol codes to ensure legacy values still show and can be saved.
