import type { EntityManager } from 'typeorm';

/**
 * What KANAP holds and the assistant tools do not read (Plaid and the MCP server). The tools say
 * so (search_all, describe_entity_filters, their descriptions), so that an answer never turns a
 * missing read into "it does not exist" (AGENTS.md, "When the assistant cannot read a family or a
 * field, its tools say so"). `screen` is the KANAP screen that shows it, as its menu names it in
 * the person's language.
 */

/** The languages of the application's menus. */
export type AiScreenLanguage = 'en' | 'fr' | 'de' | 'es';
export const AI_SCREEN_LANGUAGES: readonly AiScreenLanguage[] = ['en', 'fr', 'de', 'es'];

export type AiScreenPart =
  | 'masterData' | 'costCenters' | 'workingDayCalendars' | 'analyticsDimensions'
  | 'budgetManagement' | 'budgetAdministration' | 'currencies' | 'budgetReporting' | 'globalChargeback'
  | 'admin' | 'dataAccess' | 'roles' | 'users' | 'auditLog' | 'aiAgents';

/** Where each part of a screen name comes from in `frontend/src/locales/<lang>/<namespace>.json` (checked by a spec). */
export const AI_SCREEN_LABEL_KEYS: Record<AiScreenPart, { namespace: 'nav' | 'ops'; key: string }> = {
  masterData: { namespace: 'nav', key: 'workspaces.masterData' },
  costCenters: { namespace: 'nav', key: 'sidebar.masterData.costCenters' },
  workingDayCalendars: { namespace: 'nav', key: 'sidebar.masterData.workingDayCalendars' },
  analyticsDimensions: { namespace: 'nav', key: 'sidebar.masterData.analyticsDimensions' },
  budgetManagement: { namespace: 'nav', key: 'workspaces.budgetManagement' },
  budgetAdministration: { namespace: 'nav', key: 'sidebar.ops.administration' },
  currencies: { namespace: 'ops', key: 'operations.cards.currencyTitle' },
  budgetReporting: { namespace: 'nav', key: 'sidebar.ops.reporting' },
  globalChargeback: { namespace: 'ops', key: 'reports.landing.cards.globalChargeback.title' },
  admin: { namespace: 'nav', key: 'workspaces.admin' },
  dataAccess: { namespace: 'nav', key: 'sidebar.admin.dataAccess' },
  roles: { namespace: 'nav', key: 'sidebar.admin.roles' },
  users: { namespace: 'nav', key: 'sidebar.admin.users' },
  auditLog: { namespace: 'nav', key: 'sidebar.admin.auditLog' },
  aiAgents: { namespace: 'nav', key: 'workspaces.agents' },
};

/** The menu words of the screens, copied from the locale files of the frontend. */
export const AI_SCREEN_LABELS: Record<AiScreenLanguage, Record<AiScreenPart, string>> = {
  en: {
    masterData: 'Master data', costCenters: 'Cost centers', workingDayCalendars: 'Working-day calendars',
    analyticsDimensions: 'Analytics dimensions', budgetManagement: 'Budget management', budgetAdministration: 'Administration',
    currencies: 'Currencies', budgetReporting: 'Reporting', globalChargeback: 'Global chargeback',
    admin: 'Admin', dataAccess: 'Data access', roles: 'Roles', users: 'Users', auditLog: 'Audit log', aiAgents: 'AI agents',
  },
  fr: {
    masterData: 'Données de référence', costCenters: 'Centres de coûts', workingDayCalendars: 'Calendriers de jours ouvrés',
    analyticsDimensions: 'Dimensions analytiques', budgetManagement: 'Gestion budgétaire', budgetAdministration: 'Administration',
    currencies: 'Devises', budgetReporting: 'Rapports', globalChargeback: 'Refacturation globale',
    admin: 'Administration', dataAccess: 'Accès aux données', roles: 'Rôles', users: 'Utilisateurs', auditLog: 'Journal d\'audit',
    aiAgents: 'Agents IA',
  },
  de: {
    masterData: 'Stammdaten', costCenters: 'Kostenstellen', workingDayCalendars: 'Arbeitstagekalender',
    analyticsDimensions: 'Analysedimensionen', budgetManagement: 'Budgetverwaltung', budgetAdministration: 'Administration',
    currencies: 'Währungen', budgetReporting: 'Berichte', globalChargeback: 'Globale Leistungsverrechnung',
    admin: 'Administration', dataAccess: 'Datenzugriff', roles: 'Rollen', users: 'Benutzer', auditLog: 'Audit-Protokoll',
    aiAgents: 'KI-Agenten',
  },
  es: {
    masterData: 'Datos maestros', costCenters: 'Centros de coste', workingDayCalendars: 'Calendarios laborales',
    analyticsDimensions: 'Dimensiones analíticas', budgetManagement: 'Gestión presupuestaria', budgetAdministration: 'Administración',
    currencies: 'Monedas', budgetReporting: 'Informes', globalChargeback: 'Contracargo global',
    admin: 'Administración', dataAccess: 'Acceso a los datos', roles: 'Roles', users: 'Usuarios', auditLog: 'Registro de auditoría',
    aiAgents: 'Agentes IA',
  },
};

