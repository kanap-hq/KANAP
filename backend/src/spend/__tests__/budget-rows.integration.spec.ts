import 'dotenv/config';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { BUDGET_ROWS_HEADERS, BudgetRowsAccess, BudgetRowsCsvService } from '../budget-rows-csv.service';
import { upsertRoundInput } from '../round-inputs.util';
import {
  amountsService,
  assert,
  captureAudit,
  findVersion,
  freezeColumn,
  inRolledBackTransaction,
  Kind,
  noFreeze,
  readLines,
  readMeasure,
  readRecords,
  realFreeze,
  repeat,
  runSpecs,
  seedItem,
  seedLine,
  seedTenant,
  setBudgetColumns,
  setTenant,
} from './round-inputs.fixtures';

// The budget rows file (monthly amounts of OPEX and CAPEX lines, one row per
// line, year and measure) against the database: export, re-import without
// change, provenance rules, row errors, freezes, permissions.

const YEAR = 2031;
const ADMIN: BudgetRowsAccess = { isAdmin: true, permissions: {} };

function service(freeze: unknown = noFreeze, audit: unknown = captureAudit()) {
  return new BudgetRowsCsvService(audit as any, freeze as any);
}

type Line = Record<string, string>;

function parseCsv(content: string): Line[] {
  const [header, ...lines] = content.replace(/^\ufeff/, '').split('\n').filter((l) => l.trim() !== '');
  const columns = header.split(';');
  return lines.map((line) => Object.fromEntries(line.split(';').map((value, i) => [columns[i], value])));
}

function toFile(lines: Line[], headers: readonly string[] = BUDGET_ROWS_HEADERS) {
  const body = lines.map((line) => headers.map((h) => line[h] ?? '').join(';')).join('\n');
  return { buffer: Buffer.from(`\ufeff${headers.join(';')}\n${body}\n`, 'utf8') } as any;
}

async function importLines(
  runner: QueryRunner,
  tenantId: string,
  lines: Line[],
  opts: { dryRun?: boolean; access?: BudgetRowsAccess; freeze?: unknown; audit?: unknown } = {},
) {
  return service(opts.freeze, opts.audit).importCsv(
    { file: toFile(lines), dryRun: opts.dryRun ?? false, userId: null, access: opts.access ?? ADMIN },
    { manager: runner.manager, tenantId },
  );
}

async function exportLines(runner: QueryRunner, tenantId: string, opts: { year?: string; access?: BudgetRowsAccess } = {}) {
  const { filename, content } = await service().exportCsv(
    { scope: 'data', year: opts.year, access: opts.access ?? ADMIN },
    { manager: runner.manager, tenantId },
  );
  return { filename, lines: parseCsv(content), content };
}

