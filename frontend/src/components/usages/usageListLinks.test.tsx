import React from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The real AG Grid: a list opened on the address of a "Show all" link loads its first page filtered
// on the supplier, on the Show scope the link names.
vi.mock('react-i18next', () => {
  const translation = {
    t: (key: string) => key,
    i18n: { language: 'en', resolvedLanguage: 'en', getResourceBundle: () => ({}) },
  };
  return { useTranslation: () => translation };
});
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true, profile: { id: 'u-1' } }) }));
vi.mock('../../tenant/TenantContext', () => ({ useTenant: () => ({ tenantSlug: 'test' }) }));
vi.mock('../../config/ThemeContext', () => ({ useThemeMode: () => ({ resolvedMode: 'light' }) }));
vi.mock('../../i18n/useLocale', () => ({ useLocale: () => 'en' }));

import api from '../../api';
import ServerDataGrid, { type EnhancedColDef } from '../ServerDataGrid';
import CheckboxSetFilter from '../CheckboxSetFilter';
import { resetListContextCache } from '../../lib/listContext';
import { flushAgGridTimers } from '../../test/agGridTimers';
import { usageListLink } from './usageListLinks';

const mocked = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
const NAME = 'Microsoft & Co';

const LIFECYCLES = ['active', 'deprecated', 'retired'];

function linkOf(type: Parameters<typeof usageListLink>[1]) {
  const link = usageListLink('suppliers', type, NAME, { applicationLifecycles: LIFECYCLES });
  if (!link) throw new Error(`no link for ${type}`);
  const [path, search] = link.href.split('?');
  return { link, path, params: new URLSearchParams(search) };
}

describe('usageListLink', () => {
  it('opens the budget list of both natures, every status, as a one-off view, on the Supplier set filter', () => {
    const { link, path, params } = linkOf('budget_lines');
    expect(path).toBe('/ops/budget');
    expect(JSON.parse(params.get('filters')!)).toEqual({ supplier_name: { filterType: 'set', values: [NAME] } });
    expect(params.get('statusScope')).toBe('all');
    expect(params.get('from')).toBe('report');
    expect(link.save).toBeUndefined();
  });

  it('opens the contracts on the Supplier text filter, every status', () => {
    const { path, params } = linkOf('contracts');
    expect(path).toBe('/ops/contracts');
    expect(JSON.parse(params.get('filters')!)).toEqual({ supplier_name: { filterType: 'text', type: 'equals', filter: NAME } });
    expect(params.get('statusScope')).toBe('all');
  });

  it('opens all applications on the Supplier text filter, every lifecycle state ticked (retired included)', () => {
    const { path, params } = linkOf('applications');
    expect(path).toBe('/it/applications');
    expect(JSON.parse(params.get('filters')!)).toEqual({
      supplier_name: { filterType: 'text', type: 'equals', filter: NAME },
      lifecycle: { filterType: 'set', values: LIFECYCLES },
    });
    expect(params.get('appScope')).toBe('all');
    // The states unknown yet: no link rather than one that leaves the retired out.
    expect(usageListLink('suppliers', 'applications', NAME)).toBeNull();
  });

  it('gives no link where the list cannot filter on the record', () => {
    expect(usageListLink('suppliers', 'assets', NAME)).toBeNull();
    for (const type of ['suppliers', 'budget_lines', 'contracts', 'applications', 'assets', 'locations', 'projects', 'requests'] as const) {
      expect(usageListLink('contacts', type, 'Robert Chen')).toBeNull();
    }
    expect(usageListLink('suppliers', 'contracts', '')).toBeNull();
    expect(usageListLink('suppliers', 'contracts', null)).toBeNull();
  });
});

/** The Supplier column of each list, as its page declares it. */
const SUPPLIER_COLUMNS: Record<string, EnhancedColDef<any>[]> = {
  // BudgetListPage: a checkbox set filter on the names the server lists.
  '/budget-lines/summary': [{ colId: 'supplier_name', headerName: 'Supplier', filter: CheckboxSetFilter, filterParams: { values: [] }, valueGetter: (p) => p.data?.supplier_name ?? '' }],
  // ContractsPage: the default text filter.
  '/contracts': [{ colId: 'supplier_name', headerName: 'Supplier', valueGetter: (p) => p.data?.supplier?.name ?? '' }],
  // ApplicationsPage: a text filter, the column hidden by default; the lifecycle set filter.
  '/applications': [
    { headerName: 'Lifecycle', field: 'lifecycle', filter: CheckboxSetFilter, filterParams: { values: [] } },
    { headerName: 'Supplier', field: 'supplier_name', filter: 'agTextColumnFilter', defaultHidden: true },
  ],
};

function List({ endpoint, url, scoped, onGridApiReady }: { endpoint: string; url: string; scoped: boolean; onGridApiReady: (api: any) => void }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[url]}>
        <ServerDataGrid<any>
          columns={[{ field: 'name', headerName: 'Name' }, ...SUPPLIER_COLUMNS[endpoint]]}
          endpoint={endpoint}
          queryKey={endpoint}
          columnPreferencesKey={`usage-link-test${endpoint}`}
          defaultSort={{ field: 'name', direction: 'ASC' }}
          statusScopeConfig={scoped ? { defaultScope: 'enabled' } : undefined}
          // As the budget and applications lists: a link's filter on a hidden column shows it.
          showFilteredColumns
          onGridApiReady={onGridApiReady}
        />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('a list opened on a "Show all" link', () => {
  beforeEach(() => {
    resetListContextCache();
    mocked.get.mockReset();
    mocked.post.mockReset();
    mocked.get.mockResolvedValue({ data: { items: [], total: 0, page: 1, limit: 50 } });
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    const stored = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => { stored.set(key, value); },
      removeItem: (key: string) => { stored.delete(key); },
    });
  });
  afterEach(async () => {
    cleanup();
    await flushAgGridTimers();
    vi.unstubAllGlobals();
  });

  it.each([
    ['budget_lines', '/budget-lines/summary', true],
    ['contracts', '/contracts', true],
    ['applications', '/applications', false],
  ] as const)('%s: the first page asks for the supplier\'s rows only', async (type, endpoint, scoped) => {
    const { link, params } = linkOf(type);
    let gridApi: any = null;
    render(<List endpoint={endpoint} url={link.href} scoped={scoped} onGridApiReady={(a) => { gridApi = a; }} />);
    const rows = () => mocked.get.mock.calls.filter(([url]) => url === endpoint);
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    const sent = (rows()[0][1] as { params: Record<string, string> }).params;
    expect(JSON.parse(sent.filters)).toEqual(JSON.parse(params.get('filters')!));
    if (scoped) expect(sent.includeDisabled).toBe('1');
    // The filtered Supplier column is on screen, hidden by default or not.
    await waitFor(() => expect(gridApi?.getColumn('supplier_name')?.isVisible()).toBe(true));
  });
});
