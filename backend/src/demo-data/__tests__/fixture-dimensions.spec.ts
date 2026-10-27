import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { isReservedAnalyticsAxisName } from '../../analytics/analytics-axes.util';
import { ANALYTICS_NAME_MAX } from '../../analytics/analytics-context';
import { RECOMMENDED_DIMENSIONS, SEED_LANGUAGES } from '../../analytics/recommended-dimensions.seed';
import { backendPath } from '../../common/__tests__/backend-root';

// The data set's own dimensions (fixtures/fromage-co/fixture-dimensions.mjs): the four languages
// share codes and value keys, English matches 27-analytics-values.csv, and the budget files'
// English names map to the tenant's language. No database.

const FIXTURES = backendPath('fixtures', 'fromage-co');

type Value = { key: string; name: string; description: string };
type Axis = { code: string; sort_order: number; name: string; description: string; values: Value[] };
type FixtureModule = {
  FIXTURE_LANGUAGES: readonly string[];
  resolveFixtureLanguage: (raw: unknown) => string;
  fixtureDimensions: (language: unknown) => Axis[];
  analyticsValuesText: (language: unknown, fileText: string) => string;
  withFixtureDimensionValues: (rows: Array<Record<string, string>>, language: unknown) => Array<Record<string, string>>;
};

async function load(): Promise<FixtureModule> {
  // The spec compiles to CommonJS. require() cannot load this ESM fixture module, so the
  // import stays inside a string and Node loads it.
  const importer = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<FixtureModule>;
  return importer(pathToFileURL(backendPath('fixtures', 'fromage-co', 'fixture-dimensions.mjs')).href);
}

/** Rows of a `;` fixture file that has no quoted separator. */
function fixtureObjects(name: string): Array<Record<string, string>> {
  const [header, ...lines] = fs.readFileSync(`${FIXTURES}/${name}`, 'utf8').split(/\r?\n/).filter((line) => line.trim() !== '');
  const columns = header.split(';');
  return lines.map((line) => {
    const cells = line.split(';');
    return Object.fromEntries(columns.map((column, index) => [column, cells[index] ?? '']));
  });
}

function testLanguage(mod: FixtureModule) {
  assert.deepEqual([...mod.FIXTURE_LANGUAGES], ['en', 'fr', 'de', 'es']);
  assert.deepEqual(
    ['fr', 'fr-FR', 'DE', 'es_ES', 'en-GB', 'it', '', null].map((raw) => mod.resolveFixtureLanguage(raw)),
    ['fr', 'fr', 'de', 'es', 'en', 'en', 'en', 'en'],
  );
}

