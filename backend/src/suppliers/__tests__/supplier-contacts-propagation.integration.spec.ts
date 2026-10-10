import 'dotenv/config';
import { NotFoundException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { SupplierContactsService } from '../supplier-contacts.service';
import { ContactsService } from '../../contacts/contacts.service';
import { SupplierContactRole } from '../../contacts/supplier-contact.entity';
import { ContractContactsService } from '../../contracts/contract-contacts.service';
import { seedCompany } from '../../spend/__tests__/cost-center.fixtures';
import { withRlsLifted } from '../../common/__tests__/rls-bypass.fixtures';
import {
  assert,
  captureAudit,
  runSpecs,
  seedItem,
  seedTenant,
  setTenant,
} from '../../spend/__tests__/round-inputs.fixtures';

// A supplier contact propagates to the OPEX lines, CAPEX lines and contracts of
// its supplier in the tenant only, by an explicit tenant predicate (RLS is
// lifted on the tables involved). Every link added or removed writes one audit
// row on its link table. Detaching a link of another supplier is a 404. A
// contact moved from supplier A to supplier B loses A's propagated links and
// gains B's.

const USER = '00000000-0000-4000-8000-00000000f2f2';
// The link tables as the audit names them; `ITEM_COLUMN` names the item in the audited row.
const LINK_TABLES = ['spend_item_contacts', 'capex_item_contacts', 'contract_contacts'] as const;
const ITEM_COLUMN = { spend_item_contacts: 'spend_item_id', capex_item_contacts: 'capex_item_id', contract_contacts: 'contract_id' } as const;
// Where each one is stored: a CAPEX line's contacts live in spend_item_contacts since lot Z1.
const LINK_STORAGE = {
  spend_item_contacts: { table: 'spend_item_contacts', column: 'spend_item_id' },
  capex_item_contacts: { table: 'spend_item_contacts', column: 'spend_item_id' },
  contract_contacts: { table: 'contract_contacts', column: 'contract_id' },
} as const;

// RLS lifted for `app` on these tables (see `withRlsLifted`: never against a
// database a live API uses).
const BYPASS_TABLES = [
  'spend_items', 'contracts', 'suppliers', 'contacts', 'supplier_contacts', 'spend_item_contacts', 'contract_contacts',
];

type Items = { spend_item_contacts: string; capex_item_contacts: string; contract_contacts: string };

/** One OPEX line, one CAPEX line and one contract of the supplier, in the tenant. */
async function seedItems(runner: QueryRunner, tenantId: string, supplierId: string, companyId: string, start: number): Promise<Items> {
  const opex = await seedItem(runner, 'opex', tenantId, start, `OPEX ${start}`);
  const capex = await seedItem(runner, 'capex', tenantId, start, `CAPEX ${start}`);
  await runner.query(`UPDATE spend_items SET supplier_id = $2 WHERE id = $1`, [opex, supplierId]);
  await runner.query(`UPDATE spend_items SET supplier_id = $2 WHERE id = $1`, [capex, supplierId]);
  const [contract] = await runner.query(
    `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date) VALUES ($1, $2, $3, $4, '2024-01-01') RETURNING id`,
    [tenantId, `Contract ${start}`, companyId, supplierId],
  );
  return { spend_item_contacts: opex, capex_item_contacts: capex, contract_contacts: contract.id };
}

async function seedSupplier(runner: QueryRunner, tenantId: string, name: string): Promise<string> {
  const [row] = await runner.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, $2) RETURNING id`, [tenantId, name]);
  return row.id;
}

type World = {
  tenantA: string;
  tenantB: string;
  supplierA: string;
  supplierA2: string;
  contactId: string;
  itemsA: Items;
  itemsA2: Items;
  itemsB: Items;
  /** Tenant B's own supplier-origin link of the contact on its OPEX line (seeded with RLS lifted). */
  foreignLinkId: string;
};

/**
 * Tenant A: suppliers A and A2 with their items and a contact. Tenant B: items
 * whose supplier_id is A's supplier (a foreign key does not check the tenant),
 * and a supplier-origin link of A's contact on its OPEX line.
 */
async function withWorld(fn: (runner: QueryRunner, world: World) => Promise<void>) {
  await withRlsLifted(BYPASS_TABLES, async (runner) => {
    const tenantB = await seedTenant(runner, 'supplier-contacts-b');
    const tenantA = await seedTenant(runner, 'supplier-contacts-a');
    const { companyId: companyA } = await seedCompany(runner, tenantA, 'Company A');
    const supplierA = await seedSupplier(runner, tenantA, 'Supplier A');
    const supplierA2 = await seedSupplier(runner, tenantA, 'Supplier A2');
    const [contact] = await runner.query(
      `INSERT INTO contacts (tenant_id, email, first_name, last_name) VALUES ($1, $2, 'Sam', 'Supplier') RETURNING id`,
      [tenantA, `sam-${tenantA.slice(0, 8)}@example.com`],
    );
    const itemsA = await seedItems(runner, tenantA, supplierA, companyA, 1);
    const itemsA2 = await seedItems(runner, tenantA, supplierA2, companyA, 2);

    await setTenant(runner, tenantB);
    const { companyId: companyB } = await seedCompany(runner, tenantB, 'Company B');
    const itemsB = await seedItems(runner, tenantB, supplierA, companyB, 1);
    const [foreign] = await runner.query(
      `INSERT INTO spend_item_contacts (tenant_id, spend_item_id, contact_id, role, origin)
       VALUES ($1, $2, $3, 'commercial', 'supplier') RETURNING id`,
      [tenantB, itemsB.spend_item_contacts, contact.id],
    );

    await setTenant(runner, tenantA);
    const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM spend_items WHERE supplier_id = $1 AND nature = 'opex'`, [supplierA]);
    assert.equal(n, 2, 'with RLS lifted, the session sees both tenants\' OPEX lines of supplier A');

    await fn(runner, {
      tenantA, tenantB, supplierA, supplierA2, contactId: contact.id, itemsA, itemsA2, itemsB, foreignLinkId: foreign.id,
    });
  });
}

