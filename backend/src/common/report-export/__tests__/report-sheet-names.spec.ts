import * as assert from 'node:assert/strict';
import type { CsvLanguage } from '../../csv-sheet/types';
import { CAPACITY_HEATMAP_EXPORT_LABELS } from '../../../portfolio/services/portfolio-capacity-heatmap-export';
import { TIME_LOGGED_EXPORT_LABELS } from '../../../portfolio/services/portfolio-time-logged-export';
import { CHARGEBACK_EXPORT_LABELS, CHARGEBACK_EXPORT_SHEETS } from '../../../spend/chargeback-report.export';
import { BUDGET_REPORT_EXPORT_LABELS, BUDGET_REPORT_SHEETS } from '../../../spend/reports/budget-report-export.labels';
import { END_OF_SUPPORT_EXPORT_LABELS } from '../../../technologies/reports/end-of-support-export-labels';
import { BUDGET_OPERATIONS_EXPORT_LABELS } from '../../../spend/budget-operations-export/budget-operations-export.labels';
import { MASTER_DATA_COPY_EXPORT_LABELS } from '../../../master-data/master-data-copy-export';
import { REPORT_EXPORT_LABELS, REPORT_SHEET_NAME_MAX, writeReportExport } from '../index';

/**
 * Every sheet label of every report export, in every language, fits Excel's 31 characters, so no sheet
 * name is ever cut. A sheet label is a key named `sheet` or ending in `Sheet`, plus the Parameters sheet.
 */

const LANGUAGES: CsvLanguage[] = ['en', 'fr', 'de', 'es'];

const TABLES: Record<string, Record<CsvLanguage, Record<string, string>>> = {
  budget: BUDGET_REPORT_EXPORT_LABELS,
  chargeback: CHARGEBACK_EXPORT_LABELS,
  capacityHeatmap: CAPACITY_HEATMAP_EXPORT_LABELS,
  timeLogged: TIME_LOGGED_EXPORT_LABELS,
  endOfSupport: END_OF_SUPPORT_EXPORT_LABELS,
  budgetOperations: BUDGET_OPERATIONS_EXPORT_LABELS,
  masterDataCopy: MASTER_DATA_COPY_EXPORT_LABELS,
};

function run() {
  let checked = 0;
  for (const [report, table] of Object.entries(TABLES)) {
    for (const language of LANGUAGES) {
      const sheets = Object.entries(table[language]).filter(([key]) => key === 'sheet' || key.endsWith('Sheet'));
      assert.ok(sheets.length > 0, `${report} ${language}: has sheet labels`);
      for (const [key, value] of sheets) {
        assert.ok(value.trim().length > 0, `${report} ${language} ${key}: not empty`);
        assert.ok(value.length <= REPORT_SHEET_NAME_MAX, `${report} ${language} ${key}: "${value}" is ${value.length} characters`);
        checked += 1;
      }
    }
  }
  for (const language of LANGUAGES) {
    assert.ok(REPORT_EXPORT_LABELS[language].parameters.length <= REPORT_SHEET_NAME_MAX, `${language} Parameters sheet`);
  }
  // The sheet lists of the reports whose sheet labels are file words name every sheet label.
  for (const [table, list] of [[BUDGET_REPORT_EXPORT_LABELS, BUDGET_REPORT_SHEETS], [CHARGEBACK_EXPORT_LABELS, CHARGEBACK_EXPORT_SHEETS]] as const) {
    assert.deepEqual(Object.keys(table.en).filter((key) => key.endsWith('Sheet')).sort(), [...list].sort());
  }

  // A report with a longer sheet label fails instead of writing a cut name.
  const tooLong = 'x'.repeat(REPORT_SHEET_NAME_MAX + 1);
  assert.throws(
    () => writeReportExport(
      { fileBase: 'probe', limited: false, parameters: [], tables: [{ key: 'one', sheet: tooLong, columns: [{ header: 'A', kind: 'text' }], rows: [] }] },
      { format: 'xlsx', language: 'en', timeZone: 'UTC', generatedAt: new Date(), generatedBy: '' },
    ),
    /over 31 characters/,
  );
  console.log(`report-sheet-names.spec: ${checked} sheet labels, ok`);
}

run();
