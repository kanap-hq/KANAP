import React, { useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import PageHeader from '../components/PageHeader';
import ServerDataGrid, { EnhancedColDef } from '../components/ServerDataGrid';
import { Button } from '@mui/material';
import CheckboxSetFilter from '../components/CheckboxSetFilter';
import CheckboxSetFloatingFilter from '../components/CheckboxSetFloatingFilter';
import { STATUS_VALUES } from '../constants/status';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { LinkCellRenderer } from '../components/grid/renderers';
import { useLocale } from '../i18n/useLocale';
import { formatShortDateTime } from '../lib/dateFormat';
import ForbiddenPage from './ForbiddenPage';

interface AnalyticsCategoryRow {
  id: string;
  name: string;
  description?: string | null;
  status: string;
  disabled_at?: string | null;
  updated_at?: string;
}

export default function AnalyticsCategoriesPage() {
  const { t } = useTranslation(['master-data', 'common']);
  const locale = useLocale();
  const navigate = useNavigate();
  const { hasLevel } = useAuth();
  const lastQueryRef = useRef<{ sort: string; q: string; filters: any } | null>(null);

  if (!hasLevel('analytics', 'reader')) {
    return <ForbiddenPage />;
  }

  const buildWorkspaceSearch = useCallback(() => {
    const sp = new URLSearchParams();
    const sort = lastQueryRef.current?.sort || 'name:ASC';
    const q = lastQueryRef.current?.q || '';
    const filters = lastQueryRef.current?.filters || {};
    if (sort) sp.set('sort', sort);
    if (q) sp.set('q', q);
    if (filters && Object.keys(filters).length > 0) sp.set('filters', JSON.stringify(filters));
    return sp;
  }, []);

  const columns = useMemo<EnhancedColDef<AnalyticsCategoryRow>[]>(() => {
    const getAnalyticsHref = (row: AnalyticsCategoryRow) => {
      const sp = buildWorkspaceSearch();
      return `/master-data/analytics/${row.id}/overview?${sp.toString()}`;
    };

    return [
      {
        field: 'name',
        headerName: t('shared.columns.name'),
        flex: 1,
        cellRenderer: (params: any) => (
          <LinkCellRenderer
            {...params}
            linkType="internal"
            getHref={getAnalyticsHref}
            onNavigate={(href) => navigate(href)}
          />
        ),
      },
      {
        field: 'description',
        headerName: t('shared.columns.description'),
        flex: 1,
        cellRenderer: (params: any) => (
          <LinkCellRenderer
            {...params}
            linkType="internal"
            getHref={getAnalyticsHref}
            onNavigate={(href) => navigate(href)}
          />
        ),
      },
      {
        field: 'status',
        headerName: t('shared.columns.status'),
        width: 140,
        cellRenderer: (params: any) => (
          <LinkCellRenderer
            {...params}
            linkType="internal"
            getHref={getAnalyticsHref}
            onNavigate={(href) => navigate(href)}
          />
        ),
        filter: CheckboxSetFilter,
        floatingFilterComponent: CheckboxSetFloatingFilter,
        filterParams: {
          values: STATUS_VALUES.map((value) => ({ value, label: t(`common:statuses.${value}`) })),
          searchable: false,
        },
      },
      {
        field: 'updated_at',
        headerName: t('shared.columns.updated'),
        width: 200,
        valueFormatter: (p) => formatShortDateTime(p.value as string | null, locale),
        cellRenderer: (params: any) => (
          <LinkCellRenderer
            {...params}
            linkType="internal"
            getHref={getAnalyticsHref}
            onNavigate={(href) => navigate(href)}
          />
        ),
      },
    ];
  }, [buildWorkspaceSearch, locale, navigate, t]);

  return (
    <>
      <PageHeader
        title={t("analytics.title")}
        actions={hasLevel('analytics', 'member') ? [
          <Button key="new" variant="contained" onClick={() => {
            const sp = buildWorkspaceSearch();
            navigate(`/master-data/analytics/new/overview?${sp.toString()}`);
          }}>
            {t('analytics.newCategory')}
          </Button>,
        ] : []}
      />
      <ServerDataGrid<AnalyticsCategoryRow>
        endpoint="/analytics-categories"
        queryKey="analytics-categories"
        columns={columns}
        getRowId={(row) => row.id}
        enableSearch
        defaultSort={{ field: 'name', direction: 'ASC' }}
        onQueryStateChange={(state) => {
          lastQueryRef.current = { sort: state.sort, q: state.q || '', filters: state.filterModel || {} };
        }}
      />

    </>
  );
}
