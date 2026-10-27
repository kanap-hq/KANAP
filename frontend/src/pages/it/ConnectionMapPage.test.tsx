import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import en from '../../locales/en/it.json';
import fr from '../../locales/fr/it.json';
import de from '../../locales/de/it.json';
import es from '../../locales/es/it.json';
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
const enums = vi.hoisted(() => ({
  settings: null,
  byField: {},
  labelFor: (field: string, code?: string | null) => (field === 'networkSegment' && code === 'dmz' ? 'DMZ' : ''),
  entityName: (_code: string, fallback?: string) => fallback ?? '',
}));
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

function renderPage(entry = '/it/connection-map', map: typeof MAP = MAP, summaries: Record<string, Record<string, unknown>> = {}) {
  get.mockImplementation(async (url: string) => {
    if (url === '/connections/map') return { data: map };
    if (url.endsWith('/map-summary')) {
      const id = url.split('/')[2];
      return { data: { id, name: id, kind: 'vm', environment: 'prod', operating_system: null, ip_addresses: null, network_segment: null, clusters: [], location_reference: null, location_name: null, assigned_applications: APPLICATIONS[id] ?? [], is_cluster: id === 'cl-1', ...summaries[id] } };
    }
    return { data: { items: [] } };
  });
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route path="/it/connection-map" element={<ConnectionMapPage />} />
            <Route path="/it/assets/:id/:tab" element={<Where />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

function warned(spy: { mock: { calls: unknown[][] } }) {
  return spy.mock.calls.map((call) => call.map((part) => String(part)).join(' ')).join('\n');
}

function fill(template: string, options?: Record<string, unknown>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ''));
}

describe('ConnectionMapPage server picker', () => {
  beforeEach(() => { get.mockReset(); translation.t = (key: string) => key; });

  it('opens the grouped server list without nesting options inside the group', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      renderPage();
      await screen.findByRole('button', { name: 'node QA-CL-A' });
      fireEvent.mouseDown(screen.getByRole('combobox', { name: 'pages.connectionMap.servers' }));
      expect(await screen.findByRole('option', { name: 'QA-VM1' })).toBeTruthy();
      expect(warned(errors)).not.toContain('validateDOMNesting');
    } finally {
      errors.mockRestore();
    }
  });

  it('shows the overflow chip from the French locale', async () => {
    const previous = translation.t;
    translation.t = (key: string, options?: Record<string, unknown>) => {
      if (key === 'pages.connectionMap.more') return fill(fr.pages.connectionMap.more, options);
      if (key === 'pages.connectionMap.removeServer') return fill(fr.pages.connectionMap.removeServer, options);
      return key;
    };
    try {
      const map = {
        ...MAP,
        nodes: [
          ...MAP.nodes,
          { id: 'srv-2', name: 'QA-VM2', kind: 'server' as const, environment: 'prod', network_segment: null, hosting_category: null },
        ],
      };
      renderPage('/it/connection-map?rootIds=cl-1,srv-1,srv-2', map);
      expect(await screen.findByRole('button', { name: '+2' })).toBeTruthy();
      expect(screen.queryByText('+2 more')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: '+2' }));
      expect(await screen.findByRole('button', { name: 'Retirer QA-VM2' })).toBeTruthy();
    } finally {
      translation.t = previous;
    }
  });
});

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
    fireEvent.click(await screen.findByRole('button', { name: 'pages.connectionMap.openServer' }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/it/assets/srv-1/overview'));
  });

  it('lists the applications of a cluster in its panel', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'node QA-CL-A' }));
    expect(await screen.findByRole('button', { name: 'CheeseTrack' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sage X3' })).toBeTruthy();
    expect(screen.queryByText('components.clusterAssignment.via')).toBeNull();
  });

  it('shows the IP addresses, the network segment and the clusters of a member', async () => {
    renderPage('/it/connection-map', MAP, {
      'srv-1': {
        ip_addresses: [
          { type: 'host', ip: '10.1.2.3', subnet_cidr: '10.1.2.0/24' },
          { type: 'management', ip: '  ', subnet_cidr: null },
          { type: 'iscsi', ip: '10.9.0.4', subnet_cidr: null },
        ],
        network_segment: 'dmz',
        clusters: [{ id: 'cl-9', name: 'QA-CL-Z' }],
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'node QA-VM1' }));
    const ipLine = () => screen.getByText('pages.connectionMap.ipAddress').parentElement?.textContent ?? '';
    await waitFor(() => expect(ipLine()).toContain('10.1.2.3, 10.9.0.4'));
    expect(ipLine()).not.toMatch(/10\.1\.2\.3,\s*,/);
    const segment = screen.getByText('pages.connectionMap.networkSegment');
    expect(segment.parentElement?.textContent).toContain('DMZ');
    const cluster = screen.getByText('pages.connectionMap.clusterLine');
    const link = cluster.parentElement?.querySelector('a');
    expect(link?.textContent).toBe('QA-CL-Z');
    expect(link?.getAttribute('href')).toBe('/it/assets/cl-9/overview');
  });

  it('shows a dash for the IP and the cluster when neither is known', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'node QA-VM1' }));
    const ip = await screen.findByText('pages.connectionMap.ipAddress');
    expect(ip.parentElement?.textContent).toContain('—');
    expect(ip.parentElement?.textContent).not.toContain('10.');
    const cluster = screen.getByText('pages.connectionMap.clusterLine');
    expect(cluster.parentElement?.textContent).toContain('—');
    expect(cluster.parentElement?.querySelector('a')).toBeNull();
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

