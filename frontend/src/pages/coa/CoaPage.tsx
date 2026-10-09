import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Box, Button, Stack, Tooltip, Typography } from '@mui/material';
import { ChipToggleContextLine } from '../../components/ChipToggleBar';
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
import { coaCoverage, coaRoleLabels, useCountryName } from './coaRoles';
import { tealLinkSx } from '../../theme/formSx';
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
  /** Null when the tenant has no consolidation chart. */
  consolidation_status?: 'mapped' | 'outside' | 'unmapped' | null;
  created_at?: string;
  status?: string;
};

/** The grid filter driven by the consolidation health line (`?consolidation=` in the address). */
type ConsolidationFilter = 'outside' | 'unmapped';

function parseConsolidationFilter(raw: string | null): ConsolidationFilter | undefined {
  return raw === 'outside' || raw === 'unmapped' ? raw : undefined;
}

const attentionDotSx = {
  display: 'inline-block',
  width: 6,
  height: 6,
  borderRadius: '50%',
  bgcolor: 'kanap.orange',
  flexShrink: 0,
} as const;

/** A clickable sentence that stays neutral (charter: no teal on content), underlined on hover or when active. */
const neutralLinkSx = (active: boolean) => ({
  background: 'none',
  border: 'none',
  p: 0,
  font: 'inherit',
  color: 'kanap.text.primary',
  fontWeight: active ? 500 : 400,
  cursor: 'pointer',
  textAlign: 'left' as const,
  textDecoration: active ? 'underline' : 'none',
  textUnderlineOffset: '2px',
  '&:hover': { textDecoration: 'underline' },
  '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: '2px', borderRadius: '2px' },
});

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
  const countryName = useCountryName();

  const canRead = hasLevel('accounts', 'reader');
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
  const consolidationChart = useMemo(() => coas.find((item) => item.is_consolidation), [coas]);
  const consolidationCode = consolidationChart?.code;
  // The filter only means something against a consolidation chart, on another chart than it.
  const consolidationFilter = consolidationChart && selectedCoa && !selectedCoa.is_consolidation
    ? parseConsolidationFilter(searchParams.get('consolidation'))
    : undefined;
  const extraParams = useMemo(
    () => ({
      coaId: selectedCoaId,
      ...(consolidationFilter ? { consolidationStatus: consolidationFilter } : {}),
    }),
    [selectedCoaId, consolidationFilter],
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
    if (consolidationFilter) params.set('consolidation', consolidationFilter);
    return params;
  }, [consolidationFilter, selectedCoaId]);

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
      cellRenderer: (params: any) => {
        // Flag only against a real consolidation chart: without one, the summary line says so once.
        const outside = !!consolidationCode && params.data?.consolidation_status === 'outside';
        const label = outside ? t('coa.outsideMarker', { code: consolidationCode }) : '';
        return (
          <LinkCellRenderer
            {...params}
            linkType="internal"
            getHref={getAccountHref}
            onNavigate={(href) => navigate(href)}
            // Inside the cell, right after the number.
            endAdornment={outside ? (
              <Tooltip title={label}>
                <Box component="span" role="img" aria-label={label} sx={{ ...attentionDotSx, ml: '2px' }} />
              </Tooltip>
            ) : undefined}
          />
        );
      },
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
  ], [consolidationCode, getAccountHref, locale, navigate, t]);

  const updateSelectedCoa = useCallback((coaId: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('selected', coaId);
    next.delete('coaId');
    // The consolidation filter belongs to one chart's health line.
    next.delete('consolidation');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const setConsolidationFilter = useCallback((value: ConsolidationFilter | undefined) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set('consolidation', value);
    else next.delete('consolidation');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const renderConsolidationHealth = (coa: CoaListItem) => {
    if (!consolidationChart) {
      return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: 13, color: 'kanap.text.secondary' }}>
          <Box component="span" sx={attentionDotSx} />
          <span>
            {t('coa.health.noConsolidationChart')}
            {canManage && (
              <>
                {' '}
                <Box component="button" type="button" onClick={() => setManageOpen(true)} sx={{ ...tealLinkSx, fontSize: 13 }}>
                  {t('coa.health.chooseConsolidationChart')}
                </Box>
              </>
            )}
          </span>
        </Box>
      );
    }
    // The consolidation chart's own accounts are the group accounts: nothing to map.
    if (coa.is_consolidation) return null;
    const outside = coa.accounts_outside_count ?? 0;
    const unmapped = coa.accounts_unmapped_count ?? 0;
    const showAll = consolidationFilter ? (
      <>
        <span aria-hidden>·</span>
        <Box component="button" type="button" onClick={() => setConsolidationFilter(undefined)} sx={{ ...tealLinkSx, fontSize: 13 }}>
          {t('coa.health.showAll')}
        </Box>
      </>
    ) : null;
    if (outside === 0 && unmapped === 0) {
      // A filter left from before the accounts were remapped keeps its way back.
      if ((coa.accounts_count ?? 0) === 0 && !consolidationFilter) return null;
      return (
        <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: '8px', fontSize: 13, color: 'kanap.text.tertiary' }}>
          <span>{t('coa.health.allMapped', { code: consolidationChart.code })}</span>
          {showAll}
        </Box>
      );
    }
    const parts: Array<{ key: ConsolidationFilter; label: string }> = [];
    if (outside > 0) parts.push({ key: 'outside', label: t('coa.health.outside', { count: outside, code: consolidationChart.code }) });
    if (unmapped > 0) parts.push({ key: 'unmapped', label: t('coa.health.unmapped', { count: unmapped }) });
    return (
      <Box
        data-testid="coa-consolidation-health"
        sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: '8px', rowGap: '2px', fontSize: 13, color: 'kanap.text.secondary' }}
      >
        <Box component="span" sx={attentionDotSx} />
        {parts.map((part, index) => (
          <React.Fragment key={part.key}>
            {index > 0 && <span aria-hidden>·</span>}
            <Box
              component="button"
              type="button"
              aria-pressed={consolidationFilter === part.key}
              onClick={() => setConsolidationFilter(consolidationFilter === part.key ? undefined : part.key)}
              sx={neutralLinkSx(consolidationFilter === part.key)}
            >
              {part.label}
            </Box>
          </React.Fragment>
        ))}
        {showAll}
      </Box>
    );
  };

  // After every hook: the hook count stays the same whatever the access level.
  if (!canRead) {
    return <ForbiddenPage />;
  }

  const accountActions = (canCreateAccount || canAdmin) && (
    <>
      {canCreateAccount && (
        <Button
          variant="action-primary"
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
        <Button variant="action" onClick={() => setImportOpen(true)} disabled={!selectedCoaId}>
          {t('shared.labels.importCsv')}
        </Button>
      )}
      {canAdmin && (
        <Button variant="action" onClick={() => setExportOpen(true)} disabled={!selectedCoaId}>
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
    </>
  );

  return (
    <>
      <PageHeader title={t('coa.title')} />
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
          <ChipToggleContextLine
            testId="coa-summary"
            title={`${selectedCoa.code} · ${t('coa.accountCount', { count: selectedCoa.accounts_count ?? 0 })}`}
            actions={accountActions}
          >
            <Typography variant="body2" color="text.secondary">
              {[
                selectedCoa.name,
                coaCoverage(selectedCoa, t, countryName),
                ...coaRoleLabels(selectedCoa, t, countryName),
              ].join(' · ')}
            </Typography>
            {renderConsolidationHealth(selectedCoa)}
          </ChipToggleContextLine>
        )}

        {isLoading && <Alert severity="info">{t('coa.loadingCoA')}</Alert>}

        {coas.length > 0 && selectedCoaId && (
          <ServerDataGrid<AccountRow>
            // The grid keeps its status scope internally: remount it so a consolidation filter shows
            // every status ("all", as the counts of the health line do) and its reset goes back to
            // enabled accounts.
            key={consolidationFilter ? 'consolidation-filter' : 'no-filter'}
            columns={columns}
            endpoint="/accounts"
            queryKey="accounts"
            extraParams={extraParams}
            getRowId={(row) => row.id}
            enableSearch
            defaultSort={{ field: 'account_number', direction: 'ASC' }}
            refreshKey={accountsRefreshKey}
            columnPreferencesKey="accounts"
            enableColumnChooser={true}
            statusScopeConfig={{ defaultScope: consolidationFilter ? 'all' : 'enabled' }}
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
          setAccountsRefreshKey((key) => key + 1);
        }}
        onCoaUpdated={() => {
          void refetch();
          // Role changes move accounts in or out of the consolidation chart.
          setAccountsRefreshKey((key) => key + 1);
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
