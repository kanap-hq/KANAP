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

/** The message in the interface language when it has a code. */
export function csvMessageText(item: CsvReportMessage, t: TFunction): string {
  return item.code ? t(`errors:${item.code}`, { ...item.params, defaultValue: item.message }) : item.message;
}

/**
 * The column to name after the message (`(name)` after « Une valeur est obligatoire. »), the
 * only way to find the cell when the sentence does not say it; none when the sentence already
 * names the column (« … dans la colonne detected_at … »).
 */
export function csvMessageColumn(item: CsvReportMessage, text: string): string | null {
  if (!item.column) return null;
  const column = item.column.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\W)${column}(\\W|$)`).test(text) ? null : item.column;
}
