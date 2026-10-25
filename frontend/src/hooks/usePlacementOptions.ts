import React from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../api';
import { useAuth } from '../auth/AuthContext';
import { useDataAccessLimited } from '../auth/dataAccess';
import type { CostCenterNode } from '../services/costCenters';

/**
 * `GET /data-access/placement-options`: where a limited person may place a budget line or a
 * contract. `editNodeCompanies` are the companies of the edit nodes (a contract's place may carry
 * its own company, spec §2.3); absent from an older answer.
 */
export type PlacementOptionsAnswer =
  | { limited: false }
  | {
      limited: true;
      all: boolean;
      companies: string[];
      costCenters: Array<{ id: string; companyId: string }>;
      editNodeCompanies?: string[];
    };

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

export type ContractPlacementFilter = {
  /** The contracting companies offered. */
  companyIds: ReadonlySet<string>;
  /** The groups and centres offered for the chosen company. */
  isCostCenterAllowed: (node: CostCenterNode) => boolean;
};

/**
 * The contracting company and place pickers of a contract (spec §2.3, §7.7): the contract rule
 * differs from the line's. A company in the edit companies is offered with any place; a company of
 * the edit nodes is offered only through one of those nodes (`editNodeCompanies`). The edit nodes
 * come from the person's access (`GET /auth/me`), groups included; the endpoint carries their
 * companies. A place outside the edit nodes therefore leaves only the edit companies. Null for an
 * unscoped person, for Edit on everything, and while the answer loads; the server refuses the rest.
 */
export function useContractPlacementFilter(
  companyId: string | null | undefined,
  placeId: string | null | undefined,
): ContractPlacementFilter | null {
  const limited = useDataAccessLimited();
  const { dataAccess } = useAuth();
  const { data } = useQuery({
    queryKey: ['data-access', 'placement-options'],
    queryFn: async () => (await api.get<PlacementOptionsAnswer>('/data-access/placement-options')).data,
    enabled: limited,
    staleTime: 60_000,
  });
  const options = limited && data?.limited && !data.all ? data : null;
  const editNodes = React.useMemo(
    () => new Set((dataAccess?.nodes ?? [])
      .filter((node) => node.type === 'cost_center' && node.access === 'edit' && !!node.id)
      .map((node) => node.id as string)),
    [dataAccess],
  );
  const companies = React.useMemo(() => new Set(options?.companies ?? []), [options]);
  const nodeCompanies = React.useMemo(() => new Set(options?.editNodeCompanies ?? []), [options]);
  const company = companyId || null;
  const placeInEditNodes = !!placeId && editNodes.has(placeId);
  const companyIds = React.useMemo(() => {
    const ids = new Set([...companies, ...nodeCompanies]);
    // Another place only works through a company of the access.
    if (placeId && !placeInEditNodes) {
      for (const id of nodeCompanies) {
        if (!companies.has(id)) ids.delete(id);
      }
    }
    return ids;
  }, [companies, nodeCompanies, placeId, placeInEditNodes]);
  const isCostCenterAllowed = React.useCallback(
    (node: CostCenterNode) => {
      if (!!company && companies.has(company)) return true;
      if (company && nodeCompanies.has(company)) return editNodes.has(node.id);
      // Before the company is chosen, a place either rule could use.
      return editNodes.has(node.id) || (!!node.company_id && companies.has(node.company_id));
    },
    [companies, company, editNodes, nodeCompanies],
  );
  return React.useMemo(
    () => (options ? { companyIds, isCostCenterAllowed } : null),
    [companyIds, isCostCenterAllowed, options],
  );
}
