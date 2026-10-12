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
 *
 * `computeContractTerms` reads the rule as written. `contractTermsSql` gives the same values as
 * SQL expressions for sorting, filtering and the expiry warnings; the parity spec
 * (`__tests__/contract-terms.parity.spec.ts`) checks both on the same cases. The frontend has a
 * copy in `frontend/src/pages/contracts/contractTerms.ts`.
 */

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

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
export function computeContractTerms(input: ContractTermsInput, todayYmd: string): ContractTerms {
  parseYmd(todayYmd);
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
  return {
    term_index: termIndex,
    renewed: termIndex > 0,
    current_term_end: currentTermEnd,
    next_cancellation_deadline: next,
    end_date: currentTermEnd,
    cancellation_deadline: next ?? deadline(Number.isFinite(lastTerm) ? lastTerm : termIndex),
    renews_at_term_end: termIndex < lastTerm,
  };
}

/** The response fields of `computeContractTerms`. */
export function contractTermFields(input: ContractTermsInput, todayYmd: string): ContractTermFields {
  const { renews_at_term_end: _internal, ...fields } = computeContractTerms(input, todayYmd);
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
export function contractTermsSql(alias: string, today: string): ContractTermsSql {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) throw new Error(`Invalid table alias: ${alias}`);
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
           (ct_i.last_term IS NULL OR ct_i.term_index < ct_i.last_term) AS renews_at_term_end
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
      ) ct_x`;
  const pick = (column: string) => `(SELECT ct_r.${column} FROM (${row}) ct_r)`;
  return {
    termIndex: pick('term_index'),
    currentTermEnd: pick('current_term_end'),
    nextCancellationDeadline: pick('next_cancellation_deadline'),
    cancellationDeadline: pick('cancellation_deadline'),
    renewsAtTermEnd: pick('renews_at_term_end'),
    row,
  };
}
