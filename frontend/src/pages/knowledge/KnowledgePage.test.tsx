import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import frKnowledge from '../../locales/fr/knowledge.json';
import frCommon from '../../locales/fr/common.json';
import frErrors from '../../locales/fr/errors.json';
import { KanapDialogProvider } from '../../components/design';

// The shipped library and folders show in French; the library and folder columns filter on
// stable keys (library slug, folder system key), whatever the language.
const instance = i18next.createInstance();
void instance.init({
  lng: 'fr',
  resources: { fr: { knowledge: frKnowledge, common: frCommon, errors: frErrors } },
  ns: ['knowledge', 'common', 'errors'],
  defaultNS: 'knowledge',
  interpolation: { escapeValue: false },
  initImmediate: false,
});
const translation = vi.hoisted(() => ({ value: null as any }));
vi.mock('react-i18next', () => ({
  useTranslation: (ns?: string | string[]) => translation.value(ns),
}));
// One stable `t` per namespace list (a new `t` on each render would loop effects).
const translators = new Map<string, unknown>();
translation.value = (ns?: string | string[]) => {
  const key = JSON.stringify(ns ?? null);
  if (!translators.has(key)) {
    const namespaces = ns ? (Array.isArray(ns) ? ns : [ns]) : undefined;
    translators.set(key, {
      t: (k: string, options?: Record<string, unknown>) => instance.t(k, { ...(namespaces ? { ns: namespaces } : {}), ...options }),
      i18n: { language: 'fr', resolvedLanguage: 'fr' },
    });
  }
  return translators.get(key);
};

const auth = vi.hoisted(() => ({ level: 'admin' as 'admin' | 'reader' }));
const scope = vi.hoisted(() => ({ value: 'all' as 'all' | 'my' | 'team', set: vi.fn() }));
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    hasLevel: (_area: string, level: string) => auth.level === 'admin' || level === 'reader',
    profile: { id: 'user-1' },
  }),
}));
vi.mock('../../i18n/useLocale', () => ({ useLocale: () => 'fr' }));
vi.mock('../../hooks/useGridScopePreference', () => ({ useGridScopePreference: () => [scope.value, scope.set] }));
vi.mock('./components/FolderTreePanel', () => ({ default: () => null, ROOT_FOLDER_DROP_TARGET: '__root__' }));
vi.mock('./components/KnowledgeMoveDialog', () => ({ default: () => null }));
vi.mock('./components/KnowledgeFolderMoveDialog', () => ({ default: () => null }));
vi.mock('./components/KnowledgeTypesManager', () => ({ default: () => null }));
vi.mock('../../components/DeleteSelectedButton', () => ({ default: () => null }));
const grid = vi.hoisted(() => ({ columns: [] as any[], props: null as null | Record<string, any> }));
vi.mock('../../components/ServerDataGrid', () => ({
  default: (props: any) => {
    grid.columns = props.columns;
    grid.props = props;
    return null;
  },
}));

import api from '../../api';
import KnowledgePage from './KnowledgePage';

const get = vi.mocked(api.get);
const LIBRARIES = [
  { id: 'lib-docs', name: 'Documents', slug: 'documents', is_system: false, display_order: 0, can_write: true, can_manage: true },
  { id: 'lib-templates', name: 'Templates', slug: 'templates', is_system: true, display_order: 1, can_write: true },
  { id: 'lib-managed', name: 'Managed Docs', slug: 'managed-docs', is_system: true, display_order: 2, can_write: true },
  { id: 'lib-sd', name: 'Service Desk Docs', slug: 'service-desk-docs', is_system: false, display_order: 3, can_write: true },
];

function renderPage(url = '/knowledge?library=managed-docs&allLibraries=1') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={queryClient}>
        <KanapDialogProvider>
          <MemoryRouter initialEntries={[url]}>
            <KnowledgePage />
          </MemoryRouter>
        </KanapDialogProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

