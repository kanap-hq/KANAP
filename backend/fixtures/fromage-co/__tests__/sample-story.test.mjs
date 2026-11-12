// The parts of the Fromage story the runner writes through the API: the service desk agent
// reads as a working agent in every language, the contracts that cover an application are
// linked to it, and the converted cave project is dated by its own phases.
//
//   node --test backend/fixtures/fromage-co/__tests__/sample-story.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv } from '../../../scripts/lib/fixture-csv.mjs';
import { DATASET_LANGUAGES, datasetTranslator } from '../translations/translate.mjs';
import { RUNNER_FILES } from '../translations/fields.mjs';
import { CAVE_PROJECT, CONTRACT_APPLICATIONS, caveProjectPhases, serviceDeskAgentTexts } from '../sample-story.mjs';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (language, name) => parseCsv(readFileSync(path.join(DIR, language === 'en' ? '' : language, name), 'utf8'));

/** Every text of a value, nested arrays and objects included. */
function texts(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(texts);
  if (value && typeof value === 'object') return Object.values(value).flatMap(texts);
  return [];
}

test('the agent texts say what the agent does, with no demo or mock wording, in every language', () => {
  const english = serviceDeskAgentTexts(datasetTranslator('en'));
  assert.equal(
    english.description,
    'Triages inbound IT tickets, searches company knowledge, and prepares source-cited replies for technician approval.',
  );
  for (const language of DATASET_LANGUAGES) {
    const agent = serviceDeskAgentTexts(datasetTranslator(language));
    const all = texts(agent);
    assert.ok(all.length >= 10, `${language}: ${all.length} texts`);
    for (const text of all) {
      assert.doesNotMatch(text, /demo|démo|mock|simula|fictif|ficticio|fiktiv/i, `${language}: "${text}"`);
    }
    if (language !== 'en') assert.notEqual(agent.description, english.description, `${language}: the description is translated`);
  }
});

test('the runner texts of the story module are read by the translation generator', () => {
  assert.ok(RUNNER_FILES.includes('sample-story.mjs'));
});

test('five contracts and applications are linked, by names the data set holds in every language', () => {
  const pairs = Object.entries(CONTRACT_APPLICATIONS).flatMap(([contract, apps]) => apps.map((app) => `${contract} > ${app}`));
  assert.deepEqual(pairs.sort(), [
    'Broadcom VMware ELA > VMware vSphere',
    'Nearshore Digital — development > Cornerstone OnDemand',
    'SAP Maintenance & Support > SAP BW/4HANA',
    'SAP Maintenance & Support > SAP Concur',
    'SAP Maintenance & Support > SAP S/4HANA',
  ]);
  for (const language of DATASET_LANGUAGES) {
    const t = datasetTranslator(language);
    const contracts = new Set(read(language, '13-contracts.csv').map((row) => row.name));
    const applications = new Set(read('en', '12-applications.csv').map((row) => row.name));
    for (const [contract, apps] of Object.entries(CONTRACT_APPLICATIONS)) {
      assert.ok(contracts.has(t(contract)), `${language}: contract "${t(contract)}"`);
      for (const app of apps) assert.ok(applications.has(app), `application "${app}"`);
    }
  }
});

test('the cave project starts and ends inside its phases, on dataset dates', () => {
  const phases = caveProjectPhases(datasetTranslator('en'));
  assert.equal(phases.length, 4);
  const first = phases.map(([, start]) => start).sort()[0];
  const last = phases.map(([, , end]) => end).sort().at(-1);
  const { planned_start: plannedStart, planned_end: plannedEnd, actual_start: actualStart } = CAVE_PROJECT;
  for (const date of [plannedStart, plannedEnd, actualStart]) assert.match(date, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(plannedStart <= first && last <= plannedEnd, `planned ${plannedStart}..${plannedEnd}, phases ${first}..${last}`);
  assert.ok(first <= actualStart && actualStart <= last, `actual start ${actualStart}, phases ${first}..${last}`);
  // The first phase is completed: the project started no later than its start.
  const [, firstStart, firstEnd, firstStatus] = phases[0];
  assert.equal(firstStatus, 'completed');
  assert.ok(actualStart <= firstEnd && actualStart >= firstStart, `actual start ${actualStart} in the first phase`);
});
