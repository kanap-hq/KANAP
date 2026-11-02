import React from 'react';
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
import RequestWorkspacePage from './RequestWorkspacePage';

// Creation at the title (lot 1b): the name committed in the header creates the request with the
// classification defaults, the page moves to it with every tab open, and "Cancel creation"
// deletes it while the person stays. The name lives in the header only.

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
const auth = vi.hoisted(() => ({ admin: false }));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: (_resource: string, level: string) => auth.admin || level !== 'admin', profile: { id: 'user-1', first_name: 'Ada', last_name: 'Lovelace' } }),
}));
vi.mock('../../tenant/TenantContext', () => ({ useTenant: () => ({ tenantSlug: 'acme' }) }));
vi.mock('../../i18n/useLocale', () => ({ useLocale: () => 'en' }));
vi.mock('../../hooks/useRequestNav', () => ({
  useRequestNav: () => ({ total: 0, index: 0, hasPrev: false, hasNext: false, prevId: null, nextId: null }),
}));
vi.mock('../../hooks/useClassificationDefaults', () => ({
  useClassificationDefaults: () => ({ data: { source_id: 'src-1', category_id: 'cat-1', stream_id: 'str-1', company_id: 'co-1' }, isLoading: false }),
}));
vi.mock('../workspace/hooks/useRecentlyViewed', () => ({ useRecentlyViewed: () => ({ addToRecent: () => undefined }) }));
vi.mock('./workspace/portfolioRelations', () => ({
  portfolioLinksKey: (entity: string, id: string) => ['portfolio-links', entity, id],
  usePortfolioRelationsBadge: () => 0,
}));
vi.mock('../../components/IntegratedDocumentEditor', () => ({ default: () => <div data-testid="purpose-editor" /> }));
vi.mock('./workspace/request/RequestActivityTab', () => ({ default: () => <div data-testid="request-activity" /> }));
vi.mock('../../components/workspace/SendLinkButton', () => ({ default: () => null }));
vi.mock('../../components/workspace/MetadataUserPicker', () => ({
  default: (props: { label: string; displayName: string | null }) => <span>{`${props.label}: ${props.displayName ?? ''}`}</span>,
  formatMetadataUserName: (user: { first_name?: string; last_name?: string } | null) => (user ? `${user.first_name} ${user.last_name}` : null),
}));
vi.mock('../../components/fields/UserSelect', () => ({ default: () => null }));
vi.mock('../../components/fields/CompanySelect', () => ({ default: (props: { value: string | null }) => <span>{`company:${props.value}`}</span> }));
vi.mock('../../components/fields/DepartmentSelect', () => ({ default: () => null }));
vi.mock('../../components/fields/TeamMemberMultiSelect', () => ({ default: () => null }));
vi.mock('../../components/history/RecordHistoryTab', () => ({ default: () => null }));

const mocked = vi.mocked(api);
const TITLE = 'common:buttons.editTitle';
const CLASSIFICATION = {
  sources: [{ id: 'src-1', name: 'Business', is_active: true }],
  categories: [{ id: 'cat-1', name: 'Growth', is_active: true }],
  streams: [{ id: 'str-1', name: 'Digital', category_id: 'cat-1', is_active: true }],
};
const created = { id: 'req-new', item_number: 9, name: 'Data platform', status: 'pending_review', creation_token: 'token-1' };
const detail = { ...created, creation_token: undefined, activities: [], source_id: 'src-1', category_id: 'cat-1', stream_id: 'str-1', company_id: 'co-1' };

function Location() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function StartPage() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate('/portfolio/requests/new/summary')}>new request</button>;
}