/** The contact's links on the item of each link table: `origin:role`, sorted. */
async function linksOn(runner: QueryRunner, items: Items, contactId: string): Promise<Record<string, string[]>> {
  const result: Record<string, string[]> = {};
  for (const table of LINK_TABLES) {
    const rows: Array<{ origin: string; role: string }> = await runner.query(
      `SELECT origin, role::text AS role FROM ${LINK_STORAGE[table].table}
        WHERE ${LINK_STORAGE[table].column} = $1 AND contact_id = $2 ORDER BY origin, role`,
      [items[table], contactId],
    );
    result[table] = rows.map((row) => `${row.origin}:${row.role}`);
  }
  return result;
}

const none = { spend_item_contacts: [], capex_item_contacts: [], contract_contacts: [] };
const commercial = { spend_item_contacts: ['supplier:commercial'], capex_item_contacts: ['supplier:commercial'], contract_contacts: ['supplier:commercial'] };

function supplierContacts(audit: unknown) {
  return new SupplierContactsService(undefined as any, audit as any);
}

async function testAttachAndDetach() {
  await withWorld(async (runner, w) => {
    const audit = captureAudit();
    const svc = supplierContacts(audit);
    // The AI path passes its preview's source: every row carries it, as the relation summary row does.
    const ctx = { manager: runner.manager, tenantId: w.tenantA, userId: USER, audit: { source: 'ai_chat', sourceRef: 'preview-f2' } };

    const link = await svc.attach(w.supplierA, { contactId: w.contactId, role: SupplierContactRole.COMMERCIAL }, ctx);
    assert.deepEqual(await linksOn(runner, w.itemsA, w.contactId), commercial, 'propagated to tenant A\'s OPEX, CAPEX and contract');
    assert.deepEqual(
      await linksOn(runner, w.itemsB, w.contactId),
      { ...none, spend_item_contacts: ['supplier:commercial'] },
      'tenant B\'s items of the same supplier id are untouched (only its own seeded link)',
    );
    assert.deepEqual(await linksOn(runner, w.itemsA2, w.contactId), none, 'another supplier\'s items are untouched');

    assert.deepEqual(
      audit.entries.map((e) => [e.table, e.action, e.userId]),
      [
        ['supplier_contacts', 'create', USER],
        ['contacts', 'update', USER],
        ['spend_item_contacts', 'create', USER],
        ['capex_item_contacts', 'create', USER],
        ['contract_contacts', 'create', USER],
      ],
      'one audit row for the supplier link, one for the contact\'s supplier, one per item link',
    );
    assert.ok(
      audit.entries.every((e: any) => e.source === 'ai_chat' && e.sourceRef === 'preview-f2'),
      'every row carries the caller\'s audit source',
    );
    assert.equal(audit.entries[0].recordId, link.id);
    assert.deepEqual(
      [audit.entries[1].recordId, audit.entries[1].before.supplier_id, audit.entries[1].after.supplier_id],
      [w.contactId, null, w.supplierA],
      'the contact takes the supplier, audited',
    );
    for (const entry of audit.entries.slice(2)) {
      const table = entry.table as (typeof LINK_TABLES)[number];
      assert.equal(entry.after.tenant_id, w.tenantA);
      assert.equal(entry.after[ITEM_COLUMN[table]], w.itemsA[table]);
      assert.equal(entry.recordId, entry.after.id);
      assert.equal(entry.before, null);
    }
    const [contact] = await runner.query(`SELECT supplier_id FROM contacts WHERE id = $1`, [w.contactId]);
    assert.equal(contact.supplier_id, w.supplierA, 'a contact without a supplier takes this one');

    // Attaching again changes nothing and writes nothing.
    await svc.attach(w.supplierA, { contactId: w.contactId, role: SupplierContactRole.COMMERCIAL }, ctx);
    assert.equal(audit.entries.length, 5);

    // A link of another supplier is not found, and nothing changes.
    await assert.rejects(
      () => svc.detach(w.supplierA2, link.id, ctx),
      (err: unknown) => err instanceof NotFoundException && err.message === 'Link not found.',
      'detaching through another supplier is a 404',
    );
    assert.deepEqual(await linksOn(runner, w.itemsA, w.contactId), commercial);
    assert.equal(audit.entries.length, 5, 'no audit row for the refused detach');

    await svc.detach(w.supplierA, link.id, ctx);
    const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM supplier_contacts WHERE id = $1`, [link.id]);
    assert.equal(n, 0, 'the supplier link is removed');
    assert.deepEqual(await linksOn(runner, w.itemsA, w.contactId), none, 'its propagated links are removed');
    const [{ kept }] = await runner.query(`SELECT count(*)::int AS kept FROM spend_item_contacts WHERE id = $1`, [w.foreignLinkId]);
    assert.equal(kept, 1, 'tenant B\'s link of the same contact and supplier id is kept');
    assert.deepEqual(
      audit.entries.slice(5).map((e) => [e.table, e.action, e.before?.id ? 'row' : null, e.table === 'contacts' ? e.after.supplier_id : e.after, e.userId]),
      [
        ['supplier_contacts', 'delete', 'row', null, USER],
        ['spend_item_contacts', 'delete', 'row', null, USER],
        ['capex_item_contacts', 'delete', 'row', null, USER],
        ['contract_contacts', 'delete', 'row', null, USER],
        ['contacts', 'update', 'row', null, USER],
      ],
      'one audit row for the supplier link, one per item link removed, one for the contact losing its supplier',
    );
    const [after] = await runner.query(`SELECT supplier_id FROM contacts WHERE id = $1`, [w.contactId]);
    assert.equal(after.supplier_id, null, 'the contact has no other supplier link');
  });
}

async function testForeignSupplierAndContactRefused() {
  await withWorld(async (runner, w) => {
    const audit = captureAudit();
    const svc = supplierContacts(audit);
    await setTenant(runner, w.tenantB);
    const [foreignContact] = await runner.query(
      `INSERT INTO contacts (tenant_id, email) VALUES ($1, $2) RETURNING id`,
      [w.tenantB, `other-${w.tenantB.slice(0, 8)}@example.com`],
    );
    const [foreignSupplier] = await runner.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Supplier B') RETURNING id`, [w.tenantB]);
    await setTenant(runner, w.tenantA);
    const ctx = { manager: runner.manager, tenantId: w.tenantA, userId: USER };
    await assert.rejects(
      () => svc.attach(w.supplierA, { contactId: foreignContact.id, role: SupplierContactRole.COMMERCIAL }, ctx),
      (err: unknown) => err instanceof NotFoundException && err.message === 'Contact not found.',
    );
    await assert.rejects(
      () => svc.attach(foreignSupplier.id, { contactId: w.contactId, role: SupplierContactRole.COMMERCIAL }, ctx),
      (err: unknown) => err instanceof NotFoundException && err.message === 'Supplier not found.',
    );
    assert.equal(audit.entries.length, 0);
  });
}

