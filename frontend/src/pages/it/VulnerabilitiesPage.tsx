import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box, Button, Checkbox, Drawer, IconButton, Link as MLink, MenuItem, Stack, TextField, Tooltip, Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import type { CellStyle, ICellRendererParams } from 'ag-grid-community';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom';
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
import { getWithListContext } from '../../lib/listContext';
import { drawerMenuItemSx, drawerSelectSx, inlineControlSx } from '../../theme/formSx';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { downloadBlob, extractFilenameFromDisposition } from '../../utils/downloadBlob';
import ForbiddenPage from '../ForbiddenPage';
import {
  SEVERITIES,
  SeverityCell,
  VULNERABILITY_STATES,
  VulnerabilityStateCell,
  versionText,
  type VulnerabilityDetail,
  type VulnerabilityGridRow,
  type VulnerabilityState,
  type VulnerabilityVersion,
} from './vulnerabilities/vulnerabilityTypes';

const ENDPOINT = '/vulnerabilities';

/** A list row: one technology, version and CVE (`GET /vulnerabilities`). */
export type VulnerabilityRow = VulnerabilityGridRow;

/**
 * The grid's filter model from the address: "to review" unless `state` says otherwise (`all`: every
 * state); `editor`, `technology` (`TEC-n`), `version` (a label, `none`: not recorded) and `severity`
 * as set filters; `q` on the CVE id; `period` (days) on the publication date. These are the entries
 * from the technologies list, the technology record and the emails.
 */
export function filterModelFromSearch(search: string): Record<string, unknown> {
  const params = new URLSearchParams(search);
  const model: Record<string, unknown> = {};
  const set = (values: Array<string | null>) => ({ filterType: 'set', values });
  const state = params.get('state');
  if (state !== 'all') model.state = set([(VULNERABILITY_STATES as readonly string[]).includes(state ?? '') ? state! : 'to_review']);
  const editor = params.get('editor');
  if (editor) model.editor = set([editor]);
  const technology = params.get('technology');
  if (technology) model.technology = set([technology]);
  const version = params.get('version');
  if (version) model.version = set([version === 'none' ? null : version]);
  const severity = params.get('severity');
  if (severity && (SEVERITIES as readonly string[]).includes(severity)) model.severity = set([severity]);
  const q = params.get('q');
  if (q) model.cve_id = { filterType: 'text', type: 'contains', filter: q };
  // `period=<days>` (the emails' link): as the email, from now less that many days, in UTC. The
  // filter takes days: "after" the day before that instant's day, so every CVE of the email shows.
  const period = Number(params.get('period'));
  if (Number.isInteger(period) && period > 0 && period <= 3650) {
    const DAY = 24 * 60 * 60 * 1000;
    const since = new Date(Date.now() - period * DAY);
    const dayBefore = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), since.getUTCDate()) - DAY);
    model.published_at = { filterType: 'date', type: 'greaterThan', dateFrom: `${dayBefore.toISOString().slice(0, 10)} 00:00:00`, dateTo: null };
  }
  return model;
}

export type AlertsFilter = 'included' | 'excluded' | 'all';

/** `alerts` on the address: included when it is absent or unknown. */
export function alertsFromSearch(search: string): AlertsFilter {
  const value = new URLSearchParams(search).get('alerts');
  return value === 'excluded' || value === 'all' ? value : 'included';
}

/** The list's parameters, without its paging, for the export and the change in bulk. */
function scopeParams(request: ListRequest | null): Record<string, unknown> {
  const { page: _page, limit: _limit, ...rest } = (request?.params ?? {}) as Record<string, unknown>;
  return rest;
}

