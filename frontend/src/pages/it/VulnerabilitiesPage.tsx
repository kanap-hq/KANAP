import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Box, Button, Checkbox, Drawer, FormControlLabel, IconButton, Link as MLink, MenuItem, Stack, Switch, TextField, Tooltip, Typography,
  useTheme,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import WarningAmberOutlined from '@mui/icons-material/WarningAmberOutlined';
import type { CellStyle, ICellRendererParams } from 'ag-grid-community';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom';
import api from '../../api';
import { useAuth } from '../../auth/AuthContext';
import CheckboxSetFilter, { type CheckboxSetFilterOption } from '../../components/CheckboxSetFilter';
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
import { getDotColor } from '../../utils/statusColors';
import { downloadBlob, extractFilenameFromDisposition } from '../../utils/downloadBlob';
import ExportFormatButton from '../../components/csv/ExportFormatButton';
import type { ExportFormat } from '../../components/csv/exportFormat';
import ForbiddenPage from '../ForbiddenPage';
import {
  EPSS_HOME,
  ExploitedBadge,
  SEVERITIES,
  ScoreSourceMark,
  SeverityCell,
  SourceBadges,
  VULNERABILITY_STATES,
  VulnerabilityStateCell,
  exploitationSources,
  formatEpssCell,
  formatEpssPercent,
  formatEpssPercentInput,
  parseEpssPercent,
  hasExploitationData,
  groupApplications,
  isDirectServer,
  versionText,
  type VulnerabilityDetail,
  type VulnerabilityGridRow,
  type VulnerabilityState,
  type VulnerabilityVersion,
} from './vulnerabilities/vulnerabilityTypes';
import { describeFeedAges, describeMatch, groupMatchesByCpe, nvdState, type FeedSourceStatus } from './vulnerabilities/feedText';

const ENDPOINT = '/vulnerabilities';

/** The filters the page opens on, with no link: rows to review. Reset filters goes back to them. */
const OPENING_FILTER_MODEL: Record<string, unknown> = {
  state: { filterType: 'set', values: ['to_review'] },
};

/** A list row: one technology, version and CVE (`GET /vulnerabilities`). */
export type VulnerabilityRow = VulnerabilityGridRow;

/**
 * The grid's filter model from the address: "to review" unless `state` says otherwise (`all`: every
 * state); `editor`, `technology` (`TEC-n`), `version` (a label, `none`: not recorded) and `severity`
 * as set filters; `q` on the CVE id; `period` (days) on the publication date; `asset` (`AST-n` or id)
 * and `application` (`APP-n` or id) on the Servers and Applications columns. These are the entries
 * from the technologies, assets and applications lists, the records, the home tile and the emails.
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
  for (const kind of SUBJECT_KINDS) {
    const subject = subjectValue(params.get(kind));
    if (subject) model[kind] = set([subject]);
  }
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

export type SubjectKind = 'asset' | 'application';
const SUBJECT_KINDS: readonly SubjectKind[] = ['asset', 'application'];

/**
 * The value an asset or application of the address takes in its column filter: a business
 * reference (`AST-n`, `APP-n`) in capitals, an id in lower case, as the options carry them.
 */
function subjectValue(raw: string | null): string | null {
  const ref = raw?.trim();
  if (!ref) return null;
  return /^[a-z]+-\d+$/i.test(ref) ? ref.toUpperCase() : ref.toLowerCase();
}

/** An option of the Servers or Applications column filter (`GET /vulnerabilities/filter-values`). */
export type SubjectOption = { id: string; reference: string | null; name: string };

/** The name of an asset or application the options do not hold, `null` when unreadable. */
async function subjectName(kind: SubjectKind, ref: string): Promise<string | null> {
  const path = kind === 'asset'
    ? (/^AST-\d+$/i.test(ref) ? `/assets/by-ref/${encodeURIComponent(ref)}` : `/assets/${encodeURIComponent(ref)}`)
    : `/applications/${encodeURIComponent(ref)}`;
  try {
    return (await api.get<{ name?: string | null }>(path)).data?.name || null;
  } catch {
    return null;
  }
}

/**
 * The values of the Servers or Applications column filter: the subjects with a vulnerability that
 * counts, by name only, searched by name or reference (`keywords`). The value is the reference (the
 * id of a subject without one), as the links write it. A value the column holds outside them (a
 * link from a record whose rows are all handled) is listed first, by its name.
 */
async function subjectFilterValues(kind: SubjectKind, context: any): Promise<CheckboxSetFilterOption[]> {
  const res = await api.get<Partial<Record<SubjectKind, SubjectOption[]>>>(`${ENDPOINT}/filter-values`, { params: { fields: kind } });
  const list = Array.isArray(res.data?.[kind]) ? res.data![kind]! : [];
  const options = list.map((option) => ({ value: option.reference ?? option.id, label: option.name, keywords: option.reference ?? '' }));
  const known = new Set(options.map((option) => option.value.toUpperCase()));
  const chosen: unknown[] = context?.getQueryState?.()?.filters?.[kind]?.values ?? [];
  const missing = chosen.filter((value): value is string => typeof value === 'string' && !known.has(value.toUpperCase()));
  const extra = await Promise.all(missing.map(async (value) => {
    const byId = list.find((option) => option.id.toUpperCase() === value.toUpperCase());
    return { value, label: byId?.name ?? (await subjectName(kind, value)) ?? value, keywords: value };
  }));
  return [...extra, ...options];
}

/** `estate=1` on the address: only the CVE touching the estate, as the home tile counts them. */
export function estateFromSearch(search: string): boolean {
  return new URLSearchParams(search).get('estate') === '1';
}

const mentionRemoveSx = { fontSize: 13, verticalAlign: 'baseline' } as const;

/** "In use in the estate · remove", its meaning in a tooltip. */
function EstateMention({ onRemove }: { onRemove: () => void }) {
  const { t } = useTranslation('it');
  return (
    <Box component="span" data-testid="vulnerabilities-estate">
      <Tooltip title={t('pages.vulnerabilities.estateFilter.hint')}>
        <span>{t('pages.vulnerabilities.estateFilter.label')}</span>
      </Tooltip>
      {' · '}
      <MLink component="button" type="button" underline="hover" onClick={onRemove} sx={mentionRemoveSx}>
        {t('pages.vulnerabilities.subjectFilter.remove')}
      </MLink>
    </Box>
  );
}

