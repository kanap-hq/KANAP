import React from 'react';
import { Box, TextField } from '@mui/material';
import { useTranslation } from 'react-i18next';
import DateEUField from '../../../components/fields/DateEUField';
import { isoToLocalDateTimeInput } from '../../../lib/datetime';
import { drawerDatePickerSx, drawerFieldValueSx, inlineControlSx } from '../../../theme/formSx';

type Props = {
  value: string | null;
  onChange: (next: string | null) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Inline control (e.g. journal composer footer): no field box, hover surface instead. */
  inline?: boolean;
};

/** "9", "930", "9:30", "0930" or "09:30" as "09:30" (24 hours), or null when it is not a time. */
export function parseTime(text: string): string | null {
  const match = /^(\d{1,2})(?::?(\d{2}))?$/.exec(text.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2] ?? '0');
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** A local day (YYYY-MM-DD) and time (HH:MM) as an ISO instant. */
function toIso(ymd: string, time: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return new Date(y, m - 1, d, h, mi).toISOString();
}

/**
 * Date and time of an incident timestamp: the app's date field and a 24-hour time, in the app's
 * language (the browser's date-time input follows the browser's). A new date keeps the time, and
 * a first date starts at 00:00. A time the field cannot read goes back to the last one it could
 * on blur, and clearing the date clears the timestamp.
 */
export default function IncidentDateTimeField({ value, onChange, disabled = false, autoFocus = false, inline = false }: Props) {
  const { t } = useTranslation('common');
  const saved = isoToLocalDateTimeInput(value); // YYYY-MM-DDTHH:MM, or ''
  const [ymd, setYmd] = React.useState(saved.slice(0, 10));
  const [time, setTime] = React.useState(saved.slice(11, 16));
  // The last time the field could read: what an unreadable time goes back to on blur.
  const lastTimeRef = React.useRef(saved.slice(11, 16));

  React.useEffect(() => {
    setYmd(saved.slice(0, 10));
    setTime(saved.slice(11, 16));
    lastTimeRef.current = saved.slice(11, 16);
  }, [saved]);

  const commit = (nextYmd: string, nextTime: string) => {
    if (`${nextYmd}T${nextTime}` === saved) return;
    onChange(toIso(nextYmd, nextTime));
  };

  const onDateChange = (nextYmd: string) => {
    setYmd(nextYmd);
    if (!nextYmd) {
      if (value) onChange(null);
      return;
    }
    const nextTime = parseTime(time) ?? '00:00';
    setTime(nextTime);
    lastTimeRef.current = nextTime;
    commit(nextYmd, nextTime);
  };

  // The time is saved on blur (or Enter), once typed: "1", "14" and "14:0" are not saved on the way.
  const onTimeBlur = () => {
    const parsed = parseTime(time);
    if (!parsed || !ymd) {
      setTime(lastTimeRef.current);
      return;
    }
    setTime(parsed);
    lastTimeRef.current = parsed;
    commit(ymd, parsed);
  };

  const fieldSx = inline ? [drawerFieldValueSx, drawerDatePickerSx, inlineControlSx] : [drawerFieldValueSx, drawerDatePickerSx];

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <DateEUField
        label=""
        hideLabel
        valueYmd={ymd}
        onChangeYmd={onDateChange}
        disabled={disabled}
        autoFocus={autoFocus}
        sx={{ flex: 1, minWidth: 0 }}
        textFieldSx={fieldSx}
      />
      <TextField
        value={time}
        onChange={(event) => setTime(event.target.value)}
        onBlur={onTimeBlur}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onTimeBlur();
        }}
        disabled={disabled || !ymd}
        placeholder={t('labels.timePlaceholder')}
        variant="standard"
        inputProps={{ inputMode: 'numeric', 'aria-label': t('labels.time') }}
        sx={[...fieldSx, { width: 64, flexShrink: 0 }]}
      />
    </Box>
  );
}
