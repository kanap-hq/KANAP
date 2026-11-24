import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ArtifactPanel from '../components/ArtifactPanel';
import { createAppTheme } from '../../config/ThemeContext';
import type { AiMutationPreview } from '../aiTypes';

const { setBulk } = vi.hoisted(() => ({ setBulk: vi.fn() }));
vi.mock('../previewChains', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../previewChains')>()),
  setBulkExclusions: (...args: unknown[]) => setBulk(...args),
}));

/** A pending card of a change in bulk that lists two records, and a task card: two to approve at once. */
function countingCards(): AiMutationPreview[] {
  const base = {
    status: 'pending' as const,
    requires_confirmation: true,
    actions: ['approve', 'reject'] as Array<'approve' | 'reject'>,
    error_message: null,
    conversation_id: 'conversation-1',
    created_at: '2026-11-23T10:00:00.000Z',
    expires_at: null,
    approved_at: null,
    rejected_at: null,
    executed_at: null,
  };
  const row = (n: number) => ({ id: `00000000-0000-4000-8000-00000000000${n}`, ref: `APP-${n}`, title: `App ${n}`, before: 'Low', before_state: 'value' as const, kept: true });
  return [
    {
      ...base,
      preview_id: 'bulk-1',
      tool_name: 'bulk_update_applications',
      target: { entity_type: 'applications', entity_id: null, ref: null, title: '2 applications' },
      changes: { application_bulk_edit: { label: 'Change in bulk', from: null, to: '2 applications to change', format: 'markdown' } },
      summary: 'Change Business criticality on 2 applications.',
      bulk_edit: { field: 'Business criticality', after: 'High', after_empty: false, rows: [row(1), row(2)], kept: 2, excluded: 0 },
    },
    {
      ...base,
      preview_id: 'task-1',
      tool_name: 'create_task',
      target: { entity_type: 'tasks', entity_id: null, ref: null, title: 'Task 1' },
      changes: { title: { label: 'Title', from: null, to: 'Task 1', format: 'text' } },
      summary: 'Create task 1.',
    },
  ] as AiMutationPreview[];
}

// The card's labels read the catalogs through the real i18n instance, which this file mocks.
vi.mock('../components/previewChangeLabels', () => ({
  usePreviewChangeLabels: () => ({
    fieldLabel: (_preview: unknown, field: string, label?: string | null) => label || field,
    valueLabel: (_preview: unknown, _field: string, value: string | null) => value,
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => (
      options?.count == null ? key : `${key}:${options.count}`
    ),
    i18n: {
      language: 'en',
      resolvedLanguage: 'en',
    },
    ready: true,
  }),
}));

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: () => true }),
}));

