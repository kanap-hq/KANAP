import type { TFunction } from 'i18next';
import type { CountryNameFn } from '../../i18n/countries';
import type { CoaListItem } from './useCoaList';

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
