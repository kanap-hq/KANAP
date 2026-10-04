import { Decimal } from '../decimal';
import { CsvLanguage } from './types';
import { csvProfile } from './language';

export type ParsedAmount =
  | { kind: 'blank' }
  | { kind: 'clear' }
  | { kind: 'value'; decimal: Decimal }
  | { kind: 'invalid' };

/** Which mark separates the fractional part. The other mark, if present, groups thousands. */
export type DecimalMark = ',' | '.';

export interface AmountConventionDecision {
  decimal: DecimalMark | null;
  settledByFile: boolean;
  source: 'file' | 'switch' | 'export' | 'language' | null;
  notice: string | null;
  error: string | null;
  /** At least one cell is a single mark followed by exactly three digits. */
  ambiguous: boolean;
}

const CANONICAL_AMOUNT = /^-?\d+(\.\d+)?$/;

/**
 * An amount cell.
 *
 * When both `.` and `,` appear, the last one is the decimal mark and the other
 * must group by three. A mark followed by one, two, or more than three digits
 * is the decimal mark. A single mark followed by exactly three digits
 * (`12,280`, `12.280`) is ambiguous: the file settles it from another cell,
 * otherwise the caller's `convention` does. Spaces and non-breaking spaces
 * are thousands separators and must group by three. `-` alone clears.
 * There is no currency symbol and no exponent.
 *
 * Pass `convention` for the ambiguous form. Without it, that form is invalid,
 * so a caller cannot keep the old silent reading.
 */
export function parseCsvAmount(raw: string, convention?: DecimalMark): ParsedAmount {
  const prepared = prepare(raw);
  if (prepared.kind !== 'body') return prepared;
  const shape = classify(prepared.body);
  if (shape.kind === 'invalid') return { kind: 'invalid' };
  if (shape.kind === 'ambiguous') {
    if (!convention) return { kind: 'invalid' };
    if (shape.mark === convention) return parseNatural(prepared.body, prepared.negative);
    return parseThousands(prepared.body, shape.mark, prepared.negative);
  }
  return parseNatural(prepared.body, prepared.negative);
}

/**
 * Settle the decimal mark the way a date order is settled. A cell with one
 * mark and one, two, or more than three digits after it, or a cell with both
 * marks, shows the convention. A single mark and exactly three digits does
 * not. Two shown conventions are a file error. When nothing is shown, the
 * export's language hint decides, then the screen language. The preflight
 * says so in one line.
 */
export function resolveAmountConvention(texts: readonly string[], language: CsvLanguage, hint?: CsvLanguage): AmountConventionDecision {
  let comma: string | null = null;
  let dot: string | null = null;
  let ambiguous = false;
  for (const raw of texts) {
    const prepared = prepare(raw);
    if (prepared.kind !== 'body') continue;
    const shape = classify(prepared.body);
    if (shape.kind === 'ambiguous') {
      ambiguous = true;
      continue;
    }
    if (shape.kind !== 'evidence') continue;
    const shown = prepared.text;
    if (shape.mark === ',' && comma === null) comma = shown;
    if (shape.mark === '.' && dot === null) dot = shown;
  }
  if (comma && dot) {
    return {
      decimal: null,
      settledByFile: false,
      source: null,
      notice: null,
      error: `This file uses both amount conventions (${comma} and ${dot}).`,
      ambiguous,
    };
  }
  const shown = comma ? ',' : dot ? '.' : null;
  if (shown) return { decimal: shown, settledByFile: true, source: 'file', notice: null, error: null, ambiguous };
  if (!ambiguous) return { decimal: null, settledByFile: false, source: null, notice: null, error: null, ambiguous: false };
  const decimal = csvProfile(hint ?? language).decimal;
  const source = hint ? 'export' : 'language';
  return { decimal, settledByFile: false, source, notice: amountConventionNotice(decimal), error: null, ambiguous: true };
}

export function amountConventionNotice(decimal: DecimalMark): string {
  if (decimal === ',') return 'Amounts read with a decimal comma: 12.280 is twelve thousand two hundred eighty.';
  return 'Amounts read with a decimal dot: 12,280 is twelve thousand two hundred eighty.';
}

/**
 * Write an amount with the language's decimal mark and no thousands separator.
 * A string must already be a dot-decimal (`12280.50`); its trailing zeros are kept.
 * A `Decimal` is written without trailing zeros.
 */
export function formatCsvAmount(value: Decimal | string, language: CsvLanguage): string {
  const text = value instanceof Decimal ? value.toString() : value.trim();
  if (!CANONICAL_AMOUNT.test(text)) throw new Error(`Invalid amount '${typeof value === 'string' ? value : text}'.`);
  return csvProfile(language).decimal === ',' ? text.replace('.', ',') : text;
}

type Prepared =
  | { kind: 'blank' }
  | { kind: 'clear' }
  | { kind: 'invalid' }
  | { kind: 'body'; body: string; negative: boolean; text: string };

type Shape =
  | { kind: 'ambiguous'; mark: DecimalMark }
  | { kind: 'evidence'; mark: DecimalMark }
  | { kind: 'plain' }
  | { kind: 'invalid' };

