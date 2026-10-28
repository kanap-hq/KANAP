// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { createRaceTenant, dropRaceTenant, seed } from '../../spend/__tests__/race-harness';
import { RECORD_HISTORY } from '../record-history.inventory';
import {
  HISTORY_FIELDS,
  RecordHistoryService,
  type RecordHistoryContext,
  type RecordHistoryItem,
} from '../record-history.service';
import { audit, seedHistoryData, seedPerson, seedPilotAudits, type Person } from './record-history.fixtures';

// The allow-list of the history (review I1): every physical column of `spend_items` is classified,
// shown or hidden with its reason, so a new column fails this spec until it is classified. The
// cited type change then reads through the service: the successor resolves with the reader's
// access (hidden here), and the raw `to_reference` written beside it never comes out.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

async function columns(table: string): Promise<string[]> {
  const rows: Array<{ column_name: string }> = await dataSource.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position`,
    [table],
  );
  return rows.map((row) => row.column_name);
}

async function testCatalogs(payloadKeys: Record<string, string[]>) {
  let classified = 0;
  for (const [key, entry] of Object.entries(RECORD_HISTORY)) {
    const real = await columns(entry.table);
    assert.ok(real.length > 0, `${key}: the table has its columns`);
    for (const label of entry.auditLabels) {
      const catalog = HISTORY_FIELDS[label];
      assert.ok(catalog, `${label} has an allow-list`);
      const unclassified = real.filter((column) => !Object.prototype.hasOwnProperty.call(catalog, column));
      assert.deepEqual(
        unclassified,
        [],
        `${label} columns neither shown nor hidden: ${unclassified.join(', ')}`,
      );
      for (const [field, rule] of Object.entries(catalog)) {
        assert.ok(rule.hidden || rule.family || Object.keys(rule).length === 0, `${label}.${field}: shown or hidden`);
        assert.ok(!(rule.hidden && rule.family), `${label}.${field}: a field is not both shown and hidden`);
      }
      classified += real.length;
    }
  }
  // The keys the pilot writers put in a payload are the stored row's columns; the spec takes them
  // from the tenant's real audit rows, so a writer that adds a key fails here.
  for (const [table, keys] of Object.entries(payloadKeys)) {
    const catalog = HISTORY_FIELDS[table];
    assert.ok(catalog, `${table} has an allow-list`);
    const unclassified = keys.filter((field) => !Object.prototype.hasOwnProperty.call(catalog, field));
    assert.deepEqual(unclassified, [], `${table} payload keys neither shown nor hidden: ${unclassified.join(', ')}`);
  }
  assert.equal(HISTORY_FIELDS.spend_items.to_reference?.hidden !== undefined, true, 'to_reference is dropped');
  assert.equal(HISTORY_FIELDS.spend_items.successor_id?.family, 'budget_line', 'successor_id resolves as a budget line');
  assert.equal(HISTORY_FIELDS.accounts.coa_id?.family, 'chart_of_accounts', 'coa_id resolves as a chart of accounts');
  assert.equal(HISTORY_FIELDS.cost_centers.parent_id?.family, 'cost_center', 'parent_id resolves as a cost center');
  console.log(`  ${Object.keys(RECORD_HISTORY).length} record tables: ${classified} columns classified, payload keys match: OK`);
}

function findChange(items: RecordHistoryItem[], field: string) {
  for (const item of items) {
    const change = item.changes.find((candidate) => candidate.field === field);
    if (change) return { item, change };
  }
  return null;
}

async function testTypeChange(seedRow: { line: string; hiddenLine: string; tenantId: string }, limited: Person) {
  const runner: QueryRunner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [seedRow.tenantId]);
    const before = {
      id: seedRow.line,
      tenant_id: seedRow.tenantId,
      item_number: 1,
      nature: 'opex',
      product_name: 'Main line',
      description: 'Main line description',
      currency: 'EUR',
      effective_start: '2026-01-01',
      status: 'enabled',
    };
    await audit(runner, {
      table: 'spend_items',
      recordId: seedRow.line,
      action: 'update',
      userId: limited.id,
      before,
      after: {
        ...before,
        nature: 'capex',
        successor_id: seedRow.hiddenLine,
        operation: 'change_type',
        from_nature: 'opex',
        to_nature: 'capex',
        from_reference: 'BL-1',
        to_reference: 'BL-34',
      },
    });
    await runner.commitTransaction();
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction().catch(() => undefined);
    await runner.release();
  }

  const read = dataSource.createQueryRunner();
  await read.connect();
  await read.startTransaction();
  try {
    await read.query(`SELECT set_config('app.current_tenant', $1, true)`, [seedRow.tenantId]);
    const rows: Array<{ mode: string }> = await read.query(`SELECT data_access_apply($1) AS mode`, [limited.id]);
    assert.equal(rows[0]?.mode, 'limited');
    const ctx: RecordHistoryContext = {
      tenantId: seedRow.tenantId,
      userId: limited.id,
      isAdmin: false,
      permissions: { budget: 'reader' },
      manager: read.manager,
    };
    const page = await new RecordHistoryService().list(ctx, 'spend_items', seedRow.line, { limit: '100' });
    const successor = findChange(page.items, 'successor_id');
    assert.ok(successor, 'the successor field is present');
    assert.deepEqual(successor.change.after, { hidden: true, kind: 'budget_line' }, 'the out-of-access successor is hidden');
    assert.equal(findChange(page.items, 'to_reference'), null, 'the raw reference is not a change');
    assert.equal(findChange(page.items, 'operation'), null, 'the operation marker is not a change');
    assert.ok(!JSON.stringify(page).includes('BL-34'), 'the raw successor reference does not leak');
  } finally {
    if (read.isTransactionActive) await read.rollbackTransaction().catch(() => undefined);
    await read.release();
  }
  console.log('  a type change: successor hidden with access, to_reference and operation dropped: OK');
}

async function run() {
  await dataSource.initialize();
  const tenantId = await createRaceTenant('record-history-fields');
  try {
    const data = await seed(tenantId, async (runner) => {
      const seeded = await seedHistoryData(runner, tenantId);
      await seedPilotAudits(runner, seeded);
      const payloadKeys: Record<string, string[]> = {};
      for (const table of ['accounts', 'cost_centers']) {
        const rows: Array<{ key: string }> = await runner.query(
          `SELECT DISTINCT jsonb_object_keys(after_json) AS key
             FROM audit_log
            WHERE tenant_id = $1 AND table_name = $2`,
          [tenantId, table],
        );
        payloadKeys[table] = rows.map((row) => row.key).sort();
      }
      const limited = await seedPerson(
        runner,
        tenantId,
        { first: 'Lila', last: 'Limited' },
        { budget: 'reader' },
        { mode: 'limited', nodeCompanyId: seeded.companyA },
      );
      return { seeded, limited, payloadKeys };
    });
    await testCatalogs(data.payloadKeys);
    await testTypeChange({
      tenantId,
      line: data.seeded.opexLine,
      hiddenLine: data.seeded.hiddenLine,
    }, data.limited);
    console.log('record-history-fields.integration.spec: ok');
  } finally {
    await dropRaceTenant(tenantId);
    await dataSource.destroy();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
