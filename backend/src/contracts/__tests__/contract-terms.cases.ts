/**
 * The contract term cases, each with the values worked out by hand from the rule in
 * `contracts/contract-terms.ts`. The pure spec checks the TypeScript function on them, the
 * parity spec the SQL expressions too. The frontend copy of the rule is tested on the same
 * cases (`frontend/src/pages/contracts/contractTerms.test.ts`): change both together.
 */
export type ContractTermCase = {
  name: string;
  today: string;
  start: string;
  months: number | null;
  notice: number | null;
  renewal: boolean;
  /** The end of validity, as stored (a bare day is noon UTC). */
  disabledAt?: string | null;
  expected: {
    term_index: number;
    current_term_end: string;
    next_cancellation_deadline: string | null;
    cancellation_deadline: string;
    renews_at_term_end: boolean;
    /** The date the list sorts on and its state (`next_due_date`, `term_state`), with the default decision window of 90 days. */
    next_due_date: string | null;
    term_state: 'to_decide' | 'in_progress' | 'renewed' | 'ending' | 'expired';
  };
};

const TODAY = '2026-10-12';

export const CONTRACT_TERM_CASES: ContractTermCase[] = [
  {
    name: 'starts on 31 January for 1 month: the term ends on 27 February (31 brought back to 28)',
    today: TODAY, start: '2025-01-31', months: 1, notice: 0, renewal: false,
    expected: { term_index: 0, current_term_end: '2025-02-27', next_cancellation_deadline: null, cancellation_deadline: '2025-02-27', renews_at_term_end: false,
      next_due_date: null, term_state: 'expired' },
  },
  {
    name: 'starts on 31 January for 1 month, renewed: the second term starts on 28 February',
    today: '2025-02-28', start: '2025-01-31', months: 1, notice: 0, renewal: true,
    expected: { term_index: 1, current_term_end: '2025-03-30', next_cancellation_deadline: '2025-03-30', cancellation_deadline: '2025-03-30', renews_at_term_end: true,
      next_due_date: '2025-03-30', term_state: 'to_decide' },
  },
  {
    name: 'starts on 31 January 2024 for 1 month: 31 brought back to 29 (leap year)',
    today: '2024-01-31', start: '2024-01-31', months: 1, notice: 1, renewal: false,
    expected: { term_index: 0, current_term_end: '2024-02-28', next_cancellation_deadline: null, cancellation_deadline: '2024-01-28', renews_at_term_end: false,
      next_due_date: '2024-02-28', term_state: 'ending' },
  },
  {
    name: 'starts on 31 March for 1 month: 31 brought back to 30',
    today: '2026-03-31', start: '2026-03-31', months: 1, notice: 0, renewal: false,
    expected: { term_index: 0, current_term_end: '2026-04-29', next_cancellation_deadline: '2026-04-29', cancellation_deadline: '2026-04-29', renews_at_term_end: false,
      next_due_date: '2026-04-29', term_state: 'ending' },
  },
  {
    name: 'ends on 31 May, 3 months of notice: deadline on 28 February (CheeseTrack)',
    today: TODAY, start: '2024-06-01', months: 36, notice: 3, renewal: false,
    expected: { term_index: 0, current_term_end: '2027-05-31', next_cancellation_deadline: '2027-02-28', cancellation_deadline: '2027-02-28', renews_at_term_end: false,
      next_due_date: '2027-05-31', term_state: 'ending' },
  },
  {
    name: 'ends on 31 December, 6 months of notice: deadline on 30 June (Axians)',
    today: TODAY, start: '2025-01-01', months: 60, notice: 6, renewal: true,
    expected: { term_index: 0, current_term_end: '2029-12-31', next_cancellation_deadline: '2029-06-30', cancellation_deadline: '2029-06-30', renews_at_term_end: true,
      next_due_date: '2029-06-30', term_state: 'in_progress' },
  },
  {
    name: 'ends on 31 December, 3 months of notice, not renewed: deadline 30 September passed (Fromatech)',
    today: TODAY, start: '2026-01-01', months: 12, notice: 3, renewal: false,
    expected: { term_index: 0, current_term_end: '2026-12-31', next_cancellation_deadline: null, cancellation_deadline: '2026-09-30', renews_at_term_end: false,
      next_due_date: '2026-12-31', term_state: 'ending' },
  },
  {
    name: 'renewed, notice of the current term passed: the next term deadline',
    today: TODAY, start: '2025-01-01', months: 12, notice: 3, renewal: true,
    expected: { term_index: 1, current_term_end: '2026-12-31', next_cancellation_deadline: '2027-09-30', cancellation_deadline: '2027-09-30', renews_at_term_end: true,
      next_due_date: '2027-09-30', term_state: 'renewed' },
  },
  {
    name: 'starts on 29 February, renewed twice: anniversaries on 28 February',
    today: TODAY, start: '2024-02-29', months: 12, notice: 1, renewal: true,
    expected: { term_index: 2, current_term_end: '2027-02-27', next_cancellation_deadline: '2027-01-27', cancellation_deadline: '2027-01-27', renews_at_term_end: true,
      next_due_date: '2027-01-27', term_state: 'in_progress' },
  },
  {
    name: 'future contract: its first term',
    today: TODAY, start: '2027-03-15', months: 12, notice: 2, renewal: true,
    expected: { term_index: 0, current_term_end: '2028-03-14', next_cancellation_deadline: '2028-01-14', cancellation_deadline: '2028-01-14', renews_at_term_end: true,
      next_due_date: '2028-01-14', term_state: 'in_progress' },
  },
  {
    name: 'renewed three times (SAP Maintenance & Support)',
    today: TODAY, start: '2023-07-01', months: 12, notice: 3, renewal: true,
    expected: { term_index: 3, current_term_end: '2027-06-30', next_cancellation_deadline: '2027-03-30', cancellation_deadline: '2027-03-30', renews_at_term_end: true,
      next_due_date: '2027-03-30', term_state: 'in_progress' },
  },
  {
    name: 'notice longer than the term, renewed: a deadline two terms ahead',
    today: TODAY, start: '2026-01-01', months: 3, notice: 6, renewal: true,
    expected: { term_index: 3, current_term_end: '2026-12-31', next_cancellation_deadline: '2026-12-30', cancellation_deadline: '2026-12-30', renews_at_term_end: true,
      next_due_date: '2026-12-30', term_state: 'to_decide' },
  },
  {
    name: 'notice longer than the term, not renewed: the deadline falls before the start',
    today: TODAY, start: '2026-11-01', months: 1, notice: 2, renewal: false,
    expected: { term_index: 0, current_term_end: '2026-11-30', next_cancellation_deadline: null, cancellation_deadline: '2026-09-30', renews_at_term_end: false,
      next_due_date: '2026-11-30', term_state: 'ending' },
  },
  {
    name: 'duration 0 with renewal on: a single term of no length',
    today: TODAY, start: '2026-05-10', months: 0, notice: 1, renewal: true,
    expected: { term_index: 0, current_term_end: '2026-05-09', next_cancellation_deadline: null, cancellation_deadline: '2026-04-09', renews_at_term_end: false,
      next_due_date: null, term_state: 'expired' },
  },
  {
    name: 'no duration and no notice: a single term of no length',
    today: TODAY, start: '2026-05-10', months: null, notice: null, renewal: true,
    expected: { term_index: 0, current_term_end: '2026-05-09', next_cancellation_deadline: null, cancellation_deadline: '2026-05-09', renews_at_term_end: false,
      next_due_date: null, term_state: 'expired' },
  },
  {
    name: 'end of validity in the current term, before its deadline: no next deadline',
    today: TODAY, start: '2025-01-01', months: 12, notice: 1, renewal: true, disabledAt: '2026-11-15T12:00:00.000Z',
    expected: { term_index: 1, current_term_end: '2026-12-31', next_cancellation_deadline: null, cancellation_deadline: '2026-11-30', renews_at_term_end: false,
      next_due_date: '2026-11-15', term_state: 'ending' },
  },
  {
    name: 'end of validity in the current term, after its deadline',
    today: TODAY, start: '2025-01-01', months: 12, notice: 1, renewal: true, disabledAt: '2026-12-15T12:00:00.000Z',
    expected: { term_index: 1, current_term_end: '2026-12-31', next_cancellation_deadline: '2026-11-30', cancellation_deadline: '2026-11-30', renews_at_term_end: false,
      next_due_date: '2026-12-15', term_state: 'ending' },
  },
  {
    name: 'end of validity on the term end: no renewal after it',
    today: TODAY, start: '2025-01-01', months: 12, notice: 1, renewal: true, disabledAt: '2026-12-31T12:00:00.000Z',
    expected: { term_index: 1, current_term_end: '2026-12-31', next_cancellation_deadline: '2026-11-30', cancellation_deadline: '2026-11-30', renews_at_term_end: false,
      next_due_date: '2026-12-31', term_state: 'ending' },
  },
  {
    name: 'end of validity on the next term start: one more term',
    today: TODAY, start: '2025-01-01', months: 12, notice: 1, renewal: true, disabledAt: '2027-01-01T12:00:00.000Z',
    expected: { term_index: 1, current_term_end: '2026-12-31', next_cancellation_deadline: '2026-11-30', cancellation_deadline: '2026-11-30', renews_at_term_end: true,
      next_due_date: '2026-11-30', term_state: 'to_decide' },
  },
  {
    name: 'end of validity in the past: the renewals stop at its term',
    today: TODAY, start: '2022-01-01', months: 12, notice: 1, renewal: true, disabledAt: '2024-06-30T12:00:00.000Z',
    expected: { term_index: 2, current_term_end: '2024-12-31', next_cancellation_deadline: null, cancellation_deadline: '2024-11-30', renews_at_term_end: false,
      next_due_date: null, term_state: 'expired' },
  },
  {
    name: 'not renewed, ended: its only term',
    today: TODAY, start: '2020-03-01', months: 24, notice: 3, renewal: false,
    expected: { term_index: 0, current_term_end: '2022-02-28', next_cancellation_deadline: null, cancellation_deadline: '2021-11-28', renews_at_term_end: false,
      next_due_date: null, term_state: 'expired' },
  },
  {
    name: 'deadline today: still the next one',
    today: TODAY, start: '2025-11-13', months: 12, notice: 1, renewal: true,
    expected: { term_index: 0, current_term_end: '2026-11-12', next_cancellation_deadline: '2026-10-12', cancellation_deadline: '2026-10-12', renews_at_term_end: true,
      next_due_date: '2026-10-12', term_state: 'to_decide' },
  },
  {
    name: 'term start today: the new term',
    today: TODAY, start: '2025-10-12', months: 12, notice: 1, renewal: true,
    expected: { term_index: 1, current_term_end: '2027-10-11', next_cancellation_deadline: '2027-09-11', cancellation_deadline: '2027-09-11', renews_at_term_end: true,
      next_due_date: '2027-09-11', term_state: 'in_progress' },
  },
  {
    name: 'deadline on the last day of the decision window: to decide',
    today: TODAY, start: '2026-01-11', months: 12, notice: 0, renewal: true,
    expected: { term_index: 0, current_term_end: '2027-01-10', next_cancellation_deadline: '2027-01-10', cancellation_deadline: '2027-01-10', renews_at_term_end: true,
      next_due_date: '2027-01-10', term_state: 'to_decide' },
  },
  {
    name: 'deadline the day after the decision window: in progress',
    today: TODAY, start: '2026-01-12', months: 12, notice: 0, renewal: true,
    expected: { term_index: 0, current_term_end: '2027-01-11', next_cancellation_deadline: '2027-01-11', cancellation_deadline: '2027-01-11', renews_at_term_end: true,
      next_due_date: '2027-01-11', term_state: 'in_progress' },
  },
  {
    name: 'not renewed, starts later: ends at its term end',
    today: TODAY, start: '2027-01-01', months: 12, notice: 3, renewal: false,
    expected: { term_index: 0, current_term_end: '2027-12-31', next_cancellation_deadline: '2027-09-30', cancellation_deadline: '2027-09-30', renews_at_term_end: false,
      next_due_date: '2027-12-31', term_state: 'ending' },
  },
];

