import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import PageHeader from '../components/PageHeader';
import ServerDataGrid, { DATE_COLUMN_FILTER, EnhancedColDef, StatusScope } from '../components/ServerDataGrid';
import { Box, Button, Stack, useTheme } from '@mui/material';
import CsvExportDialog from '../components/csv/CsvExportDialog';
import CsvImportDialog from '../components/csv/CsvImportDialog';
import CheckboxSetFilter from '../components/CheckboxSetFilter';
import CheckboxSetFloatingFilter from '../components/CheckboxSetFloatingFilter';
import { useAuth } from '../auth/AuthContext';
import { LinkCellRenderer } from '../components/grid/renderers';
import { statusColumnProps } from '../components/grid/statusColumn';
import { StatusDot } from '../components/design';
import { getWithListContext } from '../lib/listContext';
import { formatShortDate } from '../lib/dateFormat';
import { useLocale } from '../i18n/useLocale';
import { statusScopeParams } from '../utils/statusScopeParams';
import { CONTRACT_TERM_STATE_COLORS, getDotColor } from '../utils/statusColors';
import { attentionDotSx, neutralLinkSx } from '../theme/formSx';
import ForbiddenPage from './ForbiddenPage';

/** The states of a contract's terms, computed by the API (`backend/src/contracts/contract-terms.ts`). */
const TERM_STATES = ['to_decide', 'in_progress', 'renewed', 'ending', 'expired'] as const;
type TermState = (typeof TERM_STATES)[number];

/** The decision window of the "to decide" state (`CONTRACT_DECISION_WINDOW_DAYS` on the API). */
const DECISION_WINDOW_DAYS = 90;

type ContractRow = {
  id: string;
  name: string;
  status: string;
  disabled_at?: string | null;
  company?: { id: string; name: string } | null;
  supplier?: { id: string; name: string } | null;
  owner_user_id?: string | null;
  start_date: string;
  duration_months: number;
  auto_renewal: boolean;
  notice_period_months: number;
  yearly_amount_at_signature: number;
  currency: string;
  billing_frequency: 'monthly' | 'quarterly' | 'annual' | 'other';
  notes?: string | null;
  end_date?: string;
  current_term_end?: string;
  cancellation_deadline?: string;
  next_due_date?: string | null;
  term_state?: TermState;
  linked_lines_count?: number;
  latest_task?: { id: string; description?: string; status?: string; created_at?: string } | null;
};

/** `GET /contracts/totals`: the footer and the quick filter count, for the list's current request. */
type ContractTotals = {
  count: number;
  yearly_amount: number;
  reporting_currency: string;
  fx_year: number;
  excluded: Array<{ currency: string; count: number }>;
  to_decide_count: number;
};

type ListQuery = { q: string; filters: string; statusScope: StatusScope };

const TOTALS_ROW_ID = '__contracts_total__';
const TO_DECIDE_FILTER = { filterType: 'set', values: ['to_decide'] };