export type AiUnreadFamily = {
  family: string;
  /** The menu path of the screen that shows it. */
  screen: readonly AiScreenPart[];
  /** What the tools do read about it, when they read something. */
  hint?: string;
  /** Words of a search that ask for it, in the four languages of the application. */
  terms: RegExp;
  /**
   * Read by the tools for an administrator of users with access to all data, as its screen
   * (Admin › Roles, Admin › Data access): left out for them, and said with what is missing for
   * the others (`AiAdminFamiliesGap`).
   */
  usersAdminOnly?: true;
  /**
   * Read by the tools for a person with the Reporting right, as its screens (the families
   * `chargeback` and `chargeback_lines`): left out for them, and said with the right for the others.
   */
  reportingOnly?: true;
  /**
   * A family the tools read for a person with the right of its page (`entityType`, the right as
   * Admin › Roles names it): left out for them, and said with the right for the others
   * (`AiUnreadFamiliesReach.readable`). `searched` false: read by query_entities but not searched
   * by search_all (the exchange rates), which a search that asks for it says (`not_searched_here`).
   */
  readAs?: { entityType: string; right: string; searched: boolean };
  /**
   * For a family search_all searches by code or name: the words of a search that name the family
   * ("centre de coûts", "calendar", "dimension"), written without accents, taken out of the text
   * before the codes and names are compared (`referenceSearchWords`).
   */
  searchWords?: RegExp;
};

/**
 * Why the families of Admin › Roles and Admin › Data access are closed to a person: `right`, no
 * right to administer users; `all_data`, the right but an access limited to part of the data;
 * null, they read them (`AiPolicyService.adminFamiliesGap`). Undefined: not known (the tool
 * descriptions, common to everyone), both conditions are named.
 */
export type AiAdminFamiliesGap = 'right' | 'all_data' | null;

/**
 * What the person reads among the families kept for one right: `reports`, the chargeback reports
 * (the Reporting right, `canReadEntityType(…, 'chargeback')`); `readable`, the families of the
 * entries read as a family (`readAs`) the person reads. Undefined: not known (the tool
 * descriptions, common to everyone), the right is named. `omitReadAs`: the readable families are
 * not known and the families read with the right of their page are left out, as in
 * `AI_UNREAD_FAMILIES_SENTENCE` (a chat profile without the read tools).
 */
export type AiUnreadFamiliesReach = { reports?: boolean; readable?: readonly string[]; omitReadAs?: boolean };

