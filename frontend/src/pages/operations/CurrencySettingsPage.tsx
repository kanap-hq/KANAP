import React from 'react';
import { Alert, Box, Button, CircularProgress, Paper, Stack, TextField, Tooltip, Typography } from '@mui/material';
import type { Theme } from '@mui/material/styles';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import { useTranslation } from 'react-i18next';
import useCurrencySettings from '../../hooks/useCurrencySettings';
import {
  updateCurrencySettings,
  refreshCurrencyRates,
  fetchReportingChangeImpact,
  type CurrencyRateRow,
  type CurrencySettings,
  type CurrencySettingsUpdate,
  type MissingRatePair,
  type ReportingChangeImpact,
} from '../../services/currency';
import useCurrencyRates, {
  invalidateCurrencyRateQueries,
  useMissingRates,
  useRateSyncFollowUp,
  useRemoveManualRate,
  useSetManualRate,
} from '../../hooks/useCurrencyRates';
import { useAuth } from '../../auth/AuthContext';
import KanapDialog from '../../components/design/KanapDialog';
import { PropertyRow } from '../../components/design/PropertyRow';
import { formatDecimal } from '../../i18n/formatters';
import { useLocale } from '../../i18n/useLocale';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';

/** Up to 6 decimals, trailing zeros trimmed, in the separators of the language. */
function formatRate(value: number, locale: string): string {
  return formatDecimal(value, locale, 6);
}

/**
 * A typed rate. A comma or a point is the decimal mark; spaces and the other mark, when both
 * appear, are grouping. `null` is empty, `NaN` is not a number.
 */
export function parseRateDraft(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const compact = trimmed.replace(/[\s\u00a0\u202f\u2009]/g, '');
  const lastComma = compact.lastIndexOf(',');
  const lastPoint = compact.lastIndexOf('.');
  let normalized = compact;
  if (lastComma >= 0 && lastPoint >= 0) {
    const decimalIsComma = lastComma > lastPoint;
    normalized = decimalIsComma ? compact.replace(/\./g, '').replace(',', '.') : compact.replace(/,/g, '');
  } else if (lastComma >= 0) {
    normalized = compact.replace(',', '.');
  }
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return Number.NaN;
  return Number(normalized);
}

const MANUAL_RATE_MAX = 1_000_000_000;
const DEEP_LINK_HIGHLIGHT_MS = 4_000;

const highlightSx = {
  bgcolor: 'kanap.bg.hover',
  boxShadow: (theme: Theme) => `inset 0 0 0 2px ${theme.palette.primary.main}`,
  borderRadius: '4px',
} as const;

export type ManualRateProblem = 'empty' | 'nan' | 'nonPositive' | 'tooLarge' | 'tooSmall';

/** Why a typed rate cannot be stored. `null` when it can. */
export function manualRateProblem(raw: string): ManualRateProblem | null {
  if (raw.trim() === '') return 'empty';
  const rate = parseRateDraft(raw);
  if (rate == null || Number.isNaN(rate) || !Number.isFinite(rate)) return 'nan';
  if (rate <= 0) return 'nonPositive';
  if (rate > MANUAL_RATE_MAX) return 'tooLarge';
  if (Number(rate.toFixed(6)) === 0) return 'tooSmall';
  return null;
}

/** The nearest published automatic rate of the same currency, one year before or after. */
function neighbouringAutomaticRate(
  rows: CurrencyRateRow[] | undefined,
  currency: string,
  year: number,
): { year: number; rate: number } | null {
  let best: { year: number; rate: number } | null = null;
  for (const row of rows ?? []) {
    if (Math.abs(row.fiscalYear - year) !== 1) continue;
    const source = row.rateSources?.[currency];
    const value = row.rates?.[currency];
    if (!source || source === 'manual' || source === 'identity') continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue;
    // Both neighbours: the earlier year is the one already on the books.
    if (!best || row.fiscalYear < best.year) best = { year: row.fiscalYear, rate: value };
  }
  return best;
}

const MANUAL_RATE_ERROR_KEYS = {
  currency_invalid: 'operations.currency.errors.currency_invalid',
  currency_reporting: 'operations.currency.errors.currency_reporting',
  year_out_of_range: 'operations.currency.errors.year_out_of_range',
  rate_out_of_range: 'operations.currency.errors.rate_out_of_range',
  rate_too_small: 'operations.currency.errors.rate_too_small',
  manual_rate_not_found: 'operations.currency.errors.manual_rate_not_found',
} as const;

