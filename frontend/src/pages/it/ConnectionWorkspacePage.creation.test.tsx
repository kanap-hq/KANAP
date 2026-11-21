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
import { TITLE_FIELD } from '../../test/titleField';

// A connection is born complete (lot L3c): the new page is a draft whose topology, ends and
// protocols are open beside the title; nothing is written until the name, the ends and a protocol
// are given, then one POST /connections writes it all and the page becomes the connection, with
// Done and Cancel. Create on an incomplete draft marks what it lacks; leaving writes nothing.

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
// An end is picked as in the picker: an asset (with its summary) or an entity.
vi.mock('./workspace/ConnectionEndpointPicker', () => ({
  default: ({ label, missing, onChange }: { label: string; missing?: boolean; onChange: (next: { asset_id: string | null; entity_code: string | null }, asset?: unknown) => void }) => (
    <>
      <span data-missing={missing ? '' : undefined}>{label}</span>
      <input aria-label={label} data-label-missing={String(!!missing)} />
      <button type="button" onClick={() => onChange({ asset_id: 'web', entity_code: null }, { id: 'web', name: 'web-1' })}>{`${label} web`}</button>
      <button type="button" onClick={() => onChange({ asset_id: 'node-1', entity_code: null }, { id: 'node-1', name: 'node-1' })}>{`${label} node`}</button>
      <button type="button" onClick={() => onChange({ asset_id: null, entity_code: 'internet' })}>{`${label} internet`}</button>
    </>
  ),
}));
vi.mock('./workspace/ConnectionServersPicker', () => ({
  default: ({ onChange }: { onChange: (next: unknown[]) => void }) => (
    <>
      <input aria-label="servers" />
      <button type="button" onClick={() => onChange([{ id: 'a', name: 'a' }, { id: 'b', name: 'b' }])}>two servers</button>
    </>
  ),
}));
vi.mock('./workspace/ConnectionProtocolsTable', () => ({
  default: ({ onProtocolsChange }: { onProtocolsChange: (next: Array<{ code: string; port_override: string | null }>) => void }) => (
    <button type="button" onClick={() => onProtocolsChange([{ code: 'https', port_override: '8443' }])}>add https</button>
  ),
}));

const mocked = vi.mocked(api);
const TITLE = 'common:buttons.editTitle';
const created = {
  id: 'conn-new',
  connection_reference: 'CONN-7',
  name: 'Web to db',
  topology: 'server_to_server',
  source_asset_id: 'web',
  source_entity_code: null,
  destination_asset_id: null,
  destination_entity_code: 'internet',
  absorbed: [],
  creation_token: 'token-1',
};
const detail = {
  ...created,
  absorbed: undefined,
  creation_token: undefined,
  description: null,
  source_server: { id: 'web', name: 'web-1' },
  destination_server: null,
  servers: [],
  protocol_codes: ['https'],
  protocols: [{ code: 'https', port_override: '8443' }],
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
  created_at: '2026-11-21T08:00:00.000Z',
  updated_at: '2026-11-21T08:00:00.000Z',
};

function Location() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function StartPage() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate('/it/connections/new/overview')}>new connection</button>;
}

function renderPage(entries: string[] = ['/start']) {
  mocked.get.mockImplementation(async (url: string) => {
    if (url === '/connections/CONN-7' || url === '/connections/conn-new') return { data: detail } as never;
    if (url === '/connections/conn-new/creation') return { data: { changes: { fields: 0, children: {} } } } as never;
    // node-1 belongs to a cluster of two: choosing it asks whether to connect the cluster.
    if (url === '/assets/node-1/clusters') return { data: { items: [{ id: 'clu', name: 'Cluster A' }] } } as never;
    if (url === '/assets/clu/members') return { data: { items: [{ id: 'node-1', name: 'node-1' }, { id: 'node-2', name: 'node-2' }] } } as never;
    if (url === '/assets/clu') return { data: { id: 'clu', name: 'Cluster A', is_cluster: true } } as never;
    if (/^\/assets\/[^/]+\/clusters$/.test(url)) return { data: { items: [] } } as never;
    return { data: { items: [], total: 0 } } as never;
  });
  mocked.post.mockImplementation(async (url: string) => {
    if (url === '/connections') return { data: { ...created } } as never;
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

async function openNew() {
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'new connection' }));
  return screen.findByRole('textbox', { name: TITLE_FIELD });
}

