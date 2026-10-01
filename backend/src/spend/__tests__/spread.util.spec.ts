import * as assert from 'node:assert/strict';
import {
  activeMonths,
  FLAT_WEIGHTS,
  profileWeights,
  SpreadInputError,
  spreadAnnualToMonths,
  splitTowardZero,
  spreadQuarterlyToMonths,
} from '../spread.util';

// Spreads in integer cents: each month is its exact share rounded toward
// zero, what is left goes to the last month with a weight (of the year or
// quarter). Every month has the sign of the total or is zero.

const YEAR = 2031;

function planned(total: bigint, weights: readonly bigint[] = FLAT_WEIGHTS) {
  const rows = spreadAnnualToMonths(YEAR, { planned: total }, weights);
  assert.equal(rows.reduce((sum, r) => sum + (r.planned as bigint), 0n), total, 'the months add up to the total');
  return rows.map((r) => r.planned);
}

const elevenThen = (month: bigint, last: bigint) => [...Array.from({ length: 11 }, () => month), last];

function testFlatSpread() {
  // 558 / 12 = 46.5 → 46; 558 − 11 × 46 = 52.
  assert.deepEqual(planned(558n), elevenThen(46n, 52n));
  assert.deepEqual(planned(1_200_000n), Array.from({ length: 12 }, () => 100_000n));
  assert.deepEqual(planned(10_000n), elevenThen(833n, 837n));
  assert.deepEqual(planned(-558n), elevenThen(-46n, -52n));
  // 30 / 12 = 2.5 → 2 each; December takes the 8 left, never a negative month.
  assert.deepEqual(planned(30n), elevenThen(2n, 8n));
  assert.deepEqual(planned(0n), Array.from({ length: 12 }, () => 0n));
  // A few cents: all of them in December, with their sign (a credit note mirrors a charge).
  assert.deepEqual(planned(7n), elevenThen(0n, 7n));
  assert.deepEqual(planned(-7n), elevenThen(0n, -7n));
  assert.deepEqual(planned(6n), elevenThen(0n, 6n));
}

/** The split itself: toward zero, the rest on the last share with a weight; zero weights get zero. */
function testSplitTowardZero() {
  assert.deepEqual(splitTowardZero(100n, [1n, 1n, 1n]), [33n, 33n, 34n]);
  assert.deepEqual(splitTowardZero(-100n, [1n, 1n, 1n]), [-33n, -33n, -34n]);
  // A zero-weight last month gets nothing: the rest lands on the last month with a weight.
  assert.deepEqual(splitTowardZero(100n, [1n, 1n, 1n, 0n]), [33n, 33n, 34n, 0n]);
  const novemberLast = [...Array.from({ length: 11 }, () => 1n), 0n];
  assert.deepEqual(planned(100n, novemberLast), [...Array.from({ length: 10 }, () => 9n), 10n, 0n], '100 over eleven months, December weighs 0');
  assert.deepEqual(planned(-100n, novemberLast), [...Array.from({ length: 10 }, () => -9n), -10n, 0n]);
  assert.throws(() => splitTowardZero(100n, [1n, -1n, 1n]), /cannot be negative/);
}

function testRowsCarryOnlyTheMeasuresGiven() {
  const rows = spreadAnnualToMonths(YEAR, { committed: 1200n, expected_landing: 0n });
  assert.equal(rows.length, 12);
  assert.deepEqual(rows[0], { period: `${YEAR}-01-01`, committed: 100n, expected_landing: 0n });
  assert.deepEqual(rows[11], { period: `${YEAR}-12-01`, committed: 100n, expected_landing: 0n });
  assert.deepEqual(spreadAnnualToMonths(YEAR, {})[5], { period: `${YEAR}-06-01` });
}

