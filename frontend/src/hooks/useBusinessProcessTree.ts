import { useMemo } from 'react';
import { useQuery, type QueryClient } from '@tanstack/react-query';
import api from '../api';

/** The ISO 9001 types of a process, in the order the screens list them. */
export const BUSINESS_PROCESS_TYPES = ['management', 'core', 'support'] as const;
export type BusinessProcessType = (typeof BUSINESS_PROCESS_TYPES)[number];

/** One process of `GET /business-processes/tree`, in tree order (each after its parent, siblings by name). */
export type BusinessProcessNode = {
  id: string;
  name: string;
  parent_id: string | null;
  process_type: BusinessProcessType | null;
  status: string;
  disabled_at: string | null;
  depth: number;
  /** Names from the top of the tree, joined by ` › `. */
  path: string;
  path_ids: string[];
};

export const BUSINESS_PROCESS_TREE_QUERY_KEY = ['business-processes', 'tree'] as const;
const TREE_STALE_TIME = 5 * 60_000;

async function getBusinessProcessTree(): Promise<BusinessProcessNode[]> {
  const res = await api.get<{ items: BusinessProcessNode[] }>('/business-processes/tree');
  return Array.isArray(res.data?.items) ? res.data.items : [];
}

export type BusinessProcessTree = {
  ready: boolean;
  isError: boolean;
  nodes: BusinessProcessNode[];
  byId: Map<string, BusinessProcessNode>;
  /** The process itself and every process below it. Empty for an unknown id. */
  descendantIds(id: string): Set<string>;
};

export function buildBusinessProcessTree(nodes: BusinessProcessNode[], ready = true, isError = false): BusinessProcessTree {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const children = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node.parent_id) continue;
    children.set(node.parent_id, [...(children.get(node.parent_id) ?? []), node.id]);
  }
  const descendantIds = (id: string): Set<string> => {
    const out = new Set<string>();
    if (!byId.has(id)) return out;
    const stack = [id];
    while (stack.length > 0) {
      const current = stack.pop() as string;
      // The server refuses cycles; the guard keeps a bad payload from looping.
      if (out.has(current)) continue;
      out.add(current);
      stack.push(...(children.get(current) ?? []));
    }
    return out;
  };
  return { ready, isError, nodes, byId, descendantIds };
}

const EMPTY: BusinessProcessNode[] = [];

/** The tenant's process tree. `enabled: false` sends nothing but still reads a tree already loaded. */
export function useBusinessProcessTree(options?: { enabled?: boolean }): BusinessProcessTree {
  const enabled = options?.enabled ?? true;
  const query = useQuery({
    queryKey: BUSINESS_PROCESS_TREE_QUERY_KEY,
    queryFn: getBusinessProcessTree,
    enabled,
    staleTime: TREE_STALE_TIME,
  });
  const nodes = query.data ?? EMPTY;
  const ready = query.data !== undefined || (enabled && query.isError);
  const isError = enabled && query.isError;
  return useMemo(() => buildBusinessProcessTree(nodes, ready, isError), [nodes, ready, isError]);
}

/** The tree for code that is not a component (a list filter loading its values when it opens). */
export function fetchBusinessProcessTree(queryClient: QueryClient): Promise<BusinessProcessNode[]> {
  return queryClient.fetchQuery({ queryKey: BUSINESS_PROCESS_TREE_QUERY_KEY, queryFn: getBusinessProcessTree, staleTime: TREE_STALE_TIME });
}
