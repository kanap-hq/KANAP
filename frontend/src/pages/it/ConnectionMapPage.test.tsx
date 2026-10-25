import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
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
// The graph is a canvas: a button per node stands for a click on it.
vi.mock('./components/ConnectionMapGraph', () => ({
  default: (props: { nodes: Array<{ id: string; name: string }>; onSelectNode: (id: string) => void }) => (
    <div>{props.nodes.map((node) => <button key={node.id} onClick={() => props.onSelectNode(node.id)}>{`node ${node.name}`}</button>)}</div>
  ),
}));

const MAP = {
  environment: 'prod',
  lifecycles: ['active'],
  nodes: [
    { id: 'cl-1', name: 'QA-CL-A', kind: 'cluster', is_cluster: true, environment: 'prod', network_segment: null, hosting_category: null },
    { id: 'srv-1', name: 'QA-VM1', kind: 'server', environment: 'prod', network_segment: null, hosting_category: null },
  ],
  connections: [{
    id: 'c-1', connection_reference: 'CNX-1', name: 'Flow', purpose: null, topology: 'server_to_server', lifecycle: 'active',
    criticality: 'low', data_class: 'internal', contains_pii: false, protocol_codes: [], protocol_labels: [],
    source_asset_id: 'cl-1', source_entity_code: null, destination_asset_id: 'srv-1', destination_entity_code: null, server_ids: ['cl-1', 'srv-1'],
  }],
};

// What the summary of each node lists: a cluster its own rows, a member its own and the ones it inherits.
const APPLICATIONS: Record<string, unknown[]> = {
  'cl-1': [
    { id: 'app-1', name: 'CheeseTrack', environment: 'prod', inherited: false, via_clusters: [] },
    { id: 'app-2', name: 'Sage X3', environment: 'prod', inherited: false, via_clusters: [] },
  ],
  'srv-1': [
    { id: 'app-1', name: 'CheeseTrack', environment: 'prod', inherited: true, via_clusters: [{ id: 'cl-1', name: 'QA-CL-A' }] },
    { id: 'app-3', name: 'Intranet', environment: 'prod', inherited: false, via_clusters: [] },
  ],
};

function Where() {
  const location = useLocation();
  return <div data-testid="where">{location.pathname}</div>;
}

function renderPage() {
  get.mockImplementation(async (url: string) => {
    if (url === '/connections/map') return { data: MAP };
    if (url.endsWith('/map-summary')) {
      const id = url.split('/')[2];
      return { data: { id, name: id, kind: 'vm', environment: 'prod', operating_system: null, ip_addresses: null, location_reference: null, location_name: null, assigned_applications: APPLICATIONS[id] ?? [], is_cluster: id === 'cl-1' } };
    }
    return { data: { items: [] } };
  });
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/it/connection-map']}>
          <Routes>
            <Route path="/it/connection-map" element={<ConnectionMapPage />} />
            <Route path="/it/assets/:id/:tab" element={<Where />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

describe('ConnectionMapPage node panel', () => {
  beforeEach(() => { get.mockReset(); });

  it('opens a cluster at the top of the Operations tab, with no help line', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'node QA-CL-A' }));
    fireEvent.click(await screen.findByRole('button', { name: 'pages.connectionMap.viewCluster' }));
    expect(screen.getByTestId('where').textContent).toBe('/it/assets/cl-1/operations');
  });

  it('shows no line about managing the members of a cluster', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'node QA-CL-A' }));
    await screen.findByRole('button', { name: 'pages.connectionMap.viewCluster' });
    expect(screen.queryByText('pages.connectionMap.clusterHint')).toBeNull();
  });

  it('keeps the overview for a server', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'node QA-VM1' }));
    fireEvent.click(await screen.findByRole('button', { name: 'pages.connectionMap.editServer' }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/it/assets/srv-1/overview'));
  });

  it('lists the applications of a cluster in its panel', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'node QA-CL-A' }));
    expect(await screen.findByRole('button', { name: 'CheeseTrack' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sage X3' })).toBeTruthy();
    expect(screen.queryByText('components.clusterAssignment.via')).toBeNull();
  });

  it('lists the applications of a member with the ones it inherits, through their cluster', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'node QA-VM1' }));
    const inheritedApp = await screen.findByRole('button', { name: 'CheeseTrack' });
    expect(screen.getByRole('button', { name: 'Intranet' })).toBeTruthy();
    const line = inheritedApp.parentElement as HTMLElement;
    expect(line.textContent).toBe('CheeseTrackcomponents.clusterAssignment.via QA-CL-A');
    expect(screen.getAllByText('components.clusterAssignment.via').length).toBe(1);
    expect(line.querySelector('a')?.getAttribute('href')).toBe('/it/assets/cl-1/overview');
  });
});
