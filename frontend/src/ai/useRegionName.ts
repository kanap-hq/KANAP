import { useMemo } from 'react';
import { useLocale } from '../i18n/useLocale';

/** A region code's name in the interface language ("United States", "États-Unis"). */
export function useRegionName(): (code: string | null | undefined) => string {
  const locale = useLocale();
  return useMemo(() => {
    let display: Intl.DisplayNames | null = null;
    try {
      display = new Intl.DisplayNames([locale], { type: 'region' });
    } catch {
      display = null;
    }
    return (code) => {
      if (!code) return '';
      try {
        return display?.of(code) ?? code;
      } catch {
        return code;
      }
    };
  }, [locale]);
}
