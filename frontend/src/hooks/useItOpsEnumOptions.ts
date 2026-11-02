import { useCallback, useMemo } from 'react';
import i18n from '../i18n';
import { useLocalizedItOpsSettings } from './useLocalizedItOpsSettings';
import { ItOpsEnumOption } from '../services/itOpsSettings';

type FieldKey =
  | 'applicationCategory'
  | 'dataClass'
  | 'networkSegment'
  | 'entity'
  | 'serverKind'
  | 'serverProvider'
  | 'serverRole'
  | 'hostingType'
  | 'lifecycleStatus'
  | 'interfaceProtocol'
  | 'interfaceDataCategory'
  | 'interfaceTriggerType'
  | 'interfacePattern'
  | 'interfaceFormat'
  | 'interfaceAuthMode'
  | 'domain'
  | 'ipAddressType'
  | 'accessMethod'
  | 'incidentCategories'
  | 'technologyFamily'
  | 'adminZone';

export function useItOpsEnumOptions(options: { enabled?: boolean } = {}) {
  // Display projection: names and descriptions localized for the user; editors use the raw settings hook.
  const { data } = useLocalizedItOpsSettings(options);
  const settings = data;

  const byField = useMemo<Record<FieldKey, ItOpsEnumOption[]>>(() => ({
    applicationCategory: settings?.applicationCategories ?? [],
    dataClass: settings?.dataClasses ?? [],
    networkSegment: settings?.networkSegments ?? [],
    entity: settings?.entities ?? [],
    serverKind: settings?.serverKinds ?? [],
    serverProvider: settings?.serverProviders ?? [],
    serverRole: settings?.serverRoles ?? [],
    hostingType: settings?.hostingTypes ?? [],
    lifecycleStatus: settings?.lifecycleStates ?? [],
    interfaceProtocol: settings?.interfaceProtocols ?? [],
    interfaceDataCategory: settings?.interfaceDataCategories ?? [],
    interfaceTriggerType: settings?.interfaceTriggerTypes ?? [],
    interfacePattern: settings?.interfacePatterns ?? [],
    interfaceFormat: settings?.interfaceFormats ?? [],
    interfaceAuthMode: settings?.interfaceAuthModes ?? [],
    domain: settings?.domains ?? [],
    ipAddressType: settings?.ipAddressTypes ?? [],
    accessMethod: settings?.accessMethods ?? [],
    incidentCategories: settings?.incidentCategories ?? [],
    technologyFamily: settings?.technologyFamilies ?? [],
    adminZone: settings?.adminZones ?? [],
  }), [settings]);

  const labelFor = useCallback((field: FieldKey, code?: string | null): string => {
    if (!code) return '';
    const list = byField[field] || [];
    const found = list.find((o) => o.code === code);
    if (!found) return String(code);
    return found.deprecated ? `${found.label} (${i18n.t('common:enumEditor.retiredSuffix')})` : found.label;
  }, [byField]);

  /**
   * An entity's name on a map or a connection: its catalog label in the user's language, or the name
   * the server stored when the catalog no longer has the code.
   */
  const entityName = useCallback((code?: string | null, storedName?: string | null): string => {
    const normalized = String(code ?? '').trim().toLowerCase();
    const known = !!normalized && byField.entity.some((option) => option.code.toLowerCase() === normalized);
    if (known) {
      const option = byField.entity.find((item) => item.code.toLowerCase() === normalized)!;
      return labelFor('entity', option.code);
    }
    return storedName || code || '';
  }, [byField, labelFor]);

  return { settings, byField, labelFor, entityName };
}

export default useItOpsEnumOptions;
