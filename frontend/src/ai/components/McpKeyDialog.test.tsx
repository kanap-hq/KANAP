import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { McpKeyDialog, claudeCodeCommand, mcpEndpointUrl } from './McpKeyDialog';
import { createAppTheme } from '../../config/ThemeContext';
import api from '../../api';

vi.mock('../../api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

// Visibly fake: no test carries a real key.
const FAKE_KEY = 'kanap_mcp_FAKE_TEST_KEY_0000';
const RECORD = { id: 'key-1', label: 'Laptop', key_prefix: 'kanap_mc' };

function Harness({ onCreated }: { onCreated: (record: unknown) => void }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open</button>
      <McpKeyDialog open={open} onClose={() => setOpen(false)} onCreated={onCreated} />
    </>
  );
}

function renderDialog() {
  const onCreated = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={client}>
        <Harness onCreated={onCreated} />
      </QueryClientProvider>
    </ThemeProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Open' }));
  return { onCreated, client };
}

const consoleMethods = ['log', 'info', 'warn', 'error', 'debug'] as const;
let consoleSpies: Array<ReturnType<typeof vi.spyOn>> = [];

describe('McpKeyDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpies = consoleMethods.map((method) => vi.spyOn(console, method));
  });

  afterEach(() => {
    // The key never reaches a browser log.
    for (const spy of consoleSpies) {
      for (const call of spy.mock.calls) {
        expect(call.map((arg: unknown) => String(arg)).join(' ')).not.toContain(FAKE_KEY);
      }
      spy.mockRestore();
    }
  });

  it('keeps Create off while the label is empty', async () => {
    renderDialog();
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Create MCP API key')).toBeInTheDocument();
    const create = within(dialog).getByRole('button', { name: 'Create' });
    expect(create).toBeDisabled();
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Label' }), { target: { value: '   ' } });
    expect(create).toBeDisabled();
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Label' }), { target: { value: 'Laptop' } });
    expect(create).toBeEnabled();
  });

  it('shows a refusal inside the dialog and keeps the label', async () => {
    (api.post as any).mockRejectedValueOnce({ response: { status: 403, data: { message: 'Missing required permission ai_mcp:reader.' } } });
    const { onCreated } = renderDialog();
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Label' }), { target: { value: 'Laptop' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('You do not have the rights for this action.');
    expect(within(dialog).getByRole('textbox', { name: 'Label' })).toHaveValue('Laptop');
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('shows the key and the Claude Code command once, with a single Done button', async () => {
    (api.post as any).mockResolvedValueOnce({ data: { key: FAKE_KEY, record: RECORD } });
    const { onCreated, client } = renderDialog();
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Label' }), { target: { value: ' Laptop ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));

    expect(await within(dialog).findByDisplayValue(FAKE_KEY)).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/ai/keys', { label: 'Laptop' });
    const endpoint = mcpEndpointUrl(window.location.origin);
    expect(within(dialog).getByDisplayValue(claudeCodeCommand(endpoint, FAKE_KEY))).toBeInTheDocument();
    expect(within(dialog).getByText('Key created')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Copy key' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Copy command' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Done' })).toBeInTheDocument();
    // The caller gets the record, never the key.
    expect(onCreated).toHaveBeenCalledWith(RECORD);
    // The answer is not kept in the mutation cache.
    await waitFor(() => expect(JSON.stringify(client.getMutationCache().getAll().map((m) => m.state))).not.toContain(FAKE_KEY));

    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('closes on Escape, like Cancel', async () => {
    renderDialog();
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Label' }), { target: { value: 'Laptop' } });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.post).not.toHaveBeenCalled();
  });

  it('opens empty again after a key was shown', async () => {
    (api.post as any).mockResolvedValueOnce({ data: { key: FAKE_KEY, record: RECORD } });
    renderDialog();
    let dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Label' }), { target: { value: 'Laptop' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    await within(dialog).findByDisplayValue(FAKE_KEY);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByDisplayValue(FAKE_KEY)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Create MCP API key')).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'Label' })).toHaveValue('');
    expect(within(dialog).queryByDisplayValue(FAKE_KEY)).not.toBeInTheDocument();
  });
});
