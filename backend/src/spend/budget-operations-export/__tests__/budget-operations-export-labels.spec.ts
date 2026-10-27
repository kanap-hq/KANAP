import { assertLocaleLabels } from '../../../common/report-export/__tests__/locale-labels';
import { BUDGET_OPERATIONS_EXPORT_KEYS, BUDGET_OPERATIONS_EXPORT_LABELS } from '../budget-operations-export.labels';

/** The words of the budget operations exports equal the screens' (`ops.json`), in the four languages. */

assertLocaleLabels('ops', BUDGET_OPERATIONS_EXPORT_KEYS, BUDGET_OPERATIONS_EXPORT_LABELS);
console.log('budget-operations-export-labels.spec: OK');
