import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api';
import { incidentsApi, type Incident } from '../../api/endpoints/incidents';
import { createAppTheme } from '../../config/ThemeContext';
import IncidentWorkspacePage from './IncidentWorkspacePage';

const navigateMock = vi.hoisted(() => vi.fn());
const dialogsMock = vi.hoisted(() => ({
  confirm: vi.fn(async () => true),
  prompt: vi.fn(async () => 'human error'),
  alert: vi.fn(async () => undefined),
}));

vi.mock('../../api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../api/endpoints/incidents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/endpoints/incidents')>();
  return {
    ...actual,
    incidentsApi: {
      get: vi.fn(),
      update: vi.fn(),
      cancel: vi.fn(),
      reopen: vi.fn(),
      setConfidentiality: vi.fn(),
      exportReport: vi.fn(),
    },
  };
});

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigateMock,
}));

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: () => true, profile: { id: 'user-1' } }),
}));

vi.mock('../../tenant/TenantContext', () => ({
  useTenant: () => ({ tenantSlug: 'acme' }),
}));

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));

vi.mock('../../components/design', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../components/design')>()),
  useKanapDialogs: () => dialogsMock,
}));

vi.mock('../../hooks/useModuleItemNav', () => ({
  useIncidentItemNav: () => ({
    total: 2,
    index: 0,
    hasPrev: false,
    hasNext: true,
    prevId: null,
    nextId: 'INC-2',
  }),
}));

vi.mock('../../utils/downloadBlob', () => ({
  downloadBlob: vi.fn(),
  extractFilenameFromDisposition: () => null,
}));

