import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import { ANALYTICS_VALUES_ENDPOINT } from '../../services/analytics';
import type { ExclusionOption } from '../../components/reports/ReportExclusionPicker';
import {
  accountIdOptionsRequest,
  accountLabelOptions,
  axisValuesRequest,
  itemOptionsRequest,
  mergeAccountOptions,
  mergeAxisValueOptions,
  readItemOptions,
  type AccountLabelOption,
  type AccountRow,
  type BudgetScope,
} from './reportAggregates';
import { compareNames, SUMMARY_QUERY_KEY, useBudgetAggregate } from './useBudgetAggregate';

/**
 * The options of the reports' exclusion pickers, read when a picker first opens (`wanted`): every
 * line of the report's window, filters aside, ordered by name.
 */

type Options<T> = { options: T[] | undefined; loading: boolean };

/** Every line, by name (the item exclusion). */
export function useItemOptions(scope: BudgetScope, wanted: boolean): Options<ExclusionOption> {
  const query = useBudgetAggregate(scope, useMemo(() => itemOptionsRequest(scope), [scope]), { enabled: wanted });
  const options = useMemo(
    () => (query.data ? readItemOptions(query.data, compareNames).map((option) => ({ id: option.id, label: option.name })) : undefined),
    [query.data],
  );
  return { options, loading: wanted && query.isLoading };
}

/** The account labels of the lines, one per trimmed label (the account exclusion of the top and variance reports). */
export function useAccountLabelOptions(scope: BudgetScope, wanted: boolean): Options<AccountLabelOption> {
  const query = useQuery({
    queryKey: [SUMMARY_QUERY_KEY[scope], 'filter-values', 'account_display'],
    queryFn: async ({ signal }) => {
      const res = await api.get<Record<string, Array<string | null>>>(`/${scope === 'opex' ? 'spend' : 'capex'}-items/summary/filter-values`, {
        params: { fields: 'account_display' },
        signal,
      });
      return res.data.account_display ?? [];
    },
    enabled: wanted,
  });
  const options = useMemo(() => (query.data ? accountLabelOptions(query.data, compareNames) : undefined), [query.data]);
  return { options, loading: wanted && query.isLoading };
}

/**
 * The accounts of the Consolidation exclusion, by id: the tenant's accounts (`/accounts`, the
 * 1,000 newest active ones, as before) and the accounts the lines use, inactive ones included
 * (their lines count in their consolidation line). `[number] name`, by label.
 */
export function useAccountIdOptions(scope: BudgetScope, wanted: boolean): Options<ExclusionOption> {
  const { t } = useTranslation('ops');
  const accounts = useQuery<AccountRow[]>({
    queryKey: ['accounts', 'enabled-for-consolidation'],
    queryFn: async () => (await api.get<{ items: AccountRow[] }>('/accounts', { params: { limit: 1000 } })).data.items,
    enabled: wanted,
  });
  const used = useBudgetAggregate(scope, useMemo(() => accountIdOptionsRequest(), []), { enabled: wanted });
  const unnamed = t('reports.shared.unnamedAccount');
  const options = useMemo(
    () => (!used.data || (!accounts.data && !accounts.isError) ? undefined : mergeAccountOptions(accounts.data ?? [], used.data, unnamed, compareNames)),
    [accounts.data, accounts.isError, used.data, unnamed],
  );
  return { options, loading: wanted && (used.isLoading || accounts.isLoading) };
}

type AnalyticsCategory = { id: string; name: string | null };

/**
 * The values of a dimension (the value exclusion of the Analytics report): the dimension's own
 * values and the ones the lines hold, by name.
 */
export function useAxisValueOptions(scope: BudgetScope, axisId: string | null, wanted: boolean): Options<ExclusionOption> {
  const { t } = useTranslation('ops');
  const unnamed = t('reports.analyticsCategory.unnamed');
  const catalogue = useQuery<AnalyticsCategory[]>({
    queryKey: ['analytics-categories', 'reporting', axisId],
    queryFn: async () => {
      const res = await api.get<{ items: AnalyticsCategory[] }>(ANALYTICS_VALUES_ENDPOINT, {
        params: { axis_id: axisId, limit: 1000, sort: 'name:ASC' },
      });
      return res.data.items;
    },
    enabled: wanted && Boolean(axisId),
  });
  const held = useBudgetAggregate(scope, useMemo(() => axisValuesRequest(axisId), [axisId]), { enabled: wanted });
  const options = useMemo(
    () => (!held.data || (axisId && !catalogue.data && !catalogue.isError) ? undefined : mergeAxisValueOptions(catalogue.data ?? [], held.data, unnamed, compareNames)),
    [catalogue.data, catalogue.isError, held.data, axisId, unnamed],
  );
  return { options, loading: wanted && (held.isLoading || catalogue.isLoading) };
}
