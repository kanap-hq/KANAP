import * as assert from 'node:assert/strict';
import { assertLocaleLabels } from '../../common/report-export/__tests__/locale-labels';
import {
  AI_SCREEN_LABEL_KEYS,
  AI_SCREEN_LABELS,
  AI_UNREAD_FAMILIES_SENTENCE,
  aiScreenLanguage,
  notSearchedFamiliesAskedBy,
  readAiScreenLanguage,
  referenceSearchExact,
  referenceSearchMatches,
  referenceSearchWords,
  unmatchedReferenceFamilyNote,
  unreadFamiliesAskedBy,
  unreadFamiliesReachOf,
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
    ['dimensions analytiques', 'analytics dimensions'],
    ['taux EUR/USD', 'exchange rates'],
    ['devise de reporting', 'exchange rates'],
    ['cours EUR', 'exchange rates'],
    ['EUR exchange', 'exchange rates'],
    ['USD/CHF', 'exchange rates'],
    ['currencies in use', 'exchange rates'],
    ['devises utilisées', 'exchange rates'],
    ['taux de la devise CHF', 'exchange rates'],
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
    // A pair of words that is no currency pair.
    'TCP/UDP',
    'Europe',
    // A currency code alone, a supplier or a product (Plaid L9, lot F, m5).
    'EUR',
    'USD Partners',
    'Devise Consulting',
    'Cryptocurrency wallet',
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
  // The reference data are families of these tools (Plaid L9): the sentence no longer lists them.
  assert.doesNotMatch(AI_UNREAD_FAMILIES_SENTENCE, /cost centers;|working-day calendars|exchange rates|analytics dimensions/);
  assert.match(AI_UNREAD_FAMILIES_SENTENCE, /^KANAP also holds what these tools do not read: data access/);

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

/**
 * The reference data (Plaid L9): cost centers, working-day calendars and analytics dimensions are
 * families read with the right of their page, and the exchange rates with the budget right. A
 * person who has the right does not see them as unread; the rates, which search_all does not
 * search, are said as such. A person without the right is told the right.
 */
async function testTheReferenceDataFollowTheirRights() {
  const all = ['cost_centers', 'working_day_calendars', 'analytics_axes', 'exchange_rates'];
  const reader = { reports: false, readable: all };
  const lines = unreadFamilyLines('fr', 'right', reader);
  for (const family of ['cost centers', 'working-day calendars', 'analytics dimensions', 'exchange rates']) {
    assert.equal(lines.some((line) => line.startsWith(`${family} (`)), false, `${family} is read: ${lines.join('\n')}`);
  }
  assert.deepEqual(unreadFamiliesAskedBy('centre de coûts FR-TRV-600', 'fr', 'right', reader), []);
  assert.deepEqual(unreadFamiliesAskedBy('taux de change 2026', 'fr', 'right', reader), []);
  assert.doesNotMatch(unreadFamiliesSentence('fr', 'right', reader), /Centres de coûts|Calendriers|Dimensions analytiques|Devises/);
  // The rates: read, not searched.
  const rates = notSearchedFamiliesAskedBy('taux de change EUR', 'fr', reader);
  assert.equal(rates.length, 1);
  assert.equal(rates[0].family, 'exchange rates');
  assert.equal(rates[0].where, 'Gestion budgétaire › Administration › Devises');
  assert.equal(rates[0].note, 'The exchange rates are read by query_entities on exchange_rates, not searched by search_all.');
  assert.deepEqual(notSearchedFamiliesAskedBy('centre de coûts Group IT', 'fr', reader), [], 'the cost centers are searched');
  assert.deepEqual(notSearchedFamiliesAskedBy('taux de change', 'fr', { readable: [] }), [], 'without the right: not read, said so');

  // Without the rights: unread, with the right that is missing.
  const other = { reports: false, readable: [] as string[] };
  const otherLines = unreadFamilyLines('en', 'right', other);
  assert.ok(otherLines.includes('cost centers (Master data › Cost centers): The tools read it (the family cost_centers) for a person with the Cost centers right, which this person\'s role does not give.'), otherLines.join('\n'));
  assert.ok(otherLines.some((line) => line.startsWith('working-day calendars (Master data › Working-day calendars): The tools read it (the family working_day_calendars) for a person with the Working-day calendars right,')));
  assert.ok(otherLines.some((line) => line.startsWith('analytics dimensions (Master data › Analytics dimensions): The tools read it (the family analytics_axes) for a person with the Analytics right,')));
  assert.ok(otherLines.some((line) => line.startsWith('exchange rates (Budget management › Administration › Currencies): The tools read it (the family exchange_rates) for a person with the Budget right,')));
  const asked = unreadFamiliesAskedBy('cost center FR-TRV-600', 'en', 'right', other)[0];
  assert.match(asked.note, /^KANAP has cost centers; this server does not read them for this person\. They are on the screen Master data › Cost centers\. The tools read it \(the family cost_centers\) for a person with the Cost centers right, which this person's role does not give\./);
  // Not known: the right is named.
  assert.ok(unreadFamilyLines('en').includes('cost centers (Master data › Cost centers): The tools read it (the family cost_centers) for a person with the Cost centers right only.'));

  // The probe: one per family, through the policy.
  const probed: string[] = [];
  const policy = { canReadEntityType: async (_context: unknown, type: string) => { probed.push(type); return type === 'cost_centers'; } };
  assert.deepEqual(await unreadFamiliesReachOf(policy, {}, {}), { reports: false, readable: ['cost_centers'] });
  assert.deepEqual(probed, ['chargeback', 'cost_centers', 'working_day_calendars', 'exchange_rates', 'analytics_axes']);
}

/**
 * search_all compares the words of a search with the codes and names of the reference data, the
 * words that name the family taken out, without case or accents (Plaid L9, lot F, M1).
 */
function testTheWordsOfAReferenceSearch() {
  assert.deepEqual(referenceSearchWords('cost_centers', 'centre de coûts Group IT'), { words: ['group', 'it'], rest: 'group it', named: true });
  assert.deepEqual(referenceSearchWords('cost_centers', 'cost centers Group IT').words, ['group', 'it']);
  assert.deepEqual(referenceSearchWords('working_day_calendars', 'calendrier France'), { words: ['france'], rest: 'france', named: false });
  assert.deepEqual(referenceSearchWords('working_day_calendars', 'calendrier des jours ouvrés de France').words, ['france']);
  assert.equal(referenceSearchWords('working_day_calendars', 'jours ouvrés France').named, true);
  assert.deepEqual(referenceSearchWords('working_day_calendars', 'working-day calendar CAD218').words, ['cad218']);
  assert.deepEqual(referenceSearchWords('analytics_axes', 'axe analytique it_tower').words, ['it_tower']);
  assert.deepEqual(referenceSearchWords('analytics_axes', 'dimension Priorité').words, ['priorite']);
  assert.ok(referenceSearchMatches(['group', 'it'], 'DSI-GRP', 'Group IT'));
  assert.ok(referenceSearchMatches(['securite'], 'FR-1', 'Sécurité'), 'without accents');
  assert.equal(referenceSearchMatches(['group', 'paris'], 'DSI-GRP', 'Group IT'), false, 'every word');
  assert.equal(referenceSearchMatches([], 'DSI-GRP', 'Group IT'), false, 'no word, no match');
  assert.ok(referenceSearchExact('group it', 'DSI-GRP', 'Group IT'));
  assert.equal(referenceSearchExact('group', 'DSI-GRP', 'Group IT'), false);
  const note = unmatchedReferenceFamilyNote('cost_centers', 'fr')!;
  assert.equal(note.family, 'cost centers');
  assert.equal(note.where, 'Données de référence › Centres de coûts');
  assert.match(note.note, /query_entities on cost_centers with q/);
  assert.equal(unmatchedReferenceFamilyNote('exchange_rates', 'fr'), null, 'the rates are not searched by code or name');
}

async function run() {
  testWordsThatAskForAFamily();
  testTheWordsOfAReferenceSearch();
  await testTheReferenceDataFollowTheirRights();
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
