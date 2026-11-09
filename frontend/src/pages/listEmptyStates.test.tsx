import React from 'react';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../config/ThemeContext';

// An empty list says so in one line, with the creation in the middle for someone who may create.

const grid = vi.hoisted(() => ({ props: null as null | Record<string, any> }));
const auth = vi.hoisted(() => ({ level: 'admin' as 'admin' | 'reader' }));
const t = vi.hoisted(() => (key: string) => key);

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t, i18n: { language: 'en', resolvedLanguage: 'en' } }),
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
}));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    hasLevel: (_area: string, level: string) => auth.level === 'admin' || level === 'reader',
    profile: { id: 'u-1' },
    user: null,
    dataAccess: null,
  }),
}));
vi.mock('../api', () => ({ default: { get: vi.fn(async () => ({ data: { items: [] } })), post: vi.fn() } }));
vi.mock('../tenant/TenantContext', () => ({ useTenant: () => ({ tenantSlug: 'fromage' }) }));
vi.mock('../i18n/useLocale', () => ({ useLocale: () => 'en' }));
vi.mock('../components/ServerDataGrid', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../components/ServerDataGrid')>()),
  default: (props: Record<string, any>) => {
    grid.props = props;
    return null;
  },
}));
vi.mock('../components/PageHeader', () => ({ default: () => null }));

import CompaniesPage from './CompaniesPage';
import BusinessProcessesPage from './BusinessProcessesPage';
import DepartmentsPage from './DepartmentsPage';
import ContactsPage from './ContactsPage';
import CostCentersPage from './CostCentersPage';
import WorkingDayCalendarsPage from './WorkingDayCalendarsPage';
import ConnectionsPage from './it/ConnectionsPage';
import InterfacesPage from './it/InterfacesPage';
import AssetsPage from './it/AssetsPage';

const lists: Array<[string, React.ComponentType, string, string, string]> = [
  ['companies', CompaniesPage, 'companies-empty', 'companies.empty', 'companies.newCompany'],
  ['business processes', BusinessProcessesPage, 'business-processes-empty', 'businessProcesses.empty', 'businessProcesses.newBusinessProcess'],
  ['departments', DepartmentsPage, 'departments-empty', 'departments.empty', 'departments.newDepartment'],
  ['contacts', ContactsPage, 'contacts-empty', 'contacts.empty', 'contacts.newContact'],
  ['cost centers', CostCentersPage, 'cost-centers-empty', 'costCenters.emptyExplainer', 'costCenters.newCostCenter'],
  ['working-day calendars', WorkingDayCalendarsPage, 'working-day-calendars-empty', 'workingDayCalendars.emptyExplainer', 'workingDayCalendars.newCalendar'],
  ['connections', ConnectionsPage, 'connections-empty', 'pages.connections.empty', 'pages.connections.addConnection'],
  ['interfaces', InterfacesPage, 'interfaces-empty', 'pages.interfaces.empty', 'pages.interfaces.addInterface'],
  ['assets', AssetsPage, 'assets-empty', 'pages.assets.empty', 'pages.assets.addAsset'],
];

function emptyStateOf(Page: React.ComponentType, testId: string) {
  grid.props = null;
  const theme = createAppTheme('light');
  const page = render(
    <ThemeProvider theme={theme}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <Page />
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
  const emptyState = (grid.props as Record<string, any> | null)?.emptyState as React.ReactElement;
  page.unmount();
  render(<ThemeProvider theme={theme}><MemoryRouter>{emptyState}</MemoryRouter></ThemeProvider>);
  return screen.getByTestId(testId);
}

describe('empty lists', () => {
  beforeEach(() => { auth.level = 'admin'; });

  it.each(lists)('%s: one line, with the creation for someone who may create', (_name, Page, testId, text, button) => {
    const empty = emptyStateOf(Page, testId);
    expect(empty.textContent).toContain(text);
    expect(empty.querySelector('button')?.textContent).toBe(button);
  });

  it.each(lists)('%s: no creation for a reader', (_name, Page, testId, text) => {
    auth.level = 'reader';
    const empty = emptyStateOf(Page, testId);
    expect(empty.textContent).toBe(text);
    expect(empty.querySelector('button')).toBeNull();
  });
});
