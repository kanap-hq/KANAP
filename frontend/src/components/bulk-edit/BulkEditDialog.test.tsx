import '../../i18n';
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
const picker = (values: string[]) => ({ value, onChange, label }: { value: string | null; onChange: (v: string | null) => void; label: string }) => (
  <div aria-label={label} data-value={value ?? ''}>
    {values.map((v) => <button type="button" key={v} onClick={() => onChange(v)}>{`pick ${v}`}</button>)}
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

const COUNT = { dry_run: true, rows: 10, changes: 6, unchanged: 2, refused: { account_chart: 1, not_found: 1 }, as_of: '2026-11-12T10:00:00.000Z' };

function renderDialog(props: Partial<React.ComponentProps<typeof BulkEditDialog>> = {}) {
  const onDone = vi.fn();
  const onClose = vi.fn();
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <BulkEditDialog
            open
            onClose={onClose}
            endpoint="/budget-lines/bulk-update"
            selection={{ ids: ['l-1', 'l-2'] }}
            fields={FIELDS}
            onDone={onDone}
            {...props}
          />
      </QueryClientProvider>
    </ThemeProvider>,
  );
  return { onDone, onClose };
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

  it('confirms with the count instant and rows, then says what changed and what was refused', async () => {
    post.mockResolvedValueOnce({ data: COUNT });
    post.mockResolvedValueOnce({ data: { dry_run: false, rows: 10, changed: 6, unchanged: 2, refused: { account_chart: 1, not_found: 1 } } });
    const { onDone } = renderDialog({ selection: { all: true, filters: { q: 'srv' }, exclude_ids: ['l-9'] } });
    fireEvent.click(screen.getByRole('button', { name: 'pick s-2' }));
    await waitFor(() => expect(save()).toBeEnabled());
    fireEvent.click(save());
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(post).toHaveBeenLastCalledWith(
      '/budget-lines/bulk-update',
      { all: true, filters: { q: 'srv' }, exclude_ids: ['l-9'], changes: { supplier_id: 's-2' }, as_of: COUNT.as_of, expected_rows: 10 },
      { timeout: BULK_EDIT_TIMEOUT_MS },
    );
    expect(notify).toHaveBeenCalledWith({ message: '6 rows changed, 2 refused' });
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

  it('shows the wait while counting and while writing; the dialog can be closed meanwhile', async () => {
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
    expect(onClose).toHaveBeenCalled();
    await act(async () => { answerWrite({ data: { dry_run: false, rows: 10, changed: 6, unchanged: 4, refused: {} } }); });
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(notify).toHaveBeenCalledWith({ message: '6 rows changed' });
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
