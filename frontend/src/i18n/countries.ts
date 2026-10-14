import { useMemo } from 'react';
import { createFilterOptions } from '@mui/material';
import { COUNTRY_OPTIONS, type CountryOption } from '../constants/isoOptions';
import { useLocale } from './useLocale';

export type CountryNameFn = (iso?: string | null) => string;

const ENGLISH_NAME_BY_CODE = new Map(COUNTRY_OPTIONS.map((c) => [c.code.toUpperCase(), c.name]));

// One name function and one sorted list per locale, built on first use.
const nameFnByLocale = new Map<string, CountryNameFn>();
const optionsByLocale = new Map<string, CountryOption[]>();

/** A country's name in this locale ("Allemagne" for DE in French); the English list, then the code, as fallback. */
export function countryNameFor(locale: string): CountryNameFn {
  const cached = nameFnByLocale.get(locale);
  if (cached) return cached;
  let display: Intl.DisplayNames | null = null;
  try {
    display = new Intl.DisplayNames([locale], { type: 'region' });
  } catch {
    display = null;
  }
  const fn: CountryNameFn = (iso) => {
    if (!iso) return '';
    const code = iso.trim().toUpperCase();
    if (!code) return '';
    try {
      const name = display?.of(code);
      if (name && name !== code) return name;
    } catch {
      // A malformed region code: fall back to the static list.
    }
    return ENGLISH_NAME_BY_CODE.get(code) ?? code;
  };
  nameFnByLocale.set(locale, fn);
  return fn;
}

/** Every country, code kept as the value, named and sorted in this locale. */
export function countryOptionsFor(locale: string): CountryOption[] {
  const cached = optionsByLocale.get(locale);
  if (cached) return cached;
  const name = countryNameFor(locale);
  const options = COUNTRY_OPTIONS
    .map((option) => ({ code: option.code, name: name(option.code) }))
    .sort((a, b) => a.name.localeCompare(b.name, locale));
  optionsByLocale.set(locale, options);
  return options;
}

/** Typed search in a country list matches the local name or the code ("Allemagne", "DE"). */
export const filterCountryOptions = createFilterOptions<CountryOption>({
  stringify: (option) => `${option.name} ${option.code}`,
});

export function useCountryName(): CountryNameFn {
  const locale = useLocale();
  return useMemo(() => countryNameFor(locale), [locale]);
}

export function useCountryOptions(): CountryOption[] {
  const locale = useLocale();
  return useMemo(() => countryOptionsFor(locale), [locale]);
}
