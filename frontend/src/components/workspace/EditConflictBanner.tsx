import React from 'react';
import { Box, Button, Link, Stack, Typography } from '@mui/material';
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
 * from the server (`labels`). The user's value is the one waiting to be saved,
 * kept up to date while the user goes on typing in the field.
 *
 * Accessibility: a region named by its title; a polite live region announces
 * the title when the banner appears or its count changes (not each keystroke
 * in a waiting field); after the last choice, focus goes where the page says
 * (`returnFocus`), not to the page's body.
 */
export type EditConflictBannerProps = {
  conflicts: readonly EditConflict[];
  fieldLabel: (field: string) => string;
  /** Display of a value without a server label (a date, an enum); undefined for the default (the text itself). */
  formatValue?: (field: string, value: unknown, conflict: EditConflict) => string | undefined;
  /** Fields shown as two texts side by side (description, notes). */
  isLongText?: (field: string) => boolean;
  onResolve: (field: string, choice: ConflictChoice) => void;
  /** A save is running: the choices wait for its answer. */
  busy?: boolean;
  /** The signed-in user: a change of their own, from another window, is said so. */
  currentUserId?: string | null;
  /** Called after the last choice, once the banner goes: the page focuses the field or the workspace. */
  returnFocus?: (field: string) => void;
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

/**
 * "Marie Dupont changed this field at 14:02 while you were editing it." and its variants;
 * "You changed this field in another window at 14:02." when the change is the user's own.
 */
export function conflictMessage(conflict: EditConflict, t: TFunction, locale: string, now = new Date(), currentUserId?: string | null): string {
  const self = !!currentUserId && conflict.changed_by?.id === currentUserId;
  const name = conflict.changed_by?.name;
  const at = conflict.changed_at ? new Date(conflict.changed_at) : null;
  const when = at && !Number.isNaN(at.getTime()) ? at : null;
  const time = when ? formatTime(when, locale) : '';
  if (when && !sameDay(when, now)) {
    const date = formatShortDate(when, locale);
    if (self) return t('common:editConflict.changedByYouOn', { date, time });
    return name
      ? t('common:editConflict.changedByOn', { name, date, time })
      : t('common:editConflict.changedOn', { date, time });
  }
  if (when) {
    if (self) return t('common:editConflict.changedByYouAt', { time });
    return name ? t('common:editConflict.changedByAt', { name, time }) : t('common:editConflict.changedAt', { time });
  }
  if (self) return t('common:editConflict.changedByYou');
  return name ? t('common:editConflict.changedBy', { name }) : t('common:editConflict.changed');
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const visuallyHiddenSx = {
  border: 0, clip: 'rect(0 0 0 0)', height: '1px', m: '-1px', overflow: 'hidden', p: 0, position: 'absolute', whiteSpace: 'nowrap', width: '1px',
} as const;
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
  onChoose,
}: {
  conflict: EditConflict;
  props: EditConflictBannerProps;
  onChoose: (field: string, choice: ConflictChoice) => void;
}) {
  const { t, i18n } = useTranslation('common');
  const locale = i18n.resolvedLanguage || i18n.language || 'en';
  const { fieldLabel, formatValue, isLongText, busy, currentUserId } = props;
  const show = (value: unknown, label: string | null, edited = false): { text: string; empty: boolean } => {
    if (label) return { text: label, empty: false };
    if (value == null || value === '') return { text: t('editConflict.empty'), empty: true };
    const formatted = formatValue?.(conflict.field, value, conflict);
    if (formatted !== undefined) return { text: formatted, empty: false };
    // An id or a structure the server could not name: the record it named is gone; a value the
    // user picked after the answer is the one the field shows.
    if (typeof value === 'object' || (typeof value === 'string' && UUID.test(value))) {
      return { text: edited ? t('editConflict.newChoice') : t('editConflict.unavailable'), empty: true };
    }
    return { text: String(value), empty: false };
  };
  const theirs = show(conflict.current, conflict.labels.current);
  const mine = show(conflict.mine, conflict.labels.mine, !!conflict.mineEdited);
  const long = !!isLongText?.(conflict.field);
  const label = fieldLabel(conflict.field);

  return (
    <Box
      data-testid={`edit-conflict-${conflict.field}`}
      sx={{ '& + &': { borderTop: '1px solid', borderColor: 'kanap.border.soft', mt: 1.25, pt: 1.25 } }}
    >
      <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'kanap.text.primary', lineHeight: 1.4 }}>{label}</Typography>
      <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary', lineHeight: 1.5 }}>
        {conflictMessage(conflict, t, locale, new Date(), currentUserId)}
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
          onClick={() => onChoose(conflict.field, 'theirs')}
          aria-label={`${t('editConflict.keepTheirs')}: ${label}`}
        >
          {t('editConflict.keepTheirs')}
        </Button>
        <Button
          variant="action"
          size="small"
          disabled={busy}
          onClick={() => onChoose(conflict.field, 'mine')}
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
  const titleId = React.useId();
  const { conflicts, onResolve, returnFocus, currentUserId } = props;
  // Every change the user's own (another window of theirs): "You changed …", not "Someone else …".
  const own = !!currentUserId && conflicts.every((conflict) => conflict.changed_by?.id === currentUserId);
  const title = conflicts.length > 0 ? t(own ? 'editConflict.titleSelf' : 'editConflict.title', { count: conflicts.length }) : '';
  const choose = React.useCallback((field: string, choice: ConflictChoice) => {
    const last = conflicts.length === 1;
    onResolve(field, choice);
    // The focused button goes with the banner: hand the focus on before React removes it.
    if (last) returnFocus?.(field);
  }, [conflicts.length, onResolve, returnFocus]);

  return (
    <>
      {/* Always present, so the title is announced when it appears; the rows are read in the region. */}
      <Box role="status" aria-live="polite" sx={visuallyHiddenSx}>{title}</Box>
      {conflicts.length > 0 && (
        <Box
          role="region"
          aria-labelledby={titleId}
          sx={{
            mx: 2,
            mt: 1,
            px: 2,
            py: 1.5,
            bgcolor: 'kanap.bg.drawer',
            border: '1px solid',
            borderColor: 'kanap.border.default',
            borderRadius: '8px',
            // Several long texts must not push the line out of the screen: the rows scroll.
            maxHeight: '40vh',
            display: 'flex',
            flexDirection: 'column',
            flexShrink: 0,
          }}
        >
          <Stack direction="row" spacing={1} alignItems="center">
            <StatusDot color="warning.main" size={8} />
            <Typography id={titleId} sx={{ fontSize: 13, fontWeight: 500, color: 'kanap.text.primary' }}>
              {title}
            </Typography>
          </Stack>
          <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary', mt: 0.25, mb: 1.25, pl: 2 }}>
            {t('editConflict.hint')}
          </Typography>
          <Box data-testid="edit-conflict-rows" sx={{ minHeight: 0, overflowY: 'auto' }}>
            {conflicts.map((conflict) => (
              <ConflictRow key={conflict.field} conflict={conflict} props={props} onChoose={choose} />
            ))}
          </Box>
        </Box>
      )}
    </>
  );
}

/**
 * One line on another item's workspace: the user left an item with a choice
 * waiting (the browser's back button), and it is still kept for the session.
 */
export function OtherConflictsNotice({ items, onOpen }: { items: Array<{ id: string; label: string }>; onOpen: (id: string) => void }) {
  const { t } = useTranslation('common');
  if (items.length === 0) return null;
  return (
    <Box
      data-testid="edit-conflict-elsewhere"
      sx={{ mx: 2, mt: 1, display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 1.5, rowGap: 0.5, fontSize: 12 }}
    >
      <StatusDot color="warning.main" size={6} />
      <Typography component="span" sx={{ fontSize: 12, color: 'kanap.text.secondary' }}>
        {t('editConflict.elsewhere', { count: items.length, items: items.map((item) => item.label).join(', ') })}
      </Typography>
      {items.map((item) => (
        <Link key={item.id} component="button" type="button" underline="hover" onClick={() => onOpen(item.id)} sx={{ fontSize: 12 }}>
          {t('editConflict.open', { item: item.label })}
        </Link>
      ))}
    </Box>
  );
}
