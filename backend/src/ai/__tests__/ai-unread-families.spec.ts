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
    ['rôle Budget Member', 'roles and their rights'],
    ['Rollen und Berechtigungen', 'roles and their rights'],
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
    // "rôle" inside another word.
    'Contrôle qualité',
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

/**
 * The families of Admin › Roles and Admin › Data access (Plaid L7, lot D): an administrator of
 * users with access to all data reads them, so they are not listed; an administrator in limited
 * access, or a person without the right, is told what they lack.
 */
function testTheFamiliesOfTheAdministratorsOfUsers() {
  const dataAccess = 'data access (which companies or cost centers a person is limited to)';
  const roles = 'roles and their rights';
  // Full administrator of users: neither family is unread.
  const full = unreadFamilyLines('fr', null);
  assert.equal(full.some((line) => line.startsWith(dataAccess) || line.startsWith(roles)), false, full.join('\n'));
  assert.deepEqual(unreadFamiliesAskedBy('accès limité aux données', 'fr', null), []);
  assert.doesNotMatch(unreadFamiliesSentence('fr', null), /data access|roles and their rights/);

  // Administrator of users in limited access: listed, with the access that is missing.
  const limited = unreadFamilyLines('fr', 'all_data');
  assert.ok(limited.includes(`${dataAccess} (Administration › Accès aux données): The tools read it for a person with the right to administer users and access to all data; this person's access is limited to part of the data.`), limited.join('\n'));
  assert.ok(limited.some((line) => line.startsWith(`${roles} (Administration › Rôles): `)));
  const asked = unreadFamiliesAskedBy('accès limité aux données', 'fr', 'all_data')[0];
  assert.match(asked.note, /this server does not read them for this person\. They are on the screen Administration › Accès aux données\. The tools read it for a person with the right to administer users and access to all data; this person's access is limited/);
  assert.match(asked.note, /A role says what a person may do, not which data they see\./);

  // Without the right: the right is what is missing.
  const reader = unreadFamiliesAskedBy('rôle Budget Member', 'en', 'right')[0];
  assert.equal(reader.where, 'Admin › Roles');
  assert.match(reader.note, /with the right to administer users, which this person's role does not give/);
  // Not known (the tool descriptions): both conditions.
  assert.match(unreadFamilyLines('en').join('\n'), /Admin › Data access\): The tools read it for a person with the right to administer users and access to all data only\./);
  assert.match(AI_UNREAD_FAMILIES_SENTENCE, /roles and their rights \(read for administrators of users with access to all data only\)/);
}

/**
 * The chargeback reports (Plaid L8, lot E): a person with the Reporting right reads them through
 * `chargeback` and `chargeback_lines`, so they are not listed; the others are told the right.
 */
function testTheChargebackFollowsTheReportingRight() {
  const chargeback = 'chargeback by beneficiary company';
  // A reader of the reports: not unread, neither in the lists nor for a search that asks for it.
  const reader = unreadFamilyLines('fr', 'right', { reports: true });
  assert.equal(reader.some((line) => line.startsWith(chargeback)), false, reader.join('\n'));
  assert.deepEqual(unreadFamiliesAskedBy('refacturation 2026 par société', 'fr', 'right', { reports: true }), []);
  assert.doesNotMatch(unreadFamiliesSentence('fr', 'right', { reports: true }), /chargeback/);
  // The families of the administrators of users keep their own rule.
  assert.ok(reader.some((line) => line.startsWith('roles and their rights (')));

  // Without the right: listed, with the right that is missing and what is read instead.
  const other = unreadFamilyLines('fr', 'right', { reports: false });
  assert.ok(other.includes(`${chargeback} (Gestion budgétaire › Rapports › Refacturation globale): The tools read it (the families chargeback and chargeback_lines) for a person with the Reporting right, which this person's role does not give.`), other.join('\n'));
  const asked = unreadFamiliesAskedBy('refacturation 2026 par société', 'fr', 'right', { reports: false })[0];
  assert.equal(asked.family, chargeback);
  assert.match(asked.note, /^KANAP has chargeback by beneficiary company; this server does not read them for this person\. They are on the screen Gestion budgétaire › Rapports › Refacturation globale\. The tools read it \(the families chargeback and chargeback_lines\) for a person with the Reporting right, which this person's role does not give\. A budget line's allocation to companies is in get_entity_detail of the line\.$/);
  assert.doesNotMatch(asked.note, /no tool computes the chargeback/, 'the tools do compute it');

  // Not known (the tool descriptions, common to everyone): the right is named.
  assert.match(unreadFamilyLines('en').join('\n'), /Global chargeback\): The tools read it \(the families chargeback and chargeback_lines\) for a person with the Reporting right only\./);
  assert.match(AI_UNREAD_FAMILIES_SENTENCE, /chargeback by beneficiary company \(read for people with the Reporting right only\)/);
}

async function run() {
  testWordsThatAskForAFamily();
  testTheFamiliesOfTheAdministratorsOfUsers();
  testTheChargebackFollowsTheReportingRight();
  testCommonWordsAskForNone();
  await testScreensInThePersonsLanguage();
  console.log('ai-unread-families.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
