import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import api from '../../../api';
import AssetDependenciesTab from './AssetDependenciesTab';
import { assetRelationsKey, type AssetRelationsData } from './assetRelationsData';

const rights = vi.hoisted(() => ({} as Record<string, string>));

const translation = {
  t: (key: string, opts?: Record<string, unknown>) => {
    const args = opts ? Object.entries(opts).filter(([name]) => name !== 'defaultValue').map(([name, value]) => `${name}=${value}`).join(',') : '';
    return args ? `${key}(${args})` : key;
  },
  i18n: { language: 'en', resolvedLanguage: 'en' },
};

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => translation,
}));
vi.mock('../../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({
    hasLevel: (resource: string, level: string) => {
      const rank: Record<string, number> = { reader: 1, contributor: 2, member: 3, manager: 3, admin: 4 };
      const current = rights[resource];
      if (!current) return false;
      return (rank[current] ?? 0) >= (rank[level] ?? 0);
    },
  }),
}));
vi.mock('../editors/AssetImpactSection', () => ({
  default: ({ assetId }: { assetId: string }) => <section aria-label="impact" data-asset={assetId} />,
}));
vi.mock('../../../hooks/useItOpsEnumOptions', () => ({
  default: () => ({ labelFor: (field: string, code?: string | null) => (code ? `${field}:${code}` : '') }),
}));

const mocked = vi.mocked(api);

const asset = (id: string, reference: string, name: string, status = 'active') => ({
  id, reference, name, kind: 'virtual_machine', environment: 'prod', status,
});

function relations(): AssetRelationsData {
  return {
    year: 2026,
    budget_column: { key: 'budget', label: 'Budget' },
    assets: {
      contains: [asset('as-2', 'AST-2', 'vm-app-01')],
      contained_by: [asset('as-3', 'AST-3', 'esx-host-01')],
      depends_on: [asset('as-4', 'AST-4', 'san-01')],
      depended_on_by: [asset('as-5', 'AST-5', 'backup-01', 'retired')],
    },
    budget_lines: [],
    contracts: [],
    projects: [],
    tasks: [],
    incidents: [],
    counts: { assets: 4, total: 0 },
  };
}

