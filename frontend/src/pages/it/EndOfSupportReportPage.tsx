import React, { useMemo, useState } from 'react';
import { Box, Link as MLink, MenuItem, Tab, Tabs, TextField, Typography, useTheme } from '@mui/material';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { StatusDot } from '../../components/design';
import ReportDataStatus from '../../components/reports/ReportDataStatus';
import ReportLayout, { ReportFilter, reportFilterMenuProps, reportFilterSelectSx } from '../../components/reports/ReportLayout';
import { RelationRef } from '../../components/workspace/RelationsTable';
import { useLocale } from '../../i18n/useLocale';
import { formatShortDate } from '../../lib/dateFormat';
import { drawerMenuItemSx, textTabSx, textTabsSx } from '../../theme/formSx';
import { downloadBlob, extractFilenameFromDisposition } from '../../utils/downloadBlob';
import { getDotColor, SUPPORT_STATE_COLORS } from '../../utils/statusColors';
import ForbiddenPage from '../ForbiddenPage';

export const HORIZONS = [6, 12, 24, 36] as const;
export const DEADLINE_TYPES = ['technology', 'operating_system', 'application', 'hardware'] as const;
type DeadlineType = (typeof DEADLINE_TYPES)[number];
type View = 'deadlines' | 'gaps';

type ServerRef = { id: string; name: string };
type ApplicationRef = { id: string; name: string; reference: string | null };

export type DeadlineRow = {
  key: string;
  type: DeadlineType;
  item_id: string | null;
  item_name: string;
  item_reference: string | null;
  version: string | null;
  milestone: 'end_of_life' | 'support_contract' | null;
  date: string;
  state: 'out_of_support' | 'extended_support' | 'upcoming';
  server_count: number;
  servers: ServerRef[];
  application_count: number | null;
  applications: ApplicationRef[] | null;
};

export type GapRow = {
  key: string;
  gap: string;
  subject_type: 'application' | 'asset' | 'technology';
  subject_id: string;
  subject_name: string;
  subject_reference: string | null;
  related_type: 'asset' | 'application' | null;
  related_id: string | null;
  related_name: string | null;
  version: string | null;
};

const ENDPOINT = '/technologies/reports/end-of-support';

const RECORD_PATHS: Record<string, string> = {
  technology: '/it/technologies',
  application: '/it/applications',
  asset: '/it/assets',
  hardware: '/it/assets',
};

/** The page of a record of the report, or null (an operating system has none yet). */
function recordPath(type: string, id: string | null): string | null {
  const base = RECORD_PATHS[type];
  return base && id ? `${base}/${id}` : null;
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
    '& tbody tr.detail td': { whiteSpace: 'normal', backgroundColor: theme.palette.kanap.bg.drawer, p: '10px 12px 12px 28px' },
  } as const;
}

function StateCell({ state }: { state: DeadlineRow['state'] }) {
  const { t } = useTranslation('it');
  const theme = useTheme();
  const color = getDotColor(SUPPORT_STATE_COLORS[state], theme.palette.mode);
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 500, color }}>
      <StatusDot color={color} />
      {t(`pages.endOfSupport.states.${state}`)}
    </Box>
  );
}

/** A neutral link inside the detail: underline and teal on hover only. */
function DetailLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <MLink component={RouterLink} to={to} underline="hover" sx={{ color: 'kanap.text.primary', fontSize: 13, '&:hover': { color: 'primary.main' } }}>
      {children}
    </MLink>
  );
}

function DetailList({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'kanap.text.tertiary', mb: 0.5 }}>{title}</Typography>
      {children.length === 0 ? (
        <Typography sx={{ fontSize: 13, color: 'kanap.text.tertiary' }}>{empty}</Typography>
      ) : (
        <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {children.map((child, index) => <li key={index}>{child}</li>)}
        </Box>
      )}
    </Box>
  );
}