/** The estate filter of the address, which has no control in the toolbar, on one quiet line. */
function AddressFilterLine({ estate, onRemoveEstate }: { estate: boolean; onRemoveEstate: () => void }) {
  if (!estate) return null;
  return (
    <Typography component="div" sx={{ fontSize: 13, color: 'kanap.text.secondary', mb: 1 }}>
      <EstateMention onRemove={onRemoveEstate} />
    </Typography>
  );
}

export type AlertsFilter = 'included' | 'excluded' | 'all';

/** `alerts` on the address: included when it is absent or unknown. */
export function alertsFromSearch(search: string): AlertsFilter {
  const value = new URLSearchParams(search).get('alerts');
  return value === 'excluded' || value === 'all' ? value : 'included';
}

/** `exploited=1` on the address. Any other value leaves the shortcut off, and the API then receives no `exploited`. */
export function exploitedOnlyFromSearch(search: string): boolean {
  return new URLSearchParams(search).get('exploited') === '1';
}

/**
 * EPSS filter: the user types a percentage (`90` is 90%). The model keeps the probability from 0 to 1,
 * which is what the API compares with the stored ratio. A column's filterParams replace the grid's
 * number operators, so the whole set is named here. The text field accepts a comma or a dot.
 */
const EPSS_FILTER_PARAMS = {
  suppressAndOrCondition: true,
  maxNumConditions: 1,
  buttons: ['clear'],
  filterOptions: ['greaterThanOrEqual'],
  defaultOption: 'greaterThanOrEqual',
  allowedCharPattern: '\\d\\,\\.',
  numberParser: (text: string | null) => parseEpssPercent(text),
};

/** A relative publication window. Absent or unknown reads as every date. Distinct from `period` (the emails' link). */
export const PUBLISHED_PERIODS = ['7d', '30d', '90d', '1y', 'older1y'] as const;
export type PublishedPeriod = 'all' | (typeof PUBLISHED_PERIODS)[number];

/** `published` on the address stays relative, so a saved link keeps meaning "the last 30 days". */
export function publishedFromSearch(search: string): PublishedPeriod {
  const value = new URLSearchParams(search).get('published');
  return (PUBLISHED_PERIODS as readonly string[]).includes(value ?? '') ? (value as PublishedPeriod) : 'all';
}

function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** `day` (YYYY-MM-DD) shifted by calendar days and years, in UTC. */
function shiftUtcDay(day: string, days: number, years = 0): string {
  const [year, month, date] = day.split('-').map(Number);
  return utcDay(new Date(Date.UTC(year + years, month - 1, date + days)));
}

/**
 * Inclusive `from` and `to` for the publication date (`GET /vulnerabilities` keeps both days), from
 * the UTC day of `now`. Less than N days covers exactly N days, today included (`from` is N - 1 days
 * back). Less than a year starts the day after the anniversary; more than a year stops on it and
 * sends no `from`, so the two share no day and miss none. All sends neither.
 */
export function publishedRange(period: PublishedPeriod, now = new Date()): { from?: string; to?: string } {
  if (period === 'all') return {};
  const today = utcDay(now);
  const anniversary = shiftUtcDay(today, 0, -1);
  if (period === 'older1y') return { to: anniversary };
  const from = period === '1y' ? shiftUtcDay(anniversary, 1) : shiftUtcDay(today, 1 - Number(period.slice(0, -1)));
  return { from, to: today };
}

/** The list's parameters, without its paging, for the export and the change in bulk. */
function scopeParams(request: ListRequest | null): Record<string, unknown> {
  const { page: _page, limit: _limit, ...rest } = (request?.params ?? {}) as Record<string, unknown>;
  return rest;
}

/** The same list query for the rows kept out of the alerts. One row is enough to know they exist. */
function excludedProbeOf(request: ListRequest): Record<string, unknown> {
  const { alerts: _alerts, ...rest } = scopeParams(request);
  return { ...rest, alerts: 'excluded', page: 1, limit: 1 };
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

/** One section of the detail drawer. Later sections take a soft rule and the same gap. */
function DetailBlock({ title, children, divided = false }: { title?: string; children: React.ReactNode; divided?: boolean }) {
  return (
    <Box sx={{
      minWidth: 0,
      ...(divided ? { mt: 3, pt: 3, borderTop: '1px solid', borderColor: 'kanap.border.soft' } : {}),
    }}
    >
      {title ? (
        <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'kanap.text.secondary', mb: 1 }}>{title}</Typography>
      ) : null}
      {children}
    </Box>
  );
}

/** Same placement as the interface-mapping rule drawer: under the 48px application bar. */
const detailDrawerPaperSx = {
  top: 48,
  height: 'calc(100dvh - 48px)',
  width: { xs: '100vw', sm: 600 },
  maxWidth: '100vw',
  bgcolor: 'kanap.bg.drawer',
  borderLeft: '1px solid',
  borderColor: 'kanap.border.default',
  boxShadow: 'none',
  overflow: 'hidden',
} as const;

const detailDrawerShellSx = {
  height: '100%',
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  bgcolor: 'kanap.bg.drawer',
  color: 'kanap.text.primary',
} as const;

const detailDrawerHeaderSx = {
  px: 2,
  py: 1.25,
  gap: 1,
  borderBottom: '1px solid',
  borderColor: 'kanap.border.soft',
  bgcolor: 'kanap.bg.drawer',
  flex: '0 0 auto',
} as const;

const detailDrawerBodySx = {
  flex: '1 1 auto',
  minHeight: 0,
  overflowY: 'auto',
  px: 2,
  py: 2,
} as const;

const detailCloseButtonSx = {
  width: 28,
  height: 28,
  color: 'kanap.text.secondary',
  flexShrink: 0,
} as const;

/** Long-form description, off the drawer surface in light and dark. */
const detailDescriptionSx = {
  bgcolor: 'kanap.bg.composer',
  border: '1px solid',
  borderColor: 'kanap.border.default',
  borderRadius: '8px',
  px: 2,
  py: 1.75,
} as const;

