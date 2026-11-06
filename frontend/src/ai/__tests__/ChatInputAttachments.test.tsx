import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import ChatInput from '../components/ChatInput';
import ChatMessageList from '../components/ChatMessageList';
import type { PendingAttachment } from '../useChat';
import { createAppTheme } from '../../config/ThemeContext';

vi.mock('../aiApi', () => ({
  aiSearchApi: { searchEntities: vi.fn() },
  aiConversationsApi: { buildAttachmentUrl: vi.fn() },
  streamChat: vi.fn(),
  ChatStreamRequestError: class extends Error {},
}));

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function renderInput(mode: 'light' | 'dark', props: Partial<React.ComponentProps<typeof ChatInput>> = {}) {
  const onAddFiles = vi.fn(() => ({ added: 1, rejected: 0 }));
  const view = render(
    <ThemeProvider theme={createAppTheme(mode)}>
      <ChatInput onSend={vi.fn()} onAddFiles={onAddFiles} attachmentLimit={8} {...props} />
    </ThemeProvider>,
  );
  const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
  return { onAddFiles, input };
}

describe.each(['light', 'dark'] as const)('spreadsheets attached to Plaid in %s mode', (mode) => {
  it('accepts .xlsx and .csv files next to images, and nothing else', () => {
    const { onAddFiles, input } = renderInput(mode);
    expect(input.accept).toContain('.xlsx');
    expect(input.accept).toContain('.csv');
    const files = [
      new File(['x'], 'apps.xlsx', { type: XLSX_TYPE }),
      new File(['a;b'], 'costs.csv', { type: '' }),
      new File(['x'], 'shot.png', { type: 'image/png' }),
      new File(['x'], 'notes.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
    ];
    fireEvent.change(input, { target: { files } });
    expect(onAddFiles).toHaveBeenCalledTimes(1);
    expect((onAddFiles.mock.calls[0] as unknown as [File[]])[0].map((file) => file.name)).toEqual(['apps.xlsx', 'costs.csv', 'shot.png']);
  });

  it('shows a pending spreadsheet as its name and size, removable', () => {
    const onRemoveAttachment = vi.fn();
    const pending: PendingAttachment = {
      localId: 'local-1',
      file: new File(['x'.repeat(2048)], 'apps.xlsx', { type: XLSX_TYPE }),
      kind: 'table',
      previewUrl: '',
    };
    renderInput(mode, { pendingAttachments: [pending], onRemoveAttachment });
    expect(screen.getByText('apps.xlsx')).toBeInTheDocument();
    expect(screen.getByText('2 KB')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove attachment' }));
    expect(onRemoveAttachment).toHaveBeenCalledWith('local-1');
  });

  it('leaves send disabled for an attachment alone and enables it with text', () => {
    const onSend = vi.fn();
    const pending: PendingAttachment = {
      localId: 'local-1',
      file: new File(['x'], 'apps.xlsx', { type: XLSX_TYPE }),
      kind: 'table',
      previewUrl: '',
    };
    renderInput(mode, { pendingAttachments: [pending], onSend });
    const send = screen.getByRole('button', { name: 'Send' });
    const field = screen.getByPlaceholderText(/Ask Plaid/);

    expect(send).toBeDisabled();
    fireEvent.click(send);
    fireEvent.keyDown(field, { key: 'Enter', code: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.change(field, { target: { value: '   ' } });
    expect(send).toBeDisabled();

    fireEvent.change(field, { target: { value: 'Here is the file' } });
    expect(send).toBeEnabled();
    fireEvent.click(send);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('Here is the file');
  });

  it('shows a sent spreadsheet by its name in the message', () => {
    render(
      <ThemeProvider theme={createAppTheme(mode)}>
        <ChatMessageList
          messages={[{
            id: 'm1',
            role: 'user',
            content: 'Here are my applications.',
            attachments: [{ id: 'a1', kind: 'table', mime_type: 'text/csv', size: 300, original_filename: 'apps.csv', preview_url: '/x' }],
          }]}
          previews={[]}
          onSend={vi.fn()}
        />
      </ThemeProvider>,
    );
    expect(screen.getByText('apps.csv')).toBeInTheDocument();
    expect(screen.getByText('300 B')).toBeInTheDocument();
  });
});
