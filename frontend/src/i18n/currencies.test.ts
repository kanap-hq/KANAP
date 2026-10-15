import { describe, expect, it } from 'vitest';
import { currencyOptionsFor } from './currencies';

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
});
