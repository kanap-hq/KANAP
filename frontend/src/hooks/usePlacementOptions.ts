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
  /** The cost centers offered for the chosen paying company. */
  isCostCenterAllowed: (node: CostCenterNode) => boolean;
};

/**
 * The paying company and cost center pickers of a budget line, for a person whose data access is
 * limited (spec §2.3, §7.7): only the placements the server accepts are offered. A company of the
 * access takes any cost center; a cost center of the access takes its own company. Null (no
 * filter) for an unscoped person, for Edit on everything, and while the answer loads; the server
 * refuses the rest anyway.
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
  const companyOpen = !!payingCompanyId && companies.has(payingCompanyId);
  const isCostCenterAllowed = React.useCallback(
    (node: CostCenterNode) => companyOpen || costCenters.has(node.id) || (!!node.company_id && companies.has(node.company_id)),
    [companies, companyOpen, costCenters],
  );
  return React.useMemo(
    () => (options ? { companyIds, isCostCenterAllowed } : null),
    [companyIds, isCostCenterAllowed, options],
  );
}
