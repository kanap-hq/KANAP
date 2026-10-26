import type { TFunction } from 'i18next';
import { fxMissingText, mergeFxMissing, type FxMissing } from '../components/finance/fxMissing';
import { allocationMethodLabel } from './allocationLabels';

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

/** Why a chargeback line's allocation could not be recomputed (`chargeback-report.service.ts`). */
export type ChargebackAllocationReason =
  | { code: 'select_company' }
  | { code: 'select_department' }
  | { code: 'no_enabled_companies' }
  | { code: 'departments_not_found' }
  | { code: 'provide_department_headcount' }
  | { code: 'driver_sum_zero' }
  | { code: 'companies_unavailable' }
  | { code: 'turnover_rate' }
  | { code: 'provide_driver'; driver: 'headcount' | 'it_users' | 'turnover' }
  | { code: 'text'; text: string };

/** A line whose stored allocation was kept, or whose allocations were left out. */
export type ChargebackAllocationFailureWarning = {
  code: 'stored_allocation_used' | 'allocations_skipped';
  item: string;
  year: number;
  reason: ChargebackAllocationReason;
};

/** A line with no paying company: its paid total is left out. */
export type MissingPayingCompanyWarning = {
  code: 'missing_paying_company';
  item: string;
  year: number;
};

/** A warning of a report: a sentence from the server, or a structured warning worded here. */
export type ReportWarning =
  | string
  | TurnoverFxMissingWarning
  | AmountFxMissingWarning
  | ChargebackAllocationFailureWarning
  | MissingPayingCompanyWarning;

function chargebackReasonText(t: TFunction, reason: ChargebackAllocationReason): string {
  switch (reason.code) {
    case 'text':
      return reason.text;
    case 'provide_driver':
      return t('ops:reports.shared.chargebackWarnings.provideDriver', { driver: allocationMethodLabel(t, reason.driver) });
    case 'select_company':
      return t('ops:reports.shared.chargebackWarnings.selectCompany');
    case 'select_department':
      return t('ops:reports.shared.chargebackWarnings.selectDepartment');
    case 'no_enabled_companies':
      return t('ops:reports.shared.chargebackWarnings.noEnabledCompanies');
    case 'departments_not_found':
      return t('ops:reports.shared.chargebackWarnings.departmentsNotFound');
    case 'provide_department_headcount':
      return t('ops:reports.shared.chargebackWarnings.provideDepartmentHeadcount');
    case 'driver_sum_zero':
      return t('ops:reports.shared.chargebackWarnings.driverSumZero');
    case 'companies_unavailable':
      return t('ops:reports.shared.chargebackWarnings.companiesUnavailable');
    case 'turnover_rate':
      return t('ops:reports.shared.chargebackWarnings.turnoverRate');
    default: {
      const unknown: never = reason;
      return unknown;
    }
  }
}

/** The warning in the user's language; a sentence from the server is shown as it is. */
export function allocationWarningText(t: TFunction, warning: ReportWarning): string {
  if (typeof warning === 'string') return warning;
  switch (warning.code) {
    case 'amount_fx_missing':
      return fxMissingText(t, warning.items ?? []);
    case 'missing_paying_company':
      return t('ops:reports.shared.chargebackWarnings.missingPayingCompany', { item: warning.item, year: warning.year });
    case 'stored_allocation_used':
    case 'allocations_skipped': {
      const key = warning.code === 'stored_allocation_used'
        ? 'ops:reports.shared.chargebackWarnings.storedAllocationUsed'
        : 'ops:reports.shared.chargebackWarnings.allocationsSkipped';
      return t(key, { item: warning.item, year: warning.year, reason: chargebackReasonText(t, warning.reason) });
    }
    case 'turnover_fx_missing':
      return (warning.items ?? []).map((item) => t('ops:shared.allocationWarnings.turnoverFxMissing', {
        count: 1,
        company: item.companyName.trim() || t('master-data:companies.companyFallback'),
        currency: item.currency,
        year: item.year,
        reportingCurrency: warning.reportingCurrency,
      })).join('\n');
    default: {
      const unknown: never = warning;
      return unknown;
    }
  }
}

/** A stable React key for a warning. */
export function allocationWarningKey(warning: ReportWarning): string {
  if (typeof warning === 'string') return warning;
  switch (warning.code) {
    case 'amount_fx_missing':
      return `${warning.code}:${(warning.items ?? []).map((item) => `${item.currency}-${item.year}`).join(',')}`;
    case 'stored_allocation_used':
    case 'allocations_skipped':
    case 'missing_paying_company':
      return `${warning.code}:${warning.year}:${warning.item}`;
    case 'turnover_fx_missing':
      return `${warning.code}:${(warning.items ?? []).map((item) => `${item.companyId}:${item.currency}:${item.year}`).join(',')}`;
    default: {
      const unknown: never = warning;
      return unknown;
    }
  }
}

/** Whether a warning is the lines a report leaves out for lack of a rate. */
export function isAmountFxMissingWarning(warning: ReportWarning): warning is AmountFxMissingWarning {
  return typeof warning !== 'string' && warning.code === 'amount_fx_missing';
}

/** The lines a report leaves out for lack of a rate, from its warnings: the list the notice shows. */
export function amountFxMissingOf(warnings: ReadonlyArray<ReportWarning>): FxMissing[] {
  return mergeFxMissing(...warnings.filter(isAmountFxMissingWarning).map((warning) => warning.items));
}