const versionRowSx = {
  display: 'grid',
  gridTemplateColumns: { xs: '1fr', sm: 'minmax(0, 1fr) 150px minmax(0, 1.15fr)' },
  columnGap: 1,
  rowGap: 1,
  alignItems: 'center',
} as const;

const versionCellSx = {
  minHeight: 32,
  display: 'flex',
  alignItems: 'center',
  minWidth: 0,
} as const;

const listSx = { listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: '2px', fontSize: 13, lineHeight: 1.4 } as const;
const quietSx = { fontSize: 13, color: 'kanap.text.tertiary' } as const;

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <MLink href={href} target="_blank" rel="noopener noreferrer" underline="hover" sx={{ fontSize: 13 }}>
      {children}
    </MLink>
  );
}

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
    <Box component="li" sx={versionRowSx}>
      <Box
        sx={{
          ...versionCellSx,
          color: quiet ? 'kanap.text.tertiary' : version.potential ? 'kanap.text.secondary' : 'kanap.text.primary',
        }}
        title={quiet ? `${label} · ${t('pages.vulnerabilities.section.alerts.excluded')}` : label}
      >
        <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</Box>
      </Box>
      {canEdit ? (
        <TextField
          select
          variant="standard"
          value={version.state}
          onChange={(event) => void save({ state: event.target.value as VulnerabilityState })}
          SelectProps={{ MenuProps: reportFilterMenuProps, inputProps: { 'aria-label': t('pages.vulnerabilities.detail.stateOf', { version: label }) } }}
          sx={drawerSelectSx}
        >
          {VULNERABILITY_STATES.map((state) => (
            <MenuItem key={state} value={state} sx={drawerMenuItemSx}><VulnerabilityStateCell state={state} /></MenuItem>
          ))}
        </TextField>
      ) : (
        <Box sx={versionCellSx}><VulnerabilityStateCell state={version.state} /></Box>
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
          sx={{ width: '100%' }}
        />
      ) : (
        <Box sx={{ ...versionCellSx, color: quiet ? 'kanap.text.tertiary' : 'kanap.text.primary' }}>
          <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{version.note ?? ''}</Box>
        </Box>
      )}
      {failed && (
        <Typography role="alert" sx={{ gridColumn: '1 / -1', fontSize: 12, color: 'kanap.text.secondary' }}>
          {t('pages.vulnerabilities.saveFailed')}
        </Typography>
      )}
      <VersionMatches version={version} label={label} />
    </Box>
  );
}

/**
 * Under a version: the feeds that matched it, and "Why this row", closed by default, which lists
 * each CPE once, with its distinct bounds. Nothing on an answer that names no feed.
 */
function VersionMatches({ version, label }: { version: VulnerabilityVersion; label: string }) {
  const { t } = useTranslation('it');
  const [open, setOpen] = useState(false);
  const sources = version.match_sources ?? [];
  const matches = version.matches ?? [];
  if (sources.length === 0 && matches.length === 0) return null;
  const shown = groupMatchesByCpe(matches);
  const listId = `why-${version.id}`;
  return (
    <Box sx={{ gridColumn: '1 / -1', minWidth: 0, mt: '-2px' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
        <SourceBadges sources={sources} />
        {matches.length > 0 && (
          <MLink
            component="button"
            type="button"
            underline="hover"
            aria-expanded={open}
            aria-controls={listId}
            aria-label={t('pages.vulnerabilities.feeds.why.toggleOf', { version: label })}
            onClick={() => setOpen((value) => !value)}
            sx={{ fontSize: 12, color: 'kanap.text.secondary', '&:hover': { color: 'primary.main' } }}
          >
            {t('pages.vulnerabilities.feeds.why.toggle')}
          </MLink>
        )}
      </Box>
      {open && (
        <Box component="ul" id={listId} sx={{ ...listSx, mt: 0.5, fontSize: 12, color: 'kanap.text.secondary' }}>
          {shown.map((match, index) => (
            <li key={`${match.source}:${index}`}>{describeMatch(match, t)}</li>
          ))}
        </Box>
      )}
    </Box>
  );
}

/** The NVD status and the publisher's record of a CVE, in two lines at most. */
function FeedSourcesBlock({ detail }: { detail: VulnerabilityDetail }) {
  const { t } = useTranslation('it');
  const locale = useLocale();
  const record = detail.record ?? null;
  const day = (value: string | null) => (value ? formatShortDate(value, locale, { year: 'always' }) : '');
  const recordParts: string[] = [];
  if (record) {
    const published = day(record.published_at);
    if (record.assigner && published) recordParts.push(t('pages.vulnerabilities.feeds.record.publishedBy', { assigner: record.assigner, date: published }));
    else if (record.assigner) recordParts.push(t('pages.vulnerabilities.feeds.record.publishedByOnly', { assigner: record.assigner }));
    else if (published) recordParts.push(t('pages.vulnerabilities.feeds.record.publishedOn', { date: published }));
    const updated = day(record.updated_at);
    if (updated) recordParts.push(t('pages.vulnerabilities.feeds.record.updatedOn', { date: updated }));
  }
  return (
    <DetailBlock title={t('pages.vulnerabilities.feeds.title')} divided>
      <Box data-testid="vulnerability-feeds" sx={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <Typography sx={{ fontSize: 13, color: 'kanap.text.primary' }}>
          <Box component="span" sx={{ color: 'kanap.text.secondary' }}>{t('pages.vulnerabilities.feeds.nvdLabel')}</Box>
          {' '}
          <Box component="span" data-nvd-state={nvdState(detail.nvd_status)}>
            {t(`pages.vulnerabilities.feeds.nvdStatus.${nvdState(detail.nvd_status)}`)}
          </Box>
          {' · '}
          <ExternalLink href={`https://nvd.nist.gov/vuln/detail/${encodeURIComponent(detail.cve_id)}`}>
            {t('pages.vulnerabilities.feeds.nvdLink')}
          </ExternalLink>
        </Typography>
        {record && (
          <Typography sx={{ fontSize: 13, color: 'kanap.text.primary' }}>
            <Box component="span" sx={{ color: 'kanap.text.secondary' }}>{t('pages.vulnerabilities.feeds.record.label')}</Box>
            {' '}
            {recordParts.length > 0 ? recordParts.join(', ') : t('pages.vulnerabilities.feeds.record.available')}
            {' · '}
            <ExternalLink href={`https://www.cve.org/CVERecord?id=${encodeURIComponent(detail.cve_id)}`}>
              {t('pages.vulnerabilities.feeds.record.link')}
            </ExternalLink>
          </Typography>
        )}
      </Box>
    </DetailBlock>
  );
}

/**
 * The NVD, CVE.org and the exploitation catalogues, in that order. A missing answer shows no line.
 */
function feedAgeItems(data: { items?: FeedSourceStatus[]; signals?: FeedSourceStatus[] } | undefined): FeedSourceStatus[] | null {
  if (!data || !Array.isArray(data.items)) return null;
  return [...data.items, ...(Array.isArray(data.signals) ? data.signals : [])];
}

/**
 * How fresh the data of each feed is, in one tertiary line above the grid. A feed that is off is
 * left out. A failed last read, or no success for more than three days, turns that feed's part
 * into a warning on the same line. EPSS names the day of its scores.
 */
export function FeedAgeLine({ items, now }: { items: FeedSourceStatus[] | null | undefined; now?: Date }) {
  const { t } = useTranslation('it');
  const locale = useLocale();
  const mode = useTheme().palette.mode;
  const described = describeFeedAges(items, t, locale, now);
  if (!described) return null;
  const { text, warnings } = described;
  return (
    <Box
      data-testid="vulnerability-feed-age"
      title={[text, ...warnings].join(' · ')}
      sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, mb: 1, fontSize: 12, color: 'kanap.text.tertiary', whiteSpace: 'nowrap', overflow: 'hidden' }}
    >
      <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{text}</Box>
      {warnings.length > 0 && (
        <Box
          component="span"
          role="status"
          data-feed-warning=""
          sx={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: getDotColor('warning', mode), minWidth: 0, flexShrink: 1 }}
        >
          <WarningAmberOutlined aria-hidden sx={{ fontSize: 14, flexShrink: 0 }} />
          <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{warnings.join(' · ')}</Box>
        </Box>
      )}
    </Box>
  );
}

