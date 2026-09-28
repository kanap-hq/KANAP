import * as assert from 'node:assert/strict';
import {
  computeCosting,
  CostingInputError,
  CostingRecipe,
  parseCostingRecipe,
  positiveMonthsOf,
  sameRecipe,
  yearlyFte,
} from '../costing.util';

// The computation of a costed round, pure: the SFR vector and every case of
// the plan's test list. Expected values were checked with an independent
// arbitrary-precision decimal calculation (half away from zero to cents).

const FRANCE_218_2026 = ['18', '18', '20', '20', '15', '20', '15', '16', '20', '19', '18', '19'];
const FRANCE_218 = { code: 'FR218', name: 'France 218', days: FRANCE_218_2026 };
const SFR_PERIOD = { year: 2026, period_start: '2026-02-01', period_end: '2026-10-30' };
const WHOLE_2026 = { year: 2026, period_start: '2026-01-01', period_end: '2026-12-31' };

function recipe(overrides: Partial<CostingRecipe> = {}): CostingRecipe {
  return {
    pricing_basis: 'per_day',
    quantity: '1',
    unit_price: '400',
    price_index_pct: '0',
    working_day_profile_id: '00000000-0000-4000-8000-000000000001',
    counts_as_fte: false,
    ...overrides,
  };
}

const perMonth = (overrides: Partial<CostingRecipe> = {}) => recipe({ pricing_basis: 'per_month', working_day_profile_id: null, ...overrides });
const perPeriod = (overrides: Partial<CostingRecipe> = {}) => recipe({ pricing_basis: 'per_period', working_day_profile_id: null, ...overrides });

/** Cents as decimal strings, for readable expectations. */
const amounts = (cents: bigint[]) => cents.map((c) => (Number(c) / 100).toFixed(2));
const zeros = (n: number) => Array.from({ length: n }, () => '0.00');

function refused(fn: () => unknown, message: string, label?: string) {
  assert.throws(fn, (err: unknown) => err instanceof CostingInputError && err.message === message, label ?? message);
}

/** SFR row 4: France 218, February to October 2026, quantity 1, 400 a day, index 0. */
function testSfrVector() {
  const result = computeCosting({ ...SFR_PERIOD, recipe: recipe({ counts_as_fte: true }), calendar: FRANCE_218 });
  assert.deepEqual(result.active_months, [2, 3, 4, 5, 6, 7, 8, 9, 10], 'nine active months (the 30th still covers October 15)');
  assert.equal(result.total_days, '163');
  assert.deepEqual(result.day_counts, FRANCE_218_2026, 'the calendar values of the year, as used');
  assert.deepEqual(amounts(result.month_cents), [
    '0.00', '7200.00', '8000.00', '8000.00', '6000.00', '8000.00', '6000.00', '6400.00', '8000.00', '7600.00', '0.00', '0.00',
  ]);
  assert.equal(result.total_cents, 6_520_000n, '65 200');
  assert.equal(result.fte, '0.75');
  // Not counted as FTE: no FTE on the result.
  assert.equal(computeCosting({ ...SFR_PERIOD, recipe: recipe(), calendar: FRANCE_218 }).fte, null);
}

/** Per month: quantity × indexed price in each active month; a licence line 200 × 10 over the year. */
function testPerMonth() {
  const licence = computeCosting({ ...WHOLE_2026, recipe: perMonth({ quantity: '10', unit_price: '200' }), calendar: null });
  assert.deepEqual(amounts(licence.month_cents), Array.from({ length: 12 }, () => '2000.00'));
  assert.equal(licence.total_cents, 2_400_000n);
  assert.deepEqual([licence.day_counts, licence.total_days, licence.fte], [null, null, null], 'no days, no FTE unless flagged');
  const flagged = computeCosting({ ...WHOLE_2026, recipe: perMonth({ quantity: '10', unit_price: '200', counts_as_fte: true }), calendar: null });
  assert.equal(flagged.fte, '10');
  const window = computeCosting({ ...SFR_PERIOD, recipe: perMonth({ quantity: '2', unit_price: '150.25' }), calendar: null });
  assert.deepEqual(amounts(window.month_cents), ['0.00', ...Array.from({ length: 9 }, () => '300.50'), '0.00', '0.00']);
}

