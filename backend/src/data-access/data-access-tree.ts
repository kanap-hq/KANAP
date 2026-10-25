import { EntityManager } from 'typeorm';

/**
 * Data-scoped access, lot 6: the cost-centre tree unfolded the way `data_access_apply` unfolds it
 * (planning/data-scoped-access/spec.md §2.2, §6.3), for the administration screens:
 * - a company node covers the company and the centres whose company it is, and nothing below them;
 * - a group node covers itself, its sub-groups and their centres, whatever their company;
 * - a centre node covers itself;
 * - `all` covers everything.
 *
 * `data_access_apply` keeps the unfolded sets in its nine settings. This module writes that
 * unfolding once, in TypeScript, so the "who sees this node" routes answer exactly what the
 * policies show. `data-access-tree.spec.ts` compares the result with the settings of the seeded
 * persons, which is the test of the two forms.
 */

export type AccessNodeRow = {
  id: string;
  node_type: 'all' | 'company' | 'cost_center';
  access: 'read' | 'edit';
  company_id: string | null;
  cost_center_id: string | null;
};

export type TreeCompany = { id: string; name: string };

export type TreeCenter = {
  id: string;
  code: string;
  name: string;
  kind: 'group' | 'cost_center';
  company_id: string | null;
  parent_id: string | null;
};

export type AccessTree = {
  companies: Map<string, TreeCompany>;
  centers: Map<string, TreeCenter>;
  children: Map<string, string[]>;
};

type Queryable = { query(sql: string, params?: unknown[]): Promise<any[]> };

/** The tenant's companies and cost centres, with the parent links. */
export async function loadAccessTree(manager: Queryable, tenantId: string): Promise<AccessTree> {
  const companies: Array<{ id: string; name: string }> = await manager.query(
    `SELECT id, name FROM companies WHERE tenant_id = $1 ORDER BY lower(name), id`,
    [tenantId],
  );
  const centers: Array<{
    id: string; code: string; name: string; kind: string; company_id: string | null; parent_id: string | null;
  }> = await manager.query(
    `SELECT id, code, name, kind, company_id, parent_id
       FROM cost_centers
      WHERE tenant_id = $1
      ORDER BY lower(code), id`,
    [tenantId],
  );
  const children = new Map<string, string[]>();
  for (const center of centers) {
    if (!center.parent_id) continue;
    const list = children.get(center.parent_id) ?? [];
    list.push(center.id);
    children.set(center.parent_id, list);
  }
  return {
    companies: new Map(companies.map((company) => [company.id, company])),
    centers: new Map(centers.map((center) => [center.id, {
      id: center.id,
      code: center.code,
      name: center.name,
      kind: center.kind === 'group' ? 'group' : 'cost_center',
      company_id: center.company_id ?? null,
      parent_id: center.parent_id ?? null,
    }])),
    children,
  };
}

/**
 * The centre and every node below it (groups and centres), in tree order. A `visited` set stops on
 * a cycle: the application refuses one (`cost-center-tree.util.ts`), but a corrupted database row
 * must not loop the API process (spec §7.2).
 */
export function subtreeIds(tree: AccessTree, rootId: string): string[] {
  const out: string[] = [];
  const visited = new Set<string>();
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    out.push(id);
    stack.push(...(tree.children.get(id) ?? []));
  }
  return out;
}

/**
 * The centre's parent groups, nearest first (the centre itself is not included). A `visited` set
 * stops on a cycle, like `subtreeIds`.
 */
export function ancestorIds(tree: AccessTree, centerId: string): string[] {
  const out: string[] = [];
  const visited = new Set<string>([centerId]);
  let current = tree.centers.get(centerId)?.parent_id ?? null;
  while (current && !visited.has(current)) {
    visited.add(current);
    out.push(current);
    current = tree.centers.get(current)?.parent_id ?? null;
  }
  return out;
}

export type UnfoldedAccess = {
  readAll: boolean;
  editAll: boolean;
  readCompanies: Set<string>;
  editCompanies: Set<string>;
  /** Every centre and group of `tree` covered, as `data_access_apply` writes them. */
  readCenters: Set<string>;
  editCenters: Set<string>;
  /** The companies of the edit nodes (spec §2.3, `app.da_edit_node_companies`). */
  editCenterCompanies: Set<string>;
};

/**
 * The nine settings of `data_access_apply` for this person's nodes, as sets. An edit node is also
 * a read node; the widest access wins.
 */
