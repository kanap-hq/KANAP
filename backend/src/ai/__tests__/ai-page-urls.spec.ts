import * as assert from 'node:assert/strict';
import { AI_PAGE_ROUTES, entityPageUrl, withAiPageUrls } from '../ai-page-urls';

// `page_url` on the records of the read tools (`ai-page-urls.ts`): the families without a business
// reference get the page of the application, for a person who holds its right; absolute addresses
// over MCP, the vulnerabilities' links included.

const PROCESS = '11111111-1111-4111-8111-111111111111';
const COMPANY = '22222222-2222-4222-8222-222222222222';
const APPLICATION = '33333333-3333-4333-8333-333333333333';

const reads = (...rights: string[]) => async (resources: string[]) => new Set(resources.filter((resource) => rights.includes(resource)));

async function testListItems() {
  const result = await withAiPageUrls({
    items: [
      { type: 'business_processes', id: PROCESS, ref: null, label: 'Order to cash' },
      { type: 'contracts', id: PROCESS, ref: 'CTR-2', label: 'SAP Maintenance' },
      { type: 'companies', id: COMPANY, ref: 'COMP-5', label: 'Fromage SA' },
      { type: 'departments', id: COMPANY, ref: 'DEPT-5', label: 'Finance' },
      { type: 'accounts', id: COMPANY, ref: '612100', label: 'Software' },
      { type: 'applications', id: APPLICATION, ref: 'APP-8', label: 'SAP S/4HANA' },
      { type: 'business_processes', id: 'not-an-id', ref: null, label: 'Broken' },
    ],
  }, { readableResources: reads('business_processes', 'contracts', 'companies', 'departments', 'accounts', 'applications'), origin: async () => null });
  assert.deepEqual(result.items.map((item: any) => item.page_url), [
    `/master-data/business-processes/${PROCESS}`,
    undefined,
    undefined,
    undefined,
    `/master-data/accounts/${COMPANY}`,
    undefined,
    undefined,
  ], 'pages for the families without reference, none for a referenced record (a contract, a company or a department opens by CTR-n, COMP-n, DEPT-n) or a malformed id');
}

async function testRights() {
  const result = await withAiPageUrls({
    items: [{ type: 'business_processes', id: PROCESS }, { type: 'accounts', id: COMPANY }],
  }, { readableResources: reads('accounts'), origin: async () => null });
  assert.deepEqual(result.items.map((item: any) => item.page_url), [undefined, `/master-data/accounts/${COMPANY}`], 'no page without its right');

  let asked: string[] = [];
  await withAiPageUrls({ items: [{ type: 'connections', id: PROCESS }, { type: 'locations', id: COMPANY }] }, {
    readableResources: async (resources) => {
      asked = resources;
      return new Set();
    },
    origin: async () => null,
  });
  assert.deepEqual(asked.sort(), ['infrastructure', 'locations'], 'the rights the routes ask for');
}

async function testDetailAndContext() {
  const detail = await withAiPageUrls({ entity: { type: 'business_processes', id: COMPANY }, data: { name: 'Order to cash' } }, {
    readableResources: reads('business_processes'),
    origin: async () => null,
  });
  assert.equal((detail.entity as any).page_url, `/master-data/business-processes/${COMPANY}`);
  assert.equal((detail.data as any).page_url, undefined, 'the data is left alone');

  const context = await withAiPageUrls({
    entity: { type: 'applications', id: APPLICATION, ref: 'APP-8' },
    related: [{ relation: 'business_processes', items: [{ type: 'business_processes', id: PROCESS }] }],
  }, { readableResources: reads('business_processes', 'applications'), origin: async () => null });
  assert.equal((context.entity as any).page_url, undefined);
  assert.equal((context.related[0].items[0] as any).page_url, `/master-data/business-processes/${PROCESS}`, 'a linked record');
}

