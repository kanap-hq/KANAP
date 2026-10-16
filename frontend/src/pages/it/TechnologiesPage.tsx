import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Box, Button, Stack } from '@mui/material';
import { ICellRendererParams } from 'ag-grid-community';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageHeader from '../../components/PageHeader';
import ServerDataGrid, { EnhancedColDef } from '../../components/ServerDataGrid';
import { LinkCellRenderer } from '../../components/grid/renderers';
import CheckboxSetFilter from '../../components/CheckboxSetFilter';
import CheckboxSetFloatingFilter from '../../components/CheckboxSetFloatingFilter';
import DeleteSelectedButton from '../../components/DeleteSelectedButton';
import { useAuth } from '../../auth/AuthContext';
import api from '../../api';
import useItOpsEnumOptions from '../../hooks/useItOpsEnumOptions';
import { useUrlFilterModel } from '../../hooks/useListContextSearch';
import { setListFiltersParam } from '../../lib/listContext';
import { formatShortDate } from '../../lib/dateFormat';
import { useLocale } from '../../i18n/useLocale';
import { MONO_FONT_FAMILY } from '../../config/ThemeContext';
import { refusalCounts } from '../../utils/deleteRefusal';
import ForbiddenPage from '../ForbiddenPage';
import TechnologyCreateDialog from './components/TechnologyCreateDialog';

export type TechnologyRow = {
  id: string;
  reference: string;
  name: string;
  family: string | null;
  editor: string | null;
  lifecycle: string | null;
  mode: string | null;
  versions_in_use: number;
  servers: number;
  applications: number;
  it_owner_names?: string[];
  owner_names?: string[];
  next_support_end: string | null;
};

/** True when an end of support is past or within the next twelve months. */
export function supportEndNear(value: string | null | undefined, now = new Date()): boolean {
  if (!value) return false;
  const end = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(end.getTime())) return false;
  const limit = new Date(now);
  limit.setFullYear(limit.getFullYear() + 1);
  return end.getTime() <= limit.getTime();
}

