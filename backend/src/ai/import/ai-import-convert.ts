import { Decimal } from '../../common/decimal';
import { CsvDateOrder, CsvLanguage, DecimalMark, parseCsvAmount, parseCsvBoolean, parseCsvDateCell, resolveAmountConvention, resolveDateOrder } from '../../common/csv-sheet';
import { sheetCellText, SheetCell } from '../../common/csv-sheet/read';
import { catalogAliases } from '../../it-ops-settings/catalog-codes';
import { findCatalogOption, type CatalogOptionLike } from '../../it-ops-settings/catalog-resolve';
import { accentFreeKey, foldKey } from '../../common/name-matching';
import { parseReferenceNumber } from '../../common/parse-item-number';
import { isBlank } from '../attachments/table-attachment';
import { countryCode } from './ai-import-countries';
import { parseNamedMonthDate } from './ai-import-dates';

/**
 * How one column of an import reads a cell. The mapping converts a cell of the person's file to the
 * value the import's template expects: a day as `YYYY-MM-DD`, a day and time as `YYYY-MM-DD HH:MM`, a
 * number with a decimal point, yes or no as `true` or `false`, a code of a fixed list, the code of a
 * workspace catalog entry, a country's two-letter code. The other kinds are copied as they are: the
 * import's own validation checks them (a supplier named, an e-mail known).
 */
export type AiImportColumnKind =
  | 'text' | 'date' | 'datetime' | 'number' | 'boolean' | 'codes' | 'catalog' | 'country' | 'reference' | 'email';

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
  /** A number column that holds a percentage, 0 to 100: a cell shown as a percentage (0.45 as 45%) reads as 45. */
  percent?: boolean;
  /** A `reference` column of the family's own references (`COMP`): it reads only values written with this prefix. */
  prefix?: string;
}

/** What the mapping says of a column, beyond its source. */
export interface AiImportColumnHints {
  /** Day or month first, for the dates written `03/04/2026`. Read from the column when not given. */
  dateOrder?: CsvDateOrder;
  /** The decimal mark of the numbers written as text. Read from the column when not given. */
  decimalMark?: DecimalMark;
  /** A value of the file and the value it stands for (a code, a name, a number, an e-mail; blank for none). */
  values?: Record<string, string>;
}

export type AiImportCellResult =
  | { status: 'blank' }
  | { status: 'converted'; value: string }
  | { status: 'unread'; raw: string };

/**
 * Why a whole column reads no cell: its dates use both orders, its numbers both decimal marks, or a
 * column of references holds a value without the family's prefix.
 */
export type AiImportColumnReadError = 'mixed-date-orders' | 'mixed-decimal-marks' | 'reference-without-prefix';

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

/** The one code whose names match `named` once accents are set aside: null when none or several do. */
function accentFreeCode(named: string, names: ReadonlyArray<readonly [string, ReadonlyArray<string>]>): string | null {
  const key = accentFreeKey(named);
  const codes = new Set(names.filter(([, list]) => list.some((name) => accentFreeKey(name) === key)).map(([code]) => code));
  return codes.size === 1 ? [...codes][0] : null;
}

/** The model's value map, its keys compared without case or outer spaces. */
function valueMap(values: Record<string, string> | undefined): Map<string, string> {
  return new Map(Object.entries(values ?? {}).map(([from, to]) => [foldKey(from), String(to).trim()]));
}

/** The cell the model's value map puts in place of a cell: the value it stands for, a blank for ''. */
function mappedCell(cell: SheetCell | undefined, map: Map<string, string>): SheetCell | undefined {
  if (map.size === 0 || isBlank(cell)) return cell;
  const to = map.get(foldKey(cellText(cell)));
  if (to === undefined) return cell;
  return to === '' ? { kind: 'empty' } : { kind: 'text', value: to };
}

/**
 * A column reader: the conversion of every cell of one column of the file to its template value. The
 * model's value map applies first, to the whole cell, and to each item of a list cell.
 */
export function columnReader(
  rule: AiImportColumnRule,
  cells: ReadonlyArray<SheetCell | undefined>,
  hints: AiImportColumnHints,
  language: CsvLanguage,
): AiImportColumnReader {
  const map = valueMap(hints.values);
  const reader = cellReader(rule, cells.map((cell) => mappedCell(cell, map)), hints, language, map);
  if (map.size === 0) return reader;
  return {
    ...reader,
    read: (cell) => {
      const result = reader.read(mappedCell(cell, map));
      return result.status === 'unread' ? { status: 'unread', raw: cellText(cell) } : result;
    },
  };
}

/** A day and time as the imports read it: `YYYY-MM-DD HH:MM`, the seconds when there are some. */
function dayAndTime(isoDate: string, time: string | null | undefined): string {
  if (!time) return isoDate;
  return `${isoDate} ${time.endsWith(':00') ? time.slice(0, 5) : time}`;
}

/** A date column, or a date and time column (`withTime`): the date order is settled on the whole column. */
function dateReader(texts: string[], hints: AiImportColumnHints, language: CsvLanguage, withTime: boolean): AiImportColumnReader {
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
      if (cell!.kind === 'date') return { status: 'converted', value: withTime ? dayAndTime(cell!.iso, cell!.time) : cell!.iso };
      const raw = cellText(cell);
      if (raw === '') return { status: 'blank' };
      const parsed = parseCsvDateCell(raw, order);
      if (parsed.ok && parsed.value.kind === 'date') {
        return { status: 'converted', value: withTime ? dayAndTime(parsed.value.isoDate, parsed.value.time) : parsed.value.isoDate };
      }
      if (parsed.ok && parsed.value.kind === 'instant') {
        return { status: 'converted', value: withTime ? parsed.value.iso : parsed.value.iso.slice(0, 10) };
      }
      const named = parseNamedMonthDate(raw);
      if (named) return { status: 'converted', value: withTime ? dayAndTime(named.isoDate, named.time) : named.isoDate };
      return { status: 'unread', raw };
    },
  };
}

