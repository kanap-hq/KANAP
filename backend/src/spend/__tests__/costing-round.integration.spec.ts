import 'dotenv/config';
import 'reflect-metadata';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { REQUIRE_LEVEL_KEY } from '../../auth/require-level.decorator';
import { SpendVersionsController } from '../spend-versions.controller';
import { CapexVersionsController } from '../../capex/capex-versions.controller';
import { DISABLED_CALENDAR_WARNING } from '../round-inputs.util';
import {
  amountsService,
  assert,
  budgetOperations,
  captureAudit,
  findVersion,
  FRANCE_218_2026,
  freezeColumn,
  inRolledBackTransaction,
  Kind,
  period,
  readLines,
  readMeasure,
  readRecords,
  realFreeze,
  repeat,
  runSpecs,
  seedCalendar,
  seedLine,
  seedTenant,
  setItemDates,
  setTenant,
  TABLES,
} from './round-inputs.fixtures';
import { exportBudgetFile, loadBudgetFile, preflightBudgetFile } from './budget-file.fixtures';

// Columns computed from quantity × price lines through the amounts services
// (bulk-upsert `kind: 'lines'`), on OPEX and CAPEX, against the database
// behind `dataSource`: what is written (months, record, lines with how often
// and the days per month, the explanation with both FTE figures, the
// response), fried's lines on a standard calendar, wholesale replacement,
// `also_measures`, `[]`, the freeze, calendars (disabled, another tenant's,
// the key-share lock), another tenant's version, the lines kept by hand
// edits and spreads, copy and clear.

const YEAR = 2026;
const KINDS: Kind[] = ['opex', 'capex'];

const CONSULTANT_MONTHS = ['0.00', '7200.00', '8000.00', '8000.00', '6000.00', '8000.00', '6000.00', '6400.00', '8000.00', '7600.00', '0.00', '0.00'];
const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

type Ctx = { runner: QueryRunner; tenantId: string; versionId: string; itemId: string; calendarId: string };

async function withCalendarLine(kind: Kind, fn: (ctx: Ctx) => Promise<void>, values: Parameters<typeof seedLine>[4] = {}) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `${kind}-lines`);
    const calendarId = await seedCalendar(runner, tenantId, { code: 'FR218', name: 'France 218', days_by_year: { [YEAR]: FRANCE_218_2026 } });
    const { itemId, versionId } = await seedLine(runner, kind, tenantId, YEAR, values);
    await fn({ runner, tenantId, versionId, itemId, calendarId });
  });
}

/** The reference row as a line: a consultant full time, February to October, 400 a day on France 218. */
function sfrLine(calendarId: string, overrides: Record<string, unknown> = {}) {
  return {
    label: 'Consultant',
    quantity_unit: 'people',
    quantity: '1',
    unit_price: '400',
    price_basis: 'per_day',
    frequency: 'per_month',
    days_per_month: null,
    period_start: `${YEAR}-02-01`,
    period_end: `${YEAR}-10-30`,
    working_day_profile_id: calendarId,
    ...overrides,
  };
}

/** Ten licences at 200 a piece each month, over the year. */
function licenceLine(overrides: Record<string, unknown> = {}) {
  return {
    label: 'Licences',
    quantity_unit: 'pieces',
    quantity: 10,
    unit_price: '200',
    price_basis: 'per_piece',
    frequency: 'per_month',
    days_per_month: null,
    period_start: `${YEAR}-01-01`,
    period_end: `${YEAR}-12-31`,
    working_day_profile_id: null,
    ...overrides,
  };
}

/** The standard France calendar's working days of 2026 (public holidays). */
const FRANCE_2026 = ['21', '20', '22', '21', '17', '22', '22', '21', '22', '22', '20', '22'];

function linesPayload(lines: unknown[], overrides: Record<string, unknown> = {}) {
  return { kind: 'lines', year: YEAR, measure: 'planned', lines, ...overrides };
}

const roundAudits = (audit: ReturnType<typeof captureAudit>) => audit.entries.filter((e) => e.table.endsWith('_round_inputs'));
const amountsTable = (kind: Kind) => TABLES[kind].amounts;
const shape = (lines: Array<Record<string, any>>) => lines.map((l) => [
  l.sort, l.label, l.quantity_unit, l.quantity, l.unit_price, l.price_basis, l.frequency, l.days_per_month, l.period_start, l.period_end,
]);

