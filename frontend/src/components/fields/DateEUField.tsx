import React from 'react';
import { TextField, InputAdornment, IconButton, SxProps, Theme, Box } from '@mui/material';
import EventIcon from '@mui/icons-material/Event';
import { euToYmd, ymdToEu, formatEuPartial } from '../../lib/date-eu';
import { formatShortDate } from '../../lib/dateFormat';
import { useTranslation } from 'react-i18next';
import { useLocale } from '../../i18n/useLocale';
import { FieldLabel } from '../design';

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

export default function DateEUField({ label, valueYmd = '', onChangeYmd, disabled, required, name, error, helperText, size, sx, hideLabel = false, textFieldSx }: Props) {
  const [text, setText] = React.useState<string>('');
  const [focused, setFocused] = React.useState(false);
  const nativeRef = React.useRef<HTMLInputElement | null>(null);
  const locale = useLocale();
  const { t } = useTranslation('common');

  // Normalize the input value to YYYY-MM-DD format
  const normalizedYmd = toYmdOnly(valueYmd);

  // sync from value (skip while the user is editing)
  React.useEffect(() => {
    if (!focused) setText(ymdToEu(normalizedYmd));
  }, [normalizedYmd, focused]);

  // At rest the field shows the charter display format; numeric dd/mm/yyyy only while editing.
  const restText = normalizedYmd ? formatShortDate(normalizedYmd, locale, { year: 'always' }) : '';

  const onTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const formatted = formatEuPartial(raw);
    setText(formatted);
    const ymd = euToYmd(formatted);
    if (ymd) onChangeYmd(ymd);
  };

  const onFocus = () => {
    setText(ymdToEu(normalizedYmd));
    setFocused(true);
  };

  const onBlur = () => {
    setFocused(false);
    const ymd = euToYmd(text);
    if (!ymd && text.trim() === '') {
      onChangeYmd('');
      setText('');
      return;
    }
    if (ymd) setText(ymdToEu(ymd));
  };

  const openPicker = () => {
    nativeRef.current?.showPicker?.();
    if (!nativeRef.current?.showPicker) nativeRef.current?.click();
  };

  const onNativeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const ymd = e.target.value || '';
    onChangeYmd(ymd);
    setText(ymdToEu(ymd));
  };

  const naked = hideLabel || !label;

  return (
    <Box sx={{ position: 'relative', ...sx }}>
      {!naked && <FieldLabel required={required} sx={{ mb: '2px' }}>{label}</FieldLabel>}
      {/* Only the calendar button opens it: out of the tab order, so Tab goes from one date field to the next. */}
      <input
        ref={nativeRef}
        type="date"
        tabIndex={-1}
        aria-hidden
        style={{
          position: 'absolute',
          right: 8,
          top: '50%',
          opacity: 0,
          width: 0,
          height: 0,
          pointerEvents: 'none',
        }}
        value={normalizedYmd}
        onChange={onNativeChange}
      />
      <TextField
        placeholder={t('labels.datePlaceholder')}
        value={focused ? text : restText}
        onChange={onTextChange}
        onFocus={onFocus}
        onBlur={onBlur}
        disabled={disabled}
        required={required}
        variant="standard"
        name={name}
        error={error}
        helperText={helperText}
        size={size}
        fullWidth
        sx={textFieldSx}
        inputProps={{ inputMode: 'numeric' }}
        InputProps={{
          endAdornment: (
            <InputAdornment position="end">
              <IconButton size="small" onClick={openPicker} aria-label={t('labels.openCalendar')} tabIndex={-1}>
                <EventIcon fontSize="small" />
              </IconButton>
            </InputAdornment>
          )
        }}
      />
    </Box>
  );
}