const IRREGULAR = ['0', '0', '0', '100.10', '0.01', '250.55', '0', '-10.00', '999.99', '0', '0', '1.25'];
const months = (values: string[]) => Object.fromEntries(['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].map((m, i) => [m, values[i]]));
const stored = (values: string[]) => values.map((v) => Number(v).toFixed(2));

/** An OPEX line (#7) with irregular months on every measure and two records; a CAPEX line (#3). */
async function seedBook(runner: QueryRunner, tag: string) {
  const tenantId = await seedTenant(runner, tag);
  const opex = await seedLine(runner, 'opex', tenantId, YEAR, {
    planned: IRREGULAR,
    committed: repeat('50', 12),
    forecast: IRREGULAR.map((v) => String(Number(v) * 2)),
    actual: repeat('12.34', 12),
    expected_landing: repeat('0', 12),
  }, 7);
  const capex = await seedLine(runner, 'capex', tenantId, YEAR, { planned: repeat('1000', 12) }, 3);
  const record = (kind: Kind, versionId: string, measure: string, start: string, end: string, method: 'spread' | 'copied' | 'manual') => upsertRoundInput(
    { manager: runner.manager, scope: kind, version: { id: versionId, tenant_id: tenantId, budget_year: YEAR }, userId: null, audit: captureAudit() },
    measure,
    { period_start: start, period_end: end, method, spread_profile_name: '4-4-5', last_calculation: { kind: 'annual', total: '1341.90', profile: '4-4-5', active_months: [4], weights: ['1'] }, fte: null },
  );
  await record('opex', opex.versionId, 'planned', `${YEAR}-04-01`, `${YEAR}-12-31`, 'spread');
  await record('opex', opex.versionId, 'committed', `${YEAR}-01-01`, `${YEAR}-06-30`, 'copied');
  await record('opex', opex.versionId, 'actual', `${YEAR}-02-01`, `${YEAR}-11-30`, 'manual');
  return { tenantId, opex, capex };
}

/** Export, then re-import the file as it is: every row unchanged, provenance and months kept. */
async function testRoundTrip() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, opex, capex } = await seedBook(runner, 'trip');
    const before = await readRecords(runner, 'opex', opex.versionId);
    const { filename, lines, content } = await exportLines(runner, tenantId);
    assert.equal(filename, 'budget_rows.csv');
    assert.ok(content.startsWith(`\ufeff${BUDGET_ROWS_HEADERS.join(';')}\n`), 'BOM, then the header in the fixed order');
    assert.deepEqual(lines.map((l) => [l.item_type, l.item_number, l.year, l.measure]), [
      ['opex', '7', String(YEAR), 'planned'],
      ['opex', '7', String(YEAR), 'committed'],
      ['opex', '7', String(YEAR), 'forecast'],
      ['opex', '7', String(YEAR), 'actual'],
      ['opex', '7', String(YEAR), 'expected_landing'],
      ['capex', '3', String(YEAR), 'planned'],
      ['capex', '3', String(YEAR), 'committed'],
      ['capex', '3', String(YEAR), 'forecast'],
      ['capex', '3', String(YEAR), 'actual'],
      ['capex', '3', String(YEAR), 'expected_landing'],
    ]);
    const planned = lines[0];
    assert.deepEqual(
      [planned.period_start, planned.period_end, planned.method, planned.apr, planned.may, planned.aug, planned.dec],
      [`${YEAR}-04-01`, `${YEAR}-12-31`, 'spread', '100.10', '0.01', '-10', '1.25'],
    );
    assert.deepEqual([lines[3].period_start, lines[3].period_end, lines[3].method], [`${YEAR}-02-01`, `${YEAR}-11-30`, 'manual'], 'Actuals carry their period and method');
    assert.deepEqual([lines[8].period_start, lines[8].period_end, lines[8].method], [`${YEAR}-01-01`, `${YEAR}-12-31`, ''], 'CAPEX Actuals without a record: whole year');
    assert.deepEqual([lines[2].period_start, lines[2].period_end, lines[2].method], [`${YEAR}-01-01`, `${YEAR}-12-31`, ''], 'no record: whole year, no method');

    const result = await importLines(runner, tenantId, lines);
    assert.deepEqual(result, { ok: true, dryRun: false, total: 10, inserted: 0, updated: 0, unchanged: 10, errors: [] });
    const after = await readRecords(runner, 'opex', opex.versionId);
    assert.deepEqual(Object.keys(after).sort(), ['actual', 'committed', 'planned']);
    assert.equal(after.planned.updated_at.getTime(), before.planned.updated_at.getTime(), 'provenance kept');
    assert.equal(after.actual.updated_at.getTime(), before.actual.updated_at.getTime(), 'the Actuals record is kept too');
    assert.equal(after.committed.method, 'copied');
    assert.deepEqual(await readMeasure(runner, 'opex', opex.versionId, 'planned', YEAR), stored(IRREGULAR));
    assert.deepEqual(Object.keys(await readRecords(runner, 'capex', capex.versionId)), [], 'CAPEX: no record created by an unchanged import');
  });
}

