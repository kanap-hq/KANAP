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
