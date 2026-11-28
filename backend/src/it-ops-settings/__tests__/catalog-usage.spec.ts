import * as assert from 'node:assert/strict';
import { CATALOG_USAGE, countCatalogUsage, usageListPath, usageSql, usedCatalogCodes, usedCodesSql } from '../catalog-usage';
import { ItOpsSettingsService } from '../it-ops-settings.service';

// Every editable list has a usage definition (possibly empty), and every definition is a known list.
for (const key of Object.keys(ItOpsSettingsService.LIST_META)) assert.ok(key in CATALOG_USAGE, `missing usage definition for ${key}`);
for (const key of Object.keys(CATALOG_USAGE)) assert.ok(key in ItOpsSettingsService.LIST_META, `unknown list ${key}`);

// Every generated query filters by tenant and counts distinct head records.
for (const [key, sources] of Object.entries(CATALOG_USAGE)) {
  for (const source of sources) {
    if (source.table === 'settings') continue;
    const sql = usageSql(source);
    assert.match(sql, /^SELECT COUNT\(DISTINCT t\.id\)::int AS count FROM [a-z_]+ t WHERE t\.tenant_id = \$1 AND \(/, `${key}: ${sql}`);
    for (const predicate of source.predicates) if (predicate.kind === 'scalar' || predicate.kind === 'array') {
      if (predicate.table !== source.table) assert.match(sql, /r\.tenant_id = \$1/, `${key}: joined table must be tenant-filtered`);
    }
  }
}
assert.match(usageSql(CATALOG_USAGE.accessMethods[0]), /\$2 = ANY\(t\.access_methods\)/);
assert.match(usageSql(CATALOG_USAGE.ipAddressTypes[0]), /jsonb_array_elements\(t\.ip_addresses\) e WHERE e->>'type' = \$2/);
assert.match(usageSql(CATALOG_USAGE.subnets[0]), /t\.location_id = \$3/);
assert.match(usageSql(CATALOG_USAGE.connectionTypes[0]), /connection_protocols r WHERE r\.tenant_id = \$1 AND r\.connection_id = t\.id AND r\.connection_type_code = \$2/);
assert.match(usageSql(CATALOG_USAGE.connectionTypes[0]), /\$2 = ANY\(r\.protocol_codes\)/);
assert.equal(CATALOG_USAGE.interfaceProtocols.length, 0);
assert.equal(usageSql(CATALOG_USAGE.adminZones[0]), 'SELECT COUNT(DISTINCT t.id)::int AS count FROM technologies t WHERE t.tenant_id = $1 AND ((t.admin_zone = $2))');
assert.equal(usageSql(CATALOG_USAGE.adminZones[1]), 'SELECT COUNT(DISTINCT t.id)::int AS count FROM assets t WHERE t.tenant_id = $1 AND ((t.admin_zone = $2))');
assert.match(usageListPath(CATALOG_USAGE.adminZones[1], 'tier_0')!, /^\/it\/assets\?filters=/);
// The Netbox role matches: the workspace's Netbox connection, its matches read as an object whatever is stored.
const netboxRoles = CATALOG_USAGE.serverKinds.find((source) => source.record === 'netbox_role_matches')!;
assert.match(usageSql(netboxRoles), /FROM ai_adapter_configs t WHERE t\.tenant_id = \$1 AND \(\(t\.provider_kind = 'inventory' AND t\.provider_key = 'netbox' AND EXISTS \(SELECT 1 FROM jsonb_each_text\(CASE WHEN jsonb_typeof\(t\.metadata_json->'role_map'\) = 'object'/);
assert.match(usageSql(netboxRoles), /m WHERE m\.value = \$2\)\)\)$/);
assert.match(usedCodesSql(netboxRoles), /SELECT m\.value AS code FROM ai_adapter_configs t CROSS JOIN LATERAL jsonb_each_text\(.*\) m WHERE t\.tenant_id = \$1 AND t\.provider_kind = 'inventory' AND t\.provider_key = 'netbox'/);
assert.equal(usageListPath(netboxRoles, 'switch'), undefined);

// The grouped read of the restore: one statement per source, every table read filtered by tenant,
// a joined row read only with its head record of the same tenant.
for (const [key, sources] of Object.entries(CATALOG_USAGE)) {
  for (const source of sources) {
    if (source.table === 'settings') continue;
    const sql = usedCodesSql(source);
    assert.match(sql, /^SELECT DISTINCT u\.code FROM \(.*\) u WHERE u\.code IS NOT NULL$/, `${key}: ${sql}`);
    assert.equal(sql.split(' UNION ALL ').length, source.predicates.length, `${key}: one part per predicate`);
    for (const part of sql.split(' UNION ALL ')) assert.match(part, /WHERE t\.tenant_id = \$1|t\.tenant_id = \$1 WHERE r\.tenant_id = \$1/, `${key}: ${part}`);
    for (const predicate of source.predicates) if ((predicate.kind === 'scalar' || predicate.kind === 'array') && predicate.table !== source.table) {
      assert.ok(sql.includes(`FROM ${predicate.table} r JOIN ${source.table} t ON t.id = r.${predicate.recordId} AND t.tenant_id = $1 WHERE r.tenant_id = $1`), `${key}: joined table read with its head record`);
    }
  }
}
assert.equal(usedCodesSql(CATALOG_USAGE.adminZones[0]), 'SELECT DISTINCT u.code FROM (SELECT t.admin_zone AS code FROM technologies t WHERE t.tenant_id = $1) u WHERE u.code IS NOT NULL');
assert.match(usedCodesSql(CATALOG_USAGE.accessMethods[0]), /SELECT unnest\(t\.access_methods\) AS code/);
assert.match(usedCodesSql(CATALOG_USAGE.ipAddressTypes[0]), /e->>'type' AS code .*jsonb_typeof\(t\.ip_addresses\) = 'array'/);
assert.match(usedCodesSql(CATALOG_USAGE.subnets[0]), /t\.location_id::text \|\| ':' \|\| \(e->>'subnet_cidr'\) AS code/);
assert.match(usageSql(CATALOG_USAGE.ipAddressTypes[0]), /jsonb_typeof\(t\.ip_addresses\) = 'array' AND EXISTS/, 'an address list that is not an array never breaks a count');

// Deep links only where the list page filters from the URL, values are codes.
assert.equal(usageListPath(CATALOG_USAGE.applicationCategories[0], 'lob'), '/it/applications?filters=%7B%22category%22%3A%7B%22filterType%22%3A%22set%22%2C%22values%22%3A%5B%22lob%22%5D%7D%7D&appScope=all');
assert.equal(usageListPath(CATALOG_USAGE.domains[0], 'corp'), undefined);
assert.match(usageListPath(CATALOG_USAGE.incidentCategories[0], 'security')!, /^\/it\/incidents\?filters=/);

// Counting: one query per source, subnets keyed by site + CIDR, network zones counted in settings.
async function run() {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const manager: any = { query: async (sql: string, params: unknown[]) => { calls.push({ sql, params }); return [{ count: sql.includes('FROM assets') ? 2 : 0 }]; } };
  const lifecycle = await countCatalogUsage(manager, 'tenant', 'lifecycleStates', { code: 'active' });
  assert.equal(calls.length, CATALOG_USAGE.lifecycleStates.length);
  assert.deepEqual(lifecycle, [{ record: 'assets', count: 2, listPath: usageListPath(CATALOG_USAGE.lifecycleStates[1], 'active') }]);
  calls.length = 0;
  const subnet = await countCatalogUsage(manager, 'tenant', 'subnets', { location_id: 'loc', cidr: '10.0.0.0/24' });
  assert.deepEqual(calls[0].params, ['tenant', '10.0.0.0/24', 'loc']);
  assert.deepEqual(subnet, [{ record: 'assets', count: 2, listPath: undefined }]);
  const zones = await countCatalogUsage(manager, 'tenant', 'networkSegments', { code: 'dmz' }, [{ network_zone: 'dmz' }, { network_zone: 'lan' }, { network_zone: 'dmz' }]);
  assert.deepEqual(zones, [{ record: 'subnets', count: 2, listPath: undefined }]);
  assert.deepEqual(await countCatalogUsage(manager, 'tenant', 'unknown', { code: 'x' }), []);

  // The grouped read: one query per source, the tenant as its only parameter, whatever the values.
  const reads: Array<{ sql: string; params: unknown[] }> = [];
  const reader: any = { query: async (sql: string, params: unknown[]) => { reads.push({ sql, params }); return [{ code: sql.includes('FROM assets') ? 'active' : 'proposed' }]; } };
  assert.deepEqual([...await usedCatalogCodes(reader, 'tenant', 'lifecycleStates')].sort(), ['active', 'proposed']);
  assert.equal(reads.length, CATALOG_USAGE.lifecycleStates.length);
  assert.ok(reads.every((read) => read.params.length === 1 && read.params[0] === 'tenant'));
  reads.length = 0;
  assert.deepEqual([...await usedCatalogCodes(reader, 'tenant', 'networkSegments', [{ network_zone: 'dmz' }, { network_zone: 'lan' }, { network_zone: 'dmz' }])].sort(), ['dmz', 'lan']);
  assert.equal(reads.length, 0, 'network zones are read from the subnets given');
  assert.equal((await usedCatalogCodes(reader, 'tenant', 'interfaceProtocols')).size, 0);
  assert.equal(reads.length, 0, 'no source, no query');
  console.log('Catalog usage definitions, SQL shapes and counting passed');
}
run().catch((error) => { console.error(error); process.exit(1); });
