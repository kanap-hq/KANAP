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
import { incidentsApi, type Incident } from '../../api/endpoints/incidents';
import IncidentWorkspacePage from './IncidentWorkspacePage';

// Creation at the title (lot 1b): the title committed in the header creates the incident with
// severity "minor", the page moves to it with every tab open, and "Cancel creation" deletes it
// while the person stays. "Cancel incident" stays hidden beside it.

const translation = {
  t: (key: string, opts?: Record<string, unknown>) => {
    const args = opts ? Object.entries(opts).filter(([k]) => k !== 'defaultValue').map(([k, v]) => `${k}=${v}`).join(',') : '';
    return args ? `${key}(${args})` : key;
  },
  i18n: { language: 'en', resolvedLanguage: 'en' },
};
vi.mock('react-i18next', () => ({ useTranslation: () => translation, initReactI18next: { type: '3rdParty', init: () => undefined } }));
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('../../api/endpoints/incidents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/endpoints/incidents')>();
  return {
    ...actual,
    incidentsApi: { get: vi.fn(), create: vi.fn(), update: vi.fn(), cancel: vi.fn(), listAttachments: vi.fn(async () => []) },
  };
});
const authLevel = vi.hoisted(() => ({ incidents: 'contributor' }));
const RANK: Record<string, number> = { reader: 1, contributor: 2, member: 3, admin: 4 };
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    hasLevel: (resource: string, level: string) => resource !== 'incidents' || RANK[authLevel.incidents] >= RANK[level],
    profile: { id: 'user-1' },
  }),
}));
vi.mock('../../tenant/TenantContext', () => ({ useTenant: () => ({ tenantSlug: 'acme' }) }));
vi.mock('../../hooks/useModuleItemNav', () => ({
  // The register has other incidents: the previous/next chip stays hidden while one is being created.
  useIncidentItemNav: () => ({ total: 13, index: 0, hasPrev: false, hasNext: true, prevId: null, nextId: 'INC-2' }),
}));
vi.mock('../../hooks/useItOpsEnumOptions', () => ({ default: () => ({ byField: {}, labelFor: (_f: string, code: string) => code }) }));
vi.mock('../workspace/hooks/useRecentlyViewed', () => ({ useRecentlyViewed: () => ({ addToRecent: () => undefined }) }));
vi.mock('../../components/fields/UserSelect', () => ({ default: () => null }));
vi.mock('../../components/IntegratedDocumentEditor', () => ({ default: () => <div data-testid="review-editor" /> }));
vi.mock('../../components/EntityKnowledgePanel', () => ({ default: () => null }));
vi.mock('../../components/history/RecordHistoryTab', () => ({ default: () => null }));
vi.mock('./workspace/IncidentMetadataBar', () => ({ default: ({ incident }: any) => <span>metadata {incident.severity}</span> }));
vi.mock('./incidents/IncidentDeleteButton', () => ({ default: () => null }));

const mocked = vi.mocked(api);
const incidents = vi.mocked(incidentsApi);
const TITLE = 'common:buttons.editTitle';

const created: Incident = {
  id: 'inc-new', item_number: 4, title: 'Mail outage', description: null, status: 'open', severity: 'minor', category: null,
  started_at: null, detected_at: '2026-11-01T08:00:00.000Z', resolved_at: null, closed_at: null, owner_user_id: null,
  owner_name: null, reporter_user_id: 'user-1', reporter_name: 'Me', confidential: false, source_ref: null,
  personal_data_affected: false, authority_notification_required: false, authority_notified_at: null, notified_parties: null,
  created_by: 'user-1', updated_by: 'user-1', created_at: '2026-11-01T08:00:00.000Z', updated_at: '2026-11-01T08:00:00.000Z',
  asset_count: 0, application_count: 0, task_count: 0,
  counts: { entries: 1, assets: 0, applications: 0, technologies: 0, tasks: 0, documents: 0, attachments: 0 },
} as Incident;

function Location() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function StartPage() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate('/it/incidents/new/overview')}>new incident</button>;
}

