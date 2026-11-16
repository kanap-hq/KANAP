import { describe, expect, it } from 'vitest';
import { formatEuPartialAt, type DateInputSeparator } from './date-eu';

/**
 * Types digits one by one, the way the date field does: each digit is inserted at the caret the
 * previous format returned, then the field shows the formatted text.
 */
function typeDigits(digits: string, sep: DateInputSeparator = '/'): string[] {
  const steps: string[] = [];
  let text = '';
  let caret = 0;
  for (const digit of digits) {
    const raw = text.slice(0, caret) + digit + text.slice(caret);
    const formatted = formatEuPartialAt(raw, caret + 1, sep);
    text = formatted.text;
    caret = formatted.caret;
    steps.push(text);
  }
  return steps;
}

describe('formatEuPartialAt', () => {
  it('types 01012026 digit by digit as 01/01/2026', () => {
    expect(typeDigits('01012026')).toEqual([
      '0',
      '01',
      '01/0',
      '01/01',
      '01/01/2',
      '01/01/20',
      '01/01/202',
      '01/01/2026',
    ]);
  });

  it('types 15032024 digit by digit as 15/03/2024', () => {
    expect(typeDigits('15032024')).toEqual([
      '1',
      '15',
      '15/0',
      '15/03',
      '15/03/2',
      '15/03/20',
      '15/03/202',
      '15/03/2024',
    ]);
  });

  it('types a month that does not start with zero as 31/12/2025', () => {
    expect(typeDigits('31122025')).toEqual([
      '3',
      '31',
      '31/1',
      '31/12',
      '31/12/2',
      '31/12/20',
      '31/12/202',
      '31/12/2025',
    ]);
  });

  it('pads a short day and month when a later part is already there', () => {
    expect(formatEuPartialAt('1/1/2026', 8).text).toBe('01/01/2026');
  });

  it('groups a pasted run of eight digits the same way', () => {
    expect(formatEuPartialAt('01012026', 8).text).toBe('01/01/2026');
    expect(formatEuPartialAt('15032024', 8).text).toBe('15/03/2024');
  });

  it('drops the padding zero when the second digit of that part arrives', () => {
    // A padded day "01" plus the typed "5", with the month and year already there, is day 15.
    expect(formatEuPartialAt('015/03/2022', 3).text).toBe('15/03/2022');
    expect(formatEuPartialAt('015/03/2022', 3).caret).toBe(2);
    // A padded month "01" plus the typed "2", with the year already there, is month 12.
    expect(formatEuPartialAt('15/012/2022', 6).text).toBe('15/12/2022');
    expect(formatEuPartialAt('15/012/2022', 6).caret).toBe(5);
  });

  it('keeps an extra digit visible', () => {
    expect(formatEuPartialAt('15/03/20221', 11).text).toBe('15/03/20221');
    const ninth = typeDigits('010120267');
    expect(ninth[ninth.length - 1]).toBe('01/01/20267');
  });

  it('does not pad a part back while deleting', () => {
    expect(formatEuPartialAt('15/0/2022', 4, '/', false).text).toBe('15/0/2022');
    expect(formatEuPartialAt('15//2022', 3, '/', false).text).toBe('15//2022');
  });

  it('passes the next digit on with the language separator', () => {
    const german = typeDigits('01012026', '.');
    expect(german[german.length - 1]).toBe('01.01.2026');
  });

  it('passes the next digit on when a short part is left unpadded', () => {
    // The same rule when the caller skips the padding zero (formatEuPartial).
    expect(formatEuPartialAt('01/012', 6, '/', false).text).toBe('01/01/2');
  });
});
