import React from 'react';
import '../../i18n';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../../components/design';
import ItOperationsSettingsPage from './ItOperationsSettingsPage';

const rights = vi.hoisted(() => ({ settings: true, infrastructureAdmin: false }));

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    hasLevel: (resource: string, level: string) => (
      (resource === 'settings' && level === 'reader' && rights.settings)
      || (resource === 'infrastructure' && level === 'admin' && rights.infrastructureAdmin)
    ),
  }),
}));

const loaded = vi.hoisted(() => ({
  settings: {
    adminZones: [], applicationCategories: [], dataClasses: [], networkSegments: [], entities: [], serverKinds: [],
    serverProviders: [], serverRoles: [], hostingTypes: [], lifecycleStates: [], interfaceProtocols: [],
    interfaceDataCategories: [], interfaceTriggerTypes: [], interfacePatterns: [], interfaceFormats: [],
    interfaceAuthModes: [], connectionTypes: [], subnets: [], domains: [], ipAddressTypes: [],
    accessMethods: [], incidentCategories: [], technologyFamilies: [],
    businessCriticalityLevels: [], cyberCriticalityLevels: [], recoveryWaves: [],
    lockedCodes: {}, protectedCodes: {},
  },
}));

vi.mock('../../hooks/useItOpsSettings', () => ({
  default: () => ({ data: loaded.settings, isError: false }),
}));

vi.mock('../../hooks/useLocationOptions', () => ({
  useLocationOptions: () => ({ data: [] }),
}));

vi.mock('./NetboxSyncPage', () => ({
  NetboxSyncPanel: () => <div>netbox panel</div>,
}));

function Where() {
  const { pathname, search } = useLocation();
  return <><div data-testid="path">{pathname}</div><div data-testid="search">{search}</div></>;
}

function renderPage(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={client}>
        <KanapDialogProvider>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path="/it/settings" element={<ItOperationsSettingsPage />} />
              <Route path="/it/settings/:tab" element={<ItOperationsSettingsPage />} />
            </Routes>
            <Where />
          </MemoryRouter>
        </KanapDialogProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

function path(): string {
  return screen.getByTestId('path').textContent || '';
}

function params(): URLSearchParams {
  return new URLSearchParams(screen.getByTestId('search').textContent || '');
}

describe('IT settings tabs', () => {
  afterEach(() => {
    rights.settings = true;
    rights.infrastructureAdmin = false;
  });

  it('opens Lists, in the address, for someone who can read the lists', async () => {
    renderPage('/it/settings');
    expect(screen.getByRole('heading', { level: 1, name: 'IT landscape settings' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Lists', selected: true })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Netbox' })).not.toBeInTheDocument();
    expect(screen.getByText('Servers & connections')).toBeInTheDocument();
    expect(screen.queryByText('netbox panel')).not.toBeInTheDocument();
    await waitFor(() => expect(path()).toBe('/it/settings/lists'));
    expect(params().get('tab')).toBeNull();
  });

  it('shows only Netbox to an infrastructure administrator, and records that tab in the address', async () => {
    rights.settings = false;
    rights.infrastructureAdmin = true;
    renderPage('/it/settings?state=missing');

    expect(screen.getByRole('tab', { name: 'Netbox', selected: true })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Lists' })).not.toBeInTheDocument();
    expect(screen.getByText('netbox panel')).toBeInTheDocument();
    expect(screen.queryByText('Servers & connections')).not.toBeInTheDocument();
    await waitFor(() => expect(path()).toBe('/it/settings/netbox'));
    expect(params().get('state')).toBe('missing');
    expect(params().has('tab')).toBe(false);
  });

  it('replaces the former ?tab=netbox, shows both tabs and keeps the Netbox record filter when switching', async () => {
    rights.infrastructureAdmin = true;
    renderPage('/it/settings?tab=netbox&state=linked');

    expect(screen.getByRole('tab', { name: 'Lists' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Netbox', selected: true })).toBeInTheDocument();
    expect(screen.getByText('netbox panel')).toBeInTheDocument();
    await waitFor(() => expect(path()).toBe('/it/settings/netbox'));
    expect(params().has('tab')).toBe(false);
    expect(params().get('state')).toBe('linked');

    fireEvent.click(screen.getByRole('tab', { name: 'Lists' }));
    expect(screen.getByRole('tab', { name: 'Lists', selected: true })).toBeInTheDocument();
    expect(screen.getByText('Servers & connections')).toBeInTheDocument();
    expect(screen.queryByText('netbox panel')).not.toBeInTheDocument();
    await waitFor(() => expect(path()).toBe('/it/settings/lists'));
    expect(params().get('state')).toBe('linked');

    fireEvent.click(screen.getByRole('tab', { name: 'Netbox' }));
    expect(screen.getByText('netbox panel')).toBeInTheDocument();
    await waitFor(() => expect(path()).toBe('/it/settings/netbox'));
    expect(params().get('state')).toBe('linked');
  });

  it('opens the lists when Netbox was requested and the user cannot open it', async () => {
    renderPage('/it/settings/netbox?state=error');
    expect(screen.getByRole('tab', { name: 'Lists', selected: true })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Netbox' })).not.toBeInTheDocument();
    expect(screen.queryByText('netbox panel')).not.toBeInTheDocument();
    await waitFor(() => expect(path()).toBe('/it/settings/lists'));
    expect(params().get('state')).toBe('error');
  });

  it('replaces an unknown tab with the first one the person may open', async () => {
    rights.settings = false;
    rights.infrastructureAdmin = true;
    renderPage('/it/settings/colours');
    expect(screen.getByRole('tab', { name: 'Netbox', selected: true })).toBeInTheDocument();
    await waitFor(() => expect(path()).toBe('/it/settings/netbox'));
  });

  it('refuses the page when neither tab is allowed', () => {
    rights.settings = false;
    renderPage('/it/settings');
    expect(screen.getByText('Access denied')).toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  });
});
