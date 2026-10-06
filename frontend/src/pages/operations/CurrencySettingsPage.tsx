import React from 'react';
import { Alert, Box, Button, Stack, TextField, Typography, Paper } from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import PageHeader from '../../components/PageHeader';
import { useTranslation } from 'react-i18next';
import useCurrencySettings from '../../hooks/useCurrencySettings';
import { updateCurrencySettings, CurrencySettings, refreshCurrencyRates } from '../../services/currency';
import useCurrencyRates, { CurrencyRateRow } from '../../hooks/useCurrencyRates';
import { useAuth } from '../../auth/AuthContext';
import { PropertyRow } from '../../components/design/PropertyRow';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';

function normalizeList(value: string): string[] | null {
  if (!value) return null;
  const parts = value
    .split(',')
    .map((code) => code.trim().toUpperCase())
    .filter((code) => code.length === 3);
  return parts.length ? Array.from(new Set(parts)) : null;
}

export default function CurrencySettingsPage() {
  const { t } = useTranslation(['ops', 'common']);
  const queryClient = useQueryClient();
  const { hasLevel } = useAuth();
  const canEdit = hasLevel('budget_ops', 'admin');
  const { data, isLoading, isError } = useCurrencySettings();
  const { data: rateRows, isLoading: ratesLoading, isError: ratesError } = useCurrencyRates();
  const [reportingCurrency, setReportingCurrency] = React.useState('EUR');
  const [defaultSpendCurrency, setDefaultSpendCurrency] = React.useState('EUR');
  const [defaultCapexCurrency, setDefaultCapexCurrency] = React.useState('EUR');
  const [allowedCurrencies, setAllowedCurrencies] = React.useState('');
  const [successMessage, setSuccessMessage] = React.useState('');

  React.useEffect(() => {
    if (data) {
      setReportingCurrency(data.reportingCurrency);
      setDefaultSpendCurrency(data.defaultSpendCurrency);
      setDefaultCapexCurrency(data.defaultCapexCurrency);
      setAllowedCurrencies((data.allowedCurrencies ?? []).join(', '));
    }
  }, [data]);

  const mutation = useMutation({
    mutationFn: updateCurrencySettings,
    onSuccess: (next: CurrencySettings) => {
      queryClient.invalidateQueries({ queryKey: ['currency-settings'] });
      queryClient.invalidateQueries({ queryKey: ['currency-rates'] });
      setSuccessMessage(t('operations.currency.saveSuccess'));
      setReportingCurrency(next.reportingCurrency);
      setDefaultSpendCurrency(next.defaultSpendCurrency);
      setDefaultCapexCurrency(next.defaultCapexCurrency);
      setAllowedCurrencies((next.allowedCurrencies ?? []).join(', '));
    },
  });

  const syncMutation = useMutation({
    mutationFn: () => refreshCurrencyRates(),
    onSuccess: (result) => {
      if (result.alreadyQueued && !result.queued) {
        setSuccessMessage(t('operations.currency.fxSyncRunning'));
      } else {
        setSuccessMessage(t('operations.currency.fxSyncStarted', { years: result.years.join(', ') }));
      }
      queryClient.invalidateQueries({ queryKey: ['currency-rates'] });
      if (!result.alreadyQueued) {
        window.setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ['currency-rates'] });
        }, 5000);
      }
    },
  });

  const submitting = mutation.isPending;
  const errorMessage = mutation.error ? getApiErrorMessage(mutation.error, t, t('operations.currency.failedToUpdate')) : null;
  const syncError = syncMutation.error ? getApiErrorMessage(syncMutation.error, t, t('operations.currency.failedToRefreshFx')) : null;

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canEdit) return;
    setSuccessMessage('');
    mutation.mutate({
      reportingCurrency: reportingCurrency.trim().toUpperCase(),
      defaultSpendCurrency: defaultSpendCurrency.trim().toUpperCase(),
      defaultCapexCurrency: defaultCapexCurrency.trim().toUpperCase(),
      allowedCurrencies: normalizeList(allowedCurrencies),
    });
  };

  const fieldDisabled = isLoading || submitting;
  const C = 'operations.currency';

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <PageHeader title={t(`${C}.title`)} breadcrumbTitle={t(`${C}.title`)} />
      <Typography variant="body1" sx={{ color: 'text.secondary', maxWidth: 720 }}>
        {t(`${C}.subtitle`)}
      </Typography>
      {!canEdit && <Alert severity="info" sx={{ maxWidth: 720 }}>{t('operations.budgetAdminOnly')}</Alert>}
      {isError && <Alert severity="error">{t(`${C}.loadError`)}</Alert>}
      {successMessage && <Alert severity="success">{successMessage}</Alert>}
      {syncMutation.isPending && <Alert severity="info">{t(`${C}.refreshingFx`)}</Alert>}
      {errorMessage && <Alert severity="error">{errorMessage}</Alert>}
      {syncError && <Alert severity="error">{syncError}</Alert>}
      <Paper variant="outlined" component="form" onSubmit={handleSubmit} noValidate sx={{ p: 2, maxWidth: 640 }}>
        <Stack spacing={1}>
          <PropertyRow label={t(`${C}.reportingCurrency`)} helperText={t(`${C}.reportingCurrencyHelp`)} required>
            <TextField
              variant="standard"
              value={reportingCurrency}
              onChange={(e) => setReportingCurrency(e.target.value)}
              inputProps={{ maxLength: 3, 'aria-label': t(`${C}.reportingCurrency`) }}
              required
              disabled={fieldDisabled}
              InputProps={{ readOnly: !canEdit }}
              placeholder="EUR"
              sx={{ width: 120 }}
            />
          </PropertyRow>
          <PropertyRow label={t(`${C}.defaultOpexCurrency`)} helperText={t(`${C}.defaultOpexCurrencyHelp`)} required>
            <TextField
              variant="standard"
              value={defaultSpendCurrency}
              onChange={(e) => setDefaultSpendCurrency(e.target.value)}
              inputProps={{ maxLength: 3, 'aria-label': t(`${C}.defaultOpexCurrency`) }}
              required
              disabled={fieldDisabled}
              InputProps={{ readOnly: !canEdit }}
              placeholder="EUR"
              sx={{ width: 120 }}
            />
          </PropertyRow>
          <PropertyRow label={t(`${C}.defaultCapexCurrency`)} helperText={t(`${C}.defaultCapexCurrencyHelp`)} required>
            <TextField
              variant="standard"
              value={defaultCapexCurrency}
              onChange={(e) => setDefaultCapexCurrency(e.target.value)}
              inputProps={{ maxLength: 3, 'aria-label': t(`${C}.defaultCapexCurrency`) }}
              required
              disabled={fieldDisabled}
              InputProps={{ readOnly: !canEdit }}
              placeholder="EUR"
              sx={{ width: 120 }}
            />
          </PropertyRow>
          <PropertyRow label={t(`${C}.allowedCurrencies`)} helperText={t(`${C}.allowedCurrenciesHelp`)}>
            <TextField
              variant="standard"
              value={allowedCurrencies}
              onChange={(e) => setAllowedCurrencies(e.target.value)}
              inputProps={{ 'aria-label': t(`${C}.allowedCurrencies`) }}
              disabled={fieldDisabled}
              InputProps={{ readOnly: !canEdit }}
              placeholder="EUR, USD, GBP"
              fullWidth
            />
          </PropertyRow>
        </Stack>
        {canEdit && (
          <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
            <Button type="submit" variant="contained" disabled={isLoading || submitting || syncMutation.isPending}>
              {t('common:buttons.save')}
            </Button>
            <Button
              variant="action"
              disabled={isLoading || submitting || syncMutation.isPending}
              onClick={() => {
                if (!data) return;
                setReportingCurrency(data.reportingCurrency);
                setDefaultSpendCurrency(data.defaultSpendCurrency);
                setDefaultCapexCurrency(data.defaultCapexCurrency);
                setAllowedCurrencies((data.allowedCurrencies ?? []).join(', '));
                setSuccessMessage('');
              }}
            >
              {t('common:buttons.reset')}
            </Button>
            <Button
              variant="action"
              disabled={isLoading || syncMutation.isPending}
              onClick={() => {
                setSuccessMessage('');
                syncMutation.reset();
                syncMutation.mutate();
              }}
            >
              {t(`${C}.forceFxSync`)}
            </Button>
          </Stack>
        )}
      </Paper>
      <CurrencyRatesTable rows={rateRows} loading={ratesLoading} error={ratesError} canSync={canEdit} />
    </Box>
  );
}

