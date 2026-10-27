import { assertLocaleLabels } from '../../common/report-export/__tests__/locale-labels';
import { MASTER_DATA_COPY_EXPORT_KEYS, MASTER_DATA_COPY_EXPORT_LABELS, MASTER_DATA_COPY_EXPORT_OPS_KEYS } from '../master-data-copy-export';

/** The words of the master data copy export equal the screen's (`master-data.json`, `ops.json`), in the four languages. */

assertLocaleLabels('master-data', MASTER_DATA_COPY_EXPORT_KEYS, MASTER_DATA_COPY_EXPORT_LABELS);
assertLocaleLabels('ops', MASTER_DATA_COPY_EXPORT_OPS_KEYS, MASTER_DATA_COPY_EXPORT_LABELS);
console.log('master-data-copy-export-labels.spec: OK');