vi.mock('../../components/MarkdownEditor', () => ({
  default: ({ value, onChange }: any) => (
    <textarea aria-label="markdown-editor" value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}));

vi.mock('../../components/MarkdownContent', () => ({
  MarkdownContent: ({ content }: { content: string }) => <div>{content}</div>,
}));

vi.mock('../../components/ExportButton', () => ({ default: () => null }));
vi.mock('../../components/ImportButton', () => ({ default: () => null }));
vi.mock('../../components/EntityKnowledgePanel', () => ({ default: () => null }));
vi.mock('./workspace/IncidentMetadataBar', () => ({ default: () => null }));
vi.mock('./workspace/IncidentPropertiesDrawer', () => ({ default: () => null }));
vi.mock('./workspace/IncidentRelationsTab', () => ({ default: () => null }));
vi.mock('./workspace/IncidentAttachmentsTab', () => ({ default: () => null }));
vi.mock('./workspace/IncidentJournalTab', () => ({
  default: () => null,
  incidentEntriesQueryKey: (id: string) => ['incident-entries', id],
}));

vi.mock('../portfolio/workspace/PortfolioDetailWorkspaceShell', () => ({
  default: ({ children, actions, onBack, onTabChange, onSaveShortcut, nav }: any) => (
    <div>
      <button type="button" onClick={() => onBack?.()}>shell-back</button>
      <button type="button" onClick={() => onTabChange?.('journal')}>shell-tab-journal</button>
      <button type="button" onClick={() => onSaveShortcut?.()}>shell-save-shortcut</button>
      <button type="button" onClick={() => nav?.onNext?.()}>shell-next</button>
      <div>{actions}</div>
      <div>{children}</div>
    </div>
  ),
}));

const theme = createAppTheme('light');

const incident: Incident = {
  id: 'inc-1',
  item_number: 1,
  title: 'Router down',
  description: 'Short summary',
  status: 'open',
  severity: 'major',
  category: null,
  started_at: null,
  detected_at: '2026-09-01T08:00:00.000Z',
  resolved_at: null,
  closed_at: null,
  owner_user_id: 'user-1',
  owner_name: 'Owner',
  reporter_user_id: 'user-1',
  reporter_name: 'Reporter',
  confidential: false,
  source_ref: null,
  personal_data_affected: false,
  authority_notification_required: false,
  authority_notified_at: null,
  notified_parties: null,
  created_by: 'user-1',
  updated_by: 'user-1',
  created_at: '2026-09-01T08:00:00.000Z',
  updated_at: '2026-09-01T08:00:00.000Z',
  asset_count: 0,
  application_count: 0,
  task_count: 0,
  counts: { entries: 0, assets: 0, applications: 0, tasks: 0, documents: 0, attachments: 0 },
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <ThemeProvider theme={theme}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/it/incidents/INC-1/overview']}>
          <Routes>
            <Route path="/it/incidents/:id/:tab" element={<IncidentWorkspacePage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
  return Object.assign(view, { queryClient });
}

/** Types into the review document: opens the editor (auto edit mode) and edits it. */
async function typeInReview(text: string) {
  fireEvent.click(await screen.findByLabelText('workspace.incident.overview.review'));
  const editor = await screen.findByLabelText('markdown-editor');
  fireEvent.change(editor, { target: { value: text } });
  return editor;
}

describe('IncidentWorkspacePage — review draft is flushed before every transition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(incidentsApi.get).mockResolvedValue(incident);
    vi.mocked(incidentsApi.update).mockResolvedValue(incident);
    vi.mocked(incidentsApi.cancel).mockResolvedValue({ ...incident, status: 'cancelled' });
    vi.mocked(incidentsApi.exportReport).mockResolvedValue({ blob: new Blob(['x']), filename: 'report.pdf' });
    vi.mocked(api.get).mockResolvedValue({
      data: {
        id: 'doc-1',
        item_number: 12,
        item_ref: 'DOC-12',
        content_markdown: '## Description',
        revision: 1,
        edit_lock: null,
      },
    } as any);
    vi.mocked(api.post).mockResolvedValue({ data: { lock_token: 'lock-1', expires_at: null } } as any);
    vi.mocked(api.patch).mockImplementation(async (_url: string, body: any) => ({
      data: {
        id: 'doc-1',
        item_number: 12,
        item_ref: 'DOC-12',
        content_markdown: String(body?.content_markdown ?? ''),
        revision: 2,
        edit_lock: null,
      },
    }) as any);
  });

  it('saves the review before leaving the workspace', async () => {
    renderPage();
    await typeInReview('Root cause: power loss');

    fireEvent.click(screen.getByText('shell-back'));

    await waitFor(() => expect(navigateMock).toHaveBeenCalled());
    expect(api.patch).toHaveBeenCalledWith(
      '/incidents/inc-1/integrated-documents/review',
      expect.objectContaining({ content_markdown: 'Root cause: power loss' }),
      expect.anything(),
    );
  });

  it('aborts the transition and keeps the draft when the review save fails and the user stays', async () => {
    renderPage();
    const editor = await typeInReview('Root cause: power loss');
    vi.mocked(api.patch).mockRejectedValue(new Error('offline'));
    // "Stay on the page and try again".
    dialogsMock.confirm.mockResolvedValueOnce(false);

    fireEvent.click(screen.getByText('shell-back'));

    await screen.findByText('workspace.incident.messages.reviewSaveFailed');
    await waitFor(() => expect(dialogsMock.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'workspace.incident.dialogs.discardReviewTitle' }),
    ));
    expect(navigateMock).not.toHaveBeenCalled();
    expect((editor as HTMLTextAreaElement).value).toBe('Root cause: power loss');
  });

  it('offers to discard an unsavable review instead of trapping the user on the incident', async () => {
    renderPage();
    await typeInReview('Root cause: power loss');
    // A terminal failure: the incident was closed elsewhere, retrying never helps.
    vi.mocked(api.patch).mockRejectedValue(new Error('offline'));
    dialogsMock.confirm.mockResolvedValueOnce(true);

    fireEvent.click(screen.getByText('shell-back'));

    await waitFor(() => expect(navigateMock).toHaveBeenCalled());
    // The draft was dropped and the stored body reloaded.
    await waitFor(() => expect(
      (screen.queryByLabelText('markdown-editor') as HTMLTextAreaElement | null)?.value
        ?? (screen.getByText('## Description').textContent),
    ).toContain('## Description'));
    expect(screen.queryByText('workspace.incident.messages.reviewSaveFailed')).toBeNull();
  });

  it('saves the review before a tab change and before prev/next navigation', async () => {
    renderPage();
    await typeInReview('First note');

    fireEvent.click(screen.getByText('shell-tab-journal'));
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    expect(navigateMock).toHaveBeenCalledWith(expect.stringContaining('/journal'));

    fireEvent.change(screen.getByLabelText('markdown-editor'), { target: { value: 'Second note' } });
    fireEvent.click(screen.getByText('shell-next'));
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(2));
    expect(navigateMock).toHaveBeenLastCalledWith(expect.stringContaining('/it/incidents/INC-2/'));
  });

  it('saves the review before cancelling the incident', async () => {
    renderPage();
    await typeInReview('Cancelled by mistake');

    fireEvent.click(screen.getByText('workspace.incident.actions.cancel'));

    await waitFor(() => expect(incidentsApi.cancel).toHaveBeenCalled());
    const saveOrder = vi.mocked(api.patch).mock.invocationCallOrder[0];
    const cancelOrder = vi.mocked(incidentsApi.cancel).mock.invocationCallOrder[0];
    expect(saveOrder).toBeLessThan(cancelOrder);
  });

  it('saves the review before exporting the PDF report', async () => {
    renderPage();
    await typeInReview('Exported content');

    fireEvent.click(screen.getByText('workspace.incident.actions.exportPdf'));

    await waitFor(() => expect(incidentsApi.exportReport).toHaveBeenCalled());
    const saveOrder = vi.mocked(api.patch).mock.invocationCallOrder[0];
    const exportOrder = vi.mocked(incidentsApi.exportReport).mock.invocationCallOrder[0];
    expect(saveOrder).toBeLessThan(exportOrder);
  });

  it('saves the review before a status change freezes it', async () => {
    renderPage();
    await typeInReview('Resolved after reboot');

    fireEvent.click(screen.getByText('enums.incidentStatus.open'));
    fireEvent.click(await screen.findByText('enums.incidentStatus.resolved'));

    await waitFor(() => expect(incidentsApi.update).toHaveBeenCalledWith('inc-1', { status: 'resolved' }));
    const saveOrder = vi.mocked(api.patch).mock.invocationCallOrder[0];
    const statusOrder = vi.mocked(incidentsApi.update).mock.invocationCallOrder[0];
    expect(saveOrder).toBeLessThan(statusOrder);
  });

  it('rolls a failed transition back to the flushed state, not to the stale render', async () => {
    const { queryClient } = renderPage();
    await screen.findByLabelText('workspace.incident.overview.review');

    // A debounced property edit that the transition will flush first.
    const description = screen.getByPlaceholderText('workspace.incident.overview.descriptionPlaceholder');
    fireEvent.change(description, { target: { value: 'Router down details' } });

    const flushed = { ...incident, description: 'Router down details', updated_at: '2026-09-02T00:00:00.000Z' };
    vi.mocked(incidentsApi.update)
      .mockResolvedValueOnce(flushed)
      .mockRejectedValueOnce(new Error('conflict'));

    fireEvent.click(screen.getByText('enums.incidentStatus.open'));
    fireEvent.click(await screen.findByText('enums.incidentStatus.resolved'));

    // The description flush, then the refused status change.
    await waitFor(() => expect(incidentsApi.update).toHaveBeenCalledTimes(2));
    expect(vi.mocked(incidentsApi.update).mock.calls[0][1]).toMatchObject({ description: 'Router down details' });
    expect(vi.mocked(incidentsApi.update).mock.calls[1][1]).toEqual({ status: 'resolved' });

    // The rollback snapshot has to be the post-flush row: rolling back to the
    // render-time copy would silently undo the description the flush persisted.
    await waitFor(() => expect(
      queryClient.getQueryData<Incident>(['incident', 'INC-1'])?.status,
    ).toBe('open'));
    const cached = queryClient.getQueryData<Incident>(['incident', 'INC-1']);
    expect(cached?.description).toBe('Router down details');
    // `updated_at` only ever comes back from the server, so it is the field that
    // proves the snapshot was read after the flush and not from the render.
    expect(cached?.updated_at).toBe('2026-09-02T00:00:00.000Z');
  });

  it('flushes the review with the save shortcut', async () => {
    renderPage();
    await typeInReview('Saved with ctrl+s');

    fireEvent.click(screen.getByText('shell-save-shortcut'));
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
  });
});

