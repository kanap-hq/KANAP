import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { AddressInfo } from 'node:net';
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SchedulerRegistry } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import dataSource from '../../data-source';
import {
  ActivatedTenant,
  baselineSnapshot,
  buildServices,
  cleanupTenants,
  countDifferences,
  countTenantRows,
  createActivatedTenant,
  inTenant,
  runSpecs,
  Services,
} from '../../admin/tenants/__tests__/tenant-reset-test-helpers';
import { ensureCapexDimensions } from '../../analytics/capex-dimensions.seed';
import { RECOMMENDED_DIMENSIONS } from '../../analytics/recommended-dimensions.seed';
import { backendPath } from '../../common/__tests__/backend-root';
import { TENANT_RESETTING_CODE } from '../../common/tenancy/request-tenancy.middleware';
import { StorageService } from '../../common/storage/storage.service';
import { EmailService } from '../../email/email.service';
import { Features } from '../../config/features';
import { applyHttpMiddleware, applyTenancyAndPipeline } from '../../http-app';
import { DemoDataService, DemoDataState } from '../demo-data.service';

// The sample data load end to end: the whole application (AppModule with the HTTP wiring of
// main.ts, http-app.ts) listening on a local port, a trial tenant as activation leaves it, and
// the real loader (fixtures/fromage-co/setup-tenant.mjs --server-mode) calling the API over HTTP
// with the administrator's token and the tenant's Host. Then:
// - the load ends `loaded`, with the landscape (instances, interfaces, bindings, connections)
//   and the `.example` users of the data set, and no e-mail sent;
// - the tenant is French (activated from a French browser): its budget lines carry the
//   recommended dimensions in French ("Matériel" for the files' "Hardware"), no English value is
//   added next to them, and every line has a cost pool, an IT tower and a business domain;
//   business domain and budget reference are named in French too ("IT partagée" for "Shared IT");
// - every contact has the supplier and contact type of 09b-contact-suppliers.csv;
// - the loader's token is refused (401) on another tenant's host, accepted on its own;
// - the reset brings the tenant back to the state of activation, table by table;
// - a loader that fails half-way (an injected server error on the contracts import) ends
//   `failed`, the tenant back to the state of activation;
// - while a tenant is being reset its writes get 409 tenant_resetting, its reads go on, and
//   another tenant is not affected.
// And a workspace activated before the recommended dimensions (an unnamed, empty default
// dimension and the three required CAPEX dimensions) loads too: the cost pool goes on the default
// dimension, the investment type stands for the purpose, the PP&E type follows the cost pool.
// No storage or mail service is reached: both are doubles.

process.env.STRIPE_SECRET_KEY = '';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'demo-data-spec';
delete process.env.EMAIL_OVERRIDE;

const FIXTURES = backendPath('fixtures', 'fromage-co');

type FixtureAxis = { code: string; name: string; description: string; values: Array<{ key: string; name: string; description: string }> };

function fixtureDimensionsModule(): Promise<{ fixtureDimensions: (language: string) => FixtureAxis[] }> {
  // Compiled CommonJS cannot require() this ESM module. The import stays in a string.
  const importer = new Function('specifier', 'return import(specifier)') as (
    specifier: string,
  ) => Promise<{ fixtureDimensions: (language: string) => FixtureAxis[] }>;
  return importer(pathToFileURL(path.join(FIXTURES, 'fixture-dimensions.mjs')).href);
}

/**
 * Business domain and budget reference after the load: the dimension, its values and the
 * Paris data center line's business domain, in the tenant's language.
 */
async function assertOwnDimensions(tenantId: string, language: string) {
  const { fixtureDimensions } = await fixtureDimensionsModule();
  const expected = fixtureDimensions(language);
  const stored: Array<{ code: string; name: string; description: string; values: Array<{ name: string; description: string }> }> = await inTenant(tenantId, (m) => m.query(
    `SELECT a.code, a.name, a.description,
            coalesce(json_agg(json_build_object('name', c.name, 'description', c.description) ORDER BY c.sort_order, c.name)
              FILTER (WHERE c.id IS NOT NULL), '[]'::json) AS values
       FROM analytics_axes a
       LEFT JOIN analytics_categories c ON c.axis_id = a.id AND c.tenant_id = a.tenant_id
      WHERE a.tenant_id = $1 AND a.code IN ('business_domain', 'reference')
      GROUP BY a.id, a.code, a.name, a.description`, [tenantId]));
  for (const seed of expected) {
    const axis = stored.find((item) => item.code === seed.code);
    assert.ok(axis, `${seed.code} exists`);
    assert.equal(axis.name, seed.name, `${seed.code}: named in ${language}`);
    assert.equal(axis.description, seed.description, `${seed.code}: description in ${language}`);
    assert.deepEqual(
      axis.values,
      seed.values.map((value) => ({ name: value.name, description: value.description })),
      `${seed.code}: values in ${language}`,
    );
  }
  const shared = expected.find((axis) => axis.code === 'business_domain')!.values.find((value) => value.key === 'shared it')!;
  const [line] = await inTenant(tenantId, (m) => m.query(
    `SELECT c.name FROM spend_items s
       JOIN spend_item_analytics_values v ON v.item_id = s.id AND v.tenant_id = s.tenant_id
       JOIN analytics_axes a ON a.id = v.axis_id AND a.tenant_id = v.tenant_id AND a.code = 'business_domain'
       JOIN analytics_categories c ON c.id = v.category_id AND c.tenant_id = v.tenant_id
      WHERE s.tenant_id = $1 AND s.product_name = 'Paris data center — hosting and power'`, [tenantId]));
  assert.equal(line?.name, shared.name, `the file's "Shared IT", in ${language}`);
}

const INCIDENT_REVIEW_HEADINGS = ['Detailed description', 'Impact', 'Root cause', 'Corrective actions', 'Lessons learned'];
const REVIEWED_INCIDENTS = [
  'Cave B humidity readings lost overnight',
  'Phishing campaign against accounts payable',
  'SAP month-end close slowed down by host memory contention',
  'B2B portal down: database disk full',
  'Order confirmations sent to the wrong customers',
  'Lab results cannot be saved in QualityLab LIMS',
];
const B2B_INCIDENT = 'B2B portal down: database disk full';

/** Data rows of a fixture file (`;`-separated, no quoted line breaks in these files). */
function fixtureRows(name: string): string[] {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf8').split(/\r?\n/).slice(1).filter((line) => line.trim() !== '');
}

/** How many rows of a fixture file have a value in each `analytics:<code>` column (no `;` inside these cells). */
function fixtureDimensionCounts(name: string): Map<string, number> {
  const [header] = fs.readFileSync(path.join(FIXTURES, name), 'utf8').split(/\r?\n/, 1);
  const columns = header.split(';');
  const counts = new Map<string, number>();
  for (const line of fixtureRows(name)) {
    const cells = line.split(';');
    columns.forEach((column, index) => {
      if (!column.startsWith('analytics:')) return;
      const code = column.slice('analytics:'.length);
      counts.set(code, (counts.get(code) ?? 0) + (cells[index]?.trim() ? 1 : 0));
    });
  }
  return counts;
}