function apiErrorCode(error: unknown): string {
  const code = (error as { response?: { data?: { code?: unknown } } } | null)?.response?.data?.code;
  return typeof code === 'string' ? code : '';
}

type SyncNotice =
  | { completed: true; failed: boolean; fetched: number; stillMissing: MissingRatePair[] }
  | { completed: false };

/**
 * The sync result sits in a reserved slot, so the matrix does not jump when the alert appears.
 * Editors always have the slot; readers have no sync button and no gap.
 */
function SyncResult({ notice }: { notice: SyncNotice | null }) {
  const { t } = useTranslation(['ops']);
  const C = 'operations.currency';
  const pairs = notice?.completed
    ? notice.stillMissing.map((pair) => `${pair.currency} ${pair.year}`).join(', ')
    : '';
  return (
    <Box data-testid="sync-result" aria-live="polite" sx={{ minHeight: 96 }}>
      {notice?.completed === true && notice.failed && (
        <Alert severity="warning">
          <Box>{t(`${C}.syncSourceUnreachable`)}</Box>
          {notice.stillMissing.length > 0 && <Box>{t(`${C}.syncStillMissing`, { pairs })}</Box>}
        </Alert>
      )}
      {notice?.completed === true && !notice.failed && (
        <Alert severity="success">
          <Box>{t(`${C}.syncFetched`, { count: notice.fetched })}</Box>
          <Box>
            {notice.stillMissing.length > 0
              ? t(`${C}.syncStillMissing`, { pairs })
              : t(`${C}.missingNone`)}
          </Box>
        </Alert>
      )}
      {notice?.completed === false && <Alert severity="info">{t(`${C}.syncContinues`)}</Alert>}
    </Box>
  );
}

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
  const { data: rateMatrix, isLoading: ratesLoading, isError: ratesError } = useCurrencyRates();
  const rateRows = rateMatrix?.rates;
  const { data: missingPairs, isLoading: missingLoading, isError: missingError } = useMissingRates();
  const [manualTarget, setManualTarget] = React.useState<{ currency: string; year: number } | null>(null);
  const [reportingCurrency, setReportingCurrency] = React.useState('EUR');
  const [defaultSpendCurrency, setDefaultSpendCurrency] = React.useState('EUR');
  const [defaultCapexCurrency, setDefaultCapexCurrency] = React.useState('EUR');
  const [allowedCurrencies, setAllowedCurrencies] = React.useState('');
  const [successMessage, setSuccessMessage] = React.useState('');
  const [frozenNotice, setFrozenNotice] = React.useState('');
  const [syncNotice, setSyncNotice] = React.useState<SyncNotice | null>(null);
  const [impactPending, setImpactPending] = React.useState(false);
  const [impactError, setImpactError] = React.useState('');
  const [reportingChange, setReportingChange] = React.useState<{
    to: string;
    previous: string;
    payload: Partial<CurrencySettings>;
    impact: ReportingChangeImpact;
  } | null>(null);
  const [highlightKey, setHighlightKey] = React.useState<string | null>(null);
  const followRateSync = useRateSyncFollowUp();
  const [searchParams, setSearchParams] = useSearchParams();
  const handledDeepLink = React.useRef(false);

  React.useEffect(() => {
    if (data) {
      setReportingCurrency(data.reportingCurrency);
      setDefaultSpendCurrency(data.defaultSpendCurrency);
      setDefaultCapexCurrency(data.defaultCapexCurrency);
      setAllowedCurrencies((data.allowedCurrencies ?? []).join(', '));
    }
  }, [data]);

  // `?currency=ZAR&year=2028` opens the manual dialog when that pair has no rate and the user
  // can edit. Otherwise the missing row, or the matrix cell, stays highlighted for a few seconds.
  React.useEffect(() => {
    if (handledDeepLink.current) return;
    if (isLoading || ratesLoading || missingLoading) return;
    const currency = (searchParams.get('currency') ?? '').trim().toUpperCase();
    const yearRaw = searchParams.get('year');
    const year = Number(yearRaw);
    if (!/^[A-Z]{3}$/.test(currency) || yearRaw == null || !Number.isInteger(year)) return;
    handledDeepLink.current = true;

    const next = new URLSearchParams(searchParams);
    next.delete('currency');
    next.delete('year');
    setSearchParams(next, { replace: true });

    const listed = (missingPairs ?? []).some((pair) => pair.currency === currency && pair.year === year);
    const set = rateRows?.find((row) => row.fiscalYear === year);
    const value = set?.rates?.[currency];
    const hasRate = typeof value === 'number' && Number.isFinite(value) && value > 0;
    if ((listed || !hasRate) && canEdit) {
      setManualTarget({ currency, year });
      return;
    }
    const currencies = (rateMatrix?.currencies ?? []).map((code) => code.trim().toUpperCase());
    if (listed) setHighlightKey(`missing:${currency}:${year}`);
    else if (currencies.includes(currency) && set) setHighlightKey(`cell:${currency}:${year}`);
    else setHighlightKey('missing-section');
    const targetId = listed
      ? `currency-missing-${currency}-${year}`
      : currencies.includes(currency) && set
        ? `currency-cell-${currency}-${year}`
        : 'currency-missing';
    window.requestAnimationFrame(() => {
      document.getElementById(targetId)?.scrollIntoView?.({ block: 'center' });
    });
  }, [canEdit, isLoading, missingLoading, missingPairs, rateMatrix?.currencies, rateRows, ratesLoading, searchParams, setSearchParams]);

  React.useEffect(() => {
    if (!highlightKey) return;
    const timer = window.setTimeout(() => setHighlightKey(null), DEEP_LINK_HIGHLIGHT_MS);
    return () => window.clearTimeout(timer);
  }, [highlightKey]);

  const syncMutation = useMutation({
    mutationFn: (years?: number[]) => refreshCurrencyRates(years?.length ? { years } : {}),
    onSuccess: (result) => {
      setSyncNotice(result.completed
        ? { completed: true, failed: result.failed === true, fetched: result.fetched, stillMissing: result.stillMissing ?? [] }
        : { completed: false });
      followRateSync(result.completed);
    },
  });

  const mutation = useMutation({
    mutationFn: updateCurrencySettings,
    onSuccess: (next: CurrencySettingsUpdate) => {
      queryClient.invalidateQueries({ queryKey: ['currency-settings'] });
      setReportingChange(null);
      setReportingCurrency(next.reportingCurrency);
      setDefaultSpendCurrency(next.defaultSpendCurrency);
      setDefaultCapexCurrency(next.defaultCapexCurrency);
      setAllowedCurrencies((next.allowedCurrencies ?? []).join(', '));
      const years = Array.isArray(next.refreshYears) ? next.refreshYears.filter((year) => Number.isInteger(year)) : [];
      if (years.length > 0) {
        setSuccessMessage('');
        setSyncNotice(null);
        syncMutation.mutate(years);
        return;
      }
      invalidateCurrencyRateQueries(queryClient);
      setSuccessMessage(t('operations.currency.saveSuccess'));
    },
  });

  const submitting = mutation.isPending;
  const saving = submitting || impactPending;
  const errorMessage = impactError
    || (mutation.error ? getApiErrorMessage(mutation.error, t, t('operations.currency.failedToUpdate')) : '');
  const syncError = syncMutation.error ? getApiErrorMessage(syncMutation.error, t, t('operations.currency.failedToRefreshFx')) : null;

  const settingsPayload = (): Partial<CurrencySettings> => ({
    reportingCurrency: reportingCurrency.trim().toUpperCase(),
    defaultSpendCurrency: defaultSpendCurrency.trim().toUpperCase(),
    defaultCapexCurrency: defaultCapexCurrency.trim().toUpperCase(),
    allowedCurrencies: normalizeList(allowedCurrencies),
  });

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canEdit || saving) return;
    setSuccessMessage('');
    setImpactError('');
    const payload = settingsPayload();
    const nextReporting = payload.reportingCurrency ?? '';
    const currentReporting = (data?.reportingCurrency ?? '').trim().toUpperCase();
    if (data && nextReporting !== currentReporting && /^[A-Z]{3}$/.test(nextReporting)) {
      setImpactPending(true);
      try {
        const impact = await fetchReportingChangeImpact(nextReporting);
        setReportingChange({ to: nextReporting, previous: currentReporting, payload, impact });
      } catch (error) {
        setImpactError(getApiErrorMessage(error, t, t('operations.currency.failedToUpdate')));
      } finally {
        setImpactPending(false);
      }
      return;
    }
    setSyncNotice(null);
    mutation.mutate(payload);
  };

  const fieldDisabled = isLoading || saving;
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
      {frozenNotice && <Alert severity="info">{frozenNotice}</Alert>}
      {errorMessage && !reportingChange && <Alert severity="error">{errorMessage}</Alert>}
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
            <Button
              type="submit"
              variant="contained"
              disabled={isLoading || saving || syncMutation.isPending || reportingChange != null}
              aria-busy={saving || undefined}
              startIcon={saving ? <CircularProgress size={14} color="inherit" /> : undefined}
            >
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
              aria-busy={syncMutation.isPending || undefined}
              startIcon={syncMutation.isPending ? <CircularProgress size={14} color="inherit" /> : undefined}
              onClick={() => {
                setSuccessMessage('');
                setSyncNotice(null);
                syncMutation.reset();
                syncMutation.mutate();
              }}
            >
              {t(`${C}.forceFxSync`)}
            </Button>
          </Stack>
        )}
      </Paper>
      {canEdit && <SyncResult notice={syncNotice} />}
      <CurrencyRatesTable
        currencies={rateMatrix?.currencies}
        rows={rateRows}
        missing={missingPairs}
        loading={ratesLoading}
        missingLoading={missingLoading}
        error={ratesError}
        missingError={missingError}
        canEdit={canEdit}
        reportingCurrency={reporting}
        highlightKey={highlightKey}
        onEdit={setManualTarget}
      />
      {reportingChange && (
        <ReportingChangeDialog
          previous={reportingChange.previous}
          to={reportingChange.to}
          impact={reportingChange.impact}
          saving={submitting}
          error={mutation.error ? errorMessage : ''}
          onClose={() => {
            if (submitting) return;
            setReportingChange(null);
          }}
          onConfirm={() => {
            setSuccessMessage('');
            setSyncNotice(null);
            mutation.mutate(reportingChange.payload);
          }}
        />
      )}
      {manualTarget && (
        <ManualRateDialog
          key={pairKey(manualTarget.currency, manualTarget.year)}
          currency={manualTarget.currency}
          year={manualTarget.year}
          reportingCurrency={reporting}
          rows={rateRows}
          onClose={() => setManualTarget(null)}
          onApplied={(result) => {
            if (result.removed) {
              setSuccessMessage(t(`${C}.manualRateRemoved`));
              // The automatic rate comes back from the fetch the removal queued: wait for it (the
              // refresh answers within 20 s), then read the rates again, so the cell never stays empty.
              if (result.refreshQueued) {
                void refreshCurrencyRates({ years: [result.year] })
                  .catch(() => undefined)
                  .finally(() => invalidateCurrencyRateQueries(queryClient));
              }
            }
            const frozenVersions = Number(result.frozenVersions);
            setFrozenNotice(
              Number.isInteger(frozenVersions) && frozenVersions > 0
                ? t(`${C}.frozenVersionsKept`, { count: frozenVersions, year: result.year })
                : '',
            );
          }}
        />
      )}
    </Box>
  );
}