async function countLines(runner: QueryRunner, kind: Kind, tenantId: string): Promise<number> {
  const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM ${TABLES[kind].lines} WHERE tenant_id = $1`, [tenantId]);
  return n;
}

/** Two lines: the column's months, the other columns untouched, the record, the lines, the explanation, the response. */
async function testLinesWrite(kind: Kind) {
  await withCalendarLine(kind, async ({ runner, versionId, calendarId }) => {
    const audit = captureAudit();
    const svc = amountsService(kind, audit);
    const response = await svc.bulkUpsert(versionId, linesPayload([sfrLine(calendarId), licenceLine()]), null, { manager: runner.manager });
    const columnMonths = CONSULTANT_MONTHS.map((m) => (Number(m) + 2000).toFixed(2));
    assert.equal(response.updated, 12, `${kind}: twelve months written`);
    assert.deepEqual(response.warnings, [], `${kind}: no warning`);
    assert.deepEqual(await readMeasure(runner, kind, versionId, 'planned', YEAR), columnMonths, `${kind}: the two lines summed`);
    assert.deepEqual(await readMeasure(runner, kind, versionId, 'committed', YEAR), repeat('6.00', 12), `${kind}: other columns untouched`);

    const { planned } = await readRecords(runner, kind, versionId);
    assert.deepEqual(
      [planned.method, planned.period_start, planned.period_end, planned.spread_profile_name, planned.fte],
      ['computed', `${YEAR}-01-01`, `${YEAR}-12-31`, null, '0.75'],
      `${kind}: from the earliest start to the latest end; 9 people-months ÷ 12`,
    );
    assert.deepEqual(planned.last_calculation, {
      kind: 'computed',
      total: '89200.00',
      fte: '0.75',
      // The period counts the consultant's nine months only: the licences do not dilute it.
      fte_period: '1',
      month_amounts: columnMonths,
      fte_months: ['0', ...repeat('1', 9), '0', '0'],
      active_months: MONTHS,
      lines: [
        {
          label: 'Consultant', quantity_unit: 'people', quantity: '1', unit_price: '400', price_basis: 'per_day',
          frequency: 'per_month', days_per_month: null, period_start: `${YEAR}-02-01`, period_end: `${YEAR}-10-30`,
          working_day_profile_id: calendarId, working_day_profile_code: 'FR218', working_day_profile_name: 'France 218',
          active_months: [2, 3, 4, 5, 6, 7, 8, 9, 10], day_counts: FRANCE_218_2026, total_days: '163',
          month_amounts: CONSULTANT_MONTHS, fte_months: ['0', ...repeat('1', 9), '0', '0'], fte: '0.75', fte_period: '1', total: '65200.00',
        },
        {
          label: 'Licences', quantity_unit: 'pieces', quantity: '10', unit_price: '200', price_basis: 'per_piece',
          frequency: 'per_month', days_per_month: null, period_start: `${YEAR}-01-01`, period_end: `${YEAR}-12-31`,
          working_day_profile_id: null, working_day_profile_code: null, working_day_profile_name: null,
          active_months: MONTHS, day_counts: null, total_days: null,
          month_amounts: repeat('2000.00', 12), fte_months: repeat('0', 12), fte: '0', fte_period: '0', total: '24000.00',
        },
      ],
    }, `${kind}: the explanation carries each line, the day counts used and both FTE figures`);

    const stored = await readLines(runner, kind, versionId, 'planned');
    assert.deepEqual(
      stored.map((l) => [
        l.sort, l.label, l.quantity_unit, l.quantity, l.unit_price, l.price_basis, l.frequency, l.days_per_month, l.working_day_profile_id,
        l.period_start, l.period_end,
      ]),
      [
        [1, 'Consultant', 'people', '1.000', '400.0000', 'per_day', 'per_month', null, calendarId, `${YEAR}-02-01`, `${YEAR}-10-30`],
        [2, 'Licences', 'pieces', '10.000', '200.0000', 'per_piece', 'per_month', null, null, `${YEAR}-01-01`, `${YEAR}-12-31`],
      ],
      `${kind}: the lines in their table, in order`,
    );

    const { updated_at, ...returned } = response.round_inputs[0];
    assert.deepEqual(returned, {
      measure: 'planned',
      period_start: `${YEAR}-01-01`,
      period_end: `${YEAR}-12-31`,
      method: 'computed',
      spread_profile_name: null,
      last_calculation: planned.last_calculation,
      fte: '0.75',
      lines: [
        {
          id: stored[0].id, sort: 1, label: 'Consultant', quantity_unit: 'people', quantity: '1', unit_price: '400', price_basis: 'per_day',
          frequency: 'per_month', days_per_month: null, period_start: `${YEAR}-02-01`, period_end: `${YEAR}-10-30`,
          working_day_profile_id: calendarId, working_day_profile_code: 'FR218', working_day_profile_name: 'France 218',
        },
        {
          id: stored[1].id, sort: 2, label: 'Licences', quantity_unit: 'pieces', quantity: '10', unit_price: '200', price_basis: 'per_piece',
          frequency: 'per_month', days_per_month: null, period_start: `${YEAR}-01-01`, period_end: `${YEAR}-12-31`,
          working_day_profile_id: null, working_day_profile_code: null, working_day_profile_name: null,
        },
      ],
      updated_by: null,
    }, `${kind}: the API record, decimals without trailing zeros, calendar code and name`);
    assert.ok(!Number.isNaN(Date.parse(updated_at)));
    const listed = await svc.listByYear(versionId, YEAR, { manager: runner.manager });
    assert.deepEqual(listed.round_inputs, response.round_inputs, `${kind}: GET amounts returns the same records and lines`);

    assert.equal(audit.entries.filter((e) => e.table === amountsTable(kind)).length, 1, `${kind}: the amounts are audited`);
    const [roundAudit] = roundAudits(audit);
    assert.deepEqual([roundAudit.action, roundAudit.after?.method, roundAudit.after?.lines?.length], ['create', 'computed', 2], `${kind}: one audit row, lines included`);
  }, { committed: repeat('6', 12) });
}

/** Days are a bundle over their period: fried's first line, 100 days at 600 a day from March, with a calendar for the FTE. */
async function testDaysLine(kind: Kind) {
  await withCalendarLine(kind, async ({ runner, versionId, calendarId }) => {
    const line = sfrLine(calendarId, {
      label: 'Managed services', quantity_unit: 'days', quantity: '100', unit_price: '600', frequency: 'once',
      period_start: `${YEAR}-03-01`, period_end: `${YEAR}-12-31`,
    });
    await amountsService(kind).bulkUpsert(versionId, linesPayload([line], { measure: 'actual' }), null, { manager: runner.manager });
    assert.deepEqual(await readMeasure(runner, kind, versionId, 'actual', YEAR), ['0.00', '0.00', ...repeat('6000.00', 10)], `${kind}: 6 000 a month`);
    const { actual } = await readRecords(runner, kind, versionId);
    assert.deepEqual([actual.method, actual.fte, actual.last_calculation.lines[0].fte_months[4]], ['computed', '0.46', '0.666667'],
      `${kind}: 10 days ÷ the working days of each month; any column, Actuals included`);
    assert.deepEqual([actual.last_calculation.fte_period, (await readLines(runner, kind, versionId, 'actual'))[0].frequency], ['0.56', 'once']);
  });
}

/**
 * fried's lines (2026-09-29) on a standard France calendar. Budget: a project
 * manager 5 days per month at 1 200 a day, February to July, and a laptop
 * bought once on a date. Revision: a person at 8 000 per month (sent without
 * how often nor days per month, as an API caller may), a bundle of 30 days,
 * 50 pieces each month.
 */
async function testFriedLines(kind: Kind) {
  await withCalendarLine(kind, async ({ runner, tenantId, versionId }) => {
    const [{ id: france }] = await runner.query(
      `INSERT INTO working_day_profiles (tenant_id, code, name, country_iso) VALUES ($1, 'FR', 'France', 'FR') RETURNING id`,
      [tenantId],
    );
    const svc = amountsService(kind);
    const projectManager = sfrLine(france, {
      label: 'Project manager', unit_price: '1200', days_per_month: 5, period_start: `${YEAR}-02-01`, period_end: `${YEAR}-07-31`,
    });
    const laptop = licenceLine({ label: 'Laptop', quantity: 1, unit_price: '2000', frequency: 'once', period_start: `${YEAR}-03-20`, period_end: `${YEAR}-03-20` });
    const budget = await svc.bulkUpsert(versionId, linesPayload([projectManager, laptop]), null, { manager: runner.manager });
    assert.deepEqual(
      await readMeasure(runner, kind, versionId, 'planned', YEAR),
      ['0.00', '6000.00', '8000.00', ...repeat('6000.00', 4), ...repeat('0.00', 5)],
      `${kind}: 5 × 1 200 each month, the laptop in March although the 20th is past the 15th`,
    );
    const [record] = budget.round_inputs;
    assert.deepEqual([record.period_start, record.period_end], [`${YEAR}-02-01`, `${YEAR}-07-31`], `${kind}: the record covers February to July`);
    const calculation = record.last_calculation;
    assert.deepEqual(
      [record.fte, calculation.fte, calculation.fte_period, calculation.active_months, calculation.total],
      ['0.12', '0.12', '0.24', [2, 3, 4, 5, 6, 7], '38000.00'],
      `${kind}: the full-year average stored, the average over February to July beside it`,
    );
    assert.deepEqual(
      calculation.lines.map((l: any) => [l.label, l.frequency, l.days_per_month, l.active_months, l.fte, l.fte_period, l.total]),
      [
        ['Project manager', 'per_month', '5', [2, 3, 4, 5, 6, 7], '0.12', '0.24', '36000.00'],
        ['Laptop', 'once', null, [3], '0', '0', '2000.00'],
      ],
    );
    assert.deepEqual(calculation.lines[0].fte_months, ['0', '0.25', '0.227273', '0.238095', '0.294118', '0.227273', '0.227273', ...repeat('0', 5)]);
    assert.deepEqual([calculation.lines[0].day_counts, calculation.lines[0].total_days], [FRANCE_2026, '124'], `${kind}: the standard calendar's days`);
    assert.deepEqual(
      record.lines.map((l: any) => [l.label, l.quantity_unit, l.price_basis, l.frequency, l.days_per_month, l.period_start, l.period_end, l.working_day_profile_code]),
      [
        ['Project manager', 'people', 'per_day', 'per_month', '5', `${YEAR}-02-01`, `${YEAR}-07-31`, 'FR'],
        ['Laptop', 'pieces', 'per_piece', 'once', null, `${YEAR}-03-20`, `${YEAR}-03-20`, null],
      ],
      `${kind}: the API lines`,
    );
    assert.deepEqual(
      (await readLines(runner, kind, versionId, 'planned')).map((l) => [l.frequency, l.days_per_month]),
      [['per_month', '5.000'], ['once', null]],
      `${kind}: stored`,
    );

    const person: Record<string, unknown> = {
      label: 'Person', quantity_unit: 'people', quantity: '1', unit_price: '8000', price_basis: 'per_month',
      period_start: `${YEAR}-01-01`, period_end: `${YEAR}-12-31`, working_day_profile_id: null,
    };
    const bundle = sfrLine(france, { label: 'Bundle', quantity_unit: 'days', quantity: '30', unit_price: '1200', frequency: 'once', period_start: `${YEAR}-02-01`, period_end: `${YEAR}-07-31` });
    const revision = await svc.bulkUpsert(
      versionId,
      linesPayload([person, bundle, licenceLine({ quantity: 50, unit_price: '12' })], { measure: 'forecast' }),
      null,
      { manager: runner.manager },
    );
    assert.deepEqual(
      await readMeasure(runner, kind, versionId, 'forecast', YEAR),
      ['8600.00', ...repeat('14600.00', 6), ...repeat('8600.00', 5)],
      `${kind}: 8 000 + 6 000 of the bundle + 600 of the pieces`,
    );
    const forecast = revision.round_inputs.find((r: any) => r.measure === 'forecast');
    assert.deepEqual(
      [forecast.fte, forecast.last_calculation.fte, forecast.last_calculation.fte_period],
      ['1.12', '1.12', '1.12'],
      `${kind}: (12 + 1.464032) ÷ 12, the column covers the year`,
    );
    assert.deepEqual(
      forecast.last_calculation.lines.map((l: any) => [l.label, l.frequency, l.days_per_month, l.fte, l.fte_period, l.total]),
      [
        ['Person', 'per_month', null, '1', '1', '96000.00'],
        ['Bundle', 'once', null, '0.12', '0.24', '36000.00'],
        ['Licences', 'per_month', null, '0', '0', '7200.00'],
      ],
      `${kind}: a person per month counts 1 each month; how often filled in for people`,
    );
    assert.deepEqual(forecast.last_calculation.lines[1].month_amounts, ['0.00', ...repeat('6000.00', 6), ...repeat('0.00', 5)]);
  });
}