/** A neutral link (a server, an application, a technology): underline and teal on hover only. */
function RecordLink({ to, children, quiet = false }: { to: string; children: React.ReactNode; quiet?: boolean }) {
  return (
    <MLink
      component={RouterLink}
      to={to}
      underline="hover"
      onClick={(event: React.MouseEvent) => event.stopPropagation()}
      sx={{ color: quiet ? 'kanap.text.tertiary' : 'kanap.text.primary', fontSize: 13, '&:hover': { color: 'primary.main' } }}
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

/** The count line when some of the rows stay out of the alerts. */
function inAlertsLine(
  total: number,
  alerting: number | undefined,
  t: (key: string, opts: { count: number; alerting: number }) => string,
  key: string,
): string | null {
  if (alerting == null || alerting === total) return null;
  return t(key, { count: total, alerting });
}

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
  // A version out of the alerts reads quieter, as its servers and applications below.
  const quiet = version.alerts === false;
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
      <Box
        component="span"
        sx={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          color: quiet ? 'kanap.text.tertiary' : version.potential ? 'kanap.text.secondary' : 'kanap.text.primary',
        }}
        title={quiet ? `${label} · ${t('pages.vulnerabilities.section.alerts.excluded')}` : label}
      >
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
  const serversLine = inAlertsLine(d.servers, d.alerting?.servers, t, 'pages.vulnerabilities.detail.serversInAlerts');
  const applicationsLine = d.applications == null
    ? null
    : inAlertsLine(d.applications, d.alerting?.applications, t, 'pages.vulnerabilities.detail.applicationsInAlerts');
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
          {serversLine && <Typography sx={{ ...quietSx, mb: 0.5 }}>{serversLine}</Typography>}
          {d.servers_list.length === 0 ? (
            <Typography sx={quietSx}>{t('pages.vulnerabilities.detail.noServers')}</Typography>
          ) : (
            <Box component="ul" sx={listSx}>
              {d.servers_list.map((server, index) => {
                const quiet = server.alerts === false;
                return (
                  <li key={`${server.asset_id}:${server.technology_id}:${index}`}>
                    <RecordLink to={`/it/assets/${server.asset_id}`} quiet={quiet}>{server.name ?? server.reference ?? ''}</RecordLink>
                    <Box component="span" sx={{ color: quiet ? 'kanap.text.tertiary' : 'kanap.text.secondary' }}>
                      {' · '}{server.technology_name} {versionText(server, t)}
                      {server.via_asset_name && <>{' · '}{t('pages.vulnerabilities.detail.via', { name: server.via_asset_name })}</>}
                    </Box>
                  </li>
                );
              })}
            </Box>
          )}
        </DetailBlock>
        <DetailBlock title={t('pages.vulnerabilities.detail.applications')}>
          {applicationsLine && <Typography sx={{ ...quietSx, mb: 0.5 }}>{applicationsLine}</Typography>}
          {d.applications_list === null ? (
            <Typography sx={quietSx}>{t('pages.vulnerabilities.detail.applicationsHidden')}</Typography>
          ) : d.applications_list.length === 0 ? (
            <Typography sx={quietSx}>{t('pages.vulnerabilities.detail.noApplications')}</Typography>
          ) : (
            <Box component="ul" sx={listSx}>
              {d.applications_list.map((app, index) => {
                const quiet = app.alerts === false;
                return (
                  <li key={`${app.application_id}:${index}`}>
                    <RecordLink to={`/it/applications/${app.application_id}`} quiet={quiet}>
                      {app.reference && <><RelationRef>{app.reference}</RelationRef>{' '}</>}
                      {app.name ?? ''}
                    </RecordLink>
                    <Box component="span" sx={{ color: quiet ? 'kanap.text.tertiary' : 'kanap.text.secondary' }}>
                      {' · '}{app.technology_name} {versionText(app, t)}
                      {app.server_name && <>{' · '}{app.server_name}</>}
                    </Box>
                  </li>
                );
              })}
            </Box>
          )}
        </DetailBlock>
      </Box>
    </Box>
  );
}

/**
 * The rows chosen for a change in bulk: the ticked rows (`all` false, `ids` the ticked ones), or every
 * row of the current filter, loaded or not (`all` true, `ids` the rows unticked since).
 */
type Selection = { all: boolean; ids: Set<string> };
const NO_SELECTION: Selection = { all: false, ids: new Set() };

type SelectionApi = { selection: Selection; count: number; toggleRow: (id: string) => void; toggleAll: () => void };
/** Read by the selection column's cells and header, which the grid renders inside the page. */
const SelectionContext = createContext<SelectionApi | null>(null);

const isSelected = (selection: Selection, id: string) => (selection.all ? !selection.ids.has(id) : selection.ids.has(id));
const checkboxSx = { p: 0.25 } as const;

