import * as assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { assertSetFilterModes, compileAgFilterCondition, createParamNameGenerator, isExcludeSetModel, setFilterMode } from '../ag-grid-filtering';
import { buildWhereFromAgFilters } from '../pagination';

// The shared grid filter compiler of the 24 SQL lists. Include mode must stay
// exactly as it was before the exclude mode (decision Q3, lot 2B): the
// snapshot below is the output of the compiler before the change (`d42c9f66`
// lineage), checked against it on 150 model × target pairs when the mode was
// added. Exclude mode keeps exactly the rows the include model drops.

type Target = Parameters<typeof compileAgFilterCondition>[1];

/** [model, target, output before the exclude mode]. */
const INCLUDE_SNAPSHOT: Array<[any, Target, unknown]> = [
  [{"filterType":"set","values":["a","b"]}, {"expression":"c.name"}, {"sql":"c.name IN (:...p0)","params":{"p0":["a","b"]}}],
  [{"filterType":"set","values":["a",null]}, {"expression":"c.name"}, {"sql":"(c.name IN (:...p0) OR c.name IS NULL)","params":{"p0":["a"]}}],
  [{"filterType":"set","values":[null]}, {"expression":"c.name"}, {"sql":"c.name IS NULL","params":{}}],
  [{"filterType":"set","values":[]}, {"expression":"c.name"}, {"sql":"1=0","params":{}}],
  [{"filterType":"set","values":["","x"]}, {"expression":"c.name"}, {"sql":"c.name IN (:...p0)","params":{"p0":["x"]}}],
  [{"filterType":"text","type":"contains","filter":"ab%"}, {"expression":"c.name"}, {"sql":"c.name ILIKE :p0","params":{"p0":"%ab%%"}}],
  [{"filterType":"text","type":"equals","filter":"Ab"}, {"expression":"c.name"}, {"sql":"c.name = :p0","params":{"p0":"Ab"}}],
  [{"filterType":"text","type":"blank"}, {"expression":"c.name"}, {"sql":"NULLIF((c.name)::text, '') IS NULL","params":{}}],
  [{"filterType":"number","type":"greaterThan","filter":5}, {"expression":"c.name"}, {"sql":"c.name ILIKE :p0","params":{"p0":"%5%"}}],
  [{"filterType":"number","type":"inRange","filter":1,"filterTo":9}, {"expression":"c.name"}, {"sql":"c.name ILIKE :p0","params":{"p0":"%1%"}}],
  [{"filterType":"date","type":"equals","dateFrom":"2026-01-01"}, {"expression":"c.name"}, {"sql":"CAST(c.name AS DATE) = CAST(:p0 AS DATE)","params":{"p0":"2026-01-01"}}],
  [{"filterType":"date","type":"inRange","dateFrom":"2026-01-01"}, {"expression":"c.name"}, null],
  [{"filterType":"text","operator":"AND","conditions":[{"filterType":"text","type":"contains","filter":"a"},{"filterType":"text","type":"contains","filter":"b"}]}, {"expression":"c.name"}, {"sql":"c.name ILIKE :p0","params":{"p0":"%a%"}}],
  [{"type":"set","values":["a"]}, {"expression":"c.name"}, {"sql":"c.name ILIKE :p0","params":{"p0":"%a%"}}],
  [{"filterType":"set","values":["a"],"mode":"include"}, {"expression":"c.name"}, {"sql":"c.name IN (:...p0)","params":{"p0":["a"]}}],
  [{"filterType":"text","type":"contains","filter":"a","mode":"exclude"}, {"expression":"c.name"}, {"sql":"c.name ILIKE :p0","params":{"p0":"%a%"}}],
  [{"filterType":"set","values":["a","b"]}, {"expression":"c.count","dataType":"number"}, {"sql":"1=0","params":{}}],
  [{"filterType":"set","values":["a",null]}, {"expression":"c.count","dataType":"number"}, {"sql":"c.count IS NULL","params":{}}],
  [{"filterType":"set","values":[null]}, {"expression":"c.count","dataType":"number"}, {"sql":"c.count IS NULL","params":{}}],
  [{"filterType":"set","values":[]}, {"expression":"c.count","dataType":"number"}, {"sql":"1=0","params":{}}],
  [{"filterType":"set","values":["","x"]}, {"expression":"c.count","dataType":"number"}, {"sql":"1=0","params":{}}],
  [{"filterType":"text","type":"contains","filter":"ab%"}, {"expression":"c.count","dataType":"number"}, {"sql":"c.count ILIKE :p0","params":{"p0":"%ab%%"}}],
  [{"filterType":"text","type":"equals","filter":"Ab"}, {"expression":"c.count","dataType":"number"}, null],
  [{"filterType":"text","type":"blank"}, {"expression":"c.count","dataType":"number"}, {"sql":"c.count IS NULL","params":{}}],
  [{"filterType":"number","type":"greaterThan","filter":5}, {"expression":"c.count","dataType":"number"}, {"sql":"c.count > :p0","params":{"p0":5}}],
  [{"filterType":"number","type":"inRange","filter":1,"filterTo":9}, {"expression":"c.count","dataType":"number"}, {"sql":"c.count BETWEEN :p0 AND :p1","params":{"p0":1,"p1":9}}],
  [{"filterType":"date","type":"equals","dateFrom":"2026-01-01"}, {"expression":"c.count","dataType":"number"}, {"sql":"CAST(c.count AS DATE) = CAST(:p0 AS DATE)","params":{"p0":"2026-01-01"}}],
  [{"filterType":"date","type":"inRange","dateFrom":"2026-01-01"}, {"expression":"c.count","dataType":"number"}, null],
  [{"filterType":"text","operator":"AND","conditions":[{"filterType":"text","type":"contains","filter":"a"},{"filterType":"text","type":"contains","filter":"b"}]}, {"expression":"c.count","dataType":"number"}, {"sql":"c.count ILIKE :p0","params":{"p0":"%a%"}}],
  [{"type":"set","values":["a"]}, {"expression":"c.count","dataType":"number"}, {"sql":"c.count ILIKE :p0","params":{"p0":"%a%"}}],
  [{"filterType":"set","values":["a"],"mode":"include"}, {"expression":"c.count","dataType":"number"}, {"sql":"1=0","params":{}}],
  [{"filterType":"text","type":"contains","filter":"a","mode":"exclude"}, {"expression":"c.count","dataType":"number"}, {"sql":"c.count ILIKE :p0","params":{"p0":"%a%"}}],
  [{"filterType":"set","values":["a","b"]}, {"expression":"c.type_id","textExpression":"(SELECT t.name FROM types t WHERE t.id = c.type_id)"}, {"sql":"(SELECT t.name FROM types t WHERE t.id = c.type_id) IN (:...p0)","params":{"p0":["a","b"]}}],
  [{"filterType":"set","values":["a",null]}, {"expression":"c.type_id","textExpression":"(SELECT t.name FROM types t WHERE t.id = c.type_id)"}, {"sql":"((SELECT t.name FROM types t WHERE t.id = c.type_id) IN (:...p0) OR c.type_id IS NULL)","params":{"p0":["a"]}}],
  [{"filterType":"set","values":[null]}, {"expression":"c.type_id","textExpression":"(SELECT t.name FROM types t WHERE t.id = c.type_id)"}, {"sql":"c.type_id IS NULL","params":{}}],
  [{"filterType":"set","values":[]}, {"expression":"c.type_id","textExpression":"(SELECT t.name FROM types t WHERE t.id = c.type_id)"}, {"sql":"1=0","params":{}}],
  [{"filterType":"set","values":["","x"]}, {"expression":"c.type_id","textExpression":"(SELECT t.name FROM types t WHERE t.id = c.type_id)"}, {"sql":"(SELECT t.name FROM types t WHERE t.id = c.type_id) IN (:...p0)","params":{"p0":["x"]}}],
  [{"filterType":"text","type":"contains","filter":"ab%"}, {"expression":"c.type_id","textExpression":"(SELECT t.name FROM types t WHERE t.id = c.type_id)"}, {"sql":"(SELECT t.name FROM types t WHERE t.id = c.type_id) ILIKE :p0","params":{"p0":"%ab%%"}}],
  [{"filterType":"text","type":"equals","filter":"Ab"}, {"expression":"c.type_id","textExpression":"(SELECT t.name FROM types t WHERE t.id = c.type_id)"}, {"sql":"(SELECT t.name FROM types t WHERE t.id = c.type_id) = :p0","params":{"p0":"Ab"}}],
  [{"filterType":"text","type":"blank"}, {"expression":"c.type_id","textExpression":"(SELECT t.name FROM types t WHERE t.id = c.type_id)"}, {"sql":"NULLIF((c.type_id)::text, '') IS NULL","params":{}}],
  [{"filterType":"number","type":"greaterThan","filter":5}, {"expression":"c.type_id","textExpression":"(SELECT t.name FROM types t WHERE t.id = c.type_id)"}, {"sql":"(SELECT t.name FROM types t WHERE t.id = c.type_id) ILIKE :p0","params":{"p0":"%5%"}}],
  [{"filterType":"number","type":"inRange","filter":1,"filterTo":9}, {"expression":"c.type_id","textExpression":"(SELECT t.name FROM types t WHERE t.id = c.type_id)"}, {"sql":"(SELECT t.name FROM types t WHERE t.id = c.type_id) ILIKE :p0","params":{"p0":"%1%"}}],
  [{"filterType":"date","type":"equals","dateFrom":"2026-01-01"}, {"expression":"c.type_id","textExpression":"(SELECT t.name FROM types t WHERE t.id = c.type_id)"}, {"sql":"CAST(c.type_id AS DATE) = CAST(:p0 AS DATE)","params":{"p0":"2026-01-01"}}],
  [{"filterType":"date","type":"inRange","dateFrom":"2026-01-01"}, {"expression":"c.type_id","textExpression":"(SELECT t.name FROM types t WHERE t.id = c.type_id)"}, null],
  [{"filterType":"text","operator":"AND","conditions":[{"filterType":"text","type":"contains","filter":"a"},{"filterType":"text","type":"contains","filter":"b"}]}, {"expression":"c.type_id","textExpression":"(SELECT t.name FROM types t WHERE t.id = c.type_id)"}, {"sql":"(SELECT t.name FROM types t WHERE t.id = c.type_id) ILIKE :p0","params":{"p0":"%a%"}}],
  [{"type":"set","values":["a"]}, {"expression":"c.type_id","textExpression":"(SELECT t.name FROM types t WHERE t.id = c.type_id)"}, {"sql":"(SELECT t.name FROM types t WHERE t.id = c.type_id) ILIKE :p0","params":{"p0":"%a%"}}],
  [{"filterType":"set","values":["a"],"mode":"include"}, {"expression":"c.type_id","textExpression":"(SELECT t.name FROM types t WHERE t.id = c.type_id)"}, {"sql":"(SELECT t.name FROM types t WHERE t.id = c.type_id) IN (:...p0)","params":{"p0":["a"]}}],
  [{"filterType":"text","type":"contains","filter":"a","mode":"exclude"}, {"expression":"c.type_id","textExpression":"(SELECT t.name FROM types t WHERE t.id = c.type_id)"}, {"sql":"(SELECT t.name FROM types t WHERE t.id = c.type_id) ILIKE :p0","params":{"p0":"%a%"}}],
];

