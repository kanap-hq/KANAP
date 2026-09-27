import api from '../api';

/**
 * Cost centers (`/cost-centers`). Both directions use storage keys. A group holds other nodes and has no
 * company; a cost center has a company, no children, and is the only kind a budget line can carry.
 */
export type CostCenterKind = 'group' | 'cost_center';

export type CostCenterNode = {
  id: string;
  code: string;
  name: string;
  kind: CostCenterKind;
  parent_id: string | null;
  company_id: string | null;
  company_name: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  status: 'enabled' | 'disabled';
  disabled_at: string | null;
  sort_order: number;
  /** 0 = root. */
  depth: number;
  /** Names root to node, joined with ' › '. */
  path: string;
  /** Ids root to node. */
  path_ids: string[];
};

export type CostCenterListRow = CostCenterNode & {
  parent_code: string | null;
  parent_name: string | null;
};

export type CostCenterDetail = CostCenterListRow & {
  description: string | null;
  opex_count: number;
  capex_count: number;
};

export type CostCenterWrite = {
  code: string;
  kind: CostCenterKind;
  name: string;
  description?: string | null;
  parent_id?: string | null;
  company_id?: string | null;
  owner_user_id?: string | null;
  status?: 'enabled' | 'disabled';
  disabled_at?: string | null;
  sort_order?: number;
};

export type CostCenterPatch = Partial<CostCenterWrite>;

export type CostCenterBulkDeleteResult = {
  deleted: string[];
  failed: Array<{ id: string; name: string; reason: string }>;
};

export const COST_CENTERS_ENDPOINT = '/cost-centers';

/** Separator of the list label, the same as the server's `cost_center_label`. */
export const COST_CENTER_LABEL_SEPARATOR = ' · ';

export function costCenterLabel(node: { code: string; name: string }): string {
  return `${node.code}${COST_CENTER_LABEL_SEPARATOR}${node.name}`;
}

export async function getCostCenterTree(): Promise<CostCenterNode[]> {
  const res = await api.get<{ items: CostCenterNode[] }>(`${COST_CENTERS_ENDPOINT}/tree`);
  return Array.isArray(res.data?.items) ? res.data.items : [];
}

export async function getCostCenter(id: string): Promise<CostCenterDetail> {
  const res = await api.get<CostCenterDetail>(`${COST_CENTERS_ENDPOINT}/${id}`);
  return res.data;
}

export async function createCostCenter(body: CostCenterWrite): Promise<CostCenterDetail> {
  const res = await api.post<CostCenterDetail>(COST_CENTERS_ENDPOINT, body);
  return res.data;
}

export async function updateCostCenter(id: string, patch: CostCenterPatch): Promise<CostCenterDetail> {
  const res = await api.patch<CostCenterDetail>(`${COST_CENTERS_ENDPOINT}/${id}`, patch);
  return res.data;
}

export async function deleteCostCenter(id: string): Promise<void> {
  await api.delete(`${COST_CENTERS_ENDPOINT}/${id}`);
}

export async function deleteCostCenters(ids: string[]): Promise<CostCenterBulkDeleteResult> {
  const res = await api.delete<CostCenterBulkDeleteResult>(`${COST_CENTERS_ENDPOINT}/bulk`, { data: { ids } });
  return res.data;
}
