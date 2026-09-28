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

// The computation of a column from its quantity × price lines, pure: the five
// unit and price combinations, the days split with its remainder, FTE per
// month and per year, limits and refusals. Expected values were checked with
// an independent decimal calculation (half away from zero).

const YEAR = 2026;
const FRANCE_218_2026 = ['18', '18', '20', '20', '15', '20', '15', '16', '20', '19', '18', '19'];
const FR218 = '00000000-0000-4000-8000-000000000001';
const FLAT20 = '00000000-0000-4000-8000-000000000002';
const CALENDARS = new Map<string, LineCalendar>([
  [FR218, { name: 'France 218', days: FRANCE_218_2026 }],
  [FLAT20, { name: 'Twenty days', days: Array.from({ length: 12 }, () => '20') }],
]);

function line(overrides: Partial<CostLine> = {}): CostLine {
  return {
    label: '',
    quantity_unit: 'people',
    quantity: '1',
    unit_price: '400',
    price_basis: 'per_day',
    period_start: `${YEAR}-01-01`,
    period_end: `${YEAR}-12-31`,
    working_day_profile_id: FR218,
    ...overrides,
  };
}

const perMonth = (overrides: Partial<CostLine> = {}) => line({ price_basis: 'per_month', working_day_profile_id: null, ...overrides });

/** Cents as decimal strings, for readable expectations. */
const amounts = (cents: bigint[]) => cents.map((c) => (Number(c) / 100).toFixed(2));
const repeat = <T>(value: T, n: number): T[] => Array.from({ length: n }, () => value);

function refused(fn: () => unknown, message: string, label?: string) {
  assert.throws(fn, (err: unknown) => err instanceof CostingInputError && err.message === message, label ?? message);
}

/** People × per day, the SFR vector: France 218, February to October, 1 × 400 a day. */
function testPeoplePerDay() {
  const result = computeLine(line({ period_start: `${YEAR}-02-01`, period_end: `${YEAR}-10-30` }), YEAR, CALENDARS.get(FR218)!);
  assert.deepEqual(result.active_months, [2, 3, 4, 5, 6, 7, 8, 9, 10], 'nine active months (the 30th still covers October 15)');
  assert.deepEqual(result.day_counts, FRANCE_218_2026, 'the calendar values of the year, as used');
  assert.equal(result.total_days, '163');
  assert.deepEqual(amounts(result.month_cents), [
    '0.00', '7200.00', '8000.00', '8000.00', '6000.00', '8000.00', '6000.00', '6400.00', '8000.00', '7600.00', '0.00', '0.00',
  ]);
  assert.equal(result.total_cents, 6_520_000n, '65 200');
  assert.deepEqual(result.fte_months, ['0', ...repeat('1', 9), '0', '0'], 'the quantity in each active month');
  const column = computeColumn([line({ period_start: `${YEAR}-02-01`, period_end: `${YEAR}-10-30` })], YEAR, CALENDARS);
  assert.equal(column.fte, '0.75', '9 ÷ 12');
  // Fractional people and days: 1.5 × 19.083333 × 612.5 = 17 532.81 (6-decimal days, exact product).
  const fractional = computeLine(line({ quantity: '1.5', unit_price: '612.5', period_start: `${YEAR}-01-01`, period_end: `${YEAR}-01-31` }), YEAR, {
    name: 'Fractional', days: repeat('19.083333', 12),
  });
  assert.deepEqual([amounts(fractional.month_cents)[0], fractional.total_days, fractional.fte_months[0]], ['17532.81', '19.083333', '1.5']);
}

/** People × per month: quantity × unit price in each active month; FTE the quantity. */
function testPeoplePerMonth() {
  const result = computeLine(perMonth({ quantity: '1.5', unit_price: '5000', period_end: `${YEAR}-06-30` }), YEAR, null);
  assert.deepEqual(amounts(result.month_cents), [...repeat('7500.00', 6), ...repeat('0.00', 6)]);
  assert.equal(result.total_cents, 4_500_000n);
  assert.deepEqual([result.day_counts, result.total_days], [null, null]);
  assert.deepEqual(result.fte_months, [...repeat('1.5', 6), ...repeat('0', 6)]);
  assert.equal(computeColumn([perMonth({ quantity: '1.5', unit_price: '5000', period_end: `${YEAR}-06-30` })], YEAR, CALENDARS).fte, '0.75');
}

/**
 * Days × per day: the price of the days rounded once, split equally over the
 * active months; the days split the same way, and each month's FTE is its
 * days ÷ the calendar's working days of that month.
 */
