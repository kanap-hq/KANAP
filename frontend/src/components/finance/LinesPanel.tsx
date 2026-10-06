import React from 'react';
import { Box, Button, Checkbox, FormControlLabel, IconButton, Link, MenuItem, Switch, TextField, Tooltip, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useLocale } from '../../i18n/useLocale';
import { WORKING_DAY_PROFILES_QUERY_KEY, useWorkingDayProfiles, workingDayProfileYearKey } from '../../hooks/useWorkingDayProfiles';
import { getWorkingDayProfileYear, type WorkingDayProfile } from '../../services/workingDayProfiles';
import { useAuth } from '../../auth/AuthContext';
import FormattedNumberField from '../inputs/FormattedNumberField';
import DateEUField from '../fields/DateEUField';
import { FieldLabel } from '../design';
import { drawerMenuItemSx, inlineControlSx, selectKeepsFocus, tableCellFieldSx, tableCellTextFieldSx } from '../../theme/formSx';
import {
  AmountMeasure,
  BASES_BY_UNIT,
  DEFAULT_FREQUENCY,
  DateProblem,
  FREQUENCIES_BY_UNIT,
  Frequency,
  LinePayload,
  LinesCalculation,
  Period,
  PeriodProblem,
  PriceBasis,
  QUANTITY_UNITS,
  QuantityUnit,
  RoundInput,
  RoundLine,
  basisForUnit,
  changedDays,
  countsFte,
  dateProblem,
  dayChangeText,
  followsLines,
  formatFteValue,
  formatMoney,
  hasLines,
  isDateLine,
  linePayloadOf,
  periodProblem,
  sameLine,
  takesDaysPerMonth,
  trimDecimal,
  wholeYear,
} from './roundPeriod';

const CALENDARS_PATH = '/master-data/working-day-calendars';

/**
 * The least width of each column of the lines table, in px: what a field needs to read whole
 * ("31 Dec 2026", "United States", a price with "per month" after it). The description is fixed:
 * the fields stay next to it on a wide screen, and the filler column before Amount takes the free
 * width. A narrower panel scrolls the table sideways instead of squeezing the fields.
 * The unit price is its number field (`UNIT_PRICE_NUMBER_WIDTH`), then what the price is for: the
 * people select needs 83 px for its longest word ("per month", "pro Monat") and its arrow.
 */
export const LINE_COLUMN_WIDTHS = {
  number: 22,
  description: 220,
  quantity: 80,
  unit: 125,
  unitPrice: 177,
  often: 290,
  from: 150,
  to: 150,
  calendar: 135,
  amount: 90,
  remove: 28,
} as const;
export const UNIT_PRICE_NUMBER_WIDTH = 80;
/** The frequency select ("per month", "une fois", "pro Jahr"): its longest choice and its arrow. */
export const OFTEN_SELECT_MAX_WIDTH = 160;
/** The `×` between the quantity and its unit price, on the first row of a line. */
export const LINE_MUL_WIDTH = 14;
/** Between two fields of a line: the table's cells carry half of it each, the grid of the second row uses it whole. */
export const LINE_COLUMN_GAP = 8;
/**
 * The connector words of a line's second row ("from", "to", "calendar"): fixed tracks, so the dates
 * and the calendars start at the same place from one line to the next whatever the word, and the
 * "on" of a line bought once sits in the "from" track.
 */
export const LINE_WORD_WIDTHS = { from: 36, to: 28, calendar: 68 } as const;
/**
 * The second row of a line reads as a sentence: how often under the description, then a word and
 * its field. The gutter track is the line number column less the half gap its cells carry. How
 * often keeps its `often` width: "Tiempo completo" and "días por mes" together need more than the
 * description's 220 px, and the track is the same for every line at any length.
 */
export const LINE_SECOND_ROW_WIDTHS = [
  LINE_COLUMN_WIDTHS.number - LINE_COLUMN_GAP / 2,
  LINE_COLUMN_WIDTHS.often,
  LINE_WORD_WIDTHS.from, LINE_COLUMN_WIDTHS.from,
  LINE_WORD_WIDTHS.to, LINE_COLUMN_WIDTHS.to,
  LINE_WORD_WIDTHS.calendar, LINE_COLUMN_WIDTHS.calendar,
] as const;
/** The second row when how often goes up to the first: the dates and the calendar, under the description. */
export const LINE_TIMING_ROW_WIDTHS = LINE_SECOND_ROW_WIDTHS.filter((_, index) => index !== 1);
export const LINES_TABLE_MIN_WIDTH = Object.values(LINE_COLUMN_WIDTHS).reduce((sum, width) => sum + width, 0);
const gridWidth = (tracks: readonly number[]) => tracks.reduce((sum, width) => sum + width, 0) + LINE_COLUMN_GAP * (tracks.length - 1);
const PRICED_ROW_WIDTH = LINE_COLUMN_WIDTHS.number + LINE_COLUMN_WIDTHS.description + LINE_COLUMN_WIDTHS.quantity
  + LINE_COLUMN_WIDTHS.unit + LINE_MUL_WIDTH + LINE_COLUMN_WIDTHS.unitPrice + LINE_COLUMN_WIDTHS.amount + LINE_COLUMN_WIDTHS.remove;

/**
 * A panel narrower than `LINES_TABLE_MIN_WIDTH` gives each line two rows: the calculation (number,
 * description, quantity, unit, ×, unit price, amount), then the sentence of `LINE_SECOND_ROW_WIDTHS`.
 * The table then needs the wider of the two rows. With room for it (`LINES_OFTEN_FIRST_MIN_WIDTH`),
 * how often goes up to the first row, after the unit price: the second row keeps the dates and the
 * calendar (`LINE_TIMING_ROW_WIDTHS`).
 */
export const LINES_TWO_ROWS_MIN_WIDTH = Math.max(PRICED_ROW_WIDTH, gridWidth(LINE_SECOND_ROW_WIDTHS));
export const LINES_OFTEN_FIRST_MIN_WIDTH = Math.max(PRICED_ROW_WIDTH + LINE_COLUMN_WIDTHS.often, gridWidth(LINE_TIMING_ROW_WIDTHS));

/**
 * How many of `minWidths` (ascending) the box the returned ref is put on reaches, followed as it
 * resizes (the window, the properties drawer opened or closed), at most once a frame. A box without
 * layout (not shown yet, or in tests) reaches them all.
 */
function useWidthTier(minWidths: readonly number[]): [(node: HTMLElement | null) => void, number] {
  const [tier, setTier] = React.useState(minWidths.length);
  const stop = React.useRef<(() => void) | null>(null);
  const ref = React.useCallback((node: HTMLElement | null) => {
    stop.current?.();
    stop.current = null;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const width = node.clientWidth;
      if (width > 0) setTier(minWidths.filter((min) => width >= min).length);
    };
    measure();
    // A drag of the drawer resizes the box many times a frame: only the last size is measured.
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    observer.observe(node);
    stop.current = () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [minWidths]);
  return [ref, tier];
}

