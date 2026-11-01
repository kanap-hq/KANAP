import * as assert from 'node:assert/strict';
import { assertLocaleLabels } from '../../common/report-export/__tests__/locale-labels';
import { BUDGET_COLUMN_LABEL_KEYS, BUDGET_COLUMN_LABELS, localizedBudgetColumnName, localizedBudgetColumnsAiContext } from '../budget-column-labels';
import { DEFAULT_BUDGET_COLUMNS } from '../budget-columns.util';

/** The translated default names of the budget columns equal the screens' (`ops.json`); a tenant's own name wins. */

assertLocaleLabels('ops', BUDGET_COLUMN_LABEL_KEYS, BUDGET_COLUMN_LABELS);

const renamed = { ...DEFAULT_BUDGET_COLUMNS, labels: { ...DEFAULT_BUDGET_COLUMNS.labels, actual: 'Réel 2026' } };
assert.equal(localizedBudgetColumnName(renamed, 'follow_up', 'de'), 'Réel 2026', 'the tenant name, whatever the language');
assert.equal(localizedBudgetColumnName(renamed, 'landing', 'fr'), 'Atterrissage prévu', 'no tenant name: the translated product name');
assert.equal(localizedBudgetColumnName(DEFAULT_BUDGET_COLUMNS, 'budget', 'es'), 'Presupuesto');

const french = localizedBudgetColumnsAiContext(DEFAULT_BUDGET_COLUMNS, 'fr');
assert.equal(french[3].name, 'Réalisé');
assert.equal(french[4].name, 'Atterrissage prévu');
assert.doesNotMatch(JSON.stringify(french), /Actuals|Expected landing/);
assert.equal(localizedBudgetColumnsAiContext(renamed, 'de')[3].name, 'Réel 2026', 'the workspace name wins over the language');
const open = localizedBudgetColumnsAiContext(DEFAULT_BUDGET_COLUMNS, null);
assert.equal(open[3].name, undefined);
assert.deepEqual(open[3].names, { en: 'Actuals', fr: 'Réalisé', de: 'Ist-Werte', es: 'Realizado' });
assert.deepEqual(open[4].names, { en: 'Expected landing', fr: 'Atterrissage prévu', de: 'Erwarteter Endwert', es: 'Aterrizaje previsto' });
assert.equal(localizedBudgetColumnsAiContext(renamed, null)[3].name, 'Réel 2026');
assert.equal(localizedBudgetColumnsAiContext(renamed, null)[3].names, undefined);
console.log('budget-column-labels.spec: OK');
