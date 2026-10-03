import { Decimal } from '../decimal';
import { CsvLanguage } from './types';
import { csvProfile } from './language';

export type ParsedAmount =
  | { kind: 'blank' }
  | { kind: 'clear' }
  | { kind: 'value'; decimal: Decimal }
  | { kind: 'invalid' };

const CANONICAL_AMOUNT = /^-?\d+(\.\d+)?$/;

/**
 * An amount cell.
 *
 * A comma or a dot is the decimal mark. When both appear, the last one is the
 * decimal mark and the other must group by three. Spaces and non-breaking
 * spaces are thousands separators and must group by three as well. A mark
 * that appears alone is the decimal mark, so `12,280` is 12.280 and not
 * twelve thousand. `-` alone clears. There is no currency symbol and no
 * exponent.
 */
export function parseCsvAmount(raw: string): ParsedAmount {
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

  const lastComma = body.lastIndexOf(',');
  const lastDot = body.lastIndexOf('.');
  let decimalSep: ',' | '.' | null = null;
  let groupSep: ',' | '.' | null = null;
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
    if (fracPart.includes(decimalSep) || fracPart.includes(' ') || fracPart.includes(groupSep ?? '\u0000')) {
      return { kind: 'invalid' };
    }
  }
  if (!/^\d*$/.test(fracPart)) return { kind: 'invalid' };

  const digits = integerDigits(intPart, groupSep);
  if (digits == null) return { kind: 'invalid' };
  if (digits === '' && fracPart === '') return { kind: 'invalid' };
  if (digits.length > 20 || fracPart.length > 20) return { kind: 'invalid' };

  const literal = `${negative ? '-' : ''}${digits === '' ? '0' : digits}${fracPart ? `.${fracPart}` : ''}`;
  try {
    return { kind: 'value', decimal: Decimal.from(literal) };
  } catch {
    return { kind: 'invalid' };
  }
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

/** Digits of the integer part, or null when a group is not three digits. */
function integerDigits(intPart: string, groupSep: ',' | '.' | null): string | null {
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
