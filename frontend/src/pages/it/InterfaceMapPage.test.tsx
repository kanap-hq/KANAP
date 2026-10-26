import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import InterfaceMapPage from './InterfaceMapPage';

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
vi.mock('./components/InterfaceMapGraph', () => ({
  default: (props: { nodes: Array<{ id: string; name: string }>; onSelectNode: (id: string) => void }) => (
    <div>{props.nodes.map((node) => <button key={node.id} onClick={() => props.onSelectNode(node.id)}>{`node ${node.name}`}</button>)}</div>
  ),
}));

const MAP = {
  environment: 'prod',
  lifecycles: ['active'],
  nodes: [{
    id: 'app-1', name: 'CheeseTrack', lifecycle: 'active', criticality: 'high', external_facing: false, is_middleware: false,
    in_degree: 0, out_degree: 0, total_interfaces: 0,
  }],
  interfaces: [],
  bindings: [],
};

// The servers of the application, as its summary answers: a cluster, the members that inherit it, a server of its own.
const SERVERS = [
  { id: 'cl-1', name: 'PAR-SQL-CL01', environment: 'prod', is_cluster: true, inherited: false, via_clusters: [] },
  { id: 'sql-1', name: 'PAR-SQL-01', environment: 'prod', is_cluster: false, inherited: true, via_clusters: [{ id: 'cl-1', name: 'PAR-SQL-CL01' }] },
  { id: 'sql-2', name: 'PAR-SQL-02', environment: 'prod', is_cluster: false, inherited: true, via_clusters: [{ id: 'cl-1', name: 'PAR-SQL-CL01' }] },
  { id: 'web-1', name: 'PAR-WEB-01', environment: 'prod', is_cluster: false, inherited: false, via_clusters: [] },
];

let servers: typeof SERVERS = SERVERS;

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

function renderPage() {
  get.mockImplementation(async (url: string) => {
    if (url === '/interfaces/map') return { data: MAP };
    if (url === '/applications/app-1/map-summary') {
      return {
        data: {
          id: 'app-1', name: 'CheeseTrack', description: null, editor: null, criticality: 'high',
          assigned_servers: servers, business_owners: [], it_owners: [], support_contacts: [],
        },
      };
    }
    return { data: { items: [] } };
  });
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/it/interface-map']}>
          <Routes>
            <Route path="/it/interface-map" element={<InterfaceMapPage />} />
            <Route path="/it/assets/:id/:tab" element={<Where />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

describe('InterfaceMapPage application panel', () => {
  beforeEach(() => { get.mockReset(); });

  it('lists the servers of a deployment with the cluster first and its members under it', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'node CheeseTrack' }));
    const cluster = await screen.findByRole('button', { name: 'PAR-SQL-CL01' });
    const names = screen.getAllByRole('button').map((button) => button.textContent).filter((text) => /^PAR-/.test(text ?? ''));
    expect(names).toEqual(['PAR-SQL-CL01', 'PAR-SQL-01', 'PAR-SQL-02', 'PAR-WEB-01']);
    expect(cluster.parentElement?.querySelector('[aria-label="pages.assets.columns.cluster"]')).toBeTruthy();
    expect(screen.getAllByLabelText('pages.assets.columns.cluster').length).toBe(1);
    const member = screen.getByRole('button', { name: 'PAR-SQL-01' }).parentElement as HTMLElement;
    expect(member.querySelector('svg')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'PAR-WEB-01' }).parentElement?.querySelector('svg')).toBeNull();
  });

  it('shows a server once when it comes with several roles', async () => {
    // The cluster carries two roles: it and each member come twice in the summary.
    servers = [...SERVERS, SERVERS[0], SERVERS[1], SERVERS[2]];
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'node CheeseTrack' }));
      await screen.findByRole('button', { name: 'PAR-SQL-CL01' });
      const names = screen.getAllByRole('button').map((button) => button.textContent).filter((text) => /^PAR-/.test(text ?? ''));
      expect(names).toEqual(['PAR-SQL-CL01', 'PAR-SQL-01', 'PAR-SQL-02', 'PAR-WEB-01']);
      expect(errors.mock.calls.some((call) => String(call[0]).includes('same key'))).toBe(false);
    } finally {
      servers = SERVERS;
      errors.mockRestore();
    }
  });

  it('opens the page of a member from its line', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'node CheeseTrack' }));
    fireEvent.click(await screen.findByRole('button', { name: 'PAR-SQL-02' }));
    expect(screen.getByTestId('where').textContent).toBe('/it/assets/sql-2/overview');
  });
});
