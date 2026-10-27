/**
 * "Copy yearly metrics": the rule of the words of a row (its name, its status), for the screen
 * (`MasterDataCopyPage.tsx`) and for the API's export of the preview (`GET /master-data-operations/copy/export`).
 * The backend cannot import the frontend tree: it holds a byte-identical copy in
 * `backend/src/master-data/shared/`, checked by `backend/src/spend/reports/__tests__/report-shared-copies.spec.ts`.
 *
 * Pure functions, without a single import. Each side words the result in its language.
 */

/** The key of a row's status: `admin.copy.status.<key>` in `master-data.json`. */
export type MasterDataCopyStatusKey = 'readyToCopy' | 'noDataForSourceYear' | 'failedToCopyMetrics' | 'skipped';

/** A row to copy is ready; a skipped one says why when the copy gave a known code, else "Skipped". */
export function masterDataCopyStatus(row: { skipped: boolean; reason?: string | null }): MasterDataCopyStatusKey {
  if (!row.skipped) return 'readyToCopy';
  if (row.reason === 'no_data_for_source_year') return 'noDataForSourceYear';
  if (row.reason === 'failed_to_copy_metrics') return 'failedToCopyMetrics';
  return 'skipped';
}

/** A row's name; a company or department without one gets the word for an unknown one. */
export function masterDataCopyName(
  row: { entityType?: string | null; entityName?: string | null } | null | undefined,
  words: { unknownCompany: string; unknownDepartment: string },
): string {
  const name = row?.entityName?.trim() ?? '';
  if (name) return name;
  if (row?.entityType === 'department') return words.unknownDepartment;
  if (row?.entityType === 'company') return words.unknownCompany;
  return '';
}
