import type { TFunction } from 'i18next';
import { fxMissingText, mergeFxMissing, type FxMissing } from '../components/finance/fxMissing';

/**
 * An allocation computed with a reservation: the turnovers in `currencies` had no rate into
 * `reportingCurrency` for `year` and were counted unconverted (backend `allocation-distribution.ts`).
 */
export type TurnoverFxMissingWarning = {
  code: 'turnover_fx_missing';
  currencies: string[];
  year: number;
  reportingCurrency: string;
};

/**
 * Budget lines left out of every sum of a chargeback report: their currency has no rate into
 * `reportingCurrency` for their year (backend `chargeback-report.service.ts`).
 */
export type AmountFxMissingWarning = {
  code: 'amount_fx_missing';
  items: FxMissing[];
  reportingCurrency: string;
};

/** A warning of a report: a sentence from the server, or a structured warning worded here. */
export type ReportWarning = string | TurnoverFxMissingWarning | AmountFxMissingWarning;

/** The warning in the user's language; a sentence from the server is shown as it is. */
export function allocationWarningText(t: TFunction, warning: ReportWarning): string {
  if (typeof warning === 'string') return warning;
  if (warning.code === 'amount_fx_missing') return fxMissingText(t, warning.items ?? []);
  return t('ops:shared.allocationWarnings.turnoverFxMissing', {
    count: warning.currencies.length,
    currencies: warning.currencies.join(', '),
    year: warning.year,
    reportingCurrency: warning.reportingCurrency,
  });
}

/** A stable React key for a warning. */
export function allocationWarningKey(warning: ReportWarning): string {
  if (typeof warning === 'string') return warning;
  if (warning.code === 'amount_fx_missing') {
    return `${warning.code}:${(warning.items ?? []).map((item) => `${item.currency}-${item.year}`).join(',')}`;
  }
  return `${warning.code}:${warning.year}:${warning.currencies.join(',')}`;
}

/** Whether a warning is the lines a report leaves out for lack of a rate. */
export function isAmountFxMissingWarning(warning: ReportWarning): warning is AmountFxMissingWarning {
  return typeof warning !== 'string' && warning.code === 'amount_fx_missing';
}

/** The lines a report leaves out for lack of a rate, from its warnings: the list the notice shows. */
export function amountFxMissingOf(warnings: ReadonlyArray<ReportWarning>): FxMissing[] {
  return mergeFxMissing(...warnings.filter(isAmountFxMissingWarning).map((warning) => warning.items));
}
