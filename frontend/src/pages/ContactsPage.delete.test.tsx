import React from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../config/ThemeContext';
import ContactsPage from './ContactsPage';

const deleteButton = vi.hoisted(() => ({ props: null as null | Record<string, any> }));

vi.mock('react-i18next', () => {
  const t = (key: string, options?: Record<string, unknown>) => (options && 'count' in options ? `${key}:${options.count}` : key);
  return {
    initReactI18next: { type: '3rdParty', init: () => undefined },
    useTranslation: () => ({ t, i18n: { language: 'en', resolvedLanguage: 'en' } }),
  };
});
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));
vi.mock('../api', () => ({ default: { get: vi.fn(async () => ({ data: { items: [] } })) } }));
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

describe('ContactsPage delete', () => {
  it('says the links go and the linked records stay, with no promise of a refusal the delete cannot make', async () => {
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter><ContactsPage /></MemoryRouter>
      </ThemeProvider>,
    );
    expect(deleteButton.props?.warning).toBe('contacts.delete.warning:0');
    for (const lang of ['en', 'fr', 'de', 'es']) {
      const md = (await import(`../locales/${lang}/master-data.json`)).default as any;
      for (const text of [md.contacts.delete.warning_one, md.contacts.delete.warning_other]) {
        expect(text, lang).toBeTruthy();
        expect(text, lang).not.toMatch(/referen|bloqu|blockiert|bloque/i);
      }
    }
  });

  it('names contacts in the dialog and the message once done, in the four languages', async () => {
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter><ContactsPage /></MemoryRouter>
      </ThemeProvider>,
    );
    const labels = deleteButton.props?.itemLabels;
    expect(labels.toDelete(2)).toBe('contacts.delete.toDelete:2');
    expect(labels.deleted(2)).toBe('contacts.delete.deleted:2');
    expect(labels.title(2)).toBe('contacts.delete.title:2');
    for (const lang of ['en', 'fr', 'de', 'es']) {
      const md = (await import(`../locales/${lang}/master-data.json`)).default as any;
      for (const key of ['toDelete', 'deleted', 'title']) {
        expect(md.contacts.delete[`${key}_one`], `${lang} ${key}`).toBeTruthy();
        expect(md.contacts.delete[`${key}_other`], `${lang} ${key}`).toBeTruthy();
      }
    }
  });
});