/** For the whole period: the total rounded once, equal shares, the remainder on the last active month. */
function testPerPeriodRemainder() {
  const result = computeCosting({ ...SFR_PERIOD, recipe: perPeriod({ unit_price: '1000' }), calendar: null });
  assert.deepEqual(amounts(result.month_cents), ['0.00', ...Array.from({ length: 8 }, () => '111.11'), '111.12', '0.00', '0.00']);
  assert.equal(result.total_cents, 100_000n);
  const credit = computeCosting({ ...SFR_PERIOD, recipe: perPeriod({ unit_price: '-1000' }), calendar: null });
  assert.deepEqual(amounts(credit.month_cents), ['0.00', ...Array.from({ length: 8 }, () => '-111.11'), '-111.12', '0.00', '0.00']);
  // 0.30 over twelve months: 0.03 × 11 and the remainder −0.03 in December, as the spread does.
  const small = computeCosting({ ...WHOLE_2026, recipe: perPeriod({ unit_price: '0.30' }), calendar: null });
  assert.deepEqual(amounts(small.month_cents), [...Array.from({ length: 11 }, () => '0.03'), '-0.03']);
}

/** The indexed price is never rounded before multiplying. */
function testIndexPrecision() {
  // 1.2345 × 1.033333 = 1.2756495885; × 1 000 = 1 275.6495885 → 1 275.65 (1 275.60 if the price were rounded to 4 decimals first).
  const result = computeCosting({ ...WHOLE_2026, recipe: perMonth({ quantity: '1000', unit_price: '1.2345', price_index_pct: '3.3333' }), calendar: null });
  assert.equal(amounts(result.month_cents)[0], '1275.65');
  // 19.083333 days × 0.333 × 123.4567 × 1.033333 = 810.6874041298663… → 810.69 each month, 19 decimals exact.
  const days = Array.from({ length: 12 }, () => '19.083333');
  const fine = computeCosting({
    ...WHOLE_2026,
    recipe: recipe({ quantity: '0.333', unit_price: '123.4567', price_index_pct: '3.3333' }),
    calendar: { code: 'FR229', name: 'France 229', days },
  });
  assert.deepEqual(amounts(fine.month_cents), Array.from({ length: 12 }, () => '810.69'));
  assert.equal(fine.total_cents, 972_828n);
  assert.equal(fine.total_days, '228.999996');
  // 2 % on 400 a day: 408 a day, 18 days in January.
  const indexed = computeCosting({ ...WHOLE_2026, recipe: recipe({ price_index_pct: '2' }), calendar: FRANCE_218 });
  assert.equal(amounts(indexed.month_cents)[0], '7344.00');
}

