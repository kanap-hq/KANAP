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
    /**
     * The date the list sorts on and its state (`next_due_date`, `term_state`), with the default
     * decision window of 90 days and no decision recorded: a contract without renewal whose end is
     * within the window is to decide (lot CR2, round 2).
     */
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
      next_due_date: '2024-02-28', term_state: 'to_decide' },
  },
  {
    name: 'starts on 31 March for 1 month: 31 brought back to 30',
    today: '2026-03-31', start: '2026-03-31', months: 1, notice: 0, renewal: false,
    expected: { term_index: 0, current_term_end: '2026-04-29', next_cancellation_deadline: '2026-04-29', cancellation_deadline: '2026-04-29', renews_at_term_end: false,
      next_due_date: '2026-04-29', term_state: 'to_decide' },
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
      next_due_date: '2026-12-31', term_state: 'to_decide' },
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
      next_due_date: '2026-11-30', term_state: 'to_decide' },
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

/**
 * The decisions recorded (lot CR2): the state of a contract given the latest decision recorded
 * for some of its terms (`renewalDecision` of the rule, keyed by the term's last day), worked out
 * by hand, with the default window of 90 days. With tacit renewal, a renewal confirmed for the
 * term of the next deadline takes the contract out of "to decide", any other term or decision
 * leaves the state as it was. Without it, the last term ending within the window is to decide
 * until a decision to let it end (`end`, `terminate`) is recorded for that term. The pure spec
 * and the parity spec check them.
 */
export type ContractDecisionCase = {
  name: string;
  today: string;
  start: string;
  months: number;
  notice: number;
  renewal: boolean;
  disabledAt?: string | null;
  /** The latest decision of each term, by its last day. */
  decisions: Record<string, string>;
  expected: 'to_decide' | 'in_progress' | 'renewed' | 'ending' | 'expired';
};

/** SAP Maintenance & Support in the demo data: fourth term from 1 July 2026, 6 months of notice, deadline 30 December 2026. */
const SAP_TERMS = { today: '2026-10-13', start: '2023-07-01', months: 12, notice: 6, renewal: true };
/** Quarterly terms, 1 month of notice: the current deadline (28 February) has passed, the next one (31 May) is within the window. */
const QUARTERLY = { today: '2026-03-15', start: '2026-01-01', months: 3, notice: 1, renewal: true };
/** Nearshore in the demo data: 36 months from 1 April 2024, no renewal, ends on 31 March 2027. */
const NEARSHORE_TERMS = { start: '2024-04-01', months: 36, notice: 3, renewal: false };

