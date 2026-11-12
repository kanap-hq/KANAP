import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import ArtifactPanel from '../components/ArtifactPanel';
import { createAppTheme } from '../../config/ThemeContext';

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
      />,
    );

    fireEvent.click(screen.getByText('previewBatch.approveAll'));
    fireEvent.click(screen.getAllByText('previewBatch.approveAll')[1]);

    expect(onApproveMany).toHaveBeenCalledWith(previews.map((preview) => preview.preview_id));
    expect(screen.getByText('previewBatch.title:3')).toBeInTheDocument();
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
      />,
    );
    const actions = screen.getByRole('button', { name: 'ai:previewCard.approve' }).parentElement!;
    expect(actions).toContainElement(screen.getByRole('button', { name: 'ai:previewCard.reject' }));
    expect(actions).toHaveStyle({ position: 'sticky', bottom: '0px' });
    expect(getComputedStyle(actions).backgroundColor).not.toBe('');
  });
});
