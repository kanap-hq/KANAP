import { normalizeMarkdownRichText } from '../markdown-worker';
import type { CsvImportContext } from './csv-field.types';

/**
 * `importTransformFn` of a rich-text column: the cell is checked as a write of the
 * field (size, accepted HTML tags, inline images) in the Markdown workers, within
 * the time budget of the file's rich-text cells. A cell that repeats the stored
 * text is kept by the import itself (`CsvImportService`, `keepStoredRichText`).
 */
export function richTextCell(fieldName: string) {
  return (value: string, _row: Record<string, string>, context: CsvImportContext): Promise<string | null> =>
    normalizeMarkdownRichText(value, { fieldName, budget: context.markdownBudget });
}
