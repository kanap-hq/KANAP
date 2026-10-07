import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../../components/design';
import type { CoaListItem } from './useCoaList';

const state = vi.hoisted(() => ({
  level: 'admin' as 'reader' | 'member' | 'admin',
  coas: [] as any[],
  impact: { matched: 0, outside: 0, unmapped: 0 },
  bulkResult: { deleted: [] as string[], failed: [] as any[] },
}));

const api = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
  post: vi.fn(),
}));

vi.mock('../../api', () => ({ default: api }));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    hasLevel: (_resource: string, level: string) => {
      const rank: Record<string, number> = { reader: 1, member: 3, manager: 3, admin: 4 };
      return rank[state.level] >= rank[level];
    },
  }),
}));

import ManageCoAsDialog from './ManageCoAsDialog';

function chart(overrides: Partial<CoaListItem>): CoaListItem {
  return {
    id: 'x',
    code: 'X',
    name: 'X',
    country_iso: null,
    scope: 'COUNTRY',
    is_default: false,
    is_global_default: false,
    is_consolidation: false,
    companies_count: 0,
    accounts_count: 0,
    accounts_unmapped_count: 0,
    accounts_outside_count: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

const FR = chart({ id: 'fr', code: 'FR-PCG', name: 'Plan comptable général', country_iso: 'FR', is_default: true, companies_count: 2, accounts_count: 512 });
const IFRS = chart({ id: 'ifrs', code: 'IFRS', name: 'IFRS group accounts', scope: 'GLOBAL', is_global_default: true, is_consolidation: true, accounts_count: 14 });
const DE = chart({ id: 'de', code: 'DE-SKR', name: 'SKR 04', country_iso: 'DE', accounts_count: 0 });

function renderDialog() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onCoaUpdated = vi.fn();
  const onCoaDeleted = vi.fn();
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={queryClient}>
        <KanapDialogProvider>
          <ManageCoAsDialog open onClose={vi.fn()} onCoaUpdated={onCoaUpdated} onCoaDeleted={onCoaDeleted} />
        </KanapDialogProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
  return { onCoaUpdated, onCoaDeleted };
}

async function row(code: string) {
  return screen.findByTestId(`coa-row-${code}`);
}

async function openMenu(code: string) {
  fireEvent.click(await screen.findByRole('button', { name: `Actions for ${code}` }));
  return screen.findByRole('menu');
}

function menuLabels(menu: HTMLElement) {
  return within(menu).getAllByRole('menuitem').map((item) => item.textContent);
}

/** The confirmation opened by useKanapDialogs (the manage dialog is the first one). */
async function confirmDialog(title: string) {
  const heading = await screen.findByText(title);
  return heading.closest('[role="dialog"]') as HTMLElement;
}

describe('ManageCoAsDialog', () => {
  beforeEach(() => {
    state.level = 'admin';
    state.coas = [DE, FR, IFRS];
    state.impact = { matched: 0, outside: 0, unmapped: 0 };
    state.bulkResult = { deleted: [], failed: [] };
    api.get.mockReset();
    api.patch.mockReset();
    api.delete.mockReset();
    api.get.mockImplementation(async (url: string) => {
      if (url === '/chart-of-accounts') return { data: { items: state.coas } };
      if (url.endsWith('/consolidation-impact')) return { data: state.impact };
      throw new Error(`unexpected GET ${url}`);
    });
    api.patch.mockResolvedValue({ data: {} });
    api.delete.mockImplementation(async (url: string) => (
      url === '/chart-of-accounts/bulk' ? { data: state.bulkResult } : { data: { cleared: true } }
    ));
  });

  it('shows coverage and roles in words, with a dash for a chart without role', async () => {
    renderDialog();

    const fr = await row('FR-PCG');
    expect(fr).toHaveTextContent('France');
    expect(fr).toHaveTextContent('Default for France');
    expect(fr).toHaveTextContent('512');

    const ifrs = await row('IFRS');
    expect(ifrs).toHaveTextContent('All countries');
    expect(ifrs).toHaveTextContent('Default for other countries');
    expect(ifrs).toHaveTextContent('Consolidation chart');

    const de = await row('DE-SKR');
    expect(de).toHaveTextContent('Germany');
    expect(de).toHaveTextContent('–');
    expect(de).not.toHaveTextContent('Default');

    expect(screen.queryByText(/★|⊕/)).not.toBeInTheDocument();
    expect(screen.getByText(/proposed when you create a company in that country/)).toBeInTheDocument();
  });

  it('offers only the actions that apply, worded by the current state', async () => {
    renderDialog();

    const frMenu = await openMenu('FR-PCG');
    expect(menuLabels(frMenu)).toEqual(['Stop being default for France', 'Make consolidation chart', 'Delete']);
    fireEvent.keyDown(frMenu, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());

    const ifrsMenu = await openMenu('IFRS');
    expect(menuLabels(ifrsMenu)).toEqual([
      'Stop being default for other countries',
      'Stop being consolidation chart',
      'Delete',
    ]);
    fireEvent.keyDown(ifrsMenu, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());

    const deMenu = await openMenu('DE-SKR');
    expect(menuLabels(deMenu)).toEqual(['Make default for Germany', 'Make consolidation chart', 'Delete']);
  });

  it('a manager has the role actions but no delete', async () => {
    state.level = 'member';
    renderDialog();
    const menu = await openMenu('FR-PCG');
    expect(menuLabels(menu)).toEqual(['Stop being default for France', 'Make consolidation chart']);
  });

  it('a reader sees the table without any row menu or new chart button', async () => {
    state.level = 'reader';
    renderDialog();
    await row('FR-PCG');
    expect(screen.queryByRole('button', { name: /Actions for/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New chart' })).not.toBeInTheDocument();
  });

  it('toggles the country default and the default for other countries without confirmation', async () => {
    const { onCoaUpdated } = renderDialog();

    fireEvent.click(within(await openMenu('FR-PCG')).getByRole('menuitem', { name: 'Stop being default for France' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/chart-of-accounts/fr', { is_default: false }));
    await waitFor(() => expect(onCoaUpdated).toHaveBeenCalled());

    fireEvent.click(within(await openMenu('IFRS')).getByRole('menuitem', { name: 'Stop being default for other countries' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/chart-of-accounts/ifrs/global-default'));
  });

  it('reads the impact, confirms with the real numbers, then makes the chart the consolidation chart', async () => {
    state.impact = { matched: 40, outside: 3, unmapped: 0 };
    renderDialog();

    fireEvent.click(within(await openMenu('FR-PCG')).getByRole('menuitem', { name: 'Make consolidation chart' }));
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/chart-of-accounts/fr/consolidation-impact'));

    const dialog = await confirmDialog('Make FR-PCG the consolidation chart?');
    expect(dialog).toHaveTextContent('FR-PCG replaces IFRS as the consolidation chart.');
    expect(dialog).toHaveTextContent('40 accounts keep their consolidation account.');
    expect(dialog).toHaveTextContent('3 accounts point to a number that does not exist in FR-PCG: they will be flagged so you can remap them.');
    expect(dialog).not.toHaveTextContent('have no consolidation account');
    expect(api.patch).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Make consolidation chart' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/chart-of-accounts/fr/consolidation', {}));
  });

  it('makes the first consolidation chart without confirmation when nothing falls outside it', async () => {
    state.coas = [DE, FR, { ...IFRS, is_consolidation: false }];
    state.impact = { matched: 0, outside: 0, unmapped: 12 };
    renderDialog();

    fireEvent.click(within(await openMenu('IFRS')).getByRole('menuitem', { name: 'Make consolidation chart' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/chart-of-accounts/ifrs/consolidation', {}));
    expect(screen.queryByText(/the consolidation chart\?/)).not.toBeInTheDocument();
  });

  it('does not change the consolidation chart when the confirmation is cancelled', async () => {
    state.impact = { matched: 1, outside: 0, unmapped: 0 };
    renderDialog();

    fireEvent.click(within(await openMenu('FR-PCG')).getByRole('menuitem', { name: 'Make consolidation chart' }));
    const dialog = await confirmDialog('Make FR-PCG the consolidation chart?');
    expect(dialog).toHaveTextContent('1 account keeps its consolidation account.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Make FR-PCG the consolidation chart?')).not.toBeInTheDocument());
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('confirms before removing the consolidation role', async () => {
    renderDialog();

    fireEvent.click(within(await openMenu('IFRS')).getByRole('menuitem', { name: 'Stop being consolidation chart' }));
    const dialog = await confirmDialog('Stop using IFRS as the consolidation chart?');
    expect(dialog).toHaveTextContent('Account mappings are kept.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stop being consolidation chart' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/chart-of-accounts/ifrs/consolidation'));
  });

  it('deletes a chart without accounts directly', async () => {
    state.bulkResult = { deleted: ['de'], failed: [] };
    const { onCoaDeleted } = renderDialog();

    fireEvent.click(within(await openMenu('DE-SKR')).getByRole('menuitem', { name: 'Delete' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/chart-of-accounts/bulk', { data: { ids: ['de'] } }));
    expect(onCoaDeleted).toHaveBeenCalledWith('de');
    expect(screen.queryByText('Delete DE-SKR?')).not.toBeInTheDocument();
  });

  it('confirms the deletion of a chart with accounts, naming the count and the consolidation role', async () => {
    state.bulkResult = { deleted: ['ifrs'], failed: [] };
    renderDialog();

    fireEvent.click(within(await openMenu('IFRS')).getByRole('menuitem', { name: 'Delete' }));
    const dialog = await confirmDialog('Delete IFRS?');
    expect(dialog).toHaveTextContent('IFRS has 14 accounts. They are deleted with the chart.');
    expect(dialog).toHaveTextContent('IFRS is the consolidation chart: the role is removed');
    expect(api.delete).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete anyway' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/chart-of-accounts/bulk', { data: { ids: ['ifrs'] } }));
  });

  it('shows the refusal of the server inline', async () => {
    state.bulkResult = { deleted: [], failed: [{ id: 'de', name: 'DE-SKR', reason: 'Cannot delete: 2 companies reference this Chart of Accounts' }] };
    const { onCoaDeleted } = renderDialog();

    fireEvent.click(within(await openMenu('DE-SKR')).getByRole('menuitem', { name: 'Delete' }));
    expect(await screen.findByText('DE-SKR was not deleted. Cannot delete: 2 companies reference this Chart of Accounts')).toBeInTheDocument();
    expect(onCoaDeleted).not.toHaveBeenCalled();
  });
});