function compile(model: any, target: Target) {
  return compileAgFilterCondition(model, target, createParamNameGenerator('p'));
}

function testIncludeModeUnchanged() {
  for (const [model, target, expected] of INCLUDE_SNAPSHOT) {
    assert.deepEqual(compile(model, target), expected, `include mode unchanged: ${JSON.stringify(model)} on ${target.expression}`);
  }
}

function testExcludeModeIsTheComplement() {
  const name = { expression: 'c.name' };
  assert.deepEqual(compile({ filterType: 'set', mode: 'exclude', values: ['a', 'b'] }, name), {
    sql: 'NOT COALESCE((c.name IN (:...p0)), FALSE)',
    params: { p0: ['a', 'b'] },
  });
  assert.deepEqual(compile({ filterType: 'set', mode: 'exclude', values: ['a', null] }, name), {
    sql: 'NOT COALESCE(((c.name IN (:...p0) OR c.name IS NULL)), FALSE)',
    params: { p0: ['a'] },
  }, 'a blank marker excludes blank rows too');
  assert.deepEqual(compile({ filterType: 'set', mode: 'exclude', values: [] }, name), { sql: 'NOT COALESCE((1=0), FALSE)', params: {} }, 'nothing excluded: every row');
  assert.deepEqual(compile({ filterType: 'set', mode: 'exclude', values: [null] }, name), { sql: 'NOT COALESCE((c.name IS NULL), FALSE)', params: {} });
  const lookup = { expression: 'c.type_id', textExpression: '(SELECT t.name FROM types t WHERE t.id = c.type_id)' };
  assert.deepEqual(compile({ filterType: 'set', mode: 'exclude', values: ['Bug'] }, lookup), {
    sql: 'NOT COALESCE(((SELECT t.name FROM types t WHERE t.id = c.type_id) IN (:...p0)), FALSE)',
    params: { p0: ['Bug'] },
  }, 'a lookup value that is NULL is not excluded');
  assert.deepEqual(
    compile({ filterType: 'set', mode: 'exclude', values: ['1', 'x'] }, { expression: 'c.count', dataType: 'number' }),
    { sql: 'NOT COALESCE((c.count IN (:...p0)), FALSE)', params: { p0: [1] } },
  );
  // A combined model reduced to its first condition keeps the mode.
  assert.deepEqual(
    compile({ operator: 'OR', conditions: [{ filterType: 'set', mode: 'exclude', values: ['a'] }] }, name),
    { sql: 'NOT COALESCE((c.name IN (:...p0)), FALSE)', params: { p0: ['a'] } },
  );
}

