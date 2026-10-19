import { Box, Link, Tooltip, type SxProps, type Theme } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/AuthContext';
import { canUseOperation } from '../../pages/operations/operationAccess';
import { attentionDotSx } from '../../theme/formSx';
import { formatAmount } from '../../i18n/formatters';
import { fxMissingText, type FxMissing } from './fxMissing';

/** The administration page where a rate can be entered by hand. */
export const CURRENCY_SETTINGS_PATH = '/ops/operations/currency';

/** Opens the currency page on one pair. With several pairs the page highlights the whole list. */
export function currencySettingsHref(pair: { currency: string; year: number }): string {
  const params = new URLSearchParams({ currency: pair.currency, year: String(pair.year) });
  return `${CURRENCY_SETTINGS_PATH}?${params.toString()}`;
}

/**
 * One line saying which amounts the totals leave out for lack of an exchange rate: the currencies
 * and years in the order received, with their line counts. `message` replaces that sentence (a
 * turnover total words companies, not lines) and still links to the first pair. Users who can open
 * the currency settings get a link to enter a rate. Nothing when there is neither a message nor a pair.
 */
export default function FxMissingNotice({
  items,
  message,
  wrap = false,
  sx,
}: {
  items?: ReadonlyArray<FxMissing> | null;
  message?: string;
  /** Lets a long notice wrap under a grid instead of ending in an ellipsis. */
  wrap?: boolean;
  sx?: SxProps<Theme>;
}) {
  const { t } = useTranslation('ops');
  const { hasLevel } = useAuth();
  const list = items ?? [];
  if (!message && !list.length) return null;
  const text = message || fxMissingText(t, list);
  const canEnterRate = canUseOperation('currency', hasLevel);
  return (
    <Box
      role="status"
      sx={[
        {
          display: 'flex',
          alignItems: wrap ? 'flex-start' : 'center',
          gap: 0.75,
          minWidth: 0,
          maxWidth: '100%',
          fontSize: 12,
          lineHeight: '20px',
          color: 'warning.main',
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      <Box component="span" sx={attentionDotSx} />
      <Tooltip title={text} placement="top-start">
        <Box
          component="span"
          sx={wrap
            ? { minWidth: 0, whiteSpace: 'normal', overflowWrap: 'anywhere' }
            : { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >{text}</Box>
      </Tooltip>
      {canEnterRate && list[0] && (
        <Link component={RouterLink} to={currencySettingsHref(list[0])} underline="hover" sx={{ fontSize: 12, flexShrink: 0, whiteSpace: 'nowrap' }}>
          {t('shared.fxMissing.enterRate')}
        </Link>
      )}
    </Box>
  );
}

/**
 * The mark beside an amount shown in its own currency because its year has no exchange rate: an
 * attention dot whose tooltip says the amount is left out of the totals. `label` words it for a sum
 * that left such an amount out.
 */
export function FxMissingMark(props: { currency: string; year: number } | { label: string }) {
  const { t } = useTranslation('ops');
  const label = 'label' in props ? props.label : t('shared.fxMissing.lineTooltip', { currency: props.currency, year: props.year });
  return (
    <Tooltip title={label}>
      <Box component="span" role="img" aria-label={label} sx={{ ...attentionDotSx, ml: '2px' }} />
    </Tooltip>
  );
}

/**
 * An amount shown in its own currency because its year has no exchange rate, with the mark: the
 * cell of a line that the totals leave out.
 */
export function FxMissingLocalAmount({ amount, currency, year }: { amount: number; currency: string; year: number }) {
  const { t } = useTranslation('ops');
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}>
      {t('shared.fxMissing.localAmount', { amount: formatAmount(amount), currency })}
      <FxMissingMark currency={currency} year={year} />
    </Box>
  );
}
