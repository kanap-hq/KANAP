/**
 * What KANAP holds and the assistant tools do not read (Plaid and the MCP server). The tools say
 * so (search_all, describe_entity_filters, their descriptions), so that an answer never turns a
 * missing read into "it does not exist" (AGENTS.md, "When the assistant cannot read a family or a
 * field, its tools say so"). `where` is the KANAP screen that shows it, as its menu names it.
 */
export type AiUnreadFamily = {
  family: string;
  where: string;
  /** What the tools do read about it, when they read something. */
  hint?: string;
  /** Words of a search that ask for it, in the four languages of the application. */
  terms: RegExp;
};

export const AI_UNREAD_FAMILIES: readonly AiUnreadFamily[] = [
  {
    family: 'cost centers',
    where: 'Master data › Cost centers',
    hint: 'A budget line names its cost center: the cost_center field and filter of query_entities on spend_items and capex_items.',
    terms: /cost[\s_-]*cent|centres?\s+de\s+co[uû]ts?|kostenstelle|centros?\s+de\s+costes?/i,
  },
  {
    family: 'working-day calendars',
    where: 'Master data › Working-day calendars',
    // A working-day calendar, never a project or migration calendar.
    terms: /working[\s-]*days?|business[\s-]*days?|jours?\s+ouvr|arbeitstag|d[ií]as?\s+(h[aá]biles|laborables)|calendario\s+laboral/i,
  },
  {
    family: 'exchange rates',
    where: 'Budget management › Administration › Currencies',
    hint: 'Budget amounts come already converted to the reporting currency (amounts_currency).',
    terms: /exchange\s+rate|fx\s+rate|taux\s+de\s+change|wechselkurs|tipos?\s+de\s+cambio/i,
  },
  {
    family: 'analytics dimensions as records (their settings)',
    where: 'Master data › Analytics dimensions',
    hint: 'Their values are the analytics_categories family, and a budget line carries its value on each dimension.',
    // An analytics dimension, never a supplier or product named Dimension.
    terms: /analytic\w*\s+dimension|dimensions?\s+analytique|axes?\s+analytique|analysedimension|dimensi[oó]n(es)?\s+anal[ií]tica/i,
  },
  {
    family: 'data access (which companies or cost centers a person is limited to)',
    where: 'Admin › Data access',
    hint: 'A role says what a person may do, not which data they see.',
    // Not the bare "périmètre", the scope of every project.
    terms: /data\s+access|acc[eè]s\s+(aux\s+donn[eé]es|limit)|p[eé]rim[eè]tre\s+(de\s+)?(donn[eé]es|d['’]acc[eè]s)|datenzugriff|acceso\s+(a\s+(los\s+)?datos|limitado)/i,
  },
  {
    family: 'audit log',
    where: 'Admin › Audit log',
    // The log, not an audit project or a supplier audit.
    terms: /audit[\s_-]*(log|trail)|journal\s+d['’]audit|piste\s+d['’]audit|historique\s+des\s+modifications|änderungsprotokoll|audit[\s-]*protokoll|registro\s+de\s+auditor/i,
  },
  {
    family: 'AI agents',
    where: 'AI agents',
    // An AI agent, not a monitoring or backup agent on a server.
    terms: /\b(ai|ia|ki)[\s-]+agent(s|en)?\b|\bagents?\s+(ai|ia|plaid)\b|\bagentes?\s+(de\s+)?ia\b/i,
  },
  {
    family: 'chargeback by beneficiary company',
    where: 'Budget management › Reporting › Global chargeback',
    hint: 'A budget line\'s allocation to companies is in get_entity_detail of the line; no tool computes the chargeback across lines.',
    terms: /charge[\s-]*back|refactur|weiterverrechnung|repercusi[oó]n\s+de\s+costes/i,
  },
];

/** One line per family, for the tool descriptions and describe_entity_filters. */
export function unreadFamilyLines(): string[] {
  return AI_UNREAD_FAMILIES.map((entry) => `${entry.family} (${entry.where})`);
}

export const AI_UNREAD_FAMILIES_SENTENCE =
  `KANAP also holds what these tools do not read: ${unreadFamilyLines().join('; ')}. `
  + 'A search or list without a match is no proof that such a record does not exist: say that you cannot read it and name the screen that shows it.';

/** The unread families a search text asks for, each with the sentence the answer can give. */
export function unreadFamiliesAskedBy(query: string): Array<{ family: string; where: string; note: string }> {
  const text = String(query ?? '');
  return AI_UNREAD_FAMILIES
    .filter((entry) => entry.terms.test(text))
    .map((entry) => ({
      family: entry.family,
      where: entry.where,
      note: `KANAP has ${entry.family}; this server does not read them. They are on the screen ${entry.where}.${entry.hint ? ` ${entry.hint}` : ''}`,
    }));
}
