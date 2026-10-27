import { assertLocaleLabels } from '../../../common/report-export/__tests__/locale-labels';
import { BUDGET_REPORT_EXPORT_KEYS, BUDGET_REPORT_EXPORT_LABELS } from '../budget-report-export.labels';

/** The words of the budget report exports equal the screens' (`ops.json`), in the four languages. */

assertLocaleLabels('ops', BUDGET_REPORT_EXPORT_KEYS, BUDGET_REPORT_EXPORT_LABELS);
console.log('budget-report-export-labels.spec: OK');
