import { escapeMarkdownLabel, quoted, type AiTranslatedWriteLanguage, type AiWriteLanguage } from './ai-write-texts';

/**
 * The words of Kad's cards of a change in bulk (lot K1 of 26.11.9), made by the server in the
 * person's language as the other cards: the filter in words, the scope, the field and its new
 * value, the counts, the refusals and the first rows. The words the list screens already show come
 * from their locale files and are checked against them by `ai-bulk-edit-texts.spec.ts` (the column
 * labels of the budget lines list, the field labels of its "Change the selection" dialog, the
 * refusals of that dialog). Shared by the cards of the budget lines and, next, of the applications.
 */

type Words = Readonly<Record<AiWriteLanguage, string>>;
type WordTable = Readonly<Record<AiWriteLanguage, Readonly<Record<string, string>>>>;

/** The refusals of the "Change the selection" dialog (`common:bulkEdit.refusals`). */
export const BULK_EDIT_REFUSAL_WORDS: WordTable = {
  en: {
    not_found: 'Not found',
    read_only: 'Read only for you',
    placement: 'Company or cost center outside your access',
    leaves_access: 'Would leave your access',
    account_chart: "Account outside the company's chart of accounts",
    account_nature: 'Account not for this type of line',
    dimension_required: 'Required dimension',
    dimension_not_applicable: 'Dimension not for this type of line',
    value_not_applicable: 'Value not for this type of line',
    other: 'Other reason',
  },
  fr: {
    not_found: 'Introuvable',
    read_only: 'En lecture seule pour vous',
    placement: 'Société ou centre de coûts hors de votre accès',
    leaves_access: 'Sortirait de votre accès',
    account_chart: 'Compte hors du plan comptable de la société',
    account_nature: 'Compte non prévu pour ce type de ligne',
    dimension_required: 'Dimension obligatoire',
    dimension_not_applicable: 'Dimension non prévue pour ce type de ligne',
    value_not_applicable: 'Valeur non prévue pour ce type de ligne',
    other: 'Autre raison',
  },
  de: {
    not_found: 'Nicht gefunden',
    read_only: 'Für Sie nur lesbar',
    placement: 'Unternehmen oder Kostenstelle außerhalb Ihres Zugriffs',
    leaves_access: 'Würde Ihren Zugriff verlassen',
    account_chart: 'Konto außerhalb des Kontenplans des Unternehmens',
    account_nature: 'Konto nicht für diese Zeilenart vorgesehen',
    dimension_required: 'Pflichtdimension',
    dimension_not_applicable: 'Dimension nicht für diese Zeilenart vorgesehen',
    value_not_applicable: 'Wert nicht für diese Zeilenart vorgesehen',
    other: 'Anderer Grund',
  },
  es: {
    not_found: 'No encontrada',
    read_only: 'Solo lectura para usted',
    placement: 'Empresa o centro de coste fuera de su acceso',
    leaves_access: 'Saldría de su acceso',
    account_chart: 'Cuenta fuera del plan de cuentas de la empresa',
    account_nature: 'Cuenta no prevista para este tipo de línea',
    dimension_required: 'Dimensión obligatoria',
    dimension_not_applicable: 'Dimensión no prevista para este tipo de línea',
    value_not_applicable: 'Valor no previsto para este tipo de línea',
    other: 'Otro motivo',
  },
};

/** "Empty", the new value of a field emptied (`common:bulkEdit.emptied`). */
export const BULK_EDIT_EMPTIED: Words = { en: 'Empty', fr: 'Vide', de: 'Leer', es: 'Vacío' };

/**
 * The fields of the budget lines Kad's filter accepts, labelled as the columns of the list
 * (`ops:opex.columns.*`, `ops:budget.type`, `ops:opex.metadata.status`). The dimensions
 * (`analytics_category`, `analytics:<code>`) are named by the tenant's own dimension name.
 */
