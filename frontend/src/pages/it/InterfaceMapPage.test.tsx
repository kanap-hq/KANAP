import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import InterfaceMapPage from './InterfaceMapPage';

const get = vi.hoisted(() => vi.fn());

const translation = vi.hoisted(() => ({
  t: (key: string) => key,
  i18n: { language: 'en', resolvedLanguage: 'en' },
}));
vi.mock('react-i18next', () => ({ initReactI18next: { type: '3rdParty', init: () => undefined }, useTranslation: () => translation }));
vi.mock('../../api', () => ({ default: { get } }));
const catalog = vi.hoisted(() => ({ data: undefined }));
vi.mock('../../hooks/useApplicationClassificationCatalog', () => ({ default: () => catalog }));
const enums = vi.hoisted(() => ({ settings: null, byField: {}, labelFor: () => '', entityName: (_code: string, fallback?: string) => fallback ?? '' }));
vi.mock('../../hooks/useItOpsEnumOptions', () => ({ default: () => enums }));
vi.mock('../../components/LightModeIsland', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
// The graph is a canvas: a button per node stands for a click on it.
vi.mock('./components/InterfaceMapGraph', () => ({
  default: (props: { nodes: Array<{ id: string; name: string }>; onSelectNode: (id: string) => void }) => (
    <div>{props.nodes.map((node) => <button key={node.id} onClick={() => props.onSelectNode(node.id)}>{`node ${node.name}`}</button>)}</div>
  ),
}));

const MAP = {
  environment: 'prod',
  lifecycles: ['active'],
  nodes: [{
    id: 'app-1', name: 'CheeseTrack', lifecycle: 'active', criticality: 'high', external_facing: false, is_middleware: false,
    in_degree: 0, out_degree: 0, total_interfaces: 0,
  }],
  interfaces: [],
  bindings: [],
};

// The servers of the application, as its summary answers: a cluster, the members that inherit it, a server of its own.
const SERVERS = [
  { id: 'cl-1', name: 'PAR-SQL-CL01', environment: 'prod', is_cluster: true, inherited: false, via_clusters: [] },
  { id: 'sql-1', name: 'PAR-SQL-01', environment: 'prod', is_cluster: false, inherited: true, via_clusters: [{ id: 'cl-1', name: 'PAR-SQL-CL01' }] },
  { id: 'sql-2', name: 'PAR-SQL-02', environment: 'prod', is_cluster: false, inherited: true, via_clusters: [{ id: 'cl-1', name: 'PAR-SQL-CL01' }] },
  { id: 'web-1', name: 'PAR-WEB-01', environment: 'prod', is_cluster: false, inherited: false, via_clusters: [] },
];

let servers: typeof SERVERS = SERVERS;

const CONNECTION_LINK = {
  id: 'link-1',
  binding_id: 'bind-1',
  environment: 'dev',
  leg_type: 'primary',
  binding_status: 'active',
  connection: {
    id: 'conn-1',
    connection_reference: 'CN-1',
    name: 'Orders hop',
    topology: 'server_to_server' as const,
    lifecycle: 'planned',
    criticality: 'high',
    data_class: 'internal',
    contains_pii: false,
    risk_mode: 'manual' as const,
    protocol_codes: [],
    source_server_id: 'srv-a',
    destination_server_id: 'srv-b',
    source_server_name: 'PAR-WEB-01',
    destination_server_name: 'PAR-SQL-01',
    server_ids: ['srv-a', 'srv-b'],
  },
};

const LINKED_MAP = {
  ...MAP,
  environment: 'dev',
  nodes: [
    MAP.nodes[0],
    { ...MAP.nodes[0], id: 'app-2', name: 'Billing' },
  ],
  interfaces: [{
    id: 'if-1',
    interface_reference: 'IF-1',
    name: 'Orders',
    source_application_id: 'app-1',
    target_application_id: 'app-2',
    lifecycle: 'active',
    criticality: 'high',
    data_category: 'operational',
    contains_pii: false,
    integration_route_type: 'api',
    bindings_count: 1,
    has_middleware: false,
    middleware_application_ids: [],
  }],
};

function Where() {
  const location = useLocation();
  return (
    <>
      <div data-testid="where">{location.pathname}</div>
      <div data-testid="search">{location.search}</div>
    </>
  );
}

function renderPage(entry = '/it/interface-map', map: typeof MAP | typeof LINKED_MAP = MAP) {
  get.mockImplementation(async (url: string) => {
    if (url === '/interfaces/map') return { data: map };
    if (url === '/interfaces/if-1/connection-links') return { data: { items: [CONNECTION_LINK] } };
    if (url === '/applications/app-1/map-summary') {
      return {
        data: {
          id: 'app-1', name: 'CheeseTrack', description: null, editor: null, criticality: 'high',
          assigned_servers: servers, business_owners: [], it_owners: [], support_contacts: [],
        },
      };
    }
    return { data: { items: [] } };
  });
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route path="/it/interface-map" element={<InterfaceMapPage />} />
            <Route path="/it/assets/:id/:tab" element={<Where />} />
            <Route path="/it/connection-map" element={<Where />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

describe('InterfaceMapPage application panel', () => {
  beforeEach(() => { get.mockReset(); });

  it('lists the servers of a deployment with the cluster first and its members under it', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'node CheeseTrack' }));
    const cluster = await screen.findByRole('button', { name: 'PAR-SQL-CL01' });
    const names = screen.getAllByRole('button').map((button) => button.textContent).filter((text) => /^PAR-/.test(text ?? ''));
    expect(names).toEqual(['PAR-SQL-CL01', 'PAR-SQL-01', 'PAR-SQL-02', 'PAR-WEB-01']);
    expect(cluster.parentElement?.querySelector('[aria-label="pages.assets.columns.cluster"]')).toBeTruthy();
    expect(screen.getAllByLabelText('pages.assets.columns.cluster').length).toBe(1);
    const member = screen.getByRole('button', { name: 'PAR-SQL-01' }).parentElement as HTMLElement;
    expect(member.querySelector('svg')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'PAR-WEB-01' }).parentElement?.querySelector('svg')).toBeNull();
  });

  it('shows a server once when it comes with several roles', async () => {
    // The cluster carries two roles: it and each member come twice in the summary.
    servers = [...SERVERS, SERVERS[0], SERVERS[1], SERVERS[2]];
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'node CheeseTrack' }));
      await screen.findByRole('button', { name: 'PAR-SQL-CL01' });
      const names = screen.getAllByRole('button').map((button) => button.textContent).filter((text) => /^PAR-/.test(text ?? ''));
      expect(names).toEqual(['PAR-SQL-CL01', 'PAR-SQL-01', 'PAR-SQL-02', 'PAR-WEB-01']);
      expect(errors.mock.calls.some((call) => String(call[0]).includes('same key'))).toBe(false);
    } finally {
      servers = SERVERS;
      errors.mockRestore();
    }
  });

  it('opens the page of a member from its line', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'node CheeseTrack' }));
    fireEvent.click(await screen.findByRole('button', { name: 'PAR-SQL-02' }));
    expect(screen.getByTestId('where').textContent).toBe('/it/assets/sql-2/overview');
  });
});

describe('InterfaceMapPage connection map link', () => {
  beforeEach(() => { get.mockReset(); });

  it('opens the connection map without an environment parameter', async () => {
    renderPage('/it/interface-map?environment=dev&focusInterfaceId=if-1', LINKED_MAP);
    fireEvent.click(await screen.findByRole('button', { name: 'pages.interfaceMap.viewInConnectionMap' }));
    expect(screen.getByTestId('where').textContent).toBe('/it/connection-map');
    const params = new URLSearchParams(screen.getByTestId('search').textContent || '');
    expect(params.has('environment')).toBe(false);
    expect(params.get('lifecycles')).toBe('planned');
    expect(params.get('focusConnectionId')).toBe('conn-1');
    expect(params.get('depth')).toBe('1');
    expect(params.get('rootIds')).toBe('srv-a,srv-b');
    expect(get).toHaveBeenCalledWith('/interfaces/if-1/connection-links', { params: { environment: 'dev' } });
  });
});