/** A quiet text button of the panel ("See more", "Also show..."): secondary, teal on hover. */
const panelToggleSx = { fontSize: 12, color: 'kanap.text.secondary', textAlign: 'left', '&:hover': { color: 'primary.main' } } as const;

/**
 * The summary, cut at three lines. "See more" shows only when the text really overflows, measured
 * again when the text changes; "See less" cuts it again.
 */
function ClampedSummary({ text }: { text: string }) {
  const { t } = useTranslation('it');
  const ref = useRef<HTMLParagraphElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  useLayoutEffect(() => { setExpanded(false); }, [text]);
  useLayoutEffect(() => {
    // Measured while cut: the full height beyond the three visible lines.
    if (expanded) return;
    const el = ref.current;
    setOverflows(el != null && el.scrollHeight > el.clientHeight + 1);
  }, [text, expanded]);
  return (
    <>
      <Typography
        ref={ref}
        data-testid="vulnerability-summary"
        sx={{
          fontSize: 14,
          lineHeight: 1.6,
          color: 'kanap.text.primary',
          ...(expanded ? {} : { display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }),
        }}
      >
        {text}
      </Typography>
      {overflows && (
        <MLink
          component="button"
          type="button"
          underline="hover"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          sx={{ ...panelToggleSx, mt: 0.5 }}
        >
          {t(expanded ? 'pages.vulnerabilities.detail.seeLess' : 'pages.vulnerabilities.detail.seeMore')}
        </MLink>
      )}
    </>
  );
}

/**
 * The servers or applications of the panel, direct ones first. Those reached through another asset
 * stay hidden behind a text button, and show after a soft rule under their own small heading.
 */
function DirectFirstList<T>({ direct, indirect, indirectCount, renderItem, noDirect, showKey, hideKey, testId }: {
  direct: T[];
  indirect: T[];
  /** Distinct servers or applications of the indirect part, for the button. */
  indirectCount: number;
  renderItem: (item: T, index: number) => React.ReactNode;
  noDirect: string;
  showKey: string;
  hideKey: string;
  testId: string;
}) {
  const { t } = useTranslation('it');
  const [showIndirect, setShowIndirect] = useState(false);
  const groupId = `${testId}-indirect`;
  return (
    <Box data-testid={testId}>
      {direct.length > 0 ? (
        <Box component="ul" sx={listSx}>{direct.map(renderItem)}</Box>
      ) : (
        <Typography sx={quietSx}>{noDirect}</Typography>
      )}
      {indirect.length > 0 && (
        <MLink
          component="button"
          type="button"
          underline="hover"
          aria-expanded={showIndirect}
          aria-controls={showIndirect ? groupId : undefined}
          onClick={() => setShowIndirect((value) => !value)}
          sx={{ ...panelToggleSx, mt: 0.75 }}
        >
          {t(showIndirect ? hideKey : showKey, { count: indirectCount })}
        </MLink>
      )}
      {showIndirect && indirect.length > 0 && (
        <Box id={groupId} data-indirect="" sx={{ mt: 1, pt: 1, borderTop: '1px solid', borderColor: 'kanap.border.soft' }}>
          <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary', mb: 0.5 }}>{t('pages.vulnerabilities.detail.indirect')}</Typography>
          <Box component="ul" sx={listSx}>{indirect.map(renderItem)}</Box>
        </Box>
      )}
    </Box>
  );
}

