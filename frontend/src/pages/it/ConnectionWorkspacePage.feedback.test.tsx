import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { createAppTheme } from '../../config/ThemeContext';
import { NotifyProvider } from '../../components/notify/NotifyProvider';
import ConnectionWorkspacePage from './ConnectionWorkspacePage';

const apiGet = vi.hoisted(() => vi.fn());
const apiPatch = vi.hoisted(() => vi.fn());
const apiPost = vi.hoisted(() => vi.fn());

vi.mock('../../api', () => ({ default: { get: apiGet, patch: apiPatch, post: apiPost, delete: vi.fn() } }));
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
// One plain pick: no cluster question here, the write goes straight to the page.
vi.mock('./workspace/ConnectionEndpointPicker', () => ({
  default: ({ label, onChange }: { label: string; onChange: (next: unknown) => void }) => (
    <button type="button" onClick={() => onChange({ asset_id: 'member-1', entity_code: null })}>
      {label}
    </button>
  ),
}));
vi.mock('./workspace/ConnectionMetadataBar', () => ({ default: () => null }));
vi.mock('./workspace/ConnectionPropertiesDrawer', () => ({ default: () => null }));
vi.mock('../../components/MarkdownEditor', () => ({ default: () => null }));
vi.mock('../../components/EntityKnowledgePanel', () => ({ default: () => null }));
vi.mock('./workspace/ConnectionLinkInterfacesDialog', () => ({ default: () => null }));
vi.mock('../portfolio/workspace/PortfolioDetailWorkspaceShell', () => ({
  default: (props: any) => (
    <div>
      <nav>{props.tabs.map((tab: any) => <span key={tab.key}>{tab.label}</span>)}</nav>
      <h1>{props.title || props.titleFallback}</h1>
      <header>{props.actions}</header>
      <div data-testid="workspace-notices">{props.notices}</div>
      <main>{props.children}</main>
    </div>
  ),
}));

const CONNECTION = {
  id: 'c-1',
  connection_reference: 'CONN-1',
  name: 'App to DB',
  description: null,
  topology: 'server_to_server',
  source_asset_id: 'srv-src',
  source_entity_code: null,
  destination_asset_id: null,
  destination_entity_code: null,
  source_server: {
    id: 'srv-src',
    name: 'APP-01',
    asset_reference: 'AST-2',
    environment: 'prod',
    kind: 'vm',
    provider: 'vmware',
    is_cluster: false,
  },
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

function renderPage(route = '/it/connections/c-1/overview') {
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <NotifyProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path="/it/connections/:id/:tab" element={<ConnectionWorkspacePage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
      </NotifyProvider>
    </ThemeProvider>,
  );
}

const chooseDestination = async () => {
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: /Destination|Ziel|Destino/ }));
};

describe('ConnectionWorkspacePage: connection refusals and absorbed members', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPatch.mockReset();
    apiPost.mockReset();
    apiGet.mockImplementation(async (url: string) => {
      if (url === '/connections/c-1') return { data: CONNECTION };
      if (url === '/connections/c-1/interface-links') return { data: { items: [] } };
      return { data: { items: [] } };
    });
  });

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage('en');
  });

  it.each([
    ['en', 'The source and the destination are the same asset.'],
    ['fr', 'La source et la destination sont le même actif.'],
  ])('shows the same-endpoint refusal in %s', async (lang, text) => {
    await i18n.changeLanguage(lang);
    apiPatch.mockRejectedValue({ response: { status: 400, data: { code: 'connection_same_endpoint' } } });
    await chooseDestination();
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it('shows the create refusal above the form, where the Create button is', async () => {
    apiPost.mockRejectedValue({ response: { status: 400, data: { code: 'connection_same_endpoint' } } });
    renderPage('/it/connections/new/overview');
    fireEvent.change(await screen.findByPlaceholderText('e.g., App tier to DB tier'), { target: { value: 'Same endpoint' } });
    fireEvent.click(screen.getByRole('button', { name: 'Source' }));
    fireEvent.click(screen.getByRole('button', { name: 'Destination' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('The source and the destination are the same asset.');
    // The refusal is in the shell's notice slot, under the title, and stays out of the form.
    expect(screen.getByTestId('workspace-notices')).toContainElement(alert);
    expect(alert.closest('main')).toBeNull();
  });

  it('names the members the server left out of the list', async () => {
    apiPatch.mockResolvedValue({
      data: {
        ...CONNECTION,
        absorbed: [{ asset_id: 'member-1', name: 'PAR-SQL-01', cluster_id: 'cl-1', cluster_name: 'PAR-SQL-CL01' }],
      },
    });
    await chooseDestination();
    expect(await screen.findByText('PAR-SQL-01 was removed from the list: it is covered by PAR-SQL-CL01.')).toBeInTheDocument();
  });

  it('says nothing when no member was left out', async () => {
    apiPatch.mockResolvedValue({ data: { ...CONNECTION, absorbed: [] } });
    await chooseDestination();
    await waitFor(() => expect(apiPatch).toHaveBeenCalled());
    expect(screen.queryByText(/removed from the list/)).toBeNull();
  });
});
