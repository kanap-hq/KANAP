import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import frKnowledge from '../../locales/fr/knowledge.json';
import frCommon from '../../locales/fr/common.json';

// The shipped library and folders show in French; the library and folder columns filter on
// stable keys (library slug, folder system key), whatever the language.
const instance = i18next.createInstance();
void instance.init({
  lng: 'fr',
  resources: { fr: { knowledge: frKnowledge, common: frCommon } },
  ns: ['knowledge', 'common'],
  defaultNS: 'knowledge',
  interpolation: { escapeValue: false },
  initImmediate: false,
});
const translation = vi.hoisted(() => ({ value: null as any }));
vi.mock('react-i18next', () => ({
  useTranslation: () => translation.value,
}));
translation.value = {
  t: (key: string, options?: Record<string, unknown>) => instance.t(key, options),
  i18n: { language: 'fr', resolvedLanguage: 'fr' },
};

vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true, profile: { id: 'user-1' } }) }));
vi.mock('../../i18n/useLocale', () => ({ useLocale: () => 'fr' }));
vi.mock('../../hooks/useGridScopePreference', () => ({ useGridScopePreference: () => ['all', vi.fn()] }));
vi.mock('./components/FolderTreePanel', () => ({ default: () => null, ROOT_FOLDER_DROP_TARGET: '__root__' }));
vi.mock('./components/KnowledgeMoveDialog', () => ({ default: () => null }));
vi.mock('./components/KnowledgeFolderMoveDialog', () => ({ default: () => null }));
vi.mock('./components/KnowledgeTypesManager', () => ({ default: () => null }));
vi.mock('../../components/DeleteSelectedButton', () => ({ default: () => null }));
const grid = vi.hoisted(() => ({ columns: [] as any[] }));
vi.mock('../../components/ServerDataGrid', () => ({
  default: (props: any) => {
    grid.columns = props.columns;
    return null;
  },
}));

import api from '../../api';
import KnowledgePage from './KnowledgePage';

const get = vi.mocked(api.get);
const LIBRARIES = [
  { id: 'lib-docs', name: 'Documents', slug: 'documents', is_system: false, display_order: 0, can_write: true },
  { id: 'lib-templates', name: 'Templates', slug: 'templates', is_system: true, display_order: 1, can_write: true },
  { id: 'lib-managed', name: 'Managed Docs', slug: 'managed-docs', is_system: true, display_order: 2, can_write: true },
  { id: 'lib-sd', name: 'Service Desk Docs', slug: 'service-desk-docs', is_system: false, display_order: 3, can_write: true },
];

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/knowledge?library=managed-docs&allLibraries=1']}>
          <KnowledgePage />
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

const column = (field: string) => grid.columns.find((col) => col.field === field);
const filterOptions = (field: string) => column(field).filterParams.getValues({ context: { getQueryState: () => ({}) } });

describe('KnowledgePage library and folder names', () => {
  beforeEach(() => {
    grid.columns = [];
    get.mockReset();
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
    get.mockImplementation(async (url: string, config?: any) => {
      if (url === '/knowledge-libraries') return { data: LIBRARIES } as any;
      if (url === '/knowledge/filter-values') {
        const field = config?.params?.fields;
        if (field === 'folder_key') return { data: { folder_key: ['integrated_requests', 'Requests', null] } } as any;
        if (field === 'library_key') return { data: { library_key: ['managed-docs', 'service-desk-docs'] } } as any;
      }
      return { data: {} } as any;
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('shows the shipped libraries in French in the library bar, tenant libraries as named', async () => {
    renderPage();
    expect(await screen.findByText('Documents managés')).toBeInTheDocument();
    expect(screen.getByText('Modèles')).toBeInTheDocument();
    expect(screen.getByText('Service Desk Docs')).toBeInTheDocument();
    expect(screen.queryByText('Managed Docs')).not.toBeInTheDocument();
  });

  it('filters the folder column on stable keys and shows the folders in French', async () => {
    renderPage();
    await waitFor(() => expect(column('folder_key')).toBeTruthy());
    expect(column('folder_name')).toBeUndefined();

    const options = await filterOptions('folder_key');
    expect(options).toEqual(expect.arrayContaining([
      { value: 'integrated_requests', label: 'Demandes' },
      { value: 'Requests', label: 'Requests' },
      { value: null, label: frKnowledge.shared.unfiled },
    ]));
    const format = column('folder_key').valueFormatter;
    expect(format({ value: 'integrated_requests', data: { folder_key: 'integrated_requests', folder_system_key: 'integrated_requests', folder_name: 'Requests' } }))
      .toBe('Demandes');
    expect(format({ value: 'Requests', data: { folder_key: 'Requests', folder_system_key: null, folder_name: 'Requests' } }))
      .toBe('Requests');
  });

  it('filters the library column on slugs and shows the libraries in French', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Documents managés')).toBeInTheDocument());
    await waitFor(() => expect(column('library_key')).toBeTruthy());
    expect(column('library_name')).toBeUndefined();

    const options = await filterOptions('library_key');
    expect(options).toEqual([
      { value: 'managed-docs', label: 'Documents managés' },
      { value: 'service-desk-docs', label: 'Service Desk Docs' },
    ]);
    expect(column('library_key').valueFormatter({
      value: 'managed-docs',
      data: { library_key: 'managed-docs', library_slug: 'managed-docs', library_name: 'Managed Docs' },
    })).toBe('Documents managés');
  });
});
