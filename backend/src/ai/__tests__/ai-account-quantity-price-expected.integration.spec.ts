import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AccountsService } from '../../accounts/accounts.service';
import { AiExecutionContextWithManager } from '../ai.types';
import { adaptFilters } from '../query/ai-filter.adapter';
import { accountsRegistry } from '../query/registries/accounts.registry';
import { AiQueryExecutor } from '../query/ai-query.executor';
import { AI_IMPORT_TARGETS } from '../import/ai-import-targets';
import { defaultColumnTitle } from '../import/ai-import-titles';
import { columnReader } from '../import/ai-import-convert';
import { AiMasterDataMutationSupportService } from '../mutation/ai-master-data-mutation-support.service';

// Kad and the MCP server on the account setting "quantity and price entry"
// (`accounts.quantity_price_expected`, lot B12a of 26.12.1), against a real database, each test
// in a transaction that is rolled back:
// - read: the accounts registry filters on it (true, or null for the accounts without it; false is
//   refused with the accepted values, the column never holds it), and an account's summary carries it;
// - import: the accounts template has the column, yes or no, titled in the person's language; a
//   file's oui/non reach the accounts import as true/false, which sets and clears it;
// - write: Kad's account create and update take it (yes sets it, no clears it, stored null), and
//   the approval card names the field and the values.

const TITLE = 'Quantity and price entry';

async function inRolledBackTransaction(fn: (runner: QueryRunner) => Promise<void>) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await fn(runner);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function seedTenant(runner: QueryRunner, tag: string): Promise<{ tenantId: string; chartId: string }> {
  const tenantId = randomUUID();
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, 'Kad quantity accounts', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `ai-qp-${tag}-${tenantId.slice(0, 8)}`],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const [chart] = await runner.query(
    `INSERT INTO chart_of_accounts (tenant_id, code, name, country_iso) VALUES ($1, 'KQP', 'Kad chart', 'FR') RETURNING id`,
    [tenantId],
  );
  return { tenantId, chartId: chart.id };
}

