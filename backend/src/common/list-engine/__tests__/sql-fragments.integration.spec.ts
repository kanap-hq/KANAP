import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { QueryRunner } from 'typeorm';
import dataSource from '../../../data-source';
import { centsToNumber, formatCents, toCents } from '../../amount';
import { divRoundHalfAway as jsDivRoundHalfAway } from '../../decimal';
import { compileAgFilterCondition, createParamNameGenerator } from '../../ag-grid-filtering';
import { FxRateService } from '../../../currency/fx-rate.service';
import {
  centsNumber,
  centsText,
  codePointCompare,
  decimal2ToFloat,
  divRoundHalfAway,
  epochDay,
  fold,
  jsCents,
  jsIsoString,
  jsLower,
  jsRound,
  jsTrim,
  jsUpper,
  naturalCompare,
  sqlLiteral,
  sumJsCents,
  textSortKey,
  utcDay,
} from '../sql-fragments';
import { bindNamed, SqlStatement } from '../sql-statement';
import { assertListEngineSupport, checkListEngineSupport, resetListEngineSupportForTests } from '../list-engine-support';
import { loadOracleFold } from '../../../spend/__tests__/oracle/budget-summary.oracle';
import { prng } from '../../../spend/__tests__/oracle/budget-list.fixture';

// Each SQL fragment of the list engine against the JavaScript rule it
// reproduces (design 2.6), on generated strings and doubles.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file in its serial database lane.

const r = prng(424242);

const SPECIAL = [
  'İstanbul', 'ISTANBUL', 'ıi', 'ẞtraße', 'STRASSE', 'ΟΔΟΣ', 'ΣΟΦΟΣ ΟΔΟΣ', 'σς', 'Ǆemal', 'ǅ', 'ǆ', 'Œuvre', 'æther', 'ﬁne', 'ŉ',
  'école', 'Éçole', '𝒜stral', '😀 smile', ' nbsp ', ' em space ', '﻿bom', ' \t\n tabs \r', ' line ',
  'Ångström', 'Électricité', 'électricité', 'ELECTRICITE', 'ĳ', 'Ⅻ', '℃', '½', 'Ǳ', 'ﬀ', 'Ǉ', '', ' ', 'a\u0000'.slice(0, 1), 'ß', 'ǰ',
  'Ꭰ', 'ꭰ', 'private', '�replacement', 'Zébu', 'zebu', 'Zebu', 'ZEBU', 'a, b', '%_\\',
];

function randomString(): string {
  const pools = [
    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    'àâäéèêëîïôöùûüÿçÀÂÄÉÈÊËÎÏÔÖÙÛÜŸÇœŒæÆß',
    'ΑΒΓΔΣσςαβγδİıĞğŞşÅåØøĳĲǄǅǆ',
    '   \t-_%\\,.\'"',
    '̧́̀̈',
  ];
  const length = r.int(0, 14);
  let out = '';
  for (let i = 0; i < length; i++) {
    const pool = r.pick(pools);
    out += pool[r.int(0, pool.length - 1)];
  }
  if (r.chance(0.05)) out += '𝒜😀';
  return out;
}

const STRINGS = [...SPECIAL, ...Array.from({ length: 800 }, randomString)];

async function sqlOverStrings(runner: QueryRunner, expr: (x: string) => string, values: string[] = STRINGS): Promise<string[]> {
  const rows: Array<{ v: string }> = await runner.query(
    `SELECT ${expr('t.x')} AS v FROM unnest($1::text[]) WITH ORDINALITY AS t(x, n) ORDER BY t.n`,
    [values],
  );
  return rows.map((row) => row.v);
}

