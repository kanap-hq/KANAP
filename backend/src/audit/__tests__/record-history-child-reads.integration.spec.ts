// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { createRaceTenant, dropRaceTenant, seed } from '../../spend/__tests__/race-harness';
import { RECORD_HISTORY, type RecordHistoryRecord } from '../record-history.inventory';
import {
  RecordHistoryService,
  type RecordHistoryContext,
  type RecordHistoryPage,
} from '../record-history.service';
import { audit, seedPerson, type Person } from './record-history.fixtures';

// The two other shapes of a record's child (lot 2, R1c), on a fictional record whose children no
// real family uses yet: a link read by `record_id` (the record itself, shown as its child kind)
// and a link read by a key of its payload (its `record_id` is the link, its parent another record).
// The key branch reads a creation, an update and a deletion (`after_json` NULL); a foreign tenant
// with the same key value never comes out; a row two branches both find appears once; the cursor
// pages the three branches with no duplicate and no gap, one row and two rows at a time.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

const RECORD_CHILD = 'test_child_record';
const KEY_CHILD = 'test_child_key';
const PERMISSIONS = { accounts: 'reader' } as const;

type Seeded = {
  tenantId: string;
  foreignTenantId: string;
  account: string;
  reader: Person;
  ids: {
    ownCreate: string;
    ownUpdate: string;
    recordCreate: string;
    recordUpdate: string;
    keyCreate: string;
    keyUpdate: string;
    keyDelete: string;
    keyWithParent: string;
    foreignKey: string;
    otherLabel: string;
  };
};

async function one(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  const [row] = await runner.query(sql, params);
  return row.id as string;
}

function childReadEntry(): RecordHistoryRecord {
  const base = RECORD_HISTORY.accounts;
  return {
    ...base,
    children: { ...base.children, [RECORD_CHILD]: 'link', [KEY_CHILD]: 'contact' },
    childReads: { [RECORD_CHILD]: 'record', [KEY_CHILD]: { payloadKey: 'contact_id' } },
  };
}

async function readPage(
  person: Person,
  tenantId: string,
  table: string,
  id: string,
  options: { cursor?: string | null; limit?: unknown } = {},
): Promise<RecordHistoryPage> {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    const ctx: RecordHistoryContext = {
      tenantId,
      userId: person.id,
      isAdmin: false,
      permissions: PERMISSIONS,
      manager: runner.manager,
    };
    return await new RecordHistoryService().list(ctx, table, id, options);
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction().catch(() => undefined);
    await runner.release();
  }
}

async function seedAll(): Promise<Seeded> {
  const tenantId = await createRaceTenant('record-history-child-reads');
  const foreignTenantId = await createRaceTenant('record-history-child-reads-foreign');
  try {
    const data = await seed(tenantId, async (runner) => {
      const coa = await one(
        runner,
        `INSERT INTO chart_of_accounts (tenant_id, code, name, scope, country_iso, is_default)
         VALUES ($1, 'FR', 'Local chart', 'COUNTRY', 'FR', true) RETURNING id`,
        [tenantId],
      );
      const account = await one(
        runner,
        `INSERT INTO accounts (tenant_id, coa_id, account_number, account_name, status)
         VALUES ($1, $2, 4010, 'Software', 'enabled') RETURNING id`,
        [tenantId, coa],
      );
      const reader = await seedPerson(runner, tenantId, { first: 'Ada', last: 'Child' }, PERMISSIONS);
      const otherParent = randomUUID();
      const keyLink = randomUUID();

      const ownCreate = await audit(runner, {
        table: 'accounts', recordId: account, action: 'create', userId: reader.id,
        after: { id: account, tenant_id: tenantId, account_number: '4010', account_name: 'Software', status: 'enabled' },
      });
      const ownUpdate = await audit(runner, {
        table: 'accounts', recordId: account, action: 'update', userId: reader.id,
        before: { id: account, account_name: 'Software' },
        after: { id: account, account_name: 'Software and services' },
      });

      // The link's audit row carries the record in `record_id`; the parent branch also finds the
      // second one, so the page must keep it once.
      const recordCreate = await audit(runner, {
        table: RECORD_CHILD, recordId: account, action: 'create', userId: reader.id,
        // Another record is the parent: the first branch still finds the row by its `record_id`,
        // the shape of an asset link read from the technology.
        parent: { table: 'cost_centers', id: otherParent },
        after: { description: 'Record child created' },
      });
      const recordUpdate = await audit(runner, {
        table: RECORD_CHILD, recordId: account, action: 'update', userId: reader.id,
        parent: { table: 'accounts', id: account },
        before: { description: 'Record child created' },
        after: { description: 'Record child updated' },
      });

      // The contact link's `record_id` is the link; a cost center is its parent. The third row is a
      // creation, the fourth an update and the fifth a deletion (`after_json` NULL).
      const keyCreate = await audit(runner, {
        table: KEY_CHILD, recordId: keyLink, action: 'create', userId: reader.id,
        parent: { table: 'cost_centers', id: otherParent },
        after: { contact_id: account, role: 'commercial' },
      });
      const keyUpdate = await audit(runner, {
        table: KEY_CHILD, recordId: keyLink, action: 'update', userId: reader.id,
        parent: { table: 'cost_centers', id: otherParent },
        before: { contact_id: account, role: 'commercial' },
        after: { contact_id: account, role: 'technical' },
      });
      const keyDelete = await audit(runner, {
        table: KEY_CHILD, recordId: keyLink, action: 'delete', userId: reader.id,
        parent: { table: 'cost_centers', id: otherParent },
        before: { contact_id: account, role: 'technical' },
        after: null,
      });
      // This key row also has the record as its parent: the parent branch and the key branch both
      // find it, and the page keeps it once.
      const keyWithParent = await audit(runner, {
        table: KEY_CHILD, recordId: randomUUID(), action: 'create', userId: reader.id,
        parent: { table: 'accounts', id: account },
        after: { contact_id: account, role: 'owner' },
      });
      // A label outside the entry's children, with the same key value, is not a child of the record.
      const otherLabel = await audit(runner, {
        table: 'test_other_label', recordId: randomUUID(), action: 'create', userId: reader.id,
        after: { contact_id: account },
      });
      return {
        account, reader,
        ids: { ownCreate, ownUpdate, recordCreate, recordUpdate, keyCreate, keyUpdate, keyDelete, keyWithParent, otherLabel },
      };
    });

    const foreignKey = await seed(foreignTenantId, async (runner) => {
      const id = await audit(runner, {
        table: KEY_CHILD, recordId: randomUUID(), action: 'create',
        after: { contact_id: data.account, role: 'foreign-role' },
      });
      return id;
    });

    return {
      tenantId,
      foreignTenantId,
      account: data.account,
      reader: data.reader,
      ids: { ...data.ids, foreignKey },
    };
  } catch (error) {
    await dropRaceTenant(tenantId).catch(() => undefined);
    await dropRaceTenant(foreignTenantId).catch(() => undefined);
    throw error;
  }
}