/**
 * A field of the budget tab's panels, label above. It is `width` wide, wider when its label needs
 * more: the label stays on one line, so a row of fields keeps one baseline in every language.
 */
export function PanelField({ label, width, children }: { label: string; width: number; children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: '0 0 auto', minWidth: width }}>
      <FieldLabel sx={{ mb: '2px', whiteSpace: 'nowrap' }}>{label}</FieldLabel>
      {/* No width of its own: the field fills what the label and `width` give. */}
      <Box sx={{ width: 0, minWidth: '100%' }}>{children}</Box>
    </Box>
  );
}

/** From and To of a panel, kept together: a narrow row wraps the period as a whole. */
export function PanelPeriod({ children }: { children: React.ReactNode }) {
  return <Box sx={{ display: 'flex', alignItems: 'flex-end', columnGap: 1.5 }}>{children}</Box>;
}

/** A line as typed. It is saved once complete; until then it stays here only. */
export type LineDraft = {
  key: string;
  label: string;
  unit: QuantityUnit;
  quantity: string;
  unitPrice: string;
  basis: PriceBasis;
  frequency: Frequency;
  /** People priced per day: full time (the calendar's working days), or the days typed here each month. */
  fullTime: boolean;
  daysPerMonth: string;
  /** From and To; one date (pieces bought once) is both. */
  start: string;
  end: string;
  /** Kept when the price is no longer per day, so switching back finds it again. */
  calendarId: string;
};

let draftSeq = 0;
const newDraftKey = () => `draft-${++draftSeq}`;

/** Where the focus goes once drawn: a line's Description, or Add a line. */
const ADD_LINE = 'add-line';

function draftOf(line: RoundLine): LineDraft {
  return {
    key: line.id || newDraftKey(),
    label: line.label ?? '',
    unit: line.quantity_unit,
    quantity: trimDecimal(line.quantity),
    unitPrice: trimDecimal(line.unit_price),
    basis: line.price_basis,
    frequency: line.frequency ?? DEFAULT_FREQUENCY[line.quantity_unit],
    fullTime: takesDaysPerMonth(line) && line.days_per_month == null,
    daysPerMonth: line.days_per_month != null ? trimDecimal(line.days_per_month) : '',
    start: line.period_start,
    end: line.period_end,
    calendarId: line.working_day_profile_id ?? '',
  };
}

/** True when the line takes one date instead of From and To: pieces bought once. */
export function isDateDraft(draft: Pick<LineDraft, 'unit' | 'frequency' | 'start' | 'end'>): boolean {
  return isDateLine({ quantity_unit: draft.unit, frequency: draft.frequency, period_start: draft.start, period_end: draft.end });
}

/** True when the line asks for days per month or Full time: people priced per day. */
function asksDays(draft: Pick<LineDraft, 'unit' | 'basis'>): boolean {
  return takesDaysPerMonth({ quantity_unit: draft.unit, price_basis: draft.basis });
}

export type LineProblem = PeriodProblem | DateProblem | 'incomplete' | 'chooseDays' | 'chooseCalendar';

/** Why a line cannot be saved yet, or null when it is complete. */
export function lineProblem(year: number, draft: LineDraft): LineProblem | null {
  if (draft.quantity === '' || draft.unitPrice === '') return 'incomplete';
  if (asksDays(draft) && !draft.fullTime && draft.daysPerMonth === '') return 'chooseDays';
  const period = isDateDraft(draft) ? dateProblem(year, draft.start) : periodProblem(year, draft.start, draft.end);
  if (period) return period;
  if (draft.basis === 'per_day' && !draft.calendarId) return 'chooseCalendar';
  return null;
}

function payloadOf(draft: LineDraft): LinePayload {
  return linePayloadOf({
    label: draft.label,
    quantity_unit: draft.unit,
    quantity: draft.quantity,
    unit_price: draft.unitPrice,
    price_basis: draft.basis,
    frequency: draft.frequency,
    days_per_month: asksDays(draft) && !draft.fullTime ? draft.daysPerMonth : null,
    period_start: draft.start,
    period_end: draft.end,
    working_day_profile_id: draft.calendarId || null,
  });
}

/**
 * The calendar a new line starts with: the standard calendar of the paying company's country (the
 * whole country, not a region), else the first enabled calendar, else none.
 */
export function defaultCalendarId(enabled: WorkingDayProfile[], country: string | null | undefined): string {
  const code = (country ?? '').trim().toUpperCase();
  const standard = code ? enabled.find((c) => c.country_iso === code && !c.region_code) : undefined;
  return (standard ?? enabled[0])?.id ?? '';
}

/**
 * The server numbers the lines it is sent, the complete ones only ("Line 2: ..."); the table numbers
 * every row. `rows` gives the table index of each line sent.
 */
export function tableLineMessage(message: string, rows: number[]): string {
  return message.replace(/^Line (\d+):/, (whole, sent: string) => {
    const row = rows[Number(sent) - 1];
    return row === undefined ? whole : `Line ${row + 1}:`;
  });
}

/**
 * A save of the lines: fine (with the server's warnings, if any), refused with a sentence, or held
 * for the user's choice (someone else changed the column meanwhile, lot 3D: the budget tab shows the
 * choice; the drafts stay as typed).
 */
export type LinesSaveResult = { ok: true; warnings?: string[] } | { ok: false; error: string } | { ok: false; conflict: true };

export type LinesPanelProps = {
  year: number;
  /** The column's stored record, with its lines when it has some. */
  record: RoundInput | undefined;
  /** The period a new line starts with (the column's, within the item's dates); the whole year when null. */
  period: Period | null;
  /** The item's dates, for the note when a line goes beyond them. */
  itemStart?: string | null;
  itemEnd?: string | null;
  frozen: boolean;
  frozenHint: string;
  /** The column waits for the user's choice after a refused save: the drafts are kept as they are. */
  waiting?: boolean;
  /** Changed by « Reload the column »: the drafts start again from the stored lines, whatever is typed. */
  reloadSignal?: number;
  /** The lines the panel opens on instead of the stored ones: a refused write still waiting for a choice. */
  startLines?: LinePayload[];
  /** The paying company's country: its standard calendar is the default of a new line. */
  payingCompanyCountry?: string | null;
  /**
   * Filled with a probe the budget tab asks before showing what someone else changed (lot 3G): true
   * while a line is not complete, not sent, or on its way.
   */
  pendingRef?: React.MutableRefObject<(() => boolean) | null>;
  /** The tenant's name of a column, for "copied from". */
  columnName: (measure: AmountMeasure) => string;
  /** "Apply these lines to all columns": offered when the group has other columns that are not frozen. */
  applyToAll: { offered: boolean; on: boolean; hint: string; onChange: (on: boolean) => void };
  /**
   * Writes every complete line of the column (and of the group when `applyToAll`), then reloads.
   * `startedFrom`: the stored lines the drafts started from, the base of the write (lot 3D).
   */
  onSave: (lines: LinePayload[], applyToAll: boolean, startedFrom: LinePayload[]) => Promise<LinesSaveResult>;
  /**
   * One row per line (`wide`), two with how often on the first (`medium`), two with how often on the
   * second (`narrow`), or `auto`: the first of these the panel has room for. Fixed for the specs,
   * which have no layout.
   */
  layout?: 'wide' | 'medium' | 'narrow' | 'auto';
};