/** A percentage shown as such (0.45 in a cell formatted 45%), as the number from 0 to 100 the import takes. */
function hundredfold(value: string): string {
  return Decimal.from(value).mul(100).toString();
}

function cellReader(
  rule: AiImportColumnRule,
  cells: ReadonlyArray<SheetCell | undefined>,
  hints: AiImportColumnHints,
  language: CsvLanguage,
  map: Map<string, string>,
): AiImportColumnReader {
  const texts = cells.filter((cell) => cell?.kind === 'text').map((cell) => cellText(cell));
  switch (rule.kind) {
    case 'date':
      return dateReader(texts, hints, language, false);
    case 'datetime':
      return dateReader(texts, hints, language, true);
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
          if (cell!.kind === 'number') {
            return { status: 'converted', value: rule.percent && cell!.percent ? hundredfold(cell!.value) : cell!.value };
          }
          const raw = cellText(cell);
          if (raw === '') return { status: 'blank' };
          // A percentage written as text (`45 %`) is the number before its sign.
          const parsed = parseCsvAmount(rule.percent ? raw.replace(/\s*%$/, '') : raw, mark);
          return parsed.kind === 'value' ? { status: 'converted', value: parsed.decimal.toString() } : { status: 'unread', raw };
        },
      };
    }
    case 'boolean':
      return readerOf((raw) => {
        const parsed = parseCsvBoolean(raw);
        return parsed === true ? 'true' : parsed === false ? 'false' : null;
      }, false, map);
    case 'codes': {
      const codes = rule.codes ?? [];
      const byLabel = new Map<string, string>();
      for (const [code, labels] of Object.entries(rule.codeLabels ?? {})) {
        for (const label of labels) byLabel.set(foldKey(label), code);
      }
      return readerOf((named) => codes.find((code) => foldKey(code) === foldKey(named))
        ?? byLabel.get(foldKey(named))
        ?? accentFreeCode(named, codes.map((code) => [code, [code, ...(rule.codeLabels?.[code] ?? [])]])), rule.multi === true, map);
    }
    case 'catalog': {
      const options = [...(rule.options ?? [])];
      return readerOf((named) => {
        try {
          const option = findCatalogOption(named, options);
          if (option) return option.code;
        } catch {
          // A name that several entries carry is not a guess.
          return null;
        }
        return accentFreeCode(named, options.map((option) => [option.code, [...catalogAliases(option), ...(option.shippedLabels ?? [])]]));
      }, rule.multi === true, map);
    }
    case 'country':
      return readerOf(countryCode, rule.multi === true, map);
    case 'email':
      return readerOf((raw) => (EMAIL.test(raw) ? raw : null), false, map);
    case 'reference':
      if (rule.prefix) return prefixedReferenceReader(rule.prefix, cells);
      return readerOf((raw) => raw, false, map);
    case 'text':
    default:
      return readerOf((raw) => raw, false, map);
  }
}

/**
 * A column of the family's own references, which names the record a row updates (`COMP-4`, any case).
 * Kad reads a value as a reference only when it carries the family's prefix: a column of the person's
 * sheet numbering its rows 1 to N would otherwise rename records unrelated to them. One value without
 * the prefix and the column is no column of references: none of its cells is read, and every row
 * keeps the import's key by name.
 */
function prefixedReferenceReader(prefix: string, cells: ReadonlyArray<SheetCell | undefined>): AiImportColumnReader {
  const numberOf = (cell: SheetCell | undefined) => parseReferenceNumber(cellText(cell), prefix, { prefixRequired: true });
  if (cells.some((cell) => cellText(cell) !== '' && numberOf(cell) === null)) {
    return { settled: {}, error: 'reference-without-prefix', read: () => ({ status: 'blank' }) };
  }
  return {
    settled: {},
    error: null,
    read: (cell) => {
      if (cellText(cell) === '') return { status: 'blank' };
      const number = numberOf(cell);
      return number === null ? { status: 'unread', raw: cellText(cell) } : { status: 'converted', value: `${prefix}-${number}` };
    },
  };
}

function unreadable(error: AiImportColumnReadError): AiImportColumnReader {
  return {
    settled: {},
    error,
    read: (cell) => (isBlank(cell) ? { status: 'blank' } : { status: 'unread', raw: cellText(cell) }),
  };
}

/**
 * A reader converting each value of a cell (each item of a list cell, as the value map names it) with
 * `convert`, null when it cannot.
 */
function readerOf(convert: (raw: string) => string | null, multi: boolean, map: Map<string, string>): AiImportColumnReader {
  return {
    settled: {},
    error: null,
    read: (cell) => {
      if (isBlank(cell)) return { status: 'blank' };
      const raw = cellText(cell);
      if (raw === '') return { status: 'blank' };
      const items = multi
        ? raw.split(LIST_SEPARATOR).map((item) => map.get(foldKey(item)) ?? item).filter((item) => item !== '')
        : [raw];
      if (items.length === 0) return { status: 'blank' };
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
