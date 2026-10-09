import React, { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import PageHeader from '../components/PageHeader';
import ServerDataGrid, { EnhancedColDef } from '../components/ServerDataGrid';
import { Button, Stack } from '@mui/material';
import CsvExportDialog from '../components/csv/CsvExportDialog';
import CsvImportDialog from '../components/csv/CsvImportDialog';
import { useAuth } from '../auth/AuthContext';
import DeleteSelectedButton from '../components/DeleteSelectedButton';
import { useNavigate } from 'react-router-dom';
import { LinkCellRenderer } from '../components/grid/renderers';
import { useLocale } from '../i18n/useLocale';
import { formatShortDateTime } from '../lib/dateFormat';
import ForbiddenPage from './ForbiddenPage';

export default function ContactsPage() {
  const { hasLevel } = useAuth();
  const { t } = useTranslation(['master-data', 'common']);
  const locale = useLocale();
  const navigate = useNavigate();

  if (!hasLevel('contacts', 'reader')) {
    return <ForbiddenPage />;
  }

  const [refreshKey, setRefreshKey] = useState(0);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const gridApiRef = useRef<any>(null);
  const lastQueryRef = useRef<{ sort: string; q: string; filters: any } | null>(null);
  const buildWorkspaceSearch = () => {
    const sp = new URLSearchParams();
    const sort = lastQueryRef.current?.sort || 'last_name:ASC';
    const q = lastQueryRef.current?.q || '';
    const filters = lastQueryRef.current?.filters || {};
    if (sort) sp.set('sort', sort);
    if (q) sp.set('q', q);
    if (filters && Object.keys(filters).length > 0) sp.set('filters', JSON.stringify(filters));
    return sp;
  };
  const [selectedRows, setSelectedRows] = useState<any[]>([]);
  const getContactHref = (row: any) => {
    const sp = buildWorkspaceSearch();
    return `/master-data/contacts/${row.id}/overview?${sp.toString()}`;
  };

  const columns: EnhancedColDef<any>[] = useMemo(() => [
    {
      field: 'last_name',
      headerName: t('contacts.columns.lastName'),
      width: 160,
      cellRenderer: (params: any) => (
        <LinkCellRenderer {...params} linkType="internal" getHref={getContactHref} onNavigate={(href) => navigate(href)} />
      ),
    },
    {
      field: 'first_name',
      headerName: t('contacts.columns.firstName'),
      width: 160,
      cellRenderer: (params: any) => (
        <LinkCellRenderer {...params} linkType="internal" getHref={getContactHref} onNavigate={(href) => navigate(href)} />
      ),
    },
    {
      field: 'supplier_name',
      headerName: t('contacts.columns.supplier'),
      width: 200,
      cellRenderer: (params: any) => (
        <LinkCellRenderer {...params} linkType="internal" getHref={getContactHref} onNavigate={(href) => navigate(href)} />
      ),
    },
    {
      field: 'job_title',
      headerName: t('contacts.columns.jobTitle'),
      width: 200,
      defaultHidden: true,
      cellRenderer: (params: any) => (
        <LinkCellRenderer {...params} linkType="internal" getHref={getContactHref} onNavigate={(href) => navigate(href)} />
      ),
    },
    {
      field: 'email',
      headerName: t('shared.columns.email'),
      flex: 1,
      cellRenderer: (params: any) => (
        <LinkCellRenderer {...params} linkType="internal" getHref={getContactHref} onNavigate={(href) => navigate(href)} />
      ),
    },
    {
      field: 'phone',
      headerName: t('contacts.columns.phone'),
      width: 140,
      defaultHidden: true,
      cellRenderer: (params: any) => (
        <LinkCellRenderer {...params} linkType="internal" getHref={getContactHref} onNavigate={(href) => navigate(href)} />
      ),
    },
    {
      field: 'mobile',
      headerName: t('contacts.columns.mobile'),
      width: 140,
      defaultHidden: true,
      cellRenderer: (params: any) => (
        <LinkCellRenderer {...params} linkType="internal" getHref={getContactHref} onNavigate={(href) => navigate(href)} />
      ),
    },
    {
      field: 'country',
      headerName: t('shared.columns.country'),
      width: 120,
      defaultHidden: true,
      cellRenderer: (params: any) => (
        <LinkCellRenderer {...params} linkType="internal" getHref={getContactHref} onNavigate={(href) => navigate(href)} />
      ),
    },
    {
      field: 'active',
      headerName: t('shared.columns.active'),
      width: 120,
      valueFormatter: (p: any) => (p.value ? t('shared.labels.yes') : t('shared.labels.no')),
      cellRenderer: (params: any) => (
        <LinkCellRenderer {...params} linkType="internal" getHref={getContactHref} onNavigate={(href) => navigate(href)} />
      ),
    },
    {
      field: 'created_at',
      headerName: t('shared.columns.created'),
      width: 200,
      valueFormatter: (p: any) => formatShortDateTime(p.value as string | null, locale),
      defaultHidden: true,
      cellRenderer: (params: any) => (
        <LinkCellRenderer {...params} linkType="internal" getHref={getContactHref} onNavigate={(href) => navigate(href)} />
      ),
    },
  ], [locale, navigate, t]);

  const canCreate = hasLevel('contacts','manager');
  const canAdmin = hasLevel('contacts','admin');
  const actions = (
    <Stack direction="row" spacing={1}>
      {canCreate && (
        <Button variant="action-primary" onClick={() => {
          const sp = buildWorkspaceSearch();
          navigate(`/master-data/contacts/new/overview?${sp.toString()}`);
        }}>{t('shared.labels.new')}</Button>
      )}
      {canAdmin && <Button variant="action" onClick={() => setImportOpen(true)}>{t('shared.labels.importCsv')}</Button>}
      {canAdmin && <Button variant="action" onClick={() => setExportOpen(true)}>{t('shared.labels.exportCsv')}</Button>}
      {canAdmin && (
        <DeleteSelectedButton
          selectedRows={selectedRows}
          endpoint="/contacts/bulk"
          getItemId={(row) => row.id}
          getItemName={(row) => (row.first_name || row.last_name) ? `${row.first_name || ''} ${row.last_name || ''}`.trim() : row.email}
          gridApi={gridApiRef.current}
          onDeleteSuccess={() => setRefreshKey((k) => k + 1)}
        />
      )}
    </Stack>
  );

  return (
    <>
      <PageHeader title={t("contacts.title")} actions={actions} />
      <ServerDataGrid<any>
        columns={columns}
        endpoint="/contacts"
        queryKey="contacts"
        getRowId={(r) => r.id}
        enableSearch
        defaultSort={{ field: 'last_name', direction: 'ASC' }}
        refreshKey={refreshKey}
        columnPreferencesKey="contacts"
        enableColumnChooser={true}
        requiredColumns={['email']}
        defaultHiddenColumns={['job_title','phone','mobile','country','created_at']}
        enableRowSelection={canAdmin}
        onSelectionChanged={setSelectedRows}
        onGridApiReady={(api) => { gridApiRef.current = api; }}
        onQueryStateChange={(state) => {
          lastQueryRef.current = { sort: state.sort, q: state.q || '', filters: state.filterModel || {} };
        }}
      />
      <CsvExportDialog open={exportOpen} onClose={() => setExportOpen(false)} endpoint="/contacts" title={t("contacts.export")} />
      <CsvImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        endpoint="/contacts"
        title={t("contacts.import")}
        onImported={() => setRefreshKey((k) => k + 1)}
      />
    </>
  );
}
