import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import PageHeader from '../../components/PageHeader';
import ServerDataGrid, { EnhancedColDef } from '../../components/ServerDataGrid';
import ForbiddenPage from '../ForbiddenPage';
import { useAuth } from '../../auth/AuthContext';
import api from '../../api';
import CheckboxSetFilter from '../../components/CheckboxSetFilter';
import CheckboxSetFloatingFilter from '../../components/CheckboxSetFloatingFilter';
import { useLocale } from '../../i18n/useLocale';
import { formatShortDateTime } from '../../lib/dateFormat';
import { getWithListContext, withListContext } from '../../lib/listContext';
import { downloadBlob, extractFilenameFromDisposition } from '../../utils/downloadBlob';
import {
  AUTH_EVENT_TABLE,
  EXPORT_EVENT_TABLE,
  auditReasonLabel,
  auditTableFilterLabel,
  auditTableLabel,
  auditUserLabel,
} from './auditLogLabels';

type AuditLogItem = {
  id: string;
  tenant_id: string;
  table_name: string;
  record_id: string | null;
  action: string;
  before_json: any | null;
  after_json: any | null;
  user_id: string | null;
  user_email: string | null;
  user_name: string | null;
  source: string;
  source_ref: string | null;
  created_at: string;
};

/** The header the server sets on an export that stopped at its row limit (the limit). */
const EXPORT_TRUNCATED_HEADER = 'x-export-truncated';
/** Plain text in the secondary colour, like the other text columns of the grid. */
const SECONDARY_CELL_STYLE: Record<string, string> = { color: 'var(--kanap-text-secondary)' };

function formatJson(value: any): string {
  if (value == null) return 'null';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function getChangedKeys(beforeValue: any, afterValue: any): string[] {
  if (!beforeValue && !afterValue) return [];
  const beforeObj = beforeValue && typeof beforeValue === 'object' ? beforeValue : {};
  const afterObj = afterValue && typeof afterValue === 'object' ? afterValue : {};
  const keys = new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)]);
  return Array.from(keys).filter((key) => {
    return JSON.stringify(beforeObj[key]) !== JSON.stringify(afterObj[key]);
  });
}

