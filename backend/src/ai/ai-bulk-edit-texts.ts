import { escapeMarkdownLabel, quoted, type AiTranslatedWriteLanguage, type AiWriteLanguage } from './ai-write-texts';

/**
 * The words of Kad's cards of a change in bulk (lot K1 of 26.11.9), made by the server in the
 * person's language as the other cards: the filter in words, the scope, the field and its new
 * value, the counts, the refusals and the first rows. The words the list screens already show come
 * from their locale files and are checked against them by `ai-bulk-edit-texts.spec.ts` (the column
 * labels of the budget lines list, the field labels of its "Change the selection" dialog, the
 * refusals of that dialog), and the same for the applications list. Shared by the cards of the
 * budget lines and of the applications.
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

/** A value before that the person may not read (a record outside their access): the card's list says so, never names it. */
export const BULK_EDIT_HIDDEN: Words = { en: 'Hidden', fr: 'Masqué', de: 'Verborgen', es: 'Oculto' };

/**
 * The refusal of a card whose records are all left out (lot K2e of 26.12.1): nothing to approve,
 * the card stays pending and a record ticked again makes it approvable.
 */
export const BULK_EDIT_ALL_LEFT_OUT_MESSAGE = 'Every record of this card is left out: there is nothing to approve.';
export const BULK_EDIT_ALL_LEFT_OUT: Words = {
  en: BULK_EDIT_ALL_LEFT_OUT_MESSAGE,
  fr: "Toutes les fiches de cette carte sont écartées : il n'y a rien à approuver.",
  de: 'Alle Datensätze dieser Karte sind ausgeschlossen: Es gibt nichts zu genehmigen.',
  es: 'Todos los registros de esta tarjeta están excluidos: no hay nada que aprobar.',
};

/**
 * The refusal of a recount that would list more than `max` records (review of lot K2e): records
 * entered the selection since the card; the card stays as it was and the person asks for a new one.
 */
export function bulkEditListGrewText(language: AiWriteLanguage, max: number): string {
  return {
    en: `The selection grew past ${max} records since the count: ask for a new card.`,
    fr: `La sélection a dépassé ${max} fiches depuis le comptage : demandez une nouvelle carte.`,
    de: `Die Auswahl umfasst seit der Zählung mehr als ${max} Datensätze: Fordern Sie eine neue Karte an.`,
    es: `La selección ha superado los ${max} registros desde el recuento: pida una nueva tarjeta.`,
  }[language];
}

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

/**
 * The fields of the applications Kad's filter accepts, labelled as the columns of the list
 * (`it:pages.applications.columns.*`, `it:common.lifecycle`, `it:classification.*`,
 * `it:pages.interfaces.columns.containsPii`).
 */
export const APPLICATION_FILTER_LABELS: WordTable = {
  en: {
    lifecycle: 'Lifecycle', criticality: 'Business criticality', cyber_criticality: 'Cyber criticality', data_class: 'Data class',
    recovery_wave: 'Recovery wave', category: 'Category', supplier: 'Supplier', editor: 'Publisher', it_owner: 'IT owners',
    business_owner: 'Business owners', external_facing: 'External facing', contains_pii: 'Contains PII',
  },
  fr: {
    lifecycle: 'Cycle de vie', criticality: 'Criticité business', cyber_criticality: 'Criticité cyber', data_class: 'Classification des données',
    recovery_wave: 'Vague de reprise', category: 'Catégorie', supplier: 'Fournisseur', editor: 'Éditeur', it_owner: 'Responsables IT',
    business_owner: 'Responsables métier', external_facing: 'Exposition externe', contains_pii: 'Contient des PII',
  },
  de: {
    lifecycle: 'Lebenszyklus', criticality: 'Geschäftskritikalität', cyber_criticality: 'Cyberkritikalität', data_class: 'Datenklasse',
    recovery_wave: 'Wiederanlaufwelle', category: 'Kategorie', supplier: 'Lieferant', editor: 'Herausgeber', it_owner: 'IT-Verantwortliche',
    business_owner: 'Fachverantwortliche', external_facing: 'Extern zugänglich', contains_pii: 'Enthält PII',
  },
  es: {
    lifecycle: 'Ciclo de vida', criticality: 'Criticidad de negocio', cyber_criticality: 'Criticidad cibernética', data_class: 'Clasificación de datos',
    recovery_wave: 'Ola de recuperación', category: 'Categoría', supplier: 'Proveedor', editor: 'Editor', it_owner: 'Responsables IT',
    business_owner: 'Responsables de negocio', external_facing: 'Acceso externo', contains_pii: 'Contiene PII',
  },
};

