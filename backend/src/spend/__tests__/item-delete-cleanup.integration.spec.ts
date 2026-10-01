import 'dotenv/config';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { SpendItem } from '../spend-item.entity';
import { SpendItemsDeleteService } from '../spend-items-delete.service';
import { CapexItem } from '../../capex/capex-item.entity';
import { CapexItemsDeleteService } from '../../capex/capex-items-delete.service';
import { UserTimeAggregateService } from '../../portfolio/services/user-time-aggregate.service';
import {
  assert, AuditEntry, freezeColumn, inRolledBackTransaction, Kind, runSpecs, seedItem, seedMonths, seedTenant, seedVersion, setBudgetColumns,
} from './round-inputs.fixtures';

// Deleting an item of either type removes the rows that have no foreign key to
// it (links, attachments, contract links) and its tasks; a task turned into a
// request keeps the request, whose history names the task; time aggregates
// follow; unshared files go. A bulk delete undoes a failing item alone. A line
// with amounts in a frozen column cannot be deleted.

const T = {
  opex: { items: 'spend_items', column: 'spend_item_id', links: 'spend_links', attachments: 'spend_attachments', contracts: 'contract_spend_items', taskType: 'spend_item', amounts: 'spend_amounts' },
  capex: { items: 'capex_items', column: 'capex_item_id', links: 'capex_links', attachments: 'capex_attachments', contracts: 'contract_capex_items', taskType: 'capex_item', amounts: 'capex_amounts' },
} as const;

function fakeStorage() {
  const deleted: string[] = [];
  return { deleted, deleteObject: async (key: string) => { deleted.push(key); } };
}

/** Audit double; `sqlFailOn` runs a failing statement, which aborts the transaction like a real database error. */
function auditDouble(sqlFailOn?: (entry: AuditEntry) => boolean) {
  const entries: AuditEntry[] = [];
  return {
    entries,
    log: async (entry: AuditEntry, opts?: { manager?: any }) => {
      if (sqlFailOn?.(entry)) await opts!.manager.query('SELECT 1 / 0');
      entries.push(entry);
    },
  };
}

function deleteService(kind: Kind, runner: QueryRunner, audit: unknown, storage: unknown) {
  const aggregates = new UserTimeAggregateService();
  return kind === 'opex'
    ? new SpendItemsDeleteService(
      runner.manager.getRepository(SpendItem), undefined as any, undefined as any, undefined as any, audit as any, storage as any, aggregates,
    )
    : new CapexItemsDeleteService(
      runner.manager.getRepository(CapexItem), undefined as any, undefined as any, undefined as any, audit as any, storage as any, aggregates,
    );
}

async function seedUser(runner: QueryRunner, tenantId: string) {
  const [role] = await runner.query(
    `INSERT INTO roles (tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
     VALUES ($1, 'Delete test role', 'Delete test role', false, false, now(), now()) RETURNING id`,
    [tenantId],
  );
  const [user] = await runner.query(
    `INSERT INTO users (tenant_id, role_id, email, first_name, last_name, status, locale)
     VALUES ($1, $2, $3, 'Delete', 'Test', 'enabled', 'en') RETURNING id`,
    [tenantId, role.id, `delete-${tenantId.slice(0, 8)}@example.com`],
  );
  return user.id as string;
}

async function seedContract(runner: QueryRunner, tenantId: string) {
  const [company] = await runner.query(
    `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'Delete company', 'FR', 'Lyon') RETURNING id`,
    [tenantId],
  );
  const [supplier] = await runner.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Delete supplier') RETURNING id`, [tenantId]);
  const [contract] = await runner.query(
    `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date, duration_months, notice_period_months)
     VALUES ($1, 'Delete contract', $2, $3, '2026-01-01', 12, 1) RETURNING id`,
    [tenantId, company.id, supplier.id],
  );
  return contract.id as string;
}

async function seedLink(runner: QueryRunner, kind: Kind, tenantId: string, itemId: string) {
  await runner.query(`INSERT INTO ${T[kind].links} (tenant_id, ${T[kind].column}, url) VALUES ($1, $2, 'https://example.com')`, [tenantId, itemId]);
}