export default function AuditLogsPage() {
  const { hasLevel } = useAuth();
  const { t } = useTranslation(['admin']);
  const locale = useLocale();
  const [open, setOpen] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [selectedRow, setSelectedRow] = React.useState<AuditLogItem | null>(null);
  const lastQueryRef = React.useRef<{ sort: string; filterModel: any; q: string } | null>(null);
  const [exporting, setExporting] = React.useState(false);
  const [exportNotice, setExportNotice] = React.useState<{ severity: 'info' | 'error'; text: string } | null>(null);

  // The rows the list shows (its filters, search and sort), as a CSV file made by the server.
  const handleExport = React.useCallback(async () => {
    setExporting(true);
    setExportNotice(null);
    try {
      const state = lastQueryRef.current;
      const params: Record<string, unknown> = {};
      if (state?.sort) params.sort = state.sort;
      if (state?.q) params.q = state.q;
      if (state?.filterModel && Object.keys(state.filterModel).length > 0) params.filters = JSON.stringify(state.filterModel);
      // Filters too long for a URL go as the list's saved context.
      const sent = await withListContext('/audit-logs', params);
      const res = await api.get<Blob>('/audit-logs/export', { params: sent, responseType: 'blob' });
      const headers = (res.headers ?? {}) as Record<string, unknown>;
      const disposition = (headers['content-disposition'] ?? headers['Content-Disposition']) as string | undefined;
      const filename = extractFilenameFromDisposition(disposition) || 'audit-log.csv';
      downloadBlob(new Blob([res.data], { type: 'text/csv;charset=utf-8' }), filename);
      const limit = Number(headers[EXPORT_TRUNCATED_HEADER] ?? headers['X-Export-Truncated']);
      if (Number.isFinite(limit) && limit > 0) {
        setExportNotice({ severity: 'info', text: t('auditLogs.export.truncated', { limit: limit.toLocaleString(locale) }) });
      }
    } catch (error: any) {
      const status = error?.response?.status;
      setExportNotice({ severity: 'error', text: t(status === 429 ? 'auditLogs.export.tooMany' : 'auditLogs.export.failed') });
    } finally {
      setExporting(false);
    }
  }, [locale, t]);

  const detailQuery = useQuery({
    queryKey: ['audit-log-entry', selectedId],
    queryFn: async () => {
      if (!selectedId) throw new Error('Missing audit log id');
      const res = await api.get<AuditLogItem>(`/audit-logs/${selectedId}`);
      return res.data;
    },
    enabled: open && !!selectedId,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  const detail = detailQuery.data ?? selectedRow;
  const changedKeys = React.useMemo(() => {
    if (!detail) return [];
    return getChangedKeys(detail.before_json, detail.after_json);
  }, [detail]);

  const getFilterValues = React.useCallback((field: 'table_name' | 'action' | 'source') => {
    return async ({ context }: any) => {
      const queryState = context?.getQueryState?.() ?? {};
      const filters = { ...(queryState.filters || {}) };
      delete filters[field];
      const params: Record<string, any> = {
        fields: field,
      };
      if (queryState.q) params.q = queryState.q;
      if (Object.keys(filters).length > 0) {
        params.filters = JSON.stringify(filters);
      }
      const res = await getWithListContext(`/audit-logs/filter-values`, params);
      const values = (res.data?.[field] || []) as Array<string | null>;
      return values.map((value) => ({ value }));
    };
  }, []);

  const columns = React.useMemo<EnhancedColDef<AuditLogItem>[]>(() => {
    return [
      {
        field: 'created_at',
        headerName: t('auditLogs.columns.date'),
        width: 180,
        filter: 'agDateColumnFilter',
        valueFormatter: (p: any) => formatShortDateTime(p.value as string | null, locale),
      },
      {
        field: 'table_name',
        headerName: t('auditLogs.columns.table'),
        width: 160,
        filter: CheckboxSetFilter,
        floatingFilterComponent: CheckboxSetFloatingFilter,
        filterParams: {
          getValues: getFilterValues('table_name'),
          labelFormatter: (value: string | null) => auditTableFilterLabel(value, t),
        },
        valueFormatter: (p: any) => auditTableLabel(p.data, t),
      },
      {
        field: 'action',
        headerName: t('auditLogs.columns.action'),
        width: 130,
        filter: CheckboxSetFilter,
        floatingFilterComponent: CheckboxSetFloatingFilter,
        filterParams: {
          getValues: getFilterValues('action'),
          labelFormatter: (value: string | null) => (value ? t(`auditLogs.actions.${value}`, { defaultValue: value }) : t('auditLogs.shared.empty')),
          searchable: false,
        },
        valueFormatter: (p: any) => {
          const value = String(p.value || '').toLowerCase();
          return value ? t(`auditLogs.actions.${value}`, { defaultValue: value }) : t('auditLogs.shared.empty');
        },
        cellStyle: SECONDARY_CELL_STYLE,
      },
      {
        field: 'source',
        headerName: t('auditLogs.columns.source'),
        width: 130,
        filter: CheckboxSetFilter,
        floatingFilterComponent: CheckboxSetFloatingFilter,
        filterParams: {
          getValues: getFilterValues('source'),
          labelFormatter: (value: string | null) => t(`auditLogs.sources.${value || 'system'}`, { defaultValue: value || 'system' }),
          searchable: false,
        },
        valueFormatter: (p: any) => {
          const value = String(p.value || 'system').toLowerCase();
          return t(`auditLogs.sources.${value}`, { defaultValue: value });
        },
        cellStyle: SECONDARY_CELL_STYLE,
      },
      {
        field: 'record_id',
        headerName: t('auditLogs.columns.recordId'),
        width: 170,
        defaultHidden: true,
        cellStyle: { fontFamily: "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace", fontSize: '12px', color: 'var(--kanap-text-secondary)', fontVariantNumeric: 'tabular-nums' },
        valueFormatter: (p: any) => {
          const value = String(p.value || '');
          if (!value) return '';
          return value.length > 12 ? `${value.slice(0, 8)}...` : value;
        },
      },
      {
        field: 'user_email',
        headerName: t('auditLogs.columns.user'),
        width: 220,
        valueGetter: (p: any) => auditUserLabel(p.data, t),
      },
      {
        field: 'user_id',
        headerName: t('auditLogs.columns.userId'),
        width: 220,
        defaultHidden: true,
        cellStyle: { fontFamily: "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace", fontSize: '12px', color: 'var(--kanap-text-secondary)', fontVariantNumeric: 'tabular-nums' },
      },
      {
        field: 'user_name',
        headerName: t('auditLogs.columns.userName'),
        width: 180,
        defaultHidden: true,
      },
      {
        field: 'source_ref',
        headerName: t('auditLogs.columns.sourceRef'),
        width: 220,
        defaultHidden: true,
        // A sign-in or session reason reads as text; other references stay technical.
        valueFormatter: (p: any) => auditReasonLabel(p.data, t),
        cellStyle: (p: any): Record<string, string> => (p.data?.table_name === AUTH_EVENT_TABLE
          ? { color: 'var(--kanap-text-secondary)' }
          : { fontFamily: "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace", fontSize: '12px', color: 'var(--kanap-text-secondary)', fontVariantNumeric: 'tabular-nums' }),
      },
      {
        field: 'tenant_id',
        headerName: t('auditLogs.columns.tenantId'),
        width: 220,
        defaultHidden: true,
        cellStyle: { fontFamily: "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace", fontSize: '12px', color: 'var(--kanap-text-secondary)', fontVariantNumeric: 'tabular-nums' },
      },
    ];
  }, [getFilterValues, locale, t]);

  if (!hasLevel('users', 'admin')) {
      return <ForbiddenPage />;
  }

  return (
    <>
      <PageHeader
        title={t('auditLogs.title')}
        actions={(
          <Button variant="action" onClick={() => { void handleExport(); }} disabled={exporting}>
            {t('auditLogs.export.button')}
          </Button>
        )}
      />
      {exportNotice && (
        <Alert severity={exportNotice.severity} onClose={() => setExportNotice(null)} sx={{ mb: 1 }}>
          {exportNotice.text}
        </Alert>
      )}
      <ServerDataGrid<AuditLogItem>
        columns={columns}
        endpoint="/audit-logs"
        queryKey="audit-logs"
        getRowId={(row) => row.id}
        cacheBlockSize={100}
        enablePagination
        paginationPageSize={100}
        enableSearch
        defaultSort={{ field: 'created_at', direction: 'DESC' }}
        columnPreferencesKey="admin-audit-logs"
        enableColumnChooser={true}
        defaultHiddenColumns={['record_id', 'user_id', 'user_name', 'source_ref', 'tenant_id']}
        initialState={{
          sort: { sortModel: [{ colId: 'created_at', sort: 'desc' }] },
        }}
        onQueryStateChange={(state) => {
          lastQueryRef.current = { sort: state.sort, q: state.q || '', filterModel: state.filterModel || {} };
        }}
        onCellClicked={(e: any) => {
          if (!e?.data?.id) return;
          setSelectedRow(e.data as AuditLogItem);
          setSelectedId(String(e.data.id));
          setOpen(true);
        }}
      />

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="xl">
        <DialogTitle>{t('auditLogs.details.title')}</DialogTitle>
        <DialogContent dividers>
          {detailQuery.isLoading && (
            <Box sx={{ py: 4, display: 'flex', justifyContent: 'center' }}>
              <CircularProgress size={24} />
            </Box>
          )}

          {detailQuery.isError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {t('auditLogs.messages.loadDetailsFailed')}
            </Alert>
          )}

          {detail && !detailQuery.isLoading && (
            <Stack spacing={2}>
              <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap alignItems="center">
                <Typography variant="body2" color="text.secondary">{t('auditLogs.details.date', { value: new Date(detail.created_at).toLocaleString(locale) })}</Typography>
                <Typography component="span" variant="body2" sx={{ fontFamily: "'JetBrains Mono Variable', ui-monospace, monospace", fontSize: '12px', color: 'text.secondary' }}>{t('auditLogs.details.table', { value: detail.table_name })}</Typography>
                {detail.table_name === EXPORT_EVENT_TABLE && <Typography variant="body2" color="text.secondary">{t('auditLogs.details.exported', { value: auditTableLabel(detail, t) })}</Typography>}
                <Typography variant="body2" color="text.secondary">{t('auditLogs.details.action', { value: t(`auditLogs.actions.${detail.action}`, { defaultValue: detail.action }) })}</Typography>
                <Typography variant="body2" color="text.secondary">{t('auditLogs.details.source', { value: t(`auditLogs.sources.${detail.source || 'system'}`, { defaultValue: detail.source || 'system' }) })}</Typography>
                {detail.source_ref && detail.table_name === AUTH_EVENT_TABLE && <Typography variant="body2" color="text.secondary">{t('auditLogs.details.reason', { value: auditReasonLabel(detail, t) })}</Typography>}
                {detail.source_ref && detail.table_name !== AUTH_EVENT_TABLE && <Typography component="span" variant="body2" sx={{ fontFamily: "'JetBrains Mono Variable', ui-monospace, monospace", fontSize: '12px', color: 'text.secondary' }}>{t('auditLogs.details.sourceRef', { value: detail.source_ref })}</Typography>}
                <Typography component="span" variant="body2" sx={{ fontFamily: "'JetBrains Mono Variable', ui-monospace, monospace", fontSize: '12px', color: 'text.secondary' }}>{t('auditLogs.details.tenant', { value: detail.tenant_id })}</Typography>
                {detail.record_id && <Typography component="span" variant="body2" sx={{ fontFamily: "'JetBrains Mono Variable', ui-monospace, monospace", fontSize: '12px', color: 'text.secondary' }}>{t('auditLogs.details.recordId', { value: detail.record_id })}</Typography>}
                <Typography variant="body2" color="text.secondary">{t('auditLogs.details.user', { value: auditUserLabel(detail, t) })}</Typography>
              </Stack>

              <Box>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('auditLogs.details.changedFields')}</Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
                  {changedKeys.length === 0 && <Typography variant="body2" color="text.secondary">{t('auditLogs.details.noFieldChanges')}</Typography>}
                  {changedKeys.map((key) => (
                    <Typography key={key} component="span" variant="body2" sx={{ fontFamily: "'JetBrains Mono Variable', ui-monospace, monospace", fontSize: '12px', color: 'text.secondary' }}>{key}</Typography>
                  ))}
                </Stack>
              </Box>

              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
                  gap: 2,
                }}
              >
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('auditLogs.details.before')}</Typography>
                  <Box
                    component="pre"
                    sx={{
                      m: 0,
                      p: 2,
                      borderRadius: 1,
                      border: (theme) => `1px solid ${theme.palette.divider}`,
                      backgroundColor: 'background.default',
                      overflow: 'auto',
                      maxHeight: 420,
                      fontSize: 12,
                    }}
                  >
                    {formatJson(detail.before_json)}
                  </Box>
                </Box>

                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('auditLogs.details.after')}</Typography>
                  <Box
                    component="pre"
                    sx={{
                      m: 0,
                      p: 2,
                      borderRadius: 1,
                      border: (theme) => `1px solid ${theme.palette.divider}`,
                      backgroundColor: 'background.default',
                      overflow: 'auto',
                      maxHeight: 420,
                      fontSize: 12,
                    }}
                  >
                    {formatJson(detail.after_json)}
                  </Box>
                </Box>
              </Box>
            </Stack>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
