import 'dotenv/config';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { CapexItemsService } from '../spend-items.service';
import { ItemNumberService } from '../../common/item-number.service';
import { assert, CAPEX_NUMBER_OFFSET, captureAudit, inRolledBackTransaction, noFreeze, runSpecs, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { loadBudgetFile } from '../../spend/__tests__/budget-file.fixtures';

// A CAPEX status change emails the item's owners, as OPEX does: from the item
// page, the API and the AI, which all go through `update`. The acting user is
// left out and a disabled owner is never a recipient. A budget file load
// changes statuses (through the end of validity) without emailing anyone, on
// CAPEX as on OPEX.

function service(sent: any[]) {
  // The constructor of the OPEX twin since lot Z1 (`spend-items.service.ts`).
  const args: any[] = Array.from({ length: 11 }, () => undefined);
  args[3] = captureAudit();
  args[5] = noFreeze;
  args[6] = { resolveRates: async () => ({ map: new Map(), settings: { allowedCurrencies: null } }) };
  args[8] = { syncFromSupplier: async () => undefined };
  args[9] = { notifyStatusChange: (payload: any) => { sent.push({ ...payload, manager: undefined }); } };
  args[10] = new ItemNumberService();
  return new (CapexItemsService as any)(...args) as CapexItemsService;
}

async function seedUser(runner: QueryRunner, tenantId: string, roleId: string, name: string, status = 'enabled') {
  const [row] = await runner.query(
    `INSERT INTO users (tenant_id, role_id, email, first_name, last_name, status, locale)
     VALUES ($1, $2, $3, $4, 'Owner', $5, 'fr') RETURNING id, email`,
    [tenantId, roleId, `${name}-${tenantId.slice(0, 8)}@example.com`, name, status],
  );
  return row as { id: string; email: string };
}

async function seedCapexWithOwners(runner: QueryRunner) {
  const tenantId = await seedTenant(runner, 'capex-status');
  const [role] = await runner.query(
    `INSERT INTO roles (tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
     VALUES ($1, 'Status test role', 'Status test role', false, false, now(), now()) RETURNING id`,
    [tenantId],
  );
  const itOwner = await seedUser(runner, tenantId, role.id, 'it');
  const businessOwner = await seedUser(runner, tenantId, role.id, 'biz');
  const disabledOwner = await seedUser(runner, tenantId, role.id, 'gone', 'disabled');
  const actor = await seedUser(runner, tenantId, role.id, 'actor');
  const [company] = await runner.query(
    `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'Status company', 'FR', 'Lyon') RETURNING id`,
    [tenantId],
  );
  // CPX-7, stored in spend_items since lot Z1 (its CPX number kept as legacy_number).
  const [item] = await runner.query(
    `INSERT INTO spend_items (tenant_id, nature, product_name, ppe_type, investment_type, priority, currency, effective_start, item_number,
                              legacy_number, paying_company_id, owner_it_id, owner_business_id, status)
     VALUES ($1, 'capex', 'Storage array', 'hardware', 'replacement', 'medium', 'EUR', '2020-01-01', $2, 'CPX-7', $3, $4, $5, 'enabled') RETURNING id`,
    [tenantId, 7 + CAPEX_NUMBER_OFFSET, company.id, itOwner.id, businessOwner.id],
  );
  return { tenantId, itemId: item.id as string, itOwner, businessOwner, disabledOwner, actor };
}

async function testUpdateEmailsOwners() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedCapexWithOwners(runner);
    const sent: any[] = [];
    const svc = service(sent);
    const opts = { manager: runner.manager };

    await svc.update(seed.itemId, { notes: 'No status change' } as any, seed.actor.id, opts);
    assert.equal(sent.length, 0, 'no status change, no email');

    await svc.update(seed.itemId, { status: 'disabled' } as any, seed.actor.id, opts);
    assert.equal(sent.length, 1, 'a status change sends one notification');
    const [mail] = sent;
    assert.equal(mail.itemType, 'capex');
    assert.equal(mail.itemId, seed.itemId);
    assert.equal(mail.itemName, 'Storage array');
    assert.deepEqual([mail.oldStatus, mail.newStatus], ['enabled', 'disabled']);
    assert.equal(mail.tenantId, seed.tenantId);
    assert.equal(mail.excludeUserId, seed.actor.id, 'the acting user is left out');
    assert.deepEqual(
      mail.recipients.map((r: any) => [r.userId, r.email, r.locale]),
      [[seed.itOwner.id, seed.itOwner.email, 'fr'], [seed.businessOwner.id, seed.businessOwner.email, 'fr']],
      'both owners are recipients',
    );

    await runner.query(`UPDATE spend_items SET owner_business_id = $2 WHERE id = $1`, [seed.itemId, seed.disabledOwner.id]);
    sent.length = 0;
    await svc.update(seed.itemId, { status: 'enabled' } as any, seed.actor.id, opts);
    assert.deepEqual(sent[0].recipients.map((r: any) => r.userId), [seed.itOwner.id], 'a disabled owner is not a recipient');

    await runner.query(`UPDATE spend_items SET owner_it_id = NULL, owner_business_id = NULL WHERE id = $1`, [seed.itemId]);
    sent.length = 0;
    await svc.update(seed.itemId, { status: 'disabled' } as any, seed.actor.id, opts);
    assert.equal(sent.length, 0, 'no owner, no email');
  });
}

async function testBudgetFileSendsNothing() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedCapexWithOwners(runner);
    const sent: any[] = [];
    const file = 'item_number,name,end_of_validity,owner_it_email,owner_business_email\n'
      + `CPX-7,Storage array,2024-06-30,${seed.itOwner.email},${seed.businessOwner.email}\n`;

    const result = await loadBudgetFile(runner.manager, 'capex', seed.tenantId, file, captureAudit() as any, service(sent) as any);
    assert.equal(result.ok, true, `load accepted (${JSON.stringify((result as any).errors)})`);
    assert.equal((result as any).updated, 1);
    const [row] = await runner.query(`SELECT status, owner_it_id, owner_business_id FROM spend_items WHERE id = $1 AND nature = 'capex'`, [seed.itemId]);
    assert.deepEqual(
      [row.status, row.owner_it_id, row.owner_business_id],
      ['disabled', seed.itOwner.id, seed.businessOwner.id],
      'the load changed the status, owners kept',
    );
    assert.equal(sent.length, 0, 'the budget file load sends no status-change email');
  });
}

void runSpecs('capex-status-email.integration.spec', [
  ['testUpdateEmailsOwners', testUpdateEmailsOwners],
  ['testBudgetFileSendsNothing', testBudgetFileSendsNothing],
]);

// `dataSource` is imported so the CI runner schedules this spec on the database lane.
void dataSource;
