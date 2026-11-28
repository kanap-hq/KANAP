import { useTranslation } from 'react-i18next';
import { useAuth } from '../../../auth/AuthContext';
import useApplicationClassificationCatalog from '../../../hooks/useApplicationClassificationCatalog';
import useItOpsEnumOptions from '../../../hooks/useItOpsEnumOptions';
import { DASH } from './helpers';

/** Same text as the throw in `useAuth` (`AuthContext.tsx`). */
const AUTH_PROVIDER_REQUIRED = 'useAuth must be used within AuthProvider';

/**
 * The applications or the infrastructure reader level: the pair the classification catalog route
 * requires. Component tests render this hook with no `AuthProvider`: `useAuth` throws there. The
 * app always mounts the provider (`main.tsx`), so a missing one is not a person who lacks the
 * right, and the fetch stays on for those tests.
 */
function useCanReadClassificationCatalog(): boolean {
  try {
    const { hasLevel } = useAuth();
    return hasLevel('applications', 'reader') || hasLevel('infrastructure', 'reader');
  } catch (error) {
    if (error instanceof Error && error.message === AUTH_PROVIDER_REQUIRED) return true;
    throw error;
  }
}

/** The same environment keys as the assets list (`AssetsPage`). */
const ENV_LABEL_KEYS: Record<string, string> = {
  prod: 'enums.environment.prod',
  pre_prod: 'enums.environment.preProd',
  qa: 'enums.environment.qa',
  test: 'enums.environment.test',
  dev: 'enums.environment.dev',
  sandbox: 'enums.environment.sandbox',
};

const camel = (code: string) => code.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());

/**
 * The labels of the application, asset and technology sections, from the same helpers as the lists.
 * An empty value is "—". The factories stay free of hooks and receive these functions.
 * Import this file directly: the catalogs load the i18n instance, which the relations barrel must not.
 */
export function useRelationLabels() {
  const { t } = useTranslation('it');
  const { labelFor } = useItOpsEnumOptions();
  // Without either reader level the route answers 403 and the translated level is the label.
  const canReadCatalog = useCanReadClassificationCatalog();
  const { data: catalog } = useApplicationClassificationCatalog({ enabled: canReadCatalog });
  const text = (code: string | null | undefined, label: string) => (code ? label || code : DASH);

  return {
    lifecycle: (code: string | null) => text(code, labelFor('lifecycleStatus', code)),
    /** An asset's status is its lifecycle, as on the assets list. */
    status: (code: string | null) => text(code, labelFor('lifecycleStatus', code)),
    criticality: (code: string | null) => {
      if (!code) return DASH;
      const fromCatalog = catalog?.businessCriticalityLevels?.find((level) => level.code === code)?.label;
      if (fromCatalog) return fromCatalog;
      return t(`enums.criticality.${camel(code)}`, { defaultValue: code });
    },
    assetKind: (code: string | null) => text(code, labelFor('serverKind', code)),
    family: (code: string | null) => text(code, labelFor('technologyFamily', code)),
    environment: (code: string | null) => {
      if (!code) return DASH;
      const key = ENV_LABEL_KEYS[code];
      return key ? t(key) : code;
    },
  };
}