async function testContactMovedToAnotherSupplier() {
  await withWorld(async (runner, w) => {
    const audit = captureAudit();
    const contacts = new ContactsService(undefined as any, undefined as any, undefined as any, supplierContacts(audit), audit as any);
    const opts = { manager: runner.manager, tenantId: w.tenantA, userId: USER };

    await contacts.update(w.contactId, { supplier_id: w.supplierA, supplier_role: 'commercial' } as any, opts);
    assert.deepEqual(await linksOn(runner, w.itemsA, w.contactId), commercial, 'supplier A\'s items get the contact');
    assert.deepEqual(await linksOn(runner, w.itemsA2, w.contactId), none);

    audit.entries.length = 0;
    await contacts.update(w.contactId, { supplier_id: w.supplierA2, supplier_role: 'commercial' } as any, opts);
    assert.deepEqual(await linksOn(runner, w.itemsA, w.contactId), none, 'supplier A\'s propagated links are removed');
    assert.deepEqual(await linksOn(runner, w.itemsA2, w.contactId), commercial, 'supplier A2\'s items get the contact');
    const [{ kept }] = await runner.query(`SELECT count(*)::int AS kept FROM spend_item_contacts WHERE id = $1`, [w.foreignLinkId]);
    assert.equal(kept, 1, 'tenant B\'s link is kept');

    const links: Array<{ supplier_id: string; is_primary: boolean }> = await runner.query(
      `SELECT supplier_id, is_primary FROM supplier_contacts WHERE contact_id = $1`,
      [w.contactId],
    );
    assert.deepEqual(links, [{ supplier_id: w.supplierA2, is_primary: true }], 'one primary link, to the new supplier');
    assert.deepEqual(
      audit.entries.map((e) => [e.table, e.action]),
      [
        ['supplier_contacts', 'delete'],
        ['spend_item_contacts', 'delete'],
        ['capex_item_contacts', 'delete'],
        ['contract_contacts', 'delete'],
        ['supplier_contacts', 'create'],
        ['spend_item_contacts', 'create'],
        ['capex_item_contacts', 'create'],
        ['contract_contacts', 'create'],
        ['contacts', 'update'],
      ],
      'every link removed or added is audited, then the contact',
    );
    assert.ok(audit.entries.every((e) => e.userId === USER));

    // Saving the same supplier and role again keeps the links and writes only the contact's row.
    audit.entries.length = 0;
    await contacts.update(w.contactId, { supplier_id: w.supplierA2, supplier_role: 'commercial' } as any, opts);
    assert.deepEqual(await linksOn(runner, w.itemsA2, w.contactId), commercial);
    assert.deepEqual(audit.entries.map((e) => [e.table, e.action]), [['contacts', 'update']]);
  });
}

