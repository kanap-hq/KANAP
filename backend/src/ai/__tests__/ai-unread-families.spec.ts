import * as assert from 'node:assert/strict';
import { assertLocaleLabels } from '../../common/report-export/__tests__/locale-labels';
import {
  AI_SCREEN_LABEL_KEYS,
  AI_SCREEN_LABELS,
  AI_UNREAD_FAMILIES_SENTENCE,
  aiScreenLanguage,
  readAiScreenLanguage,
  unreadFamiliesAskedBy,
  unreadFamiliesSentence,
  unreadFamilyLines,
} from '../ai-unread-families';

// A search names an unread family only when its words ask for that family: a common word of a
// project, an asset or a supplier (an audit, a monitoring agent, the scope of a project) does not.

const families = (query: string) => unreadFamiliesAskedBy(query, null).map((entry) => entry.family);

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
    ['historique des modifications', 'audit log'],
    ['agents IA', 'AI agents'],
    ['AI agents', 'AI agents'],
    ['KI-Agenten', 'AI agents'],
    ['refacturation 2026 par société bénéficiaire', 'chargeback by beneficiary company'],
    // The words of the menus in German and Spanish.
    ['Globale Leistungsverrechnung 2026', 'chargeback by beneficiary company'],
    ['contracargo global', 'chargeback by beneficiary company'],
    ['calendarios laborales', 'working-day calendars'],
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
    // The History tab of one record, which get_record_history reads (Plaid L7, lot C).
    'Historique des modifications de TEC-3',
    "Historique des modifications d'AST-3",
    'historique des modifications du fournisseur Acme',
  ]) {
    assert.deepEqual(families(query), [], `"${query}" asks for no unread family`);
  }
}

/**
 * The screens are named as the person's menus name them (essay of 2026-10-27: Plaid copied
 * "Master data › Cost centers" into a French answer). The words are the frontend's own.
 */
async function testScreensInThePersonsLanguage() {
  for (const namespace of ['nav', 'ops'] as const) {
    const keys = Object.fromEntries(Object.entries(AI_SCREEN_LABEL_KEYS)
      .filter(([, source]) => source.namespace === namespace)
      .map(([part, source]) => [part, source.key]));
    assertLocaleLabels(namespace, keys, AI_SCREEN_LABELS);
  }

  assert.equal(aiScreenLanguage('fr'), 'fr');
  assert.equal(aiScreenLanguage('de-CH'), 'de');
  assert.equal(aiScreenLanguage('it'), null, 'a language the menus do not have');
  assert.equal(aiScreenLanguage(null), null);

  const french = unreadFamiliesAskedBy('centre de coûts FR-TRV-600', 'fr');
  assert.equal(french[0].where, 'Données de référence › Centres de coûts');
  assert.match(french[0].note, /They are on the screen Données de référence › Centres de coûts\./);
  assert.equal(unreadFamiliesAskedBy('accès limité aux données', 'fr')[0].where, 'Administration › Accès aux données');
  assert.equal(unreadFamiliesAskedBy("journal d'audit", 'fr')[0].where, "Administration › Journal d'audit");
  assert.equal(unreadFamiliesAskedBy('refacturation 2026', 'fr')[0].where, 'Gestion budgétaire › Rapports › Refacturation globale');
  assert.equal(unreadFamiliesAskedBy('taux de change', 'fr')[0].where, 'Gestion budgétaire › Administration › Devises');
  assert.equal(unreadFamiliesAskedBy('chargeback', 'en')[0].where, 'Budget management › Reporting › Global chargeback');
  assert.equal(unreadFamiliesAskedBy('Kostenstelle', 'de')[0].where, 'Stammdaten › Kostenstellen');
  assert.equal(unreadFamiliesAskedBy('agentes IA', 'es')[0].where, 'Agentes IA');

  // No profile language: the four names, for the answer to pick the person's.
  const unknown = unreadFamiliesAskedBy('cost center', null)[0];
  assert.equal(unknown.where, 'en: Master data › Cost centers; fr: Données de référence › Centres de coûts; de: Stammdaten › Kostenstellen; es: Datos maestros › Centros de coste');
  assert.match(unknown.note, /on the screen named, in the person's language, en: Master data/);
  assert.ok(unreadFamilyLines('fr').includes('audit log (Administration › Journal d\'audit)'));
  assert.match(unreadFamiliesSentence('fr'), /cost centers \(Données de référence › Centres de coûts\)/);
  assert.match(unreadFamiliesSentence(null), /Quote a screen name exactly as given, never translated/);
  // The tool descriptions, shared with the MCP server, name the families and leave the screens to the results.
  assert.doesNotMatch(AI_UNREAD_FAMILIES_SENTENCE, /›/);
  assert.match(AI_UNREAD_FAMILIES_SENTENCE, /cost centers; working-day calendars/);

  // The profile's language, read in the tenant.
  const calls: unknown[][] = [];
  const manager = { query: async (sql: string, params: unknown[]) => { calls.push([sql, params]); return [{ locale: 'fr' }]; } };
  assert.equal(await readAiScreenLanguage(manager as any, 'tenant-1', 'user-1'), 'fr');
  assert.match(String(calls[0][0]), /FROM users WHERE tenant_id = \$1 AND id = \$2/);
  assert.deepEqual(calls[0][1], ['tenant-1', 'user-1']);
  assert.equal(await readAiScreenLanguage({ query: async () => [{ locale: null }] } as any, 'tenant-1', 'user-1'), null);
  assert.equal(await readAiScreenLanguage(manager as any, 'tenant-1', null), null, 'no user, no query');
  assert.equal(calls.length, 1);
}

async function run() {
  testWordsThatAskForAFamily();
  testCommonWordsAskForNone();
  await testScreensInThePersonsLanguage();
  console.log('ai-unread-families.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
