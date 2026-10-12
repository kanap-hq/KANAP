import React from 'react';
import { Alert } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
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
  const resolved = useQuery({
    queryKey: ['budget-line-resolve', ref],
    queryFn: async ({ signal }) => (await api.get<{ id: string; nature: LineType; reference: string }>(
      `/budget-lines/resolve/${encodeURIComponent(ref)}`, { signal },
    )).data,
    enabled: !isCreate,
    retry: false,
    throwOnError: false,
    // A line can change nature while its BL reference stays the same.
    staleTime: 0,
  });
  if (isCreate) {
    const nature = new URLSearchParams(location.search).get('nature') === 'capex' ? 'capex' : 'opex';
    return <BudgetLinePage nature={nature} />;
  }
  if (resolved.error) return <Alert severity="error" sx={{ m: 2 }}>{t('opex.workspace.failedToLoad')}</Alert>;
  if (!resolved.data) return null;
  if (ref !== resolved.data.reference) {
    return <Navigate replace to={`/ops/budget/${resolved.data.reference}${tab ? `/${tab}` : ''}${location.search}${location.hash}`} />;
  }
  return <BudgetLinePage nature={resolved.data.nature} />;
}
