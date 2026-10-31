import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../config/ThemeContext';
import { KanapDialogProvider } from '../components/design';
import { coversItsCell } from '../components/grid/renderers/wholeCellLink.testUtils';
import UsersPage from './UsersPage';

const deleteButton = vi.hoisted(() => ({ props: null as null | Record<string, any> }));
const grid = vi.hoisted(() => ({ props: null as null | Record<string, any> }));
const post = vi.hoisted(() => vi.fn());
const i18n = vi.hoisted(() => ({
  t: (key: string) => key,
  i18n: { language: 'en', resolvedLanguage: 'en' },
}));

/** AG Grid merges `cellRendererParams` into the props of the renderer. The mock does the same. */
function paintCell(column: { cellRenderer?: (params: any) => React.ReactNode; cellRendererParams?: object } | undefined, params: Record<string, unknown>) {
  if (!column?.cellRenderer) return null;
  return column.cellRenderer({ ...params, ...(column.cellRendererParams ?? {}) });
}

const OWN_ROW = {
  id: 'u-1',
  email: 'ada@example.test',
  first_name: 'Ada',
  last_name: 'Lovelace',
  status: 'enabled',
};

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => i18n,
}));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: () => true, tenantAuth: null, profile: { id: 'u-1' } }),
}));
vi.mock('../api', () => ({ default: { get: vi.fn(async () => ({ data: { items: [] } })), post } }));
vi.mock('../i18n/useLocale', () => ({ useLocale: () => 'en' }));
vi.mock('./users/UserDialog', () => ({
  default: (props: { open: boolean; mode: string; initialTab?: string; personName?: string; onClose: () => void }) => (
    props.open ? (
      <div>
        <div>{`user dialog ${props.mode} ${props.initialTab ?? 'identity'} ${props.personName}`}</div>
        <button type="button" onClick={props.onClose}>close user</button>
      </div>
    ) : null
  ),
}));
vi.mock('../components/ServerDataGrid', () => ({
  default: (props: Record<string, any>) => {
    grid.props = props;
    // The chooser lists every column except those kept out of the tool panel (ServerDataGrid).
    const offered = (props.columns as any[]).filter((column) => !column.suppressColumnsToolPanel);
    const actions = (props.columns as any[]).find((column) => column.colId === 'row_actions');
    const name = (props.columns as any[]).find((column) => column.field === 'last_name');
    return (
      <div>
        <ul aria-label="column-chooser">
          {offered.map((column) => (
            <li key={column.field || column.colId}>{column.headerName || column.field || column.colId}</li>
          ))}
        </ul>
        {paintCell(actions, { data: OWN_ROW })}
        {paintCell(name, { data: OWN_ROW, value: OWN_ROW.last_name })}
      </div>
    );
  },
}));
vi.mock('../components/csv/CsvExportDialog', () => ({ default: () => null }));
vi.mock('../components/csv/CsvImportDialog', () => ({ default: () => null }));
vi.mock('../components/DeleteSelectedButton', () => ({
  default: (props: Record<string, any>) => {
    deleteButton.props = props;
    return null;
  },
}));

