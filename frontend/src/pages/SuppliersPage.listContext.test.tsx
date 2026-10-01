import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The real grid (AG Grid included), with its API handed to the test so it can sort and filter the
// way a user does.
vi.mock('react-i18next', () => {
  const translation = {
    t: (key: string) => key,
    i18n: { language: 'en', resolvedLanguage: 'en', getResourceBundle: () => ({}) },
  };
  return { useTranslation: () => translation };
});
vi.mock('../api', () => ({ default: { get: vi.fn() } }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true, profile: { id: 'u-1' } }) }));
vi.mock('../tenant/TenantContext', () => ({ useTenant: () => ({ tenantSlug: 'test' }) }));
vi.mock('../config/ThemeContext', () => ({ useThemeMode: () => ({ resolvedMode: 'light' }) }));
vi.mock('../i18n/useLocale', () => ({ useLocale: () => 'en' }));
vi.mock('../components/PageHeader', () => ({ default: () => null }));
vi.mock('../components/csv/CsvExportDialog', () => ({ default: () => null }));
vi.mock('../components/csv/CsvImportDialog', () => ({ default: () => null }));
vi.mock('../components/DeleteSelectedButton', () => ({ default: () => null }));
const grid = vi.hoisted(() => ({ api: null as any }));
vi.mock('../components/ServerDataGrid', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../components/ServerDataGrid')>();
  const Real = mod.default as React.ComponentType<any>;
  const { createElement } = await import('react');
  return {
    ...mod,
    default: (props: any) => createElement(Real, {
      ...props,
      onGridApiReady: (api: unknown) => {
        grid.api = api;
        props.onGridApiReady?.(api);
      },
    }),
  };
});

import api from '../api';
import SuppliersPage from './SuppliersPage';

const get = (api as unknown as { get: ReturnType<typeof vi.fn> }).get;
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 500)); });
const linkSort = () => {
  const href = document.querySelector('a[href^="/master-data/suppliers/s-1"]')!.getAttribute('href')!;
  return new URLSearchParams(href.split('?')[1]).get('sort');
};

describe('Suppliers list', () => {
  beforeEach(() => {
    grid.api = null;
    get.mockReset();
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    const stored = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => { stored.set(key, value); },
      removeItem: (key: string) => { stored.delete(key); },
    });
    get.mockImplementation(async () => ({ data: { items: [{ id: 's-1', name: 'Acme', erp_supplier_id: 'E1' }], total: 1, page: 1, limit: 50 } }));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('opens a line with the sort the user picked, also after a filter change', async () => {
    render(
      <MemoryRouter initialEntries={['/master-data/suppliers']}>
        <SuppliersPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(grid.api).not.toBeNull());
    await waitFor(() => expect(document.querySelector('a[href^="/master-data/suppliers/s-1"]')).not.toBeNull());

    await act(async () => {
      grid.api.applyColumnState({ state: [{ colId: 'erp_supplier_id', sort: 'desc' }], defaultState: { sort: null } });
    });
    await settle();
    expect(linkSort()).toBe('erp_supplier_id:DESC');

    await act(async () => { grid.api.setFilterModel({ name: { filterType: 'text', type: 'contains', filter: 'ac' } }); });
    await settle();
    const last = get.mock.calls[get.mock.calls.length - 1][1] as { params: Record<string, string> };
    expect(last.params.sort).toBe('erp_supplier_id:DESC');
    expect(linkSort()).toBe('erp_supplier_id:DESC');
  }, 20_000);
});
