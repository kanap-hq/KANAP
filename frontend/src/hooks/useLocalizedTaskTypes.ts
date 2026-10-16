import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../api';
import { toCatalogLocale } from '../utils/catalogLocalization';
import { localizeTaskType, taskTypeLabel } from '../utils/taskTypeLocalization';

export type TaskTypeRecord = {
  id: string;
  name: string;
  /** The shipped type it started as (`task`, `bug`, `problem`, `incident`), null for a tenant's own type. */
  code: string | null;
  description: string | null;
  is_active: boolean;
  display_order?: number;
  is_system?: boolean;
};

export const TASK_TYPES_QUERY_KEY = ['portfolio-task-types'] as const;

/** The user's language as a catalog locale (en, fr, de or es). */
export function useCatalogLocale() {
  const { i18n } = useTranslation();
  return toCatalogLocale(i18n.resolvedLanguage || i18n.language);
}

/** Shows a task type from its stored name and code: translated while it is a shipped type the tenant kept. */
export function useTaskTypeLabel() {
  const locale = useCatalogLocale();
  return useCallback(
    (name: string | null | undefined, code: string | null | undefined) => taskTypeLabel(name, code, locale),
    [locale],
  );
}

/**
 * The tenant's task types for display: each one localized (see `localizeTaskType`), plus
 * `labelByName`, the displayed name per stored name (names are unique per tenant), for the
 * values a server-side filter returns as stored text.
 */
export function useLocalizedTaskTypes(opts: { enabled?: boolean } = {}) {
  const query = useQuery({
    queryKey: TASK_TYPES_QUERY_KEY,
    queryFn: async () => (await api.get<TaskTypeRecord[]>('/portfolio/classification/task-types')).data,
    enabled: opts.enabled ?? true,
  });
  const locale = useCatalogLocale();
  const data = useMemo(() => query.data?.map((type) => localizeTaskType(type, locale)), [query.data, locale]);
  const labelByName = useMemo(() => {
    const map: Record<string, string> = {};
    (query.data ?? []).forEach((type, index) => { map[type.name] = data?.[index]?.name ?? type.name; });
    return map;
  }, [query.data, data]);
  return { ...query, data, raw: query.data, labelByName };
}

export default useLocalizedTaskTypes;
