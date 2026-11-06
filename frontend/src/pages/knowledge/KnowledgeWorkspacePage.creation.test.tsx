import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../../components/design';
import NavigationTracker, { resetNavigationTracker } from '../../components/navigation/NavigationTracker';
import { resetCreationStore } from '../../components/workspace/creation/creationStore';
import api from '../../api';
import KnowledgeWorkspacePage from './KnowledgeWorkspacePage';

// Creation at the title (lot V4): the title committed on the new page creates the document with
// what the former Save sent, takes its lock and moves to it in edit mode; "Cancel" deletes it
// while the person stays, "Create" saves what is pending, releases the lock and closes it.

const translation = {
  t: (key: string, opts?: unknown) => {
    const values = opts && typeof opts === 'object' ? opts as Record<string, unknown> : null;
    const args = values ? Object.entries(values).filter(([k]) => k !== 'defaultValue').map(([k, v]) => `${k}=${v}`).join(',') : '';
    return args ? `${key}(${args})` : key;
  },
  i18n: { language: 'en', resolvedLanguage: 'en' },
};
vi.mock('react-i18next', () => ({ useTranslation: () => translation, initReactI18next: { type: '3rdParty', init: () => undefined } }));
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true, profile: { id: 'user-1' } }) }));
vi.mock('../../tenant/TenantContext', () => ({ useTenant: () => ({ tenantSlug: 'acme' }) }));
vi.mock('../workspace/hooks/useRecentlyViewed', () => ({ useRecentlyViewed: () => ({ addToRecent: () => undefined }) }));
vi.mock('../../components/MarkdownEditor', () => ({
  default: (props: { value: string; onChange: (value: string) => void }) => (
    <textarea aria-label="Document body" value={props.value} onChange={(event) => props.onChange(event.target.value)} />
  ),
}));
vi.mock('./components/FolderTreePanel', () => ({ default: () => <div data-testid="folder-tree" /> }));
vi.mock('./components/KnowledgeSidebar', () => ({
  default: (props: { isCreate: boolean }) => <div data-testid="document-sidebar">{props.isCreate ? 'new' : 'live'}</div>,
}));

const mocked = vi.mocked(api);
const TITLE = 'common:buttons.editTitle';
const LIBRARIES = [{ id: 'lib-1', name: 'Runbooks', slug: 'runbooks', is_system: false, display_order: 1, can_write: true }];
const TYPES = [{ id: 'type-doc', name: 'Document', is_active: true, is_default: true, is_system: true }];
const TEMPLATE = { id: 'tpl-1', title: 'Runbook template', content_markdown: '# Steps', document_type_id: 'type-runbook' };
const created = {
  id: 'doc-new', item_number: 9, item_ref: 'DOC-9', title: 'Cheese cellar runbook', content_markdown: '', revision: 1,
  status: 'draft', library_id: 'lib-1', library_slug: 'runbooks', can_write: true, edit_lock: null, creation_token: 'token-1',
};
const detail = { ...created, creation_token: undefined };

function Location() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function StartPage() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate('/knowledge/new?library=runbooks')}>new document</button>;
}

function createLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, String(value)); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => store.clear(),
  };
}

