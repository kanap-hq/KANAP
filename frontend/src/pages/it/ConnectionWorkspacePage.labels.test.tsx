import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { createAppTheme } from '../../config/ThemeContext';
import ConnectionWorkspacePage from './ConnectionWorkspacePage';

// A connection endpoint that is an entity shows the entity's name (the shipped "Internal Users" in
// the reader's language, a tenant entity under its own name), never its raw key; the protocols show
// their names, never their codes.
const CONNECTION = {
  id: 'c-1',
  connection_reference: 'CNX-1',
  name: 'Users to datacenter',
  topology: 'server_to_server',
  lifecycle: 'active',
  criticality: null,
  risk_mode: 'manual',
  protocol_codes: ['https', 'unknown'],
  source_asset_id: null,
  source_entity_code: 'internal_users',
  destination_asset_id: null,
  destination_entity_code: 'par_dc1',
  servers: [],
  legs: [],
};

const LINKED_INTERFACE = {
  id: 'l-1',
  binding_id: 'b-1',
  interface_id: 'i-1',
  interface_reference: 'INT-1',
  interface_name: 'Orders feed',
  environment: 'prod',
  leg_type: 'load',
  source_endpoint: null,
  target_endpoint: null,
  pattern: 'rest_api_sync',
  binding_status: 'active',
};

vi.mock('../../api', () => ({
  default: {
    get: vi.fn((url: string) => Promise.resolve({
      data: url === '/connections/c-1' ? CONNECTION : url.includes('interface-links') ? { items: [LINKED_INTERFACE] } : url === '/assets' ? { items: [] } : [],
    })),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));
vi.mock('../../hooks/useApplicationClassificationCatalog', () => ({ default: () => ({ data: undefined }) }));
vi.mock('../../hooks/useItOpsSettings', () => ({
  useItOpsSettings: () => ({
    data: {
      entities: [
        { code: 'internal_users', label: 'Internal Users' },
        { code: 'par_dc1', label: 'PAR-DC1' },
      ],
      connectionTypes: [
        { code: 'https', label: 'HTTPS' },
        { code: 'unknown', label: 'Unknown' },
      ],
      lifecycleStates: [{ code: 'active', label: 'Active' }],
      interfacePatterns: [{ code: 'rest_api_sync', label: 'REST API (sync)' }],
    },
  }),
}));
vi.mock('../../hooks/useModuleItemNav', () => ({
  useConnectionItemNav: () => ({ total: 0, index: 0, hasPrev: false, hasNext: false, prevId: null, nextId: null }),
}));
vi.mock('../workspace/hooks/useRecentlyViewed', () => ({ useRecentlyViewed: () => ({ addToRecent: vi.fn() }) }));
vi.mock('../portfolio/workspace/PortfolioDetailWorkspaceShell', () => ({
  default: (props: any) => (
    <div>
      <div>{props.metadata}</div>
      <aside>{props.properties}</aside>
      <main>{props.children}</main>
    </div>
  ),
}));

describe('ConnectionWorkspacePage endpoint and protocol names', () => {
  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage('en');
  });

  it('shows entity names and protocol names in the reader\'s language', async () => {
    await i18n.changeLanguage('fr');
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter initialEntries={['/it/connections/c-1/overview']}>
          <Routes>
            <Route path="/it/connections/:id/:tab" element={<ConnectionWorkspacePage />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Utilisateurs internes → PAR-DC1')).toBeInTheDocument();
    expect(screen.getByText('HTTPS, Inconnu')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('entity:');
  });

  it('shows the linked interface step and pattern by name, never their codes', async () => {
    await i18n.changeLanguage('fr');
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter initialEntries={['/it/connections/c-1/overview']}>
          <Routes>
            <Route path="/it/connections/:id/:tab" element={<ConnectionWorkspacePage />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Orders feed')).toBeInTheDocument();
    expect(screen.getByText('Chargement')).toBeInTheDocument();
    expect(screen.getByText('API REST (synchrone)')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('rest_api_sync');
    expect(document.body.textContent).not.toContain('LOAD');
  });
});