function testQuarterlySpread() {
  const equal = spreadQuarterlyToMonths(YEAR, 'committed', { Q1: 30_000n, Q3: 100n }, 'equal');
  assert.deepEqual(equal.map((r) => r.committed), [10_000n, 10_000n, 10_000n, 0n, 0n, 0n, 33n, 33n, 34n, 0n, 0n, 0n]);
  assert.deepEqual(Object.keys(equal[0]), ['period', 'committed']);

  const fourFourFive = spreadQuarterlyToMonths(YEAR, 'planned', { Q2: 130_000n }, '445');
  assert.deepEqual(fourFourFive.slice(3, 6).map((r) => r.planned), [40_000n, 40_000n, 50_000n]);
  assert.deepEqual(fourFourFive.map((r) => r.period).slice(0, 2), [`${YEAR}-01-01`, `${YEAR}-02-01`]);

  // −1.00 in thirds: −33, −33, −34.
  const negative = spreadQuarterlyToMonths(YEAR, 'actual', { Q4: -100n }, 'equal');
  assert.deepEqual(negative.slice(9).map((r) => r.actual), [-33n, -33n, -34n]);

  // 0.02 in a 4-4-5 quarter: 0.006 and 0.008 round to 0, the last month takes both cents.
  const twoCents = spreadQuarterlyToMonths(YEAR, 'planned', { Q1: 2n }, '445');
  assert.deepEqual(twoCents.slice(0, 3).map((r) => r.planned), [0n, 0n, 2n]);
  const minusTwoCents = spreadQuarterlyToMonths(YEAR, 'planned', { Q1: -2n }, '445');
  assert.deepEqual(minusTwoCents.slice(0, 3).map((r) => r.planned), [0n, 0n, -2n]);
}

function testNamedProfile() {
  // Stored weights need not add up to 1: they are normalised by their sum.
  const weights = profileWeights([2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1]);
  assert.deepEqual(weights, [2n, 2n, 2n, 2n, 2n, 2n, 1n, 1n, 1n, 1n, 1n, 1n]);
  assert.deepEqual(planned(180_000n, weights!), [20_000n, 20_000n, 20_000n, 20_000n, 20_000n, 20_000n, 10_000n, 10_000n, 10_000n, 10_000n, 10_000n, 10_000n]);

  // Decimal weights are converted exactly to one integer scale.
  const decimals = profileWeights([0.05, 0.05, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.05, '0.05']);
  assert.deepEqual(decimals, [5n, 5n, 10n, 10n, 10n, 10n, 10n, 10n, 10n, 10n, 5n, 5n]);
  assert.deepEqual(planned(100_000n, decimals!).slice(0, 3), [5_000n, 5_000n, 10_000n]);

  // Unusable profiles fall back to flat at the caller.
  assert.equal(profileWeights(undefined), null);
  assert.equal(profileWeights([1, 2, 3]), null);
  assert.equal(profileWeights(Array.from({ length: 12 }, () => 0)), null);
  // A value that is not a number counts as zero.
  assert.deepEqual(profileWeights([1, null, 'x', 1, 1, 1, 1, 1, 1, 1, 1, 1]), [1n, 0n, 0n, 1n, 1n, 1n, 1n, 1n, 1n, 1n, 1n, 1n]);
  // A negative weight is refused with a sentence, even when the sum stays above zero.
  refused(() => profileWeights([2, -1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]), /^A spread profile cannot give a month a negative weight\.$/);
  refused(() => profileWeights(['0.1', '-0.05', ...Array.from({ length: 10 }, () => '0.1')]), /negative weight/);
}

function testRefusesUnusableWeights() {
  assert.throws(() => spreadAnnualToMonths(YEAR, { planned: 100n }, [1n, 1n]), /twelve weights/);
  assert.throws(() => spreadAnnualToMonths(YEAR, { planned: 100n }, Array.from({ length: 12 }, () => 0n)), /more than zero/);
  assert.throws(() => spreadAnnualToMonths(YEAR, { planned: 100n }, [2n, -1n, ...Array.from({ length: 10 }, () => 1n)]), /cannot be negative/);
}

/**
 * The rule on every small total, both signs: flat, 4-4-5 and a profile whose
 * December weighs 0, over the year, a window, one month and by quarter. Every
 * month has the sign of the total or is zero, months outside the window (or
 * without weight) are zero, the sum is exact, and the cents left over land on
 * the last month with a weight: every other month is exactly
 * trunc(total × weight / Σweights).
 */