function renderPage(
  entries: string[],
  options: { changes?: { fields: number; children: Record<string, number> }; classification?: Promise<unknown> } = {},
) {
  const changes = options.changes ?? { fields: 0, children: {} };
  mocked.get.mockImplementation(async (url: string) => {
    if (url === '/portfolio/classification/all') return { data: await (options.classification ?? Promise.resolve(CLASSIFICATION)) } as never;
    if (url === '/portfolio/requests/REQ-9' || url === '/portfolio/requests/req-new') return { data: detail } as never;
    if (url === '/portfolio/requests/req-new/creation') return { data: { changes } } as never;
    return { data: {} } as never;
  });
  mocked.post.mockImplementation(async (url: string) => (url === '/portfolio/requests' ? { data: created } : { data: {} }) as never);
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
              <Route path="/portfolio/requests" element={<div data-testid="request-list" />} />
              <Route path="/portfolio/requests/:id/:tab" element={<RequestWorkspacePage />} />
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
  fireEvent.change(input, { target: { value: 'Data platform' } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

async function createDataPlatform() {
  await commitTitle();
  await waitFor(() => expect(location()).toBe('/portfolio/requests/REQ-9/summary'));
}

describe('Request creation at the title', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    resetCreationStore();
    resetNavigationTracker();
    auth.admin = false;
  });

  it('opens with the title to type and the request to come dimmed, without its name field', async () => {
    renderPage(['/portfolio/requests/new/summary']);
    const input = await screen.findByRole('textbox', { name: TITLE });
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute('placeholder', 'portfolio:workspace.request.title.new');
    // Create and Cancel in place of the close button.
    expect(screen.getByRole('button', { name: 'common:buttons.create' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'common:buttons.cancel' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'common:buttons.close' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'portfolio:labels.analysis' })).toBeDisabled();

    // The metadata, the summary and the properties panel of an empty request.
    const previews = screen.getAllByTestId('creation-preview');
    expect(previews).toHaveLength(3);
    expect(previews.some((preview) => within(preview).queryByTestId('purpose-editor'))).toBe(true);
    const panel = previews.find((preview) => within(preview).queryByText('workspace.request.fields.source'));
    expect(panel).toBeTruthy();
    // The panel shows the defaults the request will take.
    await waitFor(() => expect(panel).toHaveTextContent('company:co-1'));
    expect(screen.queryByText('workspace.request.fields.requestName')).toBeNull();
    for (const preview of previews) {
      expect(preview).toHaveAttribute('inert');
      expect(preview).toHaveAttribute('aria-hidden', 'true');
      expect(within(preview).queryAllByRole('textbox')).toHaveLength(0);
      expect(within(preview).queryAllByRole('combobox')).toHaveLength(0);
    }
    // Nothing read or written for a request that does not exist yet.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const urls = mocked.get.mock.calls.map(([url]) => String(url));
    expect(urls.filter((url) => /undefined|null|\/\/|\/portfolio\/requests\/new\b/.test(url))).toEqual([]);
    expect(mocked.post).not.toHaveBeenCalled();
    expect(mocked.patch).not.toHaveBeenCalled();
  });

  it('does nothing on Ctrl+S while the title is empty', async () => {
    renderPage(['/portfolio/requests/new/summary']);
    const input = await screen.findByRole('textbox', { name: TITLE });
    fireEvent.keyDown(input, { key: 's', ctrlKey: true });
    expect(mocked.post).not.toHaveBeenCalled();
  });

  it('creates the request with the classification defaults, then opens every tab', async () => {
    renderPage(['/portfolio/requests/new/summary']);
    await createDataPlatform();
    expect(mocked.post).toHaveBeenCalledTimes(1);
    expect(mocked.post).toHaveBeenCalledWith('/portfolio/requests', {
      name: 'Data platform', source_id: 'src-1', category_id: 'cat-1', stream_id: 'str-1', company_id: 'co-1',
    });
    expect(await screen.findByRole('button', { name: TITLE })).toHaveTextContent('Data platform');
    for (const tab of screen.getAllByRole('tab')) expect(tab).not.toBeDisabled();
    expect(screen.queryByTestId('creation-preview')).toBeNull();
    expect(screen.queryByText('workspace.request.fields.requestName')).toBeNull();
    expect(screen.getByRole('button', { name: 'common:buttons.cancel' })).toBeTruthy();
  });

  it('waits for the classification defaults before creating', async () => {
    let release: (value: unknown) => void = () => undefined;
    const classification = new Promise((resolve) => { release = resolve; });
    renderPage(['/portfolio/requests/new/summary'], { classification });
    await commitTitle();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocked.post).not.toHaveBeenCalled();
    release(CLASSIFICATION);
    await waitFor(() => expect(mocked.post).toHaveBeenCalledTimes(1));
    expect(mocked.post.mock.calls[0][1]).toMatchObject({ name: 'Data platform', category_id: 'cat-1', stream_id: 'str-1' });
    await waitFor(() => expect(location()).toBe('/portfolio/requests/REQ-9/summary'));
  });

  it('cancels a creation with only its title at once, and goes back where it started', async () => {
    renderPage(['/start']);
    fireEvent.click(await screen.findByRole('button', { name: 'new request' }));
    await createDataPlatform();
    fireEvent.click(await screen.findByRole('button', { name: 'common:buttons.cancel' }));
    await waitFor(() => expect(location()).toBe('/start'));
    expect(mocked.get).toHaveBeenCalledWith('/portfolio/requests/req-new/creation', { params: { token: 'token-1' } });
    expect(mocked.delete).toHaveBeenCalledWith('/portfolio/requests/req-new/creation', { data: { token: 'token-1' } });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('asks before cancelling a creation that holds more than its title', async () => {
    renderPage(['/portfolio/requests/new/summary'], { changes: { fields: 0, children: { document: 1, attachment: 2 } } });
    await createDataPlatform();
    fireEvent.click(await screen.findByRole('button', { name: 'common:buttons.cancel' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/common:creation\.confirmMessage/).textContent).toContain(
      'changes=common:creation.changes.documents(count=1), common:creation.changes.attachments(count=2)',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'common:buttons.delete' }));
    // No previous address in this tab: the list.
    await waitFor(() => expect(location()).toBe('/portfolio/requests'));
    expect(mocked.delete).toHaveBeenCalledWith('/portfolio/requests/req-new/creation', { data: { token: 'token-1' } });
  });

  it('leaves an empty new request on Escape, to the previous address', async () => {
    renderPage(['/start']);
    fireEvent.click(await screen.findByRole('button', { name: 'new request' }));
    const input = await screen.findByRole('textbox', { name: TITLE });
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(location()).toBe('/start'));
    expect(mocked.post).not.toHaveBeenCalled();
  });
  it('shows no Delete beside Cancel while the request is being created, and Delete once it is left', async () => {
    auth.admin = true;
    renderPage(['/start']);
    fireEvent.click(await screen.findByRole('button', { name: 'new request' }));
    await createDataPlatform();
    expect(await screen.findByRole('button', { name: 'common:buttons.cancel' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'common:buttons.delete' })).toBeNull();
    cleanup();
    renderPage(['/portfolio/requests/REQ-9/summary']);
    expect(await screen.findByRole('button', { name: 'common:buttons.delete' })).toBeTruthy();
  });

  it('shows the error under the empty title on Create and gives it the focus, nothing created', async () => {
    renderPage(['/start']);
    fireEvent.click(await screen.findByRole('button', { name: 'new request' }));
    const input = await screen.findByRole('textbox', { name: TITLE });
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    expect(await screen.findByText('common:creation.titleRequired')).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('textbox', { name: TITLE })).toHaveFocus());
    expect(input).toBeTruthy();
    expect(mocked.post).not.toHaveBeenCalled();
    expect(location()).not.toBe('/start');
  });

  it('keeps the record being created and closes it on Create, back where the creation started', async () => {
    renderPage(['/start']);
    fireEvent.click(await screen.findByRole('button', { name: 'new request' }));
    await createDataPlatform();
    expect(screen.queryByRole('button', { name: 'common:buttons.close' })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'common:buttons.create' }));
    await waitFor(() => expect(location()).toBe('/start'));
    expect(mocked.delete).not.toHaveBeenCalled();
    expect(mocked.post).toHaveBeenCalledTimes(1);
  });
});
