import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import i18n from '../../../i18n';
import InterfaceBindingsMatrix from './InterfaceBindingsMatrix';

const get = vi.hoisted(() => vi.fn());
vi.mock('../../../api', () => ({ default: { get, post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));

const settings = vi.hoisted(() => ({
  data: {
    lifecycleStates: [{ code: 'active', label: 'Active' }],
    interfacePatterns: [{ code: 'rest_api_sync', label: 'REST API (sync)' }],
  },
}));
vi.mock('../../../hooks/useItOpsSettings', () => ({
  useItOpsSettings: () => ({ data: settings.data }),
  default: () => ({ data: settings.data }),
}));

vi.mock('../../../hooks/useApplicationClassificationCatalog', () => ({
  default: () => ({
    data: {
      businessCriticalityLevels: [{ code: 'business_critical', label: 'Critique' }],
    },
  }),
}));

const CONNECTION = {
  id: 'cnx-1',
  connection_reference: 'CNX-4',
  name: 'Facturation',
  topology: 'server_to_server',
  lifecycle: 'active',
  criticality: 'business_critical',
};

function renderMatrix() {
  get.mockImplementation(async (url: string) => {
    if (url === '/interfaces/iface-1/bindings') return { data: { items: [] } };
    if (url === '/applications/app-src/instances') {
      return { data: [{ id: 'inst-src', application_id: 'app-src', environment: 'prod' }] };
    }
    if (url === '/applications/app-tgt/instances') {
      return { data: [{ id: 'inst-tgt', application_id: 'app-tgt', environment: 'prod' }] };
    }
    if (url === '/connections') return { data: { items: [CONNECTION] } };
    return { data: { items: [] } };
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter>
          <InterfaceBindingsMatrix
            interfaceId="iface-1"
            interfaceName="Commandes"
            sourceApplicationId="app-src"
            targetApplicationId="app-tgt"
            sourceApplicationName="Fromage"
            targetApplicationName="Compta"
            middlewareApplicationIds={[]}
            legs={[{
              id: 'leg-1',
              interface_id: 'iface-1',
              leg_type: 'direct',
              from_role: 'source',
              to_role: 'target',
              trigger_type: 'event_based',
              integration_pattern: 'rest_api_sync',
              data_format: 'json',
              job_name: null,
              order_index: 0,
            }]}
            integrationRouteType="direct"
          />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('InterfaceBindingsMatrix connection picker', () => {
  beforeEach(async () => {
    get.mockReset();
    await i18n.changeLanguage('fr');
  });

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage('en');
  });

  it('shows topology, lifecycle and criticality by their labels', async () => {
    renderMatrix();
    const addEnvironment = await screen.findByRole('button', { name: 'Ajouter un environnement' });
    await waitFor(() => expect(addEnvironment).toBeEnabled());
    fireEvent.click(addEnvironment);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /^Ajouter$/ }));

    fireEvent.click(await screen.findByRole('button', { name: /Cliquez pour ajouter/ }));
    const search = await screen.findByPlaceholderText('Rechercher une connexion');
    fireEvent.mouseDown(search);
    const option = await screen.findByRole('option', { name: /CNX-4/ });
    expect(option).toHaveTextContent('Serveur à serveur · Actif · Critique');
    expect(option.textContent).not.toMatch(/server_to_server|business_critical/);
    expect(option.textContent).not.toMatch(/\bactive\b/);
  });
});
