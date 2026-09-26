import React, { forwardRef, useImperativeHandle } from 'react';
import { Alert, Box, Button, FormControlLabel, IconButton, MenuItem, Stack, Switch, Tab, Tabs, TextField, Tooltip, Typography } from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import BackspaceOutlinedIcon from '@mui/icons-material/BackspaceOutlined';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { useLocale } from '../../i18n/useLocale';
import { formatAmount } from '../../i18n/formatters';
import { useFreezeState } from '../../hooks/useFreezeState';
import useAutosave from '../../hooks/useAutosave';
import YearTabs from '../navigation/YearTabs';
import FormattedNumberField from '../inputs/FormattedNumberField';
import { drawerMenuItemSx, drawerSelectSx, tableCellFieldSx, tealLinkSx } from '../../theme/formSx';
import DateEUField from '../fields/DateEUField';
import { FieldLabel } from '../design';
import BudgetTrendChart from './BudgetTrendChart';
import { FinanceModuleConfig } from './config';
import { patchYearlyTotalsCache } from './yearlyTotals';
import {
  AmountMeasure,
  PLANNING_MEASURES,
  Period,
  PlanningMeasure,
  RoundInput,
  activeMonths,
  centsToDecimal,
  chipText,
  columnLabel,
  isPlanningMeasure,
  joinList,
  periodForEdit,
  periodProblem,
  periodText,
  suggestedPeriod,
  toCents,
  wholeYear,
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
};

type Version = { id: string; input_grain: 'annual' | 'quarterly' | 'monthly'; budget_year?: number };

type MeasureKey = 'planned' | 'committed' | 'actual' | 'expected_landing';
type AmountCol = AmountMeasure;

type AmountRow = Record<AmountCol, number> & { period: string };

type YearAmounts = {
  items: Array<Partial<Record<AmountCol, number | string>> & { period: string }>;
  totals: Record<MeasureKey | 'forecast', number>;
  year: number;
  round_inputs?: RoundInput[];
};

type BulkUpsertResponse = { updated?: number; round_inputs?: RoundInput[] };

type FreezeKey = 'budget' | 'revision' | 'forecast' | 'actual' | 'landing';

const MEASURES: Array<{ key: MeasureKey; freezeKey: FreezeKey }> = [
  { key: 'planned', freezeKey: 'budget' },
  { key: 'committed', freezeKey: 'revision' },
  { key: 'actual', freezeKey: 'actual' },
  { key: 'expected_landing', freezeKey: 'landing' },
];

const ALL_COLS: AmountCol[] = ['planned', 'committed', 'actual', 'expected_landing', 'forecast'];
/** Spread panel column order. */
const SPREAD_COLS: AmountCol[] = ['planned', 'committed', 'forecast', 'expected_landing', 'actual'];
const NO_STORED_AMOUNTS: Record<PlanningMeasure, boolean> = { planned: false, committed: false, forecast: false, expected_landing: false };

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
const FREEZE_KEY: Record<AmountCol, FreezeKey> = {
  planned: 'budget', committed: 'revision', actual: 'actual', expected_landing: 'landing', forecast: 'forecast',
};

function monthPeriod(year: number, m: number) { return `${year}-${String(m).padStart(2, '0')}-01`; }
function emptyMonths(year: number): AmountRow[] {
  return Array.from({ length: 12 }, (_, i) => ({
    period: monthPeriod(year, i + 1), planned: 0, committed: 0, actual: 0, expected_landing: 0, forecast: 0,
  }));
}
const QUARTERS = [
  { label: 'Q1', months: [0, 1, 2] },
  { label: 'Q2', months: [3, 4, 5] },
  { label: 'Q3', months: [6, 7, 8] },
  { label: 'Q4', months: [9, 10, 11] },
];

