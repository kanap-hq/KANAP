import { useMemo } from 'react';
import { CURRENCY_OPTIONS, type CurrencyOption } from '../constants/isoOptions';
import { useLocale } from './useLocale';

const optionsByLocale = new Map<string, CurrencyOption[]>();

/** Every ISO currency, code kept as the value and order, named in this locale ("Franc suisse" for CHF in French). */
export function currencyOptionsFor(locale: string): CurrencyOption[] {
  const cached = optionsByLocale.get(locale);
  if (cached) return cached;
  let display: Intl.DisplayNames | null = null;
  try {
    display = new Intl.DisplayNames([locale], { type: 'currency' });
  } catch {
    display = null;
  }
  const options = CURRENCY_OPTIONS.map((option) => {
    let name = option.name;
    try {
      const local = display?.of(option.code);
      // Names read as labels: sentence case, whatever the language writes mid-sentence.
      if (local && local !== option.code) name = local.charAt(0).toLocaleUpperCase(locale) + local.slice(1);
    } catch {
      // A code the runtime does not know keeps its English name.
    }
    return { code: option.code, name };
  });
  optionsByLocale.set(locale, options);
  return options;
}

/**
 * Suggestions for a typed currency: the exact code, then codes that start with it,
 * then a code or a name that contains it. The same rank keeps the list order.
 * An empty query returns every option.
 */
export function filterCurrencyOptions<T extends { code: string; name: string }>(options: T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return options;
  const ranked: Array<{ option: T; index: number; rank: number }> = [];
  options.forEach((option, index) => {
    const code = option.code.toLowerCase();
    const name = option.name.toLowerCase();
    const rank = code === needle ? 0 : code.startsWith(needle) ? 1 : (code.includes(needle) || name.includes(needle) ? 2 : null);
    if (rank != null) ranked.push({ option, index, rank });
  });
  ranked.sort((a, b) => a.rank - b.rank || a.index - b.index);
  return ranked.map((item) => item.option);
}

/** The one currency label of the app: "EUR · Euro" (the code alone when the name is unknown). */
export function currencyLabel(option: CurrencyOption): string {
  return option.name && option.name !== option.code ? `${option.code} · ${option.name}` : option.code;
}

export function useCurrencyOptions(): CurrencyOption[] {
  const locale = useLocale();
  return useMemo(() => currencyOptionsFor(locale), [locale]);
}
