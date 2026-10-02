import { EntityManager } from 'typeorm';
import { deriveStatusFromDisabledAt, StatusState } from '../common/status';
import type { CostCenterKind } from './cost-center.entity';

export interface CostCenterTreeNode {
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
  depth: number;
  path: string;
  path_ids: string[];
}

/** One stored row, before the tree fields are computed. */
export interface CostCenterTreeRow {
  id: string;
  code: string;
  name: string;
  kind: CostCenterKind;
  parent_id: string | null;
  company_id: string | null;
  company_name?: string | null;
  owner_user_id: string | null;
  owner_name?: string | null;
  status?: string | null;
  disabled_at: Date | string | null;
  sort_order: number | string | null;
}

export const COST_CENTER_PATH_SEPARATOR = ' › ';

export function costCenterLabel(node: { code: string; name: string }): string {
  return `${node.code} · ${node.name}`;
}

// One collator for every comparison: `localeCompare` with options builds a new ICU collator per call,
// which made the tree sort the main CPU cost of the OPEX list under load (same order, by definition).
const codeCollator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

const compareSiblings = (a: CostCenterTreeRow, b: CostCenterTreeRow): number => {
  const byOrder = Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0);
  if (byOrder !== 0) return byOrder;
  return codeCollator.compare(a.code, b.code);
};

function toIso(value: Date | string | null): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Orders stored rows as a tree (siblings by sort order, then code) and fills
 * depth and path. The status is the effective one: a node whose end of
 * validity has passed reads as disabled, like every lifecycle list.
 * A node whose parent is missing is shown as a root, and a node caught in a
 * cycle (never written by the service) still comes out once, at the end.
 */
export function buildCostCenterTree(rows: CostCenterTreeRow[], now: Date = new Date()): CostCenterTreeNode[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const children = new Map<string | null, CostCenterTreeRow[]>();
  for (const row of rows) {
    const parentKey = row.parent_id && byId.has(row.parent_id) ? row.parent_id : null;
    const list = children.get(parentKey) ?? [];
    list.push(row);
    children.set(parentKey, list);
  }
  for (const list of children.values()) list.sort(compareSiblings);

  const out: CostCenterTreeNode[] = [];
  const visited = new Set<string>();
  const visit = (row: CostCenterTreeRow, parent: CostCenterTreeNode | null) => {
    if (visited.has(row.id)) return;
    visited.add(row.id);
    const node: CostCenterTreeNode = {
      id: row.id,
      code: row.code,
      name: row.name,
      kind: row.kind,
      parent_id: row.parent_id ?? null,
      company_id: row.company_id ?? null,
      company_name: row.company_name ?? null,
      owner_user_id: row.owner_user_id ?? null,
      owner_name: row.owner_name ?? null,
      status: deriveStatusFromDisabledAt(row.disabled_at, now) === StatusState.DISABLED ? 'disabled' : 'enabled',
      disabled_at: toIso(row.disabled_at),
      sort_order: Number(row.sort_order ?? 0),
      depth: parent ? parent.depth + 1 : 0,
      path: parent ? `${parent.path}${COST_CENTER_PATH_SEPARATOR}${row.name}` : row.name,
      path_ids: parent ? [...parent.path_ids, row.id] : [row.id],
    };
    out.push(node);
    for (const child of children.get(row.id) ?? []) visit(child, node);
  };
  for (const root of children.get(null) ?? []) visit(root, null);
  for (const row of [...rows].sort(compareSiblings)) visit(row, null);
  return out;
}

/** One node of `GET /cost-centers/tree`. */
export interface CostCenterOutlineNode {
  id: string;
  code: string;
  name: string;
  kind: CostCenterKind;
  parent_id: string | null;
  company_id: string | null;
  owner_user_id: string | null;
  /** The effective status, as in the tree. */
  status: 'enabled' | 'disabled';
}

/**
 * The tree as the item forms, the report filters and the cost centers page read
 * it (`GET /cost-centers/tree`): the nodes in tree order, and each company and
 * owner name once, by id. Depth, path and ancestors follow from the order and
 * `parent_id` (a node whose parent comes before it hangs below it, any other is
 * a root, as in `buildCostCenterTree`): the client derives them. About half the
 * bytes of the full nodes on 300 nodes, where the paths and ancestor ids weighed
 * most.
 */
export interface CostCenterOutline {
  nodes: CostCenterOutlineNode[];
  companies: Record<string, string>;
  owners: Record<string, string>;
}

export function toCostCenterOutline(tree: CostCenterTreeNode[]): CostCenterOutline {
  const companies: Record<string, string> = {};
  const owners: Record<string, string> = {};
  const nodes = tree.map((node) => {
    if (node.company_id && node.company_name != null) companies[node.company_id] = node.company_name;
    if (node.owner_user_id && node.owner_name != null) owners[node.owner_user_id] = node.owner_name;
    return {
      id: node.id,
      code: node.code,
      name: node.name,
      kind: node.kind,
      parent_id: node.parent_id,
      company_id: node.company_id,
      owner_user_id: node.owner_user_id,
      status: node.status,
    };
  });
  return { nodes, companies, owners };
}

/** The tenant's whole tree in tree order, with company and owner names. */
export async function loadCostCenterTree(manager: EntityManager, tenantId: string): Promise<CostCenterTreeNode[]> {
  const rows: CostCenterTreeRow[] = await manager.query(
    `SELECT cc.id, cc.code, cc.name, cc.kind, cc.parent_id, cc.company_id, c.name AS company_name,
            cc.owner_user_id,
            CASE WHEN u.id IS NULL THEN NULL
                 ELSE COALESCE(NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''), u.email) END AS owner_name,
            cc.status, cc.disabled_at, cc.sort_order
       FROM cost_centers cc
       LEFT JOIN companies c ON c.id = cc.company_id AND c.tenant_id = cc.tenant_id
       LEFT JOIN users u ON u.id = cc.owner_user_id AND u.tenant_id = cc.tenant_id
      WHERE cc.tenant_id = $1`,
    [tenantId],
  );
  return buildCostCenterTree(rows);
}
