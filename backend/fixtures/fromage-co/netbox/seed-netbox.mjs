#!/usr/bin/env node
// Netbox test inventory for the Fromage & Co demo tenant — idempotent runner.
//
// Seeds the local Netbox container (compose profile "netbox") with an
// inventory aligned on the Fromage & Co assets, plus the edge cases the KANAP
// Netbox sync has to handle. Every object is looked up before it is created,
// so a second run changes nothing.
//
// Usage:
//   node backend/fixtures/fromage-co/netbox/seed-netbox.mjs \
//     --url http://localhost:8084 \
//     --token 'nbt_kanapdevkey1.kanapdevnetboxtoken0123456789abcdefghijk'
//
// Scenarios:
//   --scenario=base   full inventory (default)
//   --scenario=drift  small set of changes, to run after a first KANAP sync
//
// See README.md for the case table.

const DEFAULTS = {
  url: 'http://localhost:8084',
  token: 'nbt_kanapdevkey1.kanapdevnetboxtoken0123456789abcdefghijk',
  scenario: 'base',
};

const argv = process.argv.slice(2);
const options = { ...DEFAULTS };

for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  const [flag, inlineValue] = arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, null];
  const value = () => inlineValue ?? argv[++i] ?? '';
  if (flag === '--url') options.url = value() || options.url;
  else if (flag === '--token') options.token = value() || options.token;
  else if (flag === '--scenario') options.scenario = value() || options.scenario;
  else throw new Error(`Unknown argument: ${arg}`);
}

options.url = options.url.replace(/\/$/, '');
if (!['base', 'drift'].includes(options.scenario)) {
  console.error(`[ERR]  Unknown scenario '${options.scenario}'. Use base or drift.`);
  process.exit(1);
}

const info = (message) => console.log(`[INFO] ${message}`);
const ok = (message) => console.log(`[OK]   ${message}`);
const warn = (message) => console.warn(`[WARN] ${message}`);

const stats = { created: 0, reused: 0, updated: 0, deleted: 0 };

// ── Netbox REST helpers ─────────────────────────────────────────────────────
// Netbox 4.7 issues v2 tokens. The value carries the `nbt_` prefix and Netbox
// infers the version from it, so `Token <value>` and `Bearer <value>` both
// authenticate. We send the documented `Token` form.

