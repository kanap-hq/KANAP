import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import CheckboxSetFilter, { SEARCH_APPLY_DELAY_MS, type CheckboxSetFilterOption } from '../CheckboxSetFilter';
import { costCenterFilterOptions, withCostCenterGroups } from './costCenterFilter';
import { COST_CENTER_TREE_QUERY_KEY } from '../../hooks/useCostCenterTree';
import type { CostCenterNode } from '../../services/costCenters';

const getCostCenterTree = vi.hoisted(() => vi.fn());
vi.mock('../../services/costCenters', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/costCenters')>()),
  getCostCenterTree,
}));

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

const group = (partial: Partial<CostCenterNode> & Pick<CostCenterNode, 'id' | 'code' | 'name'>) =>
  node({ kind: 'group', company_id: null, company_name: null, ...partial });

// Tree order: EU > FR > (Paris, Lyon) ; EU > Berlin ; EU > Madrid (no line) ; New York ; APAC > Tokyo (no line)
const NODES: CostCenterNode[] = [
  group({ id: 'eu', code: 'EU', name: 'Europe' }),
  group({ id: 'fr', code: 'FR', name: 'France', parent_id: 'eu', depth: 1 }),
  node({ id: 'par', code: 'FR-10', name: 'Paris', parent_id: 'fr', depth: 2 }),
  node({ id: 'lyo', code: 'FR-20', name: 'Lyon', parent_id: 'fr', depth: 2 }),
  node({ id: 'ber', code: 'DE-10', name: 'Berlin', parent_id: 'eu', depth: 1 }),
  node({ id: 'mad', code: 'ES-10', name: 'Madrid', parent_id: 'eu', depth: 1 }),
  node({ id: 'nyc', code: 'US-10', name: 'New York' }),
  group({ id: 'apac', code: 'APAC', name: 'Asia Pacific' }),
  node({ id: 'tok', code: 'JP-10', name: 'Tokyo', parent_id: 'apac', depth: 1 }),
];

const EU = { key: 'eu', label: 'EU · Europe' };
const FR = { key: 'fr', label: 'FR · France' };

// What the list's values endpoint answers: the labels the lines hold, sorted, the blank last.
const IN_USE: CheckboxSetFilterOption[] = [
  { value: 'DE-10 · Berlin', label: 'DE-10 · Berlin' },
  { value: 'FR-10 · Paris', label: 'FR-10 · Paris' },
  { value: 'FR-20 · Lyon', label: 'FR-20 · Lyon' },
  { value: 'OLD-1 · Gone', label: 'OLD-1 · Gone' },
  { value: 'US-10 · New York', label: 'US-10 · New York' },
  { value: null, label: 'No cost center' },
];

describe('costCenterFilterOptions', () => {
  it('lays the values out in tree order under their groups, unknown labels then the blank last', () => {
    expect(costCenterFilterOptions(IN_USE, NODES)).toEqual([
      { value: 'FR-10 · Paris', label: 'FR-10 · Paris', groups: [EU, FR] },
      { value: 'FR-20 · Lyon', label: 'FR-20 · Lyon', groups: [EU, FR] },
      { value: 'DE-10 · Berlin', label: 'DE-10 · Berlin', groups: [EU] },
      { value: 'US-10 · New York', label: 'US-10 · New York', groups: [] },
      { value: 'OLD-1 · Gone', label: 'OLD-1 · Gone' },
      { value: null, label: 'No cost center' },
    ]);
  });

  it('keeps the values as they came without a tree', () => {
    expect(costCenterFilterOptions(IN_USE, [])).toBe(IN_USE);
  });
});

describe('withCostCenterGroups', () => {
  beforeEach(() => { getCostCenterTree.mockReset(); });

  it('reads the tree once a line holds a cost center, from the shared cache', async () => {
    getCostCenterTree.mockResolvedValue(NODES);
    const queryClient = new QueryClient();
    const getValues = withCostCenterGroups(async () => IN_USE, queryClient);
    const options = await getValues({} as never);
    expect(options[0]).toMatchObject({ value: 'FR-10 · Paris', groups: [EU, FR] });
    await getValues({} as never);
    expect(getCostCenterTree).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(COST_CENTER_TREE_QUERY_KEY)).toBe(NODES);
  });

  it('asks nothing when no line holds a cost center, and stays flat when the tree fails', async () => {
    const queryClient = new QueryClient();
    const blankOnly = [{ value: null, label: 'No cost center' }];
    expect(await withCostCenterGroups(async () => blankOnly, queryClient)({} as never)).toBe(blankOnly);
    expect(getCostCenterTree).not.toHaveBeenCalled();
    getCostCenterTree.mockRejectedValue(new Error('down'));
    expect(await withCostCenterGroups(async () => IN_USE, queryClient)({} as never)).toBe(IN_USE);
  });
});

