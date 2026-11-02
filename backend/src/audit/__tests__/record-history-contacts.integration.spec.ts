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
import { audit, seedHistoryData, seedPerson, type HistorySeed, type Person } from './record-history.fixtures';

// The contact's history (lot 2 family B): its own creation and modification in words, the personal
// data it never shows, and its three link labels read by the `contact_id` key of their payload:
// `supplier_contacts` (a supplier), `contract_contacts` (a contract) and `spend_item_contacts` /
// `capex_item_contacts` (a budget line of either nature). The set-wide supplier syncs of a line or
// a contract write arrays of `contact:role` strings with the line or contract as `record_id`: no
// `contact_id` key, so those rows stay out of the contact's history (the line and the contract
// read them from their own side).
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

type Seeded = {
  data: HistorySeed;
  contactOnly: Person;
  supplierOnly: Person;
  allReader: Person;
  foreignContact: string;
  ids: {
    contactCreate: string;
    contactUpdate: string;
    phoneOnly: string;
    supplierCreate: string;
    supplierUpdate: string;
    supplierDelete: string;
    contractCreate: string;
    contractDelete: string;
    contractSync: string;
    opexLink: string;
    capexLink: string;
    spendSync: string;
    otherLabel: string;
  };
};

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

function findItem(page: RecordHistoryPage, action: string, kind: RecordHistoryItem['subject']['kind']): RecordHistoryItem {
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

async function seedAll(tenantId: string, foreignTenantId: string): Promise<Seeded> {
  const seeded = await seed(tenantId, async (runner) => {
      const data = await seedHistoryData(runner, tenantId);
      await runner.query(
        `UPDATE contacts
            SET job_title = 'Buyer', phone = '+33 1 23 45 67 89', mobile = '+33 6 12 34 56 78',
                country = 'FR', notes = 'Prefers email', active = true, supplier_id = $3
          WHERE tenant_id = $1 AND id = $2`,
        [tenantId, data.contact, data.supplier],
      );
      const contactOnly = await seedPerson(runner, tenantId, { first: 'Cora', last: 'Reader' }, { contacts: 'reader' });
      const supplierOnly = await seedPerson(runner, tenantId, { first: 'Sven', last: 'Supplier' }, { suppliers: 'reader' });
      const allReader = await seedPerson(
        runner,
        tenantId,
        { first: 'Alba', last: 'All' },
        { contacts: 'reader', suppliers: 'reader', contracts: 'reader', budget: 'reader' },
      );

      const [stored] = await runner.query(`SELECT to_jsonb(c) AS row FROM contacts c WHERE c.id = $1`, [data.contact]);
      const before = { ...stored.row, supplier_role: 'commercial' };
      const after = {
        ...before,
        job_title: 'Senior buyer',
        phone: '+33 9 87 65 43 21',
        email: `cora-${randomUUID()}@example.invalid`,
        supplier_role: 'technical',
      };
      const contactCreate = await audit(runner, {
        table: 'contacts', recordId: data.contact, action: 'create', userId: allReader.id, after: before,
      });
      const contactUpdate = await audit(runner, {
        table: 'contacts', recordId: data.contact, action: 'update', userId: allReader.id, before, after,
      });
      // A write that only touches the phone: the history says the phone changed and shows no number.
      const phoneOnly = await audit(runner, {
        table: 'contacts', recordId: data.contact, action: 'update', userId: allReader.id,
        before: after,
        after: { ...after, phone: '+33 9 00 00 00 00' },
      });

      const supplierCreate = await audit(runner, {
        table: 'supplier_contacts', recordId: randomUUID(), action: 'create', userId: allReader.id,
        after: { id: randomUUID(), tenant_id: tenantId, supplier_id: data.supplier, contact_id: data.contact, role: 'commercial', is_primary: true },
      });
      const supplierUpdate = await audit(runner, {
        table: 'supplier_contacts', recordId: randomUUID(), action: 'update', userId: allReader.id,
        before: { id: randomUUID(), tenant_id: tenantId, supplier_id: data.supplier, contact_id: data.contact, role: 'commercial', is_primary: false },
        after: { id: randomUUID(), tenant_id: tenantId, supplier_id: data.supplier, contact_id: data.contact, role: 'commercial', is_primary: true },
      });
      const supplierDelete = await audit(runner, {
        table: 'supplier_contacts', recordId: randomUUID(), action: 'delete', userId: allReader.id,
        before: { id: randomUUID(), tenant_id: tenantId, supplier_id: data.supplier, contact_id: data.contact, role: 'support', is_primary: false },
      });

      const contractCreate = await audit(runner, {
        table: 'contract_contacts', recordId: randomUUID(), action: 'create', userId: allReader.id,
        after: { id: randomUUID(), tenant_id: tenantId, contract_id: data.contractA, contact_id: data.contact, role: 'technical', origin: 'manual' },
      });
      const contractDelete = await audit(runner, {
        table: 'contract_contacts', recordId: randomUUID(), action: 'delete', userId: allReader.id,
        before: { id: randomUUID(), tenant_id: tenantId, contract_id: data.contractB, contact_id: data.contact, role: 'support', origin: 'supplier' },
      });
      // The contract's supplier sync: `record_id` is the contract, the payload a set of strings.
      const contractSync = await audit(runner, {
        table: 'contract_contacts', recordId: data.contractA, action: 'update', userId: allReader.id,
        before: [`${data.contact}:commercial`], after: [`${data.contact}:technical`],
      });

      const opexLink = await audit(runner, {
        table: 'spend_item_contacts', recordId: randomUUID(), action: 'create', userId: allReader.id,
        after: { id: randomUUID(), tenant_id: tenantId, spend_item_id: data.opexLine, contact_id: data.contact, role: 'commercial', origin: 'manual' },
      });
      const capexLink = await audit(runner, {
        table: 'capex_item_contacts', recordId: randomUUID(), action: 'create', userId: allReader.id,
        after: { id: randomUUID(), tenant_id: tenantId, capex_item_id: data.capexLine, contact_id: data.contact, role: 'support', origin: 'manual' },
      });
      // The line's supplier sync: the same array shape as the contract's.
      const spendSync = await audit(runner, {
        table: 'spend_item_contacts', recordId: data.opexLine, action: 'update', userId: allReader.id,
        before: [`${data.contact}:commercial`], after: [`${data.contact}:technical`],
      });
      // A contact link of another module is not a child of this history.
      const otherLabel = await audit(runner, {
        table: 'location_contacts', recordId: randomUUID(), action: 'create', userId: allReader.id,
        after: { location_id: data.location, contact_id: data.contact, role: 'support' },
      });

      return {
        data, contactOnly, supplierOnly, allReader,
        ids: {
          contactCreate, contactUpdate, phoneOnly, supplierCreate, supplierUpdate, supplierDelete,
          contractCreate, contractDelete, contractSync, opexLink, capexLink, spendSync, otherLabel,
        },
      };
    });

    const foreign = await seed(foreignTenantId, async (runner) => {
      const contact = await one(
        runner,
        `INSERT INTO contacts (tenant_id, first_name, last_name, email) VALUES ($1, 'Fara', 'Foreign', 'fara@example.invalid') RETURNING id`,
        [foreignTenantId],
      );
      // A foreign row with the same contact id value as the record under test never comes out.
      await audit(runner, {
        table: 'supplier_contacts', recordId: randomUUID(), action: 'create',
        after: { supplier_id: randomUUID(), contact_id: seeded.data.contact, role: 'commercial', is_primary: true },
      });
      await audit(runner, {
        table: 'contacts', recordId: contact, action: 'create',
        after: { id: contact, tenant_id: foreignTenantId, first_name: 'Fara', last_name: 'Foreign' },
      });
      return { contact };
    });

    return { ...seeded, foreignContact: foreign.contact };
}

async function one(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  const [row] = await runner.query(sql, params);
  return row.id as string;
}

async function testAccess(seeded: Seeded) {
  const page = await readPage(seeded.allReader, seeded.data.tenantId, 'contacts', seeded.data.contact, {
    contacts: 'reader', suppliers: 'reader', contracts: 'reader', budget: 'reader',
  });
  assert.ok(page.items.length >= 5, 'a contacts reader reads the contact history');
  // The payload-key branch compares the id as text: an upper-case URL id reads the same links.
  const upper = await readPage(seeded.allReader, seeded.data.tenantId, 'contacts', seeded.data.contact.toUpperCase(), {
    contacts: 'reader', suppliers: 'reader', contracts: 'reader', budget: 'reader',
  });
  assert.ok(
    upper.items.some((item) => item.subject.kind === 'supplier' && item.action === 'create'),
    'the upper-case id reads the contact\'s supplier link',
  );
  await assert.rejects(
    () => readPage(seeded.supplierOnly, seeded.data.tenantId, 'contacts', seeded.data.contact, { suppliers: 'reader' }),
    (error: any) => error?.status === 403 && error?.response?.code === 'MODULE_RIGHT_REQUIRED',
    'a supplier reader without contacts gets 403 MODULE_RIGHT_REQUIRED',
  );
  await assert.rejects(
    () => readPage(seeded.contactOnly, seeded.data.tenantId, 'unknown_table', seeded.data.contact, { contacts: 'reader' }),
    (error: any) => error?.status === 404,
    'an unknown table gets 404',
  );
  await assert.rejects(
    () => readPage(seeded.contactOnly, seeded.data.tenantId, 'contacts', 'not-a-uuid', { contacts: 'reader' }),
    (error: any) => error?.status === 404,
    'a malformed id gets 404',
  );
  await assert.rejects(
    () => readPage(seeded.contactOnly, seeded.data.tenantId, 'contacts', randomUUID(), { contacts: 'reader' }),
    (error: any) => error?.status === 404,
    'a missing contact gets 404',
  );
  await assert.rejects(
    () => readPage(seeded.contactOnly, seeded.data.tenantId, 'contacts', seeded.foreignContact, { contacts: 'reader' }),
    (error: any) => error?.status === 404,
    'a contact of another tenant gets 404',
  );
  console.log('  200 with the module, 403 without it, 404 for unknown, missing and foreign contacts: OK');
}

async function testRecordEntries(seeded: Seeded) {
  const page = await readPage(seeded.allReader, seeded.data.tenantId, 'contacts', seeded.data.contact, {
    contacts: 'reader', suppliers: 'reader',
  });
  assertPresentable(page);

  const create = findItem(page, 'create', 'record');
  assert.equal(create.actor.kind, 'user');
  assert.equal(findChange(create, 'first_name').after, 'Cora');
  assert.equal(findChange(create, 'last_name').after, 'Contact');
  assert.equal(findChange(create, 'job_title').after, 'Buyer');
  assert.equal(findChange(create, 'country').after, 'FR');
  assert.equal(findChange(create, 'active').after, true);
  // The supplier and its role are the `supplier_contacts` link row's entry, never a second one on
  // the contact: one add is one entry.
  assert.equal(page.items.some((item) => item.changes.some((change) => change.field === 'supplier_id')), false);
  assert.equal(page.items.some((item) => item.changes.some((change) => change.field === 'supplier_role')), false);

  const update = page.items.find((item) => item.action === 'update' && item.subject.kind === 'record'
    && item.changes.some((change) => change.field === 'job_title'));
  assert.ok(update, 'the contact update that renamed the job');
  assert.equal(findChange(update, 'job_title').before, 'Buyer');
  assert.equal(findChange(update, 'job_title').after, 'Senior buyer');
  // Email and phone changed on this write: the history names the field and keeps the value out.
  assert.deepEqual(findChange(update, 'email'), { field: 'email', text: 'emailChanged' }, 'the email says changed, never the address');
  assert.deepEqual(findChange(update, 'phone'), { field: 'phone', text: 'phoneChanged' }, 'the phone says changed, never the number');
  for (const field of ['mobile', 'notes']) {
    assert.equal(update.changes.some((change) => change.field === field), false, `${field}: unchanged on this write`);
  }

  const phoneOnly = page.items.find((item) => item.id === seeded.ids.phoneOnly);
  assert.ok(phoneOnly, 'a write of the phone alone still has an entry');
  assert.deepEqual(phoneOnly.changes, [{ field: 'phone', text: 'phoneChanged' }], 'the phone-only write names the change');

  for (const raw of ['@example.invalid', '+33 1 23 45 67 89', '+33 6 12 34 56 78', 'Prefers email', '+33 9 87 65 43 21', '+33 9 00 00 00 00']) {
    assert.ok(!JSON.stringify(page).includes(raw), `personal data never reaches the answer: ${raw}`);
  }
  for (const field of ['id', 'tenant_id', 'created_at', 'updated_at']) {
    assert.equal(page.items.some((item) => item.changes.some((change) => change.field === field)), false, `${field}: hidden`);
  }
  console.log('  contact creation and modification in words, email and phone changed with no value: OK');
}

async function testLinks(seeded: Seeded) {
  const page = await readPage(seeded.allReader, seeded.data.tenantId, 'contacts', seeded.data.contact, {
    contacts: 'reader', suppliers: 'reader', contracts: 'reader', budget: 'reader',
  });
  assertPresentable(page);

  const supplierAdded = findItem(page, 'create', 'supplier');
  assert.equal(supplierAdded.subject.label, 'Acme Supplies');
  assert.equal((findChange(supplierAdded, 'supplier').after as any).kind, 'supplier');
  assert.equal(findChange(supplierAdded, 'role').after, 'commercial');
  assert.equal(findChange(supplierAdded, 'is_primary').after, true);
  const supplierUpdated = findItem(page, 'update', 'supplier');
  assert.equal(supplierUpdated.subject.label, 'Acme Supplies');
  assert.equal(findChange(supplierUpdated, 'is_primary').before, false);
  assert.equal(findChange(supplierUpdated, 'is_primary').after, true);
  const supplierRemoved = findItem(page, 'delete', 'supplier');
  assert.equal(supplierRemoved.subject.label, 'Acme Supplies');
  assert.equal(findChange(supplierRemoved, 'supplier').event, 'removed');

  const contractAdded = findItem(page, 'create', 'contract');
  assert.equal(contractAdded.subject.label, 'Support Contract');
  assert.equal((findChange(contractAdded, 'contract').after as any).kind, 'contract');
  assert.equal(findChange(contractAdded, 'role').after, 'technical');
  const contractRemoved = findItem(page, 'delete', 'contract');
  assert.equal(contractRemoved.subject.label, 'Beta Contract');
  assert.equal(findChange(contractRemoved, 'contract').event, 'removed');

  const lineCreates = page.items.filter((item) => item.action === 'create' && item.subject.kind === 'budget_line');
  assert.equal(lineCreates.length, 2, 'one link to the OPEX line, one to the CAPEX line');
  const lineRefs = lineCreates.map((item) => findChange(item, 'budget_line').after as any);
  const opexRef = lineRefs.find((reference) => reference.reference === 'BL-1');
  const capexRef = lineRefs.find((reference) => reference.reference === 'BL-2');
  assert.ok(opexRef, 'the OPEX line is named with its reference');
  assert.equal(opexRef.kind, 'budget_line');
  assert.equal(opexRef.label, 'Main line');
  assert.ok(capexRef, 'the CAPEX line is named with its reference');
  assert.equal(capexRef.label, 'Capital line');

  // The two set-wide supplier syncs carry arrays of `contact:role` strings, not a `contact_id`
  // key. The line and the contract read them from their own side; the contact's page cannot.
  const ids = new Set(page.items.map((item) => item.id));
  assert.equal(ids.has(seeded.ids.contractSync), false, 'the contract supplier sync is not a contact link read');
  assert.equal(ids.has(seeded.ids.spendSync), false, 'the line supplier sync is not a contact link read');
  assert.equal(ids.has(seeded.ids.otherLabel), false, 'a label outside the children never comes out');
  console.log('  supplier, contract and budget-line links (create, update, delete), sync arrays outside the key: OK');
}

async function testHiddenReferences(seeded: Seeded) {
  const page = await readPage(seeded.contactOnly, seeded.data.tenantId, 'contacts', seeded.data.contact, { contacts: 'reader' });
  assertPresentable(page);
  const supplierAdded = findItem(page, 'create', 'supplier');
  assert.deepEqual(findChange(supplierAdded, 'supplier').after, { hidden: true, kind: 'supplier' });
  const contractAdded = findItem(page, 'create', 'contract');
  assert.deepEqual(findChange(contractAdded, 'contract').after, { hidden: true, kind: 'contract' });
  const opexAdded = findItem(page, 'create', 'budget_line');
  assert.deepEqual(findChange(opexAdded, 'budget_line').after, { hidden: true, kind: 'budget_line' });
  const serialized = JSON.stringify(page);
  for (const name of ['Acme Supplies', 'Support Contract', 'Main line', 'BL-1']) {
    assert.ok(!serialized.includes(name), `a record the reader cannot read is never named: ${name}`);
  }
  console.log('  a contacts-only reader sees the supplier, contract and budget line as unnamed records: OK');
}

async function run() {
  await dataSource.initialize();
  const tenantId = await createRaceTenant('record-history-contacts');
  const foreignTenantId = await createRaceTenant('record-history-contacts-foreign');
  try {
    const seeded = await seedAll(tenantId, foreignTenantId);
    console.log('record history contacts');
    await testAccess(seeded);
    await testRecordEntries(seeded);
    await testLinks(seeded);
    await testHiddenReferences(seeded);
    console.log('record-history-contacts.integration.spec: ok');
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
