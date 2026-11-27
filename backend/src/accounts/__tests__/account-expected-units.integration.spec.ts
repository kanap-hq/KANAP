import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AuditService } from '../../audit/audit.service';
import { AccountsService } from '../accounts.service';
import { CsvImportMode, CsvLanguage } from '../../common/csv-sheet';

// The units an account expects (`accounts.expected_units`), an option of its
// "quantity and price entry" setting, against a real database, each test in a transaction that is
// rolled back.
// - API: create and update store the known units once each, in the budget tab's order (people,
//   days, pieces); null or [] clears them; units sent for an account without the setting are
//   refused (400 naming `expected_units`); clearing the setting clears its units; the history
//   carries them; a change of them dates the account;
// - CSV import (the import rule, `enrich`): units by their code or their word in any language,
//   separated by commas; `-` clears them, a blank cell or an absent column keeps them; an unknown
//   unit is refused with its value; units on an account left without the setting are refused;
//   "no" on the setting clears the units with it; the same units in another order are unchanged;
// - CSV export: the column, the units in the file's language; the export reimports unchanged;
// - the list's column filter returns what the cell shows: an account matches when it expects one of
//   the units ticked or, for "Any unit", when it sets the entry without naming units (an account
//   without the setting shows nothing); the list (and the selection's ids) carry the units.

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
     VALUES ($1, $2, 'Expected units accounts', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `units-${tag}-${tenantId.slice(0, 8)}`],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const [chart] = await runner.query(
    `INSERT INTO chart_of_accounts (tenant_id, code, name, country_iso) VALUES ($1, 'EU', 'Units chart', 'FR') RETURNING id`,
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

async function stored(runner: QueryRunner, chartId: string): Promise<Record<number, [boolean | null, string[] | null]>> {
  const rows = await runner.query(
    `SELECT account_number::int AS number, quantity_price_expected AS expected, expected_units AS units FROM accounts WHERE coa_id = $1 ORDER BY account_number`,
    [chartId],
  );
  return Object.fromEntries(rows.map((row: any) => [row.number, [row.expected, row.units]]));
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
    const { chartId } = await seedTenant(runner, 'api');
    const accounts = service();
    const opts = { manager: runner.manager };
    const staff = await accounts.create(
      { coa_id: chartId, account_number: '6100', account_name: 'Staff', quantity_price_expected: true, expected_units: ['days', 'people', 'days'] },
      undefined, opts,
    );
    assert.deepEqual(staff.expected_units, ['people', 'days'], 'once each, in the tab order');
    const plain = await accounts.create({ coa_id: chartId, account_number: '6200', account_name: 'Plain' }, undefined, opts);
    assert.equal(plain.expected_units, null, 'create without units: none');

    await assert.rejects(
      accounts.create({ coa_id: chartId, account_number: '6300', account_name: 'Refused', expected_units: ['pieces'] }, undefined, opts),
      (error: any) => error?.status === 400 && error?.response?.field === 'expected_units',
      'units without the setting are refused, naming the field',
    );
    await assert.rejects(
      accounts.update(plain.id, { expected_units: ['pieces'] }, undefined, opts),
      (error: any) => error?.status === 400 && error?.response?.field === 'expected_units',
      'an update that sends units to an account without the setting is refused',
    );

    await accounts.update(staff.id, { account_name: 'Staff renamed' }, undefined, opts);
    assert.deepEqual((await accounts.getWithConsolidationStatus(staff.id, opts)).expected_units, ['people', 'days'], 'an update without them keeps them; the read returns them');
    await accounts.update(staff.id, { expected_units: ['pieces'] }, undefined, opts);
    assert.deepEqual((await accounts.get(staff.id, opts)).expected_units, ['pieces'], 'an update sets them');
    await accounts.update(staff.id, { expected_units: [] }, undefined, opts);
    assert.equal((await accounts.get(staff.id, opts)).expected_units, null, '[] clears them, stored null');
    await accounts.update(staff.id, { expected_units: ['days'] }, undefined, opts);
    await accounts.update(staff.id, { expected_units: null }, undefined, opts);
    assert.equal((await accounts.get(staff.id, opts)).expected_units, null, 'null clears them');
    await accounts.update(staff.id, { expected_units: ['people'] }, undefined, opts);
    await accounts.update(staff.id, { quantity_price_expected: null }, undefined, opts);
    assert.deepEqual((await stored(runner, chartId))[6100], [null, null], 'unticking the setting clears its units');
    await assert.rejects(
      accounts.update(staff.id, { quantity_price_expected: null, expected_units: ['people'] }, undefined, opts),
      (error: any) => error?.status === 400,
      'clearing the setting while sending units is refused',
    );

    // The units alone date the account.
    await accounts.update(plain.id, { quantity_price_expected: true }, undefined, opts);
    await runner.query(`UPDATE accounts SET updated_at = '2026-01-01T00:00:00Z' WHERE id = $1`, [plain.id]);
    await accounts.update(plain.id, { expected_units: ['pieces'] }, undefined, opts);
    const [dated] = await runner.query(`SELECT updated_at = now() AS dated FROM accounts WHERE id = $1`, [plain.id]);
    assert.equal(dated.dated, true, 'a change of the units dates the account');

    const history = await runner.query(
      `SELECT action, before_json->'expected_units' AS before, after_json->'expected_units' AS after
         FROM audit_log WHERE table_name = 'accounts' AND record_id = $1 ORDER BY created_at, id`,
      [staff.id],
    );
    assert.deepEqual(
      history.map((row: any) => [row.action, row.before, row.after]),
      [
        ['create', null, ['people', 'days']],
        ['update', ['people', 'days'], ['people', 'days']],
        ['update', ['people', 'days'], ['pieces']],
        ['update', ['pieces'], null],
        ['update', null, ['days']],
        ['update', ['days'], null],
        ['update', null, ['people']],
        ['update', ['people'], null],
      ],
      'the history carries the units',
    );
  });
}

