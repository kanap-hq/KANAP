import React from 'react';
import { Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { KanapDialog, PropertyRow } from '../../components/design';
import FormattedNumberField from '../../components/inputs/FormattedNumberField';
import YearTabs from '../../components/navigation/YearTabs';
import { useLocale } from '../../i18n/useLocale';
import type { CalendarDays, WorkingDayProfileYear } from '../../services/workingDayProfiles';
import { tealLinkSx } from '../../theme/formSx';
import {
  DAY_DECIMALS,
  blankYear,
  calendarTabYears,
  checkYear,
  holidayRunDates,
  holidayRuns,
  monthLabel,
  normalizeDays,
  roundDaysTotal,
  standardTabYears,
  sumDays,
  type MonthProblem,
} from './workingDayCalendarFields';

/** What a standard calendar adds to the editor. */
export type StandardCalendarView = {
  /** "France (Moselle)". */
  source: string;
  /** The shown year's standard values and public holidays; undefined while loading or for another year. */
  year: WorkingDayProfileYear | null | undefined;
  /** The year could not be loaded. */
  failed?: boolean;
};

type Props = {
  daysByYear: CalendarDays;
  disabled: boolean;
  /** The last refusal of a days write, shown under the months. */
  error?: string;
  /** Saves one year (twelve values) or removes it (null). Resolves true once stored. */
  onSaveYear: (year: number, values: string[] | null) => Promise<boolean>;
  /** The year shown first; defaults to the current year. */
  initialYear?: number;
  /** "Used by 3 OPEX lines and 1 CAPEX line.", or null when no line uses the calendar: removing a year then asks first. */
  usage?: string | null;
  /**
   * Set on a standard calendar: every year shows its effective values (the edited ones, else the
   * standard values), a change stores the twelve values of the year, and an edited year can go back
   * to the standard values. Copy and remove do not exist there.
   */
  standard?: StandardCalendarView | null;
  /** Told the shown year (at first and on every change), so the caller can load it. */
  onYearChange?: (year: number) => void;
};

const MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);

function sameValues(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
  return a.length === b.length && a.every((value, index) => normalizeDays(value) === normalizeDays(b[index] ?? ''));
}

/**
 * The working days of one calendar, a year at a time: twelve month fields, the yearly total, and the
 * year's autosave. On a custom calendar, a year the calendar does not hold yet is written once its
 * twelve months are filled. On a standard calendar, every year starts from its standard values.
 */
