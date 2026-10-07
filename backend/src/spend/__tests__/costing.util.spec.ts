import * as assert from 'node:assert/strict';
import {
  computeColumn,
  computeLine,
  CostingInputError,
  CostLine,
  LineCalendar,
  parseCostLine,
  parseCostLines,
  sameLines,
} from '../costing.util';
import { generateWorkingDays } from '../../working-day-profiles/public-holidays';

// The computation of a column from its quantity × price lines, pure: people
// (full time, days per month, per month), days (a bundle over a period),
// pieces (per month, once on a date), the column's FTE over the year and
// over its months, limits and every refusal. Expected values were checked
// with an independent decimal calculation (half away from zero; the equal
// splits of a line bought once round each share toward zero).

const YEAR = 2026;
/** The standard France calendar of 2026 (public holidays), as a standard calendar computes it. */
const FRANCE_2026 = ['21', '20', '22', '21', '17', '22', '22', '21', '22', '22', '20', '22'];
const FRANCE_218_2026 = ['18', '18', '20', '20', '15', '20', '15', '16', '20', '19', '18', '19'];
const FRANCE = '00000000-0000-4000-8000-000000000003';
const FR218 = '00000000-0000-4000-8000-000000000001';
const FLAT20 = '00000000-0000-4000-8000-000000000002';
const CALENDARS = new Map<string, LineCalendar>([
  [FRANCE, { name: 'France', days: FRANCE_2026 }],
  [FR218, { name: 'France 218', days: FRANCE_218_2026 }],
  [FLAT20, { name: 'Twenty days', days: Array.from({ length: 12 }, () => '20') }],
]);

/** A person priced per day, full time, over the year on France 218, unless told otherwise. */
function line(overrides: Partial<CostLine> = {}): CostLine {
  return {
    label: '',
    quantity_unit: 'people',
    quantity: '1',
    unit_price: '400',
    price_basis: 'per_day',
    frequency: 'per_month',
    days_per_month: null,
    period_start: `${YEAR}-01-01`,
    period_end: `${YEAR}-12-31`,
    working_day_profile_id: FR218,
    ...overrides,
  };
}

const perMonth = (overrides: Partial<CostLine> = {}) => line({ price_basis: 'per_month', working_day_profile_id: null, ...overrides });
const pieces = (overrides: Partial<CostLine> = {}) => line({
  quantity_unit: 'pieces', price_basis: 'per_piece', frequency: 'once', working_day_profile_id: null, ...overrides,
});
const bundle = (overrides: Partial<CostLine> = {}) => line({ quantity_unit: 'days', frequency: 'once', ...overrides });

/** fried's project manager: 1 person at 1 200 a day, 5 days per month, February to July, on France. */
const projectManager = (overrides: Partial<CostLine> = {}) => line({
  label: 'Project manager', unit_price: '1200', days_per_month: '5',
  period_start: `${YEAR}-02-01`, period_end: `${YEAR}-07-31`, working_day_profile_id: FRANCE, ...overrides,
});

/** Cents as decimal strings, for readable expectations. */
const amounts = (cents: bigint[]) => cents.map((c) => (Number(c) / 100).toFixed(2));
const repeat = <T>(value: T, n: number): T[] => Array.from({ length: n }, () => value);
/** Twelve months: `values` from `first` (1..12), zero elsewhere. */
const months = (first: number, values: string[], zero = '0') => [...repeat(zero, first - 1), ...values, ...repeat(zero, 13 - first - values.length)];

function refused(fn: () => unknown, message: string, label?: string) {
  assert.throws(fn, (err: unknown) => err instanceof CostingInputError && err.message === message, label ?? message);
}

/** The France days used here are the standard calendar's. */
function testFranceCalendar() {
  assert.deepEqual(generateWorkingDays('FR', null, YEAR, 'en').days, FRANCE_2026);
}

/**
 * People priced per day, N days per month: N × quantity × unit price each
 * month; FTE = quantity × N ÷ the calendar's working days of the month.
 */
