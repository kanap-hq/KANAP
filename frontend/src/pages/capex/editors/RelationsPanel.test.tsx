import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';

vi.mock('react-i18next', () => {
  const translation = { t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } };
  return { useTranslation: () => translation };
});
vi.mock('../../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('../../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));
vi.mock('../../../components/contacts/ItemContactsSection', () => ({ default: () => null }));
vi.mock('../../../components/design', () => ({
  RelevantWebsitesList: () => null,
  useKanapDialogs: () => ({ confirm: vi.fn(async () => true) }),
}));

import api from '../../../api';
import RelationsPanel, { RelationsPanelHandle } from './RelationsPanel';

const mocked = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };

function renderPanel(ref: React.Ref<RelationsPanelHandle>, client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const view = render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>
        <RelationsPanel ref={ref} id="item-1" autoSave={false} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { ...view, client };
}

describe('CAPEX RelationsPanel applications', () => {
  beforeEach(() => {
    mocked.get.mockReset();
    mocked.post.mockReset();
    mocked.get.mockImplementation(async (url: string) => {
      if (url === '/capex-items/item-1/applications') return { data: { items: [{ id: 'app-1', name: 'Payroll' }, { id: 'app-2', name: 'Ledger' }] } };
      if (url.endsWith('/links') || url.endsWith('/attachments')) return { data: [] };
      return { data: { items: [] } };
    });
    mocked.post.mockResolvedValue({ data: {} });
  });

  it('loads the linked applications and saves the new set', async () => {
    const ref = React.createRef<RelationsPanelHandle>();
    renderPanel(ref);

    expect(screen.getByText('capex.relations.applications')).toBeInTheDocument();
    const chip = await screen.findByRole('button', { name: 'Payroll' });
    expect(screen.getByRole('button', { name: 'Ledger' })).toBeInTheDocument();
    expect(mocked.get).toHaveBeenCalledWith('/capex-items/item-1/applications', expect.objectContaining({ signal: expect.any(AbortSignal) }));

    // Unlink one application, then save.
    fireEvent.click(within(chip).getByTestId('CancelIcon'));
    await waitFor(() => expect(ref.current?.isDirty()).toBe(true));
    await act(async () => { await ref.current?.save(); });

    expect(mocked.post).toHaveBeenCalledWith('/capex-items/item-1/applications/bulk-replace', { application_ids: ['app-2'] });
    // Projects and contracts did not change: nothing is posted for them.
    expect(mocked.post).toHaveBeenCalledTimes(1);
  });

  it('never posts a set whose load failed, and keeps it read-only', async () => {
    mocked.get.mockImplementation(async (url: string) => {
      if (url === '/capex-items/item-1/applications') throw new Error('network');
      if (url === '/capex-items/item-1/projects') return { data: { items: [{ id: 'prj-1', name: 'Migration' }] } };
      if (url.endsWith('/links') || url.endsWith('/attachments')) return { data: [] };
      return { data: { items: [] } };
    });
    const ref = React.createRef<RelationsPanelHandle>();
    renderPanel(ref);

    const chip = await screen.findByRole('button', { name: 'Migration' });
    expect(screen.getByText('capex.relations.failedToLoad')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('capex.relations.selectApplications')).toBeDisabled();

    fireEvent.click(within(chip).getByTestId('CancelIcon'));
    await waitFor(() => expect(ref.current?.isDirty()).toBe(true));
    await act(async () => { await ref.current?.save(); });

    expect(mocked.post).toHaveBeenCalledWith('/capex-items/item-1/projects/bulk-replace', { project_ids: [] });
    expect(mocked.post.mock.calls.map((c) => c[0])).not.toContain('/capex-items/item-1/applications/bulk-replace');
    expect(mocked.post).toHaveBeenCalledTimes(1);
  });

  it('posts nothing when no set changed', async () => {
    const ref = React.createRef<RelationsPanelHandle>();
    renderPanel(ref);
    await screen.findByRole('button', { name: 'Payroll' });
    await act(async () => { await ref.current?.save(); });
    expect(mocked.post).not.toHaveBeenCalled();
  });

  it('shows the relations again at once when the tab comes back, without reading them again', async () => {
    // The app's default: a query read less than 30 s ago is fresh.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
    const first = renderPanel(React.createRef<RelationsPanelHandle>(), client);
    await screen.findByRole('button', { name: 'Payroll' });
    const reads = mocked.get.mock.calls.length;
    first.unmount();

    renderPanel(React.createRef<RelationsPanelHandle>(), first.client);
    // Shown on the first render, from the cache: no blank tab, no second read while fresh.
    expect(screen.getByRole('button', { name: 'Payroll' })).toBeInTheDocument();
    expect(mocked.get.mock.calls.length).toBe(reads);
  });

  it('searches contracts on the server as the user types, never page by page', async () => {
    mocked.get.mockImplementation(async (url: string, config?: { params?: Record<string, unknown> }) => {
      if (url === '/contracts/lookup') {
        const q = String(config?.params?.q ?? '');
        const all = [{ id: 'c-1', name: 'Maintenance réseau' }, { id: 'c-2', name: 'Licences' }];
        return { data: { items: all.filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase())), has_more: false } };
      }
      if (url.endsWith('/links') || url.endsWith('/attachments')) return { data: [] };
      return { data: { items: [] } };
    });
    renderPanel(React.createRef<RelationsPanelHandle>());
    const input = await screen.findByPlaceholderText('capex.relations.selectContracts');
    await waitFor(() => expect(input).not.toBeDisabled());
    // Nothing is read for the pickers until one opens.
    expect(mocked.get.mock.calls.map((c) => c[0])).not.toContain('/contracts/lookup');
    expect(mocked.get.mock.calls.map((c) => c[0])).not.toContain('/contracts');

    act(() => { input.focus(); });
    fireEvent.mouseDown(input);
    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith('/contracts/lookup', expect.objectContaining({ params: { limit: 30 } })));
    fireEvent.change(input, { target: { value: 'maint' } });
    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith('/contracts/lookup', expect.objectContaining({ params: { q: 'maint', limit: 30 } })));
    expect(await screen.findByRole('option', { name: 'Maintenance réseau' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Licences' })).toBeNull();
    // One page per search: no `page` parameter, no list endpoint walked page by page.
    expect(mocked.get.mock.calls.filter((c) => c[0] === '/contracts')).toHaveLength(0);
  });
});
