// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { createRaceTenant, dropRaceTenant, seed } from '../../spend/__tests__/race-harness';
import { audit, seedHistoryData, seedPerson, type HistorySeed, type Person } from './record-history.fixtures';
import {
  assertNoField,
  assertPresentable,
  findChange,
  findChild,
  findItem,
  readPage,
} from './record-history-family-c.fixtures';

// The history of a connection (lot 2, family C): its own creation and modification in words, its
// path segments added, changed, swapped and removed ("Segment 2 added"), and its access rule (200
// with the module, 403 without it, 404 for an unknown, missing or foreign connection). A source
// asset deleted since is hidden, never shown as an id.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

type Seeded = {
  data: HistorySeed;
  reader: Person;
};

async function one(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  const [row] = await runner.query(sql, params);
  return row.id as string;
}

async function stored(runner: QueryRunner, table: string, id: string): Promise<Record<string, unknown>> {
  const [row] = await runner.query(`SELECT to_jsonb(t) AS row FROM ${table} t WHERE t.id = $1`, [id]);
  return row.row as Record<string, unknown>;
}

async function seedConnectionAudits(runner: QueryRunner, data: HistorySeed) {
  // A destination written in the audit payload but absent from the tenant: the reference is hidden.
  const missingAsset = randomUUID();
  await runner.query(
    `UPDATE connections SET source_asset_id = $3, destination_asset_id = $3, description = 'Core network link',
            criticality = 'high', data_class = 'internal', contains_pii = false
      WHERE tenant_id = $1 AND id = $2`,
    [data.tenantId, data.connection, data.asset],
  );
  const connection = await stored(runner, 'connections', data.connection);
  await audit(runner, {
    table: 'connections', recordId: data.connection, action: 'create', userId: data.owner,
    after: { ...connection, destination_asset_id: missingAsset },
  });
  await audit(runner, {
    table: 'connections', recordId: data.connection, action: 'update', userId: data.owner,
    before: connection,
    after: { ...connection, name: 'Core link 2', lifecycle: 'deprecated', risk_mode: 'derived' },
  });

  // Two path segments.
  const legOne = await one(
    runner,
    `INSERT INTO connection_legs (tenant_id, connection_id, order_index, function_code, protocol_codes, port_override, notes)
     VALUES ($1, $2, 1, 'firewall', ARRAY['tcp', 'tls'], '443', 'Edge firewall') RETURNING id`,
    [data.tenantId, data.connection],
  );
  const legTwo = await one(
    runner,
    `INSERT INTO connection_legs (tenant_id, connection_id, order_index, function_code, protocol_codes)
     VALUES ($1, $2, 2, 'load_balancer', ARRAY['tcp']) RETURNING id`,
    [data.tenantId, data.connection],
  );
  const legOneRow = await stored(runner, 'connection_legs', legOne);
  await audit(runner, {
    table: 'connection_legs', recordId: legOne, action: 'create', userId: data.owner, after: legOneRow,
  });
  await audit(runner, {
    table: 'connection_legs', recordId: legOne, action: 'update', userId: data.owner,
    before: legOneRow,
    after: { ...legOneRow, function_code: 'reverse_proxy', protocol_codes: ['https'], notes: 'TLS termination' },
  });
  // The swap writes both legs and names the connection as an explicit parent.
  const legTwoRow = await stored(runner, 'connection_legs', legTwo);
  await audit(runner, {
    table: 'connection_legs', recordId: legOne, action: 'update', userId: data.owner,
    before: [{ id: legOne, order_index: 1 }, { id: legTwo, order_index: 2 }],
    after: [{ id: legOne, order_index: 2 }, { id: legTwo, order_index: 1 }],
    parent: { table: 'connections', id: data.connection },
  });
  await audit(runner, {
    table: 'connection_legs', recordId: legTwo, action: 'delete', userId: data.owner, before: legTwoRow, after: null,
  });
}

async function testAccess(seeded: Seeded, foreign: HistorySeed) {
  const infrastructure = { infrastructure: 'reader' };
  const page = await readPage(seeded.reader, seeded.data.tenantId, 'connections', seeded.data.connection, infrastructure);
  assert.ok(page.items.length >= 5, 'an infrastructure reader reads the connection history');

  await assert.rejects(
    () => readPage(seeded.reader, seeded.data.tenantId, 'connections', seeded.data.connection, { locations: 'reader' }),
    (error: any) => error?.status === 403 && error?.response?.code === 'MODULE_RIGHT_REQUIRED',
    'a reader without infrastructure gets 403 MODULE_RIGHT_REQUIRED',
  );
  await assert.rejects(
    () => readPage(seeded.reader, seeded.data.tenantId, 'connections', randomUUID(), infrastructure),
    (error: any) => error?.status === 404,
    'a missing connection gets 404',
  );
  await assert.rejects(
    () => readPage(seeded.reader, seeded.data.tenantId, 'connections', foreign.connection, infrastructure),
    (error: any) => error?.status === 404,
    'a connection of another tenant gets 404',
  );
  console.log('  200 with the module, 403 without it, 404 for missing and foreign connections: OK');
}

