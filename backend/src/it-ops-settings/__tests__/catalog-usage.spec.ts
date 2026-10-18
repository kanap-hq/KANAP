import * as assert from 'node:assert/strict';
import { CATALOG_USAGE, countCatalogUsage, usageListPath, usageSql } from '../catalog-usage';
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
  console.log('Catalog usage definitions, SQL shapes and counting passed');
}
run().catch((error) => { console.error(error); process.exit(1); });
