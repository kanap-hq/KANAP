import { describe, expect, it } from 'vitest';
import { buildCostCenterTree } from './useCostCenterTree';
import type { CostCenterNode } from '../services/costCenters';

function node(partial: Partial<CostCenterNode> & Pick<CostCenterNode, 'id' | 'code' | 'name'>): CostCenterNode {
  return {
    kind: 'cost_center',
    parent_id: null,
    company_id: 'company-1',
    company_name: 'Company one',
    owner_user_id: null,
    owner_name: null,
    status: 'enabled',
    disabled_at: null,
    sort_order: 0,
    depth: 0,
    path: partial.name,
    path_ids: [partial.id],
    ...partial,
  };
}

// IT (group) > Apps (group, disabled) > IT-200 ; IT > IT-100 (disabled) ; LG-10 standalone
const NODES: CostCenterNode[] = [
  node({ id: 'it', code: 'IT', name: 'IT department', kind: 'group', company_id: null, company_name: null }),
  node({ id: 'apps', code: 'APPS', name: 'Apps', kind: 'group', company_id: null, company_name: null, parent_id: 'it', status: 'disabled', depth: 1 }),
  node({ id: 'it-200', code: 'IT-200', name: 'Applications', parent_id: 'apps', depth: 2 }),
  node({ id: 'it-100', code: 'IT-100', name: 'Infrastructure', parent_id: 'it', status: 'disabled', depth: 1 }),
  node({ id: 'lg-10', code: 'LG-10', name: 'Logistics IT' }),
];

describe('buildCostCenterTree', () => {
  it('returns the node and every descendant, disabled nodes included', () => {
    const tree = buildCostCenterTree(NODES);
    expect([...tree.descendantIds('it')].sort()).toEqual(['apps', 'it', 'it-100', 'it-200']);
    expect([...tree.descendantIds('apps')].sort()).toEqual(['apps', 'it-200']);
  });

  it('returns the leaf alone and nothing for an unknown id', () => {
    const tree = buildCostCenterTree(NODES);
    expect([...tree.descendantIds('lg-10')]).toEqual(['lg-10']);
    expect(tree.descendantIds('missing').size).toBe(0);
  });

  it('indexes the nodes and reports whether the tenant has any', () => {
    const tree = buildCostCenterTree(NODES);
    expect(tree.hasAny).toBe(true);
    expect(tree.byId.get('it-200')?.code).toBe('IT-200');
    expect(tree.nodes.map((n) => n.id)).toEqual(NODES.map((n) => n.id));
    const empty = buildCostCenterTree([]);
    expect(empty.hasAny).toBe(false);
    expect(empty.descendantIds('it').size).toBe(0);
  });

  it('does not loop on a cycle in a bad payload', () => {
    const tree = buildCostCenterTree([
      node({ id: 'a', code: 'A', name: 'A', kind: 'group', parent_id: 'b' }),
      node({ id: 'b', code: 'B', name: 'B', kind: 'group', parent_id: 'a' }),
    ]);
    expect([...tree.descendantIds('a')].sort()).toEqual(['a', 'b']);
  });

  it('reports a failed load without claiming the tenant has no node', () => {
    const failed = buildCostCenterTree([], true, true);
    expect(failed.isError).toBe(true);
    expect(failed.ready).toBe(true);
    expect(buildCostCenterTree(NODES).isError).toBe(false);
  });
});
