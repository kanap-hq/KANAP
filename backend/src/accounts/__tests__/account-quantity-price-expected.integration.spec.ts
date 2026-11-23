import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AuditService } from '../../audit/audit.service';
import { AccountsService } from '../accounts.service';
import { CsvImportMode, CsvLanguage } from '../../common/csv-sheet';

// The account setting "quantity and price entry" (`accounts.quantity_price_expected`, lot B12a of
// 26.12.1), against a real database, each test in a transaction that is rolled back. The setting
// knows two states, true and NULL: nothing ever stores false.
// - API: create and update write true, or NULL for null and false; an update without it keeps it;
//   the account read returns it; the history row carries it;
// - list: the set filter reads true as the accounts that set it, and null, '' or false as the
//   others (list and listIds agree);
// - CSV import (the import rule, `enrich`): yes in any language sets it, no or `-` clears it, a
//   blank cell or an absent column keeps it, another word is refused with its value, and a row
//   identical to the stored account is unchanged;
// - a second row of the same account number is refused and names the first one, nothing written;
// - CSV export: the column, yes in the file's language, blank when not set.

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
     VALUES ($1, $2, 'Quantity and price accounts', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `qp-expected-${tag}-${tenantId.slice(0, 8)}`],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const [chart] = await runner.query(
    `INSERT INTO chart_of_accounts (tenant_id, code, name, country_iso) VALUES ($1, 'QP', 'Quantity chart', 'FR') RETURNING id`,
    [tenantId],
  );
  return { tenantId, chartId: chart.id };
}

