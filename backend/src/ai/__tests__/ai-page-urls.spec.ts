import * as assert from 'node:assert/strict';
import { AI_PAGE_ROUTES, withAiPageUrls } from '../ai-page-urls';

// `page_url` on the records of the read tools (`ai-page-urls.ts`): the families without a business
// reference get the page of the application, for a person who holds its right; absolute addresses
// over MCP, the vulnerabilities' links included.

const CONTRACT = '11111111-1111-4111-8111-111111111111';
const COMPANY = '22222222-2222-4222-8222-222222222222';
const APPLICATION = '33333333-3333-4333-8333-333333333333';

const reads = (...rights: string[]) => async (resources: string[]) => new Set(resources.filter((resource) => rights.includes(resource)));

async function testListItems() {
  const result = await withAiPageUrls({
    items: [
      { type: 'contracts', id: CONTRACT, ref: null, label: 'SAP Maintenance' },
      { type: 'companies', id: COMPANY, ref: null, label: 'Fromage SA' },
      { type: 'applications', id: APPLICATION, ref: 'APP-8', label: 'SAP S/4HANA' },
      { type: 'contracts', id: 'not-an-id', ref: null, label: 'Broken' },
    ],
  }, { readableResources: reads('contracts', 'companies', 'applications'), origin: async () => null });
  assert.deepEqual(result.items.map((item: any) => item.page_url), [
    `/ops/contracts/${CONTRACT}`,
    `/master-data/companies/${COMPANY}`,
    undefined,
    undefined,
  ], 'pages for the families without reference, none for a referenced record or a malformed id');
}

async function testRights() {
  const result = await withAiPageUrls({
    items: [{ type: 'contracts', id: CONTRACT }, { type: 'companies', id: COMPANY }],
  }, { readableResources: reads('companies'), origin: async () => null });
  assert.deepEqual(result.items.map((item: any) => item.page_url), [undefined, `/master-data/companies/${COMPANY}`], 'no page without its right');

  let asked: string[] = [];
  await withAiPageUrls({ items: [{ type: 'connections', id: CONTRACT }, { type: 'locations', id: COMPANY }] }, {
    readableResources: async (resources) => {
      asked = resources;
      return new Set();
    },
    origin: async () => null,
  });
  assert.deepEqual(asked.sort(), ['infrastructure', 'locations'], 'the rights the routes ask for');
}

async function testDetailAndContext() {
  const detail = await withAiPageUrls({ entity: { type: 'suppliers', id: COMPANY }, data: { name: 'Supplier' } }, {
    readableResources: reads('suppliers'),
    origin: async () => null,
  });
  assert.equal((detail.entity as any).page_url, `/master-data/suppliers/${COMPANY}`);
  assert.equal((detail.data as any).page_url, undefined, 'the data is left alone');

  const context = await withAiPageUrls({
    entity: { type: 'applications', id: APPLICATION, ref: 'APP-8' },
    related: [{ relation: 'contracts', items: [{ type: 'contracts', id: CONTRACT }] }],
  }, { readableResources: reads('contracts', 'applications'), origin: async () => null });
  assert.equal((context.entity as any).page_url, undefined);
  assert.equal((context.related[0].items[0] as any).page_url, `/ops/contracts/${CONTRACT}`, 'a linked record');
}

async function testMcpOrigin() {
  const vulnerabilityPage = '/it/vulnerabilities?q=CVE-2024-1&state=all&alerts=all';
  const result = await withAiPageUrls({
    items: [
      { type: 'contracts', id: CONTRACT },
      { type: 'vulnerabilities', id: APPLICATION, metadata: { page_url: vulnerabilityPage } },
    ],
  }, { readableResources: reads('contracts'), origin: async () => 'https://fromage.kanap.net' });
  assert.equal((result.items[0] as any).page_url, `https://fromage.kanap.net/ops/contracts/${CONTRACT}`);
  assert.equal((result.items[1] as any).metadata.page_url, `https://fromage.kanap.net${vulnerabilityPage}`, 'a vulnerability link too');

  const detail = await withAiPageUrls({
    entity: { type: 'vulnerabilities', id: APPLICATION, metadata: { page_url: vulnerabilityPage } },
    data: { page_url: vulnerabilityPage },
  }, { readableResources: reads(), origin: async () => 'https://fromage.kanap.net' });
  assert.equal((detail.data as any).page_url, `https://fromage.kanap.net${vulnerabilityPage}`, 'a vulnerability detail');

  const chat = await withAiPageUrls({ items: [{ type: 'vulnerabilities', id: APPLICATION, metadata: { page_url: vulnerabilityPage } }] }, {
    readableResources: reads(),
    origin: async () => null,
  });
  assert.equal((chat.items[0] as any).metadata.page_url, vulnerabilityPage, 'the chat keeps paths');
}

function testRoutesHaveNoReferenceFamilies() {
  for (const family of ['applications', 'assets', 'technologies', 'projects', 'requests', 'tasks', 'documents', 'incidents', 'spend_items', 'capex_items']) {
    assert.equal(AI_PAGE_ROUTES[family], undefined, `${family} opens by its reference`);
  }
}

async function run() {
  await testListItems();
  await testRights();
  await testDetailAndContext();
  await testMcpOrigin();
  testRoutesHaveNoReferenceFamilies();
  console.log('ai-page-urls.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
