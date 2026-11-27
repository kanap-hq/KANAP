import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AccountsService } from '../../accounts/accounts.service';
import { AiExecutionContextWithManager } from '../ai.types';
import { AiQueryExecutor } from '../query/ai-query.executor';
import { AI_IMPORT_TARGETS } from '../import/ai-import-targets';
import { defaultColumnTitle } from '../import/ai-import-titles';
import { columnReader } from '../import/ai-import-convert';
import { AiMasterDataMutationSupportService } from '../mutation/ai-master-data-mutation-support.service';
import { AiCodeNamer, withCodeNames } from '../ai-code-names';

// Kad and the MCP server on the units an account expects (`accounts.expected_units`), against a
// real database, each test in a transaction that is rolled back:
// - read: an account's summary carries the units by code, and the read tools name them as the
//   budget tab does, in the person's language (`expected_units_name`), never the code alone;
// - import: the accounts template has the column, its units read by their word in any language,
//   titled in the person's language; the file Kad writes reaches the accounts import;
// - write: Kad's account create and update take the units under approval, by code or by word; an
//   unknown unit and units for an account left without the setting are refused before the card;
//   clearing the setting of an account with units clears them too, and the card says so.

const TITLE = 'Expected units';

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
     VALUES ($1, $2, 'Kad units accounts', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `ai-units-${tag}-${tenantId.slice(0, 8)}`],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const [chart] = await runner.query(
    `INSERT INTO chart_of_accounts (tenant_id, code, name, country_iso) VALUES ($1, 'KEU', 'Kad chart', 'FR') RETURNING id`,
    [tenantId],
  );
  return { tenantId, chartId: chart.id };
}

async function seedAccount(runner: QueryRunner, tenantId: string, chartId: string, number: number, expected: true | null, units: string[] | null = null): Promise<string> {
  const [row] = await runner.query(
    `INSERT INTO accounts (tenant_id, coa_id, account_number, account_name, quantity_price_expected, expected_units)
     VALUES ($1, $2, $3, $4, $5, $6::text[]) RETURNING id`,
    [tenantId, chartId, number, `Account ${number}`, expected, units],
  );
  return row.id;
}

function accountsService() {
  return new AccountsService(undefined as any, { log: async () => undefined } as any);
}

function masterDataSupport(): any {
  const args: any[] = Array.from({ length: 12 }, () => ({}));
  args[0] = accountsService();
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
    conversationId: 'account-expected-units-spec',
    manager: runner.manager,
  } as AiExecutionContextWithManager;
}

async function testRead() {
  const map = (row: any) => (Object.create(AiQueryExecutor.prototype) as any).mapAccount(row);
  const summary = map({ id: 'a', account_number: '6100', account_name: 'A', quantity_price_expected: true, expected_units: ['people', 'days'] });
  assert.equal(summary.metadata.expected_units, 'people, days', 'the summary carries the units by code');
  assert.equal(map({ id: 'b', account_number: '6200', account_name: 'B', quantity_price_expected: null, expected_units: null }).metadata.expected_units, null, 'null without units');
  for (const [language, words] of [['fr', 'personnes, jours'], ['de', 'Personen, Tage'], ['en', 'people, days']] as const) {
    const named: any = withCodeNames('query_entities', { entity_type: 'accounts' }, { items: [summary] }, new AiCodeNamer(language));
    assert.equal(named.items[0].metadata.expected_units_name, words, `${language}: the units named as the budget tab names them`);
  }
  const detail: any = withCodeNames('get_entity_detail', { entity_type: 'accounts' }, { item: summary, data: {} }, new AiCodeNamer('es'));
  assert.equal(detail.item.metadata.expected_units_name, 'personas, días', 'the detail names them too');
}

async function testImport() {
  const columns = await AI_IMPORT_TARGETS.accounts.columns({ manager: { query: async () => [] } as any, tenantId: randomUUID() } as any);
  const column = columns.find((item) => item.column === 'expected_units');
  assert.ok(column, 'the accounts template has the column');
  assert.deepEqual([column!.kind, column!.multi, column!.codes], ['codes', true, ['people', 'days', 'pieces']], 'codes, several per cell');
  assert.deepEqual(
    (['en', 'fr', 'de', 'es'] as const).map((language) => defaultColumnTitle('expected_units', language)),
    [TITLE, 'Unités attendues', 'Erwartete Einheiten', 'Unidades esperadas'],
  );
  const text = (value: string) => ({ kind: 'text' as const, value });
  const cells = [text('Personnes, jours'), text('Stück'), text('heures'), undefined];
  // The rule the mapping service builds from the template column: each code with its words.
  const codeLabels = Object.fromEntries(column!.codes!.map((code) => [code, Object.values(column!.labels!).map((names) => names[code])]));
  const reader = columnReader({ kind: 'codes', codes: column!.codes, codeLabels, multi: true }, cells, {}, 'fr');
  assert.deepEqual(cells.map((cell) => reader.read(cell)), [
    { status: 'converted', value: 'people, days' },
    { status: 'converted', value: 'pieces' },
    { status: 'unread', raw: 'heures' },
    { status: 'blank' },
  ]);

  await inRolledBackTransaction(async (runner) => {
    const { tenantId, chartId } = await seedTenant(runner, 'import');
    await seedAccount(runner, tenantId, chartId, 6100, null);
    await seedAccount(runner, tenantId, chartId, 6200, true, ['pieces']);
    // The file Kad writes: the chart's code on every row, the converted values.
    const file = { buffer: Buffer.from('coa_code;account_number;quantity_price_expected;expected_units\nKEU;6100;true;"people, days"\nKEU;6200;;-\n', 'utf8') } as Express.Multer.File;
    const result: any = await accountsService().importCsv({ file, dryRun: false, language: 'fr', mode: 'enrich' }, { manager: runner.manager, allowCoaCodeColumn: true });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    const rows = await runner.query(`SELECT account_number::int AS number, quantity_price_expected AS expected, expected_units AS units FROM accounts WHERE coa_id = $1 ORDER BY 1`, [chartId]);
    assert.deepEqual(rows.map((row: any) => [row.number, row.expected, row.units]), [[6100, true, ['people', 'days']], [6200, true, null]], 'set, then cleared by `-`');
  });
}