describe('map panel open labels', () => {
  const maps = [en, fr, de, es];

  it('says Open for the four panel buttons, in every language, and keeps View cluster', () => {
    expect(maps.map((locale) => locale.pages.connectionMap.openServer)).toEqual([
      'Open server',
      'Ouvrir le serveur',
      'Server öffnen',
      'Abrir servidor',
    ]);
    expect(maps.map((locale) => locale.pages.connectionMap.openConnection)).toEqual([
      'Open connection',
      'Ouvrir la connexion',
      'Verbindung öffnen',
      'Abrir conexión',
    ]);
    expect(maps.map((locale) => locale.pages.interfaceMap.openApplication)).toEqual([
      'Open application',
      "Ouvrir l'application",
      'Anwendung öffnen',
      'Abrir aplicación',
    ]);
    expect(maps.map((locale) => locale.pages.interfaceMap.openInterface)).toEqual([
      'Open interface',
      "Ouvrir l'interface",
      'Schnittstelle öffnen',
      'Abrir interfaz',
    ]);
    expect(maps.map((locale) => locale.pages.interfaceMap.openConnection)).toEqual(
      maps.map((locale) => locale.pages.connectionMap.openConnection),
    );
    expect(maps.map((locale) => locale.pages.connectionMap.viewCluster)).toEqual([
      'View cluster',
      'Voir le cluster',
      'Cluster anzeigen',
      'Ver clúster',
    ]);
    expect(maps.map((locale) => locale.pages.connectionMap.more)).toEqual([
      '+{{count}}',
      '+{{count}}',
      '+{{count}}',
      '+{{count}}',
    ]);
    expect(maps.map((locale) => locale.pages.connectionMap.removeServer)).toEqual([
      'Remove {{name}}',
      'Retirer {{name}}',
      '{{name}} entfernen',
      'Quitar {{name}}',
    ]);
    for (const locale of maps) {
      expect(locale.pages.connectionMap).not.toHaveProperty('editServer');
      expect(locale.pages.connectionMap).not.toHaveProperty('editConnection');
      expect(locale.pages.interfaceMap).not.toHaveProperty('editApplication');
      expect(locale.pages.interfaceMap).not.toHaveProperty('editInterface');
    }
  });
});
