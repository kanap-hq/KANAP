import api from '../api';

/**
 * Cost centers (`/cost-centers`). Both directions use storage keys. A group holds other nodes and has no
 * company; a cost center has a company, no children, and is the only kind a budget line can carry.
 */
export type CostCenterKind = 'group' | 'cost_center';

/** A node of the tree (`GET /cost-centers/tree`), as the pickers and filters read it. */
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
  /** The effective status: a node past its end of validity reads as disabled. */
  status: 'enabled' | 'disabled';
  /** 0 = root. */
  depth: number;
  /** Names root to node, joined with ' › '. */
  path: string;
  /** Ids root to node. */
  path_ids: string[];
};

/**
 * One node as a line's detail names it (`references.cost_center`): what a picker shows and what
 * the workspace reads from the chosen node (its company, its budget holder), without the tree.
 */
export type CostCenterRef = Pick<
  CostCenterNode,
  'id' | 'code' | 'name' | 'kind' | 'status' | 'company_id' | 'company_name' | 'owner_user_id' | 'owner_name'
>;

export type CostCenterListRow = CostCenterNode & {
  disabled_at: string | null;
  sort_order: number;
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

export const COST_CENTER_PATH_SEPARATOR = ' › ';

/** `GET /cost-centers/tree`: the nodes in tree order, ids only, and each company and owner name once. */
export type CostCenterOutline = {
  nodes: Array<Pick<CostCenterNode, 'id' | 'code' | 'name' | 'kind' | 'parent_id' | 'company_id' | 'owner_user_id' | 'status'>>;
  companies: Record<string, string>;
  owners: Record<string, string>;
};

/**
 * The tree's nodes from the server's outline: the names from the two maps, and depth, path and
 * ancestors from the order (a node whose parent comes before it hangs below it, any other node is
 * a root, as the server orders them).
 */
export function expandCostCenterOutline(outline: Partial<CostCenterOutline> | null | undefined): CostCenterNode[] {
  const raw = Array.isArray(outline?.nodes) ? outline.nodes : [];
  const companies = outline?.companies ?? {};
  const owners = outline?.owners ?? {};
  const placed = new Map<string, CostCenterNode>();
  const out: CostCenterNode[] = [];
  for (const entry of raw) {
    const parent = entry.parent_id ? placed.get(entry.parent_id) : undefined;
    const node: CostCenterNode = {
      ...entry,
      company_name: entry.company_id ? companies[entry.company_id] ?? null : null,
      owner_name: entry.owner_user_id ? owners[entry.owner_user_id] ?? null : null,
      depth: parent ? parent.depth + 1 : 0,
      path: parent ? `${parent.path}${COST_CENTER_PATH_SEPARATOR}${entry.name}` : entry.name,
      path_ids: parent ? [...parent.path_ids, entry.id] : [entry.id],
    };
    placed.set(node.id, node);
    out.push(node);
  }
  return out;
}

export async function getCostCenterTree(): Promise<CostCenterNode[]> {
  const res = await api.get<CostCenterOutline>(`${COST_CENTERS_ENDPOINT}/tree`);
  return expandCostCenterOutline(res.data);
}

/** How many nodes the tenant has, without the tree. */
export async function getCostCenterCount(): Promise<number> {
  const res = await api.get<{ count: number }>(`${COST_CENTERS_ENDPOINT}/tree/count`);
  return Number(res.data?.count) || 0;
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