/** Changed rows: months → edited by hand with the file's period; period only → method kept; Actuals and Forecast alike. */
async function testChangedRows() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, opex } = await seedBook(runner, 'change');
    const { lines } = await exportLines(runner, tenantId);
    const [planned, committed, forecast, actual] = lines;
    const changed = [
      { ...planned, jan: '5', period_start: `${YEAR}-02-01` },
      { ...committed, period_end: `${YEAR}-09-30` },
      { ...forecast, dec: '77,50' },
      { ...actual, feb: '1 000', period_start: `${YEAR}-03-01` },
    ];
    const dry = await importLines(runner, tenantId, changed, { dryRun: true });
    assert.deepEqual([dry.ok, dry.inserted, dry.updated, dry.unchanged], [true, 0, 4, 0], 'dry run counts');
    assert.deepEqual(await readMeasure(runner, 'opex', opex.versionId, 'planned', YEAR), stored(IRREGULAR), 'dry run writes nothing');

    const result = await importLines(runner, tenantId, changed);
    assert.deepEqual([result.ok, result.updated], [true, 4], JSON.stringify(result.errors));
    const records = await readRecords(runner, 'opex', opex.versionId);
    assert.deepEqual(
      [records.planned.method, records.planned.period_start, records.planned.period_end, records.planned.spread_profile_name, records.planned.last_calculation?.total],
      ['manual', `${YEAR}-02-01`, `${YEAR}-12-31`, '4-4-5', '1341.90'],
      'changed months: edited by hand, the file\'s period, profile and last calculation kept',
    );
    assert.deepEqual(
      [records.committed.method, records.committed.period_start, records.committed.period_end],
      ['copied', `${YEAR}-01-01`, `${YEAR}-09-30`],
      'period only: method kept',
    );
    assert.deepEqual([records.forecast.method, records.forecast.period_start], ['manual', `${YEAR}-01-01`], 'Forecast gets a record');
    assert.deepEqual(
      [records.actual.method, records.actual.period_start, records.actual.period_end],
      ['manual', `${YEAR}-03-01`, `${YEAR}-11-30`],
      'Actuals: edited by hand with the file\'s period',
    );
    assert.equal((await readMeasure(runner, 'opex', opex.versionId, 'planned', YEAR))[0], '5.00');
    assert.equal((await readMeasure(runner, 'opex', opex.versionId, 'forecast', YEAR))[11], '77.50');
    assert.equal((await readMeasure(runner, 'opex', opex.versionId, 'actual', YEAR))[1], '1000.00');
    assert.deepEqual(await readMeasure(runner, 'opex', opex.versionId, 'committed', YEAR), repeat('50.00', 12), 'period-only change keeps the months');
  });
}

/** A new year of a line is created (monthly grain); an all-zero row of a missing year creates nothing; aliases accepted. */
async function testNewYearsAndAliases() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'new');
    const opexItem = await seedItem(runner, 'opex', tenantId, 7);
    const capexItem = await seedItem(runner, 'capex', tenantId, 3);
    const result = await importLines(runner, tenantId, [
      { item_type: 'OPEX', item_number: 'OPX-7', year: String(YEAR), measure: 'Budget', period_start: `${YEAR}-04-01`, period_end: `${YEAR}-12-31`, ...months(['0', '0', '0', ...repeat('10', 9)]) },
      { item_type: 'opex', item_number: 'opx-7', year: String(YEAR), measure: 'follow_up', ...months(repeat('1', 12)) },
      { item_type: 'capex', item_number: 'CPX-3', year: String(YEAR + 1), measure: 'landing', ...months(repeat('0', 12)) },
    ]);
    assert.deepEqual([result.ok, result.inserted, result.updated, result.unchanged], [true, 2, 0, 1], JSON.stringify(result.errors));
    const version = await findVersion(runner, 'opex', opexItem, YEAR);
    assert.equal(version?.input_grain, 'monthly');
    assert.deepEqual(await readMeasure(runner, 'opex', version!.id, 'planned', YEAR), ['0.00', '0.00', '0.00', ...repeat('10.00', 9)]);
    assert.deepEqual(await readMeasure(runner, 'opex', version!.id, 'actual', YEAR), repeat('1.00', 12));
    const { planned } = await readRecords(runner, 'opex', version!.id);
    assert.deepEqual([planned.method, planned.period_start, planned.spread_profile_name, planned.last_calculation], ['manual', `${YEAR}-04-01`, null, null]);
    const { actual } = await readRecords(runner, 'opex', version!.id);
    assert.deepEqual([actual.method, actual.period_start, actual.period_end], ['manual', `${YEAR}-01-01`, `${YEAR}-12-31`], 'a new Actuals row gets a whole-year record');
    assert.equal(await findVersion(runner, 'capex', capexItem, YEAR + 1), undefined, 'an all-zero row creates no year');
  });
}

