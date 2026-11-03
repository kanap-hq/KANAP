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
import BusinessProcessWorkspacePage from './BusinessProcessWorkspacePage';

// The business process page on the record shell (lot V7): fields saved one by one, and the
// creation at the title (the name committed in the header creates the process, Create keeps it,
// Cancel deletes it while the person stays).

const translation = {
  t: (key: string, opts?: Record<string, unknown>) => {
    const args = opts ? Object.entries(opts).filter(([k]) => k !== 'defaultValue').map(([k, v]) => `${k}=${v}`).join(',') : '';
    return args ? `${key}(${args})` : key;
  },
  i18n: { language: 'en', resolvedLanguage: 'en' },
};
vi.mock('react-i18next', () => ({ useTranslation: () => translation, initReactI18next: { type: '3rdParty', init: () => undefined } }));
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('../../hooks/useBusinessProcessNav', () => ({
  useBusinessProcessNav: () => ({ total: 0, index: 0, hasPrev: false, hasNext: false, prevId: null, nextId: null }),
}));
const auth = vi.hoisted(() => ({ level: 'member' as 'reader' | 'member' | 'admin', applications: true }));
const RANK = { reader: 1, contributor: 2, member: 3, manager: 3, admin: 4 } as const;
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    hasLevel: (resource: string, level: keyof typeof RANK) => (
      resource === 'applications' ? auth.applications : RANK[auth.level] >= RANK[level]
    ),
  }),
}));
// The pickers load their own lists: a button stands for each, and picks a value.
vi.mock('../../components/fields/UserSelect', () => ({
  default: ({ label, onChange, disabled }: { label: string; onChange: (id: string | null) => void; disabled?: boolean }) => (
    <button type="button" disabled={disabled} onClick={() => onChange('user-2')}>{`pick ${label}`}</button>
  ),
}));
vi.mock('../../components/fields/BusinessProcessCategoryMultiSelect', () => ({
  default: ({ onChange, disabled }: { onChange: (ids: string[]) => void; disabled?: boolean }) => (
    <button type="button" disabled={disabled} onClick={() => onChange(['cat-1'])}>pick categories</button>
  ),
}));
vi.mock('./BusinessProcessApplicationsSection', () => ({ default: () => <div data-testid="applications-section" /> }));
vi.mock('./BusinessProcessCategoryManagerDialog', () => ({ default: () => null }));
vi.mock('../../components/history/RecordHistoryTab', () => ({ default: () => <div data-testid="record-history" /> }));

const mocked = vi.mocked(api);
const TITLE = 'common:buttons.editTitle';
const PROCESS = {
  id: 'bp-1', name: 'Order-to-Cash', description: null, notes: null, status: 'enabled', disabled_at: null,
  owner_user_id: null, it_owner_user_id: null, categories: [],
};
const CREATED = { ...PROCESS, id: 'bp-new', name: 'Procure-to-Pay', creation_token: 'token-1' };

function Location() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function StartPage() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate('/master-data/business-processes/new/overview')}>new process</button>;
}

