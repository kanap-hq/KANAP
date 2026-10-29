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
vi.mock('../../hooks/useModuleItemNav', () => ({
  useInterfaceItemNav: () => ({ total: 0, index: 0, hasPrev: false, hasNext: false, prevId: null, nextId: null }),
}));
vi.mock('../workspace/hooks/useRecentlyViewed', () => ({ useRecentlyViewed: () => ({ addToRecent: () => undefined }) }));
vi.mock('../../components/workspace/SendLinkButton', () => ({ default: () => null }));
vi.mock('./components/InterfaceBindingsMatrix', () => ({ default: () => null }));
vi.mock('./workspace/InterfaceFlowTab', () => ({ default: () => null }));
vi.mock('./workspace/InterfaceMappingTab', () => ({ default: () => null }));
vi.mock('./workspace/InterfaceMetadataBar', () => ({ default: () => null }));
vi.mock('./workspace/InterfaceOverviewTab', () => ({ default: () => null }));
vi.mock('./workspace/InterfacePropertyPanel', () => ({ default: () => null }));
vi.mock('./workspace/InterfaceRelationsTab', () => ({ default: () => null }));
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
import InterfaceWorkspacePage from './InterfaceWorkspacePage';

const mocked = api as unknown as Record<'get', ReturnType<typeof vi.fn>>;
const INTERFACE = {
  id: 'int-1',
  interface_reference: 'INT-1',
  interface_id: null,
  name: 'Orders sync',
  lifecycle: 'active',
  criticality: null,
  classification_incomplete: false,
  source_application_id: 'app-1',
  target_application_id: 'app-1',
  source_application_name: 'Ledger',
  target_application_name: 'Ledger',
  integration_route_type: 'direct',
  data_class: null,
  contains_pii: false,
  middleware_application_ids: [],
  legs: [],
  dependencies: [],
  links: [],
  attachments: [],
};

function renderAt(path: string) {
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/it/interfaces/:id/:tab" element={<InterfaceWorkspacePage />} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

describe('InterfaceWorkspacePage history tab', () => {
  beforeEach(() => {
    shell.tabs = [];
    vi.clearAllMocks();
    mocked.get.mockImplementation(async (url: string) => {
      if (url === '/interfaces/int-1') return { data: INTERFACE };
      return { data: [] };
    });
  });

  it('adds the history tab last and hands it the interface', async () => {
    renderAt('/it/interfaces/int-1/overview');
    await screen.findByTestId('active-tab');
    expect(shell.tabs.map((tab) => tab.key)).toEqual([
      'overview', 'flow', 'environments', 'data-mapping', 'relations', 'history',
    ]);
    expect(shell.tabs.find((tab) => tab.key === 'history')?.label).toBe('workspace.interface.tabs.history');

    fireEvent.click(screen.getByRole('button', { name: 'history' }));
    expect(await screen.findByTestId('record-history')).toHaveTextContent('interfaces:int-1');
    expect(screen.getByTestId('active-tab')).toHaveTextContent('history');
  });

  it('disables the history tab on a create page and renders no history', async () => {
    renderAt('/it/interfaces/new/overview');
    await screen.findByTestId('active-tab');
    expect(shell.tabs.find((tab) => tab.key === 'history')?.disabled).toBe(true);
    expect(screen.queryByTestId('record-history')).toBeNull();
  });
});
