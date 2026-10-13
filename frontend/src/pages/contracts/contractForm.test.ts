import { describe, expect, it } from 'vitest';
import { formatAmount, parseAmount, parseMonths } from './contractForm';

describe('contract form values', () => {
  it('reads amounts typed with either decimal mark and thousands separators', () => {
    expect(parseAmount('350000')).toBe(350000);
    expect(parseAmount('350 000,50')).toBe(350000.5);
    expect(parseAmount('350 000,5')).toBe(350000.5);
    expect(parseAmount('350,000.25')).toBe(350000.25);
    expect(parseAmount('350.000,25')).toBe(350000.25);
    expect(parseAmount('1,000')).toBe(1000);
    expect(parseAmount('12.5')).toBe(12.5);
    expect(parseAmount('12.345,678')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('')).toBeNull();
  });

  it('reads whole months only', () => {
    expect(parseMonths('12')).toBe(12);
    expect(parseMonths(' 6 ')).toBe(6);
    expect(parseMonths('1.5')).toBeNull();
    expect(parseMonths('-1')).toBeNull();
  });

  it('shows whole amounts without decimals and the others with two', () => {
    expect(formatAmount('350000.00', 'en')).toBe('350,000');
    expect(formatAmount(12500.5, 'en')).toBe('12,500.50');
  });
});
