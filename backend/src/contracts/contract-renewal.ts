/**
 * Renewal decision of a contract (lot CR): which term awaits a decision, and whether one was taken.
 * Pure: the service (`contract-renewal.service.ts`) reads the contract and its audit rows, this file
 * says what they mean.
 *
 * A decision is about one term: the term whose cancellation deadline is the first one on or after
 * today, on the calendar of a contract renewing with no end (`contractTermCalendar`). It is keyed
 * by that term's last day (`term_end`), so a change of the notice keeps it; a change of the start
 * date or of the duration moves the terms and leaves the earlier decisions behind.
 *
 * No table: everything lives in the contract's audit rows (`audit_log`, `table_name = 'contracts'`,
 * `record_id` the contract), with `source_ref = 'contract-renewal:<term_end>'`:
 * - `after_json.renewal_task`: the decision task the daily run created for that term (one per
 *   contract and term: the run never creates a second one, even when the task was deleted);
 * - `after_json.renewal_decision`: a decision (`renew`, `terminate`, `renegotiate`) or its undoing
 *   (`undo`); the latest one counts.
 *
 * Termination: the term rule gives a contract without tacit renewal its first term only, so
 * `auto_renewal = false` would end a contract in its fourth term at the end of its first one. A
 * termination therefore keeps the renewal and sets the end of validity to the last day of the term
 * decided (`disabled_at`, noon UTC of that day as for a date typed in the UI): the contract ends
 * with its current term, its commitments and the budget check follow, it is warned on its end. The
 * undoing puts the previous end of validity back while the deadline has not passed.
 */
import { addDaysYmd, contractTermCalendar, type ContractTermsInput } from './contract-terms';

export const RENEWAL_DECISIONS = ['renew', 'terminate', 'renegotiate'] as const;
export type RenewalDecision = (typeof RENEWAL_DECISIONS)[number];
export type RenewalAction = RenewalDecision | 'undo';

/** The `source_ref` of the audit rows of the decision on the term ending on `termEnd`. */
export function renewalSourceRef(termEnd: string): string {
  return `contract-renewal:${termEnd}`;
}

/**
 * Whether a renewal is confirmed for a term (lot CR2), as a SQL boolean for the contract row
 * `alias` (with `tenant_id` and `id`) and the SQL date `termEnd`: the latest decision recorded for
 * that term is a renewal. `contractTermsSql` takes it as `renewalConfirmed`, so a contract renewed
 * for the term of its next deadline leaves "to decide". Same reading as `readConfirmedRenewals`
 * (`contract-renewal.service.ts`); the audit rows are found through
 * `idx_audit_log_tenant_record_created` (tenant, record).
 */
export function renewalConfirmedSql(alias: string): (termEnd: string) => string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) throw new Error(`Invalid table alias: ${alias}`);
  return (termEnd: string) => `((SELECT rd_a.after_json->'renewal_decision'->>'decision'
      FROM audit_log rd_a
     WHERE rd_a.tenant_id = ${alias}.tenant_id AND rd_a.record_id = ${alias}.id AND rd_a.table_name = 'contracts'
       AND rd_a.source_ref = 'contract-renewal:' || to_char(${termEnd}, 'YYYY-MM-DD')
       AND rd_a.after_json ? 'renewal_decision'
     ORDER BY rd_a.created_at DESC, rd_a.id DESC
     LIMIT 1) = 'renew')`;
}

/** A term a decision is about. */
export type RenewalTerm = {
  term_index: number;
  term_start: string;
  term_end: string;
  deadline: string;
  /** First day of the next term: the day the contract renews when nobody cancels it. */
  renews_on: string;
  next_term_end: string;
};

/** A decision as its audit row holds it (`after_json.renewal_decision`). */
export type RenewalDecisionRecord = {
  decision: RenewalAction;
  reason: string | null;
  term_end: string;
  deadline: string;
  task_id: string | null;
  /** On a termination: the end of validity before it, put back by its undoing. */
  previous_disabled_at?: string | null;
  decided_at: string;
  user_id: string | null;
};

export type RenewalState =
  | { kind: 'none' }
  /** The deadline falls within the window, no renewal or termination stands. */
  | { kind: 'pending'; term: RenewalTerm; renegotiating: boolean; record: RenewalDecisionRecord | null }
  /** A renewal or termination stands for the term; `can_undo` while its deadline has not passed. */
  | { kind: 'decided'; term: RenewalTerm; record: RenewalDecisionRecord; can_undo: boolean };

export type RenewalInput = ContractTermsInput;

/**
 * The terms a decision may be about as of `today`: `pending`, the term of the first deadline on
 * or after today; `current`, the term that contains today when its deadline has passed (its
 * decision shows until its end). Null without a duration.
 */
