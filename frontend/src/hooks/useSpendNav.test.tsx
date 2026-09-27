import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => {
  const translation = { t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } };
  return { useTranslation: () => translation };
});
vi.mock('../api', () => ({ default: { get: vi.fn() } }));

import api from '../api';
import { useSpendNav } from './useSpendNav';
import { DEFAULT_BUDGET_COLUMNS, type BudgetColumnsSettings } from '../services/budgetColumns';

const get = (api as unknown as { get: ReturnType<typeof vi.fn> }).get;
let setting: BudgetColumnsSettings = DEFAULT_BUDGET_COLUMNS;

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);
const idsRequests = () => get.mock.calls.filter(([url]) => url === '/spend-items/summary/ids');

describe('useSpendNav', () => {
  beforeEach(() => {
    setting = DEFAULT_BUDGET_COLUMNS;
    get.mockReset();
    get.mockImplementation(async (url: string) => (url === '/budget-columns'
      ? { data: setting }
      : { data: { ids: ['a', 'b'], item_numbers: [1, 2] } }));
  });

  it('without a sort, walks the current default column, once the setting is known', async () => {
    setting = { ...DEFAULT_BUDGET_COLUMNS, default_column: 'committed' };
    renderHook(() => useSpendNav({ id: 'a', sort: null, statusScope: 'enabled' }), { wrapper });
    await waitFor(() => expect(idsRequests()).toHaveLength(1));
    expect(idsRequests()[0][1].params.sort).toBe('yRevision:DESC');
  });

  it('keeps a sort the user picked', async () => {
    setting = { ...DEFAULT_BUDGET_COLUMNS, default_column: 'committed' };
    renderHook(() => useSpendNav({ id: 'a', sort: 'yBudget:ASC', statusScope: 'enabled' }), { wrapper });
    await waitFor(() => expect(idsRequests()).toHaveLength(1));
    expect(idsRequests()[0][1].params.sort).toBe('yBudget:ASC');
  });
});
