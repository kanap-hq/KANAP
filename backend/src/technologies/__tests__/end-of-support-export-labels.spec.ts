import { assertLocaleLabels } from '../../common/report-export/__tests__/locale-labels';
import { END_OF_SUPPORT_EXPORT_KEYS, END_OF_SUPPORT_EXPORT_LABELS } from '../reports/end-of-support-export-labels';

// The end of support export says what the screen says: its label table against `it.json` in the four languages.
assertLocaleLabels('it', END_OF_SUPPORT_EXPORT_KEYS, END_OF_SUPPORT_EXPORT_LABELS);
console.log('end-of-support-export-labels.spec: OK');
