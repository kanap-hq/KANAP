import { SupplierContactRole } from '../../contacts/supplier-contact.entity';
import { SpendItemContactsService } from '../spend-item-contacts.service';
import { captureAudit, seedItem } from './round-inputs.fixtures';
import { assert, assertSucceeded, progress, runRaceSpecs, settle, sql, withRace } from './race-harness';

// Race (plan planning/perf-scale, step 0.3, Annexe A #14), fixed by lot 3A:
// `attachManual` inserts through `contacts/contact-link-attach.util.ts`. Runs in CI.
//
// Before lot 3A, `SpendItemContactsService.attachManual` checked for an
// existing (item, contact, role) link and then inserted, without
// `ON CONFLICT`. Two callers that both passed the check: the second insert hit
// `uniq_spend_item_contact_role` (23505), a 500. The sync from the supplier
// inserts `ON CONFLICT DO NOTHING` since b12477e0, so its scenario passed
// already.
// Target: the insert is `ON CONFLICT DO NOTHING`; both callers succeed and
// the item has one link.

function contactsService() {
  return new SpendItemContactsService(undefined as any, undefined as any, undefined as any, captureAudit() as any);
}

type Seeded = { itemId: string; contactId: string; supplierId: string };

async function seedContact(race: { tenantId: string; seedWith: <T>(fn: (runner: any) => Promise<T>) => Promise<T> }): Promise<Seeded> {
  return race.seedWith(async (runner) => {
    const itemId = await seedItem(runner, 'opex', race.tenantId, 1);
    const [contact] = await runner.query(
      `INSERT INTO contacts (tenant_id, email, first_name, last_name) VALUES ($1, 'ana.race@example.com', 'Ana', 'Race') RETURNING id`,
      [race.tenantId],
    );
    const [supplier] = await runner.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Race supplier') RETURNING id`, [race.tenantId]);
    await runner.query(
      `INSERT INTO supplier_contacts (tenant_id, supplier_id, contact_id, role) VALUES ($1, $2, $3, 'commercial')`,
      [race.tenantId, supplier.id, contact.id],
    );
    return { itemId, contactId: contact.id, supplierId: supplier.id };
  });
}

async function linksOf(race: { read: (text: string, params?: unknown[]) => Promise<any[]> }, itemId: string) {
  return race.read(`SELECT contact_id, role::text AS role, origin FROM spend_item_contacts WHERE spend_item_id = $1`, [itemId]);
}

/** Two users attach the same contact with the same role. */
async function twoManualAttaches() {
  await withRace('contacts-manual', async (race) => {
    const { itemId, contactId } = await seedContact(race);
    const a = await race.open('A');
    const b = await race.open('B');
    const params = { contactId, role: SupplierContactRole.COMMERCIAL };

    const aInsert = race.gate(a, { label: 'insert the link', when: 'before', match: sql.insertInto('spend_item_contacts') });
    const aWork = race.start(a, (manager) => contactsService().attachManual(itemId, params, null, { manager, tenantId: race.tenantId }));
    assert.equal(await progress(aWork, { party: a, gate: aInsert }), 'gated', 'harness: A must pause before inserting the link');

    const bWork = race.start(b, (manager) => contactsService().attachManual(itemId, params, null, { manager, tenantId: race.tenantId }));
    await progress(bWork, { party: b });
    aInsert.release();
    const [aDone, bDone] = await Promise.all([settle(aWork), settle(bWork)]);
    assertSucceeded(bDone, 'B (first to commit)');
    assertSucceeded(aDone, 'A (same contact and role)');
    assert.equal((await linksOf(race, itemId)).length, 1, 'one link for the contact and role');
  });
}

/** The supplier sync brings the contact while a user attaches it by hand. */
async function supplierSyncVersusManualAttach() {
  await withRace('contacts-sync', async (race) => {
    const { itemId, contactId, supplierId } = await seedContact(race);
    const sync = await race.open('supplier sync');
    const user = await race.open('manual attach');

    const syncInsert = race.gate(sync, { label: 'insert the supplier link', when: 'before', match: sql.insertInto('spend_item_contacts') });
    const syncWork = race.start(sync, (manager) => contactsService().syncFromSupplier(itemId, supplierId, null, { manager, tenantId: race.tenantId }));
    assert.equal(await progress(syncWork, { party: sync, gate: syncInsert }), 'gated', 'harness: the sync must pause before inserting the link');

    const userWork = race.start(user, (manager) => contactsService().attachManual(itemId, { contactId, role: SupplierContactRole.COMMERCIAL }, null, { manager, tenantId: race.tenantId }));
    await progress(userWork, { party: user });
    syncInsert.release();
    const [syncDone, userDone] = await Promise.all([settle(syncWork), settle(userWork)]);
    assertSucceeded(userDone, 'the manual attach');
    assertSucceeded(syncDone, 'the supplier sync (it runs inside the line update that changed the supplier)');
    assert.equal((await linksOf(race, itemId)).length, 1, 'one link for the contact and role');
  });
}

void runRaceSpecs('Item contact races', [
  ['Annexe A #14: two manual attaches of the same contact and role (3A)', twoManualAttaches],
  ['Annexe A #14: supplier sync and manual attach of the same contact and role (3A)', supplierSyncVersusManualAttach],
]);
