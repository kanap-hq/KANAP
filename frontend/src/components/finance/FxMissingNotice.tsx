import { Box, Link, Tooltip, type SxProps, type Theme } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/AuthContext';
import { canUseOperation } from '../../pages/operations/operationAccess';
import { attentionDotSx } from '../../theme/formSx';
import type { FxMissing } from './fxMissing';

/** The administration page where a rate can be entered by hand. */
export const CURRENCY_SETTINGS_PATH = '/ops/operations/currency';

/**
 * One line saying which amounts the totals leave out for lack of an exchange rate: the currencies
 * and years in the order received, with their line counts. Users who can open the currency settings
 * get a link to enter a rate. Nothing for an empty or absent list.
 */
export default function FxMissingNotice({ items, sx }: { items: ReadonlyArray<FxMissing> | null | undefined; sx?: SxProps<Theme> }) {
  const { t } = useTranslation('ops');
  const { hasLevel } = useAuth();
  if (!items?.length) return null;
  // Counts are per currency and year: a line missing two years is in both, so several entries give
  // no total of distinct lines.
  const text = items.length === 1
    ? t('shared.fxMissing.excluding', {
      count: items[0].lines,
      pairs: t('shared.fxMissing.pair', { currency: items[0].currency, year: items[0].year }),
    })
    : t('shared.fxMissing.excludingSeveral', {
      pairs: items.map((item) => t('shared.fxMissing.pairWithCount', { currency: item.currency, year: item.year, count: item.lines })).join(', '),
    });
  const canEnterRate = canUseOperation('currency', hasLevel);
  return (
    <Box
      role="status"
      sx={[
        { display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0, fontSize: 12, lineHeight: '20px', color: 'warning.main' },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      <Box component="span" sx={attentionDotSx} />
      <Tooltip title={text} placement="top-start">
        <Box component="span" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{text}</Box>
      </Tooltip>
      {canEnterRate && (
        <Link component={RouterLink} to={CURRENCY_SETTINGS_PATH} underline="hover" sx={{ fontSize: 12, flexShrink: 0, whiteSpace: 'nowrap' }}>
          {t('shared.fxMissing.enterRate')}
        </Link>
      )}
    </Box>
  );
}

/**
 * The mark beside an amount shown in its own currency because its year has no exchange rate: an
 * attention dot whose tooltip says the amount is left out of the totals.
 */
export function FxMissingMark({ currency, year }: { currency: string; year: number }) {
  const { t } = useTranslation('ops');
  const label = t('shared.fxMissing.lineTooltip', { currency, year });
  return (
    <Tooltip title={label}>
      <Box component="span" role="img" aria-label={label} sx={{ ...attentionDotSx, ml: '2px' }} />
    </Tooltip>
  );
}