/** The yes and no of the list's yes-or-no columns (`it:enums.yesNo`). */
export const APPLICATION_YES_NO_WORDS: Readonly<Record<AiWriteLanguage, Readonly<Record<'true' | 'false', string>>>> = {
  en: { true: 'Yes', false: 'No' },
  fr: { true: 'Oui', false: 'Non' },
  de: { true: 'Ja', false: 'Nein' },
  es: { true: 'Sí', false: 'No' },
};

/**
 * The fields Kad changes in bulk on applications, labelled as the "Change the selection" dialog of
 * the list (`it:pages.applications.columns.*`, `it:common.lifecycle`, `it:classification.business_criticality`,
 * `it:classification.cyber_criticality`).
 */
export const APPLICATION_BULK_FIELD_LABELS: WordTable = {
  en: { owners_business: 'Business owners', owners_it: 'IT owners', category: 'Category', lifecycle: 'Lifecycle', criticality: 'Business criticality', cyber_criticality: 'Cyber criticality' },
  fr: { owners_business: 'Responsables métier', owners_it: 'Responsables IT', category: 'Catégorie', lifecycle: 'Cycle de vie', criticality: 'Criticité business', cyber_criticality: 'Criticité cyber' },
  de: { owners_business: 'Fachverantwortliche', owners_it: 'IT-Verantwortliche', category: 'Kategorie', lifecycle: 'Lebenszyklus', criticality: 'Geschäftskritikalität', cyber_criticality: 'Cyberkritikalität' },
  es: { owners_business: 'Responsables de negocio', owners_it: 'Responsables IT', category: 'Categoría', lifecycle: 'Ciclo de vida', criticality: 'Criticidad de negocio', cyber_criticality: 'Criticidad cibernética' },
};

/**
 * One part of the filter in words: a field and its values (`not`: every value but these; `contains`:
 * a text). Every value is quoted, a closed one as a typed one; an empty one is worded.
 */
export type BulkFilterPart = { label: string; op: 'in' | 'not' | 'contains'; values: Array<string | null> };

/** The words of a family's rows on the card. */
type BulkFamilyWords = {
  rows: (n: number) => string;
  title: (n: number) => string;
  chosen: string;
  /** The scope of a filter that names none of the list's scope fields. */
  scope: string;
  /** The scope left when the filter names one (the applications' lifecycle: disabled ones stay out). */
  namedScope?: string;
};

const FAMILY_WORDS: Readonly<Record<'budget_lines' | 'applications', Readonly<Record<AiWriteLanguage, BulkFamilyWords>>>> = {
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
  applications: {
    en: {
      rows: (n) => `${n} application${n === 1 ? '' : 's'}`,
      title: (n) => `${n} application${n === 1 ? '' : 's'}`,
      chosen: 'Chosen applications',
      scope: 'Scope: enabled applications, retired ones left out',
      namedScope: 'Scope: enabled applications',
    },
    fr: {
      rows: (n) => `${n} application${n === 1 ? '' : 's'}`,
      title: (n) => `${n} application${n === 1 ? '' : 's'}`,
      chosen: 'Applications choisies',
      scope: 'Périmètre : applications activées, hors retirées',
      namedScope: 'Périmètre : applications activées',
    },
    de: {
      rows: (n) => `${n} Anwendung${n === 1 ? '' : 'en'}`,
      title: (n) => `${n} Anwendung${n === 1 ? '' : 'en'}`,
      chosen: 'Ausgewählte Anwendungen',
      scope: 'Umfang: aktivierte Anwendungen, ohne ausgemusterte',
      namedScope: 'Umfang: aktivierte Anwendungen',
    },
    es: {
      rows: (n) => `${n} aplicaci${n === 1 ? 'ón' : 'ones'}`,
      title: (n) => `${n} aplicaci${n === 1 ? 'ón' : 'ones'}`,
      chosen: 'Aplicaciones elegidas',
      scope: 'Alcance: aplicaciones activadas, sin las retiradas',
      namedScope: 'Alcance: aplicaciones activadas',
    },
  },
};

export type BulkEditFamily = keyof typeof FAMILY_WORDS;

/** The rows that will change, counted: the title of a card by filter, and the summaries. */
export function bulkEditTitleText(family: BulkEditFamily, language: AiWriteLanguage, rows: number): string {
  return FAMILY_WORDS[family][language].title(rows);
}

/** The label of the card's change, "Change in bulk" (`ai:previewCard.fields.*_bulk_edit`). */
export const BULK_EDIT_CARD_LABEL: Words = { en: 'Change in bulk', fr: 'Modification en masse', de: 'Massenänderung', es: 'Modificación masiva' };
/** References a card's title names; the rest is counted. */
const TITLE_REFS_SHOWN = 3;

