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

type StatusLifecycleFieldProps = {
  status: StatusValue;
  onStatusChange: (next: StatusValue) => void;
  disabledAt: string | null;
  onDisabledAtChange: (next: string | null) => void;
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

  const buildEndOfDayIsoFromToday = React.useCallback(() => {
    // Use today's local end-of-day ISO
    const t = new Date();
    const local = new Date(t.getFullYear(), t.getMonth(), t.getDate(), 23, 59, 0, 0);
    return local.toISOString();
  }, []);

  const handleStatusToggle = React.useCallback(
    (nextEnabled: boolean) => {
      if (nextEnabled) {
        // Clear date
        onDisabledAtChange(null);
        onStatusChange(STATUS_ENABLED);
        return;
      }
      if (hideDisabledAt) {
        const nowIso = new Date().toISOString();
        onDisabledAtChange(nowIso);
        onStatusChange(STATUS_DISABLED);
        return;
      }
      const nextValue = disabledAt ?? buildEndOfDayIsoFromToday();
      onDisabledAtChange(nextValue);
      onStatusChange(deriveStatusFromDisabledAt(nextValue));
    },
    [buildEndOfDayIsoFromToday, disabledAt, hideDisabledAt, onDisabledAtChange, onStatusChange],
  );

  // Local text state to allow free typing (dd/mm/yyyy) without fighting controlled updates
  const [inputText, setInputText] = React.useState<string>('');
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
    if (iso) {
      onDisabledAtChange(iso);
      onStatusChange(deriveStatusFromDisabledAt(iso));
    }
  }, [onDisabledAtChange, onStatusChange]);

  const handleDisabledAtBlur = React.useCallback(() => {
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
    const iso = euDateToIsoEndOfDay(ddmmyyyy);
    onDisabledAtChange(iso);
    onStatusChange(deriveStatusFromDisabledAt(iso));
  };

  return (
    <Stack spacing={1.5} alignItems="flex-start">
      <StatusSwitch
        label={onLabel}
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
            value={inputText}
            onChange={handleDisabledAtTextChange}
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
