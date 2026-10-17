import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box, Button, Checkbox, Drawer, FormControlLabel, IconButton, Link as MLink, MenuItem, Stack, TextField, Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { ICellRendererParams } from 'ag-grid-community';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import api from '../../api';
import { useAuth } from '../../auth/AuthContext';
import CheckboxSetFilter from '../../components/CheckboxSetFilter';
import CheckboxSetFloatingFilter from '../../components/CheckboxSetFloatingFilter';
import PageHeader from '../../components/PageHeader';
import ReportDataStatus from '../../components/reports/ReportDataStatus';
import { reportFilterMenuProps } from '../../components/reports/ReportLayout';
import ServerDataGrid, { EnhancedColDef, type ListRequest } from '../../components/ServerDataGrid';
import { KanapDialog, PropertyRow } from '../../components/design';
import { RelationRef } from '../../components/workspace/RelationsTable';
import { useFeatures } from '../../config/FeaturesContext';
import { MONO_FONT_FAMILY } from '../../config/ThemeContext';
import { useLocale } from '../../i18n/useLocale';
import { formatShortDate } from '../../lib/dateFormat';
import { drawerMenuItemSx, drawerSelectSx, inlineControlSx } from '../../theme/formSx';
import { downloadBlob, extractFilenameFromDisposition } from '../../utils/downloadBlob';
import ForbiddenPage from '../ForbiddenPage';
import {
  SEVERITIES,
  SeverityCell,
  technologiesText,
  VULNERABILITY_STATES,
  VulnerabilityStateCell,
  versionText,
  type VulnerabilityDetail,
  type VulnerabilityItem,
  type VulnerabilityState,
  type VulnerabilityVersion,
} from './vulnerabilities/vulnerabilityTypes';

const ENDPOINT = '/vulnerabilities';

/** A list row: the CVE, with its publishers and its state across its rows (`GET /vulnerabilities`). */
export type VulnerabilityRow = VulnerabilityItem & { id?: string; editor: string | null; state: VulnerabilityState };

/**
 * The grid's filter model from the address: "to review" unless `state` says otherwise (`all`: every
 * state); `editor`, `technology` (`TEC-n`) and `severity` as set filters; `q` on the CVE id. These
 * are the entries from the technologies list, the technology record and the emails.
 */
export function filterModelFromSearch(search: string): Record<string, unknown> {
  const params = new URLSearchParams(search);
  const model: Record<string, unknown> = {};
  const set = (values: string[]) => ({ filterType: 'set', values });
  const state = params.get('state');
  if (state !== 'all') model.state = set([(VULNERABILITY_STATES as readonly string[]).includes(state ?? '') ? state! : 'to_review']);
  const editor = params.get('editor');
  if (editor) model.editor = set([editor]);
  const technology = params.get('technology');
  if (technology) model.technologies = set([technology]);
  const severity = params.get('severity');
  if (severity && (SEVERITIES as readonly string[]).includes(severity)) model.severity = set([severity]);
  const q = params.get('q');
  if (q) model.cve_id = { filterType: 'text', type: 'contains', filter: q };
  return model;
}

/** The list's parameters, without its paging, for the export and the change in bulk. */
function scopeParams(request: ListRequest | null): Record<string, unknown> {
  const { page: _page, limit: _limit, ...rest } = (request?.params ?? {}) as Record<string, unknown>;
  return rest;
}

/** A neutral link (a server, an application, a technology): underline and teal on hover only. */
function RecordLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <MLink
      component={RouterLink}
      to={to}
      underline="hover"
      onClick={(event: React.MouseEvent) => event.stopPropagation()}
      sx={{ color: 'kanap.text.primary', fontSize: 13, '&:hover': { color: 'primary.main' } }}
    >
      {children}
    </MLink>
  );
}

function DetailBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'kanap.text.tertiary', mb: 0.5 }}>{title}</Typography>
      {children}
    </Box>
  );
}

const listSx = { listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: '2px', fontSize: 13 } as const;
const quietSx = { fontSize: 13, color: 'kanap.text.tertiary' } as const;

