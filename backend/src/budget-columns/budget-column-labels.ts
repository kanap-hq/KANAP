import type { CsvLanguage } from '../common/csv-sheet/types';
import { BUDGET_COLUMN_MEASURE, type AmountMeasure, type BudgetColumn } from '../spend/amounts-write.util';
import { budgetColumnsAiContext, type BudgetColumnsSettings } from './budget-columns.util';

/**
 * The name of a budget column in a file the API writes in the user's language: the name the tenant gave
 * it, else the product name translated as the screens show it (`useBudgetColumns`,
 * `ops:operations.budgetColumns.*` in `frontend/src/locales/<lang>/ops.json`, checked by a spec).
 */

/** Where each default name comes from in `frontend/src/locales/<lang>/ops.json`. */
export const BUDGET_COLUMN_LABEL_KEYS: Record<BudgetColumn, string> = {
  budget: 'operations.budgetColumns.budget',
  revision: 'operations.budgetColumns.revision',
  forecast: 'operations.budgetColumns.forecast',
  follow_up: 'operations.budgetColumns.followUp',
  landing: 'operations.budgetColumns.landing',
};

export const BUDGET_COLUMN_LABELS: Record<CsvLanguage, Record<BudgetColumn, string>> = {
  en: { budget: 'Budget', revision: 'Revision', forecast: 'Forecast', follow_up: 'Actuals', landing: 'Expected landing' },
  fr: { budget: 'Budget', revision: 'Révision', forecast: 'Prévision', follow_up: 'Réalisé', landing: 'Atterrissage prévu' },
  de: { budget: 'Budget', revision: 'Revision', forecast: 'Prognose', follow_up: 'Ist-Werte', landing: 'Erwarteter Endwert' },
  es: { budget: 'Presupuesto', revision: 'Revisión', forecast: 'Previsión', follow_up: 'Realizado', landing: 'Aterrizaje previsto' },
};

/** The tenant's name for the column, else its translated product name. */
export function localizedBudgetColumnName(settings: BudgetColumnsSettings, column: BudgetColumn, language: CsvLanguage): string {
  const custom = settings.labels[BUDGET_COLUMN_MEASURE[column]]?.trim();
  return custom || BUDGET_COLUMN_LABELS[language][column];
}

const COLUMN_OF_MEASURE = Object.fromEntries(
  (Object.entries(BUDGET_COLUMN_MEASURE) as Array<[BudgetColumn, AmountMeasure]>).map(([column, measure]) => [measure, column]),
) as Record<AmountMeasure, BudgetColumn>;

type BudgetColumnAiEntry = ReturnType<typeof budgetColumnsAiContext>[number];

/** One column as the assistant sees it: `name` to use, or `names` when the profile sets no language. */
export type LocalizedBudgetColumnAiContext = Omit<BudgetColumnAiEntry, 'name'> & {
  name?: string;
  names?: Record<CsvLanguage, string>;
};

/**
 * The budget columns for the assistant prompt and for `describe_entity_filters`.
 * A workspace name wins in every language. Otherwise `name` is the product name
 * in `language`. When the profile sets none (`language` null), `names` lists the
 * four product names and the answer uses the language of the conversation.
 */
export function localizedBudgetColumnsAiContext(
  settings: BudgetColumnsSettings,
  language: CsvLanguage | null | undefined,
): LocalizedBudgetColumnAiContext[] {
  return budgetColumnsAiContext(settings).map((entry) => {
    const base = {
      column: entry.column,
      ai_field_suffix: entry.ai_field_suffix,
      measure: entry.measure,
      shown: entry.shown,
      default: entry.default,
    };
    const custom = settings.labels[entry.measure]?.trim();
    if (custom) return { ...base, name: custom };
    const column = COLUMN_OF_MEASURE[entry.measure];
    if (language) return { ...base, name: BUDGET_COLUMN_LABELS[language][column] };
    return {
      ...base,
      names: {
        en: BUDGET_COLUMN_LABELS.en[column],
        fr: BUDGET_COLUMN_LABELS.fr[column],
        de: BUDGET_COLUMN_LABELS.de[column],
        es: BUDGET_COLUMN_LABELS.es[column],
      },
    };
  });
}
