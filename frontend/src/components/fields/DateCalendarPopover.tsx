import React from 'react';
import { Box, Button, IconButton, Popover } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import KeyboardDoubleArrowLeftIcon from '@mui/icons-material/KeyboardDoubleArrowLeft';
import KeyboardDoubleArrowRightIcon from '@mui/icons-material/KeyboardDoubleArrowRight';
import { useTranslation } from 'react-i18next';
import { useLocale } from '../../i18n/useLocale';

/**
 * In-page calendar for date fields. It replaces the browser's native picker, which the page
 * cannot keep inside the window: this one is a Popover, placed below the field (or above it
 * when there is more room there) and clamped to the window by MUI.
 *
 * Dates are local `YYYY-MM-DD` strings throughout; nothing goes through `toISOString()`.
 */
export type DateCalendarPopoverProps = {
  anchorEl: HTMLElement | null;
  open: boolean;
  /** YYYY-MM-DD, or '' when the field is empty. A time part (`...T...`) is ignored. */
  valueYmd: string;
  /** Called with YYYY-MM-DD, or '' when cleared. The calendar closes itself afterwards. */
  onSelect: (ymd: string) => void;
  onClose: () => void;
  /** Shows the Clear button when the field has a value. */
  allowClear?: boolean;
};

export type CalendarPlacement = 'below' | 'above';

const CELL_WIDTH = 32;
const CELL_HEIGHT = 28;
const PAPER_PADDING = 8;
/** Paper height: padding, header (28 + 4), weekday row (20), 6 weeks, footer (4 + 28). */
export const CALENDAR_HEIGHT = PAPER_PADDING * 2 + 32 + 20 + CELL_HEIGHT * 6 + 32;
const ANCHOR_GAP = 4;

/** Below the anchor, unless the calendar does not fit there and there is more room above. */
export function computeCalendarPlacement(
  anchorRect: Pick<DOMRect, 'top' | 'bottom'>,
  viewportHeight: number,
  calendarHeight: number = CALENDAR_HEIGHT + ANCHOR_GAP,
): CalendarPlacement {
  const spaceBelow = viewportHeight - anchorRect.bottom;
  const spaceAbove = anchorRect.top;
  if (spaceBelow < calendarHeight && spaceAbove > spaceBelow) return 'above';
  return 'below';
}

type Ymd = { y: number; m: number; d: number }; // m is 0-based

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function fromDate(date: Date): Ymd {
  return { y: date.getFullYear(), m: date.getMonth(), d: date.getDate() };
}

function toDate({ y, m, d }: Ymd): Date {
  const date = new Date(y, m, d);
  // Years below 100 would map to 19xx with the constructor above.
  date.setFullYear(y, m, d);
  return date;
}

function toYmdString({ y, m, d }: Ymd): string {
  return `${String(y).padStart(4, '0')}-${pad2(m + 1)}-${pad2(d)}`;
}

function parseYmd(value: string): Ymd | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '');
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]) - 1;
  const d = Number(match[3]);
  if (m < 0 || m > 11 || d < 1) return null;
  if (d > daysInMonth(y, m)) return null;
  return { y, m, d };
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m + 1, 0).getDate();
}

function sameDay(a: Ymd | null, b: Ymd | null): boolean {
  return !!a && !!b && a.y === b.y && a.m === b.m && a.d === b.d;
}

function addDays(value: Ymd, days: number): Ymd {
  const date = toDate(value);
  date.setDate(date.getDate() + days);
  return fromDate(date);
}

/** Same day in another month, clamped to that month's last day (31 Jan + 1 month = 28/29 Feb). */
function addMonths(value: Ymd, months: number): Ymd {
  const index = value.y * 12 + value.m + months;
  const y = Math.floor(index / 12);
  const m = index - y * 12;
  return { y, m, d: Math.min(value.d, daysInMonth(y, m)) };
}

/** Monday = 0 ... Sunday = 6. */
function weekdayIndex(value: Ymd): number {
  return (toDate(value).getDay() + 6) % 7;
}

