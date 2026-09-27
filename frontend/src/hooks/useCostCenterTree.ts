import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getCostCenterTree, type CostCenterNode } from '../services/costCenters';

export const COST_CENTER_TREE_QUERY_KEY = ['cost-centers', 'tree'] as const;

export type CostCenterTree = {
  /** False until the tree is loaded (or when the hook is disabled). */
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

export function useCostCenterTree(options?: { enabled?: boolean }): CostCenterTree {
  const enabled = options?.enabled ?? true;
  const query = useQuery({
    queryKey: COST_CENTER_TREE_QUERY_KEY,
    queryFn: getCostCenterTree,
    enabled,
    staleTime: 5 * 60_000,
  });
  const nodes = query.data ?? EMPTY;
  const ready = enabled && (query.isSuccess || query.isError);
  const isError = enabled && query.isError;
  return useMemo(() => buildCostCenterTree(nodes, ready, isError), [nodes, ready, isError]);
}