/** Every write replaces the lines wholesale; an identical resubmit writes no record. */
async function testWholesaleReplacement(kind: Kind) {
  await withCalendarLine(kind, async ({ runner, versionId, calendarId }) => {
    const audit = captureAudit();
    const svc = amountsService(kind, audit);
    await svc.bulkUpsert(versionId, linesPayload([sfrLine(calendarId), licenceLine()]), null, { manager: runner.manager });
    const [first] = await readLines(runner, kind, versionId, 'planned');

    const reply = await svc.bulkUpsert(versionId, linesPayload([licenceLine({ quantity: '5', label: 'Fewer licences' })]), null, { manager: runner.manager });
    const lines = await readLines(runner, kind, versionId, 'planned');
    assert.deepEqual(shape(lines), [[1, 'Fewer licences', 'pieces', '5.000', '200.0000', 'per_piece', 'per_month', null, `${YEAR}-01-01`, `${YEAR}-12-31`]]);
    assert.notEqual(lines[0].id, first.id, `${kind}: new rows`);
    assert.deepEqual(reply.round_inputs[0].lines.map((l: any) => l.id), [lines[0].id], `${kind}: the response carries the new ids`);
    assert.deepEqual(await readMeasure(runner, kind, versionId, 'planned', YEAR), repeat('1000.00', 12), `${kind}: months recomputed`);
    assert.equal((await readRecords(runner, kind, versionId)).planned.fte, '0.00', `${kind}: pieces give no FTE`);

    const before = (await readRecords(runner, kind, versionId)).planned;
    const audits = roundAudits(audit).length;
    const amountAudits = audit.entries.filter((e) => e.table === amountsTable(kind)).length;
    const same = await svc.bulkUpsert(versionId, linesPayload([licenceLine({ quantity: '5.000', unit_price: 200, label: ' Fewer licences ' })]), null, { manager: runner.manager });
    const after = (await readRecords(runner, kind, versionId)).planned;
    assert.equal(after.updated_at.getTime(), before.updated_at.getTime(), `${kind}: the same lines write no record`);
    assert.equal(roundAudits(audit).length, audits, `${kind}: and audit none`);
    assert.equal(same.updated, 0, `${kind}: the recompute gives the stored months: no month written`);
    assert.equal(audit.entries.filter((e) => e.table === amountsTable(kind)).length, amountAudits, `${kind}: and no amounts audit`);
    assert.equal((await readLines(runner, kind, versionId, 'planned'))[0].id, lines[0].id, `${kind}: nor lines`);

    // Days per month compare by value: 5, "5" and "5.000" on an unchanged line write nothing.
    await svc.bulkUpsert(versionId, linesPayload([sfrLine(calendarId, { days_per_month: 5 })]), null, { manager: runner.manager });
    const [fiveDays] = await readLines(runner, kind, versionId, 'planned');
    assert.equal(fiveDays.days_per_month, '5.000', `${kind}: days per month stored`);
    const fiveBefore = (await readRecords(runner, kind, versionId)).planned;
    const fiveAudits = roundAudits(audit).length;
    for (const days of [5, '5', '5.000']) {
      await svc.bulkUpsert(versionId, linesPayload([sfrLine(calendarId, { days_per_month: days })]), null, { manager: runner.manager });
      const fiveAfter = (await readRecords(runner, kind, versionId)).planned;
      assert.equal(fiveAfter.updated_at.getTime(), fiveBefore.updated_at.getTime(), `${kind}: days per month ${JSON.stringify(days)} writes no record`);
      assert.equal((await readLines(runner, kind, versionId, 'planned'))[0].id, fiveDays.id, `${kind}: nor lines (${JSON.stringify(days)})`);
    }
    assert.equal(roundAudits(audit).length, fiveAudits, `${kind}: and audit none`);
    await svc.bulkUpsert(versionId, linesPayload([licenceLine({ quantity: '5', label: 'Fewer licences' })]), null, { manager: runner.manager });

    // How often is part of the line: once instead of each month rewrites it.
    await svc.bulkUpsert(versionId, linesPayload([licenceLine({ quantity: '5', label: 'Fewer licences', frequency: 'once' })]), null, { manager: runner.manager });
    const once = await readLines(runner, kind, versionId, 'planned');
    assert.deepEqual([once[0].frequency, once[0].id === lines[0].id], ['once', false], `${kind}: rewritten`);
    assert.deepEqual(await readMeasure(runner, kind, versionId, 'planned', YEAR), [...repeat('83.33', 11), '83.37'], `${kind}: 1 000 once, split`);

    // The order is part of the lines: swapping two lines rewrites them.
    await svc.bulkUpsert(versionId, linesPayload([licenceLine(), sfrLine(calendarId)]), null, { manager: runner.manager });
    await svc.bulkUpsert(versionId, linesPayload([sfrLine(calendarId), licenceLine()]), null, { manager: runner.manager });
    assert.deepEqual((await readLines(runner, kind, versionId, 'planned')).map((l) => l.label), ['Consultant', 'Licences']);
  });
}

