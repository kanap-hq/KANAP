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
 * and years in the order received, with their line counts. Users who can open the currency settings
 * get a link to enter a rate for the first pair. Nothing for an empty or absent list.
 */
export default function FxMissingNotice({ items, sx }: { items: ReadonlyArray<FxMissing> | null | undefined; sx?: SxProps<Theme> }) {
  const { t } = useTranslation('ops');
  const { hasLevel } = useAuth();
  if (!items?.length) return null;
  const text = fxMissingText(t, items);
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
        <Link component={RouterLink} to={currencySettingsHref(items[0])} underline="hover" sx={{ fontSize: 12, flexShrink: 0, whiteSpace: 'nowrap' }}>
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