function testDaysPerDay() {
  // 100 days at 600 a day, March to December: 6 000 a month; 10 days a month.
  const days = line({ quantity_unit: 'days', quantity: '100', unit_price: '600', period_start: `${YEAR}-03-01` });
  const result = computeLine(days, YEAR, CALENDARS.get(FR218)!);
  assert.deepEqual(amounts(result.month_cents), ['0.00', '0.00', ...repeat('6000.00', 10)]);
  assert.equal(result.total_cents, 6_000_000n);
  assert.deepEqual(result.fte_months, [
    '0', '0', '0.5', '0.5', '0.666667', '0.5', '0.666667', '0.625', '0.5', '0.526316', '0.555556', '0.526316',
  ], '10 days ÷ the working days of each month, 6 decimals');
  assert.deepEqual([result.day_counts, result.total_days], [FRANCE_218_2026, '182'], 'the working days the period holds');
  assert.equal(computeColumn([days], YEAR, CALENDARS).fte, '0.46', '5.566522 ÷ 12');

  // Remainders: 10 × 100.01 = 1 000.10 over three months, 10 days over three months.
  const split = computeLine(
    line({ quantity_unit: 'days', quantity: '10', unit_price: '100.01', period_end: `${YEAR}-03-31`, working_day_profile_id: FLAT20 }),
    YEAR,
    CALENDARS.get(FLAT20)!,
  );
  assert.deepEqual(amounts(split.month_cents).slice(0, 3), ['333.37', '333.37', '333.36'], 'the remainder on the last month');
  assert.equal(split.total_cents, 100_010n);
  // 3.333333, 3.333333 and 3.333334 days (the sum is exact), each ÷ 20.
  assert.deepEqual(split.fte_months.slice(0, 4), ['0.166667', '0.166667', '0.166667', '0']);

  // A month with no working day in the calendar has an FTE of 0.
  const shutdown = computeLine(
    line({ quantity_unit: 'days', quantity: '12', unit_price: '100', period_start: `${YEAR}-07-01`, period_end: `${YEAR}-09-30` }),
    YEAR,
    { name: 'Summer shutdown', days: [...repeat('20', 6), '15', '0', '20', '20', '20', '20'] },
  );
  assert.deepEqual(shutdown.fte_months.slice(6, 9), ['0.266667', '0', '0.2']);
  assert.deepEqual(amounts(shutdown.month_cents).slice(6, 9), ['400.00', '400.00', '400.00']);
}

/** Units × per month and units × once: amounts only, no FTE. */
function testUnits() {
  const licences = computeLine(perMonth({ quantity_unit: 'units', quantity: '10', unit_price: '200' }), YEAR, null);
  assert.deepEqual(amounts(licences.month_cents), repeat('2000.00', 12), 'a licence line 200 × 10 over the year');
  assert.deepEqual(licences.fte_months, repeat('0', 12));
  assert.equal(computeColumn([perMonth({ quantity_unit: 'units', quantity: '10', unit_price: '200' })], YEAR, CALENDARS).fte, '0');

  const once = computeLine(
    line({ quantity_unit: 'units', quantity: '1', unit_price: '100', price_basis: 'once', period_end: `${YEAR}-03-31`, working_day_profile_id: null }),
    YEAR,
    null,
  );
  assert.deepEqual(amounts(once.month_cents).slice(0, 4), ['33.33', '33.33', '33.34', '0.00'], 'rounded once, remainder on the last month');
  assert.deepEqual(once.fte_months, repeat('0', 12));
  assert.deepEqual([once.day_counts, once.total_days], [null, null]);
}

