import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import type { CostCenterNode } from '../../services/costCenters';

// `requested`: the `enabled` of every read of the tree; a disabled read gets nothing, as a tree never loaded.
const treeState = vi.hoisted(() => ({ nodes: [] as unknown[], isError: false, pending: false, requested: [] as boolean[] }));
const auth = vi.hoisted(() => ({ canCreate: true }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: () => auth.canCreate }),
}));
vi.mock('../../hooks/useCostCenterTree', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/useCostCenterTree')>();
  return {
    ...actual,
    useCostCenterTree: (options?: { enabled?: boolean }) => {
      const enabled = options?.enabled ?? true;
      treeState.requested.push(enabled);
      return enabled && !treeState.pending
        ? actual.buildCostCenterTree(treeState.nodes as CostCenterNode[], true, treeState.isError)
        : actual.buildCostCenterTree([], false);
    },
  };
});

import CostCenterSelect from './CostCenterSelect';

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

// Group IT > IT-100, IT-200 (disabled) ; group GRP > GRP-FR ; LG-10 standalone
const NODES: CostCenterNode[] = [
  node({ id: 'it', code: 'IT', name: 'IT department', kind: 'group', company_id: null }),
  node({ id: 'it-100', code: 'IT-100', name: 'Infrastructure', parent_id: 'it', depth: 1, path: 'IT department › Infrastructure', path_ids: ['it', 'it-100'] }),
  node({ id: 'it-200', code: 'IT-200', name: 'Applications', parent_id: 'it', depth: 1, status: 'disabled', path: 'IT department › Applications', path_ids: ['it', 'it-200'] }),
  node({ id: 'grp', code: 'GRP', name: 'Group IT', kind: 'group', company_id: null }),
  node({ id: 'grp-fr', code: 'GRP-FR', name: 'France', parent_id: 'grp', depth: 1, path: 'Group IT › France', path_ids: ['grp', 'grp-fr'] }),
  node({ id: 'lg-10', code: 'LG-10', name: 'Logistics IT' }),
];

function renderSelect(props: Partial<React.ComponentProps<typeof CostCenterSelect>> = {}) {
  const onChange = vi.fn();
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <MemoryRouter>
        <CostCenterSelect value={null} onChange={onChange} {...props} />
      </MemoryRouter>
    </ThemeProvider>,
  );
  return { onChange, input: screen.getByRole('combobox') };
}

function open(input: HTMLElement) {
  fireEvent.mouseDown(input);
  fireEvent.keyDown(input, { key: 'ArrowDown' });
}

function option(id: string): HTMLElement {
  return screen.getByTestId(`cost-center-option-${id}`).closest('li') as HTMLElement;
}

function shownIds(): string[] {
  return within(screen.getByRole('listbox'))
    .queryAllByTestId(/cost-center-option-/)
    .map((el) => el.getAttribute('data-testid')!.replace('cost-center-option-', ''));
}

