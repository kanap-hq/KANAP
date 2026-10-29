// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { EntityManager, QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { RecordHistoryService } from '../../audit/record-history.service';
import { audit, seedHistoryData, seedPerson, type HistorySeed, type Person } from '../../audit/__tests__/record-history.fixtures';
import { PermissionsService } from '../../permissions/permissions.service';
import { createRaceTenant, dropRaceTenant, seed } from '../../spend/__tests__/race-harness';
import { User } from '../../users/user.entity';
import { AiPolicyService } from '../ai-policy.service';
import { AiRecordHistoryService, type GetRecordHistoryInput } from '../ai-record-history.service';
import { AiQueryExecutor } from '../query/ai-query.executor';
import type { AiExecutionContextWithManager } from '../ai.types';

// get_record_history against a real database (Plaid L7, lot C): the entries of a record's History
// tab, read by RecordHistoryService under the person's own transaction. The policy is the real one
// (rights read from the person's roles); only the surface check is stubbed. A record is named by
// its reference (TEC-n, OPEX-n, OPX-n, BL-n); a family without a History tab is refused in words;
// a missing right is the usual refusal; a line outside a limited person's data access and a record
// of another tenant are "not found", never a partial history.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

type Seeded = {
  data: HistorySeed;
  successor: string;
  reader: Person;
  budgetOnly: Person;
  limited: Person;
  otherTenantTechnology: string;
};

const SECOND_TENANT_NAME = 'Other tenant Postgres';

function policy(): AiPolicyService {
  const users = {
    findById: (id: string, opts: { manager: EntityManager }) =>
      opts.manager.getRepository(User).findOne({ where: { id }, relations: ['role'] }),
  };
  const service = new AiPolicyService(
    users as any,
    new PermissionsService({} as any, {} as any),
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  (service as any).assertSurfaceAccess = async () => undefined;
  return service;
}

function historyTool(): AiRecordHistoryService {
  // A reference with a pattern (TEC-n, AST-n) or a uuid resolves without the list executor.
  return new AiRecordHistoryService(policy(), Object.create(AiQueryExecutor.prototype), new RecordHistoryService());
}

async function inTransaction<T>(
  tenantId: string,
  person: Person,
  options: { limited?: boolean },
  fn: (context: AiExecutionContextWithManager) => Promise<T>,
): Promise<T> {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    if (options.limited) {
      const rows: Array<{ mode: string }> = await runner.query(`SELECT data_access_apply($1) AS mode`, [person.id]);
      assert.equal(rows[0]?.mode, 'limited', 'the transaction takes the limited role');
    }
    return await fn({
      tenantId,
      userId: person.id,
      isPlatformHost: false,
      surface: 'chat',
      authMethod: 'jwt',
      manager: runner.manager,
    });
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction().catch(() => undefined);
    await runner.release();
  }
}

function read(tenantId: string, person: Person, input: Omit<GetRecordHistoryInput, 'limit'> & { limit?: number }, limited = false) {
  return inTransaction(tenantId, person, { limited }, (context) =>
    historyTool().getRecordHistory(context, { limit: 50, ...input }));
}

async function storedRow(runner: QueryRunner, table: 'technologies' | 'spend_items', id: string): Promise<Record<string, unknown>> {
  const [row] = await runner.query(`SELECT to_jsonb(t) AS row FROM ${table} t WHERE t.id = $1`, [id]);
  return row.row as Record<string, unknown>;
}