function renderPage(entries: string[], changes: { fields: number; children: Record<string, number> } = { fields: 0, children: {} }) {
  incidents.get.mockResolvedValue(created);
  incidents.create.mockResolvedValue({ ...created, creation_token: 'token-1' });
  mocked.get.mockImplementation(async (url: string) => {
    if (url === '/incidents/inc-new/creation') return { data: { changes } } as never;
    return { data: { items: [], total: 0 } } as never;
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
              <Route path="/it/incidents" element={<div data-testid="incident-list" />} />
              <Route path="/it/incidents/:id/:tab" element={<IncidentWorkspacePage />} />
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

async function createMailOutage() {
  const input = await screen.findByRole('textbox', { name: TITLE });
  fireEvent.change(input, { target: { value: 'Mail outage' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(location()).toBe('/it/incidents/INC-4/overview'));
}

describe('Incident creation at the title', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    authLevel.incidents = 'contributor';
    resetCreationStore();
    resetNavigationTracker();
  });

  it('opens with the title to type and the incident to come dimmed and out of reach', async () => {
    renderPage(['/it/incidents/new/overview']);
    const input = await screen.findByRole('textbox', { name: TITLE });
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute('placeholder', 'workspace.incident.newTitle');
    // Create and Cancel in place of the close button.
    expect(screen.getByRole('button', { name: 'common:buttons.create' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'common:buttons.cancel' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'common:buttons.close' })).toBeNull();
    // Tabs other than the overview wait for the incident.
    expect(screen.getByRole('tab', { name: 'workspace.incident.tabs.journal' })).toBeDisabled();

    // The metadata, the properties drawer, with severity "minor", and the description field.
    const previews = screen.getAllByTestId('creation-preview');
    expect(previews).toHaveLength(3);
    expect(previews.find((preview) => within(preview).queryByText('metadata minor'))).toBeTruthy();
    const drawer = previews.find((preview) => within(preview).queryByText('workspace.incident.drawer.severity'));
    expect(drawer).toBeTruthy();
    expect(drawer).toHaveTextContent(/minor/i);
    expect(previews.find((preview) => within(preview).queryByText('workspace.incident.overview.description'))).toBeTruthy();
    for (const preview of previews) {
      expect(preview).toHaveAttribute('inert');
      expect(preview).toHaveAttribute('aria-hidden', 'true');
      expect(within(preview).queryAllByRole('textbox')).toHaveLength(0);
      expect(within(preview).queryAllByRole('button')).toHaveLength(0);
    }
    // Nothing read or written for an incident that does not exist yet.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const urls = mocked.get.mock.calls.map(([url]) => String(url));
    expect(urls.filter((url) => /undefined|null|\/\/|\/incidents\/new\b/.test(url))).toEqual([]);
    expect(incidents.get).not.toHaveBeenCalled();
    expect(incidents.create).not.toHaveBeenCalled();
  });

  it('does nothing on Ctrl+S while the title is empty', async () => {
    renderPage(['/it/incidents/new/overview']);
    const input = await screen.findByRole('textbox', { name: TITLE });
    fireEvent.keyDown(input, { key: 's', ctrlKey: true });
    expect(incidents.create).not.toHaveBeenCalled();
    expect(location()).toBe('/it/incidents/new/overview');
  });

  it('creates the incident, severity minor, when the title is committed, then opens every tab', async () => {
    renderPage(['/it/incidents/new/overview']);
    await createMailOutage();
    expect(incidents.create).toHaveBeenCalledTimes(1);
    expect(incidents.create.mock.calls[0][0]).toMatchObject({ title: 'Mail outage', severity: 'minor', status: 'open', reporter_user_id: 'user-1' });
    expect(await screen.findByTestId('review-editor')).toBeTruthy();
    expect(screen.queryByTestId('creation-preview')).toBeNull();
    for (const tab of screen.getAllByRole('tab')) expect(tab).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'common:buttons.cancel' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'workspace.incident.next' })).toBeNull();
  });

  it('cancels a creation with only its title at once, and goes back where it started', async () => {
    renderPage(['/start']);
    fireEvent.click(await screen.findByRole('button', { name: 'new incident' }));
    await createMailOutage();
    fireEvent.click(await screen.findByRole('button', { name: 'common:buttons.cancel' }));
    await waitFor(() => expect(location()).toBe('/start'));
    expect(mocked.get).toHaveBeenCalledWith('/incidents/inc-new/creation', { params: { token: 'token-1' } });
    expect(mocked.delete).toHaveBeenCalledWith('/incidents/inc-new/creation', { data: { token: 'token-1' } });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('asks before cancelling a creation that holds more than its title', async () => {
    renderPage(['/it/incidents/new/overview'], { fields: 1, children: { journal_entry: 2 } });
    await createMailOutage();
    fireEvent.click(await screen.findByRole('button', { name: 'common:buttons.cancel' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/common:creation\.confirmMessage/).textContent).toContain(
      'changes=common:creation.changes.fields(count=1), common:creation.changes.journalEntries(count=2)',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'common:creation.keep' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mocked.delete).not.toHaveBeenCalled();
    expect(location()).toBe('/it/incidents/INC-4/overview');
  });

  it('shows a refusal of the cancel, translated, and keeps the incident', async () => {
    renderPage(['/it/incidents/new/overview']);
    mocked.delete.mockRejectedValueOnce({ response: { status: 409, data: { code: 'INCIDENT_HAS_REGULATORY_RECORDS', usages: [] } } });
    await createMailOutage();
    fireEvent.click(await screen.findByRole('button', { name: 'common:buttons.cancel' }));
    expect(await screen.findByText(/INCIDENT_HAS_REGULATORY_RECORDS/)).toBeTruthy();
    expect(location()).toBe('/it/incidents/INC-4/overview');
  });

  it('hides "Cancel incident" while "Cancel creation" shows, and brings it back once the person has left', async () => {
    authLevel.incidents = 'admin';
    renderPage(['/start']);
    fireEvent.click(await screen.findByRole('button', { name: 'new incident' }));
    await createMailOutage();
    expect(await screen.findByRole('button', { name: 'common:buttons.cancel' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'workspace.incident.actions.cancel' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'workspace.incident.backLabel' }));
    await screen.findByTestId('incident-list');
    cleanup();
    renderPage(['/it/incidents/INC-4/overview']);
    expect(await screen.findByRole('button', { name: 'workspace.incident.actions.cancel' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'common:buttons.cancel' })).toBeNull();
  });

  it('leaves an empty new incident on Escape, to the previous address', async () => {
    renderPage(['/start']);
    fireEvent.click(await screen.findByRole('button', { name: 'new incident' }));
    const input = await screen.findByRole('textbox', { name: TITLE });
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(location()).toBe('/start'));
    expect(incidents.create).not.toHaveBeenCalled();
  });
  it('shows the error under the empty title on Create and gives it the focus, nothing created', async () => {
    renderPage(['/start']);
    fireEvent.click(await screen.findByRole('button', { name: 'new incident' }));
    const input = await screen.findByRole('textbox', { name: TITLE });
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    expect(await screen.findByText('common:creation.titleRequired')).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('textbox', { name: TITLE })).toHaveFocus());
    expect(input).toBeTruthy();
    expect(incidents.create).not.toHaveBeenCalled();
    expect(location()).not.toBe('/start');
  });

  it('keeps the record being created and closes it on Create, back where the creation started', async () => {
    renderPage(['/start']);
    fireEvent.click(await screen.findByRole('button', { name: 'new incident' }));
    await createMailOutage();
    fireEvent.click(await screen.findByRole('button', { name: 'common:buttons.create' }));
    await waitFor(() => expect(location()).toBe('/start'));
    expect(mocked.delete).not.toHaveBeenCalled();
    expect(incidents.create).toHaveBeenCalledTimes(1);
  });
});
