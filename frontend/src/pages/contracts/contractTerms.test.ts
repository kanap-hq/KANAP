import { describe, expect, it } from 'vitest';
import { addMonthsYmd, computeContractTerms } from './contractTerms';

// Copy of the backend case table (backend/src/contracts/__tests__/contract-terms.cases.ts),
// whose rule lives in backend/src/contracts/contract-terms.ts. Change both together. The
// backend spec contract-terms.spec.ts also compares this module with the backend function on a
// sweep of every month-end combination.

type TermCase = {
  name: string;
  today: string;
  start: string;
  months: number | null;
  notice: number | null;
  renewal: boolean;
  disabledAt?: string | null;
  expected: {
    term_index: number;
    current_term_end: string;
    next_cancellation_deadline: string | null;
    cancellation_deadline: string;
  };
};

const TODAY = '2026-10-12';

const CASES: TermCase[] = [
  {
    name: 'starts on 31 January for 1 month: the term ends on 27 February (31 brought back to 28)',
    today: TODAY, start: '2025-01-31', months: 1, notice: 0, renewal: false,
    expected: { term_index: 0, current_term_end: '2025-02-27', next_cancellation_deadline: null, cancellation_deadline: '2025-02-27' },
  },
  {
    name: 'starts on 31 January for 1 month, renewed: the second term starts on 28 February',
    today: '2025-02-28', start: '2025-01-31', months: 1, notice: 0, renewal: true,
    expected: { term_index: 1, current_term_end: '2025-03-30', next_cancellation_deadline: '2025-03-30', cancellation_deadline: '2025-03-30' },
  },
  {
    name: 'starts on 31 January 2024 for 1 month: 31 brought back to 29 (leap year)',
    today: '2024-01-31', start: '2024-01-31', months: 1, notice: 1, renewal: false,
    expected: { term_index: 0, current_term_end: '2024-02-28', next_cancellation_deadline: null, cancellation_deadline: '2024-01-28' },
  },
  {
    name: 'starts on 31 March for 1 month: 31 brought back to 30',
    today: '2026-03-31', start: '2026-03-31', months: 1, notice: 0, renewal: false,
    expected: { term_index: 0, current_term_end: '2026-04-29', next_cancellation_deadline: '2026-04-29', cancellation_deadline: '2026-04-29' },
  },
  {
    name: 'ends on 31 May, 3 months of notice: deadline on 28 February (CheeseTrack)',
    today: TODAY, start: '2024-06-01', months: 36, notice: 3, renewal: false,
    expected: { term_index: 0, current_term_end: '2027-05-31', next_cancellation_deadline: '2027-02-28', cancellation_deadline: '2027-02-28' },
  },
  {
    name: 'ends on 31 December, 6 months of notice: deadline on 30 June (Axians)',
    today: TODAY, start: '2025-01-01', months: 60, notice: 6, renewal: true,
    expected: { term_index: 0, current_term_end: '2029-12-31', next_cancellation_deadline: '2029-06-30', cancellation_deadline: '2029-06-30' },
  },
  {
    name: 'ends on 31 December, 3 months of notice, not renewed: deadline 30 September passed (Fromatech)',
    today: TODAY, start: '2026-01-01', months: 12, notice: 3, renewal: false,
    expected: { term_index: 0, current_term_end: '2026-12-31', next_cancellation_deadline: null, cancellation_deadline: '2026-09-30' },
  },
  {
    name: 'renewed, notice of the current term passed: the next term deadline',
    today: TODAY, start: '2025-01-01', months: 12, notice: 3, renewal: true,
    expected: { term_index: 1, current_term_end: '2026-12-31', next_cancellation_deadline: '2027-09-30', cancellation_deadline: '2027-09-30' },
  },
  {
    name: 'starts on 29 February, renewed twice: anniversaries on 28 February',
    today: TODAY, start: '2024-02-29', months: 12, notice: 1, renewal: true,
    expected: { term_index: 2, current_term_end: '2027-02-27', next_cancellation_deadline: '2027-01-27', cancellation_deadline: '2027-01-27' },
  },
  {
    name: 'future contract: its first term',
    today: TODAY, start: '2027-03-15', months: 12, notice: 2, renewal: true,
    expected: { term_index: 0, current_term_end: '2028-03-14', next_cancellation_deadline: '2028-01-14', cancellation_deadline: '2028-01-14' },
  },
  {
    name: 'renewed three times (SAP Maintenance & Support)',
    today: TODAY, start: '2023-07-01', months: 12, notice: 3, renewal: true,
    expected: { term_index: 3, current_term_end: '2027-06-30', next_cancellation_deadline: '2027-03-30', cancellation_deadline: '2027-03-30' },
  },
  {
    name: 'notice longer than the term, renewed: a deadline two terms ahead',
    today: TODAY, start: '2026-01-01', months: 3, notice: 6, renewal: true,
    expected: { term_index: 3, current_term_end: '2026-12-31', next_cancellation_deadline: '2026-12-30', cancellation_deadline: '2026-12-30' },
  },
  {
    name: 'notice longer than the term, not renewed: the deadline falls before the start',
    today: TODAY, start: '2026-11-01', months: 1, notice: 2, renewal: false,
    expected: { term_index: 0, current_term_end: '2026-11-30', next_cancellation_deadline: null, cancellation_deadline: '2026-09-30' },
  },
  {
    name: 'duration 0 with renewal on: a single term of no length',
    today: TODAY, start: '2026-05-10', months: 0, notice: 1, renewal: true,
    expected: { term_index: 0, current_term_end: '2026-05-09', next_cancellation_deadline: null, cancellation_deadline: '2026-04-09' },
  },
  {
    name: 'no duration and no notice: a single term of no length',
    today: TODAY, start: '2026-05-10', months: null, notice: null, renewal: true,
    expected: { term_index: 0, current_term_end: '2026-05-09', next_cancellation_deadline: null, cancellation_deadline: '2026-05-09' },
  },
  {
    name: 'end of validity in the current term, before its deadline: no next deadline',
    today: TODAY, start: '2025-01-01', months: 12, notice: 1, renewal: true, disabledAt: '2026-11-15T12:00:00.000Z',
    expected: { term_index: 1, current_term_end: '2026-12-31', next_cancellation_deadline: null, cancellation_deadline: '2026-11-30' },
  },
  {
    name: 'end of validity in the current term, after its deadline',
    today: TODAY, start: '2025-01-01', months: 12, notice: 1, renewal: true, disabledAt: '2026-12-15T12:00:00.000Z',
    expected: { term_index: 1, current_term_end: '2026-12-31', next_cancellation_deadline: '2026-11-30', cancellation_deadline: '2026-11-30' },
  },
  {
    name: 'end of validity on the term end: no renewal after it',
    today: TODAY, start: '2025-01-01', months: 12, notice: 1, renewal: true, disabledAt: '2026-12-31T12:00:00.000Z',
    expected: { term_index: 1, current_term_end: '2026-12-31', next_cancellation_deadline: '2026-11-30', cancellation_deadline: '2026-11-30' },
  },
  {
    name: 'end of validity on the next term start: one more term',
    today: TODAY, start: '2025-01-01', months: 12, notice: 1, renewal: true, disabledAt: '2027-01-01T12:00:00.000Z',
    expected: { term_index: 1, current_term_end: '2026-12-31', next_cancellation_deadline: '2026-11-30', cancellation_deadline: '2026-11-30' },
  },
  {
    name: 'end of validity in the past: the renewals stop at its term',
    today: TODAY, start: '2022-01-01', months: 12, notice: 1, renewal: true, disabledAt: '2024-06-30T12:00:00.000Z',
    expected: { term_index: 2, current_term_end: '2024-12-31', next_cancellation_deadline: null, cancellation_deadline: '2024-11-30' },
  },
  {
    name: 'not renewed, ended: its only term',
    today: TODAY, start: '2020-03-01', months: 24, notice: 3, renewal: false,
    expected: { term_index: 0, current_term_end: '2022-02-28', next_cancellation_deadline: null, cancellation_deadline: '2021-11-28' },
  },
  {
    name: 'deadline today: still the next one',
    today: TODAY, start: '2025-11-13', months: 12, notice: 1, renewal: true,
    expected: { term_index: 0, current_term_end: '2026-11-12', next_cancellation_deadline: '2026-10-12', cancellation_deadline: '2026-10-12' },
  },
  {
    name: 'term start today: the new term',
    today: TODAY, start: '2025-10-12', months: 12, notice: 1, renewal: true,
    expected: { term_index: 1, current_term_end: '2027-10-11', next_cancellation_deadline: '2027-09-11', cancellation_deadline: '2027-09-11' },
  },
];

describe('contract terms', () => {
  it('adds months the way PostgreSQL does', () => {
    expect(addMonthsYmd('2025-01-31', 1)).toBe('2025-02-28');
    expect(addMonthsYmd('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonthsYmd('2026-12-31', -3)).toBe('2026-09-30');
    expect(addMonthsYmd('2027-05-31', -3)).toBe('2027-02-28');
  });

  it.each(CASES.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const got = computeContractTerms(
      { start_date: c.start, duration_months: c.months, notice_period_months: c.notice, auto_renewal: c.renewal, disabled_at: c.disabledAt ?? null },
      c.today,
    );
    expect(got).toEqual({ ...c.expected, renewed: c.expected.term_index > 0 });
  });

  it('waits for a valid start date', () => {
    expect(computeContractTerms({ start_date: '', duration_months: 12 }, '2026-10-12')).toBeNull();
    expect(computeContractTerms({ start_date: '2026-1', duration_months: 12 }, '2026-10-12')).toBeNull();
  });
});