/** `also_measures`: the same lines on other columns, in one write; unknown columns refused. */
async function testAlsoMeasures(kind: Kind) {
  await withCalendarLine(kind, async ({ runner, versionId, calendarId }) => {
    const svc = amountsService(kind);
    const response = await svc.bulkUpsert(
      versionId,
      linesPayload([sfrLine(calendarId)], { measure: 'forecast', also_measures: ['planned', 'forecast', 'expected_landing'] }),
      null,
      { manager: runner.manager },
    );
    for (const measure of ['planned', 'forecast', 'expected_landing'] as const) {
      assert.deepEqual(await readMeasure(runner, kind, versionId, measure, YEAR), CONSULTANT_MONTHS, `${kind}: ${measure} written`);
      assert.deepEqual(shape(await readLines(runner, kind, versionId, measure)).map((l) => l[1]), ['Consultant'], `${kind}: ${measure} lines`);
    }
    assert.deepEqual(await readMeasure(runner, kind, versionId, 'actual', YEAR), repeat('0.00', 12), `${kind}: the others untouched`);
    assert.deepEqual(response.round_inputs.map((r: any) => [r.measure, r.method, r.fte]), [
      ['planned', 'computed', '0.75'], ['forecast', 'computed', '0.75'], ['expected_landing', 'computed', '0.75'],
    ], `${kind}: each column, in column order`);
    await assert.rejects(
      () => svc.bulkUpsert(versionId, linesPayload([sfrLine(calendarId)], { also_measures: ['budget'] }), null, { manager: runner.manager }),
      (err: any) => err instanceof BadRequestException && /^Unknown amount 'budget'\./.test(err.message),
    );
    await assert.rejects(
      () => svc.bulkUpsert(versionId, linesPayload([sfrLine(calendarId)], { also_measures: 'forecast' }), null, { manager: runner.manager }),
      (err: any) => err instanceof BadRequestException && err.message === 'also_measures must be a list of columns.',
    );
  });
}

/**
 * `[]` removes the lines: the amounts stay, the FTE becomes unknown, a column
 * computed from them reads as edited by hand; another method stays.
 */
async function testEmptyLines(kind: Kind) {
  await withCalendarLine(kind, async ({ runner, tenantId, versionId, calendarId }) => {
    const audit = captureAudit();
    const svc = amountsService(kind, audit);
    const nothing = await svc.bulkUpsert(versionId, linesPayload([]), null, { manager: runner.manager });
    assert.deepEqual([nothing.updated, nothing.round_inputs, nothing.warnings], [0, [], []], `${kind}: no lines, no record: nothing written`);

    await svc.bulkUpsert(versionId, linesPayload([sfrLine(calendarId)], { also_measures: ['forecast'] }), null, { manager: runner.manager });
    // Forecast is spread over afterwards: its lines stay as a reference.
    await svc.bulkUpsert(versionId, { kind: 'annual', year: YEAR, totals: { forecast: 1200 } }, null, { manager: runner.manager });
    const amountAudits = audit.entries.filter((e) => e.table === amountsTable(kind)).length;

    const removed = await svc.bulkUpsert(versionId, linesPayload([], { also_measures: ['forecast'] }), null, { manager: runner.manager });
    assert.equal(removed.updated, 0, `${kind}: no month written`);
    assert.equal(audit.entries.filter((e) => e.table === amountsTable(kind)).length, amountAudits, `${kind}: no amounts audit`);
    const { planned, forecast } = await readRecords(runner, kind, versionId);
    assert.deepEqual([planned.method, planned.fte, planned.last_calculation], ['manual', null, null], `${kind}: computed becomes manual`);
    assert.deepEqual([planned.period_start, planned.period_end], [`${YEAR}-02-01`, `${YEAR}-10-31`], `${kind}: the period stays, the whole months of the lines`);
    assert.deepEqual([forecast.method, forecast.fte, forecast.last_calculation.kind], ['spread', null, 'annual'], `${kind}: a spread stays a spread`);
    assert.deepEqual(await readMeasure(runner, kind, versionId, 'planned', YEAR), CONSULTANT_MONTHS, `${kind}: the amounts stay`);
    assert.equal(await countLines(runner, kind, tenantId), 0, `${kind}: the lines are gone`);
    assert.deepEqual(removed.round_inputs.map((r: any) => r.lines), [[], []]);
  });
}

/** A frozen column refuses the write, `also_measures` and `[]` included; nothing is written. */
async function testLinesRespectFreeze(kind: Kind) {
  await withCalendarLine(kind, async ({ runner, tenantId, versionId, calendarId }) => {
    await amountsService(kind).bulkUpsert(versionId, linesPayload([sfrLine(calendarId)], { measure: 'actual' }), null, { manager: runner.manager });
    await freezeColumn(runner, kind, tenantId, YEAR, 'budget');
    const svc = amountsService(kind, captureAudit(), realFreeze());
    for (const payload of [
      linesPayload([sfrLine(calendarId)]),
      linesPayload([sfrLine(calendarId)], { measure: 'forecast', also_measures: ['planned'] }),
      linesPayload([], { measure: 'actual', also_measures: ['planned'] }),
    ]) {
      await assert.rejects(
        () => svc.bulkUpsert(versionId, payload, null, { manager: runner.manager }),
        (err: any) => err instanceof ForbiddenException && /is frozen/.test(err.message),
        `${kind}: ${payload.measure} ${JSON.stringify((payload as Record<string, unknown>).also_measures ?? [])}`,
      );
    }
    assert.deepEqual(await readMeasure(runner, kind, versionId, 'planned', YEAR), repeat('0.00', 12), `${kind}: no month written`);
    assert.deepEqual(await readMeasure(runner, kind, versionId, 'forecast', YEAR), repeat('0.00', 12), `${kind}: nor on the other column`);
    assert.deepEqual(Object.keys(await readRecords(runner, kind, versionId)), ['actual'], `${kind}: no record written`);
    assert.equal((await readLines(runner, kind, versionId, 'actual')).length, 1, `${kind}: the lines of the refused [] stay`);
  });
}

