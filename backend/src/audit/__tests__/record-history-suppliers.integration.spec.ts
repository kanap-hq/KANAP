// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { createRaceTenant, dropRaceTenant, seed } from '../../spend/__tests__/race-harness';
import {
  RecordHistoryService,
  type RecordHistoryContext,
  type RecordHistoryItem,
  type RecordHistoryPage,
} from '../record-history.service';
import { audit, seedPerson, type Person } from './record-history.fixtures';

// The supplier's history (lot 2 family B): its own creation and modification in words, and the
// `supplier_contacts` links it reads by their parent. The link's own writer stores the link row in
// its payload, which the parent rule reads (`audit-parent-rules.ts`); a contact the reader may not
// name shows as a contact. The record is checked through its reference family, so an unknown,
// missing or foreign supplier is a 404 and a reader without the suppliers module is a 403.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

type Seeded = {
  tenantId: string;
  foreignTenantId: string;
  supplier: string;
  foreignSupplier: string;
  contactA: string;
  contactB: string;
  reader: Person;
  contactReader: Person;
  audits: { create: string; update: string; linkCreate: string; linkUpdate: string; linkDelete: string };
};

async function one(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  const [row] = await runner.query(sql, params);
  return row.id as string;
}

async function readPage(
  person: Person,
  tenantId: string,
  table: string,
  id: string,
  permissions: Record<string, string>,
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
    return await new RecordHistoryService().list(ctx, table, id, { limit: '100' });
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction().catch(() => undefined);
    await runner.release();
  }
}

function findItem(page: RecordHistoryPage, action: string, kind: 'record' | 'contact' = 'record'): RecordHistoryItem {
  const item = page.items.find((candidate) => candidate.action === action && candidate.subject.kind === kind);
  assert.ok(item, `a ${action} entry of kind ${kind}`);
  return item;
}

function findChange(item: RecordHistoryItem, field: string) {
  const change = item.changes.find((candidate) => candidate.field === field);
  assert.ok(change, `${field}: the field is presented`);
  return change;
}

function assertPresentable(page: RecordHistoryPage) {
  for (const item of page.items) {
    for (const change of item.changes) {
      for (const value of [change.before, change.after]) {
        if (value === null || value === undefined || typeof value !== 'object') continue;
        assert.ok(
          (value as any).hidden === true || typeof (value as any).kind === 'string',
          `${change.field}: a structured value is a reference`,
        );
      }
    }
  }
  const serialized = JSON.stringify(page);
  for (const raw of ['after_json', 'before_json', 'tenant_id', 'created_at', 'updated_at']) {
    assert.ok(!serialized.includes(`"${raw}"`), `${raw}: no raw payload key`);
  }
}

