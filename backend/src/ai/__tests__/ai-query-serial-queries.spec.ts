import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AiQueryExecutor } from '../query/ai-query.executor';

/**
 * Budget-line detail, contract detail and incident detail each used to start several reads at
 * once on the request's single connection.
 */
const OVERLAP = 'client.query() when the client is already executing a query';

function busyQuery() {
  let busy = 0;
  let maxBusy = 0;
  let calls = 0;
  const query = async (sql: string) => {
    if (busy > 0) throw new Error(OVERLAP);
    busy += 1;
    maxBusy = Math.max(maxBusy, busy);
    calls += 1;
    try {
      await new Promise((resolve) => setImmediate(resolve));
      if (sql.includes('FROM spend_versions') || sql.includes('FROM contracts c')) return [{}];
      return [];
    } finally {
      busy -= 1;
    }
  };
  return { query, maxBusy: () => maxBusy, calls: () => calls };
}

function executor(parts: {
  budgetLines?: Record<string, unknown>;
  contracts?: Record<string, unknown>;
  incidentRecords?: Record<string, unknown>;
  policy?: Record<string, unknown>;
}) {
  const none = {} as any;
  const args: unknown[] = Array.from({ length: 23 }, () => none);
  args[1] = parts.budgetLines ?? none;
  args[6] = parts.contracts ?? none;
  args[21] = parts.incidentRecords ?? none;
  args[22] = { computeForVersions: async () => new Map() };
  args.push(parts.policy ?? none);
  return new (AiQueryExecutor as unknown as new (...ctor: unknown[]) => AiQueryExecutor)(...args);
}

function context(query: (sql: string) => Promise<unknown>) {
  return {
    tenantId: randomUUID(),
    userId: null,
    manager: { query },
  };
}

async function reads(query: (sql: string) => Promise<unknown>) {
  const hit = async () => {
    await query('SELECT 1');
    return true;
  };
  return { canReadEntityType: hit };
}

async function testBudgetLineDetailIsSerial() {
  const busy = busyQuery();
  const linked = async () => {
    await busy.query('SELECT link');
    return { items: [] as unknown[] };
  };
  const list = async () => {
    await busy.query('SELECT list');
    return [] as unknown[];
  };
  const service = executor({
    policy: await reads(busy.query),
    budgetLines: {
      summaryRowsByIds: async () => {
        await busy.query('SELECT summary');
        return [{}];
      },
      listApplications: linked,
      listProjects: linked,
      listLinks: list,
      listAttachments: list,
    },
    contracts: {
      listContractsForSpendItem: linked,
      listContractsForCapexItem: linked,
    },
  });
  const detail = await (service as any).loadBudgetLineDeepDetail(
    context(busy.query),
    randomUUID(),
    'opex',
    { fields: {} },
  );
  assert.ok(Array.isArray(detail.financial_versions));
  assert.deepEqual(detail.contacts, []);
  assert.deepEqual(detail.linked_applications, { items: [] });
  assert.ok(busy.calls() > 4);
  assert.equal(busy.maxBusy(), 1);
}

async function testContractDetailIsSerial() {
  const busy = busyQuery();
  const service = executor({
    policy: await reads(busy.query),
    contracts: {
      listLinkedCapexItems: async () => {
        await busy.query('SELECT capex');
        return { items: [] };
      },
      listTasks: async () => {
        await busy.query('SELECT tasks');
        return [];
      },
    },
  });
  const detail = await (service as any).loadContractDeepDetail(context(busy.query), randomUUID(), null);
  assert.deepEqual(detail.contacts, []);
  assert.deepEqual(detail.tasks, []);
  assert.ok(busy.calls() > 3);
  assert.equal(busy.maxBusy(), 1);
}

async function testIncidentDetailReadsAreSerial() {
  const busy = busyQuery();
  const incidentId = randomUUID();
  const service = executor({
    policy: await reads(busy.query),
    incidentRecords: {
      load: async () => {
        await busy.query('SELECT incident');
        return {
          incident: { id: incidentId, title: 'Outage' },
          review: null,
          entries: [],
          documents: [],
          attachments: [],
          assets: null,
          applications: null,
          technologies: null,
          tasks: null,
        };
      },
    },
  });
  const detail = await (service as any).executeEntityDetail(
    { ...context(busy.query), tenantId: randomUUID(), userId: null },
    { entity_type: 'incidents', entity_id: incidentId },
  );
  assert.equal(detail.entity.label, 'Outage');
  assert.ok(busy.calls() >= 4);
  assert.equal(busy.maxBusy(), 1);
}

async function run() {
  await testBudgetLineDetailIsSerial();
  await testContractDetailIsSerial();
  await testIncidentDetailReadsAreSerial();
  console.log('ai-query-serial-queries: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
