import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import PageHeader from '../components/PageHeader';
import ServerDataGrid, { DATE_COLUMN_FILTER, EnhancedColDef, StatusScope, type ListRequest } from '../components/ServerDataGrid';
import { Alert, Box, Button, MenuItem, Select, Stack, Typography, useTheme } from '@mui/material';
import CsvExportDialog from '../components/csv/CsvExportDialog';
import CsvImportDialog from '../components/csv/CsvImportDialog';
import CheckboxSetFilter from '../components/CheckboxSetFilter';
import CheckboxSetFloatingFilter from '../components/CheckboxSetFloatingFilter';
import { useAuth } from '../auth/AuthContext';
import { useDataAccessLimited } from '../auth/dataAccess';
import { LinkCellRenderer } from '../components/grid/renderers';
import { statusColumnProps } from '../components/grid/statusColumn';
import { StatusDot } from '../components/design';
import { getWithListContext } from '../lib/listContext';
import { formatShortDate } from '../lib/dateFormat';
import { useLocale } from '../i18n/useLocale';
import { statusScopeParams } from '../utils/statusScopeParams';
import { CONTRACT_TERM_STATE_COLORS, getDotColor } from '../utils/statusColors';
import { attentionDotSx, compactSelectMenuProps, drawerMenuItemSx, drawerSelectSx, inlineControlSx, neutralLinkSx } from '../theme/formSx';
import type { AmountMeasure } from '../components/finance/roundPeriod';
import FxMissingNotice, { FxMissingMark } from '../components/finance/FxMissingNotice';
import type { FxMissing } from '../components/finance/fxMissing';
import ForbiddenPage from './ForbiddenPage';
import {
  CONTRACT_BUDGET_STATES,
  formatSignedAmount,
  offeredBudgetYears,
  useContractBudgetChoice,
  type ContractBudgetState,
} from './contracts/contractBudget';
import ContractBudgetStateLabel from './contracts/ContractBudgetStateLabel';
import ContractComplianceSummaryLabel from './contracts/ContractComplianceSummaryLabel';
import { COMPLIANCE_SUMMARY_STATES, type ComplianceSummary } from './contracts/contractCompliance';
import { screenLanguage } from '../components/csv/readings';
import { downloadBlob, extractFilenameFromDisposition } from '../utils/downloadBlob';
import ExportFormatButton from '../components/csv/ExportFormatButton';
import type { ExportFormat } from '../components/csv/exportFormat';
import { getApiErrorMessage } from '../utils/apiErrorMessage';
import ContractSettingsDialog from './contracts/ContractSettingsDialog';
import DeleteSelectedButton from '../components/DeleteSelectedButton';
import { contractDeleteCheck } from './contracts/contractDelete';
import { ImportLabel } from '../components/csv/importFiles';

/** The states of a contract's terms, computed by the API (`backend/src/contracts/contract-terms.ts`). */
const TERM_STATES = ['to_decide', 'in_progress', 'renewed', 'ending', 'expired'] as const;
type TermState = (typeof TERM_STATES)[number];

type ContractRow = {
  id: string;
  name: string;
  status: string;
  disabled_at?: string | null;
  company?: { id: string; name: string } | null;
  supplier?: { id: string; name: string } | null;
  /** The contract's place in the cost centre tree (a group or a centre). */
  cost_center_id?: string | null;
  cost_center_name?: string | null;
  /** False for a limited person whose access does not let them modify it; absent without a data access. */
  editable?: boolean;
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
  /** The first cancellation deadline on or after today (`contract-terms.ts`). */
  next_cancellation_deadline?: string | null;
  next_due_date?: string | null;
  term_state?: TermState;
  linked_lines_count?: number;
  latest_task?: { id: string; description?: string; status?: string; created_at?: string } | null;
  /** With a budget year and column, for a reader of the budget (`backend/src/contracts/contract-budget.ts`). */
  budget_committed?: number | null;
  budget_linked?: number;
  /** A linked line has an amount without a rate that year: left out of `budget_linked`, gap and state unknown (null). */
  budget_linked_fx_missing?: boolean;
  budget_gap?: number | null;
  budget_state?: ContractBudgetState | null;
  /** What the compliance register expects of the contract and what is missing (`backend/src/contracts/contract-compliance.ts`). */
  compliance?: ComplianceSummary;
};

