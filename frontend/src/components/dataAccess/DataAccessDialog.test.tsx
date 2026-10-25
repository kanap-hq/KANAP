import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../design';

const t = vi.hoisted(() => (key: string, options?: Record<string, unknown>) => (
  options ? `${key}|${JSON.stringify(options)}` : key
));
const post = vi.hoisted(() => vi.fn());
const put = vi.hoisted(() => vi.fn());
const get = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: () => true, profile: { id: 'me' }, dataAccess: { mode: 'all', nodes: [] } }),
}));
vi.mock('../../api', () => ({ default: { get, post, put, delete: vi.fn() } }));
vi.mock('../../i18n/useLocale', () => ({ useLocale: () => 'en' }));
vi.mock('../fields/CompanySelect', () => ({
  default: (props: { onChange: (id: string | null, company?: { id: string; name: string } | null) => void }) => (
    <button type="button" onClick={() => props.onChange('co-2', { id: 'co-2', name: 'Beta Spain' })}>pick company</button>
  ),
}));
vi.mock('../fields/CostCenterSelect', () => ({
  default: (props: { onChange: (id: string | null, node: unknown) => void }) => (
    <button
      type="button"
      onClick={() => props.onChange('cc-2', { id: 'cc-2', code: 'OPS', name: 'Operations', kind: 'cost_center' })}
    >
      pick cost center
    </button>
  ),
}));
vi.mock('../../hooks/useCostCenterTree', () => ({
  useCostCenterTree: () => ({
    ready: true,
    nodes: [],
    byId: new Map(),
    hasAny: true,
    isError: false,
    descendantIds: () => new Set(),
  }),
}));

import DataAccessDialog from './DataAccessDialog';

const PERSON_ACCESS = {
  mode: 'limited',
  nodes: [
    { type: 'company', id: 'co-1', name: 'Alpha Spain', access: 'edit' },
    { type: 'cost_center', id: 'cc-1', name: 'Infrastructure', code: 'INF', kind: 'group', access: 'read' },
  ],
  updated_at: '2026-11-12T10:00:00.000Z',
  updated_by_name: 'Claire Dubois',
  is_administrator: false,
  available: true,
  budget_owner_centers: [{ id: 'cc-9', code: 'FIN', name: 'Finance' }],
};

const PREVIEW = { lines: 312, editable_lines: 280, contracts: 45 };

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>
        <KanapDialogProvider>
          <MemoryRouter>
            <DataAccessDialog open userId="u-1" personName="Marta Ruiz" onClose={() => undefined} />
          </MemoryRouter>
        </KanapDialogProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  get.mockResolvedValue({ data: PERSON_ACCESS });
  post.mockResolvedValue({ data: PREVIEW });
  put.mockResolvedValue({ data: PERSON_ACCESS });
});