async function testMcpOrigin() {
  const vulnerabilityPage = '/it/vulnerabilities?q=CVE-2024-1&state=all&alerts=all';
  const result = await withAiPageUrls({
    items: [
      { type: 'business_processes', id: PROCESS },
      { type: 'vulnerabilities', id: APPLICATION, metadata: { page_url: vulnerabilityPage } },
    ],
  }, { readableResources: reads('business_processes'), origin: async () => 'https://fromage.kanap.net' });
  assert.equal((result.items[0] as any).page_url, `https://fromage.kanap.net/master-data/business-processes/${PROCESS}`);
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
  for (const family of ['applications', 'assets', 'technologies', 'projects', 'requests', 'tasks', 'documents', 'incidents', 'budget_lines', 'companies', 'departments', 'contracts', 'suppliers', 'contacts']) {
    assert.equal(AI_PAGE_ROUTES[family], undefined, `${family} opens by its reference`);
  }
}

/** A site carries LOC-n in Kad's reads: its page opens by it. A connection without one keeps its id. */
async function testSiteByReference() {
  const result = await withAiPageUrls({
    items: [
      { type: 'locations', id: COMPANY, ref: 'LOC-2', label: 'LOC-2 · Lyon' },
      { type: 'connections', id: PROCESS, ref: null, label: 'CONN-4 - VPN' },
      { type: 'locations', id: APPLICATION, ref: 'Lyon', label: 'Lyon' },
    ],
  }, { readableResources: reads('locations', 'infrastructure'), origin: async () => null });
  assert.deepEqual(result.items.map((item: any) => item.page_url), [
    '/it/locations/LOC-2',
    `/it/connections/${PROCESS}`,
    `/it/locations/${APPLICATION}`,
  ], 'a site by its reference, a record without a reference by its id');
}

/** The page of a record, as an approved change's summary links it: by its reference when its page opens by it. */
function testEntityPageUrl() {
  const cases: Array<[string, string, string]> = [
    ['tasks', 'T-4', '/portfolio/tasks/T-4'],
    ['projects', 'PRJ-3', '/portfolio/projects/PRJ-3'],
    ['requests', 'REQ-2', '/portfolio/requests/REQ-2'],
    ['technologies', 'TEC-7', '/it/technologies/TEC-7'],
    ['documents', 'DOC-5', '/knowledge/DOC-5'],
    ['incidents', 'INC-6', '/it/incidents/INC-6'],
    ['applications', 'APP-8', '/it/applications/APP-8'],
    ['assets', 'AST-9', '/it/assets/AST-9'],
    ['interfaces', 'INT-3', '/it/interfaces/INT-3'],
    ['locations', 'LOC-2', '/it/locations/LOC-2'],
    ['budget_lines', 'BL-12', '/ops/budget/BL-12'],
    ['contracts', 'CTR-2', '/ops/contracts/CTR-2'],
    ['companies', 'COMP-5', '/master-data/companies/COMP-5'],
    ['contacts', 'CTCT-4', '/master-data/contacts/CTCT-4'],
    ['departments', 'DEPT-5', '/master-data/departments/DEPT-5'],
    ['suppliers', 'SUP-3', '/master-data/suppliers/SUP-3'],
    ['contributors', 'MEM-2', '/portfolio/contributors/MEM-2'],
  ];
  for (const [type, ref, url] of cases) assert.equal(entityPageUrl(type, COMPANY, ref), url, `${type} by its reference`);
  // A reference of another family, a legacy budget number, a code or a missing one: the id.
  assert.equal(entityPageUrl('tasks', COMPANY, 'PRJ-3'), `/portfolio/tasks/${COMPANY}`);
  assert.equal(entityPageUrl('budget_lines', COMPANY, 'CPX-2'), `/ops/budget/${COMPANY}`);
  assert.equal(entityPageUrl('accounts', COMPANY, '612100'), `/master-data/accounts/${COMPANY}`);
  assert.equal(entityPageUrl('business_processes', COMPANY, null), `/master-data/business-processes/${COMPANY}`);
  assert.equal(entityPageUrl('suppliers', COMPANY, 'SUP-013'), `/master-data/suppliers/${COMPANY}`);
  assert.equal(entityPageUrl('roles', COMPANY, 'Admin'), null, 'no page builder: no link');
}

async function run() {
  await testListItems();
  await testSiteByReference();
  testEntityPageUrl();
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
