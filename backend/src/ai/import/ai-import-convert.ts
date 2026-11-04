import { CsvDateOrder, CsvLanguage, DecimalMark, parseCsvAmount, parseCsvBoolean, parseCsvDateCell, resolveAmountConvention, resolveDateOrder } from '../../common/csv-sheet';
import { sheetCellText, SheetCell } from '../../common/csv-sheet/read';
import { findCatalogOption, type CatalogOptionLike } from '../../it-ops-settings/catalog-resolve';
import { isBlank } from '../attachments/table-attachment';

/**
 * How one column of an import reads a cell. The mapping converts a cell of the person's file to the
 * value the import's template expects: a day as `YYYY-MM-DD`, a number with a decimal point, yes or no
 * as `true` or `false`, a code of a fixed list, the code of a workspace catalog entry. The other kinds
 * are copied as they are: the import's own validation checks them (a supplier named, an e-mail known).
 */
export type AiImportColumnKind = 'text' | 'date' | 'number' | 'boolean' | 'codes' | 'catalog' | 'reference' | 'email';

export interface AiImportColumnRule {
  kind: AiImportColumnKind;
  /** The codes a `codes` column takes. */
  codes?: readonly string[];
  /** The names of each code in every language, read as the code (`Production` for `prod`). */
  codeLabels?: Readonly<Record<string, readonly string[]>>;
  /** The entries of a `catalog` column: the workspace's catalog, with the labels shipped in every language. */
  options?: readonly CatalogOptionLike[];
  /** Several values in one cell, separated by commas or semicolons. */
  multi?: boolean;
}

/** What the mapping says of a column, beyond its source. */
export interface AiImportColumnHints {
  /** Day or month first, for the dates written `03/04/2026`. Read from the column when not given. */
  dateOrder?: CsvDateOrder;
  /** The decimal mark of the numbers written as text. Read from the column when not given. */
  decimalMark?: DecimalMark;
  /** A value of the file and the code or catalog name it stands for, for the values the names do not settle. */
  values?: Record<string, string>;
}

export type AiImportCellResult =
  | { status: 'blank' }
  | { status: 'converted'; value: string }
  | { status: 'unread'; raw: string };

/** Why a whole column reads no cell: its dates use both orders, or its numbers both decimal marks. */
export type AiImportColumnReadError = 'mixed-date-orders' | 'mixed-decimal-marks';