/** Row errors: nothing is written when any row is wrong. */
async function testRowErrors() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, opex } = await seedBook(runner, 'errors');
    const { lines } = await exportLines(runner, tenantId);
    const good = { ...lines[0], jan: '999' };
    const result = await importLines(runner, tenantId, [
      good,
      { ...lines[1] },
      { ...lines[1] },
      { ...lines[2], feb: '' },
      { ...lines[0], item_number: '99' },
      { ...lines[2], period_start: '', period_end: `${YEAR}-06-30` },
      { ...lines[2], measure: 'weekly' },
      { ...lines[2], item_number: 'CPX-7' },
      { ...lines[4], period_start: `${YEAR}-04-16`, period_end: `${YEAR}-05-14` },
      { ...lines[4], year: '31' },
      { ...lines[4], mar: 'abc' },
      // Out of the database's ranges: row errors, never a failed request.
      { ...lines[3], item_number: '99999999999' },
      { ...lines[3], item_number: 'OPX-2147483648' },
      { ...lines[3], year: '0999', period_start: '', period_end: '' },
      { ...lines[3], year: '0000' },
    ]);
    assert.equal(result.ok, false);
    assert.deepEqual(result.errors.map((e: any) => e.row), [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], JSON.stringify(result.errors));
    const messages = result.errors.map((e: any) => e.message).join(' | ');
    for (const pattern of [
      /Duplicate row: OPX-7, 2031, committed already appears on line 3/, /feb is required/, /OPX-99 does not exist/,
      /both period_start and period_end/, /measure 'weekly' is unknown/, /'CPX-7' does not match item_type opex/,
      /No month of the period counts/, /year '31' must have four digits, from 1000 to 9999/, /mar must be a number/,
      /item_number '99999999999' is too large/, /item_number 'OPX-2147483648' is too large/,
      /year '0999' must have four digits, from 1000 to 9999/, /year '0000' must have four digits/,
    ]) {
      assert.match(messages, pattern);
    }
    assert.deepEqual([result.inserted, result.updated, result.unchanged], [0, 0, 0]);
    assert.deepEqual(await readMeasure(runner, 'opex', opex.versionId, 'planned', YEAR), stored(IRREGULAR), 'nothing written');
    const dryOutOfRange = await importLines(runner, tenantId, [{ ...lines[3], year: '0999', period_start: '', period_end: '', jan: '1' }], { dryRun: true });
    assert.equal(dryOutOfRange.ok, false, 'a dry run refuses an out-of-range year too');
    await assert.rejects(
      () => service().exportCsv({ scope: 'data', year: '0999', access: ADMIN }, { manager: runner.manager, tenantId }),
      /year must have four digits, from 1000 to 9999/,
    );

    const header = await service().importCsv(
      { file: toFile([good], [...BUDGET_ROWS_HEADERS.filter((h) => h !== 'dec'), 'extra']), dryRun: false, userId: null, access: ADMIN },
      { manager: runner.manager, tenantId },
    );
    assert.deepEqual(header.errors, [{ row: 1, message: 'Header mismatch. Missing: dec, Extra: extra' }]);
    const withoutMethod = await service().importCsv(
      { file: toFile([lines[0]], BUDGET_ROWS_HEADERS.filter((h) => h !== 'method')), dryRun: true, userId: null, access: ADMIN },
      { manager: runner.manager, tenantId },
    );
    assert.deepEqual([withoutMethod.ok, withoutMethod.unchanged], [true, 1], 'the method column is optional');
  });
}