function DeadlineDetail({ row }: { row: DeadlineRow }) {
  const { t } = useTranslation('it');
  const own = recordPath(row.type, row.item_id);
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 3 }}>
      <DetailList title={t('pages.endOfSupport.detail.servers')} empty={t('pages.endOfSupport.detail.noServers')}>
        {row.servers.map((server) => <DetailLink key={server.id} to={`/it/assets/${server.id}`}>{server.name}</DetailLink>)}
      </DetailList>
      {row.applications ? (
        <DetailList title={t('pages.endOfSupport.detail.applications')} empty={t('pages.endOfSupport.detail.noApplications')}>
          {row.applications.map((app) => (
            <DetailLink key={app.id} to={`/it/applications/${app.id}`}>
              {app.reference && <><RelationRef>{app.reference}</RelationRef>{' '}</>}
              {app.name}
            </DetailLink>
          ))}
        </DetailList>
      ) : (
        <Typography sx={{ fontSize: 13, color: 'kanap.text.tertiary' }}>{t('pages.endOfSupport.detail.applicationsHidden')}</Typography>
      )}
      {own && (
        <Box sx={{ gridColumn: '1 / -1' }}>
          <DetailLink to={own}>{t(`pages.endOfSupport.detail.open.${row.type}`)}</DetailLink>
        </Box>
      )}
    </Box>
  );
}

function DeadlinesTable({ rows, applicationsVisible }: { rows: DeadlineRow[]; applicationsVisible: boolean }) {
  const { t } = useTranslation('it');
  const locale = useLocale();
  const sx = useTableSx();
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = (key: string) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const columns = applicationsVisible ? 8 : 7;
  return (
    <Box component="table" sx={sx} aria-label={t('pages.endOfSupport.tabs.deadlines')}>
      <colgroup>
        <col style={{ width: 24 }} />
        <col style={{ width: 140 }} />
        <col />
        <col style={{ width: 140 }} />
        <col style={{ width: 110 }} />
        <col style={{ width: 150 }} />
        <col style={{ width: 80 }} />
        {applicationsVisible && <col style={{ width: 100 }} />}
      </colgroup>
      <thead>
        <tr>
          <th aria-hidden />
          <th>{t('pages.endOfSupport.columns.type')}</th>
          <th>{t('pages.endOfSupport.columns.item')}</th>
          <th>{t('pages.endOfSupport.columns.version')}</th>
          <th>{t('pages.endOfSupport.columns.date')}</th>
          <th>{t('pages.endOfSupport.columns.state')}</th>
          <th className="r">{t('pages.endOfSupport.columns.servers')}</th>
          {applicationsVisible && <th className="r">{t('pages.endOfSupport.columns.applications')}</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const expanded = open.has(row.key);
          return (
            <React.Fragment key={row.key}>
              <tr
                className="row"
                tabIndex={0}
                aria-expanded={expanded}
                onClick={() => toggle(row.key)}
                onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(row.key); } }}
              >
                <td>
                  {expanded
                    ? <KeyboardArrowDownIcon sx={{ fontSize: 16, color: 'kanap.text.tertiary', verticalAlign: 'middle' }} />
                    : <KeyboardArrowRightIcon sx={{ fontSize: 16, color: 'kanap.text.tertiary', verticalAlign: 'middle' }} />}
                </td>
                <td>{t(`pages.endOfSupport.types.${row.type}`)}</td>
                <td>
                  {row.item_reference && <><RelationRef>{row.item_reference}</RelationRef>{' '}</>}
                  {row.item_name}
                </td>
                <td>{row.version ?? (row.milestone ? t(`pages.endOfSupport.milestones.${row.milestone}`) : '')}</td>
                <td>{formatShortDate(row.date, locale, { year: 'always' })}</td>
                <td><StateCell state={row.state} /></td>
                <td className="r">{row.server_count}</td>
                {applicationsVisible && <td className="r">{row.application_count ?? ''}</td>}
              </tr>
              {expanded && (
                <tr className="detail">
                  <td colSpan={columns}><DeadlineDetail row={row} /></td>
                </tr>
              )}
            </React.Fragment>
          );
        })}
      </tbody>
    </Box>
  );
}

