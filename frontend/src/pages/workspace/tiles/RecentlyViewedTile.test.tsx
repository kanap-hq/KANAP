import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';

const t = (key: string) => key;
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../../../auth/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'user-1' }, hasLevel: () => true }) }));
vi.mock('../../../tenant/TenantContext', () => ({ useTenant: () => ({ tenantSlug: 'fromage' }) }));
const api = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('../../../api', () => ({ default: { post: api.post } }));

import RecentlyViewedTile from './RecentlyViewedTile';

const KEY = 'kanap-recent-views:fromage:user-1';
const CONTRACT = '0b8e1c52-7a51-4c2e-9d3f-2f1f6a0c1a11';
const TASK = '5d3c7b21-1f0a-4e6b-8c2d-7e9a0b1c2d33';

function stubStorage(initial: Record<string, string>) {
  const values = new Map(Object.entries(initial));
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    get length() { return values.size; },
  });
  return values;
}

function renderTile() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter><RecentlyViewedTile config={{ limit: 5 }} /></MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('RecentlyViewedTile', () => {
  beforeEach(() => api.post.mockReset());

  it('drops the entries whose record no longer exists, with one call', async () => {
    const values = stubStorage({
      [KEY]: JSON.stringify([
        { type: 'task', id: TASK, label: 'Decide the renewal', ref: 'T-4', viewedAt: Date.now() },
        { type: 'contract', id: CONTRACT, label: 'SAP Maintenance', viewedAt: Date.now() - 1000 },
      ]),
    });
    // The task went with its contract's delete; the contract is still there.
    api.post.mockResolvedValue({ data: { existing: [{ type: 'contract', id: CONTRACT }] } });
    renderTile();
    await waitFor(() => expect(screen.queryByText('Decide the renewal')).toBeNull());
    expect(screen.getByText('SAP Maintenance')).toBeInTheDocument();
    // The contract, found once, is not asked about again.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/dashboard/recent-items/existing', {
      items: [{ type: 'task', id: TASK }, { type: 'contract', id: CONTRACT }],
    });
    expect(JSON.parse(values.get(KEY)!).map((item: { id: string }) => item.id)).toEqual([CONTRACT]);
  });

  it('keeps the list as it is when the check fails', async () => {
    stubStorage({ [KEY]: JSON.stringify([{ type: 'task', id: TASK, label: 'Decide the renewal', viewedAt: Date.now() }]) });
    api.post.mockRejectedValueOnce(new Error('Network Error'));
    renderTile();
    await waitFor(() => expect(api.post.mock.calls.length).toBe(1));
    expect(screen.getByText('Decide the renewal')).toBeInTheDocument();
  });
});
