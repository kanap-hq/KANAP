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
  type RecordHistoryPage,
} from '../record-history.service';
import { audit, seedHistoryData, seedPerson, type HistorySeed, type Person } from './record-history.fixtures';

// A person limited by data access reads a contact's history (lot 2 family B, socle rule): the
// supplier is not scoped and stays named, while a contract or a budget line of another company,
// out of their data access, reads as "a contract" / "a budget line". The same page for an
// unrestricted reader names both, which proves the difference is the data access and not the
// presentation. `data_access_apply` switches the transaction to the limited role, as the request
// does.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

type Seeded = {
  data: HistorySeed;
  limited: Person;
  reader: Person;
};

const PERMISSIONS = { contacts: 'reader', suppliers: 'reader', contracts: 'reader', budget: 'reader' } as const;

async function readPage(
  person: Person,
  tenantId: string,
  id: string,
  permissions: Record<string, string>,
  limited: boolean,
): Promise<RecordHistoryPage> {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    if (limited) {
      const rows: Array<{ mode: string }> = await runner.query(`SELECT data_access_apply($1) AS mode`, [person.id]);
      assert.equal(rows[0]?.mode, 'limited', 'the transaction takes the limited role');
    }
    const ctx: RecordHistoryContext = {
      tenantId,
      userId: person.id,
      isAdmin: false,
      permissions,
      manager: runner.manager,
    };
    return await new RecordHistoryService().list(ctx, 'contacts', id, { limit: '100' });
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction().catch(() => undefined);
    await runner.release();
  }
}

function linkReferences(page: RecordHistoryPage, field: 'contract' | 'budget_line'): unknown[] {
  const values: unknown[] = [];
  for (const item of page.items) {
    for (const change of item.changes) {
      if (change.field === field && change.event === 'added') values.push(change.after);
    }
  }
  return values;
}

async function seedAudits(runner: QueryRunner, data: HistorySeed) {
  const [stored] = await runner.query(`SELECT to_jsonb(c) AS row FROM contacts c WHERE c.id = $1`, [data.contact]);
  await audit(runner, {
    table: 'contacts', recordId: data.contact, action: 'create', after: { ...stored.row, supplier_role: 'commercial' },
  });
  const link = (label: string, payload: Record<string, unknown>) => audit(runner, {
    table: label, recordId: randomUUID(), action: 'create', after: { id: randomUUID(), tenant_id: data.tenantId, contact_id: data.contact, role: 'commercial', origin: 'manual', ...payload },
  });
  await link('supplier_contacts', { supplier_id: data.supplier, is_primary: true });
  await link('contract_contacts', { contract_id: data.contractA });
  await link('contract_contacts', { contract_id: data.contractB });
  await link('spend_item_contacts', { spend_item_id: data.opexLine });
  await link('spend_item_contacts', { spend_item_id: data.hiddenLine });
  await link('capex_item_contacts', { capex_item_id: data.capexLine });
}

async function testUnrestricted(seeded: Seeded) {
  const page = await readPage(seeded.reader, seeded.data.tenantId, seeded.data.contact, PERMISSIONS, false);
  const contracts = linkReferences(page, 'contract').filter((value: any) => value && !value.hidden) as any[];
  const lines = linkReferences(page, 'budget_line').filter((value: any) => value && !value.hidden) as any[];
  assert.deepEqual(contracts.map((value) => value.label).sort(), ['Beta Contract', 'Support Contract']);
  assert.deepEqual(lines.map((value) => value.reference).sort(), ['BL-1', 'BL-2', 'BL-3']);
  assert.ok(!JSON.stringify(page).includes('"hidden":true,"kind":"contract"'), 'nothing is hidden for this reader');
  console.log('  an unrestricted reader names both contracts and the three budget lines: OK');
}

async function testLimited(seeded: Seeded) {
  const page = await readPage(seeded.limited, seeded.data.tenantId, seeded.data.contact, PERMISSIONS, true);
  const contracts = linkReferences(page, 'contract').filter((value: any) => value && !value.hidden) as any[];
  const hiddenContracts = linkReferences(page, 'contract').filter((value: any) => value && value.hidden) as any[];
  const lines = linkReferences(page, 'budget_line').filter((value: any) => value && !value.hidden) as any[];
  const hiddenLines = linkReferences(page, 'budget_line').filter((value: any) => value && value.hidden) as any[];

  assert.deepEqual(contracts.map((value) => value.label), ['Support Contract'], 'the in-scope contract is named');
  assert.deepEqual(hiddenContracts.map((value) => value.kind), ['contract'], 'the out-of-scope contract is a contract');
  assert.deepEqual(
    lines.map((value) => value.reference).sort(),
    ['BL-1', 'BL-2'],
    'the lines of the person\'s company are named',
  );
  assert.deepEqual(hiddenLines.map((value) => value.kind), ['budget_line'], 'the out-of-scope line is a budget line');

  const serialized = JSON.stringify(page);
  for (const hidden of ['Beta Contract', 'Beta line']) {
    assert.ok(!serialized.includes(hidden), `an out-of-scope record is never named: ${hidden}`);
  }
  assert.ok(serialized.includes('Acme Supplies'), 'the supplier is not scoped by data access and stays named');
  console.log('  a limited person names the in-scope contract and lines, the others stay unnamed: OK');
}

async function run() {
  await dataSource.initialize();
  const tenantId = await createRaceTenant('record-history-contacts-limited');
  try {
    const seeded = await seed(tenantId, async (runner) => {
      const data = await seedHistoryData(runner, tenantId);
      await seedAudits(runner, data);
      const reader = await seedPerson(runner, tenantId, { first: 'Una', last: 'Unlimited' }, PERMISSIONS);
      const limited = await seedPerson(
        runner,
        tenantId,
        { first: 'Lila', last: 'Limited' },
        PERMISSIONS,
        { mode: 'limited', nodeCompanyId: data.companyA },
      );
      return { data, limited, reader };
    });
    console.log('record history contacts, limited person');
    await testUnrestricted(seeded);
    await testLimited(seeded);
    console.log('record-history-contacts-limited.integration.spec: ok');
  } finally {
    await dropRaceTenant(tenantId);
    await dataSource.destroy();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
