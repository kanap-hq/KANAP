import React from 'react';
import { useApplicationClassificationCatalog } from '../../hooks/useApplicationClassificationCatalog';
import { useItOpsEnumOptions } from '../../hooks/useItOpsEnumOptions';
import type { AuditCatalogList } from '../../lib/audit/auditLogValues';

/** The IT settings lists. The classification axes are read from the classification catalog. */
type ItCatalogList = 'applicationCategories' | 'accessMethods' | 'incidentCategories' | 'serverRoles';

/** The catalog list of the IT settings that holds each code list of the history. */
const CATALOG_FIELDS: Record<ItCatalogList, Parameters<ReturnType<typeof useItOpsEnumOptions>['labelFor']>[0]> = {
  applicationCategories: 'applicationCategory',
  accessMethods: 'accessMethod',
  incidentCategories: 'incidentCategories',
  serverRoles: 'serverRole',
};

export function isItCatalogList(list: AuditCatalogList): list is ItCatalogList {
  return list === 'applicationCategories' || list === 'accessMethods' || list === 'incidentCategories' || list === 'serverRoles';
}

/**
 * The tenant's label of a catalog code, as the record's screen shows it: the IT settings for a
 * category or a role, the classification catalog for a criticality or a recovery wave. Null when
 * that catalog has no such code, so the shipped label or the code shows instead. The record's
 * History tab and the audit log detail read it; each says which catalogs it needs.
 */
export function useCatalogLabel({ it, classification: readClassification }: { it: boolean; classification: boolean }) {
  const { byField, labelFor } = useItOpsEnumOptions({ enabled: it });
  const classification = useApplicationClassificationCatalog({ enabled: readClassification });
  return React.useCallback((list: AuditCatalogList, code: string): string | null => {
    if (!isItCatalogList(list)) {
      const level = classification.data?.[list]?.find((item) => item.code === code);
      return level?.label || null;
    }
    const field = CATALOG_FIELDS[list];
    return (byField[field] ?? []).some((option) => option.code === code) ? labelFor(field, code) : null;
  }, [byField, classification.data, labelFor]);
}
