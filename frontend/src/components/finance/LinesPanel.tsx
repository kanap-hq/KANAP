import React from 'react';
import { Box, Button, FormControlLabel, IconButton, Link, MenuItem, Switch, TextField, Tooltip, Typography } from '@mui/material';
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
import { drawerMenuItemSx, drawerSelectSx, tableCellFieldSx, tableCellTextFieldSx } from '../../theme/formSx';
import {
  AmountMeasure,
  BASES_BY_UNIT,
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
  dayChangeText,
  formatFteValue,
  formatMoney,
  hasLines,
  linePayloadOf,
  periodProblem,
  sameLine,
  trimDecimal,
  wholeYear,
} from './roundPeriod';

const CALENDARS_PATH = '/master-data/working-day-calendars';

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
  start: string;
  end: string;
  /** Kept when the price is no longer per day, so switching back finds it again. */
  calendarId: string;
};

let draftSeq = 0;
const newDraftKey = () => `draft-${++draftSeq}`;

function draftOf(line: RoundLine): LineDraft {
  return {
    key: line.id || newDraftKey(),
    label: line.label ?? '',
    unit: line.quantity_unit,
    quantity: trimDecimal(line.quantity),
    unitPrice: trimDecimal(line.unit_price),
    basis: line.price_basis,
    start: line.period_start,
    end: line.period_end,
    calendarId: line.working_day_profile_id ?? '',
  };
}

export type LineProblem = PeriodProblem | 'incomplete' | 'chooseCalendar';

