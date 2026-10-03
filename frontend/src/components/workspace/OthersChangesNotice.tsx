import { Box, Button, Tooltip, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { StatusDot } from '../design/StatusDot';
import { formatShortDate } from '../../lib/dateFormat';
import type { OthersChange } from '../../hooks/othersChanges';
import { formatTime, sameDay } from './EditConflictBanner';

/**
 * What others changed on the record a workspace shows (plan planning/perf-scale, lot 3G), in the
 * header's actions:
 * - after the page refreshed in place: a quiet line, "Changed by Marie Dupont at 14:02" ("You
 *   changed this item in another window at 14:02" when it was the user, in another window);
 * - while something of the user is pending: a small "Changed elsewhere" mark and « Reload », which
 *   shows the changes and keeps what is pending (not while a conflict banner already asks about
 *   the same item: the page passes no `outdated` then);
 * - the item was deleted: "This item was deleted".
 * A polite live region, always present, so screen readers hear either when it appears.
 */

const visuallyHiddenSx = {
  border: 0, clip: 'rect(0 0 0 0)', height: '1px', m: '-1px', overflow: 'hidden', p: 0, position: 'absolute', whiteSpace: 'nowrap', width: '1px',
} as const;

/** "Changed by Marie Dupont at 14:02" and its variants (another day, nobody known, no time, the user's own). */
export function othersChangeMessage(change: OthersChange, t: TFunction, locale: string, now = new Date(), currentUserId?: string | null): string {
  const key = (name: string) => `common:othersChanges.${name}`;
  const self = !!currentUserId && change.by?.id === currentUserId;
  // A user without a name is "a user" (names only, never the e-mail).
  const name = change.by ? change.by.name || t(key('aUser')) : null;
  const parsed = change.at ? new Date(change.at) : null;
  const when = parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
  if (when && !sameDay(when, now)) {
    const date = formatShortDate(when, locale);
    const time = formatTime(when, locale);
    if (self) return t(key('changedByYouOn'), { date, time });
    return name ? t(key('changedByOn'), { name, date, time }) : t(key('changedOn'), { date, time });
  }
  if (when) {
    const time = formatTime(when, locale);
    if (self) return t(key('changedByYouAt'), { time });
    return name ? t(key('changedByAt'), { name, time }) : t(key('changedAt'), { time });
  }
  if (self) return t(key('changedByYou'));
  return name ? t(key('changedBy'), { name }) : t(key('changed'));
}

export type OthersChangesNoticeProps = {
  notice: OthersChange | null;
  /** The item was deleted elsewhere. */
  gone?: boolean;
  outdated: OthersChange | null;
  reloading?: boolean;
  onReload: () => void;
  currentUserId?: string | null;
};

export default function OthersChangesNotice({ notice, gone = false, outdated, reloading = false, onReload, currentUserId }: OthersChangesNoticeProps) {
  const { t, i18n } = useTranslation('common');
  const locale = i18n.resolvedLanguage || i18n.language || 'en';
  const message = (change: OthersChange) => othersChangeMessage(change, t, locale, new Date(), currentUserId);
  return (
    <Box
      role="status"
      aria-live="polite"
      sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, minWidth: 0, alignSelf: 'center' }}
    >
      {gone ? (
        <Box
          component="span"
          data-testid="others-changes-gone"
          sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, fontSize: 12, color: 'kanap.text.secondary', whiteSpace: 'nowrap' }}
        >
          <StatusDot color="warning.main" size={6} />
          {t('othersChanges.deleted')}
        </Box>
      ) : outdated ? (
        <>
          <Tooltip title={`${message(outdated)}. ${t('othersChanges.reloadHint')}`}>
            <Box
              component="span"
              data-testid="others-changes-outdated"
              sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, fontSize: 12, color: 'kanap.text.secondary', whiteSpace: 'nowrap' }}
            >
              <StatusDot color="warning.main" size={6} />
              {t('othersChanges.badge')}
            </Box>
          </Tooltip>
          {/* The same details for screen readers, which do not open the tooltip. */}
          <Box component="span" sx={visuallyHiddenSx}>{`${message(outdated)}. ${t('othersChanges.reloadHint')}`}</Box>
          <Button variant="action" size="small" disabled={reloading} onClick={onReload}>
            {t('othersChanges.reload')}
          </Button>
        </>
      ) : notice ? (
        <Typography
          data-testid="others-changes-notice"
          title={message(notice)}
          sx={{ fontSize: 12, color: 'kanap.text.tertiary', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 320 }}
        >
          {message(notice)}
        </Typography>
      ) : null}
    </Box>
  );
}
