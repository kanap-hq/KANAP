import React from 'react';
import { Link as MLink, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';

/**
 * One line under a report while its data loads, or when it could not be loaded (with a retry):
 * a report whose numbers failed to arrive must not read as a report with nothing in it.
 */
export default function ReportDataStatus({ loading, error, onRetry }: { loading: boolean; error?: boolean; onRetry?: () => void }) {
  const { t } = useTranslation(['ops', 'common']);
  if (error) {
    return (
      <Typography role="alert" variant="body2" color="text.secondary" sx={{ mt: 1 }}>
        {t('common:messages.loadFailed')}
        {onRetry && (
          <>
            {' '}
            <MLink component="button" type="button" underline="hover" onClick={onRetry} sx={{ fontSize: 'inherit', verticalAlign: 'baseline' }}>
              {t('common:buttons.retry')}
            </MLink>
          </>
        )}
      </Typography>
    );
  }
  if (!loading) return null;
  return <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{t('ops:reports.shared.loadingData')}</Typography>;
}
