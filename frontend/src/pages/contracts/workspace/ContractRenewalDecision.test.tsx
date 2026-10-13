import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';

// A stable `t` that shows its options, so the tests read which values each sentence receives.
const i18n = vi.hoisted(() => {
  const t = (key: string, options?: Record<string, unknown>) => (options ? `${key} ${JSON.stringify(options)}` : key);
  return { t, i18n: { language: 'en', resolvedLanguage: 'en' } };
});
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => i18n,
}));
vi.mock('../../../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import api from '../../../api';
import ContractRenewalDecision, { type ContractRenewal } from './ContractRenewalDecision';

const mocked = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };

const TERM = { term_end: '2027-06-30', deadline: '2026-12-30', renews_on: '2027-07-01', next_term_end: '2028-06-30', days_left: 78 };
const PENDING: ContractRenewal = {
  decision_window_days: 90,
  proposed_end_date: '2027-06-30',
  notice_period_months: 6,
  state: 'pending',
  renegotiating: false,
  term: TERM,
  duration_months: 12,
  decision: null,
  can_undo: false,
  task: { id: 't-1', item_number: 142, status: 'open', assignee_name: 'Thomas Berger' },
  impact: {
    currency: 'EUR',
    commitments: [{ year: 2027, before: 350000, after: 175000 }, { year: 2028, before: 350000, after: 0 }],
    applications: [{ id: 'a-1', name: 'SAP S/4HANA' }],
    assets: [{ id: 's-1', name: 'sap-prd-db01' }],
  },
};
const decided = (decision: 'renew' | 'terminate', canUndo = true): ContractRenewal => ({
  ...PENDING,
  state: 'decided',
  impact: null,
  can_undo: canUndo,
  task: { ...PENDING.task!, status: 'done' },
  decision: { decision, reason: 'Best offer', decided_at: '2026-10-12T09:00:00.000Z', decided_by_name: 'Thomas Berger' },
});

function renderBox(state: ContractRenewal, canDecide = true, onDecided = vi.fn()) {
  mocked.get.mockResolvedValue({ data: state });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter>
          <ContractRenewalDecision contractId="c-1" startDate="2023-07-01" canDecide={canDecide} onDecided={onDecided} />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return onDecided;
}

