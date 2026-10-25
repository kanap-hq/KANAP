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
  t: (key: string, options?: { count?: number }) =>
    (key === 'pages.connectionMap.hiddenMembers' && options?.count !== undefined ? `hidden:${options.count}` : key),
  i18n: { language: 'en', resolvedLanguage: 'en' },
}));
vi.mock('react-i18next', () => ({ initReactI18next: { type: '3rdParty', init: () => undefined }, useTranslation: () => translation }));
vi.mock('../../api', () => ({ default: { get } }));
const catalog = vi.hoisted(() => ({ data: undefined }));
vi.mock('../../hooks/useApplicationClassificationCatalog', () => ({ default: () => catalog }));
const enums = vi.hoisted(() => ({ settings: null, byField: {}, labelFor: () => '', entityName: (_code: string, fallback?: string) => fallback ?? '' }));
vi.mock('../../hooks/useItOpsEnumOptions', () => ({ default: () => enums }));
vi.mock('../../components/LightModeIsland', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
type RecordedLink = { id: string; source: string | { id: string }; target: string | { id: string } };
type RecordedNode = { id: string; hiddenMembers?: number; hiddenMembersLabel?: string };
type RecordedProps = {
  nodes: RecordedNode[];
  links: RecordedLink[];
  clusterMemberships: Array<{ cluster_id: string; server_id: string }>;
};
const graph = vi.hoisted(() => ({ props: null as null | RecordedProps }));
vi.mock('./components/ConnectionMapGraph', () => ({
  default: (props: RecordedProps) => {
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
const TWELVE_MEMBERS = Array.from({ length: 12 }, (_, index) => ({
  id: `m-${index + 1}`,
  name: `M${index + 1}`,
  kind: 'server',
  environment: 'prod',
  network_segment: null,
  hosting_category: null,
  implicit_member: true,
}));

const FIREWALL = { id: 'fw-1', name: 'FW', kind: 'server', environment: 'prod', network_segment: null, hosting_category: null };

function connection(id: string, source: string, destinationEntity: string) {
  return {
    id, connection_reference: id.toUpperCase(), name: 'Flow', purpose: null, topology: 'server_to_server', lifecycle: 'active',
    criticality: 'low', data_class: 'internal', contains_pii: false, protocol_codes: [], protocol_labels: [],
    source_asset_id: source, source_entity_code: null, destination_asset_id: null, destination_entity_code: destinationEntity,
    server_ids: [source],
  };
}

function serverConnection(id: string, source: string, destination: string) {
  return {
    ...connection(id, source, 'dmz'),
    destination_asset_id: destination,
    destination_entity_code: null,
    server_ids: [source, destination],
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
    serverConnection('c-2', 'cl-2', 'fw-2'),
  ],
};

// The cluster of the start has no connection at all; an unrelated cluster keeps links non-empty.
const MAP_ISOLATED_START = {
  environment: 'prod',
  lifecycles: ['active'],
  nodes: [
    { id: 'cl-x', name: 'CLX', kind: 'cluster', is_cluster: true, environment: 'prod', network_segment: null, hosting_category: null, member_server_ids: ['m-9'] },
    { id: 'm-9', name: 'M9', kind: 'server', environment: 'prod', network_segment: null, hosting_category: null, implicit_member: true },
    { id: 'cl-2', name: 'CL2', kind: 'cluster', is_cluster: true, environment: 'prod', network_segment: null, hosting_category: null },
    { id: 'fw-2', name: 'FW2', kind: 'server', environment: 'prod', network_segment: null, hosting_category: null },
  ],
  connections: [serverConnection('c-9', 'cl-2', 'fw-2')],
  clusterMemberships: [{ cluster_id: 'cl-x', server_id: 'm-9' }],
};

const MAP_WITH_FIREWALL = {
  environment: 'prod',
  lifecycles: ['active'],
  nodes: [CLUSTER, MEMBER_1, MEMBER_2, ENTITY, FIREWALL],
  connections: [connection('c-1', 'cl-1', 'dmz'), serverConnection('c-2', 'cl-1', 'fw-1')],
  clusterMemberships: MAP.clusterMemberships,
};

const MAP_WITH_TWELVE_MEMBERS = {
  environment: 'prod',
  lifecycles: ['active'],
  nodes: [
    { ...CLUSTER, member_server_ids: TWELVE_MEMBERS.map((member) => member.id) },
    ...TWELVE_MEMBERS,
    ENTITY,
  ],
  connections: [connection('c-1', 'cl-1', 'dmz')],
  clusterMemberships: TWELVE_MEMBERS.map((member) => ({ cluster_id: 'cl-1', server_id: member.id })),
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

  it('brings the connections of the cluster of a member start at depth 1', async () => {
    renderPage(MAP_WITH_FIREWALL, '/it/connection-map?rootIds=m-1&depth=1');
    await waitFor(() => expect(graphNodeIds()).toEqual(['cl-1', 'm-1', 'm-2', 'entity:dmz', 'fw-1']));
    expect(graph.props?.links.map((link) => link.id)).toEqual(['c-1', 'c-2']);
  });

  it('keeps the entity next to a member start at depth 0, not the firewall at depth 1', async () => {
    renderPage(MAP_WITH_FIREWALL, '/it/connection-map?rootIds=m-1&depth=0');
    await waitFor(() => expect(graphNodeIds()).toEqual(['cl-1', 'm-1', 'm-2', 'entity:dmz']));
    expect(graph.props?.links.map((link) => link.id)).toEqual(['c-1']);
  });

  it('shows the members of a cluster start at depth 0', async () => {
    renderPage(MAP_WITH_FIREWALL, '/it/connection-map?rootIds=cl-1&depth=0');
    await waitFor(() => expect(graphNodeIds()).toEqual(['cl-1', 'm-1', 'm-2', 'entity:dmz']));
  });

  it('reaches the cluster and its members from a firewall start, without a member link', async () => {
    renderPage(MAP_WITH_FIREWALL, '/it/connection-map?rootIds=fw-1&depth=1');
    await waitFor(() => expect(graphNodeIds()).toEqual(['cl-1', 'm-1', 'm-2', 'fw-1']));
    const ends = (graph.props?.links ?? []).flatMap((link) => {
      const source = typeof link.source === 'object' ? link.source.id : link.source;
      const target = typeof link.target === 'object' ? link.target.id : link.target;
      return [source, target];
    });
    expect(ends).not.toContain('m-1');
    expect(ends).not.toContain('m-2');
  });

  it('shows an isolated start alone, with its cluster', async () => {
    renderPage(MAP_ISOLATED_START, '/it/connection-map?rootIds=m-9&depth=0');
    await waitFor(() => expect(graphNodeIds()).toEqual(['cl-x', 'm-9']));
    expect(graph.props?.links).toEqual([]);
  });

  it('keeps every node of the map for a start at the whole depth', async () => {
    renderPage(MAP_WITH_FIREWALL, '/it/connection-map?rootIds=fw-1');
    await waitFor(() => expect(graphNodeIds()).toEqual(['cl-1', 'm-1', 'm-2', 'entity:dmz', 'fw-1']));
    expect(graph.props?.links.map((link) => link.id)).toEqual(['c-1', 'c-2']);
  });

  it('folds the twelve members of a cluster to ten and counts two', async () => {
    renderPage(MAP_WITH_TWELVE_MEMBERS);
    await waitFor(() => expect(graph.props?.nodes).toHaveLength(12));
    const clusterAndMembers = (graph.props?.nodes ?? []).filter((node) => node.id !== 'entity:dmz');
    expect(clusterAndMembers).toHaveLength(11);
    expect(graph.props?.nodes[0]).toMatchObject({ id: 'cl-1', hiddenMembers: 2, hiddenMembersLabel: 'hidden:2' });
    expect(graphNodeIds()).toContain('m-10');
    expect(graphNodeIds()).not.toContain('m-11');
    expect(graphNodeIds()).not.toContain('m-12');
    expect(graph.props?.clusterMemberships).toHaveLength(10);
  });

  it('shows a folded member taken as a start', async () => {
    renderPage(MAP_WITH_TWELVE_MEMBERS, '/it/connection-map?rootIds=m-12');
    await waitFor(() => expect(graphNodeIds()).toContain('m-12'));
    expect(graphNodeIds()).not.toContain('m-10');
    expect(graphNodeIds()).not.toContain('m-11');
    expect(graph.props?.nodes[0].hiddenMembers).toBe(2);
  });
});