async function testCaseMappingAndTrim(runner: QueryRunner) {
  const lower = await sqlOverStrings(runner, jsLower);
  const upper = await sqlOverStrings(runner, jsUpper);
  const trimmed = await sqlOverStrings(runner, jsTrim);
  STRINGS.forEach((s, i) => {
    assert.equal(lower[i], s.toLowerCase(), `jsLower(${JSON.stringify(s)})`);
    assert.equal(upper[i], s.toUpperCase(), `jsUpper(${JSON.stringify(s)})`);
    assert.equal(trimmed[i], s.trim(), `jsTrim(${JSON.stringify(s)})`);
  });
}

async function testFoldEqualsTheOracleFold(runner: QueryRunner) {
  const oracleFold = await loadOracleFold(runner.manager);
  const folded = await sqlOverStrings(runner, fold);
  STRINGS.forEach((s, i) => assert.equal(folded[i], oracleFold(s), `fold(${JSON.stringify(s)})`));
  assert.equal(oracleFold('Électricité ÆON Straße'), 'electricite aeon strasse');
}

async function testJsRound(runner: QueryRunner) {
  const doubles = [
    0.5, 1.5, 2.5, -0.5, -1.5, -2.5, 0.49999999999999994, -0.49999999999999994, 4503599627370495.5, 4503599627370497, -4503599627370495.5,
    1e15 + 0.5, 0, -0, 2.675 * 100, 1.005 * 100, 28.999999999999996, 0.1 + 0.2,
    ...Array.from({ length: 400 }, () => (r.next() - 0.5) * 10 ** r.int(0, 15)),
    ...Array.from({ length: 200 }, () => r.int(-100000, 100000) + 0.5),
  ];
  const rows: Array<{ v: string }> = await runner.query(
    `SELECT (${jsRound('t.x')})::text AS v FROM unnest($1::float8[]) WITH ORDINALITY AS t(x, n) ORDER BY t.n`,
    [doubles.map(String)],
  );
  doubles.forEach((x, i) => assert.equal(Number(rows[i].v), Math.round(x) === 0 ? 0 : Math.round(x), `jsRound(${x})`));
}

/** The FX chain of the builder: `toCents(convertValue(Number(formatCents(c)), rate))`. */
async function testFxConversionToTheCent(runner: QueryRunner) {
  const fx = new FxRateService(undefined as any, undefined as any);
  const cents: bigint[] = [];
  const rates: number[] = [];
  for (let i = 0; i < 3000; i++) {
    cents.push(BigInt(r.int(-99_999_999, 99_999_999)) * BigInt(r.chance(0.1) ? 1000 : 1));
    rates.push(r.pick([1, 0.881812, 1.169828, 0.92389, 1.180818, 1.0471, 0.5, 0.913579, 1 + r.next(), r.next() * 3]));
  }
  const rows: Array<{ v: string }> = await runner.query(
    `SELECT (${jsRound(`(t.c::numeric / 100)::float8 * t.r * 100`)})::bigint::text AS v
       FROM unnest($1::bigint[], $2::float8[]) WITH ORDINALITY AS t(c, r, n) ORDER BY t.n`,
    [cents.map(String), rates.map(String)],
  );
  cents.forEach((c, i) => {
    const expected = toCents(fx.convertValue(Number(formatCents(c)), rates[i]));
    assert.equal(rows[i].v, expected.toString(), `convert ${formatCents(c)} × ${rates[i]}`);
  });
}

async function testCentsAsJavaScriptNumbers(runner: QueryRunner) {
  const cents = [
    0n, 1n, -1n, 10n, 30n, 100n, -250n, 123456789n, 99999999999999n, 2n ** 53n - 1n, -(2n ** 53n) + 1n, 2n ** 53n + 7n,
    ...Array.from({ length: 500 }, () => BigInt(r.int(-(10 ** 9), 10 ** 9))),
    ...Array.from({ length: 500 }, () => BigInt(r.int(0, 2 ** 31)) * BigInt(r.int(0, 2 ** 21)) * (r.chance(0.5) ? 1n : -1n)),
  ];
  const rows: Array<{ t: string; n: string }> = await runner.query(
    `SELECT ${centsText('t.c')} AS t, (${centsNumber('t.c')})::text AS n FROM unnest($1::bigint[]) WITH ORDINALITY AS t(c, k) ORDER BY t.k`,
    [cents.map(String)],
  );
  cents.forEach((c, i) => {
    const number = Number(formatCents(c));
    assert.equal(centsToNumber(c), number, `centsToNumber(${c})`);
    // The SQL forms match below 10^15 cents (10^13 in the currency); beyond, a double no longer holds two decimals.
    if (c >= 10n ** 15n || c <= -(10n ** 15n)) return;
    assert.equal(rows[i].t, String(number), `String of ${c} cents`);
    assert.equal(Number(rows[i].n), number, `Number of ${c} cents`);
  });
}

