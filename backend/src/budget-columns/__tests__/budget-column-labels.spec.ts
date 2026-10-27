import * as assert from 'node:assert/strict';
import { assertLocaleLabels } from '../../common/report-export/__tests__/locale-labels';
import { BUDGET_COLUMN_LABEL_KEYS, BUDGET_COLUMN_LABELS, localizedBudgetColumnName } from '../budget-column-labels';
import { DEFAULT_BUDGET_COLUMNS } from '../budget-columns.util';

/** The translated default names of the budget columns equal the screens' (`ops.json`); a tenant's own name wins. */

assertLocaleLabels('ops', BUDGET_COLUMN_LABEL_KEYS, BUDGET_COLUMN_LABELS);

const renamed = { ...DEFAULT_BUDGET_COLUMNS, labels: { ...DEFAULT_BUDGET_COLUMNS.labels, actual: 'Réel 2026' } };
assert.equal(localizedBudgetColumnName(renamed, 'follow_up', 'de'), 'Réel 2026', 'the tenant name, whatever the language');
assert.equal(localizedBudgetColumnName(renamed, 'landing', 'fr'), 'Atterrissage prévu', 'no tenant name: the translated product name');
assert.equal(localizedBudgetColumnName(DEFAULT_BUDGET_COLUMNS, 'budget', 'es'), 'Presupuesto');
console.log('budget-column-labels.spec: OK');
