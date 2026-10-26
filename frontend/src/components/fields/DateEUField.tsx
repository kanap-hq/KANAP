import React from 'react';
import { flushSync } from 'react-dom';
import { TextField, InputAdornment, IconButton, SxProps, Theme, Box } from '@mui/material';
import EventIcon from '@mui/icons-material/Event';
import { dateInputSeparator, euToYmd, ymdToEu, formatEuPartialAt } from '../../lib/date-eu';
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
  const [invalid, setInvalid] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const mouseDownRef = React.useRef(false);
  const selectOnMouseUpRef = React.useRef(false);
  const justFocusedRef = React.useRef(false);
  const pendingCaretRef = React.useRef<number | null>(null);
  const [calendarAnchor, setCalendarAnchor] = React.useState<HTMLElement | null>(null);
  const locale = useLocale();
  // Typed dates follow the language: 15/10/2026, or 15.10.2026 in German.
  const sep = dateInputSeparator(locale);
  const { t } = useTranslation('common');

  // Normalize the input value to YYYY-MM-DD format
  const normalizedYmd = toYmdOnly(valueYmd);
  // The date the field last stood for: the value, or a typed date sent and not yet back from the
  // caller, so a blur right after Enter does not send it twice.
  const committedRef = React.useRef(normalizedYmd);
  React.useEffect(() => { committedRef.current = normalizedYmd; }, [normalizedYmd]);

  // sync from value (skip while the user is editing, and keep an invalid typed text on screen)
  React.useEffect(() => {
    if (!focused && !invalid) setText(ymdToEu(normalizedYmd, sep));
  }, [normalizedYmd, focused, sep, invalid]);

  // At rest the field shows the charter display format; numeric dd/mm/yyyy (dd.mm.yyyy) only while editing.
  const restText = normalizedYmd ? formatShortDate(normalizedYmd, locale, { year: 'always' }) : '';

  const onTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const inputType = (e.nativeEvent as InputEvent).inputType;
    const deleting = inputType === 'deleteContentBackward' || inputType === 'deleteContentForward';
    const { text: formatted, caret } = formatEuPartialAt(raw, e.target.selectionStart ?? raw.length, sep, !deleting);
    setText(formatted);
    setInvalid(false);
    pendingCaretRef.current = caret;
  };

  // A typed date is sent on blur, Enter or Ctrl+S, once complete, and only when it changes the value:
  // typing "15" over a day sends nothing on the way. An emptied text clears the date. Returns false
  // when the text is not a date (the blur then shows the error).
  const commitText = () => {
    const ymd = euToYmd(text);
    if (!ymd && text.trim() === '') {
      setText('');
      setInvalid(false);
      if (committedRef.current) {
        committedRef.current = '';
        onChangeYmd('');
      }
      return true;
    }
    if (!ymd) return false;
    setText(ymdToEu(ymd, sep));
    setInvalid(false);
    if (ymd !== committedRef.current) {
      committedRef.current = ymd;
      onChangeYmd(ymd);
    }
    return true;
  };

  const onFocus = () => {
    pendingCaretRef.current = null;
    // A blurred invalid text stays in place so it can be corrected; Escape restores the saved date.
    if (!invalid) setText(ymdToEu(normalizedYmd, sep));
    setInvalid(false);
    setFocused(true);
    justFocusedRef.current = true;
    // A click must select the new edit text after the render; the browser would otherwise collapse
    // that selection on mouse up. Keyboard focus and autoFocus need no second selection.
    selectOnMouseUpRef.current = mouseDownRef.current;
    mouseDownRef.current = false;
  };

  const onBlur = () => {
    setFocused(false);
    pendingCaretRef.current = null;
    selectOnMouseUpRef.current = false;
    mouseDownRef.current = false;
    // A non-empty text that is not a full valid date stays in place and shows the error.
    if (!commitText()) setInvalid(true);
  };

  // Select the whole edit text on entering the field, so the first keystroke replaces the date.
  // The selection waits for the render that swaps the display format for dd/mm/yyyy.
  React.useLayoutEffect(() => {
    if (!focused || !justFocusedRef.current) return;
    justFocusedRef.current = false;
    inputRef.current?.select();
  }, [focused]);

  // Put the caret back where the edited digit now sits, once the formatted text is rendered.
  React.useLayoutEffect(() => {
    if (!focused) return;
    const caret = pendingCaretRef.current;
    if (caret == null) return;
    pendingCaretRef.current = null;
    const input = inputRef.current;
    if (!input) return;
    const next = Math.max(0, Math.min(caret, input.value.length));
    input.setSelectionRange(next, next);
  }, [text, focused]);

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
    pendingCaretRef.current = null;
    setInvalid(false);
    committedRef.current = ymd;
    onChangeYmd(ymd);
    setText(ymdToEu(ymd, sep));
  };

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Escape drops the typing and keeps the focus. It stops here only when there was typing to
    // drop, so a second Escape (or one on an untouched field) still closes a popover or the page.
    if (e.key === 'Escape') {
      const savedText = ymdToEu(normalizedYmd, sep);
      if (text !== savedText) {
        e.preventDefault();
        e.stopPropagation();
      }
      pendingCaretRef.current = null;
      setText(savedText);
      setInvalid(false);
      return;
    }
    // Enter and Ctrl+S send the date now and render the caller before the key goes on, so a save
    // shortcut further up (or a form) reads the new date. The focus stays in the field.
    if (e.key === 'Enter' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's')) {
      flushSync(() => { commitText(); });
      return;
    }
    // Alt+Down opens the calendar from the keyboard: the button itself stays out of the tab order.
    if (e.altKey && e.key === 'ArrowDown') {
      e.preventDefault();
      openPicker();
    }
  };

  // The caller's error and helper text win; otherwise an invalid blurred text shows its message.
  const ownError = invalid && !focused;
  const shownError = error || ownError;
  const shownHelperText = helperText ?? (ownError ? t('labels.dateInvalid') : undefined);

  const naked = hideLabel || !label;

  return (
    <Box ref={rootRef} sx={{ position: 'relative', ...sx }}>
      {!naked && <FieldLabel required={required} sx={{ mb: '2px' }}>{label}</FieldLabel>}
      <TextField
        placeholder={t('labels.datePlaceholder')}
        value={focused || invalid ? text : restText}
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
        error={shownError}
        helperText={shownHelperText}
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
