/**
 * Renewal decision of a contract (lot CR): which term awaits a decision, and whether one was taken.
 * Pure: the service (`contract-renewal.service.ts`) reads the contract and its audit rows, this file
 * says what they mean.
 *
 * Two kinds of decision (`mode`):
 * - `renewal`, for a contract with tacit renewal: about the term whose cancellation deadline is the
 *   first one on or after today, on the calendar of a contract renewing with no end
 *   (`contractTermCalendar`): renew, terminate or renegotiate before the deadline;
 * - `end` (lot CR2, round 2), for a contract without tacit renewal: about its end (its end of
 *   validity, or the end of its first term without one) once it falls within the window: renew
 *   (the renewal turns on, the end of validity goes) or let it end (`end`).
 * Either is keyed by the last day of the term it is about (`term_end`; for an end, the term that
 * contains it), so a change of the notice keeps it; a change of the start date or of the duration
 * moves the terms and leaves the earlier decisions behind.
 *
 * No table: everything lives in the contract's audit rows (`audit_log`, `table_name = 'contracts'`,
 * `record_id` the contract), with `source_ref = 'contract-renewal:<term_end>'`:
 * - `after_json.renewal_task`: the decision task the daily run created for that term (one per
 *   contract and term: the run never creates a second one, even when the task was deleted);
 * - `after_json.renewal_decision`: a decision (`renew`, `terminate`, `renegotiate`, `end`) or its
 *   undoing (`undo`); the latest one counts.
 *
 * Termination (lot CR2): it turns the renewal off and sets the end of validity (`disabled_at`, noon
 * UTC of that day as for a date typed in the UI) to the day chosen: by default the proposed end
 * (`proposedEndDate`, the last day of the term decided), any day from today and from the
 * contract's start otherwise (`checkEndDate`). The term rule keeps the terms of a contract without
 * renewal up to its end of validity, so its history stays. The decision keeps `end_date`,
 * `previous_auto_renewal` and `previous_disabled_at`; its undoing puts both back while the
 * deadline has not passed. It is keyed by the term that contains the end chosen, where the
 * contract, now without renewal, looks for its end decision.
 */
import { addDaysYmd, contractTermCalendar, type ContractTermsInput } from './contract-terms';

export const RENEWAL_DECISIONS = ['renew', 'terminate', 'renegotiate', 'end'] as const;
export type RenewalDecision = (typeof RENEWAL_DECISIONS)[number];
export type RenewalAction = RenewalDecision | 'undo';

/** The `source_ref` of the audit rows of the decision on the term ending on `termEnd`. */
export function renewalSourceRef(termEnd: string): string {
  return `contract-renewal:${termEnd}`;
}

/**
 * The latest decision recorded for a term (lot CR2), as a SQL text expression for the contract row
 * `alias` (with `tenant_id` and `id`) and the SQL date `termEnd`, NULL when none. `contractTermsSql`
 * takes it as `renewalDecision`: a contract renewed for the term of its next deadline, or left to
 * end, leaves "to decide". Same reading as `readRenewalDecisions` (`contract-renewal.service.ts`);
 * the audit rows are found through `idx_audit_log_tenant_record_created` (tenant, record).
 */
export function renewalDecisionSql(alias: string): (termEnd: string) => string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) throw new Error(`Invalid table alias: ${alias}`);
  return (termEnd: string) => `((SELECT rd_a.after_json->'renewal_decision'->>'decision'
      FROM audit_log rd_a
     WHERE rd_a.tenant_id = ${alias}.tenant_id AND rd_a.record_id = ${alias}.id AND rd_a.table_name = 'contracts'
       AND rd_a.source_ref = 'contract-renewal:' || to_char(${termEnd}, 'YYYY-MM-DD')
       AND rd_a.after_json ? 'renewal_decision'
     ORDER BY rd_a.created_at DESC, rd_a.id DESC
     LIMIT 1))`;
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
  /** An end decision only: the day the contract ends (its end of validity, or its first term's end). */
  end_date?: string;
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
  /** On a termination or an end: the end chosen or kept (`YYYY-MM-DD`); none on older rows, which ended with the term. */
  end_date?: string | null;
  /** On a termination or a renewal of an end: the renewal before it, put back by its undoing. */
  previous_auto_renewal?: boolean | null;
  decided_at: string;
  user_id: string | null;
};

/** `renewal`: renew, terminate or renegotiate before a deadline; `end`: renew or let a contract without renewal end. */
export type RenewalMode = 'renewal' | 'end';

