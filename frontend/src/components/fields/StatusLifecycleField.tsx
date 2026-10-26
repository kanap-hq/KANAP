import React from 'react';
import { flushSync } from 'react-dom';
import { Box, Stack, TextField, IconButton, InputAdornment } from '@mui/material';
import EventIcon from '@mui/icons-material/Event';
import { useTranslation } from 'react-i18next';
import StatusSwitch from './StatusSwitch';
import DateCalendarPopover from './DateCalendarPopover';
import { FieldLabel } from '../design';
import { STATUS_ENABLED, STATUS_DISABLED, StatusValue, deriveStatusFromDisabledAt } from '../../constants/status';
import { dateInputSeparator, isoToEuDate, euDateToIsoEndOfDay, formatEuPartial } from '../../lib/date-eu';
import { isoToLocalDateInput } from '../../lib/datetime';
import { formatShortDate } from '../../lib/dateFormat';
import { useLocale } from '../../i18n/useLocale';

type StatusLifecycleFieldProps = {
  status: StatusValue;
  onStatusChange: (next: StatusValue) => void;
  disabledAt: string | null;
  onDisabledAtChange: (next: string | null) => void;
  /**
   * Switched off with no end of validity already passed: disable now. The caller sends the status
   * alone (`{ status: 'disabled' }`, no `disabled_at`) and the server sets the end of validity from
   * its own clock. The browser clock never decides it.
   */
  onDisableNow: () => void;
  disabled?: boolean;
  hideDisabledAt?: boolean;
  statusLabel?: string;
  statusOffLabel?: string;
  statusName?: string;
  statusError?: boolean;
  statusHelperText?: string;
  disabledAtLabel?: string;
  disabledAtName?: string;
  disabledAtError?: boolean;
  disabledAtHelperText?: string;
};