function testProjectManager() {
  const result = computeLine(projectManager(), YEAR, CALENDARS.get(FRANCE)!);
  assert.deepEqual(result.active_months, [2, 3, 4, 5, 6, 7]);
  assert.deepEqual(amounts(result.month_cents), months(2, repeat('6000.00', 6), '0.00'), '5 × 1 × 1 200 each month');
  assert.equal(result.total_cents, 3_600_000n);
  assert.deepEqual(
    result.fte_months,
    months(2, ['0.25', '0.227273', '0.238095', '0.294118', '0.227273', '0.227273']),
    '5 ÷ 20, 22, 21, 17, 22, 22 working days',
  );
  assert.deepEqual([result.day_counts, result.total_days], [FRANCE_2026, '124'], 'the calendar as used; its days over the period');
  assert.deepEqual([result.fte, result.fte_period], ['0.12', '0.24'], '1.464032 ÷ 12 and ÷ 6');
  const column = computeColumn([projectManager()], YEAR, CALENDARS);
  assert.deepEqual([column.fte, column.fte_period], ['0.12', '0.24']);

  // Two people 2.5 days a month: quantity × N = 5 days, the same FTE; 2.5 × 2 × 1 200 = 6 000.
  const pair = computeLine(projectManager({ quantity: '2', days_per_month: '2.5' }), YEAR, CALENDARS.get(FRANCE)!);
  assert.deepEqual([amounts(pair.month_cents)[1], pair.fte_months[1], pair.fte_period], ['6000.00', '0.25', '0.24']);
  // More days than the month holds counts above the quantity; a month without a working day counts 0 and still costs.
  const busy = computeLine(
    line({ days_per_month: '20', period_start: `${YEAR}-05-01`, period_end: `${YEAR}-06-30`, working_day_profile_id: FRANCE }),
    YEAR,
    { name: 'Closed in June', days: [...repeat('20', 4), '17', '0', ...repeat('20', 6)] },
  );
  assert.deepEqual(busy.fte_months.slice(4, 6), ['1.176471', '0'], '20 ÷ 17, then 0');
  assert.deepEqual(amounts(busy.month_cents).slice(4, 6), ['8000.00', '8000.00'], '20 × 400 whatever the calendar');
}

/** People priced per day, full time (the reference consultant): the calendar's days × quantity × unit price; FTE the quantity. */
function testFullTime() {
  const consultant = line({ label: 'Consultant', period_start: `${YEAR}-02-01`, period_end: `${YEAR}-10-30` });
  const result = computeLine(consultant, YEAR, CALENDARS.get(FR218)!);
  assert.deepEqual(result.active_months, [2, 3, 4, 5, 6, 7, 8, 9, 10], 'nine active months (the 30th still covers October 15)');
  assert.deepEqual(result.day_counts, FRANCE_218_2026, 'the calendar values of the year, as used');
  assert.equal(result.total_days, '163');
  assert.deepEqual(amounts(result.month_cents), [
    '0.00', '7200.00', '8000.00', '8000.00', '6000.00', '8000.00', '6000.00', '6400.00', '8000.00', '7600.00', '0.00', '0.00',
  ]);
  assert.equal(result.total_cents, 6_520_000n, '65 200');
  assert.deepEqual(result.fte_months, ['0', ...repeat('1', 9), '0', '0'], 'the quantity in each active month');
  const column = computeColumn([consultant], YEAR, CALENDARS);
  assert.deepEqual([column.fte, column.fte_period], ['0.75', '1'], '9 ÷ 12 over the year, 9 ÷ 9 over the period');
  // Fractional people and days: 1.5 × 19.083333 × 612.5 = 17 532.81 (6-decimal days, exact product).
  const fractional = computeLine(line({ quantity: '1.5', unit_price: '612.5', period_start: `${YEAR}-01-01`, period_end: `${YEAR}-01-31` }), YEAR, {
    name: 'Fractional', days: repeat('19.083333', 12),
  });
  assert.deepEqual([amounts(fractional.month_cents)[0], fractional.total_days, fractional.fte_months[0]], ['17532.81', '19.083333', '1.5']);
}

