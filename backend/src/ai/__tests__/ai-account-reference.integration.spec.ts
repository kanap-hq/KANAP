import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AiBusinessRecordMutationSupportService } from '../mutation/ai-business-record-mutation-support.service';
import { AiMasterDataMutationSupportService } from '../mutation/ai-master-data-mutation-support.service';
import { AiExecutionContextWithManager } from '../ai.types';
import { AccountsService } from '../../accounts/accounts.service';
import { inRolledBackTransaction, Kind, seedTenant, setTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { itemService, seedCompany } from '../../spend/__tests__/cost-center.fixtures';

// The AI resolves an account reference by number, name, "number - name" or
// id. `accounts.account_number` is an integer: compared to the text reference
// without a cast, the lookup failed in SQL, and with it every AI OPEX or CAPEX
// write naming an account (an id included). Both mutation services are
// covered: the OPEX and CAPEX line fields, and the master-data record lookup.
// The accounts list (the chart of accounts grid, and the AI account queries
// that go through it) filters the number as text: "contains 60" used to fail
// in SQL (ILIKE on an integer), and so did a quick search such as "6000.5".

const KINDS: Kind[] = ['opex', 'capex'];
const ENTITY: Record<Kind, 'spend_items' | 'capex_items'> = { opex: 'spend_items', capex: 'capex_items' };
const COMPANY = 'AI account company';
const ACCOUNT_NAME = `${COMPANY} account`;

function businessRecordSupport(): any {
  return new AiBusinessRecordMutationSupportService(
    {} as any, {} as any, {} as any, itemService('capex'), {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    itemService('opex'), {} as any,
  );
}

function masterDataSupport(): any {
  const args: any[] = Array.from({ length: 12 }, () => ({}));
  // An id is read through the accounts service.
  args[0] = new AccountsService(undefined as any, { log: async () => undefined } as any);
  return new (AiMasterDataMutationSupportService as any)(...args);
}

function context(runner: QueryRunner, tenantId: string): AiExecutionContextWithManager {
  return {
    tenantId,
    userId: null as any,
    isPlatformHost: false,
    surface: 'chat',
    authMethod: 'jwt',
    conversationId: 'account-reference-spec',
    manager: runner.manager,
  } as AiExecutionContextWithManager;
}

function createFields(kind: Kind, account: string) {
  const base = kind === 'opex'
    ? { product_name: 'AI line', paying_company: COMPANY, currency: 'EUR', effective_start: '2026-01-01' }
    : { description: 'AI line', paying_company: COMPANY, currency: 'EUR', effective_start: '2026-01-01' };
  return { ...base, account };
}

async function testAccountReferences() {
  await inRolledBackTransaction(async (runner) => {
    // Another tenant's account with the same number never matches.
    const other = await seedTenant(runner, 'ai-account-other');
    await seedCompany(runner, other, COMPANY);

    const tenantId = await seedTenant(runner, 'ai-account');
    await setTenant(runner, tenantId);
    const { accountId } = await seedCompany(runner, tenantId, COMPANY);
    // Account 60000 must not match "6000".
    const [{ coa_id: chartId }] = await runner.query(`SELECT coa_id FROM accounts WHERE id = $1`, [accountId]);
    await runner.query(`INSERT INTO accounts (tenant_id, coa_id, account_number, account_name) VALUES ($1, $2, 60000, 'Other account')`, [tenantId, chartId]);

    const ctx = context(runner, tenantId);
    const refs = ['6000', ACCOUNT_NAME, `6000 - ${ACCOUNT_NAME}`, accountId];

    const business = businessRecordSupport();
    for (const kind of KINDS) {
      for (const ref of refs) {
        const prepared = await business.prepareCreatePreview(ctx, { entity_type: ENTITY[kind], fields: createFields(kind, ref) });
        assert.equal((prepared.mutationInput.fields as any).account_id, accountId, `${kind}: account "${ref}" resolves`);
      }
    }

    const masterData = masterDataSupport();
    for (const ref of refs) {
      const resolved = await masterData['resolveRecordReference'](ctx, 'accounts', ref);
      assert.equal(resolved.id, accountId, `master data: account "${ref}" resolves`);
    }
  });
}

async function testAccountNumberTextFilter() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'ai-account-filter');
    await setTenant(runner, tenantId);
    const { chartId } = await seedCompany(runner, tenantId, COMPANY);
    for (const [number, name] of [[60000, 'Sixty thousand'], [7000, 'Seven thousand']] as const) {
      await runner.query(`INSERT INTO accounts (tenant_id, coa_id, account_number, account_name) VALUES ($1, $2, $3, $4)`, [tenantId, chartId, number, name]);
    }
    const svc = new AccountsService(undefined as any, { log: async () => undefined } as any);
    const opts = { manager: runner.manager };
    const numbers = async (query: any) => {
      const page = await svc.list(query, opts);
      const ids = await svc.listIds(query, opts);
      assert.equal(ids.total, page.total, `ids and list agree (${JSON.stringify(query)})`);
      return page.items.map((item: any) => Number(item.account_number)).sort((a: number, b: number) => a - b);
    };
    const filter = (model: unknown) => ({ filters: JSON.stringify({ account_number: model }) });
    assert.deepEqual(await numbers(filter({ filterType: 'text', type: 'contains', filter: '60' })), [6000, 60000], 'contains');
    assert.deepEqual(await numbers(filter({ filterType: 'text', type: 'equals', filter: '7000' })), [7000], 'equals');
    assert.deepEqual(await numbers(filter({ filterType: 'text', type: 'startsWith', filter: '6' })), [6000, 60000], 'starts with');
    assert.deepEqual(
      await numbers(filter({ operator: 'OR', conditions: [{ filterType: 'text', type: 'equals', filter: '7000' }, { filterType: 'text', type: 'endsWith', filter: '0000' }] })),
      [7000, 60000],
      'two conditions',
    );
    assert.deepEqual(await numbers({ q: '6000.5' }), [], 'a decimal quick search matches no number');
    assert.deepEqual(await numbers({ q: '7000' }), [7000], 'an integer quick search matches the number');
  });
}

async function main() {
  await dataSource.initialize();
  try {
    await testAccountReferences();
    await testAccountNumberTextFilter();
  } finally {
    await dataSource.destroy();
  }
  console.log('ai-account-reference.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