export const CONTRACT_DECISION_CASES: ContractDecisionCase[] = [
  { name: 'SAP, no decision: to decide', ...SAP_TERMS, decisions: {}, expected: 'to_decide' },
  { name: 'SAP, renewal confirmed for the current term: in progress', ...SAP_TERMS, decisions: { '2027-06-30': 'renew' }, expected: 'in_progress' },
  { name: 'SAP, a renegotiation only: to decide', ...SAP_TERMS, decisions: { '2027-06-30': 'renegotiate' }, expected: 'to_decide' },
  { name: 'SAP, renewal undone: to decide', ...SAP_TERMS, decisions: { '2027-06-30': 'undo' }, expected: 'to_decide' },
  { name: 'SAP, renewal confirmed for a past term only: to decide', ...SAP_TERMS, decisions: { '2026-06-30': 'renew' }, expected: 'to_decide' },
  { name: 'SAP, renewal confirmed for the next term only: to decide', ...SAP_TERMS, decisions: { '2028-06-30': 'renew' }, expected: 'to_decide' },
  { name: 'SAP outside the window (1 September): the confirmation changes nothing', ...SAP_TERMS, today: '2026-09-01', decisions: { '2027-06-30': 'renew' }, expected: 'in_progress' },
  { name: 'SAP ending with its term, renewal on: ending (not a contract without renewal)', ...SAP_TERMS, disabledAt: '2027-06-30T12:00:00.000Z', decisions: {}, expected: 'ending' },
  { name: 'SAP terminated (renewal off, ends 30 June 2027): ending', ...SAP_TERMS, renewal: false, disabledAt: '2027-06-30T12:00:00.000Z', decisions: { '2027-06-30': 'terminate' }, expected: 'ending' },
  { name: 'SAP renewal turned off, ends 30 June 2027, nothing decided: outside the window, ending', ...SAP_TERMS, renewal: false, disabledAt: '2027-06-30T12:00:00.000Z', decisions: {}, expected: 'ending' },
  { name: 'SAP renewal turned off, ends 15 November 2026, nothing decided: to decide', ...SAP_TERMS, renewal: false, disabledAt: '2026-11-15T12:00:00.000Z', decisions: {}, expected: 'to_decide' },
  { name: 'SAP renewal turned off, ends 15 November 2026, let end: ending', ...SAP_TERMS, renewal: false, disabledAt: '2026-11-15T12:00:00.000Z', decisions: { '2027-06-30': 'end' }, expected: 'ending' },
  { name: 'SAP renewal turned off, ends 15 November 2026, renewal undone: to decide', ...SAP_TERMS, renewal: false, disabledAt: '2026-11-15T12:00:00.000Z', decisions: { '2027-06-30': 'undo' }, expected: 'to_decide' },
  { name: 'Nearshore, 31 March 2027 not within 90 days of 13 October: ending', ...NEARSHORE_TERMS, today: '2026-10-13', decisions: {}, expected: 'ending' },
  { name: 'Nearshore on 1 January 2027: its end within the window, to decide', ...NEARSHORE_TERMS, today: '2027-01-01', decisions: {}, expected: 'to_decide' },
  { name: 'Nearshore on 1 January 2027, let end: ending', ...NEARSHORE_TERMS, today: '2027-01-01', decisions: { '2027-03-31': 'end' }, expected: 'ending' },
  { name: 'Nearshore on 1 January 2027, a renewal recorded for its term: still to decide (a renewal turns the renewal on)', ...NEARSHORE_TERMS, today: '2027-01-01', decisions: { '2027-03-31': 'renew' }, expected: 'to_decide' },
  { name: 'Nearshore after its end: expired', ...NEARSHORE_TERMS, today: '2027-04-01', decisions: {}, expected: 'expired' },
  { name: 'quarterly, no decision: to decide (next term)', ...QUARTERLY, decisions: {}, expected: 'to_decide' },
  { name: 'quarterly, renewal confirmed for the next term: renewed', ...QUARTERLY, decisions: { '2026-06-30': 'renew' }, expected: 'renewed' },
  { name: 'quarterly, renewal confirmed for the current term only: to decide', ...QUARTERLY, decisions: { '2026-03-31': 'renew' }, expected: 'to_decide' },
  { name: 'quarterly, renewal off up to 30 June: runs into the next term, renewed', ...QUARTERLY, renewal: false, disabledAt: '2026-06-30T12:00:00.000Z', decisions: {}, expected: 'renewed' },
];

/**
 * The commitment of a year (lot CB), each worked out by hand from the rule in
 * `contracts/contract-terms.ts`: the yearly amount prorated over the months the terms cover, a
 * month covered in part by the share of its days. The pure spec checks the TypeScript function,
 * the parity spec the SQL expression too.
 */
export type ContractCommitmentCase = {
  name: string;
  start: string;
  months: number | null;
  renewal: boolean;
  disabledAt?: string | null;
  amount: number | string;
  year: number;
  /** In the contract's currency. */
  expected: number;
};

const SAP = { start: '2023-07-01', months: 12, renewal: true, amount: 350000 };
const SAP_ENDED = { ...SAP, disabledAt: '2027-06-30T12:00:00.000Z' };
const NEARSHORE = { start: '2024-04-01', months: 36, renewal: false, amount: 900000 };
const FROM_THE_15TH = { start: '2026-03-15', months: 12, renewal: false, amount: 120000 };