async function seedAttachment(runner: QueryRunner, kind: Kind, tenantId: string, itemId: string, storagePath: string) {
  await runner.query(
    `INSERT INTO ${T[kind].attachments} (tenant_id, ${T[kind].column}, original_filename, stored_filename, storage_path)
     VALUES ($1, $2, 'file.pdf', 'file.pdf', $3)`,
    [tenantId, itemId, storagePath],
  );
}

async function seedContractLink(runner: QueryRunner, kind: Kind, tenantId: string, contractId: string, itemId: string) {
  await runner.query(`INSERT INTO ${T[kind].contracts} (tenant_id, contract_id, ${T[kind].column}) VALUES ($1, $2, $3)`, [tenantId, contractId, itemId]);
}

async function seedTask(runner: QueryRunner, tenantId: string, itemNumber: number, type: string, objectId: string) {
  const [row] = await runner.query(
    `INSERT INTO tasks (tenant_id, item_number, title, related_object_type, related_object_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [tenantId, itemNumber, `Task ${itemNumber}`, type, objectId],
  );
  return row.id as string;
}

async function seedTimeEntry(runner: QueryRunner, tenantId: string, taskId: string, userId: string, hours: number) {
  await runner.query(
    `INSERT INTO task_time_entries (tenant_id, task_id, user_id, hours, logged_at) VALUES ($1, $2, $3, $4, '2026-03-15T10:00:00Z')`,
    [tenantId, taskId, userId, hours],
  );
}

async function seedRequest(runner: QueryRunner, tenantId: string, itemNumber: number, originTaskId: string) {
  const [row] = await runner.query(
    `INSERT INTO portfolio_requests (tenant_id, item_number, name, origin_task_id) VALUES ($1, $2, $3, $4) RETURNING id`,
    [tenantId, itemNumber, `Request ${itemNumber}`, originTaskId],
  );
  return row.id as string;
}

async function count(runner: QueryRunner, table: string, column: string, id: string) {
  const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${column} = $1`, [id]);
  return n as number;
}

async function testDeleteCleansUp(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `${kind}-del-clean`);
    const userId = await seedUser(runner, tenantId);
    const contractId = await seedContract(runner, tenantId);
    const deleted = await seedItem(runner, kind, tenantId, 1, 'Deleted line');
    const kept = await seedItem(runner, kind, tenantId, 2, 'Kept line');
    const base = `files/${tenantId}/${kind}`;
    const ownPath = `${base}/${deleted}/own.pdf`;
    const sharedPath = `${base}/${kept}/shared.pdf`;

    for (const itemId of [deleted, kept]) {
      await seedLink(runner, kind, tenantId, itemId);
      await seedContractLink(runner, kind, tenantId, contractId, itemId);
    }
    await seedAttachment(runner, kind, tenantId, deleted, ownPath);
    await seedAttachment(runner, kind, tenantId, deleted, sharedPath);
    await seedAttachment(runner, kind, tenantId, kept, sharedPath);

    const deletedTask = await seedTask(runner, tenantId, 1, T[kind].taskType, deleted);
    const keptTask = await seedTask(runner, tenantId, 2, T[kind].taskType, kept);
    await seedTimeEntry(runner, tenantId, deletedTask, userId, 5);
    await seedTimeEntry(runner, tenantId, keptTask, userId, 3);
    await runner.query(
      `INSERT INTO user_time_monthly_aggregates (tenant_id, user_id, year_month, project_hours, other_hours, total_hours)
       VALUES ($1, $2, '2026-03-01', 0, 8, 8)`,
      [tenantId, userId],
    );
    const convertedRequest = await seedRequest(runner, tenantId, 1, deletedTask);
    const otherRequest = await seedRequest(runner, tenantId, 2, keptTask);

    const audit = auditDouble();
    const storage = fakeStorage();
    await deleteService(kind, runner, audit, storage).delete(deleted, { manager: runner.manager, userId });

    for (const [table, column] of [[T[kind].links, T[kind].column], [T[kind].attachments, T[kind].column], [T[kind].contracts, T[kind].column]]) {
      assert.equal(await count(runner, table, column, deleted), 0, `${kind}: ${table} rows of the deleted item are gone`);
      assert.equal(await count(runner, table, column, kept), 1, `${kind}: ${table} rows of the other item stay`);
    }
    assert.equal(await count(runner, T[kind].items, 'id', deleted), 0, `${kind}: the item is deleted`);
    assert.equal(await count(runner, 'tasks', 'id', deletedTask), 0, `${kind}: its task is deleted`);
    assert.equal(await count(runner, 'tasks', 'id', keptTask), 1, `${kind}: the other item's task stays`);

    assert.deepEqual(storage.deleted, [ownPath], `${kind}: only the unshared file is deleted`);

    const requests = await runner.query(
      `SELECT id, origin_task_id FROM portfolio_requests WHERE tenant_id = $1 ORDER BY item_number`,
      [tenantId],
    );
    assert.deepEqual(
      requests.map((r: any) => [r.id, r.origin_task_id]),
      [[convertedRequest, null], [otherRequest, keptTask]],
      `${kind}: the converted request is kept without its task link`,
    );
    const requestAudit = audit.entries.filter((e) => e.table === 'portfolio_requests');
    assert.deepEqual(requestAudit, [{
      table: 'portfolio_requests',
      recordId: convertedRequest,
      action: 'update',
      // The period review reads the label: the task row is gone with this delete.
      before: { origin_task: 'T-1: Task 1', __origin_task_id: deletedTask },
      after: { origin_task: null, __origin_task_id: null },
      userId,
    }], `${kind}: one audit row for the request`);
    assert.deepEqual(audit.entries.map((e) => `${e.table}:${e.action}`), ['portfolio_requests:update', `${T[kind].items}:delete`]);
    // The request's history names the task it no longer links to (the task row is gone).
    const activities = await runner.query(
      `SELECT request_id, author_id, type, changed_fields FROM portfolio_activities WHERE tenant_id = $1 ORDER BY created_at`,
      [tenantId],
    );
    assert.deepEqual(activities, [{
      request_id: convertedRequest,
      author_id: userId,
      type: 'change',
      changed_fields: { origin_task_id: ['T-1: Task 1', null] },
    }], `${kind}: one request activity names the task`);

    const [aggregate] = await runner.query(
      `SELECT total_hours::float AS total, other_hours::float AS other FROM user_time_monthly_aggregates
       WHERE tenant_id = $1 AND user_id = $2 AND year_month = '2026-03-01'`,
      [tenantId, userId],
    );
    assert.deepEqual(aggregate, { total: 3, other: 3 }, `${kind}: the month keeps only the other task's hours`);
  });
}

