import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { createAppTheme } from '../../config/ThemeContext';
import ConnectionWorkspacePage from './ConnectionWorkspacePage';

const wire = vi.hoisted(() => ({
  picked: {
    id: 'member-1',
    name: 'PAR-SQL-01',
    asset_reference: 'AST-1',
    environment: 'prod',
    kind: 'vm',
    provider: 'vmware',
  },
}));
const apiGet = vi.hoisted(() => vi.fn());
const apiPatch = vi.hoisted(() => vi.fn());

vi.mock('../../api', () => ({ default: { get: apiGet, patch: apiPatch, post: vi.fn(), delete: vi.fn() } }));
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
vi.mock('./workspace/ConnectionEndpointPicker', () => ({
  default: ({ label, onChange }: { label: string; onChange: (next: unknown, asset: unknown) => void }) => (
    <button type="button" onClick={() => onChange({ asset_id: wire.picked.id, entity_code: null }, wire.picked)}>
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
      <main>{props.children}</main>
    </div>
  ),
}));

const CLUSTER = {
  id: 'cl-1',
  name: 'PAR-SQL-CL01',
  asset_reference: 'AST-10',
  environment: 'prod',
  kind: 'vm',
  provider: 'vmware',
  is_cluster: true,
};

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

function renderPage() {
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <MemoryRouter initialEntries={['/it/connections/c-1/overview']}>
        <Routes>
          <Route path="/it/connections/:id/:tab" element={<ConnectionWorkspacePage />} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

describe('ConnectionWorkspacePage: connection to a cluster', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    apiGet.mockReset();
    apiPatch.mockReset();
    apiPatch.mockResolvedValue({ data: { ...CONNECTION, destination_asset_id: CLUSTER.id } });
    apiGet.mockImplementation(async (url: string) => {
      if (url === '/connections/c-1') return { data: CONNECTION };
      if (url === '/connections/c-1/interface-links') return { data: { items: [] } };
      if (url === '/assets/member-1/clusters') return { data: { items: [{ id: CLUSTER.id, name: CLUSTER.name, status: 'active' }] } };
      if (url === '/assets/cl-1/members') {
        return { data: { items: [
          { id: 'member-1', name: 'PAR-SQL-01', status: 'active' },
          { id: 'member-2', name: 'PAR-SQL-02', status: 'active' },
        ] } };
      }
      if (url === '/assets/cl-1') return { data: CLUSTER };
      return { data: { items: [] } };
    });
  });

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage('en');
  });

  it('writes the cluster when the member of a cluster is chosen as destination', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Destination' }));
    expect(await screen.findByText('Connect to the cluster?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Connect to the cluster' }));
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/connections/c-1', {
      destination_asset_id: CLUSTER.id,
      destination_entity_code: null,
    }));
    expect(apiPatch).not.toHaveBeenCalledWith('/connections/c-1', expect.objectContaining({
      destination_asset_id: wire.picked.id,
    }));
  });

  it('writes nothing when the question is cancelled', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Destination' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Connect to the cluster?')).toBeNull());
    expect(apiPatch).not.toHaveBeenCalled();
  });
});
