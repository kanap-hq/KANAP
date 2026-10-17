import React, { useEffect, useMemo, useState } from 'react';
import { Box, Button, Link as MLink, MenuItem, TextField, Typography, useTheme } from '@mui/material';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import api from '../../api';
import { useAuth } from '../../auth/AuthContext';
import ReportDataStatus from '../../components/reports/ReportDataStatus';
import ReportLayout, { ReportFilter, reportFilterMenuProps, reportFilterSelectSx } from '../../components/reports/ReportLayout';
import { RelationRef } from '../../components/workspace/RelationsTable';
import { useFeatures } from '../../config/FeaturesContext';
import { MONO_FONT_FAMILY } from '../../config/ThemeContext';
import { useLocale } from '../../i18n/useLocale';
import { formatShortDate } from '../../lib/dateFormat';
import { drawerMenuItemSx, inlineControlSx } from '../../theme/formSx';
import { downloadBlob, extractFilenameFromDisposition } from '../../utils/downloadBlob';
import ForbiddenPage from '../ForbiddenPage';
import {
  overallState,
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
const PAGE = 100;
/** Publication periods, in days. */
export const PERIODS = [30, 90, 365] as const;

type ListResponse = { items: VulnerabilityItem[]; total: number; limit: number; offset: number };

/** `YYYY-MM-DD`, `days` ago. */
function daysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

/** Dense table chrome, as `RelationsTable`: 12/500 tertiary headers, 13px cells, horizontal borders only. */
function useTableSx() {
  const theme = useTheme();
  return {
    width: '100%',
    borderCollapse: 'collapse',
    tableLayout: 'fixed',
    '& th': {
      fontSize: 12,
      fontWeight: 500,
      color: 'kanap.text.tertiary',
      textAlign: 'left',
      p: '0 8px 6px 0',
      borderBottom: `1px solid ${theme.palette.kanap.border.default}`,
    },
    '& td': {
      fontSize: 13,
      color: 'kanap.text.primary',
      p: '7px 8px 7px 0',
      borderBottom: `1px solid ${theme.palette.kanap.border.soft}`,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      verticalAlign: 'top',
    },
    '& .r': { textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
    '& tbody tr.row:hover td': { backgroundColor: theme.palette.kanap.bg.hover },
    '& tbody tr.row': { cursor: 'pointer' },
    '& tbody tr.row:focus-visible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: -2 },
    '& tbody tr.detail td': { whiteSpace: 'normal', backgroundColor: theme.palette.kanap.bg.drawer, p: '12px 12px 14px 28px' },
  } as const;
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

/** One CVE opened under its row: what it says, what it touches, and its state per technology version. */
function VulnerabilityDetailPanel({ cveId, canEdit }: { cveId: string; canEdit: boolean }) {
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
  const onSaved = () => { void queryClient.invalidateQueries({ queryKey: ['vulnerabilities'] }); };
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

function VulnerabilitiesTable({ items, canEdit }: { items: VulnerabilityItem[]; canEdit: boolean }) {
  const { t } = useTranslation('it');
  const locale = useLocale();
  const sx = useTableSx();
  const [open, setOpen] = useState<string | null>(null);
  const applicationsVisible = items.some((item) => item.applications !== null);
  const columns = applicationsVisible ? 9 : 8;
  return (
    <Box component="table" sx={sx} aria-label={t('pages.vulnerabilities.title')}>
      <colgroup>
        <col style={{ width: 24 }} />
        <col style={{ width: 150 }} />
        <col style={{ width: 120 }} />
        <col />
        <col style={{ width: '26%' }} />
        <col style={{ width: 70 }} />
        {applicationsVisible && <col style={{ width: 96 }} />}
        <col style={{ width: 120 }} />
        <col style={{ width: 100 }} />
      </colgroup>
      <thead>
        <tr>
          <th aria-hidden />
          <th>{t('pages.vulnerabilities.columns.cve')}</th>
          <th>{t('pages.vulnerabilities.columns.severity')}</th>
          <th>{t('pages.vulnerabilities.columns.summary')}</th>
          <th>{t('pages.vulnerabilities.columns.technologies')}</th>
          <th className="r">{t('pages.vulnerabilities.columns.servers')}</th>
          {applicationsVisible && <th className="r">{t('pages.vulnerabilities.columns.applications')}</th>}
          <th>{t('pages.vulnerabilities.columns.state')}</th>
          <th>{t('pages.vulnerabilities.columns.published')}</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => {
          const expanded = open === item.cve_id;
          const toggle = () => setOpen(expanded ? null : item.cve_id);
          const technologies = technologiesText(item.technologies, t);
          return (
            <React.Fragment key={item.cve_id}>
              <tr
                className="row"
                tabIndex={0}
                aria-expanded={expanded}
                onClick={toggle}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(); }
                }}
              >
                <td>
                  {expanded
                    ? <KeyboardArrowDownIcon sx={{ fontSize: 16, color: 'kanap.text.tertiary', verticalAlign: 'middle' }} />
                    : <KeyboardArrowRightIcon sx={{ fontSize: 16, color: 'kanap.text.tertiary', verticalAlign: 'middle' }} />}
                </td>
                <td style={{ fontFamily: MONO_FONT_FAMILY, fontSize: 12 }}>{item.cve_id}</td>
                <td><SeverityCell severity={item.severity} score={item.cvss_score} /></td>
                <td title={item.summary ?? ''}>{item.summary ?? ''}</td>
                <td title={technologies}>{technologies}</td>
                <td className="r">{item.servers}</td>
                {applicationsVisible && <td className="r">{item.applications ?? ''}</td>}
                <td><VulnerabilityStateCell state={overallState(item.technologies.flatMap((tech) => tech.versions))} /></td>
                <td>{item.published_at ? formatShortDate(item.published_at, locale, { year: 'always' }) : ''}</td>
              </tr>
              {expanded && (
                <tr className="detail">
                  <td colSpan={columns}><VulnerabilityDetailPanel cveId={item.cve_id} canEdit={canEdit} /></td>
                </tr>
              )}
            </React.Fragment>
          );
        })}
      </tbody>
    </Box>
  );
}

