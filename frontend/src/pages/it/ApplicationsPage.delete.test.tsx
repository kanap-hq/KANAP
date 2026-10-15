import React from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import ApplicationsPage from './ApplicationsPage';

const deleteButton = vi.hoisted(() => ({ props: null as null | Record<string, any> }));

vi.mock('react-i18next', () => {
  const t = (key: string, options?: Record<string, unknown>) => (options && 'count' in options ? `${key}:${options.count}` : key);
  return {
    initReactI18next: { type: '3rdParty', init: () => undefined },
    useTranslation: () => ({ t, i18n: { language: 'en', resolvedLanguage: 'en' } }),
  };
});
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true, profile: { id: 'me' } }) }));
vi.mock('../../api', () => ({ default: { get: vi.fn(async () => ({ data: { items: [] } })), post: vi.fn() } }));
vi.mock('../../hooks/useItOpsEnumOptions', () => ({ default: () => ({ settings: null, byField: {}, labelFor: (_field: string, code: string) => code }) }));
vi.mock('../../tenant/TenantContext', () => ({ useTenant: () => ({ tenantSlug: 'acme' }) }));
vi.mock('../../hooks/useApplicationClassificationCatalog', () => ({ default: () => ({ data: null }) }));
vi.mock('../../components/ServerDataGrid', () => ({ default: () => null }));
vi.mock('../../components/csv', () => ({ CsvExportDialogV2: () => null, CsvImportDialogV2: () => null }));
vi.mock('../../components/DeleteSelectedButton', () => ({
  default: (props: Record<string, any>) => {
    deleteButton.props = props;
    return null;
  },
}));

describe('ApplicationsPage delete', () => {
  it('says what goes with the applications, with no promise of a refusal the delete cannot make', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ThemeProvider theme={createAppTheme('light')}>
          <MemoryRouter><ApplicationsPage /></MemoryRouter>
        </ThemeProvider>
      </QueryClientProvider>,
    );
    const props = deleteButton.props!;
    expect(props).not.toBeNull();
    expect(props.endpoint).toBe('/applications/bulk');
    expect(props.warning).toBe('pages.applications.delete.warning:0');
    expect(props.itemLabels.toDelete(2)).toBe('pages.applications.delete.toDelete:2');
    expect(props.itemLabels.deleted(2)).toBe('pages.applications.delete.deleted:2');
  });

  it('words what goes in each language, and nothing about references', async () => {
    for (const lang of ['en', 'fr', 'de', 'es']) {
      const it = (await import(`../../locales/${lang}/it.json`)).default as any;
      for (const text of [it.pages.applications.delete.warning_one, it.pages.applications.delete.warning_other, it.workspace.application.deleteMessage]) {
        expect(text, lang).toBeTruthy();
        expect(text, lang).not.toMatch(/referen|bloqu|blockiert|bloque/i);
      }
    }
  });
});