/**
 * The dimensions after the load: lines with a value per dimension and nature (printed), the
 * recommended dimensions in the tenant's language with no other value, the data set's own two
 * dimensions in that language too, and every line with a cost pool, an IT tower and a business domain.
 */
async function checkDimensions(tenantId: string) {
  const files = { opex: '14-spend-items.csv', capex: '15-capex-items.csv' } as const;
  const lines = await inTenant(tenantId, (m) => m.query(
    `SELECT nature, count(*)::int AS n FROM spend_items WHERE tenant_id = $1 GROUP BY nature`, [tenantId]));
  const total = Object.fromEntries(lines.map((row: any) => [row.nature, row.n])) as Record<'opex' | 'capex', number>;
  assert.deepEqual(total, { opex: fixtureRows(files.opex).length, capex: fixtureRows(files.capex).length }, 'every budget line of the files');

  const axes: Array<{ code: string; name: string; values: string[] }> = await inTenant(tenantId, (m) => m.query(
    `SELECT a.code, a.name, coalesce(array_agg(c.name ORDER BY c.sort_order, c.name) FILTER (WHERE c.id IS NOT NULL), '{}') AS values
       FROM analytics_axes a LEFT JOIN analytics_categories c ON c.axis_id = a.id AND c.tenant_id = a.tenant_id
      WHERE a.tenant_id = $1 GROUP BY a.id, a.code, a.name ORDER BY a.code`, [tenantId]));
  assert.deepEqual(axes.map((axis) => axis.code), ['business_domain', 'default', 'it_tower', 'priority', 'purpose', 'recurrence', 'reference'],
    'the recommended dimensions and the data set\'s own two; no cost type, PP&E type or investment type');
  for (const seed of RECOMMENDED_DIMENSIONS.fr) {
    const axis = axes.find((item) => item.code === (seed.key === 'cost_pool' ? 'default' : seed.code))!;
    assert.equal(axis.name, seed.name, `${seed.key}: named in French`);
    assert.deepEqual(axis.values, seed.values.map((value) => value.name), `${seed.key}: the French values only, none added by the load`);
  }
  await assertOwnDimensions(tenantId, 'fr');

  const rows: Array<{ code: string; nature: 'opex' | 'capex'; n: number }> = await inTenant(tenantId, (m) => m.query(
    `SELECT a.code, s.nature, count(*)::int AS n
       FROM spend_item_analytics_values v
       JOIN analytics_axes a ON a.id = v.axis_id AND a.tenant_id = v.tenant_id
       JOIN spend_items s ON s.id = v.item_id AND s.tenant_id = v.tenant_id
      WHERE v.tenant_id = $1
      GROUP BY a.code, s.nature`, [tenantId]));
  const actual = (code: string, nature: 'opex' | 'capex') => rows.find((row) => row.code === code && row.nature === nature)?.n ?? 0;
  const expected = { opex: fixtureDimensionCounts(files.opex), capex: fixtureDimensionCounts(files.capex) };
  console.log('demo-data.e2e: lines with a value / lines, per dimension');
  for (const axis of axes) {
    const cells = (['opex', 'capex'] as const).map((nature) => `${nature} ${actual(axis.code, nature)}/${total[nature]}`);
    console.log(`  ${axis.code.padEnd(16)} ${axis.name.padEnd(22)} ${cells.join('  ')}`);
    for (const nature of ['opex', 'capex'] as const) {
      assert.equal(actual(axis.code, nature), expected[nature].get(axis.code) ?? 0, `${axis.code}, ${nature}: the lines the file gives a value`);
    }
  }
  for (const code of ['default', 'it_tower', 'business_domain']) {
    for (const nature of ['opex', 'capex'] as const) assert.equal(actual(code, nature), total[nature], `${code}: every ${nature} line`);
  }
  for (const code of ['purpose', 'priority']) assert.equal(actual(code, 'capex'), total.capex, `${code}: every CAPEX line`);

  const [dataCenter] = await inTenant(tenantId, (m) => m.query(
    `SELECT c.name FROM spend_items s
       JOIN spend_item_analytics_values v ON v.item_id = s.id AND v.tenant_id = s.tenant_id
       JOIN analytics_axes a ON a.id = v.axis_id AND a.tenant_id = v.tenant_id AND a.is_default
       JOIN analytics_categories c ON c.id = v.category_id AND c.tenant_id = v.tenant_id
      WHERE s.tenant_id = $1 AND s.product_name = 'Paris data center — hosting and power'`, [tenantId]));
  assert.equal(dataCenter?.name, 'Locaux et énergie', 'the file\'s "Facilities and power", in French');
}

type Served = {
  app: INestApplication;
  port: number;
  demo: DemoDataService;
  delivered: Array<{ to: unknown; subject?: string }>;
  storage: { put: string[]; deleted: string[] };
  loaderEnvs: Array<Record<string, string>>;
};

/**
 * Every contact of the data set has the supplier and contact type of 09b-contact-suppliers.csv,
 * as its supplier and as its one primary supplier link, so each supplier lists its contacts.
 */
async function checkContactSuppliers(tenantId: string) {
  const expected = fixtureRows('09b-contact-suppliers.csv').map((line) => line.split(';').map((cell) => cell.trim()).join('|')).sort();
  assert.equal(expected.length, fixtureRows('09-contacts.csv').length, 'one supplier per contact of the data set');
  const rows: Array<{ first_name: string; last_name: string; supplier: string; role: string }> = await inTenant(tenantId, (m) => m.query(
    `SELECT c.first_name, c.last_name, s.name AS supplier, sc.role::text AS role
       FROM contacts c
       JOIN suppliers s ON s.tenant_id = c.tenant_id AND s.id = c.supplier_id
       JOIN supplier_contacts sc ON sc.tenant_id = c.tenant_id AND sc.contact_id = c.id AND sc.supplier_id = c.supplier_id AND sc.is_primary
      WHERE c.tenant_id = $1`, [tenantId]));
  assert.deepEqual(rows.map((r) => [r.first_name, r.last_name, r.supplier, r.role].join('|')).sort(), expected, 'contacts with their supplier and type');
  const contacts = await tenantCount(tenantId, `SELECT count(*) AS n FROM contacts WHERE tenant_id = $1`);
  const links = await tenantCount(tenantId, `SELECT count(*) AS n FROM supplier_contacts WHERE tenant_id = $1`);
  assert.deepEqual({ contacts, links }, { contacts: expected.length, links: expected.length }, 'one supplier link per contact');
}

const VMWARE_CLUSTER = 'PAR-VSPHERE-CL01';
const VMWARE_HOSTS = ['PAR-ESX-01', 'PAR-ESX-02', 'PAR-ESX-05'];
const VMWARE_VMS = [
  'PAR-ERP-01', 'PAR-ERP-02', 'PAR-AD-01', 'PAR-SQL-01', 'PAR-VCENTER-01',
  'PAR-DB-01', 'PAR-APP-01', 'PAR-WEB-01', 'PAR-AD-02', 'PAR-SQL-02',
  'PAR-MON-01', 'PAR-BKP-01',
];
const VMWARE_APPLICATIONS = [
  'SAP S/4HANA', 'SAP BW/4HANA', 'Fromage B2B Portal', 'QualityLab LIMS', 'CheeseTrack',
  'Sage X3', 'PRTG Network Monitor', 'Veeam Backup & Replication', 'VMware vSphere',
];
/** The name of the connection whose fixture ref is CONN-FROMAGE-005. */
const VMWARE_CONNECTION = 'Veeam backup of the vSphere cluster';