function formatNumber(v: any) {
  const n = Number(v ?? 0);
  if (!isFinite(n)) return '';
  const i = Math.round(n);
  return i.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

const isPinned = (params: { node?: { rowPinned?: unknown } | null }) => Boolean(params.node?.rowPinned);

/** Calendar days from today (UTC, as the API dates terms) to `ymd`. */
export function daysFromToday(ymd: string, now: Date = new Date()): number {
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((Date.UTC(y, m - 1, d) - today) / 86_400_000);
}

/** `ymd` plus one day: the start of the term after one ending on `ymd`. */
function nextDay(ymd: string): string {
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** The day a contract stopped: its term end, or its end of validity when that came first. */
function endedOn(row: ContractRow): string | undefined {
  const termEnd = row.current_term_end ?? row.end_date;
  const validUntil = row.disabled_at ? new Date(row.disabled_at).toISOString().slice(0, 10) : null;
  if (!termEnd) return validUntil ?? undefined;
  return validUntil && validUntil < termEnd ? validUntil : termEnd;
}

function termStateLabel(t: TFunction, row: Pick<ContractRow, 'term_state' | 'current_term_end'>, locale: string): string {
  const state = row.term_state;
  if (!state) return '';
  if (state === 'renewed' && row.current_term_end) {
    return t('contracts.list.states.renewedOn', { date: formatShortDate(nextDay(row.current_term_end), locale, { year: 'always' }) });
  }
  return t(`contracts.list.states.${state}`);
}

const tertiarySx = { color: 'kanap.text.tertiary' } as const;

/** Next due date: the date, then "in n days" in tertiary; an ended contract shows its end in tertiary. */
function NextDueCell({ data }: { data?: ContractRow }) {
  const { t } = useTranslation('ops');
  const locale = useLocale();
  if (!data) return null;
  if (data.term_state === 'expired' || !data.next_due_date) {
    const ended = endedOn(data);
    return ended ? <Box component="span" sx={tertiarySx}>{formatShortDate(ended, locale, { year: 'always' })}</Box> : null;
  }
  const days = daysFromToday(data.next_due_date);
  return (
    <Box component="span" sx={{ whiteSpace: 'nowrap' }}>
      {formatShortDate(data.next_due_date, locale)}
      <Box component="span" sx={tertiarySx}>
        {' · '}
        {days === 0 ? t('contracts.list.dueToday') : t('contracts.list.dueIn', { count: days })}
      </Box>
    </Box>
  );
}

/** State: dot and text, colors from `utils/statusColors.ts`. */
function TermStateCell({ data }: { data?: ContractRow }) {
  const { t } = useTranslation('ops');
  const locale = useLocale();
  const theme = useTheme();
  if (!data?.term_state) return null;
  const color = getDotColor(CONTRACT_TERM_STATE_COLORS[data.term_state], theme.palette.mode);
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.8125rem', fontWeight: 500, color, lineHeight: 1 }}>
      <StatusDot color={color} />
      {termStateLabel(t, data, locale)}
    </Box>
  );
}

/** Yearly amount, right aligned, its currency in tertiary. */
function AmountCell({ data }: { data?: ContractRow }) {
  if (!data) return null;
  return (
    <Box component="span" sx={{ width: '100%', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
      {formatNumber(data.yearly_amount_at_signature)}
      <Box component="span" sx={tertiarySx}>{` ${data.currency ?? ''}`}</Box>
    </Box>
  );
}

/** True when the filter model narrows the state to "to decide" alone (the quick filter is on). */
export function isToDecideOnly(model: any): boolean {
  const values = model?.term_state?.values;
  return Array.isArray(values) && values.length === 1 && values[0] === 'to_decide' && model.term_state.mode !== 'exclude';
}

export default function ContractsPage() {
  const { hasLevel } = useAuth();
  const { t } = useTranslation(['ops', 'common']);
  const locale = useLocale();

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const lastQueryRef = useRef<{ sort: string; q: string; filters: any; statusScope?: StatusScope } | null>(null);
  const gridApiRef = useRef<any>(null);
  // The request the grid shows (search, filters, status scope), which the footer and the quick filter follow.
  const [listQuery, setListQuery] = useState<ListQuery | null>(null);

  const totals = useQuery({
    queryKey: ['contracts-totals', listQuery, refreshKey],
    enabled: listQuery != null,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) => {
      const params: Record<string, unknown> = { ...statusScopeParams(listQuery!.statusScope) };
      if (listQuery!.q) params.q = listQuery!.q;
      if (listQuery!.filters) params.filters = listQuery!.filters;
      const res = await getWithListContext<ContractTotals>('/contracts/totals', params, { signal });
      return res.data;
    },
  });

  const handleNew = () => {
    const sp = new URLSearchParams(searchParams);
    navigate(`/ops/contracts/new/overview?${sp.toString()}`);
  };

  // The grid's sort, search, filters and status scope, so prev/next in the workspace walks the same set.
  const getContractHref = useCallback((row: ContractRow) => {
    const sp = new URLSearchParams(searchParams);
    const state = lastQueryRef.current;
    if (state?.sort) sp.set('sort', state.sort);
    if (state?.q) sp.set('q', state.q);
    if (state?.filters && Object.keys(state.filters).length > 0) sp.set('filters', JSON.stringify(state.filters));
    if (state?.statusScope) sp.set('scope', state.statusScope);
    return `/ops/contracts/${row.id}/overview?${sp.toString()}`;
  }, [searchParams]);

  const linkCell = useCallback((params: any) => (
    <LinkCellRenderer
      {...params}
      linkType="internal"
      getHref={getContractHref}
      onNavigate={(href) => navigate(href)}
    />
  ), [getContractHref, navigate]);

  const columns: EnhancedColDef<ContractRow>[] = useMemo(() => [
    {
      field: 'name',
      headerName: t('contracts.columns.contract'),
      flex: 1,
      minWidth: 220,
      required: true,
      cellRenderer: linkCell,
    },
    {
      colId: 'supplier_name',
      headerName: t('contracts.columns.supplier'),
      width: 180,
      valueGetter: (p) => p.data?.supplier?.name || '',
      cellRenderer: linkCell,
    },
    {
      colId: 'company_name',
      headerName: t('contracts.columns.company'),
      width: 180,
      valueGetter: (p) => p.data?.company?.name || '',
      cellRenderer: linkCell,
    },
    {
      field: 'next_due_date',
      headerName: t('contracts.columns.nextDue'),
      width: 215,
      ...DATE_COLUMN_FILTER,
      valueFormatter: (p) => (isPinned(p) ? '' : formatShortDate(p.value, locale)),
      cellRenderer: NextDueCell,
    },
    {
      field: 'term_state',
      headerName: t('contracts.columns.state'),
      width: 210,
      sortable: false,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        values: TERM_STATES.map((value) => ({ value, label: t(`contracts.list.states.${value}`) })),
        searchable: false,
      },
      valueFormatter: (p) => (isPinned(p) || !p.data ? '' : termStateLabel(t, p.data, locale)),
      cellRenderer: TermStateCell,
    },
    {
      field: 'yearly_amount_at_signature',
      headerName: t('contracts.columns.yearlyAmount'),
      width: 170,
      type: 'rightAligned',
      // The totals row: the sum in the reporting currency (default renderer).
      valueFormatter: (p) => (isPinned(p) ? `${formatNumber(p.value)} ${p.data?.currency ?? ''}`.trim() : formatNumber(p.value)),
      cellRenderer: AmountCell,
    },
    { field: 'currency', headerName: t('contracts.columns.currency'), width: 90, defaultHidden: true, valueFormatter: (p) => (isPinned(p) ? '' : p.value ?? '') },
    {
      colId: 'linked_lines_count',
      headerName: t('contracts.columns.linkedLines'),
      width: 140,
      type: 'rightAligned',
      sortable: false,
      valueGetter: (p) => (isPinned(p) ? '' : p.data?.linked_lines_count ?? 0),
      cellRenderer: linkCell,
    },
    {
      field: 'status',
      headerName: t('master-data:shared.columns.status'),
      width: 140,
      ...statusColumnProps(t),
      cellRenderer: linkCell,
    },
    { field: 'start_date', headerName: t('contracts.columns.start'), width: 120, defaultHidden: true, valueFormatter: (p) => formatShortDate(p.value, locale) },
    { field: 'duration_months', headerName: t('contracts.columns.durationMonths'), width: 130, type: 'rightAligned', defaultHidden: true },
    { field: 'auto_renewal', headerName: t('contracts.columns.autoRenewal'), width: 130, defaultHidden: true, valueFormatter: (p) => (isPinned(p) ? '' : p.value ? t('shared.yes') : t('shared.no')) },
    { field: 'notice_period_months', headerName: t('contracts.columns.noticeMonths'), width: 120, type: 'rightAligned', defaultHidden: true },
    { field: 'end_date', headerName: t('contracts.columns.end'), width: 120, defaultHidden: true, valueFormatter: (p) => formatShortDate(p.value, locale) },
    { field: 'cancellation_deadline', headerName: t('contracts.columns.cancelBy'), width: 140, defaultHidden: true, valueFormatter: (p) => formatShortDate(p.value, locale) },
    { field: 'billing_frequency', headerName: t('contracts.columns.billing'), width: 120, defaultHidden: true },
    { colId: 'latest_task_text', headerName: t('contracts.columns.task'), flex: 1, minWidth: 200, defaultHidden: true, valueGetter: (p) => {
      const t = p.data?.latest_task; if (!t) return ''; const s = t.status || ''; const d = (t.description || '').toString(); const short = d.length > 40 ? `${d.slice(0,40)}…` : d; return s ? `${s}: ${short}` : short;
    } },
  ], [linkCell, locale, t]);

  const pinnedTotals = useMemo(() => {
    const data = totals.data;
    if (!data || totals.isError) return [];
    const label = [
      t('contracts.list.total', { count: data.count }),
      ...data.excluded.map((entry) => t('contracts.list.totalExcluded', { count: entry.count, currency: entry.currency })),
    ].join(' · ');
    return [{
      id: TOTALS_ROW_ID,
      name: label,
      yearly_amount_at_signature: data.yearly_amount,
      currency: data.reporting_currency,
    }];
  }, [totals.data, totals.isError, t]);

  const toDecideActive = isToDecideOnly(safeParse(listQuery?.filters ?? ''));
  const toggleToDecide = useCallback(() => {
    const api = gridApiRef.current;
    if (!api?.setFilterModel) return;
    const model = { ...(api.getFilterModel?.() ?? {}) };
    if (isToDecideOnly(model)) delete model.term_state;
    else model.term_state = TO_DECIDE_FILTER;
    api.setFilterModel(model);
  }, []);

  // After every hook, so the hook order never depends on the permission.
  if (!hasLevel('contracts', 'reader')) {
    return <ForbiddenPage />;
  }

  const canCreate = hasLevel('contracts','manager');
  const canAdmin = hasLevel('contracts','admin');
  const actions = (
    <Stack direction="row" spacing={1}>
      {canCreate && <Button variant="action-primary" onClick={handleNew}>{t('contracts.newButton')}</Button>}
      {canAdmin && <Button variant="action" onClick={() => setImportOpen(true)}>{t('contracts.importCsv')}</Button>}
      {canAdmin && <Button variant="action" onClick={() => setExportOpen(true)}>{t('contracts.exportCsv')}</Button>}
    </Stack>
  );

  const toDecideCount = totals.data?.to_decide_count;
  const quickFilter = (
    <Box sx={{ display: 'flex', alignItems: 'center', columnGap: '8px', fontSize: 13, color: 'kanap.text.secondary' }}>
      {!!toDecideCount && <Box component="span" sx={attentionDotSx} />}
      <Box
        component="button"
        type="button"
        aria-pressed={toDecideActive}
        onClick={toggleToDecide}
        sx={neutralLinkSx(toDecideActive)}
      >
        {t('contracts.list.toDecide', { days: DECISION_WINDOW_DAYS, count: toDecideCount ?? 0 })}
      </Box>
    </Box>
  );

  return (
    <>
      <PageHeader title={t("contracts.title")} actions={actions} />
      <ServerDataGrid<ContractRow>
        columns={columns}
        endpoint="/contracts"
        queryKey="contracts"
        getRowId={(r) => r.id}
        enableSearch={true}
        defaultSort={{ field: 'next_due_date', direction: 'ASC' }}
        refreshKey={refreshKey}
        columnPreferencesKey="contracts-grid"
        // Lists active contracts by default; "All" or "Disabled" reaches those past their end of validity.
        statusScopeConfig={{ defaultScope: 'enabled' }}
        toolbarExtras={quickFilter}
        pinnedBottomRowData={pinnedTotals}
        onGridApiReady={(api) => { gridApiRef.current = api; }}
        onQueryStateChange={(state) => {
          const filters = state.filterModel || {};
          const statusScope = state.statusScope ?? 'enabled';
          lastQueryRef.current = { sort: state.sort, q: state.q || '', filters, statusScope };
          const next: ListQuery = { q: state.q || '', filters: Object.keys(filters).length > 0 ? JSON.stringify(filters) : '', statusScope };
          setListQuery((prev) => (prev && prev.q === next.q && prev.filters === next.filters && prev.statusScope === next.statusScope ? prev : next));
        }}
      />

      <CsvExportDialog open={exportOpen} onClose={() => setExportOpen(false)} endpoint="/contracts" title={t("contracts.exportTitle")} />
      <CsvImportDialog open={importOpen} onClose={() => setImportOpen(false)} endpoint="/contracts" title={t("contracts.importTitle")} onImported={() => setRefreshKey(k => k + 1)} />
    </>
  );
}

function safeParse(text: string): any {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