function DetailHeader({ cveId, detail, onClose }: {
  cveId: string;
  detail?: VulnerabilityDetail;
  onClose: () => void;
}) {
  const { t } = useTranslation('it');
  const sources = detail ? exploitationSources(detail) : [];
  return (
    <Stack direction="row" alignItems="flex-start" justifyContent="space-between" sx={detailDrawerHeaderSx}>
      <Box sx={{ minWidth: 0, pt: '2px' }}>
        <Typography component="h2" sx={{ fontFamily: MONO_FONT_FAMILY, fontSize: 14, fontWeight: 500, color: 'kanap.text.primary', lineHeight: 1.3 }}>
          {cveId}
        </Typography>
        {detail && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', mt: 0.5, minWidth: 0, flexWrap: 'wrap' }}>
            <SeverityCell severity={detail.severity} score={detail.cvss_score} />
            <ScoreSourceMark source={detail.score_source} />
            {(detail.exploited || sources.length > 0) && <ExploitedBadge row={detail} />}
          </Box>
        )}
      </Box>
      <IconButton aria-label={t('pages.vulnerabilities.panel.close')} onClick={onClose} sx={detailCloseButtonSx}>
        <CloseIcon fontSize="small" />
      </IconButton>
    </Stack>
  );
}

/**
 * One CVE in the side panel: its state per technology version first, where it is changed, then
 * what it says, its feeds, its exploitation, and the servers and applications it touches.
 */
function VulnerabilityDetailPanel({ cveId, canEdit, onClose, onChanged }: {
  cveId: string;
  canEdit: boolean;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const { t } = useTranslation('it');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: ['vulnerabilities', 'detail', cveId],
    queryFn: async () => (await api.get<VulnerabilityDetail>(`${ENDPOINT}/${encodeURIComponent(cveId)}`)).data,
  });
  const d = detail.data;
  const sources = d ? exploitationSources(d) : [];
  const epssKnown = d != null && d.epss != null && Number.isFinite(Number(d.epss));
  const serversLine = d ? inAlertsLine(d.servers, d.alerting?.servers, t, 'pages.vulnerabilities.detail.serversInAlerts') : null;
  const applicationsLine = !d || d.applications == null
    ? null
    : inAlertsLine(d.applications, d.alerting?.applications, t, 'pages.vulnerabilities.detail.applicationsInAlerts');
  const indirectServers = d ? d.servers_list.filter((server) => !isDirectServer(server)) : [];
  // One line per application and technology version, whatever the number of servers that bring it.
  const applicationGroups = d?.applications_list ? groupApplications(d.applications_list) : null;
  const showDescription = Boolean(d && (d.summary || d.cvss_vector || d.reference_urls.length > 0));
  const showExploitation = Boolean(d && hasExploitationData(d));
  // The panel stays open; the grid, which does not read react-query, is refreshed by its caller.
  const onSaved = () => {
    void queryClient.invalidateQueries({ queryKey: ['vulnerabilities'] });
    onChanged?.();
  };
  return (
    <>
      <DetailHeader cveId={cveId} detail={d} onClose={onClose} />
      <Box sx={detailDrawerBodySx}>
        {!d ? (
          <ReportDataStatus loading={detail.isLoading} error={detail.isError} onRetry={() => void detail.refetch()} />
        ) : (
    <Box data-testid="vulnerability-detail">
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
      {showDescription && (
        <DetailBlock divided>
          <Box sx={detailDescriptionSx}>
            {d.summary && <ClampedSummary text={d.summary} />}
            {d.cvss_vector && (
              <Typography sx={{ fontSize: 13, color: 'kanap.text.primary', mt: d.summary ? 1 : 0 }}>
                <Box component="span" sx={{ color: 'kanap.text.secondary' }}>{t('pages.vulnerabilities.detail.vector')}</Box>
                {' '}
                <Box component="span" sx={{ fontFamily: MONO_FONT_FAMILY }}>{d.cvss_vector}</Box>
              </Typography>
            )}
            {d.reference_urls.length > 0 && (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', mt: 1 }}>
                {d.reference_urls.slice(0, 6).map((url) => (
                  <ExternalLink key={url} href={url}>{url.replace(/^https?:\/\//, '').slice(0, 60)}</ExternalLink>
                ))}
              </Box>
            )}
          </Box>
        </DetailBlock>
      )}
      <FeedSourcesBlock detail={d} />
      {showExploitation && (
        <DetailBlock title={t('pages.vulnerabilities.detail.exploitation')} divided>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {sources.length > 0 && (
              <Typography sx={{ fontSize: 13, color: 'kanap.text.primary' }}>
                <Box component="span" sx={{ color: 'kanap.text.secondary' }}>{t('pages.vulnerabilities.detail.sources')}</Box>
                {' '}
                {sources.map((source) => t(source === 'cisa' ? 'pages.vulnerabilities.detail.sourceCisa' : 'pages.vulnerabilities.detail.sourceEu')).join(', ')}
              </Typography>
            )}
            {d.kev_added_at && (
              <Typography sx={{ fontSize: 13, color: 'kanap.text.primary' }}>
                <Box component="span" sx={{ color: 'kanap.text.secondary' }}>{t('pages.vulnerabilities.detail.kevAdded')}</Box>
                {' '}
                {formatShortDate(d.kev_added_at, locale, { year: 'always' })}
              </Typography>
            )}
            {d.kev_ransomware === true && (
              <Typography sx={{ fontSize: 13, color: 'kanap.text.primary' }}>{t('pages.vulnerabilities.exploited.ransomware')}</Typography>
            )}
            {epssKnown && (
              <Typography sx={{ fontSize: 13, color: 'kanap.text.primary' }}>
                <Box component="span" sx={{ color: 'kanap.text.secondary' }}>{t('pages.vulnerabilities.detail.epss')}</Box>
                {' '}
                {formatEpssCell(d.epss, d.epss_percentile, locale, t)}
                {d.epss_date ? ` ${t('pages.vulnerabilities.detail.epssOn', { date: formatShortDate(d.epss_date, locale, { year: 'always' }) })}` : ''}
                {' · '}
                <ExternalLink href={EPSS_HOME}>{t('pages.vulnerabilities.detail.epssFirst')}</ExternalLink>
              </Typography>
            )}
            {(d.euvd_id || d.euvd_url) && (
              <Box>
                {d.euvd_id && (
                  <Typography sx={{ fontSize: 13, fontFamily: MONO_FONT_FAMILY, color: 'kanap.text.primary' }}>{d.euvd_id}</Typography>
                )}
                {d.euvd_url && (
                  <ExternalLink href={d.euvd_url}>{t('pages.vulnerabilities.detail.euvdLink')}</ExternalLink>
                )}
                <Typography sx={{ fontSize: 12, color: 'kanap.text.secondary' }}>{t('pages.vulnerabilities.detail.euvdSource')}</Typography>
              </Box>
            )}
          </Box>
        </DetailBlock>
      )}
      <Box sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
        columnGap: 3,
        alignItems: 'start',
        mt: 3,
        pt: 3,
        borderTop: '1px solid',
        borderColor: 'kanap.border.soft',
        // One column on a phone: the two lists stay separate sections.
        '& > * + *': {
          borderTop: { xs: '1px solid', md: 'none' },
          borderColor: 'kanap.border.soft',
          mt: { xs: 3, md: 0 },
          pt: { xs: 3, md: 0 },
        },
      }}
      >
        <DetailBlock title={t('pages.vulnerabilities.detail.servers')}>
          {serversLine && <Typography sx={{ ...quietSx, mb: 0.5 }}>{serversLine}</Typography>}
          {d.servers_list.length === 0 ? (
            <Typography sx={quietSx}>{t('pages.vulnerabilities.detail.noServers')}</Typography>
          ) : (
            <DirectFirstList
              testId="vulnerability-servers"
              direct={d.servers_list.filter(isDirectServer)}
              indirect={indirectServers}
              indirectCount={new Set(indirectServers.map((server) => server.asset_id)).size}
              noDirect={t('pages.vulnerabilities.detail.noDirectServers')}
              showKey="pages.vulnerabilities.detail.showIndirectServers"
              hideKey="pages.vulnerabilities.detail.hideIndirectServers"
              renderItem={(server, index) => {
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
              }}
            />
          )}
        </DetailBlock>
        <DetailBlock title={t('pages.vulnerabilities.detail.applications')}>
          {applicationsLine && <Typography sx={{ ...quietSx, mb: 0.5 }}>{applicationsLine}</Typography>}
          {d.applications_list === null ? (
            <Typography sx={quietSx}>{t('pages.vulnerabilities.detail.applicationsHidden')}</Typography>
          ) : d.applications_list.length === 0 ? (
            <Typography sx={quietSx}>{t('pages.vulnerabilities.detail.noApplications')}</Typography>
          ) : (
            <DirectFirstList
              testId="vulnerability-applications"
              direct={applicationGroups!.direct}
              indirect={applicationGroups!.indirect}
              indirectCount={new Set(applicationGroups!.indirect.map((group) => group.application_id)).size}
              noDirect={t('pages.vulnerabilities.detail.noDirectApplications')}
              showKey="pages.vulnerabilities.detail.showIndirectApplications"
              hideKey="pages.vulnerabilities.detail.hideIndirectApplications"
              renderItem={(app) => {
                const quiet = app.alerts === false;
                const names = app.servers.map((server) => (server.via ? `${server.name} ${t('pages.vulnerabilities.detail.via', { name: server.via })}` : server.name));
                const shown = names.slice(0, 3).join(', ');
                const servers = names.length > 3 ? `${shown} ${t('pages.vulnerabilities.detail.moreServers', { count: names.length - 3 })}` : shown;
                return (
                  <li key={app.key}>
                    <RecordLink to={`/it/applications/${app.application_id}`} quiet={quiet}>
                      {app.reference && <><RelationRef>{app.reference}</RelationRef>{' '}</>}
                      {app.name ?? ''}
                    </RecordLink>
                    <Box component="span" sx={{ color: quiet ? 'kanap.text.tertiary' : 'kanap.text.secondary' }}>
                      {' · '}{app.technology_name} {versionText(app, t)}
                      {servers && <>{' · '}{servers}</>}
                    </Box>
                  </li>
                );
              }}
            />
          )}
        </DetailBlock>
      </Box>
    </Box>
        )}
      </Box>
    </>
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
 * chosen and kept, sort, total, export). It opens on the rows to review, exploited first and then
 * most severe. Ticked rows, or every row of the filter (the header box), change state at once; a
 * row opens its CVE in a side panel. Shown only while the vulnerability feed is on
 * (`features.vulnerabilityFeed`).
 */
