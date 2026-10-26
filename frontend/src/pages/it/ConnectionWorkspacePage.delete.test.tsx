import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { createAppTheme } from '../../config/ThemeContext';
import ConnectionWorkspacePage from './ConnectionWorkspacePage';

const apiGet = vi.hoisted(() => vi.fn());

vi.mock('../../api', () => ({ default: { get: apiGet, patch: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
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
vi.mock('../workspace/hooks/useRecentlyViewed', () => ({ useRecentlyViewed: () => ({ addToRecent: vi.fn() }) }));
vi.mock('./workspace/ConnectionOverviewTab', () => ({ default: () => null }));
vi.mock('./workspace/ConnectionPathTab', () => ({ default: () => null }));
vi.mock('../portfolio/workspace/PortfolioDetailWorkspaceShell', () => ({
  default: (props: { title?: string; titleFallback?: string; actions?: React.ReactNode }) => (
    <div>
      <h1>{props.title || props.titleFallback}</h1>
      <header>{props.actions}</header>
    </div>
  ),
}));

const CONNECTION = {
  id: 'c-1',
  connection_reference: 'CONN-1',
  name: 'App to DB',
  description: null,
  topology: 'server_to_server',
  source_asset_id: null,
  source_entity_code: null,
  destination_asset_id: null,
  destination_entity_code: null,
  source_server: null,
  destination_server: null,
  servers: [],
  protocol_codes: ['https'],
  protocols: [{ code: 'https', port_override: null }],
  lifecycle: 'active',
  criticality: '',
  data_class: '',
  contains_pii: false,
  risk_mode: 'manual',
  effective_criticality: '',
  effective_data_class: '',
  effective_contains_pii: false,
  derived_interface_count: 0,
  legs: [] as Array<{ id: string; order_index: number }>,
  created_at: '2026-10-25T08:00:00.000Z',
  updated_at: '2026-10-25T08:00:00.000Z',
};

function hop(id: string, order: number) {
  return { id, order_index: order };
}

function binding(id: string) {
  return {
    id,
    binding_id: id,
    interface_id: `iface-${id}`,
    interface_name: `Interface ${id}`,
    environment: 'prod',
    leg_type: 'sync',
    source_endpoint: null,
    target_endpoint: null,
    pattern: '',
    binding_status: 'active',
  };
}

function renderPage() {
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/it/connections/c-1/overview']}>
          <Routes>
            <Route path="/it/connections/:id/:tab" element={<ConnectionWorkspacePage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

async function openDelete() {
  renderPage();
  expect(await screen.findByRole('heading', { name: 'App to DB' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
}

describe('ConnectionWorkspacePage delete confirmation', () => {
  beforeEach(async () => {
    apiGet.mockReset();
    await i18n.changeLanguage('en');
  });

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage('en');
  });

  it('names the hops deleted with the connection', async () => {
    apiGet.mockImplementation(async (url: string) => {
      if (url === '/connections/c-1') return { data: { ...CONNECTION, legs: [hop('h1', 1), hop('h2', 2)] } };
      if (url === '/connections/c-1/interface-links') return { data: { items: [] } };
      return { data: { items: [] } };
    });
    await openDelete();
    expect(await screen.findByText('This will permanently delete this connection and its 2 hops.')).toBeInTheDocument();
  });

  it('names the hops alongside the interface bindings', async () => {
    apiGet.mockImplementation(async (url: string) => {
      if (url === '/connections/c-1') return { data: { ...CONNECTION, legs: [hop('h1', 1)] } };
      if (url === '/connections/c-1/interface-links') return { data: { items: [binding('b1'), binding('b2')] } };
      return { data: { items: [] } };
    });
    await openDelete();
    expect(await screen.findByText(
      'This will permanently delete this connection and its 1 hop, and unlink it from 2 interface bindings. The interfaces themselves are not deleted.',
    )).toBeInTheDocument();
  });

  it('keeps the bindings sentence when the connection has no hops', async () => {
    apiGet.mockImplementation(async (url: string) => {
      if (url === '/connections/c-1') return { data: CONNECTION };
      if (url === '/connections/c-1/interface-links') return { data: { items: [binding('b1')] } };
      return { data: { items: [] } };
    });
    await openDelete();
    expect(await screen.findByText(
      'This will permanently delete this connection and unlink it from 1 interface binding. The interfaces themselves are not deleted.',
    )).toBeInTheDocument();
  });
});