describe('UsersPage columns', () => {
  it('keeps the actions column out of the chooser and keeps the row menu', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ThemeProvider theme={createAppTheme('light')}>
          <KanapDialogProvider>
            <MemoryRouter><UsersPage /></MemoryRouter>
          </KanapDialogProvider>
        </ThemeProvider>
      </QueryClientProvider>,
    );
    const columns = grid.props!.columns as Array<{ field?: string; colId?: string; headerName?: string; suppressColumnsToolPanel?: boolean }>;
    const actions = columns.find((column) => column.colId === 'row_actions');
    expect(actions?.suppressColumnsToolPanel).toBe(true);
    const offered = screen.getAllByRole('listitem').map((item) => item.textContent);
    expect(offered).not.toContain('row_actions');
    expect(screen.getByRole('button', { name: 'users.actions.rowMenu' })).toBeInTheDocument();
  });

  it('opens the user window from the name cell, including one’s own row after a selection', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ThemeProvider theme={createAppTheme('light')}>
          <KanapDialogProvider>
            <MemoryRouter><UsersPage /></MemoryRouter>
          </KanapDialogProvider>
        </ThemeProvider>
      </QueryClientProvider>,
    );
    const name = screen.getByText('Lovelace');
    // The hit area is the whole cell, not the letters alone.
    expect(coversItsCell(name)).toBe(true);
    fireEvent.click(name);
    expect(screen.getByText('user dialog edit identity Ada Lovelace')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'close user' }));
    expect(screen.queryByText('user dialog edit identity Ada Lovelace')).not.toBeInTheDocument();

    // Selecting a row re-renders the page. The columns stay the same object, so the cell under
    // the pointer is not replaced and the click still opens the window.
    const columns = grid.props!.columns;
    act(() => grid.props!.onSelectionChanged([OWN_ROW]));
    expect(grid.props!.columns).toBe(columns);
    fireEvent.click(screen.getByText('Lovelace'));
    expect(screen.getByText('user dialog edit identity Ada Lovelace')).toBeInTheDocument();
  });
});

describe('UsersPage delete', () => {
  it('asks the delete check before its confirmation, and names the users in its words', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ThemeProvider theme={createAppTheme('light')}>
          <KanapDialogProvider>
            <MemoryRouter><UsersPage /></MemoryRouter>
          </KanapDialogProvider>
        </ThemeProvider>
      </QueryClientProvider>,
    );
    const props = deleteButton.props!;
    expect(props).not.toBeNull();
    expect(props.endpoint).toBe('/users/bulk');
    // One's own account: kept, with why (disable it instead).
    const refused = [{ id: 'me', name: 'Claude', code: 'USER_OWN_ACCOUNT', usages: [] }];
    post.mockResolvedValueOnce({ data: { refused } });
    expect(await props.checkDelete(['me', 'b'])).toEqual({ refused });
    expect(post).toHaveBeenCalledWith('/users/delete-check', { ids: ['me', 'b'] });
    expect(String(props.itemLabels.toDelete(2))).toBe('users.delete.toDelete');
    expect(String(props.itemLabels.kept(1))).toBe('users.delete.kept');
    expect(String(props.itemLabels.deleted(2))).toBe('users.delete.deleted');
    // The windows and messages name a user by name, the e-mail only when there is no name.
    expect(props.getItemName({ first_name: 'Ana', last_name: 'Diaz', email: 'ana@example.test' })).toBe('Ana Diaz');
    expect(props.getItemName({ first_name: null, last_name: '', email: 'bo@example.test' })).toBe('bo@example.test');
  });

  it('confirms a row delete without promising a refusal the delete cannot make', async () => {
    // One's own account is the only refusal (asked first, with its own window): no foreign key can
    // refuse a user delete, so the confirmation says nothing about referenced users.
    for (const lang of ['en', 'fr', 'de', 'es']) {
      const admin = (await import(`../locales/${lang}/admin.json`)).default as any;
      const text: string = admin.users.messages.deleteConfirm;
      expect(text, lang).toContain('{{name}}');
      expect(text, lang).not.toMatch(/referen|désactiv|deaktivier|desactiv|disable/i);
    }
  });

  it('names one recipient in the invitation confirmation, and the count when several', async () => {
    for (const lang of ['en', 'fr', 'de', 'es']) {
      const admin = (await import(`../locales/${lang}/admin.json`)).default as any;
      const one: string = admin.users.messages.inviteConfirm_one;
      const many: string = admin.users.messages.inviteConfirm_other;
      expect(one, lang).toContain('{{email}}');
      expect(one, lang).not.toContain('{{count}}');
      expect(many, lang).toContain('{{count}}');
      expect(many, lang).not.toContain('{{email}}');
    }
    const fr = (await import('../locales/fr/admin.json')).default as { users: { messages: { inviteConfirm_one: string } } };
    expect(fr.users.messages.inviteConfirm_one).toBe('Envoyer une invitation à {{email}} ?');
  });
});