async function testBulkDeleteIsolatesAFailingItem(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `${kind}-del-bulk`);
    const ids = [
      await seedItem(runner, kind, tenantId, 1, 'First'),
      await seedItem(runner, kind, tenantId, 2, 'Middle'),
      await seedItem(runner, kind, tenantId, 3, 'Third'),
    ];
    const paths = ids.map((id) => `files/${tenantId}/${kind}/${id}/file.pdf`);
    for (const [i, id] of ids.entries()) {
      await seedLink(runner, kind, tenantId, id);
      await seedAttachment(runner, kind, tenantId, id, paths[i]);
    }

    const audit = auditDouble((e) => e.table === T[kind].items && e.recordId === ids[1]);
    const storage = fakeStorage();
    const result = await deleteService(kind, runner, audit, storage).bulkDelete(ids, null, { manager: runner.manager });

    assert.deepEqual(result.deleted, [ids[0], ids[2]], `${kind}: first and third deleted`);
    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0].id, ids[1]);
    assert.equal(result.failed[0].name, 'Middle', `${kind}: the failed item is named`);
    assert.equal(result.failed[0].reason, 'This line could not be deleted', `${kind}: plain reason, no database message`);

    assert.ok(runner.isTransactionActive, `${kind}: the request transaction is still open`);
    for (const [i, id] of ids.entries()) {
      const expected = i === 1 ? 1 : 0;
      assert.equal(await count(runner, T[kind].items, 'id', id), expected, `${kind}: item ${i + 1}`);
      assert.equal(await count(runner, T[kind].links, T[kind].column, id), expected, `${kind}: links of item ${i + 1}`);
      assert.equal(await count(runner, T[kind].attachments, T[kind].column, id), expected, `${kind}: attachments of item ${i + 1}`);
    }
    assert.deepEqual(storage.deleted, [paths[0], paths[2]], `${kind}: the failed item keeps its file`);
    assert.deepEqual(audit.entries.map((e) => e.recordId), [ids[0], ids[2]]);
  });
}