export default function WorkingDayProfileEditor({
  daysByYear,
  disabled,
  error,
  onSaveYear,
  initialYear,
  usage = null,
  standard = null,
  onYearChange,
}: Props) {
  const { t } = useTranslation(['master-data']);
  const locale = useLocale();
  const [year, setYear] = React.useState<number>(() => initialYear ?? new Date().getFullYear());
  const edited = daysByYear[String(year)] ?? null;
  const yearInfo = standard?.year && standard.year.year === year ? standard.year : null;
  const standardDays = yearInfo?.standard_days ?? null;
  // The values the fields start from: the stored year, else (standard calendar) its standard values.
  const stored = edited ?? (standard ? standardDays : null);
  const storedKey = stored ? stored.join('|') : '';
  // A standard year shows nothing to edit until its standard values arrive.
  const waiting = !!standard && !stored;
  const onYearChangeRef = React.useRef(onYearChange);
  onYearChangeRef.current = onYearChange;
  React.useEffect(() => { onYearChangeRef.current?.(year); }, [year]);
  const [draft, setDraft] = React.useState<string[]>(() => (stored ? [...stored] : blankYear()));
  const draftRef = React.useRef(draft);
  draftRef.current = draft;
  // Shown once the user leaves a month, so a half-typed year is not flagged while it is being filled.
  const [touched, setTouched] = React.useState(false);
  const [confirmRemove, setConfirmRemove] = React.useState(false);

  // Switching years starts afresh. A stored change of the same year (a write coming back) replaces the
  // months the user has not changed since, so a month typed while the write ran is kept.
  const shownRef = React.useRef<{ year: number; stored: string[] | null }>({ year, stored });
  React.useEffect(() => {
    const shown = shownRef.current;
    shownRef.current = { year, stored };
    if (shown.year !== year || !stored) {
      setDraft(stored ? [...stored] : blankYear());
      setTouched(false);
      return;
    }
    setDraft((current) => stored.map((value, index) => {
      const typed = normalizeDays(current[index] ?? '');
      const untouched = typed === normalizeDays(shown.stored?.[index] ?? '') || typed === normalizeDays(value);
      return untouched ? value : current[index];
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, storedKey]);

  const isStandard = !!standard;
  const years = React.useMemo(
    () => (isStandard ? standardTabYears() : calendarTabYears(daysByYear, new Date().getFullYear())),
    [daysByYear, isStandard],
  );
  const check = React.useMemo(() => checkYear(year, draft), [year, draft]);
  const previous = isStandard ? null : daysByYear[String(year - 1)] ?? null;

  const commit = React.useCallback((values: string[]) => {
    if (disabled || waiting) return;
    const result = checkYear(year, values);
    setTouched(true);
    if (result.problems.some(Boolean) || !result.complete) return;
    if (stored && sameValues(values, stored)) return;
    void onSaveYear(year, values.map(normalizeDays));
  }, [disabled, onSaveYear, stored, waiting, year]);

  const copyPrevious = () => {
    if (!previous) return;
    const values = [...previous];
    setDraft(values);
    commit(values);
  };

  const problemText = (problem: MonthProblem, month: number): string => {
    const name = monthLabel(locale, month);
    if (problem.kind === 'negative') return t('workingDayCalendars.days.negative', { month: name, year });
    if (problem.kind === 'decimals') return t('workingDayCalendars.days.decimals', { month: name, year });
    return t('workingDayCalendars.days.tooMany', { month: name, year, max: problem.max });
  };

  const firstProblem = check.problems.findIndex(Boolean);
  let status: { text: string; tone: 'error' | 'hint' } | null = null;
  if (firstProblem >= 0) {
    status = { text: problemText(check.problems[firstProblem] as MonthProblem, firstProblem + 1), tone: 'error' };
  } else if (error) {
    status = { text: error, tone: 'error' };
  } else if (standard?.failed && !yearInfo) {
    status = { text: t('workingDayCalendars.days.standardFailed', { year }), tone: 'error' };
  } else if (!check.complete && !check.empty) {
    status = stored
      ? { text: t('workingDayCalendars.days.incomplete', { year }), tone: touched ? 'error' : 'hint' }
      : { text: t('workingDayCalendars.days.fillToSave', { year }), tone: 'hint' };
  }

  const total = sumDays(draft);
  const shownTotal = roundDaysTotal(total);
  const standardTotal = standardDays ? roundDaysTotal(sumDays(standardDays)) : null;
  const holidays = yearInfo?.holidays ?? null;
  const weekend = t('workingDayCalendars.days.weekend');
  const holidaysText = holidays
    ? holidays.length > 0
      ? t('workingDayCalendars.days.holidays', {
        list: holidayRuns(holidays)
          .map((run) => `${holidayRunDates(t, run, locale)} ${run.name}${run.weekend ? ` ${weekend}` : ''}`)
          .join(', '),
      })
      : t('workingDayCalendars.days.noHolidays', { year })
    : null;

  return (
    <Box data-testid="working-days">
      <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'kanap.text.tertiary', mb: 0.5 }}>
        {t('workingDayCalendars.days.title')}
      </Typography>
      <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary', mb: 1.5 }}>
        {standard
          ? t('workingDayCalendars.days.standardHint', { source: standard.source })
          : t('workingDayCalendars.days.hint')}
      </Typography>
      <Box sx={{ mb: 1.5 }}>
        <YearTabs currentYear={year} availableYears={years} onYearChange={setYear} />
      </Box>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(4, minmax(0, 1fr))', lg: 'repeat(6, minmax(0, 1fr))' },
          columnGap: 2,
          rowGap: 0.5,
          maxWidth: 900,
        }}
      >
        {MONTHS.map((month) => {
          const label = monthLabel(locale, month);
          return (
            <PropertyRow key={month} label={label} valueSx={{ maxWidth: 140 }}>
              <FormattedNumberField
                decimals={DAY_DECIMALS}
                emit="string"
                value={draft[month - 1]}
                onChange={(event) => {
                  const next = [...draftRef.current];
                  next[month - 1] = String(event.target.value ?? '');
                  draftRef.current = next;
                  setDraft(next);
                }}
                onBlur={() => commit(draftRef.current)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
                }}
                variant="standard"
                placeholder={t('workingDayCalendars.placeholders.days')}
                disabled={disabled || waiting}
                error={!!check.problems[month - 1]}
                inputProps={{ 'aria-label': t('workingDayCalendars.days.monthField', { month: label, year }), style: { textAlign: 'right' } }}
              />
            </PropertyRow>
          );
        })}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 2, rowGap: 0.5, mt: 1, maxWidth: 900 }}>
        <Typography data-testid="working-days-total" sx={{ fontSize: 13, color: 'kanap.text.primary' }}>
          {t('workingDayCalendars.days.total', { count: Number(shownTotal), total: shownTotal, year })}
        </Typography>
        {standard && edited && standardTotal != null && (
          <Typography data-testid="working-days-standard" sx={{ fontSize: 12, color: 'kanap.text.tertiary' }}>
            {t('workingDayCalendars.days.standardTotal', { count: Number(standardTotal), total: standardTotal })}
          </Typography>
        )}
        {standard && !disabled && edited && standardDays && (
          <Box component="button" type="button" onClick={() => void onSaveYear(year, null)} sx={tealLinkSx}>
            {t('workingDayCalendars.days.resetToStandard')}
          </Box>
        )}
        {!disabled && !standard && !stored && check.empty && previous && (
          <Box component="button" type="button" onClick={copyPrevious} sx={tealLinkSx}>
            {t('workingDayCalendars.days.copyFrom', { year: year - 1 })}
          </Box>
        )}
        {!disabled && !standard && stored && (
          <Box
            component="button"
            type="button"
            onClick={() => {
              // Lines computed on this calendar keep their amounts, but cannot be recomputed for the year.
              if (usage) setConfirmRemove(true);
              else void onSaveYear(year, null);
            }}
            sx={{ ...tealLinkSx, color: 'kanap.text.tertiary', '&:hover': { color: 'error.main', textDecoration: 'underline', textUnderlineOffset: '2px' } }}
          >
            {t('workingDayCalendars.days.removeYear', { year })}
          </Box>
        )}
      </Box>
      {holidaysText && (
        <Typography data-testid="working-days-holidays" sx={{ mt: 0.5, fontSize: 12, lineHeight: 1.45, color: 'kanap.text.tertiary', maxWidth: 900 }}>
          {holidaysText}
        </Typography>
      )}
      {status && (
        <Typography
          role={status.tone === 'error' ? 'alert' : undefined}
          data-testid="working-days-status"
          sx={{ mt: 0.5, fontSize: 12, lineHeight: 1.35, color: status.tone === 'error' ? 'error.main' : 'kanap.text.tertiary' }}
        >
          {status.text}
        </Typography>
      )}
      <KanapDialog
        open={confirmRemove}
        title={t('workingDayCalendars.days.removeDialog.title', { year })}
        onClose={() => setConfirmRemove(false)}
        onSave={async () => {
          setConfirmRemove(false);
          await onSaveYear(year, null);
        }}
        saveLabel={t('workingDayCalendars.days.removeDialog.confirm')}
      >
        <Typography sx={{ fontSize: 13, color: 'kanap.text.primary' }}>
          {t('workingDayCalendars.days.removeDialog.body', { usage, year })}
        </Typography>
      </KanapDialog>
    </Box>
  );
}