function testSignAndSumProperty() {
  const fourFourFive = Array.from({ length: 12 }, (_, i) => ((i + 1) % 3 === 0 ? 5n : 4n));
  const zeroDecember = [...Array.from({ length: 11 }, () => 1n), 0n];
  const windows = [undefined, { start: `${YEAR}-04-01`, end: `${YEAR}-12-31` }, { start: `${YEAR}-02-01`, end: `${YEAR}-04-30` }, { start: `${YEAR}-06-15`, end: `${YEAR}-06-15` }];
  /** `months` against the rule, for `total` over the months (1..12) `counted` weighted by `weights` (indexed by month − 1). */
  const check = (months: bigint[], total: bigint, counted: number[], weights: readonly bigint[], label: string) => {
    assert.equal(months.reduce((sum, m) => sum + m, 0n), total, `${label}: the months add up to the total`);
    for (const m of months) assert.ok(m === 0n || (m > 0n) === (total > 0n), `${label}: every month has the sign of the total or is zero`);
    const sum = counted.reduce((acc, m) => acc + weights[m - 1], 0n);
    const lastWeighted = Math.max(...counted.filter((m) => weights[m - 1] > 0n));
    months.forEach((value, i) => {
      const month = i + 1;
      if (month === lastWeighted) return;
      const expected = counted.includes(month) ? (total * weights[i]) / sum : 0n;
      assert.equal(value, expected, `${label}: month ${month} is its share rounded toward zero, the rest goes to month ${lastWeighted}`);
    });
  };
  let cases = 0;
  for (let total = -500n; total <= 500n; total += 1n) {
    for (const [name, weights] of [['flat', FLAT_WEIGHTS], ['4-4-5', fourFourFive], ['zero December', zeroDecember]] as const) {
      for (const window of windows) {
        const label = `${total} ${name} ${window ? `${window.start}..${window.end}` : 'year'}`;
        const counted = window ? activeMonths(YEAR, window.start, window.end) : months(1, 12);
        const rows = spreadAnnualToMonths(YEAR, { planned: total }, weights, window);
        check(rows.map((r) => r.planned as bigint), total, counted, weights, label);
        cases++;
      }
    }
    for (const [distribution, weights] of [['equal', FLAT_WEIGHTS], ['445', fourFourFive]] as const) {
      const quarters = spreadQuarterlyToMonths(YEAR, 'planned', { Q2: total }, distribution).map((r) => r.planned as bigint);
      check(quarters, total, months(4, 6), weights, `${total} quarterly ${distribution}`);
      cases++;
    }
  }
  assert.equal(cases, 1001 * 14);
}

// ── Periods ───────────────────────────────────────────────────────────────
// A month is active when the period covers its 15th, both bounds inclusive.

const months = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const refused = (fn: () => unknown, pattern: RegExp) => assert.throws(fn, (err: unknown) => err instanceof SpreadInputError && pattern.test((err as Error).message));

function testActiveMonthBoundaries() {
  // Start on the 10th, 15th, 20th of April.
  assert.deepEqual(activeMonths(YEAR, `${YEAR}-04-10`, `${YEAR}-12-31`), months(4, 12));
  assert.deepEqual(activeMonths(YEAR, `${YEAR}-04-15`, `${YEAR}-12-31`), months(4, 12));
  assert.deepEqual(activeMonths(YEAR, `${YEAR}-04-20`, `${YEAR}-12-31`), months(5, 12));
  // End on the 10th, 15th, 20th of September.
  assert.deepEqual(activeMonths(YEAR, `${YEAR}-01-01`, `${YEAR}-09-10`), months(1, 8));
  assert.deepEqual(activeMonths(YEAR, `${YEAR}-01-01`, `${YEAR}-09-15`), months(1, 9));
  assert.deepEqual(activeMonths(YEAR, `${YEAR}-01-01`, `${YEAR}-09-20`), months(1, 9));
  // Same month: active only when the 15th is inside.
  assert.deepEqual(activeMonths(YEAR, `${YEAR}-06-01`, `${YEAR}-06-30`), [6]);
  assert.deepEqual(activeMonths(YEAR, `${YEAR}-06-15`, `${YEAR}-06-15`), [6]);
  assert.deepEqual(activeMonths(YEAR, `${YEAR}-06-16`, `${YEAR}-06-30`), []);
  assert.deepEqual(activeMonths(YEAR, `${YEAR}-06-01`, `${YEAR}-06-14`), []);
  // Between two 15ths: nothing counts (the spread refuses it, see below).
  assert.deepEqual(activeMonths(YEAR, `${YEAR}-04-16`, `${YEAR}-05-14`), []);
}

