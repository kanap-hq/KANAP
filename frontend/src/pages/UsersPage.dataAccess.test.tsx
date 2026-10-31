import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    data_access: {
      mode: 'limited',
      nodes: [
        { type: 'company', name: 'Alpha Spain' },
        { type: 'cost_center', name: 'Infrastructure' },
      ],
    },
  },
}));
const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());

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
vi.mock('../api', () => ({ default: { get, post, put: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('../i18n/useLocale', () => ({ useLocale: () => 'en' }));
function paintCell(column: { cellRenderer?: (params: any) => React.ReactNode; cellRendererParams?: object } | undefined, params: Record<string, unknown>) {
  if (!column?.cellRenderer) return null;
  return column.cellRenderer({ ...params, ...(column.cellRendererParams ?? {}) });
}

vi.mock('../components/ServerDataGrid', () => ({
  default: (props: Record<string, any>) => {
    grid.props = props;
    const actions = props.columns.find((column: any) => column.colId === 'row_actions');
    const name = props.columns.find((column: any) => column.field === 'first_name');
    return (
      <div>
        {paintCell(actions, { data: grid.row })}
        {paintCell(name, { data: grid.row, value: grid.row.first_name })}
      </div>
    );
  },
}));
vi.mock('./users/UserDialog', () => ({
  default: (props: { open: boolean; mode: string; initialTab?: string; personName?: string }) => (
    props.open
      ? <div>user dialog {props.mode} {props.initialTab ?? 'identity'} {props.personName}</div>
      : null
  ),
}));
vi.mock('../components/csv/CsvExportDialog', () => ({ default: () => null }));
vi.mock('../components/csv/CsvImportDialog', () => ({ default: () => null }));
vi.mock('../components/DeleteSelectedButton', () => ({ default: () => null }));

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
  get.mockResolvedValue({ data: { items: [] } });
  post.mockResolvedValue({ data: {} });
});

function confirmationDialog(text: string) {
  const message = screen.getByText(text);
  const dialog = message.closest('[role="dialog"]');
  if (!dialog) throw new Error('confirmation dialog missing');
  return dialog as HTMLElement;
}

describe('UsersPage data access', () => {
  it('hides the Access column until a person is limited', () => {
    renderPage();
    expect(grid.props!.columns.some((column: any) => column.colId === 'data_access')).toBe(false);
    act(() => grid.props!.onListAnswer({ data_access_any_limited: true }));
    const column = grid.props!.columns.find((current: any) => current.colId === 'data_access');
    expect(column).toBeTruthy();
    expect(column.headerName).toBe('users.columns.dataAccess');
    expect(column.valueGetter({ data: ROW })).toBe('Alpha Spain, Infrastructure');
  });

  it('writes All data, Everything and None in the Access column', () => {
    renderPage();
    act(() => grid.props!.onListAnswer({ data_access_any_limited: true }));
    const column = grid.props!.columns.find((current: any) => current.colId === 'data_access');
    // The mode "All data" stays for the mode only.
    expect(column.valueGetter({ data: { data_access: { mode: 'all', nodes: [] } } }))
      .toBe('admin:dataAccess.allData');
    // A limited person holding the all node sees "Everything".
    expect(column.valueGetter({ data: { data_access: { mode: 'limited', nodes: [{ type: 'all', name: null }] } } }))
      .toBe('admin:dataAccess.types.everything');
    // A limited person with no node sees "None", with no helper text.
    expect(column.valueGetter({ data: { data_access: { mode: 'limited', nodes: [] } } }))
      .toBe('admin:dataAccess.none');
  });

  it('opens the user dialog on the Access tab from the row menu', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'users.actions.rowMenu' }));
    fireEvent.click(await screen.findByText('users.actions.dataAccess'));
    expect(await screen.findByText('user dialog edit access Marta Ruiz')).toBeInTheDocument();
  });

  it('opens the identity dialog when a user is clicked, with no separate data access command', async () => {
    renderPage();
    fireEvent.click(screen.getByText('Marta'));
    expect(await screen.findByText('user dialog edit identity Marta Ruiz')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'users.actions.dataAccess' })).toBeNull();
  });

  it('offers no data access command on one’s own account', async () => {
    const original = grid.row.id;
    grid.row.id = 'me';
    try {
      renderPage();
      fireEvent.click(screen.getByRole('button', { name: 'users.actions.rowMenu' }));
      expect(screen.queryByText('users.actions.dataAccess')).toBeNull();
      fireEvent.click(screen.getByText('Marta'));
      expect(await screen.findByText('user dialog edit identity Marta Ruiz')).toBeInTheDocument();
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
    expect(await screen.findByText('user dialog edit identity Marta Ruiz')).toBeInTheDocument();
  });
});

