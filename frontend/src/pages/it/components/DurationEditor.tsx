import i18n from '../../../i18n';
import { useTranslation } from 'react-i18next';
import { classificationText } from '../../../utils/applicationClassification';
import React from 'react';
import { Box, MenuItem, Select, Typography } from '@mui/material';
import FormattedNumberField from '../../../components/inputs/FormattedNumberField';
import { decimalMark } from '../../../i18n/formatters';
import { useLocale } from '../../../i18n/useLocale';
import { drawerFieldValueSx, drawerMenuItemSx, drawerSelectSx } from '../../../theme/formSx';

export type DurationUnit = 'minutes' | 'hours' | 'days' | 'weeks';
const FACTORS: Record<DurationUnit, number> = { minutes: 1, hours: 60, days: 1440, weeks: 10080 };
export const MAX_DURATION_MINUTES = 2147483647;

export function durationToMinutes(input: string, unit: DurationUnit, allowZero = false): number | null {
  if (input.trim() === '') return null;
  const value = Number(input);
  const minutes = value * FACTORS[unit];
  if (!Number.isFinite(value) || value < 0 || (!allowZero && value === 0) || !Number.isInteger(minutes) || minutes > MAX_DURATION_MINUTES) {
    return null;
  }
  return minutes;
}

export function bestDurationUnit(minutes: number | null): DurationUnit {
  if (minutes == null) return 'hours';
  if (minutes === 0) return 'minutes';
  if (minutes % FACTORS.weeks === 0) return 'weeks';
  if (minutes % FACTORS.days === 0) return 'days';
  if (minutes % FACTORS.hours === 0) return 'hours';
  return 'minutes';
}

export function formatDuration(minutes: number | null, notSet = classificationText("Not set")): string {
  if (minutes == null) return notSet;
  const unit = bestDurationUnit(minutes);
  const value = minutes / FACTORS[unit];
  const units = { minutes: 'minute', hours: 'hour', days: 'day', weeks: 'week' } as const;
  return new Intl.NumberFormat(i18n.resolvedLanguage || 'en', { style: 'unit', unit: units[unit], unitDisplay: 'short' }).format(value);
}

type Props = {
  value: number | null;
  onCommit: (minutes: number | null) => void | Promise<void>;
  onDraftStateChange?: (blocking: boolean) => void;
  allowZero?: boolean;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
};

export default function DurationEditor({ value, onCommit, onDraftStateChange, allowZero = false, disabled, placeholder, ariaLabel }: Props) {
  const { t } = useTranslation('it');
  const locale = useLocale();
  const initialUnit = bestDurationUnit(value);
  const [unit, setUnit] = React.useState<DurationUnit>(initialUnit);
  const [draft, setDraft] = React.useState(value == null ? '' : String(value / FACTORS[initialUnit]));
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const nextUnit = bestDurationUnit(value);
    setUnit(nextUnit);
    setDraft(value == null ? '' : String(value / FACTORS[nextUnit]));
    setError(null);
    onDraftStateChange?.(false);
  }, [value]);

  const reportDraft = (nextDraft: string, nextUnit: DurationUnit) => {
    if (nextDraft.trim() === '') {
      onDraftStateChange?.(value !== null);
      return;
    }
    const minutes = durationToMinutes(nextDraft, nextUnit, allowZero);
    onDraftStateChange?.(minutes == null || minutes !== value);
  };

  // The unit named for the value typed: "1 hour", "2 hours".
  const typedCount = Number(draft);
  const unitLabel = (item: DurationUnit) => t(`classification.unit_${item}`, { count: item === unit && draft.trim() !== '' && Number.isFinite(typedCount) ? typedCount : 2 });
  const renderUnit = (item: string) => unitLabel(item as DurationUnit);

  const commit = () => {
    if (draft.trim() === '') {
      setError(null);
      reportDraft(draft, unit);
      void Promise.resolve(onCommit(null)).catch(() => {});
      return;
    }
    const minutes = durationToMinutes(draft, unit, allowZero);
    if (minutes == null) {
      const raw = Number(draft) * FACTORS[unit];
      const fraction = Number.isFinite(raw) && raw > 0 && !Number.isInteger(raw);
      setError(fraction ? t('classification.duration_whole_minutes') : t(`classification.${allowZero ? 'duration_zero' : 'duration_positive'}_${unit}`));
      onDraftStateChange?.(true);
      return;
    }
    setError(null);
    onDraftStateChange?.(minutes !== value);
    if (minutes !== value) void Promise.resolve(onCommit(minutes)).catch(() => {});
  };

  return (
    <Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(90px, 1fr) 110px', gap: 1, maxWidth: 280 }}>
        <FormattedNumberField
          value={draft}
          emit="string"
          // Wide on purpose: extra decimals must reach the whole-minute check.
          decimals={12}
          decimalSeparator={decimalMark(locale)}
          onChange={(event) => {
            const next = String(event.target.value ?? '');
            setDraft(next);
            setError(null);
            reportDraft(next, unit);
          }}
          onBlur={commit}
          onKeyDown={(event) => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur(); }}
          inputProps={{ 'aria-label': ariaLabel }}
          placeholder={placeholder}
          disabled={disabled}
          variant="standard"
          sx={drawerFieldValueSx}
          error={!!error}
        />
        <Select
          value={unit}
          onChange={(event) => {
            const nextUnit = event.target.value as DurationUnit;
            const minutes = durationToMinutes(draft, unit, allowZero);
            const nextDraft = minutes == null ? draft : String(minutes / FACTORS[nextUnit]);
            if (minutes != null) setDraft(nextDraft);
            setUnit(nextUnit);
            reportDraft(nextDraft, nextUnit);
          }}
          disabled={disabled}
          variant="standard"
          renderValue={renderUnit}
          inputProps={{ 'aria-label': `${ariaLabel || 'Duration'} unit` }}
          sx={drawerSelectSx}
        >
          {(['minutes', 'hours', 'days', 'weeks'] as DurationUnit[]).map((item) => <MenuItem key={item} value={item} sx={drawerMenuItemSx}>{unitLabel(item)}</MenuItem>)}
        </Select>
      </Box>
      {error && <Typography role="alert" sx={(theme) => ({ mt: 0.5, fontSize: 11, color: theme.palette.kanap.danger })}>{error}</Typography>}
    </Box>
  );
}