/** Row errors and duplicates name the file's own line: blank lines count. */
async function testErrorLinesAfterBlankLines() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId } = await seedBook(runner, 'blank');
    const { lines } = await exportLines(runner, tenantId);
    const cells = (line: Line) => BUDGET_ROWS_HEADERS.map((h) => line[h] ?? '').join(';');
    const content = [
      BUDGET_ROWS_HEADERS.join(';'),                // 1
      cells(lines[0]),                              // 2
      '',                                           // 3
      BUDGET_ROWS_HEADERS.map(() => '').join(';'),  // 4
      cells({ ...lines[1], mar: 'abc' }),           // 5
      '',                                           // 6
      cells(lines[0]),                              // 7
    ].join('\n');
    const result = await service().importCsv(
      { file: { buffer: Buffer.from(`﻿${content}\n`, 'utf8') } as any, dryRun: true, userId: null, access: ADMIN },
      { manager: runner.manager, tenantId },
    );
    assert.equal(result.ok, false);
    assert.deepEqual(result.errors.map((e: any) => e.row), [5, 7], JSON.stringify(result.errors));
    assert.match(result.errors[1].message, /already appears on line 2/);
  });
}

/**
 * A column computed from quantity × price lines: exported with its months and
 * `computed`, re-imported unchanged; months changed by a file make it manual,
 * its lines and FTE stay (the method cell is never read). The file has no
 * costing columns: a file that has them is refused by its header.
 */
async function testComputedRows() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'lines');
    const { versionId } = await seedLine(runner, 'opex', tenantId, YEAR, {}, 5);
    await amountsService('opex').bulkUpsert(versionId, {
      kind: 'lines',
      year: YEAR,
      measure: 'forecast',
      lines: [{
        label: 'Support', quantity_unit: 'people', quantity: '2', unit_price: '1000', price_basis: 'per_month',
        period_start: `${YEAR}-01-01`, period_end: `${YEAR}-06-30`,
      }],
    }, null, { manager: runner.manager });

    const { lines, content } = await exportLines(runner, tenantId);
    assert.equal(content.replace(/^\ufeff/, '').split('\n')[0], BUDGET_ROWS_HEADERS.join(';'), 'the months file, no costing columns');
    const forecast = lines.find((l) => l.measure === 'forecast')!;
    assert.deepEqual(
      [forecast.method, forecast.period_start, forecast.period_end, forecast.jan, forecast.jun, forecast.jul],
      ['computed', `${YEAR}-01-01`, `${YEAR}-06-30`, '2000', '2000', '0'],
    );
    const same = await importLines(runner, tenantId, lines);
    assert.deepEqual([same.ok, same.unchanged, same.updated], [true, 5, 0], 'an exported computed row re-imports unchanged');
    assert.equal((await readRecords(runner, 'opex', versionId)).forecast.method, 'computed');

    // Period only: the period no longer matches the lines, so the column reads as edited by hand too.
    const audit = captureAudit();
    const periodOnly = await importLines(runner, tenantId, [{ ...forecast, period_end: `${YEAR}-09-30` }], { audit });
    assert.deepEqual([periodOnly.ok, periodOnly.updated], [true, 1], JSON.stringify(periodOnly.errors));
    assert.deepEqual(audit.entries.map((e) => e.table), ['spend_round_inputs'], 'no amounts write');
    const moved = (await readRecords(runner, 'opex', versionId)).forecast;
    assert.deepEqual(
      [moved.method, moved.period_end, moved.fte, moved.last_calculation.kind],
      ['manual', `${YEAR}-09-30`, '1.00', 'computed'],
      'a computed column whose period changes becomes manual and keeps its lines as reference',
    );
    assert.deepEqual((await readLines(runner, 'opex', versionId, 'forecast')).map((l) => l.label), ['Support'], 'the lines stay');
    assert.equal((await readMeasure(runner, 'opex', versionId, 'forecast', YEAR))[0], '2000.00', 'months untouched');

    const changed = await importLines(runner, tenantId, [{ ...forecast, jan: '2500' }]);
    assert.deepEqual([changed.ok, changed.updated], [true, 1], JSON.stringify(changed.errors));
    const record = (await readRecords(runner, 'opex', versionId)).forecast;
    assert.deepEqual([record.method, record.fte, record.last_calculation.kind], ['manual', '1.00', 'computed'], 'like a hand edit');
    assert.equal((await readMeasure(runner, 'opex', versionId, 'forecast', YEAR))[0], '2500.00');
    assert.deepEqual((await readLines(runner, 'opex', versionId, 'forecast')).map((l) => l.label), ['Support'], 'the lines stay');

    // `computed` in the method cell of a column without lines: read like any row.
    const plain = lines.find((l) => l.measure === 'actual')!;
    const noLines = await importLines(runner, tenantId, [{ ...plain, jan: '10', method: 'computed' }]);
    assert.equal(noLines.ok, true, JSON.stringify(noLines.errors));
    const actual = (await readRecords(runner, 'opex', versionId)).actual;
    assert.deepEqual([actual.method, actual.fte], ['manual', null]);

    const withCosting = await service().importCsv(
      { file: toFile([forecast], [...BUDGET_ROWS_HEADERS, 'quantity', 'unit_price']), dryRun: true, userId: null, access: ADMIN },
      { manager: runner.manager, tenantId },
    );
    assert.deepEqual(withCosting.errors, [{ row: 1, message: 'Header mismatch. Missing: -, Extra: quantity, unit_price' }]);
  });
}

