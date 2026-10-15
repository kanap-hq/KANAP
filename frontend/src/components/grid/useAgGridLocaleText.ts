import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocale } from '../../i18n/useLocale';

/**
 * AG Grid's own texts (filter operators, pagination, the keyboard hints screen readers announce)
 * in the user language, from the `grid` namespace. Every grid of the app passes it as `localeText`;
 * a key missing there falls back to AG Grid's English.
 */
export function useAgGridLocaleText(): Record<string, string> {
  const { i18n } = useTranslation('grid');
  const locale = useLocale();
  return useMemo(() => {
    const bundle = i18n?.getResourceBundle?.(locale, 'grid');
    return bundle && typeof bundle === 'object' ? { ...(bundle as Record<string, string>) } : {};
  }, [i18n, locale]);
}