type ReportingChangeDialogProps = {
  previous: string;
  to: string;
  impact: ReportingChangeImpact;
  saving: boolean;
  error: string;
  onClose: () => void;
  onConfirm: () => void;
};

/** Confirms a new reporting currency: what is converted, which manual rates pause, which frozen versions stay. */
function ReportingChangeDialog({ previous, to, impact, saving, error, onClose, onConfirm }: ReportingChangeDialogProps) {
  const { t } = useTranslation(['ops', 'common']);
  const locale = useLocale();
  const C = 'operations.currency';
  return (
    <KanapDialog
      open
      title={t(`${C}.changeReportingTitle`, { currency: to })}
      onClose={onClose}
      onSave={onConfirm}
      saveLabel={t(`${C}.changeReportingConfirm`)}
      saveDisabled={saving}
      saveLoading={saving}
    >
      <Stack spacing={1.5}>
        <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>
          {t(`${C}.changeReportingEffect`, { currency: to })}
        </Typography>
        {impact.manualRates.length > 0 && (
          <Box>
            <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>
              {t(`${C}.changeReportingManual`, { previous })}
            </Typography>
            <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
              {impact.manualRates.map((item) => (
                <Box
                  component="li"
                  key={`${item.currency}-${item.year}`}
                  sx={{ fontSize: 13, fontFamily: 'monospace', color: 'kanap.text.primary' }}
                >
                  {t(`${C}.changeReportingManualItem`, {
                    currency: item.currency,
                    year: item.year,
                    rate: formatRate(item.rate, locale),
                  })}
                </Box>
              ))}
            </Box>
          </Box>
        )}
        {impact.frozenVersions.map((item) => (
          <Typography key={item.year} sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>
            {t(`${C}.changeReportingFrozen`, { count: item.count, year: item.year, currency: to })}
          </Typography>
        ))}
        {impact.allowedAdded && (
          <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>
            {t(`${C}.changeReportingAllowed`, { currency: to })}
          </Typography>
        )}
        {error && (
          <Typography role="alert" sx={{ fontSize: 12, color: 'error.main' }}>{error}</Typography>
        )}
      </Stack>
    </KanapDialog>
  );
}