/** What a person lacks to read a family of the administrators of users, in words. */
function usersAdminGapHint(gap: AiAdminFamiliesGap | undefined): string {
  if (gap === 'right') return 'The tools read it for a person with the right to administer users, which this person\'s role does not give.';
  if (gap === 'all_data') return 'The tools read it for a person with the right to administer users and access to all data; this person\'s access is limited to part of the data.';
  return 'The tools read it for a person with the right to administer users and access to all data only.';
}

/** What a person lacks to read the chargeback reports, in words. */
function reportingGapHint(reports: boolean | undefined): string {
  if (reports === false) return 'The tools read it (the families chargeback and chargeback_lines) for a person with the Reporting right, which this person\'s role does not give.';
  return 'The tools read it (the families chargeback and chargeback_lines) for a person with the Reporting right only.';
}

/** What a person lacks to read a family read with the right of its page, in words. */
function readAsGapHint(readAs: NonNullable<AiUnreadFamily['readAs']>, reach: AiUnreadFamiliesReach | undefined): string {
  const known = reach?.readable !== undefined;
  return `The tools read it (the family ${readAs.entityType}) for a person with the ${readAs.right} right${known ? ', which this person\'s role does not give.' : ' only.'}`;
}

/** Whether the person reads the family of an entry read as a family (`readAs`). */
function readsFamily(entry: AiUnreadFamily, reach: AiUnreadFamiliesReach | undefined): boolean {
  return !!entry.readAs && !!reach?.readable?.includes(entry.readAs.entityType);
}

/** The words that say what is missing for a family kept for a right; undefined for the others. */
function gapHint(entry: AiUnreadFamily, gap: AiAdminFamiliesGap | undefined, reach: AiUnreadFamiliesReach | undefined): string | undefined {
  if (entry.usersAdminOnly) return usersAdminGapHint(gap);
  if (entry.reportingOnly) return reportingGapHint(reach?.reports);
  if (entry.readAs) return readAsGapHint(entry.readAs, reach);
  return undefined;
}

/** A word of rates beside which a currency code asks for the exchange rates. */
const RATE_WORD = String.raw`\b(?:taux|cours|rates?|exchange|change|cambio|kurse?)\b`;

const EXCHANGE_RATE_TERMS = new RegExp([
  String.raw`\bexchange\s+rates?\b`,
  String.raw`\bfx\s+rates?\b`,
  String.raw`\btaux\s+de\s+change\b`,
  String.raw`\bwechselkurs`,
  String.raw`\btipos?\s+de\s+cambio\b`,
  String.raw`\bcurrenc(?:y|ies)\b`,
  String.raw`\bw[aä]hrung(?:en)?(?![a-zäöü])`,
  String.raw`\b(?:devises|monedas|divisas)\b`,
  // The singular in a phrase: "devise de reporting", "la devise", "moneda de reporte".
  String.raw`\b(?:devise|moneda|divisa)\s+(?:de|du|des|del|d['’]|par|por)\b`,
  String.raw`\b(?:la|une|quelle|en|una|qu[eé])\s+(?:devise|moneda|divisa)\b`,
  // A code or the singular anywhere in a text that has a word of rates.
  String.raw`^(?=[\s\S]*${RATE_WORD})[\s\S]*\b(?:eur|usd|gbp|chf|devise|moneda|divisa)\b`,
  String.raw`\b(?:eur|usd|gbp|chf|jpy|cad|aud|cny|sek|nok|dkk|pln)\s*\/\s*[a-z]{3}\b`,
].join('|'), 'i');

