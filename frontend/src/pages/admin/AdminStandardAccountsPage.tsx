import React from 'react';
import { Button, MenuItem, Stack, TextField } from '@mui/material';
import { useTranslation } from 'react-i18next';
import PageHeader from '../../components/PageHeader';
import ServerDataGrid, { EnhancedColDef } from '../../components/ServerDataGrid';
import { useNavigate } from 'react-router-dom';
import CsvExportDialog from '../../components/csv/CsvExportDialog';
import CsvImportDialog from '../../components/csv/CsvImportDialog';
import DeleteSelectedButton from '../../components/DeleteSelectedButton';
import { LinkCellRenderer } from '../../components/grid/renderers';
import { statusColumnProps } from '../../components/grid/statusColumn';
import { lineTypeUsageColumnProps } from '../../components/grid/lineTypeUsageColumn';
import api from '../../api';

type Template = { id: string; country_iso: string | null; template_code: string; template_name: string; version: string; is_global?: boolean };

export default function AdminStandardAccountsPage() {
  const navigate = useNavigate();
  const { t } = useTranslation(['admin', 'common']);
  const [templates, setTemplates] = React.useState<Template[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = React.useState<string>('');
  const [exportOpen, setExportOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [selectedRows, setSelectedRows] = React.useState<any[]>([]);
  const gridApiRef = React.useRef<any>(null);

  React.useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await api.get('/admin/coa-templates', { params: { page: 1, limit: 1000, sort: 'updated_at:DESC' } });
        if (!alive) return;
        const items: Template[] = res.data?.items || [];
        setTemplates(items);
        if (!selectedTemplateId) {
          const saved = localStorage.getItem('admin-standard-accounts.selectedTemplateId') || '';
          const exists = items.find((t) => t.id === saved);
          const fallback = items[0]?.id || '';
          setSelectedTemplateId(exists ? saved : fallback);
        }
      } catch {
        if (!alive) return; setTemplates([]);
      }
    };
    void load();
    return () => { alive = false; };
  }, [selectedTemplateId]);

  // Persist selected template for convenience
  React.useEffect(() => {
    if (selectedTemplateId) localStorage.setItem('admin-standard-accounts.selectedTemplateId', selectedTemplateId);
  }, [selectedTemplateId]);

  const getStandardAccountHref = React.useCallback((row: any) => {
    return `/admin/standard-accounts/${selectedTemplateId}/${row.account_number}/overview`;
  }, [selectedTemplateId]);

  const columns: EnhancedColDef<any>[] = React.useMemo(() => [
    {
      field: 'account_number',
      headerName: t('standardAccounts.columns.accountNumber'),
      width: 160,
      required: true,
      cellStyle: { fontFamily: "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace", fontSize: '12px', color: 'var(--kanap-text-secondary)', fontVariantNumeric: 'tabular-nums' },
      cellRenderer: (params: any) => (
        <LinkCellRenderer {...params} linkType="internal" getHref={getStandardAccountHref} onNavigate={(href) => navigate(href)} />
      ),
    },
    {
      field: 'account_name',
      headerName: t('standardAccounts.columns.name'),
      flex: 1,
      required: true,
      cellRenderer: (params: any) => (
        <LinkCellRenderer {...params} linkType="internal" getHref={getStandardAccountHref} onNavigate={(href) => navigate(href)} />
      ),
    },
    {
      field: 'nature',
      headerName: t('standardAccounts.columns.nature'),
      width: 150,
      // As the status column: the label in the cell (the template list reads the search box only).
      valueFormatter: lineTypeUsageColumnProps(t).valueFormatter,
      cellRenderer: (params: any) => (
        <LinkCellRenderer {...params} linkType="internal" getHref={getStandardAccountHref} onNavigate={(href) => navigate(href)} />
      ),
    },
    {
      field: 'native_name',
      headerName: t('standardAccounts.columns.nativeName'),
      width: 220,
      defaultHidden: true,
      cellRenderer: (params: any) => (
        <LinkCellRenderer {...params} linkType="internal" getHref={getStandardAccountHref} onNavigate={(href) => navigate(href)} />
      ),
    },
    {
      field: 'description',
      headerName: t('standardAccounts.columns.description'),
      width: 250,
      defaultHidden: true,
      cellRenderer: (params: any) => (
        <LinkCellRenderer {...params} linkType="internal" getHref={getStandardAccountHref} onNavigate={(href) => navigate(href)} />
      ),
    },
    {
      field: 'consolidation_account_number',
      headerName: t('standardAccounts.columns.consolidationAccountNumber'),
      width: 180,
      cellStyle: { fontFamily: "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace", fontSize: '12px', color: 'var(--kanap-text-secondary)', fontVariantNumeric: 'tabular-nums' },
      cellRenderer: (params: any) => (
        <LinkCellRenderer {...params} linkType="internal" getHref={getStandardAccountHref} onNavigate={(href) => navigate(href)} />
      ),
    },
    {
      field: 'consolidation_account_name',
      headerName: t('standardAccounts.columns.consolidationName'),
      width: 250,
      cellRenderer: (params: any) => (
        <LinkCellRenderer {...params} linkType="internal" getHref={getStandardAccountHref} onNavigate={(href) => navigate(href)} />
      ),
    },
    {
      field: 'consolidation_account_description',
      headerName: t('standardAccounts.columns.consolidationDescription'),
      width: 300,
      defaultHidden: true,
      cellRenderer: (params: any) => (
        <LinkCellRenderer {...params} linkType="internal" getHref={getStandardAccountHref} onNavigate={(href) => navigate(href)} />
      ),
    },
    {
      field: 'status',
      headerName: t('standardAccounts.columns.status'),
      width: 140,
      valueFormatter: statusColumnProps(t).valueFormatter,
      cellRenderer: (params: any) => (
        <LinkCellRenderer {...params} linkType="internal" getHref={getStandardAccountHref} onNavigate={(href) => navigate(href)} />
      ),
    },
  ], [getStandardAccountHref, navigate, t]);

  const actions = (
    <Stack direction="row" spacing={1}>
      <TextField select size="small" label={t('standardAccounts.templateLabel')} value={selectedTemplateId} onChange={(e) => setSelectedTemplateId(e.target.value)} sx={{ minWidth: 360 }}>
        {templates.map((t) => {
          const scope = t.country_iso ? t.country_iso : 'ALL';
          return (
            <MenuItem key={t.id} value={t.id}>{scope} — {t.template_code} {t.version} · {t.template_name}</MenuItem>
          );
        })}
      </TextField>
      <Button variant="action-primary" disabled={!selectedTemplateId} onClick={() => navigate(`/admin/standard-accounts/${selectedTemplateId}/new/overview`)}>{t('standardAccounts.actions.new')}</Button>
      <Button variant="action" onClick={() => setImportOpen(true)} disabled={!selectedTemplateId}>{t('standardAccounts.actions.importCsv')}</Button>
      <Button variant="action" onClick={() => setExportOpen(true)} disabled={!selectedTemplateId}>{t('standardAccounts.actions.exportCsv')}</Button>
      <DeleteSelectedButton
        selectedRows={selectedRows}
        endpoint={`/admin/coa-templates/${selectedTemplateId}/accounts/bulk`}
        getItemId={(row) => String(row.account_number)}
        getItemName={(row) => row.account_name}
        gridApi={gridApiRef.current}
        onDeleteSuccess={() => setRefreshKey((k) => k + 1)}
        disabled={!selectedTemplateId}
      />
    </Stack>
  );

  return (
    <>
      <PageHeader title={t('standardAccounts.title')} actions={actions} />
      {selectedTemplateId && (
        <ServerDataGrid<any>
          columns={columns}
          endpoint={`/admin/coa-templates/${selectedTemplateId}/accounts`}
          queryKey={`admin-standard-accounts-${selectedTemplateId}`}
          getRowId={(r) => String(r.account_number)}
          enableSearch
          defaultSort={{ field: 'account_number', direction: 'ASC' }}
          refreshKey={refreshKey}
          columnPreferencesKey={`admin-standard-accounts-${selectedTemplateId}`}
          enableColumnChooser={true}
          enableRowSelection
          onSelectionChanged={setSelectedRows}
          onGridApiReady={(api) => { gridApiRef.current = api; }}
        />
      )}
      {selectedTemplateId && (
        <CsvExportDialog
          open={exportOpen}
          onClose={() => setExportOpen(false)}
          endpoint={`/admin/coa-templates/${selectedTemplateId}`}
          title={t('standardAccounts.exportTitle')}
        />
      )}
      {selectedTemplateId && (
        <CsvImportDialog
          open={importOpen}
          onClose={() => setImportOpen(false)}
          endpoint={`/admin/coa-templates/${selectedTemplateId}`}
          title={t('standardAccounts.importTitle')}
          onImported={() => setRefreshKey((k) => k + 1)}
        />
      )}
    </>
  );
}
