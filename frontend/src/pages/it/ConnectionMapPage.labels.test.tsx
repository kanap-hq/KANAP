import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import i18n from '../../i18n';
import ConnectionMapPage from './ConnectionMapPage';

const get = vi.hoisted(() => vi.fn());
vi.mock('../../api', () => ({ default: { get } }));
vi.mock('./components/ConnectionMapGraph', () => ({
  default: () => <div data-testid="connection-map-graph" />,
}));
vi.mock('../../hooks/useApplicationClassificationCatalog', () => ({
  default: () => ({ data: { businessCriticalityLevels: [{ code: 'low', label: 'Faible' }] } }),
}));

const settings = vi.hoisted(() => ({
  data: {
    lifecycleStates: [{ code: 'active', label: 'Active' }],
    interfacePatterns: [{ code: 'rest_api_sync', label: 'REST API (sync)' }],
    entities: [],
    connectionTypes: [],
  },
}));
vi.mock('../../hooks/useItOpsSettings', () => ({
  useItOpsSettings: () => ({ data: settings.data }),
  default: () => ({ data: settings.data }),
}));

const MAP = {
  environment: 'prod',
  lifecycles: ['active'],
  nodes: [
    { id: 'srv-1', name: 'SRV-A', kind: 'server', environment: 'prod', network_segment: null, hosting_category: null },
    { id: 'srv-2', name: 'SRV-B', kind: 'server', environment: 'prod', network_segment: null, hosting_category: null },
  ],
  connections: [{
    id: 'c-1',
    connection_reference: 'CNX-1',
    name: 'Facturation',
    purpose: null,
    topology: 'server_to_server',
    lifecycle: 'active',
    criticality: 'low',
    data_class: 'internal',
    contains_pii: false,
    protocol_codes: [],
    protocol_labels: [],
    source_asset_id: 'srv-1',
    destination_asset_id: 'srv-2',
    server_ids: ['srv-1', 'srv-2'],
  }],
};

const APPS = [{ id: 'app-1', name: 'CheeseTrack', lifecycle: 'active', environments: ['prod', 'qa'] }];

const LINKED = [{
  id: 'l-1',
  binding_id: 'b-1',
  interface_id: 'i-1',
  interface_reference: 'INT-1',
  interface_name: 'Flux commandes',
  environment: 'prod',
  leg_type: 'direct',
  source_endpoint: null,
  target_endpoint: null,
  pattern: 'rest_api_sync',
  binding_status: 'active',
  interface_lifecycle: 'active',
  interface_criticality: 'low',
  interface_data_class: 'internal',
  interface_contains_pii: false,
}];

function renderPage() {
  get.mockImplementation(async (url: string) => {
    if (url === '/connections/map') return { data: MAP };
    if (url === '/applications/with-server-assignments') return { data: { items: APPS } };
    if (url === '/connections/c-1/interface-links') return { data: { items: LINKED } };
    return { data: { items: [] } };
  });
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/it/connection-map?focusConnectionId=c-1']}>
          <Routes>
            <Route path="/it/connection-map" element={<ConnectionMapPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

describe('ConnectionMapPage labels', () => {
  beforeEach(async () => {
    get.mockReset();
    await i18n.changeLanguage('fr');
  });

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage('en');
  });

  it('shows an application lifecycle by its label in the picker', async () => {
    renderPage();
    const picker = await screen.findByRole('combobox', { name: 'Applications' });
    fireEvent.mouseDown(picker);
    const option = await screen.findByRole('option', { name: /CheeseTrack/ });
    expect(option).toHaveTextContent('Actif · PROD, QA');
    expect(option.textContent).not.toMatch(/\bactive\b/);
  });

  it('shows a linked interface pattern by its label', async () => {
    renderPage();
    expect(await screen.findByText('Modèle : API REST (synchrone)')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('rest_api_sync');
  });
});
