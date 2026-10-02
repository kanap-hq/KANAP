import React, { forwardRef, useImperativeHandle } from 'react';
import { Alert, Box, FormControlLabel, IconButton, MenuItem, Stack, Switch, Tab, Tabs, TextField, Tooltip, Typography } from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import BackspaceOutlinedIcon from '@mui/icons-material/BackspaceOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import CalculateOutlinedIcon from '@mui/icons-material/CalculateOutlined';
import CloseIcon from '@mui/icons-material/Close';
import { alpha, type Theme } from '@mui/material/styles';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import { useAuth } from '../../auth/AuthContext';
import EditConflictBanner from '../workspace/EditConflictBanner';
import { StatusDot } from '../design/StatusDot';
import type { ConflictChoice, EditConflict } from '../../hooks/editConflicts';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { useLocale } from '../../i18n/useLocale';
import { formatAmount } from '../../i18n/formatters';
import { useFreezeState } from '../../hooks/useFreezeState';
import { useBudgetColumns } from '../../hooks/useBudgetColumns';
import useAutosave from '../../hooks/useAutosave';
import YearTabs from '../navigation/YearTabs';
import FormattedNumberField from '../inputs/FormattedNumberField';
import { drawerMenuItemSx, drawerSelectSx, selectKeepsFocus, tableCellFieldSx } from '../../theme/formSx';
import { useKanapDialogs } from '../design';
import DateEUField from '../fields/DateEUField';
import BudgetTrendChart from './BudgetTrendChart';
import LinesPanel, { LinesSaveResult, PanelField, PanelPeriod } from './LinesPanel';
import { forgetAllocationsYear } from './allocationsCache';
import { FinanceModuleConfig } from './config';
import { patchYearlyTotalsCache } from './yearlyTotals';
import { AMOUNT_COLUMNS } from './amountColumns';
import type { FreezeColumn } from '../../services/freeze';
import { budgetConflictsOf, centsByColumn, monthsBase, type BudgetConflict } from './budgetConflicts';
import { initialBudgetView, writeBudgetView, type BudgetView } from './budgetViewPreference';
import {
  AmountMeasure,
  LinePayload,
  LinesRequest,
  Period,
  RoundInput,
  activeMonths,
  centsToDecimal,
  chipLines,
  chipText,
  columnPeriod,
  joinList,
  linePayloadOf,
  periodForEdit,
  periodProblem,
  linesText,
  periodText,
  suggestedPeriod,
  toCents,
  zeroedMonthsText,
} from './roundPeriod';

export type BudgetTabHandle = {
  flush: () => Promise<boolean>;
  isDirty: () => boolean;
};

type Props = {
  id: string; // resolved finance item UUID
  year: number;
  currency?: string;
  availableYears?: number[];
  onYearChange: (y: number) => void;
  config: FinanceModuleConfig;
  /** Item dates as the item page shows them (`YYYY-MM-DD`), used to suggest a column's period. */
  effectiveStart?: string | null;
  endOfValidity?: string | null;
  /** The paying company's country: its standard calendar is the default of a new line. */
  payingCompanyCountry?: string | null;
};

type Version = { id: string; input_grain: 'annual' | 'quarterly' | 'monthly'; budget_year?: number };

type AmountCol = AmountMeasure;

type AmountRow = Record<AmountCol, number> & { period: string };

type YearAmounts = {
  items: Array<Partial<Record<AmountCol, number | string>> & { period: string }>;
  totals: Partial<Record<AmountCol, number | string>>;
  year: number;
  round_inputs?: RoundInput[];
};

type BulkUpsertResponse = {
  updated?: number;
  round_inputs?: RoundInput[];
  warnings?: string[];
  /** The year's months as stored after the write. */
  items?: YearAmounts['items'];
};

/** A column waiting for the user's choice: refused by a grid save, or by a panel write (spread or lines). */
type WaitingColumn = BudgetConflict & { source: 'grid' | 'panel' };

/** A panel write refused with a 409, kept until the user chose for each of its columns. */
type ParkedPanel = {
  body: Record<string, unknown>;
  /** The column the panel writes (its yearly total or its lines); « Reload » on it drops the write. */
  main: AmountCol;
  /** Every column the write touches: they stay read-only until it is sent or dropped. */
  columns: Set<AmountCol>;
};

/** How a panel write ended: saved, refused for a choice the user must make, or not sent (a column waits for one). */
type PanelOutcome = { status: 'saved'; data: BulkUpsertResponse | undefined } | { status: 'conflict' } | { status: 'waiting' };

/** One year of a line as stored: its version and the amounts of the year (null without a version). */
type BudgetYear = { version: Version | null; amounts: YearAmounts | null };

/**
 * The tab's server state lives in the React Query cache under this key: a line's year comes back
 * at once when the tab is shown again, then refreshes in the background. Any write marks it stale,
 * so a cached year is never shown after a save it does not hold.
 */
export const budgetYearKey = (itemsApi: string, id: string, year: number) => ['finance-budget-year', itemsApi, id, year] as const;

async function fetchBudgetYear(config: FinanceModuleConfig, id: string, year: number, signal?: AbortSignal): Promise<BudgetYear> {
  const res = await api.get<Version[]>(`${config.itemsApi}/${id}/versions`, { signal });
  const version = (res.data || []).find((vv) => Number(vv.budget_year) === year) ?? null;
  if (!version) return { version: null, amounts: null };
  const amt = await api.get<YearAmounts>(`${config.versionsApi}/${version.id}/amounts`, { params: { year }, signal });
  return { version, amounts: amt.data ?? null };
}

/**
 * Every column, fixed order. State and saves carry all five; the screen shows the shown ones
 * (`useBudgetColumns`), and a column that is not shown is never edited, so never sent.
 */
const ALL_COLS: AmountCol[] = AMOUNT_COLUMNS.map((c) => c.measure);
const FREEZE_KEY = Object.fromEntries(AMOUNT_COLUMNS.map((c) => [c.measure, c.freezeKey])) as Record<AmountCol, FreezeColumn>;
const perColumn = <V,>(value: (col: AmountCol) => V) => Object.fromEntries(ALL_COLS.map((col) => [col, value(col)])) as Record<AmountCol, V>;
const NO_STORED_AMOUNTS = perColumn(() => false);
const EMPTY_FLAT = perColumn((): number | '' => '');
const zeroMonths = () => perColumn(() => Array.from({ length: 12 }, () => 0));
const monthIndexOf = (period: string) => Number(period.slice(5, 7)) - 1;
const sumCents = (months: readonly number[]) => months.reduce((sum, cents) => sum + cents, 0);
const conflictTint = (theme: Theme) => alpha(theme.palette.warning.main, theme.palette.mode === 'dark' ? 0.12 : 0.08);

/** A panel write stopped before sending: the grid edits before it could not be saved. */
class UnsavedEditsError extends Error {}

/** A column's yearly total in cents, summed month by month. */
function monthsCents(rows: AmountRow[], col: AmountCol): number {
  return rows.reduce((sum, row) => sum + toCents(row[col]), 0);
}

/** The spread panel's amount field: the total, or empty when it is zero. */
function amountOrEmpty(cents: number): number | '' {
  return cents === 0 ? '' : cents / 100;
}

/** The distribution the spread panel starts with: the column's own, so a period change keeps its shape. */
function profileOf(measure: AmountCol, inputs: RoundInput[]): 'flat' | '4-4-5' {
  return inputs.find((r) => r.measure === measure)?.spread_profile_name === '4-4-5' ? '4-4-5' : 'flat';
}
function monthPeriod(year: number, m: number) { return `${year}-${String(m).padStart(2, '0')}-01`; }
function emptyMonths(year: number): AmountRow[] {
  return Array.from({ length: 12 }, (_, i) => ({ period: monthPeriod(year, i + 1), ...perColumn(() => 0) }));
}
const QUARTERS = [
  { label: 'Q1', months: [0, 1, 2] },
  { label: 'Q2', months: [3, 4, 5] },
  { label: 'Q3', months: [6, 7, 8] },
  { label: 'Q4', months: [9, 10, 11] },
];

