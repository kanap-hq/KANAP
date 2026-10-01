import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { QueryRunner } from 'typeorm';
import dataSource from '../../../data-source';
import { formatCents, toCents } from '../../amount';
import { compileAgFilterCondition, createParamNameGenerator } from '../../ag-grid-filtering';
import { FxRateService } from '../../../currency/fx-rate.service';
import {
  centsNumber,
  centsText,
  codePointCompare,
  epochDay,
  fold,
  jsIsoString,
  jsLower,
  jsRound,
  jsTrim,
  jsUpper,
  naturalCompare,
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
  const cents = [0n, 1n, -1n, 10n, 30n, 100n, -250n, 123456789n, 99999999999999n, ...Array.from({ length: 500 }, () => BigInt(r.int(-(10 ** 9), 10 ** 9)))];
  const rows: Array<{ t: string; n: string }> = await runner.query(
    `SELECT ${centsText('t.c')} AS t, (${centsNumber('t.c')})::text AS n FROM unnest($1::bigint[]) WITH ORDINALITY AS t(c, k) ORDER BY t.k`,
    [cents.map(String)],
  );
  cents.forEach((c, i) => {
    const number = Number(formatCents(c));
    assert.equal(rows[i].t, String(number), `String of ${c} cents`);
    assert.equal(Number(rows[i].n), number, `Number of ${c} cents`);
  });
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
