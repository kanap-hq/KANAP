import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter, Route, Routes, useLocation, useNavigate, type InitialEntry } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../../components/design';
import NavigationTracker, { resetNavigationTracker } from '../../components/navigation/NavigationTracker';
import { resetCreationStore } from '../../components/workspace/creation/creationStore';
import api from '../../api';
import ApplicationWorkspacePage from './ApplicationWorkspacePage';

// Creation at the title (lot 1a): the name committed in the header creates the application, the
// page moves to it with every tab open, and "Cancel creation" deletes it while the person stays.

const translation = {
  t: (key: string, opts?: Record<string, unknown>) => {
    const args = opts ? Object.entries(opts).filter(([k]) => k !== 'defaultValue').map(([k, v]) => `${k}=${v}`).join(',') : '';
    return args ? `${key}(${args})` : key;
  },
  i18n: { language: 'en', resolvedLanguage: 'en' },
};
vi.mock('react-i18next', () => ({ useTranslation: () => translation, initReactI18next: { type: '3rdParty', init: () => undefined } }));
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('../../config/FeaturesContext', () => ({ useFeatures: () => ({ config: { features: { vulnerabilityFeed: false } } }) }));
vi.mock('../../hooks/useApplicationNav', () => ({ useApplicationNav: () => ({ total: 0, index: 0, hasPrev: false, hasNext: false, prevId: null, nextId: null }) }));
vi.mock('../workspace/hooks/useRecentlyViewed', () => ({ useRecentlyViewed: () => ({ addToRecent: () => undefined }) }));
vi.mock('../../components/workspace/SendLinkButton', () => ({ default: () => null }));
vi.mock('../../components/fields/SupplierSelect', () => ({ default: () => null }));
vi.mock('../../components/fields/ContactSelect', () => ({ default: () => null }));
vi.mock('../../components/fields/CompanySelect', () => ({ default: () => null }));
vi.mock('../../components/fields/DepartmentMultiSelect', () => ({ default: () => null }));
vi.mock('../../components/fields/TeamMemberMultiSelect', () => ({ default: () => null }));
vi.mock('../ForbiddenPage', () => ({ default: () => <div data-testid="forbidden" /> }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: (_resource: string, level: string) => level !== 'admin' }) }));
vi.mock('../../components/IntegratedDocumentEditor', () => ({ default: () => <div data-testid="description-editor" /> }));
vi.mock('../../components/EntityKnowledgePanel', () => ({ default: () => <div data-testid="knowledge-panel" /> }));
vi.mock('../../components/history/RecordHistoryTab', () => ({ default: () => <div data-testid="record-history" /> }));
vi.mock('../../hooks/useApplicationClassificationCatalog', () => ({
  default: () => ({ data: { businessCriticalityLevels: [], cyberCriticalityLevels: [], dataClasses: [], recoveryWaves: [] } }),
}));
vi.mock('../../hooks/useItOpsEnumOptions', () => ({
  default: () => ({ byField: { accessMethod: [], applicationCategory: [], lifecycleStatus: [{ code: 'active', label: 'Active' }] }, labelFor: (_f: string, code: string) => code }),
}));

const mocked = vi.mocked(api);
const TITLE = 'common:buttons.editTitle';
const created = { id: 'app-new', sequential_id: 'APP-7', name: 'Billing', category: 'business', lifecycle: 'active', creation_token: 'token-1' };
const detail = {
  ...created, creation_token: undefined, supplier_id: null, editor: null, criticality: null, version: null, go_live_date: null,
  owners: [], companies: [], departments: [], data_residency: [], access_methods: [], users_mode: 'it_users', support_notes: null,
  support_contacts: [], is_suite: false, deployments: [],
};

function Location() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function StartPage() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate('/it/applications/new/overview')}>new application</button>;
}