export const BUDGET_LINE_FILTER_LABELS: WordTable = {
  en: {
    nature: 'Type', status: 'Status', product_name: 'Product name', supplier: 'Supplier', paying_company: 'Paying company',
    account: 'Account', cost_center: 'Cost center', contract: 'Contract', owner_it: 'IT owner', owner_business: 'Business owner',
    run_build: 'Run or build',
  },
  fr: {
    nature: 'Type', status: 'Statut', product_name: 'Nom du produit', supplier: 'Fournisseur', paying_company: 'Société payeuse',
    account: 'Compte', cost_center: 'Centre de coûts', contract: 'Contrat', owner_it: 'Responsable IT', owner_business: 'Responsable métier',
    run_build: 'Run ou build',
  },
  de: {
    nature: 'Typ', status: 'Status', product_name: 'Produktname', supplier: 'Lieferant', paying_company: 'Zahlendes Unternehmen',
    account: 'Konto', cost_center: 'Kostenstelle', contract: 'Vertrag', owner_it: 'IT-Verantwortlicher', owner_business: 'Fachbereichsverantwortlicher',
    run_build: 'Run oder Build',
  },
  es: {
    nature: 'Tipo', status: 'Estado', product_name: 'Nombre del producto', supplier: 'Proveedor', paying_company: 'Empresa pagadora',
    account: 'Cuenta', cost_center: 'Centro de coste', contract: 'Contrato', owner_it: 'Responsable IT', owner_business: 'Responsable de negocio',
    run_build: 'Run o build',
  },
};

/** The values of the closed lists of the filter, as the list shows them (`ops:opex.status`, `ops:opex.runBuild`). */
export const BUDGET_LINE_VALUE_WORDS: Readonly<Record<AiWriteLanguage, Readonly<Record<string, Readonly<Record<string, string>>>>>> = {
  en: { status: { enabled: 'Enabled', disabled: 'Disabled' }, run_build: { run: 'Run', build: 'Build' }, nature: { opex: 'OPEX', capex: 'CAPEX' } },
  fr: { status: { enabled: 'Activé', disabled: 'Désactivé' }, run_build: { run: 'Run', build: 'Build' }, nature: { opex: 'OPEX', capex: 'CAPEX' } },
  de: { status: { enabled: 'Aktiviert', disabled: 'Deaktiviert' }, run_build: { run: 'Run', build: 'Build' }, nature: { opex: 'OPEX', capex: 'CAPEX' } },
  es: { status: { enabled: 'Activado', disabled: 'Desactivado' }, run_build: { run: 'Run', build: 'Build' }, nature: { opex: 'OPEX', capex: 'CAPEX' } },
};

/**
 * The fields Kad changes in bulk on budget lines, labelled as the "Change the selection" dialog of
 * the list (`ops:opex.fields.*`, `ops:opex.metadata.*`). A dimension is named by its own name.
 */
export const BUDGET_LINE_BULK_FIELD_LABELS: WordTable = {
  en: {
    cost_center: 'Cost center', account: 'Account', paying_company: 'Paying company', supplier: 'Supplier',
    owner_it: 'IT owner', owner_business: 'Business owner', run_build: 'Run or build',
  },
  fr: {
    cost_center: 'Centre de coûts', account: 'Compte', paying_company: 'Société payeuse', supplier: 'Fournisseur',
    owner_it: 'Responsable IT', owner_business: 'Responsable métier', run_build: 'Run ou build',
  },
  de: {
    cost_center: 'Kostenstelle', account: 'Konto', paying_company: 'Zahlendes Unternehmen', supplier: 'Lieferant',
    owner_it: 'IT-Verantwortlicher', owner_business: 'Fachverantwortlicher', run_build: 'Run oder Build',
  },
  es: {
    cost_center: 'Centro de coste', account: 'Cuenta', paying_company: 'Empresa pagadora', supplier: 'Proveedor',
    owner_it: 'Responsable de TI', owner_business: 'Responsable de negocio', run_build: 'Run o build',
  },
};

/** One part of the filter in words: a field and its values (`not`: every value but these; `contains`: a text). */
export type BulkFilterPart = { label: string; op: 'in' | 'not' | 'contains'; values: Array<string | null>; quote: boolean };