/**
 * Amounts of every size a version can total (twelve months of numeric(18,2):
 * up to 1.2e19 cents, past a bigint): `decimal2ToFloat` is the double
 * JavaScript parses, and the engine's chain summed by `sumJsCents` is the
 * builder's `toCents(convertValue(Number(formatCents(c)), rate))`: to the
 * cent below 10^15 converted cents; beyond, the same double (PostgreSQL and
 * V8 may print a shortest form differently on a tie, in the 17th digit).
 */
async function testAmountsOfEverySize(runner: QueryRunner) {
  const fx = new FxRateService(undefined as any, undefined as any);
  const big = (digits: number) => BigInt(Array.from({ length: digits }, (_, i) => (i === 0 ? r.int(1, 9) : r.int(0, 9))).join(''));
  const cents: bigint[] = [
    0n, 1n, -1n, 2n ** 53n - 1n, 2n ** 53n, 2n ** 53n + 1n, -(2n ** 53n) - 3n, 10n ** 15n - 1n, 10n ** 15n, 10n ** 15n + 1n,
    9223372036854775807n, 9223372036854775808n, 11999999999999999988n, -11999999999999999988n,
    ...Array.from({ length: 600 }, () => big(r.int(14, 20)) * (r.chance(0.3) ? -1n : 1n)),
  ];
  const rates = cents.map(() => r.pick([1, 0.881812, 1.169828, 0.913579, 1 + r.next(), r.next() * 3, 0]));
  // `c * 0.01`: a 2-decimal numeric like the stored totals (`c / 100` would keep 16 significant digits only).
  const rows: Array<{ f: number; c: string }> = await runner.query(
    `SELECT (${decimal2ToFloat('x.v')})::text AS f, ${sumJsCents(jsRound(`${decimal2ToFloat('x.v')} * x.r * 100`))}::text AS c
       FROM (SELECT t.k, t.c * 0.01 AS v, t.r FROM unnest($1::numeric[], $2::float8[]) WITH ORDINALITY AS t(c, r, k)) x
      GROUP BY x.k, x.v, x.r ORDER BY x.k`,
    [cents.map(String), rates.map(String)],
  );
  let beyond = 0;
  cents.forEach((c, i) => {
    const amount = Number(formatCents(c));
    assert.equal(Number(rows[i].f), amount, `decimal2ToFloat of ${c} cents`);
    const expected = toCents(fx.convertValue(amount, rates[i]));
    if (expected < 10n ** 15n && expected > -(10n ** 15n)) {
      assert.equal(rows[i].c, expected.toString(), `converted cents of ${c} × ${rates[i]}`);
    } else {
      beyond += 1;
      assert.equal(Number(formatCents(BigInt(rows[i].c))), Number(formatCents(expected)), `converted amount of ${c} × ${rates[i]}`);
    }
  });
  assert.ok(beyond > 100, 'the sample reaches past 10^15 converted cents');
}

/**
 * `jsCents(r)`: the cents JavaScript keeps of one converted amount, `toCents(r / 100)`,
 * for every double holding an integer, from 0 to the largest finite double: exact
 * below 10^15; beyond, the same double (V8 and PostgreSQL may print a tie of the
 * shortest form differently, in the 17th digit), counted.
 */
