import i18next, { type TFunction } from 'i18next';
import { refusalUsages, usageTotal } from '../../utils/deleteRefusal';

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
  /** What still uses the record, counted per kind (`{{usages}}` in the sentence of `code`). */
  usages?: Array<{ type: string; total: number }>;
};

/** The columns a message names by their keys (`CSV_DUPLICATE_KEY`: `company_name, name`), none when it names none. */
function namedColumns(item: CsvReportMessage): string[] {
  const columns = item.params?.columns;
  return typeof columns === 'string' ? columns.split(',').map((column) => column.trim()).filter(Boolean) : [];
}

/** The message with the missing columns of a header (`missing`) named as the view names its columns. */
function withMissingNamed(item: CsvReportMessage, columnName?: (column: string) => string): CsvReportMessage {
  const missing = item.params?.missing;
  const columns = typeof missing === 'string' ? missing.split(',').map((column) => column.trim()).filter(Boolean) : [];
  if (!columnName || columns.length === 0) return item;
  return { ...item, params: { ...item.params, missing: columns.map(columnName).join(', ') } };
}

/**
 * The message in the interface language when it has a code. `columnName` names the columns the
 * sentence lists (`CSV_DUPLICATE_KEY`, the missing columns of a header) as the view names its
 * columns; absent, by their keys. A column the file's language already titles stays as it is.
 */
export function csvMessageText(item: CsvReportMessage, t: TFunction, columnName?: (column: string) => string): string {
  if (!item.code) return item.message;
  item = withMissingNamed(item, columnName);
  const columns = namedColumns(item);
  const params = columnName && columns.length > 0 ? { ...item.params, columns: columns.map(columnName).join(', ') } : item.params;
  // The counts as a refused delete words them ("2 users and 1 OPEX line"), in the language of `t`.
  const language = (t as { lng?: string }).lng || i18next.resolvedLanguage || i18next.language || 'en';
  const usages = Array.isArray(item.usages) && item.usages.length > 0
    ? { ...usageTotal(item.usages), usages: refusalUsages(item.usages, undefined, t, language) }
    : {};
  return t(`errors:${item.code}`, { ...params, ...usages, defaultValue: item.message });
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