/** Frozen year: a changed row is refused, an identical row is accepted (skipped before the freeze check). */
async function testFreeze() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, opex } = await seedBook(runner, 'freeze');
    await freezeColumn(runner, 'opex', tenantId, YEAR, 'budget');
    const { lines } = await exportLines(runner, tenantId);
    const identical = await importLines(runner, tenantId, lines, { freeze: realFreeze() });
    assert.deepEqual([identical.ok, identical.unchanged], [true, 10]);
    const changed = await importLines(runner, tenantId, [{ ...lines[0], jan: '1' }, { ...lines[1], jan: '1' }], { freeze: realFreeze() });
    assert.equal(changed.ok, false);
    assert.deepEqual(changed.errors, [{ row: 2, message: `Import not allowed: OPEX Budget for ${YEAR} is frozen` }]);
    assert.deepEqual(await readMeasure(runner, 'opex', opex.versionId, 'committed', YEAR), repeat('50.00', 12), 'the unfrozen row is not written either');
  });
}

/** A hidden column is still exported and imported; frozen, it refuses changes under the tenant's name. */
async function testHiddenColumns() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, opex } = await seedBook(runner, 'hidden');
    await setBudgetColumns(runner, tenantId, { labels: { forecast: 'A2' }, enabled: { forecast: false } });
    const { lines } = await exportLines(runner, tenantId);
    const forecast = lines.find((l) => l.item_type === 'opex' && l.measure === 'forecast')!;
    assert.ok(forecast, 'the hidden column is exported');
    const accepted = await importLines(runner, tenantId, [{ ...forecast, jan: '1' }], { freeze: realFreeze() });
    assert.equal(accepted.ok, true, 'a hidden column accepts imports');
    assert.equal((await readMeasure(runner, 'opex', opex.versionId, 'forecast', YEAR))[0], '1.00');

    await freezeColumn(runner, 'opex', tenantId, YEAR, 'forecast');
    const refused = await importLines(runner, tenantId, [{ ...forecast, jan: '2' }], { freeze: realFreeze() });
    assert.equal(refused.ok, false);
    assert.deepEqual(refused.errors, [{ row: 2, message: `Import not allowed: OPEX A2 for ${YEAR} is frozen` }]);
    assert.equal((await readMeasure(runner, 'opex', opex.versionId, 'forecast', YEAR))[0], '1.00', 'a hidden frozen column is not written');
  });
}

