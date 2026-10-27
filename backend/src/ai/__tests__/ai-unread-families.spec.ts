import * as assert from 'node:assert/strict';
import { unreadFamiliesAskedBy } from '../ai-unread-families';

// A search names an unread family only when its words ask for that family: a common word of a
// project, an asset or a supplier (an audit, a monitoring agent, the scope of a project) does not.

const families = (query: string) => unreadFamiliesAskedBy(query).map((entry) => entry.family);

function testWordsThatAskForAFamily() {
  const cases: Array<[string, string]> = [
    ['centre de coûts FR-TRV-600', 'cost centers'],
    ['cost center FR-TRV-600', 'cost centers'],
    ['calendrier des jours ouvrés', 'working-day calendars'],
    ['working-day calendar France', 'working-day calendars'],
    ['taux de change USD 2026', 'exchange rates'],
    ['dimensions analytiques', 'analytics dimensions as records (their settings)'],
    ['accès limité aux données', 'data access (which companies or cost centers a person is limited to)'],
    ['périmètre de données de Paul', 'data access (which companies or cost centers a person is limited to)'],
    ["journal d'audit", 'audit log'],
    ['audit log', 'audit log'],
    ['agents IA', 'AI agents'],
    ['AI agents', 'AI agents'],
    ['KI-Agenten', 'AI agents'],
    ['refacturation 2026 par société bénéficiaire', 'chargeback by beneficiary company'],
  ];
  for (const [query, family] of cases) {
    assert.ok(families(query).includes(family), `"${query}" asks for ${family}`);
  }
}

function testCommonWordsAskForNone() {
  for (const query of [
    'Audit sécurité 2026',
    'audit de licences Microsoft',
    'Zabbix agent',
    'agent de sauvegarde',
    'périmètre du projet',
    'Dimension Data',
    'calendrier de migration',
    'Outlook calendar',
  ]) {
    assert.deepEqual(families(query), [], `"${query}" asks for no unread family`);
  }
}

function run() {
  testWordsThatAskForAFamily();
  testCommonWordsAskForNone();
  console.log('ai-unread-families.spec: ok');
}

run();
