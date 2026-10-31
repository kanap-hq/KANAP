import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api';
import { incidentsApi, type Incident, type IncidentAttachment } from '../../api/endpoints/incidents';
import { createAppTheme } from '../../config/ThemeContext';
import IncidentWorkspacePage from './IncidentWorkspacePage';

const navigateMock = vi.hoisted(() => vi.fn());
const shellProps = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
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
      create: vi.fn(),
      update: vi.fn(),
      cancel: vi.fn(),
      reopen: vi.fn(),
      setConfidentiality: vi.fn(),
      exportReport: vi.fn(),
      listAttachments: vi.fn(async () => []),
      uploadAttachment: vi.fn(),
      deleteAttachment: vi.fn(),
    },
  };
});

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigateMock,
}));

// The incident level the user holds (every other resource: admin).
const authLevel = vi.hoisted(() => ({ incidents: 'admin' }));
const RANK: Record<string, number> = { reader: 1, contributor: 2, member: 3, admin: 4 };
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    hasLevel: (resource: string, level: string) => resource !== 'incidents' || RANK[authLevel.incidents] >= RANK[level],
    profile: { id: 'user-1' },
  }),
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
vi.mock('../../components/EntityKnowledgePanel', () => ({
  default: ({ onLinksChange }: { onLinksChange?: () => void }) => (
    <button type="button" onClick={() => onLinksChange?.()}>knowledge-link-saved</button>
  ),
}));
vi.mock('../../components/history/RecordHistoryTab', () => ({
  default: (props: { table: string; recordId: string }) => <div data-testid="record-history">{`${props.table}:${props.recordId}`}</div>,
}));
vi.mock('./workspace/IncidentMetadataBar', () => ({ default: () => null }));
vi.mock('./workspace/IncidentPropertiesDrawer', () => ({
  default: ({ onChange, isCreate }: { onChange?: (patch: { severity?: string }) => void; isCreate?: boolean }) => (
    isCreate ? <button type="button" onClick={() => onChange?.({ severity: 'major' })}>set-severity</button> : null
  ),
}));
vi.mock('./workspace/IncidentRelationsTab', () => ({ default: () => null }));
vi.mock('./workspace/IncidentJournalTab', () => ({
  default: () => null,
  incidentEntriesQueryKey: (id: string) => ['incident-entries', id],
}));

