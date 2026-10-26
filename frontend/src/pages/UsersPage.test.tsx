import React from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../config/ThemeContext';
import { KanapDialogProvider } from '../components/design';
import UsersPage from './UsersPage';

const deleteButton = vi.hoisted(() => ({ props: null as null | Record<string, any> }));
const post = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true, tenantAuth: null }) }));
vi.mock('../api', () => ({ default: { get: vi.fn(async () => ({ data: { items: [] } })), post } }));
vi.mock('../i18n/useLocale', () => ({ useLocale: () => 'en' }));
vi.mock('../components/ServerDataGrid', () => ({ default: () => null }));
vi.mock('../components/csv/CsvExportDialog', () => ({ default: () => null }));
vi.mock('../components/csv/CsvImportDialog', () => ({ default: () => null }));
vi.mock('../components/DeleteSelectedButton', () => ({
  default: (props: Record<string, any>) => {
    deleteButton.props = props;
    return null;
  },
}));

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
