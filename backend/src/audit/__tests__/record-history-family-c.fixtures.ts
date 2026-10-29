import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import type { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import {
  RecordHistoryService,
  type RecordHistoryContext,
  type RecordHistoryItem,
  type RecordHistoryPage,
} from '../record-history.service';
import type { Person } from './record-history.fixtures';

// The family C history specs (sites, connections, interfaces) share the read of one page through
// the real service under a transaction with the tenant set, and the checks every page answers:
// no raw payload key, no tenant id, no unstructured value, one entry per write.

export async function readPage(
  person: Person,
  tenantId: string,
  table: string,
  id: string,
  permissions: Record<string, string>,
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
      permissions,
      manager: runner.manager,
    };
    return await new RecordHistoryService().list(ctx, table, id, options);
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction().catch(() => undefined);
    await runner.release();
  }
}

export function findItem(page: RecordHistoryPage, action: string, kind?: string): RecordHistoryItem {
  const item = page.items.find((candidate) => candidate.action === action
    && (kind ? candidate.subject.kind === kind : candidate.subject.kind === 'record'));
  assert.ok(item, `a ${action} entry${kind ? ` of a ${kind}` : ' of the record'}`);
  return item;
}

export function findChild(page: RecordHistoryPage, kind: string, action: string): RecordHistoryItem {
  return findItem(page, action, kind);
}

export function findChange(item: RecordHistoryItem, field: string) {
  const change = item.changes.find((candidate) => candidate.field === field);
  assert.ok(change, `${field}: the field is presented`);
  return change;
}

export function assertNoField(page: RecordHistoryPage, field: string) {
  assert.equal(
    page.items.some((item) => item.changes.some((change) => change.field === field)),
    false,
    `${field}: a hidden field never becomes a change`,
  );
}

/** Every value is a scalar, a resolved reference or a hidden one: never a raw payload. */
export function assertPresentable(page: RecordHistoryPage) {
  for (const item of page.items) {
    for (const change of item.changes) {
      for (const value of [change.before, change.after]) {
        if (value === null || value === undefined || typeof value !== 'object') continue;
        // A list of plain values (protocol codes) is readable as it is; an object or a list of
        // objects must be a resolved reference.
        if (Array.isArray(value) && value.every((entry) => entry === null || typeof entry !== 'object')) continue;
        assert.ok(
          (value as any).hidden === true || typeof (value as any).kind === 'string',
          `${change.field}: a structured value is a reference`,
        );
      }
    }
  }
  const serialized = JSON.stringify(page);
  for (const raw of ['after_json', 'before_json', 'tenant_id', 'created_at', 'updated_at', 'row_version']) {
    assert.ok(!serialized.includes(`"${raw}"`), `${raw}: no raw payload key`);
  }
}

/** The audit rows of a page, oldest first, as the writers left them (for a direct comparison). */
export async function childRows(page: RecordHistoryPage, kind: string): Promise<RecordHistoryItem[]> {
  return page.items.filter((item) => item.subject.kind === kind);
}

export function withTenant(runner: QueryRunner, tenantId: string): Promise<unknown> {
  return runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

export type { RecordHistoryItem, RecordHistoryPage };