async function testConnectionEntries(seeded: Seeded) {
  const { data } = seeded;
  const page = await readPage(seeded.reader, data.tenantId, 'connections', data.connection, { infrastructure: 'reader' });
  assertPresentable(page);

  const create = findItem(page, 'create');
  assert.equal(findChange(create, 'name').after, 'Core link');
  assert.equal(findChange(create, 'topology').after, 'server_to_server');
  assert.equal(findChange(create, 'description').after, 'Core network link');
  assert.equal(findChange(create, 'criticality').after, 'high');
  assert.equal(findChange(create, 'contains_pii').after, false);
  const source = findChange(create, 'source_asset_id').after as any;
  assert.equal(source.kind, 'asset');
  assert.equal(source.label, 'Server One');
  assert.deepEqual(findChange(create, 'destination_asset_id').after, { hidden: true, kind: 'asset' });

  const update = findItem(page, 'update');
  assert.equal(findChange(update, 'name').before, 'Core link');
  assert.equal(findChange(update, 'name').after, 'Core link 2');
  assert.equal(findChange(update, 'lifecycle').before, 'active');
  assert.equal(findChange(update, 'lifecycle').after, 'deprecated');
  assert.equal(findChange(update, 'risk_mode').after, 'derived');
  assertNoField(page, 'connection_id');
  console.log('  connection creation and modification in words, source asset named, missing asset hidden: OK');
}

async function testLegs(seeded: Seeded) {
  const { data } = seeded;
  const page = await readPage(seeded.reader, data.tenantId, 'connections', data.connection, { infrastructure: 'reader' });

  const create = findChild(page, 'leg', 'create');
  assert.equal(create.subject.label, '1');
  assert.deepEqual(create.changes, [], 'a segment creation is its title');
  assert.equal(create.actor.kind, 'user');

  const update = page.items.find((item) => item.subject.kind === 'leg' && item.action === 'update'
    && item.changes.some((change) => change.field === 'function_code'));
  assert.ok(update, 'the segment update presents its fields');
  assert.equal(update.subject.label, '1');
  assert.equal(findChange(update, 'function_code').before, 'firewall');
  assert.equal(findChange(update, 'function_code').after, 'reverse_proxy');
  assert.deepEqual(findChange(update, 'protocol_codes').before, ['tcp', 'tls']);
  assert.deepEqual(findChange(update, 'protocol_codes').after, ['https']);
  assert.equal(findChange(update, 'notes').after, 'TLS termination');

  const swap = page.items.find((item) => item.subject.kind === 'leg'
    && item.action === 'update' && item.changes.some((change) => change.field === 'order_index'));
  assert.ok(swap, 'the swap presents the segment it moved');
  assert.equal(swap.subject.label, '2');
  assert.equal(findChange(swap, 'order_index').before, 1);
  assert.equal(findChange(swap, 'order_index').after, 2);

  const deletion = findChild(page, 'leg', 'delete');
  assert.equal(deletion.subject.label, '2');
  assert.deepEqual(deletion.changes, [], 'a segment removal is its title');

  assertNoField(page, 'connection_id');
  assertNoField(page, 'tenant_id');
  console.log('  segments created, changed, swapped and removed, the moved segment named, no technical link: OK');
}

async function run() {
  await dataSource.initialize();
  const tenantId = await createRaceTenant('record-history-connections');
  const foreignTenantId = await createRaceTenant('record-history-connections-foreign');
  try {
    const seeded: Seeded = await seed(tenantId, async (runner) => {
      const data = await seedHistoryData(runner, tenantId);
      await seedConnectionAudits(runner, data);
      const reader = await seedPerson(runner, tenantId, { first: 'Nils', last: 'Network' }, { infrastructure: 'reader' });
      return { data, reader };
    });
    const foreign = await seed(foreignTenantId, (runner) => seedHistoryData(runner, foreignTenantId));

    await testAccess(seeded, foreign);
    await testConnectionEntries(seeded);
    await testLegs(seeded);
    console.log('record-history-connections.integration.spec: ok');
  } finally {
    await dropRaceTenant(tenantId);
    await dropRaceTenant(foreignTenantId);
    await dataSource.destroy();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