const FROZEN_MESSAGE = 'This line has amounts in Plan initial 2026, a frozen budget column. '
  + 'Unfreeze the column first, or set an end of validity date instead of deleting the line.';

/** Freezes the Budget column of 2026 (named "Plan initial" by the tenant); returns the line's 2026 version. */
async function seedFrozenBudget(runner: QueryRunner, kind: Kind, tenantId: string, itemId: string, planned: number) {
  await setBudgetColumns(runner, tenantId, { labels: { planned: 'Plan initial' } });
  await freezeColumn(runner, kind, tenantId, 2026, 'budget');
  const versionId = await seedVersion(runner, kind, tenantId, itemId, 2026);
  // Forecast 2026 is not frozen: its amounts never block the delete.
  await seedMonths(runner, kind, tenantId, versionId, 2026, { planned: Array(12).fill(planned), forecast: Array(12).fill(7) });
  return versionId;
}

async function testDeleteRefusedWithFrozenAmounts(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `${kind}-del-frozen`);
    const itemId = await seedItem(runner, kind, tenantId, 1, 'Frozen line');
    const versionId = await seedFrozenBudget(runner, kind, tenantId, itemId, 10);
    await seedLink(runner, kind, tenantId, itemId);
    const audit = auditDouble();

    await runner.query('SAVEPOINT frozen_delete');
    await assert.rejects(
      deleteService(kind, runner, audit, fakeStorage()).delete(itemId, { manager: runner.manager, userId: null }),
      (err: any) => err?.status === 403 && err.message === FROZEN_MESSAGE,
      `${kind}: the delete is refused, naming the column and the year`,
    );
    await runner.query('ROLLBACK TO SAVEPOINT frozen_delete');
    assert.equal(await count(runner, T[kind].items, 'id', itemId), 1, `${kind}: the line stays`);
    assert.equal(await count(runner, T[kind].links, T[kind].column, itemId), 1, `${kind}: its links stay`);
    assert.equal(await count(runner, T[kind].amounts, 'version_id', versionId), 12, `${kind}: its amounts stay`);
    assert.deepEqual(audit.entries, [], `${kind}: nothing audited`);
  });
}

async function testBulkDeleteReportsTheFrozenItem(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `${kind}-del-frozen-bulk`);
    const ids = [
      await seedItem(runner, kind, tenantId, 1, 'First'),
      await seedItem(runner, kind, tenantId, 2, 'Frozen'),
      await seedItem(runner, kind, tenantId, 3, 'Third'),
    ];
    await seedFrozenBudget(runner, kind, tenantId, ids[1], 10);
    // The others have amounts only in columns or years that are not frozen.
    const other = await seedVersion(runner, kind, tenantId, ids[0], 2025);
    await seedMonths(runner, kind, tenantId, other, 2025, { planned: Array(12).fill(5) });

    const result = await deleteService(kind, runner, auditDouble(), fakeStorage()).bulkDelete(ids, null, { manager: runner.manager });
    assert.deepEqual(result.deleted, [ids[0], ids[2]], `${kind}: the other lines are deleted`);
    assert.deepEqual(
      result.failed.map((f) => [f.id, f.name, f.reason]),
      [[ids[1], 'Frozen', FROZEN_MESSAGE]],
      `${kind}: the frozen line is reported with the reason`,
    );
    assert.ok(runner.isTransactionActive, `${kind}: the request transaction is still open`);
    assert.deepEqual(
      await Promise.all(ids.map((id) => count(runner, T[kind].items, 'id', id))),
      [0, 1, 0],
      `${kind}: only the frozen line stays`,
    );
  });
}

async function testDeleteAllowedWhenTheFrozenYearIsZero(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `${kind}-del-frozen-zero`);
    const itemId = await seedItem(runner, kind, tenantId, 1, 'Zero line');
    const versionId = await seedFrozenBudget(runner, kind, tenantId, itemId, 0);
    await deleteService(kind, runner, auditDouble(), fakeStorage()).delete(itemId, { manager: runner.manager, userId: null });
    assert.equal(await count(runner, T[kind].items, 'id', itemId), 0, `${kind}: the line is deleted`);
    assert.equal(await count(runner, T[kind].amounts, 'version_id', versionId), 0, `${kind}: with its amounts`);
  });
}