async function testTechnologyByReference(seeded: Seeded) {
  const page = await read(seeded.data.tenantId, seeded.reader, { entity_type: 'technologies', entity_id: 'TEC-9' });
  assert.deepEqual(page.items.map((item) => item.action).sort(), ['create', 'update', 'update']);
  assert.deepEqual(page.items.map((item) => item.at), [...page.items.map((item) => item.at)].sort().reverse(), 'newest first');
  assert.equal(page.next_cursor, null);
  assert.equal(page.complete, true);
  assert.match(page.note, /History tab/);
  const rename = page.items.find((item) => item.changes.some((change: any) => change.field === 'name'));
  assert.ok(rename, 'the rename is an entry');
  assert.deepEqual(rename!.changes.find((change: any) => change.field === 'name'), { field: 'name', before: 'Postgres', after: 'PostgreSQL' });
  assert.equal(rename!.actor.name, 'Una Unlimited', 'the author is named');

  const successor = page.items.flatMap((item) => item.changes).find((change: any) => change.field === 'replaced_by_id') as any;
  assert.equal(successor?.after?.reference, 'TEC-10', 'a reference reads as its business reference');
  const serialized = JSON.stringify(page);
  assert.ok(!serialized.includes(seeded.successor), 'no raw uuid where a business reference exists');
  for (const item of page.items) assert.equal((item as any).id, undefined, 'the audit row id stays out');
  console.log('  a technology by TEC-n: its entries, the author, the successor by TEC-10: OK');
}

async function testPagination(seeded: Seeded) {
  const first = await read(seeded.data.tenantId, seeded.reader, { entity_type: 'technologies', entity_id: 'TEC-9', limit: 2 });
  assert.equal(first.returned, 2);
  assert.equal(first.truncated, true);
  assert.equal(first.complete, false);
  assert.ok(first.next_cursor);
  const second = await read(seeded.data.tenantId, seeded.reader, {
    entity_type: 'technologies', entity_id: 'TEC-9', limit: 2, cursor: first.next_cursor!,
  });
  assert.equal(second.returned, 1);
  assert.equal(second.next_cursor, null);
  assert.equal(second.complete, false, 'a later page is not the whole history');
  const all = await read(seeded.data.tenantId, seeded.reader, { entity_type: 'technologies', entity_id: 'TEC-9' });
  assert.deepEqual([...first.items, ...second.items], all.items, 'the two pages are the history, in order');
  await assert.rejects(
    read(seeded.data.tenantId, seeded.reader, { entity_type: 'technologies', entity_id: 'TEC-9', cursor: 'not-a-cursor' }),
    /Invalid cursor/,
  );
  console.log('  the cursor reads the older entries, a forged cursor is refused: OK');
}

async function testBudgetLineByEveryReference(seeded: Seeded) {
  const byOpex = await read(seeded.data.tenantId, seeded.reader, { entity_type: 'budget_lines', entity_id: 'OPEX-1' });
  assert.deepEqual(byOpex.items.map((item) => item.action).sort(), ['create', 'update']);
  const update = byOpex.items.find((item) => item.action === 'update');
  assert.deepEqual(update?.changes, [{ field: 'description', before: 'Main line description', after: 'Renewed description' }]);
  for (const ref of ['OPX-1', 'opx-1', 'BL-1', seeded.data.opexLine]) {
    const page = await read(seeded.data.tenantId, seeded.reader, { entity_type: 'budget_lines', entity_id: ref });
    assert.deepEqual(page.items, byOpex.items, `${ref} names the same line`);
  }
  const capex = await read(seeded.data.tenantId, seeded.reader, { entity_type: 'budget_lines', entity_id: 'BL-2' });
  assert.deepEqual(capex.items.map((item) => item.action), ['create'], 'a CAPEX line, by its BL reference');
  await assert.rejects(
    read(seeded.data.tenantId, seeded.reader, { entity_type: 'budget_lines', entity_id: 'OPEX-999' }),
    /No budget_lines record matches "OPEX-999"/,
  );
  console.log('  a budget line by OPEX-n, OPX-n, BL-n or its uuid, both natures: OK');
}

async function testFamilyWithoutHistory(seeded: Seeded) {
  await assert.rejects(
    read(seeded.data.tenantId, seeded.reader, { entity_type: 'applications', entity_id: 'APP-42' }),
    (error: any) => {
      assert.equal(error.status, 400);
      assert.match(error.message, /^This record has no history in KANAP: applications have no History tab\./);
      assert.match(error.message, /budget lines/);
      assert.match(error.message, /technologies/);
      assert.doesNotMatch(error.message, /cost centers|working day/);
      console.log(`  refusal: ${error.message}`);
      return true;
    },
  );
  for (const entityType of ['contracts', 'projects', 'requests', 'tasks', 'incidents', 'users'] as const) {
    await assert.rejects(
      read(seeded.data.tenantId, seeded.reader, { entity_type: entityType, entity_id: randomUUID() }),
      /no history in KANAP/,
      entityType,
    );
  }
  console.log('  a family without a History tab is refused in words: OK');
}

