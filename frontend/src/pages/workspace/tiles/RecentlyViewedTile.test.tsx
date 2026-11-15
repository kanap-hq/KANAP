import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import { KanapDialogProvider } from '../../../components/design';

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

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

function renderTile() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>
        <KanapDialogProvider>
          <MemoryRouter>
            <Where />
            <Routes><Route path="*" element={<RecentlyViewedTile config={{ limit: 5 }} />} /></Routes>
          </MemoryRouter>
        </KanapDialogProvider>
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

  it('shows suppliers, contacts and departments with their reference, and opens them', async () => {
    const SUPPLIER = '7a1e2b3c-4d5e-4f60-8a7b-1c2d3e4f5a61';
    const CONTACT = '7a1e2b3c-4d5e-4f60-8a7b-1c2d3e4f5a62';
    const DEPARTMENT = '7a1e2b3c-4d5e-4f60-8a7b-1c2d3e4f5a63';
    stubStorage({
      [KEY]: JSON.stringify([
        { type: 'supplier', id: SUPPLIER, label: 'Fromagerie Bleue', ref: 'SUP-12', viewedAt: Date.now() },
        { type: 'contact', id: CONTACT, label: 'Ana Lopez', ref: 'CTCT-3', viewedAt: Date.now() - 1000 },
        { type: 'department', id: DEPARTMENT, label: 'Finance', ref: 'DEPT-7', viewedAt: Date.now() - 2000 },
      ]),
    });
    api.post.mockResolvedValue({ data: { existing: [
      { type: 'supplier', id: SUPPLIER }, { type: 'contact', id: CONTACT }, { type: 'department', id: DEPARTMENT },
    ] } });
    renderTile();
    expect(screen.getByText('SUP-12')).toBeInTheDocument();
    expect(screen.getByText('CTCT-3')).toBeInTheDocument();
    expect(screen.getByText('DEPT-7')).toBeInTheDocument();
    expect(screen.getByText(/dashboard\.tiles\.entityTypes\.supplier/)).toBeInTheDocument();
    expect(screen.getByText(/dashboard\.tiles\.entityTypes\.contact/)).toBeInTheDocument();
    expect(screen.getByText(/dashboard\.tiles\.entityTypes\.department/)).toBeInTheDocument();
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    // Confirmed by the check: they stay.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByText('Fromagerie Bleue')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Fromagerie Bleue'));
    expect(screen.getByTestId('where')).toHaveTextContent(`/master-data/suppliers/${SUPPLIER}`);
    fireEvent.click(screen.getByText('Ana Lopez'));
    expect(screen.getByTestId('where')).toHaveTextContent(`/master-data/contacts/${CONTACT}`);
    fireEvent.click(screen.getByText('Finance'));
    // The department page opens by its reference.
    expect(screen.getByTestId('where')).toHaveTextContent('/master-data/departments/DEPT-7');
  });

  it('keeps the list as it is when the check fails', async () => {
    stubStorage({ [KEY]: JSON.stringify([{ type: 'task', id: TASK, label: 'Decide the renewal', viewedAt: Date.now() }]) });
    api.post.mockRejectedValueOnce(new Error('Network Error'));
    renderTile();
    await waitFor(() => expect(api.post.mock.calls.length).toBe(1));
    expect(screen.getByText('Decide the renewal')).toBeInTheDocument();
  });

  it('clears the history once the confirmation is accepted', async () => {
    const values = stubStorage({ [KEY]: JSON.stringify([{ type: 'task', id: TASK, label: 'Decide the renewal', viewedAt: Date.now() }]) });
    api.post.mockResolvedValue({ data: { existing: [{ type: 'task', id: TASK }] } });
    renderTile();
    fireEvent.click(screen.getByRole('button', { name: 'dashboard.tiles.clearHistory' }));
    expect(await screen.findByText('dashboard.tiles.clearHistoryMessage')).toBeInTheDocument();
    expect(screen.getByText('Decide the renewal')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'buttons.clear' }));
    await waitFor(() => expect(screen.queryByText('Decide the renewal')).toBeNull());
    expect(screen.getByText('dashboard.tiles.noRecentlyViewed')).toBeInTheDocument();
    expect(values.has(KEY)).toBe(false);
  });

  it('keeps the history when the confirmation is cancelled', async () => {
    const values = stubStorage({ [KEY]: JSON.stringify([{ type: 'task', id: TASK, label: 'Decide the renewal', viewedAt: Date.now() }]) });
    api.post.mockResolvedValue({ data: { existing: [{ type: 'task', id: TASK }] } });
    renderTile();
    fireEvent.click(screen.getByRole('button', { name: 'dashboard.tiles.clearHistory' }));
    fireEvent.click(await screen.findByRole('button', { name: 'buttons.cancel' }));
    await waitFor(() => expect(screen.queryByText('dashboard.tiles.clearHistoryMessage')).toBeNull());
    expect(screen.getByText('Decide the renewal')).toBeInTheDocument();
    expect(JSON.parse(values.get(KEY)!).map((item: { id: string }) => item.id)).toEqual([TASK]);
  });
});
