import { describe, expect, it } from 'vitest';
import { expandCostCenterOutline, type CostCenterOutline } from './costCenters';

const raw = (id: string, parent_id: string | null, patch: Partial<CostCenterOutline['nodes'][number]> = {}) => ({
  id,
  code: id.toUpperCase(),
  name: `Node ${id}`,
  kind: 'cost_center' as const,
  parent_id,
  company_id: null,
  owner_user_id: null,
  status: 'enabled' as const,
  ...patch,
});

describe('expandCostCenterOutline', () => {
  it('derives depth, path and ancestors from the order, and the names from the two maps', () => {
    const nodes = expandCostCenterOutline({
      nodes: [
        raw('grp', null, { kind: 'group', name: 'IT' }),
        raw('sub', 'grp', { kind: 'group', name: 'Apps' }),
        raw('cc1', 'sub', { name: 'ERP', company_id: 'co-1', owner_user_id: 'u-1' }),
        raw('cc2', 'grp', { name: 'Network', company_id: 'co-2', status: 'disabled' }),
        raw('out', null, { name: 'Logistics', company_id: 'co-1' }),
      ],
      companies: { 'co-1': 'Paris SA', 'co-2': 'Brussels SA' },
      owners: { 'u-1': 'Ada Holder' },
    });
    expect(nodes.map((n) => [n.id, n.depth, n.path, n.path_ids])).toEqual([
      ['grp', 0, 'IT', ['grp']],
      ['sub', 1, 'IT › Apps', ['grp', 'sub']],
      ['cc1', 2, 'IT › Apps › ERP', ['grp', 'sub', 'cc1']],
      ['cc2', 1, 'IT › Network', ['grp', 'cc2']],
      ['out', 0, 'Logistics', ['out']],
    ]);
    expect(nodes.find((n) => n.id === 'cc1')).toMatchObject({
      company_id: 'co-1', company_name: 'Paris SA', owner_user_id: 'u-1', owner_name: 'Ada Holder', status: 'enabled',
    });
    expect(nodes.find((n) => n.id === 'cc2')).toMatchObject({ company_name: 'Brussels SA', owner_name: null, status: 'disabled' });
    expect(nodes[0]).toMatchObject({ company_id: null, company_name: null });
  });

  it('reads a node whose parent is missing or comes after it as a root, as the server orders them', () => {
    const nodes = expandCostCenterOutline({
      nodes: [raw('orphan', 'gone'), raw('a', 'b'), raw('b', 'a')],
      companies: {},
      owners: {},
    });
    expect(nodes.map((n) => [n.id, n.depth, n.path_ids])).toEqual([
      ['orphan', 0, ['orphan']],
      ['a', 0, ['a']],
      ['b', 1, ['a', 'b']],
    ]);
    // The parent link stays as sent: the subtree of a report filter follows it.
    expect(nodes[0].parent_id).toBe('gone');
  });

  it('reads a missing or malformed answer as an empty tree', () => {
    expect(expandCostCenterOutline(undefined)).toEqual([]);
    expect(expandCostCenterOutline({} as CostCenterOutline)).toEqual([]);
    // The former shape (`items`) of an older server.
    expect(expandCostCenterOutline({ items: [] } as unknown as CostCenterOutline)).toEqual([]);
  });
});