const column = (field: string) => grid.columns.find((col) => col.field === field);
const filterOptions = (field: string) => column(field).filterParams.getValues({ context: { getQueryState: () => ({}) } });

describe('KnowledgePage library and folder names', () => {
  beforeEach(() => {
    grid.columns = [];
    grid.props = null;
    auth.level = 'admin';
    scope.value = 'all';
    get.mockReset();
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
    get.mockImplementation(async (url: string, config?: any) => {
      if (url === '/knowledge-libraries') return { data: LIBRARIES } as any;
      if (url === '/knowledge/contributor-options') return { data: [] } as any;
      if (url === '/knowledge-libraries/lib-docs') {
        return {
          data: {
            ...LIBRARIES[0],
            can_manage: true,
            is_default: true,
            owner_user_id: 'user-1',
            owner: { id: 'user-1', email: 'me@example.test', label: 'Me' },
            readers: [],
            writers: [],
          },
        } as any;
      }
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

  it('refuses to delete the default library in a single window, with Close only', async () => {
    renderPage('/knowledge?library=documents&allLibraries=0');
    fireEvent.click(await screen.findByText(frKnowledge.libraries.manage));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/knowledge-libraries/lib-docs'));
    await screen.findByDisplayValue('Documents');
    fireEvent.click(screen.getByRole('button', { name: frCommon.buttons.delete }));

    const refusal = await screen.findByText(frErrors.knowledge_default_library);
    const dialog = refusal.closest('[role="dialog"]') as HTMLElement;
    expect(within(dialog).getByRole('button', { name: frCommon.buttons.close })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: frKnowledge.dialogs.deleteLibrary.actions.confirm })).not.toBeInTheDocument();
    expect(screen.queryByText(frKnowledge.confirmations.deleteLibrary)).not.toBeInTheDocument();
  });

  async function showEmpty(url: string) {
    renderPage(url);
    await screen.findByTestId('knowledge-context');
    const emptyState = grid.props?.emptyState as React.ReactElement;
    render(<ThemeProvider theme={createAppTheme('light')}>{emptyState}</ThemeProvider>);
    return screen.getByTestId('knowledge-empty');
  }

  it('says this library is empty, with the creation for someone who may write it', async () => {
    const empty = await showEmpty('/knowledge?library=documents');
    expect(empty.textContent).toContain(frKnowledge.empty.library);
    expect(empty.querySelector('button')?.textContent).toBe(frKnowledge.actions.newDocument);
    expect(grid.props?.extraNarrows).toBe(false);
  });

  it('says this folder is empty when a folder is open', async () => {
    const empty = await showEmpty('/knowledge?library=documents&folder_id=fld-1');
    expect(empty.textContent).toContain(frKnowledge.empty.folder);
    expect(empty.querySelector('button')?.textContent).toBe(frKnowledge.actions.newDocument);
  });

  it('says there are no documents when every library is in the list', async () => {
    const empty = await showEmpty('/knowledge?library=documents&allLibraries=1');
    expect(empty.textContent).toContain(frKnowledge.empty.all);
  });

  it('keeps My documents on the filtered empty line', async () => {
    scope.value = 'my';
    renderPage('/knowledge?library=documents');
    await screen.findByTestId('knowledge-context');
    expect(grid.props?.extraNarrows).toBe(true);
  });

  it('leaves the creation out for a reader', async () => {
    auth.level = 'reader';
    const empty = await showEmpty('/knowledge?library=documents');
    expect(empty.textContent).toBe(frKnowledge.empty.library);
    expect(empty.querySelector('button')).toBeNull();
  });

  it('leaves the creation out of a library the person cannot write', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/knowledge-libraries') return { data: LIBRARIES.map((lib) => ({ ...lib, can_write: false })) } as any;
      return { data: {} } as any;
    });
    const empty = await showEmpty('/knowledge?library=documents');
    expect(empty.textContent).toBe(frKnowledge.empty.library);
    expect(empty.querySelector('button')).toBeNull();
  });
});