function Location() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderTab(clusterSection?: React.ReactNode) {
  mocked.get.mockImplementation(async (url: string) => {
    if (url === '/assets/as-1/relations-tab') return { data: relations() } as never;
    if (url === '/assets') {
      return { data: { items: [
        { id: 'as-1', name: 'this-server', asset_reference: 'AST-1' },
        { id: 'as-2', name: 'vm-app-01', asset_reference: 'AST-2' },
        { id: 'as-9', name: 'edge-fw', asset_reference: 'AST-9' },
      ] } } as never;
    }
    return { data: [] } as never;
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter>
          <AssetDependenciesTab assetId="as-1" clusterSection={clusterSection} />
          <Location />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  const invalidated = (key: readonly unknown[]) =>
    invalidate.mock.calls.some(([filters]) => JSON.stringify(filters?.queryKey) === JSON.stringify(key));
  return { client, invalidated };
}

const A = (name: string) => `workspace.asset.relations.${name}`;

describe('AssetDependenciesTab', () => {
  beforeEach(() => {
    for (const key of Object.keys(rights)) delete rights[key];
    Object.assign(rights, { infrastructure: 'member' });
    mocked.get.mockReset();
    mocked.post.mockReset();
    mocked.delete.mockReset();
    mocked.post.mockResolvedValue({ data: { ok: true, changed: true } } as never);
    mocked.delete.mockResolvedValue({ data: { ok: true, changed: true } } as never);
  });

  it('shows the impact, the cluster slot, then the four directions in order', async () => {
    renderTab(<section aria-label="cluster-slot" />);
    await screen.findByText('vm-app-01');

    expect(screen.getAllByRole('region').map((region) => region.getAttribute('aria-label'))).toEqual([
      'impact', 'cluster-slot', A('contains'), A('containedBy'), A('dependsOn'), A('dependedOnBy'),
    ]);
    expect(mocked.get).toHaveBeenCalledWith('/assets/as-1/relations-tab');

    const contains = screen.getByRole('region', { name: A('contains') });
    expect(within(contains).getByText('AST-2')).toBeTruthy();
    expect(within(contains).getByText('serverKind:virtual_machine')).toBeTruthy();
    expect(within(contains).getByText('enums.environment.prod')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: A('containedBy') })).getByText('esx-host-01')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: A('dependsOn') })).getByText('san-01')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: A('dependedOnBy') })).getByText('backup-01')).toBeTruthy();

    fireEvent.click(within(screen.getByRole('region', { name: A('containedBy') })).getByText('esx-host-01'));
    expect(screen.getByTestId('location')).toHaveTextContent('/it/assets/AST-3/overview');
  });

  it('explains Contains in a tooltip on its title, and no other direction', async () => {
    renderTab();
    await screen.findByText('vm-app-01');
    const contains = screen.getByRole('region', { name: A('contains') });
    expect(within(contains).getByLabelText('workspace.asset.relations.containsHint')).toBeTruthy();
    expect(screen.getAllByLabelText('workspace.asset.relations.containsHint')).toHaveLength(1);
  });

  it('renders without a cluster slot by default', async () => {
    renderTab();
    await screen.findByText('vm-app-01');
    expect(screen.getAllByRole('region').map((region) => region.getAttribute('aria-label'))).toEqual([
      'impact', A('contains'), A('containedBy'), A('dependsOn'), A('dependedOnBy'),
    ]);
  });

  it('links in each direction without offering the asset itself or a row already linked, and reads the relations and the impact of every asset again', async () => {
    const { invalidated } = renderTab();
    await screen.findByText('vm-app-01');
    expect(invalidated(['asset-impact'])).toBe(false);

    fireEvent.click(within(screen.getByRole('region', { name: A('contains') })).getByText('workspace.application.relations.add'));
    expect(await screen.findByRole('option', { name: /edge-fw/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /this-server/ })).toBeNull();
    expect(screen.queryByRole('option', { name: /vm-app-01/ })).toBeNull();
    fireEvent.click(screen.getByRole('option', { name: /edge-fw/ }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/assets/as-1/relations/contains', { id: 'as-9' }));
    await waitFor(() => expect(invalidated(['asset-impact'])).toBe(true));
    // The other asset of the relation reads its relations again too.
    expect(invalidated(['asset-relations-tab'])).toBe(true);
    expect(invalidated(assetRelationsKey('as-1'))).toBe(true);

    for (const [section, kind] of [[A('containedBy'), 'contained_by'], [A('dependsOn'), 'depends_on'], [A('dependedOnBy'), 'depended_on_by']] as const) {
      const region = screen.getByRole('region', { name: section });
      fireEvent.click(within(region).getByText('workspace.application.relations.add'));
      fireEvent.click(await screen.findByRole('option', { name: /edge-fw/ }));
      await waitFor(() => expect(mocked.post).toHaveBeenCalledWith(`/assets/as-1/relations/${kind}`, { id: 'as-9' }));
    }
  });

  it('unlinks at once, reads the relations and the impact of every asset again, and restores the row when the server refuses', async () => {
    const { invalidated } = renderTab();
    let reject: (error: unknown) => void = () => undefined;
    mocked.delete.mockReturnValue(new Promise((_, next) => { reject = next; }) as never);
    fireEvent.click(await screen.findByRole('button', { name: 'workspace.application.relations.remove(name=san-01)' }));

    expect(mocked.delete).toHaveBeenCalledWith('/assets/as-1/relations/depends_on/as-4');
    await waitFor(() => expect(screen.queryByText('san-01')).toBeNull());
    expect(screen.getByText('vm-app-01')).toBeTruthy();

    reject({ response: { status: 500, data: { message: 'Server down' } } });
    expect(await screen.findByText('san-01')).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(invalidated(assetRelationsKey('as-1'))).toBe(false);

    mocked.delete.mockResolvedValue({ data: { ok: true, changed: true } } as never);
    fireEvent.click(screen.getByRole('button', { name: 'workspace.application.relations.remove(name=backup-01)' }));
    await waitFor(() => expect(mocked.delete).toHaveBeenCalledWith('/assets/as-1/relations/depended_on_by/as-5'));
    await waitFor(() => expect(invalidated(['asset-impact'])).toBe(true));
    // The other asset of the relation reads its relations again too.
    expect(invalidated(['asset-relations-tab'])).toBe(true);
    expect(invalidated(assetRelationsKey('as-1'))).toBe(true);
  });

  it('gives a reader the tables and the navigation only', async () => {
    rights.infrastructure = 'reader';
    renderTab();
    await screen.findByText('vm-app-01');
    expect(screen.queryByText('workspace.application.relations.add')).toBeNull();
    expect(screen.queryByRole('button', { name: /relations\.remove/ })).toBeNull();
    fireEvent.click(screen.getByText('san-01'));
    expect(screen.getByTestId('location')).toHaveTextContent('/it/assets/AST-4/overview');
  });
});