export default function TechnologiesPage() {
  const { t } = useTranslation(['it', 'common']);
  const locale = useLocale();
  const navigate = useNavigate();
  const location = useLocation();
  const { hasLevel } = useAuth();
  const { byField, labelFor } = useItOpsEnumOptions();
  const gridApiRef = useRef<any>(null);
  const [selectedRows, setSelectedRows] = useState<TechnologyRow[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const urlFilterState = useUrlFilterModel(location.search, '/technologies');
  const lastQueryRef = useRef<{ sort: string; q: string; filters: any } | null>(null);
  const canCreate = hasLevel('infrastructure', 'member');
  const canAdmin = hasLevel('infrastructure', 'admin');

  const buildWorkspaceSearch = useCallback(() => {
    const sp = new URLSearchParams();
    sp.set('sort', lastQueryRef.current?.sort || 'name:ASC');
    if (lastQueryRef.current?.q) sp.set('q', lastQueryRef.current.q);
    setListFiltersParam(sp, '/technologies', lastQueryRef.current?.filters || {});
    return sp;
  }, []);

  const buildHref = useCallback((row: TechnologyRow | null | undefined) => {
    if (!row?.id) return undefined;
    return `/it/technologies/${row.reference || row.id}/overview?${buildWorkspaceSearch().toString()}`;
  }, [buildWorkspaceSearch]);

  const LinkCell = useMemo(() => {
    const Cell: React.FC<ICellRendererParams<TechnologyRow, any>> = (params) => (
      <LinkCellRenderer {...params} linkType="internal" getHref={(row) => buildHref(row)} onNavigate={(href) => navigate(href)} />
    );
    return Cell;
  }, [buildHref, navigate]);

  const SupportEndCell = useMemo(() => {
    const Cell: React.FC<ICellRendererParams<TechnologyRow, any>> = (params) => {
      const value = params.value as string | null;
      if (!value) return null;
      return (
        <Box
          component="span"
          data-testid="support-end"
          data-near={supportEndNear(value) ? 'true' : 'false'}
          sx={(theme) => ({ color: supportEndNear(value) ? theme.palette.kanap.orange : 'inherit' })}
        >
          {formatShortDate(value, locale)}
        </Box>
      );
    };
    return Cell;
  }, [locale]);

  const familyValues = useCallback(async () => (byField.technologyFamily || [])
    .map((option) => ({ value: option.code, label: option.label }))
    .sort((a, b) => a.label.localeCompare(b.label)), [byField.technologyFamily]);

  // The tenant's own editors, all of them (the catalog's are offered when typing one, not here).
  const editorValues = useCallback(async () => {
    const res = await api.get<{ editor?: Array<string | null> }>('/technologies/filter-values', { params: { fields: 'editor' } });
    return (res.data?.editor || []).map((editor) => ({ value: editor, label: editor ?? t('common:filters.blank') }));
  }, [t]);

  const lifecycleValues = useCallback(async () => (byField.lifecycleStatus || [])
    .map((option) => ({ value: option.code, label: option.label })), [byField.lifecycleStatus]);

  const columns: EnhancedColDef<TechnologyRow>[] = useMemo(() => [
    {
      headerName: t('pages.technologies.columns.reference'),
      field: 'reference',
      width: 110,
      cellRenderer: LinkCell,
      cellStyle: { fontFamily: MONO_FONT_FAMILY, fontSize: '12px' },
    },
    { headerName: t('common.name'), field: 'name', minWidth: 200, flex: 1, cellRenderer: LinkCell },
    {
      headerName: t('pages.technologies.columns.family'),
      field: 'family',
      width: 190,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: { getValues: familyValues, searchable: false },
      valueFormatter: (p: any) => labelFor('technologyFamily', p.value),
      cellRenderer: LinkCell,
    },
    {
      headerName: t('pages.technologies.columns.editor'),
      field: 'editor',
      width: 170,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: { getValues: editorValues },
      cellRenderer: LinkCell,
    },
    {
      headerName: t('pages.technologies.columns.lifecycle'),
      field: 'lifecycle',
      width: 140,
      defaultHidden: true,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: { getValues: lifecycleValues, searchable: false },
      valueFormatter: (p: any) => labelFor('lifecycleStatus', p.value),
      cellRenderer: LinkCell,
    },
    { headerName: t('pages.technologies.columns.versionsInUse'), field: 'versions_in_use', width: 140, sortable: false, filter: false, cellRenderer: LinkCell },
    { headerName: t('pages.technologies.columns.servers'), field: 'servers', width: 110, sortable: false, filter: false, cellRenderer: LinkCell },
    { headerName: t('pages.technologies.columns.applications'), field: 'applications', width: 130, sortable: false, filter: false, cellRenderer: LinkCell },
    {
      headerName: t('pages.technologies.columns.itOwner'),
      field: 'it_owner_names',
      width: 170,
      sortable: false,
      filter: false,
      valueFormatter: (p: any) => {
        const names = (p.value as string[] | undefined) || [];
        return names.length > 1 ? `${names[0]} +${names.length - 1}` : names[0] || '';
      },
      cellRenderer: LinkCell,
    },
    { headerName: t('pages.technologies.columns.nextSupportEnd'), field: 'next_support_end', width: 170, sortable: false, filter: false, cellRenderer: SupportEndCell },
  ], [LinkCell, SupportEndCell, editorValues, familyValues, labelFor, lifecycleValues, t]);

  if (!hasLevel('infrastructure', 'reader')) {
    return <ForbiddenPage />;
  }

  const actions = (
    <Stack direction="row" spacing={1}>
      {canCreate && (
        <Button variant="action-primary" onClick={() => setCreateOpen(true)}>
          {t('pages.technologies.newTechnology')}
        </Button>
      )}
      {canAdmin && (
        <DeleteSelectedButton
          selectedRows={selectedRows}
          endpoint="/technologies/bulk"
          getItemId={(row) => row.id}
          getItemName={(row) => row.name}
          checkDelete={async (ids) => {
            const res = await api.post<{ refused: []; removes: Array<{ type: string; total: number }> }>('/technologies/delete-check', { ids });
            const removes = res.data?.removes || [];
            return {
              refused: [],
              warning: removes.length > 0
                ? t('pages.technologies.delete.warningCounted', { count: ids.length, usages: refusalCounts({ usages: removes }, t, locale) })
                : t('pages.technologies.delete.warning', { count: ids.length }),
            };
          }}
          warning={t('pages.technologies.delete.warning', { count: selectedRows.length })}
          gridApi={gridApiRef.current}
          onDeleteSuccess={() => { setRefreshKey((k) => k + 1); }}
        />
      )}
    </Stack>
  );

  return (
    <>
      <PageHeader title={t('pages.technologies.title')} actions={actions} />
      {urlFilterState.ready && (
        <ServerDataGrid<TechnologyRow>
          columns={columns}
          endpoint="/technologies"
          queryKey="technologies"
          showRowCount
          defaultSort={{ field: 'name', direction: 'ASC' }}
          initialState={urlFilterState.model ? { filter: { filterModel: urlFilterState.model } } : undefined}
          requiredColumns={['name']}
          enableColumnChooser
          columnPreferencesKey="it-technologies"
          refreshKey={refreshKey}
          enableSearch
          enableRowSelection={canAdmin}
          onSelectionChanged={setSelectedRows}
          onGridApiReady={(gridApi) => { gridApiRef.current = gridApi; }}
          onQueryStateChange={(state) => {
            lastQueryRef.current = { sort: state.sort, q: state.q || '', filters: state.filterModel || {} };
          }}
        />
      )}
      <TechnologyCreateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(reference) => {
          setCreateOpen(false);
          navigate(`/it/technologies/${reference}/overview?${buildWorkspaceSearch().toString()}`);
        }}
      />
    </>
  );
}