export function unfoldAccess(nodes: readonly AccessNodeRow[], tree: AccessTree): UnfoldedAccess {
  const readAll = nodes.some((node) => node.node_type === 'all');
  const editAll = nodes.some((node) => node.node_type === 'all' && node.access === 'edit');
  const readCompanies = new Set<string>();
  const editCompanies = new Set<string>();
  const readCenters = new Set<string>();
  const editCenters = new Set<string>();

  const addCenters = (ids: readonly string[], access: 'read' | 'edit') => {
    for (const id of ids) {
      if (!tree.centers.has(id)) continue;
      readCenters.add(id);
      if (access === 'edit') editCenters.add(id);
    }
  };

  for (const node of nodes) {
    if (node.node_type === 'company' && node.company_id) {
      readCompanies.add(node.company_id);
      if (node.access === 'edit') editCompanies.add(node.company_id);
      const centers = [...tree.centers.values()]
        .filter((center) => center.company_id === node.company_id)
        .map((center) => center.id);
      addCenters(centers, node.access);
    } else if (node.node_type === 'cost_center' && node.cost_center_id) {
      addCenters(subtreeIds(tree, node.cost_center_id), node.access);
    }
  }

  const editCenterCompanies = new Set<string>();
  for (const id of editCenters) {
    const companyId = tree.centers.get(id)?.company_id;
    if (companyId) editCenterCompanies.add(companyId);
  }

  return { readAll, editAll, readCompanies, editCompanies, readCenters, editCenters, editCenterCompanies };
}

/** The best access of a set of nodes: edit when one grants it. */
export function widestAccess(nodes: readonly { access: 'read' | 'edit' }[]): 'read' | 'edit' {
  return nodes.some((node) => node.access === 'edit') ? 'edit' : 'read';
}

const TYPE_ORDER: Record<AccessNodeRow['node_type'], number> = { all: 0, company: 1, cost_center: 2 };

/** The stable order of the screens: all, companies by name, centres by code (spec §7.1). */
export function compareNodes(a: AccessNodeRow, b: AccessNodeRow, tree: AccessTree): number {
  const type = TYPE_ORDER[a.node_type] - TYPE_ORDER[b.node_type];
  if (type !== 0) return type;
  if (a.node_type === 'company') {
    const an = tree.companies.get(a.company_id ?? '')?.name ?? '';
    const bn = tree.companies.get(b.company_id ?? '')?.name ?? '';
    const byName = an.toLowerCase().localeCompare(bn.toLowerCase());
    if (byName !== 0) return byName;
  }
  if (a.node_type === 'cost_center') {
    const ac = tree.centers.get(a.cost_center_id ?? '')?.code ?? '';
    const bc = tree.centers.get(b.cost_center_id ?? '')?.code ?? '';
    const byCode = ac.toLowerCase().localeCompare(bc.toLowerCase());
    if (byCode !== 0) return byCode;
  }
  return a.id.localeCompare(b.id);
}

export function sortNodes(nodes: readonly AccessNodeRow[], tree: AccessTree): AccessNodeRow[] {
  return [...nodes].sort((a, b) => compareNodes(a, b, tree));
}

/**
 * A cost-centre node covers a company when one of the centres under it belongs to that company:
 * a group with no company covers the centres below it wherever they are.
 */
export function nodeCoversCompany(node: AccessNodeRow, companyId: string, tree: AccessTree): boolean {
  if (node.node_type === 'all') return true;
  if (node.node_type === 'company') return node.company_id === companyId;
  if (!node.cost_center_id) return false;
  return subtreeIds(tree, node.cost_center_id).some((id) => tree.centers.get(id)?.company_id === companyId);
}

/**
 * A node covers a cost centre, with the distance that ranks inherited accesses: 0 for the node
 * itself, 1 for its parent group, and so on; a company node and Tout cover it from outside the
 * parent chain.
 */
export function nodeCoversCenter(node: AccessNodeRow, center: TreeCenter, tree: AccessTree): { covered: boolean; distance: number } {
  if (node.node_type === 'all') return { covered: true, distance: Number.MAX_SAFE_INTEGER };
  if (node.node_type === 'company') {
    return {
      covered: center.kind === 'cost_center' && node.company_id !== null && node.company_id === center.company_id,
      distance: Number.MAX_SAFE_INTEGER - 1,
    };
  }
  if (!node.cost_center_id) return { covered: false, distance: 0 };
  if (node.cost_center_id === center.id) return { covered: true, distance: 0 };
  const ancestors = ancestorIds(tree, center.id);
  const index = ancestors.indexOf(node.cost_center_id);
  return index >= 0 ? { covered: true, distance: index + 1 } : { covered: false, distance: 0 };
}
