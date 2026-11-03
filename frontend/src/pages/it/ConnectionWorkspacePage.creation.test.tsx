import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../../components/design';
import NavigationTracker, { resetNavigationTracker } from '../../components/navigation/NavigationTracker';
import { resetCreationStore } from '../../components/workspace/creation/creationStore';
import api from '../../api';
import ConnectionWorkspacePage from './ConnectionWorkspacePage';

// Creation at the title (lot 3): the name committed in the header creates the connection (server to
// server, no protocol nor end), the page moves to it; Create names what it still lacks and focuses
// the first field, or closes it; Cancel deletes it.

const translation = {
  t: (key: string, opts?: Record<string, unknown>) => {
    const args = opts ? Object.entries(opts).filter(([k]) => k !== 'defaultValue').map(([k, v]) => `${k}=${v}`).join(',') : '';
    return args ? `${key}(${args})` : key;
  },
  i18n: { language: 'en', resolvedLanguage: 'en' },
};
vi.mock('react-i18next', () => ({ useTranslation: () => translation, initReactI18next: { type: '3rdParty', init: () => undefined } }));
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));
vi.mock('../../hooks/useApplicationClassificationCatalog', () => ({ default: () => ({ data: undefined }) }));
vi.mock('../../hooks/useItOpsEnumOptions', () => {
  const value = {
    settings: { connectionTypes: [{ code: 'https', label: 'HTTPS' }], entities: [] },
    byField: { lifecycleStatus: [{ code: 'active', label: 'Active' }], dataClass: [] },
    labelFor: (_field: string, code: string) => code,
  };
  return { default: () => value };
});
vi.mock('../../hooks/useModuleItemNav', () => ({
  useConnectionItemNav: () => ({ total: 0, index: 0, hasPrev: false, hasNext: false, prevId: null, nextId: null }),
}));
vi.mock('../workspace/hooks/useRecentlyViewed', () => ({ useRecentlyViewed: () => ({ addToRecent: () => undefined }) }));
vi.mock('../../components/workspace/SendLinkButton', () => ({ default: () => null }));
vi.mock('../../components/MarkdownEditor', () => ({ default: () => <div data-testid="description-editor" /> }));
vi.mock('../../components/EntityKnowledgePanel', () => ({ default: () => null }));
vi.mock('./workspace/ConnectionLinkInterfacesDialog', () => ({ default: () => null }));
vi.mock('./workspace/ConnectionEndpointPicker', () => ({ default: ({ label }: { label: string }) => <input aria-label={label} /> }));
vi.mock('./workspace/ConnectionServersPicker', () => ({ default: () => <input aria-label="servers" /> }));
vi.mock('./workspace/ConnectionProtocolsTable', () => ({ default: () => null }));

const mocked = vi.mocked(api);
const TITLE = 'common:buttons.editTitle';
const created = {
  id: 'conn-new',
  connection_reference: 'CONN-7',
  name: 'Web to db',
  topology: 'server_to_server',
  source_asset_id: null,
  source_entity_code: null,
  destination_asset_id: null,
  destination_entity_code: null,
  protocol_codes: [],
  creation_token: 'token-1',
};
const detail = {
  ...created,
  creation_token: undefined,
  description: null,
  source_server: null,
  destination_server: null,
  servers: [],
  protocols: [],
  lifecycle: 'active',
  criticality: '',
  data_class: '',
  contains_pii: false,
  risk_mode: 'manual',
  effective_criticality: '',
  effective_data_class: '',
  effective_contains_pii: false,
  derived_interface_count: 0,
  legs: [],
  created_at: '2026-11-03T08:00:00.000Z',
  updated_at: '2026-11-03T08:00:00.000Z',
};

function Location() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function StartPage() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate('/it/connections/new/overview')}>new connection</button>;
}