async function request(method, route, body) {
  const headers = { Accept: 'application/json', Authorization: `Token ${options.token}` };
  const init = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  const response = await fetch(`${options.url}/api${route}`, init);
  const text = await response.text();
  let payload = text;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    const details = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
    const error = new Error(`${method} /api${route} failed (${response.status})\n${details}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload === '' ? null : payload;
}

const nbGet = (route) => request('GET', route);
const nbPost = (route, body) => request('POST', route, body);
const nbPatch = (route, body) => request('PATCH', route, body);
const nbDelete = (route) => request('DELETE', route);

function query(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.append(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

async function findOne(path, params) {
  const payload = await nbGet(`${path}/${query({ ...params, limit: 2 })}`);
  return payload?.results?.[0] ?? null;
}

async function count(path) {
  const payload = await nbGet(`${path}/${query({ limit: 1, brief: 'true' })}`);
  return payload?.count ?? 0;
}

// Get-or-create. `lookup` must identify the object on its own, so a re-run
// finds what the previous run created instead of duplicating it.
// `restore` lists body fields to put back on an existing object, so the base
// scenario undoes what the drift scenario changed.
async function ensure(path, lookup, body, label, restore = []) {
  const existing = await findOne(path, lookup);
  if (existing) {
    const current = (value) => (value && typeof value === 'object' ? value.id ?? value.value : value) ?? null;
    const patch = Object.fromEntries(
      restore.filter((field) => current(existing[field]) !== (body[field] ?? null)).map((field) => [field, body[field]]),
    );
    if (Object.keys(patch).length > 0) {
      await nbPatch(`${path}/${existing.id}/`, patch);
      stats.updated += 1;
      ok(`Restored ${label}`);
      return { ...existing, ...patch };
    }
    stats.reused += 1;
    return existing;
  }
  const created = await nbPost(`${path}/`, body);
  stats.created += 1;
  ok(`Created ${label}`);
  return created;
}

// ── Reference data ──────────────────────────────────────────────────────────

const MANUFACTURERS = [
  { name: 'Dell', slug: 'dell' },
  { name: 'NetApp', slug: 'netapp' },
  { name: 'Fortinet', slug: 'fortinet' },
  { name: 'Cisco Meraki', slug: 'cisco-meraki' },
  { name: 'Synology', slug: 'synology' },
  { name: 'Schneider Electric', slug: 'schneider-electric' },
  { name: 'APC', slug: 'apc' },
  { name: 'Generic', slug: 'generic' },
];

const DEVICE_TYPES = [
  { manufacturer: 'dell', model: 'PowerEdge R750', slug: 'poweredge-r750', u_height: 2 },
  { manufacturer: 'dell', model: 'PowerEdge R640', slug: 'poweredge-r640', u_height: 1 },
  { manufacturer: 'dell', model: 'PowerEdge R650', slug: 'poweredge-r650', u_height: 1 },
  { manufacturer: 'netapp', model: 'FAS2750', slug: 'fas2750', u_height: 2 },
  { manufacturer: 'netapp', model: 'FAS2720', slug: 'fas2720', u_height: 2 },
  { manufacturer: 'fortinet', model: 'FortiGate 200F', slug: 'fortigate-200f', u_height: 1 },
  { manufacturer: 'fortinet', model: 'FortiGate 60F', slug: 'fortigate-60f', u_height: 1 },
  { manufacturer: 'fortinet', model: 'FortiGate 40F', slug: 'fortigate-40f', u_height: 1 },
  { manufacturer: 'cisco-meraki', model: 'MS250-48', slug: 'ms250-48', u_height: 1 },
  { manufacturer: 'cisco-meraki', model: 'MS250-24', slug: 'ms250-24', u_height: 1 },
  { manufacturer: 'cisco-meraki', model: 'MS210-24', slug: 'ms210-24', u_height: 1 },
  { manufacturer: 'cisco-meraki', model: 'MS120-8', slug: 'ms120-8', u_height: 1 },
  { manufacturer: 'cisco-meraki', model: 'MR46', slug: 'mr46', u_height: 0 },
  { manufacturer: 'synology', model: 'RS1221+', slug: 'rs1221-plus', u_height: 2 },
  { manufacturer: 'schneider-electric', model: 'EcoStruxure IoT Gateway', slug: 'ecostruxure-iot-gateway', u_height: 0 },
  { manufacturer: 'apc', model: 'AP8853 Rack PDU', slug: 'ap8853-rack-pdu', u_height: 0 },
  { manufacturer: 'generic', model: '24-port patch panel', slug: 'patch-panel-24', u_height: 1 },
];

// The last two roles stay unmapped in KANAP on purpose.
const DEVICE_ROLES = [
  { name: 'Server', slug: 'server', color: '2196f3' },
  { name: 'Storage', slug: 'storage', color: '9c27b0' },
  { name: 'Firewall', slug: 'firewall', color: 'f44336' },
  { name: 'Switch', slug: 'switch', color: '4caf50' },
  { name: 'Access point', slug: 'access-point', color: '00bcd4' },
  { name: 'IoT gateway', slug: 'iot-gateway', color: 'ff9800' },
  { name: 'Edge node', slug: 'edge-node', color: '795548' },
  { name: 'PDU', slug: 'pdu', color: '607d8b' },
  { name: 'Patch panel', slug: 'patch-panel', color: '9e9e9e' },
];

// The first five names match the on-prem KANAP locations exactly.
// Lyon Warehouse has no KANAP location, so it stays unmapped at first.
// There is no AWS site: the AWS-* KANAP assets must stay KANAP-only.
const SITES = [
  { name: 'Paris Data Center', slug: 'paris-data-center' },
  { name: 'Gouda Server Room', slug: 'gouda-server-room' },
  { name: 'Parma Server Room', slug: 'parma-server-room' },
  { name: 'Paris Cheese Caves', slug: 'paris-cheese-caves' },
  { name: 'New York Office', slug: 'new-york-office' },
  { name: 'Lyon Warehouse', slug: 'lyon-warehouse' },
];

const RACKS = [
  { name: 'PAR-R01', site: 'paris-data-center', u_height: 42 },
  { name: 'PAR-R02', site: 'paris-data-center', u_height: 42 },
  { name: 'GOU-R01', site: 'gouda-server-room', u_height: 42 },
];

// The Location tree the sub-location import is exercised against. Only the
// top-level ones become KANAP sub-locations: "Rangée A" and "Cage 3" exist to
// prove that equipment parked two levels down is attached to the top level
// above it, and are never imported themselves.
//
// "Local technique" is created BEFORE "local technique" on purpose: Netbox
// accepts both (its names are case-sensitive, KANAP's are not), and the two
// must resolve to one KANAP row. The lower Netbox id wins, so the order of
// this array is what makes the fixture deterministic.
const LOCATIONS = [
  { name: 'Salle serveurs', slug: 'salle-serveurs', site: 'paris-data-center' },
  { name: 'Rangée A', slug: 'rangee-a', site: 'paris-data-center', parent: 'Salle serveurs' },
  { name: 'Cage 3', slug: 'cage-3', site: 'paris-data-center', parent: 'Rangée A' },
  { name: 'Local technique', slug: 'local-technique', site: 'gouda-server-room' },
  { name: 'local technique', slug: 'local-technique-2', site: 'gouda-server-room' },
  { name: 'Atelier', slug: 'atelier', site: 'gouda-server-room' },
];

// Devices placed in a Location. Only rackless ones are listed: Netbox requires
// a device's rack to sit in the device's own location, so mounting a device
// somewhere new would move the whole rack with it.
//
// The sub-location cases get their own devices, so the numbers do not depend on
// an unrelated device's role being mapped or on a decision taken in an earlier
// preview. "Salle serveurs" therefore holds three of them plus PAR-SUB-04,
// parked in "Cage 3", which is attached to it on the way up: four assets.
//
// Every other device in the fixture stays without a Location, which is what
// proves an asset keeps the sub-location it already had.
const DEVICE_LOCATIONS = {
  // An existing KANAP asset, so one row is an update and shows the field-level
  // diff rather than being a plain creation.
  'PAR-APP-09': 'Salle serveurs',
  'PAR-SUB-01': 'Salle serveurs',
  'PAR-SUB-02': 'Salle serveurs',
  'PAR-SUB-03': 'Salle serveurs',
  'PAR-SUB-04': 'Cage 3',
  'GOU-SUB-01': 'Local technique',
  'GOU-SUB-02': 'local technique',
  'GOU-SUB-03': 'Atelier',
};

// The devices the sub-location cases are read on. Rackless and addressless, so
// they can sit in any Location, with a role the import maps.
const SUB_LOCATION_DEVICES = [
  { name: 'PAR-SUB-01', site: 'paris-data-center', role: 'server', type: 'poweredge-r650', serial: 'DELL-PAR-SUB01', platform: 'ubuntu-22-04-lts' },
  { name: 'PAR-SUB-02', site: 'paris-data-center', role: 'server', type: 'poweredge-r650', serial: 'DELL-PAR-SUB02', platform: 'ubuntu-22-04-lts' },
  { name: 'PAR-SUB-03', site: 'paris-data-center', role: 'server', type: 'poweredge-r650', serial: 'DELL-PAR-SUB03', platform: 'ubuntu-22-04-lts' },
  { name: 'PAR-SUB-04', site: 'paris-data-center', role: 'server', type: 'poweredge-r650', serial: 'DELL-PAR-SUB04', platform: 'ubuntu-22-04-lts' },
  { name: 'GOU-SUB-01', site: 'gouda-server-room', role: 'iot-gateway', type: 'ecostruxure-iot-gateway', serial: 'SCH-GOU-SUB01' },
  { name: 'GOU-SUB-02', site: 'gouda-server-room', role: 'iot-gateway', type: 'ecostruxure-iot-gateway', serial: 'SCH-GOU-SUB02' },
  { name: 'GOU-SUB-03', site: 'gouda-server-room', role: 'iot-gateway', type: 'ecostruxure-iot-gateway', serial: 'SCH-GOU-SUB03' },
];

// "NixOS 25.05" is deliberately absent from the KANAP OS catalog. "Ubuntu 24.04 LTS" is in
// it, and differs from what the demo tenant records for PAR-DB-01.
const PLATFORMS = [
  { name: 'VMware ESXi 8.0', slug: 'vmware-esxi-8-0' },
  { name: 'Ubuntu 22.04 LTS', slug: 'ubuntu-22-04-lts' },
  { name: 'Ubuntu 24.04 LTS', slug: 'ubuntu-24-04-lts' },
  { name: 'NixOS 25.05', slug: 'nixos-25-05' },
  { name: 'Windows Server 2022', slug: 'windows-server-2022' },
  { name: 'SUSE Linux Enterprise 15', slug: 'suse-linux-enterprise-15' },
  { name: 'FortiOS 7.4', slug: 'fortios-7-4' },
  { name: 'Cisco Meraki', slug: 'cisco-meraki' },
  { name: 'Schneider EcoStruxure', slug: 'schneider-ecostruxure' },
];

const CLUSTERS = [
  { name: 'Paris vSphere', site: 'paris-data-center' },
  { name: 'Gouda vSphere', site: 'gouda-server-room' },
  { name: 'Parma vSphere', site: 'parma-server-room' },
];

// Devices. `case` is only a comment for the README table.
// Racked devices carry a position; 0U devices are left unracked.
const DEVICES = [
  // Paris Data Center
  { name: 'PAR-ESX-01', site: 'paris-data-center', role: 'server', type: 'poweredge-r750', serial: 'DELL-PAR-ESX01', platform: 'vmware-esxi-8-0', rack: 'PAR-R01', position: 40, ip: '10.10.10.11/24' },
  { name: 'par-esx-02', site: 'paris-data-center', role: 'server', type: 'poweredge-r750', serial: 'DELL-PAR-ESX02', platform: 'vmware-esxi-8-0', rack: 'PAR-R01', position: 38, ip: '10.10.10.12/24' },
  { name: 'PAR-ESX-03', site: 'paris-data-center', role: 'server', type: 'poweredge-r640', serial: 'DELL-PAR-ESX03', platform: 'vmware-esxi-8-0', rack: 'PAR-R01', position: 36, ip: '10.10.10.13/24', status: 'decommissioning' },
  { name: 'PAR-ESX-04', site: 'paris-data-center', role: 'server', type: 'poweredge-r640', serial: 'DELL-PAR-ESX04', platform: 'vmware-esxi-8-0', rack: 'PAR-R01', position: 34, ip: '10.10.10.14/24' },
  { name: 'PAR-ESX-05', site: 'paris-data-center', role: 'server', type: 'poweredge-r650', serial: 'DELL-PAR-ESX05', platform: 'vmware-esxi-8-0', rack: 'PAR-R01', position: 32, ip: '10.10.10.15/24' },
  { name: null, site: 'paris-data-center', role: 'server', type: 'poweredge-r640', serial: 'DELL-PAR-SPARE01', rack: 'PAR-R01', position: 30, status: 'inventory' },
  { name: 'PAR-PP-01', site: 'paris-data-center', role: 'patch-panel', type: 'patch-panel-24', serial: 'GEN-PAR-PP01', rack: 'PAR-R01', position: 42 },
  { name: 'PAR-SAN-01', site: 'paris-data-center', role: 'storage', type: 'fas2750', serial: 'NTAP-PAR-SAN01', rack: 'PAR-R02', position: 20, ip: '10.10.10.21/24' },
  { name: 'PAR-SAN-02', site: 'paris-data-center', role: 'storage', type: 'fas2720', serial: 'NTAP-PAR-SAN02', rack: 'PAR-R02', position: 16, ip: '10.10.10.22/24' },
  { name: 'PAR-FW-01', site: 'paris-data-center', role: 'firewall', type: 'fortigate-200f', serial: 'FGT-PAR-FW01', platform: 'fortios-7-4', rack: 'PAR-R02', position: 42, ip: '10.10.10.1/24' },
  { name: 'PAR-FW-02', site: 'paris-data-center', role: 'firewall', type: 'fortigate-200f', serial: 'FGT-PAR-FW02', platform: 'fortios-7-4', rack: 'PAR-R02', position: 41, ip: '10.10.10.2/24' },
  { name: 'PAR-SW-01', site: 'paris-data-center', role: 'switch', type: 'ms250-48', serial: 'MRK-PAR-SW01', platform: 'cisco-meraki', rack: 'PAR-R02', position: 39, ip: '10.10.10.3/24' },
  { name: 'PAR-PDU-01', site: 'paris-data-center', role: 'pdu', type: 'ap8853-rack-pdu', serial: 'APC-PAR-PDU01' },
  { name: 'Badge reader entrance', site: 'paris-data-center', role: 'iot-gateway', type: 'ecostruxure-iot-gateway', serial: 'SCH-PAR-BADGE01', platform: 'schneider-ecostruxure', ip: '10.10.10.61/24' },
  // Already in KANAP under another name: SRV-COMPTA-OLD shares only the address, SRV-PAIE-OLD shares nothing.
  { name: 'PAR-APP-09', site: 'paris-data-center', role: 'server', type: 'poweredge-r650', serial: 'DELL-PAR-APP09', platform: 'ubuntu-22-04-lts', ip: '10.10.10.95/24' },
  { name: 'PAR-APP-10', site: 'paris-data-center', role: 'server', type: 'poweredge-r650', serial: 'DELL-PAR-APP10', platform: 'ubuntu-22-04-lts', ip: '10.10.10.96/24' },
  { name: 'PAR-DUP-A', site: 'paris-data-center', role: 'server', type: 'poweredge-r650', serial: 'DELL-PAR-DUPA', platform: 'ubuntu-22-04-lts', ip: '10.10.10.90/24' },
  { name: 'PAR-DUP-B', site: 'paris-data-center', role: 'server', type: 'poweredge-r650', serial: 'DELL-PAR-DUPB', platform: 'ubuntu-22-04-lts', ip: '10.10.10.90/24' },

  // Gouda Server Room
  { name: 'GOU-ESX-01', site: 'gouda-server-room', role: 'server', type: 'poweredge-r650', serial: 'DELL-GOU-ESX01', platform: 'vmware-esxi-8-0', rack: 'GOU-R01', position: 40, ip: '10.20.10.11/24' },
  { name: 'GOU-SYNO-01', site: 'gouda-server-room', role: 'storage', type: 'rs1221-plus', serial: 'SYN-GOU-NAS01', rack: 'GOU-R01', position: 20, ip: '10.20.10.21/24' },
  { name: 'GOU-FW-01', site: 'gouda-server-room', role: 'firewall', type: 'fortigate-60f', serial: 'FGT-GOU-FW01', platform: 'fortios-7-4', rack: 'GOU-R01', position: 42, ip: '10.20.10.1/24' },
  { name: 'GOU-SW-01', site: 'gouda-server-room', role: 'switch', type: 'ms250-48', serial: 'MRK-GOU-SW01', platform: 'cisco-meraki', rack: 'GOU-R01', position: 39, ip: '10.20.10.3/24' },

  // Parma Server Room
  { name: 'PRM-ESX-01', site: 'parma-server-room', role: 'server', type: 'poweredge-r650', serial: 'DELL-PRM-ESX01', platform: 'vmware-esxi-8-0', ip: '10.30.10.11/24' },
  { name: 'PRM-FW-01', site: 'parma-server-room', role: 'firewall', type: 'fortigate-60f', serial: 'FGT-PRM-FW01', platform: 'fortios-7-4', ip: '10.30.10.1/24' },
  { name: 'PRM-SW-01', site: 'parma-server-room', role: 'switch', type: 'ms250-24', serial: 'MRK-PRM-SW01', platform: 'cisco-meraki', ip: '10.30.10.3/24' },

  // Paris Cheese Caves
  { name: 'CAVE-GW-01', site: 'paris-cheese-caves', role: 'iot-gateway', type: 'ecostruxure-iot-gateway', serial: 'SCH-CAVE-GW01', platform: 'schneider-ecostruxure', ip: '10.40.10.11/24' },
  { name: 'CAVE-GW-02', site: 'paris-cheese-caves', role: 'iot-gateway', type: 'ecostruxure-iot-gateway', serial: 'SCH-CAVE-GW02', platform: 'schneider-ecostruxure', ip: '10.40.10.12/24' },
  { name: 'CAVE-EDGE-01', site: 'paris-cheese-caves', role: 'edge-node', type: 'poweredge-r640', serial: 'DELL-CAVE-EDGE01', platform: 'ubuntu-22-04-lts', ip: '10.40.10.21/24' },
  { name: 'CAVE-SW-01', site: 'paris-cheese-caves', role: 'switch', type: 'ms120-8', serial: 'MRK-CAVE-SW01', platform: 'cisco-meraki', ip: '10.40.10.3/24' },

  // New York Office
  { name: 'NYC-FW-01', site: 'new-york-office', role: 'firewall', type: 'fortigate-40f', serial: 'FGT-NYC-FW01', platform: 'fortios-7-4', ip: '10.50.10.1/24' },
  { name: 'NYC-SW-01', site: 'new-york-office', role: 'switch', type: 'ms210-24', serial: 'MRK-NYC-SW01', platform: 'cisco-meraki', ip: '10.50.10.3/24' },
  { name: 'NYC-AP-01', site: 'new-york-office', role: 'access-point', type: 'mr46', serial: 'MRK-NYC-AP01', platform: 'cisco-meraki', ip: '10.50.10.31/24' },

  // Lyon Warehouse (no KANAP location yet)
  { name: 'LYO-FW-01', site: 'lyon-warehouse', role: 'firewall', type: 'fortigate-60f', serial: 'FGT-LYO-FW01', platform: 'fortios-7-4', ip: '10.60.10.1/24' },
  { name: 'LYO-SW-01', site: 'lyon-warehouse', role: 'switch', type: 'ms250-24', serial: 'MRK-LYO-SW01', platform: 'cisco-meraki', ip: '10.60.10.3/24' },
  { name: 'LYO-NAS-01', site: 'lyon-warehouse', role: 'storage', type: 'rs1221-plus', serial: 'SYN-LYO-NAS01', ip: '10.60.10.21/24' },
];

const VIRTUAL_MACHINES = [
  { name: 'PAR-ERP-01', cluster: 'Paris vSphere', platform: 'suse-linux-enterprise-15', ip: '10.10.10.41/24' },
  { name: 'PAR-ERP-02', cluster: 'Paris vSphere', platform: 'suse-linux-enterprise-15', ip: '10.10.10.42/24' },
  { name: 'PAR-DB-01', cluster: 'Paris vSphere', platform: 'ubuntu-24-04-lts', ip: '10.10.10.43/24' },
  { name: 'PAR-APP-01', cluster: 'Paris vSphere', platform: 'ubuntu-22-04-lts', ip: '10.10.10.44/24' },
  { name: 'PAR-WEB-01', cluster: 'Paris vSphere', platform: 'nixos-25-05', ip: '10.10.10.45/24' },
  { name: 'PAR-MON-01', cluster: 'Paris vSphere', platform: 'windows-server-2022', ip: '10.10.10.46/24' },
  { name: 'PAR-AD-01', cluster: 'Paris vSphere', platform: 'windows-server-2022', ip: '10.10.10.47/24' },
  { name: 'PAR-LOG-01', cluster: 'Paris vSphere', platform: 'ubuntu-22-04-lts', ip: '10.10.10.48/24' },
  { name: 'PAR-CI-01', cluster: 'Paris vSphere', platform: 'ubuntu-22-04-lts', ip: '10.10.10.49/24' },
  // PAR-BKP-01 sits in Gouda on purpose: its KANAP location is Paris Data Center.
  { name: 'PAR-BKP-01', cluster: 'Gouda vSphere', platform: 'windows-server-2022', ip: '10.20.10.41/24' },
  { name: 'GOU-SAGE-01', cluster: 'Gouda vSphere', platform: 'windows-server-2022', ip: '10.20.10.42/24' },
  { name: 'PRM-SAGE-01', cluster: 'Parma vSphere', platform: 'windows-server-2022', ip: '10.30.10.42/24' },
];

// ── Base scenario ───────────────────────────────────────────────────────────

async function ensureIpOnInterface(address, objectType, objectId) {
  const payload = await nbGet(`/ipam/ip-addresses/${query({ address: address.split('/')[0], limit: 100 })}`);
  const existing = (payload?.results ?? []).find(
    (item) => item.assigned_object_type === objectType && item.assigned_object_id === objectId,
  );
  if (existing) {
    stats.reused += 1;
    return existing;
  }
  const created = await nbPost('/ipam/ip-addresses/', {
    address,
    status: 'active',
    assigned_object_type: objectType,
    assigned_object_id: objectId,
  });
  stats.created += 1;
  return created;
}

async function seedBase() {
  info('Seeding manufacturers');
  const manufacturerId = new Map();
  for (const item of MANUFACTURERS) {
    const row = await ensure('/dcim/manufacturers', { slug: item.slug }, item, `manufacturer ${item.name}`);
    manufacturerId.set(item.slug, row.id);
  }

  info('Seeding device types');
  const deviceTypeId = new Map();
  for (const item of DEVICE_TYPES) {
    const row = await ensure(
      '/dcim/device-types',
      { slug: item.slug },
      { manufacturer: manufacturerId.get(item.manufacturer), model: item.model, slug: item.slug, u_height: item.u_height },
      `device type ${item.model}`,
    );
    deviceTypeId.set(item.slug, row.id);
  }

  info('Seeding device roles');
  const roleId = new Map();
  for (const item of DEVICE_ROLES) {
    const row = await ensure('/dcim/device-roles', { slug: item.slug }, item, `device role ${item.name}`);
    roleId.set(item.slug, row.id);
  }

  info('Seeding sites');
  const siteId = new Map();
  for (const item of SITES) {
    const row = await ensure('/dcim/sites', { slug: item.slug }, { ...item, status: 'active' }, `site ${item.name}`);
    siteId.set(item.slug, row.id);
  }

  info('Seeding locations');
  const locationId = new Map();
  // Two passes: a parent always exists before the child that names it.
  for (const pass of [0, 1]) {
    for (const item of LOCATIONS) {
      if ((item.parent ? 1 : 0) !== pass) continue;
      const row = await ensure(
        '/dcim/locations',
        { name: item.name, site_id: siteId.get(item.site) },
        {
          name: item.name,
          slug: item.slug,
          site: siteId.get(item.site),
          status: 'active',
          ...(item.parent ? { parent: locationId.get(item.parent) } : {}),
        },
        `location ${item.name}`,
        ['name'],
      );
      locationId.set(item.name, row.id);
    }
  }

  info('Seeding racks');
  const rackId = new Map();
  for (const item of RACKS) {
    const row = await ensure(
      '/dcim/racks',
      { name: item.name, site_id: siteId.get(item.site) },
      { name: item.name, site: siteId.get(item.site), u_height: item.u_height, status: 'active' },
      `rack ${item.name}`,
    );
    rackId.set(item.name, row.id);
  }

  info('Seeding platforms');
  const platformId = new Map();
  for (const item of PLATFORMS) {
    const row = await ensure('/dcim/platforms', { slug: item.slug }, item, `platform ${item.name}`);
    platformId.set(item.slug, row.id);
  }

  info('Seeding clusters');
  const clusterType = await ensure(
    '/virtualization/cluster-types',
    { slug: 'vmware-vsphere' },
    { name: 'VMware vSphere', slug: 'vmware-vsphere' },
    'cluster type VMware vSphere',
  );
  const clusterId = new Map();
  for (const item of CLUSTERS) {
    const row = await ensure(
      '/virtualization/clusters',
      { name: item.name },
      { name: item.name, type: clusterType.id, status: 'active', scope_type: 'dcim.site', scope_id: siteId.get(item.site) },
      `cluster ${item.name}`,
    );
    clusterId.set(item.name, row.id);
  }

  info('Seeding devices');
  for (const item of [...DEVICES, ...SUB_LOCATION_DEVICES]) {
    // Serials are unique in this fixture, so they identify a device even after
    // the drift scenario renames one.
    // The drift scenario also changes one serial, so fall back to the name.
    const byName = { name: item.name, site_id: siteId.get(item.site) };
    const foundBySerial = item.serial ? await findOne('/dcim/devices', { serial: item.serial }) : null;
    const lookup = foundBySerial || !item.name ? { serial: item.serial } : byName;
    const body = {
      name: item.name ?? null,
      role: roleId.get(item.role),
      device_type: deviceTypeId.get(item.type),
      site: siteId.get(item.site),
      serial: item.serial ?? '',
      status: item.status ?? 'active',
      platform: item.platform ? platformId.get(item.platform) : null,
      rack: item.rack ? rackId.get(item.rack) : null,
      position: item.position ?? null,
      face: item.position ? 'front' : null,
      location: DEVICE_LOCATIONS[item.name] ? locationId.get(DEVICE_LOCATIONS[item.name]) : null,
    };
    const device = await ensure(
      '/dcim/devices',
      lookup,
      body,
      `device ${item.name ?? '(unnamed)'}`,
      ['name', 'serial', 'status', 'platform', 'location'],
    );
    if (!item.ip) continue;

    const iface = await ensure(
      '/dcim/interfaces',
      { device_id: device.id, name: 'mgmt' },
      { device: device.id, name: 'mgmt', type: '1000base-t' },
      `interface mgmt on ${item.name ?? '(unnamed)'}`,
    );
    const ip = await ensureIpOnInterface(item.ip, 'dcim.interface', iface.id);
    if (device.primary_ip4?.id !== ip.id) {
      await nbPatch(`/dcim/devices/${device.id}/`, { primary_ip4: ip.id });
      stats.updated += 1;
    }
  }

  info('Seeding virtual machines');
  for (const item of VIRTUAL_MACHINES) {
    const vm = await ensure(
      '/virtualization/virtual-machines',
      { name: item.name },
      {
        name: item.name,
        cluster: clusterId.get(item.cluster),
        status: 'active',
        platform: item.platform ? platformId.get(item.platform) : null,
      },
      `virtual machine ${item.name}`,
      ['status', 'platform'],
    );
    if (!item.ip) continue;

    const iface = await ensure(
      '/virtualization/interfaces',
      { virtual_machine_id: vm.id, name: 'eth0' },
      { virtual_machine: vm.id, name: 'eth0' },
      `interface eth0 on ${item.name}`,
    );
    const ip = await ensureIpOnInterface(item.ip, 'virtualization.vminterface', iface.id);
    if (vm.primary_ip4?.id !== ip.id) {
      await nbPatch(`/virtualization/virtual-machines/${vm.id}/`, { primary_ip4: ip.id });
      stats.updated += 1;
    }
  }
}

// ── Drift scenario ──────────────────────────────────────────────────────────
// Run after a first KANAP sync, to exercise the automatic sync.

const DRIFT = {
  deleteSerial: 'SCH-CAVE-GW02',
  // Renaming a Location must rename the KANAP sub-location in place, for every
  // asset that carries it, without any asset moving.
  renameLocation: { from: 'Salle serveurs', to: 'Salle serveurs A' },
  newSerial: { serial: 'NTAP-PAR-SAN01', value: 'NTAP-PAR-SAN01-RMA' },
  rename: { serial: 'DELL-PAR-ESX04', from: 'PAR-ESX-04', to: 'PAR-ESX-04R' },
  status: { serial: 'DELL-GOU-ESX01', value: 'decommissioning' },
  added: { name: 'PAR-ESX-06', site: 'paris-data-center', role: 'server', type: 'poweredge-r650', serial: 'DELL-PAR-ESX06', platform: 'vmware-esxi-8-0', ip: '10.10.10.16/24' },
};

async function seedDrift() {
  info('Applying drift changes');
  let changes = 0;

  const doomed = await findOne('/dcim/devices', { serial: DRIFT.deleteSerial });
  if (doomed) {
    await nbDelete(`/dcim/devices/${doomed.id}/`);
    stats.deleted += 1;
    changes += 1;
    ok(`Deleted device ${doomed.name} (${DRIFT.deleteSerial})`);
  } else {
    info(`Device ${DRIFT.deleteSerial} already deleted`);
  }

  const renamedLocation = await findOne('/dcim/locations', { name: DRIFT.renameLocation.from });
  if (renamedLocation) {
    await nbPatch(`/dcim/locations/${renamedLocation.id}/`, { name: DRIFT.renameLocation.to });
    stats.updated += 1;
    changes += 1;
    ok(`Renamed location ${DRIFT.renameLocation.from} to ${DRIFT.renameLocation.to}`);
  } else {
    info(`Location already named ${DRIFT.renameLocation.to}`);
  }

  const replaced = await findOne('/dcim/devices', { serial: DRIFT.newSerial.serial });
  if (replaced) {
    await nbPatch(`/dcim/devices/${replaced.id}/`, { serial: DRIFT.newSerial.value });
    stats.updated += 1;
    changes += 1;
    ok(`Changed serial of ${replaced.name} to ${DRIFT.newSerial.value}`);
  } else {
    info(`Serial already changed to ${DRIFT.newSerial.value}`);
  }

  const renamed = await findOne('/dcim/devices', { serial: DRIFT.rename.serial });
  if (renamed && renamed.name !== DRIFT.rename.to) {
    await nbPatch(`/dcim/devices/${renamed.id}/`, { name: DRIFT.rename.to });
    stats.updated += 1;
    changes += 1;
    ok(`Renamed ${renamed.name} to ${DRIFT.rename.to}`);
  } else {
    info(`Device already named ${DRIFT.rename.to}`);
  }

  const restatused = await findOne('/dcim/devices', { serial: DRIFT.status.serial });
  if (restatused && restatused.status?.value !== DRIFT.status.value) {
    await nbPatch(`/dcim/devices/${restatused.id}/`, { status: DRIFT.status.value });
    stats.updated += 1;
    changes += 1;
    ok(`Set ${restatused.name} to ${DRIFT.status.value}`);
  } else {
    info(`Device ${DRIFT.status.serial} already ${DRIFT.status.value}`);
  }

  const item = DRIFT.added;
  const site = await findOne('/dcim/sites', { slug: item.site });
  const role = await findOne('/dcim/device-roles', { slug: item.role });
  const type = await findOne('/dcim/device-types', { slug: item.type });
  const platform = await findOne('/dcim/platforms', { slug: item.platform });
  if (!site || !role || !type) {
    warn('Reference data is missing. Run the base scenario first.');
  } else {
    const before = stats.created;
    const device = await ensure(
      '/dcim/devices',
      { serial: item.serial },
      {
        name: item.name,
        role: role.id,
        device_type: type.id,
        site: site.id,
        serial: item.serial,
        status: 'active',
        platform: platform?.id ?? null,
      },
      `device ${item.name}`,
    );
    if (stats.created > before) changes += 1;
    else info(`Device ${item.name} already added`);

    const iface = await ensure(
      '/dcim/interfaces',
      { device_id: device.id, name: 'mgmt' },
      { device: device.id, name: 'mgmt', type: '1000base-t' },
      `interface mgmt on ${item.name}`,
    );
    const ip = await ensureIpOnInterface(item.ip, 'dcim.interface', iface.id);
    if (device.primary_ip4?.id !== ip.id) {
      await nbPatch(`/dcim/devices/${device.id}/`, { primary_ip4: ip.id });
      stats.updated += 1;
    }
  }

  ok(`Drift applied: ${changes} change(s) this run`);
}

// ── Summary ─────────────────────────────────────────────────────────────────

const COUNTED = [
  ['Sites', '/dcim/sites'],
  ['Racks', '/dcim/racks'],
  ['Manufacturers', '/dcim/manufacturers'],
  ['Device types', '/dcim/device-types'],
  ['Device roles', '/dcim/device-roles'],
  ['Platforms', '/dcim/platforms'],
  ['Devices', '/dcim/devices'],
  ['Device interfaces', '/dcim/interfaces'],
  ['Cluster types', '/virtualization/cluster-types'],
  ['Clusters', '/virtualization/clusters'],
  ['Virtual machines', '/virtualization/virtual-machines'],
  ['VM interfaces', '/virtualization/interfaces'],
  ['IP addresses', '/ipam/ip-addresses'],
];

async function printSummary() {
  info('Object counts');
  for (const [label, path] of COUNTED) {
    console.log(`       ${label.padEnd(20)} ${await count(path)}`);
  }
  ok(`Created ${stats.created}, reused ${stats.reused}, updated ${stats.updated}, deleted ${stats.deleted}`);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const status = await nbGet('/status/');
  ok(`Netbox ${status['netbox-version']} at ${options.url}`);

  if (options.scenario === 'base') await seedBase();
  else await seedDrift();

  await printSummary();
}

main().catch((error) => {
  console.error(`[ERR]  ${error.message}`);
  process.exit(1);
});