describe('UsersPage invitations', () => {
  const one = 'users.messages.inviteConfirm|{"count":1,"email":"marta@example.test"}';
  const many = 'users.messages.inviteConfirm|{"count":2}';

  async function openRowInvite() {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'users.actions.rowMenu' }));
    fireEvent.click(await screen.findByText('users.actions.sendInvite'));
    expect(await screen.findByText(one)).toBeInTheDocument();
    return confirmationDialog(one);
  }

  it('asks before a row invitation and sends nothing when cancelled', async () => {
    const dialog = await openRowInvite();
    fireEvent.click(within(dialog).getByRole('button', { name: 'buttons.cancel' }));
    await waitFor(() => expect(screen.queryByText(one)).not.toBeInTheDocument());
    expect(post).not.toHaveBeenCalled();
  });

  it('sends the row invitation after confirmation', async () => {
    const dialog = await openRowInvite();
    fireEvent.click(within(dialog).getByRole('button', { name: 'users.actions.sendInvite' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/users/u-2/invite'));
  });

  it('names the only selected recipient', async () => {
    renderPage();
    act(() => grid.props!.onSelectionChanged([{ id: 'u-2', email: 'marta@example.test' }]));
    fireEvent.click(screen.getByRole('button', { name: 'users.actions.invite|{"count":1}' }));
    expect(await screen.findByText(one)).toBeInTheDocument();
    fireEvent.click(within(confirmationDialog(one)).getByRole('button', { name: 'buttons.cancel' }));
    await waitFor(() => expect(screen.queryByText(one)).not.toBeInTheDocument());
    expect(post).not.toHaveBeenCalled();
  });

  it('names the count before inviting several users, and sends nothing when cancelled', async () => {
    renderPage();
    act(() => grid.props!.onSelectionChanged([
      { id: 'u-2', email: 'marta@example.test' },
      { id: 'u-3', email: 'julie.martin@example.com' },
    ]));
    fireEvent.click(screen.getByRole('button', { name: 'users.actions.invite|{"count":2}' }));
    expect(await screen.findByText(many)).toBeInTheDocument();
    fireEvent.click(within(confirmationDialog(many)).getByRole('button', { name: 'buttons.cancel' }));
    await waitFor(() => expect(screen.queryByText(many)).not.toBeInTheDocument());
    expect(post).not.toHaveBeenCalled();
  });

  it('invites the selection after confirmation', async () => {
    renderPage();
    act(() => grid.props!.onSelectionChanged([
      { id: 'u-2', email: 'marta@example.test' },
      { id: 'u-3', email: 'julie.martin@example.com' },
    ]));
    fireEvent.click(screen.getByRole('button', { name: 'users.actions.invite|{"count":2}' }));
    expect(await screen.findByText(many)).toBeInTheDocument();
    fireEvent.click(within(confirmationDialog(many)).getByRole('button', { name: 'users.actions.sendInvite' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/users/u-2/invite'));
    expect(post).toHaveBeenCalledWith('/users/u-3/invite');
  });
});