export const CONTRACT_COMMITMENT_CASES: ContractCommitmentCase[] = [
  { name: 'SAP, renewed every July: a whole year', ...SAP, year: 2026, expected: 350000 },
  { name: 'SAP, renewal projected: the next year too', ...SAP, year: 2027, expected: 350000 },
  { name: 'SAP, renewal projected two years ahead', ...SAP, year: 2028, expected: 350000 },
  { name: 'SAP, first year from 1 July: six months', ...SAP, year: 2023, expected: 175000 },
  { name: 'SAP, before its start: nothing', ...SAP, year: 2022, expected: 0 },
  { name: 'SAP ended on 30 June 2027: 2026 unchanged', ...SAP_ENDED, year: 2026, expected: 350000 },
  { name: 'SAP ended on 30 June 2027: six months of 2027', ...SAP_ENDED, year: 2027, expected: 175000 },
  { name: 'SAP ended on 30 June 2027: nothing in 2028', ...SAP_ENDED, year: 2028, expected: 0 },
  { name: 'Nearshore, no renewal, ends 31 March 2027: three months of 2027', ...NEARSHORE, year: 2027, expected: 225000 },
  { name: 'Nearshore, a whole year inside the term', ...NEARSHORE, year: 2026, expected: 900000 },
  { name: 'Nearshore, nothing after its end', ...NEARSHORE, year: 2028, expected: 0 },
  // No renewal, an end of validity in its second term (lot CR2, round 2): its terms run up to it, January to September 2027.
  { name: 'Nearshore, no renewal, an end of validity on 30 September 2027: nine months of 2027', ...NEARSHORE, disabledAt: '2027-09-30T12:00:00.000Z', year: 2027, expected: 675000 },
  { name: 'Nearshore, no renewal, an end of validity on 30 September 2027: nothing in 2028', ...NEARSHORE, disabledAt: '2027-09-30T12:00:00.000Z', year: 2028, expected: 0 },
  // 17/31 of March and nine whole months: (9 + 17/31) / 12 of 120 000.
  { name: 'starts on 15 March: March prorated by its days', ...FROM_THE_15TH, year: 2026, expected: 95483.87 },
  // Two whole months and 14/31 of March: (2 + 14/31) / 12 of 120 000; both years add up to the amount.
  { name: 'starts on 15 March, no renewal: ends on 14 March of the next year', ...FROM_THE_15TH, year: 2027, expected: 24516.13 },
  // 15/29 of February 2024 and 14/31 of March: 0.9688 months of 12 000.
  { name: 'one month from 15 February of a leap year', start: '2024-02-15', months: 1, renewal: false, amount: 12000, year: 2024, expected: 968.85 },
  // Ten whole months and 15/30 of November: 10.5 months of 120 000.
  { name: 'end of validity on 15 November: half of November', start: '2025-01-01', months: 12, renewal: true, disabledAt: '2026-11-15T12:00:00.000Z', amount: 120000, year: 2026, expected: 105000 },
  { name: 'end of validity before the start: nothing', start: '2026-05-10', months: 12, renewal: true, disabledAt: '2026-01-01T12:00:00.000Z', amount: 1000, year: 2026, expected: 0 },
  { name: 'duration 0 with renewal on: no term to cover', start: '2026-05-10', months: 0, renewal: true, amount: 1000, year: 2026, expected: 0 },
  { name: 'no duration: no term to cover', start: '2026-05-10', months: null, renewal: false, amount: 1000, year: 2026, expected: 0 },
  { name: 'future contract: nothing before its start', start: '2027-03-15', months: 12, renewal: true, amount: 1000, year: 2026, expected: 0 },
  // A half cent rounds away from zero: 6 cents over one month of twelve.
  { name: 'half a cent rounds up', start: '2026-01-01', months: 1, renewal: false, amount: 0.06, year: 2026, expected: 0.01 },
  { name: 'half a cent rounds away from zero below zero', start: '2026-01-01', months: 1, renewal: false, amount: '-0.06', year: 2026, expected: -0.01 },
];

export type ContractCommitmentSweepRow = {
  start: string;
  months: number;
  renewal: boolean;
  disabledAt: string | null;
  amount: string;
  year: number;
};

/** Every combination of starts, durations, renewal, ends of validity, amounts and years. */
export function contractCommitmentSweep(): ContractCommitmentSweepRow[] {
  const starts = ['2024-01-31', '2024-02-29', '2023-03-31', '2024-01-01', '2023-08-30', '2025-12-31', '2024-05-15', '2023-11-30'];
  const months = [0, 1, 2, 3, 5, 11, 12, 13, 24, 36];
  const ends = [null, '2025-02-28T12:00:00.000Z', '2026-01-31T12:00:00.000Z', '2026-12-31T12:00:00.000Z', '2023-06-15T12:00:00.000Z', '2024-02-29T23:30:00.000Z'];
  const amounts = ['350000', '1234.56', '0.01', '99999999.99', '-777.77'];
  const years = [2023, 2024, 2025, 2026, 2027, 2028];
  const rows: ContractCommitmentSweepRow[] = [];
  for (const start of starts) {
    for (const m of months) {
      for (const renewal of [true, false]) {
        for (const disabledAt of ends) {
          for (const amount of amounts) {
            for (const year of years) rows.push({ start, months: m, renewal, disabledAt, amount, year });
          }
        }
      }
    }
  }
  return rows;
}
