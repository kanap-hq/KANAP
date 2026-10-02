import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getCostCenterCount, getCostCenterTree, type CostCenterNode, type CostCenterRef } from '../services/costCenters';

export const COST_CENTER_TREE_QUERY_KEY = ['cost-centers', 'tree'] as const;
/** Under the tree's key: whatever refreshes the tree refreshes the count. */
export const COST_CENTER_COUNT_QUERY_KEY = [...COST_CENTER_TREE_QUERY_KEY, 'count'] as const;
const TREE_STALE_TIME = 5 * 60_000;

export type CostCenterTree = {
  /** False until the tree is loaded (or while the hook is disabled and the tree was never loaded). */
  ready: boolean;
  /** Tree order: each node follows its parent, siblings by sort order then code. */
  nodes: CostCenterNode[];
  byId: Map<string, CostCenterNode>;
  hasAny: boolean;
  /** The last load failed: `nodes` is then empty and says nothing about the tenant, so no empty state. */
  isError: boolean;
  /** The node itself and every node below it, disabled nodes included. Empty for an unknown id. */
  descendantIds(id: string): Set<string>;
};

/** Pure core of the hook, exported for tests and callers that already hold the nodes. */
export function buildCostCenterTree(nodes: CostCenterNode[], ready = true, isError = false): CostCenterTree {
  const byId = new Map<string, CostCenterNode>();
  const children = new Map<string, string[]>();
  for (const node of nodes) {
    byId.set(node.id, node);
    if (node.parent_id) {
      const list = children.get(node.parent_id);
      if (list) list.push(node.id);
      else children.set(node.parent_id, [node.id]);
    }
  }
  const cache = new Map<string, Set<string>>();
  const descendantIds = (id: string): Set<string> => {
    const cached = cache.get(id);
    if (cached) return cached;
    const out = new Set<string>();
    if (byId.has(id)) {
      const stack = [id];
      while (stack.length > 0) {
        const current = stack.pop() as string;
        // The server refuses cycles; the guard keeps a bad payload from looping.
        if (out.has(current)) continue;
        out.add(current);
        for (const child of children.get(current) ?? []) stack.push(child);
      }
    }
    cache.set(id, out);
    return out;
  };
  return { ready, nodes, byId, hasAny: nodes.length > 0, isError, descendantIds };
}

const EMPTY: CostCenterNode[] = [];

/**
 * The tenant's tree. `enabled: false` sends nothing but still reads a tree already loaded by
 * another component (a picker that was opened): the tree is about 90 KB on a large tenant, so the
 * workspaces and reports load it only when they need it.
 */
export function useCostCenterTree(options?: { enabled?: boolean }): CostCenterTree {
  const enabled = options?.enabled ?? true;
  const query = useQuery({
    queryKey: COST_CENTER_TREE_QUERY_KEY,
    queryFn: getCostCenterTree,
    enabled,
    staleTime: TREE_STALE_TIME,
  });
  const nodes = query.data ?? EMPTY;
  const ready = query.data !== undefined || (enabled && query.isError);
  const isError = enabled && query.isError;
  return useMemo(() => buildCostCenterTree(nodes, ready, isError), [nodes, ready, isError]);
}

/**
 * The node `id` names: `known` when it names that id (the line's detail, `references.cost_center`),
 * otherwise the node of the tree, which is then loaded. Null without an id, or until the tree
 * answers, or when it does not hold the id.
 */
export function useCostCenterNode(id: string | null | undefined, known?: CostCenterRef | null): CostCenterRef | null {
  const fromDetail = id && known?.id === id ? known : null;
  const tree = useCostCenterTree({ enabled: !!id && !fromDetail });
  if (!id) return null;
  return fromDetail ?? tree.byId.get(id) ?? null;
}

/** How many nodes the tenant has (a report shows its cost center filter only when there is one), without the tree. */
export function useCostCenterCount(options?: { enabled?: boolean }): { count: number | null; isError: boolean } {
  const query = useQuery({
    queryKey: COST_CENTER_COUNT_QUERY_KEY,
    queryFn: getCostCenterCount,
    enabled: options?.enabled ?? true,
    staleTime: TREE_STALE_TIME,
  });
  return { count: query.data ?? null, isError: query.isError };
}