/** An API error as axios rejects it. */
function apiError(status: number, code: string) {
  return Object.assign(new Error(`HTTP ${status}`), { response: { status, data: { code, message: code }, headers: {} } });
}

describe('IncidentWorkspacePage — description autosave across incidents', () => {
  const second: Incident = { ...incident, id: 'inc-2', item_number: 2, title: 'Mail down', description: 'Second summary' };
  let busy = true;

  beforeEach(() => {
    vi.clearAllMocks();
    busy = true;
    vi.mocked(incidentsApi.get).mockImplementation(async (routeId: string) => ({ ...(routeId === 'INC-2' ? second : incident) }));
    vi.mocked(incidentsApi.update).mockImplementation(async (id: string, patch: any) => {
      if (busy) throw apiError(503, 'busy');
      return { ...(id === 'inc-2' ? second : incident), ...patch, updated_at: '2026-09-03T00:00:00.000Z' };
    });
    vi.mocked(api.get).mockResolvedValue({
      data: { id: 'doc-1', item_number: 12, item_ref: 'DOC-12', content_markdown: '## Description', revision: 1, edit_lock: null },
    } as any);
    vi.mocked(api.post).mockResolvedValue({ data: { lock_token: 'lock-1', expires_at: null } } as any);
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** The page, and the router's own navigate (the page's is mocked): the route changes, the page instance stays. */
  async function renderIncidents() {
    const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
    const router: { navigate: ((to: string) => void) | null } = { navigate: null };
    function NavigateProbe() {
      router.navigate = actual.useNavigate();
      return null;
    }
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <ThemeProvider theme={theme}>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/it/incidents/INC-1/overview']}>
            <NavigateProbe />
            <Routes>
              <Route path="/it/incidents/:id/:tab" element={<IncidentWorkspacePage />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </ThemeProvider>,
    );
    return { navigate: (to: string) => router.navigate!(to), queryClient };
  }

  it('after "leave without saving", the dropped text never reaches another incident, and the stored one is back', async () => {
    const { navigate } = await renderIncidents();
    const field = await screen.findByDisplayValue('Short summary');
    fireEvent.change(field, { target: { value: 'text for INC-1' } });
    await waitFor(() => expect(incidentsApi.update).toHaveBeenCalledTimes(1), { timeout: 3000 });
    // Retried three times, then kept and shown as not saved yet.
    await act(async () => { await vi.advanceTimersByTimeAsync(8_000); });
    expect(incidentsApi.update).toHaveBeenCalledTimes(4);
    expect(await screen.findByText('errors:notSavedYet')).toBeInTheDocument();

    // Leaving tries once more, then asks; the user leaves without it.
    dialogsMock.confirm.mockResolvedValueOnce(true);
    fireEvent.click(screen.getByText('shell-back'));
    await waitFor(() => expect(navigateMock).toHaveBeenCalled());
    expect(dialogsMock.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'common:autosave.leaveTitle' }));
    expect(incidentsApi.update).toHaveBeenCalledTimes(5);
    // The incident shows its stored description again.
    expect(await screen.findByDisplayValue('Short summary')).toBeInTheDocument();

    // The page moves to INC-2 (same instance); the server answers again.
    busy = false;
    act(() => navigate('/it/incidents/INC-2/overview'));
    const next = await screen.findByDisplayValue('Second summary');
    fireEvent.change(next, { target: { value: 'text for INC-2' } });
    await waitFor(() => expect(incidentsApi.update).toHaveBeenCalledTimes(6), { timeout: 3000 });
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });

    const after = vi.mocked(incidentsApi.update).mock.calls.slice(5);
    expect(after).toEqual([['inc-2', { description: 'text for INC-2' }]]);
    expect(vi.mocked(incidentsApi.update).mock.calls.every(([id, patch]) => id === 'inc-1' || (patch as any).description !== 'text for INC-1')).toBe(true);
  });
});
