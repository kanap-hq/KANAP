import { describe, expect, it } from 'vitest';
import { currencyLabel, currencyOptionsFor, filterCurrencyOptions } from './currencies';

describe('currency names', () => {
  it('names every currency in the reader\'s language and keeps the ISO code', () => {
    const french = currencyOptionsFor('fr');
    expect(french.find((option) => option.code === 'USD')?.name).toBe('Dollar des États-Unis');
    expect(french.find((option) => option.code === 'CHF')?.name).toBe('Franc suisse');
    expect(currencyOptionsFor('de').find((option) => option.code === 'EUR')?.name).toBe('Euro');
    expect(currencyOptionsFor('en').find((option) => option.code === 'GBP')?.name).toBe('British Pound');
  });

  it('keeps the list in code order', () => {
    const codes = currencyOptionsFor('es').map((option) => option.code);
    expect(codes).toEqual([...codes].sort());
  });

  it('ranks an exact code before a code prefix, then a name', () => {
    const options = [
      { code: 'CHE', name: 'WIR Euro' },
      { code: 'CHF', name: 'Swiss franc' },
      { code: 'EURX', name: 'Test' },
      { code: 'EUR', name: 'Euro' },
    ];
    expect(filterCurrencyOptions(options, 'eur').map((option) => option.code)).toEqual(['EUR', 'EURX', 'CHE']);
    expect(filterCurrencyOptions(options, 'CH').map((option) => option.code)).toEqual(['CHE', 'CHF']);
    expect(filterCurrencyOptions(options, '  Eur ').map((option) => option.code)[0]).toBe('EUR');
    expect(filterCurrencyOptions(options, '').map((option) => option.code)).toEqual(['CHE', 'CHF', 'EURX', 'EUR']);
    expect(filterCurrencyOptions(options, 'swiss').map((option) => option.code)).toEqual(['CHF']);
  });

  it('writes one label everywhere: the code, then the name in the reader\'s language', () => {
    const euro = currencyOptionsFor('fr').find((option) => option.code === 'EUR')!;
    expect(currencyLabel(euro)).toBe('EUR · Euro');
    expect(currencyLabel({ code: 'XYZ', name: 'XYZ' })).toBe('XYZ');
  });
});