/** The words of a family's rows on the card. */
type BulkFamilyWords = {
  rows: (n: number) => string;
  title: (n: number) => string;
  chosen: string;
  scope: string;
};

const FAMILY_WORDS: Readonly<Record<'budget_lines', Readonly<Record<AiWriteLanguage, BulkFamilyWords>>>> = {
  budget_lines: {
    en: {
      rows: (n) => `${n} line${n === 1 ? '' : 's'}`,
      title: (n) => `${n} budget line${n === 1 ? '' : 's'}`,
      chosen: 'Chosen lines',
      scope: 'Scope: enabled lines',
    },
    fr: {
      rows: (n) => `${n} ligne${n === 1 ? '' : 's'}`,
      title: (n) => `${n} ligne${n === 1 ? '' : 's'} budgétaire${n === 1 ? '' : 's'}`,
      chosen: 'Lignes choisies',
      scope: 'Périmètre : lignes activées',
    },
    de: {
      rows: (n) => `${n} Zeile${n === 1 ? '' : 'n'}`,
      title: (n) => `${n} Budgetzeile${n === 1 ? '' : 'n'}`,
      chosen: 'Ausgewählte Zeilen',
      scope: 'Umfang: aktivierte Zeilen',
    },
    es: {
      rows: (n) => `${n} línea${n === 1 ? '' : 's'}`,
      title: (n) => `${n} línea${n === 1 ? '' : 's'} presupuestaria${n === 1 ? '' : 's'}`,
      chosen: 'Líneas elegidas',
      scope: 'Alcance: líneas activadas',
    },
  },
};

export type BulkEditFamily = keyof typeof FAMILY_WORDS;

/** The title of the card: the rows that will change. */
export function bulkEditTitleText(family: BulkEditFamily, language: AiWriteLanguage, rows: number): string {
  return FAMILY_WORDS[family][language].title(rows);
}

const COLON: Words = { en: ': ', fr: ' : ', de: ': ', es: ': ' };
const SEPARATOR: Words = { en: '; ', fr: ' ; ', de: '; ', es: '; ' };
const FILTER: Words = { en: 'Filter', fr: 'Filtre', de: 'Filter', es: 'Filtro' };
const CONTAINS: Words = { en: 'contains', fr: 'contient', de: 'enthält', es: 'contiene' };
const EXCEPT: Words = { en: 'except', fr: 'sauf', de: 'außer', es: 'excepto' };
const NO_VALUE: Words = { en: '(empty)', fr: '(vide)', de: '(leer)', es: '(vacío)' };
/** Chosen rows the card names; the rest is counted. */
const CHOSEN_SHOWN = 10;

function andMore(language: AiWriteLanguage, more: number): string {
  return {
    en: `and ${more} more`,
    fr: more === 1 ? 'et 1 autre' : `et ${more} autres`,
    de: `und ${more} weitere`,
    es: `y ${more} más`,
  }[language];
}

function filterPartText(part: BulkFilterPart, language: AiWriteLanguage): string {
  const values = part.values
    .map((value) => (value === null ? NO_VALUE[language] : part.quote ? quoted(language, value) : value))
    .join(', ');
  if (part.op === 'contains') return `${part.label} ${CONTAINS[language]} ${values}`;
  if (part.op === 'not') return `${part.label} ${EXCEPT[language]} ${values}`;
  return `${part.label} ${values}`;
}

export type BulkEditCard = {
  family: BulkEditFamily;
  /** The rows of a filter (its parts in words, and whether the scope is the list's default), or chosen rows by reference. */
  selection: { kind: 'filter'; parts: BulkFilterPart[]; defaultScope: boolean } | { kind: 'rows'; refs: string[] };
  /** The field's label and its new value (null: emptied). */
  field: string;
  value: string | null;
  /** The rows reached, those that would change, those that already hold the value, the refused ones per code. */
  rows: number;
  changes: number;
  unchanged: number;
  refused: Record<string, number>;
  /** The first rows that would change, by reference: `BL-3 Office licences`. */
  examples: Array<{ ref: string; title: string }>;
};