export default forwardRef<BudgetTabHandle, Props>(function BudgetTab({ id, year, currency, availableYears, onYearChange, config, effectiveStart, endOfValidity }, ref) {
  const { t } = useTranslation(['ops', 'common']);
  const locale = useLocale();
  const queryClient = useQueryClient();

  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [version, setVersion] = React.useState<Version | null>(null);
  const [mode, setMode] = React.useState<'flat' | 'monthly'>('flat');
  const [flat, setFlat] = React.useState<Record<MeasureKey, number | ''>>({ planned: '', committed: '', actual: '', expected_landing: '' });
  const [months, setMonths] = React.useState<AmountRow[]>(() => emptyMonths(year));
  // Overlay the chart only once this `year`'s amounts are in local state — otherwise
  // a year-tab switch would paint the previous year's figures onto the new year.
  const [loadedYear, setLoadedYear] = React.useState<number | null>(null);
  // How each column was produced and over which period, as stored.
  const [roundInputs, setRoundInputs] = React.useState<RoundInput[]>([]);
  // Columns that held a non-zero month when loaded: without a stored period they read as the whole year.
  const [storedAmounts, setStoredAmounts] = React.useState<Record<PlanningMeasure, boolean>>(NO_STORED_AMOUNTS);

  // Spread panel state. `spreadDates` is null until the user edits a date: the
  // column's own period is shown until then.
  const [spreadMeasure, setSpreadMeasure] = React.useState<AmountCol>('planned');
  const [spreadAmount, setSpreadAmount] = React.useState<number | ''>('');
  const [spreadProfile, setSpreadProfile] = React.useState<'flat' | '4-4-5'>('flat');
  const spreadMeasureRef = React.useRef(spreadMeasure); spreadMeasureRef.current = spreadMeasure;
  const [spreadDates, setSpreadDates] = React.useState<Period | null>(null);
  const [spreadBusy, setSpreadBusy] = React.useState(false);
  // On by default: the panel's period and distribution go to every planning column.
  const [spreadAllColumns, setSpreadAllColumns] = React.useState(true);
  // The yearly view shows the panel only when asked for, on one column.
  const [panelOpen, setPanelOpen] = React.useState(false);

  const suggestion = React.useMemo(() => suggestedPeriod(year, effectiveStart, endOfValidity), [year, effectiveStart, endOfValidity]);
  const periodFor = React.useCallback((measure: AmountCol, inputs: RoundInput[], stored: Record<PlanningMeasure, boolean>): Period | null => {
    if (!isPlanningMeasure(measure)) return wholeYear(year);
    return periodForEdit(year, inputs.find((r) => r.measure === measure), stored[measure], suggestion);
  }, [year, suggestion]);

  const { data: freezeData } = useFreezeState(year);
  const frozen = React.useMemo(() => {
    const s = freezeData?.summary?.scopes?.[config.freezeScope];
    return {
      budget: s?.budget?.frozen ?? false,
      revision: s?.revision?.frozen ?? false,
      forecast: s?.forecast?.frozen ?? false,
      actual: s?.actual?.frozen ?? false,
      landing: s?.landing?.frozen ?? false,
    };
  }, [freezeData, config.freezeScope]);
  const anyFrozen = frozen.budget || frozen.revision || frozen.forecast || frozen.actual || frozen.landing;

  const autosave = useAutosave({ onError: (e) => setError(getApiErrorMessage(e, t, t(`${config.i18nPrefix}.budget.failedToSave`))) });

  // Latest-value refs so the debounced persist never reads stale state.
  const modeRef = React.useRef(mode); modeRef.current = mode;
  const flatRef = React.useRef(flat); flatRef.current = flat;
  const monthsRef = React.useRef(months); monthsRef.current = months;
  const versionRef = React.useRef(version); versionRef.current = version;
  const frozenRef = React.useRef(frozen); frozenRef.current = frozen;
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
  const dirtyTotalsRef = React.useRef(new Set<MeasureKey>());
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

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<Version[]>(`${config.itemsApi}/${id}/versions`);
      const v = (res.data || []).find((vv) => Number(vv.budget_year) === year);
      setSpreadDates(null);
      if (!v) {
        setVersion(null);
        setMode('flat');
        setFlat({ planned: '', committed: '', actual: '', expected_landing: '' });
        setMonths(emptyMonths(year));
        setRoundInputs([]);
        setStoredAmounts(NO_STORED_AMOUNTS);
        setSpreadAmount('');
        resetDirty();
        setLoadedYear(year);
        return;
      }
      setVersion(v);
      setMode(v.input_grain === 'annual' ? 'flat' : 'monthly');
      const amt = await api.get<YearAmounts>(`${config.versionsApi}/${v.id}/amounts`, { params: { year } });
      const totals = amt.data?.totals;
      setFlat({
        planned: Number(totals?.planned || 0),
        committed: Number(totals?.committed || 0),
        actual: Number(totals?.actual || 0),
        expected_landing: Number(totals?.expected_landing || 0),
      });
      const byPeriod = new Map((amt.data?.items || []).map((r) => [r.period, r]));
      const loadedMonths = Array.from({ length: 12 }, (_, i) => {
        const p = monthPeriod(year, i + 1);
        const found = byPeriod.get(p);
        const num = (k: AmountCol) => Number((found?.[k] as any) || 0);
        return found
          ? { period: p, planned: num('planned'), committed: num('committed'), actual: num('actual'), expected_landing: num('expected_landing'), forecast: num('forecast') }
          : { period: p, planned: 0, committed: 0, actual: 0, expected_landing: 0, forecast: 0 };
      });
      setMonths(loadedMonths);
      const hasAmounts = (m: PlanningMeasure) => loadedMonths.some((row) => row[m] !== 0);
      setStoredAmounts({
        planned: hasAmounts('planned'),
        committed: hasAmounts('committed'),
        forecast: hasAmounts('forecast'),
        expected_landing: hasAmounts('expected_landing'),
      });
      const loadedInputs = Array.isArray(amt.data?.round_inputs) ? amt.data.round_inputs : [];
      setRoundInputs(loadedInputs);
      setSpreadProfile(profileOf(spreadMeasureRef.current, loadedInputs));
      setSpreadAmount(amountOrEmpty(monthsCents(loadedMonths, spreadMeasureRef.current)));
      resetDirty();
      setLoadedYear(year);
    } catch (e) {
      setError(getApiErrorMessage(e, t, t(`${config.i18nPrefix}.budget.failedToLoad`)));
    } finally {
      setLoading(false);
    }
  }, [id, year, t]);

  React.useEffect(() => { void load(); }, [load]);
  // A year switch closes the panel: its total belongs to the previous year.
  React.useEffect(() => {
    setPanelOpen(false);
    setSpreadAmount('');
  }, [year]);

  // Persist the edited totals (flat) or cells (monthly), creating the version on
  // first edit. Frozen measures are never sent.
  const persist = React.useCallback(async () => {
    const fr = frozenRef.current;
    const flatMode = modeRef.current === 'flat';
    // Snapshot and clear: edits typed while this save is in flight stay dirty
    // for the next one; a failed save puts its snapshot back.
    const totalsSnapshot = flatMode ? dirtyTotalsRef.current : new Set<MeasureKey>();
    const cellsSnapshot = flatMode ? new Map<string, Set<AmountCol>>() : dirtyCellsRef.current;
    if (flatMode) dirtyTotalsRef.current = new Set(); else dirtyCellsRef.current = new Map();
    // Totals not saved yet; a request that succeeds takes its own out.
    const unsavedTotals = new Set(totalsSnapshot);
    try {
      const bodies: Array<{ body: Record<string, unknown>; measures: MeasureKey[] }> = [];
      if (flatMode) {
        // A yearly total is spread flat over its column's period: one request
        // per period (in practice one).
        const f = flatRef.current;
        const groups = new Map<string, { period: Period; totals: Partial<Record<MeasureKey, number>> }>();
        MEASURES.forEach((m) => {
          if (!totalsSnapshot.has(m.key) || fr[m.freezeKey]) return;
          const period = periodForRef.current(m.key, roundInputsRef.current, storedAmountsRef.current);
          if (!period) return;
          const key = `${period.start}|${period.end}`;
          const group = groups.get(key) ?? { period, totals: {} };
          group.totals[m.key] = Number(f[m.key] || 0);
          groups.set(key, group);
        });
        groups.forEach(({ period, totals }) => bodies.push({
          body: { kind: 'annual', year, totals, period_start: period.start, period_end: period.end },
          measures: Object.keys(totals) as MeasureKey[],
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
  // Save every unsaved edit now, including one whose earlier save failed
  // (autosave drops a failed save). False if the save fails.
  const flushEdits = React.useCallback(async () => {
    if (hasUnsavedEdits() && !autosave.isBusy()) autosave.schedule(persist);
    return autosave.flush();
  }, [autosave, persist]);

  // Flush pending edits before switching year so nothing is lost on reload.
  const handleYearChange = React.useCallback(async (y: number) => {
    if (!(await flushEdits())) return;
    onYearChange(y);
  }, [flushEdits, onYearChange]);

  useImperativeHandle(ref, () => ({
    flush: flushEdits,
    isDirty: () => autosave.isBusy() || hasUnsavedEdits(),
  }), [autosave, flushEdits]);

  const onFlatChange = (key: MeasureKey, value: number | '') => {
    setFlat((prev) => ({ ...prev, [key]: value }));
    dirtyTotalsRef.current.add(key);
    scheduleSave();
  };
  const onMonthChange = (idx: number, key: AmountCol, value: number | '') => {
    setMonths((prev) => { const next = [...prev]; next[idx] = { ...next[idx], [key]: Number(value || 0) }; return next; });
    markCellDirty(monthPeriod(year, idx + 1), key);
    scheduleSave();
  };
  // Clear every month for a column — convenient when entering a cash-out plan manually
  // (e.g. the whole amount in a single month).
  const clearColumn = (key: AmountCol) => {
    setMonths((prev) => prev.map((m) => ({ ...m, [key]: 0 })));
    for (let m = 1; m <= 12; m++) markCellDirty(monthPeriod(year, m), key);
    scheduleSave();
  };
  const onModeChange = React.useCallback(async (next: 'flat' | 'monthly') => {
    if (next === modeRef.current) return;
    // Persist any pending edits in the current mode first, then switch the grain and
    // resync from the backend so the new view reflects stored data (no stale overwrite).
    // If they cannot be saved, stay: the reload would discard them.
    if (!(await flushEdits())) return;
    setMode(next);
    setPanelOpen(false);
    const v = versionRef.current;
    if (!v) return; // no version yet — grain persists on first edit
    try {
      await api.patch(`${config.itemsApi}/${id}/versions`, { id: v.id, input_grain: next === 'flat' ? 'annual' : 'monthly' });
      await load();
    } catch (e) {
      setError(getApiErrorMessage(e, t, t(`${config.i18nPrefix}.budget.failedToSave`)));
    }
  }, [flushEdits, id, load, t]);

  // The period the panel shows: what the user typed, else the column's own period.
  const spreadPeriod: Period = spreadDates
    ?? periodFor(spreadMeasure, roundInputs, storedAmounts)
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
    mode === 'flat' && col !== 'forecast' ? toCents(flat[col as MeasureKey]) : monthsCents(months, col)
  );

  const onSpreadMeasureChange = (measure: AmountCol) => {
    setSpreadMeasure(measure);
    setSpreadDates(null);
    setSpreadProfile(profileOf(measure, roundInputs));
    setSpreadAmount(amountOrEmpty(currentCents(measure)));
  };
  // Back to a flat spread of the column's current total over the whole year. Writes nothing.
  const resetSpread = () => {
    setSpreadAmount(amountOrEmpty(currentCents(spreadMeasure)));
    setSpreadProfile('flat');
    setSpreadDates(wholeYear(year));
  };

  // With "Apply to all columns", the other planning columns that are not frozen
  // are spread with their own current total. Actuals never are.
  const spreadToAll = spreadAllColumns && spreadMeasure !== 'actual';
  const otherPlanning = PLANNING_MEASURES
    .filter((col) => col !== spreadMeasure)
    .sort((a, b) => SPREAD_COLS.indexOf(a) - SPREAD_COLS.indexOf(b));
  const alsoSpread = spreadToAll ? otherPlanning.filter((col) => !frozen[FREEZE_KEY[col]]) : [];
  const frozenLeft = spreadToAll ? otherPlanning.filter((col) => frozen[FREEZE_KEY[col]]) : [];
  const onSpreadDateChange = (bound: 'start' | 'end', value: string) => {
    setSpreadDates({ ...spreadPeriod, [bound]: value });
  };
  // Yearly view: open the panel on one column with its current total.
  const openSpreadPanel = (measure: MeasureKey) => {
    setSpreadMeasure(measure);
    setSpreadDates(null);
    setSpreadProfile(profileOf(measure, roundInputs));
    setSpreadAmount(amountOrEmpty(toCents(flat[measure])));
    setPanelOpen(true);
  };
  const closeSpreadPanel = () => {
    setPanelOpen(false);
    setSpreadDates(null);
    setSpreadAmount('');
  };

  // Nothing is written before Apply. From the monthly view the grid switches to
  // monthly as before; from the yearly view it stays there.
  const applySpread = async () => {
    const amount = Number(spreadAmount || 0);
    if (!amount || spreadProblem || spreadFrozen) return;
    // Totals in cents, sent as two-decimal strings: no float sum reaches the server.
    const totals: Record<string, string> = { [spreadMeasure]: centsToDecimal(toCents(amount)) };
    alsoSpread.forEach((col) => { totals[col] = centsToDecimal(currentCents(col)); });
    const fromYearly = modeRef.current === 'flat';
    setError(null);
    setSpreadBusy(true);
    try {
      // Save pending edits first: the reload below replaces the grid.
      if (!(await flushEdits())) return;
      const v = await ensureVersion();
      const res = await api.post<BulkUpsertResponse>(`${config.versionsApi}/${v.id}/amounts/bulk-upsert`, {
        kind: 'annual',
        year,
        totals,
        spread_profile_name: spreadProfile,
        period_start: spreadPeriod.start,
        period_end: spreadPeriod.end,
      });
      keepRoundInputs(res?.data);
      if (fromYearly) {
        setPanelOpen(false);
      } else {
        if (v.input_grain !== 'monthly') {
          await api.patch(`${config.itemsApi}/${id}/versions`, { id: v.id, input_grain: 'monthly' });
        }
        setMode('monthly');
      }
      setSpreadAmount('');
      await load();
    } catch (e) {
      setError(getApiErrorMessage(e, t, t(`${config.i18nPrefix}.budget.failedToSave`)));
    } finally {
      setSpreadBusy(false);
    }
  };

  // Totals: flat values in flat mode, live column sums in monthly mode.
  const totals = React.useMemo<Record<AmountCol, number>>(() => {
    if (mode === 'flat') {
      return {
        planned: Number(flat.planned || 0), committed: Number(flat.committed || 0),
        actual: Number(flat.actual || 0), expected_landing: Number(flat.expected_landing || 0), forecast: 0,
      };
    }
    return months.reduce((acc, m) => {
      ALL_COLS.forEach((c) => { acc[c] += Number(m[c] || 0); });
      return acc;
    }, { planned: 0, committed: 0, actual: 0, expected_landing: 0, forecast: 0 } as Record<AmountCol, number>);
  }, [mode, flat, months]);

  const liveTotals = React.useMemo(() => ({
    planned: totals.planned,
    committed: totals.committed,
    actual: totals.actual,
    expected_landing: totals.expected_landing,
  }), [totals.planned, totals.committed, totals.actual, totals.expected_landing]);

  // Keep the yearly-totals query cache in sync so a year-tab switch does not snap
  // the previously edited year back to the value fetched on first paint.
  React.useEffect(() => {
    if (loadedYear !== year) return;
    patchYearlyTotalsCache(queryClient, config, id, year, liveTotals);
  }, [loadedYear, year, liveTotals, id, config, queryClient]);

  const fmt = (n: number) => formatAmount(n);

  const labelFor = (col: AmountCol) => columnLabel(t, col);
  const isFrozen = (m: typeof MEASURES[number]) => frozen[m.freezeKey];
  const gridColumns = ALL_COLS.map((col) => ({ col, fr: frozen[FREEZE_KEY[col]] }));
  const recordFor = (col: AmountCol) => roundInputs.find((r) => r.measure === col);
  const periodTextOf = (period: Period | null) => (period ? periodText(t, locale, activeMonths(year, period.start, period.end)) : '');

  const savingHint = autosave.status === 'saving' || autosave.status === 'pending'
    ? t('common:status.saving', 'Saving…')
    : autosave.status === 'saved' ? t('common:status.saved', 'Saved') : null;

  const numCellSx = { textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 13, color: 'kanap.text.primary', px: 1, py: 0 } as const;
  const headCellSx = { textAlign: 'right', fontSize: 11, fontWeight: 500, color: 'kanap.text.secondary', px: 1, py: 0.75, whiteSpace: 'nowrap', verticalAlign: 'top' } as const;
  const captionSx = { fontSize: 12, color: 'kanap.text.tertiary', lineHeight: 1.4 } as const;

  // Every control has its label above it, so the row sits on one baseline and wraps cleanly.
  const panelField = (label: string, width: number, control: React.ReactNode) => (
    <Box sx={{ display: 'flex', flexDirection: 'column', width }}>
      <FieldLabel sx={{ mb: '2px' }}>{label}</FieldLabel>
      {control}
    </Box>
  );
  const otherLabel = (col: AmountCol) => `${labelFor(col)} (${fmt(currentCents(col) / 100)})`;

  const spreadPanel = (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, bgcolor: 'kanap.bg.drawer', border: '1px solid', borderColor: 'kanap.border.soft', borderRadius: '8px', p: 1.5 }}>
      <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'kanap.text.tertiary' }}>{t(`${config.i18nPrefix}.budget.spreadHelper`)}</Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', columnGap: 1.5, rowGap: 1 }}>
        {panelField(t('budgetTab.column'), 150, (
          <TextField
            select size="small" variant="standard" value={spreadMeasure}
            onChange={(e) => onSpreadMeasureChange(e.target.value as AmountCol)}
            inputProps={{ 'aria-label': t('budgetTab.column') }}
            sx={drawerSelectSx}
          >
            {SPREAD_COLS.map((col) => <MenuItem key={col} value={col} sx={drawerMenuItemSx}>{labelFor(col)}</MenuItem>)}
          </TextField>
        ))}
        {panelField(t('budgetTab.amount'), 130, (
          <FormattedNumberField
            value={spreadAmount}
            onChange={(e) => setSpreadAmount(e.target.value as unknown as number | '')}
            variant="standard" size="small" fullWidth
            placeholder={t(`${config.i18nPrefix}.budget.spreadPlaceholder`)}
            inputProps={{ 'aria-label': t('budgetTab.amount') }}
          />
        ))}
        {panelField(t('budgetTab.distribution'), 120, (
          <TextField
            select size="small" variant="standard" value={spreadProfile}
            onChange={(e) => setSpreadProfile(e.target.value as 'flat' | '4-4-5')}
            inputProps={{ 'aria-label': t('budgetTab.distribution') }}
            sx={drawerSelectSx}
          >
            <MenuItem value="flat" sx={drawerMenuItemSx}>{t(`${config.i18nPrefix}.budget.profileFlat`)}</MenuItem>
            <MenuItem value="4-4-5" sx={drawerMenuItemSx}>{t(`${config.i18nPrefix}.budget.profile445`)}</MenuItem>
          </TextField>
        ))}
        <DateEUField label={t('budgetTab.from')} valueYmd={spreadPeriod.start} onChangeYmd={(v) => onSpreadDateChange('start', v)} size="small" sx={{ width: 150 }} />
        <DateEUField label={t('budgetTab.to')} valueYmd={spreadPeriod.end} onChangeYmd={(v) => onSpreadDateChange('end', v)} size="small" sx={{ width: 150 }} />
      </Box>
      <Box>
        {spreadProblem ? (
          <Typography sx={{ ...captionSx, color: 'error.main' }}>{t(`budgetTab.problem.${spreadProblem}`, { year })}</Typography>
        ) : (
          <Typography sx={{ ...captionSx, color: 'kanap.text.secondary' }}>
            {[periodText(t, locale, spreadActive), zeroedMonthsText(t, locale, spreadActive)].filter(Boolean).join('. ')}
          </Typography>
        )}
        {spreadBeyondItem && (
          <Typography sx={{ ...captionSx, color: 'warning.main' }}>{t('budgetTab.beyondItemDates')}</Typography>
        )}
        {spreadFrozen && (
          <Typography sx={captionSx}>{t(`${config.i18nPrefix}.budget.someColumnsFrozen`)}</Typography>
        )}
        <Typography sx={captionSx}>{t('budgetTab.convention')}</Typography>
      </Box>
      {spreadMeasure !== 'actual' && (
        <Box>
          <FormControlLabel
            control={<Switch size="small" checked={spreadAllColumns} onChange={(e) => setSpreadAllColumns(e.target.checked)} />}
            label={<Typography sx={{ fontSize: 13, color: 'kanap.text.primary' }}>{t('budgetTab.applyToAll')}</Typography>}
            sx={{ ml: 0 }}
          />
          {alsoSpread.length > 0 && (
            <Typography sx={{ ...captionSx, color: 'kanap.text.secondary' }} data-testid="spread-others">
              {t('budgetTab.alsoSpread', { count: alsoSpread.length, columns: joinList(t, alsoSpread.map(otherLabel)) })}
            </Typography>
          )}
          {frozenLeft.length > 0 && (
            <Typography sx={captionSx} data-testid="spread-frozen">
              {t('budgetTab.frozenUnchanged', { count: frozenLeft.length, columns: joinList(t, frozenLeft.map((col) => labelFor(col))) })}
            </Typography>
          )}
        </Box>
      )}
      <Stack direction="row" spacing={1} alignItems="center">
        <Button
          size="small" variant="contained"
          onClick={() => void applySpread()}
          disabled={!spreadAmount || !!spreadProblem || spreadFrozen || spreadBusy}
        >
          {t(`${config.i18nPrefix}.budget.spreadApply`)}
        </Button>
        <Button size="small" variant="action" onClick={resetSpread}>{t('budgetTab.reset')}</Button>
        {mode === 'flat' && (
          <Button size="small" onClick={closeSpreadPanel} sx={{ textTransform: 'none' }}>{t('common:buttons.cancel')}</Button>
        )}
      </Stack>
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
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 2.5 }}>
            {MEASURES.map((m) => {
              // Until this year's data is in, the previous year's periods would be read against this year.
              const planning = isPlanningMeasure(m.key) && loadedYear === year;
              const period = planning ? periodFor(m.key, roundInputs, storedAmounts) : null;
              const text = periodTextOf(period);
              // No stored period, no amounts and no month of the year within the item's dates.
              const noMonth = planning && !text;
              const chip = planning ? chipText(t, locale, recordFor(m.key)) : '';
              return (
                <Box key={m.key} sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                  <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    {labelFor(m.key)}
                    {isFrozen(m) && <LockOutlinedIcon sx={{ fontSize: 12 }} />}
                  </Typography>
                  <FormattedNumberField
                    value={flat[m.key]}
                    onChange={(e) => onFlatChange(m.key, (e.target.value as unknown as number | ''))}
                    variant="standard"
                    disabled={loading || isFrozen(m) || noMonth}
                    InputProps={{ readOnly: isFrozen(m) }}
                    sx={{ maxWidth: 220, '& .MuiInputBase-input': { fontSize: '15px !important', fontWeight: 500 } }}
                  />
                  {planning && (
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0.25 }}>
                      <Typography sx={captionSx} data-testid={`period-line-${m.key}`}>
                        {noMonth ? t('budgetTab.noMonthInItemDates', { year }) : [chip, text].filter(Boolean).join(' · ')}
                      </Typography>
                      {!isFrozen(m) && !loading && (
                        <Box component="button" type="button" sx={tealLinkSx} onClick={() => openSpreadPanel(m.key)}>
                          {noMonth ? t('budgetTab.choosePeriod') : t('budgetTab.changePeriod')}
                        </Box>
                      )}
                    </Box>
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
                  const record = isPlanningMeasure(col) && loadedYear === year ? recordFor(col) : undefined;
                  const chip = chipText(t, locale, record);
                  return (
                    <Box component="th" key={col} sx={headCellSx}>
                      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, justifyContent: 'flex-end' }}>
                        {labelFor(col)}
                        {fr ? (
                          <LockOutlinedIcon sx={{ fontSize: 12, color: 'kanap.text.tertiary' }} />
                        ) : (
                          <Tooltip title={t(`${config.i18nPrefix}.budget.clearColumn`)}>
                            <IconButton size="small" aria-label={t(`${config.i18nPrefix}.budget.clearColumn`)} onClick={() => clearColumn(col)} sx={{ p: '2px' }}>
                              <BackspaceOutlinedIcon sx={{ fontSize: 13 }} />
                            </IconButton>
                          </Tooltip>
                        )}
                      </Box>
                      {chip && record && (
                        <Tooltip title={periodTextOf({ start: record.period_start, end: record.period_end })}>
                          <Box sx={{ fontSize: 11, fontWeight: 400, color: 'kanap.text.tertiary', whiteSpace: 'normal', lineHeight: 1.3 }}>{chip}</Box>
                        </Tooltip>
                      )}
                    </Box>
                  );
                })}
              </Box>
            </Box>
            <Box component="tbody">
              {QUARTERS.map((q) => {
                const qTotals = ALL_COLS.reduce((acc, c) => {
                  acc[c] = q.months.reduce((s, mi) => s + Number(months[mi]?.[c] || 0), 0);
                  return acc;
                }, {} as Record<AmountCol, number>);
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
                      {ALL_COLS.map((c) => (
                        <Box component="td" key={c} sx={{ ...numCellSx, fontWeight: 500, color: 'kanap.text.secondary', py: 0.5 }}>{fmt(qTotals[c])}</Box>
                      ))}
                    </Box>
                  </React.Fragment>
                );
              })}
            </Box>
            <Box component="tfoot">
              <Box component="tr">
                <Box component="td" sx={{ fontSize: 12, fontWeight: 500, color: 'kanap.text.primary', px: 1, py: 0.75 }}>{t(`${config.i18nPrefix}.budget.total`)}</Box>
                {ALL_COLS.map((c) => (
                  <Box component="td" key={c} sx={{ ...numCellSx, fontWeight: 500, py: 0.75 }}>{fmt(totals[c])}</Box>
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