type RatesTableProps = {
  rows: CurrencyRateRow[] | undefined;
  loading: boolean;
  error: boolean;
  /** The empty state points at the sync action only for those who can run it. */
  canSync: boolean;
};

const SOURCE_LABEL_KEYS: Record<string, string> = {
  'exchangerateapi-spot': 'liveSpot',
  'world-bank-quarterly': 'quarterlyAvg',
  'world-bank-forward': 'forwardEstimate',
};

const headSx = { fontSize: 12, fontWeight: 500, color: 'kanap.text.tertiary', px: 1, py: 0.75, whiteSpace: 'nowrap', verticalAlign: 'bottom' } as const;
const cellSx = { px: 1, py: 0.75, fontSize: 13, color: 'kanap.text.primary', fontVariantNumeric: 'tabular-nums' } as const;

function CurrencyRatesTable({ rows, loading, error, canSync }: RatesTableProps) {
  const { t } = useTranslation(['ops']);
  const C = 'operations.currency';
  if (loading) {
    return <Alert severity="info">{t(`${C}.loadingRates`)}</Alert>;
  }
  if (error) {
    return <Alert severity="error">{t(`${C}.loadRatesError`)}</Alert>;
  }
  if (!rows || rows.length === 0) {
    return (
      <Alert severity="warning">
        {canSync ? `${t(`${C}.noRatesYet`)} ${t(`${C}.noRatesHint`)}` : t(`${C}.noRatesYet`)}
      </Alert>
    );
  }

  const years = Array.from(new Set(rows.map((r) => r.fiscalYear))).sort((a, b) => a - b);
  const currencySet = new Set<string>();
  rows.forEach((row) => Object.keys(row.rates || {}).forEach((code) => currencySet.add(code.toUpperCase())));
  const currencies = Array.from(currencySet).sort();

  const matrix = currencies.map((code) => {
    const entries: Record<number, number | null> = {};
    years.forEach((year) => {
      const ref = rows.find((r) => r.fiscalYear === year);
      const value = ref?.rates?.[code];
      entries[year] = value != null ? value : null;
    });
    return { code, entries };
  });

  return (
    <Paper variant="outlined" sx={{ p: 2, maxWidth: '100%' }}>
      <Typography component="h2" sx={{ fontSize: 14, fontWeight: 500, color: 'kanap.text.primary', mb: 1 }}>
        {t(`${C}.fxRatesTitle`)}
      </Typography>
      <Box sx={{ overflowX: 'auto' }}>
        <Box
          component="table"
          sx={{
            borderCollapse: 'collapse',
            '& th': { borderBottom: '1px solid', borderColor: 'kanap.border.default' },
            '& tbody td': { borderBottom: '1px solid', borderColor: 'kanap.border.soft' },
          }}
        >
          <Box component="thead">
            <Box component="tr">
              <Box component="th" sx={{ ...headSx, textAlign: 'left' }}>{t(`${C}.currencyCol`)}</Box>
              {years.map((year) => {
                const source = rows.find((r) => r.fiscalYear === year)?.source ?? 'world-bank';
                const sourceLabel = t(`${C}.${SOURCE_LABEL_KEYS[source] ?? 'annualAvg'}`);
                return (
                  <Box component="th" key={year} sx={{ ...headSx, textAlign: 'right' }}>
                    <Box sx={{ color: 'kanap.text.secondary', fontVariantNumeric: 'tabular-nums' }}>{year}</Box>
                    <Box sx={{ fontSize: 11, fontWeight: 400 }}>{sourceLabel}</Box>
                  </Box>
                );
              })}
            </Box>
          </Box>
          <Box component="tbody">
            {matrix.map((row) => (
              <Box component="tr" key={row.code}>
                <Box component="td" sx={{ ...cellSx, fontFamily: 'monospace', color: 'kanap.text.secondary' }}>{row.code}</Box>
                {years.map((year) => {
                  const value = row.entries[year];
                  const display = value != null ? value.toFixed(6) : '—';
                  return (
                    <Box component="td" key={year} sx={{ ...cellSx, textAlign: 'right' }}>
                      {display}
                    </Box>
                  );
                })}
              </Box>
            ))}
          </Box>
        </Box>
      </Box>
    </Paper>
  );
}