/** The words of a refusal code, "Other reason" for a code the dialog does not word. */
export function bulkEditRefusalText(language: AiWriteLanguage, code: string): string {
  return BULK_EDIT_REFUSAL_WORDS[language][code] ?? BULK_EDIT_REFUSAL_WORDS[language].other;
}

/**
 * The card of a change in bulk: the rows (the filter in words and the scope, or the chosen rows),
 * the field and its new value, the counts with the refusals in the dialog's words, and the first
 * rows that would change. One block per line of meaning.
 */
export function bulkEditCardText(card: BulkEditCard, language: AiWriteLanguage): string {
  const words = FAMILY_WORDS[card.family][language];
  const colon = COLON[language];
  const blocks: string[] = [];
  if (card.selection.kind === 'filter') {
    const parts = card.selection.parts.map((part) => filterPartText(part, language));
    blocks.push(escapeMarkdownLabel(`${FILTER[language]}${colon}${parts.join(SEPARATOR[language])}`));
    if (card.selection.defaultScope) blocks.push(words.scope);
  } else {
    const shown = card.selection.refs.slice(0, CHOSEN_SHOWN);
    const more = card.selection.refs.length - shown.length;
    blocks.push(escapeMarkdownLabel(`${words.chosen}${colon}${shown.join(', ')}${more > 0 ? ` ${andMore(language, more)}` : ''}`));
  }
  const value = card.value === null ? BULK_EDIT_EMPTIED[language] : card.value;
  blocks.push(escapeMarkdownLabel(`${card.field} → ${value}`));
  const counts = [{
    en: `${words.rows(card.changes)} to change`,
    fr: `${words.rows(card.changes)} à modifier`,
    de: `${words.rows(card.changes)} zu ändern`,
    es: `${words.rows(card.changes)} por modificar`,
  }[language]];
  if (card.unchanged > 0) {
    const one = card.unchanged === 1;
    counts.push({
      en: `${card.unchanged} already ${one ? 'has' : 'have'} this value`,
      fr: `${card.unchanged} ${one ? 'a' : 'ont'} déjà cette valeur`,
      de: `${card.unchanged} ${one ? 'hat' : 'haben'} diesen Wert bereits`,
      es: `${card.unchanged} ya ${one ? 'tiene' : 'tienen'} este valor`,
    }[language]);
  }
  const refused = Object.entries(card.refused).filter(([, n]) => n > 0);
  const refusedTotal = refused.reduce((sum, [, n]) => sum + n, 0);
  let line = counts.join(', ');
  if (refusedTotal > 0) {
    const one = refusedTotal === 1;
    const head = {
      en: `${refusedTotal} refused`,
      fr: `${refusedTotal} refusée${one ? '' : 's'}`,
      de: `${refusedTotal} abgelehnt`,
      es: `${refusedTotal} rechazada${one ? '' : 's'}`,
    }[language];
    const reasons = refused.map(([code, n]) => `${bulkEditRefusalText(language, code)} (${n})`).join(', ');
    line = `${line}, ${head}${colon}${reasons}`;
  }
  blocks.push(line);
  const examples = card.examples.slice(0, 5);
  if (examples.length > 0) {
    const more = card.changes - examples.length;
    blocks.push([
      ...examples.map((row) => `- ${escapeMarkdownLabel(`${row.ref} ${row.title}`.trim())}`),
      ...(more > 0 ? [`- ${andMore(language, more)}`] : []),
    ].join('\n'));
  }
  return blocks.join('\n\n');
}

/** The action of a change in bulk, for the summaries in fr, de and es: the field and the rows. */
export function bulkEditActionText(language: AiTranslatedWriteLanguage, family: BulkEditFamily, field: string, rows: number): string {
  const title = bulkEditTitleText(family, language, rows);
  switch (language) {
    case 'fr': return `modification du champ ${quoted(language, field)} sur ${title}`;
    case 'de': return `Feld ${quoted(language, field)} in ${title} ändern`;
    case 'es': return `modificación del campo ${quoted(language, field)} en ${title}`;
  }
}
