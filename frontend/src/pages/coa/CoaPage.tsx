import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import ServerDataGrid, { EnhancedColDef, StatusScope } from '../../components/ServerDataGrid';
import CsvExportDialog from '../../components/csv/CsvExportDialog';
import CsvImportDialog from '../../components/csv/CsvImportDialog';
import DeleteSelectedButton from '../../components/DeleteSelectedButton';
import ForbiddenPage from '../ForbiddenPage';
import { useAuth } from '../../auth/AuthContext';
import { LinkCellRenderer } from '../../components/grid/renderers';
import { useLocale } from '../../i18n/useLocale';
import { formatShortDateTime } from '../../lib/dateFormat';
import CoaChipBar from './CoaChipBar';
import CreateCoADialog from './CreateCoADialog';
import ManageCoAsDialog from './ManageCoAsDialog';
import { CoaListItem, useCoaList } from './useCoaList';
import { statusColumnProps } from '../../components/grid/statusColumn';

type AccountRow = {
  id: string;
  account_number: number | string;
  account_name: string;
  native_name?: string | null;
  description?: string | null;
  consolidation_account_number?: number | null;
  consolidation_account_name?: string | null;
  consolidation_account_description?: string | null;
  created_at?: string;
  status?: string;
};

function pickFallbackCoaId(coas: CoaListItem[]): string | undefined {
  return (
    coas.find((item) => item.is_default)?.id ||
    coas.find((item) => item.is_global_default)?.id ||
    coas[0]?.id
  );
}

