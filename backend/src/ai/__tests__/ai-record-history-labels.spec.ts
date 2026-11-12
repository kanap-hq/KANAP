import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { backendPath } from '../../common/__tests__/backend-root';
import { RECORD_HISTORY } from '../../audit/record-history.inventory';
import { assertLocaleLabels } from '../../common/report-export/__tests__/locale-labels';
import { RECORD_HISTORY_LISTS, withStateLabels } from '../ai-record-history.service';

/**
 * The values of a fixed list in a record's history, as Kad and the MCP server read them: each with
 * the word the History tab shows, in the person's language. The tab names a value from a locale
 * object of the screens (`frontend/src/lib/audit/auditLogValues.ts`); the server names it from its
 * copy of that list, checked here against the same object in the four languages.
 */

const record = { kind: 'record' } as const;

function testPriorityInThePersonsWords() {
  const change = withStateLabels({ field: 'priority_level', before: 'normal', after: 'high' }, 'tasks', record, 'fr');
  assert.deepEqual(change, { field: 'priority_level', before: 'normal', after: 'high', before_label: 'Moyenne', after_label: 'Haute' });
  const english = withStateLabels({ field: 'priority_level', before: 'normal', after: 'blocker' }, 'tasks', record, 'en') as any;
  assert.deepEqual([english.before_label, english.after_label], ['Medium', 'Blocker']);
  console.log('  a task priority as the History tab says it: OK');
}

function testOtherListsInThePersonsWords() {
  const label = (table: string, field: string, value: string) => (withStateLabels({ field, before: null, after: value }, table, record, 'fr') as any).after_label;
  assert.equal(label('incidents', 'severity', 'major'), 'Majeure');
  assert.equal(label('spend_items', 'run_build', 'build'), 'Build');
  assert.equal(label('spend_items', 'nature', 'capex'), 'CAPEX');
  assert.equal(label('cost_centers', 'kind', 'cost_center'), 'Centre de coûts');
  assert.equal(label('portfolio_projects', 'origin', 'fast_track'), 'Fast-track');
  assert.equal(label('business_processes', 'process_type', 'core'), 'Réalisation');
  assert.equal(label('contracts', 'billing_frequency', 'quarterly'), 'Trimestrielle');
  // A value the list does not know stays as stored, with no label; a field of another table has none.
  assert.equal(label('tasks', 'priority_level', 'urgent'), undefined);
  assert.equal(label('spend_items', 'priority_level', 'normal'), undefined);
  // A child row's field is not its record's.
  const child = withStateLabels({ field: 'nature', before: 'opex', after: 'capex' }, 'spend_items', { kind: 'version' } as any, 'fr') as any;
  assert.equal(child.after_label, undefined);
  console.log('  severity, run or build, nature, cost center kind, origin, process type, billing: OK');
}

function testListsAreTheHistoryTabs() {
  for (const [table, fields] of Object.entries(RECORD_HISTORY_LISTS.records)) {
    assert.ok(table in RECORD_HISTORY, `${table} has a History tab`);
    for (const [field, list] of Object.entries(fields)) checkList(`${table}.${field}`, list);
  }
  for (const [field, list] of Object.entries(RECORD_HISTORY_LISTS.children)) checkList(field, list);
  console.log('  every list is the History tab\'s, in the four languages: OK');
}

function checkList(name: string, list: { screen: string; labels: Record<string, Record<string, string>> }) {
  const [namespace, path] = list.screen.split(':');
  assert.ok(namespace && path, `${name}: screen is namespace:path`);
  // Every code the History tab names, with its words in the four languages.
  const json = JSON.parse(fs.readFileSync(backendPath('..', 'frontend', 'src', 'locales', 'en', `${namespace}.json`), 'utf8'));
  const object = path.split('.').reduce<any>((node, part) => (node == null ? undefined : node[part]), json);
  const codes = Object.keys(object ?? {});
  assert.ok(codes.length > 0, `${name}: ${list.screen}`);
  assertLocaleLabels(namespace, Object.fromEntries(codes.map((code) => [code, `${path}.${code}`])), list.labels as any);
}

function run() {
  console.log('ai-record-history-labels.spec');
  testPriorityInThePersonsWords();
  testOtherListsInThePersonsWords();
  testListsAreTheHistoryTabs();
  console.log('ai-record-history-labels.spec: ok');
}

run();
