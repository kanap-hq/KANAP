import { Alert, Box, Button, Link as MuiLink } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';

/** The HTTP status of a failed read, or 0 when the request got no answer. */
export function httpStatus(error: unknown): number {
  const status = (error as { response?: { status?: number } } | null)?.response?.status;
  return typeof status === 'number' ? status : 0;
}

/**
 * The budget lines list, keeping the list's address (year, search, filters) and dropping
 * what belongs to the line page (`list`, `nature`).
 */
export function budgetLinesListPath(search: string): string {
  const params = new URLSearchParams(search);
  params.delete('list');
  params.delete('nature');
  const qs = params.toString();
  return `/ops/budget${qs ? `?${qs}` : ''}`;
}

/**
 * A budget line that could not be read, as its own screen. Only a 404 is "not found"
 * (the English refusal stays hidden). Any other failure says what went wrong and offers
 * to read the line again. Both link back to the list.
 */
export default function BudgetLineUnavailable({
  error,
  onRetry,
  listPath,
}: {
  error: unknown;
  onRetry: () => void;
  listPath: string;
}) {
  const { t } = useTranslation(['ops', 'common', 'errors']);
  const notFound = httpStatus(error) === 404;
  return (
    <Box sx={{ p: 2 }}>
      {notFound ? (
        <Alert severity="error">{t('budget.notFound')}</Alert>
      ) : (
        <Alert
          severity="error"
          action={<Button color="inherit" size="small" onClick={onRetry}>{t('common:buttons.retry')}</Button>}
        >
          {getApiErrorMessage(error, t, t('opex.workspace.failedToLoad'))}
        </Alert>
      )}
      <MuiLink
        component={RouterLink}
        to={listPath}
        sx={{ display: 'inline-block', mt: 2, fontSize: 13, fontWeight: 400, color: 'kanap.teal' }}
      >
        {t('budget.backToList')}
      </MuiLink>
    </Box>
  );
}
