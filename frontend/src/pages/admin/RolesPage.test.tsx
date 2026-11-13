import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import frAdmin from '../../locales/fr/admin.json';
import enAdmin from '../../locales/en/admin.json';
import deAdmin from '../../locales/de/admin.json';
import esAdmin from '../../locales/es/admin.json';
import { KanapDialogProvider } from '../../components/design';
import RolesPage from './RolesPage';

const api = vi.hoisted(() => ({ get: vi.fn(), delete: vi.fn(), post: vi.fn(), put: vi.fn() }));
const roles = vi.hoisted(() => ({ items: [] as Array<Record<string, unknown>> }));
const i18nState = vi.hoisted(() => ({ language: 'en', text: (_key: string): string | undefined => undefined }));

// `t` names the key and the values it was given, so the test reads which sentence is shown.
// In French, a built-in role key resolves to the locale file. Every other call keeps the key,
// including ones that pass a default, so the delete sentences stay comparable.
const t = vi.hoisted(() => (key: string, options?: Record<string, unknown>) => {
  if (options?.usages) return `${key} [${String(options.usages)}]`;
  if (i18nState.language !== 'en') {
    const translated = i18nState.text(key);
    if (translated) return translated;
  }
  return key;
});

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({
    t,
    i18n: {
      get language() { return i18nState.language; },
      get resolvedLanguage() { return i18nState.language; },
    },
  }),
}));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));
vi.mock('../../api', () => ({ default: api }));
vi.mock('../../components/PageHeader', () => ({ default: ({ actions }: { actions?: React.ReactNode }) => <>{actions}</> }));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={client}><KanapDialogProvider><RolesPage /></KanapDialogProvider></QueryClientProvider>
    </ThemeProvider>,
  );
}

const SHIPPED_BUDGET_ADMIN = {
  id: 'built-in',
  role_name: 'Budget Administrator',
  role_description: 'Full control over budget management including budget lines, contracts, and reporting',
  is_built_in: true,
  user_count: 0,
};

function frenchBuiltIn(key: string): string | undefined {
  const path = key.replace(/^admin:/, '').split('.');
  if (path[0] !== 'roles' || path[1] !== 'builtIn') return undefined;
  const entry = frAdmin.roles.builtIn[path[2] as keyof typeof frAdmin.roles.builtIn];
  const value = entry?.[path[3] as 'name' | 'description'];
  return typeof value === 'string' ? value : undefined;
}

describe('RolesPage delete', () => {
  beforeEach(() => {
    i18nState.language = 'en';
    i18nState.text = () => undefined;
    api.get.mockReset();
    api.delete.mockReset();
    api.get.mockImplementation(async (url: string) => (url === '/roles' ? { data: roles } : { data: {} }));
  });

  it('says why a role given to users is kept, with Close only', async () => {
    roles.items = [{ id: 'r1', role_name: 'Buyers', role_description: '', user_count: 2 }];
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'common:buttons.delete' }));
    expect(await screen.findByText('errors:ROLE_IN_USE [common:delete.usages.users]')).toBeTruthy();
    expect(within(screen.getByRole('dialog')).queryByRole('button', { name: 'common:buttons.delete' })).toBeNull();
    expect(screen.getByRole('button', { name: 'common:buttons.close' })).toBeTruthy();
    expect(api.delete).not.toHaveBeenCalled();
  });

  it('words a refused delete in the interface language', async () => {
    roles.items = [{ id: 'r2', role_name: 'Auditors', role_description: '', user_count: 0 }];
    api.delete.mockRejectedValueOnce({
      response: { status: 409, data: { code: 'ROLE_IN_USE', message: 'Cannot delete role "Auditors" with users assigned.', usages: [{ type: 'users', total: 1 }] } },
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'common:buttons.delete' }));
    const buttons = await screen.findAllByRole('button', { name: 'common:buttons.delete' });
    fireEvent.click(buttons[buttons.length - 1]);
    expect(await screen.findByText('errors:ROLE_IN_USE [common:delete.usages.users]')).toBeTruthy();
    expect(screen.queryByText(/Cannot delete role/)).toBeNull();
  });
});

describe('RolesPage built-in names', () => {
  beforeEach(() => {
    i18nState.language = 'fr';
    i18nState.text = frenchBuiltIn;
    api.get.mockReset();
    api.get.mockImplementation(async (url: string) => (url === '/roles' ? { data: roles } : { data: {} }));
  });

  afterEach(() => {
    i18nState.language = 'en';
    i18nState.text = () => undefined;
  });

  it('shows a built-in role in French and leaves a custom role as stored', async () => {
    roles.items = [
      SHIPPED_BUDGET_ADMIN,
      { id: 'custom', role_name: 'Acheteurs', role_description: 'Valide les achats', is_built_in: false, is_system: false, user_count: 0 },
    ];
    renderPage();
    expect((await screen.findAllByText('Administrateur budget')).length).toBeGreaterThan(0);
    expect(screen.getByText('Contrôle complet de la gestion budgétaire, y compris les lignes budgétaires, les contrats et les rapports')).toBeTruthy();
    expect(screen.getAllByText('Acheteurs').length).toBeGreaterThan(0);
    expect(screen.getByText('Valide les achats')).toBeTruthy();
    expect(screen.queryByText('Budget Administrator')).toBeNull();
  });

  it('shows a renamed built-in role under its stored name', async () => {
    roles.items = [
      { id: 'renamed', role_name: 'Budget desk', role_description: 'Ancienne description', is_built_in: true, user_count: 0 },
    ];
    renderPage();
    expect((await screen.findAllByText('Budget desk')).length).toBeGreaterThan(0);
    expect(screen.getByText('Ancienne description')).toBeTruthy();
    expect(screen.queryByText('Administrateur budget')).toBeNull();
  });
});