/**
 * The state and the note of one technology version for a CVE: a member changes them in place
 * (`PATCH /technologies/:id/vulnerabilities/:cveId`, the state on change, the note on blur).
 */
function VersionStateRow({ technologyId, cveId, version, canEdit, onSaved }: {
  technologyId: string;
  cveId: string;
  version: VulnerabilityVersion;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const { t } = useTranslation('it');
  const [note, setNote] = useState(version.note ?? '');
  const [failed, setFailed] = useState(false);
  useEffect(() => { setNote(version.note ?? ''); }, [version.note]);
  const label = versionText(version, t);
  const save = async (body: { state?: VulnerabilityState; note?: string | null }) => {
    setFailed(false);
    try {
      await api.patch(`/technologies/${technologyId}/vulnerabilities/${cveId}`, { ...body, technology_version_id: version.technology_version_id });
      onSaved();
    } catch {
      setFailed(true);
    }
  };
  return (
    <Box component="li" sx={{ display: 'grid', gridTemplateColumns: '160px 150px 1fr', gap: 1, alignItems: 'center' }}>
      <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', color: version.potential ? 'kanap.text.secondary' : 'kanap.text.primary' }} title={label}>
        {label}
      </Box>
      {canEdit ? (
        <TextField
          select
          variant="standard"
          value={version.state}
          onChange={(event) => void save({ state: event.target.value as VulnerabilityState })}
          SelectProps={{ MenuProps: reportFilterMenuProps, inputProps: { 'aria-label': t('pages.vulnerabilities.detail.stateOf', { version: label }) } }}
          sx={inlineControlSx}
        >
          {VULNERABILITY_STATES.map((state) => (
            <MenuItem key={state} value={state} sx={drawerMenuItemSx}><VulnerabilityStateCell state={state} /></MenuItem>
          ))}
        </TextField>
      ) : (
        <VulnerabilityStateCell state={version.state} />
      )}
      {canEdit ? (
        <TextField
          variant="standard"
          value={note}
          placeholder={t('pages.vulnerabilities.detail.notePlaceholder')}
          inputProps={{ 'aria-label': t('pages.vulnerabilities.detail.noteOf', { version: label }), maxLength: 4000 }}
          onChange={(event) => setNote(event.target.value)}
          onBlur={() => {
            const next = note.trim() || null;
            if (next !== (version.note ?? null)) void save({ note: next });
          }}
        />
      ) : (
        <Box component="span" sx={{ color: 'kanap.text.secondary', overflow: 'hidden', textOverflow: 'ellipsis' }}>{version.note ?? ''}</Box>
      )}
      {failed && (
        <Typography role="alert" sx={{ gridColumn: '1 / -1', fontSize: 12, color: 'kanap.text.secondary' }}>
          {t('pages.vulnerabilities.saveFailed')}
        </Typography>
      )}
    </Box>
  );
}

/** One CVE in the side panel: what it says, what it touches, and its state per technology version. */
function VulnerabilityDetailPanel({ cveId, canEdit, onChanged }: { cveId: string; canEdit: boolean; onChanged?: () => void }) {
  const { t } = useTranslation('it');
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: ['vulnerabilities', 'detail', cveId],
    queryFn: async () => (await api.get<VulnerabilityDetail>(`${ENDPOINT}/${encodeURIComponent(cveId)}`)).data,
  });
  if (!detail.data) {
    return <ReportDataStatus loading={detail.isLoading} error={detail.isError} onRetry={() => void detail.refetch()} />;
  }
  const d = detail.data;
  // The panel stays open; the grid, which does not read react-query, is refreshed by its caller.
  const onSaved = () => {
    void queryClient.invalidateQueries({ queryKey: ['vulnerabilities'] });
    onChanged?.();
  };
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }} data-testid="vulnerability-detail">
      <Box>
        {d.summary && <Typography sx={{ fontSize: 13, color: 'kanap.text.primary', mb: 0.5 }}>{d.summary}</Typography>}
        {d.cvss_vector && (
          <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary' }}>
            {t('pages.vulnerabilities.detail.vector')}{' '}
            <Box component="span" sx={{ fontFamily: MONO_FONT_FAMILY }}>{d.cvss_vector}</Box>
          </Typography>
        )}
        {d.reference_urls.length > 0 && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', mt: 0.5 }}>
            {d.reference_urls.slice(0, 6).map((url) => (
              <MLink key={url} href={url} target="_blank" rel="noopener noreferrer" sx={{ fontSize: 12 }}>
                {url.replace(/^https?:\/\//, '').slice(0, 60)}
              </MLink>
            ))}
          </Box>
        )}
      </Box>
      <DetailBlock title={t('pages.vulnerabilities.detail.versions')}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {d.technologies.map((tech) => (
            <Box key={tech.technology_id}>
              <Box sx={{ mb: 0.5 }}>
                <RecordLink to={`/it/technologies/${tech.reference ?? tech.technology_id}`}>
                  {tech.reference && <><RelationRef>{tech.reference}</RelationRef>{' '}</>}
                  {tech.name}
                </RecordLink>
              </Box>
              <Box component="ul" sx={{ ...listSx, gap: '6px' }}>
                {tech.versions.map((version) => (
                  <VersionStateRow
                    key={version.id}
                    technologyId={tech.technology_id}
                    cveId={d.cve_id}
                    version={version}
                    canEdit={canEdit}
                    onSaved={onSaved}
                  />
                ))}
              </Box>
            </Box>
          ))}
        </Box>
      </DetailBlock>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 3 }}>
        <DetailBlock title={t('pages.vulnerabilities.detail.servers')}>
          {d.servers_list.length === 0 ? (
            <Typography sx={quietSx}>{t('pages.vulnerabilities.detail.noServers')}</Typography>
          ) : (
            <Box component="ul" sx={listSx}>
              {d.servers_list.map((server, index) => (
                <li key={`${server.asset_id}:${server.technology_id}:${index}`}>
                  <RecordLink to={`/it/assets/${server.asset_id}`}>{server.name ?? server.reference ?? ''}</RecordLink>
                  <Box component="span" sx={{ color: 'kanap.text.secondary' }}>
                    {' · '}{server.technology_name} {versionText(server, t)}
                    {server.via_asset_name && <>{' · '}{t('pages.vulnerabilities.detail.via', { name: server.via_asset_name })}</>}
                  </Box>
                </li>
              ))}
            </Box>
          )}
        </DetailBlock>
        <DetailBlock title={t('pages.vulnerabilities.detail.applications')}>
          {d.applications_list === null ? (
            <Typography sx={quietSx}>{t('pages.vulnerabilities.detail.applicationsHidden')}</Typography>
          ) : d.applications_list.length === 0 ? (
            <Typography sx={quietSx}>{t('pages.vulnerabilities.detail.noApplications')}</Typography>
          ) : (
            <Box component="ul" sx={listSx}>
              {d.applications_list.map((app, index) => (
                <li key={`${app.application_id}:${index}`}>
                  <RecordLink to={`/it/applications/${app.application_id}`}>
                    {app.reference && <><RelationRef>{app.reference}</RelationRef>{' '}</>}
                    {app.name ?? ''}
                  </RecordLink>
                  <Box component="span" sx={{ color: 'kanap.text.secondary' }}>
                    {' · '}{app.technology_name} {versionText(app, t)}
                    {app.server_name && <>{' · '}{app.server_name}</>}
                  </Box>
                </li>
              ))}
            </Box>
          )}
        </DetailBlock>
      </Box>
    </Box>
  );
}