async function seedAccount(runner: QueryRunner, tenantId: string, chartId: string, number: number, expected: boolean | null): Promise<string> {
  const [row] = await runner.query(
    `INSERT INTO accounts (tenant_id, coa_id, account_number, account_name, quantity_price_expected)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [tenantId, chartId, number, `Account ${number}`, expected],
  );
  return row.id;
}

async function storedSettings(runner: QueryRunner, chartId: string): Promise<Record<number, boolean | null>> {
  const rows = await runner.query(
    `SELECT account_number::int AS number, quantity_price_expected AS expected FROM accounts WHERE coa_id = $1 ORDER BY account_number`,
    [chartId],
  );
  return Object.fromEntries(rows.map((row: any) => [row.number, row.expected]));
}

function service() {
  return new AccountsService(undefined as any, new AuditService(undefined as any));
}

function file(lines: string[]): Express.Multer.File {
  return { buffer: Buffer.from(lines.join('\n') + '\n', 'utf8') } as Express.Multer.File;
}

async function importRows(runner: QueryRunner, chartId: string, lines: string[], dryRun: boolean, language: CsvLanguage = 'fr') {
  const mode: CsvImportMode = 'enrich';
  return service().importCsv({ file: file(lines), dryRun, language, mode }, { manager: runner.manager, targetCoaId: chartId }) as Promise<any>;
}

async function testApiWrites() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, chartId } = await seedTenant(runner, 'api');
    const accounts = service();
    const opts = { manager: runner.manager };
    const set = await accounts.create({ coa_id: chartId, account_number: '6100', account_name: 'Staff', quantity_price_expected: true }, undefined, opts);
    assert.equal(set.quantity_price_expected, true, 'create with true sets it');
    const refused = await accounts.create({ coa_id: chartId, account_number: '6200', account_name: 'Other', quantity_price_expected: false }, undefined, opts);
    assert.equal(refused.quantity_price_expected, null, 'create with false stores null');
    const plain = await accounts.create({ coa_id: chartId, account_number: '6300', account_name: 'Plain' }, undefined, opts);
    assert.equal(plain.quantity_price_expected, null, 'create without it: not set');

    await accounts.update(set.id, { account_name: 'Staff renamed' }, undefined, opts);
    assert.equal((await accounts.getWithConsolidationStatus(set.id, opts)).quantity_price_expected, true, 'an update without it keeps it');
    await accounts.update(set.id, { quantity_price_expected: false }, undefined, opts);
    assert.equal((await accounts.get(set.id, opts)).quantity_price_expected, null, 'false clears it, stored null');
    await accounts.update(set.id, { quantity_price_expected: true }, undefined, opts);
    await accounts.update(set.id, { quantity_price_expected: null }, undefined, opts);
    assert.equal((await accounts.get(set.id, opts)).quantity_price_expected, null, 'null clears it');
    await accounts.update(plain.id, { quantity_price_expected: true }, undefined, opts);

    assert.deepEqual(await storedSettings(runner, chartId), { 6100: null, 6200: null, 6300: true }, 'never false in the column');
    const history = await runner.query(
      `SELECT action, before_json->'quantity_price_expected' AS before, after_json->'quantity_price_expected' AS after
         FROM audit_log WHERE table_name = 'accounts' AND record_id = $1 ORDER BY created_at, id`,
      [plain.id],
    );
    assert.deepEqual(history.map((row: any) => [row.action, row.before, row.after]), [['create', null, null], ['update', null, true]], 'the history carries the setting');
    void tenantId;
  });
}

async function testListFilter() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, chartId } = await seedTenant(runner, 'filter');
    await seedAccount(runner, tenantId, chartId, 6100, true);
    await seedAccount(runner, tenantId, chartId, 6200, null);
    await seedAccount(runner, tenantId, chartId, 6300, true);
    const accounts = service();
    const opts = { manager: runner.manager };
    const numbers = async (values: unknown[]) => {
      const filters = JSON.stringify({ quantity_price_expected: { filterType: 'set', values } });
      const page = await accounts.list({ coaId: chartId, sort: 'account_number:ASC', limit: 50, filters }, opts);
      const ids = await accounts.listIds({ coaId: chartId, sort: 'account_number:ASC', filters }, opts);
      assert.equal(ids.total, page.total, `listIds agrees with list for ${JSON.stringify(values)}`);
      return page.items.map((item: any) => Number(item.account_number));
    };
    assert.deepEqual(await numbers(['true']), [6100, 6300], "'true': the accounts that set it");
    assert.deepEqual(await numbers([true]), [6100, 6300], 'true');
    assert.deepEqual(await numbers([null]), [6200], 'null: the others');
    assert.deepEqual(await numbers(['']), [6200], "'': the others");
    assert.deepEqual(await numbers(['false']), [6200], "'false': the others, never stored false");
    assert.deepEqual(await numbers(['true', null]), [6100, 6200, 6300], 'both');
    const page = await accounts.list({ coaId: chartId, sort: 'account_number:ASC', limit: 50 }, opts);
    assert.deepEqual(page.items.map((item: any) => item.quantity_price_expected), [true, null, true], 'the list returns it');
  });
}

async function testImport() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, chartId } = await seedTenant(runner, 'import');
    await seedAccount(runner, tenantId, chartId, 6100, null);
    await seedAccount(runner, tenantId, chartId, 6200, true);
    await seedAccount(runner, tenantId, chartId, 6300, true);
    await seedAccount(runner, tenantId, chartId, 6400, true);
    await seedAccount(runner, tenantId, chartId, 6500, true);
    await seedAccount(runner, tenantId, chartId, 6600, null);
    const lines = [
      'account_number;account_name;quantity_price_expected',
      '6100;;oui', // sets it
      '6200;;non', // clears it
      '6300;;', // blank: keeps it
      '6400;;-', // `-`: clears it
      '6500;;Ja', // yes in another language, already set: unchanged
      '6600;;no', // no on an account without it: unchanged
      '6700;New account;yes', // a new account set from the start
      '6800;Other new account;', // a new account without it
    ];
    const check = await importRows(runner, chartId, lines, true);
    assert.equal(check.ok, true, JSON.stringify(check.errors));
    assert.deepEqual([check.inserted, check.updated, check.unchanged, check.cleared], [2, 3, 3, 1], 'counts of the dry run');
    const load = await importRows(runner, chartId, lines, false);
    assert.equal(load.ok, true, JSON.stringify(load.errors));
    assert.deepEqual(await storedSettings(runner, chartId), {
      6100: true, 6200: null, 6300: true, 6400: null, 6500: true, 6600: null, 6700: true, 6800: null,
    });

    // A file without the column changes nothing of the setting.
    const without = await importRows(runner, chartId, ['account_number;account_name', '6100;Renamed', '6300;Renamed too'], false);
    assert.equal(without.ok, true, JSON.stringify(without.errors));
    const after = await storedSettings(runner, chartId);
    assert.deepEqual([after[6100], after[6300]], [true, true], 'an absent column keeps the setting');

    // Another word is refused with its value, nothing written.
    const invalid = await importRows(runner, chartId, ['account_number;quantity_price_expected', '6200;peut-être'], false);
    assert.equal(invalid.ok, false);
    assert.deepEqual(invalid.errors.map((e: any) => [e.row, e.column, e.code, e.params?.value]), [[2, 'quantity_price_expected', 'CSV_BOOLEAN_INVALID', 'peut-être']]);
    assert.equal((await storedSettings(runner, chartId))[6200], null, 'the refused row wrote nothing');
  });
}

async function testDuplicateRow() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, chartId } = await seedTenant(runner, 'duplicate');
    await seedAccount(runner, tenantId, chartId, 6100, null);
    // The same account twice (`06100` is stored as 6100), with two different settings.
    const result = await importRows(runner, chartId, [
      'account_number;account_name;quantity_price_expected',
      '6100;Staff;oui',
      '6200;Travel;non',
      '06100;Staff again;non',
    ], true);
    assert.equal(result.ok, false, 'a second row of the same account is refused');
    assert.deepEqual(
      result.errors.map((e: any) => [e.row, e.column, e.code, e.params]),
      [[4, 'account_number', 'CSV_DUPLICATE_KEY', { columns: 'account_number', firstRow: 2 }]],
    );
    const load = await importRows(runner, chartId, ['account_number;account_name', '6100;Staff', '6100;Staff'], false);
    assert.equal(load.ok, false, 'refused on the real run too');
    assert.equal((await storedSettings(runner, chartId))[6100], null, 'nothing written');
  });
}

async function testExport() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, chartId } = await seedTenant(runner, 'export');
    await seedAccount(runner, tenantId, chartId, 6100, true);
    await seedAccount(runner, tenantId, chartId, 6200, null);
    const exported: any = await service().exportCsv('data', { manager: runner.manager, coaId: chartId, language: 'fr' });
    const text = Buffer.isBuffer(exported.body) ? exported.body.toString('utf8') : String(exported.body ?? exported.content ?? exported);
    const rows = text.replace(/^﻿/, '').trim().split(/\r?\n/).map((line: string) => line.split(';'));
    const column = rows[0].indexOf('quantity_price_expected');
    assert.ok(column >= 0, `the export carries the column: ${rows[0].join(';')}`);
    const byNumber = Object.fromEntries(rows.slice(1).map((row: string[]) => [row[0].replace(/^'/, ''), row[column]]));
    assert.deepEqual([byNumber['6100'], byNumber['6200']], ['oui', ''], 'yes in the file language, blank when not set');

    // The export reads back unchanged.
    const back = await importRows(runner, chartId, rows.map((row: string[]) => row.join(';')), true);
    assert.equal(back.ok, true, JSON.stringify(back.errors));
    assert.equal(back.unchanged, 2, 'an exported file imports as unchanged');
  });
}

async function main() {
  await dataSource.initialize();
  const failures: string[] = [];
  try {
    for (const test of [testApiWrites, testListFilter, testImport, testDuplicateRow, testExport]) {
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
    throw new Error(`account-quantity-price-expected.integration.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
  }
  console.log('account-quantity-price-expected.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
