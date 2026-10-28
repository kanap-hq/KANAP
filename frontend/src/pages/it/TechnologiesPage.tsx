import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Box, Button, Link as MLink, Menu, MenuItem, Stack, Typography } from '@mui/material';
import { ICellRendererParams } from 'ag-grid-community';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageHeader from '../../components/PageHeader';
import ServerDataGrid, { EnhancedColDef } from '../../components/ServerDataGrid';
import { LinkCellRenderer } from '../../components/grid/renderers';
import CheckboxSetFilter from '../../components/CheckboxSetFilter';
import CheckboxSetFloatingFilter from '../../components/CheckboxSetFloatingFilter';
import DeleteSelectedButton, { type DeleteCheck } from '../../components/DeleteSelectedButton';
import CsvExportDialog from '../../components/csv/CsvExportDialog';
import CsvImportDialog from '../../components/csv/CsvImportDialog';
import { useAuth } from '../../auth/AuthContext';
import { useFeatures } from '../../config/FeaturesContext';
import api from '../../api';
import useItOpsEnumOptions from '../../hooks/useItOpsEnumOptions';
import { useUrlFilterModel } from '../../hooks/useListContextSearch';
import { setListFiltersParam } from '../../lib/listContext';
import { useLocale } from '../../i18n/useLocale';
import { MONO_FONT_FAMILY } from '../../config/ThemeContext';
import { refusalCounts } from '../../utils/deleteRefusal';
import { formatSupportDate, supportStateColor, supportStateNeedsAttention, supportStateOf } from '../../utils/supportState';
import ForbiddenPage from '../ForbiddenPage';
import TechnologyCreateDialog from './components/TechnologyCreateDialog';
import VulnerabilityCountCell from '../../components/vulnerabilities/VulnerabilityCountCell';

export type TechnologyRow = {
  id: string;
  reference: string;
  name: string;
  family: string | null;
  editor: string | null;
  lifecycle: string | null;
  hosting_type: string | null;
  versions_in_use: number;
  servers: number;
  applications: number;
  it_owner_names?: string[];
  next_support_end: string | null;
  /** CVE still to review, and those critical or high (null while the vulnerability feed is off). */
  vulnerabilities_to_review?: number | null;
  vulnerabilities_severe?: number | null;
};

/**
 * The CVE still to review of a technology, the critical or high ones in orange: a link to the
 * Vulnerabilities page filtered on the technology.
 */
function VulnerabilitiesCell({ data }: ICellRendererParams<TechnologyRow, any>) {
  if (!data) return null;
  return (
    <VulnerabilityCountCell
      count={data.vulnerabilities_to_review}
      severe={data.vulnerabilities_severe}
      to={`/it/vulnerabilities?technology=${encodeURIComponent(data.reference || data.id)}`}
    />
  );
}

/** While the vulnerability feed is on, an editor leads to the Vulnerabilities page filtered on it. */
function EditorVulnerabilitiesCell({ value }: ICellRendererParams<TechnologyRow, any>) {
  if (!value) return null;
  return (
    <MLink
      component={RouterLink}
      to={`/it/vulnerabilities?editor=${encodeURIComponent(String(value))}`}
      underline="hover"
      title={String(value)}
      data-testid="editor-vulnerabilities"
      onClick={(event: React.MouseEvent) => event.stopPropagation()}
      sx={{ fontSize: 13, color: 'kanap.text.primary', '&:hover': { color: 'primary.main' } }}
    >
      {String(value)}
    </MLink>
  );
}

/** The two files of links: servers and technologies, applications and technologies. */
type LinkFile = 'asset' | 'application';

/** The import note, once it is an introduction plus one line per rule. A plain string stays a paragraph. */
function importHintList(value: unknown): { intro: string; items: string[] } | null {
  if (!value || typeof value !== 'object') return null;
  const hint = value as { intro?: unknown; items?: unknown };
  const items = Array.isArray(hint.items)
    ? hint.items.filter((item): item is string => typeof item === 'string' && item !== '')
    : [];
  if (items.length === 0) return null;
  return { intro: typeof hint.intro === 'string' ? hint.intro : '', items };
}
const LINK_FILE_ENDPOINTS: Record<LinkFile, string> = {
  asset: '/technologies/asset-links',
  application: '/technologies/application-links',
};

