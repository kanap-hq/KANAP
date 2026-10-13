/**
 * Contract terms: the one place that dates a contract's terms, in TypeScript and in SQL.
 *
 * A contract runs in successive terms of `duration_months` months from `start_date`. Without
 * tacit renewal (`auto_renewal = false`) it has only the first one. With it, term `k` covers
 * `[start + k·duration months, start + (k+1)·duration months − 1 day]`, with no limit. An end of
 * validity (`disabled_at`, read as its UTC calendar day) stops the sequence: no term starts after
 * it. A duration of 0 (or none) is a single term of no length, ending the day before the start.
 *
 * Each term has a cancellation deadline: the term's end minus `notice_period_months` months. A
 * notice as long as the term, or longer, puts the deadline before the term's start.
 *
 * Adding or removing N months keeps the day of the month and brings it back to the last day of
 * the target month when that day does not exist: PostgreSQL's `date + interval 'N months'`.
 * 2025-01-31 + 1 month = 2025-02-28; 2026-12-31 − 3 months = 2026-09-30.
 *
 * Values as of a date ("today", a UTC calendar day):
 * - `term_index`: the term that contains today (0 for the first one). A future contract is in
 *   its first term; a contract past its last term stays on its last term.
 * - `current_term_end`: the end of that term.
 * - `next_cancellation_deadline`: the first deadline on or after today, among the terms that
 *   exist. Null when there is none (a contract that does not renew, its deadline passed) or when
 *   that deadline falls after the end of validity.
 * - `renewed`: `term_index > 0`.
 * - `end_date` = `current_term_end`; `cancellation_deadline` = `next_cancellation_deadline`, or
 *   the last term's deadline when it is null, so an ended contract keeps a date to show.
 * - `renews_at_term_end`: a next term exists after the current one (renewal on, no end of
 *   validity before that next term starts). The expiry warnings skip the term end of such a
 *   contract: it does not end there.
 * - `next_due_date`: the next date the contract list sorts on. A contract that renews at the end
 *   of its current term: its next cancellation deadline (the term end when there is none). Any
 *   other contract: its end, the current term end or the end of validity when that comes first.
 *   Null once that end has passed.
 * - `term_state`, in this order: `expired` (no next due date), `ending` (it does not renew at
 *   the end of its current term), `to_decide` (its next cancellation deadline falls within the
 *   decision window, `CONTRACT_DECISION_WINDOW_DAYS` from today), `renewed` (the current term's
 *   deadline has passed: the contract goes on into the next term) or `in_progress`.
 *
 * `computeContractTerms` reads the rule as written. `contractTermsSql` gives the same values as
 * SQL expressions for sorting, filtering and the expiry warnings; the parity spec
 * (`__tests__/contract-terms.parity.spec.ts`) checks both on the same cases. The frontend has a
 * copy in `frontend/src/pages/contracts/contractTerms.ts`.
 *
 * The commitment of a year (`contractCommitmentCents`, `contractCommitmentSql`; lot CB): the
 * yearly amount at signature prorated over the months of the year its terms cover, a month
 * covered in part by the share of its days covered. The terms cover one span from the start
 * date: the first term only without renewal, every term with it (the renewal is projected with
 * no end), nothing after the end of validity. No indexation: the amount at signature holds for
 * every term. The API alone computes it (no frontend copy).
 */

import { centsToNumber, toCents } from '../common/amount';
import { divRoundHalfAway as divRoundHalfAwayBig } from '../common/decimal';
import { divRoundHalfAway } from '../common/list-engine/sql-fragments';

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The days before a cancellation deadline during which a renewing contract awaits a decision
 * (`term_state = 'to_decide'`). A constant until the tenant can set it.
 */
export const CONTRACT_DECISION_WINDOW_DAYS = 90;

/** The states of a contract's terms, as the contract list shows and filters them. */
export const CONTRACT_TERM_STATES = ['to_decide', 'in_progress', 'renewed', 'ending', 'expired'] as const;
export type ContractTermState = (typeof CONTRACT_TERM_STATES)[number];

/** Options of the values that depend on the decision window. */
export type ContractTermsOptions = { decisionWindowDays?: number };