export default forwardRef<BudgetTabHandle, Props>(function BudgetTab({ id, year, currency, availableYears, onYearChange, config, effectiveStart, endOfValidity, payingCompanyCountry }, ref) {
  const { t } = useTranslation(['ops', 'common']);
  const locale = useLocale();
  const queryClient = useQueryClient();
  const budgetColumns = useBudgetColumns();
  const { shown, group, defaultColumn } = budgetColumns;
  const dialogs = useKanapDialogs();
  const { profile } = useAuth();
  const userId = profile?.id ?? null;
  const userIdRef = React.useRef(userId); userIdRef.current = userId;

  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [version, setVersion] = React.useState<Version | null>(null);
  const [mode, setMode] = React.useState<'flat' | 'monthly'>('flat');
  const [flat, setFlat] = React.useState<Record<AmountCol, number | ''>>(EMPTY_FLAT);
  const [months, setMonths] = React.useState<AmountRow[]>(() => emptyMonths(year));
  // Overlay the chart only once this `year`'s amounts are in local state: otherwise
  // a year-tab switch would paint the previous year's figures onto the new year.
  const [loadedYear, setLoadedYear] = React.useState<number | null>(null);
  // How each column was produced and over which period, as stored.
  const [roundInputs, setRoundInputs] = React.useState<RoundInput[]>([]);
  // Columns that held a non-zero month when loaded: without a stored period they read as the whole year.
  const [storedAmounts, setStoredAmounts] = React.useState<Record<AmountCol, boolean>>(NO_STORED_AMOUNTS);

  // Spread panel state. `spreadDates` is null until the user edits a date: the
  // column's own period is shown until then. The panel starts on the default
  // column, and falls back to it when the picked column is no longer shown.
  const [pickedMeasure, setSpreadMeasure] = React.useState<AmountCol | null>(null);
  const spreadMeasure = shown.some((c) => c.measure === pickedMeasure) ? pickedMeasure! : defaultColumn.measure;
  const [spreadAmount, setSpreadAmount] = React.useState<number | ''>('');
  const spreadAmountRef = React.useRef(spreadAmount); spreadAmountRef.current = spreadAmount;
  const [spreadProfile, setSpreadProfile] = React.useState<'flat' | '4-4-5'>('flat');
  const spreadMeasureRef = React.useRef(spreadMeasure); spreadMeasureRef.current = spreadMeasure;
  const [spreadDates, setSpreadDates] = React.useState<Period | null>(null);
  // The amount as last loaded or written: leaving the field without changing it writes nothing.
  const committedAmountRef = React.useRef<number | ''>('');
  // On by default: the panel's period and distribution go to every column of the shared group.
  const [spreadAllColumns, setSpreadAllColumns] = React.useState(true);
  // Off by default: lines written to the group's columns replace their amounts.
  const [linesAllColumns, setLinesAllColumns] = React.useState(false);
  // The yearly view shows the panel only when asked for, on one column.
  const [panelOpen, setPanelOpen] = React.useState(false);
  // The panel box holds one panel at a time: spread an amount, or quantity and price.
  const [panelKind, setPanelKind] = React.useState<'spread' | 'lines'>('spread');
  // Panel writes (spread and lines) run one after the other, so a response never overwrites a newer one.
  const chainRef = React.useRef<Promise<unknown>>(Promise.resolve());
  const [writesPending, setWritesPending] = React.useState(0);
  const writesPendingRef = React.useRef(0);

  const suggestion = React.useMemo(() => suggestedPeriod(year, effectiveStart, endOfValidity), [year, effectiveStart, endOfValidity]);
  // A column's own period: shown under the column and used to spread a typed yearly total.
  const periodFor = React.useCallback((measure: AmountCol, inputs: RoundInput[], stored: Record<AmountCol, boolean>): Period | null => {
    return columnPeriod(year, inputs.find((r) => r.measure === measure), stored[measure], suggestion);
  }, [year, suggestion]);

  const { data: freezeData } = useFreezeState(year);
  const frozen = React.useMemo(() => {
    const s = freezeData?.summary?.scopes?.[config.freezeScope];
    return Object.fromEntries(AMOUNT_COLUMNS.map((c) => [c.freezeKey, s?.[c.freezeKey]?.frozen ?? false])) as Record<FreezeColumn, boolean>;
  }, [freezeData, config.freezeScope]);
  const anyFrozen = shown.some((c) => frozen[c.freezeKey]);

  // Edit conflicts (plan planning/perf-scale, lot 3D): every save says what the user's edit started
  // from, read here when it is sent. `serverMonthsRef` is the year as last known on the server, in
  // cents per column: loaded, or written by this screen. A reload never moves a cell the user is
  // typing, has not saved yet or waits a choice on, so a save's base stays what the screen showed
  // when the edit began, or what this screen's previous save of the cell wrote.
  const serverMonthsRef = React.useRef<Record<AmountCol, number[]>>(zeroMonths());
  // The columns' costed lines as last known: the base of a column a lines write also replaces.
  const serverLinesRef = React.useRef<Record<AmountCol, LinePayload[]>>(perColumn(() => []));
  // Bumped when a write is sent: a reload that started before it does not show what it wrote, so it is dropped
  // (the write reloads after itself).
  const writeGenRef = React.useRef(0);
  // Columns refused by a save (409 edit_conflict) and waiting for the user's choice: read-only meanwhile.
  const [waitingColumns, setWaitingColumns] = React.useState<WaitingColumn[]>([]);
  const waitingRef = React.useRef<WaitingColumn[]>([]);
  const setWaiting = (next: WaitingColumn[]) => { waitingRef.current = next; setWaitingColumns(next); };
  // A refused panel write, kept for the choice; its columns stay read-only until it is sent or dropped.
  const parkedPanelRef = React.useRef<ParkedPanel | null>(null);
  const [resolving, setResolving] = React.useState(false);
  // Bumped by « Reload the column » on a panel write: the lines panel starts again from the stored lines.
  const [linesReload, setLinesReload] = React.useState(0);
  const isWaiting = React.useCallback((col: AmountCol) => (
    waitingRef.current.some((c) => c.measure === col) || !!parkedPanelRef.current?.columns.has(col)
  ), []);
  // The view chosen in this tab: it outlives a year change and a reload, whatever the version says.
  const chosenViewRef = React.useRef<BudgetView | null>(null);

  const autosave = useAutosave({
    onError: (e) => setError(getApiErrorMessage(e, t, t(`${config.i18nPrefix}.budget.failedToSave`))),
    // A choice waiting keeps the tab busy: leaving asks first, a flush answers false.
    held: () => waitingRef.current.length > 0 || !!parkedPanelRef.current,
  });

  // Latest-value refs so the debounced persist never reads stale state.
  const modeRef = React.useRef(mode); modeRef.current = mode;
  const flatRef = React.useRef(flat); flatRef.current = flat;
  const monthsRef = React.useRef(months); monthsRef.current = months;
  const versionRef = React.useRef(version); versionRef.current = version;
  const frozenRef = React.useRef(frozen); frozenRef.current = frozen;
  const yearRef = React.useRef(year); yearRef.current = year;
  const roundInputsRef = React.useRef(roundInputs); roundInputsRef.current = roundInputs;
  const storedAmountsRef = React.useRef(storedAmounts); storedAmountsRef.current = storedAmounts;
  const periodForRef = React.useRef(periodFor); periodForRef.current = periodFor;

  // Every write answers with the version's stored periods: keep them so the
  // column labels follow without reloading the grid.
  const keepRoundInputs = (data: BulkUpsertResponse | undefined) => {
    if (!Array.isArray(data?.round_inputs)) return;
    roundInputsRef.current = data!.round_inputs;
    setRoundInputs(data!.round_inputs);
  };

  // Edits not saved yet: yearly totals in flat mode, (period, measure) cells in
  // monthly mode. A save sends only these, so it never overwrites a measure or
  // a month the user did not touch.
  const dirtyTotalsRef = React.useRef(new Set<AmountCol>());
  const dirtyCellsRef = React.useRef(new Map<string, Set<AmountCol>>());
  const resetDirty = () => {
    dirtyTotalsRef.current = new Set();
    dirtyCellsRef.current = new Map();
  };
  const markCellDirty = (period: string, col: AmountCol) => {
    const cols = dirtyCellsRef.current.get(period) ?? new Set<AmountCol>();
    cols.add(col);
    dirtyCellsRef.current.set(period, cols);
  };
  // Every grid edit is numbered: the reload after a panel write keeps the cells and totals typed
  // after that write saved the grid (they are newer than what the server returns).
  const editSeqRef = React.useRef(0);
  const editedAtRef = React.useRef(new Map<string, number>());
  const noteEdit = (key: string) => {
    editSeqRef.current += 1;
    editedAtRef.current.set(key, editSeqRef.current);
  };

  const ensureVersion = React.useCallback(async (): Promise<Version> => {
    if (versionRef.current) return versionRef.current;
    const res = await api.get<Version[]>(`${config.itemsApi}/${id}/versions`);
    const existing = (res.data || []).find((v) => Number(v.budget_year) === year);
    if (existing) { versionRef.current = existing; setVersion(existing); return existing; }
    const created = await api.post<Version>(`${config.itemsApi}/${id}/versions`, {
      version_name: `Y${year}`, budget_year: year, as_of_date: `${year}-01-01`,
      input_grain: modeRef.current === 'flat' ? 'annual' : 'monthly', notes: null,
    });
    // Update the ref imperatively too: callers (e.g. onModeChange) read versionRef
    // right after a flush that may have just created the version, before re-render.
    versionRef.current = created.data;
    setVersion(created.data);
    return created.data;
  }, [id, year]);

  // The spread panel's amount, as loaded or written: the field shows it, and leaving the field with it writes nothing.
  const showSpreadAmount = (value: number | '') => {
    committedAmountRef.current = value;
    spreadAmountRef.current = value;
    setSpreadAmount(value);
  };
  // After the grid saved the panel's column, the spread field shows the column's new total, unless
  // an amount is being typed there, or a panel write is about to replace that total (a spread
  // flushes the grid first).
  const followSavedTotal = () => {
    if (spreadAmountRef.current !== committedAmountRef.current || writesPendingRef.current > 0) return;
    const measure = spreadMeasureRef.current;
    const cents = modeRef.current === 'flat' ? toCents(flatRef.current[measure]) : monthsCents(monthsRef.current, measure);
    showSpreadAmount(amountOrEmpty(cents));
  };

  // `quietSince`: a reload after a write, which saved the grid up to that edit number. Nothing turns
  // read-only meanwhile, the spread panel keeps what it shows (it is what was just written, or what
  // the user is typing), and a cell or total typed since, not saved yet, or in a column waiting for
  // the user's choice keeps its value; the other cells show the server's, others' changes included.
  const applyYear = React.useCallback((snapshot: BudgetYear, { quietSince }: { quietSince?: number } = {}) => {
    const quiet = quietSince !== undefined;
    const typedSince = (key: string) => quiet && (editedAtRef.current.get(key) ?? 0) > quietSince;
    const keepCell = (period: string, col: AmountCol) => quiet && (
      typedSince(`${period}:${col}`) || !!dirtyCellsRef.current.get(period)?.has(col) || isWaiting(col)
    );
    const keepTotal = (col: AmountCol) => quiet && (typedSince(`total:${col}`) || dirtyTotalsRef.current.has(col) || isWaiting(col));
    if (!quiet) {
      setSpreadDates(null);
      // A full load starts again from the server: nothing typed, nothing waiting.
      setWaiting([]);
      parkedPanelRef.current = null;
    }
    const v = snapshot.version;
    if (!v) {
      setVersion(null);
      setMode(chosenViewRef.current ?? initialBudgetView(userIdRef.current, null));
      setFlat(EMPTY_FLAT);
      setMonths(emptyMonths(year));
      setRoundInputs([]);
      setStoredAmounts(NO_STORED_AMOUNTS);
      serverMonthsRef.current = zeroMonths();
      serverLinesRef.current = perColumn(() => []);
      if (!quiet) showSpreadAmount('');
      resetDirty();
      setLoadedYear(year);
      return;
    }
    setVersion(v);
    // The view is the user's (`budgetViewPreference.ts`); a reload never changes it.
    if (!quiet) setMode(chosenViewRef.current ?? initialBudgetView(userIdRef.current, v.input_grain));
    const amt = snapshot.amounts;
    const totals = amt?.totals;
    setFlat((prev) => perColumn((col) => (keepTotal(col) ? prev[col] : Number(totals?.[col] || 0))));
    const byPeriod = new Map((amt?.items || []).map((r) => [r.period, r]));
    const loadedMonths = Array.from({ length: 12 }, (_, i) => {
      const p = monthPeriod(year, i + 1);
      const found = byPeriod.get(p);
      return { period: p, ...perColumn((col) => Number(found?.[col] || 0)) };
    });
    setMonths((prev) => loadedMonths.map((row, i) => (
      prev[i]?.period === row.period
        ? { period: row.period, ...perColumn((col) => (keepCell(row.period, col) ? prev[i][col] : row[col])) }
        : row
    )));
    // What the screen now takes from the server is the base of the next edit; a kept cell keeps its own.
    const loadedCents = centsByColumn(year, amt?.items || []);
    ALL_COLS.forEach((col) => {
      if (keepTotal(col)) return;
      loadedMonths.forEach((row, i) => {
        if (!keepCell(row.period, col)) serverMonthsRef.current[col][i] = loadedCents[col][i];
      });
    });
    const hasAmounts = (m: AmountCol) => loadedMonths.some((row) => row[m] !== 0);
    setStoredAmounts(perColumn(hasAmounts));
    const loadedInputs = Array.isArray(amt?.round_inputs) ? amt!.round_inputs! : [];
    roundInputsRef.current = loadedInputs;
    setRoundInputs(loadedInputs);
    ALL_COLS.forEach((col) => {
      if (!(quiet && isWaiting(col))) serverLinesRef.current[col] = (loadedInputs.find((r) => r.measure === col)?.lines ?? []).map(linePayloadOf);
    });
    if (!quiet) {
      setSpreadProfile(profileOf(spreadMeasureRef.current, loadedInputs));
      showSpreadAmount(amountOrEmpty(monthsCents(loadedMonths, spreadMeasureRef.current)));
    }
    // After a panel write, the unsaved edits are the ones typed since: the pending autosave sends them.
    if (!quiet) resetDirty();
    setLoadedYear(year);
    // showSpreadAmount only sets state and a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  // `background`: a refresh of the year shown from the cache; nothing turns read-only, and a cell
  // typed since it was shown is kept as after a panel write.
  const load = React.useCallback(async ({ quietSince, background = false }: { quietSince?: number; background?: boolean } = {}) => {
    const quiet = quietSince !== undefined || background;
    if (!quiet) setLoading(true);
    setError(null);
    const generation = writeGenRef.current;
    try {
      const key = budgetYearKey(config.itemsApi, id, year);
      // A quiet reload follows a write: read the server now, never join a fetch that started before the write.
      const snapshot = quiet
        ? await fetchBudgetYear(config, id, year)
        : await queryClient.fetchQuery({ queryKey: key, queryFn: ({ signal }) => fetchBudgetYear(config, id, year, signal), staleTime: 0 });
      if (quiet) {
        // A write sent meanwhile is not in this answer: the write's own reload shows it.
        if (writeGenRef.current !== generation) return;
        queryClient.setQueryData(key, snapshot);
      }
      if (background && editSeqRef.current === quietSince) applyYear(snapshot);
      else applyYear(snapshot, { quietSince });
    } catch (e) {
      setError(getApiErrorMessage(e, t, t(`${config.i18nPrefix}.budget.failedToLoad`)));
    } finally {
      if (!quiet) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, year, t, queryClient, applyYear]);
  const loadRef = React.useRef(load); loadRef.current = load;

  // A year cached by an earlier visit shows before the first paint, then refreshes; otherwise a first load.
  React.useLayoutEffect(() => {
    const key = budgetYearKey(config.itemsApi, id, year);
    const cached = queryClient.getQueryData<BudgetYear>(key);
    if (cached && !queryClient.getQueryState(key)?.isInvalidated) {
      applyYear(cached);
      void load({ quietSince: editSeqRef.current, background: true });
    } else {
      void load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);
  // Every write makes the cached year stale: a later visit loads it again instead of showing it. The
  // Allocations tab shows the year's totals: its cached year is forgotten too (no old amounts there).
  const markYearStale = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: budgetYearKey(config.itemsApi, id, year), refetchType: 'none' });
    forgetAllocationsYear(queryClient, config.itemsApi, id, year);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient, id, year]);
  const markYearStaleRef = React.useRef(markYearStale); markYearStaleRef.current = markYearStale;

  // A year switch closes the panel: its total belongs to the previous year.
  React.useEffect(() => {
    setPanelOpen(false);
    showSpreadAmount('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  // What a write stored becomes the base of the next edit: a whole column for a yearly total or a panel
  // write, only the cells it wrote for a monthly entry (the other months may hold changes the screen
  // does not show yet).
  const keepWritten = (data: BulkUpsertResponse | undefined, columns: readonly AmountCol[], cells?: Map<string, Set<AmountCol>>) => {
    if (!Array.isArray(data?.items)) return;
    const stored = centsByColumn(year, data!.items!);
    columns.forEach((col) => { serverMonthsRef.current[col] = [...stored[col]]; });
    cells?.forEach((cols, period) => cols.forEach((col) => {
      const index = monthIndexOf(period);
      serverMonthsRef.current[col][index] = stored[col][index];
    }));
    if (Array.isArray(data?.round_inputs)) {
      columns.forEach((col) => {
        serverLinesRef.current[col] = (data!.round_inputs!.find((r) => r.measure === col)?.lines ?? []).map(linePayloadOf);
      });
    }
  };
  const autosaveRef = React.useRef(autosave); autosaveRef.current = autosave;

  // Persist the edited totals (flat) or cells (monthly), creating the version on first edit. Each says
  // what it started from (`base`); a column someone else changed meanwhile is refused (409) and waits
  // for the user's choice. Frozen measures are never sent; a column waiting for a choice is not either.
  const persist = React.useCallback(async () => {
    const fr = frozenRef.current;
    const flatMode = modeRef.current === 'flat';
    // Take out what goes now: edits typed while this save is in flight stay dirty for the next one;
    // a failed save puts its own back.
    const sentTotals: AmountCol[] = [];
    const sentCells = new Map<string, Set<AmountCol>>();
    if (flatMode) {
      for (const col of [...dirtyTotalsRef.current]) {
        if (isWaiting(col)) continue;
        dirtyTotalsRef.current.delete(col);
        if (!fr[FREEZE_KEY[col]]) sentTotals.push(col);
      }
    } else {
      for (const [period, cols] of [...dirtyCellsRef.current]) {
        for (const col of [...cols]) {
          if (isWaiting(col)) continue;
          cols.delete(col);
          if (!fr[FREEZE_KEY[col]]) sentCells.set(period, (sentCells.get(period) ?? new Set<AmountCol>()).add(col));
        }
        if (cols.size === 0) dirtyCellsRef.current.delete(period);
      }
    }
    // The base of each edit: the year as last known on the server (see serverMonthsRef).
    const known = serverMonthsRef.current;
    const bodies: Array<{ body: Record<string, unknown>; totals: AmountCol[]; cells: Map<string, Set<AmountCol>> }> = [];
    if (flatMode) {
      // A yearly total is spread flat over its column's period: one request per period (in practice one).
      const f = flatRef.current;
      const groups = new Map<string, { period: Period; totals: Partial<Record<AmountCol, number>> }>();
      sentTotals.forEach((col) => {
        const period = periodForRef.current(col, roundInputsRef.current, storedAmountsRef.current);
        if (!period) return;
        const key = `${period.start}|${period.end}`;
        const group = groups.get(key) ?? { period, totals: {} };
        group.totals[col] = Number(f[col] || 0);
        groups.set(key, group);
      });
      groups.forEach(({ period, totals }) => {
        const cols = ALL_COLS.filter((col) => totals[col] !== undefined);
        bodies.push({
          body: {
            kind: 'annual', year, totals, period_start: period.start, period_end: period.end,
            base: { columns: Object.fromEntries(cols.map((col) => [col, { months: monthsBase(known[col]) }])) },
          },
          totals: cols,
          cells: new Map(),
        });
      });
    } else {
      const rows: Array<Record<string, string | number>> = [];
      const baseRows: Array<Record<string, string>> = [];
      monthsRef.current.forEach((m, index) => {
        const cols = sentCells.get(m.period);
        if (!cols) return;
        const row: Record<string, string | number> = { period: m.period };
        const baseRow: Record<string, string> = { period: m.period };
        ALL_COLS.forEach((c) => {
          if (!cols.has(c)) return;
          row[c] = Number(m[c] || 0);
          baseRow[c] = centsToDecimal(known[c][index]);
        });
        rows.push(row);
        baseRows.push(baseRow);
      });
      if (rows.length > 0) bodies.push({ body: { kind: 'monthly', year, months: rows, base: { months: baseRows } }, totals: [], cells: sentCells });
    }
    if (bodies.length === 0) return;

    // The grid is saved up to here: the reload after the save keeps what is typed from now on.
    const savedUpTo = editSeqRef.current;
    let sent = 0;
    try {
      markYearStaleRef.current();
      const v = await ensureVersion();
      for (; sent < bodies.length; sent += 1) {
        const { body, totals, cells } = bodies[sent];
        writeGenRef.current += 1;
        const res = await api.post<BulkUpsertResponse>(`${config.versionsApi}/${v.id}/amounts/bulk-upsert`, body);
        keepRoundInputs(res?.data);
        keepWritten(res?.data, totals, cells);
      }
      // Once written too: an Allocations tab opened while the save ran read the old totals.
      forgetAllocationsYear(queryClient, config.itemsApi, id, year);
      const savedColumns = new Set([...sentTotals, ...[...sentCells.values()].flatMap((cols) => [...cols])]);
      if (savedColumns.has(spreadMeasureRef.current)) followSavedTotal();
      // Show what others changed meanwhile; what is typed since stays as typed.
      void loadRef.current({ quietSince: savedUpTo });
    } catch (e) {
      const conflicts = budgetConflictsOf(e);
      const refused = new Set(conflicts?.map((c) => c.measure) ?? []);
      let others = false;
      bodies.slice(sent).forEach(({ totals, cells }) => {
        totals.forEach((col) => { dirtyTotalsRef.current.add(col); if (!refused.has(col)) others = true; });
        cells.forEach((cols, period) => cols.forEach((col) => { markCellDirty(period, col); if (!refused.has(col)) others = true; }));
      });
      if (conflicts) {
        // The refused columns wait for the user's choice, read-only, their edits kept.
        setWaiting([...waitingRef.current.filter((c) => !refused.has(c.measure)), ...conflicts.map((c) => ({ ...c, source: 'grid' as const }))]);
        // The whole request was refused (D5): the edits of other columns go again on their own.
        if (others) autosaveRef.current.schedule(persistRef.current);
      } else {
        // The save may have been refused because a column was frozen meanwhile: refresh the freeze
        // state so that column turns read-only and the next save leaves it out.
        void queryClient.invalidateQueries({ queryKey: ['freeze-state', year] });
      }
      throw e;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ensureVersion, id, year, queryClient]);
  const persistRef = React.useRef(persist); persistRef.current = persist;

  const scheduleSave = React.useCallback(() => { autosave.schedule(persist); }, [autosave, persist]);

  const hasUnsavedEdits = () => dirtyTotalsRef.current.size > 0 || dirtyCellsRef.current.size > 0;
  // Edits that can go now: not in a column waiting for the user's choice.
  const hasSendableEdits = () => [...dirtyTotalsRef.current].some((col) => !isWaiting(col))
    || [...dirtyCellsRef.current.values()].some((cols) => [...cols].some((col) => !isWaiting(col)));
  // Save every unsaved edit now. A save the autosave dropped (refused) left its
  // edits dirty here, so it is scheduled again; a save the autosave still
  // keeps (isSaving) goes again within the flush. False if the save fails, or
  // while a choice waits (unless `ignoreHeld`).
  const flushEdits = React.useCallback(async (options?: { ignoreHeld?: boolean }) => {
    if (hasSendableEdits() && !autosave.isSaving()) autosave.schedule(persist);
    return autosave.flush(options);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autosave, persist]);

  // Queues a panel write behind the others. Resolves with its result once written, rejects when
  // refused; the "Saving…" hint shows until the queue is empty. Nothing is disabled meanwhile.
  const enqueueWrite = React.useCallback(<T,>(run: () => Promise<T>): Promise<T> => {
    writesPendingRef.current += 1;
    setWritesPending(writesPendingRef.current);
    const task = async () => {
      try {
        return await run();
      } finally {
        writesPendingRef.current -= 1;
        setWritesPending(writesPendingRef.current);
      }
    };
    const result = chainRef.current.then(task, task);
    chainRef.current = result.catch(() => undefined);
    return result;
  }, []);

  // Grid edits, then the panel writes already queued. Never called from inside a queued write.
  const flushAll = React.useCallback(async () => {
    const saved = await flushEdits();
    await chainRef.current;
    return saved;
  }, [flushEdits]);

  // Flush pending edits before switching year so nothing is lost on reload.
  const handleYearChange = React.useCallback(async (y: number) => {
    if (!(await flushAll())) return;
    onYearChange(y);
  }, [flushAll, onYearChange]);

  useImperativeHandle(ref, () => ({
    flush: flushAll,
    isDirty: () => autosave.isBusy() || hasUnsavedEdits() || writesPendingRef.current > 0,
  }), [autosave, flushAll]);

  const onFlatChange = (key: AmountCol, value: number | '') => {
    setFlat((prev) => ({ ...prev, [key]: value }));
    dirtyTotalsRef.current.add(key);
    noteEdit(`total:${key}`);
    scheduleSave();
  };
  const editCell = (period: string, key: AmountCol) => {
    markCellDirty(period, key);
    noteEdit(`${period}:${key}`);
  };
  const onMonthChange = (idx: number, key: AmountCol, value: number | '') => {
    setMonths((prev) => { const next = [...prev]; next[idx] = { ...next[idx], [key]: Number(value || 0) }; return next; });
    editCell(monthPeriod(year, idx + 1), key);
    scheduleSave();
  };
  // Clear every month for a column: convenient when entering a cash-out plan manually
  // (e.g. the whole amount in a single month). Asked first, unless the column is already empty.
  const clearColumn = async (key: AmountCol) => {
    // A column waiting for the user's choice is read-only until it is made.
    if (isWaiting(key)) return;
    if (monthsRef.current.some((m) => toCents(m[key]) !== 0)) {
      const confirmed = await dialogs.confirm({
        message: t(`${config.i18nPrefix}.budget.clearColumnConfirm`, { column: budgetColumns.label(key), year }),
        confirmLabel: t(`${config.i18nPrefix}.budget.clearColumn`),
        intent: 'danger',
      });
      // While the question was open, the column may have been frozen or the year changed: then nothing is cleared.
      if (!confirmed || frozenRef.current[FREEZE_KEY[key]] || yearRef.current !== year || isWaiting(key)) return;
    }
    setMonths((prev) => prev.map((m) => ({ ...m, [key]: 0 })));
    for (let m = 1; m <= 12; m++) editCell(monthPeriod(year, m), key);
    scheduleSave();
  };
  const onModeChange = React.useCallback(async (next: BudgetView) => {
    if (next === modeRef.current) return;
    // Persist any pending edits in the current view first, then switch and resync from the backend so
    // the new view reflects stored data (no stale overwrite). If they cannot be saved, stay: the
    // reload would discard them. The view is the user's choice, kept in the browser
    // (`budgetViewPreference.ts`); the version's shared `input_grain` is no longer written.
    if (!(await flushAll())) return;
    chosenViewRef.current = next;
    writeBudgetView(userIdRef.current, next);
    setMode(next);
    setPanelOpen(false);
    if (!versionRef.current) return;
    await load();
  }, [flushAll, load]);

  // The period the panel shows: what the user typed, else the column's own
  // period within the item's dates.
  const spreadPeriod: Period = spreadDates
    ?? periodForEdit(year, roundInputs.find((r) => r.measure === spreadMeasure), storedAmounts[spreadMeasure], suggestion)
    ?? { start: '', end: '' };
  const spreadProblem = periodProblem(year, spreadPeriod.start, spreadPeriod.end);
  const spreadActive = spreadProblem ? [] : activeMonths(year, spreadPeriod.start, spreadPeriod.end);
  const spreadBeyondItem = !spreadProblem && (
    (!!effectiveStart && spreadPeriod.start < effectiveStart) || (!!endOfValidity && spreadPeriod.end > endOfValidity)
  );
  const spreadFrozen = frozen[FREEZE_KEY[spreadMeasure]];

  // A column's current total in cents: the typed yearly total in the yearly
  // view (it may not be saved yet), else the sum of its months.
  const currentCents = (col: AmountCol): number => (
    mode === 'flat' ? toCents(flat[col]) : monthsCents(months, col)
  );

  // The spread panel starts again from the column: its total, its distribution, its period.
  const resetSpreadFields = (measure: AmountCol) => {
    setSpreadDates(null);
    setSpreadProfile(profileOf(measure, roundInputsRef.current));
    showSpreadAmount(amountOrEmpty(currentCents(measure)));
  };
  const onSpreadMeasureChange = (measure: AmountCol) => {
    setSpreadMeasure(measure);
    syncedMeasureRef.current = measure;
    resetSpreadFields(measure);
  };
  // The panel's column can also change without a pick: the setting arrives with another
  // default column, or the picked column is hidden. Its total and distribution follow.
  const syncedMeasureRef = React.useRef(spreadMeasure);
  React.useEffect(() => {
    if (syncedMeasureRef.current === spreadMeasure) return;
    syncedMeasureRef.current = spreadMeasure;
    resetSpreadFields(spreadMeasure);
    // resetSpreadFields reads the latest state of this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spreadMeasure]);

  // "Apply the distribution to all columns" (spread) and "Apply these lines to all columns" are
  // offered when the selected column belongs to the group (shown columns that follow it, from the
  // setting) and another group column is not frozen: those are written too. A column outside the
  // group is written alone.
  const groupOthers = group.some((c) => c.measure === spreadMeasure)
    ? group.filter((c) => c.measure !== spreadMeasure && !frozen[c.freezeKey] && !isWaiting(c.measure))
    : [];
  // The panel's column waits for the user's choice: nothing is written to it until it is made.
  const spreadWaiting = isWaiting(spreadMeasure);
  const offerApplyToAll = groupOthers.length > 0;
  const alsoSpread = offerApplyToAll && spreadAllColumns ? groupOthers.map((c) => c.measure) : [];
  // Yearly view: open the panel on one column with its current total.
  const openSpreadPanel = (measure: AmountCol) => {
    setSpreadMeasure(measure);
    syncedMeasureRef.current = measure;
    setSpreadDates(null);
    setSpreadProfile(profileOf(measure, roundInputs));
    showSpreadAmount(amountOrEmpty(toCents(flat[measure])));
    setPanelKind('spread');
    setPanelOpen(true);
  };
  // Yearly view: open the same box on "Quantity and price" for one column.
  const openLinesPanel = (measure: AmountCol) => {
    openSpreadPanel(measure);
    setPanelKind('lines');
  };
  const closeSpreadPanel = () => {
    setPanelOpen(false);
    setSpreadDates(null);
    showSpreadAmount('');
  };
  // Back on the spread tab, it shows the column as it is now (the lines may have changed it).
  const onPanelKindChange = (kind: 'spread' | 'lines') => {
    if (kind === 'spread') resetSpreadFields(spreadMeasure);
    setPanelKind(kind);
  };

  // The base of a panel write, read when it is sent: each compared column's months as last known on the
  // server and, for costed lines, its lines (the panel's column: the lines its drafts started from).
  const panelBase = (columns: readonly AmountCol[], lines?: { main: AmountCol; startedFrom: LinePayload[] }) => ({
    columns: Object.fromEntries(columns.map((col) => [col, {
      months: monthsBase(serverMonthsRef.current[col]),
      ...(lines ? { lines: col === lines.main ? lines.startedFrom : serverLinesRef.current[col] } : {}),
    }])),
  });

  // Sends a panel body; a 409 parks it for the user's choice. The caller holds the queue.
  const sendPanel = async (body: Record<string, unknown>, columns: AmountCol[], main: AmountCol): Promise<PanelOutcome> => {
    // The grid is saved up to here: what is typed from now on is kept by the reload.
    const savedUpTo = editSeqRef.current;
    try {
      markYearStaleRef.current();
      const v = await ensureVersion();
      writeGenRef.current += 1;
      const res = await api.post<BulkUpsertResponse>(`${config.versionsApi}/${v.id}/amounts/bulk-upsert`, body);
      keepRoundInputs(res?.data);
      keepWritten(res?.data, columns);
      forgetAllocationsYear(queryClient, config.itemsApi, id, year);
      await loadRef.current({ quietSince: savedUpTo });
      return { status: 'saved', data: res?.data };
    } catch (e) {
      const conflicts = budgetConflictsOf(e);
      if (conflicts) {
        // Kept whole (D5) until the user chose for each refused column; its columns stay read-only.
        parkedPanelRef.current = { body, main, columns: new Set(columns) };
        const refused = new Set(conflicts.map((c) => c.measure));
        setWaiting([...waitingRef.current.filter((c) => !refused.has(c.measure)), ...conflicts.map((c) => ({ ...c, source: 'panel' as const }))]);
        return { status: 'conflict' };
      }
      // The write may have been refused because a column was frozen meanwhile.
      void queryClient.invalidateQueries({ queryKey: ['freeze-state', year] });
      throw e;
    }
  };

  // One panel write, queued: pending grid edits first (the reload shows the stored amounts), then the
  // body with its base, then a quiet reload. A column waiting for the user's choice is not written.
  const writePanel = (body: Record<string, unknown> | LinesRequest, columns: AmountCol[], linesBase?: LinePayload[]) => enqueueWrite(async (): Promise<PanelOutcome> => {
    if (columns.some(isWaiting)) return { status: 'waiting' };
    // A choice waiting on another column does not stop this write.
    if (!(await flushEdits({ ignoreHeld: true }))) throw new UnsavedEditsError();
    const main = (body as { measure?: AmountCol }).measure ?? columns[0];
    // Compared: the columns the user's screen shows this write replacing. "Apply the distribution
    // to all columns" spreads the others from their stored totals: they carry no base.
    const compared = (body as { kind?: string }).kind === 'lines' ? columns : [main];
    const base = panelBase(compared, (body as { kind?: string }).kind === 'lines' ? { main, startedFrom: linesBase ?? [] } : undefined);
    return sendPanel({ ...body, base }, columns, main);
  });

  // Each commit of the spread panel writes the spread: the amount on leaving the field, the
  // distribution and the dates on change. A blank or zero amount, or a period that does not
  // work, writes nothing.
  const commitSpread = (next: { amount?: number | ''; profile?: 'flat' | '4-4-5'; dates?: Period; also?: AmountCol[] } = {}) => {
    const typed = next.amount !== undefined ? next.amount : spreadAmount;
    const dates = next.dates ?? spreadPeriod;
    const amount = Number(typed || 0);
    if (!amount || spreadFrozen || spreadWaiting || periodProblem(year, dates.start, dates.end)) return;
    // The total in cents, sent as a two-decimal string: no float sum reaches the server. The other
    // columns of "apply to all" are spread by the server from their stored totals (never the screen's).
    const also = next.also ?? alsoSpread;
    committedAmountRef.current = typed;
    setError(null);
    writePanel({
      kind: 'annual',
      year,
      totals: { [spreadMeasure]: centsToDecimal(toCents(amount)) },
      ...(also.length > 0 ? { also_measures: also } : {}),
      spread_profile_name: next.profile ?? spreadProfile,
      period_start: dates.start,
      period_end: dates.end,
    }, [spreadMeasure, ...also]).then((outcome) => {
      // Not written: the next commit may send the same amount again.
      if (outcome.status !== 'saved') committedAmountRef.current = '';
    }).catch((e) => {
      if (e instanceof UnsavedEditsError) return;
      committedAmountRef.current = '';
      setError(getApiErrorMessage(e, t, t(`${config.i18nPrefix}.budget.failedToSave`)));
    });
  };
  // Leaving the field writes only a changed amount, so tabbing through writes nothing; Enter always writes.
  const commitSpreadAmount = () => {
    if (spreadAmount === committedAmountRef.current) return;
    commitSpread();
  };
  const onSpreadProfileChange = (profile: 'flat' | '4-4-5') => {
    setSpreadProfile(profile);
    commitSpread({ profile });
  };
  const onSpreadDateChange = (bound: 'start' | 'end', value: string) => {
    const dates = { ...spreadPeriod, [bound]: value };
    setSpreadDates(dates);
    commitSpread({ dates });
  };
  // Turned on, the spread goes to the group's columns at once; turned off, nothing is written.
  const onSpreadAllColumnsChange = (on: boolean) => {
    setSpreadAllColumns(on);
    if (on) commitSpread({ also: groupOthers.map((c) => c.measure) });
  };

  // Every complete line of the panel's column, and of the group's columns when asked. `startedFrom`:
  // the stored lines the panel's drafts started from (the base of a lines write).
  const saveLines = async (measure: AmountCol, lines: LinePayload[], toAllColumns: boolean, startedFrom: LinePayload[]): Promise<LinesSaveResult> => {
    const also = toAllColumns && offerApplyToAll ? groupOthers.map((c) => c.measure) : [];
    const body: LinesRequest = { kind: 'lines', year, measure, lines, ...(also.length > 0 ? { also_measures: also } : {}) };
    try {
      const outcome = await writePanel(body, [measure, ...also], startedFrom);
      if (outcome.status !== 'saved') return { ok: false, conflict: true };
      const data = outcome.data;
      return { ok: true, warnings: Array.isArray(data?.warnings) ? data!.warnings : undefined };
    } catch (e) {
      if (e instanceof UnsavedEditsError) return { ok: false, error: t(`${config.i18nPrefix}.budget.failedToSave`) };
      return { ok: false, error: getApiErrorMessage(e, t, t('budgetTab.lines.saveFailed')) };
    }
  };

  /* ---- The user's choice for a column waiting after a refused save (lot 3D) ---- */

  const dropWaiting = (cols: Iterable<AmountCol>) => {
    const gone = new Set(cols);
    setWaiting(waitingRef.current.filter((c) => !gone.has(c.measure)));
  };
  // Nothing waits any more: the autosave leaves its `conflict` state.
  const settleChoices = () => {
    if (waitingRef.current.length === 0 && !parkedPanelRef.current) autosaveRef.current.resetConflict();
  };
  // Their months for the column on screen and as the base; the cells and total typed in it are dropped.
  const takeTheirs = (conflict: BudgetConflict) => {
    const col = conflict.measure;
    dirtyTotalsRef.current.delete(col);
    editedAtRef.current.delete(`total:${col}`);
    dirtyCellsRef.current.forEach((cols, period) => {
      cols.delete(col);
      editedAtRef.current.delete(`${period}:${col}`);
      if (cols.size === 0) dirtyCellsRef.current.delete(period);
    });
    serverMonthsRef.current[col] = [...conflict.current];
    if (conflict.currentLines) serverLinesRef.current[col] = conflict.currentLines;
    setMonths((prev) => prev.map((row, i) => ({ ...row, [col]: conflict.current[i] / 100 })));
    setFlat((prev) => ({ ...prev, [col]: sumCents(conflict.current) / 100 }));
  };
  // A panel write whose every refused column has a choice goes again, with the bases chosen.
  const sendParkedPanel = () => {
    const parked = parkedPanelRef.current;
    if (!parked || waitingRef.current.some((c) => c.source === 'panel')) return;
    setResolving(true);
    void enqueueWrite(() => sendPanel(parked.body, [...parked.columns], parked.main)).then((outcome) => {
      if (outcome.status === 'saved') {
        parkedPanelRef.current = null;
        settleChoices();
      }
    }).catch((e) => {
      parkedPanelRef.current = null;
      settleChoices();
      setError(getApiErrorMessage(e, t, t(`${config.i18nPrefix}.budget.failedToSave`)));
    }).finally(() => setResolving(false));
  };

  const onConflictChoice = (field: string, choice: ConflictChoice) => {
    const conflict = waitingRef.current.find((c) => c.measure === field);
    if (!conflict) return;
    const col = conflict.measure;
    if (conflict.source === 'grid') {
      if (choice === 'mine') {
        // « Overwrite »: the column's edits go again over theirs, from the column as the server answered it.
        serverMonthsRef.current[col] = [...conflict.current];
        // The months the user did not type show theirs, as the base now says.
        const dirtyHere = (period: string) => !!dirtyCellsRef.current.get(period)?.has(col);
        setMonths((prev) => prev.map((row, i) => (dirtyHere(row.period) ? row : { ...row, [col]: conflict.current[i] / 100 })));
        dropWaiting([col]);
        autosaveRef.current.schedule(persistRef.current);
      } else {
        // « Reload the column »: their values, the user's edits of the column dropped.
        takeTheirs(conflict);
        dropWaiting([col]);
        settleChoices();
        void loadRef.current({ quietSince: editSeqRef.current });
      }
      return;
    }
    const parked = parkedPanelRef.current;
    if (!parked) {
      dropWaiting([col]);
      settleChoices();
      return;
    }
    // A copy: the refused request keeps the base it was sent with.
    const base = { columns: { ...((parked.body.base as { columns?: Record<string, unknown> } | undefined)?.columns ?? {}) } };
    if (choice === 'mine') {
      base.columns[col] = {
        months: monthsBase(conflict.current),
        ...(conflict.currentLines ? { lines: conflict.currentLines } : {}),
      };
      parked.body = { ...parked.body, base };
      dropWaiting([col]);
      sendParkedPanel();
      return;
    }
    if (col === parked.main) {
      // Their column: the panel's write is dropped whole, its lines start again from the stored ones.
      parkedPanelRef.current = null;
      dropWaiting(parked.columns);
      takeTheirs(conflict);
      if (spreadMeasureRef.current === col) {
        setSpreadDates(null);
        showSpreadAmount(amountOrEmpty(sumCents(conflict.current)));
      }
      settleChoices();
      void loadRef.current({ quietSince: editSeqRef.current }).then(() => setLinesReload((n) => n + 1));
      return;
    }
    // Their column for a column the lines also went to: the write goes on without it.
    const also = ((parked.body.also_measures as AmountCol[] | undefined) ?? []).filter((m) => m !== col);
    delete base.columns[col];
    parked.body = { ...parked.body, base, also_measures: also };
    parked.columns.delete(col);
    dropWaiting([col]);
    sendParkedPanel();
  };

  // Totals: flat values in flat mode, live column sums in monthly mode.
  const totals = React.useMemo<Record<AmountCol, number>>(() => {
    if (mode === 'flat') return perColumn((col) => Number(flat[col] || 0));
    return months.reduce((acc, m) => {
      ALL_COLS.forEach((c) => { acc[c] += Number(m[c] || 0); });
      return acc;
    }, perColumn(() => 0));
  }, [mode, flat, months]);

  // Stable while the five totals are unchanged, so the chart cache is not patched on every render.
  const totalsKey = ALL_COLS.map((col) => totals[col]).join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const liveTotals = React.useMemo(() => ({ ...totals }), [totalsKey]);

  // Keep the yearly-totals query cache in sync so a year-tab switch does not snap
  // the previously edited year back to the value fetched on first paint.
  React.useEffect(() => {
    if (loadedYear !== year) return;
    patchYearlyTotalsCache(queryClient, config, id, year, liveTotals);
  }, [loadedYear, year, liveTotals, id, config, queryClient]);

  const fmt = (n: number) => formatAmount(n);

  const labelFor = (col: AmountCol) => budgetColumns.label(col);
  const chipOf = (record: RoundInput | null | undefined) => chipText(t, locale, record, labelFor);
  // The chip, one block per line of it, as units that wrap whole ("Quantity and price ·" then "3 lines ·
  // 1.00 FTE"); a unit longer than the line still wraps inside it.
  const chipBlocks = (record: RoundInput | null | undefined) => chipLines(t, locale, record, labelFor).map((units, line) => (
    <Box component="span" key={line} sx={{ display: 'block' }}>
      {units.map((unit, i) => (
        <React.Fragment key={unit}>
          {i > 0 && ' '}
          <Box component="span" sx={{ display: 'inline-block', maxWidth: '100%' }}>{unit}</Box>
        </React.Fragment>
      ))}
    </Box>
  ));
  // A column waiting for the user's choice is read-only and tinted, here and in the banner's list.
  const waitingSet = new Set<AmountCol>([
    ...waitingColumns.map((c) => c.measure),
    ...(parkedPanelRef.current ? [...parkedPanelRef.current.columns] : []),
  ]);
  const gridColumns = shown.map((c) => ({ col: c.measure, fr: frozen[c.freezeKey], waits: waitingSet.has(c.measure) }));
  const monthName = (period: string) => new Date(year, monthIndexOf(period), 1).toLocaleString(locale, { month: 'short' });
  // A side of a refused column in the banner: the months refused (a few cells typed in the monthly
  // view), else the year's total, with its number of lines when lines were compared.
  const conflictSide = (c: WaitingColumn, cents: readonly number[], lineCount: number | null) => {
    if (c.source === 'grid' && mode === 'monthly' && c.periods.length > 0 && c.periods.length <= 3) {
      return c.periods.map((p) => `${monthName(p)} ${fmt(cents[monthIndexOf(p)] / 100)}`).join(' · ');
    }
    const amount = fmt(sumCents(cents) / 100);
    return lineCount === null ? t('budgetTab.conflict.yearTotal', { amount }) : t('budgetTab.conflict.yearTotalLines', { amount, count: lineCount });
  };
  const bannerConflicts: EditConflict[] = waitingColumns.map((c) => {
    const parkedLines = c.source === 'panel' && c.currentLines ? parkedPanelRef.current?.body.lines : undefined;
    return {
      field: c.measure,
      base: null,
      current: c.measure,
      mine: c.measure,
      labels: {
        base: null,
        current: conflictSide(c, c.current, c.currentLines ? c.currentLines.length : null),
        mine: conflictSide(c, c.mine, Array.isArray(parkedLines) ? parkedLines.length : null),
      },
      changed_by: c.changed_by,
      changed_at: c.changed_at,
    };
  });
  const recordFor = (col: AmountCol) => roundInputs.find((r) => r.measure === col);
  const periodTextOf = (period: Period | null) => (period ? periodText(t, locale, activeMonths(year, period.start, period.end)) : '');

  const savingHint = writesPending > 0 || autosave.status === 'saving' || autosave.status === 'pending'
    ? t('common:status.saving', 'Saving…')
    : autosave.status === 'saved' ? t('common:status.saved', 'Saved') : null;

  const numCellSx = { textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 13, color: 'kanap.text.primary', px: 1, py: 0 } as const;
  const headCellSx = { textAlign: 'right', fontSize: 11, fontWeight: 500, color: 'kanap.text.secondary', px: 1, py: 0.75, whiteSpace: 'nowrap', verticalAlign: 'top' } as const;
  const captionSx = { fontSize: 12, color: 'kanap.text.tertiary', lineHeight: 1.4 } as const;
  const captionIconSx = { p: '2px', color: 'kanap.text.tertiary', '&:hover': { color: 'primary.main', bgcolor: 'transparent' } } as const;
  // The column's lines, one per text line, as the tooltip of how it was produced; empty (no tooltip)
  // when it has no lines.
  const linesOf = (col: AmountCol) => (loadedYear === year ? linesText(t, locale, recordFor(col)) : '');
  const multilineTooltip = { tooltip: { sx: { whiteSpace: 'pre-line' } } } as const;

  // Every control has its label above it, so the row sits on one baseline and wraps cleanly.
  const panelField = (label: string, width: number, control: React.ReactNode) => (
    <PanelField label={label} width={width}>{control}</PanelField>
  );
  // Built from the setting and the column names: nothing here knows what a column means.
  const outsideGroup = shown.filter((c) => !c.groupSpread);
  const applyToAllHint = [
    t('budgetTab.applyToAllFollow', { columns: joinList(t, group.map((c) => c.label)) }),
    outsideGroup.length > 0
      ? t('budgetTab.applyToAllOthers', { count: outsideGroup.length, columns: joinList(t, outsideGroup.map((c) => c.label)) })
      : '',
    t('budgetTab.applyToAllFrozen'),
  ].filter(Boolean).join(' ');
  const zeroedText = spreadProblem ? '' : zeroedMonthsText(t, locale, spreadActive);

  const spreadFields = (
    <>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', columnGap: 1.5, rowGap: 1 }}>
        {panelField(t('budgetTab.column'), 150, (
          <TextField
            select size="small" variant="standard" value={spreadMeasure}
            onChange={(e) => onSpreadMeasureChange(e.target.value as AmountCol)}
            inputProps={{ 'aria-label': t('budgetTab.column') }}
            SelectProps={selectKeepsFocus}
            sx={drawerSelectSx}
          >
            {shown.map((c) => <MenuItem key={c.measure} value={c.measure} sx={drawerMenuItemSx}>{c.label}</MenuItem>)}
          </TextField>
        ))}
        {panelField(t('budgetTab.amount'), 130, (
          <FormattedNumberField
            value={spreadAmount}
            onChange={(e) => setSpreadAmount(e.target.value as unknown as number | '')}
            onBlur={commitSpreadAmount}
            onKeyDown={(e) => { if (e.key === 'Enter') commitSpread(); }}
            variant="standard" size="small" fullWidth
            placeholder={t(`${config.i18nPrefix}.budget.spreadPlaceholder`)}
            inputProps={{ 'aria-label': t('budgetTab.amount') }}
          />
        ))}
        {panelField(t('budgetTab.distribution'), 120, (
          <TextField
            select size="small" variant="standard" value={spreadProfile}
            onChange={(e) => onSpreadProfileChange(e.target.value as 'flat' | '4-4-5')}
            inputProps={{ 'aria-label': t('budgetTab.distribution') }}
            SelectProps={selectKeepsFocus}
            sx={drawerSelectSx}
          >
            <MenuItem value="flat" sx={drawerMenuItemSx}>{t(`${config.i18nPrefix}.budget.profileFlat`)}</MenuItem>
            <MenuItem value="4-4-5" sx={drawerMenuItemSx}>{t(`${config.i18nPrefix}.budget.profile445`)}</MenuItem>
          </TextField>
        ))}
        <PanelPeriod>
          <DateEUField label={t('budgetTab.from')} valueYmd={spreadPeriod.start} onChangeYmd={(v) => onSpreadDateChange('start', v)} size="small" sx={{ width: 150 }} />
          <DateEUField label={t('budgetTab.to')} valueYmd={spreadPeriod.end} onChangeYmd={(v) => onSpreadDateChange('end', v)} size="small" sx={{ width: 150 }} />
        </PanelPeriod>
      </Box>
      {/* Only the lines that apply: a whole-year period shows none. */}
      {(spreadProblem || zeroedText || spreadBeyondItem || spreadFrozen || spreadWaiting) && (
        <Box data-testid="spread-notes">
          {spreadProblem && (
            <Typography sx={{ ...captionSx, color: 'error.main' }}>{t(`budgetTab.problem.${spreadProblem}`, { year })}</Typography>
          )}
          {zeroedText && (
            <Typography sx={{ ...captionSx, color: 'kanap.text.secondary' }}>{zeroedText}</Typography>
          )}
          {spreadBeyondItem && (
            <Typography sx={{ ...captionSx, color: 'warning.main' }}>{t('budgetTab.beyondItemDates')}</Typography>
          )}
          {spreadFrozen && (
            <Typography sx={captionSx}>{t(`${config.i18nPrefix}.budget.someColumnsFrozen`)}</Typography>
          )}
          {spreadWaiting && (
            <Typography sx={{ ...captionSx, color: 'warning.main' }}>{t('budgetTab.conflict.waiting')}</Typography>
          )}
        </Box>
      )}
      {offerApplyToAll && (
        <Box>
          <FormControlLabel
            control={<Switch size="small" checked={spreadAllColumns} onChange={(e) => onSpreadAllColumnsChange(e.target.checked)} />}
            label={(
              <Tooltip title={applyToAllHint}>
                <Typography sx={{ fontSize: 13, color: 'kanap.text.primary' }}>{t('budgetTab.applyDistributionToAll')}</Typography>
              </Tooltip>
            )}
            sx={{ ml: 0 }}
          />
        </Box>
      )}
    </>
  );

  const spreadPanel = (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, bgcolor: 'kanap.bg.drawer', border: '1px solid', borderColor: 'kanap.border.soft', borderRadius: '8px', p: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <Tabs value={panelKind} onChange={(_, kind) => onPanelKindChange(kind)}>
          <Tab value="spread" label={t('budgetTab.panel.spread')} />
          <Tab value="lines" label={t('budgetTab.panel.lines')} />
        </Tabs>
        {/* The 15th rule, one hover away instead of a permanent line. */}
        <Tooltip title={t('budgetTab.convention')}>
          <InfoOutlinedIcon tabIndex={0} aria-label={t('budgetTab.convention')} sx={{ fontSize: 13, color: 'kanap.text.tertiary' }} />
        </Tooltip>
        {/* Every change is saved as it is made: the yearly view only needs a way to close the box. */}
        {mode === 'flat' && (
          <IconButton size="small" aria-label={t('common:buttons.close')} onClick={closeSpreadPanel} sx={{ ...captionIconSx, ml: 'auto' }}>
            <CloseIcon sx={{ fontSize: 16 }} />
          </IconButton>
        )}
      </Box>
      {panelKind === 'spread' ? spreadFields : loadedYear === year && (
        <>
          {/* Outside the panel below: a column picked here keeps the focus while that panel is drawn again. */}
          <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', columnGap: 1.5, rowGap: 1 }}>
            {panelField(t('budgetTab.column'), 150, (
              <TextField
                select size="small" variant="standard" value={spreadMeasure}
                onChange={(e) => onSpreadMeasureChange(e.target.value as AmountCol)}
                inputProps={{ 'aria-label': t('budgetTab.column') }}
                SelectProps={selectKeepsFocus}
                sx={drawerSelectSx}
              >
                {shown.map((c) => (
                  <MenuItem key={c.measure} value={c.measure} disabled={frozen[c.freezeKey]} sx={drawerMenuItemSx}>{c.label}</MenuItem>
                ))}
              </TextField>
            ))}
          </Box>
          {/* One panel per year and column: it starts from the column's stored lines and keeps what is
              typed across its own saves. */}
          <LinesPanel
            key={`${year}:${spreadMeasure}`}
            year={year}
            record={recordFor(spreadMeasure)}
            period={periodForEdit(year, recordFor(spreadMeasure), storedAmounts[spreadMeasure], suggestion)}
            itemStart={effectiveStart}
            itemEnd={endOfValidity}
            frozen={spreadFrozen || spreadWaiting}
            frozenHint={spreadWaiting ? t('budgetTab.conflict.waiting') : t(`${config.i18nPrefix}.budget.someColumnsFrozen`)}
            waiting={spreadWaiting}
            reloadSignal={linesReload}
            payingCompanyCountry={payingCompanyCountry}
            columnName={labelFor}
            applyToAll={{ offered: offerApplyToAll, on: linesAllColumns, hint: applyToAllHint, onChange: setLinesAllColumns }}
            onSave={(lines, toAllColumns, startedFrom) => saveLines(spreadMeasure, lines, toAllColumns, startedFrom)}
          />
        </>
      )}
    </Box>
  );

  return (
    <Stack spacing={2.5} sx={{ pt: 1 }}>
      {!!error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      {/* Columns someone else changed while the user was editing them: reload or overwrite, per column. */}
      <EditConflictBanner
        wording="column"
        conflicts={bannerConflicts}
        fieldLabel={(field) => labelFor(field as AmountCol)}
        onResolve={onConflictChoice}
        busy={resolving}
        currentUserId={userId}
        sx={{ mx: 0, mt: 0 }}
      />

      {/* Saving hint is absolutely positioned so it never reflows the year selector / table. */}
      <Box sx={{ position: 'relative' }}>
        <YearTabs currentYear={year} availableYears={availableYears} onYearChange={(y) => void handleYearChange(y)} disabled={loading} />
        {savingHint && (
          <Typography sx={{ position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: 'kanap.text.tertiary', pointerEvents: 'none' }}>
            {savingHint}
          </Typography>
        )}
      </Box>

      <Tabs value={mode} onChange={(_, v) => void onModeChange(v)}>
        <Tab value="flat" label={t(`${config.i18nPrefix}.budget.flat`)} />
        <Tab value="monthly" label={t(`${config.i18nPrefix}.budget.monthly`)} />
      </Tabs>

      {mode === 'flat' ? (
        <Stack spacing={2}>
          {/* Wide enough for a column's caption to read as two short lines: how, then when. */}
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 2.5 }}>
            {shown.map((m) => {
              // Until this year's data is in, the previous year's periods would be read against this year.
              const loaded = loadedYear === year;
              const period = loaded ? periodFor(m.measure, roundInputs, storedAmounts) : null;
              const text = periodTextOf(period);
              // No stored period, no amounts and no month of the year within the item's dates.
              const noMonth = loaded && !text;
              const chip = loaded ? chipOf(recordFor(m.measure)) : '';
              const isFrozen = frozen[m.freezeKey];
              const waits = waitingSet.has(m.measure);
              return (
                <Box
                  key={m.measure}
                  data-testid={`budget-column-${m.measure}`}
                  data-waiting={waits ? 'true' : undefined}
                  sx={{
                    display: 'flex', flexDirection: 'column', gap: 0.5,
                    // Waiting for the user's choice: tinted, without moving the grid.
                    ...(waits ? { bgcolor: conflictTint, borderRadius: '8px', p: 0.75, m: -0.75 } : {}),
                  }}
                >
                  {/* The label, then the column's two panels at its right, as wide as the field below. */}
                  <Box data-testid={`column-title-${m.measure}`} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, maxWidth: 220, minHeight: 18 }}>
                    <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary', display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                      {waits && <StatusDot color="warning.main" />}
                      {m.label}
                      {isFrozen && <LockOutlinedIcon sx={{ fontSize: 12 }} />}
                    </Typography>
                    {loaded && !isFrozen && !waits && !loading && (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, ml: 'auto' }}>
                        <Tooltip title={noMonth ? t('budgetTab.choosePeriod') : t('budgetTab.changePeriod')}>
                          <IconButton
                            size="small"
                            aria-label={noMonth ? t('budgetTab.choosePeriod') : t('budgetTab.changePeriod')}
                            onClick={() => openSpreadPanel(m.measure)}
                            sx={captionIconSx}
                          >
                            <EditOutlinedIcon sx={{ fontSize: 14 }} />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title={t('budgetTab.panel.lines')}>
                          <IconButton
                            size="small"
                            aria-label={t('budgetTab.panel.lines')}
                            onClick={() => openLinesPanel(m.measure)}
                            sx={captionIconSx}
                          >
                            <CalculateOutlinedIcon sx={{ fontSize: 14 }} />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    )}
                  </Box>
                  <FormattedNumberField
                    value={flat[m.measure]}
                    onChange={(e) => onFlatChange(m.measure, (e.target.value as unknown as number | ''))}
                    variant="standard"
                    disabled={loading || isFrozen || noMonth}
                    InputProps={{ readOnly: isFrozen || waits }}
                    sx={{ maxWidth: 220, '& .MuiInputBase-input': { fontSize: '15px !important', fontWeight: 500 } }}
                  />
                  {loaded && (
                    <Tooltip title={linesOf(m.measure)} componentsProps={multilineTooltip}>
                      {/* How the column was produced, then its period: one line each, never run together. */}
                      <Typography component="div" sx={{ ...captionSx, minWidth: 0 }} data-testid={`period-line-${m.measure}`}>
                        {noMonth ? t('budgetTab.noMonthInItemDates', { year }) : (
                          <>
                            {chip && chipBlocks(recordFor(m.measure))}
                            {text && <Box component="span" sx={{ display: 'block' }}>{text}</Box>}
                          </>
                        )}
                      </Typography>
                    </Tooltip>
                  )}
                </Box>
              );
            })}
          </Box>
          {panelOpen && spreadPanel}
        </Stack>
      ) : (
        <Stack spacing={2}>
          {spreadPanel}

          {/* Dense monthly table */}
          <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', '& td, & th': { borderBottom: '1px solid', borderColor: 'kanap.border.soft' } }}>
            <Box component="thead">
              <Box component="tr">
                <Box component="th" sx={{ ...headCellSx, textAlign: 'left' }}>{t(`${config.i18nPrefix}.budget.month`)}</Box>
                {gridColumns.map(({ col, fr, waits }) => {
                  const record = loadedYear === year ? recordFor(col) : undefined;
                  const chip = chipOf(record);
                  return (
                    <Box component="th" key={col} data-testid={`budget-head-${col}`} data-waiting={waits ? 'true' : undefined} sx={{ ...headCellSx, ...(waits ? { bgcolor: conflictTint } : {}) }}>
                      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, justifyContent: 'flex-end' }}>
                        {waits && <StatusDot color="warning.main" sx={{ mr: 0.5 }} />}
                        {labelFor(col)}
                        {waits ? null : fr ? (
                          <LockOutlinedIcon sx={{ fontSize: 12, color: 'kanap.text.tertiary' }} />
                        ) : (
                          <Tooltip title={t(`${config.i18nPrefix}.budget.clearColumn`)}>
                            <IconButton size="small" aria-label={t(`${config.i18nPrefix}.budget.clearColumn`)} onClick={() => { void clearColumn(col); }} sx={{ p: '2px' }}>
                              <BackspaceOutlinedIcon sx={{ fontSize: 13 }} />
                            </IconButton>
                          </Tooltip>
                        )}
                      </Box>
                      {chip && record && (
                        <Tooltip
                          title={[periodTextOf({ start: record.period_start, end: record.period_end }), linesOf(col)].filter(Boolean).join('\n')}
                          componentsProps={multilineTooltip}
                        >
                          <Box sx={{ fontSize: 11, fontWeight: 400, color: 'kanap.text.tertiary', whiteSpace: 'normal', lineHeight: 1.3 }}>{chipBlocks(record)}</Box>
                        </Tooltip>
                      )}
                    </Box>
                  );
                })}
              </Box>
            </Box>
            <Box component="tbody">
              {QUARTERS.map((q) => {
                const qTotals = perColumn((c) => q.months.reduce((sum, mi) => sum + Number(months[mi]?.[c] || 0), 0));
                return (
                  <React.Fragment key={q.label}>
                    {q.months.map((mi) => (
                      <Box component="tr" key={mi} sx={{ '&:hover': { bgcolor: 'kanap.bg.hover' } }}>
                        <Box component="td" sx={{ fontSize: 13, color: 'kanap.text.primary', px: 1, py: 0.25 }}>
                          {new Date(year, mi, 1).toLocaleString(locale, { month: 'short' })}
                        </Box>
                        {gridColumns.map(({ col, fr, waits }) => (
                          <Box component="td" key={col} sx={{ px: 0.5, py: '2px', ...(waits ? { bgcolor: conflictTint } : {}) }}>
                            <FormattedNumberField
                              value={months[mi]?.[col] ?? 0}
                              onChange={(e) => onMonthChange(mi, col, e.target.value as unknown as number | '')}
                              variant="standard" size="small" fullWidth
                              disabled={loading || fr}
                              InputProps={{ readOnly: fr || waits }}
                              sx={tableCellFieldSx}
                            />
                          </Box>
                        ))}
                      </Box>
                    ))}
                    <Box component="tr" sx={{ bgcolor: 'kanap.bg.drawer' }}>
                      <Box component="td" sx={{ fontSize: 11, fontWeight: 500, color: 'kanap.text.tertiary', px: 1, py: 0.5 }}>{q.label}</Box>
                      {gridColumns.map(({ col }) => (
                        <Box component="td" key={col} sx={{ ...numCellSx, fontWeight: 500, color: 'kanap.text.secondary', py: 0.5 }}>{fmt(qTotals[col])}</Box>
                      ))}
                    </Box>
                  </React.Fragment>
                );
              })}
            </Box>
            <Box component="tfoot">
              <Box component="tr">
                <Box component="td" sx={{ fontSize: 12, fontWeight: 500, color: 'kanap.text.primary', px: 1, py: 0.75 }}>{t(`${config.i18nPrefix}.budget.total`)}</Box>
                {gridColumns.map(({ col }) => (
                  <Box component="td" key={col} sx={{ ...numCellSx, fontWeight: 500, py: 0.75 }}>{fmt(totals[col])}</Box>
                ))}
              </Box>
            </Box>
          </Box>
        </Stack>
      )}

      <BudgetTrendChart
        id={id}
        year={year}
        liveTotals={loadedYear === year && !loading ? liveTotals : undefined}
        currency={currency}
        config={config}
      />

      {anyFrozen && (
        <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary' }}>{t(`${config.i18nPrefix}.budget.someColumnsFrozen`)}</Typography>
      )}
    </Stack>
  );
});