vi.mock('../portfolio/workspace/PortfolioDetailWorkspaceShell', () => ({
  default: (props: any) => {
    shellProps.current = props;
    const { children, notices, actions, onBack, onTabChange, onSaveShortcut, nav, tabs, title, canEditTitle, onTitleSave, onTitleDraftChange, titleError, properties } = props;
    return (
      <div>
        {tabs?.map((tab: any) => <span key={tab.key} data-testid={`tab-${tab.key}`}>{tab.badge ?? ''}</span>)}
        <button type="button" onClick={() => onBack?.()}>shell-back</button>
        <button type="button" onClick={() => onTabChange?.('journal')}>shell-tab-journal</button>
        <button type="button" onClick={() => onSaveShortcut?.()}>shell-save-shortcut</button>
        <button type="button" onClick={() => nav?.onNext?.()}>shell-next</button>
        {canEditTitle ? (
          <input
            aria-label="shell-title"
            defaultValue={title}
            onChange={(event) => onTitleDraftChange?.(event.target.value)}
            onBlur={(event) => onTitleSave?.(event.target.value)}
          />
        ) : null}
        {titleError ? <div role="alert">{titleError}</div> : null}
        <div data-testid="workspace-notices">{notices}</div>
        <div>{properties}</div>
        <div>{actions}</div>
        <div>{children}</div>
      </div>
    );
  },
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
  counts: { entries: 0, assets: 0, applications: 0, technologies: 0, tasks: 0, documents: 0, attachments: 0 },
};

function renderPage(tab = 'overview') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <ThemeProvider theme={theme}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/it/incidents/INC-1/${tab}`]}>
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

function renderNewIncident() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider theme={theme}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/it/incidents/new/overview']}>
          <Routes>
            <Route path="/it/incidents/:id/:tab" element={<IncidentWorkspacePage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

describe('IncidentWorkspacePage — new incident title', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authLevel.incidents = 'contributor';
    shellProps.current = null;
  });

  it('types the title in the header and keeps the description in the body', () => {
    renderNewIncident();

    expect(screen.getByLabelText('shell-title')).toHaveValue('');
    expect(shellProps.current).toMatchObject({
      canEditTitle: true,
      title: '',
      titleFallback: 'workspace.incident.newTitle',
      titleRequiredMessage: 'workspace.incident.create.titleRequired',
    });
    expect(screen.queryByText('workspace.incident.create.title')).toBeNull();
    expect(screen.getByPlaceholderText('workspace.incident.overview.descriptionPlaceholder')).toBeInTheDocument();
    expect(screen.getByText('set-severity')).toBeInTheDocument();
  });

  it('shows the required error in the header when creating without a title', () => {
    renderNewIncident();

    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));

    expect(screen.getByRole('alert')).toHaveTextContent('workspace.incident.create.titleRequired');
    expect(screen.queryByText('workspace.incident.create.severityRequired')).toBeNull();
    expect(incidentsApi.create).not.toHaveBeenCalled();

    const title = screen.getByLabelText('shell-title');
    fireEvent.change(title, { target: { value: 'Mail outage' } });
    fireEvent.blur(title);
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));

    expect(screen.queryByText('workspace.incident.create.titleRequired')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('workspace.incident.create.severityRequired');
    expect(incidentsApi.create).not.toHaveBeenCalled();
  });

  it('drops the title error as soon as a title is typed, and brings it back on Create', () => {
    renderNewIncident();

    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    expect(screen.getByRole('alert')).toHaveTextContent('workspace.incident.create.titleRequired');

    const title = screen.getByLabelText('shell-title');
    fireEvent.change(title, { target: { value: 'M' } });
    expect(screen.queryByRole('alert')).toBeNull();

    fireEvent.change(title, { target: { value: '' } });
    expect(screen.queryByRole('alert')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    expect(screen.getByRole('alert')).toHaveTextContent('workspace.incident.create.titleRequired');
    expect(incidentsApi.create).not.toHaveBeenCalled();
  });

  it('creates the incident from the header title and the description', async () => {
    vi.mocked(incidentsApi.create).mockResolvedValue({ ...incident, title: 'Mail outage', item_number: 4 });
    renderNewIncident();

    fireEvent.click(screen.getByText('set-severity'));
    const title = screen.getByLabelText('shell-title');
    fireEvent.change(title, { target: { value: '  Mail outage  ' } });
    fireEvent.blur(title);
    fireEvent.change(screen.getByPlaceholderText('workspace.incident.overview.descriptionPlaceholder'), {
      target: { value: '  The Lyon office lost mail  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));

    await waitFor(() => expect(incidentsApi.create).toHaveBeenCalledTimes(1));
    expect(vi.mocked(incidentsApi.create).mock.calls[0][0]).toMatchObject({
      title: 'Mail outage',
      severity: 'major',
      description: 'The Lyon office lost mail',
    });
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/it/incidents/INC-4/overview', { replace: true }));
  });

  it('offers no header title to a reader', () => {
    authLevel.incidents = 'reader';
    renderNewIncident();

    expect(screen.queryByLabelText('shell-title')).toBeNull();
    expect(shellProps.current).toMatchObject({ canEditTitle: false, titleRequiredMessage: undefined });
    expect(screen.getByRole('button', { name: 'common:buttons.create' })).toBeDisabled();
  });

  it('keeps an existing incident title on the loaded record', async () => {
    authLevel.incidents = 'admin';
    vi.mocked(incidentsApi.get).mockResolvedValue(incident);
    vi.mocked(api.get).mockResolvedValue({
      data: { id: 'doc-1', item_number: 12, item_ref: 'DOC-12', content_markdown: '', revision: 1, edit_lock: null },
    } as any);
    renderPage();

    await screen.findByLabelText('workspace.incident.overview.review');
    expect(screen.getByLabelText('shell-title')).toHaveValue('Router down');
    expect(shellProps.current).toMatchObject({
      canEditTitle: true,
      title: 'Router down',
      titleFallback: 'workspace.incident.untitled',
      titleRequiredMessage: undefined,
      titleError: null,
    });
    expect(screen.queryByText('workspace.incident.create.description')).toBeNull();
    expect(screen.getByDisplayValue('Short summary')).toBeInTheDocument();
  });
});

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

describe('IncidentWorkspacePage — delete', () => {
  const impact = {
    incidents: 1, review_documents: 1, tasks: 2, entries: 3, attachments: 0, applications: 1, assets: 0, documents: 0, blocked: 0, refused: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    authLevel.incidents = 'admin';
    vi.mocked(incidentsApi.get).mockResolvedValue(incident);
    vi.mocked(api.get).mockResolvedValue({ data: { id: 'doc-1', item_number: 12, item_ref: 'DOC-12', content_markdown: '', revision: 1, edit_lock: null } } as any);
    vi.mocked(api.delete).mockResolvedValue({ data: { deleted: true } } as any);
  });

  it('asks with what goes and what loses its link, then deletes and leaves the register page', async () => {
    vi.mocked(api.post).mockImplementation(async (url: string) => (url === '/incidents/delete-check' ? { data: impact } : { data: {} }) as any);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'common:buttons.delete' }));

    await waitFor(() => expect(dialogsMock.confirm).toHaveBeenCalled());
    expect(api.post).toHaveBeenCalledWith('/incidents/delete-check', { ids: [incident.id] });
    const asked = (dialogsMock.confirm.mock.calls[0] as any[])[0];
    expect(asked.message).toContain('it:pages.incidents.delete.removed');
    expect(asked.message).toContain('it:pages.incidents.delete.detached');
    expect(asked.confirmLabel).toBe('it:pages.incidents.delete.confirmAnyway');
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith(`/incidents/${incident.id}`));
    await waitFor(() => expect(navigateMock).toHaveBeenCalled());
  });

  it('refuses an incident holding regulatory reporting data before any confirmation', async () => {
    vi.mocked(api.post).mockImplementation(async (url: string) => (url === '/incidents/delete-check'
      ? { data: { ...impact, incidents: 0, blocked: 1, refused: [{ id: incident.id, name: 'INC-1', code: 'INCIDENT_HAS_REGULATORY_RECORDS', usages: [{ type: 'regulatory_records', total: 1 }] }] } }
      : { data: {} }) as any);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'common:buttons.delete' }));

    await waitFor(() => expect(dialogsMock.alert).toHaveBeenCalled());
    expect((dialogsMock.alert.mock.calls[0] as any[])[0].message).toBe('errors:INCIDENT_HAS_REGULATORY_RECORDS');
    expect(dialogsMock.confirm).not.toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();
  });

  it('refuses a closed or cancelled incident before any confirmation', async () => {
    vi.mocked(api.post).mockImplementation(async (url: string) => (url === '/incidents/delete-check'
      ? { data: { ...impact, incidents: 0, blocked: 1, refused: [{ id: incident.id, name: 'INC-1', code: 'INCIDENT_CLOSED_OR_CANCELLED', usages: [] }] } }
      : { data: {} }) as any);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'common:buttons.delete' }));

    await waitFor(() => expect(dialogsMock.alert).toHaveBeenCalled());
    expect((dialogsMock.alert.mock.calls[0] as any[])[0].message).toBe('errors:INCIDENT_CLOSED_OR_CANCELLED');
    expect(dialogsMock.confirm).not.toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();
  });

  it.each(['reader', 'contributor', 'member'])('offers no delete to an incident %s', async (level) => {
    authLevel.incidents = level;
    renderPage();
    await screen.findByText('workspace.incident.actions.exportPdf');
    expect(screen.queryByRole('button', { name: 'common:buttons.delete' })).toBeNull();
  });
});

describe('IncidentWorkspacePage — Relations badge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authLevel.incidents = 'admin';
    vi.mocked(api.get).mockResolvedValue({ data: { id: 'doc-1', item_number: 12, item_ref: 'DOC-12', content_markdown: '', revision: 1, edit_lock: null } } as any);
  });

  it('sums each visible section and counts a hidden one as zero', async () => {
    vi.mocked(incidentsApi.get).mockResolvedValue({
      ...incident,
      counts: { ...incident.counts, assets: 2, applications: null, technologies: null, tasks: 3 },
    });
    renderPage();
    await waitFor(() => expect(screen.getByTestId('tab-relations')).toHaveTextContent('5'));
  });
});

// QA lot 14: linking or unlinking a document left the Documents badge as it was until a reload.
describe('IncidentWorkspacePage — Documents badge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authLevel.incidents = 'admin';
    vi.mocked(api.get).mockResolvedValue({ data: { id: 'doc-1', item_number: 12, item_ref: 'DOC-12', content_markdown: '', revision: 1, edit_lock: null } } as any);
  });

  it('follows a link and an unlink made in the Documents tab, without a reload', async () => {
    const withDocuments = (documents: number): Incident => ({ ...incident, counts: { ...incident.counts, documents } });
    vi.mocked(incidentsApi.get)
      .mockResolvedValueOnce(withDocuments(0))
      .mockResolvedValueOnce(withDocuments(1))
      .mockResolvedValueOnce(withDocuments(0));
    renderPage('documents');
    fireEvent.click(await screen.findByText('knowledge-link-saved'));
    await waitFor(() => expect(screen.getByTestId('tab-documents')).toHaveTextContent('1'));
    fireEvent.click(screen.getByText('knowledge-link-saved'));
    await waitFor(() => expect(screen.getByTestId('tab-documents')).toHaveTextContent(/^$/));
    expect(incidentsApi.get).toHaveBeenCalledTimes(3);
  });
});

describe('IncidentWorkspacePage — attachments in the overview', () => {
  const attachment: IncidentAttachment = {
    id: 'att-1',
    incident_id: 'inc-1',
    original_filename: 'shot.png',
    mime_type: 'image/png',
    size: 2048,
    uploaded_at: '2026-09-01T08:00:00.000Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    authLevel.incidents = 'admin';
    vi.mocked(incidentsApi.get).mockResolvedValue(incident);
    vi.mocked(incidentsApi.listAttachments).mockResolvedValue([]);
    vi.mocked(api.get).mockResolvedValue({
      data: { id: 'doc-1', item_number: 12, item_ref: 'DOC-12', content_markdown: '## Description', revision: 1, edit_lock: null },
    } as any);
    vi.mocked(api.post).mockResolvedValue({ data: { lock_token: 'lock-1', expires_at: null } } as any);
  });

  it('no longer offers an attachments tab', async () => {
    renderPage();

    await screen.findByLabelText('workspace.incident.overview.review');
    expect(screen.queryByTestId('tab-attachments')).toBeNull();
    expect(screen.getByTestId('tab-overview')).toBeInTheDocument();
  });

  it('opens the overview from a former /attachments address', async () => {
    renderPage('attachments');

    expect(await screen.findByLabelText('workspace.incident.overview.review')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Short summary')).toBeInTheDocument();
    expect(screen.queryByTestId('tab-attachments')).toBeNull();
  });

  it('shows the section to a contributor', async () => {
    authLevel.incidents = 'contributor';
    renderPage();

    expect(await screen.findByText('workspace.task.attachments.title')).toBeInTheDocument();
    expect(screen.getByText('workspace.task.actions.attachFiles')).toBeInTheDocument();
  });

  it('hides the empty section from a reader', async () => {
    authLevel.incidents = 'reader';
    renderPage();

    await waitFor(() => expect(incidentsApi.listAttachments).toHaveBeenCalledWith('inc-1'));
    expect(screen.queryByText('workspace.task.attachments.title')).toBeNull();
  });

  it('shows an existing attachment read-only to a reader', async () => {
    authLevel.incidents = 'reader';
    vi.mocked(incidentsApi.listAttachments).mockResolvedValue([attachment]);
    renderPage();

    expect(await screen.findByText('shot.png (2.0 KB)')).toBeInTheDocument();
    expect(screen.queryByText('workspace.task.actions.attachFiles')).toBeNull();
  });

  it('keeps existing attachments read-only on a closed incident', async () => {
    vi.mocked(incidentsApi.get).mockResolvedValue({ ...incident, status: 'closed', closed_at: '2026-09-02T00:00:00.000Z' });
    vi.mocked(incidentsApi.listAttachments).mockResolvedValue([attachment]);
    renderPage();

    expect(await screen.findByText('shot.png (2.0 KB)')).toBeInTheDocument();
    expect(screen.queryByText('workspace.task.actions.attachFiles')).toBeNull();
  });
});

describe('IncidentWorkspacePage — History tab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authLevel.incidents = 'reader';
    shellProps.current = null;
  });

  it('renders the incident history on its last tab, after the journal and the documents', async () => {
    vi.mocked(incidentsApi.get).mockResolvedValue(incident);
    vi.mocked(api.get).mockResolvedValue({ data: null } as any);
    renderPage('history');

    expect(await screen.findByTestId('record-history')).toHaveTextContent('incidents:inc-1');
    const tabs = (shellProps.current?.tabs as Array<{ key: string; label: string; disabled?: boolean }>);
    expect(tabs.map((tab) => tab.key)).toEqual(['overview', 'journal', 'relations', 'documents', 'history']);
    expect(tabs[4]).toMatchObject({ label: 'workspace.incident.tabs.history', disabled: false });
  });

  it('keeps the History tab disabled, with no history, while the incident is created', () => {
    authLevel.incidents = 'contributor';
    renderNewIncident();

    const tabs = (shellProps.current?.tabs as Array<{ key: string; disabled?: boolean }>);
    expect(tabs.find((tab) => tab.key === 'history')).toMatchObject({ disabled: true });
    expect(screen.queryByTestId('record-history')).toBeNull();
  });
});