async function testWrite() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, chartId } = await seedTenant(runner, 'write');
    const ticked = await seedAccount(runner, tenantId, chartId, 6100, true, ['people', 'days']);
    await seedAccount(runner, tenantId, chartId, 6200, null);
    const ctx = context(runner, tenantId);
    const support = masterDataSupport();
    const stored = async (id: string) => (await runner.query(`SELECT quantity_price_expected AS expected, expected_units AS units FROM accounts WHERE id = $1`, [id]))[0];
    const execute = (preview: any, id: string | null) => support.executePreview(ctx, {
      id: randomUUID(), status: 'pending', target_entity_type: 'accounts', target_entity_id: id, mutation_input: preview.mutationInput, current_values: preview.currentValues,
    } as any);
    const card = (preview: any, id: string) => support.presentPreview({
      id: randomUUID(), status: 'pending', target_entity_type: 'accounts', target_entity_id: id, mutation_input: preview.mutationInput, current_values: preview.currentValues,
    } as any, 'fr');

    const created = await support.prepareCreatePreview(ctx, {
      entity_type: 'accounts',
      fields: { coa_id: chartId, account_number: '6300', account_name: 'Created by Kad', quantity_price_expected: 'yes', expected_units: 'pièces, personnes' },
    });
    assert.deepEqual(created.mutationInput.fields.expected_units, ['people', 'pieces'], 'create: words in any language, stored as codes in the tab order');
    assert.equal(created.mutationInput.field_labels.expected_units, TITLE);
    const made: any = await execute(created, null);
    void made;
    const [createdRow] = await runner.query(`SELECT expected_units AS units FROM accounts WHERE coa_id = $1 AND account_number = 6300`, [chartId]);
    assert.deepEqual(createdRow.units, ['people', 'pieces'], 'executed: created with its units');

    const changed = await support.prepareUpdatePreview(ctx, { entity_type: 'accounts', ref: '6100', fields: { expected_units: ['pieces'] } });
    assert.deepEqual(card(changed, ticked).changes.expected_units, { label: TITLE, from: 'people, days', to: 'pieces', format: 'text' }, 'the card shows the units, named on the screen by code');
    await execute(changed, ticked);
    assert.deepEqual((await stored(ticked)).units, ['pieces'], 'executed: changed');

    await assert.rejects(
      support.prepareUpdatePreview(ctx, { entity_type: 'accounts', ref: '6100', fields: { expected_units: 'heures' } }),
      (error: any) => error?.status === 400 && /"heures" is no unit/.test(error.message),
      'an unknown unit is refused before the card',
    );
    await assert.rejects(
      support.prepareUpdatePreview(ctx, { entity_type: 'accounts', ref: '6200', fields: { expected_units: 'people' } }),
      (error: any) => error?.status === 400 && /quantity and price entry/.test(error.message),
      'units for an account without the setting are refused before the card',
    );
    const both = await support.prepareUpdatePreview(ctx, { entity_type: 'accounts', ref: '6200', fields: { quantity_price_expected: 'yes', expected_units: 'days' } });
    assert.deepEqual([both.mutationInput.fields.quantity_price_expected, both.mutationInput.fields.expected_units], [true, ['days']], 'the setting and its units in one change');

    const unticked = await support.prepareUpdatePreview(ctx, { entity_type: 'accounts', ref: '6100', fields: { quantity_price_expected: 'no' } });
    assert.deepEqual(unticked.mutationInput.fields, { quantity_price_expected: null, expected_units: null }, 'clearing the setting clears its units');
    assert.deepEqual(card(unticked, ticked).changes.expected_units, { label: TITLE, from: 'pieces', to: null, format: 'text' }, 'and the card says so');
    await execute(unticked, ticked);
    assert.deepEqual(await stored(ticked), { expected: null, units: null }, 'executed: both cleared');
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
    throw new Error(`ai-account-expected-units.integration.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
  }
  console.log('ai-account-expected-units.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
