import 'dotenv/config';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import {
  BUDGET_ROWS_BASE_HEADERS,
  BUDGET_ROWS_COSTING_HEADERS,
  BUDGET_ROWS_HEADERS,
  BudgetRowsAccess,
  BudgetRowsCsvService,
} from '../budget-rows-csv.service';
import { computeCosting, parseCostingRecipe } from '../costing.util';
import { centsToDecimal, upsertRoundInput } from '../round-inputs.util';
import {
  amountsService,
  assert,
  captureAudit,
  findVersion,
  freezeColumn,
  inRolledBackTransaction,
  Kind,
  Measure,
  noFreeze,
  readMeasure,
  realFreeze,
  repeat,
  runSpecs,
  seedItem,
  seedLine,
  seedTenant,
  setTenant,
} from './round-inputs.fixtures';

// The budget rows file with its costing columns (pricing basis, quantity, unit
// price, price index, calendar code, counts as FTE): the three month cases,
// recipe cells, calendar codes, exported computed rows, computed rows equal to
// what the budget tab computes, dry run = load.

const YEAR = 2026;
const ADMIN: BudgetRowsAccess = { isAdmin: true, permissions: {} };
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** France 218, 2026 (the anonymised workbook's calendar). */
const FR218 = ['18', '18', '20', '20', '15', '20', '15', '16', '20', '19', '18', '19'];
/** 229 days a year spread evenly: 6-decimal days. */
const FR229 = repeat('19.083333', 12);

type Line = Record<string, string>;

function service(freeze: unknown = noFreeze, audit: unknown = captureAudit()) {
  return new BudgetRowsCsvService(audit as any, freeze as any);
}

function parseCsv(content: string): Line[] {
  const [header, ...lines] = content.replace(/^﻿/, '').split('\n').filter((l) => l.trim() !== '');
  const columns = header.split(';');
  return lines.map((line) => Object.fromEntries(line.split(';').map((value, i) => [columns[i], value])));
}

function toFile(lines: Line[], headers: readonly string[] = BUDGET_ROWS_HEADERS) {
  const body = lines.map((line) => headers.map((h) => line[h] ?? '').join(';')).join('\n');
  return { buffer: Buffer.from(`﻿${headers.join(';')}\n${body}\n`, 'utf8') } as any;
}

async function importLines(
  runner: QueryRunner,
  tenantId: string,
  lines: Line[],
  opts: { dryRun?: boolean; access?: BudgetRowsAccess; freeze?: unknown; headers?: readonly string[] } = {},
) {
  return service(opts.freeze).importCsv(
    { file: toFile(lines, opts.headers), dryRun: opts.dryRun ?? false, userId: null, access: opts.access ?? ADMIN },
    { manager: runner.manager, tenantId },
  );
}

async function exportLines(runner: QueryRunner, tenantId: string) {
  const { content } = await service().exportCsv({ scope: 'data', access: ADMIN }, { manager: runner.manager, tenantId });
  return parseCsv(content);
}

const months = (values: string[]) => Object.fromEntries(MONTHS.map((m, i) => [m, values[i]]));

/** A row of line `itemNumber` without months: they are computed from the recipe. */
function costedRow(itemNumber: number, measure: string, recipe: Line, extra: Line = {}): Line {
  return { item_type: 'opex', item_number: String(itemNumber), year: String(YEAR), measure, ...recipe, ...extra };
}

async function seedCalendar(
  runner: QueryRunner,
  tenantId: string,
  code: string,
  name: string,
  days: Record<string, string[]>,
  disabled = false,
): Promise<string> {
  const [row] = await runner.query(
    `INSERT INTO working_day_profiles (tenant_id, code, name, days_by_year, status, disabled_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6) RETURNING id`,
    [tenantId, code, name, JSON.stringify(days), disabled ? 'disabled' : 'enabled', disabled ? new Date(Date.now() - 86_400_000) : null],
  );
  return row.id;
}

async function disableCalendar(runner: QueryRunner, tenantId: string, id: string) {
  await runner.query(
    `UPDATE working_day_profiles SET status = 'disabled', disabled_at = now() - interval '1 day' WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id],
  );
}

type RoundRow = {
  method: string;
  period_start: string;
  period_end: string;
  spread_profile_name: string | null;
  last_calculation: any;
  pricing_basis: string | null;
  quantity: string | null;
  unit_price: string | null;
  price_index_pct: string | null;
  working_day_profile_id: string | null;
  counts_as_fte: boolean;
  updated_at: Date;
};

async function readRound(runner: QueryRunner, kind: Kind, versionId: string, measure: Measure): Promise<RoundRow | undefined> {
  const table = kind === 'opex' ? 'spend_round_inputs' : 'capex_round_inputs';
  const rows: RoundRow[] = await runner.query(
    `SELECT method, to_char(period_start, 'YYYY-MM-DD') AS period_start, to_char(period_end, 'YYYY-MM-DD') AS period_end,
            spread_profile_name, last_calculation, pricing_basis::text AS pricing_basis,
            quantity::float8::text AS quantity, unit_price::float8::text AS unit_price, price_index_pct::float8::text AS price_index_pct,
            working_day_profile_id, counts_as_fte, updated_at
     FROM ${table} WHERE version_id = $1 AND measure = $2`,
    [versionId, measure],
  );
  return rows[0];
}

/** The SFR row: France 218, February to October 2026, 1 × 400 a day, counts as FTE. */
function sfrRecipe(calendarId: string) {
  return {
    period_start: `${YEAR}-02-01`, period_end: `${YEAR}-10-30`, pricing_basis: 'per_day', quantity: '1', unit_price: '400',
    price_index_pct: '0', working_day_profile_id: calendarId, counts_as_fte: true,
  };
}
const SFR_CELLS: Line = {
  period_start: `${YEAR}-02-01`, period_end: `${YEAR}-10-30`, pricing_basis: 'per_day', quantity: '1', unit_price: '400',
  price_index_pct: '0', working_day_profile_code: 'FR218', counts_as_fte: 'true',
};
const SFR_MONTHS = ['0', '7200', '8000', '8000', '6000', '8000', '6000', '6400', '8000', '7600', '0', '0'];

/** Compute a round the way the budget tab does (bulk-upsert, kind computed). */
async function computeInUi(runner: QueryRunner, kind: Kind, versionId: string, measure: Measure, recipe: Record<string, unknown>) {
  await amountsService(kind).bulkUpsert(versionId, { kind: 'computed', year: YEAR, measure, ...recipe }, null, { manager: runner.manager });
}

/** Export, then re-import the file as it is: computed rows (both item types) are unchanged, nothing is written. */
async function testExportedComputedRowsReimportUnchanged() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'cost-trip');
    const fr218 = await seedCalendar(runner, tenantId, 'FR218', 'France 218', { [YEAR]: FR218 });
    const opex = await seedLine(runner, 'opex', tenantId, YEAR, {}, 7);
    const capex = await seedLine(runner, 'capex', tenantId, YEAR, {}, 3);
    await computeInUi(runner, 'opex', opex.versionId, 'planned', sfrRecipe(fr218));
    await computeInUi(runner, 'capex', capex.versionId, 'actual', { pricing_basis: 'per_month', quantity: '10', unit_price: '200' });
    const before = await readRound(runner, 'opex', opex.versionId, 'planned');

    const lines = await exportLines(runner, tenantId);
    const planned = lines.find((l) => l.item_type === 'opex' && l.measure === 'planned')!;
    assert.deepEqual(MONTHS.map((m) => planned[m]), SFR_MONTHS);
    assert.deepEqual(
      [planned.method, ...BUDGET_ROWS_COSTING_HEADERS.map((h) => planned[h])],
      ['computed', 'per_day', '1', '400', '0', 'FR218', 'true'],
      'the recipe is exported next to the months',
    );
    const actual = lines.find((l) => l.item_type === 'capex' && l.measure === 'actual')!;
    assert.deepEqual(
      [actual.method, actual.jan, ...BUDGET_ROWS_COSTING_HEADERS.map((h) => actual[h])],
      ['computed', '2000', 'per_month', '10', '200', '0', '', 'false'],
    );
    const plain = lines.find((l) => l.item_type === 'opex' && l.measure === 'committed')!;
    assert.deepEqual(BUDGET_ROWS_COSTING_HEADERS.map((h) => plain[h]), repeat('', 6), 'no recipe: blank costing cells');

    for (const dryRun of [true, false]) {
      const result = await importLines(runner, tenantId, lines, { dryRun, freeze: realFreeze() });
      assert.deepEqual(result, { ok: true, dryRun, total: 10, inserted: 0, updated: 0, unchanged: 10, errors: [] });
    }
    const after = await readRound(runner, 'opex', opex.versionId, 'planned');
    assert.equal(after!.updated_at.getTime(), before!.updated_at.getTime(), 'the computed record is left alone');
    assert.equal(after!.method, 'computed');

    const template = await service().exportCsv({ scope: 'template', access: ADMIN }, { manager: runner.manager, tenantId });
    assert.ok(template.content.startsWith(`﻿${BUDGET_ROWS_BASE_HEADERS.join(';')};${BUDGET_ROWS_COSTING_HEADERS.join(';')}\n`));
  });
}

/**
 * Rows without months are computed exactly as the budget tab computes: the
 * SFR vector, 6-decimal days with an index, a split with a remainder, a
 * credit on the Actuals column. Dry run and load give the same answer; the
 * same file again is unchanged.
 */
async function testComputedRowsEqualTheBudgetTab() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'cost-ui');
    const fr218 = await seedCalendar(runner, tenantId, 'FR218', 'France 218', { [YEAR]: FR218 });
    const fr229 = await seedCalendar(runner, tenantId, 'FR229', 'France 229', { [YEAR]: FR229 });
    const ui = await seedLine(runner, 'opex', tenantId, YEAR, {}, 7);
    const file = await seedLine(runner, 'opex', tenantId, YEAR, { planned: repeat('1', 12) }, 8);
    const newYear = await seedItem(runner, 'opex', tenantId, 9);

    const cases: Array<{ measure: Measure; recipe: Record<string, unknown>; cells: Line; calendar: string[] | null }> = [
      { measure: 'planned', recipe: sfrRecipe(fr218), cells: SFR_CELLS, calendar: FR218 },
      {
        measure: 'committed',
        recipe: { pricing_basis: 'per_day', quantity: '1.5', unit_price: '612.3457', price_index_pct: '2.5', working_day_profile_id: fr229, period_start: `${YEAR}-03-10`, period_end: `${YEAR}-11-20` },
        cells: { pricing_basis: 'Per_Day', quantity: '1,5', unit_price: '612.3457', price_index_pct: '2.5', working_day_profile_code: 'fr229', period_start: `${YEAR}-03-10`, period_end: `${YEAR}-11-20` },
        calendar: FR229,
      },
      {
        measure: 'forecast',
        recipe: { pricing_basis: 'per_period', quantity: '1', unit_price: '1000', period_start: `${YEAR}-01-01`, period_end: `${YEAR}-03-31` },
        cells: { pricing_basis: 'per_period', quantity: '1', unit_price: '1000', period_start: `${YEAR}-01-01`, period_end: `${YEAR}-03-31` },
        calendar: null,
      },
      {
        measure: 'actual',
        recipe: { pricing_basis: 'per_month', quantity: '2', unit_price: '-150.5', price_index_pct: '3.3333', counts_as_fte: true },
        cells: { pricing_basis: 'per_month', quantity: '2', unit_price: '-150.5', price_index_pct: '3.3333', counts_as_fte: 'yes' },
        calendar: null,
      },
    ];
    for (const c of cases) await computeInUi(runner, 'opex', ui.versionId, c.measure, c.recipe);

    const rows = [
      ...cases.map((c) => costedRow(8, c.measure, c.cells)),
      costedRow(9, 'planned', SFR_CELLS),
    ];
    const dry = await importLines(runner, tenantId, rows, { dryRun: true });
    assert.deepEqual(dry, { ok: true, dryRun: true, total: 5, inserted: 1, updated: 4, unchanged: 0, errors: [] }, JSON.stringify(dry.errors));
    assert.deepEqual(await readMeasure(runner, 'opex', file.versionId, 'planned', YEAR), repeat('1.00', 12), 'a dry run writes nothing');
    assert.equal(await findVersion(runner, 'opex', newYear, YEAR), undefined);

    const load = await importLines(runner, tenantId, rows);
    assert.deepEqual(load, { ...dry, dryRun: false }, 'the load gives the dry run\'s answer');

    for (const c of cases) {
      const expected = computeCosting({
        year: YEAR,
        period_start: String(c.recipe.period_start ?? `${YEAR}-01-01`),
        period_end: String(c.recipe.period_end ?? `${YEAR}-12-31`),
        recipe: parseCostingRecipe(c.recipe),
        calendar: c.calendar && { code: 'X', name: 'X', days: c.calendar },
      }).month_cents.map(centsToDecimal);
      const fromUi = await readMeasure(runner, 'opex', ui.versionId, c.measure, YEAR);
      const fromFile = await readMeasure(runner, 'opex', file.versionId, c.measure, YEAR);
      assert.deepEqual(fromFile, expected, `${c.measure}: the file's months are the computation's, to the cent`);
      assert.deepEqual(fromFile, fromUi, `${c.measure}: the file's months are the budget tab's`);
      const uiRound = await readRound(runner, 'opex', ui.versionId, c.measure);
      const fileRound = await readRound(runner, 'opex', file.versionId, c.measure);
      const { updated_at: _a, ...uiRest } = uiRound!;
      const { updated_at: _b, ...fileRest } = fileRound!;
      assert.deepEqual(fileRest, uiRest, `${c.measure}: same record (method, period, recipe, explanation)`);
    }
    const sfr = await readRound(runner, 'opex', file.versionId, 'planned');
    assert.deepEqual(
      [sfr!.method, sfr!.last_calculation.total, sfr!.last_calculation.total_days, sfr!.last_calculation.working_day_profile_code, sfr!.counts_as_fte],
      ['computed', '65200.00', '163', 'FR218', true],
      'the SFR vector: 163 days, 65 200',
    );
    assert.deepEqual(await readMeasure(runner, 'opex', file.versionId, 'planned', YEAR), SFR_MONTHS.map((v) => `${v}.00`));
    assert.deepEqual(
      (await readMeasure(runner, 'opex', file.versionId, 'forecast', YEAR)).slice(0, 4),
      ['333.33', '333.33', '333.34', '0.00'],
      'for the whole period: the remainder on the last active month',
    );
    const created = await findVersion(runner, 'opex', newYear, YEAR);
    assert.deepEqual(await readMeasure(runner, 'opex', created!.id, 'planned', YEAR), SFR_MONTHS.map((v) => `${v}.00`), 'a new year is created and computed');

    const again = await importLines(runner, tenantId, rows);
    assert.deepEqual([again.ok, again.unchanged, again.updated, again.inserted], [true, 5, 0, 0], 'the same file again is unchanged');
  });
}

/** All twelve months with costing cells: months as given, the recipe saved or cleared, the explanation cleared on change. */
async function testTwelveMonthsWithCostingCells() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'cost-months');
    const fr218 = await seedCalendar(runner, tenantId, 'FR218', 'France 218', { [YEAR]: FR218 });
    const lines: Record<number, string> = {};
    for (const n of [1, 2, 3]) {
      const { versionId } = await seedLine(runner, 'opex', tenantId, YEAR, {}, n);
      await computeInUi(runner, 'opex', versionId, 'planned', sfrRecipe(fr218));
      lines[n] = versionId;
    }
    const spread = await seedLine(runner, 'opex', tenantId, YEAR, { committed: repeat('100', 12) }, 4);
    await upsertRoundInput(
      { manager: runner.manager, scope: 'opex', version: { id: spread.versionId, tenant_id: tenantId, budget_year: YEAR }, userId: null, audit: captureAudit() },
      'committed',
      { period_start: `${YEAR}-01-01`, period_end: `${YEAR}-12-31`, method: 'spread', spread_profile_name: 'flat', last_calculation: { kind: 'annual', total: '1200.00', profile: 'flat', active_months: [1], weights: ['1'] }, recipe: null },
    );

    const edited = [...SFR_MONTHS];
    edited[2] = '1234.56';
    const result = await importLines(runner, tenantId, [
      // 1. Months changed, same recipe: edited by hand, recipe kept.
      costedRow(1, 'planned', SFR_CELLS, months(edited)),
      // 2. Same months, another quantity: no longer computed from its recipe.
      costedRow(2, 'planned', { ...SFR_CELLS, quantity: '2' }, months(SFR_MONTHS)),
      // 3. Same months, blank costing cells: the recipe is cleared.
      costedRow(3, 'planned', { period_start: `${YEAR}-02-01`, period_end: `${YEAR}-10-30` }, months(SFR_MONTHS)),
      // 4. A spread column gets a recipe: still spread.
      costedRow(4, 'committed', { pricing_basis: 'per_month', quantity: '1', unit_price: '100' }, months(repeat('100', 12))),
    ]);
    assert.deepEqual([result.ok, result.updated, result.unchanged], [true, 4, 0], JSON.stringify(result.errors));

    const one = await readRound(runner, 'opex', lines[1], 'planned');
    assert.deepEqual([one!.method, one!.pricing_basis, one!.quantity, one!.last_calculation], ['manual', 'per_day', '1', null]);
    assert.equal((await readMeasure(runner, 'opex', lines[1], 'planned', YEAR))[2], '1234.56');
    const two = await readRound(runner, 'opex', lines[2], 'planned');
    assert.deepEqual([two!.method, two!.quantity, two!.last_calculation], ['manual', '2', null]);
    assert.deepEqual(await readMeasure(runner, 'opex', lines[2], 'planned', YEAR), SFR_MONTHS.map((v) => `${v}.00`), 'months untouched');
    const three = await readRound(runner, 'opex', lines[3], 'planned');
    assert.deepEqual(
      [three!.method, three!.pricing_basis, three!.quantity, three!.working_day_profile_id, three!.counts_as_fte, three!.last_calculation],
      ['manual', null, null, null, false, null],
    );
    const four = await readRound(runner, 'opex', spread.versionId, 'committed');
    assert.deepEqual([four!.method, four!.spread_profile_name, four!.pricing_basis, four!.last_calculation], ['spread', 'flat', 'per_month', null]);

    // No month and a complete recipe on a column edited by hand: computed again.
    const recompute = await importLines(runner, tenantId, [costedRow(1, 'planned', SFR_CELLS)]);
    assert.deepEqual([recompute.ok, recompute.updated], [true, 1], JSON.stringify(recompute.errors));
    assert.deepEqual(await readMeasure(runner, 'opex', lines[1], 'planned', YEAR), SFR_MONTHS.map((v) => `${v}.00`));
    assert.equal((await readRound(runner, 'opex', lines[1], 'planned'))!.method, 'computed');
  });
}

/** Some months, or no month without a complete recipe: row errors, nothing written. */
async function testMonthRowErrors() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'cost-partial');
    await seedCalendar(runner, tenantId, 'FR218', 'France 218', { [YEAR]: FR218 });
    const { versionId } = await seedLine(runner, 'opex', tenantId, YEAR, { planned: repeat('5', 12) }, 1);
    const partial = months(repeat('5', 12));
    partial.jun = '';
    const result = await importLines(runner, tenantId, [
      costedRow(1, 'planned', SFR_CELLS, partial),
      costedRow(1, 'committed', {}),
      costedRow(1, 'forecast', { pricing_basis: 'per_month', quantity: '1' }),
      costedRow(1, 'actual', { quantity: '1', unit_price: '1' }),
      costedRow(1, 'expected_landing', SFR_CELLS, { ...months(repeat('', 12)), jan: '1' }),
    ]);
    assert.equal(result.ok, false);
    assert.deepEqual(result.errors, [
      { row: 2, message: 'Give all twelve months, or none to compute them from quantity and price.' },
      { row: 3, message: 'Give all twelve months, or a pricing basis with quantity and unit price.' },
      { row: 4, message: 'Give all twelve months, or a pricing basis with quantity and unit price.' },
      { row: 5, message: 'Give all twelve months, or a pricing basis with quantity and unit price.' },
      { row: 6, message: 'Give all twelve months, or none to compute them from quantity and price.' },
    ]);
    assert.deepEqual(await readMeasure(runner, 'opex', versionId, 'planned', YEAR), repeat('5.00', 12), 'nothing written');
  });
}

/** Recipe cells: each wrong cell is a row error with a sentence; accepted spellings are stored normalised. */
async function testRecipeCells() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'cost-cells');
    await seedCalendar(runner, tenantId, 'FR218', 'France 218', { [YEAR]: FR218 });
    for (const n of [1, 2, 3, 4, 5, 6]) await seedLine(runner, 'opex', tenantId, YEAR, {}, n);
    const perMonth = { pricing_basis: 'per_month', quantity: '1', unit_price: '10' };
    const bad = await importLines(runner, tenantId, [
      costedRow(1, 'planned', { ...perMonth, pricing_basis: 'weekly' }),
      costedRow(1, 'committed', { ...perMonth, quantity: '1.2345' }),
      costedRow(1, 'forecast', { ...perMonth, quantity: '-1' }),
      costedRow(1, 'actual', { ...perMonth, price_index_pct: '-100.5' }),
      costedRow(1, 'expected_landing', { ...perMonth, unit_price: '1.23456' }),
      costedRow(2, 'planned', { ...perMonth, working_day_profile_code: 'FR218' }),
      costedRow(2, 'committed', { ...perMonth, pricing_basis: 'per_day' }),
      costedRow(2, 'forecast', { ...perMonth, counts_as_fte: 'maybe' }),
      costedRow(2, 'actual', { counts_as_fte: 'true' }, months(repeat('0', 12))),
      costedRow(2, 'expected_landing', { ...perMonth, quantity: 'abc' }),
    ]);
    assert.equal(bad.ok, false);
    assert.deepEqual(bad.errors, [
      { row: 2, message: "Unknown pricing basis 'weekly'. Use per_day, per_month, per_period." },
      { row: 3, message: 'Quantity accepts at most 3 decimals.' },
      { row: 4, message: 'Quantity cannot be negative.' },
      { row: 5, message: 'The price index cannot be below -100%.' },
      { row: 6, message: 'Unit price accepts at most 4 decimals.' },
      { row: 7, message: 'A calendar is used only with a price per day.' },
      { row: 8, message: 'Give the code of a working-day calendar for a price per day.' },
      { row: 9, message: "counts_as_fte 'maybe' is not understood. Use true or false." },
      { row: 10, message: 'Choose a pricing basis.' },
      { row: 11, message: 'Quantity must be a number.' },
    ]);

    const ok = await importLines(runner, tenantId, [
      costedRow(3, 'planned', { ...perMonth, pricing_basis: ' PER_MONTH ', counts_as_fte: 'YES' }),
      costedRow(4, 'planned', { ...perMonth, quantity: '2.500', counts_as_fte: '0' }),
      costedRow(5, 'planned', { ...perMonth, price_index_pct: '', counts_as_fte: '1' }),
      costedRow(6, 'planned', { ...perMonth, counts_as_fte: 'no', unit_price: '-10' }),
    ]);
    assert.deepEqual([ok.ok, ok.updated], [true, 4], JSON.stringify(ok.errors));
    const stored = await runner.query(
      `SELECT i.item_number, r.pricing_basis::text AS basis, r.quantity::text AS quantity, r.price_index_pct::text AS idx, r.counts_as_fte
       FROM spend_round_inputs r JOIN spend_versions v ON v.id = r.version_id JOIN spend_items i ON i.id = v.spend_item_id
       WHERE r.tenant_id = $1 ORDER BY i.item_number`,
      [tenantId],
    );
    assert.deepEqual(stored.map((r: any) => [r.item_number, r.basis, Number(r.quantity), Number(r.idx), r.counts_as_fte]), [
      [3, 'per_month', 1, 0, true],
      [4, 'per_month', 2.5, 0, false],
      [5, 'per_month', 1, 0, true],
      [6, 'per_month', 1, 0, false],
    ]);
  });
}

/** Calendar codes: unknown, another tenant's, disabled when newly assigned, missing year; the stored disabled one recomputes. */
async function testCalendarCodes() {
  await inRolledBackTransaction(async (runner) => {
    const other = await seedTenant(runner, 'cost-other');
    await seedCalendar(runner, other, 'OTHER', 'Other tenant', { [YEAR]: FR218 });
    const tenantId = await seedTenant(runner, 'cost-cal');
    const fr218 = await seedCalendar(runner, tenantId, 'FR218', 'France 218', { [YEAR]: FR218 });
    await seedCalendar(runner, tenantId, 'OLD', 'Old calendar', { [YEAR]: FR218 }, true);
    const line = await seedLine(runner, 'opex', tenantId, YEAR, {}, 1);
    await seedLine(runner, 'opex', tenantId, YEAR + 1, {}, 2);
    await computeInUi(runner, 'opex', line.versionId, 'planned', sfrRecipe(fr218));

    const refused = await importLines(runner, tenantId, [
      costedRow(1, 'committed', { ...SFR_CELLS, working_day_profile_code: 'NOPE' }),
      costedRow(1, 'forecast', { ...SFR_CELLS, working_day_profile_code: 'OTHER' }),
      costedRow(1, 'actual', { ...SFR_CELLS, working_day_profile_code: 'old' }),
      costedRow(1, 'expected_landing', { ...SFR_CELLS, working_day_profile_code: 'OLD' }, months(repeat('0', 12))),
      { ...costedRow(2, 'planned', { ...SFR_CELLS, period_start: '', period_end: '' }), year: String(YEAR + 1) },
    ]);
    assert.equal(refused.ok, false);
    assert.deepEqual(refused.errors, [
      { row: 2, message: "No working-day calendar has the code 'NOPE'." },
      { row: 3, message: "No working-day calendar has the code 'OTHER'." },
      { row: 4, message: 'Old calendar is disabled. Pick an enabled calendar.' },
      { row: 5, message: 'Old calendar is disabled. Pick an enabled calendar.' },
      { row: 6, message: `France 218 has no working days for ${YEAR + 1}. Add them on the Working-day calendars page.` },
    ]);

    // The round's own calendar, disabled since: recomputing with it still works.
    await disableCalendar(runner, tenantId, fr218);
    const recompute = await importLines(runner, tenantId, [costedRow(1, 'planned', { ...SFR_CELLS, unit_price: '408', working_day_profile_code: 'fr218' })]);
    assert.deepEqual([recompute.ok, recompute.updated], [true, 1], JSON.stringify(recompute.errors));
    assert.equal((await readMeasure(runner, 'opex', line.versionId, 'planned', YEAR))[1], '7344.00', '18 days × 408');
    const assignElsewhere = await importLines(runner, tenantId, [costedRow(1, 'committed', SFR_CELLS)]);
    assert.deepEqual(assignElsewhere.errors, [{ row: 2, message: 'France 218 is disabled. Pick an enabled calendar.' }]);
  });
}

/**
 * Without the costing columns a file keeps step A's behaviour and the stored
 * recipe; with only some of them the header is refused.
 */
async function testHeadersAbsentKeepTheRecipe() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'cost-absent');
    const fr218 = await seedCalendar(runner, tenantId, 'FR218', 'France 218', { [YEAR]: FR218 });
    const { versionId } = await seedLine(runner, 'opex', tenantId, YEAR, {}, 1);
    await computeInUi(runner, 'opex', versionId, 'planned', sfrRecipe(fr218));
    const edited = [...SFR_MONTHS];
    edited[3] = '0';
    const row = costedRow(1, 'planned', { period_start: `${YEAR}-02-01`, period_end: `${YEAR}-10-30` }, months(edited));
    const result = await importLines(runner, tenantId, [row], { headers: BUDGET_ROWS_BASE_HEADERS });
    assert.deepEqual([result.ok, result.updated], [true, 1], JSON.stringify(result.errors));
    const round = await readRound(runner, 'opex', versionId, 'planned');
    assert.deepEqual(
      [round!.method, round!.pricing_basis, round!.quantity, round!.working_day_profile_id, round!.counts_as_fte, round!.last_calculation?.kind],
      ['manual', 'per_day', '1', fr218, true, 'computed'],
      'a hand edit keeps the recipe and the explanation',
    );

    const partialHeaders = BUDGET_ROWS_HEADERS.filter((h) => h !== 'counts_as_fte' && h !== 'working_day_profile_code');
    const header = await importLines(runner, tenantId, [row], { headers: partialHeaders });
    assert.deepEqual(header.errors, [{ row: 1, message: 'Header mismatch. Missing: working_day_profile_code, counts_as_fte, Extra: -' }]);
  });
}

/** Identical computed rows pass a frozen column and a reader; a changed recipe is refused by the freeze and needs administration. */
async function testFreezeAndRights() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'cost-freeze');
    const fr218 = await seedCalendar(runner, tenantId, 'FR218', 'France 218', { [YEAR]: FR218 });
    const { versionId } = await seedLine(runner, 'opex', tenantId, YEAR, {}, 1);
    await computeInUi(runner, 'opex', versionId, 'planned', sfrRecipe(fr218));
    await freezeColumn(runner, 'opex', tenantId, YEAR, 'budget');
    const row = costedRow(1, 'planned', SFR_CELLS);

    const reader: BudgetRowsAccess = { isAdmin: false, permissions: { opex: 'reader' } };
    const identical = await importLines(runner, tenantId, [row], { freeze: realFreeze(), access: reader });
    assert.deepEqual([identical.ok, identical.unchanged], [true, 1], JSON.stringify(identical.errors));

    const changed = { ...row, quantity: '2' };
    const frozen = await importLines(runner, tenantId, [changed], { freeze: realFreeze() });
    assert.deepEqual(frozen.errors, [{ row: 2, message: `Import not allowed: OPEX Budget for ${YEAR} is frozen` }]);
    const notAdmin = await importLines(runner, tenantId, [changed], { access: reader });
    assert.deepEqual(notAdmin.errors, [{ row: 2, message: 'OPEX rows need OPEX administration rights.' }]);
    assert.equal((await readRound(runner, 'opex', versionId, 'planned'))!.quantity, '1', 'nothing written');
  });
}

async function waitUntilBlocked(pid: number) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const [row] = await dataSource.query(`SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1`, [pid]);
    if (row?.wait_event_type === 'Lock') return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('the load never waited for the calendar delete');
}

/**
 * A load racing a calendar delete: the load reads its calendars FOR KEY SHARE,
 * so it waits for the delete (which holds the calendar FOR UPDATE) and then
 * answers the row error, instead of reading the calendar, inserting its round
 * and failing on the key once the delete commits. A dry run locks nothing.
 */
async function testLoadRacingACalendarDelete() {
  const seed = dataSource.createQueryRunner();
  await seed.connect();
  await seed.startTransaction();
  const tenantId = await seedTenant(seed, 'cost-lock');
  const calendarId = await seedCalendar(seed, tenantId, 'FR218', 'France 218', { [YEAR]: FR218 });
  await seedLine(seed, 'opex', tenantId, YEAR, {}, 1);
  await seed.commitTransaction();
  await seed.release();

  const open = async () => {
    const runner = dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    await setTenant(runner, tenantId);
    return runner;
  };
  const row = costedRow(1, 'planned', SFR_CELLS);
  const runners: QueryRunner[] = [];
  try {
    const dry = await open();
    runners.push(dry);
    assert.equal((await importLines(dry, tenantId, [row], { dryRun: true })).ok, true);
    const probe = await open();
    runners.push(probe);
    await probe.query(`SET LOCAL lock_timeout = '200ms'`);
    await probe.query(`SELECT id FROM working_day_profiles WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [tenantId, calendarId]);
    await probe.rollbackTransaction();
    await dry.rollbackTransaction();

    const remover = await open();
    runners.push(remover);
    await remover.query(`SELECT id FROM working_day_profiles WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [tenantId, calendarId]);
    const load = await open();
    runners.push(load);
    const [{ pid }] = await load.query(`SELECT pg_backend_pid() AS pid`);
    const pending = importLines(load, tenantId, [row]);
    await waitUntilBlocked(pid);
    await remover.query(`DELETE FROM working_day_profiles WHERE tenant_id = $1 AND id = $2`, [tenantId, calendarId]);
    await remover.commitTransaction();
    const result = await pending;
    assert.deepEqual(result.errors, [{ row: 2, message: "No working-day calendar has the code 'FR218'." }], 'the load answers the row error, not a failed key');
    await load.rollbackTransaction();
  } finally {
    for (const runner of runners) {
      if (runner.isTransactionActive) await runner.rollbackTransaction().catch(() => undefined);
      await runner.release();
    }
    await dataSource.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
      for (const table of ['spend_round_inputs', 'spend_amounts', 'spend_versions', 'spend_items', 'working_day_profiles']) {
        await manager.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
      }
    });
    await dataSource.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  }
}

void runSpecs('budget-rows-costing.integration.spec', [
  ['testExportedComputedRowsReimportUnchanged', testExportedComputedRowsReimportUnchanged],
  ['testComputedRowsEqualTheBudgetTab', testComputedRowsEqualTheBudgetTab],
  ['testTwelveMonthsWithCostingCells', testTwelveMonthsWithCostingCells],
  ['testMonthRowErrors', testMonthRowErrors],
  ['testRecipeCells', testRecipeCells],
  ['testCalendarCodes', testCalendarCodes],
  ['testHeadersAbsentKeepTheRecipe', testHeadersAbsentKeepTheRecipe],
  ['testFreezeAndRights', testFreezeAndRights],
  ['testLoadRacingACalendarDelete', testLoadRacingACalendarDelete],
]);

// `dataSource` is imported so the CI runner schedules this spec on the database lane.
void dataSource;
