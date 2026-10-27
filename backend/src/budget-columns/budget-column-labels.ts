import type { CsvLanguage } from '../common/csv-sheet/types';
import { BUDGET_COLUMN_MEASURE, type BudgetColumn } from '../spend/amounts-write.util';
import type { BudgetColumnsSettings } from './budget-columns.util';

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