/**
 * The contact's supplier and role are already linked without being primary
 * (from the supplier workspace): saving them on the contact promotes that link
 * instead of inserting a duplicate (a unique violation before F2).
 */
async function testExistingLinkPromotedToPrimary() {
  await withWorld(async (runner, w) => {
    const audit = captureAudit();
    const links = supplierContacts(audit);
    const ctx = { manager: runner.manager, tenantId: w.tenantA, userId: USER };
    const link = await links.attach(w.supplierA, { contactId: w.contactId, role: SupplierContactRole.COMMERCIAL, isPrimary: false }, ctx);
    assert.equal(link.is_primary, false);

    const contacts = new ContactsService(undefined as any, undefined as any, undefined as any, links, audit as any);
    audit.entries.length = 0;
    await contacts.update(w.contactId, { supplier_id: w.supplierA, supplier_role: 'commercial' } as any, ctx);

    const rows: Array<{ id: string; is_primary: boolean }> = await runner.query(
      `SELECT id, is_primary FROM supplier_contacts WHERE contact_id = $1`,
      [w.contactId],
    );
    assert.deepEqual(rows, [{ id: link.id, is_primary: true }], 'the same link, now primary');
    assert.deepEqual(audit.entries.map((e) => [e.table, e.action, e.recordId]), [
      ['supplier_contacts', 'update', link.id],
      ['contacts', 'update', w.contactId],
    ], 'the promotion is audited; the item links were already there');
    assert.deepEqual([audit.entries[0].before.is_primary, audit.entries[0].after.is_primary], [false, true]);
    assert.ok(
      new Date(audit.entries[0].after.updated_at).getTime() > new Date(audit.entries[0].before.updated_at).getTime(),
      'the audited row carries the new updated_at',
    );
    assert.deepEqual(await linksOn(runner, w.itemsA, w.contactId), commercial);
  });
}