const StatusLifecycleField: React.FC<StatusLifecycleFieldProps> = ({
  status,
  onStatusChange,
  disabledAt,
  onDisabledAtChange,
  onDisableNow,
  disabled = false,
  hideDisabledAt = false,
  statusLabel,
  statusOffLabel,
  statusName,
  statusError,
  statusHelperText,
  disabledAtLabel,
  disabledAtName,
  disabledAtError,
  disabledAtHelperText,
}) => {
  const { t } = useTranslation('common');
  const onLabel = statusLabel ?? t('statuses.enabled');
  const offLabel = statusOffLabel ?? t('statuses.disabled');

  // Switching off disables now, on the server's clock (`onDisableNow`), unless an end of validity
  // has already passed. A later end of validity is set in the date field.
  const handleStatusToggle = React.useCallback(
    (nextEnabled: boolean) => {
      if (nextEnabled) {
        onDisabledAtChange(null);
        onStatusChange(STATUS_ENABLED);
        return;
      }
      const alreadyEnded = !!disabledAt && deriveStatusFromDisabledAt(disabledAt) === STATUS_DISABLED;
      if (!alreadyEnded) {
        onDisableNow();
        return;
      }
      onDisabledAtChange(disabledAt);
      onStatusChange(STATUS_DISABLED);
    },
    [disabledAt, onDisabledAtChange, onDisableNow, onStatusChange],
  );

  // Local text state to allow free typing (dd/mm/yyyy) without fighting controlled updates
  const [inputText, setInputText] = React.useState<string>('');
  const [focused, setFocused] = React.useState(false);
  const [invalid, setInvalid] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const mouseDownRef = React.useRef(false);
  const selectOnMouseUpRef = React.useRef(false);
  const justFocusedRef = React.useRef(false);
  const locale = useLocale();
  // Typed dates follow the language: 31/12/2027, or 31.12.2027 in German.
  const sep = dateInputSeparator(locale);
  // At rest the date shows the charter display format, as DateEUField; numeric dd/mm/yyyy only while editing.
  const restYmd = isoToLocalDateInput(disabledAt);
  const shownText = !focused && restYmd && inputText === isoToEuDate(disabledAt, sep)
    ? formatShortDate(restYmd, locale, { year: 'always' })
    : inputText;
  // A future end of validity keeps the record active until then: the switch says so.
  const activeUntilYmd = status === STATUS_ENABLED && disabledAt && deriveStatusFromDisabledAt(disabledAt) === STATUS_ENABLED
    ? isoToLocalDateInput(disabledAt)
    : '';
  const shownOnLabel = activeUntilYmd
    ? t('lifecycleField.activeUntil', { date: formatShortDate(activeUntilYmd, locale, { year: 'always' }) })
    : onLabel;
  // Sync from prop
  React.useEffect(() => {
    const formatted = isoToEuDate(disabledAt, sep);
    setInputText(formatted);
  }, [disabledAt, sep]);

  // The text last sent to the caller, so that Enter then blur (or Ctrl+S then blur) sends once.
  const sentTextRef = React.useRef<string | null>(null);
  React.useEffect(() => { sentTextRef.current = null; }, [disabledAt]);

  // Typing only changes the text: the date is sent once, on Enter, blur or Ctrl+S.
  const handleDisabledAtTextChange = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    sentTextRef.current = null;
    setInvalid(false);
    setInputText(formatEuPartial(event.target.value, sep));
  }, [sep]);

  const commitDisabledAt = React.useCallback(() => {
    if (sentTextRef.current === inputText) return;
    const iso = euDateToIsoEndOfDay(inputText);
    if (!iso && inputText.trim() !== '') {
      // Invalid → keep text as-is for user correction; do not change outer value
      return;
    }
    if (!iso) {
      // Empty → clear
      setInputText('');
      if (!disabledAt) return;
      sentTextRef.current = inputText;
      onDisabledAtChange(null);
      onStatusChange(deriveStatusFromDisabledAt(null));
      return;
    }
    // Normalize displayed value
    setInputText(isoToEuDate(iso, sep));
    // The day already stored, typed again: it keeps its time of day (a switch sets one), nothing is sent.
    if (inputText === isoToEuDate(disabledAt, sep)) return;
    sentTextRef.current = inputText;
    onDisabledAtChange(iso);
    onStatusChange(deriveStatusFromDisabledAt(iso));
  }, [disabledAt, inputText, onDisabledAtChange, onStatusChange, sep]);

  const handleDisabledAtFocus = () => {
    setInvalid(false);
    setFocused(true);
    justFocusedRef.current = true;
    // A click must select the edit text after the render; the browser would otherwise collapse
    // that selection on mouse up. Keyboard focus needs no second selection.
    selectOnMouseUpRef.current = mouseDownRef.current;
    mouseDownRef.current = false;
  };

  const handleDisabledAtBlur = React.useCallback(() => {
    setFocused(false);
    selectOnMouseUpRef.current = false;
    mouseDownRef.current = false;
    // A non-empty text that is not a full valid date stays in place and shows the error.
    setInvalid(inputText.trim() !== '' && !euDateToIsoEndOfDay(inputText));
    commitDisabledAt();
  }, [commitDisabledAt, inputText]);

  // Select the whole edit text on entering the field, so the first keystroke replaces the date.
  // The selection waits for the render that swaps the display format for dd/mm/yyyy.
  React.useLayoutEffect(() => {
    if (!focused || !justFocusedRef.current) return;
    justFocusedRef.current = false;
    inputRef.current?.select();
  }, [focused]);

  const handleDisabledAtMouseUp = (event: React.MouseEvent<HTMLInputElement>) => {
    if (!selectOnMouseUpRef.current) return;
    selectOnMouseUpRef.current = false;
    event.preventDefault();
    event.currentTarget.select();
  };

  const handleDisabledAtKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    // Alt+Down opens the calendar from the keyboard; its button is out of the tab order.
    if (event.altKey && event.key === 'ArrowDown') {
      event.preventDefault();
      openCalendar();
    } else if (event.key === 'Enter') {
      commitDisabledAt();
    } else if (event.key === 'Escape') {
      // Cancels the typing and keeps the key from closing the page; with nothing typed it goes on.
      if (inputText === isoToEuDate(disabledAt, sep)) return;
      event.preventDefault();
      event.stopPropagation();
      sentTextRef.current = null;
      setInvalid(false);
      setInputText(isoToEuDate(disabledAt, sep));
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      // The page's save shortcut listens on the window, after this handler: the date and what the
      // page does with it must be rendered before the key gets there, or it saves the old value.
      flushSync(commitDisabledAt);
    }
  };

  // In-page calendar, hung from the date input box.
  const dateFieldRef = React.useRef<HTMLDivElement | null>(null);
  const [calendarAnchor, setCalendarAnchor] = React.useState<HTMLElement | null>(null);
  const openCalendar = () => {
    if (disabled) return;
    setCalendarAnchor(dateFieldRef.current?.querySelector<HTMLElement>('.MuiInputBase-root') ?? null);
  };
  const onCalendarSelect = (yyyyMmDd: string) => {
    setInvalid(false);
    if (!yyyyMmDd) { setInputText(''); onDisabledAtChange(null); onStatusChange(deriveStatusFromDisabledAt(null)); return; }
    const [y, m, d] = yyyyMmDd.split('-');
    const ddmmyyyy = `${d}${sep}${m}${sep}${y}`;
    setInputText(ddmmyyyy);
    // The day already stored, picked again: it keeps its time of day, nothing is sent.
    if (ddmmyyyy === isoToEuDate(disabledAt, sep)) return;
    const iso = euDateToIsoEndOfDay(ddmmyyyy);
    onDisabledAtChange(iso);
    onStatusChange(deriveStatusFromDisabledAt(iso));
  };

  // The caller's error and its text win; otherwise an invalid blurred text shows its message, over
  // the caller's hint (budget lines and contracts pass one).
  const ownError = invalid && !focused;
  const shownHelperText = disabledAtError && disabledAtHelperText
    ? disabledAtHelperText
    : ownError ? t('labels.dateInvalid') : disabledAtHelperText ?? t('lifecycleField.endOfValidityHint');

  return (
    <Stack spacing={1.5} alignItems="flex-start">
      <StatusSwitch
        label={onLabel}
        onDisplayLabel={shownOnLabel}
        offLabel={offLabel}
        value={status === STATUS_ENABLED}
        onChange={handleStatusToggle}
        disabled={disabled}
        error={statusError}
        helperText={statusHelperText}
        name={statusName}
      />
      {!hideDisabledAt && (
        <>
          <Box ref={dateFieldRef} sx={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <FieldLabel>{disabledAtLabel ?? t('lifecycleField.endOfValidity')}</FieldLabel>
            <TextField
            placeholder={t('labels.datePlaceholder')}
            value={shownText}
            onChange={handleDisabledAtTextChange}
            onFocus={handleDisabledAtFocus}
            onBlur={handleDisabledAtBlur}
            onKeyDown={handleDisabledAtKeyDown}
            disabled={disabled}
            name={disabledAtName}
            inputRef={inputRef}
            error={disabledAtError || ownError}
            helperText={shownHelperText}
            inputProps={{
              inputMode: 'numeric',
              onMouseDown: () => { mouseDownRef.current = true; },
              onMouseUp: handleDisabledAtMouseUp,
            }}
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton size="small" onClick={openCalendar} aria-label={t('labels.openCalendar')} tabIndex={-1} disabled={disabled}>
                    <EventIcon fontSize="small" />
                  </IconButton>
                </InputAdornment>
              )
            }}
            />
          </Box>
          <DateCalendarPopover
            anchorEl={calendarAnchor}
            open={!!calendarAnchor}
            valueYmd={isoToLocalDateInput(disabledAt)}
            onSelect={onCalendarSelect}
            onClose={() => setCalendarAnchor(null)}
            allowClear
          />
        </>
      )}
    </Stack>
  );
};

export default StatusLifecycleField;