async function testReaderWithoutTheRight(seeded: Seeded) {
  await assert.rejects(
    read(seeded.data.tenantId, seeded.budgetOnly, { entity_type: 'technologies', entity_id: 'TEC-9' }),
    (error: any) => {
      assert.equal(error.status, 403);
      assert.match(error.message, /^You need the right to read IT infrastructure \(assets, connections, technologies\)/);
      return true;
    },
  );
  console.log('  a reader without the right of the record is refused with the right it needs: OK');
}

async function testLimitedPerson(seeded: Seeded) {
  const own = await read(seeded.data.tenantId, seeded.limited, { entity_type: 'budget_lines', entity_id: 'OPX-1' }, true);
  assert.equal(own.items.length, 2, 'a line of the person\'s company reads');
  for (const ref of ['OPX-3', 'BL-3', seeded.data.hiddenLine]) {
    await assert.rejects(
      read(seeded.data.tenantId, seeded.limited, { entity_type: 'budget_lines', entity_id: ref }, true),
      (error: any) => {
        assert.equal(error.status, 404, ref);
        assert.match(error.message, /^No budget_lines record matches/);
        return true;
      },
    );
  }
  const unrestricted = await read(seeded.data.tenantId, seeded.reader, { entity_type: 'budget_lines', entity_id: 'OPX-3' });
  assert.equal(unrestricted.items.length, 1, 'the same line reads for a person without a limit');
  console.log('  a line outside a limited person\'s data access is not found: OK');
}

async function testOtherTenant(seeded: Seeded) {
  await assert.rejects(
    read(seeded.data.tenantId, seeded.reader, { entity_type: 'technologies', entity_id: seeded.otherTenantTechnology }),
    (error: any) => {
      assert.equal(error.status, 404);
      assert.doesNotMatch(error.message, new RegExp(SECOND_TENANT_NAME));
      return true;
    },
  );
  const own = await read(seeded.data.tenantId, seeded.reader, { entity_type: 'technologies', entity_id: 'TEC-9' });
  assert.ok(!JSON.stringify(own).includes(SECOND_TENANT_NAME), 'TEC-9 is the tenant\'s own technology');
  console.log('  a record of another tenant is not found: OK');
}

/**
 * A record whose newest entries are updates with no visible change (left out by the History tab):
 * the first page reads past them to the entry before (Plaid L7, lot E), within five pages.
 */
async function testEmptyPagesAreReadPast(seeded: Seeded) {
  const line = await seed(seeded.data.tenantId, (runner) => storedRow(runner, 'spend_items', seeded.data.capexLine));
  const invisible = () => seed(seeded.data.tenantId, (runner) => audit(runner, {
    table: 'spend_items', recordId: seeded.data.capexLine, action: 'update', before: line, after: line, userId: seeded.reader.id,
  }));
  await invisible();
  const page = await read(seeded.data.tenantId, seeded.reader, { entity_type: 'budget_lines', entity_id: seeded.data.capexLine, limit: 1 });
  assert.deepEqual(page.items.map((item) => item.action), ['create'], 'the entry before the update with no visible change');
  assert.equal(page.returned, 1);

  for (let i = 0; i < 5; i += 1) await invisible();
  const capped = await read(seeded.data.tenantId, seeded.reader, { entity_type: 'budget_lines', entity_id: seeded.data.capexLine, limit: 1 });
  assert.deepEqual([capped.returned, capped.truncated], [0, true], 'five empty pages at most, then the cursor');
  const next = await read(seeded.data.tenantId, seeded.reader, {
    entity_type: 'budget_lines', entity_id: seeded.data.capexLine, limit: 1, cursor: capped.next_cursor!,
  });
  assert.deepEqual(next.items.map((item) => item.action), ['create'], 'the cursor reads on');
  console.log('  an empty page is read past, five pages at most: OK');
}

