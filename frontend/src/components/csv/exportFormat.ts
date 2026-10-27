/** The file format an export dialog offers: CSV, or an Excel workbook. */
export type ExportFormat = 'csv' | 'xlsx';

/** One choice for every export dialog of this browser. */
export const EXPORT_FORMAT_STORAGE_KEY = 'kanap.exportFormat';

/** The format last chosen in this browser; CSV when none was, or when the storage cannot be read. */
export function readExportFormat(): ExportFormat {
  try {
    return window.localStorage.getItem(EXPORT_FORMAT_STORAGE_KEY) === 'xlsx' ? 'xlsx' : 'csv';
  } catch {
    return 'csv';
  }
}

/** Remembers the chosen format. A storage that refuses the write is ignored. */
export function writeExportFormat(format: ExportFormat): void {
  try {
    window.localStorage.setItem(EXPORT_FORMAT_STORAGE_KEY, format);
  } catch {
    // The choice is only a convenience.
  }
}
