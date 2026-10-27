import type { CsvLanguage } from '../../common/csv-sheet/types';

/**
 * The words of the budget operations exports (`budget-operations-export.service.ts`): the headers and
 * the statuses the screens show, the Parameters sheet. The values are the screens'
 * (`frontend/src/locales/<lang>/ops.json`), checked by a spec in the four languages. A sheet is named
 * as the screen names its table (`resetSheet`, `copySheet`).
 */

/** Where each label comes from in `frontend/src/locales/<lang>/ops.json`. */
export const BUDGET_OPERATIONS_EXPORT_KEYS = {
  scope: 'operations.scope.label',
  scope_all: 'operations.scope.all',
  scope_opex: 'operations.scope.opex',
  scope_capex: 'operations.scope.capex',
  resetSheet: 'operations.columnReset.dataPreview',
  resetLine: 'operations.columnReset.product',
  resetCurrent: 'operations.columnReset.currentHeader',
  resetYear: 'operations.columnReset.year',
  resetColumn: 'operations.columnReset.budgetColumn',
} as const;

export type BudgetOperationsExportLabels = Record<keyof typeof BUDGET_OPERATIONS_EXPORT_KEYS, string>;

export const BUDGET_OPERATIONS_EXPORT_LABELS: Record<CsvLanguage, BudgetOperationsExportLabels> = {
  en: {
    scope: 'Line type',
    scope_all: 'All',
    scope_opex: 'OPEX',
    scope_capex: 'CAPEX',
    resetSheet: 'Data preview',
    resetLine: 'Line',
    resetCurrent: '{{column}} {{year}}, current',
    resetYear: 'Year',
    resetColumn: 'Budget column',
  },
  fr: {
    scope: 'Type de ligne',
    scope_all: 'Tout',
    scope_opex: 'OPEX',
    scope_capex: 'CAPEX',
    resetSheet: 'Aperçu des données',
    resetLine: 'Ligne',
    resetCurrent: '{{column}} {{year}}, actuel',
    resetYear: 'Année',
    resetColumn: 'Colonne budgétaire',
  },
  de: {
    scope: 'Zeilentyp',
    scope_all: 'Alle',
    scope_opex: 'OPEX',
    scope_capex: 'CAPEX',
    resetSheet: 'Datenvorschau',
    resetLine: 'Zeile',
    resetCurrent: '{{column}} {{year}}, aktuell',
    resetYear: 'Jahr',
    resetColumn: 'Budgetspalte',
  },
  es: {
    scope: 'Tipo de línea',
    scope_all: 'Todo',
    scope_opex: 'OPEX',
    scope_capex: 'CAPEX',
    resetSheet: 'Vista previa de datos',
    resetLine: 'Línea',
    resetCurrent: '{{column}} {{year}}, actual',
    resetYear: 'Año',
    resetColumn: 'Columna presupuestaria',
  },
};