function GapsTable({ rows }: { rows: GapRow[] }) {
  const { t } = useTranslation('it');
  const navigate = useNavigate();
  const sx = useTableSx();
  return (
    <Box component="table" sx={sx} aria-label={t('pages.endOfSupport.tabs.gaps')}>
      <colgroup>
        <col style={{ width: '38%' }} />
        <col />
        <col style={{ width: '24%' }} />
        <col style={{ width: 110 }} />
      </colgroup>
      <thead>
        <tr>
          <th>{t('pages.endOfSupport.columns.missing')}</th>
          <th>{t('pages.endOfSupport.columns.record')}</th>
          <th>{t('pages.endOfSupport.columns.linkedTo')}</th>
          <th>{t('pages.endOfSupport.columns.version')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const href = recordPath(row.subject_type, row.subject_id)!;
          return (
            <tr
              key={row.key}
              className="row"
              tabIndex={0}
              data-href={href}
              onClick={() => navigate(href)}
              onKeyDown={(event) => { if (event.key === 'Enter') navigate(href); }}
            >
              <td>{t(`pages.endOfSupport.gaps.${row.gap}`)}</td>
              <td>
                {row.subject_reference && <><RelationRef>{row.subject_reference}</RelationRef>{' '}</>}
                {row.subject_name}
              </td>
              <td>{row.related_name ?? ''}</td>
              <td>{row.version ?? ''}</td>
            </tr>
          );
        })}
      </tbody>
    </Box>
  );
}

/**
 * The "End of support" report (lot T4): what reaches or has reached its end of support within a
 * horizon and what it touches, and the missing data that keeps it from answering. Built on
 * `ReportLayout`, as the FTE reports (`pages/reports/CostPerFteReport.tsx`).
 */