describe('CostCenterSelect', () => {
  beforeEach(() => {
    treeState.nodes = NODES;
    treeState.isError = false;
    treeState.requested = [];
    treeState.pending = false;
    auth.canCreate = true;
  });

  it('names the combobox after its label when the label is hidden, not after the placeholder', () => {
    renderSelect({ hideLabel: true });
    expect(screen.getByRole('combobox', { name: 'selects.costCenter' })).toHaveAttribute('placeholder', 'selects.notSet');
  });

  it('lists the tree in order, each option indented by its depth, labeled code · name', () => {
    const { input } = renderSelect();
    open(input);
    expect(shownIds()).toEqual(['it', 'it-100', 'it-200', 'grp', 'grp-fr', 'lg-10']);
    expect(screen.getByTestId('cost-center-option-it').getAttribute('data-depth')).toBe('0');
    expect(screen.getByTestId('cost-center-option-it-100').getAttribute('data-depth')).toBe('1');
    expect(screen.getByTestId('cost-center-option-it-100')).toHaveStyle({ paddingLeft: '16px' });
    expect(screen.getByTestId('cost-center-option-it')).toHaveStyle({ paddingLeft: '0px' });
    expect(option('it-100')).toHaveTextContent('IT-100 · Infrastructure');
  });

  it('shows groups without letting them be picked for a line', () => {
    const { input, onChange } = renderSelect();
    open(input);
    expect(option('it')).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(option('it'));
    expect(onChange).not.toHaveBeenCalled();
    open(input);
    fireEvent.click(option('it-100'));
    expect(onChange).toHaveBeenCalledWith('it-100', expect.objectContaining({ code: 'IT-100' }));
  });

  it('lets a report pick a group or a disabled node with selectable="all"', () => {
    const { input, onChange } = renderSelect({ selectable: 'all' });
    open(input);
    expect(option('it')).toHaveAttribute('aria-disabled', 'false');
    expect(option('it-200')).toHaveAttribute('aria-disabled', 'false');
    fireEvent.click(option('it'));
    expect(onChange).toHaveBeenCalledWith('it', expect.objectContaining({ kind: 'group' }));
  });

  it('marks a disabled node and refuses it as a new value', () => {
    const { input } = renderSelect();
    open(input);
    expect(option('it-200')).toHaveTextContent('statuses.disabled');
    expect(option('it-200')).toHaveAttribute('aria-disabled', 'true');
    expect(option('it-100')).not.toHaveTextContent('statuses.disabled');
  });

  it('keeps a disabled node pickable when it is the current value', () => {
    const { input } = renderSelect({ value: 'it-200' });
    expect(input).toHaveValue('IT-200 · Applications');
    open(input);
    expect(option('it-200')).toHaveAttribute('aria-disabled', 'false');
  });

  it('searches by code, keeping the ancestors for context', () => {
    const { input } = renderSelect();
    input.focus();
    fireEvent.change(input, { target: { value: 'it-100' } });
    expect(shownIds()).toEqual(['it', 'it-100']);
  });

  it('searches by a group name and shows its descendants', () => {
    const { input } = renderSelect();
    input.focus();
    fireEvent.change(input, { target: { value: 'group it' } });
    expect(shownIds()).toEqual(['grp', 'grp-fr']);
  });

  it('offers only groups, outside the excluded subtree, when picking a parent', () => {
    const { input } = renderSelect({ selectable: 'groups', excludeIds: new Set(['grp', 'grp-fr']) });
    open(input);
    expect(shownIds()).toEqual(['it']);
  });

  it('says there is no cost center yet, with a link for people who can create one', () => {
    treeState.nodes = [];
    const { input } = renderSelect();
    open(input);
    expect(screen.getByText('selects.noCostCenterYet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'selects.createCostCenter' })).toHaveAttribute('href', '/master-data/cost-centers');
  });

  it('adds the line under the list when the tenant only has groups', () => {
    treeState.nodes = [NODES[0]];
    const { input } = renderSelect();
    open(input);
    expect(shownIds()).toEqual(['it']);
    expect(screen.getByText('selects.noCostCenterYet')).toBeInTheDocument();
  });

  it('shows no link to people who cannot create one', () => {
    treeState.nodes = [];
    auth.canCreate = false;
    const { input } = renderSelect();
    open(input);
    expect(screen.getByText('selects.noCostCenterYet')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('matches the label as the list shows it', () => {
    const { input } = renderSelect();
    input.focus();
    fireEvent.change(input, { target: { value: 'IT-100 · Infra' } });
    expect(shownIds()).toEqual(['it', 'it-100']);
  });

  it('says the tree could not be loaded instead of claiming there is no cost center', () => {
    treeState.nodes = [];
    treeState.isError = true;
    const { input } = renderSelect();
    open(input);
    expect(screen.getByText('selects.costCentersLoadFailed')).toBeInTheDocument();
    expect(screen.queryByText('selects.noCostCenterYet')).toBeNull();
  });

  it('loads nothing until the list is opened', () => {
    const { input } = renderSelect();
    expect(treeState.requested.every((enabled) => !enabled)).toBe(true);
    open(input);
    expect(treeState.requested[treeState.requested.length - 1]).toBe(true);
    expect(shownIds()).toEqual(['it', 'it-100', 'it-200', 'grp', 'grp-fr', 'lg-10']);
  });

  it('shows a value the caller names without the tree, then the tree once opened', () => {
    const known = {
      id: 'it-100', code: 'IT-100', name: 'Infrastructure', kind: 'cost_center' as const, status: 'enabled' as const,
      company_id: 'company-1', company_name: 'Company one', owner_user_id: null, owner_name: null,
    };
    const { input } = renderSelect({ value: 'it-100', selectedOption: known });
    expect(input).toHaveValue('IT-100 · Infrastructure');
    expect(treeState.requested.every((enabled) => !enabled)).toBe(true);
    open(input);
    expect(treeState.requested[treeState.requested.length - 1]).toBe(true);
    expect(option('it-100')).toHaveAttribute('aria-selected', 'true');
  });

  it('loads the tree to name a value the caller does not know', () => {
    const { input } = renderSelect({
      value: 'lg-10',
      // Another node: the caller's label is not this value's.
      selectedOption: { id: 'it-100', code: 'IT-100', name: 'Infrastructure', kind: 'cost_center', status: 'enabled', company_id: null, company_name: null, owner_user_id: null, owner_name: null },
    });
    expect(treeState.requested).toContain(true);
    expect(input).toHaveValue('LG-10 · Logistics IT');
  });

  it('keeps the text typed while the tree loads', () => {
    treeState.pending = true;
    const known = {
      id: 'it-100', code: 'IT-100', name: 'Infrastructure', kind: 'cost_center' as const, status: 'enabled' as const,
      company_id: 'company-1', company_name: 'Company one', owner_user_id: null, owner_name: null,
    };
    const ui = () => (
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter>
          <CostCenterSelect value="it-100" selectedOption={known} onChange={vi.fn()} />
        </MemoryRouter>
      </ThemeProvider>
    );
    const view = render(ui());
    const input = screen.getByRole('combobox');
    input.focus();
    open(input);
    fireEvent.change(input, { target: { value: 'Logis' } });
    expect(input).toHaveValue('Logis');
    // The tree answers: the value is the same node, the typed text stays and filters.
    treeState.pending = false;
    view.rerender(ui());
    expect(input).toHaveValue('Logis');
    expect(shownIds()).toEqual(['lg-10']);
  });
});
