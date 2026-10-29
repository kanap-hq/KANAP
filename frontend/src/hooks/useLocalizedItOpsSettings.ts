import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useItOpsSettings } from './useItOpsSettings';
import type { ItOpsSettings } from '../services/itOpsSettings';
import i18n from '../i18n';
import { localizeCatalogList, toCatalogLocale, type CatalogDefaults } from '../utils/catalogLocalization';
import { classificationDefaults } from '../utils/applicationClassification';
import { itOpsCatalogDefaults } from '../utils/itOpsCatalogDefaults';

export const CATALOG_LISTS = [
  'applicationCategories', 'networkSegments', 'entities', 'serverKinds', 'serverProviders', 'serverRoles', 'hostingTypes', 'lifecycleStates',
  'interfaceProtocols', 'interfaceDataCategories', 'interfaceTriggerTypes', 'interfacePatterns', 'interfaceFormats', 'interfaceAuthModes',
  'connectionTypes', 'domains', 'ipAddressTypes', 'accessMethods', 'pathHopFunctions', 'incidentCategories', 'technologyFamilies', 'adminZones',
  'businessCriticalityLevels', 'cyberCriticalityLevels', 'dataClasses', 'recoveryWaves',
] as const;

// The four lifecycle states every tenant has (stored in English), shown in the user's language
// while the tenant keeps the shipped name.
const LIFECYCLE_SOURCE: Record<string, { label: string }> = {
  proposed: { label: 'Proposed' },
  active: { label: 'Active' },
  deprecated: { label: 'Deprecated' },
  retired: { label: 'Retired' },
};
const LIFECYCLE_DEFAULTS: CatalogDefaults = {
  source: LIFECYCLE_SOURCE,
  translated: (locale, code) => {
    const label = i18n.getResource(locale, 'common', `statuses.${code}`);
    return typeof label === 'string' ? { label } : undefined;
  },
};

/** The shipped defaults of a catalog list (shared with the backend import table, see catalogShippedLabels.sync.test.ts). */
export function catalogDefaults(key: (typeof CATALOG_LISTS)[number]): CatalogDefaults | undefined {
  return key === 'lifecycleStates' ? LIFECYCLE_DEFAULTS : classificationDefaults(key) ?? itOpsCatalogDefaults(key);
}

/**
 * The single display projection of the IT Ops catalogs: every list localized for the user's language
 * (tenant translation, then shipped translation for untouched defaults, then base text). The raw query
 * data is left untouched for the settings editors.
 */
export function useLocalizedItOpsSettings(options: { enabled?: boolean } = {}) {
  const query = useItOpsSettings(options);
  const { i18n } = useTranslation();
  const locale = toCatalogLocale(i18n.resolvedLanguage || i18n.language);
  const data = useMemo<ItOpsSettings | undefined>(() => {
    if (!query.data) return undefined;
    const next: any = { ...query.data };
    for (const key of CATALOG_LISTS) next[key] = localizeCatalogList((query.data as any)[key], locale, catalogDefaults(key));
    // The shipped "custom" connection types store "specify" as typical port: the user gives the port.
    next.connectionTypes = (next.connectionTypes ?? []).map((type: any) => (
      type?.typicalPorts === 'specify' ? { ...type, typicalPorts: '' } : type
    ));
    return next as ItOpsSettings;
  }, [query.data, locale]);
  return { ...query, data };
}

export default useLocalizedItOpsSettings;