export default function EndOfSupportReportPage() {
  const { t } = useTranslation('it');
  const locale = useLocale();
  const { hasLevel } = useAuth();
  const allowed = hasLevel('infrastructure', 'reader');
  const [params, setParams] = useSearchParams();
  const view: View = params.get('view') === 'gaps' ? 'gaps' : 'deadlines';
  const horizonParam = Number(params.get('horizon'));
  const horizon = (HORIZONS as readonly number[]).includes(horizonParam) ? horizonParam : 12;
  const typeParam = params.get('type') ?? '';
  const type = (DEADLINE_TYPES as readonly string[]).includes(typeParam) ? (typeParam as DeadlineType) : '';
  const [exportError, setExportError] = useState(false);

  const setParam = (key: string, value: string | null) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value); else next.delete(key);
      return next;
    }, { replace: true });
  };

  const deadlines = useQuery({
    queryKey: ['technologies', 'end-of-support', horizon],
    queryFn: async () => (await api.get<{ until: string; applications_visible: boolean; items: DeadlineRow[] }>(ENDPOINT, { params: { horizon_months: horizon } })).data,
    enabled: allowed && view === 'deadlines',
    placeholderData: (previous) => previous,
  });
  const gaps = useQuery({
    queryKey: ['technologies', 'end-of-support', 'gaps'],
    queryFn: async () => (await api.get<{ applications_visible: boolean; items: GapRow[] }>(`${ENDPOINT}/gaps`)).data,
    enabled: allowed && view === 'gaps',
  });

  const rows = useMemo(
    () => (deadlines.data?.items ?? []).filter((row) => !type || row.type === type),
    [deadlines.data, type],
  );

  if (!allowed) return <ForbiddenPage />;

  const active = view === 'deadlines' ? deadlines : gaps;

  const exportCsv = async () => {
    setExportError(false);
    try {
      const res = await api.get<Blob>(`${ENDPOINT}/export`, {
        params: view === 'gaps' ? { list: 'gaps' } : { list: 'deadlines', horizon_months: horizon, ...(type ? { type } : {}) },
        responseType: 'blob',
      });
      const headers = (res.headers ?? {}) as Record<string, unknown>;
      const disposition = (headers['content-disposition'] ?? headers['Content-Disposition']) as string | undefined;
      const filename = extractFilenameFromDisposition(disposition) || `end-of-support-${view}.csv`;
      downloadBlob(new Blob([res.data], { type: 'text/csv;charset=utf-8' }), filename);
    } catch {
      setExportError(true);
    }
  };

  const subtitle = view === 'gaps'
    ? t('pages.endOfSupport.subtitleGaps')
    : t('pages.endOfSupport.subtitle', { date: deadlines.data ? formatShortDate(deadlines.data.until, locale, { year: 'always' }) : '…' });

  return (
    <ReportLayout
      title={t('pages.endOfSupport.title')}
      subtitle={subtitle}
      busy={active.isFetching}
      onExportTableCsv={() => void exportCsv()}
      filters={(
        <>
          <Tabs
            value={view}
            onChange={(_, next: View) => setParam('view', next === 'gaps' ? 'gaps' : null)}
            aria-label={t('pages.endOfSupport.tabs.label')}
            sx={[textTabsSx, { alignSelf: 'center' }]}
          >
            <Tab value="deadlines" label={t('pages.endOfSupport.tabs.deadlines')} sx={textTabSx(view === 'deadlines')} />
            <Tab value="gaps" label={t('pages.endOfSupport.tabs.gaps')} sx={textTabSx(view === 'gaps')} />
          </Tabs>
          {view === 'deadlines' && (
            <>
              <ReportFilter label={t('pages.endOfSupport.filters.type')} width={180}>
                <TextField
                  select
                  size="small"
                  value={type}
                  onChange={(event) => setParam('type', event.target.value || null)}
                  SelectProps={{ displayEmpty: true, MenuProps: reportFilterMenuProps, inputProps: { 'aria-label': t('pages.endOfSupport.filters.type') } }}
                  sx={reportFilterSelectSx}
                >
                  <MenuItem value="" sx={drawerMenuItemSx}>{t('pages.endOfSupport.filters.allTypes')}</MenuItem>
                  {DEADLINE_TYPES.map((option) => (
                    <MenuItem key={option} value={option} sx={drawerMenuItemSx}>{t(`pages.endOfSupport.types.${option}`)}</MenuItem>
                  ))}
                </TextField>
              </ReportFilter>
              <ReportFilter label={t('pages.endOfSupport.filters.horizon')} width={140}>
                <TextField
                  select
                  size="small"
                  value={String(horizon)}
                  onChange={(event) => setParam('horizon', event.target.value === '12' ? null : event.target.value)}
                  SelectProps={{ MenuProps: reportFilterMenuProps, inputProps: { 'aria-label': t('pages.endOfSupport.filters.horizon') } }}
                  sx={reportFilterSelectSx}
                >
                  {HORIZONS.map((option) => (
                    <MenuItem key={option} value={String(option)} sx={drawerMenuItemSx}>{t('pages.endOfSupport.filters.months', { count: option })}</MenuItem>
                  ))}
                </TextField>
              </ReportFilter>
            </>
          )}
        </>
      )}
    >
      {exportError && (
        <Typography role="alert" sx={{ fontSize: 13, color: 'kanap.text.secondary', mb: 1 }}>{t('pages.endOfSupport.exportFailed')}</Typography>
      )}
      {view === 'deadlines' && deadlines.data && (
        rows.length === 0
          ? <Typography sx={{ fontSize: 13, color: 'kanap.text.tertiary' }}>{t('pages.endOfSupport.empty.deadlines')}</Typography>
          : <DeadlinesTable rows={rows} applicationsVisible={deadlines.data.applications_visible} />
      )}
      {view === 'gaps' && gaps.data && (
        gaps.data.items.length === 0
          ? <Typography sx={{ fontSize: 13, color: 'kanap.text.tertiary' }}>{t('pages.endOfSupport.empty.gaps')}</Typography>
          : <GapsTable rows={gaps.data.items} />
      )}
      {(!active.data || active.isError) && (
        <ReportDataStatus loading={active.isLoading} error={active.isError} onRetry={() => void active.refetch()} />
      )}
    </ReportLayout>
  );
}