function renderPage(entries: string[], changes: { fields: number; children: Record<string, number> } = { fields: 0, children: {} }) {
  mocked.get.mockImplementation(async (url: string) => {
    if (url === '/connections/CONN-7' || url === '/connections/conn-new') return { data: detail } as never;
    if (url === '/connections/conn-new/creation') return { data: { changes } } as never;
    return { data: { items: [], total: 0 } } as never;
  });
  mocked.post.mockImplementation(async (url: string) => {
    if (url === '/connections/creation') return { data: created } as never;
    return { data: { ok: true } } as never;
  });
  mocked.delete.mockResolvedValue({ data: undefined } as never);
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider theme={createAppTheme('light')}>
        <KanapDialogProvider>
          <MemoryRouter initialEntries={entries}>
            <NavigationTracker />
            <Location />
            <Routes>
              <Route path="/start" element={<StartPage />} />
              <Route path="/it/connections" element={<div data-testid="connection-list" />} />
              <Route path="/it/connections/:id/:tab" element={<ConnectionWorkspacePage />} />
            </Routes>
          </MemoryRouter>
        </KanapDialogProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

function location() {
  return screen.getByTestId('location').textContent;
}

async function createConnection() {
  renderPage(['/start']);
  fireEvent.click(await screen.findByRole('button', { name: 'new connection' }));
  const input = await screen.findByRole('textbox', { name: TITLE });
  fireEvent.change(input, { target: { value: 'Web to db' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(location()).toBe('/it/connections/CONN-7/overview'));
  await screen.findByRole('button', { name: TITLE });
}

describe('Connection creation at the title', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    resetCreationStore();
    resetNavigationTracker();
  });

  it('opens with the title to type and the connection to come dimmed, nothing read or written', async () => {
    renderPage(['/it/connections/new/overview']);
    const input = await screen.findByRole('textbox', { name: TITLE });
    expect(input).toHaveFocus();
    expect(screen.getByRole('button', { name: 'common:buttons.create' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'common:buttons.cancel' })).toBeTruthy();
    const previews = screen.getAllByTestId('creation-preview');
    expect(previews.length).toBeGreaterThan(0);
    for (const preview of previews) {
      expect(preview).toHaveAttribute('inert');
      expect(within(preview).queryAllByRole('textbox')).toHaveLength(0);
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocked.get.mock.calls.map(([url]) => String(url)).filter((url) => /\/connections\/(new\b|$)/.test(url))).toEqual([]);
    expect(mocked.post).not.toHaveBeenCalled();
    expect(mocked.patch).not.toHaveBeenCalled();
  });

  it('creates the connection from its name alone and opens it', async () => {
    await createConnection();
    expect(mocked.post).toHaveBeenCalledTimes(1);
    expect(mocked.post).toHaveBeenCalledWith('/connections/creation', { name: 'Web to db' });
    expect(screen.queryByTestId('creation-preview')).toBeNull();
    expect(screen.getByRole('button', { name: 'common:buttons.cancel' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'common:buttons.delete' })).toBeNull();
  });

  it('names what the connection lacks on Create, focuses the first field and stays', async () => {
    await createConnection();
    mocked.post.mockRejectedValueOnce({
      response: { status: 400, data: { code: 'CREATION_INCOMPLETE', params: { fields: ['protocols', 'source', 'destination'] } } },
    });
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    expect(await screen.findByText(/workspace\.connection\.creation\.missing/)).toBeTruthy();
    expect(mocked.post).toHaveBeenLastCalledWith('/connections/conn-new/creation/complete', { token: 'token-1' });
    // The protocol picker, first of the missing fields.
    await waitFor(() => expect(screen.getByPlaceholderText('workspace.connection.overview.addProtocol')).toHaveFocus());
    expect(location()).toBe('/it/connections/CONN-7/overview');
  });

  it('closes a complete connection on Create, back where the creation started', async () => {
    await createConnection();
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    await waitFor(() => expect(location()).toBe('/start'));
    expect(mocked.post).toHaveBeenLastCalledWith('/connections/conn-new/creation/complete', { token: 'token-1' });
    expect(mocked.delete).not.toHaveBeenCalled();
  });

  it('deletes the connection on Cancel and goes back where it started', async () => {
    await createConnection();
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.cancel' }));
    await waitFor(() => expect(location()).toBe('/start'));
    expect(mocked.delete).toHaveBeenCalledWith('/connections/conn-new/creation', { data: { token: 'token-1' } });
  });

  it('asks before leaving a connection being created that lacks a field, and deletes it on Delete before going to the list', async () => {
    await createConnection();
    fireEvent.click(screen.getByRole('button', { name: 'pages.connections.title' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/workspace\.connection\.creation\.missing/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'it:workspace.connection.creation.leaveComplete' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(location()).toBe('/it/connections/CONN-7/overview');

    fireEvent.click(screen.getByRole('button', { name: 'pages.connections.title' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'it:workspace.connection.creation.leaveDelete' }));
    await waitFor(() => expect(location()).toBe('/it/connections'));
    expect(mocked.delete).toHaveBeenCalledWith('/connections/conn-new/creation', { data: { token: 'token-1' } });
  });
});
