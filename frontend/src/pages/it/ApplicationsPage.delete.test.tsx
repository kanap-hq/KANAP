import React from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import ApplicationsPage from './ApplicationsPage';

const deleteButton = vi.hoisted(() => ({ props: null as null | Record<string, any> }));
const post = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => {
  const t = (key: string, options?: Record<string, unknown>) =>
    (options && 'count' in options ? `${key}:${options.count}${options.removed ? `|${options.removed}` : ''}` : key);
  return {
    initReactI18next: { type: '3rdParty', init: () => undefined },
    useTranslation: () => ({ t, i18n: { language: 'en', resolvedLanguage: 'en' } }),
  };
});
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true, profile: { id: 'me' } }) }));
vi.mock('../../api', () => ({ default: { get: vi.fn(async () => ({ data: { items: [] } })), post } }));
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
  it('asks the check first: applications with interfaces are kept, the warning counts the deployments that go', async () => {
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
    const refused = [{ id: 'b', name: 'ERP', code: 'APPLICATION_HAS_INTERFACES', usages: [{ type: 'interfaces', total: 2 }] }];
    post.mockResolvedValueOnce({ data: { refused, removes: [{ type: 'app_instances', total: 3 }] } });
    expect(await props.checkDelete(['a', 'b', 'c'])).toEqual({
      refused,
      warning: 'pages.applications.delete.warningCounted:2|common:delete.usages.app_instances:3',
    });
    expect(post).toHaveBeenCalledWith('/applications/delete-check', { ids: ['a', 'b', 'c'] });
    post.mockResolvedValueOnce({ data: { refused: [], removes: [] } });
    expect(await props.checkDelete(['a'])).toEqual({ refused: [], warning: 'pages.applications.delete.warningLinks:1' });
    expect(props.itemLabels.kept(1)).toBe('pages.applications.delete.kept:1');
    expect(props.itemLabels.toDelete(2)).toBe('pages.applications.delete.toDelete:2');
    expect(props.itemLabels.deleted(2)).toBe('pages.applications.delete.deleted:2');
    expect(props.itemLabels.title(2)).toBe('pages.applications.delete.title:2');
    expect(props.itemLabels.keptDone(1)).toBe('pages.applications.delete.keptDone:1');
    expect(props.itemLabels.titleCountsDeleted).toBe(true);
    // Applications are named with their reference, to tell apart the ones that share a name.
    expect(props.getItemName({ id: 'a', sequential_id: 'APP-7', name: 'ERP' })).toBe('APP-7 ERP');
  });

  it('words what goes in each language, and nothing about references', async () => {
    for (const lang of ['en', 'fr', 'de', 'es']) {
      const it = (await import(`../../locales/${lang}/it.json`)).default as any;
      const errors = (await import(`../../locales/${lang}/errors.json`)).default as any;
      expect(errors.APPLICATION_HAS_INTERFACES_one, lang).toContain('{{usages}}');
      expect(errors.APPLICATION_HAS_INTERFACES_other, lang).toContain('{{usages}}');
      const words = it.pages.applications.delete;
      for (const key of ['warningCounted_one', 'warningCounted_other']) expect(words[key], `${lang} ${key}`).toContain('{{removed}}');
      expect(it.workspace.application.deleteMessageWithDeployments, lang).toContain('{{deployments}}');
      // The kept list names the application above its reason: the reason does not repeat it.
      for (const key of ['keptReason_one', 'keptReason_other']) {
        expect(words[key], `${lang} ${key}`).toContain('{{usages}}');
        expect(words[key], `${lang} ${key}`).not.toContain('{{name}}');
      }
      for (const text of [words.warning_one, words.warning_other, words.kept_one, words.kept_other, it.workspace.application.deleteMessage]) {
        expect(text, lang).toBeTruthy();
        expect(text, lang).not.toMatch(/referen|bloqu|blockiert|bloque/i);
      }
    }
  });
});
