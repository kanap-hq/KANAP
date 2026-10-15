import { ValidateBy, ValidationOptions } from 'class-validator';

/**
 * Account numbers (`accounts.account_number`, `accounts.consolidation_account_number`) are
 * positive whole numbers of at most 15 digits. The columns are `bigint`; 15 digits stay below
 * 2^53, so a number reads back exactly as a JavaScript number. Every writer checks this bound:
 * the API, the CSV import, the chart templates and the AI mutations.
 */
export const ACCOUNT_NUMBER_MAX_DIGITS = 15;
export const ACCOUNT_NUMBER_MAX = 10 ** ACCOUNT_NUMBER_MAX_DIGITS - 1;

/** The rule, in English, after the field name ("account_number must be ..."). */
export const ACCOUNT_NUMBER_RULE = `must be a whole number greater than zero, with at most ${ACCOUNT_NUMBER_MAX_DIGITS} digits`;

export type AccountNumberReading =
  | { value: number; leadingZeros: boolean }
  | { value: null; problem: 'invalid' | 'too_long' };

/**
 * A cell or a value read as an account number: a number, or text made of digits only.
 * `too_long`: more than 15 significant digits; `invalid`: anything else that is not a whole
 * number greater than zero. `leadingZeros`: the text started with zeros the stored number
 * drops (`06156` is stored as 6156).
 */
export function readAccountNumber(raw: unknown): AccountNumberReading {
  if (typeof raw === 'number') {
    if (!Number.isInteger(raw) || raw < 1) return { value: null, problem: 'invalid' };
    if (raw > ACCOUNT_NUMBER_MAX) return { value: null, problem: 'too_long' };
    return { value: raw, leadingZeros: false };
  }
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!/^\d+$/.test(text)) return { value: null, problem: 'invalid' };
  const significant = text.replace(/^0+/, '');
  if (significant === '') return { value: null, problem: 'invalid' };
  if (significant.length > ACCOUNT_NUMBER_MAX_DIGITS) return { value: null, problem: 'too_long' };
  return { value: Number(significant), leadingZeros: significant.length < text.length };
}

/** The account number `raw` holds, or null when it is not one (see `readAccountNumber`). */
export function parseAccountNumber(raw: unknown): number | null {
  return readAccountNumber(raw).value;
}

/** class-validator: a valid account number (a number or its text). */
export function IsAccountNumber(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isAccountNumber',
      validator: {
        validate: (value: unknown) => parseAccountNumber(value) != null,
        defaultMessage: (args) => `${args?.property ?? 'account number'} ${ACCOUNT_NUMBER_RULE}`,
      },
    },
    options,
  );
}