describe('ArtifactPanel', () => {
  const theme = createAppTheme('light');
  const renderWithTheme = (ui: React.ReactElement) => render(
    <ThemeProvider theme={theme}>
      {ui}
    </ThemeProvider>,
  );

  it('offers guarded bulk approval for pending preview groups', () => {
    const previews = Array.from({ length: 3 }, (_, index) => ({
      preview_id: `${index + 1}${index + 1}${index + 1}${index + 1}${index + 1}${index + 1}${index + 1}${index + 1}-${index + 1}${index + 1}${index + 1}${index + 1}-4${index + 1}${index + 1}${index + 1}-8${index + 1}${index + 1}${index + 1}-${index + 1}${index + 1}${index + 1}${index + 1}${index + 1}${index + 1}${index + 1}${index + 1}${index + 1}${index + 1}${index + 1}${index + 1}`,
      tool_name: 'create_task' as const,
      status: 'pending' as const,
      target: {
        entity_type: 'tasks',
        entity_id: null,
        ref: null,
        title: `Task ${index + 1}`,
      },
      changes: {
        title: {
          label: 'Title',
          from: null,
          to: `Task ${index + 1}`,
          format: 'text' as const,
        },
      },
      requires_confirmation: true,
      actions: ['approve', 'reject'] as Array<'approve' | 'reject'>,
      summary: `Create task ${index + 1}.`,
      error_message: null,
      conversation_id: 'conversation-1',
      created_at: '2026-03-28T17:00:00.000Z',
      expires_at: '2026-03-28T17:10:00.000Z',
      approved_at: null,
      rejected_at: null,
      executed_at: null,
    }));
    const onApproveMany = vi.fn();

    renderWithTheme(
      <ArtifactPanel
        previews={previews}
        selectedId={previews[0].preview_id}
        open
        onToggle={() => undefined}
        onSelect={() => undefined}
        onApprove={() => undefined}
        onReject={() => undefined}
        onApproveMany={onApproveMany}
        onRejectMany={() => undefined}
      />,
    );

    fireEvent.click(screen.getByText('previewBatch.approveAll'));
    fireEvent.click(screen.getAllByText('previewBatch.approveAll')[1]);

    expect(onApproveMany).toHaveBeenCalledWith(previews.map((preview) => preview.preview_id));
    expect(screen.getByText('previewBatch.title:3')).toBeInTheDocument();
  });

  // Review of lot K2e: a box in flight on a card makes "Approve all" wait, as the card's own Approve.
  it('waits with Approve all while a box of a change in bulk is counted', async () => {
    const previews = countingCards();
    let answer!: (value: AiMutationPreview) => void;
    setBulk.mockReturnValueOnce(new Promise<AiMutationPreview>((resolve) => { answer = resolve; }));
    renderWithTheme(
      <ArtifactPanel
        previews={previews}
        selectedId="bulk-1"
        open
        onToggle={() => undefined}
        onSelect={() => undefined}
        onApprove={() => undefined}
        onReject={() => undefined}
        onApproveMany={() => undefined}
        onRejectMany={() => undefined}
        onReplace={() => undefined}
      />,
    );
    const approveAll = screen.getByRole('button', { name: 'previewBatch.approveAll' });
    expect(approveAll).toBeEnabled();
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    expect(setBulk).toHaveBeenCalledTimes(1);
    expect(approveAll).toBeDisabled();
    await act(async () => answer({ ...previews[0], preview_id: 'bulk-2', replaces_preview_id: 'bulk-1' }));
    expect(approveAll).toBeEnabled();
  });

  // Lot K1 of 26.11.9: next to Approve all, Reject all rejects every pending card at once, without a dialog.
  it('rejects every pending card once with Reject all, without a confirmation', () => {
    const previews = Array.from({ length: 4 }, (_, index) => ({
      preview_id: `card-${index + 1}`,
      tool_name: 'update_business_record' as const,
      status: (index === 3 ? 'rejected' : 'pending') as 'pending' | 'rejected',
      target: { entity_type: 'applications', entity_id: `app-${index + 1}`, ref: `APP-${index + 1}`, title: `App ${index + 1}` },
      changes: { category: { label: 'Category', from: 'Analytics', to: 'Infrastructure', format: 'text' as const } },
      requires_confirmation: true,
      actions: ['approve', 'reject'] as Array<'approve' | 'reject'>,
      summary: `Change APP-${index + 1}.`,
      error_message: null,
      conversation_id: 'conversation-1',
      created_at: '2026-03-28T17:00:00.000Z',
      expires_at: '2026-03-28T17:10:00.000Z',
      approved_at: null,
      rejected_at: null,
      executed_at: null,
    }));
    // The third card imports a file its check refuses: it cannot be approved, but it can be rejected.
    Object.assign(previews[2], { import_mapping: { validation: { ok: false } } });
    const onRejectMany = vi.fn();
    const onReject = vi.fn();

    renderWithTheme(
      <ArtifactPanel
        previews={previews}
        selectedId={previews[0].preview_id}
        open
        onToggle={() => undefined}
        onSelect={() => undefined}
        onApprove={() => undefined}
        onReject={onReject}
        onApproveMany={() => undefined}
        onRejectMany={onRejectMany}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'previewBatch.rejectAll' }));

    expect(onRejectMany).toHaveBeenCalledTimes(1);
    expect(onRejectMany).toHaveBeenCalledWith(['card-1', 'card-2', 'card-3']);
    expect(onReject).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows Reject all only where Approve all shows', () => {
    const preview = {
      preview_id: 'card-1',
      tool_name: 'update_business_record' as const,
      status: 'pending' as const,
      target: { entity_type: 'applications', entity_id: 'app-1', ref: 'APP-1', title: 'App 1' },
      changes: { category: { label: 'Category', from: 'Analytics', to: 'Infrastructure', format: 'text' as const } },
      requires_confirmation: true,
      actions: ['approve', 'reject'] as Array<'approve' | 'reject'>,
      summary: 'Change APP-1.',
      error_message: null,
      conversation_id: 'conversation-1',
      created_at: '2026-03-28T17:00:00.000Z',
      expires_at: '2026-03-28T17:10:00.000Z',
      approved_at: null,
      rejected_at: null,
      executed_at: null,
    };
    renderWithTheme(
      <ArtifactPanel
        previews={[preview, { ...preview, preview_id: 'card-2', status: 'rejected' as any }]}
        selectedId="card-1"
        open
        onToggle={() => undefined}
        onSelect={() => undefined}
        onApprove={() => undefined}
        onReject={() => undefined}
        onApproveMany={() => undefined}
        onRejectMany={() => undefined}
      />,
    );

    expect(screen.queryByText('previewBatch.approveAll')).toBeNull();
    expect(screen.queryByText('previewBatch.rejectAll')).toBeNull();
  });

  it('keeps the actions of a long card in view at the bottom of the panel', () => {
    // jsdom lays nothing out: the structure says it. The card scrolls inside the panel, and its
    // action row sticks to the bottom of that scroller, on the card's own background.
    const preview = {
      preview_id: '11111111-1111-4111-8111-111111111111',
      tool_name: 'create_task' as const,
      status: 'pending' as const,
      target: { entity_type: 'tasks', entity_id: null, ref: null, title: 'Task 1' },
      changes: { title: { label: 'Title', from: null, to: 'Task 1', format: 'text' as const } },
      requires_confirmation: true,
      actions: ['approve', 'reject'] as Array<'approve' | 'reject'>,
      summary: 'Create task 1.',
      error_message: null,
      conversation_id: 'conversation-1',
      created_at: '2026-03-28T17:00:00.000Z',
      expires_at: '2026-03-28T17:10:00.000Z',
      approved_at: null,
      rejected_at: null,
      executed_at: null,
    };
    renderWithTheme(
      <ArtifactPanel
        previews={[preview]}
        selectedId={preview.preview_id}
        open
        onToggle={() => undefined}
        onSelect={() => undefined}
        onApprove={() => undefined}
        onReject={() => undefined}
        onApproveMany={() => undefined}
        onRejectMany={() => undefined}
      />,
    );
    const actions = screen.getByRole('button', { name: 'ai:previewCard.approve' }).parentElement!;
    expect(actions).toContainElement(screen.getByRole('button', { name: 'ai:previewCard.reject' }));
    // It reaches the bottom edge of the panel: the scroller's bottom padding (12px) is taken back.
    expect(actions).toHaveStyle({ position: 'sticky', bottom: '-12px' });
    expect(getComputedStyle(actions).backgroundColor).not.toBe('');
  });

  it('shows the lookalikes of a budget file above the actions that stay in view', () => {
    const preview = {
      preview_id: '22222222-2222-4222-8222-222222222222',
      tool_name: 'prepare_import_mapping' as const,
      status: 'pending' as const,
      target: { entity_type: 'imports', entity_id: null, ref: null, title: 'Budget lines · budget.xlsx' },
      changes: {},
      import_mapping: {
        import_key: 'budget_lines',
        filename: 'budget.xlsx',
        row_count: 2,
        columns: [],
        unread_values: {},
        read_errors: {},
        missing_required: [],
        unplaced: [],
        assumptions: [],
        sample: { columns: [], rows: [], unread: [] },
        rows_missing_required: 0,
        validation: {
          ok: true, dry_run: true, total: 2, inserted: 2, updated: 0, unchanged: 0, skipped: 0, error_count: 0, warning_count: 1,
          report: {
            kind: 'budget_file' as const,
            file: {
              ok: true, notices: {}, fileErrors: [], headerErrors: [], errors: [], errorCount: 0, missing: [], deleted: [], deletedCount: 0,
              changes: { created: 2, updated: 0, unchanged: 0, createdLines: [], updatedLines: [] },
              changedSinceExport: [], changedSinceExportCount: 0,
              warnings: { duplicates: [], ignoredColumns: [], supplierNames: [], ignoredCells: [] },
              lookalikes: {
                lines: [{ line: 3, nature: 'opex', name: 'Hosting', target: { item: 7, ref: 'BL-7', name: 'AWS hosting', state: 's7' }, reason: 'amounts', outcome: 'ignored', updatable: true }],
                count: 1, ignored: 1, created: 0, updated: 0,
              },
              creates: { dimensionValues: [], suppliers: [] },
              supplierMessage: null,
            } as any,
          },
        },
      },
      requires_confirmation: true,
      actions: ['approve', 'reject'] as Array<'approve' | 'reject'>,
      summary: 'Import "budget.xlsx" into the Budget lines list.',
      error_message: null,
      conversation_id: 'conversation-1',
      created_at: '2026-03-28T17:00:00.000Z',
      expires_at: '2026-03-28T17:10:00.000Z',
      approved_at: null,
      rejected_at: null,
      executed_at: null,
    };
    // The budget file's check reads the tenant's column names.
    renderWithTheme(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })}>
        <ArtifactPanel
          previews={[preview]}
          selectedId={preview.preview_id}
          open
          onToggle={() => undefined}
          onSelect={() => undefined}
          onApprove={() => undefined}
          onReject={() => undefined}
          onApproveMany={() => undefined}
          onRejectMany={() => undefined}
        />
      </QueryClientProvider>,
    );
    const actions = screen.getByRole('button', { name: 'ai:previewCard.approve' }).parentElement!;
    const lookalike = screen.getByText((_, element) => element?.tagName === 'P' && /^operations\.budgetFile\.lookalikes\.row/.test(element.textContent ?? ''));
    // Read just before the actions, not hidden under them.
    expect(actions).not.toContainElement(lookalike);
    expect(lookalike.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

// Its edge became the one of the properties panels (lot N2 of 26.11.9): same gestures, its own
// bounds (320px, 70% of the window) and key.
describe('ArtifactPanel width', () => {
  const theme = createAppTheme('light');
  const preview = {
    preview_id: 'card-1',
    tool_name: 'create_task' as const,
    status: 'pending' as const,
    target: { entity_type: 'tasks', entity_id: null, ref: null, title: 'Task 1' },
    changes: { title: { label: 'Title', from: null, to: 'Task 1', format: 'text' as const } },
    requires_confirmation: true,
    actions: ['approve', 'reject'] as Array<'approve' | 'reject'>,
    summary: 'Create task 1.',
    error_message: null,
    conversation_id: 'conversation-1',
    created_at: '2026-03-28T17:00:00.000Z',
    expires_at: '2026-03-28T17:10:00.000Z',
    approved_at: null,
    rejected_at: null,
    executed_at: null,
  };
  const edge = () => screen.getByRole('separator', { name: 'artifactPanel.resize' });
  const panel = () => edge().parentElement as HTMLElement;

  function setUp(windowWidth: number, stored: Record<string, string> = {}) {
    const store = new Map(Object.entries(stored));
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, String(value)); },
      removeItem: (key: string) => { store.delete(key); },
    });
    Object.defineProperty(window, 'innerWidth', { value: windowWidth, configurable: true, writable: true });
    render(
      <ThemeProvider theme={theme}>
        <ArtifactPanel
          previews={[preview]}
          selectedId="card-1"
          open
          onToggle={() => undefined}
          onSelect={() => undefined}
          onApprove={() => undefined}
          onReject={() => undefined}
          onApproveMany={() => undefined}
          onRejectMany={() => undefined}
        />
      </ThemeProvider>,
    );
    return store;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true, writable: true });
  });

  it('follows its edge between 320px and 70% of the window, and keeps the width', () => {
    const store = setUp(1000);
    expect(panel()).toHaveStyle({ width: '480px' });

    fireEvent.pointerDown(edge(), { button: 0, pointerId: 1, clientX: 500 });
    fireEvent.pointerMove(edge(), { pointerId: 1, clientX: 440 });
    expect(panel()).toHaveStyle({ width: '540px' });
    fireEvent.pointerMove(edge(), { pointerId: 1, clientX: 100 });
    expect(panel()).toHaveStyle({ width: '700px' });
    fireEvent.pointerMove(edge(), { pointerId: 1, clientX: 900 });
    expect(panel()).toHaveStyle({ width: '320px' });
    fireEvent.pointerUp(edge(), { pointerId: 1, clientX: 900 });
    expect(store.get('kanap.ai.artifactPanelWidth')).toBe('320');
    expect(edge()).toHaveAttribute('aria-valuemin', '320');
    expect(edge()).toHaveAttribute('aria-valuemax', '700');
  });

  it('comes back to 480px on a double-click or Enter, and moves with the arrow keys', () => {
    const store = setUp(1400, { 'kanap.ai.artifactPanelWidth': '600' });
    expect(panel()).toHaveStyle({ width: '600px' });

    fireEvent.doubleClick(edge());
    expect(panel()).toHaveStyle({ width: '480px' });
    fireEvent.keyDown(edge(), { key: 'ArrowLeft' });
    expect(panel()).toHaveStyle({ width: '496px' });
    fireEvent.keyDown(edge(), { key: 'ArrowRight' });
    fireEvent.keyDown(edge(), { key: 'ArrowRight' });
    expect(panel()).toHaveStyle({ width: '464px' });
    fireEvent.keyDown(edge(), { key: 'Enter' });
    expect(panel()).toHaveStyle({ width: '480px' });
    expect(store.get('kanap.ai.artifactPanelWidth')).toBe('480');
  });

  it('narrows with the window and takes its width back when the window grows', () => {
    setUp(1400, { 'kanap.ai.artifactPanelWidth': '800' });
    expect(panel()).toHaveStyle({ width: '800px' });
    act(() => {
      Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true, writable: true });
      window.dispatchEvent(new Event('resize'));
    });
    expect(panel()).toHaveStyle({ width: '700px' });
    act(() => {
      Object.defineProperty(window, 'innerWidth', { value: 1400, configurable: true, writable: true });
      window.dispatchEvent(new Event('resize'));
    });
    expect(panel()).toHaveStyle({ width: '800px' });
  });
});
