import * as assert from 'node:assert/strict';
import { RECORD_HISTORY } from '../../audit/record-history.inventory';
import { assertCodeListIsTheScreens } from './code-list-locale';
import { AiCodeNamer } from '../ai-code-names';
import { RECORD_HISTORY_LISTS, withStateLabels, withSubjectName } from '../ai-record-history.service';

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

/** The lists of lot K2d: the workspace's catalog, the contract and line statuses, a version's method, an owner's type. */
function testCatalogAndChildListsInThePersonsWords() {
  const namer = new AiCodeNamer('de', {
    lifecycleStates: [{ code: 'deprecated', label: 'Deprecated' }],
    businessCriticalityLevels: [{ code: 'tier_1', label: 'Tier 1', translations: { de: { label: 'Stufe 1' } } }],
  } as any);
  const label = (table: string, field: string, after: string, subject: any = record) => (withStateLabels({ field, before: null, after }, table, subject, namer) as any).after_label;
  assert.equal(label('applications', 'lifecycle', 'deprecated'), 'Veraltet');
  assert.equal(label('applications', 'criticality', 'tier_1'), 'Stufe 1');
  assert.equal(label('applications', 'hosting_model', 'on_premise'), 'On-Premise');
  assert.equal(label('contracts', 'status', 'disabled'), 'Deaktiviert');
  assert.equal(label('interfaces', 'lifecycle', 'deprecated'), 'Veraltet');
  // A child row of the record: a version's allocation method, a line contact's type, an owner's type.
  const version = { kind: 'version' } as any;
  assert.equal(label('spend_items', 'allocation_method', 'manual_pct', version), 'Manuelle Prozentsätze');
  assert.equal(label('spend_items', 'role', 'technical', { kind: 'contact' }), 'Technik');
  assert.equal(label('applications', 'owner_type', 'business', { kind: 'owner' }), 'Fachbereich');
  // The record's own fields are not a child's.
  assert.equal(label('applications', 'lifecycle', 'deprecated', version), undefined);
  console.log('  catalog values, statuses, a version\'s method, a contact\'s and an owner\'s type: OK');
}

/** The lists of the second pass of lot K2d, where the History tab shows their field. */
function testSecondPassListsInThePersonsWords() {
  const namer = new AiCodeNamer('es', {
    serverProviders: [{ code: 'k2d_cloud', label: 'Nube K2d' }],
    hostingTypes: [{ code: 'k2d_hosting', label: 'Alojamiento K2d' }],
  } as any);
  const label = (table: string, field: string, after: string, subject: any = record) => (withStateLabels({ field, before: null, after }, table, subject, namer) as any).after_label;
  assert.equal(label('companies', 'country_iso', 'DE'), 'Alemania');
  assert.equal(label('contacts', 'country', 'fr'), 'Francia');
  assert.equal(label('locations', 'country_iso', 'XX'), undefined);
  assert.equal(label('locations', 'provider', 'k2d_cloud'), 'Nube K2d');
  assert.equal(label('assets', 'provider', 'k2d_hosting'), 'Alojamiento K2d');
  assert.equal(label('applications', 'users_mode', 'it_users'), 'Derivado');
  assert.equal(label('applications', 'country_iso', 'NL', { kind: 'set' }), 'Países Bajos');
  assert.equal(label('interfaces', 'integration_route_type', 'via_middleware'), 'Vía middleware');
  assert.equal(label('connections', 'topology', 'multi_server'), 'Multi-servidor');
  assert.equal(label('connections', 'risk_mode', 'derived'), 'Derivado');
  assert.equal(label('documents', 'status', 'in_review'), 'En revisión');
  assert.equal(label('analytics_axes', 'applies_to', 'capex'), 'Solo CAPEX');
  console.log('  countries, providers, users mode, route, topology, risk, document status, applies to: OK');
}

/**
 * Lot K2d, browser pass of 24/11: a deployment reads as its environment, as the History tab names
 * it (« Prod », « QA »), in its title, in the line that adds or removes it, and in the record's field.
 */
function testDeploymentsByTheirEnvironment() {
  const namer = new AiCodeNamer('fr');
  assert.deepEqual(withSubjectName({ kind: 'instance', label: 'qa' } as any, namer), { kind: 'instance', label: 'qa', label_name: 'QA' });
  assert.deepEqual(withSubjectName({ kind: 'assignment', label: 'pre_prod' } as any, namer), { kind: 'assignment', label: 'pre_prod', label_name: 'Pré-prod' });
  assert.deepEqual(withSubjectName({ kind: 'assignment', label: 'nightly' } as any, namer), { kind: 'assignment', label: 'nightly' });
  assert.deepEqual(withSubjectName({ kind: 'binding', label: 'prod' } as any, namer), { kind: 'binding', label: 'prod' });
  const added = withStateLabels({ field: 'instance', event: 'added', after: 'prod' }, 'applications', { kind: 'instance' } as any, namer) as any;
  assert.equal(added.after_label, 'Prod');
  assert.equal((withStateLabels({ field: 'environment', after: 'qa' }, 'applications', record, namer) as any).after_label, 'QA');
  // A server's role on a deployment: the workspace's catalog, shipped word in the reader's language.
  const roles = new AiCodeNamer('fr', { serverRoles: [{ code: 'app', label: 'Application server' }] } as any);
  const role = withStateLabels({ field: 'server_role', before: null, after: 'app' }, 'applications', { kind: 'assignment' } as any, roles) as any;
  assert.equal(role.after_label, "Serveur d'applications");
  console.log('  a deployment by its environment, in its title, its line and the record\'s field; a server\'s role: OK');
}

function testListsAreTheHistoryTabs() {
  for (const [table, fields] of Object.entries(RECORD_HISTORY_LISTS.records)) {
    assert.ok(table in RECORD_HISTORY, `${table} has a History tab`);
    for (const [field, list] of Object.entries(fields)) assertCodeListIsTheScreens(`${table}.${field}`, list);
  }
  for (const [table, fields] of Object.entries(RECORD_HISTORY_LISTS.recordChildren)) {
    assert.ok(table in RECORD_HISTORY, `${table} has a History tab`);
    for (const [field, list] of Object.entries(fields)) assertCodeListIsTheScreens(`${table} child ${field}`, list);
  }
  for (const [field, list] of Object.entries(RECORD_HISTORY_LISTS.children)) assertCodeListIsTheScreens(field, list);
  console.log('  every list is the History tab\'s, in the four languages: OK');
}

function run() {
  console.log('ai-record-history-labels.spec');
  testPriorityInThePersonsWords();
  testOtherListsInThePersonsWords();
  testCatalogAndChildListsInThePersonsWords();
  testSecondPassListsInThePersonsWords();
  testDeploymentsByTheirEnvironment();
  testListsAreTheHistoryTabs();
  console.log('ai-record-history-labels.spec: ok');
}

run();
