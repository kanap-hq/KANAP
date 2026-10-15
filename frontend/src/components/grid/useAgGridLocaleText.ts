import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AG_GRID_LOCALE_DE,
  AG_GRID_LOCALE_EN,
  AG_GRID_LOCALE_ES,
  AG_GRID_LOCALE_FR,
} from '@ag-grid-community/locale';
import type { SupportedLocale } from '../../i18n';
import { useLocale } from '../../i18n/useLocale';

// The official AG Grid translations, at the version of ag-grid-community.
const PACKAGE_TEXTS: Record<SupportedLocale, Record<string, string>> = {
  en: AG_GRID_LOCALE_EN,
  fr: AG_GRID_LOCALE_FR,
  de: AG_GRID_LOCALE_DE,
  es: AG_GRID_LOCALE_ES,
};

/**
 * AG Grid's own texts (filter operators, pagination, the keyboard hints screen readers announce)
 * in the user language. Every grid of the app passes it as `localeText`.
 *
 * The texts come from `@ag-grid-community/locale`. The `grid` namespace only holds the keys the
 * package gets wrong or lacks, and wins over it:
 * - `ariaHeaderSelection`: missing in French, German and Spanish (English is in title case);
 * - `ariaChecked`, `ariaUnchecked`: German says "geprüft" (tested) for a checked box;
 * - `ariaRowDeselect`: misspelt in German ("abzuwaehlen").
 * The other languages keep the package wording for those keys. Ellipses are written as one character.
 */
export function useAgGridLocaleText(): Record<string, string> {
  const { i18n } = useTranslation('grid');
  const locale = useLocale();
  return useMemo(() => {
    const overrides = i18n?.getResourceBundle?.(locale, 'grid');
    const texts: Record<string, string> = {
      ...PACKAGE_TEXTS[locale],
      ...(overrides && typeof overrides === 'object' ? (overrides as Record<string, string>) : {}),
    };
    for (const key of Object.keys(texts)) {
      if (typeof texts[key] === 'string') texts[key] = texts[key].replace(/\.\.\./g, '…');
    }
    return texts;
  }, [i18n, locale]);
}