/** Refusals are readable 400s naming the line, and write nothing. */
async function testLinesRefusals(kind: Kind) {
  await withCalendarLine(kind, async ({ runner, tenantId, versionId, calendarId }) => {
    const svc = amountsService(kind);
    const refused = async (payload: Record<string, unknown>, message: string | RegExp) => {
      await assert.rejects(
        () => svc.bulkUpsert(versionId, payload, null, { manager: runner.manager }),
        (err: any) => err instanceof BadRequestException && (typeof message === 'string' ? err.message === message : message.test(err.message)),
        `${kind}: ${String(message)}`,
      );
    };
    const second = (overrides: Record<string, unknown>) => linesPayload([licenceLine(), sfrLine(calendarId, overrides)]);
    await refused(second({ quantity: '1.0001' }), 'Line 2: quantity accepts at most 3 decimals.');
    await refused(second({ quantity: '-1' }), 'Line 2: quantity cannot be negative.');
    await refused(second({ unit_price: '400.00001' }), 'Line 2: unit price accepts at most 4 decimals.');
    await refused(second({ working_day_profile_id: null }), 'Line 2: choose a calendar for a price per day.');
    await refused(second({ price_basis: 'per_month' }), 'Line 2: a calendar is used only with a price per day.');
    await refused(second({ price_basis: 'per_piece', working_day_profile_id: null }), 'Line 2: a price for people is per day or per month.');
    await refused(second({ price_basis: 'once', working_day_profile_id: null }), "Line 2: unknown price basis 'once'. Use per_day, per_month or per_piece.");
    await refused(second({ quantity_unit: 'units' }), "Line 2: unknown unit 'units'. Use days, people or pieces.");
    await refused(second({ quantity_unit: 'days' }), 'Line 2: days are counted once over their period.');
    await refused(second({ frequency: 'once' }), 'Line 2: people are counted per month.');
    await refused(second({ price_basis: 'per_month', frequency: 'once', working_day_profile_id: null }), 'Line 2: a price per month applies per month.');
    await refused(linesPayload([sfrLine(calendarId), licenceLine({ frequency: null })]), 'Line 2: choose how often: per month or once.');
    await refused(linesPayload([sfrLine(calendarId), licenceLine({ price_basis: 'per_month' })]), 'Line 2: a price for pieces is per piece.');
    await refused(second({ days_per_month: '' }), 'Line 2: enter the days per month, or tick Full time.');
    await refused(second({ days_per_month: '32' }), 'Line 2: days per month must be more than 0 and at most 31.');
    await refused(second({ days_per_month: '4.0005' }), 'Line 2: days per month accepts at most 3 decimals.');
    await refused(linesPayload([sfrLine(calendarId), licenceLine({ days_per_month: 5 })]), 'Line 2: days per month apply to people priced per day.');
    await refused(second({ working_day_profile_id: '6f1c1b1e-0000-4000-8000-000000000000' }), 'Line 2: the calendar was not found.');
    await refused(second({ working_day_profile_id: 'not-a-uuid' }), 'Line 2: the calendar was not found.');
    await refused(second({ period_start: `${YEAR}-02-16`, period_end: `${YEAR}-03-14` }), /^Line 2: no month of the period counts/);
    await refused(second({ period_end: `${YEAR + 1}-01-31` }), `Line 2: the period must lie within ${YEAR}; its end is ${YEAR + 1}-01-31.`);
    await refused(linesPayload(repeat(licenceLine(), 51)), 'A column holds at most 50 lines.');
    await refused(linesPayload(null as any), 'Send the lines as a list.');
    await refused(linesPayload([sfrLine(calendarId)], { measure: 'budget' }), /^Unknown amount 'budget'\./);
    await refused(linesPayload([sfrLine(calendarId)], { year: YEAR + 1 }), `The year ${YEAR + 1} does not match this version's year ${YEAR}.`);
    await refused(
      linesPayload([sfrLine(calendarId, { period_start: `${YEAR}-01-01`, period_end: `${YEAR}-01-31` }), licenceLine({ quantity: '999999999', unit_price: '99999999999999' })]),
      'Line 2: the computed amount is too large.',
    );
    // A calendar without the year of the version.
    const later = await seedCalendar(runner, tenantId, { code: 'LATER', name: 'Later calendar', days_by_year: { [YEAR + 1]: FRANCE_218_2026 } });
    await refused(second({ working_day_profile_id: later }), `Line 2: Later calendar has no working days for ${YEAR}. Add them on the Working-day calendars page.`);
    assert.deepEqual(await readMeasure(runner, kind, versionId, 'planned', YEAR), repeat('0.00', 12), `${kind}: nothing written`);
    assert.deepEqual(Object.keys(await readRecords(runner, kind, versionId)), [], `${kind}: no record written`);
    assert.equal(await countLines(runner, kind, tenantId), 0, `${kind}: no line written`);
  });
}

/** A disabled calendar cannot be newly used; the columns whose lines use it keep working, with a warning. */
async function testDisabledCalendar(kind: Kind) {
  await withCalendarLine(kind, async ({ runner, tenantId, versionId, calendarId }) => {
    const svc = amountsService(kind);
    const retired = await seedCalendar(runner, tenantId, { code: 'OLD', name: 'Old calendar', days_by_year: { [YEAR]: FRANCE_218_2026 }, status: 'disabled' });
    await assert.rejects(
      () => svc.bulkUpsert(versionId, linesPayload([sfrLine(retired)]), null, { manager: runner.manager }),
      (err: any) => err instanceof BadRequestException && err.message === 'Line 1: Old calendar is disabled. Pick an enabled calendar.',
    );
    assert.deepEqual(Object.keys(await readRecords(runner, kind, versionId)), [], `${kind}: nothing written`);

    await svc.bulkUpsert(versionId, linesPayload([sfrLine(calendarId)]), null, { manager: runner.manager });
    await runner.query(`UPDATE working_day_profiles SET status = 'disabled', disabled_at = '2020-01-01T12:00:00Z' WHERE id = $1`, [calendarId]);
    const kept = await svc.bulkUpsert(versionId, linesPayload([sfrLine(calendarId, { quantity: '2' })]), null, { manager: runner.manager });
    assert.deepEqual(kept.warnings, [DISABLED_CALENDAR_WARNING], `${kind}: the column that uses it computes, with a warning`);
    assert.equal((await readMeasure(runner, kind, versionId, 'planned', YEAR))[1], '14400.00');
    // Another column, alone or with the first, did not use it: refused.
    for (const payload of [linesPayload([sfrLine(calendarId)], { measure: 'committed' }), linesPayload([sfrLine(calendarId)], { also_measures: ['committed'] })]) {
      await assert.rejects(
        () => svc.bulkUpsert(versionId, payload, null, { manager: runner.manager }),
        (err: any) => err instanceof BadRequestException && err.message === 'Line 1: France 218 is disabled. Pick an enabled calendar.',
      );
    }
  });
}