type Model = { filterType: 'set'; mode?: 'include' | 'exclude'; values: Array<string | null> } | undefined;
const COL = 'cost_center_label';

/** The filter as the OPEX and CAPEX lists run it: reactive, exclude mode on, values in tree order. */
function renderFilter(exclude = true) {
  let model: Record<string, any> = {};
  const values = costCenterFilterOptions(IN_USE, NODES);
  const queryClient = new QueryClient();
  const column = { getColId: () => COL };
  const api: any = {
    getFilterModel: vi.fn(() => model),
    setFilterModel: vi.fn((next: Record<string, any>) => {
      model = next;
      rerender();
    }),
  };
  const ui = () => (
    <QueryClientProvider client={queryClient}>
      <CheckboxSetFilter
        {...({
          api, column, colDef: { field: COL }, values, model: model[COL], onModelChange: vi.fn(),
          context: { setFilterExcludeMode: exclude },
        } as any)}
      />
    </QueryClientProvider>
  );
  const view = render(ui());
  function rerender() { view.rerender(ui()); }
  return { applied: () => model[COL] as Model };
}

const box = (name: string) => screen.getByRole('checkbox', { name });
const click = (name: string) => fireEvent.click(box(name));
const advance = () => act(() => { vi.advanceTimersByTime(SEARCH_APPLY_DELAY_MS); });
const sorted = (model: Model) => (model ? [...model.values].sort() : model);
const rowLabels = () => screen.getAllByRole('listitem').map((item) => item.textContent);

describe('CheckboxSetFilter with cost center groups', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('shows each group once above its values, groups without a line left out', () => {
    renderFilter();
    expect(rowLabels()).toEqual([
      'EU · Europe', 'FR · France', 'FR-10 · Paris', 'FR-20 · Lyon', 'DE-10 · Berlin',
      'US-10 · New York', 'OLD-1 · Gone', 'No cost center',
    ]);
  });

  it('unticking a group from "All" leaves out every line below it', () => {
    const { applied } = renderFilter();
    click('EU · Europe');
    advance();
    expect(applied()?.mode).toBe('exclude');
    expect(sorted(applied())).toEqual(['DE-10 · Berlin', 'FR-10 · Paris', 'FR-20 · Lyon']);
    expect(box('FR · France')).not.toBeChecked();
    expect(box('US-10 · New York')).toBeChecked();
  });

  it('"Clear" then a group keeps only the lines below it, its parent partly ticked', () => {
    const { applied } = renderFilter();
    fireEvent.click(screen.getByRole('button', { name: /clear/i }));
    click('FR · France');
    advance();
    expect(applied()?.mode).toBeUndefined();
    expect(sorted(applied())).toEqual(['FR-10 · Paris', 'FR-20 · Lyon']);
    expect(box('FR · France')).toBeChecked();
    expect(box('EU · Europe')).toHaveAttribute('data-indeterminate', 'true');
    // The parent's box then ticks the rest of its subtree.
    click('EU · Europe');
    advance();
    expect(sorted(applied())).toEqual(['DE-10 · Berlin', 'FR-10 · Paris', 'FR-20 · Lyon']);
    expect(box('EU · Europe')).toHaveAttribute('data-indeterminate', 'false');
    // Unticking one value unticks its groups.
    click('FR-20 · Lyon');
    advance();
    expect(box('FR · France')).toHaveAttribute('data-indeterminate', 'true');
    expect(sorted(applied())).toEqual(['DE-10 · Berlin', 'FR-10 · Paris']);
  });

  it('a search on a group name lists and applies every value below it', () => {
    const { applied } = renderFilter(false);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'france' } });
    advance();
    expect(rowLabels()).toEqual(['EU · Europe', 'FR · France', 'FR-10 · Paris', 'FR-20 · Lyon']);
    expect(sorted(applied())).toEqual(['FR-10 · Paris', 'FR-20 · Lyon']);
  });
});
