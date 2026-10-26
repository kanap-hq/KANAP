import type { TFunction } from 'i18next';

/**
 * The allocation method, in the user's language. The codes are the ones the chargeback report
 * and the allocation copy return. The words are the allocation tab's (`opex.allocations`, repeated
 * on the CAPEX tab). `default` is the method a line follows until an explicit one is set.
 */
export function allocationMethodLabel(t: TFunction, method: string | null | undefined): string {
  switch (method) {
    case 'headcount':
      return t('ops:opex.allocations.headcount');
    case 'it_users':
      return t('ops:opex.allocations.itUsers');
    case 'turnover':
      return t('ops:opex.allocations.turnover');
    case 'manual_company':
      return t('ops:opex.allocations.manualByCompany');
    case 'manual_department':
      return t('ops:opex.allocations.manualByDepartment');
    case 'manual_pct':
      return t('ops:opex.allocations.manualByPct');
    case 'default':
      return t('ops:reports.shared.allocationMethodDefault');
    default:
      return method ?? '';
  }
}

/**
 * A chargeback department cell. No department id is the common-costs row. An id without a name
 * is a department that no longer exists.
 */
export function chargebackDepartmentLabel(
  t: TFunction,
  departmentId: string | null | undefined,
  departmentName: string | null | undefined,
): string {
  if (departmentId == null) return t('ops:reports.globalChargeback.commonCosts');
  const name = departmentName?.trim();
  return name ? name : t('ops:reports.shared.unknownDepartment');
}
