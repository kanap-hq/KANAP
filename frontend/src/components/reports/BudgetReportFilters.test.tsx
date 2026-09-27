import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigationType } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { createAppTheme } from '../../config/ThemeContext';
import type { CostCenterNode } from '../../services/costCenters';

vi.mock('../../api', () => ({ default: { get: vi.fn() } }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => false }) }));
const treeState = vi.hoisted(() => ({ nodes: [] as unknown[], ready: true, isError: false }));
vi.mock('../../hooks/useCostCenterTree', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/useCostCenterTree')>();
  return {
    ...actual,
    useCostCenterTree: () => ({
      ...actual.buildCostCenterTree(treeState.nodes as CostCenterNode[], treeState.ready),
      isError: treeState.isError,
    }),
  };
});

import {
  BudgetReportFilters,
  type BudgetReportFilterRow,
  filterBudgetRows,
  useBudgetReportFilters,
} from './BudgetReportFilters';
import { buildCostCenterTree } from '../../hooks/useCostCenterTree';

function node(id: string, patch: Partial<CostCenterNode>): CostCenterNode {
  return {
    id,
    code: id.toUpperCase(),
    name: `Node ${id}`,
    kind: 'cost_center',
    parent_id: null,
    company_id: 'co-1',
    company_name: 'Company',
    owner_user_id: null,
    owner_name: null,
    status: 'enabled',
    disabled_at: null,
    sort_order: 0,
    depth: 0,
    path: `Node ${id}`,
    path_ids: [id],
    ...patch,
  };
}

// grp › (cc1, cc2 disabled, sub › cc3); out stands alone.
const NODES: CostCenterNode[] = [
  node('grp', { kind: 'group', company_id: null, name: 'IT department' }),
  node('cc1', { parent_id: 'grp', depth: 1, path_ids: ['grp', 'cc1'] }),
  node('cc2', { parent_id: 'grp', depth: 1, path_ids: ['grp', 'cc2'], status: 'disabled' }),
  node('sub', { kind: 'group', company_id: null, parent_id: 'grp', depth: 1, path_ids: ['grp', 'sub'] }),
  node('cc3', { parent_id: 'sub', depth: 2, path_ids: ['grp', 'sub', 'cc3'] }),
  node('out', {}),
];

type Row = BudgetReportFilterRow & { id: string };
const ROWS: Row[] = [
  { id: 'a', cost_center_id: 'cc1', run_build: 'run' },
  { id: 'b', cost_center_id: 'cc2', run_build: 'build' },
  { id: 'c', cost_center_id: 'cc3', run_build: null },
  { id: 'd', cost_center_id: 'out', run_build: 'run' },
  { id: 'e', cost_center_id: null, run_build: 'build' },
  { id: 'f' },
];

const ids = (rows: Row[] | undefined) => (rows ?? []).map((row) => row.id);

describe('filterBudgetRows', () => {
  const tree = buildCostCenterTree(NODES);

  it('keeps the lines of a group and of every node below it, disabled ones included', () => {
    expect(ids(filterBudgetRows(ROWS, { costCenterIds: tree.descendantIds('grp'), runBuild: null }))).toEqual(['a', 'b', 'c']);
    expect(ids(filterBudgetRows(ROWS, { costCenterIds: tree.descendantIds('sub'), runBuild: null }))).toEqual(['c']);
    expect(ids(filterBudgetRows(ROWS, { costCenterIds: tree.descendantIds('cc2'), runBuild: null }))).toEqual(['b']);
  });

  it('reads run, build and not set, alone or with a node', () => {
    expect(ids(filterBudgetRows(ROWS, { costCenterIds: null, runBuild: 'run' }))).toEqual(['a', 'd']);
    expect(ids(filterBudgetRows(ROWS, { costCenterIds: null, runBuild: 'build' }))).toEqual(['b', 'e']);
    expect(ids(filterBudgetRows(ROWS, { costCenterIds: null, runBuild: 'none' }))).toEqual(['c', 'f']);
    expect(ids(filterBudgetRows(ROWS, { costCenterIds: tree.descendantIds('grp'), runBuild: 'none' }))).toEqual(['c']);
  });

  it('returns the same lines when nothing is picked', () => {
    expect(filterBudgetRows(ROWS, { costCenterIds: null, runBuild: null })).toBe(ROWS);
  });
});

const seen = vi.hoisted(() => ({ search: '', kept: [] as string[], navigation: '' }));

function Harness({ rows }: { rows: Row[] }) {
  const filters = useBudgetReportFilters();
  const location = useLocation();
  seen.search = location.search;
  seen.navigation = useNavigationType();
  seen.kept = ids(filters.filterRows(rows));
  return (
    <div data-testid="bar">
      <BudgetReportFilters filters={filters} rows={rows} />
    </div>
  );
}

function renderBar(path: string, rows: Row[] = ROWS) {
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <MemoryRouter initialEntries={[path]}>
        <Harness rows={rows} />
      </MemoryRouter>
    </ThemeProvider>,
  );
}

const costCenterInput = () => within(screen.getByTestId('bar')).queryByPlaceholderText('All cost centers') as HTMLInputElement | null;
const runBuildSelect = () => screen.queryByRole('combobox', { name: 'Run or build' });

beforeEach(() => {
  treeState.nodes = NODES;
  treeState.ready = true;
  treeState.isError = false;
  seen.search = '';
  seen.kept = [];
  seen.navigation = '';
});

