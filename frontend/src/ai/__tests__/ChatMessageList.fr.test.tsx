import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChatMessageList from '../components/ChatMessageList';
import ArtifactPreviewChip from '../components/ArtifactPreviewChip';
import { createAppTheme } from '../../config/ThemeContext';
import i18n from '../../i18n';
import { AiMutationPreview } from '../aiTypes';

// The card's labels are covered by PreviewCard.test.tsx; here only the batch words matter.
vi.mock('../components/previewChangeLabels', () => ({
  usePreviewChangeLabels: () => ({
    fieldLabel: (_preview: unknown, field: string, label?: string | null) => label || field,
    valueLabel: (_preview: unknown, _field: string, value: string | null) => value,
  }),
}));

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: () => true }),
}));

const previews: AiMutationPreview[] = [1, 2, 3].map((index) => ({
  preview_id: `${index}${index}${index}${index}${index}${index}${index}${index}-${index}${index}${index}${index}-4${index}${index}${index}-8${index}${index}${index}-${index}${index}${index}${index}${index}${index}${index}${index}${index}${index}${index}${index}`,
  tool_name: 'update_task_status',
  status: 'pending',
  target: { entity_type: 'tasks', entity_id: `task-${index}`, ref: `T-${index}`, title: `Tâche ${index}` },
  changes: { status: { label: 'Status', from: 'Open', to: 'Done', format: 'text' } },
  requires_confirmation: true,
  actions: ['approve', 'reject'],
  summary: `Passer T-${index} à Terminé.`,
  error_message: null,
  conversation_id: 'conversation-1',
  created_at: '2026-10-27T10:00:00.000Z',
  expires_at: '2026-10-27T10:30:00.000Z',
  approved_at: null,
  rejected_at: null,
  executed_at: null,
}));

function renderWithTheme(ui: React.ReactElement) {
  return render(<ThemeProvider theme={createAppTheme('light')}>{ui}</ThemeProvider>);
}

describe('Preview batch in French', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('fr');
  });

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage('en');
  });

  it('counts and approves "aperçus", the word of the screens', () => {
    const onSend = vi.fn();
    renderWithTheme(
      <ChatMessageList
        messages={[{
          id: 'assistant-1',
          role: 'assistant',
          content: 'Voici les trois aperçus.',
          toolResults: [{
            id: 'tool-1',
            name: 'update_task_status',
            result: { previews, errors: [], total: 3, created: 3, failed: 0, complete: true },
          }],
        }]}
        previews={previews}
        onSend={onSend}
      />,
    );

    expect(screen.getByText('3 aperçus')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Tout approuver'));
    expect(screen.getByText('Approuver 3 aperçus ?')).toBeInTheDocument();
    expect(screen.queryByText(/previews?\b/)).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByText('Tout approuver')[1]);
    expect(onSend).toHaveBeenCalledWith(`[APPROVE_SELECTED:${previews.map((preview) => preview.preview_id).join(',')}]`);
  });

  it('words the status of a preview chip as the card does', () => {
    renderWithTheme(<ArtifactPreviewChip preview={{ ...previews[0], status: 'executed' }} onOpen={() => undefined} />);
    expect(screen.getByText('Appliqué')).toBeInTheDocument();
    expect(screen.queryByText('executed')).not.toBeInTheDocument();
    cleanup();

    renderWithTheme(<ArtifactPreviewChip preview={{ ...previews[0], status: 'rejected' }} onOpen={() => undefined} />);
    expect(screen.getByText('Rejeté')).toBeInTheDocument();
  });
});
