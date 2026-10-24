import React from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../api';
import { useDataAccessLimited } from '../auth/dataAccess';
import type { CostCenterNode } from '../services/costCenters';

/** `GET /data-access/placement-options`: where a limited person may place a budget line. */
export type PlacementOptionsAnswer =
  | { limited: false }
  | { limited: true; all: boolean; companies: string[]; costCenters: Array<{ id: string; companyId: string }> };

export type LinePlacementFilter = {
  /** The paying companies offered. */
  companyIds: ReadonlySet<string>;
  /** The cost centers offered: those of the chosen paying company the access allows. */
  isCostCenterAllowed: (node: CostCenterNode) => boolean;
  /** The chosen paying company is allowed only through cost centers: the line needs one of them. */
  costCenterRequired: boolean;
};

/**
 * The paying company and cost center pickers of a budget line, for a person whose data access is
 * limited (spec §2.3, §7.7): only the placements the server accepts are offered
 * (`data_access_placable_line`). A company of the access is offered with its cost centers, or
 * none; a cost center of the access is offered with its own company, which then needs one of
 * those cost centers. Without a paying company (it follows the cost center), every cost center of
 * the access and of its companies. Null (no filter) for an unscoped person, for Edit on everything,
 * and while the answer loads; the server refuses the rest anyway.
 */
export function useLinePlacementFilter(payingCompanyId: string | null | undefined): LinePlacementFilter | null {
  const limited = useDataAccessLimited();
  const { data } = useQuery({
    queryKey: ['data-access', 'placement-options'],
    queryFn: async () => (await api.get<PlacementOptionsAnswer>('/data-access/placement-options')).data,
    enabled: limited,
    staleTime: 60_000,
  });
  const options = limited && data?.limited && !data.all ? data : null;
  const companies = React.useMemo(() => new Set(options?.companies ?? []), [options]);
  const costCenters = React.useMemo(() => new Set((options?.costCenters ?? []).map((row) => row.id)), [options]);
  const companyIds = React.useMemo(
    () => new Set([...companies, ...(options?.costCenters ?? []).map((row) => row.companyId)]),
    [companies, options],
  );
  const company = payingCompanyId || null;
  const companyOpen = !!company && companies.has(company);
  const isCostCenterAllowed = React.useCallback(
    (node: CostCenterNode) => (company
      ? node.company_id === company && (companyOpen || costCenters.has(node.id))
      : costCenters.has(node.id) || (!!node.company_id && companies.has(node.company_id))),
    [companies, company, companyOpen, costCenters],
  );
  const costCenterRequired = !!company && !companyOpen;
  return React.useMemo(
    () => (options ? { companyIds, isCostCenterAllowed, costCenterRequired } : null),
    [companyIds, costCenterRequired, isCostCenterAllowed, options],
  );
}