async function testImport() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, chartId } = await seedTenant(runner, 'import');
    await seedAccount(runner, tenantId, chartId, 6100, true);
    await seedAccount(runner, tenantId, chartId, 6200, true, ['pieces']);
    await seedAccount(runner, tenantId, chartId, 6300, true, ['pieces']);
    await seedAccount(runner, tenantId, chartId, 6400, true, ['people', 'days']);
    await seedAccount(runner, tenantId, chartId, 6500, true, ['people', 'days']);
    await seedAccount(runner, tenantId, chartId, 6600, true, ['people']);
    await seedAccount(runner, tenantId, chartId, 6700, null);
    const lines = [
      'account_number;account_name;quantity_price_expected;expected_units',
      '6100;;;personnes, jours', // French words: people and days
      '6200;;;', // blank: keeps them
      '6300;;;-', // `-`: clears them
      '6400;;;"days, people"', // codes in another order: the same units, unchanged
      '6500;;oui;Tage, Personen', // German words, same units: unchanged
      '6600;;non;', // no on the setting: clears the units with it
      '6700;;oui;Stück', // sets the setting and the units together
      '6800;New account;yes;people', // a new account with units
    ];
    const check = await importRows(runner, chartId, lines, true);
    assert.equal(check.ok, true, JSON.stringify(check.errors));
    assert.deepEqual([check.inserted, check.updated, check.unchanged], [1, 4, 3], 'counts of the dry run');
    const load = await importRows(runner, chartId, lines, false);
    assert.equal(load.ok, true, JSON.stringify(load.errors));
    assert.deepEqual(await stored(runner, chartId), {
      6100: [true, ['people', 'days']],
      6200: [true, ['pieces']],
      6300: [true, null],
      6400: [true, ['people', 'days']],
      6500: [true, ['people', 'days']],
      6600: [null, null],
      6700: [true, ['pieces']],
      6800: [true, ['people']],
    });

    // A file without the column changes nothing of the units.
    const without = await importRows(runner, chartId, ['account_number;account_name', '6100;Renamed'], false);
    assert.equal(without.ok, true, JSON.stringify(without.errors));
    assert.deepEqual((await stored(runner, chartId))[6100], [true, ['people', 'days']], 'an absent column keeps the units');

    // An unknown unit is refused with its value; units on an account left without the setting too.
    const errorsOf = (result: any) => result.errors.map((e: any) => [e.row, e.column, e.code, e.params?.value ?? null]);
    const unknown = await importRows(runner, chartId, ['account_number;expected_units', '6100;"jours, heures"'], false);
    assert.equal(unknown.ok, false);
    assert.deepEqual(errorsOf(unknown), [[2, 'expected_units', 'CSV_ACCOUNT_EXPECTED_UNIT_INVALID', 'heures']]);
    const invalid = await importRows(runner, chartId, [
      'account_number;quantity_price_expected;expected_units',
      '6600;;pièces',
      '6200;non;people',
      '6100;;jours',
    ], false);
    assert.equal(invalid.ok, false);
    assert.deepEqual(errorsOf(invalid), [
      [2, 'expected_units', 'CSV_ACCOUNT_EXPECTED_UNITS_WITHOUT_ENTRY', null],
      [3, 'expected_units', 'CSV_ACCOUNT_EXPECTED_UNITS_WITHOUT_ENTRY', null],
    ]);
    const after = await stored(runner, chartId);
    assert.deepEqual([after[6100], after[6600], after[6200]], [[true, ['people', 'days']], [null, null], [true, ['pieces']]], 'the refused rows wrote nothing');
  });
}