export const AI_UNREAD_FAMILIES: readonly AiUnreadFamily[] = [
  {
    family: 'cost centers',
    screen: ['masterData', 'costCenters'],
    hint: 'A budget line names its cost center: the cost_center field and filter of query_entities on budget_lines.',
    terms: /cost[\s_-]*cent|centres?\s+de\s+co[uû]ts?|kostenstelle|centros?\s+de\s+costes?/i,
    readAs: { entityType: 'cost_centers', right: 'Cost centers', searched: true },
    searchWords: /\b(?:centres?|centros?)\s+de\s+(?:couts?|costes?)\b|\bcost[\s_-]*cent(?:er|re)s?\b|\bkostenstellen?\b/g,
  },
  {
    family: 'working-day calendars',
    screen: ['masterData', 'workingDayCalendars'],
    // A working-day calendar, never a project or migration calendar.
    terms: /working[\s-]*days?|business[\s-]*days?|jours?\s+ouvr|arbeitstag|d[ií]as?\s+(h[aá]biles|laborables)|calendarios?\s+laboral/i,
    readAs: { entityType: 'working_day_calendars', right: 'Working-day calendars', searched: true },
    searchWords: /\bworking[\s-]*days?(?:\s+calendars?)?\b|\bbusiness[\s-]*days?\b|\bcalendriers?(?:\s+(?:des\s+|de\s+)?jours?\s+ouvres?)?\b|\bjours?\s+ouvres?\b|\bcalendars?\b|\barbeitstag\w*|\bkalender\b|\bcalendarios?(?:\s+laborales?)?\b|\bdias?\s+(?:habiles|laborables)\b/g,
  },
  {
    family: 'exchange rates',
    screen: ['budgetManagement', 'budgetAdministration', 'currencies'],
    // The rates and the currencies, in whole words. A currency code (EUR, USD) asks for them beside a
    // word of rates (taux, cours, rate, exchange, change) or as a pair (EUR/USD), and a currency in
    // the singular (devise, moneda, divisa) beside such a word or in a phrase: "USD Partners",
    // "Devise Consulting" and "Cryptocurrency wallet" are suppliers or products.
    terms: EXCHANGE_RATE_TERMS,
    readAs: { entityType: 'exchange_rates', right: 'Budget', searched: false },
  },
  {
    family: 'analytics dimensions',
    screen: ['masterData', 'analyticsDimensions'],
    // An analytics dimension, never a supplier or product named Dimension.
    terms: /analytic\w*\s+dimension|dimensions?\s+analytique|axes?\s+analytique|analysedimension|dimensi[oó]n(es)?\s+anal[ií]tica/i,
    readAs: { entityType: 'analytics_axes', right: 'Analytics', searched: true },
    searchWords: /\banalytic\w*\s+dimensions?\b|\b(?:dimensions?|axes?)\s+analytiques?\b|\banalysedimension\w*|\bdimension(?:es)?(?:\s+analiticas?)?\b|\bdimensions?\b|\baxes?\b/g,
  },
  {
    family: 'data access (which companies or cost centers a person is limited to)',
    screen: ['admin', 'dataAccess'],
    hint: 'A role says what a person may do, not which data they see.',
    // Not the bare "périmètre", the scope of every project.
    terms: /data\s+access|acc[eè]s\s+(aux\s+donn[eé]es|limit)|p[eé]rim[eè]tre\s+(de\s+)?(donn[eé]es|d['’]acc[eè]s)|datenzugriff|acceso\s+(a\s+(los\s+)?datos|limitado)/i,
    usersAdminOnly: true,
  },
  {
    family: 'roles and their rights',
    screen: ['admin', 'roles'],
    terms: /\br[oô]les?\b|\brollen?\b|\bpermissions?\s+(of|du|des|de)\b|\bdroits?\s+(du|des|d['’]un)\s+r[oô]les?\b/i,
    usersAdminOnly: true,
  },
  {
    family: 'audit log',
    screen: ['admin', 'auditLog'],
    // The log, not an audit project or a supplier audit. "Historique des modifications de TEC-3"
    // is the History tab of one record, which get_record_history reads: only the bare phrase is the log.
    terms: /audit[\s_-]*(log|trail)|journal\s+d['’]audit|piste\s+d['’]audit|historique\s+des\s+modifications(?!\s+(?:(?:de|du|des|of|on|for)\b|d['’]))|änderungsprotokoll|audit[\s-]*protokoll|registro\s+de\s+auditor/i,
  },
  {
    family: 'AI agents',
    screen: ['aiAgents'],
    // An AI agent, not a monitoring or backup agent on a server.
    terms: /\b(ai|ia|ki)[\s-]+agent(s|en)?\b|\bagents?\s+(ai|ia|plaid)\b|\bagentes?\s+(de\s+)?ia\b/i,
  },
  {
    family: 'chargeback by beneficiary company',
    screen: ['budgetManagement', 'budgetReporting', 'globalChargeback'],
    hint: 'A budget line\'s allocation to companies is in get_entity_detail of the line.',
    terms: /charge[\s-]*back|refactur|weiterverrechnung|leistungsverrechnung|contracargo|repercusi[oó]n\s+de\s+costes/i,
    reportingOnly: true,
  },
];

/** The language of a profile's `locale` (`fr`, `fr-FR`), or null when it names none of the four. */
export function aiScreenLanguage(locale: string | null | undefined): AiScreenLanguage | null {
  const code = String(locale ?? '').trim().toLowerCase().split(/[-_]/)[0];
  return (AI_SCREEN_LANGUAGES as readonly string[]).includes(code) ? code as AiScreenLanguage : null;
}

/**
 * The language of the person's menus when their profile sets one. Without it the menus follow the
 * browser, which the server does not know: the screens are then named in the four languages.
 */
export async function readAiScreenLanguage(
  manager: Pick<EntityManager, 'query'>,
  tenantId: string,
  userId: string | null | undefined,
): Promise<AiScreenLanguage | null> {
  if (!userId) return null;
  const rows: Array<{ locale: string | null }> = await manager.query(
    'SELECT locale FROM users WHERE tenant_id = $1 AND id = $2',
    [tenantId, userId],
  );
  return aiScreenLanguage(rows[0]?.locale);
}

/** A screen as its menu names it in one language: "Données de référence › Centres de coûts". */
function screenName(screen: readonly AiScreenPart[], language: AiScreenLanguage): string {
  return screen.map((part) => AI_SCREEN_LABELS[language][part]).join(' › ');
}

/** A screen by its menu path, in the person's language, or in the four languages when it is not known. */
export function aiScreenName(screen: readonly AiScreenPart[], language: AiScreenLanguage | null): string {
  if (language) return screenName(screen, language);
  return AI_SCREEN_LANGUAGES.map((code) => `${code}: ${screenName(screen, code)}`).join('; ');
}

/** The screen of an unread family in the person's language, or in the four languages when it is not known. */
export function unreadFamilyScreen(entry: AiUnreadFamily, language: AiScreenLanguage | null): string {
  return aiScreenName(entry.screen, language);
}

/**
 * The families this person does not read: all, but those of the administrators of users when `gap`
 * is null, and the chargeback reports when they read them.
 */
function unreadFamilies(gap: AiAdminFamiliesGap | undefined, reach: AiUnreadFamiliesReach | undefined): AiUnreadFamily[] {
  return AI_UNREAD_FAMILIES.filter((entry) => !(entry.usersAdminOnly && gap === null) && !(entry.reportingOnly && reach?.reports === true)
    && !readsFamily(entry, reach) && !(entry.readAs && reach?.omitReadAs));
}

/** The words that close a family's line: what the person lacks, for the families kept for a right. */
function entryHint(entry: AiUnreadFamily, gap: AiAdminFamiliesGap | undefined, reach: AiUnreadFamiliesReach | undefined): string | undefined {
  return [gapHint(entry, gap, reach), entry.hint].filter(Boolean).join(' ') || undefined;
}

/**
 * One line per family with its screen, for describe_entity_filters, search_all and the chat prompt.
 * `gap` says whether the person reads the families of the administrators of users, `reach` the
 * families kept for another right (see the types).
 */
export function unreadFamilyLines(language: AiScreenLanguage | null, gap?: AiAdminFamiliesGap, reach?: AiUnreadFamiliesReach): string[] {
  return unreadFamilies(gap, reach).map((entry) => {
    const line = `${entry.family} (${unreadFamilyScreen(entry, language)})`;
    const missing = gapHint(entry, gap, reach);
    return missing ? `${line}: ${missing}` : line;
  });
}

/** How a screen name is quoted (chat prompt): as given, in the person's language. */
const SCREEN_NAME_RULE = 'Quote a screen name exactly as given, never translated: it is the name in the person\'s menus, '
  + 'and when it comes in four languages (en, fr, de, es), quote the one of the person\'s language.';

/**
 * For the tool descriptions, shared by the chat and the MCP server: the families, without their
 * screens, stated as facts (the read tool descriptions give no orders, `ai-tool.registry.spec.ts`).
 */
export const AI_UNREAD_FAMILIES_SENTENCE =
  `KANAP also holds what these tools do not read: ${AI_UNREAD_FAMILIES
    // The families read with the right of their page are families of these tools, as any other.
    .filter((entry) => !entry.readAs)
    .map((entry) => (entry.usersAdminOnly
      ? `${entry.family} (read for administrators of users with access to all data only)`
      : entry.reportingOnly ? `${entry.family} (read for people with the Reporting right only)` : entry.family))
    .join('; ')}. `
  + 'A search or list without a match is no proof that such a record does not exist: say that you cannot read it and name the screen that shows it, '
  + 'as `not_read_here` or `families_not_read` gives it. A screen name is the name in the person\'s menus, in the language of their profile, '
  + 'or in four languages (en, fr, de, es) when the profile sets none: the person\'s own is the one to quote, untranslated.';

/** For the chat prompt: the families this person does not read, with their screens in the person's language. */
export function unreadFamiliesSentence(language: AiScreenLanguage | null, gap?: AiAdminFamiliesGap, reach?: AiUnreadFamiliesReach): string {
  return `KANAP also holds what these tools do not read: ${unreadFamilyLines(language, gap, reach).join('; ')}. `
    + 'A search or list without a match is no proof that such a record does not exist: say that you cannot read it and name the screen that shows it. '
    + SCREEN_NAME_RULE;
}

/** Whether a search text asks for a family the tools may not read (for everyone, or for this person). */
export function asksForUnreadFamily(query: string): boolean {
  const text = String(query ?? '');
  return AI_UNREAD_FAMILIES.some((entry) => entry.terms.test(text));
}

/** The unread families a search text asks for, each with the sentence the answer can give. */
export function unreadFamiliesAskedBy(
  query: string,
  language: AiScreenLanguage | null,
  gap?: AiAdminFamiliesGap,
  reach?: AiUnreadFamiliesReach,
): Array<{ family: string; where: string; note: string }> {
  const text = String(query ?? '');
  return unreadFamilies(gap, reach)
    .filter((entry) => entry.terms.test(text))
    .map((entry) => {
      const where = unreadFamilyScreen(entry, language);
      const screen = language ? `the screen ${where}` : `the screen named, in the person's language, ${where}`;
      const hint = entryHint(entry, gap, reach);
      const read = entry.usersAdminOnly || entry.reportingOnly || entry.readAs ? 'this server does not read them for this person' : 'this server does not read them';
      return {
        family: entry.family,
        where,
        note: `KANAP has ${entry.family}; ${read}. They are on ${screen}.${hint ? ` ${hint}` : ''}`,
      };
    });
}

/**
 * The families a search text asks for that the person reads but `search_all` does not search
 * (the exchange rates), each with the sentence the answer can give (`not_searched_here`).
 */
export function notSearchedFamiliesAskedBy(
  query: string,
  language: AiScreenLanguage | null,
  reach?: AiUnreadFamiliesReach,
): Array<{ family: string; where: string; note: string }> {
  const text = String(query ?? '');
  return AI_UNREAD_FAMILIES
    .filter((entry) => entry.readAs && !entry.readAs.searched && readsFamily(entry, reach) && entry.terms.test(text))
    .map((entry) => ({
      family: entry.family,
      where: unreadFamilyScreen(entry, language),
      note: `The ${entry.family} are read by query_entities on ${entry.readAs!.entityType}, not searched by search_all.`,
    }));
}

/** Lower case, without accents: "Coûts" is "couts". */
function plainText(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Linking words of a search, which no code or name needs to hold ("calendrier de France"). */
const LINKING_WORDS = new Set(['de', 'du', 'des', 'd', 'la', 'le', 'les', 'l', 'the', 'of', 'for', 'pour', 'der', 'die', 'das', 'el', 'los', 'del']);

/** The family of a searched reference data entry (`readAs.searched`), by its AI family. */
function searchedEntry(entityType: string): AiUnreadFamily | undefined {
  return AI_UNREAD_FAMILIES.find((entry) => entry.readAs?.entityType === entityType && entry.readAs.searched && entry.searchWords);
}

/**
 * The words of a search compared with the codes and names of one reference data family: the text
 * without the words that name the family ("centre de coûts Group IT" gives `group`, `it`), lower
 * case and without accents. `rest` is that text, for the rank of an exact code or name; `named`,
 * whether the text names the family in the words of its unread entry (`terms`).
 */
export function referenceSearchWords(entityType: string, query: string): { words: string[]; rest: string; named: boolean } {
  const entry = searchedEntry(entityType);
  const text = String(query ?? '');
  const plain = plainText(text);
  const rest = (entry?.searchWords ? plain.replace(entry.searchWords, ' ') : plain).replace(/\s+/g, ' ').trim();
  const words = rest.split(' ')
    .map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter((word) => word.length > 0 && !LINKING_WORDS.has(word));
  return { words, rest, named: !!entry && entry.terms.test(text) };
}

/** Whether a code or a name holds every word of a search, without case or accents. */
export function referenceSearchMatches(words: readonly string[], code: string, name: string): boolean {
  if (words.length === 0) return false;
  const plainCode = plainText(code);
  const plainName = plainText(name);
  return words.every((word) => plainCode.includes(word) || plainName.includes(word));
}

/** Whether a code or a name equals the search once the family's words are out: the rank of a reference. */
export function referenceSearchExact(rest: string, code: string, name: string): boolean {
  return !!rest && (plainText(code) === rest || plainText(name) === rest);
}

/**
 * The note of a reference data family a search names without matching any of its records
 * (`not_searched_here`): search_all compares codes and names only, so the family is read by
 * query_entities. It names no record and concludes nothing.
 */
export function unmatchedReferenceFamilyNote(
  entityType: string,
  language: AiScreenLanguage | null,
): { family: string; where: string; note: string } | null {
  const entry = searchedEntry(entityType);
  if (!entry) return null;
  return {
    family: entry.family,
    where: unreadFamilyScreen(entry, language),
    note: `search_all compares the words of the search with the codes and names of the ${entry.family} only. `
      + `Read them by query_entities on ${entityType} with q (a code or a word of a name) before saying whether one exists.`,
  };
}

/** The families of the entries read as a family (`readAs`), whose right `unreadFamiliesReachOf` probes. */
const READ_AS_ENTITY_TYPES = AI_UNREAD_FAMILIES.flatMap((entry) => (entry.readAs ? [entry.readAs.entityType] : []));

/**
 * What the person reads among the families kept for a right (`AiUnreadFamiliesReach`), through the
 * policy's probe of one family (`AiPolicyService.canReadEntityType`).
 */
export async function unreadFamiliesReachOf<C, M>(
  policy: { canReadEntityType(context: C, entityType: any, manager: M): Promise<boolean> },
  context: C,
  manager: M,
): Promise<AiUnreadFamiliesReach> {
  const reports = await policy.canReadEntityType(context, 'chargeback', manager);
  const readable: string[] = [];
  for (const entityType of READ_AS_ENTITY_TYPES) {
    if (await policy.canReadEntityType(context, entityType, manager)) readable.push(entityType);
  }
  return { reports, readable };
}