describe('BudgetReportFilters', () => {
  it('renders nothing when the tenant has no node and no line says run or build', () => {
    treeState.nodes = [];
    renderBar('/report', [{ id: 'x', cost_center_id: null, run_build: null }]);
    expect(screen.getByTestId('bar')).toBeEmptyDOMElement();
    expect(seen.kept).toEqual(['x']);
  });

  it('shows the run or build picker without nodes when a line has a value, or when the address asks', () => {
    treeState.nodes = [];
    const view = renderBar('/report', [{ id: 'x', run_build: 'build' }]);
    expect(runBuildSelect()).toBeInTheDocument();
    expect(costCenterInput()).toBeNull();
    view.unmount();

    renderBar('/report?runBuild=none', [{ id: 'x', run_build: null }]);
    expect(runBuildSelect()?.textContent).toBe('Not set');
  });

  it('shows the node picker, and not the run or build one, when no line has a value', () => {
    renderBar('/report', [{ id: 'x', cost_center_id: 'cc1', run_build: null }]);
    expect(costCenterInput()).toBeInTheDocument();
    expect(runBuildSelect()).toBeNull();
  });

  it('reads a group from the address and keeps the lines below it', () => {
    renderBar('/report?costCenter=grp');
    expect(costCenterInput()?.value).toBe('GRP · IT department');
    expect(seen.kept).toEqual(['a', 'b', 'c']);
  });

  it('shows no line until the tree is loaded', () => {
    treeState.ready = false;
    renderBar('/report?costCenter=grp');
    expect(seen.kept).toEqual([]);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows no line and says why for a node the tree does not hold, and clears it', async () => {
    renderBar('/report?costCenter=gone&scope=capex');
    expect(costCenterInput()?.value).toBe('');
    expect(seen.kept).toEqual([]);
    expect(screen.getByRole('status').textContent).toContain('This cost center no longer exists or could not be loaded.');

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Clear filter' })); });
    expect(new URLSearchParams(seen.search).has('costCenter')).toBe(false);
    expect(new URLSearchParams(seen.search).get('scope')).toBe('capex');
    expect(seen.navigation).toBe('REPLACE');
    expect(seen.kept).toEqual(ids(ROWS));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows no line and says why when the tree failed to load, even with nothing else to show', () => {
    treeState.nodes = [];
    treeState.isError = true;
    renderBar('/report?costCenter=grp', [{ id: 'x', cost_center_id: 'cc1', run_build: null }]);
    expect(seen.kept).toEqual([]);
    expect(costCenterInput()).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('This cost center no longer exists or could not be loaded.');
  });

  it('does not filter or complain about a failed tree when the address names no node', () => {
    treeState.nodes = [];
    treeState.isError = true;
    renderBar('/report', [{ id: 'x', cost_center_id: 'cc1', run_build: null }]);
    expect(seen.kept).toEqual(['x']);
    expect(screen.getByTestId('bar')).toBeEmptyDOMElement();
  });

  it('writes both picks to the address and clears them', async () => {
    renderBar('/report?scope=capex');

    const input = costCenterInput() as HTMLInputElement;
    fireEvent.mouseDown(input);
    fireEvent.change(input, { target: { value: 'sub' } });
    // A group is a pick in a report; the search keeps its ancestors so the list still reads as a tree.
    const option = await screen.findByTestId('cost-center-option-sub');
    fireEvent.click(option);
    expect(new URLSearchParams(seen.search).get('costCenter')).toBe('sub');
    // Filter changes replace the entry: Back leaves the report instead of stepping through picks.
    expect(seen.navigation).toBe('REPLACE');
    expect(new URLSearchParams(seen.search).get('scope')).toBe('capex');
    expect(seen.kept).toEqual(['c']);

    const select = runBuildSelect() as HTMLElement;
    fireEvent.mouseDown(select);
    const listbox = screen.getByRole('listbox');
    expect(within(listbox).getAllByRole('option').map((o) => o.textContent)).toEqual(['All', 'Run', 'Build', 'Not set']);
    fireEvent.click(within(listbox).getByRole('option', { name: 'Not set' }));
    expect(new URLSearchParams(seen.search).get('runBuild')).toBe('none');
    expect(seen.navigation).toBe('REPLACE');
    expect(seen.kept).toEqual(['c']);

    fireEvent.mouseDown(runBuildSelect() as HTMLElement);
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Build' }));
    expect(new URLSearchParams(seen.search).get('runBuild')).toBe('build');
    expect(seen.kept).toEqual([]);

    fireEvent.mouseDown(runBuildSelect() as HTMLElement);
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'All' }));
    expect(new URLSearchParams(seen.search).has('runBuild')).toBe(false);

    const clear = within(screen.getByTestId('bar')).getByTitle('Clear');
    await act(async () => { fireEvent.click(clear); });
    expect(new URLSearchParams(seen.search).has('costCenter')).toBe(false);
    expect(seen.kept).toEqual(ids(ROWS));
  });

  it('lists a disabled node and lets a report pick it', async () => {
    renderBar('/report');
    const input = costCenterInput() as HTMLInputElement;
    fireEvent.mouseDown(input);
    const option = await screen.findByTestId('cost-center-option-cc2');
    expect(option.closest('li')).not.toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(option);
    expect(new URLSearchParams(seen.search).get('costCenter')).toBe('cc2');
    expect(seen.kept).toEqual(['b']);
  });
});
