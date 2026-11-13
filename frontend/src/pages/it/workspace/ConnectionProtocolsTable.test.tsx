import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../../i18n';
import { createAppTheme } from '../../../config/ThemeContext';

vi.mock('../../../hooks/useItOpsEnumOptions', () => ({
  default: () => ({ settings: { connectionTypes: [{ code: 'https', label: 'HTTPS', typicalPorts: '443' }, { code: 'ssh', label: 'SSH', typicalPorts: '22' }] } }),
}));

import ConnectionProtocolsTable, { type ConnectionProtocol } from './ConnectionProtocolsTable';

const PROTOCOLS: ConnectionProtocol[] = [
  { code: 'https', port_override: null },
  { code: 'ssh', port_override: '2222' },
];
const pause = (ms: number) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
const table = (props: Partial<React.ComponentProps<typeof ConnectionProtocolsTable>>) => (
  <ThemeProvider theme={createAppTheme('light')}>
    <ConnectionProtocolsTable protocols={PROTOCOLS} connectionKey="c1" editable {...props} />
  </ThemeProvider>
);
const portInput = (code: string) => screen.getAllByRole('textbox')[code === 'https' ? 0 : 1];

describe('ConnectionProtocolsTable ports waiting to be saved', () => {
  const onProtocolsChange = vi.fn();
  beforeEach(() => vi.clearAllMocks());

  it('saves the typed port once, with the whole set, when the table goes before the delay', async () => {
    const view = render(table({ onProtocolsChange }));
    fireEvent.change(portInput('https'), { target: { value: '84' } });
    fireEvent.change(portInput('https'), { target: { value: '8443' } });
    expect(onProtocolsChange).not.toHaveBeenCalled();
    view.unmount();
    expect(onProtocolsChange).toHaveBeenCalledTimes(1);
    expect(onProtocolsChange).toHaveBeenCalledWith([
      { code: 'https', port_override: '8443' },
      { code: 'ssh', port_override: '2222' },
    ]);
    await pause(1100);
    expect(onProtocolsChange).toHaveBeenCalledTimes(1);
  });

  it('saves nothing when the ports are back to the saved ones, or were never typed', async () => {
    const view = render(table({ onProtocolsChange }));
    fireEvent.change(portInput('ssh'), { target: { value: '22222' } });
    fireEvent.change(portInput('ssh'), { target: { value: '2222' } });
    view.unmount();
    render(table({ onProtocolsChange })).unmount();
    await pause(1100);
    expect(onProtocolsChange).not.toHaveBeenCalled();
  });

  it('does not save a second time when the delay already ran', async () => {
    const view = render(table({ onProtocolsChange }));
    fireEvent.change(portInput('https'), { target: { value: '8443' } });
    await pause(1100);
    expect(onProtocolsChange).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(onProtocolsChange).toHaveBeenCalledTimes(1);
  });

  it('saves the port with the callback of the connection it was typed on when the table shows another one', () => {
    const forFirst = vi.fn();
    const forSecond = vi.fn();
    const view = render(table({ connectionKey: 'c1', onProtocolsChange: forFirst }));
    fireEvent.change(portInput('https'), { target: { value: '8443' } });
    view.rerender(table({ connectionKey: 'c2', onProtocolsChange: forSecond }));
    expect(forFirst).toHaveBeenCalledTimes(1);
    expect(forSecond).not.toHaveBeenCalled();
  });
});
