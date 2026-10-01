import * as assert from 'node:assert/strict';
import { compileAgFilterCondition, createParamNameGenerator, isExcludeSetModel } from '../ag-grid-filtering';

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

testIncludeModeUnchanged();
testExcludeModeIsTheComplement();
testExcludeModeOnlyOnSetModels();
console.log('ag-grid-filtering.spec: ok');