/** People priced per month: quantity × unit price in each active month; FTE the quantity. */
function testPersonPerMonth() {
  const result = computeLine(perMonth({ unit_price: '8000' }), YEAR, null);
  assert.deepEqual(amounts(result.month_cents), repeat('8000.00', 12));
  assert.equal(result.total_cents, 9_600_000n);
  assert.deepEqual([result.day_counts, result.total_days], [null, null]);
  assert.deepEqual([result.fte_months, result.fte, result.fte_period], [repeat('1', 12), '1', '1']);
  const half = computeLine(perMonth({ quantity: '1.5', unit_price: '5000', period_end: `${YEAR}-06-30` }), YEAR, null);
  assert.deepEqual(amounts(half.month_cents), [...repeat('7500.00', 6), ...repeat('0.00', 6)]);
  assert.deepEqual([half.fte_months, half.fte, half.fte_period], [[...repeat('1.5', 6), ...repeat('0', 6)], '0.75', '1.5']);
}

/** Days are a bundle over their period: the price rounded once and split equally; the days split alike, each share ÷ the month's days. */
function testBundle() {
  const result = computeLine(bundle({ label: 'Bundle', quantity: '30', unit_price: '1200', period_start: `${YEAR}-02-01`, period_end: `${YEAR}-07-31`, working_day_profile_id: FRANCE }), YEAR, CALENDARS.get(FRANCE)!);
  assert.deepEqual(amounts(result.month_cents), months(2, repeat('6000.00', 6), '0.00'), '36 000 over six months');
  assert.equal(result.total_cents, 3_600_000n);
  assert.deepEqual(result.fte_months, months(2, ['0.25', '0.227273', '0.238095', '0.294118', '0.227273', '0.227273']), '5 days a month ÷ the working days');
  assert.deepEqual([result.fte, result.fte_period, result.total_days], ['0.12', '0.24', '124']);

  // Remainders: 10 × 100.01 = 1 000.10 over three months, 10 days over three months.
  const split = computeLine(
    bundle({ quantity: '10', unit_price: '100.01', period_end: `${YEAR}-03-31`, working_day_profile_id: FLAT20 }),
    YEAR,
    CALENDARS.get(FLAT20)!,
  );
  // 333.366… rounds toward zero to 333.36; the last month takes the 0.02 left.
  assert.deepEqual(amounts(split.month_cents).slice(0, 4), ['333.36', '333.36', '333.38', '0.00'], 'the remainder on the last month');
  assert.equal(split.total_cents, 100_010n);
  // 3.333333, 3.333333 and 3.333334 days (the sum is exact), each ÷ 20.
  assert.deepEqual(split.fte_months.slice(0, 4), ['0.166667', '0.166667', '0.166667', '0']);
  // 20 days over three months: 6.666666 twice (toward zero) and 6.666668, each ÷ 20.
  const twenty = computeLine(
    bundle({ quantity: '20', unit_price: '100', period_end: `${YEAR}-03-31`, working_day_profile_id: FLAT20 }),
    YEAR,
    CALENDARS.get(FLAT20)!,
  );
  assert.deepEqual(twenty.fte_months.slice(0, 4), ['0.333333', '0.333333', '0.333333', '0'], '6.666666 ÷ 20 and 6.666668 ÷ 20');
  assert.deepEqual(amounts(twenty.month_cents).slice(0, 4), ['666.66', '666.66', '666.68', '0.00']);

  // A month with no working day in the calendar has an FTE of 0; the money still lands there.
  const shutdown = computeLine(
    bundle({ quantity: '12', unit_price: '100', period_start: `${YEAR}-07-01`, period_end: `${YEAR}-09-30` }),
    YEAR,
    { name: 'Summer shutdown', days: [...repeat('20', 6), '15', '0', '20', '20', '20', '20'] },
  );
  assert.deepEqual(shutdown.fte_months.slice(6, 9), ['0.266667', '0', '0.2']);
  assert.deepEqual(amounts(shutdown.month_cents).slice(6, 9), ['400.00', '400.00', '400.00']);
}

