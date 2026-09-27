import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';

vi.mock('react-i18next', () => {
  const translation = { t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } };
  return { useTranslation: () => translation };
});
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
vi.mock('../../hooks/useCapexNav', () => ({
  useCapexNav: () => ({ index: 0, total: 0, hasPrev: false, hasNext: false, prevId: null, nextId: null }),
}));
vi.mock('../../hooks/useCurrencySettings', () => ({ default: () => ({ data: { defaultCapexCurrency: 'EUR' } }) }));
vi.mock('../workspace/hooks/useRecentlyViewed', () => ({ useRecentlyViewed: () => ({ addToRecent: vi.fn() }) }));
vi.mock('../../utils/workspaceTabCounts', () => ({ fetchCapexRelationsCount: vi.fn(async () => 0) }));
vi.mock('../portfolio/workspace/PortfolioDetailWorkspaceShell', () => ({
  default: ({ properties, actions, children, onTitleSave }: {
    properties?: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode; onTitleSave: (v: string) => void;
  }) => (
    <div>
      <button type="button" onClick={() => onTitleSave('New servers')}>set title</button>
      {actions}{properties}{children}
    </div>
  ),
}));
// The drawer stands in for the pickers: each button sets one create field.
vi.mock('./workspace/CapexPropertiesDrawer', () => ({
  default: (props: { mode: string; onPayingCompanyChange: (v: string) => void; onAnalyticsCategoryChange: (v: string) => void }) => (
    <div data-mode={props.mode}>
      <button type="button" onClick={() => props.onPayingCompanyChange('company-1')}>pick company</button>
      <button type="button" onClick={() => props.onAnalyticsCategoryChange('category-1')}>pick category</button>
    </div>
  ),
}));
vi.mock('./workspace/CapexMetadataBar', () => ({ default: () => null }));
vi.mock('../../components/workspace/SendLinkButton', () => ({ default: () => null }));
vi.mock('../../components/finance/BudgetTab', () => ({ default: () => null }));
vi.mock('../../components/finance/AllocationsTab', () => ({ default: () => null }));
vi.mock('./editors/RelationsPanel', () => ({ default: () => null }));
vi.mock('../../components/EntityTasksPanel', () => ({ default: () => null }));

import api from '../../api';
import CapexItemPage from './CapexItemPage';

const mocked = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };

function renderCreate() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter initialEntries={['/ops/capex/new/overview']}>
          <Routes>
            <Route path="/ops/capex/:id/:tab" element={<CapexItemPage />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('CapexItemPage create', () => {
  beforeEach(() => {
    mocked.get.mockReset();
    mocked.post.mockReset();
    mocked.get.mockResolvedValue({ data: {} });
    mocked.post.mockResolvedValue({ data: { id: 'new-id' } });
  });

  it('sends the analytics category picked in the drawer', async () => {
    renderCreate();
    expect(document.querySelector('[data-mode="create"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'set title' }));
    fireEvent.click(screen.getByRole('button', { name: 'pick company' }));
    fireEvent.click(screen.getByRole('button', { name: 'pick category' }));
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledTimes(1));
    expect(mocked.post.mock.calls[0][0]).toBe('/capex-items');
    expect(mocked.post.mock.calls[0][1]).toMatchObject({
      description: 'New servers',
      paying_company_id: 'company-1',
      analytics_category_id: 'category-1',
    });
    // The page moves on to the new line's workspace.
    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith('/capex-items/new-id'));
  });

  it('sends no analytics category when none is picked', async () => {
    renderCreate();
    fireEvent.click(screen.getByRole('button', { name: 'set title' }));
    fireEvent.click(screen.getByRole('button', { name: 'pick company' }));
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledTimes(1));
    expect(mocked.post.mock.calls[0][1]).toMatchObject({ analytics_category_id: null });
    // The page moves on to the new line's workspace.
    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith('/capex-items/new-id'));
  });
});
