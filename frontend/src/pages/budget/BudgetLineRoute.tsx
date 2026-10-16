import React from 'react';
import { Alert } from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, useLocation, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import type { LineType } from '../../constants/lineTypeUsage';
import BudgetLinePage from './BudgetLinePage';

/** Resolve both natures and old references before mounting the workspace's child resources. */
export default function BudgetLineRoute() {
  const { ref = 'new', tab } = useParams();
  const location = useLocation();
  const { t } = useTranslation('ops');
  const isCreate = ref === 'new';
  const queryClient = useQueryClient();
  const resolveQuery = {
    queryKey: ['budget-line-resolve', ref],
    queryFn: async ({ signal }: { signal: AbortSignal }) => (await api.get<{ id: string; nature: LineType; reference: string }>(
      `/budget-lines/resolve/${encodeURIComponent(ref)}`, { signal },
    )).data,
    retry: false,
    // A line can change nature while its BL reference stays the same: read again on every visit,
    // except right after the read the route waited for.
    staleTime: 1000,
  };
  const resolved = useQuery({ ...resolveQuery, enabled: !isCreate, throwOnError: false });
  // Opened from another page, the route suspends until the line is resolved: the previous page stays
  // on screen meanwhile (useShownLocation) instead of a blank frame. Once shown, a move to another
  // line of the workspace (previous, next) waits without suspending, as before.
  const shown = React.useRef(false);
  React.useEffect(() => { shown.current = true; }, []);
  // A failed read does not suspend again: the error shows below.
  const cached = queryClient.getQueryState(resolveQuery.queryKey);
  if (!isCreate && !shown.current && cached?.data === undefined && cached?.status !== 'error') {
    throw queryClient.fetchQuery(resolveQuery).catch(() => undefined);
  }
  if (isCreate) {
    const nature = new URLSearchParams(location.search).get('nature') === 'capex' ? 'capex' : 'opex';
    return <BudgetLinePage nature={nature} />;
  }
  if (resolved.error || (resolved.data === undefined && cached?.status === 'error')) return <Alert severity="error" sx={{ m: 2 }}>{t('opex.workspace.failedToLoad')}</Alert>;
  if (!resolved.data) return null;
  if (ref !== resolved.data.reference) {
    return <Navigate replace to={`/ops/budget/${resolved.data.reference}${tab ? `/${tab}` : ''}${location.search}${location.hash}`} />;
  }
  return <BudgetLinePage nature={resolved.data.nature} />;
}
