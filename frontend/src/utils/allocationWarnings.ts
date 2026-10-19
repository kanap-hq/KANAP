import type { TFunction } from 'i18next';

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

/** A warning of a report: a sentence from the server, or a structured warning worded here. */
export type ReportWarning = string | TurnoverFxMissingWarning;

/** The warning in the user's language; a sentence from the server is shown as it is. */
export function allocationWarningText(t: TFunction, warning: ReportWarning): string {
  if (typeof warning === 'string') return warning;
  return t('ops:shared.allocationWarnings.turnoverFxMissing', {
    count: warning.currencies.length,
    currencies: warning.currencies.join(', '),
    year: warning.year,
    reportingCurrency: warning.reportingCurrency,
  });
}

/** A stable React key for a warning. */
export function allocationWarningKey(warning: ReportWarning): string {
  return typeof warning === 'string' ? warning : `${warning.code}:${warning.year}:${warning.currencies.join(',')}`;
}
