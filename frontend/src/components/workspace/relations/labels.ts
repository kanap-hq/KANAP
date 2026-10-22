import { useTranslation } from 'react-i18next';
import useApplicationClassificationCatalog from '../../../hooks/useApplicationClassificationCatalog';
import useItOpsEnumOptions from '../../../hooks/useItOpsEnumOptions';
import { DASH } from './helpers';

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
  const { data: catalog } = useApplicationClassificationCatalog();
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
