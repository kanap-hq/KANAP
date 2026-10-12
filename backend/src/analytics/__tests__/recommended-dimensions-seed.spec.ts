import * as assert from 'node:assert/strict';
import { isReservedAnalyticsAxisName } from '../analytics-axes.util';
import { ANALYTICS_NAME_MAX } from '../analytics-context';
import { ANALYTICS_AXIS_CODE_PATTERN } from '../analytics-axes.service';
import {
  costPoolNames,
  RECOMMENDED_DIMENSION_KEYS,
  RECOMMENDED_DIMENSIONS,
  recommendedDimensionNameCandidate,
  resolveSeedLanguage,
  SEED_LANGUAGES,
  STARTING_DIMENSION_KEYS,
} from '../recommended-dimensions.seed';

// The tables of the recommended dimensions (`recommended-dimensions.seed.ts`): the four languages
// have the same dimensions, codes and values, in the same order; every name and description is
// there and valid. No database.

function testLanguagesMatch() {
  assert.deepEqual([...SEED_LANGUAGES], ['en', 'fr', 'de', 'es']);
  const shape = (language: (typeof SEED_LANGUAGES)[number]) => RECOMMENDED_DIMENSIONS[language].map((dimension) => ({
    key: dimension.key,
    code: dimension.code,
    values: dimension.values.map((value) => value.key),
  }));
  for (const language of SEED_LANGUAGES) {
    assert.deepEqual(shape(language), shape('en'), `${language}: same codes, same values, same order as English`);
  }
  assert.deepEqual(RECOMMENDED_DIMENSIONS.en.map((dimension) => dimension.key), [...RECOMMENDED_DIMENSION_KEYS]);
  assert.deepEqual(RECOMMENDED_DIMENSIONS.en.map((dimension) => dimension.values.length), [8, 11, 7, 4, 2]);
  assert.deepEqual([...STARTING_DIMENSION_KEYS], ['cost_pool', 'it_tower', 'purpose', 'priority'], 'the recurrence is the optional pack');
}

function testNamesAndDescriptions() {
  for (const language of SEED_LANGUAGES) {
    const table = RECOMMENDED_DIMENSIONS[language];
    const names = table.map((dimension) => dimension.name.toLowerCase());
    assert.equal(new Set(names).size, names.length, `${language}: dimension names are unique`);
    for (const dimension of table) {
      assert.match(dimension.code, ANALYTICS_AXIS_CODE_PATTERN, `${dimension.code}: a valid code`);
      assert.ok(!isReservedAnalyticsAxisName(dimension.name), `${language} ${dimension.code}: not a reserved name`);
      for (const text of [dimension.name, dimension.description, ...dimension.values.flatMap((value) => [value.name, value.description])]) {
        assert.ok(text.trim().length > 0 && text === text.trim(), `${language} ${dimension.code}: "${text}" is set and trimmed`);
        assert.ok([...text].length <= ANALYTICS_NAME_MAX, `${language} ${dimension.code}: "${text}" fits`);
        assert.ok(!text.includes('—'), `${language} ${dimension.code}: no em dash`);
      }
      const values = dimension.values.map((value) => value.name.toLowerCase());
      assert.equal(new Set(values).size, values.length, `${language} ${dimension.code}: value names are unique`);
    }
    // The taxonomy terms the brief asks the descriptions to cite.
    assert.match(table[0].description, /TBM/, `${language}: the cost pool cites TBM`);
    assert.match(table[1].description, /TBM/, `${language}: the IT tower cites TBM`);
  }
  assert.deepEqual(costPoolNames(), ['Cost pool', 'Nature de coût', 'Kostenart', 'Tipo de coste']);
}

function testHelpers() {
  assert.deepEqual(['fr', 'fr-FR', 'DE', 'es_ES', 'en-GB', 'it', '', null].map(resolveSeedLanguage), ['fr', 'fr', 'de', 'es', 'en', 'en', 'en', 'en']);
  assert.deepEqual([0, 1, 2].map((attempt) => recommendedDimensionNameCandidate('Priority', attempt)), ['Priority', 'Priority (2)', 'Priority (3)']);
}

const tests = [testLanguagesMatch, testNamesAndDescriptions, testHelpers];
const failures: string[] = [];
for (const test of tests) {
  try {
    test();
  } catch (err) {
    console.error(`${test.name}:`, err);
    failures.push(test.name);
  }
}
if (failures.length) {
  console.error(`recommended-dimensions-seed.spec: ${failures.length} failing: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('recommended-dimensions-seed.spec: ok');
