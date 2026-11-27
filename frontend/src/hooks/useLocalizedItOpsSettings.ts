import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useItOpsSettings } from './useItOpsSettings';
import type { ItOpsSettings } from '../services/itOpsSettings';
import { toCatalogLocale } from '../utils/catalogLocalization';
import { localizeItOpsSettings } from '../utils/itOpsSettingsLocalization';

// The lists and their shipped defaults live with the localization (`utils/itOpsSettingsLocalization.ts`).
export { CATALOG_LISTS, catalogDefaults } from '../utils/itOpsSettingsLocalization';

/**
 * The single display projection of the IT Ops catalogs: every list localized for the user's language
 * (tenant translation, then shipped translation for untouched defaults, then base text). The raw query
 * data is left untouched for the settings editors. Without the settings right it is built from the
 * catalog labels, so values are still named, never shown as raw codes.
 */
export function useLocalizedItOpsSettings(options: { enabled?: boolean } = {}) {
  const query = useItOpsSettings({ ...options, labelsWithoutRight: true });
  const { i18n } = useTranslation();
  const locale = toCatalogLocale(i18n.resolvedLanguage || i18n.language);
  const data = useMemo<ItOpsSettings | undefined>(
    () => (query.data ? localizeItOpsSettings(query.data, locale) : undefined),
    [query.data, locale],
  );
  return { ...query, data };
}

export default useLocalizedItOpsSettings;
