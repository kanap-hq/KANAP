import type { TFunction } from 'i18next';

/**
 * An error or warning of a CSV import report. `code` is the key the interface
 * translates (`errors:<code>`), with the values its sentence names (`params`);
 * `message` is the server's English text, shown when there is no code.
 * Row 0 is the header.
 */
export type CsvReportMessage = {
  row: number;
  column?: string;
  message: string;
  code?: string;
  params?: Record<string, string | number>;
};

/** The columns a message's `param` lists (`CSV_DUPLICATE_KEY`: `company_name, name`), none when it names none. */
function listedColumns(item: CsvReportMessage, param: 'columns' | 'missing'): string[] {
  const columns = item.params?.[param];
  return typeof columns === 'string' ? columns.split(',').map((column) => column.trim()).filter(Boolean) : [];
}

/** The columns a message names by their keys (`CSV_DUPLICATE_KEY`: `company_name, name`), none when it names none. */
function namedColumns(item: CsvReportMessage): string[] {
  return listedColumns(item, 'columns');
}

/**
 * The message in the interface language when it has a code. `columnName` names the columns the
 * sentence lists (`CSV_DUPLICATE_KEY`, the missing columns of a header) as the view names its
 * columns; absent, by their keys. A column the file's language already titles stays as it is.
 */
export function csvMessageText(item: CsvReportMessage, t: TFunction, columnName?: (column: string) => string): string {
  if (!item.code) return item.message;
  let params = item.params;
  if (columnName) {
    for (const param of ['columns', 'missing'] as const) {
      const columns = listedColumns(item, param);
      if (columns.length > 0) params = { ...params, [param]: columns.map(columnName).join(', ') };
    }
  }
  return t(`errors:${item.code}`, { ...params, defaultValue: item.message });
}

/**
 * The column to name after the message (`(name)` after « Une valeur est obligatoire. »), the
 * only way to find the cell when the sentence does not say it; none when the sentence already
 * names the column (« … dans la colonne detected_at … »).
 */
export function csvMessageColumn(item: CsvReportMessage, text: string): string | null {
  if (!item.column || namedColumns(item).includes(item.column)) return null;
  const column = item.column.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\W)${column}(\\W|$)`).test(text) ? null : item.column;
}
