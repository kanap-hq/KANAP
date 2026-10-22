import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import api from '../../../api';
import LocationRelationsTab from './LocationRelationsTab';

const rights = vi.hoisted(() => ({ locations: 'member' } as Record<string, string>));

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
      const rank: Record<string, number> = { reader: 1, contributor: 2, member: 3, admin: 4 };
      return (rank[rights[resource] ?? ''] ?? 0) >= (rank[level] ?? 0);
    },
  }),
}));
vi.mock('../../../hooks/useItOpsEnumOptions', () => ({
  default: () => ({ labelFor: (field: string, code?: string | null) => (code ? `${field}:${code}` : '') }),
}));
vi.mock('../../../hooks/useApplicationClassificationCatalog', () => ({ default: () => ({ data: null }) }));

const mocked = vi.mocked(api);

type Asset = {
  id: string; reference: string; name: string; kind: string; environment: string; status: string;
  provider: string | null; sub_location_id: string | null; sub_location_name: string | null;
};
type Application = { id: string; reference: string; name: string; lifecycle: string; status: string; environments: string[] };
type Relations = { assets: Asset[] | null; applications: Application[] | null };

const ASSETS: Asset[] = [
  {
    id: 'as-1', reference: 'AST-2', name: 'lyon-db01', kind: 'physical_server', environment: 'prod', status: 'active',
    provider: 'dell', sub_location_id: 'sub-1', sub_location_name: 'Room A',
  },
  {
    id: 'as-2', reference: 'AST-5', name: 'lyon-vm07', kind: 'virtual_machine', environment: 'dev', status: 'active',
    provider: null, sub_location_id: null, sub_location_name: null,
  },
];
const APPS: Application[] = [
  { id: 'app-1', reference: 'APP-4', name: 'SAP S/4HANA', lifecycle: 'active', status: 'enabled', environments: ['dev', 'prod'] },
];
const LINKS = [{ id: 'l-1', description: 'Vendor portal', url: 'https://me.example.com', created_at: '2026-10-01T10:00:00.000Z' }];

function Location() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderTab(data: Relations = { assets: ASSETS, applications: APPS }) {
  mocked.get.mockImplementation(async (url: string) => {
    if (url === '/locations/loc-1/relations') return { data } as never;
    if (url === '/locations/loc-1/links') return { data: LINKS } as never;
    return { data: [] } as never;
  });
  const onRelationsChange = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter>
          <LocationRelationsTab locationId="loc-1" onRelationsChange={onRelationsChange} />
          <Location />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { onRelationsChange };
}

const SECTION = (name: string) => `workspace.application.relations.sections.${name}`;
const COL = (name: string) => `workspace.application.relations.columns.${name}`;