async function testJsCents(runner: QueryRunner) {
  // Its own stream: the samples of the other tests stay those of earlier runs.
  const r = prng(20261003);
  const big = (lo: number, hi: number) => Math.floor(lo + r.next() * (hi - lo));
  const values: number[] = [
    0, 1, -1, 99, -99, 100, 12345, -12345, 2 ** 53 - 1, -(2 ** 53 - 1), 2 ** 53, 1e15 - 1, -(1e15 - 1), 1e15, -1e15, 1e15 + 2,
    1e16, 123456789012345680, -123456789012345680, 1e21, 1e22, 1.2e19, -1.2e19, 9.223372036854776e18, 1e100, 1.7976931348623157e308, -1.7976931348623157e308,
    ...Array.from({ length: 300 }, () => big(0, 1e15) * (r.chance(0.3) ? -1 : 1)),
    ...Array.from({ length: 300 }, () => big(1e15, 1e18) * (r.chance(0.3) ? -1 : 1)),
    ...Array.from({ length: 100 }, () => Math.floor(10 ** (15 + r.next() * 293)) * (r.chance(0.3) ? -1 : 1)),
  ].filter((v) => Number.isFinite(v)).map((v) => (Object.is(v, -0) ? 0 : v));
  const rows: Array<{ c: string }> = await runner.query(
    `SELECT (${jsCents('t.r')})::text AS c FROM unnest($1::float8[]) WITH ORDINALITY AS t(r, n) ORDER BY t.n`,
    [values.map(String)],
  );
  let beyond = 0;
  let printedApart = 0;
  values.forEach((v, i) => {
    const expected = toCents(v / 100);
    const sql = BigInt(rows[i].c);
    if (Math.abs(v) < 1e15) {
      assert.equal(sql, expected, `jsCents(${v})`);
      return;
    }
    beyond += 1;
    if (sql !== expected) printedApart += 1;
    assert.equal(Number(formatCents(sql)), Number(formatCents(expected)), `jsCents(${v}): the same double`);
  });
  assert.ok(beyond > 300, 'the sample reaches past 10^15');
  assert.ok(printedApart <= beyond / 20, `shortest forms printed apart rarely (${printedApart} of ${beyond})`);
  console.log(`jsCents: ${values.length} values, ${beyond} past 10^15, ${printedApart} printed apart by V8 and PostgreSQL (same double)`);
}

/**
 * `divRoundHalfAway(n, d)` against `common/decimal.ts`: integer numerics up to
 * 10^30 and beyond, negatives, divisors from 1 to 10^30, every tie (a remainder
 * of exactly half the divisor) rounded away from zero.
 */
async function testDivRoundHalfAway(runner: QueryRunner) {
  const r = prng(20261004);
  const bigint = (digits: number) => BigInt(Array.from({ length: digits }, (_, i) => (i === 0 ? r.int(1, 9) : r.int(0, 9))).join(''));
  const pairs: Array<[bigint, bigint]> = [
    [0n, 1n], [1n, 2n], [-1n, 2n], [3n, 2n], [-3n, 2n], [5n, 10n], [-5n, 10n], [4n, 10n], [-4n, 10n], [6n, 10n], [-6n, 10n],
    [7n, 7n], [-7n, 7n], [10n ** 30n, 3n], [-(10n ** 30n), 3n], [10n ** 30n + 1n, 2n], [-(10n ** 30n) - 1n, 2n], [10n ** 30n, 10n ** 30n],
    [5n * 10n ** 29n, 10n ** 30n], [-5n * 10n ** 29n, 10n ** 30n], [10n ** 30n - 1n, 2n * 10n ** 30n],
  ];
  for (let k = 0; k < 600; k++) {
    const d = r.chance(0.2) ? bigint(r.int(16, 31)) : BigInt(r.int(1, 1_000_000));
    // A third of the numerators are ties: an odd multiple of half an even divisor.
    const tie = r.chance(0.33) && d % 2n === 0n;
    const n = tie ? (bigint(r.int(1, 25)) * 2n + 1n) * (d / 2n) : bigint(r.int(1, 33));
    pairs.push([r.chance(0.4) ? -n : n, d]);
  }
  const rows: Array<{ q: string }> = await runner.query(
    `SELECT (${divRoundHalfAway('t.n', 't.d')})::text AS q FROM unnest($1::numeric[], $2::numeric[]) WITH ORDINALITY AS t(n, d, k) ORDER BY t.k`,
    [pairs.map(([n]) => n.toString()), pairs.map(([, d]) => d.toString())],
  );
  pairs.forEach(([n, d], i) => assert.equal(BigInt(rows[i].q), jsDivRoundHalfAway(n, d), `divRoundHalfAway(${n}, ${d})`));
  // Over bigint counts too (a group's line count).
  const [row] = await runner.query(`SELECT (${divRoundHalfAway('$1::numeric', '$2::bigint')})::text AS q`, ['-25', '10']);
  assert.equal(row.q, '-3', 'a bigint divisor');
}

