import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AG_GRID_LOCALE_DE,
  AG_GRID_LOCALE_EN,
  AG_GRID_LOCALE_ES,
  AG_GRID_LOCALE_FR,
} from '@ag-grid-community/locale';
import type { SupportedLocale } from '../../i18n';
import { numberSeparators } from '../../i18n/formatters';
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
 * The texts come from `@ag-grid-community/locale`. The `grid` namespace holds the keys where the
 * package breaks our rules or is wrong, and wins over it (each key is in every language; a language
 * with nothing to fix keeps the package wording):
 * - title case in labels people see or hear (English, Spanish, French pagination): sentence case;
 * - key names in capitals ("Press SPACE", "CTRL ENTER"): the language's usual names (Espace,
 *   Ctrl+Entrée, die Leertaste, Pulse Intro), and usted in Spanish like the rest of the app;
 * - missing texts: `ariaHeaderSelection` in French, German and Spanish;
 * - wrong words: French "rang" for a dragged row, "Pas d'épingle", "1 à 20 de 100", "Plus de ou
 *   égal à"; German "geprüft" (tested) for a checked box, "Nummer" for a number, "Filtereingang",
 *   "abzuwaehlen"; Spanish "Más o igual que".
 * Ellipses are written as one character. The thousand and decimal separators AG Grid writes in the
 * pagination ("1 à 100 sur 7 486") come from Intl, like our own counts: the package gives "," in
 * French and Spanish.
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
    const separators = numberSeparators(locale);
    texts.thousandSeparator = separators.thousand;
    texts.decimalSeparator = separators.decimal;
    return texts;
  }, [i18n, locale]);
}