describe('RolesPage refused writes', () => {
  beforeEach(() => {
    i18nState.language = 'en';
    i18nState.text = () => undefined;
    api.get.mockReset();
    api.post.mockReset();
    api.put.mockReset();
  });

  it('keeps the new role dialog open with the refusal in the interface language', async () => {
    roles.items = [{ id: 'r1', role_name: 'Buyers', role_description: '', user_count: 0 }];
    api.get.mockImplementation(async (url: string) => (url === '/roles' ? { data: roles } : { data: {} }));
    api.post.mockRejectedValueOnce({
      response: { status: 400, data: { code: 'ROLE_NAME_RESERVED', message: 'This name is the name of a built-in role.' } },
    });
    renderPage();
    await screen.findAllByText('Buyers');
    fireEvent.click(screen.getByRole('button', { name: 'roles.actions.newRole' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('roles.fields.roleName'), { target: { value: 'Administrateur' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'common:buttons.create' }));
    expect(await within(dialog).findByText('errors:ROLE_NAME_RESERVED')).toBeTruthy();
    expect(screen.queryByText(/name of a built-in role/)).toBeNull();
  });

  it('says why a right was refused and shows the saved level again', async () => {
    roles.items = [{ id: 'r1', role_name: 'Buyers', role_description: '', user_count: 0 }];
    api.get.mockImplementation(async (url: string) => {
      if (url === '/roles') return { data: roles };
      if (url === '/roles/r1/permissions') return { data: { budget: 'reader' } };
      return { data: {} };
    });
    api.put.mockRejectedValueOnce({
      response: { status: 403, data: { code: 'administrator_required', message: 'Only an Administrator can do this.' } },
    });
    renderPage();
    const budget = await screen.findByRole('combobox', { name: 'roles.resources.budget' });
    await within(budget).findByText('roles.levels.reader');
    fireEvent.mouseDown(budget);
    fireEvent.click(await screen.findByRole('option', { name: 'roles.levels.admin' }));
    expect(within(budget).getByText('roles.levels.admin')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'roles.actions.savePermissions' }));
    expect(await screen.findByText('errors:administrator_required')).toBeTruthy();
    expect(within(screen.getByRole('combobox', { name: 'roles.resources.budget' })).getByText('roles.levels.reader')).toBeTruthy();
  });
});

describe('RolesPage duplicate', () => {
  beforeEach(() => {
    i18nState.language = 'en';
    i18nState.text = () => undefined;
    api.get.mockReset();
    api.post.mockReset();
    api.get.mockImplementation(async (url: string) => (url === '/roles' ? { data: roles } : { data: {} }));
  });

  it('asks the name of the copy, proposed in the language on screen, and sends it', async () => {
    roles.items = [{ id: 'r5', role_name: 'Acheteurs', role_description: null, user_count: 0 }];
    api.post.mockResolvedValueOnce({ data: { id: 'r6', role_name: 'Acheteurs bis', role_description: null } });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'roles.actions.duplicate' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('roles.dialogs.duplicateTitle')).toBeTruthy();
    const name = within(dialog).getByRole('textbox') as HTMLInputElement;
    // The proposed name comes from the locale files (below), never an English suffix.
    expect(name.value).toBe('roles.dialogs.duplicateName');
    expect(api.post).not.toHaveBeenCalled();
    fireEvent.change(name, { target: { value: 'Acheteurs bis' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'roles.actions.duplicate' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/roles/r5/duplicate', { role_name: 'Acheteurs bis' }));
  });

  it('proposes the copy name in each language', () => {
    const names = [enAdmin, frAdmin, deAdmin, esAdmin].map((file) => file.roles.dialogs.duplicateName);
    expect(names).toEqual(['{{name}} (copy)', '{{name}} (copie)', '{{name}} (Kopie)', '{{name}} (copia)']);
  });

  it('shows a role without a description with no React warning', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      roles.items = [
        { id: 'r7', role_name: 'Acheteurs', role_description: 'Valide les achats', user_count: 0 },
        { id: 'r8', role_name: 'Auditeurs', role_description: null, user_count: 0 },
      ];
      renderPage();
      fireEvent.click(await screen.findByText('Auditeurs'));
      await waitFor(() => expect((screen.getByLabelText('roles.fields.description') as HTMLInputElement).value).toBe(''));
      const warnings = errors.mock.calls.map((call) => String(call[0])).filter((text) => /should not be null|uncontrolled|controlled/.test(text));
      expect(warnings).toEqual([]);
    } finally {
      errors.mockRestore();
    }
  });
});