function renderPage(
  entries: string[],
  options: { changes?: { fields: number; children: Record<string, number> }; libraries?: Promise<unknown> } = {},
) {
  const changes = options.changes ?? { fields: 0, children: {} };
  mocked.get.mockImplementation(async (url: string) => {
    if (url === '/knowledge-libraries') return { data: await (options.libraries ?? Promise.resolve(LIBRARIES)) } as never;
    if (url === '/knowledge-types') return { data: TYPES } as never;
    if (url === '/knowledge/tpl-1') return { data: TEMPLATE } as never;
    if (url === '/knowledge/DOC-9' || url === '/knowledge/doc-new') return { data: detail } as never;
    if (url === '/knowledge/doc-new/creation') return { data: { changes } } as never;
    return { data: [] } as never;
  });
  mocked.post.mockImplementation(async (url: string) => {
    if (url === '/knowledge') return { data: created } as never;
    if (url === '/knowledge/doc-new/locks') return { data: { lock_token: 'lock-1', expires_at: '2099-01-01T00:00:00Z' } } as never;
    return { data: {} } as never;
  });
  mocked.patch.mockImplementation(async (_url: string, body: any) => ({ data: { ...detail, ...body, revision: 2 } }) as never);
  mocked.delete.mockResolvedValue({ data: undefined } as never);
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider theme={createAppTheme('light')}>
        <KanapDialogProvider>
          <MemoryRouter initialEntries={entries}>
            <NavigationTracker />
            <Location />
            <Routes>
              <Route path="/start" element={<StartPage />} />
              <Route path="/knowledge" element={<div data-testid="document-list" />} />
              <Route path="/knowledge/new" element={<KnowledgeWorkspacePage />} />
              <Route path="/knowledge/:id" element={<KnowledgeWorkspacePage />} />
            </Routes>
          </MemoryRouter>
        </KanapDialogProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

function location() {
  return screen.getByTestId('location').textContent;
}

async function commitTitle() {
  const input = await screen.findByRole('textbox', { name: TITLE });
  fireEvent.change(input, { target: { value: 'Cheese cellar runbook' } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

async function createRunbook() {
  await commitTitle();
  await waitFor(() => expect(location()).toBe('/knowledge/DOC-9?library=runbooks&allLibraries=0'));
}

describe('Document creation at the title', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    resetCreationStore();
    resetNavigationTracker();
    const storage = createLocalStorage();
    vi.stubGlobal('localStorage', storage);
    Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
  });

  it('opens with the title to type and the document to come dimmed', async () => {
    renderPage(['/knowledge/new?library=runbooks']);
    const input = await screen.findByRole('textbox', { name: TITLE });
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute('placeholder', 'workspace.fields.titlePlaceholder');
    expect(screen.getByRole('button', { name: 'common:buttons.create' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'common:buttons.cancel' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'common:buttons.save' })).toBeNull();
    expect(screen.queryByText('workspace.actions.done')).toBeNull();

    // The editor and the sidebar, out of reach; the folder tree stays live.
    const previews = await screen.findAllByTestId('creation-preview');
    await waitFor(() => expect(previews.some((preview) => within(preview).queryByLabelText('Document body'))).toBe(true));
    expect(previews.some((preview) => within(preview).queryByTestId('document-sidebar'))).toBe(true);
    for (const preview of previews) expect(preview).toHaveAttribute('inert');
    // Nothing written for a document that does not exist yet.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const urls = mocked.get.mock.calls.map(([url]) => String(url));
    expect(urls.filter((url) => /undefined|null|\/\/|\/knowledge\/new\b/.test(url))).toEqual([]);
    expect(mocked.post).not.toHaveBeenCalled();
    expect(mocked.patch).not.toHaveBeenCalled();
  });

  it('creates the document with the former payload, locks it and opens it in edit mode', async () => {
    renderPage(['/knowledge/new?library=runbooks&project_id=prj-1&folder_id=folder-1']);
    await commitTitle();
    await waitFor(() => expect(location()).toBe('/knowledge/DOC-9?library=runbooks&allLibraries=0'));
    expect(mocked.post).toHaveBeenCalledWith('/knowledge', {
      title: 'Cheese cellar runbook',
      summary: '',
      content_markdown: '',
      status: 'draft',
      folder_id: 'folder-1',
      library_id: 'lib-1',
      document_type_id: 'type-doc',
      template_document_id: null,
      relations: { applications: [], assets: [], projects: ['prj-1'], requests: [], tasks: [], incidents: [] },
      owner_user_id: 'user-1',
    });
    expect(mocked.post).toHaveBeenCalledWith('/knowledge/doc-new/locks');
    expect(await screen.findByRole('button', { name: TITLE })).toHaveTextContent('Cheese cellar runbook');
    expect(screen.queryByTestId('creation-preview')).toBeNull();
    expect(screen.getByTestId('document-sidebar')).toHaveTextContent('live');
    expect(screen.getByLabelText('Document body')).toBeTruthy();
    // Create and Cancel; neither Done, Edit, Create version nor Request review.
    expect(screen.getByRole('button', { name: 'common:buttons.cancel' })).toBeTruthy();
    expect(screen.queryByText('workspace.actions.done')).toBeNull();
    expect(screen.queryByText('workspace.actions.edit')).toBeNull();
    expect(screen.queryByText('workspace.actions.createVersion')).toBeNull();
    expect(screen.queryByText('workspace.actions.requestReview')).toBeNull();
  });

  it('creates from a template with its content and type', async () => {
    renderPage(['/knowledge/new?library=runbooks&template_document_id=tpl-1']);
    await commitTitle();
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/knowledge', expect.objectContaining({
      title: 'Cheese cellar runbook', template_document_id: 'tpl-1', document_type_id: 'type-runbook',
    })));
    expect(String((mocked.post.mock.calls.find(([url]) => url === '/knowledge')?.[1] as any)?.content_markdown)).toContain('Steps');
  });

  it('waits for the libraries before creating', async () => {
    let release: (value: unknown) => void = () => undefined;
    const libraries = new Promise((resolve) => { release = resolve; });
    renderPage(['/knowledge/new?library=runbooks'], { libraries });
    await commitTitle();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocked.post).not.toHaveBeenCalled();
    release(LIBRARIES);
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/knowledge', expect.objectContaining({ library_id: 'lib-1' })));
  });

  it('cancels a creation with only its title at once, the lock going with the document', async () => {
    renderPage(['/start']);
    fireEvent.click(await screen.findByRole('button', { name: 'new document' }));
    await createRunbook();
    fireEvent.click(await screen.findByRole('button', { name: 'common:buttons.cancel' }));
    await waitFor(() => expect(location()).toBe('/start'));
    expect(mocked.get).toHaveBeenCalledWith('/knowledge/doc-new/creation', { params: { token: 'token-1' } });
    expect(mocked.delete).toHaveBeenCalledWith('/knowledge/doc-new/creation', { data: { token: 'token-1' } });
    expect(screen.queryByRole('dialog')).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocked.delete.mock.calls.filter(([url]) => String(url).endsWith('/locks'))).toEqual([]);
  });

  it('saves the body typed before asking, then asks before cancelling', async () => {
    renderPage(['/knowledge/new?library=runbooks'], { changes: { fields: 1, children: { relation: 1 } } });
    await createRunbook();
    fireEvent.change(await screen.findByLabelText('Document body'), { target: { value: 'Check the humidity' } });
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.cancel' }));
    const dialog = await screen.findByRole('dialog');
    expect(mocked.patch).toHaveBeenCalledWith(
      '/knowledge/DOC-9',
      expect.objectContaining({ content_markdown: 'Check the humidity', save_mode: 'autosave' }),
      { headers: { 'X-Lock-Token': 'lock-1' } },
    );
    expect(within(dialog).getByText(/common:creation\.confirmMessage/).textContent).toContain(
      'changes=common:creation.changes.fields(count=1), common:creation.changes.relations(count=1)',
    );
    // Kept: the document stays, still under its lock.
    fireEvent.click(within(dialog).getByRole('button', { name: 'common:creation.keep' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mocked.delete).not.toHaveBeenCalledWith('/knowledge/doc-new/creation', expect.anything());
    expect(location()).toBe('/knowledge/DOC-9?library=runbooks&allLibraries=0');
  });

  it('keeps the document on Create, releases its lock and goes back where the creation started', async () => {
    renderPage(['/start']);
    fireEvent.click(await screen.findByRole('button', { name: 'new document' }));
    await createRunbook();
    fireEvent.click(await screen.findByRole('button', { name: 'common:buttons.create' }));
    await waitFor(() => expect(location()).toBe('/start'));
    expect(mocked.delete).toHaveBeenCalledWith('/knowledge/DOC-9/locks', { headers: { 'X-Lock-Token': 'lock-1' } });
    expect(mocked.delete).not.toHaveBeenCalledWith('/knowledge/doc-new/creation', expect.anything());
    expect(mocked.post.mock.calls.filter(([url]) => url === '/knowledge')).toHaveLength(1);
  });

  it('waits for the autosave on its way before the save of Create, with the revision it answered', async () => {
    renderPage(['/start']);
    fireEvent.click(await screen.findByRole('button', { name: 'new document' }));
    await createRunbook();
    // The server refuses a save of an older revision; the first save is held on its way.
    let revision = 1;
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    mocked.patch.mockImplementation(async (_url: string, body: any) => {
      if (revision === 1) await held;
      if (body.revision !== revision) throw { response: { status: 409, data: { message: 'Document revision conflict' } } };
      revision += 1;
      return { data: { ...detail, ...body, revision } } as never;
    });
    fireEvent.change(await screen.findByLabelText('Document body'), { target: { value: 'Heat the sugar' } });
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(1), { timeout: 4000 });
    fireEvent.change(screen.getByLabelText('Document body'), { target: { value: 'Heat the sugar. Stop at the colour.' } });
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mocked.patch).toHaveBeenCalledTimes(1);
    release();
    await waitFor(() => expect(location()).toBe('/start'));
    expect(mocked.patch).toHaveBeenCalledTimes(2);
    expect(mocked.patch.mock.calls[1][1]).toEqual(expect.objectContaining({ revision: 2, content_markdown: 'Heat the sugar. Stop at the colour.' }));
  }, 10000);

  it('shows the error under the empty title on Create, nothing created', async () => {
    renderPage(['/knowledge/new?library=runbooks']);
    await screen.findByRole('textbox', { name: TITLE });
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    expect(await screen.findByText('common:creation.titleRequired')).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('textbox', { name: TITLE })).toHaveFocus());
    expect(mocked.post).not.toHaveBeenCalled();
  });

  it('leaves an empty new document on Escape, to the previous address', async () => {
    renderPage(['/start']);
    fireEvent.click(await screen.findByRole('button', { name: 'new document' }));
    const input = await screen.findByRole('textbox', { name: TITLE });
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(location()).toBe('/start'));
    expect(mocked.post).not.toHaveBeenCalled();
  });
});