/** Permissions per item type, partial exports. */
async function testPermissionsAndPartialExports() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, capex } = await seedBook(runner, 'perm');
    const opexReader: BudgetRowsAccess = { isAdmin: false, permissions: { opex: 'reader' } };
    const partial = await exportLines(runner, tenantId, { access: opexReader });
    assert.equal(partial.filename, 'budget_rows_partial.csv');
    assert.deepEqual(Array.from(new Set(partial.lines.map((l) => l.item_type))), ['opex']);
    const byYear = await exportLines(runner, tenantId, { year: String(YEAR + 1) });
    assert.deepEqual([byYear.filename, byYear.lines.length], [`budget_rows_${YEAR + 1}_partial.csv`, 0]);
    const template = await service().exportCsv({ scope: 'template', access: ADMIN }, { manager: runner.manager, tenantId });
    assert.equal(template.content, `\ufeff${BUDGET_ROWS_HEADERS.join(';')}\n`);

    const { lines } = await exportLines(runner, tenantId);
    const opexAdmin: BudgetRowsAccess = { isAdmin: false, permissions: { opex: 'admin', capex: 'member' } };
    const result = await importLines(runner, tenantId, [{ ...lines[0], jan: '1' }, { ...lines[5], jan: '1' }], { access: opexAdmin });
    assert.equal(result.ok, false);
    assert.deepEqual(result.errors, [{ row: 3, message: 'CAPEX rows need CAPEX administration rights.' }]);
    assert.deepEqual(await readMeasure(runner, 'capex', capex.versionId, 'planned', YEAR), repeat('1000.00', 12));
  });
}

/**
 * Rights apply to rows that would write: an OPEX admin who can only read CAPEX
 * re-imports their own export with one OPEX change; a changed CAPEX row is
 * refused; rows of a type the user cannot read at all are refused unseen.
 */
async function testRightsOnlyForRowsThatWrite() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, opex, capex } = await seedBook(runner, 'rights');
    const { lines } = await exportLines(runner, tenantId);
    const opexAdminCapexReader: BudgetRowsAccess = { isAdmin: false, permissions: { opex: 'admin', capex: 'reader' } };
    const file = lines.map((line, i) => (i === 0 ? { ...line, jan: '42' } : line));
    const result = await importLines(runner, tenantId, file, { access: opexAdminCapexReader });
    assert.deepEqual([result.ok, result.updated, result.unchanged], [true, 1, 9], JSON.stringify(result.errors));
    assert.equal((await readMeasure(runner, 'opex', opex.versionId, 'planned', YEAR))[0], '42.00');

    const capexChange = await importLines(runner, tenantId, lines.map((line, i) => (i === 5 ? { ...line, jan: '1' } : line)), { access: opexAdminCapexReader });
    assert.equal(capexChange.ok, false);
    assert.deepEqual(capexChange.errors, [{ row: 7, message: 'CAPEX rows need CAPEX administration rights.' }]);
    assert.deepEqual(await readMeasure(runner, 'capex', capex.versionId, 'planned', YEAR), repeat('1000.00', 12));

    const opexOnly: BudgetRowsAccess = { isAdmin: false, permissions: { opex: 'admin' } };
    const unreadable = await importLines(runner, tenantId, lines, { access: opexOnly, dryRun: true });
    assert.equal(unreadable.ok, false);
    assert.deepEqual(unreadable.errors.map((e: any) => e.row), [7, 8, 9, 10, 11], 'identical CAPEX rows are refused without CAPEX read access');
  });
}

/** A group changing only periods locks the months first and writes its records in column order. */
async function testPeriodOnlyGroup() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, opex } = await seedBook(runner, 'period');
    const { lines } = await exportLines(runner, tenantId);
    const audit = captureAudit();
    // Rows reordered by hand: Revision before Budget, periods only.
    const result = await importLines(runner, tenantId, [
      { ...lines[1], period_end: `${YEAR}-10-31` },
      { ...lines[0], period_start: `${YEAR}-05-01` },
    ], { audit });
    assert.deepEqual([result.ok, result.updated], [true, 2], JSON.stringify(result.errors));
    assert.deepEqual(
      audit.entries.map((e) => [e.table, e.after?.measure]),
      [['spend_round_inputs', 'planned'], ['spend_round_inputs', 'committed']],
      'no amounts write, records in column order',
    );
    const records = await readRecords(runner, 'opex', opex.versionId);
    assert.deepEqual([records.planned.method, records.planned.period_start], ['spread', `${YEAR}-05-01`]);
    assert.deepEqual([records.committed.method, records.committed.period_end], ['copied', `${YEAR}-10-31`]);
    assert.deepEqual(await readMeasure(runner, 'opex', opex.versionId, 'planned', YEAR), stored(IRREGULAR), 'months untouched');
  });
}

