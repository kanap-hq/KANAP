import * as assert from 'node:assert/strict';
import {
  activeMonths,
  FLAT_WEIGHTS,
  profileWeights,
  SpreadInputError,
  spreadAnnualToMonths,
  spreadQuarterlyToMonths,
} from '../spread.util';

// Spreads in integer cents: each month is round-half-away-from-zero of its
// exact share, the remainder goes to the last month (of the year or quarter).

const YEAR = 2031;

function planned(total: bigint, weights: readonly bigint[] = FLAT_WEIGHTS) {
  const rows = spreadAnnualToMonths(YEAR, { planned: total }, weights);
  assert.equal(rows.reduce((sum, r) => sum + (r.planned as bigint), 0n), total, 'the months add up to the total');
  return rows.map((r) => r.planned);
}

const elevenThen = (month: bigint, last: bigint) => [...Array.from({ length: 11 }, () => month), last];

function testFlatSpread() {
  // 558 / 12 = 46.5 → 47; 558 − 11 × 47 = 41.
  assert.deepEqual(planned(558n), elevenThen(47n, 41n));
  assert.deepEqual(planned(1_200_000n), Array.from({ length: 12 }, () => 100_000n));
  assert.deepEqual(planned(10_000n), elevenThen(833n, 837n));
  assert.deepEqual(planned(-558n), elevenThen(-47n, -41n));
  // 30 / 12 = 2.5 → 3 each; the remainder (−6) makes December −3.
  assert.deepEqual(planned(30n), elevenThen(3n, -3n));
  assert.deepEqual(planned(0n), Array.from({ length: 12 }, () => 0n));
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
}

function testRefusesUnusableWeights() {
  assert.throws(() => spreadAnnualToMonths(YEAR, { planned: 100n }, [1n, 1n]), /twelve weights/);
  assert.throws(() => spreadAnnualToMonths(YEAR, { planned: 100n }, Array.from({ length: 12 }, () => 0n)), /more than zero/);
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
  // The stored 4-4-5 profile (decimal weights) gives the same months.
  const stored445 = profileWeights(Array.from({ length: 12 }, (_, i) => ((i + 1) % 3 === 0 ? 0.0961538462 : 0.0769230769)))!;
  assert.deepEqual(windowed(3_900_000n, `${YEAR}-04-01`, `${YEAR}-12-31`, stored445), windowed(3_900_000n, `${YEAR}-04-01`, `${YEAR}-12-31`, fourFourFive));
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
  testRowsCarryOnlyTheMeasuresGiven();
  testQuarterlySpread();
  testNamedProfile();
  testRefusesUnusableWeights();
  testActiveMonthBoundaries();
  testMissingBounds();
  testInvalidPeriods();
  testAnnualWindow();
  testAnnualWindowRefusals();
  testQuarterlyWindow();
  console.log('spread.util.spec: ok');
}

main();