async function typeName(name = 'Web to db') {
  const input = await openNew();
  fireEvent.change(input, { target: { value: name } });
  fireEvent.keyDown(input, { key: 'Enter' });
  return input;
}

const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const connectionPosts = () => mocked.post.mock.calls.filter(([url]) => url === '/connections');

describe('Connection born complete', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    resetCreationStore();
    resetNavigationTracker();
  });

  it('opens with the title, the topology, the ends and the protocols active, the rest dimmed, nothing read or written', async () => {
    renderPage(['/it/connections/new/overview']);
    const input = await screen.findByRole('textbox', { name: TITLE_FIELD });
    expect(input).toHaveFocus();
    expect(screen.getByRole('button', { name: 'common:buttons.create' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'common:buttons.cancel' })).toBeTruthy();
    const previews = screen.getAllByTestId('creation-preview');
    const inPreview = (el: Element) => previews.some((preview) => preview.contains(el));
    for (const active of [
      screen.getByRole('textbox', { name: 'workspace.connection.layers.source' }),
      screen.getByRole('textbox', { name: 'workspace.connection.layers.destination' }),
      screen.getByPlaceholderText('workspace.connection.overview.addProtocol'),
      screen.getByRole('button', { name: /enums\.topology\.serverToServer/ }),
    ]) {
      expect(inPreview(active)).toBe(false);
    }
    for (const preview of previews) expect(preview).toHaveAttribute('inert');
    expect(inPreview(screen.getByTestId('description-editor'))).toBe(true);
    await settle();
    expect(mocked.get.mock.calls.map(([url]) => String(url)).filter((url) => url.startsWith('/connections'))).toEqual([]);
    expect(mocked.post).not.toHaveBeenCalled();
    expect(mocked.patch).not.toHaveBeenCalled();
  });

  it('writes nothing for a name alone', async () => {
    await typeName();
    await settle();
    expect(mocked.post).not.toHaveBeenCalled();
    expect(location()).toBe('/it/connections/new/overview');
  });

  it('writes the connection once, with everything, when its name, ends and protocol are given, then opens it with Done and Cancel', async () => {
    await typeName();
    click('workspace.connection.layers.source web');
    click('workspace.connection.layers.destination internet');
    await settle();
    expect(mocked.post).not.toHaveBeenCalled();
    click('add https');
    await waitFor(() => expect(location()).toBe('/it/connections/CONN-7/overview'));
    expect(connectionPosts()).toHaveLength(1);
    expect(connectionPosts()[0][1]).toMatchObject({
      name: 'Web to db',
      topology: 'server_to_server',
      source_asset_id: 'web',
      source_entity_code: null,
      destination_asset_id: null,
      destination_entity_code: 'internet',
      protocols: [{ code: 'https', port_override: '8443' }],
    });
    expect(await screen.findByRole('button', { name: 'common:buttons.done' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'common:buttons.cancel' })).toBeTruthy();
    await screen.findByRole('button', { name: TITLE });
    expect(mocked.patch).not.toHaveBeenCalled();
    expect(connectionPosts()).toHaveLength(1);
  });

  it('writes a multi-server connection with its two servers', async () => {
    await typeName('Cluster sync');
    fireEvent.click(screen.getByRole('button', { name: /enums\.topology\.serverToServer/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'it:enums.topology.multiServer' }));
    click('two servers');
    click('add https');
    await waitFor(() => expect(connectionPosts()).toHaveLength(1));
    expect(connectionPosts()[0][1]).toMatchObject({ name: 'Cluster sync', topology: 'multi_server', servers: ['a', 'b'] });
    expect(connectionPosts()[0][1]).not.toHaveProperty('source_asset_id', 'web');
  });

  it('asks whether to connect the cluster when a member is chosen on the draft, and writes the answer', async () => {
    await typeName();
    click('workspace.connection.layers.source node');
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'components.clusterConnection.connectToCluster' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    click('workspace.connection.layers.destination internet');
    click('add https');
    await waitFor(() => expect(connectionPosts()).toHaveLength(1));
    expect(connectionPosts()[0][1]).toMatchObject({ source_asset_id: 'clu', destination_entity_code: 'internet' });
  });

  it('marks what the draft lacks on Create, focuses the first field on screen and writes nothing', async () => {
    const input = await openNew();
    fireEvent.change(input, { target: { value: 'Web to db' } });
    click('common:buttons.create');
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'workspace.connection.layers.source' })).toHaveFocus());
    for (const side of ['source', 'destination']) {
      const field = screen.getByRole('textbox', { name: `workspace.connection.layers.${side}` });
      expect(field).toHaveAttribute('data-label-missing', 'true');
      expect(field).toHaveAttribute('aria-invalid', 'true');
    }
    expect(screen.getByPlaceholderText('workspace.connection.overview.addProtocol')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('heading', { name: /workspace\.connection\.overview\.protocols/ })).toHaveStyle({ color: createAppTheme('light').palette.kanap.danger });
    await settle();
    expect(mocked.post).not.toHaveBeenCalled();
    expect(location()).toBe('/it/connections/new/overview');
  });

  it('says a refusal of the server on its field, keeps the draft and does not send it again until it changes', async () => {
    await typeName();
    mocked.post.mockRejectedValueOnce({
      response: { status: 400, data: { code: 'connection_same_endpoint', message: 'The source and the destination are the same asset.' } },
    });
    click('workspace.connection.layers.source web');
    click('workspace.connection.layers.destination web');
    click('add https');
    const destination = screen.getByRole('textbox', { name: 'workspace.connection.layers.destination' }).closest('[data-creation-field]') as HTMLElement;
    await waitFor(() => expect(within(destination).getByRole('alert').textContent).toMatch(/connection_same_endpoint|same asset/));
    await settle();
    expect(connectionPosts()).toHaveLength(1);
    expect(location()).toBe('/it/connections/new/overview');
    // Enter in the title again sends nothing new: the draft did not change.
    fireEvent.keyDown(screen.getByRole('textbox', { name: TITLE_FIELD }), { key: 'Enter' });
    await settle();
    expect(connectionPosts()).toHaveLength(1);
    click('workspace.connection.layers.destination internet');
    await waitFor(() => expect(location()).toBe('/it/connections/CONN-7/overview'));
    expect(connectionPosts()).toHaveLength(2);
  });

  it('writes nothing when the person leaves a draft, after asking', async () => {
    await typeName();
    click('workspace.connection.layers.source web');
    // The cluster question reads the asset's clusters first: the end enters the draft after.
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'pages.connections.title' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'common:buttons.discard' }));
    await waitFor(() => expect(location()).toBe('/start'));
    expect(mocked.post).not.toHaveBeenCalled();
    expect(mocked.patch).not.toHaveBeenCalled();
  });

  it('deletes the connection on Cancel just after its writing, without a question, and goes back where it started', async () => {
    await typeName();
    click('workspace.connection.layers.source web');
    click('workspace.connection.layers.destination internet');
    click('add https');
    await waitFor(() => expect(location()).toBe('/it/connections/CONN-7/overview'));
    fireEvent.click(await screen.findByRole('button', { name: 'common:buttons.cancel' }));
    await waitFor(() => expect(location()).toBe('/start'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mocked.delete).toHaveBeenCalledWith('/connections/conn-new/creation', { data: { token: 'token-1' } });
  });

  it('closes the connection on Done, back where the creation started', async () => {
    await typeName();
    click('workspace.connection.layers.source web');
    click('workspace.connection.layers.destination internet');
    click('add https');
    await waitFor(() => expect(location()).toBe('/it/connections/CONN-7/overview'));
    await screen.findByRole('button', { name: TITLE });
    fireEvent.click(await screen.findByRole('button', { name: 'common:buttons.done' }));
    await waitFor(() => expect(location()).toBe('/start'));
    expect(mocked.delete).not.toHaveBeenCalled();
  });
});
