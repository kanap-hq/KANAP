# Netbox test inventory

A local Netbox instance seeded with an inventory aligned on the Fromage & Co demo tenant.
It exists to exercise the KANAP Netbox sync: matching, enrichment, ambiguity, and drift.

## Start Netbox

The Netbox services live in `infra/docker-compose.yml` behind the `netbox` profile, so they
never start with the usual dev stack.

```bash
docker compose -f infra/docker-compose.yml --profile netbox up -d netbox netbox-postgres netbox-redis
```

The first boot runs the database migrations and takes a few minutes. Wait for the container
to report healthy:

```bash
docker inspect -f '{{.State.Health.Status}}' kanap-netbox-1
```

| Access | Value |
| --- | --- |
| From the host | `http://localhost:8084` |
| From the `api` container | `http://netbox:8080` |
| Login | `admin` / `netboxdev` |
| API token | `nbt_kanapdevkey1.kanapdevnetboxtoken0123456789abcdefghijk` |
| Auth header | `Authorization: Token <token>` |

All of these are throwaway dev credentials. They are inlined in the compose file on purpose
and must never be reused anywhere else.

Netbox 4.7 issues version 2 tokens. The value carries the `nbt_` prefix and Netbox reads the
token version from that prefix, not from the keyword, so `Token <value>` and `Bearer <value>`
both authenticate. A value without the prefix is rejected.

The KANAP backend calls Netbox from the `api` container, so add `netbox` to `SSRF_ALLOWED_HOSTS`
in `backend/env.dev`.

## Seed the inventory

```bash
node backend/fixtures/fromage-co/netbox/seed-netbox.mjs
```

Options: `--url` (default `http://localhost:8084`), `--token`, `--scenario=base|drift`.

Every object is looked up before it is created, so the script can be run any number of times.
A second run reports `Created 0`.

## Drift

Run the drift scenario after a first KANAP sync, to exercise the automatic sync.

```bash
node backend/fixtures/fromage-co/netbox/seed-netbox.mjs --scenario=drift
```

It deletes `CAVE-GW-02`, changes the serial of `PAR-SAN-01`, renames `PAR-ESX-04` to
`PAR-ESX-04R`, renames the Location `Salle serveurs` to `Salle serveurs A`, sets `GOU-ESX-01` to
decommissioning, and adds `PAR-ESX-06`. It prints what it changed and is idempotent. Running the
base scenario afterwards restores the base state, including the Location name, except for the
deleted device which is recreated.

## Reset

```bash
docker compose -f infra/docker-compose.yml --profile netbox rm -sf netbox netbox-postgres netbox-redis
docker volume rm kanap_netbox-db-data kanap_netbox-redis-data kanap_netbox-media
```

Name the three services explicitly. A plain `down` would also stop the KANAP stack.
Then start the profile again and reseed.

## KANAP fixture side

`backend/fixtures/fromage-co/setup-tenant.mjs` sets hardware info on `GOU-NAS-01`, `PAR-SAN-02` and
`PRM-ESX-01`. With `--netbox-test-cases` it also creates a second asset named `NYC-SW-01`,
which the ambiguity case needs, and the assets `SRV-COMPTA-OLD` and `SRV-PAIE-OLD` for the two renamed-equipment cases. That flag is for dev tenants only, so the demo stays clean.
Re-run the fixture against the dev tenant to apply them.

## Case table

