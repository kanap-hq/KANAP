// The Fromage demands resolve to distinct scores on the default criteria.
//
//   node --test backend/fixtures/fromage-co/__tests__/demand-scores.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv } from '../../../scripts/lib/fixture-csv.mjs';
import {
  DEFAULT_CRITERIA,
  DEMAND_SCORES,
  demandScore,
  planDemandScores,
  sameCriteriaValues,
} from '../demand-scores.mjs';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function criteriaFromDefaults({ weight = 1, enabledExtra = null, disabledExtra = null, rename = null } = {}) {
  const criteria = DEFAULT_CRITERIA.map((criterion, index) => ({
    id: `c-${index}`,
    name: rename && index === rename.index ? rename.name : criterion.name,
    enabled: true,
    inverted: criterion.inverted,
    weight,
    values: criterion.values.map((label, position) => ({
      id: `c-${index}-v-${position}`,
      label,
      position,
    })),
  }));
  if (disabledExtra) criteria.push({ ...disabledExtra, enabled: false });
  if (enabledExtra) criteria.push({ ...enabledExtra, enabled: true });
  return criteria;
}

const REQUESTS = [
  { id: 'r-cave', name: 'Cave Climate Digital Twin', criteria_values: {} },
  { id: 'r-ai', name: 'AI Cheese Grading', criteria_values: {} },
  { id: 'r-pack', name: 'Smart Packaging Automation', criteria_values: {} },
  { id: 'r-warehouse', name: 'Automated Warehouse Inventory', criteria_values: {} },
];

test('every demand of the requests file is scored', () => {
  const rows = parseCsv(readFileSync(path.join(DIR, '17-portfolio-requests.csv'), 'utf8'));
  const names = rows.map((row) => row.name);
  assert.deepEqual(DEMAND_SCORES.map((demand) => demand.name), [
    'Cave Climate Digital Twin',
    'AI Cheese Grading',
    'Smart Packaging Automation',
    'Automated Warehouse Inventory',
  ]);
  assert.deepEqual(names.slice().sort(), DEMAND_SCORES.map((demand) => demand.name).slice().sort());
});

test('an empty selection on the default criteria scores 50', () => {
  assert.equal(demandScore(criteriaFromDefaults(), {}), 50);
});

test('the four demands score about 64, 44, 26 and 38, and a second plan is the same', () => {
  const criteria = criteriaFromDefaults({ weight: '1.00' });
  const first = planDemandScores(criteria, REQUESTS);
  const second = planDemandScores(criteria, REQUESTS);
  assert.equal(first.skipped, false);
  assert.deepEqual(first.missing, []);
  assert.deepEqual(second, first);
  assert.deepEqual(first.assignments.map((assignment) => assignment.name), DEMAND_SCORES.map((demand) => demand.name));
  assert.equal(first.assignments.some((assignment) => assignment.requestId === 'r-warehouse'), true);

  const scores = first.assignments.map((assignment) => demandScore(criteria, assignment.criteria_values));
  assert.deepEqual(scores, [63.75, 43.96, 26.46, 37.92]);
  assert.deepEqual(scores.map((score) => Math.round(score)), [64, 44, 26, 38]);
  assert.equal(new Set(scores).size, scores.length, 'the scores are contrasted');

  const cave = first.assignments[0];
  assert.equal(cave.criteria_values['c-0'], 'c-0-v-3', 'business value 200-500k€');
  assert.equal(cave.criteria_values['c-1'], 'c-1-v-3', 'strategy Top');
  assert.equal(cave.criteria_values['c-2'], 'c-2-v-3', 'cost 50-200k€');
  assert.equal(sameCriteriaValues({}, cave.criteria_values), false);
  assert.equal(sameCriteriaValues(cave.criteria_values, cave.criteria_values), true);
  assert.equal(sameCriteriaValues(JSON.stringify(cave.criteria_values), cave.criteria_values), true);
});

test('criteria that are not the default English set are skipped', () => {
  const renamed = planDemandScores(criteriaFromDefaults({ rename: { index: 1, name: 'Alignement stratégique' } }), REQUESTS);
  assert.equal(renamed.skipped, true);
  assert.equal(renamed.assignments.length, 0);
  assert.match(renamed.reason, /Strategic alignment/);

  const extra = planDemandScores(criteriaFromDefaults({
    enabledExtra: { id: 'extra', name: 'Local preference', inverted: false, weight: 1, values: [] },
  }), REQUESTS);
  assert.equal(extra.skipped, true);

  const withDisabled = planDemandScores(criteriaFromDefaults({
    disabledExtra: { id: 'old', name: 'Retired', inverted: false, weight: 1, values: [{ id: 'v', label: 'A', position: 0 }, { id: 'w', label: 'B', position: 1 }] },
  }), REQUESTS);
  assert.equal(withDisabled.skipped, false, 'a disabled criterion stays out of the score');
});

test('a missing demand is reported and the others are still scored', () => {
  const plan = planDemandScores(criteriaFromDefaults(), REQUESTS.filter((request) => request.id !== 'r-ai'));
  assert.equal(plan.skipped, false);
  assert.deepEqual(plan.missing, ['AI Cheese Grading']);
  assert.deepEqual(plan.assignments.map((assignment) => assignment.name), [
    'Cave Climate Digital Twin',
    'Smart Packaging Automation',
    'Automated Warehouse Inventory',
  ]);
});