/** Pieces: per month in each active month, or once (on one date: that month; over a range: split); never FTE. */
function testPieces() {
  const licences = computeLine(pieces({ label: 'Licences', quantity: '50', unit_price: '12', frequency: 'per_month' }), YEAR, null);
  assert.deepEqual(amounts(licences.month_cents), repeat('600.00', 12), '50 × 12 each month');
  assert.equal(licences.total_cents, 720_000n);
  assert.deepEqual([licences.fte_months, licences.fte, licences.fte_period], [repeat('0', 12), '0', '0']);

  const laptop = computeLine(pieces({ label: 'Laptop', unit_price: '2000', period_start: `${YEAR}-03-15`, period_end: `${YEAR}-03-15` }), YEAR, null);
  assert.deepEqual([laptop.active_months, amounts(laptop.month_cents)], [[3], months(3, ['2000.00'], '0.00')], 'all of it in March');
  assert.deepEqual([laptop.total_cents, laptop.fte, laptop.fte_period, laptop.day_counts, laptop.total_days], [200_000n, '0', '0', null, null]);
  // One date counts its month even past the 15th; a range is split with the remainder last.
  const late = computeLine(pieces({ unit_price: '2000', period_start: `${YEAR}-03-20`, period_end: `${YEAR}-03-20` }), YEAR, null);
  assert.deepEqual([late.active_months, amounts(late.month_cents)[2]], [[3], '2000.00']);
  const range = computeLine(pieces({ unit_price: '100', period_end: `${YEAR}-03-31` }), YEAR, null);
  assert.deepEqual(amounts(range.month_cents).slice(0, 4), ['33.33', '33.33', '33.34', '0.00'], 'rounded once, remainder on the last month');
  // A credit bought once mirrors a charge: −0.07 over the year is 0 eleven times and −0.07 in December, never a positive month.
  const credit = computeLine(pieces({ unit_price: '-0.07' }), YEAR, null);
  assert.deepEqual(amounts(credit.month_cents), [...repeat('0.00', 11), '-0.07']);
  assert.equal(credit.total_cents, -7n);
  const charge = computeLine(pieces({ unit_price: '0.07' }), YEAR, null);
  assert.deepEqual(amounts(charge.month_cents), [...repeat('0.00', 11), '0.07']);
}

/**
 * A column sums its lines: months, total, FTE months; `fte` is their sum ÷ 12
 * and `fte_period` their sum over the months where a people or days line is
 * active ÷ their number.
 */