async function seedTenant(tenantId: string): Promise<Omit<Seeded, 'foreignTenantId' | 'foreignSupplier'>> {
  return seed(tenantId, async (runner) => {
    const supplier = await one(
      runner,
      `INSERT INTO suppliers (tenant_id, name, erp_supplier_id, notes)
       VALUES ($1, 'Acme Supplies', 'SUP-001', 'Net 30') RETURNING id`,
      [tenantId],
    );
    const contactA = await one(
      runner,
      `INSERT INTO contacts (tenant_id, first_name, last_name, job_title, email, phone, mobile, country, active, supplier_id)
       VALUES ($1, 'Cora', 'Contact', 'Buyer', 'cora@example.invalid', '+33 1 23 45 67 89', NULL, 'FR', true, $2) RETURNING id`,
      [tenantId, supplier],
    );
    const contactB = await one(
      runner,
      `INSERT INTO contacts (tenant_id, first_name, last_name, email) VALUES ($1, 'Bruno', 'Backup', 'bruno@example.invalid') RETURNING id`,
      [tenantId],
    );
    const reader = await seedPerson(runner, tenantId, { first: 'Sami', last: 'Supplier' }, { suppliers: 'reader' });
    const contactReader = await seedPerson(
      runner,
      tenantId,
      { first: 'Carla', last: 'Contact' },
      { suppliers: 'reader', contacts: 'reader' },
    );

    const [stored] = await runner.query(`SELECT to_jsonb(s) AS row FROM suppliers s WHERE s.id = $1`, [supplier]);
    const before = { ...stored.row, status: 'enabled' };
    const after = { ...before, name: 'Acme Supplies Europe', erp_supplier_id: 'SUP-002', notes: 'Net 45', status: 'disabled' };
    const create = await audit(runner, {
      table: 'suppliers', recordId: supplier, action: 'create', userId: reader.id, after: before,
    });
    const update = await audit(runner, {
      table: 'suppliers', recordId: supplier, action: 'update', userId: reader.id, before, after,
    });

    const linkCreate = await audit(runner, {
      table: 'supplier_contacts',
      recordId: randomUUID(),
      action: 'create',
      userId: reader.id,
      after: { id: randomUUID(), tenant_id: tenantId, supplier_id: supplier, contact_id: contactA, role: 'commercial', is_primary: true },
    });
    const linkUpdate = await audit(runner, {
      table: 'supplier_contacts',
      recordId: randomUUID(),
      action: 'update',
      userId: reader.id,
      before: { id: randomUUID(), tenant_id: tenantId, supplier_id: supplier, contact_id: contactA, role: 'commercial', is_primary: false },
      after: { id: randomUUID(), tenant_id: tenantId, supplier_id: supplier, contact_id: contactA, role: 'commercial', is_primary: true },
    });
    const linkDelete = await audit(runner, {
      table: 'supplier_contacts',
      recordId: randomUUID(),
      action: 'delete',
      userId: reader.id,
      before: { id: randomUUID(), tenant_id: tenantId, supplier_id: supplier, contact_id: contactB, role: 'support', is_primary: false },
    });

    // The parent rule reads the link payload, not its own id.
    for (const id of [linkCreate, linkUpdate, linkDelete]) {
      const [row] = await runner.query(
        `SELECT parent_table, parent_id FROM audit_log WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      assert.equal(row.parent_table, 'suppliers', 'the link parent table');
      assert.equal(row.parent_id, supplier, 'the link parent id');
    }

    return { tenantId, supplier, contactA, contactB, reader, contactReader, audits: { create, update, linkCreate, linkUpdate, linkDelete } };
  });
}

async function testAccess(seeded: Seeded) {
  const asSupplier = { suppliers: 'reader' };
  const page = await readPage(seeded.reader, seeded.tenantId, 'suppliers', seeded.supplier, asSupplier);
  assert.ok(page.items.length >= 5, 'a suppliers reader reads the supplier history');
  await assert.rejects(
    () => readPage(seeded.reader, seeded.tenantId, 'suppliers', seeded.supplier, { contacts: 'reader' }),
    (error: any) => error?.status === 403 && error?.response?.code === 'MODULE_RIGHT_REQUIRED',
    'a contact reader without suppliers gets 403 MODULE_RIGHT_REQUIRED',
  );
  await assert.rejects(
    () => readPage(seeded.reader, seeded.tenantId, 'unknown_table', seeded.supplier, asSupplier),
    (error: any) => error?.status === 404,
    'an unknown table gets 404',
  );
  await assert.rejects(
    () => readPage(seeded.reader, seeded.tenantId, 'suppliers', 'not-a-uuid', asSupplier),
    (error: any) => error?.status === 404,
    'a malformed id gets 404',
  );
  await assert.rejects(
    () => readPage(seeded.reader, seeded.tenantId, 'suppliers', randomUUID(), asSupplier),
    (error: any) => error?.status === 404,
    'a missing supplier gets 404',
  );
  await assert.rejects(
    () => readPage(seeded.reader, seeded.tenantId, 'suppliers', seeded.foreignSupplier, asSupplier),
    (error: any) => error?.status === 404,
    'a supplier of another tenant gets 404',
  );
  console.log('  200 with the module, 403 without it, 404 for unknown, missing and foreign suppliers: OK');
}

async function testRecordEntries(seeded: Seeded) {
  const page = await readPage(seeded.reader, seeded.tenantId, 'suppliers', seeded.supplier, { suppliers: 'reader' });
  assertPresentable(page);

  const create = findItem(page, 'create');
  assert.equal(create.actor.kind, 'user');
  assert.equal(findChange(create, 'name').after, 'Acme Supplies');
  assert.equal(findChange(create, 'erp_supplier_id').after, 'SUP-001');
  assert.equal(findChange(create, 'notes').after, 'Net 30');
  assert.equal(findChange(create, 'status').after, 'enabled');

  const update = findItem(page, 'update');
  assert.equal(findChange(update, 'name').before, 'Acme Supplies');
  assert.equal(findChange(update, 'name').after, 'Acme Supplies Europe');
  assert.equal(findChange(update, 'erp_supplier_id').after, 'SUP-002');
  assert.equal(findChange(update, 'notes').before, 'Net 30');
  assert.equal(findChange(update, 'notes').after, 'Net 45');
  assert.equal(findChange(update, 'status').after, 'disabled');
  for (const field of ['id', 'tenant_id', 'created_at', 'updated_at']) {
    assert.equal(page.items.some((item) => item.changes.some((change) => change.field === field)), false, `${field}: hidden`);
  }
  console.log('  supplier creation and modification in words, hidden columns dropped: OK');
}

async function testContactLinks(seeded: Seeded) {
  const page = await readPage(seeded.contactReader, seeded.tenantId, 'suppliers', seeded.supplier, {
    suppliers: 'reader',
    contacts: 'reader',
  });
  assertPresentable(page);

  const added = findItem(page, 'create', 'contact');
  assert.equal(added.subject.label, 'Cora Contact');
  const addedRef = findChange(added, 'contact').after as any;
  assert.equal(addedRef.kind, 'contact');
  assert.equal(addedRef.label, 'Cora Contact');
  assert.equal(findChange(added, 'role').after, 'commercial');
  assert.equal(findChange(added, 'is_primary').after, true);

  const updated = findItem(page, 'update', 'contact');
  assert.equal(updated.subject.label, 'Cora Contact');
  assert.equal(findChange(updated, 'is_primary').before, false);
  assert.equal(findChange(updated, 'is_primary').after, true);

  const removed = findItem(page, 'delete', 'contact');
  assert.equal(removed.subject.label, 'Bruno Backup');
  assert.equal(findChange(removed, 'contact').event, 'removed');
  assert.equal(findChange(removed, 'role').before, 'support');

  // The same page for a supplier reader who does not read contacts: the contact is unnamed.
  const hidden = await readPage(seeded.reader, seeded.tenantId, 'suppliers', seeded.supplier, { suppliers: 'reader' });
  const hiddenAdded = findItem(hidden, 'create', 'contact');
  assert.deepEqual(findChange(hiddenAdded, 'contact').after, { hidden: true, kind: 'contact' });
  assert.ok(!JSON.stringify(hidden).includes('Cora Contact'), 'a contact the reader cannot read is never named');
  console.log('  contact links: added, updated and removed, role and primary in words, contact hidden by module: OK');
}

async function run() {
  await dataSource.initialize();
  const tenantId = await createRaceTenant('record-history-suppliers');
  const foreignTenantId = await createRaceTenant('record-history-suppliers-foreign');
  try {
    const seeded = await seedTenant(tenantId);
    const foreign = await seed(foreignTenantId, async (runner) => {
      const supplier = await one(
        runner,
        `INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Foreign Supplies') RETURNING id`,
        [foreignTenantId],
      );
      const contact = await one(
        runner,
        `INSERT INTO contacts (tenant_id, first_name, last_name, email) VALUES ($1, 'Fara', 'Foreign', 'fara@example.invalid') RETURNING id`,
        [foreignTenantId],
      );
      await audit(runner, {
        table: 'suppliers', recordId: supplier, action: 'create', after: { id: supplier, tenant_id: foreignTenantId, name: 'Foreign Supplies' },
      });
      await audit(runner, {
        table: 'supplier_contacts', recordId: randomUUID(), action: 'create',
        after: { supplier_id: supplier, contact_id: contact, role: 'commercial', is_primary: true },
      });
      return { supplier };
    });
    const all: Seeded = { ...seeded, foreignTenantId, foreignSupplier: foreign.supplier };
    console.log('record history suppliers');
    await testAccess(all);
    await testRecordEntries(all);
    await testContactLinks(all);
    console.log('record-history-suppliers.integration.spec: ok');
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