function renderPage(entries: InitialEntry[], changes: { fields: number; children: Record<string, number> } = { fields: 0, children: {} }) {
  mocked.get.mockImplementation(async (url: string) => {
    if (url === '/applications/APP-7' || url === '/applications/app-new') return { data: detail } as never;
    if (url === '/applications/app-new/creation') return { data: { changes } } as never;
    if (url === '/interfaces/by-application/app-new') return { data: { items: [] } } as never;
    return { data: { items: [], total: 0 } } as never;
  });
  mocked.post.mockImplementation(async (url: string) => {
    if (url === '/applications') return { data: created } as never;
    return { data: {} } as never;
  });
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
              <Route path="/portfolio/projects" element={<div data-testid="projects" />} />
              <Route path="/it/applications" element={<div data-testid="application-list" />} />
              <Route path="/it/applications/:id/:tab" element={<ApplicationWorkspacePage />} />
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

async function createBilling() {
  const input = await screen.findByRole('textbox', { name: TITLE });
  fireEvent.change(input, { target: { value: 'Billing' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(location()).toBe('/it/applications/APP-7/overview'));
}

describe('Application creation at the title', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    resetCreationStore();
    resetNavigationTracker();
  });

  it('opens with the title to type, light blue while empty, and nothing else to fill', async () => {
    renderPage(['/it/applications/new/overview']);
    const input = await screen.findByRole('textbox', { name: TITLE });
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute('placeholder', 'workspace.application.newTitle');
    expect(getComputedStyle(input).borderRadius).toBe('6px');
    expect(screen.queryByRole('button', { name: 'common:buttons.create' })).toBeNull();
    expect(screen.queryByText('common:creation.cancel')).toBeNull();
  });

  it('shows the application to come under the title, dimmed and out of reach, until the title creates it', async () => {
    renderPage(['/it/applications/new/overview']);
    const input = await screen.findByRole('textbox', { name: TITLE });
    // The overview and the properties panel of an empty application.
    const previews = screen.getAllByTestId('creation-preview');
    expect(previews).toHaveLength(2);
    expect(within(previews[0]).getByTestId('description-editor')).toBeTruthy();
    expect(within(previews[1]).getByText('workspace.application.overview.category')).toBeTruthy();
    for (const preview of previews) {
      expect(preview).toHaveAttribute('inert');
      expect(preview).toHaveAttribute('aria-hidden', 'true');
      expect(getComputedStyle(preview).opacity).toBe('0.45');
      expect(getComputedStyle(preview).pointerEvents).toBe('none');
      // Nothing inside is in the accessibility tree: no field or button to reach.
      expect(within(preview).queryAllByRole('button')).toHaveLength(0);
      expect(within(preview).queryAllByRole('textbox')).toHaveLength(0);
      expect(within(preview).queryAllByRole('combobox')).toHaveLength(0);
    }
    expect(input).toHaveFocus();
    // Nothing read or written for a record that does not exist yet.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const urls = mocked.get.mock.calls.map(([url]) => String(url));
    expect(urls.filter((url) => /undefined|null|\/\/|^\/applications\/(new\b|$)/.test(url))).toEqual([]);
    expect(mocked.post).not.toHaveBeenCalled();
    expect(mocked.patch).not.toHaveBeenCalled();

    await createBilling();
    expect(screen.queryByTestId('creation-preview')).toBeNull();
    expect(await screen.findByTestId('description-editor')).toBeTruthy();
    expect(screen.getByRole('button', { name: TITLE })).toHaveTextContent('Billing');
  });

  it('creates the application when the title is committed, then opens every tab with the focus on the title', async () => {
    renderPage(['/it/applications/new/overview']);
    await createBilling();
    expect(mocked.post).toHaveBeenCalledTimes(1);
    expect(mocked.post).toHaveBeenCalledWith('/applications', { name: 'Billing' });
    const title = await screen.findByRole('button', { name: TITLE });
    expect(title).toHaveTextContent('Billing');
    await waitFor(() => expect(title).toHaveFocus());
    for (const tab of screen.getAllByRole('tab')) expect(tab).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'common:creation.cancel' })).toBeTruthy();
  });

  it('shows a refused name under the title and keeps the field open, nothing created', async () => {
    renderPage(['/it/applications/new/overview']);
    mocked.post.mockRejectedValueOnce({ response: { status: 409, data: { message: 'An application named Billing already exists.' } } });
    const input = await screen.findByRole('textbox', { name: TITLE });
    fireEvent.change(input, { target: { value: 'Billing' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByText('An application named Billing already exists.')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: TITLE })).toHaveValue('Billing');
    expect(location()).toBe('/it/applications/new/overview');
    // Typing answers the refusal; the next commit tries again.
    fireEvent.change(screen.getByRole('textbox', { name: TITLE }), { target: { value: 'Billing 2' } });
    expect(screen.queryByText('An application named Billing already exists.')).toBeNull();
  });

  it('cancels a creation with only its title at once, and goes back where it started', async () => {
    renderPage(['/start']);
    fireEvent.click(await screen.findByRole('button', { name: 'new application' }));
    await createBilling();
    fireEvent.click(await screen.findByRole('button', { name: 'common:creation.cancel' }));
    await waitFor(() => expect(location()).toBe('/start'));
    expect(mocked.get).toHaveBeenCalledWith('/applications/app-new/creation', { params: { token: 'token-1' } });
    expect(mocked.delete).toHaveBeenCalledWith('/applications/app-new/creation', { data: { token: 'token-1' } });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('asks before cancelling a creation that holds more than its title, and keeps it on Keep', async () => {
    renderPage(['/it/applications/new/overview?sort=name%3AASC'], { fields: 2, children: { owner: 1 } });
    await waitFor(() => expect(screen.getByRole('textbox', { name: TITLE })).toBeTruthy());
    const input = screen.getByRole('textbox', { name: TITLE });
    fireEvent.change(input, { target: { value: 'Billing' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(location()).toBe('/it/applications/APP-7/overview?sort=name%3AASC'));

    fireEvent.click(await screen.findByRole('button', { name: 'common:creation.cancel' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/common:creation\.confirmMessage/).textContent).toContain(
      'changes=common:creation.changes.fields(count=2), common:creation.changes.relations(count=1)',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'common:creation.keep' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mocked.delete).not.toHaveBeenCalled();
    expect(location()).toBe('/it/applications/APP-7/overview?sort=name%3AASC');

    fireEvent.click(screen.getByRole('button', { name: 'common:creation.cancel' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'common:buttons.delete' }));
    // No previous address in this tab: the list, with its context.
    await waitFor(() => expect(location()).toBe('/it/applications?sort=name%3AASC'));
    expect(mocked.delete).toHaveBeenCalledWith('/applications/app-new/creation', { data: { token: 'token-1' } });
  });

  it('leaves an empty new application on Escape, to the address the link gave', async () => {
    renderPage([{ pathname: '/it/applications/new/overview', state: { returnTo: '/portfolio/projects' } }]);
    const input = await screen.findByRole('textbox', { name: TITLE });
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(location()).toBe('/portfolio/projects'));
    expect(mocked.post).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('leaves an empty new application by the back arrow, to the previous address', async () => {
    renderPage(['/start']);
    fireEvent.click(await screen.findByRole('button', { name: 'new application' }));
    await screen.findByRole('textbox', { name: TITLE });
    fireEvent.click(screen.getByRole('button', { name: 'pages.applications.title' }));
    await waitFor(() => expect(location()).toBe('/start'));
    expect(mocked.post).not.toHaveBeenCalled();
  });

  it('drops Cancel creation once the person has left the record', async () => {
    renderPage(['/start']);
    fireEvent.click(await screen.findByRole('button', { name: 'new application' }));
    await createBilling();
    expect(screen.getByRole('button', { name: 'common:creation.cancel' })).toBeTruthy();
    // To the list, then back to the record: the creation is over.
    fireEvent.click(screen.getByRole('button', { name: 'pages.applications.title' }));
    await screen.findByTestId('application-list');
    cleanup();
    renderPage(['/it/applications/APP-7/overview']);
    await screen.findByRole('button', { name: TITLE });
    expect(screen.queryByRole('button', { name: 'common:creation.cancel' })).toBeNull();
  });
});