| Case | Netbox object | Expected KANAP result |
| --- | --- | --- |
| Identical match, hardware enrichment | Device `PAR-ESX-01`, site Paris Data Center, platform VMware ESXi 8.0, serial `DELL-PAR-ESX01`, rack PAR-R01 U40, IP 10.10.10.11 | Linked to asset `PAR-ESX-01`. Name, site and OS unchanged. Serial, manufacturer, model, rack, unit and IP filled in. |
| Match by hostname, name in a different case | Device `par-esx-02` | Linked to asset `PAR-ESX-02` through the FQDN `par-esx-02.fromage-co.local`. No rename. |
| Match by serial, different name | Device `GOU-SYNO-01`, serial `SYN-GOU-NAS01` | Linked to asset `GOU-NAS-01`, which carries that serial. Asset renamed to `GOU-SYNO-01`. |
| Serial already identical | Device `PAR-SAN-02`, serial `NTAP-PAR-SAN02` | Linked by serial. Nothing changes. |
| Stale serial and model | Device `PRM-ESX-01`, serial `DELL-PRM-ESX01`, model PowerEdge R650 | Matched by name. Serial and model overwritten (`OLD-PRM-ESX01`, R640 before). |
| OS differs | VM `PAR-DB-01`, platform Ubuntu 24.04 LTS | OS changes from Ubuntu 22.04 LTS to Ubuntu 24.04 LTS. |
| OS outside the catalog | VM `PAR-WEB-01`, platform NixOS 25.05 | Warning. The KANAP OS stays Ubuntu 22.04 LTS. Other fields applied. |
| Decommissioning status | Device `PAR-ESX-03`, status `decommissioning` | Asset status becomes `deprecated`. |
| Site differs from the KANAP location | VM `PAR-BKP-01` on the Gouda vSphere cluster | Location moves to Gouda Server Room. |
| Same IP address, nothing else in common | Device `PAR-APP-09`, 10.10.10.95 | Asset `SRV-COMPTA-OLD` holds that address. Never linked on its own and never created blindly: filed under "To decide" with that asset as the suggestion. |
| Renamed, nothing in common | Device `PAR-APP-10` | Planned as a new asset. In the preview, choose "Link to an existing asset" and pick `SRV-PAIE-OLD`: the row moves to the updates with its field changes, and nothing is created. |
| Ambiguous | Device `NYC-SW-01` | Two KANAP assets are named `NYC-SW-01`. Reported as ambiguous, never merged. |
| New devices | `PAR-ESX-05`, `PAR-SW-01`, `PAR-DUP-A`, `PAR-DUP-B` | Created as new assets. |
| New virtual machines | `PAR-LOG-01`, `PAR-CI-01` | Created as new assets. |
| Unmapped site | `LYO-FW-01`, `LYO-SW-01`, `LYO-NAS-01` in Lyon Warehouse | Ignored while the site has no mapping. Imported once Lyon Warehouse is mapped to a location. |
| Ignored roles | `PAR-PDU-01` (PDU), `PAR-PP-01` (patch panel) | Ignored. The roles stay unmapped. |
| Device with no name | Device with serial `DELL-PAR-SPARE01` | Skipped, reported as having no name. |
| Name that is not a valid hostname | Device `Badge reader entrance` | Asset created with that name and no hostname. |
| Duplicate primary IP | `PAR-DUP-A` and `PAR-DUP-B`, both 10.10.10.90/24 | Both assets created with the IP. See the note below. |
| Not in Netbox | Assets `AWS-EC2-BOUTIQUE`, `AWS-RDS-BOUTIQUE`, `AWS-ECS-API` | Untouched. Never reported as absent, since no Netbox object ever claimed them. |

## Sub-location case table

Netbox Locations under a mapped site become sub-locations of the mapped KANAP location. Only
the top-level ones: a device parked deeper is attached to the top-level Location above it.
None of these devices carries a rack or an address, so they can sit in any Location. Netbox
requires a device's rack to belong to the device's own Location, so moving a device into a
rack's Location moves every device in that rack with it. Only devices with a mapped role take part:
`PAR-PDU-01` and `PAR-PP-01` are skipped by the import, so they prove nothing in a sub-location case.

| Case | Netbox object | Expected KANAP result |
| --- | --- | --- |
| One Location, several devices | Location `Salle serveurs` (Paris Data Center), devices `PAR-SUB-01`, `PAR-SUB-02`, `PAR-SUB-03` | Created once. The preview lists `Salle serveurs · Paris Data Center · 5 assets`, counting the two cases below. |
| Existing asset gains a sub-location | Device `PAR-APP-09`, in `Salle serveurs` | Its asset already exists, so the row is an update and shows `Sub-location: — → Salle serveurs`. |
| Two levels down | Location `Cage 3`, under `Rangée A`, under `Salle serveurs`; device `PAR-SUB-04` | Attached to `Salle serveurs`, no warning. `Rangée A` and `Cage 3` are never imported. |
| A second site | Location `Local technique` (Gouda Server Room), device `GOU-SUB-01` | A second sub-location under Gouda Server Room. |
| Name clash inside one site | Location `local technique`, created after `Local technique`, device `GOU-SUB-02` | One `Local technique` sub-location, created from the Location with the lower Netbox id. The second is reported as a conflict and its device imports without a sub-location. |
| Adoption of a hand-made row | Location `Atelier`, device `GOU-SUB-03` | A sub-location created by hand at Gouda Server Room, whatever its spelling, is adopted: same row, renamed to the Netbox spelling, and marked Netbox. No duplicate. |
| Device with no Location | Every other device in the fixture | Its asset keeps the sub-location it already had. Add one by hand to check it survives a run. |
| Virtual machines | The whole `VIRTUAL_MACHINES` set | Never given a sub-location: a Netbox VM carries no Location. |
| Rename | Drift scenario renames `Salle serveurs` to `Salle serveurs A` | One `Renamed` line in the preview, no diff on any equipment row, and the sub-location is renamed in place. |

Note on the duplicate IP: KANAP rejects a duplicate only when the IP address and the subnet
both match, and the Fromage & Co tenant has no subnets configured. So with the fixture as it
stands, both devices import cleanly and the case does not trigger. It becomes live once a
subnet covering 10.10.10.0/24 is added to the tenant catalog.

`ENFORCE_GLOBAL_UNIQUE` is set to `false` on the Netbox container so it accepts the duplicate
address in the global table.

## Base inventory

| Object | Count |
| --- | --- |
| Sites | 6 |
| Locations | 6 (4 top-level, 2 nested) |
| Racks | 3 |
| Manufacturers | 8 |
| Device types | 17 |
| Device roles | 9 |
| Platforms | 8 |
| Devices | 35 |
| Device interfaces | 32 |
| Cluster types | 1 |
| Clusters | 3 |
| Virtual machines | 12 |
| VM interfaces | 12 |
| IP addresses | 44 |