/** How a column's cells convert, settled once on the whole column (the date order, the decimal mark). */
export interface AiImportColumnReader {
  read(cell: SheetCell | undefined): AiImportCellResult;
  /** The date order or decimal mark the column was read with, when it settled one. */
  settled: { dateOrder?: CsvDateOrder; decimalMark?: DecimalMark };
  /** Why the column reads no cell, when it cannot be read at all. */
  error: AiImportColumnReadError | null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LIST_SEPARATOR = /\s*[,;]\s*/;

function cellText(cell: SheetCell | undefined): string {
  return cell ? sheetCellText(cell).trim() : '';
}

function valueKey(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase();
}

/** The model's value map, its keys compared without case or outer spaces. */
function valueMap(values: Record<string, string> | undefined): Map<string, string> {
  return new Map(Object.entries(values ?? {}).map(([from, to]) => [valueKey(from), String(to).trim()]));
}

/** A column reader: the conversion of every cell of one column of the file to its template value. */
export function columnReader(
  rule: AiImportColumnRule,
  cells: ReadonlyArray<SheetCell | undefined>,
  hints: AiImportColumnHints,
  language: CsvLanguage,
): AiImportColumnReader {
  const texts = cells.filter((cell) => cell?.kind === 'text').map((cell) => cellText(cell));
  switch (rule.kind) {
    case 'date': {
      // The order the file shows wins over the one the mapping supposed.
      let decision = resolveDateOrder(texts, language, hints.dateOrder);
      if (decision.error && hints.dateOrder) decision = resolveDateOrder(texts, language);
      if (decision.error) return unreadable('mixed-date-orders');
      const order = decision.order;
      return {
        settled: order ? { dateOrder: order } : {},
        error: null,
        read: (cell) => {
          if (isBlank(cell)) return { status: 'blank' };
          if (cell!.kind === 'date') return { status: 'converted', value: cell!.iso };
          const raw = cellText(cell);
          if (raw === '') return { status: 'blank' };
          const parsed = parseCsvDateCell(raw, order);
          if (parsed.ok && parsed.value.kind === 'date') return { status: 'converted', value: parsed.value.isoDate };
          if (parsed.ok && parsed.value.kind === 'instant') return { status: 'converted', value: parsed.value.iso.slice(0, 10) };
          return { status: 'unread', raw };
        },
      };
    }
    case 'number': {
      let decision = resolveAmountConvention(texts, language, hints.decimalMark);
      if (decision.error && hints.decimalMark) decision = resolveAmountConvention(texts, language);
      if (decision.error) return unreadable('mixed-decimal-marks');
      const mark = decision.decimal ?? undefined;
      return {
        settled: mark ? { decimalMark: mark } : {},
        error: null,
        read: (cell) => {
          if (isBlank(cell)) return { status: 'blank' };
          if (cell!.kind === 'number') return { status: 'converted', value: cell!.value };
          const raw = cellText(cell);
          if (raw === '') return { status: 'blank' };
          const parsed = parseCsvAmount(raw, mark);
          return parsed.kind === 'value' ? { status: 'converted', value: parsed.decimal.toString() } : { status: 'unread', raw };
        },
      };
    }
    case 'boolean':
      return readerOf((raw) => {
        const parsed = parseCsvBoolean(raw);
        return parsed === true ? 'true' : parsed === false ? 'false' : null;
      }, false);
    case 'codes': {
      const map = valueMap(hints.values);
      const codes = rule.codes ?? [];
      const byLabel = new Map<string, string>();
      for (const [code, labels] of Object.entries(rule.codeLabels ?? {})) {
        for (const label of labels) byLabel.set(valueKey(label), code);
      }
      return readerOf((raw) => {
        const named = map.get(valueKey(raw)) ?? raw;
        return codes.find((code) => valueKey(code) === valueKey(named)) ?? byLabel.get(valueKey(named)) ?? null;
      }, rule.multi === true);
    }
    case 'catalog': {
      const map = valueMap(hints.values);
      const options = [...(rule.options ?? [])];
      return readerOf((raw) => {
        const named = map.get(valueKey(raw)) ?? raw;
        try {
          return findCatalogOption(named, options)?.code ?? null;
        } catch {
          // A name that several entries carry is not a guess.
          return null;
        }
      }, rule.multi === true);
    }
    case 'email':
      return readerOf((raw) => (EMAIL.test(raw) ? raw : null), false);
    case 'text':
    case 'reference':
    default:
      return readerOf((raw) => raw, false);
  }
}

function unreadable(error: AiImportColumnReadError): AiImportColumnReader {
  return {
    settled: {},
    error,
    read: (cell) => (isBlank(cell) ? { status: 'blank' } : { status: 'unread', raw: cellText(cell) }),
  };
}

/** A reader converting each value of a cell (each item of a list cell) with `convert`, null when it cannot. */
function readerOf(convert: (raw: string) => string | null, multi: boolean): AiImportColumnReader {
  return {
    settled: {},
    error: null,
    read: (cell) => {
      if (isBlank(cell)) return { status: 'blank' };
      const raw = cellText(cell);
      if (raw === '') return { status: 'blank' };
      const items = multi ? raw.split(LIST_SEPARATOR).filter((item) => item !== '') : [raw];
      const converted: string[] = [];
      for (const item of items) {
        const value = convert(item);
        if (value === null) return { status: 'unread', raw };
        if (!converted.includes(value)) converted.push(value);
      }
      return { status: 'converted', value: converted.join(', ') };
    },
  };
}
