import React from 'react';
import { Alert, Box, Button, Stack, TextField, Typography, Paper, Table, TableBody, TableCell, TableHead, TableRow } from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import PageHeader from '../../components/PageHeader';
import { useTranslation } from 'react-i18next';
import useCurrencySettings from '../../hooks/useCurrencySettings';
import { updateCurrencySettings, CurrencySettings, refreshCurrencyRates } from '../../services/currency';
import useCurrencyRates, { CurrencyRateRow } from '../../hooks/useCurrencyRates';
import { useAuth } from '../../auth/AuthContext';

function normalizeList(value: string): string[] | null {
  if (!value) return null;
  const parts = value
    .split(',')
    .map((code) => code.trim().toUpperCase())
    .filter((code) => code.length === 3);
  return parts.length ? Array.from(new Set(parts)) : null;
}

export default function CurrencySettingsPage() {
  const { t } = useTranslation(['ops']);
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
        setSuccessMessage('FX rates sync is already running in the background.');
      } else {
        setSuccessMessage(`FX rates sync started for fiscal years ${result.years.join(', ')}. Rates will update shortly.`);
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
  const errorMessage = mutation.error instanceof Error ? mutation.error.message : mutation.error ? 'Failed to update settings' : null;
  const syncError = syncMutation.error instanceof Error ? syncMutation.error.message : syncMutation.error ? 'Failed to refresh FX rates' : null;

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

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <PageHeader title={t("operations.currency.title")} />
      <Typography variant="body1" color="text.secondary">
        {t('operations.currency.subtitle')}
      </Typography>
      {!canEdit && <Alert severity="info" sx={{ maxWidth: 720 }}>{t('operations.budgetAdminOnly')}</Alert>}
      {isError && <Alert severity="error">{t('operations.currency.loadError')}</Alert>}
      {successMessage && <Alert severity="success">{successMessage}</Alert>}
      {syncMutation.isPending && <Alert severity="info">Refreshing FX rates…</Alert>}
      {errorMessage && <Alert severity="error">{errorMessage}</Alert>}
      {syncError && <Alert severity="error">{syncError}</Alert>}
      <Box component="form" onSubmit={handleSubmit} noValidate>
        <Stack spacing={2} sx={{ maxWidth: 520 }}>
          <TextField
            label="Reporting Currency"
            value={reportingCurrency}
            onChange={(e) => setReportingCurrency(e.target.value)}
            inputProps={{ maxLength: 3 }}
            required
            disabled={isLoading || submitting}
            InputProps={{ readOnly: !canEdit }}
            helperText={t('operations.currency.reportingCurrencyHelp')}
          />
          <TextField
            label="Default OPEX Currency"
            value={defaultSpendCurrency}
            onChange={(e) => setDefaultSpendCurrency(e.target.value)}
            inputProps={{ maxLength: 3 }}
            required
            disabled={isLoading || submitting}
            InputProps={{ readOnly: !canEdit }}
            helperText={t('operations.currency.defaultOpexCurrencyHelp')}
          />
          <TextField
            label="Default CAPEX Currency"
            value={defaultCapexCurrency}
            onChange={(e) => setDefaultCapexCurrency(e.target.value)}
            inputProps={{ maxLength: 3 }}
            required
            disabled={isLoading || submitting}
            InputProps={{ readOnly: !canEdit }}
            helperText={t('operations.currency.defaultCapexCurrencyHelp')}
          />
          <TextField
            label="Allowed Currencies"
            value={allowedCurrencies}
            onChange={(e) => setAllowedCurrencies(e.target.value)}
            disabled={isLoading || submitting}
            InputProps={{ readOnly: !canEdit }}
            helperText={t('operations.currency.allowedCurrenciesHelp')}
          />
          {canEdit && (
            <Stack direction="row" spacing={1}>
              <Button type="submit" variant="contained" disabled={isLoading || submitting || syncMutation.isPending}>
                Save Changes
              </Button>
              <Button
                variant="outlined"
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
                Reset
              </Button>
              <Button
                variant="text"
                disabled={isLoading || syncMutation.isPending}
                onClick={() => {
                  setSuccessMessage('');
                  syncMutation.reset();
                  syncMutation.mutate();
                }}
              >
                Force FX rates sync
              </Button>
            </Stack>
          )}
        </Stack>
      </Box>
      <CurrencyRatesTable rows={rateRows} loading={ratesLoading} error={ratesError} />
    </Box>
  );
}

type RatesTableProps = {
  rows: CurrencyRateRow[] | undefined;
  loading: boolean;
  error: boolean;
};

function CurrencyRatesTable({ rows, loading, error }: RatesTableProps) {
  if (loading) {
    return <Alert severity="info">Loading FX rates…</Alert>;
  }
  if (error) {
    return <Alert severity="error">Failed to load FX rate history.</Alert>;
  }
  if (!rows || rows.length === 0) {
    return <Alert severity="warning">No FX rate snapshots captured yet. Run “Force FX rates sync” to create one.</Alert>;
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
    <Paper variant="outlined" sx={{ p: 2, maxWidth: '100%', overflowX: 'auto' }}>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        Latest FX Rate Snapshots (per fiscal year, tenant reporting currency basis)
      </Typography>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell sx={{ fontWeight: 600 }}>Currency</TableCell>
            {years.map((year) => {
              const source = rows.find((r) => r.fiscalYear === year)?.source ?? 'world-bank';
              const sourceLabel =
                source === 'exchangerateapi-spot'
                  ? 'Live spot'
                  : source === 'world-bank-quarterly'
                    ? 'Quarterly avg'
                    : source === 'world-bank-forward'
                      ? 'Forward estimate'
                      : 'Annual avg';
              return (
                <TableCell key={year} align="right" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                  <Stack spacing={0.5} alignItems="flex-end">
                    <span>{year}</span>
                    <Typography variant="caption" color="text.secondary">
                      {sourceLabel}
                    </Typography>
                  </Stack>
                </TableCell>
              );
            })}
          </TableRow>
        </TableHead>
        <TableBody>
          {matrix.map((row) => (
            <TableRow key={row.code}>
              <TableCell sx={{ fontFamily: 'monospace' }}>{row.code}</TableCell>
              {years.map((year) => {
                const value = row.entries[year];
                const display = value != null ? value.toFixed(6) : '—';
                return (
                  <TableCell key={year} align="right">
                    {display}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Paper>
  );
}
