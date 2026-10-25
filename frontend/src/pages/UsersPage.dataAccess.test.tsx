import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../config/ThemeContext';
import { KanapDialogProvider } from '../components/design';

const t = vi.hoisted(() => (key: string, options?: Record<string, unknown>) => (
  options ? `${key}|${JSON.stringify(options)}` : key
));
const auth = vi.hoisted(() => ({ limited: false }));
const grid = vi.hoisted(() => ({
  props: null as null | Record<string, any>,
  row: {
    id: 'u-2',
    first_name: 'Marta',
    last_name: 'Ruiz',
    email: 'marta@example.test',
    status: 'enabled',
    roles: [{ id: 'r-1', name: 'Budget member' }],
    data_access: { mode: 'limited', nodes: ['Alpha Spain', ''] },
  },
}));
const get = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    hasLevel: () => true,
    tenantAuth: null,
    profile: { id: 'me' },
    dataAccess: { mode: auth.limited ? 'limited' : 'all', nodes: [] },
  }),
}));
vi.mock('../api', () => ({ default: { get, post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('../i18n/useLocale', () => ({ useLocale: () => 'en' }));
vi.mock('../components/ServerDataGrid', () => ({
  default: (props: Record<string, any>) => {
    grid.props = props;
    const actions = props.columns.find((column: any) => column.colId === 'row_actions');
    const name = props.columns.find((column: any) => column.field === 'first_name');
    return (
      <div>
        {actions ? actions.cellRenderer({ data: grid.row }) : null}
        {name?.cellRenderer ? name.cellRenderer({ data: grid.row, value: grid.row.first_name }) : null}
      </div>
    );
  },
}));
vi.mock('../components/forms/FormModal', () => ({
  default: (props: { open: boolean; actions: React.ReactNode }) => (props.open ? <div>{props.actions}</div> : null),
}));
vi.mock('./forms/UserForm', () => ({ default: () => null }));
vi.mock('../components/csv/CsvExportDialog', () => ({ default: () => null }));
vi.mock('../components/csv/CsvImportDialog', () => ({ default: () => null }));
vi.mock('../components/DeleteSelectedButton', () => ({ default: () => null }));
vi.mock('../components/dataAccess/DataAccessDialog', () => ({
  default: (props: { open: boolean; personName: string }) => (props.open ? <div>dialog {props.personName}</div> : null),
}));

import UsersPage from './UsersPage';

const ROW = grid.row;

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>
        <KanapDialogProvider>
          <MemoryRouter><UsersPage /></MemoryRouter>
        </KanapDialogProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.limited = false;
  grid.props = null;
  get.mockImplementation(async (url: string) => {
    if (url === '/users/u-2') return { data: ROW };
    if (url === '/users/u-2/roles') return { data: { items: [] } };
    return { data: { items: [] } };
  });
});

describe('UsersPage data access', () => {
  it('hides the Access column until a person is limited', () => {
    renderPage();
    expect(grid.props!.columns.some((column: any) => column.colId === 'data_access')).toBe(false);
    act(() => grid.props!.onListAnswer({ data_access_any_limited: true }));
    const column = grid.props!.columns.find((current: any) => current.colId === 'data_access');
    expect(column).toBeTruthy();
    expect(column.headerName).toBe('users.columns.dataAccess');
    expect(column.valueGetter({ data: ROW })).toBe('admin:dataAccess.allData');
    expect(column.valueGetter({ data: { data_access: { mode: 'limited', nodes: [] } } }))
      .toBe('admin:dataAccess.limited');
  });

  it('opens the dialog from the row menu', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'users.actions.rowMenu' }));
    fireEvent.click(await screen.findByText('users.actions.dataAccess'));
    expect(await screen.findByText('dialog Marta Ruiz')).toBeInTheDocument();
  });

  it('offers the dialog from the user edit form', async () => {
    renderPage();
    fireEvent.click(screen.getByText('Marta'));
    expect(await screen.findByRole('button', { name: 'users.actions.dataAccess' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'users.actions.dataAccess' }));
    expect(await screen.findByText('dialog Marta Ruiz')).toBeInTheDocument();
  });

  it('offers no command on one’s own account', async () => {
    const original = grid.row.id;
    grid.row.id = 'me';
    try {
      renderPage();
      fireEvent.click(screen.getByRole('button', { name: 'users.actions.rowMenu' }));
      expect(screen.queryByText('users.actions.dataAccess')).toBeNull();
      fireEvent.click(screen.getByText('Marta'));
      expect(screen.queryByRole('button', { name: 'users.actions.dataAccess' })).toBeNull();
    } finally {
      grid.row.id = original;
    }
  });

  it('shows nothing to a limited person, even when their roles administer users', async () => {
    auth.limited = true;
    renderPage();
    act(() => grid.props!.onListAnswer({ data_access_any_limited: true }));
    expect(grid.props!.columns.some((column: any) => column.colId === 'data_access')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'users.actions.rowMenu' }));
    expect(screen.queryByText('users.actions.dataAccess')).toBeNull();
    fireEvent.click(screen.getByText('Marta'));
    expect(screen.queryByRole('button', { name: 'users.actions.dataAccess' })).toBeNull();
  });
});