async function testExport() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, chartId } = await seedTenant(runner, 'export');
    await seedAccount(runner, tenantId, chartId, 6100, true, ['people', 'days']);
    await seedAccount(runner, tenantId, chartId, 6200, true);
    await seedAccount(runner, tenantId, chartId, 6300, null);
    for (const [language, words] of [['fr', 'personnes, jours'], ['en', 'people, days'], ['de', 'Personen, Tage']] as const) {
      const exported: any = await service().exportCsv('data', { manager: runner.manager, coaId: chartId, language });
      const text = Buffer.isBuffer(exported.body) ? exported.body.toString('utf8') : String(exported.body ?? exported.content ?? exported);
      const lines = text.replace(/^﻿/, '').trim().split(/\r?\n/);
      const separator = lines[0].includes(';') ? ';' : ',';
      const header = lines[0].split(separator);
      const column = header.indexOf('expected_units');
      assert.ok(column >= 0, `${language}: the export carries the column: ${lines[0]}`);
      const cells = (line: string) => line.match(new RegExp(`("[^"]*"|[^${separator}]*)(${separator}|$)`, 'g'))!.map((cell) => cell.replace(new RegExp(`${separator}$`), '').replace(/^"|"$/g, ''));
      const byNumber = Object.fromEntries(lines.slice(1).map((line: string) => { const row = cells(line); return [row[0].replace(/^'/, ''), row[column]]; }));
      assert.deepEqual([byNumber['6100'], byNumber['6200'], byNumber['6300']], [words, '', ''], `${language}: the units in the file language, blank without`);

      // The export reads back unchanged.
      const back = await importRows(runner, chartId, lines, true, language);
      assert.equal(back.ok, true, JSON.stringify(back.errors));
      assert.equal(back.unchanged, 3, `${language}: an exported file imports as unchanged`);
    }
  });
}

async function testListFilter() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, chartId } = await seedTenant(runner, 'filter');
    await seedAccount(runner, tenantId, chartId, 6100, true, ['people', 'days']);
    await seedAccount(runner, tenantId, chartId, 6200, true, ['pieces']);
    await seedAccount(runner, tenantId, chartId, 6300, true);
    await seedAccount(runner, tenantId, chartId, 6400, null);
    const filtered = async (values: Array<string | null>) => {
      const query = { coaId: chartId, limit: 100, sort: 'account_number:ASC', filters: JSON.stringify({ expected_units: { filterType: 'set', values } }) };
      const page: any = await service().list(query, { manager: runner.manager });
      const ids = await service().listIds(query, { manager: runner.manager });
      assert.equal(ids.total, page.total, `${JSON.stringify(values)}: the selection's ids follow the list`);
      return page.items.map((row: any) => [row.account_number, row.expected_units]);
    };
    assert.deepEqual(await filtered(['days']), [[6100, ['people', 'days']]], 'one unit: the accounts that expect it');
    assert.deepEqual((await filtered(['days', 'pieces'])).map(([n]: any[]) => n), [6100, 6200], 'two units: either');
    assert.deepEqual((await filtered([null])).map(([n]: any[]) => n), [6300], 'any unit: the accounts that set the entry without units');
    assert.deepEqual((await filtered(['pieces', null])).map(([n]: any[]) => n), [6200, 6300], 'a unit and any unit');
    assert.deepEqual(await filtered([]), [], 'nothing ticked: no account');
  });
}

async function main() {
  await dataSource.initialize();
  const failures: string[] = [];
  try {
    for (const test of [testApiWrites, testImport, testExport, testListFilter]) {
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
    throw new Error(`account-expected-units.integration.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
  }
  console.log('account-expected-units.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
