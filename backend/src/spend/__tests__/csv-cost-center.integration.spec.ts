import 'dotenv/config';
import { QueryRunner } from 'typeorm';
import { assert, inRolledBackTransaction, Kind, runSpecs, seedTenant, setTenant } from './round-inputs.fixtures';
import { csvService, disableCostCenter, ITEM_TABLE, seedCompany, seedCostCenter } from './cost-center.fixtures';

// The optional cost_center_code and run_build columns of the OPEX and CAPEX
// item CSVs:
// - a code names a cost center of the tenant (case-insensitive); an unknown
//   code, a group, or a disabled cost center that is not the line's current
//   one is a row error, found in the dry run;
// - run_build is run, build or blank (case-insensitive), anything else a row error;
// - a blank company takes the cost center's (OPEX: the account then resolves
//   in that company's chart; CAPEX: a new line);
// - a file without the two columns imports and leaves the stored values; a
//   present blank cell clears them;
// - export then import of the same file changes nothing.
// @database-spec: runSpecs opens the data-source, so run-ci-tests.js runs this file in its serial database lane.

const KINDS: Kind[] = ['opex', 'capex'];
const COMPANY = 'Csv cost center company';
const OTHER = 'Csv cost center other company';

function csvFile(headers: string[], rows: Array<Record<string, string>>) {
  const lines = rows.map((values) => headers.map((h) => values[h] ?? '').join(';'));
  return { buffer: Buffer.from(`${headers.join(';')}\n${lines.join('\n')}\n`, 'utf8') } as any;
}

function row(kind: Kind, name: string, extra: Record<string, string> = {}): Record<string, string> {
  const base: Record<string, string> = kind === 'opex'
    ? { product_name: name, company_name: COMPANY, account_number: '6000', currency: 'EUR', status: 'enabled' }
    : { description: name, company_name: COMPANY, ppe_type: 'hardware', investment_type: 'replacement', priority: 'medium', currency: 'EUR', status: 'enabled' };
  return { ...base, ...extra };
}

type Setup = { tenantId: string; companyId: string; otherCompanyId: string; otherAccountId: string; cc1: string; cc2: string };

async function setup(runner: QueryRunner, kind: Kind): Promise<Setup> {
  const tenantId = await seedTenant(runner, `csv-cc-${kind}`);
  await setTenant(runner, tenantId);
  const company = await seedCompany(runner, tenantId, COMPANY);
  const other = await seedCompany(runner, tenantId, OTHER);
  const group = await seedCostCenter(runner, tenantId, { code: 'GRP', name: 'Group', kind: 'group' });
  const cc1 = await seedCostCenter(runner, tenantId, { code: 'CC-1', name: 'First', parentId: group, companyId: company.companyId });
  const cc2 = await seedCostCenter(runner, tenantId, { code: 'CC-2', name: 'Second', companyId: other.companyId });
  await seedCostCenter(runner, tenantId, { code: 'OLD', name: 'Retired', companyId: company.companyId, disabled: true });
  return { tenantId, companyId: company.companyId, otherCompanyId: other.companyId, otherAccountId: other.accountId, cc1, cc2 };
}

async function lines(runner: QueryRunner, kind: Kind, tenantId: string) {
  const name = kind === 'opex' ? 'product_name' : 'description';
  const rows: any[] = await runner.query(
    `SELECT ${name} AS name, cost_center_id, run_build::text AS run_build, paying_company_id, account_id FROM ${ITEM_TABLE[kind]} WHERE tenant_id = $1`,
    [tenantId],
  );
  return new Map(rows.map((r) => [r.name, r]));
}