/** The widths `auto` switches at: how often on the first row, then one row per line. */
const LAYOUT_MIN_WIDTHS = [LINES_OFTEN_FIRST_MIN_WIDTH, LINES_TABLE_MIN_WIDTH] as const;

/**
 * "Quantity and price": the column as a table of lines, each a quantity times a unit price. Every
 * committed field saves the column's complete lines at once (no button); the amounts come from the
 * server. A line that is not complete yet stays here until it is.
 */
export default function LinesPanel({
  year, record, period, itemStart, itemEnd, frozen, frozenHint, waiting = false, reloadSignal = 0, startLines,
  payingCompanyCountry, pendingRef, columnName, applyToAll, onSave, layout = 'auto',
}: LinesPanelProps) {
  const { t } = useTranslation(['ops', 'common']);
  const locale = useLocale();
  const { hasLevel } = useAuth();
  const calendars = useWorkingDayProfiles();
  const queryClient = useQueryClient();

  const storedLines = React.useMemo(() => record?.lines ?? [], [record]);
  // Lines kept as a reference (stored lines, amounts from a spread, a hand edit or a copy): read-only
  // until « Use the lines again » computes the column from them.
  const reference = hasLines(record) && !followsLines(record);
  const readOnly = frozen || reference;
  const [drafts, setDrafts] = React.useState<LineDraft[]>(() => (startLines ? startLines.map((line) => draftOf(line as RoundLine)) : storedLines.map(draftOf)));
  const draftsRef = React.useRef(drafts);
  // What the server holds (or was last asked to hold): a commit that would send the same lines writes nothing.
  const sentRef = React.useRef(JSON.stringify((startLines ?? storedLines).map(linePayloadOf)));
  // The stored lines the drafts started from: the base of the next write (someone else's change meanwhile is a conflict).
  const startedFromRef = React.useRef<LinePayload[]>(storedLines.map(linePayloadOf));
  // Saves on their way: the drafts are not replaced by stored lines meanwhile.
  const inFlightRef = React.useRef(0);
  // A commit made while a save is on its way (quick clicks on a date's arrows): sent once that save
  // answered, from the lines it stored. Sent at once, it would start from the lines before that save
  // and be refused as someone else's change.
  const queuedRef = React.useRef<{ force?: boolean; applyToAll?: boolean } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const update = (change: (prev: LineDraft[]) => LineDraft[]): LineDraft[] => {
    const next = change(draftsRef.current);
    draftsRef.current = next;
    setDrafts(next);
    return next;
  };

  const send = (next: LineDraft[], options: { force?: boolean; applyToAll?: boolean } = {}) => {
    if (frozen) return;
    const rows = next.flatMap((d, index) => (lineProblem(year, d) ? [] : [index]));
    const lines = rows.map((index) => payloadOf(next[index]));
    // Lines that are all incomplete stay here: only removing the last line clears the column's lines.
    if (lines.length === 0 && next.length > 0) return;
    const signature = JSON.stringify(lines);
    if (!options.force && signature === sentRef.current) return;
    if (inFlightRef.current > 0) {
      const queued = queuedRef.current;
      queuedRef.current = { force: !!(queued?.force || options.force), applyToAll: options.applyToAll ?? queued?.applyToAll };
      return;
    }
    sentRef.current = signature;
    inFlightRef.current += 1;
    void onSave(lines, options.applyToAll ?? applyToAll.on, startedFromRef.current).then((result) => {
      inFlightRef.current -= 1;
      const queued = queuedRef.current;
      queuedRef.current = null;
      if (result.ok) {
        setError(null);
        // The column now holds these lines: the next write starts from them.
        startedFromRef.current = lines;
        // The latest drafts, committed meanwhile, go now with this base.
        if (queued) sendRef.current(draftsRef.current, queued);
        // The only warning is a disabled calendar: the note under the table comes from the calendars
        // list, refreshed here in case it was disabled since the list was loaded.
        if (result.warnings?.length) void queryClient.invalidateQueries({ queryKey: WORKING_DAY_PROFILES_QUERY_KEY });
      } else if ('conflict' in result) {
        // Held for the user's choice, shown by the budget tab: the drafts stay as sent.
        setError(null);
      } else {
        setError(tableLineMessage(result.error, rows));
        // Refused: the next commit sends the same lines again.
        if (sentRef.current === signature) sentRef.current = '';
      }
    });
  };

  const sendRef = React.useRef(send);
  sendRef.current = send;

  // The stored lines change (a save of this panel, someone else's save shown by a reload, a column
  // reloaded): when nothing is pending here (every line complete and sent, no save on its way, no
  // choice waiting), the drafts become the stored lines, so a later edit starts from them and never
  // sends back lines someone else replaced (plan planning/perf-scale, scenario 4). Rows keep their
  // place, so a field being tabbed through is not drawn again. « Reload the column » always does it.
  const reloadSeenRef = React.useRef(reloadSignal);
  React.useEffect(() => {
    const stored = (record?.lines ?? []).map(linePayloadOf);
    const storedSignature = JSON.stringify(stored);
    const forced = reloadSeenRef.current !== reloadSignal;
    reloadSeenRef.current = reloadSignal;
    if (!forced) {
      if (waiting || inFlightRef.current > 0) return;
      const current = draftsRef.current;
      if (current.some((d) => lineProblem(year, d))) return;
      const signature = JSON.stringify(current.map(payloadOf));
      if (signature !== sentRef.current) return;
      if (signature === storedSignature) {
        startedFromRef.current = stored;
        return;
      }
    }
    const previous = draftsRef.current;
    update(() => (record?.lines ?? []).map((line, index) => ({ ...draftOf(line), key: previous[index]?.key ?? draftOf(line).key })));
    sentRef.current = storedSignature;
    startedFromRef.current = stored;
    setError(null);
    // `update` only sets state and a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record, waiting, reloadSignal, year]);

  // The same test as the resync above: nothing here differs from what the server was asked to hold.
  React.useEffect(() => {
    if (!pendingRef) return undefined;
    const probe = () => inFlightRef.current > 0
      || draftsRef.current.some((d) => lineProblem(year, d))
      || JSON.stringify(draftsRef.current.map(payloadOf)) !== sentRef.current;
    pendingRef.current = probe;
    return () => { if (pendingRef.current === probe) pendingRef.current = null; };
  }, [pendingRef, year]);

  const commit = () => send(draftsRef.current);
  const patchLine = (key: string, patch: Partial<LineDraft>) => update((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  const patchAndCommit = (key: string, patch: Partial<LineDraft>) => send(patchLine(key, patch));

  const fallbackCalendar = defaultCalendarId(calendars.enabled, payingCompanyCountry);
  // The period a line starts with, and goes back to when it no longer takes one date.
  const linePeriod = period ?? wholeYear(year);
  // A price per day needs a calendar: the default one when the line has none yet.
  const withCalendar = (draft: LineDraft, basis: PriceBasis): Partial<LineDraft> => (
    basis === 'per_day' && !draft.calendarId ? { basis, calendarId: fallbackCalendar } : { basis }
  );
  // Pieces bought once take one date (`date`, both bounds); a line leaving that takes the column's period.
  const withDates = (draft: LineDraft, unit: QuantityUnit, frequency: Frequency, date: string): Partial<LineDraft> => {
    const once = unit === 'pieces' && frequency === 'once';
    if (once && !(draft.unit === 'pieces' && draft.frequency === 'once')) return { start: date, end: date };
    if (!once && isDateDraft(draft)) return { start: linePeriod.start, end: linePeriod.end };
    return {};
  };
  // A new unit takes its price basis (people keep per month when chosen) and its frequency.
  const changeUnit = (draft: LineDraft, unit: QuantityUnit) => {
    if (unit === draft.unit) return;
    const frequency = DEFAULT_FREQUENCY[unit];
    patchAndCommit(draft.key, {
      unit,
      frequency,
      ...withCalendar(draft, basisForUnit(unit, draft.basis)),
      ...withDates(draft, unit, frequency, linePeriod.start),
    });
  };
  const changeBasis = (draft: LineDraft, basis: PriceBasis) => patchAndCommit(draft.key, withCalendar(draft, basis));
  const changeFrequency = (draft: LineDraft, frequency: Frequency) => {
    patchAndCommit(draft.key, { frequency, ...withDates(draft, draft.unit, frequency, draft.start || linePeriod.start) });
  };

  // What takes the focus once drawn, so a run of lines needs no mouse: the Description of a line just
  // added, or after a removal the next line's, else the previous line's, else Add a line.
  const focusTargetRef = React.useRef<string | null>(null);
  const focusIfTarget = (target: string) => (el: HTMLElement | null) => {
    if (!el || focusTargetRef.current !== target) return;
    focusTargetRef.current = null;
    el.focus();
  };

  // The most common line: one person priced per day (a project manager, 5 days a month or full
  // time), on the default calendar. With the calendars loaded and none enabled, a price per day
  // could not be saved: the person starts priced per month.
  const addLine = () => {
    const noCalendar = calendars.ready && calendars.enabled.length === 0;
    const key = newDraftKey();
    focusTargetRef.current = key;
    update((prev) => [...prev, {
      key,
      label: '',
      unit: 'people',
      quantity: '1',
      unitPrice: '',
      basis: noCalendar ? 'per_month' : 'per_day',
      frequency: 'per_month',
      fullTime: false,
      daysPerMonth: '',
      start: linePeriod.start,
      end: linePeriod.end,
      calendarId: fallbackCalendar,
    }]);
  };
  // Removed with the keyboard, the focus goes on to a neighbour; with the mouse, it is left alone (#181).
  const removeLine = (key: string, byKeyboard: boolean) => {
    const lines = draftsRef.current;
    const index = lines.findIndex((d) => d.key === key);
    if (byKeyboard) focusTargetRef.current = (lines[index + 1] ?? lines[index - 1])?.key ?? ADD_LINE;
    send(update((prev) => prev.filter((d) => d.key !== key)));
  };
  const sendLinesAgain = () => send(draftsRef.current, { force: true });
  const toggleApplyToAll = (on: boolean) => {
    applyToAll.onChange(on);
    // Turned on with a complete line, the lines go to the group's columns at once. Turned on without
    // one, or turned off, nothing is written: no line would clear the other columns' lines.
    if (on && draftsRef.current.some((d) => !lineProblem(year, d))) send(draftsRef.current, { force: true, applyToAll: true });
  };

  // Enabled calendars, plus those the stored lines use even when disabled since (marked so, once
  // the list is loaded: before that their state is unknown).
  const calendarsKnown = calendars.ready && !calendars.isError;
  const storedCalendars = React.useMemo(() => {
    const seen = new Map<string, string>();
    storedLines.forEach((line) => {
      if (line.working_day_profile_id) seen.set(line.working_day_profile_id, line.working_day_profile_name ?? '');
    });
    return seen;
  }, [storedLines]);
  const calendarOptions = React.useMemo(() => {
    const options = calendars.enabled.map((c) => ({ id: c.id, name: c.name }));
    storedCalendars.forEach((storedName, id) => {
      if (options.some((o) => o.id === id)) return;
      const name = calendars.byId.get(id)?.name ?? storedName;
      options.push({ id, name: calendarsKnown ? t('budgetTab.lines.calendarDisabled', { name }) : name });
    });
    return options;
  }, [calendars.enabled, calendars.byId, calendarsKnown, storedCalendars, t]);
  const disabledInUse = calendarsKnown
    ? [...storedCalendars.entries()]
      .filter(([id]) => !calendars.enabled.some((c) => c.id === id))
      .map(([id, name]) => calendars.byId.get(id)?.name ?? name)
    : [];

  // The stored explanation: the amount of each line and the column's total. Only while the column
  // follows its lines: a hand edit keeps an explanation the amounts no longer match.
  const calc: LinesCalculation | null = followsLines(record) && record?.last_calculation?.kind === 'computed' ? record.last_calculation : null;
  const amounts = React.useMemo(() => {
    let index = 0;
    return drafts.map((draft) => {
      if (lineProblem(year, draft)) return '';
      const stored = calc?.lines?.[index];
      index += 1;
      return stored && sameLine(payloadOf(draft), linePayloadOf(stored)) ? formatMoney(stored.total) : '';
    });
  }, [drafts, calc, year]);

  // Working days of the calendars the stored per-day lines use, now: one query per calendar.
  const perDayLines = React.useMemo(() => (calc?.lines ?? [])
    .filter((line) => line.price_basis === 'per_day' && !!line.working_day_profile_id && !!line.day_counts), [calc]);
  const calendarIds = React.useMemo(
    () => [...new Set(perDayLines.map((line) => line.working_day_profile_id as string))],
    [perDayLines],
  );
  const yearQueries = useQueries({
    queries: calendarIds.map((id) => ({
      queryKey: workingDayProfileYearKey(id, year, locale),
      queryFn: () => getWorkingDayProfileYear(id, year, locale),
      // Refetched on every opening: the calendar may have been edited since, here or by someone else.
      staleTime: 0,
    })),
  });
  const currentDays = new Map(calendarIds.map((id, i) => [id, yearQueries[i]?.data?.days ?? null]));
  const dayChanges: string[] = [];
  const seenChanges = new Set<string>();
  perDayLines.forEach((line) => {
    const id = line.working_day_profile_id as string;
    changedDays(line.day_counts, currentDays.get(id), line.active_months).forEach((change) => {
      const key = `${id}:${change.month}`;
      if (seenChanges.has(key)) return;
      seenChanges.add(key);
      dayChanges.push(dayChangeText(t, locale, change));
    });
  });

  const problems = drafts.map((d) => lineProblem(year, d));
  const beyondItem = drafts.some((d, i) => !problems[i] && (
    (!!itemStart && d.start < itemStart) || (!!itemEnd && d.end > itemEnd)
  ));
  const needsCalendars = drafts.some((d) => d.basis === 'per_day') && calendarOptions.length === 0;
  const calendarNote = !needsCalendars ? null : calendars.isError ? 'failed' : calendars.ready ? 'none' : null;
  // The calendars page takes a member of the calendars; others get the sentence alone.
  const canAddCalendar = hasLevel('working_day_profiles', 'member');

  const stored = hasLines(record) ? record : null;
  const copySource = stored?.last_calculation?.kind === 'copy'
    ? `${columnName(stored.last_calculation.source_measure)} ${stored.last_calculation.source_year}`
    : null;
  // A column computed from its lines needs no sentence: its amounts and FTE say it.
  const status = !stored || stored.method === 'computed' ? null
    : stored.method === 'manual' ? t('budgetTab.lines.status.manual')
      : stored.method === 'spread' ? t('budgetTab.lines.status.spread')
        : copySource ? t('budgetTab.lines.status.copied', { source: copySource }) : t('budgetTab.lines.status.copiedPlain');
  const offerAgain = !frozen && drafts.length > 0 && problems.some((p) => !p);
  const againLink = (
    <Link component="button" type="button" onClick={sendLinesAgain} sx={{ fontSize: 12, verticalAlign: 'baseline' }}>
      {t('budgetTab.lines.useAgain')}
    </Link>
  );

  // The column shows the total; under the table only the FTE, when a line counts days or people.
  const fteText = calc && drafts.length > 0 && countsFte(calc.lines) && calc.fte != null && calc.fte_period != null
    ? t('budgetTab.lines.fte', { fte_period: formatFteValue(calc.fte_period), fte: formatFteValue(calc.fte) })
    : '';

  const captionSx = { fontSize: 12, color: 'kanap.text.tertiary', lineHeight: 1.4 } as const;
  const headSx = { fontSize: 11, fontWeight: 500, color: 'kanap.text.secondary', textAlign: 'left', px: 0.5, py: 0.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } as const;
  const cellSx = { px: 0.5, py: '2px', verticalAlign: 'middle' } as const;
  // A line is one block: 8 px above its calculation, 4 px between the two rows, 8 px under the sentence.
  const pricedCellSx = { ...cellSx, pt: 1, pb: 0.5 } as const;
  const timingCellSx = { p: 0, pb: 1 } as const;
  // The line number in the margin: right-aligned, no left padding, the half gap on its right only.
  const numberCellSx = { px: 0, pr: 0.5, textAlign: 'right', fontSize: 12, color: 'kanap.text.tertiary', fontVariantNumeric: 'tabular-nums' } as const;
  // The × between the quantity and the unit price, and the words of the second row: never a field.
  const mulCellSx = { p: 0, verticalAlign: 'middle', textAlign: 'center', fontSize: 14, color: 'kanap.text.tertiary', lineHeight: 1 } as const;
  const wordSx = { p: 0, fontSize: 12, color: 'kanap.text.secondary', whiteSpace: 'nowrap' } as const;
  const gridCellSx = { p: 0, minWidth: 0 } as const;
  // What the unit price is for, after the price: plain words, or a select without a box (people).
  const suffixSx = { fontSize: 12, color: 'kanap.text.secondary', whiteSpace: 'nowrap', flex: '0 0 auto' } as const;
  const suffixSelectSx = { ...inlineControlSx, flex: '0 0 auto', '& .MuiInputBase-input': { fontSize: '12px !important', color: 'kanap.text.secondary' } } as const;
  const lineNote = (index: number, note: string) => (drafts.length > 1 ? t('budgetTab.lines.lineNote', { line: index + 1, note }) : note);
  const problemText = (problem: LineProblem) => (
    problem === 'incomplete' ? t('budgetTab.lines.incomplete')
      : problem === 'chooseDays' ? t('budgetTab.lines.chooseDays')
      : problem === 'chooseCalendar' ? t('budgetTab.lines.chooseCalendar')
        : problem.startsWith('date') ? t(`budgetTab.lines.problem.${problem}`, { year })
          : t(`budgetTab.problem.${problem}`, { year })
  );
  const select = (
    label: string,
    value: string,
    options: Array<{ value: string; label: string }>,
    onChange: (value: string) => void,
    sx: object = tableCellTextFieldSx,
  ) => (
    <TextField
      select size="small" variant="standard" fullWidth={sx === tableCellTextFieldSx} value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={readOnly}
      inputProps={{ 'aria-label': label }}
      SelectProps={selectKeepsFocus}
      sx={sx}
    >
      {options.map((o) => <MenuItem key={o.value} value={o.value} sx={drawerMenuItemSx}>{o.label}</MenuItem>)}
    </TextField>
  );
  const onEnter = (e: React.KeyboardEvent) => { if (e.key === 'Enter') commit(); };
  // Every row takes one date: the header says Date over the first date column.
  const allDates = drafts.length > 0 && drafts.every(isDateDraft);
  const [tableBoxRef, widthTier] = useWidthTier(LAYOUT_MIN_WIDTHS);
  const shape = layout === 'auto' ? (['narrow', 'medium', 'wide'] as const)[widthTier] : layout;
  // Two rows per line: how often on the first one when the panel has room for it.
  const oftenFirst = shape === 'medium';

  // The fields of a line, laid out in one row or two.
  const descriptionField = (draft: LineDraft) => (
    <TextField
      size="small" variant="standard" fullWidth value={draft.label}
      onChange={(e) => patchLine(draft.key, { label: e.target.value })}
      onBlur={commit} onKeyDown={onEnter}
      disabled={readOnly}
      inputRef={focusIfTarget(draft.key)}
      placeholder={t('budgetTab.lines.descriptionPlaceholder')}
      inputProps={{ 'aria-label': t('budgetTab.lines.description'), maxLength: 200 }}
      sx={tableCellTextFieldSx}
    />
  );
  const quantityField = (draft: LineDraft) => (
    <FormattedNumberField
      value={draft.quantity} decimals={3} emit="string"
      onChange={(e) => patchLine(draft.key, { quantity: String(e.target.value ?? '') })}
      onBlur={commit} onKeyDown={onEnter}
      disabled={readOnly}
      variant="standard" size="small" fullWidth
      placeholder={t('budgetTab.lines.quantityPlaceholder')}
      inputProps={{ 'aria-label': t('budgetTab.lines.quantity') }}
      sx={tableCellFieldSx}
    />
  );
  const unitField = (draft: LineDraft) => select(
    t('budgetTab.lines.unit'),
    draft.unit,
    QUANTITY_UNITS.map((unit) => ({ value: unit, label: t(`budgetTab.lines.unitNames.${unit}`) })),
    (value) => changeUnit(draft, value as QuantityUnit),
  );
  // The price, then what it is for: a select for people only, the words otherwise.
  const priceField = (draft: LineDraft) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
      <Box sx={{ flex: `0 0 ${UNIT_PRICE_NUMBER_WIDTH}px`, minWidth: 0 }}>
        <FormattedNumberField
          value={draft.unitPrice} decimals={4} emit="string"
          onChange={(e) => patchLine(draft.key, { unitPrice: String(e.target.value ?? '') })}
          onBlur={commit} onKeyDown={onEnter}
          disabled={readOnly}
          variant="standard" size="small" fullWidth
          placeholder={t('budgetTab.lines.unitPricePlaceholder')}
          inputProps={{ 'aria-label': t('budgetTab.lines.unitPrice') }}
          sx={tableCellFieldSx}
        />
      </Box>
      {BASES_BY_UNIT[draft.unit].length > 1 ? select(
        t('budgetTab.lines.priceFor'),
        draft.basis,
        BASES_BY_UNIT[draft.unit].map((basis) => ({ value: basis, label: t(`budgetTab.lines.basis.${basis}`) })),
        (value) => changeBasis(draft, value as PriceBasis),
        suffixSelectSx,
      ) : (
        <Typography data-testid="line-basis" sx={suffixSx}>{t(`budgetTab.lines.basis.${draft.basis}`)}</Typography>
      )}
    </Box>
  );
  const oftenField = (draft: LineDraft) => (asksDays(draft) ? (
    // People priced per day: full time, or the days they work each month.
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
      <FormControlLabel
        control={(
          <Checkbox
            size="small" checked={draft.fullTime} disabled={readOnly}
            onChange={(e) => patchAndCommit(draft.key, { fullTime: e.target.checked })}
            sx={{ p: '2px', mr: 0.5 }}
          />
        )}
        label={t('budgetTab.lines.fullTime')}
        sx={{ m: 0, flex: '0 0 auto', '& .MuiFormControlLabel-label': { fontSize: 13, color: 'kanap.text.primary', whiteSpace: 'nowrap' } }}
      />
      {!draft.fullTime && (
        <>
          <Box sx={{ flex: '0 0 60px' }}>
            <FormattedNumberField
              value={draft.daysPerMonth} decimals={3} emit="string"
              onChange={(e) => patchLine(draft.key, { daysPerMonth: String(e.target.value ?? '') })}
              onBlur={commit} onKeyDown={onEnter}
              disabled={readOnly}
              variant="standard" size="small" fullWidth
              placeholder={t('budgetTab.lines.daysPerMonthPlaceholder')}
              inputProps={{ 'aria-label': t('budgetTab.lines.daysPerMonth') }}
              sx={tableCellFieldSx}
            />
          </Box>
          <Typography sx={suffixSx}>{t('budgetTab.lines.daysPerMonth')}</Typography>
        </>
      )}
    </Box>
  ) : FREQUENCIES_BY_UNIT[draft.unit].length > 1 ? (
    // As wide as its longest choice, not as the whole column.
    <Box sx={{ maxWidth: OFTEN_SELECT_MAX_WIDTH }}>
      {select(
        t('budgetTab.lines.howOften'),
        draft.frequency,
        FREQUENCIES_BY_UNIT[draft.unit].map((frequency) => ({ value: frequency, label: t(`budgetTab.lines.frequency.${frequency}`) })),
        (value) => changeFrequency(draft, value as Frequency),
      )}
    </Box>
  ) : (
    <Typography data-testid="line-frequency" sx={{ fontSize: 13, color: 'kanap.text.primary', px: '6px', whiteSpace: 'nowrap' }}>
      {draft.unit === 'days' ? t('budgetTab.lines.overThePeriod') : t(`budgetTab.lines.frequency.${draft.frequency}`)}
    </Typography>
  ));
  // From and To, or the one date of pieces bought once in the From place (To stays empty).
  const dateFields = (draft: LineDraft): [React.ReactNode, React.ReactNode] => (isDateDraft(draft) ? [
    <DateEUField
      label={t('budgetTab.lines.date')} hideLabel size="small" disabled={readOnly}
      valueYmd={draft.start}
      onChangeYmd={(value) => patchAndCommit(draft.key, { start: value, end: value })}
      textFieldSx={tableCellTextFieldSx}
    />,
    null,
  ] : [
    <DateEUField
      label={t('budgetTab.from')} hideLabel size="small" disabled={readOnly}
      valueYmd={draft.start}
      onChangeYmd={(value) => patchAndCommit(draft.key, { start: value })}
      textFieldSx={tableCellTextFieldSx}
    />,
    <DateEUField
      label={t('budgetTab.to')} hideLabel size="small" disabled={readOnly}
      valueYmd={draft.end}
      onChangeYmd={(value) => patchAndCommit(draft.key, { end: value })}
      textFieldSx={tableCellTextFieldSx}
    />,
  ]);
  const calendarField = (draft: LineDraft) => draft.basis === 'per_day' && select(
    t('budgetTab.lines.calendar'),
    calendarOptions.some((o) => o.id === draft.calendarId) ? draft.calendarId : '',
    calendarOptions.map((o) => ({ value: o.id, label: o.name })),
    (value) => patchAndCommit(draft.key, { calendarId: value }),
  );
  const amountCell = (index: number, cell: object) => (
    <Box
      component="td"
      data-testid="line-amount"
      sx={{ ...cell, textAlign: 'right', fontSize: 13, fontWeight: 500, color: 'kanap.text.primary', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
    >
      {amounts[index]}
    </Box>
  );
  // The line number of the margin: the one the notes under the table call "Line 2".
  const numberCell = (index: number, cell: object) => (
    <Box component="td" data-testid="line-number" aria-hidden sx={{ ...cell, ...numberCellSx }}>{index + 1}</Box>
  );
  const removeButton = (draft: LineDraft) => !readOnly && (
    <Tooltip title={t('budgetTab.lines.remove')}>
      <IconButton
        size="small"
        aria-label={t('budgetTab.lines.remove')}
        // Enter and Space click with no pointer: `detail` is 0.
        onClick={(e) => removeLine(draft.key, e.detail === 0)}
        sx={{ p: '2px', color: 'kanap.text.tertiary', '&:hover': { color: 'error.main', bgcolor: 'transparent' } }}
      >
        <CloseIcon sx={{ fontSize: 14 }} />
      </IconButton>
    </Tooltip>
  );

  // The second row of a line: the tracks are the same for every line, so the dates and the calendars
  // of one line start where those of the line above start.
  const secondRowSx = {
    display: 'grid',
    alignItems: 'center',
    gridTemplateColumns: (oftenFirst ? LINE_TIMING_ROW_WIDTHS : LINE_SECOND_ROW_WIDTHS).map((w) => `${w}px`).join(' '),
    columnGap: `${LINE_COLUMN_GAP}px`,
  } as const;
  // Split like its cells: the label right-aligned over the number field, nothing over what the price is for.
  const unitPriceHead = (
    <Box component="th" sx={{ ...headSx, width: LINE_COLUMN_WIDTHS.unitPrice }}>
      <Box data-testid="lines-head-unit-price" sx={{ width: UNIT_PRICE_NUMBER_WIDTH, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {t('budgetTab.lines.unitPrice')}
      </Box>
    </Box>
  );
  const fromHead = allDates ? t('budgetTab.lines.date') : t('budgetTab.from');
  const toHead = allDates ? '' : t('budgetTab.to');
  // Lines kept as a reference have no amount of their own: the column keeps its place, blank.
  const amountHead = reference ? '' : t('budgetTab.amount');

  const oneRowTable = (
    <Box
      component="table"
      data-testid="lines-table"
      sx={{
        width: '100%',
        minWidth: LINES_TABLE_MIN_WIDTH,
        tableLayout: 'fixed',
        borderCollapse: 'collapse',
        '& thead > tr > th': { borderBottom: '1px solid', borderColor: 'kanap.border.default' },
        '& tbody > tr > td': { borderBottom: '1px solid', borderColor: 'kanap.border.default' },
        // The line being edited, never the one the mouse crosses: dense fields would flicker.
        '& tbody > tr:focus-within': { bgcolor: 'kanap.bg.hover' },
      }}
    >
      <Box component="thead">
        <Box component="tr">
          <Box component="th" sx={{ ...headSx, width: LINE_COLUMN_WIDTHS.number }} />
          <Box component="th" sx={{ ...headSx, width: LINE_COLUMN_WIDTHS.description }}>{t('budgetTab.lines.description')}</Box>
          <Box component="th" sx={{ ...headSx, width: LINE_COLUMN_WIDTHS.quantity, textAlign: 'right' }}>{t('budgetTab.lines.quantity')}</Box>
          <Box component="th" sx={{ ...headSx, width: LINE_COLUMN_WIDTHS.unit }}>{t('budgetTab.lines.unit')}</Box>
          {unitPriceHead}
          <Box component="th" sx={{ ...headSx, width: LINE_COLUMN_WIDTHS.often }}>{t('budgetTab.lines.howOften')}</Box>
          <Box component="th" sx={{ ...headSx, width: LINE_COLUMN_WIDTHS.from }}>{fromHead}</Box>
          <Box component="th" sx={{ ...headSx, width: LINE_COLUMN_WIDTHS.to }}>{toHead}</Box>
          <Box component="th" sx={{ ...headSx, width: LINE_COLUMN_WIDTHS.calendar }}>{t('budgetTab.lines.calendar')}</Box>
          {/* The free width: it keeps the description at its size and the fields next to it. */}
          <Box component="th" sx={headSx} />
          <Box component="th" sx={{ ...headSx, width: LINE_COLUMN_WIDTHS.amount, textAlign: 'right' }}>{amountHead}</Box>
          <Box component="th" sx={{ ...headSx, width: LINE_COLUMN_WIDTHS.remove }} />
        </Box>
      </Box>
      <Box component="tbody">
        {drafts.map((draft, index) => {
          const [fromField, toField] = dateFields(draft);
          return (
            <Box component="tr" key={draft.key} data-testid="line-row">
              {numberCell(index, cellSx)}
              <Box component="td" sx={cellSx}>{descriptionField(draft)}</Box>
              <Box component="td" sx={cellSx}>{quantityField(draft)}</Box>
              <Box component="td" sx={cellSx}>{unitField(draft)}</Box>
              <Box component="td" sx={cellSx}>{priceField(draft)}</Box>
              <Box component="td" sx={cellSx}>{oftenField(draft)}</Box>
              <Box component="td" sx={cellSx}>{fromField}</Box>
              <Box component="td" sx={cellSx}>{toField}</Box>
              <Box component="td" sx={cellSx}>{calendarField(draft)}</Box>
              <Box component="td" sx={cellSx} />
              {amountCell(index, cellSx)}
              <Box component="td" sx={cellSx}>{removeButton(draft)}</Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );

  // One body per line, a full separator under each: the calculation, then the sentence of when and
  // how, on a single header row.
  const twoRowsTable = (
    <Box
      component="table"
      data-testid="lines-table"
      sx={{
        width: '100%',
        minWidth: oftenFirst ? LINES_OFTEN_FIRST_MIN_WIDTH : LINES_TWO_ROWS_MIN_WIDTH,
        tableLayout: 'fixed',
        borderCollapse: 'collapse',
        '& thead > tr > th': { borderBottom: '1px solid', borderColor: 'kanap.border.default' },
        '& tbody > tr:last-of-type > td': { borderBottom: '1px solid', borderColor: 'kanap.border.default' },
        '& tbody:focus-within': { bgcolor: 'kanap.bg.hover' },
      }}
    >
      <Box component="thead">
        <Box component="tr" data-testid="lines-head">
          <Box component="th" sx={{ ...headSx, width: LINE_COLUMN_WIDTHS.number }} />
          <Box component="th" sx={{ ...headSx, width: LINE_COLUMN_WIDTHS.description }}>{t('budgetTab.lines.description')}</Box>
          <Box component="th" sx={{ ...headSx, width: LINE_COLUMN_WIDTHS.quantity, textAlign: 'right' }}>{t('budgetTab.lines.quantity')}</Box>
          <Box component="th" sx={{ ...headSx, width: LINE_COLUMN_WIDTHS.unit }}>{t('budgetTab.lines.unit')}</Box>
          <Box component="th" sx={{ ...headSx, width: LINE_MUL_WIDTH }} />
          {unitPriceHead}
          {oftenFirst && <Box component="th" sx={{ ...headSx, width: LINE_COLUMN_WIDTHS.often }}>{t('budgetTab.lines.howOften')}</Box>}
          <Box component="th" sx={headSx} />
          <Box component="th" sx={{ ...headSx, width: LINE_COLUMN_WIDTHS.amount, textAlign: 'right' }}>{amountHead}</Box>
          <Box component="th" sx={{ ...headSx, width: LINE_COLUMN_WIDTHS.remove }} />
        </Box>
      </Box>
      {drafts.map((draft, index) => {
        const [fromField, toField] = dateFields(draft);
        const calendar = calendarField(draft);
        const once = isDateDraft(draft);
        return (
          <Box component="tbody" key={draft.key} data-testid="line-row">
            <Box component="tr" data-testid="line-priced">
              {numberCell(index, pricedCellSx)}
              <Box component="td" sx={pricedCellSx}>{descriptionField(draft)}</Box>
              <Box component="td" sx={pricedCellSx}>{quantityField(draft)}</Box>
              <Box component="td" sx={pricedCellSx}>{unitField(draft)}</Box>
              <Box component="td" aria-hidden sx={mulCellSx}>×</Box>
              <Box component="td" sx={pricedCellSx}>{priceField(draft)}</Box>
              {oftenFirst && <Box component="td" sx={pricedCellSx}>{oftenField(draft)}</Box>}
              <Box component="td" sx={pricedCellSx} />
              {amountCell(index, pricedCellSx)}
              <Box component="td" sx={pricedCellSx}>{removeButton(draft)}</Box>
            </Box>
            <Box component="tr" data-testid="line-timing">
              <Box component="td" colSpan={oftenFirst ? 10 : 9} sx={timingCellSx}>
                <Box data-testid="line-sentence" sx={secondRowSx}>
                  {/* Under the line number of the row above. */}
                  <Box />
                  {!oftenFirst && <Box sx={gridCellSx}>{oftenField(draft)}</Box>}
                  <Box data-testid="line-from-word" sx={wordSx}>{t(once ? 'budgetTab.lines.onWord' : 'budgetTab.lines.fromWord')}</Box>
                  <Box sx={gridCellSx}>{fromField}</Box>
                  <Box data-testid="line-to-word" sx={wordSx}>{once ? '' : t('budgetTab.lines.toWord')}</Box>
                  <Box sx={gridCellSx}>{toField}</Box>
                  <Box data-testid="line-calendar-word" sx={wordSx}>{calendar ? t('budgetTab.lines.calendarWord') : ''}</Box>
                  <Box sx={gridCellSx}>{calendar}</Box>
                </Box>
              </Box>
            </Box>
          </Box>
        );
      })}
    </Box>
  );

  return (
    <>
      {/* Measured before the first line: the table is drawn in its layout at once, never swapped under the focus. */}
      <Box ref={tableBoxRef}>
        {drafts.length === 0 ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography sx={captionSx}>{t('budgetTab.lines.empty')}</Typography>
            {!readOnly && (
              <Button ref={focusIfTarget(ADD_LINE)} size="small" startIcon={<AddIcon sx={{ fontSize: 16 }} />} onClick={addLine} sx={{ textTransform: 'none', fontSize: 12, py: 0 }}>
                {t('budgetTab.lines.add')}
              </Button>
            )}
          </Box>
        ) : (
          <>
            <Box sx={{ overflowX: 'auto' }}>
              {shape === 'wide' ? oneRowTable : twoRowsTable}
            </Box>
            {!readOnly && (
              <Button ref={focusIfTarget(ADD_LINE)} size="small" startIcon={<AddIcon sx={{ fontSize: 16 }} />} onClick={addLine} sx={{ textTransform: 'none', fontSize: 12, mt: 0.5 }}>
                {t('budgetTab.lines.add')}
              </Button>
            )}
          </>
        )}
      </Box>

      <Box data-testid="lines-notes" aria-live="polite">
        {fteText && (
          <Typography data-testid="lines-fte" sx={{ fontSize: 13, color: 'kanap.text.primary', fontVariantNumeric: 'tabular-nums' }}>
            {fteText}
          </Typography>
        )}
        {status && (
          <Typography data-testid="lines-status" sx={captionSx}>
            {status}
            {offerAgain && <> {againLink}</>}
          </Typography>
        )}
        {error && <Typography sx={{ ...captionSx, color: 'error.main' }}>{error}</Typography>}
        {problems.map((problem, index) => problem && (
          <Typography key={drafts[index].key} sx={{ ...captionSx, color: problem === 'incomplete' || problem === 'chooseDays' || problem === 'chooseCalendar' ? 'kanap.text.tertiary' : 'error.main' }}>
            {lineNote(index, problemText(problem))}
          </Typography>
        ))}
        {calendarNote && (
          <Typography sx={{ ...captionSx, display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
            {calendarNote === 'failed' ? t('budgetTab.lines.calendarsFailed') : t('budgetTab.lines.noCalendars')}
            {calendarNote === 'none' && canAddCalendar && (
              <Link component={RouterLink} to={CALENDARS_PATH} sx={{ fontSize: 12 }}>{t('budgetTab.lines.addCalendar')}</Link>
            )}
          </Typography>
        )}
        {beyondItem && <Typography sx={{ ...captionSx, color: 'warning.main' }}>{t('budgetTab.beyondItemDates')}</Typography>}
        {disabledInUse.map((name) => (
          <Typography key={name} sx={{ ...captionSx, color: 'warning.main' }}>{t('budgetTab.lines.calendarDisabledNote', { name })}</Typography>
        ))}
        {dayChanges.length > 0 && (
          <Typography data-testid="lines-days-changed" sx={{ ...captionSx, color: 'warning.main' }}>
            {`${t('budgetTab.lines.changedDays')} ${dayChanges.join(' · ')}.`}
            {offerAgain && <> {againLink}</>}
          </Typography>
        )}
        {frozen && <Typography sx={captionSx}>{frozenHint}</Typography>}
      </Box>

      {applyToAll.offered && !reference && (
        <Box>
          <FormControlLabel
            control={<Switch size="small" checked={applyToAll.on} disabled={frozen} onChange={(e) => toggleApplyToAll(e.target.checked)} />}
            label={(
              <Tooltip title={applyToAll.hint}>
                <Typography sx={{ fontSize: 13, color: 'kanap.text.primary' }}>{t('budgetTab.lines.applyToAll')}</Typography>
              </Tooltip>
            )}
            sx={{ ml: 0 }}
          />
        </Box>
      )}
    </>
  );
}
