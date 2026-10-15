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

/** The one currency label of the app: "EUR · Euro" (the code alone when the name is unknown). */
export function currencyLabel(option: CurrencyOption): string {
  return option.name && option.name !== option.code ? `${option.code} · ${option.name}` : option.code;
}

export function useCurrencyOptions(): CurrencyOption[] {
  const locale = useLocale();
  return useMemo(() => currencyOptionsFor(locale), [locale]);
}