function testColumnSums() {
  const consultant = line({ label: 'Consultant', period_start: `${YEAR}-02-01`, period_end: `${YEAR}-10-30` });
  const laptop = pieces({ label: 'Laptop', unit_price: '2000', period_start: `${YEAR}-03-15`, period_end: `${YEAR}-03-15` });
  const column = computeColumn([projectManager(), consultant, laptop], YEAR, CALENDARS);
  assert.equal(column.lines.length, 3);
  assert.deepEqual(column.active_months, [2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(amounts(column.month_cents), [
    '0.00', '13200.00', '16000.00', '14000.00', '12000.00', '14000.00', '12000.00', '6400.00', '8000.00', '7600.00', '0.00', '0.00',
  ]);
  assert.equal(column.total_cents, 3_600_000n + 6_520_000n + 200_000n);
  assert.deepEqual(column.fte_months, ['0', '1.25', '1.227273', '1.238095', '1.294118', '1.227273', '1.227273', '1', '1', '1', '0', '0']);
  assert.deepEqual([column.fte, column.fte_period], ['0.87', '1.16'], '10.464032 ÷ 12 and ÷ 9');
  assert.deepEqual(column.lines.map((l) => [l.fte, l.fte_period]), [['0.12', '0.24'], ['0.75', '1'], ['0', '0']], 'each line its own two figures');

  // The period counts only the months with people or days: pieces do not dilute it.
  const withLicences = computeColumn([projectManager(), pieces({ quantity: '50', unit_price: '12', frequency: 'per_month' })], YEAR, CALENDARS);
  assert.deepEqual([withLicences.active_months.length, withLicences.fte, withLicences.fte_period], [12, '0.12', '0.24'], 'licences all year');
  const decemberLaptop = pieces({ label: 'Laptop', unit_price: '2000', period_start: `${YEAR}-12-15`, period_end: `${YEAR}-12-15` });
  const withLaptop = computeColumn([projectManager(), decemberLaptop], YEAR, CALENDARS);
  assert.deepEqual([withLaptop.active_months, withLaptop.fte, withLaptop.fte_period], [[2, 3, 4, 5, 6, 7, 12], '0.12', '0.24'], 'a laptop in December');
  assert.deepEqual([computeColumn([laptop], YEAR, CALENDARS).fte, computeColumn([laptop], YEAR, CALENDARS).fte_period], ['0', '0']);

  // A line starting on the 20th leaves that month out (the 15th rule), whatever the unit.
  const late = computeLine(perMonth({ period_start: `${YEAR}-03-20`, period_end: `${YEAR}-05-31` }), YEAR, null);
  assert.deepEqual(late.active_months, [4, 5]);
}

/** Credits (negative prices) and half cents, half away from zero. */
function testCreditsAndHalfCents() {
  const credit = computeLine(perMonth({ unit_price: '-250.5', period_end: `${YEAR}-02-28` }), YEAR, null);
  assert.deepEqual(amounts(credit.month_cents).slice(0, 3), ['-250.50', '-250.50', '0.00']);
  assert.deepEqual(credit.fte_months.slice(0, 2), ['1', '1'], 'people are counted whatever the price');
  const half = computeLine(line({ unit_price: '0.0025', period_end: `${YEAR}-01-31` }), YEAR, CALENDARS.get(FR218)!);
  assert.equal(half.month_cents[0], 5n, '18 × 0.0025 = 0.045 → 0.05');
  const negativeHalf = computeLine(line({ unit_price: '-0.0025', period_end: `${YEAR}-01-31` }), YEAR, CALENDARS.get(FR218)!);
  assert.equal(negativeHalf.month_cents[0], -5n, '-0.045 → -0.05');
  const presence = computeLine(line({ unit_price: '0.001', days_per_month: '5', period_end: `${YEAR}-01-31` }), YEAR, CALENDARS.get(FR218)!);
  assert.equal(presence.month_cents[0], 1n, '5 days × 0.001 = 0.005 → 0.01');
  const zero = computeLine(perMonth({ quantity: '0' }), YEAR, null);
  assert.deepEqual([zero.total_cents, zero.fte_months[0]], [0n, '0'], 'a quantity of 0 is a line of nothing');
}

/** A calendar without the year refuses the line, naming it; line numbers name the line. */
function testCalendarYear() {
  const noYear = new Map<string, LineCalendar>([[FR218, { name: 'France 218', days: null }]]);
  refused(
    () => computeColumn([perMonth(), line()], YEAR, noYear),
    'Line 2: France 218 has no working days for 2026. Add them on the Working-day calendars page.',
  );
  refused(() => computeColumn([line({ working_day_profile_id: 'missing' })], YEAR, CALENDARS), 'Line 1: choose a calendar for a price per day.');
}

/** Every month and the total fit the amount columns; the FTE fits the round's column. */
function testLimits() {
  refused(
    () => computeLine(perMonth({ quantity: '999999999', unit_price: '99999999999999' }), YEAR, null, 3),
    'Line 3: the computed amount is too large.',
  );
  // Each line fits (6 × 10^15), their sum does not (the columns hold below 10^16).
  const big = pieces({ quantity: '100000', unit_price: '60000000000', period_end: `${YEAR}-01-31` });
  assert.equal(computeLine(big, YEAR, null).total_cents, 600_000_000_000_000_000n);
  refused(() => computeColumn([big, big], YEAR, CALENDARS), 'The computed amount is too large.');
  refused(() => computeColumn([perMonth({ quantity: '999999999', unit_price: '1' })], YEAR, CALENDARS), 'The lines add up to too many FTE.');
}

/** A request's lines: checked, normalised, refused with a sentence naming the line. */
function testParseLines() {
  const parsed = parseCostLine({
    label: '  Project manager ',
    quantity_unit: ' People ',
    quantity: '1.000',
    unit_price: 1200,
    price_basis: 'PER_DAY',
    frequency: ' Per_Month ',
    days_per_month: '5.500',
    period_start: ` ${YEAR}-02-01`,
    period_end: `${YEAR}-07-31`,
    working_day_profile_id: ` ${FRANCE} `,
  }, YEAR, 1);
  assert.deepEqual(parsed, {
    label: 'Project manager',
    quantity_unit: 'people',
    quantity: '1',
    unit_price: '1200',
    price_basis: 'per_day',
    frequency: 'per_month',
    days_per_month: '5.5',
    period_start: `${YEAR}-02-01`,
    period_end: `${YEAR}-07-31`,
    working_day_profile_id: FRANCE,
  });
  const accepted = (raw: Record<string, unknown>) => parseCostLine({ ...perMonth(), ...raw }, YEAR, 1);
  assert.equal(accepted({ label: undefined }).label, '', 'a blank description is fine');
  assert.equal(accepted({ label: 'é'.repeat(200) }).label.length, 200, '200 characters');
  // A unit with one way of counting takes it when none is sent; full time is null or left out.
  assert.equal(accepted({ frequency: undefined }).frequency, 'per_month', 'people');
  assert.equal(accepted({ ...bundle(), frequency: null }).frequency, 'once', 'days');
  assert.equal(accepted({ ...line(), days_per_month: undefined }).days_per_month, null, 'full time');
  assert.deepEqual([accepted({ ...line(), days_per_month: 31 }).days_per_month, accepted({ ...line(), days_per_month: '0.001' }).days_per_month], ['31', '0.001']);
  assert.equal(accepted({ ...pieces(), days_per_month: '' }).days_per_month, null, 'a blank days per month on another line is nothing');
  // One date: once counts its month; per month keeps the 15th rule.
  assert.equal(accepted({ ...pieces(), period_start: `${YEAR}-03-20`, period_end: `${YEAR}-03-20` }).period_end, `${YEAR}-03-20`);
  assert.deepEqual(parseCostLines([], YEAR), []);

  refused(() => parseCostLines('lines', YEAR), 'Send the lines as a list.');
  refused(() => parseCostLines(repeat(perMonth(), 51), YEAR), 'A column holds at most 50 lines.');
  assert.equal(parseCostLines(repeat(perMonth(), 50), YEAR).length, 50);
  const bad = (overrides: Record<string, unknown>, message: string) =>
    refused(() => parseCostLines([perMonth(), { ...perMonth(), ...overrides }], YEAR), `Line 2: ${message}`);
  refused(() => parseCostLines([null], YEAR), 'Line 1: send the line as an object.');
  bad({ label: 7 }, 'the description must be text.');
  bad({ label: 'x'.repeat(201) }, 'the description is longer than 200 characters.');
  bad({ quantity_unit: '' }, 'choose a unit: days, people or pieces.');
  bad({ quantity_unit: 'units' }, "unknown unit 'units'. Use days, people or pieces.");
  bad({ quantity: '' }, 'quantity is required.');
  bad({ quantity: 'ten' }, 'quantity must be a number.');
  bad({ quantity: '1.0001' }, 'quantity accepts at most 3 decimals.');
  bad({ quantity: '-1' }, 'quantity cannot be negative.');
  bad({ quantity: '1000000000' }, 'quantity is too large.');
  bad({ unit_price: '400.00001' }, 'unit price accepts at most 4 decimals.');
  bad({ unit_price: '-100000000000000' }, 'unit price is too large.');
  bad({ price_basis: null }, 'choose a price basis: per day, per month or per piece.');
  bad({ price_basis: 'once' }, "unknown price basis 'once'. Use per_day, per_month or per_piece.");
  bad({ price_basis: 'per_piece' }, 'a price for people is per day or per month.');
  bad({ quantity_unit: 'days', frequency: 'once' }, 'a price for days is per day.');
  bad({ ...pieces(), price_basis: 'per_month' }, 'a price for pieces is per piece.');
  bad({ ...pieces(), frequency: '' }, 'choose how often: per month or once.');
  bad({ frequency: 'weekly' }, "unknown frequency 'weekly'. Use per_month or once.");
  bad({ frequency: 'once' }, 'a price per month applies per month.');
  bad({ ...line(), frequency: 'once' }, 'people are counted per month.');
  bad({ ...bundle(), frequency: 'per_month' }, 'days are counted once over their period.');
  bad({ ...line(), days_per_month: '' }, 'enter the days per month, or tick Full time.');
  bad({ ...line(), days_per_month: 'five' }, 'enter the days per month, or tick Full time.');
  bad({ ...line(), days_per_month: true }, 'enter the days per month, or tick Full time.');
  bad({ ...line(), days_per_month: '5.0001' }, 'days per month accepts at most 3 decimals.');
  for (const outside of ['0', '-1', '31.001', 32]) bad({ ...line(), days_per_month: outside }, 'days per month must be more than 0 and at most 31.');
  bad({ days_per_month: '5' }, 'days per month apply to people priced per day.');
  bad({ ...bundle(), days_per_month: 5 }, 'days per month apply to people priced per day.');
  bad({ ...pieces(), days_per_month: '5' }, 'days per month apply to people priced per day.');
  bad({ period_end: '' }, 'give the start and the end of its period.');
  bad({ period_start: `${YEAR}-02-30` }, `the start of the period '${YEAR}-02-30' is not a date; use YYYY-MM-DD.`);
  bad({ period_end: `${YEAR + 1}-01-31` }, `the period must lie within ${YEAR}; its end is ${YEAR + 1}-01-31.`);
  bad({ period_start: `${YEAR}-05-01`, period_end: `${YEAR}-04-01` }, `the period starts after it ends (${YEAR}-05-01 to ${YEAR}-04-01).`);
  bad({ period_start: `${YEAR}-02-16`, period_end: `${YEAR}-03-14` }, 'no month of the period counts: a month counts when the period covers its 15th.');
  bad({ ...pieces(), frequency: 'per_month', period_start: `${YEAR}-03-20`, period_end: `${YEAR}-03-20` }, 'no month of the period counts: a month counts when the period covers its 15th.');
  bad({ price_basis: 'per_day', working_day_profile_id: null }, 'choose a calendar for a price per day.');
  bad({ ...bundle(), working_day_profile_id: null }, 'choose a calendar for a price per day.');
  bad({ working_day_profile_id: FR218 }, 'a calendar is used only with a price per day.');
  bad({ ...pieces(), working_day_profile_id: FR218 }, 'a calendar is used only with a price per day.');
  bad({ price_basis: 'per_day', working_day_profile_id: 12 }, 'the calendar was not found.');
}

/** Two lists of lines compare by value, in order. */
function testSameLines() {
  assert.equal(sameLines([line({ quantity: '1.000', unit_price: '400.0000' })], [line()]), true, 'decimals compared by value');
  assert.equal(sameLines([line({ days_per_month: '5.000' })], [line({ days_per_month: '5' })]), true, 'days per month by value');
  assert.equal(sameLines([line(), perMonth()], [perMonth(), line()]), false, 'order matters');
  assert.equal(sameLines([line({ label: 'A' })], [line()]), false);
  assert.equal(sameLines([line()], [line({ working_day_profile_id: FLAT20 })]), false);
  assert.equal(sameLines([line()], [line({ days_per_month: '5' })]), false, 'full time is not 5 days');
  assert.equal(sameLines([pieces()], [pieces({ frequency: 'per_month' })]), false, 'how often');
  assert.equal(sameLines([], []), true);
}

function main() {
  testFranceCalendar();
  testProjectManager();
  testFullTime();
  testPersonPerMonth();
  testBundle();
  testPieces();
  testColumnSums();
  testCreditsAndHalfCents();
  testCalendarYear();
  testLimits();
  testParseLines();
  testSameLines();
  console.log('costing.util.spec: ok');
}

main();
