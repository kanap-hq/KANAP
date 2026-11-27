import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import ChatInput, { ChatInputHandle } from '../components/ChatInput';
import { aiSearchApi } from '../aiApi';
import { createAppTheme } from '../../config/ThemeContext';
// MentionPopover reaches i18n through aiApi. This file mocks aiApi, so load i18n itself.
import '../../i18n';
import { AGENT_NAME } from '../../config/product';

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

    const input = screen.getByPlaceholderText(new RegExp(`Ask ${AGENT_NAME}`));
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

    const input = screen.getByPlaceholderText(new RegExp(`Ask ${AGENT_NAME}`));
    const sendButton = screen.getByRole('button');

    expect(sendButton).toBeDisabled();
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', charCode: 13 });
    fireEvent.click(sendButton);

    expect(onSend).not.toHaveBeenCalled();
  });

  // Each family whose page opens by its reference is linked by it; the others keep their id.
  const UUID = '0b6f8f2c-1f2a-4c1e-9f55-2f8a3c1d7e01';
  it.each([
    ['tasks', 'T-5', '/portfolio/tasks/T-5'],
    ['projects', 'PRJ-3', '/portfolio/projects/PRJ-3'],
    ['requests', 'REQ-2', '/portfolio/requests/REQ-2'],
    ['technologies', 'TEC-7', '/it/technologies/TEC-7'],
    ['documents', 'DOC-4', '/knowledge/DOC-4'],
    ['applications', 'APP-4', '/it/applications/APP-4'],
    ['assets', 'AST-9', '/it/assets/AST-9'],
    ['interfaces', 'INT-3', '/it/interfaces/INT-3'],
    ['incidents', 'INC-6', '/it/incidents/INC-6'],
    ['contracts', 'CTR-2', '/ops/contracts/CTR-2'],
    ['budget_lines', 'BL-8', '/ops/budget/BL-8'],
    ['companies', 'COMP-1', '/master-data/companies/COMP-1'],
    ['contacts', 'CTCT-2', '/master-data/contacts/CTCT-2'],
    ['departments', 'DEPT-4', '/master-data/departments/DEPT-4'],
    ['suppliers', 'SUP-3', '/master-data/suppliers/SUP-3'],
    ['contributors', 'MEM-2', '/portfolio/contributors/MEM-2'],
    ['locations', null, `/it/locations/${UUID}`],
    ['connections', null, `/it/connections/${UUID}`],
    ['business_processes', null, `/master-data/business-processes/${UUID}`],
  ])('links a mentioned record of %s by its reference when its page opens by it (%s)', async (entityType, ref, url) => {
    HTMLElement.prototype.scrollTo = vi.fn();
    const label = ref ? 'Picked record' : 'Lyon site';
    vi.mocked(aiSearchApi.searchEntities).mockResolvedValue([{ entity_type: entityType as string, id: UUID, ref: ref as string | null, label }]);
    const onSend = vi.fn();
    const handle = React.createRef<ChatInputHandle>();
    renderWithTheme(<ChatInput ref={handle} onSend={onSend} />);
    await act(async () => {
      handle.current?.setText('Summarise @pick');
    });
    fireEvent.click(await screen.findByRole('option'));
    const input = screen.getByPlaceholderText(new RegExp(`Ask ${AGENT_NAME}`));
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', charCode: 13 });
    expect(onSend).toHaveBeenCalledWith(`Summarise [${ref ?? label}](${url})`);
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
    expect(screen.getByPlaceholderText(new RegExp(`Ask ${AGENT_NAME}`))).toHaveValue('Résume une application @APP-');
  });
});
