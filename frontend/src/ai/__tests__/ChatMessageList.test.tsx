import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import ChatMessageList from '../components/ChatMessageList';
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
    t: (key: string) => key,
    i18n: {
      language: 'en',
      resolvedLanguage: 'en',
    },
    ready: true,
  }),
}));

// Rights the signed-in person holds: a reference opens its record only where the route would.
let readableResources: string[] | null = null;
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    hasLevel: (resource: string) => readableResources == null || readableResources.includes(resource),
  }),
}));

describe('ChatMessageList', () => {
  const theme = createAppTheme('light');
  const renderWithTheme = (ui: React.ReactElement) => render(
    <ThemeProvider theme={theme}>
      {ui}
    </ThemeProvider>,
  );

  it('renders the assistant text before the preview card controls', () => {
    const preview = {
      preview_id: 'preview-1',
      tool_name: 'create_document' as const,
      status: 'pending' as const,
      target: {
        entity_type: 'documents',
        entity_id: null,
        ref: null,
        title: 'Disaster Recovery Runbook',
      },
      changes: {
        title: {
          label: 'Title',
          from: null,
          to: 'Disaster Recovery Runbook',
          format: 'text' as const,
        },
      },
      requires_confirmation: true,
      actions: ['approve', 'reject'] as Array<'approve' | 'reject'>,
      summary: 'Create draft document "Disaster Recovery Runbook".',
      error_message: null,
      conversation_id: 'conversation-1',
      created_at: '2026-03-28T17:00:00.000Z',
      expires_at: '2026-03-28T17:10:00.000Z',
      approved_at: null,
      rejected_at: null,
      executed_at: null,
    };

    const { container } = renderWithTheme(
      <ChatMessageList
        messages={[
          {
            id: 'assistant-1',
            role: 'assistant',
            content: 'Assistant proposal body',
            toolResults: [
              {
                id: 'tool-1',
                name: 'create_document',
                result: preview,
              },
            ],
          },
        ]}
        previews={[preview]}
        onSend={() => undefined}
      />,
    );

    const text = container.textContent || '';
    expect(text.indexOf('Assistant proposal body')).toBeGreaterThanOrEqual(0);
    expect(text.indexOf('Assistant proposal body')).toBeLessThan(text.indexOf('Disaster Recovery Runbook'));
  });

  it('does not render before labels for creation previews with no prior values', () => {
    const preview = {
      preview_id: 'preview-1',
      tool_name: 'create_task' as const,
      status: 'pending' as const,
      target: {
        entity_type: 'tasks',
        entity_id: null,
        ref: null,
        title: 'New task',
      },
      changes: {
        title: {
          label: 'Title',
          from: null,
          to: 'New task',
          format: 'text' as const,
        },
        description: {
          label: 'Description',
          from: null,
          to: 'Task body',
          format: 'markdown' as const,
        },
      },
      requires_confirmation: true,
      actions: ['approve', 'reject'] as Array<'approve' | 'reject'>,
      summary: 'Create task "New task".',
      error_message: null,
      conversation_id: 'conversation-1',
      created_at: '2026-03-28T17:00:00.000Z',
      expires_at: '2026-03-28T17:10:00.000Z',
      approved_at: null,
      rejected_at: null,
      executed_at: null,
    };

    renderWithTheme(
      <ChatMessageList
        messages={[
          {
            id: 'assistant-1',
            role: 'assistant',
            content: '',
            toolResults: [
              {
                id: 'tool-1',
                name: 'create_task',
                result: preview,
              },
            ],
          },
        ]}
        previews={[preview]}
        onSend={() => undefined}
      />,
    );

    expect(screen.queryByText('ai:previewCard.before')).toBeNull();
    expect(screen.queryByText('ai:previewCard.after')).toBeNull();
  });

  it('groups multiple previews and sends an explicit batch approval marker', () => {
    const previews = Array.from({ length: 2 }, (_, index) => ({
      preview_id: `${index + 1}${index + 1}${index + 1}${index + 1}${index + 1}${index + 1}${index + 1}${index + 1}-${index + 1}${index + 1}${index + 1}${index + 1}-4${index + 1}${index + 1}${index + 1}-8${index + 1}${index + 1}${index + 1}-${index + 1}${index + 1}${index + 1}${index + 1}${index + 1}${index + 1}${index + 1}${index + 1}${index + 1}${index + 1}${index + 1}${index + 1}`,
      tool_name: 'update_task_assignee' as const,
      status: 'pending' as const,
      target: {
        entity_type: 'tasks',
        entity_id: `task-${index + 1}`,
        ref: `T-${index + 1}`,
        title: `Task ${index + 1}`,
      },
      changes: {
        assignee: {
          label: 'Assignee',
          from: 'Paul',
          to: 'Marie',
          format: 'text' as const,
        },
      },
      requires_confirmation: true,
      actions: ['approve', 'reject'] as Array<'approve' | 'reject'>,
      summary: `Reassign T-${index + 1}.`,
      error_message: null,
      conversation_id: 'conversation-1',
      created_at: '2026-03-28T17:00:00.000Z',
      expires_at: '2026-03-28T17:10:00.000Z',
      approved_at: null,
      rejected_at: null,
      executed_at: null,
    }));
    const onSend = vi.fn();

    renderWithTheme(
      <ChatMessageList
        messages={[
          {
            id: 'assistant-1',
            role: 'assistant',
            content: 'I prepared the reassignment previews.',
            toolResults: [{
              id: 'tool-1',
              name: 'update_task_assignees',
              result: {
                previews,
                errors: [],
                total: previews.length,
                created: previews.length,
                failed: 0,
                complete: true,
              },
            }],
          },
        ]}
        previews={previews}
        onSend={onSend}
      />,
    );

    expect(screen.getByText('previewBatch.title')).toBeInTheDocument();
    expect(screen.getByText('previewBatch.approveAll')).toBeInTheDocument();

    fireEvent.click(screen.getByText('previewBatch.approveAll'));
    fireEvent.click(screen.getAllByText('previewBatch.approveAll')[1]);

    expect(onSend).toHaveBeenCalledWith(`[APPROVE_SELECTED:${previews.map((preview) => preview.preview_id).join(',')}]`);
  });

  it('groups previews referenced by assistant previewIds without requiring inline tool results', () => {
    const previews = Array.from({ length: 2 }, (_, index) => ({
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
    const onOpenArtifact = vi.fn();

    renderWithTheme(
      <ChatMessageList
        messages={[
          {
            id: 'assistant-1',
            role: 'assistant',
            content: 'I prepared the task previews.',
            previewIds: previews.map((preview) => preview.preview_id),
          },
        ]}
        previews={previews}
        onSend={() => undefined}
        onOpenArtifact={onOpenArtifact}
      />,
    );

    expect(screen.getByText('previewBatch.title')).toBeInTheDocument();
    expect(screen.getByText('artifactPanel.chipLabel')).toBeInTheDocument();
    expect(screen.queryByText('previewBatch.approveAll')).toBeNull();

    const chip = screen.getByText('artifactPanel.chipLabel').closest('[role="button"]');
    expect(chip).not.toBeNull();
    fireEvent.click(chip!);

    expect(onOpenArtifact).toHaveBeenCalledWith(previews[0].preview_id);
  });

  it('renders assistant markdown links to internal task pages', () => {
    renderWithTheme(
      <ChatMessageList
        messages={[
          {
            id: 'assistant-1',
            role: 'assistant',
            content: 'Created [T-115](/portfolio/tasks/task-115) from ticket #59925.',
          },
        ]}
        previews={[]}
        onSend={() => undefined}
      />,
    );

    const link = screen.getByRole('link', { name: 'T-115' });
    expect(link.getAttribute('href')).toBe('/portfolio/tasks/task-115');
  });

  it('links the references cited in an assistant answer, outside code and existing links', () => {
    readableResources = null;
    const { container } = renderWithTheme(
      <ChatMessageList
        messages={[
          {
            id: 'assistant-1',
            role: 'assistant',
            content: [
              'APP-36 runs on AST-4 (INT-7) at LOC-2 over CONN-9 and costs BL-113; see INC-26, T-8, PRJ-5, REQ-2, DOC-12, TEC-3 and CTR-4.',
              '',
              'Inline `APP-99`, already linked [T-115](/portfolio/tasks/task-115), CVE-2026-1234, XAPP-1, APP-1x and the server part APP-01.',
              '',
              '```',
              'INC-77',
              '```',
            ].join('\n'),
          },
        ]}
        previews={[]}
        onSend={() => undefined}
      />,
    );

    const hrefOf = (name: string) => screen.getByRole('link', { name }).getAttribute('href');
    expect(hrefOf('APP-36')).toBe('/it/applications/APP-36');
    expect(hrefOf('AST-4')).toBe('/it/assets/AST-4');
    expect(hrefOf('INT-7')).toBe('/it/interfaces/INT-7');
    expect(hrefOf('BL-113')).toBe('/ops/budget/BL-113');
    expect(hrefOf('INC-26')).toBe('/it/incidents/INC-26');
    expect(hrefOf('LOC-2')).toBe('/it/locations/LOC-2');
    expect(hrefOf('CONN-9')).toBe('/it/connections/CONN-9');
    expect(hrefOf('T-8')).toBe('/portfolio/tasks/T-8');
    expect(hrefOf('PRJ-5')).toBe('/portfolio/projects/PRJ-5');
    expect(hrefOf('REQ-2')).toBe('/portfolio/requests/REQ-2');
    expect(hrefOf('DOC-12')).toBe('/knowledge/DOC-12');
    expect(hrefOf('TEC-3')).toBe('/it/technologies/TEC-3');
    expect(hrefOf('CTR-4')).toBe('/portfolio/contributors/CTR-4');
    expect(hrefOf('T-115')).toBe('/portfolio/tasks/task-115');
    expect(screen.getAllByRole('link')).toHaveLength(14);
    expect(container.querySelector('code')?.textContent).toBe('APP-99');
    expect(container.querySelector('pre')?.textContent).toContain('INC-77');
    expect(container.textContent).toContain('CVE-2026-1234');
    // No KANAP reference starts with 0: APP-01 is part of a name.
    expect(screen.queryByRole('link', { name: 'APP-01' })).not.toBeInTheDocument();
  });

  it('leaves as text the references of pages the person cannot open', () => {
    readableResources = ['applications'];
    try {
      renderWithTheme(
        <ChatMessageList
          messages={[{ id: 'assistant-1', role: 'assistant', content: 'APP-36 is funded by BL-113 and hosted at LOC-2 (CTR-4).' }]}
          previews={[]}
          onSend={() => undefined}
        />,
      );
      expect(screen.getByRole('link', { name: 'APP-36' })).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'BL-113' })).toBeNull();
      expect(screen.queryByRole('link', { name: 'LOC-2' })).toBeNull();
      expect(screen.queryByRole('link', { name: 'CTR-4' })).toBeNull();
    } finally {
      readableResources = null;
    }
  });

  it('always renders a status row for assistant messages', () => {
    const { container } = renderWithTheme(
      <ChatMessageList
        messages={[
          {
            id: 'assistant-1',
            role: 'assistant',
            content: 'Hello.',
          },
        ]}
        previews={[]}
        onSend={() => undefined}
      />,
    );

    const text = container.textContent || '';
    expect(text).toContain('activity.phases.finalizing');
    expect(text).toContain('activity.summaryWithTools');
  });

  it('keeps tool calls inside the expanded activity panel', () => {
    const { container } = renderWithTheme(
      <ChatMessageList
        messages={[
          {
            id: 'assistant-1',
            role: 'assistant',
            content: 'Here are the tasks.',
            toolCalls: [
              {
                id: 'tool-1',
                name: 'query_entities',
                arguments: { entity_type: 'tasks', filters: { status: ['in_progress'] } },
              },
            ],
            toolResults: [
              {
                id: 'tool-1',
                name: 'query_entities',
                result: {
                  items: [{ id: 'task-1', type: 'tasks', ref: 'T-1', label: 'Task' }],
                  total: 1,
                },
              },
            ],
            activity: [
              { phase: 'analyzing', status: 'running' },
              { phase: 'searching_entities', status: 'running', tool_name: 'query_entities' },
              { phase: 'searching_entities', status: 'completed', tool_name: 'query_entities' },
              { phase: 'finalizing', status: 'completed' },
            ],
          },
        ]}
        previews={[]}
        onSend={() => undefined}
      />,
    );

    expect(container.textContent || '').not.toContain('toolResults.toolNames.query_entities');

    fireEvent.click(screen.getByText('activity.phases.finalizing'));

    expect(container.textContent || '').toContain('toolResults.toolNames.query_entities');
    expect(container.textContent || '').toContain('messageList.toolCallResults');
  });

  it('renders dev debug trace latency inside the expanded activity panel', () => {
    const { container } = renderWithTheme(
      <ChatMessageList
        messages={[
          {
            id: 'assistant-1',
            role: 'assistant',
            content: 'Here are the tasks.',
            activity: [
              { phase: 'analyzing', status: 'running' },
              { phase: 'finalizing', status: 'completed' },
            ],
            debugTrace: [
              { name: 'context_prepared', elapsed_ms: 90 },
              { name: 'provider_request_started', elapsed_ms: 100, iteration: 1 },
              { name: 'provider_first_tool_delta', elapsed_ms: 180, iteration: 1, tool_name: 'query_entities' },
              { name: 'provider_tool_call_completed', elapsed_ms: 250, iteration: 1, tool_name: 'query_entities' },
              { name: 'tool_execution_started', elapsed_ms: 260, iteration: 1, tool_name: 'query_entities' },
              { name: 'tool_execution_completed', elapsed_ms: 320, iteration: 1, tool_name: 'query_entities' },
              { name: 'assistant_text_started', elapsed_ms: 520, iteration: 2 },
            ],
          },
        ]}
        previews={[]}
        onSend={() => undefined}
      />,
    );

    expect(container.textContent || '').not.toContain('activity.sections.debugTrace');

    fireEvent.click(screen.getByText('activity.phases.finalizing'));

    expect(container.textContent || '').toContain('activity.sections.debugTrace');
    expect(container.textContent || '').toContain('activity.debugTrace.segments.modelWait');
    expect(container.textContent || '').toContain('activity.debugTrace.segments.firstVisibleAnswer');
    expect(container.textContent || '').toContain('activity.debugTrace.names.provider_first_tool_delta');
  });

  it('replaces pending ticket import preview images with a placeholder message', () => {
    const preview = {
      preview_id: 'preview-1',
      tool_name: 'import_ticket' as const,
      status: 'pending' as const,
      target: {
        entity_type: 'tasks',
        entity_id: null,
        ref: null,
        title: 'Ticket import',
      },
      changes: {
        description: {
          label: 'Description',
          from: null,
          to: 'Before image\n\n[![ticket-image](/front/document.send.php?docid=41260&itemtype=Ticket&items_id=59925)](/front/document.send.php?docid=41260&itemtype=Ticket&items_id=59925)\n\nAfter image',
          format: 'markdown' as const,
        },
      },
      requires_confirmation: true,
      actions: ['approve', 'reject'] as Array<'approve' | 'reject'>,
      summary: 'Import ticket.',
      error_message: null,
      conversation_id: 'conversation-1',
      created_at: '2026-03-28T17:00:00.000Z',
      expires_at: '2026-03-28T17:10:00.000Z',
      approved_at: null,
      rejected_at: null,
      executed_at: null,
    };

    const { container } = renderWithTheme(
      <ChatMessageList
        messages={[
          {
            id: 'assistant-1',
            role: 'assistant',
            content: '',
            toolResults: [
              {
                id: 'tool-1',
                name: 'import_ticket',
                result: preview,
              },
            ],
          },
        ]}
        previews={[preview]}
        onSend={() => undefined}
      />,
    );

    expect(container.textContent || '').toContain('ai:previewCard.pendingInlineImage');
    expect(container.querySelector('img')).toBeNull();
  });
});
