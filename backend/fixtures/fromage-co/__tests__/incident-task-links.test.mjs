// The INC-N link of the Fromage corrective tasks follows row N of the incident
// register, whatever item number the tenant assigned.
//
//   node --test backend/fixtures/fromage-co/__tests__/incident-task-links.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv } from '../../../scripts/lib/fixture-csv.mjs';
import { rewriteIncidentTaskLinks } from '../incident-task-links.mjs';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => parseCsv(readFileSync(path.join(DIR, name), 'utf8'));

const titles = read('31-incidents.csv').map((row) => row.title);
const tasks = read('19b-incident-tasks.csv');

test('maps INC-N to the register row when item numbers run from 10 to 18', () => {
  assert.equal(titles.length, 10, 'the register has ten incidents');
  // Numbering that already starts at 10: rows 1 to 9 are INC-10 to INC-18, and
  // the tenth row is INC-19. None of them is INC-2, INC-3 or INC-4.
  const incidents = titles.map((title, index) => ({
    id: `id-${index + 1}`,
    title,
    item_number: 10 + index,
  }));
  incidents.push({ id: 'decoy-4', title: 'Older incident that kept number 4', item_number: 4 });
  assert.deepEqual(
    incidents.slice(0, 9).map((incident) => incident.item_number),
    [10, 11, 12, 13, 14, 15, 16, 17, 18],
  );
  assert.equal(incidents[9].item_number, 19);

  const first = rewriteIncidentTaskLinks(tasks, titles, incidents);
  const second = rewriteIncidentTaskLinks(tasks, titles, incidents);
  assert.deepEqual(second, first, 'a second resolution gives the same links');
  assert.deepEqual(first.warnings, []);
  assert.deepEqual(
    first.rows.map((row) => [row.title, row.related_object_id, row.related_object_name]),
    [
      ['Upgrade the B2B portal database off PostgreSQL 13', 'id-4', ''],
      ['Add lookalike supplier domains to mail filtering', 'id-2', ''],
      ['Add SAP host capacity check to the month-end runbook', 'id-3', ''],
    ],
  );
  assert.deepEqual(
    first.rows.map((row) => incidents.find((incident) => incident.id === row.related_object_id).item_number),
    [13, 11, 12],
    'the tasks follow rows 4, 2 and 3, which are numbered 13, 11 and 12',
  );
  assert.equal(tasks[0].related_object_name, 'INC-4', 'the CSV row itself stays INC-4');
  assert.equal(first.rows[0].related_object_type, 'incident');
  assert.equal(first.rows[0].description, tasks[0].description);
});

test('a missing title warns and the other tasks stay', () => {
  const register = ['One', 'Two', 'Three', 'Four'];
  const incidents = [
    { id: 'a', title: 'One', item_number: 10 },
    { id: 'b', title: 'Two', item_number: 11 },
    { id: 'd', title: 'Four', item_number: 13 },
  ];
  const rows = [
    { title: 'Task four', related_object_type: 'incident', related_object_name: 'INC-4', status: 'open' },
    { title: 'Task three', related_object_type: 'incident', related_object_name: 'INC-3', status: 'open' },
    { title: 'Task two', related_object_type: 'incident', related_object_name: 'INC-2', status: 'open' },
    { title: 'Task missing row', related_object_type: 'incident', related_object_name: 'INC-9', status: 'open' },
  ];
  const result = rewriteIncidentTaskLinks(rows, register, incidents);
  assert.deepEqual(result.rows.map((row) => [row.title, row.related_object_id, row.related_object_name]), [
    ['Task four', 'd', ''],
    ['Task two', 'b', ''],
  ]);
  assert.equal(result.rows[0].status, 'open');
  assert.equal(result.warnings.length, 2);
  assert.match(result.warnings[0], /Incident 'Three' not found for task 'Task three' \(INC-3\)/);
  assert.match(result.warnings[1], /row 9 of 31-incidents.csv/);
});
