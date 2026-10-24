import React from 'react';
import { TextField, InputAdornment, IconButton, SxProps, Theme, Box } from '@mui/material';
import EventIcon from '@mui/icons-material/Event';
import { dateInputSeparator, euToYmd, ymdToEu, formatEuPartial } from '../../lib/date-eu';
import { formatShortDate } from '../../lib/dateFormat';
import { useTranslation } from 'react-i18next';
import { useLocale } from '../../i18n/useLocale';
import { FieldLabel } from '../design';
import DateCalendarPopover from './DateCalendarPopover';

type Props = {
  label: string;
  valueYmd?: string; // YYYY-MM-DD or ''
  onChangeYmd: (next: string) => void; // emit YYYY-MM-DD or ''
  disabled?: boolean;
  required?: boolean;
  name?: string;
  error?: boolean;
  helperText?: string;
  size?: 'small' | 'medium';
  sx?: SxProps<Theme>;
  hideLabel?: boolean;
  textFieldSx?: SxProps<Theme>;
  /** A class on the calendar popover root (see DateCalendarPopover). */
  popoverClassName?: string;
  autoFocus?: boolean;
};

// Extract just the date portion (YYYY-MM-DD) from a value that might be ISO datetime
function toYmdOnly(value: string): string {
  if (!value) return '';
  // Handle ISO datetime format (2025-12-31T00:00:00.000Z)
  if (value.includes('T')) {
    return value.split('T')[0];
  }
  return value;
}

export default function DateEUField({ label, valueYmd = '', onChangeYmd, disabled, required, name, error, helperText, size, sx, hideLabel = false, textFieldSx, popoverClassName, autoFocus }: Props) {
  const [text, setText] = React.useState<string>('');
  const [focused, setFocused] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const mouseDownRef = React.useRef(false);
  const selectOnMouseUpRef = React.useRef(false);
  const justFocusedRef = React.useRef(false);
  const [calendarAnchor, setCalendarAnchor] = React.useState<HTMLElement | null>(null);
  const locale = useLocale();
  // Typed dates follow the language: 15/10/2026, or 15.10.2026 in German.
  const sep = dateInputSeparator(locale);
  const { t } = useTranslation('common');

  // Normalize the input value to YYYY-MM-DD format
  const normalizedYmd = toYmdOnly(valueYmd);

  // sync from value (skip while the user is editing)
  React.useEffect(() => {
    if (!focused) setText(ymdToEu(normalizedYmd, sep));
  }, [normalizedYmd, focused, sep]);

  // At rest the field shows the charter display format; numeric dd/mm/yyyy (dd.mm.yyyy) only while editing.
  const restText = normalizedYmd ? formatShortDate(normalizedYmd, locale, { year: 'always' }) : '';

  const onTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const formatted = formatEuPartial(raw, sep);
    setText(formatted);
    const ymd = euToYmd(formatted);
    if (ymd) onChangeYmd(ymd);
  };

  const onFocus = () => {
    setText(ymdToEu(normalizedYmd, sep));
    setFocused(true);
    justFocusedRef.current = true;
    // A click must select the new edit text after the render; the browser would otherwise collapse
    // that selection on mouse up. Keyboard focus and autoFocus need no second selection.
    selectOnMouseUpRef.current = mouseDownRef.current;
    mouseDownRef.current = false;
  };

  const onBlur = () => {
    setFocused(false);
    selectOnMouseUpRef.current = false;
    mouseDownRef.current = false;
    const ymd = euToYmd(text);
    if (!ymd && text.trim() === '') {
      onChangeYmd('');
      setText('');
      return;
    }
    if (ymd) setText(ymdToEu(ymd, sep));
  };

  // Select the whole edit text on entering the field, so the first keystroke replaces the date.
  // The selection waits for the render that swaps the display format for dd/mm/yyyy.
  React.useLayoutEffect(() => {
    if (!focused || !justFocusedRef.current) return;
    justFocusedRef.current = false;
    inputRef.current?.select();
  }, [focused]);

  const onInputMouseUp = (event: React.MouseEvent<HTMLInputElement>) => {
    if (!selectOnMouseUpRef.current) return;
    selectOnMouseUpRef.current = false;
    event.preventDefault();
    event.currentTarget.select();
  };

  // The calendar hangs from the input box (not the button), so it lines up with the field.
  const openPicker = () => {
    if (disabled) return;
    setCalendarAnchor(rootRef.current?.querySelector<HTMLElement>('.MuiInputBase-root') ?? null);
  };

  const onCalendarSelect = (ymd: string) => {
    onChangeYmd(ymd);
    setText(ymdToEu(ymd, sep));
  };

  // Alt+Down opens the calendar from the keyboard: the button itself stays out of the tab order.
  const onInputKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey && e.key === 'ArrowDown') {
      e.preventDefault();
      openPicker();
    }
  };

  const naked = hideLabel || !label;

  return (
    <Box ref={rootRef} sx={{ position: 'relative', ...sx }}>
      {!naked && <FieldLabel required={required} sx={{ mb: '2px' }}>{label}</FieldLabel>}
      <TextField
        placeholder={t('labels.datePlaceholder')}
        value={focused ? text : restText}
        onChange={onTextChange}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={onInputKeyDown}
        disabled={disabled}
        autoFocus={autoFocus}
        inputRef={inputRef}
        required={required}
        variant="standard"
        name={name}
        error={error}
        helperText={helperText}
        size={size}
        fullWidth
        sx={textFieldSx}
        inputProps={{
          inputMode: 'numeric',
          onMouseDown: () => { mouseDownRef.current = true; },
          onMouseUp: onInputMouseUp,
        }}
        InputProps={{
          endAdornment: (
            <InputAdornment position="end">
              {/* Out of the tab order, so Tab goes from one date field to the next. */}
              <IconButton size="small" onClick={openPicker} aria-label={t('labels.openCalendar')} tabIndex={-1} disabled={disabled}>
                <EventIcon fontSize="small" />
              </IconButton>
            </InputAdornment>
          )
        }}
      />
      <DateCalendarPopover
        anchorEl={calendarAnchor}
        open={!!calendarAnchor}
        valueYmd={normalizedYmd}
        onSelect={onCalendarSelect}
        onClose={() => setCalendarAnchor(null)}
        allowClear={!required}
        className={popoverClassName}
      />
    </Box>
  );
}