/** Tenant B cannot use tenant A's calendar, nor write into A's version; the composite keys refuse it in raw SQL too. */
async function testOtherTenant(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantA = await seedTenant(runner, `${kind}-lines-a`);
    const calendarA = await seedCalendar(runner, tenantA, { code: 'FR218', name: 'France 218', days_by_year: { [YEAR]: FRANCE_218_2026 } });
    const lineA = await seedLine(runner, kind, tenantA, YEAR);
    await amountsService(kind).bulkUpsert(lineA.versionId, linesPayload([sfrLine(calendarA)]), null, { manager: runner.manager });
    const [roundA] = await runner.query(`SELECT id FROM ${TABLES[kind].rounds} WHERE version_id = $1`, [lineA.versionId]);

    const tenantB = await seedTenant(runner, `${kind}-lines-b`);
    await setTenant(runner, tenantB);
    const { versionId } = await seedLine(runner, kind, tenantB, YEAR);
    const svc = amountsService(kind);
    await assert.rejects(
      () => svc.bulkUpsert(versionId, linesPayload([sfrLine(calendarA)]), null, { manager: runner.manager }),
      (err: any) => err instanceof BadRequestException && err.message === 'Line 1: the calendar was not found.',
    );
    await assert.rejects(
      () => svc.bulkUpsert(lineA.versionId, linesPayload([licenceLine()]), null, { manager: runner.manager }),
      (err: any) => err instanceof NotFoundException,
      `${kind}: A's version is not found for B`,
    );
    assert.deepEqual(await readMeasure(runner, kind, versionId, 'planned', YEAR), repeat('0.00', 12), `${kind}: no month written`);
    assert.deepEqual(Object.keys(await readRecords(runner, kind, versionId)), [], `${kind}: no record written`);
    assert.equal(await countLines(runner, kind, tenantB), 0);

    // Raw SQL from B's session: a line on A's round, or on B's round with A's calendar, fails the composite keys.
    await svc.bulkUpsert(versionId, linesPayload([licenceLine()]), null, { manager: runner.manager });
    const [roundB] = await runner.query(`SELECT id FROM ${TABLES[kind].rounds} WHERE version_id = $1`, [versionId]);
    const insertLine = (roundId: string, calendarId: string | null) => runner.query(
      `INSERT INTO ${TABLES[kind].lines}
         (tenant_id, round_input_id, sort, quantity_unit, quantity, unit_price, price_basis, frequency, working_day_profile_id, period_start, period_end)
       VALUES ($1, $2, 9, 'people', 1, 400, $3, 'per_month', $4, '${YEAR}-01-01', '${YEAR}-12-31')`,
      [tenantB, roundId, calendarId ? 'per_day' : 'per_month', calendarId],
    );
    for (const [roundId, calendarId, constraint] of [
      [roundA.id, null, 'round_input_fk'],
      [roundB.id, calendarA, 'working_day_profile_fk'],
    ] as const) {
      await runner.query('SAVEPOINT raw');
      await assert.rejects(() => insertLine(roundId, calendarId), new RegExp(`${TABLES[kind].lines}_${constraint}`));
      await runner.query('ROLLBACK TO SAVEPOINT raw');
    }
    await setTenant(runner, tenantA);
    assert.equal((await readLines(runner, kind, lineA.versionId, 'planned')).length, 1, `${kind}: A's lines as they were`);
  });
}

/** A hand edit, a spread (yearly, quarterly) keep the lines and the FTE; sending the lines again computes again. */
async function testOtherWritesKeepLines(kind: Kind) {
  await withCalendarLine(kind, async ({ runner, tenantId, versionId, calendarId }) => {
    const svc = amountsService(kind);
    await svc.bulkUpsert(versionId, linesPayload([sfrLine(calendarId), licenceLine()]), null, { manager: runner.manager });
    const computed = (await readRecords(runner, kind, versionId)).planned;
    const linesOf = async () => (await readLines(runner, kind, versionId, 'planned')).map((l) => l.id);
    const ids = await linesOf();

    await svc.bulkUpsert(versionId, { kind: 'monthly', year: YEAR, months: [{ period: period(3, YEAR), planned: 1 }] }, null, { manager: runner.manager });
    const manual = (await readRecords(runner, kind, versionId)).planned;
    assert.deepEqual([manual.method, manual.fte, manual.period_start, manual.period_end], ['manual', '0.75', computed.period_start, computed.period_end]);
    assert.deepEqual(manual.last_calculation, computed.last_calculation, `${kind}: the explanation stays`);
    assert.deepEqual(await linesOf(), ids, `${kind}: the lines stay after a hand edit`);

    await svc.bulkUpsert(versionId, { kind: 'annual', year: YEAR, totals: { planned: 1200 }, period_start: `${YEAR}-01-01`, period_end: `${YEAR}-06-30` }, null, { manager: runner.manager });
    const spread = (await readRecords(runner, kind, versionId)).planned;
    assert.deepEqual([spread.method, spread.last_calculation.kind, spread.fte], ['spread', 'annual', '0.75']);
    assert.deepEqual(await linesOf(), ids, `${kind}: the lines stay after a spread`);

    await svc.bulkUpsert(versionId, { kind: 'quarterly', year: YEAR, measure: 'planned', Q1: 30 }, null, { manager: runner.manager });
    assert.deepEqual(await linesOf(), ids, `${kind}: the lines stay after a quarterly edit`);
    const listed = await svc.listByYear(versionId, YEAR, { manager: runner.manager });
    assert.deepEqual(listed.round_inputs[0].lines.map((l: any) => l.label), ['Consultant', 'Licences'], `${kind}: returned as the reference`);

    // "Use the lines again": the same lines, sent again, compute the column again.
    await svc.bulkUpsert(versionId, linesPayload([sfrLine(calendarId), licenceLine()]), null, { manager: runner.manager });
    assert.deepEqual(await readMeasure(runner, kind, versionId, 'planned', YEAR), CONSULTANT_MONTHS.map((m) => (Number(m) + 2000).toFixed(2)));
    const again = (await readRecords(runner, kind, versionId)).planned;
    assert.deepEqual([again.method, again.last_calculation.kind], ['computed', 'computed']);
    assert.deepEqual(await linesOf(), ids, `${kind}: the same lines are not rewritten`);
  });
}

/**
 * A copy of a column that follows its lines copies the lines (periods
 * shifted, 29 February to 28 February, cut to the item's validity, how often
 * and the days per month kept), raises their unit prices and computes the
 * column again; a source without lines leaves none; clear deletes them.
 */
