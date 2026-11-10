import type { CsvLanguage } from '../../common/csv-sheet';
import { AGENT_NAME } from '../../config/product';
import { writeXlsx, XlsxCell } from '../../common/xlsx/write';
import type { AiImportFileCell, AiImportFileContent } from './ai-import-mapping';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL = /^-?\d+(\.\d+)?$/;

/**
 * The name of the file the import reads, as the import's own reports and logs name an upload. Only
 * written: nothing reads it back, so it follows the agent's name.
 */
export const AI_IMPORT_FILE_NAME = `${AGENT_NAME.toLowerCase()}-import.xlsx`;

/**
 * A cell as the template holds it: a day as a date cell and a number as a number cell, so that no
 * import has to guess a date order or a decimal mark; any other value, and the person's own text the
 * mapping could not read, as text.
 */
function xlsxCell(kind: string, cell: AiImportFileCell): XlsxCell {
  if (typeof cell !== 'string') return cell.unread;
  if (cell === '') return null;
  if (kind === 'date' && ISO_DAY.test(cell)) return { kind: 'date', iso: cell };
  if (kind === 'number' && DECIMAL.test(cell)) return { kind: 'amount', value: cell };
  return cell;
}

/**
 * The file the import reads, in the template's format: one sheet, the template's columns under their
 * technical names (`go_live_date`), which every import reads in any language, then one row per data
 * row of the person's file, in its order. All imports read a workbook (#1037, #1038).
 */
export function buildImportFile(content: AiImportFileContent, language: CsvLanguage): Buffer {
  return writeXlsx({
    language,
    sheets: [{
      name: 'Import',
      headers: content.columns.map((column) => column.column),
      rows: content.rows.map((row) => row.map((cell, index) => xlsxCell(content.columns[index].kind, cell))),
      header: 'plain',
    }],
  });
}