describe('DataAccessDialog', () => {
  it('lists the nodes with their type and previews the counts', async () => {
    renderDialog();
    expect(await screen.findByText('Alpha Spain')).toBeInTheDocument();
    expect(screen.getByText('admin:dataAccess.types.company')).toBeInTheDocument();
    expect(screen.getByText('admin:dataAccess.types.costCenterGroup')).toBeInTheDocument();
    expect(screen.getByText('admin:dataAccess.alwaysSees')).toBeInTheDocument();
    expect(screen.getByText('admin:dataAccess.appliesTo')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/admin:dataAccess.preview/)).toHaveTextContent('312'));
    expect(screen.getByText(/admin:dataAccess.preview/)).toHaveTextContent('280');
    expect(screen.getByText(/admin:dataAccess.preview/)).toHaveTextContent('45');
    await waitFor(() => expect(post).toHaveBeenLastCalledWith('/users/u-1/data-access/preview', {
      mode: 'limited',
      nodes: [
        { type: 'company', id: 'co-1', access: 'edit' },
        { type: 'cost_center', id: 'cc-1', access: 'read' },
      ],
    }));
    expect(screen.getByText(/admin:dataAccess.modified/)).toHaveTextContent('Claire Dubois');
  });

  it('changes the access of a node and previews it again', async () => {
    renderDialog();
    await screen.findByText('Alpha Spain');
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'admin:dataAccess.accessLabel|{"name":"Alpha Spain"}' }));
    fireEvent.click(screen.getByRole('option', { name: 'admin:dataAccess.access.read' }));
    await waitFor(() => expect(post).toHaveBeenLastCalledWith('/users/u-1/data-access/preview', {
      mode: 'limited',
      nodes: [
        { type: 'company', id: 'co-1', access: 'read' },
        { type: 'cost_center', id: 'cc-1', access: 'read' },
      ],
    }));
  });

  it('adds a company and the person’s own cost centers, then removes a node', async () => {
    renderDialog();
    await screen.findByText('Alpha Spain');
    fireEvent.click(screen.getByRole('button', { name: 'admin:dataAccess.add' }));
    fireEvent.click(screen.getByRole('button', { name: 'pick company' }));
    expect(await screen.findByText('Beta Spain')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'admin:dataAccess.add' }));
    fireEvent.click(screen.getByRole('button', { name: 'admin:dataAccess.addTheirCenters|{"count":1}' }));
    expect(await screen.findByText('Finance')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'admin:dataAccess.remove|{"name":"Beta Spain"}' }));
    expect(screen.queryByText('Beta Spain')).toBeNull();
  });

  it('offers Everything and saves the whole proposed set', async () => {
    renderDialog();
    await screen.findByText('Alpha Spain');
    fireEvent.click(screen.getByRole('button', { name: 'admin:dataAccess.add' }));
    fireEvent.click(screen.getByRole('button', { name: 'admin:dataAccess.types.everything' }));
    expect((await screen.findAllByText('admin:dataAccess.types.everything')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.save' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/users/u-1/data-access', {
      mode: 'limited',
      nodes: [
        { type: 'all', id: null, access: 'read' },
        { type: 'company', id: 'co-1', access: 'edit' },
        { type: 'cost_center', id: 'cc-1', access: 'read' },
      ],
    }));
  });

  it('shows Everything in the name only, with an empty type cell', async () => {
    renderDialog();
    await screen.findByText('Alpha Spain');
    fireEvent.click(screen.getByRole('button', { name: 'admin:dataAccess.add' }));
    fireEvent.click(screen.getByRole('button', { name: 'admin:dataAccess.types.everything' }));
    const remove = await screen.findByRole('button', {
      name: 'admin:dataAccess.remove|{"name":"admin:dataAccess.types.everything"}',
    });
    const row = remove.closest('li');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getAllByText('admin:dataAccess.types.everything')).toHaveLength(1);
  });

  it('asks before going back to all data, and keeps the limited access when refused', async () => {
    renderDialog();
    await screen.findByText('Alpha Spain');
    fireEvent.click(screen.getByRole('radio', { name: 'admin:dataAccess.allData' }));
    const confirm = (await screen.findAllByRole('dialog')).slice(-1)[0] as HTMLElement;
    expect(within(confirm).getByText(/admin:dataAccess.confirmAll/)).toBeInTheDocument();
    fireEvent.click(within(confirm).getByRole('button', { name: 'buttons.cancel' }));
    await waitFor(() => expect(screen.queryAllByRole('dialog')).toHaveLength(1));
    expect(screen.getByText('Alpha Spain')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'admin:dataAccess.allData' }));
    const again = (await screen.findAllByRole('dialog')).slice(-1)[0] as HTMLElement;
    fireEvent.click(within(again).getByRole('button', { name: 'admin:dataAccess.allData' }));
    await waitFor(() => expect(screen.queryByText('Alpha Spain')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.save' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/users/u-1/data-access', { mode: 'all', nodes: [] }));
  });

  it('switches an all-data person to a limited access', async () => {
    get.mockResolvedValue({ data: { ...PERSON_ACCESS, mode: 'all', nodes: [] } });
    renderDialog();
    await screen.findByRole('radio', { name: 'admin:dataAccess.limitedTo' });
    fireEvent.click(screen.getByRole('radio', { name: 'admin:dataAccess.limitedTo' }));
    expect(await screen.findByRole('button', { name: 'admin:dataAccess.add' })).toBeInTheDocument();
    await waitFor(() => expect(post).toHaveBeenLastCalledWith('/users/u-1/data-access/preview', {
      mode: 'limited',
      nodes: [],
    }));
  });

  it('shows the administrator sentence without a command', async () => {
    get.mockResolvedValue({ data: { ...PERSON_ACCESS, is_administrator: true, mode: 'all', nodes: [] } });
    renderDialog();
    expect(await screen.findByText('admin:dataAccess.administratorsSeeAll')).toBeInTheDocument();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByRole('button', { name: 'common:buttons.save' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.close' }));
  });

  it('disables “Limited to” and the save while the function is unavailable', async () => {
    get.mockResolvedValue({ data: { ...PERSON_ACCESS, available: false } });
    renderDialog();
    expect(await screen.findByText('admin:dataAccess.unavailable')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'admin:dataAccess.guide' })).toHaveAttribute(
      'href',
      expect.stringContaining('data-access'),
    );
    expect(screen.getByRole('radio', { name: 'admin:dataAccess.limitedTo' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'common:buttons.save' })).toBeDisabled();
  });

  it('shows a server refusal inline and keeps the dialog open', async () => {
    put.mockRejectedValueOnce({
      response: { status: 409, data: { code: 'DATA_ACCESS_UNAVAILABLE', message: 'Data-scoped access is unavailable.' } },
    });
    renderDialog();
    await screen.findByText('Alpha Spain');
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.save' }));
    expect(await screen.findByText(/errors:DATA_ACCESS_UNAVAILABLE/)).toBeInTheDocument();
    expect(screen.getByText('Alpha Spain')).toBeInTheDocument();
  });
});