function testSqlLiteralRefusesParameters() {
  assert.equal(sqlLiteral("l'été"), "'l''été'");
  assert.equal(sqlLiteral('cost $ 5'), "'cost $ 5'");
  assert.throws(() => sqlLiteral('price $1'), /parameter/);
}

async function testTimestampsAsJavaScriptSeesThem(runner: QueryRunner) {
  const stamps = ['2026-10-01T12:34:56.123456Z', '2026-10-01T12:34:56.999999Z', '1999-12-31T23:59:59.9995Z', '2025-12-31T23:30:00Z', '2026-01-01T00:00:00.0004Z'];
  const rows: Array<{ ts: Date; iso: string; day: number }> = await runner.query(
    `SELECT t.x AS ts, ${jsIsoString('t.x')} AS iso, ${epochDay(utcDay('t.x'))} AS day FROM unnest($1::timestamptz[]) WITH ORDINALITY AS t(x, n) ORDER BY t.n`,
    [stamps],
  );
  for (const row of rows) {
    assert.equal(row.iso, row.ts.toISOString(), 'ISO form of the millisecond-truncated timestamp');
    assert.equal(Number(row.day), Date.UTC(row.ts.getUTCFullYear(), row.ts.getUTCMonth(), row.ts.getUTCDate()) / 86_400_000);
  }
}

async function testTextOrder(runner: QueryRunner) {
  // V8 opens its ICU collator with normalization on, PostgreSQL's ICU collations leave it off: they
  // agree on every canonically ordered string (NFC or NFD, as typed or pasted names are) and may
  // differ only on combining marks out of canonical order. Such strings stay out of this check.
  const canonical = (s: string) => s === s.normalize('NFC') || s === s.normalize('NFD');
  const values = Array.from(new Set(STRINGS.filter((s) => s !== '' && canonical(s))));
  const rows: Array<{ v: string }> = await runner.query(`SELECT t.x AS v FROM unnest($1::text[]) AS t(x) ORDER BY ${textSortKey('t.x')}`, [values]);
  const expected = [...values].sort(naturalCompare);
  assert.deepEqual(rows.map((row) => row.v), expected, 'ORDER BY the ICU sort key = the natural order');
  const bytes: Array<{ v: string }> = await runner.query(`SELECT t.x AS v FROM unnest($1::text[]) AS t(x) ORDER BY t.x COLLATE "C"`, [values]);
  assert.deepEqual(bytes.map((row) => row.v), [...values].sort(codePointCompare), 'code point order = COLLATE "C"');
  assert.ok(naturalCompare('Électricité', 'Electricite') > 0 && naturalCompare('Électricité', 'Zébu') < 0, 'accented letters sort next to their base letter');
}

