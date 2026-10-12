import * as assert from 'node:assert/strict';
import {
  CAPEX_DIMENSION_LANGUAGES,
  CAPEX_DIMENSION_SQL,
  capexDimensionNameCandidate,
  capexDimensionTable,
} from '../capex-dimensions.seed';
import {
  CAPEX_CRITERIA,
  CAPEX_DIMENSION_SQL as MIGRATION_SQL,
} from '../../migrations/1853980000000-capex-criteria-dimensions';

// The frozen table of the three CAPEX dimensions older tenants received (`capex-dimensions.seed.ts`)
// and migration 1853980000000, which gave the tenants of its time the same dimensions with its own
// copy of the table and of the SQL: both copies must stay equal (codes, names, values and their
// order, statements). New tenants get the recommended dimensions instead. No database.

function testTablesAreEqual() {
  const migration = CAPEX_CRITERIA.map((criterion) => ({
    code: criterion.code,
    name: criterion.name,
    values: criterion.values.map((value) => ({ key: value.key, name: value.name })),
  }));
  assert.deepEqual(migration, capexDimensionTable('en'), 'the migration table is the English table of the seed');
}

function testStatementsAreEqual() {
  assert.deepEqual(MIGRATION_SQL, CAPEX_DIMENSION_SQL, 'the migration runs the seed statements');
}

function testTable() {
  assert.deepEqual(CAPEX_DIMENSION_LANGUAGES, ['en'], 'English only: the table is frozen');
  const table = capexDimensionTable();
  assert.deepEqual(table.map((dimension) => dimension.code), ['ppe_type', 'investment_type', 'priority'], 'codes, in their order');
  assert.deepEqual(table.map((dimension) => dimension.name), ['PP&E type', 'Investment type', 'Priority']);
  assert.deepEqual(table.map((dimension) => dimension.values.map((value) => value.name)), [
    ['Hardware', 'Software'],
    ['Replacement', 'Capacity', 'Productivity', 'Security', 'Conformity', 'Business growth', 'Other'],
    ['Mandatory', 'High', 'Medium', 'Low'],
  ], 'the values in their business order (the former enums declaration order)');
  assert.equal(table.flatMap((dimension) => dimension.values).length, 13);
  for (const dimension of table) {
    // A code the dimension check accepts (`^[a-z0-9][a-z0-9_-]{0,39}$`).
    assert.match(dimension.code, /^[a-z0-9][a-z0-9_-]{0,39}$/);
    // The name of a value of before, read back by the migration's down(): the code with spaces.
    for (const value of dimension.values) assert.equal(value.name.toLowerCase().replace(/\s+/g, '_'), value.key);
  }
}

function testNameCandidates() {
  assert.deepEqual([0, 1, 2, 3].map((attempt) => capexDimensionNameCandidate('Priority', attempt)), [
    'Priority', 'Priority (CAPEX)', 'Priority (CAPEX 2)', 'Priority (CAPEX 3)',
  ]);
}

const tests = [testTablesAreEqual, testStatementsAreEqual, testTable, testNameCandidates];
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
  console.error(`capex-dimensions-seed.spec: ${failures.length} failing: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('capex-dimensions-seed.spec: ok');