/** `GET /contracts/totals`: the footer and the quick filter count, for the list's current request. */
type ContractTotals = {
  count: number;
  yearly_amount: number;
  reporting_currency: string;
  fx_year: number;
  excluded: Array<{ currency: string; count: number }>;
  to_decide_count: number;
  /** The tenant's decision window of the "to decide" state, in days (`backend/src/contracts/contract-settings.service.ts`). */
  decision_window_days: number;
  /** The budget figures' sums and quick filter counts, with a budget year and column. */
  budget?: {
    year: number;
    column: string;
    reporting_currency: string;
    committed: number;
    linked: number;
    gap: number;
    /** The linked lines left out of `linked` for lack of a rate. */
    linked_fx_missing?: FxMissing[];
    excluded: Array<{ currency: string; count: number }>;
    no_line_count: number;
    under_count: number;
    years: number[];
  };
};

type ListQuery = { q: string; filters: string; statusScope: StatusScope };

const TOTALS_ROW_ID = '__contracts_total__';
const TO_DECIDE_FILTER = { filterType: 'set', values: ['to_decide'] };
/** The budget quick filters: one state of the budget coverage at a time. */
const BUDGET_QUICK_FILTERS = ['no_line', 'under'] as const;
type BudgetQuickFilter = (typeof BUDGET_QUICK_FILTERS)[number];

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