/** A row's box in the selection column. */
function SelectRowCell({ data }: ICellRendererParams<VulnerabilityRow>) {
  const { t } = useTranslation('it');
  const api = useContext(SelectionContext);
  if (!data || !api) return null;
  return (
    <Checkbox
      size="small"
      sx={checkboxSx}
      checked={isSelected(api.selection, data.id)}
      onChange={() => api.toggleRow(data.id)}
      inputProps={{ 'aria-label': t('pages.vulnerabilities.selection.row', { cve: data.cve_id, technology: data.technology.name, version: data.version ?? t('pages.vulnerabilities.versionNone') }) }}
    />
  );
}

/** The selection column's header: every row of the current filter, loaded or not; again to clear. */
function SelectAllHeader() {
  const { t } = useTranslation('it');
  const api = useContext(SelectionContext);
  if (!api) return null;
  const whole = api.selection.all && api.selection.ids.size === 0;
  return (
    <Checkbox
      size="small"
      sx={checkboxSx}
      checked={whole}
      indeterminate={!whole && api.count > 0}
      onChange={api.toggleAll}
      inputProps={{ 'aria-label': t('pages.vulnerabilities.selection.all') }}
    />
  );
}

/** A row's version: its label, or "Not recorded" (potentially concerned) in quiet text. */
function VersionCell({ data }: ICellRendererParams<VulnerabilityRow>) {
  const { t } = useTranslation('it');
  if (!data) return null;
  if (data.version != null) return <>{data.version}</>;
  return (
    <Tooltip title={t('pages.vulnerabilities.versionNoneHint')}>
      <Box component="span" sx={{ color: 'kanap.text.tertiary' }}>{t('pages.vulnerabilities.versionNone')}</Box>
    </Tooltip>
  );
}

/**
 * The change of state in bulk: a state and a common note for the selected rows, or for every row of
 * the current filter but the unticked ones; the count comes from a dry run before the change.
 */
function BulkStateDialog({ open, onClose, selection, request, onDone }: {
  open: boolean;
  onClose: () => void;
  selection: Selection;
  request: ListRequest | null;
  onDone: () => void;
}) {
  const { t } = useTranslation('it');
  const [state, setState] = useState<VulnerabilityState>('handled');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Each opening starts afresh: a note of the previous change never goes on the next rows.
  useEffect(() => {
    if (!open) return;
    setState('handled');
    setNote('');
    setError(null);
  }, [open]);
  const ids = useMemo(() => Array.from(selection.ids), [selection.ids]);
  // The count does not depend on the note: typing it counts nothing again.
  const scope = useMemo(() => ({
    state,
    ...(selection.all
      ? { all: true, filters: scopeParams(request), ...(ids.length > 0 ? { exclude_ids: ids } : {}) }
      : { ids }),
  }), [ids, request, selection.all, state]);
  const count = useQuery({
    queryKey: ['vulnerabilities', 'bulk-count', scope],
    queryFn: async () => (await api.post<{ rows: number; cves: number; changes: number; as_of: string }>(`${ENDPOINT}/bulk-state`, { ...scope, dry_run: true })).data,
    enabled: open,
    retry: false,
    // The previous count stays on screen while the next one runs.
    placeholderData: keepPreviousData,
  });
  const body = { ...scope, ...(note.trim() ? { note: note.trim() } : {}) };
  // The cap in the page's words; another refusal (400) by its own reason; anything else (busy,
  // network) is a failed count.
  const countError = count.error as any;
  const tooMany = count.isError && countError?.response?.data?.code === 'bulk_too_many';
  const refused = count.isError && !tooMany && countError?.response?.status === 400
    ? getApiErrorMessage(countError, t, t('pages.vulnerabilities.bulk.countFailed'))
    : null;
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      // Only the rows of the count: a row found after it stays to review, and more rows than
      // counted is refused (409).
      await api.post(`${ENDPOINT}/bulk-state`, { ...body, as_of: count.data?.as_of, expected_rows: count.data?.rows });
      onDone();
    } catch (failure: any) {
      if (failure?.response?.status === 409) {
        setError(t('pages.vulnerabilities.bulk.changed'));
        void count.refetch();
      } else {
        setError(t('pages.vulnerabilities.bulk.failed'));
      }
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
      saveDisabled={!count.data || count.isPlaceholderData || count.isError || count.data.rows === 0 || (count.data.changes === 0 && note.trim() === '')}
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
            fullWidth
            value={note}
            placeholder={t('pages.vulnerabilities.detail.notePlaceholder')}
            inputProps={{ 'aria-label': t('pages.vulnerabilities.bulk.note'), maxLength: 4000 }}
            onChange={(event) => setNote(event.target.value)}
          />
        </PropertyRow>
        <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>
          {selection.all
            ? ids.length > 0 ? t('pages.vulnerabilities.bulk.scopeAllBut', { count: ids.length }) : t('pages.vulnerabilities.bulk.scopeAll')
            : t('pages.vulnerabilities.bulk.scopeSelected', { count: ids.length })}
        </Typography>
        <Typography role="status" sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>
          {tooMany
            ? t('pages.vulnerabilities.bulk.tooMany')
            : refused
              ? refused
              : count.isError
                ? t('pages.vulnerabilities.bulk.countFailed')
                : count.data
                  ? `${t('pages.vulnerabilities.bulk.count', { count: count.data.changes, rows: count.data.rows })} ${t('pages.vulnerabilities.bulk.countCves', { count: count.data.cves })}`
                  : t('pages.vulnerabilities.bulk.counting')}
        </Typography>
        <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary' }}>
          {note.trim() === ''
            ? t('pages.vulnerabilities.bulk.noteKept')
            : t('pages.vulnerabilities.bulk.noteAll', { count: count.data?.rows ?? 0 })}
        </Typography>
        {error && <Typography role="alert" sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>{error}</Typography>}
      </Stack>
    </KanapDialog>
  );
}

