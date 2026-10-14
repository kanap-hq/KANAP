import { describe, expect, it } from 'vitest';
import { countryNameFor, countryOptionsFor, filterCountryOptions } from './countries';
import type { CountryOption } from '../constants/isoOptions';

const search = (options: CountryOption[], inputValue: string) =>
  filterCountryOptions(options, { inputValue, getOptionLabel: (option) => option.name }).map((option) => option.code);

describe('country names in the interface language', () => {
  it('names a country in French and in English', () => {
    expect(countryNameFor('fr')('US')).toBe('États-Unis');
    expect(countryNameFor('fr')('de')).toBe('Allemagne');
    expect(countryNameFor('en')('US')).toBe('United States');
    expect(countryNameFor('en')('DE')).toBe('Germany');
  });

  it('keeps an unknown or empty code as it is', () => {
    expect(countryNameFor('fr')('Q1')).toBe('Q1');
    expect(countryNameFor('fr')(null)).toBe('');
    expect(countryNameFor('fr')('')).toBe('');
  });

  it('keeps the code as the value and builds each list once per locale', () => {
    const fr = countryOptionsFor('fr');
    expect(fr.find((option) => option.code === 'DE')?.name).toBe('Allemagne');
    expect(countryOptionsFor('fr')).toBe(fr);
    expect(countryNameFor('fr')).toBe(countryNameFor('fr'));
    expect(countryOptionsFor('en')).not.toBe(fr);
  });

  it('sorts the list in the interface language', () => {
    const names = countryOptionsFor('fr').map((option) => option.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'fr')));
    // "Égypte" sorts with the E countries in French, before "Espagne".
    expect(names.indexOf('Égypte')).toBeLessThan(names.indexOf('Espagne'));
    expect(names.indexOf('Égypte')).toBeGreaterThan(names.indexOf('Danemark'));
  });

  it('finds a country by its local name or by its code', () => {
    const fr = countryOptionsFor('fr');
    expect(search(fr, 'Allemagne')).toEqual(['DE']);
    expect(search(fr, 'DE')).toContain('DE');
    expect(search(fr, 'etats-unis')).toContain('US');
    expect(search(countryOptionsFor('en'), 'Germany')).toEqual(['DE']);
  });
});