export function renewalTerms(input: RenewalInput, today: string): { pending: RenewalTerm; current: RenewalTerm | null } | null {
  const cal = contractTermCalendar(input);
  if (!cal) return null;
  const term = (k: number): RenewalTerm => ({
    term_index: k,
    term_start: cal.termStart(k),
    term_end: cal.termEnd(k),
    deadline: cal.deadline(k),
    renews_on: cal.termStart(k + 1),
    next_term_end: cal.termEnd(k + 1),
  });
  const now = cal.termAt(today);
  let k = now;
  // A notice longer than the term puts a deadline before its term starts: a few steps at most.
  while (cal.deadline(k) < today) k += 1;
  const current = k > now && cal.termEnd(now) >= today ? term(now) : null;
  return { pending: term(k), current };
}

function endOfValidityYmd(value: Date | string | null | undefined): string | null {
  if (value == null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * The renewal state of a contract as of `today`, with the tenant's window and `latest`, the
 * latest decision row recorded for a term (by its `term_end`), null when there is none.
 */
export function resolveRenewalState(
  input: RenewalInput,
  today: string,
  windowDays: number,
  latest: (termEnd: string) => RenewalDecisionRecord | null,
): RenewalState {
  const terms = renewalTerms(input, today);
  if (!terms) return { kind: 'none' };
  const renewal = Boolean(input.auto_renewal);
  const validUntil = endOfValidityYmd(input.disabled_at);
  // The contract goes on into the next term: renewal on, no end of validity before it starts.
  const renewsAfter = (t: RenewalTerm) => renewal && (validUntil === null || t.renews_on <= validUntil);
  const stands = (t: RenewalTerm, record: RenewalDecisionRecord | null): boolean => {
    if (!record) return false;
    if (record.decision === 'renew') return renewsAfter(t);
    // A termination stands while the contract still ends on the last day of that term.
    if (record.decision === 'terminate') return renewal && validUntil === t.term_end;
    return false;
  };

  const { pending, current } = terms;
  const pendingRecord = latest(pending.term_end);
  if (pendingRecord && stands(pending, pendingRecord)) return { kind: 'decided', term: pending, record: pendingRecord, can_undo: true };
  if (renewsAfter(pending) && pending.deadline <= addDaysYmd(today, windowDays)) {
    const open = pendingRecord && pendingRecord.decision !== 'undo' ? pendingRecord : null;
    return { kind: 'pending', term: pending, renegotiating: open?.decision === 'renegotiate', record: open };
  }
  if (current) {
    const currentRecord = latest(current.term_end);
    if (currentRecord && stands(current, currentRecord)) return { kind: 'decided', term: current, record: currentRecord, can_undo: false };
  }
  return { kind: 'none' };
}

/** The decision task's title, in the language of the person it is assigned to. */
const TASK_TITLES: Record<string, string> = {
  en: 'Decide on the renewal of {{name}}',
  fr: 'Décider du renouvellement de {{name}}',
  de: 'Über die Verlängerung von {{name}} entscheiden',
  es: 'Decidir la renovación de {{name}}',
};

const TASK_DESCRIPTIONS: Record<string, string> = {
  en: 'The cancellation deadline is {{deadline}}. Without a decision, the contract renews on {{renewsOn}}. Decide on the contract page: renew, terminate or renegotiate.',
  fr: 'La date limite de résiliation est le {{deadline}}. Sans décision, le contrat est reconduit le {{renewsOn}}. Décidez sur la fiche du contrat : renouveler, résilier ou renégocier.',
  de: 'Die Kündigungsfrist endet am {{deadline}}. Ohne Entscheidung verlängert sich der Vertrag am {{renewsOn}}. Entscheiden Sie auf der Vertragsseite: verlängern, kündigen oder neu verhandeln.',
  es: 'La fecha límite de rescisión es el {{deadline}}. Sin decisión, el contrato se renueva el {{renewsOn}}. Decida en la ficha del contrato: renovar, rescindir o renegociar.',
};

const DATE_LOCALES: Record<string, string> = { en: 'en-GB', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' };

function formatDay(ymd: string, language: string): string {
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString(DATE_LOCALES[language] ?? 'en-GB', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** The title and description of the decision task, `language` one of en, fr, de, es (English otherwise). */
export function renewalTaskText(language: string, name: string, term: RenewalTerm): { title: string; description: string } {
  const lang = TASK_TITLES[language] ? language : 'en';
  return {
    title: TASK_TITLES[lang].replace('{{name}}', name),
    description: TASK_DESCRIPTIONS[lang]
      .replace('{{deadline}}', formatDay(term.deadline, lang))
      .replace('{{renewsOn}}', formatDay(term.renews_on, lang)),
  };
}
