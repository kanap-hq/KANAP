import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../../components/design';

const shell = vi.hoisted(() => ({ tabs: [] as Array<{ key: string; label: string; disabled?: boolean }> }));
const stableT = vi.hoisted(() => (key: string) => key);

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: stableT, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true, profile: { id: 'user-1' } }) }));
vi.mock('../../hooks/useItOpsEnumOptions', () => {
  const value = { settings: null, byField: { hostingType: [] } };
  return { default: () => value, useItOpsEnumOptions: () => value };
});
vi.mock('../../hooks/useModuleItemNav', () => ({
  useLocationItemNav: () => ({ total: 0, index: 0, hasPrev: false, hasNext: false, prevId: null, nextId: null }),
}));
vi.mock('../workspace/hooks/useRecentlyViewed', () => ({ useRecentlyViewed: () => ({ addToRecent: () => undefined }) }));
vi.mock('../../components/workspace/SendLinkButton', () => ({ default: () => null }));
vi.mock('./workspace/LocationPropertiesDrawer', () => ({ default: () => null }));
vi.mock('./workspace/LocationMetadataBar', () => ({ default: () => null }));
vi.mock('./workspace/LocationOverviewTab', () => ({ default: () => null }));
vi.mock('./workspace/LocationContactsTab', () => ({ default: () => null }));
vi.mock('./workspace/LocationRelationsTab', () => ({ default: () => null }));
vi.mock('../portfolio/workspace/PortfolioDetailWorkspaceShell', () => ({
  default: ({ children, tabs, onTabChange, activeTab }: {
    children: React.ReactNode;
    tabs: Array<{ key: string; label: string; disabled?: boolean }>;
    onTabChange: (tab: string) => void;
    activeTab: string;
  }) => {
    shell.tabs = tabs;
    return (
      <div>
        {tabs.map((tab) => (
          <button key={tab.key} disabled={tab.disabled} onClick={() => onTabChange(tab.key)}>{tab.key}</button>
        ))}
        <div data-testid="active-tab">{activeTab}</div>
        {children}
      </div>
    );
  },
}));
vi.mock('../../components/history/RecordHistoryTab', () => ({
  default: ({ table, recordId }: { table: string; recordId: string }) => (
    <div data-testid="record-history">{`${table}:${recordId}`}</div>
  ),
}));

import api from '../../api';
import LocationWorkspacePage from './LocationWorkspacePage';

const mocked = api as unknown as Record<'get', ReturnType<typeof vi.fn>>;
const LOCATION = {
  id: 'loc-1', location_reference: 'LOC-1', name: 'Paris DC', hosting_type: 'cloud',
  operating_company_id: null, country_iso: null, city: null, provider: null, region: null, additional_info: null,
};

function renderAt(path: string) {
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <KanapDialogProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/it/locations/:id/:tab" element={<LocationWorkspacePage />} />
          </Routes>
        </MemoryRouter>
      </KanapDialogProvider>
    </ThemeProvider>,
  );
}

describe('LocationWorkspacePage history tab', () => {
  beforeEach(() => {
    shell.tabs = [];
    vi.clearAllMocks();
    mocked.get.mockImplementation(async (url: string) => {
      if (url === '/locations/loc-1' || url === '/locations/LOC-1') return { data: LOCATION };
      if (url.endsWith('/sub-items')) return { data: [] };
      if (url.endsWith('/relation-counts')) return { data: { relations: 0 } };
      return { data: [] };
    });
  });

  it('adds the history tab last and hands it the site', async () => {
    renderAt('/it/locations/loc-1/overview');
    await screen.findByTestId('active-tab');
    expect(shell.tabs.map((tab) => tab.key)).toEqual(['overview', 'contacts', 'relations', 'history']);
    expect(shell.tabs.find((tab) => tab.key === 'history')?.label).toBe('workspace.location.tabs.history');

    fireEvent.click(screen.getByRole('button', { name: 'history' }));
    expect(await screen.findByTestId('record-history')).toHaveTextContent('locations:loc-1');
    expect(screen.getByTestId('active-tab')).toHaveTextContent('history');
  });

  it('disables the history tab on a create page and renders no history', async () => {
    renderAt('/it/locations/new/overview');
    await screen.findByTestId('active-tab');
    expect(shell.tabs.find((tab) => tab.key === 'history')?.disabled).toBe(true);
    expect(screen.queryByTestId('record-history')).toBeNull();
  });
});