/** A contract contact link is detached through its own contract only, like the OPEX and CAPEX ones. */
async function testContractContactDetachScoped() {
  await withWorld(async (runner, w) => {
    const audit = captureAudit();
    const svc = new ContractContactsService(undefined as any, undefined as any, undefined as any, audit as any);
    const opts = { manager: runner.manager, tenantId: w.tenantA };
    const contractId = w.itemsA.contract_contacts;
    const otherContractId = w.itemsA2.contract_contacts;
    const link = await svc.attachManual(contractId, { contactId: w.contactId, role: SupplierContactRole.TECHNICAL }, USER, opts);
    await assert.rejects(
      () => svc.detach(otherContractId, link.id, USER, opts),
      (err: unknown) => err instanceof NotFoundException,
      'a link of another contract is not found',
    );
    const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM contract_contacts WHERE id = $1`, [link.id]);
    assert.equal(n, 1, 'the link is kept');
    await svc.detach(contractId, link.id, USER, opts);
    assert.deepEqual(audit.entries.map((e) => [e.table, e.action, e.recordId]), [
      ['contract_contacts', 'create', link.id],
      ['contract_contacts', 'delete', link.id],
    ]);
  });
}

/** Deleting a contact audits its supplier links and the contact itself. */
async function testContactDeleteAudited() {
  await withWorld(async (runner, w) => {
    const audit = captureAudit();
    const links = supplierContacts(audit);
    const ctx = { manager: runner.manager, tenantId: w.tenantA, userId: USER };
    const link = await links.attach(w.supplierA, { contactId: w.contactId, role: SupplierContactRole.COMMERCIAL }, ctx);
    const contacts = new ContactsService(undefined as any, undefined as any, undefined as any, links, audit as any);
    audit.entries.length = 0;
    await contacts.delete(w.contactId, ctx);
    assert.deepEqual(
      audit.entries.map((e) => [e.table, e.action, e.recordId, e.before?.id, e.after, e.userId]),
      [
        ['supplier_contacts', 'delete', link.id, link.id, null, USER],
        ['contacts', 'delete', w.contactId, w.contactId, null, USER],
      ],
    );
    const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM contacts WHERE id = $1`, [w.contactId]);
    assert.equal(n, 0);
  });
}

void runSpecs('supplier-contacts-propagation.integration.spec', [
  ['testContactDeleteAudited', testContactDeleteAudited],
  ['testExistingLinkPromotedToPrimary', testExistingLinkPromotedToPrimary],
  ['testContractContactDetachScoped', testContractContactDetachScoped],
  ['testAttachAndDetach', testAttachAndDetach],
  ['testForeignSupplierAndContactRefused', testForeignSupplierAndContactRefused],
  ['testContactMovedToAnotherSupplier', testContactMovedToAnotherSupplier],
]);

// `dataSource` is imported so the CI runner schedules this spec on the database lane.
void dataSource;
