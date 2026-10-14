import { addMonthsYmd, computeContractTerms, type ContractTerms, type ContractTermsInput } from './contractTerms';

/**
 * What the contract page says about a contract's deadlines, from the term rule of
 * `contractTerms.ts` (the API's `contract-terms.ts`): the state sentence, the facts line and the
 * timeline of its terms. Pure, so the page recomputes it while the user edits the dates.
 */

/**
 * Days before a cancellation deadline when the decision is due: the timeline draws this window
 * and the state turns orange inside it. Each tenant sets its own window; the contract comes with
 * it (`decision_window_days`). This default only stands in while the contract loads.
 */
export const DECISION_WINDOW_DAYS = 90;

const DAY_MS = 86_400_000;

function dayNumber(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

function addDays(ymd: string, days: number): string {
  return new Date((dayNumber(ymd) + days) * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

function wholeMonths(value: number | null | undefined): number {
  const n = Math.trunc(Number(value ?? 0));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function endOfValidityYmd(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

export type DeadlineState =
  /** Renewing, and the current term can still be cancelled. `urgent`: inside the decision window. */
  | { kind: 'cancel'; deadline: string; days: number; urgent: boolean }
  /** Renewing, the current term's notice has passed: the contract runs one more term. */
  | { kind: 'renewed'; renewedUntil: string; nextDeadline: string | null }
  /** Renewing, its renewal confirmed for the term of the next deadline: the term after it runs. */
  | { kind: 'confirmed'; nextStart: string; nextEnd: string }
  /** No renewal after the current term: the contract ends with it. `decisionDue`: renewal off, its end within the window, nothing decided. */
  | { kind: 'ends'; end: string; days: number; decisionDue?: boolean }
  /** The last term is over. */
  | { kind: 'expired'; end: string }
  /** No term to show (no duration). */
  | { kind: 'none' };

export type TermSegment = {
  /** 1 for the first term. */
  number: number;
  start: string;
  end: string;
  /** `next`: the term after the current one once its notice has passed (it will run); `projected`: while it can still be cancelled. */
  kind: 'past' | 'current' | 'upcoming' | 'next' | 'projected';
};

export type ScheduleTimeline = {
  /** First and last day drawn; every position is a fraction of that span. */
  from: string;
  to: string;
  segments: TermSegment[];
  today: string;
  /** The next cancellation deadline, when it falls in the span. */
  deadline: string | null;
  /** The decision window before that deadline, clipped to the span. */
  window: { start: string; end: string } | null;
  /** 1 January of the years inside the span. */
  years: string[];
};

export type ContractSchedule = {
  terms: ContractTerms;
  state: DeadlineState;
  /** 1 for the first term. */
  termNumber: number;
  termStart: string;
  termEnd: string;
  /** The current term is the last one (no renewal after it). */
  lastTerm: boolean;
  /** Times the contract was renewed until today. */
  renewals: number;
  startDate: string;
  noticeMonths: number;
  /** The contract has not started yet. */
  upcoming: boolean;
  timeline: ScheduleTimeline | null;
};

/**
 * A renewal decided for a term (`GET /contracts/:id/renewal`, a decided renewal): its last day,
 * the first day of the next term and that term's last day.
 */
export type ConfirmedRenewal = { term_end: string; renews_on: string; next_term_end: string };

/** At most this many terms before the current one on the timeline. */
const PAST_TERMS_SHOWN = 3;
const MAX_YEAR_TICKS = 8;

export function fraction(timeline: Pick<ScheduleTimeline, 'from' | 'to'>, ymd: string): number {
  const span = Math.max(1, daysBetween(timeline.from, timeline.to));
  return Math.min(1, Math.max(0, daysBetween(timeline.from, ymd) / span));
}

/**
 * The schedule of a contract as of `today`; null while the start date is not a valid day. With
 * `confirmed`, a renewal decided for the term of the next deadline: the state says so, and the
 * timeline draws neither that deadline nor its window.
 */
export function contractSchedule(
  input: ContractTermsInput,
  today: string,
  windowDays: number | null | undefined = DECISION_WINDOW_DAYS,
  confirmed: ConfirmedRenewal | null = null,
  /** A decision is awaited on the end of a contract without renewal (`GET /contracts/:id/renewal`, `end` mode). */
  endDecisionDue = false,
): ContractSchedule | null {
  const decisionWindow = windowDays ?? DECISION_WINDOW_DAYS;
  const terms = computeContractTerms(input, today);
  if (!terms) return null;
  const start = input.start_date;
  const duration = wholeMonths(input.duration_months);
  const notice = wholeMonths(input.notice_period_months);
  const validUntil = endOfValidityYmd(input.disabled_at);
  const k = terms.term_index;
  const termStart = (index: number) => addMonthsYmd(start, index * duration);
  const termEnd = (index: number) => addDays(termStart(index + 1), -1);

  const base = {
    terms,
    termNumber: k + 1,
    termStart: termStart(k),
    termEnd: duration > 0 ? termEnd(k) : start,
    renewals: k,
    startDate: start,
    noticeMonths: notice,
    upcoming: start > today,
  };
  if (duration === 0) {
    return { ...base, state: { kind: 'none' }, lastTerm: true, timeline: null };
  }

  // A next term starts: with renewal, or without it up to an end of validity after that term starts (the term rule).
  const renewsAfter = (Boolean(input.auto_renewal) || validUntil !== null) && (validUntil === null || termStart(k + 1) <= validUntil);
  const currentEnd = termEnd(k);
  // The renewal is confirmed for the term of the next deadline (the dates may have changed since).
  const confirmedNow = renewsAfter && confirmed !== null && terms.next_cancellation_deadline !== null
    && terms.next_cancellation_deadline === addMonthsYmd(confirmed.term_end, -notice);
  let state: DeadlineState;
  if (confirmedNow && confirmed) {
    state = { kind: 'confirmed', nextStart: confirmed.renews_on, nextEnd: confirmed.next_term_end };
  } else if (!renewsAfter) {
    // The contract ends with its term, or on its end of validity when that comes first.
    const end = validUntil !== null && validUntil < currentEnd ? validUntil : currentEnd;
    state = end < today
      ? { kind: 'expired', end }
      : { kind: 'ends', end, days: daysBetween(today, end), ...(endDecisionDue && !input.auto_renewal ? { decisionDue: true } : {}) };
  } else {
    const deadline = addMonthsYmd(currentEnd, -notice);
    if (deadline >= today) {
      const days = daysBetween(today, deadline);
      state = { kind: 'cancel', deadline, days, urgent: days <= decisionWindow };
    } else {
      state = { kind: 'renewed', renewedUntil: termEnd(k + 1), nextDeadline: terms.next_cancellation_deadline };
    }
  }

  // The timeline: a few terms up to the current one, then the next one while it is only projected.
  const segments: TermSegment[] = [];
  for (let index = Math.max(0, k - PAST_TERMS_SHOWN); index <= k; index += 1) {
    const kind = index < k ? 'past' : start > today ? 'upcoming' : currentEnd < today ? 'past' : 'current';
    segments.push({ number: index + 1, start: termStart(index), end: termEnd(index), kind });
  }
  if (renewsAfter) {
    const runs = state.kind === 'renewed' || confirmedNow;
    segments.push({ number: k + 2, start: termStart(k + 1), end: termEnd(k + 1), kind: runs ? 'next' : 'projected' });
  }

  let from = segments[0].start;
  let to = addDays(segments[segments.length - 1].end, 1);
  if (today < from) from = today;
  if (today > to) to = today;
  // A little room on both sides, so the markers at the edges keep their labels in view.
  const pad = Math.max(7, Math.round(daysBetween(from, to) * 0.02));
  from = addDays(from, -pad);
  to = addDays(to, pad);

  const deadline = renewsAfter && !confirmedNow && terms.next_cancellation_deadline && terms.next_cancellation_deadline <= to
    ? terms.next_cancellation_deadline
    : null;
  const windowStart = deadline ? addDays(deadline, -decisionWindow) : null;
  const window = deadline && windowStart ? { start: windowStart < from ? from : windowStart, end: deadline } : null;

  const firstYear = Number(from.slice(0, 4)) + 1;
  const lastYear = Number(to.slice(0, 4));
  const allYears: string[] = [];
  for (let year = firstYear; year <= lastYear; year += 1) allYears.push(`${year}-01-01`);
  const step = Math.ceil(allYears.length / MAX_YEAR_TICKS) || 1;
  const years = allYears.filter((_, index) => index % step === 0);

  return {
    ...base,
    termEnd: currentEnd,
    state,
    lastTerm: !renewsAfter,
    timeline: { from, to, segments, today, deadline, window, years },
  };
}
