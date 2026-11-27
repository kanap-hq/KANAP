import i18n from '../i18n';
import type { CatalogLocale, ItOpsSettings } from '../services/itOpsSettings';
import { classificationDefaults } from './applicationClassification';
import { appQueryClient } from '../lib/appQueryClient';
import { localizeCatalogList, toCatalogLocale, type CatalogDefaults } from './catalogLocalization';
import { registerCatalogValueNamer } from './catalogValueName';
import { itOpsCatalogDefaults } from './itOpsCatalogDefaults';

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
 * Every catalog list of the settings localized for `locale` (tenant translation, then shipped
 * translation for untouched defaults, then base text): the names the selectors show
 * (`useLocalizedItOpsSettings`), and the name a refusal gives a value (`catalogValueName`).
 */
export function localizeItOpsSettings(data: ItOpsSettings, locale: CatalogLocale): ItOpsSettings {
  const next: any = { ...data };
  for (const key of CATALOG_LISTS) next[key] = localizeCatalogList((data as any)[key], locale, catalogDefaults(key));
  // The shipped "custom" connection types store "specify" as typical port: the user gives the port.
  next.connectionTypes = (next.connectionTypes ?? []).map((type: any) => (
    type?.typicalPorts === 'specify' ? { ...type, typicalPorts: '' } : type
  ));
  return next as ItOpsSettings;
}

// A refused catalog value is named in a message as the field's selector names it: from the settings
// the screens loaded (with the settings right, else the catalog labels), localized as above.
registerCatalogValueNamer((list, code, language) => {
  const settings = appQueryClient.getQueryData<ItOpsSettings>(['it-ops-settings'])
    ?? appQueryClient.getQueryData<ItOpsSettings>(['it-ops-catalog-labels']);
  if (!settings || !(CATALOG_LISTS as readonly string[]).includes(list)) return null;
  const entries = localizeCatalogList(((settings as any)[list] ?? []) as Array<{ code: string; label: string }>, toCatalogLocale(language), catalogDefaults(list as (typeof CATALOG_LISTS)[number]));
  const label = entries.find((entry) => entry.code === code)?.label;
  return label ? String(label) : null;
});