async function testCopyAndClear(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `${kind}-copy-lines`);
    const days = { 2028: FRANCE_218_2026, 2029: FRANCE_218_2026 };
    const calendarId = await seedCalendar(runner, tenantId, { code: 'FR218', name: 'France 218', days_by_year: days });
    const { itemId, versionId } = await seedLine(runner, kind, tenantId, 2028);
    const svc = amountsService(kind);
    // 2028 is a leap year: a line ends on 29 February, a laptop is bought on it.
    await svc.bulkUpsert(versionId, {
      kind: 'lines', year: 2028, measure: 'planned',
      lines: [
        sfrLine(calendarId, { days_per_month: '5', period_start: '2028-02-01', period_end: '2028-10-30' }),
        licenceLine({ label: 'Winter licences', period_start: '2028-01-01', period_end: '2028-02-29' }),
        licenceLine({ label: 'Laptop', quantity: 1, unit_price: '2000', frequency: 'once', period_start: '2028-02-29', period_end: '2028-02-29' }),
      ],
    }, null, { manager: runner.manager });
    const source = (await readRecords(runner, kind, versionId)).planned;
    // The item ends mid-2029: the lines are cut to the validity.
    await setItemDates(runner, kind, itemId, { disabledAt: '2029-06-30T12:00:00Z' });

    await budgetOperations(kind).copyBudgetColumn(
      { sourceYear: 2028, sourceColumn: 'budget', destinationYear: 2029, destinationColumn: 'budget', percentageIncrease: '5', overwrite: false, dryRun: false },
      null,
      { manager: runner.manager },
    );
    const destination = (await findVersion(runner, kind, itemId, 2029))!;
    const copied = (await readRecords(runner, kind, destination.id)).planned;
    assert.equal(source.fte, '0.21', `${kind}: 5 days a month ÷ France 218, February to October, ÷ 12`);
    // Consultant 5 days × 420 = 2 100 a month, February to June; licences 10 × 210 in January and February; the laptop 2 100 in February.
    assert.deepEqual(
      [copied.method, copied.period_start, copied.period_end, copied.fte, copied.last_calculation.kind, copied.last_calculation.total],
      ['computed', '2029-01-01', '2029-06-30', '0.11', 'computed', '16800.00'],
      `${kind}: computed again from the raised lines, FTE from them`,
    );
    assert.deepEqual(
      await readMeasure(runner, kind, destination.id, 'planned', 2029),
      ['2100.00', '6300.00', ...repeat('2100.00', 4), ...repeat('0.00', 6)],
    );
    assert.deepEqual(
      (await readLines(runner, kind, destination.id, 'planned')).map((l) => [
        l.label, l.quantity, l.unit_price, l.frequency, l.days_per_month, l.working_day_profile_id, l.period_start, l.period_end,
      ]),
      [
        ['Consultant', '1.000', '420.0000', 'per_month', '5.000', calendarId, '2029-02-01', '2029-06-30'],
        ['Winter licences', '10.000', '210.0000', 'per_month', null, null, '2029-01-01', '2029-02-28'],
        ['Laptop', '1.000', '2100.0000', 'once', null, null, '2029-02-28', '2029-02-28'],
      ],
      `${kind}: the lines shifted a year and cut to the validity, prices +5 %, quantity, how often and days per month as they are, 29 February to 28 February`,
    );

    // A source without lines leaves the destination without lines and without FTE.
    await svc.bulkUpsert(versionId, { kind: 'monthly', year: 2028, months: [{ period: period(1, 2028), committed: 5 }] }, null, { manager: runner.manager });
    await budgetOperations(kind).copyBudgetColumn(
      { sourceYear: 2028, sourceColumn: 'revision', destinationYear: 2029, destinationColumn: 'budget', percentageIncrease: 0, overwrite: true, dryRun: false },
      null,
      { manager: runner.manager },
    );
    const overwritten = (await readRecords(runner, kind, destination.id)).planned;
    assert.deepEqual([overwritten.method, overwritten.fte, overwritten.last_calculation.source_method], ['copied', null, 'manual']);
    assert.deepEqual(await readLines(runner, kind, destination.id, 'planned'), [], `${kind}: the destination loses its lines`);

    // Clear deletes the record and its lines; the calendar is free again.
    await budgetOperations(kind).clearBudgetColumn({ year: 2028, column: 'budget' }, null, { manager: runner.manager });
    assert.equal((await readRecords(runner, kind, versionId)).planned, undefined, `${kind}: the record is deleted`);
    assert.equal(await countLines(runner, kind, tenantId), 0, `${kind}: its lines with it`);
    const [gone] = await runner.query(`DELETE FROM working_day_profiles WHERE tenant_id = $1 AND id = $2 RETURNING id`, [tenantId, calendarId]);
    assert.equal(gone.length, 1);
  });
}

/**
 * A piece bought once on a date before the 15th (Budget) or after it
 * (Revision): the line keeps its date, the record covers the whole month, so
 * the budget file re-imports it unchanged and a copy shifts it a year.
 */
async function testOneDateLineCoversItsMonth(kind: Kind) {
  await withCalendarLine(kind, async ({ runner, tenantId, versionId, itemId }) => {
    const svc = amountsService(kind);
    const piece = (date: string) => licenceLine({ label: 'Laptop', quantity: 1, unit_price: '2000', frequency: 'once', period_start: date, period_end: date });
    for (const [measure, date] of [['planned', `${YEAR}-03-01`], ['forecast', `${YEAR}-03-20`]] as const) {
      await svc.bulkUpsert(versionId, linesPayload([piece(date)], { measure }), null, { manager: runner.manager });
      const record = (await readRecords(runner, kind, versionId))[measure];
      assert.deepEqual(
        [record.method, record.period_start, record.period_end, record.last_calculation.active_months],
        ['computed', `${YEAR}-03-01`, `${YEAR}-03-31`, [3]],
        `${kind} ${measure}: the record covers March`,
      );
      assert.deepEqual(
        (await readLines(runner, kind, versionId, measure)).map((l) => [l.period_start, l.period_end]),
        [[date, date]],
        `${kind} ${measure}: the line keeps its date`,
      );
    }
    const before = await readRecords(runner, kind, versionId);

    // The budget file of both columns, yearly and month by month, reads back and loads unchanged.
    for (const detail of ['yearly', 'months'] as const) {
      const content = await exportBudgetFile(runner.manager, kind, tenantId, [itemId], { amountYears: String(YEAR), columns: 'budget,forecast', detail });
      const report = await preflightBudgetFile(runner.manager, kind, tenantId, content);
      assert.deepEqual([report.ok, report.changes.unchanged, report.changes.updated], [true, 1, 0], `${kind} ${detail}: the export reads back unchanged`);
      const loaded = await loadBudgetFile(runner.manager, kind, tenantId, content);
      assert.deepEqual([(loaded as any).inserted, (loaded as any).updated], [0, 0], `${kind} ${detail}: the export loads unchanged`);
    }
    const after = await readRecords(runner, kind, versionId);
    for (const measure of ['planned', 'forecast'] as const) {
      assert.equal(after[measure].updated_at.getTime(), before[measure].updated_at.getTime(), `${kind} ${measure}: record untouched`);
      assert.equal(after[measure].method, 'computed', `${kind} ${measure}: still computed`);
    }

    await budgetOperations(kind).copyBudgetColumn(
      { sourceYear: YEAR, sourceColumn: 'budget', destinationYear: YEAR + 1, destinationColumn: 'budget', percentageIncrease: 0, overwrite: false, dryRun: false },
      null,
      { manager: runner.manager },
    );
    const destination = (await findVersion(runner, kind, itemId, YEAR + 1))!;
    const copied = (await readRecords(runner, kind, destination.id)).planned;
    assert.deepEqual(
      [copied.method, copied.period_start, copied.period_end],
      ['computed', `${YEAR + 1}-03-01`, `${YEAR + 1}-03-31`],
      `${kind}: the copy shifts the month a year`,
    );
    assert.deepEqual(
      (await readLines(runner, kind, destination.id, 'planned')).map((l) => [l.period_start, l.period_end]),
      [[`${YEAR + 1}-03-01`, `${YEAR + 1}-03-01`]],
      `${kind}: the copied line keeps one date`,
    );
  });
}

