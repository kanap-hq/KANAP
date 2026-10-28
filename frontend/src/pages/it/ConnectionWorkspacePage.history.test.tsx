import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';

const shell = vi.hoisted(() => ({ tabs: [] as Array<{ key: string; label: string; disabled?: boolean }> }));
const stableT = vi.hoisted(() => (key: string) => key);

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: stableT, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true, profile: { id: 'user-1' } }) }));
vi.mock('../../hooks/useApplicationClassificationCatalog', () => ({ default: () => ({ data: null }) }));
vi.mock('../../hooks/useItOpsEnumOptions', () => {
  const value = { settings: null, byField: {}, labelFor: (kind: string, code: string) => `${kind}:${code}` };
  return { default: () => value, useItOpsEnumOptions: () => value };
});
vi.mock('../../hooks/useModuleItemNav', () => ({
  useConnectionItemNav: () => ({ total: 0, index: 0, hasPrev: false, hasNext: false, prevId: null, nextId: null }),
}));
vi.mock('../workspace/hooks/useRecentlyViewed', () => ({ useRecentlyViewed: () => ({ addToRecent: () => undefined }) }));
vi.mock('../../components/workspace/SendLinkButton', () => ({ default: () => null }));
vi.mock('./workspace/ConnectionMetadataBar', () => ({ default: () => null }));
vi.mock('./workspace/ConnectionPropertiesDrawer', () => ({ default: () => null }));
vi.mock('./workspace/ConnectionOverviewTab', () => ({ default: () => null }));
vi.mock('./workspace/ConnectionPathTab', () => ({ default: () => null }));
vi.mock('./workspace/ConnectionEndpointPicker', () => ({ default: () => null }));
vi.mock('./workspace/ConnectionServersPicker', () => ({ default: () => null }));
vi.mock('./components/useClusterConnectionQuestion', () => ({
  default: () => ({ choose: vi.fn(), questionDialog: null }),
}));
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
import ConnectionWorkspacePage from './ConnectionWorkspacePage';

const mocked = api as unknown as Record<'get', ReturnType<typeof vi.fn>>;
const CONNECTION = {
  id: 'conn-1',
  connection_reference: 'CONN-1',
  name: 'Core link',
  description: null,
  topology: 'server_to_server',
  lifecycle: 'active',
  criticality: null,
  data_class: null,
  contains_pii: false,
  risk_mode: 'manual',
  source_asset_id: null,
  source_entity_code: null,
  destination_asset_id: null,
  destination_entity_code: null,
  protocol_codes: [],
  protocols: [],
  servers: [],
  legs: [],
  derived_interface_count: 0,
};

function renderAt(path: string) {
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/it/connections/:id/:tab" element={<ConnectionWorkspacePage />} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

describe('ConnectionWorkspacePage history tab', () => {
  beforeEach(() => {
    shell.tabs = [];
    vi.clearAllMocks();
    mocked.get.mockImplementation(async (url: string) => {
      if (url === '/connections/conn-1' || url === '/connections/CONN-1') return { data: CONNECTION };
      if (url === '/connections/conn-1/interface-links' || url === '/connections/CONN-1/interface-links') {
        return { data: { items: [] } };
      }
      return { data: [] };
    });
  });

  it('adds the history tab last and hands it the connection', async () => {
    renderAt('/it/connections/conn-1/overview');
    await screen.findByTestId('active-tab');
    expect(shell.tabs.map((tab) => tab.key)).toEqual(['overview', 'path', 'history']);
    expect(shell.tabs.find((tab) => tab.key === 'history')?.label).toBe('workspace.connection.tabs.history');

    fireEvent.click(screen.getByRole('button', { name: 'history' }));
    expect(await screen.findByTestId('record-history')).toHaveTextContent('connections:conn-1');
    expect(screen.getByTestId('active-tab')).toHaveTextContent('history');
  });

  it('disables the history tab on a create page and renders no history', async () => {
    renderAt('/it/connections/new/overview');
    await screen.findByTestId('active-tab');
    expect(shell.tabs.find((tab) => tab.key === 'history')?.disabled).toBe(true);
    expect(screen.queryByTestId('record-history')).toBeNull();
  });
});