function testTables(mod: FixtureModule) {
  const english = mod.fixtureDimensions('en');
  assert.deepEqual(english.map((axis) => [axis.code, axis.sort_order, axis.name]), [
    ['business_domain', 100, 'Business domain'],
    ['reference', 110, 'Budget reference'],
  ]);
  assert.equal(
    english[0].description,
    'The part of the business the spending serves: ERP, e-commerce, shops\u2026 Shared IT serves every business.',
  );
  assert.equal(
    english[1].description,
    'Groups the OPEX and CAPEX lines of one order or one competence center, whatever the supplier',
  );
  const fileValues = fixtureObjects('27-analytics-values.csv');
  assert.deepEqual(
    english.flatMap((axis) => axis.values.map((value) => [axis.code, value.name, value.description])),
    fileValues.map((row) => [row.axis_code, row.name, row.description]),
    'English values are the file, in its order',
  );

  const shape = (language: string) => mod.fixtureDimensions(language).map((axis) => ({
    code: axis.code,
    values: axis.values.map((value) => value.key),
  }));
  for (const language of mod.FIXTURE_LANGUAGES) {
    assert.deepEqual(shape(language), shape('en'), `${language}: same codes, same values, same order as English`);
    const table = mod.fixtureDimensions(language);
    const recommended = new Set(RECOMMENDED_DIMENSIONS[language as (typeof SEED_LANGUAGES)[number]].map((axis) => axis.name.toLowerCase()));
    for (const axis of table) {
      assert.ok(!isReservedAnalyticsAxisName(axis.name), `${language} ${axis.code}: not a reserved name`);
      assert.ok(!recommended.has(axis.name.toLowerCase()), `${language} ${axis.code}: not a recommended dimension's name`);
      const names = new Set<string>();
      for (const text of [axis.name, axis.description, ...axis.values.flatMap((value) => [value.name, value.description])]) {
        assert.ok(text.trim().length > 0 && text === text.trim(), `${language} ${axis.code}: "${text}" is set and trimmed`);
        assert.ok([...text].length <= ANALYTICS_NAME_MAX, `${language} ${axis.code}: "${text}" fits`);
        assert.ok(!text.includes('\u2014'), `${language} ${axis.code}: no em dash`);
        assert.ok(!/[;"\r\n]/.test(text), `${language} ${axis.code}: "${text}" can sit in the values file`);
      }
      for (const value of axis.values) {
        const name = value.name.toLowerCase();
        assert.ok(!names.has(name), `${language} ${axis.code}: "${value.name}" is unique`);
        names.add(name);
      }
    }
  }

  for (const axis of english) {
    const seen = new Map<string, string>();
    for (const language of mod.FIXTURE_LANGUAGES) {
      for (const value of mod.fixtureDimensions(language).find((item) => item.code === axis.code)!.values) {
        const name = value.name.toLowerCase();
        assert.equal(seen.get(name) ?? value.key, value.key, `${axis.code}: "${value.name}" (${language}) names one value only`);
        seen.set(name, value.key);
      }
    }
  }

  const french = mod.fixtureDimensions('fr');
  assert.deepEqual(french.map((axis) => axis.name), ['Domaine métier', 'Référence budgétaire']);
  assert.equal(french[0].values.find((value) => value.key === 'retail')?.name, 'Magasins');
  assert.equal(french[0].values.find((value) => value.key === 'shared it')?.name, 'IT partagée');
  for (const language of mod.FIXTURE_LANGUAGES) {
    const reference = mod.fixtureDimensions(language).find((axis) => axis.code === 'reference')!;
    assert.deepEqual(reference.values.map((value) => value.name), english[1].values.map((value) => value.name), `${language}: budget reference codes stay`);
  }
  assert.notEqual(mod.fixtureDimensions('de').find((axis) => axis.code === 'business_domain')?.name, 'Business domain');
  assert.notEqual(mod.fixtureDimensions('es').find((axis) => axis.code === 'reference')?.name, 'Budget reference');
}

function testBudgetFiles(mod: FixtureModule) {
  const english = mod.fixtureDimensions('en');
  const known = new Map(english.map((axis) => [axis.code, new Set(axis.values.map((value) => value.name))]));
  for (const file of ['14-spend-items.csv', '15-capex-items.csv']) {
    const rows = fixtureObjects(file);
    for (const code of known.keys()) {
      for (const row of rows) {
        const text = (row[`analytics:${code}`] ?? '').trim();
        if (text) assert.ok(known.get(code)!.has(text), `${file}: '${text}' is a value of ${code}`);
      }
    }
    const french = mod.withFixtureDimensionValues(rows, 'fr');
    assert.equal(french.length, rows.length);
    french.forEach((row, index) => {
      for (const [column, value] of Object.entries(rows[index])) {
        if (column !== 'analytics:business_domain' && column !== 'analytics:reference') assert.equal(row[column], value);
      }
      const business = (rows[index]['analytics:business_domain'] ?? '').trim();
      if (business) {
        const key = business.toLowerCase();
        assert.equal(row['analytics:business_domain'], mod.fixtureDimensions('fr')[0].values.find((value) => value.key === key)?.name);
      } else {
        assert.equal(row['analytics:business_domain'], rows[index]['analytics:business_domain']);
      }
    });
    assert.equal(mod.withFixtureDimensionValues(rows, 'en'), rows, `${file}: English rows are unchanged`);
  }
  assert.throws(() => mod.withFixtureDimensionValues([{ 'analytics:business_domain': 'Unknown' }], 'fr'), /Unknown/);
}

function testValuesFile(mod: FixtureModule) {
  const original = fs.readFileSync(`${FIXTURES}/27-analytics-values.csv`, 'utf8');
  assert.equal(mod.analyticsValuesText('en', original), original, 'English sends the file unchanged');
  assert.equal(mod.analyticsValuesText('en-GB', original), original);
  const french = mod.analyticsValuesText('fr', original);
  assert.ok(french.endsWith('\n'));
  const rows = french.trim().split('\n').slice(1).map((line) => line.split(';'));
  const expected = mod.fixtureDimensions('fr').flatMap((axis) => axis.values.map((value) => [axis.code, value.name, value.description, 'enabled']));
  assert.deepEqual(rows, expected, 'French names and descriptions, same codes and status');
  assert.ok(!rows.some((row) => row[1] === 'Retail' || row[1] === 'Shared IT' || row[1] === 'Supply chain'));
  assert.ok(rows.some((row) => row[1] === 'Magasins'));
  assert.ok(rows.some((row) => row[1] === 'REF-SAP-S4'));
}

async function main() {
  const mod = await load();
  const tests = [testLanguage, testTables, testBudgetFiles, testValuesFile];
  const failures: string[] = [];
  for (const test of tests) {
    try {
      test(mod);
    } catch (err) {
      console.error(`${test.name}:`, err);
      failures.push(test.name);
    }
  }
  if (failures.length) {
    console.error(`fixture-dimensions.spec: ${failures.length} failing: ${failures.join(', ')}`);
    process.exit(1);
  }
  console.log('fixture-dimensions.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
