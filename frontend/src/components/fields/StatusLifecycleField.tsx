import React from 'react';
import { Box, Stack, TextField, IconButton, InputAdornment } from '@mui/material';
import EventIcon from '@mui/icons-material/Event';
import { useTranslation } from 'react-i18next';
import StatusSwitch from './StatusSwitch';
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

  // Hidden native date input to keep a calendar picker available
  const hiddenNativeRef = React.useRef<HTMLInputElement | null>(null);
  const openNativePicker = () => {
    hiddenNativeRef.current?.showPicker?.();
    // fallback: click to trigger some browsers
    if (!hiddenNativeRef.current?.showPicker) hiddenNativeRef.current?.click();
  };
  const onNativeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const yyyyMmDd = e.target.value; // YYYY-MM-DD
    if (!yyyyMmDd) { setInputText(''); onDisabledAtChange(null); onStatusChange(deriveStatusFromDisabledAt(null)); return; }
    const [y, m, d] = yyyyMmDd.split('-');
    const ddmmyyyy = `${d}/${m}/${y}`;
    setInputText(ddmmyyyy);
    const iso = euDateToIsoEndOfDay(ddmmyyyy);
    onDisabledAtChange(iso);
    onStatusChange(deriveStatusFromDisabledAt(iso));
  };

  return (
    // Positioned so the hidden date input below stays inside this field when a properties
    // drawer scrolls; showPicker() anchors the native calendar on that input's box.
    <Stack spacing={1.5} alignItems="flex-start" sx={{ position: 'relative' }}>
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
          <input
            ref={hiddenNativeRef}
            type="date"
            style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }}
            value={isoToLocalDateInput(disabledAt)}
            onChange={onNativeChange}
          />
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <FieldLabel>{disabledAtLabel ?? t('lifecycleField.endOfValidity')}</FieldLabel>
            <TextField
            placeholder={t('labels.datePlaceholder')}
            value={inputText}
            onChange={handleDisabledAtTextChange}
            onBlur={handleDisabledAtBlur}
            disabled={disabled}
            name={disabledAtName}
            error={disabledAtError}
            helperText={disabledAtHelperText ?? t('lifecycleField.endOfValidityHint')}
            inputProps={{ inputMode: 'numeric' }}
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton size="small" onClick={openNativePicker} aria-label={t('labels.openCalendar')} tabIndex={-1}>
                    <EventIcon fontSize="small" />
                  </IconButton>
                </InputAdornment>
              )
            }}
            />
          </Box>
        </>
      )}
    </Stack>
  );
};

export default StatusLifecycleField;
