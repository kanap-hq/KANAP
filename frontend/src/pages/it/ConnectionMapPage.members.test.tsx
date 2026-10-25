import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import ConnectionMapPage from './ConnectionMapPage';

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
const graph = vi.hoisted(() => ({ props: null as null | { nodes: Array<{ id: string }>; links: Array<{ id: string }>; clusterMemberships: Array<{ cluster_id: string; server_id: string }> } }));
vi.mock('./components/ConnectionMapGraph', () => ({
  default: (props: { nodes: Array<{ id: string }>; links: Array<{ id: string }>; clusterMemberships: Array<{ cluster_id: string; server_id: string }> }) => {
    graph.props = props;
    return <div data-testid="connection-map-graph" />;
  },
}));

const CLUSTER = {
  id: 'cl-1', name: 'CL', kind: 'cluster', is_cluster: true, environment: 'prod', network_segment: null, hosting_category: null,
  member_server_ids: ['m-1', 'm-2'],
};
const MEMBER_1 = { id: 'm-1', name: 'M1', kind: 'server', environment: 'prod', network_segment: null, hosting_category: null, implicit_member: true };
const MEMBER_2 = { id: 'm-2', name: 'M2', kind: 'server', environment: 'prod', network_segment: null, hosting_category: null, implicit_member: true };
const ENTITY = { id: 'entity:dmz', name: 'DMZ', kind: 'entity', environment: null, network_segment: null, hosting_category: null };

function connection(id: string, source: string, destinationEntity: string) {
  return {
    id, connection_reference: id.toUpperCase(), name: 'Flow', purpose: null, topology: 'server_to_server', lifecycle: 'active',
    criticality: 'low', data_class: 'internal', contains_pii: false, protocol_codes: [], protocol_labels: [],
    source_asset_id: source, source_entity_code: null, destination_asset_id: null, destination_entity_code: destinationEntity,
    server_ids: [source],
  };
}

const MAP = {
  environment: 'prod',
  lifecycles: ['active'],
  nodes: [CLUSTER, MEMBER_1, MEMBER_2, ENTITY],
  connections: [connection('c-1', 'cl-1', 'dmz')],
  clusterMemberships: [
    { cluster_id: 'cl-1', server_id: 'm-1' },
    { cluster_id: 'cl-1', server_id: 'm-2' },
  ],
};

// A second, unrelated cluster makes a lost depth and a lost start visible.
const MAP_WITH_OTHER_CLUSTER = {
  ...MAP,
  nodes: [
    ...MAP.nodes,
    { id: 'cl-2', name: 'CL2', kind: 'cluster', is_cluster: true, environment: 'prod', network_segment: null, hosting_category: null },
    { id: 'fw-2', name: 'FW2', kind: 'server', environment: 'prod', network_segment: null, hosting_category: null },
  ],
  connections: [
    ...MAP.connections,
    {
      ...connection('c-2', 'cl-2', 'dmz'),
      destination_asset_id: 'fw-2',
      destination_entity_code: null,
      server_ids: ['cl-2', 'fw-2'],
    },
  ],
};

function renderPage(map: unknown, entry = '/it/connection-map') {
  get.mockImplementation(async (url: string) => {
    if (url === '/connections/map') return { data: map };
    return { data: { items: [] } };
  });
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route path="/it/connection-map" element={<ConnectionMapPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

const graphNodeIds = () => (graph.props?.nodes ?? []).map((node) => node.id);

describe('ConnectionMapPage cluster members', () => {
  beforeEach(() => {
    get.mockReset();
    graph.props = null;
  });

  it('hands the cluster, its two implicit members and both couples to the graph', async () => {
    renderPage(MAP);
    await waitFor(() => expect(graph.props?.nodes.map((node) => node.id)).toEqual(['cl-1', 'm-1', 'm-2', 'entity:dmz']));
    expect(graph.props?.clusterMemberships).toEqual([
      { cluster_id: 'cl-1', server_id: 'm-1' },
      { cluster_id: 'cl-1', server_id: 'm-2' },
    ]);
  });

  it('lists the implicit members in the start options', async () => {
    renderPage(MAP);
    await waitFor(() => expect(graph.props).not.toBeNull());
    const servers = screen.getByRole('combobox', { name: 'pages.connectionMap.servers' });
    fireEvent.mouseDown(servers);
    expect(await screen.findByRole('option', { name: 'M1' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'M2' })).toBeTruthy();
  });

  it('keeps a start member given by the address, with its depth', async () => {
    renderPage(MAP_WITH_OTHER_CLUSTER, '/it/connection-map?rootIds=m-1&depth=0');
    await waitFor(() => expect(graphNodeIds()).toContain('m-1'));
    expect(graphNodeIds()).toContain('cl-1');
    expect(graphNodeIds()).not.toContain('cl-2');
    expect(graphNodeIds()).not.toContain('fw-2');
  });
});
