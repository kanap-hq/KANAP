import '../../i18n';
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MenuItem, TextField } from '@mui/material';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api', () => ({ default: { post: vi.fn() } }));
const notify = vi.hoisted(() => vi.fn());
vi.mock('../notify/NotifyProvider', () => ({ useNotify: () => notify }));

import api from '../../api';
import { createAppTheme } from '../../config/ThemeContext';
import BulkEditDialog, { BULK_EDIT_TIMEOUT_MS, type BulkEditField } from './BulkEditDialog';

const post = vi.mocked(api.post);

/** A picker: one button per value. */
const picker = (values: string[]) => ({ value, onChange, label, disabled }: { value: string | null; onChange: (v: string | null) => void; label: string; disabled?: boolean }) => (
  <div aria-label={label} data-value={value ?? ''}>
    {/* What a picker shows: the label of its value. */}
    <input aria-label={`${label} shown`} readOnly value={value ? `Name of ${value}` : ''} />
    {values.map((v) => <button type="button" key={v} disabled={disabled} onClick={() => onChange(v)}>{`pick ${v}`}</button>)}
  </div>
);

const FIELDS: BulkEditField[] = [
  { key: 'supplier_id', label: 'Supplier', optional: true, render: picker(['s-1', 's-2']), changes: (value) => ({ supplier_id: value }) },
  { key: 'account_id', label: 'Account', optional: false, render: picker(['a-1']), changes: (value) => ({ account_id: value }) },
  {
    key: 'analytics_values',
    label: 'Dimension value',
    optional: (axisId) => axisId !== 'required-axis',
    first: { label: 'Dimension', render: picker(['axis-1', 'required-axis']) },
    render: ({ first, ...props }) => picker([`${first}-v1`])(props),
    changes: (value, axisId) => ({ analytics_values: { [axisId!]: value } }),
  },
];

const COUNT = { dry_run: true, rows: 10, changes: 6, unchanged: 2, refused: { account_chart: 1, not_found: 1 }, as_of: '2026-11-12T10:00:00.000Z', fingerprint: 'f'.repeat(64) };

function renderDialog(props: Partial<React.ComponentProps<typeof BulkEditDialog>> = {}) {
  const onDone = vi.fn();
  const onClose = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = (open: boolean, selection: Record<string, unknown> = { ids: ['l-1', 'l-2'] }) => (
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={client}>
          <BulkEditDialog
            open={open}
            onClose={onClose}
            endpoint="/budget-lines/bulk-update"
            selection={selection as any}
            fields={FIELDS}
            onDone={onDone}
            {...props}
          />
      </QueryClientProvider>
    </ThemeProvider>
  );
  const { rerender } = render(ui(true));
  return {
    onDone,
    onClose,
    setOpen: (open: boolean) => rerender(ui(open)),
    setSelection: (selection: Record<string, unknown>) => rerender(ui(true, selection)),
  };
}

const status = () => screen.getByRole('status');
const save = () => screen.getByRole('button', { name: /^Change/ });
const chooseField = async (label: string) => {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Field' }));
  fireEvent.click(await screen.findByRole('option', { name: label }));
};

