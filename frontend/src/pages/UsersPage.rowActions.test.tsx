import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { createAppTheme } from '../config/ThemeContext';
import { KanapDialogProvider } from '../components/design';
import UsersPage from './UsersPage';

const grid = vi.hoisted(() => ({ props: null as null | Record<string, any>, row: null as null | Record<string, unknown> }));
const i18n = vi.hoisted(() => ({
  t: (key: string) => key,
  i18n: { language: 'en', resolvedLanguage: 'en' },
}));

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => i18n,
}));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: () => true, tenantAuth: null, profile: { id: 'u-self' } }),
}));
vi.mock('../api', () => ({ default: { get: vi.fn(async () => ({ data: { items: [] } })), post: vi.fn() } }));
vi.mock('../i18n/useLocale', () => ({ useLocale: () => 'en' }));
vi.mock('./users/UserDialog', () => ({
  default: (props: { open: boolean; mode: string }) => (props.open ? <div>{`user dialog ${props.mode}`}</div> : null),
}));
vi.mock('../components/ServerDataGrid', () => ({
  default: (props: Record<string, any>) => {
    grid.props = props;
    const actions = (props.columns as any[]).find((column) => column.colId === 'row_actions');
    return <div>{actions?.cellRenderer({ data: grid.row, ...(actions.cellRendererParams ?? {}) })}</div>;
  },
}));
vi.mock('../components/csv/CsvExportDialog', () => ({ default: () => null }));
vi.mock('../components/csv/CsvImportDialog', () => ({ default: () => null }));
vi.mock('../components/DeleteSelectedButton', () => ({ default: () => null }));

const PERSON = {
  id: 'u-2',
  email: 'grace@example.test',
  first_name: 'Grace',
  last_name: 'Hopper',
  status: 'enabled',
};

function openRowMenu(row: Record<string, unknown>): string[] {
  grid.row = row;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ThemeProvider theme={createAppTheme('light')}>
        <KanapDialogProvider>
          <MemoryRouter><UsersPage /></MemoryRouter>
        </KanapDialogProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'users.actions.rowMenu' }));
  return within(screen.getByRole('menu')).getAllByRole('menuitem').map((item) => item.textContent ?? '');
}

// The users list offers only the changes the server accepts: a person with more rights than the
// reader (`above_own_rights` on the row) is viewed, and is not selected for the bulk actions.
describe('UsersPage row actions', () => {
  afterEach(() => cleanup());

  it('offers every change on a person the reader may change', () => {
    const items = openRowMenu({ ...PERSON, above_own_rights: false });
    expect(items).toEqual([
      'users.actions.edit',
      'users.actions.dataAccess',
      'users.actions.disable',
      'users.actions.sendInvite',
      'users.actions.sendReset',
      'users.actions.delete',
    ]);
    expect(grid.props!.isRowSelectable({ ...PERSON, above_own_rights: false })).toBe(true);
  });

  it('only views a person with more rights than the reader, and keeps them out of the selection', () => {
    const items = openRowMenu({ ...PERSON, above_own_rights: true });
    expect(items).toEqual(['users.actions.view', 'users.actions.sendReset']);
    expect(grid.props!.isRowSelectable({ ...PERSON, above_own_rights: true })).toBe(false);

    fireEvent.click(screen.getByRole('menuitem', { name: 'users.actions.view' }));
    expect(screen.getByText('user dialog edit')).toBeInTheDocument();
  });
});