function testExcludeModeOnlyOnSetModels() {
  assert.equal(isExcludeSetModel({ filterType: 'set', mode: 'exclude', values: [] }), true);
  assert.equal(isExcludeSetModel({ filterType: 'text', mode: 'exclude', values: [] }), false, 'not a set model');
  assert.equal(isExcludeSetModel({ type: 'set', mode: 'exclude', values: [] }), false, 'no filterType: the include path never read it as a set either');
  assert.equal(isExcludeSetModel({ filterType: 'set', mode: 'include', values: [] }), false);
  assert.equal(isExcludeSetModel({ filterType: 'set', mode: 'exclude' }), false, 'no values');
}

const isBadRequest = (pattern: RegExp) => (err: unknown) => err instanceof BadRequestException && pattern.test((err as Error).message);

function testUnknownModeIsRefused() {
  assert.equal(setFilterMode({ filterType: 'set', values: [] }), 'include');
  assert.equal(setFilterMode({ filterType: 'set', mode: null, values: [] }), 'include');
  assert.equal(setFilterMode({ filterType: 'set', mode: 'include', values: [] }), 'include');
  assert.equal(setFilterMode({ filterType: 'set', mode: 'exclude', values: [] }), 'exclude');
  for (const mode of ['Exclude', 'not', '', 0, true]) {
    assert.throws(() => setFilterMode({ filterType: 'set', mode, values: ['a'] }), isBadRequest(/Unknown set filter mode/), `mode ${JSON.stringify(mode)}`);
    assert.throws(() => compile({ filterType: 'set', mode, values: ['a'] }, { expression: 'c.name' }), isBadRequest(/Unknown set filter mode/));
  }
}

