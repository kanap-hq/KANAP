import { describe, expect, it } from 'vitest';
import { COUNTRY_OPTIONS, CURRENCY_OPTIONS } from './isoOptions';
import { currencyForCountry } from './countryCurrency';

describe('currencyForCountry', () => {
  it('gives the currency a country uses', () => {
    expect(currencyForCountry('FR')).toBe('EUR');
    expect(currencyForCountry('ch')).toBe('CHF');
    expect(currencyForCountry('SN')).toBe('XOF');
    expect(currencyForCountry('GB')).toBe('GBP');
  });

  it('gives nothing for a country without a currency of its own, or no country', () => {
    expect(currencyForCountry('AQ')).toBeNull();
    expect(currencyForCountry('')).toBeNull();
    expect(currencyForCountry(null)).toBeNull();
  });

  it('covers the listed countries with listed currencies', () => {
    const currencies = new Set(CURRENCY_OPTIONS.map((option) => option.code));
    const missing = COUNTRY_OPTIONS.filter((option) => !['AQ', 'KP'].includes(option.code) && !currencyForCountry(option.code)).map((option) => option.code);
    expect(missing).toEqual([]);
    const unknown = COUNTRY_OPTIONS.map((option) => currencyForCountry(option.code)).filter((code): code is string => !!code && !currencies.has(code));
    expect([...new Set(unknown)]).toEqual([]);
  });
});