/**
 * The lines write takes its calendars FOR KEY SHARE when it reads them,
 * before the months and the records, so a delete (FOR UPDATE) cannot count
 * zero lines in between. The writer is held between the two (another
 * transaction holds the line's months) while the delete's lock is tried.
 */
async function testLinesWriteLocksItsCalendar() {
  const seed = dataSource.createQueryRunner();
  await seed.connect();
  await seed.startTransaction();
  const tenantId = await seedTenant(seed, 'lines-lock');
  const calendarId = await seedCalendar(seed, tenantId, { code: 'FR218', name: 'France 218', days_by_year: { [YEAR]: FRANCE_218_2026 } });
  const { versionId } = await seedLine(seed, 'opex', tenantId, YEAR, { committed: repeat('1', 12) });
  await seed.commitTransaction();
  await seed.release();

  const open = async () => {
    const runner = dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    await setTenant(runner, tenantId);
    return runner;
  };
  const holder = await open();
  const writer = await open();
  const deleter = await open();
  // The delete's lock, tried without waiting; always rolled back, so the probe never holds it.
  const tryLock = async () => {
    await deleter.query('SAVEPOINT try_lock');
    try {
      await deleter.query(`SELECT id FROM working_day_profiles WHERE tenant_id = $1 AND id = $2 FOR UPDATE NOWAIT`, [tenantId, calendarId]);
      return 'free';
    } catch (err: any) {
      if (err?.code === '55P03' || err?.driverError?.code === '55P03') return 'held';
      throw err;
    } finally {
      await deleter.query('ROLLBACK TO SAVEPOINT try_lock');
    }
  };
  let write: Promise<unknown> | null = null;
  try {
    assert.equal(await tryLock(), 'free');
    await holder.query(`SELECT id FROM spend_amounts WHERE tenant_id = $1 AND version_id = $2 FOR UPDATE`, [tenantId, versionId]);
    const [{ pid }] = await writer.query(`SELECT pg_backend_pid() AS pid`);
    write = amountsService('opex').bulkUpsert(versionId, linesPayload([sfrLine(calendarId)]), null, { manager: writer.manager });
    write.catch(() => undefined);
    const deadline = Date.now() + 5000;
    for (;;) {
      const [row] = await dataSource.query(`SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1`, [pid]);
      if (row?.wait_event_type === 'Lock') break;
      if (Date.now() > deadline) throw new Error('the lines write never waited for the months');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(await tryLock(), 'held', 'read, not yet written: the calendar is already held');
    await holder.rollbackTransaction();
    await write;
    assert.equal((await readRecords(writer, 'opex', versionId)).planned.method, 'computed');
    await writer.rollbackTransaction();
    assert.equal(await tryLock(), 'free', 'released with the transaction');
  } finally {
    for (const runner of [holder, writer, deleter]) {
      if (runner.isTransactionActive) await runner.rollbackTransaction().catch(() => undefined);
    }
    await write?.catch(() => undefined);
    for (const runner of [holder, writer, deleter]) await runner.release();
    await dataSource.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
      for (const table of ['spend_round_inputs', 'spend_amounts', 'spend_versions', 'spend_items', 'working_day_profiles']) {
        await manager.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
      }
    });
    await dataSource.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  }
}

/** The lines go through bulk-upsert (member); no preview route is left. */
async function testRoutes() {
  assert.deepEqual(Reflect.getMetadata(REQUIRE_LEVEL_KEY, SpendVersionsController.prototype.upsertAmounts), { resource: 'opex', level: 'member' });
  assert.deepEqual(Reflect.getMetadata(REQUIRE_LEVEL_KEY, CapexVersionsController.prototype.upsertAmounts), { resource: 'capex', level: 'member' });
  for (const controller of [SpendVersionsController, CapexVersionsController]) {
    const paths = Object.getOwnPropertyNames(controller.prototype).map((name) => Reflect.getMetadata('path', (controller.prototype as any)[name]));
    assert.equal(paths.some((path) => typeof path === 'string' && path.includes('preview')), false, `${controller.name}: no preview route`);
  }
}

void runSpecs('costing-round.integration.spec', [
  ['testRoutes', testRoutes],
  ['testLinesWriteLocksItsCalendar', testLinesWriteLocksItsCalendar],
  ...KINDS.flatMap((kind) => [
    [`testLinesWrite(${kind})`, () => testLinesWrite(kind)],
    [`testDaysLine(${kind})`, () => testDaysLine(kind)],
    [`testFriedLines(${kind})`, () => testFriedLines(kind)],
    [`testWholesaleReplacement(${kind})`, () => testWholesaleReplacement(kind)],
    [`testAlsoMeasures(${kind})`, () => testAlsoMeasures(kind)],
    [`testEmptyLines(${kind})`, () => testEmptyLines(kind)],
    [`testLinesRespectFreeze(${kind})`, () => testLinesRespectFreeze(kind)],
    [`testLinesRefusals(${kind})`, () => testLinesRefusals(kind)],
    [`testDisabledCalendar(${kind})`, () => testDisabledCalendar(kind)],
    [`testOtherTenant(${kind})`, () => testOtherTenant(kind)],
    [`testOtherWritesKeepLines(${kind})`, () => testOtherWritesKeepLines(kind)],
    [`testCopyAndClear(${kind})`, () => testCopyAndClear(kind)],
    [`testOneDateLineCoversItsMonth(${kind})`, () => testOneDateLineCoversItsMonth(kind)],
  ] as Array<[string, () => Promise<void>]>),
]);

// `dataSource` is imported so the CI runner schedules this spec on the database lane.
void dataSource;