describe('ContractRenewalDecision', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The ends offered are checked against today: a fixed day keeps these dates ahead.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-13T10:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the decision awaited, its deadline, the task and what happens without a decision', async () => {
    renderBox(PENDING);
    expect(await screen.findByText('contracts.renewal.title')).toBeInTheDocument();
    const box = screen.getByTestId('contract-renewal-decision');
    expect(box).toHaveTextContent('contracts.renewal.dueBefore {"date":"30 Dec 2026"}');
    expect(box).toHaveTextContent('contracts.deadlines.inDays {"count":78}');
    expect(screen.getByRole('link', { name: 'T-142' })).toHaveAttribute('href', '/portfolio/tasks/T-142/overview');
    expect(box).toHaveTextContent('contracts.renewal.taskFor {"name":"Thomas Berger"}');
    expect(box).toHaveTextContent('contracts.renewal.withoutDecision {"count":12,"date":"1 Jul 2027"}');
    expect(mocked.get).toHaveBeenCalledWith('/contracts/c-1/renewal');
  });

  it('renews with the justification, then shows the decision on one line', async () => {
    mocked.post.mockResolvedValue({ data: decided('renew') });
    const onDecided = renderBox(PENDING);
    fireEvent.change(await screen.findByRole('textbox', { name: 'contracts.renewal.reasonLabel' }), { target: { value: ' Best offer ' } });
    fireEvent.click(screen.getByRole('button', { name: 'contracts.renewal.renew' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/contracts/c-1/renewal/renew', { reason: 'Best offer' }));
    expect(await screen.findByText(/contracts\.renewal\.renewedBy/)).toHaveTextContent('{"date":"12 Oct 2026","name":"Thomas Berger"}');
    expect(screen.getByTestId('contract-renewal-decision')).toHaveTextContent('contracts.renewal.renewsOn {"date":"1 Jul 2027"}');
    expect(onDecided).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'contracts.renewal.renew' })).toBeNull();
  });

  it('asks to confirm a termination in the box, with its consequences', async () => {
    mocked.post.mockResolvedValue({ data: decided('terminate') });
    renderBox(PENDING);
    fireEvent.click(await screen.findByRole('button', { name: 'contracts.renewal.terminate' }));
    const consequences = screen.getByTestId('contract-renewal-consequences');
    expect(consequences).toHaveTextContent('contracts.renewal.consequenceEnd {"date":"30 Jun 2027"}');
    expect(consequences).toHaveTextContent('contracts.renewal.consequenceCommitment {"year":2027,"before":"350 000","after":"175 000","currency":"EUR"}');
    expect(consequences).toHaveTextContent('contracts.renewal.consequenceNoCommitment {"year":2028,"before":"350 000","currency":"EUR"}');
    expect(consequences).toHaveTextContent('contracts.renewal.consequenceApplications {"count":1,"names":"SAP S/4HANA"}');
    expect(consequences).toHaveTextContent('contracts.renewal.consequenceAssets {"count":1,"names":"sap-prd-db01"}');
    expect(mocked.post).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.cancel' }));
    expect(screen.queryByTestId('contract-renewal-consequences')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'contracts.renewal.terminate' }));
    fireEvent.click(screen.getByRole('button', { name: 'contracts.renewal.confirmTerminate' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/contracts/c-1/renewal/terminate', { reason: null, end_date: '2027-06-30' }));
    expect(await screen.findByText(/contracts\.renewal\.terminatedBy/)).toBeInTheDocument();
    expect(screen.getByText(/contracts\.renewal\.noticeHint/)).toHaveTextContent('{"date":"30 Dec 2026"}');
  });

  it('proposes the end the notice allows, takes another day with a warning before it, and its consequences', async () => {
    const early = { currency: 'EUR', commitments: [{ year: 2026, before: 350000, after: 300000 }], applications: [], assets: [] };
    mocked.post.mockResolvedValue({ data: { ...decided('terminate'), decision: { ...decided('terminate').decision!, end_date: '2026-11-15' } } });
    renderBox(PENDING);
    mocked.get.mockImplementation(async (_url: string, options?: { params?: { end_date?: string } }) => (
      options?.params?.end_date ? { data: { ...PENDING, impact: early } } : { data: PENDING }
    ));
    fireEvent.click(await screen.findByRole('button', { name: 'contracts.renewal.terminate' }));
    expect(screen.getByText('contracts.endChoice.earliest {"count":6,"date":"30 Jun 2027"}')).toBeInTheDocument();
    expect(screen.queryByTestId('contract-end-warning')).toBeNull();
    const input = screen.getByPlaceholderText('labels.datePlaceholder');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '15/11/2026' } });
    fireEvent.blur(input);
    expect(screen.getByTestId('contract-end-warning')).toHaveTextContent('contracts.endChoice.beforeAllowed');
    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith('/contracts/c-1/renewal', { params: { end_date: '2026-11-15' } }));
    const consequences = await screen.findByTestId('contract-renewal-consequences');
    expect(consequences).toHaveTextContent('contracts.renewal.consequenceEnd {"date":"15 Nov 2026"}');
    await waitFor(() => expect(consequences).toHaveTextContent('{"year":2026,"before":"350 000","after":"300 000","currency":"EUR"}'));

    // A day before today is refused on the spot.
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '01/10/2026' } });
    fireEvent.blur(input);
    expect(screen.getByText('contracts.endChoice.tooEarly {"date":"13 Oct 2026"}')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'contracts.renewal.confirmTerminate' })).toBeDisabled();

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '15/11/2026' } });
    fireEvent.blur(input);
    fireEvent.click(screen.getByRole('button', { name: 'contracts.renewal.confirmTerminate' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/contracts/c-1/renewal/terminate', { reason: null, end_date: '2026-11-15' }));
    expect(await screen.findByText(/contracts\.renewal\.endsOn \{"date":"15 Nov 2026"\}/)).toBeInTheDocument();
  });

  it('asks to renew or let end a contract without renewal whose end is near', async () => {
    const END_TERM = { ...TERM, term_end: '2027-03-31', deadline: '2027-03-31', end_date: '2027-03-31', renews_on: '2027-04-01', next_term_end: '2030-03-31' };
    const endPending: ContractRenewal = { ...PENDING, mode: 'end', term: END_TERM, impact: null };
    mocked.post.mockResolvedValue({
      data: { ...endPending, state: 'decided', can_undo: true, decision: { decision: 'end', reason: null, decided_at: '2026-10-13T09:00:00.000Z', decided_by_name: 'Thomas Berger', end_date: '2027-03-31' } },
    });
    renderBox(endPending);
    expect(await screen.findByText('contracts.renewal.endTitle {"date":"31 Mar 2027"}')).toBeInTheDocument();
    expect(screen.getByText('contracts.renewal.endWithoutDecision {"date":"31 Mar 2027"}')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'contracts.renewal.terminate' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'contracts.renewal.renegotiate' })).toBeNull();
    expect(screen.getByRole('button', { name: 'contracts.renewal.renew' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'contracts.renewal.letEnd' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/contracts/c-1/renewal/end', { reason: null }));
    expect(await screen.findByText(/contracts\.renewal\.endConfirmedBy/)).toBeInTheDocument();
    expect(screen.getByText(/contracts\.renewal\.endsOn \{"date":"31 Mar 2027"\}/)).toBeInTheDocument();
  });

  it('undoes a decision while its deadline has not passed', async () => {
    mocked.post.mockResolvedValue({ data: PENDING });
    renderBox(decided('terminate'));
    fireEvent.click(await screen.findByRole('button', { name: 'contracts.renewal.undo' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/contracts/c-1/renewal/undo', { reason: null }));
    expect(await screen.findByText('contracts.renewal.title')).toBeInTheDocument();
  });

  it('offers no undo once the deadline has passed', async () => {
    renderBox(decided('renew', false));
    expect(await screen.findByText(/contracts\.renewal\.renewedBy/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'contracts.renewal.undo' })).toBeNull();
  });

  it('keeps the task open while renegotiating: no second renegotiation', async () => {
    renderBox({ ...PENDING, renegotiating: true });
    expect(await screen.findByText('contracts.renewal.renegotiating')).toBeInTheDocument();
    expect(screen.getByText('contracts.renewal.renegotiatingHint')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'contracts.renewal.renegotiate' })).toBeNull();
    expect(screen.getByRole('button', { name: 'contracts.renewal.renew' })).toBeInTheDocument();
  });

  it('shows the decision awaited without actions to a reader', async () => {
    renderBox(PENDING, false);
    expect(await screen.findByText('contracts.renewal.title')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('shows nothing when no decision is due', async () => {
    renderBox({ ...PENDING, state: 'none', term: null, impact: null, task: null });
    await waitFor(() => expect(mocked.get).toHaveBeenCalled());
    expect(screen.queryByTestId('contract-renewal-decision')).toBeNull();
  });
});