export default function TechnologiesPage() {
  const { t } = useTranslation(['it', 'common']);
  const locale = useLocale();
  const navigate = useNavigate();
  const location = useLocation();
  const { hasLevel } = useAuth();
  const { config } = useFeatures();
  const vulnerabilityFeed = config.features.vulnerabilityFeed === true;
  const { byField, labelFor } = useItOpsEnumOptions();
  const gridApiRef = useRef<any>(null);
  const [selectedRows, setSelectedRows] = useState<TechnologyRow[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const urlFilterState = useUrlFilterModel(location.search, '/technologies');
  const lastQueryRef = useRef<{ sort: string; q: string; filters: any } | null>(null);
  const canCreate = hasLevel('infrastructure', 'member');
  const canAdmin = hasLevel('infrastructure', 'admin');
  // The applications file follows the rights of the single application links.
  const linkFiles: LinkFile[] = hasLevel('applications', 'reader') ? ['asset', 'application'] : ['asset'];
  const [csvMenu, setCsvMenu] = useState<{ action: 'import' | 'export'; anchor: HTMLElement } | null>(null);
  const [linkFile, setLinkFile] = useState<LinkFile>('asset');
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

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
      // The next end of support of the versions in use: coloured when it calls for attention.
      const state = supportStateOf(value, null);
      return (
        <Box
          component="span"
          data-testid="support-end"
          data-state={state}
          sx={(theme) => ({ color: supportStateNeedsAttention(state) ? supportStateColor(state, theme) : 'inherit' })}
        >
          {formatSupportDate(value, locale)}
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

  const hostingTypeValues = useCallback(async () => (byField.hostingType || [])
    .map((option) => ({ value: option.code, label: labelFor('hostingType', option.code) })), [byField.hostingType, labelFor]);

  const columns: EnhancedColDef<TechnologyRow>[] = useMemo(() => [
    {
      headerName: t('pages.technologies.columns.reference'),
      field: 'reference',
      width: 90,
      cellRenderer: LinkCell,
      cellStyle: { fontFamily: MONO_FONT_FAMILY, fontSize: '12px' },
    },
    { headerName: t('common.name'), field: 'name', minWidth: 200, flex: 1, cellRenderer: LinkCell },
    {
      headerName: t('pages.technologies.columns.family'),
      field: 'family',
      width: 170,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: { getValues: familyValues, searchable: false },
      valueFormatter: (p: any) => labelFor('technologyFamily', p.value),
      cellRenderer: LinkCell,
    },
    {
      headerName: t('pages.technologies.columns.editor'),
      field: 'editor',
      width: 140,
      // The full name on hover: the column is narrow.
      cellRendererParams: { tooltip: (row: TechnologyRow) => row.editor ?? '' },
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: { getValues: editorValues },
      cellRenderer: vulnerabilityFeed ? EditorVulnerabilitiesCell : LinkCell,
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
    {
      headerName: t('pages.technologies.columns.hostingType'),
      field: 'hosting_type',
      width: 140,
      defaultHidden: true,
      sortable: false,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: { getValues: hostingTypeValues, searchable: false },
      valueFormatter: (p: any) => labelFor('hostingType', p.value),
      cellRenderer: LinkCell,
    },
    // Secondary columns start hidden: the default set fits a 1,440 px window without scrolling.
    { headerName: t('pages.technologies.columns.versionsInUse'), field: 'versions_in_use', width: 140, defaultHidden: true, sortable: false, filter: false, cellRenderer: LinkCell },
    // Counters: narrow and right-aligned, so that the default set fits a 1,440 px window.
    { headerName: t('pages.technologies.columns.servers'), field: 'servers', width: 80, type: 'rightAligned', sortable: false, filter: false, cellRenderer: LinkCell },
    { headerName: t('pages.technologies.columns.applications'), field: 'applications', width: 100, type: 'rightAligned', sortable: false, filter: false, cellRenderer: LinkCell },
    {
      headerName: t('pages.technologies.columns.itOwner'),
      field: 'it_owner_names',
      width: 170,
      defaultHidden: true,
      sortable: false,
      filter: false,
      valueFormatter: (p: any) => {
        const names = (p.value as string[] | undefined) || [];
        return names.length > 1 ? `${names[0]} +${names.length - 1}` : names[0] || '';
      },
      cellRenderer: LinkCell,
    },
    { headerName: t('pages.technologies.columns.nextSupportEnd'), field: 'next_support_end', width: 130, headerTooltip: t('pages.technologies.columns.nextSupportEnd'), sortable: false, filter: false, cellRenderer: SupportEndCell },
    ...(vulnerabilityFeed
      ? [{ headerName: t('pages.technologies.columns.vulnerabilitiesShort'), field: 'vulnerabilities_to_review' as const, width: 140, headerTooltip: t('pages.technologies.columns.vulnerabilities'), sortable: false, filter: false, cellRenderer: VulnerabilitiesCell }]
      : []),
  ], [LinkCell, SupportEndCell, editorValues, familyValues, hostingTypeValues, labelFor, lifecycleValues, t, vulnerabilityFeed]);

  if (!hasLevel('infrastructure', 'reader')) {
    return <ForbiddenPage resource="infrastructure" level="reader" />;
  }

  const openLinkFile = (file: LinkFile) => {
    const action = csvMenu?.action;
    setCsvMenu(null);
    setLinkFile(file);
    if (action === 'import') setImportOpen(true);
    if (action === 'export') setExportOpen(true);
  };

  const actions = (
    <Stack direction="row" spacing={1}>
      {canCreate && (
        <Button variant="action-primary" onClick={() => setCreateOpen(true)}>
          {t('pages.technologies.newTechnology')}
        </Button>
      )}
      {canCreate && (
        <Button variant="action" aria-haspopup="menu" onClick={(event) => setCsvMenu({ action: 'import', anchor: event.currentTarget })}>
          {t('pages.technologies.importCsv')}
        </Button>
      )}
      <Button variant="action" aria-haspopup="menu" onClick={(event) => setCsvMenu({ action: 'export', anchor: event.currentTarget })}>
        {t('pages.technologies.exportCsv')}
      </Button>
      {canAdmin && (
        <DeleteSelectedButton
          selectedRows={selectedRows}
          endpoint="/technologies/bulk"
          getItemId={(row) => row.id}
          getItemName={(row) => row.name}
          checkDelete={async (ids) => {
            const res = await api.post<{ refused?: DeleteCheck['refused']; removes: Array<{ type: string; total: number }> }>('/technologies/delete-check', { ids });
            const removes = res.data?.removes || [];
            // Kept: the technologies linked to lines outside the person's data access.
            const refused = Array.isArray(res.data?.refused) ? res.data.refused : [];
            const count = ids.length - refused.length;
            return {
              refused,
              warning: removes.length > 0
                ? t('pages.technologies.delete.warningCounted', { count, usages: refusalCounts({ usages: removes }, t, locale) })
                : t('pages.technologies.delete.warning', { count }),
            };
          }}
          warning={t('pages.technologies.delete.warning', { count: selectedRows.length })}
          itemLabels={{
            toDelete: (count) => t('pages.technologies.delete.toDelete', { count }),
            deleted: (count) => t('pages.technologies.delete.deleted', { count }),
            title: (count) => t('pages.technologies.delete.title', { count }),
          }}
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
          emptyState={(
            <Stack direction="row" spacing={1.5} alignItems="center" justifyContent="center" data-testid="technologies-empty">
              <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>{t('pages.technologies.empty')}</Typography>
              {canCreate && (
                <Button variant="contained" size="small" onClick={() => setCreateOpen(true)}>
                  {t('pages.technologies.newTechnology')}
                </Button>
              )}
            </Stack>
          )}
          onQueryStateChange={(state) => {
            lastQueryRef.current = { sort: state.sort, q: state.q || '', filters: state.filterModel || {} };
          }}
        />
      )}
      <Menu
        anchorEl={csvMenu?.anchor ?? null}
        open={!!csvMenu}
        onClose={() => setCsvMenu(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        {linkFiles.map((file) => (
          <MenuItem key={file} sx={{ fontSize: 13 }} onClick={() => openLinkFile(file)}>
            {t(`pages.technologies.linkFiles.${file}`)}
          </MenuItem>
        ))}
      </Menu>
      <CsvImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        endpoint={LINK_FILE_ENDPOINTS[linkFile]}
        title={t(`pages.technologies.linkFiles.importTitle.${linkFile}`)}
        hintList={importHintList(t(`pages.technologies.linkFiles.importHint.${linkFile}`, { returnObjects: true })) ?? undefined}
        onImported={() => setRefreshKey((k) => k + 1)}
        flexibleFormat
      />
      <CsvExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        endpoint={LINK_FILE_ENDPOINTS[linkFile]}
        title={t(`pages.technologies.linkFiles.exportTitle.${linkFile}`)}
        note={linkFile === 'application' ? t('pages.technologies.linkFiles.exportNoteApplication') : undefined}
        flexibleFormat
      />
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