/**
 * The title of the card: a card by references names them, up to three ("Change in bulk: APP-5,
 * APP-40 and 2 more"), so that two such cards differ in the panel; a card by filter counts the rows
 * that will change.
 */
export function bulkEditCardTitleText(family: BulkEditFamily, language: AiWriteLanguage, rows: number, refs: string[] | null): string {
  if (!refs || refs.length === 0) return bulkEditTitleText(family, language, rows);
  const shown = refs.slice(0, TITLE_REFS_SHOWN);
  const more = refs.length - shown.length;
  return `${BULK_EDIT_CARD_LABEL[language]}${COLON[language]}${shown.join(', ')}${more > 0 ? ` ${andMore(language, more)}` : ''}`;
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
    .map((value) => (value === null ? NO_VALUE[language] : quoted(language, value)))
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
  /** The first rows that would change, by reference: `BL-3 Office licences`. Not shown when the card lists its rows (`listed`). */
  examples: Array<{ ref: string; title: string }>;
  /** The rows the person left out (lot K2e of 26.12.1), counted after those to change. */
  excluded?: number;
  /** The card lists every row it changes (`bulk_edit`): the first rows are not named again. */
  listed?: boolean;
  /** The card was approved: its summary says what changed, the counts made before are not shown again. */
  done?: boolean;
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
    else if (words.namedScope) blocks.push(words.namedScope);
  } else {
    const shown = card.selection.refs.slice(0, CHOSEN_SHOWN);
    const more = card.selection.refs.length - shown.length;
    blocks.push(escapeMarkdownLabel(`${words.chosen}${colon}${shown.join(', ')}${more > 0 ? ` ${andMore(language, more)}` : ''}`));
  }
  const value = card.value === null ? BULK_EDIT_EMPTIED[language] : card.value;
  blocks.push(escapeMarkdownLabel(`${card.field} → ${value}`));
  if (card.done) return blocks.join('\n\n');
  const counts = [{
    en: `${words.rows(card.changes)} to change`,
    fr: `${words.rows(card.changes)} à modifier`,
    de: `${words.rows(card.changes)} zu ändern`,
    es: `${words.rows(card.changes)} por modificar`,
  }[language]];
  if ((card.excluded ?? 0) > 0) {
    const n = card.excluded!;
    counts.push({
      en: `${n} left out`,
      fr: `${n} écartée${n === 1 ? '' : 's'}`,
      de: `${n} ausgeschlossen`,
      es: `${n} excluida${n === 1 ? '' : 's'}`,
    }[language]);
  }
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
  const examples = card.listed ? [] : card.examples.slice(0, 5);
  if (examples.length > 0) {
    const more = card.changes - examples.length;
    blocks.push([
      ...examples.map((row) => `- ${escapeMarkdownLabel(`${row.ref} ${row.title}`.trim())}`),
      ...(more > 0 ? [`- ${andMore(language, more)}`] : []),
    ].join('\n'));
  }
  return blocks.join('\n\n');
}

/**
 * What the model is told of a card that counts its rows without listing them (more than
 * `AI_BULK_EDIT_LIST_MAX`): the person cannot leave rows out one by one, so Kad offers to narrow.
 */
export function bulkEditTooLongNote(family: BulkEditFamily, rows: number, max: number): string {
  const what = family === 'applications' ? 'applications' : 'budget lines';
  return `This card changes ${rows} ${what}: more than ${max}, so it counts them without listing them, and the person cannot leave ${what} out one by one. `
    + `Tell the person, and offer to narrow the selection (a more precise filter, or fewer references) so that the card lists each one.`;
}

/**
 * What the model is told of an approved card whose records the person left out (lot K2e of
 * 26.12.1, the maintainer's test of 24/11): reading the request (five applications) and one change,
 * Kad prepared a new card for the four unticked ones. A record left out is the person's choice; one
 * already at the value or refused by the server is not in the card's list and is not named here.
 */
export function bulkEditLeftOutNote(family: BulkEditFamily, refs: readonly string[]): string {
  const one = refs.length === 1;
  const what = family === 'applications' ? (one ? 'application' : 'applications') : (one ? 'budget line' : 'budget lines');
  return `Before approving, the person left out ${refs.length} ${what} of this card: ${refs.join(', ')}. `
    + `That is their choice, not a remaining change: ${one ? 'it stayed as it was' : 'they stayed as they were'}. `
    + `Prepare no card for ${one ? 'it' : 'them'} unless the person asks for it; the answer may say so in half a sentence.`;
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