/**
 * The vSphere landscape the load leaves: one cluster of three hosts, the hosts on the shared
 * storage, the VMs carried by the cluster alone, the two isolated aging hosts, the vSphere server
 * rows and the Veeam connection. Then the impact of the array and of one host, the connection the
 * cluster members inherit, and the placement refusal of a host's `contains`.
 */
async function checkVmwareLandscape(port: number, tenantId: string, host: string, token: string) {
  const clusterId = await vmwareAssetId(tenantId, VMWARE_CLUSTER);
  const idOf = (name: string) => vmwareAssetId(tenantId, name);

  const members: Array<{ name: string }> = await inTenant(tenantId, (m) => m.query(
    `SELECT a.name
       FROM asset_cluster_members m
       JOIN assets a ON a.tenant_id = m.tenant_id AND a.id = m.asset_id
      WHERE m.tenant_id = $1 AND m.cluster_id = $2
      ORDER BY a.name`, [tenantId, clusterId]));
  assert.deepEqual(members.map((row) => row.name), VMWARE_HOSTS, 'the three hosts of the vSphere cluster');

  const relations: Array<{ source: string; type: string; target: string }> = await inTenant(tenantId, (m) => m.query(
    `SELECT s.name AS source, r.relation_type AS type, t.name AS target
       FROM asset_relations r
       JOIN assets s ON s.tenant_id = r.tenant_id AND s.id = r.asset_id
       JOIN assets t ON t.tenant_id = r.tenant_id AND t.id = r.related_asset_id
      WHERE r.tenant_id = $1
      ORDER BY s.name, r.relation_type, t.name`, [tenantId]));
  const contains = relations.filter((row) => row.type === 'contains');
  const dependsOn = relations.filter((row) => row.type === 'depends_on');
  assert.deepEqual(
    dependsOn.map((row) => `${row.source}|${row.target}`),
    VMWARE_HOSTS.map((name) => `${name}|PAR-SAN-01`),
    'each cluster host depends on the shared array; the aging hosts depend on nothing',
  );
  assert.deepEqual(
    contains.filter((row) => row.source === VMWARE_CLUSTER).map((row) => row.target),
    [...VMWARE_VMS].sort(),
    'the 12 VMs of the vSphere cluster are contained by the cluster',
  );
  for (const member of VMWARE_HOSTS) {
    assert.deepEqual(contains.filter((row) => row.source === member), [], `${member} contains no VM`);
  }
  assert.deepEqual(contains.filter((row) => row.source === 'PAR-ESX-03').map((row) => row.target), ['PAR-ETL-01']);
  assert.deepEqual(contains.filter((row) => row.source === 'PAR-ESX-04').map((row) => row.target), ['PAR-ERP-QA-01']);

  const doubles: Array<{ asset: string; containers: string[] }> = await inTenant(tenantId, (m) => m.query(
    `SELECT a.name AS asset, array_agg(c.name ORDER BY c.name) AS containers
       FROM asset_relations r
       JOIN assets c ON c.tenant_id = r.tenant_id AND c.id = r.asset_id AND c.status <> 'retired'
       JOIN assets a ON a.tenant_id = r.tenant_id AND a.id = r.related_asset_id
      WHERE r.tenant_id = $1 AND r.relation_type = 'contains'
      GROUP BY a.id, a.name
     HAVING count(*) > 1`, [tenantId]));
  assert.deepEqual(doubles, [], 'no asset of the tenant has two containers in service');

  const vsphereRows: Array<{ asset: string }> = await inTenant(tenantId, (m) => m.query(
    `SELECT a.name AS asset
       FROM app_asset_assignments x
       JOIN assets a ON a.tenant_id = x.tenant_id AND a.id = x.asset_id
       JOIN app_instances i ON i.tenant_id = x.tenant_id AND i.id = x.app_instance_id
       JOIN applications ap ON ap.tenant_id = i.tenant_id AND ap.id = i.application_id
      WHERE x.tenant_id = $1 AND ap.name = 'VMware vSphere'
      ORDER BY a.name`, [tenantId]));
  assert.deepEqual(
    vsphereRows.map((row) => row.asset),
    ['PAR-ESX-03', 'PAR-ESX-04', 'PAR-VCENTER-01', VMWARE_CLUSTER].sort(),
    'VMware vSphere runs on the cluster, the vCenter appliance and the two aging hosts, never on the cluster hosts',
  );

  const technologyRows: Array<{ asset: string; technology: string; version: string | null; operating_system: boolean }> = await inTenant(tenantId, (m) => m.query(
    `SELECT a.name AS asset, t.name AS technology, v.label AS version, x.is_operating_system AS operating_system
       FROM asset_technologies x
       JOIN assets a ON a.tenant_id = x.tenant_id AND a.id = x.asset_id
       JOIN technologies t ON t.tenant_id = x.tenant_id AND t.id = x.technology_id
       LEFT JOIN technology_versions v ON v.tenant_id = x.tenant_id AND v.id = x.technology_version_id
      WHERE x.tenant_id = $1 AND a.name = ANY($2::text[])
      ORDER BY a.name, t.name, version`, [tenantId, [...VMWARE_HOSTS, 'PAR-VCENTER-01']]));
  const installations = (name: string) => technologyRows
    .filter((row) => row.technology === name)
    .map((row) => `${row.asset}|${row.version ?? ''}|${row.operating_system}`);
  assert.deepEqual(
    installations('VMware vSphere'),
    ['PAR-VCENTER-01|8.0|false'],
    'VMware vSphere is a technology installed on the vCenter appliance only',
  );
  assert.deepEqual(
    installations('VMware ESXi'),
    VMWARE_HOSTS.map((name) => `${name}|8.0|true`),
    'the cluster hosts carry ESXi as their operating system',
  );

  const connectionRows: Array<{ source: string; destination: string }> = await inTenant(tenantId, (m) => m.query(
    `SELECT sa.name AS source, da.name AS destination
       FROM connections c
       LEFT JOIN assets sa ON sa.tenant_id = c.tenant_id AND sa.id = c.source_asset_id
       LEFT JOIN assets da ON da.tenant_id = c.tenant_id AND da.id = c.destination_asset_id
      WHERE c.tenant_id = $1 AND c.name = $2`, [tenantId, VMWARE_CONNECTION]));
  assert.deepEqual(connectionRows, [{ source: 'PAR-BKP-01', destination: VMWARE_CLUSTER }],
    'the Veeam connection links the backup server to the cluster');

  const impact = async (name: string) => {
    const answer = await request(port, { method: 'GET', path: `/assets/${await idOf(name)}/impact`, host, token });
    assert.equal(answer.status, 200, `impact of ${name}: ${JSON.stringify(answer.body)}`);
    return answer.body;
  };

  const san = await impact('PAR-SAN-01');
  assert.equal(san.totals.assets, 15, 'the three hosts and the 12 VMs fall with the array');
  assert.equal(san.totals.clusters, 2);
  assert.equal(san.totals.applications, VMWARE_APPLICATIONS.length);
  assert.deepEqual(
    san.clusters.map((row: any) => `${row.name}|${row.state}`).sort(),
    ['PAR-SQL-CL01|down', 'PAR-VSPHERE-CL01|down'],
    'both clusters lose every member',
  );
  const sanVsphere = san.clusters.find((row: any) => row.name === VMWARE_CLUSTER);
  assert.deepEqual([sanVsphere.members, sanVsphere.fallen_members], [3, 3]);
  assert.deepEqual(
    san.applications.map((row: any) => row.name).sort(),
    [...VMWARE_APPLICATIONS].sort(),
    'the applications of the 12 VMs and of the two clusters',
  );
  // The hosts carry ESXi, not vSphere: the array's fall now takes the vSphere installation with
  // the vCenter, which the cluster contains, and no longer with the three hosts.
  const esxiImpact = san.technologies.find((row: any) => row.name === 'VMware ESXi');
  assert.ok(esxiImpact, 'the fallen hosts still carry ESXi');
  assert.deepEqual(esxiImpact.via.map((row: any) => row.name).sort(), [...VMWARE_HOSTS].sort());
  const vsphereImpact = san.technologies.find((row: any) => row.name === 'VMware vSphere');
  assert.ok(vsphereImpact, 'the vCenter falls with the cluster and still carries vSphere');
  assert.deepEqual(
    vsphereImpact.via.map((row: any) => row.name),
    ['PAR-VCENTER-01'],
    'the vSphere installation falls with the vCenter only',
  );
  assert.deepEqual(
    san.assets.filter((row: any) => row.depth > 0).map((row: any) => row.name).sort(),
    [...VMWARE_HOSTS, ...VMWARE_VMS].sort(),
  );
  for (const name of ['PAR-ESX-03', 'PAR-ESX-04', 'PAR-ETL-01', 'PAR-ERP-QA-01']) {
    assert.ok(!san.assets.some((row: any) => row.name === name), `${name} stays out of the array impact`);
  }

  const esx = await impact('PAR-ESX-01');
  assert.equal(esx.totals.assets, 0, 'one host falling takes no VM: the cluster carries them');
  assert.equal(esx.clusters.length, 1);
  assert.deepEqual(
    esx.clusters.map((row: any) => `${row.name}|${row.state}|${row.members}|${row.fallen_members}`),
    [`${VMWARE_CLUSTER}|degraded|3|1`],
  );
  assert.deepEqual(esx.applications, [], 'no application runs on the host itself');

  const esx01 = await idOf('PAR-ESX-01');
  const byServer = await request(port, { method: 'GET', path: `/connections/by-server/${esx01}`, host, token });
  assert.equal(byServer.status, 200, JSON.stringify(byServer.body));
  const connection = (byServer.body.items as any[]).find((item) => item.name === VMWARE_CONNECTION);
  assert.ok(connection, 'the Veeam connection is on PAR-ESX-01 through its cluster');
  assert.equal(connection.inherited, true);
  assert.deepEqual(connection.via_clusters.map((via: any) => via.name), [VMWARE_CLUSTER]);

  const erp01 = await idOf('PAR-ERP-01');
  const refused = await request(port, {
    method: 'POST',
    path: `/assets/${esx01}/relations`,
    host,
    token,
    body: { relations: [{ related_asset_id: erp01, relation_type: 'contains' }] },
  });
  assert.equal(refused.status, 409, JSON.stringify(refused.body));
  assert.equal(refused.body.code, 'placement_inherited', 'a host cannot take a VM its cluster contains');
}