describe('LocationRelationsTab', () => {
  beforeEach(() => {
    rights.locations = 'member';
    mocked.get.mockReset();
    mocked.post.mockReset();
    mocked.patch.mockReset();
    mocked.delete.mockReset();
    mocked.post.mockResolvedValue({ data: { id: 'l-2' } } as never);
    mocked.patch.mockResolvedValue({ data: { id: 'l-1' } } as never);
    mocked.delete.mockResolvedValue({ data: { ok: true } } as never);
  });

  it('shows the assets, the applications and the web links, read in one call', async () => {
    renderTab();
    await screen.findByText('lyon-db01');
    expect(screen.getAllByRole('region').map((region) => region.getAttribute('aria-label'))).toEqual([
      SECTION('assets'),
      SECTION('applications'),
      'linksAndFiles.linksTitle',
    ]);
    expect(mocked.get).toHaveBeenCalledWith('/locations/loc-1/relations');
    expect(mocked.get).not.toHaveBeenCalledWith('/locations/loc-1/servers');

    const assets = screen.getByRole('region', { name: SECTION('assets') });
    const headers = within(assets).getAllByRole('columnheader').map((cell) => cell.textContent);
    expect(headers).toEqual(expect.arrayContaining([
      COL('ref'), COL('name'), 'workspace.location.relations.subLocation', COL('type'),
      'pages.assets.columns.environment', 'workspace.location.relations.provider', COL('status'),
    ]));
    expect(within(assets).getByText('AST-2')).toBeTruthy();
    expect(within(assets).getByText('Room A')).toBeTruthy();
    expect(within(assets).getByText('serverKind:physical_server')).toBeTruthy();
    expect(within(assets).getByText('serverProvider:dell')).toBeTruthy();
    expect(within(assets).getByText('enums.environment.prod')).toBeTruthy();

    const applications = screen.getByRole('region', { name: SECTION('applications') });
    expect(within(applications).getByText('APP-4')).toBeTruthy();
    expect(within(applications).getByText('enums.environment.dev, enums.environment.prod')).toBeTruthy();
    expect(within(applications).getByText('lifecycleStatus:active')).toBeTruthy();
    expect(within(applications).getByText('workspace.location.relations.environments')).toBeTruthy();

    // Read only: no Add and no remove in either section.
    expect(screen.queryByText('workspace.application.relations.add')).toBeNull();
    expect(screen.queryByRole('button', { name: /relations\.remove/ })).toBeNull();
    // Web links only: no file chooser.
    expect(screen.queryByText('linksAndFiles.attachFile')).toBeNull();
    expect(screen.queryByLabelText('linksAndFiles.attachFile')).toBeNull();
  });

  it('opens the asset or the application of a row', async () => {
    renderTab();
    fireEvent.click(await screen.findByText('lyon-vm07'));
    expect(screen.getByTestId('location')).toHaveTextContent('/it/assets/AST-5/overview');
    fireEvent.click(screen.getByText('SAP S/4HANA'));
    expect(screen.getByTestId('location')).toHaveTextContent('/it/applications/APP-4/overview');
  });

  it('leaves the sub-location column out when no asset has one', async () => {
    renderTab({ assets: [ASSETS[1]], applications: [] });
    const assets = await screen.findByRole('region', { name: SECTION('assets') });
    await within(assets).findByText('lyon-vm07');
    expect(within(assets).queryByText('workspace.location.relations.subLocation')).toBeNull();
    expect(screen.getByText('workspace.location.relations.noApplications')).toBeTruthy();
  });

  it('leaves a null section out', async () => {
    renderTab({ assets: null, applications: APPS });
    await screen.findByText('SAP S/4HANA');
    expect(screen.queryByRole('region', { name: SECTION('assets') })).toBeNull();
    renderTab({ assets: ASSETS, applications: null });
    await screen.findByText('lyon-db01');
    expect(screen.getAllByRole('region', { name: SECTION('applications') })).toHaveLength(1);
  });

  it('saves a web link at once: add, edit and remove', async () => {
    const { onRelationsChange } = renderTab();
    expect(await screen.findByText('Vendor portal')).toBeTruthy();
    expect(screen.getByText('me.example.com')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'linksAndFiles.addLink' }));
    fireEvent.change(await screen.findByLabelText('linksAndFiles.columns.name'), { target: { value: 'Status page' } });
    fireEvent.change(screen.getByLabelText('linksAndFiles.url'), { target: { value: ' https://status.example.com ' } });
    fireEvent.click(screen.getByRole('button', { name: 'buttons.add' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/locations/loc-1/links', { url: 'https://status.example.com', description: 'Status page' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onRelationsChange).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'linksAndFiles.editLinkNamed(name=Vendor portal)' }));
    fireEvent.change(await screen.findByLabelText('linksAndFiles.url'), { target: { value: 'https://portal.example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/locations/loc-1/links/l-1', { url: 'https://portal.example.com', description: 'Vendor portal' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'linksAndFiles.removeNamed(name=Vendor portal)' }));
    await waitFor(() => expect(mocked.delete).toHaveBeenCalledWith('/locations/loc-1/links/l-1'));
    await waitFor(() => expect(onRelationsChange).toHaveBeenCalledTimes(3));
  });

  it('gives a reader the tables and the links without write actions', async () => {
    rights.locations = 'reader';
    renderTab();
    expect(await screen.findByText('Vendor portal')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'linksAndFiles.addLink' })).toBeNull();
    expect(screen.queryByRole('button', { name: /linksAndFiles\.editLinkNamed/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /linksAndFiles\.removeNamed/ })).toBeNull();
    fireEvent.click(screen.getByText('lyon-db01'));
    expect(screen.getByTestId('location')).toHaveTextContent('/it/assets/AST-2/overview');
  });
});