/**
 * The change of state in bulk: a state and a common note for the selected CVE, or for every CVE of
 * the current filter; the count comes from a dry run before the change.
 */
function BulkStateDialog({ open, onClose, selected, request, onDone }: {
  open: boolean;
  onClose: () => void;
  selected: string[];
  request: ListRequest | null;
  onDone: () => void;
}) {
  const { t } = useTranslation('it');
  const [state, setState] = useState<VulnerabilityState>('handled');
  const [note, setNote] = useState('');
  const [all, setAll] = useState(selected.length === 0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    setAll(selected.length === 0);
    setError(null);
  }, [open, selected.length]);
  const body = useMemo(() => ({
    state,
    ...(note.trim() ? { note: note.trim() } : {}),
    ...(all ? { all: true } : { cve_ids: selected }),
    filters: scopeParams(request),
  }), [all, note, request, selected, state]);
  const count = useQuery({
    queryKey: ['vulnerabilities', 'bulk-count', body],
    queryFn: async () => (await api.post<{ rows: number; cves: number; changes: number; as_of: string }>(`${ENDPOINT}/bulk-state`, { ...body, dry_run: true })).data,
    enabled: open,
    retry: false,
  });
  const tooMany = count.isError;
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      // Only the rows of the count: a CVE found after it stays to review.
      await api.post(`${ENDPOINT}/bulk-state`, { ...body, as_of: count.data?.as_of });
      onDone();
    } catch {
      setError(t('pages.vulnerabilities.bulk.failed'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <KanapDialog
      open={open}
      title={t('pages.vulnerabilities.bulk.title')}
      onClose={onClose}
      onSave={save}
      saveLabel={t('pages.vulnerabilities.bulk.save')}
      saveDisabled={!count.data || count.data.changes === 0 || tooMany}
      saveLoading={saving}
    >
      <Stack spacing={1.5}>
        <PropertyRow label={t('pages.vulnerabilities.bulk.state')}>
          <TextField
            select
            variant="standard"
            value={state}
            onChange={(event) => setState(event.target.value as VulnerabilityState)}
            SelectProps={{ MenuProps: reportFilterMenuProps, inputProps: { 'aria-label': t('pages.vulnerabilities.bulk.state') } }}
            sx={drawerSelectSx}
          >
            {VULNERABILITY_STATES.map((option) => (
              <MenuItem key={option} value={option} sx={drawerMenuItemSx}><VulnerabilityStateCell state={option} /></MenuItem>
            ))}
          </TextField>
        </PropertyRow>
        <PropertyRow label={t('pages.vulnerabilities.bulk.note')}>
          <TextField
            variant="standard"
            value={note}
            placeholder={t('pages.vulnerabilities.detail.notePlaceholder')}
            inputProps={{ 'aria-label': t('pages.vulnerabilities.bulk.note'), maxLength: 4000 }}
            onChange={(event) => setNote(event.target.value)}
          />
        </PropertyRow>
        <FormControlLabel
          control={<Checkbox size="small" checked={all} disabled={selected.length === 0} onChange={(event) => setAll(event.target.checked)} />}
          label={<Typography sx={{ fontSize: 13 }}>{t('pages.vulnerabilities.bulk.scopeAll')}</Typography>}
        />
        {!all && (
          <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>
            {t('pages.vulnerabilities.bulk.scopeSelected', { count: selected.length })}
          </Typography>
        )}
        <Typography role="status" sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>
          {tooMany
            ? t('pages.vulnerabilities.bulk.tooMany')
            : count.data
              ? t('pages.vulnerabilities.bulk.count', { count: count.data.changes, rows: count.data.rows, cves: count.data.cves })
              : t('pages.vulnerabilities.bulk.counting')}
        </Typography>
        {note.trim() === '' && (
          <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary' }}>{t('pages.vulnerabilities.bulk.noteKept')}</Typography>
        )}
        {error && <Typography role="alert" sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>{error}</Typography>}
      </Stack>
    </KanapDialog>
  );
}

/**
 * IT › Vulnerabilities (lot T6b): the published CVE (NVD) matched with the technologies of the
 * workspace, on the list grid of the repository (filters per column, columns chosen and kept, sort,
 * total, export), "to review" by default and most severe first. Several CVE, or every one of the
 * filter, change state at once; a row opens the CVE in a side panel. Shown only while the
 * vulnerability feed is on (`features.vulnerabilityFeed`).
 */
export default function VulnerabilitiesPage() {
  const { t } = useTranslation(['it', 'common']);
  const locale = useLocale();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { hasLevel } = useAuth();
  const { config } = useFeatures();
  const enabled = config.features.vulnerabilityFeed === true;
  const allowed = hasLevel('infrastructure', 'reader');
  const canEdit = hasLevel('infrastructure', 'member');
  const initialModel = useMemo(() => filterModelFromSearch(location.search), [location.search]);
  const [selected, setSelected] = useState<VulnerabilityRow[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [openCve, setOpenCve] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [exportError, setExportError] = useState(false);
  const requestRef = useRef<ListRequest | null>(null);
  const [request, setRequest] = useState<ListRequest | null>(null);

  const severityValues = useCallback(async () => SEVERITIES.map((s) => ({ value: s, label: t(`pages.vulnerabilities.severities.${s}`) })), [t]);
  const stateValues = useCallback(async () => VULNERABILITY_STATES.map((s) => ({ value: s, label: t(`pages.vulnerabilities.states.${s}`) })), [t]);
  const editorValues = useCallback(async () => {
    const res = await api.get<{ editor?: Array<string | null> }>('/technologies/filter-values', { params: { fields: 'editor' } });
    return (res.data?.editor || []).filter((e): e is string => !!e).map((e) => ({ value: e, label: e }));
  }, []);
  const technologyValues = useCallback(async () => {
    const res = await api.get<{ items: Array<{ reference: string; name: string }> }>('/technologies', { params: { limit: 500, sort: 'name:ASC' } });
    return (res.data?.items || []).map((tech) => ({ value: tech.reference, label: `${tech.reference} ${tech.name}` }));
  }, []);

  const columns: EnhancedColDef<VulnerabilityRow>[] = useMemo(() => [
    { headerName: t('pages.vulnerabilities.columns.cve'), field: 'cve_id', width: 150, cellStyle: { fontFamily: MONO_FONT_FAMILY, fontSize: '12px' } },
    {
      headerName: t('pages.vulnerabilities.columns.severity'),
      field: 'severity',
      width: 130,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: { getValues: severityValues, searchable: false },
      cellRenderer: (p: ICellRendererParams<VulnerabilityRow>) => (p.data ? <SeverityCell severity={p.data.severity} score={p.data.cvss_score} /> : null),
    },
    { headerName: t('pages.vulnerabilities.columns.score'), field: 'cvss_score', width: 90, type: 'rightAligned', defaultHidden: true, filter: 'agNumberColumnFilter' },
    { headerName: t('pages.vulnerabilities.columns.summary'), field: 'summary', minWidth: 220, flex: 1, sortable: false, tooltipField: 'summary' },
    {
      headerName: t('pages.vulnerabilities.columns.technologies'),
      field: 'technologies',
      width: 220,
      sortable: false,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: { getValues: technologyValues },
      valueFormatter: (p: any) => technologiesText((p.value as VulnerabilityRow['technologies']) || [], t),
    },
    {
      headerName: t('pages.vulnerabilities.columns.editor'),
      field: 'editor',
      width: 130,
      sortable: false,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: { getValues: editorValues },
      tooltipField: 'editor',
    },
    { headerName: t('pages.vulnerabilities.columns.servers'), field: 'servers', width: 80, type: 'rightAligned', sortable: false, filter: false },
    { headerName: t('pages.vulnerabilities.columns.applications'), field: 'applications', width: 100, type: 'rightAligned', sortable: false, filter: false },
    {
      headerName: t('pages.vulnerabilities.columns.state'),
      field: 'state',
      width: 120,
      sortable: false,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: { getValues: stateValues, searchable: false },
      cellRenderer: (p: ICellRendererParams<VulnerabilityRow>) => (p.data ? <VulnerabilityStateCell state={p.data.state} /> : null),
    },
    {
      headerName: t('pages.vulnerabilities.columns.published'),
      field: 'published_at',
      width: 110,
      filter: 'agDateColumnFilter',
      valueFormatter: (p: any) => (p.value ? formatShortDate(p.value as string, locale, { year: 'always' }) : ''),
    },
  ], [editorValues, locale, severityValues, stateValues, t, technologyValues]);

  if (!enabled) return null;
  if (!allowed) return <ForbiddenPage />;

  const exportCsv = async () => {
    setExportError(false);
    try {
      const res = await api.get<Blob>(`${ENDPOINT}/export`, { params: scopeParams(requestRef.current), responseType: 'blob' });
      const headers = (res.headers ?? {}) as Record<string, unknown>;
      const disposition = (headers['content-disposition'] ?? headers['Content-Disposition']) as string | undefined;
      downloadBlob(new Blob([res.data], { type: 'text/csv;charset=utf-8' }), extractFilenameFromDisposition(disposition) || 'vulnerabilities.csv');
    } catch {
      setExportError(true);
    }
  };

  const actions = (
    <Stack direction="row" spacing={1}>
      {canEdit && (
        <Button variant="action" onClick={() => setBulkOpen(true)} disabled={(request?.total ?? 0) === 0}>
          {selected.length > 0
            ? t('pages.vulnerabilities.actions.changeStateSelected', { count: selected.length })
            : t('pages.vulnerabilities.actions.changeState')}
        </Button>
      )}
      <Button variant="action" onClick={() => void exportCsv()}>{t('pages.vulnerabilities.actions.export')}</Button>
    </Stack>
  );

  return (
    <>
      <PageHeader title={t('pages.vulnerabilities.title')} actions={actions} />
      {exportError && (
        <Typography role="alert" sx={{ fontSize: 13, color: 'kanap.text.secondary', mb: 1 }}>{t('pages.vulnerabilities.exportFailed')}</Typography>
      )}
      <ServerDataGrid<VulnerabilityRow>
        columns={columns}
        endpoint={ENDPOINT}
        queryKey="vulnerabilities"
        getRowId={(row) => row.cve_id}
        showRowCount
        defaultSort={{ field: 'severity', direction: 'DESC' }}
        initialState={{ filter: { filterModel: initialModel } }}
        requiredColumns={['cve_id']}
        enableColumnChooser
        columnPreferencesKey="it-vulnerabilities"
        refreshKey={refreshKey}
        enableSearch
        enableRowSelection={canEdit}
        onSelectionChanged={setSelected}
        onCellClicked={(event: any) => {
          if (event?.data?.cve_id && event.column?.getColId?.() !== 'ag-Grid-SelectionColumn') setOpenCve(event.data.cve_id);
        }}
        onListRequestChange={(next) => { requestRef.current = next; setRequest(next); }}
        emptyState={(
          <Typography sx={quietSx} data-testid="vulnerabilities-empty">
            {request?.params?.filters || request?.params?.q ? t('pages.vulnerabilities.empty.filtered') : t('pages.vulnerabilities.empty.none')}
          </Typography>
        )}
      />
      <Drawer
        anchor="right"
        open={!!openCve}
        onClose={() => setOpenCve(null)}
        PaperProps={{ sx: { width: 600, maxWidth: '90vw', bgcolor: 'kanap.bg.drawer' } }}
      >
        {openCve && (
          <Box sx={{ p: 2 }} role="region" aria-label={openCve}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
              <Typography component="h2" sx={{ fontFamily: MONO_FONT_FAMILY, fontSize: 15, fontWeight: 500 }}>{openCve}</Typography>
              <IconButton size="small" aria-label={t('pages.vulnerabilities.panel.close')} onClick={() => setOpenCve(null)}><CloseIcon fontSize="small" /></IconButton>
            </Stack>
            <VulnerabilityDetailPanel cveId={openCve} canEdit={canEdit} onChanged={() => setRefreshKey((k) => k + 1)} />
          </Box>
        )}
      </Drawer>
      {canEdit && (
        <BulkStateDialog
          open={bulkOpen}
          onClose={() => setBulkOpen(false)}
          selected={selected.map((row) => row.cve_id)}
          request={request}
          onDone={() => {
            setBulkOpen(false);
            setRefreshKey((k) => k + 1);
            void queryClient.invalidateQueries({ queryKey: ['vulnerabilities'] });
          }}
        />
      )}
    </>
  );
}