/** The column of the row boxes: its header ticks every row of the filter. */
const SELECTION_COLUMN = 'select';
/** The box alone, centred: the cell's padding would push it past 44 px and cut it ("…"). */
const SELECT_CELL_STYLE: CellStyle = { padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', textOverflow: 'clip' };
/** Stable: a new function would have AG Grid draw its rows again. */
const rowId = (row: VulnerabilityRow) => row.id;

/**
 * IT › Vulnerabilities (lots T6b, T6c): one row per technology, version and published CVE (NVD) of
 * the workspace, on the list grid of the repository (filters per column, version included, columns
 * chosen and kept, sort, total, export), "to review" by default and most severe first. Ticked rows,
 * or every row of the filter (the header box), change state at once; a row opens its CVE in a side
 * panel. Shown only while the vulnerability feed is on (`features.vulnerabilityFeed`).
 */
export default function VulnerabilitiesPage() {
  const { t } = useTranslation(['it', 'common']);
  const locale = useLocale();
  const location = useLocation();
  const navigate = useNavigate();
  const alerts = alertsFromSearch(location.search);
  const extraParams = useMemo(() => ({ alerts }), [alerts]);
  const queryClient = useQueryClient();
  const { hasLevel } = useAuth();
  const { config } = useFeatures();
  const enabled = config.features.vulnerabilityFeed === true;
  const allowed = hasLevel('infrastructure', 'reader');
  const canEdit = hasLevel('infrastructure', 'member');
  const initialModel = useMemo(() => filterModelFromSearch(location.search), [location.search]);
  const [selection, setSelection] = useState<Selection>(NO_SELECTION);
  const [refreshKey, setRefreshKey] = useState(0);
  const [openCve, setOpenCve] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [exportError, setExportError] = useState(false);
  const requestRef = useRef<ListRequest | null>(null);
  const [request, setRequest] = useState<ListRequest | null>(null);
  // The filters (and search) of the rows on screen: a change clears the selection.
  const scopeKeyRef = useRef<string | null>(null);

  const selectedCount = selection.all ? Math.max((request?.total ?? 0) - selection.ids.size, 0) : selection.ids.size;
  const toggleRow = useCallback((id: string) => setSelection((current) => {
    const ids = new Set(current.ids);
    if (ids.has(id)) ids.delete(id);
    else ids.add(id);
    return { all: current.all, ids };
  }), []);
  const toggleAll = useCallback(() => setSelection((current) => (
    current.all && current.ids.size === 0 ? NO_SELECTION : { all: true, ids: new Set<string>() }
  )), []);
  const selectionApi = useMemo<SelectionApi>(
    () => ({ selection, count: selectedCount, toggleRow, toggleAll }),
    [selection, selectedCount, toggleRow, toggleAll],
  );

  // The grid's total in rows, and in CVE as the counters of the technologies list and record.
  const rowCountText = useCallback(
    (answer: { total: number } & Record<string, unknown>) => t('pages.vulnerabilities.total', { count: answer.total, cves: Number(answer.cves ?? 0) }),
    [t],
  );
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
  // The labels of the versions the other filters reach, then "Not recorded".
  const versionValues = useCallback(async ({ context }: { context?: any }) => {
    const state = context?.getQueryState?.() ?? {};
    const filters = { ...(state.filters || {}) };
    delete filters.version;
    const params: Record<string, unknown> = { fields: 'version' };
    if (state.q) params.q = state.q;
    if (Object.keys(filters).length > 0) params.filters = JSON.stringify(filters);
    params.alerts = alerts;
    const res = await getWithListContext<{ version?: Array<string | null> }>(`${ENDPOINT}/filter-values`, params);
    return (res.data?.version || []).map((value) => ({ value, label: value ?? t('pages.vulnerabilities.versionNone') }));
  }, [alerts, t]);

  const columns: EnhancedColDef<VulnerabilityRow>[] = useMemo(() => [
    ...(canEdit ? [{
      colId: SELECTION_COLUMN,
      headerName: '',
      width: 44,
      minWidth: 44,
      maxWidth: 44,
      lockPosition: 'left' as const,
      suppressColumnsToolPanel: true,
      suppressMovable: true,
      resizable: false,
      sortable: false,
      filter: false,
      suppressHeaderMenuButton: true,
      cellStyle: SELECT_CELL_STYLE,
      headerComponent: SelectAllHeader,
      cellRenderer: SelectRowCell,
      // Space on the focused cell or header ticks, as the box would (AG Grid keeps the focus on the cell).
      suppressKeyboardEvent: (params: any) => {
        if (params.editing || params.event.key !== ' ') return false;
        if (params.event.type === 'keydown' && params.data?.id) {
          params.event.preventDefault();
          toggleRow(params.data.id);
        }
        return true;
      },
      suppressHeaderKeyboardEvent: (params: any) => {
        if (params.event.key !== ' ') return false;
        if (params.event.type === 'keydown') {
          params.event.preventDefault();
          toggleAll();
        }
        return true;
      },
    }] : []),
    { headerName: t('pages.vulnerabilities.columns.cve'), field: 'cve_id', width: 125, cellStyle: { fontFamily: MONO_FONT_FAMILY, fontSize: '12px' } },
    {
      headerName: t('pages.vulnerabilities.columns.severity'),
      field: 'severity',
      width: 105,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: { getValues: severityValues, searchable: false },
      cellRenderer: (p: ICellRendererParams<VulnerabilityRow>) => (p.data ? <SeverityCell severity={p.data.severity} score={p.data.cvss_score} /> : null),
    },
    { headerName: t('pages.vulnerabilities.columns.score'), field: 'cvss_score', width: 90, type: 'rightAligned', defaultHidden: true, filter: 'agNumberColumnFilter' },
    { headerName: t('pages.vulnerabilities.columns.summary'), field: 'summary', minWidth: 115, flex: 1, sortable: false, tooltipField: 'summary' },
    {
      headerName: t('pages.vulnerabilities.columns.technology'),
      field: 'technology',
      width: 150,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: { getValues: technologyValues },
      valueFormatter: (p: any) => {
        const tech = p.value as VulnerabilityRow['technology'] | undefined;
        return tech ? [tech.reference, tech.name].filter(Boolean).join(' ') : '';
      },
    },
    {
      headerName: t('pages.vulnerabilities.columns.version'),
      field: 'version',
      // "Non renseignée" and "Nicht erfasst" whole.
      width: 125,
      sortable: false,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: { getValues: versionValues, emptyLabel: t('pages.vulnerabilities.versionNone') },
      cellRenderer: VersionCell,
    },
    {
      headerName: t('pages.vulnerabilities.columns.editor'),
      field: 'editor',
      width: 130,
      // Hidden by default: the default set fits a 1,440 px window (the column chooser shows it).
      defaultHidden: true,
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
      width: 115,
      sortable: false,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: { getValues: stateValues, searchable: false },
      cellRenderer: (p: ICellRendererParams<VulnerabilityRow>) => (p.data ? <VulnerabilityStateCell state={p.data.state} /> : null),
    },
    { headerName: t('pages.vulnerabilities.columns.note'), field: 'note', width: 200, defaultHidden: true, sortable: false, filter: false, tooltipField: 'note' },
    {
      headerName: t('pages.vulnerabilities.columns.published'),
      field: 'published_at',
      width: 105,
      filter: 'agDateColumnFilter',
      valueFormatter: (p: any) => (p.value ? formatShortDate(p.value as string, locale, { year: 'always' }) : ''),
    },
  ], [canEdit, editorValues, locale, severityValues, stateValues, t, technologyValues, toggleAll, toggleRow, versionValues]);

  const setAlerts = (next: AlertsFilter) => {
    const params = new URLSearchParams(location.search);
    if (next === 'included') params.delete('alerts');
    else params.set('alerts', next);
    const search = params.toString();
    navigate({ pathname: location.pathname, search: search ? `?${search}` : '' }, { replace: true });
  };

  // Muted rows inform only when both kinds are listed: under "Excluded" every row would be muted.
  const getRowClass = useCallback(
    ({ data }: { data?: VulnerabilityRow }) => (alerts === 'all' && data?.alerts === false ? 'vulnerability-row-muted' : undefined),
    [alerts],
  );

  // Nothing alerts, with no search and no column filter: are there rows outside the alerts? The
  // empty line then says so and offers them, rather than telling to fill in CPE identifiers.
  const nothingAlerts = alerts === 'included' && request?.total === 0 && !request.params?.filters && !request.params?.q;
  const excludedRows = useQuery({
    queryKey: ['vulnerabilities', 'excluded-rows'],
    queryFn: async () => Number((await api.get<{ total: number }>(ENDPOINT, { params: { alerts: 'excluded', page: 1, limit: 1 } })).data?.total ?? 0),
    enabled: enabled && allowed && nothingAlerts,
    retry: false,
  });

  const alertsFilter = (
    <Stack direction="row" spacing={0.75} alignItems="center">
      <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>{t('pages.vulnerabilities.alerts.label')}</Typography>
      <TextField
        select
        variant="standard"
        value={alerts}
        onChange={(event) => setAlerts(event.target.value as AlertsFilter)}
        sx={inlineControlSx}
        SelectProps={{ MenuProps: reportFilterMenuProps, inputProps: { 'aria-label': t('pages.vulnerabilities.alerts.label') } }}
      >
        <MenuItem value="included" sx={drawerMenuItemSx}>{t('pages.vulnerabilities.alerts.included')}</MenuItem>
        <MenuItem value="excluded" sx={drawerMenuItemSx}>{t('pages.vulnerabilities.alerts.excluded')}</MenuItem>
        <MenuItem value="all" sx={drawerMenuItemSx}>{t('pages.vulnerabilities.alerts.all')}</MenuItem>
      </TextField>
    </Stack>
  );

  if (!enabled) return null;
  if (!allowed) return <ForbiddenPage />;

  const exportCsv = async () => {
    setExportError(false);
    try {
      // Long filters go as a saved list context, as the other list exports.
      const res = await getWithListContext<Blob>(`${ENDPOINT}/export`, scopeParams(requestRef.current), { responseType: 'blob' });
      const headers = (res.headers ?? {}) as Record<string, unknown>;
      const disposition = (headers['content-disposition'] ?? headers['Content-Disposition']) as string | undefined;
      downloadBlob(new Blob([res.data], { type: 'text/csv;charset=utf-8' }), extractFilenameFromDisposition(disposition) || 'vulnerabilities.csv');
    } catch {
      setExportError(true);
    }
  };

  const actions = (
    <Stack direction="row" spacing={1} alignItems="center">
      {canEdit && selectedCount > 0 && (
        <>
          <Typography data-testid="vulnerabilities-selection" sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>
            {selection.all
              ? t('pages.vulnerabilities.selection.whole', { count: selectedCount })
              : t('pages.vulnerabilities.selection.some', { count: selectedCount })}
          </Typography>
          <Button variant="action" onClick={() => setSelection(NO_SELECTION)}>{t('pages.vulnerabilities.selection.clear')}</Button>
        </>
      )}
      {canEdit && (
        <Button variant="action" onClick={() => setBulkOpen(true)} disabled={selectedCount === 0}>
          {selectedCount > 0
            ? t('pages.vulnerabilities.actions.changeStateSelected', { count: selectedCount })
            : t('pages.vulnerabilities.actions.changeState')}
        </Button>
      )}
      <Button variant="action" onClick={() => void exportCsv()}>{t('pages.vulnerabilities.actions.export')}</Button>
    </Stack>
  );

  return (
    <SelectionContext.Provider value={selectionApi}>
      <PageHeader title={t('pages.vulnerabilities.title')} actions={actions} />
      {exportError && (
        <Typography role="alert" sx={{ fontSize: 13, color: 'kanap.text.secondary', mb: 1 }}>{t('pages.vulnerabilities.exportFailed')}</Typography>
      )}
      {/* The header of the box column: the box alone, centred, without the cell's padding. */}
      <Box sx={{
        '& .ag-header-cell[col-id="select"]': { px: 0 },
        '& .ag-header-cell[col-id="select"] .ag-header-cell-comp-wrapper': { justifyContent: 'center' },
        '& .vulnerability-row-muted .ag-cell': { color: 'kanap.text.tertiary' },
      }}
      >
      <ServerDataGrid<VulnerabilityRow>
        columns={columns}
        endpoint={ENDPOINT}
        queryKey="vulnerabilities"
        extraParams={extraParams}
        extraNarrows={alerts !== 'included'}
        onResetFilters={() => setAlerts('included')}
        toolbarExtras={alertsFilter}
        getRowClass={getRowClass}
        getRowId={rowId}
        showRowCount
        rowCountText={rowCountText}
        defaultSort={{ field: 'severity', direction: 'DESC' }}
        initialState={{ filter: { filterModel: initialModel } }}
        requiredColumns={['cve_id']}
        enableColumnChooser
        columnPreferencesKey="it-vulnerabilities"
        refreshKey={refreshKey}
        enableSearch
        onCellClicked={(event: any) => {
          if (!event?.data?.id) return;
          if (event.column?.getColId?.() !== SELECTION_COLUMN) {
            setOpenCve(event.data.cve_id);
            return;
          }
          // A click in the selection cell beside the box ticks it too; the box ticks itself.
          const target = event.event?.target as HTMLElement | undefined;
          if (!target?.closest?.('input')) toggleRow(event.data.id);
        }}
        onListRequestChange={(next) => {
          requestRef.current = next;
          setRequest(next);
          const { sort: _sort, ...scope } = scopeParams(next);
          const key = JSON.stringify(scope);
          if (scopeKeyRef.current !== null && scopeKeyRef.current !== key) setSelection(NO_SELECTION);
          scopeKeyRef.current = key;
        }}
        emptyState={(
          nothingAlerts && (excludedRows.data ?? 0) > 0 ? (
            <Stack alignItems="center" spacing={0.5} data-testid="vulnerabilities-empty">
              <Typography sx={quietSx}>{t('pages.vulnerabilities.empty.noneInAlerts')}</Typography>
              <Button size="small" onClick={() => setAlerts('excluded')}>{t('pages.vulnerabilities.empty.showExcluded')}</Button>
            </Stack>
          ) : (
            <Typography sx={quietSx} data-testid="vulnerabilities-empty">
              {request?.params?.filters || request?.params?.q || alerts !== 'included'
                ? t('pages.vulnerabilities.empty.filtered')
                : t('pages.vulnerabilities.empty.none')}
            </Typography>
          )
        )}
      />
      </Box>
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
            <VulnerabilityDetailPanel
              cveId={openCve}
              canEdit={canEdit}
              // The rows change: a selection made on the rows before would not be the one on screen.
              onChanged={() => { setSelection(NO_SELECTION); setRefreshKey((k) => k + 1); }}
            />
          </Box>
        )}
      </Drawer>
      {canEdit && (
        <BulkStateDialog
          open={bulkOpen}
          onClose={() => setBulkOpen(false)}
          selection={selection}
          request={request}
          onDone={() => {
            setBulkOpen(false);
            setSelection(NO_SELECTION);
            setRefreshKey((k) => k + 1);
            void queryClient.invalidateQueries({ queryKey: ['vulnerabilities'] });
          }}
        />
      )}
    </SelectionContext.Provider>
  );
}
