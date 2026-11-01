import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import ChatInput, { ChatInputHandle } from '../components/ChatInput';
import { aiSearchApi } from '../aiApi';
import { createAppTheme } from '../../config/ThemeContext';
// MentionPopover reaches i18n through aiApi. This file mocks aiApi, so load i18n itself.
import '../../i18n';

vi.mock('../aiApi', () => ({
  aiSearchApi: { searchEntities: vi.fn() },
}));

describe('ChatInput', () => {
  const theme = createAppTheme('light');
  const renderWithTheme = (ui: React.ReactElement) => render(
    <ThemeProvider theme={theme}>
      {ui}
    </ThemeProvider>,
  );

  it('submits trimmed text and clears the field', () => {
    const onSend = vi.fn();
    renderWithTheme(<ChatInput onSend={onSend} />);

    const input = screen.getByPlaceholderText(/Ask Plaid/);
    const sendButton = screen.getByRole('button');

    fireEvent.change(input, { target: { value: '  hello plaid  ' } });
    fireEvent.click(sendButton);

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('hello plaid');
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('does not submit when disabled', () => {
    const onSend = vi.fn();
    renderWithTheme(<ChatInput onSend={onSend} disabled />);

    const input = screen.getByPlaceholderText(/Ask Plaid/);
    const sendButton = screen.getByRole('button');

    expect(sendButton).toBeDisabled();
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', charCode: 13 });
    fireEvent.click(sendButton);

    expect(onSend).not.toHaveBeenCalled();
  });

  it('opens the application picker when a suggestion ends on @APP-', async () => {
    HTMLElement.prototype.scrollTo = vi.fn();
    vi.mocked(aiSearchApi.searchEntities).mockResolvedValue([]);
    const ref = React.createRef<ChatInputHandle>();
    renderWithTheme(<ChatInput ref={ref} onSend={vi.fn()} />);

    await act(async () => {
      ref.current?.setText('Résume une application @APP-');
    });

    await waitFor(() => expect(aiSearchApi.searchEntities).toHaveBeenCalledWith('', expect.objectContaining({
      entityTypes: ['applications'],
    })));
    expect(screen.getByPlaceholderText(/Ask Plaid/)).toHaveValue('Résume une application @APP-');
  });
});
