import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';

// A stable `t` (a new one per render would loop the effects): the key, then its values.
const i18n = vi.hoisted(() => {
  const t = (key: string, options?: Record<string, unknown>) => (options && Object.keys(options).length > 0 ? `${key} ${JSON.stringify(options)}` : key);
  return { t, i18n: { language: 'en', resolvedLanguage: 'en' } };
});
vi.mock('react-i18next', () => ({ useTranslation: () => i18n }));
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
// The pickers stand in as plain inputs: each sets its value as typed.
vi.mock('../fields/AccountSelect', () => ({
  default: ({ label, value, onChange, nature }: { label?: string; value: string | null; onChange: (v: string | null) => void; nature?: string }) => (
    <input aria-label={label} data-nature={nature} value={value ?? ''} onChange={(event) => onChange(event.target.value || null)} />
  ),
}));
vi.mock('../fields/AnalyticsCategorySelect', () => ({
  default: ({ label, value, onChange, lineType }: { label?: string; value: string | null; onChange: (v: string | null) => void; lineType?: string }) => (
    <input aria-label={label} data-line-type={lineType} value={value ?? ''} onChange={(event) => onChange(event.target.value || null)} />
  ),
}));

import api from '../../api';
import ChangeTypeDialog, { type ChangeTypeCheck } from './ChangeTypeDialog';

const mocked = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };

const LINE = 'line-1';
const BASE: ChangeTypeCheck = {
  id: LINE,
  reference: 'BL-12',
  row_version: 4,
  from_nature: 'opex',
  to_nature: 'capex',
  first_year: 2025,
  last_year: 2027,
  years: [2025, 2026, 2027],
  from_year: 2025,
  mode: 'in_place',
  dated_refusal: null,
  blockers: [],
  account: { id: 'acc-opex', account_number: 6100, account_name: 'Licences', fits: false, carried: false },
  dimensions: [
    { axis_id: 'axis-kind', axis_name: 'Investment kind', reason: 'required', required: false, current: null },
    { axis_id: 'axis-pool', axis_name: 'Cost pool', reason: 'value_other_type', required: false, current: { id: 'v-subs', name: 'Subscriptions' } },
  ],
  carried: { versions: 3, tasks: 1, attachments: 1, links: 1, contacts: 1 },
  successor: null,
};
const DATED: ChangeTypeCheck = {
  ...BASE,
  from_year: 2026,
  mode: 'dated',
  dimensions: [
    { axis_id: 'axis-kind', axis_name: 'Investment kind', reason: 'required', required: true, current: null },
    { axis_id: 'axis-pool', axis_name: 'Cost pool', reason: 'value_other_type', required: false, current: { id: 'v-subs', name: 'Subscriptions' } },
  ],
  carried: { ...BASE.carried, versions: 2, tasks: 0, attachments: 0, links: 0 },
};

function renderDialog(onChanged = vi.fn(), onClose = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <ChangeTypeDialog open nature="opex" lineId={LINE} lineReference="OPX-12" companyId="company-1" onClose={onClose} onChanged={onChanged} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { onChanged, onClose };
}

const saveButton = () => screen.getByRole('button', { name: 'ops:shared.changeType.save' });