function renderPage(entries: InitialEntry[], changes: { fields: number; children: Record<string, number> } = { fields: 0, children: {} }) {
  mocked.get.mockImplementation(async (url: string) => {
    if (url === '/business-processes/bp-1') return { data: PROCESS } as never;
    if (url === '/business-processes/bp-new') return { data: { ...CREATED, creation_token: undefined } } as never;
    if (url === '/business-processes/bp-new/creation') return { data: { changes } } as never;
    return { data: { items: [], total: 0 } } as never;
  });
  mocked.post.mockImplementation(async (url: string) => {
    if (url === '/business-processes') return { data: CREATED } as never;
    return { data: {} } as never;
  });
  mocked.patch.mockImplementation(async (url: string, body?: unknown) => (
    { data: { ...(url.endsWith('/bp-new') ? CREATED : PROCESS), creation_token: undefined, ...(body as object) } }
  ) as never);
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
              <Route path="/master-data/business-processes" element={<div data-testid="process-list" />} />
              <Route path="/master-data/business-processes/:id/:tab" element={<BusinessProcessWorkspacePage />} />
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

/** The record page, once the process has loaded. */
async function openRecord() {
  await screen.findByText('Order-to-Cash');
}

async function createProcess() {
  const input = await screen.findByRole('textbox', { name: TITLE });
  fireEvent.change(input, { target: { value: 'Procure-to-Pay' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(location()).toBe('/master-data/business-processes/bp-new/overview'));
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  resetCreationStore();
  resetNavigationTracker();
  auth.level = 'member';
  auth.applications = true;
});

describe('Business process record', () => {
  it('shows the name in the header, the tabs and no Save, and saves the description when it is left', async () => {
    renderPage(['/master-data/business-processes/bp-1/overview']);
    await openRecord();
    expect(screen.getByRole('button', { name: TITLE })).toHaveTextContent('Order-to-Cash');
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'shared.labels.overview', 'businessProcesses.tabs.relations', 'shared.labels.history',
    ]);
    expect(screen.queryByRole('button', { name: 'common:buttons.save' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'shared.fields.name' })).toBeNull();

    const description = screen.getByRole('textbox', { name: 'shared.fields.description' });
    fireEvent.focus(description);
    fireEvent.change(description, { target: { value: '  From order to cash.  ' } });
    fireEvent.blur(description);
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/business-processes/bp-1', { description: 'From order to cash.' }));
    // Left unchanged: nothing sent.
    fireEvent.focus(screen.getByRole('textbox', { name: 'shared.fields.notes' }));
    fireEvent.blur(screen.getByRole('textbox', { name: 'shared.fields.notes' }));
    expect(mocked.patch).toHaveBeenCalledTimes(1);
  });

  it('saves the owners and the categories as they are picked, and the status alone from the header', async () => {
    renderPage(['/master-data/business-processes/bp-1/overview']);
    await openRecord();
    fireEvent.click(screen.getByRole('button', { name: 'pick businessProcesses.fields.processOwner' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/business-processes/bp-1', { owner_user_id: 'user-2' }));
    fireEvent.click(screen.getByRole('button', { name: 'pick businessProcesses.fields.itOwner' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/business-processes/bp-1', { it_owner_user_id: 'user-2' }));
    fireEvent.click(screen.getByRole('button', { name: 'pick categories' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/business-processes/bp-1', { category_ids: ['cat-1'] }));

    // Disabling sends the status alone: the server sets the end of validity from its own clock.
    fireEvent.click(screen.getByRole('button', { name: 'common:statuses.enabled' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'common:statuses.disabled' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/business-processes/bp-1', { status: 'disabled' }));
  });

  it('shows a name another process has under the title', async () => {
    renderPage(['/master-data/business-processes/bp-1/overview']);
    await openRecord();
    fireEvent.click(screen.getByRole('button', { name: TITLE }));
    mocked.patch.mockRejectedValueOnce({ response: { status: 409, data: { code: 'duplicate', message: 'Another business process already has this name.' } } });
    const input = screen.getByRole('textbox', { name: TITLE });
    fireEvent.change(input, { target: { value: 'Procure-to-Pay' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/business-processes/bp-1', { name: 'Procure-to-Pay' }));
    expect(await screen.findByText('businessProcesses.fields.nameTaken')).toBeTruthy();
  });

  it('opens read only for a reader: no field to change, no delete', async () => {
    auth.level = 'reader';
    renderPage(['/master-data/business-processes/bp-1/overview']);
    await openRecord();
    expect(screen.getByText('common:labels.readOnly')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'shared.fields.description' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'pick businessProcesses.fields.processOwner' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'common:buttons.delete' })).toBeNull();
  });

  it('offers delete to an admin only', async () => {
    renderPage(['/master-data/business-processes/bp-1/overview']);
    await openRecord();
    expect(screen.queryByRole('button', { name: 'common:buttons.delete' })).toBeNull();
    cleanup();
    auth.level = 'admin';
    renderPage(['/master-data/business-processes/bp-1/overview']);
    await openRecord();
    expect(screen.getByRole('button', { name: 'common:buttons.delete' })).toBeTruthy();
  });

  it('holds the applications in the Relations tab, absent for who cannot read applications', async () => {
    renderPage(['/master-data/business-processes/bp-1/relations']);
    expect(await screen.findByTestId('applications-section')).toBeTruthy();
    cleanup();
    auth.applications = false;
    renderPage(['/master-data/business-processes/bp-1/relations']);
    await openRecord();
    expect(screen.queryByRole('tab', { name: 'businessProcesses.tabs.relations' })).toBeNull();
    expect(screen.queryByTestId('applications-section')).toBeNull();
  });
});

describe('Business process creation at the title', () => {
  it('opens with the title to type and the process to come dimmed and out of reach', async () => {
    renderPage(['/master-data/business-processes/new/overview']);
    const input = await screen.findByRole('textbox', { name: TITLE });
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute('placeholder', 'businessProcesses.newBusinessProcess');
    expect(screen.getByRole('button', { name: 'common:buttons.create' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'common:buttons.cancel' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'common:buttons.close' })).toBeNull();
    // The metadata, the overview and the properties panel of an empty process.
    const previews = screen.getAllByTestId('creation-preview');
    expect(previews).toHaveLength(3);
    for (const preview of previews) {
      expect(preview).toHaveAttribute('inert');
      expect(within(preview).queryAllByRole('button')).toHaveLength(0);
      expect(within(preview).queryAllByRole('textbox')).toHaveLength(0);
    }
    for (const tab of screen.getAllByRole('tab').slice(1)) expect(tab).toBeDisabled();
    // Nothing read or written for a process that does not exist yet.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const urls = mocked.get.mock.calls.map(([url]) => String(url));
    expect(urls.filter((url) => /undefined|null|\/\/|^\/business-processes\/new\b/.test(url))).toEqual([]);
    expect(mocked.post).not.toHaveBeenCalled();
  });

  it('creates the process when the title is committed, then opens every tab', async () => {
    renderPage(['/master-data/business-processes/new/overview']);
    await createProcess();
    expect(mocked.post).toHaveBeenCalledTimes(1);
    expect(mocked.post).toHaveBeenCalledWith('/business-processes', { name: 'Procure-to-Pay' });
    expect(await screen.findByRole('button', { name: TITLE })).toHaveTextContent('Procure-to-Pay');
    expect(screen.queryByTestId('creation-preview')).toBeNull();
    for (const tab of screen.getAllByRole('tab')) expect(tab).not.toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'shared.fields.description' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'common:buttons.cancel' })).toBeTruthy();
  });

  it('shows a name another process has under the title and creates nothing', async () => {
    renderPage(['/master-data/business-processes/new/overview']);
    mocked.post.mockRejectedValueOnce({ response: { status: 409, data: { code: 'duplicate', message: 'Another business process already has this name.' } } });
    const input = await screen.findByRole('textbox', { name: TITLE });
    fireEvent.change(input, { target: { value: 'Order-to-Cash' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByText('businessProcesses.fields.nameTaken')).toBeTruthy();
    expect(location()).toBe('/master-data/business-processes/new/overview');
  });

  it('shows the error under the empty title on Create, nothing created', async () => {
    renderPage(['/master-data/business-processes/new/overview']);
    await screen.findByRole('textbox', { name: TITLE });
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    expect(await screen.findByText('businessProcesses.fields.nameRequired')).toBeTruthy();
    expect(mocked.post).not.toHaveBeenCalled();
  });

  it('cancels a creation with only its title at once, back where it started', async () => {
    renderPage(['/start']);
    fireEvent.click(await screen.findByRole('button', { name: 'new process' }));
    await createProcess();
    fireEvent.click(await screen.findByRole('button', { name: 'common:buttons.cancel' }));
    await waitFor(() => expect(location()).toBe('/start'));
    expect(mocked.get).toHaveBeenCalledWith('/business-processes/bp-new/creation', { params: { token: 'token-1' } });
    expect(mocked.delete).toHaveBeenCalledWith('/business-processes/bp-new/creation', { data: { token: 'token-1' } });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('asks before cancelling a creation that holds more than its title', async () => {
    renderPage(['/start'], { fields: 1, children: { application: 2 } });
    fireEvent.click(await screen.findByRole('button', { name: 'new process' }));
    await createProcess();
    fireEvent.click(await screen.findByRole('button', { name: 'common:buttons.cancel' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/common:creation\.confirmMessage/).textContent).toContain(
      'changes=common:creation.changes.fields(count=1), common:creation.changes.relations(count=2)',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'common:buttons.delete' }));
    await waitFor(() => expect(location()).toBe('/start'));
    expect(mocked.delete).toHaveBeenCalledWith('/business-processes/bp-new/creation', { data: { token: 'token-1' } });
  });

  it('keeps the process being created and closes it on Create, after the field being typed is saved', async () => {
    renderPage(['/start']);
    fireEvent.click(await screen.findByRole('button', { name: 'new process' }));
    await createProcess();
    const description = await screen.findByRole('textbox', { name: 'shared.fields.description' });
    fireEvent.focus(description);
    fireEvent.change(description, { target: { value: 'From need to payment.' } });
    fireEvent.blur(description);
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    await waitFor(() => expect(location()).toBe('/start'));
    expect(mocked.patch).toHaveBeenCalledWith('/business-processes/bp-new', { description: 'From need to payment.' });
    expect(mocked.delete).not.toHaveBeenCalled();
  });

  it('leaves an empty new process on Escape, nothing created', async () => {
    renderPage([{ pathname: '/master-data/business-processes/new/overview', state: { returnTo: '/start' } }]);
    const input = await screen.findByRole('textbox', { name: TITLE });
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(location()).toBe('/start'));
    expect(mocked.post).not.toHaveBeenCalled();
  });
});
