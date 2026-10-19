import React from 'react';
import { Alert, Box, Button, Paper, Stack, TextField, Tooltip, Typography } from '@mui/material';
import type { Theme } from '@mui/material/styles';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import PageHeader from '../../components/PageHeader';
import { useTranslation } from 'react-i18next';
import useCurrencySettings from '../../hooks/useCurrencySettings';
import {
  updateCurrencySettings,
  CurrencySettings,
  refreshCurrencyRates,
  type CurrencyRateRow,
  type MissingRatePair,
  type RemoveManualRateResult,
} from '../../services/currency';
import useCurrencyRates, {
  invalidateCurrencyRateQueries,
  useMissingRates,
  useRemoveManualRate,
  useSetManualRate,
} from '../../hooks/useCurrencyRates';
import { useAuth } from '../../auth/AuthContext';
import KanapDialog from '../../components/design/KanapDialog';
import { PropertyRow } from '../../components/design/PropertyRow';
import FormattedNumberField from '../../components/inputs/FormattedNumberField';
import { decimalMark } from '../../i18n/formatters';
import { useLocale } from '../../i18n/useLocale';
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
  const { data: missingPairs, isLoading: missingLoading, isError: missingError } = useMissingRates();
  const [manualTarget, setManualTarget] = React.useState<{ currency: string; year: number } | null>(null);
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
      invalidateCurrencyRateQueries(queryClient);
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
      invalidateCurrencyRateQueries(queryClient);
      if (!result.alreadyQueued) {
        window.setTimeout(() => {
          invalidateCurrencyRateQueries(queryClient);
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
  const reporting = (data?.reportingCurrency || rateRows?.[0]?.baseCurrency || '').trim().toUpperCase();
  const C = 'operations.currency';

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <PageHeader title={t(`${C}.title`)} />
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
      <CurrencyRatesTable
        rows={rateRows}
        missing={missingPairs}
        loading={ratesLoading}
        missingLoading={missingLoading}
        error={ratesError}
        missingError={missingError}
        canEdit={canEdit}
        reportingCurrency={reporting}
        onEdit={setManualTarget}
      />
      {manualTarget && (
        <ManualRateDialog
          key={pairKey(manualTarget.currency, manualTarget.year)}
          currency={manualTarget.currency}
          year={manualTarget.year}
          reportingCurrency={reporting}
          rows={rateRows}
          onClose={() => setManualTarget(null)}
          onRemoved={(result) => {
            setSuccessMessage(t(`${C}.manualRateRemoved`));
            // The automatic rate comes back from a background fetch: look again once it has had time.
            if (result.refreshQueued) {
              window.setTimeout(() => invalidateCurrencyRateQueries(queryClient), 5000);
            }
          }}
        />
      )}
    </Box>
  );
}

type ManualRateDialogProps = {
  currency: string;
  year: number;
  reportingCurrency: string;
  rows: CurrencyRateRow[] | undefined;
  onClose: () => void;
  onRemoved: (result: RemoveManualRateResult) => void;
};

/** Enters, changes or removes the manual rate of one currency and year. */
function ManualRateDialog({ currency, year, reportingCurrency, rows, onClose, onRemoved }: ManualRateDialogProps) {
  const { t } = useTranslation(['ops', 'common']);
  const C = 'operations.currency';
  // The application language decides the decimal mark; a typed comma or point is read either way.
  const separator = decimalMark(useLocale());
  const set = rows?.find((row) => row.fiscalYear === year);
  const current = set?.rates?.[currency];
  const isManual = set?.rateSources?.[currency] === 'manual';
  // Rates are stored with 6 decimals, as the matrix shows them.
  const [draft, setDraft] = React.useState(current != null ? String(Number(current.toFixed(6))) : '');
  const [invalid, setInvalid] = React.useState(false);
  const save = useSetManualRate();
  const remove = useRemoveManualRate();
  const busy = save.isPending || remove.isPending;
  const apiError = save.error
    ? getApiErrorMessage(save.error, t, t(`${C}.failedToSaveManualRate`))
    : remove.error
      ? getApiErrorMessage(remove.error, t, t(`${C}.failedToRemoveManualRate`))
      : null;

  const handleSave = async () => {
    const rate = Number(draft);
    if (draft === '' || !Number.isFinite(rate) || rate <= 0) {
      setInvalid(true);
      return;
    }
    remove.reset();
    try {
      await save.mutateAsync({ currency, year, rate });
      onClose();
    } catch {
      // Shown in the dialog.
    }
  };

  const handleRemove = async () => {
    save.reset();
    try {
      const result = await remove.mutateAsync({ year, currency });
      onRemoved(result);
      onClose();
    } catch {
      // Shown in the dialog.
    }
  };

  return (
    <KanapDialog
      open
      title={t(`${C}.manualDialogTitle`)}
      subtitle={`${currency} · ${year}`}
      onClose={onClose}
      onSave={handleSave}
      saveDisabled={remove.isPending}
      saveLoading={save.isPending}
      footerLeft={isManual ? (
        <Button variant="action" onClick={handleRemove} disabled={busy}>
          {t(`${C}.removeManualRate`)}
        </Button>
      ) : undefined}
    >
      <Stack spacing={1.5}>
        {apiError && <Alert severity="error">{apiError}</Alert>}
        <PropertyRow
          label={t(`${C}.manualRateLabel`, { reporting: reportingCurrency, currency })}
          helperText={t(`${C}.manualRateHint`)}
          required
          valueSx={{ maxWidth: 200 }}
        >
          <FormattedNumberField
            variant="standard"
            value={draft}
            emit="string"
            decimals={6}
            decimalSeparator={separator}
            error={invalid}
            placeholder={t(`${C}.manualRatePlaceholder`)}
            inputProps={{ 'aria-label': t(`${C}.manualRateLabel`, { reporting: reportingCurrency, currency }) }}
            onChange={(event) => {
              setDraft(String(event.target.value ?? ''));
              setInvalid(false);
            }}
            fullWidth
          />
        </PropertyRow>
        {invalid && (
          <Typography role="alert" sx={{ fontSize: 12, color: 'error.main' }}>
            {t(`${C}.manualRateInvalid`)}
          </Typography>
        )}
        <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>
          {t(`${C}.manualRateReplaces`)}
        </Typography>
      </Stack>
    </KanapDialog>
  );
}

type RatesTableProps = {
  rows: CurrencyRateRow[] | undefined;
  missing: MissingRatePair[] | undefined;
  loading: boolean;
  missingLoading: boolean;
  error: boolean;
  missingError: boolean;
  /** Editors get the sync hint, the "Enter a rate" actions and editable cells. */
  canEdit: boolean;
  reportingCurrency: string;
  onEdit: (pair: MissingRatePair) => void;
};

const SOURCE_LABEL_KEYS: Record<string, string> = {
  'exchangerateapi-spot': 'liveSpot',
  'world-bank-quarterly': 'quarterlyAvg',
  'world-bank-forward': 'forwardEstimate',
};

const headSx = { fontSize: 12, fontWeight: 500, color: 'kanap.text.tertiary', px: 1, py: 0.75, whiteSpace: 'nowrap', verticalAlign: 'bottom' } as const;
const cellSx = { px: 1, py: 0.75, fontSize: 13, color: 'kanap.text.primary', fontVariantNumeric: 'tabular-nums' } as const;
const markSx = { ml: 0.75, fontSize: 11, color: 'kanap.text.tertiary', fontVariantNumeric: 'normal' } as const;
const editableCellSx = {
  display: 'inline-block',
  mx: -0.5,
  px: 0.5,
  borderRadius: '4px',
  cursor: 'pointer',
  outline: 'none',
  '&:hover': { bgcolor: 'kanap.bg.hover' },
  '&:focus-visible': { boxShadow: (theme: Theme) => `0 0 0 2px ${theme.palette.primary.main}` },
} as const;

const pairKey = (currency: string, year: number) => `${currency}:${year}`;

/** One cell of the matrix: the rate, a small mark for a manual or estimated one, an orange dash when it is missing. */
function RateValue({ value, source, missing }: { value: number | null; source: string | undefined; missing: boolean }) {
  const { t } = useTranslation(['ops']);
  const C = 'operations.currency';
  if (value == null) {
    return (
      <Box component="span" sx={missing ? { color: 'warning.main' } : undefined}>
        —
      </Box>
    );
  }
  return (
    <>
      <Box component="span">{value.toFixed(6)}</Box>
      {source === 'manual' && <Box component="span" sx={markSx}>{t(`${C}.manualMark`)}</Box>}
      {source === 'estimate' && (
        <Tooltip title={t(`${C}.estimateTooltip`)}>
          <Box component="span" sx={markSx}>{t(`${C}.estimateMark`)}</Box>
        </Tooltip>
      )}
    </>
  );
}

function CurrencyRatesTable({
  rows,
  missing,
  loading,
  missingLoading,
  error,
  missingError,
  canEdit,
  reportingCurrency,
  onEdit,
}: RatesTableProps) {
  const { t } = useTranslation(['ops']);
  const C = 'operations.currency';
  if (loading) {
    return <Alert severity="info">{t(`${C}.loadingRates`)}</Alert>;
  }
  if (error) {
    return <Alert severity="error">{t(`${C}.loadRatesError`)}</Alert>;
  }
  const rateRows = rows ?? [];
  const missingPairs = missing ?? [];
  const noRates = rateRows.length === 0 ? (
    <Alert severity="warning">
      {canEdit ? `${t(`${C}.noRatesYet`)} ${t(`${C}.noRatesHint`)}` : t(`${C}.noRatesYet`)}
    </Alert>
  ) : null;
  if (rateRows.length === 0 && missingPairs.length === 0) return noRates;

  const years = Array.from(
    new Set([...rateRows.map((r) => r.fiscalYear), ...missingPairs.map((pair) => pair.year)]),
  ).sort((a, b) => a - b);
  const currencySet = new Set<string>();
  rateRows.forEach((row) => Object.keys(row.rates || {}).forEach((code) => currencySet.add(code.toUpperCase())));
  missingPairs.forEach((pair) => currencySet.add(pair.currency));
  const currencies = Array.from(currencySet).sort();
  const missingKeys = new Set(missingPairs.map((pair) => pairKey(pair.currency, pair.year)));
  const setByYear = new Map(rateRows.map((row) => [row.fiscalYear, row]));

  return (
    <>
      {noRates}
      <Paper variant="outlined" sx={{ p: 2, maxWidth: '100%' }}>
        <Typography component="h2" sx={{ fontSize: 14, fontWeight: 500, color: 'kanap.text.primary', mb: 1 }}>
          {t(`${C}.fxRatesTitle`)}
        </Typography>
        <MissingRates
          missing={missingPairs}
          loading={missingLoading}
          error={missingError}
          canEdit={canEdit}
          onEdit={onEdit}
        />
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
                  const set = setByYear.get(year);
                  const sourceLabel = set ? t(`${C}.${SOURCE_LABEL_KEYS[set.source] ?? 'annualAvg'}`) : '';
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
              {currencies.map((code) => (
                <Box component="tr" key={code}>
                  <Box component="td" sx={{ ...cellSx, fontFamily: 'monospace', color: 'kanap.text.secondary' }}>{code}</Box>
                  {years.map((year) => {
                    const set = setByYear.get(year);
                    const value = set?.rates?.[code];
                    const source = set?.rateSources?.[code];
                    // The reporting currency is 1 by definition: no manual rate for it.
                    const editable = canEdit && code !== reportingCurrency && source !== 'identity';
                    const content = (
                      <RateValue value={value ?? null} source={source} missing={missingKeys.has(pairKey(code, year))} />
                    );
                    return (
                      <Box component="td" key={year} sx={{ ...cellSx, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {editable ? (
                          <Box
                            role="button"
                            tabIndex={0}
                            aria-label={t(`${C}.editRate`, { currency: code, year })}
                            onClick={() => onEdit({ currency: code, year })}
                            onKeyDown={(event: React.KeyboardEvent<HTMLElement>) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                onEdit({ currency: code, year });
                              }
                            }}
                            sx={editableCellSx}
                          >
                            {content}
                          </Box>
                        ) : content}
                      </Box>
                    );
                  })}
                </Box>
              ))}
            </Box>
          </Box>
        </Box>
      </Paper>
    </>
  );
}

type MissingRatesProps = {
  missing: MissingRatePair[];
  loading: boolean;
  error: boolean;
  canEdit: boolean;
  onEdit: (pair: MissingRatePair) => void;
};

/** The pairs in use with no rate, one dense line each, above the matrix. */
function MissingRates({ missing, loading, error, canEdit, onEdit }: MissingRatesProps) {
  const { t } = useTranslation(['ops']);
  const C = 'operations.currency';
  if (loading) return null;
  if (error) {
    return <Alert severity="error" sx={{ mb: 1.5 }}>{t(`${C}.loadMissingError`)}</Alert>;
  }
  if (missing.length === 0) {
    return (
      <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary', mb: 1.5 }}>
        {t(`${C}.missingNone`)}
      </Typography>
    );
  }
  return (
    <Box sx={{ mb: 2 }}>
      <Typography component="h3" sx={{ fontSize: 13, fontWeight: 500, color: 'kanap.text.primary', mb: 0.5 }}>
        {t(`${C}.missingTitle`, { count: missing.length })}
      </Typography>
      <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {missing.map((pair) => (
          <Box
            component="li"
            key={`${pair.currency}-${pair.year}`}
            sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minHeight: 32, fontSize: 13 }}
          >
            <Box
              component="span"
              sx={{ fontFamily: 'monospace', color: 'warning.main', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}
            >
              {`${pair.currency} · ${pair.year}`}
            </Box>
            <Box component="span" sx={{ flex: 1, minWidth: 0, color: 'kanap.text.secondary' }}>
              {t(`${C}.missingReason`)}
            </Box>
            {canEdit && (
              <Button
                variant="action"
                aria-label={t(`${C}.enterRateFor`, { currency: pair.currency, year: pair.year })}
                onClick={() => onEdit(pair)}
              >
                {t(`${C}.enterRate`)}
              </Button>
            )}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