/** The request manager, except that the file reference check fails with a database error when it sees `failingPath`. */
function managerFailingReferenceCheck(runner: QueryRunner, failingPath: string) {
  const manager = runner.manager as any;
  return new Proxy(manager, {
    get(target, prop) {
      if (prop === 'query') {
        return async (sql: string, params?: any[]) => {
          if (sql.includes('storage_path = ANY') && Array.isArray(params?.[1]) && params![1].includes(failingPath)) {
            await target.query('SELECT 1 / 0');
          }
          return target.query(sql, params);
        };
      }
      const value = target[prop];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

async function testBulkDeleteReferenceCheckFailsItsItemOnly(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `${kind}-del-refcheck`);
    const ids = [
      await seedItem(runner, kind, tenantId, 1, 'First'),
      await seedItem(runner, kind, tenantId, 2, 'Middle'),
      await seedItem(runner, kind, tenantId, 3, 'Third'),
    ];
    const paths = ids.map((id) => `files/${tenantId}/${kind}/${id}/file.pdf`);
    for (const [i, id] of ids.entries()) {
      await seedLink(runner, kind, tenantId, id);
      await seedAttachment(runner, kind, tenantId, id, paths[i]);
    }

    const storage = fakeStorage();
    const manager = managerFailingReferenceCheck(runner, paths[1]);
    const result = await deleteService(kind, runner, auditDouble(), storage).bulkDelete(ids, null, { manager });

    assert.deepEqual(result.deleted, [ids[0], ids[2]], `${kind}: first and third deleted`);
    assert.deepEqual(
      result.failed.map((f) => [f.id, f.name, f.reason]),
      [[ids[1], 'Middle', 'This line could not be deleted']],
      `${kind}: the middle item is reported`,
    );
    assert.ok(runner.isTransactionActive, `${kind}: the request transaction is still open`);
    for (const [i, id] of ids.entries()) {
      const expected = i === 1 ? 1 : 0;
      assert.equal(await count(runner, T[kind].items, 'id', id), expected, `${kind}: item ${i + 1}`);
      assert.equal(await count(runner, T[kind].links, T[kind].column, id), expected, `${kind}: links of item ${i + 1}`);
      assert.equal(await count(runner, T[kind].attachments, T[kind].column, id), expected, `${kind}: attachments of item ${i + 1}`);
    }
    assert.deepEqual(storage.deleted, [paths[0], paths[2]], `${kind}: the middle item's file is untouched`);
  });
}

void runSpecs('item-delete-cleanup.integration.spec', [
  ['testDeleteCleansUp opex', () => testDeleteCleansUp('opex')],
  ['testDeleteCleansUp capex', () => testDeleteCleansUp('capex')],
  ['testBulkDeleteIsolatesAFailingItem opex', () => testBulkDeleteIsolatesAFailingItem('opex')],
  ['testBulkDeleteIsolatesAFailingItem capex', () => testBulkDeleteIsolatesAFailingItem('capex')],
  ['testBulkDeleteReferenceCheckFailsItsItemOnly opex', () => testBulkDeleteReferenceCheckFailsItsItemOnly('opex')],
  ['testBulkDeleteReferenceCheckFailsItsItemOnly capex', () => testBulkDeleteReferenceCheckFailsItsItemOnly('capex')],
  ['testDeleteRefusedWithFrozenAmounts opex', () => testDeleteRefusedWithFrozenAmounts('opex')],
  ['testDeleteRefusedWithFrozenAmounts capex', () => testDeleteRefusedWithFrozenAmounts('capex')],
  ['testBulkDeleteReportsTheFrozenItem opex', () => testBulkDeleteReportsTheFrozenItem('opex')],
  ['testBulkDeleteReportsTheFrozenItem capex', () => testBulkDeleteReportsTheFrozenItem('capex')],
  ['testDeleteAllowedWhenTheFrozenYearIsZero opex', () => testDeleteAllowedWhenTheFrozenYearIsZero('opex')],
  ['testDeleteAllowedWhenTheFrozenYearIsZero capex', () => testDeleteAllowedWhenTheFrozenYearIsZero('capex')],
]);

// `dataSource` is imported so the CI runner schedules this spec on the database lane.
void dataSource;
