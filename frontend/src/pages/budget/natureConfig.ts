import { OPEX_FINANCE_CONFIG, CAPEX_FINANCE_CONFIG } from '../../components/finance/config';
import type { LineType } from '../../constants/lineTypeUsage';

/** Child resources keep the API of their nature; the line itself uses the native budget API. */
export const BUDGET_NATURE_CONFIG = {
  opex: {
    finance: OPEX_FINANCE_CONFIG,
    itemsApi: OPEX_FINANCE_CONFIG.itemsApi,
    versionsApi: OPEX_FINANCE_CONFIG.versionsApi,
    freezeScope: OPEX_FINANCE_CONFIG.freezeScope,
    reservedFields: ['contract_id'],
    taskType: 'spend_item',
    relationsKind: 'opex',
    titleRequired: 'opex.editor.productNameRequired',
    createFailed: 'opex.editor.failedToCreate',
    newTitle: 'opex.workspace.newSpendItem',
    typeLabel: 'budget.typeOpex',
    otherNature: 'capex',
    legacyPrefix: 'OPX',
    legacyListKey: 'spend-items',
    legacyTitleAlias: false,
    navEndpoint: '/spend-items/summary/neighbors',
    navQueryKey: 'spend-items-summary-neighbors',
  },
  capex: {
    finance: CAPEX_FINANCE_CONFIG,
    itemsApi: CAPEX_FINANCE_CONFIG.itemsApi,
    versionsApi: CAPEX_FINANCE_CONFIG.versionsApi,
    freezeScope: CAPEX_FINANCE_CONFIG.freezeScope,
    reservedFields: [],
    taskType: 'capex_item',
    relationsKind: 'capex',
    titleRequired: 'capex.editor.descriptionRequired',
    createFailed: 'capex.editor.failedToCreate',
    newTitle: 'capex.workspace.newCapexItem',
    typeLabel: 'budget.typeCapex',
    otherNature: 'opex',
    legacyPrefix: 'CPX',
    legacyListKey: 'capex-items',
    legacyTitleAlias: true,
    navEndpoint: '/capex-items/summary/neighbors',
    navQueryKey: 'capex-items-summary-neighbors',
  },
} as const;

export type BudgetNatureConfig = (typeof BUDGET_NATURE_CONFIG)[LineType];
