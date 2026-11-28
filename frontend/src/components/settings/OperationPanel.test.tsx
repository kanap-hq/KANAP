import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';

vi.mock('react-i18next', () => {
  const translation = { t: (key: string, options?: { count?: number }) => (typeof options?.count === 'number' ? `${key}:${options.count}` : key) };
  return { useTranslation: () => translation };
});
const confirm = vi.fn(async (_options: Record<string, unknown>) => true);
vi.mock('../design', () => ({ useKanapDialogs: () => ({ confirm }) }));

import { OperationPanel, type OperationPanelProps } from './OperationPanel';

const rows = Array.from({ length: 8 }, (_, i) => ({ id: `l${i}`, cells: { line: `Line ${i}`, amount: `${100 - i}` } }));

function renderPanel(props: Partial<OperationPanelProps> = {}) {
  const onRun = vi.fn(async () => undefined);
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <OperationPanel
        options={<label>Year<select aria-label="Year" /></label>}
        stats={[{ label: 'Lines', value: '12' }, { label: 'Lines with an amount', value: '8' }, { label: 'Total value', value: '740' }]}
        preview={{ columns: [{ key: 'line', label: 'Line' }, { key: 'amount', label: 'Budget 2026', align: 'right' }], rows, allLines: <button type="button">Show all</button> }}
        consequence="Clearing removes the amounts. This cannot be undone."
        exportSlot={<button type="button">Export</button>}
        {...props}
        action={{ label: 'Clear column', confirm: { title: 'Clear the Budget column of 2026?', message: '8 lines.' }, onRun, ...props.action }}
      />
    </ThemeProvider>,
  );
  return { onRun };
}

describe('OperationPanel', () => {
  beforeEach(() => {
    confirm.mockClear();
    confirm.mockResolvedValue(true);
  });

  it('shows the options, the three numbers, the first five lines, "and N more lines", the link to all and the export', () => {
    renderPanel();
    expect(screen.getByRole('combobox', { name: 'Year' })).toBeInTheDocument();
    expect(screen.getByText('Lines with an amount')).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(1 + 5 + 1);
    expect(within(table).getByText('Line 4')).toBeInTheDocument();
    expect(within(table).queryByText('Line 5')).not.toBeInTheDocument();
    expect(within(table).getByText('common:operationPanel.moreLines:3')).toBeInTheDocument();
    expect(within(table).getByRole('button', { name: 'Show all' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument();
    expect(screen.getByText('Clearing removes the amounts. This cannot be undone.')).toBeInTheDocument();
  });

  it('counts the lines beyond the five from the total the page gives', () => {
    renderPanel({ preview: { columns: [{ key: 'line', label: 'Line' }], rows: rows.slice(0, 5), total: 45 } });
    expect(screen.getByText('common:operationPanel.moreLines:40')).toBeInTheDocument();
  });

  it('asks first, with the verb on the confirmation button, then runs', async () => {
    const { onRun } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Clear column' }));
    await waitFor(() => expect(onRun).toHaveBeenCalledTimes(1));
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Clear the Budget column of 2026?',
      confirmLabel: 'Clear column',
      intent: 'danger',
    }));
  });

  it('runs nothing when the confirmation is cancelled', async () => {
    confirm.mockResolvedValueOnce(false);
    const { onRun } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Clear column' }));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(onRun).not.toHaveBeenCalled();
  });

  it('keeps the pill off when there is nothing to do, and says so in one sentence', () => {
    renderPanel({ stats: undefined, preview: undefined, consequence: undefined, message: 'The Revision column of 2026 holds no amount.', action: { label: 'Clear column', disabled: true, onRun: vi.fn() } });
    expect(screen.getByRole('button', { name: 'Clear column' })).toBeDisabled();
    expect(screen.getByText('The Revision column of 2026 holds no amount.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('writes the result beside the pill', () => {
    renderPanel({ result: { ok: true, message: '45 lines cleared.' } });
    const pill = screen.getByRole('button', { name: 'Clear column' });
    expect(pill.parentElement).toHaveTextContent('45 lines cleared.');
    expect(screen.getByRole('status')).toHaveTextContent('45 lines cleared.');
  });

  it('runs a main action without a question when the page asks none', async () => {
    const onRun = vi.fn();
    renderPanel({ action: { label: 'Copy', intent: 'primary', confirm: undefined, onRun } });
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(onRun).toHaveBeenCalledTimes(1));
    expect(confirm).not.toHaveBeenCalled();
  });
});
