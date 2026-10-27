import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import frAdmin from '../../locales/fr/admin.json';
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
vi.mock('../../components/PageHeader', () => ({ default: () => null }));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={client}><RolesPage /></QueryClientProvider>
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
