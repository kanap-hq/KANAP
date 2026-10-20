import type { TFunction } from 'i18next';
import { fxMissingText, mergeFxMissing, type FxMissing } from '../components/finance/fxMissing';

/** One company left out of a turnover split: no rate from `currency` into the reporting currency. */
export type TurnoverFxMissingItem = {
  companyId: string;
  companyName: string;
  currency: string;
  year: number;
};

/**
 * Companies left out of a turnover split (backend `allocation-distribution.ts`). Their turnover
 * is not in the weights.
 */
export type TurnoverFxMissingWarning = {
  code: 'turnover_fx_missing';
  items: TurnoverFxMissingItem[];
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
  return (warning.items ?? []).map((item) => t('ops:shared.allocationWarnings.turnoverFxMissing', {
    count: 1,
    company: item.companyName.trim() || t('master-data:companies.companyFallback'),
    currency: item.currency,
    year: item.year,
    reportingCurrency: warning.reportingCurrency,
  })).join('\n');
}

/** A stable React key for a warning. */
export function allocationWarningKey(warning: ReportWarning): string {
  if (typeof warning === 'string') return warning;
  if (warning.code === 'amount_fx_missing') {
    return `${warning.code}:${(warning.items ?? []).map((item) => `${item.currency}-${item.year}`).join(',')}`;
  }
  return `${warning.code}:${(warning.items ?? []).map((item) => `${item.companyId}:${item.currency}:${item.year}`).join(',')}`;
}

/** Whether a warning is the lines a report leaves out for lack of a rate. */
export function isAmountFxMissingWarning(warning: ReportWarning): warning is AmountFxMissingWarning {
  return typeof warning !== 'string' && warning.code === 'amount_fx_missing';
}

/** The lines a report leaves out for lack of a rate, from its warnings: the list the notice shows. */
export function amountFxMissingOf(warnings: ReadonlyArray<ReportWarning>): FxMissing[] {
  return mergeFxMissing(...warnings.filter(isAmountFxMissingWarning).map((warning) => warning.items));
}