/**
 * IT › Vulnerabilities (lot T6b): the published CVE (NVD) matched with the technologies of the
 * workspace, most severe first, "to review" by default, with the servers and applications each
 * reaches. Built on `ReportLayout`, as the end of support report. Shown only while the vulnerability
 * feed is on (`features.vulnerabilityFeed`).
 */
export default function VulnerabilitiesPage() {
  const { t } = useTranslation(['it', 'common']);
  const { hasLevel } = useAuth();
  const { config } = useFeatures();
  const enabled = config.features.vulnerabilityFeed === true;
  const allowed = hasLevel('infrastructure', 'reader');
  const canEdit = hasLevel('infrastructure', 'member');
  const [params, setParams] = useSearchParams();
  const [limit, setLimit] = useState(PAGE);
  const [exportError, setExportError] = useState(false);

  const severity = (SEVERITIES as readonly string[]).includes(params.get('severity') ?? '') ? params.get('severity')! : '';
  const stateParam = params.get('state');
  // "To review" unless the URL says otherwise ("all": every state).
  const state = stateParam === 'all' ? '' : (VULNERABILITY_STATES as readonly string[]).includes(stateParam ?? '') ? stateParam! : 'to_review';
  const editor = params.get('editor') ?? '';
  const technology = params.get('technology') ?? '';
  const periodParam = Number(params.get('period'));
  const period = (PERIODS as readonly number[]).includes(periodParam) ? periodParam : 0;
  const q = params.get('q') ?? '';
  const [search, setSearch] = useState(q);

  const setParam = (key: string, value: string | null) => {
    setLimit(PAGE);
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value); else next.delete(key);
      return next;
    }, { replace: true });
  };

  // The search applies 300 ms after the last key.
  useEffect(() => {
    if (search.trim() === q) return undefined;
    const timer = setTimeout(() => setParam('q', search.trim() || null), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const filters = useMemo(() => ({
    ...(severity ? { severity } : {}),
    ...(state ? { state } : {}),
    ...(editor ? { editor } : {}),
    ...(technology ? { technology } : {}),
    ...(period ? { from: daysAgo(period) } : {}),
    ...(q ? { q } : {}),
  }), [severity, state, editor, technology, period, q]);

  const list = useQuery({
    queryKey: ['vulnerabilities', 'list', filters, limit],
    queryFn: async () => (await api.get<ListResponse>(ENDPOINT, { params: { ...filters, limit } })).data,
    enabled: enabled && allowed,
    placeholderData: (previous) => previous,
  });
  const editors = useQuery({
    queryKey: ['technologies', 'filter-values', 'editor'],
    queryFn: async () => (await api.get<{ editor?: Array<string | null> }>('/technologies/filter-values', { params: { fields: 'editor' } })).data,
    enabled: enabled && allowed,
  });
  const technologies = useQuery({
    queryKey: ['technologies', 'options'],
    queryFn: async () => (await api.get<{ items: Array<{ id: string; reference: string; name: string }> }>('/technologies', { params: { limit: 500, sort: 'name:ASC' } })).data,
    enabled: enabled && allowed,
  });

  // Feed off: the page does not exist (its route and its navigation entry are gone too).
  if (!enabled) return null;
  if (!allowed) return <ForbiddenPage />;

  const editorOptions = Array.from(new Set([...(editors.data?.editor ?? []).filter((e): e is string => !!e), ...(editor ? [editor] : [])]));
  const technologyOptions = technologies.data?.items ?? [];

  const exportCsv = async () => {
    setExportError(false);
    try {
      const res = await api.get<Blob>(`${ENDPOINT}/export`, { params: filters, responseType: 'blob' });
      const headers = (res.headers ?? {}) as Record<string, unknown>;
      const disposition = (headers['content-disposition'] ?? headers['Content-Disposition']) as string | undefined;
      downloadBlob(new Blob([res.data], { type: 'text/csv;charset=utf-8' }), extractFilenameFromDisposition(disposition) || 'vulnerabilities.csv');
    } catch {
      setExportError(true);
    }
  };

  const select = (label: string, width: number, value: string, onChange: (value: string) => void, allLabel: string, options: Array<{ value: string; label: string }>) => (
    <ReportFilter label={label} width={width}>
      <TextField
        select
        size="small"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        SelectProps={{ displayEmpty: true, MenuProps: reportFilterMenuProps, inputProps: { 'aria-label': label } }}
        sx={reportFilterSelectSx}
      >
        <MenuItem value="" sx={drawerMenuItemSx}>{allLabel}</MenuItem>
        {options.map((option) => <MenuItem key={option.value} value={option.value} sx={drawerMenuItemSx}>{option.label}</MenuItem>)}
      </TextField>
    </ReportFilter>
  );

  const items = list.data?.items ?? [];
  const filtered = Object.keys(filters).some((key) => key !== 'state') || state !== 'to_review';

  return (
    <ReportLayout
      title={t('pages.vulnerabilities.title')}
      subtitle={t('pages.vulnerabilities.subtitle')}
      busy={list.isFetching}
      onExportTableCsv={() => void exportCsv()}
      filters={(
        <>
          {select(t('pages.vulnerabilities.filters.severity'), 130, severity, (v) => setParam('severity', v || null), t('pages.vulnerabilities.filters.allSeverities'),
            SEVERITIES.map((s) => ({ value: s, label: t(`pages.vulnerabilities.severities.${s}`) })))}
          {select(t('pages.vulnerabilities.filters.state'), 140, stateParam === 'all' ? '' : state, (v) => setParam('state', v === 'to_review' ? null : (v || 'all')), t('pages.vulnerabilities.filters.allStates'),
            VULNERABILITY_STATES.map((s) => ({ value: s, label: t(`pages.vulnerabilities.states.${s}`) })))}
          {select(t('pages.vulnerabilities.filters.editor'), 150, editor, (v) => setParam('editor', v || null), t('pages.vulnerabilities.filters.allEditors'),
            editorOptions.map((e) => ({ value: e, label: e })))}
          {select(t('pages.vulnerabilities.filters.technology'), 180, technology, (v) => setParam('technology', v || null), t('pages.vulnerabilities.filters.allTechnologies'),
            [
              ...technologyOptions.map((tech) => ({ value: tech.reference, label: `${tech.reference} ${tech.name}` })),
              ...(technology && !technologyOptions.some((tech) => tech.reference === technology) ? [{ value: technology, label: technology }] : []),
            ])}
          {select(t('pages.vulnerabilities.filters.period'), 150, period ? String(period) : '', (v) => setParam('period', v || null), t('pages.vulnerabilities.filters.anyTime'),
            PERIODS.map((days) => ({ value: String(days), label: t('pages.vulnerabilities.filters.lastDays', { count: days }) })))}
          <ReportFilter label={t('pages.vulnerabilities.filters.search')} width={200}>
            <TextField
              size="small"
              value={search}
              placeholder={t('pages.vulnerabilities.filters.searchPlaceholder')}
              onChange={(event) => setSearch(event.target.value)}
              inputProps={{ 'aria-label': t('pages.vulnerabilities.filters.search') }}
              sx={reportFilterSelectSx}
            />
          </ReportFilter>
        </>
      )}
    >
      {exportError && (
        <Typography role="alert" sx={{ fontSize: 13, color: 'kanap.text.secondary', mb: 1 }}>{t('pages.vulnerabilities.exportFailed')}</Typography>
      )}
      {list.data && (
        items.length === 0 ? (
          <Typography sx={quietSx} data-testid="vulnerabilities-empty">
            {filtered ? t('pages.vulnerabilities.empty.filtered') : t('pages.vulnerabilities.empty.none')}
          </Typography>
        ) : (
          <>
            <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary', mb: 1 }}>
              {t('pages.vulnerabilities.count', { count: list.data.total })}
            </Typography>
            <VulnerabilitiesTable items={items} canEdit={canEdit} />
            {list.data.total > items.length && (
              <Button variant="action" sx={{ mt: 1.5 }} onClick={() => setLimit((current) => current + PAGE)}>
                {t('pages.vulnerabilities.showMore')}
              </Button>
            )}
          </>
        )
      )}
      {(!list.data || list.isError) && (
        <ReportDataStatus loading={list.isLoading} error={list.isError} onRetry={() => void list.refetch()} />
      )}
    </ReportLayout>
  );
}
