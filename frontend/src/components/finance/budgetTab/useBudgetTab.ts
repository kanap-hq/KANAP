import React, { useImperativeHandle } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { useAuth } from '../../../auth/AuthContext';
import type { ConflictChoice, EditConflict } from '../../../hooks/editConflicts';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { useLocale } from '../../../i18n/useLocale';
import { formatAmount } from '../../../i18n/formatters';
import { useFreezeState } from '../../../hooks/useFreezeState';
import { useBudgetColumns } from '../../../hooks/useBudgetColumns';
import useAutosave from '../../../hooks/useAutosave';
import { useKanapDialogs } from '../../design';
import type { FreezeColumn } from '../../../services/freeze';
import type { LinesSaveResult } from '../LinesPanel';
import { forgetAllocationsYear } from '../allocationsCache';
import { invalidateBudgetLists } from '../budgetFile';
import type { FinanceModuleConfig } from '../config';
import { patchYearlyTotalsCache } from '../yearlyTotals';
import { AMOUNT_COLUMNS } from '../amountColumns';
import { budgetConflictsOf, centsByColumn, monthsBase, unreadableConflict, type BudgetConflict } from '../budgetConflicts';
import { namesInSentence, type HeldBudgetChoices, type OpeningValues, type OpeningYear } from '../heldChoices';
import {
  AmountMeasure,
  LinePayload,
  LinesRequest,
  Period,
  RoundInput,
  centsToDecimal,
  columnPeriod,
  columnPeriodProblem,
  followsLines,
  hasLines,
  isOneDay,
  linePayloadOf,
  periodForEdit,
  periodMonths,
  suggestedPeriod,
  toCents,
  wholeYear,
} from '../roundPeriod';

/**
 * The Budget tab's state and writes (plan planning/budget-tab-redesign, lot F1). The screen is
 * built around one active column: its cards, how it is built (`ColumnMode`), then the read-only
 * monthly result. Every write path and the edit conflict contract of lot 3D are the ones the tab
 * had before: `serverMonthsRef` and `serverLinesRef` as the base of each write, the columns waiting
 * for the user's choice, the parked panel write and the choices the page keeps (`held`).
 */

export type BudgetTabHandle = {
  /** Saves what can go; false while a choice waits, unless `ignoreHeld` (a move that keeps the line and its choice). */
  flush: (options?: { ignoreHeld?: boolean }) => Promise<boolean>;
  isDirty: () => boolean;
  /** The columns waiting for the user's choice, as the tenant names them (for the leave warning). */
  waitingColumns: () => string[];
  /** A save is on its way or about to go (lot 3G: no read of what others changed meanwhile). */
  isSaving: () => boolean;
  /**
   * Something of the user would be lost or moved by a refresh: a month not saved yet, a choice
   * waiting, an amount or a period typed in the amount editor, a costed line not complete or not sent.
   */
  hasPending: () => boolean;
  /**
   * Shows the year as stored now (someone else changed it, lot 3G): a quiet reload, so a month
   * typed, not saved yet or waiting for a choice keeps its value and its base.
   */
  reloadFromServer: () => Promise<void>;
  /** Drops pending saves without sending them: the line was deleted. */
  discard: () => void;
};

export type BudgetTabProps = {
  id: string; // resolved finance item UUID
  /** False when the person's data access leaves the line read only (`editable: false`). */
  lineEditable?: boolean;
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
  /** The line's choices kept by the item page while the user is on another tab (`heldChoices.ts`). */
  held?: React.MutableRefObject<HeldBudgetChoices | null>;
  /**
   * The line's opening values, kept by the item page for the visit (`heldChoices.ts`): each year as
   * first read. Without it, the tab keeps them for as long as it is shown.
   */
  openings?: React.MutableRefObject<OpeningValues | null>;
  /**
   * The version counter of a year as this tab loaded or wrote it (null: the year has no version):
   * the item page then tells someone else's change from the tab's own saves (lot 3G).
   */
  onBudgetRev?: (year: number, budgetRev: number | null) => void;
};

export type AmountCol = AmountMeasure;

/**
 * How a column is built, as its editor shows it: one amount spread over a period, quantity and
 * price lines, or months typed one by one in the result table.
 */
export type ColumnMode = 'amount' | 'lines' | 'monthly';

/** The mode a column's stored record gives: computed from lines, edited by hand, else an amount (a spread, a copy, nothing yet). */
export function storedMode(record: RoundInput | null | undefined, cents: number): ColumnMode {
  if (record?.method === 'computed') return 'lines';
  // An empty column starts on an amount, whatever wrote its zeros.
  if (cents === 0) return 'amount';
  return record?.method === 'manual' ? 'monthly' : 'amount';
}

/** A mode change the user asked for on a column with amounts: confirmed in the editor first. `month`: the cell clicked. */
export type ModeSwitch = { col: AmountCol; to: ColumnMode; month?: number };

/** "When" of the amount editor: the whole year, a period of it, or a single date (its month takes it all). */
export type AmountWhen = 'year' | 'range' | 'date';

type Version = { id: string; input_grain: 'annual' | 'quarterly' | 'monthly'; budget_year?: number; budget_rev?: number };

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
  /** The version's counter after the write. */
  budget_rev?: number;
  /** A copy from another column (`kind: 'copy'`): months of the source outside the line's dates were left out. */
  copy?: { prorated?: boolean; from_lines?: boolean };
};

/**
 * A column waiting for the user's choice: refused by a monthly save, or by a panel write (an amount
 * or lines). `cells`: the months of a monthly entry that were refused, the only ones waiting (the
 * other months of the column go on); null: the whole column (a panel write).
 */
type WaitingColumn = BudgetConflict & { source: 'grid' | 'panel' | 'restore'; cells: Set<string> | null };

/** A panel write refused with a 409, kept until the user chose for each of its columns. */
type ParkedPanel = {
  body: Record<string, unknown>;
  /** The column the panel writes (its amount or its lines); « Reload » on it drops the write. */
  main: AmountCol;
  /** Every column the write touches: they stay read-only until it is sent or dropped. */
  columns: Set<AmountCol>;
};

/** How a restore of a column's opening values ended. */
type RestoreOutcome =
  | { status: 'restored' }
  | { status: 'conflict'; conflict: BudgetConflict | null }
  | { status: 'frozen' }
  | { status: 'refused'; message: string };

/** What « Back to the opening values » did, column by column: said under the years until closed. */
export type RestoreNotice = {
  /** Nothing was sent: what was under way could not be saved first. */
  notRun?: boolean;
  restored: AmountCol[];
  skipped: Array<
    | { col: AmountCol; reason: 'frozen' | 'waiting' }
    | { col: AmountCol; reason: 'changed'; conflict: BudgetConflict | null }
    | { col: AmountCol; reason: 'refused'; message: string }
    // Changed by someone else and never written by this screen: never sent. `at`: when, if its record says.
    | { col: AmountCol; reason: 'others'; at: string | null }
  >;
};

/** A column's record in what it says, without when or by whom it was written: two reads of the same record compare equal. */
function recordSignature(record: RoundInput | null | undefined): string {
  if (!record) return 'none';
  return JSON.stringify([
    record.method, record.period_start, record.period_end, record.spread_profile_name ?? null, record.fte ?? null,
    record.last_calculation ?? null, (record.lines ?? []).map(linePayloadOf),
  ]);
}

/** A year's columns as the server answered them: the opening values when it is the first read of the visit. */
function openingOf(year: number, snapshot: BudgetYear): OpeningYear {
  const cents = centsByColumn(year, snapshot.amounts?.items ?? []);
  const inputs = snapshot.amounts?.round_inputs ?? [];
  return {
    at: Date.now(),
    columns: perColumn((col) => {
      const record = inputs.find((r) => r.measure === col);
      // Sent back as read: a copy nothing else on screen can change.
      return { months: [...cents[col]], record: record ? JSON.parse(JSON.stringify(record)) as RoundInput : null };
    }),
    written: {},
  };
}

/** How a panel write ended: saved, refused for a choice the user must make, or not sent (a column waits for one). */
type PanelOutcome = { status: 'saved'; data: BulkUpsertResponse | undefined } | { status: 'conflict' } | { status: 'waiting' };