describe('BulkEditDialog', () => {
  beforeEach(() => {
    post.mockReset();
    notify.mockReset();
  });

  it('opens afresh: no count of the previous opening\'s value, until a value is picked', async () => {
    post.mockResolvedValue({ data: COUNT });
    const { setOpen } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'pick s-1' }));
    await waitFor(() => expect(status().textContent).toContain('6 rows will change'));
    expect(post).toHaveBeenCalledTimes(1);
    setOpen(false);
    setOpen(true);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(post).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('combobox', { name: 'Field' })).toHaveTextContent('Supplier');
    expect(screen.queryByRole('status')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'pick s-2' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[1][1]).toMatchObject({ changes: { supplier_id: 's-2' }, dry_run: true });
  });

  it('counts nothing before a value is picked, then counts the picked value once', async () => {
    post.mockResolvedValue({ data: COUNT });
    renderDialog();
    expect(screen.queryByRole('status')).toBeNull();
    expect(post).not.toHaveBeenCalled();
    expect(save()).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'pick s-1' }));
    await waitFor(() => expect(status().textContent).toContain('6 rows will change'));
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(
      '/budget-lines/bulk-update',
      { ids: ['l-1', 'l-2'], changes: { supplier_id: 's-1' }, dry_run: true },
      { timeout: BULK_EDIT_TIMEOUT_MS },
    );
  });

  it('says the rows already holding the value and the refused ones by reason, an unknown code by a generic label', async () => {
    post.mockResolvedValue({ data: { ...COUNT, refused: { account_chart: 1, not_found: 2, mystery: 1 } } });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'pick s-1' }));
    await waitFor(() => expect(status().textContent).toContain('6 rows will change'));
    expect(status().textContent).toContain('2 already have this value');
    expect(status().textContent).toContain('4 refused:');
    const reasons = within(status()).getAllByRole('listitem').map((item) => item.textContent);
    expect(reasons).toEqual([
      "Account outside the company's chart of accounts: 1",
      'Not found: 2',
      'Other reason: 1',
    ]);
    expect(save()).toHaveTextContent('Change 6 rows');
    expect(save()).toBeEnabled();
  });

  it('leaves out the line of the rows already holding the value when there are none', async () => {
    post.mockResolvedValue({ data: { ...COUNT, unchanged: 0, refused: {} } });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'pick s-1' }));
    await waitFor(() => expect(status().textContent).toBe('6 rows will change'));
  });

  it('empties an optional field, and offers no empty for the account', async () => {
    post.mockResolvedValue({ data: COUNT });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Empty the field' }));
    expect(screen.getByTestId('bulk-edit-emptied')).toHaveTextContent('Empty');
    await waitFor(() => expect(post).toHaveBeenCalledWith('/budget-lines/bulk-update', expect.objectContaining({ changes: { supplier_id: null }, dry_run: true }), expect.anything()));
    // Again: back to the picker, nothing picked.
    fireEvent.click(screen.getByRole('button', { name: 'Empty the field' }));
    expect(screen.queryByTestId('bulk-edit-emptied')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    await chooseField('Account');
    expect(screen.queryByRole('button', { name: 'Empty the field' })).toBeNull();
  });

  it('asks the dimension, then its value, and empties a dimension only when it is not required', async () => {
    post.mockResolvedValue({ data: COUNT });
    renderDialog();
    await chooseField('Dimension value');
    expect(screen.queryByRole('button', { name: 'pick axis-1-v1' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'pick required-axis' }));
    expect(screen.queryByRole('button', { name: 'Empty the field' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'pick axis-1' }));
    expect(screen.getByRole('button', { name: 'Empty the field' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'pick axis-1-v1' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith(
      '/budget-lines/bulk-update',
      expect.objectContaining({ changes: { analytics_values: { 'axis-1': 'axis-1-v1' } }, dry_run: true }),
      expect.anything(),
    ));
  });

  it('confirms with the count instant, rows and fingerprint, then says what changed and what was refused', async () => {
    post.mockResolvedValueOnce({ data: COUNT });
    post.mockResolvedValueOnce({ data: { dry_run: false, rows: 10, changed: 6, unchanged: 2, refused: { account_chart: 1, not_found: 1 } } });
    const { onDone } = renderDialog({ selection: { all: true, filters: { q: 'srv' }, exclude_ids: ['l-9'] } });
    fireEvent.click(screen.getByRole('button', { name: 'pick s-2' }));
    await waitFor(() => expect(save()).toBeEnabled());
    fireEvent.click(save());
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(post).toHaveBeenLastCalledWith(
      '/budget-lines/bulk-update',
      { all: true, filters: { q: 'srv' }, exclude_ids: ['l-9'], changes: { supplier_id: 's-2' }, as_of: COUNT.as_of, expected_rows: 10, fingerprint: COUNT.fingerprint },
      { timeout: BULK_EDIT_TIMEOUT_MS },
    );
    // The dialog stays, on the outcome of the write; no notice besides it.
    expect(notify).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('keeps the button off at zero rows to change', async () => {
    post.mockResolvedValue({ data: { ...COUNT, changes: 0, unchanged: 10, refused: {} } });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'pick s-1' }));
    await waitFor(() => expect(status().textContent).toContain('0 rows will change'));
    expect(save()).toHaveTextContent('Change 0 rows');
    expect(save()).toBeDisabled();
  });

  it('counts again after a 409 and says the list changed', async () => {
    post.mockResolvedValueOnce({ data: COUNT });
    post.mockRejectedValueOnce({ response: { status: 409, data: { code: 'bulk_list_changed' } } });
    post.mockResolvedValueOnce({ data: { ...COUNT, rows: 11, changes: 7 } });
    const { onDone } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'pick s-1' }));
    await waitFor(() => expect(save()).toBeEnabled());
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('The list changed since the count'));
    await waitFor(() => expect(status().textContent).toContain('7 rows will change'));
    expect(post).toHaveBeenCalledTimes(3);
    expect(post.mock.calls[2][1]).toMatchObject({ dry_run: true });
    expect(onDone).not.toHaveBeenCalled();
  });

  it('says another budget operation runs, at the count and at the write, in the words of the other operations', async () => {
    const running = { response: { status: 409, data: { code: 'operation_running', message: 'Another budget operation (…) is running for this workspace.' } } };
    post.mockRejectedValueOnce(running);
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'pick s-1' }));
    await waitFor(() => expect(status()).toHaveTextContent('Another budget operation is running. Try again when it has finished.'));
    expect(save()).toBeDisabled();
    post.mockResolvedValueOnce({ data: COUNT });
    post.mockRejectedValueOnce(running);
    fireEvent.click(screen.getByRole('button', { name: 'pick s-2' }));
    await waitFor(() => expect(save()).toBeEnabled());
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Another budget operation is running. Try again when it has finished.'));
    expect(screen.getByRole('alert')).not.toHaveTextContent('The list changed');
    // Not a change of the list: nothing is counted again.
    expect(post).toHaveBeenCalledTimes(3);
  });

  it('says the cap when the selection is too large', async () => {
    post.mockRejectedValue({ response: { status: 400, data: { code: 'bulk_too_many', message: 'These filters reach 6000 rows' } } });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'pick s-1' }));
    await waitFor(() => expect(status()).toHaveTextContent('More than 5,000 rows: narrow the filters, or select fewer rows.'));
    expect(save()).toBeDisabled();
  });

  it('shows the reason of a change refused as a whole', async () => {
    post.mockRejectedValue({ response: { status: 400, data: { message: 'This cost center is disabled.' } } });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'pick s-1' }));
    await waitFor(() => expect(status()).toHaveTextContent('This cost center is disabled.'));
    expect(save()).toBeDisabled();
  });

  it('shows the wait while counting and while writing; the dialog stays open and its pickers off while it writes', async () => {
    let answerCount: (value: unknown) => void = () => {};
    post.mockImplementationOnce(() => new Promise((resolve) => { answerCount = resolve; }));
    const { onClose, onDone } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'pick s-1' }));
    await waitFor(() => expect(status()).toHaveTextContent('Counting the rows…'));
    expect(status()).toHaveAttribute('aria-busy', 'true');
    expect(save()).toBeDisabled();
    await act(async () => { answerCount({ data: COUNT }); });
    await waitFor(() => expect(save()).toBeEnabled());
    let answerWrite: (value: unknown) => void = () => {};
    post.mockImplementationOnce(() => new Promise((resolve) => { answerWrite = resolve; }));
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByText('Saving the change…')).toBeInTheDocument());
    expect(save()).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'pick s-2' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Field' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: 'Empty the field' })).toBeDisabled();
    expect(post).toHaveBeenCalledTimes(2);
    await act(async () => { answerWrite({ data: { dry_run: false, rows: 10, changed: 6, unchanged: 4, refused: {} } }); });
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(notify).not.toHaveBeenCalled();
    expect(screen.getByTestId('bulk-edit-done')).toHaveTextContent('6 rows changed');
  });

  it.each([
    ['the proxy cut it (524)', { response: { status: 524, data: '' } }],
    ['a bad gateway', { response: { status: 502, data: '' } }],
    ['a gateway time out', { response: { status: 504, data: {} } }],
    ['a 503 without a code', { response: { status: 503, data: {} } }],
  ])('says that a write the proxy answered for may have gone through: %s', async (_case, failure) => {
    post.mockResolvedValueOnce({ data: COUNT });
    post.mockRejectedValueOnce(failure);
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'pick s-1' }));
    await waitFor(() => expect(save()).toBeEnabled());
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('The server did not answer. Reload the list to see whether the rows changed.'));
  });

  it('gives the reason of a 503 the server words itself', async () => {
    post.mockResolvedValueOnce({ data: COUNT });
    post.mockRejectedValueOnce({ response: { status: 503, data: { code: 'busy', message: 'Another change is running. Try again in a moment.' } } });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'pick s-1' }));
    await waitFor(() => expect(save()).toBeEnabled());
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('This data is busy with another operation.'));
    expect(screen.getByRole('alert')).not.toHaveTextContent('The server did not answer');
  });

  it('counts one value at a time: the values picked meanwhile wait, only the last one is counted, and an outdated count never shows', async () => {
    const answers: Array<(value: unknown) => void> = [];
    post.mockImplementation(() => new Promise((resolve) => { answers.push(resolve); }));
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'pick s-1' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'pick s-2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Empty the field' }));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    // Still the first count alone.
    expect(post).toHaveBeenCalledTimes(1);
    await act(async () => { answers[0]({ data: { ...COUNT, changes: 3 } }); });
    // Its answer is not the value shown: never shown, and the last value is counted (s-2 is dropped).
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[1][1]).toMatchObject({ changes: { supplier_id: null }, dry_run: true });
    expect(status()).toHaveTextContent('Counting the rows…');
    expect(status().textContent).not.toContain('3 rows will change');
    expect(save()).toBeDisabled();
    await act(async () => { answers[1]({ data: { ...COUNT, changes: 8 } }); });
    await waitFor(() => expect(status().textContent).toContain('8 rows will change'));
    expect(save()).toHaveTextContent('Change 8 rows');
    expect(save()).toBeEnabled();
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('stays open once written, on the outcome of the write: rows changed, already holding the value, refused by reason', async () => {
    post.mockResolvedValueOnce({ data: COUNT });
    post.mockResolvedValueOnce({ data: { dry_run: false, rows: 10, changed: 5, unchanged: 3, refused: { not_found: 1, account_chart: 1 } } });
    const { onDone, onClose, setSelection } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'pick s-2' }));
    await waitFor(() => expect(save()).toBeEnabled());
    fireEvent.click(save());
    const done = await screen.findByTestId('bulk-edit-done');
    expect(onDone).toHaveBeenCalledWith({ dry_run: false, rows: 10, changed: 5, unchanged: 3, refused: { not_found: 1, account_chart: 1 } });
    // The list clears its selection behind the outcome: nothing more is counted.
    setSelection({ ids: [] });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(post).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('bulk-edit-done')).toHaveTextContent('5 rows changed');
    expect(onClose).not.toHaveBeenCalled();
    // The write's numbers, in the count's sentences and order, the first one in the past.
    expect(done).toHaveTextContent('5 rows changed');
    expect(done).toHaveTextContent('Supplier: Name of s-2');
    expect(done).toHaveTextContent('3 already have this value');
    expect(done).toHaveTextContent('2 refused:');
    expect(within(done).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Not found: 1',
      "Account outside the company's chart of accounts: 1",
    ]);
    expect(done.textContent).not.toContain('6 rows');
    // Close alone: no picker, no confirmation, no Cancel; it has the focus, and closes.
    expect(screen.queryByRole('combobox', { name: 'Field' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'pick s-1' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Change/ })).toBeNull();
    const close = screen.getByRole('button', { name: 'Close' });
    await waitFor(() => expect(document.activeElement).toBe(close));
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('names the change by the choice before the value when the field asks it (a dimension), as the selects show them', async () => {
    const select = (options: Array<[string, string]>) => function Select({ value, onChange, label }: { value: string | null; onChange: (next: string | null) => void; label: string }) {
      return (
        <TextField select value={value ?? ''} onChange={(event) => onChange(event.target.value || null)} SelectProps={{ inputProps: { 'aria-label': label } }}>
          {options.map(([id, name]) => <MenuItem key={id} value={id}>{name}</MenuItem>)}
        </TextField>
      );
    };
    const fields: BulkEditField[] = [{
      key: 'analytics_values',
      label: 'Dimension value',
      optional: true,
      first: { label: 'Dimension', namesField: true, render: select([['axis-1', 'Region']]) },
      render: ({ first: _first, ...props }) => select([['v-1', 'North']])(props),
      changes: (value, axisId) => ({ analytics_values: { [axisId!]: value } }),
    }];
    post.mockResolvedValueOnce({ data: { ...COUNT, refused: {}, unchanged: 0 } });
    post.mockResolvedValueOnce({ data: { dry_run: false, rows: 6, changed: 6, unchanged: 0, refused: {} } });
    renderDialog({ fields });
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Dimension' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Region' }));
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Dimension value' }));
    fireEvent.click(await screen.findByRole('option', { name: 'North' }));
    await waitFor(() => expect(save()).toBeEnabled());
    fireEvent.click(save());
    expect((await screen.findByTestId('bulk-edit-done')).textContent).toBe('6 rows changedRegion: North');
  });

  it('says the outcome without refusals in one line, and opens afresh after it', async () => {
    post.mockResolvedValueOnce({ data: { ...COUNT, refused: {}, unchanged: 0 } });
    post.mockResolvedValueOnce({ data: { dry_run: false, rows: 6, changed: 6, unchanged: 0, refused: {} } });
    const { setOpen } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Empty the field' }));
    await waitFor(() => expect(save()).toBeEnabled());
    fireEvent.click(save());
    const done = await screen.findByTestId('bulk-edit-done');
    expect(done.textContent).toBe('6 rows changedSupplier: Empty');
    setOpen(false);
    setOpen(true);
    expect(screen.queryByTestId('bulk-edit-done')).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Field' })).toHaveTextContent('Supplier');
    expect(screen.queryByRole('status')).toBeNull();
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('says that a write without an answer may have gone through', async () => {
    post.mockResolvedValueOnce({ data: COUNT });
    post.mockRejectedValueOnce({ code: 'ECONNABORTED', message: 'timeout of 300000ms exceeded' });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'pick s-1' }));
    await waitFor(() => expect(save()).toBeEnabled());
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('The server did not answer. Reload the list to see whether the rows changed.'));
  });
});