async function testExcludeIsTheComplementInSql(runner: QueryRunner) {
  const table = `(VALUES ('a'), ('b'), (NULL), (''), ('A')) AS c(name)`;
  const run = async (model: any) => {
    const compiled = compileAgFilterCondition(model, { expression: 'c.name' }, createParamNameGenerator('p'))!;
    const stmt = new SqlStatement('00000000-0000-0000-0000-000000000000');
    const where = bindNamed(stmt, compiled.sql, compiled.params);
    const final = stmt.finalize(`SELECT coalesce(c.name, '<null>') AS v FROM ${table} WHERE ${where} ORDER BY 1`);
    return (await runner.query(final.sql, final.params)).map((row: any) => row.v);
  };
  for (const values of [['a'], ['a', null], [], [null], ['a', 'b', 'A', null, '']]) {
    const kept = await run({ filterType: 'set', values });
    const excluded = await run({ filterType: 'set', mode: 'exclude', values });
    assert.deepEqual([...kept, ...excluded].sort(), ['', '<null>', 'A', 'a', 'b'].sort(), `include and exclude of ${JSON.stringify(values)} partition the rows`);
  }
}

function testFinalizeKeepsOnlyUsedParameters() {
  const stmt = new SqlStatement('tenant');
  const unused = stmt.bind('never read');
  const used = stmt.bind(42, 'int');
  const final = stmt.finalize(`SELECT ${used} WHERE tenant = ${stmt.tenant}`);
  assert.equal(unused, '$2');
  assert.deepEqual(final, { sql: 'SELECT $1::int WHERE tenant = $2', params: [42, 'tenant'] });
  const named = new SqlStatement('t');
  assert.equal(bindNamed(named, 'x IN (:...p0) AND y = :p1 AND z::text = :missing', { p0: [1, 2], p1: 'a' }), 'x IN ($2, $3) AND y = $4 AND z::text = :missing');
}

async function testSupportCheck(runner: QueryRunner) {
  resetListEngineSupportForTests();
  assert.equal(await checkListEngineSupport(runner.manager), true, 'this database has ICU and unaccent');
  await assertListEngineSupport(runner.manager);
  resetListEngineSupportForTests();
  const without = { query: async () => [{ icu: false, unaccent: true }] } as any;
  assert.equal(await checkListEngineSupport(without), false);
  await assert.rejects(assertListEngineSupport(without), (err: any) => err?.getStatus?.() === 503 && /ICU/.test(err.message), 'a database without ICU answers 503 with the requirement');
  resetListEngineSupportForTests();
}

async function main() {
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  const failures: string[] = [];
  try {
    for (const [name, test] of [
      ['case mapping and trim', () => testCaseMappingAndTrim(runner)],
      ['fold equals the oracle fold', () => testFoldEqualsTheOracleFold(runner)],
      ['jsRound', () => testJsRound(runner)],
      ['FX conversion to the cent', () => testFxConversionToTheCent(runner)],
      ['cents as JavaScript numbers', () => testCentsAsJavaScriptNumbers(runner)],
      ['amounts of every size', () => testAmountsOfEverySize(runner)],
      ['jsCents', () => testJsCents(runner)],
      ['divRoundHalfAway', () => testDivRoundHalfAway(runner)],
      ['sqlLiteral refuses parameters', async () => testSqlLiteralRefusesParameters()],
      ['timestamps as JavaScript sees them', () => testTimestampsAsJavaScriptSeesThem(runner)],
      ['text order', () => testTextOrder(runner)],
      ['exclude is the complement in SQL', () => testExcludeIsTheComplementInSql(runner)],
      ['finalize keeps only used parameters', async () => testFinalizeKeepsOnlyUsedParameters()],
      ['support check', () => testSupportCheck(runner)],
    ] as Array<[string, () => Promise<void>]>) {
      try {
        await test();
      } catch (err) {
        failures.push(`${name}: ${(err as Error).message}`);
      }
    }
  } finally {
    await runner.release();
    await dataSource.destroy();
  }
  if (failures.length) {
    console.error(`sql-fragments.integration.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
    process.exit(1);
  }
  console.log('sql-fragments.integration.spec: ok');
}

void main();