async function testCodeResolutionAndErrors(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const s = await setup(runner, kind);
    const svc = csvService(kind);
    const opts = { manager: runner.manager };
    const headers: string[] = svc.csvHeaders();
    assert.ok(headers.includes('cost_center_code') && headers.includes('run_build'), `${kind}: the template carries both columns`);

    const bad = csvFile(headers, [
      row(kind, 'Coded', { cost_center_code: 'cc-1', run_build: 'Run' }),
      row(kind, 'On a group', { cost_center_code: 'GRP' }),
      row(kind, 'Unknown code', { cost_center_code: 'NOPE' }),
      row(kind, 'Bad run or build', { run_build: 'maintain' }),
    ]);
    const dry = await svc.importCsv({ file: bad, dryRun: true, userId: null }, opts);
    assert.equal(dry.ok, false);
    assert.deepEqual(dry.errors.map((e: any) => `${e.row}: ${e.message}`), [
      '3: GRP is a group. Choose a cost center.',
      '4: Cost center NOPE was not found.',
      '5: Run or build must be run, build or blank.',
    ], `${kind}: row errors of the codes and run_build`);
    // The disabled check needs the line (its current cost center stays valid): reported by the dry run too.
    const disabled = await svc.importCsv({ file: csvFile(headers, [row(kind, 'On a disabled node', { cost_center_code: 'old' })]), dryRun: true, userId: null }, opts);
    assert.deepEqual(disabled.errors.map((e: any) => `${e.row}: ${e.message}`), ['2: Cost center OLD is disabled.'], `${kind}: a disabled node is refused as new`);
    const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM ${ITEM_TABLE[kind]} WHERE tenant_id = $1`, [s.tenantId]);
    assert.equal(n, 0, `${kind}: nothing written`);

    // A blank company takes the cost center's; for OPEX the account resolves in its chart.
    const good = csvFile(headers, [
      row(kind, 'Coded', { cost_center_code: 'cc-1', run_build: 'Run' }),
      row(kind, 'Filled', { company_name: '', cost_center_code: 'CC-2', run_build: 'build' }),
    ]);
    const loaded = await svc.importCsv({ file: good, dryRun: false, userId: null }, opts);
    assert.deepEqual(loaded.errors, [], `${kind}: the clean file loads`);
    const stored = await lines(runner, kind, s.tenantId);
    assert.equal(stored.get('Coded').cost_center_id, s.cc1);
    assert.equal(stored.get('Coded').run_build, 'run');
    assert.equal(stored.get('Filled').cost_center_id, s.cc2);
    assert.equal(stored.get('Filled').run_build, 'build');
    assert.equal(stored.get('Filled').paying_company_id, s.otherCompanyId, `${kind}: the company comes from the cost center`);
    if (kind === 'opex') assert.equal(stored.get('Filled').account_id, s.otherAccountId, 'opex: the account of the cost center company chart');

    // CC-1 disabled while in use: still accepted on its line, refused on a new one.
    await disableCostCenter(runner, s.cc1);
    const again = await svc.importCsv({
      file: csvFile(headers, [row(kind, 'Coded', { cost_center_code: 'CC-1', run_build: 'run' }), row(kind, 'New on CC-1', { cost_center_code: 'CC-1' })]),
      dryRun: true,
      userId: null,
    }, opts);
    assert.deepEqual(again.errors.map((e: any) => `${e.row}: ${e.message}`), ['3: Cost center CC-1 is disabled.'], `${kind}: disabled current accepted, new refused`);
  });
}

async function testOptionalColumns(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const s = await setup(runner, kind);
    const svc = csvService(kind);
    const opts = { manager: runner.manager };
    const headers: string[] = svc.csvHeaders();
    const first = await svc.importCsv({ file: csvFile(headers, [row(kind, 'Kept', { cost_center_code: 'CC-1', run_build: 'build' })]), dryRun: false, userId: null }, opts);
    assert.deepEqual(first.errors, []);

    // An older file: without the two columns, the stored values stay.
    const oldHeaders = headers.filter((h) => h !== 'cost_center_code' && h !== 'run_build');
    const older = await svc.importCsv({ file: csvFile(oldHeaders, [row(kind, 'Kept', { notes: 'from an older file' })]), dryRun: false, userId: null }, opts);
    assert.deepEqual(older.errors, [], `${kind}: a file without the columns imports`);
    assert.equal(older.updated, 1);
    let stored = (await lines(runner, kind, s.tenantId)).get('Kept');
    assert.equal(stored.cost_center_id, s.cc1, `${kind}: an absent column leaves the cost center`);
    assert.equal(stored.run_build, 'build', `${kind}: an absent column leaves run or build`);

    // Present and blank: cleared.
    const cleared = await svc.importCsv({ file: csvFile(headers, [row(kind, 'Kept')]), dryRun: false, userId: null }, opts);
    assert.deepEqual(cleared.errors, []);
    stored = (await lines(runner, kind, s.tenantId)).get('Kept');
    assert.equal(stored.cost_center_id, null, `${kind}: a blank cell clears the cost center`);
    assert.equal(stored.run_build, null, `${kind}: a blank cell clears run or build`);
  });
}

async function testExportImportRoundTrip(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const s = await setup(runner, kind);
    const svc = csvService(kind);
    const opts = { manager: runner.manager };
    const headers: string[] = svc.csvHeaders();
    await svc.importCsv({
      file: csvFile(headers, [row(kind, 'Alpha', { cost_center_code: 'CC-1', run_build: 'run' }), row(kind, 'Bravo', { run_build: 'build' })]),
      dryRun: false,
      userId: null,
    }, opts);
    await disableCostCenter(runner, s.cc1);
    const before = await lines(runner, kind, s.tenantId);

    const exported = await svc.exportCsv('data', opts);
    const [header, ...dataLines] = exported.content.replace(/^﻿/, '').trim().split('\n');
    const columns = header.split(';');
    const alpha = Object.fromEntries(dataLines.find((l: string) => l.includes('Alpha'))!.split(';').map((v: string, i: number) => [columns[i], v]));
    assert.equal(alpha.cost_center_code, 'CC-1', `${kind}: the export writes the code`);
    assert.equal(alpha.run_build, 'run');

    const reimported = await svc.importCsv({ file: { buffer: Buffer.from(exported.content, 'utf8') }, dryRun: false, userId: null }, opts);
    assert.deepEqual(reimported.errors, [], `${kind}: the export imports back, its disabled current cost center included`);
    assert.equal(reimported.inserted, 0);
    assert.deepEqual(await lines(runner, kind, s.tenantId), before, `${kind}: export then import changes nothing`);
  });
}

/** One rule for both types: a blank company keeps an existing line's company; only a new line takes the cost center's. */
async function testBlankCompanyOnExistingLine(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const s = await setup(runner, kind);
    const svc = csvService(kind);
    const opts = { manager: runner.manager };
    const headers: string[] = svc.csvHeaders();
    await svc.importCsv({ file: csvFile(headers, [row(kind, 'Existing')]), dryRun: false, userId: null }, opts);
    const before = (await lines(runner, kind, s.tenantId)).get('Existing');

    const result = await svc.importCsv({
      file: csvFile(headers, [
        row(kind, 'Existing', { company_name: '', cost_center_code: 'CC-2' }),
        row(kind, 'Brand new', { company_name: '', cost_center_code: 'CC-2' }),
      ]),
      dryRun: false,
      userId: null,
    }, opts);
    assert.deepEqual(result.errors, [], `${kind}: the file loads`);
    const after = await lines(runner, kind, s.tenantId);
    assert.equal(after.get('Existing').paying_company_id, s.companyId, `${kind}: a blank company keeps the stored one`);
    assert.equal(after.get('Existing').account_id, before.account_id, `${kind}: the account stays in the stored company's chart`);
    assert.equal(after.get('Existing').cost_center_id, s.cc2);
    assert.equal(after.get('Brand new').paying_company_id, s.otherCompanyId, `${kind}: a new line takes its cost center's company`);

    const missing = await svc.importCsv({ file: csvFile(headers, [row(kind, 'No company anywhere', { company_name: '' })]), dryRun: true, userId: null }, opts);
    assert.deepEqual(missing.errors.map((e: any) => `${e.row}: ${e.message}`), ['2: Company is required unless the line has a cost center.']);
  });
}