function prepare(raw: string): Prepared {
  const text = raw.trim().replace(/\u00a0/g, ' ').replace(/\u202f/g, ' ');
  if (text === '') return { kind: 'blank' };
  if (text === '-') return { kind: 'clear' };
  let body = text;
  let negative = false;
  if (body.startsWith('+')) body = body.slice(1).trim();
  else if (body.startsWith('-')) {
    negative = true;
    body = body.slice(1).trim();
  }
  if (body === '' || !/^[\d .,]+$/.test(body)) return { kind: 'invalid' };
  return { kind: 'body', body, negative, text };
}

function classify(body: string): Shape {
  let commas = 0;
  let dots = 0;
  let lastComma = -1;
  let lastDot = -1;
  for (let i = 0; i < body.length; i += 1) {
    if (body[i] === ',') {
      commas += 1;
      lastComma = i;
    } else if (body[i] === '.') {
      dots += 1;
      lastDot = i;
    }
  }
  if (commas > 0 && dots > 0) {
    const mark: DecimalMark = lastComma > lastDot ? ',' : '.';
    return parseNatural(body, false).kind === 'value' ? { kind: 'evidence', mark } : { kind: 'invalid' };
  }
  if (commas + dots > 1) return { kind: 'invalid' };
  if (commas + dots === 0) return { kind: 'plain' };
  const mark: DecimalMark = commas === 1 ? ',' : '.';
  const at = commas === 1 ? lastComma : lastDot;
  const frac = body.slice(at + 1);
  if (/^\d{3}$/.test(frac)) return { kind: 'ambiguous', mark };
  if (/^\d{1,2}$/.test(frac) || /^\d{4,}$/.test(frac)) {
    return parseNatural(body, false).kind === 'value' ? { kind: 'evidence', mark } : { kind: 'invalid' };
  }
  if (frac === '') return { kind: 'plain' };
  return { kind: 'invalid' };
}

/** The mark on its own is the decimal mark. Both marks: the last one is. */
function parseNatural(body: string, negative: boolean): ParsedAmount {
  const lastComma = body.lastIndexOf(',');
  const lastDot = body.lastIndexOf('.');
  let decimalSep: DecimalMark | null = null;
  let groupSep: DecimalMark | null = null;
  if (lastComma >= 0 && lastDot >= 0) {
    if (lastComma > lastDot) {
      decimalSep = ',';
      groupSep = '.';
    } else {
      decimalSep = '.';
      groupSep = ',';
    }
  } else if (lastComma >= 0) decimalSep = ',';
  else if (lastDot >= 0) decimalSep = '.';

  let intPart = body;
  let fracPart = '';
  if (decimalSep) {
    const at = body.lastIndexOf(decimalSep);
    intPart = body.slice(0, at);
    fracPart = body.slice(at + 1);
    if (fracPart.includes(decimalSep) || fracPart.includes(' ') || (groupSep !== null && fracPart.includes(groupSep))) {
      return { kind: 'invalid' };
    }
  }
  if (!/^\d*$/.test(fracPart)) return { kind: 'invalid' };
  const digits = integerDigits(intPart, groupSep);
  if (digits == null) return { kind: 'invalid' };
  return finish(negative, digits, fracPart);
}

/** The single mark groups thousands. There is no fractional part. */
function parseThousands(body: string, mark: DecimalMark, negative: boolean): ParsedAmount {
  const digits = integerDigits(body, mark);
  if (digits == null) return { kind: 'invalid' };
  return finish(negative, digits, '');
}

function finish(negative: boolean, intDigits: string, fracDigits: string): ParsedAmount {
  if (intDigits === '' && fracDigits === '') return { kind: 'invalid' };
  if (intDigits.length > 20 || fracDigits.length > 20) return { kind: 'invalid' };
  const literal = `${negative ? '-' : ''}${intDigits === '' ? '0' : intDigits}${fracDigits ? `.${fracDigits}` : ''}`;
  try {
    return { kind: 'value', decimal: Decimal.from(literal) };
  } catch {
    return { kind: 'invalid' };
  }
}

/** Digits of the integer part, or null when a group is not three digits. */
function integerDigits(intPart: string, groupSep: DecimalMark | null): string | null {
  // A run of spaces is one thousands separator, as a spreadsheet writes it.
  const trimmed = intPart.trim().replace(/ +/g, ' ');
  if (trimmed === '') return '';
  const pieces: string[] = [];
  let current = '';
  for (const ch of trimmed) {
    if (ch === ' ') {
      // A space after a comma or a dot is still one thousands separator.
      if (current === '' && pieces.length > 0) continue;
      pieces.push(current);
      current = '';
      continue;
    }
    if (groupSep !== null && ch === groupSep) {
      if (current === '') return null;
      pieces.push(current);
      current = '';
      continue;
    }
    if (ch < '0' || ch > '9') return null;
    current += ch;
  }
  pieces.push(current);
  if (pieces.length === 1) return /^\d+$/.test(pieces[0]) ? pieces[0] : null;
  if (pieces.some((piece) => !/^\d{1,3}$/.test(piece))) return null;
  if (pieces[0].length < 1 || pieces[0].length > 3) return null;
  for (let i = 1; i < pieces.length; i += 1) {
    if (pieces[i].length !== 3) return null;
  }
  return pieces.join('');
}
