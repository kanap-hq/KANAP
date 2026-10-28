import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KanapDialogProvider } from '../../components/design';
import { createAppTheme } from '../../config/ThemeContext';
import { resetSharedPatchBuffers } from '../../hooks/patchBuffer';
import api from '../../api';
import BudgetLinePage from './BudgetLinePage';

// The History tab of the budget line (lot 1C): it exists on the shelf, it routes like the other
// tabs, and it hands the line's table and identifier to the shared RecordHistory component.
const shell = vi.hoisted(() => ({ tabs: [] as Array<{ key: string; label: string }> }));

vi.mock('react-i18next', () => {
  const translation = { t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } };
  return {
    useTranslation: () => translation,
    Trans: () => null,
    initReactI18next: { type: '3rdParty', init: () => undefined },
  };
});
vi.mock('../../i18n/useLocale', () => ({ useLocale: () => 'en' }));
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), put: vi.fn() } }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'me' }, hasLevel: () => true }) }));
vi.mock('../../hooks/useBudgetLineNav', () => ({ useBudgetLineNav: () => ({ index: 0, total: 0 }) }));
vi.mock('../workspace/hooks/useRecentlyViewed', () => ({ useRecentlyViewed: () => ({ addToRecent: vi.fn() }) }));
vi.mock('./workspace/BudgetPropertiesDrawer', () => ({ default: () => null }));
vi.mock('./workspace/BudgetMetadataBar', () => ({ default: () => null }));
vi.mock('../../components/workspace/SendLinkButton', () => ({ default: () => null }));
vi.mock('../../components/finance/BudgetTrendChart', () => ({ default: () => null }));
vi.mock('../../components/contacts/ItemContactsSection', () => ({ default: () => null }));
vi.mock('../../components/EntityTasksPanel', () => ({ default: () => null }));
vi.mock('../../components/history/RecordHistory', () => ({
  default: ({ table, recordId }: { table: string; recordId: string }) => (
    <div data-testid="record-history">{`${table}:${recordId}`}</div>
  ),
}));
vi.mock('../portfolio/workspace/PortfolioDetailWorkspaceShell', () => ({
  default: ({ children, tabs, onTabChange, activeTab }: {
    children: React.ReactNode;
    tabs: Array<{ key: string; label: string }>;
    onTabChange: (tab: string) => void;
    activeTab: string;
  }) => {
    shell.tabs = tabs;
    return (
      <div>
        {tabs.map((tab) => <button key={tab.key} onClick={() => onTabChange(tab.key)}>{tab.key}</button>)}
        <div data-testid="active-tab">{activeTab}</div>
        {children}
      </div>
    );
  },
}));

const mocked = vi.mocked(api);
const ID = '11111111-2222-3333-4444-555555555555';

describe('BudgetLinePage history tab', () => {
  beforeEach(() => {
    resetSharedPatchBuffers();
    shell.tabs = [];
    mocked.get.mockReset();
    mocked.get.mockImplementation(async (url: string) => {
      if (url === '/budget-lines/BL-127') {
        return { data: { id: ID, nature: 'opex', item_number: 127, product_name: 'Line', currency: 'EUR', effective_start: '2026-01-01' } } as never;
      }
      if (url.endsWith('/relation-counts')) return { data: { total: 0 } } as never;
      return { data: { items: [] } } as never;
    });
  });

  it('adds the history tab last and gives it the line to read', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ThemeProvider theme={createAppTheme('light')}>
          <KanapDialogProvider>
            <MemoryRouter initialEntries={['/ops/budget/BL-127/overview']} useTransitions={false}>
              <Routes><Route path="/ops/budget/:ref/:tab" element={<BudgetLinePage nature="opex" />} /></Routes>
            </MemoryRouter>
          </KanapDialogProvider>
        </ThemeProvider>
      </QueryClientProvider>,
    );

    await screen.findByTestId('active-tab');
    expect(shell.tabs.map((tab) => tab.key)).toEqual(['overview', 'budget', 'allocations', 'relations', 'history']);
    expect(shell.tabs.find((tab) => tab.key === 'history')?.label).toBe('opex.tabs.history');

    fireEvent.click(screen.getByRole('button', { name: 'history' }));
    expect(await screen.findByTestId('record-history')).toHaveTextContent(`spend_items:${ID}`);
    expect(screen.getByTestId('active-tab')).toHaveTextContent('history');
  });
});