// Lists whose own set code reads `values` as the ticked values answer 400 for an exclude model
// on those fields, never the inverted list; the fields that honour it keep it.
function testSetModeGuard() {
  const exclude = { filterType: 'set', mode: 'exclude', values: ['a'] };
  assert.throws(() => assertSetFilterModes({ name: exclude }), isBadRequest(/"name" cannot exclude values/));
  assert.doesNotThrow(() => assertSetFilterModes({ status: exclude }, ['status']));
  assert.throws(() => assertSetFilterModes({ status: exclude, name: exclude }, ['status']), isBadRequest(/"name"/));
  assert.doesNotThrow(() => assertSetFilterModes({ kind: exclude }, (field) => field !== 'environments'));
  assert.throws(() => assertSetFilterModes({ environments: exclude }, (field) => field !== 'environments'), isBadRequest(/"environments"/));
  // Every condition of a combined model, `type: 'set'` too.
  assert.throws(() => assertSetFilterModes({ name: { operator: 'OR', conditions: [{ filterType: 'text', type: 'contains', filter: 'a' }, exclude] } }), isBadRequest(/"name"/));
  assert.throws(() => assertSetFilterModes({ name: { type: 'set', mode: 'exclude', values: ['a'] } }), isBadRequest(/"name"/));
  // Include models, text models and no filters pass; an unknown mode never does.
  assert.doesNotThrow(() => assertSetFilterModes({ name: { filterType: 'set', values: ['a'] }, notes: { filterType: 'text', type: 'contains', filter: 'a', mode: 'exclude' } }));
  assert.doesNotThrow(() => assertSetFilterModes(undefined));
  assert.doesNotThrow(() => assertSetFilterModes('{"name":1}'));
  assert.throws(() => assertSetFilterModes({ status: { filterType: 'set', mode: 'invert', values: ['a'] } }, ['status']), isBadRequest(/Unknown set filter mode/));

  // `buildWhereFromAgFilters` (accounts, chart of accounts, audit logs, contacts, locations, suppliers,
  // plain OPEX and CAPEX lists): include unchanged, exclude refused.
  assert.equal(JSON.stringify(buildWhereFromAgFilters({ name: { filterType: 'set', values: ['a', 'b'] } })), JSON.stringify({ name: { _type: 'in', _value: ['a', 'b'], _useParameter: true, _multipleParameters: true } }));
  assert.throws(() => buildWhereFromAgFilters({ name: exclude }), isBadRequest(/"name" cannot exclude values/));
  assert.throws(() => buildWhereFromAgFilters({ name: { filterType: 'set', mode: 'other', values: ['a'] } }), isBadRequest(/Unknown set filter mode/));
}

