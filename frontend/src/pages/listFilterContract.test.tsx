import React from 'react';
import { act, render, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The list filter contract, frontend side: every column a list screen lets the user filter, read
// from the column definitions each page hands to ServerDataGrid, with the kind of filter model the
// grid sends for it, the fields the columns show, and the page parameters the list sends with
// each request, every column shown. The result must equal `listFilterContract.json`, which the backend spec
// `backend/src/common/__tests__/list-filter-contract.integration.spec.ts` replays against each list
// endpoint: a filter the screen offers must narrow the rows on the server, and the rows must
// carry every field a column shows.
// After a column change, regenerate the file: `npx vitest run src/pages/listFilterContract.test.tsx -u`.

const grid = vi.hoisted(() => ({ calls: [] as any[] }));

vi.mock('react-i18next', () => {
  const t = (key: string, opts?: any) => (typeof opts === 'string' ? opts : key);
  const translation = { t, i18n: { language: 'en', resolvedLanguage: 'en', changeLanguage: async () => {} } };
  return {
    useTranslation: () => translation,
    Trans: ({ i18nKey, children }: any) => children ?? i18nKey ?? null,
    initReactI18next: { type: '3rdParty', init: () => {} },
  };
});
vi.mock('../components/ServerDataGrid', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    default: (props: unknown) => {
      grid.calls.push(props);
      return null;
    },
  };
});
vi.mock('../components/PageHeader', () => ({ default: () => null }));
vi.mock('../api', () => {
  // An empty answer for every request: an empty list that also reads as an empty page.
  const empty = () => ({ data: Object.assign([], { items: [], total: 0, rows: [] }) });
  // The chart of accounts screen shows its list once a chart exists.
  const get = async (url: string) => (url === '/chart-of-accounts'
    ? { data: { items: [{ id: 'coa-1', name: 'Chart', code: 'C1', is_default: true, is_global_default: false }] } }
    : empty());
  return { default: { get: vi.fn(get), post: vi.fn(async () => empty()), put: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});
vi.mock('../auth/AuthContext', () => {
  const auth = {
    hasLevel: () => true,
    hasAnyLevel: () => true,
    profile: { id: 'u-1', email: 'u@example.test', first_name: 'U', last_name: 'Ser', is_platform_admin: true },
    claims: { isPlatformAdmin: true, isGlobalAdmin: true, permissions: {} },
    isAuthenticated: true,
    loading: false,
  };
  return { useAuth: () => auth, AuthProvider: ({ children }: any) => children };
});

vi.mock('../tenant/TenantContext', () => {
  const tenant = {
    isPlatformHost: false, tenantSlug: 'acme', tenantName: 'Acme', logoUrl: null, useLogoInDark: false,
    primaryColorLight: null, primaryColorDark: null, refreshTenantInfo: async () => {},
  };
  return { useTenant: () => tenant, TenantProvider: ({ children }: any) => children };
});

import CheckboxSetFilter from '../components/CheckboxSetFilter';
import { KanapDialogProvider } from '../components/design/KanapDialogProvider';

type Page = { name: string; load: () => Promise<{ default: React.ComponentType<any> }> };
const PAGES: Page[] = [
  { name: 'TasksPage', load: () => import('./TasksPage') },
  { name: 'BusinessProcessesPage', load: () => import('./BusinessProcessesPage') },
  { name: 'WorkingDayCalendarsPage', load: () => import('./WorkingDayCalendarsPage') },
  { name: 'UsersPage', load: () => import('./UsersPage') },
  { name: 'CompaniesPage', load: () => import('./CompaniesPage') },
  { name: 'CostCentersPage', load: () => import('./CostCentersPage') },
  { name: 'AnalyticsCategoriesPage', load: () => import('./AnalyticsCategoriesPage') },
  { name: 'RequestsPage', load: () => import('./portfolio/RequestsPage') },
  { name: 'ProjectsPage', load: () => import('./portfolio/ProjectsPage') },
  { name: 'ApplicationsPage', load: () => import('./it/ApplicationsPage') },
  { name: 'IncidentsPage', load: () => import('./it/IncidentsPage') },
  { name: 'InterfacesPage', load: () => import('./it/InterfacesPage') },
  { name: 'LocationsPage', load: () => import('./it/LocationsPage') },
  { name: 'ConnectionsPage', load: () => import('./it/ConnectionsPage') },
  { name: 'CoaPage', load: () => import('./coa/CoaPage') },
  { name: 'SuppliersPage', load: () => import('./SuppliersPage') },
  { name: 'DepartmentsPage', load: () => import('./DepartmentsPage') },
  { name: 'AssetsPage', load: () => import('./it/AssetsPage') },
  { name: 'TechnologiesPage', load: () => import('./it/TechnologiesPage') },
  { name: 'BudgetListPage', load: () => import('./budget/BudgetListPage') },
  { name: 'AuditLogsPage', load: () => import('./admin/AuditLogsPage') },
  { name: 'KnowledgePage', load: () => import('./knowledge/KnowledgePage') },
  { name: 'ContractsPage', load: () => import('./ContractsPage') },
  { name: 'ContactsPage', load: () => import('./ContactsPage') },
];

afterEach(() => {
  cleanup();
  grid.calls.length = 0;
});

function filterKind(column: any): string | null {
  const filter = column.filter;
  if (filter === false) return null;
  if (filter === undefined || filter === true || filter === 'agTextColumnFilter') return 'text';
  if (filter === 'agDateColumnFilter') return 'date';
  if (filter === 'agNumberColumnFilter') return 'number';
  if (filter === CheckboxSetFilter) return 'set';
  return `custom:${filter?.displayName || filter?.name || String(filter)}`;
}

/**
 * The page parameters the list sends with every request (`extraParams`), as the backend spec
 * replays them: the year of the figures stands for the current year, the chart of accounts for
 * the workspace's default chart.
 */
function contractParams(extra: Record<string, unknown> | undefined): Record<string, string> {
  const placeholders: Record<string, string> = { year: '<year>', budget_year: '<year>', coaId: '<chart>' };
  return Object.fromEntries(Object.entries(extra ?? {}).map(([key, value]) => [key, placeholders[key] ?? String(value)]));
}

/** Lists of the platform administration (no tenant, platform host): not in the contract. */
const NOT_IN_CONTRACT = ['AdminCoaTemplatesPage', 'AdminStandardAccountsPage'];

const sources = import.meta.glob<string>(['../**/*.tsx', '!../**/*.test.tsx'], { query: '?raw', import: 'default', eager: true });

/** The source files under src/ that render a ServerDataGrid, by name. */
function gridScreens(): string[] {
  return Object.entries(sources)
    .filter(([, text]) => text.includes('<ServerDataGrid'))
    .map(([file]) => file.split('/').pop()!.replace(/\.tsx$/, ''));
}

describe('list filter contract', () => {
  it('covers every screen with a server list', () => {
    expect(gridScreens().filter((name) => name !== 'ServerDataGrid').sort())
      .toEqual([...PAGES.map((page) => page.name), ...NOT_IN_CONTRACT].sort());
  });

  it('derives the filterable columns of every list screen', async () => {
    const derived: Record<string, { params: Record<string, string>; filters: Record<string, string>; fields: string[] }> = {};
    for (const page of PAGES) {
      const { default: Component } = await page.load();
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      try {
        render(
          <QueryClientProvider client={client}>
            <KanapDialogProvider><MemoryRouter><Component /></MemoryRouter></KanapDialogProvider>
          </QueryClientProvider>,
        );
      } catch (error) {
        throw new Error(`${page.name}: ${(error as Error).message}`);
      }
      // Some screens show their list once their settings have loaded.
      await waitFor(() => {
        if (grid.calls.length === 0) throw new Error(`${page.name} shows no list`);
      });
      // Every column shown: the page asks for the optional parts of the rows those columns need.
      const first = grid.calls[grid.calls.length - 1];
      const allShown = (first.columns as any[]).map((column) => ({ colId: column.colId || column.field, hide: false }));
      if (first.onColumnStateChange) act(() => first.onColumnStateChange(allShown));
      const props = grid.calls[grid.calls.length - 1];
      const filters: Record<string, string> = {};
      const shown: string[] = [];
      for (const column of props.columns as any[]) {
        const key = column.colId || column.field;
        const kind = filterKind(column);
        if (key && kind) filters[key] = kind;
        // A column that reads a field of the row (not a value computed by the page).
        if (column.field && !column.valueGetter) shown.push(column.field);
      }
      const params = { ...(props.extraParams ?? {}), ...(props.pageParams?.(allShown) ?? {}) };
      derived[props.endpoint] = { params: contractParams(params), filters, fields: shown };
      cleanup();
      grid.calls.length = 0;
    }
    await expect(`${JSON.stringify(derived, null, 2)}\n`).toMatchFileSnapshot('./listFilterContract.json');
  }, 60_000);
});