function testMissingBounds() {
  assert.deepEqual(activeMonths(YEAR), months(1, 12));
  assert.deepEqual(activeMonths(YEAR, null, null), months(1, 12));
  assert.deepEqual(activeMonths(YEAR, `${YEAR}-04-01`, null), months(4, 12));
  assert.deepEqual(activeMonths(YEAR, null, `${YEAR}-03-31`), months(1, 3));
}

function testInvalidPeriods() {
  refused(() => activeMonths(YEAR, `${YEAR}-02-30`, `${YEAR}-12-31`), /not a date/);
  refused(() => activeMonths(YEAR, `${YEAR}-4-1`, `${YEAR}-12-31`), /not a date/);
  refused(() => activeMonths(YEAR, `${YEAR}-01-01`, `${YEAR}-13-01`), /not a date/);
  refused(() => activeMonths(YEAR, `${YEAR - 1}-12-01`, `${YEAR}-12-31`), new RegExp(`within ${YEAR}`));
  refused(() => activeMonths(YEAR, `${YEAR}-01-01`, `${YEAR + 1}-01-31`), new RegExp(`within ${YEAR}`));
  refused(() => activeMonths(YEAR, `${YEAR}-09-01`, `${YEAR}-03-31`), /starts after it ends/);
  // 29 February exists only in leap years (2032 is one, 2031 is not).
  refused(() => activeMonths(2031, '2031-02-29', '2031-12-31'), /not a date/);
  assert.deepEqual(activeMonths(2032, '2032-02-29', '2032-12-31'), months(3, 12));
}

function windowed(total: bigint, start: string, end: string, weights: readonly bigint[] = FLAT_WEIGHTS) {
  const rows = spreadAnnualToMonths(YEAR, { planned: total }, weights, { start, end });
  assert.equal(rows.reduce((sum, r) => sum + (r.planned as bigint), 0n), total, 'the months add up to the total');
  return rows.map((r) => r.planned);
}

function testAnnualWindow() {
  // Milestone: 12 000.00 flat April to December → 1 333.33 × 8, 1 333.36, zero before.
  assert.deepEqual(
    windowed(1_200_000n, `${YEAR}-04-01`, `${YEAR}-12-31`),
    [0n, 0n, 0n, ...Array.from({ length: 8 }, () => 133_333n), 133_336n],
  );
  // 6 000 over July to December: 1 000 a month.
  assert.deepEqual(windowed(600_000n, `${YEAR}-07-01`, `${YEAR}-12-31`), [...Array.from({ length: 6 }, () => 0n), ...Array.from({ length: 6 }, () => 100_000n)]);
  // The remainder lands on the last active month, not December.
  assert.deepEqual(windowed(100n, `${YEAR}-02-01`, `${YEAR}-04-30`), [0n, 33n, 33n, 34n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n]);
  // Negative totals: the same rule, sign kept.
  assert.deepEqual(windowed(-100n, `${YEAR}-02-01`, `${YEAR}-04-30`), [0n, -33n, -33n, -34n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n]);
  // Missing bounds are the whole year: same as no window.
  assert.deepEqual(spreadAnnualToMonths(YEAR, { planned: 558n }, FLAT_WEIGHTS, {}), spreadAnnualToMonths(YEAR, { planned: 558n }));
  // Rows still carry only the measures given, zero outside the window.
  const rows = spreadAnnualToMonths(YEAR, { committed: 600n }, FLAT_WEIGHTS, { start: `${YEAR}-11-01`, end: `${YEAR}-12-31` });
  assert.deepEqual(rows[0], { period: `${YEAR}-01-01`, committed: 0n });
  assert.deepEqual(rows[11], { period: `${YEAR}-12-01`, committed: 300n });

  // 4-4-5 over April to December: weights 4,4,5 per quarter, renormalised over the nine months (Σ = 39).
  const fourFourFive = Array.from({ length: 12 }, (_, i) => ((i + 1) % 3 === 0 ? 5n : 4n));
  assert.deepEqual(
    windowed(3_900_000n, `${YEAR}-04-01`, `${YEAR}-12-31`, fourFourFive),
    [0n, 0n, 0n, 400_000n, 400_000n, 500_000n, 400_000n, 400_000n, 500_000n, 400_000n, 400_000n, 500_000n],
  );
  // The stored 4-4-5 profile (exact weights since 1853680000000) gives the same months.
  const stored445 = profileWeights([4, 4, 5, 4, 4, 5, 4, 4, 5, 4, 4, 5])!;
  assert.deepEqual(windowed(3_900_000n, `${YEAR}-04-01`, `${YEAR}-12-31`, stored445), windowed(3_900_000n, `${YEAR}-04-01`, `${YEAR}-12-31`, fourFourFive));
  assert.deepEqual(planned(5_200_000n, stored445), Array.from({ length: 12 }, (_, i) => ((i + 1) % 3 === 0 ? 500_000n : 400_000n)), '52 000: 4 000 and 5 000 exactly');
}

