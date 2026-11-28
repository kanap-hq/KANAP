import React from 'react';
import '../../i18n';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { TextField } from '@mui/material';
import { describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../design';
import { confirmLeave, isLeaveGuarded } from '../../hooks/leaveGuard';
import { ConnectionCard, ConnectionSecretField, type ConnectionCardProps } from './ConnectionCard';
import { SettingField } from './SettingField';

const PASSED = { ok: true, tested_at: '2026-10-15T10:42:00.000Z' };
const FAILED = { ok: false, tested_at: '2026-10-16T09:00:00.000Z' };

function renderCard(props: Partial<ConnectionCardProps> = {}) {
  const view = (next: Partial<ConnectionCardProps>) => (
    <ThemeProvider theme={createAppTheme('light')}>
      <KanapDialogProvider>
        <ConnectionCard
          title="Example system"
          configured={false}
          dirty={false}
          onTest={() => undefined}
          onSave={() => undefined}
          {...next}
        >
          {({ locked }) => (
            <SettingField label="Address">
              {({ aria }) => (
                <TextField variant="standard" defaultValue="https://example.com" InputProps={{ readOnly: locked }} inputProps={{ 'aria-label': 'Address', ...aria }} />
              )}
            </SettingField>
          )}
        </ConnectionCard>
      </KanapDialogProvider>
    </ThemeProvider>
  );
  const result = render(view(props));
  return { ...result, rerender: (next: Partial<ConnectionCardProps>) => result.rerender(view(next)) };
}

describe('ConnectionCard', () => {
  it('says what is known of the connection, in order', () => {
    const { rerender } = renderCard();
    expect(screen.getByRole('status')).toHaveTextContent('Never tested');

    rerender({ configured: true });
    expect(screen.getByRole('status')).toHaveTextContent('Saved, not tested yet');

    rerender({ configured: true, storedTest: PASSED });
    expect(screen.getByRole('status')).toHaveTextContent(/^Last test passed on 15 Oct( 2026)? at /);

    // A change makes the stored result stale.
    rerender({ configured: true, storedTest: PASSED, dirty: true });
    expect(screen.getByRole('status')).toHaveTextContent('Changes not saved');

    // A test of the values on screen says how it went, with its cause or what the system answered.
    rerender({ configured: true, storedTest: PASSED, dirty: true, sessionTest: { ...FAILED, cause: 'The server could not be reached.' } });
    expect(screen.getByRole('status')).toHaveTextContent('The server could not be reached.');
    rerender({ configured: true, storedTest: PASSED, dirty: true, sessionTest: { ...FAILED, ok: true, detail: 'Version 4.1' } });
    expect(screen.getByRole('status')).toHaveTextContent(/^Last test passed on 16 Oct.* · Version 4\.1$/);

    // A session test older than the stored one gives way to it.
    rerender({ configured: true, storedTest: FAILED, sessionTest: { ...PASSED, detail: 'Old' } });
    expect(screen.getByRole('status')).toHaveTextContent(/^Last test failed on 16 Oct/);

    rerender({ configured: true, testing: true, sessionTest: FAILED });
    expect(screen.getByRole('status')).toHaveTextContent('Testing…');
    expect(screen.getByRole('button', { name: 'Test' })).toBeDisabled();

    rerender({ status: { tone: 'danger', text: 'Account disconnected' }, testing: true });
    expect(screen.getByRole('status')).toHaveTextContent('Account disconnected');
  });

  it('keeps Save off while nothing changed or the card refuses it', () => {
    const onSave = vi.fn();
    const { rerender } = renderCard({ onSave });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Test' })).toBeEnabled();

    rerender({ onSave, dirty: true });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledTimes(1);

    rerender({ onSave, dirty: true, saveDisabled: true });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    rerender({ onSave, dirty: true, saving: true });
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  });

  it('puts the card actions in place of Save', () => {
    renderCard({ actions: <button type="button">Disconnect</button> });
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Test' })).toBeInTheDocument();
  });

  it('shows values set in the configuration file read-only, with Test only', () => {
    renderCard({ source: 'file', fileHint: 'Remove the variable from the file to set it here.', dirty: true, actions: <button type="button">Disconnect</button> });
    expect(screen.getByText('Set in the configuration file')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Remove the variable from the file to set it here.' })).toBeInTheDocument();
    expect(screen.getByLabelText('Address')).toHaveAttribute('readonly');
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Disconnect' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Test' })).toBeEnabled();
    // Nothing on a file card can be lost by leaving.
    expect(isLeaveGuarded()).toBe(false);
  });

  it('shows one line instead of the fields while loading or after a failed load', () => {
    const { rerender } = renderCard({ loading: true });
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByLabelText('Address')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Test' })).not.toBeInTheDocument();
    rerender({ error: 'The connection could not be loaded.' });
    expect(screen.getByRole('alert')).toHaveTextContent('The connection could not be loaded.');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('asks before leaving a changed card', async () => {
    const { rerender, unmount } = renderCard();
    expect(isLeaveGuarded()).toBe(false);

    rerender({ dirty: true });
    expect(isLeaveGuarded()).toBe(true);
    let leave: Promise<boolean> = Promise.resolve(false);
    act(() => { leave = confirmLeave(); });
    expect(await screen.findByText('You have unsaved changes. Leave without saving?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Stay' }));
    await expect(leave).resolves.toBe(false);
    unmount();
    expect(isLeaveGuarded()).toBe(false);
  });
});

describe('ConnectionSecretField', () => {
  function renderSecret(props: Partial<React.ComponentProps<typeof ConnectionSecretField>> = {}) {
    const onChange = vi.fn();
    function Harness() {
      const [value, setValue] = React.useState('');
      return (
        <ConnectionSecretField
          label="API key"
          hint="In the system, Settings then API keys."
          stored
          value={value}
          onChange={(next) => { setValue(next); onChange(next); }}
          {...props}
        />
      );
    }
    render(<ThemeProvider theme={createAppTheme('light')}><Harness /></ThemeProvider>);
    return { onChange };
  }

  it('never reads a saved secret back: dots, greyed, and Replace opens the field', async () => {
    const { onChange } = renderSecret();
    expect(screen.getByLabelText('API key')).toBeDisabled();
    expect(screen.getByRole('img', { name: 'In the system, Settings then API keys.' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Replace API key' }));
    const input = screen.getByLabelText('API key');
    expect(input).toBeEnabled();
    expect(input).toHaveValue('');
    expect(input).toHaveAttribute('type', 'password');
    await waitFor(() => expect(input).toHaveFocus());
    fireEvent.change(input, { target: { value: 'new-key' } });
    expect(onChange).toHaveBeenCalledWith('new-key');
  });

  it('asks for the secret again when the address changed', () => {
    renderSecret({ addressChanged: true });
    expect(screen.queryByRole('button', { name: 'Replace API key' })).not.toBeInTheDocument();
    const input = screen.getByLabelText('API key');
    expect(input).toBeRequired();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('The address changed: enter it again.')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'typed' } });
    expect(screen.queryByText('The address changed: enter it again.')).not.toBeInTheDocument();
  });

  it('offers no Replace on a file card, and an open field when nothing is saved', () => {
    renderSecret({ locked: true });
    expect(screen.getByLabelText('API key')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Replace API key' })).not.toBeInTheDocument();
  });

  it('is an open field when nothing is saved', () => {
    renderSecret({ stored: false, placeholder: 'Paste the key' });
    expect(screen.getByPlaceholderText('Paste the key')).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Replace API key' })).not.toBeInTheDocument();
  });
});