async function seedAccount(runner: QueryRunner, tenantId: string, chartId: string, number: number, expected: boolean | null): Promise<string> {
  const [row] = await runner.query(
    `INSERT INTO accounts (tenant_id, coa_id, account_number, account_name, quantity_price_expected) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [tenantId, chartId, number, `Account ${number}`, expected],
  );
  return row.id;
}

function accountsService() {
  return new AccountsService(undefined as any, { log: async () => undefined } as any);
}

function masterDataSupport(): any {
  const args: any[] = Array.from({ length: 12 }, () => ({}));
  args[0] = accountsService();
  // The chart an account names, read for the card.
  args[3] = { get: async (id: string, opts: { manager: any }) => (await opts.manager.query(`SELECT * FROM chart_of_accounts WHERE id = $1`, [id]))[0] };
  return new (AiMasterDataMutationSupportService as any)(...args);
}

function context(runner: QueryRunner, tenantId: string): AiExecutionContextWithManager {
  return {
    tenantId,
    userId: null as any,
    isPlatformHost: false,
    surface: 'chat',
    authMethod: 'jwt',
    conversationId: 'account-quantity-price-spec',
    manager: runner.manager,
  } as AiExecutionContextWithManager;
}

async function testRead() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, chartId } = await seedTenant(runner, 'read');
    await seedAccount(runner, tenantId, chartId, 6100, true);
    await seedAccount(runner, tenantId, chartId, 6200, null);
    const accounts = accountsService();
    const numbers = async (aiFilters: Record<string, any>) => {
      const adapted = adaptFilters(accountsRegistry, aiFilters);
      assert.deepEqual(adapted.invalid_values, [], JSON.stringify(aiFilters));
      const page = await accounts.list({ coaId: chartId, sort: 'account_number:ASC', limit: 50, filters: JSON.stringify(adapted.filters) }, { manager: runner.manager });
      return page.items.map((item: any) => Number(item.account_number));
    };
    assert.deepEqual(await numbers({ quantity_price_expected: ['true'] }), [6100], 'true: the accounts that set it');
    assert.deepEqual(await numbers({ quantity_price_expected: [null] }), [6200], 'null: the others');
    const refused = adaptFilters(accountsRegistry, { quantity_price_expected: ['false'] });
    assert.deepEqual(refused.invalid_values.map((value) => [value.field, value.rejected, value.accepted]), [['quantity_price_expected', ['false'], ['true', null]]]);
    assert.ok(accountsRegistry.sortFields.quantity_price_expected && accountsRegistry.aggregate?.groupFields.quantity_price_expected, 'sortable and groupable');

    const map = (row: any) => (Object.create(AiQueryExecutor.prototype) as any).mapAccount(row).metadata.quantity_price_expected;
    assert.equal(map({ id: 'a', account_number: '6100', account_name: 'A', quantity_price_expected: true }), true, 'the summary carries it');
    assert.equal(map({ id: 'b', account_number: '6200', account_name: 'B', quantity_price_expected: null }), null, 'null when not set');
  });
}

async function testImport() {
  const columns = await AI_IMPORT_TARGETS.accounts.columns({ manager: { query: async () => [] } as any, tenantId: randomUUID() } as any);
  const column = columns.find((item) => item.column === 'quantity_price_expected');
  assert.equal(column?.kind, 'boolean', 'the accounts template has the column, yes or no');
  assert.deepEqual(
    (['en', 'fr', 'de', 'es'] as const).map((language) => defaultColumnTitle('quantity_price_expected', language)),
    [TITLE, 'Saisie en quantité et prix', 'Erfassung nach Menge und Preis', 'Introducción por cantidad y precio'],
  );
  const text = (value: string) => ({ kind: 'text' as const, value });
  const cells = [text('Oui'), text('non'), undefined];
  const reader = columnReader({ kind: 'boolean' }, cells, {}, 'fr');
  assert.deepEqual(cells.map((cell) => reader.read(cell)), [
    { status: 'converted', value: 'true' },
    { status: 'converted', value: 'false' },
    { status: 'blank' },
  ]);

  await inRolledBackTransaction(async (runner) => {
    const { tenantId, chartId } = await seedTenant(runner, 'import');
    await seedAccount(runner, tenantId, chartId, 6100, null);
    await seedAccount(runner, tenantId, chartId, 6200, true);
    // The file Kad writes: the chart's code on every row, the converted values.
    const file = { buffer: Buffer.from('coa_code;account_number;quantity_price_expected\nKQP;6100;true\nKQP;6200;false\n', 'utf8') } as Express.Multer.File;
    const result: any = await accountsService().importCsv(
      { file, dryRun: false, language: 'fr', mode: 'enrich' },
      { manager: runner.manager, allowCoaCodeColumn: true },
    );
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    const rows = await runner.query(`SELECT account_number::int AS number, quantity_price_expected AS expected FROM accounts WHERE coa_id = $1 ORDER BY 1`, [chartId]);
    assert.deepEqual(rows.map((row: any) => [row.number, row.expected]), [[6100, true], [6200, null]], 'true sets it, false clears it');
  });
}

async function testWrite() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, chartId } = await seedTenant(runner, 'write');
    const accountId = await seedAccount(runner, tenantId, chartId, 6100, null);
    const ctx = context(runner, tenantId);
    const support = masterDataSupport();

    const created = await support.prepareCreatePreview(ctx, {
      entity_type: 'accounts',
      fields: { coa_id: chartId, account_number: '6300', account_name: 'Created by Kad', quantity_price_expected: 'yes' },
    });
    assert.equal(created.mutationInput.fields.quantity_price_expected, true, 'create: yes sets it');
    assert.equal(created.mutationInput.field_labels.quantity_price_expected, TITLE);

    const set = await support.prepareUpdatePreview(ctx, { entity_type: 'accounts', ref: '6100', fields: { quantity_price_expected: true } });
    assert.equal(set.mutationInput.fields.quantity_price_expected, true, 'update: true sets it');
    await support.executePreview(ctx, { id: randomUUID(), status: 'pending', target_entity_type: 'accounts', target_entity_id: accountId, mutation_input: set.mutationInput, current_values: set.currentValues } as any);
    const stored = async () => (await runner.query(`SELECT quantity_price_expected FROM accounts WHERE id = $1`, [accountId]))[0].quantity_price_expected;
    assert.equal(await stored(), true, 'executed: set');

    const cleared = await support.prepareUpdatePreview(ctx, { entity_type: 'accounts', ref: '6100', fields: { quantity_price_expected: 'no' } });
    assert.equal(cleared.mutationInput.fields.quantity_price_expected, null, 'update: no clears it, never false');
    const card = support.presentPreview({ id: randomUUID(), status: 'pending', target_entity_type: 'accounts', target_entity_id: accountId, mutation_input: cleared.mutationInput, current_values: cleared.currentValues } as any, 'fr');
    assert.deepEqual(card.changes.quantity_price_expected, { label: TITLE, from: 'Yes', to: null, format: 'text' }, 'the card names the change');
    await support.executePreview(ctx, { id: randomUUID(), status: 'pending', target_entity_type: 'accounts', target_entity_id: accountId, mutation_input: cleared.mutationInput, current_values: cleared.currentValues } as any);
    assert.equal(await stored(), null, 'executed: cleared, stored null');
  });
}

async function main() {
  await dataSource.initialize();
  const failures: string[] = [];
  try {
    for (const test of [testRead, testImport, testWrite]) {
      try {
        await test();
        console.log(`ok - ${test.name}`);
      } catch (err) {
        console.error(err);
        failures.push(`${test.name}: ${(err as Error).message.split('\n')[0]}`);
      }
    }
  } finally {
    await dataSource.destroy();
  }
  if (failures.length) {
    throw new Error(`ai-account-quantity-price-expected.integration.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
  }
  console.log('ai-account-quantity-price-expected.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