/** The calendar day of an API date, or null when there is none. */
function calendarDay(value: string | null | undefined): string | null {
  if (!value) return null;
  const day = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

/**
 * The next due date is the cancellation deadline when it is that deadline and it is not also the
 * end of the current term. A notice of zero months, or a contract that stops, falls on the end.
 */
function nextDueIsCancellation(row: Pick<ContractRow, 'next_due_date' | 'next_cancellation_deadline' | 'current_term_end'>): boolean {
  const due = calendarDay(row.next_due_date);
  return due !== null && due === calendarDay(row.next_cancellation_deadline) && due !== calendarDay(row.current_term_end);
}

/** Next due date: what the date is, then "in n days" in tertiary; an ended contract shows its end in tertiary. */
function NextDueCell({ data }: { data?: ContractRow }) {
  const { t } = useTranslation('ops');
  const locale = useLocale();
  if (!data) return null;
  if (data.term_state === 'expired' || !data.next_due_date) {
    const ended = endedOn(data);
    return ended ? <Box component="span" sx={tertiarySx}>{formatShortDate(ended, locale, { year: 'always' })}</Box> : null;
  }
  const date = formatShortDate(data.next_due_date, locale, { year: 'always' });
  const label = nextDueIsCancellation(data)
    ? t('contracts.deadlines.cancelUntil', { date })
    : t('contracts.deadlines.endsOn', { date });
  const days = daysFromToday(data.next_due_date);
  const when = days === 0 ? t('contracts.list.dueToday') : t('contracts.list.dueIn', { count: days });
  return (
    <Box component="span" title={`${label} · ${when}`} sx={{ whiteSpace: 'nowrap' }}>
      {label}
      <Box component="span" sx={tertiarySx}>
        {' · '}
        {when}
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

const amountSx = { width: '100%', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' } as const;
const warningSx = { color: 'kanap.orange' } as const;

/** A budget amount of the list; a contract whose currency has no rate that year shows it in tertiary. */
function BudgetCommittedCell({ data }: { data?: ContractRow }) {
  const { t } = useTranslation('ops');
  if (!data) return null;
  if (data.budget_committed == null) {
    return data.budget_linked === undefined ? null : (
      <Box component="span" sx={[amountSx, tertiarySx]}>{t('contracts.budget.noRate', { currency: data.currency })}</Box>
    );
  }
  return <Box component="span" sx={amountSx}>{formatNumber(data.budget_committed)}</Box>;
}

/** The linked lines' sum; a line left out for lack of a rate puts the mark beside it. */
function BudgetLinkedCell({ data, year }: { data?: ContractRow; year?: number }) {
  const { t } = useTranslation('ops');
  if (!data || data.budget_linked === undefined) return null;
  const amountSxs = [amountSx, data.budget_linked === 0 ? tertiarySx : {}];
  if (!data.budget_linked_fx_missing) return <Box component="span" sx={amountSxs}>{formatNumber(data.budget_linked)}</Box>;
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px', width: '100%' }}>
      <Box component="span" sx={[...amountSxs, { width: 'auto' }]}>{formatNumber(data.budget_linked)}</Box>
      <FxMissingMark label={t('contracts.budget.linkedFxMissing', { year })} />
    </Box>
  );
}

/** The gap with its sign, a shortfall in orange; "no line" or "contract expired" when that is the point. */
function BudgetGapCell({ data }: { data?: ContractRow }) {
  const { t } = useTranslation('ops');
  if (!data) return null;
  if (data.budget_state === 'no_line') return <Box component="span" sx={[amountSx, warningSx]}>{t('contracts.list.gapNoLine')}</Box>;
  if (data.term_state === 'expired' && (data.budget_linked ?? 0) > 0) {
    return <Box component="span" sx={[amountSx, warningSx]}>{t('contracts.list.gapExpired')}</Box>;
  }
  // Nothing committed and nothing budgeted: nothing to compare.
  if (data.budget_gap == null || data.budget_state === 'no_commitment') return null;
  return <Box component="span" sx={[amountSx, data.budget_gap < 0 ? warningSx : {}]}>{formatSignedAmount(data.budget_gap)}</Box>;
}

function BudgetStateCell({ data }: { data?: ContractRow }) {
  return <ContractBudgetStateLabel state={data?.budget_state} />;
}

function ComplianceCell({ data, node }: { data?: ContractRow; node?: { rowPinned?: unknown } | null }) {
  if (node?.rowPinned) return null;
  return <ContractComplianceSummaryLabel summary={data?.compliance} />;
}

/** The budget quick filter the filter model sets (the budget state narrowed to one of them), or null. */
export function budgetQuickFilterOf(model: any): BudgetQuickFilter | null {
  const values = model?.budget_state?.values;
  if (!Array.isArray(values) || values.length !== 1 || model.budget_state.mode === 'exclude') return null;
  return (BUDGET_QUICK_FILTERS as readonly string[]).includes(values[0]) ? values[0] as BudgetQuickFilter : null;
}

/** True when the filter model narrows the state to "to decide" alone (the quick filter is on). */
export function isToDecideOnly(model: any): boolean {
  const values = model?.term_state?.values;
  return Array.isArray(values) && values.length === 1 && values[0] === 'to_decide' && model.term_state.mode !== 'exclude';
}

const WITHOUT_COST_CENTER_FILTER = { filterType: 'set', values: [null] };

/** True when the filter model keeps the contracts without a cost centre alone (the quick filter is on). */
export function isWithoutCostCenterOnly(model: any): boolean {
  const values = model?.cost_center_id?.values;
  return Array.isArray(values) && values.length === 1 && values[0] === null && model.cost_center_id.mode !== 'exclude';
}

/**
 * The budget columns of a year (`budget_year`, `budget_column` on the list's requests): sorted and
 * filtered on the server; the coverage state stays in the column chooser and carries the budget
 * quick filters.
 */
function budgetColumns(t: TFunction, year: number): EnhancedColDef<ContractRow>[] {
  const amount = (p: { value?: unknown }) => (p.value == null ? '' : formatNumber(p.value));
  return [
    {
      field: 'budget_committed',
      headerName: t('contracts.columns.committed', { year }),
      width: 140,
      type: 'rightAligned',
      filter: 'agNumberColumnFilter',
      valueFormatter: amount,
      cellRenderer: BudgetCommittedCell,
    },
    {
      field: 'budget_linked',
      headerName: t('contracts.columns.budgetLinked', { year }),
      width: 140,
      type: 'rightAligned',
      filter: 'agNumberColumnFilter',
      valueFormatter: amount,
      cellRenderer: BudgetLinkedCell,
      cellRendererParams: { year },
    },
    {
      field: 'budget_gap',
      headerName: t('contracts.columns.gap'),
      width: 130,
      type: 'rightAligned',
      filter: 'agNumberColumnFilter',
      valueFormatter: (p) => (p.value == null ? '' : isPinned(p) ? formatSignedAmount(Number(p.value)) : String(p.value)),
      cellRenderer: BudgetGapCell,
    },
    {
      field: 'budget_state',
      headerName: t('contracts.columns.budgetState'),
      width: 200,
      sortable: false,
      defaultHidden: true,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        values: CONTRACT_BUDGET_STATES.map((value) => ({ value, label: t(`contracts.budget.states.${value}`) })),
        searchable: false,
      },
      valueFormatter: (p) => (isPinned(p) || !p.value ? '' : t(`contracts.budget.states.${p.value}`)),
      cellRenderer: BudgetStateCell,
    },
  ];
}

export default function ContractsPage() {
  const { hasLevel } = useAuth();
  const limited = useDataAccessLimited();
  const { t, i18n } = useTranslation(['ops', 'common']);
  const locale = useLocale();

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [exportOpen, setExportOpen] = useState(false);
  // The list on screen: the CSV export follows it.
  const [listRequest, setListRequest] = useState<ListRequest | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedRows, setSelectedRows] = useState<ContractRow[]>([]);
  const lastQueryRef = useRef<{ sort: string; q: string; filters: any; statusScope?: StatusScope } | null>(null);
  const gridApiRef = useRef<any>(null);
  // The request the grid shows (search, filters, status scope), which the footer and the quick filter follow.
  const [listQuery, setListQuery] = useState<ListQuery | null>(null);
  // The budget year and column of the budget columns (kept per user, shared with the contract page);
  // only for a reader of the budget, the API ignores them otherwise.
  const canReadBudget = hasLevel('budget', 'reader');
  const budgetChoice = useContractBudgetChoice();
  const budgetParams = useMemo<Record<string, string>>(
    (): Record<string, string> => (canReadBudget ? { budget_year: String(budgetChoice.year), budget_column: budgetChoice.column } : {}),
    [canReadBudget, budgetChoice.year, budgetChoice.column],
  );

  const totals = useQuery({
    queryKey: ['contracts-totals', listQuery, budgetParams, refreshKey],
    enabled: listQuery != null,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) => {
      const params: Record<string, unknown> = { ...statusScopeParams(listQuery!.statusScope), ...budgetParams };
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
    // The budget figures the list sorts and filters on, so prev/next follows the same order.
    for (const [key, value] of Object.entries(budgetParams)) sp.set(key, value);
    return `/ops/contracts/${row.id}/overview?${sp.toString()}`;
  }, [searchParams, budgetParams]);

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
      // Sorted by id on the server, so the column stays unsorted; filtered on the id: the one option
      // is "Without cost center" (`cost_center_id` with a null value, spec §3.3, §7.7).
      colId: 'cost_center_id',
      headerName: t('contracts.columns.costCenter'),
      width: 180,
      defaultHidden: true,
      sortable: false,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        values: [{ value: null, label: t('contracts.list.withoutCostCenter') }],
        searchable: false,
      },
      valueGetter: (p) => p.data?.cost_center_name || '',
    },
    {
      field: 'next_due_date',
      headerName: t('contracts.columns.nextDue'),
      // "Cancellation possible until 30 Sep 2027 · in 211 days" is about 320px at 13px, plus the cell padding.
      width: 360,
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
    ...(canReadBudget ? budgetColumns(t, budgetChoice.year) : []),
    {
      // Sorted and filtered on the server (`compliance_state`): missing, to check, complete, none.
      colId: 'compliance_state',
      headerName: t('contracts.columns.compliance'),
      width: 190,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        values: COMPLIANCE_SUMMARY_STATES.map((value) => ({ value, label: t(`contracts.compliance.summary.states.${value}`) })),
        searchable: false,
      },
      valueGetter: (p) => (isPinned(p) ? '' : p.data?.compliance?.state ?? ''),
      valueFormatter: (p) => (isPinned(p) || !p.value ? '' : t(`contracts.compliance.summary.states.${p.value}`)),
      cellRenderer: ComplianceCell,
    },
    {
      colId: 'linked_lines_count',
      headerName: t('contracts.columns.linkedLines'),
      width: 140,
      type: 'rightAligned',
      sortable: false,
      filter: 'agNumberColumnFilter',
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
    { field: 'start_date', headerName: t('contracts.columns.start'), width: 120, defaultHidden: true, ...DATE_COLUMN_FILTER, valueFormatter: (p) => formatShortDate(p.value, locale) },
    { field: 'duration_months', headerName: t('contracts.columns.durationMonths'), width: 130, type: 'rightAligned', defaultHidden: true },
    {
      field: 'auto_renewal',
      headerName: t('contracts.columns.autoRenewal'),
      width: 130,
      defaultHidden: true,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: { values: [{ value: 'true', label: t('shared.yes') }, { value: 'false', label: t('shared.no') }], searchable: false },
      valueFormatter: (p) => (isPinned(p) ? '' : p.value ? t('shared.yes') : t('shared.no')) },
    { field: 'notice_period_months', headerName: t('contracts.columns.noticeMonths'), width: 120, type: 'rightAligned', defaultHidden: true },
    { field: 'end_date', headerName: t('contracts.columns.end'), width: 120, defaultHidden: true, ...DATE_COLUMN_FILTER, valueFormatter: (p) => formatShortDate(p.value, locale) },
    { field: 'cancellation_deadline', headerName: t('contracts.columns.cancelBy'), width: 140, defaultHidden: true, ...DATE_COLUMN_FILTER, valueFormatter: (p) => formatShortDate(p.value, locale) },
    { field: 'billing_frequency', headerName: t('contracts.columns.billing'), width: 120, defaultHidden: true },
    { colId: 'latest_task_text', headerName: t('contracts.columns.task'), flex: 1, minWidth: 200, defaultHidden: true, valueGetter: (p) => {
      const t = p.data?.latest_task; if (!t) return ''; const s = t.status || ''; const d = (t.description || '').toString(); const short = d.length > 40 ? `${d.slice(0,40)}…` : d; return s ? `${s}: ${short}` : short;
    } },
  ], [linkCell, locale, t, canReadBudget, budgetChoice.year]);

  const pinnedTotals = useMemo(() => {
    const data = totals.data;
    if (!data || totals.isError) return [];
    const budget = data.budget;
    return [{
      id: TOTALS_ROW_ID,
      name: t('contracts.list.total', { count: data.count }),
      yearly_amount_at_signature: data.yearly_amount,
      currency: data.reporting_currency,
      ...(budget ? { budget_committed: budget.committed, budget_linked: budget.linked, budget_gap: budget.gap } : {}),
    }];
  }, [totals.data, totals.isError, t]);

  // The long notes leave the name cell: that column is the narrow one, and it cut them off.
  const exclusionNotes = useMemo(() => {
    const data = totals.data;
    if (!data || totals.isError) return [];
    const budget = data.budget;
    const notes = data.excluded.map((entry) => t('contracts.list.totalExcluded', { count: entry.count, currency: entry.currency }));
    if (budget) {
      const year = budget.year;
      notes.push(...budget.excluded.map((entry) => t('contracts.list.committedExcluded', { count: entry.count, currency: entry.currency, year })));
    }
    return notes;
  }, [totals.data, totals.isError, t]);

  const currentModel = safeParse(listQuery?.filters ?? '');
  const toDecideActive = isToDecideOnly(currentModel);
  const withoutCostCenterActive = isWithoutCostCenterOnly(currentModel);
  const budgetQuick = budgetQuickFilterOf(currentModel);
  const toggleBudgetQuick = useCallback((state: BudgetQuickFilter) => {
    const api = gridApiRef.current;
    if (!api?.setFilterModel) return;
    const model = { ...(api.getFilterModel?.() ?? {}) };
    if (budgetQuickFilterOf(model) === state) delete model.budget_state;
    else model.budget_state = { filterType: 'set', values: [state] };
    api.setFilterModel(model);
  }, []);
  const toggleToDecide = useCallback(() => {
    const api = gridApiRef.current;
    if (!api?.setFilterModel) return;
    const model = { ...(api.getFilterModel?.() ?? {}) };
    if (isToDecideOnly(model)) delete model.term_state;
    else model.term_state = TO_DECIDE_FILTER;
    api.setFilterModel(model);
  }, []);
  const toggleWithoutCostCenter = useCallback(() => {
    const api = gridApiRef.current;
    if (!api?.setFilterModel) return;
    const model = { ...(api.getFilterModel?.() ?? {}) };
    if (isWithoutCostCenterOnly(model)) delete model.cost_center_id;
    else model.cost_center_id = WITHOUT_COST_CENTER_FILTER;
    api.setFilterModel(model);
  }, []);

  // After every hook, so the hook order never depends on the permission.
  if (!hasLevel('contracts', 'reader')) {
    return <ForbiddenPage resource="contracts" level="reader" />;
  }

  const canCreate = hasLevel('contracts','manager');
  const canAdmin = hasLevel('contracts','admin');
  // The compliance register of the contracts the list shows (search, filters, scope, sort), in the screen's language.
  const exportRegister = async (format: ExportFormat) => {
    setRegisterError(null);
    const params: Record<string, unknown> = {
      ...statusScopeParams(listQuery?.statusScope ?? 'enabled'),
      ...budgetParams,
      language: screenLanguage(i18n.resolvedLanguage || i18n.language),
      format,
    };
    if (listQuery?.q) params.q = listQuery.q;
    if (listQuery?.filters) params.filters = listQuery.filters;
    if (listRequest?.params?.sort) params.sort = listRequest.params.sort;
    try {
      const res = await getWithListContext<Blob>('/contracts/compliance-register/export', params, { responseType: 'blob' });
      const filename = extractFilenameFromDisposition(res.headers?.['content-disposition']) || `contract-compliance-register.${format}`;
      downloadBlob(res.data instanceof Blob ? res.data : new Blob([res.data]), filename);
    } catch (e) {
      setRegisterError(getApiErrorMessage(e, t, t('contracts.compliance.exportFailed')));
    }
  };
  const actions = (
    <Stack direction="row" spacing={1}>
      {canCreate && <Button variant="action-primary" onClick={handleNew}>{t('contracts.newButton')}</Button>}
      {canAdmin && !limited && <Button variant="action" onClick={() => setImportOpen(true)}><ImportLabel csv={t('contracts.importCsv')} /></Button>}
      {canAdmin && <Button variant="action" onClick={() => setExportOpen(true)}>{t('common:export.button')}</Button>}
      {canAdmin && <ExportFormatButton label={t('contracts.compliance.exportRegister')} onExport={exportRegister} />}
      {canAdmin && !limited && <Button variant="action" onClick={() => setSettingsOpen(true)}>{t('contracts.renewal.settings.button')}</Button>}
      {canAdmin && !limited && (
        <DeleteSelectedButton
          selectedRows={selectedRows}
          endpoint="/contracts/bulk"
          getItemId={(row) => row.id}
          getItemName={(row) => row.name}
          gridApi={gridApiRef.current}
          onDeleteSuccess={() => setRefreshKey((k) => k + 1)}
          // Asked on click: the contracts refused for their recorded requirements, then for the
          // others what loses its link and what goes too.
          checkDelete={(ids) => contractDeleteCheck(ids, t, locale)}
          itemLabels={{
            toDelete: (count) => t('contracts.delete.toDelete', { count }),
            kept: (count) => t('contracts.delete.kept', { count }),
            deleted: (count) => t('contracts.delete.deleted', { count }),
          }}
        />
      )}
    </Stack>
  );

  const toDecideCount = totals.data?.to_decide_count;
  // The window comes with the totals: the link waits for them rather than show another number.
  const decisionWindowDays = totals.data?.decision_window_days;
  const budgetTotals = totals.data?.budget;
  const quickLink = (key: string, label: string, count: number | undefined, active: boolean, onClick: () => void) => (
    <Box key={key} sx={{ display: 'flex', alignItems: 'center', columnGap: '8px' }}>
      {!!count && <Box component="span" sx={attentionDotSx} />}
      <Box component="button" type="button" aria-pressed={active} onClick={onClick} sx={neutralLinkSx(active)}>
        {label}
      </Box>
    </Box>
  );
  const budgetYears = offeredBudgetYears(budgetTotals?.years, budgetChoice.year);
  const quickFilter = (
    <Box sx={{ display: 'flex', alignItems: 'center', columnGap: 2, rowGap: 1, flexWrap: 'wrap', flex: '1 1 auto', fontSize: 13, color: 'kanap.text.secondary' }}>
      {decisionWindowDays !== undefined && quickLink('to_decide', t('contracts.list.toDecide', { days: decisionWindowDays, count: toDecideCount ?? 0 }), toDecideCount, toDecideActive, toggleToDecide)}
      {quickLink('without_cost_center', t('contracts.list.withoutCostCenter'), undefined, withoutCostCenterActive, toggleWithoutCostCenter)}
      {canReadBudget && quickLink('no_line', t('contracts.list.noBudgetLine', { count: budgetTotals?.no_line_count ?? 0 }), budgetTotals?.no_line_count, budgetQuick === 'no_line', () => toggleBudgetQuick('no_line'))}
      {canReadBudget && quickLink('under', t('contracts.list.underBudgeted', { count: budgetTotals?.under_count ?? 0 }), budgetTotals?.under_count, budgetQuick === 'under', () => toggleBudgetQuick('under'))}
      {canReadBudget && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, ml: 'auto' }}>
          {t('contracts.list.budgetSelector')}
          <Select
            variant="standard"
            value={budgetChoice.year}
            onChange={(event) => budgetChoice.setYear(Number(event.target.value))}
            sx={[drawerSelectSx, inlineControlSx, { width: 'auto', minWidth: 56 }]}
            MenuProps={compactSelectMenuProps}
            inputProps={{ 'aria-label': t('contracts.list.budgetYear') }}
          >
            {budgetYears.map((year) => <MenuItem key={year} value={year} sx={drawerMenuItemSx}>{year}</MenuItem>)}
          </Select>
          <Select
            variant="standard"
            value={budgetChoice.column}
            onChange={(event) => budgetChoice.setColumn(event.target.value as AmountMeasure)}
            sx={[drawerSelectSx, inlineControlSx, { width: 'auto', minWidth: 90 }]}
            MenuProps={compactSelectMenuProps}
            inputProps={{ 'aria-label': t('contracts.budget.column') }}
          >
            {budgetChoice.columns.map((column) => <MenuItem key={column.measure} value={column.measure} sx={drawerMenuItemSx}>{column.label}</MenuItem>)}
          </Select>
        </Box>
      )}
    </Box>
  );

  return (
    <>
      <PageHeader title={t("contracts.title")} actions={actions} />
      {registerError && <Alert severity="error" sx={{ mb: 1 }} onClose={() => setRegisterError(null)}>{registerError}</Alert>}
      <ServerDataGrid<ContractRow>
        onListRequestChange={setListRequest}
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
        extraParams={budgetParams}
        toolbarExtras={quickFilter}
        pinnedBottomRowData={pinnedTotals}
        // Currencies without a rate, on their own rows under the totals, so the name cell stays short.
        footer={(exclusionNotes.length || budgetTotals?.linked_fx_missing?.length) ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, minWidth: 0, maxWidth: '100%' }}>
            {exclusionNotes.length > 0 && (
              <Box sx={{ fontSize: 12, lineHeight: '20px', color: 'kanap.text.secondary', whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
                {exclusionNotes.join(' · ')}
              </Box>
            )}
            {budgetTotals?.linked_fx_missing?.length ? <FxMissingNotice items={budgetTotals.linked_fx_missing} wrap /> : null}
          </Box>
        ) : undefined}
        onGridApiReady={(api) => { gridApiRef.current = api; }}
        enableRowSelection={canAdmin && !limited}
        onSelectionChanged={setSelectedRows}
        emptyState={(
          <Stack direction="row" spacing={1.5} alignItems="center" justifyContent="center" data-testid="contracts-empty">
            <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>{t('contracts.empty')}</Typography>
            {canCreate && (
              <Button variant="contained" size="small" onClick={handleNew}>
                {t('contracts.workspace.newContract')}
              </Button>
            )}
          </Stack>
        )}
        onQueryStateChange={(state) => {
          const filters = state.filterModel || {};
          const statusScope = state.statusScope ?? 'enabled';
          lastQueryRef.current = { sort: state.sort, q: state.q || '', filters, statusScope };
          const next: ListQuery = { q: state.q || '', filters: Object.keys(filters).length > 0 ? JSON.stringify(filters) : '', statusScope };
          setListQuery((prev) => (prev && prev.q === next.q && prev.filters === next.filters && prev.statusScope === next.statusScope ? prev : next));
        }}
      />

      <CsvExportDialog listRequest={listRequest} entity="contracts" open={exportOpen} onClose={() => setExportOpen(false)} endpoint="/contracts" title={t("contracts.exportTitle")} flexibleFormat />
      <ContractSettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} onSaved={() => setRefreshKey(k => k + 1)} />
      <CsvImportDialog open={importOpen} onClose={() => setImportOpen(false)} endpoint="/contracts" title={t("contracts.importTitle")} onImported={() => setRefreshKey(k => k + 1)} flexibleFormat />
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