type ManualRateDialogProps = {
  currency: string;
  year: number;
  reportingCurrency: string;
  rows: CurrencyRateRow[] | undefined;
  onClose: () => void;
  onApplied: (result: { frozenVersions: number; refreshQueued: boolean; removed: boolean; year: number }) => void;
};

/** Enters, changes or removes the manual rate of one currency and year. */
function ManualRateDialog({ currency, year, reportingCurrency, rows, onClose, onApplied }: ManualRateDialogProps) {
  const { t } = useTranslation(['ops', 'common']);
  const C = 'operations.currency';
  const locale = useLocale();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const set = rows?.find((row) => row.fiscalYear === year);
  const current = set?.rates?.[currency];
  const isManual = set?.rateSources?.[currency] === 'manual';
  const neighbour = neighbouringAutomaticRate(rows, currency, year);
  // The same 6-decimal locale format as the matrix. A typed comma or point is read either way.
  const [draft, setDraft] = React.useState(current != null ? formatRate(current, locale) : '');
  const [fieldError, setFieldError] = React.useState<string | null>(null);
  const save = useSetManualRate();
  const remove = useRemoveManualRate();
  const busy = save.isPending || remove.isPending;

  // The dialog's focus trap runs after mount. Focus the field once it has settled.
  React.useEffect(() => {
    const focus = () => inputRef.current?.focus();
    focus();
    const timer = window.setTimeout(focus, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const serverError = save.error ?? remove.error;
  const serverMessage = serverError
    ? manualRateServerMessage(serverError, t, t(save.error ? `${C}.failedToSaveManualRate` : `${C}.failedToRemoveManualRate`))
    : null;
  const shownError = fieldError ?? serverMessage;

  const handleSave = async () => {
    const problem = manualRateProblem(draft);
    if (problem) {
      setFieldError(manualRateProblemMessage(problem, t, locale));
      return;
    }
    const rate = parseRateDraft(draft);
    if (rate == null) return;
    remove.reset();
    setFieldError(null);
    try {
      const result = await save.mutateAsync({ currency, year, rate: Number(rate.toFixed(6)) });
      onApplied({ frozenVersions: Number(result.frozenVersions ?? 0), refreshQueued: false, removed: false, year });
      onClose();
    } catch {
      // The code's message is shown under the field.
    }
  };

  const handleRemove = async () => {
    save.reset();
    setFieldError(null);
    try {
      const result = await remove.mutateAsync({ year, currency });
      onApplied({
        frozenVersions: Number(result.frozenVersions ?? 0),
        refreshQueued: result.refreshQueued,
        removed: true,
        year,
      });
      onClose();
    } catch {
      // The code's message is shown under the field.
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
        <PropertyRow
          label={t(`${C}.manualRateLabel`, { reporting: reportingCurrency, currency })}
          helperText={neighbour
            ? t(`${C}.automaticRateHint`, { year: neighbour.year, rate: formatRate(neighbour.rate, locale) })
            : t(`${C}.manualRateHint`)}
          required
          valueSx={{ maxWidth: 240 }}
        >
          <TextField
            variant="standard"
            value={draft}
            error={Boolean(shownError)}
            autoFocus
            inputRef={inputRef}
            inputProps={{ 'aria-label': t(`${C}.manualRateLabel`, { reporting: reportingCurrency, currency }), inputMode: 'decimal' }}
            onChange={(event) => {
              setDraft(event.target.value);
              setFieldError(null);
              save.reset();
              remove.reset();
            }}
            fullWidth
          />
        </PropertyRow>
        {shownError && (
          <Typography role="alert" sx={{ fontSize: 12, color: 'error.main' }}>
            {shownError}
          </Typography>
        )}
        <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>
          {t(`${C}.manualRateReplaces`)}
        </Typography>
      </Stack>
    </KanapDialog>
  );
}

function manualRateProblemMessage(
  problem: ManualRateProblem,
  t: (key: string, options?: Record<string, unknown>) => string,
  locale: string,
): string {
  switch (problem) {
    case 'empty': return t('operations.currency.manualRateEmpty');
    case 'nan': return t('operations.currency.manualRateNotANumber');
    case 'nonPositive': return t('operations.currency.manualRateInvalid');
    case 'tooLarge': return t('operations.currency.manualRateTooLarge', { max: formatDecimal(MANUAL_RATE_MAX, locale, 0) });
    case 'tooSmall': return t('operations.currency.manualRateTooSmall');
  }
}

/** A known `code` from the manual-rate endpoints. Anything else stays the generic error, never the English `message`. */
function manualRateServerMessage(
  error: unknown,
  t: (key: string, options?: Record<string, unknown>) => string,
  fallback: string,
): string {
  const key = MANUAL_RATE_ERROR_KEYS[apiErrorCode(error) as keyof typeof MANUAL_RATE_ERROR_KEYS];
  return key ? t(key) : fallback;
}

type RatesTableProps = {
  /** Row order from the API: reporting currency first. Not the union of rate keys. */
  currencies: string[] | undefined;
  rows: CurrencyRateRow[] | undefined;
  missing: MissingRatePair[] | undefined;
  loading: boolean;
  missingLoading: boolean;
  error: boolean;
  missingError: boolean;
  /** Editors get the sync hint, the "Enter a rate" actions and editable cells. */
  canEdit: boolean;
  reportingCurrency: string;
  /** `missing:CODE:YEAR`, `cell:CODE:YEAR` or `missing-section`, from a deep link. */
  highlightKey: string | null;
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
const manualStarSx = {
  ml: 0.25,
  fontSize: 11,
  color: 'kanap.text.tertiary',
  lineHeight: 0,
  cursor: 'default',
  outline: 'none',
  borderRadius: '2px',
  '&:focus-visible': { boxShadow: (theme: Theme) => `0 0 0 2px ${theme.palette.primary.main}` },
} as const;
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

/**
 * One cell of the matrix: the rate, an asterisk for a manual one (explained under the table),
 * a small mark for an estimated one, an orange dash when it is missing.
 */
function RateValue({ value, missing }: { value: number | null; missing: boolean }) {
  const locale = useLocale();
  if (value == null) {
    return (
      <Box component="span" sx={missing ? { color: 'warning.main' } : undefined}>
        —
      </Box>
    );
  }
  return <Box component="span">{formatRate(value, locale)}</Box>;
}

/**
 * The manual asterisk. It opens its explanation on hover and on any focus, including the keyboard.
 * MUI's own focus listener waits for :focus-visible, which a click earlier in the page suppresses.
 */
function ManualStar() {
  const { t } = useTranslation(['ops']);
  const label = t('operations.currency.manualFootnote');
  const [open, setOpen] = React.useState(false);
  return (
    <Tooltip
      title={label}
      open={open}
      onClose={() => setOpen(false)}
      disableFocusListener
      disableHoverListener
      disableTouchListener
    >
      <Box
        component="span"
        tabIndex={0}
        aria-label={label}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        sx={manualStarSx}
      >
        *
      </Box>
    </Tooltip>
  );
}

/** The manual asterisk (keyboard focusable, with its explanation) and the estimate mark. */
function RateMarks({ source }: { source: string | undefined }) {
  const { t } = useTranslation(['ops']);
  const C = 'operations.currency';
  if (source !== 'manual' && source !== 'estimate') return null;
  return (
    <>
      {source === 'manual' && <ManualStar />}
      {source === 'estimate' && (
        <Tooltip title={t(`${C}.estimateTooltip`)}>
          <Box component="span" sx={markSx}>{t(`${C}.estimateMark`)}</Box>
        </Tooltip>
      )}
    </>
  );
}

function CurrencyRatesTable({
  currencies,
  rows,
  missing,
  loading,
  missingLoading,
  error,
  missingError,
  canEdit,
  reportingCurrency,
  highlightKey,
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
  const currencyRows = (currencies ?? []).map((code) => code.trim().toUpperCase()).filter((code) => code.length > 0);
  const missingKeys = new Set(missingPairs.map((pair) => pairKey(pair.currency, pair.year)));
  const setByYear = new Map(rateRows.map((row) => [row.fiscalYear, row]));
  const hasManual = rateRows.some((row) => Object.values(row.rateSources ?? {}).includes('manual'));

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
          highlightKey={highlightKey}
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
                  const sourceLabel = set ? t(`${C}.${SOURCE_LABEL_KEYS[set.source ?? ''] ?? 'annualAvg'}`) : '';
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
              {currencyRows.map((code) => (
                <Box component="tr" key={code}>
                  <Box component="td" sx={{ ...cellSx, fontFamily: 'monospace', color: 'kanap.text.secondary' }}>{code}</Box>
                  {years.map((year) => {
                    const set = setByYear.get(year);
                    const value = set?.rates?.[code];
                    const source = set?.rateSources?.[code];
                    // The reporting currency is 1 by definition: no manual rate for it.
                    const editable = canEdit && code !== reportingCurrency && source !== 'identity';
                    const number = (
                      <RateValue value={value ?? null} missing={missingKeys.has(pairKey(code, year))} />
                    );
                    // The asterisk sits beside the button so it can take keyboard focus on its own.
                    const marks = value != null ? <RateMarks source={source} /> : null;
                    return (
                      <Box
                        component="td"
                        key={year}
                        id={`currency-cell-${code}-${year}`}
                        data-highlight={highlightKey === `cell:${code}:${year}` ? 'true' : undefined}
                        sx={{
                          ...cellSx,
                          textAlign: 'right',
                          whiteSpace: 'nowrap',
                          ...(highlightKey === `cell:${code}:${year}` ? highlightSx : null),
                        }}
                      >
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
                            {number}
                          </Box>
                        ) : number}
                        {marks}
                      </Box>
                    );
                  })}
                </Box>
              ))}
            </Box>
          </Box>
        </Box>
        {hasManual && (
          <Typography sx={{ mt: 1, fontSize: 12, color: 'kanap.text.tertiary' }}>
            * {t(`${C}.manualFootnote`)}
          </Typography>
        )}
      </Paper>
    </>
  );
}

type MissingRatesProps = {
  missing: MissingRatePair[];
  loading: boolean;
  error: boolean;
  canEdit: boolean;
  highlightKey: string | null;
  onEdit: (pair: MissingRatePair) => void;
};

/** The pairs in use with no rate, one dense line each, above the matrix. */
function MissingRates({ missing, loading, error, canEdit, highlightKey, onEdit }: MissingRatesProps) {
  const { t } = useTranslation(['ops']);
  const C = 'operations.currency';
  const sectionHighlight = highlightKey === 'missing-section';
  if (loading) return null;
  if (error) {
    return <Alert severity="error" sx={{ mb: 1.5 }}>{t(`${C}.loadMissingError`)}</Alert>;
  }
  if (missing.length === 0) {
    return (
      <Typography
        id="currency-missing"
        data-highlight={sectionHighlight ? 'true' : undefined}
        sx={{ fontSize: 13, color: 'kanap.text.secondary', mb: 1.5, ...(sectionHighlight ? highlightSx : null) }}
      >
        {t(`${C}.missingNone`)}
      </Typography>
    );
  }
  return (
    <Box id="currency-missing" data-highlight={sectionHighlight ? 'true' : undefined} sx={{ mb: 2, ...(sectionHighlight ? highlightSx : null) }}>
      <Typography component="h3" sx={{ fontSize: 13, fontWeight: 500, color: 'kanap.text.primary', mb: 0.5 }}>
        {t(`${C}.missingTitle`, { count: missing.length })}
      </Typography>
      <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {missing.map((pair) => {
          const rowKey = `missing:${pair.currency}:${pair.year}`;
          const rowHighlight = highlightKey === rowKey;
          return (
          <Box
            component="li"
            key={`${pair.currency}-${pair.year}`}
            id={`currency-missing-${pair.currency}-${pair.year}`}
            data-highlight={rowHighlight ? 'true' : undefined}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              minHeight: 32,
              fontSize: 13,
              ...(rowHighlight ? highlightSx : null),
            }}
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
          );
        })}
      </Box>
    </Box>
  );
}