async function waitUntilBlocked(pid: number) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const [row] = await dataSource.query(`SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1`, [pid]);
    if (row?.wait_event_type === 'Lock') return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('the period-only import never waited for the spread');
}

/**
 * A period-only row waits for a spread of the same line that holds the
 * months (T1 spreads Budget, uncommitted; T2 imports a Revision period):
 * records are never locked before the months, so the two cannot deadlock.
 */
async function testPeriodOnlyWaitsForTheMonths() {
  const seed = dataSource.createQueryRunner();
  await seed.connect();
  await seed.startTransaction();
  const tenantId = await seedTenant(seed, 'lock');
  const { versionId } = await seedLine(seed, 'opex', tenantId, YEAR, { planned: repeat('10', 12), committed: repeat('5', 12) }, 7);
  await seed.commitTransaction();
  await seed.release();

  const open = async () => {
    const runner = dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    await setTenant(runner, tenantId);
    return runner;
  };
  const t1 = await open();
  const t2 = await open();
  try {
    await amountsService('opex').bulkUpsert(versionId, { kind: 'annual', year: YEAR, totals: { planned: 1200 } }, null, { manager: t1.manager });
    const [{ pid }] = await t2.query(`SELECT pg_backend_pid() AS pid`);
    let t2Done = false;
    const t2Import = importLines(t2, tenantId, [{
      item_type: 'opex', item_number: '7', year: String(YEAR), measure: 'committed',
      period_start: `${YEAR}-01-01`, period_end: `${YEAR}-06-30`, ...months(repeat('5', 12)),
    }]).finally(() => { t2Done = true; });
    await waitUntilBlocked(pid);
    assert.equal(t2Done, false, 'the import waits for the months');
    await t1.commitTransaction();
    const result = await t2Import;
    assert.deepEqual([result.ok, result.updated], [true, 1], JSON.stringify(result.errors));
    await t2.commitTransaction();
    const records = await dataSource.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
      return manager.query(`SELECT measure, method, to_char(period_end, 'YYYY-MM-DD') AS period_end FROM spend_round_inputs WHERE version_id = $1 ORDER BY measure`, [versionId]);
    });
    assert.deepEqual(records, [
      { measure: 'committed', method: 'manual', period_end: `${YEAR}-06-30` },
      { measure: 'planned', method: 'spread', period_end: `${YEAR}-12-31` },
    ]);
  } finally {
    for (const runner of [t1, t2]) {
      if (runner.isTransactionActive) await runner.rollbackTransaction().catch(() => undefined);
      await runner.release();
    }
    await dataSource.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
      for (const table of ['spend_round_inputs', 'spend_amounts', 'spend_versions', 'spend_items']) {
        await manager.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
      }
    });
    await dataSource.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  }
}

void runSpecs('budget-rows.integration.spec', [
  ['testRoundTrip', testRoundTrip],
  ['testChangedRows', testChangedRows],
  ['testNewYearsAndAliases', testNewYearsAndAliases],
  ['testRowErrors', testRowErrors],
  ['testErrorLinesAfterBlankLines', testErrorLinesAfterBlankLines],
  ['testComputedRows', testComputedRows],
  ['testFreeze', testFreeze],
  ['testHiddenColumns', testHiddenColumns],
  ['testPermissionsAndPartialExports', testPermissionsAndPartialExports],
  ['testRightsOnlyForRowsThatWrite', testRightsOnlyForRowsThatWrite],
  ['testPeriodOnlyGroup', testPeriodOnlyGroup],
  ['testPeriodOnlyWaitsForTheMonths', testPeriodOnlyWaitsForTheMonths],
]);

// `dataSource` is imported so the CI runner schedules this spec on the database lane.
void dataSource;
