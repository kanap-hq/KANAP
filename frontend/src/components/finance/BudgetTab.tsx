import React, { forwardRef, useImperativeHandle } from 'react';
import { Alert, Box, FormControlLabel, IconButton, MenuItem, Stack, Switch, Tab, Tabs, TextField, Tooltip, Typography } from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import BackspaceOutlinedIcon from '@mui/icons-material/BackspaceOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import CalculateOutlinedIcon from '@mui/icons-material/CalculateOutlined';
import CloseIcon from '@mui/icons-material/Close';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../api';
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

type BulkUpsertResponse = { updated?: number; round_inputs?: RoundInput[]; warnings?: string[] };

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

  const autosave = useAutosave({ onError: (e) => setError(getApiErrorMessage(e, t, t(`${config.i18nPrefix}.budget.failedToSave`))) });

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

  // `quietSince`: a reload after a panel write, which saved the grid up to that edit number. Nothing
  // turns read-only meanwhile, the spread panel keeps what it shows (it is what was just written, or
  // what the user is typing), and a cell or total typed since keeps its value and stays unsaved.
  const applyYear = React.useCallback((snapshot: BudgetYear, { quietSince }: { quietSince?: number } = {}) => {
    const quiet = quietSince !== undefined;
    const typedSince = (key: string) => quiet && (editedAtRef.current.get(key) ?? 0) > quietSince;
    if (!quiet) setSpreadDates(null);
    const v = snapshot.version;
    if (!v) {
      setVersion(null);
      setMode('flat');
      setFlat(EMPTY_FLAT);
      setMonths(emptyMonths(year));
      setRoundInputs([]);
      setStoredAmounts(NO_STORED_AMOUNTS);
      if (!quiet) showSpreadAmount('');
      resetDirty();
      setLoadedYear(year);
      return;
    }
    setVersion(v);
    setMode(v.input_grain === 'annual' ? 'flat' : 'monthly');
    const amt = snapshot.amounts;
    const totals = amt?.totals;
    setFlat((prev) => perColumn((col) => (typedSince(`total:${col}`) ? prev[col] : Number(totals?.[col] || 0))));
    const byPeriod = new Map((amt?.items || []).map((r) => [r.period, r]));
    const loadedMonths = Array.from({ length: 12 }, (_, i) => {
      const p = monthPeriod(year, i + 1);
      const found = byPeriod.get(p);
      return { period: p, ...perColumn((col) => Number(found?.[col] || 0)) };
    });
    setMonths((prev) => loadedMonths.map((row, i) => (
      prev[i]?.period === row.period
        ? { period: row.period, ...perColumn((col) => (typedSince(`${row.period}:${col}`) ? prev[i][col] : row[col])) }
        : row
    )));
    const hasAmounts = (m: AmountCol) => loadedMonths.some((row) => row[m] !== 0);
    setStoredAmounts(perColumn(hasAmounts));
    const loadedInputs = Array.isArray(amt?.round_inputs) ? amt!.round_inputs! : [];
    roundInputsRef.current = loadedInputs;
    setRoundInputs(loadedInputs);
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
    try {
      const snapshot = await queryClient.fetchQuery({
        queryKey: budgetYearKey(config.itemsApi, id, year),
        queryFn: ({ signal }) => fetchBudgetYear(config, id, year, signal),
        staleTime: 0,
      });
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

  // Persist the edited totals (flat) or cells (monthly), creating the version on
  // first edit. Frozen measures are never sent.
  const persist = React.useCallback(async () => {
    const fr = frozenRef.current;
    const flatMode = modeRef.current === 'flat';
    // Snapshot and clear: edits typed while this save is in flight stay dirty
    // for the next one; a failed save puts its snapshot back.
    const totalsSnapshot = flatMode ? dirtyTotalsRef.current : new Set<AmountCol>();
    const cellsSnapshot = flatMode ? new Map<string, Set<AmountCol>>() : dirtyCellsRef.current;
    if (flatMode) dirtyTotalsRef.current = new Set(); else dirtyCellsRef.current = new Map();
    // Totals not saved yet; a request that succeeds takes its own out.
    const unsavedTotals = new Set(totalsSnapshot);
    try {
      const bodies: Array<{ body: Record<string, unknown>; measures: AmountCol[] }> = [];
      if (flatMode) {
        // A yearly total is spread flat over its column's period: one request
        // per period (in practice one).
        const f = flatRef.current;
        const groups = new Map<string, { period: Period; totals: Partial<Record<AmountCol, number>> }>();
        ALL_COLS.forEach((col) => {
          if (!totalsSnapshot.has(col) || fr[FREEZE_KEY[col]]) return;
          const period = periodForRef.current(col, roundInputsRef.current, storedAmountsRef.current);
          if (!period) return;
          const key = `${period.start}|${period.end}`;
          const group = groups.get(key) ?? { period, totals: {} };
          group.totals[col] = Number(f[col] || 0);
          groups.set(key, group);
        });
        groups.forEach(({ period, totals }) => bodies.push({
          body: { kind: 'annual', year, totals, period_start: period.start, period_end: period.end },
          measures: Object.keys(totals) as AmountCol[],
        }));
      } else {
        const rows = monthsRef.current.flatMap((m) => {
          const cols = cellsSnapshot.get(m.period);
          const row: Record<string, string | number> = { period: m.period };
          ALL_COLS.forEach((c) => {
            if (cols?.has(c) && !fr[FREEZE_KEY[c]]) row[c] = Number(m[c] || 0);
          });
          return Object.keys(row).length > 1 ? [row] : [];
        });
        if (rows.length > 0) bodies.push({ body: { kind: 'monthly', year, months: rows }, measures: [] });
      }
      if (bodies.length === 0) return;

      markYearStaleRef.current();
      const v = await ensureVersion();
      const nextGrain = flatMode ? 'annual' : 'monthly';
      if (v.input_grain !== nextGrain) {
        await api.patch(`${config.itemsApi}/${id}/versions`, { id: v.id, input_grain: nextGrain });
        setVersion((prev) => (prev ? { ...prev, input_grain: nextGrain } : prev));
      }
      for (const { body, measures } of bodies) {
        const res = await api.post<BulkUpsertResponse>(`${config.versionsApi}/${v.id}/amounts/bulk-upsert`, body);
        keepRoundInputs(res?.data);
        measures.forEach((k) => unsavedTotals.delete(k));
      }
      // Once written too: an Allocations tab opened while the save ran read the old totals.
      forgetAllocationsYear(queryClient, config.itemsApi, id, year);
      const savedColumns = flatMode ? totalsSnapshot : new Set([...cellsSnapshot.values()].flatMap((cols) => [...cols]));
      if (savedColumns.has(spreadMeasureRef.current)) followSavedTotal();
    } catch (e) {
      unsavedTotals.forEach((k) => dirtyTotalsRef.current.add(k));
      cellsSnapshot.forEach((cols, period) => cols.forEach((c) => markCellDirty(period, c)));
      // The save may have been refused because a column was frozen meanwhile:
      // refresh the freeze state so that column turns read-only and the next
      // save leaves it out instead of sending it again.
      void queryClient.invalidateQueries({ queryKey: ['freeze-state', year] });
      throw e;
    }
  }, [ensureVersion, id, year, queryClient]);

  const scheduleSave = React.useCallback(() => { autosave.schedule(persist); }, [autosave, persist]);

  const hasUnsavedEdits = () => dirtyTotalsRef.current.size > 0 || dirtyCellsRef.current.size > 0;
  // Save every unsaved edit now. A save the autosave dropped (refused) left its
  // edits dirty here, so it is scheduled again; a busy save the autosave still
  // keeps (isBusy) goes again within the flush. False if the save fails.
  const flushEdits = React.useCallback(async () => {
    if (hasUnsavedEdits() && !autosave.isBusy()) autosave.schedule(persist);
    return autosave.flush();
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
    if (monthsRef.current.some((m) => toCents(m[key]) !== 0)) {
      const confirmed = await dialogs.confirm({
        message: t(`${config.i18nPrefix}.budget.clearColumnConfirm`, { column: budgetColumns.label(key), year }),
        confirmLabel: t(`${config.i18nPrefix}.budget.clearColumn`),
        intent: 'danger',
      });
      // While the question was open, the column may have been frozen or the year changed: then nothing is cleared.
      if (!confirmed || frozenRef.current[FREEZE_KEY[key]] || yearRef.current !== year) return;
    }
    setMonths((prev) => prev.map((m) => ({ ...m, [key]: 0 })));
    for (let m = 1; m <= 12; m++) editCell(monthPeriod(year, m), key);
    scheduleSave();
  };
  const onModeChange = React.useCallback(async (next: 'flat' | 'monthly') => {
    if (next === modeRef.current) return;
    // Persist any pending edits in the current mode first, then switch the grain and
    // resync from the backend so the new view reflects stored data (no stale overwrite).
    // If they cannot be saved, stay: the reload would discard them.
    if (!(await flushAll())) return;
    setMode(next);
    setPanelOpen(false);
    const v = versionRef.current;
    if (!v) return; // no version yet: the grain persists on first edit
    try {
      markYearStale();
      await api.patch(`${config.itemsApi}/${id}/versions`, { id: v.id, input_grain: next === 'flat' ? 'annual' : 'monthly' });
      await load();
    } catch (e) {
      setError(getApiErrorMessage(e, t, t(`${config.i18nPrefix}.budget.failedToSave`)));
    }
  }, [flushAll, id, load, t, markYearStale]);

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
    ? group.filter((c) => c.measure !== spreadMeasure && !frozen[c.freezeKey])
    : [];
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

  // One panel write, queued: pending grid edits first (the reload shows the stored amounts), then the
  // body, then a quiet reload. The view stays as it is; from the monthly view the version keeps
  // the monthly grain.
  const writePanel = (body: Record<string, unknown> | LinesRequest) => enqueueWrite(async () => {
    if (!(await flushEdits())) throw new UnsavedEditsError();
    // The grid is saved up to here: what is typed from now on is kept by the reload.
    const savedUpTo = editSeqRef.current;
    try {
      markYearStaleRef.current();
      const v = await ensureVersion();
      const res = await api.post<BulkUpsertResponse>(`${config.versionsApi}/${v.id}/amounts/bulk-upsert`, body);
      keepRoundInputs(res?.data);
      forgetAllocationsYear(queryClient, config.itemsApi, id, year);
      if (modeRef.current === 'monthly' && v.input_grain !== 'monthly') {
        await api.patch(`${config.itemsApi}/${id}/versions`, { id: v.id, input_grain: 'monthly' });
        versionRef.current = { ...v, input_grain: 'monthly' };
        setVersion(versionRef.current);
      }
      await loadRef.current({ quietSince: savedUpTo });
      return res?.data;
    } catch (e) {
      // The write may have been refused because a column was frozen meanwhile.
      void queryClient.invalidateQueries({ queryKey: ['freeze-state', year] });
      throw e;
    }
  });

  // Each commit of the spread panel writes the spread: the amount on leaving the field, the
  // distribution and the dates on change. A blank or zero amount, or a period that does not
  // work, writes nothing.
  const commitSpread = (next: { amount?: number | ''; profile?: 'flat' | '4-4-5'; dates?: Period; also?: AmountCol[] } = {}) => {
    const typed = next.amount !== undefined ? next.amount : spreadAmount;
    const dates = next.dates ?? spreadPeriod;
    const amount = Number(typed || 0);
    if (!amount || spreadFrozen || periodProblem(year, dates.start, dates.end)) return;
    // Totals in cents, sent as two-decimal strings: no float sum reaches the server.
    const totals: Record<string, string> = { [spreadMeasure]: centsToDecimal(toCents(amount)) };
    (next.also ?? alsoSpread).forEach((col) => { totals[col] = centsToDecimal(currentCents(col)); });
    committedAmountRef.current = typed;
    setError(null);
    writePanel({
      kind: 'annual',
      year,
      totals,
      spread_profile_name: next.profile ?? spreadProfile,
      period_start: dates.start,
      period_end: dates.end,
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

  // Every complete line of the panel's column, and of the group's columns when asked.
  const saveLines = async (measure: AmountCol, lines: LinePayload[], toAllColumns: boolean): Promise<LinesSaveResult> => {
    const also = toAllColumns && offerApplyToAll ? groupOthers.map((c) => c.measure) : [];
    const body: LinesRequest = { kind: 'lines', year, measure, lines, ...(also.length > 0 ? { also_measures: also } : {}) };
    try {
      const data = await writePanel(body);
      return { ok: true, warnings: Array.isArray(data?.warnings) ? data!.warnings : undefined };
    } catch (e) {
      if (e instanceof UnsavedEditsError) return { ok: false, error: t(`${config.i18nPrefix}.budget.failedToSave`) };
      return { ok: false, error: getApiErrorMessage(e, t, t('budgetTab.lines.saveFailed')) };
    }
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
  const gridColumns = shown.map((c) => ({ col: c.measure, fr: frozen[c.freezeKey] }));
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
      {(spreadProblem || zeroedText || spreadBeyondItem || spreadFrozen) && (
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
            frozen={spreadFrozen}
            frozenHint={t(`${config.i18nPrefix}.budget.someColumnsFrozen`)}
            payingCompanyCountry={payingCompanyCountry}
            columnName={labelFor}
            applyToAll={{ offered: offerApplyToAll, on: linesAllColumns, hint: applyToAllHint, onChange: setLinesAllColumns }}
            onSave={(lines, toAllColumns) => saveLines(spreadMeasure, lines, toAllColumns)}
          />
        </>
      )}
    </Box>
  );

  return (
    <Stack spacing={2.5} sx={{ pt: 1 }}>
      {!!error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

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
              return (
                <Box key={m.measure} sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                  {/* The label, then the column's two panels at its right, as wide as the field below. */}
                  <Box data-testid={`column-title-${m.measure}`} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, maxWidth: 220, minHeight: 18 }}>
                    <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary', display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                      {m.label}
                      {isFrozen && <LockOutlinedIcon sx={{ fontSize: 12 }} />}
                    </Typography>
                    {loaded && !isFrozen && !loading && (
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
                    InputProps={{ readOnly: isFrozen }}
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
                {gridColumns.map(({ col, fr }) => {
                  const record = loadedYear === year ? recordFor(col) : undefined;
                  const chip = chipOf(record);
                  return (
                    <Box component="th" key={col} sx={headCellSx}>
                      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, justifyContent: 'flex-end' }}>
                        {labelFor(col)}
                        {fr ? (
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
                        {gridColumns.map(({ col, fr }) => (
                          <Box component="td" key={col} sx={{ px: 0.5, py: '2px' }}>
                            <FormattedNumberField
                              value={months[mi]?.[col] ?? 0}
                              onChange={(e) => onMonthChange(mi, col, e.target.value as unknown as number | '')}
                              variant="standard" size="small" fullWidth
                              disabled={loading || fr}
                              InputProps={{ readOnly: fr }}
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