async function vmwareAssetId(tenantId: string, name: string): Promise<string> {
  const [row] = await inTenant(tenantId, (m) => m.query(
    `SELECT id FROM assets WHERE tenant_id = $1 AND name = $2`, [tenantId, name]));
  assert.ok(row?.id, `asset '${name}' exists`);
  return String(row.id);
}

const OLD_CLUSTER_NOTES = 'vSphere cluster of PAR-ESX-01 and PAR-ESX-02 — HA and DRS';
const OLD_SAN_NOTES = 'NetApp FAS2750 — 50TB usable, primary SAN for all VMs';
const NEW_CLUSTER_NOTES = 'Paris vSphere cluster (HA and DRS), managed by PAR-VCENTER-01 — its VMs move between the hosts';
const NEW_SAN_NOTES = 'NetApp FAS2750 — 50TB usable, shared storage of the Paris vSphere cluster hosts';

/** The two notes the fixture replaces: only the old value is overwritten. */
async function checkVmwareNotes(tenantId: string) {
  const rows: Array<{ name: string; notes: string | null }> = await inTenant(tenantId, (m) => m.query(
    `SELECT name, notes FROM assets
      WHERE tenant_id = $1 AND name IN ('PAR-VSPHERE-CL01', 'PAR-SAN-01')
      ORDER BY name`, [tenantId]));
  assert.deepEqual(Object.fromEntries(rows.map((row) => [row.name, row.notes])), {
    'PAR-SAN-01': NEW_SAN_NOTES,
    'PAR-VSPHERE-CL01': NEW_CLUSTER_NOTES,
  }, 'the notes of the cluster and the array are the new ones');
}

/** The state of a tenant built before this lot: no third host, old notes, a host link to a VM of the cluster, vSphere on the hosts, no dependency. */
async function simulateOlderVmwareState(tenantId: string) {
  await inTenant(tenantId, async (m) => {
    await m.query(`DELETE FROM assets WHERE tenant_id = $1 AND name = 'PAR-ESX-05'`, [tenantId]);
    await m.query(`DELETE FROM connections WHERE tenant_id = $1 AND name = $2`, [tenantId, VMWARE_CONNECTION]);
    await m.query(`UPDATE assets SET notes = $2 WHERE tenant_id = $1 AND name = 'PAR-VSPHERE-CL01'`, [tenantId, OLD_CLUSTER_NOTES]);
    await m.query(`UPDATE assets SET notes = $2 WHERE tenant_id = $1 AND name = 'PAR-SAN-01'`, [tenantId, OLD_SAN_NOTES]);
    await m.query(
      `INSERT INTO asset_relations (tenant_id, asset_id, related_asset_id, relation_type)
       SELECT $1, h.id, v.id, 'contains'
         FROM assets h, assets v
        WHERE h.tenant_id = $1 AND h.name = 'PAR-ESX-01' AND v.tenant_id = $1 AND v.name = 'PAR-ERP-01'`,
      [tenantId],
    );
    // The fixture used to install vSphere on the cluster hosts; the loader removes those links.
    await m.query(
      `INSERT INTO asset_technologies (tenant_id, asset_id, technology_id, technology_version_id, source)
       SELECT $1, h.id, link.technology_id, link.technology_version_id, 'manual'
         FROM assets h
         JOIN assets vc ON vc.tenant_id = $1 AND vc.name = 'PAR-VCENTER-01'
         JOIN asset_technologies link ON link.tenant_id = $1 AND link.asset_id = vc.id
         JOIN technologies t ON t.tenant_id = $1 AND t.id = link.technology_id AND t.catalog_key = 'vsphere'
        WHERE h.tenant_id = $1 AND h.name IN ('PAR-ESX-01', 'PAR-ESX-02')`,
      [tenantId],
    );
    await m.query(`DELETE FROM asset_relations WHERE tenant_id = $1 AND relation_type = 'depends_on'`, [tenantId]);
  });
}

