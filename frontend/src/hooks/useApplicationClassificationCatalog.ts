import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { fetchApplicationClassificationCatalog } from '../services/itOpsSettings';
import { localizeApplicationClassificationCatalog } from '../utils/applicationClassification';
import { toCatalogLocale } from '../utils/catalogLocalization';

export function useApplicationClassificationCatalog(opts: { enabled?: boolean } = {}) {
  const { i18n } = useTranslation();
  return useQuery({
    queryKey: ['application-classification-catalog'],
    enabled: opts.enabled ?? true,
    queryFn: fetchApplicationClassificationCatalog,
    // Tenant translations, then shipped translations for untouched defaults, then base text. The language dependency
    // makes React Query re-run select after a locale change; the cached API object remains untouched.
    select: (catalog) => localizeApplicationClassificationCatalog(catalog, toCatalogLocale(i18n.resolvedLanguage || i18n.language)),
    staleTime: 5 * 60 * 1000,
  });
}

export default useApplicationClassificationCatalog;