/** A panel write, built when it leaves the queue: it reads the lines and months as they are then. */
type PanelWrite = { body: Record<string, unknown> | LinesRequest; columns: AmountCol[]; linesBase?: LinePayload[] };

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
export const ALL_COLS: AmountCol[] = AMOUNT_COLUMNS.map((c) => c.measure);
const FREEZE_KEY = Object.fromEntries(AMOUNT_COLUMNS.map((c) => [c.measure, c.freezeKey])) as Record<AmountCol, FreezeColumn>;
const perColumn = <V,>(value: (col: AmountCol) => V) => Object.fromEntries(ALL_COLS.map((col) => [col, value(col)])) as Record<AmountCol, V>;
const NO_STORED_AMOUNTS = perColumn(() => false);
const zeroMonths = () => perColumn(() => Array.from({ length: 12 }, () => 0));
const monthIndexOf = (period: string) => Number(period.slice(5, 7)) - 1;
const yearPeriodsOf = (year: number) => Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}-01`);
const sumCents = (months: readonly number[]) => months.reduce((sum, cents) => sum + cents, 0);

/** A panel write stopped before sending: the monthly edits before it could not be saved. */
class UnsavedEditsError extends Error {}

/** A column's yearly total in cents, summed month by month. */
function monthsCents(rows: AmountRow[], col: AmountCol): number {
  return rows.reduce((sum, row) => sum + toCents(row[col]), 0);
}

/** The amount field: the total, or empty when it is zero. */
function amountOrEmpty(cents: number): number | '' {
  return cents === 0 ? '' : cents / 100;
}

/** The distribution the amount editor starts with: the column's own, so a period change keeps its shape. */
function profileOf(measure: AmountCol, inputs: RoundInput[]): 'flat' | '4-4-5' {
  return inputs.find((r) => r.measure === measure)?.spread_profile_name === '4-4-5' ? '4-4-5' : 'flat';
}
export function monthPeriod(year: number, m: number) { return `${year}-${String(m).padStart(2, '0')}-01`; }
function emptyMonths(year: number): AmountRow[] {
  return Array.from({ length: 12 }, (_, i) => ({ period: monthPeriod(year, i + 1), ...perColumn(() => 0) }));
}
const isWholeYear = (year: number, period: Period) => period.start === `${year}-01-01` && period.end === `${year}-12-31`;

/** Where the focus goes once the next render is drawn: the amount field, or a month of the editable column. */
type FocusRequest = { kind: 'amount' } | { kind: 'cell'; month: number };

export function useBudgetTab(props: BudgetTabProps, ref: React.ForwardedRef<BudgetTabHandle>) {
  const { id, year, onYearChange, config, effectiveStart, endOfValidity, held, openings, onBudgetRev, lineEditable = true } = props;
  const { t } = useTranslation(['ops', 'common']);
  const locale = useLocale();
  const queryClient = useQueryClient();
  const budgetColumns = useBudgetColumns();
  const { shown, group } = budgetColumns;
  const dialogs = useKanapDialogs();
  const { profile, hasLevel } = useAuth();
  const userId = profile?.id ?? null;
  // A budget reader reads the columns, with no field to change them; so does a person whose data
  // access leaves the line read only.
  const readOnly = !hasLevel('budget', 'member') || !lineEditable;
  // Read only because the line is outside the person's edit access, not because of their role.
  const readOnlyInAccess = hasLevel('budget', 'member') && !lineEditable;
  // The counters this tab loaded or wrote (lot 3G).
  const onBudgetRevRef = React.useRef(onBudgetRev); onBudgetRevRef.current = onBudgetRev;
  const noteRev = (forYear: number, rev: number | null | undefined) => { if (rev !== undefined) onBudgetRevRef.current?.(forYear, rev); };

  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [version, setVersion] = React.useState<Version | null>(null);
  const [months, setMonths] = React.useState<AmountRow[]>(() => emptyMonths(year));
  // Overlay the chart only once this `year`'s amounts are in local state: otherwise
  // a year-tab switch would paint the previous year's figures onto the new year.
  const [loadedYear, setLoadedYear] = React.useState<number | null>(null);
  const loaded = loadedYear === year;
  // How each column was produced and over which period, as stored.
  const [roundInputs, setRoundInputs] = React.useState<RoundInput[]>([]);
  // Columns that held a non-zero month when loaded: without a stored period they read as the whole year.
  const [storedAmounts, setStoredAmounts] = React.useState<Record<AmountCol, boolean>>(NO_STORED_AMOUNTS);
  // A column's stored record (its period, how it was produced, its lines), as loaded or written.
  const recordFor = (col: AmountCol) => roundInputs.find((r) => r.measure === col);

  const { data: freezeData } = useFreezeState(year);
  const frozen = React.useMemo(() => {
    const s = freezeData?.summary?.scopes?.[config.freezeScope];
    return Object.fromEntries(AMOUNT_COLUMNS.map((c) => [c.freezeKey, s?.[c.freezeKey]?.frozen ?? false])) as Record<FreezeColumn, boolean>;
  }, [freezeData, config.freezeScope]);
  const isFrozen = (col: AmountCol) => frozen[FREEZE_KEY[col]];
  const anyFrozen = shown.some((c) => frozen[c.freezeKey]);

  // The active column: the one the user picked, else the first shown column that is not frozen
  // (the first one when all are). Nothing depends on a column's name.
  const [pickedCol, setPickedCol] = React.useState<AmountCol | null>(null);
  const firstOpen = (shown.find((c) => !frozen[c.freezeKey]) ?? shown[0]).measure;
  const activeCol: AmountCol = pickedCol && shown.some((c) => c.measure === pickedCol) ? pickedCol : firstOpen;
  const activeColRef = React.useRef(activeCol); activeColRef.current = activeCol;
  // Once the user works on the active column, it stays active (a freeze state arriving late does not move it).
  const pinActive = () => setPickedCol((prev) => prev ?? activeColRef.current);

  // The amount editor of the active column. `spreadDates` is null until the user edits a date: the
  // column's own period is shown until then; `spreadWhen` is null until the user picks "When".
  const [spreadAmount, setSpreadAmount] = React.useState<number | ''>('');
  const spreadAmountRef = React.useRef(spreadAmount); spreadAmountRef.current = spreadAmount;
  const [spreadProfile, setSpreadProfile] = React.useState<'flat' | '4-4-5'>('flat');
  const [spreadDates, setSpreadDates] = React.useState<Period | null>(null);
  const [spreadWhen, setSpreadWhen] = React.useState<AmountWhen | null>(null);
  // The amount as last loaded or written: leaving the field without changing it writes nothing.
  const committedAmountRef = React.useRef<number | ''>('');

  // The mode each column shows when the user picked one (cleared with the year); else its stored mode.
  const [modeChoice, setModeChoice] = React.useState<Partial<Record<AmountCol, ColumnMode>>>({});
  const modeChoiceRef = React.useRef(modeChoice); modeChoiceRef.current = modeChoice;
  const chooseMode = (col: AmountCol, mode: ColumnMode) => setModeChoice((prev) => (prev[col] === mode ? prev : { ...prev, [col]: mode }));
  // A mode change waiting for its confirmation in the editor.
  const [modeSwitch, setModeSwitch] = React.useState<ModeSwitch | null>(null);
  // « Use for other columns too »: the boxes are open, and the columns ticked.
  const [alsoOpen, setAlsoOpen] = React.useState(false);
  const [alsoChecked, setAlsoChecked] = React.useState<AmountCol[]>([]);

  const focusRef = React.useRef<FocusRequest | null>(null);
  const [focusTick, setFocusTick] = React.useState(0);
  const requestFocus = (target: FocusRequest) => { focusRef.current = target; setFocusTick((n) => n + 1); };
  const amountInputRef = React.useRef<HTMLInputElement | null>(null);
  // The inputs of the column typed month by month, by month index.
  const cellInputsRef = React.useRef(new Map<number, HTMLInputElement>());
  const registerCell = React.useCallback((month: number, el: HTMLInputElement | null) => {
    if (el) cellInputsRef.current.set(month, el); else cellInputsRef.current.delete(month);
  }, []);
  // Asked for in an event, tried once on the render that draws it: never at page load (charter).
  React.useEffect(() => {
    const target = focusRef.current;
    if (!target) return;
    focusRef.current = null;
    const el = target.kind === 'amount' ? amountInputRef.current : cellInputsRef.current.get(target.month);
    if (!el || el.disabled) return;
    el.focus();
    if (target.kind === 'cell') el.select();
  }, [focusTick]);

  // Panel writes (amounts and lines) run one after the other, so a response never overwrites a newer one.
  const chainRef = React.useRef<Promise<unknown>>(Promise.resolve());
  const [writesPending, setWritesPending] = React.useState(0);
  const writesPendingRef = React.useRef(0);

  const suggestion = React.useMemo(() => suggestedPeriod(year, effectiveStart, endOfValidity), [year, effectiveStart, endOfValidity]);
  // A column's own period: shown on its card.
  const periodFor = React.useCallback((measure: AmountCol, inputs: RoundInput[], stored: Record<AmountCol, boolean>): Period | null => {
    return columnPeriod(year, inputs.find((r) => r.measure === measure), stored[measure], suggestion);
  }, [year, suggestion]);

  // Edit conflicts (plan planning/perf-scale, lot 3D): every save says what the user's edit started
  // from, read here when it is sent. `serverMonthsRef` is the year as last known on the server, in
  // cents per column: loaded, or written by this screen. A reload never moves a month the user is
  // typing, has not saved yet or waits a choice on, so a save's base stays what the screen showed
  // when the edit began, or what this screen's previous save of the month wrote.
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
  // Restores of the opening values refused with a 409, one per column, kept for the choice.
  const parkedRestoresRef = React.useRef(new Map<AmountCol, Record<string, unknown>>());
  const [resolving, setResolving] = React.useState(false);
  // Bumped by « Reload the column » on a panel write: the lines panel starts again from the stored lines.
  const [linesReload, setLinesReload] = React.useState(0);
  // Any choice waiting in the column (a panel write, or some of its months): nothing writes the
  // whole column meanwhile.
  const isWaiting = React.useCallback((col: AmountCol) => (
    waitingRef.current.some((c) => c.measure === col) || !!parkedPanelRef.current?.columns.has(col)
  ), []);
  // This month of the column waits for a choice (a refused month, or the whole column).
  const isCellWaiting = React.useCallback((period: string, col: AmountCol) => {
    if (parkedPanelRef.current?.columns.has(col)) return true;
    const entry = waitingRef.current.find((c) => c.measure === col);
    return !!entry && (entry.cells === null || entry.cells.has(period));
  }, []);
  // The whole column waits (a refused panel write), not only some of its months.
  const isColumnWaiting = React.useCallback((col: AmountCol) => (
    !!parkedPanelRef.current?.columns.has(col) || waitingRef.current.some((c) => c.measure === col && c.cells === null)
  ), []);
  // The choices this tab left waiting when the user went to another tab of the line: given back by the
  // first loads of the year (the cached one, then its refresh), then forgotten.
  const restoreRef = React.useRef<HeldBudgetChoices | null>(
    held?.current && held.current.lineId === id ? held.current : null,
  );

  // The opening values (lot F2): every column of each year as first read during the visit, kept by
  // the item page (a tab or year change keeps them, a reload of the page does not).
  const ownOpenings = React.useRef<OpeningValues | null>(null);
  const openingsRef = openings ?? ownOpenings;
  const [, setOpeningTick] = React.useState(0);
  // A year shown from the cache, until its refresh comes back: the opening values if a write goes first.
  const openingCandidateRef = React.useRef<{ year: number; snapshot: BudgetYear } | null>(null);
  const openingOfYear = (forYear: number): OpeningYear | null => (
    openingsRef.current?.lineId === id ? openingsRef.current.years.get(forYear) ?? null : null
  );
  const noteOpening = (forYear: number, snapshot: BudgetYear) => {
    if (openingOfYear(forYear)) return;
    if (openingsRef.current?.lineId !== id) openingsRef.current = { lineId: id, years: new Map() };
    openingsRef.current!.years.set(forYear, openingOf(forYear, snapshot));
    setOpeningTick((n) => n + 1);
  };
  // A write is about to go: the year's opening values are known before it (from the cache when its refresh has not come back).
  const noteOpeningBeforeWrite = (forYear: number) => {
    const candidate = openingCandidateRef.current;
    if (candidate && candidate.year === forYear) noteOpening(forYear, candidate.snapshot);
  };
  const noteOpeningRef = React.useRef(noteOpening); noteOpeningRef.current = noteOpening;
  // A write of this screen succeeded: what it wrote of each column, as the answer says it is now, is
  // the base its restore will be sent with. `cols` maps each column to the months it sent (indexes),
  // or null for the whole column (its twelve months and its lines). A month the write did not send
  // keeps what the screen last wrote there, else its opening value: a change someone else made there
  // is never taken as the screen's, so its restore is refused (409). Lines come from the answer for a
  // whole column; a monthly save leaves them as the screen last wrote them, else as first read. An
  // answer without the months (an older server) leaves the months as the screen knows them.
  const noteWritten = (forYear: number, data: BulkUpsertResponse | undefined, cols: Map<AmountCol, ReadonlySet<number> | null>) => {
    const opening = openingOfYear(forYear);
    if (!opening) return;
    const stored = Array.isArray(data?.items) ? centsByColumn(forYear, data!.items!) : null;
    const inputs = Array.isArray(data?.round_inputs) ? data!.round_inputs! : null;
    for (const [col, sent] of cols) {
      const now = stored ? stored[col] : serverMonthsRef.current[col];
      if (sent === null) {
        opening.written[col] = {
          months: [...now],
          lines: inputs ? (inputs.find((r) => r.measure === col)?.lines ?? []).map(linePayloadOf) : [...serverLinesRef.current[col]],
        };
        continue;
      }
      const prev = opening.written[col];
      opening.written[col] = {
        months: now.map((cents, i) => (sent.has(i) ? cents : prev ? prev.months[i] : opening.columns[col].months[i])),
        lines: prev ? [...prev.lines] : (opening.columns[col].record?.lines ?? []).map(linePayloadOf),
      };
    }
    setOpeningTick((n) => n + 1);
  };
  const wholeColumns = (cols: Iterable<AmountCol>) => new Map<AmountCol, ReadonlySet<number> | null>([...cols].map((col) => [col, null]));
  const noteWrittenRef = React.useRef(noteWritten); noteWrittenRef.current = noteWritten;
  const noteOpeningBeforeWriteRef = React.useRef(noteOpeningBeforeWrite); noteOpeningBeforeWriteRef.current = noteOpeningBeforeWrite;

  const autosave = useAutosave({
    onError: (e) => setError(getApiErrorMessage(e, t, t(`${config.i18nPrefix}.budget.failedToSave`))),
    // A choice waiting keeps the tab busy: leaving asks first, a flush answers false.
    held: () => waitingRef.current.length > 0 || !!parkedPanelRef.current,
  });

  // Latest-value refs so the debounced persist never reads stale state.
  const monthsRef = React.useRef(months); monthsRef.current = months;
  const versionRef = React.useRef(version); versionRef.current = version;
  const frozenRef = React.useRef(frozen); frozenRef.current = frozen;
  const yearRef = React.useRef(year); yearRef.current = year;
  const roundInputsRef = React.useRef(roundInputs); roundInputsRef.current = roundInputs;
  const storedAmountsRef = React.useRef(storedAmounts); storedAmountsRef.current = storedAmounts;
  const spreadDatesRef = React.useRef(spreadDates); spreadDatesRef.current = spreadDates;
  const spreadProfileRef = React.useRef(spreadProfile); spreadProfileRef.current = spreadProfile;
  const suggestionRef = React.useRef(suggestion); suggestionRef.current = suggestion;

  // The mode a column shows: the user's pick, else the one its record gives.
  const modeOf = (col: AmountCol): ColumnMode => modeChoice[col] ?? storedMode(recordFor(col), monthsCents(months, col));
  const modeOfRef = React.useRef(modeOf); modeOfRef.current = modeOf;

  // The amount editor holds a period or a distribution the user chose and that is not the column's
  // as stored (an amount not typed yet, so nothing written): pending (lot 3G), kept by a refresh.
  const spreadChoicePending = () => {
    const measure = activeColRef.current;
    if (modeOfRef.current(measure) !== 'amount' || frozenRef.current[FREEZE_KEY[measure]]) return false;
    const dates = spreadDatesRef.current;
    const own = periodForEdit(yearRef.current, roundInputsRef.current.find((r) => r.measure === measure), storedAmountsRef.current[measure], suggestionRef.current);
    const datesChosen = dates !== null && (!own || dates.start !== own.start || dates.end !== own.end);
    return datesChosen || spreadProfileRef.current !== profileOf(measure, roundInputsRef.current);
  };

  // Every write answers with the version's stored periods: keep them so the
  // cards follow without reloading the year.
  const keepRoundInputs = (data: BulkUpsertResponse | undefined) => {
    if (!Array.isArray(data?.round_inputs)) return;
    roundInputsRef.current = data!.round_inputs;
    setRoundInputs(data!.round_inputs);
  };

  // Months typed and not saved yet, as (period, measure) cells. A save sends only these, so it never
  // overwrites a measure or a month the user did not touch.
  const dirtyCellsRef = React.useRef(new Map<string, Set<AmountCol>>());
  const resetDirty = () => {
    dirtyCellsRef.current = new Map();
  };
  const markCellDirty = (period: string, col: AmountCol) => {
    const cols = dirtyCellsRef.current.get(period) ?? new Set<AmountCol>();
    cols.add(col);
    dirtyCellsRef.current.set(period, cols);
  };
  // Every month typed is numbered: the reload after a panel write keeps the months typed after that
  // write saved them (they are newer than what the server returns).
  const editSeqRef = React.useRef(0);
  const editedAtRef = React.useRef(new Map<string, number>());
  const noteEdit = (key: string) => {
    editSeqRef.current += 1;
    editedAtRef.current.set(key, editSeqRef.current);
  };

  // The version of the year, created by the first write. Its grain says how the first write was
  // entered (month by month, or a yearly amount or lines); the lists read it, the tab does not.
  const ensureVersion = React.useCallback(async (grain: 'annual' | 'monthly'): Promise<Version> => {
    if (versionRef.current) return versionRef.current;
    const res = await api.get<Version[]>(`${config.itemsApi}/${id}/versions`);
    const existing = (res.data || []).find((v) => Number(v.budget_year) === year);
    if (existing) { versionRef.current = existing; setVersion(existing); return existing; }
    const created = await api.post<Version>(`${config.itemsApi}/${id}/versions`, {
      version_name: `Y${year}`, budget_year: year, as_of_date: `${year}-01-01`, input_grain: grain, notes: null,
    });
    // Update the ref imperatively too: a caller may read versionRef right after this, before re-render.
    versionRef.current = created.data;
    setVersion(created.data);
    noteRev(year, created.data?.budget_rev);
    return created.data;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, year]);

  // The amount field, as loaded or written: the field shows it, and leaving the field with it writes nothing.
  const showSpreadAmount = (value: number | '') => {
    committedAmountRef.current = value;
    spreadAmountRef.current = value;
    setSpreadAmount(value);
  };
  // After a monthly save of the active column, the amount field shows the column's new total, unless
  // an amount is being typed there, or a panel write is about to replace that total (a panel write
  // saves the months first).
  const followSavedTotal = () => {
    if (spreadAmountRef.current !== committedAmountRef.current || writesPendingRef.current > 0) return;
    showSpreadAmount(amountOrEmpty(monthsCents(monthsRef.current, activeColRef.current)));
  };

  // `quietSince`: a reload after a write, which saved the months up to that edit number. Nothing turns
  // read-only meanwhile, the amount editor keeps what it shows (it is what was just written, or what
  // the user is typing), and a month typed since, not saved yet, or in a column waiting for the
  // user's choice keeps its value; the other months show the server's, others' changes included.
  // `others`: a reload because someone else changed the year (lot 3G): the amount editor follows its
  // column's stored total, distribution and period too, unless an amount is typed there.
  const applyYear = React.useCallback((snapshot: BudgetYear, { quietSince, others = false }: { quietSince?: number; others?: boolean } = {}) => {
    const quiet = quietSince !== undefined;
    // Read before this reload changes the column's stored period: a choice of the user stays.
    const followPanel = others && quiet && !spreadChoicePending();
    const typedSince = (key: string) => quiet && (editedAtRef.current.get(key) ?? 0) > quietSince;
    const keepCell = (period: string, col: AmountCol) => quiet && (
      typedSince(`${period}:${col}`) || !!dirtyCellsRef.current.get(period)?.has(col) || isCellWaiting(period, col)
    );
    // The column's months are not the screen's (a panel write waiting): the base stays.
    const keepColumn = (col: AmountCol) => quiet && isColumnWaiting(col);
    // A full load starts again from the server: nothing typed, nothing waiting, except the choices
    // this tab had when the user went to another tab of the line (`held`), given back here.
    const restore = !quiet && restoreRef.current?.year === year ? restoreRef.current : null;
    if (!quiet) {
      setSpreadDates(null);
      setSpreadWhen(null);
      setWaiting(restore ? restore.waiting.map((c) => ({ ...c, cells: c.cells ? new Set(c.cells) : null })) : []);
      parkedPanelRef.current = restore?.parkedPanel ? { ...restore.parkedPanel, columns: new Set(restore.parkedPanel.columns) } : null;
      parkedRestoresRef.current = new Map((restore?.parkedRestores ?? []).map((p) => [p.measure, p.body]));
    }
    // The waiting columns come back in the mode they were shown in.
    if (restore?.modes && Object.keys(restore.modes).length > 0) setModeChoice((prev) => ({ ...prev, ...restore.modes }));
    const restoredCell = new Map((restore?.cells ?? []).map((c) => [`${c.period}:${c.col}`, c.value]));
    const v = snapshot.version;
    if (!v) {
      setVersion(null);
      setMonths(emptyMonths(year));
      setRoundInputs([]);
      setStoredAmounts(NO_STORED_AMOUNTS);
      serverMonthsRef.current = zeroMonths();
      serverLinesRef.current = perColumn(() => []);
      if (!quiet) {
        setSpreadProfile('flat');
        showSpreadAmount('');
      }
      resetDirty();
      setLoadedYear(year);
      return;
    }
    setVersion(v);
    const amt = snapshot.amounts;
    const byPeriod = new Map((amt?.items || []).map((r) => [r.period, r]));
    const loadedMonths = Array.from({ length: 12 }, (_, i) => {
      const p = monthPeriod(year, i + 1);
      const found = byPeriod.get(p);
      return { period: p, ...perColumn((col) => Number(found?.[col] || 0)) };
    });
    setMonths((prev) => loadedMonths.map((row, i) => {
      const value = (col: AmountCol) => {
        const restored = restoredCell.get(`${row.period}:${col}`);
        if (restored !== undefined) return restored;
        return prev[i]?.period === row.period && keepCell(row.period, col) ? prev[i][col] : row[col];
      };
      return { period: row.period, ...perColumn(value) };
    }));
    // What the screen now takes from the server is the base of the next edit; a kept month keeps its own.
    const loadedCents = centsByColumn(year, amt?.items || []);
    ALL_COLS.forEach((col) => {
      if (keepColumn(col)) return;
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
      if (!(quiet && isColumnWaiting(col))) serverLinesRef.current[col] = (loadedInputs.find((r) => r.measure === col)?.lines ?? []).map(linePayloadOf);
    });
    const active = activeColRef.current;
    if (!quiet) {
      setSpreadProfile(profileOf(active, loadedInputs));
      showSpreadAmount(amountOrEmpty(monthsCents(loadedMonths, active)));
    } else if (followPanel && !keepColumn(active) && !isWaiting(active)
      && spreadAmountRef.current === committedAmountRef.current && writesPendingRef.current === 0) {
      setSpreadDates(null);
      setSpreadWhen(null);
      setSpreadProfile(profileOf(active, loadedInputs));
      showSpreadAmount(amountOrEmpty(monthsCents(loadedMonths, active)));
    }
    // After a panel write, the unsaved months are the ones typed since: the pending autosave sends them.
    if (!quiet) {
      resetDirty();
      // The values given back wait again, unsaved, in their columns.
      restore?.cells.forEach((c) => markCellDirty(c.period, c.col));
    }
    setLoadedYear(year);
    // showSpreadAmount only sets state and a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  // `background`: a refresh of the year shown from the cache; nothing turns read-only, and a month
  // typed since it was shown is kept as after a panel write.
  // `others`: someone else changed the year (lot 3G); see applyYear. True once the year read is on
  // screen; false when it failed (the error shows) or a write sent meanwhile made it out of date.
  const load = React.useCallback(async ({ quietSince, background = false, others = false }: { quietSince?: number; background?: boolean; others?: boolean } = {}): Promise<boolean> => {
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
        if (writeGenRef.current !== generation) return false;
        queryClient.setQueryData(key, snapshot);
      }
      if (background && editSeqRef.current === quietSince) applyYear(snapshot);
      else applyYear(snapshot, { quietSince, others });
      // The first read of the year from the server in this visit: its opening values (a read after a
      // write of this visit is never one, the year was read before it).
      if (!quiet || background) noteOpeningRef.current(year, snapshot);
      // What the screen now shows of the year: the counter the item page compares with (lot 3G). A
      // reload after the tab's own write leaves it to that write's answer.
      if (!quiet || background || others) noteRev(year, snapshot.version ? snapshot.version.budget_rev ?? null : null);
      // The choices given back are on screen now: a later full load starts from the server.
      restoreRef.current = null;
      return true;
    } catch (e) {
      setError(getApiErrorMessage(e, t, t(`${config.i18nPrefix}.budget.failedToLoad`)));
      return false;
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
      openingCandidateRef.current = { year, snapshot: cached };
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

  // The modes picked and the questions open belong to the year left. Not on the first year shown:
  // the choices given back (`held`) may have restored modes already.
  const modesYearRef = React.useRef(year);
  React.useEffect(() => {
    if (modesYearRef.current === year) return;
    modesYearRef.current = year;
    setModeChoice({});
    setModeSwitch(null);
    setAlsoOpen(false);
  }, [year]);

  // What a write stored becomes the base of the next edit: a whole column for a panel write, only the
  // cells it wrote for a monthly entry (the other months may hold changes the screen does not show yet).
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

  // Persist the months typed, creating the version on first edit. Each says what it started from
  // (`base`); a month someone else changed meanwhile is refused (409) and waits for the user's
  // choice. Frozen measures are never sent; a month waiting for a choice is not either.
  const persist = React.useCallback(async () => {
    const fr = frozenRef.current;
    // Take out what goes now: months typed while this save is in flight stay dirty for the next one;
    // a failed save puts its own back.
    const sentCells = new Map<string, Set<AmountCol>>();
    for (const [period, cols] of [...dirtyCellsRef.current]) {
      for (const col of [...cols]) {
        // Only the months waiting for a choice stay: the column's other months go.
        if (isCellWaiting(period, col)) continue;
        cols.delete(col);
        if (!fr[FREEZE_KEY[col]]) sentCells.set(period, (sentCells.get(period) ?? new Set<AmountCol>()).add(col));
      }
      if (cols.size === 0) dirtyCellsRef.current.delete(period);
    }
    // The base of each edit: the year as last known on the server (see serverMonthsRef).
    const known = serverMonthsRef.current;
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
    if (rows.length === 0) return;
    const body = { kind: 'monthly', year, months: rows, base: { months: baseRows } };

    // The months are saved up to here: the reload after the save keeps what is typed from now on.
    const savedUpTo = editSeqRef.current;
    try {
      markYearStaleRef.current();
      const v = await ensureVersion('monthly');
      noteOpeningBeforeWriteRef.current(year);
      writeGenRef.current += 1;
      const res = await api.post<BulkUpsertResponse>(`${config.versionsApi}/${v.id}/amounts/bulk-upsert`, body);
      noteRev(year, res?.data?.budget_rev);
      keepRoundInputs(res?.data);
      keepWritten(res?.data, [], sentCells);
      // Once written too: an Allocations tab opened while the save ran read the old totals.
      forgetAllocationsYear(queryClient, config.itemsApi, id, year);
      // Only the months it sent: the column's other months may hold someone else's change.
      const savedMonths = new Map<AmountCol, Set<number>>();
      sentCells.forEach((cols, period) => cols.forEach((col) => {
        savedMonths.set(col, (savedMonths.get(col) ?? new Set<number>()).add(monthIndexOf(period)));
      }));
      noteWrittenRef.current(year, res?.data, savedMonths);
      if (savedMonths.has(activeColRef.current)) followSavedTotal();
      invalidateBudgetLists(queryClient);
      // Show what others changed meanwhile; what is typed since stays as typed.
      void loadRef.current({ quietSince: savedUpTo });
    } catch (e) {
      const conflicts = budgetConflictsOf(e);
      // What waits: the months the server refused, each column's other months going on. (An answer
      // naming no month: the whole column waits, never an empty set.)
      const refused = new Map<AmountCol, Set<string> | null>(
        (conflicts ?? []).map((c) => [c.measure, c.periods.length > 0 ? new Set(c.periods) : null]),
      );
      const refusedCell = (period: string, col: AmountCol) => refused.has(col) && (refused.get(col) === null || refused.get(col)!.has(period));
      let others = false;
      sentCells.forEach((cols, period) => cols.forEach((col) => { markCellDirty(period, col); if (!refusedCell(period, col)) others = true; }));
      if (conflicts) {
        // The refused months wait for the user's choice, read-only, their edits kept; a column
        // already waiting on other months keeps them.
        const next = waitingRef.current.filter((c) => !refused.has(c.measure));
        for (const conflict of conflicts) {
          const cells = refused.get(conflict.measure) ?? null;
          const earlier = waitingRef.current.find((c) => c.measure === conflict.measure && c.source === 'grid');
          const merged = cells && earlier?.cells ? new Set([...earlier.cells, ...cells]) : cells;
          next.push({ ...conflict, source: 'grid', cells: merged });
        }
        setWaiting(next);
        // The whole request was refused (D5): the months that did not conflict go again on their own.
        if (others) autosaveRef.current.schedule(persistRef.current);
        throw e;
      }
      // The save may have been refused because a column was frozen meanwhile: refresh the freeze
      // state so that column turns read-only and the next save leaves it out.
      void queryClient.invalidateQueries({ queryKey: ['freeze-state', year] });
      // A conflict answer the screen cannot read: an error the user sees, the edits kept.
      throw unreadableConflict(e) ?? e;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ensureVersion, id, year, queryClient]);
  const persistRef = React.useRef(persist); persistRef.current = persist;

  const scheduleSave = React.useCallback(() => { autosave.schedule(persist); }, [autosave, persist]);

  const hasUnsavedEdits = () => dirtyCellsRef.current.size > 0;
  // Months that can go now: not waiting for the user's choice.
  const hasSendableEdits = () => [...dirtyCellsRef.current.entries()].some(([period, cols]) => [...cols].some((col) => !isCellWaiting(period, col)));
  // Save every unsaved month now. A save the autosave dropped (refused) left its months dirty here,
  // so it is scheduled again; a save the autosave still keeps (isSaving) goes again within the
  // flush. False if the save fails, or while a choice waits (unless `ignoreHeld`).
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

  // Months typed, then the panel writes already queued. Never called from inside a queued write.
  const flushAll = React.useCallback(async (options?: { ignoreHeld?: boolean }) => {
    const saved = await flushEdits(options);
    await chainRef.current;
    return saved;
  }, [flushEdits]);

  // The columns waiting for a choice (refused months, a parked panel write), as the tenant names them.
  const labelForRef = React.useRef((col: AmountCol) => budgetColumns.label(col));
  labelForRef.current = (col: AmountCol) => budgetColumns.label(col);
  const waitingLabels = React.useCallback(() => {
    // Not on screen again yet (the year is loading): the choices kept for the line.
    if (restoreRef.current && waitingRef.current.length === 0 && !parkedPanelRef.current) return restoreRef.current.labels;
    const cols = new Set<AmountCol>([...waitingRef.current.map((c) => c.measure), ...(parkedPanelRef.current?.columns ?? [])]);
    return ALL_COLS.filter((col) => cols.has(col)).map((col) => labelForRef.current(col));
  }, []);
  // The user leaves the year with a choice waiting: the waiting edits are dropped.
  const dropChoices = () => {
    for (const conflict of waitingRef.current) {
      dirtyCellsRef.current.forEach((cols, period) => {
        if (conflict.cells === null || conflict.cells.has(period)) cols.delete(conflict.measure);
        if (cols.size === 0) dirtyCellsRef.current.delete(period);
      });
    }
    parkedPanelRef.current = null;
    parkedRestoresRef.current = new Map();
    restoreRef.current = null;
    setWaiting([]);
    autosaveRef.current.resetConflict();
  };

  // Flush pending edits before switching year so nothing is lost on reload. A choice waiting asks
  // first, naming its columns: leaving the year drops it.
  const handleYearChange = React.useCallback(async (y: number) => {
    if (!(await flushAll())) {
      const columns = waitingLabels();
      if (columns.length === 0) return;
      const change = await dialogs.confirm({
        title: t('common:autosave.leaveTitle'),
        message: t('budgetTab.conflict.yearChange', { count: columns.length, columns: namesInSentence(locale, columns) }),
        confirmLabel: t('budgetTab.conflict.yearChangeConfirm'),
        intent: 'danger',
      });
      if (!change) return;
      dropChoices();
      if (!(await flushAll())) return;
    }
    onYearChange(y);
    // dropChoices only touches refs and state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flushAll, onYearChange, waitingLabels, dialogs, t, locale]);

  // A costed line not complete or not sent yet (`LinesPanel`): a refresh must not move it.
  const linesPendingRef = React.useRef<(() => boolean) | null>(null);
  // « Back to the opening values » is running (lot F2).
  const restoringRef = React.useRef(false);
  // Set when the line is deleted: the unmount must not send the pending save, nor keep a choice.
  const droppedRef = React.useRef(false);
  useImperativeHandle(ref, () => ({
    flush: flushAll,
    // A restore of the opening values under way is a save under way (its writes are queued one by one).
    isDirty: () => autosave.isBusy() || hasUnsavedEdits() || writesPendingRef.current > 0 || restoringRef.current,
    waitingColumns: waitingLabels,
    isSaving: () => autosave.isSaving() || writesPendingRef.current > 0 || restoringRef.current,
    hasPending: () => autosave.isBusy() || hasUnsavedEdits() || writesPendingRef.current > 0 || restoringRef.current
      || waitingRef.current.length > 0 || !!parkedPanelRef.current || !!restoreRef.current
      || spreadAmountRef.current !== committedAmountRef.current || spreadChoicePending() || !!linesPendingRef.current?.(),
    reloadFromServer: async () => {
      // Not shown (a failed read, a write sent meanwhile): rejected, so the page does not count it as seen.
      if (!(await loadRef.current({ quietSince: editSeqRef.current, others: true }))) throw new Error('The year was not reloaded.');
    },
    discard: () => {
      droppedRef.current = true;
      autosave.discard();
      waitingRef.current = [];
      parkedPanelRef.current = null;
      restoreRef.current = null;
      if (held) held.current = null;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [autosave, flushAll, waitingLabels, held]);

  // Leaving the tab with a choice waiting (another tab of the line): the item page keeps it for the
  // line (`heldChoices.ts`), and this tab takes it back when it comes back for the same year.
  React.useEffect(() => {
    if (held?.current?.lineId === id) held.current = null;
    return () => {
      if (droppedRef.current) {
        if (held) held.current = null;
        return;
      }
      if (!held) return;
      const waiting = waitingRef.current;
      const parked = parkedPanelRef.current;
      if (waiting.length === 0 && !parked) {
        // Left before the year was on screen again: the choices stay as they were kept.
        if (restoreRef.current) held.current = restoreRef.current;
        return;
      }
      const cells: HeldBudgetChoices['cells'] = [];
      dirtyCellsRef.current.forEach((cols, period) => cols.forEach((col) => {
        if (isCellWaiting(period, col)) cells.push({ period, col, value: Number(monthsRef.current[monthIndexOf(period)]?.[col] || 0) });
      }));
      const waitingCols = new Set<AmountCol>([...waiting.map((c) => c.measure), ...(parked?.columns ?? [])]);
      held.current = {
        lineId: id,
        year: yearRef.current,
        labels: waitingLabels(),
        waiting: waiting.map((c) => ({ ...c, cells: c.cells ? [...c.cells] : null })),
        parkedPanel: parked ? { ...parked, columns: [...parked.columns] } : null,
        cells,
        modes: Object.fromEntries(Object.entries(modeChoiceRef.current).filter(([col]) => waitingCols.has(col as AmountCol))),
        parkedRestores: [...parkedRestoresRef.current].map(([measure, body]) => ({ measure, body })),
      };
    };
    // Mount and unmount only: the refs hold the latest state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const editCell = (period: string, key: AmountCol) => {
    markCellDirty(period, key);
    noteEdit(`${period}:${key}`);
  };
  const onMonthChange = (idx: number, key: AmountCol, value: number | '') => {
    setMonths((prev) => { const next = [...prev]; next[idx] = { ...next[idx], [key]: Number(value || 0) }; return next; });
    editCell(monthPeriod(year, idx + 1), key);
    // Typed month by month: the column stays in that mode, even when its months reach zero.
    chooseMode(key, 'monthly');
    pinActive();
    scheduleSave();
  };
  // The table's cells take one handler that never changes, so a cell is drawn again only when its own
  // value or state does: a keystroke otherwise redraws every field of the column.
  const onMonthChangeRef = React.useRef(onMonthChange);
  onMonthChangeRef.current = onMonthChange;
  const stableMonthChange = React.useCallback((idx: number, key: AmountCol, value: number | '') => {
    onMonthChangeRef.current(idx, key, value);
  }, []);
  // Clear every month of a column: convenient when entering a cash-out plan by month (e.g. the whole
  // amount in a single month). Asked first, unless the column is already empty.
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
    // A column typed by month stays so: its months are about to be entered again.
    if (modeOfRef.current(key) === 'monthly') chooseMode(key, 'monthly');
    setMonths((prev) => prev.map((m) => ({ ...m, [key]: 0 })));
    for (let m = 1; m <= 12; m++) editCell(monthPeriod(year, m), key);
    if (key === activeColRef.current) showSpreadAmount('');
    scheduleSave();
  };

  // The period the amount editor shows: what the user chose, else the column's own period within
  // the line's dates.
  const defaultPeriod = periodForEdit(year, recordFor(activeCol), storedAmounts[activeCol], suggestion);
  const spreadPeriod: Period = spreadDates ?? defaultPeriod ?? { start: '', end: '' };
  // The column's period as stored differs from the one proposed (cut to the line's dates): the
  // editor says which one a save uses, until the user picks dates.
  const storedPeriod = columnPeriod(year, recordFor(activeCol), storedAmounts[activeCol], suggestion);
  const periodChange = !spreadDates && storedPeriod && defaultPeriod
    && (storedPeriod.start !== defaultPeriod.start || storedPeriod.end !== defaultPeriod.end)
    ? { stored: storedPeriod, proposed: defaultPeriod }
    : null;
  const spreadKind: AmountWhen = spreadWhen
    ?? (isOneDay(spreadPeriod.start, spreadPeriod.end) ? 'date' : isWholeYear(year, spreadPeriod) ? 'year' : 'range');
  const spreadProblem = columnPeriodProblem(year, spreadPeriod.start, spreadPeriod.end);
  const spreadActive = spreadProblem ? [] : periodMonths(year, spreadPeriod.start, spreadPeriod.end);
  const spreadBeyondItem = !spreadProblem && (
    (!!effectiveStart && spreadPeriod.start < effectiveStart) || (!!endOfValidity && spreadPeriod.end > endOfValidity)
  );

  // A column's current total in cents: the sum of its months as shown.
  const currentCents = (col: AmountCol): number => monthsCents(months, col);
  // A column with nothing entered: every month at zero and no lines, whatever its record says (a
  // copy or a seed can leave a record « spread flat, 0 » on a column nobody filled).
  const isEmptyColumn = (col: AmountCol): boolean => months.every((row) => toCents(row[col]) === 0) && !hasLines(recordFor(col));

  // The amount editor starts again from the column: its total, its distribution, its period.
  const resetSpreadFields = (measure: AmountCol) => {
    setSpreadDates(null);
    setSpreadWhen(null);
    setSpreadProfile(profileOf(measure, roundInputsRef.current));
    showSpreadAmount(amountOrEmpty(currentCents(measure)));
  };
  // A click on a card: the column becomes active; the cursor goes in its amount when it is built
  // from an amount (or empty) and can be edited.
  const selectColumn = (col: AmountCol, { focusAmount = true }: { focusAmount?: boolean } = {}) => {
    setModeSwitch(null);
    setAlsoOpen(false);
    if (focusAmount && !isFrozen(col) && !isWaiting(col) && !loading && loadedYear === year && modeOf(col) === 'amount') {
      requestFocus({ kind: 'amount' });
    }
    if (col === activeCol) {
      setPickedCol(col);
      return;
    }
    setPickedCol(col);
    syncedColRef.current = col;
    resetSpreadFields(col);
  };
  // The active column can also change without a pick: the freeze state arrives, the setting hides
  // the picked column. Its editor follows.
  const syncedColRef = React.useRef(activeCol);
  React.useEffect(() => {
    if (syncedColRef.current === activeCol) return;
    syncedColRef.current = activeCol;
    resetSpreadFields(activeCol);
    setModeSwitch(null);
    setAlsoOpen(false);
    // resetSpreadFields reads the latest state of this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCol]);

  // The active column freezes (an administrator, a refused save): what was typed in its editor can no
  // longer be written, and the editor shows the column read only.
  const activeFrozen = isFrozen(activeCol);
  React.useEffect(() => {
    if (!activeFrozen) return;
    resetSpreadFields(activeCol);
    setModeSwitch(null);
    setAlsoOpen(false);
    // resetSpreadFields reads the latest state of this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFrozen, activeCol]);

  // The base of a panel write, read when it is sent: each compared column's months as last known on the
  // server and, for costed lines, its lines (the written column: the lines its drafts started from).
  const panelBase = (columns: readonly AmountCol[], lines?: { main: AmountCol; startedFrom: LinePayload[] }) => ({
    columns: Object.fromEntries(columns.map((col) => [col, {
      months: monthsBase(serverMonthsRef.current[col]),
      ...(lines ? { lines: col === lines.main ? lines.startedFrom : serverLinesRef.current[col] } : {}),
    }])),
  });

  // Sends a panel body; a 409 parks it for the user's choice. The caller holds the queue.
  const sendPanel = async (body: Record<string, unknown>, columns: AmountCol[], main: AmountCol): Promise<PanelOutcome> => {
    // The months are saved up to here: what is typed from now on is kept by the reload.
    const savedUpTo = editSeqRef.current;
    try {
      markYearStaleRef.current();
      const v = await ensureVersion('annual');
      noteOpeningBeforeWriteRef.current(year);
      // The totals the screen knows before the write: a column the write spreads from its stored
      // total, with no base, is the screen's write only if that total is still the one the server spread.
      const knownTotals = perColumn((col) => sumCents(serverMonthsRef.current[col]));
      writeGenRef.current += 1;
      const res = await api.post<BulkUpsertResponse>(`${config.versionsApi}/${v.id}/amounts/bulk-upsert`, body);
      noteRev(year, res?.data?.budget_rev);
      keepRoundInputs(res?.data);
      keepWritten(res?.data, columns);
      // A column sent with its base is the screen's write. One sent without (« Use for other columns
      // too » on an amount) whose total moved meanwhile holds someone else's change: it stays as the
      // screen last wrote it, so its restore is refused or never sent.
      const compared = (body.base as { columns?: Record<string, unknown> } | undefined)?.columns ?? {};
      const stored = Array.isArray(res?.data?.items) ? centsByColumn(year, res!.data!.items!) : null;
      noteWrittenRef.current(year, res?.data, wholeColumns(columns.filter((col) => (
        col in compared || (!!stored && sumCents(stored[col]) === knownTotals[col])
      ))));
      forgetAllocationsYear(queryClient, config.itemsApi, id, year);
      invalidateBudgetLists(queryClient);
      await loadRef.current({ quietSince: savedUpTo });
      return { status: 'saved', data: res?.data };
    } catch (e) {
      const conflicts = budgetConflictsOf(e);
      if (conflicts) {
        // Kept whole (D5) until the user chose for each refused column; its columns stay read-only.
        parkedPanelRef.current = { body, main, columns: new Set(columns) };
        const refused = new Set(conflicts.map((c) => c.measure));
        setWaiting([...waitingRef.current.filter((c) => !refused.has(c.measure)), ...conflicts.map((c) => ({ ...c, source: 'panel' as const, cells: null }))]);
        return { status: 'conflict' };
      }
      // The write may have been refused because a column was frozen meanwhile.
      void queryClient.invalidateQueries({ queryKey: ['freeze-state', year] });
      // A conflict answer the screen cannot read: an error the user sees.
      throw unreadableConflict(e) ?? e;
    }
  };

  // One panel write, queued: pending months first (the reload shows the stored amounts), then the
  // body with its base, then a quiet reload. A column waiting for the user's choice is not written.
  // `build` runs when the write leaves the queue: it reads the lines as the writes before it left them.
  const writePanel = (build: () => PanelWrite) => enqueueWrite(async (): Promise<PanelOutcome> => {
    const { body, columns, linesBase } = build();
    if (columns.some(isWaiting)) return { status: 'waiting' };
    // A choice waiting on another column does not stop this write.
    if (!(await flushEdits({ ignoreHeld: true }))) throw new UnsavedEditsError();
    const main = (body as { measure?: AmountCol }).measure ?? columns[0];
    // Compared: the columns the user's screen shows this write replacing. An amount used for other
    // columns spreads them from their stored totals: they carry no base.
    const kind = (body as { kind?: string }).kind;
    const isLines = kind === 'lines';
    const compared = isLines ? columns : [main];
    // Lines and a copy say which lines they replace: the lines the panel started from, or the column's own.
    const withLines = isLines || kind === 'copy';
    const base = panelBase(compared, withLines ? { main, startedFrom: linesBase ?? serverLinesRef.current[main] } : undefined);
    return sendPanel({ ...body, base }, columns, main);
  });

  // Each commit of the amount editor writes the spread: the amount on leaving the field, the
  // distribution, "When" and the dates on change. A frozen column, a column not built from an amount
  // or a period that does not work writes nothing. A blank or zero amount writes zero over the period
  // when the column holds a total (shown, or just written), and nothing on a column already at zero.
  // `also`: the columns that take the same period and distribution, each spread from its own stored total.
  const commitSpread = (next: { amount?: number | ''; profile?: 'flat' | '4-4-5'; dates?: Period; also?: AmountCol[]; switching?: boolean } = {}) => {
    const measure = activeColRef.current;
    const typed = next.amount !== undefined ? next.amount : spreadAmount;
    const dates = next.dates ?? spreadPeriod;
    const amount = Number(typed || 0);
    if (isFrozen(measure) || isWaiting(measure) || columnPeriodProblem(year, dates.start, dates.end)) return;
    if (!next.switching && modeOf(measure) !== 'amount') return;
    if (!amount && currentCents(measure) === 0 && !Number(committedAmountRef.current || 0)) {
      committedAmountRef.current = typed;
      return;
    }
    // The total in cents, sent as a two-decimal string: no float sum reaches the server. The other
    // columns are spread by the server from their stored totals (never the screen's); those that
    // follow their lines keep them.
    const also = (next.also ?? []).filter((m) => m !== measure && !followsLines(recordFor(m)));
    committedAmountRef.current = typed;
    // Not written: the next commit may send the same amount again, when the field still shows it.
    // Another column or year shown meanwhile has its own committed amount: it is left alone.
    const forgetCommitted = () => {
      if (activeColRef.current === measure && yearRef.current === year && committedAmountRef.current === typed) committedAmountRef.current = '';
    };
    setError(null);
    pinActive();
    writePanel(() => ({
      body: {
        kind: 'annual',
        year,
        totals: { [measure]: centsToDecimal(toCents(amount)) },
        ...(also.length > 0 ? { also_measures: also } : {}),
        // At a date the month of the date takes it all: no distribution (the server keeps it flat).
        ...(isOneDay(dates.start, dates.end) ? {} : { spread_profile_name: next.profile ?? spreadProfile }),
        period_start: dates.start,
        period_end: dates.end,
      },
      columns: [measure, ...also],
    })).then((outcome) => {
      if (outcome.status !== 'saved') forgetCommitted();
    }).catch((e) => {
      if (e instanceof UnsavedEditsError) return;
      forgetCommitted();
      setError(getApiErrorMessage(e, t, t(`${config.i18nPrefix}.budget.failedToSave`)));
    });
  };
  // Leaving the field writes only a changed amount, so tabbing through writes nothing; Enter always writes.
  const commitSpreadAmount = () => {
    if (Number(spreadAmount || 0) === Number(committedAmountRef.current || 0)) return;
    commitSpread();
  };
  const onSpreadAmountChange = (value: number | '') => {
    setSpreadAmount(value);
    pinActive();
  };
  const onSpreadProfileChange = (profile: 'flat' | '4-4-5') => {
    setSpreadProfile(profile);
    commitSpread({ profile });
  };
  const onSpreadDateChange = (bound: 'start' | 'end', value: string) => {
    const dates = { ...spreadPeriod, [bound]: value };
    setSpreadDates(dates);
    setSpreadWhen('range');
    commitSpread({ dates });
  };
  // "Whole year" spreads over the twelve months at once; "A period" opens From and To on the period
  // shown (the line's dates when an amount at a date is shown); "At a date" puts the amount in the
  // month of the period's first day at once. Each writes when what it shows is not what is stored.
  const onSpreadWhenChange = (when: AmountWhen) => {
    setSpreadWhen(when);
    pinActive();
    let dates: Period | null = null;
    if (when === 'year') dates = wholeYear(year);
    else if (when === 'range' && isOneDay(spreadPeriod.start, spreadPeriod.end)) dates = suggestion ?? wholeYear(year);
    else if (when === 'date' && !isOneDay(spreadPeriod.start, spreadPeriod.end)) {
      const first = spreadPeriod.start.slice(0, 4) === String(year) ? spreadPeriod.start : (suggestion ?? wholeYear(year)).start;
      dates = { start: first, end: first };
    }
    if (!dates) return;
    setSpreadDates(dates);
    commitSpread({ dates });
  };
  // The date of an amount at a date: the period of one day.
  const onSpreadSingleDateChange = (value: string) => {
    const dates = { start: value, end: value };
    setSpreadDates(dates);
    setSpreadWhen('date');
    commitSpread({ dates });
  };

  // Every complete line of the active column. `startedFrom`: the stored lines the panel's drafts
  // started from (the base of a lines write).
  const saveLines = async (measure: AmountCol, lines: LinePayload[], startedFrom: LinePayload[]): Promise<LinesSaveResult> => {
    // Built from lines: the column stays there, even when its last line goes.
    chooseMode(measure, 'lines');
    pinActive();
    const body: LinesRequest = { kind: 'lines', year, measure, lines };
    try {
      const outcome = await writePanel(() => ({ body, columns: [measure], linesBase: startedFrom }));
      if (outcome.status !== 'saved') return { ok: false, conflict: true };
      const data = outcome.data;
      return { ok: true, warnings: Array.isArray(data?.warnings) ? data!.warnings : undefined };
    } catch (e) {
      if (e instanceof UnsavedEditsError) return { ok: false, error: t(`${config.i18nPrefix}.budget.failedToSave`) };
      return { ok: false, error: getApiErrorMessage(e, t, t('budgetTab.lines.saveFailed')) };
    }
  };

  // « Use the lines again »: the column is computed from the lines it keeps as a reference (D9).
  const reuseLines = (col: AmountCol) => {
    const record = recordFor(col);
    if (!hasLines(record) || isFrozen(col) || isWaiting(col)) return;
    chooseMode(col, 'lines');
    pinActive();
    setError(null);
    writePanel(() => {
      const lines = serverLinesRef.current[col].length > 0 ? serverLinesRef.current[col] : record.lines.map(linePayloadOf);
      return { body: { kind: 'lines', year, measure: col, lines } as LinesRequest, columns: [col], linesBase: lines };
    }).catch((e) => {
      if (e instanceof UnsavedEditsError) return;
      setError(getApiErrorMessage(e, t, t('budgetTab.lines.saveFailed')));
    });
  };

  /* ---- Modes: how the active column is built ---- */

  // A mode picked on the active column: at once on an empty column, after a confirmation that says
  // what changes on a column with amounts (or lines kept as a reference to use again).
  const requestMode = (to: ColumnMode) => {
    const col = activeCol;
    if (isFrozen(col) || isWaiting(col) || loading) return;
    if (modeOf(col) === to) { setModeSwitch(null); return; }
    pinActive();
    setAlsoOpen(false);
    const record = recordFor(col);
    const reference = hasLines(record) && !followsLines(record);
    if (currentCents(col) !== 0 || (to === 'lines' && reference)) {
      setModeSwitch({ col, to });
      return;
    }
    setModeSwitch(null);
    chooseMode(col, to);
    if (to === 'amount') requestFocus({ kind: 'amount' });
    if (to === 'monthly') openGrid();
  };
  const cancelModeSwitch = () => setModeSwitch(null);
  // The confirmed change: an amount spreads the current total flat over the column's period (the
  // lines stay as a reference); by month keeps the months, now typed in the table; quantity and price
  // uses the lines kept as a reference again, or replaces the amounts with the first complete line.
  const confirmModeSwitch = () => {
    const change = modeSwitch;
    setModeSwitch(null);
    if (!change || change.col !== activeCol || isFrozen(change.col) || isWaiting(change.col)) return;
    const { col, to } = change;
    chooseMode(col, to);
    if (to === 'amount') {
      const cents = currentCents(col);
      const dates = defaultPeriod ?? { start: '', end: '' };
      setSpreadDates(null);
      setSpreadWhen(null);
      setSpreadProfile('flat');
      showSpreadAmount(amountOrEmpty(cents));
      commitSpread({ amount: amountOrEmpty(cents), profile: 'flat', dates, switching: true });
      return;
    }
    if (to === 'monthly') {
      openGrid();
      if (change.month !== undefined) requestFocus({ kind: 'cell', month: change.month });
      return;
    }
    const record = recordFor(col);
    if (hasLines(record) && !followsLines(record)) reuseLines(col);
  };

  // A click in a month of a column not typed by month: the column becomes active, then by month (at
  // once on an empty column, after the confirmation otherwise), the cursor in the month clicked.
  const onCellClick = (col: AmountCol, month: number) => {
    if (isFrozen(col) || loading || loadedYear !== year) return;
    if (col !== activeCol) selectColumn(col, { focusAmount: false });
    if (isWaiting(col)) return;
    pinActive();
    if (modeOf(col) === 'monthly') {
      requestFocus({ kind: 'cell', month });
      return;
    }
    if (currentCents(col) === 0) {
      chooseMode(col, 'monthly');
      setModeSwitch(null);
      requestFocus({ kind: 'cell', month });
      return;
    }
    setModeSwitch({ col, to: 'monthly', month });
  };

  /* ---- « Use for other columns too »: the same construction on the columns ticked ---- */

  const activeMode = modeOf(activeCol);
  // The other shown columns that can take it: not frozen, not waiting for a choice. An amount leaves
  // out the columns that follow their lines (they keep them, and a sentence says so).
  const alsoCandidates = shown.filter((c) => c.measure !== activeCol && !frozen[c.freezeKey] && !isWaiting(c.measure));
  const keepLinesColumns = activeMode === 'amount' ? alsoCandidates.filter((c) => followsLines(recordFor(c.measure))) : [];
  const alsoTargets = activeMode === 'amount' ? alsoCandidates.filter((c) => !followsLines(recordFor(c.measure))) : alsoCandidates;
  const activeRecord = recordFor(activeCol);
  const alsoOffered = alsoTargets.length > 0 && (
    (activeMode === 'amount' && currentCents(activeCol) !== 0 && !spreadProblem)
    || (activeMode === 'lines' && followsLines(activeRecord))
  );
  // Opened with the columns of the setting's group ticked: those that follow what is applied to all columns.
  const openAlso = () => {
    setAlsoChecked(alsoTargets.filter((c) => group.some((g) => g.measure === c.measure)).map((c) => c.measure));
    setAlsoOpen(true);
  };
  const toggleAlso = (col: AmountCol, on: boolean) => setAlsoChecked((prev) => (on ? [...prev.filter((c) => c !== col), col] : prev.filter((c) => c !== col)));
  const applyAlso = () => {
    const targets = ALL_COLS.filter((col) => alsoChecked.includes(col) && alsoTargets.some((c) => c.measure === col));
    setAlsoOpen(false);
    if (targets.length === 0) return;
    if (activeMode === 'amount') {
      // The amount as typed: leaving the field for this button has just written it.
      commitSpread({ amount: spreadAmountRef.current, also: targets });
      return;
    }
    const col = activeCol;
    if (isFrozen(col) || isWaiting(col)) return;
    setError(null);
    // The lines as the writes before this one left them, to the columns ticked too.
    writePanel(() => {
      const lines = serverLinesRef.current[col];
      return { body: { kind: 'lines', year, measure: col, lines, also_measures: targets } as LinesRequest, columns: [col, ...targets], linesBase: lines };
    }).catch((e) => {
      if (e instanceof UnsavedEditsError) return;
      setError(getApiErrorMessage(e, t, t('budgetTab.lines.saveFailed')));
    });
  };

  /* ---- « Start from »: an empty column takes another column's, with a percentage (lot F2) ---- */

  // The active column holds nothing (no month, no line; a record of zeros counts as nothing): any
  // other shown column with amounts can be its start, a frozen one included (it is only read). The
  // copy replaces the column's record under its base.
  const activeEmpty = loaded && isEmptyColumn(activeCol);
  const startSources = activeEmpty && !isFrozen(activeCol) && !isWaiting(activeCol)
    ? shown.filter((c) => c.measure !== activeCol && currentCents(c.measure) !== 0)
    : [];
  // What the last start said about the column it filled: months of the source left out by the line's dates.
  const [startNote, setStartNote] = React.useState<{ col: AmountCol; year: number; source: AmountCol } | null>(null);
  // The copy of the operation « Copy budget columns », on this line and year (`kind: 'copy'`), over
  // the column as the screen knows it (`base`, its lines included). A 409 waits for the user's choice.
  const startFrom = (source: AmountCol, percentage: number) => {
    const col = activeCol;
    if (isFrozen(col) || isWaiting(col) || !startSources.some((c) => c.measure === source)) return;
    pinActive();
    setError(null);
    setModeSwitch(null);
    setAlsoOpen(false);
    setStartNote(null);
    writePanel(() => ({ body: { kind: 'copy', year, source, measure: col, percentage }, columns: [col] })).then((outcome) => {
      if (outcome.status !== 'saved') return;
      // The column shows how it is built now: an amount copied, or the lines it follows.
      setModeChoice((prev) => { const next = { ...prev }; delete next[col]; return next; });
      if (outcome.data?.copy?.prorated) setStartNote({ col, year, source });
      if (activeColRef.current !== col || yearRef.current !== year) return;
      setSpreadDates(null);
      setSpreadWhen(null);
      setSpreadProfile(profileOf(col, outcome.data?.round_inputs ?? roundInputsRef.current));
      if (Array.isArray(outcome.data?.items)) showSpreadAmount(amountOrEmpty(sumCents(centsByColumn(year, outcome.data!.items!)[col])));
    }).catch((e) => {
      if (e instanceof UnsavedEditsError) return;
      setError(getApiErrorMessage(e, t, t(`${config.i18nPrefix}.budget.failedToSave`)));
    });
  };

  /* ---- The result table: shown when it teaches something, and the difference with a column (lot F2) ---- */

  // A column the table teaches nothing about: empty, or an amount spread flat over the whole year.
  const plainColumn = (col: AmountCol) => {
    if (isWaiting(col) || modeOf(col) !== 'amount') return false;
    const record = recordFor(col);
    if ((record?.lines.length ?? 0) > 0) return false;
    // Nothing entered, a record of zeros included.
    if (isEmptyColumn(col)) return true;
    // Amounts with no record, a copy, a quarterly spread: their months may have any shape.
    if (!record || record.method !== 'spread' || record.last_calculation?.kind === 'quarterly') return false;
    return isWholeYear(year, { start: record.period_start, end: record.period_end }) && (record.spread_profile_name ?? 'flat') === 'flat';
  };
  const gridAuto = !loaded || !shown.every((c) => plainColumn(c.measure));
  // « Show / Hide the detail »: the user's choice for the visit, else the rule above. Always open
  // while a column waits for a choice (its months are shown there) or the active column is typed by month.
  const [gridChoice, setGridChoice] = React.useState<boolean | null>(null);
  const gridForced = waitingColumns.length > 0 || activeMode === 'monthly';
  const gridOpen = gridForced ? true : (gridChoice ?? gridAuto);
  const toggleGrid = () => setGridChoice(!gridOpen);
  // Typed by month: the table opens, the months are typed there.
  function openGrid() { setGridChoice((prev) => (prev === false ? true : prev)); }
  const allEmpty = shown.every((c) => isEmptyColumn(c.measure));
  // « Difference with »: the column picked for the visit, else the tenant's default column.
  const [diffPick, setDiffPick] = React.useState<AmountCol | null>(null);
  const defaultMeasure = budgetColumns.defaultColumn.measure;
  const diffCol: AmountCol = diffPick && shown.some((c) => c.measure === diffPick)
    ? diffPick
    : (shown.some((c) => c.measure === defaultMeasure) ? defaultMeasure : shown[0].measure);

  /* ---- The user's choice for a column waiting after a refused save (lot 3D) ---- */

  const dropWaiting = (cols: Iterable<AmountCol>) => {
    const gone = new Set(cols);
    setWaiting(waitingRef.current.filter((c) => !gone.has(c.measure)));
  };
  // Nothing waits any more: the autosave leaves its `conflict` state.
  const settleChoices = () => {
    if (waitingRef.current.length === 0 && !parkedPanelRef.current) autosaveRef.current.resetConflict();
  };
  // Their months on screen and as the base, the user's edits there dropped: the whole column, or only
  // `cells` (the refused months of a monthly entry; the column's other months keep what is typed or saved).
  const takeTheirs = (conflict: BudgetConflict, cells: ReadonlySet<string> | null = null) => {
    const col = conflict.measure;
    const mine = (period: string) => cells === null || cells.has(period);
    dirtyCellsRef.current.forEach((cols, period) => {
      if (!mine(period)) return;
      cols.delete(col);
      editedAtRef.current.delete(`${period}:${col}`);
      if (cols.size === 0) dirtyCellsRef.current.delete(period);
    });
    yearPeriodsOf(year).forEach((period, i) => {
      if (mine(period)) serverMonthsRef.current[col][i] = conflict.current[i];
    });
    if (conflict.currentLines) serverLinesRef.current[col] = conflict.currentLines;
    setMonths((prev) => prev.map((row, i) => (mine(row.period) ? { ...row, [col]: conflict.current[i] / 100 } : row)));
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
    restoreRef.current = null;
    if (conflict.source === 'restore') {
      // A restore of the opening values someone else's change stopped: « Overwrite » sends it again
      // over the column as the server answered it; « Reload the column » keeps theirs.
      const body = parkedRestoresRef.current.get(col);
      parkedRestoresRef.current.delete(col);
      dropWaiting([col]);
      if (choice === 'mine' && body) {
        const base = { columns: { [col]: { months: monthsBase(conflict.current), lines: conflict.currentLines ?? serverLinesRef.current[col] } } };
        const forYear = year;
        setResolving(true);
        void enqueueWrite(() => sendRestore(col, body, base)).then(async (outcome) => {
          if (outcome.status === 'conflict') return;
          settleChoices();
          if (outcome.status === 'frozen') setError(t('budgetTab.restore.frozenNow', { column: labelFor(col) }));
          if (outcome.status === 'refused') setError(outcome.message);
          if (outcome.status !== 'restored' || yearRef.current !== forYear) return;
          await loadRef.current({ quietSince: editSeqRef.current });
          const opening = openingOfYear(forYear);
          if (opening) afterRestored([col], opening);
        }).finally(() => setResolving(false));
        return;
      }
      takeTheirs(conflict);
      setModeChoice((prev) => { const next = { ...prev }; delete next[col]; return next; });
      if (activeColRef.current === col) {
        setSpreadDates(null);
        setSpreadWhen(null);
        showSpreadAmount(amountOrEmpty(sumCents(conflict.current)));
      }
      settleChoices();
      void loadRef.current({ quietSince: editSeqRef.current }).then(() => setLinesReload((n) => n + 1));
      return;
    }
    if (conflict.source === 'grid') {
      if (choice === 'mine') {
        // « Overwrite »: the waiting months go again over theirs, from what the server answered. The
        // months the user did not type show theirs too; a month typed and not refused keeps its base.
        const dirtyHere = (period: string) => !!dirtyCellsRef.current.get(period)?.has(col);
        const waits = (period: string) => conflict.cells === null || conflict.cells.has(period);
        yearPeriodsOf(year).forEach((period, i) => {
          if (waits(period) || !dirtyHere(period)) serverMonthsRef.current[col][i] = conflict.current[i];
        });
        setMonths((prev) => prev.map((row, i) => (dirtyHere(row.period) ? row : { ...row, [col]: conflict.current[i] / 100 })));
        dropWaiting([col]);
        autosaveRef.current.schedule(persistRef.current);
      } else {
        // « Reload the column »: their values where the choice waited; the column's other months stay.
        takeTheirs(conflict, conflict.cells);
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
      // Their column: the panel's write is dropped whole, its lines start again from the stored ones,
      // and the column shows how it is built now.
      parkedPanelRef.current = null;
      dropWaiting(parked.columns);
      takeTheirs(conflict);
      setModeChoice((prev) => { const next = { ...prev }; delete next[col]; return next; });
      if (activeColRef.current === col) {
        setSpreadDates(null);
        setSpreadWhen(null);
        showSpreadAmount(amountOrEmpty(sumCents(conflict.current)));
      }
      settleChoices();
      void loadRef.current({ quietSince: editSeqRef.current }).then(() => setLinesReload((n) => n + 1));
      return;
    }
    // Their column for a column the write also went to: the write goes on without it.
    const also = ((parked.body.also_measures as AmountCol[] | undefined) ?? []).filter((m) => m !== col);
    delete base.columns[col];
    parked.body = { ...parked.body, base, also_measures: also };
    parked.columns.delete(col);
    dropWaiting([col]);
    sendParkedPanel();
  };

  /* ---- « Back to the opening values » (lot F2) ---- */

  // One column back to its opening values (`kind: 'restore'`): its twelve months and its record as
  // first read, over `base`: the column as this screen's last write left it (or as the server
  // answered a refused restore, for « Overwrite »). A 409 parks the restore for the user's choice:
  // nothing of the other person is overwritten. The caller holds the queue.
  async function sendRestore(col: AmountCol, body: Record<string, unknown>, base: Record<string, unknown>): Promise<RestoreOutcome> {
    const sentBase = base;
    try {
      markYearStaleRef.current();
      const v = await ensureVersion('annual');
      writeGenRef.current += 1;
      const res = await api.post<BulkUpsertResponse>(`${config.versionsApi}/${v.id}/amounts/bulk-upsert`, { ...body, base: sentBase });
      noteRev(year, res?.data?.budget_rev);
      keepRoundInputs(res?.data);
      keepWritten(res?.data, [col]);
      noteWrittenRef.current(year, res?.data, wholeColumns([col]));
      forgetAllocationsYear(queryClient, config.itemsApi, id, year);
      invalidateBudgetLists(queryClient);
      return { status: 'restored' };
    } catch (e) {
      const conflict = budgetConflictsOf(e)?.find((c) => c.measure === col) ?? null;
      if (conflict) {
        parkedRestoresRef.current.set(col, body);
        setWaiting([...waitingRef.current.filter((c) => c.measure !== col), { ...conflict, source: 'restore', cells: null }]);
        return { status: 'conflict', conflict };
      }
      if ((e as { response?: { status?: number } } | null)?.response?.status === 403) {
        // Frozen meanwhile: the freeze state follows, the column turns read only.
        void queryClient.invalidateQueries({ queryKey: ['freeze-state', year] });
        return { status: 'frozen' };
      }
      return { status: 'refused', message: getApiErrorMessage(unreadableConflict(e) ?? e, t, t('budgetTab.restore.failed')) };
    }
  }

  // The restored columns show how they are built now, the editor and the lines start again from them.
  function afterRestored(cols: AmountCol[], opening: OpeningYear) {
    setModeChoice((prev) => { const next = { ...prev }; cols.forEach((col) => { delete next[col]; }); return next; });
    setModeSwitch(null);
    setAlsoOpen(false);
    setStartNote(null);
    const active = activeColRef.current;
    if (cols.includes(active)) {
      setSpreadDates(null);
      setSpreadWhen(null);
      setSpreadProfile(opening.columns[active].record?.spread_profile_name === '4-4-5' ? '4-4-5' : 'flat');
      showSpreadAmount(amountOrEmpty(sumCents(opening.columns[active].months)));
    }
    setLinesReload((n) => n + 1);
  }

  // A shown column whose months or record are no longer what the visit first read.
  const differsFromOpening = (opening: OpeningYear, col: AmountCol, cents: readonly number[], record: RoundInput | null | undefined) => (
    cents.some((value, i) => value !== opening.columns[col].months[i]) || recordSignature(record) !== recordSignature(opening.columns[col].record)
  );
  const opening = loaded ? openingOfYear(year) : null;
  // Counted: the columns this screen wrote that are no longer at their opening values (only those can go back).
  const changedColumns: AmountCol[] = opening
    ? shown.map((c) => c.measure).filter((col) => !!opening.written[col] && differsFromOpening(opening, col, months.map((row) => toCents(row[col])), recordFor(col)))
    : [];

  const [restoring, setRestoring] = React.useState(false);
  const [restoreNotice, setRestoreNotice] = React.useState<RestoreNotice | null>(null);
  // No confirmation (fried): what is under way goes first (the months typed, the writes queued), then
  // one restore per column this screen changed, over its last write of it, each refused on its own
  // (frozen, changed by someone else since, a calendar), then a normal reload. A column waiting for
  // the user's choice is left as it is; one changed by someone else only is never sent.
  const restoreOpening = async () => {
    const forYear = year;
    const start = openingOfYear(forYear);
    if (!start || restoringRef.current || !loaded) return;
    const columns = shown.map((c) => c.measure);
    // What the screen showed as changed when clicked, written by this screen or not (a month waiting for a choice).
    const clicked = columns.filter((col) => differsFromOpening(start, col, months.map((row) => toCents(row[col])), recordFor(col)));
    restoringRef.current = true;
    setRestoring(true);
    setRestoreNotice(null);
    setError(null);
    try {
      // A choice waiting on a column does not stop the others. A save that failed does: said, nothing sent.
      const flushed = await flushAll({ ignoreHeld: true });
      if (yearRef.current !== forYear) return;
      if (!flushed) {
        setRestoreNotice({ notRun: true, restored: [], skipped: [] });
        return;
      }
      const notice: RestoreNotice = { restored: [], skipped: [] };
      for (const col of columns) {
        // As the server holds it now that nothing is under way.
        const differs = differsFromOpening(start, col, serverMonthsRef.current[col], roundInputsRef.current.find((r) => r.measure === col));
        if (isWaiting(col)) {
          if (differs || clicked.includes(col)) notice.skipped.push({ col, reason: 'waiting' });
          continue;
        }
        if (!differs) continue;
        const mine = start.written[col];
        if (!mine) {
          // Someone else's change, already on screen: said, never sent. When, if its record moved since the opening.
          const now = roundInputsRef.current.find((r) => r.measure === col);
          const recordMoved = recordSignature(now) !== recordSignature(start.columns[col].record);
          const at = recordMoved && now?.updated_at && Date.parse(now.updated_at) >= start.at ? now.updated_at : null;
          notice.skipped.push({ col, reason: 'others', at });
          continue;
        }
        if (frozenRef.current[FREEZE_KEY[col]]) { notice.skipped.push({ col, reason: 'frozen' }); continue; }
        const body = { kind: 'restore', year: forYear, measure: col, months: monthsBase(start.columns[col].months), record: start.columns[col].record };
        const base = { columns: { [col]: { months: monthsBase(mine.months), lines: mine.lines } } };
        const outcome = await enqueueWrite(() => sendRestore(col, body, base));
        if (outcome.status === 'restored') notice.restored.push(col);
        else if (outcome.status === 'conflict') notice.skipped.push({ col, reason: 'changed', conflict: outcome.conflict });
        else if (outcome.status === 'frozen') notice.skipped.push({ col, reason: 'frozen' });
        else notice.skipped.push({ col, reason: 'refused', message: outcome.message });
        if (yearRef.current !== forYear) return;
      }
      if (notice.restored.length > 0) {
        await loadRef.current({ quietSince: editSeqRef.current });
        if (yearRef.current !== forYear) return;
        afterRestored(notice.restored, start);
      }
      setRestoreNotice(notice);
    } finally {
      restoringRef.current = false;
      setRestoring(false);
    }
  };
  // The notice belongs to the year it was given for.
  React.useEffect(() => { setRestoreNotice(null); setStartNote(null); }, [year]);

  // Totals per column: the live sum of its months.
  const totals = React.useMemo<Record<AmountCol, number>>(() => perColumn((col) => monthsCents(months, col) / 100), [months]);

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
  // A column waiting for the user's choice is read-only and tinted, here and in the banner's list.
  const waitingSet = new Set<AmountCol>([
    ...waitingColumns.map((c) => c.measure),
    ...(parkedPanelRef.current ? [...parkedPanelRef.current.columns] : []),
  ]);
  // This month waits for a choice: the whole column, or one of its refused months.
  const cellWaits = (period: string, col: AmountCol) => {
    if (parkedPanelRef.current?.columns.has(col)) return true;
    const entry = waitingColumns.find((c) => c.measure === col);
    return !!entry && (entry.cells === null || entry.cells.has(period));
  };
  const monthName = (period: string) => new Date(year, monthIndexOf(period), 1).toLocaleString(locale, { month: 'short' });
  const yearSide = (cents: readonly number[], lineCount: number | null) => {
    const amount = fmt(sumCents(cents) / 100);
    return lineCount === null ? t('budgetTab.conflict.yearTotal', { amount }) : t('budgetTab.conflict.yearTotalLines', { amount, count: lineCount });
  };
  // The banner shows what really waits: the refused months of a monthly entry (their value, the
  // user's value on screen), else the column's year, with its number of lines when lines were compared.
  const bannerConflicts: EditConflict[] = waitingColumns.map((c) => {
    const parkedLines = c.source === 'panel' && c.currentLines ? parkedPanelRef.current?.body.lines : undefined;
    const waitingMonths = c.cells ? [...c.cells].sort() : null;
    const monthsSide = (value: (period: string) => number) => waitingMonths!.map((p) => `${monthName(p)} ${fmt(value(p))}`).join(' · ');
    return {
      field: c.measure,
      base: null,
      current: c.measure,
      mine: c.measure,
      labels: {
        base: null,
        current: waitingMonths
          ? monthsSide((p) => c.current[monthIndexOf(p)] / 100)
          : yearSide(c.current, c.currentLines ? c.currentLines.length : null),
        mine: waitingMonths
          ? monthsSide((p) => Number(months[monthIndexOf(p)]?.[c.measure] || 0))
          : yearSide(c.mine, Array.isArray(parkedLines) ? parkedLines.length : null),
      },
      changed_by: c.changed_by,
      changed_at: c.changed_at,
    };
  });

  const savingHint = writesPending > 0 || autosave.status === 'saving' || autosave.status === 'pending'
    ? t('common:status.saving', 'Saving…')
    : autosave.status === 'saved' ? t('common:status.saved', 'Saved') : null;

  const parked = parkedPanelRef.current;

  return {
    t,
    locale,
    year,
    loading,
    loaded,
    error,
    setError,
    shown,
    labelFor,
    frozen,
    isFrozen,
    anyFrozen,
    readOnly,
    readOnlyInAccess,
    months,
    totals,
    liveTotals,
    roundInputs,
    recordFor,
    storedAmounts,
    periodFor,
    suggestion,
    activeCol,
    activeMode,
    modeOf,
    selectColumn,
    requestMode,
    modeSwitch,
    cancelModeSwitch,
    confirmModeSwitch,
    onCellClick,
    currentCents,
    isEmptyColumn,
    waitingSet,
    isWaiting,
    cellWaits,
    bannerConflicts,
    onConflictChoice,
    resolving,
    userId,
    savingHint,
    handleYearChange,
    // The amount editor.
    amountInputRef,
    spreadAmount,
    onSpreadAmountChange,
    commitSpreadAmount,
    commitSpread,
    spreadProfile,
    onSpreadProfileChange,
    spreadPeriod,
    defaultPeriod,
    periodChange,
    spreadKind,
    onSpreadWhenChange,
    onSpreadDateChange,
    onSpreadSingleDateChange,
    spreadProblem,
    spreadActive,
    spreadBeyondItem,
    // Lines.
    saveLines,
    reuseLines,
    linesReload,
    linesPendingRef,
    parkedLines: parked?.main === activeCol && parked.body.kind === 'lines' ? parked.body.lines as LinePayload[] : undefined,
    // Month by month.
    stableMonthChange,
    registerCell,
    clearColumn,
    // « Use for other columns too ».
    alsoOffered,
    alsoOpen,
    alsoTargets,
    alsoChecked,
    keepLinesColumns,
    openAlso,
    closeAlso: () => setAlsoOpen(false),
    toggleAlso,
    applyAlso,
    // « Start from ».
    startSources,
    startFrom,
    startNote: startNote && startNote.col === activeCol && startNote.year === year ? startNote : null,
    // The result table.
    gridOpen,
    gridForced,
    toggleGrid,
    allEmpty,
    diffCol,
    setDiffCol: setDiffPick,
    // « Back to the opening values ».
    changedColumns,
    openingAt: opening?.at ?? null,
    restoring,
    restoreOpening,
    restoreNotice,
    closeRestoreNotice: () => setRestoreNotice(null),
  };
}

export type BudgetTabState = ReturnType<typeof useBudgetTab>;
