import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageHeader from '../components/PageHeader';
import ServerDataGrid, { EnhancedColDef, StatusScope } from '../components/ServerDataGrid';
import { Button, Stack } from '@mui/material';
import CsvExportDialog from '../components/csv/CsvExportDialog';
import CsvImportDialog from '../components/csv/CsvImportDialog';
import { useAuth } from '../auth/AuthContext';
import { LinkCellRenderer } from '../components/grid/renderers';
import { statusColumnProps } from '../components/grid/statusColumn';
import ForbiddenPage from './ForbiddenPage';

type ContractRow = {
  id: string;
  name: string;
  status: string;
  disabled_at?: string | null;
  company?: { id: string; name: string } | null;
  supplier?: { id: string; name: string } | null;
  owner_user_id?: string | null;
  start_date: string;
  duration_months: number;
  auto_renewal: boolean;
  notice_period_months: number;
  yearly_amount_at_signature: number;
  currency: string;
  billing_frequency: 'monthly' | 'quarterly' | 'annual' | 'other';
  notes?: string | null;
  end_date?: string;
  cancellation_deadline?: string;
  linked_opex_count?: number;
  latest_task?: { id: string; description?: string; status?: string; created_at?: string } | null;
};

function formatNumber(v: any) {
  const n = Number(v ?? 0);
  if (!isFinite(n)) return '';
  const i = Math.round(n);
  return i.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

export default function ContractsPage() {
  const { hasLevel } = useAuth();
  const { t } = useTranslation(['ops', 'common']);

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const lastQueryRef = useRef<{ sort: string; q: string; filters: any; statusScope?: StatusScope } | null>(null);

  const handleNew = () => {
    const sp = new URLSearchParams(searchParams);
    navigate(`/ops/contracts/new/overview?${sp.toString()}`);
  };

  // The grid's sort, search, filters and status scope, so prev/next in the workspace walks the same set.
  const getContractHref = useCallback((row: ContractRow) => {
    const sp = new URLSearchParams(searchParams);
    const state = lastQueryRef.current;
    if (state?.sort) sp.set('sort', state.sort);
    if (state?.q) sp.set('q', state.q);
    if (state?.filters && Object.keys(state.filters).length > 0) sp.set('filters', JSON.stringify(state.filters));
    if (state?.statusScope) sp.set('scope', state.statusScope);
    return `/ops/contracts/${row.id}/overview?${sp.toString()}`;
  }, [searchParams]);

  const columns: EnhancedColDef<ContractRow>[] = useMemo(() => [
    {
      field: 'name',
      headerName: t('contracts.columns.contract'),
      flex: 1,
      minWidth: 220,
      required: true,
      cellRenderer: (params: any) => (
        <LinkCellRenderer
          {...params}
          linkType="internal"
          getHref={getContractHref}
          onNavigate={(href) => navigate(href)}
        />
      ),
    },
    {
      colId: 'supplier_name',
      headerName: t('contracts.columns.supplier'),
      width: 180,
      valueGetter: (p) => p.data?.supplier?.name || '',
      cellRenderer: (params: any) => (
        <LinkCellRenderer
          {...params}
          linkType="internal"
          getHref={getContractHref}
          onNavigate={(href) => navigate(href)}
        />
      ),
    },
    {
      colId: 'company_name',
      headerName: t('contracts.columns.company'),
      width: 180,
      valueGetter: (p) => p.data?.company?.name || '',
      cellRenderer: (params: any) => (
        <LinkCellRenderer
          {...params}
          linkType="internal"
          getHref={getContractHref}
          onNavigate={(href) => navigate(href)}
        />
      ),
    },
    { field: 'start_date', headerName: t('contracts.columns.start'), width: 120 },
    { field: 'duration_months', headerName: t('contracts.columns.durationMonths'), width: 130, type: 'rightAligned' },
    { field: 'auto_renewal', headerName: t('contracts.columns.autoRenewal'), width: 130, valueFormatter: (p) => p.value ? t('shared.yes') : t('shared.no') },
    { field: 'notice_period_months', headerName: t('contracts.columns.noticeMonths'), width: 120, type: 'rightAligned' },
    { field: 'end_date', headerName: t('contracts.columns.end'), width: 120 },
    { field: 'cancellation_deadline', headerName: t('contracts.columns.cancelBy'), width: 140 },
    { field: 'yearly_amount_at_signature', headerName: t('contracts.columns.yearlyAmount'), width: 150, type: 'rightAligned', valueFormatter: (p) => formatNumber(p.value) },
    { field: 'currency', headerName: t('contracts.columns.currency'), width: 90 },
    { field: 'billing_frequency', headerName: t('contracts.columns.billing'), width: 120 },
    {
      colId: 'linked_opex_count',
      headerName: t('contracts.columns.linkedOpex'),
      width: 140,
      valueGetter: (p) => p.data?.linked_opex_count ?? 0,
      cellRenderer: (params: any) => (
        <LinkCellRenderer
          {...params}
          linkType="internal"
          getHref={getContractHref}
          onNavigate={(href) => navigate(href)}
        />
      ),
    },
    {
      field: 'status',
      headerName: t('master-data:shared.columns.status'),
      width: 140,
      ...statusColumnProps(t),
      cellRenderer: (params: any) => (
        <LinkCellRenderer
          {...params}
          linkType="internal"
          getHref={getContractHref}
          onNavigate={(href) => navigate(href)}
        />
      ),
    },
    { colId: 'latest_task_text', headerName: t('contracts.columns.task'), flex: 1, minWidth: 200, defaultHidden: true, valueGetter: (p) => {
      const t = p.data?.latest_task; if (!t) return ''; const s = t.status || ''; const d = (t.description || '').toString(); const short = d.length > 40 ? `${d.slice(0,40)}…` : d; return s ? `${s}: ${short}` : short;
    } },
  ], [getContractHref, navigate, t]);

  // After every hook, so the hook order never depends on the permission.
  if (!hasLevel('contracts', 'reader')) {
    return <ForbiddenPage />;
  }

  const canCreate = hasLevel('contracts','manager');
  const canAdmin = hasLevel('contracts','admin');
  const actions = (
    <Stack direction="row" spacing={1}>
      {canCreate && <Button variant="contained" onClick={handleNew}>{t('contracts.newButton')}</Button>}
      {canAdmin && <Button onClick={() => setImportOpen(true)}>{t('contracts.importCsv')}</Button>}
      {canAdmin && <Button onClick={() => setExportOpen(true)}>{t('contracts.exportCsv')}</Button>}
    </Stack>
  );

  return (
    <>
      <PageHeader title={t("contracts.title")} actions={actions} />
      <ServerDataGrid<ContractRow>
        columns={columns}
        endpoint="/contracts"
        queryKey="contracts"
        getRowId={(r) => r.id}
        enableSearch={true}
        defaultSort={{ field: 'cancellation_deadline', direction: 'ASC' }}
        refreshKey={refreshKey}
        columnPreferencesKey="contracts-grid"
        // Lists active contracts by default; "All" or "Disabled" reaches those past their end of validity.
        statusScopeConfig={{ defaultScope: 'enabled' }}
        onQueryStateChange={(state) => {
          lastQueryRef.current = {
            sort: state.sort,
            q: state.q || '',
            filters: state.filterModel || {},
            statusScope: state.statusScope ?? 'enabled',
          };
        }}
      />

      <CsvExportDialog open={exportOpen} onClose={() => setExportOpen(false)} endpoint="/contracts" title={t("contracts.exportTitle")} />
      <CsvImportDialog open={importOpen} onClose={() => setImportOpen(false)} endpoint="/contracts" title={t("contracts.importTitle")} onImported={() => setRefreshKey(k => k + 1)} />
    </>
  );
}