function decisionWindowDays(opts?: ContractTermsOptions): number {
  const days = opts?.decisionWindowDays ?? CONTRACT_DECISION_WINDOW_DAYS;
  if (!Number.isInteger(days) || days < 0) throw new Error(`Invalid decision window: ${days}`);
  return days;
}

export type ContractTermsInput = {
  start_date: string | Date;
  duration_months?: number | string | null;
  notice_period_months?: number | string | null;
  auto_renewal?: boolean | null;
  disabled_at?: Date | string | null;
};

export type ContractTerms = {
  term_index: number;
  renewed: boolean;
  current_term_end: string;
  next_cancellation_deadline: string | null;
  end_date: string;
  cancellation_deadline: string;
  renews_at_term_end: boolean;
  next_due_date: string | null;
  term_state: ContractTermState;
};

/** The fields a contract response carries (the internal `renews_at_term_end` stays out). */
export type ContractTermFields = Omit<ContractTerms, 'renews_at_term_end'>;

function parseYmd(ymd: string): [number, number, number] {
  const match = YMD.exec(ymd);
  if (!match) throw new Error(`Invalid calendar date: ${ymd}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function formatYmd(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** `ymd` plus `months` months (negative to go back), the day brought back to the month's last day. */
export function addMonthsYmd(ymd: string, months: number): string {
  const [y, m, d] = parseYmd(ymd);
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = total - year * 12 + 1;
  return formatYmd(year, month, Math.min(d, daysInMonth(year, month)));
}

/** `ymd` plus `days` calendar days. */
export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = parseYmd(ymd);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * A calendar day as `YYYY-MM-DD`. A `Date` from a `date` column (raw queries) is local midnight,
 * so its local fields are the day.
 */
function toYmd(value: string | Date): string {
  if (value instanceof Date) return formatYmd(value.getFullYear(), value.getMonth() + 1, value.getDate());
  const text = String(value).slice(0, 10);
  parseYmd(text);
  return text;
}

/** The UTC calendar day of an end of validity (a bare day is noon UTC of that day). */
function endOfValidityYmd(value: Date | string | null | undefined): string | null {
  if (value == null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function wholeMonths(value: number | string | null | undefined): number {
  const n = Math.trunc(Number(value ?? 0));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** The terms of a contract as of `todayYmd` (`YYYY-MM-DD`, a UTC calendar day). */
export function computeContractTerms(input: ContractTermsInput, todayYmd: string, opts?: ContractTermsOptions): ContractTerms {
  parseYmd(todayYmd);
  const windowDays = decisionWindowDays(opts);
  const start = toYmd(input.start_date);
  const duration = wholeMonths(input.duration_months);
  const notice = wholeMonths(input.notice_period_months);
  const renews = Boolean(input.auto_renewal) && duration > 0;
  const validUntil = endOfValidityYmd(input.disabled_at);

  const termStart = (k: number) => addMonthsYmd(start, k * duration);
  const termEnd = (k: number) => addDaysYmd(termStart(k + 1), -1);
  const deadline = (k: number) => addMonthsYmd(termEnd(k), -notice);
  /** The term that contains `day` (the first one before the start). Only when the contract renews. */
  const termAt = (day: string) => {
    let k = 0;
    while (termStart(k + 1) <= day) k += 1;
    return k;
  };

  // The last term: the first one without renewal, the one containing the end of validity with it.
  const lastTerm = !renews ? 0 : validUntil === null ? Infinity : termAt(validUntil);
  const termIndex = !renews ? 0 : Math.min(termAt(todayYmd), lastTerm);

  let next: string | null = null;
  for (let k = termIndex; k <= lastTerm; k += 1) {
    const candidate = deadline(k);
    if (validUntil !== null && candidate > validUntil) break;
    if (candidate >= todayYmd) {
      next = candidate;
      break;
    }
  }

  const currentTermEnd = termEnd(termIndex);
  const renewsAtTermEnd = termIndex < lastTerm;
  // A contract that stops: at its term end, or at its end of validity when that comes first.
  const contractEnd = validUntil !== null && validUntil < currentTermEnd ? validUntil : currentTermEnd;
  const nextDue = renewsAtTermEnd && next !== null ? next : contractEnd >= todayYmd ? contractEnd : null;
  let termState: ContractTermState;
  if (nextDue === null) termState = 'expired';
  else if (!renewsAtTermEnd) termState = 'ending';
  else if (next !== null && next <= addDaysYmd(todayYmd, windowDays)) termState = 'to_decide';
  else if (deadline(termIndex) < todayYmd) termState = 'renewed';
  else termState = 'in_progress';
  return {
    term_index: termIndex,
    renewed: termIndex > 0,
    current_term_end: currentTermEnd,
    next_cancellation_deadline: next,
    end_date: currentTermEnd,
    cancellation_deadline: next ?? deadline(Number.isFinite(lastTerm) ? lastTerm : termIndex),
    renews_at_term_end: renewsAtTermEnd,
    next_due_date: nextDue,
    term_state: termState,
  };
}

/** The response fields of `computeContractTerms`. */
export function contractTermFields(input: ContractTermsInput, todayYmd: string, opts?: ContractTermsOptions): ContractTermFields {
  const { renews_at_term_end: _internal, ...fields } = computeContractTerms(input, todayYmd, opts);
  return fields;
}

/** Today's UTC calendar day in SQL, for expressions that cannot take a value from the caller. */
export const SQL_TODAY_UTC = `(now() AT TIME ZONE 'UTC')::date`;

/** A `YYYY-MM-DD` day as a SQL date literal (validated, so it is safe to inline). */
export function sqlDateLiteral(ymd: string): string {
  const [y, m, d] = parseYmd(ymd);
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) throw new Error(`Invalid calendar date: ${ymd}`);
  return `DATE '${ymd}'`;
}

export type ContractTermsSql = {
  termIndex: string;
  currentTermEnd: string;
  nextCancellationDeadline: string;
  cancellationDeadline: string;
  renewsAtTermEnd: string;
  nextDueDate: string;
  termState: string;
  /** The whole row (`term_index`, `current_term_end`, ...), for a `LEFT JOIN LATERAL (...) alias ON true`. */
  row: string;
};

/**
 * The same values as `computeContractTerms`, as SQL for the contract row `alias` (any row with
 * `start_date`, `duration_months`, `notice_period_months`, `auto_renewal` and `disabled_at`) as of
 * the SQL date expression `today`. Each value is a scalar subquery, usable in a select, a WHERE or
 * an ORDER BY. `alias` must be a plain identifier and `today` a trusted expression
 * (`sqlDateLiteral`, `SQL_TODAY_UTC`, a `$n::date` parameter or a column).
 */
export function contractTermsSql(alias: string, today: string, opts?: ContractTermsOptions): ContractTermsSql {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) throw new Error(`Invalid table alias: ${alias}`);
  const windowDays = decisionWindowDays(opts);
  const a = alias;
  const monthIndex = (day: string) => `(EXTRACT(YEAR FROM ${day})::int * 12 + EXTRACT(MONTH FROM ${day})::int)`;
  const addMonths = (day: string, months: string) => `(${day} + make_interval(months => ${months}))::date`;
  // The term that contains `day` (renewing contracts only, so ct_b.d > 0): the whole months
  // since the start divided by the duration, minus one when that term starts later in the month.
  const termAt = (day: string) => {
    const k = `(GREATEST(${monthIndex(day)} - ${monthIndex('ct_b.s')}, 0) / NULLIF(ct_b.d, 0))`;
    return `GREATEST(0, ${k} - CASE WHEN ${addMonths('ct_b.s', `${k} * ct_b.d`)} > ${day} THEN 1 ELSE 0 END)`;
  };
  const termEnd = (k: string) => `(${addMonths('ct_b.s', `(${k} + 1) * ct_b.d`)} - 1)`;
  const deadline = (k: string) => addMonths(termEnd(k), '-ct_b.n');

  const row = `SELECT ct_i.term_index,
           ${termEnd('ct_i.term_index')} AS current_term_end,
           ct_x.next_deadline AS next_cancellation_deadline,
           COALESCE(ct_x.next_deadline, ${deadline('COALESCE(ct_i.last_term, ct_i.term_index)')}) AS cancellation_deadline,
           (ct_i.last_term IS NULL OR ct_i.term_index < ct_i.last_term) AS renews_at_term_end,
           ct_n.next_due AS next_due_date,
           CASE WHEN ct_n.next_due IS NULL THEN 'expired'
                WHEN NOT ct_e.renews_next THEN 'ending'
                WHEN ct_x.next_deadline <= ct_b.today + ${windowDays} THEN 'to_decide'
                WHEN ct_e.current_deadline < ct_b.today THEN 'renewed'
                ELSE 'in_progress' END AS term_state
      FROM (SELECT ${a}.start_date AS s,
                   GREATEST(COALESCE(${a}.duration_months, 0), 0) AS d,
                   GREATEST(COALESCE(${a}.notice_period_months, 0), 0) AS n,
                   (COALESCE(${a}.auto_renewal, false) AND COALESCE(${a}.duration_months, 0) > 0) AS renews,
                   (${a}.disabled_at AT TIME ZONE 'UTC')::date AS valid_until,
                   (${today})::date AS today) ct_b
      CROSS JOIN LATERAL (
        SELECT CASE WHEN ct_b.renews THEN ${termAt('LEAST(ct_b.today, ct_b.valid_until)')} ELSE 0 END AS term_index,
               CASE WHEN NOT ct_b.renews THEN 0
                    WHEN ct_b.valid_until IS NOT NULL THEN ${termAt('ct_b.valid_until')} END AS last_term
      ) ct_i
      CROSS JOIN LATERAL (
        /* The first deadline on or after today is the one of term k0, k0 + 1 or k0 + 2, k0 being
           the first term whose end, less the notice, can reach today's month. */
        SELECT CASE WHEN ct_b.renews
                    THEN GREATEST(0, CEIL((${monthIndex('ct_b.today')} - ${monthIndex('ct_b.s')} + ct_b.n)::numeric / NULLIF(ct_b.d, 0))::int - 1)
                    ELSE 0 END AS k0
      ) ct_q
      CROSS JOIN LATERAL (
        SELECT min(ct_d.deadline) AS next_deadline
          FROM generate_series(ct_q.k0, CASE WHEN ct_b.renews THEN ct_q.k0 + 2 ELSE 0 END) AS ct_k(k)
          CROSS JOIN LATERAL (SELECT ${deadline('ct_k.k')} AS deadline) ct_d
         WHERE (ct_i.last_term IS NULL OR ct_k.k <= ct_i.last_term)
           AND ct_d.deadline >= ct_b.today
           AND (ct_b.valid_until IS NULL OR ct_d.deadline <= ct_b.valid_until)
      ) ct_x
      CROSS JOIN LATERAL (
        /* LEAST skips a null end of validity. */
        SELECT (ct_i.last_term IS NULL OR ct_i.term_index < ct_i.last_term) AS renews_next,
               LEAST(${termEnd('ct_i.term_index')}, ct_b.valid_until) AS contract_end,
               ${deadline('ct_i.term_index')} AS current_deadline
      ) ct_e
      CROSS JOIN LATERAL (
        SELECT CASE WHEN ct_e.renews_next AND ct_x.next_deadline IS NOT NULL THEN ct_x.next_deadline
                    WHEN ct_e.contract_end >= ct_b.today THEN ct_e.contract_end END AS next_due
      ) ct_n`;
  const pick = (column: string) => `(SELECT ct_r.${column} FROM (${row}) ct_r)`;
  return {
    termIndex: pick('term_index'),
    currentTermEnd: pick('current_term_end'),
    nextCancellationDeadline: pick('next_cancellation_deadline'),
    cancellationDeadline: pick('cancellation_deadline'),
    renewsAtTermEnd: pick('renews_at_term_end'),
    nextDueDate: pick('next_due_date'),
    termState: pick('term_state'),
    row,
  };
}

/**
 * The least common multiple of the month lengths (28, 29, 30 and 31 days): a day of any month is
 * a whole number of these units of a month (13 485 of February, 12 180 of a 31-day month), so the
 * covered share of a year is an exact integer.
 */
export const MONTH_SHARE_UNITS = 377580;

/** The units of a year: twelve whole months. */
const YEAR_SHARE_UNITS = 12 * MONTH_SHARE_UNITS;

export type ContractCommitmentInput = ContractTermsInput & {
  yearly_amount_at_signature?: number | string | null;
};

/**
 * The days a contract's terms cover, `[start, end]`, `end` null when the renewal goes on with no
 * end of validity. Null when they cover no day (a duration of 0, an end of validity before the
 * start).
 */
export function contractCoveredSpan(input: ContractTermsInput): { start: string; end: string | null } | null {
  const start = toYmd(input.start_date);
  const duration = wholeMonths(input.duration_months);
  const renews = Boolean(input.auto_renewal) && duration > 0;
  const validUntil = endOfValidityYmd(input.disabled_at);
  // Without renewal, the first term; with it, every term up to the end of validity.
  let end: string | null = renews ? null : addDaysYmd(addMonthsYmd(start, duration), -1);
  if (validUntil !== null && (end === null || validUntil < end)) end = validUntil;
  if (end !== null && end < start) return null;
  return { start, end };
}

const dayNumber = (ymd: string) => {
  const [y, m, d] = parseYmd(ymd);
  return Date.UTC(y, m - 1, d) / 86_400_000;
};

/** The units of `year` the terms cover: each month's covered days times the units of one of its days. */
function coveredUnits(span: { start: string; end: string | null }, year: number): bigint {
  let units = 0n;
  for (let month = 1; month <= 12; month += 1) {
    const days = daysInMonth(year, month);
    const first = formatYmd(year, month, 1);
    const last = formatYmd(year, month, days);
    const from = span.start > first ? span.start : first;
    const to = span.end !== null && span.end < last ? span.end : last;
    const covered = dayNumber(to) - dayNumber(from) + 1;
    if (covered > 0) units += BigInt(covered * (MONTH_SHARE_UNITS / days));
  }
  return units;
}

/**
 * The commitment of `year` in cents of the contract's currency: the yearly amount's cents times
 * the covered units over a year's units, rounded half away from zero once.
 */
export function contractCommitmentCents(input: ContractCommitmentInput, year: number): bigint {
  if (!Number.isInteger(year)) throw new Error(`Invalid year: ${year}`);
  const span = contractCoveredSpan(input);
  if (span === null) return 0n;
  const units = coveredUnits(span, year);
  if (units === 0n) return 0n;
  return divRoundHalfAwayBig(toCents(input.yearly_amount_at_signature ?? 0) * units, BigInt(YEAR_SHARE_UNITS));
}

/** The commitment of `year` in the contract's currency (2 decimals). */
export function contractCommitment(input: ContractCommitmentInput, year: number): number {
  return centsToNumber(contractCommitmentCents(input, year));
}

/**
 * `contractCommitmentCents` in SQL, for the contract row `alias` (any row with `start_date`,
 * `duration_months`, `auto_renewal`, `disabled_at` and `yearly_amount_at_signature`) and the
 * integer SQL expression `year`: a scalar subquery giving the cents as an integer `numeric`.
 * `alias` must be a plain identifier and `year` a trusted expression (a column, a bound
 * parameter).
 */
export function contractCommitmentSql(alias: string, year: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) throw new Error(`Invalid table alias: ${alias}`);
  const a = alias;
  // LEAST and GREATEST skip a null: a null end (renewal with no end of validity) covers every month.
  return `(SELECT ${divRoundHalfAway('round(cm_b.amount * 100) * cm_u.units', String(YEAR_SHARE_UNITS))}
      FROM (SELECT ${a}.start_date AS s,
                   LEAST((${a}.disabled_at AT TIME ZONE 'UTC')::date,
                         CASE WHEN COALESCE(${a}.auto_renewal, false) AND COALESCE(${a}.duration_months, 0) > 0 THEN NULL
                              ELSE (${a}.start_date + make_interval(months => GREATEST(COALESCE(${a}.duration_months, 0), 0)))::date - 1 END) AS e,
                   COALESCE(${a}.yearly_amount_at_signature, 0)::numeric AS amount,
                   (${year})::int AS yr) cm_b
      CROSS JOIN LATERAL (
        SELECT COALESCE(sum(GREATEST(0, LEAST(cm_b.e, cm_m.last) - GREATEST(cm_b.s, cm_m.first) + 1)
                            * (${MONTH_SHARE_UNITS} / extract(day FROM cm_m.last)::int)), 0)::numeric AS units
          FROM generate_series(1, 12) AS cm_k(m)
          CROSS JOIN LATERAL (
            SELECT make_date(cm_b.yr, cm_k.m, 1) AS first,
                   (make_date(cm_b.yr, cm_k.m, 1) + interval '1 month')::date - 1 AS last
          ) cm_m
      ) cm_u)`;
}
