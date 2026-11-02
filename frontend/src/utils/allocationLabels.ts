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
 * The budget list shows the English constants `formatAllocationMethodLabel` builds
 * (`Company`, `Headcount`, …). Those strings stay the filter values sent to the API.
 * The cell and the filter checkboxes use the allocation tab's words instead.
 */
const LIST_LABEL_TO_METHOD: Record<string, string> = {
  Headcount: 'headcount',
  'IT users': 'it_users',
  Turnover: 'turnover',
  Company: 'manual_company',
  Department: 'manual_department',
  'Manual %': 'manual_pct',
  Default: 'default',
};

export function allocationListLabel(t: TFunction, label: string | null | undefined): string {
  if (!label) return '';
  const method = LIST_LABEL_TO_METHOD[label];
  return method ? allocationMethodLabel(t, method) : label;
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
