import api from '../api';
import type { TurnoverFxMissingWarning } from '../utils/allocationWarnings';

export type AllocationMethod = 'headcount' | 'it_users' | 'turnover';
export type AllocationRuleMode = 'auto' | 'manual_company';

export type AllocationRuleShare = { company_id: string; allocation_pct: number };

export type AllocationRuleResolution = {
  fiscal_year: number;
  /** Effective company set: every enabled company (`auto`) or the tenant selection. */
  mode: AllocationRuleMode;
  /** Effective driver: the tenant override when configured, the standard method otherwise. */
  method: AllocationMethod;
  source: 'standard' | 'tenant';
  standard_mode: AllocationRuleMode;
  standard_method: AllocationMethod;
  tenant_mode: AllocationRuleMode | null;
  tenant_method: AllocationMethod | null;
  /** Effective company selection, `manual_company` mode only. */
  company_ids: string[] | null;
  /** Computed split of the effective selection; empty in `auto` mode. */
  shares: AllocationRuleShare[];
  /** Why the effective selection cannot be computed (missing metric, disabled company…). */
  preview_error: string | null;
  /** The split is computed, but turnovers without a rate into the reporting currency were counted unconverted. */
  preview_warning?: TurnoverFxMissingWarning | null;
};

export type AllocationRulePayload = {
  mode: AllocationRuleMode;
  method: AllocationMethod;
  /** Required in `manual_company` mode, ignored in `auto`. */
  companyIds: string[] | null;
};

export async function fetchAllocationRule(year: number): Promise<AllocationRuleResolution> {
  const { data } = await api.get<AllocationRuleResolution>('/allocation-rules/active', {
    params: { year },
  });
  return data;
}

export async function saveAllocationRule(
  year: number,
  payload: AllocationRulePayload,
): Promise<AllocationRuleResolution> {
  const { data } = await api.patch<AllocationRuleResolution>(
    '/allocation-rules/active',
    { mode: payload.mode, method: payload.method, company_ids: payload.companyIds },
    { params: { year } },
  );
  return data;
}

/** Drops the tenant override so the fiscal year falls back to the standard method. */
export async function resetAllocationRule(year: number): Promise<AllocationRuleResolution> {
  const { data } = await api.delete<AllocationRuleResolution>('/allocation-rules/active', {
    params: { year },
  });
  return data;
}