function testAnnualWindowRefusals() {
  refused(() => spreadAnnualToMonths(YEAR, { planned: 100n }, FLAT_WEIGHTS, { start: `${YEAR}-04-16`, end: `${YEAR}-05-14` }), /No month of the period counts/);
  // A profile giving no weight to the active months is refused, not spread elsewhere.
  const firstHalfOnly = Array.from({ length: 12 }, (_, i) => (i < 6 ? 1n : 0n));
  refused(() => spreadAnnualToMonths(YEAR, { planned: 100n }, firstHalfOnly, { start: `${YEAR}-07-01`, end: `${YEAR}-12-31` }), /no weight/);
  // A zero total is fine over a valid window.
  assert.deepEqual(windowed(0n, `${YEAR}-07-01`, `${YEAR}-12-31`), Array.from({ length: 12 }, () => 0n));
}

function testQuarterlyWindow() {
  const window = { start: `${YEAR}-04-01`, end: `${YEAR}-12-31` };
  // April to December accepts Q1 = 0.
  const rows = spreadQuarterlyToMonths(YEAR, 'committed', { Q1: 0n, Q2: 300n, Q3: 300n, Q4: 300n }, 'equal', window);
  assert.deepEqual(rows.map((r) => r.committed), [0n, 0n, 0n, 100n, 100n, 100n, 100n, 100n, 100n, 100n, 100n, 100n]);
  // A non-zero quarter with no active month is refused, naming the quarter.
  refused(() => spreadQuarterlyToMonths(YEAR, 'committed', { Q1: 100n, Q2: 300n }, 'equal', window), /^Q1 has an amount/);
  // A quarter partly in the period splits over its active months, remainder on the last one.
  const partial = spreadQuarterlyToMonths(YEAR, 'planned', { Q2: 100n }, 'equal', { start: `${YEAR}-05-01`, end: `${YEAR}-12-31` });
  assert.deepEqual(partial.slice(3, 6).map((r) => r.planned), [0n, 50n, 50n]);
  // 4-4-5 inside a partial quarter: May 4, June 5 → 9 000 is 4 000 and 5 000.
  const partial445 = spreadQuarterlyToMonths(YEAR, 'planned', { Q2: 900_000n }, '445', { start: `${YEAR}-05-01`, end: `${YEAR}-12-31` });
  assert.deepEqual(partial445.slice(3, 6).map((r) => r.planned), [0n, 400_000n, 500_000n]);
  // No active month in the year: refused.
  refused(() => spreadQuarterlyToMonths(YEAR, 'planned', { Q2: 0n }, 'equal', { start: `${YEAR}-06-16`, end: `${YEAR}-07-14` }), /No month of the period counts/);
  // The whole year as a window equals no window.
  assert.deepEqual(
    spreadQuarterlyToMonths(YEAR, 'committed', { Q1: 30_000n, Q3: 100n }, 'equal', { start: `${YEAR}-01-01`, end: `${YEAR}-12-31` }),
    spreadQuarterlyToMonths(YEAR, 'committed', { Q1: 30_000n, Q3: 100n }, 'equal'),
  );
}

function main() {
  testFlatSpread();
  testSplitTowardZero();
  testRowsCarryOnlyTheMeasuresGiven();
  testQuarterlySpread();
  testNamedProfile();
  testRefusesUnusableWeights();
  testSignAndSumProperty();
  testActiveMonthBoundaries();
  testMissingBounds();
  testInvalidPeriods();
  testAnnualWindow();
  testAnnualWindowRefusals();
  testQuarterlyWindow();
  console.log('spread.util.spec: ok');
}

main();