/**
 * The loader run as a child of this process: a synchronous spawn would block the API that serves it.
 * The demo service's own spawn is left alone, so the captured loader environment stays the one of
 * the first load.
 */
function runLoader(env: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(FIXTURES, 'setup-tenant.mjs'), '--server-mode'], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`the loader did not end in ten minutes\n${stdout}\n${stderr}`));
    }, 600_000);
    child.stdout!.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr!.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`the loader ended with code ${code}\n${stdout}\n${stderr}`));
    });
  });
}

/** What a second load must leave alone, compared by names, with the audit rows of the relations and memberships. */
async function vmwareSnapshot(tenantId: string) {
  return inTenant(tenantId, async (m) => {
    const relations: Array<{ source: string; type: string; target: string }> = await m.query(
      `SELECT s.name AS source, r.relation_type AS type, t.name AS target
         FROM asset_relations r
         JOIN assets s ON s.tenant_id = r.tenant_id AND s.id = r.asset_id
         JOIN assets t ON t.tenant_id = r.tenant_id AND t.id = r.related_asset_id
        WHERE r.tenant_id = $1
        ORDER BY s.name, r.relation_type, t.name`, [tenantId]);
    const members: Array<{ cluster: string; member: string }> = await m.query(
      `SELECT c.name AS cluster, a.name AS member
         FROM asset_cluster_members x
         JOIN assets c ON c.tenant_id = x.tenant_id AND c.id = x.cluster_id
         JOIN assets a ON a.tenant_id = x.tenant_id AND a.id = x.asset_id
        WHERE x.tenant_id = $1
        ORDER BY c.name, a.name`, [tenantId]);
    const assignments: Array<{ asset: string; application: string; environment: string; role: string }> = await m.query(
      `SELECT a.name AS asset, ap.name AS application, i.environment, x.role
         FROM app_asset_assignments x
         JOIN assets a ON a.tenant_id = x.tenant_id AND a.id = x.asset_id
         JOIN app_instances i ON i.tenant_id = x.tenant_id AND i.id = x.app_instance_id
         JOIN applications ap ON ap.tenant_id = i.tenant_id AND ap.id = i.application_id
        WHERE x.tenant_id = $1
        ORDER BY a.name, ap.name, i.environment, x.role`, [tenantId]);
    const technologies: Array<{ asset: string; technology: string; version: string }> = await m.query(
      `SELECT a.name AS asset, t.name AS technology, coalesce(v.label, '') AS version
         FROM asset_technologies x
         JOIN assets a ON a.tenant_id = x.tenant_id AND a.id = x.asset_id
         JOIN technologies t ON t.tenant_id = x.tenant_id AND t.id = x.technology_id
         LEFT JOIN technology_versions v ON v.tenant_id = x.tenant_id AND v.id = x.technology_version_id
        WHERE x.tenant_id = $1
        ORDER BY a.name, t.name, version`, [tenantId]);
    const connections: Array<{ name: string; source: string; destination: string }> = await m.query(
      `SELECT c.name, coalesce(sa.name, c.source_entity_code, '') AS source,
              coalesce(da.name, c.destination_entity_code, '') AS destination
         FROM connections c
         LEFT JOIN assets sa ON sa.tenant_id = c.tenant_id AND sa.id = c.source_asset_id
         LEFT JOIN assets da ON da.tenant_id = c.tenant_id AND da.id = c.destination_asset_id
        WHERE c.tenant_id = $1
        ORDER BY c.name, source, destination`, [tenantId]);
    const audit: Array<{ table_name: string; n: number }> = await m.query(
      `SELECT table_name, count(*)::int AS n
         FROM audit_log
        WHERE tenant_id = $1 AND table_name IN ('asset_relations', 'asset_cluster_members')
        GROUP BY table_name
        ORDER BY table_name`, [tenantId]);
    return {
      relations: relations.map((row) => `${row.source}|${row.type}|${row.target}`),
      members: members.map((row) => `${row.cluster}|${row.member}`),
      assignments: assignments.map((row) => `${row.asset}|${row.application}|${row.environment}|${row.role}`),
      technologies: technologies.map((row) => `${row.asset}|${row.technology}|${row.version}`),
      connections: connections.map((row) => `${row.name}|${row.source}|${row.destination}`),
      audit: audit.map((row) => `${row.table_name}:${row.n}`),
    };
  });
}

/**
 * The incident register of the data set: ten rows in their order, six reviews on the five
 * headings of the model, the journal of the B2B portal, the SAP close and the LIMS signed by
 * their people and backdated, the three corrective tasks, and no incident on a cluster.
 */
