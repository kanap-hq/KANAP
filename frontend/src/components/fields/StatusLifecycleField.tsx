import React from 'react';
import { Box, Stack, TextField, IconButton, InputAdornment } from '@mui/material';
import EventIcon from '@mui/icons-material/Event';
import { useTranslation } from 'react-i18next';
import StatusSwitch from './StatusSwitch';
import DateCalendarPopover from './DateCalendarPopover';
import { FieldLabel } from '../design';
import { STATUS_ENABLED, STATUS_DISABLED, StatusValue, deriveStatusFromDisabledAt } from '../../constants/status';
import { isoToEuDate, euDateToIsoEndOfDay, formatEuPartial } from '../../lib/date-eu';
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
  const locale = useLocale();
  // At rest the date shows the charter display format, as DateEUField; numeric dd/mm/yyyy only while editing.
  const restYmd = isoToLocalDateInput(disabledAt);
  const shownText = !focused && restYmd && inputText === isoToEuDate(disabledAt)
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
    const formatted = isoToEuDate(disabledAt);
    setInputText(formatted);
  }, [disabledAt]);

  const handleDisabledAtTextChange = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const raw = event.target.value;
    const formatted = formatEuPartial(raw);
    setInputText(formatted);
    const iso = euDateToIsoEndOfDay(formatted);
    // The day already stored, typed again: it keeps its time of day (a switch sets one), nothing is sent.
    if (iso && formatted !== isoToEuDate(disabledAt)) {
      onDisabledAtChange(iso);
      onStatusChange(deriveStatusFromDisabledAt(iso));
    }
  }, [disabledAt, onDisabledAtChange, onStatusChange]);

  const handleDisabledAtBlur = React.useCallback(() => {
    setFocused(false);
    const iso = euDateToIsoEndOfDay(inputText);
    if (!iso && inputText.trim() !== '') {
      // Invalid → keep text as-is for user correction; do not change outer value
      return;
    }
    if (!iso) {
      // Empty → clear
      onDisabledAtChange(null);
      onStatusChange(deriveStatusFromDisabledAt(null));
      setInputText('');
    } else {
      // Normalize displayed value
      setInputText(isoToEuDate(iso));
    }
  }, [inputText, onDisabledAtChange, onStatusChange]);

  // In-page calendar, hung from the date input box.
  const dateFieldRef = React.useRef<HTMLDivElement | null>(null);
  const [calendarAnchor, setCalendarAnchor] = React.useState<HTMLElement | null>(null);
  const openCalendar = () => {
    if (disabled) return;
    setCalendarAnchor(dateFieldRef.current?.querySelector<HTMLElement>('.MuiInputBase-root') ?? null);
  };
  const onCalendarSelect = (yyyyMmDd: string) => {
    if (!yyyyMmDd) { setInputText(''); onDisabledAtChange(null); onStatusChange(deriveStatusFromDisabledAt(null)); return; }
    const [y, m, d] = yyyyMmDd.split('-');
    const ddmmyyyy = `${d}/${m}/${y}`;
    setInputText(ddmmyyyy);
    // The day already stored, picked again: it keeps its time of day, nothing is sent.
    if (ddmmyyyy === isoToEuDate(disabledAt)) return;
    const iso = euDateToIsoEndOfDay(ddmmyyyy);
    onDisabledAtChange(iso);
    onStatusChange(deriveStatusFromDisabledAt(iso));
  };

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
            onFocus={() => setFocused(true)}
            onBlur={handleDisabledAtBlur}
            onKeyDown={(event) => {
              // Alt+Down opens the calendar from the keyboard; its button is out of the tab order.
              if (event.altKey && event.key === 'ArrowDown') {
                event.preventDefault();
                openCalendar();
              }
            }}
            disabled={disabled}
            name={disabledAtName}
            error={disabledAtError}
            helperText={disabledAtHelperText ?? t('lifecycleField.endOfValidityHint')}
            inputProps={{ inputMode: 'numeric' }}
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
