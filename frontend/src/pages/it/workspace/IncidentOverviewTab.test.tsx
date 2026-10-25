import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../../api';
import { incidentsApi, type Incident } from '../../../api/endpoints/incidents';
import type { IntegratedDocumentEditorHandle } from '../../../components/IntegratedDocumentEditor';
import { createAppTheme } from '../../../config/ThemeContext';
import IncidentOverviewTab from './IncidentOverviewTab';

vi.mock('../../../api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../../api/endpoints/incidents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/endpoints/incidents')>();
  return {
    ...actual,
    incidentsApi: { ...actual.incidentsApi, listAttachments: vi.fn(async () => []) },
  };
});

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: () => false, profile: { id: 'user-1' } }),
}));

vi.mock('../../../tenant/TenantContext', () => ({
  useTenant: () => ({ tenantSlug: 'acme' }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

vi.mock('../../../components/MarkdownEditor', () => ({
  default: ({ value, onChange }: any) => (
    <textarea aria-label="markdown-editor" value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}));

vi.mock('../../../components/MarkdownContent', () => ({
  MarkdownContent: ({ content }: { content: string }) => <div>{content}</div>,
}));

vi.mock('../../../components/ExportButton', () => ({ default: () => null }));
vi.mock('../../../components/ImportButton', () => ({ default: () => null }));

const theme = createAppTheme('light');

function makeIncident(id: string, description: string): Incident {
  return {
    id,
    item_number: 1,
    title: 'Router down',
    description,
    status: 'open',
    severity: 'major',
  } as unknown as Incident;
}

function Harness({ incident, readOnly }: { incident: Incident; readOnly: boolean }) {
  const reviewEditorRef = React.useRef<IntegratedDocumentEditorHandle>(null);
  return (
    <IncidentOverviewTab
      key={incident.id}
      incident={incident}
      readOnly={readOnly}
      lockedBanner={null}
      savingHint={null}
      reviewHint={null}
      reviewEditorRef={reviewEditorRef}
      onReviewSaveStateChange={() => undefined}
      onPatchDebounced={() => undefined}
      canManageAttachments={!readOnly}
      onAttachmentsCountChange={() => undefined}
    />
  );
}

function renderTab(incident: Incident, readOnly = false) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider theme={theme}>
      <QueryClientProvider client={queryClient}>
        <Harness incident={incident} readOnly={readOnly} />
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

describe('IncidentOverviewTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(incidentsApi.listAttachments).mockResolvedValue([]);
    vi.mocked(api.get).mockImplementation(async (url: string) => ({
      data: {
        id: `doc-${url}`,
        item_number: 12,
        item_ref: 'DOC-12',
        content_markdown: url.includes('inc-2') ? 'Review of INC-2' : 'Review of INC-1',
        revision: 1,
        edit_lock: null,
      },
    }) as any);
    vi.mocked(api.post).mockResolvedValue({ data: { lock_token: 'lock-1', expires_at: null } } as any);
    vi.mocked(api.patch).mockResolvedValue({ data: {} } as any);
  });

  it('reloads the review when the workspace switches incident, without mixing drafts', async () => {
    const { rerender } = renderTab(makeIncident('inc-1', 'First incident'));
    expect(await screen.findByText('Review of INC-1')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('workspace.incident.overview.review'));
    const editor = await screen.findByLabelText('markdown-editor');
    fireEvent.change(editor, { target: { value: 'draft that belongs to INC-1' } });

    rerender(
      <ThemeProvider theme={theme}>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <Harness incident={makeIncident('inc-2', 'Second incident')} readOnly={false} />
        </QueryClientProvider>
      </ThemeProvider>,
    );

    expect(await screen.findByText('Review of INC-2')).toBeInTheDocument();
    expect(screen.queryByText('draft that belongs to INC-1')).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('Second incident')).toBeInTheDocument();
  });

  it('stays read-only on a closed incident: no lock is requested and the description cannot be edited', async () => {
    renderTab(makeIncident('inc-1', 'First incident'), true);
    expect(await screen.findByText('Review of INC-1')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Review of INC-1'));
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(api.post).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('markdown-editor')).not.toBeInTheDocument();

    const description = screen.getByDisplayValue('First incident') as HTMLTextAreaElement;
    expect(description).toHaveAttribute('readonly');
  });

  it('shows the attachments section to a contributor, after the review', async () => {
    renderTab(makeIncident('inc-1', 'First incident'));

    expect(await screen.findByText('Review of INC-1')).toBeInTheDocument();
    const review = screen.getByLabelText('workspace.incident.overview.review');
    const section = await screen.findByText('workspace.task.attachments.title');
    expect(review.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('workspace.task.actions.attachFiles')).toBeInTheDocument();
  });

  it('renders nothing to a reader when the incident has no attachment', async () => {
    renderTab(makeIncident('inc-1', 'First incident'), true);

    expect(await screen.findByText('Review of INC-1')).toBeInTheDocument();
    await waitFor(() => expect(incidentsApi.listAttachments).toHaveBeenCalledWith('inc-1'));
    expect(screen.queryByText('workspace.task.attachments.title')).toBeNull();
  });

  it('shows an existing attachment read-only to a reader', async () => {
    vi.mocked(incidentsApi.listAttachments).mockResolvedValue([
      {
        id: 'att-1',
        incident_id: 'inc-1',
        original_filename: 'shot.png',
        mime_type: 'image/png',
        size: 2048,
        uploaded_at: '2026-09-01T08:00:00.000Z',
      },
    ]);
    renderTab(makeIncident('inc-1', 'First incident'), true);

    expect(await screen.findByText('shot.png (2.0 KB)')).toBeInTheDocument();
    expect(screen.queryByText('workspace.task.actions.attachFiles')).toBeNull();
  });
});
