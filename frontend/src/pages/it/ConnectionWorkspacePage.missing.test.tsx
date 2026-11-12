import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../../components/design';
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
vi.mock('../portfolio/workspace/PortfolioDetailWorkspaceShell', () => ({
  default: (props: {
    title?: string;
    titleFallback?: string;
    tabs?: { key: string; label: string }[];
    actions?: React.ReactNode;
  }) => (
    <div>
      <h1>{props.title || props.titleFallback}</h1>
      <nav>
        {(props.tabs || []).map((tab) => (
          <button key={tab.key} type="button" role="tab">{tab.label}</button>
        ))}
      </nav>
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
  legs: [],
  created_at: '2026-10-25T08:00:00.000Z',
  updated_at: '2026-10-25T08:00:00.000Z',
};

const MISSING = '/it/connections/CONN-99999?sort=name&q=paris&ctx=abc';
const LIST = '/it/connections?sort=name&q=paris&ctx=abc';

function rejectRead(status: number, message?: string) {
  const error = new Error(message || `status ${status}`) as Error & {
    response?: { status: number; data?: { message?: string } };
  };
  error.response = { status, data: message ? { message } : {} };
  return error;
}

function renderAt(route: string) {
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <KanapDialogProvider>
          <MemoryRouter initialEntries={[route]}>
            <Routes>
              <Route path="/it/connections/:id" element={<ConnectionWorkspacePage />} />
              <Route path="/it/connections/:id/:tab" element={<ConnectionWorkspacePage />} />
            </Routes>
          </MemoryRouter>
        </KanapDialogProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

describe('ConnectionWorkspacePage missing connection', () => {
  beforeEach(async () => {
    apiGet.mockReset();
    await i18n.changeLanguage('en');
  });

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage('en');
  });

  it.each([
    ['en', 'Connection not found.', 'Back to the list', 'Untitled connection', 'Delete'],
    ['fr', 'Connexion introuvable.', 'Retour à la liste', 'Connexion sans nom', 'Supprimer'],
    ['de', 'Verbindung nicht gefunden.', 'Zurück zur Liste', 'Unbenannte Verbindung', 'Löschen'],
    ['es', 'Conexión no encontrada.', 'Volver a la lista', 'Conexión sin nombre', 'Eliminar'],
  ])('shows a not-found screen in %s, without the record', async (lang, notFound, back, untitled, deleteLabel) => {
    await i18n.changeLanguage(lang);
    apiGet.mockImplementation(async (url: string) => {
      if (url === '/connections/CONN-99999') throw rejectRead(404, 'Connection not found');
      return { data: { items: [] } };
    });
    renderAt(MISSING);
    expect(await screen.findByText(notFound)).toBeInTheDocument();
    expect(screen.queryByText('Connection not found', { exact: true })).toBeNull();
    expect(screen.queryByText(untitled)).toBeNull();
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByRole('button', { name: deleteLabel })).toBeNull();
    expect(screen.queryByRole('button', { name: /Retry|Réessayer|Erneut versuchen|Reintentar/ })).toBeNull();
    expect(screen.getByRole('link', { name: back })).toHaveAttribute('href', LIST);
  });

  it('shows the failure and a retry, and reads the connection again', async () => {
    let fail = true;
    apiGet.mockImplementation(async (url: string) => {
      if (url === '/connections/CONN-500') {
        if (fail) throw rejectRead(500, 'Database unavailable');
        return { data: CONNECTION };
      }
      if (url.endsWith('/interface-links')) return { data: { items: [] } };
      return { data: { items: [] } };
    });
    renderAt('/it/connections/CONN-500?sort=name');
    const retry = await screen.findByRole('button', { name: 'Retry' });
    expect(screen.getByText('Database unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Connection not found.')).toBeNull();
    expect(screen.queryByText('Untitled connection')).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Back to the list' })).toHaveAttribute('href', '/it/connections?sort=name');
    const reads = () => apiGet.mock.calls.filter(([url]) => url === '/connections/CONN-500').length;
    const before = reads();
    fail = false;
    fireEvent.click(retry);
    await waitFor(() => expect(reads()).toBe(before + 1));
    expect(await screen.findByRole('heading', { name: 'App to DB' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });
});