/** CAPEX has no account column: a company change onto another chart is refused in the dry run, with its row. */
async function testCapexCompanyChangeAcrossCharts() {
  await inRolledBackTransaction(async (runner) => {
    const s = await setup(runner, 'capex');
    const svc = csvService('capex');
    const opts = { manager: runner.manager };
    const headers: string[] = svc.csvHeaders();
    await svc.importCsv({ file: csvFile(headers, [row('capex', 'Charted')]), dryRun: false, userId: null }, opts);
    const [{ account_id: accountId }] = await runner.query(`SELECT a.id AS account_id FROM accounts a JOIN companies c ON c.coa_id = a.coa_id WHERE c.id = $1`, [s.companyId]);
    await runner.query(`UPDATE capex_items SET account_id = $2 WHERE tenant_id = $1 AND description = 'Charted'`, [s.tenantId, accountId]);

    const moved = csvFile(headers, [row('capex', 'Charted', { company_name: OTHER })]);
    for (const dryRun of [true, false]) {
      const result = await svc.importCsv({ file: moved, dryRun, userId: null }, opts);
      assert.deepEqual(
        result.errors.map((e: any) => `${e.row}: ${e.message}`),
        [`2: Account 6000 is not in ${OTHER}'s chart of accounts. Change the line's account first.`],
        `capex (dry run ${dryRun}): the row names the account and the company`,
      );
    }
    assert.equal((await lines(runner, 'capex', s.tenantId)).get('Charted').paying_company_id, s.companyId, 'capex: nothing written');

    // A line already on another chart's account re-imports unchanged (the chart check needs a change).
    await runner.query(`UPDATE capex_items SET paying_company_id = $2 WHERE tenant_id = $1 AND description = 'Charted'`, [s.tenantId, s.otherCompanyId]);
    const unchanged = await svc.importCsv({ file: moved, dryRun: false, userId: null }, opts);
    assert.deepEqual(unchanged.errors, [], 'capex: an unchanged mismatched line imports');
  });
}

void runSpecs('csv-cost-center.integration.spec', [
  ...KINDS.flatMap((kind): Array<[string, () => Promise<void>]> => [
  [`code resolution and row errors (${kind})`, () => testCodeResolutionAndErrors(kind)],
  [`blank company on an existing line (${kind})`, () => testBlankCompanyOnExistingLine(kind)],
  [`optional columns (${kind})`, () => testOptionalColumns(kind)],
  [`export then import (${kind})`, () => testExportImportRoundTrip(kind)],
  ]),
  ['CAPEX company change across charts', testCapexCompanyChangeAcrossCharts],
]).catch((err) => {
  console.error(err);
  process.exit(1);
});
