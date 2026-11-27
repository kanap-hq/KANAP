import * as assert from 'node:assert/strict';
import { AiEntityService } from '../ai-entity.service';
import { withAiPageUrls } from '../ai-page-urls';
import { AiQueryExecutor } from '../query/ai-query.executor';

// Interfaces, sites and connections keep their reference as text on the record (`INT-3`, `LOC-2`,
// `CONN-4`), and their pages open by it. Kad and the MCP server give it as `ref` wherever they read
// these records: the @-mention search (the search index, which holds its prefix and number, and the
// per-family searches), query_entities and the details. The composer then links the reference, and
// the `page_url` of a site or a connection names it. A reference the record does not write as its
// prefix and number (`LOC-007`, a lower-case one) is not rebuilt: the id stays.

const ID = '11111111-1111-4111-8111-111111111111';

function testSearchIndexRows() {
  const service = Object.create(AiEntityService.prototype) as any;
  const summary = (entityType: string, refPrefix: string | null, refNumber: number | null, label: string) => service
    .searchIndexRowToSummary({ entity_type: entityType, entity_id: ID, ref_prefix: refPrefix, ref_number: refNumber, label, summary: null, status: null, extra_json: null, score: 1 });
  assert.equal(summary('locations', 'LOC', 2, 'LOC-2 · Lyon').ref, 'LOC-2', 'a site by its reference');
  assert.equal(summary('connections', 'CONN', 4, 'CONN-4 - VPN Lyon').ref, 'CONN-4', 'a connection by its reference');
  assert.equal(summary('interfaces', 'INT', 3, 'INT-3 - Orders').ref, 'INT-3', 'an interface by its reference');
  assert.equal(summary('locations', 'LOC', 7, 'LOC-007 · Lille').ref, null, 'a reference written otherwise is not rebuilt');
  assert.equal(summary('locations', null, null, 'Paris').ref, null, 'a site without a reference');
  assert.equal(summary('connections', 'CONN', 4, 'conn-4 - VPN').ref, null, 'a reference in another case is not rebuilt');
  console.log('  search index rows: sites, connections and interfaces carry their reference: OK');
}

async function testPerFamilySearches() {
  const service = Object.create(AiEntityService.prototype) as any;
  for (const [method, column, row] of [
    ['searchLocations', 'l.location_reference AS ref', { id: ID, ref: 'LOC-2', label: 'LOC-2 · Lyon', summary: null, status: null, score: 3, total_count: 1 }],
    ['searchConnections', 'cn.connection_reference AS ref', { id: ID, ref: 'CONN-4', label: 'CONN-4 - VPN', summary: null, status: null, score: 3, total_count: 1 }],
    ['searchInterfaces', 'i.interface_reference AS ref', { id: ID, ref: 'INT-3', label: 'INT-3 - Orders', summary: null, status: null, score: 3, total_count: 1 }],
  ] as const) {
    const statements: string[] = [];
    const context = { tenantId: ID, manager: { query: async (sql: string) => { statements.push(sql); return [row]; } } };
    const result = await service[method](context, 'lyon', 10);
    assert.ok(statements[0].includes(column), `${method} reads the reference`);
    assert.ok(/tenant_id = \$2/.test(statements[0]), `${method} names its tenant`);
    assert.equal(result.items[0].ref, row.ref, `${method}: the reference as \`ref\``);
  }
  console.log('  per-family searches (index off): the same references: OK');
}

function testQueryReads() {
  const executor = Object.create(AiQueryExecutor.prototype) as any;
  assert.equal(executor.mapConnection({ id: ID, connection_reference: 'CONN-4', name: 'VPN' }).ref, 'CONN-4', 'query_entities: a connection by its reference');
  assert.equal(executor.mapInterface({ id: ID, interface_reference: 'INT-3', name: 'Orders' }).ref, 'INT-3', 'query_entities: an interface by its reference');
  assert.equal(executor.mapLocation({ id: ID, location_reference: 'LOC-2', name: 'Lyon' }).ref, 'LOC-2', 'query_entities: a site by its reference');
  assert.equal(executor.mapConnection({ id: ID, connection_reference: null, name: 'VPN' }).ref, null, 'a connection without a reference');
  console.log('  query_entities: connections, interfaces and sites carry their reference: OK');
}

async function testPageUrls() {
  const result = await withAiPageUrls({
    items: [
      { type: 'connections', id: ID, ref: 'CONN-4', label: 'CONN-4 - VPN' },
      { type: 'locations', id: ID, ref: 'LOC-2', label: 'LOC-2 · Lyon' },
      { type: 'connections', id: ID, ref: null, label: 'VPN' },
    ],
  }, { readableResources: async (resources) => new Set(resources), origin: async () => 'https://acme.example.com' });
  assert.deepEqual(result.items.map((item: any) => item.page_url), [
    'https://acme.example.com/it/connections/CONN-4',
    'https://acme.example.com/it/locations/LOC-2',
    `https://acme.example.com/it/connections/${ID}`,
  ], 'MCP: a site and a connection by their reference, the id without one');
  console.log('  page_url (MCP): sites and connections by their reference: OK');
}

async function run() {
  testSearchIndexRows();
  await testPerFamilySearches();
  testQueryReads();
  await testPageUrls();
  console.log('ai-text-reference-families.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