describe('ChangeTypeDialog', () => {
  beforeEach(() => {
    mocked.get.mockReset();
    mocked.post.mockReset();
    mocked.get.mockImplementation(async (_url: string, config?: { params?: { from_year?: number } }) => ({
      data: config?.params?.from_year === 2026 ? DATED : BASE,
    }));
    mocked.post.mockResolvedValue({ data: { id: LINE, reference: 'BL-12', nature: 'capex' } });
  });

  it('changes the type in place: says what follows, asks nothing required, sends the row_version read', async () => {
    const { onChanged } = renderDialog();
    expect(await screen.findByText('ops:shared.changeType.effects.inPlace')).toBeInTheDocument();
    expect(screen.getByText('ops:shared.changeType.effects.reports.capex')).toBeInTheDocument();
    expect(mocked.get).toHaveBeenCalledWith(`/spend-items/${LINE}/change-type/check`, expect.objectContaining({ params: {} }));
    // The OPEX account does not fit: the field starts empty and says why; the pickers offer CAPEX values.
    const account = screen.getByLabelText('ops:shared.changeType.accountLabel');
    expect(account).toHaveValue('');
    expect(account).toHaveAttribute('data-nature', 'capex');
    expect(screen.getByText(/ops:shared\.changeType\.accountUnfit .*6100 - Licences/)).toBeInTheDocument();
    expect(screen.getByLabelText('Investment kind')).toHaveAttribute('data-line-type', 'capex');
    expect(screen.getByText(/ops:shared\.changeType\.valueOtherType .*Subscriptions/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('ops:shared.changeType.reasonLabel'), { target: { value: '  Bought outright  ' } });
    expect(saveButton()).toBeEnabled();
    fireEvent.click(saveButton());
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith({ id: LINE, reference: 'BL-12', nature: 'capex' }));
    expect(mocked.post).toHaveBeenCalledWith(`/spend-items/${LINE}/change-type`, {
      row_version: 4, from_year: null, analytics_values: {}, reason: 'Bought outright',
    });
  });

  it('from a later year: the required dimension of the new line must be chosen; the account is sent for the new line', async () => {
    const { onChanged } = renderDialog();
    await screen.findByText('ops:shared.changeType.effects.inPlace');
    fireEvent.mouseDown(screen.getByLabelText('ops:shared.changeType.fromLabel'));
    const listbox = await screen.findByRole('listbox');
    fireEvent.click(within(listbox).getByText(/ops:shared\.changeType\.fromYear .*"year":2026/));
    expect(await screen.findByText(/ops:shared\.changeType\.effects\.dated .*"count":2/)).toBeInTheDocument();
    expect(mocked.get).toHaveBeenLastCalledWith(`/spend-items/${LINE}/change-type/check`, expect.objectContaining({ params: { from_year: 2026 } }));
    expect(saveButton()).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Investment kind'), { target: { value: 'v-growth' } });
    await waitFor(() => expect(saveButton()).toBeEnabled());
    fireEvent.click(saveButton());
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(mocked.post).toHaveBeenCalledWith(`/spend-items/${LINE}/change-type`, {
      row_version: 4, from_year: 2026, analytics_values: { 'axis-kind': 'v-growth' }, account_id: null,
    });
  });

  it('in place, an account chosen is sent; the one the line keeps is not', async () => {
    mocked.get.mockResolvedValue({ data: { ...BASE, account: { ...BASE.account!, fits: true, id: 'acc-both' }, dimensions: [] } });
    renderDialog();
    const account = await screen.findByLabelText('ops:shared.changeType.accountLabel');
    await waitFor(() => expect(account).toHaveValue('acc-both'));
    fireEvent.click(saveButton());
    await waitFor(() => expect(mocked.post).toHaveBeenCalledTimes(1));
    expect(mocked.post.mock.calls[0][1]).not.toHaveProperty('account_id');
    fireEvent.change(account, { target: { value: 'acc-capex' } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(mocked.post).toHaveBeenCalledTimes(2));
    expect(mocked.post.mock.calls[1][1]).toMatchObject({ account_id: 'acc-capex' });
  });

  it('a frozen column refuses the change: it says which, the button stays off', async () => {
    mocked.get.mockResolvedValue({ data: { ...BASE, blockers: [{ year: 2026, column: 'budget', column_name: 'Budget', nature: 'opex' }] } });
    renderDialog();
    expect(await screen.findByText(/ops:shared\.changeType\.frozen .*"column":"Budget".*"year":2026.*"type":"OPEX"/)).toBeInTheDocument();
    expect(screen.getByText('ops:shared.changeType.frozenHelp')).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it('a line already replaced offers its first year only, and says why', async () => {
    mocked.get.mockResolvedValue({ data: { ...BASE, years: [2025], dated_refusal: 'successor', successor: { id: 'l2', reference: 'BL-40', nature: 'capex', from_year: 2026 } } });
    renderDialog();
    expect(await screen.findByText(/ops:shared\.changeType\.datedRefusal\.successor .*"reference":"BL-40"/)).toBeInTheDocument();
    expect(screen.queryByLabelText('ops:shared.changeType.fromLabel')).toBeNull();
    expect(screen.getByText(/ops:shared\.changeType\.fromFirstYear .*"year":2025/)).toBeInTheDocument();
  });

  it('shows the refusal of the server and keeps the dialog open', async () => {
    const message = 'This line has amounts in Budget 2026, a frozen OPEX column.';
    mocked.post.mockRejectedValueOnce(Object.assign(new Error('HTTP 409'), { response: { status: 409, data: { message, code: 'budget_frozen' } } }));
    const { onChanged } = renderDialog();
    await screen.findByText('ops:shared.changeType.effects.inPlace');
    fireEvent.click(saveButton());
    // The message of the server (the stand-in `t` shows it as the default of its code).
    expect(await screen.findByText(new RegExp(message))).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('a line changed since the dialog opened: says so and reads it again, the next save sends the new row_version', async () => {
    mocked.post.mockRejectedValueOnce(Object.assign(new Error('HTTP 409'), { response: { status: 409, data: { message: 'x', code: 'edit_conflict' } } }));
    const { onChanged } = renderDialog();
    await screen.findByText('ops:shared.changeType.effects.inPlace');
    const reads = mocked.get.mock.calls.length;
    mocked.get.mockResolvedValue({ data: { ...BASE, row_version: 5 } });
    fireEvent.click(saveButton());
    expect(await screen.findByText('ops:shared.changeType.changedMeanwhile')).toBeInTheDocument();
    await waitFor(() => expect(mocked.get.mock.calls.length).toBeGreaterThan(reads));
    await waitFor(() => expect(saveButton()).toBeEnabled());
    fireEvent.click(saveButton());
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(mocked.post.mock.calls[1][1]).toMatchObject({ row_version: 5 });
  });
});