export default function CoaPage() {
  const navigate = useNavigate();
  const { t } = useTranslation(['master-data', 'common']);
  const locale = useLocale();
  const [searchParams, setSearchParams] = useSearchParams();
  const { hasLevel } = useAuth();
  const { coas, isLoading, refetch, isError } = useCoaList();

  if (!hasLevel('accounts', 'reader')) {
    return <ForbiddenPage />;
  }

  const canManage = hasLevel('accounts', 'manager');
  const canAdmin = hasLevel('accounts', 'admin');
  const canCreateAccount = hasLevel('accounts', 'manager');

  const selectedFromUrl = searchParams.get('selected') || searchParams.get('coaId') || '';
  const selectedCoaId = useMemo(() => {
    if (!selectedFromUrl) return undefined;
    return coas.some((item) => item.id === selectedFromUrl) ? selectedFromUrl : undefined;
  }, [coas, selectedFromUrl]);
  const selectedCoa = useMemo(
    () => coas.find((item) => item.id === selectedCoaId),
    [coas, selectedCoaId],
  );

  useEffect(() => {
    if (coas.length === 0) return;
    const currentSelected = searchParams.get('selected');
    const hasLegacyParam = searchParams.has('coaId');

    if (selectedCoaId) {
      if (hasLegacyParam) {
        const next = new URLSearchParams(searchParams);
        next.set('selected', selectedCoaId);
        next.delete('coaId');
        setSearchParams(next, { replace: true });
      }
      return;
    }

    const fallbackCoaId = pickFallbackCoaId(coas);
    if (!fallbackCoaId) return;
    if (currentSelected === fallbackCoaId && !hasLegacyParam) return;
    const next = new URLSearchParams(searchParams);
    next.set('selected', fallbackCoaId);
    next.delete('coaId');
    setSearchParams(next, { replace: true });
  }, [coas, searchParams, selectedCoaId, setSearchParams]);

  const [accountsRefreshKey, setAccountsRefreshKey] = useState(0);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [createCoaOpen, setCreateCoaOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [selectedRows, setSelectedRows] = useState<AccountRow[]>([]);
  const gridApiRef = useRef<any>(null);

  useEffect(() => {
    setSelectedRows([]);
    setAccountsRefreshKey((key) => key + 1);
  }, [selectedCoaId]);

  const lastQueryRef = useRef<{ sort: string; q: string; filters: any; statusScope?: StatusScope } | null>(null);
  const buildWorkspaceSearch = useCallback(() => {
    const params = new URLSearchParams();
    const sort = lastQueryRef.current?.sort || 'account_number:ASC';
    const q = lastQueryRef.current?.q || '';
    const filters = lastQueryRef.current?.filters || {};
    if (sort) params.set('sort', sort);
    if (q) params.set('q', q);
    if (filters && Object.keys(filters).length > 0) params.set('filters', JSON.stringify(filters));
    // The grid's status scope, so prev/next in the workspace walks the same set.
    const statusScope = lastQueryRef.current?.statusScope;
    if (statusScope) params.set('scope', statusScope);
    if (selectedCoaId) {
      params.set('selected', selectedCoaId);
      params.set('coaId', selectedCoaId);
    }
    return params;
  }, [selectedCoaId]);

  const navigateToAccount = useCallback((accountId: string) => {
    const params = buildWorkspaceSearch();
    navigate(`/master-data/accounts/${accountId}/overview?${params.toString()}`);
  }, [buildWorkspaceSearch, navigate]);
  const getAccountHref = useCallback((row: AccountRow) => {
    const params = buildWorkspaceSearch();
    return `/master-data/accounts/${row.id}/overview?${params.toString()}`;
  }, [buildWorkspaceSearch]);

  const columns: EnhancedColDef<AccountRow>[] = useMemo(() => [
    {
      field: 'account_number',
      headerName: t('coa.columns.accountNumber'),
      width: 160,
      required: true,
      cellStyle: { fontFamily: "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace", fontSize: '12px', color: 'var(--kanap-text-secondary)', fontVariantNumeric: 'tabular-nums' },
      cellRenderer: (params: any) => (
        <LinkCellRenderer {...params} linkType="internal" getHref={getAccountHref} onNavigate={(href) => navigate(href)} />
      ),
    },
    {
      field: 'account_name',
      headerName: t('coa.columns.accountName'),
      flex: 1,
      required: true,
      cellRenderer: (params: any) => (
        <LinkCellRenderer {...params} linkType="internal" getHref={getAccountHref} onNavigate={(href) => navigate(href)} />
      ),
    },
    {
      field: 'native_name',
      headerName: t('coa.columns.nativeName'),
      width: 220,
      defaultHidden: true,
      cellRenderer: (params: any) => (
        <LinkCellRenderer {...params} linkType="internal" getHref={getAccountHref} onNavigate={(href) => navigate(href)} />
      ),
    },
    {
      field: 'description',
      headerName: t('shared.columns.description'),
      width: 250,
      defaultHidden: true,
      cellRenderer: (params: any) => (
        <LinkCellRenderer {...params} linkType="internal" getHref={getAccountHref} onNavigate={(href) => navigate(href)} />
      ),
    },
    {
      field: 'consolidation_account_number',
      headerName: t('coa.columns.consolAccountNumber'),
      width: 180,
      cellStyle: { fontFamily: "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace", fontSize: '12px', color: 'var(--kanap-text-secondary)', fontVariantNumeric: 'tabular-nums' },
      cellRenderer: (params: any) => (
        <LinkCellRenderer {...params} linkType="internal" getHref={getAccountHref} onNavigate={(href) => navigate(href)} />
      ),
    },
    {
      field: 'consolidation_account_name',
      headerName: t('coa.columns.consolAccountName'),
      width: 250,
      cellRenderer: (params: any) => (
        <LinkCellRenderer {...params} linkType="internal" getHref={getAccountHref} onNavigate={(href) => navigate(href)} />
      ),
    },
    {
      field: 'consolidation_account_description',
      headerName: t('coa.columns.consolDescription'),
      width: 300,
      defaultHidden: true,
      cellRenderer: (params: any) => (
        <LinkCellRenderer {...params} linkType="internal" getHref={getAccountHref} onNavigate={(href) => navigate(href)} />
      ),
    },
    {
      field: 'status',
      headerName: t('shared.columns.status'),
      width: 140,
      ...statusColumnProps(t),
      cellRenderer: (params: any) => (
        <LinkCellRenderer {...params} linkType="internal" getHref={getAccountHref} onNavigate={(href) => navigate(href)} />
      ),
      defaultHidden: true,
    },
    {
      field: 'created_at',
      headerName: t('shared.columns.created'),
      width: 200,
      valueFormatter: (p: any) => formatShortDateTime(p.value as string | null, locale),
      defaultHidden: true,
      cellRenderer: (params: any) => (
        <LinkCellRenderer {...params} linkType="internal" getHref={getAccountHref} onNavigate={(href) => navigate(href)} />
      ),
    },
  ], [getAccountHref, locale, navigate, t]);

  const updateSelectedCoa = useCallback((coaId: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('selected', coaId);
    next.delete('coaId');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const actions = (
    <Stack direction="row" spacing={1}>
      {canCreateAccount && (
        <Button
          variant="contained"
          onClick={() => {
            const params = buildWorkspaceSearch();
            navigate(`/master-data/accounts/new/overview?${params.toString()}`);
          }}
          disabled={!selectedCoaId}
        >
          {t('coa.newAccount')}
        </Button>
      )}
      {canAdmin && (
        <Button onClick={() => setImportOpen(true)} disabled={!selectedCoaId}>
          {t('shared.labels.importCsv')}
        </Button>
      )}
      {canAdmin && (
        <Button onClick={() => setExportOpen(true)} disabled={!selectedCoaId}>
          {t('shared.labels.exportCsv')}
        </Button>
      )}
      {canAdmin && (
        <DeleteSelectedButton
          selectedRows={selectedRows}
          endpoint="/accounts/bulk"
          getItemId={(row) => row.id}
          getItemName={(row) => row.account_name}
          gridApi={gridApiRef.current}
          onDeleteSuccess={() => setAccountsRefreshKey((key) => key + 1)}
        />
      )}
    </Stack>
  );

  return (
    <>
      <PageHeader title={t('coa.title')} actions={actions} />
      <Stack spacing={2}>
        {isError && (
          <Alert severity="error">
            {t('coa.loadError')}
          </Alert>
        )}

        {!isLoading && (
          <CoaChipBar
            coas={coas}
            selectedCoaId={selectedCoaId}
            onSelect={updateSelectedCoa}
            onCreate={() => setCreateCoaOpen(true)}
            onManage={() => setManageOpen(true)}
            canManage={canManage}
          />
        )}

        {!!selectedCoa && (
          <Stack spacing={0.5}>
            <Typography variant="h6">
              {selectedCoa.code} · {selectedCoa.accounts_count ?? 0} {t('coa.accounts')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {selectedCoa.name}
              {selectedCoa.scope === 'COUNTRY' && selectedCoa.country_iso ? ` · ${selectedCoa.country_iso}` : ''}
            </Typography>
          </Stack>
        )}

        {isLoading && <Alert severity="info">{t('coa.loadingCoA')}</Alert>}

        {coas.length > 0 && selectedCoaId && (
          <ServerDataGrid<AccountRow>
            columns={columns}
            endpoint="/accounts"
            queryKey="accounts"
            extraParams={{ coaId: selectedCoaId }}
            getRowId={(row) => row.id}
            enableSearch
            defaultSort={{ field: 'account_number', direction: 'ASC' }}
            refreshKey={accountsRefreshKey}
            columnPreferencesKey="accounts"
            enableColumnChooser={true}
            statusScopeConfig={{ defaultScope: 'enabled' }}
            requiredColumns={['account_number', 'account_name']}
            defaultHiddenColumns={['description', 'consolidation_account_description', 'created_at']}
            enableRowSelection={canAdmin}
            onSelectionChanged={setSelectedRows}
            onGridApiReady={(apiInstance) => {
              gridApiRef.current = apiInstance;
            }}
            onQueryStateChange={(state) => {
              lastQueryRef.current = {
                sort: state.sort,
                q: state.q || '',
                filters: state.filterModel || {},
                statusScope: state.statusScope,
              };
            }}
          />
        )}
      </Stack>

      <CreateCoADialog
        open={createCoaOpen}
        onClose={() => setCreateCoaOpen(false)}
        onCreated={(newId) => {
          setCreateCoaOpen(false);
          updateSelectedCoa(newId);
          void refetch();
        }}
      />

      <ManageCoAsDialog
        open={manageOpen}
        onClose={() => {
          setManageOpen(false);
          void refetch();
        }}
        onCoaCreated={(newId) => {
          updateSelectedCoa(newId);
          void refetch();
        }}
        onCoaDeleted={() => {
          void refetch();
        }}
        onCoaUpdated={() => {
          void refetch();
        }}
      />

      <CsvExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        endpoint={selectedCoaId ? `/chart-of-accounts/${selectedCoaId}/accounts` : '/accounts'}
        title={t('coa.exportAccounts')}
        flexibleFormat
      />
      <CsvImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        endpoint={selectedCoaId ? `/chart-of-accounts/${selectedCoaId}/accounts` : '/accounts'}
        title={t('coa.importAccounts')}
        onImported={() => setAccountsRefreshKey((key) => key + 1)}
        flexibleFormat
      />
    </>
  );
}
