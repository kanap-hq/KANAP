import React from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { StatusDot } from '../design/StatusDot';
import { formatShortDate } from '../../lib/dateFormat';
import type { ConflictChoice, EditConflict } from '../../hooks/editConflicts';

/**
 * The choice a workspace asks for when someone else changed a field the user
 * was saving (plan planning/perf-scale, lot 3C, decision D3): one row per
 * field, who changed it and when, their value and the user's, "Keep their
 * value" or "Apply yours". Long texts show both versions side by side.
 *
 * Generic: the page gives the field labels and, for values that are not
 * plain text (dates, enums), their display. Id values come with their names
 * from the server (`labels`).
 */
export type EditConflictBannerProps = {
  conflicts: readonly EditConflict[];
  fieldLabel: (field: string) => string;
  /** Display of a value without a server label (a date, an enum); undefined for the default (the text itself). */
  formatValue?: (field: string, value: unknown) => string | undefined;
  /** Fields shown as two texts side by side (description, notes). */
  isLongText?: (field: string) => boolean;
  onResolve: (field: string, choice: ConflictChoice) => void;
  /** A save is running: the choices wait for its answer. */
  busy?: boolean;
};

const timeFormatters = new Map<string, Intl.DateTimeFormat>();

function formatTime(date: Date, locale: string): string {
  let formatter = timeFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
    timeFormatters.set(locale, formatter);
  }
  return formatter.format(date);
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "Marie Dupont changed this field at 14:02 while you were editing it." and its variants. */
export function conflictMessage(conflict: EditConflict, t: TFunction, locale: string, now = new Date()): string {
  const name = conflict.changed_by?.name;
  const at = conflict.changed_at ? new Date(conflict.changed_at) : null;
  const when = at && !Number.isNaN(at.getTime()) ? at : null;
  const time = when ? formatTime(when, locale) : '';
  if (when && !sameDay(when, now)) {
    const date = formatShortDate(when, locale);
    return name
      ? t('common:editConflict.changedByOn', { name, date, time })
      : t('common:editConflict.changedOn', { date, time });
  }
  if (when) return name ? t('common:editConflict.changedByAt', { name, time }) : t('common:editConflict.changedAt', { time });
  return name ? t('common:editConflict.changedBy', { name }) : t('common:editConflict.changed');
}

const valueSx = { fontSize: 13, lineHeight: 1.5, color: 'kanap.text.primary', minWidth: 0, overflowWrap: 'anywhere' } as const;
const valueLabelSx = { fontSize: 12, lineHeight: 1.5, color: 'kanap.text.tertiary', whiteSpace: 'nowrap' } as const;
const longTextSx = {
  ...valueSx,
  mt: 0.5,
  p: '10px 12px',
  bgcolor: 'kanap.bg.composer',
  border: '1px solid',
  borderColor: 'kanap.border.default',
  borderRadius: '8px',
  whiteSpace: 'pre-wrap',
  maxHeight: 180,
  overflow: 'auto',
} as const;

function ConflictRow({
  conflict,
  props,
}: {
  conflict: EditConflict;
  props: EditConflictBannerProps;
}) {
  const { t, i18n } = useTranslation('common');
  const locale = i18n.resolvedLanguage || i18n.language || 'en';
  const { fieldLabel, formatValue, isLongText, onResolve, busy } = props;
  const show = (value: unknown, label: string | null): { text: string; empty: boolean } => {
    if (label) return { text: label, empty: false };
    if (value == null || value === '') return { text: t('editConflict.empty'), empty: true };
    const formatted = formatValue?.(conflict.field, value);
    if (formatted !== undefined) return { text: formatted, empty: false };
    return { text: typeof value === 'object' ? JSON.stringify(value) : String(value), empty: false };
  };
  const theirs = show(conflict.current, conflict.labels.current);
  const mine = show(conflict.mine, conflict.labels.mine);
  const long = !!isLongText?.(conflict.field);
  const label = fieldLabel(conflict.field);

  return (
    <Box
      data-testid={`edit-conflict-${conflict.field}`}
      sx={{ '& + &': { borderTop: '1px solid', borderColor: 'kanap.border.soft', mt: 1.25, pt: 1.25 } }}
    >
      <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'kanap.text.primary', lineHeight: 1.4 }}>{label}</Typography>
      <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary', lineHeight: 1.5 }}>
        {conflictMessage(conflict, t, locale)}
      </Typography>
      {long ? (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 1.5, mt: 1 }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={valueLabelSx}>{t('editConflict.theirValue')}</Typography>
            <Box sx={{ ...longTextSx, color: theirs.empty ? 'kanap.text.tertiary' : valueSx.color }}>{theirs.text}</Box>
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={valueLabelSx}>{t('editConflict.yourValue')}</Typography>
            <Box sx={{ ...longTextSx, color: mine.empty ? 'kanap.text.tertiary' : valueSx.color }}>{mine.text}</Box>
          </Box>
        </Box>
      ) : (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'max-content minmax(0, 1fr)', columnGap: 1.5, mt: 0.75 }}>
          <Typography sx={valueLabelSx}>{t('editConflict.theirValue')}</Typography>
          <Typography sx={{ ...valueSx, color: theirs.empty ? 'kanap.text.tertiary' : valueSx.color }}>{theirs.text}</Typography>
          <Typography sx={valueLabelSx}>{t('editConflict.yourValue')}</Typography>
          <Typography sx={{ ...valueSx, color: mine.empty ? 'kanap.text.tertiary' : valueSx.color }}>{mine.text}</Typography>
        </Box>
      )}
      <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
        <Button
          variant="action"
          size="small"
          disabled={busy}
          onClick={() => onResolve(conflict.field, 'theirs')}
          aria-label={`${t('editConflict.keepTheirs')}: ${label}`}
        >
          {t('editConflict.keepTheirs')}
        </Button>
        <Button
          variant="action"
          size="small"
          disabled={busy}
          onClick={() => onResolve(conflict.field, 'mine')}
          aria-label={`${t('editConflict.applyMine')}: ${label}`}
        >
          {t('editConflict.applyMine')}
        </Button>
      </Stack>
    </Box>
  );
}

export default function EditConflictBanner(props: EditConflictBannerProps) {
  const { t } = useTranslation('common');
  if (props.conflicts.length === 0) return null;
  return (
    <Box
      role="alert"
      sx={{
        mx: 2,
        mt: 1,
        px: 2,
        py: 1.5,
        bgcolor: 'kanap.bg.drawer',
        border: '1px solid',
        borderColor: 'kanap.border.default',
        borderRadius: '8px',
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center">
        <StatusDot color="warning.main" size={8} />
        <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'kanap.text.primary' }}>
          {t('editConflict.title', { count: props.conflicts.length })}
        </Typography>
      </Stack>
      <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary', mt: 0.25, mb: 1.25, pl: 2 }}>
        {t('editConflict.hint')}
      </Typography>
      {props.conflicts.map((conflict) => (
        <ConflictRow key={conflict.field} conflict={conflict} props={props} />
      ))}
    </Box>
  );
}