export default function VulnerabilitiesPage() {
  const { t } = useTranslation(['it', 'common']);
  const locale = useLocale();
  const location = useLocation();
  const navigate = useNavigate();
  const alerts = alertsFromSearch(location.search);
  const published = publishedFromSearch(location.search);
  const exploitedOnly = exploitedOnlyFromSearch(location.search);
  const estate = estateFromSearch(location.search);
  // Recomputed when the period changes. A page left open past midnight UTC keeps the day it opened on.
  const publishedDays = useMemo(() => publishedRange(published), [published]);
  // `exploited=1` becomes the API's `yes`. Off sends nothing, so the list contract stays on `alerts` alone.
  const extraParams = useMemo(
    () => ({
      alerts,
      ...publishedDays,
      ...(exploitedOnly ? { exploited: 'yes' } : {}),
      ...(estate ? { estate: '1' } : {}),
    }),
    [alerts, estate, exploitedOnly, publishedDays],
  );
  const queryClient = useQueryClient();
  const { hasLevel } = useAuth();
  const { config } = useFeatures();
  const enabled = config.features.vulnerabilityFeed === true;
  const allowed = hasLevel('infrastructure', 'reader');
  // The Applications column filter only for a user who reads the applications (the API keeps the user's own).
  const readsApplications = hasLevel('applications', 'reader');

  const canEdit = hasLevel('infrastructure', 'member');
  // The Applications column has a filter only for a user who reads the applications.
  const initialModel = useMemo(() => {
    const model = filterModelFromSearch(location.search);
    if (!readsApplications) delete model.application;
    return model;
  }, [location.search, readsApplications]);
  const [selection, setSelection] = useState<Selection>(NO_SELECTION);
  const [refreshKey, setRefreshKey] = useState(0);
  const [openCve, setOpenCve] = useState<string | null>(null);
  // Escape closes the drawer even when a note field has the focus. An open menu takes the first one.
  useEffect(() => {
    if (!openCve) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (document.querySelector('.MuiMenu-root, .MuiPopover-root')) return;
      setOpenCve(null);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [openCve]);
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
  const exploitedValues = useCallback(async () => [
    { value: 'yes', label: t('pages.vulnerabilities.columns.exploitedYes') },
    { value: 'no', label: t('pages.vulnerabilities.columns.exploitedNo') },
  ], [t]);
  // `nvd` and `cve_org` keep a row both feeds matched; `both` keeps only those.
  const sourceValues = useCallback(async () => [
    { value: 'nvd', label: t('pages.vulnerabilities.feeds.badge.nvd') },
    { value: 'cve_org', label: t('pages.vulnerabilities.feeds.badge.cve_org') },
    { value: 'both', label: t('pages.vulnerabilities.feeds.filter.both') },
  ], [t]);
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
    if (exploitedOnly) params.exploited = 'yes';
    if (publishedDays.from) params.from = publishedDays.from;
    if (publishedDays.to) params.to = publishedDays.to;
    if (estate) params.estate = '1';
    const res = await getWithListContext<{ version?: Array<string | null> }>(`${ENDPOINT}/filter-values`, params);
    return (res.data?.version || []).map((value) => ({ value, label: value ?? t('pages.vulnerabilities.versionNone') }));
  }, [alerts, estate, exploitedOnly, publishedDays, t]);

  const assetValues = useCallback(({ context }: { context?: any }) => subjectFilterValues('asset', context), []);
  const applicationValues = useCallback(({ context }: { context?: any }) => subjectFilterValues('application', context), []);

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
      // The score, and the actively exploited icon when the row is listed.
      width: 160,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: { getValues: severityValues, searchable: false },
      cellRenderer: (p: ICellRendererParams<VulnerabilityRow>) => (p.data ? (
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px', minWidth: 0, maxWidth: '100%' }}>
          <SeverityCell severity={p.data.severity} score={p.data.cvss_score} />
          <ScoreSourceMark source={p.data.score_source} />
          {p.data.exploited ? <ExploitedBadge row={p.data} /> : null}
        </Box>
      ) : null),
    },
    {
      headerName: t('pages.vulnerabilities.columns.exploited'),
      field: 'exploited',
      width: 120,
      defaultHidden: true,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: { getValues: exploitedValues, searchable: false },
      valueFormatter: (p: { value?: boolean }) => (p.value ? t('pages.vulnerabilities.columns.exploitedYes') : t('pages.vulnerabilities.columns.exploitedNo')),
    },
    { headerName: t('pages.vulnerabilities.columns.score'), field: 'cvss_score', width: 90, type: 'rightAligned', defaultHidden: true, filter: 'agNumberColumnFilter' },
    {
      headerName: t('pages.vulnerabilities.columns.epss'),
      field: 'epss',
      // The cell is the probability only (`15.3%`). The percentile stays in the detail drawer.
      width: 100,
      type: 'rightAligned',
      headerTooltip: t('pages.vulnerabilities.epss.minimumHint'),
      filter: 'agNumberColumnFilter',
      filterParams: {
        ...EPSS_FILTER_PARAMS,
        numberFormatter: (value: number | null) => formatEpssPercentInput(value, locale),
      },
      valueFormatter: (p: { value?: number | null; data?: VulnerabilityRow }) => {
        const value = p.data?.epss ?? p.value;
        return value == null || !Number.isFinite(Number(value)) ? '' : formatEpssPercent(Number(value), locale);
      },
    },
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
      headerName: t('pages.vulnerabilities.feeds.column'),
      colId: 'source',
      field: 'match_sources',
      // "NVD" and "Hersteller" side by side.
      width: 130,
      sortable: false,
      headerTooltip: t('pages.vulnerabilities.feeds.badgeHint'),
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: { getValues: sourceValues, searchable: false },
      cellRenderer: (p: ICellRendererParams<VulnerabilityRow>) => (p.data ? <SourceBadges sources={p.data.match_sources} /> : null),
    },
    {
      headerName: t('pages.vulnerabilities.columns.editor'),
      field: 'editor',
      width: 130,
      // Hidden by default. The chooser shows it. EPSS is shown; the badge carries the exploited signal.
      defaultHidden: true,
      sortable: false,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: { getValues: editorValues },
      tooltipField: 'editor',
    },
    // The Servers and Applications columns filter the rows by their direct links (`asset`, `application`
    // in the grid model): several values keep the rows of any of them, both columns the rows of both.
    {
      headerName: t('pages.vulnerabilities.columns.servers'),
      colId: 'asset',
      valueGetter: (p: { data?: VulnerabilityRow }) => p.data?.servers,
      width: 105,
      type: 'rightAligned',
      sortable: false,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: { getValues: assetValues },
    },
    {
      headerName: t('pages.vulnerabilities.columns.applications'),
      colId: 'application',
      valueGetter: (p: { data?: VulnerabilityRow }) => p.data?.applications,
      width: 115,
      type: 'rightAligned',
      sortable: false,
      ...(readsApplications
        ? { filter: CheckboxSetFilter, floatingFilterComponent: CheckboxSetFloatingFilter, filterParams: { getValues: applicationValues } }
        : { filter: false }),
    },
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
  ], [applicationValues, assetValues, canEdit, editorValues, exploitedValues, locale, readsApplications, severityValues, sourceValues, stateValues, t, technologyValues, toggleAll, toggleRow, versionValues]);

  // One write, so resetting the alerts, the publication window and the shortcut cannot overwrite each other.
  // `subject: null` drops the address's asset and application, read once into their column filters.
  const writeSearch = (next: {
    alerts?: AlertsFilter;
    published?: PublishedPeriod;
    exploitedOnly?: boolean;
    subject?: null;
    estate?: false;
  }) => {
    const params = new URLSearchParams(location.search);
    if (next.alerts !== undefined) {
      if (next.alerts === 'included') params.delete('alerts');
      else params.set('alerts', next.alerts);
    }
    if (next.published !== undefined) {
      if (next.published === 'all') params.delete('published');
      else params.set('published', next.published);
    }
    if (next.exploitedOnly !== undefined) {
      if (next.exploitedOnly) params.set('exploited', '1');
      else params.delete('exploited');
    }
    if (next.subject === null) for (const kind of SUBJECT_KINDS) params.delete(kind);
    if (next.estate === false) params.delete('estate');
    const search = params.toString();
    navigate({ pathname: location.pathname, search: search ? `?${search}` : '' }, { replace: true });
  };
  const setAlerts = (next: AlertsFilter) => writeSearch({ alerts: next });

  // Muted rows inform only when both kinds are listed: under "Excluded" every row would be muted.
  const getRowClass = useCallback(
    ({ data }: { data?: VulnerabilityRow }) => (alerts === 'all' && data?.alerts === false ? 'vulnerability-row-muted' : undefined),
    [alerts],
  );

  // The rows in the alerts are none. The same query, for the rows kept out, says whether the empty
  // line can offer them. The offer keeps every other filter.
  const excludedProbe = useMemo(() => {
    if (alerts !== 'included' || !request || request.total !== 0) return null;
    return excludedProbeOf(request);
  }, [alerts, request]);
  // How fresh each feed is, for the line above the grid. A failed read shows no line.
  const feedSources = useQuery({
    queryKey: ['vulnerabilities', 'sources'],
    queryFn: async () => (await api.get<{ items: FeedSourceStatus[]; signals?: FeedSourceStatus[] }>(`${ENDPOINT}/sources`)).data,
    enabled: enabled && allowed,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  const excludedRows = useQuery({
    queryKey: ['vulnerabilities', 'excluded-rows', excludedProbe],
    queryFn: async () => Number((await api.get<{ total: number }>(ENDPOINT, { params: excludedProbe ?? {} })).data?.total ?? 0),
    enabled: enabled && allowed && excludedProbe != null,
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

  const publishedFilter = (
    <Stack direction="row" spacing={0.75} alignItems="center">
      <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>{t('pages.vulnerabilities.published.label')}</Typography>
      <TextField
        select
        variant="standard"
        value={published}
        onChange={(event) => writeSearch({ published: event.target.value as PublishedPeriod })}
        sx={inlineControlSx}
        SelectProps={{ MenuProps: reportFilterMenuProps, inputProps: { 'aria-label': t('pages.vulnerabilities.published.label') } }}
      >
        <MenuItem value="all" sx={drawerMenuItemSx}>{t('pages.vulnerabilities.published.all')}</MenuItem>
        {PUBLISHED_PERIODS.map((period) => (
          <MenuItem key={period} value={period} sx={drawerMenuItemSx}>{t(`pages.vulnerabilities.published.${period}`)}</MenuItem>
        ))}
      </TextField>
    </Stack>
  );

  if (!enabled) return null;
  if (!allowed) return <ForbiddenPage resource="infrastructure" level="reader" />;

  const exportFile = async (format: ExportFormat) => {
    setExportError(false);
    try {
      // Long filters go as a saved list context, as the other list exports.
      const res = await getWithListContext<Blob>(`${ENDPOINT}/export`, { ...scopeParams(requestRef.current), format }, { responseType: 'blob' });
      const headers = (res.headers ?? {}) as Record<string, unknown>;
      const disposition = (headers['content-disposition'] ?? headers['Content-Disposition']) as string | undefined;
      downloadBlob(res.data instanceof Blob ? res.data : new Blob([res.data]), extractFilenameFromDisposition(disposition) || `vulnerabilities.${format}`);
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
      <ExportFormatButton label={t('common:export.button')} onExport={exportFile} />
    </Stack>
  );

  return (
    <SelectionContext.Provider value={selectionApi}>
      <PageHeader title={t('pages.vulnerabilities.title')} actions={actions} />
      {exportError && (
        <Typography role="alert" sx={{ fontSize: 13, color: 'kanap.text.secondary', mb: 1 }}>{t('pages.vulnerabilities.exportFailed')}</Typography>
      )}
      <FeedAgeLine items={feedAgeItems(feedSources.data)} />
      <AddressFilterLine
        estate={estate}
        onRemoveEstate={() => writeSearch({ estate: false })}
      />
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
        extraNarrows={alerts !== 'included' || published !== 'all' || exploitedOnly || estate}
        onResetFilters={() => writeSearch({ alerts: 'included', published: 'all', exploitedOnly: false, subject: null, estate: false })}
        defaultFilterModel={OPENING_FILTER_MODEL}
        resetSortOnReset
        toolbarExtras={(
          <Stack direction="row" alignItems="center" useFlexGap flexWrap="wrap" sx={{ columnGap: 2, rowGap: 1 }}>
            {alertsFilter}
            {publishedFilter}
            <FormControlLabel
              sx={{ mr: 0 }}
              control={(
                <Switch
                  size="small"
                  checked={exploitedOnly}
                  onChange={(_event, checked) => writeSearch({ exploitedOnly: checked })}
                  inputProps={{ 'aria-label': t('pages.vulnerabilities.shortcut.exploitedOnly') }}
                />
              )}
              label={<Typography sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>{t('pages.vulnerabilities.shortcut.exploitedOnly')}</Typography>}
            />
          </Stack>
        )}
        getRowClass={getRowClass}
        getRowId={rowId}
        showRowCount
        rowCountText={rowCountText}
        defaultSort={{ field: 'exploited', direction: 'DESC' }}
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
          excludedProbe != null && (excludedRows.data ?? 0) > 0 ? (
            <Stack alignItems="center" spacing={0.5} data-testid="vulnerabilities-empty">
              <Typography sx={quietSx}>{t('pages.vulnerabilities.empty.noneInAlerts')}</Typography>
              <Button size="small" onClick={() => setAlerts('excluded')}>{t('pages.vulnerabilities.empty.showExcluded')}</Button>
            </Stack>
          ) : (
            <Typography sx={quietSx} data-testid="vulnerabilities-empty">
              {request?.params?.filters || request?.params?.q || alerts !== 'included' || published !== 'all' || exploitedOnly || estate
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
        PaperProps={{ sx: detailDrawerPaperSx }}
      >
        {openCve && (
          <Box sx={detailDrawerShellSx} role="region" aria-label={openCve}>
            <VulnerabilityDetailPanel
              cveId={openCve}
              canEdit={canEdit}
              onClose={() => setOpenCve(null)}
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
