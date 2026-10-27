import React from 'react';
import { useTranslation } from 'react-i18next';
import { useFeatures } from '../../config/FeaturesContext';

const CSV_ACCEPT = '.csv,text/csv';
const WORKBOOK_ACCEPT = '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * The files the data imports take: CSV, and an Excel workbook (.xlsx) while the server reads them
 * (`features.importXlsx`, the IMPORT_XLSX switch). `workbook` says whether both are taken.
 */
export function useImportFiles(): { accept: string; workbook: boolean } {
  const { config } = useFeatures();
  const workbook = config?.features?.importXlsx === true;
  return { accept: workbook ? WORKBOOK_ACCEPT : CSV_ACCEPT, workbook };
}

/** The label of an "Import CSV" button: "Import" while the import also takes an Excel workbook. */
export function ImportLabel({ csv }: { csv: string }) {
  const { t } = useTranslation('common');
  const { workbook } = useImportFiles();
  return <>{workbook ? t('common:buttons.import') : csv}</>;
}
