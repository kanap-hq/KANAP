import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import RolesPage from './RolesPage';

const api = vi.hoisted(() => ({ get: vi.fn(), delete: vi.fn(), post: vi.fn(), put: vi.fn() }));
const roles = vi.hoisted(() => ({ items: [] as Array<Record<string, unknown>> }));

// `t` names the key and the values it was given, so the test reads which sentence is shown.
const t = vi.hoisted(() => (key: string, options?: Record<string, unknown>) =>
  (options?.usages ? `${key} [${String(options.usages)}]` : key));

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t, i18n: { language: 'en', resolvedLanguage: 'en' } }),
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

describe('RolesPage delete', () => {
  beforeEach(() => {
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