/** A month counts when the period covers its 15th: starting on the 20th leaves the month out. */
function testStartOnTheTwentieth() {
  const result = computeCosting({ year: 2026, period_start: '2026-02-20', period_end: '2026-10-30', recipe: recipe({ counts_as_fte: true }), calendar: FRANCE_218 });
  assert.deepEqual(result.active_months, [3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(result.month_cents[1], 0n, 'February is zero');
  assert.equal(result.total_days, '145');
  assert.equal(result.total_cents, 5_800_000n);
  assert.equal(result.fte, '0.67', '8 / 12');
  refused(
    () => computeCosting({ year: 2026, period_start: '2026-02-16', period_end: '2026-03-14', recipe: recipe(), calendar: FRANCE_218 }),
    'No month of the period counts: a month counts when the period covers its 15th.',
  );
  refused(
    () => computeCosting({ year: 2026, period_start: '2026-02-30', period_end: '2026-03-31', recipe: recipe(), calendar: FRANCE_218 }),
    "The start of the period '2026-02-30' is not a date; use YYYY-MM-DD.",
  );
  refused(
    () => computeCosting({ year: 2026, period_start: '2025-12-01', period_end: '2026-03-31', recipe: recipe(), calendar: FRANCE_218 }),
    'The period must lie within 2026; its start is 2025-12-01.',
  );
}

/** A calendar without the year's days is refused naming the calendar and the year. */
function testMissingCalendarYear() {
  refused(
    () => computeCosting({ year: 2027, period_start: '2027-01-01', period_end: '2027-12-31', recipe: recipe(), calendar: { ...FRANCE_218, days: null } }),
    'France 218 has no working days for 2027. Add them on the Working-day calendars page.',
  );
}

/** A price per day needs a calendar; the other bases refuse one. */
function testCalendarRules() {
  refused(() => computeCosting({ ...WHOLE_2026, recipe: recipe(), calendar: null }), 'Choose a working-day calendar for a price per day.');
  refused(() => computeCosting({ ...WHOLE_2026, recipe: perMonth(), calendar: FRANCE_218 }), 'A calendar is used only with a price per day.');
  refused(() => parseCostingRecipe({ pricing_basis: 'per_day', quantity: 1, unit_price: 400 }), 'Choose a working-day calendar for a price per day.');
  refused(
    () => parseCostingRecipe({ pricing_basis: 'per_period', quantity: 1, unit_price: 400, working_day_profile_id: 'x' }),
    'A calendar is used only with a price per day.',
  );
}

/** Credits: a negative price gives negative months; a counted credit has no positive month, so FTE 0. */
function testCredits() {
  const result = computeCosting({ ...SFR_PERIOD, recipe: recipe({ unit_price: '-400', counts_as_fte: true }), calendar: FRANCE_218 });
  assert.equal(amounts(result.month_cents)[1], '-7200.00');
  assert.equal(result.total_cents, -6_520_000n);
  assert.equal(result.fte, '0');
}

/** Fractional quantities and days: 19.083333 × 1.5 × 400 = 11 449.9998 → 11 450. */
function testFractionalQuantityAndDays() {
  const days = ['19.083333', '16.75', ...Array.from({ length: 10 }, () => '0')];
  const result = computeCosting({ ...WHOLE_2026, recipe: recipe({ quantity: '1.5', counts_as_fte: true }), calendar: { code: 'X', name: 'X', days } });
  assert.deepEqual(amounts(result.month_cents).slice(0, 3), ['11450.00', '10050.00', '0.00']);
  assert.equal(result.total_days, '35.833333');
  // Only January and February hold an amount: 1.5 × 2 / 12 = 0.25.
  assert.equal(result.fte, '0.25');
}

/** Column limits are checked before any write; nothing is truncated. */
function testPrecisionAndOverflowRefused() {
  const base = { pricing_basis: 'per_month', quantity: '1', unit_price: '400' };
  refused(() => parseCostingRecipe({ ...base, quantity: '1.0001' }), 'Quantity accepts at most 3 decimals.');
  refused(() => parseCostingRecipe({ ...base, unit_price: '400.00001' }), 'Unit price accepts at most 4 decimals.');
  refused(() => parseCostingRecipe({ ...base, price_index_pct: '2.00001' }), 'Price index accepts at most 4 decimals.');
  refused(() => parseCostingRecipe({ ...base, quantity: '1000000000' }), 'Quantity is too large.');
  refused(() => parseCostingRecipe({ ...base, unit_price: '100000000000000' }), 'Unit price is too large.');
  refused(() => parseCostingRecipe({ ...base, price_index_pct: '1000' }), 'Price index is too large.');
  refused(
    () => computeCosting({ ...WHOLE_2026, recipe: perMonth({ quantity: '999999999.999', unit_price: '99999999999999.9999' }), calendar: null }),
    'The computed amount is too large.',
  );
  // Each month fits, the year does not: 10^17 × 12 ≥ 10^18 cents.
  refused(
    () => computeCosting({ ...WHOLE_2026, recipe: perMonth({ quantity: '1000', unit_price: '1000000000000' }), calendar: null }),
    'The computed amount is too large.',
  );
  refused(
    () => computeCosting({ ...WHOLE_2026, recipe: perPeriod({ quantity: '100000', unit_price: '99999999999999' }), calendar: null }),
    'The computed amount is too large.',
  );
}

/** Half a cent rounds away from zero, per month. */
function testHalfCents() {
  const month = (r: CostingRecipe, calendar: Parameters<typeof computeCosting>[0]['calendar'] = null) =>
    amounts(computeCosting({ ...WHOLE_2026, recipe: r, calendar }).month_cents)[0];
  assert.equal(month(perMonth({ unit_price: '0.005' })), '0.01');
  assert.equal(month(perMonth({ unit_price: '-0.005' })), '-0.01');
  assert.equal(month(perMonth({ unit_price: '0.0049' })), '0.00');
  assert.equal(month(recipe({ unit_price: '0.01' }), { code: 'H', name: 'H', days: ['0.5', ...Array.from({ length: 11 }, () => '1')] }), '0.01');
  // 0.335 × 3: 1.005 → 1.01 (rounding the price first would give 1.02).
  assert.equal(month(perMonth({ quantity: '3', unit_price: '0.335' })), '1.01');
}

/** The recipe is normalised: plain decimals, index blank = 0, basis case-insensitive, FTE a boolean. */
function testParseCostingRecipe() {
  assert.deepEqual(
    parseCostingRecipe({ pricing_basis: ' Per_Day ', quantity: '1.000', unit_price: 400, price_index_pct: '', working_day_profile_id: ' id-1 ' }),
    { pricing_basis: 'per_day', quantity: '1', unit_price: '400', price_index_pct: '0', working_day_profile_id: 'id-1', counts_as_fte: false },
  );
  assert.deepEqual(
    parseCostingRecipe({ pricing_basis: 'per_month', quantity: 0, unit_price: '-12.5000', price_index_pct: '-100', counts_as_fte: true }),
    { pricing_basis: 'per_month', quantity: '0', unit_price: '-12.5', price_index_pct: '-100', working_day_profile_id: null, counts_as_fte: true },
  );
  refused(() => parseCostingRecipe({ quantity: 1, unit_price: 1 }), 'Choose a pricing basis.');
  refused(() => parseCostingRecipe({ pricing_basis: 'weekly', quantity: 1, unit_price: 1 }), "Unknown pricing basis 'weekly'. Use per_day, per_month, per_period.");
  refused(() => parseCostingRecipe({ pricing_basis: 'per_month', unit_price: 1 }), 'Quantity is required.');
  refused(() => parseCostingRecipe({ pricing_basis: 'per_month', quantity: 1 }), 'Unit price is required.');
  refused(() => parseCostingRecipe({ pricing_basis: 'per_month', quantity: -1, unit_price: 1 }), 'Quantity cannot be negative.');
  refused(() => parseCostingRecipe({ pricing_basis: 'per_month', quantity: 1, unit_price: 1, price_index_pct: '-100.5' }), 'The price index cannot be below -100%.');
  refused(() => parseCostingRecipe({ pricing_basis: 'per_month', quantity: 1, unit_price: 1, counts_as_fte: 'yes' }), 'Counts as FTE must be true or false.');
  refused(() => parseCostingRecipe({ pricing_basis: 'per_day', quantity: 1, unit_price: 1, working_day_profile_id: 7 }), 'The calendar was not found.');
  // Zero quantity is allowed: every month is zero.
  const none = computeCosting({ ...WHOLE_2026, recipe: perMonth({ quantity: '0', counts_as_fte: true }), calendar: null });
  assert.deepEqual([none.total_cents, none.fte], [0n, '0']);

  assert.equal(sameRecipe(recipe({ quantity: '1.000', unit_price: '400.0000' }), recipe()), true, 'decimals compared by value');
  assert.equal(sameRecipe(recipe(), recipe({ counts_as_fte: true })), false);
  assert.equal(sameRecipe(recipe(), recipe({ working_day_profile_id: 'other' })), false);
  assert.equal(sameRecipe(null, null), true);
  assert.equal(sameRecipe(recipe(), null), false);
}

/** Yearly FTE: the quantity in each active month holding a positive amount, ÷ 12, 2 decimals half away from zero. */
function testYearlyFte() {
  const sfrMonths = [2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.equal(yearlyFte('1', sfrMonths, sfrMonths), '0.75');
  assert.equal(yearlyFte('1', sfrMonths, sfrMonths.filter((m) => m !== 4)), '0.67', 'a zero April drops from the mask');
  assert.equal(yearlyFte('1.5', sfrMonths, sfrMonths), '1.13', '13.5 / 12 = 1.125');
  assert.equal(yearlyFte('1', sfrMonths, [1, 11, 12]), '0', 'positive months outside the period do not count');
  assert.equal(yearlyFte('2', [1, 1, 2], [1, 2, 2]), '0.33', 'duplicates count once');
  assert.equal(yearlyFte('1.000', Array.from({ length: 12 }, (_, i) => i + 1), Array.from({ length: 12 }, (_, i) => i + 1)), '1');
  assert.deepEqual(positiveMonthsOf([0n, 1n, -1n, 0n, 5n, 0n, 0n, 0n, 0n, 0n, 0n, 0n]), [2, 5]);
}

function main() {
  testSfrVector();
  testPerMonth();
  testPerPeriodRemainder();
  testIndexPrecision();
  testStartOnTheTwentieth();
  testMissingCalendarYear();
  testCalendarRules();
  testCredits();
  testFractionalQuantityAndDays();
  testPrecisionAndOverflowRefused();
  testHalfCents();
  testParseCostingRecipe();
  testYearlyFte();
  console.log('costing.util.spec: ok');
}

main();