/** A column sums its lines: months, total, FTE months; the yearly FTE is their sum ÷ 12. */
function testColumnSums() {
  const lines = [
    line({ label: 'Project manager', period_start: `${YEAR}-02-01`, period_end: `${YEAR}-10-30` }),
    perMonth({ quantity_unit: 'units', quantity: '10', unit_price: '200' }),
    line({ quantity_unit: 'days', quantity: '100', unit_price: '600', period_start: `${YEAR}-03-01` }),
  ];
  const column = computeColumn(lines, YEAR, CALENDARS);
  assert.equal(column.lines.length, 3);
  assert.deepEqual(column.active_months, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual(amounts(column.month_cents), [
    '2000.00', '9200.00', '16000.00', '16000.00', '14000.00', '16000.00', '14000.00', '14400.00', '16000.00', '15600.00', '8000.00', '8000.00',
  ]);
  assert.equal(column.total_cents, 6_520_000n + 2_400_000n + 6_000_000n);
  assert.deepEqual(column.fte_months, [
    '0', '1', '1.5', '1.5', '1.666667', '1.5', '1.666667', '1.625', '1.5', '1.526316', '0.555556', '0.526316',
  ]);
  assert.equal(column.fte, '1.21', '(9 + 5.566522) ÷ 12 = 1.2138…');
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
  const big = line({
    quantity_unit: 'units', quantity: '100000', unit_price: '60000000000', price_basis: 'once', period_end: `${YEAR}-01-31`, working_day_profile_id: null,
  });
  assert.equal(computeLine(big, YEAR, null).total_cents, 600_000_000_000_000_000n);
  refused(() => computeColumn([big, big], YEAR, CALENDARS), 'The computed amount is too large.');
  refused(() => computeColumn([perMonth({ quantity: '999999999', unit_price: '1' })], YEAR, CALENDARS), 'The lines add up to too many FTE.');
}

/** A request's lines: checked, normalised, refused with a sentence naming the line. */
function testParseLines() {
  const parsed = parseCostLine({
    label: '  Project manager ',
    quantity_unit: ' People ',
    quantity: '1.500',
    unit_price: 400,
    price_basis: 'PER_DAY',
    period_start: ` ${YEAR}-02-01`,
    period_end: `${YEAR}-10-30`,
    working_day_profile_id: ` ${FR218} `,
  }, YEAR, 1);
  assert.deepEqual(parsed, {
    label: 'Project manager',
    quantity_unit: 'people',
    quantity: '1.5',
    unit_price: '400',
    price_basis: 'per_day',
    period_start: `${YEAR}-02-01`,
    period_end: `${YEAR}-10-30`,
    working_day_profile_id: FR218,
  });
  assert.equal(parseCostLine(perMonth({ label: undefined as any }), YEAR, 1).label, '', 'a blank description is fine');
  assert.equal(parseCostLine(perMonth({ label: 'é'.repeat(200) }), YEAR, 1).label.length, 200, '200 characters');
  assert.deepEqual(parseCostLines([], YEAR), []);

  refused(() => parseCostLines('lines', YEAR), 'Send the lines as a list.');
  refused(() => parseCostLines(repeat(perMonth(), 51), YEAR), 'A column holds at most 50 lines.');
  assert.equal(parseCostLines(repeat(perMonth(), 50), YEAR).length, 50);
  const bad = (overrides: Record<string, unknown>, message: string) =>
    refused(() => parseCostLines([perMonth(), { ...perMonth(), ...overrides }], YEAR), `Line 2: ${message}`);
  refused(() => parseCostLines([null], YEAR), 'Line 1: send the line as an object.');
  bad({ label: 7 }, 'the description must be text.');
  bad({ label: 'x'.repeat(201) }, 'the description is longer than 200 characters.');
  bad({ quantity_unit: '' }, 'choose a unit: people, days or units.');
  bad({ quantity_unit: 'weeks' }, "unknown unit 'weeks'. Use people, days or units.");
  bad({ quantity: '' }, 'quantity is required.');
  bad({ quantity: 'ten' }, 'quantity must be a number.');
  bad({ quantity: '1.0001' }, 'quantity accepts at most 3 decimals.');
  bad({ quantity: '-1' }, 'quantity cannot be negative.');
  bad({ quantity: '1000000000' }, 'quantity is too large.');
  bad({ unit_price: '400.00001' }, 'unit price accepts at most 4 decimals.');
  bad({ unit_price: '-100000000000000' }, 'unit price is too large.');
  bad({ price_basis: null }, 'choose a price basis: per day, per month or once.');
  bad({ price_basis: 'weekly' }, "unknown price basis 'weekly'. Use per_day, per_month or once.");
  bad({ price_basis: 'once' }, 'a price for people is per day or per month.');
  bad({ quantity_unit: 'days' }, 'a price for days is per day.');
  bad({ quantity_unit: 'units', price_basis: 'per_day', working_day_profile_id: FR218 }, 'a price for units is per month or once.');
  bad({ period_end: '' }, 'give the start and the end of its period.');
  bad({ period_start: `${YEAR}-02-30` }, `the start of the period '${YEAR}-02-30' is not a date; use YYYY-MM-DD.`);
  bad({ period_end: `${YEAR + 1}-01-31` }, `the period must lie within ${YEAR}; its end is ${YEAR + 1}-01-31.`);
  bad({ period_start: `${YEAR}-05-01`, period_end: `${YEAR}-04-01` }, `the period starts after it ends (${YEAR}-05-01 to ${YEAR}-04-01).`);
  bad({ period_start: `${YEAR}-02-16`, period_end: `${YEAR}-03-14` }, 'no month of the period counts: a month counts when the period covers its 15th.');
  bad({ price_basis: 'per_day', working_day_profile_id: null }, 'choose a calendar for a price per day.');
  bad({ working_day_profile_id: FR218 }, 'a calendar is used only with a price per day.');
  bad({ price_basis: 'per_day', working_day_profile_id: 12 }, 'the calendar was not found.');
}

/** Two lists of lines compare by value, in order. */
function testSameLines() {
  assert.equal(sameLines([line({ quantity: '1.000', unit_price: '400.0000' })], [line()]), true, 'decimals compared by value');
  assert.equal(sameLines([line(), perMonth()], [perMonth(), line()]), false, 'order matters');
  assert.equal(sameLines([line({ label: 'A' })], [line()]), false);
  assert.equal(sameLines([line()], [line({ working_day_profile_id: FLAT20 })]), false);
  assert.equal(sameLines([], []), true);
}

function main() {
  testPeoplePerDay();
  testPeoplePerMonth();
  testDaysPerDay();
  testUnits();
  testColumnSums();
  testCreditsAndHalfCents();
  testCalendarYear();
  testLimits();
  testParseLines();
  testSameLines();
  console.log('costing.util.spec: ok');
}

main();
