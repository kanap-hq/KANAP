import { Typography, type SxProps, type Theme } from '@mui/material';
import { useTranslation } from 'react-i18next';

/** The answer was computed on a limited person's data access (`dataAccessLimited: true`). */
export function isCalculatedOnAccess(data: unknown): boolean {
  return !!data && typeof data === 'object' && (data as { dataAccessLimited?: unknown }).dataAccessLimited === true;
}

/**
 * « Calculated on your access »: a small tertiary mention beside totals, reports and dashboard
 * tiles a limited person reads (spec §7.7). Renders nothing unless `show`.
 */
export default function CalculatedOnYourAccess({ show, sx }: { show: boolean; sx?: SxProps<Theme> }) {
  const { t } = useTranslation('common');
  if (!show) return null;
  return (
    <Typography component="span" data-testid="calculated-on-access" sx={[{ fontSize: 12, color: 'kanap.text.tertiary' }, ...(Array.isArray(sx) ? sx : [sx])]}>
      {t('dataAccess.calculatedOnYourAccess')}
    </Typography>
  );
}