/** The 42 days shown for a month: six weeks, starting on the Monday on or before the 1st. */
function monthGrid(y: number, m: number): Ymd[] {
  const first: Ymd = { y, m, d: 1 };
  const start = addDays(first, -weekdayIndex(first));
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

function todayYmd(): Ymd {
  return fromDate(new Date());
}

const navButtonSx: SxProps<Theme> = (theme) => ({
  p: '4px',
  color: theme.palette.kanap.text.secondary,
  '&:hover': { bgcolor: theme.palette.kanap.bg.hover },
});

const footerButtonSx: SxProps<Theme> = {
  minWidth: 0,
  px: 1,
  py: '2px',
  fontSize: 13,
  fontWeight: 500,
};

export default function DateCalendarPopover({
  anchorEl,
  open,
  valueYmd,
  onSelect,
  onClose,
  allowClear = false,
}: DateCalendarPopoverProps) {
  const { t } = useTranslation('common');
  const isOpen = open && !!anchorEl;

  const placement = React.useMemo<CalendarPlacement>(() => {
    if (!isOpen || !anchorEl) return 'below';
    return computeCalendarPlacement(anchorEl.getBoundingClientRect(), window.innerHeight);
  }, [isOpen, anchorEl]);

  const above = placement === 'above';

  return (
    <Popover
      open={isOpen}
      anchorEl={anchorEl}
      onClose={onClose}
      // The theme turns focus restore off for popovers; a date field wants its focus back.
      disableRestoreFocus={false}
      anchorOrigin={{ vertical: above ? 'top' : 'bottom', horizontal: 'left' }}
      transformOrigin={{ vertical: above ? 'bottom' : 'top', horizontal: 'left' }}
      slotProps={{
        paper: {
          role: 'dialog',
          'aria-label': t('calendar.label'),
          'data-placement': placement,
          sx: (theme: Theme) => ({
            mt: above ? `-${ANCHOR_GAP}px` : `${ANCHOR_GAP}px`,
            p: `${PAPER_PADDING}px`,
            border: `1px solid ${theme.palette.kanap.border.default}`,
            bgcolor: theme.palette.kanap.bg.primary,
            backgroundImage: 'none',
          }),
        } as Record<string, unknown>,
      }}
    >
      {isOpen && (
        <CalendarBody valueYmd={valueYmd} allowClear={allowClear} onSelect={onSelect} onClose={onClose} />
      )}
    </Popover>
  );
}

function CalendarBody({
  valueYmd,
  allowClear,
  onSelect,
  onClose,
}: {
  valueYmd: string;
  allowClear: boolean;
  onSelect: (ymd: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation('common');
  const locale = useLocale();
  const selected = React.useMemo(() => parseYmd(valueYmd), [valueYmd]);
  const today = React.useMemo(() => todayYmd(), []);

  // The focused day drives the visible month; the grid starts on the selected day, else today.
  const [focused, setFocused] = React.useState<Ymd>(() => selected ?? today);
  // Set when the focused day must take the DOM focus: on open and after a key press in the grid.
  // Month buttons move the view without pulling the focus away from themselves.
  const moveFocusRef = React.useRef(true);
  const gridRef = React.useRef<HTMLDivElement | null>(null);
  const labelId = React.useId();

  const focusedYmd = toYmdString(focused);
  React.useEffect(() => {
    if (!moveFocusRef.current) return;
    moveFocusRef.current = false;
    const button = gridRef.current?.querySelector<HTMLButtonElement>(`[data-ymd="${focusedYmd}"]`);
    button?.focus();
  }, [focusedYmd]);

  const formatters = React.useMemo(
    () => ({
      monthYear: new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }),
      weekdayNarrow: new Intl.DateTimeFormat(locale, { weekday: 'narrow' }),
      weekdayLong: new Intl.DateTimeFormat(locale, { weekday: 'long' }),
      fullDate: new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    }),
    [locale],
  );

  const days = React.useMemo(() => monthGrid(focused.y, focused.m), [focused.y, focused.m]);
  const weeks = React.useMemo(
    () => Array.from({ length: 6 }, (_, i) => days.slice(i * 7, i * 7 + 7)),
    [days],
  );
  // Weekday names from the first week, which starts on a Monday.
  const weekdays = weeks[0];

  const select = (ymd: string) => {
    onSelect(ymd);
    onClose();
  };

  const moveView = (months: number) => {
    setFocused((current) => addMonths(current, months));
  };

  const onGridKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    let next: Ymd | null = null;
    switch (event.key) {
      case 'ArrowLeft':
        next = addDays(focused, -1);
        break;
      case 'ArrowRight':
        next = addDays(focused, 1);
        break;
      case 'ArrowUp':
        next = addDays(focused, -7);
        break;
      case 'ArrowDown':
        next = addDays(focused, 7);
        break;
      case 'PageUp':
        next = addMonths(focused, event.shiftKey ? -12 : -1);
        break;
      case 'PageDown':
        next = addMonths(focused, event.shiftKey ? 12 : 1);
        break;
      case 'Home':
        next = addDays(focused, -weekdayIndex(focused));
        break;
      case 'End':
        next = addDays(focused, 6 - weekdayIndex(focused));
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        event.stopPropagation();
        select(focusedYmd);
        return;
      default:
        return;
    }
    // Handled here: keep the keys from reaching the page or dialog that holds the field.
    event.preventDefault();
    event.stopPropagation();
    moveFocusRef.current = true;
    setFocused(next);
  };

  const monthLabel = formatters.monthYear.format(toDate({ y: focused.y, m: focused.m, d: 1 }));

  return (
    <Box sx={{ width: CELL_WIDTH * 7 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', height: 28, mb: '4px' }}>
        <IconButton size="small" sx={navButtonSx} aria-label={t('calendar.previousYear')} onClick={() => moveView(-12)}>
          <KeyboardDoubleArrowLeftIcon sx={{ fontSize: 16 }} />
        </IconButton>
        <IconButton size="small" sx={navButtonSx} aria-label={t('calendar.previousMonth')} onClick={() => moveView(-1)}>
          <ChevronLeftIcon sx={{ fontSize: 16 }} />
        </IconButton>
        <Box
          id={labelId}
          aria-live="polite"
          sx={(theme) => ({
            flex: 1,
            textAlign: 'center',
            fontSize: 13,
            fontWeight: 500,
            color: theme.palette.kanap.text.primary,
            whiteSpace: 'nowrap',
          })}
        >
          {monthLabel}
        </Box>
        <IconButton size="small" sx={navButtonSx} aria-label={t('calendar.nextMonth')} onClick={() => moveView(1)}>
          <ChevronRightIcon sx={{ fontSize: 16 }} />
        </IconButton>
        <IconButton size="small" sx={navButtonSx} aria-label={t('calendar.nextYear')} onClick={() => moveView(12)}>
          <KeyboardDoubleArrowRightIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Box>

      <Box ref={gridRef} role="grid" aria-labelledby={labelId} onKeyDown={onGridKeyDown}>
        <Box role="row" sx={{ display: 'flex' }}>
          {weekdays.map((day) => {
            const date = toDate(day);
            return (
              <Box
                key={toYmdString(day)}
                role="columnheader"
                aria-label={formatters.weekdayLong.format(date)}
                sx={(theme) => ({
                  width: CELL_WIDTH,
                  height: 20,
                  lineHeight: '20px',
                  textAlign: 'center',
                  fontSize: 11,
                  fontWeight: 500,
                  color: theme.palette.kanap.text.tertiary,
                })}
              >
                {formatters.weekdayNarrow.format(date)}
              </Box>
            );
          })}
        </Box>
        {weeks.map((week) => (
          <Box key={toYmdString(week[0])} role="row" sx={{ display: 'flex' }}>
            {week.map((day) => {
              const ymd = toYmdString(day);
              const isSelected = sameDay(day, selected);
              const isToday = sameDay(day, today);
              const isFocusTarget = ymd === focusedYmd;
              const outside = day.m !== focused.m;
              return (
                <Box key={ymd} role="gridcell" aria-selected={isSelected} sx={{ width: CELL_WIDTH, height: CELL_HEIGHT, p: '1px' }}>
                  <Box
                    component="button"
                    type="button"
                    data-ymd={ymd}
                    tabIndex={isFocusTarget ? 0 : -1}
                    aria-label={formatters.fullDate.format(toDate(day))}
                    aria-current={isToday ? 'date' : undefined}
                    onClick={() => select(ymd)}
                    sx={(theme) => ({
                      width: '100%',
                      height: '100%',
                      p: 0,
                      m: 0,
                      border: '1px solid transparent',
                      borderRadius: '6px',
                      bgcolor: 'transparent',
                      font: 'inherit',
                      fontSize: 13,
                      fontWeight: 400,
                      fontVariantNumeric: 'tabular-nums',
                      color: outside ? theme.palette.kanap.text.tertiary : theme.palette.kanap.text.primary,
                      cursor: 'pointer',
                      '&:hover': { bgcolor: theme.palette.kanap.bg.hover },
                      '&:focus-visible': {
                        outline: `2px solid ${theme.palette.primary.main}`,
                        outlineOffset: '-1px',
                      },
                      ...(isToday && !isSelected ? { borderColor: theme.palette.kanap.text.tertiary } : {}),
                      ...(isSelected
                        ? {
                            bgcolor: theme.palette.primary.main,
                            color: theme.palette.kanap.tealForeground,
                            fontWeight: 500,
                            '&:hover': { bgcolor: theme.palette.primary.dark },
                            '&:focus-visible': {
                              outline: `2px solid ${theme.palette.primary.main}`,
                              outlineOffset: '1px',
                            },
                          }
                        : {}),
                    })}
                  >
                    {day.d}
                  </Box>
                </Box>
              );
            })}
          </Box>
        ))}
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 28, mt: '4px' }}>
        {allowClear && selected ? (
          <Button size="small" sx={footerButtonSx} onClick={() => select('')}>
            {t('buttons.clear')}
          </Button>
        ) : (
          <span />
        )}
        <Button size="small" sx={footerButtonSx} onClick={() => select(toYmdString(todayYmd()))}>
          {t('calendar.today')}
        </Button>
      </Box>
    </Box>
  );
}
