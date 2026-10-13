/**
 * Contract terms, as the details form shows them while the user edits the dates.
 *
 * Copy of the rule in `backend/src/contracts/contract-terms.ts` (`computeContractTerms`), which
 * the API applies everywhere else: successive terms of `duration_months` months from the start
 * date, only the first one without tacit renewal nor end of validity, none starting after the
 * end of validity (a contract without renewal runs in terms up to its end of validity); the
 * cancellation deadline of a term is its end minus the notice. Adding or removing months keeps
 * the day of the month, brought back to the month's last day when it does not exist
 * (PostgreSQL's `date + interval 'N months'`). Change both together: `contractTerms.test.ts`
 * holds the same cases as the backend parity spec.
 */

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

export type ContractTermsInput = {
  start_date: string;
  duration_months?: number | null;
  notice_period_months?: number | null;
  auto_renewal?: boolean | null;
  disabled_at?: string | null;
};

export type ContractTerms = {
  term_index: number;
  renewed: boolean;
  current_term_end: string;
  next_cancellation_deadline: string | null;
  cancellation_deadline: string;
};

function parseYmd(ymd: string): [number, number, number] {
  const match = YMD.exec(ymd);
  if (!match) throw new Error(`Invalid calendar date: ${ymd}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
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
  const day = Math.min(d, daysInMonth(year, month));
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = parseYmd(ymd);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Today's UTC calendar day, as the API reads it. */
export function utcTodayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function endOfValidityYmd(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function wholeMonths(value: number | null | undefined): number {
  const n = Math.trunc(Number(value ?? 0));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** The terms of a contract as of `todayYmd`; null while the start date is not a valid day. */
export function computeContractTerms(input: ContractTermsInput, todayYmd: string): ContractTerms | null {
  if (!YMD.test(input.start_date || '') || !YMD.test(todayYmd)) return null;
  const start = input.start_date;
  const duration = wholeMonths(input.duration_months);
  const notice = wholeMonths(input.notice_period_months);
  const validUntil = endOfValidityYmd(input.disabled_at);
  // The terms run on with tacit renewal, or without it up to an end of validity (the API's rule).
  const runs = duration > 0 && (Boolean(input.auto_renewal) || validUntil !== null);

  const termStart = (k: number) => addMonthsYmd(start, k * duration);
  const termEnd = (k: number) => addDaysYmd(termStart(k + 1), -1);
  const deadline = (k: number) => addMonthsYmd(termEnd(k), -notice);
  const termAt = (day: string) => {
    let k = 0;
    while (termStart(k + 1) <= day) k += 1;
    return k;
  };

  const lastTerm = !runs ? 0 : validUntil === null ? Infinity : termAt(validUntil);
  const termIndex = !runs ? 0 : Math.min(termAt(todayYmd), lastTerm);

  let next: string | null = null;
  for (let k = termIndex; k <= lastTerm; k += 1) {
    const candidate = deadline(k);
    if (validUntil !== null && candidate > validUntil) break;
    if (candidate >= todayYmd) {
      next = candidate;
      break;
    }
  }

  return {
    term_index: termIndex,
    renewed: termIndex > 0,
    current_term_end: termEnd(termIndex),
    next_cancellation_deadline: next,
    cancellation_deadline: next ?? deadline(Number.isFinite(lastTerm) ? lastTerm : termIndex),
  };
}