/** Why a line cannot be saved yet, or null when it is complete. */
export function lineProblem(year: number, draft: LineDraft): LineProblem | null {
  if (draft.quantity === '' || draft.unitPrice === '') return 'incomplete';
  const period = periodProblem(year, draft.start, draft.end);
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

/** A save of the lines: fine (with the server's warnings, if any), or refused with a sentence. */
export type LinesSaveResult = { ok: true; warnings?: string[] } | { ok: false; error: string };

export type LinesPanelProps = {
  year: number;
  measure: AmountMeasure;
  /** Shown columns, fixed order; a frozen one cannot be picked. */
  columns: Array<{ measure: AmountMeasure; label: string; frozen: boolean }>;
  onMeasureChange: (measure: AmountMeasure) => void;
  /** The column's stored record, with its lines when it has some. */
  record: RoundInput | undefined;
  /** The period a new line starts with (the column's, within the item's dates); the whole year when null. */
  period: Period | null;
  /** The item's dates, for the note when a line goes beyond them. */
  itemStart?: string | null;
  itemEnd?: string | null;
  frozen: boolean;
  frozenHint: string;
  /** The paying company's country: its standard calendar is the default of a new line. */
  payingCompanyCountry?: string | null;
  /** The tenant's name of a column, for "copied from". */
  columnName: (measure: AmountMeasure) => string;
  /** "Apply to all columns": offered when the group has other columns that are not frozen. */
  applyToAll: { offered: boolean; on: boolean; hint: string; onChange: (on: boolean) => void };
  /** Writes every complete line of the column (and of the group when `applyToAll`), then reloads. */
  onSave: (lines: LinePayload[], applyToAll: boolean) => Promise<LinesSaveResult>;
};

/**
 * "Quantity and price": the column as a table of lines, each a quantity times a unit price. Every
 * committed field saves the column's complete lines at once (no button); the amounts come from the
 * server. A line that is not complete yet stays here until it is.
 */
export default function LinesPanel({
  year, measure, columns, onMeasureChange, record, period, itemStart, itemEnd, frozen, frozenHint,
  payingCompanyCountry, columnName, applyToAll, onSave,
}: LinesPanelProps) {
  const { t } = useTranslation(['ops', 'common']);
  const locale = useLocale();
  const { hasLevel } = useAuth();
  const calendars = useWorkingDayProfiles();
  const queryClient = useQueryClient();

  const storedLines = React.useMemo(() => record?.lines ?? [], [record]);
  const [drafts, setDrafts] = React.useState<LineDraft[]>(() => storedLines.map(draftOf));
  const draftsRef = React.useRef(drafts);
  // What the server holds (or was last asked to hold): a commit that would send the same lines writes nothing.
  const sentRef = React.useRef(JSON.stringify(storedLines.map(linePayloadOf)));
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
    sentRef.current = signature;
    void onSave(lines, options.applyToAll ?? applyToAll.on).then((result) => {
      if (result.ok) {
        setError(null);
        // The only warning is a disabled calendar: the note under the table comes from the calendars
        // list, refreshed here in case it was disabled since the list was loaded.
        if (result.warnings?.length) void queryClient.invalidateQueries({ queryKey: WORKING_DAY_PROFILES_QUERY_KEY });
      } else {
        setError(tableLineMessage(result.error, rows));
        // Refused: the next commit sends the same lines again.
        if (sentRef.current === signature) sentRef.current = '';
      }
    });
  };

  const commit = () => send(draftsRef.current);
  const patchLine = (key: string, patch: Partial<LineDraft>) => update((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  const patchAndCommit = (key: string, patch: Partial<LineDraft>) => send(patchLine(key, patch));

  const fallbackCalendar = defaultCalendarId(calendars.enabled, payingCompanyCountry);
  // A price per day needs a calendar: the default one when the line has none yet.
  const withCalendar = (draft: LineDraft, basis: PriceBasis): Partial<LineDraft> => (
    basis === 'per_day' && !draft.calendarId ? { basis, calendarId: fallbackCalendar } : { basis }
  );
  const changeUnit = (draft: LineDraft, unit: QuantityUnit) => {
    patchAndCommit(draft.key, { unit, ...withCalendar(draft, basisForUnit(unit, draft.basis)) });
  };
  const changeBasis = (draft: LineDraft, basis: PriceBasis) => patchAndCommit(draft.key, withCalendar(draft, basis));

  const addLine = () => {
    const linePeriod = period ?? wholeYear(year);
    update((prev) => [...prev, {
      key: newDraftKey(),
      label: '',
      unit: 'people',
      quantity: '1',
      unitPrice: '',
      basis: fallbackCalendar ? 'per_day' : 'per_month',
      start: linePeriod.start,
      end: linePeriod.end,
      calendarId: fallbackCalendar,
    }]);
  };
  const removeLine = (key: string) => send(update((prev) => prev.filter((d) => d.key !== key)));
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

  // The stored explanation: the amount of each line and the column's total.
  const calc: LinesCalculation | null = record?.last_calculation?.kind === 'computed' ? record.last_calculation : null;
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
  const status = !stored ? null
    : stored.method === 'computed' ? t('budgetTab.lines.status.computed')
      : stored.method === 'manual' ? t('budgetTab.lines.status.manual')
        : stored.method === 'spread' ? t('budgetTab.lines.status.spread')
          : copySource ? t('budgetTab.lines.status.copied', { source: copySource }) : t('budgetTab.lines.status.copiedPlain');
  const offerAgain = !frozen && drafts.length > 0 && problems.some((p) => !p);
  const againLink = (
    <Link component="button" type="button" onClick={sendLinesAgain} sx={{ fontSize: 12, verticalAlign: 'baseline' }}>
      {t('budgetTab.lines.useAgain')}
    </Link>
  );

  const showFte = !!calc && calc.fte != null && calc.lines.some((line) => line.quantity_unit !== 'units');
  const totalText = calc && drafts.length > 0
    ? showFte
      ? t('budgetTab.lines.totalFte', { total: formatMoney(calc.total), fte: formatFteValue(calc.fte) })
      : t('budgetTab.lines.total', { total: formatMoney(calc.total) })
    : '';

  const captionSx = { fontSize: 12, color: 'kanap.text.tertiary', lineHeight: 1.4 } as const;
  const headSx = { fontSize: 11, fontWeight: 500, color: 'kanap.text.secondary', textAlign: 'left', px: 0.5, py: 0.5, whiteSpace: 'nowrap' } as const;
  const cellSx = { px: 0.5, py: '2px', verticalAlign: 'middle' } as const;
  const lineNote = (index: number, note: string) => (drafts.length > 1 ? t('budgetTab.lines.lineNote', { line: index + 1, note }) : note);
  const problemText = (problem: LineProblem) => (
    problem === 'incomplete' ? t('budgetTab.lines.incomplete')
      : problem === 'chooseCalendar' ? t('budgetTab.lines.chooseCalendar')
        : t(`budgetTab.problem.${problem}`, { year })
  );
  const select = (
    label: string,
    value: string,
    options: Array<{ value: string; label: string }>,
    onChange: (value: string) => void,
  ) => (
    <TextField
      select size="small" variant="standard" fullWidth value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={frozen}
      inputProps={{ 'aria-label': label }}
      sx={tableCellTextFieldSx}
    >
      {options.map((o) => <MenuItem key={o.value} value={o.value} sx={drawerMenuItemSx}>{o.label}</MenuItem>)}
    </TextField>
  );
  const onEnter = (e: React.KeyboardEvent) => { if (e.key === 'Enter') commit(); };

  return (
    <>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', columnGap: 1.5, rowGap: 1 }}>
        <PanelField label={t('budgetTab.column')} width={150}>
          <TextField
            select size="small" variant="standard" value={measure}
            onChange={(e) => onMeasureChange(e.target.value as AmountMeasure)}
            inputProps={{ 'aria-label': t('budgetTab.column') }}
            sx={drawerSelectSx}
          >
            {columns.map((c) => (
              <MenuItem key={c.measure} value={c.measure} disabled={c.frozen} sx={drawerMenuItemSx}>{c.label}</MenuItem>
            ))}
          </TextField>
        </PanelField>
      </Box>

      {drafts.length === 0 ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography sx={captionSx}>{t('budgetTab.lines.empty')}</Typography>
          {!frozen && (
            <Button size="small" startIcon={<AddIcon sx={{ fontSize: 16 }} />} onClick={addLine} sx={{ textTransform: 'none', fontSize: 12, py: 0 }}>
              {t('budgetTab.lines.add')}
            </Button>
          )}
        </Box>
      ) : (
        <Box>
          <Box sx={{ overflowX: 'auto' }}>
            <Box
              component="table"
              data-testid="lines-table"
              sx={{ width: '100%', borderCollapse: 'collapse', '& th': { borderBottom: '1px solid', borderColor: 'kanap.border.default' }, '& td': { borderBottom: '1px solid', borderColor: 'kanap.border.soft' } }}
            >
              <Box component="thead">
                <Box component="tr">
                  <Box component="th" sx={{ ...headSx, minWidth: 160 }}>{t('budgetTab.lines.description')}</Box>
                  <Box component="th" sx={{ ...headSx, width: 90, textAlign: 'right' }}>{t('budgetTab.lines.quantity')}</Box>
                  <Box component="th" sx={{ ...headSx, width: 100 }}>{t('budgetTab.lines.unit')}</Box>
                  <Box component="th" sx={{ ...headSx, width: 110, textAlign: 'right' }}>{t('budgetTab.lines.unitPrice')}</Box>
                  <Box component="th" sx={{ ...headSx, width: 100 }}>{t('budgetTab.lines.per')}</Box>
                  <Box component="th" sx={{ ...headSx, width: 130 }}>{t('budgetTab.from')}</Box>
                  <Box component="th" sx={{ ...headSx, width: 130 }}>{t('budgetTab.to')}</Box>
                  <Box component="th" sx={{ ...headSx, width: 160 }}>{t('budgetTab.lines.calendar')}</Box>
                  <Box component="th" sx={{ ...headSx, width: 100, textAlign: 'right' }}>{t('budgetTab.amount')}</Box>
                  <Box component="th" sx={{ ...headSx, width: 28 }} />
                </Box>
              </Box>
              <Box component="tbody">
                {drafts.map((draft, index) => (
                  <Box component="tr" key={draft.key} data-testid="line-row">
                    <Box component="td" sx={cellSx}>
                      <TextField
                        size="small" variant="standard" fullWidth value={draft.label}
                        onChange={(e) => patchLine(draft.key, { label: e.target.value })}
                        onBlur={commit} onKeyDown={onEnter}
                        disabled={frozen}
                        placeholder={t('budgetTab.lines.descriptionPlaceholder')}
                        inputProps={{ 'aria-label': t('budgetTab.lines.description'), maxLength: 200 }}
                        sx={tableCellTextFieldSx}
                      />
                    </Box>
                    <Box component="td" sx={{ ...cellSx, width: 90 }}>
                      <FormattedNumberField
                        value={draft.quantity} decimals={3} emit="string"
                        onChange={(e) => patchLine(draft.key, { quantity: String(e.target.value ?? '') })}
                        onBlur={commit} onKeyDown={onEnter}
                        disabled={frozen}
                        variant="standard" size="small" fullWidth
                        placeholder={t('budgetTab.lines.quantityPlaceholder')}
                        inputProps={{ 'aria-label': t('budgetTab.lines.quantity') }}
                        sx={tableCellFieldSx}
                      />
                    </Box>
                    <Box component="td" sx={{ ...cellSx, width: 100 }}>
                      {select(
                        t('budgetTab.lines.unit'),
                        draft.unit,
                        QUANTITY_UNITS.map((unit) => ({ value: unit, label: t(`budgetTab.lines.units.${unit}`) })),
                        (value) => changeUnit(draft, value as QuantityUnit),
                      )}
                    </Box>
                    <Box component="td" sx={{ ...cellSx, width: 110 }}>
                      <FormattedNumberField
                        value={draft.unitPrice} decimals={4} emit="string"
                        onChange={(e) => patchLine(draft.key, { unitPrice: String(e.target.value ?? '') })}
                        onBlur={commit} onKeyDown={onEnter}
                        disabled={frozen}
                        variant="standard" size="small" fullWidth
                        placeholder={t('budgetTab.lines.unitPricePlaceholder')}
                        inputProps={{ 'aria-label': t('budgetTab.lines.unitPrice') }}
                        sx={tableCellFieldSx}
                      />
                    </Box>
                    <Box component="td" sx={{ ...cellSx, width: 100 }}>
                      {select(
                        t('budgetTab.lines.per'),
                        draft.basis,
                        BASES_BY_UNIT[draft.unit].map((basis) => ({ value: basis, label: t(`budgetTab.lines.basis.${basis}`) })),
                        (value) => changeBasis(draft, value as PriceBasis),
                      )}
                    </Box>
                    <Box component="td" sx={{ ...cellSx, width: 130 }}>
                      <DateEUField
                        label={t('budgetTab.from')} hideLabel size="small" disabled={frozen}
                        valueYmd={draft.start}
                        onChangeYmd={(value) => patchAndCommit(draft.key, { start: value })}
                        textFieldSx={tableCellTextFieldSx}
                      />
                    </Box>
                    <Box component="td" sx={{ ...cellSx, width: 130 }}>
                      <DateEUField
                        label={t('budgetTab.to')} hideLabel size="small" disabled={frozen}
                        valueYmd={draft.end}
                        onChangeYmd={(value) => patchAndCommit(draft.key, { end: value })}
                        textFieldSx={tableCellTextFieldSx}
                      />
                    </Box>
                    <Box component="td" sx={{ ...cellSx, width: 160 }}>
                      {draft.basis === 'per_day' && select(
                        t('budgetTab.lines.calendar'),
                        calendarOptions.some((o) => o.id === draft.calendarId) ? draft.calendarId : '',
                        calendarOptions.map((o) => ({ value: o.id, label: o.name })),
                        (value) => patchAndCommit(draft.key, { calendarId: value }),
                      )}
                    </Box>
                    <Box
                      component="td"
                      data-testid="line-amount"
                      sx={{ ...cellSx, width: 100, textAlign: 'right', fontSize: 13, color: 'kanap.text.primary', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
                    >
                      {amounts[index]}
                    </Box>
                    <Box component="td" sx={{ ...cellSx, width: 28 }}>
                      {!frozen && (
                        <Tooltip title={t('budgetTab.lines.remove')}>
                          <IconButton
                            size="small"
                            aria-label={t('budgetTab.lines.remove')}
                            onClick={() => removeLine(draft.key)}
                            sx={{ p: '2px', color: 'kanap.text.tertiary', '&:hover': { color: 'error.main', bgcolor: 'transparent' } }}
                          >
                            <CloseIcon sx={{ fontSize: 14 }} />
                          </IconButton>
                        </Tooltip>
                      )}
                    </Box>
                  </Box>
                ))}
              </Box>
            </Box>
          </Box>
          {!frozen && (
            <Button size="small" startIcon={<AddIcon sx={{ fontSize: 16 }} />} onClick={addLine} sx={{ textTransform: 'none', fontSize: 12, mt: 0.5 }}>
              {t('budgetTab.lines.add')}
            </Button>
          )}
        </Box>
      )}

      <Box data-testid="lines-notes" aria-live="polite">
        {totalText && (
          <Typography data-testid="lines-total" sx={{ fontSize: 13, color: 'kanap.text.primary', fontVariantNumeric: 'tabular-nums' }}>
            {totalText}
          </Typography>
        )}
        {status && (
          <Typography data-testid="lines-status" sx={captionSx}>
            {status}
            {stored?.method !== 'computed' && offerAgain && <> {againLink}</>}
          </Typography>
        )}
        {error && <Typography sx={{ ...captionSx, color: 'error.main' }}>{error}</Typography>}
        {problems.map((problem, index) => problem && (
          <Typography key={drafts[index].key} sx={{ ...captionSx, color: problem === 'incomplete' || problem === 'chooseCalendar' ? 'kanap.text.tertiary' : 'error.main' }}>
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

      {applyToAll.offered && (
        <Box>
          <FormControlLabel
            control={<Switch size="small" checked={applyToAll.on} disabled={frozen} onChange={(e) => toggleApplyToAll(e.target.checked)} />}
            label={(
              <Tooltip title={applyToAll.hint}>
                <Typography sx={{ fontSize: 13, color: 'kanap.text.primary' }}>{t('budgetTab.applyToAll')}</Typography>
              </Tooltip>
            )}
            sx={{ ml: 0 }}
          />
        </Box>
      )}
    </>
  );
}
