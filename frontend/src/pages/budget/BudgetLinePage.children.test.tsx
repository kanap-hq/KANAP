import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KanapDialogProvider } from '../../components/design';
import { createAppTheme } from '../../config/ThemeContext';
import { DEFAULT_BUDGET_COLUMNS } from '../../services/budgetColumns';
import { resetSharedPatchBuffers } from '../../hooks/patchBuffer';
import api from '../../api';
import BudgetLinePage from './BudgetLinePage';
import { BUDGET_NATURE_CONFIG } from './natureConfig';

vi.mock('react-i18next', () => {
  const translation = { t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } };
  return { useTranslation: () => translation, Trans: () => null };
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
vi.mock('../portfolio/workspace/PortfolioDetailWorkspaceShell', () => ({
  default: ({ children, onTabChange }: { children: React.ReactNode; onTabChange: (tab: string) => void }) => (
    <div>
      {['overview', 'budget', 'allocations', 'relations'].map((tab) => <button key={tab} onClick={() => onTabChange(tab)}>{tab}</button>)}
      {children}
    </div>
  ),
}));

const mocked = vi.mocked(api);
const ID = '11111111-2222-3333-4444-555555555555';

describe.each(['opex', 'capex'] as const)('BudgetLinePage %s real child tabs', (nature) => {
  const config = BUDGET_NATURE_CONFIG[nature];
  beforeEach(() => {
    resetSharedPatchBuffers();
    mocked.get.mockReset(); mocked.post.mockReset(); mocked.patch.mockReset();
    mocked.get.mockImplementation(async (url) => {
      if (url === '/budget-lines/BL-127') return { data: { id: ID, nature, item_number: 127, product_name: 'Line', currency: 'EUR', effective_start: '2026-01-01' } } as never;
      if (url === '/budget-columns') return { data: DEFAULT_BUDGET_COLUMNS } as never;
      if (url === `${config.itemsApi}/${ID}/versions`) return { data: [{ id: 'version-1', budget_year: 2027, budget_rev: 1, allocation_method: 'default', allocation_driver: 'headcount' }] } as never;
      if (url === `${config.versionsApi}/version-1/amounts`) return { data: { items: [], totals: {}, round_inputs: [], budget_rev: 1 } } as never;
      if (url === `${config.versionsApi}/version-1/allocations`) return { data: { items: [], totals: {}, budget_rev: 1, base_signature: 'base' } } as never;
      if (url.endsWith('/links') || url.endsWith('/attachments') || url === '/working-day-profiles') return { data: [] } as never;
      return { data: { items: [] } } as never;
    });
    mocked.post.mockResolvedValue({ data: {} } as never);
  });

  it('keeps versions, amounts, allocations and relation writes on the configured child API', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ThemeProvider theme={createAppTheme('dark')}>
          <KanapDialogProvider><MemoryRouter initialEntries={[`/ops/budget/BL-127/budget?year=2027`]} useTransitions={false}>
            <Routes><Route path={`/ops/budget/:ref/:tab`} element={<BudgetLinePage nature={nature} />} /></Routes>
          </MemoryRouter></KanapDialogProvider>
        </ThemeProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith(`${config.itemsApi}/${ID}/versions`, expect.anything()));
    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith(`${config.versionsApi}/version-1/amounts`, expect.anything()));
    fireEvent.click(screen.getByRole('button', { name: 'allocations' }));
    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith(`${config.versionsApi}/version-1/allocations`, expect.anything()));
    fireEvent.click(screen.getByRole('button', { name: 'relations' }));
    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith(`${config.itemsApi}/${ID}/links`, expect.anything()));
    expect(mocked.get).toHaveBeenCalledWith(`${config.itemsApi}/${ID}/attachments`, expect.anything());
    fireEvent.click(screen.getByRole('button', { name: `${nature}.relations.addUrl` }));
    fireEvent.change(screen.getByPlaceholderText(`${nature}.relations.linkDescriptionPlaceholder`), { target: { value: 'Vendor' } });
    fireEvent.change(screen.getByPlaceholderText('https://...'), { target: { value: 'https://example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.add' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith(`${config.itemsApi}/${ID}/links`, { description: 'Vendor', url: 'https://example.com' }));
    const other = BUDGET_NATURE_CONFIG[config.otherNature];
    const urls = [...mocked.get.mock.calls, ...mocked.post.mock.calls, ...mocked.patch.mock.calls].map(([url]) => url);
    expect(urls.some((url) => url.startsWith(other.itemsApi) || url.startsWith(other.versionsApi))).toBe(false);
    expect(urls).not.toContain(`${config.itemsApi}/${ID}`);
    expect(urls).toContain('/budget-lines/BL-127');
  });
});