export type RenewalState =
  | { kind: 'none' }
  /** The deadline (or the end) falls within the window, no decision stands. */
  | { kind: 'pending'; mode: RenewalMode; term: RenewalTerm; renegotiating: boolean; record: RenewalDecisionRecord | null }
  /** A decision stands for the term; `can_undo` while it can still be taken back. */
  | { kind: 'decided'; mode: RenewalMode; term: RenewalTerm; record: RenewalDecisionRecord; can_undo: boolean };

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

/**
 * The end a termination proposes (lot CR2, round 1): the last day of the first term whose
 * cancellation deadline has not passed, today included (the pending term). Null without a
 * duration. Axians, deadline of 30 June 2026 passed: 31 December 2029; SAP: 30 June 2027.
 */
export function proposedEndDate(input: RenewalInput, today: string): string | null {
  return renewalTerms(input, today)?.pending.term_end ?? null;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * An end chosen for a termination: a calendar day (`YYYY-MM-DD`), today or later, not before the
 * contract starts. Earlier than `proposedEndDate` is allowed (to agree with the supplier).
 */
export function checkEndDate(value: unknown, input: RenewalInput, today: string): { ok: true; date: string } | { ok: false; message: string } {
  if (typeof value !== 'string' || !YMD.test(value) || addDaysYmd(value, 0) !== value) {
    return { ok: false, message: 'end_date must be a calendar date (YYYY-MM-DD).' };
  }
  if (value < today) return { ok: false, message: 'end_date cannot be before today.' };
  const start = input.start_date instanceof Date
    ? addDaysYmd(`${input.start_date.getFullYear()}-${String(input.start_date.getMonth() + 1).padStart(2, '0')}-${String(input.start_date.getDate()).padStart(2, '0')}`, 0)
    : String(input.start_date).slice(0, 10);
  if (value < start) return { ok: false, message: 'end_date cannot be before the start of the contract.' };
  return { ok: true, date: value };
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
  if (!input.auto_renewal) return resolveEndState(input, today, windowDays, latest);
  const validUntil = endOfValidityYmd(input.disabled_at);
  // The contract goes on into the next term: no end of validity before it starts.
  const renewsAfter = (t: RenewalTerm) => validUntil === null || t.renews_on <= validUntil;
  const stands = (t: RenewalTerm, record: RenewalDecisionRecord | null): boolean => {
    if (!record) return false;
    if (record.decision === 'renew') return renewsAfter(t);
    // An older termination (renewal kept on) stands while the contract still ends on the day chosen.
    if (record.decision === 'terminate') return validUntil === (record.end_date ?? t.term_end);
    return false;
  };

  const { pending, current } = terms;
  const pendingRecord = latest(pending.term_end);
  if (pendingRecord && stands(pending, pendingRecord)) return { kind: 'decided', mode: 'renewal', term: pending, record: pendingRecord, can_undo: true };
  if (renewsAfter(pending) && pending.deadline <= addDaysYmd(today, windowDays)) {
    const open = pendingRecord && pendingRecord.decision !== 'undo' ? pendingRecord : null;
    return { kind: 'pending', mode: 'renewal', term: pending, renegotiating: open?.decision === 'renegotiate', record: open };
  }
  if (current) {
    const currentRecord = latest(current.term_end);
    if (currentRecord && stands(current, currentRecord)) {
      // A renewal decided on an end can be taken back until that end.
      const fromEnd = currentRecord.decision === 'renew' && currentRecord.previous_auto_renewal === false;
      const canUndo = fromEnd && today <= (currentRecord.end_date ?? current.term_end);
      return { kind: 'decided', mode: 'renewal', term: current, record: currentRecord, can_undo: canUndo };
    }
  }
  return { kind: 'none' };
}

/**
 * The end of a contract without tacit renewal (lot CR2, round 2): its end of validity, or its
 * first term's end without one; null once it has passed or without a duration. `term` is the term
 * that contains it (the key of its decisions), its `deadline` the end itself.
 */
export function renewalEnd(input: RenewalInput, today: string): RenewalTerm | null {
  const cal = contractTermCalendar(input);
  if (!cal) return null;
  const endDay = endOfValidityYmd(input.disabled_at) ?? cal.termEnd(0);
  if (endDay < today) return null;
  const k = cal.termAt(endDay);
  return {
    term_index: k,
    term_start: cal.termStart(k),
    term_end: cal.termEnd(k),
    deadline: endDay,
    renews_on: cal.termStart(k + 1),
    next_term_end: cal.termEnd(k + 1),
    end_date: endDay,
  };
}

/** The decisions that let a contract without renewal end (`END_DECISIONS` of the term rule). */
const LETS_END = new Set<RenewalAction>(['end', 'terminate']);

function resolveEndState(
  input: RenewalInput,
  today: string,
  windowDays: number,
  latest: (termEnd: string) => RenewalDecisionRecord | null,
): RenewalState {
  const term = renewalEnd(input, today);
  if (!term) return { kind: 'none' };
  const record = latest(term.term_end);
  // A decision to let it end stands while the contract still ends that day.
  if (record && LETS_END.has(record.decision) && (record.end_date ?? record.term_end) === term.end_date) {
    const canUndo = record.decision === 'end' || today <= record.deadline;
    return { kind: 'decided', mode: 'end', term, record, can_undo: canUndo };
  }
  if (term.deadline <= addDaysYmd(today, windowDays)) return { kind: 'pending', mode: 'end', term, renegotiating: false, record: null };
  return { kind: 'none' };
}

/** The decision task's title, in the language of the person it is assigned to. */
const END_TASK_TITLES: Record<string, string> = {
  en: 'Decide whether to renew or let {{name}} end',
  fr: 'Décider de renouveler ou de laisser finir {{name}}',
  de: 'Entscheiden, ob {{name}} verlängert wird oder ausläuft',
  es: 'Decidir si renovar o dejar terminar {{name}}',
};

const END_TASK_DESCRIPTIONS: Record<string, string> = {
  en: 'The contract ends on {{end}}, without tacit renewal. Decide on the contract page: renew it or let it end.',
  fr: 'Le contrat prend fin le {{end}}, sans reconduction tacite. Décidez sur la fiche du contrat : le renouveler ou le laisser finir.',
  de: 'Der Vertrag endet am {{end}}, ohne stillschweigende Verlängerung. Entscheiden Sie auf der Vertragsseite: verlängern oder auslaufen lassen.',
  es: 'El contrato termina el {{end}}, sin renovación tácita. Decida en la ficha del contrato: renovarlo o dejarlo terminar.',
};

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

/** The comment on the decision task when the renewal is turned off from the contract's properties. */
const STOP_COMMENTS: Record<string, string> = {
  en: 'Tacit renewal turned off: the contract ends on {{date}}, unless renewed.',
  fr: 'Reconduction tacite désactivée : le contrat prendra fin le {{date}}, sauf renouvellement.',
  de: 'Stillschweigende Verlängerung deaktiviert: Der Vertrag endet am {{date}}, sofern er nicht verlängert wird.',
  es: 'Renovación tácita desactivada: el contrato terminará el {{date}}, salvo renovación.',
};

/** The comment on the decision task when the renewal is turned back on (`resumeRenewal`). */
const RESUME_COMMENTS: Record<string, string> = {
  en: 'Tacit renewal turned back on: the end on {{date}} is removed.',
  fr: 'Reconduction tacite réactivée : la fin du {{date}} est retirée.',
  de: 'Stillschweigende Verlängerung wieder aktiviert: Das Ende am {{date}} entfällt.',
  es: 'Renovación tácita reactivada: se retira el fin del {{date}}.',
};

const DATE_LOCALES: Record<string, string> = { en: 'en-GB', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' };

function formatDay(ymd: string, language: string): string {
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString(DATE_LOCALES[language] ?? 'en-GB', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** The title and description of the decision task, `language` one of en, fr, de, es (English otherwise). */
export function renewalTaskText(language: string, name: string, term: RenewalTerm, mode: RenewalMode = 'renewal'): { title: string; description: string } {
  const lang = TASK_TITLES[language] ? language : 'en';
  if (mode === 'end') {
    return {
      title: END_TASK_TITLES[lang].replace('{{name}}', name),
      description: END_TASK_DESCRIPTIONS[lang].replace('{{end}}', formatDay(term.end_date ?? term.deadline, lang)),
    };
  }
  return {
    title: TASK_TITLES[lang].replace('{{name}}', name),
    description: TASK_DESCRIPTIONS[lang]
      .replace('{{deadline}}', formatDay(term.deadline, lang))
      .replace('{{renewsOn}}', formatDay(term.renews_on, lang)),
  };
}

/** The task comment of a renewal turned off (`stopRenewal`), `language` one of en, fr, de, es (English otherwise). */
export function stopRenewalComment(language: string, endDate: string): string {
  const lang = STOP_COMMENTS[language] ? language : 'en';
  return STOP_COMMENTS[lang].replace('{{date}}', formatDay(endDate, lang));
}

/** The task comment of a renewal turned back on, `language` one of en, fr, de, es (English otherwise). */
export function resumeRenewalComment(language: string, endDate: string): string {
  const lang = RESUME_COMMENTS[language] ? language : 'en';
  return RESUME_COMMENTS[lang].replace('{{date}}', formatDay(endDate, lang));
}