async function checkIncidents(tenantId: string) {
  const incidents: Array<{ item_number: number; title: string; status: string }> = await inTenant(tenantId, (m) => m.query(
    `SELECT item_number, title, status FROM incidents WHERE tenant_id = $1 ORDER BY item_number`,
    [tenantId],
  ));
  assert.equal(incidents.length, 10, 'ten incidents, no row added or removed');
  assert.equal(incidents[3]?.title, B2B_INCIDENT, 'INC-4 is the B2B portal');
  assert.equal(incidents[3]?.status, 'closed');
  assert.equal(incidents[8]?.title, 'Lab results cannot be saved in QualityLab LIMS', 'INC-9 is the LIMS');
  assert.equal(incidents[8]?.status, 'in_progress');

  const reviews: Array<{ title: string; content_markdown: string }> = await inTenant(tenantId, (m) => m.query(
    `SELECT i.title, d.content_markdown
       FROM incidents i
       JOIN integrated_document_bindings b
         ON b.tenant_id = i.tenant_id AND b.source_entity_type = 'incidents'
        AND b.source_entity_id = i.id AND b.slot_key = 'review'
       JOIN documents d ON d.id = b.document_id AND d.tenant_id = b.tenant_id
      WHERE i.tenant_id = $1 AND i.title = ANY($2::text[])`,
    [tenantId, REVIEWED_INCIDENTS],
  ));
  const headings = (markdown: string) =>
    markdown.split(/\r?\n/).filter((line) => /^##\s+/.test(line)).map((line) => line.replace(/^##\s+/, '').trim());
  for (const title of REVIEWED_INCIDENTS) {
    const review = reviews.find((row) => row.title === title);
    assert.ok(review, `${title}: the review is filled`);
    assert.deepEqual(headings(review.content_markdown), INCIDENT_REVIEW_HEADINGS, `${title}: the five headings of the model`);
    assert.ok(!/^##\s+(Summary|Actions)\s*$/m.test(review.content_markdown), `${title}: no four-part heading`);
  }
  assert.match(reviews.find((row) => row.title === REVIEWED_INCIDENTS[5])!.content_markdown, /Under investigation/, 'the LIMS root cause is still under investigation');

  const entries: Array<{
    item_number: number;
    title: string;
    kind: string;
    content: string | null;
    occurred_at: Date;
    created_at: Date;
    author_email: string | null;
    changed_fields: any;
  }> = await inTenant(tenantId, (m) => m.query(
    `SELECT i.item_number, i.title, e.kind, e.content, e.occurred_at, e.created_at,
            lower(u.email) AS author_email, e.changed_fields
       FROM incident_entries e
       JOIN incidents i ON i.id = e.incident_id AND i.tenant_id = e.tenant_id
       LEFT JOIN users u ON u.id = e.author_id AND u.tenant_id = e.tenant_id
      WHERE e.tenant_id = $1
        AND i.title = ANY($2::text[])
        AND e.kind IN ('note', 'status_change', 'severity_change')
      ORDER BY i.item_number, e.occurred_at, e.created_at`,
    [tenantId, ['B2B portal down: database disk full', 'SAP month-end close slowed down by host memory contention', 'Lab results cannot be saved in QualityLab LIMS']],
  ));
  assert.equal(entries.length, fixtureRows('32-incident-journal.csv').length, 'every journal row imported');
  const knownAuthors = new Set(fixtureRows('10-users.csv').map((line) => line.split(';')[0].trim().toLowerCase()));
  for (const entry of entries) {
    assert.ok(knownAuthors.has(String(entry.author_email)), `${entry.title}: ${entry.author_email} is one of the incident people`);
    assert.ok(new Date(entry.created_at).getTime() > new Date(entry.occurred_at).getTime(), `${entry.title}: the entry is backdated, its creation time is the load`);
  }
  const b2b = entries.filter((entry) => entry.item_number === 4);
  assert.ok(b2b.some((entry) => entry.kind === 'note' && entry.author_email === 'isabelle.moreau@fromage-co.example'), 'the reporter wrote a note');
  assert.ok(b2b.some((entry) => entry.kind === 'note' && entry.author_email === 'amelie.rousseau@fromage-co.example'), 'the application owner wrote a note');
  assert.deepEqual(
    b2b.filter((entry) => entry.kind === 'status_change').map((entry) => `${entry.changed_fields.status.from}->${entry.changed_fields.status.to}`),
    ['open->in_progress', 'in_progress->resolved'],
    'the B2B status story',
  );
  assert.deepEqual(b2b.find((entry) => entry.kind === 'severity_change')?.changed_fields, { severity: { from: 'major', to: 'critical' } });
  assert.ok(entries.some((entry) => entry.item_number === 3 && entry.kind === 'severity_change' && entry.author_email === 'pierre.martin@fromage-co.example'));
  assert.ok(entries.some((entry) => entry.item_number === 9 && entry.kind === 'status_change' && entry.changed_fields.status.to === 'in_progress'));

  const tasks: Array<{
    item_number: number;
    title: string;
    status: string;
    due_date: string;
    assignee_email: string | null;
    related_object_type: string;
  }> = await inTenant(tenantId, (m) => m.query(
    `SELECT i.item_number, t.title, t.status, to_char(t.due_date, 'YYYY-MM-DD') AS due_date,
            lower(u.email) AS assignee_email, t.related_object_type
       FROM tasks t
       JOIN incidents i ON i.id = t.related_object_id AND i.tenant_id = t.tenant_id
       LEFT JOIN users u ON u.id = t.assignee_user_id AND u.tenant_id = t.tenant_id
      WHERE t.tenant_id = $1 AND t.related_object_type = 'incident'
      ORDER BY i.item_number`,
    [tenantId],
  ));
  assert.deepEqual(tasks.map((task) => task.item_number), [2, 3, 4], 'the phishing, SAP and B2B corrective tasks');
  assert.deepEqual(tasks.map((task) => task.assignee_email), [
    'lucas.bernard@fromage-co.example',
    'pierre.martin@fromage-co.example',
    'marc.petit@fromage-co.example',
  ]);
  assert.deepEqual(tasks.map((task) => task.due_date), ['2026-04-30', '2026-11-30', '2026-12-31']);
  assert.deepEqual(tasks.map((task) => task.status), ['done', 'in_progress', 'open']);

  const clusters = await tenantCount(
    tenantId,
    `SELECT count(*) AS n
       FROM incident_assets ia
       JOIN assets a ON a.id = ia.asset_id AND a.tenant_id = ia.tenant_id
      WHERE ia.tenant_id = $1 AND a.is_cluster`,
  );
  assert.equal(clusters, 0, 'no incident linked to a cluster');
}

async function serve(): Promise<Served> {
  // Loaded after the environment above: the modules read it when they load.
  const { AppModule } = require('../../app.module');
  // The demo data adopts catalog technologies: with the vulnerability feed on, each new CPE product
  // would be read from the real NVD and stored in the shared cache that later specs read.
  (Features as any).VULNERABILITY_FEED_ENABLED = false;
  const app: INestApplication = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  applyHttpMiddleware(app);
  applyTenancyAndPipeline(app, app.get(DataSource));
  await app.listen(0, '127.0.0.1');
  // No scheduled job runs during the spec.
  app.get(SchedulerRegistry).getCronJobs().forEach((job) => job.stop());

  const port = (app.getHttpServer().address() as AddressInfo).port;
  const demo = app.get(DemoDataService);
  demo.config.apiUrl = `http://127.0.0.1:${port}`;
  const loaderEnvs: Served['loaderEnvs'] = [];
  const realSpawn = demo.config.spawn;
  demo.config.spawn = ((command: string, args: string[], options: any) => {
    loaderEnvs.push({ ...options.env });
    return realSpawn(command, args, options);
  }) as any;

  const delivered: Served['delivered'] = [];
  (app.get(EmailService) as any).transport = {
    name: 'spec',
    defaultMinIntervalMs: 0,
    async send(options: any) { delivered.push({ to: options.to, subject: options.subject }); },
    getRetryDelayMs: () => null,
  };
  const storage = { put: [] as string[], deleted: [] as string[] };
  const store = app.get(StorageService) as any;
  store.putObject = async (params: { key: string }) => { storage.put.push(params.key); };
  store.deleteObject = async (key: string) => { storage.deleted.push(key); };
  return { app, port, demo, delivered, storage, loaderEnvs };
}

function request(port: number, opts: { method: string; path: string; host: string; token?: string; body?: unknown }) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const payload = opts.body === undefined ? undefined : Buffer.from(JSON.stringify(opts.body));
    const req = http.request({
      host: '127.0.0.1',
      port,
      method: opts.method,
      path: opts.path,
      headers: {
        Host: opts.host,
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': String(payload.length) } : {}),
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let body: any = text;
        try { body = text ? JSON.parse(text) : null; } catch { /* text */ }
        resolve({ status: res.statusCode ?? 0, body });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function waitForEnd(demo: DemoDataService, tenantId: string, timeoutMs = 240_000): Promise<DemoDataState> {
  const until = Date.now() + timeoutMs;
  const steps = new Set<string>();
  for (;;) {
    const state = await demo.getStatus(tenantId);
    if (state.step) steps.add(state.step);
    if (state.status !== 'loading' && state.status !== 'resetting') return state;
    if (Date.now() > until) assert.fail(`the load did not end: ${JSON.stringify(state)}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

async function tenantCount(tenantId: string, sql: string): Promise<number> {
  const [row] = await inTenant(tenantId, (manager) => manager.query(sql, [tenantId]));
  return Number(row.n);
}

/**
 * A loader that fails half-way: it runs the real loader behind a small proxy that answers 500
 * to the contracts import (after the companies, users, suppliers, applications... were written).
 * The proxy and the loader end before it exits.
 */
function writeFailingLoader(dir: string): string {
  const file = path.join(dir, 'failing-loader.mjs');
  fs.writeFileSync(file, `
import http from 'node:http';
import { spawn } from 'node:child_process';
const target = new URL(process.env.KANAP_DEMO_API_URL);
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/contracts/import')) {
    req.resume();
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ statusCode: 500, message: 'injected failure' }));
    return;
  }
  const upstream = http.request({ host: target.hostname, port: target.port, method: req.method, path: req.url, headers: req.headers }, (answer) => {
    res.writeHead(answer.statusCode, answer.headers);
    answer.pipe(res);
  });
  upstream.on('error', () => { res.writeHead(502); res.end(); });
  req.pipe(upstream);
});
server.listen(0, '127.0.0.1', () => {
  const env = { ...process.env, KANAP_DEMO_API_URL: 'http://127.0.0.1:' + server.address().port };
  const child = spawn(process.execPath, [${JSON.stringify(path.join(FIXTURES, 'setup-tenant.mjs'))}, '--server-mode'], { env, stdio: ['ignore', 'inherit', 'inherit'] });
  child.on('close', (code) => { server.close(); process.exit(code ?? 1); });
});
`, { mode: 0o644 });
  return file;
}

async function testLoadResetAndFailure() {
  const started = Date.now();
  const lap = (label: string) => console.log(`demo-data.e2e: ${label} at ${((Date.now() - started) / 1000).toFixed(1)} s`);
  const svc: Services = buildServices();
  const served = await serve();
  lap('application listening');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-data-e2e-'));
  let a: ActivatedTenant | undefined;
  let b: ActivatedTenant | undefined;
  try {
    a = await createActivatedTenant(svc, { tag: 'e2e-a', orgName: 'Fromage E2E', signup: true, language: 'fr' });
    b = await createActivatedTenant(svc, { tag: 'e2e-b', orgName: 'Neighbour E2E', signup: true });
    const hostA = `${a.slug}.lvh.me`;
    const hostB = `${b.slug}.lvh.me`;
    const initialCounts = await countTenantRows(a.tenantId);
    const initialSnapshot = await baselineSnapshot(a.tenantId);
    const neighbourCounts = await countTenantRows(b.tenantId);

    // ── Load ──
    const claimed = await served.demo.load({ tenantId: a.tenantId, actorId: a.ownerId, host: hostA });
    assert.equal(claimed.status, 'loading');
    const loaded = await waitForEnd(served.demo, a.tenantId);
    lap('load ended');
    assert.equal(loaded.status, 'loaded', `the load ended ${JSON.stringify(loaded)}`);
    assert.equal(loaded.error_code, null);

    const expected = {
      app_instances: fixtureRows('20-app-instances.csv').length,
      interfaces: fixtureRows('21-interfaces.csv').length,
      interface_bindings: fixtureRows('22-interface-bindings.csv').length,
      connections: fixtureRows('23-connections.csv').length,
      users: fixtureRows('10-users.csv').length,
    };
    const actual = {
      app_instances: await tenantCount(a.tenantId, `SELECT count(*) AS n FROM app_instances WHERE tenant_id = $1`),
      interfaces: await tenantCount(a.tenantId, `SELECT count(*) AS n FROM interfaces WHERE tenant_id = $1`),
      interface_bindings: await tenantCount(a.tenantId, `SELECT count(*) AS n FROM interface_bindings WHERE tenant_id = $1`),
      connections: await tenantCount(a.tenantId, `SELECT count(*) AS n FROM connections WHERE tenant_id = $1`),
      users: await tenantCount(a.tenantId, `SELECT count(*) AS n FROM users WHERE tenant_id = $1 AND lower(email) LIKE '%.example'`),
    };
    assert.deepEqual(actual, expected, 'the landscape and the sample users of the data set');
    assert.ok(expected.app_instances > 0 && expected.interfaces > 0 && expected.connections > 0 && expected.users > 0);
    assert.equal(await tenantCount(a.tenantId, `SELECT count(*) AS n FROM users WHERE tenant_id = $1 AND lower(email) LIKE '%.example' AND password_hash IS NOT NULL`), 0,
      'the sample users have no password');
    assert.deepEqual(served.delivered, [], 'no e-mail sent');
    assert.deepEqual(countDifferences(neighbourCounts, await countTenantRows(b.tenantId)), [], 'the neighbour tenant is untouched');
    await checkDimensions(a.tenantId);
    await checkContactSuppliers(a.tenantId);
    await checkIncidents(a.tenantId);

    const token = served.loaderEnvs[0].KANAP_DEMO_TOKEN;
    await checkVmwareLandscape(served.port, a.tenantId, hostA, token);
    await checkVmwareNotes(a.tenantId);
    lap('VMware landscape checked');

    // A tenant built before this lot: no third host, old notes, a host link to a VM of the
    // cluster, no dependency. A full loader run brings it back in line.
    await simulateOlderVmwareState(a.tenantId);
    await runLoader(served.loaderEnvs[0]);
    lap('convergence load ended');
    await checkVmwareLandscape(served.port, a.tenantId, hostA, token);
    await checkVmwareNotes(a.tenantId);

    // A second full run changes nothing, audit rows of relations and memberships included.
    const snapshot = await vmwareSnapshot(a.tenantId);
    await runLoader(served.loaderEnvs[0]);
    lap('idempotence load ended');
    assert.deepEqual(await vmwareSnapshot(a.tenantId), snapshot, 'a second load changes nothing');

    // ── The loader's token: refused on another tenant's host, accepted on its own ──
    assert.equal(served.loaderEnvs.length, 1);
    assert.equal((await request(served.port, { method: 'GET', path: '/companies', host: hostA, token })).status, 200);

    // The journal import is closed outside a load: 409 with its code, and no new entry.
    const journalTenantId = a.tenantId;
    const journalCount = () => tenantCount(
      journalTenantId,
      `SELECT count(*) AS n FROM incident_entries WHERE tenant_id = $1 AND kind IN ('note', 'status_change', 'severity_change')`,
    );
    const beforeJournalRefusal = await journalCount();
    const refusedJournal = await request(served.port, { method: 'POST', path: '/incidents/import-journal', host: hostA, token });
    assert.equal(refusedJournal.status, 409, `the journal import outside a load (${JSON.stringify(refusedJournal.body)})`);
    assert.equal(refusedJournal.body?.code, 'SAMPLE_DATA_LOAD_ONLY');
    assert.equal(await journalCount(), beforeJournalRefusal, 'the refused import wrote nothing');

    const foreign = await request(served.port, { method: 'GET', path: '/companies', host: hostB, token });
    assert.equal(foreign.status, 401, 'the loader token on another tenant');
    const foreignWrite = await request(served.port, { method: 'POST', path: '/suppliers', host: hostB, token, body: { name: 'Not here' } });
    assert.equal(foreignWrite.status, 401);

    // ── Reset ──
    const reset = await served.demo.reset({ tenantId: a.tenantId, actorId: a.ownerId });
    lap('reset ended');
    assert.equal(reset.status, 'idle');
    assert.deepEqual(countDifferences(initialCounts, await countTenantRows(a.tenantId), ['audit_log']), [], 'every table as at activation');
    assert.deepEqual(await baselineSnapshot(a.tenantId), initialSnapshot, 'the starting state');
    assert.deepEqual(served.storage.deleted, [], 'the data set stores no file');

    // ── A load that fails half-way ──
    served.demo.config.scriptPath = writeFailingLoader(tmp);
    await served.demo.load({ tenantId: a.tenantId, actorId: a.ownerId, host: hostA });
    const failed = await waitForEnd(served.demo, a.tenantId);
    lap('failed load ended');
    assert.equal(failed.status, 'failed', JSON.stringify(failed));
    assert.equal(failed.error_code, 'load_failed');
    assert.deepEqual(countDifferences(initialCounts, await countTenantRows(a.tenantId), ['audit_log']), [], 'every table as at activation');
    assert.deepEqual(await baselineSnapshot(a.tenantId), initialSnapshot);
    const resets = await tenantCount(a.tenantId, `SELECT count(*) AS n FROM audit_log WHERE tenant_id = $1 AND source_ref = 'demo-reset'`);
    assert.equal(resets, 2, 'the manual reset and the automatic one');
    assert.deepEqual(served.delivered, [], 'no e-mail sent');

    // ── Writes refused while the tenant is being reset ──
    const adminToken = svc.auth.signToken({ id: a.ownerId, email: a.ownerEmail, tenant_id: a.tenantId }).access_token;
    const neighbourToken = svc.auth.signToken({ id: b.ownerId, email: b.ownerEmail, tenant_id: b.tenantId }).access_token;
    await dataSource.query(
      `UPDATE tenants SET metadata = metadata || jsonb_build_object('demo', metadata->'demo' || '{"status":"resetting"}'::jsonb) WHERE id = $1`,
      [a.tenantId],
    );
    try {
      const write = await request(served.port, { method: 'POST', path: '/suppliers', host: hostA, token: adminToken, body: { name: 'During reset' } });
      assert.equal(write.status, 409);
      assert.equal(write.body?.code, TENANT_RESETTING_CODE);
      const read = await request(served.port, { method: 'GET', path: '/companies', host: hostA, token: adminToken });
      assert.equal(read.status, 200, 'reads go on');
      const neighbourWrite = await request(served.port, { method: 'POST', path: '/suppliers', host: hostB, token: neighbourToken, body: { name: 'Neighbour supplier' } });
      assert.ok(neighbourWrite.status === 201 || neighbourWrite.status === 200, `another tenant writes (${neighbourWrite.status} ${JSON.stringify(neighbourWrite.body)})`);
      assert.equal(await tenantCount(a.tenantId, `SELECT count(*) AS n FROM suppliers WHERE tenant_id = $1`), 0);
    } finally {
      await dataSource.query(
        `UPDATE tenants SET metadata = metadata || jsonb_build_object('demo', metadata->'demo' || '{"status":"failed"}'::jsonb) WHERE id = $1`,
        [a.tenantId],
      );
    }
    lap('done');
  } finally {
    served.demo.stop();
    await served.app.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    await cleanupTenants([a?.tenantId, b?.tenantId]);
  }
}

async function testOlderWorkspace() {
  const svc: Services = buildServices();
  const served = await serve();
  let a: ActivatedTenant | undefined;
  try {
    a = await createActivatedTenant(svc, { tag: 'e2e-old', orgName: 'Fromage E2E older', signup: true });
    const tenantId = a.tenantId;
    // As the seed left a workspace before lot D.
    await inTenant(tenantId, async (m) => {
      await m.query(`DELETE FROM analytics_categories WHERE tenant_id = $1`, [tenantId]);
      await m.query(`DELETE FROM analytics_axes WHERE tenant_id = $1 AND NOT is_default`, [tenantId]);
      await m.query(`UPDATE analytics_axes SET name = NULL, description = NULL WHERE tenant_id = $1 AND is_default`, [tenantId]);
      await ensureCapexDimensions(m, tenantId);
    });
    await served.demo.load({ tenantId, actorId: a.ownerId, host: `${a.slug}.lvh.me` });
    const loaded = await waitForEnd(served.demo, tenantId);
    assert.equal(loaded.status, 'loaded', `the load ended ${JSON.stringify(loaded)}`);

    const rows: Array<{ code: string; name: string; nature: string | null; n: number }> = await inTenant(tenantId, (m) => m.query(
      `SELECT a.code, a.name, s.nature, count(s.id)::int AS n
         FROM analytics_axes a
         LEFT JOIN spend_item_analytics_values v ON v.axis_id = a.id AND v.tenant_id = a.tenant_id
         LEFT JOIN spend_items s ON s.id = v.item_id AND s.tenant_id = v.tenant_id
        WHERE a.tenant_id = $1
        GROUP BY a.id, a.code, a.name, s.nature
        ORDER BY a.code, s.nature`, [tenantId]));
    const opex = fixtureRows('14-spend-items.csv').length;
    const capex = fixtureRows('15-capex-items.csv').length;
    const count = (code: string, nature: string) => rows.find((row) => row.code === code && row.nature === nature)?.n ?? 0;
    assert.deepEqual([...new Set(rows.map((row) => row.code))],
      ['business_domain', 'default', 'investment_type', 'it_tower', 'ppe_type', 'priority', 'recurrence', 'reference'], 'no purpose next to the investment type');
    assert.equal(rows.find((row) => row.code === 'default')?.name, 'Cost pool', 'the empty default dimension became the cost pool');
    await assertOwnDimensions(tenantId, 'en');
    for (const code of ['default', 'it_tower', 'business_domain']) {
      assert.deepEqual([count(code, 'opex'), count(code, 'capex')], [opex, capex], `${code}: every line`);
    }
    for (const code of ['ppe_type', 'investment_type', 'priority']) {
      assert.deepEqual([count(code, 'opex'), count(code, 'capex')], [0, capex], `${code}: every CAPEX line`);
    }
    const ppe = await inTenant(tenantId, (m) => m.query(
      `SELECT c.name, count(*)::int AS n FROM spend_item_analytics_values v
         JOIN analytics_axes a ON a.id = v.axis_id AND a.tenant_id = v.tenant_id AND a.code = 'ppe_type'
         JOIN analytics_categories c ON c.id = v.category_id AND c.tenant_id = v.tenant_id
        WHERE v.tenant_id = $1 GROUP BY c.name ORDER BY c.name`, [tenantId]));
    assert.deepEqual(ppe.map((row: any) => [row.name, row.n]), [['Hardware', 8], ['Software', 7]], 'the PP&E type follows the cost pool');
  } finally {
    served.demo.stop();
    await served.app.close();
    await cleanupTenants([a?.tenantId]);
  }
}

runSpecs('demo-data.e2e.integration.spec', [testLoadResetAndFailure, testOlderWorkspace]).catch((err) => {
  console.error(err);
  process.exit(1);
});