// `buildWhereFromAgFilters` with ticked values and the empty value: the values are bound
// parameters, never written into the SQL text, and each clause has its own parameter name.
function testSetWithNullBindsValues() {
  const values = ["O'Neil & Co", 'Plain value'];
  const where = buildWhereFromAgFilters({ name: { filterType: 'set', values: [...values, null] } });
  const operator = where.name;
  assert.equal(operator._type, 'raw');
  const sql: string = operator._getSql('t.name');
  const match = /^\(t\.name IN \(:\.\.\.(\w+)\) OR t\.name IS NULL\)$/.exec(sql);
  assert.ok(match, `values bound as a parameter list, null kept (${sql})`);
  assert.deepEqual(operator._objectLiteralParameters, { [match![1]]: values }, 'the parameter holds the ticked values unchanged');
  assert.equal(sql.includes('Neil') || sql.includes('Plain'), false, 'no value in the SQL text');

  const other = buildWhereFromAgFilters({ name: { filterType: 'set', values: ['x', null] }, code: { filterType: 'set', values: ['y', undefined] } });
  const names = [where.name, other.name, other.code].map((op: any) => Object.keys(op._objectLiteralParameters)[0]);
  assert.equal(new Set(names).size, names.length, `parameter names are unique (${names.join(', ')})`);
  assert.deepEqual(other.code._objectLiteralParameters[names[2]], ['y'], 'undefined counts as the empty value');

  // The other shapes are unchanged.
  assert.equal(buildWhereFromAgFilters({ name: { filterType: 'set', values: [null] } }).name._getSql('t.name'), 't.name IS NULL');
  assert.equal(buildWhereFromAgFilters({ name: { filterType: 'set', values: [] } }).name._getSql('t.name'), '1=0');
}

testIncludeModeUnchanged();
testExcludeModeIsTheComplement();
testExcludeModeOnlyOnSetModels();
testUnknownModeIsRefused();
testSetModeGuard();
testSetWithNullBindsValues();
console.log('ag-grid-filtering.spec: ok');