async function seedAll(tenantId: string, otherTenantId: string): Promise<Seeded> {
  const base = await seed(tenantId, async (runner) => {
    const data = await seedHistoryData(runner, tenantId);
    const [successor] = await runner.query(
      `INSERT INTO technologies (tenant_id, item_number, name, family) VALUES ($1, 10, 'Postgres 17', 'database') RETURNING id`,
      [tenantId],
    );
    const reader = await seedPerson(runner, tenantId, { first: 'Una', last: 'Unlimited' }, { infrastructure: 'reader', budget: 'reader', applications: 'reader' });
    const budgetOnly = await seedPerson(runner, tenantId, { first: 'Bob', last: 'Budget' }, { budget: 'reader' });
    const limited = await seedPerson(runner, tenantId, { first: 'Lila', last: 'Limited' }, { budget: 'reader' }, { mode: 'limited', nodeCompanyId: data.companyA });
    const technology = await storedRow(runner, 'technologies', data.technology);
    await audit(runner, { table: 'technologies', recordId: data.technology, action: 'create', after: technology, userId: reader.id });
    const line = await storedRow(runner, 'spend_items', data.opexLine);
    await audit(runner, { table: 'spend_items', recordId: data.opexLine, action: 'create', after: line, userId: reader.id });
    const capex = await storedRow(runner, 'spend_items', data.capexLine);
    await audit(runner, { table: 'capex_items', recordId: data.capexLine, action: 'create', after: capex, userId: reader.id });
    const hidden = await storedRow(runner, 'spend_items', data.hiddenLine);
    await audit(runner, { table: 'spend_items', recordId: data.hiddenLine, action: 'create', after: hidden, userId: reader.id });
    return { data, successor: successor.id as string, reader, budgetOnly, limited, technology, line };
  });
  // One transaction per change: each entry gets its own time, as in the application.
  await seed(tenantId, (runner) => audit(runner, {
    table: 'technologies', recordId: base.data.technology, action: 'update',
    before: base.technology, after: { ...base.technology, name: 'PostgreSQL' }, userId: base.reader.id,
  }));
  await seed(tenantId, (runner) => audit(runner, {
    table: 'technologies', recordId: base.data.technology, action: 'update',
    before: { ...base.technology, name: 'PostgreSQL' }, after: { ...base.technology, name: 'PostgreSQL', replaced_by_id: base.successor }, userId: base.reader.id,
  }));
  await seed(tenantId, (runner) => audit(runner, {
    table: 'spend_items', recordId: base.data.opexLine, action: 'update',
    before: base.line, after: { ...base.line, description: 'Renewed description' }, userId: base.reader.id,
  }));
  const otherTenantTechnology = await seed(otherTenantId, async (runner) => {
    const [row] = await runner.query(
      `INSERT INTO technologies (tenant_id, item_number, name, family) VALUES ($1, 9, $2, 'database') RETURNING id`,
      [otherTenantId, SECOND_TENANT_NAME],
    );
    const stored = await storedRow(runner, 'technologies', row.id);
    await audit(runner, { table: 'technologies', recordId: row.id, action: 'create', after: stored });
    return row.id as string;
  });
  return { data: base.data, successor: base.successor, reader: base.reader, budgetOnly: base.budgetOnly, limited: base.limited, otherTenantTechnology };
}

async function run() {
  await dataSource.initialize();
  const tenantId = await createRaceTenant('ai-record-history');
  const otherTenantId = await createRaceTenant('ai-record-history-other');
  try {
    const seeded = await seedAll(tenantId, otherTenantId);
    console.log('get_record_history');
    await testTechnologyByReference(seeded);
    await testPagination(seeded);
    await testBudgetLineByEveryReference(seeded);
    await testFamilyWithoutHistory(seeded);
    await testReaderWithoutTheRight(seeded);
    await testLimitedPerson(seeded);
    await testOtherTenant(seeded);
    await testEmptyPagesAreReadPast(seeded);
    console.log('ai-record-history.integration.spec: ok');
  } finally {
    await dropRaceTenant(tenantId);
    await dropRaceTenant(otherTenantId);
    await dataSource.destroy();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