export type ContractTermSweepRow = {
  today: string;
  start: string;
  months: number;
  notice: number;
  renewal: boolean;
  disabledAt: string | null;
};

/**
 * Every combination of month-end starts, durations, notices, renewal, ends of validity and
 * days: the TypeScript rule, its SQL and the frontend copy must agree on each.
 */
export function contractTermSweep(): ContractTermSweepRow[] {
  const starts = ['2024-01-31', '2024-02-29', '2023-03-31', '2024-01-01', '2023-08-30', '2025-12-31', '2024-05-15', '2023-11-30'];
  const months = [0, 1, 2, 3, 5, 11, 12, 13, 24, 36];
  const notices = [0, 1, 2, 3, 6, 11, 12, 13, 25];
  const ends = [null, '2025-02-28T12:00:00.000Z', '2026-01-31T12:00:00.000Z', '2026-12-31T12:00:00.000Z', '2023-06-15T12:00:00.000Z'];
  const days = ['2024-02-29', '2025-01-30', '2026-10-12', '2026-12-31', '2022-01-01', '2027-03-01'];
  const rows: ContractTermSweepRow[] = [];
  for (const start of starts) {
    for (const m of months) {
      for (const notice of notices) {
        for (const renewal of [true, false]) {
          for (const disabledAt of ends) {
            for (const today of days) rows.push({ today, start, months: m, notice, renewal, disabledAt });
          }
        }
      }
    }
  }
  return rows;
}