function assertChildShapes(page: RecordHistoryPage) {
  const kinds = page.items.map((item) => item.subject.kind);
  assert.equal(kinds.filter((kind) => kind === 'record').length, 2, 'the record own rows stay record entries');
  assert.equal(kinds.filter((kind) => kind === 'link').length, 2, 'a record-mode child shows as its own kind');
  assert.equal(kinds.filter((kind) => kind === 'contact').length, 4, 'a payload-key child shows as its own kind');
  const actions = page.items.filter((item) => item.subject.kind === 'contact').map((item) => item.action);
  assert.ok(actions.includes('create'), 'the key creation is present');
  assert.ok(actions.includes('update'), 'the key update is present');
  assert.ok(actions.includes('delete'), 'the key deletion is present');
  const deletion = page.items.find((item) => item.subject.kind === 'contact' && item.action === 'delete');
  assert.ok(deletion?.changes.some((change) => change.event === 'removed'), 'the deletion reads as a removed contact');
}

async function testShapesAndTenant(seeded: Seeded) {
  const page = await readPage(seeded.reader, seeded.tenantId, 'accounts', seeded.account, { limit: '100' });
  assert.equal(page.items.length, 8, 'one entry per matching row, a row found by two branches kept once');
  assert.equal(new Set(page.items.map((item) => item.id)).size, page.items.length, 'no duplicated entry');
  assertChildShapes(page);

  const ids = new Set(page.items.map((item) => item.id));
  assert.ok(ids.has(seeded.ids.keyCreate) && ids.has(seeded.ids.keyUpdate) && ids.has(seeded.ids.keyDelete), 'the three key writes are present');
  assert.ok(ids.has(seeded.ids.keyWithParent), 'the key row with the record as parent is present once');
  assert.ok(ids.has(seeded.ids.recordCreate) && ids.has(seeded.ids.recordUpdate), 'the record-mode children are present');
  assert.equal(ids.has(seeded.ids.foreignKey), false, 'a foreign tenant row with the same key value never comes out');
  assert.equal(ids.has(seeded.ids.otherLabel), false, 'a label outside the children never comes out');
  assert.equal(page.items.some((item) => item.actor.kind === 'system'), false, 'the foreign system row did not leak');
  console.log('  record-mode child, key child (create, update, delete), one entry per row, tenant and label filters: OK');
}

async function pageIds(seeded: Seeded, limit: number): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | null = null;
  const seen: string[] = [];
  for (let guard = 0; guard < 50; guard += 1) {
    const page = await readPage(seeded.reader, seeded.tenantId, 'accounts', seeded.account, { limit, cursor });
    assert.ok(page.items.length <= limit, `page of ${limit} has at most ${limit} entries`);
    ids.push(...page.items.map((item) => item.id));
    seen.push(page.nextCursor ?? 'end');
    cursor = page.nextCursor;
    if (!cursor) break;
  }
  assert.equal(ids.length, new Set(ids).size, `pages of ${limit} have no duplicate`);
  return ids;
}

async function testPagination(seeded: Seeded, full: RecordHistoryPage) {
  const expected = full.items.map((item) => item.id);
  for (const limit of [1, 2]) {
    const ids = await pageIds(seeded, limit);
    assert.deepEqual(ids, expected, `pages of ${limit} read every row once, in order, with no gap`);
  }
  console.log('  cursor over the three branches, pages of 1 and 2, no duplicate and no gap: OK');
}

async function run() {
  await dataSource.initialize();
  const registry = RECORD_HISTORY as unknown as Record<string, RecordHistoryRecord>;
  const original = registry.accounts;
  registry.accounts = childReadEntry();
  let seeded: Seeded | null = null;
  try {
    const data = await seedAll();
    seeded = data;
    console.log('record history child reads');
    await testShapesAndTenant(data);
    const full = await readPage(data.reader, data.tenantId, 'accounts', data.account, { limit: '100' });
    await testPagination(data, full);
    console.log('record-history-child-reads.integration.spec: ok');
  } finally {
    registry.accounts = original;
    if (seeded) {
      await dropRaceTenant(seeded.tenantId);
      await dropRaceTenant(seeded.foreignTenantId);
    }
    await dataSource.destroy();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
