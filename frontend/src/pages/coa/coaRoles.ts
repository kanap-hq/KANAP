import { useMemo } from 'react';
import type { TFunction } from 'i18next';
import { COUNTRY_OPTIONS } from '../../constants/isoOptions';
import { useLocale } from '../../i18n/useLocale';
import type { CoaListItem } from './useCoaList';

const COUNTRY_NAME_BY_CODE = new Map(COUNTRY_OPTIONS.map((c) => [c.code.toUpperCase(), c.name]));

export type CountryNameFn = (iso?: string | null) => string;

/** A country's name in the interface language ("France", "Pays-Bas"), the English list as fallback. */
export function useCountryName(): CountryNameFn {
  const locale = useLocale();
  return useMemo(() => {
    let display: Intl.DisplayNames | null = null;
    try {
      display = new Intl.DisplayNames([locale], { type: 'region' });
    } catch {
      display = null;
    }
    return (iso?: string | null) => {
      if (!iso) return '';
      const code = iso.toUpperCase();
      try {
        const name = display?.of(code);
        if (name && name !== code) return name;
      } catch {
        // An unknown region code: fall back to the static list.
      }
      return COUNTRY_NAME_BY_CODE.get(code) ?? code;
    };
  }, [locale]);
}

/** Where a chart applies: its country, or every country for a GLOBAL chart. */
export function coaCoverage(coa: CoaListItem, t: TFunction, countryName: CountryNameFn): string {
  if (coa.scope === 'GLOBAL') return t('master-data:coa.coverage.allCountries');
  return countryName(coa.country_iso) || t('master-data:coa.coverage.allCountries');
}

/** The roles a chart holds, in words ("Country default (France)", "Consolidation chart"). */
export function coaRoleLabels(coa: CoaListItem, t: TFunction, countryName: CountryNameFn): string[] {
  const roles: string[] = [];
  if (coa.scope === 'COUNTRY' && coa.is_default) {
    roles.push(t('master-data:coa.roles.countryDefault', { country: countryName(coa.country_iso) }));
  }
  if (coa.scope === 'GLOBAL' && coa.is_global_default) {
    roles.push(t('master-data:coa.roles.globalDefault'));
  }
  if (coa.is_consolidation) {
    roles.push(t('master-data:coa.roles.consolidation'));
  }
  return roles;
}
